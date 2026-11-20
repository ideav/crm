// ideav/crm#5553 — задания высечки не назначались на станки: все 310 из 316 были заблокированы
// «нет МР нужного формата» (склад МР пуст, резка не запланирована). Нехватка МР — предупреждение:
// станок и день назначаются, нехватка видна во вкладке «Дефицит форматов».
//
// Run with: node experiments/atex-p2-5553-mr-deficit-assigns.test.js

process.env.TZ = 'UTC';
var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}
var C = require('../download/atex-p2/js/die-planning-core.js').core;
var S = C.readSettings([], 'ateh1');
var MON = Date.UTC(2026, 10, 2, 8, 0) / 1000 - 180 * 60;
function J(id, o) {
    return Object.assign({ id: String(id), start: 0, status: 'Запланировано', pullsFact: 0, positionId: 'p' + id, machineId: '',
        dieId: 'k' + id, dieNo: 'N' + id, cylinderId: 'c96', cylinder: '96', materialId: 'm1', material: 'M', footage: 44 * 60,
        duration: 0, setup: 0, due: 0, rolls: 1 }, o || {});
}
var jobs = [J(1), J(2), J(3), J(4)];
var cover = {}; jobs.forEach(function(j) { cover[j.id] = { deficit: 1000 }; });
var blocked = {}, warned = 0;
jobs.forEach(function(j) {
    var f = C.jobFlags(j, { dies: {}, openRevs: {}, cover: cover });
    if (f.blocks.length) blocked[j.id] = f.blocks;
    if (f.warnings.indexOf('нет МР нужного формата') >= 0) warned++;
});
assert(Object.keys(blocked).length === 0 && warned === 4, 'дефицит МР — предупреждение у каждого задания, блокировок нет');
var M = [{ id: 'M1', name: '1 высечка', cylinders: [], stopMaterials: [] }, { id: 'M2', name: '3 высечка', cylinders: [], stopMaterials: [] }];
var plan = C.orderQueue({ jobs: jobs, machines: M, from: MON, settings: S, blocked: blocked });
var n = Object.keys(plan.machines).reduce(function(a, m) { return a + plan.machines[m].items.length; }, 0);
assert(n === 4 && plan.unplaced.length === 0, 'все задания без МР получили станок', 'размещено ' + n + ', не размещено ' + plan.unplaced.length);
assert(C.jobFlags(J(5, { dieId: '' }), { cover: cover }).blocks[0] === 'нет ножа', 'нет ножа по-прежнему блокирует');
console.log(passed + '/' + total);
