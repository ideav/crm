// #5428: ограничения станков высечки — реквизиты станка, у каждого станка свои (решения владельца 06.11.2026):
// диапазон валов «Мин. вал»–«Макс. вал» (2-й станок: 96–104), «Стоп-лист основы» (2-й: ПП) — запрет и вручную;
// у туррели — «Мин. метраж серии, м» (40 000: одно задание или серия одного артикула суммарно),
// «Макс. намотка ролика, м» (350), «Втулка не уже диаметра» — при планировании; вручную на туррель можно любое.
// Run with: node experiments/atex-p2-5428-machine-constraints.test.js
'use strict';

var P = require('../download/atex-p2/js/die-planning-core.js').core;

var pass = 0, total = 0;
function assert(cond, msg, extra) {
    total++;
    if (cond) { pass++; console.log('PASS — ' + msg); }
    else { console.log('FAIL — ' + msg + (extra !== undefined ? '  ' + extra : '')); process.exitCode = 1; }
}

var MON = Date.UTC(2026, 10, 2, 5, 0) / 1000;   // пн 08:00 по Москве
var S = P.readSettings([], 'ateh1');
function J(id, o) {
    return Object.assign({ id: String(id), start: 0, status: 'Запланировано', pullsFact: 0, positionId: 'p' + id, machineId: '',
        dieId: 'k1', dieNo: 'N1', streams: 1, cylinderId: 'c1', cylinder: '100', materialId: 'm1', material: 'M', baseId: 'b-paper', base: 'бумага',
        footage: 40000, duration: 0, setup: 0, due: 0, rolls: 200, article: '', sleeve: 'Втулка картонная (76мм/5мм/1000мм)', sleeveWidth: 80 }, o || {});
}
var M1 = { id: 'M1', name: '1 высечка', stopMaterials: [] };
var M2 = { id: 'M2', name: '2 высечка', stopMaterials: [], stopBases: ['b-pp'], minCylinder: 96, maxCylinder: 104 };
var T4 = { id: 'M4', name: '4 высечка', stopMaterials: [], turret: true, minSeriesM: 40000, maxRollM: 350, sleeveNotNarrower: true };
function on(p, mid) { return ((p.machines[mid] || { items: [] }).items).map(function(i) { return i.jobId; }); }
function ok(m, j) { return P.machineAllows(m, j, S).ok; }

// ── Валы: диапазон, границы включены ──
assert(!ok(M2, J(1, { cylinder: '95' })) && ok(M2, J(1, { cylinder: '96' })) && ok(M2, J(1, { cylinder: '104' })) && !ok(M2, J(1, { cylinder: '105' })),
    '2-й станок: валы 96–104 включительно');
var lo = P.machineAllows(M2, J(1, { cylinder: '88' }), S);
assert(!lo.ok && lo.reason.indexOf('96–104') >= 0, 'вал меньше «Мин. вала» — причина с диапазоном станка', lo.reason);
assert(!ok(M2, J(1, { cylinder: '120', machineId: 'M2' })), 'вал вне диапазона не встаёт и вручную');
assert(ok(M1, J(1, { cylinder: '88' })) && ok(M1, J(1, { cylinder: '200' })), 'станок без границ берёт любой вал');
assert(ok(Object.assign({}, M1, { minCylinder: 96 }), J(1, { cylinder: '500' })), 'задана только нижняя граница — сверху не ограничен');

// ── Стоп-лист основы ──
var pp = P.machineAllows(M2, J(1, { baseId: 'b-pp', base: 'пп' }), S);
assert(!pp.ok && /основа «пп»/.test(pp.reason), '2-й станок: ПП не ставится, причина названа', pp.reason);
assert(!ok(M2, J(1, { baseId: 'b-pp', machineId: 'M2' })), 'ПП на 2-й не встаёт и вручную');
assert(ok(M2, J(1)) && ok(M1, J(1, { baseId: 'b-pp' })), 'бумага на 2-м и ПП на 1-м — допустимы');

// ── Туррель: серия, ролик, втулка ──
assert(P.turretFits(J(1), T4) && !P.turretFits(J(1, { footage: 39999 }), T4), 'одно задание: от 40 000 м — подходит, меньше — нет');
assert(P.turretFits(J(1, { footage: 15000 }), T4, 40000), 'серия суммарно 40 000 м — подходит');
assert(!P.turretFits(J(1, { rolls: 100 }), T4), 'ролик 400 м (> 350) — не подходит');
assert(P.turretFits(J(1, { footage: 70000, rolls: 200 }), T4), 'ролик ровно 350 м — подходит');
assert(P.turretFits(J(1, { sleeveWidth: 76 }), T4) && !P.turretFits(J(1, { sleeveWidth: 75 }), T4), 'втулка: ширина ≥ диаметра (76 мм)');
assert(!P.turretFits(J(1, { sleeve: '' }), T4), 'диаметр втулки не указан — туррели не подходит');
var rr = P.machineAllows(T4, J(1, { rolls: 100 }), S);
assert(!rr.ok && /туррель: намотка ролика 400 м больше 350/.test(rr.reason), 'причина отказа туррели — длина ролика', rr.reason);
assert(ok(T4, J(1, { footage: 3000, rolls: 1, sleeveWidth: 10, machineId: 'M4' })), 'записанное диспетчером на туррель — допустимо');
assert(ok(M1, J(1, { footage: 3000, rolls: 1, sleeveWidth: 10 })), 'обычный станок правилами туррели не ограничен');

// ── Серия по артикулу ──
var sf = P.seriesFootage([J(1, { article: 'A', footage: 25000 }), J(2, { article: 'A', footage: 15000 }), J(3, { article: 'B', footage: 9000 }), J(4, { footage: 7000 })]);
assert(sf['1'] === 40000 && sf['2'] === 40000 && sf['3'] === 9000 && sf['4'] === 7000, 'метраж серии — сумма по артикулу; без артикула — своё', JSON.stringify(sf));
var q = P.orderQueue({ jobs: [J(1, { article: 'A', footage: 25000 }), J(2, { article: 'A', footage: 15000 }), J(3, { article: 'B', footage: 25000 })],
    machines: [M1, T4], from: MON, settings: S });
assert(on(q, 'M4').sort().join() === '1,2' && on(q, 'M1').join() === '3', 'серия артикула A (40 000 м) — на туррель, B (25 000 м) — на обычный',
    JSON.stringify([on(q, 'M1'), on(q, 'M4')]));

// ── Чтение из базы ──
var recs = [{ id: '7', val: '2 высечка', reqs: { rMin: '96', rMax: '104', ref_rB: '501:501' } },
    { id: '9', val: '4 высечка', reqs: { rT: '1', rS: '40000', rR: '350', rV: '1' } }];
var ms = P.machinesFromRecords(recs, { machine: { reqs: {} } },
    { turretReq: 'rT', minCylinderReq: 'rMin', maxCylinderReq: 'rMax', stopBasesReq: 'rB', minSeriesReq: 'rS', maxRollReq: 'rR', sleeveReq: 'rV' });
assert(ms[0].minCylinder === 96 && ms[0].maxCylinder === 104 && ms[0].stopBases.join() === '501' && ms[0].turret === false && ms[0].minSeriesM === 0,
    '2-й станок: валы и стоп-лист основы читаются из записи', JSON.stringify(ms[0]));
assert(ms[1].turret && ms[1].minSeriesM === 40000 && ms[1].maxRollM === 350 && ms[1].sleeveNotNarrower === true && ms[1].stopBases.length === 0,
    'туррель: серия, ролик, втулка читаются из записи', JSON.stringify(ms[1]));
var bj = P.buildJobs([{ job_id: '1', article: ' 7701 ', material_base_id: '501', material_base: 'пп' }]);
assert(bj[0].article === '7701' && bj[0].baseId === '501' && bj[0].base === 'пп', 'задание: артикул и основа сырья из отчёта', JSON.stringify(bj[0]));

// ── «Ножи и валы» и пульт высечки: тот же диапазон ──
var D = require('../download/atex-p2/js/dies.js').core;
var cyl = D.cylinderRows([{ id: 'c88', val: '88', reqs: {} }, { id: 'c100', val: '100', reqs: {} }, { id: 'c116', val: '116', reqs: {} }],
    [{ id: 'm1', val: '1 высечка', reqs: {} }, { id: 'm2', val: '2 высечка', reqs: { r7: '104', r6: '96' } }], [], { machine: { reqs: {} }, cylinder: { reqs: {} } }, 'r7', 'r6');
assert(cyl.map(function(c) { return c.machines.join('|'); }).join(' / ') === '1 высечка / 1 высечка|2 высечка / 1 высечка',
    '«Ножи и валы»: на «2 высечку» встаёт только вал из 96–104', JSON.stringify(cyl.map(function(c) { return c.machines; })));
var DC = require('../download/atex-p2/js/die-cutter.js').core;
var cc = DC.compatibleCylinders({ cylinderId: 'c0' }, [{ id: 'c88', val: '88' }, { id: 'c100', val: '100' }, { id: 'c116', val: '116' }], { minCylinder: 96, maxCylinder: 104 });
assert(cc.map(function(c) { return c.id; }).join() === 'c100', 'пульт: смена вала — только валы из диапазона станка', JSON.stringify(cc));

console.log('\nИтого: ' + pass + ' из ' + total);
