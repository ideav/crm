// ideav/crm#5666 — «Подобрать всем» в «Заказах этикетки» пишет только позиции, видимые по
// фильтру таблицы. Фильтр на 7 заказов → запись в позиции этих 7 заказов, а не во все
// позиции базы с расхождением подбора.
//
//   1. gridFilterQuery(grid): параметры фильтра грида (FR_/TO_ через applyFilter грида и
//      параметры страницы); без активных фильтров — пустая строка;
//   2. pickAll с фильтром: отчёт перечитывается с этими параметрами, пишутся только его позиции,
//      в вопросе — число позиций по фильтру;
//   3. pickAll без фильтра (или без грида) — все позиции, как прежде.
//
// rules: none (defect #5666)
// Run with: node experiments/atex-p2-5666-pick-all-filter.test.js

process.env.TZ = 'UTC';
var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

var LO = require('../download/atex-p2/js/label-orders.js');

// Грид-заглушка с настоящей формой фильтров IntegramTable: { colId: { type, value } }.
function fakeGrid(filters, pageParams) {
    return {
        filters: filters,
        columns: [{ id: '1002961', name: 'Заказ' }, { id: '1002970', name: 'Срок' }],
        applyFilter: function(params, column, filter) {
            var t = filter.type;
            params.append('FR_' + column.id, t === '(,)' ? 'IN(' + filter.value + ')' : (t === '%' || t === '!%') ? t : filter.value);
        },
        appendPageUrlParams: function(params) {
            Object.keys(pageParams || {}).forEach(function(k) { if (!params.has(k)) params.append(k, pageParams[k]); });
        }
    };
}

(async function() {
    var q = LO.core.gridFilterQuery;
    assert(typeof q === 'function', 'core.gridFilterQuery экспортирована');
    if (typeof q !== 'function') { console.log('\n' + passed + '/' + total); return; }
    assert(q(null) === '', 'без грида — пусто');
    assert(q(fakeGrid({})) === '', 'без фильтров — пусто');
    assert(q(fakeGrid({ '1002961': { type: '^', value: '' } })) === '', 'пустое значение фильтра — не фильтр');
    var s = q(fakeGrid({ '1002961': { type: '(,)', value: '5730,5793' } }));
    assert(/FR_1002961=IN%285730%2C5793%29/.test(s), 'фильтр «в списке» → FR_<колонка>', s);
    var e = q(fakeGrid({ '1002970': { type: '!%', value: '' } }));
    assert(e === 'FR_1002970=%21%25', 'фильтр «пустое» без значения учитывается', e);
    assert(q(fakeGrid({ '999': { type: '^', value: 'x' } })) === '', 'фильтр по неизвестной колонке пропускается');
    var pg = q(fakeGrid({}, { FR_1002961: '57%' }));
    assert(pg === 'FR_1002961=57%25', 'параметры страницы (FR_ в URL) — тоже фильтр', pg);

    function app(grid, kv) {
        var lo = Object.create(LO.AtexLabelOrders.prototype);
        lo.grid = grid;
        lo.progressUi = { open: function() { return { set: function() {}, step: function() {}, close: function() {} }; } };
        lo.rows = ['1', '2', '3', '4', '5'].map(function(id) { return { id: id, orderNo: 'З-' + id }; });
        lo.planOf = function() { return { write: { die: '77' } }; };
        lo.fieldsOf = function(w) { return w; };
        lo.message = function() {};
        lo.reload = function() { return Promise.resolve(); };
        lo.posted = []; lo.asked = ''; lo.fetched = [];
        lo.confirm = function(t) { lo.asked = t; return Promise.resolve(true); };
        lo.post = function(path) { lo.posted.push(path.replace(/^_m_set\//, '').replace(/\?.*$/, '')); return Promise.resolve({}); };
        lo.getJson = function(path) { lo.fetched.push(path); return Promise.resolve(kv); };
        return lo;
    }

    var f = app(fakeGrid({ '1002961': { type: '(,)', value: '5730,5793' } }),
        [{ 'РулоновID': '2', 'Заказ': '5730' }, { 'РулоновID': '4', 'Заказ': '5793' }]);
    await f.pickAll();
    assert(f.posted.join(',') === '2,4', 'с фильтром пишутся только позиции по фильтру', f.posted.join(','));
    assert(f.fetched.length === 1 && /^report\/label_positions\?JSON_KV&LIMIT=0,10000&FR_1002961=/.test(f.fetched[0]),
        'позиции по фильтру читаются из отчёта с параметрами грида', f.fetched[0]);
    assert(/ 2 позиц/.test(f.asked) && /по фильтру/.test(f.asked), 'в вопросе — 2 позиции по фильтру', f.asked);

    var n = app(fakeGrid({}), []);
    await n.pickAll();
    assert(n.posted.join(',') === '1,2,3,4,5', 'без фильтра — все позиции', n.posted.join(','));
    assert(n.fetched.length === 0, 'без фильтра отчёт не перечитывается');

    var g = app(undefined, []);
    await g.pickAll();
    assert(g.posted.length === 5, 'без грида — все позиции');

    var z = app(fakeGrid({ '1002961': { type: '(,)', value: '1' } }), []);
    var msg = '';
    z.message = function(t) { msg = t; };
    await z.pickAll();
    assert(z.posted.length === 0 && /по фильтру/.test(msg), 'фильтр без позиций — ничего не пишется, сказано про фильтр', msg);

    console.log('\n' + passed + '/' + total + ' passed');
})().catch(function(e) { console.error(e); process.exitCode = 1; });
