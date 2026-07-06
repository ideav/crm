// Unit tests for #4059 — веса штрафов из «Настройки» доезжают до планировщика.
//
// Проблема: кастомные веса из таблицы «Настройка» (например DEADLINE_COST_MN=200) игнорировались
// по двум причинам:
//   1) loadDaySettings отсеивал все ключи, кроме рабочего окна/обеда/нахлёста (белый список) —
//      DEADLINE_COST_MN и прочие COST_MN в daySettings не попадали;
//   2) живой жадный путь (splitMachineQueue/orderCuts) читает planWeight(opts.weights, …), а
//      opts.weights = planOptions из makePlanningOptions, куда daySettings НЕ заводился вовсе.
//
// Фикс #4059:
//   - белый список в loadDaySettings убран — «Настройка» читается целиком (тип строки задаёт
//     приоритет <db> > ATEH > общий);
//   - makePlanningOptions(strategy, times, settings) кладёт ключи «Настройки» плоско в opts, откуда
//     их читает planWeight в жадном упаковщике.
//
// ВАЖНО: знак штрафа НЕ меняется (ТЗ §8: срок ПОЗЖЕ дня → DEADLINE, РОВНО в день → EXACT, срок ≤ дня
// → 0). Это проверяет отдельный тест #4050 — здесь только конфигурируемость весов.
//
// Run with: node experiments/atex-production-planning-4059.test.js

var planning = require('../download/atex/js/production-planning.js').planning;
var mk = planning.makePlanningOptions;
var pw = planning.planWeight;

var passed = 0;
function assert(cond, name) {
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}

// ── 1) makePlanningOptions прокидывает веса «Настройки» плоско в opts ──────────────────────────
var po = mk('SETUP', { BETWEEN_CUTS: 0 }, { DEADLINE_COST_MN: '200', EXACT_DEADLINE_COST_MN: '77' });
assert(pw(po, 'DEADLINE_COST_MN') === 200,
    'кастомный DEADLINE_COST_MN=200 из «Настройки» виден planWeight в opts.weights');
assert(pw(po, 'EXACT_DEADLINE_COST_MN') === 77,
    'кастомный EXACT_DEADLINE_COST_MN=77 из «Настройки» виден planWeight');

// ── 2) Без «Настройки» — дефолты ТЗ §14 (100/33), обратная совместимость ───────────────────────
var poDef = mk('SETUP', { BETWEEN_CUTS: 0 });
assert(pw(poDef, 'DEADLINE_COST_MN') === 100 && pw(poDef, 'EXACT_DEADLINE_COST_MN') === 33,
    'без «Настройки» planWeight возвращает дефолты 100/33 (PLAN_WEIGHT_DEFAULTS)');

// ── 3) Round-trip: orderCuts заново оборачивает planOptions через makePlanningOptions(weights) ──
//     (1-аргументная форма) — ключи весов не теряются.
var poRT = mk(po);   // как внутри orderCuts(cuts, weights)
assert(pw(poRT, 'DEADLINE_COST_MN') === 200,
    'повторная упаковка planOptions (orderCuts) сохраняет кастомные веса');

// ── 4) Прочие веса переналадки тоже настраиваемы (ТЗ §14), не только срок ───────────────────────
var poKn = mk('SETUP', null, { KNIVES_INCREASE_COST_MN: '80', MATERIAL_CHANGE_COST_MN: '5' });
assert(pw(poKn, 'KNIVES_INCREASE_COST_MN') === 80 && pw(poKn, 'MATERIAL_CHANGE_COST_MN') === 5,
    'KNIVES_INCREASE (деф.50→80) и MATERIAL_CHANGE (деф.15→5) переопределяются «Настройкой»');

// ── 5) Нечисловое значение в «Настройке» → откат на дефолт (planWeight устойчив к мусору) ───────
var poBad = mk('SETUP', null, { DEADLINE_COST_MN: 'abc' });
assert(pw(poBad, 'DEADLINE_COST_MN') === 100,
    'нечисловой DEADLINE_COST_MN=«abc» → дефолт 100 (Number→NaN отсекается)');

// ── 6) settings не должен перетирать strategy/times, которые задаются отдельно ─────────────────
var poMix = mk('SETUP', { BETWEEN_CUTS: 3 }, { DEADLINE_COST_MN: '200' });
assert(poMix.times && poMix.times.BETWEEN_CUTS === 3 && pw(poMix, 'DEADLINE_COST_MN') === 200,
    'times (переналадки) и веса «Настройки» сосуществуют, не конфликтуют по ключам');

// ── 7) EDD-размещение (ядро issue #4059): резка с более РАННИМ сроком занимает более ранний день,
//     даже будучи последней в очереди И несовместимой по переналадке с блоком поздних резок.
//     Прежний порог (#4050) штрафовал раннее размещение и не пенил опоздание → срок 26.06 уезжал
//     на 29.06. Теперь срок (вес 100/день) доминирует над переналадкой → EDD, за срок не уезжаем.
function ecut(id, material, knives){
    return { id:id, slitter:{id:'m1'}, materialId:material, winding:'OUT',
        knifeWidths:knives, knifeCount:knives.length, rollerWidth:0, plannedRuns:3 };
}
function packEDD(cuts, order, due){
    var pp={}, rb={}; cuts.forEach(function(c){ pp[c.id]=30; rb[c.id]=3; });
    return planning.splitMachineQueue(order.map(function(id){
        var f=null; cuts.forEach(function(c){ if(c.id===id) f=c; }); return f; }),
        { dayStartMin:0, dayEndMin:95, times:{BETWEEN_CUTS:0}, leader:0, perPassByCut:pp, runsByCut:rb,
          dayAnchorByCut:{}, gapFill:true, dueDayByCut:due, deadlineAware:true });
}
function dayOf(segs,id){ var d=null; segs.forEach(function(s){ if(String(s.cutId)===id && (d===null||s.dayOffset<d)) d=s.dayOffset; }); return d; }

// T — срок «26.06» = day 1, НЕсовместимая конфигурация (сырьё M2, ножи 40). Блок B1..B3 — срок
// «поздний» = day 8, общее сырьё/ножи M1/59 (между собой переналадка 0). Вход [B1,B2,B3,T] — T
// последняя, idx и группировка переналадки против неё. 1 резка/день.
var T = ecut('T','M2',[40,40]);
var B1 = ecut('B1','M1',[59,59]), B2 = ecut('B2','M1',[59,59]), B3 = ecut('B3','M1',[59,59]);
var edd = packEDD([T,B1,B2,B3], ['B1','B2','B3','T'], { T:1, B1:8, B2:8, B3:8 });
var dT = dayOf(edd,'T');
assert(dT === 0,
    'T (срок day1) занимает день 0 первой, обгоняя поздние B* (срок day8) вопреки idx/переналадке');
assert(dT <= 1,
    'T размещена НЕ позже своего срока (день ' + dT + ' ≤ срок 1) — за срок не уехала (был #4059: 26.06→29.06)');
assert(dT < dayOf(edd,'B1') && dT < dayOf(edd,'B2') && dT < dayOf(edd,'B3'),
    'T (ранний срок) раньше ВСЕХ поздних B* — EDD-порядок соблюдён');

// ── 8) Просроченная (срок в прошлом, day −2) — самая дешёвая, добивается ПЕРВОЙ, не задвигается ──
var O = ecut('O','M2',[40,40]);
var edd2 = packEDD([O,B1,B2,B3], ['B1','B2','B3','O'], { O:-2, B1:8, B2:8, B3:8 });
assert(dayOf(edd2,'O') === 0,
    'просроченная O (срок −2) → день 0 первой, поздние B* позже (EDD: dueDay<0 самый дешёвый)');

console.log('\n' + passed + ' passed');
