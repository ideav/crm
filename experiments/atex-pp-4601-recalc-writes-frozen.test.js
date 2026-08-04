// issue #4601/#4602: «↻ Пересчитать наладку» ВИДИТ расхождение — значит и ПИШЕТ его.
//
// Детектор расхождений (`recalcMismatchRows`) считает ручной меркой: `manual: true` — заморозка
// ручной путь не ограничивает (#4582). Писатель же звался как `persistCutSetupColumns(scopeIds)`,
// без флага, то есть по правилам АВТОМАТИКИ, и задания замороженного дня молча пропускал.
// Итог: кнопка показывает «(заданий: 3)», нажатие проходит без ошибки и без единой записи,
// счётчик не меняется (боевое ateh 04.08.2026 — день заморожен; 658253/658402/658388 на Ст.1 и
// 658161 на Ст.3 остались с «Длительностью»/«Резкой и Лидером» от прежнего числа проходов).
//
// Противоречие «детектор видит, а писать нечего» ловит #4416, но здесь оно не срабатывало:
// `stale` считается той же ручной меркой и НЕ пуст. Расходились не счёт с записью, а две мерки.
//
// Проверяем контракт: чем меряет детектор, тем же пишет и писатель.
//   A — ручной вызов (кнопка): в persistCutSetupColumns уходит { manual: true };
//   B — автоматический (после ↑↓/drag): флага НЕТ — заморозка в силе, как и была (#4436);
//   C — «⏩ Пересчитать отсюда» — тоже кнопка оператора, тоже { manual: true } (#4588).
//
// Run with: node experiments/atex-pp-4601-recalc-writes-frozen.test.js

process.env.TZ = 'Europe/Moscow';
global.window = { db: 'testdb', xsrf: 'x' };

var Controller = require('../download/atex/js/production-planning.js').Controller;

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

// Стаб-контроллер: расхождение есть, писатель — шпион.
function stub(opts) {
    var seen = { persistOpts: 'НЕ ВЫЗЫВАЛСЯ' };
    var self = {
        busy: false,
        _pendingPlan: null,
        meta: { cut: { id: '100', reqs: [] } },
        cuts: [{ id: 'C1', slitter: { id: 'S1' }, planDate: '1785819600', plannedRuns: 6 }],
        recalcScopeCutIds: function() { return ['C1']; },
        // расхождение НАЙДЕНО (ровно то, что показывает счётчик кнопки)
        computeCutSetupUpdates: function() { return { reqs: {}, updates: [{ cutId: 'C1' }] }; },
        recalcStartUpdates: function() { return []; },
        recalcMismatchIds: function() { return ['C1']; },
        overfilledDaysOf: function() { return []; },
        persistCutSetupColumns: function(ids, planCols, o) {
            seen.persistOpts = (o && o.manual) ? 'manual' : (o === null ? 'null' : String(o));
            seen.ids = ids;
            return Promise.resolve();
        },
        post: function() { return Promise.resolve({}); },
        reload: function() { return Promise.resolve(); },
        levelDayLoad: function() { return Promise.resolve(true); },
        setBusy: function() {}, showProgress: function() {}, updateProgress: function() {},
        hideProgress: function() {}, render: function() {},
        notify: function(t, k) { seen.notice = k + ': ' + String(t).slice(0, 60); }
    };
    for (var k in (opts || {})) self[k] = opts[k];
    return { self: self, seen: seen };
}

var a = stub();
Controller.prototype.recalcSetupTiming.call(a.self, 'S1').then(function() {
    assert(a.seen.persistOpts === 'manual',
        '#4601-A: кнопка «↻ Пересчитать наладку» пишет ручной меркой ({manual:true})',
        'писателю ушло: ' + a.seen.persistOpts);

    var b = stub();
    return Controller.prototype.recalcSetupTiming.call(b.self, 'S1', { auto: true }).then(function() {
        assert(b.seen.persistOpts === 'null',
            '#4601-B: автоматический пересчёт (после ↑↓/drag) заморозку соблюдает — флага нет',
            'писателю ушло: ' + b.seen.persistOpts);
    });
}).then(function() {
    var c = stub();
    c.self.recalcScopeCutIds = function() { return ['C1']; };
    return Controller.prototype.recalcFromCut.call(c.self,
        { id: 'C1', slitter: { id: 'S1' }, planDate: '1785819600' }).then(function() {
        assert(c.seen.persistOpts === 'manual',
            '#4601-C: «⏩ Пересчитать отсюда» — тоже кнопка оператора, тоже ручная мерка',
            'писателю ушло: ' + c.seen.persistOpts);
    });
}).then(function() {
    console.log('\n' + passed + '/' + total + ' passed');
}).catch(function(e) {
    process.exitCode = 1;
    console.log('FAIL — тест бросил: ' + (e && e.stack || e));
});
