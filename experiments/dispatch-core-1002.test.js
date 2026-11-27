// rules: none (defect #5752)
// Диспетчеризация и холодовая цепь (демо-копия, ideav/backlogram#1002): классификация отклонения с допуском на дверь,
// маршрут тревоги по графику дежурств и эскалация, партии в зоне, проверка акта, журнал для проверки.
// Run with: node experiments/dispatch-core-1002.test.js
const test = require('node:test');
const assert = require('node:assert');
const C = require('../download/dispatch/js/dispatch-core.js');

const NOW = C.stamp('2026-11-26', '10:40');
const fridge = { min: 2, max: 8, warn: 1, door: 10, delay: 15, react: 15, escalate: 15 };
const dev = (peak, minutes, door, date, time) => ({ peak, minutes, door: !!door, date: date || '2026-11-26', time: time || '10:00', zone: 'А3-Х', sensor: 'Т-А3-1' });
const duties = [
    { date: '25.11.2026', shift: 'Ночная', line: '1', emp: 'Ночной диспетчер' },
    { date: '25.11.2026', shift: 'Ночная', line: '2', emp: 'Ночной инженер' },
    { date: '26.11.2026', shift: 'Дневная', line: '1', emp: 'Дневной диспетчер' },
    { date: '26.11.2026', shift: 'Дневная', line: '2', emp: 'Дневной инженер' }];
const pharmacy = { name: 'Аптека №3', hours: '08:00-21:00', resp: 'Заведующая' };

test('время: отметка, обратный разбор, длительность словами', () => {
    assert.strictEqual(C.stamp('26.11.2026', '10:40') - C.stamp('2026-11-26', '10:05'), 35);
    assert.deepStrictEqual(C.fromStamp(C.stamp('2026-11-25', '23:50') + 20), { date: '2026-11-26', time: '00:10' });
    assert.strictEqual(C.durText(135), '2 ч 15 мин');
});

test('классификация: открытая дверь в пределах допуска не тревога, дольше допуска - тревога', () => {
    assert.strictEqual(C.classify(dev(9.4, 7, true), fridge), 'Открытая дверь', 'приёмка товара, дверь 7 мин');
    assert.strictEqual(C.classify(dev(9.4, 12, true), fridge), 'Предупреждение', 'дверь дольше допуска, но короче времени до тревоги');
    assert.strictEqual(C.classify(dev(9.6, 48, false), fridge), 'Тревога');
    assert.strictEqual(C.classify(dev(9.6, 48, true), fridge), 'Тревога', 'дверь не оправдывает 48 минут');
    assert.strictEqual(C.classify(dev(1.2, 20, false), fridge), 'Тревога', 'ниже нижней границы - тоже тревога');
    assert.strictEqual(C.classify(dev(7.4, 30, false), fridge), 'Предупреждение', 'за 1 °C до границы');
    assert.strictEqual(C.classify(dev(6.5, 30, false), fridge), 'Норма');
    assert.strictEqual(C.classify(dev(8, 30, false), fridge), 'Предупреждение', 'ровно граница - в границах, но у края');
    assert.strictEqual(C.classify(dev(9.4, 7, true), fridge, { door: 0 }), 'Предупреждение', 'без допуска дверь даёт предупреждение');
});

test('прогон режима: допуск на дверь снимает шум приёмки, тревоги остаются', () => {
    const devs = [dev(9.1, 5, true), dev(9.3, 8, true), dev(10.2, 6, true), dev(9.6, 48, false), dev(7.5, 20, false)];
    assert.deepStrictEqual(C.replay(devs, fridge), { 'Норма': 0, 'Открытая дверь': 3, 'Предупреждение': 1, 'Тревога': 1 });
    assert.deepStrictEqual(C.replay(devs, fridge, { door: 0 }), { 'Норма': 0, 'Открытая дверь': 0, 'Предупреждение': 4, 'Тревога': 1 });
    assert.deepStrictEqual(C.replay(devs, fridge, { door: 0, delay: 0 }), { 'Норма': 0, 'Открытая дверь': 0, 'Предупреждение': 1, 'Тревога': 4 });
});

test('маршрут: днём первой - заведующая, ночью - диспетчер; без дежурных цепочка пустая', () => {
    assert.deepStrictEqual(C.route(pharmacy, duties, '2026-11-26', '10:20', 'Руководитель').map(c => c.who), ['Заведующая', 'Дневной диспетчер', 'Дневной инженер', 'Руководитель']);
    assert.deepStrictEqual(C.route(pharmacy, duties, '2026-11-26', '03:12', 'Руководитель').map(c => c.who), ['Ночной диспетчер', 'Ночной инженер', 'Руководитель'], 'ночью заведующей не звоним');
    assert.deepStrictEqual(C.route({ name: 'Р-02', hours: '' }, [], '2026-11-26', '03:12', '').length, 0);
    assert.ok(C.isOpenHours('20:00-08:00', '23:00') && C.isOpenHours('20:00-08:00', '07:59') && !C.isOpenHours('20:00-08:00', '08:00'));
});

test('эскалация: без принятия тревога переходит по цепочке каждые 15 минут', () => {
    const chain = C.route(pharmacy, duties, '2026-11-26', '10:20', 'Руководитель');
    const a = { date: '2026-11-26', time: '10:20', status: 'Новая', acceptTime: '' };
    let e = C.escalation(a, fridge, chain, C.stamp('2026-11-26', '10:30'));
    assert.strictEqual(e.level, 0); assert.strictEqual(e.who, 'Заведующая'); assert.strictEqual(e.state, 'soon'); assert.strictEqual(e.nextWho, 'Дневной диспетчер');
    e = C.escalation(a, fridge, chain, NOW);
    assert.strictEqual(e.level, 1); assert.strictEqual(e.who, 'Дневной диспетчер'); assert.strictEqual(e.state, 'overdue'); assert.strictEqual(e.left, -5);
    e = C.escalation(a, fridge, chain, C.stamp('2026-11-26', '13:00'));
    assert.strictEqual(e.who, 'Руководитель', 'дальше последнего звена не уходит'); assert.strictEqual(e.nextAt, null);
    const acc = C.escalation(Object.assign({}, a, { acceptTime: '10:44', resp: 'Дневной диспетчер' }), fridge, chain, NOW);
    assert.strictEqual(acc.state, 'late'); assert.strictEqual(acc.took, 24); assert.strictEqual(acc.level, 1);
    const night = C.escalation({ date: '2026-11-25', time: '23:50', acceptTime: '00:02' }, fridge, chain, NOW);
    assert.strictEqual(night.took, 12, 'принята после полуночи'); assert.strictEqual(night.state, 'accepted');
    assert.ok(C.escalation(a, fridge, [], NOW).noOne, 'нет ни одного звена - тревога без ответственного');
});

test('статус объекта и партии в зоне на момент отклонения', () => {
    const alarms = [{ obj: 'Аптека №3', cls: 'Предупреждение', status: 'Закрыта' }, { obj: 'Аптека №3', cls: 'Тревога', status: 'Новая' }, { obj: 'Склад', cls: 'Предупреждение', status: 'Принята' }];
    assert.strictEqual(C.objectState('Аптека №3', alarms).state, 'Тревога');
    assert.strictEqual(C.objectState('Склад', alarms).state, 'Предупреждение');
    assert.strictEqual(C.objectState('Р-02', alarms).state, 'Норма');
    const b = [{ name: 'P1', zone: 'А3-Х', inDate: '2026-11-20', outDate: '' }, { name: 'P2', zone: 'А3-Х', inDate: '2026-11-26', outDate: '' },
        { name: 'P3', zone: 'А3-Х', inDate: '2026-11-01', outDate: '2026-11-25' }, { name: 'P4', zone: 'СК-Х', inDate: '2026-11-01', outDate: '' }];
    assert.deepStrictEqual(C.batchesAt(b, 'А3-Х', '2026-11-26', '10:05').map(x => x.name), ['P1', 'P2']);
    assert.deepStrictEqual(C.batchesAt(b, 'А3-Х', '2026-11-25', '12:00').map(x => x.name), ['P1', 'P3']);
});

test('акт: без причины и без решения по каждой партии не утверждается', () => {
    const batches = [{ name: 'P1', drug: 'Инсулин' }, { name: 'P2', drug: 'Вакцина' }];
    assert.deepStrictEqual(C.actErrors({ cause: '' }, batches, [{ batch: 'P1', decision: 'Карантин до оценки производителя' }]),
        ['Укажите причину отклонения.', 'Нет решения по партии P2 (Вакцина).']);
    assert.deepStrictEqual(C.actErrors({ cause: 'Отказ компрессора' }, batches, [{ batch: 'P1', decision: 'Годна' }, { batch: 'P2', decision: 'Выкинуть' }]), ['Решение «Выкинуть» не из справочника.']);
    assert.deepStrictEqual(C.actErrors({ cause: 'Отказ компрессора' }, batches, [{ batch: 'P1', decision: 'Годна' }, { batch: 'P2', decision: 'Списание' }]), []);
});

test('журнал: период, реакция, тревоги без утверждённого акта', () => {
    const alarms = [
        { code: 'ТР-1', cls: 'Тревога', date: '2026-11-05', time: '03:10', acceptTime: '03:40', status: 'Закрыта' },
        { code: 'ТР-2', cls: 'Предупреждение', date: '2026-11-10', time: '12:00', acceptTime: '12:05', status: 'Закрыта' },
        { code: 'ТР-3', cls: 'Тревога', date: '2026-11-26', time: '10:20', acceptTime: '', status: 'Новая' },
        { code: 'ТР-0', cls: 'Тревога', date: '2026-10-30', time: '10:00', acceptTime: '10:01', status: 'Закрыта' }];
    const acts = [{ alarm: 'ТР-1', status: 'Утверждён' }];
    const j = C.journal(alarms, acts, () => fridge, '2026-11-01', '2026-11-30');
    assert.strictEqual(j.total, 3); assert.strictEqual(j.alarms, 2); assert.strictEqual(j.withAct, 1); assert.strictEqual(j.noAct, 1);
    assert.strictEqual(j.late, 2, 'ТР-1 принята за 30 мин при сроке 15, ТР-3 не принята');
    assert.strictEqual(j.medianTook, 5);
    assert.deepStrictEqual(j.rows.map(r => r.alarm.code), ['ТР-1', 'ТР-2', 'ТР-3']);
});

test('шлюз: отклонение -> тревога с моментом срабатывания и первым звеном маршрута; дверь в допуске - без тревоги', () => {
    const ctx = { modeOfZone: () => fridge, objOfZone: () => pharmacy, duties, head: 'Руководитель', codes: ['ТР-0041'] };
    const r = C.processDeviation(dev(9.6, 20, false, '2026-11-26', '10:05'), ctx);
    assert.strictEqual(r.cls, 'Тревога'); assert.strictEqual(r.alarm.code, 'ТР-0042');
    assert.strictEqual(r.alarm.time, '10:20', 'срабатывание = начало + время до тревоги'); assert.strictEqual(r.alarm.resp, 'Заведующая');
    assert.strictEqual(C.processDeviation(dev(9.4, 6, true), ctx).alarm, null);
    assert.strictEqual(C.processDeviation(dev(9.4, 6, true), Object.assign({}, ctx, { modeOfZone: () => null })), null);
});
