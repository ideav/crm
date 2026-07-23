// #4326 — «замок дня» (заморозка): планирование не трогает замороженные дни.
// Замороженный день неприкосновенен «для всех станков»: (1) его задания НЕ пере-планируются —
// исключаются из входа планировщика (frozenDayCutsToKeep, как #4294 для прошлых дней), остаются
// ровно как сохранены; (2) сам день блокируется для НОВЫХ размещений — целиком, через
// frozenBlockedRanges (та же ось минут, что calendarBlockedRanges #3788 / blockedRanges #3764).
//
// Здесь покрываем ЧИСТЫЕ помощники:
//   • frozenDayCutsToKeep(cuts, freezeByDay) — id записей, которые НЕ подаём в планировщик;
//   • frozenBlockedRanges(freezeByDay, baseMidnightMs, horizonDays) — блокированные интервалы дней.
//
// Run with: node experiments/atex-production-planning-4326.test.js

process.env.TZ = 'UTC';
var planning = require('../download/atex/js/production-planning.js').planning;
var keep = planning.frozenDayCutsToKeep;
var blocks = planning.frozenBlockedRanges;

var passed = 0, total = 0;
function eqSet(actual, expected, name) {
    total++;
    var a = (actual || []).slice().map(String).sort();
    var e = (expected || []).slice().map(String).sort();
    var ok = JSON.stringify(a) === JSON.stringify(e);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) passed++;
    else { console.log('  ожидалось (без порядка):', JSON.stringify(e), '\n  получено: ', JSON.stringify(a)); process.exitCode = 1; }
}
function eqJson(actual, expected, name) {
    total++;
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) passed++;
    else { console.log('  ожидалось:', JSON.stringify(expected), '\n  получено: ', JSON.stringify(actual)); process.exitCode = 1; }
}

function midnight(y, m, d) { return new Date(y, m - 1, d, 0, 0, 0, 0).getTime(); }
function fkey(y, m, d) { return y * 10000 + m * 100 + d; }
function scut(id, dayTs, o) {
    o = o || {};
    return { id: id, firstPartId: o.fp != null ? o.fp : id, slitter: { id: o.m || 'm1' },
             materialId: o.mat || 'A', winding: o.w || 'OUT', knifeWidths: o.kw || [50], knifeCount: 1,
             rollerWidth: 0, orderId: o.ord != null ? o.ord : 'O_' + id,
             planDate: dayTs == null ? '' : String(Math.floor(dayTs / 1000)), fixed: !!o.fixed,
             plannedRuns: o.runs != null ? o.runs : 2 };
}

var BASE = midnight(2026, 7, 22);   // «С» = 22.07 = день 0
var D22 = midnight(2026, 7, 22), D23 = midnight(2026, 7, 23), D24 = midnight(2026, 7, 24), D25 = midnight(2026, 7, 25);

// ── frozenDayCutsToKeep ─────────────────────────────────────────────────────────────────────────

// Заморожен 23.07 → задания 23.07 исключаем; прочие дни — оставляем во входе.
(function () {
    var cuts = [
        scut('A22', D22, {}),                 // 22.07 — НЕ заморожен → остаётся
        scut('B23', D23, {}),                 // 23.07 — ЗАМОРОЖЕН → исключаем
        scut('C23', D23, { m: 'm2' }),        // 23.07 другой станок — тоже исключаем (для всех станков)
        scut('D24', D24, {}),                 // 24.07 — НЕ заморожен → остаётся
        scut('New', null, {})                 // без «Даты план» → остаётся
    ];
    var fb = {}; fb[fkey(2026, 7, 23)] = { id: '900', notes: 'инвентаризация' };
    eqSet(keep(cuts, fb), ['B23', 'C23'],
        '#4326: исключаем задания замороженного дня для ВСЕХ станков; прочие дни/новые — остаются');
})();

// Цепочка дробления с головой на замороженном дне — исключаем ЦЕЛИКОМ (голова 23.07 + продолжение 24.07).
(function () {
    var cuts = [
        scut('H', D23, { fp: 'H' }),          // голова 23.07 (заморожен)
        scut('K', D24, { fp: 'H' }),          // продолжение 24.07 (НЕ заморожен) — но цепочку не рвём
        scut('N', D24, {})                    // независимое 24.07 — остаётся
    ];
    var fb = {}; fb[fkey(2026, 7, 23)] = { id: '901', notes: '' };
    eqSet(keep(cuts, fb), ['H', 'K'],
        '#4326: цепочка с головой на замороженном дне исключается ЦЕЛИКОМ (не осиротить продолжение)');
})();

// Заморожен день, которого нет ни у одной резки → ничего не исключаем. Пустая карта → [].
(function () {
    var cuts = [scut('A22', D22, {}), scut('B24', D24, {})];
    var fb = {}; fb[fkey(2026, 7, 23)] = { id: '902', notes: '' };
    eqSet(keep(cuts, fb), [], '#4326: заморожен день без заданий — ничего не исключаем');
    eqSet(keep(cuts, {}), [], '#4326: пустая карта заморозки — ничего не исключаем');
})();

// Замок 🔒 на задании (fixed) не мешает исключению: заморожен день — исключаем и зафиксированное.
(function () {
    var cuts = [scut('F23', D23, { fixed: true })];
    var fb = {}; fb[fkey(2026, 7, 23)] = { id: '903', notes: '' };
    eqSet(keep(cuts, fb), ['F23'], '#4326: заморозка сильнее — исключаем даже зафиксированное задание дня');
})();

// ── frozenBlockedRanges ─────────────────────────────────────────────────────────────────────────

// Один замороженный день на смещении k от базы → [[k*1440, (k+1)*1440]].
(function () {
    var fb = {}; fb[fkey(2026, 7, 23)] = { id: '910' };   // 23.07 = день 1 от базы 22.07
    eqJson(blocks(fb, BASE, 30), [[1 * 1440, 2 * 1440]],
        '#4326: замороженный день k=1 → блок [1440, 2880]');
})();

// Два смежных замороженных дня сливаются в один интервал.
(function () {
    var fb = {}; fb[fkey(2026, 7, 23)] = { id: '911' }; fb[fkey(2026, 7, 24)] = { id: '912' };
    eqJson(blocks(fb, BASE, 30), [[1 * 1440, 3 * 1440]],
        '#4326: смежные замороженные дни (23–24.07) сливаются в один блок [1440, 4320]');
})();

// Несмежные замороженные дни — два отдельных интервала.
(function () {
    var fb = {}; fb[fkey(2026, 7, 23)] = { id: '913' }; fb[fkey(2026, 7, 25)] = { id: '914' };
    eqJson(blocks(fb, BASE, 30), [[1 * 1440, 2 * 1440], [3 * 1440, 4 * 1440]],
        '#4326: несмежные дни (23 и 25.07) → два блока');
})();

// Пустая карта → []; день за горизонтом → не блокируется; нечисловая база → [].
(function () {
    eqJson(blocks({}, BASE, 30), [], '#4326: пустая карта → []');
    var far = {}; far[fkey(2026, 7, 25)] = { id: '915' };   // день 3
    eqJson(blocks(far, BASE, 1), [], '#4326: замороженный день за горизонтом (horizon=1) → не блокируется');
    eqJson(blocks(far, NaN, 30), [], '#4326: нечисловая база → []');
})();

console.log('\n' + passed + '/' + total + ' passed');
if (passed !== total) process.exitCode = 1;
