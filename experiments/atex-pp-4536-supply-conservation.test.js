// Tests for ideav/crm#4536 — ОБЕСПЕЧЕНИЕ НЕ ТЕРЯЕТСЯ: сумма по всем заданиям равна заказу.
//
// Боевая ateh1, 31.07.2026. Заказ 4404 (позиции 645083 «110мм × 450м, 112 шт.» и 645084
// «85мм × 450м, 1008 шт.») выпускается ОДНИМ заданием 651326: раскрой 9 полос по 85 + 1 полоса
// по 110, «Кол-во резок план» = 100. Выпуск = 900 и 100 штук при заказанных 1008 и 112 —
// заказ недообеспечен на 12 проходов, и на экране это «найдено только 1 задание, а количество
// меньше заказа». У «Обеспечений» обеих позиций «Кол-во рулонов» = 0, хотя у здоровых позиций
// базы там реальные числа (80, 900, 56, 132…).
//
// ДВА КОРНЯ, оба закрываются здесь:
//   1) ДАННЫЕ. Отчёт cut_planning колонки «Кол-во рулонов» не отдаёт, а `rowsToPlanning` читал
//      её через stripNum(undefined) → 0. Пути записи разбиения по дням делят это «количество»
//      между сегментами (splitSupplyShares) и пишут результат: 0 у головы, 0 у продолжений.
//      Хранимое количество заказа стиралось при каждом сохранении плана. Неизвестное значение
//      обязано быть НЕИЗВЕСТНЫМ (null) и в базу не уезжать (ТЗ §14: нет данных — говорим).
//   2) ШЛЮЗ. `guardPlanOps` отбрасывает операции ПООДИНОЧКЕ. Задание, разорванное по дням, —
//      это update головы (сколько проходов осталось в её дне) ПЛЮС create продолжения (остаток).
//      Выбросив только create, шлюз оставлял голове урезанные проходы, а остаток не создавал
//      никогда: работа исчезала вместе с обеспечением. Операции одного задания живут или
//      отбрасываются ВМЕСТЕ.
//
// Правило ТЗ §15 (жёсткое): выпуск позиции по итоговому плану (Σ полос × проходов по всем
// заданиям) не меньше заказанного количества — `SUPPLY_CONSERVED` в реестре инвариантов.
//
// Run with: node experiments/atex-pp-4536-supply-conservation.test.js

process.env.TZ = 'UTC';
global.window = { db: 'testdb', xsrf: 'x' };
var planning = require('../download/atex/js/production-planning.js').planning;

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

// ── Фикстура: строки отчёта cut_planning по заказу 4404 (как их отдаёт боевая ateh1) ─────────
// Колонки рулонов обеспечения в отчёте НЕТ — ровно поэтому и стиралось количество.
function planningRow(over) {
    var row = {
        cut_id: '651326', cut_plan_date: '1785301200', cut_slitter: 'Станок 3', cut_slitter_id: '1282',
        cut_planned_runs: '100', cut_length: '450.00', cut_duration: '180',
        cut_material: 'MW308', cut_material_id: '1253', cut_winding: 'OUT',
        supply_id: '651360', supply_position_id: '645084', supply_finished_batch_id: '651343',
        supply_footage: '413.839', position_length: '450.00', cut_roller_width: '85.00',
        order_id: '645082', order_no: '4404', cut_first_part: '651326'
    };
    Object.keys(over || {}).forEach(function(k) { row[k] = over[k]; });
    return row;
}

// ── 1. Модель: неизвестное количество — это null, а не 0 ────────────────────────────────────
(function() {
    var p = planning.rowsToPlanning([planningRow()]);
    var s = (p.supplies || [])[0];
    assert(s && s.rolls === null,
        '#4536 отчёт без колонки рулонов: «Кол-во рулонов» обеспечения = null (не знаем), а не 0',
        'rolls=' + JSON.stringify(s && s.rolls));
    assert(s && Math.abs(s.footage - 413.839) < 0.001,
        '#4536 метраж обеспечения читается как прежде', 'footage=' + (s && s.footage));
})();

(function() {
    // Колонка появилась (её можно добавить в отчёт) — читаем число.
    var p = planning.rowsToPlanning([planningRow({ supply_rolls: '1008' })]);
    var s = (p.supplies || [])[0];
    assert(s && s.rolls === 1008, '#4536 колонка рулонов есть — читаем число', 'rolls=' + (s && s.rolls));
})();

// ── 2. Диагностика отчёта: молча подставлять нечего (ТЗ §14) ────────────────────────────────
(function() {
    var d = planning.supplyRollsReportDiagnostic([planningRow()]);
    assert(d && /Кол-во рулонов/.test(String(d.message)),
        '#4536 отчёт без колонки рулонов: диагностика называет пропавшую колонку',
        d && d.message);
    assert(!planning.supplyRollsReportDiagnostic([planningRow({ supply_rolls: '1008' })]),
        '#4536 колонка на месте — о ней не говорим');
    // Сигналы, без которых очередь не построить, живут отдельно: их состав мы не трогаем.
    var core = planning.cutPlanningReportDiagnostics([planningRow()]) || [];
    assert(core.length === 0,
        '#4536 колонка количества — не «ошибка отчёта»: очередь строится и без неё',
        'сообщения=[' + core.map(function(x) { return x.message; }).join(' | ') + ']');
})();

// ── 3. Доли разбиения не выдумывают количество ──────────────────────────────────────────────
(function() {
    var shares = planning.splitSupplyShares(null, 450, [100, 12]);
    assert(shares.length === 2 && shares[0].rolls === null && shares[1].rolls === null,
        '#4536 рулоны неизвестны → доли сегментов тоже неизвестны (null), а не нули',
        JSON.stringify(shares));
    assert(Math.abs((shares[0].footage + shares[1].footage) - 450) < 0.001,
        '#4536 метраж по-прежнему делится пропорционально проходам (сумма цела)',
        JSON.stringify(shares.map(function(s) { return s.footage; })));
    var known = planning.splitSupplyShares(1008, 450, [100, 12]);
    assert(known[0].rolls + known[1].rolls === 1008,
        '#4536 известное количество делится без потери (сумма долей = исходной)',
        JSON.stringify(known.map(function(s) { return s.rolls; })));
})();

// ── 4. Запись: неизвестное количество в базу не уезжает ─────────────────────────────────────
(function() {
    var supMeta = { id: '1077', val: 'Обеспечение', reqs: [
        { id: '1149', val: 'Метраж, м' }, { id: '1154', val: 'В работе' },
        { id: '15016', val: 'Партия ГП' }, { id: '16424', val: 'Кол-во рулонов' }
    ] };
    var unknown = planning.buildSupplyFieldsForFinishedBatch(supMeta,
        { finishedBatchId: '651343', footage: 413.839, rolls: null, active: '1' });
    assert(!Object.prototype.hasOwnProperty.call(unknown, 't16424'),
        '#4536 рулоны неизвестны → поля «Кол-во рулонов» в запросе НЕТ (хранимое не трогаем)',
        JSON.stringify(unknown));
    var known = planning.buildSupplyFieldsForFinishedBatch(supMeta,
        { finishedBatchId: '651343', footage: 413.839, rolls: 900, active: '1' });
    assert(known.t16424 === 900,
        '#4536 известное количество пишется как прежде', JSON.stringify(known));
})();

// ── 5. Шлюз не рвёт задание пополам ─────────────────────────────────────────────────────────
// Голова 651326 стои́т в свободном дне, её продолжение попадает в ЗАМОРОЖЕННЫЙ — create отбросит
// FROZEN_DAY. Если оставить update головы (100 проходов вместо хранимых 112), 12 проходов
// исчезнут вместе с обеспечением. Операции задания уезжают вместе.
(function() {
    var FROZEN_DAY_KEY = 20260730, FREE_DAY_KEY = 20260729;
    var TS_FROZEN = Math.floor(Date.UTC(2026, 6, 30, 8, 0, 0) / 1000);
    var TS_FREE = Math.floor(Date.UTC(2026, 6, 29, 8, 0, 0) / 1000);
    function dayKeyOf(ts) {
        var d = new Date(Number(ts) * 1000);
        return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
    }
    var STORED = { '651326': { chainId: '651326', runs: 112, day: FREE_DAY_KEY } };
    var ctx = {
        isFrozenCut: function(id) { return (STORED[String(id)] || {}).day === FROZEN_DAY_KEY; },
        isFrozenTs: function(ts) { return dayKeyOf(ts) === FROZEN_DAY_KEY; },
        isFixedCut: function() { return false; },
        dayKeyOfCut: function(id) { var s = STORED[String(id)]; return s ? s.day : null; },
        dayKeyOfTs: function(ts) { return dayKeyOf(ts); },
        chainIdOfCut: function(id) { var s = STORED[String(id)]; return s ? s.chainId : null; },
        plannedRunsOfCut: function(id) { var s = STORED[String(id)]; return s ? s.runs : null; }
    };
    var ops = {
        updates: [{ cutId: '651326', plannedRuns: 100, planStartTs: TS_FREE }],
        creates: [{ parentCutId: '651326', plannedRuns: 12, planStartTs: TS_FROZEN }],
        deletes: []
    };
    var g = planning.guardPlanOps(ops, ctx, 'auto');
    assert(g.ops.creates.length === 0, '#4536 продолжение в замороженный день отброшено (как и было)');
    assert(g.ops.updates.length === 0,
        '#4536 вместе с продолжением отброшена и голова — задание остаётся хранимым целым',
        'updates=' + JSON.stringify(g.ops.updates));
    assert((g.restoredChains || []).indexOf('651326') >= 0,
        '#4536 шлюз называет задание, чьи операции возвращены целиком',
        'restoredChains=' + JSON.stringify(g.restoredChains || []));
})();

(function() {
    // Обратная сторона: если ничего не отброшено, шлюз не трогает НИЧЕГО (разбиение по дням —
    // законная операция: 112 = 100 + 12).
    var TS_A = Math.floor(Date.UTC(2026, 6, 29, 8, 0, 0) / 1000);
    var TS_B = Math.floor(Date.UTC(2026, 6, 31, 8, 0, 0) / 1000);
    var ctx = {
        chainIdOfCut: function() { return '651326'; },
        plannedRunsOfCut: function(id) { return String(id) === '651326' ? 112 : null; }
    };
    var ops = {
        updates: [{ cutId: '651326', plannedRuns: 100, planStartTs: TS_A }],
        creates: [{ parentCutId: '651326', plannedRuns: 12, planStartTs: TS_B }],
        deletes: []
    };
    var g = planning.guardPlanOps(ops, ctx, 'auto');
    assert(g.ops.updates.length === 1 && g.ops.creates.length === 1 && g.skipped === 0,
        '#4536 законное разбиение по дням шлюз не трогает',
        'updates=' + g.ops.updates.length + ' creates=' + g.ops.creates.length + ' skipped=' + g.skipped);
})();

// ── 6. Правило SUPPLY_CONSERVED видит недообеспеченную позицию ──────────────────────────────
(function() {
    // Боевой случай 4404: 9 полос по 85 мм и 1 полоса по 110 мм, 100 проходов вместо 112.
    var LINKS = [
        { cutId: '651326', positionId: '645084', rollsPerRun: 9 },
        { cutId: '651326', positionId: '645083', rollsPerRun: 1 }
    ];
    var DEMAND = {
        '645084': { qty: 1008, orderNo: '4404', width: 85 },
        '645083': { qty: 112, orderNo: '4404', width: 110 }
    };
    function ctxWith(storedRuns) {
        return {
            coverageLinks: function() { return LINKS; },
            positionDemand: function() { return DEMAND; },
            plannedRunsOfCut: function(id) { return String(id) === '651326' ? storedRuns : null; },
            chainIdOfCut: function() { return '651326'; }
        };
    }
    var short = planning.checkPlanInvariants({ updates: [{ cutId: '651326', plannedRuns: 100 }], creates: [], deletes: [] },
        ctxWith(112), 'auto').filter(function(v) { return v.rule === 'SUPPLY_CONSERVED'; });
    assert(short.length === 2, '#4536 недообеспеченные позиции названы обе', 'нарушений=' + short.length);
    var by = {};
    short.forEach(function(v) { by[String(v.positionId)] = v; });
    assert(by['645084'] && by['645084'].ordered === 1008 && by['645084'].produced === 900 && by['645084'].shortRolls === 108,
        '#4536 позиция 85 мм: заказано 1008, выпуск 900, не хватает 108', JSON.stringify(by['645084']));
    assert(by['645083'] && by['645083'].shortRolls === 12,
        '#4536 позиция 110 мм: не хватает 12', JSON.stringify(by['645083']));

    // Полный план (112 проходов) правило не трогает.
    var full = planning.checkPlanInvariants({ updates: [{ cutId: '651326', plannedRuns: 112 }], creates: [], deletes: [] },
        ctxWith(112), 'auto').filter(function(v) { return v.rule === 'SUPPLY_CONSERVED'; });
    assert(full.length === 0, '#4536 полный выпуск нарушением не считается', 'нарушений=' + full.length);

    // Излишек (проходы дают больше заказанного — остаток на склад) — тоже норма.
    var over = planning.checkPlanInvariants({ updates: [{ cutId: '651326', plannedRuns: 120 }], creates: [], deletes: [] },
        ctxWith(112), 'auto').filter(function(v) { return v.rule === 'SUPPLY_CONSERVED'; });
    assert(over.length === 0, '#4536 излишек (на склад) нарушением не считается', 'нарушений=' + over.length);

    // Продолжение добирает недостающее — считаем ВСЮ цепочку, а не одну запись.
    var withCont = planning.checkPlanInvariants({
        updates: [{ cutId: '651326', plannedRuns: 100 }],
        creates: [{ parentCutId: '651326', plannedRuns: 12 }], deletes: []
    }, ctxWith(112), 'auto').filter(function(v) { return v.rule === 'SUPPLY_CONSERVED'; });
    assert(withCont.length === 0,
        '#4536 голова + продолжение вместе дают заказ — нарушения нет', 'нарушений=' + withCont.length);

    // Удаление задания без замены — позиция остаётся без обеспечения, и об этом говорят.
    var deleted = planning.checkPlanInvariants({ updates: [], creates: [], deletes: ['651326'] },
        ctxWith(112), 'auto').filter(function(v) { return v.rule === 'SUPPLY_CONSERVED'; });
    assert(deleted.length === 2 && deleted[0].produced === 0,
        '#4536 удалили единственное задание — позиции недообеспечены целиком',
        JSON.stringify(deleted.map(function(v) { return v.produced; })));
})();

// ── 7. Покрытие позиции считается по ВЫПУСКУ, когда количество неизвестно ───────────────────
// Иначе «+ позиция» и форма нового задания видят заказ 4404 либо необеспеченным целиком (rolls
// читались нулём), либо обеспеченным целиком (неизвестное приняли за покрытие) — оба ответа
// неверны, а недостача в 108 штук не видна ни в одном.
(function() {
    var supplies = [
        { id: '651360', positionId: '645084', cutId: '651326', finishedBatchId: '651343', rolls: null, footage: 413.839 },
        { id: '651362', positionId: '645083', cutId: '651326', finishedBatchId: '651344', rolls: null, footage: 413.839 }
    ];
    var produced = planning.producedRollsByPosition(supplies, { '651343': 9, '651344': 1 }, { '651326': 100 });
    assert(produced['645084'] === 900 && produced['645083'] === 100,
        '#4536 выпуск позиции = полосы × проходы', JSON.stringify(produced));
    var rem = planning.remainingRollsForPosition({ id: '645084', qty: 1008 }, supplies, produced);
    assert(rem === 108, '#4536 необеспеченный остаток позиции — 108 шт. (а не 0 и не 1008)', 'остаток=' + rem);
    var covered = planning.remainingRollsForPosition({ id: '645083', qty: 100 }, supplies, produced);
    assert(covered === 0, '#4536 полностью выпущенная позиция остатка не имеет', 'остаток=' + covered);
    // Хранимое количество известно — считаем по нему, как и раньше.
    var known = planning.remainingRollsForPosition({ id: 'p1', qty: 100 },
        [{ id: 's1', positionId: 'p1', cutId: 'c1', finishedBatchId: 'b1', rolls: 40 }], {});
    assert(known === 60, '#4536 известное количество обеспечения считается как прежде', 'остаток=' + known);
})();

// ── 8. Фраза оператору ──────────────────────────────────────────────────────────────────────
(function() {
    var msg = planning.formatPlanAuditMessage([{ rule: 'SUPPLY_CONSERVED', cutId: '651326',
        positionId: '645084', orderNo: '4404', width: 85, ordered: 1008, produced: 900, shortRolls: 108 }]);
    assert(msg && /4404/.test(msg.text) && /108/.test(msg.text),
        '#4536 оператору называют заказ и сколько штук не хватает', msg && msg.text);
})();

console.log('\n' + passed + '/' + total + ' проверок пройдено');
