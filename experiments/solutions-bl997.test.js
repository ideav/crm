// Мерка к ideav/backlogram#997: подпись в шапке движка (.navbar-workspace) на портале «Решения».
// rules: none (defect backlogram#997)
const assert = require('assert');
const path = require('path');
const C = require(path.join(__dirname, '..', 'download', 'solutions', 'app.js'));

const CATALOG = 'Копируем любые решения и делаем их под вас';
const PRODUCT = 'Ваша персональная коробка';
const title = h => C.workspaceTitle(C.parseHash(h));

assert.strictEqual(typeof C.workspaceTitle, 'function', 'нет Core.workspaceTitle');
assert.strictEqual(title(''), CATALOG);
assert.strictEqual(title('#/'), CATALOG);
assert.strictEqual(title('#/?cat=2&q=x'), CATALOG);
assert.strictEqual(title('#/s/12'), PRODUCT);
assert.strictEqual(title('#/apply/12'), PRODUCT);
assert.strictEqual(title('#/apply'), CATALOG);
console.log('solutions-bl997: ok');
