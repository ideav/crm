// ideav/crm#5720 — «Планирование высечки» и вход на рабочее место по итогам встречи 25.11:
//
//   1. физический вал («Серийный номер вала» → «Вал») не стоит на двух станках одновременно:
//      планировщик сам берёт свободный в это время вал типоразмера и пишет его в задание;
//      все валы типоразмера заняты — задание ждёт; серийных нет — один вал на типоразмер;
//   2. журнал «Упорядочить» (inp.trace) объясняет выбор станка и отказ группировки — так видно,
//      почему между заданиями вала 96 встаёт задание вала 98;
//   3. почему задание не на туррели — причина правил туррели (turretVerdicts);
//   4. карточка задания: размер ножа и этикетки, сырьё, втулка, намотка внутрь (jobFacts);
//   5. экран отказа планшета говорит, куда копировать код (padCodeHint).
//
// Run with: node experiments/atex-p2-5720-die-planning.test.js

process.env.TZ = 'UTC';

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

var C = require('../download/atex-p2/js/die-planning-core.js').core;
var G = require('../download/atex/js/pad-guard.js');
var S = C.readSettings([{ key: 'DIE_CYLINDER_CHANGE_MN', type: 'ATEH', value: '45' }, { key: 'DIE_TURRET_CYLINDER_CHANGE_MN', type: 'ATEH', value: '90' },
    { key: 'DIE_KNIFE_CHANGE_MN', type: 'ATEH', value: '20' }, { key: 'DIE_SLEEVE_CHANGE_MN', type: 'ATEH', value: '15' }], 'ateh1');
function ts(y, mo, d, h, mi) { return Date.UTC(y, mo - 1, d, h || 0, mi || 0) / 1000 - 180 * 60; }   // Москва
var MON = ts(2026, 11, 2, 8, 0);
function J(id, o) {
    return Object.assign({ id: String(id), start: 0, status: 'Запланировано', pullsFact: 0, positionId: 'p' + id, machineId: '',
        dieId: 'k' + id, dieNo: 'N' + id, cylinderId: 'c1', cylinder: '96', materialId: 'm1', material: 'M', footage: 44 * 60,
        duration: 0, setup: 0, due: 0, rolls: 1 }, o || {});
}
var M1 = { id: 'M1', name: '1 высечка', stopMaterials: [] };
var M2 = { id: 'M2', name: '2 высечка', stopMaterials: [] };
function itemsOf(plan) {
    var out = [];
    Object.keys(plan.machines).forEach(function(mid) { plan.machines[mid].items.forEach(function(i) { out.push(Object.assign({ mid: mid }, i)); }); });
    return out;
}
function shaftOverlaps(plan, jobs) {
    var by = {}, n = 0;
    jobs.forEach(function(j) { by[j.id] = j; });
    var its = itemsOf(plan);
    its.forEach(function(a) {
        its.forEach(function(b) {
            if (a.jobId >= b.jobId || a.mid === b.mid) return;
            if (by[a.jobId].cylinderId === by[b.jobId].cylinderId && a.start < b.end && b.start < a.end) n++;
        });
    });
    return n;
}

// 1. Вал по номеру
var full = [J(1, { footage: 44 * 455 }), J(2, { footage: 44 * 455, dieId: 'k2' })];
var one = C.orderQueue({ jobs: full, machines: [M1, M2], from: MON, settings: S });
assert(shaftOverlaps(one, full) === 0, 'один вал 96 — задания этого вала на разных станках не пересекаются по времени',
    JSON.stringify(itemsOf(one).map(function(i) { return [i.mid, i.jobId, i.start, i.end]; })));
var SH = [{ id: 's7', no: '7', cylinderId: 'c1' }, { id: 's8', no: '8', cylinderId: 'c1' }, { id: 's9', no: '9', cylinderId: 'c2' }];
var two = C.orderQueue({ jobs: full, machines: [M1, M2], from: MON, settings: S, shafts: SH });
var twoIt = itemsOf(two);
assert(twoIt.every(function(i) { return i.start === MON; }) && twoIt.length === 2, 'два вала 96 (серийные 7 и 8) — оба задания стартуют сразу на двух станках',
    JSON.stringify(twoIt.map(function(i) { return [i.mid, i.jobId, i.start]; })));
assert(twoIt.map(function(i) { return i.shaftId; }).sort().join() === 's7,s8' && twoIt.every(function(i) { return i.shaftNo === (i.shaftId === 's7' ? '7' : '8'); }),
    'каждому заданию — свой физический вал с серийным номером', JSON.stringify(twoIt.map(function(i) { return [i.jobId, i.shaftId, i.shaftNo]; })));
var oneSh = itemsOf(C.orderQueue({ jobs: full, machines: [M1, M2], from: MON, settings: S, shafts: [SH[0]] }));
assert(oneSh.every(function(i) { return i.shaftId === 's7'; }) && shaftOverlaps({ machines: { a: { items: oneSh.filter(function(i) { return i.mid === 'M1'; }) }, b: { items: oneSh.filter(function(i) { return i.mid === 'M2'; }) } } }, full) === 0,
    'один серийный вал 96 — оба задания на нём, по времени не пересекаются', JSON.stringify(oneSh.map(function(i) { return [i.mid, i.jobId, i.shaftId, i.start]; })));
assert(itemsOf(one).every(function(i) { return i.shaftId === ''; }), 'серийных нет — вал не записывается (типоразмер считается одним валом)');
// подряд на станке — тот же физический вал без новой смены вала
var row = C.orderQueue({ jobs: [J(1), J(2, { dieId: 'k1' })], machines: [M1], from: MON, settings: S, shafts: SH });
assert(row.machines.M1.items.map(function(i) { return i.shaftId; }).join() === 's7,s7' && row.machines.M1.items[1].setupKind === 'none',
    'два задания одного ножа подряд — на одном физическом валу, без смены вала', JSON.stringify(row.machines.M1.items.map(function(i) { return [i.jobId, i.shaftId, i.setupKind]; })));
// записанный в задании вал у начатого держится
var rec = C.orderQueue({ jobs: [J(1, { status: 'В работе', machineId: 'M1', start: MON, duration: 120, shaftId: 's8' }), J(2, { dieId: 'k2', footage: 44 * 60 })], machines: [M1, M2], from: MON, settings: S, shafts: SH });
var r2 = itemsOf(rec).filter(function(i) { return i.jobId === '2'; })[0];
assert(r2 && r2.shaftId === 's7' && r2.start === MON, 'начатое задание держит записанный вал 8 — другому заданию тут же достаётся свободный вал 7', JSON.stringify(r2));
var fields = C.jobPlanFields({ dieJob: { id: 'J', reqs: { machine: 'rm', cylinder: 'rc', shaft: 'rs' } } }, { start: 1, machineId: 'M1', cylinderId: 'c1', shaftId: 's7' });
assert(fields.trs === 's7' && fields.trc === 'c1', '«Применить» пишет физический вал в «Серийный номер вала» задания', JSON.stringify(fields));
var other = [J(1, { footage: 44 * 455 }), J(2, { footage: 44 * 455, cylinderId: 'c2', cylinder: '98' })];
assert(itemsOf(C.orderQueue({ jobs: other, machines: [M1, M2], from: MON, settings: S })).every(function(i) { return i.start === MON; }),
    'разные валы — станки работают одновременно');
// вал занят начатым заданием на M1, задание 2 зафиксировано на M2 тем же днём — ждёт вал
var busyJobs = [J(1, { footage: 44 * 300, status: 'В работе', machineId: 'M1', start: MON, duration: 300 }), J(2, { fixed: true, machineId: 'M2', start: MON })];
var busy = C.orderQueue({ jobs: busyJobs, machines: [M1, M2], from: MON, settings: S });
var w = itemsOf(busy).filter(function(i) { return i.jobId === '2'; })[0], j1 = itemsOf(busy).filter(function(i) { return i.jobId === '1'; })[0];
assert(w && j1 && w.start >= j1.end && w.shaftWait && w.shaftWait.machineId === 'M1' && w.shaftWait.cylinder === '96',
    'вал на другом станке — задание ждёт его конца, у задания — отметка «ждёт вал» с номером и станком', JSON.stringify(w));

// 2. Группировка задерживает просроченное, если суммарная просрочка не растёт (решение владельца в #5720):
//    96 → 98 → 96 (все просрочены) становится 96 → 96 → 98; журнал объясняет каждое решение.
var late = MON - 30 * 86400;
var seqJobs = [J(1, { due: late }), J(2, { due: late, cylinderId: 'c2', cylinder: '98' }), J(3, { due: late, dieId: 'k1' })];
var log = [];
var sq = C.orderQueue({ jobs: seqJobs, machines: [M1], from: MON, settings: S, trace: function(r) { log.push(r); } });
var order = sq.machines.M1.items.map(function(i) { return i.jobId; }).join();
assert(order === '1,3,2', 'все просрочены — задания вала 96 подряд, вал 98 после них: 96 → 96 → 98', order);
var taken = log.filter(function(r) { return /группировка/.test(r.text) && / — да:/.test(r.text); });
assert(taken.length === 1 && /просроченные позже: задание 2 на \d+ мин/.test(taken[0].text) && /суммарная просрочка \d+ → \d+ мин/.test(taken[0].text) && taken[0].machineId === 'M1',
    'журнал: группировка принята — какое просроченное задание закончится позже и суммарная просрочка до/после', taken.map(function(r) { return r.text; }).join(' | '));
var lateOf = function(p) { return itemsOf(p).reduce(function(a, i) { return a + Math.max(0, i.end - i.due); }, 0); };
var asBefore = C.orderQueue({ jobs: seqJobs.map(function(j) { return Object.assign({}, j, { cylinderId: 'c' + j.id }); }), machines: [M1], from: MON, settings: S });
assert(lateOf(sq) < lateOf(asBefore), 'суммарная просрочка с группировкой меньше, чем без неё', lateOf(sq) + ' < ' + lateOf(asBefore));
// задание 3 в срок (его раннее окончание просрочку не уменьшает), просроченное 2 задержится — просрочка растёт: отказ
var grow = [J(1, { due: late }), J(2, { due: late, cylinderId: 'c2', cylinder: '98' }), J(3, { due: MON + 30 * 86400, dieId: 'k1' })];
var log2 = [];
var g2 = C.orderQueue({ jobs: grow, machines: [M1], from: MON, settings: S, trace: function(r) { log2.push(r); } });
var refused = log2.filter(function(r) { return /группировка/.test(r.text) && / — нет:/.test(r.text); });
assert(g2.machines.M1.items.map(function(i) { return i.jobId; }).join() === '1,2,3' && refused.length === 1 &&
    /просроченное задание 2 .* закончится позже на \d+ мин, а суммарная просрочка \d+ → \d+ мин/.test(refused[0].text),
    'просрочка выросла бы — группировка отклонена, журнал называет задание и суммарную просрочку', refused.map(function(r) { return r.text; }).join(' | '));
// задание в срок за срок не уходит ни ради какой экономии наладки
var tight = [J(1), J(2, { cylinderId: 'c2', cylinder: '98', due: MON + 2 * 3600 }), J(3, { dieId: 'k1' })];
var log3 = [];
var g3 = C.orderQueue({ jobs: tight, machines: [M1], from: MON, settings: S, trace: function(r) { log3.push(r); } });
assert(itemsOf(g3).filter(function(i) { return i.jobId === '2'; })[0].late === false, 'задание в срок группировкой за срок не уходит',
    log3.filter(function(r) { return /группировка/.test(r.text); }).map(function(r) { return r.text; }).join(' | '));
var pick = log.filter(function(r) { return r.jobId === '1' && /→ «1 высечка»/.test(r.text); });
assert(pick.length === 1 && /1 высечка — конец/.test(pick[0].text), 'журнал выбора станка: кандидаты с концом и выбранный станок', pick[0] && pick[0].text);
var noTrace = C.orderQueue({ jobs: seqJobs, machines: [M1], from: MON, settings: S });
assert(JSON.stringify(noTrace.machines) === JSON.stringify(sq.machines), 'журнал не меняет план');
var waitLog = [];
C.orderQueue({ jobs: busyJobs, machines: [M1, M2], from: MON, settings: S, trace: function(r) { waitLog.push(r); } });
assert(waitLog.some(function(r) { return r.jobId === '2' && /ждёт вал 96/.test(r.text) && /«1 высечка»/.test(r.text); }), 'журнал называет ожидание вала: номер вала и станок, где он стоит',
    waitLog.map(function(r) { return r.text; }).join(' | '));

// 3. Туррель
var T4 = { id: 'M4', name: '4 высечка', turret: true, sleeveNotNarrower: true, minSeriesM: 40000, stopMaterials: [] };
var narrow = J(9, { sleeve: 'Втулка картонная (76мм/5мм/1000мм) беленная для этикеток', sleeveWidth: 28, footage: 57819.65 });
var v = C.turretVerdicts(narrow, [M1, T4], S, 115639);
assert(v.length === 1 && v[0].name === '4 высечка' && !v[0].ok && v[0].reason === 'ширина втулки 28 мм меньше её диаметра (76 мм)',
    'не на туррели: втулка 76 мм шириной 28 мм (заказ 3584)', JSON.stringify(v));
var shortSeries = C.turretVerdicts(J(10, { sleeve: 'Втулка картонная (40мм/3,5мм/1000мм)', sleeveWidth: 73, footage: 5704 }), [T4], S, 11409)[0];
assert(!shortSeries.ok && shortSeries.reason === 'серия 11409 м меньше 40000 м', 'не на туррели: короткая серия', JSON.stringify(shortSeries));
assert(C.turretVerdicts(J(11, { sleeve: 'Втулка картонная (40мм/3,5мм/1000мм)', sleeveWidth: 73, footage: 50000 }), [T4], S, 50000)[0].ok,
    'широкая втулка и длинная серия — подходит туррели');
assert(C.turretVerdicts(J(12, { machineId: 'M4', sleeveWidth: 28, sleeve: 'Втулка (76мм/5мм)' }), [T4], S, 0)[0].ok === false,
    'запись диспетчера на туррель причину не прячет: правила туррели проверяются как при «Упорядочить»');

// 4. Карточка задания
var f = C.jobFacts({ material: '0043 SG/HM/YG', sleeve: 'Втулка картонная (76мм/5мм/1000мм)', sleeveWidth: 28 },
    { width: '58.00', length: '40.00', knifeType: '58 х 40 (80)', winding: 'внутрь' }, { width: '58', length: '39.3', typeName: '58х40 (80) 4р' });
assert(f.dieSize === '58×39.3' && f.labelSize === '58×40' && f.material === '0043 SG/HM/YG' && f.sleeve === 'Ø76 · 28 мм' && f.windingIn === true,
    'карточка: размер ножа, этикетки, сырьё, втулка; намотка внутрь отмечена', JSON.stringify(f));
var r = C.jobFacts({ material: 'M' }, { width: '52.00', length: '52.00', knifeType: 'D 52 (80)', winding: 'наружу' }, { width: 52, length: 52, typeName: 'D 52 (80)' });
assert(r.dieSize === 'D52' && r.labelSize === 'D52' && r.windingIn === false, 'круглые «D 52 (80)» — диаметром; намотка наружу не подсвечивается', JSON.stringify(r));
var empty = C.jobFacts({ material: '' }, null, null);
assert(empty.dieSize === '' && empty.labelSize === '' && empty.windingIn === false, 'нет позиции и ножа — пустые поля, не «0×0»', JSON.stringify(empty));

// 5. Планшет: куда копировать код
var hu = G.padCodeHint('user'), hp = G.padCodeHint('pad');
assert(/«Пользователь»/.test(hu) && /«Планшеты»/.test(hu), 'устройства нет в «Планшетах» сотрудника — код в «Пользователь» → «Планшеты»', hu);
assert(/«Планшет»/.test(hp) && /первую колонку/.test(hp), 'устройства нет в таблице «Планшет» — код в первую колонку «Планшета»', hp);

console.log('\nИтого: ' + passed + ' из ' + total);
