// #4561 — «Почему переполнение дня? Пн, 03.08.2026 (479 мин) +29 мин сверх смены — это одно
// задание разбито на 2 дня». Требование заказчика: «Задание должно быть переразбито. Все ручные
// команды должны выполняться однозначно — как сказано!»
//
// СИМПТОМ (боевое, ateh, 01.08.2026, трасса ideav.ru-1785593471184.log). Станок 1 (1277), настройки
// базы: 08:00–16:30, TOTAL_INTERVALS 20 → потолок резки 16:10, обед 12:20×40, нахлёст резки 5
// (MAX_OVERWORK_CUTS_MN) ⇒ ёмкость дня 450 мин, с нахлёстом 455. Хранимый план:
//   655426  03.08 08:00  MW411    7 проходов   27 мин   «ID первой части» = 655366 (31.07!)
//   655453  03.08 08:27  MW308  107 проходов  452 мин   голова своей цепочки
//   655485  04.08 08:00  MW308   18 проходов   69 мин   продолжение 655453
// День 03.08 = 479 мин. Мерка (после #4559) день видит и кричит «+29 мин сверх смены», выравнивание
// #4473 запускается — и НИЧЕГО НЕ МЕНЯЕТ: в трассе на каждый заход одна и та же запись
// `SAVE t655453 [applySplitPlan]` со стартом 08:00, день снова 479, тост повторяется по кругу.
//
// ПРИЧИНА. У MW411 голова цепочки (655366) стои́т 31.07 — РАНЬШЕ окна планирования. Такие цепочки
// `cutsBeforeWindowToKeep` (#4294) исключает из входа упаковщика, и тогда их записи становятся
// ЗАНЯТЫМИ окнами станка (`excludedCutBlockedRanges`). Но для цепочки с ЗАФИКСИРОВАННОЙ (🔒) головой
// стояло исключение: «фикс-цепочку держит движок сам (fixedDay<0)». Движок её НЕ держит, а
// ПРОПУСКАЕТ: `splitMachineQueue` кладёт задания только вперёд от дня 0, якорь < 0 не размещается
// вовсе. В итоге хвост 655426, СТОЯЩИЙ в дне на 27 минут, выпадал разом отовсюду — и из раскладки,
// и из занятости дня. Упаковщик видел день пустым, ставил MW308 с 08:00 и оставлял ей ВСЕ проходы
// (в пробе — даже добавлял: 107 → 119). Отсюда патовая пара: мерка считает по хранимому плану и
// говорит «+29», упаковщик считает по своей раскладке и говорит «влезает» — и день не чинится
// никакой кнопкой.
//
//   A — РЕПРО (единица): цепочка с 🔒-головой раньше «С» исключается из входа ЦЕЛИКОМ;
//   B — и её запись, стоящая В ОКНЕ, становится занятым окном станка (иначе минуты пропадут);
//   C — РЕПРО (боевые числа): день 03.08 после пересборки ВЛЕЗАЕТ в смену, а задание ПЕРЕРАЗБИТО;
//   D — и соседняя резка встаёт ПОСЛЕ занятого окна (08:27), а не поверх него (08:00);
//   E — регресс #4294: цепочка с НЕзафиксированной головой раньше «С» исключается, как и раньше;
//   F — регресс #4294: задания В ОКНЕ и новые (без «Даты план») из входа не выпадают;
//   G — регресс #4312: заправка станка на входе в окно берётся по ВСЕЙ очереди и от исключения
//       из входа не зависит.
//
// Run with: node experiments/atex-pp-4561-chain-before-window-occupies-day.test.js

process.env.TZ = 'UTC';

var P = require('../download/atex/js/production-planning.js').planning;

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

// ── Боевые настройки ateh ───────────────────────────────────────────────────────────────────────
var DAY_START = 480, CUT_END = 970, DAY_END_HOUR = 990;      // 08:00 / 16:10 / 16:30
var LUNCH_START = 740, LUNCH_DUR = 40, OVER_CUTS = 5, OVER_TUNE = 10;
var CAP = CUT_END - DAY_START - LUNCH_DUR;                    // 450 мин чистой ёмкости
var BASE = new Date(2026, 7, 3, 0, 0, 0, 0).getTime();        // «С» = 03.08.2026
var D0 = Math.floor(BASE / 1000) + 8 * 3600;                  // 03.08 08:00, сек
var TIMES = { KNIFE: 30, KNIFE_MOVE: 0, MATERIAL_WINDING: 15, BETWEEN_CUTS: 0 };

function knives(mat) {
    return mat === 'MW411' ? { w: [80], n: 11 } : (mat === 'MW308' ? { w: [110], n: 8 } : { w: [30], n: 29 });
}
// occ — ЦЕЛАЯ занятость станка по хранимым колонкам (её видят мерка дня и excludedCutBlockedRanges)
function cut(id, mat, runs, offSec, firstPart, occ, fixed) {
    var k = knives(mat);
    return { id: id, slitter: { id: '1277' }, materialId: mat, winding: 'OUT', batchId: 'B' + mat,
        knifeWidths: k.w, knifeCount: k.n, rollerWidth: 450, plannedRuns: runs, isFoil: false,
        fixed: fixed !== false, status: '', firstPartId: firstPart,
        planDate: String(D0 + offSec), number: String(D0 + offSec),
        storedKnifeSetupMin: '0', storedMaterialWindingMin: '0', storedCutAndLeaderMin: String(occ) };
}
// Боевой набор: цепочка MW411 (голова 31.07 = день −3, хвост 03.08) + цепочка MW308 (03.08 + 04.08)
// + независимое задание MR194 на 04.08.
function prodCuts() {
    return [cut('655366', 'MW411', 43, -3 * 86400 + 66 * 60, '655366', 166),
            cut('655426', 'MW411', 7, 0, '655366', 27),
            cut('655453', 'MW308', 107, 27 * 60, '655453', 452),
            cut('655485', 'MW308', 18, 86400, '655453', 69),
            cut('652452', 'MR194', 9, 86400 + 69 * 60, '652452', 85)];
}
var PER_PASS = { '655366': 166 / 43, '655426': 27 / 7, '655453': 407 / 107, '655485': 69 / 18, '652452': 40 / 9 };

// Контроллер: вход упаковщика = всё, КРОМЕ цепочек раньше «С»; исключённое — занятые окна станка.
function planLikeController(cuts) {
    var keep = P.cutsBeforeWindowToKeep(cuts, BASE);
    var blocked = P.excludedCutBlockedRanges(cuts, keep, BASE);
    var input = cuts.filter(function (c) { return keep.indexOf(String(c.id)) < 0; });
    var anchors = {};
    input.forEach(function (c) {
        anchors[String(c.id)] = Math.floor((Number(c.planDate) * 1000 - BASE) / 86400000);
    });
    var ops = P.planCutOperations(input, {
        planBaseMidnightMs: BASE, weights: {}, times: TIMES,
        dayStartMin: DAY_START, dayEndMin: CUT_END, dayEndHourMin: DAY_END_HOUR,
        maxOverworkCutsMin: OVER_CUTS, maxOverworkTuneMin: OVER_TUNE,
        lunchStartMin: LUNCH_START, lunchDurationMin: LUNCH_DUR,
        gapFill: true, preserveOrder: true, slotPlacement: false, firstCutSetup: false,
        prevSetupBySlitter: {}, intraDayResequence: true, perPassByCut: PER_PASS,
        slitterIds: ['1277'], dueDayByCut: {}, dueKeyByCut: {},
        dayAnchorByCut: anchors, blockedRangesBySlitter: blocked
    });
    // ЧЕСТНЫЕ минуты дня — по ВСЕМ записям, стоящим в этом дне, а не только по запланированным.
    // Ровно так их считает оператор (бейдж «(N мин)») и мерка переполнения: запись, которую
    // упаковщик не разложил, со станка никуда не девается. Считать только ops — значит повторить
    // ошибку самого дефекта и получить «день влезает» там, где он 479.
    var byDay = {}, startOf = {}, planned = {};
    (ops.updates || []).forEach(function (u) {
        var mins = Math.round((u.planStartTs - Math.floor(BASE / 1000)) / 60);
        var d = Math.floor(mins / 1440);
        planned[String(u.cutId)] = 1;
        startOf[String(u.cutId)] = mins - d * 1440;
        byDay[d] = (byDay[d] || 0) + Number(u.occMin);
    });
    cuts.forEach(function (c) {
        if (planned[String(c.id)]) return;                     // уже посчитана по плану
        var mins = Math.round((Number(c.planDate) * 1000 - BASE) / 60000);
        if (mins < 0) return;                                  // запись до окна — в дни окна не входит
        var d = Math.floor(mins / 1440);
        byDay[d] = (byDay[d] || 0) + Number(c.storedCutAndLeaderMin);
    });
    return { keep: keep, blocked: blocked, ops: ops, byDay: byDay, startOf: startOf };
}

// ── A) РЕПРО: цепочка с 🔒-головой раньше «С» исключается ЦЕЛИКОМ ───────────────────────────────
(function () {
    var keep = P.cutsBeforeWindowToKeep(prodCuts(), BASE).map(String).sort();
    assert(keep.join(',') === '655366,655426',
        'A1 цепочка MW411 (🔒-голова 31.07 + хвост 03.08) исключена из входа ЦЕЛИКОМ',
        '(' + keep.join(', ') + ')');
})();

// ── B) и её запись В ОКНЕ занимает время станка ────────────────────────────────────────────────
(function () {
    var cuts = prodCuts();
    var blocked = P.excludedCutBlockedRanges(cuts, P.cutsBeforeWindowToKeep(cuts, BASE), BASE);
    var r = (blocked['1277'] || [])[0] || [];
    assert((blocked['1277'] || []).length === 1 && r[0] === 480 && r[1] === 507,
        'B1 хвост 655426 стал занятым окном станка 08:00–08:27 (27 мин не пропали)',
        '(' + JSON.stringify(blocked['1277']) + ')');
})();

// ── C) РЕПРО на боевых числах: день влезает в смену, задание ПЕРЕРАЗБИТО ────────────────────────
(function () {
    var res = planLikeController(prodCuts());
    var runs = {};
    (res.ops.updates || []).forEach(function (u) { runs[String(u.cutId)] = Number(u.plannedRuns); });
    assert(res.byDay[0] <= CAP + OVER_CUTS,
        'C1 станко-день 03.08 влезает в смену (' + Math.round(res.byDay[0]) + ' ≤ ' + (CAP + OVER_CUTS) + ' мин)',
        '(было 479)');
    assert(runs['655453'] !== 107 && runs['655485'] !== 18,
        'C2 задание ПЕРЕРАЗБИТО — проходы перераспределены между днями',
        '(655453: 107 → ' + runs['655453'] + ', 655485: 18 → ' + runs['655485'] + ')');
    assert(runs['655453'] + runs['655485'] === 125,
        'C3 проходов у задания столько же, сколько было (125) — работа не потеряна',
        '(' + runs['655453'] + ' + ' + runs['655485'] + ')');
})();

// ── D) соседняя резка встаёт ПОСЛЕ занятого окна, а не поверх него ─────────────────────────────
(function () {
    var res = planLikeController(prodCuts());
    assert(res.startOf['655453'] === 507,
        'D1 MW308 начинается в 08:27 — после хвоста MW411, а не с 08:00 поверх него',
        '(старт ' + Math.floor(res.startOf['655453'] / 60) + ':' + ('0' + (res.startOf['655453'] % 60)).slice(-2) + ')');
})();

// ── E/F) РЕГРЕСС #4294: что исключалось раньше — исключается и теперь, что не исключалось — нет ──
(function () {
    var d21 = -2 * 86400, d22 = 0, d23 = 86400;
    var cuts = [cut('H', 'MW308', 10, d21, 'H', 40, false),      // НЕзафикс. голова раньше «С»
                cut('C', 'MW308', 10, d22, 'H', 40, false),      // её продолжение В ОКНЕ
                cut('N', 'MR194', 10, d23, 'N', 40, false)];     // независимое в окне
    var keep = P.cutsBeforeWindowToKeep(cuts, BASE).map(String).sort();
    assert(keep.join(',') === 'C,H',
        'E1 цепочка с НЕзафиксированной головой раньше «С» исключается целиком (регресс #4294)',
        '(' + keep.join(', ') + ')');
    var inWin = [cut('N0', 'MW308', 10, d22, 'N0', 40), cut('N1', 'MR194', 10, d23, 'N1', 40)];
    inWin.push({ id: 'NEW', slitter: { id: '1277' }, materialId: 'MW308', winding: 'OUT',
                 knifeWidths: [110], knifeCount: 8, rollerWidth: 450, plannedRuns: 5, planDate: '', number: '' });
    assert(P.cutsBeforeWindowToKeep(inWin, BASE).length === 0,
        'F1 задания В ОКНЕ и новые (без «Даты план») из входа не выпадают (регресс #4294)',
        '(' + JSON.stringify(P.cutsBeforeWindowToKeep(inWin, BASE)) + ')');
})();

// ── G) РЕГРЕСС #4312: заправка станка на входе в окно не зависит от исключения из входа ─────────
(function () {
    var carry = P.prevSetupBeforeWindow(prodCuts(), BASE) || {};
    assert(carry['1277'] && String(carry['1277'].materialId) === 'MW411',
        'G1 заправка станка к началу окна — от последнего задания раньше «С» (регресс #4300/#4312)',
        '(' + (carry['1277'] ? carry['1277'].materialId : 'нет') + ')');
})();

console.log('\n' + passed + '/' + total + ' проверок пройдено');
if (passed !== total) process.exit(1);
