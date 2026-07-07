// Unit tests for #4068 — фольга за сроком вытесняет поздне-срочную нефольгу (резервирование дня).
//
// Дефект: жадный упаковщик рисует нефольгу ВСЕГДА раньше фольги (isFoil — старший ключ), а дни
// набивает строго вперёд. Большая фольга со сроком раньше поздне-срочной нефольги не влезает в
// остаток ≤ срока и переливается ЗА срок (issue #4068: «Фольга горячего тиснения», срок 30.06 →
// 01.07). Механизма вытеснения нет.
//
// Фикс (детерминированный, ТЗ §12): пре-проход находит фольгу за сроком и РЕЗЕРВИРУЕТ хвост дня
// ≤ срока (foilReserveByDay/resFoilDayByCut); нефольга видит ёмкость МИНУС резерв → поздне-срочная
// переливается позже, а фольга занимает зарезервированный хвост своего срока.
//
// Здесь проверяется МЕХАНИЗМ в splitMachineQueue при явных резервах (вычисление резерва — отдельно).
//
// Run with: node experiments/atex-production-planning-4068.test.js

var planning = require('../download/atex/js/production-planning.js').planning;

var passed = 0, total = 0;
function assert(cond, name) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}

// Резка в форме входа упаковщика. isFoil — фольга (в конец дня).
function cut(id, foil) {
    return { id: id, slitter: { id: 'm1' }, materialId: 'M1', winding: 'OUT',
             knifeWidths: [50, 50], knifeCount: 2, rollerWidth: 0, plannedRuns: 3, isFoil: !!foil };
}
// Упаковка станко-очереди. reserve/resFoil — карты резерва (пусто = без резервирования).
function pack(cutsList, order, due, perPass, runs, opts) {
    opts = opts || {};
    var pp = {}, rb = {};
    cutsList.forEach(function(c) { pp[c.id] = (perPass && perPass[c.id] != null) ? perPass[c.id] : 30;
                                   rb[c.id] = (runs && runs[c.id] != null) ? runs[c.id] : 3; });
    var ordered = order.map(function(id) { var f = null; cutsList.forEach(function(c) { if (c.id === id) f = c; }); return f; });
    return planning.splitMachineQueue(ordered, {
        dayStartMin: 0, dayEndMin: 100, times: { BETWEEN_CUTS: 0 }, leader: 0,
        perPassByCut: pp, runsByCut: rb, dayAnchorByCut: {}, gapFill: true,
        dueDayByCut: due, deadlineAware: true,
        foilReserveByDay: opts.reserve || null, resFoilDayByCut: opts.resFoil || null
    });
}
function dayOf(segs, id) { var d = null; segs.forEach(function(s) { if (String(s.cutId) === id && (d === null || s.dayOffset < d)) d = s.dayOffset; }); return d; }
function firstWindow(segs, id) { var w = null; segs.forEach(function(s) { if (String(s.cutId) === id && (w === null || s.windowStartMin < w)) w = s.windowStartMin; }); return w; }

// ── Сценарий A: большая фольга срока day1 vs поздне-срочная нефольга (day8) ──────────────────────
// B1..B3 — нефольга, срок day8 (поздний), ~90 мин каждая → дни 0,1,2. F — фольга, срок day1, ~90 мин.
var B1 = cut('B1'), B2 = cut('B2'), B3 = cut('B3'), F = cut('F', true);
var due = { F: 1, B1: 8, B2: 8, B3: 8 };
var order = ['B1', 'B2', 'B3', 'F'];

// Без резерва — воспроизводим дефект: фольга уезжает ЗА срок (day1) на day3.
var base = pack([B1, B2, B3, F], order, due);
assert(dayOf(base, 'F') > 1,
    '#4068 репро: без резерва фольга F (срок day1) уезжает за срок (день ' + dayOf(base, 'F') + ' > 1)');

// С резервом хвоста day1 под фольгу — фольга встаёт в срок (day ≤ 1), поздняя нефольга сдвигается.
var fixed = pack([B1, B2, B3, F], order, due, null, null,
    { reserve: { 1: 90 }, resFoil: { F: 1 } });
assert(dayOf(fixed, 'F') === 1,
    '#4068: с резервом фольга F встаёт на свой срок day1 (было ' + dayOf(base, 'F') + ')');
assert(dayOf(fixed, 'F') < dayOf(fixed, 'B2') && dayOf(fixed, 'F') < dayOf(fixed, 'B3'),
    '#4068: поздне-срочная нефольга B2/B3 сдвинута ПОЗЖЕ фольги (вытеснена за счёт фольги)');
assert(dayOf(fixed, 'B1') === 0,
    '#4068: ранняя нефольга B1 (влезла на day0) не тронута');

// ── Сценарий B: фольга В КОНЦЕ дня, делит день с ранне-срочной нефольгой ────────────────────────
// A — нефольга срок day0 (ранняя, НЕ вытесняется), 30 мин. L — нефольга срок day8 (поздняя), 90 мин.
// G — фольга срок day0, 40 мин. Резерв хвоста day0 = 40 → на day0: A(30)+G(40), L→day1; G ПОСЛЕ A.
var A = cut('A'), L = cut('L'), G = cut('G', true);
var due2 = { A: 0, L: 8, G: 0 };
var pp2 = { A: 30, L: 45, G: 40 }, rn2 = { A: 1, L: 2, G: 1 };
var b2 = pack([A, L, G], ['A', 'L', 'G'], due2, pp2, rn2);
assert(dayOf(b2, 'G') > 0,
    '#4068 репро B: без резерва фольга G (срок day0) уезжает за срок (день ' + dayOf(b2, 'G') + ')');

var f2 = pack([A, L, G], ['A', 'L', 'G'], due2, pp2, rn2, { reserve: { 0: 40 }, resFoil: { G: 0 } });
assert(dayOf(f2, 'G') === 0, '#4068 B: фольга G встаёт на свой срок day0');
assert(dayOf(f2, 'A') === 0, '#4068 B: ранне-срочная A остаётся на day0 (не вытеснена)');
assert(dayOf(f2, 'L') > 0, '#4068 B: поздне-срочная L вытеснена на day1');
assert(firstWindow(f2, 'G') > firstWindow(f2, 'A'),
    '#4068 B: фольга G нарисована ПОСЛЕ A (в конце дня, а не в начале)');

// ── computeFoilDeadlineReservation + двухпроходная раскладка (как в planMachineSegs) ────────────
var cfr = planning.computeFoilDeadlineReservation;
// Мимикрия planMachineSegs: пробный проход → резерв → финальный проход.
function probeAndPack(cutsList, order, due, perPass, runs, capacityDayEnd) {
    var pp = {}, rb = {};
    cutsList.forEach(function(c) { pp[c.id] = (perPass && perPass[c.id] != null) ? perPass[c.id] : 30;
                                   rb[c.id] = (runs && runs[c.id] != null) ? runs[c.id] : 3; });
    var ordered = order.map(function(id) { var f = null; cutsList.forEach(function(c) { if (c.id === id) f = c; }); return f; });
    var base = { dayStartMin: 0, dayEndMin: capacityDayEnd || 100, times: { BETWEEN_CUTS: 0 }, leader: 0,
                 perPassByCut: pp, runsByCut: rb, dayAnchorByCut: {}, gapFill: true, dueDayByCut: due, deadlineAware: true };
    var probe = planning.splitMachineQueue(ordered, base);
    var reservation = cfr(probe, ordered, due, (capacityDayEnd || 100) - 0);
    var finalSegs = probe;
    if (reservation) { base.foilReserveByDay = reservation.foilReserveByDay; base.resFoilDayByCut = reservation.resFoilDayByCut;
                       finalSegs = planning.splitMachineQueue(ordered, base); }
    return { reservation: reservation, segs: finalSegs };
}

// Сценарий A через реальный computeFoilDeadlineReservation: резерв вычислен и фольга встаёт в срок.
var r1 = probeAndPack([B1, B2, B3, F], order, due);
assert(r1.reservation != null && r1.reservation.resFoilDayByCut && r1.reservation.resFoilDayByCut.F === 1,
    '#4068: computeFoilDeadlineReservation прикалывает просроченную фольгу F к дню срока (1)');
assert(r1.reservation && r1.reservation.foilReserveByDay && r1.reservation.foilReserveByDay[1] > 0,
    '#4068: резерв хвоста дня-срока (1) > 0');
assert(dayOf(r1.segs, 'F') === 1,
    '#4068 end-to-end (2 прохода): фольга F встаёт на срок day1');

// Нет просроченной фольги → резерв не считается (null), второго прохода нет.
var due3 = { F: 5, B1: 8, B2: 8, B3: 8 };   // фольга срок day5 — в пробе успевает
var r2 = probeAndPack([B1, B2, B3, F], order, due3);
assert(r2.reservation == null,
    '#4068: фольга в срок → computeFoilDeadlineReservation возвращает null (нет резервирования)');

// Вытеснять некого (вся нефольга ≤ срока — ранне-срочная) → резерв НЕ ставим, фольга остаётся за сроком.
var E1 = cut('E1'), E2 = cut('E2'), FE = cut('FE', true);
var dueE = { E1: 0, E2: 1, FE: 1 };   // E1/E2 ранне-срочные (0/1), FE — фольга срок1
var rE = probeAndPack([E1, E2, FE], ['E1', 'E2', 'FE'], dueE);
assert(rE.reservation == null,
    '#4068: нельзя вытеснить ранне-срочную нефольгу за её срок — резерв не ставится (null)');

// ── Сценарий C (кейс issue #4068): ДВЕ фольги одного срока — сходятся в один день (ТЗ §12 п.4) ──
// N1..N3 — нефольга срок day8, ~90 мин → дни 0,1,2. F1 (мал., 30 мин) и F2 (крупн., 60 мин) —
// фольга срок day2. В пробе обе уезжают за срок; резерв группирует их в день срока (2).
var N1 = cut('N1'), N2 = cut('N2'), N3 = cut('N3'), F1 = cut('F1', true), F2 = cut('F2', true);
var dueC = { N1: 8, N2: 8, N3: 8, F1: 2, F2: 2 };
var ppC = { N1: 30, N2: 30, N3: 30, F1: 30, F2: 30 }, rnC = { N1: 3, N2: 3, N3: 3, F1: 1, F2: 2 };
var rC = probeAndPack([N1, N2, N3, F1, F2], ['N1', 'N2', 'N3', 'F1', 'F2'], dueC, ppC, rnC);
assert(rC.reservation != null && rC.reservation.resFoilDayByCut.F1 === 2 && rC.reservation.resFoilDayByCut.F2 === 2,
    '#4068 C: ОБЕ фольги одного срока (2) прикреплены к одному дню срока (ТЗ §12 п.4)');
assert(dayOf(rC.segs, 'F1') === 2 && dayOf(rC.segs, 'F2') === 2,
    '#4068 C: обе фольги F1/F2 встают на срок day2 (в один день, друг за другом)');
assert(dayOf(rC.segs, 'N3') > 2,
    '#4068 C: поздне-срочная нефольга N3 вытеснена за день срока фолег (day>2)');

console.log('\n' + passed + '/' + total + ' проверок прошло');
if (passed !== total) process.exitCode = 1;
