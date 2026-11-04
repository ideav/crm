// ideav/crm#5376 — зафиксированные задания высечки (реквизит «Зафиксировано», docs/atex_phase2_labels_tz.md §5.4):
// «Упорядочить» не снимает зафиксированное задание со станка (в том числе с туррели) и не меняет
// последовательность зафиксированных заданий станка.
// Run with: node experiments/atex-p2-5376-fixed-jobs.test.js
'use strict';

var total = 0, passed = 0;
function assert(cond, msg, extra) {
    total++;
    if (cond) { passed++; console.log('PASS — ' + msg); }
    else { console.log('FAIL — ' + msg + (extra !== undefined ? '  ' + extra : '')); process.exitCode = 1; }
}

var P = require('../download/atex-p2/js/die-planning-core.js').core;
var MON = Date.UTC(2026, 10, 2, 5, 0) / 1000;   // пн 02.11.2026 08:00 по Москве
var DAY = 86400;
var S = P.readSettings([], 'ateh1');
function J(id, o) {
    return Object.assign({ id: String(id), start: 0, status: 'Запланировано', pullsFact: 0, positionId: 'p' + id, machineId: '',
        dieId: 'k' + id, dieNo: 'N' + id, cylinderId: 'c' + id, cylinder: '96', materialId: 'm1', material: 'M', footage: 3000,
        duration: 0, setup: 0, due: 0, rolls: 1, sleeve: 'Втулка картонная (40мм/3мм/1000мм)', sleeveWidth: 100, fixed: false }, o || {});
}
var T4 = { id: 'M4', name: '4 высечка', stopMaterials: [], turret: true };
var M1 = { id: 'M1', name: '1 высечка', stopMaterials: [] };
var M2 = { id: 'M2', name: '2 высечка', stopMaterials: [], maxCylinder: 104 };
function on(p, mid) { return ((p.machines[mid] || { items: [] }).items).map(function(i) { return i.jobId; }); }
function where(p) { return JSON.stringify(Object.keys(p.machines).map(function(m) { return m + ':' + on(p, m).join(','); })); }

// ── Чтение и запись признака ────────────────────────────────────────────────
var rows = [{ job_id: 1, fixed: '1' }, { job_id: 2, fixed: '' }, { job_id: 3, fixed: '0' }, { job_id: 4, fixed: 'X' }, { job_id: 5 }];
var jobs = P.buildJobs(rows);
assert(jobs.map(function(j) { return j.fixed; }).join() === 'true,false,false,true,false', 'колонка fixed отчёта die_planning → job.fixed',
    jobs.map(function(j) { return j.fixed; }).join());
assert(JSON.stringify(P.jobFixedFields('901', true)) === '{"t901":"1"}' && JSON.stringify(P.jobFixedFields('901', false)) === '{"t901":""}' &&
    JSON.stringify(P.jobFixedFields('', true)) === '{}', 'запись «Зафиксировано»: 1 / пусто; реквизита нет — ничего');

// ── С туррели не раскидывать ────────────────────────────────────────────────
// Обычное (короткое) задание на туррели, появилось длинное: незафиксированное уходит, зафиксированное — нет.
var free = P.orderQueue({ jobs: [J(1, { machineId: 'M4' }), J(100, { footage: 13000 })], machines: [M1, T4], from: MON, settings: S });
assert(on(free, 'M1').join() === '1', 'без фиксации обычное уходит с туррели', where(free));
var fx = P.orderQueue({ jobs: [J(1, { machineId: 'M4', fixed: true }), J(100, { footage: 13000 })], machines: [M1, T4], from: MON, settings: S });
assert(on(fx, 'M4').indexOf('1') >= 0 && on(fx, 'M1').indexOf('1') < 0, 'зафиксированное на туррели остаётся на ней', where(fx));
assert(on(fx, 'M4').indexOf('100') >= 0, 'длинное тоже на туррели — за зафиксированным', where(fx));

// ── Последовательность не менять ───────────────────────────────────────────
// Три зафиксированных на M1 в записанном порядке 3 → 1 → 2 (сроки и группировка подсказали бы другой).
var a = J(1, { machineId: 'M1', fixed: true, start: MON + 2 * 3600, due: MON + DAY, cylinderId: 'cA' });
var b = J(2, { machineId: 'M1', fixed: true, start: MON + 4 * 3600, due: MON + DAY, cylinderId: 'cB' });
var c = J(3, { machineId: 'M1', fixed: true, start: MON, due: MON + 9 * DAY, cylinderId: 'cB' });
var d = J(4, { due: MON + DAY, cylinderId: 'cA' });   // незафиксированное, срок раньше
var seq = P.orderQueue({ jobs: [a, b, c, d], machines: [M1], from: MON, settings: S });
var m1 = on(seq, 'M1');
assert(m1.slice(0, 3).join() === '3,1,2', 'зафиксированные — первыми и в записанном порядке', m1.join());
assert(m1[3] === '4', 'незафиксированное — за ними', m1.join());
// На двух станках: зафиксированное на M2 остаётся на M2, хотя на M1 закончилось бы раньше.
var two = P.orderQueue({ jobs: [J(1, { machineId: 'M1' }), J(2, { machineId: 'M2', fixed: true }), J(3, { machineId: 'M1' })],
    machines: [M1, M2], from: MON, settings: S });
assert(on(two, 'M2').join() === '2', 'зафиксированное не переносится на другой станок', where(two));
// Повторное «Упорядочить» по записанному плану порядок зафиксированных не меняет.
var it = (seq.machines.M1.items);
var again = P.orderQueue({ jobs: [a, b, c, d].map(function(j) {
    var x = it.filter(function(i) { return i.jobId === j.id; })[0];
    return Object.assign({}, j, { start: x.start, machineId: 'M1' });
}), machines: [M1], from: MON, settings: S });
assert(on(again, 'M1').slice(0, 3).join() === '3,1,2', 'повторное «Упорядочить» — тот же порядок', on(again, 'M1').join());

// ── Границы ────────────────────────────────────────────────────────────────
var nomach = P.orderQueue({ jobs: [J(1, { fixed: true }), J(2)], machines: [M1, M2], from: MON, settings: S });
assert(on(nomach, 'M1').concat(on(nomach, 'M2')).sort().join() === '1,2' && !nomach.unplaced.length, 'без станка признак не держит — задание планируется', where(nomach));
var big = P.orderQueue({ jobs: [J(1, { machineId: 'M2', fixed: true, cylinder: '120' })], machines: [M1, M2], from: MON, settings: S });
assert(big.unplaced.length === 1 && /зафиксировано на «2 высечка»/.test(big.unplaced[0].reasons[0]), 'станок не принимает зафиксированное — не размещается, причина названа',
    JSON.stringify(big.unplaced));
var started = P.orderQueue({ jobs: [J(1, { machineId: 'M1', status: 'В работе', start: MON, duration: 60 }), J(2, { machineId: 'M1', fixed: true })],
    machines: [M1], from: MON, settings: S });
var si = started.machines.M1.items;
assert(si[0].jobId === '1' && si[1].jobId === '2' && si[1].start >= si[0].end, 'зафиксированное — за начатым', JSON.stringify(si.map(function(i) { return [i.jobId, i.start]; })));

console.log('\nИтого: ' + passed + ' из ' + total);
