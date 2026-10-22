// Unit-тесты #3472 — менеджерская модель раскроя: «1 заказ = 1 резка» + слияние
// только по выгоде. Цель лексикографическая: прогоны (расход джамбо) → скрап.
//
// Run with: node experiments/atex-cut-layout-3472.test.js

var layout = require('../download/atex/js/cut-layout.js').layout;
var passed = 0;
function assertEqual(actual, expected, name){
  var ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log((ok?'PASS':'FAIL')+' — '+name);
  if(ok) passed++; else { console.log('  exp:',JSON.stringify(expected)); console.log('  got:',JSON.stringify(actual)); process.exitCode=1; }
}
function assert(cond, name){ assertEqual(!!cond, true, name); }

// ── Пример из issue: MR192, джамбо 910, два заказа одного профиля ──
//   3673 · 110мм · 80 шт  →  «110мм х 8» (880, отход 30), 10 прогонов
//   3672 · 89мм  · 80 шт  →  «89мм х 10» (890, отход 20),  8 прогонов
// Менеджерский эталон: РАЗДЕЛЬНО (Σ 18 прогонов), НЕ слитно 4+4 (Σ 20 прогонов).
var issue = layout.planLayouts({
  jumboWidth: 910,
  positions: [
    { id: '3673', width: 110, qty: 80, dueKey: 20260601 },
    { id: '3672', width: 89,  qty: 80, dueKey: 20260601 }
  ],
  preferred: [],
  options: { windowDays: 3, tolerance: 0 }
});

assertEqual(issue.layouts.length, 2, 'issue: две раскладки (каждый заказ — своя резка)');
// каждая раскладка покрывает РОВНО одну позицию (заказ не дроблён, заказы не слиты)
assertEqual(issue.layouts.map(function(l){ return l.positionsCovered.slice().sort(); }),
            [['3672'], ['3673']], 'issue: 1 заказ = 1 резка (без дробления и слияния)');
// ни одна раскладка не содержит ОБЕ ширины (нет «балансного» 4+4)
var mixed = issue.layouts.some(function(l){
  return layout.orderStripQty(l.strips, 110) > 0 && layout.orderStripQty(l.strips, 89) > 0;
});
assertEqual(mixed, false, 'issue: 110 и 89 НЕ смешаны в одной резке');

// найдём раскладки по ширине
function byWidth(layouts, w){ return layouts.filter(function(l){ return layout.orderStripQty(l.strips, w) > 0; })[0]; }
var L110 = byWidth(issue.layouts, 110), L89 = byWidth(issue.layouts, 89);
assertEqual(layout.orderStripQty(L110.strips, 110), 8, 'issue: 110мм → 8 полос (как в каталоге)');
assertEqual(layout.orderStripQty(L89.strips, 89), 10, 'issue: 89мм → 10 полос (как в каталоге)');
assertEqual(L110.used, 880, 'issue: 110×8 = 880 использовано');
assertEqual(L89.used, 890, 'issue: 89×10 = 890 использовано');
assertEqual(layout.layoutRuns(L110.strips, { '110': 80 }), 10, 'issue: 110 → 10 прогонов');
assertEqual(layout.layoutRuns(L89.strips, { '89': 80 }), 8, 'issue: 89 → 8 прогонов');
// суммарный расход джамбо: 18 прогонов (раздельно) < 20 (слитно 4+4)
var sepRuns = layout.layoutRuns(L110.strips, {'110':80}) + layout.layoutRuns(L89.strips, {'89':80});
assertEqual(sepRuns, 18, 'issue: Σ прогонов раздельно = 18 (оптимум, не 20)');

// ── Слияние ПО ВЫГОДЕ: 110×50 + 70×30. Раньше сливалось (та же цель по прогонам, меньше
//    скрапа: 110 давал 8×7=56, −50=6 лишних). С #5223 слияние запрещено: слитая резка
//    ({110:5, 70:3} × 10) меняет производство 110мм с 56 до 50 шт. — совмещать заказы
//    можно только с сохранением количества (решение заказчика #5223). → две резки.
var merge = layout.planLayouts({
  jumboWidth: 910,
  positions: [
    { id: 'a', width: 110, qty: 50, dueKey: 20260601 },
    { id: 'b', width: 70,  qty: 30, dueKey: 20260601 }
  ],
  preferred: [{ width: 50, popularity: 8 }],
  options: { windowDays: 3, tolerance: 0 }
});
assertEqual(merge.layouts.length, 2, 'merge: слияние меняло производство 110мм (56→50) — запрещено #5223 → две резки');
var mergeCov = {};
merge.layouts.forEach(function(l){ l.positionsCovered.forEach(function(pid){ mergeCov[pid] = 1; }); });
assertEqual(Object.keys(mergeCov).sort(), ['a', 'b'], 'merge: обе позиции покрыты своими резками');

// ── Маленький НЕзапасной заказ не перепроизводится (как было в #3423, одиночно). ──
var small = layout.planLayouts({
  jumboWidth: 910,
  positions: [{ id: 's', width: 110, qty: 5, dueKey: 20260601 }],
  preferred: [],
  options: { windowDays: 3, tolerance: 0 }
});
assertEqual(small.layouts.length, 1, 'small: одна раскладка');
var sStrips = layout.orderStripQty(small.layouts[0].strips, 110);
var sRuns = layout.layoutRuns(small.layouts[0].strips, { '110': 5 });
assertEqual(sStrips * sRuns, 5, 'small: 5 шт нарезано ровно под заказ (без перепроизводства)');

// ── Заказ НИКОГДА не появляется в двух раскладках (жёсткое правило: не дробить). ──
var seen = {};
var split = false;
issue.layouts.forEach(function(l){ l.positionsCovered.forEach(function(pid){ if (seen[pid]) split = true; seen[pid] = 1; }); });
assertEqual(split, false, 'issue: ни один заказ не дроблён на две раскладки');

// ── #3472 п.3: разумные ограничения комбо-резки (≤3 ширин, ≤3 заказов по умолчанию). ──
// Вход, который БЕЗ ограничения сливается в одну раскладку из 4 ширин / 4 позиций.
var capPos = [[110, 50], [70, 30], [50, 20], [40, 10]].map(function(p, i){
  return { id: 'c' + i, width: p[0], qty: p[1], dueKey: 20260601 };
});
function capPlan(cap){
  return layout.planLayouts({ jumboWidth: 910, positions: capPos, preferred: [],
    options: { windowDays: 3, tolerance: 0, maxWidthsPerCut: cap, maxPositionsPerCut: cap } });
}
function widthsOf(l){ var w = {}; l.strips.forEach(function(s){ if (s.purpose === 'Заказ') w[s.width] = 1; }); return Object.keys(w).length; }
function maxOver(res, fn){ return res.layouts.reduce(function(m, l){ return Math.max(m, fn(l)); }, 0); }

// без ограничения (большой cap) — слилась только пара, СОХРАНЯЮЩАЯ количество:
// 50×20 + 40×10 → {50:10, 40:5} × 2 (ровно 20 и 10 шт., −8 прогонов). Пара 110+70
// меняла производство (56→50) — запрещена #5223. Лимит ширин здесь не активный ограничитель.
var uncapped = capPlan(1e9);
var uncappedCov = {};
uncapped.layouts.forEach(function(l){ l.positionsCovered.forEach(function(pid){ uncappedCov[pid] = 1; }); });
var capMerged = uncapped.layouts.filter(function(l){ return l.positionsCovered.length === 2; })[0];
assertEqual(uncapped.layouts.length === 3 && Object.keys(uncappedCov).length === 4, true,
  'cap: из четырёх позиций слилась только сохраняющая количество пара (#5223)');
assertEqual(!!capMerged && layout.orderStripQty(capMerged.strips, 50) === 10 &&
            layout.orderStripQty(capMerged.strips, 40) === 5, true,
  'cap: слияние 50×20+40×10 — ровно 10×2 и 5×2 шт. (количество сохранено)');

// дефолт (ограничения не переданы → 3): ни одна резка не превышает 3 ширин/3 позиций.
var def = layout.planLayouts({ jumboWidth: 910, positions: capPos, preferred: [], options: { windowDays: 3, tolerance: 0 } });
assertEqual(maxOver(def, widthsOf) <= 3, true, 'cap #3472: дефолт — не более 3 ширин в резке');
assertEqual(maxOver(def, function(l){ return l.positionsCovered.length; }) <= 3, true, 'cap #3472: дефолт — не более 3 заказов в резке');
// все позиции по-прежнему покрыты (ограничение не теряет заказы).
var defCovered = {}; def.layouts.forEach(function(l){ l.positionsCovered.forEach(function(pid){ defCovered[pid] = 1; }); });
assertEqual(Object.keys(defCovered).length, 4, 'cap: все 4 заказа покрыты, несмотря на ограничение');

// жёстче (2): ни одна резка не превышает 2 ширин.
assertEqual(maxOver(capPlan(2), widthsOf) <= 2, true, 'cap #3472: maxWidthsPerCut=2 соблюдается');

console.log('\n' + passed + ' assertions passed');
