// Unit tests for the «Движение сырья» calc core (ideav/crm#4655, исходно #2914).
// Проверяют правила из docs/atex_workplaces.md §3.4:
//   • мера объекта: риббон — м² (взаимно с метрами по «Номинальной ширине»),
//     втулка с «Шириной втулки, мм» — штуки, без ширины — метры;
//   • карточка остатка одна на пару (объект, склад);
//   • приход / перемещение / списание считаются ОДНОЙ функцией planMovement,
//     ею же рисуется предпросмотр «было → стало»;
//   • списание требует причину и не уводит остаток в минус.
//
// Run with: node experiments/atex-intake.test.js

var intake = require('../download/atex/js/intake.js');
var calc = intake.calc;
var helpers = intake.helpers;

var passed = 0;
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) {
        passed++;
    } else {
        console.log('  expected:', JSON.stringify(expected));
        console.log('  actual:  ', JSON.stringify(actual));
        process.exitCode = 1;
    }
}

// ── Объекты передачи ──
var RIBBON = { kind: 'ribbon', id: '1237', label: 'MWR118', nominalWidth: 910 };
var RIBBON_NO_WIDTH = { kind: 'ribbon', id: '2036', label: 'MA', nominalWidth: 0 };
var SLEEVE_PCS = { kind: 'sleeve', id: '35561', label: 'Втулка 0.5" 110 мм', sleeveWidth: 110 };
var SLEEVE_M = { kind: 'sleeve', id: '8190', label: 'Втулка картонная 1"', sleeveWidth: 0 };

// ── toNumber: терпимый разбор ──
assertEqual(calc.toNumber('1250'), 1250, 'toNumber parses integer string');
assertEqual(calc.toNumber('1250,5'), 1250.5, 'toNumber accepts comma decimal');
assertEqual(calc.toNumber(' 1 200 '), 1200, 'toNumber strips spaces');
assertEqual(calc.toNumber(''), 0, 'toNumber empty → 0');
assertEqual(calc.toNumber('abc'), 0, 'toNumber garbage → 0');

// ── Пересчёт риббона по номинальной ширине (та же арифметика, что в slitter.js) ──
assertEqual(calc.areaFromMeters(1000, 910), 910, 'areaFromMeters: 1000 м × 910 мм → 910 м²');
assertEqual(calc.metersFromArea(910, 910), 1000, 'metersFromArea: 910 м² ÷ 910 мм → 1000 м');
assertEqual(calc.metersFromArea(910, 0), 0, 'ширина не задана → пересчёт невозможен (0)');
assertEqual(calc.areaFromMeters(1000, 0), 0, 'ширина не задана → площадь из метров не считается');

// ── Мера объекта определяется самим объектом ──
assertEqual(calc.unitOfItem(RIBBON), 'm2', 'риббон меряется в м²');
assertEqual(calc.unitOfItem(SLEEVE_PCS), 'pcs', 'втулка с «Шириной втулки, мм» — штуки');
assertEqual(calc.unitOfItem(SLEEVE_M), 'm', 'втулка без ширины — метраж');
assertEqual(calc.unitLabel(calc.unitOfItem(SLEEVE_PCS)), 'шт', 'подпись меры втулки — шт');

// ── Остаток карточки читается из «своего» реквизита ──
assertEqual(calc.cardQuantity({ kind: 'ribbon', remainder: '11254,096', qty: '' }, RIBBON), 11254.096,
    'риббон: остаток из «Остаток, м²»');
assertEqual(calc.cardQuantity({ kind: 'sleeve', remainder: '824', qty: '600' }, SLEEVE_PCS), 600,
    'втулка: остаток из «Кол-во», а не из «Остаток, м²»');
assertEqual(calc.needsQtyMigration({ kind: 'sleeve', remainder: '824', qty: '' }), true,
    'втулка с количеством в «Остаток, м²» и пустым «Кол-во» — данные не перенесены');
assertEqual(calc.needsQtyMigration({ kind: 'sleeve', remainder: '', remainderM: '1000000', qty: '' }), true,
    'старая заглушка втулки с запасом в «Остаток, м» тоже ждёт переноса, а не показывается нулём');
assertEqual(calc.needsQtyMigration({ kind: 'sleeve', remainder: '824', qty: '600' }), false,
    'перенесённая карточка втулки помечена не должна быть');
assertEqual(calc.needsQtyMigration({ kind: 'ribbon', remainder: '824', qty: '' }), false,
    'риббон «Кол-во» не использует — переноса не требует');

// ── Карточка остатка одна на пару (объект, склад) ──
var CARDS = [
    { id: 'c1', kind: 'ribbon', itemId: '1237', itemLabel: 'MWR118', warehouseId: 'w1', warehouseLabel: 'Производство', remainder: '1000', qty: '' },
    { id: 'c2', kind: 'ribbon', itemId: '1237', itemLabel: 'MWR118', warehouseId: 'w2', warehouseLabel: 'Атех', remainder: '400', qty: '' },
    { id: 'c3', kind: 'sleeve', itemId: '35561', itemLabel: 'Втулка 0.5" 110 мм', warehouseId: 'w2', warehouseLabel: 'Атех', remainder: '', qty: '20000', sleeveWidth: 110 }
];
assertEqual(calc.findCard(CARDS, RIBBON, 'w2').id, 'c2', 'findCard берёт карточку своей пары (объект, склад)');
assertEqual(calc.findCard(CARDS, RIBBON, 'w9'), null, 'на чужом складе карточки нет');
assertEqual(calc.findCard(CARDS, { kind: 'sleeve', id: '1237' }, 'w2'), null,
    'втулка и риббон с одинаковым id не путаются');

// ── Приход ──
var incoming = calc.planMovement({
    op: 'in', item: RIBBON, quantity: '500',
    toWarehouseId: 'w2', toWarehouseLabel: 'Атех',
    toCard: calc.findCard(CARDS, RIBBON, 'w2'),
    user: 'operator', at: 1781384400
});
assertEqual(incoming.errors, [], 'приход на существующую карточку проходит без ошибок');
assertEqual(incoming.steps, [{ role: 'to', cardId: 'c2', warehouseId: 'w2', was: 400, now: 900 }],
    'приход прибавляет к остатку склада-приёмника');
assertEqual(incoming.journal.operation, 'Приход', 'журнал называет операцию');
assertEqual([incoming.journal.was, incoming.journal.became], [400, 900],
    'журнал прихода фиксирует было/стало склада-приёмника');
assertEqual([incoming.journal.fromWarehouseLabel, incoming.journal.toWarehouseLabel], ['', 'Атех'],
    'у прихода источника нет, приёмник — текстом');

var firstTime = calc.planMovement({
    op: 'in', item: SLEEVE_M, quantity: '208',
    toWarehouseId: 'w1', toWarehouseLabel: 'Производство', toCard: null,
    at: 1781384400
});
assertEqual(firstTime.steps, [{ role: 'to', cardId: null, warehouseId: 'w1', was: 0, now: 208 }],
    'приход на склад без карточки заводит новую (cardId = null)');
assertEqual(firstTime.journal.unit, 'm', 'метражная втулка приходуется метрами');

// ── Перемещение ──
var move = calc.planMovement({
    op: 'move', item: RIBBON, quantity: '250',
    fromWarehouseId: 'w1', fromWarehouseLabel: 'Производство',
    toWarehouseId: 'w2', toWarehouseLabel: 'Атех',
    fromCard: calc.findCard(CARDS, RIBBON, 'w1'),
    toCard: calc.findCard(CARDS, RIBBON, 'w2'),
    at: 1781384400
});
assertEqual(move.steps, [
    { role: 'from', cardId: 'c1', warehouseId: 'w1', was: 1000, now: 750 },
    { role: 'to', cardId: 'c2', warehouseId: 'w2', was: 400, now: 650 }
], 'перемещение снимает со склада-источника и кладёт на склад-приёмник');
assertEqual(move.steps[0].was - move.steps[0].now, move.steps[1].now - move.steps[1].was,
    'перемещение сохраняет количество: сколько ушло, столько и пришло');
assertEqual(calc.planMovement({
    op: 'move', item: RIBBON, quantity: '10',
    fromWarehouseId: 'w1', toWarehouseId: 'w1',
    fromCard: calc.findCard(CARDS, RIBBON, 'w1')
}).errors, ['Склад-источник и склад-приёмник совпадают'],
    'перемещение «на тот же склад» отклоняется');

// ── Списание ──
var writeOff = calc.planMovement({
    op: 'out', item: SLEEVE_PCS, quantity: '500',
    fromWarehouseId: 'w2', fromWarehouseLabel: 'Атех',
    fromCard: calc.findCard(CARDS, SLEEVE_PCS, 'w2'),
    reason: 'Брак', note: 'мятые торцы', user: 'operator', at: 1781384400
});
assertEqual(writeOff.steps, [{ role: 'from', cardId: 'c3', warehouseId: 'w2', was: 20000, now: 19500 }],
    'списание уменьшает остаток склада');
assertEqual([writeOff.journal.reason, writeOff.journal.note, writeOff.journal.unit],
    ['Брак', 'мятые торцы', 'pcs'], 'журнал списания несёт причину, комментарий и меру');

assertEqual(calc.planMovement({
    op: 'out', item: SLEEVE_PCS, quantity: '500',
    fromWarehouseId: 'w2', fromWarehouseLabel: 'Атех',
    fromCard: calc.findCard(CARDS, SLEEVE_PCS, 'w2')
}).errors, ['Укажите причину списания'], 'списание без причины не проводится');

assertEqual(calc.planMovement({
    op: 'out', item: RIBBON, quantity: '1500',
    fromWarehouseId: 'w2', fromWarehouseLabel: 'Атех',
    fromCard: calc.findCard(CARDS, RIBBON, 'w2'), reason: 'Отгрузка вовне'
}).errors, ['На складе «Атех» всего 400 м² — списать больше нельзя'],
    'списать больше, чем лежит на складе, нельзя');

assertEqual(calc.planMovement({
    op: 'out', item: RIBBON, quantity: '10',
    fromWarehouseId: 'w9', fromWarehouseLabel: 'Ангар', fromCard: null, reason: 'Брак'
}).errors, ['На складе «Ангар» этого сырья нет'], 'списание с пустого склада отклоняется');

assertEqual(calc.planMovement({
    op: 'out', item: SLEEVE_PCS, quantity: '10',
    fromWarehouseId: 'w2', fromWarehouseLabel: 'Атех', reason: 'Брак',
    fromCard: { id: 'c4', kind: 'sleeve', remainder: '824', qty: '' }
}).errors, ['У карточки на складе «Атех» количество ещё не перенесено в «Кол-во»'],
    'неперенесённая карточка втулки блокирует операцию, а не считается нулём');

// Ошибки собираются все сразу — форма показывает их одним списком.
assertEqual(calc.planMovement({ op: 'out', item: null, quantity: '' }).errors,
    ['Выберите объект передачи', 'Укажите количество больше нуля', 'Выберите склад списания', 'Укажите причину списания'],
    'ошибки формы собираются в один список');

// ── Подписи чисел ──
// Разделитель тысяч — неразрывный пробел (#4662): число не разрывается по
// строкам и не слипается с соседним числом в сводке.
var NBSP = '\u00A0';
assertEqual(calc.formatQty(10770185.043), '10' + NBSP + '770' + NBSP + '185,043',
    'formatQty по умолчанию оставляет до трёх знаков и разделяет разряды');
assertEqual(calc.formatQty(10770185.043, 0), '10' + NBSP + '770' + NBSP + '185',
    'сводка складских итогов округляется до целых');
assertEqual(calc.formatQty(4015929.719, 0), '4' + NBSP + '015' + NBSP + '930',
    'округление итога — арифметическое, а не отбрасывание хвоста');
assertEqual(calc.formatQty(0.4, 0), '0', 'меньше половины единицы → 0, а не пусто');
assertEqual(calc.toNumber(calc.formatQty(10770185, 0)), 10770185,
    'отформатированное число разбирается обратно вместе с неразрывными пробелами');

// ── Сводка и фильтры списка остатков ──
assertEqual(calc.summarize(CARDS), { count: 3, totalM2: 1400, totalPcs: 20000, totalM: 0 },
    'сводка складывает каждую меру отдельно');
assertEqual(calc.filterCards(CARDS, { kind: 'sleeve' }).map(function(c) { return c.id; }), ['c3'],
    'фильтр по типу сырья');
assertEqual(calc.filterCards(CARDS, { warehouseId: 'w2' }).map(function(c) { return c.id; }), ['c2', 'c3'],
    'фильтр по складу');
assertEqual(calc.filterCards(CARDS, { text: 'mwr' }).map(function(c) { return c.id; }), ['c1', 'c2'],
    'поиск по названию объекта');

// ── Метаданные: чтение и запись полей ──
var cardMeta = {
    id: '1074',
    val: 'Партия сырья',
    reqs: [
        { id: '1117', val: 'Вид сырья', ref: '1069' },
        { id: '1121', val: 'Получено, м²' },
        { id: '1123', val: 'Остаток, м²' },
        { id: '8454', val: 'Длина, м' },
        { id: '8456', val: 'Остаток, м' },
        { id: '8667', val: 'Штрих-код' },
        { id: '16427', val: 'В работе' },
        { id: '35551', val: 'Склад', ref: '35549' },
        { id: '52653', val: 'Диаметр втулки', ref: '8188' },
        { id: '77404', val: 'Примечание' },
        { id: '104592', val: 'Ед.изм.', ref: '104590' },
        { id: '670848', val: 'Кол-во' }
    ]
};

assertEqual(helpers.reqIdByName(cardMeta, 'кол-во'), '670848', 'реквизит находится по имени без учёта регистра');
assertEqual(helpers.columnIndex(cardMeta, 'Кол-во'), 12, 'колонка «Кол-во» — последняя в JSON_OBJ');

assertEqual(helpers.mapCardRecord({
    i: 104736,
    r: ['1781384400', '', '', '', '', '', '', 'X', '35554:Атех', '35561:Втулка 0.5" 110 мм', '', '104616:шт', '20000']
}, cardMeta), {
    id: '104736', at: '1781384400', kind: 'sleeve',
    itemId: '35561', itemLabel: 'Втулка 0.5" 110 мм',
    warehouseId: '35554', warehouseLabel: 'Атех',
    remainder: '', remainderM: '', qty: '20000',
    unitId: '104616', unitLabel: 'шт',
    barcode: '', active: 'X', note: ''
}, 'mapCardRecord читает карточку втулки: объект — «Диаметр втулки», количество — «Кол-во»');

assertEqual(helpers.mapCardRecord({
    i: 77190,
    r: ['1781384400', '1237:MWR118', '', '36081.50', '', '', '', 'X', '35554:Атех', '', '', '', '']
}, cardMeta).kind, 'ribbon', 'карточка с «Видом сырья» — риббон');

// Мультизначение ссылки («104616,104617:шт,м2» у партии 77194) сводится к первому id.
assertEqual(helpers.parseRef('104616,104617:шт,м2'), { id: '104616', label: 'шт,м2' },
    'мультизначение ссылки не ломает разбор');

// Остаток риббона пишется в ОБА реквизита: «Остаток, м²» и досчитанный «Остаток, м».
assertEqual(helpers.cardQuantityFields(cardMeta, RIBBON, 910), { t1123: 910, t8456: 1000 },
    'риббон: пишем м² и досчитанные метры');
assertEqual(helpers.cardQuantityFields(cardMeta, RIBBON_NO_WIDTH, 910), { t1123: 910 },
    'нет «Номинальной ширины» — метровый остаток не трогаем');
assertEqual(helpers.cardQuantityFields(cardMeta, SLEEVE_PCS, 19500), { t670848: 19500 },
    'втулка: количество идёт в «Кол-во»');

assertEqual(helpers.buildCardCreateParams(cardMeta, SLEEVE_M, '35552', 208, '104619', 1781384400), {
    t670848: 208,
    t52653: '8190',
    t35551: '35552',
    t104592: '104619',
    t16427: 'X',
    t1074: '1781384400'
}, 'новая карточка втулки: объект, склад, «Кол-во», единица, «В работе» и штамп даты');

// ── Журнал ──
var journalMeta = {
    id: '670849',
    val: 'Движение сырья',
    reqs: [
        { id: '670851', val: 'Движение сырья.Операция', attrs: '{"alias":"Операция"}' },
        { id: '670852', val: 'Вид сырья', ref: '1069' },
        { id: '670853', val: 'Диаметр втулки', ref: '8188' },
        { id: '670855', val: 'Движение сырья.Со склада', attrs: '{"alias":"Со склада"}' },
        { id: '670857', val: 'Движение сырья.На склад', attrs: '{"alias":"На склад"}' },
        { id: '670859', val: 'Движение сырья.Кол-во', attrs: '{"alias":"Кол-во"}' },
        { id: '670860', val: 'Ед.изм.', ref: '104590' },
        { id: '670862', val: 'Движение сырья.Было', attrs: '{"alias":"Было"}' },
        { id: '670864', val: 'Движение сырья.Стало', attrs: '{"alias":"Стало"}' },
        { id: '670866', val: 'Движение сырья.Причина', attrs: '{"alias":"Причина"}' },
        { id: '670868', val: 'Движение сырья.Примечание', attrs: '{"alias":"Примечание"}' },
        { id: '670870', val: 'Движение сырья.Пользователь', attrs: '{"alias":"Пользователь"}' }
    ]
};

assertEqual(helpers.reqIdByName(journalMeta, 'Операция'), '670851',
    'реквизит журнала ищется по псевдониму колонки, а не только по имени типа');

var journal = move.journal;
journal.unitRefId = '104617';
journal.user = 'operator';
assertEqual(helpers.buildJournalFields(journalMeta, journal), {
    t670849: '1781384400',
    t670851: 'Перемещение',
    t670852: '1237',
    t670855: 'Производство',
    t670857: 'Атех',
    t670859: 250,
    t670860: '104617',
    t670862: 1000,
    t670864: 750,
    t670870: 'operator'
}, 'запись журнала: когда, что, откуда, куда, сколько, было/стало, кто');

assertEqual(helpers.mapJournalRecord({
    i: 700001,
    r: ['1781384400', 'Списание', '', '35561:Втулка 0.5" 110 мм', 'Атех', '', '500', '104616:шт', '20000', '19500', 'Брак', 'мятые торцы', 'operator']
}, journalMeta), {
    id: '700001', at: '1781384400', operation: 'Списание',
    itemLabel: 'Втулка 0.5" 110 мм', fromLabel: 'Атех', toLabel: '',
    quantity: '500', unitLabel: 'шт', was: '20000', became: '19500',
    reason: 'Брак', note: 'мятые торцы', user: 'operator'
}, 'лента журнала читается обратно');

console.log('\n' + passed + ' assertions passed');
