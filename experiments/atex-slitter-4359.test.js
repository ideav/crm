// #4359 — пульт слиттера: станок события смены хранится ССЫЛКОЙ «Слиттер», а не только
// текстовой меткой «{станок} · {дата}» в «Примечаниях».
//
// Было: createEvent реквизит «Слиттер» не заполнял вовсе (в отчёте slitter_shift_events поле
// slitter_id пустое у каждого события), а принадлежность события станку выводилась разбором
// «Примечаний». Метка есть только у «Начало/Конец смены» — события резки к станку не относились
// никак; переименование станка в справочнике отвязывало все прошлые события.
//
// Стало: createEvent пишет t{Слиттер} = id записи справочника у ВСЕХ событий; чтение берёт
// slitter_id (отчёт) / ссылку «Слиттер» (прямое чтение таблицы); сверка идёт id-с-id, а метка
// в «Примечаниях» осталась запасным путём для событий, записанных до появления реквизита.
//
// Проверено на боевой ateh: t642887=1277 → сырьё "1277:Станок 1", отчёт slitter_id="1277".
//
// Run with: node experiments/atex-slitter-4359.test.js

process.env.TZ = 'Europe/Moscow';
var api = require('../download/atex/js/slitter.js');
var Controller = api.Controller;
var core = api.core;

var passed = 0, total = 0;
function assert(cond, name) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}
function assertEqual(actual, expected, name) {
    assert(JSON.stringify(actual) === JSON.stringify(expected),
        name + (JSON.stringify(actual) === JSON.stringify(expected) ? ''
            : ' (ожидалось ' + JSON.stringify(expected) + ', получено ' + JSON.stringify(actual) + ')'));
}

// Реальная схема ateh: таблица 1082 «Событие смены», реквизит 642887 «Слиттер» (ref 1070).
var EVENT_META = { id: '1082', reqs: [
    { id: '1196', val: 'Пользователь' },
    { id: '1198', val: 'Значение' },
    { id: '1199', val: 'Примечания' },
    { id: '16415', val: 'Задание в производство' },
    { id: '16417', val: 'Задача на втулки' },
    { id: '16419', val: 'Тип события' },
    { id: '642887', val: 'Слиттер' }
] };

// ── запись: событие уносит станок ссылкой (id записи справочника, не подпись) ──────────────────
function makeWriter() {
    var inst = Object.create(Controller.prototype);
    inst.meta = { event: EVENT_META };
    inst.userId = '1640';
    inst.selectedSlitterId = '1277';           // «Станок 1» в справочнике 1070
    inst.selectedSlitterLabel = function() { return 'Станок 1'; };
    inst.selectedDate = '2026-07-23';
    inst.eventDateTime = function() { return '2026-07-24 11:53:00'; };
    inst.posts = [];
    inst.post = function(path, params) { this.posts.push({ path: path, params: params }); return Promise.resolve({}); };
    return inst;
}

var w = makeWriter();
w.createEvent({ type: 'Начало смены', notes: 'Станок 1 · 2026-07-23' }, null);
assertEqual(w.posts[0].path, '_m_new/1082?JSON&up=1', '#4359: событие пишется в таблицу событий (up=1)');
assertEqual(w.posts[0].params['t642887'], '1277',
    '#4359: «Слиттер» = ID записи справочника (ref-поле принимает id, не подпись)');
assertEqual(w.posts[0].params['t1199'], 'Станок 1 · 2026-07-23',
    '#4359: метка в «Примечаниях» продолжает писаться — читаемо человеком и совместимо со старым разбором');

// событие РЕЗКИ тоже уносит станок — раньше у него не было ни метки, ни ссылки
var w2 = makeWriter();
w2.createEvent({ type: 'Резка' }, '625873');
assertEqual(w2.posts[0].params['t642887'], '1277', '#4359: событие резки тоже несёт «Слиттер»');
assertEqual(w2.posts[0].params['t16415'], '625873', '#4359: связь с заданием сохранена');

// станка не выбрано — ссылку не пишем (пустой ref не создаём)
var w3 = makeWriter();
w3.selectedSlitterId = '';
w3.createEvent({ type: 'Начало смены' }, null);
assert(!('t642887' in w3.posts[0].params), '#4359: станок не выбран → «Слиттер» не пишем');

// ── чтение: отчёт (slitter_id) и прямое чтение таблицы (ссылка «Слиттер») ──────────────────────
var fromReport = core.rowsToShiftEvents([
    { event_id: '642899', event_when: '1784884200', event_type: 'Начало смены',
      event_user_id: '1640', event_user: 'operator', event_notes: 'Станок 1 · 2026-07-23',
      event_cut_id: '', slitter_id: '1277' }
]);
assertEqual(fromReport[0].slitterId, '1277', '#4359: rowsToShiftEvents берёт станок из slitter_id отчёта');

var reader = Object.create(Controller.prototype);
reader.meta = { event: EVENT_META };
// сырая строка ateh: [when, Пользователь, Значение, Примечания, Задание, Втулки, Тип, Слиттер]
var fromTable = reader.parseEventRows([
    { i: 642899, u: 1, r: ['1784884200', '1640:operator', '', 'Станок 1 · 2026-07-23', '', '', '54237:Начало смены', '1277:Станок 1'] }
]);
assertEqual(fromTable[0].slitterId, '1277', '#4359: parseEventRows берёт станок из ссылки «Слиттер»');
assertEqual(fromTable[0].slitter, 'Станок 1', '#4359: подпись станка тоже разобрана');
assertEqual(fromTable[0].type, 'Начало смены', '#4359: тип события по-прежнему разбирается');

// ── смена открывается по ССЫЛКЕ, а не по тексту ────────────────────────────────────────────────
function ev(o) {
    return { id: o.id || '1', when: o.when || '1784884200', type: o.type || 'Начало смены',
             userId: '1640', notes: o.notes == null ? '' : o.notes, slitterId: o.slitterId || null };
}

// станок переименовали в справочнике: метка в старом событии осталась прежней, ссылка — верна
assert(core.hasOpenShift([ev({ notes: 'Станок 1 · 2026-07-23', slitterId: '1277' })],
    '1640', '2026-07-23', 'Слиттер №1 (Станок 1)', '1277') === true,
    '#4359: станок переименован — смена по ссылке всё равно открыта (метка бы не совпала)');

// событие ЧУЖОГО станка не открывает смену, даже если метка совпала (мусор в «Примечаниях»)
assert(core.hasOpenShift([ev({ notes: 'Станок 1 · 2026-07-23', slitterId: '1279' })],
    '1640', '2026-07-23', 'Станок 1', '1277') === false,
    '#4359: ссылка на другой станок — смена этого станка НЕ открыта, метка не спасает');

// две смены на разных станках одного оператора разведены по ссылке
var two = [
    ev({ id: 'a', when: '1784884200', type: 'Начало смены', slitterId: '1277' }),
    ev({ id: 'b', when: '1784884300', type: 'Конец смены', slitterId: '1279' })
];
assert(core.hasOpenShift(two, '1640', '2026-07-23', 'Станок 1', '1277') === true,
    '#4359: «Конец смены» на Станке 2 не закрывает смену Станка 1');
assert(core.hasOpenShift(two, '1640', '2026-07-23', 'Станок 2', '1279') === false,
    '#4359: у Станка 2 последнее событие — «Конец смены» → закрыта');

// обратная совместимость: событие без ссылки (записано до #4359) — по метке в «Примечаниях»
assert(core.hasOpenShift([ev({ notes: 'Станок 1 · 2026-07-23' })],
    '1640', '2026-07-23', 'Станок 1', '1277') === true,
    '#4359: старое событие без ссылки — смена открывается по метке (#3522)');
assert(core.hasOpenShift([ev({ notes: 'Станок 2 · 2026-07-23' })],
    '1640', '2026-07-23', 'Станок 1', '1277') === false,
    '#4359: старое событие чужого станка смену не открывает');

// вызов без станка (старая сигнатура из тестов #4332) фильтр по станку не применяет
assert(core.hasOpenShift([ev({ slitterId: '1279' })], '1640', '2026-07-23') === true,
    '#4359: станок не задан — фильтра по станку нет (совместимость сигнатуры)');

// ── shiftEventMatchesSlitter точечно ───────────────────────────────────────────────────────────
assert(core.shiftEventMatchesSlitter(ev({ slitterId: '1277' }), '1277', 'Станок 1') === true,
    '#4359: matcher — ссылка совпала');
assert(core.shiftEventMatchesSlitter(ev({ slitterId: '1277', notes: 'Станок 9 · x' }), '1279', 'Станок 9') === false,
    '#4359: matcher — ссылка есть и не совпала: метка не подменяет её');
assert(core.shiftEventMatchesSlitter(ev({ notes: 'Станок 1 · x' }), '1277', 'Станок 1') === true,
    '#4359: matcher — ссылки нет, метка совпала');
assert(core.shiftEventMatchesSlitter(ev({ notes: '' }), '1277', 'Станок 1') === false,
    '#4359: matcher — ни ссылки, ни метки → станок не определён');
assert(core.shiftEventMatchesSlitter(ev({ slitterId: '1279' }), '', '') === true,
    '#4359: matcher — фильтр не задан → подходит любое событие');

// ── лента событий станка: событие со ссылкой попадает к своему станку ──────────────────────────
var feed = Object.create(Controller.prototype);
feed.selectedSlitterId = '1277';
feed.selectedSlitterLabel = function() { return 'Станок 1'; };
feed.cuts = [{ id: '625873', slitterId: '1277' }, { id: '625880', slitterId: '1279' }];
feed.shiftEvents = [
    ev({ id: 'own', when: '1784884200', type: 'Наладка', slitterId: '1277' }),
    ev({ id: 'alien', when: '1784884260', type: 'Наладка', slitterId: '1279' }),
    ev({ id: 'legacy-cut', when: '1784884300', type: 'Резка' })
];
feed.shiftEvents[2].cutId = '625873';   // старое событие резки — через слиттер резки
var ids = feed.eventsForSelectedSlitter().map(function(x) { return x.ev.id; }).sort();
assertEqual(ids, ['legacy-cut', 'own'],
    '#4359: в ленте станка — его событие по ссылке и старое событие резки; чужое отсеяно');

// ── пустой отчёт не выдаётся за «событий нет» (симптом тикета: смена «закрыта», кнопок нет) ────
function makeLoader(reportRows, tableEvents) {
    var inst = Object.create(Controller.prototype);
    inst.notes = [];
    inst.notify = function(msg) { this.notes.push(msg); };
    inst.getJson = function() { return Promise.resolve(reportRows); };
    inst.fellBack = false;
    inst.loadShiftEventsFromTable = function() {
        this.fellBack = true;
        this.allEvents = tableEvents;
        return Promise.resolve();
    };
    inst.applyLoadedEvents = function(all) { this.allEvents = all; };
    return inst;
}

var okLoad = makeLoader([{ event_id: '1', event_when: '1784884200', event_type: 'Начало смены', slitter_id: '1277' }], []);
var brokenReport = makeLoader([], [{ id: '1', type: 'Начало смены', slitterId: '1277' }]);
var trulyEmpty = makeLoader([], []);

Promise.all([okLoad.loadShiftEvents(), brokenReport.loadShiftEvents(), trulyEmpty.loadShiftEvents()]).then(function() {
    assert(okLoad.fellBack === false && okLoad.allEvents.length === 1,
        '#4359: отчёт отдал события — прямое чтение не понадобилось');
    assert(brokenReport.fellBack === true && brokenReport.allEvents.length === 1,
        '#4359: отчёт пуст, а в таблице события есть — читаем таблицу, смена не «теряется»');
    assert(brokenReport.notes.join(' ').indexOf('Отчёт событий смены пуст') !== -1,
        '#4359: про враньё отчёта ОРЁМ (тост + console.error), а не чиним молча');
    assert(trulyEmpty.fellBack === true && trulyEmpty.notes.length === 0,
        '#4359: событий действительно нет — перепроверили и промолчали');

    console.log('\n' + passed + '/' + total + ' assertions passed');
    if (passed !== total) process.exitCode = 1;
});
