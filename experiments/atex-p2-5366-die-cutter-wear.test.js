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
assert(near && near.share === 91 && near.after === 92 && String(near.text || '').length > 0, 'доля ресурса сейчас и после задания, текст для оператора есть', JSON.stringify(near));

var soon = W(88000, 3000, 100000);
assert(soon && soon.level === 'near', 'сейчас меньше 90 %, но за задание пробег дойдёт до 90 % — «у ресурса»', JSON.stringify(soon));
assert(soon && soon.share === 88 && soon.after === 91, 'прогноз после задания — от 90 %, сейчас меньше', JSON.stringify(soon));

var cross = W(98000, 5000, 100000);
assert(cross && cross.level === 'near' && cross.share === 98 && cross.after === 103,
    'за задание пробег перешагнёт ресурс — «у ресурса» с прогнозом выше 100 %', JSON.stringify(cross));

var over = W(100000, 0, 100000);
assert(over && over.level === 'over' && over.share === 100 && over.text !== (near && near.text), 'пробег не меньше ресурса — «ресурс выработан», свой текст', JSON.stringify(over));

// Оставшийся метраж задания: метраж задания − вырубленное по заданию.
assert(typeof DC.jobRemainingMeters === 'function', 'есть jobRemainingMeters');
if (typeof DC.jobRemainingMeters === 'function') {
    var runs = [{ jobId: '1', dieId: 'D1', meters: 400, kind: 'вырубка' }, { jobId: '1', dieId: 'D1', meters: 200, kind: 'вырубка' },
        { jobId: '2', dieId: 'D1', meters: 900, kind: 'вырубка' }, { jobId: '1', dieId: 'D1', meters: 5000, kind: 'начальный остаток' }];
    assert(DC.jobRemainingMeters({ id: '1', footage: 1000 }, runs) === 400, 'осталось = метраж − вырубка этого задания (начальный остаток не в счёт)', DC.jobRemainingMeters({ id: '1', footage: 1000 }, runs));
    assert(DC.jobRemainingMeters({ id: '1', footage: 500 }, runs) === 0, 'вырублено больше метража — осталось 0');
}

console.log('\nИтого: ' + pass + ' из ' + total);
