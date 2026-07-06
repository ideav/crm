// Тест issue #4047 (download/atex/js/production-planning.js):
// Кнопка «Упорядочить» обязана НЕ увеличивать суммарную трудоёмкость наладки. Гарантия — в
// chooseOptimizeCandidate: применяем лучший план-кандидат ТОЛЬКО если он СТРОГО меньше текущего
// по переналадке; при равенстве кандидатов берём B (пересборка на текущих станках, без смены
// станка); ничто не строго меньше → план не трогаем. Метрика переналадки
// (planQuality.all.changeoverMin) чувствительна к порядку задач ВНУТРИ дня (planStartMs) —
// поэтому runOptimizeQueue строит слоты по РЕАЛЬНОМУ planStart (c.number/override из ops), а не 0.
var assert = require('assert');
var planning = require('../download/atex/js/production-planning.js').planning;
function eq(a, b, m) { assert.strictEqual(a, b, m + ' (получено: ' + JSON.stringify(a) + ')'); }

// ── 1) chooseOptimizeCandidate: гарантия «не увеличивать переналадку» ──
var C = planning.chooseOptimizeCandidate;
// before=480; B — «пересборка на текущих станках»; A — «переназначение станка + пересборка».
// A ухудшает (495>480), B не улучшает → ничего не делаем (главная причина бага #4047).
eq(C(480, 480, 495, true).action, 'none', 'A хуже, B не улучшает → none (план не трогаем)');
// A ухудшает, но пересборка B улучшает → берём B, смена станка отвергнута.
eq(C(480, 460, 495, true).action, 'B', 'A хуже, B лучше → B (смена станка отвергнута)');
eq(C(480, 460, 495, true).obj, 460, 'B применён с переналадкой 460');
// Переназначение реально лучше пересборки → берём A.
eq(C(480, 470, 450, true).action, 'A', 'A строго лучше B → A');
eq(C(480, 470, 450, true).obj, 450, 'A применён с переналадкой 450');
// Равенство кандидатов — предпочитаем B (без churn станков).
eq(C(480, 470, 470, true).action, 'B', 'objA==objB → B (без смены станка)');
// Ни один кандидат не СТРОГО меньше текущего → none (в т.ч. равенство текущему).
eq(C(480, 480, 480, true).action, 'none', 'ничто не < текущего → none (равенство не применяем)');
eq(C(480, 490, 500, true).action, 'none', 'оба кандидата хуже → none (не увеличиваем)');
// Переназначения нет (reassignChanged=false, objA=Infinity) → сравниваем только B.
eq(C(480, 460, Infinity, false).action, 'B', 'без переназначения: B лучше → B');
eq(C(480, 480, Infinity, false).action, 'none', 'без переназначения: B не улучшает → none');
// Инвариант: применённый план НИКОГДА не хуже текущего.
[[480,480,495,true],[480,460,495,true],[480,470,450,true],[480,480,480,true],[480,490,500,false]]
  .forEach(function(a){
    var r = C(a[0], a[1], a[2], a[3]);
    assert(r.obj <= a[0], 'инвариант: obj(' + r.obj + ') <= before(' + a[0] + ') для ' + JSON.stringify(a));
  });

// ── 2) метрика переналадки чувствительна к порядку задач ВНУТРИ дня (planStartMs) ──
// Один станок, один день; одинаковые ножи (смен ножей нет), сырьё A/B. Группировка A,A,B,B даёт
// меньше смен сырья, чем чередование A,B,A,B — значит planQuality учитывает порядок по planStartMs
// (иначе перестановка внутри дня, главная работа «Упорядочить», была бы не видна и гейт бы не сработал).
function slot(id, order, material) {
    return { id: id, slitterId: 'M1', dayKey: 20260706, planStartMs: order,
             knifeWidths: [100, 100], knifeCount: 2, materialId: material, winding: '' };
}
var opts = { settings: {}, scopeFromKey: null, scopeToKey: null, prevSetupBySlitter: {} };
var grouped     = planning.planQuality([slot('a',1,'A'), slot('b',2,'A'), slot('c',3,'B'), slot('d',4,'B')], opts).all;
var interleaved = planning.planQuality([slot('a',1,'A'), slot('b',2,'B'), slot('c',3,'A'), slot('d',4,'B')], opts).all;
assert(grouped.changeoverMin < interleaved.changeoverMin,
    'группировка сырья < чередование по переналадке (порядок внутри дня учитывается): '
    + grouped.changeoverMin + ' vs ' + interleaved.changeoverMin);
eq(grouped.knifeCount, 1, 'группировка: только базовая наладка ножей (1), смен ножей внутри нет');
eq(interleaved.knifeCount, 1, 'чередование: та же 1 наладка ножей (ножи одинаковы)');
assert(interleaved.materialCount > grouped.materialCount,
    'чередование даёт больше смен сырья: ' + interleaved.materialCount + ' > ' + grouped.materialCount);

// ── 3) оркестровка runOptimizeQueue: применяем план ТОЛЬКО при строгом улучшении ──
// Заглушаем чистые помощники контроллера контролируемыми значениями переналадки и проверяем, что
// runOptimizeQueue: (none) не пишет ничего при отсутствии улучшения; (B) пишет раскладку без
// смены станка; (A) пишет смену станка + раскладку, когда переназначение реально лучше.
var Controller = require('../download/atex/js/production-planning.js').Controller;
function runScenario(cfg) {
    return new Promise(function(resolve) {
        var calls = { applySplit: 0, persist: 0, reload: 0, notify: '', busyFalse: 0 };
        var self = Object.create(Controller.prototype);
        self.busy = false;
        self.cuts = [{ id: 'c1', number: '100', slitter: { id: 'M1', label: '' } }];
        self.setBusy = function(v) { if (v === false) calls.busyFalse++; };
        self.buildSequenceOps = function() {
            return { ops: { updates: [{ cutId: 'c1', planStartTs: 123, plannedRuns: 1 }], creates: [], deletes: [] },
                     cutsById: { c1: self.cuts[0] } };
        };
        var seq = cfg.obj.slice();                                   // [before, objB, (objA)]
        self.planChangeoverMin = function() { return seq.shift(); };
        self.computeReassignmentPlan = function() { return cfg.reassign; };
        self.persistSlitterReassignment = function() { calls.persist++; return Promise.resolve(true); };
        self.applySplitPlan = function() { calls.applySplit++; return Promise.resolve(true); };
        self.reload = function() { calls.reload++; return Promise.resolve(); };
        self.render = function() {};
        self.notify = function(msg) { calls.notify = String(msg); setTimeout(function() { resolve(calls); }, 0); };
        self.runOptimizeQueue();
    });
}
var REASSIGN = { changed: true, slitterByRecordId: { c1: 'M2' }, slitterReqId: '99' };
var NOREASSIGN = { changed: false, slitterByRecordId: {}, slitterReqId: '99' };

(async function() {
    // (none) A хуже (495), B не улучшает (480==before) → ничего не пишем.
    var none = await runScenario({ obj: [480, 480, 495], reassign: REASSIGN });
    eq(none.applySplit, 0, 'none: applySplitPlan НЕ вызван');
    eq(none.persist, 0, 'none: смена станка НЕ записана');
    assert(/оптимальна/.test(none.notify), 'none: уведомление «уже оптимальна» (' + none.notify + ')');
    eq(none.busyFalse, 1, 'none: setBusy(false) вызван');

    // (B) B улучшает (460), A хуже (495) → пишем раскладку БЕЗ смены станка.
    var b = await runScenario({ obj: [480, 460, 495], reassign: REASSIGN });
    eq(b.applySplit, 1, 'B: applySplitPlan вызван один раз');
    eq(b.persist, 0, 'B: смена станка НЕ записана (переназначение отвергнуто)');
    assert(/460/.test(b.notify) && !/сменой станка/.test(b.notify), 'B: уведомление 460 без смены станка (' + b.notify + ')');

    // (A) A лучше всех (450) → пишем смену станка, затем раскладку.
    var a = await runScenario({ obj: [480, 470, 450], reassign: REASSIGN });
    eq(a.persist, 1, 'A: смена станка записана');
    eq(a.applySplit, 1, 'A: раскладка записана');
    assert(/450/.test(a.notify) && /сменой станка/.test(a.notify), 'A: уведомление 450 со сменой станка (' + a.notify + ')');

    // (B без переназначения) computeReassignmentPlan.changed=false → только B.
    var b2 = await runScenario({ obj: [480, 460], reassign: NOREASSIGN });
    eq(b2.applySplit, 1, 'B2: раскладка записана');
    eq(b2.persist, 0, 'B2: смены станка нет');

    console.log('OK: atex-production-planning-4047.test');
})().catch(function(err) { console.error(err && err.stack || err); process.exit(1); });
