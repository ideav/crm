// Мерка к issue #5000: просмотр журнала в dir_admin (js/journal-viewer.js).
// Проверяются решения модуля: какой запрос уходит на сервер, как условия сужают строки (так же, как
// на сервере), что попадает в CSV, как читается отказ. Разметку страницы проверяет dir-admin-template-5000.

const test = require('node:test');
const assert = require('node:assert');
const api = require('../js/journal-viewer.js');

const req = { user: 'Petrov', path: '/acme/_m_save/42', st: 200, params: { val: 'Привет, мир' }, msg: 'slow query' };

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

test('сравнение: начинается / содержит / равно / не равно / заканчивается', () => {
    const m = (f, op, v) => api.matches(req, { f, op, v });
    assert.ok(m('path', 'starts', '/ACME/_m_'));
    assert.ok(!m('path', 'starts', '_m_'));
    assert.ok(m('path', 'ends', '/42'));
    assert.ok(m('path', 'contains', '_M_SAVE'));
    assert.ok(m('user', 'eq', 'petrov'));
    assert.ok(!m('user', 'eq', 'petro'));
    assert.ok(m('user', 'ne', 'ivanov'));
    assert.ok(m('st', 'eq', '200'), 'число — как текст');
    assert.ok(m('params', 'contains', 'Привет'), 'вложенное — по JSON');
    assert.ok(m('ai_job', 'eq', ''), 'нет поля — пустая строка');
    assert.ok(!m('ai_job', 'contains', 'x'));
});

test('«*»: любое поле строки; «не содержит» — ни в одном', () => {
    const m = (op, v) => api.matches(req, { f: '*', op, v });
    assert.ok(m('contains', 'slow'));
    assert.ok(!m('contains', 'нету'));
    assert.ok(!m('notcontains', 'slow'));
    assert.ok(m('notcontains', 'zzz'));
});

test('applyFilters: условия по И', () => {
    const rows = [req, Object.assign({}, req, { st: 500 }), Object.assign({}, req, { path: '/other' })];
    const got = api.applyFilters(rows, [{ f: 'path', op: 'starts', v: '/acme' }, { f: 'st', op: 'eq', v: '200' }]);
    assert.strictEqual(got.length, 1);
    assert.strictEqual(api.applyFilters(rows, []).length, 3, 'без условий — всё');
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
    assert.strictEqual(csv, 'a,b,c\r\n"x,y","say ""hi""","l1\nl2"\r\n1,,"{""k"":""v""}"');
});

test('отказ сервера читается текстом', () => {
    assert.strictEqual(api.errorText(400, '{"error":"where: ожидается JSON-массив"}'), 'where: ожидается JSON-массив');
    assert.ok(/администратору/.test(api.errorText(403, '')));
    assert.ok(/502/.test(api.errorText(502, 'Bad gateway')));
});
