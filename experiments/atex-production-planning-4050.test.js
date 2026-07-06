// Unit tests for #4050 — «Исправление по сроку заказа».
// ТЗ §8/§11: «Срок изготовления» — самый большой вес (DEADLINE_COST_MN=100, а «ровно в день» —
// EXACT_DEADLINE_COST_MN=33). Раньше срок в раскладке НЕ участвовал (#3974 отменил EDD): резка со
// сроком 25.06 могла встать на 26.06 ПОСЛЕ июльских. Теперь selectByConfig (per-day picker, куда
// приходит финальная раскладка и «Создать», и «Упорядочить» через autoSequenceQueue→planCutOperations
// gapFill) добавляет §8-штраф: срок ПОЗЖЕ дня → +100, РОВНО в день → +33, срок ≤ дня (в срок/просрочено)
// → 0 (просрочку добиваем первой). Вес 100 доминирует над переналадкой (30–50) → срочное на ранние дни.
//
// Run with: node experiments/atex-production-planning-4050.test.js

process.env.TZ = 'UTC';
var planning = require('../download/atex/js/production-planning.js').planning;

var passed = 0;
function assert(cond, name) {
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}

// Резки одинаковой конфигурации (сырьё M1, ножи [59,59]) → переналадка между ними = 0, поэтому
// порядок дней решает ТОЛЬКО срок (или idx при выключенном deadlineAware).
function cut(id, runs) {
    return { id: id, slitter: { id: 'm1' }, materialId: 'M1', winding: 'OUT',
        knifeWidths: [59, 59], knifeCount: 2, rollerWidth: 0, plannedRuns: runs };
}
var TIMES = { BETWEEN_CUTS: 0 };

// Каждая резка: 3 прохода × 30 мин = 90 мин; ёмкость дня 95 → ровно одна резка в день (вторая не
// влезает в остаток 5 и уходит на следующий день целиком). Кто встал на день 0 — решает пикер.
function pack(cuts, order, opts) {
    var perPassByCut = {}, runsByCut = {};
    cuts.forEach(function(c){ perPassByCut[c.id] = 30; runsByCut[c.id] = 3; });
    var base = { dayStartMin: 0, dayEndMin: 95, times: TIMES, leader: 0,
        perPassByCut: perPassByCut, runsByCut: runsByCut, dayAnchorByCut: {}, gapFill: true };
    for (var k in (opts || {})) base[k] = opts[k];
    return planning.splitMachineQueue(order.map(function(id){
        var f = null; cuts.forEach(function(c){ if (c.id === id) f = c; }); return f;
    }), base);
}
function dayOf(segs, id) {
    var d = null;
    segs.forEach(function(s){ if (String(s.cutId) === id && (d === null || s.dayOffset < d)) d = s.dayOffset; });
    return d;
}

var U = cut('U', 3);   // срочная / просроченная
var F = cut('F', 3);   // дальний срок
var E = cut('E', 3);   // срок ровно в день размещения

// ── 1) deadlineAware ВЫКЛ (ручной preserveOrder / старое поведение): порядок дней = idx входа ──
var s1 = pack([U, F], ['F', 'U'], { dueDayByCut: { F: 5, U: -1 } /* deadlineAware не задан */ });
assert(dayOf(s1, 'F') === 0 && dayOf(s1, 'U') === 1,
    'deadlineAware выкл → срок игнорируется, день по idx: F(idx0)→день0, U→день1');

// ── 2) DEADLINE_COST_MN: просроченная (срок −1) забивает более ранний день, обгоняя дальнюю ──
// Вход тот же [F, U] (F раньше по idx), но U просрочена → §8-штраф тянет её на день 0.
var s2 = pack([U, F], ['F', 'U'], { dueDayByCut: { F: 5, U: -1 }, deadlineAware: true });
assert(dayOf(s2, 'U') === 0 && dayOf(s2, 'F') === 1,
    'DEADLINE: U(срок−1, штраф 0) → день0 ОБГОНЯЕТ F(срок 5, штраф 100) → день1');

// ── 3) EXACT_DEADLINE_COST_MN: срок-ровно-в-день (штраф 33) дешевле дальнего (штраф 100) ──
var s3 = pack([E, F], ['F', 'E'], { dueDayByCut: { F: 5, E: 0 }, deadlineAware: true });
assert(dayOf(s3, 'E') === 0 && dayOf(s3, 'F') === 1,
    'EXACT: E(срок=день0, штраф 33) → день0 дешевле F(срок 5, штраф 100) → день1');

// ── 4) EXACT — это РЕАЛЬНЫЙ штраф (33 > 0): просроченная обгоняет «ровно в день» ──
var s4 = pack([E, U], ['E', 'U'], { dueDayByCut: { E: 0, U: -1 }, deadlineAware: true });
assert(dayOf(s4, 'U') === 0 && dayOf(s4, 'E') === 1,
    'U(просрочено, штраф 0) → день0 обгоняет E(ровно в день, штраф 33) → день1');

// ── 5) Обратная совместимость: без dueDayByCut и без deadlineAware — как раньше (по idx) ──
var s5 = pack([U, F], ['F', 'U'], {});
assert(dayOf(s5, 'F') === 0 && dayOf(s5, 'U') === 1,
    'нет срока/флага → прежнее поведение (день по idx), ничего не сломано');

// ── 6) Три срока подряд: просрочено < ровно-в-день < дальний (оба веса вместе) ──
var s6 = pack([U, E, F], ['F', 'E', 'U'], { dueDayByCut: { U: -1, E: 0, F: 5 }, deadlineAware: true });
assert(dayOf(s6, 'U') === 0 && dayOf(s6, 'E') === 1 && dayOf(s6, 'F') === 2,
    'порядок дней по срочности: U(день0) < E(день1) < F(день2)');

console.log('\n' + passed + ' passed');
