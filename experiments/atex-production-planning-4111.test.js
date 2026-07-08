// Unit tests for #4111 — «Сплит задания»: setup-only хвост дня должен писать в текущий день ТОЛЬКО
// то, что влезает с допустимым нахлёстом настройки (cutEndMin + MAX_OVERWORK_TUNE), остаток — на
// продолжение (день N+1, где резка).
//
// СИМПТОМ (приложенный cut_planning): Станок 1, 01.07 — последняя резка setup-only (0 проходов),
// «Тайминг окна» 16:01 смена ножей 30 + 16:31 смена сырья 15 → готово 16:46. При cutEndMin 16:10 и
// MAX_OVERWORK_TUNE 10 потолок нахлёста настройки = 16:20, а хвост тянется до 16:46 (нахлёст 26 > 10).
//
// КОРЕНЬ: splitMachineQueue кладёт в хвост ТОЛЬКО влезающее до потолка (minOverlapTailSetupMinutes →
// смена сырья 15, конец 16:16), а ножи 30 переносит на продолжение. Но хранимые колонки наладки
// (computeCutSetupUpdates, #4030/#4042) писали в день N ПОЛНУЮ наладку 45 (ножи оставались в дне N,
// когда день N+1 «полон»), и бейдж/окно дня N вылезали за нахлёст.
//
// ФИКС: computeCutSetupUpdates делит наладку хвоста по потолку нахлёста настройки (splitTailSetupAtCeiling,
// зеркалит splitMachineQueue), остаток уносит на продолжение (скан вперёд по chainRoot/firstPartId).
//
// Run with: node experiments/atex-production-planning-4111.test.js

process.env.TZ = 'UTC';
var api = require('../download/atex/js/production-planning.js');
var planning = api.planning;

var passed = 0, failed = 0;
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; }
    else { failed++; console.log('  expected:', JSON.stringify(expected)); console.log('  actual:  ', JSON.stringify(actual)); process.exitCode = 1; }
}

// ── Часть 1. Чистый splitTailSetupAtCeiling (окно ateh: cutEndMin 970 = 16:10, MAX_OVERWORK_TUNE 10) ──
var split = planning.splitTailSetupAtCeiling;
assertEqual(typeof split, 'function', 'splitTailSetupAtCeiling экспортирован');
var CUT_END = 970, TUNE = 10;   // потолок настройки = 980 = 16:20
function S(startMin, knife, mat) { return split(startMin, knife, mat, CUT_END, TUNE); }

// Приложенный кейс: хвост в 16:01 (961), наладка ножи 30 + сырьё 15. room до 16:10 = 9, потолок 16:20.
// minOverlap ≥ 9 = сырьё 15 (16:16 ≤ 16:20) → в дне N сырьё 15, ножи 30 на продолжение.
assertEqual(S(961, 30, 15), { keepKnife: 0, keepMaterial: 15 },
    '#4111: хвост 16:01, ножи30/сырьё15 → в дне N только сырьё 15 (конец 16:16 ≤ 16:20)');

// Хвост раньше (15:50 = 950): room 20 → minOverlap ножи 30 (16:20 = потолок ровно) → в дне N ножи 30.
assertEqual(S(950, 30, 15), { keepKnife: 30, keepMaterial: 0 },
    '#4111: хвост 15:50, room 20 → в дне N ножи 30 (сырьё 15 не добивает), конец 16:20');

// Хвост ещё раньше (15:33 = 933): room 37 → нужна вся наладка 45 (16:18 ≤ 16:20) → держим обе.
assertEqual(S(933, 30, 15), { keepKnife: 30, keepMaterial: 15 },
    '#4111: хвост 15:33, room 37 → вся наладка 45 в дне N (16:18 ≤ 16:20)');

// Хвост у самого края (16:08 = 968): даже сырьё 15 (16:23) выше потолка 16:20 → в дне N НИЧЕГО.
assertEqual(S(968, 30, 15), { keepKnife: 0, keepMaterial: 0 },
    '#4111: хвост 16:08 — даже минимальный компонент за потолок → в дне N ничего, вся наладка на продолжение');

// Нахлёст выключен (TUNE 0): сырьё 15 в 16:01 = 16:16 > 16:10 → в дне N ничего.
assertEqual(split(961, 30, 15, CUT_END, 0), { keepKnife: 0, keepMaterial: 0 },
    '#4111: MAX_OVERWORK_TUNE=0 → хвост 16:01 не кладём ничего (любой нахлёст запрещён)');

// Только ножи (сырья нет), хвост 16:01: ножи 30 → 16:31 > 16:20 → ничего.
assertEqual(S(961, 30, 0), { keepKnife: 0, keepMaterial: 0 },
    '#4111: только ножи 30, хвост 16:01 → за потолок → в дне N ничего');

// Наладка целиком влезает ДО cutEnd (хвост 15:00 = 900, room 70 > 45) → держим всю.
assertEqual(S(900, 30, 15), { keepKnife: 30, keepMaterial: 15 },
    '#4111: наладка влезает до cutEndMin (без нахлёста) → держим всю в дне N');

// Нет окна (cutEndMin не число) → держим всю наладку в дне N (прежнее поведение).
assertEqual(split(961, 30, 15, NaN, 10), { keepKnife: 30, keepMaterial: 15 },
    '#4111: нет окна (cutEndMin NaN) → наладка остаётся в дне N как есть');

// ── Часть 2. Интеграция: computeCutSetupUpdates делит хвост и уносит остаток на продолжение ──
var base = new Date(2026, 6, 1, 0, 0, 0).getTime();   // полночь 01.07.2026 (TZ=UTC)
var baseSec = Math.floor(base / 1000);
function ts(dayOffset, minuteOfDay) { return String(baseSec + dayOffset * 86400 + minuteOfDay * 60); }
var cutMeta = { id: '110', val: 'Задание в производство', reqs: [
    { id: '96067', val: 'Наладка ножей, мин' },
    { id: '96069', val: 'Сырье/намотка, мин' },
    { id: '96778', val: 'Резка и Лидер' }
] };
// ateh: 08:00–16:30, TOTAL_INTERVALS 20 → cutEndMin 16:10 (970); нахлёст настройки 10 → потолок 16:20.
var daySettings = { DAY_START_HOUR: '08:00', DAY_END_HOUR: '16:30', TOTAL_INTERVALS: '20',
    MAX_OVERWORK_CUTS_MN: '5', MAX_OVERWORK_TUNE_MN: '10' };
function icut(o) {
    return { id: o.id, slitter: { id: '1', label: 'Станок 1' },
        materialId: o.mat, winding: 'OUT', batchId: 'b', knifeWidths: o.kw, knifeCount: o.kw.length,
        rollerWidth: 0, isFoil: false, plannedRuns: o.runs, duration: o.dur || 0,
        planDate: ts(o.day, o.min), number: ts(o.day, o.min), firstPartId: o.first || '',
        storedKnifeSetupMin: '', storedMaterialWindingMin: '', storedCutAndLeaderMin: '' };
}
function runSetup(cuts) {
    var ctrl = Object.create(api.Controller.prototype);
    ctrl.meta = { cut: cutMeta };
    ctrl.cuts = cuts;
    ctrl.changeTimes = { KNIFE: 30, MATERIAL_WINDING: 15, BETWEEN_CUTS: 0, CLEANUP_SHIFT: 30 };
    ctrl.daySettings = daySettings;
    ctrl.slitters = [];
    ctrl.prevSetupBySlitter = {};
    ctrl.filter = { date: '2026-07-01' };
    var res = ctrl.computeCutSetupUpdates(null);
    var by = {};
    res.updates.forEach(function(u) { by[String(u.cutId)] = { knife: u.knife, material: u.material }; });
    return by;
}

// Сценарий приложенного плана: предшественник P (MW411/[70]) → хвост T (MWR200/[50], 0 проходов,
// 16:01) → продолжение C (MWR200/[50], 8 проходов, 08:00 след. дня, firstPartId=T). Наладка T от P =
// ножи 30 + сырьё 15. Ожидаем: T оставляет в дне N сырьё 15, ножи 30 уходят на продолжение C.
var sc1 = runSetup([
    icut({ id: 'P', mat: 'MW411',  kw: [70], runs: 4, dur: 6,  day: 0, min: 15 * 60 + 32 }),
    icut({ id: 'T', mat: 'MWR200', kw: [50], runs: 0, dur: 0,  day: 0, min: 16 * 60 + 1, first: 'T' }),
    icut({ id: 'C', mat: 'MWR200', kw: [50], runs: 8, dur: 26, day: 1, min: 8 * 60,      first: 'T' })
]);
assertEqual(sc1.T, { knife: 0, material: 15 },
    '#4111: хвост T (16:01) хранит в дне N только смену сырья 15 (ножи вынесены), а не полные 45');
assertEqual(sc1.C, { knife: 30, material: 0 },
    '#4111: продолжение C добирает вынесенные из хвоста ножи 30');

// Продолжение НЕ соседнее: между T и C — чужая резка X той же конфигурации (MWR200/[50]).
// Старый #4030 брал ближайшую (X) и мог отнести ножи не туда; фикс сканирует вперёд по chainRoot и
// находит именно C (firstPartId=T). X своей наладки не несёт (та же конфигурация → 0).
var sc2 = runSetup([
    icut({ id: 'P', mat: 'MW411',  kw: [70], runs: 4, dur: 6,  day: 0, min: 15 * 60 + 32 }),
    icut({ id: 'T', mat: 'MWR200', kw: [50], runs: 0, dur: 0,  day: 0, min: 16 * 60 + 1, first: 'T' }),
    icut({ id: 'X', mat: 'MWR200', kw: [50], runs: 3, dur: 10, day: 1, min: 8 * 60,      first: 'X' }),
    icut({ id: 'C', mat: 'MWR200', kw: [50], runs: 8, dur: 26, day: 1, min: 8 * 60 + 30, first: 'T' })
]);
assertEqual(sc2.T, { knife: 0, material: 15 },
    '#4111: хвост T оставляет сырьё 15 в дне N даже когда продолжение не соседнее');
assertEqual(sc2.C, { knife: 30, material: 0 },
    '#4111: ножи хвоста уходят на продолжение C (скан по chainRoot), а не на соседнюю чужую X');
assertEqual(sc2.X === undefined || (sc2.X.knife === 0 && sc2.X.material === 0), true,
    '#4111: чужая резка X между хвостом и продолжением НЕ добирает ножи хвоста');

// РЕПРОДУКЦИЯ бага: день продолжения ПОЛОН (крупная резка D на 440 мин). Старый #4042 при полном
// дне N+1 ОСТАВЛЯЛ ножи в дне N (хвост 45 → 16:46 за потолок). Фикс капает хвост по потолку НЕЗАВИСИМО
// от загрузки дня N+1 → T всегда {0,15}, ножи 30 всё равно на продолжение C.
var sc3 = runSetup([
    icut({ id: 'P', mat: 'MW411',  kw: [70], runs: 4,  dur: 6,   day: 0, min: 15 * 60 + 32 }),
    icut({ id: 'T', mat: 'MWR200', kw: [50], runs: 0,  dur: 0,   day: 0, min: 16 * 60 + 1, first: 'T' }),
    icut({ id: 'C', mat: 'MWR200', kw: [50], runs: 8,  dur: 26,  day: 1, min: 8 * 60,      first: 'T' }),
    icut({ id: 'D', mat: 'MWR200', kw: [50], runs: 40, dur: 480, day: 1, min: 8 * 60 + 30, first: 'D' })
]);
assertEqual(sc3.T, { knife: 0, material: 15 },
    '#4111: хвост капается по потолку даже когда день продолжения ПОЛОН (старый #4042 держал 45 в дне N)');
assertEqual(sc3.C, { knife: 30, material: 0 },
    '#4111: ножи хвоста уходят на продолжение C и при полном дне N+1 (переполнение дня N+1 отражаем честно)');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exitCode = 1;
