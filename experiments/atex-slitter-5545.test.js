// #5545 — пульт слиттера: после «Закрыть смену» снова появляется «Открыть смену», сколько бы
// событий ни накопилось в журнале.
//
// Отчёт report/slitter_shift_events отдавал строки СТАРЫМИ ВПЕРЁД, а пульт читал его одним
// запросом LIMIT=0,5000; на боевой ateh 17.11.2026 в журнале 5076 событий — всё после 5000-го
// (в том числе сегодняшние «Конец смены») до пульта не доходило, и последним событием станка
// оставалось утреннее «Начало смены»: смена для пульта не закрывалась.
//
// Правило: в определении отчёта сортировка «новые сверху» (event_when −1, event_id −2); пульт
// читает журнал с конца порциями по 1000 и останавливается, как только нашёл событие
// «Начало/Конец смены» выбранного станка или журнал кончился. Запасное прямое чтение таблицы —
// так же, с ORDER=-{id таблицы}.
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

var LABELS = { '1277': 'Станок 1', '1279': 'Станок 2' };
var T0 = 1785605362;
// Журнал в порядке записи. spec — список отрезков { n, slitter, type } (type по умолчанию «Резка»).
function journal(spec) {
    var list = [];
    spec.forEach(function(part) {
        for (var i = 0; i < part.n; i++) {
            var id = list.length + 1;
            list.push({ id: id, when: T0 + id * 60, type: part.type || 'Резка', slitter: part.slitter });
        }
    });
    return list;
}
function isShift(ev) { return /смены$/.test(ev.type); }
function toReportRow(ev) {
    return { event_id: String(ev.id), event_when: String(ev.when), event_type: ev.type, event_user_id: '1640',
        event_notes: isShift(ev) ? LABELS[ev.slitter] : '', event_cut_id: isShift(ev) ? '' : '900',
        slitter_id: ev.slitter };
}
// JSON_OBJ таблицы 1082 (реальная схема ateh): r[0] — время, далее реквизиты в порядке meta.reqs.
var EVENT_META = { id: '1082', reqs: [
    { id: '1196', val: 'Пользователь' }, { id: '1198', val: 'Значение' }, { id: '1199', val: 'Примечания' },
    { id: '16415', val: 'Задание в производство' }, { id: '16417', val: 'Задача на втулки' },
    { id: '16419', val: 'Тип события' }, { id: '642887', val: 'Слиттер' }
] };
function toObjRow(ev) {
    return { i: ev.id, u: 1, o: 1, r: [String(ev.when), '1640:operator', '', isShift(ev) ? LABELS[ev.slitter] : '',
        isShift(ev) ? '' : '900:1785474000', '', '1:' + ev.type, ev.slitter + ':' + LABELS[ev.slitter]] };
}

// Сервер как боевой Интеграм. Отчёт: порядок задан его определением (opts.reportOldestFirst —
// определение без сортировки). Таблица: без ORDER — старыми вперёд, ORDER=-… — новыми вперёд.
// LIMIT=offset,count.
function serve(events, opts) {
    opts = opts || {};
    return function(path) {
        this.requests.push(path);
        var isReport = path.indexOf('report/') === 0;
        if (isReport && opts.reportEmpty) return Promise.resolve([]);
        var list = events.slice();
        var newestFirst = isReport ? !opts.reportOldestFirst : /[?&]ORDER=-/.test(path);
        if (newestFirst) list.reverse();
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

var S1 = '1277', S2 = '1279';
var cases = [
    { name: 'журнал 5076, последним «Конец смены» станка → смена закрыта, одна порция',
        events: journal([{ n: 1, slitter: S1, type: 'Начало смены' }, { n: 5074, slitter: S1 }, { n: 1, slitter: S1, type: 'Конец смены' }]),
        open: false, requests: 1 },
    { name: 'журнал 5076, последним «Начало смены» станка → смена открыта, одна порция',
        events: journal([{ n: 5075, slitter: S1 }, { n: 1, slitter: S1, type: 'Начало смены' }]),
        open: true, requests: 1 },
    { name: 'смена станка открыта 2500 событий назад, дальше работал только другой станок → '
        + 'дочитано до неё, смена открыта',
        events: journal([{ n: 500, slitter: S1 }, { n: 1, slitter: S1, type: 'Начало смены' },
            { n: 2500, slitter: S2 }]),
        open: true, requests: 3 },
    { name: 'смена станка закрыта 1500 событий назад → дочитано, смена закрыта',
        events: journal([{ n: 1, slitter: S1, type: 'Начало смены' }, { n: 1, slitter: S1, type: 'Конец смены' },
            { n: 1500, slitter: S2 }]),
        open: false, requests: 2 },
    { name: 'у станка нет событий смены вовсе → журнал дочитан до конца, смена закрыта',
        events: journal([{ n: 3500, slitter: S2 }]),
        open: false, requests: 4 },
    { name: 'короткий журнал → одна порция',
        events: journal([{ n: 10, slitter: S1 }, { n: 1, slitter: S1, type: 'Конец смены' }]),
        open: false, requests: 1 },
    { name: 'отчёт пуст, запасное чтение таблицы: смена открыта 2500 событий назад → дочитано',
        events: journal([{ n: 1, slitter: S1, type: 'Начало смены' }, { n: 2500, slitter: S2 }]),
        open: true, reportEmpty: true }
];

var errors = [];
var origError = console.error;
console.error = function(msg) { errors.push(String(msg)); };

var chain = Promise.resolve();
cases.forEach(function(c) {
    chain = chain.then(function() {
        var pult = makePult(c.events, { reportEmpty: c.reportEmpty });
        return pult.loadShiftEvents().then(function() {
            assert(pult.isShiftOpen() === c.open, c.name);
            if (c.requests) {
                assert(pult.requests.length === c.requests, c.name + ': запросов ' + c.requests
                    + ' (было ' + pult.requests.length + ')');
            }
            var newest = String(c.events.length);
            assert(pult.allEvents.some(function(ev) { return String(ev.id) === newest; }),
                c.name + ': самое свежее событие в выборке');
        });
    });
});

chain.then(function() {
    // Определение отчёта потеряло сортировку → пульт об этом кричит.
    errors = [];
    var pult = makePult(journal([{ n: 1500, slitter: S1 }]), { reportOldestFirst: true });
    return pult.loadShiftEvents().then(function() {
        assert(errors.some(function(m) { return /старыми вперёд/.test(m); }),
            'отчёт без сортировки (старыми вперёд) → console.error');
    });
}).then(function() {
    console.error = origError;
    console.log('\n' + passed + '/' + total + ' passed');
}).catch(function(err) {
    console.error = origError;
    console.error(err);
    process.exitCode = 1;
});
