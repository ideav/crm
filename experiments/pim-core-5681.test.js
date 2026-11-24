// rules: none (defect #5681)
// PIM (демо-копия, ideav/crm#5681, backlogram#989): расчёт полноты карточки по площадкам, соответствия значений, импорт, массовое заполнение, выгрузка.
const test = require('node:test');
const assert = require('node:assert');
const C = require('../download/pim/js/pim-core.js');

const ATTRS = {
    'Название': { name: 'Название', type: 'text', field: 'name' }, 'Бренд': { name: 'Бренд', type: 'text', field: 'brand' },
    'Страна производства': { name: 'Страна производства', type: 'text', field: 'country' }, 'Штрихкод': { name: 'Штрихкод', type: 'text', field: 'barcode' },
    'Цвет': { name: 'Цвет', type: 'list', values: ['Белый', 'Чёрный', 'Беж'] }, 'Объём, л': { name: 'Объём, л', type: 'number' },
};
const OZ = { name: 'Ozon', minPhotos: 3 }, WB = { name: 'Wildberries', minPhotos: 1 };
const CA = [
    { key: 'oz-n', channel: 'Ozon', category: 'Посуда', title: 'Название', ours: 'Название', required: true, limit: 20, values: [], order: 1 },
    { key: 'oz-c', channel: 'Ozon', category: 'Посуда', title: 'Страна-изготовитель', ours: 'Страна производства', required: true, values: [], order: 2 },
    { key: 'oz-col', channel: 'Ozon', category: 'Посуда', title: 'Цвет товара', ours: 'Цвет', required: true, values: ['белый', 'чёрный'], order: 3 },
    { key: 'oz-v', channel: 'Ozon', category: 'Посуда', title: 'Объём, л', ours: 'Объём, л', required: false, values: [], order: 4 },
    { key: 'wb-n', channel: 'Wildberries', category: 'Посуда', title: 'Наименование', ours: 'Название', required: true, limit: 10, values: [], order: 1 },
    { key: 'wb-b', channel: 'Wildberries', category: 'Посуда', title: 'Баркод', ours: 'Штрихкод', required: true, values: [], order: 2 },
];
const M = { attrs: ATTRS, valueMap: { 'oz-col': { 'чёрный матовый': 'чёрный' } } };
const card = (o) => Object.assign({ id: '1', sku: 'А-1', category: 'Посуда', name: 'Кастрюля Кухар', brand: 'Кухар', country: 'Китай', barcode: '4600000000015', photos: 3, status: 'Черновик', values: { 'Цвет': 'Белый' } }, o);

test('EAN-13: контрольная цифра и «съеденный» Excel код', () => {
    assert.strictEqual(C.eanValid('4006381333931'), true);
    assert.strictEqual(C.eanValid('4006381333932'), false);
    assert.match(C.eanProblem('4.60E+12'), /Excel/);
    assert.match(C.eanProblem('46000000000'), /длина 11/);
    assert.strictEqual(C.eanProblem('4006381333931'), '');
});

test('полнота: заполненная карточка даёт 100%, пустая страна и короткий лимит - красные пункты', () => {
    const ok = C.checkChannel(card({ name: 'Кастрюля Кухар' }), OZ, CA, M);
    assert.strictEqual(ok.pct, 100); assert.strictEqual(ok.blockers.length, 0);
    const bad = C.checkChannel(card({ name: 'Кастрюля эмалированная Кухар 3 л', country: '' }), OZ, CA, M);
    assert.strictEqual(bad.required, 4);                       // название, страна, цвет, фото
    assert.strictEqual(bad.pct, 50);
    assert.deepStrictEqual(bad.blockers.map(b => b.state).sort(), ['long', 'missing']);
    assert.match(bad.blockers.find(b => b.state === 'long').msg, /32 симв\. при лимите 20/);
});

test('необязательные атрибуты не снижают процент, но видны в списке', () => {
    const r = C.checkChannel(card(), OZ, CA, M);
    const opt = r.items.find(i => i.key === 'oz-v');
    assert.strictEqual(opt.required, false); assert.strictEqual(opt.state, 'missing');
    assert.strictEqual(r.pct, 100);
});

test('значение справочника: совпадение без регистра, таблица соответствий, иначе ошибка', () => {
    assert.strictEqual(C.checkChannel(card({ values: { 'Цвет': 'Белый' } }), OZ, CA, M).items.find(i => i.key === 'oz-col').value, 'белый');
    const mapped = C.checkChannel(card({ values: { 'Цвет': 'Чёрный матовый' } }), OZ, CA, M).items.find(i => i.key === 'oz-col');
    assert.strictEqual(mapped.state, 'ok'); assert.strictEqual(mapped.value, 'чёрный');
    const miss = C.checkChannel(card({ values: { 'Цвет': 'Беж' } }), OZ, CA, M).items.find(i => i.key === 'oz-col');
    assert.strictEqual(miss.state, 'invalid'); assert.match(miss.msg, /нужно соответствие/);
    const m2 = { attrs: ATTRS, valueMap: { 'oz-col': { 'беж': 'белый' } } };
    assert.strictEqual(C.checkChannel(card({ values: { 'Цвет': 'Беж' } }), OZ, CA, m2).pct, 100);
});

test('фото меньше минимума площадки и неверный штрихкод блокируют карточку', () => {
    const r = C.checkChannel(card({ photos: 1 }), OZ, CA, M);
    assert.strictEqual(r.pct, 75); assert.match(r.blockers[0].msg, /1 из 3/);
    const w = C.checkChannel(card({ barcode: '4600000000016', name: 'Кастрюля' }), WB, CA, M);
    assert.strictEqual(w.blockers[0].state, 'invalid');
    assert.strictEqual(C.level(100), 'ok'); assert.strictEqual(C.level(70), 'warn'); assert.strictEqual(C.level(69), 'bad');
});

test('название по шаблону: пустые токены не оставляют запятых', () => {
    const p = { brand: 'Теплодом', sku: 'ПБ-1', values: { 'Цвет': 'Голубой' } };
    assert.strictEqual(C.buildTitle('{Бренд} {Тип}, {Цвет}', p, 'Комплект белья'), 'Теплодом Комплект белья, голубой');
    assert.strictEqual(C.buildTitle('{Тип} {Бренд}, {Материал}, {Цвет}', p, 'Комплект'), 'Комплект Теплодом, голубой');
});

test('статусы: «Готово к выгрузке» требует 100% хотя бы на одной площадке', () => {
    assert.deepStrictEqual(C.statusBlockers(card(), 'Готово к выгрузке', { Ozon: { pct: 80 }, WB: { pct: 90 } }), ['нет ни одной площадки с полнотой 100%']);
    assert.deepStrictEqual(C.statusBlockers(card(), 'Готово к выгрузке', { Ozon: { pct: 100 } }), []);
    assert.deepStrictEqual(C.statusBlockers(card({ brand: '' }), 'На проверке', {}), ['не указан бренд']);
});

test('массовое заполнение: только пустые или перезапись, без лишних записей', () => {
    const cards = [card({ id: '1', country: '' }), card({ id: '2', country: 'Китай' }), card({ id: '3', country: '', category: 'Другая' }), card({ id: '4', country: 'Россия' })];
    const attr = ATTRS['Страна производства'];
    assert.deepStrictEqual(C.planMassFill(cards, { attr, value: 'Россия', mode: 'empty' }).map(x => x.id), ['1', '3']);
    assert.deepStrictEqual(C.planMassFill(cards, { attr, value: 'Россия', mode: 'all' }).map(x => x.id), ['1', '2', '3']);
    assert.deepStrictEqual(C.planMassFill(cards, { attr, value: 'Россия', mode: 'empty', filter: p => p.category === 'Посуда' }).map(x => x.id), ['1']);
    const v = C.planMassFill([card({ values: {} })], { attr: ATTRS['Цвет'], value: 'Белый', mode: 'empty' });
    assert.strictEqual(v.length, 1);
});

test('разбор файла: разделитель, кавычки, BOM, пустые строки', () => {
    const p = C.parseDelimited('﻿Арт.;Название;Описание\r\nA1;"Кастрюля; 3 л";"с ""крышкой"""\r\n\r\nA2;Сковорода;\r\n');
    assert.strictEqual(p.delimiter, ';');
    assert.deepStrictEqual(p.rows[1], ['A1', 'Кастрюля; 3 л', 'с "крышкой"']);
    assert.strictEqual(p.rows.length, 3);
    assert.strictEqual(C.parseDelimited('a\tb\n1\t2').delimiter, 'tab');
});

test('импорт: подбор колонок, вес из кг в граммы, HTML в описании, штрихкод, бренд из справочника', () => {
    const head = ['Арт.', 'Наименование', 'Цвет', 'Вес, кг', 'Описание', 'EAN', 'Страна', 'Комментарий'];
    const map = C.mapColumns(head, ['Цвет', 'Объём, л']);
    assert.strictEqual(map[0], 'f:sku'); assert.strictEqual(map[1], 'f:name'); assert.strictEqual(map[2], 'a:Цвет'); assert.strictEqual(map[3], 'f:weightKg'); assert.strictEqual(map[7], undefined);
    assert.strictEqual(C.mapColumns(['Кол-во наволочек'], ['Количество наволочек'])[0], 'a:Количество наволочек');
    const r = C.importRow(['TS-1', 'Комплект', 'белый ', '1,4', '<p>Мягкий&nbsp;комплект</p>', '4.60E+12', '', ''], map, { attrs: ATTRS });
    assert.strictEqual(r.fields.weight, '1400'); assert.strictEqual(r.fields.desc, 'Мягкий комплект'); assert.strictEqual(r.values['Цвет'], 'Белый');
    assert.strictEqual(r.fields.barcode, undefined);
    assert.ok(r.issues.some(i => /Excel/.test(i.msg))); assert.ok(r.issues.some(i => /нет страны/.test(i.msg)));
    const none = C.importRow(['', 'X'], { 0: 'f:sku', 1: 'f:name' }, { attrs: ATTRS });
    assert.ok(none.issues.some(i => i.level === 'bad' && /артикула/.test(i.msg)));
    const st = C.columnStats([r, none]);
    assert.strictEqual(st['Артикул'].bad, 1);
});

test('выгрузка: строки с блокерами не попадают в файл, значения переводятся, CSV и XML экранируют', () => {
    const cards = [card({ id: '1', sku: 'A-1', values: { 'Цвет': 'Чёрный матовый' } }), card({ id: '2', sku: 'A-2', country: '' })];
    const ex = C.buildExport(cards, OZ, CA.map(a => Object.assign({ catTitle: 'Дом / Посуда' }, a)), M);
    assert.deepStrictEqual(ex.columns, ['Артикул', 'Категория', 'Название', 'Страна-изготовитель', 'Цвет товара', 'Объём, л', 'Количество фото']);
    assert.strictEqual(ex.ok.length, 1); assert.strictEqual(ex.bad.length, 1);
    assert.deepStrictEqual(ex.ok[0].cells, ['A-1', 'Дом / Посуда', 'Кастрюля Кухар', 'Китай', 'чёрный', '', '3']);
    assert.match(ex.bad[0].reasons[0], /Страна-изготовитель/);
    assert.strictEqual(C.toCsv(['a', 'b'], [['x;y', 'с "к"']]), 'a;b\r\n"x;y";"с ""к"""\r\n');
    assert.match(C.toSpreadsheetXml(['a'], [['<&>']]), /&lt;&amp;&gt;/);
});

test('сводка: статусы, средняя полнота, частые причины и очередь «почти готовых»', () => {
    const cs = [card({ id: '1', status: 'Готово к выгрузке' }), card({ id: '2', country: '' }), card({ id: '3', country: '', photos: 0, status: 'На проверке' })];
    const cards = cs.map(p => ({ p, res: C.checkAll(p, [OZ], CA, M) }));
    const s = C.summarize(cards, [OZ]);
    assert.strictEqual(s.byStatus['Готово к выгрузке'], 1); assert.strictEqual(s.channels.Ozon.full, 1); assert.strictEqual(s.channels.Ozon.share, 33);
    assert.strictEqual(C.topReasons(s, 1)[0].label, 'Страна-изготовитель');
    assert.deepStrictEqual(C.almostReady(cards, 'Ozon', 1).map(c => c.p.id), ['2']);
});
