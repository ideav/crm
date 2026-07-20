// Regression test for ideav/crm#4026 — «Почему 462 и 492 минут, когда максимум может быть 460?».
//
// Продолжение #4021. День показывал 492 (превышение), карточка последней резки тянулась с 16:01 до
// 16:46 (45 мин: ножи 30 + сырьё 15), хотя splitMachineQueue положил в хвост дня лишь ПОДМНОЖЕСТВО
// настройки, влезающее до потолка нахлёста (сырьё 15 мин, конец 16:16), а ножи 30 + проходы перенёс на
// след. рабочий день (#3635 п.5). Расхождение: computeCutSetupUpdates (#3698) — queue-пересчёт — писал
// ПОЛНУЮ переналадку (45) на голову-хвост, а продолжению — 0 (та же резка/сырьё → changeover 0).
// scheduleFromStored читает это как настройку дня → бейдж 447 + 45 = 492 и окно до 16:46.
//
// #4030/#4111: наладку setup-only хвоста (0 проходов) делим ПО ПОТОЛКУ НАХЛЁСТА НАСТРОЙКИ — в дне N
// остаётся splitTailSetupAtCeiling(...) (ровно то, что кладёт splitMachineQueue: сколько влезает до
// cutEndMin + MAX_OVERWORK_TUNE), остаток уносим на продолжение (день N+1, где резка). Раскладка зависит
// от старта хвоста (planStart), а НЕ от загрузки дня N/N+1:
//   • хвост у cutEnd (16:01, осталось 9): в дне N сырьё 15 (→16:16), ножи 30 на продолжение;
//   • хвост раньше (15:33, осталось 37): вся наладка 45 влезает (→16:18) — остаётся в дне N;
//   • нет продолжения: остаток унести некуда — вся наладка остаётся на хвосте (нахлёст неизбежен).
// День N с хвостом у cutEnd: 447 + 15 = 462 (462 vs 460 — округление «Длительности» вверх, #3635 п.4).
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
// planStart (unix-сек) при TZ=UTC: база 23.06 полночь; хвост дня у cutEnd — пт 26.06 16:01
// (осталось 9 мин до 16:10 → в дне N влезает лишь сырьё 15); продолжение — пн 29.06 08:00.
function sec(y, mo, d, h, mi) { return Date.UTC(y, mo, d, h, mi, 0) / 1000; }
var TAIL = sec(2026, 5, 26, 16, 1);   // хвост у самого cutEnd: полный набор 45 не влезает, сырьё 15 — да
function cut(id, plannedRuns, duration, matId, widths, batch, planSec, firstPart) {
    return { id: id, slitter: { id: 'S1' }, plannedRuns: plannedRuns, duration: duration,
             materialId: matId, winding: 'OUT', batchId: batch, knifeWidths: widths, knifeCount: widths.length,
             number: planSec, planDate: planSec, firstPartId: firstPart || '',   // #4042: planDate → день (cutPlanDayKey)
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
// Часть 1 — setup-only хвост у cutEnd (16:01, осталось 9): в дне N сырьё 15 (влезает до 16:16), ножи 30 →
// на продолжение. Ровно жалоба #4026: полная настройка 45 раздувала день до 492; после дележа день N = 462.
console.log('\n== #4111: хвост у cutEnd (16:01) → в дне N сырьё 15, ножи → на продолжение ==');
// День 26.06: наполнитель (проходы, другое сырьё/ножи) → HEAD (16:01, setup-only, смена на MR314L 200)
// → CONT (пн 29.06, продолжение). FILL: dur 411 + наладка 30 + лидер 6 = 447. День с полной настройкой
// хвоста (447+45) = 492 (ровно жалоба), после выноса ножей 447 + сырьё 15 = 462.
var FILL = cut('FILL', 3, 411, 'OTHER', [100], 'B_OTHER', sec(2026, 5, 26, 8, 0), '');
var HEAD = cut('HEAD', 0, 0,   'MR314L', [200], 'B_314',  TAIL, '');                       // хвост 16:01
var CONT = cut('CONT', 3, 9,   'MR314L', [200], 'B_314',  sec(2026, 5, 29, 8, 0),  'HEAD'); // продолжение
var res = Controller.prototype.computeCutSetupUpdates.call(makeFake([FILL, HEAD, CONT]));
var byId = {}; res.updates.forEach(function(u) { byId[u.cutId] = u; });

assert(byId['HEAD'] != null, 'голова-хвост попала в updates');
eq(byId['HEAD'] && byId['HEAD'].knife, 0,  'HEAD: «Наладка ножей» = 0 (ножи 30 не влезают до потолка → на продолжение)');
eq(byId['HEAD'] && byId['HEAD'].material, 15, 'HEAD: «Сырье/намотка» = 15 (смена сырья влезает до 16:16, остаётся в дне N)');
eq((byId['HEAD'] ? byId['HEAD'].knife + byId['HEAD'].material : -1), 15, 'HEAD: настройка дня N = 15, не 45 (бейдж не раздут)');
assert(byId['CONT'] != null, 'продолжение попало в updates');
eq(byId['CONT'] && byId['CONT'].knife, 30, 'CONT: «Наладка ножей» = 30 (отложенные ножи хвоста)');
eq(byId['CONT'] && byId['CONT'].material, 0, 'CONT: «Сырье/намотка» = 0');
eq((byId['HEAD'].knife + byId['HEAD'].material) + (byId['CONT'].knife + byId['CONT'].material), 45,
   'сумма настройки хвост+продолжение = 45 (ничего не потеряно, разнесено по дням)');
// Бейдж дня = Σ(knife+material+cutTime). #4296: FILL — первая резка ПУСТОГО станка, её наладка теперь
// ножи 30 + заправка сырья 15 (было только 30), поэтому база дня +15 (462→477, 492→507). Экономия от
// выноса ножей хвоста прежняя = 30 (d1+30 без выноса − d1 с выносом).
function dayBadge(ids) { return ids.reduce(function(s, id) { var u = byId[id] || {}; return s + (u.knife || 0) + (u.material || 0) + (u.cutTime || 0); }, 0); }
var d1 = dayBadge(['FILL', 'HEAD']);   // 26.06
eq(d1 + 30, 507, 'без выноса ножей день 26.06 = 507 (#4296: +15 заправка сырья FILL)');
eq(d1, 477, 'после выноса ножей день 26.06 = 477 (экономия 30 от выноса ножей хвоста цела)');

// ---------------------------------------------------------------------------
// Часть 1b — раскладка по ВРЕМЕНИ старта, а не по загрузке дня: даже когда день лёгкий (короткий
// наполнитель, бюджет НЕ превышен), хвост у cutEnd всё равно оставляет в дне N лишь сырьё 15, ножи → на
// продолжение (порога по бюджету дня нет — режем по потолку нахлёста настройки).
console.log('\n== #4111: раскладка по старту хвоста, не по загрузке дня (лёгкий день, хвост у cutEnd) ==');
var FILL2 = cut('FILL2', 3, 120, 'OTHER', [100], 'B_OTHER', sec(2026, 5, 26, 8, 0), '');
var HEAD2 = cut('HEAD2', 0, 0,   'MR314L', [200], 'B_314',  TAIL, '');
var CONT2 = cut('CONT2', 3, 9,   'MR314L', [200], 'B_314',  sec(2026, 5, 29, 8, 0), 'HEAD2');
var resU = Controller.prototype.computeCutSetupUpdates.call(makeFake([FILL2, HEAD2, CONT2]));
var byU = {}; resU.updates.forEach(function(u) { byU[u.cutId] = u; });
eq((byU['HEAD2'] ? byU['HEAD2'].knife + byU['HEAD2'].material : -1), 15,
   'HEAD2 (лёгкий день): в дне N всё равно только сырьё 15 (режем по потолку, не по бюджету дня)');
eq(byU['HEAD2'] && byU['HEAD2'].knife, 0, 'HEAD2: ножи вынесены (0) — не влезли до потолка нахлёста');
eq(byU['CONT2'] && byU['CONT2'].knife || 0, 30, 'CONT2: ножи 30 всё равно на продолжении');

// ---------------------------------------------------------------------------
// Часть 1c — раньше по времени (15:33, осталось 37): вся наладка 45 влезает до потолка (→16:18) → остаётся
// в дне N целиком, продолжению НИЧЕГО не выносим (splitMachineQueue кладёт тот же полный хвост).
console.log('\n== #4111: хвост раньше (15:33, осталось 37) → вся наладка 45 влезает, в дне N остаётся ==');
var FILLr = cut('FILLr', 3, 300, 'OTHER',  [100], 'B_OTHER', sec(2026, 5, 26, 8, 0),  '');
var HEADr = cut('HEADr', 0, 0,   'MR314L', [200], 'B_314',   sec(2026, 5, 26, 15, 33), '');   // осталось 37
var CONTr = cut('CONTr', 3, 9,   'MR314L', [200], 'B_314',   sec(2026, 5, 29, 8, 0),  'HEADr');
var resR = Controller.prototype.computeCutSetupUpdates.call(makeFake([FILLr, HEADr, CONTr]));
var byR = {}; resR.updates.forEach(function(u) { byR[u.cutId] = u; });
eq((byR['HEADr'] ? byR['HEADr'].knife + byR['HEADr'].material : -1), 45,
   'HEADr (осталось 37): вся наладка 45 остаётся в дне N (16:18 ≤ 16:20), продолжению 0');
eq(byR['CONTr'] && byR['CONTr'].knife || 0, 0, 'CONTr: продолжение НИЧЕГО не добирает (весь хвост влез в день N)');

// ---------------------------------------------------------------------------
// Часть 1d — firstPartId с пробелами (как приходит из rowValue). chainRoot нормализует String().trim()
// ТАК ЖЕ, как группировка цепочек #3892, иначе голова (сравнение по id) и продолжение (по firstPartId
// с пробелами) считались бы РАЗНЫМИ цепочками → ножи не выносятся → день раздут.
console.log('\n== #4030: firstPartId с пробелами — chainRoot trim, продолжение распознано ==');
var FILLw = cut('FILLw', 3, 411, 'OTHER',  [100], 'B_OTHER', sec(2026, 5, 26, 8, 0), '');
var HEADw = cut('HEADw', 0, 0,   'MR314L', [200], 'B_314',   TAIL, '');
var CONTw = cut('CONTw', 3, 9,   'MR314L', [200], 'B_314',   sec(2026, 5, 29, 8, 0), '  HEADw  ');   // пробелы вокруг id
var resW = Controller.prototype.computeCutSetupUpdates.call(makeFake([FILLw, HEADw, CONTw]));
var byW = {}; resW.updates.forEach(function(u) { byW[u.cutId] = u; });
eq(byW['HEADw'] && byW['HEADw'].knife, 0,  'HEADw: ножи вынесены (0) — firstPartId с пробелами распознан как та же цепочка');
eq(byW['HEADw'] && byW['HEADw'].material, 15, 'HEADw: в дне N остаётся сырьё 15');
eq(byW['CONTw'] && byW['CONTw'].knife, 30, 'CONTw: добрало ножи 30 (chainRoot trim сработал, не строгий ===)');

// ---------------------------------------------------------------------------
// Часть 1e — между хвостом и продолжением стоит резка ЧУЖОЙ конфигурации: из-за неё у продолжения СВОЯ
// переналадка входа (changeover ≠ 0), вынести туда ножи хвоста нельзя (двойной счёт) — остаток унести
// некуда, поэтому вся наладка 45 остаётся на хвосте (нахлёст неизбежен). Ножи выносятся ТОЛЬКО на
// продолжение с нулевой переналадкой входа — та же конфигурация (см. интеграционный тест #4111 sc2, где
// между хвостом и продолжением стоит чужая резка ТОЙ ЖЕ конфигурации, и вынос срабатывает).
console.log('\n== #4111: чужая резка иной конфигурации → у продолжения своя наладка, ножи хвоста вынести некуда ==');
var FILLx = cut('FILLx', 3, 411, 'OTHER',  [100], 'B_OTHER', sec(2026, 5, 26, 8, 0), '');
var HEADx = cut('HEADx', 0, 0,   'MR314L', [200], 'B_314',   TAIL, '');
var OTHRx = cut('OTHRx', 3, 40,  'ZZZMAT', [500], 'B_ZZZ',   sec(2026, 5, 29, 8, 0), '');            // чужая конфигурация ПЕРВОЙ
var CONTx = cut('CONTx', 3, 9,   'MR314L', [200], 'B_314',   sec(2026, 5, 29, 8, 30), 'HEADx');       // продолжение — не соседнее, с СВОЕЙ наладкой
var resX = Controller.prototype.computeCutSetupUpdates.call(makeFake([FILLx, HEADx, OTHRx, CONTx]));
var byX = {}; resX.updates.forEach(function(u) { byX[u.cutId] = u; });
eq((byX['HEADx'] ? byX['HEADx'].knife + byX['HEADx'].material : -1), 45,
   'HEADx: продолжение несёт СВОЮ переналадку (чужая конфиг между) → ножи хвоста вынести некуда, вся наладка 45 на хвосте');

// ---------------------------------------------------------------------------
// Часть 1f — firstPartId ПУСТ у продолжения (как на ateh: в отчёте cut_planning firstPartId пуст для ВСЕХ
// резок). Продолжение опознаётся по НУЛЕВОЙ переналадке входа (та же конфигурация — ножи хвоста и есть
// заправка продолжения), а не по цепочке firstPartId. Ровно этот случай (#4039) оставлял день на 492.
console.log('\n== #4039: firstPartId ПУСТ (ateh) — продолжение по changeover=0, ножи выносятся ==');
var FILLe = cut('FILLe', 3, 411, 'OTHER',  [100], 'B_OTHER', sec(2026, 5, 26, 8, 0), '');
var HEADe = cut('HEADe', 0, 0,   'MR314L', [200], 'B_314',   TAIL, '');   // fp ∅
var CONTe = cut('CONTe', 3, 9,   'MR314L', [200], 'B_314',   sec(2026, 5, 29, 8, 0), '');    // fp ∅ (как ateh), та же конфигурация
var resE = Controller.prototype.computeCutSetupUpdates.call(makeFake([FILLe, HEADe, CONTe]));
var byE = {}; resE.updates.forEach(function(u) { byE[u.cutId] = u; });
eq(byE['HEADe'] && byE['HEADe'].knife, 0,  'HEADe (fp пуст): ножи вынесены по changeover=0, не по цепочке');
eq(byE['HEADe'] && byE['HEADe'].material, 15, 'HEADe: в дне N остаётся сырьё 15');
eq(byE['CONTe'] && byE['CONTe'].knife, 30, 'CONTe (fp пуст): добрало ножи 30 (продолжение по конфигурации)');
eq((byE['HEADe'] ? byE['HEADe'].knife + byE['HEADe'].material : -1) + (byE['CONTe'] ? byE['CONTe'].knife + byE['CONTe'].material : -1), 45,
   'сумма настройки хвост+продолжение = 45 (fp пуст, ничего не потеряно)');

// ---------------------------------------------------------------------------
// Часть 1g (#4111) — продолжение на ПОЛНОМ дне N+1: хвост дня N ВСЁ РАВНО режется по потолку нахлёста
// (в дне N сырьё 15, ножи 30 → на продолжение), а переполнение дня N+1 отражаем ЧЕСТНО, а не прячем,
// оставляя полную настройку 45 за нахлёстом дня N. Прежний #4042 (держать ножи в дне N при полном N+1)
// был ровно источником жалобы #4111 (хвост до 16:46) и ОТМЕНЁН.
console.log('\n== #4111: день продолжения ПОЛОН → хвост дня N всё равно по потолку, N+1 переполняется честно ==');
var FILLf = cut('FILLf', 3, 380, 'OTHER',  [100], 'B_OTHER', sec(2026, 5, 26, 8, 0), '');    // день N
var HEADf = cut('HEADf', 0, 0,   'MR314L', [200], 'B_314',   TAIL, '');                       // хвост setup-only день N, у cutEnd
var CONTf = cut('CONTf', 1, 4,   'MR314L', [200], 'B_314',   sec(2026, 5, 29, 8, 0), 'HEADf'); // продолжение 08:00, та же конфиг
var LONGf = cut('LONGf', 30, 391, 'MR314L', [200], 'B_314',  sec(2026, 5, 29, 8, 34), '');     // длинная резка той же конфиг
var resF = Controller.prototype.computeCutSetupUpdates.call(makeFake([FILLf, HEADf, CONTf, LONGf]));
var byF = {}; resF.updates.forEach(function(u) { byF[u.cutId] = u; });
eq(byF['HEADf'] && byF['HEADf'].knife, 0, 'HEADf (#4111): ножи вынесены (0) даже при полном дне N+1 — день N не тянем за нахлёст');
eq(byF['HEADf'] && byF['HEADf'].material, 15, 'HEADf: в дне N остаётся сырьё 15 (до 16:16)');
eq((byF['HEADf'] ? byF['HEADf'].knife + byF['HEADf'].material : -1), 15,
   'HEADf: настройка дня N = 15, не 45 (хвост не вылезает за 16:20)');
eq(byF['CONTf'] && byF['CONTf'].knife || 0, 30, 'CONTf: продолжение добирает ножи 30 хвоста');
// Контроль баланса: с ножами на продолжении день N+1 = 487 (переполнение показано честно), а не спрятано в день N.
function dayF(ids) { return ids.reduce(function(s, id) { var u = byF[id] || {}; return s + (u.knife || 0) + (u.material || 0) + (u.cutTime || 0); }, 0); }
eq(dayF(['CONTf', 'LONGf']), 487, 'день N+1 = 487 (переполнение отражено честно), а не скрыто нахлёстом дня N');

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
// Часть 3 — контроль: setup-only хвост у cutEnd, но БЕЗ продолжения (следом другое сырьё) — остаток унести
// НЕКУДА, поэтому вся наладка 45 остаётся на хвосте (нахлёст неизбежен, но настройку терять нельзя).
console.log('\n== #4111: setup-only без продолжения — остаток унести некуда → вся наладка 45 на хвосте ==');
var F3 = filler('F3', 380, sec(2026, 5, 26, 8, 0));
var H3 = cut('H3', 0, 0,  'MR314L', [200], 'B_314',   TAIL, '');                    // хвост у cutEnd, но продолжения нет
var X3 = cut('X3', 4, 12, 'OTHER2', [300], 'B_OTH2',  sec(2026, 5, 29, 8, 0), '');  // другое сырьё → не продолжение
var res3 = Controller.prototype.computeCutSetupUpdates.call(makeFake([F3, H3, X3]));
var by3 = {}; res3.updates.forEach(function(u) { by3[u.cutId] = u; });
eq((by3['H3'] ? by3['H3'].knife + by3['H3'].material : -1), 45,
   'H3 (setup-only без продолжения): настройка целиком 45 на ней (остаток унести некуда)');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exitCode = 1;
