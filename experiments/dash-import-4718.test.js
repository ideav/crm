// #4718 — после переноса модели таблица «Год» осталась пустой (боевая база finmo, /finmo/table/490).
//
// Что было: ядро отдавало операцию `create-period-dict` (её проверяет тест #4704), но экран
// исполнял СВОЮ цепочку записи и словарь периода не трогал вовсе. Модель, листы, панели, строки
// и значения создавались, годы — нет. Рабочее место `dash` без записей словаря рисует модель БЕЗ
// КОЛОНОК: `dashFilterPeriodDict` (js/dash.js) отбрасывает строку словаря, у которой нет «С» и
// «По», а тут не было и самих строк.
//
// Поэтому здесь проверяется не «функция считает годы», а ПЛАН ЗАПИСИ целиком: какая таблица,
// какие записи, с какими границами и что план говорит, когда словаря в базе нет.
// Плюс трасса отладки (панель выгрузки) — второе требование тикета.
//
// Run with: node experiments/dash-import-4718.test.js

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

// Метаданные finmo в миниатюре: словарь «Год» с границами «С_т»/«По_т» (в UI — «С»/«По»).
function req(id, val, alias, target, kind) {
    var r = { id: String(id), val: val, attrs: JSON.stringify({ alias: alias || val }) };
    if (target) r[kind || 'arr_id'] = String(target);
    return r;
}
var META = [
    { id: '559', val: 'Дэшборд', reqs: [req(562, 'Период', 'Период', 481, 'ref'), req(563, 'Лист', 'Лист', 551)] },
    { id: '551', val: 'Лист',    reqs: [req(552, 'Панель', 'Панель', 537), req(554, 'Год', 'Год', 490, 'ref')] },
    { id: '537', val: 'Панель',  reqs: [req(538, 'Строка', 'Строка', 509), req(539, 'RG', 'RG', 525)] },
    { id: '509', val: 'Строка',  reqs: [req(515, 'Формула_т', 'Формула'), req(524, 'Метка_т', 'Метка')] },
    { id: '525', val: 'RG',      reqs: [req(527, 'Тип RG', 'Тип RG', 473, 'ref')] },
    { id: '496', val: 'Значение', reqs: [req(498, 'Дата_т', 'Дата'), req(500, 'Строка бюджета', 'Строка бюджета', 493, 'ref'),
                                         req(508, 'Метка_т', 'Метка')] },
    { id: '473', val: 'Тип RG', reqs: [] }, { id: '481', val: 'Период', reqs: [] },
    { id: '493', val: 'Строка бюджета', reqs: [] },
    { id: '490', val: 'Год', reqs: [req(491, 'С_т', 'С'), req(492, 'По_т', 'По')] }
];
var MODEL = { name: 'Лангемак', years: [2026, 2027, 2028] };

// ── Записи словаря: имя + ОБЕ границы ───────────────────────────────────────────────────────
assertEqual(DI.yearDictRows([2026, 2027], 1),
    [{ name: '2026', from: '01.01.2026', to: '31.12.2026' },
     { name: '2027', from: '01.01.2027', to: '31.12.2027' },
     { name: '2028', from: '01.01.2028', to: '31.12.2028' }],
    'год словаря — это имя и границы года; запас лет тот же, что у periodValues');

assert(DI.yearDictRows([2026], 0).every(function (r) { return r.from && r.to; }),
    'ни одна запись не уходит без «С» и «По» — без границ `dash` её отбрасывает');

assertEqual(DI.yearDictRows([], 3), [], 'нет годов в файле — словарь не трогаем');

// ── Повторный залив не плодит дубли (#4327) ─────────────────────────────────────────────────
assertEqual(DI.missingDictRows(DI.yearDictRows([2026, 2027], 0), ['2026'])
                .map(function (r) { return r.name; }), ['2027'],
    'существующий год переиспользуется, создаётся только недостающий');
assertEqual(DI.missingDictRows(DI.yearDictRows([2026], 0), [' 2026 ']), [],
    'пробелы по краям имени в базе не создают второй такой же год');

// ── Таблица словаря ищется по имени периода, как её читает `dash` ───────────────────────────
var pt = DI.periodDictTable(META, 'Год', null);
assertEqual([pt.id, pt.from, pt.to], [490, 491, 492],
    'таблица «Год» найдена по имени, границы — по псевдонимам «С»/«По» (тип «С_т»)');

var DOUBLE = [{ id: '77', val: 'Год', reqs: [] }].concat(META);
assert(DI.periodDictTable(DOUBLE, 'Год', null).id === 490,
    'из одноимённых таблиц берётся та, у которой есть границы (#4714 — имена не уникальны)',
    String(DI.periodDictTable(DOUBLE, 'Год', null).id));

var RENAMED = META.map(function (t) { return t.id === '490' ? { id: '490', val: 'Годы', reqs: t.reqs } : t; });
assert(DI.periodDictTable(RENAMED, 'Год', 490).id === 490,
    'словарь переименован — находим по ссылке «Год» листа');
assert(DI.periodDictTable([{ id: '1', val: 'Что-то', reqs: [] }], 'Год', null) === null,
    'словаря нет вовсе — честный null, а не «что-то похожее»');

// ── Схема называет проблему словаря ДО записи ───────────────────────────────────────────────
var schema = DI.resolveSchema(META);
assertEqual([schema.periodTable, schema.req.yearFrom, schema.req.yearTo], [490, 491, 492],
    'схема отдаёт таблицу словаря и обе колонки границ');
assert(schema.periodDictProblem === null, 'на полной схеме проблем со словарём нет',
    String(schema.periodDictProblem));

var noDict = DI.resolveSchema(META.filter(function (t) { return t.id !== '490'; })
                                  .map(function (t) {
                                      return t.id === '551'
                                          ? { id: '551', val: 'Лист', reqs: [req(552, 'Панель', 'Панель', 537)] } : t; }));
assert(/нет таблицы-словаря/.test(String(noDict.periodDictProblem)),
    'нет таблицы «Год» — схема говорит об этом словами', String(noDict.periodDictProblem));

var noBounds = DI.resolveSchema(META.map(function (t) {
    return t.id === '490' ? { id: '490', val: 'Год', reqs: [] } : t; }));
assert(/«С» и «По»/.test(String(noBounds.periodDictProblem)),
    'словарь без границ — тоже названная проблема, а не тихий пропуск', String(noBounds.periodDictProblem));

// ── ПЛАН ЗАПИСИ: тот самый шаг, которого не было ────────────────────────────────────────────
var plan = DI.yearDictPlan(schema, MODEL, [], 3);
assert(plan.table === 490, 'план пишет в таблицу словаря периода', String(plan.table));
assertEqual(plan.rows.map(function (r) { return r.name; }),
    ['2026', '2027', '2028', '2029', '2030', '2031'],
    'план создаёт годы файла плюс запас — по ним появятся колонки модели');
assertEqual(plan.rows[0].fields, { 491: '01.01.2026', 492: '31.12.2026' },
    'поля записи адресуются id реквизитов границ — «С» и «По» уходят в базу вместе с именем');
assert(plan.rows.length > 0,
    'план заполнения словаря НЕ пустой — именно его отсутствие оставило /finmo/table/490 пустой');

var planAgain = DI.yearDictPlan(schema, MODEL, ['2026', '2027', '2028', '2029', '2030', '2031'], 3);
assertEqual(planAgain.rows, [], 'повторный залив того же файла не создаёт ни одной лишней записи');

var planBroken = DI.yearDictPlan(noBounds, MODEL, [], 3);
assertEqual([planBroken.rows.length, planBroken.problem === null], [0, false],
    'при названной проблеме план пуст — экран останавливается ДО записи модели');

// ── Трасса отладки (второе требование тикета) ───────────────────────────────────────────────
var tick = 0;
var trace = DI.createTrace({ db: 'finmo', file: 'Лангемак.xlsx' }, function () { return (tick += 10); });
trace.add('выбран файл', { rows: 70 });
trace.api('GET metadata?JSON', { status: 200 });
trace.error('POST _m_new/490', { status: 403, answer: 'нет доступа' });
trace.count('years', 6);
trace.count('years');

assertEqual(trace.all().map(function (e) { return e.kind; }), ['step', 'api', 'error'],
    'трасса различает шаг, запрос и ошибку');
assert(trace.all()[1].ms === 20, 'у каждой записи своё смещение по времени', String(trace.all()[1].ms));
assertEqual(trace.errors().length, 1, 'ошибки достаются отдельно — их читают первыми');
assertEqual(trace.counters(), { years: 7 }, 'счётчики складываются');

var json = trace.toJSON();
assertEqual([json.tool, json.db, json.file, json.entries.length], ['dash-import', 'finmo', 'Лангемак.xlsx', 3],
    'выгрузка называет инструмент, базу и файл — по ней разбирают чужой прогон');

var big = DI.createTrace({}, function () { return (tick += 1); });
for (var i = 0; i < 300; i++) big.add('создано в таблице 509', { i: i });
big.error('последний шаг упал', { message: 'таймаут' });
var text = big.toText(50);
assert(text.split('\n').length < 60, 'на экран идёт хвостом урезанная трасса, а не 300 строк',
    String(text.split('\n').length));
assert(/ещё \d+ записей/.test(text), 'урезание названо вслух — иначе читается как «это всё»');
assert(/последний шаг упал/.test(text),
    'ошибка показывается даже за пределами лимита — ради неё панель и открывают');

console.log('\n' + passed + ' проверок прошли из ' + total);
