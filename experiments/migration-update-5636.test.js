// issue #5636: пакет миграции (templates/migration.html) — три поломки из эксперимента #5635.
//  п.1 файлы экрана разворачиваются с именем и id базы-источника;
//  п.2 пользователь теряет роль (роли и права не переносились);
//  п.3 пакет новой версии поверх живой базы создаёт копию «Имя 1» вместо обновления.
// Настоящий скрипт шаблона гоняется против модели ядра: metadata, object/{t}?JSON_OBJ (F_U),
// _d_*/_m_*, dir_admin (gf отдаёт файл вложением, иначе текст «Файл не найден»).
// Модель повторяет форму ответов, снятую с ideav.ru/exp5635a 23.11.2026: роль 42 (r: имя,
// число прав, число пунктов меню, описание), право 116 под ролью (r[0] = «id:имя объекта»,
// уровень 136 — ссылка на 47 «54:WRITE»), меню 151 под ролью.
// MIG_HTML=<путь> — прогнать тот же сценарий на другой версии страницы (проверка «был красным»).
const test = require('node:test');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const htmlPath = process.env.MIG_HTML || path.join(__dirname, '..', 'templates', 'migration.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const mainScript = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).find((s) => s.indexOf('doExport') > -1);

const SERVICE_META = [
    { id: '18', type: '3', val: 'Пользователь', reqs: [
        { id: '115', val: 'Роль', orig: '42', type: '3', ref: '42', ref_id: '115' },
        { id: '33', val: 'Имя', orig: '33', type: '3' }] },
    { id: '22', type: '3', val: 'Запрос', reqs: [
        { id: '99', val: 'Колонки запроса', orig: '28', type: '16', arr_id: '28' },
        { id: '134', val: 'LIMIT', orig: '134', type: '3' },
        { id: '111', val: 'Сформировать', orig: '110', type: '3' }] },
    { id: '28', type: '16', val: 'Колонки запроса', reqs: [
        { id: '100', val: 'Имя в отчете', orig: '100', type: '3' },
        { id: '102', val: 'Значение (от)', orig: '102', type: '3' },
        { id: '104', val: 'Функция', orig: '63', type: '3', ref: '63', ref_id: '104' }] },
    { id: '42', type: '3', val: 'Роль', reqs: [
        { id: '117', val: 'Объекты', orig: '116', type: '5', arr_id: '116' },
        { id: '154', val: 'Меню', orig: '151', type: '3', arr_id: '151' },
        { id: '135', val: 'Описание', orig: '135', type: '12' }] },
    { id: '116', type: '3', val: 'Объекты', reqs: [
        { id: '136', val: 'Доступ', orig: '47', type: '3', ref: '47', ref_id: '136' },
        { id: '49', val: 'Маска', orig: '49', type: '3' },
        { id: '55', val: 'EXPORT', orig: '55', type: '11' },
        { id: '56', val: 'DELETE', orig: '56', type: '11' }] },
    { id: '151', type: '3', val: 'Меню', reqs: [
        { id: '153', val: 'Адрес', orig: '153', type: '8' },
        { id: '391', val: 'Иконка', orig: '391', type: '8' }] }
];
const svcMeta = (t) => SERVICE_META.find((x) => x.id === String(t));
const SVC_RECORDS = { '145': ['42', 'admin'], '164': ['42', 'user'], '52': ['47', 'BARRED'], '53': ['47', 'READ'], '54': ['47', 'WRITE'], '74': ['63', 'COUNT'] };

// ---- модель ядра одной базы ----
function makeCore(name, firstId) {
    let nextId = firstId;
    const terms = {};   // id -> { t, val, unique, isTable }
    const refDefs = {}; // id строки-определения -> id таблицы-цели
    const reqs = {};    // id -> { up, t, fa }
    const records = {}; // id -> { type, up, val, params }
    const files = {};   // 'root|dir|name' -> content
    Object.keys(SVC_RECORDS).forEach((id) => { records[id] = { type: SVC_RECORDS[id][0], up: '1', val: SVC_RECORDS[id][1], params: {} }; });
    const nid = () => String(nextId++);
    const core = { name, terms, refDefs, reqs, records, files, posts: [] };

    core.table = (val, base = 3) => { const id = nid(); terms[id] = { t: String(base), val, unique: '0', isTable: true }; return id; };
    core.term = (val, base = 3) => { const id = nid(); terms[id] = { t: String(base), val, unique: '0' }; return id; };
    core.col = (table, t, fa = {}) => { const id = nid(); reqs[id] = { up: String(table), t: String(t), fa: Object.assign({ required: false, multi: false, key: false, alias: null, default: '' }, fa) }; return id; };
    core.ref = (target) => { const hit = Object.keys(refDefs).find((k) => refDefs[k] === String(target)); if (hit) return hit; const id = nid(); refDefs[id] = String(target); return id; };
    core.rec = (type, up, val, params = {}) => {
        const id = nid();
        const ord = 1 + Math.max(0, ...Object.values(records).filter((r) => r.type === String(type) && r.up === String(up)).map((r) => r.ord || 0));
        records[id] = { type: String(type), up: String(up), val, params: Object.assign({}, params), ord };
        return id;
    };
    core.ordered = (type, up) => core.of(type, up).sort((a, b) => records[a].ord - records[b].ord);
    core.of = (type, up) => Object.keys(records).filter((id) => records[id].type === String(type) && (up == null || records[id].up === String(up)));
    core.termsNamed = (val) => Object.keys(terms).filter((id) => terms[id].val === val);
    core.colsOf = (table) => Object.keys(reqs).filter((r) => reqs[r].up === String(table));
    core.label = (r) => reqs[r].fa.alias || (terms[reqs[r].t] ? terms[reqs[r].t].val : terms[refDefs[reqs[r].t]].val);

    function reqMeta(r) {
        const q = reqs[r];
        const out = { id: r, field_attrs: q.fa };
        if (refDefs[q.t]) { const tg = refDefs[q.t]; Object.assign(out, { val: terms[tg].val, orig: tg, type: terms[tg].t, ref: tg, ref_id: q.t }); }
        else if (terms[q.t].isTable) Object.assign(out, { val: terms[q.t].val, orig: q.t, type: terms[q.t].t, arr_id: q.t });
        else Object.assign(out, { val: terms[q.t].val, orig: q.t, type: terms[q.t].t });
        return out;
    }
    core.metadata = () => SERVICE_META.concat(Object.keys(terms).filter((id) => terms[id].isTable).map((id) => {
        const t = { id, up: '0', type: terms[id].t, val: terms[id].val, unique: terms[id].unique, reqs: core.colsOf(id).map(reqMeta) };
        const rd = Object.keys(refDefs).find((k) => refDefs[k] === id);
        if (rd) t.referenced = rd;
        return t;
    }));
    const metaOf = (type) => svcMeta(type) || core.metadata().find((t) => t.id === String(type));
    function cell(req, rec, recId) {
        if (req.arr_id) return String(core.of(req.arr_id, recId).length);
        const v = rec.params[req.id];
        if (v == null || v === '') return '';
        if (req.ref) return String(v) + ':' + String(v).split(',').map((x) => (records[x] ? records[x].val : '?')).join(',');
        return String(v);
    }
    function row(id) {
        const rec = records[id];
        const m = metaOf(rec.type);
        let main = rec.val;
        if (rec.type === '28' && reqs[main]) main = main + ':' + core.label(main);
        if (rec.type === '116') main = main + ':' + (terms[main] ? terms[main].val : reqs[main] ? core.label(main) : records[main] ? records[main].val : main);
        return { i: Number(id), u: Number(rec.up), o: rec.ord, r: [main].concat(((m && m.reqs) || []).map((q) => cell(q, rec, id))) };
    }
    function refTargetOf(type, reqId) {
        const s = svcMeta(type);
        if (s) { const q = s.reqs.find((x) => x.id === String(reqId)); return q ? q.ref || null : null; }
        const q = reqs[reqId];
        return q && refDefs[q.t] ? refDefs[q.t] : null;
    }
    function resolveRef(target, value) {
        if (/^\d+(,\d+)*$/.test(value)) return value;
        const hit = Object.keys(records).find((id) => records[id].type === String(target) && records[id].val === value);
        if (hit) return hit;
        return core.rec(target, 1, value);
    }
    core.records = records;
    core.row = row; core.refTargetOf = refTargetOf; core.resolveRef = resolveRef;
    return core;
}

function apiGet(core, rel) {
    const [p, q = ''] = rel.split('?');
    const params = new URLSearchParams(q);
    if (p === 'metadata') return { json: core.metadata() };
    if (p === 'dir_admin/') {
        const root = params.has('templates') ? 'templates' : 'download';
        const dir = (params.get('add_path') || '').replace(/^\/+/, '');
        if (params.has('gf')) {
            const key = root + '|' + dir + '|' + params.get('gf');
            if (key in core.files) return { raw: core.files[key], headers: { 'Content-Disposition': 'attachment; filename=' + params.get('gf') } };
            return { raw: 'Файл не найден' };
        }
        const names = Object.keys(core.files).filter((k) => k.startsWith(root + '|' + dir + '|')).map((k) => k.split('|')[2]);
        return { raw: names.map((n) => '<a href="?' + root + '=1&gf=' + encodeURIComponent(n) + '">' + n + '</a>').join('') };
    }
    const m = p.match(/^object\/(\d+)$/);
    if (!m) return { json: null };
    let ids = core.of(m[1]);
    if (params.has('F_U')) { const fu = params.get('F_U'); ids = fu === '0' ? ids : ids.filter((id) => core.records[id].up === fu); }
    else ids = ids.filter((id) => core.records[id].up === '1');
    return { json: ids.sort((a, b) => (core.records[a].up === core.records[b].up ? core.records[a].ord - core.records[b].ord : a - b)).map(core.row) };
}

async function apiPost(core, rel, body) {
    const [p] = rel.split('?');
    if (p === 'dir_admin/') { // FormData
        const root = body.has('templates') ? 'templates' : 'download';
        const dir = String(body.get('add_path') || '').replace(/^\/+/, '');
        if (body.get('delete')) { body.getAll('del[]').forEach((n) => { delete core.files[root + '|' + dir + '|' + n]; }); return { json: {} }; }
        const f = body.get('userfile');
        core.files[root + '|' + dir + '|' + f.name] = await f.text();
        return { json: {} };
    }
    const b = Object.fromEntries(new URLSearchParams(body));
    const [action, id] = p.split('/');
    core.posts.push({ action, id, body: b });
    const { terms, reqs, records, refDefs } = core;
    if (action === '_d_new') {
        const hit = Object.keys(terms).find((k) => terms[k].val === b.val && terms[k].t === String(b.t));
        if (hit) return { json: { obj: hit, warnings: 'Тип ' + b.val + ' уже существует!' } };
        const t = core.term(b.val, b.t); return { json: { obj: t } };
    }
    if (action === '_d_save') { if (!terms[id]) return { json: [{ error: 'Тип не найден.' }] }; terms[id].unique = b.unique ? '1' : '0'; return { json: { obj: id } }; }
    if (action === '_d_ref') { if (terms[id]) terms[id].isTable = true; return { json: { obj: core.ref(id) } }; }
    if (action === '_d_req') {
        if (terms[id]) terms[id].isTable = true;
        const hit = Object.keys(reqs).find((k) => reqs[k].up === String(id) && reqs[k].t === String(b.t));
        if (hit) return { json: { id: hit, obj: id, warnings: 'Реквизит уже существует!' } };
        return { json: { id: core.col(id, b.t), obj: id } };
    }
    if (action === '_d_alias') { reqs[id].fa.alias = b.val; return { json: { id: reqs[id].up, obj: reqs[id].up } }; }
    if (action === '_d_attrs') {
        Object.assign(reqs[id].fa, { alias: b.alias || null, default: b.val || '', multi: !!b.multi, key: !!b.key, required: !!b.set_null });
        return { json: { id: reqs[id].up, obj: reqs[id].up } };
    }
    if (action === '_d_action') { reqs[id].fa.action = b.action ? JSON.parse(b.action) : null; return { json: { obj: reqs[id].up } }; }
    if (action === '_d_del_req') { delete reqs[id]; return { json: { obj: id } }; }
    if (action === '_d_del') {
        if (Object.keys(reqs).some((r) => reqs[r].t === id) || Object.keys(records).some((r) => records[r].type === id)) return { raw: 'Тип используется' };
        delete terms[id]; delete refDefs[id]; return { json: { obj: id } };
    }
    if (action === '_m_del') { delete records[id]; return { json: { id } }; }
    if (action === '_m_ord') { // index.php case "_m_ord": запись встаёт на место order, соседи сдвигаются
        const r = records[id], n = Math.min(Number(b.order), Math.max(...core.of(r.type, r.up).map((x) => records[x].ord)));
        core.of(r.type, r.up).forEach((x) => { const o = records[x].ord; if (x !== id && o >= Math.min(r.ord, n) && o <= Math.max(r.ord, n)) records[x].ord += Math.sign(r.ord - n); });
        r.ord = n; return { json: { id: r.up, obj: r.up } };
    }
    if (action === '_m_id') { // index.php case "_m_id": записи даётся заданный свободный id
        if (records[b.new_id] || terms[b.new_id]) return { raw: 'Новый id занят' };
        records[b.new_id] = records[id]; delete records[id];
        Object.values(records).forEach((r) => { if (r.up === String(id)) r.up = String(b.new_id); });
        return { json: { id: b.new_id, obj: b.new_id } };
    }
    if (action === '_m_new' || action === '_m_set') {
        if (action === '_m_set' && !records[id]) return { json: [{ error: 'нет записи ' + id }] };
        if (action === '_m_new' && terms[id]) terms[id].isTable = true;
        const rec = action === '_m_new' ? { type: String(id), up: String(b.up), val: b['t' + id], params: {} } : records[id];
        if (action === '_m_set') { // ответы ideav.ru 23.11.2026 (index.php:14917, Check_Grant 3400)
            if (rec.type === '28' && ('t28' in b)) return { raw: 'У вас нет доступа к реквизиту объекта: ' + id + ', 28 () или его родителю  ()!' };
            const bad = Object.keys(b).find((k) => { const mm = k.match(/^t(d+)$/); return mm && core.refTargetOf(rec.type, mm[1]) && b[k] !== '' && !/^d+(,d+)*$/.test(b[k]); });
            if (bad) return { raw: 'Ссылка должна быть id записи: ' + bad + ' = ' + b[bad] };
        }
        Object.keys(b).forEach((k) => {
            const mm = k.match(/^t(\d+)$/);
            if (!mm || mm[1] === rec.type) return;
            const target = core.refTargetOf(rec.type, mm[1]);
            rec.params[mm[1]] = target && b[k] !== '' ? core.resolveRef(target, String(b[k])) : String(b[k]);
        });
        if (action === '_m_set') return { json: { id, obj: id } };
        const nr = core.rec(rec.type, rec.up, rec.val, rec.params);
        return { json: { id: nr, obj: nr } };
    }
    return { json: { id, obj: id } };
}

// ---- страница миграции в поддельном окне ----
function makeEl(id) {
    return { id, value: '', checked: false, disabled: false, innerHTML: '', textContent: '', className: '', style: {},
        scrollTop: 0, scrollHeight: 0, _h: {}, addEventListener(type, fn) { this._h[type] = fn; }, appendChild(c) { (this.kids = this.kids || []).push(c); } };
}
function openPage(core, checks, opts = {}) {
    const els = {};
    const el = (id) => (els[id] || (els[id] = makeEl(id)));
    el('mig-threshold').value = '460';
    el('mig-mode-update').checked = !!opts.update;
    el('mig-mode-install').checked = !opts.update;
    const boxes = Object.keys(checks).map((k) => {
        const [cls, key] = k.split(':');
        return Object.assign(makeEl(k), { cls, checked: checks[k], getAttribute: () => key });
    });
    const store = opts.store || {};
    const prefix = '/' + core.name + '/';
    const ctx = {
        console: { log() {}, warn() {}, error: console.error },
        db: core.name, token: 'tok', xsrf: 'xs', role: 'admin',
        location: { pathname: prefix + 'migration' },
        URLSearchParams, FormData, Blob, setTimeout, Promise, JSON,
        localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
        confirm: () => true,
        DOMParser: function () { this.parseFromString = (h) => ({ querySelectorAll: () => [...String(h).matchAll(/href="([^"]*)"/g)].map((m) => ({ getAttribute: () => m[1].replace(/&amp;/g, '&') })) }); },
        document: { getElementById: el, createElement: () => makeEl('x'), querySelectorAll: (sel) => boxes.filter((b) => '.' + b.cls === sel) },
        fetch: async (url, o) => {
            const rel = String(url).slice(prefix.length);
            const out = o && o.method === 'POST' ? await apiPost(core, rel, o.body) : apiGet(core, rel);
            const h = out.headers || {};
            return { ok: true, status: 200, headers: { get: (k) => h[k] || null }, text: async () => ('raw' in out ? out.raw : JSON.stringify(out.json)) };
        }
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    vm.runInContext(mainScript, ctx);
    const logText = () => (el('mig-log').kids || []).map((k) => k.textContent).join('\n');
    return { el, store, logText };
}
const ALL_EXP = { 'mig-exp:data': true, 'mig-exp:queries': true, 'mig-exp:roles': true, 'mig-exp:users': true, 'mig-exp:menus': true, 'mig-exp:files': true };
const ALL_IMP = { 'mig-imp:tables': true, 'mig-imp:data': true, 'mig-imp:queries': true, 'mig-imp:roles': true, 'mig-imp:menus': true, 'mig-imp:files': true, 'mig-imp:users': true };
async function exportPkg(core) {
    const page = openPage(core, ALL_EXP);
    await page.el('mig-export-btn')._h.click();
    return page.el('mig-export-json').value;
}
async function importPkg(core, json, opts = {}) {
    const page = openPage(core, ALL_IMP, opts);
    page.el('mig-import-json').value = json;
    await page.el('mig-import-btn')._h.click();
    return page;
}
async function rollback(core, store) {
    const page = openPage(core, ALL_IMP, { store });
    await page.el('mig-rollback-btn')._h.click();
    return page;
}

// ---- эталон v1: таблица «Отметка смены», справочник линий, запрос, гость с правами, экран ----
function etalonV1() {
    const a = makeCore('exp5635a', 460);
    const x = { a };
    x.lines = a.table('Справочник линий');
    x.L1 = a.rec(x.lines, 1, 'Л1'); x.L2 = a.rec(x.lines, 1, 'Л2');
    x.mark = a.table('Отметка смены');
    x.lineCol = a.col(x.mark, a.ref(x.lines), { alias: 'Линия', required: true });
    x.parCol = a.col(x.mark, a.term('Параметр'));
    x.valT = a.term('Значение', 13);
    x.valCol = a.col(x.mark, x.valT);
    const p = (l, par, v) => { const o = {}; o[x.lineCol] = l; o[x.parCol] = par; o[x.valCol] = v; return o; };
    a.rec(x.mark, 1, '22.11.2026', p(x.L1, 'температура', '5'));
    a.rec(x.mark, 1, '22.11.2026', p(x.L2, 'давление', '7'));
    x.q = a.rec(22, 1, 'Отметки по линии', { 134: '50' });
    x.qc = a.rec(28, x.q, x.lineCol, { 100: 'Линия' });
    x.qc2 = a.rec(28, x.q, x.valCol, { 100: 'Кол-во', 104: '74' });
    x.qc3 = a.rec(28, x.q, x.parCol, { 100: 'Параметр' });
    x.guest = a.rec(42, 1, 'Гость', { 135: 'Доступ без входа' });
    a.rec(116, x.guest, x.mark, { 136: '54', 49: '@0' });
    a.rec(116, x.guest, x.lineCol, { 136: '54', 49: '@IN(' + x.L1 + ',' + x.L2 + ')' });
    a.rec(116, x.guest, x.q, { 136: '53' });
    a.rec(18, 1, 'guest', { 115: x.guest });
    a.rec(151, x.guest, 'Чек-лист смены', { 153: 'checklist' });
    a.files['templates||checklist.html'] = '<div style="width:500px"></div>\n<script src="/download/exp5635a/checklist.js?2"></script>\n';
    x.js = () => "var BASE = '/exp5635a/', T = " + x.mark + ', Q = ' + x.q + ';\nvar K = { line: ' + x.lineCol + ', par: ' + x.parCol + ' };\n' +
        "fetch(BASE + 'report/' + Q + '?JSON_KV&FR_" + x.lineCol + "=1');\nsetTimeout(load, 500);\n";
    a.files['download||checklist.js'] = x.js();
    return x;
}
const fileOf = (core, key) => core.files[key];

test('#5636 п.1: экран у клиента обращается к своей базе и к своим id', async () => {
    const x = etalonV1();
    const c = makeCore('exp5635c', 900);
    const page = await importPkg(c, await exportPkg(x.a));
    const js = fileOf(c, 'download||checklist.js');
    const html = fileOf(c, 'templates||checklist.html');
    assert.ok(js && html, 'файлы экрана развёрнуты');
    assert.ok(js.indexOf('exp5635a') === -1 && html.indexOf('exp5635a') === -1, 'имени базы-источника в файлах нет:\n' + js + html);
    assert.ok(html.indexOf('/download/exp5635c/checklist.js?2') > -1, 'скрипт грузится из каталога клиента');
    const mark = c.termsNamed('Отметка смены')[0];
    const lineCol = c.colsOf(mark).find((r) => c.label(r) === 'Линия');
    const parCol = c.colsOf(mark).find((r) => c.label(r) === 'Параметр');
    const q = c.of(22).find((id) => c.records[id].val === 'Отметки по линии');
    assert.notStrictEqual(mark, x.mark, 'id таблицы у клиента другой — проверка не вырождена');
    assert.ok(js.indexOf("'/exp5635c/'") > -1, 'BASE клиента');
    assert.ok(js.indexOf('T = ' + mark + ',') > -1, 'id таблицы клиента:\n' + js);
    assert.ok(js.indexOf('Q = ' + q + ';') > -1, 'id запроса клиента');
    assert.ok(js.indexOf('line: ' + lineCol + ',') > -1 && js.indexOf('par: ' + parCol + ' ') > -1, 'id колонок клиента');
    assert.ok(js.indexOf('FR_' + lineCol + '=') > -1, 'фильтр FR_ по колонке клиента');
    assert.ok(js.indexOf('setTimeout(load, 500)') > -1 && html.indexOf('width:500px') > -1, 'числа, не являющиеся id, не тронуты');
    assert.ok(/замены:/.test(page.logText()), 'замены показаны в журнале');
});

test('#5636 п.2: гость получает перенесённую роль с правами и меню', async () => {
    const x = etalonV1();
    const c = makeCore('exp5635c', 900);
    await importPkg(c, await exportPkg(x.a));
    const roles = c.of(42).filter((id) => c.records[id].val === 'Гость');
    assert.strictEqual(roles.length, 1, 'роль «Гость» создана');
    const role = roles[0];
    const user = c.of(18).find((id) => c.records[id].val === 'guest');
    assert.ok(user, 'пользователь guest создан');
    assert.strictEqual(c.records[user].params['115'], role, 'у guest роль «Гость» клиента');
    const mark = c.termsNamed('Отметка смены')[0];
    const lineCol = c.colsOf(mark).find((r) => c.label(r) === 'Линия');
    const lines = c.termsNamed('Справочник линий')[0];
    const L = c.of(lines).map((id) => c.records[id].val + '=' + id);
    const grants = c.of(116, role).map((id) => c.records[id]);
    const byObj = Object.fromEntries(grants.map((g) => [g.val, g.params]));
    assert.strictEqual(byObj[mark] && byObj[mark]['136'], '54', 'WRITE на таблицу клиента');
    const l1 = c.of(lines).find((id) => c.records[id].val === 'Л1');
    const l2 = c.of(lines).find((id) => c.records[id].val === 'Л2');
    assert.strictEqual(byObj[lineCol] && byObj[lineCol]['49'], '@IN(' + l1 + ',' + l2 + ')', 'маска — на записи клиента ' + L.join(' '));
    const q = c.of(22).find((id) => c.records[id].val === 'Отметки по линии');
    assert.strictEqual(byObj[q] && byObj[q]['136'], '53', 'READ на запрос клиента');
    assert.deepStrictEqual(c.of(151, role).map((id) => c.records[id].val), ['Чек-лист смены'], 'меню роли перенесено');
    assert.strictEqual(c.of(47).length, 3, 'уровни доступа не размножились');
});

// ---- п.3: v1 у клиента, клиент работает и чинит экран; эталон выпускает v2 ----
async function liveClientThenV2() {
    const x = etalonV1();
    const c = makeCore('exp5635c', 900);
    await importPkg(c, await exportPkg(x.a));
    const mark = c.termsNamed('Отметка смены')[0];
    const cLine = c.colsOf(mark).find((r) => c.label(r) === 'Линия');
    const cL1 = c.of(c.termsNamed('Справочник линий')[0]).find((id) => c.records[id].val === 'Л1');
    for (let i = 0; i < 3; i++) { const o = {}; o[cLine] = cL1; c.rec(mark, 1, 'смена клиента ' + i, o); }
    const before = { mark, records: c.of(mark).slice().sort(), cols: c.colsOf(mark).length };
    c.files['download||checklist.js'] = fileOf(c, 'download||checklist.js') + '// починка клиента своим ИИ-чатом\n';
    before.js = c.files['download||checklist.js'];
    const cq = c.of(22).find((id) => c.records[id].val === 'Отметки по линии');
    before.cntCol = c.of(28, cq).find((id) => c.records[id].params['100'] === 'Кол-во');
    before.html = c.files['templates||checklist.html'];
    // v2 эталона: новая обязательная колонка, новый справочник с записями, фильтр запроса, ещё право и пункт меню
    const a = x.a;
    x.shiftCol = a.col(x.mark, a.term('Смена'), { required: true });
    x.norm = a.table('Норматив');
    x.normCol = a.col(x.norm, x.valT);
    a.col(x.norm, a.ref(x.lines), { alias: 'Линия норматива' }); // ref-тип справочника у клиента уже есть — откат его не трогает
    const n = {}; n[x.normCol] = '7'; a.rec(x.norm, 1, 'Л1 температура', n); a.rec(x.norm, 1, 'Л2 давление', n);
    a.records[x.qc].params['102'] = 'Л1';
    a.records[x.qc2].val = x.shiftCol; // колонка запроса «Кол-во» считает теперь по «Смене»
    a.rec(116, x.guest, x.norm, { 136: '53' });
    a.records[a.of(116, x.guest).find((id) => a.records[id].val === x.mark)].params['136'] = '53';
    a.rec(151, x.guest, 'Неделя', { 153: 'week' });
    a.files['download||checklist.js'] = x.js() + 'var SHIFT = ' + x.shiftCol + ';\n';
    a.files['download||week.js'] = "var BASE = '/exp5635a/', N = " + x.norm + ';\n';
    const page = await importPkg(c, await exportPkg(a), { update: true });
    return { x, c, before, page };
}

test('#5636 п.3: обновление меняет схему клиента на месте и не трогает его записи', async () => {
    const { c, before, page } = await liveClientThenV2();
    assert.deepStrictEqual(c.termsNamed('Отметка смены 1'), [], 'копии «Отметка смены 1» нет:\n' + page.logText());
    assert.deepStrictEqual(c.termsNamed('Отметка смены'), [before.mark], 'та же таблица');
    assert.deepStrictEqual(c.of(before.mark).slice().sort(), before.records, 'записи клиента те же, записей эталона не прибавилось');
    const shift = c.colsOf(before.mark).find((r) => c.label(r) === 'Смена');
    assert.ok(shift, 'новая колонка «Смена» добавлена в таблицу клиента');
    assert.strictEqual(c.reqs[shift].fa.required, true, 'и обязательна, как в v2');
    assert.strictEqual(c.colsOf(before.mark).length, before.cols + 1, 'прежние колонки не задвоены');
    const norm = c.termsNamed('Норматив');
    assert.strictEqual(norm.length, 1, 'новый справочник создан');
    assert.strictEqual(c.of(norm[0]).length, 2, 'записи нового справочника перенесены');
    const qs = c.of(22).filter((id) => c.records[id].val === 'Отметки по линии');
    assert.strictEqual(qs.length, 1, 'запрос не задвоен');
    const qcols = c.of(28, qs[0]).map((id) => c.records[id]);
    assert.strictEqual(qcols.length, 3, 'колонки запроса не задвоены');
    assert.deepStrictEqual(c.ordered(28, qs[0]).map((id) => c.records[id].params['100']), ['Линия', 'Кол-во', 'Параметр'], 'пересозданная колонка — на прежнем месте');
    assert.strictEqual(qcols.find((q) => q.params['100'] === 'Линия').params['102'], 'Л1', 'фильтр колонки запроса обновлён');
    const cnt = qcols.find((q) => q.params['100'] === 'Кол-во');
    assert.strictEqual(cnt.val, shift, 'источник колонки запроса — новая колонка клиента');
    assert.strictEqual(cnt.params['104'], '74', 'функция COUNT сохранена');
    assert.ok(!/не обновлена|не удалось/.test(page.logText()), 'все изменения записались: ' + page.logText());
    const roles = c.of(42).filter((id) => c.records[id].val === 'Гость');
    assert.strictEqual(roles.length, 1, 'роль не задвоена');
    const grants = c.of(116, roles[0]).map((id) => c.records[id]);
    assert.strictEqual(grants.length, 4, 'три прежних права + право на «Норматив»');
    assert.strictEqual(grants.find((g) => g.val === before.mark).params['136'], '53', 'уровень права обновлён');
    assert.deepStrictEqual(c.of(151, roles[0]).map((id) => c.records[id].val).sort(), ['Неделя', 'Чек-лист смены'], 'меню: прежний пункт + новый');
    assert.strictEqual(c.of(18).filter((id) => c.records[id].val.indexOf('guest') === 0).length, 1, 'пользователь не задвоен');
    const js = fileOf(c, 'download||checklist.js');
    assert.ok(js.indexOf('SHIFT = ' + shift + ';') > -1 && js.indexOf('exp5635a') === -1, 'экран v2 — на id и базу клиента:\n' + js);
    assert.ok(fileOf(c, 'download||week.js').indexOf('N = ' + norm[0] + ';') > -1, 'новый файл — на id клиента');
});

test('#5636 п.3: откат обновления возвращает схему, запрос, права и файлы клиента', async () => {
    const { c, before, page } = await liveClientThenV2();
    const rb = await rollback(c, page.store);
    assert.deepStrictEqual(c.colsOf(before.mark).length, before.cols, 'добавленная колонка удалена:\n' + rb.logText());
    assert.deepStrictEqual(c.termsNamed('Норматив'), [], 'новый справочник удалён');
    assert.deepStrictEqual(c.of(before.mark).slice().sort(), before.records, 'записи клиента на месте');
    const q = c.of(22).find((id) => c.records[id].val === 'Отметки по линии');
    const qcols = c.of(28, q).map((id) => c.records[id]);
    assert.strictEqual(qcols.length, 3, 'в запросе снова три колонки');
    assert.deepStrictEqual(c.ordered(28, q).map((id) => c.records[id].params['100']), ['Линия', 'Кол-во', 'Параметр'], 'порядок колонок — прежний');
    assert.ok(c.records[before.cntCol] && c.records[before.cntCol].params['100'] === 'Кол-во', 'у колонки «Кол-во» прежний id');
    assert.strictEqual(qcols.find((x) => x.params['100'] === 'Линия').params['102'] || '', '', 'фильтр запроса — как до обновления');
    const cntCol = qcols.find((x) => x.params['100'] === 'Кол-во');
    assert.strictEqual(c.label(cntCol.val), 'Значение', 'источник колонки запроса — прежний');
    assert.strictEqual(cntCol.params['104'], '74', 'функция — прежняя');
    assert.ok(/Откат завершён/.test(rb.logText()) && !/Остались объекты|не удалось/.test(rb.logText()), 'откат без остатков: ' + rb.logText());
    const role = c.of(42).find((id) => c.records[id].val === 'Гость');
    assert.strictEqual(c.records[c.of(116, role).find((id) => c.records[id].val === before.mark)].params['136'], '54', 'уровень права — прежний');
    assert.strictEqual(c.of(116, role).length, 3, 'новое право снято');
    assert.deepStrictEqual(c.of(151, role).map((id) => c.records[id].val), ['Чек-лист смены'], 'новый пункт меню снят');
    assert.strictEqual(fileOf(c, 'download||checklist.js'), before.js, 'починка клиента в экране вернулась');
    assert.strictEqual(fileOf(c, 'download||week.js'), undefined, 'файл, которого до обновления не было, удалён');
    const mark = before.mark;
    const line = c.colsOf(mark).find((r) => c.label(r) === 'Линия');
    assert.strictEqual(c.reqs[line].fa.required, true, 'свойства прежних колонок не испорчены');
});

test('#5636: установка в базу, где таблицы уже есть, предупреждает и подсказывает режим обновления', async () => {
    const x = etalonV1();
    const json = await exportPkg(x.a);
    const c = makeCore('exp5635c', 900);
    await importPkg(c, json);
    const page = await importPkg(c, json);
    assert.ok(/уже есть таблицы[^\n]*«Отметка смены»[^\n]*обновление/.test(page.logText()), page.logText().split('\n').slice(0, 4).join('\n'));
});
