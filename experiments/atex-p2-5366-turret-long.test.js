// #5366: туррель — для ДЛИННЫХ заданий на широкой втулке. Порог — настройка DIE_TURRET_LONG_M
// (по умолчанию 12 600 м, по плану заказчика); 0 — без порога. Задание, записанное на туррель
// диспетчером вручную, допустимо там всегда (туррель отцепляют).
'use strict';

var P = require('../download/atex-p2/js/die-planning-core.js').core;

var pass = 0, total = 0;
function assert(cond, msg, extra) {
    total++;
    if (cond) { pass++; console.log('PASS — ' + msg); }
    else { console.log('FAIL — ' + msg + (extra !== undefined ? '  ' + extra : '')); process.exitCode = 1; }
}

var MON = Date.UTC(2026, 10, 2, 5, 0) / 1000;   // 08:00 по Москве
var S = P.readSettings([], 'ateh1');
function J(id, o) {
    return Object.assign({ id: String(id), start: 0, status: 'Запланировано', pullsFact: 0, positionId: 'p' + id, machineId: '',
        dieId: 'k' + id, dieNo: 'N' + id, cylinderId: 'c1', cylinder: '96', materialId: 'm1', material: 'M', footage: 13000,
        duration: 0, setup: 0, due: 0, rolls: 1, sleeve: 'Втулка картонная (40мм/3мм/1000мм)', sleeveWidth: 100 }, o || {});
}
var T4 = { id: 'M4', name: '4 высечка', stopMaterials: [], turret: true };
var M1 = { id: 'M1', name: '1 высечка', stopMaterials: [] };
function on(p, mid) { return ((p.machines[mid] || { items: [] }).items).map(function(i) { return i.jobId; }); }

assert(S.turretLongM === 12600, 'порог длинного задания по умолчанию — 12 600 м', S.turretLongM);
assert(P.readSettings([{ key: 'DIE_TURRET_LONG_M', type: '', value: '0' }], 'ateh1').turretLongM === 0, 'DIE_TURRET_LONG_M = 0 — без порога');
assert(P.turretFits(J(1), S) && P.turretFits(J(1, { footage: 12600 }), S), 'длинное (не короче порога) на широкой втулке — туррели подходит');
assert(!P.turretFits(J(1, { footage: 12599 }), S), 'короче порога — туррели не подходит');
assert(P.turretFits(J(1, { footage: 500 }), Object.assign({}, S, { turretLongM: 0 })), 'порог 0 — длина не важна');
assert(!P.turretFits(J(1, { sleeve: 'Втулка картонная (76мм/5мм/1000мм)' }), S), 'длинное на узкой втулке — не подходит');

var sh = P.machineAllows(T4, J(1, { footage: 3000 }), S);
assert(!sh.ok && sh.reason.indexOf('12600') >= 0, 'короткое задание на туррель при планировании не ставится, в причине — порог', sh.reason);
assert(P.machineAllows(T4, J(1, { footage: 3000, machineId: 'M4' }), S).ok, 'короткое, записанное диспетчером на туррель, туда допустимо');
assert(P.machineAllows(M1, J(1, { footage: 3000 }), S).ok, 'обычный станок порогом туррели не ограничен');

var q = P.orderQueue({ jobs: [J(1), J(2, { footage: 3000 })], machines: [M1, T4], from: MON, settings: S });
assert(on(q, 'M4').join() === '1' && on(q, 'M1').join() === '2', 'длинное — на туррель, короткое — на обычный станок', JSON.stringify([on(q, 'M1'), on(q, 'M4')]));
var pin = P.orderQueue({ jobs: [J(1, { footage: 3000, machineId: 'M4' })], machines: [M1, T4], from: MON, settings: S });
assert(on(pin, 'M4').join() === '1', 'короткое, записанное на туррель вручную, после «Упорядочить» остаётся там', JSON.stringify([on(pin, 'M1'), on(pin, 'M4')]));

console.log('\nИтого: ' + pass + ' из ' + total);
