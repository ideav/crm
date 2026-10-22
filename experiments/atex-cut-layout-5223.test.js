// Unit-тесты #5223 — совмещение заказов в одной резке только с сохранением количества.
//
// Боевой случай #5223: заказ 6169 (позиции 105мм×800 и 60мм×100 — фактическая ширина
// 60→59 из «Фактической ширины резки» уже применена вызывающим) и заказ 6182 (80мм×110),
// джамбо 891. Раздельно 6169 даёт 115 прогонов ({105:7, 59:1}), 6182 — 10 прогонов
// ({80:11}, ровно 110 шт.). Слитно выгодно ({105:7, 80:1, 59:1} × 115 = −10 прогонов),
// но производство 6182 раздувается до 115 шт. вместо 110. Решение заказчика (#5223):
// совмещать заказы можно только при сохранении количества — слияние, меняющее
// производство любой заказанной ширины, запрещено, заказы режутся раздельно.
// Следствие модели (composeLayout пересчитывает полосы обеих сторон): сохраняющих
// количество И выгодных слияний для под-заказных ширин практически не бывает —
// слияния прекращаются. Это осознанная цена правила, принятая заказчиком.
//
// Run with: node experiments/atex-cut-layout-5223.test.js

var layout = require('../download/atex/js/cut-layout.js').layout;
var passed = 0;
function assertEqual(actual, expected, name){
  var ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log((ok?'PASS':'FAIL')+' — '+name);
  if(ok) passed++; else { console.log('  exp:',JSON.stringify(expected)); console.log('  got:',JSON.stringify(actual)); process.exitCode=1; }
}

// ── #5223: слияние, меняющее количество гостя, запрещено → две резки. ──
var r5223 = layout.planLayouts({
  jumboWidth: 891,
  positions: [
    { id: 'p6169_105', orderId: '6169', width: 105, qty: 800, dueKey: 20261027 },
    { id: 'p6169_59',  orderId: '6169', width: 59,  qty: 100, dueKey: 20261027 },
    { id: 'p6182_80',  orderId: '6182', width: 80,  qty: 110, dueKey: 20261027 }
  ],
  preferred: [],
  options: { windowDays: 3, tolerance: 0 }
});
assertEqual(r5223.layouts.length, 2, '#5223: заказы не сливаются (слияние меняет количество 6182)');

var own6169 = r5223.layouts.filter(function(l){ return layout.orderStripQty(l.strips, 105) > 0; })[0];
var own6182 = r5223.layouts.filter(function(l){ return layout.orderStripQty(l.strips, 80) > 0; })[0];
assertEqual(!!own6169 && !!own6182, true, '#5223: оба заказа получили свои резки');
assertEqual(own6182 ? layout.orderStripQty(own6182.strips, 80) : 0, 11, '#5223: 6182 — 11 полос 80мм');
assertEqual(own6182 ? layout.orderStripQty(own6182.strips, 80) * layout.layoutRuns(own6182.strips, { '80': 110 }) : 0,
            110, '#5223: 6182 — ровно 110 шт. (11 × 10 прогонов)');
// 6169 — собственная конфигурация ({105:7, 59:1} × 115): излишки 805/800 и 115/100 —
// следствие отсутствия правила 105→103,5 в «Фактической ширине резки» (вопрос данных,
// вне скоупа этого правила; здесь важно, что слияние не изменило производство 6182).
assertEqual(own6169 ? layout.orderStripQty(own6169.strips, 105) : 0, 7, '#5223: 6169 — 7 полос 105мм');
assertEqual(own6169 ? layout.orderStripQty(own6169.strips, 59) : 0, 1, '#5223: 6169 — 1 полоса 59мм');

// ── Слияние, меняющее количество ОБЕИХ сторон (204 шт. → 201), тоже запрещено. ──
var mirror = layout.planLayouts({
  jumboWidth: 300,
  positions: [
    { id: 'a', orderId: 'A', width: 100, qty: 100, dueKey: 20261027 },
    { id: 'b', orderId: 'B', width: 100, qty: 100, dueKey: 20261027 }
  ],
  preferred: [],
  options: { windowDays: 3, tolerance: 0 }
});
assertEqual(mirror.layouts.length, 2, 'зеркальный случай: слияние 204→201 запрещено → две резки');
assertEqual(mirror.layouts.every(function(l){
  return layout.orderStripQty(l.strips, 100) === 3 && layout.layoutRuns(l.strips, { '100': 100 }) === 34;
}), true, 'зеркальный случай: каждая сторона — свои 3 полосы × 34 прогона (=102 шт.)');

// ── Резка ОДНОГО заказа правилом не тронута (seed «1 заказ = 1 резка», #4757). ──
var own = layout.planLayouts({
  jumboWidth: 891,
  positions: [
    { id: 'q105', orderId: '6169', width: 105, qty: 800, dueKey: 20261027 },
    { id: 'q59',  orderId: '6169', width: 59,  qty: 100, dueKey: 20261027 }
  ],
  preferred: [],
  options: { windowDays: 3, tolerance: 0 }
});
assertEqual(own.layouts.length, 1, 'один заказ — одна резка (без слияний)');
assertEqual(layout.orderStripQty(own.layouts[0].strips, 105), 7, 'один заказ: 7 полос 105мм');
assertEqual(layout.orderStripQty(own.layouts[0].strips, 59), 1, 'один заказ: 1 полоса 59мм');

console.log('\n' + passed + ' проверок прошли');
