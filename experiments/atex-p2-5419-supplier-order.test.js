// ideav/crm#5419 — импорт заказов этикетки из 1С различает «Заказ клиента» и «Заказ поставщику».
//
// Правило: запись «Заказ» — внутренний заказ, её номер — «Заказ поставщику» из выгрузки 1С;
// «Заказ клиента» пишется в одноимённое поле позиции. Ключ сверки позиции — «Заказ поставщику» + артикул.
//   S1  номер записи «Заказ» — «Заказ поставщику», в позиции «Заказ клиента» — номер клиента;
//   S2  один заказ клиента с несколькими заказами поставщику — несколько записей «Заказ», не дубли;
//   S3  повторный импорт находит заказ по номеру поставщика — 0 новых;
//   S4  нет «Заказ поставщику» — ошибка строки с номером заказа клиента; нет «Заказ клиента» —
//       позиция импортируется с предупреждением.
//
// Фикстуры обезличены. Run with: node experiments/atex-p2-5419-supplier-order.test.js

process.env.TZ = 'UTC';

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

var LI = require('../download/atex-p2/js/label-import-core.js');

var tid = 100, ids = {};
function table(name, reqs) {
    var id = String(tid); tid += 100;
    ids[name] = { id: id, reqs: {} };
    var list = (reqs || []).map(function(r, i) {
        var rid = String(Number(id) + i + 1);
        ids[name].reqs[r] = rid;
        return { id: rid, val: r, type: '3', field_attrs: { alias: null } };
    });
    return { id: id, val: name, reqs: list };
}
function buildMeta() {
    var meta = [];
    meta.push(table('Нож', ['Ширина этикетки, мм', 'Длина этикетки, мм']));
    meta.push(table('Движение пробега', ['Обороты пробега', 'Вид движения пробега']));
    meta.push(table('Вал', ['Раппорт, мм']));
    ['Основа сырья', 'Марка ножа', 'Состояние ножа', 'Вид движения пробега'].forEach(function(n) { meta.push(table(n, [])); });
    meta.push(table('Заказ', ['Клиент', 'Дата создания', 'Статус заказа', 'Примечания']));
    meta.push(table('Заказанное количество', ['Вид продукции', 'Артикул', 'Заказ клиента', 'Ширина этикетки, мм',
        'Длина этикетки, мм', 'Этикеток в рулоне', 'Тип ножей', 'Диаметр втулки', 'Тип намотки', 'Ед.изм.', 'Статус позиции', 'Примечание']));
    ['Клиент', 'Артикул', 'Вид продукции', 'Статус заказа', 'Статус позиции', 'Диаметр втулки', 'Ед.изм.'].forEach(function(n) {
        if (!ids[n]) meta.push(table(n, []));
    });
    return meta;
}
function rec(id, val, reqs, up) { return { id: String(id), up: String(up || 1), val: val, reqs: reqs || {} }; }

function ctxOf(orders, positions) {
    ids = {}; tid = 100;
    var res = LI.resolveImportTables(buildMeta());
    return {
        res: res,
        ctx: LI.orderContext(res.tables, {
            orders: orders || [], positions: positions || [], clients: [rec(20, 'ООО ТЕСТОВЫЙ КЛИЕНТ')],
            articles: [], productKinds: [rec(30, 'этикетка')], orderStatuses: [rec(40, 'Новый')], positionStatuses: [rec(41, 'Новая')],
            cores: [rec(50, 'Втулка картонная (76мм/3,5мм/1000мм)')], units: [rec(60, 'шт')], db: 'ateh1'
        })
    };
}

var HEAD = ['Партнер', 'Заказ Клиента', 'Заказ поставщику', 'Артикул', 'Номенклатура', 'Заказ.Комментарий', 'Заказ.Дата поступления',
    'Тип ножей', 'Короб', 'Единица хранения', 'Заказано количество'];
function line(client, supplier, art) {
    return ['ООО ТЕСТОВЫЙ КЛИЕНТ', client, supplier, art, '100 х 300 500 шт. П/Гл каучук вт 76 (П)', '', '12.10.2026', '', '', 'шт', '150'];
}
function sheet(rows) { return [HEAD, ['ООО ТЕСТОВЫЙ КЛИЕНТ', '', '', '', '', '', '', '', '', '', '600']].concat(rows); }
function planOf(c, rows) { return LI.planOrders(LI.parseOrderSheet(sheet(rows)), c.ctx, {}); }
function newOf(c, plan, tableName) { return plan.ops.filter(function(o) { return o.op === 'new' && o.table === c.res.tables[tableName].id; }); }

var FILE = [
    line('3356', '5729', '00012328'),
    line('3429', '5730', '00014502'),
    line('3542', '5731', '00015221'),
    line('3542', '5732', '00014929')
];

// ── S1, S2. Номер заказа и заказ клиента позиции ─────────────────────────────────────────────
(function() {
    var c = ctxOf();
    var plan = planOf(c, FILE);
    var orderNames = newOf(c, plan, 'order').map(function(o) { return o.fields['t' + c.res.tables.order.id]; });
    assert(JSON.stringify(orderNames) === JSON.stringify(['5729', '5730', '5731', '5732']),
        'записи «Заказ» названы номерами «Заказ поставщику»', JSON.stringify(orderNames));
    assert(plan.counts.ordersNew === 4 && plan.counts.new === 4 && plan.counts.duplicate === 0 && plan.counts.error === 0,
        'заказ клиента 3542 с двумя заказами поставщику — два заказа, не дубль', JSON.stringify(plan.counts));
    var co = c.res.tables.position.reqs.clientOrder;
    var byArt = {};
    newOf(c, plan, 'position').forEach(function(p) { byArt[p.up.ref] = p.fields['t' + co]; });
    assert(byArt['order:5729'] === '3356' && byArt['order:5731'] === '3542' && byArt['order:5732'] === '3542',
        '«Заказ клиента» позиции — номер клиента, позиция подчинена заказу поставщику', JSON.stringify(byArt));
    var rows = plan.rows.map(function(r) { return r.order; });
    assert(JSON.stringify(rows) === JSON.stringify(['5729', '5730', '5731', '5732']), 'строки предпросмотра — по номеру заказа поставщику', JSON.stringify(rows));
})();

// ── S3. Повторный импорт: заказ найден по номеру поставщика ──────────────────────────────────
(function() {
    var c0 = ctxOf();
    var art = c0.res.tables.position.reqs.article, co = c0.res.tables.position.reqs.clientOrder;
    var pr = {}; pr[art] = '00012328'; pr[co] = '3356';
    var c = ctxOf([rec(700, '5729')], [rec(701, '150', pr, 700)]);
    var plan = planOf(c, [line('3356', '5729', '00012328')]);
    assert(plan.counts.ordersNew === 0 && plan.counts.new === 0, 'заказ 5729 есть в базе — новых заказа и позиции нет', JSON.stringify(plan.counts));
})();

// ── S4. Пустые номера ─────────────────────────────────────────────────────────────────────────
(function() {
    var p = LI.parseOrderSheet(sheet([line('6139', '', '00010001')]));
    assert(p.items.length === 1 && p.items[0].errors.some(function(e) { return /Заказ поставщику/.test(e) && /6139/.test(e); }),
        'нет «Заказ поставщику» — ошибка с номером заказа клиента', JSON.stringify(p.items[0] && p.items[0].errors));
    var c = ctxOf();
    var plan = planOf(c, [line('', '5800', '00010001')]);
    assert(plan.counts.new === 1 && plan.counts.error === 0 && plan.rows[0].warnings.some(function(w) { return /Заказ клиента/.test(w); }),
        'нет «Заказ клиента» — позиция импортируется с предупреждением', JSON.stringify(plan.rows[0]));
})();

console.log('\n' + passed + '/' + total + ' passed');
