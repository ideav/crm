// ideav/crm#5551 — расчёт мастер-рулонов позиции: дробное расчётное МР, допуск ±10% к числу МР из комментария 1С.
//   M1  потребность позиции хранит и дробное (2 знака), и целое (вверх) число МР — заказы 6514 / 6547 из тикета;
//   M2  число МР из комментария 1С («0,300 х 2000 (П) - 41 шт») разбирается, размер этикетки в номенклатуре — нет;
//   M3  сверка с расчётом: в допуске ±10% или целое «вверх» — молчит; вне допуска — «расчёт МР сделан неверно»;
//   M4  mrContext читает тип ножа по названию, раппорт вала и длину МР из настройки;
//   M5  «Мастер-рулонов расчётное» пишется в позицию при подборе ножа.
// Фикстуры обезличены. Run with: node experiments/atex-p2-5551-mr-calc.test.js

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

var LP = require('../download/atex/js/label-production.js').core;
var LI = require('../download/atex-p2/js/label-import-core.js');
var LO = require('../download/atex-p2/js/label-orders.js').core;

// M1: заказ 6514 — 1000 рул × 5000, нож 5 ручьёв × 8 на раппорте, вал 104 (330,2 мм); 6547 — 528 × 3000, 5 × 4, вал 96 (304,8 мм)
var d1 = LP.labelPositionDemand({ rolls: 1000, labelsPerRoll: 5000, width: 58 }, { repeatMm: 330.2, labelsPerRepeat: 8, streams: 5, usedFormat: 310 }, 2000);
assert(d1.ok && d1.repeats === 125000 && d1.meters === 41275 && d1.masterRollsExact === 20.64 && d1.masterRolls === 21,
    'M1: 6514 — расчётное 20,64, целых 21', JSON.stringify(d1));
var d2 = LP.labelPositionDemand({ rolls: 528, labelsPerRoll: 3000, width: 58 }, { repeatMm: 304.8, labelsPerRepeat: 4, streams: 5, usedFormat: 310 }, 2000);
assert(d2.ok && d2.repeats === 79200 && d2.meters === 24140.16 && d2.masterRollsExact === 12.07 && d2.masterRolls === 13 && d2.useRatio === 0.935,
    'M1: 6547 — 79 200 раппортов, 24 140 м, расчётное 12,07, целых 13, коэф. 0,935', JSON.stringify(d2));

// M2
assert(JSON.stringify(LI.mrCountFromComment('MONOCHROME 0043 SG/HM/YG 0,300 х 2000 (П) - 41 шт')) === '[41]', 'M2: «- 41 шт» → 41');
assert(JSON.stringify(LI.mrCountFromComment('MONOCHROME 0043 TE/HM/YG 0,308 х 2000 (П) 7 шт, MONOCHROME 0044 TE/HM/YG 0,258 х 2000 - 2шт')) === '[7,2]', 'M2: две марки → [7, 2]');
assert(LI.mrCountFromComment('58 х 40 1500 шт. ЭКО каучук вт 40').length === 0 && LI.mrCountFromComment('').length === 0, 'M2: размер этикетки и пустой комментарий — не МР');

// M3
var mr = { mrLength: 2000, types: { '58 х 40 (80)': { streams: 5, perRepeat: 8, repeatMm: 330.2 } } };
function item(comment, rolls) {
    return { knifeType: '58 х 40 (80)', rolls: rolls == null ? 1000 : rolls, label: { perRoll: 5000 }, comment: comment };
}
var r = LI.checkMasterRolls(item('MONOCHROME 0043 SG/HM/YG 0,319 х 2000 (П) - 21 шт'), mr);
assert(r.calc === 20.64 && r.file === 21 && r.warning === '', 'M3: 21 при расчёте 20,64 — без предупреждения', JSON.stringify(r));
r = LI.checkMasterRolls(item('MONOCHROME 0043 SG/HM/YG 0,319 х 2000 (П) - 22 шт'), mr);
assert(r.warning === '', 'M3: 22 в допуске +10% (до 22,70)', JSON.stringify(r));
r = LI.checkMasterRolls(item('MONOCHROME 0043 SG/HM/YG 0,319 х 2000 (П) - 30 шт'), mr);
assert(/расчёт МР сделан неверно/.test(r.warning) && /30 МР/.test(r.warning) && /20.64/.test(r.warning), 'M3: 30 при расчёте 20,64 — предупреждение', r.warning);
r = LI.checkMasterRolls(item('MONOCHROME 0043 SG/HM/YG 0,319 х 2000 (П) - 15 шт'), mr);
assert(/неверно/.test(r.warning), 'M3: 15 — ниже допуска', r.warning);
r = LI.checkMasterRolls(item('MONOCHROME 0043 SG/HM/YG 0,319 х 2000 (П) - 1 шт', 10), mr);
assert(r.calc === 0.21 && r.warning === '', 'M3: расчёт 0,21 — один МР (целое вверх) не ошибка', JSON.stringify(r));
r = LI.checkMasterRolls(item(''), mr);
assert(r.calc === 20.64 && r.file === null && r.warning === '', 'M3: в комментарии МР нет — расчёт есть, предупреждения нет');
r = LI.checkMasterRolls({ knifeType: '99 х 99 (80)', rolls: 5, label: { perRoll: 100 }, comment: '0,3 х 2000 - 9 шт' }, mr);
assert(r.calc === null && r.warning === '', 'M3: тип ножей не найден в базе — не сверяем');

// M4
var tables = LI.resolveImportTables([
    { id: '10', val: 'Тип ножа', reqs: [
        { id: '11', val: 'Ручьёв' }, { id: '12', val: 'Ручьев / (этикеток) на раппорте' }, { id: '13', val: 'Вал', ref: '30' }] },
    { id: '30', val: 'Вал', reqs: [{ id: '31', val: 'Раппорт, мм' }] },
    { id: '40', val: 'Настройка', reqs: [{ id: '41', val: 'Тип' }, { id: '42', val: 'Значение' }] }
]).tables;
assert(tables.dieType && tables.dieType.reqs.labelsPerRepeat === '12', 'M4: колонка «Ручьев / (этикеток) на раппорте» найдена');
var legacy = LI.resolveImportTables([{ id: '10', val: 'Тип ножа', reqs: [{ id: '12', val: 'Этикеток на раппорте' }] }]).tables;
assert(legacy.dieType.reqs.labelsPerRepeat === '12', 'M4: прежнее имя колонки тоже находится');
var ctx = LI.mrContext(tables, {
    dieTypes: [{ id: '5', up: '1', val: '58 х 40 (80)', reqs: { '11': '5', '12': '8', '13': '104', 'ref_13': '30:77' } }],
    cylinders: [{ id: '77', up: '1', val: '104', reqs: { '31': '330.2' } }],
    settings: [{ id: '9', up: '1', val: 'LABEL_MASTER_ROLL_M', reqs: { '41': 'ATEH', '42': '2500' } }], db: 'ateh1'
});
var t = ctx.types['58 х 40 (80)'];
assert(t && t.streams === 5 && t.perRepeat === 8 && t.repeatMm === 330.2 && ctx.mrLength === 2500, 'M4: тип ножа, раппорт вала, длина МР из настройки', JSON.stringify(ctx));

// M5
var dies = [{ id: '1', no: '740617', width: 58, length: 40, base: 'Бумага', streams: 5, labelsPerRepeat: 8, repeatMm: 330.2, usedFormat: 310, selectable: true, revs: 0 }];
var pos = LO.positionFromRow({ 'РулоновID': '1', 'Рулонов': '1000', 'Шт в рулоне': '5000', 'Ширина, мм': '58', 'Длина, мм': '40', 'Тип ножей': '58 х 40 (80)', 'СырьёID': 'm', 'МР расчётное': '' },
    { m: { base: 'Бумага' } });
var plan = LO.planPosition(pos, dies, { mrLength: '2000' });
assert(plan.write.mrCalc === '20.64', 'M5: в позицию пишется расчётное МР 20.64', JSON.stringify(plan.write));
assert(LO.writeDiffers(Object.assign({}, pos, { mrCalc: '20.64', dieId: '1', pick: plan.die.pick, minBatch: plan.write.minBatch }), plan.write) === false, 'M5: записанное совпадает — повторно не пишем');

console.log('\n' + passed + '/' + total + ' проверок пройдено.');
