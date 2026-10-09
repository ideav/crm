// python2node#866: launch events of BUTTON column actions — PRESS / READ in the
// browser, CREATE / UPDATE / DELETE on the server — plus "when", "recompute"
// and "user" (run on the server as another user via _m_action). The formula
// vectors are shared with the PHP port (experiments/button-triggers-866.test.php).
const test = require('node:test');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const IntegramTable = require('../js/integram-table.js');

const BA = IntegramTable.ButtonAction;
const proto = IntegramTable.prototype;

test('formula evaluator gives the shared parity vectors', () => {
    const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'button-formula-vectors.fixture.json'), 'utf8'));
    assert.ok(fx.vectors.length > 100);
    for (const v of fx.vectors) {
        let got;
        try { got = { result: BA.formatResult(BA.evalFormula(v.formula, fx.ctx)) }; } catch (e) { got = { error: e.message }; }
        assert.deepStrictEqual(got, v.error !== undefined ? { error: v.error } : { result: v.result }, v.formula);
    }
});

test('parseConfig reads on / recompute / when / user and leaves defaults out', () => {
    assert.deepStrictEqual(
        BA.parseConfig('{"action":{"type":"formula","formula":"1","write":true,"on":"update, create","recompute":true,"when":" {A} = 1 ","user":17}}'),
        { type: 'formula', label: '', write: true, formula: '1', on: ['CREATE', 'UPDATE'], when: '{A} = 1', user: '17' }
    );
    const read = BA.parseConfig('{"action":{"type":"query","query":"Q","on":["READ"],"recompute":1}}');
    assert.deepStrictEqual(read.on, ['READ']);
    assert.strictEqual(read.recompute, true);
    // PRESS only is the default and is not carried
    assert.strictEqual(BA.parseConfig('{"action":{"type":"formula","formula":"1","on":["PRESS"]}}').on, undefined);
    assert.deepStrictEqual(BA.events(BA.parseConfig('{"action":{"type":"formula","formula":"1"}}')), ['PRESS']);
    // a stored unknown event does not break rendering
    assert.deepStrictEqual(BA.parseConfig('{"action":{"type":"formula","formula":"1","on":["DELETE","NOPE"]}}').on, ['DELETE']);
});

test('toAction keeps old modifiers identical and rejects what the server rejects', () => {
    assert.deepStrictEqual(BA.toAction({ type: 'formula', formula: 'x', write: true, on: ['PRESS'], recompute: true, when: '', user: '' }),
        { type: 'formula', formula: 'x', write: true });
    assert.deepStrictEqual(BA.toAction({ type: 'prompt', prompt: 'p', on: ['READ', 'CREATE'], recompute: true, when: '{A}>1', user: 'ivanov' }),
        { type: 'prompt', prompt: 'p', write: false, on: ['CREATE', 'READ'], recompute: true, when: '{A}>1', user: 'ivanov' });
    assert.throws(() => BA.toAction({ type: 'formula', formula: 'x', on: ['LATER'] }), /неизвестное событие/);
    assert.throws(() => BA.toAction({ type: 'link', url: 'x', on: ['CREATE'] }), /только нажатием/);
    assert.deepStrictEqual(BA.toAction({ type: 'link', url: 'x', newTab: true, on: ['PRESS'] }), { type: 'link', url: 'x', newTab: true });
});

function fakeTable(attrs, cellValue, fetchImpl) {
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
        getApiBase() { return '/db'; },
        escapeHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }
    });
    global.fetch = async (url, opts) => {
        calls.push({ url, body: opts && opts.body ? String(opts.body) : '' });
        if (fetchImpl) return fetchImpl(url, opts);
        return { ok: true, status: 200, text: async () => '{"id":42,"obj":42}', json: async () => ({ id: 42 }) };
    };
    return { t, column, calls };
}
const settle = () => new Promise(r => setTimeout(r, 5));

test('READ computes a formula for an empty cell on display and stores it with write', async () => {
    const { t, column, calls } = fakeTable('{"action":{"type":"formula","formula":"{Цена} * 2","write":true,"on":["READ"]}}', '');
    const html = t.renderButtonActionCell(column, '', BA.parseConfig(column.attrs), 0);
    assert.ok(html.includes('>200<'), html);
    assert.ok(!html.includes('data-btn-action="run"'), 'no run button without PRESS');
    await settle();
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].url, '/db/_m_set/42?JSON');
    assert.strictEqual(new URLSearchParams(calls[0].body).get('t501'), '200');
    assert.strictEqual(t.data[0][2], '200');
    // the second display does not write again
    t.renderButtonActionCell(column, '', BA.parseConfig(column.attrs), 0);
    await settle();
    assert.strictEqual(calls.length, 1);
});

test('READ with recompute ignores the stored value and never writes', async () => {
    const { t, column, calls } = fakeTable('{"action":{"type":"formula","formula":"{Цена} + 1","write":true,"on":["READ"],"recompute":true}}', 'старое');
    const html = t.renderButtonActionCell(column, 'старое', BA.parseConfig(column.attrs), 0);
    assert.ok(html.includes('>101<'), html);
    assert.ok(!html.includes('старое'));
    await settle();
    assert.strictEqual(calls.length, 0);
});

test('READ honours the "when" condition', () => {
    const { t, column } = fakeTable('{"action":{"type":"formula","formula":"1","on":["READ"],"when":"{Цена} > 1000"}}', '');
    const html = t.renderButtonActionCell(column, '', BA.parseConfig(column.attrs), 0);
    assert.ok(!html.includes('>1<'), html);
});

test('READ runs a query through the queue once per record and shows the result', async () => {
    let asked = 0;
    const { t, column } = fakeTable('{"action":{"type":"query","query":"Остаток","on":["READ"]}}', '', async () => {
        asked++;
        return { ok: true, status: 200, text: async () => '[{"Остаток":"17"}]' };
    });
    const cfg = BA.parseConfig(column.attrs);
    assert.ok(t.renderButtonActionCell(column, '', cfg, 0).includes('it-btn-read-pending'));
    t.renderButtonActionCell(column, '', cfg, 0);
    await settle();
    assert.strictEqual(asked, 1);
    assert.ok(t.renderButtonActionCell(column, '', cfg, 0).includes('>17<'));
});

test('a column without PRESS shows no run button and no bulk button', () => {
    const { t, column } = fakeTable('{"action":{"type":"formula","formula":"1","write":true,"on":["CREATE","UPDATE"]}}', '');
    const cfg = BA.parseConfig(column.attrs);
    assert.ok(!t.renderButtonActionCell(column, '', cfg, 0).includes('data-btn-action'));
    const stored = t.renderButtonActionCell(column, '5', cfg, 0);
    assert.ok(stored.includes('>5<') && !stored.includes('data-btn-action'), stored);
    t.checkboxMode = true;
    t.selectedRows = new Set([0]);
    t.normalizeFormat = (x) => (String(x) === '7' ? 'BUTTON' : 'SHORT');
    assert.strictEqual(t.renderButtonActionBulkButtons('it1'), '');
    column.attrs = '{"action":{"type":"formula","formula":"1","on":["PRESS","UPDATE"]}}';
    assert.ok(t.renderButtonActionBulkButtons('it1').includes('runButtonActionForSelected'));
});

test('with "user" the click runs on the server (_m_action) and the client does not write', async () => {
    const { t, column, calls } = fakeTable('{"action":{"type":"formula","formula":"1","write":true,"user":"17"}}', '', async () =>
        ({ ok: true, status: 200, text: async () => '{"result":"9","written":true}' }));
    const el = { dataset: { btnAction: 'run', colId: '501' }, classList: { add() {}, remove() {} }, isConnected: false };
    await t.handleButtonActionClick(el, { dataset: { row: '0' } });
    assert.deepStrictEqual(t.toasts.filter(x => x[0] === 'error'), []);
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].url, '/db/_m_action/42?JSON&col=501');
    assert.strictEqual(t.data[0][2], '9');
});
