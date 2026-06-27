// Unit tests for #3808 — «Почему опять в переходящем задании нет сырья? См. станок 4.»
//
// Корень: continuationSignature (станок|сырьё|намотка|ножи) ВКЛЮЧАЕТ materialId. Переходящий
// сегмент дробления по дням с ПУСТЫМ «Видом сырья» получал другую сигнатуру, чем его голова,
// → mergeContinuationChains не сливал их в цепочку → materialForCutId (#3795) не находил голову
// и не лечил сегмент: переходящее задание оставалось «—». materialByCut тоже не восстанавливал
// (обеспечения продолжения ведут на НЕактивную позицию).
//
// Фикс: healContinuationMaterials — материал-АГНОСТИЧНАЯ группировка (станок|намотка|ножи); если
// в группе ровно одно непустое сырьё, проставляем его сегментам с пустым. Неоднозначные группы
// (несколько сырьёв) не трогаем.
//
// Run with: node experiments/atex-production-planning-3808.test.js

process.env.TZ = 'UTC';
var planning = require('../download/atex/js/production-planning.js').planning;

var passed = 0;
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; }
    else { console.log('  expected:', JSON.stringify(expected)); console.log('  actual:  ', JSON.stringify(actual)); process.exitCode = 1; }
}
function cut(id, slitter, materialId, winding, kw) {
    return { id: id, slitter: { id: slitter }, materialId: materialId, winding: winding, knifeWidths: kw };
}

// ── 1) Базовый случай: голова M + переходящий сегмент с пустым сырьём (та же конфигурация) ──
var c1 = [
    cut('head', '4', '2158', 'IN', [55, 33]),   // голова дня N — сырьё MW411
    cut('cont', '4', '',     'IN', [55, 33])    // переходящий сегмент дня N+1 — сырьё пустое
];
var healed1 = planning.healContinuationMaterials(c1);
assertEqual(healed1, ['cont'], '#3808: вылечен переходящий сегмент (id cont)');
assertEqual(c1[1].materialId, '2158', '#3808: переходящему сегменту проставлено сырьё головы (2158)');
assertEqual(c1[0].materialId, '2158', '#3808: сырьё головы не тронуто');

// ── 2) Цепочка из нескольких сегментов ──
var c2 = [
    cut('h', '4', 'M', 'OUT', [40, 40]),
    cut('a', '4', '',  'OUT', [40, 40]),
    cut('b', '4', '',  'OUT', [40, 40])
];
assertEqual(planning.healContinuationMaterials(c2).sort(), ['a', 'b'], '#3808: вылечены оба пустых сегмента цепочки');
assertEqual([c2[1].materialId, c2[2].materialId], ['M', 'M'], '#3808: обоим проставлено сырьё головы');

// ── 3) Неоднозначность: две головы с разным сырьём, та же конфигурация → НЕ трогаем ──
var c3 = [
    cut('x', '4', 'M1', 'IN', [50, 50]),
    cut('y', '4', 'M2', 'IN', [50, 50]),
    cut('z', '4', '',   'IN', [50, 50])   // непонятно, чьё продолжение → оставляем пустым
];
assertEqual(planning.healContinuationMaterials(c3), [], '#3808: неоднозначная группа (2 сырья) — не лечим');
assertEqual(c3[2].materialId, '', '#3808: пустой сегмент остаётся пустым при неоднозначности');

// ── 4) Разные ножи → разные цепочки: пустой сегмент с ДРУГИМ набором ножей не лечится чужим ──
var c4 = [
    cut('p', '4', 'M', 'IN', [55, 33]),
    cut('q', '4', '',  'IN', [20, 20])    // другой набор ножей — не та же цепочка
];
assertEqual(planning.healContinuationMaterials(c4), [], '#3808: другой набор ножей — не сливаем в цепочку');
assertEqual(c4[1].materialId, '', '#3808: сегмент с другими ножами остаётся пустым');

// ── 5) Разные станки не смешиваем ──
var c5 = [
    cut('s4', '4', 'M', 'IN', [60, 60]),
    cut('s3', '3', '',  'IN', [60, 60])   // другой станок
];
assertEqual(planning.healContinuationMaterials(c5), [], '#3808: другой станок — отдельная группа, не лечим');

// ── 6) Источника нет (все пустые) → ничего не лечим ──
var c6 = [ cut('e1', '4', '', 'IN', [10, 10]), cut('e2', '4', '', 'IN', [10, 10]) ];
assertEqual(planning.healContinuationMaterials(c6), [], '#3808: нет непустого сырья в группе — лечить нечем');

// ── 7) После лечения continuationSignature головы и продолжения СОВПАДАЮТ (ключевой эффект:
//        mergeContinuationChains снова объединит их, и applySplitPlan #3795 пропишет сырьё) ──
var c7 = [ cut('H', '4', '777', 'IN', [33, 55]), cut('C', '4', '', 'IN', [33, 55]) ];
planning.healContinuationMaterials(c7);
assertEqual(planning.continuationSignature(c7[0]), planning.continuationSignature(c7[1]),
    '#3808: после лечения сигнатуры головы и продолжения равны (цепочка снова сливается)');

console.log('\n' + passed + ' passed');
