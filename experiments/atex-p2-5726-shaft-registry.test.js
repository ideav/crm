// ideav/crm#5726 — реестр валов ИТС: отмеченные красным валы (изношены) остаются в «Серийном номере вала»,
// но «Не ставить в работу» — планировщик высечки их новым заданиям не даёт.
//
//   1. вал off не выбирается, даже когда рабочий вал того же типоразмера занят (задание ждёт рабочий);
//   2. начатое задание, в которое уже записан вал off, держит его;
//   3. все валы типоразмера off — задание ставится без вала с пометкой noShaft и строкой журнала;
//   4. экран читает «Не ставить в работу» из записи «Серийного номера вала» (BOOLEAN через flagOn).
//
// Run with: node experiments/atex-p2-5726-shaft-registry.test.js

process.env.TZ = 'UTC';

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

var C = require('../download/atex-p2/js/die-planning-core.js').core;
var S = C.readSettings([{ key: 'DIE_CYLINDER_CHANGE_MN', type: 'ATEH', value: '45' }, { key: 'DIE_KNIFE_CHANGE_MN', type: 'ATEH', value: '20' }], 'ateh1');
function ts(y, mo, d, h, mi) { return Date.UTC(y, mo - 1, d, h || 0, mi || 0) / 1000 - 180 * 60; }
var MON = ts(2026, 11, 2, 8, 0);
function J(id, o) {
    return Object.assign({ id: String(id), start: 0, status: 'Запланировано', pullsFact: 0, positionId: 'p' + id, machineId: '',
        dieId: 'k' + id, dieNo: 'N' + id, cylinderId: 'c116', cylinder: '116', materialId: 'm1', material: 'M', footage: 44 * 455,
        duration: 0, setup: 0, due: 0, rolls: 1 }, o || {});
}
var M1 = { id: 'M1', name: '1 высечка', stopMaterials: [] }, M2 = { id: 'M2', name: '2 высечка', stopMaterials: [] };
function itemsOf(plan) {
    var out = [];
    Object.keys(plan.machines).forEach(function(mid) { plan.machines[mid].items.forEach(function(i) { out.push(Object.assign({ mid: mid }, i)); }); });
    return out;
}
// реестр 116: 116/1 изношен, 116/2 рабочий
var SH = [{ id: 's1', no: '116/1', cylinderId: 'c116', off: true }, { id: 's2', no: '116/2', cylinderId: 'c116' }];

// 1. два задания 116 на двух станках: вал 116/1 off — оба на 116/2, второе ждёт
var two = itemsOf(C.orderQueue({ jobs: [J(1), J(2)], machines: [M1, M2], from: MON, settings: S, shafts: SH }));
assert(two.length === 2 && two.every(function(i) { return i.shaftId === 's2'; }), '«Не ставить в работу» 116/1 не берётся — оба задания на 116/2',
    JSON.stringify(two.map(function(i) { return [i.mid, i.jobId, i.shaftNo, i.start]; })));
var a = two[0], b = two[1];
assert(a.mid === b.mid || a.end <= b.start || b.end <= a.start, 'один рабочий вал — задания по времени не пересекаются');
var on = itemsOf(C.orderQueue({ jobs: [J(1), J(2)], machines: [M1, M2], from: MON, settings: S, shafts: SH.map(function(x) { return Object.assign({}, x, { off: false }); }) }));
assert(on.map(function(i) { return i.shaftId; }).sort().join() === 's1,s2', 'без отметки оба вала в работе (контроль)', JSON.stringify(on.map(function(i) { return [i.jobId, i.shaftId]; })));

// 2. начатое задание с записанным валом off держит его
var started = itemsOf(C.orderQueue({ jobs: [J(1, { status: 'В работе', machineId: 'M1', start: MON, duration: 120, shaftId: 's1' }), J(2, { footage: 44 * 60 })],
    machines: [M1, M2], from: MON, settings: S, shafts: SH }));
var st1 = started.filter(function(i) { return i.jobId === '1'; })[0], st2 = started.filter(function(i) { return i.jobId === '2'; })[0];
assert(st1 && st1.shaftId === 's1' && st2 && st2.shaftId === 's2', 'начатое на 116/1 задание держит его, новое — на 116/2',
    JSON.stringify([st1 && st1.shaftId, st2 && st2.shaftId]));

// 3. все валы типоразмера off — задание без вала, пометка и журнал
var log = [];
var none = itemsOf(C.orderQueue({ jobs: [J(1, { cylinderId: 'c132', cylinder: '132' })], machines: [M1], from: MON, settings: S,
    shafts: SH.concat([{ id: 's9', no: '132/1', cylinderId: 'c132', off: true }]), trace: function(r) { log.push(r); } }));
assert(none.length === 1 && !none[0].shaftId && none[0].noShaft === true, 'все валы 132 «Не ставить в работу» — вал не записывается, noShaft', JSON.stringify(none[0]));
assert(log.some(function(r) { return /нет рабочего вала 132/.test(r.text); }), 'журнал «Упорядочить» говорит, что рабочего вала нет', JSON.stringify(log.map(function(r) { return r.text; })));
var free = itemsOf(C.orderQueue({ jobs: [J(1, { cylinderId: 'c98', cylinder: '98' })], machines: [M1], from: MON, settings: S, shafts: SH }));
assert(free[0] && !free[0].noShaft, 'у типоразмера нет серийных — по-прежнему один вал без пометки');

// 4. BOOLEAN из записи
assert(C.flagOn('1') && !C.flagOn('') && !C.flagOn('0'), 'flagOn: «1» — снят с работы, пусто/0 — в работе');

console.log('\nИтого: ' + passed + ' из ' + total);
