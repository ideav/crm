// Regression tests for #4116 — «Пустое задание со всеми нулевыми таймингами».
//
// СИМПТОМ (приложенный CSV task2.csv): Станок 1, 02.07 15:40 — setup-only хвост дня (0 проходов,
// #3635 п.5) со ВСЕМИ нулевыми таймингами (Сырьё 0 / Наладка ножей 0 / Резка 0), а вся наладка
// (в т.ч. настройка ножей 30) уехала на продолжение 03.07 08:00. Жалоба пользователя:
// «Я вижу задание со всеми нулевыми таймингами — оно пустое, а всё из него перенесено в следующий
//  день, хотя сюда должна была поместиться настройка ножей.»
//
// КОРЕНЬ: при room 31–34 (напр. cutEndMin 16:13, хвост 15:40, room 33) minOverlapTailSetupMinutes
// требовал ВСЮ наладку 45 (ни ножи 30, ни сырьё 15 по отдельности не добивают день до cutEnd), а 45
// вылезала за потолок нахлёста настройки (16:25 > 16:23) → splitTailSetupAtCeiling возвращал {0,0}:
// в дне N НИЧЕГО, всё на продолжение. Но ножи 30 кончались в 16:10 — ДО cutEnd (нулевой нахлёст) и
// заведомо влезали в день N.
//
// ФИКС: если ни одно подмножество не добивает день до cutEnd под потолком, оставляем в дне N
// НАИБОЛЬШЕЕ подмножество, которое ещё влезает под потолок (максимум наладки в дне N) — здесь ножи 30.
// {0,0} возвращаем только когда даже минимальный компонент вылезает за потолок.
//
// Run with: node experiments/atex-production-planning-4116.test.js

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

// ── Часть 1. Чистый splitTailSetupAtCeiling (cutEndMin 973 = 16:13, MAX_OVERWORK_TUNE 10) ──
var split = planning.splitTailSetupAtCeiling;
var CUT_END = 973, TUNE = 10;   // потолок настройки = 983 = 16:23
function S(startMin, knife, mat) { return split(startMin, knife, mat, CUT_END, TUNE); }

// ГЛАВНЫЙ кейс #4116: хвост в 15:40 (940), наладка ножи 30 + сырьё 15. room до 16:13 = 33.
// Ни ножи 30, ни сырьё 15 не добивают день (< 33), а 45 → 16:25 > потолка 16:23. Раньше → {0,0}
// (пустое задание). Фикс: наибольшее под потолком = ножи 30 (конец 16:10, ДО cutEnd) → в дне N ножи 30.
assertEqual(S(940, 30, 15), { keepKnife: 30, keepMaterial: 0 },
    '#4116: хвост 15:40, room 33 → в дне N наибольшее под потолком = ножи 30 (не пусто!)');

// Тот же хвост чуть позже — 15:45 (945), room 28: ножи 30 добивают день (minOverlap) и влезают (16:15 ≤ 16:23).
assertEqual(S(945, 30, 15), { keepKnife: 30, keepMaterial: 0 },
    '#4116: хвост 15:45, room 28 → ножи 30 добивают день до cutEnd → в дне N ножи 30');

// Когда полная наладка 45 ВЛЕЗАЕТ под потолок (хвост 15:41 → 45 до 16:26? нет). Возьмём хвост так,
// чтобы room чуть меньше и 45 влезала: хвост 15:38 (938), room 35, 45 → 16:23 = потолок ровно → держим обе.
assertEqual(S(938, 30, 15), { keepKnife: 30, keepMaterial: 15 },
    '#4116: хвост 15:38, room 35 → вся наладка 45 добивает день и влезает (16:23 = потолок) → держим обе');

// Только настройка ножей (сырья нет): хвост 15:40, ножи 30 → 16:10 ≤ потолок → ножи 30 остаются.
assertEqual(S(940, 30, 0), { keepKnife: 30, keepMaterial: 0 },
    '#4116: только настройка ножей 30, хвост 15:40 → остаётся в дне N (влезает до 16:10)');

// Хвост у самого края (16:20 = 980): даже ножи 30 (16:50) и сырьё 15 (16:35) выше потолка 16:23 → {0,0}.
assertEqual(S(980, 30, 15), { keepKnife: 0, keepMaterial: 0 },
    '#4116: хвост 16:20 — даже минимальный компонент за потолок → в дне N ничего (пусто оправдано)');

// ── Часть 2. Интеграция: computeCutSetupUpdates не создаёт пустой хвост, ножи остаются в дне N ──
var base = new Date(2026, 6, 1, 0, 0, 0).getTime();   // полночь 01.07.2026 (TZ=UTC)
var baseSec = Math.floor(base / 1000);
function ts(dayOffset, minuteOfDay) { return String(baseSec + dayOffset * 86400 + minuteOfDay * 60); }
var cutMeta = { id: '110', val: 'Задание в производство', reqs: [
    { id: '96067', val: 'Наладка ножей, мин' },
    { id: '96069', val: 'Сырье/намотка, мин' },
    { id: '96778', val: 'Резка и Лидер' }
] };
// 08:00–16:30, TOTAL_INTERVALS 17 → cutEndMin 16:13 (973); нахлёст настройки 10 → потолок 16:23.
var daySettings = { DAY_START_HOUR: '08:00', DAY_END_HOUR: '16:30', TOTAL_INTERVALS: '17',
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

// Сценарий приложенного CSV: предшественник P → хвост T (0 проходов, 15:40, firstPartId=T) →
// продолжение C (проходы, 08:00 след. дня, firstPartId=T). Наладка T от P = ножи 30 + сырьё 15.
// Ожидаем: T оставляет в дне N настройку ножей 30 (НЕ пусто!), сырьё 15 уходит на продолжение C.
var sc1 = runSetup([
    icut({ id: 'P', mat: 'MW411',  kw: [70], runs: 4, dur: 6,  day: 0, min: 15 * 60 + 10 }),
    icut({ id: 'T', mat: 'MWR200', kw: [50], runs: 0, dur: 0,  day: 0, min: 15 * 60 + 40, first: 'T' }),
    icut({ id: 'C', mat: 'MWR200', kw: [50], runs: 8, dur: 26, day: 1, min: 8 * 60,       first: 'T' })
]);
assertEqual(sc1.T, { knife: 30, material: 0 },
    '#4116: хвост T (15:40) хранит в дне N настройку ножей 30 — задание НЕ пустое');
assertEqual(sc1.C, { knife: 0, material: 15 },
    '#4116: продолжение C добирает только сырьё 15 (ножи остались в дне N)');
// Явная проверка, что хвост НЕ со всеми нулевыми таймингами (корень жалобы).
assertEqual((sc1.T.knife + sc1.T.material) > 0, true,
    '#4116: у хвоста T НЕ все нулевые тайминги (в дне N осталась настройка ножей)');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exitCode = 1;
