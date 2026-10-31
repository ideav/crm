// ideav/crm#5320 — рабочее место «Планирование высечки» (Фаза 2 atex, шаг 7), ядро.
//
//   1. нормы: смена вала / смена ножа на том же валу / без смены; длительность вырубки по скорости;
//   2. допустимость станка: допустимые валы (пусто — любой) и стоп-лист сырья;
//   3. календарь: окно дня с 08:00, ёмкость смены, будни; задание, не поместившееся в день,
//      продолжается на следующем рабочем дне без повторной наладки;
//   4. очередь: начатые задания неподвижны; остальные по сроку; группировка вал → нож → сырьё
//      подтягивает следующее задание, если от этого никто не уходит в просрочку (просрочка свята);
//      заблокированные и неподходящие станкам задания не ставятся и называют причину;
//   5. блокировки («нет ножа», «нож списан», «нет МР нужного формата») и предупреждение
//      «ресурс ножа» от 90 % прогноза пробега;
//   6. покрытие заданий мастер-рулонами (склад, потом очередь резки) и резерв: целые рулоны
//      по сроку заданий, один рулон не уходит двум заданиям;
//   7. загрузка ножей и валов за горизонт плана; полосы Ганта за день;
//   8. формирование заданий из позиций (одно задание на позицию), задачи на втулки
//      (без дублей, не начатые приводятся к плану, начатые не трогаются).
//
// Run with: node experiments/atex-p2-5320-die-planning.test.js

process.env.TZ = 'UTC';

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

var C;
try { C = require('../download/atex-p2/js/die-planning-core.js').core; }
catch (e) { console.log('FAIL — модуль download/atex-p2/js/die-planning-core.js не загружается: ' + e.message); process.exitCode = 1; C = null; }

if (C) (function() {
    var S = C.readSettings([], 'ateh1');
    function ts(y, mo, d, h, mi) { return Date.UTC(y, mo - 1, d, h || 0, mi || 0) / 1000 - 180 * 60; }   // Москва
    var MON = ts(2026, 11, 2, 8, 0);
    function J(id, o) {
        return Object.assign({ id: String(id), start: 0, status: 'Запланировано', pullsFact: 0, positionId: 'p' + id, machineId: '',
            dieId: 'k' + id, dieNo: 'N' + id, cylinderId: 'c1', cylinder: '96', materialId: 'm1', material: 'M', footage: 44 * 60,
            duration: 0, setup: 0, due: 0, rolls: 1 }, o || {});
    }
    var M1 = { id: 'M1', name: '1 высечка', cylinders: [], stopMaterials: [] };
    var M2 = { id: 'M2', name: '2 высечка', cylinders: [], stopMaterials: [] };
    function ids(items) { return items.map(function(i) { return i.jobId; }).join(','); }

    // ── 1. Нормы ─────────────────────────────────────────────────────────────
    assert(S.cylinderChange === 90 && S.knifeChange === 20 && S.speed === 44 && S.dayStartMin === 480 && S.dayCapacityMin === 455,
        'нормы по умолчанию: вал 90, нож 20, 44 м/мин, смена с 08:00, 455 мин', JSON.stringify(S));
    var S2 = C.readSettings([{ key: 'DIE_CYLINDER_CHANGE_MN', type: 'ATEH', value: '60' }, { key: 'DIE_SPEED_M_MIN', type: 'ATEH', value: '50' },
        { key: 'DIE_KNIFE_CHANGE_MN', type: 'ATEH', value: 'мусор' }], 'ateh1');
    assert(S2.cylinderChange === 60 && S2.speed === 50 && S2.knifeChange === 20, 'настройки читаются, мусор — значение по умолчанию', JSON.stringify(S2));
    var a = { cylinderId: 'c1', dieId: 'k1' };
    assert(C.setupMinutes(a, { cylinderId: 'c1', dieId: 'k1' }, S) === 0, 'тот же вал и нож — наладки нет');
    assert(C.setupMinutes(a, { cylinderId: 'c1', dieId: 'k2' }, S) === 20, 'тот же вал, другой нож — смена ножа');
    assert(C.setupMinutes(a, { cylinderId: 'c2', dieId: 'k1' }, S) === 90, 'другой вал — смена вала, даже если нож тот же номер');
    assert(C.setupMinutes(null, a, S) === 90, 'на станке ничего не известно — полная наладка');
    assert(C.setupKind(a, { cylinderId: 'c2', dieId: 'k9' }) === 'cylinder' && C.setupKind(a, { cylinderId: 'c1', dieId: 'k9' }) === 'knife' && C.setupKind(a, a) === 'none',
        'вид наладки: вал / нож / нет');
    assert(C.runMinutes(3410.2, S) === 78 && C.runMinutes(44, S) === 1 && C.runMinutes(0, S) === 0 && C.runMinutes(45, S) === 2,
        'вырубка: метры / скорость, вверх до минуты');

    // ── 2. Допустимость станка ───────────────────────────────────────────────
    assert(C.machineAllows(M1, J(1)).ok, 'пустой список валов — станок берёт любой вал');
    var onlyC9 = { id: 'X', cylinders: ['c9'], stopMaterials: [] };
    var chk = C.machineAllows(onlyC9, J(1));
    assert(!chk.ok && /вал/i.test(chk.reason), 'вала нет в «Допустимых валах» — станок не подходит, причина про вал', chk.reason);
    assert(C.machineAllows(onlyC9, J(1, { cylinderId: 'c9' })).ok, 'вал в списке — подходит');
    var stop = C.machineAllows({ id: 'Y', cylinders: [], stopMaterials: ['m1'] }, J(1));
    assert(!stop.ok && /сырь|стоп/i.test(stop.reason), 'сырьё в стоп-листе — не подходит', stop.reason);

    // ── 3. Календарь ─────────────────────────────────────────────────────────
    var cal = C.createCalendar(S);
    function span(minutes, from) {
        var c = cal.cursorAt(from);
        var r = cal.advance(c, minutes, 'run');
        return { start: r.segments[0].start, end: r.segments[r.segments.length - 1].end, segs: r.segments };
    }
    var one = span(100, MON);
    assert(one.start === MON && one.end === MON + 100 * 60, 'задание в день: с 08:00, 100 мин');
    var two = span(500, MON);
    assert(two.segs.length === 2 && two.segs[0].minutes === 455 && two.segs[1].minutes === 45 && two.end === ts(2026, 11, 3, 8, 45),
        'не поместилось: 455 мин в понедельник и 45 мин во вторник с 08:00', JSON.stringify(two.segs.map(function(s) { return s.minutes; })));
    var fri = span(500, ts(2026, 11, 6, 8, 0));
    assert(fri.end === ts(2026, 11, 9, 8, 45), 'с пятницы продолжается в понедельник');
    assert(span(10, ts(2026, 10, 31, 10, 0)).start === MON, 'с субботы старт — понедельник 08:00');
    assert(span(10, ts(2026, 11, 2, 10, 0)).start === ts(2026, 11, 2, 10, 0), 'посреди смены — с текущей минуты');
    assert(span(10, ts(2026, 11, 2, 18, 0)).start === ts(2026, 11, 3, 8, 0), 'после смены — следующий рабочий день с 08:00');
    assert(span(10, ts(2026, 11, 2, 5, 0)).start === MON, 'до начала смены — с 08:00');

    // ── 4. Очередь ───────────────────────────────────────────────────────────
    function order(jobs, machines, extra) {
        return C.orderQueue(Object.assign({ jobs: jobs, machines: machines, from: MON, settings: S }, extra || {}));
    }
    var p1 = order([J(2, { due: ts(2026, 11, 20), cylinderId: 'c2' }), J(1, { due: ts(2026, 11, 10) })], [M1]);
    assert(ids(p1.machines.M1.items) === '1,2', 'по сроку: раньше срок — раньше в очереди', ids(p1.machines.M1.items));
    assert(p1.machines.M1.items[0].start === MON && p1.machines.M1.items[0].setup === 90 && p1.machines.M1.items[0].setupKind === 'cylinder',
        'первое задание: старт 08:00, наладка вала 90');
    assert(p1.machines.M1.items[1].start === MON + (90 + 60) * 60 && p1.machines.M1.items[1].setup === 90, 'второе идёт вплотную, смена вала 90');
    assert(p1.machines.M1.items[0].run === 60 && p1.machines.M1.items[0].end === MON + 150 * 60, 'длительность и конец задания');

    // группировка: C подтягивается к A (общий вал), B уходит после — сроков хватает
    var grp = order([
        J(1, { due: ts(2026, 11, 10), dieId: 'k1' }),
        J(2, { due: ts(2026, 11, 20), cylinderId: 'c2', dieId: 'k2' }),
        J(3, { due: ts(2026, 11, 20), dieId: 'k3' })], [M1]);
    assert(ids(grp.machines.M1.items) === '1,3,2', 'тот же вал подтягивается к текущей группе, если срок не страдает', ids(grp.machines.M1.items));
    assert(grp.machines.M1.items.map(function(i) { return i.setup; }).join(',') === '90,20,90' && grp.summary.setupMinutes === 200,
        'наладки 90 (вал) + 20 (нож) + 90 (вал)', JSON.stringify(grp.summary));

    // внутри вала: тот же нож раньше другого ножа
    var knife = order([
        J(1, { due: ts(2026, 11, 10), dieId: 'k1' }),
        J(2, { due: ts(2026, 11, 20), dieId: 'k2' }),
        J(3, { due: ts(2026, 11, 20), dieId: 'k1' })], [M1]);
    assert(ids(knife.machines.M1.items) === '1,3,2', 'внутри вала подтягивается тот же нож (наладка 0)', ids(knife.machines.M1.items));
    assert(knife.machines.M1.items[1].setup === 0, 'тот же вал и нож — наладка 0');

    // просрочка свята: подтягивание C сдвинуло бы B за срок — порядок остаётся по сроку
    var holy = order([
        J(1, { due: ts(2026, 11, 3), dieId: 'k1', footage: 44 * 60 }),
        J(2, { due: ts(2026, 11, 4), cylinderId: 'c2', dieId: 'k2', footage: 44 * 300 }),
        J(3, { due: ts(2026, 11, 30), dieId: 'k3', footage: 44 * 400 })], [M1]);
    assert(ids(holy.machines.M1.items) === '1,2,3', 'группировка не создаёт просрочку: B не сдвигается за свой срок', ids(holy.machines.M1.items));
    assert(holy.summary.late === 0, 'в плане просрочек нет');
    assert(holy.machines.M1.items.every(function(i) { return !i.late; }), 'ни одно задание не помечено просроченным');

    // уже просроченное задание не уезжает ещё позже
    var late0 = order([
        J(1, { due: ts(2026, 11, 3), dieId: 'k1', footage: 44 * 60 }),
        J(2, { due: ts(2026, 11, 3), cylinderId: 'c2', dieId: 'k2', footage: 44 * 600 }),
        J(3, { due: ts(2026, 11, 30), dieId: 'k3', footage: 44 * 30 })], [M1]);
    assert(ids(late0.machines.M1.items) === '1,2,3', 'просроченное задание не отодвигается группировкой', ids(late0.machines.M1.items));
    assert(late0.summary.late === 1 && late0.machines.M1.items[1].late === true, 'просрочка видна в плане');

    // начатое неподвижно, следующее считает наладку от него
    var run = order([
        J(9, { status: 'В работе', machineId: 'M1', start: MON, setup: 90, footage: 44 * 100, dieId: 'k9' }),
        J(1, { dieId: 'k9', due: ts(2026, 11, 20) })], [M1]);
    var r9 = run.machines.M1.items.filter(function(i) { return i.jobId === '9'; })[0];
    var r1 = run.machines.M1.items.filter(function(i) { return i.jobId === '1'; })[0];
    assert(r9 && r9.fixed === true && r9.start === MON && r9.end === MON + 190 * 60, 'задание «В работе» остаётся на месте со своим стартом');
    assert(r1 && r1.start === r9.end && r1.setup === 0, 'следующее начинается после начатого и наладку считает от него (тот же вал и нож — 0)');
    var fact = order([J(8, { pullsFact: 2, machineId: 'M1', start: MON, setup: 90, footage: 44 * 60 }), J(1, { machineId: 'M1' })], [M1]);
    assert(fact.machines.M1.items.filter(function(i) { return i.jobId === '8'; })[0].fixed === true, 'есть съёмы факт — задание начато и не двигается');
    var done = order([J(7, { status: 'Выполнено', machineId: 'M1', start: MON - 86400 * 7 }), J(1)], [M1]);
    assert(ids(done.machines.M1.items.filter(function(i) { return !i.fixed; })) === '1' && !done.unplaced.length, 'выполненные в очередь не попадают');
    var done2 = order([J(7, { status: 'Выполнено', machineId: 'M1', start: MON - 86400 * 7, cylinderId: 'c1', dieId: 'k1' }), J(1, { dieId: 'k1' })], [M1]);
    assert(done2.machines.M1.items.filter(function(i) { return i.jobId === '1'; })[0].setup === 0, 'то, что стояло на станке после выполненного, учитывается: тот же вал и нож — наладки нет');

    // план устойчив: записанный план при повторном «Упорядочить» не меняется (старт — результат, а не вход)
    var stable0 = [J(1, { due: ts(2026, 11, 3), dieId: 'k1' }), J(2, { due: ts(2026, 11, 3), cylinderId: 'c2', dieId: 'k2', footage: 44 * 90 }),
        J(3, { due: ts(2026, 11, 3), dieId: 'k3', footage: 44 * 30 }), J(4, { due: ts(2026, 11, 20), cylinderId: 'c2', dieId: 'k4' })];
    var st1 = order(stable0, [M1, M2]);
    var written = stable0.map(function(j) {
        var mid = Object.keys(st1.machines).filter(function(m) { return st1.machines[m].items.some(function(i) { return i.jobId === j.id; }); })[0];
        var it = st1.machines[mid].items.filter(function(i) { return i.jobId === j.id; })[0];
        return Object.assign({}, j, { machineId: mid, start: it.start, setup: it.setup, duration: it.run });
    });
    var st2 = order(written, [M1, M2]);
    var sig = function(p) { return Object.keys(p.machines).map(function(m) { return m + ':' + p.machines[m].items.map(function(i) { return i.jobId + '@' + i.start + '/' + i.setup; }).join(','); }).join('|'); };
    assert(sig(st1) === sig(st2), 'повторное «Упорядочить» по записанному плану даёт тот же план', sig(st1) + '  ≠  ' + sig(st2));

    var reversed = stable0.map(function(j, i) { return Object.assign({}, j, { start: MON + (10 - i) * 3600 }); });
    assert(sig(order(reversed, [M1, M2])) === sig(st1), 'записанный старт на порядок не влияет: при равных сроках — по номеру задания', sig(order(reversed, [M1, M2])));
    // станки
    var two2 = order([J(1), J(2)], [M1, M2]);
    assert(two2.machines.M1.items.length === 1 && two2.machines.M2.items.length === 1, 'два задания на два станка — по одному на станок (раньше заканчиваем)');
    assert(two2.machines.M2.items[0].start === MON, 'оба стартуют в 08:00');
    var picky = order([J(1)], [{ id: 'M1', cylinders: ['c9'], stopMaterials: [] }, M2]);
    assert(picky.machines.M2.items.length === 1 && !picky.machines.M1.items.length, 'вал не допущен на станке 1 — задание уходит на станок 2');
    var none = order([J(1)], [{ id: 'M1', cylinders: ['c9'], stopMaterials: [] }]);
    assert(none.unplaced.length === 1 && none.unplaced[0].jobId === '1' && /вал/i.test(none.unplaced[0].reasons.join(' ')), 'нет подходящего станка — не размещено, причина названа', JSON.stringify(none.unplaced));
    var blk = order([J(1), J(2)], [M1], { blocked: { '2': ['нет ножа'] } });
    assert(ids(blk.machines.M1.items) === '1' && blk.unplaced[0].jobId === '2' && blk.unplaced[0].reasons[0] === 'нет ножа', 'заблокированное задание в очередь не ставится');
    var sat = order([J(1)], [M1], { from: ts(2026, 10, 31, 10, 0) });
    assert(sat.machines.M1.items[0].start === MON, 'планирование в субботу начинается в понедельник');
    var longj = order([J(1, { footage: 44 * 500 })], [M1]);
    var lj = longj.machines.M1.items[0];
    assert(lj.setup === 90 && lj.segments.length === 3 && lj.end === ts(2026, 11, 3, 8, 0) + (590 - 455) * 60,
        'длинное задание: наладка один раз, остаток — на следующий день без новой наладки', JSON.stringify(lj.segments.map(function(s) { return [s.kind, s.minutes]; })));

    // ── 5. Блокировки и предупреждения ───────────────────────────────────────
    var dieCtx = { dies: { k1: { state: 'Рабочий', mileage: 100000, resource: 300000 }, k2: { state: 'Списан', mileage: 0, resource: 300000 },
        k3: { state: 'Рабочий', mileage: 250000, resource: 300000 }, k4: { state: 'Рабочий', mileage: 0, resource: 0 } },
        openMeters: { k1: 5000, k3: 30000 }, cover: { '5': { deficit: 1000 }, '1': { deficit: 0 } } };
    assert(C.jobFlags(J(1, { dieId: 'k1' }), dieCtx).blocks.length === 0, 'исправный нож, МР есть — блокировок нет');
    assert(C.jobFlags(J(1, { dieId: '' }), dieCtx).blocks[0] === 'нет ножа', 'нет ножа');
    assert(C.jobFlags(J(1, { dieId: 'k2' }), dieCtx).blocks.indexOf('нож списан') >= 0, 'нож списан');
    assert(C.jobFlags(J(5, { dieId: 'k1' }), dieCtx).blocks.indexOf('нет МР нужного формата') >= 0, 'нет МР нужного формата');
    var w3 = C.jobFlags(J(1, { dieId: 'k3' }), dieCtx);
    assert(w3.blocks.length === 0 && w3.warnings.some(function(x) { return /ресурс ножа/.test(x); }), '250 000 + 30 000 из 300 000 = 93 % — предупреждение «ресурс ножа»', JSON.stringify(w3));
    assert(!C.jobFlags(J(1, { dieId: 'k1' }), dieCtx).warnings.length, '105 000 из 300 000 — предупреждения нет');
    assert(!C.jobFlags(J(1, { dieId: 'k4' }), dieCtx).warnings.length, 'ресурс не задан — предупреждения нет');

    // ── 6. Покрытие МР и резерв ──────────────────────────────────────────────
    var cj = [J(1, { footage: 1500, minFormat: 300, optFormat: 305, start: 1 }), J(2, { footage: 1500, minFormat: 300, optFormat: 305, start: 2 })];
    var rolls = [{ id: 'r1', format: 305, materialId: 'm1', rest: 2000, status: 'на складе' },
        { id: 'r2', format: 305, materialId: 'm2', rest: 2000, status: 'на складе' },
        { id: 'r3', format: 400, materialId: 'm1', rest: 2000, status: 'на складе' }];
    var cov = C.coverJobs(cj, rolls, [], 15);
    assert(cov['1'].deficit === 0 && cov['2'].deficit === 1000, 'склад покрывает первое задание, второму не хватает 1000 м; чужое сырьё и формат не считаются', JSON.stringify(cov));
    var cov2 = C.coverJobs(cj, rolls, [{ jobId: 'q', materialId: 'm1', format: 305, meters: 2000, readyAt: 100 }], 15);
    assert(cov2['2'].deficit === 0 && cov2['2'].planned > 0, 'остаток закрывает очередь первичной резки', JSON.stringify(cov2['2']));

    function task(id, o) { return Object.assign({ id: id, start: Number(id), open: true, status: 'Запланировано', footage: 1500, minFormat: 300, maxFormat: 315, materialId: 'm1', material: 'M', dieNo: 'N', machine: '', currentRollId: '' }, o || {}); }
    function roll(id, o) { return Object.assign({ id: id, no: 'МР-' + id, format: 305, length: 2000, rest: 2000, status: 'на складе', materialId: 'm1', reserveTaskId: '' }, o || {}); }
    var res1 = C.planReservations([task('2'), task('1')], [roll('10'), roll('11')], [], 15);
    assert(res1.length === 2 && res1[0].taskId === '1' && res1[0].rollIds.join() === '10' && res1[1].taskId === '2' && res1[1].rollIds.join() === '11',
        'рулоны по сроку заданий, один рулон — одному заданию', JSON.stringify(res1));
    var res2 = C.planReservations([task('1'), task('2')], [roll('10')], [], 15);
    assert(res2.length === 2 && res2[0].rollIds.join() === '10' && res2[1].rollIds.length === 0 && res2[1].deficit === 1500,
        'рулонов не хватает — второе остаётся с дефицитом', JSON.stringify(res2));
    var res3 = C.planReservations([task('1')], [roll('10', { rest: 700, status: 'початый' })], [], 15);
    assert(res3[0].rollIds.length === 0, 'початый рулон сам не резервируется (только явным выбором)');
    var res4 = C.planReservations([task('1')], [roll('10', { reserveTaskId: '1' }), roll('11')], [], 15);
    assert(res4.length === 0, 'у задания резерв покрывает потребность — ничего не делаем');
    var res5 = C.planReservations([task('1')], [roll('10', { reserveTaskId: '99' }), roll('11', { format: 500 })], [], 15);
    assert(res5[0].rollIds.length === 0, 'рулон чужого открытого задания и рулон не того формата не берутся');
    var res6 = C.planReservations([task('1', { status: 'В работе' })], [roll('10')], [], 15);
    assert(res6.length === 0, 'задание в работе резерв не получает');

    // ── 7. Загрузка ножей и валов, Гант ──────────────────────────────────────
    var jobsL = [J(1, { dieId: 'k1', dieNo: '111', cylinderId: 'c1', cylinder: '96', footage: 44 * 60 }),
        J(2, { dieId: 'k2', dieNo: '222', cylinderId: 'c1', cylinder: '96', footage: 44 * 60 }),
        J(3, { dieId: 'k3', dieNo: '333', cylinderId: 'c2', cylinder: '104', footage: 44 * 60 })];
    var planL = order(jobsL, [M1]);
    var load = C.toolLoad({ plan: planL, jobs: jobsL, from: MON, settings: S,
        dies: { k1: { mileage: 1000, resource: 10000 }, k2: { mileage: 0, resource: 0 }, k3: { mileage: 9000, resource: 10000 } } });
    var k1 = load.knives.filter(function(k) { return k.dieId === 'k1'; })[0];
    assert(k1 && k1.jobs === 1 && k1.meters === 2640 && k1.mileage === 1000 && k1.mileageAfter === 3640 && k1.level === 'ok',
        'нож: заданий, метров, пробег сейчас и после плана', JSON.stringify(k1));
    var k3 = load.knives.filter(function(k) { return k.dieId === 'k3'; })[0];
    assert(k3.level === 'over', 'пробег после плана выше ресурса — «выработан»', JSON.stringify(k3));
    var c1 = load.cylinders.filter(function(c) { return c.cylinderId === 'c1'; })[0];
    var c2 = load.cylinders.filter(function(c) { return c.cylinderId === 'c2'; })[0];
    assert(c1.jobs === 2 && c1.changes === 1 && c1.minutes === 90 + 60 + 20 + 60 && c2.changes === 1 && c2.jobs === 1,
        'вал: заданий, минут (с наладкой), смен вала', JSON.stringify([c1, c2]));
    var farJob = order([J(1, { footage: 44 * 60 * 20 })], [M1]);
    var farLoad = C.toolLoad({ plan: farJob, jobs: [J(1)], from: MON, settings: Object.assign({}, S, { horizonDays: 1 }), dies: {} });
    assert(farLoad.knives.length === 1, 'задание, начавшееся в горизонте, считается');
    var farLate = order([J(1), J(2, { dieId: 'k2', footage: 44 * 455 * 3 }), J(3, { dieId: 'k3' })], [M1]);
    var farLate2 = C.toolLoad({ plan: farLate, jobs: [J(1), J(2), J(3)], from: MON, settings: Object.assign({}, S, { horizonDays: 1 }), dies: {} });
    assert(farLate2.knives.length === 2, 'задание, начавшееся за горизонтом, в загрузку не входит', String(farLate2.knives.length));
    var gantt = C.ganttDay(planL.machines, [M1], cal.dayOf(MON), S);
    var gr = gantt.rows[0];
    assert(gr.bars[0].kind === 'setup-cylinder' && gr.bars[0].from === 0 && gr.bars[0].minutes === 90 && gr.bars[1].kind === 'run' && gr.bars[1].from === 90 && gr.bars[1].jobId === '1',
        'Гант: наладка вала, затем вырубка', JSON.stringify(gr.bars.slice(0, 2)));
    assert(gr.bars.some(function(b) { return b.kind === 'setup-knife'; }), 'Гант: наладка ножа выделена отдельным видом');
    assert(gr.used + gr.free === 455 && gr.free >= 0, 'Гант: занято + свободно = ёмкость смены', JSON.stringify([gr.used, gr.free]));

    // ── 8. Формирование заданий ──────────────────────────────────────────────
    var LO = require('../download/atex-p2/js/label-orders.js').core;
    var mats = { 'm1': { name: 'M', base: 'Бумага' } };
    var dies = [
        { id: 'k1', no: '111', width: 85, length: 38, base: 'Бумага', streams: 3, selectable: true, meters: 0, repeatMm: 666.75, labelsPerRepeat: 3, usedFormat: 305, sleeveWidth: 80, cylinderId: 'c1', state: 'Рабочий' }
    ];
    function prow(id, o) {
        return Object.assign({ 'РулоновID': id, 'ЗаказID': '1', 'Заказ': '77', 'СырьёID': 'm1', 'Сырьё': 'M', 'Ширина, мм': '85', 'Длина, мм': '38', 'Ручьёв': '',
            'Шт в рулоне': '5000', 'Рулонов': '50', 'Тип ножей': '85 х 38 (80)', 'Подбор ножа': '', 'НожID': '', 'Срок': '10.11.2026', 'ИТС нужен': '', 'ИТС подтв.': '' }, o || {});
    }
    var positions = [prow('p1'), prow('p2', { 'Ширина, мм': '101', 'Длина, мм': '101', 'Тип ножей': '' }), prow('p3'), prow('p4', { 'Ширина, мм': '10', 'Длина, мм': '10', 'Тип ножей': '' })]
        .map(function(r) { return LO.positionFromRow(r, mats); });
    var formed = C.formJobs({ positions: positions, dies: dies, jobs: [J(5, { positionId: 'p3' })], settings: S, itsMin: 20, itsMax: 250, mrLength: 2000 });
    assert(formed.create.length === 1 && formed.create[0].positionId === 'p1', 'создаётся задание для позиции, у которой нож подобран, а задания нет', JSON.stringify(formed.create.map(function(x) { return x.positionId; })));
    var f1 = formed.create[0];
    assert(f1.dieId === 'k1' && f1.cylinderId === 'c1' && f1.footage > 0 && f1.pullsPlan >= 1 && f1.duration === C.runMinutes(f1.footage, S), 'метраж, съёмы (= число МР), длительность и вал из ножа', JSON.stringify(f1));
    assert(f1.pullsPlan === Math.ceil(f1.footage / 2000), 'съёмов = число мастер-рулонов');
    var sk = formed.skipped.reduce(function(o, x) { o[x.positionId] = x.reason; return o; }, {});
    assert(/нет ножа/.test(sk.p2 || ''), 'позиция без ножа не создаёт задание', JSON.stringify(sk));
    assert(/уже есть задание/.test(sk.p3 || ''), 'одна позиция — одно задание: у p3 оно уже есть', JSON.stringify(sk));
    assert(/ИТС/.test(sk.p4 || '') || /нет ножа/.test(sk.p4 || ''), 'ждёт ИТС или без ножа — не идёт в планирование', JSON.stringify(sk));
    var again = C.formJobs({ positions: positions, dies: dies, jobs: [J(5, { positionId: 'p3' }), J(6, { positionId: 'p1' })], settings: S, itsMin: 20, itsMax: 250, mrLength: 2000 });
    assert(again.create.length === 0, 'повторный запуск не дублирует задания');
    var cancelled = C.formJobs({ positions: positions, dies: dies, jobs: [J(6, { positionId: 'p1', status: 'Отменено' })], settings: S, itsMin: 20, itsMax: 250, mrLength: 2000 });
    assert(cancelled.create.some(function(x) { return x.positionId === 'p1'; }), 'отменённое задание новому не мешает');

    // поля записи
    var T = { dieJob: { id: '19', reqs: { position: '30', die: '32', cylinder: '33', machine: '35', pullsPlan: '39', footage: '42', duration: '43', setup: '45', status: '46' } } };
    var cf = C.jobCreateFields(T, { start: 1000, positionId: 'p1', dieId: 'k1', cylinderId: 'c1', pullsPlan: 2, footage: 3410.2, duration: 78 });
    assert(cf.t19 === '1000' && cf.t30 === 'p1' && cf.t32 === 'k1' && cf.t33 === 'c1' && cf.t39 === '2' && cf.t42 === '3410.2' && cf.t43 === '78' && cf.t46 === 'Запланировано',
        'поля нового задания: главное значение — план-старт, статус «Запланировано»', JSON.stringify(cf));
    var pf = C.jobPlanFields(T, { start: 2000, machineId: 'M1', cylinderId: 'c1', setup: 90, duration: 78 });
    assert(pf.t19 === '2000' && pf.t35 === 'M1' && pf.t33 === 'c1' && pf.t45 === '90' && pf.t43 === '78' && !pf.t46, 'поля плана: старт, станок, вал, наладка, длительность; статус не трогаем', JSON.stringify(pf));

    // отчёт → задания
    var rows = [{ job_id: '5', job_start: '1790226000', job_status: 'Запланировано', pulls_plan: '2', pulls_fact: '', footage: '3410.20', duration: '78', setup: '30',
        machine_id: '1000173', machine: '1 высечка', die_id: '1000339', die_no: '662668', cylinder_id: '1000193', cylinder: '116', master_roll_id: '', position_id: '1000470',
        order_no: '3259', due: '06.10.2026', rolls: '50', min_format: '266', opt_format: '271', used_format: '270', material_id: '1000177', material: 'M', sleeve_id: '8192', sleeve: 'Втулка картонная (76мм/5мм/1000мм)', sleeve_width: '80.00', die_streams: '3' }];
    var bj = C.buildJobs(rows)[0];
    assert(bj.id === '5' && bj.start === 1790226000 && bj.positionId === '1000470' && bj.cylinderId === '1000193' && bj.minFormat === 266 && bj.rolls === 50 && bj.setup === 30 && bj.duration === 78,
        'строка отчёта → задание', JSON.stringify(bj));
    assert(bj.due === ts(2026, 10, 7, 0, 0), 'срок позиции «06.10.2026» — до конца этого дня по Москве', String(bj.due));
    assert(C.isStarted(Object.assign({}, bj, { status: 'В работе' })) && !C.isStarted(bj) && C.isStarted(Object.assign({}, bj, { pullsFact: 1 })), 'начато: «В работе» или есть съёмы факт');

    // ── 9. Задачи на втулки ──────────────────────────────────────────────────
    var cutters = [{ id: 'tc20', name: 'TC-20', min: 12, max: 25 }, { id: 'tc40', name: 'TC-40', min: 26, max: 40 }, { id: 'tc76', name: 'TC-76', min: 41, max: 76 }];
    assert(C.sleeveDiameterMm('Втулка картонная (76мм/5мм/1000мм) беленная для этикеток') === 76 && C.sleeveDiameterMm('Втулка картонная (40мм/3,5мм/1000мм)') === 40 &&
        C.sleeveDiameterMm('Втулка картонная 1\\" длина 1 метр') === 25 && C.sleeveDiameterMm('Втулка картонная 0.5" ширина 57 мм') === 12 && C.sleeveDiameterMm('') === 0, 'диаметр втулки из названия: «(76мм/…)» и дюймы');
    assert(C.pickCutter(cutters, 76).id === 'tc76' && C.pickCutter(cutters, 40).id === 'tc40' && C.pickCutter(cutters, 25).id === 'tc20' && C.pickCutter(cutters, 100) === null && C.pickCutter(cutters, 0) === null,
        'втулкорез по диапазону диаметров');
    var sj = [J(1, { start: MON, rolls: 50, positionId: 'P1', sleeve: 'Втулка картонная (76мм/5мм/1000мм)' }), J(2, { start: MON + 3600, rolls: 20, positionId: 'P2', sleeve: 'Втулка картонная (40мм/3,5мм/1000мм)' }),
        J(3, { status: 'Выполнено', start: MON, rolls: 5, positionId: 'P3', sleeve: 'Втулка (76мм)' })];
    var sp = C.sleevePlan({ jobs: sj, tasks: {}, cutters: cutters });
    assert(sp.ops.length === 2 && sp.ops[0].op === 'create' && sp.ops[0].positionId === 'P1' && sp.ops[0].qty === 50 && sp.ops[0].cutterId === 'tc76' && sp.ops[0].start === MON &&
        sp.ops[1].cutterId === 'tc40', 'задачи создаются: количество = рулоны позиции, втулкорез по диаметру, дата = план-старт; выполненное задание пропущено', JSON.stringify(sp.ops));
    var have = { P1: [{ id: 't1', start: MON, qty: 50, cutterId: 'tc76', touched: false }], P2: [{ id: 't2', start: MON, qty: 10, cutterId: 'tc20', touched: false }] };
    var sp2 = C.sleevePlan({ jobs: sj, tasks: have, cutters: cutters });
    assert(sp2.ops.length === 1 && sp2.ops[0].op === 'update' && sp2.ops[0].taskId === 't2' && sp2.ops[0].qty === 20 && sp2.ops[0].cutterId === 'tc40' && sp2.ops[0].start === MON + 3600,
        'у позиции уже есть задача — не дублируется; не начатая приводится к плану (количество, втулкорез, дата)', JSON.stringify(sp2.ops));
    var sp3 = C.sleevePlan({ jobs: sj, tasks: { P1: [{ id: 't1', start: MON - 99, qty: 7, cutterId: 'tc20', touched: true }], P2: have.P2 }, cutters: cutters });
    assert(!sp3.ops.some(function(o) { return o.positionId === 'P1' && o.op === 'update'; }) && sp3.ops.some(function(o) { return o.positionId === 'P1' && o.op === 'create' && o.qty === 43; }),
        'начатая задача (Начато / Закончено / Кол-во факт) не трогается; на остаток рулонов — новая', JSON.stringify(sp3.ops));
    var sp4 = C.sleevePlan({ jobs: [sj[0]], tasks: { P1: [{ id: 't1', start: MON - 99, qty: 50, cutterId: 'tc76', touched: true }] }, cutters: cutters });
    assert(sp4.ops.length === 0 && sp4.skipped.some(function(x) { return x.positionId === 'P1' && /начат/.test(x.reason); }), 'вся партия уже в работе — ничего не создаём, причина названа', JSON.stringify(sp4));
    var sp5 = C.sleevePlan({ jobs: [J(1, { start: MON, rolls: 5, positionId: 'P1', sleeve: 'Втулка 3 дюйма' })], tasks: {}, cutters: cutters });
    assert(sp5.ops.length === 1 && sp5.ops[0].cutterId === '' && sp5.warnings.length === 1, 'диаметр не разобран — задача без втулкореза и предупреждение', JSON.stringify(sp5));
    var sT = { sleeveTask: { id: '1080', reqs: { cutter: '1180', qty: '16399' } } };
    var sf = C.sleeveCreateFields(sT, { start: MON, qty: 50, cutterId: 'tc76' });
    assert(sf.t1080 === String(MON) && sf.t16399 === '50' && sf.t1180 === 'tc76', 'поля задачи на втулки: главное значение — старт, количество, втулкорез', JSON.stringify(sf));
})();

console.log('\nИтого: ' + passed + ' из ' + total);
