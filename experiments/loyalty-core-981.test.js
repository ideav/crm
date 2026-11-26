// rules: none (defect #5734)
// Программа лояльности (демо-копия, ideav/backlogram#981): партии бонусов и сгорание, расчёт чека, конфликт акций, RFM, кампании, обязательства, ручные операции.
const test = require('node:test');
const assert = require('node:assert');
const C = require('../download/loyalty/js/loyalty-core.js');

const T = '2026-11-26';
const acc = (date, bonus, life) => ({ date, bonus, expires: C.addDays(date, life || 90) });
const PROG = { mech: 'cashback', percent: 5, limit: 30, life: 90, nth: 6, giftPrice: 220, bonusOnPromo: false, manualMax: 300, lostDays: 30 };
const BD = { name: 'День рождения −10%', from: '2026-01-01', to: '2026-12-31', discount: 10, bonusAllowed: false, cond: 'День рождения: 3 дня до и после' };
const PUMPKIN = { name: 'Тыквенный сезон −10%', from: '2026-10-01', to: '2026-11-30', discount: 10, bonusAllowed: true, cond: 'Тыквенный латте' };

test('партии: списание гасит партию с ближайшим сроком, в день срока партия уже сгорела', () => {
    const ops = [acc('2026-09-01', 100), acc('2026-10-01', 200), { date: '2026-10-10', bonus: -150 }];
    const L = C.lots(ops, T);
    assert.strictEqual(L.balance, 150);
    assert.deepStrictEqual(L.lots.map(l => [l.date, l.left]), [['2026-10-01', 150]]);
    assert.strictEqual(C.lots([acc('2026-08-28', 50)], T).balance, 0, '28.08 + 90 = 26.11: сгорела сегодня');
    assert.strictEqual(C.lots([acc('2026-08-28', 50)], T).expiredUnburned, 50);
    assert.strictEqual(C.lots([acc('2026-08-29', 50)], T).balance, 50);
});

test('партии: сколько сгорит за 14 дней и операции сгорания на дату', () => {
    const ops = [acc('2026-09-01', 80), acc('2026-11-01', 40), acc('2026-08-01', 30)];
    const L = C.lots(ops, T);
    assert.strictEqual(L.expiring(14), 80, '01.09 сгорает 30.11, 01.11 - в январе');
    assert.strictEqual(L.nextBurn.expires, '2026-11-30');
    const b = C.burnOps(ops, T);
    assert.deepStrictEqual(b, [{ date: '2026-10-30', bonus: -30, lotDate: '2026-08-01' }]);
    assert.strictEqual(C.lots(ops.concat(b), T).expiredUnburned, 0);
});

test('чек по кэшбэку: лимит списания от чека и баланса, начисление только на оплаченное деньгами', () => {
    const r = C.calcCheck({ sum: 1000, drinks: 2, wantBonus: 500, date: T }, { program: PROG, balance: 400 });
    assert.strictEqual(r.bonusMax, 300);
    assert.strictEqual(r.bonusUsed, 300);
    assert.strictEqual(r.toPay, 700);
    assert.strictEqual(r.accrue, 35);
    const poor = C.calcCheck({ sum: 1000, wantBonus: 500, date: T }, { program: PROG, balance: 120 });
    assert.strictEqual(poor.bonusUsed, 120);
});

test('правило гостя: личный лимит и кэшбэк перекрывают программу', () => {
    const g = { limit: 50, percent: 7 };
    assert.deepStrictEqual([C.ruleFor(PROG, g).limit, C.ruleFor(PROG, g).percent, C.ruleFor(PROG, {}).limit], [50, 7, 30]);
    const r = C.calcCheck({ sum: 600, wantBonus: 1000, date: T }, { program: PROG, person: g, balance: 1000 });
    assert.strictEqual(r.bonusUsed, 300);
    assert.strictEqual(r.accrue, 21);
});

test('конфликт: в акции без бонусов списание запрещено, в акции с бонусами - разрешено', () => {
    const g = { birthday: '1991-11-28' };
    const r = C.calcCheck({ sum: 1000, wantBonus: 200, date: T }, { program: PROG, person: g, promo: BD, balance: 500 });
    assert.strictEqual(r.discount, 100);
    assert.strictEqual(r.bonusUsed, 0);
    assert.strictEqual(r.conflicts.length, 1);
    assert.strictEqual(r.toPay, 900);
    const ok = C.calcCheck({ sum: 1000, wantBonus: 200, date: T }, { program: PROG, promo: PUMPKIN, balance: 500 });
    assert.deepStrictEqual([ok.discount, ok.bonusUsed, ok.conflicts.length], [100, 200, 0]);
    const all = C.calcCheck({ sum: 1000, wantBonus: 200, date: T }, { program: Object.assign({}, PROG, { bonusOnPromo: true }), person: g, promo: BD, balance: 500 });
    assert.strictEqual(all.bonusUsed, 200, 'настройка программы «бонусы в любой акции»');
});

test('акция ко дню рождения действует 3 дня до и после, через границу года тоже', () => {
    assert.strictEqual(C.promoApplies(BD, '2026-11-26', '1991-11-28'), true);
    assert.strictEqual(C.promoApplies(BD, '2026-11-20', '1991-11-28'), false);
    assert.strictEqual(C.promoApplies(BD, '2026-12-30', '1990-01-01'), true);
    assert.strictEqual(C.promoApplies(BD, '2026-11-26', ''), false);
    assert.strictEqual(C.promoApplies(PUMPKIN, '2026-12-01', ''), false);
});

test('N-я в подарок: штампы переходят между чеками, подарок вычитается, бонусы не начисляются; опции не считаются', () => {
    const r = C.calcCheck({ sum: 750, drinks: 3, date: T }, { program: PROG, balance: 0, stamps: 4, mech: 'nth' });
    assert.deepStrictEqual([r.gifts, r.gift, r.toPay, r.accrue, r.stampsAfter], [1, 220, 530, 0, 1]);
    const none = C.calcCheck({ sum: 500, drinks: 1, date: T }, { program: PROG, stamps: 3, mech: 'nth' });
    assert.strictEqual(none.gifts, 0);
    const opt = C.calcCheck({ sum: 500, date: T }, { program: PROG, mech: 'prepaid' });
    assert.strictEqual(opt.option, true);
    assert.strictEqual(C.mechKey('Предзаказ ко времени'), 'preorder');
    assert.strictEqual(C.isBuilt('preorder'), false);
});

test('аудит чеков: найдены только чеки со списанием в акции без бонусов', () => {
    const by = { [BD.name]: BD, [PUMPKIN.name]: PUMPKIN };
    const list = [{ num: 1, promo: BD.name, paidBonus: 50 }, { num: 2, promo: BD.name, paidBonus: 0 }, { num: 3, promo: PUMPKIN.name, paidBonus: 80 }, { num: 4, promo: '', paidBonus: 80 }];
    assert.deepStrictEqual(C.checkConflicts(list, by, PROG).map(c => c.num), [1]);
});

test('RFM: частый гость, переставший ходить, - под угрозой; свежий - новичок; давний - потерянный', () => {
    assert.strictEqual(C.rfm({ last: '2026-11-24', first: '2026-07-01', visits90: 30, sum90: 16000 }, T).segment, 'Чемпион');
    const risk = C.rfm({ last: '2026-10-14', first: '2026-07-02', visits90: 14, sum90: 8000 }, T);
    assert.deepStrictEqual([risk.segment, risk.R, risk.days], ['Под угрозой ухода', 2, 43]);
    assert.strictEqual(C.rfm({ last: '2026-11-20', first: '2026-11-10', visits90: 2, sum90: 900 }, T).segment, 'Новичок');
    assert.strictEqual(C.rfm({ last: '2026-08-10', first: '2026-07-01', visits90: 0, sum90: 0 }, T).segment, 'Потерянный');
    assert.strictEqual(C.rfm({ last: '2026-10-14', first: '2026-07-02', visits90: 14, sum90: 8000 }, T, 60).segment, 'Лояльный', 'порог ухода - настройка');
});

test('кому написать: без согласия не попадает, под угрозой со сгоранием - первым, день рождения учитывается', () => {
    const list = C.whomToWrite([
        { name: 'А', consent: true, segment: 'Под угрозой ухода', days: 43, balance: 500, expiring14: 159, birthday: '1991-11-28', sum90: 8000 },
        { name: 'Б', consent: false, segment: 'Под угрозой ухода', days: 50, balance: 900, expiring14: 300, sum90: 9000 },
        { name: 'В', consent: true, segment: 'Спящий', days: 40, balance: 120, expiring14: 0, sum90: 600 },
        { name: 'Г', consent: true, segment: 'Чемпион', days: 2, balance: 0, expiring14: 0, birthday: '1980-06-01' }], T);
    assert.deepStrictEqual(list.map(x => x.name), ['А', 'В']);
    assert.ok(list[0].why.some(w => /день рождения через 2/.test(w)));
});

test('кампания: эффект против контрольной группы, без контроля эффект не заявляется', () => {
    const u = C.uplift({ sent: 42, back: 15, control: 10, controlBack: 2 });
    assert.deepStrictEqual([u.conv, u.base, u.pp, u.extra, u.effective], [35.7, 20, 15.7, 7, true]);
    assert.strictEqual(C.uplift({ sent: 64, back: 43, control: 16, controlBack: 11 }).effective, false);
    assert.strictEqual(C.uplift({ sent: 70, back: 4, control: 0, controlBack: 0 }).noControl, true);
});

test('обязательства: живые партии по месяцам сгорания и точкам, сгоревшее не считается', () => {
    const g1 = C.lots([acc('2026-09-01', 80), acc('2026-11-01', 40), acc('2026-08-01', 30)], T);
    const g2 = C.lots([acc('2026-10-20', 100), { date: '2026-11-01', bonus: -60 }], T);
    const L = C.liabilities({ a: { lots: g1.lots, point: 'Покровка' }, b: { lots: g2.lots, point: 'Сормово' } }, T, 1);
    assert.deepStrictEqual([L.total, L.guests, L.d14, L.d30], [160, 2, 80, 80]);
    assert.deepStrictEqual(L.months.map(m => [m.month, m.bonus]), [['2026-11', 80], ['2027-01', 80]]);
    assert.deepStrictEqual(L.points.map(p => [p.point, p.bonus]), [['Покровка', 120], ['Сормово', 40]]);
});

test('ручная операция: без причины не проводится, списание не больше баланса, сверх порога - предупреждение', () => {
    assert.strictEqual(C.checkManual({ manual: true, bonus: 100, reason: '' }, 0, PROG).ok, false);
    assert.strictEqual(C.checkManual({ manual: true, bonus: 100, reason: 'ок' }, 0, PROG).ok, false);
    assert.strictEqual(C.checkManual({ manual: true, bonus: -200, reason: 'Возврат чека' }, 150, PROG).ok, false);
    const big = C.checkManual({ manual: true, bonus: 500, reason: 'Компенсация за сорванный заказ' }, 0, PROG);
    assert.deepStrictEqual([big.ok, big.warnings.length], [true, 1]);
});

test('подозрительные ручные: нет причины, сверх порога, серия одного автора одному гостю', () => {
    const m = (date, bonus, reason, author, guest) => ({ manual: true, date, bonus, reason, author: author || 'k1', guest: guest || 'Г' });
    const ops = [m('2026-11-06', 450, 'по просьбе'), m('2026-11-12', 100, 'Ошибка кассы'), m('2026-11-19', 100, 'Ошибка кассы'), m('2026-11-24', 100, 'Ошибка кассы'),
        m('2026-11-10', 120, 'Компенсация', 'k2', 'Д'), m('2026-11-11', 80, '', 'k2', 'Д'), { manual: false, date: '2026-11-20', bonus: 900, reason: '' }];
    const s = C.suspicious(ops, T, PROG);
    assert.strictEqual(s.length, 5, 'четыре операции серии k1 и одна без причины');
    assert.ok(s.find(x => x.bonus === 450).why.includes('больше 300'));
    assert.ok(s.find(x => x.author === 'k2').why.includes('нет причины'));
    assert.ok(!s.find(x => x.reason === 'Компенсация'));
});

test('CSV: точка с запятой и кавычки экранируются', () => {
    assert.strictEqual(C.toCsv([{ a: 'x;y', b: 'он "сказал"' }], [['a', 'A'], ['b', 'B']]), 'A;B\r\n"x;y";"он ""сказал"""');
});
