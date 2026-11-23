// rules: none (demo)
// Взыскание дебиторки (демо-копия, ideav/crm#5680): чистые функции расчёта старения, ступеней, пеней и процентов, стоп-отгрузки, графика реструктуризации.
const test = require('node:test');
const assert = require('node:assert');
const C = require('../download/collect/js/collect-core.js');

const RATES = [{ from: '2025-12-22', rate: 16 }, { from: '2026-02-13', rate: 15.5 }];
const STAGES = [
    { code: 'restructuring', name: 'Реструктуризация', from: 0 }, { code: 'before', name: 'До срока', from: 0 }, { code: 'remind', name: 'Напоминание', from: 1 }, { code: 'call', name: 'Звонок', from: 8 },
    { code: 'stop', name: 'Стоп-отгрузка', from: 15 }, { code: 'claim', name: 'Претензия', from: 31 }, { code: 'court', name: 'Суд', from: 61 }
];

test('даты и суммы: перевод формата, прибавление дней, формат рублей', () => {
    assert.strictEqual(C.toIso('25.11.2026'), '2026-11-25');
    assert.strictEqual(C.addDays('2026-11-30', 1), '2026-12-01');
    assert.strictEqual(C.diffDays('2026-10-01', '2026-11-01'), 31);
    assert.strictEqual(C.fmtRub(1234567.891, true), '1 234 567,89');
    assert.strictEqual(C.num('1 250,5'), 1250.5);
});

test('корзины старения по границам 30/60/90', () => {
    assert.strictEqual(C.bucketOf(0), 'cur');
    assert.strictEqual(C.bucketOf(1), 'b30');
    assert.strictEqual(C.bucketOf(30), 'b30');
    assert.strictEqual(C.bucketOf(31), 'b60');
    assert.strictEqual(C.bucketOf(60), 'b60');
    assert.strictEqual(C.bucketOf(61), 'b90');
    assert.strictEqual(C.bucketOf(91), 'b90p');
});

test('остаток документа учитывает оплаты до даты среза; полностью оплаченный не попадает в реестр', () => {
    const docs = [
        { id: 'd1', client: 'A', number: 'Р-1', date: '2026-09-01', due: '2026-10-01', amount: 100000 },
        { id: 'd2', client: 'A', number: 'Р-2', date: '2026-11-01', due: '2026-12-01', amount: 50000 },
        { id: 'd3', client: 'B', number: 'Р-3', date: '2026-08-01', due: '2026-09-01', amount: 70000 }
    ];
    const pays = [{ doc: 'd1', date: '2026-10-20', amount: 30000 }, { doc: 'd3', date: '2026-09-20', amount: 70000 }, { doc: 'd1', date: '2026-12-01', amount: 999 }];
    const l = C.ledger(docs, pays, '2026-11-23');
    assert.strictEqual(l.rows.length, 1);
    const a = l.rows[0];
    assert.strictEqual(a.client, 'A');
    assert.strictEqual(a.debt, 120000);
    assert.strictEqual(a.overdue, 70000);
    assert.strictEqual(a.maxDays, 53);
    assert.strictEqual(a.aging.b60, 70000);
    assert.strictEqual(a.aging.cur, 50000);
});

test('ступень воронки по возрасту долга, суд и реструктуризация перекрывают возраст', () => {
    assert.strictEqual(C.stageFor(0, STAGES).code, 'before');
    assert.strictEqual(C.stageFor(-5, STAGES).code, 'before');
    assert.strictEqual(C.stageFor(1, STAGES).code, 'remind');
    assert.strictEqual(C.stageFor(14, STAGES).code, 'call');
    assert.strictEqual(C.stageFor(15, STAGES).code, 'stop');
    assert.strictEqual(C.stageFor(45, STAGES).code, 'claim');
    assert.strictEqual(C.stageFor(200, STAGES).code, 'court');
    assert.strictEqual(C.clientStage(10, STAGES, { court: true }).stage.code, 'court');
    const r = C.clientStage(40, STAGES, { restructuring: true });
    assert.strictEqual(r.override, 'restructuring');
    assert.strictEqual(r.stage.name, 'Реструктуризация');
});

test('стоп-отгрузка: порог дней, сумма, лимит; ключевой клиент и действующий график', () => {
    const rules = { stopDays: 15, stopSum: 500000, byLimit: true };
    const ok = C.stopDecision({ limit: 1000000, key: false }, { maxDays: 10, overdue: 100000, debt: 900000 }, rules);
    assert.strictEqual(ok.stop, false);
    const d = C.stopDecision({ limit: 1000000, key: false }, { maxDays: 20, overdue: 100000, debt: 900000 }, rules);
    assert.strictEqual(d.stop, true);
    assert.strictEqual(d.reasons.length, 1);
    const lim = C.stopDecision({ limit: 800000, key: false }, { maxDays: 3, overdue: 10000, debt: 900000 }, rules);
    assert.strictEqual(lim.stop, true);
    const sum = C.stopDecision({ limit: 0, key: false }, { maxDays: 3, overdue: 500000, debt: 900000 }, rules);
    assert.strictEqual(sum.stop, true);
    const key = C.stopDecision({ limit: 0, key: true }, { maxDays: 40, overdue: 100000, debt: 100000 }, rules);
    assert.strictEqual(key.stop, false);
    assert.strictEqual(key.needDirector, true);
    const rs = C.stopDecision({ limit: 0, key: false }, { maxDays: 40, overdue: 100000, debt: 100000 }, rules, { restructOk: true });
    assert.strictEqual(rs.stop, false);
    assert.strictEqual(rs.needDirector, false);
});

test('ст. 395 ГК: период делится по смене ключевой ставки (16% до 12.02, 15,5% с 13.02)', () => {
    const r = C.interest395(100000, '2026-01-31', [], '2026-02-20', RATES);
    assert.strictEqual(r.days, 20);
    assert.strictEqual(r.rows.length, 2);
    assert.strictEqual(r.rows[0].days, 12);
    assert.strictEqual(r.rows[0].rate, 16);
    assert.strictEqual(r.rows[0].sum, 526.03);
    assert.strictEqual(r.rows[1].from, '2026-02-13');
    assert.strictEqual(r.rows[1].sum, 339.73);
    assert.strictEqual(r.total, 865.76);
});

test('ст. 395 ГК: период делится на границе года, високосный год считается за 366 дней', () => {
    const r = C.interest395(100000, '2025-12-30', [], '2026-01-02', RATES);
    assert.strictEqual(r.rows.length, 2);
    assert.strictEqual(r.rows[0].days, 1);
    assert.strictEqual(r.rows[1].days, 2);
    assert.strictEqual(r.total, 131.51);
    const leap = C.interest395(366000, '2024-03-31', [], '2024-04-09', [{ from: '2024-01-01', rate: 16 }]);
    assert.strictEqual(leap.rows[0].yearDays, 366);
    assert.strictEqual(leap.total, 1440);
    assert.ok(C.isLeap(2024) && !C.isLeap(2026) && !C.isLeap(2100) && C.isLeap(2000));
});

test('ст. 395 ГК: частичная оплата уменьшает базу со дня платежа; в срок или после среза - нет начисления', () => {
    const r = C.interest395(100000, '2026-03-01', [{ date: '2026-03-11', amount: 40000 }], '2026-03-20', [{ from: '2026-01-01', rate: 10 }]);
    assert.strictEqual(r.rows.length, 2);
    assert.strictEqual(r.rows[0].principal, 100000);
    assert.strictEqual(r.rows[0].days, 9);
    assert.strictEqual(r.rows[1].principal, 60000);
    assert.strictEqual(r.rows[1].days, 10);
    assert.strictEqual(C.interest395(100000, '2026-03-20', [], '2026-03-20', RATES).total, 0);
    assert.strictEqual(C.interest395(100000, '2026-03-21', [], '2026-03-20', RATES).total, 0);
});

test('неустойка по договору: ставка в день с частичной оплатой и потолком', () => {
    const p = [{ date: '2026-03-11', amount: 40000 }];
    const r = C.penaltyContract(100000, '2026-03-01', p, '2026-03-20', 0.1, 0);
    assert.strictEqual(r.rows.length, 2);
    assert.strictEqual(r.total, 1500);
    assert.strictEqual(r.capped, false);
    const c = C.penaltyContract(100000, '2026-03-01', p, '2026-03-20', 0.1, 1);
    assert.strictEqual(c.total, 1000);
    assert.strictEqual(c.raw, 1500);
    assert.strictEqual(c.capped, true);
    assert.strictEqual(C.penaltyContract(100000, '2026-03-01', [], '2026-03-20', 0, 0).total, 0);
});

test('способ расчёта берётся из договора: договор, 395 или без пеней', () => {
    const doc = { id: 'd1', amount: 100000, due: '2026-03-01' };
    const rates = [{ from: '2026-01-01', rate: 10 }];
    assert.strictEqual(C.penaltyFor(doc, [], '2026-03-10', { basis: 'contract', rate: 0.1, cap: 0 }, rates).total, 900);
    assert.strictEqual(C.penaltyFor(doc, [], '2026-03-10', { basis: '395', rate: 0.1 }, rates).total, C.round2(100000 * 0.1 * 9 / 365));
    assert.strictEqual(C.penaltyFor(doc, [], '2026-03-10', { basis: 'none' }, rates).total, 0);
});

test('претензионный срок: 30 дней со дня направления, иск - со следующего дня', () => {
    const a = C.claimTerm('2026-10-20', 30, '2026-11-19');
    assert.strictEqual(a.last, '2026-11-19');
    assert.strictEqual(a.earliestSuit, '2026-11-20');
    assert.strictEqual(a.canSue, false);
    assert.strictEqual(C.claimTerm('2026-10-20', 30, '2026-11-20').canSue, true);
    assert.strictEqual(C.claimTerm('2026-10-20', 10, '2026-11-01').last, '2026-10-30');
    assert.strictEqual(C.claimTerm('2026-10-20', 0, '2026-11-01').term, 30);
});

test('график реструктуризации: оплачен, просрочен, ожидается; льготные дни', () => {
    const rows = [{ date: '2026-10-15', amount: 50000, paid: 50000 }, { date: '2026-11-10', amount: 50000, paid: 20000 }, { date: '2026-12-10', amount: 50000, paid: 0 }];
    const r = C.restructureCheck(rows, '2026-11-23', 0);
    assert.deepStrictEqual(r.rows.map(x => x.status), ['paid', 'late', 'wait']);
    assert.strictEqual(r.violated, true);
    assert.strictEqual(r.late, 30000);
    assert.strictEqual(r.maxLate, 13);
    assert.strictEqual(r.remain, 80000);
    assert.strictEqual(r.next.date, '2026-12-10');
    assert.strictEqual(C.restructureCheck(rows, '2026-11-23', 14).violated, false);
});

test('DSO, выручка за период, просрочка по менеджерам', () => {
    assert.strictEqual(C.dso(1200000, 3000000, 90), 36);
    assert.strictEqual(C.dso(1, 0, 90), 0);
    const docs = [{ date: '2026-11-20', amount: 100 }, { date: '2026-08-26', amount: 10 }, { date: '2026-08-25', amount: 1000 }];
    assert.strictEqual(C.revenueFor(docs, '2026-11-23', 90), 110);
    const m = C.byManager([{ manager: 'Иванов', debt: 100, overdue: 50, maxDays: 10 }, { manager: 'Иванов', debt: 100, overdue: 0, maxDays: 0 }, { manager: 'Петрова', debt: 100, overdue: 80, maxDays: 40 }]);
    assert.strictEqual(m[0].manager, 'Петрова');
    assert.strictEqual(m[1].debt, 200);
    assert.strictEqual(m[1].share, 25);
    assert.strictEqual(m[1].bad, 1);
});

test('прогноз поступлений: обещание, график, срок документа, просрочка без покрытия по вероятности ступени', () => {
    const w = C.forecast('2026-11-23', 4, [{ due: '2026-11-26', balance: 1000 }],
        [{ client: 'A', date: '2026-11-25', amount: 500 }], [{ client: 'A', date: '2026-12-03', amount: 400, paid: 0 }],
        [{ client: 'A', overdue: 1000, stageCode: 'call' }, { client: 'B', overdue: 1000, stageCode: 'call' }], { call: 0.5 });
    assert.strictEqual(w.length, 4);
    assert.strictEqual(w[0].due, 850);
    assert.strictEqual(w[0].promised, 400);
    assert.strictEqual(w[1].scheduled, 360);
    assert.strictEqual(w[1].overdue, 500 + 50);
});

test('текст претензии: суммы, срок 30 дней и ссылка на ст. 4 АПК, ст. 395', () => {
    const t = C.buildClaim({
        seller: 'ООО «Продавец»', buyer: 'ООО «Покупатель»', contractNo: '15/П', contractDate: '2026-01-10',
        docs: [{ number: 'Р-1', date: '2026-09-01', due: '2026-10-01', balance: 100000, days: 53 }], principal: 100000,
        penalty: { basis: '395', total: 865.76 }, sendDate: '2026-11-23', asOf: '2026-11-23', term: 30
    }).join('\n');
    assert.ok(t.includes('100 000,00'));
    assert.ok(t.includes('865,76'));
    assert.ok(t.includes('100 865,76'));
    assert.ok(t.includes('до 23.12.2026'));
    assert.ok(t.includes('ст. 395'));
    assert.strictEqual(C.fill('Долг {сумма} ₽, {нет}', { сумма: '5' }), 'Долг 5 ₽, {нет}');
});
