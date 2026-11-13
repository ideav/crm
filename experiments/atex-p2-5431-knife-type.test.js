// ideav/crm#5431 — параметры ножа читаются через «Тип ножа», у «Ножа» колонок параметров нет.
//
//   1. resolveProductionTables: «Нож» — номер, тип, дата поставки, высота, марка, состояние,
//      пробег; параметры (размер, ручьи, раппорт, вал, основа, форматы…) резолвятся в «Тип ножа»,
//      и t.die.reqs.<параметр> указывает на реквизит типа;
//   2. withDieTypes: записи ножей получают значения своего типа (с ref_ у ссылок); нож без типа —
//      без параметров; свои поля ножа (состояние) не затираются;
//   3. подбор ножа (label-orders) и индекс ножей планирования высечки видят параметры типа;
//   4. импорт: нож без типа в базе привязывается к подходящему типу (из нескольких — у кого больше
//      ножей), параметры в «Нож» не пишутся.
//
// Run with: node experiments/atex-p2-5431-knife-type.test.js

process.env.TZ = 'UTC';

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

var LP = require('../download/atex/js/label-production.js').core;

// /metadata копии ateh1 после #5431: параметры — у «Типа ножа», у «Ножа» — ссылка на тип.
function req(id, val, ref) { var r = { id: id, val: val, type: '3' }; if (ref) r.ref = ref; return r; }
var META = [
    { id: '12', val: 'Вал', reqs: [req('13', 'Раппорт, мм')] },
    { id: '296', val: 'Основа сырья', reqs: [] },
    { id: '60', val: 'Тип ножа', reqs: [
        req('63', 'Ширина этикетки, мм'), req('64', 'Длина этикетки, мм'), req('65', 'Ручьёв'), req('66', 'Этикеток на раппорте'),
        req('67', 'М/э расстояние, мм'), req('68', 'Между ручьями, мм'), req('69', 'Ширина кромки, мм'), req('70', 'Вал', '12'),
        req('76', 'Основа сырья', '296'), req('71', 'Минимальный формат, мм'), req('72', 'Оптимальный формат, мм'),
        req('73', 'Исп. формат, мм'), req('74', 'Ширина втулки, мм'), req('75', 'Угол заточки'), req('62', 'Код 1С')] },
    { id: '14', val: 'Нож', reqs: [
        req('15', 'Дата поставки'), req('55', 'Тип ножа', '60'), req('16', 'Высота ножа, мкм'),
        req('17', 'Марка ножа', '18'), req('19', 'Состояние ножа', '20'), req('21', 'Движение пробега')] },
    { id: '18', val: 'Марка ножа', reqs: [] },
    { id: '20', val: 'Состояние ножа', reqs: [] }
];

// ── 1. Резолв ───────────────────────────────────────────────────────────────────────────
var res = LP.resolveProductionTables(META, LP.PRODUCT_KIND.LABEL);
var t = res.tables;
var dieMissing = res.missing.filter(function(m) { return /^(Нож|Тип ножа)( →|$)/.test(m); });
assert(t.die && t.dieType && dieMissing.length === 0, '«Нож» и «Тип ножа» резолвятся без пропусков', dieMissing.join('; '));
assert(t.die && t.die.reqs.type === '55', 'ссылка «Тип ножа» у ножа найдена', t.die && t.die.reqs.type);
assert(t.dieType && t.dieType.reqs.streams === '65' && t.dieType.reqs.base === '76' && t.dieType.reqs.cylinder === '70',
    'параметры — колонки «Типа ножа», основа — «Основа сырья»', JSON.stringify(t.dieType && t.dieType.reqs));
assert(t.die && t.die.reqs.streams === '65' && t.die.reqs.labelWidth === '63' && t.die.reqs.cylinder === '70' && t.die.reqs.minFormat === '71',
    't.die.reqs.<параметр> ведёт на реквизит типа', JSON.stringify(t.die && t.die.reqs));
assert(t.die && t.die.reqs.state === '19' && t.die.reqs.brand === '17', 'свои поля ножа — свои реквизиты');

// ── 2. withDieTypes ─────────────────────────────────────────────────────────────────────
var dies = [
    { id: '1', val: '566340', reqs: { '55': '85 х 38 (80/3/2,5)', 'ref_55': '60:t1', '19': 'Рабочий', 'ref_19': '20:s1' } },
    { id: '2', val: '566341', reqs: { '19': 'Рабочий', 'ref_19': '20:s1' } },
    { id: '3', val: '566342', reqs: { '55': 'нет такого', 'ref_55': '60:t9' } }
];
var types = [
    { id: 't1', val: '85 х 38 (80/3/2,5)', reqs: { '63': '85', '64': '38', '65': '3', '66': '6', '70': '96', 'ref_70': '12:c96',
        '76': 'Бумага', 'ref_76': '296:b1', '71': '265', '73': '268', '74': '76' } }
];
var withTypes = typeof LP.withDieTypes === 'function' ? LP.withDieTypes(dies, t, types) : [];
var d1 = withTypes[0] || { reqs: {} }, d2 = withTypes[1] || { reqs: {} }, d3 = withTypes[2] || { reqs: {} };
assert(d1.reqs['65'] === '3' && d1.reqs['ref_70'] === '12:c96' && d1.reqs['19'] === 'Рабочий' && d1.typeId === 't1' && d1.typeName === '85 х 38 (80/3/2,5)',
    'нож с типом: параметры и ссылки типа + свои поля ножа', JSON.stringify(d1));
assert(d2.reqs['65'] === undefined && d2.typeId === '' && d3.reqs['65'] === undefined && d3.typeId === '',
    'нож без типа и с неизвестным типом — без параметров');
assert(dies[0].reqs['65'] === undefined, 'исходные записи ножей не меняются');

// ── 3. Подбор ножа и индекс ножей планирования ──────────────────────────────────────────
var LO = require('../download/atex-p2/js/label-orders.js').core;
var C = require('../download/atex-p2/js/die-planning-core.js');
C = C.core || C;
t.dieState = t.dieState || { id: '20', reqs: {} };
var built = LO.buildDies(withTypes, t, { s1: true }, { c96: 304.8 }, { '1': 100 });
var b1 = built[0] || {};
assert(b1.width === '85' && b1.length === '38' && b1.streams === '3' && b1.labelsPerRepeat === '6' && b1.base === 'Бумага' &&
    b1.cylinder === '96' && b1.repeatMm === 304.8 && b1.usedFormat === '268' && b1.sleeveWidth === '76',
    'подбор ножа видит размер, ручьи, основу, вал и формат из типа', JSON.stringify(b1));
var pick = LP.pickDie({ width: 85, length: 38, base: 'Бумага', orderStreams: 1 }, built);
assert(pick.ok && pick.die.id === '1', 'позиция 85×38 на бумаге подбирает нож через его тип', pick.reason || '');
var idx = C.buildDieIndex(withTypes, t, { s1: true }, { c96: 304.8 }, null);
assert(idx[0] && idx[0].cylinderId === 'c96' && idx[0].minFormat === 265, 'планирование высечки: вал и мин. формат ножа — из типа', JSON.stringify(idx[0]));

// ── 4. Импорт: нож без типа получает тип ────────────────────────────────────────────────
var LI = require('../download/atex-p2/js/label-import-core.js');
var IMETA = META.concat([{ id: '30', val: 'Движение пробега', reqs: [req('31', 'Обороты пробега'), req('32', 'Вид движения пробега', '33')] },
    { id: '33', val: 'Вид движения пробега', reqs: [] }]);
var ires = LI.resolveImportTables(IMETA);
var it = ires.tables;
assert(it.dieType && it.die.reqs.type === '55' && !it.die.reqs.labelWidth, 'импорт: «Тип ножа» резолвится, у ножа колонок параметров нет',
    ires.missing.join('; '));
var head = ['Номер ножа', 'Ширина этикетки', 'Длина этикетки', 'кол-во ручьев', 'м/э расстояние, мм', 'между ручьями, мм', 'угол заточки', 'Вал', 'ширина кромки, мм'];
var sheet = [head, ['700001', 85, 38, 3, 2.5, 3, 80, 96, 2]];
var parsed = LI.parseKnifeSheet(sheet, null);
var typeRec = function(id, dieCount, edge) {
    return { id: id, val: 'тип ' + id, reqs: { '63': '85', '64': '38', '65': '3', '67': '2.5', '68': '3', '75': '80°', '70': '96', 'ref_70': '12:c96', '69': edge } };
};
var dieRecs = [{ id: '501', val: '700001', reqs: {} }];
for (var i = 0; i < 3; i++) dieRecs.push({ id: String(600 + i), val: '7100' + i, reqs: { '55': 'тип 802', 'ref_55': '60:802' } });
var ctx = LI.knifeContext(it, {
    dies: dieRecs, types: [typeRec('801', 0, '2'), typeRec('802', 3, '5')], runs: [],
    cylinders: [{ id: 'c96', val: '96', reqs: {} }], bases: [], brands: [], states: [], runKinds: []
});
var plan = LI.planKnives(parsed, ctx, { now: '1790000000' });
var row = plan.rows[0] || { warnings: [], changes: [] };
var set = plan.ops.filter(function(o) { return o.op === 'set' && o.id === '501'; })[0];
assert(set && set.fields['t55'] === '802' && Object.keys(set.fields).length === 1,
    'нож без типа → ссылка на подходящий тип, у которого больше ножей; других полей нет', JSON.stringify(plan.ops));
assert(plan.ops.filter(function(o) { return o.op === 'new'; }).length === 0, 'подходящий тип есть — новый не заводится');
assert(row.status === 'update' && row.changes.some(function(c) { return c.field === 'Тип ножа' && c.to === 'тип 802'; }),
    'в предпросмотре — «Тип ножа: — → тип 802»', JSON.stringify(row.changes));
var w = row.warnings.join(' ');
assert(w.indexOf('подходит типов: 2') >= 0 && w.indexOf('«Ширина кромки, мм» 2, у типа 5') >= 0,
    'предупреждения: из двух типов выбран более частый; кромка файла расходится с типом', w);

console.log('\n' + passed + '/' + total + ' проверок пройдено.');
