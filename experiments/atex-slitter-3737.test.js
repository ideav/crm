// Unit tests for #3737 — «оставить конфигурацию» в пульте слиттера через отчёт
// next_cut_setup (93371). Отчёт идёт по расписанию (task_start ↑), по строке на «Партию ГП»:
// ширина, сырьё, намотка — БЕЗ «Кол-ва полос». core.nextDaySetupConfig вытаскивает из него
// конфигурацию первой резки следующего дня, core.widthSetKey сравнивает наборы ножей по
// ширинам (общая гранулярность с отчётом), core.dayStartTimestamp даёт нижнюю границу запроса.
//
// Run with: node experiments/atex-slitter-3737.test.js

process.env.TZ = 'Europe/Moscow';

var mod = require('../download/atex/js/slitter.js');
var core = mod.core;

var passed = 0;
function assert(cond, name) {
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}
function eq(a, b, name) { assert(a === b, name + ' (' + JSON.stringify(a) + ' === ' + JSON.stringify(b) + ')'); }

// ── widthSetKey: порядко-независимый набор ширин, без кол-ва ──
eq(core.widthSetKey([{ width: '99.00' }, { width: '55.00' }, { width: '32.50' }]), '32.5|55|99',
    'widthSetKey: ширины сортируются, ".00" нормализуется');
eq(core.widthSetKey([{ width: 55 }, { width: 99 }, { width: 32.5 }]),
   core.widthSetKey([{ width: 32.5 }, { width: 99 }, { width: 55 }]),
   'widthSetKey: порядок строк не влияет');
eq(core.widthSetKey([55, 99, 32.5]), '32.5|55|99', 'widthSetKey: принимает и числа');
eq(core.widthSetKey([{ width: 0 }, { width: 55 }]), '55', 'widthSetKey: нулевые ширины отброшены');
eq(core.widthSetKey([]), '', 'widthSetKey: пусто → пустой ключ');
// Кол-во полос («Кол-во полос»/qty) на ключ НЕ влияет — отчёт его не отдаёт.
eq(core.widthSetKey([{ width: 55, qty: 7 }]), core.widthSetKey([{ width: 55, qty: 3 }]),
   'widthSetKey: разное кол-во полос → один ключ (qty игнорируется)');

// ── dayStartTimestamp: полночь календарного дня штампа (локальная зона) ──
// 1782557173 = 27.06.2026 (MSK). Полночь 27.06 MSK = 1782507600.
eq(core.dayStartTimestamp('1782557173'), 1782507600, 'dayStartTimestamp: полночь дня штампа (MSK)');
eq(core.dayStartTimestamp(''), null, 'dayStartTimestamp: пусто → null');
eq(core.dayStartTimestamp('27.06.2026'), null, 'dayStartTimestamp: не unix-штамп → null');

// ── nextDaySetupConfig: первая резка следующего календарного дня из строк отчёта ──
// Реальная форма строк next_cut_setup (станок 1279). День 27-го (task_start 1782536400),
// затем 28-е (1782622800), затем 29-е (1782715146 — два прохода 105/40).
var rows = [
    { task_start: '1782536400', slitter_id: '1279', task_id: '112722', wind_dir: 'IN',  batch_ord: '1', width: '25.00',  material_id: '1245' },
    { task_start: '1782541020', slitter_id: '1279', task_id: '111136', wind_dir: 'IN',  batch_ord: '1', width: '25.00',  material_id: '39014' },
    { task_start: '1782622800', slitter_id: '1279', task_id: '111563', wind_dir: 'IN',  batch_ord: '1', width: '55.00',  material_id: '2208' },
    { task_start: '1782715146', slitter_id: '1279', task_id: '111591', wind_dir: 'IN',  batch_ord: '2', width: '40.00',  material_id: '2208' },
    { task_start: '1782715146', slitter_id: '1279', task_id: '111591', wind_dir: 'IN',  batch_ord: '1', width: '105.00', material_id: '2208' }
];
var curDay = core.dateKey('1782536400');   // 27.06.2026

var n1 = core.nextDaySetupConfig(rows, curDay);
assert(n1 != null, 'nextDaySetupConfig: следующий день найден');
eq(n1 && n1.taskId, '111563', 'следующий день после 27-го (по task_start) = задание 111563 (28-е)');
eq(n1 && n1.widthKey, '55', 'конфигурация 28-го = ширина 55');
eq(n1 && n1.materialId, '2208', 'сырьё 28-го = 2208');

// С 28-го следующий день — 29-е, два прохода (40 и 105), собираются в один ключ независимо
// от порядка batch_ord в строках.
var n2 = core.nextDaySetupConfig(rows, core.dateKey('1782622800'));
eq(n2 && n2.taskId, '111591', 'после 28-го = задание 111591 (29-е)');
eq(n2 && n2.widthKey, '40|105', 'конфигурация 29-го = ширины 40 и 105 (порядок не важен)');

// Нет дня позже текущего → null.
eq(core.nextDaySetupConfig(rows, core.dateKey('1782715146')), null, 'последний день → следующего нет → null');
eq(core.nextDaySetupConfig([], curDay), null, 'пустой отчёт → null');

// ── Сравнение «оставить ножи»: текущая резка (полосы fetchStrips) vs следующий день ──
// Текущие полосы 28-го дня — та же ширина 55 → ножи совпадают, но другое кол-во полос.
var curStripsSame = [{ width: '55.00', qty: '8' }];
eq(core.widthSetKey(curStripsSame) === n1.widthKey, true,
   'набор ножей текущей резки совпадает с первой резкой следующего дня (по ширинам)');
var curStripsDiff = [{ width: '55.00', qty: '8' }, { width: '99.00', qty: '3' }];
eq(core.widthSetKey(curStripsDiff) === n1.widthKey, false,
   'другой набор ширин → ножи не совпадают');

console.log('\n' + passed + ' passed');
