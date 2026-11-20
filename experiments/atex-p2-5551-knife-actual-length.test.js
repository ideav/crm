// ideav/crm#5551 — фактическая длина этикетки ножа («Длинна этикетки _1» листа «Ножи»).
// Нож 740617: номинал 58 × 40, фактически 39,3 мм; 8 этикеток × (39,3 + 1,98) = 330,24 мм =
// раппорт вала 104 (330,2). По номиналу 8 × 41,98 = 335,8 мм — «не помещается», ложная тревога.
//   1. импорт ножей берёт фактическую длину в «Тип ножа» → «Длина этикетки факт, мм»;
//   2. проверка «этикетки на раппорте помещаются на вал» — по фактической длине (без неё — по номиналу);
//   3. у существующего типа пустая фактическая длина заполняется из файла, заполненная не меняется;
//   4. длина рулона на упаковке — по фактической длине.
// Run with: node experiments/atex-p2-5551-knife-actual-length.test.js
var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}
var LI = require('../download/atex-p2/js/label-import-core.js');
var P = require('../download/atex-p2/js/label-packer-core.js').core;

var HEAD = ['Дата поставки', 'Номер ножа', 'Размер этикетки', 'Ширина этикетки', 'Длинна этикетки ', 'Нож',
    'ширина, мм', 'Длинна этикетки _1', 'кол-во ручев', 'этикеток на раппорте', 'м/э расстояние, мм', 'между ручьями, мм',
    'ширина кромки, мм', 'Вал', 'раппорт', 'высота ножа, мкм', 'угол заточки', 'сырье ', 'Доп', 'Состояние ножа (В работе, списан, резерв)'];
function row(no, actual) {
    return [46223, no, '58 х 40', 58, 40, '58 х 39,3', 58, actual, 5, 8, 1.98, 3, 1.5, 104, 330.2, 445, 80, 'Бумага', 'нет', 'Рабочий'];
}
var fitWarn = function(item) { return item.warnings.filter(function(w) { return /помещ/.test(w); }); };

// 1, 2. Разбор листа
var parsed = LI.parseKnifeSheet([HEAD, row('740617', 39.3), row('740618', '')]);
var k = parsed.items[0], nom = parsed.items[1];
assert(k && k.values.actualLength === 39.3, 'фактическая длина 39,3 взята из «Длинна этикетки _1»', JSON.stringify(k && k.values));
assert(k && k.values.labelLength === 40, 'номинальная длина остаётся 40 (по ней тип ножа и подбор к заказу)');
assert(k && fitWarn(k).length === 0, '8 × (39,3 + 1,98) = 330,24 мм на раппорте 330,2 — помещается, предупреждения нет', JSON.stringify(k && k.warnings));
assert(nom && !('actualLength' in nom.values), 'пустая фактическая длина не заполняется');
assert(nom && fitWarn(nom).length === 1 && /335,8|335\.8/.test(fitWarn(nom)[0]), 'без фактической длины — проверка по номиналу: 335,8 мм не помещаются на 330,2', JSON.stringify(nom && nom.warnings));

// 3. Существующий тип: пустая фактическая длина заполняется, заполненная — нет
function table(id, name, reqs) {
    return { id: String(id), val: name, reqs: reqs.map(function(r, i) {
        var ref = Array.isArray(r);
        return { id: String(id + i + 1), val: ref ? r[0] : r, type: '3', ref: ref ? String(r[1]) : undefined, field_attrs: { alias: null } };
    }) };
}
var meta = [
    table(100, 'Нож', ['Дата поставки', ['Тип ножа', 200], 'Высота ножа, мкм', ['Состояние ножа', 700], ['Марка ножа', 600]]),
    table(200, 'Тип ножа', ['Ширина этикетки, мм', 'Длина этикетки, мм', 'Ручьёв', 'Ручьев / (этикеток) на раппорте', 'М/э расстояние, мм',
        'Между ручьями, мм', 'Ширина кромки, мм', ['Вал', 400], ['Основа сырья', 500], 'Минимальный формат, мм', 'Оптимальный формат, мм',
        'Исп. формат, мм', 'Ширина втулки, мм', 'Угол заточки', 'Длина этикетки факт, мм']),
    table(300, 'Движение пробега', ['Обороты пробега', ['Вид движения пробега', 800]]),
    table(400, 'Вал', ['Раппорт, мм']), table(500, 'Основа сырья', []), table(600, 'Марка ножа', []),
    table(700, 'Состояние ножа', []), table(800, 'Вид движения пробега', [])
];
var tables = LI.resolveImportTables(meta).tables;
assert(!!tables.dieType.reqs.actualLength, 'колонка «Длина этикетки факт, мм» «Типа ножа» находится по имени');
var T = tables.dieType.reqs, ACT = T.actualLength;
function ctxWith(actual) {
    var typeReqs = {};
    typeReqs[T.labelWidth] = '58'; typeReqs[T.labelLength] = '40'; typeReqs[T.streams] = '5'; typeReqs[T.labelsPerRepeat] = '8';
    typeReqs[T.labelGap] = '1.98'; typeReqs[T.streamGap] = '3'; typeReqs[T.angle] = '80°'; typeReqs[T.edge] = '1.5';
    typeReqs['ref_' + T.base] = '500:51';
    typeReqs['ref_' + T.cylinder] = '400:41';
    if (actual) typeReqs[ACT] = actual;
    var dieReqs = {}; dieReqs['ref_' + tables.die.reqs.type] = '200:21';
    dieReqs[tables.die.reqs.delivered] = '20.07.2026'; dieReqs[tables.die.reqs.height] = '445';
    return LI.knifeContext(tables, {
        dies: [{ id: '11', up: '1', val: '740617', reqs: dieReqs }],
        types: [{ id: '21', up: '1', val: '58 х 40 (80)', reqs: typeReqs }],
        cylinders: [{ id: '41', up: '1', val: '104', reqs: {} }], bases: [{ id: '51', up: '1', val: 'Бумага', reqs: {} }],
        brands: [], states: [{ id: '71', up: '1', val: 'Рабочий', reqs: {} }], runKinds: [], runs: []
    });
}
var one = { items: [k], duplicates: [] };
var plan = LI.planKnives(one, ctxWith(''), { now: 1790000000 });
var typeSet = plan.ops.filter(function(o) { return o.op === 'set' && o.id === '21'; })[0];
assert(typeSet && typeSet.fields['t' + ACT] === '39.3', 'у типа без фактической длины она заполняется из файла (39,3)', JSON.stringify(plan.ops));
assert(plan.rows[0].status === 'update' && plan.rows[0].changes.some(function(c) { return /факт/.test(c.field) && c.to === '39.3'; }),
    'предпросмотр показывает заполнение как изменение строки', JSON.stringify(plan.rows[0]));
var plan2 = LI.planKnives(one, ctxWith('39.3'), { now: 1790000000 });
assert(plan2.ops.length === 0 && plan2.rows[0].status === 'same', 'повторный импорт: тип уже заполнен — записывать нечего', JSON.stringify(plan2.ops));
var plan3 = LI.planKnives(one, ctxWith('40'), { now: 1790000000 });
assert(plan3.ops.length === 0 && plan3.rows[0].warnings.some(function(w) { return /факт/.test(w); }),
    'заполненная у типа фактическая длина не перезаписывается — расхождение только предупреждение', JSON.stringify(plan3.rows[0].warnings));

// 4. Упаковка: длина рулона по фактической длине
var nominal = P.rollParams({ labelLength: 40, dieGap: 1.98, perRoll: 5000, sleeveWidth: 61, sleeve: 'Втулка (76мм/5мм/1000мм)', thickness: 150 });
var actual = P.rollParams({ labelLength: 40, actualLength: 39.3, dieGap: 1.98, perRoll: 5000, sleeveWidth: 61, sleeve: 'Втулка (76мм/5мм/1000мм)', thickness: 150 });
assert(Math.abs(actual.lengthM - 206.4) < 1e-6, 'рулон 5000 этикеток × (39,3 + 1,98) = 206,4 м', String(actual.lengthM));
assert(Math.abs(nominal.lengthM - 209.9) < 1e-6, 'без фактической длины — по номиналу: 209,9 м', String(nominal.lengthM));
var row1 = P.itemFromReportRow({ label_length: '40', die_actual_length: '39.3', die_gap: '1.98', labels_per_roll: '5000' });
assert(row1.actualLength === 39.3, 'строка отчёта label_packer несёт фактическую длину ножа (die_actual_length)', JSON.stringify(row1));

console.log(passed + '/' + total);
