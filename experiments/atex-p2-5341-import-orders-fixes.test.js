// ideav/crm#5341 — дефекты импорта из 1С и «Заказов этикетки» по итогам прокликивания ateh1.
//
//   I1  импорт заполняет у позиции сырьё (по обозначению материала и клею из номенклатуры) и срок
//       (поступление + LABEL_DUE_DAYS, по умолчанию 14); не сопоставилось — предупреждение
//       «позиция не готова к подбору ножа: нет сырья»; выбор менеджера повторный импорт не затирает;
//   I4  номер заказа уже есть в базе у другого клиента — предупреждение;
//   I3  предупреждения группируются по типу со счётчиком;
//   I2  индикатор загрузки предпросмотра;
//   D13 карточка не пишет «записано: ничего», пока нож записывается или уже записан;
//   —   статусы: выполнены все задания позиции → «Выполнена», все позиции заказа → «Выполнен»;
//   —   «меньше мин. партии» объясняет, что делать.
//
// Фикстуры обезличены. Run with: node experiments/atex-p2-5341-import-orders-fixes.test.js

process.env.TZ = 'UTC';

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

var LI = require('../download/atex-p2/js/label-import-core.js');
var LO = require('../download/atex-p2/js/label-orders.js').core;
var APP = require('../download/atex-p2/js/label-import.js');

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
    meta.push(table('Движение пробега', ['Метры пробега', 'Вид движения пробега']));
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

// ── I1. Сырьё и срок ─────────────────────────────────────────────────────────────────────────

(function() {
    var c = orderCtx({});
    var nom = LI.parseNomenclature(NOM_PAPER);
    assert(nom && nom.material === 'П/Гл' && nom.glue === 'каучук', 'номенклатура: обозначение материала и клей', JSON.stringify(nom));
    assert(LI.parseNomenclature('65 х 50 3800 шт. П/Гл намотка внутрь каучук вт 76 (П)').material === 'П/Гл', 'обозначение материала не путается с «намотка»');

    var plan = planOf(c, sheet([line('3257', '00014677', NOM_PAPER)]));
    var pn = posNew(plan), R = ids['Заказанное количество'].reqs;
    assert(pn && pn.fields['t' + R['Сырьё этикетки']] === '901', 'позиция «П/Гл» получает сырьё на бумажной основе (0043 SG/HM/YG)', JSON.stringify(pn && pn.fields));
    assert(pn && pn.fields['t' + R['Срок изготовления']] === '06.10.2026', 'срок = поступление 22.09.2026 + 14 дней по умолчанию', pn && pn.fields['t' + R['Срок изготовления']]);
    assert(warns(plan).every(function(w) { return !/нет сырья/.test(w); }), 'сырьё сопоставлено — предупреждения «нет сырья» нет');

    var pp = posNew(planOf(c, sheet([line('3266', '00015107', NOM_PP)])));
    assert(pp && pp.fields['t' + R['Сырьё этикетки']] === '902', '«П/П» → сырьё на основе ПП');

    var c10 = orderCtx({ dueDays: 10 });
    var p10 = posNew(planOf(c10, sheet([line('3257', '00014677', NOM_PAPER)])));
    assert(p10.fields['t' + R['Срок изготовления']] === '02.10.2026', 'N берётся из настройки LABEL_DUE_DAYS (10 → 02.10.2026)');
    assert(c10.ctx.dueDays === 10 && c.ctx.dueDays === 14, 'ctx.dueDays: настройка / умолчание 14');
    assert(LI.addDays('25.12.2026', 14) === '08.01.2027', 'срок переходит через границу года');

    // Нельзя сопоставить: две бумаги подходят одинаково
    var M = ids['Сырьё этикетки'];
    var two = [rec(901, 'Бумага А', (function() { var r = {}; r[M.reqs['Основа сырья']] = 'Бумага'; return r; })()),
        rec(903, 'Бумага Б', (function() { var r = {}; r[M.reqs['Основа сырья']] = 'Бумага'; return r; })())];
    var amb = orderCtx({ materials: two });
    var pa = planOf(amb, sheet([line('3257', '00014677', NOM_PAPER)]));
    assert(warns(pa).some(function(w) { return /не готова к подбору ножа: нет сырья/.test(w); }), 'не сопоставилось — предупреждение «позиция не готова к подбору ножа: нет сырья»', warns(pa).join(' | '));
    assert(!posNew(pa).fields['t' + R['Сырьё этикетки']], 'неоднозначное сырьё не угадывается и не пишется');
    assert(pa.counts.warnings === 1, 'позиция с предупреждением сосчитана в плитке «с предупреждениями»');

    var unk = planOf(c, sheet([line('3257', '00014677', '18 х 18 10000 шт. ХЗ-материал каучук вт 40 (П)')]));
    assert(warns(unk).some(function(w) { return /нет сырья/.test(w) && /ХЗ-материал/.test(w); }), 'неизвестное обозначение — предупреждение с обозначением из 1С');

    var nodate = planOf(c, sheet([line('3257', '00014677', NOM_PAPER, '')]));
    assert(warns(nodate).some(function(w) { return /нет даты поступления/.test(w); }) && !posNew(nodate).fields['t' + R['Срок изготовления']], 'нет даты поступления — срок пуст и есть предупреждение');
})();

// ── I1. Повторный импорт: заполняет пустое, чужой выбор не затирает ──────────────────────────

(function() {
    var base = orderCtx({});
    var R = ids['Заказанное количество'].reqs, O = ids['Заказ'].reqs;
    function existing(posReqs) {
        var o = rec(700, '3257', (function() { var r = {}; r[O['Клиент']] = 'ПРОИЗВОДСТВО САМОКЛЕЯЩАЯСЯ ЭТИКЕТКА'; r['ref_' + O['Клиент']] = '0:20'; return r; })());
        var p = rec(701, '294', posReqs, 700);
        return orderCtx({ orders: [o], positions: [p] });
    }
    var artReq = R['Артикул'];
    var emptyPos = {}; emptyPos[artReq] = '00014677';
    var c1 = existing(emptyPos);
    var plan = planOf(c1, sheet([line('3257', '00014677', NOM_PAPER)]));
    var set = plan.ops.filter(function(o) { return o.op === 'set' && o.id === '701'; })[0];
    assert(set && set.fields['t' + R['Сырьё этикетки']] === '901' && set.fields['t' + R['Срок изготовления']] === '06.10.2026', 'позиция без сырья и срока: повторный импорт их заполняет', JSON.stringify(set && set.fields));
    assert(plan.rows[0].changes.some(function(ch) { return ch.field === 'Сырьё этикетки'; }), 'в предпросмотре видно изменение «Сырьё этикетки»');

    var mine = {}; mine[artReq] = '00014677'; mine[R['Сырьё этикетки']] = '902'; mine['ref_' + R['Сырьё этикетки']] = '0:902'; mine[R['Срок изготовления']] = '01.12.2026';
    var c2 = existing(mine);
    var plan2 = planOf(c2, sheet([line('3257', '00014677', NOM_PAPER)]));
    var set2 = plan2.ops.filter(function(o) { return o.op === 'set' && o.id === '701'; })[0];
    assert(!set2 || (!('t' + R['Сырьё этикетки'] in set2.fields) && !('t' + R['Срок изготовления'] in set2.fields)), 'выбранное менеджером сырьё и срок повторный импорт не затирает');
    assert(warns(plan2).every(function(w) { return !/нет сырья/.test(w); }), 'у позиции сырьё уже есть — предупреждения нет');
})();

// ── I4. Тот же номер заказа у другого клиента ────────────────────────────────────────────────

(function() {
    var O = ids['Заказ'].reqs;
    function withClient(clientId, label) {
        var r = {}; r[O['Клиент']] = label; r['ref_' + O['Клиент']] = '0:' + clientId;
        return orderCtx({ orders: [rec(700, '3257', r)], positions: [] });
    }
    var other = withClient(21, 'ДРУГОЙ КЛИЕНТ');
    var plan = planOf(other, sheet([line('3257', '00014677', NOM_PAPER)]));
    var w = warns(plan).filter(function(x) { return /уже есть в базе у клиента/.test(x); });
    assert(w.length === 1 && /ДРУГОЙ КЛИЕНТ/.test(w[0]) && /ПРОИЗВОДСТВО САМОКЛЕЯЩАЯСЯ ЭТИКЕТКА/.test(w[0]), 'номер заказа есть у другого клиента — предупреждение с обоими именами', w.join(' | '));
    var same = withClient(20, 'ПРОИЗВОДСТВО САМОКЛЕЯЩАЯСЯ ЭТИКЕТКА');
    assert(warns(planOf(same, sheet([line('3257', '00014677', NOM_PAPER)]))).every(function(x) { return !/уже есть в базе у клиента/.test(x); }), 'тот же клиент — предупреждения нет');
    var noClient = orderCtx({ orders: [rec(700, '3257', {})], positions: [] });
    assert(warns(planOf(noClient, sheet([line('3257', '00014677', NOM_PAPER)]))).every(function(x) { return !/уже есть в базе у клиента/.test(x); }), 'у заказа клиента не было — это заполнение, а не смена');
})();

// ── Старые базы без таблицы «Сырьё этикетки»: импорт работает как раньше ──────────────────────

(function() {
    var c = orderCtx({ withMaterial: false });
    var plan = planOf(c, sheet([line('3257', '00014677', NOM_PAPER)]));
    assert(!c.res.missing.some(function(m) { return /^(position|material|setting|order)/.test(m); }) && plan.counts.new === 1 && warns(plan).length === 0, 'без колонок «Сырьё этикетки»/«Срок» они не считаются потерянными и новых предупреждений нет', c.res.missing.join(';'));
})();

// ── I3. Группировка предупреждений ───────────────────────────────────────────────────────────

(function() {
    var rows = [];
    for (var i = 0; i < 30; i++) rows.push({ row: i + 2, key: '9000' + i, warnings: ['раппорт ножа ' + (366.3 + i / 10) + ' мм ≠ раппорт вала ' + (368.3 - i / 10) + ' мм (вал 96)'] });
    rows.push({ row: 40, key: '91', warnings: ['вал «0» — нож импортируется без вала'] });
    rows.push({ row: 41, key: '92', warnings: ['вал «0» — нож импортируется без вала', 'основа «ПП» — нет в справочнике «Основа сырья», поле не заполняется'] });
    var g = LI.groupWarnings(rows);
    assert(g.length === 3, '32 предупреждения разных чисел сводятся к 3 типам', g.map(function(x) { return x.count + ':' + x.type; }).join(' | '));
    assert(g[0].count === 30 && g[1].count === 2 && g[0].rows.length === 30, 'тип со счётчиком и списком строк; крупные типы первыми');
    var html = APP.warningGroupsHtml(rows, 5);
    assert(/<details/.test(html) && /<b>30<\/b>/.test(html) && /и ещё 25/.test(html), 'раскрываемая группа: счётчик, обрезка длинного списка');
})();

// ── I2. Индикатор загрузки ───────────────────────────────────────────────────────────────────

(function() {
    var h = APP.loadingHtml('Сверяю с базой', 7);
    assert(/atex-limp-spinner/.test(h) && /Сверяю с базой/.test(h) && /7 с/.test(h), 'индикатор: крутилка, текст и секунды');
    assert(!/ с$/.test(APP.loadingHtml('Читаю', 0)), 'в первую секунду счётчик секунд не показывается');
})();

// ── D13. «В позиции записано: ничего» ────────────────────────────────────────────────────────

(function() {
    var plan = { die: { ok: true, die: { id: '321', no: '730134' }, pick: 'подобран' } };
    var fresh = { dieId: '', pick: '', dieNo: '' };
    var n1 = LO.recordedNote(fresh, plan, true);
    assert(n1.show && !/ничего/.test(n1.text) && /записывается/.test(n1.text), 'пока нож пишется — «записывается», а не «записано: ничего»', n1.text);
    var n2 = LO.recordedNote({ dieId: '321', pick: 'подобран', dieNo: '730134' }, plan, false);
    assert(!n2.show, 'нож записан и совпадает с расчётом — строки нет');
    var n3 = LO.recordedNote(fresh, plan, false);
    assert(n3.show && !/ничего/.test(n3.text) && /нож не записан/.test(n3.text), 'не записан и подбор не идёт — «нож не записан», без слова «ничего»', n3.text);
    var n4 = LO.recordedNote({ dieId: '999', pick: 'подобран', dieNo: '555' }, plan, false);
    assert(n4.show && /№ 555/.test(n4.text), 'записан другой нож — показан его номер');
})();

// ── «Меньше мин. партии» ─────────────────────────────────────────────────────────────────────

(function() {
    var t = LO.minBatchAdvice(127176, 2000);
    assert(/Что сделать/.test(t) && /объединить/.test(t) && /2000 м/.test(t) && /127 176/.test(t) && /не блокируется/.test(t), 'подсказка объясняет, что делать, и называет партию и длину МР', t);
})();

// ── Статусы позиции и заказа ─────────────────────────────────────────────────────────────────

var ST = require('../download/atex-p2/js/label-status-core.js');
(function() {
    var tables = { positionStatus: { id: '16323' }, positionStatusReq: '16325', orderStatusReq: '16316' };
    var dicts = {
        positionStatuses: [{ id: '16343', val: 'Новая' }, { id: '16366', val: 'Согласована' }],
        orderStatuses: [{ id: '16318', val: 'Выполнен' }, { id: '16319', val: 'Отменён' }, { id: '16320', val: 'Новый' }]
    };
    function input(over) {
        return Object.assign({
            order: { id: '10', status: 'Новый' },
            positions: [{ id: '11', status: 'Новая' }, { id: '12', status: 'Новая' }],
            jobs: [{ id: '1', positionId: '11', status: 'Выполнено' }, { id: '2', positionId: '12', status: 'Запланировано' }],
            tables: tables
        }, dicts, over || {});
    }
    var p1 = ST.completionPlan(input());
    assert(p1.positionsDone.join() === '11' && !p1.orderDone, 'выполнено задание одной из двух позиций: позиция «Выполнена», заказ нет');
    assert(p1.ops[0].op === 'new' && p1.ops[0].table === '16323' && p1.ops[1].fields.t16325.ref, 'нет «Выполнена» в справочнике — создаётся, позиция ссылается на новую запись');

    var p2 = ST.completionPlan(input({ jobs: [{ id: '1', positionId: '11', status: 'Выполнено' }, { id: '3', positionId: '11', status: 'В работе' }] }));
    assert(p2.positionsDone.length === 0 && p2.ops.length === 0, 'у позиции есть невыполненное задание — статус не меняется');

    var all = input({ jobs: [{ id: '1', positionId: '11', status: 'Выполнено' }, { id: '2', positionId: '12', status: 'Выполнено' }] });
    var p3 = ST.completionPlan(all);
    var orderSet = p3.ops.filter(function(o) { return o.op === 'set' && o.id === '10'; })[0];
    assert(p3.orderDone && orderSet && orderSet.fields.t16316 === '16318' && p3.positionsDone.join() === '11,12', 'выполнены задания всех позиций — выполнены обе позиции и заказ');

    var withDone = input({ positionStatuses: dicts.positionStatuses.concat([{ id: '16400', val: 'Выполнена' }]) });
    var p4 = ST.completionPlan(Object.assign({}, withDone, { jobs: all.jobs }));
    assert(p4.ops.every(function(o) { return o.op === 'set'; }) && p4.ops[0].fields.t16325 === '16400', '«Выполнена» уже есть — берётся её id, справочник не пополняется');

    var noJobs = ST.completionPlan(input({ jobs: [{ id: '1', positionId: '11', status: 'Выполнено' }], positions: [{ id: '11', status: 'Новая' }, { id: '12', status: 'Новая' }] }));
    assert(!noJobs.orderDone, 'позиция без заданий не выполнена — заказ остаётся открытым');

    var cancelled = ST.completionPlan(Object.assign({}, all, { order: { id: '10', status: 'Отменён' } }));
    assert(!cancelled.orderDone, 'отменённый заказ не становится выполненным');
    var again = ST.completionPlan(Object.assign({}, all, { order: { id: '10', status: 'Выполнен' }, positions: [{ id: '11', status: 'Выполнена' }, { id: '12', status: 'Выполнена' }] }));
    assert(again.ops.length === 0, 'повторный вызов ничего не пишет');

    // applyPlan: запись по порядку, ссылка на созданный справочник подставляется
    var calls = [];
    var api = {
        create: function(t, up, f) { calls.push(['new', t, up, JSON.stringify(f)]); return Promise.resolve('777'); },
        set: function(id, f) { calls.push(['set', id, JSON.stringify(f)]); return Promise.resolve({}); }
    };
    return ST.applyPlan(p3, api).then(function() {
        assert(calls[0][0] === 'new' && calls[1][2].indexOf('"t16325":"777"') >= 0, 'applyPlan: сначала справочник, потом позиции с его id', JSON.stringify(calls));
    }).then(function() {
        // completeAfterJob по поддельному клиенту
        var meta = [
            { id: '1100', val: 'Задание высечки', reqs: [{ id: '1101', val: 'Заказанное количество' }, { id: '1102', val: 'Статус задания этикетки' }] },
            { id: '1076', val: 'Заказанное количество', reqs: [{ id: '16325', val: 'Статус позиции' }] },
            { id: '1075', val: 'Заказ', reqs: [{ id: '16316', val: 'Статус заказа' }] },
            { id: '16323', val: 'Статус позиции', reqs: [] }, { id: '16314', val: 'Статус заказа', reqs: [] }
        ];
        var writes = [];
        var client = {
            getJson: function(path) {
                if (/^object\/1100/.test(path)) return Promise.resolve({ object: [{ id: '5', val: '1' }], reqs: { 5: { 1101: 'x', ref_1101: '1076:11', 1102: 'Выполнено' } } });
                if (/^report\/label_positions/.test(path)) return Promise.resolve([{ 'РулоновID': '11', 'ЗаказID': '10', 'Статус': 'Новая' }]);
                if (/^object\/1075/.test(path)) return Promise.resolve({ object: [{ id: '10', val: '3257' }], reqs: { 10: { 16316: 'Новый' } } });
                if (/^object\/16323/.test(path)) return Promise.resolve({ object: [{ id: '16400', val: 'Выполнена' }], reqs: {} });
                if (/^object\/16314/.test(path)) return Promise.resolve({ object: [{ id: '16318', val: 'Выполнен' }], reqs: {} });
                return Promise.reject(new Error('неожиданный запрос ' + path));
            },
            post: function(path, f) { writes.push([path, JSON.stringify(f)]); return Promise.resolve({}); }
        };
        return ST.completeAfterJob(client, meta, '5').then(function(plan) {
            assert(plan.orderDone && writes.length === 2 && /^_m_set\/11/.test(writes[0][0]) && /^_m_set\/10/.test(writes[1][0]), 'completeAfterJob: читает базу и пишет статусы позиции и заказа', JSON.stringify(writes));
        });
    });
})().then(function() {
    console.log('\n' + passed + '/' + total + ' passed');
}).catch(function(e) { console.log('FAIL — исключение: ' + e.stack); process.exitCode = 1; });
