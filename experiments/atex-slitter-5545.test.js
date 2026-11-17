// #5545 — пульт слиттера: после «Закрыть смену» снова появляется «Открыть смену», даже когда
// журнал событий длиннее одной страницы запроса.
//
// Отчёт report/slitter_shift_events отдаёт строки СТАРЫМИ ВПЕРЁД. Пульт читал его одним запросом
// LIMIT=0,5000; на боевой ateh 17.11.2026 в журнале 5076 событий — всё, что записано после 5000-го
// (в том числе сегодняшние «Конец смены»), до пульта не доходило, и последним событием станка
// оставалось утреннее «Начало смены»: смена для пульта не закрывалась никогда.
//
// Правило: пульт читает журнал целиком — страницами, пока страница не придёт неполной; то же
// у запасного прямого чтения таблицы событий.
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

// Журнал станка 1277, старыми вперёд: n-1 событие резки и последним — заданное событие смены.
function journal(n, lastType) {
    var rows = [];
    var t0 = 1785605362;
    rows.push({ event_id: '1', event_when: String(t0), event_type: 'Начало смены', event_user_id: '1640',
        event_notes: 'Станок 1 · 2026-08-01', event_cut_id: '', slitter_id: '1277' });
    for (var i = 2; i < n; i++) {
        rows.push({ event_id: String(i), event_when: String(t0 + i), event_type: 'Резка', event_user_id: '1640',
            event_notes: '', event_cut_id: '900', slitter_id: '1277' });
    }
    rows.push({ event_id: String(n), event_when: String(t0 + n), event_type: lastType, event_user_id: '1640',
        event_notes: 'Станок 1 · 2026-11-17', event_cut_id: '', slitter_id: '1277' });
    return rows;
}

// Сервер, который честно соблюдает LIMIT=offset,count (как боевой Интеграм).
function serve(rows) {
    return function(path) {
        this.requests.push(path);
        var m = /LIMIT=(\d+),(\d+)/.exec(path);
        var from = m ? +m[1] : 0, count = m ? +m[2] : rows.length;
        return Promise.resolve(rows.slice(from, from + count));
    };
}

function makePult(rows) {
    var inst = Object.create(Controller.prototype);
    inst.meta = {};
    inst.userId = '1640';
    inst.selectedSlitterId = '1277';
    inst.selectedSlitterLabel = function() { return 'Станок 1'; };
    inst.selectedDate = '2026-11-17';
    inst.cuts = [];
    inst.currentCutId = null;
    inst.requests = [];
    inst.notify = function() {};
    inst.getJson = serve(rows);
    return inst;
}

var cases = [
    { n: 5076, last: 'Конец смены', open: false, name: 'журнал 5076 > 5000, последним «Конец смены» → смена закрыта' },
    { n: 5076, last: 'Начало смены', open: true, name: 'журнал 5076, последним «Начало смены» → смена открыта' },
    { n: 10000, last: 'Конец смены', open: false, name: 'журнал ровно на две страницы → хвост дочитан' },
    { n: 12, last: 'Конец смены', open: false, name: 'короткий журнал → одна страница, смена закрыта' }
];

var chain = Promise.resolve();
cases.forEach(function(c) {
    chain = chain.then(function() {
        var pult = makePult(journal(c.n, c.last));
        return pult.loadShiftEvents().then(function() {
            assert(pult.allEvents.length === c.n, c.name + ': прочитаны все ' + c.n + ' событий (получено '
                + pult.allEvents.length + ')');
            assert(pult.isShiftOpen() === c.open, c.name);
        });
    });
});

chain.then(function() {
    // Короткий журнал — один запрос, лишних обращений нет.
    var pult = makePult(journal(12, 'Конец смены'));
    return pult.loadShiftEvents().then(function() {
        assert(pult.requests.length === 1, 'короткий журнал читается одним запросом (было '
            + pult.requests.length + ')');
    });
}).then(function() {
    console.log('\n' + passed + '/' + total + ' passed');
}).catch(function(err) {
    console.error(err);
    process.exitCode = 1;
});
