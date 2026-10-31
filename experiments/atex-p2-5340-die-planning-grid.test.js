// ideav/crm#5340 — «Планирование высечки»: очередь колонками «станок × день».
//
//   1. колонка есть у КАЖДОГО станка справочника, в том числе без заданий;
//   2. внутри колонки — рабочие дни горизонта; в дне — задания этого дня по порядку,
//      сумма минут дня (наладка + вырубка) и ёмкость смены;
//   3. задание, переходящее на следующий день, видно в обоих днях, во втором — как продолжение
//      без наладки;
//   4. выполненные задания в колонки не попадают.
//
// Run with: node experiments/atex-p2-5340-die-planning-grid.test.js

process.env.TZ = 'UTC';

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

var C = require('../download/atex-p2/js/die-planning-core.js').core;
var S = C.readSettings([], 'ateh1');
function ts(y, mo, d, h, mi) { return Date.UTC(y, mo - 1, d, h || 0, mi || 0) / 1000 - 180 * 60; }   // Москва
var MON = ts(2026, 11, 2, 8, 0);
function J(id, o) {
    return Object.assign({ id: String(id), start: 0, status: 'Запланировано', pullsFact: 0, positionId: 'p' + id, machineId: '',
        dieId: 'k' + id, dieNo: 'N' + id, cylinderId: 'c1', cylinder: '96', materialId: 'm1', material: 'M', footage: 44 * 60,
        duration: 0, setup: 0, due: 0, rolls: 1 }, o || {});
}
var M1 = { id: 'M1', name: '1 высечка', cylinders: [], stopMaterials: [] };
var M2 = { id: 'M2', name: '2 высечка', cylinders: ['c9'], stopMaterials: [] };   // c1 не берёт — останется пустым
var M5 = { id: 'M5', name: '5 высечка', cylinders: ['c9'], stopMaterials: [] };
var cal = C.createCalendar(S);
var day0 = cal.dayOf(MON);
var days = [day0, day0 + 1, day0 + 2];

var plan = C.orderQueue({ jobs: [J(1), J(2, { footage: 44 * 455 }), J(3, { status: 'Выполнено', machineId: 'M1', start: MON })],
    machines: [M1, M2, M5], from: MON, settings: S });
var grid = typeof C.queueGrid === 'function' ? C.queueGrid(plan.machines, [M1, M2, M5], days, S) : null;

assert(grid && grid.columns.length === 3 && grid.columns.map(function(c) { return c.machineId; }).join() === 'M1,M2,M5',
    'колонка у каждого станка справочника, в его порядке', grid && JSON.stringify(grid.columns.map(function(c) { return c.machineId; })));
if (grid) {
    var c1 = grid.columns[0], c2 = grid.columns[1];
    assert(c2.days.length === 3 && c2.days.every(function(d) { return d.items.length === 0 && d.minutes === 0; }),
        'станок без заданий — колонка с пустыми днями', JSON.stringify(c2.days));
    assert(c1.days.length === 3 && c1.days[0].day === day0 && c1.days[0].capacity === 455, 'дни горизонта с ёмкостью смены', JSON.stringify(c1.days[0]));
    var d0 = c1.days[0];
    assert(d0.items.map(function(i) { return i.jobId; }).join() === '1,2', 'в дне — задания этого дня по порядку', JSON.stringify(d0.items));
    // перед заданием 1 на станке стоит выполненное 3 на том же валу — меняется только нож
    assert(d0.items[0].setupKind === 'knife' && d0.items[0].setup === 20 && d0.items[1].setupKind === 'knife' && d0.items[1].setup === 20,
        'у задания — вид и минуты наладки', JSON.stringify(d0.items));
    assert(d0.minutes === 455, 'сумма минут дня = наладки + вырубка, не больше ёмкости', String(d0.minutes));
    var d1 = c1.days[1];
    assert(d1.items.length === 1 && d1.items[0].jobId === '2' && d1.items[0].continuation === true && d1.items[0].setup === 0 && d1.minutes > 0,
        'задание, перешедшее на следующий день, видно там продолжением без наладки', JSON.stringify(d1));
    assert(!c1.days.some(function(d) { return d.items.some(function(i) { return i.jobId === '3'; }); }), 'выполненное задание в колонки не попадает');
}

console.log('\nИтого: ' + passed + ' из ' + total);
