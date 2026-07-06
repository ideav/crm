// Тест issue #4051 (download/atex/js/production-planning.js):
// Плашка «срок» на карточке задания пропадала, когда обеспечиваемая позиция выпадала из
// активного отчёта positions_list (заказ закрыт/выполнен) — cutDueKeys брал срок ТОЛЬКО из
// genPositions (positions_list), а там таких позиций уже нет. Фикс: «Срок изготовления»
// позиции теперь есть и в отчёте cut_planning (колонка due_date) → supply.dueKey; cutDueKeys
// с флагом includeSupplyFallback берёт срок из обеспечения, если в genPositions его нет.
// Флаг ВЫКЛючён у #4050 (штраф дня размещения) — поведение раскладки не меняется.
var assert = require('assert');
var planning = require('../download/atex/js/production-planning.js').planning;

function eq(a, b, msg) { assert.strictEqual(a, b, msg + ' (получено: ' + JSON.stringify(a) + ')'); }
function deq(a, b, msg) { assert.deepStrictEqual(a, b, msg + ' (получено: ' + JSON.stringify(a) + ')'); }

// ── 1) rowsToPlanning парсит due_date позиции в supply.dueKey (YYYYMMDD) ──
var rows = [
    // резка 10, позиция 145718 вне positions_list, но due_date есть в cut_planning
    { cut_id: '10', cut_plan_date: '1782882000', cut_material: 'MWR200', cut_status: '',
      supply_id: 's1', supply_position_id: '145718', due_date: '01.07.2026', supply_footage: '900' },
    // резка 20, позиция 400193 активна, due_date тоже приходит
    { cut_id: '20', cut_plan_date: '1782884160', cut_material: 'MW308', cut_status: '',
      supply_id: 's2', supply_position_id: '400193', due_date: '06.07.2026', supply_footage: '500' },
    // резка 30, обеспечение без срока (пустой due_date) → Infinity
    { cut_id: '30', cut_plan_date: '1782885000', cut_material: 'MR194', cut_status: '',
      supply_id: 's3', supply_position_id: '999', due_date: '', supply_footage: '300' }
];
var parsed = planning.rowsToPlanning(rows);
var byId = {};
parsed.supplies.forEach(function(s) { byId[s.id] = s; });
eq(byId.s1.dueKey, 20260701, 'supply.dueKey из due_date «01.07.2026»');
eq(byId.s2.dueKey, 20260706, 'supply.dueKey из due_date «06.07.2026»');
eq(byId.s3.dueKey, Infinity, 'пустой due_date → Infinity');

// колонка отсутствует вовсе (легаси-отчёт) → Infinity, без падения
var legacy = planning.rowsToPlanning([
    { cut_id: '40', supply_id: 's4', supply_position_id: '111', supply_footage: '100' }
]);
eq(legacy.supplies[0].dueKey, Infinity, 'нет колонки due_date → Infinity (совместимость)');

// ── 2) cutDueKeys: фолбэк на supply.dueKey ТОЛЬКО при includeSupplyFallback ──
// genPositions содержит лишь активную позицию 400193; 145718 из него выпала.
var genPositions = [
    { id: '400193', dueKey: planning.batchDateKey('06.07.2026') } // 20260706
];
var supplies = [
    { cutId: '10', positionId: '145718', dueKey: planning.batchDateKey('01.07.2026') }, // вне genPositions
    { cutId: '20', positionId: '400193', dueKey: planning.batchDateKey('06.07.2026') }  // в genPositions
];

// Задание 10 (позиция выпала из positions_list):
deq(planning.cutDueKeys({ id: '10' }, supplies, genPositions), [],
    'без фолбэка (как #4050/дефолт): позиция вне genPositions → срок пропущен, поведение прежнее');
deq(planning.cutDueKeys({ id: '10' }, supplies, genPositions, true), [20260701],
    '#4051: с фолбэком берём срок из supply.dueKey (cut_planning.due_date)');

// Задание 20 (позиция активна): срок берётся из genPositions в обоих режимах.
deq(planning.cutDueKeys({ id: '20' }, supplies, genPositions), [20260706],
    'активная позиция: срок из genPositions без фолбэка');
deq(planning.cutDueKeys({ id: '20' }, supplies, genPositions, true), [20260706],
    'активная позиция: срок из genPositions и с фолбэком (тот же)');

// ── 3) фолбэк не срабатывает, если и genPositions, и supply без срока ──
var suppliesNoDue = [
    { cutId: '50', positionId: 'x', dueKey: Infinity }
];
deq(planning.cutDueKeys({ id: '50' }, suppliesNoDue, [], true), [],
    'нет срока ни в genPositions, ни в supply → [] даже с фолбэком');

// ── 4) genPositions приоритетнее supply, если срок есть в обоих (без дублей) ──
var gp2 = [{ id: 'p9', dueKey: planning.batchDateKey('10.07.2026') }]; // 20260710
var sup2 = [{ cutId: '60', positionId: 'p9', dueKey: planning.batchDateKey('01.01.2000') }];
deq(planning.cutDueKeys({ id: '60' }, sup2, gp2, true), [20260710],
    'позиция есть в genPositions → её срок, supply.dueKey не подменяет');

console.log('OK: atex-production-planning-4051.test');
