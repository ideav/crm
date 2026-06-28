// Unit tests for #3830 — «Фольга не влезла в 4 станок, но могла бы влезть в первый».
//
// При генерации вся фольга (общее сырьё «Фольга …») цеплялась chooseSlitterBySetup к одному
// станку (та же подпись сырья → attach), и группировка по сырью была ВЫШЕ загрузки → фольга
// копилась на одном станке и вылетала за ёмкость дня (≈514 мин при 450), хотя у соседнего
// станка день был пуст.
//
// Фикс (#3830): рабочая ёмкость дня станка передаётся в chooseSlitterBySetup; признак
// «день станка с этой резкой переполнен» (overflow) — ПЕРВЫЙ критерий выбора. Резку не
// сваливаем на переполненный станок, если есть допустимый со свободным местом; при равных
// overflow держим прежнюю группировку/балансировку (#3666/#3801). Без ёмкости (тесты до #3830,
// обратная совместимость) overflow всегда 0 — поведение прежнее.
//
// Run with: node experiments/atex-production-planning-3830.test.js

process.env.TZ = 'UTC';
var planning = require('../download/atex/js/production-planning.js').planning;

var passed = 0;
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; }
    else { console.log('  expected:', JSON.stringify(expected)); console.log('  actual:  ', JSON.stringify(actual)); process.exitCode = 1; }
}

var SLITTERS = [{ id: '1' }, { id: '4' }];
// Резка фольги: общее сырьё «FOIL» + намотка IN + один набор ножей → все цепляются друг к другу.
function foil(id, dur) {
    return { id: id, materialId: 'FOIL', winding: 'IN', batchId: 'b', knifeCount: 1,
        knifeWidths: [30], rollerWidth: 0, duration: dur };
}
var CAP = 450;

// ── 1) Станок 4 уже забит фольгой (450 мин), новая фольга — на ПУСТОЙ станок 1 ───────────────
var groupsFull = { '4': [foil('a', 75), foil('b', 75), foil('c', 75), foil('d', 75), foil('e', 75), foil('f', 75)], '1': [] };
var loadFull = { '4': 6, '1': 0 };
assertEqual(
    planning.chooseSlitterBySetup(foil('NEW', 75), SLITTERS, groupsFull, loadFull, null, CAP),
    '1', '#3830: станок 4 переполнен фольгой → новая фольга на свободный станок 1');

// ── 2) Без ёмкости (обратная совместимость) — фольга по-прежнему на станок 4 (группировка) ───
assertEqual(
    planning.chooseSlitterBySetup(foil('NEW', 75), SLITTERS, groupsFull, loadFull, null),
    '4', '#3830: без ёмкости — прежнее поведение (фольга к фольге на станок 4)');

// ── 3) На станке 4 ещё есть место — держим группировку (фольга к фольге), не разбрасываем ─────
var groupsRoom = { '4': [foil('a', 75), foil('b', 75), foil('c', 75)], '1': [] };   // 225 мин
var loadRoom = { '4': 3, '1': 0 };
assertEqual(
    planning.chooseSlitterBySetup(foil('NEW', 75), SLITTERS, groupsRoom, loadRoom, null, CAP),
    '4', '#3830: на станке 4 есть место (225+75 ≤ 450) → группируем фольгу на станке 4');

// ── 4) Оба станка с фольгой, но станок 4 переполнен — на менее загруженный с местом ──────────
var groupsBoth = {
    '4': [foil('a', 120), foil('b', 120), foil('c', 120), foil('d', 120)],   // 480 > 450
    '1': [foil('x', 100)]                                                     // 100
};
var loadBoth = { '4': 4, '1': 1 };
assertEqual(
    planning.chooseSlitterBySetup(foil('NEW', 75), SLITTERS, groupsBoth, loadBoth, null, CAP),
    '1', '#3830: станок 4 за ёмкостью → фольга на станок 1 (тоже фольга, но есть место)');

console.log('\n' + passed + ' passed');
