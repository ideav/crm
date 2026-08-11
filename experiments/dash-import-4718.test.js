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
    { id: '473', val: 'Тип RG', reqs: [req(475, 'Код', 'Код')] }, { id: '481', val: 'Период', reqs: [] },
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

// ── Повторный залив не плодит дубли (#4327) — общим планом справочника ──────────────────────
assertEqual(DI.dictPlan(DI.yearDictRows([2026, 2027], 0), [{ i: 1, r: ['2026'] }], {})
                .create.map(function (r) { return r.name; }), ['2027'],
    'существующий год переиспользуется, создаётся только недостающий');
assertEqual(DI.dictPlan(DI.yearDictRows([2026], 0), [{ i: 1, r: [' 2026 '] }], {}).create, [],
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
// Экран строит его ровно так же: спека справочника «Год» из dictSpecs → dictPlan.
function yearsPlan(sch, model, existing) {
    var spec = DI.dictSpecs(sch, model, 3).filter(function (s) { return s.key === 'years'; })[0];
    return { spec: spec, plan: DI.dictPlan(spec.needed, existing, {}) };
}
var years = yearsPlan(schema, MODEL, []);
assert(years.spec.table === 490, 'план пишет в таблицу словаря периода', String(years.spec.table));
assertEqual(years.plan.create.map(function (r) { return r.name; }),
    ['2026', '2027', '2028', '2029', '2030', '2031'],
    'план создаёт годы файла плюс запас — по ним появятся колонки модели');
assertEqual(years.plan.create[0].fields, { 491: '01.01.2026', 492: '31.12.2026' },
    'поля записи адресуются id реквизитов границ — «С» и «По» уходят в базу вместе с именем');
assert(years.plan.create.length > 0,
    'план заполнения словаря НЕ пустой — именно его отсутствие оставило /finmo/table/490 пустой');

var again = yearsPlan(schema, MODEL,
    ['2026', '2027', '2028', '2029', '2030', '2031'].map(function (n) { return { i: n, r: [n] }; }));
assertEqual(again.plan.create, [], 'повторный залив того же файла не создаёт ни одной лишней записи');

assert(noBounds.dictProblems.length > 0 && /«С» и «По»/.test(noBounds.dictProblems.join('; ')),
    'при названной проблеме экран останавливается ДО записи модели — план даже не строится');

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

// ── Справочники вообще: один путь на все четыре ─────────────────────────────────────────────
// Модель держится на четырёх справочниках, и каждый умел отвалиться молча: «Год» не заполнялся
// (#4718), «Тип RG» и «Строка бюджета» на пустой ответ подставляли {} — панель оставалась без
// колонок, числа не писались, а экран рапортовал «Готово».
var MODEL2 = { name: 'М', years: [2026, 2027, 2028], sheets: [{ panels: [
    { title: 'P&L', totalCol: 15, rows: [{ name: 'Выручка' }, { name: 'ФОТ' }] }] }] };

var specs = DI.dictSpecs(schema, MODEL2, 3);
assertEqual(specs.map(function (s) { return s.key; }), ['period', 'years', 'rgTypes', 'budget'],
    'справочники обрабатываются одним списком и в нужном порядке: вид оси и годы — до дэшборда');
assertEqual(specs.map(function (s) { return s.table; }), [481, 490, 473, 493],
    'у каждого справочника найдена своя таблица');
assertEqual(specs[0].needed, [{ name: 'Год' }],
    'в «Периоде» нужна запись вида оси — на неё ссылается дэшборд');
assertEqual(specs[2].needed.map(function (n) { return n.key; }), ['rg', 'line'],
    'у панели есть колонка «Итог» — нужен и режим суммы строки');
assertEqual(specs[3].needed.map(function (n) { return n.name; }), ['Выручка', 'ФОТ'],
    'в «Строку бюджета» идут имена строк модели');

var noTotal = JSON.parse(JSON.stringify(MODEL2));
noTotal.sheets[0].panels[0].totalCol = null;
assertEqual(DI.dictSpecs(schema, noTotal, 3)[2].needed.map(function (n) { return n.key; }), ['rg'],
    'нет колонки «Итог» — лишний режим колонок не заводится');

// План: что создать, чему дописать ключ, что переиспользовать.
var pRg = DI.dictPlan(specs[2].needed,
    [{ i: 574, r: ['Repeating group', 'rg'] }], { keyCol: 1, keyReq: 475 });
assertEqual(pRg.index, { rg: '574' }, 'существующий режим найден ПО КОДУ, а не по названию');
assertEqual(pRg.create.map(function (c) { return [c.name, c.fields[475]]; }),
    [['Сумма строки', 'line']],
    'недостающий режим создаётся вместе с кодом — без кода рабочее место его не узнает');

var pPatch = DI.dictPlan([{ name: 'Repeating group', key: 'rg' }],
    [{ i: 700, r: ['Repeating group', ''] }], { keyCol: 1, keyReq: 475 });
assertEqual([pPatch.create.length, pPatch.patch, pPatch.index],
    [0, [{ id: '700', name: 'Repeating group', key: 'rg', fields: { 475: 'rg' } }], { rg: '700' }],
    'запись есть, а код пустой — код дописывается правкой, дубль не заводится');

var pDup = DI.dictPlan([{ name: 'Выручка' }, { name: 'Выручка' }], [], {});
assertEqual(pDup.create.length, 1, 'повтор в списке нужного не создаёт вторую запись справочника');

var pReuse = DI.dictPlan([{ name: 'Выручка' }, { name: 'ФОТ' }],
    [{ i: 11, r: [' Выручка '] }], {});
assertEqual([pReuse.index, pReuse.create.map(function (c) { return c.name; })],
    [{ 'Выручка': '11' }, ['ФОТ']],
    'существующая запись переиспользуется (пробелы по краям не мешают), создаётся только новая');

// Недостача справочников называется ДО записи — всеми пунктами сразу.
assertEqual(schema.dictProblems, [], 'на полной схеме претензий к справочникам нет');

function without(id) { return META.filter(function (t) { return t.id !== id; }); }
assert(/нет справочника «Тип RG»/.test(DI.resolveSchema(META.map(function (t) {
        return t.id === '525' ? { id: '525', val: 'RG', reqs: [] } : t; })).dictProblems.join('; ')),
    'нет справочника «Тип RG» — сказано словами, панели без колонок не создаются молча');

assert(/нет колонки «Код»/.test(DI.resolveSchema(META.map(function (t) {
        return t.id === '473' ? { id: '473', val: 'Тип RG', reqs: [] } : t; })).dictProblems.join('; ')),
    '«Тип RG» без «Кода» — тоже стоп: рабочее место сравнивает код, а не название');

assert(/нет справочника «Строка бюджета»/.test(DI.resolveSchema(META.map(function (t) {
        return t.id === '496' ? { id: '496', val: 'Значение', reqs: [] } : t; })).dictProblems.join('; ')),
    'нет «Строки бюджета» — стоп: раньше в этом месте молча терялись все числа');

assert(/нет справочника «Период»/.test(DI.resolveSchema(META.map(function (t) {
        return t.id === '559'
            ? { id: '559', val: 'Дэшборд', reqs: [req(563, 'Лист', 'Лист', 551)] } : t; })).dictProblems.join('; ')),
    'нет «Периода» — дэшборду нечем назвать свою ось');

console.log('\n' + passed + ' проверок прошли из ' + total);
