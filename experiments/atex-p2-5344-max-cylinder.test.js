// ideav/crm#5344 — «Макс. вал» станка высечки.
//
// По плану заказчика «2 высечка» работает на валах не больше 104 зубьев (541 заказ из 545),
// остальные станки — до 142/148. У станка поле «Макс. вал»: вал больше — на станок не ставится.
//   1. machineAllows отказывает валу больше максимума и называет причину; вал ≤ максимума — можно;
//   2. пустой максимум (0) — станок не ограничен; вал без числа зубьев ограничением не режется;
//   3. «Упорядочить» не ставит большой вал на такой станок;
//   4. machinesFromRecords читает «Макс. вал» из записи станка (opts.maxCylinderReq).
//
// Run with: node experiments/atex-p2-5344-max-cylinder.test.js

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
        dieId: 'k' + id, dieNo: 'N' + id, cylinderId: 'c96', cylinder: '96', materialId: 'm1', material: 'M', footage: 44 * 60,
        duration: 0, setup: 0, due: 0, rolls: 1 }, o || {});
}
var M1 = { id: 'M1', name: '1 высечка', cylinders: [], stopMaterials: [] };
var M2 = { id: 'M2', name: '2 высечка', cylinders: [], stopMaterials: [], maxCylinder: 104 };
var big = J(1, { cylinderId: 'c116', cylinder: '116' });

var r = C.machineAllows(M2, big);
assert(!r.ok && /116/.test(r.reason) && /104/.test(r.reason), 'вал 116 на станок с «Макс. вал» 104 не ставится, причина названа', r.reason);
assert(C.machineAllows(M2, J(2, { cylinderId: 'c104', cylinder: '104' })).ok, 'вал, равный максимуму, допустим');
assert(C.machineAllows(M2, J(3)).ok, 'вал меньше максимума допустим');
assert(C.machineAllows(M1, big).ok, 'станок без максимума валом не ограничен');
assert(C.machineAllows(Object.assign({}, M2, { maxCylinder: 0 }), big).ok, 'максимум 0 = не задан');
assert(C.machineAllows(M2, J(4, { cylinderId: '', cylinder: '' })).ok, 'вал не указан — ограничение не применяется');

var on = function(p, mid) { return ((p.machines[mid] || { items: [] }).items).map(function(i) { return i.jobId; }); };
var plan = C.orderQueue({ jobs: [big, J(2, { cylinderId: 'c104', cylinder: '104' })], machines: [M1, M2], from: MON, settings: S });
assert(on(plan, 'M2').indexOf('1') < 0 && on(plan, 'M1').indexOf('1') >= 0, '«Упорядочить» ставит вал 116 на станок без ограничения', JSON.stringify([on(plan, 'M1'), on(plan, 'M2')]));
var only = C.orderQueue({ jobs: [J(5, { cylinderId: 'c116', cylinder: '116' }), J(6)], machines: [M2], from: MON, settings: S });
assert(on(only, 'M2').join() === '6', 'единственный станок с «Макс. вал» 104 вал 116 не берёт, вал 96 берёт', JSON.stringify(on(only, 'M2')));

var recs = [{ id: '6', val: '2 высечка', reqs: { r7: '104' } }, { id: '7', val: '1 высечка', reqs: {} }];
var ms = C.machinesFromRecords(recs, { machine: { reqs: {} } }, { maxCylinderReq: 'r7' });
assert(ms[0].maxCylinder === 104 && !(ms[1].maxCylinder > 0), '«Макс. вал» читается из записи станка', JSON.stringify(ms));

// «Ножи и валы»: у вала больше максимума станка в списке станков этого станка нет.
var D = require('../download/atex-p2/js/dies.js').core;
var tt = { machine: { reqs: {} }, cylinder: { reqs: {} } };
var cyl = D.cylinderRows([{ id: 'c104', val: '104', reqs: {} }, { id: 'c116', val: '116', reqs: {} }],
    [{ id: 'm1', val: '1 высечка', reqs: {} }, { id: 'm2', val: '2 высечка', reqs: { r7: '104' } }], [], tt, 'r7');
assert(cyl[0].machines.join('|') === '1 высечка|2 высечка' && cyl[1].machines.join('|') === '1 высечка',
    '«Ножи и валы»: вал 116 на «2 высечку» (макс. 104) не встаёт, 104 встаёт', JSON.stringify(cyl.map(function(c) { return c.machines; })));

// Пульт высечки: смена вала предлагает только валы не больше максимума станка.
var DC = require('../download/atex-p2/js/die-cutter.js').core;
var cc = DC.compatibleCylinders({ cylinderId: 'c96' }, [{ id: 'c96', val: '96' }, { id: 'c104', val: '104' }, { id: 'c116', val: '116' }],
    { cylinderIds: [], maxCylinder: 104 });
assert(cc.map(function(c) { return c.id; }).join() === 'c104', 'пульт: смена вала — без валов больше «Макс. вала» станка', JSON.stringify(cc));

console.log('\nИтого: ' + passed + ' из ' + total);
