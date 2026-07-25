// Unit-тесты для ideav/crm#4385 — js/integram-table.js доработки подсказок (title):
//
// 1. title с ID ячейки должен показываться и на РОДИТЕЛЬСКОЙ ячейке <td>, а не только
//    на внутреннем <span> внутри .cell-content-wrapper: иконка .edit-icon (absolute,
//    bottom/right) при короткой ячейке полностью накрывает обёртку, и hover над ней
//    отдаёт свою подсказку «Редактировать» — узнать ID было нельзя. Теперь ID продублирован
//    на <td>, поэтому наведение на паддинг/любую свободную область ячейки его показывает.
// 2. title заголовка (ID колонки) должен показываться и на РОДИТЕЛЬСКОЙ ячейке <th>, а не
//    только на .column-header-content: спан заголовка часто перекрыт значком справочника,
//    кнопкой «+», ручкой ресайза.
//
// Проверяем сам рендер: renderCell → <td title="ID">, renderGroupedHeaders → <th title="ID">,
// плюс что старые подсказки (span с ID, edit-icon «Редактировать») на месте, а у пустой
// не-ссылочной ячейки лишнего title не появилось. И статически — что все три шаблона <th>
// в исходнике несут title.
//
// Run with: node experiments/integram-table-4385.test.js

process.env.TZ = 'Europe/Moscow';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, total = 0;
function assert(cond, name) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) { passed++; } else { process.exitCode = 1; }
}
function assertEqual(actual, expected, name) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    total++;
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; }
    else { console.log('  expected:', JSON.stringify(expected)); console.log('  actual:  ', JSON.stringify(actual)); process.exitCode = 1; }
}

// Атрибут именно у ВЕРХНЕГО тега (первый '>' закрывает открывающий тег <td>/<th>).
function outerTag(html) {
    const s = html.trim();
    return s.slice(0, s.indexOf('>') + 1);
}
function tagTitle(html) {
    const m = outerTag(html).match(/\btitle="([^"]*)"/);
    return m ? m[1] : null;
}

// ── Загрузка бандла в песочницу ──────────────────────────────────────────────
const SRC_PATH = path.join(__dirname, '..', 'js', 'integram-table.js');
const source = fs.readFileSync(SRC_PATH, 'utf8');
const sandbox = {
    console, URLSearchParams,
    location: { pathname: '/ateh/table/1078', search: '' },
    document: { getElementById: () => null, querySelectorAll: () => [], querySelector: () => null,
                addEventListener: () => {}, readyState: 'complete' },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
const { IntegramTable } = vm.runInContext(
    source + '\n;({ IntegramTable });', sandbox, { filename: 'integram-table.js' }
);

// ── Фейковый сервер «Задание в производство» (тип 1078) ──────────────────────
const TYPE_ID = '1078';
const SHORT = '3', DATETIME = '4', NUMBER = '13';

function makeServer() {
    const server = {
        reqs: [
            { id: '8474', val: 'Слиттер', type: SHORT, ref_id: '95358', orig: '95358' }, // ссылочный
            { id: '8492', val: 'Начато',  type: DATETIME },                               // простой, без иконки
            { id: '8495', val: 'Кол-во',  type: NUMBER },
        ],
    };
    server.metadata = () => ({
        id: TYPE_ID, type: SHORT, val: 'Задание в производство', granted: 'WRITE',
        reqs: server.reqs.map((r, i) => Object.assign({ num: i + 1, attrs: '' }, r)),
    });
    server.rows = (count = 1) => {
        const rows = [];
        for (let n = 0; n < count; n++) {
            rows.push({
                i: String(5000 + n), u: '1', o: '0',
                // ссылочная колонка в формате "id:Значение", остальные — простые значения
                r: [`строка-${ n }`, `770:Слиттер-А`, `val:Начато`, `val:Кол-во`],
            });
        }
        return rows;
    };
    return server;
}

function makeTable(server, options = {}) {
    const noop = IntegramTable.prototype.init;
    IntegramTable.prototype.init = () => {};
    const t = new IntegramTable('tbl', Object.assign({
        dataSource: 'table', tableTypeId: TYPE_ID, instanceName: 'tbl', pageSize: 20,
        apiUrl: '/ateh/object/1078/?JSON_OBJ',
    }, options));
    IntegramTable.prototype.init = noop;
    t.getApiBase = () => '/ateh';
    t.getPageUrlParams = () => new URLSearchParams();
    t.render = () => {};
    t.checkAndLoadMore = () => {};
    t.saveColumnState = () => {};
    t.fetchJson = async () => server.rows(1);
    sandbox.fetch = async (url) => {
        const href = String(url);
        if (href.includes('/metadata/')) {
            return { ok: true, json: async () => server.metadata(), text: async () => JSON.stringify(server.metadata()) };
        }
        throw new Error(`unexpected fetch: ${ href }`);
    };
    return t;
}

(async () => {
    const server = makeServer();
    const t = makeTable(server);
    await t.loadData(false);

    const colById = id => t.columns.find(c => c.id === id);
    const idx = col => t.columns.indexOf(col);

    // ── 1. Первая (главная) колонка — ячейка с edit-icon ─────────────────────
    const firstCol = colById(TYPE_ID);
    const tdFirst = t.renderCell(firstCol, t.data[0][idx(firstCol)], 0, idx(firstCol));

    assertEqual(tagTitle(tdFirst), '5000',
        '#4385-1: <td> редактируемой ячейки несёт ID записи в title');
    assert(tdFirst.includes('<span title="5000">'),
        '#4385-1: внутренний <span> по-прежнему несёт тот же ID (регресс-страховка)');
    assert(/class="edit-icon"[^>]*title="Редактировать"/.test(tdFirst),
        '#4385-1: собственная подсказка edit-icon «Редактировать» сохранена');
    // ID на <td> и на span совпадают — навести можно куда угодно в ячейке
    assertEqual(tagTitle(tdFirst), (tdFirst.match(/<span title="([^"]+)">/) || [])[1],
        '#4385-1: title родительской ячейки совпадает с title внутреннего span');

    // ── 2. Ссылочная колонка — ID берётся из "id:Значение" (refValueId) ──────
    const refCol = colById('8474');
    const tdRef = t.renderCell(refCol, t.data[0][idx(refCol)], 0, idx(refCol));
    assertEqual(tagTitle(tdRef), '770',
        '#4385-1: у ссылочной ячейки на <td> проставлен ID справочной записи (770)');
    assert(tdRef.includes('class="cell-content-wrapper"'),
        '#4385-1: ссылочная ячейка обёрнута в .cell-content-wrapper');

    // ── 3. Простая не-ссылочная ячейка без иконки — лишнего title нет ────────
    const plainCol = colById('8492'); // DATETIME, не первый и не ссылочный → без edit-icon
    const tdPlain = t.renderCell(plainCol, t.data[0][idx(plainCol)], 0, idx(plainCol));
    assert(!tdPlain.includes('cell-content-wrapper'),
        '#4385-1: у простой ячейки обёртки/иконки нет (предусловие теста)');
    assertEqual(tagTitle(tdPlain), null,
        '#4385-1: у ячейки без ID на <td> НЕ появляется пустой title');

    // ── 4. Заголовки: каждый <th> несёт ID колонки в title ───────────────────
    t.groupingColumns = [];
    t.visibleColumns = t.columns.map(c => c.id);
    const headerHtml = t.renderGroupedHeaders(t.columns, 'tbl');
    const ths = headerHtml.match(/<th\b[^>]*>/g) || [];
    assertEqual(ths.length, t.columns.length, '#4385-2: отрисованы все заголовки');
    const titledCorrectly = t.columns.every(col =>
        ths.some(th => th.includes(`data-column-id="${ col.id }"`) && th.includes(`title="${ col.id }"`)));
    assert(titledCorrectly,
        '#4385-2: у каждого <th> title = ID колонки (виден, даже когда .column-header-content перекрыт)');

    // ── 5. Статически: во ВСЕХ трёх шаблонах <th> исходника есть title ID ─────
    // (одиночный ряд, smart-заголовки, renderGroupedHeaders — правились одинаково)
    const thTemplates = source.match(/<th data-column-id="\$\{ col\.id \}" draggable="true"[^\n]*/g) || [];
    assert(thTemplates.length >= 3,
        '#4385-2: в исходнике найдены все шаблоны колоночных <th> (>=3)');
    assert(thTemplates.every(t => t.includes('title="${ col.id }"')),
        '#4385-2: каждый шаблон <th> несёт title="${ col.id }" (в т.ч. одиночный ряд заголовков)');

    console.log(`\n${ passed }/${ total } tests passed`);
})().catch(e => { console.error(e); process.exit(1); });
