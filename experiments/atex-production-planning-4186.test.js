// Unit tests for #4186 — «После невыгодного ручного переноса появилась просрочка,
// а „Упорядочить“ (.atex-pp-order-queue) не вернул более оптимальный план».
//
// Симптом: пользователь ручным переносом (🗓, «Зафиксировать» по умолчанию) отправил задание
// ЗА срок и закрепил его (🔒) на этом позднем дне. «Упорядочить» уважает фиксацию (#3792) и держит
// задание на просроченном дне — кандидаты B/A не могут сократить опоздание, объектив не улучшается,
// и кнопка отвечает «Очередь уже оптимальна», хотя план без этой фиксации был бы В СРОК (было ↔ стало).
//
// Фикс #4186: «Упорядочить» пробует дополнительный кандидат C — РАСПУСТИТЬ фиксации, которые САМИ уже
// просрочены (день размещения позже срока), и пересобрать по срокам (buildSequenceOps relaxLateFixed).
// Срок (ТЗ §14) старше фиксации (#3792), поэтому бессмысленный замок за сроком распускается — но ТОЛЬКО
// при СТРОГОМ сокращении опозданий; фиксации, которые сроки не нарушают, не трогаются.
//
// Run with: node experiments/atex-production-planning-4186.test.js

process.env.TZ = 'UTC';
var Controller = require('../download/atex/js/production-planning.js').Controller;

var passed = 0;
function assert(cond, name) {
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}
function tsOf(y, mo, d) { return Math.floor(Date.UTC(y, mo - 1, d) / 1000); }

// ── 1) runOptimizeQueue: кандидат C распускает просроченную фиксацию, когда это сокращает опоздание ──
// self.planLatenessDays / planChangeoverMin вызываются в порядке: before, B, [A], [C].
// Здесь reassign отключён (A нет), поэтому очередь shift(): before, B, C.
function runScenario(cfg) {
    return new Promise(function(resolve) {
        var calls = { applySplit: 0, persist: 0, notify: '', buildScopes: [] };
        var self = Object.create(Controller.prototype);
        self.busy = false;
        self.cuts = cfg.cuts;
        self.setBusy = function() {};
        self.buildSequenceOps = function(cuts, strategy, preserveOrder, moveScope) {
            calls.buildScopes.push(moveScope || null);
            return { ops: { updates: [{ cutId: 'c1', planStartTs: 123, plannedRuns: 1 }], creates: [], deletes: [] },
                     cutsById: { c1: self.cuts[0] } };
        };
        var co = cfg.co.slice(), late = cfg.late.slice();
        self.planChangeoverMin = function() { return co.shift(); };
        self.planLatenessDays  = function() { return late.shift(); };
        self.computeReassignmentPlan = function() { return { changed: false, slitterByRecordId: {}, slitterReqId: '9' }; };
        self.persistSlitterReassignment = function() { calls.persist++; return Promise.resolve(true); };
        self.applySplitPlan = function() { calls.applySplit++; return Promise.resolve(true); };
        self.reload = function() { return Promise.resolve(); };
        self.render = function() {};
        self.notify = function(m) { calls.notify = String(m); setTimeout(function() { resolve(calls); }, 0); };
        self.runOptimizeQueue();
    });
}

// Просроченная фиксация: задание закреплено на 30.06, срок 25.06 → 5 дней опоздания.
var lateFixed = { id: 'c1', number: String(tsOf(2026, 6, 30)), dueKey: 20260625, fixed: true, slitter: { id: 'M1', label: '' } };
// Фиксация В СРОК: закреплено на 20.06, срок 25.06 → 0 опоздания (замок распускать НЕ нужно).
var okFixed   = { id: 'c1', number: String(tsOf(2026, 6, 20)), dueKey: 20260625, fixed: true, slitter: { id: 'M1', label: '' } };

(async function() {
    // C сокращает опоздания (before/B = 5, C = 0) → распускаем фиксацию и применяем.
    var s1 = await runScenario({ cuts: [lateFixed], co: [100, 100, 100], late: [5, 5, 0] });
    assert(s1.applySplit === 1, 'C: просроченная фиксация распущена, план по сроку применён');
    assert(/роспуском просроченных фиксаций/.test(s1.notify), 'C: уведомление о роспуске фиксаций (' + s1.notify + ')');
    assert(s1.buildScopes.some(function(s) { return s && s.relaxLateFixed; }),
        'C: buildSequenceOps вызван с relaxLateFixed');
    assert(/опоздания 5 → 0 дн/.test(s1.notify), 'C: уведомление показывает опоздания 5 → 0 (' + s1.notify + ')');

    // C НЕ сокращает опоздания (C = 5, как before) → не трогаем (замок за сроком остаётся, «уже оптимальна»).
    var s2 = await runScenario({ cuts: [lateFixed], co: [100, 100, 100], late: [5, 5, 5] });
    assert(s2.applySplit === 0, 'C: не сокращает опоздания → фиксацию не распускаем');
    assert(/оптимальна/.test(s2.notify), 'C: уведомление «уже оптимальна» (' + s2.notify + ')');

    // Фиксация в срок → кандидат C вовсе НЕ считается (buildSequenceOps без relaxLateFixed).
    var s3 = await runScenario({ cuts: [okFixed], co: [100, 100], late: [0, 0] });
    assert(!s3.buildScopes.some(function(s) { return s && s.relaxLateFixed; }),
        'фиксация в срок → relaxLateFixed НЕ запускается (нет просроченных замков)');
    assert(s3.applySplit === 0, 'фиксация в срок, объектив не улучшился → план не трогаем');

    // C строго лучше B по опозданиям (B=3, C=1) при большей переналадке — срок §14 старше → берём C.
    var s4 = await runScenario({ cuts: [lateFixed], co: [200, 200, 500], late: [5, 3, 1] });
    assert(s4.applySplit === 1, 'C: опоздания 1 < 3 (B) при большей переналадке → срок важнее, C применён');
    assert(/опоздания 5 → 1 дн/.test(s4.notify), 'C: уведомление 5 → 1 (' + s4.notify + ')');

    // C не строго лучше выбранного фикс-плана B (B=1, C=1) → C не берём (фиксацию зря не распускаем).
    var s5 = await runScenario({ cuts: [lateFixed], co: [200, 150, 100], late: [3, 1, 1] });
    assert(s5.applySplit === 1, 'B применён (опоздания 3 → 1) без роспуска фиксаций');
    assert(!/роспуском/.test(s5.notify), 'C не выбран при равных опозданиях с B (' + s5.notify + ')');

    // ── 2) buildSequenceOps(relaxLateFixed): реальный движок распускает ТОЛЬКО просроченный замок ──
    var BASE = new Date('2026-06-23T00:00:00').getTime();
    function ymd(dayoff) { var d = new Date(BASE + dayoff * 86400000); return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); }
    function fakeSelf(cuts) {
        return {
            cuts: cuts, changeTimes: { BETWEEN_CUTS: 0, CLEANUP_SHIFT: 0 }, daySettings: {},
            opTimes: { WIND_100: 20 }, filter: { date: '2026-06-23' },
            supplies: [], footageBySupply: {}, genPositions: [],
            nowMs: function() { return BASE; },
            workingWindow: Controller.prototype.workingWindow,
            planningPrevSetupBySlitter: function() { return {}; },
            blockedRangesBySlitter: function() { return {}; }
        };
    }
    function fcut(id, day, dueDayOff) {
        return { id: id, orderId: 'O_' + id, slitter: { id: 'm1' }, materialId: 'M1', winding: 'OUT',
                 knifeWidths: [50, 50], knifeCount: 2, rollerWidth: 0, plannedRuns: 4, isFoil: false, length: 100,
                 planDate: String(Math.floor((BASE + day * 86400000) / 1000) + 480 * 60),
                 dueKey: ymd(dueDayOff), status: '', fixed: true };
    }
    function dayOf(built, id) {
        var ops = built.ops || built;   // buildSequenceOps → {ops, cutsById}
        var u = (ops.updates || []).filter(function(x) { return String(x.cutId) === id; })[0];
        return u ? Math.round((Number(u.planStartTs) * 1000 - BASE) / 86400000) : null;
    }

    // L закреплено на день 5, но срок — день 1 (просрочено). Без relax — держит день 5.
    var Lcuts = [fcut('L', 5, 1)];
    var selfL = fakeSelf(Lcuts);
    var keep = Controller.prototype.buildSequenceOps.call(selfL, Lcuts, 'SETUP', false, null);
    assert(dayOf(keep, 'L') === 5, 'без relaxLateFixed просроченный замок L держит день 5 (день ' + dayOf(keep, 'L') + ')');
    var relax = Controller.prototype.buildSequenceOps.call(selfL, Lcuts, 'SETUP', false, { relaxLateFixed: true });
    assert(dayOf(relax, 'L') < 5, 'relaxLateFixed распускает просроченный замок — L уходит раньше (день ' + dayOf(relax, 'L') + ')');
    assert(Lcuts.every(function(c) { return c.fixed === true; }), 'relaxLateFixed возвращает исходный c.fixed=true после планирования');

    // K закреплено на день 0 В СРОК (срок день 5) — relaxLateFixed его НЕ трогает.
    var Kcuts = [fcut('K', 0, 5)];
    var selfK = fakeSelf(Kcuts);
    var relaxK = Controller.prototype.buildSequenceOps.call(selfK, Kcuts, 'SETUP', false, { relaxLateFixed: true });
    assert(dayOf(relaxK, 'K') === 0, 'relaxLateFixed НЕ трогает замок в срок — K остаётся на дне 0 (день ' + dayOf(relaxK, 'K') + ')');
    assert(Kcuts.every(function(c) { return c.fixed === true; }), 'K.fixed остаётся true (не распускался)');

    console.log('\n' + passed + ' passed');
})().catch(function(err) { console.error(err && err.stack || err); process.exit(1); });
