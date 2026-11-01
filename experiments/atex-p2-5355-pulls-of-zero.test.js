// #5355 (D7): у задания без «Съёмов план» нигде не пишем «из 0».
// pullsCaption/pullsCount (заголовок, очередь) сделаны в #5339; здесь — окно «Закрыть задание?».
var DC = require('../download/atex-p2/js/die-cutter.js').core;

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

assert(typeof DC.finishSummary === 'function', 'есть finishSummary (текст окна «Закрыть задание?»)');
if (typeof DC.finishSummary === 'function') {
    var noPlan = DC.finishSummary({ done: 3, plan: 0 });
    assert(!/из\s*0/.test(noPlan) && /3/.test(noPlan), 'нет плана — «Съёмов 3» без «из 0»', noPlan);
    assert(!/План не выполнен/.test(noPlan), 'нет плана — не пишем «План не выполнен»', noPlan);
    var under = DC.finishSummary({ done: 2, plan: 5 });
    assert(/2 из 5/.test(under) && /План не выполнен/.test(under), 'план есть, не выполнен — «Съёмов 2 из 5. План не выполнен.»', under);
    var full = DC.finishSummary({ done: 5, plan: 5 });
    assert(/5 из 5/.test(full) && !/План не выполнен/.test(full), 'план выполнен — без предупреждения', full);
}
console.log('\n' + passed + '/' + total + ' проверок пройдено.');
