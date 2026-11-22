// DOM-XSS в гриде и дашборде — issue p2n#1137 (D3: «…»/showFullValue, D4: заголовки форм,
// имена из метаданных, style-колонка, путь файла, dash.js).
//
// Длинное значение ячейки (>127 символов) открывается в модалке по ссылке «…». Значение не
// должно попадать в код обработчика: браузер декодирует сущности атрибута до разбора JS, и
// апостроф из данных закрывает строковый литерал. Проверяем как браузер: берём onclick и
// data-* ссылки, декодируем сущности, исполняем обработчик и смотрим, что дошло до модалки.
//
// Run with: node experiments/dom-xss-1137.test.js

const IntegramTable = require('../js/integram-table.js');

global.window = { location: { pathname: '/crm/table/1078' }, INTEGRAM_DEBUG: false };

let passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (cond || !extra ? '' : '\n    ' + extra));
    if (cond) passed++; else process.exitCode = 1;
}

function decodeAttr(s) {
    return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
        const l = e.toLowerCase();
        if (l === 'amp') return '&'; if (l === 'lt') return '<'; if (l === 'gt') return '>';
        if (l === 'quot') return '"'; if (l === 'apos') return "'";
        return String.fromCodePoint(l[1] === 'x' ? parseInt(l.slice(2), 16) : parseInt(l.slice(1), 10));
    });
}

// Находит <a class="show-full-value" …>, исполняет его onclick как браузер и возвращает
// { injected, arg } — сработал ли код из данных и что получил showFullValue.
function clickShowFull(html) {
    const m = html.match(/<a\b[^>]*class="show-full-value"[^>]*>/);
    if (!m) return null;
    const tag = m[0];
    const attrs = {};
    tag.replace(/\s([a-z-]+)="([^"]*)"/g, (x, k, v) => { attrs[k] = decodeAttr(v); });
    const dataset = {};
    Object.keys(attrs).filter(k => k.startsWith('data-')).forEach(k => {
        dataset[k.slice(5).replace(/-([a-z])/g, (x, c) => c.toUpperCase())] = attrs[k];
    });
    const res = { injected: false, arg: undefined };
    const win = { table: { showFullValue(ev, v) { res.arg = v; } } };
    const pwn = () => { res.injected = true; };
    try {
        new Function('window', 'event', 'pwn', attrs.onclick).call({ dataset }, win, { preventDefault() {}, stopPropagation() {} }, pwn);
    } catch (e) { res.error = e.message; }
    return res;
}

const PAYLOAD = "');pwn();//<img src=x onerror=pwn()> " + 'x'.repeat(140) + ' https://ideav.ru/a?b=1';

function makeTable() {
    const t = Object.create(IntegramTable.prototype);
    Object.assign(t, {
        settings: { truncateLongValues: true }, editableColumns: new Map(), styleColumns: {},
        columns: [], data: [], rawObjectData: [{ i: 1, u: 1, o: 1, r: [PAYLOAD] }],
        objectTableId: '1078', options: { instanceName: 'table', dataSource: 'table', parentId: null }
    });
    return t;
}

// Модалка не должна получить разметку из данных: в аргументе нет тегов, кроме ссылок linkify.
function hasForeignTags(s) {
    return /<(?!\/?a[\s>])[a-z!\/]/i.test(String(s || ''));
}

for (const format of ['SHORT', 'MEMO', 'NUMBER']) {
    const t = makeTable();
    const column = { id: '100', type: '3', format, name: 'Текст', attrs: '', paramId: '100' };
    t.columns = [column]; t.data = [[PAYLOAD]];
    const html = t.renderCell(column, PAYLOAD, 0, 0);
    const r = clickShowFull(html);
    assert(r !== null, `renderCell ${format}: есть ссылка «…»`);
    if (!r) continue;
    assert(!r.injected && !r.error, `renderCell ${format}: код из значения не исполняется`, JSON.stringify(r));
    assert(typeof r.arg === 'string' && !hasForeignTags(r.arg), `renderCell ${format}: в модалку не уходит чужая разметка`, String(r.arg).slice(0, 120));
    assert(typeof r.arg === 'string' && r.arg.includes('x'.repeat(140)), `renderCell ${format}: в модалку уходит полное значение`);
}

{
    // Перерисовка ячейки после инлайн-правки (updateCellDisplay)
    const t = makeTable();
    const attrsSet = {};
    const cell = {
        dataset: {}, innerHTML: '',
        setAttribute(k, v) { attrsSet[k] = v; }, removeAttribute() {}, getAttribute(k) { return attrsSet[k] || null; },
        querySelector() { return null; }, querySelectorAll() { return []; },
        classList: { add() {}, remove() {}, contains() { return false; } },
        closest() { return null; }
    };
    try { t.updateCellDisplay(cell, PAYLOAD, 'SHORT'); } catch (e) { console.log('updateCellDisplay threw: ' + e.message); }
    const r = clickShowFull(cell.innerHTML);
    assert(r !== null, 'updateCellDisplay: есть ссылка «…»');
    if (r) {
        assert(!r.injected && !r.error, 'updateCellDisplay: код из значения не исполняется', JSON.stringify(r));
        assert(typeof r.arg === 'string' && !hasForeignTags(r.arg), 'updateCellDisplay: в модалку не уходит чужая разметка');
    }
}

// Есть ли у какого-то тега атрибут name. Значения в кавычках вырезаны — так теги видит парсер.
function hasAttr(html, name) {
    const re = new RegExp('\\s' + name + '\\s*=', 'i');
    return (html.replace(/="[^"]*"/g, '=""').match(/<[^>]*>/g) || []).some(tag => re.test(tag));
}

// --- D4: style-колонка и путь файла не выходят из атрибута
const TAG_PAYLOAD = '<img src=x onerror=pwn()>';
const ATTR_PAYLOAD = 'color:red" onmouseover="pwn()';
{
    const t = makeTable();
    t.settings.truncateLongValues = false;
    const col = { id: '100', type: '3', format: 'SHORT', name: 'Текст', attrs: '', paramId: '100' };
    const styleCol = { id: '101', type: '3', format: 'SHORT', name: 'Текст.style', attrs: '', paramId: '101' };
    t.columns = [col, styleCol]; t.data = [['abc', ATTR_PAYLOAD]]; t.styleColumns = { '100': '101' };
    const html = t.renderCell(col, 'abc', 0, 0);
    assert(!hasAttr(html, 'onmouseover'), 'style-колонка: значение не добавляет атрибутов ячейке', html.slice(0, 200));
}
{
    const t = makeTable();
    t.getApiBase = () => '/crm';
    const col = { id: '100', type: '10', format: 'FILE', name: 'Файл', attrs: '', paramId: '100' };
    t.columns = [col]; t.data = [['a/b" onmouseover="pwn().txt']];
    const html = t.renderCell(col, 'a/b" onmouseover="pwn().txt', 0, 0);
    assert(!hasAttr(html, 'onmouseover'), 'FILE: путь файла не добавляет атрибутов ссылке', html.slice(0, 200));
}

// --- D4: заголовок формы записи и подписи полей. Заглушка DOM собирает всё, что ушло в innerHTML.
function domStub(sink) {
    const store = {};
    return new Proxy(function () {}, {
        get(t, k) {
            if (k === Symbol.toPrimitive) return () => '';
            if (k === 'then') return undefined;
            if (k in store) return store[k];
            if (k === 'length') return 0;
            if (k === 'forEach' || k === 'map') return () => [];
            if (k === 'style' || k === 'dataset' || k === 'classList') return (store[k] = domStub(sink));
            return domStub(sink);
        },
        set(t, k, v) { store[k] = v; if (k === 'innerHTML') sink.push(String(v)); return true; },
        apply() { return domStub(sink); }
    });
}
{
    const sink = [];
    const savedDoc = global.document, savedNav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    global.document = domStub(sink);
    Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { writeText: async () => {} } }, configurable: true, writable: true });
    const t = makeTable();
    const md = { id: '1', val: 'Таблица' + TAG_PAYLOAD, reqs: [{ id: '2', val: 'Поле' + TAG_PAYLOAD, type: '3', attrs: '' }] };
    let err = null;
    try { t.renderEditFormModal(md, { obj: { val: 'Запись' + TAG_PAYLOAD, id: 5 }, reqs: {} }, false, '1'); } catch (e) { err = e; }
    const rendered = sink.join('\n');
    assert(rendered.includes('<h3>'), 'форма записи: заголовок отрисован', err && err.message);
    assert(!rendered.includes('<img'), 'форма записи: главное значение, имя таблицы и поля не становятся разметкой');
    assert(rendered.includes('Запись&lt;img'), 'форма записи: главное значение видно текстом');
    global.document = savedDoc;
    if (savedNav) Object.defineProperty(globalThis, 'navigator', savedNav); else delete globalThis.navigator;
}

// --- D4: значение ячейки дашборда (dashSetCellNumber) — функции из исходника js/dash.js
{
    const fsm = require('fs'), pathm = require('path');
    const SRC = fsm.readFileSync(pathm.join(__dirname, '..', 'js', 'dash.js'), 'utf8');
    const fnSource = (name) => {
        const start = SRC.indexOf('\nfunction ' + name + '(');
        if (start === -1) return '';
        const next = SRC.indexOf('\nfunction ', start + 1);
        return SRC.slice(start, next === -1 ? SRC.length : next);
    };
    const names = ['dashAttr', 'dashEscapeHtml', 'dashEscapeText', 'dashH', 'dashNormalizeNumberText', 'dashRoundNumberText',
        'dashCellRawAttr', 'dashFormatNumberText', 'dashGetFloat', 'dashSetCellNumber'];
    const d = new Function(names.map(fnSource).join('\n') + '\nreturn { dashSetCellNumber };')();
    const el = { innerHTML: '', setAttribute() {}, removeAttribute() {} };
    d.dashSetCellNumber(el, 'текст' + TAG_PAYLOAD);
    assert(!el.innerHTML.includes('<img'), 'dash: текстовое значение ячейки не становится разметкой', el.innerHTML);
    d.dashSetCellNumber(el, '1234567.5');
    assert(el.innerHTML === '1 234 567.5', 'dash: число по-прежнему форматируется', el.innerHTML);
}

console.log(`\n${passed}/${total} passed`);
