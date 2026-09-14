// #4962 — наладка, выполненная НАКАНУНЕ планового дня, должна быть видна и урегулируема.
//
// Боевая ateh 14.09.2026, Станок 2, заказ 5286 (задание MW308 90x450, 3 прохода,
// план 15.09 01:00, окно 01:00–01:42 = 30 мин «смена ножей» + 12 мин резки).
// Вечером 14.09 оператор наладил станок под завтрашнюю резку и нажал «Наладка»:
// пульт записал «Начато» = 14.09 23:10, проходов 0, «Закончено» пусто.
//
// Что видел заказчик: задание в очереди 15.09 замерло начатым (#4381 снял у карточки
// управление), а те же 30 мин наладки остались запланированы на 15.09 — вчерашняя
// работа посчитана в бюджет дня второй раз. Разобрать её нечем: в «Отклонения»
// задание не попадает вовсе (плановый день ещё не настал → не просрочка; день станку
// не кончился → не «смена закрыта»; группа «делается раньше плана» требует проходов > 0).
//
// Разделение такой наладки в коде ЕСТЬ (#4884/#4885: запись с 0 резок уезжает в день
// выполнения, резки остаются на плановом времени), но стои́т за гейтом pendingSet —
// то есть срабатывает, только когда урегулируют В САМ плановый день. Наладка,
// сделанная накануне, до этого кода не доходит.
//
// Правило (решение заказчика 14.09.2026): НАЛАДКА, ВЫПОЛНЕННАЯ РАНЬШЕ ПЛАНОВОГО ДНЯ, —
// ОТКЛОНЕНИЕ. Признак — «Начато» заполнено, проходов 0, день «Начато» строго раньше
// планового дня, «Закончено» пусто. Урегулирование отрезает её записью с 0 резок в день
// фактической наладки (обычный setup-сегмент #3635), резки остаются на своём плановом
// времени и идут дальше как продолжение «ножи на станке».
//
// Run with: node experiments/atex-pp-4962-setup-before-plan-day.test.js

process.env.TZ = 'UTC';
global.window = { db: 'ateh', xsrf: 'x' };

var P = require('../download/atex/js/production-planning.js').planning;

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

function ts(y, mo, d, h, mi) { return String(Math.round(new Date(y, mo - 1, d, h || 0, mi || 0).getTime() / 1000)); }

var TODAY = 20260914;

// Боевое задание 5286: наладка вчера вечером, резка — завтра.
function job(over) {
    var c = {
        id: '5286',
        planDate: ts(2026, 9, 15, 1, 0),
        startDate: ts(2026, 9, 14, 23, 10),
        plannedRuns: 3,
        actualRuns: '',
        slitter: { id: '1279', label: 'Станок 2' },
        slitterId: '1279'
    };
    Object.keys(over || {}).forEach(function (k) { c[k] = over[k]; });
    return c;
}

// ── 1. Наладка накануне планового дня — отклонение, а не «ничего не происходит» ──
(function () {
    var g = P.deviationGroups([job()], TODAY, {});
    var all = [].concat(g.overdue || [], g.early || [], g.earlyRun || [], g.shiftClosed || [], g.earlySetup || []);
    assert(all.length === 1, 'наладка накануне планового дня попадает в отклонения',
        '(групп: overdue=' + (g.overdue || []).length + ', early=' + (g.early || []).length
        + ', earlyRun=' + (g.earlyRun || []).length + ', shiftClosed=' + (g.shiftClosed || []).length
        + ', earlySetup=' + ((g.earlySetup || []).length) + ')');
    assert((g.earlySetup || []).length === 1, 'она — в своей группе «наладка сделана заранее»',
        '(' + ((g.earlySetup || []).length) + ')');
    assert((g.earlyRun || []).length === 0, 'в «делается раньше плана» не попадает — проходов нет');
})();

// ── 2. Урегулирование отрезает наладку в день её выполнения ──
(function () {
    var cuts = [job()];
    var g = P.deviationGroups(cuts, TODAY, {});
    var res = P.deviationSettlePlan(cuts, g, { todayKey: TODAY, shiftStartMin: 480, shiftEndMin: 990 });
    var sp = (res.splits || []).filter(function (s) { return String(s.id) === '5286'; })[0];
    assert(!!sp, 'урегулирование разделяет задание с выполненной наладкой');
    assert(sp && sp.doneRuns === 0, 'наладка — запись с 0 резок', '(' + (sp && sp.doneRuns) + ')');
    assert(sp && sp.restRuns === 3, 'все 3 прохода остаются в остатке', '(' + (sp && sp.restRuns) + ')');
    assert(sp && String(sp.donePlanStart) === job().startDate,
        'наладка встаёт в день её выполнения (момент «Начато»)', '(' + (sp && sp.donePlanStart) + ')');
    assert(sp && String(sp.restPlanStart) === job().planDate && sp.restReason === 'stay',
        'резки остаются на своём плановом времени', '(' + (sp && sp.restPlanStart) + ', ' + (sp && sp.restReason) + ')');
    assert((res.moves || []).filter(function (m) { return String(m.id) === '5286'; }).length === 0,
        'задание целиком никуда не двигается');
})();

// ── 3. Границы правила — что НЕ является наладкой, сделанной заранее ──
(function () {
    // Наладка в свой плановый день (тот же день) — не отклонение: день ещё идёт (#4830).
    var sameDay = P.deviationGroups([job({ startDate: ts(2026, 9, 15, 1, 5), planDate: ts(2026, 9, 15, 1, 0) })], 20260915, {});
    assert((sameDay.earlySetup || []).length === 0, 'наладка в свой плановый день — не отклонение');

    // Задание вообще не начато — отклонением не становится.
    var notStarted = P.deviationGroups([job({ startDate: '' })], TODAY, {});
    assert((notStarted.earlySetup || []).length === 0, 'не начатое задание — не отклонение');

    // Проходы уже есть → это «делается раньше плана» (#4584), а не наладка.
    var withRuns = P.deviationGroups([job({ actualRuns: '2' })], TODAY, {});
    assert((withRuns.earlySetup || []).length === 0, 'с отмеченными проходами — не «наладка заранее»');
    assert((withRuns.earlyRun || []).length === 1, 'с отмеченными проходами — «делается раньше плана» (#4584)');

    // Факт проходов НЕИЗВЕСТЕН (отчёт не отдал колонку) — не выдумываем ноль (#4381/#4830).
    var unknown = P.deviationGroups([job({ actualRuns: null })], TODAY, {});
    assert((unknown.earlySetup || []).length === 0, 'неизвестный факт проходов — задание не трогаем');

    // Завершённое задание разбирать нечего.
    var done = P.deviationGroups([job({ endDate: ts(2026, 9, 14, 23, 50) })], TODAY, {});
    assert((done.earlySetup || []).length === 0, 'завершённое — не «наладка заранее»');
})();

console.log('');
console.log(passed + '/' + total + (passed === total ? ' passed' : ' passed — ЕСТЬ ПАДЕНИЯ'));
