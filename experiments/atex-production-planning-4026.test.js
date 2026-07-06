// Regression test for ideav/crm#4026 — «Почему 462 и 492 минут, когда максимум может быть 460?».
//
// Продолжение #4021. День 3 показывал 492 (превышение на 32), карточка последней резки тянулась
// с 16:05 до 16:50 (45 мин: ножи 30 + сырьё 15), хотя splitMachineQueue положил в хвост дня лишь
// ПОДМНОЖЕСТВО настройки — сырьё 15 мин (нахлёст до 16:20), а ножи 30 + проходы перенёс на след.
// рабочий день (#3635 п.5). Расхождение: computeCutSetupUpdates (#3698) — queue-пересчёт — писал
// ПОЛНУЮ переналадку (45) на голову-хвост, а продолжению — 0 (та же резка/сырьё → changeover 0).
// scheduleFromStored читает это как настройку дня → бейдж 447 + 45 = 492 и окно до 16:50.
//
// Фикс: computeCutSetupUpdates делит настройку setup-only хвоста (0 проходов) — голова хранит
// подмножество, дотягивающее до конца окна резки (minOverlapTailSetupMinutes по остатку дня, тот
// же расчёт, что splitMachineQueue), остаток → на продолжение. День 3: 447 + 15 = 462; продолжение
// на след. дне несёт ножи 30. Остаток 462 vs 460 — округление «Длительности» вверх (#3635 п.4),
// не фантомный лидер: реальный тайминг упаковщика (по planStart-часам) в пределах 460.
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
        workingWindow: function() { return { cutEndMin: 970, dayStartMin: 480, maxOverworkTuneMin: 10 }; }   // 16:10 / 08:00
    };
}

// ---------------------------------------------------------------------------
// Часть 1 — setup-only хвост делит настройку: голова = сырьё 15, продолжение = ножи 30 (не 45/0).
console.log('\n== #4026: setup-only хвост дня хранит ПОДМНОЖЕСТВО настройки, остаток → продолжению ==');
// PREV (день 3 15:00, другое сырьё/ножи) → HEAD (день 3 16:03, setup-only, смена на MR314L 200)
// → CONT (день 6 08:00, продолжение той же резки, 3 прохода).
var PREV = cut('PREV', 5, 20, 'OTHER',  [100], 'B_OTHER', sec(2026, 5, 26, 15, 0), '');
var HEAD = cut('HEAD', 0, 0,  'MR314L', [200], 'B_314',   sec(2026, 5, 26, 16, 3), '');       // хвост: planStart 16:03
var CONT = cut('CONT', 3, 9,  'MR314L', [200], 'B_314',   sec(2026, 5, 29, 8, 0),  'HEAD');   // продолжение
var res = Controller.prototype.computeCutSetupUpdates.call(makeFake([PREV, HEAD, CONT]));
var byId = {}; res.updates.forEach(function(u) { byId[u.cutId] = u; });

// roomTail = cutEnd 970 − planStart(16:03=963) = 7. minOverlap([ножи30, сырьё15], 7, 45) = 15 (сырьё):
// голова держит сырьё 15, ножи 30 → продолжению.
assert(byId['HEAD'] != null, 'голова-хвост попала в updates');
eq(byId['HEAD'] && byId['HEAD'].knife, 0,  'HEAD: «Наладка ножей» = 0 (ножи отложены на продолжение)');
eq(byId['HEAD'] && byId['HEAD'].material, 15, 'HEAD: «Сырье/намотка» = 15 (влезло в хвост дня)');
eq((byId['HEAD'] ? byId['HEAD'].knife + byId['HEAD'].material : -1), 15, 'HEAD: настройка дня = 15, не 45 (бейдж не раздут)');
assert(byId['CONT'] != null, 'продолжение попало в updates');
eq(byId['CONT'] && byId['CONT'].knife, 30, 'CONT: «Наладка ножей» = 30 (отложенные ножи хвоста)');
eq(byId['CONT'] && byId['CONT'].material, 0, 'CONT: «Сырье/намотка» = 0');
// Итого настройка резки сохранена целиком: 15 (хвост) + 30 (продолжение) = 45, но по РАЗНЫМ дням.
eq((byId['HEAD'].knife + byId['HEAD'].material) + (byId['CONT'].knife + byId['CONT'].material), 45,
   'сумма настройки хвост+продолжение = 45 (ничего не потеряно, разнесено по дням)');

// ---------------------------------------------------------------------------
// Часть 2 — контроль: обычная резка с проходами (НЕ setup-only) — настройка целиком на ней, без дележа.
console.log('\n== #4026: обычная резка (проходы) настройку не делит ==');
var P2 = cut('P2', 5, 20, 'OTHER',  [100], 'B_OTHER', sec(2026, 5, 26, 15, 0), '');
var R2 = cut('R2', 4, 12, 'MR314L', [200], 'B_314',   sec(2026, 5, 26, 16, 3), '');   // проходы>0 → не хвост
var res2 = Controller.prototype.computeCutSetupUpdates.call(makeFake([P2, R2]));
var by2 = {}; res2.updates.forEach(function(u) { by2[u.cutId] = u; });
eq(by2['R2'] && by2['R2'].knife, 30, 'R2 (проходы): «Наладка ножей» = 30 (полная переналадка, не делится)');
eq(by2['R2'] && by2['R2'].material, 15, 'R2 (проходы): «Сырье/намотка» = 15');

// ---------------------------------------------------------------------------
// Часть 3 — контроль: setup-only, но БЕЗ продолжения (следом другое сырьё) — не делим (некому отдать).
console.log('\n== #4026: setup-only без продолжения (следом другая резка) — настройку не делим ==');
var P3 = cut('P3', 5, 20, 'OTHER',  [100], 'B_OTHER', sec(2026, 5, 26, 15, 0), '');
var H3 = cut('H3', 0, 0,  'MR314L', [200], 'B_314',   sec(2026, 5, 26, 16, 3), '');
var X3 = cut('X3', 4, 12, 'OTHER2', [300], 'B_OTH2',  sec(2026, 5, 29, 8, 0),  '');   // другое сырьё → не продолжение
var res3 = Controller.prototype.computeCutSetupUpdates.call(makeFake([P3, H3, X3]));
var by3 = {}; res3.updates.forEach(function(u) { by3[u.cutId] = u; });
eq((by3['H3'] ? by3['H3'].knife + by3['H3'].material : -1), 45,
   'H3 (setup-only без продолжения): настройка целиком 45 на ней (делить некому)');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exitCode = 1;
