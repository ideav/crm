// Мерка к ideav/backlogram#1016: на странице решения — готовые блоки, идеи кастомизации,
// ориентир цены и срока, публичные цены коробок; пункт с «?» ведёт в заявку по решению.
// rules: none (defect #1016)
const assert = require('assert');
const path = require('path');
const C = require(path.join(__dirname, '..', 'download', 'solutions', 'app.js'));

const s = C.normalize({
  id: '561', 'Решение': 'WFM', 'Опубликовано': '1',
  'Наборные блоки': 'График смен — проверки ТК и покрытие\nТабель Т-13',
  'Идеи кастомизации': 'Своя формула премии\n? Обмен с вашей ЗУП — зависит от доработок',
  'Цена от': '150', 'Цена до': '300.00', 'Срок': '2–4 недели',
  'Цены конкурентов': 'Naumen WFM — от 30 000 ₽/мес | https://www.naumen.ru/x\nбез цены\nX — 1 ₽ | javascript:alert(1)'
});

assert.deepStrictEqual(s.blocks[0], { head: 'График смен', text: 'проверки ТК и покрытие', ask: false });
assert.deepStrictEqual(s.blocks[1], { head: '', text: 'Табель Т-13', ask: false });
assert.deepStrictEqual(s.ideas[1], { head: 'Обмен с вашей ЗУП', text: 'зависит от доработок', ask: true });
assert.deepStrictEqual(s.price, { from: 150, to: 300 });
assert.strictEqual(C.priceText(s.price), 'от 150 000 до 300 000 ₽');
assert.strictEqual(C.priceText({ from: 200, to: 0 }), 'от 200 000 ₽');
assert.strictEqual(s.term, '2–4 недели');
assert.strictEqual(s.competitors.length, 2, 'строка без « — » (без цены) не показывается');
assert.strictEqual(s.competitors[0].url, 'https://www.naumen.ru/x');
assert.strictEqual(s.competitors[1].url, '', 'не-http ссылка отбрасывается');

// «?» → ссылка «Обсудим на звонке» на заявку по этому решению, обычный пункт — без ссылки
const ideas = C.itemsHtml(s.ideas, '#/apply/561');
assert.ok(ideas.indexOf('<li>Своя формула премии</li>') >= 0, ideas);
assert.ok(ideas.indexOf('<b>Обмен с вашей ЗУП</b> — зависит от доработок <a class="sl-ask" href="#/apply/561">') >= 0, ideas);
assert.strictEqual((ideas.match(/sl-ask/g) || []).length, 1);

const price = C.priceHtml(s, '#/apply/561');
assert.ok(price.indexOf('от 150 000 до 300 000 ₽') > 0, price);
assert.ok(price.indexOf('2–4 недели') > 0);
assert.ok(price.indexOf('href="#/apply/561">Заказать звонок') > 0);
assert.ok(price.indexOf('rel="noopener nofollow">источник') > 0);
assert.ok(price.indexOf('javascript:') < 0);

// без цены и срока — блока нет; поля без значений не ломают нормализацию
const empty = C.normalize({ id: '1', 'Решение': 'X', 'Опубликовано': '1' });
assert.strictEqual(C.priceHtml(empty, '#/apply/1'), '');
assert.deepStrictEqual([empty.blocks, empty.ideas, empty.competitors, empty.price], [[], [], [], null]);

// экранирование текстов из базы
const x = C.itemsHtml(C.items('<b>а</b> — <i>б</i>'), '#');
assert.ok(x.indexOf('<b>&lt;b&gt;а&lt;/b&gt;</b> — &lt;i&gt;б&lt;/i&gt;') > 0, x);
console.log('solutions-bl1016: ok');
