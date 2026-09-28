/**
 * Коннектор: поведение рабочего места (js/connector.js + templates/connector.html).
 *
 * Проверяется ПОВЕДЕНИЕ модуля через публичный API `window.Connector` и DOM,
 * а не текст исходника (#4751). Страница грузится чтением + eval (не CommonJS).
 *
 * Run: node experiments/connector-workplace.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const JS_PATH = path.join(__dirname, '..', 'js', 'connector.js');
const HTML_PATH = path.join(__dirname, '..', 'templates', 'connector.html');

let passed = 0, failed = 0, total = 0;
function assert(cond, name, detail) {
    total++;
    if (cond) { passed++; console.log('PASS ' + name); }
    else {
        failed++;
        console.log('FAIL ' + name + (detail ? '\n   ' + detail : ''));
    }
}

const VOID = { input: 1, br: 1, img: 1, hr: 1, meta: 1, link: 1, source: 1 };

// ---- минимальный DOM, достаточный для connector.js ----
function mkEl(tag) {
    const el = {
        tag, id: '', attrs: {}, dataset: {}, style: {}, children: [], parent: null,
        text: '', value: '', _handlers: {}, _html: '', onclick: null,
        classList: {
            _s: new Set(),
            add(c) { this._s.add(c); el._syncClass(); },
            remove(c) { this._s.delete(c); el._syncClass(); },
            toggle(c, on) {
                if (on === undefined) on = !this._s.has(c);
                if (on) this._s.add(c); else this._s.delete(c);
                el._syncClass();
            },
            contains(c) { return this._s.has(c); },
        },
        _syncClass() { el.attrs['class'] = Array.from(this.classList._s).join(' '); },
        get className() { return this.attrs['class'] || ''; },
        set className(v) {
            this.classList._s = new Set(String(v).split(/\s+/).filter(Boolean));
            this._syncClass();
        },
        get innerHTML() { return this._html; },
        set innerHTML(v) {
            this._html = String(v);
            this.children = [];
            this.text = '';
            if (!v) return;
            const frag = parseHTML(String(v));
            frag.children.forEach((c) => this.appendChild(c));
            if (frag.text) this.text = frag.text;
        },
        get textContent() {
            if (this.children.length === 0) return this.text;
            return this.text + this.children.map((c) => c.textContent).join('');
        },
        set textContent(v) { this.text = String(v); this.children = []; },
        appendChild(c) { c.parent = this; this.children.push(c); return c; },
        addEventListener(type, fn) {
            (this._handlers[type] = this._handlers[type] || []).push(fn);
        },
        querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
        querySelectorAll(sel) {
            const out = [];
            const walk = (n) => {
                n.children.forEach((c) => { if (match(c, sel)) out.push(c); walk(c); });
            };
            walk(this);
            return out;
        },
        contains(node) {
            if (node === this) return true;
            return this.children.some((c) => c.contains(node));
        },
        click() {
            (this._handlers.click || []).forEach((fn) => fn({ target: this }));
            if (typeof this.onclick === 'function') this.onclick({ target: this });
        },
    };
    el._syncClass();
    return el;
}

function decodeEntities(s) {
    return String(s)
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&');
}

function parseHTML(html) {
    const root = mkEl('#root');
    const stack = [root];
    const re = /<\/?([a-zA-Z0-9]+)((?:\s[^<>]*?)?)\/?>|([^<]+)/g;
    let m;
    while ((m = re.exec(html))) {
        if (m[3] !== undefined) {
            const text = decodeEntities(m[3]);
            if (text.trim()) stack[stack.length - 1].text += text;
            continue;
        }
        const tag = m[1].toLowerCase();
        const raw = m[0];
        if (raw.startsWith('</')) {
            if (stack.length > 1) stack.pop();
            continue;
        }
        const el = mkEl(tag);
        const attrRe = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
        let a;
        while ((a = attrRe.exec(m[2] || ''))) {
            const name = a[1];
            const val = a[3] !== undefined ? a[3] : a[4];
            el.attrs[name] = val;
            if (name === 'class') val.split(/\s+/).filter(Boolean).forEach((c) => el.classList.add(c));
            if (name === 'value') el.value = val;
            if (name === 'id') el.id = val;
            if (name === 'type') el.attrs.type = val;
            if (name === 'role') el.attrs.role = val;
            if (name.startsWith('data-')) el.dataset[camel(name.slice(5))] = val;
        }
        stack[stack.length - 1].appendChild(el);
        const isVoid = VOID[tag] || /\/>$/.test(raw);
        if (!isVoid) stack.push(el);
    }
    return root;
}
function camel(s) { return s.replace(/-([a-z])/g, (_, c) => c.toUpperCase()); }

function match(el, sel) {
    if (sel.includes(',')) return sel.split(',').some((s) => match(el, s.trim()));
    let s = sel;
    let attrReq = null;
    const am = s.match(/\[([a-zA-Z_]+)=([^\]]+)\]/);
    if (am) { attrReq = [am[1], am[2].replace(/^["']|["']$/g, '')]; s = s.replace(am[0], ''); }
    let tag = null, id = null;
    const classes = [];
    const re = /(^|#|\.)([^#.]+)/g;
    let m;
    while ((m = re.exec(s))) {
        if (m[1] === '#') id = m[2];
        else if (m[1] === '.') classes.push(m[2]);
        else tag = m[2].toLowerCase();
    }
    if (tag && el.tag !== tag) return false;
    if (id && el.id !== id) return false;
    for (const c of classes) if (!el.classList.contains(c)) return false;
    if (attrReq) {
        const [an, av] = attrReq;
        const val = el.attrs[an] !== undefined ? el.attrs[an] : '';
        if (String(val) !== av) return false;
    }
    return true;
}

function makeDOM() {
    const byId = {};
    const docListeners = { click: 0 };
    const docHandlers = {};
    const mapBody = parseHTML('<tbody id="mapBody"></tbody>').children[0];
    mapBody.id = 'mapBody';
    byId.mapBody = mapBody;
    byId.mapHint = parseHTML('<div id="mapHint"></div>').children[0];
    byId.mapHint.id = 'mapHint';
    byId.result = parseHTML('<div id="result"></div>').children[0];
    byId.result.id = 'result';
    byId.entities = parseHTML('<select id="entities"><option value="users">Users</option></select>').children[0];
    byId.entities.id = 'entities';
    byId.entities.value = 'users';
    byId.aiBtn = parseHTML('<button id="aiBtn"></button>').children[0];
    byId.aiBtn.id = 'aiBtn';
    byId.runBtn = parseHTML('<button id="runBtn"></button>').children[0];
    byId.runBtn.id = 'runBtn';
    byId.checkBtn = parseHTML('<button id="checkBtn"></button>').children[0];
    byId.checkBtn.id = 'checkBtn';
    byId.dryBtn = parseHTML('<button id="dryBtn"></button>').children[0];
    byId.dryBtn.id = 'dryBtn';
    byId.saveBtn = parseHTML('<button id="saveBtn"></button>').children[0];
    byId.saveBtn.id = 'saveBtn';

    const document = {
        getElementById(id) { return byId[id] || null; },
        createElement(tag) { return mkEl(tag); },
        querySelectorAll(sel) {
            if (sel === '#mapBody tr') return mapBody.querySelectorAll('tr');
            return [];
        },
        addEventListener(type, fn) {
            if (type === 'click') docListeners.click++;
            (docHandlers[type] = docHandlers[type] || []).push(fn);
        },
        _docListeners: docListeners,
        _docHandlers: docHandlers,
        _byId: byId,
        _mapBody: mapBody,
    };
    return document;
}

function fireReady(document) {
    (document._docHandlers.DOMContentLoaded || []).forEach((fn) => fn());
}

function flush(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms || 40));
}

class FakeBlob {
    constructor(parts) { this.text = parts.join(''); }
}
class FakeFormData {
    constructor() { this.entries = []; }
    append(k, v, name) { this.entries.push({ k, v, name }); }
    get(k) { const e = this.entries.filter((x) => x.k === k)[0]; return e ? e.v : null; }
    fileName(k) { const e = this.entries.filter((x) => x.k === k)[0]; return e ? e.name : null; }
}

function loadConnector(opts) {
    const document = opts.document;
    const src = fs.readFileSync(opts.jsPath || JS_PATH, 'utf8');
    const fetchLog = [];
    const fetchImpl = opts.fetch || (() => Promise.resolve({
        ok: true, status: 200,
        text: () => Promise.resolve('{}'),
        json: () => Promise.resolve({}),
    }));
    function fetch(url, o) {
        fetchLog.push({ url: String(url), o });
        return fetchImpl(String(url), o);
    }
    const winit = opts.windowInit || {};
    // ключ, явно переданный как undefined, — «шаблон его не задаёт» (#5015)
    const pick = (k, dflt) => (k in winit ? winit[k] : dflt);
    const win = {
        CONNECTOR_DB: winit.CONNECTOR_DB || 'spz',
        CONNECTOR_XSRF: pick('CONNECTOR_XSRF', 'xs1'),
        CONNECTOR_CONFIG: pick('CONNECTOR_CONFIG', 'test-cfg'),
        CONNECTOR_CONNECT_ID: pick('CONNECTOR_CONNECT_ID', 77),
        CONNECTOR_TABLES: pick('CONNECTOR_TABLES', { users: 1, deps: 2 }),
        CONNECTOR_SOURCE_FIELDS: pick('CONNECTOR_SOURCE_FIELDS', {
            users: [['ID', 'Идентификатор'], ['NAME', 'Имя'], ['EMAIL', 'Почта']],
        }),
    };
    const sandbox = {
        window: win,
        document,
        fetch,
        FormData: FakeFormData,
        Blob: FakeBlob,
        Promise, JSON, Math, Object, Array, String, Number, Boolean, Error, Date, RegExp,
        btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
        unescape,
        encodeURIComponent, decodeURIComponent,
        setTimeout, clearTimeout,
        console,
    };
    vm.createContext(sandbox);
    vm.runInContext(src, sandbox);
    fireReady(document);
    return { api: sandbox.window.Connector, document, fetchLog, sandbox, win };
}

function metaOk(reqs) {
    return {
        ok: true, status: 200,
        json: () => Promise.resolve({ val: 't', reqs }),
    };
}

// ============================================================
// 1. loadColumns: truthyRef
// ============================================================
async function testTruthyRef() {
    const document = makeDOM();
    const { api } = loadConnector({
        document,
        fetch: () => Promise.resolve(metaOk([
            { val: 'ref_true', attrs: '', ref: 'true' },
            { val: 'ref_one', attrs: '', ref: 1 },
            { val: 'ref_num', attrs: '', ref: '123' },
            { val: 'ref_zero', attrs: '', ref: '0' },
            { val: 'ref_false', attrs: '', ref: false },
            { val: 'ref_empty', attrs: '', ref: '' },
        ])),
    });
    const m = await api.loadColumns(10);
    assert(m.refCols.ref_true === true, 'loadColumns: ref="true" → ref-колонка');
    assert(m.refCols.ref_one === true, 'loadColumns: ref=1 → ref-колонка');
    assert(m.refCols.ref_num === true, 'loadColumns: ref="123" → ref-колонка');
    assert(m.refCols.ref_zero !== true, 'loadColumns: ref="0" → не ref');
    assert(m.refCols.ref_false !== true, 'loadColumns: ref=false → не ref');
    assert(m.refCols.ref_empty !== true, 'loadColumns: ref="" → не ref');
}

// ============================================================
// 2. loadColumns: alias
// ============================================================
async function testAliases() {
    const document = makeDOM();
    const { api } = loadConnector({
        document,
        fetch: () => Promise.resolve(metaOk([
            { val: 'raw1', attrs: '{"alias":"Фамилия"}', ref: 0 },
            { val: 'raw2', attrs: ':ALIAS=Имя:', ref: 0 },
            { val: 'raw3', attrs: '', ref: 0 },
        ])),
    });
    const m = await api.loadColumns(10);
    assert(m.names.indexOf('Фамилия') >= 0, 'loadColumns: alias из JSON attrs');
    assert(m.names.indexOf('Имя') >= 0, 'loadColumns: alias из :ALIAS=');
    assert(m.names.indexOf('raw3') >= 0, 'loadColumns: без attrs остаётся val');
}

// ============================================================
// 3–5. suggest: ошибки
// ============================================================
async function testSuggestErrors() {
    {
        const document = makeDOM();
        const { api } = loadConnector({
            document,
            fetch: () => Promise.resolve({ ok: false, status: 500, text: () => Promise.resolve('oops') }),
        });
        let err = null;
        try { await api.suggest([['A', 'a']], ['x']); } catch (e) { err = e; }
        assert(err && /HTTP 500/.test(err.message),
            'suggest: HTTP 500 → ошибка со статусом',
            'got: ' + (err && err.message));
    }
    {
        const document = makeDOM();
        const { api } = loadConnector({
            document,
            fetch: () => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('<html>nope') }),
        });
        let err = null;
        try { await api.suggest([['A', 'a']], ['x']); } catch (e) { err = e; }
        assert(err && /неожиданный ответ/.test(err.message),
            'suggest: не-JSON → «неожиданный ответ»',
            'got: ' + (err && err.message));
    }
    {
        const document = makeDOM();
        const { api } = loadConnector({
            document,
            fetch: () => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('{"error":"down"}') }),
        });
        let err = null;
        try { await api.suggest([['A', 'a']], ['x']); } catch (e) { err = e; }
        assert(err && /down/.test(err.message), 'suggest: m.error пробрасывается', 'got: ' + (err && err.message));
    }
    {
        // отказ b24ig.php (эмбеддер не настроен на сервере) — пользователь видит причину, а не только код
        const document = makeDOM();
        const { api } = loadConnector({
            document,
            fetch: () => Promise.resolve({
                ok: false, status: 503,
                text: () => Promise.resolve('{"ok":false,"error":"эмбеддер не настроен: нет адреса (url) в include/b24ig/embedder.json"}'),
            }),
        });
        let err = null;
        try { await api.suggest([['A', 'a']], ['x']); } catch (e) { err = e; }
        assert(err && /HTTP 503/.test(err.message) && /embedder\.json/.test(err.message),
            'suggest: отказ сервера → код и причина', 'got: ' + (err && err.message));
    }
}

// ============================================================
// 6. Полный проход runSuggest
// ============================================================
async function testRunSuggestFlow() {
    const document = makeDOM();
    const matches = [
        { field: 'ID', column: 'Фамилия', score: 0.95, method: 'точное' },
        { field: 'NAME', column: 'НетТакойКолонки', score: 0.90, method: 'точное' },
        { field: 'EMAIL', column: 'Почта', score: 0.55, method: 'модель+fuzzy' },
        { field: 'UF_DEPARTMENT', column: 'Отдел', score: 0.90, method: 'словарь' },
    ];
    const { api, document: doc } = loadConnector({
        document,
        windowInit: {
            CONNECTOR_SOURCE_FIELDS: {
                users: [
                    ['ID', 'Идентификатор'], ['NAME', 'Имя'], ['EMAIL', 'Почта'], ['UF_DEPARTMENT', 'Подразделение'],
                ],
            },
            CONNECTOR_TABLES: { users: 10 },
        },
        fetch: (url) => {
            if (url.indexOf('/metadata/') >= 0) {
                return Promise.resolve(metaOk([
                    { val: 'Фамилия', attrs: '', ref: 0 },
                    { val: 'Имя', attrs: '', ref: 0 },
                    { val: 'Почта', attrs: '', ref: 0 },
                    { val: 'Отдел', attrs: '', ref: 1 },
                ]));
            }
            return Promise.resolve({
                ok: true, status: 200,
                text: () => Promise.resolve(JSON.stringify({ matches })),
            });
        },
    });
    document.getElementById('aiBtn').onclick();
    await flush(50);

    const rows = doc.querySelectorAll('#mapBody tr');
    assert(rows.length === 4, 'runSuggest: 4 строки полей', 'rows=' + rows.length);
    const byName = {};
    rows.forEach((tr) => { byName[tr.dataset.name] = tr; });

    const idVal = byName.ID && byName.ID.querySelector('.val');
    assert(idVal && idVal.value === 'Фамилия', 'матч ID→Фамилия применён', 'val=' + (idVal && idVal.value));

    const nameVal = byName.NAME && byName.NAME.querySelector('.val');
    assert(nameVal && nameVal.value === '',
        'матч с несуществующей колонкой отброшен',
        'val=' + (nameVal && nameVal.value));

    const emailVal = byName.EMAIL && byName.EMAIL.querySelector('.val');
    assert(emailVal && emailVal.value === 'Почта', 'низкий score всё же подставляет колонку', 'val=' + (emailVal && emailVal.value));
    assert(byName.EMAIL && (byName.EMAIL.dataset.low === '1' || byName.EMAIL.classList.contains('row-manual')),
        'score < 0.60 помечает строку на подтверждение',
        'low=' + (byName.EMAIL && byName.EMAIL.dataset.low) + ' class=' + (byName.EMAIL && byName.EMAIL.className));

    const cfg = api.buildConfigFields();
    const dump = JSON.stringify(cfg);
    assert(dump.indexOf('укажите сущность') < 0,
        'buildConfigFields: нет литерала «укажите сущность»',
        dump);
    assert(cfg.needsRef && cfg.needsRef.length === 1 && cfg.needsRef[0].column === 'Отдел',
        'buildConfigFields: ref-колонка в needsRef',
        JSON.stringify(cfg.needsRef));
    assert(cfg.fields.UF_DEPARTMENT && cfg.fields.UF_DEPARTMENT.ref && cfg.fields.UF_DEPARTMENT.ref.entity === '',
        'buildConfigFields: ref.entity — пустая строка',
        JSON.stringify(cfg.fields.UF_DEPARTMENT));
    assert(cfg.manual.indexOf('NAME') >= 0, 'buildConfigFields: отброшенная колонка в manual');
}

// ============================================================
// 7. document-listener: не растёт с числом строк
// ============================================================
async function testNoListenerLeak() {
    const document = makeDOM();
    const fields = [];
    for (let i = 0; i < 8; i++) fields.push(['F' + i, 'Field ' + i]);
    loadConnector({
        document,
        windowInit: {
            CONNECTOR_SOURCE_FIELDS: { users: fields },
            CONNECTOR_TABLES: { users: 10 },
        },
        fetch: (url) => {
            if (url.indexOf('/metadata/') >= 0) {
                return Promise.resolve(metaOk(fields.map((f) => ({ val: f[0], attrs: '', ref: 0 }))));
            }
            return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('{"matches":[]}') });
        },
    });
    const before = document._docListeners.click;
    document.getElementById('aiBtn').onclick();
    await flush(50);
    const after = document._docListeners.click;
    assert(after - before <= 1,
        'document.click: прирост ≤1 на 8 строк, а не 8',
        'before=' + before + ' after=' + after);
}

// ============================================================
// 8. renderRun: HTML в данных экранируется
// ============================================================
async function testRenderRunEscapes() {
    const document = makeDOM();
    const { api } = loadConnector({
        document,
        fetch: () => Promise.resolve({
            ok: true, status: 200,
            json: () => Promise.resolve({
                ok: true,
                entities: {
                    '<img src=x onerror=alert(1)>': { fetched: 1, rows: 2, new: 1, existing: 1, refs_set: 0 },
                },
                errors: [{ kind: 'x', entity: '<b>z</b>', message: '<script>bad</script>' }],
            }),
        }),
    });
    await api.run('');
    // поведение: экранированный вывод после разбора НЕ содержит живых тегов,
    // имя сущности и сообщение ошибки видны как текст
    const parsed = parseHTML('<div>' + document.getElementById('result').innerHTML + '</div>');
    assert(parsed.querySelectorAll('img').length === 0,
        'renderRun: в выводе нет живого <img> (экранировано)');
    assert(parsed.querySelectorAll('script').length === 0,
        'renderRun: в выводе нет живого <script> (экранировано)');
    const asText = parsed.textContent;
    assert(asText.indexOf('<img') >= 0,
        'renderRun: имя сущности видно текстом',
        'textContent=' + asText.slice(0, 220));
    assert(asText.indexOf('<script>') >= 0,
        'renderRun: сообщение ошибки видно текстом',
        'textContent=' + asText.slice(0, 220));
}

// ============================================================
// 9. HTML: порядок кнопок флоу (разбор DOM, не текста)
// ============================================================
function testHtmlButtonOrder() {
    const html = fs.readFileSync(HTML_PATH, 'utf8');
    const m = html.match(/<div class="conn-actions">([\s\S]*?)<\/div>/);
    assert(!!m, 'HTML: блок conn-actions найден');
    if (!m) return;
    const root = parseHTML('<div>' + m[1] + '</div>');
    const btns = root.querySelectorAll('button');
    const ids = btns.map((b) => b.id);
    assert(ids.join(',') === 'checkBtn,dryBtn,runBtn',
        'HTML: кнопки Проверить → Пробный → Запустить',
        'got: ' + ids.join(','));
    const run = btns.filter((b) => b.id === 'runBtn')[0];
    assert(run && run.classList.contains('btn-primary'), 'HTML: «Запустить» — primary');
}

// ============================================================
// 10. Клик по «нет совпадений» не назначает колонку
// ============================================================
async function testEmptyDropdownNotSelectable() {
    const document = makeDOM();
    loadConnector({
        document,
        windowInit: {
            CONNECTOR_SOURCE_FIELDS: { users: [['ZZZ', 'Нет аналога']] },
            CONNECTOR_TABLES: { users: 10 },
        },
        fetch: (url) => {
            if (url.indexOf('/metadata/') >= 0) {
                return Promise.resolve(metaOk([{ val: 'Фамилия', attrs: '', ref: 0 }]));
            }
            return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('{"matches":[]}') });
        },
    });
    document.getElementById('aiBtn').onclick();
    await flush(50);
    const rows = document.querySelectorAll('#mapBody tr');
    assert(rows.length === 1, 'empty-dropdown: строка есть');
    if (!rows.length) return;
    const row = rows[0];
    const inp = row.querySelector('input[role=combobox]');
    const hid = row.querySelector('.val');
    assert(!!inp && !!hid, 'empty-dropdown: комбобокс создан');
    if (!inp || !hid) return;
    inp.value = 'xxx-нет-колонки';
    (inp._handlers.input || []).forEach((fn) => fn());
    const list = row.querySelector('.list');
    assert(!!list, 'empty-dropdown: список открылся');
    if (!list) return;
    const emptyItem = list.querySelectorAll('div').filter((c) =>
        c.classList.contains('cbx-empty') || (c.textContent || '').indexOf('нет совпадений') >= 0)[0];
    assert(!!emptyItem, 'empty-dropdown: показана заглушка',
        'items=' + list.querySelectorAll('div').map((c) => c.textContent).join('|'));
    if (!emptyItem) return;
    emptyItem.click();
    assert(hid.value !== 'нет совпадений',
        'empty-dropdown: клик по заглушке не назначает колонку',
        'hid=' + hid.value);
}

// ============================================================
// 11. markManual сразу после отрисовки
// ============================================================
async function testMarkManualAfterRender() {
    const document = makeDOM();
    loadConnector({
        document,
        windowInit: {
            CONNECTOR_SOURCE_FIELDS: { users: [['A', 'a'], ['B', 'b']] },
            CONNECTOR_TABLES: { users: 10 },
        },
        fetch: (url) => {
            if (url.indexOf('/metadata/') >= 0) {
                return Promise.resolve(metaOk([
                    { val: 'A', attrs: '', ref: 0 },
                    { val: 'B', attrs: '', ref: 0 },
                ]));
            }
            return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('{"matches":[]}') });
        },
    });
    document.getElementById('aiBtn').onclick();
    await flush(50);
    const rows = document.querySelectorAll('#mapBody tr');
    assert(rows.length === 2, 'markManual: 2 строки');
    const allManual = rows.every((tr) => tr.classList.contains('row-manual'));
    assert(allManual, 'markManual: пустые строки сразу ручные',
        rows.map((tr) => tr.className).join(' | '));
}

// ============================================================
// 12. run(): кнопки блокируются на время запроса
// ============================================================
async function testBusyLock() {
    const document = makeDOM();
    let resolveFetch;
    const gate = new Promise((r) => { resolveFetch = r; });
    const { api } = loadConnector({
        document,
        fetch: () => gate.then(() => ({
            ok: true, status: 200,
            json: () => Promise.resolve({ ok: true, entities: {}, errors: [] }),
        })),
    });
    const p = api.run('check');
    await flush(10);
    assert(document.getElementById('runBtn').disabled === true,
        'busy: кнопки заблокированы на время запроса',
        'disabled=' + document.getElementById('runBtn').disabled);
    resolveFetch();
    await p;
    assert(document.getElementById('runBtn').disabled === false,
        'busy: кнопки разблокированы после ответа',
        'disabled=' + document.getElementById('runBtn').disabled);
}

// ============================================================
// 13+. #5015: всё база-специфичное — из конфига базы, правка доходит до запуска
// ============================================================
const ACME_CFG = {
    version: 1,
    project: 'acme',
    entities: {
        users: {
            target: { table: 'Юзеры', table_id: 55, key: '@name' },
            fields: {
                ID: { column: '@name' },
                NAME: { column: 'Имя', transform: 'trim' },
                'NAME@x': { column: 'X', from: 'NAME' },
                DEPT: { column: 'Отдел', ref: { entity: 'deps', by: 'key', missing: 'skip' } },
            },
        },
        deps: { target: { table: 'Отделы', table_id: 66, key: '@name' }, fields: { NAME: { column: '@name' } } },
    },
};

// Сервер: dir_admin (листинг, gf, upload), метаданные, b24ig.php (подбор action=match и запуск).
function fakeServer(o) {
    o = o || {};
    const st = { uploads: [], cfgText: JSON.stringify(ACME_CFG, null, 2) };
    const text = (t, ok) => Promise.resolve({
        ok: ok !== false, status: ok === false ? 500 : 200,
        text: () => Promise.resolve(t), json: () => Promise.resolve(JSON.parse(t)),
    });
    st.fetch = (url, opt) => {
        if (url.indexOf('/dir_admin/') >= 0 && opt && opt.method === 'POST') {
            const fd = opt.body;
            if (o.uploadFails) return text('Недостаточно прав для загрузки файлов');
            st.uploads.push({
                name: fd.fileName('userfile'), body: fd.get('userfile').text,
                rewrite: fd.get('rewrite'), xsrf: fd.get('_xsrf'), addPath: fd.get('add_path'),
            });
            if (fd.fileName('userfile') === 'acme.json') st.cfgText = fd.get('userfile').text;
            return text('{"ok":true,"action":"upload"}');
        }
        if (url.indexOf('/dir_admin/') >= 0 && url.indexOf('gf=acme.json') >= 0) return text(st.cfgText);
        if (url.indexOf('/dir_admin/') >= 0) {
            return text('<table>' +
                '<tr><td><a href="/spz/dir_admin/?templates=1&add_path=/connector&gf=acme.json">acme.json</a></td></tr>' +
                '<tr><td><a href="/spz/dir_admin/?templates=1&add_path=/connector&gf=secrets.json">secrets.json</a></td></tr>' +
                '<tr><td><a href="/spz/dir_admin/?templates=1&add_path=/connector&gf=run.log">run.log</a></td></tr>' +
                '</table>');
        }
        if (url.indexOf('/metadata/') >= 0) {
            return Promise.resolve(metaOk([
                { val: 'Имя', attrs: '', ref: 0 },
                { val: 'Почта', attrs: '', ref: 0 },
                { val: 'Отдел', attrs: '', ref: 1 },
                { val: 'Руководитель', attrs: '', ref: 1 },
            ]));
        }
        if (url.indexOf('/b24ig.php?action=match') >= 0) {
            return text(JSON.stringify({ ok: true, matches: o.matches || [] }));
        }
        if (url.indexOf('/b24ig.php') >= 0) return text('{"ok":true,"entities":{},"errors":[]}');
        return text('{}');
    };
    return st;
}

function loadFromConfig(srv) {
    const document = makeDOM();
    const r = loadConnector({
        document,
        windowInit: {
            CONNECTOR_CONFIG: undefined, CONNECTOR_TABLES: undefined,
            CONNECTOR_SOURCE_FIELDS: undefined, CONNECTOR_CONNECT_ID: undefined,
        },
        fetch: srv.fetch,
    });
    return r;
}

// запуск коннектора — b24ig.php без action=match (подбор полей идёт туда же, но это не запуск)
function isRun(x) {
    return x.url.indexOf('/b24ig.php') >= 0 && x.url.indexOf('action=match') < 0;
}

function rowsByName(document) {
    const by = {};
    document.querySelectorAll('#mapBody tr').forEach((tr) => { by[tr.dataset.name] = tr; });
    return by;
}

function typeInto(tr, text) {
    if (!tr) return;
    const inp = tr.querySelector('input[role=combobox]');
    inp.value = text;
    (inp._handlers.input || []).forEach((fn) => fn());
}

async function testConfigFromBase() {
    const srv = fakeServer({ matches: [{ field: 'NAME', column: 'Имя', score: 0.97, method: 'точное' }] });
    const { document, fetchLog } = loadFromConfig(srv);
    await flush(60);
    assert(fetchLog.some((f) => /dir_admin\/\?templates=1&add_path=\/connector&gf=acme\.json/.test(f.url)),
        '#5015: конфиг читается из templates/custom/<база>/connector через dir_admin',
        fetchLog.map((f) => f.url).join(' | '));
    const opts = document.getElementById('entities').querySelectorAll('option').map((x) => x.attrs.value);
    assert(opts.join(',') === 'users,deps', '#5015: сущности — из конфига', 'options=' + opts.join(','));

    document.getElementById('aiBtn').onclick();
    await flush(60);
    assert(fetchLog.some((f) => f.url.indexOf('/spz/metadata/55') >= 0),
        '#5015: table_id — из конфига (55)', fetchLog.map((f) => f.url).join(' | '));
    // подбор — через b24ig.php: адрес эмбеддера в конфиге базы на сервере, id записи-«Коннектора» не нужен
    const m = fetchLog.find((f) => f.url === '/b24ig.php?action=match&db=spz&config=acme');
    const body = m && m.o && m.o.method === 'POST' ? JSON.parse(m.o.body) : null;
    assert(body && body.target.join(',') === 'Имя,Почта,Отдел,Руководитель' &&
        body.source.map((x) => x[0]).join(',') === 'ID,NAME,DEPT',
        'подбор: POST b24ig.php?action=match базы и конфига, source — поля конфига, target — колонки таблицы',
        fetchLog.map((f) => f.url).join(' | '));
    const by = rowsByName(document);
    assert(Object.keys(by).join(',') === 'ID,NAME,DEPT',
        '#5015: поля источника — ключи fields без производных X@y', Object.keys(by).join(','));
    assert(by.DEPT && by.DEPT.querySelector('.val').value === 'Отдел',
        '#5015: без подсказки AI остаётся колонка из конфига',
        'DEPT=' + (by.DEPT && by.DEPT.querySelector('.val').value));
}

async function testEditReachesRun() {
    const srv = fakeServer();
    const { document, fetchLog } = loadFromConfig(srv);
    await flush(60);
    document.getElementById('aiBtn').onclick();
    await flush(60);
    typeInto(rowsByName(document).NAME, 'Почта');
    document.getElementById('runBtn').onclick();
    await flush(60);

    const cfgUp = srv.uploads.filter((u) => u.name === 'acme.json')[0];
    assert(!!cfgUp, '#5015: «Запустить» после правки сначала сохраняет конфиг',
        'uploads=' + srv.uploads.map((u) => u.name).join(','));
    if (!cfgUp) return;
    const saved = JSON.parse(cfgUp.body);
    const f = saved.entities.users.fields;
    assert(f.NAME.column === 'Почта', '#5015: в конфиг ушла поправленная колонка', JSON.stringify(f.NAME));
    assert(f.NAME.transform === 'trim', '#5015: transform существующего поля сохранён', JSON.stringify(f.NAME));
    assert(f['NAME@x'] && f['NAME@x'].from === 'NAME', '#5015: производное поле X@y не тронуто');
    assert(f.DEPT.ref && f.DEPT.ref.entity === 'deps', '#5015: ref существующего поля сохранён');
    assert(saved.entities.deps.fields.NAME.column === '@name', '#5015: другие сущности не тронуты');
    assert(cfgUp.rewrite === '1' && cfgUp.xsrf === 'xs1' && cfgUp.addPath === '/connector',
        '#5015: заливка — rewrite + _xsrf в каталог connector', JSON.stringify(cfgUp));
    const bak = srv.uploads[0];
    assert(bak && /^acme\.json\..+\.bak$/.test(bak.name) && bak.body === JSON.stringify(ACME_CFG, null, 2),
        '#5015: перед перезаписью — копия прежнего конфига', bak && bak.name);
    const upIdx = fetchLog.findIndex((x) => x.o && x.o.method === 'POST' && x.url.indexOf('/dir_admin/') >= 0);
    const runIdx = fetchLog.findIndex(isRun);
    assert(upIdx >= 0 && runIdx > upIdx, '#5015: запуск идёт после сохранения', 'up=' + upIdx + ' run=' + runIdx);
    assert(runIdx >= 0 && fetchLog[runIdx].url.indexOf('config=acme') >= 0, '#5015: запуск — по этому конфигу',
        runIdx >= 0 ? fetchLog[runIdx].url : '');
}

async function testSaveFailureBlocksRun() {
    const srv = fakeServer({ uploadFails: true });
    const { document, fetchLog } = loadFromConfig(srv);
    await flush(60);
    document.getElementById('aiBtn').onclick();
    await flush(60);
    typeInto(rowsByName(document).NAME, 'Почта');
    document.getElementById('runBtn').onclick();
    await flush(60);
    assert(!fetchLog.some(isRun),
        '#5015: сохранение не удалось — запуска старого конфига нет');
    assert(/Недостаточно прав/.test(document.getElementById('result').textContent),
        '#5015: причина отказа видна', document.getElementById('result').textContent);
}

async function testRefWithoutEntityBlocksSave() {
    const srv = fakeServer();
    const { document } = loadFromConfig(srv);
    await flush(60);
    document.getElementById('aiBtn').onclick();
    await flush(60);
    typeInto(rowsByName(document).NAME, 'Руководитель');   // ref-колонка, сущность не известна
    document.getElementById('saveBtn').onclick();
    await flush(60);
    assert(srv.uploads.length === 0, '#5015: ref-колонка без сущности не пишется заглушкой',
        'uploads=' + srv.uploads.map((u) => u.name).join(','));
    assert(/Руководитель/.test(document.getElementById('mapHint').textContent),
        '#5015: подсказка называет колонку', document.getElementById('mapHint').textContent);
}

async function testComboboxTypedAndManualLow() {
    const srv = fakeServer({ matches: [{ field: 'NAME', column: 'Почта', score: 0.4, method: 'модель' }] });
    const { document } = loadFromConfig(srv);
    await flush(60);
    document.getElementById('aiBtn').onclick();
    await flush(60);
    const tr = rowsByName(document).NAME;
    if (!tr) { assert(false, 'combobox: строка NAME есть'); return; }
    assert(tr.dataset.low === '1', 'combobox: низкий score помечен');
    // ручной выбор из списка снимает «низкий»
    const inp = tr.querySelector('input[role=combobox]');
    (inp._handlers.focus || []).forEach((fn) => fn());
    const item = tr.querySelector('.list').querySelectorAll('div').filter((d) => d.textContent === 'Почта')[0];
    item.click();
    assert(tr.dataset.low !== '1' && !tr.classList.contains('row-manual'),
        'combobox: ручной выбор подтверждает строку', 'low=' + tr.dataset.low + ' class=' + tr.className);
    // точное имя, набранное руками, принимается
    typeInto(tr, 'Имя');
    assert(tr.querySelector('.val').value === 'Имя', 'combobox: набранное точное имя колонки принято',
        'val=' + tr.querySelector('.val').value);
    typeInto(tr, 'Им');
    assert(tr.querySelector('.val').value === '', 'combobox: неполное имя не принимается');
}

function testTemplateHasNoBaseSpecifics() {
    // исполняем инлайн-скрипт шаблона и смотрим, что он кладёт в window
    const html = fs.readFileSync(HTML_PATH, 'utf8');
    const inline = (html.match(/<script>([\s\S]*?)<\/script>/g) || [])
        .map((s) => s.replace(/^<script>|<\/script>$/g, '')).join('\n');
    const win = {};
    const stub = { classList: { toggle() {} }, dataset: {}, set onclick(v) {} };
    const sandbox = {
        window: win,
        document: { getElementById: () => stub, querySelectorAll: () => [] },
    };
    vm.createContext(sandbox);
    vm.runInContext(inline, sandbox);
    assert(win.CONNECTOR_DB === '{_global_.z}', 'шаблон: имя базы — из оболочки');
    assert(win.CONNECTOR_XSRF === '{_global_.xsrf}', 'шаблон: XSRF — из оболочки');
    const baked = ['CONNECTOR_CONFIG', 'CONNECTOR_TABLES', 'CONNECTOR_SOURCE_FIELDS', 'CONNECTOR_CONNECT_ID']
        .filter((k) => win[k] !== undefined);
    assert(baked.length === 0, '#5015: шаблон не зашивает конфиг/таблицы/поля/CONNECT_ID одной базы',
        'заданы: ' + baked.join(','));
}

(async function main() {
    await testTruthyRef();
    await testAliases();
    await testSuggestErrors();
    await testRunSuggestFlow();
    await testNoListenerLeak();
    await testRenderRunEscapes();
    testHtmlButtonOrder();
    await testEmptyDropdownNotSelectable();
    await testMarkManualAfterRender();
    await testBusyLock();
    await testConfigFromBase();
    await testEditReachesRun();
    await testSaveFailureBlocksRun();
    await testRefWithoutEntityBlocksSave();
    await testComboboxTypedAndManualLow();
    testTemplateHasNoBaseSpecifics();

    console.log('\n' + (failed ? 'FAIL' : 'OK') + ': ' + passed + '/' + total + ' проверок');
    process.exit(failed ? 1 : 0);
})();
