var layout = require('../download/atex/js/cut-layout.js').layout;
var passed = 0;
function assertEqual(actual, expected, name){
  var ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log((ok?'PASS':'FAIL')+' — '+name);
  if(ok) passed++; else { console.log('  exp:',JSON.stringify(expected)); console.log('  got:',JSON.stringify(actual)); process.exitCode=1; }
}

// ───────────────────────── Task 1: хелперы ─────────────────────────
assertEqual(layout.toNumber('12.5'), 12.5, 'toNumber строки');
assertEqual(layout.toNumber(''), 0, 'toNumber пусто → 0');
assertEqual(layout.round3(1/3), 0.333, 'round3');
// dayDiff: разница в днях между ГГГГММДД-ключами (упрощённо через Date)
assertEqual(layout.dayDiff(20260601, 20260604), 3, 'dayDiff 3 дня');
assertEqual(layout.dayDiff(20260601, 20260601), 0, 'dayDiff 0');

// ───────────────────────── Task 2: dueWindowGroups ─────────────────────────
function p(id,w,q,due){ return {id:id,width:w,qty:q,dueKey:due}; }
// в пределах 3 дней → один кластер (сортировка по dueKey)
var g1 = layout.dueWindowGroups([p('a',110,50,20260604), p('b',70,30,20260601)], 3);
assertEqual(g1.map(function(c){return c.map(function(x){return x.id;});}), [['b','a']], 'окно 3д: один кластер, сортирован по сроку');
// за окном → разные кластеры
var g2 = layout.dueWindowGroups([p('a',110,1,20260601), p('c',50,1,20260610)], 3);
assertEqual(g2.map(function(c){return c.map(function(x){return x.id;});}), [['a'],['c']], 'за окном → два кластера');
// без срока (Infinity) → отдельный последний кластер
var g3 = layout.dueWindowGroups([p('a',110,1,20260601), p('z',40,1,Infinity)], 3);
assertEqual(g3.map(function(c){return c.map(function(x){return x.id;});}), [['a'],['z']], 'без срока → отдельный кластер');
// вход не мутируется
var src=[p('a',110,1,20260601)]; layout.dueWindowGroups(src,3); assertEqual(src.length,1,'вход не мутируется');

// ───────────────────────── Task 3: bestFill + composeLayout ─────────────────────────
function d(w,q,pid){ return {width:w,qty:q,positionId:pid}; }
// bestFill (как в B): добрать остаток ходовыми, мин. отход
var bf = layout.bestFill(100, [{width:60,popularity:10},{width:40,popularity:5}], 0);
assertEqual(bf.leftover, 0, 'bestFill: 60+40 → 0 отход');
// composeLayout: джамбо 910, заказы 110(qty50) и 70(qty30)
var L = layout.composeLayout(910, [d(110,50,'a'), d(70,30,'b')], [{width:50,popularity:8}], 0);
// каждая заказанная ширина ≥1 полоса 'Заказ'
assertEqual(L.strips.filter(function(s){return s.purpose==='Заказ'&&s.width===110;}).length>0
  && L.strips.filter(function(s){return s.purpose==='Заказ'&&s.width===70;}).length>0, true, 'composeLayout: обе заказанные ширины есть');
// used + remainder == jumbo
assertEqual(layout.round3(L.used + L.remainder), 910, 'used+remainder=джамбо');
// 110 дозаполнена по спросу: спрос 50>30 → полос 110 строго больше, чем 70
var q110 = L.strips.filter(function(s){return s.width===110&&s.purpose==='Заказ';}).reduce(function(a,s){return a+s.qty;},0);
var q70 = L.strips.filter(function(s){return s.width===70&&s.purpose==='Заказ';}).reduce(function(a,s){return a+s.qty;},0);
assertEqual(q110 > q70 && q110 >= 2, true, 'composeLayout: 110 дозаполнена по спросу (qty110>qty70, >1)');
// джамбо заполнен без отхода (110×k + 70×m + добор = 910)
assertEqual(L.remainder, 0, 'composeLayout: отход 0 (джамбо заполнен)');
// overflow: ширина шире джамбо → в overflow, не в strips
var L2 = layout.composeLayout(100, [d(120,5,'x'), d(40,5,'y')], [], 0);
assertEqual(L2.overflow.map(function(o){return o.positionId;}), ['x'], 'composeLayout: 120 шире 100 → overflow');
assertEqual(L2.strips.some(function(s){return s.width===40;}), true, '40 уложена');
// вход не мутируется
var dm=[d(110,1,'a')]; layout.composeLayout(910, dm, [], 0); assertEqual(dm.length,1,'вход не мутируется');

// #3423: «резать под заказ» — раскладка не должна раздувать ширину из-за ОБЩЕГО числа
// прогонов. Заказы 59мм(60шт) + 30мм(29шт), джамбо 910. Прежде шаг (c) набивал джамбо по
// абсолютному спросу: 14×59 + 2×30; прогонов = max(⌈60/14⌉, ⌈29/2⌉) = 15 → 59мм 14×15 =
// 210шт (в 3.5 раза больше заказа). Теперь — минимум прогонов R, при котором по ⌈спрос/R⌉
// полос каждой ширины влезают в джамбо: 12×59 + 6×30, прогонов 5 → 59мм 60, 30мм 30.
var L3423 = layout.composeLayout(910, [d(59,60,'p3089'), d(30,29,'p3090')], [], 0);
function ordQty(L, w){ return L.strips.filter(function(s){return s.width===w&&s.purpose==='Заказ';}).reduce(function(a,s){return a+s.qty;},0); }
var s59 = ordQty(L3423, 59), s30 = ordQty(L3423, 30);
// общий счётчик прогонов раскладки (как plannedRunsForLayout): max ⌈спрос/полос⌉
var runs3423 = Math.max(Math.ceil(60/s59), Math.ceil(29/s30));
assertEqual({s59:s59, s30:s30, runs:runs3423}, {s59:12, s30:6, runs:5}, 'composeLayout #3423: 12×59 + 6×30, прогонов 5');
assertEqual(s59*runs3423, 60, 'composeLayout #3423: 59мм нарезано ровно под заказ (60, не 210)');
assertEqual(s30*runs3423 >= 29 && s30*runs3423 <= 32, true, 'composeLayout #3423: 30мм покрывает заказ (29) без раздувания (≤ +10%)');
// #3423: запасные комбинации (stockable, есть в «Максимальном запасе») — наоборот, можно
// перепроизводить в запас: прежняя жадная набивка джамбо (14×59 + 2×30, прогонов 15).
function ds(w,q,pid){ return {width:w,qty:q,positionId:pid,stockable:true}; }
var Lstock = layout.composeLayout(910, [ds(59,60,'p1'), ds(30,29,'p2')], [], 0);
var s59s = ordQty(Lstock, 59), s30s = ordQty(Lstock, 30);
var runsStock = Math.max(Math.ceil(60/s59s), Math.ceil(29/s30s));
assertEqual({s59:s59s, s30:s30s}, {s59:14, s30:2}, 'composeLayout #3423: запасные — жадная набивка джамбо (14×59 + 2×30)');
assertEqual(s59s*runsStock, 210, 'composeLayout #3423: запасную ширину можно перепроизводить в запас (210)');

// ───────────────────────── Task 4: planLayouts + combinationSignature ─────────────────────────
// combinationSignature детерминированный ключ
assertEqual(layout.combinationSignature('M',[{width:70,qty:2},{width:110,qty:1}]),
            layout.combinationSignature('M',[{width:110,qty:1},{width:70,qty:2}]), 'signature не зависит от порядка');
// planLayouts: объединяет окно, overflow → доп. раскладка, skipped для слишком широких
var res = layout.planLayouts({
  jumboWidth: 910,
  positions: [ {id:'a',width:110,qty:50,dueKey:20260601}, {id:'b',width:70,qty:30,dueKey:20260603}, {id:'big',width:1000,qty:1,dueKey:20260601} ],
  preferred: [{width:50,popularity:8}],
  options: { windowDays:3, tolerance:0 }
});
assertEqual(res.layouts.length, 1, 'planLayouts: a+b (одно окно) → ровно одна раскладка');
assertEqual(res.layouts[0].positionsCovered.indexOf('a')>=0 && res.layouts[0].positionsCovered.indexOf('b')>=0, true, 'a и b в одной раскладке (окно)');
assertEqual(res.skipped.map(function(s){return s.positionId;}), ['big'], 'big (шире джамбо) → skipped');
// чистота
var inp={jumboWidth:910,positions:[{id:'a',width:110,qty:1,dueKey:20260601}],preferred:[],options:{}};
layout.planLayouts(inp); assertEqual(inp.positions.length,1,'planLayouts вход не мутируется');

console.log('\n' + passed + ' assertions passed');
