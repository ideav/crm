// ideav/crm#5325 — рабочее место «Склад мастер-рулонов» (Фаза 2 atex, шаг 5).
//
//   1. статус рулона по остатку: на складе (целый) / початый / израсходован; «брак» и
//      «списан» — окончательные, остаток их не возвращает;
//   2. мастер-рулон не переназначается под другой заказ (§9.5 состава): резерв под задание
//      высечки — только тем же сырьём и форматом в [мин. формат ножа, мин. + допуск]; рулон,
//      из которого задание уже вырубало, с задания не снимается и под другое не идёт;
//   3. расход — только вырубкой задания, под которое рулон зарезервирован (или свободного
//      подходящего); не больше остатка;
//   4. инвентаризация — факт от 0 до длины рулона, с основанием (акт); списание — с причиной,
//      остаток в 0, резерв снимается;
//   5. остатки по форматам × сырью: рулонов, остаток, в резерве, свободно; потребность заданий
//      высечки: метраж − израсходовано, в резерве, дефицит;
//   6. автоподбор резерва — целые свободные рулоны ближайшего формата, старые первыми;
//      початые — только явным выбором;
//   7. журнал движения — записи журнала + приход рулона по заданию первичной резки, если
//      записи прихода нет;
//   8. номера «МР-NNNN» после наибольшего; поля записей по резолву таблиц из метаданных.
//
// Run with: node experiments/atex-p2-5325-master-rolls.test.js

process.env.TZ = 'UTC';

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

var M;
try { M = require('../download/atex-p2/js/master-rolls-core.js').core; }
catch (e) { console.log('FAIL — модуль download/atex-p2/js/master-rolls-core.js не загружается: ' + e.message); process.exitCode = 1; M = null; }

if (M) (function() {
    var S = M.ROLL_STATUS, K = M.MOVE_KIND;

    // ── 1. Статус по остатку ─────────────────────────────────────────────────
    assert(M.stockStatus(2000, 2000, S.STOCK) === S.STOCK, 'целый рулон — «на складе»');
    assert(M.stockStatus(640, 2000, S.STOCK) === S.OPENED, 'остаток меньше длины — «початый»');
    assert(M.stockStatus(0, 2000, S.OPENED) === S.USED, 'остаток 0 — «израсходован»');
    assert(M.stockStatus(-5, 2000, S.OPENED) === S.USED, 'минус — «израсходован», не «на складе»');
    assert(M.stockStatus(2000, 2000, S.SCRAP) === S.SCRAP, '«брак» окончательный');
    assert(M.stockStatus(1500, 2000, S.WRITTEN_OFF) === S.WRITTEN_OFF, '«списан» окончательный');
    assert(M.stockStatus(2000, 0, '') === S.STOCK, 'длина не задана — по остатку, «на складе»');

    // ── Данные: задания и рулоны ────────────────────────────────────────────
    var TOL = 15;
    var tasks = M.buildTasks([
        { job_id: '501', job_start: '1790226000', job_status: 'Запланировано', footage: '5000', min_format: '306', opt_format: '310', material_id: '77', material: 'Бумага', die_no: 'Н1', machine: '1 высечка' },
        { job_id: '502', job_start: '1790229600', job_status: 'В работе', footage: '3000', min_format: '266', opt_format: '271', material_id: '77', material: 'Бумага', die_no: 'Н2', machine: '2 высечка' },
        { job_id: '503', job_start: '1790200000', job_status: 'Выполнено', footage: '9000', min_format: '306', material_id: '77', material: 'Бумага' },
        { job_id: '504', job_start: '1790300000', job_status: '', footage: '2000', min_format: '306', material_id: '88', material: 'ПП' }
    ], TOL);
    var byTask = {}; tasks.forEach(function(t) { byTask[t.id] = t; });
    assert(tasks.length === 4 && byTask['503'].open === false && byTask['504'].open === true,
        'задания: «Выполнено» закрыто, пустой статус — открыто');
    assert(byTask['501'].minFormat === 306 && byTask['501'].maxFormat === 321, 'диапазон формата задания [мин, мин + допуск]');

    function roll(id, format, rest, extra) {
        var r = { id: String(id), no: 'МР-' + id, format: format, length: 2000, materialId: '77', material: 'Бумага', rest: rest, status: '', reserveTaskId: '' };
        Object.keys(extra || {}).forEach(function(k) { r[k] = extra[k]; });
        r.status = r.status || M.stockStatus(r.rest, r.length, '');
        return r;
    }
    var rolls = [
        roll(1, 310, 2000),
        roll(2, 310, 2000),
        roll(3, 320, 2000),
        roll(4, 330, 2000),                       // шире диапазона 306–321
        roll(5, 310, 700),                        // початый
        roll(6, 310, 2000, { materialId: '88', material: 'ПП' }),
        roll(7, 270, 2000, { reserveTaskId: '502' }),
        roll(8, 270, 1200, { reserveTaskId: '502' }),
        roll(9, 310, 2000, { status: S.SCRAP, rest: 0 }),
        roll(10, 310, 2000, { reserveTaskId: '503' })  // резерв под закрытое задание — свободен
    ];
    var byRoll = {}; rolls.forEach(function(r) { byRoll[r.id] = r; });
    var moves = [
        { id: 'm1', time: 1790230000, rollId: '8', kind: K.OUT, delta: -800, taskId: '502' }
    ];

    // ── 2. Резерв ────────────────────────────────────────────────────────────
    assert(M.reserveCheck(byRoll['1'], byTask['501'], TOL, moves, tasks).ok, 'свободный рулон того же сырья и формата резервируется');
    var r4 = M.reserveCheck(byRoll['4'], byTask['501'], TOL, moves, tasks);
    assert(!r4.ok && /формат/i.test(r4.error), 'формат вне диапазона ножа — отказ с причиной', r4.error);
    var r6 = M.reserveCheck(byRoll['6'], byTask['501'], TOL, moves, tasks);
    assert(!r6.ok && /сыр/i.test(r6.error), 'другое сырьё — отказ', r6.error);
    var r7 = M.reserveCheck(byRoll['7'], byTask['501'], TOL, moves, tasks);
    assert(!r7.ok && /резерв/i.test(r7.error), 'рулон в резерве другого открытого задания — отказ', r7.error);
    assert(M.reserveCheck(byRoll['10'], byTask['501'], TOL, moves, tasks).ok, 'резерв под закрытое задание не держит рулон');
    var r9 = M.reserveCheck(byRoll['9'], byTask['501'], TOL, moves, tasks);
    assert(!r9.ok, 'брак не резервируется');
    var r503 = M.reserveCheck(byRoll['1'], byTask['503'], TOL, moves, tasks);
    assert(!r503.ok, 'под закрытое задание не резервируется');
    assert(M.reserveCheck(byRoll['5'], byTask['501'], TOL, moves, tasks).ok, 'початый резервируется явным выбором');

    var u7 = M.unreserveCheck(byRoll['7'], moves);
    assert(u7.ok, 'нетронутый рулон с резерва снимается');
    var u8 = M.unreserveCheck(byRoll['8'], moves);
    assert(!u8.ok && /вырубк|расход/i.test(u8.error), 'рулон, из которого задание вырубало, с резерва не снимается', u8.error);
    var re8 = M.reserveCheck(roll(8, 310, 1200, { reserveTaskId: '' }), byTask['501'], TOL, moves, tasks);
    assert(!re8.ok && /502/.test(re8.error), 'рулон, начатый открытым заданием 502, под другое задание не идёт', re8.error);
    var rest503 = M.reserveCheck(roll(12, 310, 900), byTask['501'], TOL,
        [{ id: 'm9', time: 1790200000, rollId: '12', kind: K.OUT, delta: -1100, taskId: '503' }], tasks);
    assert(rest503.ok, 'остаток рулона после выполненного задания резервируется явным выбором', rest503.error);

    // ── 3. Расход ────────────────────────────────────────────────────────────
    var c1 = M.consumePlan(byRoll['8'], 500, byTask['502'], TOL, moves, tasks);
    assert(c1.ok && c1.delta === -500 && c1.rest === 700 && c1.status === S.OPENED, 'расход из своего резерва уменьшает остаток', JSON.stringify(c1));
    var c2 = M.consumePlan(byRoll['8'], 1300, byTask['502'], TOL, moves, tasks);
    assert(!c2.ok, 'расход больше остатка — отказ');
    var c3 = M.consumePlan(byRoll['7'], 100, byTask['501'], TOL, moves, tasks);
    assert(!c3.ok, 'расход из рулона чужого резерва — отказ');
    var c4 = M.consumePlan(byRoll['1'], 2000, byTask['501'], TOL, moves, tasks);
    assert(c4.ok && c4.rest === 0 && c4.status === S.USED && c4.reserveTaskId === '501', 'расход свободного подходящего — до нуля, «израсходован», рулон закрепляется за заданием', JSON.stringify(c4));
    assert(!M.consumePlan(byRoll['1'], 0, byTask['501'], TOL, moves, tasks).ok, 'нулевой расход — отказ');

    // ── 4. Инвентаризация и списание ────────────────────────────────────────
    var i1 = M.inventoryPlan(byRoll['5'], '640', 'акт 12');
    assert(i1.ok && i1.delta === -60 && i1.rest === 640 && i1.status === S.OPENED, 'инвентаризация: факт 640 при учёте 700 → −60', JSON.stringify(i1));
    assert(!M.inventoryPlan(byRoll['5'], '640', '').ok, 'инвентаризация без основания — отказ');
    assert(!M.inventoryPlan(byRoll['5'], '2100', 'акт').ok, 'факт больше длины рулона — отказ');
    assert(!M.inventoryPlan(byRoll['5'], '-1', 'акт').ok, 'отрицательный факт — отказ');
    assert(!M.inventoryPlan(byRoll['5'], 'abc', 'акт').ok, 'факт не число — отказ');
    var i2 = M.inventoryPlan(byRoll['5'], '700', 'акт');
    assert(i2.ok && i2.delta === 0 && i2.changed === false, 'факт совпал — без изменения');
    var i3 = M.inventoryPlan(byRoll['1'], '0', 'не найден');
    assert(i3.ok && i3.status === S.USED, 'факт 0 — «израсходован»');
    assert(!M.inventoryPlan(byRoll['9'], '100', 'акт').ok, 'брак не инвентаризируется в остаток');

    var w1 = M.writeOffPlan(byRoll['7'], 'намок');
    assert(w1.ok && w1.delta === -2000 && w1.rest === 0 && w1.status === S.WRITTEN_OFF && w1.clearReserve === true, 'списание: остаток в 0, «списан», резерв снимается', JSON.stringify(w1));
    assert(!M.writeOffPlan(byRoll['7'], '  ').ok, 'списание без причины — отказ');
    assert(!M.writeOffPlan(roll(11, 310, 0, { status: S.WRITTEN_OFF }), 'x').ok, 'повторное списание — отказ');

    // ── 5. Остатки и потребность ────────────────────────────────────────────
    var stock = M.stockByFormat(rolls, tasks);
    var g310 = stock.filter(function(g) { return g.format === 310 && g.materialId === '77'; })[0];
    assert(g310 && g310.rolls === 4 && g310.opened === 1 && g310.rest === 6700 && g310.reserved === 0 && g310.free === 6700,
        'остатки 310 Бумага: 4 рулона (брак не в счёт), 1 початый, 6 700 м, свободно 6 700', JSON.stringify(g310));
    var g270 = stock.filter(function(g) { return g.format === 270; })[0];
    assert(g270 && g270.reserved === 3200 && g270.free === 0, 'остатки 270: всё в резерве открытого задания', JSON.stringify(g270));

    var need = M.taskNeeds(tasks, rolls, moves, TOL);
    var n502 = need.filter(function(n) { return n.task.id === '502'; })[0];
    assert(n502 && n502.consumed === 800 && n502.need === 2200 && n502.reserved === 3200 && n502.deficit === 0,
        'задание 502: 3 000 − 800 израсходовано = 2 200, в резерве 3 200, дефицита нет', JSON.stringify(n502 && { c: n502.consumed, n: n502.need, r: n502.reserved, d: n502.deficit }));
    var n501 = need.filter(function(n) { return n.task.id === '501'; })[0];
    assert(n501 && n501.need === 5000 && n501.reserved === 0 && n501.deficit === 5000 && n501.available === 8700,
        'задание 501: нужно 5 000, резерва нет, на складе подходит 8 700 (310×2 + 320 + початый 700 + 310 из резерва закрытого)', JSON.stringify(n501 && { n: n501.need, r: n501.reserved, a: n501.available }));
    assert(need.every(function(n) { return n.task.open; }), 'в потребности только открытые задания');

    // ── 6. Автоподбор ───────────────────────────────────────────────────────
    var pick = M.autoPick(byTask['501'], rolls, moves, TOL, 5000, tasks);
    assert(JSON.stringify(pick) === JSON.stringify(['1', '2', '10']), 'автоподбор: целые 310 по порядку, потом 320 не нужен; початый не берётся', JSON.stringify(pick));
    var pick2 = M.autoPick(byTask['501'], rolls, moves, TOL, 7000, tasks);
    assert(pick2.indexOf('5') < 0 && pick2.indexOf('3') >= 0, 'автоподбор: при нехватке 310 берёт 320, початый — нет', JSON.stringify(pick2));
    assert(M.autoPick(byTask['501'], rolls, moves, TOL, 0, tasks).length === 0, 'нет дефицита — ничего не подбирается');

    // ── 7. Журнал ───────────────────────────────────────────────────────────
    var jRolls = [
        { id: '1', no: 'МР-0001', format: 310, length: 2000, jumboJobId: '900', jumboStart: 1790000000 },
        { id: '2', no: 'МР-0002', format: 310, length: 2000, jumboJobId: '', jumboStart: 0 },
        { id: '3', no: 'МР-0003', format: 270, length: 2000, jumboJobId: '900', jumboStart: 1790000000 }
    ];
    var jMoves = [
        { id: 'a', time: 1790100000, rollId: '1', kind: K.OUT, delta: -500, taskId: '501' },
        { id: 'b', time: 1790000500, rollId: '3', kind: K.IN, delta: 2000, basis: 'ручной приход' }
    ];
    var journal = M.journal(jRolls, jMoves);
    assert(journal.length === 3, 'журнал: 2 записи + приход рулона 1 по резке (у рулона 3 приход записан, у 2 резки нет)', JSON.stringify(journal.map(function(x) { return x.rollId + ':' + x.kind; })));
    assert(journal[0].id === 'a' && journal[journal.length - 1].kind === K.IN && journal[journal.length - 1].derived === true,
        'журнал: новые сверху, приход по резке помечен как выведенный');

    // ── 8. Номера и поля ────────────────────────────────────────────────────
    assert(JSON.stringify(M.nextRollNumbers(['МР-0007', 'МР-0101', 'x', 'МР-12'], 2)) === JSON.stringify(['МР-0102', 'МР-0103']), 'номера МР после наибольшего');
    assert(JSON.stringify(M.nextRollNumbers([], 1)) === JSON.stringify(['МР-0001']), 'первый номер — МР-0001');

    var meta = [
        { id: '1000018', val: 'Мастер-рулон', reqs: [
            { id: '120', val: 'Формат, мм' }, { id: '121', val: 'Длина, м' }, { id: '122', val: 'Сырьё этикетки' },
            { id: '124', val: 'Задание первичной резки' }, { id: '125', val: 'Остаток, м' }, { id: '127', val: 'Статус мастер-рулона' },
            { id: '128', val: 'Склад' }, { id: '129', val: 'Задание высечки' }] },
        { id: '2000', val: 'Движение мастер-рулона', reqs: [
            { id: '2001', val: 'Мастер-рулон' }, { id: '2002', val: 'Вид движения мастер-рулона' }, { id: '2003', val: 'Изменение, м' },
            { id: '2004', val: 'Остаток, м' }, { id: '2005', val: 'Задание высечки' }, { id: '2006', val: 'Основание' }, { id: '2007', val: 'Пользователь', attrs: '{"alias":"Оператор"}' }] },
        { id: '2100', val: 'Вид движения мастер-рулона', reqs: [] }
    ];
    var res = M.resolveTables(meta);
    assert(res.tables.masterRoll && res.tables.masterRoll.reqs.reserveTask === '129' && res.tables.rollMove.reqs.delta === '2003',
        'таблицы склада резолвятся по именам', JSON.stringify(res.missing));
    assert(res.missing.indexOf('Склад') >= 0 && res.missing.indexOf('Мастер-рулон') < 0, 'отсутствующие таблицы названы в missing', JSON.stringify(res.missing));

    var f = M.moveFields(res.tables, { time: 1790230000, rollId: '8', kindId: '31', delta: -60, rest: 640, taskId: '', basis: 'акт 12', userId: '462' });
    assert(f.t2000 === '1790230000' && f.t2001 === '8' && f.t2002 === '31' && f.t2003 === '-60' && f.t2004 === '640' && f.t2006 === 'акт 12' && f.t2007 === '462' && !('t2005' in f),
        'поля записи движения', JSON.stringify(f));
    var rf = M.rollUpdateFields(res.tables, { rest: 0, status: S.WRITTEN_OFF, clearReserve: true });
    assert(rf.t125 === '0' && rf.t127 === S.WRITTEN_OFF && rf.t129 === '' && !('t120' in rf) && !('t122' in rf),
        'обновление рулона не трогает формат и сырьё (рулон не «переименовывается»)', JSON.stringify(rf));
})();

console.log('\n' + passed + '/' + total + ' проверок пройдено');
