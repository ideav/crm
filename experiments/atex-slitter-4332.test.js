// #4332 — пульт слиттера: смена по станку (любой день) + следующее задание будущих дней.
//   п.2: открытость смены — по ПОСЛЕДНЕМУ событию «Начало смены»/«Конец смены» станка,
//        НЕЗАВИСИМО от дня (снят фильтр по выбранному дню) → оператор работает будущие дни (п.4);
//   п.4: core.nextFutureCut — одно ближайшее НЕзавершённое задание станка со строго более
//        поздним календарным днём.
//
// Run with: node experiments/atex-slitter-4332.test.js

process.env.TZ = 'UTC';
var core = require('../download/atex/js/slitter.js').core;

var passed = 0, total = 0;
function assertEqual(actual, expected, name) {
    total++;
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) passed++;
    else { console.log('  expected:', JSON.stringify(expected), '\n  actual:  ', JSON.stringify(actual)); process.exitCode = 1; }
}

// ── п.2: hasOpenShift — по последнему событию станка, НЕЗАВИСИМО от дня ────────────────────────────
// Смену открыли вчера и не закрыли → сегодня она ВСЁ ЕЩЁ открыта (раньше per-day фильтр давал закрыто).
assertEqual(core.hasOpenShift([
    { when: '2026-06-10 08:00:00', type: 'Начало смены', userId: '701' }
], '701', '2026-06-11'), true, '#4332: «Начало смены» вчера без закрытия → сегодня смена ОТКРЫТА (любой день)');

// Открыли день 1, закрыли день 2 → закрыта.
assertEqual(core.hasOpenShift([
    { when: '2026-06-10 08:00:00', type: 'Начало смены', userId: '701' },
    { when: '2026-06-11 16:30:00', type: 'Конец смены', userId: '701' }
], '701', '2026-06-11'), false, '#4332: последнее событие «Конец смены» (др. день) → закрыта');

// Закрыли день 1, снова открыли день 2 → открыта (последнее — «Начало смены»).
assertEqual(core.hasOpenShift([
    { when: '2026-06-10 08:00:00', type: 'Начало смены', userId: '701' },
    { when: '2026-06-10 16:30:00', type: 'Конец смены', userId: '701' },
    { when: '2026-06-11 08:00:00', type: 'Начало смены', userId: '701' }
], '701', '2026-06-11'), true, '#4332: последнее событие «Начало смены» (сегодня) → открыта');

// Фильтр по станку сохраняется и между днями (метка в «Примечаниях»).
var evMulti = [
    { when: '2026-06-10 08:00:00', type: 'Начало смены', userId: '701', notes: 'Станок 1 · 2026-06-10' },
    { when: '2026-06-11 08:05:00', type: 'Начало смены', userId: '701', notes: 'Станок 2 · 2026-06-11' },
    { when: '2026-06-11 15:00:00', type: 'Конец смены', userId: '701', notes: 'Станок 2 · 2026-06-11' }
];
assertEqual(core.hasOpenShift(evMulti, '701', '2026-06-12', 'Станок 1'), true,
    '#4332: «Станок 1» открыт со вчера (его последнее — «Начало смены»)');
assertEqual(core.hasOpenShift(evMulti, '701', '2026-06-12', 'Станок 2'), false,
    '#4332: «Станок 2» закрыт (его последнее — «Конец смены»)');

// ── п.4: nextFutureCut — одно ближайшее НЕзавершённое задание будущих дней станка ──────────────────
function cut(id, dayISO, o) {
    o = o || {};
    return { id: id, slitterId: o.m || 'm1', planDate: String(Math.floor(new Date(dayISO + 'T08:00:00Z').getTime() / 1000)),
             status: o.status || 'Ожидает', material: o.mat || 'A', winding: 'OUT', runLength: 100, plannedRuns: 2 };
}
var AFTER = core.dateKey('2026-06-11');   // «сегодня» = 11.06 (задания этого дня выполнены)
var pool = [
    cut('today', '2026-06-11', { status: 'Завершена' }),   // сегодня, завершено — не в будущем
    cut('f13', '2026-06-13'),                               // будущее, ожидает — КАНДИДАТ
    cut('f12', '2026-06-12'),                               // будущее раньше — ДОЛЖНО ВЫИГРАТЬ
    cut('f12done', '2026-06-12', { status: 'Завершена' }),  // будущее, но завершено — пропуск
    cut('other', '2026-06-12', { m: 'm2' })                // другой станок — пропуск
];
assertEqual((core.nextFutureCut(pool, { slitterId: 'm1', afterDateKey: AFTER }) || {}).id, 'f12',
    '#4332: nextFutureCut — самое РАННЕЕ незавершённое задание будущих дней этого станка');

// Уже НАЧАТОЕ будущее задание тоже возвращается (не завершено) → видно при обновлении формы.
assertEqual((core.nextFutureCut([cut('f12', '2026-06-12', { status: 'В работе' })],
    { slitterId: 'm1', afterDateKey: AFTER }) || {}).id, 'f12',
    '#4332: начатое (В работе) будущее задание возвращается — видно на форме');

// Нет будущих (только сегодня/прошлое) → null.
assertEqual(core.nextFutureCut([cut('t', '2026-06-11'), cut('p', '2026-06-10')],
    { slitterId: 'm1', afterDateKey: AFTER }), null, '#4332: нет заданий будущих дней → null');

// Пустой список / без даты → null.
assertEqual(core.nextFutureCut([], { slitterId: 'm1', afterDateKey: AFTER }), null, '#4332: пустой список → null');
assertEqual(core.nextFutureCut([{ id: 'nd', slitterId: 'm1', planDate: '', status: 'Ожидает' }],
    { slitterId: 'm1', afterDateKey: AFTER }), null, '#4332: задание без «Дата план» → не будущее → null');

console.log('\n' + passed + '/' + total + ' passed');
if (passed !== total) process.exitCode = 1;
