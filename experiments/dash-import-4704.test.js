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

// ── #4711: у создаваемой записи ВСЕГДА есть родитель ─────────────────────────────────────
// Ядро отвечает «Недопустимые данные: up=0. Установите значение=1 для независимых объектов»,
// поэтому `up` обязателен в КАЖДОМ создании — и решается это в одном месте, а не в вызовах.
assert(DI.newObjectPath(559) === '_m_new/559?JSON&up=1',
    '#4711: независимый объект создаётся с up=1', DI.newObjectPath(559));
assert(DI.newObjectPath(551, '636') === '_m_new/551?JSON&up=636',
    '#4711: подчинённая запись создаётся с id владельца', DI.newObjectPath(551, '636'));
assert(DI.newObjectPath(509, 0) === '_m_new/509?JSON&up=1' &&
       DI.newObjectPath(496, '') === '_m_new/496?JSON&up=1' &&
       DI.newObjectPath(490, null) === '_m_new/490?JSON&up=1',
    '#4711: пустой, нулевой и неуказанный родитель одинаково дают up=1 — «up=0» в ядро не уходит');
assert(DI.newObjectPath(525, 'a b').indexOf('up=a%20b') !== -1,
    '#4711: значение родителя экранируется в адресе');

// ── #4714: схема берётся ПО ИЕРАРХИИ, а не по именам таблиц ──────────────────────────────
// В базе бывают одноимённые таблицы: в finmo «Панель» — это и 138, и 537. Резолв по имени брал
// чужую, и запись отвечала «У вас нет доступа к реквизиту объекта … 138». Настоящую цепочку
// задаёт сама модель: Дэшборд → «Лист» → Лист → «Панель» → Панель → «Строка»/«RG».
function req(id, val, alias, target, kind) {
    var r = { id: String(id), val: val, attrs: JSON.stringify({ alias: alias || val }) };
    if (target) r[kind || 'arr_id'] = String(target);
    return r;
}
var META = [
    // Ловушка: одноимённая «Панель» с тем же числом реквизитов, но вне иерархии модели.
    { id: '138', val: 'Панель', reqs: [req(139, 'Строка', 'Строка', 999), req(140, 'RG', 'RG', 998)] },
    { id: '559', val: 'Дэшборд', reqs: [req(562, 'Период', 'Период', 481, 'ref'), req(563, 'Лист', 'Лист', 551)] },
    { id: '551', val: 'Лист',    reqs: [req(552, 'Панель', 'Панель', 537), req(554, 'Год', 'Год', 490, 'ref')] },
    { id: '537', val: 'Панель',  reqs: [req(538, 'Строка', 'Строка', 509), req(539, 'RG', 'RG', 525)] },
    { id: '509', val: 'Строка',  reqs: [req(515, 'Формула_т', 'Формула'), req(524, 'Метка_т', 'Метка')] },
    { id: '525', val: 'RG',      reqs: [req(527, 'Тип RG', 'Тип RG', 473, 'ref')] },
    { id: '496', val: 'Значение', reqs: [req(498, 'Дата_т', 'Дата'), req(500, 'Строка бюджета', 'Строка бюджета', 493, 'ref'),
                                         req(508, 'Метка_т', 'Метка')] },
    { id: '473', val: 'Тип RG', reqs: [] }, { id: '490', val: 'Год', reqs: [] },
    { id: '481', val: 'Период', reqs: [] }, { id: '493', val: 'Строка бюджета', reqs: [] }
];
var sch = DI.resolveSchema(META);
assert(sch.panel === 537,
    '#4714: панель взята ПО ИЕРАРХИИ (Лист → «Панель»), а не одноимённая 138', String(sch.panel));
assertEqual([sch.dashboard, sch.sheet, sch.row, sch.rg], [559, 551, 509, 525],
    '#4714: вся цепочка модели резолвится по ссылкам реквизитов');
assertEqual([sch.rgTypeDict, sch.values, sch.budgetRows, sch.periodDict, sch.yearTable],
    [473, 496, 493, 481, 490],
    '#4714: справочники найдены через реквизиты, которые на них смотрят');
assertEqual([sch.req.rowFormula, sch.req.rowLabel, sch.req.rgType, sch.req.valDate, sch.req.valRow, sch.req.valLabel],
    [515, 524, 527, 498, 500, 508],
    '#4714: реквизиты ищутся и по имени, и по псевдониму («Метка_т» ↔ «Метка»)');
assertEqual(sch.missing, [], '#4714: на полной схеме ничего не потеряно');

var noModel = DI.resolveSchema([{ id: '138', val: 'Панель', reqs: [] }]);
assert(noModel.missing.length >= 5 && !noModel.dashboard,
    '#4714: без таблиц модели схема честно называет недостачу, а не берёт что попало',
    JSON.stringify(noModel.missing));

console.log('\n' + passed + ' проверок прошли из ' + total);
