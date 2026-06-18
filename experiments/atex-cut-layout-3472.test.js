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

// ── Слияние ПО ВЫГОДЕ: 110×50 + 70×30. Раздельно 110 даёт скрап (8×7=56, −50=6),
//    слитно 5×110+3×70 (10 прогонов, скрап 0) — те же прогоны, меньше скрапа → слить.
var merge = layout.planLayouts({
  jumboWidth: 910,
  positions: [
    { id: 'a', width: 110, qty: 50, dueKey: 20260601 },
    { id: 'b', width: 70,  qty: 30, dueKey: 20260601 }
  ],
  preferred: [{ width: 50, popularity: 8 }],
  options: { windowDays: 3, tolerance: 0 }
});
assertEqual(merge.layouts.length, 1, 'merge: 110+70 выгодно слить (меньше скрапа) → одна раскладка');
assertEqual(merge.layouts[0].positionsCovered.slice().sort(), ['a', 'b'], 'merge: обе позиции в одной резке');

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

console.log('\n' + passed + ' assertions passed');
