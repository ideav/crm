// WFM (демо-копия, ideav/crm#5646): чистые функции расчёта проверок ТК, норм и отпусков.
// rules: none (defect #5646)
const test = require('node:test');
const assert = require('node:assert');
const C = require('../download/wfm/js/wfm-core.js');

const sh = (emp, date, start, end, night) => ({ emp, date, start, end, night: night || 0 });

test('даты: перевод ДД.ММ.ГГГГ и арифметика', () => {
    assert.strictEqual(C.toIso('25.11.2026'), '2026-11-25');
    assert.strictEqual(C.toIso('2026-11-25'), '2026-11-25');
    assert.strictEqual(C.addDays('2026-11-30', 1), '2026-12-01');
    assert.strictEqual(C.diffDays('2026-10-01', '2026-11-01'), 31);
});

test('отдых между сменами: 11 ч при правиле 12 ч - нарушение, правило 11 - нет', () => {
    const s = [sh('A', '2026-11-25', '12:00', '21:00'), sh('A', '2026-11-26', '08:00', '17:00')];
    const v = C.restViolations(s, 12);
    assert.strictEqual(v.length, 1);
    assert.strictEqual(v[0].gap, 11);
    assert.strictEqual(v[0].date, '2026-11-26');
    assert.strictEqual(C.restViolations(s, 11).length, 0);
});

test('отдых считается через полночь для переходящей смены', () => {
    const s = [sh('A', '2026-11-03', '21:00', '09:00'), sh('A', '2026-11-04', '17:00', '23:00')];
    assert.strictEqual(C.restViolations(s, 12).length, 1);
    assert.strictEqual(C.restViolations(s, 8).length, 0);
});

test('серия смен подряд: нарушение один раз, на седьмой день', () => {
    const s = [];
    for (let i = 0; i < 12; i++) s.push(sh('A', C.addDays('2026-10-15', i), '09:00', '18:00'));
    const v = C.streakViolations(s, 7);
    assert.deepStrictEqual(v.map(x => x.date), ['2026-10-21']);
    s.splice(3, 1);
    assert.strictEqual(C.streakViolations(s, 7).length, 1);
});

test('ночная смена у сотрудника без ночных', () => {
    const s = [sh('A', '2026-11-09', '21:00', '09:00', 8), sh('B', '2026-11-09', '21:00', '09:00', 8)];
    const v = C.nightViolations(s, { A: true });
    assert.deepStrictEqual(v.map(x => x.emp), ['A']);
});

test('покрытие: считаются разные сотрудники, дни ниже минимума', () => {
    const s = [sh('A', '2026-11-07', '09:00', '18:00'), sh('B', '2026-11-08', '09:00', '18:00'), sh('B', '2026-11-08', '12:00', '13:00'), sh('C', '2026-11-08', '09:00', '18:00')];
    const v = C.coverageViolations(s, 2, ['2026-11-07', '2026-11-08', '2026-11-09']);
    assert.deepStrictEqual(v.map(x => [x.date, x.count]), [['2026-11-07', 1], ['2026-11-09', 0]]);
});

test('разнесение переходящей смены по календарным суткам', () => {
    const a = C.splitShift('2026-11-03', '16:00', '09:00', 120);
    assert.deepStrictEqual(a, [{ date: '2026-11-03', hours: 8, night: 2 }, { date: '2026-11-04', hours: 7, night: 6 }]);
    const b = C.splitShift('2026-11-03', '09:00', '18:00', 60);
    assert.deepStrictEqual(b, [{ date: '2026-11-03', hours: 8, night: 0 }]);
});

test('норма: часы календаря x ставка, дни ОТ и Б вычитаются', () => {
    const cal = { '2026-11-02': 8, '2026-11-03': 7, '2026-11-04': 0, '2026-11-05': 8 };
    assert.strictEqual(C.normHours(cal, '2026-11-02', '2026-11-05', 1, []), 23);
    assert.strictEqual(C.normHours(cal, '2026-11-02', '2026-11-05', 0.5, ['2026-11-05']), 7.5);
});

test('вахта: рабочие дни без дней в пути и прогноз к концу года', () => {
    assert.strictEqual(C.vahtaWorkDays('2026-12-01', '2026-12-30', '2026-11-22', '2026-12-31'), 28);
    assert.strictEqual(C.vahtaWorkDays('2026-11-01', '2026-11-30', '2026-11-22', '2026-12-31'), 7);
    assert.strictEqual(C.vahtaWorkDays('2026-12-31', '2027-01-29', '2026-11-22', '2026-12-31'), 0);
    const f = C.vahtaForecast(1716, [{ start: '2026-12-01', end: '2026-12-30', status: 'План' }], '2026-11-22', '2026-12-31', 12, 1972);
    assert.strictEqual(f.total, 2052);
    assert.strictEqual(f.overtime, 80);
});

test('вахтовые периоды по циклу 30/30', () => {
    const p = C.vahtaPeriods('2026-10-02', 30, 30, '2027-01-01', '2027-03-31');
    assert.deepStrictEqual(p.map(x => x.start), ['2027-01-30', '2027-03-31']);
    assert.strictEqual(p[0].end, '2027-02-28');
});

test('отпуска: часть короче 14, пересечение выше лимита, запретный период, поверх вахты', () => {
    const rows = [
        { emp: 'A', start: '2027-02-01', end: '2027-02-10', days: 10, status: 'Утверждён', dept: 'M' },
        { emp: 'A', start: '2027-05-01', end: '2027-05-10', days: 10, status: 'Утверждён', dept: 'M' },
        { emp: 'B', start: '2027-07-05', end: '2027-07-18', days: 14, status: 'На согласовании', dept: 'M' },
        { emp: 'C', start: '2027-07-05', end: '2027-07-18', days: 14, status: 'На согласовании', dept: 'M' },
        { emp: 'D', start: '2027-07-05', end: '2027-07-18', days: 14, status: 'На согласовании', dept: 'M' },
        { emp: 'E', start: '2027-07-05', end: '2027-07-18', days: 14, status: 'Отклонён', dept: 'M' },
        { emp: 'F', start: '2027-12-20', end: '2027-12-31', days: 12, status: 'Пожелание', dept: 'M' },
        { emp: 'G', start: '2027-02-08', end: '2027-02-21', days: 14, status: 'Пожелание', dept: 'S' }
    ];
    const v = C.vacationChecks(rows, { limits: { M: 2 }, forbidden: { M: ['2027-12-15', '2027-12-31'] }, onSite: { G: [{ start: '2027-01-30', end: '2027-02-28' }] } });
    const by = t => v.filter(x => x.type === t);
    assert.deepStrictEqual(by('minpart').map(x => x.emp), ['A']);
    assert.strictEqual(by('overlap').length, 1);
    assert.strictEqual(by('overlap')[0].max, 3);
    assert.deepStrictEqual(by('forbidden').map(x => x.emp), ['F']);
    assert.deepStrictEqual(by('onsite').map(x => x.emp), ['G']);
    assert.strictEqual(C.vacationBalance(28, 14, rows.filter(r => r.emp === 'A')), 22);
});

test('выгрузка для ЗУП: отпуск и больничный дают дни, а не часы', () => {
    const recs = [
        { emp: 'A', kind: 'Я', fact: 8, night: 0, holiday: 0 }, { emp: 'A', kind: 'Я', fact: 7.5, night: 1, holiday: 0 },
        { emp: 'A', kind: 'ОТ', fact: 0, night: 0, holiday: 0 }, { emp: 'A', kind: 'Б', fact: 8, night: 0, holiday: 0 }
    ];
    const r = C.zupRows(recs, { 'ОТ': { reduces: true }, 'Б': { reduces: true } });
    const byKind = {}; r.forEach(x => { byKind[x.kind] = x; });
    assert.strictEqual(byKind['Я'].hours, 15.5);
    assert.strictEqual(byKind['Я'].days, 2);
    assert.strictEqual(byKind['Б'].hours, 0);
    assert.strictEqual(byKind['Б'].days, 1);
    assert.ok(C.toCsv(r, [['emp', 'Таб'], ['hours', 'Часы']]).startsWith('Таб;Часы\n'));
});
