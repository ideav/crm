// ideav/crm#5340 — «Планирование высечки»: резерв, мера дефицита, Гант, область «Применить».
//
//   D14. Блокировка «нет МР нужного формата» видит резерв у рулона: рулон, зарезервированный
//        под задание, покрывает это задание и не уходит другому.
//   D10. Одна мера покрытия у блокировки, вкладки «Дефицит форматов» и «Зарезервировать МР»:
//        свой резерв, затем свободные ЦЕЛЫЕ рулоны склада, затем очередь первичной резки.
//        Початые свободные рулоны в покрытие не идут (их резервируют вручную) и показываются отдельно.
//   D8.  Гант и очередь без «Упорядочить» — записанный план: только задания, записанные на станок,
//        без выполненных; записанные пересечения раскладываются подряд, занято ≤ ёмкости смены.
//        В Ганте плана выполненные задания не рисуются.
//   D11. «Применить» и «Задачи на втулки» действуют на выбранную область: станок, период дат,
//        отмеченные задания; по умолчанию не на всю очередь.
//
// Run with: node experiments/atex-p2-5340-die-planning-reserve.test.js

process.env.TZ = 'UTC';

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}
function safe(fn) { try { return fn(); } catch (e) { return { error: e.message }; } }

var C = require('../download/atex-p2/js/die-planning-core.js').core;
var S = C.readSettings([], 'ateh1');
function ts(y, mo, d, h, mi) { return Date.UTC(y, mo - 1, d, h || 0, mi || 0) / 1000 - 180 * 60; }   // Москва
var MON = ts(2026, 11, 2, 8, 0);
function J(id, o) {
    return Object.assign({ id: String(id), start: 0, status: 'Запланировано', pullsFact: 0, positionId: 'p' + id, machineId: '',
        dieId: 'k' + id, dieNo: 'N' + id, cylinderId: 'c1', cylinder: '96', materialId: 'm1', material: 'M', footage: 1500,
        minFormat: 300, optFormat: 305, duration: 0, setup: 0, due: 0, rolls: 1, masterRollId: '' }, o || {});
}
function task(id, o) { return Object.assign({ id: id, start: Number(id), open: true, status: 'Запланировано', footage: 1500, minFormat: 300, maxFormat: 315, materialId: 'm1', material: 'M', dieNo: 'N', machine: '', currentRollId: '' }, o || {}); }
function roll(id, o) { return Object.assign({ id: id, no: 'МР-' + id, format: 305, length: 2000, rest: 2000, status: 'на складе', materialId: 'm1', reserveTaskId: '' }, o || {}); }
var M1 = { id: 'M1', name: '1 высечка', cylinders: [], stopMaterials: [] };
var M2 = { id: 'M2', name: '2 высечка', cylinders: [], stopMaterials: [] };
var cal = C.createCalendar(S);
var day0 = cal.dayOf(MON);

// ── D14. Резерв у рулона покрывает своё задание ──────────────────────────────
var jobs14 = [J(1, { start: 1 }), J(2, { start: 2 })];
var rolls14 = [roll('r1', { reserveTaskId: '2' })];
var tasks14 = [task('1'), task('2')];
var cov14 = safe(function() { return C.coverJobs(jobs14, rolls14, [], 15, { tasks: tasks14, moves: [] }); });
assert(cov14['2'] && cov14['2'].deficit === 0 && cov14['2'].reserved === 1500,
    'D14: рулон в резерве задания 2 покрывает задание 2 (блокировки нет)', JSON.stringify(cov14));
assert(cov14['1'] && cov14['1'].deficit === 1000 && cov14['1'].leftover === 500,
    'D14: заданию 1 с более ранним стартом достаётся только остаток рулона сверх потребности задания 2 (500 м)', JSON.stringify(cov14['1']));
var flags14 = safe(function() { return C.jobFlags(jobs14[1], { cover: cov14 }); });
assert(flags14.blocks && flags14.blocks.indexOf('нет МР нужного формата') < 0, 'D14: у задания с резервом нет блокировки «нет МР нужного формата»', JSON.stringify(flags14));
var cov14b = safe(function() { return C.coverJobs([J(1, { start: 1, masterRollId: 'r9' })], [roll('r9')], [], 15, { tasks: [task('1')], moves: [] }); });
assert(cov14b['1'] && cov14b['1'].deficit === 0, 'D14: рулон в поле «Мастер-рулон» задания тоже его покрывает', JSON.stringify(cov14b));
var cov14c = safe(function() {
    return C.coverJobs([J(1, { start: 1, footage: 1500 })], [roll('r1', { reserveTaskId: '1', rest: 500 })], [], 15,
        { tasks: [task('1')], moves: [{ kind: 'расход', taskId: '1', rollId: 'r1', delta: -1000 }] });
});
assert(cov14c['1'] && cov14c['1'].deficit === 0 && cov14c['1'].need === 500, 'D14: уже вырубленное из потребности вычитается (как у склада МР)', JSON.stringify(cov14c));

// ── D10. Одна мера: остатки засчитываются, целые показаны отдельно ───────────
// Решение владельца 31.10: остатки чужих рулонов засчитываются в покрытие. Склад — в метрах;
// остатки (свободные початые и метры сверх потребности держателя рулона) берутся первыми.
var jobs10 = [J(1, { start: 1, footage: 1500 }), J(2, { start: 2, footage: 1500 })];
var tasks10 = [task('1'), task('2')];
var rolls10 = [roll('r1'), roll('r2', { status: 'початый', rest: 1500 })];
var cov10 = safe(function() { return C.coverJobs(jobs10, rolls10, [], 15, { tasks: tasks10, moves: [] }); });
assert(cov10['1'] && cov10['1'].deficit === 0 && cov10['1'].leftover === 1500 && cov10['2'] && cov10['2'].deficit === 0 && cov10['2'].whole === 1500,
    'D10: початый свободный рулон засчитан первым (задание 1), целый — заданию 2; блокировок нет', JSON.stringify(cov10));
var groups10 = safe(function() { return C.coverGroups(jobs10, rolls10, [], 15, { tasks: tasks10, moves: [] }); });
var g10 = Array.isArray(groups10) ? groups10[0] : null;
assert(g10 && g10.meters === 3000 && g10.stock === 3000 && g10.whole === 1500 && g10.leftover === 1500 && g10.deficit === 0,
    'D10: вкладка «Дефицит форматов»: нужно 3000, со склада 3000, из них целых 1500 и остатков 1500', JSON.stringify(g10));
var cov10s = safe(function() { return C.coverJobs(jobs10, [roll('r1')], [], 15, { tasks: tasks10, moves: [] }); });
assert(cov10s['2'] && cov10s['2'].deficit === 1000, 'D10: один целый рулон 2000 м на два задания по 1500 — второму не хватает 1000 м (метры делятся)', JSON.stringify(cov10s));
var sumJobs = Object.keys(cov10s || {}).reduce(function(a, k) { return a + cov10s[k].deficit; }, 0);
var g10s = safe(function() { return C.coverGroups(jobs10, [roll('r1')], [], 15, { tasks: tasks10, moves: [] }); })[0];
assert(g10s && g10s.deficit === sumJobs, 'D10: дефицит группы = сумма дефицитов её заданий', String(sumJobs));
var groups10b = safe(function() { return C.coverGroups(jobs14, rolls14, [], 15, { tasks: tasks14, moves: [] }); });
assert(Array.isArray(groups10b) && groups10b[0].reserved === 1500 && groups10b[0].leftover === 500 && groups10b[0].deficit === 1000,
    'D10: резерв показан в группе отдельно, остаток рулона сверх резерва засчитан другому', JSON.stringify(groups10b));
var cov10c = safe(function() { return C.coverJobs([J(1, { start: 1 })], [roll('r1', { reserveTaskId: '77' })], [], 15, { tasks: [task('1'), task('77', { open: true, footage: 1800 })], moves: [] }); });
assert(cov10c['1'] && cov10c['1'].deficit === 1300 && cov10c['1'].leftover === 200, 'D10: от рулона в резерве другого открытого задания — только его остаток (2000 − 1800)', JSON.stringify(cov10c));
var cov10d = safe(function() { return C.coverJobs([J(1, { start: 1 })], [roll('r1', { reserveTaskId: '99' })], [], 15, { tasks: [task('1')], moves: [] }); });
assert(cov10d['1'] && cov10d['1'].deficit === 1500, 'D10: рулон в резерве задания, которого нет в списке (потребность неизвестна), остатка не даёт', JSON.stringify(cov10d));
var cov10e = safe(function() {
    return C.coverJobs([J(1, { start: 1 })], [roll('r1', { status: 'початый', rest: 1200 })], [], 15,
        { tasks: [task('1'), task('5', { open: true, footage: 1000 })], moves: [{ kind: 'расход', taskId: '5', rollId: 'r1', delta: -300 }] });
});
assert(cov10e['1'] && cov10e['1'].leftover === 500 && cov10e['1'].deficit === 1000, 'D10: из рулона вырубает открытое задание 5 — засчитан остаток сверх его недовырубленного (1200 − 700)', JSON.stringify(cov10e));

// ── D8. Гант и записанный план ───────────────────────────────────────────────
var jobs8 = [
    J(1, { machineId: 'M1', start: MON, duration: 300, setup: 0 }),
    J(2, { machineId: 'M1', start: MON + 60 * 60, duration: 300, setup: 0 }),           // пересекается с 1
    J(3, { machineId: 'M1', start: MON, duration: 100, status: 'Выполнено' }),          // выполнено
    J(4, { machineId: '', start: MON, duration: 100 })                                    // без станка
];
var rec = safe(function() { return C.recordedPlan(jobs8, [M1, M2], S, MON); });
var recIds = rec.machines ? rec.machines.M1.items.map(function(i) { return i.jobId; }).join() : '';
assert(recIds === '1,2', 'D8: записанный план — только задания со станком, без выполненных', JSON.stringify(rec.error || recIds));
assert(rec.machines && !rec.machines.M2.items.length, 'D8: задание без станка ни на какой станок не попадает');
var it1 = rec.machines ? rec.machines.M1.items[0] : null, it2 = rec.machines ? rec.machines.M1.items[1] : null;
assert(it1 && it2 && it2.start >= it1.end && it2.shifted > 0, 'D8: пересекающиеся записанные задания идут подряд, сдвиг отмечен', JSON.stringify([it1 && it1.end, it2 && it2.start, it2 && it2.shifted]));
var g8 = safe(function() { return C.ganttDay(rec.machines, [M1, M2], day0, S); });
assert(g8.rows && g8.rows[0].used <= S.dayCapacityMin && g8.rows[0].used + g8.rows[0].free === S.dayCapacityMin,
    'D8: занято не больше ёмкости смены', JSON.stringify(g8.rows && [g8.rows[0].used, g8.rows[0].free]));
var bars = g8.rows ? g8.rows[0].bars.slice().sort(function(a, b) { return a.from - b.from; }) : [];
assert(bars.every(function(b, i) { return i === 0 || b.from >= bars[i - 1].from + bars[i - 1].minutes; }), 'D8: полосы Ганта не накладываются');
var plan8 = C.orderQueue({ jobs: jobs8, machines: [M1, M2], from: MON, settings: S });
var g8p = C.ganttDay(plan8.machines, [M1, M2], day0, S);
assert(!g8p.rows.some(function(r) { return r.bars.some(function(b) { return b.jobId === '3'; }); }), 'D8: в Ганте плана выполненное задание не рисуется');

// ── D11. Область «Применить» и «Задач на втулки» ─────────────────────────────
var items11 = [
    { jobId: '1', machineId: 'M1', start: MON }, { jobId: '2', machineId: 'M1', start: MON + 86400 },
    { jobId: '3', machineId: 'M2', start: MON }, { jobId: '4', machineId: 'M2', start: MON + 2 * 86400 }
];
function pick(scope) { var r = safe(function() { return C.inScope(items11, scope, S); }); return Array.isArray(r) ? r.map(function(i) { return i.jobId; }).join() : JSON.stringify(r); }
assert(pick({ machineId: 'M1' }) === '1,2', 'D11: область «станок»', pick({ machineId: 'M1' }));
assert(pick({ fromDay: day0, toDay: day0 }) === '1,3', 'D11: область «период дат» по всем станкам', pick({ fromDay: day0, toDay: day0 }));
assert(pick({ machineId: 'M2', fromDay: day0, toDay: day0 + 1 }) === '3', 'D11: станок за период', pick({ machineId: 'M2', fromDay: day0, toDay: day0 + 1 }));
assert(pick({ jobIds: ['2', '4'] }) === '2,4', 'D11: отмеченные задания', pick({ jobIds: ['2', '4'] }));
assert(pick({ jobIds: [] }) === '', 'D11: отмеченных нет — ничего не пишется (не вся очередь)', pick({ jobIds: [] }));
assert(pick({ all: true }) === '1,2,3,4', 'D11: вся очередь — только явным выбором', pick({ all: true }));
assert(pick({}) === '', 'D11: область не задана — ничего', pick({}));

// ── D9. Нож позиции: подбирает планирование и записывает в позицию ───────────
// Решение владельца (31.10): «Сформировать» подбирает нож сам и пишет его в позицию, источник
// истины — позиция («Заказы этикетки» видят тот же нож).
var LO = require('../download/atex-p2/js/label-orders.js').core;
var mats = { m1: { name: 'M', base: 'Бумага' } };
var dies9 = [{ id: 'k1', no: '111', width: 85, length: 38, base: 'Бумага', streams: 3, selectable: true, meters: 0, repeatMm: 666.75, labelsPerRepeat: 3, usedFormat: 305, sleeveWidth: 80, cylinderId: 'c1', state: 'Рабочий' }];
function prow(id, o) {
    return Object.assign({ 'РулоновID': id, 'ЗаказID': '1', 'Заказ': '77', 'СырьёID': 'm1', 'Сырьё': 'M', 'Ширина, мм': '85', 'Длина, мм': '38', 'Ручьёв': '',
        'Шт в рулоне': '5000', 'Рулонов': '50', 'Тип ножей': '85 х 38 (80)', 'Подбор ножа': '', 'НожID': '', 'Срок': '10.11.2026', 'ИТС нужен': '', 'ИТС подтв.': '' }, o || {});
}
var pos9 = [prow('p1', { 'Подбор ножа': 'нет ножа' }), prow('p2')].map(function(r) { return LO.positionFromRow(r, mats); });
var f9 = C.formJobs({ positions: pos9, dies: dies9, jobs: [], settings: S, itsMin: 20, itsMax: 250, mrLength: 2000 });
var c9 = f9.create.filter(function(x) { return x.positionId === 'p1'; })[0];
assert(c9 && c9.dieId === 'k1' && c9.positionWrite && c9.positionWrite.die === 'k1' && c9.positionWrite.diePick === 'подобран',
    'D9: у позиции «нет ножа» планирование подобрало нож — он пишется в позицию («Подбор ножа» = подобран)', JSON.stringify(c9 && c9.positionWrite));
// позиция с этим же ножом, уже записанным, — писать нечего
var probe = LO.planPosition(pos9[1], dies9, { mrLength: 2000, itsMin: 20, itsMax: 250 }).write;
var pos9b = [LO.positionFromRow(prow('p3', { 'НожID': 'k1', 'Нож': '111', 'Подбор ножа': 'подобран', 'Мин. партия': probe.minBatch, 'ИТС нужен': probe.itsNeeded, 'Втулка, мм': probe.sleeveWidth }), mats)];
var f9b = C.formJobs({ positions: pos9b, dies: dies9, jobs: [], settings: S, itsMin: 20, itsMax: 250, mrLength: 2000 });
assert(f9b.create.length === 1 && !f9b.create[0].positionWrite, 'D9: в позиции уже записан этот нож — позиция не переписывается', JSON.stringify(f9b.create[0] && f9b.create[0].positionWrite));
var TP = { position: { id: '70', reqs: { die: '71', diePick: '72', minBatch: '73', itsNeeded: '74' } } };
var pf9 = typeof C.positionPickFields === 'function' ? C.positionPickFields(TP, { die: 'k1', diePick: 'подобран', minBatch: '5000', itsNeeded: '' }) : null;
assert(pf9 && pf9.t71 === 'k1' && pf9.t72 === 'подобран' && pf9.t73 === '5000' && pf9.t74 === '',
    'D9: поля записи позиции — нож, «Подбор ножа», мин. партия, ИТС (как пишет «Заказы этикетки»)', JSON.stringify(pf9));

console.log('\nИтого: ' + passed + ' из ' + total);
