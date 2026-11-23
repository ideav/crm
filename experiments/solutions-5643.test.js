// Мерка к issue #5643: портал «Решения» (download/solutions/app.js, templates/solutions/catalog.html).
// rules: none (defect #5643)
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const C = require(path.join(root, 'download', 'solutions', 'app.js'));

const row = (id, o) => Object.assign({ id, 'Решение': 'S' + id, 'Кратко': 'k', 'Боль': 'b', 'Что умеет': '- a\n2) b\n\n', 'Как переезжаем': 'x\r\ny',
  'Категория': { id: 1, val: 'К1' }, 'Отрасль': [{ id: 5, val: 'О5' }], 'Надстройка над': null, 'Демо ссылка': '', 'Демо скоро': '', 'Опубликовано': '1', 'Порядок': '' }, o);

// строки списков: маркеры снимаются, пустые уходят
assert.deepStrictEqual(C.splitLines('- a\n2) b\n\n  • c  '), ['a', 'b', 'c']);
assert.deepStrictEqual(C.splitLines(null), []);

// ссылки на демо: только http(s)
assert.strictEqual(C.safeUrl('https://ideav.ru/wfm/'), 'https://ideav.ru/wfm/');
assert.strictEqual(C.safeUrl('javascript:alert(1)'), '');
assert.strictEqual(C.safeUrl('https://x.ru/"onmouseover="a'), '');

// разбор записи: пустая ссылка, одиночная ссылка, порядок
const n = C.normalize(row(7, { 'Порядок': '3', 'Демо скоро': '1', 'Демо ссылка': 'https://ideav.ru/wfm/' }));
assert.strictEqual(n.order, 3); assert.strictEqual(n.demoSoon, true); assert.deepStrictEqual(n.platforms, []);
assert.deepStrictEqual(n.features, ['a', 'b']); assert.strictEqual(n.category.id, 1);
assert.strictEqual(C.normalize(row(8, { 'Категория': null })).category, null);

// порядок: по «Порядок», без него — в конец, затем по названию
const sorted = C.sortSolutions([row(1, { 'Решение': 'Я' }), row(2, { 'Порядок': '2', 'Решение': 'Б' }), row(3, { 'Порядок': '1', 'Решение': 'В' }), row(4, { 'Решение': 'А' })].map(C.normalize));
assert.deepStrictEqual(sorted.map(s => s.id), [3, 2, 4, 1]);

// фильтры: категория, отрасль, надстройка, поиск; неопубликованное не показывается никогда
const list = [
  row(1, { 'Решение': 'WFM табель', 'Надстройка над': [{ id: 9, val: '1С' }] }),
  row(2, { 'Категория': { id: 2, val: 'К2' }, 'Отрасль': [{ id: 6, val: 'О6' }, { id: 5, val: 'О5' }] }),
  row(3, { 'Опубликовано': '' })
].map(C.normalize);
const ids = f => C.filter(list, Object.assign({ cat: '', ind: '', plat: '', q: '' }, f)).map(s => s.id);
assert.deepStrictEqual(ids({}), [1, 2]);
assert.deepStrictEqual(ids({ cat: '2' }), [2]);
assert.deepStrictEqual(ids({ ind: '6' }), [2]);
assert.deepStrictEqual(ids({ plat: '9' }), [1]);
assert.deepStrictEqual(ids({ cat: '1', plat: '9' }), [1]);
assert.deepStrictEqual(ids({ q: 'табель' }), [1]);
assert.deepStrictEqual(ids({ ind: '99' }), []);

// адрес
assert.deepStrictEqual(C.parseHash('#/s/12'), { view: 'solution', id: 12 });
assert.deepStrictEqual(C.parseHash('#/apply/5'), { view: 'apply', id: 5 });
assert.deepStrictEqual(C.parseHash('#/apply'), { view: 'apply', id: 0 });
assert.deepStrictEqual(C.parseHash('#/?cat=2&q=%D1%82%D0%B0%D0%B1'), { view: 'catalog', q: { cat: '2', q: 'таб' } });
assert.strictEqual(C.parseHash('#/s/abc').view, 'catalog');
assert.strictEqual(C.buildHash({ cat: '2', q: 'а б' }), '#/?cat=2&q=%D0%B0%20%D0%B1');
assert.strictEqual(C.buildHash({}), '#/');

// заявка: имя и контакт обязательны, пустое необязательное не уходит, длина ограничена
assert.strictEqual(C.buildRequest({ name: ' ', contact: 'a@b.ru' }), null);
assert.deepStrictEqual(C.buildRequest({ name: 'И', contact: 'k', company: '', solution: '561', comment: '' }), { 'Заявка': 'И', 'Контакт': 'k', 'Решение': 561 });
assert.strictEqual(C.buildRequest({ name: 'И', contact: 'k', comment: 'x'.repeat(5000) })['Комментарий'].length, 3000);

// картинки: имя файла — только буквы, цифры, дефис; подпись «Автор | Сервис | URL»
assert.strictEqual(C.safeImg('s977-a1b2c3d4'), 's977-a1b2c3d4');
assert.strictEqual(C.safeImg('../x'), '');
assert.strictEqual(C.safeImg('a" onerror="x'), '');
assert.strictEqual(C.imgUrl('s1-ab12cd34', 's'), '/download/solutions/img/s1-ab12cd34-s.webp');
assert.strictEqual(C.imgUrl('s1-ab12cd34', 'l'), '/download/solutions/img/s1-ab12cd34-l.webp');
assert.deepStrictEqual(C.parseCredit('Иван Иванов | Unsplash | https://unsplash.com/photos/abc'), { author: 'Иван Иванов', service: 'Unsplash', url: 'https://unsplash.com/photos/abc' });
assert.deepStrictEqual(C.parseCredit('Автор | Pexels | javascript:1'), { author: 'Автор', service: 'Pexels', url: '' });
assert.strictEqual(C.parseCredit(''), null);
const withImg = C.normalize(row(9, { 'Картинка': 's9-aabbccdd', 'Источник изображения': 'А | Unsplash | https://unsplash.com/photos/x' }));
assert.strictEqual(withImg.img, 's9-aabbccdd'); assert.strictEqual(withImg.credit.author, 'А');
assert.strictEqual(C.normalize(row(10, {})).img, ''); assert.strictEqual(C.normalize(row(10, {})).credit, null);

// шаблон: нет фигурных скобок (точки вставки шаблонизатора), скрипт и стиль с версией
const tpl = fs.readFileSync(path.join(root, 'templates', 'solutions', 'catalog.html'), 'utf8');
assert.ok(!/[{}]/.test(tpl), 'в шаблоне есть { или }');
assert.ok(/download\/solutions\/app\.js\?v=\d+/.test(tpl) && /download\/solutions\/app\.css\?v=\d+/.test(tpl));
console.log('solutions-5643: ok');
