// ideav/crm#5346 — нормы наладки и скорости высечки по листу «План» заказчика.
//
//   1. наладка: другой вал — DIE_CYLINDER_CHANGE_MN (90), тот же вал и другой нож —
//      DIE_KNIFE_CHANGE_MN (на ateh1 — 60), тот же вал и нож, другая втулка — DIE_SLEEVE_CHANGE_MN (20),
//      всё то же — 0; втулка не указана у одного из заданий — смены втулки нет;
//   2. вырубка: ролик короче DIE_SHORT_ROLL_M (50 м) — DIE_SPEED_SHORT_M_MIN (28 м/мин), иначе
//      DIE_SPEED_M_MIN (44); порог 0 — одна скорость; длина ролика = метраж × ручьи / рулонов;
//   3. очередь и записанный план различают смену втулки; формирование заданий считает
//      длительность с учётом длины ролика.
//
// Run with: node experiments/atex-p2-5346-die-setup-norms.test.js

process.env.TZ = 'UTC';

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

var C = require('../download/atex-p2/js/die-planning-core.js').core;
// DIE_KNIFE_CHANGE_MN=60 — значение «Настройки» ateh1 (решение владельца 01.11.2026); остальное — умолчания.
var S = C.readSettings([{ key: 'DIE_KNIFE_CHANGE_MN', type: 'ATEH', value: '60' }], 'ateh1');

// 1. Наладка — все сочетания «вал × нож × втулка».
var base = { cylinderId: 'c1', dieId: 'k1', sleeveId: 's76', sleeve: '76 мм' };
var cases = [
    [{ cylinderId: 'c2', dieId: 'k1', sleeveId: 's76' }, 'cylinder', 90],
    [{ cylinderId: 'c2', dieId: 'k2', sleeveId: 's40' }, 'cylinder', 90],
    [{ cylinderId: 'c1', dieId: 'k2', sleeveId: 's76' }, 'knife', 60],
    [{ cylinderId: 'c1', dieId: 'k2', sleeveId: 's40' }, 'knife', 60],
    [{ cylinderId: 'c1', dieId: 'k1', sleeveId: 's40' }, 'sleeve', 20],
    [{ cylinderId: 'c1', dieId: 'k1', sleeveId: 's76' }, 'none', 0],
    [{ cylinderId: 'c1', dieId: 'k1', sleeve: '1,5" (40 мм)' }, 'sleeve', 20],
    [{ cylinderId: 'c1', dieId: 'k1', sleeve: '3"' }, 'none', 0],
    [{ cylinderId: 'c1', dieId: 'k1' }, 'none', 0]
];
cases.forEach(function(c, i) {
    var prev = i === 6 || i === 7 ? { cylinderId: 'c1', dieId: 'k1', sleeve: '3" (76 мм)' } : base;
    var k = C.setupKind(prev, c[0]), m = C.setupMinutes(prev, c[0], S);
    assert(k === c[1] && m === c[2], 'наладка ' + JSON.stringify(c[0]) + ' → ' + c[1] + ' ' + c[2], k + ' ' + m);
});
assert(C.setupMinutes(null, base, S) === 90, 'станок пуст — смена вала');
var S2 = C.readSettings([{ key: 'DIE_SLEEVE_CHANGE_MN', type: 'ATEH', value: '15' }, { key: 'DIE_KNIFE_CHANGE_MN', type: 'ATEH', value: '45' }], 'ateh1');
assert(C.setupMinutes(base, { cylinderId: 'c1', dieId: 'k1', sleeveId: 's40' }, S2) === 15 && C.setupMinutes(base, { cylinderId: 'c1', dieId: 'k2' }, S2) === 45,
    'нормы втулки и ножа читаются из «Настройки»');

// 2. Скорость вырубки по длине ролика.
assert(C.runMinutes(2000, S) === 46, 'обычный ролик / без длины — 44 м/мин', C.runMinutes(2000, S));
assert(C.runMinutes(2000, S, 49.9) === 72, 'ролик < 50 м — 28 м/мин', C.runMinutes(2000, S, 49.9));
assert(C.runMinutes(2000, S, 50) === 46, 'ролик ровно 50 м — обычная скорость');
var S0 = C.readSettings([{ key: 'DIE_SHORT_ROLL_M', type: 'ATEH', value: '0' }], 'ateh1');
assert(C.runMinutes(2000, S0, 10) === 46, 'порог 0 — одна скорость');
assert(C.rollLengthM({ footage: 300, streams: 4, rolls: 40 }) === 30 && C.rollLengthM({ footage: 300, streams: 0, rolls: 40 }) === 0,
    'длина ролика = метраж × ручьи / рулонов; без ручьёв — 0');

// 3. Очередь: тот же нож, другая втулка — наладка 20; короткие ролики режутся медленнее.
var MON = Date.UTC(2026, 10, 2, 5, 0, 0) / 1000; // пн 02.11.2026 08:00 МСК
var due = '30.11.2026';
var jobs = C.buildJobs([
    { job_id: 1, footage: 440, die_streams: 2, rolls: 4, machine_id: '', die_id: 'k1', cylinder_id: 'c1', sleeve_id: 's76', sleeve: '76', due: due },
    { job_id: 2, footage: 440, die_streams: 2, rolls: 40, machine_id: '', die_id: 'k1', cylinder_id: 'c1', sleeve_id: 's40', sleeve: '40', due: due }
]);
var plan = C.orderQueue({ jobs: jobs, machines: [{ id: 'M1', name: '1' }], from: MON, settings: S });
var it = plan.machines.M1.items;
assert(it.length === 2 && it[0].setupKind === 'cylinder' && it[1].setupKind === 'sleeve' && it[1].setup === 20,
    'очередь: второе задание — смена втулки 20 мин', JSON.stringify(it.map(function(i) { return [i.setupKind, i.setup]; })));
assert(it[0].run === 10 && it[1].run === 16, 'ролик 220 м — 44 м/мин (10 мин), ролик 22 м — 28 м/мин (16 мин)', it[0].run + ' ' + it[1].run);

// Записанный план: вид наладки по минутам.
assert(C.kindOfSetup(90, S) === 'cylinder' && C.kindOfSetup(60, S) === 'knife' && C.kindOfSetup(20, S) === 'sleeve' && C.kindOfSetup(0, S) === 'none',
    'вид наладки по записанным минутам');
var rec = C.recordedPlan([{ id: '7', machineId: 'M1', start: MON, setup: 20, duration: 30, status: 'Запланировано' }], [{ id: 'M1' }], S, MON);
assert(rec.machines.M1.items[0].setupKind === 'sleeve', 'записанный план: 20 мин — смена втулки');

console.log('\n' + passed + '/' + total + ' passed');
