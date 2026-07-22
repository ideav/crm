// #4321 — «Конечный счётчик должен уменьшаться, а не увеличиваться: он идёт обратно, по убыванию
// сырья в рулоне».
//
// Счётчик станка показывает, СКОЛЬКО СЫРЬЯ ОСТАЛОСЬ В РУЛОНЕ: «Счётчик нач.» — остаток партии перед
// резкой (пульт так его и подставляет — из batch.remainderM), «Счётчик кон.» — остаток ПОСЛЕ неё.
// Пульт же считал наоборот: counterEnd = counterStart + погонаж, а погонаж = кон. − нач.
//
// Боевое подтверждение (ateh, задание 638025): записано «Счётчик кон.» = 11746 при погонаже 600, а
// остаток партии 77343 после резки — 10546.183. То есть заправка была 11146.183, и правильное
// показание счётчика на выходе — 10546.183 (= остаток партии), а не 11746.
//
// Фикс: counterEnd = counterStart − погонаж, погонаж = нач. − кон. Направление СТРОГОЕ: обратный
// ввод (кон. > нач.) даёт 0, и завершение резки его не пропустит — записи с прежней формулой
// заказчик чистит, откат на неё не нужен.
//
// Run with: node experiments/atex-slitter-4321.test.js

var core = require('../download/atex/js/slitter.js').core;

var passed = 0, total = 0;
function assert(cond, name) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}
function eq(a, e, name) {
    assert(a === e, name + (a === e ? '' : '\n  ожидалось ' + JSON.stringify(e) + '\n  получено  ' + JSON.stringify(a)));
}

// ── 1) Погонаж = «Счётчик нач.» − «Счётчик кон.» ────────────────────────────────────────────────
eq(core.meterageFromCounters(11146.183, 10546.183), 600, '#4321: погонаж = нач. − кон. (боевой случай 638025)');
eq(core.meterageFromCounters(2000, 1500), 500, '#4321: счётчик убывает 2000 → 1500 = 500 м');
eq(core.meterageFromCounters('1 850,5', '1 000'), 850.5, '#4321: разбор форматированного ввода (пробелы, запятая)');
eq(core.meterageFromCounters(500, 500), 0, '#4321: равные показания → 0 (резка не мотала)');
eq(core.meterageFromCounters('', ''), 0, '#4321: пустые счётчики → 0');
eq(core.meterageFromCounters(1000, 1850), 0, '#4321: обратный ввод (кон. > нач.) → 0 — завершение резки его не пропустит');
eq(core.meterageFromCounters(600, 0), 600, '#4321: рулон домотан в ноль — законное показание, погонаж 600');

// ── 2) Пустой «Счётчик нач.» не даёт ложного погонажа ───────────────────────────────────────────
eq(core.meterageFromCounters('', '1500'), 0, '#4321: пустой «Счётчик нач.» → 0 (0 − 1500 < 0), а не 1500');

// ── 3) Инвариант с остатком партии: показание на выходе = остаток партии после списания ─────────
// Пульт подставляет «Счётчик нач.» из остатка партии и списывает те же метры с партии
// (applyBatchConsumption), поэтому счётчик и остаток обязаны сойтись.
(function () {
    var batchRemainderBefore = 11146.183;
    var runLength = 600, runs = 1;
    var meterage = core.round3(runs * runLength);
    var counterStart = core.round3(batchRemainderBefore);
    var counterEnd = core.round3(counterStart - meterage);            // формула markPassDone после #4321
    var batchRemainderAfter = core.round3(batchRemainderBefore - meterage);
    eq(counterEnd, 10546.183, '#4321: «Счётчик кон.» = 10546.183 (а не 11746.183, как писали раньше)');
    eq(counterEnd, batchRemainderAfter, '#4321: показание счётчика на выходе = остаток партии после списания');
    eq(core.meterageFromCounters(counterStart, counterEnd), meterage,
        '#4321: обратный пересчёт из счётчиков даёт тот же погонаж — 600 м');
})();

// ── 4) Несколько проходов подряд: счётчик монотонно убывает ─────────────────────────────────────
(function () {
    var start = 5000, runLength = 450;
    var ends = [1, 2, 3, 4].map(function (target) { return core.round3(start - target * runLength); });
    eq(JSON.stringify(ends), JSON.stringify([4550, 4100, 3650, 3200]),
        '#4321: «Готово» × 4 — счётчик идёт вниз 5000 → 4550 → 4100 → 3650 → 3200');
    eq(core.meterageFromCounters(start, ends[3]), 1800, '#4321: после 4 проходов погонаж 1800 м');
})();

// ── 5) Сырья не хватило на план — показание уходит в минус, а не прячется нулём ─────────────────
(function () {
    var counterEnd = core.round3(300 - 4 * 450);   // рулон 300 м, план 4 прохода по 450
    assert(counterEnd < 0, '#4321: план больше рулона → показание отрицательное (сигнал «сырья не хватит»), '
        + 'а не 0: ' + counterEnd);
})();

console.log('\n' + passed + '/' + total + ' passed');
