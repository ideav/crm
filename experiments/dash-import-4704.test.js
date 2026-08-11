// #4704 — конвертор Excel → модель дэшборда: распознавание формы книги, журнал непереносимого,
// словарь периода, операции записи.
//
// Фикстура повторяет форму боевого образца из тикета («Лангемак — работающая финмодель»):
//   • шапка периодов — строка с возрастающими годами, правее — колонка «Итог:»;
//   • слева от периодов две подписи: дальняя = метка/группа («OpEx 1»), ближняя = имя строки;
//   • секции без собственной шапки лет («Отчёт о прибылях и убытках») начинаются с заголовка —
//     строки с текстом и БЕЗ чисел;
//   • формулы бывают внутри своей панели (переносимы) и со ссылкой на параметры справа (нет).
//
// Run with: node experiments/dash-import-4704.test.js

var DI = require('../js/dash-import.js');

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    total++;
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; } else {
        console.log('  ожидалось:', JSON.stringify(expected));
        console.log('  получено: ', JSON.stringify(actual));
        process.exitCode = 1;
    }
}
function t(v) { return { v: v, f: null }; }               // текст/число
function n(v, f) { return { v: v, f: f || null }; }        // число (с формулой)
var _ = null;

// Лист: A | B | C(2026) D(2027) E(2028) | F(Итог)
var grid = [
    [_, t('Годы:'), t(2026), t(2027), t(2028), t('Итог:')],           // 1 — шапка периодов
    [_, t('ФОТ'), n(10), n(20), n(30), n(60)],                        // 2
    [_, t('Аренда'), n(1), n(2), n(3), n(6)],                         // 3
    [t('OpEx 1'), t('Итого:'), n(11, 'SUM(C2:C3)'), n(22, 'SUM(D2:D3)'), n(33, 'SUM(E2:E3)'), n(66)],
    [_, _, _, _, _, _],                                               // 5 — разделитель
    [_, n(100), n(200), n(300), _, _],                                // 6 — числа без подписи
    [t('Отчёт о прибылях и убытках'), _, _, _, _, _],                 // 7 — заголовок секции
    [t('Revenue'), t('Выручка'), n(500), n(600), n(700), n(1800)],    // 8
    [_, t('НДС'), n(110, 'C8*I1'), n(132), n(154), n(396)]            // 9 — ссылка на параметр справа
];

var res = DI.recognizeModel('/tmp/Лангемак — финмодель.xlsx', [{ name: 'Лист1', grid: grid, merges: [] }]);
var sheet = res.model.sheets[0];

// ── Имя модели и ось периодов ────────────────────────────────────────────────────────────
assert(res.model.name === 'Лангемак — финмодель', 'имя модели — из имени файла, без пути и расширения', res.model.name);
assertEqual(res.model.years, [2026, 2027, 2028], 'ось периодов собрана из шапки');

// ── Деление на панели ────────────────────────────────────────────────────────────────────
assert(sheet.panels.length === 2, 'лист разделён на две панели: до заголовка секции и после', '(' + sheet.panels.length + ')');
assert(sheet.panels[0].title === 'OpEx 1', 'панель без своего заголовка названа меткой первой строки', sheet.panels[0].title);
assert(sheet.panels[1].title === 'Отчёт о прибылях и убытках', 'секция без шапки лет начинается со своего заголовка', sheet.panels[1].title);
assert(sheet.panels[0].totalCol != null, 'колонка «Итог:» распознана — панель получит RG «сумма строки»');

// ── Строки, метки, значения ──────────────────────────────────────────────────────────────
assertEqual(sheet.panels[0].rows.map(function (r) { return r.name; }), ['ФОТ', 'Аренда', 'Итого:'],
    'строки панели — по ближней к периодам подписи');
assertEqual(sheet.panels[0].rows[2].label, 'OpEx 1', 'дальняя подпись ушла в «Метку», а не в имя');
assertEqual(sheet.panels[0].rows[0].values, { 2026: 10, 2027: 20, 2028: 30 }, 'значения разнесены по годам');
assertEqual(sheet.panels[0].rows[0].total, 60, 'значение колонки «Итог» прочитано отдельно');

// ── Формулы: своя панель переносится, чужие ссылки — в журнал ────────────────────────────
assert(sheet.panels[0].rows[2].formula === 'SUM(C2:C3)', 'формула внутри своей панели переносится', sheet.panels[0].rows[2].formula);
assert(sheet.panels[1].rows[1].formula === null, 'формула со ссылкой на параметр справа НЕ переносится');
var formulaEntries = res.journal.all().filter(function (e) { return e.kind === 'formula'; });
assert(formulaEntries.length === 1 && /C8\*I1/.test(formulaEntries[0].what),
    'непереносимая формула попала в журнал с исходным текстом', JSON.stringify(formulaEntries.map(function (e) { return e.what; })));

// ── Безымянная строка — в журнал, а не в модель ──────────────────────────────────────────
var unnamed = res.journal.all().filter(function (e) { return e.kind === 'unnamed-row'; });
assert(unnamed.length === 1 && unnamed[0].address === 'C6', 'строка с числами без подписи названа адресом ячейки', JSON.stringify(unnamed[0]));
var allRows = sheet.panels.reduce(function (a, p) { return a.concat(p.rows); }, []);
assert(allRows.every(function (r) { return r.name; }), 'ни одна строка модели не осталась без имени');

// ── Словарь периода: годы файла + 3 (решение заказчика 11.08.2026) ───────────────────────
assertEqual(DI.periodValues([2026, 2027, 2028], 3), [2026, 2027, 2028, 2029, 2030, 2031],
    'словарь периода = годы файла плюс запас в три года');
assertEqual(DI.periodValues([], 3), [], 'нет годов — нечего создавать');

// ── Журнал → текст issue ─────────────────────────────────────────────────────────────────
var text = res.journal.toIssueMarkdown();
assert(/^## Не перенеслось: Лангемак — финмодель/.test(text), 'журнал начинается заголовком с именем источника');
assert(/Инструмент: `dash-import`/.test(text), 'issue называет инструмент и приёмник — по тикету видно, чем переносили');
assert(/Перенесено записей: \*\*\d+\*\*, осталось за бортом: \*\*\d+\*\*/.test(text), 'issue начинается со сводки «перенесено / осталось» — иначе список читается как «всё сломалось»');
assert(/\| лист «Лист1» \| `[A-Z]+\d+` \|/.test(text), 'каждая запись называет источник и адрес');
assert(/C8\*I1/.test(text), 'в тексте issue видно исходное содержимое ячейки');

// ── Операции записи ──────────────────────────────────────────────────────────────────────
var schema = { dashboard: 559, sheet: 551, panel: 537, row: 509, rg: 525, values: 600,
               rgTypes: { rg: 574, line: 566 }, periodName: 'Год' };
var ops = DI.buildCreateOps(res.model, schema, {});
var kinds = ops.map(function (o) { return o.op; });
assert(kinds[0] === 'create-period-dict', 'первым делом создаётся словарь периода — на него ссылается дэшборд');
assert(kinds.indexOf('create-dashboard') === 1, 'дэшборд создаётся после словаря');
assert(ops.filter(function (o) { return o.op === 'create-panel'; }).length === 2, 'по операции на каждую панель');
assert(ops.filter(function (o) { return o.op === 'create-rg' && o.rgType === schema.rgTypes.line; }).length === 2,
    'у панели с колонкой «Итог» появляется RG «сумма строки»');
assert(ops.filter(function (o) { return o.op === 'create-value'; }).length === 15,
    'значений ровно столько, сколько чисел в строках модели', '(' + ops.filter(function (o) { return o.op === 'create-value'; }).length + ')');

// Дописывание в существующую модель: дэшборд и одноимённый лист переиспользуются (#4327).
var ops2 = DI.buildCreateOps(res.model, schema, { dashboardId: 636, sheetsByName: { 'Лист1': 700 }, periodTableId: 588 });
var kinds2 = ops2.map(function (o) { return o.op; });
assert(kinds2.indexOf('create-dashboard') === -1 && kinds2.indexOf('reuse-dashboard') !== -1,
    'модель с таким именем уже есть — дэшборд не создаётся заново');
assert(kinds2.indexOf('create-sheet') === -1 && kinds2.indexOf('reuse-sheet') !== -1,
    'лист с тем же именем переиспользуется — конвертор дописывает, а не плодит дубли');
assert(kinds2[0] === 'fill-period-dict', 'существующий словарь периода дополняется, а не пересоздаётся');

// ── #4709: справочник строк, дата периода, ключ значения, типы RG по коду ────────────────
// Значение связано со строкой модели НЕ ссылкой, а именем: запись «Значение» ссылается на
// справочник «Строка бюджета». Поэтому имена строк нужны в справочнике — и без дублей.
var names = DI.budgetRowNames(res.model);
assertEqual(names, ['ФОТ', 'Аренда', 'Итого:', 'Выручка', 'НДС'],
    '#4709: имена строк для справочника — в порядке появления, без повторов');

var dupModel = { sheets: [{ panels: [{ rows: [{ name: 'Выручка' }, { name: 'Выручка' }, { name: ' Выручка ' }] }] }] };
assertEqual(DI.budgetRowNames(dupModel), ['Выручка'],
    '#4709: одно имя — одна запись справочника, пробелы по краям не создают второй');

assert(DI.valueDateForYear(2026) === '01.01.2026',
    '#4709: период годовой оси хранится датой — первым числом года', DI.valueDateForYear(2026));

assert(DI.valueKey(' Выручка ', 2026, 'Revenue') === DI.valueKey('Выручка', '2026', 'Revenue'),
    '#4709: ключ значения не зависит от пробелов и типа года — повторный залив узнаёт своё число');
assert(DI.valueKey('Выручка', 2026, 'A') !== DI.valueKey('Выручка', 2026, 'B'),
    '#4709: метка входит в ключ — одна строка в разных метках это разные значения');

assertEqual(DI.rgTypeIdsByCode([{ i: 574, r: ['Repeating group', 'rg'] },
                                { i: 566, r: ['Сумма строки', 'line'] },
                                { i: 577, r: ['Пусто', ''] }]),
    { rg: '574', line: '566' },
    '#4709: тип RG резолвится ПО КОДУ (id записей в каждой базе свои), пустой код пропускается');

console.log('\n' + passed + ' проверок прошли из ' + total);
