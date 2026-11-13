// ideav/crm#5506 — «Записать» при импорте ножей недоступна, хотя ножи распознаны.
//
// Кнопка неактивна, когда плану нечего писать (все строки совпадают с базой), но строка состояния
// всё равно звала «нажмите „Записать“» — пользователь видел распознанные ножи и мёртвую кнопку без
// объяснения. Сообщение после сверки (planVerdict) обязано:
//   1. при пустом плане — сказать, что записывать нечего, и почему (сколько строк совпало с базой,
//      сколько с ошибками и дублями), и не звать нажимать «Записать»;
//   2. если ни у одного ножа нет пробега — сказать, откуда пробег берётся (колонка «Пробег» листа
//      «Ножи» или лист «План»), и что листа «План» в книге нет, когда его нет;
//   3. при непустом плане — звать нажать «Записать» с числом новых и обновляемых.
//
// Run with: node experiments/atex-p2-5506-nothing-to-write.test.js

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

var LI = require('../download/atex-p2/js/label-import-core.js');
assert(typeof LI.planVerdict === 'function', 'label-import-core экспортирует planVerdict');
if (typeof LI.planVerdict !== 'function') { console.log('\n' + passed + '/' + total + ' passed'); return; }

function counts(o) {
    var c = { new: 0, update: 0, same: 0, duplicate: 0, error: 0, warnings: 0 };
    Object.keys(o || {}).forEach(function(k) { c[k] = o[k]; });
    return c;
}
function knifeRows(n, mileage) {
    var rows = [];
    for (var i = 0; i < n; i++) rows.push({ row: i + 2, key: String(700000 + i), status: 'same', mileage: mileage });
    return rows;
}

// 1. Случай из тикета: 13 ножей без изменений, пробега нет, листа «План» нет.
var v = LI.planVerdict('knives', { rows: knifeRows(13, null), counts: counts({ same: 13 }), ops: [] }, { planSheet: false });
assert(v.kind !== 'error', 'пустой план — не ошибка', JSON.stringify(v));
assert(!/нажмите «Записать»/.test(v.text), 'пустой план не зовёт нажать «Записать»', v.text);
assert(/нечего/i.test(v.text), 'пустой план: сказано, что записывать нечего', v.text);
assert(/13/.test(v.text) && /совпада/.test(v.text), 'названо, сколько строк совпало с базой', v.text);
assert(/Пробег/.test(v.text) && /План/.test(v.text), 'названо, откуда берётся пробег', v.text);
assert(/листа «План» в книге нет/.test(v.text), 'сказано, что листа «План» в книге нет', v.text);

// 2. Лист «План» есть, но пробега нет ни у одного ножа — про отсутствие листа не врём.
v = LI.planVerdict('knives', { rows: knifeRows(3, null), counts: counts({ same: 3 }), ops: [] }, { planSheet: true });
assert(!/листа «План» в книге нет/.test(v.text), 'лист «План» есть — не пишем, что его нет', v.text);
assert(/Пробег/.test(v.text), 'пробега нет ни у одного ножа — сказано', v.text);

// 3. Пробег есть и совпадает — про пробег молчим.
v = LI.planVerdict('knives', { rows: knifeRows(3, 5000), counts: counts({ same: 3 }), ops: [] }, { planSheet: true });
assert(!/Пробег/.test(v.text), 'пробег в файле есть — про источник пробега молчим', v.text);

// 4. Пустой план из ошибок и дублей — названы.
v = LI.planVerdict('knives', { rows: [], counts: counts({ error: 2, duplicate: 1 }), ops: [] }, { planSheet: false });
assert(/ошиб/.test(v.text) && /2/.test(v.text), 'названо число строк с ошибками', v.text);
assert(/дубл/.test(v.text), 'названы дубли', v.text);

// 5. Непустой план — зовём «Записать».
v = LI.planVerdict('knives', { rows: knifeRows(2, null), counts: counts({ new: 1, update: 1 }), ops: [{}, {}] }, { planSheet: true });
assert(/«Записать»/.test(v.text) && !/нечего/i.test(v.text), 'непустой план зовёт нажать «Записать»', v.text);

// 6. Заказы: пустой план — то же правило, без речи о пробеге.
v = LI.planVerdict('orders', { rows: [], counts: counts({ same: 4, ordersNew: 0 }), ops: [] }, {});
assert(/нечего/i.test(v.text) && !/Пробег/.test(v.text), 'заказы: пустой план — «нечего», без пробега', v.text);

console.log('\n' + passed + '/' + total + ' passed');
