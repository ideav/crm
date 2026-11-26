// rules: none (demo)
// Трекер с живой спецификацией (демо-копия, ideav/backlogram#994): условия переходов, детектор «нет продолжения»,
// варианты «куда дальше», цикл одобрения со сторонами и контрпредложением, проверка спеки, отчёт «что застряло».
const test = require('node:test');
const assert = require('node:assert');
const C = require('../download/tracker/js/tracker-core.js');

const T = '2026-11-26';
const step = (name, order, o) => Object.assign({ name, order, kind: 'Шаг', dept: 'Проектный офис', norm: 24, start: false }, o || {});
const STEPS = [step('Получена', 10, { start: true }), step('Проверена', 20, { dept: 'Финансовый отдел' }), step('Юридическая экспертиза', 30, { dept: 'Юридический отдел' }),
    step('Согласована', 40, { dept: 'Финансовый отдел' }), step('В закупке', 50, { dept: 'Отдел закупок', norm: 240 }), step('Закрыта', 70, { kind: 'Конечное', norm: 0 })];
const tr = (code, from, to, o) => Object.assign({ code, from, to, cond: '', status: 'Действует', since: '2026-09-01', version: 1 }, o || {});
const BASE = [tr('П-1', 'Получена', 'Проверена'), tr('П-2', 'Проверена', 'Согласована'), tr('П-3', 'Согласована', 'В закупке'), tr('П-4', 'В закупке', 'Закрыта'),
    tr('ПР-6', 'Проверена', 'Юридическая экспертиза', { cond: 'Вид заявки = Договор подряда', since: '2026-11-24' })];
const req = (code, st, sum, kind) => ({ code, step: st, fields: { 'Сумма заявки': sum, 'Вид заявки': kind || 'Договор подряда' } });
const ev = (code, r, st, kind, date, time, o) => Object.assign({ code, req: r, step: st, kind, date, time, basis: '' }, o || {});
const DEPTS = [{ name: 'Юридический отдел', head: 'Соловьёва', login: 'solovyova' }, { name: 'Отдел закупок', head: 'Гусев', login: 'gusev' }, { name: 'Финансовый отдел', head: 'Тарасова', login: 'tarasova' }];
const BA = { name: 'Орлова', login: 'orlova' };

test('условие перехода: числа сравниваются как числа, текст без регистра, пустое — всегда', () => {
    assert.strictEqual(C.evalCond('Сумма заявки >= 1000000', { 'Сумма заявки': '1800000.00' }), true);
    assert.strictEqual(C.evalCond('Сумма заявки >= 1000000', { 'Сумма заявки': 600000 }), false);
    assert.strictEqual(C.evalCond('Сумма заявки < 1000000', { 'Сумма заявки': '600000' }), true);
    assert.strictEqual(C.evalCond('Вид заявки = договор подряда', { 'Вид заявки': 'Договор подряда' }), true);
    assert.strictEqual(C.evalCond('', {}), true);
    assert.strictEqual(C.evalCond('мусор без оператора', {}), false, 'непонятное условие не пропускает');
    assert.strictEqual(C.condText('Сумма заявки >= 1000000'), 'сумма заявки ≥ 1 000 000');
});

test('детектор: новый шаг без продолжения — неопределённость, запись не дублируется', () => {
    const spec = C.buildSpec(STEPS, BASE, [], T);
    const r = req('З-41', 'Юридическая экспертиза', 2400000);
    assert.strictEqual(C.isUncertain(spec, r), true);
    assert.strictEqual(C.isUncertain(spec, req('З-1', 'Проверена', 100)), false);
    assert.strictEqual(C.isUncertain(spec, req('З-2', 'Закрыта', 100)), false, 'конечный шаг не неопределённость');
    const j = [ev('Ж-1', 'З-41', 'Проверена', 'Шаг', '2026-11-24', '14:50'), ev('Ж-2', 'З-41', 'Юридическая экспертиза', 'Шаг', '2026-11-24', '15:20')];
    assert.strictEqual(C.detect(spec, [r], j)[0].logged, false);
    j.push(ev('Ж-3', 'З-41', 'Юридическая экспертиза', 'Неопределённость', '2026-11-25', '06:00'));
    assert.strictEqual(C.detect(spec, [r], j)[0].logged, true);
});

test('варианты «куда дальше»: похожая заявка и регламент выше обычного пути', () => {
    const spec = C.buildSpec(STEPS, BASE, [], T);
    const j = [
        ev('Ж-1', 'З-38', 'Проверена', 'Шаг', '2026-11-24', '15:00'), ev('Ж-2', 'З-38', 'Юридическая экспертиза', 'Шаг', '2026-11-24', '16:00', { reqKind: 'Договор подряда', reqSum: '1600000' }),
        ev('Ж-3', 'З-38', 'В закупке', 'Исключение', '2026-11-25', '11:30', { reqKind: 'Договор подряда', reqSum: '1600000' }),
        ev('Ж-4', 'З-29', 'Юридическая экспертиза', 'Шаг', '2026-11-24', '12:10', { reqKind: 'Договор подряда', reqSum: '600000' }),
        ev('Ж-5', 'З-29', 'Согласована', 'Исключение', '2026-11-25', '10:00', { reqKind: 'Договор подряда', reqSum: '600000' }),
        ev('Ж-6', 'З-41', 'Проверена', 'Шаг', '2026-11-24', '14:50'), ev('Ж-7', 'З-41', 'Юридическая экспертиза', 'Шаг', '2026-11-24', '15:20')];
    const regs = [{ name: '4.2', step: 'Юридическая экспертиза', next: 'В закупке' }];
    const v = C.variants(spec, req('З-41', 'Юридическая экспертиза', 2400000), j, regs);
    assert.deepStrictEqual(v.map(x => x.step), ['В закупке', 'Согласована']);
    assert.ok(v[0].why.some(w => /регламент/.test(w)) && v[0].why.some(w => /З-38/.test(w)));
    assert.ok(v[1].why.some(w => /обычный путь после «Проверена»/.test(w)));
    const small = C.variants(spec, req('З-50', 'Юридическая экспертиза', 500000), j, []);
    assert.strictEqual(small[0].step, 'Согласована', 'для малой суммы ближе похожая малая заявка');
});

test('перемещение: по правилу — «Шаг», мимо спеки — «Исключение»', () => {
    const spec = C.buildSpec(STEPS, BASE, [], T);
    assert.strictEqual(C.moveKind(spec, req('З-1', 'Проверена', 100), 'Согласована').kind, 'Шаг');
    assert.strictEqual(C.moveKind(spec, req('З-1', 'Проверена', 100), 'Юридическая экспертиза').kind, 'Шаг', 'условие «договор подряда» выполнено');
    assert.strictEqual(C.moveKind(spec, req('З-1', 'Проверена', 100, 'Оплата счёта'), 'Юридическая экспертиза').kind, 'Исключение');
    assert.strictEqual(C.moveKind(spec, req('З-41', 'Юридическая экспертиза', 2400000), 'В закупке').kind, 'Исключение');
});

test('одобрение: три стороны, контрпредложение вместо отказа, новая версия голосуется заново, правило вступает с даты последнего согласия', () => {
    const p = tr('ПР-7', 'Юридическая экспертиза', 'В закупке', { status: 'Предложен', since: '' });
    const votes = [
        { id: 'v1', proposal: 'ПР-7', code: 'ПР-7 / Передающий', side: 'Передающий', login: 'solovyova', decision: 'Согласен', version: 1, date: '2026-11-25' },
        { id: 'v2', proposal: 'ПР-7', code: 'ПР-7 / Принимающий', side: 'Принимающий', login: 'gusev', decision: 'Контрпредложение', version: 1, counter: 'Сумма заявки >= 1000000', date: '2026-11-25' },
        { id: 'v3', proposal: 'ПР-7', code: 'ПР-7 / Бизнес-администратор', side: 'Бизнес-администратор', login: 'orlova', decision: 'Ждёт', version: 1, date: '' }];
    let st = C.transitionState(p, votes, T);
    assert.strictEqual(st.state, 'counter');
    const a = C.acceptCounter(p, st, T);
    assert.deepStrictEqual(a.trans, { 'Условие перехода': 'Сумма заявки >= 1000000', 'Версия предложения': 2 });
    assert.deepStrictEqual(a.votes.map(x => x.id).sort(), ['v2', 'v3'], 'согласны автор контрпредложения и администратор');
    const p2 = Object.assign({}, p, { cond: 'Сумма заявки >= 1000000', version: 2 });
    const v2 = votes.map(v => (v.id === 'v1' ? v : Object.assign({}, v, { decision: 'Согласен', version: 2, counter: '', date: T })));
    st = C.transitionState(p2, v2, T);
    assert.strictEqual(st.state, 'proposed');
    assert.deepStrictEqual(st.pending, ['Передающий'], 'согласие с версией 1 не переносится на версию 2');
    const v3 = v2.map(v => (v.id === 'v1' ? Object.assign({}, v, { version: 2, date: T }) : v));
    st = C.transitionState(p2, v3, T);
    assert.strictEqual(st.state, 'effective');
    assert.strictEqual(st.since, T);
    // следующая заявка идёт по правилу без исключения, малая — остаётся неопределённостью
    const spec = C.buildSpec(STEPS, BASE.concat([p2]), v3, T);
    assert.strictEqual(C.isUncertain(spec, req('З-42', 'Юридическая экспертиза', 1800000)), false);
    assert.strictEqual(C.moveKind(spec, req('З-42', 'Юридическая экспертиза', 1800000), 'В закупке').kind, 'Шаг');
    assert.strictEqual(C.isUncertain(spec, req('З-43', 'Юридическая экспертиза', 300000)), true);
    assert.throws(() => C.votePatch(p2, 'Контрпредложение', 'просто нет', T), /своё условие/);
    assert.strictEqual(C.votePatch(p2, 'Согласен', '', T)['Версия голоса'], 2);
});

test('стороны: передающий и принимающий по подразделениям шагов; внутри одного подразделения — две стороны', () => {
    const spec = C.buildSpec(STEPS, BASE, [], T);
    assert.deepStrictEqual(C.parties(spec, 'Юридическая экспертиза', 'В закупке', DEPTS, BA).map(s => s.side + ':' + s.login), ['Передающий:solovyova', 'Принимающий:gusev', 'Бизнес-администратор:orlova']);
    assert.deepStrictEqual(C.parties(spec, 'Проверена', 'Согласована', DEPTS, BA).map(s => s.side), ['Передающий', 'Бизнес-администратор']);
    assert.strictEqual(C.canVote({ login: 'gusev', decision: 'Ждёт' }, 'gusev', 'Руководитель подразделения'), true);
    assert.strictEqual(C.canVote({ login: 'gusev', decision: 'Ждёт' }, 'solovyova', 'Руководитель подразделения'), false, 'за другого не голосуют');
});

test('проверка спеки: тупик у нового шага, недостижимый шаг, дубль перехода', () => {
    const steps = STEPS.concat([step('Архив', 90)]);
    const issues = C.lint(C.buildSpec(steps, BASE.concat([tr('П-9', 'Получена', 'Проверена')]), [], T));
    const kinds = issues.map(i => i.kind + ':' + (i.step || ''));
    assert.ok(kinds.includes('dead-end:Юридическая экспертиза'));
    assert.ok(kinds.includes('unreachable:Архив'));
    assert.ok(kinds.includes('duplicate:Получена'));
    assert.ok(!kinds.includes('dead-end:Закрыта'), 'конечный шаг не тупик');
    assert.ok(!kinds.some(k => k.indexOf('no-start') === 0));
});

test('что застряло: время в шаге из журнала против норматива, неопределённые первыми', () => {
    const spec = C.buildSpec(STEPS, BASE, [], T);
    const reqs = [req('З-41', 'Юридическая экспертиза', 2400000), req('З-21', 'Согласована', 760000), req('З-31', 'В закупке', 58000)];
    const j = [ev('Ж-1', 'З-41', 'Юридическая экспертиза', 'Шаг', '2026-11-24', '15:20'), ev('Ж-2', 'З-21', 'Согласована', 'Шаг', '2026-11-17', '10:00'), ev('Ж-3', 'З-31', 'В закупке', 'Шаг', '2026-11-24', '14:00')];
    const s = C.stuck(spec, reqs, j, T, '12:00');
    assert.deepStrictEqual(s.map(x => x.req.code), ['З-41', 'З-21', 'З-31']);
    assert.strictEqual(s[1].hours, 218);
    assert.strictEqual(s[1].over, true);
    assert.strictEqual(s[2].over, false, '46 ч при нормативе 240 ч');
    assert.strictEqual(C.fmtHours(218), '9 дн 2 ч');
});

test('метрики: доля исключений и время цикла закрытых', () => {
    const j = [ev('Ж-1', 'A', 'Получена', 'Шаг', '2026-11-01', '10:00', { basis: 'Старт процесса' }), ev('Ж-2', 'A', 'Проверена', 'Шаг', '2026-11-02', '10:00'),
        ev('Ж-3', 'A', 'Закрыта', 'Исключение', '2026-11-03', '10:00'), ev('Ж-4', 'B', 'Получена', 'Шаг', '2026-11-05', '10:00', { basis: 'Старт процесса' }),
        ev('Ж-5', 'B', 'Проверена', 'Шаг', '2026-11-05', '12:00'), ev('Ж-6', 'B', 'Проверена', 'Неопределённость', '2026-11-06', '06:00')];
    const m = C.metrics(j);
    assert.strictEqual(m.moves, 3);
    assert.strictEqual(m.exceptions, 1);
    assert.strictEqual(m.excShare, 33.3);
    assert.strictEqual(m.cycleAvg, 48);
    assert.strictEqual(m.uncertain, 1);
    assert.strictEqual(m.steps['Получена'].avg, 13);
});

test('очередь исполнителя: свободную можно взять, свою — сдать по правилу или «другое»', () => {
    const spec = C.buildSpec(STEPS, BASE, [], T);
    const free = Object.assign(req('З-38', 'В закупке', 1600000), { login: '' });
    assert.strictEqual(C.queueActions(spec, free, 'kuznetsov').take, true);
    assert.deepStrictEqual(C.queueActions(spec, free, 'kuznetsov').next, []);
    const mine = Object.assign(req('З-38', 'В закупке', 1600000), { login: 'kuznetsov' });
    assert.deepStrictEqual(C.queueActions(spec, mine, 'kuznetsov').next.map(t => t.to), ['Закрыта']);
    assert.strictEqual(C.queueActions(spec, mine, 'lebedev').other, false, 'чужую не двигают');
    assert.strictEqual(C.nextCode(['Ж-0175', 'Ж-0009'], 'Ж-', 4), 'Ж-0176');
});
