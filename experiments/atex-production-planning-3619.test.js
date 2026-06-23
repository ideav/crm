// Unit tests for #3619 — «Заполнять день до конца».
// После генерации очередь заполняет дни до конца: задания, переходящие границу
// рабочего дня, расщепляются на по-дневные сегменты (своё «Задание в производство»
// + «Партия ГП» + «Обеспечение» под каждый день, рекурсивно). При этом порядок
// очереди оператора СОХРАНЯЕТСЯ (#3449): planCutOperations с preserveOrder:true
// раскладывает резки в текущем порядке «Очередности», не пересобирая её по стратегии.
//
// Покрываем флаг preserveOrder в planCutOperations:
//   • без флага  — пересборка по SETUP (ножи по убыванию), как было (#3421);
//   • с флагом   — порядок «Очередности» неприкосновенен, режем только по дням;
//   • с флагом   — перелив дня всё равно расщепляется, продолжение встаёт сразу
//                  за родителем (последующие сдвигаются), идемпотентно (#3427).
//
// Run with: node experiments/atex-production-planning-3619.test.js

process.env.TZ = 'UTC';

var api = require('../download/atex/js/production-planning.js');
var planning = api.planning;

var passed = 0;
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) {
        passed++;
    } else {
        console.log('  expected:', JSON.stringify(expected));
        console.log('  actual:  ', JSON.stringify(actual));
        process.exitCode = 1;
    }
}

// Три резки одного станко-дня с РАЗНЫМИ сигнатурами (не сливаются в цепочку) и явной
// «Очередностью». Оператор поставил их A(1) → C(2) → B(3). Пересборка по SETUP
// (ножи по убыванию: 6,16,16 → 16,16,6) дала бы B,C,A.
function cut(id, material, knifeWidths, runs, sequence, planDate) {
    return { id: id, slitter: { id: 'm3' }, materialId: material,
        winding: 'OUT', knifeWidths: knifeWidths, knifeCount: knifeWidths.length,
        plannedRuns: runs, planDate: planDate || '1780963200', sequence: sequence };
}
function widths(pairs) { var o = []; pairs.forEach(function(pr) { for (var i = 0; i < pr[1]; i++) o.push(pr[0]); }); return o; }

var queue = [
    cut('A', 'MW308', widths([[152, 5], [110, 1]]), 1, 1),   // 6 ножей
    cut('C', 'MW308', widths([[59, 14], [30, 2]]), 1, 2),    // 16 ножей
    cut('B', 'MR194', widths([[59, 14], [30, 2]]), 1, 3)     // 16 ножей
];
var oneDay = { perPassByCut: { A: 10, B: 10, C: 10 }, dayStartMin: 0, dayEndMin: 10000,
    times: { BETWEEN_CUTS: 0 }, planBaseMidnightMs: 1780963200000 };

function orderOf(ops) {
    return ops.updates.slice().sort(function(a, b) { return a.sequence - b.sequence; })
        .map(function(u) { return u.cutId; });
}

// 1) Без preserveOrder — пересборка по SETUP переставляет очередь (как #3421).
var reseq = planning.planCutOperations(queue, oneDay);
assertEqual(orderOf(reseq), ['B', 'C', 'A'],
    '#3619: без preserveOrder очередь пересобирается по SETUP (16,16,6 → B,C,A)');

// 2) С preserveOrder — порядок «Очередности» оператора СОХРАНЯЁТСЯ (A,C,B), не SETUP.
var preserveOpts = {};
for (var k in oneDay) preserveOpts[k] = oneDay[k];
preserveOpts.preserveOrder = true;
var kept = planning.planCutOperations(queue, preserveOpts);
assertEqual(orderOf(kept), ['A', 'C', 'B'],
    '#3619: preserveOrder сохраняет порядок оператора (A,C,B), очередь не пересобирается');
assertEqual(kept.creates, [], '#3619: всё влезает в день → переносов нет');
assertEqual(kept.deletes, [], '#3619: нет прежних продолжений → нет удалений');

// 3) preserveOrder + перелив дня: задание, не влезающее до конца дня, расщепляется;
//    продолжение встаёт СРАЗУ за родителем, следующее задание сдвигается на позицию ниже.
//    A(seq1): 15 проходов × 10 мин = 150 > день 100 → 10 проходов сегодня, 5 на след. день.
//    B(seq2): 5 проходов × 10 мин = 50 → встаёт после продолжения A (день уже занят A).
var split = planning.planCutOperations(
    [ cut('A', 'MW308', widths([[152, 6]]), 15, 1),
      cut('B', 'MR194', widths([[59, 16]]), 5, 2) ],
    { perPassByCut: { A: 10, B: 10 }, dayStartMin: 0, dayEndMin: 100,
      times: { BETWEEN_CUTS: 0 }, planBaseMidnightMs: 1780963200000, preserveOrder: true }
);
assertEqual(split.updates.map(function(u) { return { id: u.cutId, seq: u.sequence, runs: u.plannedRuns }; }),
    [ { id: 'A', seq: 1, runs: 10 }, { id: 'B', seq: 3, runs: 5 } ],
    '#3619: A — голова (seq1, 10 проходов сегодня); B сдвинут на seq3 (за продолжением A), порядок сохранён');
assertEqual(split.creates.map(function(c) { return { parent: c.parentCutId, seq: c.sequence, runs: c.plannedRuns }; }),
    [ { parent: 'A', seq: 2, runs: 5 } ],
    '#3619: остаток A → продолжение на след. день (seq2, 5 проходов) — заполняем день до конца');
assertEqual(split.deletes, [], '#3619: продолжений ещё не было → без удалений');

// 4) Идемпотентность (#3427): повторный прогон уже разбитой цепочки переиспользует
//    запись продолжения как update — ни одной новой записи, порядок тот же.
var again = planning.planCutOperations(
    [ cut('A', 'MW308', widths([[152, 6]]), 10, 1, '1780963200'),
      cut('Acont', 'MW308', widths([[152, 6]]), 5, 2, '1781049600'),   // продолжение A: СМЕЖНЫЙ день, та же сигнатура
      cut('B', 'MR194', widths([[59, 16]]), 5, 3, '1781049600') ],
    { perPassByCut: { A: 10, Acont: 10, B: 10 }, dayStartMin: 0, dayEndMin: 100,
      times: { BETWEEN_CUTS: 0 }, planBaseMidnightMs: 1780963200000, preserveOrder: true }
);
// A и Acont — смежные дни одной сигнатуры → сливаются в одну логическую резку (15 проходов),
// раскладываются обратно в A(seq1,10)+Acont(seq2,5); B остаётся seq3. Создавать нечего.
assertEqual(again.creates, [], '#3619/#3427: повторная раскладка не создаёт продолжений (переиспользует запись)');
assertEqual(again.deletes, [], '#3619/#3427: и не удаляет (нет лишних записей)');

console.log('\n' + passed + ' passed');
