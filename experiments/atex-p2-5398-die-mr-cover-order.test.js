// ideav/crm#5398 — «Планирование высечки»: покрытие МР считается в том порядке, в каком строится план.
//
//   R1. Склад МР делится между заданиями в порядке плана (срок, затем номер задания), а не по записанному
//       план-старту: задание с более ранним сроком получает рулон, даже если его записанный старт позже.
//   R2. Начатые задания («В работе») уже стоят на станке — склад сначала покрывает их.
//   R3. «Упорядочить» → «Применить» (план-старты записаны) → «Упорядочить» даёт те же блокировки
//       «нет МР» и тот же план: записанный план воспроизводится.
//
// Run with: node experiments/atex-p2-5398-die-mr-cover-order.test.js

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
var NOW = ts(2026, 11, 4, 15, 0);
function J(id, o) {
    return Object.assign({ id: String(id), start: 0, status: 'Запланировано', pullsFact: 0, positionId: 'p' + id, machineId: '',
        dieId: 'k' + id, dieNo: 'N' + id, cylinderId: 'c1', cylinder: '96', materialId: 'm1', material: 'M', footage: 1500,
        minFormat: 300, optFormat: 305, duration: 0, setup: 0, due: 0, rolls: 1, masterRollId: '' }, o || {});
}
function roll(id, o) { return Object.assign({ id: id, no: 'МР-' + id, format: 305, length: 2000, rest: 2000, status: 'на складе', materialId: 'm1', reserveTaskId: '' }, o || {}); }
function deficitIds(cov) { return Object.keys(cov).filter(function(id) { return cov[id].deficit > 0; }).sort(); }

// R1: рулон один; у задания 2 срок раньше, но записанный старт позже (его план уже записан)
var r1 = C.coverJobs([
    J(1, { start: NOW + 1, due: ts(2026, 11, 20) }),
    J(2, { start: ts(2026, 11, 5, 8, 0), due: ts(2026, 11, 10) })
], [roll('r1')], [], 15);
assert(r1['2'] && r1['2'].deficit === 0, 'R1: задание с ранним сроком покрыто, хотя его записанный старт позже', JSON.stringify(r1['2']));
assert(r1['1'] && r1['1'].deficit > 0, 'R1: задание с поздним сроком — дефицит', JSON.stringify(r1['1']));

// R2: начатое задание с поздним сроком покрывается раньше свободного с ранним сроком
var r2 = C.coverJobs([
    J(1, { start: NOW - 3600, due: ts(2026, 11, 20), status: 'В работе', machineId: 'M1' }),
    J(2, { start: NOW + 5, due: ts(2026, 11, 10) })
], [roll('r1')], [], 15);
assert(r2['1'] && r2['1'].deficit === 0, 'R2: начатое задание покрыто первым', JSON.stringify(r2['1']));
assert(r2['2'] && r2['2'].deficit > 0, 'R2: свободное задание — дефицит', JSON.stringify(r2['2']));

// R3: цикл «Упорядочить → Применить → Упорядочить» на очереди, где МР хватает не всем.
// Записанные старты — как после «Сформировать» (now + i), сроки — вразнобой с номерами.
var M1 = { id: 'M1', name: '1 высечка', cylinders: [], stopMaterials: [] };
var dues = [18, 9, 25, 7, 12, 30, 11, 21, 8, 15, 27, 10];
var jobs = dues.map(function(d, i) { return J(101 + i, { start: NOW + i, due: ts(2026, 11, d) }); });
var rolls = ['a', 'b', 'c', 'd', 'e'].map(function(x) { return roll(x); });
function order(js) {
    var cov = C.coverJobs(js.filter(C.isMovable), rolls, [], 15);
    var blocked = {};
    js.forEach(function(j) { var f = C.jobFlags(j, { dies: {}, openRevs: {}, cover: cov }); if (f.blocks.length) blocked[j.id] = f.blocks; });
    var plan = C.orderQueue({ jobs: js, machines: [M1], from: NOW, settings: S, blocked: blocked });
    return { blocked: Object.keys(blocked).sort(), plan: plan };
}
function placed(plan) {
    var out = {};
    Object.keys(plan.machines).forEach(function(m) { plan.machines[m].items.forEach(function(i) { if (!i.fixed && !i.done) out[i.jobId] = m + '@' + i.start; }); });
    return out;
}
var p1 = order(jobs);
// «Применить» (вся очередь): размещённые получают станок и план-старт, неразмещённые остаются как были
var pl1 = placed(p1.plan);
var applied = jobs.map(function(j) {
    var it = null;
    p1.plan.machines.M1.items.forEach(function(i) { if (i.jobId === j.id && !i.fixed) it = i; });
    return it ? Object.assign({}, j, { machineId: 'M1', start: it.start, setup: it.setup, duration: it.run }) : j;
});
var p2 = order(applied);
var pl2 = placed(p2.plan);
assert(Object.keys(pl1).length === 6 && p1.blocked.length === 6, 'R3: первое «Упорядочить» — 6 размещено (склад в метрах), 6 без МР', 'размещено ' + Object.keys(pl1).length + ', блок ' + p1.blocked.length);
assert(JSON.stringify(p1.blocked) === JSON.stringify(p2.blocked), 'R3: после «Применить» те же блокировки «нет МР»', p1.blocked.join(',') + ' → ' + p2.blocked.join(','));
assert(JSON.stringify(pl1) === JSON.stringify(pl2), 'R3: после «Применить» тот же план', JSON.stringify(pl1) + ' → ' + JSON.stringify(pl2));

// R4: «Зарезервировать МР» отдаёт рулон тому же заданию, что и покрытие (порядок плана, а не старт)
function task(id, o) { return Object.assign({ id: id, start: 0, open: true, status: 'Запланировано', footage: 1500, minFormat: 300, maxFormat: 315, materialId: 'm1', material: 'M', dieNo: 'N', machine: '', currentRollId: '' }, o || {}); }
var j4 = [J(1, { start: NOW + 1, due: ts(2026, 11, 20) }), J(2, { start: ts(2026, 11, 5, 8, 0), due: ts(2026, 11, 10) })];
var t4 = [task('1', { start: NOW + 1 }), task('2', { start: ts(2026, 11, 5, 8, 0) })];
var res4 = C.planReservations(t4, [roll('r1')], [], 15, j4);
var got4 = res4.filter(function(p) { return p.rollIds.indexOf('r1') >= 0; }).map(function(p) { return p.taskId; });
assert(got4.length === 1 && got4[0] === '2', 'R4: резерв рулона — заданию с ранним сроком, как в покрытии', JSON.stringify(res4));

console.log('\n' + passed + '/' + total + ' passed');
