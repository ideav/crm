// Unit tests for #3739 — «Расписание и gap-fill: не оставлять простоев в смене, нахлёст разрешён».
// splitMachineQueue в режиме gapFill заполняет хвост смены будущими резками (раньше срока —
// допустимо), нахлёст за конец смены разрешён, а выбор следующей резки идёт по НЕПРЕРЫВНОСТИ
// КОНФИГУРАЦИИ (минимальная переналадка от предыдущей: «начинать с той конфигурации, на
// которой закончили»). Когда в хвост влезает только настройка — кладём КРУПНЕЙШИЙ её компонент
// (ножи/сырьё) с минимальным нахлёстом, остаток настройки — на след. день перед проходами.
//
// Run with: node experiments/atex-production-planning-3739.test.js

process.env.TZ = 'UTC';

var api = require('../download/atex/js/production-planning.js');
var planning = api.planning;

var passed = 0;
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; }
    else {
        console.log('  expected:', JSON.stringify(expected));
        console.log('  actual:  ', JSON.stringify(actual));
        process.exitCode = 1;
    }
}

// changeover от prev: ножи (KNIFE 30) если набор ножей разный; сырьё (MATERIAL_WINDING 15)
// если materialId/намотка разные. Одинаковая конфигурация → переналадка 0.
function cut(id, material, knifeWidths, runs, anchorDate) {
    return { id: id, slitter: { id: 'm1' }, materialId: material, winding: 'OUT',
        knifeWidths: knifeWidths, knifeCount: knifeWidths.length, rollerWidth: 0,
        plannedRuns: runs, planDate: anchorDate };
}
var TIMES = { BETWEEN_CUTS: 0 };   // KNIFE/MATERIAL_WINDING — дефолтные 30/15
function ids(segs) { return segs.map(function(s){ return s.cutId; }); }

// ── 1) Непрерывность конфигурации: из двух будущих резок в хвост тянем БЛИЖАЙШУЮ ──
// День 0: A (та же конфигурация, что C) занимает 60 из 100. B и C заякорены на день 2.
// gapFill тянет в хвост C (переналадка от A = 0), а не B (ножи+сырьё = 45). Порядок: A, C, …, B.
var sel = planning.splitMachineQueue(
    [ cut('A', 'M1', [59, 59], 6, '1'),
      cut('B', 'M2', [30, 30], 3, '2'),    // далёкая конфигурация
      cut('C', 'M1', [59, 59], 4, '2') ],  // == A
    { dayStartMin: 0, dayEndMin: 100, times: TIMES,
      perPassByCut: { A: 10, B: 10, C: 10 }, runsByCut: { A: 6, B: 3, C: 4 },
      dayAnchorByCut: { A: 0, B: 2, C: 2 }, gapFill: true });
var firstC = ids(sel).indexOf('C'), firstB = ids(sel).indexOf('B');
assertEqual(firstC < firstB, true, '#3739: в хвост тянем C (та же конфигурация), а не B (далёкая) — C раньше B');
assertEqual(sel.filter(function(s){ return s.cutId === 'C'; })[0].dayOffset, 0,
    '#3739: C подтянута вперёд в день 0 (раньше своего срока), хвост не простаивает');

// ── 2) Мин. нахлёст настройки (канонический пример): хвост 20 мин, ножи 30 + сырьё 15 ──
// День 0: A занимает 60 из 80 (хвост 20). Дальше B (другое сырьё И ножи → ножи 30 + сырьё 15).
// В хвост 20 кладём НОЖИ (30, нахлёст 10), сырьё (15) — на след. день перед проходами B.
var ov = planning.splitMachineQueue(
    [ cut('A', 'M1', [59, 59], 6, '1'),
      cut('B', 'M2', [30, 30], 3, '1') ],
    { dayStartMin: 0, dayEndMin: 80, times: TIMES,
      perPassByCut: { A: 10, B: 10 }, runsByCut: { A: 6, B: 3 },
      dayAnchorByCut: { A: 0, B: 0 }, gapFill: true });
var bSetup = ov.filter(function(s){ return s.cutId === 'B' && s.setupOnly; })[0];
var bPass = ov.filter(function(s){ return s.cutId === 'B' && !s.setupOnly; })[0];
assertEqual(bSetup && { day: bSetup.dayOffset, setup: bSetup.setupMin, runs: bSetup.runs },
    { day: 0, setup: 30, runs: 0 },
    '#3739: в хвост дня 0 — ножи (30 мин, нахлёст 10 за конец смены 80), сегмент настройки');
assertEqual(bPass && { day: bPass.dayOffset, setup: bPass.setupMin, runs: bPass.runs },
    { day: 1, setup: 15, runs: 3 },
    '#3739: остаток настройки (сырьё 15) + проходы B — на следующий день');

// ── 3) Заполнение хвоста переносом будущей резки вперёд (без gapFill — простой/прыжок) ──
// A на день 0 (40 из 100), B заякорена на день 3. С gapFill B подтягивается в день 0.
var args = { dayStartMin: 0, dayEndMin: 100, times: TIMES,
    perPassByCut: { A: 10, B: 10 }, runsByCut: { A: 4, B: 4 }, dayAnchorByCut: { A: 0, B: 3 } };
var queue = [ cut('A', 'M1', [59, 59], 4, '1'), cut('B', 'M1', [59, 59], 4, '4') ];
var withGap = planning.splitMachineQueue(queue, Object.assign({}, args, { gapFill: true }));
var noGap = planning.splitMachineQueue(queue, args);
assertEqual(withGap.filter(function(s){ return s.cutId === 'B'; })[0].dayOffset, 0,
    '#3739: gapFill подтягивает B в день 0 (хвост заполнен, простоя нет)');
assertEqual(noGap.filter(function(s){ return s.cutId === 'B'; })[0].dayOffset, 3,
    '#3739: без gapFill B остаётся на своём дне 3 (поведение не изменилось — флаг изолирован)');

// ── 4) buildSchedule (отображение тайминга) при gapFill — нахлёст НЕ выталкивается на ──
// следующий день, чтобы карточка осталась на запланированном дне. A(60м) + B(setup45+60м)
// не влезают в окно 100. Без gapFill B уезжает на день 1; с gapFill — остаётся на дне 0 (нахлёст).
function dcut(id, material, dur) {
    return { id: id, slitter: { id: 'm1' }, materialId: material, winding: 'OUT',
        knifeWidths: id === 'A' ? [59, 59] : [30, 30], knifeCount: 2, rollerWidth: 0,
        plannedRuns: 0, duration: dur };
}
var schedArgs = { shiftStartMin: 0, shiftEndMin: 100, times: TIMES, runLengthByCut: {},
    windPoints: [], dayAnchorByCut: { A: 0, B: 0 } };
var qsched = [ dcut('A', 'M1', 60), dcut('B', 'M2', 60) ];
var sGap = planning.buildSchedule(qsched, Object.assign({}, schedArgs, { gapFill: true }));
var sNo = planning.buildSchedule(qsched, schedArgs);
function dayOf(sc) { return Math.floor((Number(sc.startMin) || 0) / 1440); }
assertEqual(dayOf(sGap.filter(function(s){ return s.cutId === 'B'; })[0]), 0,
    '#3739: buildSchedule(gapFill) — B остаётся на дне 0 (нахлёст), отображение совпадает с планом');
assertEqual(dayOf(sNo.filter(function(s){ return s.cutId === 'B'; })[0]), 1,
    '#3739: buildSchedule без gapFill — B уезжает на день 1 (прежнее поведение, флаг изолирован)');

console.log('\n' + passed + ' passed');
