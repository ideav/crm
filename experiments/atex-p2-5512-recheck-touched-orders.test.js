// ideav/crm#5512 — повторная сверка после записи читает позиции только затронутых заказов.
//
// Импорт из 1С читает позиции по заказу (подчинённая таблица — запрос на заказ, ~190 на выгрузку).
// После «Записать» повторная сверка перечитывала позиции ВСЕХ заказов файла, хотя запись
// трогала один заказ (на скриншоте issue — «Записать (1 операций)», затем 190 чтений ≈ 30 с).
// Правило: после записи заново читаются позиции только заказов, у которых в плане были операции
// (группа «order:<номер>»), и новых заказов; позиции остальных берутся из прошлой сверки.
// Выбор нового файла по-прежнему читает всё.
//
//   R1  LI.touchedOrders(ops) — номера заказов из групп операций, без справочников;
//   R2  сверка файла: позиции всех N заказов;
//   R3  запись с операциями по 1 заказу + 1 новый заказ → перечитаны 2 заказа, а не N;
//   R4  в контекст сверки попали и перечитанные, и сохранённые позиции (up = id заказа);
//   R5  повторный выбор файла снова читает все заказы.
//
// Run with: node experiments/atex-p2-5512-recheck-touched-orders.test.js

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

function quietUi() {
    return {
        open: function() {
            var p = { done: 0 };
            p.step = function() { p.done = 0; return p; };
            p.set = function(n) { p.done = n; return p; };
            p.tick = function() { return p.set(p.done + 1); };
            p.track = function(pr) { return Promise.resolve(pr).then(function(v) { p.tick(); return v; }); };
            p.close = function() {};
            return p;
        }
    };
}

(async function main() {
    var LI = require('../download/atex-p2/js/label-import-core.js');
    var APP = require('../download/atex-p2/js/label-import.js');

    // R1
    var touched = typeof LI.touchedOrders === 'function' ? LI.touchedOrders([
        { op: 'new', group: 'article:abc' },
        { op: 'set', group: 'order:5732' },
        { op: 'save', group: 'order:5732' },
        { op: 'new', group: 'order:НОВ-1' },
        { op: 'set' }
    ]) : null;
    assert(!!touched && touched['5732'] && touched['НОВ-1'] && Object.keys(touched).length === 2,
        'R1 touchedOrders: заказы из групп «order:…», справочники и операции без группы не считаются', JSON.stringify(touched));

    var origCtx = LI.orderContext, origPlan = LI.planOrders;
    var lastData = null;
    LI.orderContext = function(tables, data) { lastData = data; return data; };
    LI.planOrders = function() { return { ops: [], counts: { new: 0, update: 0, same: 0, duplicate: 0, error: 0, warnings: 0, ordersNew: 0 }, rows: [] }; };

    var N = 190;
    var orders = Array.from({ length: N }, function(_, i) { return { id: String(1000 + i), val: String(5700 + i), reqs: {} }; });
    var reads = [];
    var app = new APP.AtexLabelImport({ getAttribute: function(k) { return k === 'data-db' ? 'ateh1' : ''; } });
    app.render = function() {};
    app.message = function() {};
    app.checkTables = function() {};
    app.confirm = function() { return Promise.resolve(true); };
    app.progressUi = quietUi();
    app.tables = { order: { id: '1' }, position: { id: '2' }, client: { id: '3' }, article: { id: '4' }, productKind: { id: '5' } };
    app.objects = function(key, extra) {
        if (key === 'order') return Promise.resolve(orders.slice());
        if (key !== 'position') return Promise.resolve([]);
        var id = decodeURIComponent(String(extra).replace(/^.*F_U=/, ''));
        reads.push(id);
        return Promise.resolve([{ id: 'p' + id, val: '1', reqs: {} }]);
    };
    app.parsed.orders = { items: orders.map(function(o) { return { order: o.val }; }).concat([{ order: 'НОВ-1' }]) };

    // R2
    await app.replan('orders');
    assert(reads.length === N, 'R2 сверка файла читает позиции всех ' + N + ' заказов', 'прочитано ' + reads.length);

    // R3: запись трогает заказ 5732 и создаёт заказ НОВ-1 (после записи он есть в базе с id 9999)
    reads = [];
    app.sendBatch = function(ops) {
        orders.push({ id: '9999', val: 'НОВ-1', reqs: {} });
        return Promise.resolve({ results: ops.map(function(_, n) { return { n: n, ok: true, id: 1 }; }) });
    };
    app.plan.orders = {
        ops: [{ op: 'set', id: '1032', group: 'order:5732', fields: { 1: 'x' } },
            { op: 'new', table: '1', up: 1, ref: 'order:НОВ-1', group: 'order:НОВ-1', fields: { 1: 'НОВ-1' } }],
        counts: { new: 1, update: 1, same: 0, duplicate: 0, error: 0, ordersNew: 1 }, rows: []
    };
    await app.write();
    var got = reads.slice().sort().join(',');
    assert(reads.length === 2 && got === '1032,9999',
        'R3 после записи перечитаны позиции только затронутых заказов (5732 и новый), а не всех ' + (N + 1), 'прочитано ' + reads.length + ': ' + got.slice(0, 80));

    // R4
    var pos = (lastData && lastData.positions) || [];
    var byUp = {};
    pos.forEach(function(p) { byUp[p.up] = p.id; });
    assert(pos.length === N + 1 && byUp['1032'] === 'p1032' && byUp['1000'] === 'p1000' && byUp['9999'] === 'p9999',
        'R4 в сверку попали позиции всех заказов: перечитанные и из прошлой сверки', 'позиций ' + pos.length);

    // R5
    reads = [];
    await app.replan('orders');
    assert(reads.length === N + 1, 'R5 новая сверка файла снова читает все заказы', 'прочитано ' + reads.length);

    LI.orderContext = origCtx; LI.planOrders = origPlan;
    console.log('\n' + passed + '/' + total + ' passed');
})().catch(function(e) { console.error(e); process.exitCode = 1; });
