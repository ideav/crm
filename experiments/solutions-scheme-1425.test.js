// Мерка к ideav/python2node#1425: схема в конце страницы решения (реквизиты «Схема» и «Подпись схемы»).
// rules: none (defect #1425)
const assert = require('assert');
const path = require('path');
const C = require(path.join(__dirname, '..', 'download', 'solutions', 'app.js'));

const row = extra => Object.assign({ id: '952', 'Решение': 'LLM-маршрутизатор', 'Опубликовано': '1' }, extra);

// реквизиты разбираются в s.scheme; имя файла — по тем же правилам, что у «Картинки»
const s = C.normalize(row({ 'Схема': 's1425g-0a1b2c3d', 'Подпись схемы': 'Страж <данных> & модель' }));
assert.deepStrictEqual(s.scheme, { img: 's1425g-0a1b2c3d', caption: 'Страж <данных> & модель' });
assert.strictEqual(C.normalize(row({})).scheme, null, 'без схемы — null');
assert.strictEqual(C.normalize(row({ 'Схема': '../x.svg' })).scheme, null, 'чужое имя файла не принимается');
assert.strictEqual(C.normalize(row({ 'Схема': 's1-ab12cd34', 'Подпись схемы': '' })).scheme.caption, '');

// разметка: крупная картинка схемы, подпись экранирована, без схемы — пусто
const html = C.schemeFigure(s.scheme, s.title);
assert.ok(html.indexOf('src="/download/solutions/img/s1425g-0a1b2c3d-l.webp"') > 0, html);
assert.ok(html.indexOf('<figcaption class="sl-scheme-cap">Страж &lt;данных&gt; &amp; модель</figcaption>') > 0, html);
assert.ok(html.indexOf('<данных>') < 0, 'подпись не экранирована');
assert.ok(/^<figure class="sl-scheme">/.test(html), html);
assert.ok(C.schemeFigure({ img: 's1-ab12cd34', caption: '' }, 'T').indexOf('figcaption') < 0, 'пустая подпись — без figcaption');
assert.strictEqual(C.schemeFigure(null, 'T'), '');
console.log('solutions-scheme-1425: ok');
