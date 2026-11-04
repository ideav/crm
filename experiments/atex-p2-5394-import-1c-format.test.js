// ideav/crm#5394 — импорт заказов этикетки из 1С в формате выгрузки 04.11.2026.
//
// Что изменилось в выгрузке и что должен делать импорт:
//   Q1  «Заказано количество» не всегда в рулонах: при единице хранения «тыс. шт/1000 шт» — тысячи
//       этикеток, при пометке «(в шт)» в номенклатуре — штуки этикеток. Позиция хранит рулоны:
//       рулонов = этикеток / этикеток в рулоне; не делится нацело — ошибка строки, а не округление;
//   Q2  круглая этикетка в виде «D-20 2000 шт.» (без «х») — ширина = длина = 20;
//       «27 х 44 7/1500 шт.» — этикеток в рулоне 1500 (с предупреждением);
//   Q3  сырьё — по марке мастер-рулона в комментарии («MONOCHROME 0043 SG/HM/YG 0,300 х 2000 (П) - 4 шт»),
//       точным совпадением с названием в «Сырьё этикетки»; марки нет в справочнике — сырьё не
//       угадывается по «П/Гл», предупреждение называет марку;
//   Q4  комментарий строки (туррель, «Честный знак», откуда МР) — в примечание позиции;
//   Q5  лишняя колонка («Вес упаковки») разбору не мешает; строка без «Заказ клиента» — ошибка
//       с номером заказа поставщику.
//
// Фикстуры обезличены. Run with: node experiments/atex-p2-5394-import-1c-format.test.js

process.env.TZ = 'UTC';

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

var LI = require('../download/atex-p2/js/label-import-core.js');

// ── Метаданные и записи ──────────────────────────────────────────────────────────────────────

var tid = 100, ids = {};
function table(name, reqs) {
    var id = String(tid); tid += 100;
    ids[name] = { id: id, reqs: {} };
    var list = (reqs || []).map(function(r, i) {
        var rid = String(Number(id) + i + 1);
        var nm = Array.isArray(r) ? r[0] : r;
        ids[name].reqs[nm] = rid;
        return { id: rid, val: nm, type: '3', ref: Array.isArray(r) ? r[1] : undefined, field_attrs: { alias: null } };
    });
    return { id: id, val: name, reqs: list };
}
function buildMeta(withMaterial) {
    var meta = [];
    meta.push(table('Нож', ['Ширина этикетки, мм', 'Длина этикетки, мм']));
    meta.push(table('Движение пробега', ['Обороты пробега', 'Вид движения пробега']));
    meta.push(table('Вал', ['Раппорт, мм']));
    ['Основа сырья', 'Марка ножа', 'Состояние ножа', 'Вид движения пробега'].forEach(function(n) { meta.push(table(n, [])); });
    meta.push(table('Заказ', ['Клиент', 'Дата создания', 'Статус заказа', 'Примечания']));
    var pos = ['Вид продукции', 'Артикул', 'Заказ клиента', 'Ширина этикетки, мм', 'Длина этикетки, мм', 'Этикеток в рулоне',
        'Тип ножей', 'Диаметр втулки', 'Тип намотки', 'Ед.изм.', 'Статус позиции', 'Примечание'];
    if (withMaterial) pos = pos.concat(['Сырьё этикетки', 'Срок изготовления']);
    meta.push(table('Заказанное количество', pos));
    ['Клиент', 'Артикул', 'Вид продукции', 'Статус заказа', 'Статус позиции', 'Диаметр втулки', 'Ед.изм.'].forEach(function(n) {
        if (!ids[n]) meta.push(table(n, []));
    });
    if (withMaterial) {
        meta.push(table('Сырьё этикетки', ['Основа сырья', 'Клей']));
        meta.push(table('Настройка', ['Тип', 'Значение']));
    }
    return meta;
}
function rec(id, val, reqs, up) { return { id: String(id), up: String(up || 1), val: val, reqs: reqs || {} }; }

var MATERIAL = ids; // заполняется buildMeta
function orderCtx(opts) {
    var o = opts || {};
    ids = {}; tid = 100;
    var meta = buildMeta(o.withMaterial !== false);
    var res = LI.resolveImportTables(meta);
    var M = ids['Сырьё этикетки'];
    var materials = o.materials || [
        rec(901, '0043 SG/HM/YG', M ? (function() { var r = {}; r[M.reqs['Основа сырья']] = 'Бумага'; r[M.reqs['Клей']] = 'каучук'; return r; })() : {}),
        rec(902, 'ПП белый каучук', M ? (function() { var r = {}; r[M.reqs['Основа сырья']] = 'ПП'; r[M.reqs['Клей']] = 'каучук'; return r; })() : {})
    ];
    var S = ids['Настройка'];
    var settings = o.dueDays == null || !S ? [] : [rec(950, 'LABEL_DUE_DAYS', (function() { var r = {}; r[S.reqs['Тип']] = 'ATEH'; r[S.reqs['Значение']] = String(o.dueDays); return r; })())];
    var ordReq = ids['Заказ'].reqs, posReq = ids['Заказанное количество'].reqs;
    var orders = (o.orders || []);
    var positions = o.positions || [];
    return {
        res: res, ids: ids,
        ctx: LI.orderContext(res.tables, {
            orders: orders, positions: positions, clients: o.clients || [rec(20, 'ПРОИЗВОДСТВО САМОКЛЕЯЩАЯСЯ ЭТИКЕТКА'), rec(21, 'ДРУГОЙ КЛИЕНТ')],
            articles: [], productKinds: [rec(30, 'этикетка')], orderStatuses: [rec(40, 'Новый')], positionStatuses: [rec(41, 'Новая')],
            cores: [rec(50, 'Втулка картонная (40мм/3,5мм/1000мм) беленная для этикеток')], units: [rec(60, 'шт')],
            materials: materials, settings: settings, db: 'ateh1'
        })
    };
}

var HEAD = ['Партнер', 'Заказ Клиента', 'Заказ поставщику', 'Артикул', 'Номенклатура', 'Заказ.Комментарий', 'Заказ.Дата поступления',
    'Тип ножей', 'Короб', 'Единица хранения', 'Заказано количество'];
function sheet(rows) { return [HEAD].concat(rows); }
function line(order, art, nom, received) {
    return ['ПРОИЗВОДСТВО САМОКЛЕЯЩАЯСЯ ЭТИКЕТКА', order, '5297', art, nom, '', received == null ? '22.09.2026' : received, '18 х 18 (80)', '', 'шт', 294];
}
var NOM_PAPER = '18 х 18 10000 шт. П/Гл каучук вт 40 (П)';
var NOM_PP = '101 х 101 500 шт. П/П каучук вт 40 с прозрачным скотчем (П)';

function planOf(c, grid) { return LI.planOrders(LI.parseOrderSheet(grid), c.ctx, {}); }
function posNew(plan) { return plan.ops.filter(function(o) { return o.op === 'new' && o.table === ids['Заказанное количество'].id; })[0]; }
function warns(plan) { return [].concat.apply([], plan.rows.map(function(r) { return r.warnings; })); }

var HEAD = ['Партнер', 'Заказ Клиента', 'Заказ поставщику', 'Артикул', 'Номенклатура', 'Заказ.Комментарий', 'Заказ.Дата поступления',
    'Тип ножей', 'Короб', 'Единица хранения', 'Вес упаковки', 'Заказано количество'];
function sheet(rows) {
    return [HEAD, ['ПРОИЗВОДСТВО САМОКЛЕЯЩАЯСЯ ЭТИКЕТКА', '', '', '', '', '', '', '', '', '', '', '999999.5']]
        .concat(rows).concat([['Итого', '', '', '', '', '', '', '', '', '', '', '999999.5']]);
}
function line(o) {
    return ['ПРОИЗВОДСТВО САМОКЛЕЯЩАЯСЯ ЭТИКЕТКА', o.order == null ? '3501' : o.order, o.supplier || '6001', o.art || '00010001', o.nom,
        o.comment || '', '12.10.2026', '', '', o.unit || 'шт', o.weight || '10.2', o.qty];
}
function parse(rows) { return LI.parseOrderSheet(sheet(rows)); }
function planOf(c, rows) { return LI.planOrders(parse(rows), c.ctx, {}); }
function posNew(plan) { return plan.ops.filter(function(o) { return o.op === 'new' && o.table === ids['Заказанное количество'].id; })[0]; }
function warns(plan) { return [].concat.apply([], plan.rows.map(function(r) { return r.warnings; })); }

// ── Q1. Единица количества ───────────────────────────────────────────────────────────────────

(function() {
    var p = parse([
        line({ nom: '100 х 300 500 шт. П/П каучук вт 76 (П)', qty: '150' }),
        line({ art: '00010002', nom: '75 х 52 8000 шт. П/Гл каучук вт 76 Клиент (в шт) (П)', qty: '984000', weight: '127296' }),
        line({ art: '00010003', nom: '70 х 90 2500 шт. П/Гл каучук вт 76 (в тыс. шт.) (П)', unit: 'тыс. шт/1000 шт', qty: '3552.5' }),
        line({ art: '00010004', nom: '148 х 210 1000 шт. П/Гл каучук вт 76 (тыс.шт.) (П)', unit: 'тыс. шт/1000 шт', qty: '50' }),
        line({ art: '00010005', nom: '100 х 30 1200 шт. П/Гл каучук вт 40 (П)  (в шт)  ', qty: '1000' })
    ]);
    var it = p.items;
    assert(p.ok && it.length === 5 && p.skipped === 2, 'шапка с «Вес упаковки» найдена, строки партнёра и «Итого» пропущены', JSON.stringify({ ok: p.ok, n: it.length, sk: p.skipped }));
    assert(it[0].rolls === 150 && !it[0].errors.length, 'единица «шт» без пометки — количество в рулонах (150)');
    assert(it[1].rolls === 123 && !it[1].errors.length, '«(в шт)»: 984 000 этикеток / 8000 в рулоне = 123 рулона', it[1].rolls + ' ' + it[1].errors.join(' | '));
    assert(it[2].rolls === 1421 && !it[2].errors.length, '«тыс. шт/1000 шт»: 3552,5 тыс. / 2500 в рулоне = 1421 рулон', it[2].rolls + ' ' + it[2].errors.join(' | '));
    assert(it[3].rolls === 50, '«тыс. шт/1000 шт»: 50 тыс. / 1000 = 50 рулонов');
    assert(it[4].rolls == null && it[4].errors.some(function(e) { return /не делится/.test(e) && /1200/.test(e); }), '1000 этикеток не делятся на 1200 в рулоне — ошибка строки, не округление', it[4].errors.join(' | '));
    assert(/984\s?000/.test(it[1].qtySource || '') && /этикет/.test(it[1].qtySource || ''), 'в строке видно, сколько этикеток было в 1С', it[1].qtySource);
    assert(!it[0].qtySource, 'у рулонов пересчёта нет');
})();

// ── Q2. Номенклатура ─────────────────────────────────────────────────────────────────────────

(function() {
    var d = LI.parseNomenclature('D-20 2000 шт. П/П акрил вт 76 Клиент (в шт) (П)');
    assert(d && d.width === 20 && d.length === 20 && d.perRoll === 2000 && d.core === '76' && d.material === 'П/П' && d.glue === 'акрил', '«D-20 2000 шт.» — круглая 20 мм, 2000 в рулоне', JSON.stringify(d));
    var d2 = LI.parseNomenclature('D-52 2000 шт. П/Гл каучук вт 40 в шт. (П)');
    assert(d2 && d2.width === 52 && d2.length === 52 && d2.perRoll === 2000, '«D-52 2000 шт.»', JSON.stringify(d2));
    var s = LI.parseNomenclature('27 х 44 7/1500 шт. П/гл каучук вт 76 (тыс.шт.) (П)');
    assert(s && s.width === 27 && s.length === 44 && s.perRoll === 1500, '«7/1500 шт.» — этикеток в рулоне 1500', JSON.stringify(s));
    var p = parse([line({ nom: '27 х 44 7/1500 шт. П/гл каучук вт 76 (тыс.шт.) (П)', unit: 'тыс. шт/1000 шт', qty: '577.5' })]);
    assert(p.items[0].rolls === 385 && p.items[0].warnings.some(function(w) { return /7\/1500/.test(w); }), '577,5 тыс. / 1500 = 385 рулонов, «7/1500» — предупреждение', JSON.stringify(p.items[0].warnings));
    var old = LI.parseNomenclature('85 х 38 5000 шт. П/Гл каучук намотка внутрь вт 76 (П)');
    assert(old && old.width === 85 && old.length === 38 && old.perRoll === 5000 && old.winding === 'внутрь', 'прежний вид номенклатуры разбирается как раньше');
})();

// ── Q3. Сырьё из комментария, Q4. комментарий в примечание ──────────────────────────────────

(function() {
    var c = orderCtx({});
    var R = ids['Заказанное количество'].reqs;
    var COMMENT = 'туррель!\nMONOCHROME 0043 SG/HM/YG 0,300 - 306 х 2000 (П) - 41 шт';
    var plan = planOf(c, [line({ nom: '70 х 90 2500 шт. П/П каучук вт 76 (П)', qty: '20', comment: COMMENT })]);
    var pn = posNew(plan);
    assert(pn && pn.fields['t' + R['Сырьё этикетки']] === '901', 'марка МР из комментария (0043 SG/HM/YG) важнее обозначения «П/П» в номенклатуре', JSON.stringify(pn && pn.fields));
    var note = (pn && pn.fields['t' + R['Примечание']]) || '';
    assert(/туррель!/.test(note) && /MONOCHROME 0043/.test(note), 'комментарий строки — в примечании позиции', note);

    var M0 = ids['Сырьё этикетки'];
    var c2 = orderCtx({ materials: [rec(905, '0053 PP/A/G', (function() { var r = {}; r[M0.reqs['Основа сырья']] = 'ПП'; return r; })())] });
    var R2 = ids['Заказанное количество'].reqs;
    var pc = posNew(planOf(c2, [line({ nom: '30 х 30 15000 шт. MCHR ZNAK 14 Extra вт 76 (П)', qty: '21', comment: 'MONOCHROME 0053 PP/А/G 0,255 х 2000 (П) - 1 шт' })]));
    assert(pc && pc.fields['t' + R2['Сырьё этикетки']] === '905', 'кириллическая «А» в марке 1С совпадает с латинской в справочнике', JSON.stringify(pc && pc.fields));

    var c3 = orderCtx({});
    var R3 = ids['Заказанное количество'].reqs;
    var miss = planOf(c3, [line({ nom: '100 х 300 500 шт. П/П каучук вт 76 (П)', qty: '150', comment: 'MONOCHROME 0047 PP/HM/G 0,318 х 2000 (П) - 4 шт' })]);
    assert(!posNew(miss).fields['t' + R3['Сырьё этикетки']], 'марки 0047 нет в справочнике — сырьё не угадывается по «П/П»', JSON.stringify(posNew(miss).fields));
    assert(warns(miss).some(function(w) { return /0047 PP\/HM\/G/.test(w) && /нет сырья/.test(w); }), 'предупреждение называет марку из комментария', warns(miss).join(' | '));

    var none = planOf(c3, [line({ nom: '18 х 18 10000 шт. П/Гл каучук вт 40 (П)', qty: '10' })]);
    assert(posNew(none).fields['t' + R3['Сырьё этикетки']] === '901', 'без марки в комментарии — прежнее сопоставление по номенклатуре');
})();

// ── Q5. Строка без номера заказа ─────────────────────────────────────────────────────────────

(function() {
    var p = parse([line({ order: '', supplier: '6139', nom: '58 х 40 1000 шт. П/Гл каучук вт 76 (П)', qty: '140' })]);
    assert(p.items.length === 1 && p.items[0].errors.some(function(e) { return /Заказ клиента/.test(e) && /6139/.test(e); }), 'нет «Заказ клиента» — ошибка с номером заказа поставщику', JSON.stringify(p.items[0] && p.items[0].errors));
})();

console.log('\n' + passed + '/' + total + ' passed');
