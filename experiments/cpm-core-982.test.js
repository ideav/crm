// rules: none (defect #5732)
// CPM (демо-копия, ideav/backlogram#982): форма ЦФО, правила ввода, свод с элиминацией, версии, план-факт, лимиты, кампания.
const test = require('node:test');
const assert = require('node:assert');
const C = require('../download/cpm/js/cpm-core.js');

const ARTS = [
    { name: 'Выручка', group: 'Выручка', kind: 'Доход', order: 1 },
    { name: 'Услуги УК (доход)', group: 'Внутригрупповые услуги', kind: 'Доход', intra: true, order: 2 },
    { name: 'Материалы', group: 'Себестоимость', kind: 'Расход', order: 3 },
    { name: 'Топливо', group: 'Коммерческие расходы', kind: 'Расход', order: 4 },
    { name: 'ФОТ', group: 'Управленческие расходы', kind: 'Расход', order: 5 },
    { name: 'Услуги УК (расход)', group: 'Внутригрупповые услуги', kind: 'Расход', intra: true, order: 6 }
];
const RULES = [
    { name: 'Рост', kind: 'growth', article: '', threshold: 15, message: 'рост', on: true },
    { name: 'ФОТ', kind: 'growth', article: 'ФОТ', threshold: 8, message: 'фот', on: true },
    { name: 'Месяцы', kind: 'required', article: '', threshold: 0, message: 'пусто', on: true },
    { name: 'Знак', kind: 'nonneg', article: '', threshold: 0, message: 'минус', on: true },
    { name: 'Скачок', kind: 'spike', article: '', threshold: 250, message: 'ноль', on: true }
];
const flat = (v) => Array(12).fill(v);
let id = 0;
const rowsOf = (version, cfo, article, values, year) => values.map((a, m) => a === null ? null : ({ id: String(++id), version, cfo, article, period: (year || 2027) + '-' + String(m + 1).padStart(2, '0') + '-01', amount: a })).filter(Boolean);

test('даты и числа: формат платформы и ввод «как в Excel»', () => {
    assert.strictEqual(C.toIso('01.10.2026'), '2026-10-01');
    assert.strictEqual(C.monthIdx('01.10.2026'), 9);
    assert.strictEqual(C.num('1 234,5'), 1234.5);
    assert.strictEqual(C.addDays('2026-11-26', 3), '2026-11-29');
});

test('сетка формы собирает статьи по месяцам одной версии и одного ЦФО', () => {
    const rows = rowsOf('K2', 'Логистика', 'Топливо', flat(100)).concat(rowsOf('K1', 'Логистика', 'Топливо', flat(90)), rowsOf('K2', 'Продажи', 'Выручка', flat(5)));
    const g = C.grid(rows, 'Логистика', 'K2');
    assert.deepStrictEqual(Object.keys(g.values), ['Топливо']);
    assert.strictEqual(C.sum(g.values['Топливо']), 1200);
    assert.ok(g.ids['Топливо'][11]);
    assert.deepStrictEqual(C.cfoArticles(rows, 'Логистика', ARTS).map(a => a.name), ['Топливо']);
});

test('правила ввода: пропущенный месяц и минус - ошибки, рост и скачок - предупреждения, у ФОТ свой порог', () => {
    const v = { 'Топливо': flat(122), 'ФОТ': flat(110), 'Материалы': [100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 1000], 'Выручка': [10, -5, 10, 10, 10, 10, 10, 10, 10, null, null, null] };
    const base = { 'Топливо': flat(100), 'ФОТ': flat(100), 'Материалы': flat(100), 'Выручка': flat(10) };
    const issues = C.checkGrid(v, base, RULES);
    const by = (art, rule) => issues.filter(i => i.article === art && i.rule === rule);
    assert.strictEqual(by('Топливо', 'Рост').length, 1);
    assert.strictEqual(by('Топливо', 'Рост')[0].pct, 22);
    assert.strictEqual(by('ФОТ', 'ФОТ').length, 1, 'ФОТ +10% выше индексации 8%');
    assert.strictEqual(by('ФОТ', 'Рост').length, 0, 'общий порог 15% к ФОТ не применяется');
    assert.strictEqual(by('Материалы', 'Скачок').length, 1);
    assert.strictEqual(by('Материалы', 'Скачок')[0].month, 11);
    assert.strictEqual(by('Выручка', 'Месяцы').length, 3);
    assert.strictEqual(by('Выручка', 'Знак').length, 1);
    assert.strictEqual(C.hasErrors(issues), true);
    assert.strictEqual(C.hasErrors(C.checkGrid({ 'Топливо': flat(100) }, base, RULES)), false);
});

test('выключенное правило не срабатывает', () => {
    const off = RULES.map(r => Object.assign({}, r, { on: r.kind !== 'required' }));
    assert.strictEqual(C.checkGrid({ 'Топливо': [1, null, null, null, null, null, null, null, null, null, null, null] }, {}, off).length, 0);
});

test('свод: ЦФО без строк текущего круга берётся из прошлого круга, внутригруппа элиминируется и проверяется', () => {
    const cfos = [{ name: 'УК' }, { name: 'Завод' }, { name: 'ТД' }, { name: 'ИТ' }];
    const rows = [].concat(
        rowsOf('K2', 'УК', 'Услуги УК (доход)', flat(200)),
        rowsOf('K2', 'Завод', 'Услуги УК (расход)', flat(100)), rowsOf('K2', 'Завод', 'Материалы', flat(500)),
        rowsOf('K2', 'ТД', 'Услуги УК (расход)', flat(90)), rowsOf('K2', 'ТД', 'Выручка', flat(1000)),
        rowsOf('K1', 'ИТ', 'ФОТ', flat(50)), rowsOf('K1', 'ТД', 'Выручка', flat(900)));
    const s = C.consolidate(rows, 'K2', 'K1', cfos, ARTS);
    assert.deepStrictEqual(s.fallbackCfos, ['ИТ']);
    assert.strictEqual(s.byCfo['ИТ']['ФОТ'], 600);
    assert.strictEqual(s.byCfo['ТД']['Выручка'], 12000, 'круг 1 у сдавшего ЦФО не подмешивается');
    assert.strictEqual(s.elim.income, 2400);
    assert.strictEqual(s.elim.expense, 2280);
    assert.strictEqual(s.elim.diff, 120);
    assert.strictEqual(s.elim.ok, false);
    assert.strictEqual(s.group['Услуги УК (доход)'], undefined, 'внутригруппа не входит в итог группы');
    const p = C.pnl(s.group, ARTS);
    assert.strictEqual(p.revenue, 12000);
    assert.strictEqual(p.ebitda, 12000 - 6000 - 600);
    assert.strictEqual(C.pnl(s.byCfo['УК'], ARTS).ebitda, 2400, 'в своде ЦФО внутригрупповые услуги видны');
});

test('сравнение версий показывает дельту по ЦФО и статье', () => {
    const cfos = [{ name: 'ТД' }];
    const rows = rowsOf('K2', 'ТД', 'Выручка', flat(1030)).concat(rowsOf('K1', 'ТД', 'Выручка', flat(1000)));
    const d = C.compare(C.consolidate(rows, 'K2', null, cfos, ARTS), C.consolidate(rows, 'K1', null, cfos, ARTS));
    assert.strictEqual(d.length, 1);
    assert.strictEqual(d[0].delta, 360);
    assert.strictEqual(Math.round(d[0].pct), 3);
});

test('план-факт: перерасход и недобор выручки выше 5% и 300 тыс. требуют пояснения, данное пояснение снимает запрос', () => {
    const nine = (v, last) => Array(9).fill(v).concat([last]);
    const rows = [].concat(
        rowsOf('P', 'Логистика', 'Топливо', flat(4000000), 2026), rowsOf('F', 'Логистика', 'Топливо', nine(4000000, 4440000), 2026),
        rowsOf('P', 'Продажи', 'Выручка', flat(200000000), 2026), rowsOf('F', 'Продажи', 'Выручка', nine(200000000, 188000000), 2026),
        rowsOf('P', 'ИТ', 'ФОТ', flat(1000000), 2026), rowsOf('F', 'ИТ', 'ФОТ', nine(1000000, 1200000), 2026));
    const notes = [{ cfo: 'Продажи', article: 'Выручка', period: '2026-10-01', status: 'Дано', text: 'сдвиг отгрузки' }];
    const pf = C.planFact(rows, 'P', 'F', [9], { pct: 5, abs: 300000, year: 2026 }, ARTS, notes);
    const f = (c) => pf.find(x => x.cfo === c);
    assert.strictEqual(f('Логистика').over, true);
    assert.strictEqual(f('Логистика').bad, true);
    assert.strictEqual(f('Логистика').needNote, true);
    assert.strictEqual(Math.round(f('Логистика').pct), 11);
    assert.strictEqual(f('Продажи').bad, true, 'недобор выручки - плохое отклонение');
    assert.strictEqual(f('Продажи').needNote, false);
    assert.strictEqual(f('ИТ').over, false, '20%, но 200 тыс. - ниже порога в рублях');
    assert.strictEqual(f('ИТ').period, '2026-10-01');
    const ytd = C.planFact(rows, 'P', 'F', [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], { year: 2026 }, ARTS, []);
    assert.strictEqual(ytd.find(x => x.cfo === 'Логистика').over, false, 'за 10 месяцев +1,1%');
});

test('лимит заявки: остаток виден до отправки, превышение уходит финдиректору, ожидающие не съедают остаток', () => {
    const rows = rowsOf('P', 'Логистика', 'Топливо', flat(4080000), 2026);
    const reqs = [
        { id: 'a', cfo: 'Логистика', article: 'Топливо', date: '03.11.2026', amount: 3794000, status: 'Оплачена' },
        { id: 'b', cfo: 'Логистика', article: 'Топливо', date: '05.11.2026', amount: 100000, status: 'На согласовании у ФД' },
        { id: 'c', cfo: 'Логистика', article: 'Топливо', date: '05.10.2026', amount: 999999, status: 'Оплачена' },
        { id: 'd', cfo: 'Логистика', article: 'Топливо', date: '07.11.2026', amount: 50000, status: 'Отклонена' }];
    const s = C.limitState(rows, 'P', reqs, 'Логистика', 'Топливо', '2026-11-26', 600000);
    assert.strictEqual(s.limit, 4080000);
    assert.strictEqual(s.used, 3794000);
    assert.strictEqual(s.pending, 100000);
    assert.strictEqual(s.rest, 286000);
    assert.strictEqual(s.over, true);
    assert.strictEqual(s.overBy, 314000);
    assert.strictEqual(C.limitState(rows, 'P', reqs, 'Логистика', 'Топливо', '2026-11-26', 200000).over, false);
    assert.strictEqual(C.limitState(rows, 'P', reqs, 'Логистика', 'Топливо', '2026-11-26', 3794000, 'a').over, false, 'правка своей заявки не считает её дважды');
});

test('кампания: просрочка по сроку, замок версии только когда все утверждены; замок и сданный бюджет запрещают правку', () => {
    const list = C.campaign([
        { cfo: 'ИТ', status: 'Не начат', deadline: '25.11.2026' }, { cfo: 'Логистика', status: 'Черновик', deadline: '27.11.2026' },
        { cfo: 'Продажи', status: 'Сдан', deadline: '27.11.2026' }, { cfo: 'Сервис', status: 'Утверждён', deadline: '25.11.2026' }], '2026-11-26');
    assert.deepStrictEqual(list.map(b => b.state), ['late', 'work', 'review', 'ok']);
    const s = C.campaignSummary(list);
    assert.strictEqual(s.late, 1);
    assert.strictEqual(s.done, 2);
    assert.strictEqual(s.canLock, false);
    assert.strictEqual(C.campaignSummary(C.campaign([{ status: 'Утверждён' }, { status: 'Принят' }], '2026-11-26')).canLock, true);
    assert.strictEqual(C.canEdit({ locked: true }, 'Черновик', true), false);
    assert.strictEqual(C.canEdit({ locked: false }, 'Сдан', false), false);
    assert.strictEqual(C.canEdit({ locked: false }, 'Сдан', true), true);
    assert.strictEqual(C.canEdit({ locked: false }, 'Возвращён', false), true);
});

test('вставка из Excel и сохранение: только изменённые ячейки, новые - записью с полями по именам', () => {
    assert.deepStrictEqual(C.parseTsv('1 200,5\t\t-\r\n3\t4\n'), [[1200.5, null, null], [3, 4]]);
    const before = { 'Топливо': [10, 10, null, null, null, null, null, null, null, null, null, null] };
    const after = { 'Топливо': [10, 12, 5, null, null, null, null, null, null, null, null, null] };
    const ops = C.saveOps(before, after, { 'Топливо': ['r1', 'r2'] }, { year: 2027, cfoId: 628, versionId: 9, articleIds: { 'Топливо': 690 } });
    assert.deepStrictEqual(ops, [
        { op: 'set', id: 'r2', fields: { 'Сумма строки': 12 } },
        { op: 'new', id: 'Строка бюджета', up: 1, fields: { 'Строка бюджета': '2027-03-01', 'ЦФО': 628, 'Версия бюджета': 9, 'Статья бюджета': 690, 'Сумма строки': 5 } }]);
    assert.strictEqual(C.toCsv(['a', 'b'], [['x;y', 1]]), 'a;b\r\n"x;y";1');
});
