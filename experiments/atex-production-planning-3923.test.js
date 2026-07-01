// Unit tests for #3923 — «Убрать «Очередность»: единый источник порядка — planStart».
//
// После #3846 (показ из сохранённого плана) и #3920 (раскладка по времени planStart) поле
// «Очередность» перестало быть надёжным ключом: при scope-ограниченной пересборке (#3660) оно
// расходилось с planStart и давало овертайм. #3923 убирает «Очередность» как понятие — порядок
// резки на ВСЕХ путях задаёт сохранённый planStart (главное значение t1078). «Очередность»
// (`sequence`) остаётся лишь как in-memory ординал генерации и в базу не пишется/не читается.
//
// Покрываем, что упорядочивание идёт ПО planStart и НЕ зависит от хранимого `sequence`:
//   • groupBySlitter — внутри дня по planStart, даже если sequence null или вводит в заблуждение;
//   • planCutOperations(preserveOrder) — раскладка по planStart, а не по sequence;
//   • результат planCutOperations не зависит от значения `sequence` во входе;
//   • фольга остаётся в конце дня (isFoil важнее planStart, #3717);
//   • planMoveSequences — желаемый порядок по planStart, возвращает { ordered }.
//
// Run with: node experiments/atex-production-planning-3923.test.js

process.env.TZ = 'UTC';

var planning = require('../download/atex/js/production-planning.js').planning;

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

var BASE = 1780963200;            // полночь (unix-сек)
var BASE_MS = BASE * 1000;
function ts(h) { return String(BASE + h * 3600); }   // BASE + h часов, unix-сек

function cut(id, hour, seq, material, knifeWidths, isFoil) {
    return { id: id, slitter: { id: 'm1' }, materialId: material,
        winding: 'OUT', knifeWidths: knifeWidths, knifeCount: knifeWidths.length,
        plannedRuns: 1, planDate: ts(hour), sequence: seq, isFoil: isFoil ? 1 : 0 };
}
function ids(list) { return list.map(function (c) { return c.id; }); }
function widths(pairs) { var o = []; pairs.forEach(function (pr) { for (var i = 0; i < pr[1]; i++) o.push(pr[0]); }); return o; }

// ── 1) groupBySlitter упорядочивает по planStart, игнорируя хранимый sequence ──
// A@08:00, B@09:00, C@10:00 — но sequence вводит в заблуждение (обратный: 3,2,1). Порядок = planStart.
var gA = cut('A', 0, 3, 'M1', [100]);
var gB = cut('B', 1, 2, 'M1', [100]);
var gC = cut('C', 2, 1, 'M1', [100]);
var groups = planning.groupBySlitter([gC, gA, gB]);
assertEqual(ids(groups[0].cuts), ['A', 'B', 'C'],
    'groupBySlitter: порядок по planStart (08→09→10), а не по вводящему в заблуждение sequence');

// sequence == null (как после загрузки из базы) — порядок всё равно по planStart.
var nA = cut('A', 0, null, 'M1', [100]);
var nB = cut('B', 1, null, 'M1', [100]);
var nC = cut('C', 2, null, 'M1', [100]);
assertEqual(ids(planning.groupBySlitter([nC, nB, nA])[0].cuts), ['A', 'B', 'C'],
    'groupBySlitter: sequence null → порядок по planStart');

// ── 2) planCutOperations(preserveOrder) раскладывает по planStart, а не по sequence ──
var oneDay = { perPassByCut: { A: 10, B: 10 }, dayStartMin: 0, dayEndMin: 10000,
    times: { BETWEEN_CUTS: 0 }, planBaseMidnightMs: BASE_MS, preserveOrder: true };
function orderOf(ops) {
    return ops.updates.slice().sort(function (a, b) { return a.sequence - b.sequence; })
        .map(function (u) { return u.cutId; });
}
// A@08:00 (sequence 3), B@09:00 (sequence 1). По planStart → A,B; по sequence было бы B,A.
var q = [ cut('A', 0, 3, 'M1', widths([[152, 1]])), cut('B', 1, 1, 'MR2', widths([[59, 1]])) ];
assertEqual(orderOf(planning.planCutOperations(q, oneDay)), ['A', 'B'],
    'preserveOrder: раскладка по planStart (A@08→B@09), а не по sequence (был бы B,A)');

// ── 3) результат planCutOperations НЕ зависит от значения sequence во входе ──
var withSeq = [ cut('A', 0, 99, 'M1', widths([[152, 1]])), cut('B', 1, 7, 'MR2', widths([[59, 1]])) ];
var noSeq = [ cut('A', 0, null, 'M1', widths([[152, 1]])), cut('B', 1, null, 'MR2', widths([[59, 1]])) ];
assertEqual(orderOf(planning.planCutOperations(withSeq, oneDay)),
    orderOf(planning.planCutOperations(noSeq, oneDay)),
    '#3923: порядок раскладки не зависит от хранимого sequence (planStart — единственный ключ)');

// ── 4) фольга остаётся в конце дня (isFoil важнее planStart, #3717) ──
// N1@08:00, F@09:00 (фольга в СЕРЕДИНЕ по времени), N2@10:00 → фольга уходит в конец.
var foilDay = { perPassByCut: { N1: 10, F: 10, N2: 10 }, dayStartMin: 0, dayEndMin: 10000,
    times: { BETWEEN_CUTS: 0 }, planBaseMidnightMs: BASE_MS, preserveOrder: true };
var withFoil = [ cut('N1', 0, 1, 'M1', widths([[152, 1]]), false),
                 cut('F', 1, 2, 'MF', widths([[100, 1]]), true),
                 cut('N2', 2, 3, 'M1', widths([[152, 1]]), false) ];
assertEqual(orderOf(planning.planCutOperations(withFoil, foilDay)), ['N1', 'N2', 'F'],
    'preserveOrder: фольга (planStart 09:00) уходит в конец дня, isFoil важнее planStart (#3717)');

// ── 5) planMoveSequences — желаемый порядок по planStart, возвращает { ordered } ──
var dayCuts = [ { id: 'b', planDate: ts(2) }, { id: 'a', planDate: ts(1) }, { id: 'c', planDate: ts(3) } ];
assertEqual(planning.planMoveSequences('M', dayCuts, 'start'), { ordered: ['M', 'a', 'b', 'c'] },
    'planMoveSequences: в начало — M первым, прочие по planStart');
assertEqual(planning.planMoveSequences('M', dayCuts, 'end'), { ordered: ['a', 'b', 'c', 'M'] },
    'planMoveSequences: в конец — прочие по planStart, M последним');

console.log('\n' + passed + ' assertions passed');
