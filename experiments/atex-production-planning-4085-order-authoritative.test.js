// Тесты #4085 (Стадия 3) — режим orderAuthoritative в splitMachineQueue.
//
// Когда порядок задан слоем размещения (модель #3985), splitMachineQueue его НЕ переигрывает:
// ключ selectByConfig = [idx], роняя −stripBandCount (isFoil-last и EDD `dueDay×вес` уже сняты из
// фолбэк-ключа как дрейф #4085). Вся механика тайминга сохранена. Контроли ниже фиксируют, что и БЕЗ
// флага фольга/срок больше НЕ переигрывают порядок (дрейф снят) — контраст остаётся лишь по полосам.
//
// Run with: node experiments/atex-production-planning-4085-order-authoritative.test.js

var planning = require('../download/atex/js/production-planning.js').planning;

var passed = 0, total = 0;
function assert(cond, name) { total++; console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name); if (cond) passed++; else process.exitCode = 1; }
function eq(a, e, name) { var ok = JSON.stringify(a) === JSON.stringify(e); assert(ok, name + (ok ? '' : '\n    ожидалось ' + JSON.stringify(e) + '\n    получено  ' + JSON.stringify(a))); }

function cut(id, o) {
    o = o || {};
    return { id: id, slitter: { id: 'm1' }, materialId: o.mat || 'M1', winding: 'OUT',
             knifeWidths: [50, 50], knifeCount: 2, rollerWidth: 0, plannedRuns: o.runs || 3, isFoil: !!o.foil };
}
function pack(ordered, opts) {
    var pp = {}, rb = {};
    ordered.forEach(function (c) { pp[c.id] = 30; rb[c.id] = c.plannedRuns || 3; });
    var base = { dayStartMin: 0, dayEndMin: 100, times: { BETWEEN_CUTS: 0, KNIFE: 30, MATERIAL_WINDING: 15, CLEANUP_SHIFT: 30 },
                 leader: 0, perPassByCut: pp, runsByCut: rb, dayAnchorByCut: {}, gapFill: true, dueDayByCut: {}, deadlineAware: true };
    Object.keys(opts || {}).forEach(function (k) { base[k] = opts[k]; });
    return planning.splitMachineQueue(ordered, base);
}
function byDay(segs) { var o = {}; segs.forEach(function (s) { if (o[s.cutId] == null || s.dayOffset < o[s.cutId]) o[s.cutId] = s.dayOffset; }); return o; }

// ── 1) Фольга ПЕРВОЙ во входе остаётся первой (не уходит в конец) ────────────────────────────────
var inF = [cut('F', { foil: true }), cut('A'), cut('B')];
var authF = byDay(pack(inF, { orderAuthoritative: true }));
assert(authF.F === 0 && authF.A === 1 && authF.B === 2,
    '#4085 orderAuthoritative: фольга F первой во входе → остаётся день 0 (не в конец)');
var defaultF = byDay(pack(inF));   // #4085: без флага фольга тоже НЕ уходит в конец (жёсткое правило снято)
assert(defaultF.F === 0, '#4085 контроль: без флага фольга F ТОЖЕ остаётся первой — жёсткое «фольга-last» снято #4085 (foil-last теперь в слое размещения через штраф)');

// ── 2) EDD НЕ переигрывает порядок при orderAuthoritative ────────────────────────────────────────
var inE = [cut('A'), cut('B')];
var authE = byDay(pack(inE, { orderAuthoritative: true, dueDayByCut: { A: 5, B: 0 } }));
assert(authE.A === 0 && authE.B === 1, '#4085 orderAuthoritative: EDD не тянет B (срок0) вперёд — входной порядок A,B сохранён');
var defaultE = byDay(pack(inE, { dueDayByCut: { A: 5, B: 0 } }));   // #4085: EDD `dueDay×вес` снят — dueDayByCut больше не влияет
assert(defaultE.A === 0 && defaultE.B === 1, '#4085 контроль: без флага EDD (dueDayByCut) больше НЕ тянет B (срок0) вперёд — срок стал ЛОКАЛЬНЫМ штрафом в слое размещения (#4085)');

// ── 3) Тайминг НЕ меняется: при уже-совпадающем порядке раскладка идентична с флагом и без ───────
var uniform = [cut('A'), cut('B'), cut('C')];
function dwd(segs) { return segs.map(function (s) { return { id: s.cutId, day: s.dayOffset, win: s.windowStartMin, dur: s.durationMin }; }); }
eq(dwd(pack(uniform, { orderAuthoritative: true })), dwd(pack(uniform)),
    '#4085 orderAuthoritative: одинаковый конфиг (нет фольги/EDD) — раскладка идентична с флагом и без (тайминг не тронут)');

console.log('\n' + passed + '/' + total + ' passed');
