// #5366 п.2: у предела ресурса ножа пульт высечки предупреждает оператора — нож может
// перестать выбивать все этикетки. Ресурс — у марки ножа, без марки — DIE_RESOURCE_DEFAULT_M;
// «у ресурса» — от 90 %, «выработан» — от 100 % (dieWearLevel, label-production.js).
// Прогноз — пробег сейчас + оставшийся метраж задания.
'use strict';

var DC = require('../download/atex-p2/js/die-cutter.js').core;

var pass = 0, total = 0;
function assert(cond, msg, extra) {
    total++;
    if (cond) { pass++; console.log('PASS — ' + msg); }
    else { console.log('FAIL — ' + msg + (extra !== undefined ? '  ' + extra : '')); process.exitCode = 1; }
}

assert(typeof DC.dieWearNotice === 'function', 'есть dieWearNotice');
var W = typeof DC.dieWearNotice === 'function' ? DC.dieWearNotice : function() { return null; };

// ресурс 100 000 м
assert(W(50000, 1000, 100000) === null, 'далеко от ресурса и после задания — предупреждения нет');
assert(W(50000, 0, 0) === null && W(95000, 0, NaN) === null, 'ресурс не определён — предупреждения нет');

var near = W(91000, 1000, 100000);
assert(near && near.level === 'near', 'пробег от 90 % ресурса — «у ресурса»', JSON.stringify(near));
assert(near && /внимательн/i.test(near.text) && /выбива/i.test(near.text), 'текст: быть внимательнее, нож может перестать выбивать этикетки', near && near.text);
assert(near && /91\s?%/.test(near.text), 'текст: доля ресурса в процентах', near && near.text);

var soon = W(88000, 3000, 100000);
assert(soon && soon.level === 'near', 'сейчас меньше 90 %, но за задание пробег дойдёт до 90 % — «у ресурса»', JSON.stringify(soon));
assert(soon && /после задания/i.test(soon.text), 'текст: прогноз после задания', soon && soon.text);

var cross = W(98000, 5000, 100000);
assert(cross && cross.level === 'near' && /после задания/i.test(cross.text) && /103\s?%/.test(cross.text),
    'за задание пробег перешагнёт ресурс — «у ресурса» с прогнозом выше 100 %', cross && cross.text);

var over = W(100000, 0, 100000);
assert(over && over.level === 'over' && /выработал/i.test(over.text) && /внимательн/i.test(over.text) && /выбива/i.test(over.text), 'пробег не меньше ресурса — «ресурс выработан»', over && over.text);

// Оставшийся метраж задания: метраж задания − вырубленное по заданию.
assert(typeof DC.jobRemainingMeters === 'function', 'есть jobRemainingMeters');
if (typeof DC.jobRemainingMeters === 'function') {
    var runs = [{ jobId: '1', dieId: 'D1', meters: 400, kind: 'вырубка' }, { jobId: '1', dieId: 'D1', meters: 200, kind: 'вырубка' },
        { jobId: '2', dieId: 'D1', meters: 900, kind: 'вырубка' }, { jobId: '1', dieId: 'D1', meters: 5000, kind: 'начальный остаток' }];
    assert(DC.jobRemainingMeters({ id: '1', footage: 1000 }, runs) === 400, 'осталось = метраж − вырубка этого задания (начальный остаток не в счёт)', DC.jobRemainingMeters({ id: '1', footage: 1000 }, runs));
    assert(DC.jobRemainingMeters({ id: '1', footage: 500 }, runs) === 0, 'вырублено больше метража — осталось 0');
}

console.log('\nИтого: ' + pass + ' из ' + total);
