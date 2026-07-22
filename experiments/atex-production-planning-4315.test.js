// #4315 — «дырка полчаса» после первого задания дня: заправка станка теряла КОЛИЧЕСТВО полос.
//
// Диагноз на боевых данных (ateh, Станок 3, 22.07): вчерашняя резка 625865 и первая сегодняшняя
// 636043 — обе MWR113L(2208) OUT с полосами 110 мм × 8, переставлять нечего. Хранимые колонки так и
// пишут: «Наладка ножей» 636043 = 0. А упаковщик брал заправку станка из отчёта prev_cut_setup, где
// строка = ПОЛОСА, и количество (batch_count) не читалось: 8 полос по 110 мм превращались в ОДИН нож.
// Против сегодняшних восьми это «переставить 7» → бинарная переналадка ножей KNIFE = 30 мин, на
// которую упаковщик сдвинул planStart следующего задания. В колонках этих 30 минут нет — отсюда
// пустые полчаса между 09:06 и 09:36, которых «не может быть, раз наладка записана»: она и не была
// записана, стороны считали ножи ОДНОЙ И ТОЙ ЖЕ вчерашней резки по разным источникам.
//
// Фикс: prevSetupFromRows разворачивает ширину по batch_count — ровно как aggregateStrips
// разворачивает strip_qty у cut_strips (сверено на боевых данных: batch_count == strip_qty по всем
// задачам). Отчёт старого формата (без колонки) → 1 полоса, поведение прежнее.
//
// Run with: node experiments/atex-production-planning-4315.test.js

process.env.TZ = 'UTC';
var planning = require('../download/atex/js/production-planning.js').planning;

var passed = 0, total = 0;
function assert(cond, name) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}
function eqo(a, e, name) {
    var ok = JSON.stringify(a) === JSON.stringify(e);
    assert(ok, name + (ok ? '' : '\n  ожидалось ' + JSON.stringify(e) + '\n  получено  ' + JSON.stringify(a)));
}

// Времена из таблицы «Время операции, мин» (ateh): ножи 30, смена сырья/намотки 15.
var TIMES = { KNIFE: 30, MATERIAL_WINDING: 15, BETWEEN_CUTS: 2 };

// ── 1) Количество полос разворачивается в ножи ───────────────────────────────────────────────────
(function () {
    // Форма строк — как отдаёт отчёт (боевой ответ ateh: одна строка на полосу + batch_count).
    var rows = [
        { task_start: '1784610000', slitter_id: '1282', task_id: '625865', wind_dir: 'OUT',
          batch_ord: '1', width: '110.00', material_id: '2208', batch_count: '8' }
    ];
    eqo(planning.prevSetupFromRows(rows, '1282'),
        { materialId: '2208', winding: 'OUT',
          knifeWidths: [110, 110, 110, 110, 110, 110, 110, 110], knifeCount: 8 },
        '#4315: одна строка 110 мм × batch_count 8 → 8 ножей (было: 1)');

    // Несколько полос разной ширины — каждая по своему количеству (боевая задача 636453).
    var multi = [
        { task_start: '1784796540', slitter_id: '1279', task_id: '636453', wind_dir: 'OUT',
          batch_ord: '1', width: '154.00', material_id: '1253', batch_count: '5' },
        { task_start: '1784796540', slitter_id: '1279', task_id: '636453', wind_dir: 'OUT',
          batch_ord: '2', width: '110.00', material_id: '1253', batch_count: '1' }
    ];
    eqo(planning.prevSetupFromRows(multi, '1279'),
        { materialId: '1253', winding: 'OUT', knifeWidths: [154, 154, 154, 154, 154, 110], knifeCount: 6 },
        '#4315: полосы разной ширины разворачиваются каждая по своему количеству (154×5 + 110×1)');
})();

// ── 2) Совместимость: отчёт без колонки / с мусором → одна полоса (прежнее поведение) ────────────
(function () {
    function row(extra) {
        var r = { task_start: '1000', slitter_id: '1', task_id: 'T1', wind_dir: 'IN',
                  batch_ord: '1', width: '55.00', material_id: '39014' };
        if (extra) Object.keys(extra).forEach(function (k) { r[k] = extra[k]; });
        return r;
    }
    eqo(planning.prevSetupFromRows([row()], '1').knifeCount, 1,
        '#4315: отчёт СТАРОГО формата (нет batch_count) → 1 полоса, как раньше');
    eqo(planning.prevSetupFromRows([row({ batch_count: '' })], '1').knifeCount, 1, '#4315: пустое количество → 1');
    eqo(planning.prevSetupFromRows([row({ batch_count: '0' })], '1').knifeCount, 1, '#4315: количество 0 → 1');
    eqo(planning.prevSetupFromRows([row({ batch_count: 'abc' })], '1').knifeCount, 1, '#4315: нечисловое количество → 1');
    eqo(planning.prevSetupFromRows([row({ batch_count: '-3' })], '1').knifeCount, 1, '#4315: отрицательное количество → 1');
    eqo(planning.prevSetupFromRows([row({ batch_count: 3 })], '1').knifeCount, 3, '#4315: количество числом (не строкой) → 3');
})();

// ── 3) Эффект: фантомная переналадка ножей исчезает (та самая «дыра в полчаса») ──────────────────
(function () {
    // Боевой случай: станок заправлен вчерашней резкой 110×8, сегодня первая резка — те же 110×8.
    var today = { id: '636043', materialId: '2208', winding: 'OUT', batchId: 'b1', rollerWidth: 0,
                  knifeWidths: [110, 110, 110, 110, 110, 110, 110, 110], knifeCount: 8 };
    var rows = [{ task_start: '1784610000', slitter_id: '1282', task_id: '625865', wind_dir: 'OUT',
                  batch_ord: '1', width: '110.00', material_id: '2208', batch_count: '8' }];
    function setupMin(setup) {
        return planning.changeoverParts(planning.carryOverPrevCut(setup, today), today, TIMES)
            .reduce(function (s, p) { return s + p.minutes; }, 0);
    }
    // Как было (количество отброшено): 1 нож против 8 → переставить 7 → KNIFE 30.
    var stale = { materialId: '2208', winding: 'OUT', knifeWidths: [110], knifeCount: 1 };
    assert(setupMin(stale) === 30,
        '#4315 (демонстрация): заправка в ОДИН нож против 8 → фантомные 30 мин наладки = наблюдаемая дыра');
    // Как стало: заправка развёрнута по количеству → наборы ножей совпадают → 0.
    assert(setupMin(planning.prevSetupFromRows(rows, '1282')) === 0,
        '#4315 (фикс): заправка 110×8 против 110×8 → переналадки нет (0), сходится с хранимой наладкой 0');

    // Реальная смена ножей по-прежнему считается: сегодня другая ширина.
    var other = { id: 'X', materialId: '2208', winding: 'OUT', batchId: 'b1', rollerWidth: 0,
                  knifeWidths: [95, 95, 95, 95, 95, 95, 95, 95], knifeCount: 8 };
    var parts = planning.changeoverParts(
        planning.carryOverPrevCut(planning.prevSetupFromRows(rows, '1282'), other), other, TIMES);
    assert(parts.length === 1 && parts[0].code === 'KNIFE' && parts[0].minutes === 30,
        '#4315: настоящая смена ножей (110×8 → 95×8) по-прежнему стоит 30 мин');
})();

console.log('\n' + passed + '/' + total + ' passed');
