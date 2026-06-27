// Unit tests for #3805 — «Как может получиться 495 минут, если максимальный захлёст ~30?»
//
// Корень: buildSchedule (отображение очереди станка) для setup-only-сегмента (#3635 п.5:
// «настройка в хвосте дня N, намотка с дня N+1») пересчитывал настройку как ПОЛНУЮ
// переналадку (changeoverCost, напр. ножи 30 + сырьё 15 = 45) и клал её целиком в хвост дня
// N. Если до конца смены оставалось чуть-чуть, вся настройка (45) уходила в нахлёст, и сумма
// за день = «смена (450) + 45» = 495 — при максимуме «смена + один шаг наладки» (~480).
//
// Фикс: как splitMachineQueue/minOverlapTailSetupMinutes — в хвост дня кладём только
// минимальное подмножество компонентов настройки (дотягивающее до конца смены, мин. нахлёст),
// а остаток переносим на продолжение (день N+1).
//
// Run with: node experiments/atex-production-planning-3805.test.js

process.env.TZ = 'UTC';
var planning = require('../download/atex/js/production-planning.js').planning;

var passed = 0;
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; }
    else { console.log('  expected:', JSON.stringify(expected)); console.log('  actual:  ', JSON.stringify(actual)); process.exitCode = 1; }
}

// KNIFE 30 / MATERIAL_WINDING 15 (дефолт), лидер 0.
var TIMES = { BETWEEN_CUTS: 0 };
function cut(id, material, kw, runs, planDay, contSig) {
    return { id: id, slitter: { id: 'm1' }, materialId: material, winding: 'OUT',
        knifeWidths: kw, knifeCount: kw.length, rollerWidth: 0, plannedRuns: runs,
        planDate: planDay, continuationSignature: contSig };
}

// Окно 0..100 (ёмкость 100, без обеда). A заполняет день до 96 (остаток 4). Затем цепочка
// разрыва настройки: S (0 проходов, день 0) + C (продолжение с проходами, день 1). A — другое
// сырьё и ножи, поэтому переналадка A→S = ножи 30 + сырьё 15 = 45.
var windPoints = [{ m: 1, min: 96, foil: false }];   // 1 м прохода = 96 мин (длинный A)
var A = cut('A', 'MA', [10, 10], 1, 0, 'sigA');
var S = cut('S', 'MB', [20, 20], 0, 0, 'sigBC');     // setup-only (0 проходов)
var C = cut('C', 'MB', [20, 20], 3, 1, 'sigBC');     // продолжение, день 1, проходы
var cuts = [A, S, C];
var setupTaskIds = planning.setupTaskIdSet(cuts);
assertEqual(setupTaskIds, { S: true }, '#3805: S — setup-only-сегмент (0 проходов, у цепочки есть проходы)');

var sched = planning.buildSchedule(cuts, {
    windPoints: windPoints, times: TIMES, runLengthByCut: { A: 1, C: 1 },
    shiftStartMin: 0, shiftEndMin: 100, setupTaskIds: setupTaskIds,
    dayAnchorByCut: { A: 0, S: 0, C: 1 }, gapFill: true
});
var segById = {};
sched.forEach(function(s) { segById[s.cutId] = s; });

// A: [0, 96] на дне 0.
assertEqual({ day: Math.floor(segById.A.startMin / 1440), setup: segById.A.setupMin, finish: segById.A.finishMin },
    { day: 0, setup: 0, finish: 96 }, '#3805: A заполняет день 0 до 96 (остаток смены 4)');

// S: настройка в хвост дня 0 — только МИНИМАЛЬНЫЙ хвост (сырьё 15), нахлёст 11 (96+15=111),
// НЕ вся настройка 45 (которая дала бы 96+45=141).
assertEqual({ day: Math.floor(segById.S.startMin / 1440), setup: segById.S.setupMin, finish: segById.S.finishMin },
    { day: 0, setup: 15, finish: 111 }, '#3805: S — в хвост дня 0 только сырьё 15 (мин. нахлёст), а не 45');

// C: продолжение на дне 1 несёт ОСТАТОК настройки (ножи 30) перед проходами.
assertEqual({ day: Math.floor(segById.C.startMin / 1440), setup: segById.C.setupMin },
    { day: 1, setup: 30 }, '#3805: остаток настройки (ножи 30) — на продолжение дня 1');

// Сумма настройки сохранена: 15 (хвост) + 30 (продолжение) = 45 (полная переналадка A→цепочка).
assertEqual(segById.S.setupMin + segById.C.setupMin, 45, '#3805: суммарная настройка цепочки сохранена (15 + 30 = 45)');

// Сумма минут за день 0 (как в бейдже «(N мин)») = смена + один шаг наладки, не 495-аналог.
var day0 = sched.filter(function(s) { return Math.floor(s.startMin / 1440) === 0; })
    .reduce(function(m, s) { return m + (s.setupMin || 0) + (s.durationMin || 0) + (s.leaderMin || 0); }, 0);
assertEqual(day0, 111, '#3805: сумма дня 0 = 111 (ёмкость 100 + хвост 11), а не 141 (полная настройка в нахлёст)');

// Контроль: остаток смены 20 → в хвост уходят НОЖИ (30, сырьё 15 не дотягивает), остаток — сырьё 15.
var A2 = cut('A', 'MA', [10, 10], 1, 0, 'sigA');
var sched2 = planning.buildSchedule([A2, S, C], {
    windPoints: [{ m: 1, min: 80, foil: false }], times: TIMES, runLengthByCut: { A: 1, C: 1 },
    shiftStartMin: 0, shiftEndMin: 100, setupTaskIds: planning.setupTaskIdSet([A2, S, C]),
    dayAnchorByCut: { A: 0, S: 0, C: 1 }, gapFill: true
});
var s2 = {}; sched2.forEach(function(s) { s2[s.cutId] = s; });
assertEqual({ sSetup: s2.S.setupMin, cSetup: s2.C.setupMin },
    { sSetup: 30, cSetup: 15 }, '#3805: остаток смены 20 — в хвост ножи 30 (нахлёст 10), сырьё 15 — на продолжение');

console.log('\n' + passed + ' passed');
