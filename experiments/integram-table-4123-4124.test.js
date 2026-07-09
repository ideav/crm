// Unit-тесты для ideav/crm#4123 и #4124 — подчинённая таблица standalone-формы
// (IntegramCreateFormHelper.renderSubordinateTableStandalone, окно window.openCreateRecordForm /
// window.openEditRecordForm вне экземпляра IntegramTable).
//
// #4123: ячейки выводились как escapeHtml(values[i]) без форматирования по типу колонки →
//        DATETIME показывался unix-штампом (1782968400), ссылка — как "5:ТО", флаг — как "1",
//        FILE — экранированным тегом <a> в виде текста.
// #4124: valIdx++ стоял ВНУТРИ `if (!req.arr_id)`, а r[] несёт слот на каждый реквизит →
//        после первой вложенной колонки все значения строки уезжали влево.
//
// Гоняем настоящий рендер на фейковом контейнере и разбираем полученный HTML.
//
// Run with: node experiments/integram-table-4123-4124.test.js

process.env.TZ = 'Europe/Moscow';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, total = 0;
function assertEqual(actual, expected, name) {
    total++;
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; }
    else { console.log('  expected:', JSON.stringify(expected)); console.log('  actual:  ', JSON.stringify(actual)); process.exitCode = 1; }
}

// ── Загрузка собранного бандла в песочницу ───────────────────────────────────
const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'integram-table.js'), 'utf8');
const sandbox = { console, location: { pathname: '/ateh/table/1078' } };
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
const { IntegramCreateFormHelper } = vm.runInContext(
    source + '\n;({ IntegramCreateFormHelper });', sandbox, { filename: 'integram-table.js' }
);

// Типы колонок Integram (normalizeFormat): 4 = DATETIME, 9 = DATE, 3 = SHORT, 11 = BOOLEAN, 10 = FILE.
const DATETIME = 4, DATE = 9, SHORT = 3, BOOLEAN = 11, FILE = 10;

// renderSubordinateTableStandalone пишет в container.innerHTML, затем вешает обработчики
// через querySelector/querySelectorAll — на фейковом контейнере их просто нет.
function makeContainer() {
    return { innerHTML: '', querySelector: () => null, querySelectorAll: () => [] };
}
function render(metadata, records) {
    const helper = Object.create(IntegramCreateFormHelper.prototype);
    const container = makeContainer();
    helper.renderSubordinateTableStandalone(container, metadata, records, 1078, 42);
    return container.innerHTML;
}
// Ячейки строки данных: <td …>содержимое</td>, без служебного <span class="subordinate-row-number">
function cellsOf(html) {
    const body = html.split('<tbody>')[1] || '';
    return (body.match(/<td[^>]*>([\s\S]*?)<\/td>/g) || [])
        .map(td => td.replace(/^<td[^>]*>/, '').replace(/<\/td>$/, ''))
        .map(td => td.replace(/<span class="subordinate-row-number">\d+<\/span>/, ''));
}
function headersOf(html) {
    return (html.match(/<th>([\s\S]*?)<\/th>/g) || []).map(th => th.replace(/<\/?th>/g, ''));
}

// ── #4124: вложенная (arr_id) колонка не должна сдвигать значения строки ─────
// r[] несёт слот на каждый реквизит, включая «Детали» (arr_id, там счётчик = 3).
const metaNested = {
    val: 'ТО оборудования',
    type: SHORT,
    reqs: [
        { val: 'Окончание', type: DATETIME, attrs: '' },
        { val: 'Детали',    type: SHORT,    attrs: '', arr_id: 999 },
        { val: 'Вид работ', type: SHORT,    attrs: '' },
    ],
};
const htmlNested = render(metaNested, [{ i: 1, r: ['Насос №3', '1782975600', 3, '5:ТО'] }]);

assertEqual(headersOf(htmlNested), ['ТО оборудования', 'Окончание', 'Вид работ'],
    '#4124: вложенная колонка в шапку не попадает');
assertEqual(cellsOf(htmlNested), ['Насос №3', '02.07.2026 10:00:00', 'ТО'],
    '#4124: «Вид работ» читает r[3]="5:ТО", а не r[2]=3 (счётчик вложенной таблицы)');

// Две вложенные колонки подряд — сдвиг был бы на два слота
const metaTwoNested = {
    val: 'ТО оборудования',
    type: SHORT,
    reqs: [
        { val: 'Детали',    type: SHORT, attrs: '', arr_id: 998 },
        { val: 'Расходники', type: SHORT, attrs: '', arr_id: 999 },
        { val: 'Вид работ', type: SHORT, attrs: '' },
    ],
};
assertEqual(cellsOf(render(metaTwoNested, [{ i: 1, r: ['Насос №3', 3, 7, '5:ТО'] }])),
    ['Насос №3', 'ТО'],
    '#4124: две вложенные колонки подряд — «Вид работ» всё ещё читает r[3]');

// ── #4123: форматирование по типу колонки ───────────────────────────────────
const metaTypes = {
    val: 'ТО оборудования',
    type: DATETIME,                       // главное значение — DATETIME
    reqs: [
        { val: 'Дата',      type: DATE,     attrs: '' },
        { val: 'Вид работ', type: SHORT,    attrs: '' },
        { val: 'Выполнено', type: BOOLEAN,  attrs: '' },
        { val: 'Акт',       type: FILE,     attrs: '' },
    ],
};
const rowTypes = { i: 1, r: ['1782968400', '1782968400', '5:ТО', '1', '<a href="/f/1.pdf">акт.pdf</a>'] };
const cellsTypes = cellsOf(render(metaTypes, [rowTypes]));

assertEqual(cellsTypes[0], '02.07.2026 08:00:00',
    '#4123: главное значение DATETIME — датой, а не штампом');
assertEqual(cellsTypes[1], '02.07.2026',
    '#4123: DATE-колонка — датой без времени');
assertEqual(cellsTypes[2], 'ТО',
    '#4123: ссылка без префикса "id:"');
assertEqual(cellsTypes[3], '<span class="boolean-check"><i class="pi pi-check"></i></span>',
    '#4123: BOOLEAN — иконкой');
assertEqual(cellsTypes[4], '<a class="file-link" href="/f/1.pdf">акт.pdf</a>',
    '#4123: FILE — живой ссылкой, а не экранированным тегом');

// BOOLEAN=false и экранирование обычного текста
const metaBool = {
    val: 'Позиция', type: SHORT,
    reqs: [{ val: 'Выполнено', type: BOOLEAN, attrs: '' }],
};
assertEqual(cellsOf(render(metaBool, [{ i: 1, r: ['<b>Втулка</b>', '0'] }])),
    ['&lt;b&gt;Втулка&lt;/b&gt;', '<span class="boolean-uncheck"><i class="pi pi-times"></i></span>'],
    '#4123: BOOLEAN=false — ✘, а текст с разметкой экранируется');

// Не-дата колонка со «штампоподобным» числом датой не становится
assertEqual(cellsOf(render({ val: 'Позиция', type: SHORT, reqs: [{ val: 'Код', type: SHORT, attrs: '' }] },
    [{ i: 1, r: ['Втулка', '1782968400'] }])),
    ['Втулка', '1782968400'],
    '#4123: SHORT со штампоподобным числом остаётся числом');

// Алиас колонки из attrs (:ALIAS=…:) по-прежнему в шапке
assertEqual(headersOf(render({ val: 'Позиция', type: SHORT, reqs: [{ val: 'Код', type: SHORT, attrs: ':ALIAS=Артикул:' }] },
    [{ i: 1, r: ['Втулка', 'A-1'] }])),
    ['Позиция', 'Артикул'],
    'алиас реквизита из attrs не сломан');

console.log(`\n${passed}/${total} passed`);
if (passed !== total) process.exitCode = 1;
