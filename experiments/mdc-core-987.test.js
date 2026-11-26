// rules: none (defect #5737)
// MDC (демо-копия, ideav/backlogram#987): смены и дежурный, правило порога и длительности, прогон правила по истории,
// срок реакции и эскалация, статус оборудования, сборка инцидента и заявки.
// Run with: node experiments/mdc-core-987.test.js
const test = require('node:test');
const assert = require('node:assert');
const C = require('../download/mdc/js/mdc-core.js');

const NOW = C.stamp('2026-11-26', '10:40');
const ruleT = { name: 'Перегрев камеры', param: 'Температура в камере', cond: '>', threshold: 60, minutes: 0, severity: 'Предупреждение', react: 15, escalate: 20, repair: false, unit: '°C' };
const ruleStop = { name: 'Стоит без кода', param: 'Остановка станка', cond: '>', threshold: 0, minutes: 15, severity: 'Предупреждение', react: 10, escalate: 15, repair: false };
const ruleOil = { name: 'Давление масла', param: 'Давление масла', cond: '<', threshold: 2.5, minutes: 1, severity: 'Авария', react: 5, escalate: 10, repair: true, unit: 'бар' };
const dev = (param, peak, minutes, date, time, sensor) => ({ param, peak, minutes, date: date || '2026-11-26', time: time || '10:00', sensor: sensor || 'S1' });

test('время: ЧЧ:ММ, отметка и обратный разбор, длительность словами', () => {
    assert.strictEqual(C.hm('09:53'), 593);
    assert.strictEqual(C.hm(''), null);
    assert.strictEqual(C.stamp('26.11.2026', '10:40') - C.stamp('2026-11-26', '09:53'), 47);
    assert.deepStrictEqual(C.fromStamp(C.stamp('2026-11-25', '23:50') + 20), { date: '2026-11-26', time: '00:10' });
    assert.strictEqual(C.durText(47), '47 мин');
    assert.strictEqual(C.durText(135), '2 ч 15 мин');
});

test('смена: ночная после полуночи относится к смене прошлого дня, дежурный ищется по участку', () => {
    assert.deepStrictEqual(C.shiftOf('2026-11-26', '10:00'), { date: '2026-11-26', shift: 'Дневная' });
    assert.deepStrictEqual(C.shiftOf('2026-11-26', '03:15'), { date: '2026-11-25', shift: 'Ночная' });
    assert.deepStrictEqual(C.shiftOf('2026-11-26', '20:00'), { date: '2026-11-26', shift: 'Ночная' });
    const duties = [
        { date: '25.11.2026', shift: 'Ночная', section: 'Механообработка', emp: 'Ночной' },
        { date: '26.11.2026', shift: 'Дневная', section: 'Механообработка', emp: 'Дневной' },
        { date: '26.11.2026', shift: 'Дневная', section: 'Сборка', emp: 'Другой участок' }];
    assert.strictEqual(C.onDuty(duties, 'Механообработка', '2026-11-26', '03:15'), 'Ночной');
    assert.strictEqual(C.onDuty(duties, 'Механообработка', '2026-11-26', '09:53'), 'Дневной');
    assert.strictEqual(C.onDuty(duties, 'Окраска', '2026-11-26', '09:53'), '');
});

test('правило: порог и длительность, условие «меньше», чужой параметр не срабатывает', () => {
    assert.ok(C.ruleMatches(ruleT, dev('Температура в камере', 61, 1)));
    assert.ok(!C.ruleMatches(ruleT, dev('Температура в камере', 60, 30)), 'ровно порог - не превышение');
    assert.ok(!C.ruleMatches(ruleT, dev('Температура в камере', 61, 1), { minutes: 10 }));
    assert.ok(C.ruleMatches(ruleOil, dev('Давление масла', 1.8, 3)));
    assert.ok(!C.ruleMatches(ruleOil, dev('Давление масла', 3.1, 30)));
    assert.ok(!C.ruleMatches(ruleT, dev('Вибрация', 99, 99)));
    assert.ok(!C.ruleMatches(ruleStop, dev('Остановка станка', 1, 12)), '12 минут остановки меньше 15');
});

test('выбор правила: из совпавших - самое строгое, выключенное не участвует', () => {
    const warn = Object.assign({}, ruleOil, { name: 'Давление низкое', threshold: 3, severity: 'Предупреждение', repair: false });
    assert.strictEqual(C.pickRule([warn, ruleOil], dev('Давление масла', 2.0, 2)).name, 'Давление масла');
    assert.strictEqual(C.pickRule([warn, ruleOil], dev('Давление масла', 2.8, 2)).name, 'Давление низкое');
    assert.strictEqual(C.pickRule([Object.assign({}, ruleOil, { active: false })], dev('Давление масла', 2.0, 2)), null);
});

test('прогон по истории: длительность 10 мин отсекает дребезг, настоящие перегревы остаются', () => {
    const devs = [];
    for (let i = 0; i < 40; i++) devs.push(dev('Температура в камере', 61 + (i % 3), 1 + (i % 3), '2026-11-2' + (i % 7)));
    devs.push(dev('Температура в камере', 68, 25, '2026-11-24'), dev('Температура в камере', 66, 14, '2026-11-25'));
    const d = C.noiseDelta(devs, ruleT, { minutes: 10 });
    assert.deepStrictEqual([d.before, d.after, d.removed, d.pct], [42, 2, 40, 95]);
    const r = C.replay(devs, ruleT, { threshold: 65, minutes: 0 }, 7);
    assert.strictEqual(r.count, 2);
    assert.strictEqual(r.byDay['2026-11-24'], 1);
});

test('срок реакции: в срок, вот-вот, просрочено с эскалацией, принят поздно, принят после полуночи', () => {
    const inc = (time, o) => Object.assign({ date: '2026-11-26', time, status: 'Новый', acceptTime: '' }, o || {});
    assert.strictEqual(C.reaction(inc('10:36'), ruleStop, NOW).state, 'ok');
    assert.strictEqual(C.reaction(inc('10:33'), ruleStop, NOW).state, 'soon');
    const late = C.reaction(inc('10:08'), ruleStop, NOW);
    assert.strictEqual(late.state, 'overdue');
    assert.strictEqual(late.left, -22);
    assert.strictEqual(late.escalated, true, 'срок 10:18 + эскалация 15 мин = 10:33, сейчас 10:40');
    assert.strictEqual(C.reaction(inc('10:20'), ruleStop, NOW).escalated, false);
    assert.strictEqual(C.reaction(inc('10:00', { acceptTime: '10:07', status: 'Принят' }), ruleStop, NOW).state, 'done');
    assert.strictEqual(C.reaction(inc('10:00', { acceptTime: '10:12', status: 'Принят' }), ruleStop, NOW).state, 'late');
    const night = C.reaction({ date: '2026-11-25', time: '23:55', acceptTime: '00:03', status: 'Принят' }, ruleStop, NOW);
    assert.strictEqual(night.took, 8);
});

test('статус оборудования: открытая авария сильнее статуса шлюза, закрытый инцидент не влияет', () => {
    const eq = { name: 'СТ-104', status: 'Работает' };
    const open = { eq: 'СТ-104', status: 'Новый', severity: 'Предупреждение', param: 'Остановка станка' };
    assert.strictEqual(C.equipmentState(eq, [open]).status, 'Простой');
    assert.strictEqual(C.equipmentState(eq, [open, { eq: 'СТ-104', status: 'Принят', severity: 'Авария', param: 'Давление масла' }]).status, 'Авария');
    assert.strictEqual(C.equipmentState(eq, [Object.assign({}, open, { status: 'Закрыт' })]).status, 'Работает');
    assert.strictEqual(C.equipmentState({ name: 'Х', status: 'Плановый простой' }, []).status, 'Плановый простой');
});

test('лента: просроченные сверху, закрытые вниз', () => {
    const by = { s: ruleStop };
    const list = [
        { code: 'A', rule: 's', date: '2026-11-26', time: '10:39', status: 'Новый' },
        { code: 'B', rule: 's', date: '2026-11-26', time: '09:53', status: 'Новый' },
        { code: 'C', rule: 's', date: '2026-11-26', time: '10:39', status: 'Закрыт', acceptTime: '10:39' },
        { code: 'D', rule: 's', date: '2026-11-26', time: '10:33', status: 'Новый' }];
    assert.deepStrictEqual(C.feedOrder(list, by, NOW).map(x => x.inc.code), ['B', 'D', 'A', 'C']);
});

test('закрытие: без причины из справочника и без принятия нельзя', () => {
    const causes = ['М01 Поломка шпинделя', 'О03 Нет заготовки'];
    assert.strictEqual(C.closeErrors({ cause: '', acceptTime: '10:00' }, causes).length, 1);
    assert.match(C.closeErrors({ cause: 'сломалось что-то', acceptTime: '10:00' }, causes)[0], /не из справочника/);
    assert.match(C.closeErrors({ cause: 'О03 Нет заготовки', acceptTime: '' }, causes)[0], /примите/);
    assert.deepStrictEqual(C.closeErrors({ cause: 'О03 Нет заготовки', acceptTime: '10:00' }, causes), []);
});

test('цепочка шлюза: отклонение -> инцидент с дежурным -> заявка, если правило велит', () => {
    const ctx = {
        sensorBy: { 'Д-ПК1-P': { eq: 'ПК-1' }, 'Д-ОК2-T': { eq: 'ОК-2' } },
        eqBy: { 'ПК-1': { name: 'ПК-1', section: 'Сборка и окраска' }, 'ОК-2': { name: 'ОК-2', section: 'Сборка и окраска' } },
        duties: [{ date: '2026-11-26', shift: 'Дневная', section: 'Сборка и окраска', emp: 'Нуриев Т. Р.' }],
        codes: ['ИН-0041', 'ИН-0399'], repairCodes: ['ЗР-0012']
    };
    const res = C.processDeviation(dev('Давление масла', 1.9, 2, '2026-11-26', '10:31', 'Д-ПК1-P'), [ruleT, Object.assign({}, ruleOil, { minutes: 2 })], ctx);
    assert.strictEqual(res.incident.code, 'ИН-0400');
    assert.strictEqual(res.incident.resp, 'Нуриев Т. Р.');
    assert.strictEqual(res.incident.time, '10:33', 'инцидент начинается, когда правило сработало: 10:31 + 2 мин');
    assert.strictEqual(res.incident.severity, 'Авария');
    assert.strictEqual(res.repair.code, 'ЗР-0013');
    assert.strictEqual(res.repair.incident, 'ИН-0400');
    const noRepair = C.processDeviation(dev('Температура в камере', 62, 1, '2026-11-26', '10:31', 'Д-ОК2-T'), [ruleT, ruleOil], ctx);
    assert.strictEqual(noRepair.repair, null);
    assert.strictEqual(C.processDeviation(dev('Температура в камере', 55, 30, '2026-11-26', '10:31', 'Д-ОК2-T'), [ruleT], ctx), null);
});

test('видимость по участку: мастер видит свой участок, без участка - всё', () => {
    const rows = [{ section: 'Механообработка' }, { section: 'Сборка и окраска' }];
    assert.strictEqual(C.visibleBySection(rows, 'Механообработка').length, 1);
    assert.strictEqual(C.visibleBySection(rows, '').length, 2);
});
