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

console.log('\n' + passed + ' assertions passed');
