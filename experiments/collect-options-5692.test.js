// rules: none (defect #5692)
// Взыскание дебиторки, настраиваемые опции демо (ideav/crm#5692): при значении опции X расчёт даёт Y.
const test = require('node:test');
const assert = require('node:assert');
const C = require('../download/collect/js/collect-core.js');

const STAGES = [
    { code: 'restructuring', name: 'Реструктуризация', from: 0 }, { code: 'before', name: 'До срока', from: 0 }, { code: 'remind', name: 'Напоминание', from: 1 }, { code: 'call', name: 'Звонок', from: 8 },
    { code: 'stop', name: 'Стоп-отгрузка', from: 15 }, { code: 'claim', name: 'Претензия', from: 31 }, { code: 'court', name: 'Суд', from: 61 }
];
const RULES = { stopDays: 15, stopSum: 300000, byLimit: true };
const plain = { limit: 0, key: false };
const stop = (client, m, extra) => C.stopDecision(client, m, Object.assign({}, RULES, extra || {})).stop;

test('стоп: «с N-го дня» смотрит только на срок', () => {
    assert.strictEqual(stop(plain, { maxDays: 20, overdue: 1000, debt: 1000 }, { mode: 'days' }), true);
    assert.strictEqual(stop(plain, { maxDays: 10, overdue: 900000, debt: 900000 }, { mode: 'days' }), false);
});

test('стоп: «от суммы» смотрит только на размер просрочки', () => {
    assert.strictEqual(stop(plain, { maxDays: 3, overdue: 300000, debt: 300000 }, { mode: 'sum' }), true);
    assert.strictEqual(stop(plain, { maxDays: 40, overdue: 100000, debt: 100000 }, { mode: 'sum' }), false);
});

test('стоп: «день или сумма» достаточно одного порога, «и день, и сумма» нужны оба', () => {
    const old = { maxDays: 20, overdue: 100000, debt: 100000 }, big = { maxDays: 20, overdue: 400000, debt: 400000 };
    assert.strictEqual(stop(plain, old, { mode: 'either' }), true);
    assert.strictEqual(stop(plain, old, { mode: 'both' }), false);
    assert.strictEqual(stop(plain, big, { mode: 'both' }), true);
    const r = C.stopDecision(plain, big, Object.assign({}, RULES, { mode: 'both' }));
    assert.strictEqual(r.reasons.length, 2);
});

test('стоп: «по лимиту клиента» работает только по лимиту, даже если флаг лимита в правилах выключен', () => {
    const over = { limit: 500000, key: false }, m = { maxDays: 90, overdue: 900000, debt: 600000 };
    assert.strictEqual(stop(over, m, { mode: 'limit', byLimit: false }), true);
    assert.strictEqual(stop({ limit: 700000, key: false }, m, { mode: 'limit' }), false);
    assert.strictEqual(stop(over, { maxDays: 1, overdue: 10, debt: 600000 }, { mode: 'days' }), false);
});

test('стоп: без опции действует прежнее правило «любое из трёх»', () => {
    assert.strictEqual(stop(plain, { maxDays: 20, overdue: 1, debt: 1 }), true);
    assert.strictEqual(stop({ limit: 100, key: false }, { maxDays: 1, overdue: 1, debt: 500 }), true);
    assert.strictEqual(stop({ limit: 100, key: false }, { maxDays: 1, overdue: 1, debt: 500 }, { byLimit: false }), false);
});

test('ключевой клиент: «решает директор» не ставит стоп сам, «стоп как у всех» ставит', () => {
    const key = { limit: 0, key: true }, m = { maxDays: 40, overdue: 100000, debt: 100000 };
    const d = C.stopDecision(key, m, Object.assign({}, RULES, { keyAuto: false }));
    assert.strictEqual(d.stop, false);
    assert.strictEqual(d.needDirector, true);
    const a = C.stopDecision(key, m, Object.assign({}, RULES, { keyAuto: true }));
    assert.strictEqual(a.stop, true);
    assert.strictEqual(a.needDirector, false);
});

test('профиль границ ступеней: свои дни не меняются, мягкий и жёсткий сдвигают границы', () => {
    const custom = C.applyStageProfile(STAGES, 'custom');
    assert.strictEqual(C.stageFor(14, custom).code, 'call');
    const soft = C.applyStageProfile(STAGES, 'soft');
    assert.strictEqual(C.stageFor(14, soft).code, 'remind');
    assert.strictEqual(C.stageFor(15, soft).code, 'call');
    assert.strictEqual(C.stageFor(45, soft).code, 'stop');
    assert.strictEqual(C.stageFor(95, soft).code, 'court');
    const strict = C.applyStageProfile(STAGES, 'strict');
    assert.strictEqual(C.stageFor(4, strict).code, 'call');
    assert.strictEqual(C.stageFor(8, strict).code, 'stop');
    assert.strictEqual(C.stageFor(15, strict).code, 'claim');
    assert.strictEqual(C.stageFor(31, strict).code, 'court');
    assert.strictEqual(STAGES.find(s => s.code === 'call').from, 8);
});

test('подписи диапазонов ступеней следуют за выбранным профилем', () => {
    assert.strictEqual(C.stageRange(STAGES, 'remind'), '1–7 дн.');
    assert.strictEqual(C.stageRange(STAGES, 'court'), '61+ дн.');
    const strict = C.applyStageProfile(STAGES, 'strict');
    assert.strictEqual(C.stageRange(strict, 'call'), '4–7 дн.');
    assert.strictEqual(C.stageRange(strict, 'stop'), '8–14 дн.');
});

test('что начислять в претензии: как в договоре, всегда неустойка, всегда ст. 395', () => {
    const doc = { id: 'd1', amount: 100000, due: '2026-03-01' };
    const rates = [{ from: '2026-01-01', rate: 10 }];
    const byContract395 = { basis: '395', rate: 0.1, cap: 0 }, byContractPenalty = { basis: 'contract', rate: 0.1, cap: 0 }, noRate = { basis: 'none', rate: 0, cap: 0 };
    const t = (k, policy) => C.penaltyFor(doc, [], '2026-03-10', k, rates, { policy }).total;
    assert.strictEqual(t(byContract395, 'by-contract'), C.round2(100000 * 0.1 * 9 / 365));
    assert.strictEqual(t(byContract395, 'penalty'), 900);
    assert.strictEqual(t(byContractPenalty, '395'), C.round2(100000 * 0.1 * 9 / 365));
    assert.strictEqual(t(byContractPenalty, 'by-contract'), 900);
    assert.strictEqual(t(noRate, 'by-contract'), 0);
    assert.strictEqual(t(noRate, 'penalty'), C.round2(100000 * 0.1 * 9 / 365));
    assert.strictEqual(C.effectiveBasis(noRate, undefined), 'none');
});

test('потолок неустойки: опция «не ограничивать» отключает потолок договора', () => {
    const doc = { id: 'd1', amount: 100000, due: '2026-03-01' }, k = { basis: 'contract', rate: 0.1, cap: 1 };
    assert.strictEqual(C.penaltyFor(doc, [], '2026-03-20', k, [], {}).total, 1000);
    assert.strictEqual(C.penaltyFor(doc, [], '2026-03-20', k, [], { capOff: true }).total, 1900);
});

test('дата «сегодня»: демо-дата или реальная; неверные значения заменяются значениями по умолчанию', () => {
    const d = C.settingsFrom({});
    assert.strictEqual(C.todayFor(d, '2027-05-05'), '2026-11-23');
    const real = C.settingsFrom({ 'today.mode': 'real', 'today.demo': '2026-11-23' });
    assert.strictEqual(C.todayFor(real, '2027-05-05'), '2027-05-05');
    const fixed = C.settingsFrom({ 'today.mode': 'demo', 'today.demo': '15.12.2026' });
    assert.strictEqual(C.todayFor(fixed, '2027-05-05'), '2026-12-15');
    const bad = C.settingsFrom({ 'today.mode': 'завтра', 'funnel.profile': 'x', 'stop.mode': '', 'claim.basis': 'z', 'today.demo': 'вчера' });
    assert.deepStrictEqual([bad.todayMode, bad.profile, bad.stopMode, bad.claimBasis, bad.todayDemo], ['demo', 'custom', 'any', 'by-contract', '2026-11-23']);
});

test('настройки: значения читаются в поля расчёта', () => {
    const s = C.settingsFrom({ 'funnel.profile': 'strict', 'stop.mode': 'both', 'stop.key': 'auto', 'claim.basis': '395', 'claim.cap': 'off' });
    assert.deepStrictEqual([s.profile, s.stopMode, s.keyAuto, s.claimBasis, s.capOff], ['strict', 'both', true, '395', true]);
    assert.strictEqual(C.settingsFrom({}).keyAuto, false);
    assert.strictEqual(C.settingsFrom({}).capOff, false);
});

test('ключевая ставка по истории cbr.ru: 14,5% до 21.06.2026, 14,25% с 22.06.2026', () => {
    const RATES = [['2025-12-22', 16], ['2026-02-16', 15.5], ['2026-03-23', 15], ['2026-04-27', 14.5], ['2026-06-22', 14.25], ['2026-07-27', 14]].map(([from, rate]) => ({ from, rate }));
    const r = C.interest395(100000, '2026-06-19', [], '2026-06-23', RATES);
    assert.deepStrictEqual(r.rows.map(x => [x.from, x.days, x.rate]), [['2026-06-20', 2, 14.5], ['2026-06-22', 2, 14.25]]);
    assert.strictEqual(r.total, 157.53);
    assert.strictEqual(C.rateAt(RATES, '2026-11-23'), 14);
});
