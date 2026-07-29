// Тесты для ideav/crm#4481 — смена «Партии сырья» НЕ считается сменой сырья и не стои́т времени.
//
// Правило (решение заказчика 29.07.2026, ТЗ §15): перезаправка станка ТЕМ ЖЕ сырьём из другого
// рулона времени не требует — в том числе переход «партия не указана» ↔ «указана». Симптом:
// «после перепланирования появляются наладки при том же сырье» — на стыке разных партий
// начислялись 15 минут MATERIAL_WINDING.
//
// Что считается сменой сырья, решает ОДНА функция на весь модуль (`materialSetupSig`), и через
// неё идут все потребители: реальные минуты (`changeoverParts`), вес §8 (`transitionCost` →
// `materialChangeNeeded`) и подпись конфигурации для перестановки внутри дня (`cutConfigSig`).
// Поэтому правило нельзя соблюсти в одном месте и забыть в другом.
//
//   A — минуты наладки: разные партии одного сырья → 0; пустая ↔ непустая → 0; разное сырьё и
//       разная намотка по-прежнему стоят MATERIAL_WINDING;
//   B — вес §8 (transitionCost): смена партии не начисляет MATERIAL_CHANGE_COST_MN;
//   C — подпись конфигурации: резки, отличающиеся ТОЛЬКО партией, — один узел (иначе перебор
//       внутри дня считал бы их разными и не склеивал бы подряд);
//   D — интеграционно (planCutOperations): очередь одного сырья с чередующимися партиями не
//       получает ни одной переналадки сырья.
//
// Run with: node experiments/atex-production-planning-4481.test.js

process.env.TZ = 'UTC';
var planning = require('../download/atex/js/production-planning.js').planning;

var passed = 0, total = 0;
function assert(cond, name) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}

var TIMES = { MATERIAL_WINDING: 15, KNIFE: 30, KNIFE_MOVE: 2, BETWEEN_CUTS: 2, CLEANUP_SHIFT: 30 };
function cut(over) {
    var c = { id: 'C', materialId: 'M1', winding: 'OUT', batchId: 'B1',
              knifeWidths: [100, 100, 100], knifeCount: 3, rollerWidth: 0, plannedRuns: 1, isFoil: false };
    Object.keys(over || {}).forEach(function(k) { c[k] = over[k]; });
    return c;
}
function minutes(prev, next) {
    return (planning.changeoverParts(prev, next, TIMES) || [])
        .reduce(function(s, p) { return s + Number(p.minutes || 0); }, 0);
}
function hasMaterialPart(prev, next) {
    return (planning.changeoverParts(prev, next, TIMES) || [])
        .some(function(p) { return p.code === 'MATERIAL_WINDING'; });
}

// ── A: реальные минуты наладки ──────────────────────────────────────────────────────────────
assert(minutes(cut({ batchId: 'B1' }), cut({ batchId: 'B2' })) === 0,
    '#4481-A: разные партии одного сырья — 0 минут наладки (было 15)');
assert(!hasMaterialPart(cut({ batchId: 'B1' }), cut({ batchId: 'B2' })),
    '#4481-A: в разбор наладки «смена сырья» при смене партии не попадает');
assert(minutes(cut({ batchId: '' }), cut({ batchId: 'B2' })) === 0,
    '#4481-A: переход «партия не указана» → «указана» — 0 минут');
assert(minutes(cut({ batchId: 'B2' }), cut({ batchId: '' })) === 0,
    '#4481-A: переход «указана» → «не указана» — 0 минут');
assert(minutes(cut({ batchId: null }), cut({ batchId: 'B2' })) === 0,
    '#4481-A: пустая партия как null — тоже 0 минут');
assert(minutes(cut({ materialId: 'M1' }), cut({ materialId: 'M2', batchId: 'B1' })) === 15,
    '#4481-A: РАЗНОЕ сырьё по-прежнему стои́т ' + TIMES.MATERIAL_WINDING + ' мин');
assert(minutes(cut({ winding: 'OUT' }), cut({ winding: 'IN' })) === 15,
    '#4481-A: РАЗНАЯ намотка по-прежнему стои́т ' + TIMES.MATERIAL_WINDING + ' мин');
assert(minutes(cut({ batchId: 'B1', knifeWidths: [100, 100, 100] }),
               cut({ batchId: 'B2', knifeWidths: [90, 90, 90, 90] })) === 30,
    '#4481-A: смена ножей при смене партии — только ножи (30), сырьё не добавляется');

// ── B: вес §8 (transitionCost) ──────────────────────────────────────────────────────────────
var W = { MATERIAL_CHANGE_COST_MN: 15, KNIVES_CHANGE_COST_MN: 30 };
function weightOf(prev, next) {
    var r = planning.transitionCost(prev, next, { settings: W });
    return { weight: r.weight, material: (r.byFactor || {}).material || 0 };
}
assert(weightOf(cut({ batchId: 'B1' }), cut({ batchId: 'B2' })).material === 0,
    '#4481-B: смена партии не начисляет вес MATERIAL_CHANGE (§8 п.1)');
assert(weightOf(cut({ materialId: 'M1' }), cut({ materialId: 'M2' })).material > 0,
    '#4481-B: смена самого сырья вес по-прежнему начисляет');

// ── C: подпись конфигурации (перестановка внутри дня, #4139) ────────────────────────────────
assert(planning.cutConfigSig(cut({ batchId: 'B1' })) === planning.cutConfigSig(cut({ batchId: 'B2' })),
    '#4481-C: резки, отличающиеся только партией, — ОДНА конфигурация (стоят подряд бесплатно)');
assert(planning.cutConfigSig(cut({ materialId: 'M1' })) !== planning.cutConfigSig(cut({ materialId: 'M2' })),
    '#4481-C: разное сырьё — разные конфигурации');

// ── D: интеграционно — ЗАГРУЗКА ДНЯ не зависит от партий ────────────────────────────────────
// Пять заданий одного сырья, одинаковые ножи, порядок закреплён (preserveOrder) — так партии
// заведомо чередуются и перестановка их не склеит. Минуты дня обязаны совпасть с очередью, где
// партия у всех одна: разница — это и есть «наладки при том же сырье» из тикета.
var BASE = new Date(2026, 6, 1, 0, 0, 0, 0).getTime();
function qCut(id, batch, offSec) {
    return { id: id, slitter: { id: '1' }, materialId: 'M1', winding: 'OUT', batchId: batch,
             knifeWidths: [100, 100, 100], knifeCount: 3, rollerWidth: 0, plannedRuns: 1,
             isFoil: false, planDate: String(Math.floor(BASE / 1000) + 8 * 3600 + offSec),
             status: '', fixed: false };
}
function dayMinutes(batches) {
    var list = ['A', 'B', 'C', 'D', 'E'].map(function(id, i) { return qCut(id, batches[i], i * 600); });
    var ops = planning.planCutOperations(list, {
        planBaseMidnightMs: BASE, weights: {}, times: TIMES,
        dayStartMin: 480, dayEndMin: 840, dayEndHourMin: 840,
        maxOverworkCutsMin: 5, maxOverworkTuneMin: 10, lunchStartMin: 740, lunchDurationMin: 40,
        gapFill: true, preserveOrder: true, slotPlacement: true, firstCutSetup: false,
        prevSetupBySlitter: {}, intraDayResequence: false,
        perPassByCut: { A: 30, B: 30, C: 30, D: 30, E: 30 },
        slitterIds: ['1'], dueDayByCut: {}, dueKeyByCut: {} });
    return Number((ops.dayLoad || {})['1|0']) || 0;
}
var mixed = dayMinutes(['B1', 'B2', 'B1', '', 'B3']);
var oneBatch = dayMinutes(['B1', 'B1', 'B1', 'B1', 'B1']);
assert(mixed === oneBatch,
    '#4481-D: минуты дня одинаковы при чередующихся и при одной партии ('
    + mixed + ' и ' + oneBatch + '; было 205 против 160 — три ложные наладки по 15 мин)');

console.log('\n' + passed + '/' + total + ' проверок пройдено');
if (passed !== total) process.exitCode = 1;
