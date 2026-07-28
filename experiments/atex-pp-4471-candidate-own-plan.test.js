// #4471 — «Кнопка Упорядочить не поправила набивку дней»: объектив мерил кандидата ЧУЖИМИ данными.
//
// Трасса заказчика (ateh1, 28–30.07.2026, production-planning.js?118.74):
//   текущий план: опозданий 6 дн, переналадка 2935 мин, недоупакованных дней 2
//   КАНДИДАТ B: опозданий 4 дн, переналадка 3665, в «Отпуске» 1, недоупаковано 2 → ХУЖЕ (0 → 1 в «Отпуске»)
//   КАНДИДАТ A: опозданий 4 дн, переналадка 3535, в «Отпуске» 4, недоупаковано 2 → ХУЖЕ (0 → 4)
//   ВЫБОР: НЕТ — план НЕ трогаем.
// При этом СТРАЖ ЗАПИСИ по тем же самым операциям не сказал ни слова: ни #4467 (день сверх потолка),
// ни #4469 (день недоупакован). Движок утверждает, что раскладка кандидата чистая, а объектив —
// что в ней 2 дырявых дня и задание в «Отпуске». Врёт объектив.
//
// КОРЕНЬ: метрики кандидата (`planDowntimeConflicts`, `planChangeoverMin`, `planUnderfilledDays`)
// брали из ops только planStart и проходы, а СТАНОК и ЗАНЯТОСТЬ — из ХРАНИМОЙ резки:
//   • слой размещения (#4085) переназначает станок и в кандидате B (`ops.updates[].slitterId`), поэтому
//     задание проверялось против окон «Отпуска» ЧУЖОГО станка → фантомный конфликт;
//   • занятость бралась из хранимых колонок наладки, а кандидат переставил соседей и разорвал задание
//     по дням — его настоящие минуты другие (в трассе: переналадка 2935 → 3665).
// Один фантомный конфликт — старший член объектива (#4413) — выбрасывал ВЕСЬ план, который снимал
// две трети просрочки. Кнопка «Упорядочить» переставала работать вовсе.
//
// ФИКС: каждый план меряется СВОИМИ данными. Упаковщик отдаёт занятость сегмента (`ops.updates[].occMin`,
// `ops.creates[].occMin`), станок берётся из ops; хранимые колонки остаются меркой ХРАНИМОГО плана.
//
// Run with: node experiments/atex-pp-4471-candidate-own-plan.test.js

process.env.TZ = 'UTC';
global.window = { db: 'ateh1', xsrf: 'x' };

var mod = require('../download/atex/js/production-planning.js');
var P = mod.planning;
var Controller = mod.Controller;

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    total++;
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; } else {
        console.log('  expected:', JSON.stringify(expected));
        console.log('  actual:  ', JSON.stringify(actual));
        process.exitCode = 1;
    }
}

var BASE = new Date(2026, 6, 28, 0, 0, 0, 0).getTime();          // «С» = Вт 28.07.2026 (день 0)
function tsAt(dayOffset, minutes) { return Math.floor(BASE / 1000) + dayOffset * 86400 + minutes * 60; }
var DAY_SETTINGS = { DAY_START_HOUR: '8:00', DAY_END_HOUR: '16:30', LUNCH_START: '12:20',
    LUNCH_DURATION: '40', TOTAL_INTERVALS: '20', MAX_OVERWORK_CUTS_MN: '5', MAX_OVERWORK_TUNE_MN: '10' };
//  ёмкость дня = (16:30 − 20) − 8:00 − 40 = 450 мин; потолок резки = 455.

// Хранимое задание: колонки наладки/резки — мерка ХРАНИМОГО плана.
function cutOf(id, dayOffset, startMin, slitterId, runs, setup, work, over) {
    var c = { id: id, orderId: 'ORD' + id, firstPartId: id, slitter: { id: slitterId, label: 'Станок ' + slitterId },
        materialId: 'MW308', winding: 'OUT', batchId: 'B1', knifeWidths: [80, 80], knifeCount: 2, rollerWidth: 0,
        plannedRuns: runs, isFoil: false, length: 300, status: '', fixed: false,
        planDate: String(tsAt(dayOffset, startMin)), number: String(tsAt(dayOffset, startMin)),
        duration: String(work), storedKnifeSetupMin: '0', storedMaterialWindingMin: String(setup),
        storedCutAndLeaderMin: String(work) };
    for (var k in (over || {})) c[k] = over[k];
    return c;
}
var VAC_FROM = 8 * 60, VAC_TO = 15 * 60;                          // «Отпуск» 08:00–15:00 в день 0
function ctrlSelf(cuts, downtimes) {
    var self = Object.create(Controller.prototype);
    self.busy = false;
    self.meta = {};                                   // «Календаря» нет → выходные не блокируем
    self.cuts = cuts;
    self.filter = { date: '2026-07-28', dateTo: '2026-07-30' };
    self.slitters = [{ id: '101', label: 'Станок 1' }, { id: '202', label: 'Станок 2' }];
    self.downtimesBySlitter = downtimes || {};
    self.calendarByDay = {}; self.freezeByDay = {};
    self.daySettings = DAY_SETTINGS;
    self.changeTimes = { BETWEEN_CUTS: 0, CLEANUP_SHIFT: 30, KNIFE: 30, MATERIAL_WINDING: 15 };
    self.supplies = []; self.genPositions = [];
    self.nowMs = function () { return BASE; };
    return self;
}
// «Отпуск» станка 101 в день 0, 08:00–15:00.
var VACATION = { '101': [{ id: 'v1', start: tsAt(0, VAC_FROM), end: tsAt(0, VAC_TO), notes: 'ТО' }] };

// ── 1. Станок кандидата, а не хранимый: задание уехало со станка с «Отпуском» ────────────
(function () {
    var cuts = [cutOf('T1', 0, VAC_FROM, '101', 60, 15, 222)];
    var c = ctrlSelf(cuts, VACATION);
    assertEqual(c.planDowntimeConflicts(cuts, null), ['T1'],
        'ХРАНИМЫЙ план: задание стои́т в «Отпуске» своего станка — нарушение');

    // Кандидат уводит задание на станок 202 (там отпуска нет), время то же.
    var moved = { updates: [{ cutId: 'T1', planStartTs: tsAt(0, VAC_FROM), plannedRuns: 60,
                              slitterId: '202', occMin: 237 }], creates: [], deletes: [] };
    assertEqual(c.planDowntimeConflicts(cuts, moved), [],
        '#4471: станок берётся из ПЛАНА кандидата — на станке 202 отпуска нет, фантомного конфликта нет');

    // И наоборот: кандидат ставит задание НА станок с отпуском — это настоящее нарушение.
    var cuts2 = [cutOf('T2', 0, VAC_FROM, '202', 60, 15, 222)];
    var onto = { updates: [{ cutId: 'T2', planStartTs: tsAt(0, VAC_FROM), plannedRuns: 60,
                             slitterId: '101', occMin: 237 }], creates: [], deletes: [] };
    assertEqual(ctrlSelf(cuts2, VACATION).planDowntimeConflicts(cuts2, onto), ['T2'],
        'кандидат ЗАВЁЛ задание на станок с «Отпуском» — нарушение видно');
})();

// ── 2. Занятость — из плана кандидата (occMin), а не из хранимых колонок ─────────────────
(function () {
    // Хранимое: 237 мин с 09:00 на станке 101. Отпуск 101 — 12:00–13:00.
    var vac = { '101': [{ id: 'v2', start: tsAt(0, 12 * 60), end: tsAt(0, 13 * 60), notes: 'ТО' }] };
    var cuts = [cutOf('T1', 0, 9 * 60, '101', 60, 15, 222)];
    var c = ctrlSelf(cuts, vac);
    assertEqual(c.planDowntimeConflicts(cuts, null), ['T1'],
        'хранимый план: 09:00 + 237 мин наезжает на отпуск 12:00 — нарушение');

    // Кандидат разорвал задание по дням: голова 15 проходов, её минуты — 70, конец 10:10.
    var split = { updates: [{ cutId: 'T1', planStartTs: tsAt(0, 9 * 60), plannedRuns: 15,
                              slitterId: '101', occMin: 70 }],
                  creates: [{ parentCutId: 'T1', planStartTs: tsAt(1, 8 * 60), plannedRuns: 45,
                              slitterId: '101', occMin: 167 }], deletes: [] };
    assertEqual(c.planDowntimeConflicts(cuts, split), [],
        '#4471: занятость головы — из плана (70 мин), а не 237 из хранимых колонок');

    // Новый сегмент кандидата — тоже работа: поставленный в отпуск, он нарушение.
    var intoVac = { updates: [{ cutId: 'T1', planStartTs: tsAt(1, 8 * 60), plannedRuns: 15,
                                slitterId: '101', occMin: 70 }],
                    creates: [{ parentCutId: 'T1', planStartTs: tsAt(0, 12 * 60), plannedRuns: 45,
                                slitterId: '101', occMin: 167 }], deletes: [] };
    assertEqual(c.planDowntimeConflicts(cuts, intoVac), ['T1'],
        '#4471: НОВЫЙ сегмент кандидата в окне «Отпуска» — тоже нарушение (раньше был невидим)');
})();

// ── 3. Удалённые кандидатом записи не считаются ──────────────────────────────────────────
(function () {
    var cuts = [cutOf('T1', 0, 9 * 60, '101', 60, 15, 222), cutOf('T1C', 1, 8 * 60, '101', 20, 0, 74)];
    var vac = { '101': [{ id: 'v3', start: tsAt(1, 8 * 60), end: tsAt(1, 10 * 60), notes: 'ТО' }] };
    var c = ctrlSelf(cuts, vac);
    assertEqual(c.planDowntimeConflicts(cuts, null), ['T1C'],
        'хранимый план: продолжение стои́т в отпуске следующего дня');
    var merged = { updates: [{ cutId: 'T1', planStartTs: tsAt(0, 9 * 60), plannedRuns: 80,
                               slitterId: '101', occMin: 300 }], creates: [], deletes: ['T1C'] };
    assertEqual(c.planDowntimeConflicts(cuts, merged), [],
        '#4471: запись, которую кандидат удаляет, в его плане не стои́т нигде');
})();

// ── 4. Недоупаковка кандидата — по его же минутам ────────────────────────────────────────
(function () {
    // Хранимое: день 0 = 383 + 41 = 424 при потолке 455, назавтра продолжение (24 прохода, 56 мин).
    var cuts = [cutOf('A', 0, 8 * 60, '101', 100, 30, 353),
                cutOf('B', 0, 8 * 60 + 383, '101', 11, 15, 26),
                cutOf('BC', 1, 8 * 60, '101', 24, 0, 56, { firstPartId: 'B' })];
    var c = ctrlSelf(cuts, {});
    assertEqual(c.planUnderfilledDays(cuts, null), ['101|20260728'],
        'хранимый план: день 28.07 недоупакован (424 при потолке 455)');

    // Кандидат добил день СВОИМИ минутами: B взял 24 прохода (occMin 71), продолжению осталось 11.
    var packed = { updates: [{ cutId: 'A', planStartTs: tsAt(0, 8 * 60), plannedRuns: 100, slitterId: '101', occMin: 383 },
                             { cutId: 'B', planStartTs: tsAt(0, 8 * 60 + 383), plannedRuns: 24, slitterId: '101', occMin: 71 },
                             { cutId: 'BC', planStartTs: tsAt(1, 8 * 60), plannedRuns: 11, slitterId: '101', occMin: 26 }],
                   creates: [], deletes: [] };
    assertEqual(c.planUnderfilledDays(cuts, packed), [],
        '#4471: занятость дня считается по occMin кандидата — дыры нет');

    // Станок кандидата: те же минуты, но задание уехало на другой станок — дыра у ОБОИХ дней 101.
    var moved = { updates: [{ cutId: 'A', planStartTs: tsAt(0, 8 * 60), plannedRuns: 100, slitterId: '101', occMin: 383 },
                            { cutId: 'B', planStartTs: tsAt(0, 8 * 60 + 383), plannedRuns: 11, slitterId: '202', occMin: 41 },
                            { cutId: 'BC', planStartTs: tsAt(1, 8 * 60), plannedRuns: 24, slitterId: '202', occMin: 56 }],
                  creates: [], deletes: [] };
    assertEqual(c.planUnderfilledDays(cuts, moved), ['202|20260728'],
        'на станке 101 следующего дня с работой нет; дыра — у станка 202, куда уехала пара');
})();

// ── 5. Переналадка кандидата — по его станкам ────────────────────────────────────────────
(function () {
    // MA, MB, MA подряд на одном станке — две смены сырья. Кандидат уводит MB на другой станок:
    // на первом остаётся однородный блок MA+MA, переналадок меньше.
    var cuts = [cutOf('X', 0, 8 * 60, '101', 10, 0, 60, { materialId: 'MA', knifeWidths: [80, 80], knifeCount: 2 }),
                cutOf('Y', 0, 10 * 60, '101', 10, 0, 60, { materialId: 'MB', knifeWidths: [50, 50, 50], knifeCount: 3 }),
                cutOf('Z', 0, 12 * 60, '101', 10, 0, 60, { materialId: 'MA', knifeWidths: [80, 80], knifeCount: 2 })];
    var c = ctrlSelf(cuts, {});
    var same = c.planChangeoverMin(cuts, null);
    var apart = c.planChangeoverMin(cuts, { updates: [
        { cutId: 'X', planStartTs: tsAt(0, 8 * 60), plannedRuns: 10, slitterId: '101', occMin: 60 },
        { cutId: 'Y', planStartTs: tsAt(0, 10 * 60), plannedRuns: 10, slitterId: '202', occMin: 60 },
        { cutId: 'Z', planStartTs: tsAt(0, 12 * 60), plannedRuns: 10, slitterId: '101', occMin: 60 }
    ], creates: [], deletes: [] });
    assert(apart < same, '#4471: развели по разным станкам — переналадка кандидата меньше, а не та же',
        '(было ' + same + ', стало ' + apart + ')');
})();

// ── 6. runOptimizeQueue: фантомный конфликт больше не выбрасывает хороший план ───────────
(function () {
    var cuts = [cutOf('T1', 0, VAC_FROM, '101', 60, 15, 222)];
    var self = ctrlSelf(cuts, VACATION);
    var notes = [];
    self.setBusy = function () {}; self.render = function () {};
    self.notify = function (msg, kind) { notes.push({ msg: msg, kind: kind }); };
    self.planChangeoverMin = function () { return 45; };
    self.planLatenessDays = function (arr, ops) { return ops ? 4 : 6; };   // кандидат снимает 2 дня просрочки
    self.computeReassignmentPlan = function () { return { changed: false, slitterByRecordId: {}, slitterReqId: '9' }; };
    self.intraDayImprovementOps = function () { return { updates: [], gainMin: 0 }; };
    self.buildSequenceOps = function () {
        return { ops: { updates: [{ cutId: 'T1', planStartTs: tsAt(0, VAC_FROM), plannedRuns: 60,
                                    slitterId: '202', occMin: 237 }], creates: [], deletes: [] },
                 cutsById: { T1: cuts[0] } };
    };
    self.optimizeWindowLabel = function () { return '28.07.2026 – 30.07.2026'; };
    self.fillOptimizeMovesTrace = function () {};
    var preview = null;
    self.startPlanPreview = function (payload) { preview = payload; return true; };
    self.runOptimizeQueue();
    assert(!!preview, '#4471: план, снимающий просрочку, ПОКАЗАН (раньше его убивал фантомный «Отпуск»)');
    assertEqual([preview && preview.downtimeBefore, preview && preview.downtimeAfter], [1, 0],
        'и в предпросмотре честно: в «Отпуске» 1 → 0');
})();

// ── 6b. Кандидат, нарушающий ЖЁСТКОЕ правило ТЗ §15, не применяется ──────────────────────
// В трассе заказчика страж записи на кандидате B кричал: «нарушен монолит зафиксированных заданий —
// между 643930 и 647159 вклинилось 646952, 646491, 646876» (#4464). Такой план применять нельзя,
// каким бы хорошим он ни был по сроку, — и оператор обязан узнать причину, а не «кнопка не работает».
(function () {
    var cuts = [cutOf('T1', 0, 9 * 60, '101', 60, 15, 222)];
    var self = ctrlSelf(cuts, {});
    var notes = [];
    self.setBusy = function () {}; self.render = function () {};
    self.notify = function (msg, kind) { notes.push({ msg: msg, kind: kind }); };
    self.planChangeoverMin = function () { return 45; };
    self.planLatenessDays = function (arr, ops) { return ops ? 0 : 6; };   // кандидат снимает ВСЮ просрочку
    self.computeReassignmentPlan = function () { return { changed: false, slitterByRecordId: {}, slitterReqId: '9' }; };
    self.intraDayImprovementOps = function () { return { updates: [], gainMin: 0 }; };
    self.buildSequenceOps = function () {
        return { ops: { updates: [{ cutId: 'T1', planStartTs: tsAt(1, 8 * 60), plannedRuns: 60,
                                    slitterId: '101', occMin: 237 }], creates: [], deletes: [],
                        ruleBreaks: [{ rule: 'FIXED_BLOCK', cutId: '647159',
                                       msg: 'между зафиксированными 643930 и 647159 вклинилось: 646952' }] },
                 cutsById: { T1: cuts[0] } };
    };
    self.optimizeWindowLabel = function () { return '28.07.2026 – 30.07.2026'; };
    self.fillOptimizeMovesTrace = function () {};
    var preview = null;
    self.startPlanPreview = function (payload) { preview = payload; return true; };
    self.runOptimizeQueue();
    assert(!preview, '#4471: план, ломающий 🔒-монолит (ТЗ §15), НЕ применяется даже без просрочки');
    // #4475: текст отказа — на языке оператора (без имён правил и отсылок в консоль), но причина
    // в нём названа: что отклонено и что именно нарушено.
    var warn = notes.filter(function (n) { return n.kind === 'warning' && /отклон/i.test(n.msg); });
    assert(warn.length === 1, 'оператору названа причина отказа — план отклонён, а не «кнопка не работает»');
    assert(warn.length === 1 && /зафиксированн/.test(warn[0].msg), 'и какое именно правило нарушено',
        '(' + (warn[0] && warn[0].msg) + ')');
    assert(warn.length === 1 && !/консол/i.test(warn[0].msg), 'без отсылки «детали в консоли» (#4475)');
    assert(notes.filter(function (n) { return /оптимальна/.test(n.msg); }).length === 0,
        '«очередь оптимальна» при отклонённом кандидате не рапортуем');
})();

// ── 7. Трасса называет ВИНОВНЫХ, а не только счёт ────────────────────────────────────────
(function () {
    var lines = P.formatOptimizeTrace({
        start: { cutCount: 97, fixedCount: 62, slitterCount: 4, windowLabel: '28.07.2026 – 30.07.2026',
                 lateBefore: 6, coBefore: 2935, downtimeBefore: 0, downtimeIds: [],
                 underfilledBefore: 2, underfilledDays: ['1282|20260728', '1279|20260729'] },
        candidates: [{ key: 'B', title: 'порядок/дни на текущих станках', late: 4, changeover: 3665,
                       downtime: 1, downtimeIds: ['646632'], underfilled: 2,
                       underfilledDays: ['1282|20260728', '1279|20260729'] }],
        choice: { action: 'none' },
        stop: { code: 'none-downtime', text: 'план НЕ изменён' }
    });
    var text = lines.join('\n');
    assert(/646632/.test(text), 'в трассе названо задание, из-за которого кандидат отвергнут');
    assert(/1282\|20260728/.test(text), 'и дни, которые кандидат оставил недоупакованными');
})();

// ── 8. Упаковщик отдаёт занятость сегмента: ops.updates[].occMin ─────────────────────────
(function () {
    var ops = P.planCutOperations([
        { id: 'A', slitter: { id: '101' }, materialId: 'MA', winding: 'OUT', batchId: 'BA',
          knifeWidths: [30, 30], knifeCount: 2, plannedRuns: 200, isFoil: false, firstPartId: 'A' }
    ], {
        dayStartMin: 480, dayEndMin: 930, dayEndHourMin: 930,
        maxOverworkCutsMin: 5, maxOverworkTuneMin: 10,
        times: { KNIFE: 30, MATERIAL_WINDING: 15, BETWEEN_CUTS: 0 },
        perPassByCut: { A: 3 }, planBaseMidnightMs: BASE, gapFill: true
    });
    var head = (ops.updates || [])[0];
    assert(head && head.occMin > 0, 'голова несёт свои минуты (наладка + намотка)', '(' + (head && head.occMin) + ')');
    assert(head && head.occMin <= 455, 'и они не больше потолка дня', '(' + (head && head.occMin) + ')');
    var tail = (ops.creates || [])[0] || (ops.updates || [])[1];
    assert(tail && tail.occMin > 0, 'продолжение — тоже (иначе его день считался бы пустым)',
        '(' + (tail && tail.occMin) + ')');
})();

console.log('\n' + passed + '/' + total + ' passed');
