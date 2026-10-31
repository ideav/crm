// ideav/crm#5326 — Фаза 2 atex, шаг 8: пульт высечки (планшет оператора).
//
// Что проверяется (ядро download/atex-p2/js/die-cutter.js):
//   1. очередь станка: только задания этого станка, «В работе» — текущее, дальше по
//      план-старту; закрытые сегодня — отдельно, вчерашние закрытые не показываются;
//   2. съёмы: на каждый съём — движение пробега и партия ГП; счётчик съёмов — движения
//      «вырубка» задания, поэтому повтор после обрыва дописывает только недостающие партии
//      ГП и «Съёмов факт», движений не дублирует; первый съём ставит «В работе»;
//   3. пробег меняется только движением: «за смену» — вырубка с начала суток по Москве,
//      «сейчас» — dieMileage (общий модуль);
//   4. остаток мастер-рулона = текущий остаток − метры новых съёмов, не ниже нуля
//      (остаток меняют и другие рабочие места — от длины не пересчитывается);
//   5. оснастка для смены: ножи того же размера этикетки, кроме текущего и списанных;
//      валы — допустимые для станка (пусто = любой);
//   6. чек-лист ИТС: отмеченный пункт повторно не пишется; вызовы ИТС — незакрытые по станку;
//   7. таблицы ИТС резолвятся из метаданных по декларации
//      docs/atex_p2_die_cutter_schema_5326.json.
//
// Run with: node experiments/atex-p2-5326-die-cutter.test.js

process.env.TZ = 'UTC';
var fs = require('fs');
var path = require('path');

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

var DC = require('../download/atex-p2/js/die-cutter.js').core;

// 30.10.2026 12:00 МСК = 09:00 UTC
var NOW = Date.UTC(2026, 9, 30, 9, 0, 0) / 1000;
var DAY = DC.moscowDayStart(NOW);

assert(DAY === Date.UTC(2026, 9, 29, 21, 0, 0) / 1000, 'начало суток — полночь по Москве (21:00 UTC накануне)');
assert(DC.moscowDayStart(DAY) === DAY && DC.moscowDayStart(DAY - 1) === DAY - 86400, 'граница суток: полночь — в своих сутках, секунда до — в прошлых');

function job(o) {
    var base = { id: '1', start: NOW, status: 'Запланировано', pullsPlan: 5, pullsFact: 0, footage: 1000, setup: 30,
        machineId: 'M1', machine: '1 высечка', dieId: 'D1', dieNo: '1247', streams: 4, cylinderId: 'C96', cylinder: '96',
        rollId: 'R1', roll: 'МР-0001', rollLength: 4000, rollRest: '4000', rollFormat: 330, positionId: 'P1', order: '3257',
        labelWidth: 58, labelLength: 40, labelsPerRoll: 2000, material: 'Бумага' };
    Object.keys(o || {}).forEach(function(k) { base[k] = o[k]; });
    return base;
}
function cut(id, jobId, meters, date, dieId) { return { id: id, date: date || NOW, meters: meters, kind: 'вырубка', jobId: jobId, dieId: dieId || 'D1' }; }

// ── 1. Очередь станка ──────────────────────────────────────────────────────
(function() {
    var jobs = [
        job({ id: '10', start: NOW + 3600 }),
        job({ id: '11', start: NOW + 600, status: 'В работе' }),
        job({ id: '12', start: NOW - 7200 }),
        job({ id: '13', start: NOW - 3600, status: 'Выполнено' }),
        job({ id: '14', start: DAY - 3600, status: 'Выполнено' }),
        job({ id: '15', start: NOW, machineId: 'M2' })
    ];
    var q = DC.machineQueue(jobs, 'M1', DAY);
    assert(q.current && q.current.id === '11', 'текущее задание — «В работе», даже если оно не первое по времени');
    assert(q.open.map(function(j) { return j.id; }).join() === '12,11,10', 'открытые задания станка — по план-старту', q.open.map(function(j) { return j.id; }).join());
    assert(q.next && q.next.id === '12', 'следующее — первое открытое после текущего');
    assert(q.doneToday.map(function(j) { return j.id; }).join() === '13', 'закрытые сегодня — отдельно, вчерашние не видны');
    assert(DC.machineQueue(jobs, '', DAY).open.length === 0, 'станок не выбран — заданий нет');
    var q2 = DC.machineQueue([job({ id: '20', start: NOW + 10 }), job({ id: '21', start: NOW })], 'M1', DAY);
    assert(q2.current.id === '21' && q2.next.id === '20', 'нет задания «В работе» — текущее самое раннее');
})();

// ── 2. Съёмы: план записи и повтор после обрыва ─────────────────────────────
(function() {
    var j = job({});
    assert(DC.metersPerPull(j) === 200, 'метраж съёма = метраж задания / план съёмов');
    assert(DC.metersPerPull(job({ pullsPlan: 0 })) === 0, 'план съёмов пуст — метраж съёма 0, а не бесконечность');

    var p = DC.takeoffPlan(j, [j], [], [], 2, 200);
    assert(p.ok && p.runs.length === 2 && p.runs[0] === 200, 'два съёма — два движения пробега по 200 м');
    assert(p.gps.map(function(g) { return g.name; }).join() === 'ГПЭ-1-01,ГПЭ-1-02', 'на каждый съём — партия ГП с номером съёма', p.gps.map(function(g) { return g.name; }).join());
    assert(p.gps[0].rolls === 4, 'в партии ГП — рулонов по числу ручьёв ножа');
    assert(p.fact === 2 && p.status === 'В работе', 'первый съём: «Съёмов факт» 2 и статус «В работе»');
    assert(p.rest === 3600, 'остаток рулона 4000 − 2×200 = 3600');

    // Обрыв: движения записаны (2), партия ГП только одна, «Съёмов факт» не обновился.
    var runs = [cut('r1', '1', 200), cut('r2', '1', 200)];
    var gps = [{ id: 'g1', val: 'ГПЭ-1-01', jobId: '1' }];
    var running = job({ status: 'В работе', pullsFact: 0 });
    var pr = DC.jobProgress(running, runs, gps);
    assert(pr.done === 2 && pr.gpMissing.join() === '2' && pr.factStale, 'прогресс по движениям: 2 съёма, не хватает партии ГП №2, факт отстал');
    var tail = DC.takeoffPlan(running, [running], runs, gps, 0, 0);
    assert(tail.ok && tail.runs.length === 0, 'дописать хвосты — без новых движений пробега');
    assert(tail.gps.map(function(g) { return g.k; }).join() === '2' && tail.fact === 2, 'дописывается только партия ГП №2 и «Съёмов факт» 2');
    assert(tail.status === '', 'статус «В работе» повторно не пишется');
    var more = DC.takeoffPlan(running, [running], runs, gps, 1, 200);
    assert(more.runs.length === 1 && more.gps.map(function(g) { return g.k; }).join() === '2,3' && more.fact === 3, 'новый съём после обрыва: одно движение, партии ГП №2 и №3, факт 3');

    // Движения чужого задания и не «вырубка» в счёт съёмов не идут.
    var mixed = [cut('a', '1', 200), cut('b', '2', 200), { id: 'c', date: NOW, meters: 5000, kind: 'начальный остаток', jobId: '1', dieId: 'D1' }];
    assert(DC.jobProgress(j, mixed, []).done === 1, 'съёмы задания — только его движения «вырубка»');

    assert(!DC.takeoffPlan(j, [j], [], [], 1, 0).ok, 'нулевой метраж съёма — отказ');
    assert(!DC.takeoffPlan(j, [j], [], [], DC.MAX_BATCH + 1, 200).ok, 'пачка больше предела — отказ');
    assert(!DC.takeoffPlan(job({ dieId: '' }), [], [], [], 1, 200).ok, 'нет ножа — пробег некуда записать, отказ');
    assert(!DC.takeoffPlan(job({ status: 'Выполнено' }), [], [], [], 1, 200).ok, 'выполненное задание съёмов не принимает');
    assert(DC.jobProgress(job({ pullsPlan: 2 }), [cut('a', '1', 1), cut('b', '1', 1)], []).complete, 'план выполнен — complete');
})();

// ── 3. Пробег ножа ─────────────────────────────────────────────────────────
(function() {
    var runs = [
        { id: 'i', date: DAY - 86400 * 30, meters: 100000, kind: 'начальный остаток', jobId: '', dieId: 'D1' },
        cut('y', '9', 3000, DAY - 60),
        cut('t1', '1', 200, DAY + 60),
        cut('t2', '1', 200, NOW),
        cut('o', '1', 999, NOW, 'D2')
    ];
    var m = DC.dieMileageNow('D1', runs, DAY);
    assert(m.meters === 103400, 'пробег сейчас = начальный остаток + вся вырубка ножа', String(m.meters));
    assert(m.today === 400 && m.start === 103000, 'за смену — вырубка с полуночи по Москве; на начало смены — остальное', m.today + ' / ' + m.start);
    assert(DC.dieMileageNow('D3', runs, DAY).meters === 0, 'нож без движений — пробег 0');
})();

// ── 4. Остаток мастер-рулона ────────────────────────────────────────────────
(function() {
    // Остаток 589.8 при длине 2000: рулон початый в другом задании или на складе.
    var a = job({ rollLength: 2000, rollRest: '589.80' });
    assert(DC.rollRest(a, 200) === 389.8, 'остаток = текущий остаток − метры новых съёмов, а не длина − вырубка');
    assert(DC.rollRest(a, 2000) === 0, 'перерасход — остаток 0, не минус');
    assert(DC.rollRest(job({ rollRest: '' }), 100) === null, 'остаток рулона не задан — не считается');
    assert(DC.rollRest(job({ rollId: '' }), 100) === null, 'рулон не указан — остаток не считается');
    assert(DC.takeoffPlan(job({ status: 'В работе' }), [], [cut('r', '1', 200)], [], 0, 0).rest === null, 'дописать хвосты — остаток рулона не трогается (вычтен при съёме)');
})();

// ── 5. Оснастка для смены ───────────────────────────────────────────────────
(function() {
    var j = job({});
    var dies = [
        { id: 'D1', val: '1247', width: 58, length: 40, state: 'Рабочий' },
        { id: 'D2', val: '1712', width: 58, length: 40, state: 'Резерв' },
        { id: 'D3', val: '1800', width: 58, length: 40, state: '5:Списан' },
        { id: 'D4', val: '1900', width: 70, length: 40, state: 'Рабочий' }
    ];
    assert(DC.compatibleDies(j, dies).map(function(d) { return d.id; }).join() === 'D2', 'ножи для смены: тот же размер, не текущий, не списанный');
    var cyl = [{ id: 'C96', val: '96' }, { id: 'C104', val: '104' }, { id: 'C116', val: '116' }];
    assert(DC.compatibleCylinders(j, cyl, { cylinderIds: ['C96', 'C104'] }).map(function(c) { return c.id; }).join() === 'C104', 'валы: только допустимые для станка, кроме текущего');
    assert(DC.compatibleCylinders(j, cyl, { cylinderIds: [] }).length === 2, 'у станка список валов пуст — встаёт любой вал');
    assert(DC.changeNote('1712', '1247') === '1712 → 1247', 'примечание смены — «старое → новое»');
})();

// ── 6. Чек-лист и вызовы ИТС ────────────────────────────────────────────────
(function() {
    var items = [{ id: 'i1', val: 'Нож соответствует заданию' }, { id: 'i2', val: 'Первая этикетка сверена' }];
    var cl = DC.checklist(items, [{ id: 'm1', date: NOW, itemId: 'i1', operator: 'Иванов' }]);
    assert(cl.rows[0].checked && !cl.rows[1].checked && !cl.complete, 'отмеченный пункт виден, чек-лист не закрыт');
    assert(DC.checklistToMark(cl, ['i1', 'i2']).join() === 'i2', 'отмеченный пункт повторно не пишется');
    assert(DC.checklist(items, [{ itemId: 'i1', date: 1 }, { itemId: 'i2', date: 2 }]).complete, 'все пункты отмечены — чек-лист закрыт');
    assert(!DC.checklist([], []).complete, 'пунктов нет — чек-лист не считается закрытым');
    var calls = [
        { id: 'c1', date: NOW - 60, machineId: 'M1', status: 'открыт' },
        { id: 'c2', date: NOW, machineId: 'M1', status: 'принят' },
        { id: 'c3', date: NOW, machineId: 'M1', status: 'закрыт' },
        { id: 'c4', date: NOW, machineId: 'M2', status: 'открыт' }
    ];
    assert(DC.openCalls(calls, 'M1').map(function(c) { return c.id; }).join() === 'c2,c1', 'вызовы ИТС станка: незакрытые, свежие сверху');
})();

// ── 7. Таблицы ИТС по декларации схемы ──────────────────────────────────────
(function() {
    var schema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'atex_p2_die_cutter_schema_5326.json'), 'utf8'));
    var id = 100;
    var meta = [];
    (function walk(list) {
        (list || []).forEach(function(t) {
            var reqs = (t.fields || []).map(function(f) {
                var r = { id: String(++id), val: f.ref || f.name };
                if (f.ref && f.ref !== f.name) r.field_attrs = { alias: f.name };
                return r;
            });
            meta.push({ id: String(++id), val: t.name, reqs: reqs });
            walk(t.children);
        });
    })(schema.tables);
    var res = DC.resolveItsTables(meta);
    assert(res.missing.length === 0, 'все таблицы и колонки ИТС пульта есть в декларации схемы', res.missing.join('; '));
    assert(res.tables.itsCall && res.tables.itsCall.reqs.operator, '«Вызов ИТС → Оператор» — ссылка на пользователя под псевдонимом');
    var bare = meta.map(function(t) { return { id: t.id, val: t.val, reqs: t.reqs.map(function(r) { return { id: r.id, val: r.val }; }) }; });
    assert(DC.resolveItsTables(bare).missing.length === 0, 'псевдоним «Оператор» потерян — колонка находится по имени типа «Пользователь»');
    assert(DC.resolveItsTables([]).missing.length === 3, 'таблиц нет — названы все три');
})();

// ── Отчёт → задания ─────────────────────────────────────────────────────────
(function() {
    var rows = [{ job_id: '1001523', job_start: '1790226000', job_status: 'Выполнено', pulls_plan: '44', pulls_fact: '44', footage: '88000.00', die_id: '1000357', die_no: '736116', die_streams: '4', master_roll_id: '1000300', roll_length: '4000' }, { job_id: '' }];
    var jobs = DC.jobsFromReport(rows);
    assert(jobs.length === 1 && jobs[0].pullsPlan === 44 && jobs[0].footage === 88000 && jobs[0].streams === 4, 'строка отчёта → задание с числами; строка без id отброшена');
    assert(DC.refIds({ reqs: { ref_5: '1000012:1000189,1000191' } }, '5').join() === '1000189,1000191', 'множественная ссылка → список id');
})();

console.log('\n' + passed + '/' + total + ' проверок пройдено.');
