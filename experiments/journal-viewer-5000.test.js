// Мерка к issue #5000: просмотр журнала в dir_admin (js/journal-viewer.js).
// Проверяются решения модуля: какой запрос уходит на сервер, что попадает в CSV, как читается отказ.
// Строки отбирает сервер (experiments/journal-filter-5000.test.php); поведение вкладки на поддельном
// DOM — experiments/journal-viewer-5208.test.js.

const test = require('node:test');
const assert = require('node:assert');
const api = require('../js/journal-viewer.js');

test('запрос: страница 100 строк, курсор и условия уходят в адрес', () => {
    const q = api.buildQuery('acme', 'log', 'acme_log.3.jsonl:1048', [{ f: 'path', op: 'starts', v: '/acme' }]);
    assert.ok(q.startsWith('/acme/journal?JSON&mode=log&limit=100&cursor='), q);
    assert.ok(q.includes(encodeURIComponent('acme_log.3.jsonl:1048')));
    const where = JSON.parse(decodeURIComponent(q.split('&where=')[1]));
    assert.deepStrictEqual(where, [{ f: 'path', op: 'starts', v: '/acme' }]);
    assert.ok(!api.buildQuery('acme', 'sql', '', []).includes('cursor'), 'без курсора — с конца журнала');
    assert.ok(!api.buildQuery('acme', 'sql', '', []).includes('where'), 'без условий параметра нет');
});

test('условия: пустое значение отбрасывается, кроме явных «равно / не равно»', () => {
    const kept = api.cleanConds([{ f: 'ip', op: 'contains', v: '' }, { f: 'ip', op: 'eq', v: '' }, { f: '', op: 'eq', v: 'x' },
                                 { f: 'ip', op: 'starts', v: '10.' }]);
    assert.deepStrictEqual(kept.map(c => c.op), ['eq', 'starts']);
});

test('колонки: сначала привычный порядок, потом остальные по алфавиту', () => {
    const cols = api.columnsFor('log', [{ zz: 1, path: '/a', ts: 't' }, { aa: 1, user: 'u' }]);
    assert.deepStrictEqual(cols, ['ts', 'user', 'path', 'aa', 'zz']);
});

test('ячейка: длинное значение обрезается', () => {
    assert.strictEqual(api.cellText('x'.repeat(141)), 'x'.repeat(140) + '…');
    assert.strictEqual(api.cellText(null), '');
    assert.strictEqual(api.cellText({ a: 1 }), '{"a":1}');
});

test('CSV: заголовок, кавычки, запятые и переводы строк внутри значений', () => {
    const csv = api.toCsv([{ a: 'x,y', b: 'say "hi"', c: 'l1\nl2' }, { a: 1, c: { k: 'v' } }], ['a', 'b', 'c']);
    assert.strictEqual(csv, 'a;b;c\r\n"x,y";"say ""hi""";"l1\nl2"\r\n1;;"{""k"":""v""}"');
});

test('отказ сервера читается текстом', () => {
    assert.strictEqual(api.errorText(400, '{"error":"where: ожидается JSON-массив"}'), 'where: ожидается JSON-массив');
    assert.ok(/администратору/.test(api.errorText(403, '')));
    assert.ok(/502/.test(api.errorText(502, 'Bad gateway')));
});
