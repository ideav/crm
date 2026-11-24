// rules: none (defect #5689)
// FSM (демо-копия, ideav/crm#5689): настраиваемые опции демо - на каждую опцию проверка «при значении X расчёт даёт Y».
const test = require('node:test');
const assert = require('node:assert');
const C = require('../download/fsm/js/fsm-core.js');

const T = (s) => C.parseDt(s);
const NOW = T('2026-11-23 11:05');
const O = (over) => C.parseOpts(Object.entries(over || {}).map(([code, value]) => ({ code, value: String(value) })));

function ctx(opts, extra) {
    const eng = (name, o) => Object.assign({ name, works: true, from: '08:00', to: '17:00', max: 6, district: 'Вахитовский', lat: 55.789, lon: 49.122, skills: [{ skill: 'Хладагент', until: '' }] }, o || {});
    return Object.assign({
        now: NOW, orders: [], opts: opts,
        objects: { 'Объект А': { lat: 55.795, lon: 49.13, district: 'Вахитовский' } },
        works: { 'Ремонт': { skill: 'Хладагент', norm: 2 } },
        engineers: [eng('Близкий'), eng('Далёкий', { lat: 55.852, lon: 49.088, district: 'Авиастроительный' }), eng('Без навыка', { skills: [{ skill: 'Высота', until: '' }] }),
            eng('Допуск истёк', { skills: [{ skill: 'Хладагент', until: '2026-10-31' }] }), eng('Допуск на исходе', { skills: [{ skill: 'Хладагент', until: '2026-12-10' }] })]
    }, extra || {});
}
const order = { id: 'o1', num: 'Н-1', obj: 'Объект А', wt: 'Ремонт', created: T('2026-11-23 10:30'), win0: T('2026-11-23 12:00'), win1: T('2026-11-23 14:00') };
const by = (r) => { const m = {}; r.forEach((x) => { m[x.eng] = x; }); return m; };

test('настройки: разбор значений, границы и значения по умолчанию', () => {
    const d = O();
    assert.strictEqual(d['pick.w_km'], 2.5);
    assert.strictEqual(d['pick.ban_skill'], true);
    assert.strictEqual(d['act.sign_mode'], 'screen');
    assert.strictEqual(O({ 'pick.w_km': '3,5' })['pick.w_km'], 3.5, 'запятая принимается');
    assert.strictEqual(O({ 'dist.coef': 99 })['dist.coef'], 3, 'число ограничивается максимумом');
    assert.strictEqual(O({ 'dist.coef': 'abc' })['dist.coef'], 1.3, 'не число - значение по умолчанию');
    assert.strictEqual(O({ 'pick.ban_skill': '0' })['pick.ban_skill'], false);
    assert.strictEqual(O({ 'act.sign_mode': 'pigeon' })['act.sign_mode'], 'screen', 'неизвестный вариант - по умолчанию');
    C.OPT_DEFS.forEach((o) => assert.deepStrictEqual(C.parseOpt(o, C.optToStr(o, o.def)), o.def, o.code));
});

test('подбор: вес километра меняет разрыв между близким и далёким', () => {
    const gap = (w) => { const m = by(C.rankEngineers(order, ctx(O({ 'pick.w_km': w, 'pick.w_district': 0 })))); return m['Близкий'].score - m['Далёкий'].score; };
    assert.strictEqual(gap(0), 0, 'при весе 0 расстояние не влияет');
    assert.ok(gap(2.5) > 0 && gap(10) > gap(2.5) * 3.9);
});

test('подбор: вес нагрузки уводит наряд от занятого инженера', () => {
    const busy = [{ id: 'b', num: 'Н-2', eng: 'Близкий', status: 'Назначен', win0: T('2026-11-23 08:00'), win1: T('2026-11-23 09:00'), created: T('2026-11-23 07:00') }];
    const first = (w) => C.rankEngineers(order, ctx(O({ 'pick.w_load': w, 'pick.w_km': 0.5 }), { orders: busy })).filter((x) => x.ok)[0].eng;
    assert.strictEqual(first(0), 'Близкий');
    assert.notStrictEqual(first(30), 'Близкий', 'при большом весе наряд уходит не к занятому');
});

test('подбор: бонус района и штраф за скорый конец допуска берутся из настроек', () => {
    const noBonus = by(C.rankEngineers(order, ctx(O({ 'pick.w_district': 0 }))));
    const bonus = by(C.rankEngineers(order, ctx(O({ 'pick.w_district': 20 }))));
    assert.strictEqual(C.round2(bonus['Близкий'].score - noBonus['Близкий'].score), 20);
    assert.strictEqual(bonus['Далёкий'].score, noBonus['Далёкий'].score);
    const soon = (w, days) => by(C.rankEngineers(order, ctx(O({ 'pick.w_expiring': w, 'pick.expiring_days': days }))))['Допуск на исходе'].score;
    assert.strictEqual(C.round2(soon(0, 30) - soon(15, 30)), 15);
    assert.strictEqual(soon(15, 7), soon(0, 7), 'допуск до 10.12 не «скоро истекает» при окне 7 дней');
});

test('подбор: запрет «нет навыка» включается и выключается', () => {
    const on = by(C.rankEngineers(order, ctx(O())))['Без навыка'];
    assert.ok(!on.ok && /нет навыка/.test(on.blockers[0]));
    const off = by(C.rankEngineers(order, ctx(O({ 'pick.ban_skill': 0, 'pick.w_soft': 30 }))))['Без навыка'];
    assert.ok(off.ok && !off.blockers.length);
    assert.ok(off.reasons.some((r) => /нет навыка/.test(r.s) && r.t === 'warn'), 'нарушение остаётся видимым предупреждением');
    const base = by(C.rankEngineers(order, ctx(O({ 'pick.ban_skill': 0, 'pick.w_soft': 0 }))))['Без навыка'];
    assert.strictEqual(C.round2(base.score - off.score), 30, 'штраф = pick.w_soft');
});

test('подбор: запрет «допуск истёк» включается и выключается', () => {
    assert.ok(!by(C.rankEngineers(order, ctx(O())))['Допуск истёк'].ok);
    const off = by(C.rankEngineers(order, ctx(O({ 'pick.ban_permit': 0 }))))['Допуск истёк'];
    assert.ok(off.ok);
    assert.ok(off.reasons.some((r) => /истёк/.test(r.s)));
});

test('подбор: лимит нарядов - по карточке, общий и как не-запрет', () => {
    const mk = (n) => { const l = []; for (let i = 0; i < n; i++) l.push({ id: 'x' + i, num: 'Н-' + i, eng: 'Близкий', status: 'Назначен', win0: T('2026-11-23 08:00'), win1: T('2026-11-23 08:30'), created: T('2026-11-23 07:00') }); return l; };
    const near = (o, orders) => by(C.rankEngineers(order, ctx(o, { orders })))['Близкий'];
    assert.ok(near(O(), mk(2)).ok, '2 наряда при лимите карточки 6 - можно');
    assert.ok(!near(O({ 'pick.max_orders': 2 }), mk(2)).ok, 'общий лимит 2 заменяет лимит карточки');
    assert.strictEqual(near(O({ 'pick.max_orders': 2 }), mk(2)).max, 2);
    assert.ok(!near(O(), mk(6)).ok);
    assert.ok(near(O({ 'pick.ban_load': 0 }), mk(6)).ok, 'при выключенном запрете лимит лишь предупреждает');
});

test('подбор: запрет по расстоянию (0 - выключен)', () => {
    const far = by(C.rankEngineers(order, ctx(O())))['Далёкий'];
    assert.ok(far.ok && far.km > 5);
    const lim = by(C.rankEngineers(order, ctx(O({ 'pick.max_km': 5 }))));
    assert.ok(!lim['Далёкий'].ok && /дальше 5,0 км/.test(lim['Далёкий'].blockers[0]));
    assert.ok(lim['Близкий'].ok, 'близкий в пределах границы');
});

test('расстояние: коэффициент, скорость и способ «по дорогам» без геокодера', () => {
    const k = (opts) => C.distKm(O(opts), 55.789, 49.122, 55.852, 49.088).km;
    assert.ok(Math.abs(k({ 'dist.coef': 2 }) / k({ 'dist.coef': 1 }) - 2) < 1e-9);
    assert.ok(Math.abs(k({}) / k({ 'dist.coef': 1 }) - 1.3) < 1e-9, 'по умолчанию 1,3');
    assert.strictEqual(C.distKm(O(), 55.789, 49.122, 55.852, 49.088).method, 'straight');
    const road = C.distKm(O({ 'dist.method': 'road' }), 55.789, 49.122, 55.852, 49.088);
    assert.strictEqual(road.method, 'road-fallback');
    assert.strictEqual(road.km, k({}), 'геокодер не подключён - расчёт по прямой');
    assert.ok(C.distTime(O({ 'dist.speed': 60 }), 30) < C.distTime(O({ 'dist.speed': 20 }), 30));
    const r = by(C.rankEngineers(order, ctx(O({ 'dist.coef': 2 }))))['Далёкий'], r1 = by(C.rankEngineers(order, ctx(O({ 'dist.coef': 1 }))))['Далёкий'];
    assert.ok(r.km > r1.km * 1.9, 'подбор использует коэффициент');
});

test('SLA планового ТО: конец окна или N часов от начала окна', () => {
    const to = { prio: 'Плановое ТО', win0: T('2026-11-24 09:00'), win1: T('2026-11-24 11:00'), arrDue: T('2026-11-24 11:00'), finDue: T('2026-11-24 15:00') };
    assert.deepStrictEqual(C.orderDue(to, O()), { arrDue: T('2026-11-24 11:00'), finDue: T('2026-11-24 15:00') }, 'по умолчанию - как в данных');
    assert.deepStrictEqual(C.orderDue(to, O({ 'sla.to_mode': 'hours', 'sla.to_hours': 1 })), { arrDue: T('2026-11-24 10:00'), finDue: T('2026-11-24 14:00') });
    assert.deepStrictEqual(C.orderDue(to, O({ 'sla.to_mode': 'hours', 'sla.to_hours': 6, 'sla.to_finish_hours': 2 })), { arrDue: T('2026-11-24 15:00'), finDue: T('2026-11-24 17:00') });
    const urgent = { prio: 'Срочный', win0: to.win0, win1: to.win1, arrDue: T('2026-11-24 10:00'), finDue: T('2026-11-24 12:00') };
    assert.deepStrictEqual(C.orderDue(urgent, O({ 'sla.to_mode': 'hours', 'sla.to_hours': 1 })), { arrDue: urgent.arrDue, finDue: urgent.finDue }, 'правило касается только планового ТО');
});

test('SLA: порог «под угрозой» берётся из настроек', () => {
    const o = { status: 'Назначен', arr: 0, fin: 0, arrDue: NOW + 45 * C.MIN, finDue: NOW + 9 * C.HOUR };
    assert.strictEqual(C.slaState(o, NOW, O()).state, 'ok');
    assert.strictEqual(C.slaState(o, NOW, O({ 'sla.risk_min': 60 })).state, 'risk');
});

test('гарантийный наряд: сумма 0 или по прайсу', () => {
    const mats = [{ name: 'Фреон', qty: 1, price: 1000 }];
    assert.strictEqual(C.actTotals({ price: 2000 }, mats, true, O()).total, 0);
    assert.strictEqual(C.actTotals({ price: 2000 }, mats, true, O({ 'warranty.mode': 'price' })).total, 3000);
    assert.strictEqual(C.actTotals({ price: 2000 }, mats, false, O()).total, 3000, 'не гарантийный наряд не меняется');
    assert.strictEqual(C.payable(O(), 500, true), 0);
    assert.strictEqual(C.payable(O({ 'warranty.mode': 'price' }), 500, true), 500);
});

test('склад в машине: списание при акте или при закрытии наряда', () => {
    const stock = [{ id: 's1', name: 'Фреон', qty: 2, min: 1 }, { id: 's2', name: 'Плата', qty: 3, min: 1 }];
    const mats = [{ name: 'Фреон', qty: 0.5, src: 'Склад в машине' }, { name: 'Плата', qty: 1, src: 'Заказ поставщику' }];
    const actPlan = C.writeoffPlan(O(), 'act', stock, mats);
    assert.deepStrictEqual(actPlan.map((p) => [p.id, p.qty]), [['s1', 1.5]], 'по умолчанию - при акте, чужой источник не списывается');
    assert.deepStrictEqual(C.writeoffPlan(O(), 'close', stock, mats), [], 'при акте закрытие ничего не списывает');
    const close = O({ 'stock.writeoff': 'close' });
    assert.deepStrictEqual(C.writeoffPlan(close, 'act', stock, mats), [], 'в режиме «при закрытии» акт склад не трогает');
    assert.deepStrictEqual(C.writeoffPlan(close, 'close', stock, mats).map((p) => [p.id, p.qty]), [['s1', 1.5]]);
});

test('подпись акта: на экране требует подпись, код из СМС - верный код', () => {
    assert.deepStrictEqual([C.signPlan(O()).mode, C.signPlan(O()).ink, C.signPlan(O()).code], ['screen', true, false]);
    assert.deepStrictEqual([C.signPlan(O({ 'act.sign_mode': 'sms' })).mode, C.signPlan(O({ 'act.sign_mode': 'sms' })).ink, C.signPlan(O({ 'act.sign_mode': 'sms' })).code], ['sms', false, true]);
    assert.ok(!C.signCheck(O(), { signer: 'Иванов', ink: false }).ok);
    assert.ok(C.signCheck(O(), { signer: 'Иванов', ink: true }).ok);
    assert.ok(!C.signCheck(O(), { signer: '', ink: true }).ok);
    const sms = O({ 'act.sign_mode': 'sms' });
    assert.ok(!C.signCheck(sms, { signer: 'Иванов', ink: true }).ok, 'рисунок подписи в режиме СМС не заменяет код');
    assert.strictEqual(C.signCheck(sms, { signer: 'Иванов', code: '1234', sentCode: '' }).why, 'Сначала отправьте код клиенту');
    assert.strictEqual(C.signCheck(sms, { signer: 'Иванов', code: '1111', sentCode: '1234' }).why, 'Код не совпадает');
    assert.ok(C.signCheck(sms, { signer: 'Иванов', code: '1234', sentCode: '1234' }).ok);
});
