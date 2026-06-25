// Unit tests for #3717 — «Фольга — всегда в конец дня».
// Фольга (медленная намотка, отдельная норма WIND_FOIL_) должна стоять ПОСЛЕ всех
// обычных резок того же дня. orderCuts при генерации делает фольгу последней по
// ИСХОДНОМУ дню, но кросс-дневный re-pack + посменная сборка перемешивали её обратно
// (на боевой базе фольга вылезала в начало/середину дня). Фикс — в planCutOperations
// (preserveOrder): сортировка внутри станка по (день, фольга?, «Очередность»), так
// фольга принудительно уходит в конец каждого дня, сохраняя порядок обычных резок.
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
    times: { BETWEEN_CUTS: 0 }, planBaseMidnightMs: 1780963200000, preserveOrder: true };
var ops = planning.planCutOperations(oneDay, opts);
assertEqual(orderOf(ops), ['N1', 'N2', 'F1', 'F2'],
    '#3717: фольга (F1,F2) — в конец дня; обычные (N1,N2) сохраняют относительный порядок');
assertEqual(ops.creates, [], '#3717: всё влезает в день → переносов нет');

// ── 2) Фольга уже в конце — порядок не меняется (идемпотентность) ──
var already = [ cut('N1', false, 3, 1), cut('N2', false, 3, 2), cut('F1', true, 2, 3) ];
var ops2 = planning.planCutOperations(already,
    { perPassByCut: { N1: 1, N2: 1, F1: 1 }, dayStartMin: 0, dayEndMin: 10000,
      times: { BETWEEN_CUTS: 0 }, planBaseMidnightMs: 1780963200000, preserveOrder: true });
assertEqual(orderOf(ops2), ['N1', 'N2', 'F1'], '#3717: фольга уже в конце — порядок сохранён');

// ── 3) Два дня: фольга в конец КАЖДОГО дня (не «в конец всей очереди») ──
// День 0 (1780963200): N1 seq1, F0 seq2(фольга). День 1 (1781049600): F1 seq1(фольга), N2 seq2.
// Якорим резки к их дням (dayAnchorByCut), фольга каждого дня — в конец своего дня.
// Разные сигнатуры фольги (FOILA/FOILB), чтобы соседние дни НЕ слились в цепочку-продолжение.
function foilCut(id, material, runs, sequence, planDate) {
    return { id: id, slitter: { id: 'm4' }, materialId: material, winding: 'IN',
        knifeWidths: [59], knifeCount: 1, plannedRuns: runs, planDate: planDate, sequence: sequence, isFoil: true };
}
var twoDay = [
    cut('N1', false, 3, 1, '1780963200'),
    foilCut('F0', 'FOILA', 2, 2, '1780963200'),
    foilCut('F1', 'FOILB', 2, 1, '1781049600'),
    cut('N2', false, 3, 2, '1781049600')
];
var ops3 = planning.planCutOperations(twoDay,
    { perPassByCut: { N1: 1, F0: 1, F1: 1, N2: 1 }, dayStartMin: 0, dayEndMin: 100,
      times: { BETWEEN_CUTS: 0 }, planBaseMidnightMs: 1780963200000, preserveOrder: true,
      dayAnchorByCut: { N1: 0, F0: 0, F1: 1, N2: 1 } });
assertEqual(orderOf(ops3), ['N1', 'F0', 'N2', 'F1'],
    '#3717: фольга в конец КАЖДОГО дня (день0: N1→F0; день1: N2→F1)');

console.log('\n' + passed + ' passed');
