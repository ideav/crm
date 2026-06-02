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

console.log('\n' + passed + ' assertions passed');
