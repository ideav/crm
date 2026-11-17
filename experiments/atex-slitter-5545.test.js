// #5545 — пульт слиттера: после «Закрыть смену» снова появляется «Открыть смену», сколько бы
// событий ни накопилось в журнале.
//
// Отчёт report/slitter_shift_events без сортировки отдаёт строки СТАРЫМИ ВПЕРЁД. Пульт читал его
// одним запросом LIMIT=0,5000; на боевой ateh 17.11.2026 в журнале 5076 событий — всё после
// 5000-го (в том числе сегодняшние «Конец смены») до пульта не доходило, и последним событием
// станка оставалось утреннее «Начало смены»: смена для пульта не закрывалась.
//
// Правило: пульт берёт последние 1000 событий, НОВЫЕ СВЕРХУ — отчёт с ORDER=-{колонка
// event_when}, запасное прямое чтение таблицы с ORDER=-{id таблицы}. Длина журнала не важна.
//
// rules: none (defect #5545)
// Run with: node experiments/atex-slitter-5545.test.js

process.env.TZ = 'Europe/Moscow';
var api = require('../download/atex/js/slitter.js');
var Controller = api.Controller;

var passed = 0, total = 0;
function assert(cond, name) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}

// Журнал станка 1277 в порядке записи: «Начало смены», n-2 события резки, последним — lastType.
var T0 = 1785605362;
function journal(n, lastType) {
    var list = [{ id: 1, when: T0, type: 'Начало смены' }];
    for (var i = 2; i < n; i++) list.push({ id: i, when: T0 + i * 60, type: 'Резка', cut: '900' });
    list.push({ id: n, when: T0 + n * 60, type: lastType });
    return list;
}
function toReportRow(ev) {
    return { event_id: String(ev.id), event_when: String(ev.when), event_type: ev.type, event_user_id: '1640',
        event_notes: ev.cut ? '' : 'Станок 1', event_cut_id: ev.cut || '', slitter_id: '1277' };
}
// JSON_OBJ таблицы 1082 (реальная схема ateh): r[0] — время, далее реквизиты в порядке meta.reqs.
var EVENT_META = { id: '1082', reqs: [
    { id: '1196', val: 'Пользователь' }, { id: '1198', val: 'Значение' }, { id: '1199', val: 'Примечания' },
    { id: '16415', val: 'Задание в производство' }, { id: '16417', val: 'Задача на втулки' },
    { id: '16419', val: 'Тип события' }, { id: '642887', val: 'Слиттер' }
] };
function toObjRow(ev) {
    return { i: ev.id, u: 1, o: 1, r: [String(ev.when), '1640:operator', '', ev.cut ? '' : 'Станок 1',
        ev.cut ? ev.cut + ':1785474000' : '', '', '1:' + ev.type, '1277:Станок 1'] };
}

// Сервер как боевой Интеграм: без ORDER — старыми вперёд, ORDER=-… — новыми вперёд; LIMIT=offset,count.
function serve(events, opts) {
    opts = opts || {};
    return function(path) {
        this.requests.push(path);
        var isReport = path.indexOf('report/') === 0;
        if (isReport && opts.reportEmpty) return Promise.resolve([]);
        var list = events.slice();
        if (/[?&]ORDER=-/.test(path)) list.reverse();
        var m = /LIMIT=(\d+),(\d+)/.exec(path);
        list = list.slice(m ? +m[1] : 0, m ? +m[1] + +m[2] : list.length);
        return Promise.resolve(list.map(isReport ? toReportRow : toObjRow));
    };
}

function makePult(events, opts) {
    var inst = Object.create(Controller.prototype);
    inst.meta = { event: EVENT_META };
    inst.userId = '1640';
    inst.selectedSlitterId = '1277';
    inst.selectedSlitterLabel = function() { return 'Станок 1'; };
    inst.selectedDate = '2026-11-17';
    inst.cuts = [];
    inst.currentCutId = null;
    inst.requests = [];
    inst.notify = function() {};
    inst.getJson = serve(events, opts);
    return inst;
}

var cases = [
    { n: 5076, last: 'Конец смены', open: false, name: 'журнал 5076, последним «Конец смены» → смена закрыта' },
    { n: 5076, last: 'Начало смены', open: true, name: 'журнал 5076, последним «Начало смены» → смена открыта' },
    { n: 50000, last: 'Конец смены', open: false, name: 'журнал 50000 → смена закрыта' },
    { n: 12, last: 'Конец смены', open: false, name: 'журнал 12 → смена закрыта' },
    { n: 5076, last: 'Конец смены', open: false, reportEmpty: true,
        name: 'отчёт пуст, запасное чтение таблицы, журнал 5076 → смена закрыта' }
];

var chain = Promise.resolve();
cases.forEach(function(c) {
    chain = chain.then(function() {
        var pult = makePult(journal(c.n, c.last), { reportEmpty: c.reportEmpty });
        return pult.loadShiftEvents().then(function() {
            assert(pult.isShiftOpen() === c.open, c.name);
            assert(pult.allEvents.length === Math.min(c.n, 1000), c.name + ': прочитано min(журнал, 1000) событий (получено '
                + pult.allEvents.length + ')');
            var newest = String(c.n);
            assert(pult.allEvents.some(function(ev) { return String(ev.id) === newest; }),
                c.name + ': самое свежее событие в выборке');
        });
    });
});

chain.then(function() {
    console.log('\n' + passed + '/' + total + ' passed');
}).catch(function(err) {
    console.error(err);
    process.exitCode = 1;
});
