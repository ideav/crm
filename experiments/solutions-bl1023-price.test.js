// backlogram#1023: ориентир цены не кратен тысяче (18 750–93 750 ₽) — выводится до рубля, без округления до тысяч.
const assert = require('assert');
const path = require('path');
const C = require(path.join(__dirname, '..', 'download', 'solutions', 'app.js'));
const txt = p => C.priceText(p).replace(/ /g, ' '); // в выводе неразрывные пробелы

assert.strictEqual(txt(C.price('18.75', '93.75')), 'от 18 750 до 93 750 ₽');
assert.strictEqual(txt(C.price('18,75', '')), 'от 18 750 ₽');
assert.strictEqual(txt(C.price('150', '300')), 'от 150 000 до 300 000 ₽');
assert.strictEqual(txt(C.price('110.00', '210.00')), 'от 110 000 до 210 000 ₽');
assert.strictEqual(C.price('', '50'), null);
console.log('ok solutions-bl1023-price');
