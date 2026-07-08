// Unit tests for #4108 — «Время начала заданий опять неверное» (дубль-08:00 на Ганте).
//
// СИМПТОМ: после «Сгенерировать» на Ганте два (и более) задания одного станка стоят в ОДНО
// время (напр. оба в 08:00), окна перекрываются. В приложенном cut_planning на Станке 1 три
// крупных задания (напр. 452471/452485/452668, «ID первой части» пуст) образуют вторую колонку
// поверх остальных резок дня.
//
// КОРЕНЬ: слой размещения #4085 переназначает СТАНОК резки через ops.updates[].slitterId, а
// applySplitPlan этот станок пишет (t{slitter}, только при отличии от хранимого). Но перед
// применением autoSequenceQueue прогоняет ops.updates через filterChangedUpdates, а тот держал
// апдейт ТОЛЬКО при смене planStart или проходов — смену СТАНКА не проверял. Когда генерация
// создала резку на станке A в позиции дня (08:00), а план переставил её на станок B в ТУ ЖЕ
// позицию дня (тоже 08:00), planStart и проходы совпадали → filterChangedUpdates отсеивал
// апдейт → станок в БД оставался A, а очередь A пересобиралась БЕЗ этой резки (план считал её на
// B) → две резки A встают в одно время: дубль-08:00 (Гант рисует сохранённый planStart КАК ЕСТЬ,
// #4102).
//
// ФИКС: filterChangedUpdates держит апдейт и при смене «Слиттера» (slitterChanged), сравнивая
// станок так же, как applySplitPlan (u.slitterId != null && String(u.slitterId) !== хранимый).
//
// Run with: node experiments/atex-production-planning-4108.test.js

process.env.TZ = 'UTC';
var planning = require('../download/atex/js/production-planning.js').planning;

var passed = 0, failed = 0;
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; }
    else { failed++; console.log('  expected:', JSON.stringify(expected)); console.log('  actual:  ', JSON.stringify(actual)); process.exitCode = 1; }
}

var filterChangedUpdates = planning.filterChangedUpdates;
assertEqual(typeof filterChangedUpdates, 'function', 'filterChangedUpdates экспортирован для тестов');

// Хранимая резка (как в self.cuts): number = сохранённый planStart (t1078), plannedRuns, slitter.
function stored(id, ts, runs, slitterId) {
    return { id: id, number: ts, plannedRuns: runs, slitter: { id: slitterId } };
}
function byId(cuts) { var m = {}; cuts.forEach(function(c){ m[String(c.id)] = c; }); return m; }
function ids(list) { return list.map(function(u){ return String(u.cutId); }); }

var T0 = 1782882000;   // 2026-07-01 08:00 MSK (день 0, начало смены) — как в приложенном cut_planning
var T1 = T0 + 9000;    // та же дата, 10:30 (другая позиция дня)

// ── 1) ГЛАВНЫЙ КЕЙС #4108: смена ТОЛЬКО станка (planStart и проходы прежние) — держим апдейт ──
// Резка создана на Станке 1 (1277) в 08:00; план переставил её на Станок 3 (1282) в те же 08:00.
// До фикса апдейт отсеивался → станок не перезаписывался → дубль-08:00 на Станке 1.
(function() {
    var cutsById = byId([ stored('452471', T0, 20, '1277') ]);
    var ops = { updates: [ { cutId: '452471', planStartTs: T0, plannedRuns: 20, slitterId: '1282' } ], creates: [], deletes: [] };
    assertEqual(ids(filterChangedUpdates(ops, cutsById)), ['452471'],
        '#4108: апдейт со сменой ТОЛЬКО станка (тот же planStart/проходы) — НЕ отсеивается');
})();

// ── 2) Ничего не изменилось (тот же станок, planStart, проходы) — отсеиваем (контракт #4001) ──
(function() {
    var cutsById = byId([ stored('452471', T0, 20, '1277') ]);
    var ops = { updates: [ { cutId: '452471', planStartTs: T0, plannedRuns: 20, slitterId: '1277' } ], creates: [], deletes: [] };
    assertEqual(ids(filterChangedUpdates(ops, cutsById)), [],
        '#4001: полностью совпавший апдейт (станок тот же) — отсеивается, лишней записи нет');
})();

// ── 3) Регрессия: смена planStart и/или проходов держится как прежде ─────────────────────────
(function() {
    var cutsById = byId([ stored('A', T0, 20, '1277'), stored('B', T0, 20, '1277'), stored('C', T0, 20, '1277') ]);
    var ops = { updates: [
        { cutId: 'A', planStartTs: T1, plannedRuns: 20, slitterId: '1277' },   // planStart изменился
        { cutId: 'B', planStartTs: T0, plannedRuns: 7,  slitterId: '1277' },   // проходы изменились
        { cutId: 'C', planStartTs: T0, plannedRuns: 20, slitterId: '1277' }    // ничего не изменилось
    ], creates: [], deletes: [] };
    assertEqual(ids(filterChangedUpdates(ops, cutsById)), ['A', 'B'],
        '#4108: смена planStart (A) и проходов (B) держится, неизменное (C) — нет');
})();

// ── 4) Не-слот режим (u.slitterId отсутствует) — контракт прежний (по planStart/проходам) ────
// SLOT_PLACEMENT=0: planCutOperations не кладёт slitterId в updates. Неизменный апдейт отсеиваем,
// как раньше (ветка slitterChanged инертна при u.slitterId == null).
(function() {
    var cutsById = byId([ stored('X', T0, 20, '1277') ]);
    var ops = { updates: [ { cutId: 'X', planStartTs: T0, plannedRuns: 20 } ], creates: [], deletes: [] };
    assertEqual(ids(filterChangedUpdates(ops, cutsById)), [],
        '#4108: без слот-режима (нет u.slitterId) неизменный апдейт отсеивается — контракт цел');
})();

// ── 5) Родитель разбиения (есть create с этим parentCutId) держится всегда ───────────────────
(function() {
    var cutsById = byId([ stored('P', T0, 20, '1277') ]);
    var ops = { updates: [ { cutId: 'P', planStartTs: T0, plannedRuns: 20, slitterId: '1277' } ],
                creates: [ { parentCutId: 'P', planStartTs: T1, plannedRuns: 5, slitterId: '1277' } ], deletes: [] };
    assertEqual(ids(filterChangedUpdates(ops, cutsById)), ['P'],
        '#3280: родитель разбиения (доли Обеспечения) держится, даже если его поля не изменились');
})();

// ── 6) Сценарий issue #4108: ЧЕТЫРЕ переставленных крупных задания дня — все переживают отбор ─
// Как в приложенном cut_planning: 452471/452485/452668/452734 созданы на Станке 1, план переставил
// их на Станок 3 в ТЕ ЖЕ позиции дня (совпавший planStart). Все четыре обязаны дойти до
// applySplitPlan, иначе станок не перезапишется и появится дубль-колонка на Станке 1.
(function() {
    var day2 = T0 + 86400;
    var cutsById = byId([
        stored('452471', T0, 20, '1277'), stored('452485', T0 + 9000, 19, '1277'),
        stored('452668', T0 + 20280, 23, '1277'), stored('452734', day2, 4, '1277')
    ]);
    var ops = { updates: [
        { cutId: '452471', planStartTs: T0, plannedRuns: 20, slitterId: '1282' },
        { cutId: '452485', planStartTs: T0 + 9000, plannedRuns: 19, slitterId: '1282' },
        { cutId: '452668', planStartTs: T0 + 20280, plannedRuns: 23, slitterId: '1282' },
        { cutId: '452734', planStartTs: day2, plannedRuns: 4, slitterId: '1282' }
    ], creates: [], deletes: [] };
    assertEqual(ids(filterChangedUpdates(ops, cutsById)).sort(), ['452471', '452485', '452668', '452734'],
        '#4108: все переставленные на другой станок задания (совпавший planStart) доходят до записи');
})();

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exitCode = 1;
