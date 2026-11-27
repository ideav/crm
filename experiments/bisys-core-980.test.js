// rules: none (defect #5736)
// BI-сводка (демо-копия, ideav/backlogram#980): периоды, план-факт, свежесть источников, загрузка файла по формату, сверка лидов, отклонения.
const test = require('node:test');
const assert = require('node:assert');
const C = require('../download/bisys/js/bisys-core.js');

const doc = (no, date, sub, sum, cost, o) => Object.assign({ no, date, sub, sum, cost, kind: sum < 0 ? 'Возврат' : 'Чек', source: '1С:Розница' }, o || {});
const TODAY = '2026-11-26';

test('периоды сводки: вчера, 7 дней и месяц считаются от «сегодня»', () => {
    assert.deepStrictEqual([C.period('yesterday', TODAY).from, C.period('yesterday', TODAY).to], ['2026-11-25', '2026-11-25']);
    assert.deepStrictEqual([C.period('week', TODAY).from, C.period('week', TODAY).to], ['2026-11-19', '2026-11-25']);
    assert.deepStrictEqual([C.period('month', TODAY).from, C.period('month', TODAY).to], ['2026-11-01', '2026-11-25']);
    assert.strictEqual(C.period('month', '2026-12-01').from, '2026-11-01');
    assert.strictEqual(C.toIso('05.12.2026'), '2026-12-05');
});

test('итоги: возврат уменьшает выручку и не считается продажей; маржа и средний чек', () => {
    const t = C.totals([doc('1', '2026-11-25', 'A', 1000, 500), doc('2', '2026-11-25', 'A', 3000, 1500), doc('3', '2026-11-25', 'A', -1000, -500)]);
    assert.strictEqual(t.revenue, 3000);
    assert.strictEqual(t.gp, 1500);
    assert.strictEqual(t.margin, 50);
    assert.strictEqual(t.sales, 2);
    assert.strictEqual(t.avgCheck, 1500);
});

test('план на период: месячный план делится по дням, 25 дней ноября = 25/30', () => {
    const plans = [{ sub: 'A', month: '2026-11-01', revenue: 300000, gp: 150000 }, { sub: 'B', month: '2026-11-01', revenue: 30000, gp: 0 }];
    assert.deepStrictEqual(C.planFor(plans, '2026-11-01', '2026-11-25', 'A'), { revenue: 250000, gp: 125000 });
    assert.strictEqual(C.planFor(plans, '2026-11-25', '2026-11-25').revenue, 11000);
    assert.strictEqual(C.planFor(plans, '2026-12-01', '2026-12-05').revenue, 0);
    assert.strictEqual(C.forecastMonth(250000, TODAY), 300000);
});

test('свежесть: источник без удачной загрузки за вчера не свежий, ошибка последней загрузки видна, время «данные на» — последняя удачная сегодня', () => {
    const sources = [{ name: '1С', freq: 'Ежедневно' }, { name: 'Ozon', freq: 'Ежедневно' }, { name: 'План', freq: 'Ежемесячно' }];
    const loads = [
        { source: '1С', date: '2026-11-26', time: '03:02', dataFor: '2026-11-25', status: 'Успешно' },
        { source: 'Ozon', date: '2026-11-25', time: '07:05', dataFor: '2026-11-24', status: 'Успешно' },
        { source: 'Ozon', date: '2026-11-26', time: '07:15', dataFor: '2026-11-25', status: 'Ошибка' },
        { source: 'План', date: '2026-10-31', time: '10:20', dataFor: '2026-11-01', status: 'Успешно' }
    ];
    const f = C.freshness(sources, loads, TODAY);
    assert.strictEqual(f.fresh, 2);
    assert.strictEqual(f.total, 3);
    assert.strictEqual(f.asOf, '03:02');
    assert.deepStrictEqual(f.stale.map(s => s.name), ['Ozon']);
    assert.strictEqual(f.stale[0].failed, true);
    assert.strictEqual(f.stale[0].dataFor, '2026-11-24');
    loads.push({ source: 'Ozon', date: '2026-11-26', time: '09:40', dataFor: '2026-11-25', status: 'С отказами' });
    const g = C.freshness(sources, loads, TODAY);
    assert.strictEqual(g.fresh, 3);
    assert.strictEqual(g.asOf, '09:40');
});

test('план-факт: отклонение ниже порога помечено, нехватка данных за последние дни видна, главные отклонения — худшие первыми с карточкой', () => {
    const subs = [{ name: 'A' }, { name: 'B' }, { name: 'C' }];
    const plans = ['A', 'B', 'C'].map(s => ({ sub: s, month: '2026-11-01', revenue: 30000, gp: 15000 }));
    const docs = [doc('a', '2026-11-25', 'A', 1000, 500), doc('b', '2026-11-25', 'B', 800, 400), doc('c', '2026-11-24', 'C', 1000, 900)];
    const pf = C.planFact(subs, docs, plans, '2026-11-25', '2026-11-25', { 'Выручка': 5, 'Валовая прибыль': 5 });
    assert.deepStrictEqual(pf[0].flags, []);
    assert.deepStrictEqual(pf[1].flags, ['Выручка', 'Валовая прибыль']);
    assert.strictEqual(pf[1].dev, -20);
    assert.strictEqual(pf[2].missingFrom, '2026-11-25');
    const top = C.topDeviations(pf, [{ sub: 'B', metric: 'Выручка', comment: 'Ремонт эскалатора в ТЦ' }], 3);
    assert.strictEqual(top[0].sub, 'C');
    assert.strictEqual(top[0].dev, -100);
    const b = top.filter(t => t.sub === 'B' && t.metric === 'Выручка')[0];
    assert.strictEqual(b.commented, true);
});

test('загрузка демо-файла Ozon по сохранённому формату: 40 строк, 28 принято, 12 отвергнуто, у каждой причина', () => {
    const fmt = C.parseFormat({ delim: ';', cols: 'Номер отправления = Документ источника\nДата = Дата документа\nСклад = Подразделение\nСумма = Сумма документа\nСебестоимость с комиссией = Себестоимость документа\nТоваров = Позиций в документе\nСтатус = Вид документа', rules: 'Сумма — число\nСоответствие: Ozon FBO Москва → Ozon\nСоответствие: Ozon FBO Ярославль → Ozon' });
    assert.strictEqual(fmt.map['Ozon FBO Москва'], 'Ozon');
    const r = C.checkFile(C.demoOzonCsv(), fmt, { subs: ['Ozon', 'Интернет-магазин'], existing: { 'OZ-74120310-1': 1 }, from: '2026-11-25', to: '2026-11-25' });
    assert.strictEqual(r.total, 40);
    assert.strictEqual(r.accepted.length, 28);
    assert.strictEqual(r.rejected.length, 12);
    const why = r.rejected.map(x => x.why).join('\n');
    assert.match(why, /уже есть в файле/);
    assert.match(why, /уже загружен раньше/);
    assert.match(why, /вне периода/);
    assert.match(why, /не число/);
    assert.match(why, /равна нулю/);
    assert.match(why, /Ozon FBS Казань/);
    assert.match(why, /Нет номера/);
    assert.ok(r.accepted.every(a => a.sub === 'Ozon' && a.date === '2026-11-25'));
    assert.ok(r.accepted.some(a => a.kind === 'Возврат' && a.sum < 0));
    const miss = C.checkFile('Номер;Дата\n1;2', fmt, { subs: [], from: '2026-11-25', to: '2026-11-25' });
    assert.ok(miss.missingCols.length > 0);
});

test('сверка лидов: 124 у маркетинга против 117 у продаж раскладывается на причины без остатка', () => {
    const mk = [], sa = [];
    let k = 0; const ph = () => '+7 (9' + String(10 + (k % 80)).padStart(2, '0') + ') ' + (200 + k) + '-' + String(k % 100).padStart(2, '0') + '-' + String(++k % 97).padStart(2, '0');
    const m = (date, phone, comment) => mk.push({ id: 'M' + mk.length, date, phone, comment: comment || '' });
    const s = (date, phone, ch) => sa.push({ id: 'S' + sa.length, date, phone, channel: ch || 'Директ' });
    const base = [];
    for (let i = 0; i < 108; i++) { const p = ph(); base.push(p); m('2026-11-' + String(1 + i % 25).padStart(2, '0'), p); s('2026-11-' + String(1 + i % 25).padStart(2, '0'), p); }
    for (let i = 0; i < 7; i++) m('2026-11-25', base[i]);
    ['+7 (900) 000-00-00', '+7 (999) 999-99-99', '+7 (911) 111-11-11', '+7 (912) 345-67-89', '+7 (95'].forEach(p => m('2026-11-10', p));
    for (let i = 0; i < 4; i++) { const p = ph(); m('2026-11-25', p); s('2026-11-26', p); }
    for (let i = 0; i < 3; i++) { const p = ph(); m('2026-10-31', p); s('2026-11-01', p); }
    for (let i = 0; i < 6; i++) s('2026-11-12', ph(), 'Звонок в магазин');
    const r = C.reconcileLeads(mk, sa, '2026-11-01', '2026-11-25');
    assert.strictEqual(r.mkCount, 124);
    assert.strictEqual(r.salesCount, 117);
    assert.strictEqual(r.matched, 108);
    const n = g => r.groups[g].items.length;
    assert.deepStrictEqual([n('dup'), n('junk'), n('late'), n('lost'), n('early'), n('offline')], [7, 5, 4, 0, 3, 6]);
    assert.strictEqual(r.mkCount - n('dup') - n('junk') - n('late') - n('lost') + n('early') + n('offline'), r.salesCount);
    assert.strictEqual(C.normPhone('8 (912) 000-11-22'), '79120001122');
});

test('отклонение: без внятного комментария статус не меняется, с ним — Новое → Прокомментировано → Закрыто', () => {
    assert.strictEqual(C.nextStatus('Новое', '').ok, false);
    assert.strictEqual(C.nextStatus('Новое', 'разберёмся').ok, false);
    assert.strictEqual(C.nextStatus('Новое', 'ок ок ок ок ок ок ок ок').ok, true);
    assert.strictEqual(C.nextStatus('Новое', 'Ремонт эскалатора в ТЦ с 10.11, вход с парковки закрыт').status, 'Прокомментировано');
    assert.strictEqual(C.nextStatus('Прокомментировано', 'Ремонт эскалатора в ТЦ с 10.11, вход с парковки закрыт').status, 'Закрыто');
    const t = C.signalText({ sub: 'Иваново', metric: 'Выручка', dev: -17.5, fact: 100, plan: 121, commented: false });
    assert.match(t, /ниже плана на 17,5%/);
    assert.match(t, /Комментария нет/);
});

test('откат загрузки удаляет только её документы и запись журнала; номер следующей записи', () => {
    const ops = C.rollbackOps(50, [{ rid: 1, loadRid: 50 }, { rid: 2, loadRid: 51 }, { rid: 3, loadRid: 50 }]);
    assert.deepStrictEqual(ops, [{ op: 'del', id: 1 }, { op: 'del', id: 3 }, { op: 'del', id: 50 }]);
    assert.strictEqual(C.nextCode(['ОТК-0001', 'ОТК-0003', 'СГ-0009'], 'ОТК-'), 'ОТК-0004');
});
