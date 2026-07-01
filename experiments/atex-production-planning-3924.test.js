// Tests for ideav/crm#3924 — «510 минут и переналадка в начале дня».
//
// Симптом (тот же станко-день, что #3920: Станок 1, 02.07): в сохранённом плане накопились
// ОСИРОТЕВШИЕ сегменты НАСТРОЙКИ (0 проходов) — записи с пустым «ID первой части» (голову-резку
// удалили/перенесли прежние пересборки). mergeContinuationChains не подшивает их к цепочке, а
// делает ОТДЕЛЬНОЙ логической резкой с plannedRuns=0. Планировщик такую резку не раскладывает
// (0 проходов), поэтому обычный delete-путь (usedByHead) её НЕ трогает — она оседает «настройкой
// в начале дня» и её минуты раздувают бейдж дня за ёмкость (510 > 450). #3846 (показ сохранённого
// плана) раньше их прятал пересчётом на лету — теперь показывает как есть.
//
// Фикс: planCutOperations удаляет сироты — логические резки с 0 проходов (сумма цепочки = 0).
// #3943: удаляем ВНЕ ЗАВИСИМОСТИ от scope — это чистый мусор (0 проходов, без обеспечений и ручной
// раскладки), иначе сирота на дне вне окна пересборки переживала чистку и продолжала пухнуть бейдж
// («оверворк опять»). Реальные резки (проходы>0) и настоящие setup-хвосты (член цепочки, у чьей
// головы проходы>0) не затрагиваются; зафиксированные (#3508) не трогаем. #3660 бережёт раскладку
// РЕАЛЬНЫХ чужих дат (их не двигаем/не удаляем), а не право копить мусор.
//
// Run with: node experiments/atex-production-planning-3924.test.js

process.env.TZ = 'UTC';
var planning = require('../download/atex/js/production-planning.js').planning;
var planCutOperations = planning.planCutOperations;
var mergeContinuationChains = planning.mergeContinuationChains;
var planDateDayKey = planning.planDateDayKey;

var passed = 0;
function assert(cond, name) {
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}
function widths(pairs) { var o = []; pairs.forEach(function (pr) { for (var i = 0; i < pr[1]; i++) o.push(pr[0]); }); return o; }

var DAY = 86400;
var base = Date.UTC(2026, 6, 2) / 1000;   // 02.07.2026 00:00 UTC (сек)
var scopeKey = planDateDayKey(base);      // 20260702

// planDate в секундах (день = base + dayOff*DAY). Сирота: firstPartId='', plannedRuns=0.
function cut(id, fp, runs, dayOff, order, mat, knives) {
    return {
        id: id, firstPartId: fp,
        slitter: { id: 'm1' }, materialId: mat || 'MW308', winding: 'OUT',
        knifeWidths: knives || widths([[59, 1]]), knifeCount: (knives || [59]).length,
        plannedRuns: runs, planDate: String(base + dayOff * DAY), orderId: order || 'O1'
    };
}
var COMMON = {
    planBaseMidnightMs: base * 1000,
    dayStartMin: 480, dayEndMin: 970, dayEndHourMin: 990, maxOverworkCutsMin: 5, maxOverworkTuneMin: 10,
    times: { BETWEEN_CUTS: 0 }, gapFill: true, preserveOrder: true
};
function opts(extra) { var o = {}; for (var k in COMMON) o[k] = COMMON[k]; for (var k2 in extra) o[k2] = extra[k2]; return o; }

// ── 0: предпосылка — сирота (0 проходов, тот же день/сырьё, что реальная) остаётся ОТДЕЛЬНОЙ
//       логической резкой (тот же день ≠ смежный, эвристика цепочки её НЕ подшивает).
(function () {
    var real = cut('real', 'real', 10, 0, 'O1');
    var orphan = cut('orphan', '', 0, 0, 'O1');   // 0 проходов, пустой firstPart, тот же день
    var m = mergeContinuationChains([real, orphan]);
    var ids = m.cuts.map(function (c) { return c.id; }).sort();
    assert(JSON.stringify(ids) === JSON.stringify(['orphan', 'real']),
        '0: сирота 0-проходов того же дня — ОТДЕЛЬНАЯ логическая резка (не подшита к реальной)');
    var lg = m.cuts.filter(function (c) { return c.id === 'orphan'; })[0];
    assert(lg && Number(lg.plannedRuns) === 0, '0: у сироты plannedRuns=0');
})();

// ── 1: сирота В scope удаляется; реальная резка планируется, сирота не в updates/creates.
(function () {
    var real = cut('real', 'real', 10, 0, 'O1');
    var orphan = cut('orphan', '', 0, 0, 'O1');
    var ops = planCutOperations([real, orphan], opts({
        perPassByCut: { real: 3, orphan: 3 }, scopeFromKey: scopeKey, scopeToKey: scopeKey,
        dayAnchorByCut: { real: 0, orphan: 0 }
    }));
    assert(ops.deletes.indexOf('orphan') >= 0, '1: сирота (0 проходов) — на удаление');
    assert(!ops.updates.some(function (u) { return u.cutId === 'orphan'; }), '1: сирота не в updates');
    assert(!ops.creates.some(function (c) { return c.parentCutId === 'orphan'; }), '1: сирота не в creates');
    assert(ops.updates.some(function (u) { return u.cutId === 'real'; }), '1: реальная резка запланирована');
    assert(ops.deletes.indexOf('real') < 0, '1: реальная резка НЕ удалена');
})();

// ── 2 (#3943): сирота ВНЕ окна фильтра ВСЁ РАВНО удаляется (мусор чистим везде); при этом
//       РЕАЛЬНАЯ чужая резка (проходы>0) вне scope НЕ удаляется — #3660 бережёт её раскладку.
(function () {
    var real = cut('real', 'real', 10, 0, 'O1');
    var orphanFar = cut('orphanFar', '', 0, 5, 'O2');   // 07.07 — вне scope [02;02], 0 проходов = мусор
    var realFar = cut('realFar', 'realFar', 8, 5, 'O3'); // 07.07 — вне scope, но РЕАЛЬНАЯ (проходы>0)
    var ops = planCutOperations([real, orphanFar, realFar], opts({
        perPassByCut: { real: 3, orphanFar: 3, realFar: 3 }, scopeFromKey: scopeKey, scopeToKey: scopeKey,
        dayAnchorByCut: { real: 0, orphanFar: 5, realFar: 5 }
    }));
    assert(ops.deletes.indexOf('orphanFar') >= 0, '2: сирота ВНЕ scope тоже удалена (#3943: мусор чистим везде)');
    assert(ops.deletes.indexOf('realFar') < 0, '2: РЕАЛЬНАЯ чужая резка вне scope НЕ удалена (#3660)');
})();

// ── 3: настоящий setup-хвост (член цепочки: голова с проходами + продолжение по firstPart) НЕ
//       считается сиротой — сумма цепочки > 0, голова планируется, ложного удаления сироты нет.
(function () {
    var head = cut('H', 'H', 40, 0, 'O1');          // реальная голова, 40 проходов
    var tail = cut('Htail', 'H', 0, 1, 'O1');        // продолжение (0 проходов) со ссылкой на H
    var ops = planCutOperations([head, tail], opts({
        perPassByCut: { H: 3, Htail: 3 }, scopeFromKey: scopeKey, scopeToKey: planDateDayKey(base + DAY),
        dayAnchorByCut: { H: 0, Htail: 1 }
    }));
    assert(ops.updates.some(function (u) { return u.cutId === 'H'; }), '3: голова цепочки (проходы>0) запланирована');
    // Htail — обычная запись-продолжение: если новая раскладка её не переиспользует, её удаляет
    // штатный delete-путь (usedByHead), но НЕ орфан-логика. Голову при этом не удаляем.
    assert(ops.deletes.indexOf('H') < 0, '3: голова цепочки НЕ удалена (не сирота)');
})();

// ── 3b: ЗАФИКСИРОВАННАЯ сирота (0 проходов + fixed) авто-чисткой НЕ удаляется (#3508).
(function () {
    var real = cut('real', 'real', 10, 0, 'O1');
    var orphanFixed = cut('orphanFixed', '', 0, 0, 'O2');
    orphanFixed.fixed = true;
    var ops = planCutOperations([real, orphanFixed], opts({
        perPassByCut: { real: 3, orphanFixed: 3 }, scopeFromKey: scopeKey, scopeToKey: scopeKey,
        dayAnchorByCut: { real: 0, orphanFixed: 0 }
    }));
    assert(ops.deletes.indexOf('orphanFixed') < 0, '3b: зафиксированная сирота НЕ удалена (#3508)');
})();

// ── 4: без сирот план не меняется лишними удалениями (регресс: только реальная резка).
(function () {
    var real = cut('real', 'real', 10, 0, 'O1');
    var ops = planCutOperations([real], opts({
        perPassByCut: { real: 3 }, scopeFromKey: scopeKey, scopeToKey: scopeKey, dayAnchorByCut: { real: 0 }
    }));
    assert(ops.deletes.length === 0, '4: без сирот — пустой список удалений');
    assert(ops.updates.some(function (u) { return u.cutId === 'real'; }), '4: реальная резка запланирована');
})();

console.log('\n' + passed + ' assertions passed');
