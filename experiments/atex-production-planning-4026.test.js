// Regression test for ideav/crm#4026 — «Почему 462 и 492 минут, когда максимум может быть 460?».
//
// Продолжение #4021. День 3 показывал 492 (превышение на 32), карточка последней резки тянулась
// с 16:05 до 16:50 (45 мин: ножи 30 + сырьё 15), хотя splitMachineQueue положил в хвост дня лишь
// ПОДМНОЖЕСТВО настройки — сырьё 15 мин (нахлёст до 16:20), а ножи 30 + проходы перенёс на след.
// рабочий день (#3635 п.5). Расхождение: computeCutSetupUpdates (#3698) — queue-пересчёт — писал
// ПОЛНУЮ переналадку (45) на голову-хвост, а продолжению — 0 (та же резка/сырьё → changeover 0).
// scheduleFromStored читает это как настройку дня → бейдж 447 + 45 = 492 и окно до 16:50.
//
// Фикс #4026 делил настройку по остатку окна до cutEnd (roomTail). #4030: критерий — БЮДЖЕТ ДНЯ
// (Σ setup+намотка+лидер ≤ (cutEnd−start)−обед+нахлёст = 460). Когда голова садится РАНЬШЕ cutEnd
// (напр. 15:35, roomTail 35), старый расчёт держал всю настройку 45 (день опять 492); по бюджету —
// если день > 460, ножи (крупный кусок) уносим на продолжение, в хвосте остаётся смена сырья 15.
// День: 447 + 15 = 462 (462 vs 460 — округление «Длительности» вверх, #3635 п.4, не фантомный лидер).
//
// Run with: node experiments/atex-production-planning-4026.test.js

process.env.TZ = 'UTC';
global.window = { db: 'ateh' };
var mod = require('../download/atex/js/production-planning.js');
var Controller = mod.Controller;

var passed = 0, failed = 0;
function assert(cond, name) {
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) { passed++; } else { failed++; process.exitCode = 1; }
}
function eq(a, b, name) { assert(a === b, name + ' (' + JSON.stringify(a) + ' === ' + JSON.stringify(b) + ')'); }

var meta = { id: '1078', reqs: [
    { id: '96067', val: 'Наладка ножей, мин' },
    { id: '96069', val: 'Сырье/намотка, мин' },
    { id: '96778', val: 'Резка и Лидер' }
] };
// planStart (unix-сек) при TZ=UTC: база 23.06 полночь; хвост — пт 26.06 16:03; продолжение — пн 29.06 08:00.
function sec(y, mo, d, h, mi) { return Date.UTC(y, mo, d, h, mi, 0) / 1000; }
function cut(id, plannedRuns, duration, matId, widths, batch, planSec, firstPart) {
    return { id: id, slitter: { id: 'S1' }, plannedRuns: plannedRuns, duration: duration,
             materialId: matId, winding: 'OUT', batchId: batch, knifeWidths: widths, knifeCount: widths.length,
             number: planSec, planDate: '', firstPartId: firstPart || '',
             storedKnifeSetupMin: '', storedMaterialWindingMin: '', storedCutAndLeaderMin: '' };
}
function makeFake(cuts) {
    return {
        meta: { cut: meta },
        changeTimes: { BETWEEN_CUTS: 2, KNIFE: 30, MATERIAL_WINDING: 15 },
        cuts: cuts,
        filter: { date: '2026-06-23' },
        planningPrevSetupBySlitter: function() { return {}; },
        // Реальные поля resolveWorkingWindow. Бюджет дня = (cutEnd−start)−обед+нахлёст = (970−480)−40+10 = 460.
        workingWindow: function() { return { cutEndMin: 970, startMin: 480, lunchDurationMin: 40, maxOverworkTuneMin: 10 }; }
    };
}
// Наполнитель дня: длинная резка с проходами (не хвост), поднимающая сумму дня-бейджа к бюджету.
// Конфигурация ОТЛИЧНА от MR314L/[200] голов-хвостов, чтобы переход наполнитель→хвост давал реальную
// переналадку (ножи 30 + сырьё 15), которую и проверяем на (не)дележ.
function filler(id, dur, planSec) {
    return cut(id, 3, dur, 'OTHER', [100], 'B_OTHER', planSec, '');
}

// ---------------------------------------------------------------------------
// Часть 1 — setup-only хвост делит настройку по БЮДЖЕТУ ДНЯ (#4030): день превысил 460 → ножи 30
// уносим на продолжение, в хвосте остаётся сырьё 15. Голова стоит на 15:35 (roomTail 35) — случай,
// который старый расчёт по остатку окна (#4026) НЕ делил (minOverlap[30,15]@35 = 45 → день 492).
console.log('\n== #4030: день > 460 → хвост держит сырьё 15, ножи 30 → продолжению (голова 15:35) ==');
// День 26.06: наполнитель 380 мин (проходы, другое сырьё/ножи) → HEAD (15:35, setup-only, смена на
// MR314L 200) → CONT (день 6, продолжение). Сумма дня с полной настройкой хвоста > 460 → делим.
// dur 411 + наладка 30 + лидер 6 = 447 → день с полной настройкой хвоста (447+45) = 492 (ровно жалоба
// #4030), после дележа 447+15 = 462.
var FILL = cut('FILL', 3, 411, 'OTHER', [100], 'B_OTHER', sec(2026, 5, 26, 8, 0),  '');
var HEAD = cut('HEAD', 0, 0,   'MR314L', [200], 'B_314',  sec(2026, 5, 26, 15, 35), '');      // хвост 15:35 (roomTail 35!)
var CONT = cut('CONT', 3, 9,   'MR314L', [200], 'B_314',  sec(2026, 5, 29, 8, 0),  'HEAD');   // продолжение
var res = Controller.prototype.computeCutSetupUpdates.call(makeFake([FILL, HEAD, CONT]));
var byId = {}; res.updates.forEach(function(u) { byId[u.cutId] = u; });

assert(byId['HEAD'] != null, 'голова-хвост попала в updates');
eq(byId['HEAD'] && byId['HEAD'].knife, 0,  'HEAD: «Наладка ножей» = 0 (ножи 30 отложены — день был > 460)');
eq(byId['HEAD'] && byId['HEAD'].material, 15, 'HEAD: «Сырье/намотка» = 15 (смена сырья остаётся в хвосте)');
eq((byId['HEAD'] ? byId['HEAD'].knife + byId['HEAD'].material : -1), 15, 'HEAD: настройка дня = 15, не 45 (бейдж не раздут)');
assert(byId['CONT'] != null, 'продолжение попало в updates');
eq(byId['CONT'] && byId['CONT'].knife, 30, 'CONT: «Наладка ножей» = 30 (отложенные ножи хвоста)');
eq(byId['CONT'] && byId['CONT'].material, 0, 'CONT: «Сырье/намотка» = 0');
eq((byId['HEAD'].knife + byId['HEAD'].material) + (byId['CONT'].knife + byId['CONT'].material), 45,
   'сумма настройки хвост+продолжение = 45 (ничего не потеряно, разнесено по дням)');
// Бейдж дня = Σ(knife+material+cutTime). После дележа день 26.06 не раздут ножами хвоста (≤ 462),
// а без дележа (ножи 30 на голове) вылетел бы за бюджет 460 — ровно жалоба #4030 «опять 492».
function dayBadge(ids) { return ids.reduce(function(s, id) { var u = byId[id] || {}; return s + (u.knife || 0) + (u.material || 0) + (u.cutTime || 0); }, 0); }
var d1 = dayBadge(['FILL', 'HEAD']);   // 26.06
assert(d1 + 30 > 460, 'без дележа день 26.06 превысил бы бюджет 460 (' + (d1 + 30) + ') — дележ оправдан');
assert(d1 <= 462, 'после дележа день 26.06 в бюджете (≤ 462, +2 округление сырья): ' + d1);

// ---------------------------------------------------------------------------
// Часть 1b — контроль: тот же хвост, но день НЕ превышает бюджет (короткий наполнитель) — НЕ делим,
// вся настройка 45 остаётся на голове (место в бюджете есть, дробить незачем).
console.log('\n== #4030: день ≤ 460 → хвост держит всю настройку 45 (дробить незачем) ==');
var FILL2 = cut('FILL2', 3, 120, 'OTHER', [100], 'B_OTHER', sec(2026, 5, 26, 8, 0),  '');
var HEAD2 = cut('HEAD2', 0, 0,   'MR314L', [200], 'B_314',  sec(2026, 5, 26, 11, 0), '');
var CONT2 = cut('CONT2', 3, 9,   'MR314L', [200], 'B_314',  sec(2026, 5, 29, 8, 0),  'HEAD2');
var resU = Controller.prototype.computeCutSetupUpdates.call(makeFake([FILL2, HEAD2, CONT2]));
var byU = {}; resU.updates.forEach(function(u) { byU[u.cutId] = u; });
eq((byU['HEAD2'] ? byU['HEAD2'].knife + byU['HEAD2'].material : -1), 45,
   'HEAD2 (день в бюджете): настройка целиком 45 на голове — не дробим');
eq(byU['CONT2'] && byU['CONT2'].knife || 0, 0, 'CONT2: продолжение без отложенных ножей');

// ---------------------------------------------------------------------------
// Часть 2 — контроль: обычная резка с проходами (НЕ setup-only) — настройка целиком на ней, без дележа,
// ДАЖЕ когда день превышает бюджет (гейт «0 проходов» изолирован наполнителем).
console.log('\n== #4026: обычная резка (проходы) настройку не делит даже при дне > 460 ==');
var F2 = filler('F2', 380, sec(2026, 5, 26, 8, 0));
var R2 = cut('R2', 4, 12, 'MR314L', [200], 'B_314', sec(2026, 5, 26, 15, 35), '');   // проходы>0 → не хвост
var res2 = Controller.prototype.computeCutSetupUpdates.call(makeFake([F2, R2]));
var by2 = {}; res2.updates.forEach(function(u) { by2[u.cutId] = u; });
eq(by2['R2'] && by2['R2'].knife, 30, 'R2 (проходы): «Наладка ножей» = 30 (полная переналадка, не делится)');
eq(by2['R2'] && by2['R2'].material, 15, 'R2 (проходы): «Сырье/намотка» = 15');

// ---------------------------------------------------------------------------
// Часть 3 — контроль: setup-only, но БЕЗ продолжения (следом другое сырьё) — не делим (некому отдать),
// ДАЖЕ когда день превышает бюджет (гейт «есть продолжение» изолирован наполнителем).
console.log('\n== #4026: setup-only без продолжения — не делим даже при дне > 460 ==');
var F3 = filler('F3', 380, sec(2026, 5, 26, 8, 0));
var H3 = cut('H3', 0, 0,  'MR314L', [200], 'B_314',   sec(2026, 5, 26, 15, 35), '');
var X3 = cut('X3', 4, 12, 'OTHER2', [300], 'B_OTH2',  sec(2026, 5, 29, 8, 0),  '');   // другое сырьё → не продолжение
var res3 = Controller.prototype.computeCutSetupUpdates.call(makeFake([F3, H3, X3]));
var by3 = {}; res3.updates.forEach(function(u) { by3[u.cutId] = u; });
eq((by3['H3'] ? by3['H3'].knife + by3['H3'].material : -1), 45,
   'H3 (setup-only без продолжения): настройка целиком 45 на ней (делить некому)');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exitCode = 1;
