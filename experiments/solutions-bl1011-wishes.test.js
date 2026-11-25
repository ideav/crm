// Мерка к ideav/backlogram#1011: «Что ещё можно добавить» — первые 5 хотелок видны,
// остальные под спойлером «Показать ещё N»; строки экранируются, «Название — пояснение» делится.
// rules: none (defect #1011)
const assert = require('assert');
const path = require('path');
const C = require(path.join(__dirname, '..', 'download', 'solutions', 'app.js'));

const lines = ['Переходящие смены — часы делятся по дням', 'Вахта 15/15', 'Биржа смен', 'Т-7', 'Табель из СКУД', 'Обмен сменами', '<b>x</b>'];
const s = C.normalize({ id: '561', 'Решение': 'WFM', 'Опубликовано': '1', 'Хотелки': lines.join('\n') });
assert.strictEqual(s.wishes.length, 7);
assert.deepStrictEqual(s.wishes[0], { head: 'Переходящие смены', text: 'часы делятся по дням', ask: false });

const h = C.wishesHtml(s.wishes, '#/apply/561');
const [open, more] = h.split('<details class="sl-more">');
assert.strictEqual((open.match(/<li>/g) || []).length, 5, 'видно 5');
assert.ok(more, 'есть спойлер');
assert.ok(more.startsWith('<summary>Показать ещё 2</summary>'));
assert.strictEqual((more.match(/<li>/g) || []).length, 2);
assert.ok(h.includes('&lt;b&gt;x&lt;/b&gt;') && !h.includes('<b>x</b>'), 'экранирование');

// ровно 5 — без спойлера; пусто — пусто
assert.ok(!C.wishesHtml(s.wishes.slice(0, 5), '#').includes('<details'));
assert.strictEqual(C.wishesHtml([], '#'), '');
assert.deepStrictEqual(C.normalize({ id: '1' }).wishes, []);
console.log('solutions-bl1011-wishes: ok');
