// Unit tests for #3738 — «Выводить в панели atex-pp-cut инфо о Втулке — после лидера».
// Отчёт cut_planning отдаёт колонку cut_sleeve (имя «Диаметр втулки» обеспеченной
// позиции, аналогично cut_leader). rowsToPlanning агрегирует её в cut.sleeves по всем
// строкам резки: одна резка единодиаметровая (обычно одна втулка), несколько — легаси-
// смешение (в панели выделяется предупреждением). Значения тримятся — в справочнике
// у части названий встречается ведущий таб.
//
// Run with: node experiments/atex-production-planning-3738.test.js

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

function row(cutId, supplyId, posId, leader, sleeve) {
    return {
        cut_id: cutId, cut_plan_date: '1780963200',
        cut_slitter_id: 'm4', cut_slitter: 'Станок 4',
        supply_id: supplyId, supply_position_id: posId,
        cut_leader: leader, cut_sleeve: sleeve
    };
}

// ── 1) Одна резка, два обеспечения с ОДНОЙ втулкой → одна плашка (dedup) ──
var oneSleeve = planning.rowsToPlanning([
    row('C1', 's1', 'p1', 'MONOCHROME', 'Втулка картонная 1" длина 1 метр'),
    row('C1', 's2', 'p2', 'MONOCHROME', 'Втулка картонная 1" длина 1 метр')
]);
assertEqual(byId(oneSleeve).C1.sleeves, ['Втулка картонная 1" длина 1 метр'],
    '#3738: одна втулка на резку — без дублей');

// ── 2) Смешение втулок (легаси) + ведущий таб тримится ──
var mixed = planning.rowsToPlanning([
    row('C2', 's3', 'p3', 'Прозрачный', '\tВтулка пластиковая фиолетовая 1" ширина 110 мм'),
    row('C2', 's4', 'p4', 'Прозрачный', 'Втулка картонная 0.5" ширина 57 мм')
]);
assertEqual(byId(mixed).C2.sleeves,
    ['Втулка пластиковая фиолетовая 1" ширина 110 мм', 'Втулка картонная 0.5" ширина 57 мм'],
    '#3738: разные втулки сохраняются по порядку; ведущий таб обрезан');

// ── 3) Нет втулки (пустой cut_sleeve) → пустой массив (плашка не рисуется) ──
var none = planning.rowsToPlanning([
    row('C3', 's5', 'p5', 'MONOCHROME', '')
]);
assertEqual(byId(none).C3.sleeves, [], '#3738: пустой cut_sleeve → нет втулок');

// ── 4) Резка без обеспечения (supply_id пуст) остаётся в очереди, втулок нет ──
var noSupply = planning.rowsToPlanning([
    row('C4', '', '', '', '')
]);
assertEqual(byId(noSupply).C4.sleeves, [], '#3738: резка без обеспечения — без втулок');
assertEqual(noSupply.supplies.length, 0, '#3738: пустой supply_id не создаёт обеспечение');

function byId(res) {
    var m = {};
    (res.cuts || []).forEach(function(c) { m[c.id] = c; });
    return m;
}

console.log('\n' + passed + ' passed');
