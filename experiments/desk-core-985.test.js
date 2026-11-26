// rules: none (defect #5735)
// Service Desk (демо-копия, ideav/backlogram#985): рабочий календарь, срок SLA в рабочих часах с паузой, очередь, подбор услуги, форма, маршрут, отчёт SLA.
const test = require('node:test');
const assert = require('node:assert');
const C = require('../download/desk/js/desk-core.js');

const cal = C.calendar({ dayStart: 9, dayEnd: 18 }, { '2026-11-04': 1 });
const T = (s) => C.parseDt(s);
const svc = (o) => Object.assign({ name: 'S', reactH: 2, solveH: 10, route: '' }, o || {});

test('время: строка Москвы и epoch-секунды DATETIME ядра дают одну минуту', () => {
    assert.strictEqual(C.fmtDt(T('2026-11-23 10:15')), '2026-11-23 10:15');
    assert.strictEqual(C.parseDt('1795418100'), T('2026-11-23 10:15'));
    assert.strictEqual(C.parseDt('26.11.2026 11:30:00'), T('2026-11-26 11:30'));
    assert.strictEqual(C.parseDt(''), null);
});

test('рабочие минуты: ночь, выходные и праздник не считаются', () => {
    assert.strictEqual(C.workBetween(T('2026-11-26 17:00'), T('2026-11-27 10:00'), cal), 120);
    assert.strictEqual(C.workBetween(T('2026-11-27 17:00'), T('2026-11-30 10:00'), cal), 120); // пятница -> понедельник
    assert.strictEqual(C.workBetween(T('2026-11-03 17:00'), T('2026-11-05 10:00'), cal), 120); // 4 ноября выходной
    assert.strictEqual(C.workBetween(T('2026-11-26 07:00'), T('2026-11-26 08:30'), cal), 0);
});

test('срок: 10 рабочих часов от 11:30 четверга - пятница 12:30; от пятницы - через выходные', () => {
    assert.strictEqual(C.fmtDt(C.addWork(T('2026-11-26 11:30'), 600, cal)), '2026-11-27 12:30');
    assert.strictEqual(C.fmtDt(C.addWork(T('2026-11-27 15:00'), 240, cal)), '2026-11-30 10:00');
    assert.strictEqual(C.fmtDt(C.addWork(T('2026-11-26 20:00'), 60, cal)), '2026-11-27 10:00');
});

test('приоритет сжимает срок; срок не короче 30 минут', () => {
    assert.deepStrictEqual(C.budget(svc(), { mult: 0.5 }), { react: 60, solve: 300 });
    assert.deepStrictEqual(C.budget(svc({ reactH: 0.5 }), { mult: 0.25 }), { react: 30, solve: 150 });
    const d = C.deadlines(T('2026-11-26 11:30'), svc(), { mult: 1 }, cal, 90);
    assert.strictEqual(C.fmtDt(d.solve), '2026-11-27 14:00');
});

test('таймер: в срок, скоро срок, просрочка, пауза «ждём заявителя» не съедает срок', () => {
    const base = { created: T('2026-11-26 09:00'), solveBudget: 240, pauseMin: 0, pausedFrom: null, resolved: null, timer: 'идёт' };
    assert.strictEqual(C.slaState(base, T('2026-11-26 10:00'), cal, 80).state, 'ok');
    assert.strictEqual(C.slaState(base, T('2026-11-26 12:20'), cal, 80).state, 'warn');
    const br = C.slaState(base, T('2026-11-26 13:30'), cal, 80);
    assert.strictEqual(br.state, 'breach'); assert.strictEqual(br.left, -30);
    const p = C.slaState(Object.assign({}, base, { pausedFrom: T('2026-11-26 10:00'), timer: 'пауза' }), T('2026-11-26 16:00'), cal, 80);
    assert.strictEqual(p.state, 'paused'); assert.strictEqual(p.used, 60);
    assert.strictEqual(C.fmtDt(p.deadline), '2026-11-27 10:00');
    const done = C.slaState(Object.assign({}, base, { pauseMin: 120, resolved: T('2026-11-26 15:00'), timer: 'стоп' }), T('2026-11-27 12:00'), cal, 80);
    assert.strictEqual(done.state, 'met');
});

test('очередь: просрочка важнее «без исполнителя», согласование отдельно, закрытые не в очереди', () => {
    const t = (o) => Object.assign({ status: 'Новая', exec: '', sla: { state: 'ok' } }, o);
    const b = C.buckets([t({ sla: { state: 'breach' } }), t({}), t({ exec: 'X', sla: { state: 'warn' } }), t({ status: 'Ждём заявителя', exec: 'X' }), t({ status: 'На согласовании' }), t({ status: 'Закрыта' }), t({ exec: 'X', status: 'В работе' })]);
    assert.deepStrictEqual(Object.keys(b).map(k => k + ':' + b[k].length).join(' '), 'overdue:1 soon:1 unassigned:1 waiting:1 approval:1 inwork:1');
});

test('«Мне нужно…»: «не открывается дверь в 304» -> ремонт помещения и помещение 304', () => {
    const cat = [
        { name: 'Не работает компьютер или ноутбук', keywords: 'компьютер ноутбук не включается', group: 'Рабочее место' },
        { name: 'Ремонт помещения: дверь, замок, мебель', keywords: 'дверь замок ручка не открывается', group: 'Помещения' },
        { name: 'Справка 2-НДФЛ', keywords: 'ндфл доход', group: 'Справки' }];
    const r = C.matchServices('не открывается дверь в 304', cat);
    assert.strictEqual(r[0].svc.name, 'Ремонт помещения: дверь, замок, мебель');
    assert.strictEqual(r.length, 1);
    assert.strictEqual(C.findRoom('не открывается дверь в 304', [{ name: '303' }, { name: '304' }]).name, '304');
    assert.strictEqual(C.findRoom('дверь в 3040', [{ name: '304' }]), null);
    assert.deepStrictEqual(C.matchServices('', cat), []);
});

test('поля формы: обязательные, дата, число, выбор; текст заявки из полей', () => {
    const f = C.parseForm('ФИО гостя*\nДата визита*:date\nЭкземпляров:number\nГод*:2025|2026');
    assert.deepStrictEqual(f.map(x => [x.name, x.req, x.type]), [['ФИО гостя', true, 'text'], ['Дата визита', true, 'date'], ['Экземпляров', false, 'number'], ['Год', true, 'select']]);
    assert.deepStrictEqual(C.validateForm(f, { 'Дата визита': '01.12.2026', 'Экземпляров': 'два', 'Год': '2024' }),
        ['Заполните поле «ФИО гостя»', '«Дата визита»: нужна дата', '«Экземпляров»: нужно число', '«Год»: выберите из списка']);
    assert.deepStrictEqual(C.validateForm(f, { 'ФИО гостя': 'Пе', 'Дата визита': '2026-12-01', 'Год': '2026' }), []);
    assert.strictEqual(C.formText(f, { 'ФИО гостя': 'Петров', 'Год': '2026' }, 'Срочно'), 'ФИО гостя: Петров\nГод: 2026\nСрочно');
});

test('маршрут: руководитель заявителя, затем руководитель службы; отклонение останавливает', () => {
    const s = C.routeSteps({ route: 'Руководитель, Руководитель службы' }, { manager: 'Крылов Д.О.', managerLogin: 'approver' }, { head: 'Соколов А.В.', headLogin: 'head' });
    assert.deepStrictEqual(s.map(x => [x.step, x.who, x.login]), [[1, 'Крылов Д.О.', 'approver'], [2, 'Соколов А.В.', 'head']]);
    assert.deepStrictEqual(C.routeSteps({ route: '' }, null, null), []);
    assert.strictEqual(C.routeProgress([{ step: 2, decision: '' }, { step: 1, decision: 'Согласовано' }]).current.step, 2);
    assert.deepStrictEqual(C.routeProgress([{ step: 1, decision: 'Отклонено' }, { step: 2, decision: '' }]), { done: true, rejected: true, current: null });
    assert.strictEqual(C.routeProgress([{ step: 1, decision: 'Согласовано' }]).done, true);
});

test('отчёт SLA: % в срок за период по ключу, открытые с просрочкой отдельно, худший первым', () => {
    const t = (k, res, state, o) => Object.assign({ k, resolved: res === null ? null : T(res), status: res === null ? 'В работе' : 'Закрыта', sla: { state }, reactOk: true }, o || {});
    const list = [t('A', '2026-11-10', 'met'), t('A', '2026-11-11', 'missed'), t('A', '2026-11-12', 'missed'), t('A', null, 'breach'),
        t('B', '2026-11-10', 'met'), t('B', '2026-11-12', 'met', { reactOk: false }), t('B', '2026-10-01', 'missed'), t('B', null, 'ok', { status: 'На согласовании' })];
    const r = C.slaReport(list, x => x.k, T('2026-11-01'), T('2026-12-01'));
    assert.deepStrictEqual(r.map(x => [x.key, x.total, x.inTime, x.pct, x.open, x.breachOpen]), [['A', 3, 1, 33.3, 1, 1], ['B', 2, 2, 100, 0, 0]]);
    assert.strictEqual(r[1].reactPct, 50);
});

test('повторы и автозакрытие: та же беда в том же помещении; решённая закрывается через 3 раб. дня', () => {
    const z = (n, d, room) => ({ num: n, service: 'Дверь', room, created: T(d) });
    const r = C.repeats([z(1, '2026-10-08', '304'), z(2, '2026-11-05', '304'), z(3, '2026-11-19', '304'), z(4, '2026-11-20', '301')], 30);
    assert.deepStrictEqual(r.map(x => [x.room, x.items.map(i => i.num)]), [['304', [1, 2, 3]]]);
    const s = { status: 'Решена', resolved: T('2026-11-20 14:00') };
    assert.strictEqual(C.autoCloseDue(s, T('2026-11-25 13:00'), cal, 3), false);
    assert.strictEqual(C.autoCloseDue(s, T('2026-11-25 14:00'), cal, 3), true);
    assert.strictEqual(C.nextNumber([{ num: 'SD-24223' }, { num: 'SD-24101' }]), 'SD-24224');
});
