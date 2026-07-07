// #4050 — «срок изготовления соблюдается»: срочное задание не уезжает за свой срок, пока раньше есть
// ёмкость. МЕХАНИЗМ изменён #4085 (модель #3985): срок — ЛОКАЛЬНЫЙ штраф в слое размещения
// (DEADLINE_COST_MN за день ПОЗЖЕ срока, EXACT_DEADLINE_COST_MN РОВНО в день), а НЕ EDD-сортировка
// дней `dueDay×вес` в selectByConfig (та удалена как дрейф). Здесь проверяем ЦЕЛЬ (срок соблюдён) на
// живом пути slotPlacement — перебор точек вставки ставит срочное на ранний день из-за штрафа опоздания.
//
// Run with: node experiments/atex-production-planning-4050.test.js

process.env.TZ = 'UTC';
var planning = require('../download/atex/js/production-planning.js').planning;

var passed = 0, total = 0;
function assert(cond, name) { total++; console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name); if (cond) passed++; else process.exitCode = 1; }

var BASE = new Date('2026-06-23T00:00:00').getTime();
function cut(id, o) { o = o || {};
    return { id: id, slitter: { id: 'm1' }, materialId: 'M1', winding: 'OUT', knifeWidths: [59], knifeCount: 1,
             rollerWidth: 0, plannedRuns: 1, isFoil: false }; }
function ymd(dayoff) { var d = new Date(BASE + dayoff * 86400000); return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); }
function day(ops, id) { var u = (ops.updates || []).filter(function (x) { return String(x.cutId) === id; })[0];
    return u ? Math.round((Number(u.planStartTs) * 1000 - BASE) / 86400000) : null; }

// Одна конфигурация (переналадка между резками = 0), 1 резка/день (100 мин при ёмкости 120). U — срок
// day1, стоит ПОСЛЕДНИМ во входе; L1/L2 — поздний срок day8. По модели #3985 штраф опоздания (день>срока)
// тянет U на ранний день, поздние остаются позади.
var U = cut('U'), L1 = cut('L1'), L2 = cut('L2');
var pp = { U: 100, L1: 100, L2: 100 };
var ops = planning.planCutOperations([L1, L2, U], {
    weights: planning.makePlanningOptions('SETUP', { BETWEEN_CUTS: 0 }), times: { BETWEEN_CUTS: 0 },
    dayStartMin: 0, dayEndMin: 120, dayEndHourMin: 120, perPassByCut: pp, planBaseMidnightMs: BASE,
    gapFill: true, slotPlacement: true, slitterIds: ['m1'],
    dueKeyByCut: { U: ymd(1), L1: ymd(8), L2: ymd(8) }, dueDayByCut: { U: 1, L1: 8, L2: 8 }
});
assert(day(ops, 'U') <= 1, '#4050/#4085: срочное U (срок day1, последнее во входе) ставится В СРОК — день ' + day(ops, 'U') + ' ≤ 1 (штраф опоздания в слое размещения)');
assert(day(ops, 'L1') > 1 || day(ops, 'L2') > 1, '#4050/#4085: поздне-срочные L не вытесняют срочное с раннего дня');

console.log('\n' + passed + '/' + total + ' passed');
