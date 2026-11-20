// Мерка к issue #5465: расписание консультаций базы timepad (download/timepad/schedule.js).
// https://github.com/ideav/crm/issues/5465
//
// Правило записи «Консультация» задаёт дни ОБОИМИ способами (решение владельца 08.11.2026):
//   дни недели внутри периода «с … по …» и явный список дат; исключения отменяют дни.
// Слоты дня — от «Время с» шагом «Шаг» до «Время до»; слот, задевающий перерыв, выпадает.
// Время — московское: слот 10:00 15.11.2026 = 07:00 UTC.

const assert = require('assert');
const S = require('../download/timepad/schedule.js');

let failures = 0;
function check(name, fn){
    try { fn(); console.log('PASS: ' + name); }
    catch(e){ failures++; console.log('FAIL: ' + name + '\n  ' + (e && e.message)); }
}
const FROM = '2026-11-09', TO = '2026-12-31';   // 09.11.2026 — понедельник

check('дни недели в периоде: пн и ср с 09.11 по 20.11', () => {
    assert.deepStrictEqual(S.days({ weekdays: 'пн, ср', periodFrom: '09.11.2026', periodTo: '20.11.2026' }, FROM, TO),
        ['2026-11-09', '2026-11-11', '2026-11-16', '2026-11-18']);
});
check('дни недели цифрами и полными именами — то же самое', () => {
    const a = S.days({ weekdays: '1,3', periodFrom: '09.11.2026', periodTo: '20.11.2026' }, FROM, TO);
    const b = S.days({ weekdays: 'Понедельник Среда', periodFrom: '2026-11-09', periodTo: '2026-11-20' }, FROM, TO);
    assert.deepStrictEqual(a, b);
    assert.strictEqual(a.length, 4);
});
check('явный список дат без дней недели', () => {
    assert.deepStrictEqual(S.days({ dates: '15.11.2026; 01.12.2026\n22.11.2026' }, FROM, TO),
        ['2026-11-15', '2026-11-22', '2026-12-01']);
});
check('оба способа сразу: объединение без повторов', () => {
    assert.deepStrictEqual(S.days({ weekdays: 'пт', periodFrom: '09.11.2026', periodTo: '20.11.2026',
        dates: '13.11.2026, 14.11.2026' }, FROM, TO), ['2026-11-13', '2026-11-14', '2026-11-20']);
});
check('исключения снимают дни из обоих источников', () => {
    assert.deepStrictEqual(S.days({ weekdays: 'пт', periodFrom: '09.11.2026', periodTo: '20.11.2026',
        dates: '14.11.2026', exceptions: ['13.11.2026', '2026-11-14'] }, FROM, TO), ['2026-11-20']);
});
check('прошедшие дни не строятся; период обрезается снизу «сегодня»', () => {
    assert.deepStrictEqual(S.days({ weekdays: 'пн', periodFrom: '01.11.2026', periodTo: '16.11.2026',
        dates: '05.11.2026' }, FROM, TO), ['2026-11-09', '2026-11-16']);
});
check('без «Период по» — горизонт 60 дней, а не бесконечность', () => {
    const d = S.days({ weekdays: 'вс' }, FROM, '2027-12-31');
    assert.strictEqual(d[0], '2026-11-15');
    assert.ok(d[d.length - 1] <= S.addDays(FROM, S.HORIZON_DAYS), d[d.length - 1]);
    assert.strictEqual(d.length, 8);
});
check('несуществующие даты и мусор не дают дней', () => {
    assert.deepStrictEqual(S.days({ dates: '31.11.2026, abc, 2026-13-01' }, FROM, TO), []);
});
check('слоты: 10:00–13:00 шагом 30 с перерывом 11:30–12:00', () => {
    const s = S.slots({ timeFrom: '10:00', timeTo: '13:00', step: 30, breakFrom: '11:30', breakTo: '12:00' }, '2026-11-15');
    assert.deepStrictEqual(s.map(x => x.time), ['10:00', '10:30', '11:00', '12:00', '12:30']);
    assert.strictEqual(new Date(s[0].start * 1000).toISOString(), '2026-11-15T07:00:00.000Z');
    assert.strictEqual(s[0].end - s[0].start, 1800);
});
check('слот, не влезающий в конец дня, и слот через перерыв выпадают', () => {
    const s = S.slots({ timeFrom: '9:00', timeTo: '11:10', step: 45, breakFrom: '10:00', breakTo: '10:15' }, '2026-11-15');
    // 9:00–9:45 есть; 9:45–10:30 задевает перерыв; 10:30–11:15 не влезает до 11:10
    assert.deepStrictEqual(s.map(x => x.time), ['09:00']);
});
check('без времени, с нулевым шагом или концом раньше начала — слотов нет', () => {
    assert.deepStrictEqual(S.slots({ timeFrom: '', timeTo: '12:00', step: 30 }, '2026-11-15'), []);
    assert.deepStrictEqual(S.slots({ timeFrom: '10:00', timeTo: '12:00', step: 0 }, '2026-11-15'), []);
    assert.deepStrictEqual(S.slots({ timeFrom: '12:00', timeTo: '10:00', step: 30 }, '2026-11-15'), []);
});
check('ключ слота: консультация|день|время, день — по Москве', () => {
    assert.strictEqual(S.slotKey(700, '2026-11-15', '10:00'), '700|2026-11-15|10:00');
    // 23:30 UTC 14.11 — уже 15.11 в Москве
    assert.strictEqual(S.today(Date.UTC(2026, 10, 14, 23, 30) / 1000), '2026-11-15');
});

if(failures){ console.log(failures + ' FAIL'); process.exit(1); }
console.log('OK');
