// rules: none (defect #5773)
// Адаптация персонала (демо-копия, ideav/backlogram#1003): сроки шагов от оффера и выхода, план новичка, светофор, испытательный срок, панель, проверка маршрута, решение, отчёт по подразделениям.
const test = require('node:test');
const assert = require('node:assert');
const C = require('../download/onboard/js/onboard-core.js');

const D = (s) => C.fromIso(s);
const TODAY = D('2026-11-26');
const step = (o) => Object.assign({ name: 'Шаг', role: 'HR', basis: 'от выхода', offset: 0, order: 1, type: 'Задача', hidden: false }, o || {});
const roles = { 'ИТ': { exec: 'Лебедев А.И.', login: 'it' }, 'HR': { exec: 'Миронова Е.О.', login: 'hr' }, 'Служба безопасности': { exec: 'Рябов В.А.', login: 'ryabov' } };

test('даты: ДД.ММ.ГГГГ, ГГГГ-ММ-ДД и ГГГГММДД дают один день; пустое - null', () => {
    assert.strictEqual(C.parseD('26.11.2026'), TODAY);
    assert.strictEqual(C.parseD('2026-11-26'), TODAY);
    assert.strictEqual(C.parseD('20261126'), TODAY);
    assert.strictEqual(C.parseD(''), null);
    assert.strictEqual(C.fmtD(TODAY), '26.11.2026');
    assert.strictEqual(C.wd(TODAY), 'чт');
});

test('срок до выхода в выходной уходит на пятницу, после выхода - на понедельник', () => {
    const start = D('2026-11-30'); // понедельник
    assert.strictEqual(C.fmtD(C.dueDate(step({ offset: -3 }), null, start)), '27.11.2026');
    assert.strictEqual(C.fmtD(C.dueDate(step({ offset: -1 }), null, start)), '27.11.2026'); // воскресенье -> пятница
    assert.strictEqual(C.fmtD(C.dueDate(step({ offset: 5 }), null, start)), '07.12.2026'); // суббота -> понедельник
    assert.strictEqual(C.fmtD(C.dueDate(step({ offset: 0 }), null, start)), '30.11.2026');
});

test('срок от оффера не позже последнего рабочего дня до выхода', () => {
    const offer = D('2026-11-25'), start = D('2026-12-01');
    assert.strictEqual(C.fmtD(C.dueDate(step({ basis: 'от оффера', offset: 1 }), offer, start)), '26.11.2026');
    assert.strictEqual(C.fmtD(C.dueDate(step({ basis: 'от оффера', offset: 3 }), offer, start)), '27.11.2026'); // суббота -> пятница
    assert.strictEqual(C.fmtD(C.dueDate(step({ basis: 'от оффера', offset: 10 }), offer, start)), '30.11.2026'); // позже выхода -> накануне
});

test('план по маршруту: исполнитель по роли, порядок, скрытый шаг и поля масок без пустых значений', () => {
    const route = [step({ name: 'Доступы', role: 'ИТ', offset: -2, order: 2, type: 'Заявка' }), step({ name: 'Проверка СБ', role: 'Служба безопасности', basis: 'от оффера', offset: 3, order: 1, hidden: true }),
        step({ name: 'Знакомство', role: 'Наставник', order: 3 }), step({ name: 'Отчёт', role: 'Руководитель', offset: 85, order: 4, type: 'Контрольная точка' }), step({ name: 'Курс', role: 'Новичок', offset: 10, order: 5 })];
    const plan = C.planSteps(route, { newbie: { name: 'Лаптева В.Н.', login: '', offer: D('2026-11-25'), start: D('2026-12-01') }, roles, mentor: { name: 'Кузнецова О.И.', login: 'kuznetsova' }, manager: { name: 'Тихонова Н.П.', login: 'tikhonova' } });
    assert.deepStrictEqual(plan.map(p => p.name), ['Проверка СБ', 'Доступы', 'Знакомство', 'Отчёт', 'Курс']);
    assert.deepStrictEqual(plan.map(p => p.exec), ['Рябов В.А.', 'Лебедев А.И.', 'Кузнецова О.И.', 'Тихонова Н.П.', 'Лаптева В.Н.']);
    assert.strictEqual(plan[0].seen, 'нет');
    assert.ok(plan.every(p => p.execLogin && p.seen && p.mentorLogin && p.managerLogin), 'поля масок заполнены');
    assert.strictEqual(plan[4].execLogin, 'нет'); // у новичка ещё нет учётки
    assert.deepStrictEqual(C.missing(plan), []);
    const noMentor = C.planSteps(route, { newbie: { name: 'Х', offer: D('2026-11-25'), start: D('2026-12-01') }, roles, mentor: null, manager: { name: 'Т', login: 't' } });
    assert.deepStrictEqual(C.missing(noMentor), ['Знакомство: нет исполнителя (Наставник)']);
});

test('светофор: просрочка ИТ - «доступы не выданы», встреча наставника, отчёт по испытательному; жёлтый - срок на носу', () => {
    const s = (o) => Object.assign({ name: 'x', role: 'HR', type: 'Задача', due: TODAY + 5, done: null }, o);
    const red = C.light([s({ role: 'ИТ', due: D('2026-11-20') }), s({ role: 'Наставник', type: 'Встреча', due: D('2026-11-24') }), s({ done: D('2026-11-01'), due: D('2026-11-02') })], TODAY, 2);
    assert.strictEqual(red.color, 'red');
    assert.deepStrictEqual(red.reasons.map(r => [r.text, r.days]), [['доступы не выданы', 6], ['встреча с наставником просрочена', 2]]);
    assert.strictEqual(C.light([s({ role: 'Руководитель', type: 'Контрольная точка', due: TODAY - 1 })], TODAY, 2).reasons[0].text, 'отчёт по испытательному не сдан');
    assert.strictEqual(C.light([s({ due: TODAY + 2 })], TODAY, 2).color, 'yellow');
    assert.strictEqual(C.light([s({ due: TODAY + 3 })], TODAY, 2).color, 'green');
    assert.strictEqual(C.light([s({ due: TODAY - 3, done: TODAY - 1 })], TODAY, 2).color, 'green'); // сделано с опозданием - не красный
    assert.strictEqual(C.stepState(s({ due: TODAY - 3, done: TODAY - 1 }), TODAY), 'late');
});

test('испытательный срок, прогресс и панель «Застряли / Идут / Завершают»', () => {
    const p = C.probation(D('2026-11-23'), TODAY, 60);
    assert.deepStrictEqual([p.day, p.left, C.fmtD(p.end)], [4, 56, '21.01.2027']);
    assert.strictEqual(C.probation(D('2026-12-01'), TODAY, 90).day, -5);
    assert.deepStrictEqual(C.progress([{ done: 1 }, { done: null }, { done: 3 }, { done: null }]), { total: 4, done: 2, pct: 50 });
    const green = { color: 'green', reasons: [], soon: [] }, red = { color: 'red', reasons: [{}], soon: [] };
    assert.strictEqual(C.bucketOf({ status: 'Испытательный срок' }, red, p), 'stuck');
    assert.strictEqual(C.bucketOf({ status: 'Испытательный срок' }, green, p), 'going');
    assert.strictEqual(C.bucketOf({ status: 'Испытательный срок' }, green, C.probation(D('2026-09-01'), TODAY, 90)), 'finishing');
    assert.strictEqual(C.bucketOf({ status: 'Оффер принят' }, green, C.probation(D('2026-12-01'), TODAY, 90)), 'offer');
    assert.strictEqual(C.bucketOf({ status: 'Подготовка к выходу' }, green, C.probation(D('2026-12-01'), TODAY, 90)), 'prep');
    assert.strictEqual(C.bucketOf({ status: 'Ушёл на испытательном' }, red, p), 'archive');
});

test('проверка маршрута: занятый порядок, нет роли, срок после испытательного - ошибки; заявка в день выхода и нет итоговой точки - предупреждения', () => {
    const ok = C.validateRoute([step({ name: 'А', order: 1, role: 'ИТ', type: 'Заявка', offset: -2 }), step({ name: 'Итог', order: 2, role: 'Руководитель', type: 'Контрольная точка', offset: 55 })], 60);
    assert.deepStrictEqual([ok.ok, ok.errors, ok.warns], [true, [], []]);
    const bad = C.validateRoute([step({ name: 'А', order: 1 }), step({ name: 'Б', order: 1, role: '' }), step({ name: 'В', order: 3, offset: 61 }), step({ name: 'Г', order: 4, type: 'Заявка', offset: 0 })], 60);
    assert.strictEqual(bad.ok, false);
    assert.deepStrictEqual(bad.errors, ['Б: не выбрана роль исполнителя', 'Б: порядок 1 уже занят шагом «А»', 'В: срок позже конца испытательного (60 дн)']);
    assert.strictEqual(bad.warns.length, 2);
    assert.ok(/новичок будет ждать/.test(bad.warns[0]) && /итоговой контрольной точки/.test(bad.warns[1]));
});

test('решение по испытательному: «Расстаться» с причиной, «Продлить» с комментарием', () => {
    assert.deepStrictEqual(C.decisionErrors('Оставить', '', ''), []);
    assert.strictEqual(C.decisionErrors('Расстаться', '', '').length, 1);
    assert.deepStrictEqual(C.decisionErrors('Расстаться', 'Условия труда и график', ''), []);
    assert.strictEqual(C.decisionErrors('Продлить', '', ' ').length, 1);
    assert.strictEqual(C.decisionErrors('', '', '').length, 1);
    assert.strictEqual(C.statusAfter('Расстаться'), 'Ушёл на испытательном');
});

test('план новичка на сегодня: просрочено, сегодня, неделя, позже', () => {
    const r = C.todayPlan([{ due: TODAY - 2, done: null, order: 1 }, { due: TODAY, done: null, order: 2 }, { due: TODAY + 4, done: null, order: 3 }, { due: TODAY + 20, done: null, order: 4 }, { due: TODAY - 9, done: TODAY - 9, order: 5 }], TODAY);
    assert.deepStrictEqual([r.overdue.length, r.today.length, r.week.length, r.later.length, r.done.length], [1, 1, 1, 1, 1]);
});

test('отчёт по подразделениям: доля ушедших от завершивших, главная пробка, задержка ИТ, отказ до выхода отдельно', () => {
    const st = (name, role, due, done) => ({ name, role, due: D(due), done: done ? D(done) : null });
    const nb = [
        { dept: 'Склад', status: 'Ушёл на испытательном', reason: 'Условия труда и график', start: D('2026-06-01'), steps: [st('WMS', 'ИТ', '2026-05-29', '2026-06-03')] },
        { dept: 'Склад', status: 'Прошёл испытательный', start: D('2026-06-08'), steps: [st('WMS', 'ИТ', '2026-06-05', '2026-06-07'), st('Допуск', 'Охрана труда', '2026-06-15', '2026-06-15')] },
        { dept: 'Склад', status: 'Испытательный срок', start: D('2026-11-23'), steps: [st('WMS', 'ИТ', '2026-11-20', null)] },
        { dept: 'Склад', status: 'Отказался до выхода', start: D('2026-11-02'), steps: [] },
        { dept: 'Склад', status: 'Оффер принят', start: D('2026-12-07'), steps: [] },
        { dept: 'Офис', status: 'Прошёл испытательный', start: D('2026-07-01'), steps: [st('Ноутбук', 'ИТ', '2026-06-29', '2026-06-29')] }];
    const r = C.deptReport(nb, TODAY, 2);
    assert.deepStrictEqual(r.map(d => d.dept), ['Склад', 'Офис']);
    const s = r[0];
    assert.deepStrictEqual([s.started, s.passed, s.left, s.active, s.refused, s.leftPct], [3, 1, 1, 1, 1, 50]);
    assert.deepStrictEqual([s.top[0].name, s.top[0].count, s.top[0].days], ['WMS', 3, 5 + 2 + 6]);
    assert.strictEqual(s.itAvg, 4.3);
    assert.strictEqual(s.topReason, 'Условия труда и график');
    assert.deepStrictEqual([r[1].leftPct, r[1].top.length], [0, 0]);
});

test('CSV: точка с запятой и кавычки экранируются', () => {
    assert.strictEqual(C.toCsv([['a;b', 'c"d', 1]]), '"a;b";"c""d";1');
});
