// Unit-тесты #3706/#3684 — минимизация отхода при подборе: seed «1 заказ = 1 резка»
// по ключу (ЗАКАЗ, ширина). Одинаковая ширина РАЗНЫХ заказов больше не склеивается
// принудительно на seed (иначе перебор по ширине джамбо → лишний прогон + почти пустая
// резка-сирота с отходом вне допуска). Цель оптимизатора: прогоны → скрап → ОТХОД.
//
// Run with: node experiments/atex-cut-layout-3706.test.js

var layout = require('../download/atex/js/cut-layout.js').layout;
var passed = 0;
function assertEqual(actual, expected, name){
  var ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log((ok?'PASS':'FAIL')+' — '+name);
  if(ok) passed++; else { console.log('  exp:',JSON.stringify(expected)); console.log('  got:',JSON.stringify(actual)); process.exitCode=1; }
}
function sortedCover(l){ return l.positionsCovered.slice().sort(); }
function coverKey(l){ return sortedCover(l).join(','); }

// ── РЕПРО #3684: MWR116L, джамбо 891, допуск 20. Заказы 3346 (33×27) и 3347
//    (33×7 + 34×3 + 55×10). Менеджер: 2 резки, 2 прогона, отход 0 и 8 (в допуске).
//    Регресс до фикса: seed по ширине склеивал 33 двух заказов → 3 прогона + резка
//    34×3 на 102/891 (отход 789, ВНЕ допуска). ──
var r3684 = layout.planLayouts({
  jumboWidth: 891,
  positions: [
    { id: '91747', orderId: '3346', width: 33, qty: 27, dueKey: 20260601 },
    { id: '91748', orderId: '3347', width: 33, qty: 7,  dueKey: 20260601 },
    { id: '91749', orderId: '3347', width: 34, qty: 3,  dueKey: 20260601 },
    { id: '91750', orderId: '3347', width: 55, qty: 10, dueKey: 20260601 }
  ],
  preferred: [],
  options: { windowDays: 3, tolerance: 20 }
});

assertEqual(r3684.layouts.length, 2, '#3684: ровно 2 резки (как у менеджера, не 3)');
assertEqual(r3684.layouts.map(coverKey).sort(), ['91747', '91748,91749,91750'],
  '#3684: заказ 3346 — отдельная резка; все позиции заказа 3347 — в одной резке');

// КЛЮЧЕВАЯ цель #3706: ни одной резки с отходом ВНЕ допуска.
var anyOutOfTol = r3684.layouts.some(function(l){ return !l.withinTolerance; });
assertEqual(anyOutOfTol, false, '#3706: нет резок с отходом вне допуска (остатки 0 и 8 ≤ 20)');
// Нет осиротевшей резки 34×3 (одна позиция 91749 в своей резке).
var orphan = r3684.layouts.some(function(l){ return coverKey(l) === '91749'; });
assertEqual(orphan, false, '#3684: нет резки-сироты 34×3 (789 мм отхода)');
// Заказ не дроблён: каждая позиция ровно в одной резке.
var seen = {}, split = false;
r3684.layouts.forEach(function(l){ l.positionsCovered.forEach(function(p){ if (seen[p]) split = true; seen[p] = 1; }); });
assertEqual(split, false, '#3684: ни одна позиция не дроблена на две резки');
// Суммарный отход (Σ остатков) минимален = 8 (0 + 8), как у менеджера.
var totalRem = r3684.layouts.reduce(function(a, l){ return a + l.remainder; }, 0);
assertEqual(layout.round3(totalRem), 8, '#3684: суммарный отход 8 мм (менеджерский оптимум)');

// ── Одинаковая ширина ОДНОГО заказа — консолидируется в одну резку (один продукт). ──
var sameOrder = layout.planLayouts({
  jumboWidth: 200,
  positions: [
    { id: 'x1', orderId: 'A', width: 50, qty: 5, dueKey: 20260601 },
    { id: 'x2', orderId: 'A', width: 50, qty: 5, dueKey: 20260601 }
  ],
  preferred: [],
  options: { windowDays: 3, tolerance: 0 }
});
assertEqual(sameOrder.layouts.length, 1, 'один заказ, одинаковая ширина → одна резка (консолидация)');
assertEqual(sortedCover(sameOrder.layouts[0]), ['x1', 'x2'], 'обе позиции заказа в одной резке');

// ── Одинаковая ширина РАЗНЫХ заказов: НЕ склеиваем, если это не экономит прогоны.
//    Заказ A 50×4 (ровно заполняет джамбо 200, 1 прогон, отход 0); заказ B 50×4 — своя
//    резка. Склейка дала бы {50:8} → 2 прогона (как 1+1), без выгоды → раздельно. ──
var diffOrderNoGain = layout.planLayouts({
  jumboWidth: 200,
  positions: [
    { id: 'a', orderId: 'A', width: 50, qty: 4, dueKey: 20260601 },
    { id: 'b', orderId: 'B', width: 50, qty: 4, dueKey: 20260601 }
  ],
  preferred: [],
  options: { windowDays: 3, tolerance: 0 }
});
assertEqual(diffOrderNoGain.layouts.length, 2, 'разные заказы, одинаковая ширина без выгоды → 2 резки (не склеены)');
assertEqual(diffOrderNoGain.layouts.every(function(l){ return l.remainder === 0; }), true,
  'разные заказы: каждая резка заполнена (отход 0)');

// ── Одинаковая ширина РАЗНЫХ заказов: склеиваем, ЕСЛИ это экономит прогоны.
//    A 50×5 + B 50×5: раздельно 2+2=4 прогона; слитно {50:10}=3 прогона → склеить. ──
var diffOrderGain = layout.planLayouts({
  jumboWidth: 200,
  positions: [
    { id: 'a', orderId: 'A', width: 50, qty: 5, dueKey: 20260601 },
    { id: 'b', orderId: 'B', width: 50, qty: 5, dueKey: 20260601 }
  ],
  preferred: [],
  options: { windowDays: 3, tolerance: 0 }
});
assertEqual(diffOrderGain.layouts.length, 1, 'разные заказы, склейка экономит прогон → 1 резка (по выгоде)');

// ── Обратная совместимость: позиции БЕЗ orderId → seed по позиции (как было).
//    Эталон #3472: 110×80 + 89×80, джамбо 910 → 2 раздельные резки (18 прогонов). ──
var noOrderId = layout.planLayouts({
  jumboWidth: 910,
  positions: [
    { id: '3673', width: 110, qty: 80, dueKey: 20260601 },
    { id: '3672', width: 89,  qty: 80, dueKey: 20260601 }
  ],
  preferred: [],
  options: { windowDays: 3, tolerance: 0 }
});
assertEqual(noOrderId.layouts.length, 2, 'без orderId: seed по позиции — 110 и 89 раздельно (#3472)');
assertEqual(noOrderId.layouts.map(coverKey).sort(), ['3672', '3673'], 'без orderId: каждая позиция — своя резка');

console.log('\n' + passed + ' assertions passed');
