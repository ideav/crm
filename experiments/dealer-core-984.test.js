// rules: none (defect #5733)
// B2B-портал дилера (демо-копия, ideav/backlogram#984): персональная цена, маржа, остатки, дебиторка, проверка заказа, статусы, отчёт дилера.
const test = require('node:test');
const assert = require('node:assert');
const C = require('../download/dealer/js/dealer-core.js');

const TODAY = '2026-11-26';
const boiler = { name: 'Котёл ТЛ-24', group: 'Котлы', base: 68900, cost: 51000 };
const rad = { name: 'Радиатор 22/500/600', group: 'Радиаторы', base: 6150, cost: 4270 };
const pump = { name: 'Насос 25-60', group: 'Насосы', base: 9450, cost: 6420 };
const td = { name: 'ТеплоДом', level: 'Платиновый', limit: 2300000, groups: [] };
const conds = [
    { dealer: 'ТеплоДом', kind: 'Скидка на группу', group: 'Радиаторы', pct: 18, until: '2026-12-31' },
    { dealer: 'ТеплоДом', kind: 'Спеццена', product: 'Котёл ТЛ-24', price: 56500, until: '2026-12-31', approve: true },
    { dealer: 'ТеплоДом', kind: 'Спеццена', product: 'Насос 25-60', price: 7900, until: '2026-11-15' },
    { dealer: 'АкваСервис', kind: 'Скидка на группу', group: 'Котлы', pct: 30 }
];

test('цена: спеццена сильнее скидок, из уровня и договорной скидки берётся большая', () => {
    const b = C.priceFor(boiler, td, conds, 15, TODAY);
    assert.strictEqual(b.price, 56500); assert.strictEqual(b.kind, 'special'); assert.strictEqual(b.approve, true);
    const r = C.priceFor(rad, td, conds, 15, TODAY);
    assert.strictEqual(r.kind, 'group'); assert.strictEqual(r.pct, 18); assert.strictEqual(r.price, Math.round(6150 * 0.82));
    const r2 = C.priceFor(rad, td, conds, 20, TODAY);
    assert.strictEqual(r2.kind, 'level'); assert.strictEqual(r2.pct, 20);
});

test('цена: истёкшая спеццена не действует, чужие условия не применяются', () => {
    const p = C.priceFor(pump, td, conds, 15, TODAY);
    assert.strictEqual(p.kind, 'level'); assert.strictEqual(p.price, Math.round(9450 * 0.85));
    assert.strictEqual(C.priceFor(pump, td, conds, 15, '2026-11-10').price, 7900);
    assert.strictEqual(C.priceFor(boiler, { name: 'Другой', level: 'Базовый' }, conds, 0, TODAY).price, 68900);
});

test('маржа: от цены продажи, без себестоимости - нет значения', () => {
    assert.strictEqual(C.marginPct(56500, 51000), 9.7);
    assert.strictEqual(C.marginPct(100, null), null);
    assert.strictEqual(C.marginPct(0, 10), null);
});

test('каталог: дилеру видны только открытые группы, пустой список - все', () => {
    const all = [boiler, rad, pump];
    assert.deepStrictEqual(C.catalogFor(all, { groups: ['Радиаторы', 'Насосы'] }).map(p => p.name), [rad.name, pump.name]);
    assert.strictEqual(C.catalogFor(all, { groups: [] }).length, 3);
});

test('остатки: доступно = наличие минус резерв, по складам, не меньше нуля', () => {
    const st = [{ product: 'A', wh: 'МСК', qty: 10, reserve: 3 }, { product: 'A', wh: 'ЕКБ', qty: 2, reserve: 5 }, { product: 'B', wh: 'МСК', qty: 9, reserve: 0 }];
    assert.deepStrictEqual(C.stockByWarehouse('A', st), { 'МСК': 7, 'ЕКБ': 0 });
    assert.strictEqual(C.stockLevel(0), 'none'); assert.strictEqual(C.stockLevel(4), 'low'); assert.strictEqual(C.stockLevel(40), 'ok');
});

const inv = [
    { dealer: 'ТеплоДом', sum: 500000, paid: 100000, due: '2026-11-17' },
    { dealer: 'ТеплоДом', sum: 300000, paid: 0, due: '2026-12-10' },
    { dealer: 'ТеплоДом', sum: 200000, paid: 200000, due: '2026-10-01' },
    { dealer: 'Другой', sum: 90000, paid: 0, due: '2026-10-01' }
];
test('дебиторка: долг, просроченная часть и дни просрочки на дату', () => {
    const d = C.debtSummary(inv, 'ТеплоДом', TODAY);
    assert.strictEqual(d.debt, 700000); assert.strictEqual(d.overdue, 400000); assert.strictEqual(d.overdueDays, 9); assert.strictEqual(d.nextDue, '2026-12-10');
    assert.strictEqual(d.open.length, 2); assert.strictEqual(d.open[0].late, 9);
    const a = C.aging(inv, TODAY);
    assert.deepStrictEqual(a, { current: 300000, d15: 400000, d30: 0, over30: 90000 });
});

test('лимит занимают долг и заказы без счёта (согласование, подтверждён, сборка)', () => {
    const orders = [{ id: '1', dealer: 'ТеплоДом', status: 'Подтверждён', sum: 100 }, { id: '2', dealer: 'ТеплоДом', status: 'Отгружен', sum: 500 }, { id: '3', dealer: 'ТеплоДом', status: 'На согласовании', sum: 50 }, { id: '4', dealer: 'Другой', status: 'Собирается', sum: 70 }, { id: '5', dealer: 'ТеплоДом', status: 'Черновик', sum: 9 }];
    assert.strictEqual(C.openOrdersSum(orders, 'ТеплоДом'), 150);
    assert.strictEqual(C.openOrdersSum(orders, 'ТеплоДом', '3'), 100);
    assert.deepStrictEqual(C.limitState({ limit: 1000 }, 600, 150), { limit: 1000, used: 750, free: 250, pct: 75 });
});

const line = (o) => Object.assign({ product: 'Радиатор', qty: 10, pack: 1, price: 5000, base: 6150, cost: 4000, avail: 100 }, o || {});
test('заказ без нарушений подтверждается сразу', () => {
    const r = C.checkOrder({ dealer: { limit: 1000000 }, lines: [line()], debt: { debt: 0, overdue: 0, overdueDays: 0 }, open: 0 });
    assert.strictEqual(r.ok, true); assert.strictEqual(r.status, 'Подтверждён'); assert.strictEqual(r.total, 50000); assert.deepStrictEqual(r.approvals, []);
});

test('заказ сверх лимита уходит на согласование с суммой превышения', () => {
    const r = C.checkOrder({ dealer: { limit: 100000 }, lines: [line()], debt: { debt: 40000, overdue: 0, overdueDays: 0 }, open: 30000 });
    assert.strictEqual(r.status, 'На согласовании');
    assert.deepStrictEqual(r.approvals.map(a => [a.reason, a.amount]), [['Сверх лимита', 20000]]);
    const tol = C.checkOrder({ dealer: { limit: 100000 }, lines: [line()], debt: { debt: 40000, overdue: 0, overdueDays: 0 }, open: 30000, rules: { limitTolerance: 25 } });
    assert.strictEqual(tol.status, 'Подтверждён');
});

test('просрочка: с порога согласования - на согласование, с порога блока - заказ не принимается', () => {
    const base = { dealer: { limit: 0 }, lines: [line()], open: 0 };
    assert.strictEqual(C.checkOrder(Object.assign({}, base, { debt: { debt: 9, overdue: 9, overdueDays: 9 } })).approvals[0].reason, 'Отгрузка при просрочке');
    const b = C.checkOrder(Object.assign({}, base, { debt: { debt: 9, overdue: 9, overdueDays: 38 } }));
    assert.strictEqual(b.ok, false); assert.strictEqual(b.status, 'blocked'); assert.match(b.errors[0], /38 дн/);
    assert.strictEqual(C.checkOrder(Object.assign({}, base, { debt: { debt: 9, overdue: 9, overdueDays: 38 }, rules: { blockOverdue: 60 } })).status, 'На согласовании');
});

test('цена ниже маржи: по себестоимости у сотрудника и по метке спеццены у закупщика', () => {
    const staff = C.checkOrder({ dealer: { limit: 0 }, lines: [line({ price: 4400, cost: 4000 })], debt: null, open: 0 });
    assert.strictEqual(staff.approvals[0].reason, 'Цена ниже маржи'); assert.strictEqual(staff.lines[0].low, true);
    const buyer = C.checkOrder({ dealer: { limit: 0 }, lines: [line({ price: 56500, cost: null, approve: true })], debt: null, open: 0 });
    assert.strictEqual(buyer.approvals[0].reason, 'Цена ниже маржи');
    assert.strictEqual(C.checkOrder({ dealer: { limit: 0 }, lines: [line({ cost: null })], debt: null, open: 0 }).status, 'Подтверждён');
});

test('кратность упаковки - ошибка, нехватка на складе отгрузки - предупреждение с другими складами', () => {
    const r = C.checkOrder({ dealer: { limit: 0 }, lines: [line({ qty: 15, pack: 10, avail: 5, elsewhere: 'ЕКБ 40' })], debt: null, open: 0 });
    assert.strictEqual(r.ok, false); assert.match(r.errors[0], /кратно 10/);
    assert.match(r.warnings[0], /не хватает 10 \(есть: ЕКБ 40\)/);
    assert.strictEqual(C.checkOrder({ dealer: {}, lines: [], debt: null, open: 0 }).ok, false);
});

test('статус по решениям и шаги склада', () => {
    assert.strictEqual(C.statusByDecisions([{ decision: 'Одобрено' }, { decision: 'Одобрено' }]), 'Подтверждён');
    assert.strictEqual(C.statusByDecisions([{ decision: 'Одобрено' }, { decision: 'Отклонено' }]), 'Отклонён');
    assert.strictEqual(C.statusByDecisions([]), null);
    assert.deepStrictEqual(['Подтверждён', 'Собирается', 'Отгружен', 'Доставлен', 'Черновик'].map(C.nextWarehouseStatus), ['Собирается', 'Отгружен', 'Доставлен', null, null]);
});

test('повтор заказа по сегодняшним ценам с пометкой изменений; отчёт дилера и номера', () => {
    const r = C.repeatLines([{ product: 'A', qty: 2, price: 100 }, { product: 'B', qty: 1, price: 50 }, { product: 'X', qty: 1, price: 9 }], n => ({ A: { price: 100 }, B: { price: 55 } })[n] || null);
    assert.deepStrictEqual(r.map(l => [l.product, l.changed, l.missing]), [['A', false, false], ['B', true, false], ['X', false, true]]);
    assert.strictEqual(C.reportDue('2026-11'), '2026-12-05'); assert.strictEqual(C.reportDue('2026-12'), '2027-01-05');
    assert.deepStrictEqual(C.missingReports([{ name: 'A' }, { name: 'B' }], [{ dealer: 'A', period: '2026-10' }], '2026-10'), ['B']);
    assert.deepStrictEqual(C.checkReportRow({ period: '2026-13', product: '', sold: -1 }).length, 3);
    assert.strictEqual(C.nextNumber(['ЗД-26-0205', 'ЗД-26-0100', 'СЧ-26-0999'], 'ЗД-26-'), 'ЗД-26-0206');
    assert.strictEqual(C.toIso('05.12.2026'), '2026-12-05');
});
