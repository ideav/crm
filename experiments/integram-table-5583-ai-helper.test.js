// Issue #5583: AI helper for formulas and reports — the user describes in words,
// the agent proposes JSON, the browser validates it against the fields the
// user's role sees and applies it only after "Применить".
const test = require('node:test');
const assert = require('assert');
const IntegramTable = require('../js/integram-table.js');

const AH = IntegramTable.AiHelper;
const proto = IntegramTable.prototype;

// metadata?JSON of a role: BARRED tables/fields are simply absent.
const META = [
    { id: '310', val: 'Сделка', type: '3', reqs: [
        { id: '311', val: 'Сумма', type: '14' },
        { id: '312', val: 'Дата', type: '9' },
        { id: '313', val: 'Клиент', type: '320', ref_id: '320' }
    ] },
    { id: '320', val: 'Клиент', type: '3', reqs: [{ id: '321', val: 'Город', type: '3' }] }
];

test('extractJson takes the ```json block, a bare object or the first object in text', () => {
    assert.ok(AH, 'IntegramTable.AiHelper is exported');
    assert.deepStrictEqual(AH.extractJson('Вот:\n```json\n{"formula":"{Цена}*2"}\n```\nГотово'), { formula: '{Цена}*2' });
    assert.deepStrictEqual(AH.extractJson('{"a":1}'), { a: 1 });
    assert.deepStrictEqual(AH.extractJson('Предлагаю {"a":{"b":"}"}} — так'), { a: { b: '}' } });
    assert.strictEqual(AH.extractJson('не знаю'), null);
    assert.strictEqual(AH.extractJson('```json\n[1,2]\n```'), null);
    // ideav.ru 19.11.2026: the agent corrected itself — "use only the second block".
    assert.deepStrictEqual(AH.extractJson('```json\n{"v":1}\n```\nИсправленный вариант:\n```json\n{"v":2}\n```\nИспользуйте второй блок.'), { v: 2 });
});

test('the request tells the agent not to change the base and lists only the given fields', () => {
    const f = AH.buildFormulaMessage({ table: 'Сделка', columns: ['Цена', 'Количество'], text: 'сумма с НДС' });
    assert.match(f, /сумма с НДС/);
    assert.match(f, /«Цена»/);
    assert.match(f, /ig POST/);
    const r = AH.buildReportMessage({ table: 'Сделка', sources: AH.sourcesFromMetadata(META), text: 'выручка по месяцам' });
    assert.match(r, /выручка по месяцам/);
    assert.match(r, /311/);
    assert.doesNotMatch(r, /999/);
});

test('checkFormula accepts known columns and rejects unknown ones and broken syntax', () => {
    assert.deepStrictEqual(AH.checkFormula('ROUND({Цена} * {количество} / 0 + 1, 2)', ['Цена', 'Количество']), { ok: true });
    assert.strictEqual(AH.checkFormula('{Цена} * {Скидка}', ['Цена']).ok, false);
    assert.match(AH.checkFormula('{Цена} * {Скидка}', ['Цена']).error, /Скидка/);
    assert.strictEqual(AH.checkFormula('{Цена} *', ['Цена']).ok, false);
    assert.strictEqual(AH.checkFormula('', ['Цена']).ok, false);
    assert.strictEqual(AH.checkFormula('alert(1)', ['Цена']).ok, false);
});

test('formulaAction: computed on display by default, stored on create/update on request', () => {
    assert.deepStrictEqual(AH.formulaAction({ formula: '{Цена}*2' }, false),
        { type: 'formula', formula: '{Цена}*2', write: false, on: ['READ'], recompute: true });
    assert.deepStrictEqual(AH.formulaAction({ formula: '{Цена}*2' }, true),
        { type: 'formula', formula: '{Цена}*2', write: true, on: ['CREATE', 'UPDATE', 'READ'] });
});

test('validateReport keeps only fields the role sees and only safe column settings', () => {
    const allowed = AH.sourcesFromMetadata(META);
    const ok = AH.validateReport({ name: 'Выручка по месяцам', columns: [
        { source: 312, name: 'Дата', alias: 'дата', hidden: true, from: '1.1', to: '31.12' },
        { source: 0, name: 'Месяц', formula: "DATE_FORMAT(дата,'%Y-%m')", sort: 1 },
        { source: '311', name: 'Выручка', func: 'sum', total: 'SUM' }
    ] }, allowed);
    assert.strictEqual(ok.ok, true, ok.error);
    assert.deepStrictEqual(ok.report.columns.map(c => AH.reportColumnFields(c)), [
        { t28: '312', t100: 'Дата', t101: 'дата', t102: '1.1', t103: '31.12', t107: '1' },
        { t28: '0', t100: 'Месяц', t101: "DATE_FORMAT(дата,'%Y-%m')", t109: '1' },
        { t28: '311', t100: 'Выручка', t104: 'SUM', t72: 'SUM' }
    ]);
    const bad = (cols) => AH.validateReport({ name: 'X', columns: cols }, allowed);
    assert.match(bad([{ source: 999, name: 'Зарплата' }]).error, /недоступн/);
    assert.strictEqual(bad([{ source: 0, name: 'A', formula: '1' }]).ok, false, 'first column needs a table source');
    assert.strictEqual(bad([{ source: 310 }, { source: 0, name: 'A', formula: '(SELECT 1 FROM x)' }]).ok, false);
    assert.strictEqual(bad([{ source: 310 }, { source: 0, name: 'A' }]).ok, false, 'computed column needs a formula');
    assert.strictEqual(bad([{ source: 310, alias: 'два слова' }]).ok, false);
    assert.strictEqual(bad([{ source: 310, func: 'DROP' }]).ok, false);
    assert.match(bad([{ source: 312, name: 'Месяц', hidden: true }, { source: 311, name: 'Месяц' }]).error, /Месяц/, 'names are keys of JSON_KV');
    assert.strictEqual(bad([]).ok, false);
    assert.strictEqual(AH.validateReport({ columns: [{ source: 310 }] }, allowed).ok, false, 'report needs a name');
});

// ── applying: fake fetch records calls ─────────────────────────────────────
function fakeFetch(routes) {
    const calls = [];
    const fn = async (url, opts) => {
        const body = opts && opts.body ? String(opts.body) : '';
        calls.push({ url, body: new URLSearchParams(body) });
        for (const [re, reply] of routes) {
            if (re.test(url)) {
                const r = typeof reply === 'function' ? reply(url, body, calls) : reply;
                return { ok: true, status: 200, text: async () => JSON.stringify(r), json: async () => r };
            }
        }
        return { ok: false, status: 404, text: async () => 'not found', json: async () => null };
    };
    fn.calls = calls;
    return fn;
}
function self(extra) {
    return Object.assign(Object.create(proto), {
        options: { instanceName: 't', tableTypeId: 310 }, objectTableId: 310,
        getApiBase: () => '/db', getButtonActionXsrf: () => 'X'
    }, extra || {});
}

test('applyAiReport creates the query and its columns, checks it and returns the address', async () => {
    let n = 0;
    global.fetch = fakeFetch([
        [/_m_new\/22/, { id: 900 }],
        [/_m_new\/28/, () => ({ id: 901 + n++ })],
        [/report\/900/, [{ Месяц: '2026-01', Выручка: '10' }]]
    ]);
    const report = AH.validateReport({ name: 'Выручка', columns: [{ source: 310, name: 'Сделка' }, { source: 311, name: 'Сумма', func: 'SUM' }] }, AH.sourcesFromMetadata(META)).report;
    const res = await self().applyAiReport(report);
    assert.deepStrictEqual(res, { id: '900', url: '/db/report/900' });
    const c = global.fetch.calls;
    assert.strictEqual(c[0].body.get('t22'), 'Выручка');
    assert.strictEqual(c[0].body.get('up'), '1');
    assert.strictEqual(c[1].body.get('up'), '900');
    assert.strictEqual(c[1].body.get('t28'), '310');
    assert.strictEqual(c[2].body.get('t104'), 'SUM');
    assert.match(c[3].url, /report\/900\?JSON_KV/);
});

test('applyAiReport deletes the half-built query when a column or the check fails', async () => {
    // ideav.ru 19.11.2026: a broken report answers HTTP 200 with the SQL error inside the first cell.
    const sqlInCell = [{ Выручка: "Couldn't execute query [Request report data] Unknown column 'нетакого' in 'field list' (SELECT  SUM(a.val) as 'Выручка' FROM t)", X: '' }];
    for (const failAt of ['column', 'check', 'cell']) {
        global.fetch = fakeFetch([
            [/_m_new\/22/, { id: 900 }],
            [/_m_new\/28/, failAt === 'column' ? [{ error: 'Неверный источник' }] : { id: 901 }],
            [/report\/900/, failAt === 'cell' ? sqlInCell : { error: "Unknown column 'x'" }],
            [/_m_del\/900/, { id: 900 }]
        ]);
        const report = AH.validateReport({ name: 'R', columns: [{ source: 310 }] }, AH.sourcesFromMetadata(META)).report;
        await assert.rejects(self().applyAiReport(report), failAt === 'column' ? /Неверный источник/ : /Unknown column/);
        assert.ok(global.fetch.calls.some(x => /_m_del\/900/.test(x.url)), `rollback after ${ failAt }`);
    }
});

test('applyAiFormula adds a button column with the action and removes it if the action is refused', async () => {
    const done = [];
    const s = self({
        createColumn: async (name, type) => { done.push(['create', name, type]); return { success: true, columnId: '555' }; },
        saveButtonAction: async (id, action) => { done.push(['action', id, action]); return { success: true }; },
        deleteColumn: async (id) => { done.push(['delete', id]); }
    });
    const res = await s.applyAiFormula({ name: 'Сумма', formula: '{Цена}*2' }, false);
    assert.strictEqual(res.columnId, '555');
    assert.deepStrictEqual(done, [
        ['create', 'Сумма', 7],
        ['action', '555', { type: 'formula', formula: '{Цена}*2', write: false, on: ['READ'], recompute: true }]
    ]);
    done.length = 0;
    s.saveButtonAction = async () => ({ success: false, error: 'нет прав' });
    await assert.rejects(s.applyAiFormula({ name: 'Сумма', formula: '{Цена}*2' }, false), /нет прав/);
    assert.deepStrictEqual(done[done.length - 1], ['delete', '555']);
});

test('askAiHelper cancels a plan the agent queued despite the instruction', async () => {
    global.fetch = fakeFetch([
        [/ai\/agent/, (url, body) => (new URLSearchParams(body).get('action') === 'cancel'
            ? { job: { id: 'c', status: 'queued' } }
            : { job: { id: 'j1', status: 'done', result: { assistant: { content: '```json\n{"formula":"1"}\n```' }, plan: { id: 'p1', status: 'pending' } } } })]
    ]);
    global.FormData = URLSearchParams;
    const res = await self().askAiHelper('msg', { page: 'table' });
    assert.deepStrictEqual(res, { formula: '1' });
    const cancel = global.fetch.calls.find(x => x.body.get('action') === 'cancel');
    assert.ok(cancel, 'plan cancelled');
    assert.strictEqual(cancel.body.get('plan'), 'p1');
});
