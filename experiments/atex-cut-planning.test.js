// Тесты ядра РМ «Расчёт резки» (ideav/atex#52, подзадача B). Без DOM/сети.
// Run: node experiments/atex-cut-planning.test.js
var calc = require('../download/atex/js/cut-planning.js').calc;
var passed = 0;
function eq(actual, expected, name){
  var ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log((ok?'PASS':'FAIL')+' — '+name);
  if (ok) passed++; else { console.log('  exp:',JSON.stringify(expected)); console.log('  got:',JSON.stringify(actual)); process.exitCode=1; }
}

var cand = [{width:80,freq:902},{width:60,freq:510},{width:40,freq:308},{width:30,freq:319},{width:50,freq:162}];

var r1 = calc.suggestCombination(880, 60, cand, 20);
eq(r1.strips, [{width:60,qty:14,purpose:'Заказ'},{width:40,qty:1,purpose:'Склад'}], 'ТЗ: 60x14 + 40x1');
eq(r1.remainder, 0, 'остаток 0');
eq(r1.withinTolerance, true, 'в допуске');

var r2 = calc.suggestCombination(880, 110, cand, 20);
eq(r2.strips, [{width:110,qty:8,purpose:'Заказ'}], '110x8 ровно');
eq(r2.remainder, 0, 'остаток 0 (ровно)');

var r3 = calc.suggestCombination(100, 97, [{width:50,freq:1}], 2);
eq(r3.remainder, 3, 'лучший возможный остаток 3');
eq(r3.withinTolerance, false, 'вне допуска');

var sigA = calc.combinationSignature('1', [{width:60,qty:14},{width:40,qty:1}]);
var sigB = calc.combinationSignature('1', [{width:40,qty:1},{width:60,qty:14}]);
eq(sigA, sigB, 'сигнатура не зависит от порядка полос');
var sigC = calc.combinationSignature('2', [{width:60,qty:14},{width:40,qty:1}]);
eq(sigA === sigC, false, 'другое сырьё → другая сигнатура');

console.log(passed + ' assertions passed');
