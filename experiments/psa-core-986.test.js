// rules: none (defect #5685)
// PSA (демо-копия, ideav/backlogram#986): чистые функции ёмкости, загрузки, проверки брони, подбора и маржи.
const test = require('node:test');
const assert = require('node:assert');
const C = require('../download/psa/js/psa-core.js');

const emp = (name, o) => Object.assign({ name, fte: 1, cost: 1000, grade: 'middle', pool: 'Разработка' }, o || {});
const bk = (id, e, project, from, to, hpw, o) => Object.assign({ id, emp: e, project, from, to, hpw, kind: 'Мягкая', status: 'Подтверждена' }, o || {});

test('даты: понедельник недели и список недель', () => {
    assert.strictEqual(C.weekStart('2026-11-25'), '2026-11-23');
    assert.strictEqual(C.weekStart('2026-11-22'), '2026-11-16');
    assert.deepStrictEqual(C.weeksFrom('2026-11-25', 3), ['2026-11-23', '2026-11-30', '2026-12-07']);
    assert.strictEqual(C.toIso('05.12.2026'), '2026-12-05');
});

test('ёмкость: обычная неделя 40 ч, праздник и сокращённый день учтены, ставка и отпуск режут часы', () => {
    const hol = { '2026-11-03': 7, '2026-11-04': 0 };
    assert.strictEqual(C.capacityWeek(emp('A'), '2026-11-23', hol, []).cap, 40);
    assert.strictEqual(C.capacityWeek(emp('A'), '2026-11-02', hol, []).cap, 31);
    assert.strictEqual(C.capacityWeek(emp('A', { fte: 0.5 }), '2026-11-23', hol, []).cap, 20);
    const c = C.capacityWeek(emp('A'), '2026-11-23', hol, [{ from: '2026-11-25', to: '2026-12-01' }]);
    assert.strictEqual(c.cap, 16);
    assert.strictEqual(c.absent, 24);
});

test('часы брони пропорциональны рабочим дням внутри срока и праздникам', () => {
    const hol = { '2026-11-04': 0 };
    const b = bk('1', 'A', 'P', '2026-11-02', '2026-11-30', 30);
    assert.strictEqual(C.bookingHoursWeek(b, '2026-11-02', hol), 24);
    assert.strictEqual(C.bookingHoursWeek(b, '2026-11-09', hol), 30);
    const half = bk('2', 'A', 'P', '2026-11-25', '2026-11-30', 40);
    assert.strictEqual(C.bookingHoursWeek(half, '2026-11-23', {}), 24);
});

test('загрузка: три брони дают перегрузку, процент считается от ёмкости с отпуском', () => {
    const e = emp('A');
    const b = [bk('1', 'A', 'P1', '2026-12-07', '2027-02-26', 20), bk('2', 'A', 'P2', '2026-12-07', '2027-02-26', 20), bk('3', 'A', 'P3', '2026-12-07', '2027-02-26', 12)];
    const l = C.loadWeek(e, '2026-12-14', b, {}, []);
    assert.strictEqual(l.plan, 52);
    assert.strictEqual(l.pct, 130);
    assert.strictEqual(C.loadClass(l), 'crit');
    const v = C.loadWeek(e, '2026-12-14', b.slice(0, 2), {}, [{ from: '2026-12-16', to: '2026-12-18' }]);
    assert.strictEqual(v.cap, 16);
    assert.strictEqual(v.pct, 250);
});

test('классы: свободен, норма, высокая, овербукинг, критично, отпуск, праздник', () => {
    const mk = (plan, cap, base) => ({ plan, cap, base: base === undefined ? 40 : base, pct: cap ? plan / cap * 100 : null });
    assert.strictEqual(C.loadClass(mk(10, 40)), 'free');
    assert.strictEqual(C.loadClass(mk(30, 40)), 'ok');
    assert.strictEqual(C.loadClass(mk(38, 40)), 'high');
    assert.strictEqual(C.loadClass(mk(42, 40)), 'warn');
    assert.strictEqual(C.loadClass(mk(46, 40)), 'crit');
    assert.strictEqual(C.loadClass(mk(0, 0)), 'away');
    assert.strictEqual(C.loadClass(mk(0, 0, 0)), 'holiday');
});

test('отклонённые и истёкшие брони не считаются, запрошенные считаются по умолчанию', () => {
    const e = emp('A');
    const b = [bk('1', 'A', 'P', '2026-11-23', '2026-12-04', 20, { status: 'Отклонена' }), bk('2', 'A', 'Q', '2026-11-23', '2026-12-04', 10, { status: 'Запрошена' }), bk('3', 'A', 'R', '2026-11-23', '2026-12-04', 10, { status: 'Истекла' })];
    assert.strictEqual(C.loadWeek(e, '2026-11-23', b, {}, []).plan, 10);
    assert.strictEqual(C.loadWeek(e, '2026-11-23', b, {}, [], { pending: false }).plan, 0);
});

test('проверка при вводе: до 110% - предупреждение, выше - ошибка, правило лимита меняется без правки кода', () => {
    const e = emp('A');
    const ex = [bk('1', 'A', 'P1', '2026-12-07', '2026-12-25', 36)];
    const warn = C.checkBooking(e, bk('n', 'A', 'P2', '2026-12-07', '2026-12-11', 6), ex, {}, []);
    assert.strictEqual(warn.ok, true);
    assert.strictEqual(warn.warnings.length, 1);
    const bad = C.checkBooking(e, bk('n', 'A', 'P2', '2026-12-07', '2026-12-11', 20), ex, {}, []);
    assert.strictEqual(bad.ok, false);
    assert.match(bad.errors[0], /Перегрузка 140%/);
    const loose = Object.assign({}, C.DEFAULT_RULES, { overbook: 150 });
    assert.strictEqual(C.checkBooking(e, bk('n', 'A', 'P2', '2026-12-07', '2026-12-11', 20), ex, {}, [], loose).ok, true);
});

test('проверка при вводе: овербукинг дольше 2 недель подряд и вторая жёсткая бронь запрещены', () => {
    const e = emp('A');
    const ex = [bk('1', 'A', 'P1', '2026-12-07', '2026-12-25', 40)];
    const long = C.checkBooking(e, bk('n', 'A', 'P2', '2026-12-07', '2026-12-25', 2), ex, {}, []);
    assert.strictEqual(long.ok, false);
    assert.ok(long.errors.some(x => /дольше 2 недель/.test(x)));
    const hardEx = [bk('1', 'A', 'P1', '2026-12-07', '2026-12-11', 30, { kind: 'Жёсткая' })];
    const hard = C.checkBooking(e, bk('n', 'A', 'P2', '2026-12-07', '2026-12-11', 20, { kind: 'Жёсткая' }), hardEx, {}, []);
    assert.ok(hard.errors.some(x => /жёсткая бронь/.test(x)));
});

test('изменение существующей брони не считается дважды', () => {
    const e = emp('A');
    const ex = [bk('1', 'A', 'P1', '2026-12-07', '2026-12-11', 40)];
    const r = C.checkBooking(e, bk('1', 'A', 'P1', '2026-12-07', '2026-12-11', 30), ex, {}, []);
    assert.strictEqual(r.weeks[0].plan, 30);
    assert.strictEqual(r.ok, true);
});

test('подбор: навык и грейд фильтруют, свободный раньше занятого, отпуск уменьшает свободное время', () => {
    const emps = [emp('Свободный', { grade: 'senior' }), emp('Занятой', { grade: 'senior' }), emp('Младший', { grade: 'junior' }), emp('Без навыка', { grade: 'senior' }), emp('В отпуске', { grade: 'senior' })];
    const skills = { 'Свободный': [{ skill: 'Java', level: 4 }], 'Занятой': [{ skill: 'Java', level: 5 }], 'Младший': [{ skill: 'Java', level: 3 }], 'В отпуске': [{ skill: 'Java', level: 4 }] };
    const bookings = [bk('1', 'Занятой', 'P', '2026-12-07', '2027-01-29', 38)];
    const abs = { 'В отпуске': [{ from: '2026-12-07', to: '2026-12-25' }] };
    const r = C.findCandidates(emps, skills, bookings, {}, abs, { skill: 'Java', minLevel: 3, minGrade: 'middle', from: '2026-12-07', to: '2026-12-25', hpw: 20 });
    assert.strictEqual(r[0].emp.name, 'Свободный');
    assert.strictEqual(r[0].fits, true);
    assert.ok(r.every(x => x.emp.name !== 'Младший' && x.emp.name !== 'Без навыка'));
    assert.strictEqual(r.filter(x => x.emp.name === 'Занятой')[0].fits, false);
    assert.strictEqual(r.filter(x => x.emp.name === 'В отпуске')[0].fits, false);
});

test('план-факт и утилизация: внутренние проекты не оплачиваются', () => {
    const e = emp('A');
    const ts = [{ emp: 'A', week: '2026-11-16', project: 'Заказ', hours: 28 }, { emp: 'A', week: '2026-11-16', project: 'Внутр', hours: 6 }];
    const projects = [{ name: 'Заказ', contract: 'T&M' }, { name: 'Внутр', contract: 'Внутренний' }];
    const u = C.utilization([e], ['2026-11-16'], ts, projects, {}, {});
    assert.strictEqual(u.cap, 40);
    assert.strictEqual(u.billablePct, 70);
    assert.strictEqual(u.totalPct, 85);
    const pf = C.planFact(e, '2026-11-16', [bk('1', 'A', 'Заказ', '2026-11-02', '2026-12-04', 30)], ts, {});
    assert.deepStrictEqual(pf, { plan: 30, fact: 34, diff: 4 });
});

test('бенч: свободные часы, FTE и стоимость по себестоимости', () => {
    const emps = [emp('A', { cost: 1000 }), emp('B', { cost: 2000 })];
    const b = C.bench(emps, '2026-11-23', [bk('1', 'A', 'P', '2026-11-23', '2026-12-04', 30)], {}, {});
    assert.strictEqual(b.free, 50);
    assert.strictEqual(b.cost, 10 * 1000 + 40 * 2000);
});

test('маржа: T&M по ставкам грейда, FP по готовности, остаток плана из броней', () => {
    const emps = [emp('A', { grade: 'senior', cost: 2000 }), emp('B', { grade: 'junior', cost: 800 })];
    const rates = { 'T|senior': 4000, 'T|junior': 1500, 'F|senior': 4000, 'F|junior': 1500 };
    const ts = [{ emp: 'A', week: '2026-11-09', project: 'T', hours: 40 }, { emp: 'B', week: '2026-11-09', project: 'T', hours: 20 }, { emp: 'A', week: '2026-11-09', project: 'F', hours: 40 }];
    const bookings = [bk('1', 'A', 'T', '2026-11-02', '2026-12-04', 20), bk('2', 'A', 'F', '2026-11-02', '2026-12-04', 20)];
    const t = C.projectMargin({ name: 'T', contract: 'T&M', from: '2026-09-01', to: '2026-12-04', budgetHours: 80 }, emps, rates, ts, bookings, {}, '2026-11-23');
    assert.strictEqual(t.revFact, 40 * 4000 + 20 * 1500);
    assert.strictEqual(t.costFact, 40 * 2000 + 20 * 800);
    assert.strictEqual(t.forecastHours, 60 + 40);
    assert.strictEqual(t.overrunPct, 25);
    const f = C.projectMargin({ name: 'F', contract: 'FP', price: 400000, ready: 50, from: '2026-09-01', to: '2026-12-04', budgetHours: 100 }, emps, rates, ts, bookings, {}, '2026-11-23');
    assert.strictEqual(f.revFact, 200000);
    assert.strictEqual(f.marginFact, 200000 - 80000);
    assert.strictEqual(f.revPlan, 400000);
    assert.strictEqual(f.costPlan, 80000 + 40 * 2000);
});

test('проверка при вводе: бронь через отпуск даёт предупреждение, а не перегрузку 999%', () => {
    const e = emp('A');
    const r = C.checkBooking(e, bk('n', 'A', 'P', '2026-12-07', '2026-12-25', 20), [], {}, [{ from: '2026-12-14', to: '2026-12-18' }]);
    assert.strictEqual(r.ok, true);
    assert.ok(r.warnings.some(w => /отпуске или на больничном/.test(w)));
    assert.ok(!r.errors.some(w => /999/.test(w)));
});
