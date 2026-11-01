// ideav/crm#5348 — Фаза 2 atex, шаг 10: пульт «Упаковка этикетки» (отдельное рабочее место, путь «б»).
//
// Что проверяется (ядро download/atex-p2/js/label-packer-core.js):
//   1. строка отчёта label_packer → позиция списка (партия ГП этикетки, заказ, размеры);
//   2. параметры рулона: длина = этикеток в рулоне × (длина этикетки + м/э расстояние);
//      диаметр = √(d² + 4·L·t/π); диаметр втулки — из названия «(76мм/…)» или дюймов × 25,4;
//      нет данных — рулон «не определён», упаковщик выбирает короб руками;
//   3. короб — функциями Фазы 1 packaging-size.js (matchSize/boxesFor), файл не правится;
//   4. план укладки: целые короба и неполный остаток (кандидат на «Склад НК», #5086);
//   5. проверки формы упаковки и пары «На склад НК / Со склада НК»; сальдо склада НК по артикулу;
//   6. очередь: «к упаковке» по порядку задания, упакованные отдельно;
//   7. записи: партия (упаковано, статус, короб, НК, место) и событие «Упаковка» журнала смены высечки;
//   8. таблицы и реквизиты резолвятся из /metadata по именам;
//   9. гранты роли «Оператор» (json) и шаблон страницы.
//
// Run with: node experiments/atex-p2-5348-label-packer.test.js

process.env.TZ = 'UTC';
var fs = require('fs');
var path = require('path');

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

var P = require('../download/atex-p2/js/label-packer-core.js').core;
var PS = require('../download/atex/js/packaging-size.js').core;

function row(o) {
    var base = {
        gp_id: '100', gp_name: 'ГПЭ-77-01', qty: '29', pack_status: 'к упаковке', packed: '', nk: '', notes: '',
        size_id: '', size_name: '', place_id: '',
        job_id: '77', job_start: '1790226000', order_no: '3259', client: 'Ромашка', order_client: 'К-15',
        art: 'ART-1', position_id: '500', label_width: '85', label_length: '38', labels_per_roll: '5000',
        sleeve_width: '90', sleeve: 'Втулка картонная (76мм/5мм/1000мм) беленная для этикеток', sleeve_inch: '3.00',
        material: '0043 SG/HM/YG', thickness: '62', die_gap: '3'
    };
    Object.keys(o || {}).forEach(function(k) { base[k] = o[k]; });
    return base;
}

// ── 1. строка отчёта ──
var it = P.itemFromReportRow(row());
assert(it.gpId === '100' && it.name === 'ГПЭ-77-01' && it.qty === 29 && it.status === 'к упаковке', 'партия: id, имя, рулонов, статус');
assert(it.orderNo === '3259' && it.client === 'Ромашка' && it.art === 'ART-1' && it.jobId === '77', 'заказ, клиент, артикул, задание');
assert(it.labelWidth === 85 && it.labelLength === 38 && it.perRoll === 5000 && it.sleeveWidth === 90, 'размеры позиции — числами');
assert(P.itemFromReportRow({ gp_id: '5' }).qty === 0 && P.itemFromReportRow(null).gpId === '', 'пустая строка не ломает разбор');
var kv = P.itemFromReportRow({ gp_id: { val: '9', id: '9' }, qty: { val: '4' } });
assert(kv.gpId === '9' && kv.qty === 4, 'значение вида {val,id} из JSON_KV');

// ── 2. рулон ──
var roll = P.rollParams(it);
assert(roll.ok && Math.abs(roll.lengthM - 205) < 1e-9, 'длина ролика = 5000 × (38 + 3) мм = 205 м', 'получено ' + roll.lengthM);
assert(roll.sleeveMm === 76, 'диаметр втулки — из названия «(76мм/…)»');
var expectD = Math.sqrt(76 * 76 + 4 * 205000 * 0.062 / Math.PI);
assert(Math.abs(roll.diameterMm - Math.round(expectD)) < 1e-9, 'диаметр рулона = √(d² + 4·L·t/π) = ' + Math.round(expectD) + ' мм', 'получено ' + roll.diameterMm);
assert(roll.widthMm === 90, 'ширина рулона — «Ширина втулки, мм» позиции');
var inch = P.rollParams(P.itemFromReportRow(row({ sleeve: 'Втулка картонная 1" длина 1 метр', sleeve_inch: '1.00' })));
assert(inch.sleeveMm === 25.4, 'втулка без мм в названии — дюймы × 25,4');
var noThick = P.rollParams(P.itemFromReportRow(row({ thickness: '' })));
assert(noThick.lengthM > 0 && noThick.diameterMm === 0 && noThick.missing.indexOf('толщина') !== -1, 'нет толщины — длина есть, диаметр не определён');
var noPer = P.rollParams(P.itemFromReportRow(row({ labels_per_roll: '' })));
assert(!noPer.ok && noPer.lengthM === 0 && noPer.missing.indexOf('этикеток в рулоне') !== -1, 'нет «этикеток в рулоне» — рулон не определён');
var noGap = P.rollParams(P.itemFromReportRow(row({ die_gap: '' })));
assert(Math.abs(noGap.lengthM - 190) < 1e-9, 'нет м/э расстояния — считается без зазора (190 м)');
var noW = P.rollParams(P.itemFromReportRow(row({ sleeve_width: '' })));
assert(!noW.ok && noW.missing.indexOf('ширина рулона') !== -1, 'нет ширины рулона — рулон не определён');

// ── 3. короб ──
function sizeRow(id, box, wf, wt, lf, lt, per) {
    return { size_id: id, size_name: 'N' + id, add_sleeve: '', rows_cnt: '1', per_row: String(per), per_box: String(per), box: box,
        w_from: String(wf), w_to: String(wt), l_from: String(lf), l_to: String(lt), foil: '' };
}
var sizes = PS.sizesFromReport([
    sizeRow('1', '№101', 62, 83, 201, 320, 24),
    sizeRow('2', '№102', 84, 124, 201, 320, 12),
    sizeRow('3', '№103', 84, 124, 321, 450, 8),
    { size_id: '9', size_name: 'по втулке', add_sleeve: '', per_box: '5', box: '№9', w_from: '', w_to: '', l_from: '', l_to: '' }
]);
var picked = P.pickSize(sizes, it);
assert(picked && picked.id === '2' && picked.box === '№102', 'короб по ширине 90 и длине 205 м — запись 2 (№102)');
assert(P.pickSize(sizes, P.itemFromReportRow(row({ sleeve_width: '300' }))) === null, 'ничего не подошло — null, выбор руками');
assert(P.pickSize(sizes, P.itemFromReportRow(row({ labels_per_roll: '' }))) === null, 'рулон не определён — короб не подбирается');
var manual = P.manualSizes(sizes);
assert(manual.map(function(x) { return x.box; }).join() === '№9,№101,№102,№103', 'ручной выбор — все записи справочника с коробом, по номеру короба');

var split = P.splitSizes(sizes, it);
assert(split.near.map(function(x) { return x.id; }).join() === '2,3' && split.rest.map(function(x) { return x.id; }).join() === '9,1',
    'ручной выбор: сначала короба по ширине рулона (все длины), затем остальные', JSON.stringify([split.near.length, split.rest.length]));
assert(P.splitSizes(sizes, P.itemFromReportRow(row({ sleeve_width: '' }))).near.length === 0, 'ширина неизвестна — «подходящих» нет, весь список в «остальных»');

// ── 4. укладка ──
var plan = P.packPlan(picked, 29);
assert(plan.perBox === 12 && plan.boxes === 3 && plan.full === 2 && plan.rest === 5, '29 рулонов по 12: 3 короба, 2 полных, неполный на 5', JSON.stringify(plan));
assert(plan.boxes === PS.boxesFor(picked, 29), 'число коробов считает boxesFor Фазы 1');
var exact = P.packPlan(picked, 24);
assert(exact.boxes === 2 && exact.full === 2 && exact.rest === 0, '24 рулона по 12: без неполного короба');
var none = P.packPlan(null, 29);
assert(none.perBox === 0 && none.boxes === 0 && none.rest === 0, 'без короба укладка не считается');
assert(P.describePlan(plan).indexOf('3 короба') !== -1 && P.describePlan(plan).indexOf('5') !== -1, 'подпись укладки называет коробы и остаток');

// ── 5. формы ──
assert(P.validatePack({ qty: '29', suggested: 29, note: '' }) === '', 'как в партии — примечание не нужно');
assert(P.validatePack({ qty: '0', suggested: 29 }) !== '' && P.validatePack({ qty: 'x', suggested: 29 }) !== '', 'ноль и мусор отклоняются');
assert(P.validatePack({ qty: '28.5', suggested: 29, note: 'x' }) !== '', 'дробное число рулонов отклоняется');
assert(P.validatePack({ qty: '25', suggested: 29, note: '' }) !== '' && P.validatePack({ qty: '25', suggested: 29, note: 'брак 4' }) === '', 'другое количество — только с примечанием');
assert(P.validatePack({ qty: '33', suggested: 29, nkFrom: 4, note: '' }) === '', 'взятое со склада НК — законный повод упаковать больше');
assert(P.nkValue('5', '') === 5 && P.nkValue('', '3') === -3 && P.nkValue('', '') === 0, 'движение НК: на склад +, со склада −');
assert(P.validateNk({ to: '2', from: '3' }) !== '' && P.validateNk({ to: '2.5' }) !== '' && P.validateNk({ to: '5' }) === '', 'пара НК: одно поле, целое');
assert(P.validateNk({ from: '4', available: 3 }) !== '' && P.validateNk({ from: '3', available: 3 }) === '', 'со склада НК — не больше остатка');
var stock = P.nkStockByArt([
    P.itemFromReportRow(row({ gp_id: '1', art: 'A', nk: '5' })),
    P.itemFromReportRow(row({ gp_id: '2', art: 'A', nk: '-2' })),
    P.itemFromReportRow(row({ gp_id: '3', art: 'B', nk: '7' })),
    P.itemFromReportRow(row({ gp_id: '4', art: '', nk: '9' }))
]);
assert(stock.A === 3 && stock.B === 7 && !('' in stock), 'сальдо НК по артикулу: 5 − 2 = 3; без артикула не участвует');
var items2 = [P.itemFromReportRow(row({ gp_id: '1', art: 'A', nk: '5' }))];
items2[0].editedNk = 8;
assert(P.nkStockByArt(items2).A === 8, 'несохранённая правка движения видна в сальдо сразу');

// ── 6. очередь ──
var q = P.buildQueue([
    P.itemFromReportRow(row({ gp_id: '3', job_id: '12', job_start: '300', pack_status: 'к упаковке' })),
    P.itemFromReportRow(row({ gp_id: '1', job_id: '10', job_start: '100', pack_status: 'к упаковке' })),
    P.itemFromReportRow(row({ gp_id: '2', job_id: '11', job_start: '200', pack_status: 'упаковано', packed: '29' })),
    P.itemFromReportRow(row({ gp_id: '4', job_id: '13', job_start: '400', pack_status: '' }))
]);
assert(q.todo.map(function(x) { return x.gpId; }).join() === '1,3', 'к упаковке — по порядку заданий');
assert(q.done.length === 1 && q.done[0].gpId === '2', 'упакованные — отдельным списком');
assert(q.other.length === 1 && q.other[0].gpId === '4', 'партия с другим статусом не попадает ни в очередь, ни в упакованные');
var grouped = P.groupByOrder([
    P.itemFromReportRow(row({ gp_id: '1', order_no: '10' })), P.itemFromReportRow(row({ gp_id: '2', order_no: '11' })),
    P.itemFromReportRow(row({ gp_id: '3', order_no: '10' })), P.itemFromReportRow(row({ gp_id: '4', order_no: '' })),
    P.itemFromReportRow(row({ gp_id: '5', order_no: '' }))
]);
assert(grouped.length === 4 && grouped[0].items.length === 2 && grouped[0].qty === 58, 'партии одного заказа — одна плашка с суммой рулонов; без заказа — по одной');

// ── 7. записи ──
var T = {
    gp: { id: '21', reqs: { job: '22', qty: '23', size: '24', status: '25', packed: '26', nk: '27', notes: '28', place: '29' } },
    event: { id: '31', reqs: { type: '32', operator: '33', notes: '34', job: '35' } }
};
var f = P.gpFields(T.gp, { qty: 29, sizeId: '2', nk: 5, note: 'п', placeId: '8' });
assert(f.t26 === '29' && f.t25 === 'упаковано' && f.t24 === '2' && f.t27 === '5' && f.t28 === 'п' && f.t29 === '8', 'партия: упаковано, статус, короб, НК, примечание, место');
var f0 = P.gpFields(T.gp, { qty: 29, sizeId: '', nk: 0, note: '', placeId: '' });
assert(f0.t27 === '' && !('t24' in f0) && !('t29' in f0) && !('t28' in f0), 'нулевое НК очищает поле; пустые короб/место/примечание не пишутся');
var fn = P.gpFields(T.gp, { qty: 29 });
assert(!('t27' in fn), 'движение НК не передано — поле не трогаем');
var ev = P.eventFields(T.event, { now: 1790226000, typeId: '7', userId: '3', jobId: '77', qty: 29, box: '№102', boxes: 3, nk: 5, place: '4', note: 'п' });
assert(ev.t31 === '1790226000' && ev.t32 === '7' && ev.t33 === '3' && ev.t35 === '77', 'событие: время, тип, оператор, задание');
assert(/упаковано 29 рул/.test(ev.t34) && ev.t34.indexOf('№102') !== -1 && ev.t34.indexOf('на склад НК 5') !== -1 && ev.t34.indexOf('место 4') !== -1,
    'примечание события: количество, короб, НК, место', ev.t34);

// ── 8. метаданные ──
function req(id, val, alias) { return { id: id, val: val, field_attrs: { alias: alias || null } }; }
var meta = [
    { id: '21', val: 'Партия ГП этикетки', reqs: [req('22', 'Задание высечки'), req('23', 'Количество'), req('24', 'Типоразмер'), req('25', 'Статус упаковки'),
        req('26', 'Упаковано, рулонов'), req('27', 'Склад НК, рулонов'), req('28', 'Примечание'), req('29', 'Упаковочное место')] },
    { id: '31', val: 'Событие смены высечки', reqs: [req('32', 'Тип события высечки'), req('33', 'Пользователь', 'Оператор'), req('34', 'Примечание'), req('35', 'Задание высечки')] },
    { id: '41', val: 'Тип события высечки', reqs: [] }
];
var res = P.resolvePackTables(meta);
assert(res.missing.length === 0 && res.tables.gp.reqs.packed === '26' && res.tables.event.reqs.operator === '33' && res.tables.eventType.id === '41',
    'таблицы и реквизиты найдены по именам/псевдонимам', JSON.stringify(res.missing));
var res2 = P.resolvePackTables(meta.slice(1));
assert(res2.missing.length > 0 && res2.missing[0].indexOf('Партия ГП этикетки') !== -1, 'нет таблицы — в missing с именем');
var meta3 = JSON.parse(JSON.stringify(meta)); meta3[0].reqs = meta3[0].reqs.filter(function(r) { return r.id !== '26'; });
assert(P.resolvePackTables(meta3).missing.join().indexOf('Упаковано, рулонов') !== -1, 'нет реквизита «Упаковано, рулонов» — в missing');

// ── 9. гранты и шаблон ──
var grants = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'atex_p2_label_packer_5348.json'), 'utf8'));
var op = grants.roles.filter(function(r) { return r.name === 'Оператор'; })[0];
function lvl(table, field) {
    var g = op.grants.filter(function(x) { return x.table === table && (x.field || '') === (field || ''); })[0];
    return g ? g.level : '';
}
assert(lvl('Партия ГП этикетки') === 'WRITE' && lvl('Событие смены высечки') === 'WRITE', 'Оператор пишет партии ГП этикетки и события высечки');
assert(lvl('Упаковочное место') === 'READ' && lvl('Тип события высечки') === 'READ' && lvl('Типоразмер') === 'READ', 'Оператор читает места, типы событий, типоразмеры');
var schema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'atex_phase2_schema.json'), 'utf8'));
var gpTable = schema.tables.filter(function(t) { return t.name === 'Партия ГП этикетки'; })[0];
var gpFieldNames = gpTable.fields.map(function(x) { return x.name; });
assert(['Упаковано, рулонов', 'Склад НК, рулонов', 'Примечание', 'Упаковочное место'].every(function(n) { return gpFieldNames.indexOf(n) !== -1; }),
    'декларация схемы: у партии ГП этикетки есть поля упаковки');

var tpl = fs.readFileSync(path.join(__dirname, '..', 'templates', 'atex-p2', 'label-packer.html'), 'utf8');
var curly = (tpl.match(/\{[^{}]*\}/g) || []).filter(function(s) { return s.indexOf('{_global_.') !== 0; });
assert(curly.length === 0, 'в шаблоне только точки вставки {_global_.*} (CLAUDE.md, #5231)', curly.join(' '));

console.log('\n' + passed + '/' + total + ' passed');
