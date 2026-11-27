// rules: none (defect #5738)
// SRM (демо-копия, ideav/backlogram#983): приведение КП, история цен, маршрут по порогам, допуск, экономия, дробление, поставки, разбор КП.
const test = require('node:test');
const assert = require('node:assert');
const C = require('../download/srm/js/srm-core.js');
const TODAY = '2026-11-26';

test('КП приводится к сумме с НДС и доставкой, отсрочка дешевле предоплаты', () => {
    const b = C.normalizeOffer({ price: 64900, vatIncluded: false, delivery: 120000, prepay: 100, lead: 5 }, 40);
    assert.strictEqual(b.unitGross, 77880);
    assert.strictEqual(b.total, 3235200);
    assert.ok(b.adjusted > b.total, 'предоплата дороже номинала');
    const c = C.normalizeOffer({ price: 79800, vatIncluded: true, delivery: 0, deferral: 60, lead: 10 }, 40);
    assert.strictEqual(c.total, 3192000);
    assert.ok(c.adjusted < c.total, 'отсрочка дешевле номинала');
    assert.strictEqual(C.normalizeOffer({ price: 100, vatIncluded: false, vatRate: 10 }, 1).unitGross, 110);
});

test('ранжирование: самая низкая цена за тонну без НДС не лучшая, если с доставкой и предоплатой выходит дороже', () => {
    const r = C.rankOffers([
        { id: 'B', price: 64900, vatIncluded: false, delivery: 120000, prepay: 100, lead: 5 },
        { id: 'C', price: 79800, vatIncluded: true, deferral: 60, lead: 10 },
        { id: 'A', price: 78900, vatIncluded: true, delivery: 35000, deferral: 30, lead: 7 }
    ], 40);
    assert.deepStrictEqual(r.map(x => x.offer.id), ['C', 'A', 'B']);
    assert.strictEqual(r[0].best, true);
    assert.strictEqual(r[2].paperCheapest, true);
    assert.ok(r[2].gapPct > 4);
});

test('история цен: только эта номенклатура и до даты; отклонение от прошлой закупки подсвечивается выше порога', () => {
    const h = C.priceHistory([
        { nom: 'Лист', date: '2026-03-10', unitPrice: 74400 }, { nom: 'Лист', date: '2026-08-12', unitPrice: 77100 },
        { nom: 'Труба', date: '2026-08-01', unitPrice: 99000 }, { nom: 'Лист', date: '2026-12-01', unitPrice: 1 }
    ], 'Лист', TODAY);
    assert.deepStrictEqual(h.map(x => x.price), [74400, 77100]);
    assert.strictEqual(C.priceFlag(79800, 77100).kind, 'ok');
    assert.strictEqual(C.priceFlag(81100, 77100).kind, 'up');
    assert.strictEqual(C.priceFlag(70000, 77100).kind, 'down');
});

const TH = [
    { name: 'до 500 тыс.', from: 0, to: 500000, steps: 'Категорийный закупщик' },
    { name: 'до 3 млн', from: 500000, to: 3000000, steps: 'Категорийный закупщик; Директор по закупкам' },
    { name: 'свыше 3 млн', from: 3000000, to: '', steps: 'Категорийный закупщик; Директор по закупкам; Закупочная комиссия' }
];
test('маршрут: сумма выше порога 3 млн требует комиссии; поправили порог - маршрут короче', () => {
    assert.strictEqual(C.routeFor(3192000, TH).commission, true);
    assert.strictEqual(C.routeFor(3000000, TH).commission, false, 'ровно порог - ещё без комиссии');
    assert.strictEqual(C.routeFor(120000, TH).steps.length, 1);
    const moved = TH.map(t => Object.assign({}, t)); moved[1].to = 5000000; moved[2].from = 5000000;
    assert.strictEqual(C.routeFor(3192000, moved).commission, false);
});

test('подписи идут по порядку, комиссию подписывает директор, закупщик за директора не подпишет', () => {
    const steps = C.routeFor(3192000, TH).steps;
    let s = C.addSign('', 'Категорийный закупщик', 'buyer', '2026-11-26');
    let p = C.routeProgress(steps, s);
    assert.strictEqual(p.next, 'Директор по закупкам');
    assert.strictEqual(C.canSign('Категорийный закупщик', p.next), false);
    assert.strictEqual(C.canSign('директор по закупкам', p.next), true);
    s = C.addSign(s, 'Директор по закупкам', 'director', '2026-11-26');
    s = C.addSign(s, 'Закупочная комиссия', 'director', '2026-11-26');
    assert.strictEqual(C.routeProgress(steps, s).complete, true);
    assert.strictEqual(C.routeProgress(steps, 'Закупочная комиссия|d|x').next, 'Категорийный закупщик', 'подпись не по порядку не засчитывается');
});

test('допуск: красная зона и истёкший допуск блокируют договор, просроченный документ - предупреждение', () => {
    const red = C.admission({ level: 'Красная зона', color: 'red', reason: 'смена директора' }, [], TODAY);
    assert.strictEqual(red.ok, false);
    assert.ok(/смена директора/.test(red.reasons[0]));
    const exp = C.admission({ color: 'green', until: '2026-11-01' }, [], TODAY);
    assert.strictEqual(exp.ok, false);
    const warn = C.admission({ color: 'green', until: '2027-06-30' }, [{ name: 'Выписка ЕГРЮЛ', until: '2026-11-20' }, { name: 'Справка ФНС', until: '2026-12-10' }], TODAY);
    assert.strictEqual(warn.ok, true);
    assert.strictEqual(warn.light, 'amber');
    assert.strictEqual(warn.warnings.length, 2);
    assert.strictEqual(C.admission({ color: 'green', until: '2027-06-30' }, [{ name: 'X', until: '2027-06-30' }], TODAY).light, 'green');
});

test('договор создаётся, только если допуск есть и маршрут пройден', () => {
    const steps = ['Категорийный закупщик'];
    const ok = C.admission({ color: 'green' }, [], TODAY);
    assert.strictEqual(C.contractGate(ok, C.routeProgress(steps, '')).ok, false);
    assert.strictEqual(C.contractGate(ok, C.routeProgress(steps, 'Категорийный закупщик|b|d')).ok, true);
    const g = C.contractGate(C.admission({ color: 'red', level: 'Красная зона' }, [], TODAY), C.routeProgress(steps, 'Категорийный закупщик|b|d'));
    assert.strictEqual(g.ok, false);
    assert.strictEqual(g.reasons.length, 1);
});

test('экономия: одна формула, три базы; итог взвешен по базе, договоры без базы не искажают процент', () => {
    const c = { sum: 900, budget: 1000, firstOffer: 950, lastPrice: 8, qty: 100 };
    assert.deepStrictEqual(C.saving(c, 'budget'), { base: 1000, amount: 100, pct: 10 });
    assert.strictEqual(C.saving(c, 'first').amount, 50);
    assert.strictEqual(C.saving(c, 'last').amount, -100);
    const t = C.savingTotal([c, { sum: 500, budget: 0 }, { sum: 1000, budget: 1000 }], 'budget');
    assert.deepStrictEqual(t, { base: 2000, amount: 100, pct: 5 });
});

test('дробление: три заявки одного завода на одну позицию ниже порога в окне 30 дней, вместе выше', () => {
    const r = C.detectSplitting([
        { id: 1, plant: 'К', nom: 'Электроды', date: '2026-10-28', amount: 2780000 },
        { id: 2, plant: 'К', nom: 'Электроды', date: '2026-11-03', amount: 2940000 },
        { id: 3, plant: 'К', nom: 'Электроды', date: '2026-11-09', amount: 2690000 },
        { id: 4, plant: 'Ч', nom: 'Электроды', date: '2026-11-09', amount: 2690000 },
        { id: 5, plant: 'К', nom: 'Электроды', date: '2026-04-01', amount: 2000000 },
        { id: 6, plant: 'К', nom: 'Лист', date: '2026-11-01', amount: 4000000 }
    ], 3000000);
    assert.strictEqual(r.length, 1);
    assert.deepStrictEqual(r[0].items.map(x => x.id), [1, 2, 3]);
    assert.strictEqual(r[0].sum, 8410000);
    assert.strictEqual(r[0].days, 12);
});

test('траты по поставщику по всем заводам и доли', () => {
    const cs = [{ supplier: 'X', plant: 'Ч', sum: 300 }, { supplier: 'X', plant: 'К', sum: 100 }, { supplier: 'Y', plant: 'Ч', sum: 600 }];
    const m = C.spendMatrix(cs, 'X');
    assert.strictEqual(m.total, 400);
    assert.deepStrictEqual(m.byPlant.map(x => [x.key, x.share]), [['Ч', 75], ['К', 25]]);
    assert.deepStrictEqual(C.spendBy(cs, 'supplier').map(x => x.share), [60, 40]);
});

test('поставки: вовремя и полностью, опоздание, недовоз, просрочка без факта', () => {
    const st = [
        { plan: '2026-10-10', fact: '2026-10-09', qty: 20, accepted: 20 },
        { plan: '2026-10-20', fact: '2026-10-25', qty: 20, accepted: 20 },
        { plan: '2026-11-01', fact: '2026-11-01', qty: 20, accepted: 18 },
        { plan: '2026-11-20', fact: '', qty: 20 },
        { plan: '2026-12-10', fact: '', qty: 20 }
    ];
    assert.deepStrictEqual(st.map(s => C.stageState(s, TODAY)), ['otif', 'late', 'short', 'overdue', 'wait']);
    const o = C.otif(st, TODAY);
    assert.strictEqual(o.pct, 33);
    assert.strictEqual(o.overdue.length, 1);
    const p = C.planStages(40, '2026-11-26', 2, 14, 14);
    assert.deepStrictEqual(p.map(x => [x.plan, x.qty]), [['2026-12-10', 20], ['2026-12-24', 20]]);
    assert.strictEqual(C.planStages(10, '2026-11-26', 3).reduce((s, x) => s + x.qty, 0), 10);
});

test('КП из Excel: подписи в столбце A и таблица с заголовками', () => {
    const a = C.parseOfferRows([['Цена за т, руб. с НДС', '78 900'], ['Доставка, руб.', '35000'], ['Отсрочка платежа, дней', 30], ['Срок поставки, дней', 7], ['Предоплата, %', 0]]);
    assert.deepStrictEqual(a.fields, { price: 78900, vatIncluded: true, delivery: 35000, deferral: 30, lead: 7, prepay: 0 });
    assert.deepStrictEqual(a.missing, []);
    const b = C.parseOfferRows([['Цена', 'НДС', 'Доставка', 'Отсрочка', 'Срок поставки'], ['64900', 'без НДС', 'включена', '0', '5']]);
    assert.strictEqual(b.fields.vatIncluded, false);
    assert.strictEqual(b.fields.delivery, 0);
    assert.strictEqual(b.fields.lead, 5);
});

test('КП из текста письма: цена, НДС, доставка, предоплата, срок; вставка из Excel с табуляцией', () => {
    const t = 'Добрый день! Предлагаем лист г/к 3 мм по цене 64 900 руб./т без НДС. Доставка до завода 120 000 руб. Условия: 100% предоплата, отгрузка 5 дней с момента оплаты.';
    const r = C.parseOfferText(t);
    assert.deepStrictEqual(r.fields, { price: 64900, vatIncluded: false, delivery: 120000, prepay: 100, lead: 5 });
    assert.deepStrictEqual(r.missing, ['deferral']);
    const r2 = C.parseOfferText('Цена с НДС\t79800\nОтсрочка, дн\t60\nСрок поставки\t10');
    assert.strictEqual(r2.fields.price, 79800);
    assert.strictEqual(r2.fields.vatIncluded, true);
    assert.strictEqual(r2.fields.deferral, 60);
    assert.ok(C.parseOfferText('стоимость 1 000 руб с НДС, доставка включена, отсрочка 45 календарных дней').fields.delivery === 0);
});

test('номера и код приглашения', () => {
    assert.strictEqual(C.nextNumber(['З-2026-0147', 'З-2026-0009', 'x'], 'З-2026-'), 'З-2026-0148');
    let i = 0; const code = C.inviteCode(() => (i++ % 7) / 7);
    assert.ok(/^INV-[A-Z2-9]{8}$/.test(code));
    assert.strictEqual(C.toCsv([['a;b', 'c']]), '"a;b";c');
});
