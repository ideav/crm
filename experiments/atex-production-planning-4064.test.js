// Unit tests for #4064 — «По кнопке Упорядочить задания уехали за сроки».
//
// «Упорядочить» (runOptimizeQueue) сравнивал кандидаты ТОЛЬКО по переналадке
// (planQuality.all.changeoverMin) и применял план лишь при СТРОГОМ уменьшении переналадки (#4047).
// Поэтому EDD-раскладка кандидата, которая ставит срочное раньше, но стоит чуть больше переналадки,
// ОТВЕРГАЛАСЬ — и задания оставались за своими сроками (заказ 25.06 на 30.06).
//
// Фикс #4064: объектив кандидата = дни_опоздания × LATE_DAY_WEIGHT + переналадка(мин). Срок (ТЗ §14)
// старший критерий: сперва минимизируем опоздания, затем переналадку. «Упорядочить» ради сокращения
// опозданий может увеличить переналадку, но НЕ наоборот.
//
// Run with: node experiments/atex-production-planning-4064.test.js

process.env.TZ = 'UTC';
var planning = require('../download/atex/js/production-planning.js').planning;
var Controller = require('../download/atex/js/production-planning.js').Controller;

var passed = 0;
function assert(cond, name) {
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}
function tsOf(y, mo, d) { return Math.floor(Date.UTC(y, mo - 1, d) / 1000); }   // секунды (как c.number/planDate)

// ── 1) planLatenessDays: день размещения позже срока → дни опоздания; в срок/заранее → 0 ──
var inst = Object.create(Controller.prototype);
var lateCut = { id: 'L', number: String(tsOf(2026, 6, 30)), dueKey: 20260625 };   // поставлено 30.06, срок 25.06
var okCut   = { id: 'K', number: String(tsOf(2026, 6, 20)), dueKey: 20260625 };   // поставлено 20.06 (заранее)
assert(inst.planLatenessDays([lateCut], null) === 5,
    'резка на 30.06 при сроке 25.06 → 5 дней опоздания');
assert(inst.planLatenessDays([okCut], null) === 0,
    'резка на 20.06 при сроке 25.06 (заранее) → 0 опоздания');
assert(inst.planLatenessDays([lateCut, okCut], null) === 5,
    'суммарное опоздание плана = 5 (только просроченная)');
assert(inst.planLatenessDays([{ id: 'N', number: String(tsOf(2026, 6, 30)) }], null) === 0,
    'без срока (dueKey) → 0 (не опоздание)');
// override planStart из ops-карты имеет приоритет над хранимым number
assert(inst.planLatenessDays([{ id: 'L', number: String(tsOf(2026, 6, 20)), dueKey: 20260625 }],
        { L: tsOf(2026, 6, 28) }) === 3,
    'planStartByCutId override (28.06) перекрывает number (20.06) → 3 дня опоздания');

// ── 2) runOptimizeQueue: срок старше переналадки (лексикографически) ──
function runScenario(cfg) {
    return new Promise(function(resolve) {
        var calls = { applySplit: 0, persist: 0, notify: '' };
        var self = Object.create(Controller.prototype);
        self.busy = false;
        self.cuts = [{ id: 'c1', number: '100', slitter: { id: 'M1', label: '' } }];
        self.setBusy = function() {};
        self.buildSequenceOps = function() {
            return { ops: { updates: [{ cutId: 'c1', planStartTs: 123, plannedRuns: 1 }], creates: [], deletes: [] },
                     cutsById: { c1: self.cuts[0] } };
        };
        var co = cfg.co.slice(), late = (cfg.late || [0, 0, 0]).slice();
        self.planChangeoverMin = function() { return co.shift(); };
        self.planLatenessDays  = function() { return late.shift(); };
        self.computeReassignmentPlan = function() { return cfg.reassign || { changed: false, slitterByRecordId: {}, slitterReqId: '9' }; };
        self.persistSlitterReassignment = function() { calls.persist++; return Promise.resolve(true); };
        self.applySplitPlan = function() { calls.applySplit++; return Promise.resolve(true); };
        self.reload = function() { return Promise.resolve(); };
        self.render = function() {};
        self.notify = function(m) { calls.notify = String(m); setTimeout(function() { resolve(calls); }, 0); };
        self.runOptimizeQueue();
    });
}
var REASSIGN = { changed: true, slitterByRecordId: { c1: 'M2' }, slitterReqId: '99' };

(async function() {
    // Кандидат B: переналадка ВЫШЕ (500>480), но опозданий МЕНЬШЕ (1<2) → ПРИМЕНЯЕМ (срок важнее).
    var s1 = await runScenario({ co: [480, 500], late: [2, 1] });
    assert(s1.applySplit === 1, 'B: больше переналадки (500>480), но меньше опозданий (1<2) → ПРИМЕНЁН');
    assert(/опоздания 2 → 1/.test(s1.notify), 'B: уведомление показывает опоздания 2 → 1 дн (' + s1.notify + ')');

    // Кандидат B: переналадка НИЖЕ (400<480), но опозданий БОЛЬШЕ (2>1) → НЕ применяем (срок важнее).
    var s2 = await runScenario({ co: [480, 400], late: [1, 2] });
    assert(s2.applySplit === 0, 'B: меньше переналадки (400<480), но больше опозданий (2>1) → ОТВЕРГНУТ');
    assert(/оптимальна/.test(s2.notify), 'none: уведомление «уже оптимальна» (' + s2.notify + ')');

    // Равные опоздания → работает старое правило #4047: применяем при строгом уменьшении переналадки.
    var s3 = await runScenario({ co: [480, 460], late: [1, 1] });
    assert(s3.applySplit === 1, 'равные опоздания, переналадка 460<480 → применён (правило #4047 сохранено)');
    var s4 = await runScenario({ co: [480, 500], late: [1, 1] });
    assert(s4.applySplit === 0, 'равные опоздания, переналадка 500>480 → не трогаем (#4047 сохранено)');

    // Переназначение станка A даёт наименьшие опоздания → берём A (со сменой станка).
    var s5 = await runScenario({ co: [480, 490, 470], late: [3, 2, 1], reassign: REASSIGN });
    assert(s5.persist === 1 && s5.applySplit === 1, 'A: наименьшие опоздания (1) → смена станка + раскладка');
    assert(/сменой станка/.test(s5.notify), 'A: уведомление со сменой станка (' + s5.notify + ')');

    console.log('\n' + passed + ' passed');
})().catch(function(err) { console.error(err && err.stack || err); process.exit(1); });
