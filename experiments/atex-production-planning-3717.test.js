// Unit tests for #3717 — «Фольга — в конец дня» (после #4085 — через слой размещения #3985).
// Фольга (медленная намотка, отдельная норма WIND_FOIL_) должна стоять ПОСЛЕ обычных резок своего дня.
// В модели #3985 это обеспечивается ШТРАФОМ FOIL_NOTEND_COST_MN в слое размещения (не жёстким правилом
// orderCuts/preserveOrder — оно снято #4085 как дрейф). Здесь проверяем инвариант на ЖИВОМ пути
// (slotPlacement=true): перебор точек вставки ставит фольгу в конец дня, т.к. позиция «не последняя»
// дороже. Ручной путь (preserveOrder) фольгу больше НЕ пересортировывает — уважает порядок оператора.
//
// Run with: node experiments/atex-production-planning-3717.test.js

process.env.TZ = 'UTC';

var api = require('../download/atex/js/production-planning.js');
var planning = api.planning;

var passed = 0;
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; }
    else {
        console.log('  expected:', JSON.stringify(expected));
        console.log('  actual:  ', JSON.stringify(actual));
        process.exitCode = 1;
    }
}

function cut(id, foil, runs, sequence, planDate) {
    return { id: id, slitter: { id: 'm4' }, materialId: foil ? 'FOIL' : ('mat' + id),
        winding: 'IN', knifeWidths: [59], knifeCount: 1, plannedRuns: runs,
        planDate: planDate || '1780963200', sequence: sequence, isFoil: !!foil };
}
function orderOf(ops) {
    return ops.updates.slice().sort(function(a, b) { return a.sequence - b.sequence; })
        .map(function(u) { return u.cutId; });
}

// ── 1) Один день: фольга «вперемешку» (F1 seq1, F2 seq3) → уходит в конец, обычные сохраняют порядок ──
// Воспроизводит боевой скрин (Станок 4 25.06): фольга стояла seq 1/3/6, должна быть в конце.
var oneDay = [
    cut('F1', true, 2, 1),    // фольга — была первой
    cut('N1', false, 3, 2),
    cut('F2', true, 2, 3),    // фольга — была в середине
    cut('N2', false, 3, 4)
];
var opts = { perPassByCut: { F1: 1, N1: 1, F2: 1, N2: 1 }, dayStartMin: 0, dayEndMin: 10000,
    times: { BETWEEN_CUTS: 0 }, planBaseMidnightMs: 1780963200000, slotPlacement: true, slitterIds: ['m4'] };
var ops = planning.planCutOperations(oneDay, opts);
assertEqual(orderOf(ops), ['N1', 'N2', 'F1', 'F2'],
    '#3717: фольга (F1,F2) — в конец дня; обычные (N1,N2) сохраняют относительный порядок');
assertEqual(ops.creates, [], '#3717: всё влезает в день → переносов нет');

// ── 2) Фольга уже в конце — порядок не меняется (идемпотентность) ──
var already = [ cut('N1', false, 3, 1), cut('N2', false, 3, 2), cut('F1', true, 2, 3) ];
var ops2 = planning.planCutOperations(already,
    { perPassByCut: { N1: 1, N2: 1, F1: 1 }, dayStartMin: 0, dayEndMin: 10000,
      times: { BETWEEN_CUTS: 0 }, planBaseMidnightMs: 1780963200000, slotPlacement: true, slitterIds: ['m4'] });
assertEqual(orderOf(ops2), ['N1', 'N2', 'F1'], '#3717: фольга уже в конце — порядок сохранён');

// ── 3) Несколько дней: фольга — в конец КАЖДОГО дня (инвариант #3717 на живом пути slotPlacement) ──
// Ёмкость дня 100 мин; нефольга N (3×20=60) + фольга F (2×20=40) ровно заполняют день ⇒ две пары ложатся
// на два дня. Проверяем ИНВАРИАНТ: внутри каждого дня ни одна нефольга не стоит ПОСЛЕ фольги.
// Разные сигнатуры фольги (FOILA/FOILB), чтобы соседние дни не слились в цепочку-продолжение.
function foilCut(id, material, runs, sequence, planDate) {
    return { id: id, slitter: { id: 'm4' }, materialId: material, winding: 'IN',
        knifeWidths: [59], knifeCount: 1, plannedRuns: runs, planDate: planDate, sequence: sequence, isFoil: true };
}
var multi = [
    cut('N1', false, 3, 1, '1780963200'),
    foilCut('F0', 'FOILA', 2, 2, '1780963200'),
    cut('N2', false, 3, 3, '1781049600'),
    foilCut('F1', 'FOILB', 2, 4, '1781049600')
];
var ops3 = planning.planCutOperations(multi,
    { perPassByCut: { N1: 20, F0: 20, N2: 20, F1: 20 }, dayStartMin: 0, dayEndMin: 100,
      times: { BETWEEN_CUTS: 0 }, planBaseMidnightMs: 1780963200000, slotPlacement: true, slitterIds: ['m4'] });
function dayOfUpd(u) { return Math.floor((Number(u.planStartTs) * 1000 - 1780963200000) / 86400000); }
var byDay = {};
ops3.updates.forEach(function(u) { var d = dayOfUpd(u); (byDay[d] = byDay[d] || []).push(u); });
var foilLastEachDay = Object.keys(byDay).every(function(d) {
    var seq = byDay[d].slice().sort(function(a, b) { return a.sequence - b.sequence; });
    var seenFoil = false, ok = true;
    seq.forEach(function(u) { if (/^F/.test(u.cutId)) seenFoil = true; else if (seenFoil) ok = false; });
    return ok;
});
assertEqual(foilLastEachDay && Object.keys(byDay).length >= 2, true,
    '#3717: фольга в конце КАЖДОГО дня (инвариант; дней=' + Object.keys(byDay).length + ', нефольга не после фольги)');

console.log('\n' + passed + ' passed');
