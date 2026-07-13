// #4211 — «По кнопке Упорядочить при наличии просрочки я никак не должен получать сообщение, что
// очередь оптимальна». Экран: панель «просрочено: 1», а тост «Очередь уже оптимальна (опозданий 0 дн)».
//
// Причина: метрика «Упорядочить» planLatenessDays брала срок ТОЛЬКО из хранимого c.dueKey, а панель
// «просрочено» (#4161 countOverdueCuts) — из cutDueKeys (обеспечения, с фолбэком supply.dueKey). У
// продолжения-перелива (#4209: намотка за выходные, свой dueKey пуст — срок держит обеспечение головы)
// c.dueKey пуст → опоздание 0 → «уже оптимальна», хотя панель показывает просрочку.
//
// Фикс: (A) planLatenessDays берёт срок как панель (cutDueKeys с фолбэком); (B) при опозданиях>0
// «Упорядочить» НЕ говорит «оптимальна».
//
// Run: node experiments/atex-production-planning-4211.test.js

process.env.TZ = 'UTC';
var Controller = require('../download/atex/js/production-planning.js').Controller;

var passed = 0, total = 0;
function assert(cond, name) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}
function tsOf(y, mo, d) { return Math.floor(Date.UTC(y, mo - 1, d) / 1000); }

// ── A) planLatenessDays: срок из ОБЕСПЕЧЕНИЯ (как панель), а не только из c.dueKey ──────────────────
// Продолжение-перелив X: план 06.07, СВОЙ dueKey ПУСТ, но обеспечение даёт срок 03.07 (fallback supply.dueKey).
(function () {
    var inst = Object.create(Controller.prototype);
    var X = { id: 'X', number: String(tsOf(2026, 7, 6)), dueKey: undefined };   // план 06.07, свой срок пуст
    // без обеспечений — как СЕЙЧАС бы посчиталось (срок неизвестен → 0):
    assert(inst.planLatenessDays([X], null) === 0,
        '#4211 A(до): без обеспечений (c.dueKey пуст) planLatenessDays=0 — та самая слепая зона');
    // с обеспечением (срок 03.07 из supply.dueKey) — панель это видит, и метрика теперь тоже:
    inst.supplies = [{ cutId: 'X', positionId: 'P1', dueKey: 20260703 }];
    inst.genPositions = [];
    assert(inst.planLatenessDays([X], null) === 3,
        '#4211 A(фикс): срок 03.07 из обеспечения → опоздание 3 дн (06.07−03.07), как «просрочено» в панели');
    // резка В СРОК — 0 (регрессия): план 02.07 ≤ срок 03.07.
    var Y = { id: 'Y', number: String(tsOf(2026, 7, 2)) };
    inst.supplies = [{ cutId: 'Y', positionId: 'P2', dueKey: 20260703 }];
    assert(inst.planLatenessDays([Y], null) === 0,
        '#4211 A: резка в срок (02.07 ≤ 03.07) → опоздание 0');
})();

// ── B) runOptimizeQueue: при опозданиях>0 НЕ говорить «оптимальна» ───────────────────────────────────
function runScenario(cfg) {
    return new Promise(function (resolve) {
        var calls = { applySplit: 0, notify: '' };
        var self = Object.create(Controller.prototype);
        self.busy = false;
        self.cuts = [{ id: 'c1', number: '100', slitter: { id: 'M1', label: '' } }];
        self.setBusy = function () {};
        self.buildSequenceOps = function () {
            return { ops: { updates: [{ cutId: 'c1', planStartTs: 123, plannedRuns: 1 }], creates: [], deletes: [] },
                     cutsById: { c1: self.cuts[0] } };
        };
        var co = cfg.co.slice(), late = cfg.late.slice();
        self.planChangeoverMin = function () { return co.shift(); };
        self.planLatenessDays = function () { return late.shift(); };
        self.computeReassignmentPlan = function () { return { changed: false, slitterByRecordId: {}, slitterReqId: '9' }; };
        self.applySplitPlan = function () { calls.applySplit++; return Promise.resolve(true); };
        self.reload = function () { return Promise.resolve(); };
        self.render = function () {};
        self.notify = function (m) { calls.notify = String(m); setTimeout(function () { resolve(calls); }, 0); };
        self.runOptimizeQueue();
    });
}

(async function () {
    // Нет улучшающего кандидата, но ЕСТЬ просрочка (опозданий 1) → НЕ «оптимальна».
    var s = await runScenario({ co: [480, 500], late: [1, 2] });
    assert(s.applySplit === 0 && !/оптимальна/.test(s.notify) && /просрочк/i.test(s.notify) && /опозданий 1/.test(s.notify),
        '#4211 B: просрочка есть (опозданий 1), улучшения нет → тост НЕ «оптимальна», а «просрочка не устранена» (' + s.notify + ')');
    // Просрочки нет (опозданий 0) → «уже оптимальна» сохраняется.
    var s0 = await runScenario({ co: [480, 500], late: [0, 0] });
    assert(s0.applySplit === 0 && /оптимальна/.test(s0.notify),
        '#4211 B контроль: опозданий 0 → «уже оптимальна» (' + s0.notify + ')');

    console.log('\n' + passed + '/' + total + ' проверок прошло');
})().catch(function (err) { console.error(err && err.stack || err); process.exit(1); });
