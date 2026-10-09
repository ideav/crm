// Issue #5116: BUTTON column actions — link / AI prompt / formula / query,
// described in the column's modifier (attrs "action"), with [ID]/[VAL]/{Field}
// substitution and the result optionally written into the record.
const test = require('node:test');
const assert = require('assert');
const IntegramTable = require('../js/integram-table.js');

const BA = IntegramTable.ButtonAction;
const proto = IntegramTable.prototype;

const ctx = { id: 42, val: 'Заказ 7', fields: { 'Цена': '1 250,5', 'Количество': '4', 'Описание': 'Синий стул', 'Дата': '01.10.2026' } };

test('parseConfig reads the action from JSON attrs and keeps legacy links', () => {
    assert.ok(BA, 'IntegramTable.ButtonAction is exported');
    assert.deepStrictEqual(
        BA.parseConfig('{"required":true,"action":{"type":"formula","formula":"{Цена}*2","write":true,"label":"x2"}}'),
        { type: 'formula', label: 'x2', write: true, formula: '{Цена}*2' }
    );
    assert.deepStrictEqual(
        BA.parseConfig('{"action":{"type":"link","url":"report/1?FR_A=[ID]","newTab":false},"default":"report/1?FR_A=[ID]"}'),
        { type: 'link', label: '', url: 'report/1?FR_A=[ID]', newTab: false }
    );
    const legacy = BA.parseConfig('object/18/?F_U=[ID]');
    assert.strictEqual(legacy.type, 'link');
    assert.strictEqual(legacy.legacy, true);
    assert.strictEqual(BA.parseConfig(''), null);
    assert.strictEqual(BA.parseConfig('{"action":{"type":"rm -rf"}}'), null);
});

test('substitute replaces [ID], [VAL] and {Column}, encoding inserted values only', () => {
    assert.strictEqual(BA.substitute('[ID]/[VAL]/{описание}', ctx), '42/Заказ 7/Синий стул');
    assert.strictEqual(BA.substitute('report/5?FR_A=[VAL]&x={Нет}', ctx, encodeURIComponent),
        'report/5?FR_A=' + encodeURIComponent('Заказ 7') + '&x={Нет}');
});

test('evalFormula computes arithmetic, strings, logic and functions over row fields', () => {
    const f = (s) => BA.formatResult(BA.evalFormula(s, ctx));
    assert.strictEqual(f('{Цена} * {Количество}'), '5002');
    assert.strictEqual(f('ROUND({Цена} / 3, 2)'), '416.83');
    assert.strictEqual(f('0.1 + 0.2'), '0.3');
    assert.strictEqual(f('[VAL] & " — " & UPPER({Описание})'), 'Заказ 7 — СИНИЙ СТУЛ');
    assert.strictEqual(f('{Количество} > 3 ? "много" : "мало"'), 'много');
    assert.strictEqual(f('IF({Количество} = 4, [ID] + 1, 0)'), '43');
    assert.strictEqual(f('DAYS("11.10.2026", {Дата})'), '10');
    assert.strictEqual(f('ADDDAYS({Дата}, 31)'), '01.11.2026');
});

test('evalFormula has no access to JavaScript and reports errors in words', () => {
    for (const bad of ['constructor', 'alert(1)', 'window.location', '[].constructor', 'this', '{Цена} +', '1 / 0', '{Нет}']) {
        assert.throws(() => BA.formatResult(BA.evalFormula(bad, ctx)), Error, bad);
    }
});

test('toAction serializes the editor state for the server', () => {
    assert.deepStrictEqual(BA.toAction({ type: 'query', label: '', query: 'Остаток', params: 'FR_K=[ID]', write: true }),
        { type: 'query', query: 'Остаток', params: 'FR_K=[ID]', write: true });
    assert.deepStrictEqual(BA.toAction({ type: 'link', url: 'x', newTab: false, label: 'Открыть' }),
        { type: 'link', label: 'Открыть', url: 'x', newTab: false });
});

function fakeTable(attrs, cellValue) {
    const column = { id: '501', paramId: '501', name: 'Сумма', type: '7', attrs };
    const calls = [];
    const t = Object.create(proto);
    Object.assign(t, {
        options: { instanceName: 'it1' },
        objectTableId: 500,
        columns: [{ id: '500', name: 'Заказ', type: '3', attrs: '' }, { id: '502', name: 'Цена', type: '13', attrs: '' }, column],
        data: [['Заказ 7', '100', cellValue]],
        rawObjectData: [{ i: 42 }],
        container: null,
        toasts: [],
        showToast(msg, type) { this.toasts.push([type, msg]); },
        getApiBase() { return '/db'; }
    });
    global.fetch = async (url, opts) => {
        calls.push({ url, body: opts && opts.body ? String(opts.body) : '' });
        return { ok: true, status: 200, text: async () => '{"id":42,"obj":42}', json: async () => ({ id: 42 }) };
    };
    return { t, column, calls };
}

test('a formula with write stores the result into the record via _m_set', async () => {
    const { t, column, calls } = fakeTable('{"action":{"type":"formula","formula":"{Цена} * 3","write":true}}', '');
    const el = { dataset: { btnAction: 'run', colId: '501' }, classList: { add() {}, remove() {} }, isConnected: false };
    await t.handleButtonActionClick(el, { dataset: { row: '0' } });
    assert.deepStrictEqual(t.toasts.filter(x => x[0] === 'error'), []);
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].url, '/db/_m_set/42?JSON');
    assert.strictEqual(new URLSearchParams(calls[0].body).get('t501'), '300');
    assert.strictEqual(t.data[0][2], '300');
});

test('stored result is shown instead of the button, with recalc and clear', () => {
    const { t, column } = fakeTable('{"action":{"type":"formula","formula":"1","write":true}}', '300');
    t.escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    const cfg = BA.parseConfig(column.attrs);
    const stored = t.renderButtonActionCell(column, '<b>300</b>', cfg);
    assert.ok(stored.includes('&lt;b>300'), 'value is escaped');
    assert.ok(stored.includes('data-btn-action="clear"'));
    assert.ok(stored.includes('data-btn-action="run"'));
    const empty = t.renderButtonActionCell(column, '', cfg);
    assert.ok(!empty.includes('data-btn-action="clear"'));
    assert.ok(empty.includes('data-btn-action="run"'));
});

test('clear deletes the stored value with an empty _m_set', async () => {
    const { t, calls } = fakeTable('{"action":{"type":"formula","formula":"1","write":true}}', '300');
    await t.handleButtonActionClick({ dataset: { btnAction: 'clear', colId: '501' } }, { dataset: { row: '0' } });
    assert.strictEqual(new URLSearchParams(calls[0].body).get('t501'), '');
    assert.strictEqual(t.data[0][2], '');
});

test('a query action takes the first value of the first row of report/{name}?JSON_KV', async () => {
    const { t, column } = fakeTable('{"action":{"type":"query","query":"Остаток","params":"FR_K=[ID]"}}', '');
    let asked = '';
    global.fetch = async (url) => { asked = url; return { ok: true, status: 200, text: async () => '[{"Остаток":"17"},{"Остаток":"3"}]' }; };
    const r = await t.runButtonAction(0, column, BA.parseConfig(column.attrs));
    assert.strictEqual(r, '17');
    assert.strictEqual(asked, '/db/report/' + encodeURIComponent('Остаток') + '?JSON_KV&FR_K=42');
});

test('a prompt goes to the AI agent with the row substituted and the answer is polled', async () => {
    const { t, column } = fakeTable('{"action":{"type":"prompt","prompt":"Опиши {Заказ} за {Цена}","write":true}}', '');
    const sent = [];
    let polls = 0;
    const origSetTimeout = global.setTimeout;
    global.setTimeout = (fn) => origSetTimeout(fn, 0);
    global.FormData = class { constructor() { this.m = {}; } append(k, v) { this.m[k] = v; } };
    global.fetch = async (url, opts) => {
        if (opts && opts.method === 'POST') {
            sent.push(opts.body.m);
            return { ok: true, status: 202, json: async () => ({ job: { id: 'j1', status: 'queued' } }) };
        }
        polls++;
        assert.ok(url.endsWith('&job=j1'));
        return { ok: true, status: 200, json: async () => ({ job: { id: 'j1', status: 'done', result: { assistant: { content: '```\nСтул за 100\n```' } } } }) };
    };
    try {
        const r = await t.runButtonAction(0, column, BA.parseConfig(column.attrs));
        assert.strictEqual(r, 'Стул за 100');
    } finally {
        global.setTimeout = origSetTimeout;
    }
    assert.strictEqual(polls, 1);
    assert.ok(sent[0].message.startsWith('Опиши Заказ 7 за 100'));
    assert.ok(sent[0].message.includes('«Сумма»'));
    assert.strictEqual(JSON.parse(sent[0].context).object_id, '42');
});
