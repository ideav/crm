// Tests for ideav/crm#3943 — «Оверворк опять; продолжается не с тех настроек, что в конце дня —
// они, похоже, мусор».
//
// Тот же станко-день, что #3924/#3939 (Станок 1, 02.07). После #3939 бейдж 02.07 упал 542→495,
// но остался осиротевший сегмент НАСТРОЙКИ (по выгрузке: 02.07 15:58 MW308, ножи 30 + сырьё 15,
// проходов 0, «ID первой части» ПУСТ, «нет связей»). Его 47 мин (ножи+сырьё+хвост рез+лид) давали
// 448 + 47 = 495 → «оверворк». Сирота не продолжается в 03.07 (там начинается MR194) — чистый мусор.
//
// Причина невыживания чистки #3924: та удаляла сироты только В ПРЕДЕЛАХ scope [фильтра]. Когда
// пользователь упорядочивал/генерил ДРУГОЙ диапазон (03.07+), 02.07 в scope не попадал → сирота
// на 02.07 переживала чистку и продолжала пухнуть бейдж.
//
// Фикс #3943: сироты (логическая резка с суммой проходов 0) чистим ВНЕ ЗАВИСИМОСТИ от scope —
// это мусор без обеспечений/ручной раскладки; #3660 бережёт раскладку РЕАЛЬНЫХ чужих дат, не мусор.
//
// Run with: node experiments/atex-production-planning-3943.test.js

process.env.TZ = 'UTC';
var planning = require('../download/atex/js/production-planning.js').planning;
var planCutOperations = planning.planCutOperations;
var planDateDayKey = planning.planDateDayKey;

var passed = 0;
function assert(cond, name) { console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name); if (cond) passed++; else process.exitCode = 1; }

var DAY = 86400;
var day02 = Date.UTC(2026, 6, 2) / 1000;   // 02.07.2026 00:00 UTC (сек)
function cut(id, fp, runs, dayOff, mat) {
    return { id: id, firstPartId: fp, slitter: { id: 'm1' }, materialId: mat || 'MW308', winding: 'OUT',
        knifeWidths: [59], knifeCount: 1, plannedRuns: runs, planDate: String(day02 + dayOff * DAY), orderId: 'O' + id };
}
var COMMON = { planBaseMidnightMs: day02 * 1000, dayStartMin: 480, dayEndMin: 970, dayEndHourMin: 990,
    maxOverworkCutsMin: 5, maxOverworkTuneMin: 10, times: { BETWEEN_CUTS: 0 }, gapFill: true, preserveOrder: true };
function opts(extra) { var o = {}; for (var k in COMMON) o[k] = COMMON[k]; for (var k2 in extra) o[k2] = extra[k2]; return o; }

// Реальная резка на 03.07 (в scope) + осиротевшая настройка на 02.07 (ВНЕ scope [03;03]).
// Сирота ДОЛЖНА быть удалена, хотя её день вне окна пересборки.
(function () {
    var realD3 = cut('realD3', 'realD3', 10, 1, 'MR194');   // 03.07, реальная, в scope
    var orphanD2 = cut('orphanD2', '', 0, 0, 'MW308');      // 02.07 15:58 сирота, вне scope [03;03]
    var scope3 = planDateDayKey(day02 + DAY);               // 20260703
    var ops = planCutOperations([realD3, orphanD2], opts({
        perPassByCut: { realD3: 3, orphanD2: 3 }, scopeFromKey: scope3, scopeToKey: scope3,
        dayAnchorByCut: { realD3: 1, orphanD2: 0 }
    }));
    assert(ops.deletes.indexOf('orphanD2') >= 0,
        '#3943: сирота на 02.07 удалена, хотя пересобирали 03.07 (мусор чистим вне scope)');
    assert(ops.deletes.indexOf('realD3') < 0, '#3943: реальная резка 03.07 не удалена');
    assert(ops.updates.some(function (u) { return u.cutId === 'realD3'; }), '#3943: реальная резка 03.07 запланирована');
})();

// Зафиксированная сирота вне scope — НЕ трогаем (ручная защита #3508 сильнее авто-чистки).
(function () {
    var orphanFix = cut('orphanFix', '', 0, 0, 'MW308'); orphanFix.fixed = true;
    var realD3 = cut('realD3', 'realD3', 10, 1, 'MR194');
    var scope3 = planDateDayKey(day02 + DAY);
    var ops = planCutOperations([realD3, orphanFix], opts({
        perPassByCut: { realD3: 3, orphanFix: 3 }, scopeFromKey: scope3, scopeToKey: scope3,
        dayAnchorByCut: { realD3: 1, orphanFix: 0 }
    }));
    assert(ops.deletes.indexOf('orphanFix') < 0, '#3943: ЗАФИКСИРОВАННАЯ сирота вне scope НЕ удалена (#3508)');
})();

console.log('\n' + passed + ' assertions passed');
