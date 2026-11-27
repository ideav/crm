// rules: none (defect #5760)
// GRC и внутренний контроль (демо-копия, ideav/backlogram#1008): зоны риска, состояние подтверждений, остаточный риск, пробелы матрицы, разбор Excel, цепочка журнала.
const test = require('node:test');
const assert = require('node:assert');
const C = require('../download/grc/js/grc-core.js');

const ZONES = [{ name: 'Низкая', from: 1, to: 4 }, { name: 'Средняя', from: 5, to: 9 }, { name: 'Высокая', from: 10, to: 15 }, { name: 'Критическая', from: 16, to: 25 }];
const CAMP = { name: 'IV', start: '2026-10-01', end: '2026-11-30', due: '2026-11-25' };
const req = (control, o) => Object.assign({ campaign: 'IV', control, owner: 'treasurer' }, o || {});

test('зона по баллу вероятность x влияние берётся из шкалы заказчика', () => {
    assert.strictEqual(C.zoneOf(4 * 5, ZONES).name, 'Критическая');
    assert.strictEqual(C.zoneOf(3 * 3, ZONES).name, 'Средняя');
    assert.strictEqual(C.zoneOf(10, ZONES).name, 'Высокая');
    assert.strictEqual(C.zoneRank(C.zoneOf(2, ZONES), ZONES), 0);
});

test('состояние запроса: в срок, с опозданием, не выполнен, нет ответа после срока, ждём', () => {
    assert.strictEqual(C.requestState(req('К-1', { result: 'Выполнен', answered: '2026-11-20' }), CAMP, '2026-11-26'), 'done');
    assert.strictEqual(C.requestState(req('К-1', { result: 'Выполнен', answered: '2026-11-26' }), CAMP, '2026-11-26'), 'late');
    assert.strictEqual(C.requestState(req('К-1', { result: 'Не выполнен', answered: '2026-11-20' }), CAMP, '2026-11-26'), 'fail');
    assert.strictEqual(C.requestState(req('К-1'), CAMP, '2026-11-26'), 'overdue');
    assert.strictEqual(C.requestState(req('К-1'), CAMP, '2026-11-25'), 'wait');
});

test('свод кампании: доля в срок и «выполнен без доказательства»', () => {
    const ctrlBy = { 'К-1': { evidence: 'Акт сверки' }, 'К-2': { evidence: '' }, 'К-3': { evidence: 'Реестр' } };
    const reqs = [req('К-1', { result: 'Выполнен', answered: '2026-11-20' }), req('К-2', { result: 'Выполнен', answered: '2026-11-21' }), req('К-3', { result: 'Выполнен', answered: '2026-11-21', file: '/f.pdf' }), req('К-4')];
    const s = C.campaignStats(reqs, CAMP, ctrlBy, '2026-11-26');
    assert.deepStrictEqual([s.total, s.done, s.overdue, s.noFile, s.onTimePct], [4, 3, 1, 1, 75]);
    const o = C.byOwner(reqs.concat([req('К-5', { owner: 'warehouse' }), req('К-6', { owner: 'warehouse' })]), CAMP, '2026-11-26');
    assert.strictEqual(o[0].owner, 'warehouse');
    assert.strictEqual(o[0].overdue, 2);
});

test('повторный сбой: не выполнен или без ответа две кампании подряд', () => {
    const camps = [{ name: 'III', start: '2026-07-01', due: '2026-10-15' }, Object.assign({}, CAMP), { name: 'II', start: '2026-04-01', due: '2026-07-15' }];
    const reqs = [
        { campaign: 'II', control: 'К-1', result: 'Выполнен', answered: '2026-07-10' }, { campaign: 'III', control: 'К-1', result: 'Не выполнен', answered: '2026-10-10' }, { campaign: 'IV', control: 'К-1' },
        { campaign: 'III', control: 'К-2', result: 'Не выполнен', answered: '2026-10-10' }, { campaign: 'IV', control: 'К-2', result: 'Выполнен', answered: '2026-11-20' }];
    camps[1].start = '2026-10-01';
    assert.deepStrictEqual(C.repeatFailures(camps, reqs, '2026-11-26', 2), [{ control: 'К-1', run: 2 }]);
});

test('остаточный риск снижается только подтверждёнными с доказательством ключевыми контролями', () => {
    const risk = { code: 'Р-1', p: 4, i: 5 };
    const ctrls = [{ code: 'К-1', risk: 'Р-1', key: true, evidence: 'Акт' }, { code: 'К-2', risk: 'Р-1', key: true, evidence: '' }, { code: 'К-3', risk: 'Р-1', key: false }];
    const ok = { 'К-1': req('К-1', { result: 'Выполнен', answered: '2026-11-20', file: '/a.pdf' }), 'К-2': req('К-2', { result: 'Выполнен', answered: '2026-11-20' }) };
    const r1 = C.residual(risk, ctrls, ok, '2026-11-26', CAMP);
    assert.deepStrictEqual([r1.p, r1.i, r1.keyOk, r1.broken.length], [2, 5, 2, 0]);
    const noFile = { 'К-1': req('К-1', { result: 'Выполнен', answered: '2026-11-20' }), 'К-2': ok['К-2'] };
    const r2 = C.residual(risk, ctrls, noFile, '2026-11-26', CAMP);
    assert.deepStrictEqual([r2.p, r2.broken.map(b => b.control)], [3, ['К-1']]);
    const r3 = C.residual(risk, ctrls, { 'К-2': ok['К-2'] }, '2026-11-26', CAMP);
    assert.deepStrictEqual(r3.broken, [{ control: 'К-1', state: 'none' }]);
    assert.strictEqual(C.residual({ code: 'Р-9', p: 2, i: 5 }, ctrls, ok, '2026-11-26', CAMP).uncovered, true);
});

test('тепловая карта раскладывает риски по ячейкам, сверху высокая вероятность', () => {
    const g = C.heatmap([{ code: 'Р-1', p: 4, i: 5 }, { code: 'Р-2', p: 1, i: 1 }, { code: 'Р-3', p: 4, i: 5 }], ZONES, 5, 5);
    assert.strictEqual(g[1][4].risks.length, 2);
    assert.strictEqual(g[1][4].zone.name, 'Критическая');
    assert.strictEqual(g[4][0].risks[0].code, 'Р-2');
});

test('пробелы матрицы и охват кампании', () => {
    const risks = [{ code: 'Р-1', p: 4, i: 4 }, { code: 'Р-2', p: 2, i: 5 }, { code: 'Р-3', p: 1, i: 2 }];
    const emps = [{ name: 'Гордеева', login: 'treasurer' }, { name: 'Финансовый отдел', login: '' }];
    const ctrls = [{ code: 'К-1', risk: 'Р-1', owner: 'Гордеева', period: 'Ежемесячно', key: false }, { code: 'К-2', risk: 'Р-3', owner: 'Финансовый отдел', period: '' },
        { code: 'К-3', risk: 'Р-3', owner: 'Гордеева', period: 'При событии' }];
    const kinds = C.matrixGaps(risks, ctrls, emps, ZONES).map(g => g.ref + ':' + g.kind);
    assert.deepStrictEqual(kinds, ['Р-1:noKey', 'Р-2:noControl', 'К-2:notPerson', 'К-2:noPeriod']);
    const sc = C.campaignScope(ctrls, emps);
    assert.deepStrictEqual(sc.take.map(t => t.control + '>' + t.owner), ['К-1>treasurer']);
    assert.deepStrictEqual(sc.skip.map(s => s.control), ['К-2', 'К-3']);
});

test('разбор вставки из Excel: табуляция, кавычки, CSV через точку с запятой', () => {
    assert.deepStrictEqual(C.parseTable('Риск\tКонтроль\n"Платёж ""А"""\tСверка\n'), [['Риск', 'Контроль'], ['Платёж "А"', 'Сверка']]);
    assert.deepStrictEqual(C.parseTable('\uFEFFРиск;Контроль\r\nа;"б;в"'), [['Риск', 'Контроль'], ['а', 'б;в']]);
});

test('план загрузки матрицы: объединённые ячейки, повтор риска, шкала словами, владелец-отдел, нет периодичности', () => {
    const text = ['Риск\tВероятность\tВлияние\tКонтроль\tВладелец контроля\tПериодичность\tКлючевой',
        'Задвоение платежа\tвысокий\t4\tКонтроль дублей\tФинансовый отдел\tЕженедельно\tда',
        '\t\t\tСверка с актами\tГордеева М.П.\t\tнет',
        'Задвоение платежа\t4\t4\tЕщё контроль\tГордеева Марина Петровна\tежемесячно\t'].join('\n');
    const plan = C.importPlan(C.parseTable(text), { probs: [], impacts: [], emps: [{ name: 'Гордеева Марина Петровна', login: 'treasurer' }], periods: ['Еженедельно', 'Ежемесячно'], risks: [{ code: 'Р-22', name: 'Старый' }], ctrls: [{ code: 'К-28' }] });
    assert.strictEqual(plan.risks.length, 1);
    assert.deepStrictEqual([plan.risks[0].code, plan.risks[0].p, plan.risks[0].i], ['Р-23', 4, 4]);
    assert.deepStrictEqual(plan.ctrls.map(c => [c.code, c.owner, c.period, c.key]), [['К-29', '', 'Еженедельно', true], ['К-30', 'Гордеева Марина Петровна', '', false], ['К-31', 'Гордеева Марина Петровна', 'Ежемесячно', false]]);
    const kinds = plan.issues.map(i => i.row + ':' + i.kind);
    assert.deepStrictEqual(kinds, ['2:words', '2:notPerson', '3:merged', '3:dupRisk', '3:noPeriod']);
    assert.strictEqual(C.importPlan([['А', 'Б']], {}).issues[0].kind, 'head');
});

test('журнал: правка одной записи задним числом рвёт цепочку только на ней, цепочки по владельцам', () => {
    const e = (code, owner, action, date) => ({ code, request: 'Q/' + code, owner, action, author: owner, date, time: '10:00', content: '' });
    const signed = C.signChain([e('Ж-00001', 'a', 'Запрос отправлен', '2026-10-01'), e('Ж-00002', 'b', 'Запрос отправлен', '2026-10-01'), e('Ж-00003', 'a', 'Выполнен', '2026-10-20'), e('Ж-00004', 'a', 'Напоминание', '2026-10-21')]);
    assert.deepStrictEqual(C.verifyChain(signed), { total: 4, bad: [], ok: true, chains: 2, last: { a: signed[3].fp, b: signed[1].fp } });
    const forged = signed.map(x => x.code === 'Ж-00003' ? Object.assign({}, x, { date: '2026-10-14' }) : x);
    assert.deepStrictEqual(C.verifyChain(forged).bad, ['Ж-00003']);
    const next = C.appendEntry(signed, e(C.journalCode('2026-11-26', '14:05:09', 7), 'b', 'Выполнен', '2026-11-26'));
    assert.ok(next.code > 'Ж-00004' && next.code > 'Ж-00214');
    assert.strictEqual(C.verifyChain(signed.concat([next])).ok, true);
});

test('выгрузка аудитору за период и CSV с экранированием', () => {
    const camps = [{ name: 'II', start: '2026-04-01', end: '2026-06-30' }, { name: 'IV', start: '2026-10-01', end: '2026-11-30' }];
    const reqs = [{ campaign: 'II', control: 'К-1', owner: 'x' }, { campaign: 'IV', control: 'К-1', ownerName: 'Гордеева', result: 'Не выполнен', reason: 'нет доступа; отпуск', answered: '2026-11-20', time: '10:05', fp: 'ab' }];
    const rows = C.auditRows(reqs, { 'К-1': { name: 'Сверка', risk: 'Р-1' } }, camps, '2026-07-01', '2026-11-30');
    assert.strictEqual(rows.length, 1);
    assert.deepStrictEqual([rows[0].period, rows[0].owner, rows[0].when], ['01.10.2026 - 30.11.2026', 'Гордеева', '20.11.2026 10:05']);
    assert.strictEqual(C.toCsv([['control', 'Контроль'], ['reason', 'Причина']], rows), 'Контроль;Причина\r\nК-1;"нет доступа; отпуск"');
});

test('напоминание владельцу: склонение и ссылка в Telegram', () => {
    assert.ok(C.reminderText('Марина Петровна', 3, '2026-11-25').indexOf('3 контроля до 25.11.2026') > 0);
    assert.ok(C.reminderText('А', 5, '2026-11-25').indexOf('5 контролей') > 0);
    assert.strictEqual(C.messengerLink('https://ideav.ru/grc/confirm', 'а б'), 'https://t.me/share/url?url=https%3A%2F%2Fideav.ru%2Fgrc%2Fconfirm&text=%D0%B0%20%D0%B1');
});
