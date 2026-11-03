// ideav/crm#5376 — заметки со встречи с заказчиком (docs/atex_phase2_labels_tz.md §5.4, §7):
//   1. смена вала: станок с туррелью — 90 мин (DIE_TURRET_CYLINDER_CHANGE_MN), обычный — 45
//      (DIE_CYLINDER_CHANGE_MN); смена втулки — 15 мин (DIE_SLEEVE_CHANGE_MN);
//   2. туррель простаивает: её очередь (подходящие туррели задания) пуста TURREL_IDLE_MN рабочих
//      минут (по умолчанию 455 — смена) — туррель берёт обычные задания как обычный станок;
//      появились задания туррели — при «Упорядочить» обычные с неё уходят на другие станки.
// Run with: node experiments/atex-p2-5376-turret-idle-norms.test.js
'use strict';

var total = 0, passed = 0;
function assert(cond, msg, extra) {
    total++;
    if (cond) { passed++; console.log('PASS — ' + msg); }
    else { console.log('FAIL — ' + msg + (extra !== undefined ? '  ' + extra : '')); process.exitCode = 1; }
}

var P = require('../download/atex-p2/js/die-planning-core.js').core;
var MON = Date.UTC(2026, 10, 2, 5, 0) / 1000;   // пн 02.11.2026 08:00 по Москве
var S = P.readSettings([], 'ateh1');
function J(id, o) {
    return Object.assign({ id: String(id), start: 0, status: 'Запланировано', pullsFact: 0, positionId: 'p' + id, machineId: '',
        dieId: 'k' + id, dieNo: 'N' + id, cylinderId: 'c' + id, cylinder: '96', materialId: 'm1', material: 'M', footage: 3000,
        duration: 0, setup: 0, due: 0, rolls: 1, sleeve: 'Втулка картонная (40мм/3мм/1000мм)', sleeveWidth: 100 }, o || {});
}
var T4 = { id: 'M4', name: '4 высечка', stopMaterials: [], turret: true };
var M1 = { id: 'M1', name: '1 высечка', stopMaterials: [] };
function items(p, mid) { return (p.machines[mid] || { items: [] }).items; }
function on(p, mid) { return items(p, mid).map(function(i) { return i.jobId; }); }

// ── 1. Нормы ──────────────────────────────────────────────────────────────
assert(S.cylinderChange === 45 && S.turretCylinderChange === 90 && S.sleeveChange === 15 && S.turretIdle === 455,
    'умолчания: вал 45 (обычный), 90 (туррель), втулка 15, простой туррели 455', JSON.stringify(S));
assert(P.readSettings([{ key: 'DIE_TURRET_CYLINDER_CHANGE_MN', type: '', value: '100' }, { key: 'TURREL_IDLE_MN', type: '', value: '0' }], 'ateh1').turretCylinderChange === 100 &&
    P.readSettings([{ key: 'TURREL_IDLE_MN', type: '', value: '0' }], 'ateh1').turretIdle === 0, 'нормы туррели читаются из «Настройки», простой 0 допустим');
var a = J(1), b = J(2);
assert(P.setupMinutes(a, b, S, T4) === 90 && P.setupMinutes(a, b, S, M1) === 45 && P.setupMinutes(null, a, S, T4) === 90,
    'смена вала: туррель 90, обычный станок 45');
assert(P.setupMinutes(a, J(1, { sleeve: '3" (76 мм)' }), S, T4) === 15 && P.setupMinutes(a, J(1, { sleeve: '3" (76 мм)' }), S, M1) === 15,
    'смена втулки — 15 на любом станке');
var q0 = P.orderQueue({ jobs: [J(1, { footage: 13000 })], machines: [T4], from: MON, settings: S });
assert(items(q0, 'M4')[0].setup === 90 && items(q0, 'M4')[0].setupKind === 'cylinder', 'очередь туррели: первая наладка — 90');
var rec = P.recordedPlan([{ id: '7', machineId: 'M4', start: MON, setup: 90, duration: 30, status: 'Запланировано' },
    { id: '8', machineId: 'M1', start: MON, setup: 45, duration: 30, status: 'Запланировано' }], [M1, T4], S, MON);
assert(items(rec, 'M4')[0].setupKind === 'cylinder' && items(rec, 'M1')[0].setupKind === 'cylinder', 'записанный план: 90 на туррели и 45 на обычном — смена вала');
// на ateh1 нож — 60 (дороже вала обычного станка): 60 мин читаются как смена ножа
var S60 = P.readSettings([{ key: 'DIE_KNIFE_CHANGE_MN', type: 'ATEH', value: '60' }], 'ateh1');
assert(P.kindOfSetup(60, S60, M1) === 'knife' && P.kindOfSetup(45, S60, M1) === 'cylinder' && P.kindOfSetup(15, S60, M1) === 'sleeve',
    'вид наладки по минутам — по норме, равной минутам', [P.kindOfSetup(60, S60, M1), P.kindOfSetup(45, S60, M1)].join());

// ── 2. Простой туррели ──────────────────────────────────────────────────────
// Очереди туррели нет и не было — туррель свободна, обычные задания делятся между станками.
var shorts = [J(1), J(2), J(3), J(4)];
var q1 = P.orderQueue({ jobs: shorts, machines: [M1, T4], from: MON, settings: S });
assert(on(q1, 'M4').length > 0 && on(q1, 'M1').length > 0 && !q1.unplaced.length,
    'туррель без своей очереди берёт обычные задания', JSON.stringify([on(q1, 'M1'), on(q1, 'M4')]));

// Есть длинное задание туррели: обычные встают на туррель не раньше конца очереди + 455 мин.
// Длинное: 90 наладка + ceil(13000/44)=296 — конец пн 14:26; +455 рабочих мин — вт 14:26.
var many = [J(100, { footage: 13000 })];
for (var i = 1; i <= 12; i++) many.push(J(i, { footage: 6000 }));
var q2 = P.orderQueue({ jobs: many, machines: [M1, T4], from: MON, settings: S });
var open = Date.UTC(2026, 10, 3, 11, 26) / 1000;   // вт 03.11 14:26 МСК
var t4 = items(q2, 'M4');
assert(t4[0].jobId === '100', 'длинное — первым на туррели', on(q2, 'M4').join());
var regular = t4.filter(function(it) { return it.jobId !== '100'; });
assert(regular.length > 0 && regular.every(function(it) { return it.start >= open; }),
    'обычные на туррели — только после простоя 455 мин за её очередью',
    JSON.stringify(regular.map(function(it) { return [it.jobId, new Date(it.start * 1000).toISOString()]; })));
var q2z = P.orderQueue({ jobs: many, machines: [M1, T4], from: MON, settings: Object.assign({}, S, { turretIdle: 0 }) });
var r0 = items(q2z, 'M4').filter(function(it) { return it.jobId !== '100'; });
assert(r0.length > regular.length && r0[0].start < open, 'простой 0 — обычные сразу за очередью туррели', r0.length + ' vs ' + regular.length);

// Обычное задание, записанное на туррель, пока она простаивала; появилось длинное — «раскидывать».
var q3 = P.orderQueue({ jobs: [J(1, { machineId: 'M4' }), J(100, { footage: 13000 })], machines: [M1, T4], from: MON, settings: S });
assert(on(q3, 'M4').join() === '100' && on(q3, 'M1').join() === '1', 'появилось задание туррели — обычное уходит с неё',
    JSON.stringify([on(q3, 'M1'), on(q3, 'M4')]));
// Очереди туррели нет — записанное на неё обычное там и остаётся.
var q4 = P.orderQueue({ jobs: [J(1, { machineId: 'M4' }), J(2)], machines: [M1, T4], from: MON, settings: S });
assert(on(q4, 'M4').indexOf('1') >= 0, 'очереди туррели нет — записанное на туррель обычное остаётся', JSON.stringify([on(q4, 'M1'), on(q4, 'M4')]));

// Простой отсчитывается и от выполненного задания туррели: вчерашнее длинное кончилось в пт 15:00,
// простой 455 мин истекает в пн 14:26 — дальше туррель берёт обычные задания.
var FRI = Date.UTC(2026, 9, 30, 5, 0) / 1000;
var done = J(50, { footage: 13000, machineId: 'M4', status: 'Выполнено', start: FRI, setup: 90, duration: 296 });
var q5 = P.orderQueue({ jobs: [done].concat(many.slice(1)), machines: [M1, T4], from: MON, settings: S });
var r5 = items(q5, 'M4').filter(function(it) { return it.jobId !== '50'; }), open5 = Date.UTC(2026, 10, 2, 11, 26) / 1000;
assert(r5.length > 0 && r5.every(function(it) { return it.start >= open5; }) && r5[0].start < open, 'туррель простаивает с пт 14:26 — обычные с пн 14:26',
    JSON.stringify(r5.map(function(it) { return [it.jobId, new Date(it.start * 1000).toISOString()]; })));

console.log('\nИтого: ' + passed + ' из ' + total);
