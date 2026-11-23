// Мерка к ideav/backlogram#999: бейджи .sl-tag на странице решения — ссылки в каталог с фильтром.
// rules: none (defect #5656)
const assert = require('assert');
const path = require('path');
const C = require(path.join(__dirname, '..', 'download', 'solutions', 'app.js'));

assert.strictEqual(typeof C.tagHref, 'function', 'нет Core.tagHref');
assert.strictEqual(C.tagHref('solutions', 'cat', 7), '/solutions/catalog#/?cat=7');
assert.strictEqual(C.tagHref('solutions', 'ind', 964), '/solutions/catalog#/?ind=964');
assert.strictEqual(C.tagHref('solutions', 'plat', 966), '/solutions/catalog#/?plat=966');
// ссылка открывает каталог и фильтр доходит до parseLocation
const r = C.parseLocation('/solutions/catalog', '#/?ind=964');
assert.strictEqual(r.view, 'catalog');
assert.strictEqual(r.q.ind, '964');
console.log('solutions-bl999: ok');
