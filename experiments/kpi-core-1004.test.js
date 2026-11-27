// rules: none (defect #5771)
// KPI и премии (демо-копия, ideav/backlogram#1004): чистые функции расчёта премии по правилам компании.
const test = require('node:test');
const assert = require('node:assert');
const C = require('../download/kpi/js/kpi-core.js');

const REV = { name: 'Выручка', unit: 'млн ₽', dir: 'Больше - лучше', kind: 'Количественный' };
const NEW = { name: 'Новые клиенты', unit: 'шт', dir: 'Больше - лучше', kind: 'Количественный' };
const DEBT = { name: 'Просроченная дебиторка', unit: '%', dir: C.LESS, kind: 'Количественный' };
const CMP = { name: 'Жалобы клиентов', unit: 'шт', dir: C.LESS, kind: C.BLOCK };
const sales = () => ({ threshold: 50, cap: 130, ratingStep: 5, partMode: 'Пропорционально',
    steps: [{ from: 100, coef: 1 }, { from: 110, coef: 1.15 }, { from: 120, coef: 1.3 }],
    lines: [{ ind: REV, weight: 60, scale: 'Ступенчатая' }, { ind: NEW, weight: 20, scale: 'Линейная' }, { ind: DEBT, weight: 20, scale: 'Линейная' }, { ind: CMP, weight: 0, scale: 'Линейная' }] });
const emp = (name, o) => Object.assign({ name, salary: 80000, targetPct: 25, scheme: 'Продажи', num: 'ТН-' + name.length }, o || {});
const V = (rev, nw, debt, cmp) => ({ 'Выручка': { plan: 5, fact: rev }, 'Новые клиенты': { plan: 10, fact: nw }, 'Просроченная дебиторка': { plan: 5, fact: debt }, 'Жалобы клиентов': { plan: 0, fact: cmp } });

test('выполнение: больше-лучше и меньше-лучше; план 0 - не делим на ноль', () => {
    assert.strictEqual(C.achievement(REV, 5, 4), 0.8);
    assert.strictEqual(C.achievement(DEBT, 5, 4), 1.25);
    assert.strictEqual(C.achievement(DEBT, 5, 0, 1.3), 1.3);
    assert.strictEqual(C.achievement(REV, 0, 4), null);
    assert.deepStrictEqual(C.coefficient(null, sales(), 'Линейная'), { coef: 0, flag: 'noplan' });
});

test('порог: ниже 50 % - ноль, на пороге - начисляется', () => {
    assert.deepStrictEqual(C.coefficient(0.49, sales(), 'Линейная'), { coef: 0, flag: 'below' });
    assert.strictEqual(C.coefficient(0.5, sales(), 'Линейная').coef, 0.5);
});

test('ступенчатая шкала и потолок: 115 % = 1,15; 160 % режется потолком 1,3', () => {
    assert.strictEqual(C.coefficient(0.9, sales(), 'Ступенчатая').coef, 0.9);
    assert.strictEqual(C.coefficient(1.05, sales(), 'Ступенчатая').coef, 1);
    assert.strictEqual(C.coefficient(1.15, sales(), 'Ступенчатая').coef, 1.15);
    assert.deepStrictEqual(C.coefficient(1.6, sales(), 'Линейная'), { coef: 1.3, flag: 'capped' });
});

test('премия: веса, множитель оценки, сумма в рублях', () => {
    const r = C.calcEmployee(emp('Иванов'), sales(), V(5, 10, 5, 0), [4, 4, 4], null, null);
    assert.strictEqual(r.target, 20000);
    assert.strictEqual(r.sumCoef, 1);
    assert.strictEqual(r.mult, 1.05);
    assert.strictEqual(r.calc, 21000);
    assert.strictEqual(r.total, 21000);
});

test('блокирующий показатель обнуляет премию и называет причину', () => {
    const r = C.calcEmployee(emp('Сидоров'), sales(), V(6, 12, 3, 2), [5], null, null);
    assert.strictEqual(r.blocked, true);
    assert.strictEqual(r.total, 0);
    assert.match(r.blockReason, /Жалобы клиентов: 2/);
    assert.strictEqual(r.flags[0], 'block');
});

test('неполный месяц: пропорционально или полностью - по правилу схемы', () => {
    const ts = { norm: 22, worked: 11 };
    assert.strictEqual(C.calcEmployee(emp('А'), sales(), V(5, 10, 5, 0), [], ts).calc, 10000);
    const full = Object.assign(sales(), { partMode: 'Полностью' });
    assert.strictEqual(C.calcEmployee(emp('А'), full, V(5, 10, 5, 0), [], ts).calc, 20000);
});

test('корректировка: без причины - ошибка, снижение больше 20 % - предупреждение, итог не меньше нуля', () => {
    assert.strictEqual(C.checkCorrection(20000, 5000, '').errors.length, 1);
    assert.strictEqual(C.checkCorrection(20000, 5000, 'Закрыл сделку года').errors.length, 0);
    assert.strictEqual(C.checkCorrection(20000, -5000, 'Опоздания').warnings.length, 1);
    assert.strictEqual(C.checkCorrection(20000, -3000, 'Опоздания').warnings.length, 0);
    assert.strictEqual(C.checkCorrection(1000, -2000, 'x').errors.length, 1);
    const r = C.calcEmployee(emp('Б'), sales(), V(5, 10, 5, 0), [], null, { sum: -2000, reason: 'Опоздания' });
    assert.strictEqual(r.total, 18000);
});

test('«что если» порог 60 %: снимается доля у тех, кто между 50 и 60 %, ФОТ уменьшается на разницу', () => {
    const ctx = { emps: [emp('Иванов'), emp('Петров')], schemes: { 'Продажи': sales() },
        vals: { 'Иванов': V(5, 10, 5, 0), 'Петров': V(5, 5.5, 5, 0) } };
    const w = C.whatIf(ctx, { 'Продажи': { threshold: 60 } });
    assert.strictEqual(w.changed.length, 1);
    assert.strictEqual(w.changed[0].emp.name, 'Петров');
    assert.strictEqual(w.changed[0].delta, -2200);
    assert.strictEqual(w.delta, -2200);
    assert.strictEqual(C.calcPeriod(ctx).fot, w.before);
});

test('проверка схемы: веса не 100 %, ступени и потолок', () => {
    assert.deepStrictEqual(C.validateScheme(sales()), []);
    const bad = sales(); bad.lines[0].weight = 50; bad.cap = 120;
    const e = C.validateScheme(bad);
    assert.ok(e.some(x => /Сумма весов 90/.test(x)));
    assert.ok(e.some(x => /выше потолка/.test(x)));
});

test('пояснение строки и правила словами', () => {
    const r = C.calcEmployee(emp('В'), sales(), V(2, 10, 5, 0), [], null);
    assert.match(C.explainLine(r.lines[0], sales()), /ниже порога 50 %/);
    assert.match(C.explainLine(r.lines[3], sales()), /не блокирует/);
    assert.ok(C.formulaText(sales()).some(t => /ниже 50 % плана/.test(t)));
});

test('прогноз при текущем темпе и путь до следующей ступени', () => {
    const f = C.forecast(5, 3.6, 18, 21);
    assert.strictEqual(f.fact, 4.2);
    assert.deepStrictEqual(C.nextStep(0.84, sales(), 'Ступенчатая'), { at: 100, gap: 16 });
    assert.deepStrictEqual(C.nextStep(1.12, sales(), 'Ступенчатая'), { at: 120, gap: 8 });
    assert.strictEqual(C.nextStep(1.3, sales(), 'Ступенчатая'), null);
    assert.deepStrictEqual(C.nextStep(0.4, sales(), 'Линейная'), { at: 50, gap: 10 });
});

test('разбор вставки из Excel: табельный номер, ФИО с ё, синоним показателя, ошибки и повторы', () => {
    const emps = [{ name: 'Ковалёв Денис Игоревич', num: 'ТН-0101' }, { name: 'Сидоров Пётр', num: 'ТН-0102' }];
    const inds = [{ name: 'Выручка', syn: 'Продажи, руб;Оборот' }, { name: 'Новые клиенты' }];
    const T = String.fromCharCode(9), N = String.fromCharCode(10);
    const txt = [['Таб. номер', 'Сотрудник', 'Показатель', 'План', 'Факт'], ['ТН-0101', '', 'Выручка', '5', '4,2'], ['', 'ковалев денис игоревич', 'Новые клиенты', '10', '7'],
        ['', 'Сидоров Пётр', 'Оборот', '5', '6'], ['', 'Нет Такого', 'Выручка', '5', '1'], ['ТН-0101', '', 'Выручка', '5', '4,3'], ['', 'Сидоров Пётр', 'Новые клиенты', '10', 'н/д']].map(r => r.join(T)).join(N);
    const p = C.parseFacts(txt, emps, inds);
    assert.strictEqual(p.rows.length, 3);
    assert.strictEqual(p.rows[1].matchedBy, 'ФИО');
    assert.strictEqual(p.rows[2].ind, 'Выручка');
    assert.strictEqual(p.rows[0].fact, 4.2);
    assert.strictEqual(p.errors.length, 3);
    assert.ok(p.errors.some(e => /повтор/.test(e)));
});

test('выгрузка в ЗУП: нулевые не выгружаются, контрольная сумма и число строк', () => {
    const rows = [{ emp: { num: 'ТН-1', name: 'А', dept: 'Продажи' }, total: 21000 }, { emp: { num: 'ТН-2', name: 'Б; В', dept: 'Продажи' }, total: 0 }, { emp: { num: 'ТН-3', name: 'Г', dept: 'Склад' }, total: 9500 }];
    const z = C.zupCsv(rows, '10.2026', 'ПремияKPI');
    assert.strictEqual(z.count, 2);
    assert.strictEqual(z.sum, 30500);
    const ln = z.text.split(String.fromCharCode(13, 10));
    assert.strictEqual(ln.length, 4);
    assert.strictEqual(ln[3], 'ИТОГО;2 чел.;;;;30500');
});

test('согласование: просрочка после срока, пока не все согласованы', () => {
    const p = [{ status: 'Согласовано' }, { status: 'На согласовании' }];
    assert.strictEqual(C.approvalState(p, '2026-11-25', '2026-11-26').overdue, true);
    assert.strictEqual(C.approvalState(p, '2026-11-27', '2026-11-26').overdue, false);
    assert.strictEqual(C.approvalState([{ status: 'Согласовано' }], '2026-11-25', '2026-11-26').complete, true);
});
