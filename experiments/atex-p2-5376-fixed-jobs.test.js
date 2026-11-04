// ideav/crm#5376 — зафиксированные задания высечки (реквизит «Зафиксировано», docs/atex_phase2_labels_tz.md §5.4):
// как 🔒 Фазы 1 — где зафиксировали, там и стоит: «Упорядочить» не снимает задание со станка (в том числе
// с туррели), не переносит на другой день и не меняет место в дне: свободные задания в его день перед ним
// не встают, кроме стоявших перед ним в записанном плане; порядок 🔒 не меняется.
// Перенос (окно 🗓): положение в дне — по весу (по умолчанию), в начало, в конец (movePlacement).
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

// ── День и место в дне ─────────────────────────────────────────────────────
var WED = MON + 2 * DAY, SAT = MON + 5 * DAY;
function items(p, mid) { return (p.machines[mid] || { items: [] }).items; }
function itemOf(p, id) { var r = null; Object.keys(p.machines).forEach(function(m) { items(p, m).forEach(function(i) { if (i.jobId === id) r = i; }); }); return r; }
var dayOf = P.createCalendar(S).dayOf;
// 🔒 на среду; свободные (по 3000 м — 45+69 мин) заполняют пн-вт, в среду перед 🔒 не встают.
var free = [];
for (var k = 1; k <= 10; k++) free.push(J(k, { cylinderId: 'c1' }));
var wed = P.orderQueue({ jobs: free.concat([J(50, { machineId: 'M1', fixed: true, start: WED + 3 * 3600 })]), machines: [M1], from: MON, settings: S });
var f50 = itemOf(wed, '50');
assert(f50 && dayOf(f50.start) === dayOf(WED), '🔒 остаётся в своём дне (среда)', f50 && new Date(f50.start * 1000).toISOString());
var beforeWed = items(wed, 'M1').filter(function(i) { return i.jobId !== '50' && dayOf(i.start) === dayOf(WED) && i.start < f50.start; });
assert(!beforeWed.length, 'в день 🔒 перед ним свободные не встают', JSON.stringify(beforeWed.map(function(i) { return i.jobId; })));
assert(items(wed, 'M1').filter(function(i) { return dayOf(i.start) === dayOf(MON); }).length > 0, 'дни до 🔒 заполняются свободными');
// Стоявшее перед 🔒 в записанном плане того же дня — остаётся перед ним.
var lead = P.orderQueue({ jobs: [J(1, { machineId: 'M1', start: WED + 3600 }), J(2, { machineId: 'M1', start: WED + 9 * 3600 }),
    J(50, { machineId: 'M1', fixed: true, start: WED + 2 * 3600 })], machines: [M1], from: MON, settings: S });
var lo = on(lead, 'M1');
assert(lo.indexOf('1') < lo.indexOf('50') && dayOf(itemOf(lead, '1').start) === dayOf(WED), 'стоявшее перед 🔒 — перед ним в его дне', lo.join());
assert(lo.indexOf('2') !== 1 || lo.indexOf('2') > lo.indexOf('50'), 'стоявшее после 🔒 перед ним не встаёт', lo.join());
// Длинное свободное, которое залезло бы в день 🔒, встаёт после него.
var spill = P.orderQueue({ jobs: [J(1, { footage: 30000 }), J(50, { machineId: 'M1', fixed: true, start: MON + DAY + 3600 })], machines: [M1], from: MON, settings: S });
assert(on(spill, 'M1').join() === '50,1' && dayOf(itemOf(spill, '50').start) === dayOf(MON + DAY), 'свободное не залезает в день 🔒 — встаёт после', on(spill, 'M1').join());
// 🔒 на субботу — день без смены: уходит на ближайший рабочий (пн).
var sat = P.orderQueue({ jobs: [J(50, { machineId: 'M1', fixed: true, start: SAT + 3600 })], machines: [M1], from: MON, settings: S });
assert(dayOf(itemOf(sat, '50').start) === dayOf(MON + 7 * DAY), '🔒 на выходной — на ближайший рабочий день', new Date(itemOf(sat, '50').start * 1000).toISOString());
// Группировка не уводит 🔒 в другой день и не ставит свободное между двумя 🔒.
var grp = P.orderQueue({ jobs: [J(1, { cylinderId: 'cA' }), J(2, { cylinderId: 'cB' }), J(3, { cylinderId: 'cA' }),
    J(50, { machineId: 'M1', fixed: true, start: MON + DAY + 3600, cylinderId: 'cB' }), J(51, { machineId: 'M1', fixed: true, start: MON + DAY + 7200, cylinderId: 'cA' })],
    machines: [M1], from: MON, settings: S });
var go = on(grp, 'M1');
assert(go.indexOf('51') === go.indexOf('50') + 1 && dayOf(itemOf(grp, '50').start) === dayOf(MON + DAY), 'два 🔒 подряд, свободное между ними не встаёт', go.join());

// ── Перенос: по весу / в начало / в конец ──────────────────────────────────
var dayJobs = [J(10, { machineId: 'M1', start: WED + 3600, cylinderId: 'cA' }), J(11, { machineId: 'M1', start: WED + 3 * 3600, cylinderId: 'cB' }),
    J(12, { machineId: 'M1', start: WED + 5 * 3600, cylinderId: 'cC' })];
var mj = J(20, { cylinderId: 'cB', machineId: 'M2' });
var wedDay = dayOf(WED);
var mS = P.movePlacement({ job: mj, jobs: dayJobs, machine: M1, day: wedDay, position: 'start', settings: S });
var mE = P.movePlacement({ job: mj, jobs: dayJobs, machine: M1, day: wedDay, position: 'end', settings: S });
var mW = P.movePlacement({ job: mj, jobs: dayJobs, machine: M1, day: wedDay, position: 'weight', settings: S });
assert(mS.index === 0 && mS.start < dayJobs[0].start && dayOf(mS.start) === wedDay, 'в начало дня — раньше первого задания дня, тот же день');
assert(mE.index === 3 && mE.start > dayJobs[2].start && dayOf(mE.start) === wedDay, 'в конец дня — после последнего');
assert(mW.index === 2 && mW.start > dayJobs[1].start && mW.start < dayJobs[2].start, 'по весу — к заданию того же вала (без смены вала)', JSON.stringify(mW));
var empty = P.movePlacement({ job: mj, jobs: [], machine: M1, day: wedDay, position: 'weight', settings: S });
assert(empty.start === P.createCalendar(S).dayTs(wedDay, S.dayStartMin), 'пустой день — начало смены');
// Перенесённое и зафиксированное «в начало» встаёт первым в своём дне; «в конец» — за стоявшими.
var after = function(st0) { return P.orderQueue({ jobs: dayJobs.concat([Object.assign({}, mj, { machineId: 'M1', start: st0, fixed: true })]), machines: [M1], from: MON, settings: S }); };
var aS = on(after(mS.start), 'M1'), aE = on(after(mE.start), 'M1');
assert(itemOf(after(mS.start), '20') && dayOf(itemOf(after(mS.start), '20').start) === wedDay, 'перенесённое 🔒 — в выбранном дне', aS.join());
assert(aE.indexOf('20') > aE.indexOf('12') && aE.indexOf('20') > aE.indexOf('10'), '«в конец» + 🔒 — за стоявшими в дне', aE.join());

console.log('\nИтого: ' + passed + ' из ' + total);
