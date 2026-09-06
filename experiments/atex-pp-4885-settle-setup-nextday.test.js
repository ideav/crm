// #4885, вторая половина — урегулирование НА СЛЕДУЮЩИЙ день после план-дня.
//
// Урегулировать могут как вечером план-дня (смена закрыта — группа shiftClosed,
// это чинил atex-pp-4884-settle-setup.test.js), так и НА СЛЕДУЮЩИЙ день: план-день
// уже прошёл, задание попадает в группу overdue — и правка #4885 (гейт на
// shiftClosedSet) его не видит. Выполненная наладка («Начато» 03.09 19:26, резок 0,
// план 04.09 08:00) снова уезжает ЦЕЛИКОМ на ближайший свободный день / перед
// следующим заданием станка — исходный дефект #4885.
//
// Должно: настройка выделяется записью с 0 резок в день выполнения и при этом
// тайминге; остаток (все проходы) встаёт в очередь — перед следующим заданием
// станка или на ближайший свободный день. Целого переезда задания быть не должно.
//
// Run with: node experiments/atex-pp-4885-settle-setup-nextday.test.js

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
function fmt(s) { var d = new Date(Number(s) * 1000); return d.toISOString().slice(0, 16).replace('T', ' '); }

// Боевое задание 771816 (заказ 5100, Станок 2): наладка 03.09 19:26, 7 проходов,
// план 04.09 08:00, факт резок 0 («В работе»).
var SETUP_JOB = {
    id: '771816',
    planDate: ts(2026, 9, 4, 8, 0),
    startDate: ts(2026, 9, 3, 19, 26),
    plannedRuns: 7,
    actualRuns: '',
    slitter: { id: '1279', label: 'Станок 2' },
    slitterId: '1279'
};

// Опции боевого вызова (settleDeviations): ближайший свободный день станка есть всегда.
var PROD_OPTS = {
    todayKey: 20260905,               // урегулирование на следующий день после план-дня
    shiftStartMin: 480,
    shiftEndMin: 990,
    freeDayMsFor: function () { return new Date(2026, 8, 6, 0, 0).getTime(); }  // 06.09
};

function splitOf(res, id) {
    return (res.splits || []).filter(function (s) { return s.id === id; })[0];
}
function moveOf(res, id) {
    return (res.moves || []).filter(function (m) { return m.id === id; })[0];
}

// ── 1. следующий день, у станка нет следующего задания → остаток на свободный день ──
(function () {
    var res = P.deviationSettlePlan([SETUP_JOB], { overdue: [SETUP_JOB] }, PROD_OPTS);
    var sp = splitOf(res, '771816');
    assert(!!sp, 'следующий день: задание с выполненной настройкой разделяется',
        '(splits=' + JSON.stringify(res.splits) + ')');
    assert(sp && sp.doneRuns === 0, 'настройка — запись с 0 резок', '(' + (sp && sp.doneRuns) + ')');
    assert(sp && sp.restRuns === 7, 'проходы остаются целиком в остатке (0+7=7)',
        '(' + (sp && sp.restRuns) + ')');
    assert(sp && String(sp.donePlanStart) === SETUP_JOB.startDate,
        'настройка встаёт в день выполнения (03.09 19:26)',
        '(' + (sp && fmt(sp.donePlanStart)) + ')');
    assert(sp && Number(sp.restPlanStart) === new Date(2026, 8, 6, 8, 0).getTime() / 1000
            && sp.restReason === 'free-day',
        'остаток едет на ближайший свободный день (06.09 08:00)',
        '(' + (sp && fmt(sp.restPlanStart)) + ', ' + (sp && sp.restReason) + ')');
    assert(!moveOf(res, '771816'), 'задание целиком никуда не двигается',
        '(' + JSON.stringify(moveOf(res, '771816')) + ')');
})();

// ── 2. следующий день, у станка есть следующее задание → остаток перед ним ──
(function () {
    var NEXT = { id: '880100', planDate: ts(2026, 9, 5, 10, 0), plannedRuns: 4, actualRuns: null,
        slitter: { id: '1279', label: 'Станок 2' }, slitterId: '1279' };
    var res = P.deviationSettlePlan([SETUP_JOB, NEXT], { overdue: [SETUP_JOB] }, PROD_OPTS);
    var sp = splitOf(res, '771816');
    assert(!!sp && sp.doneRuns === 0 && sp.restRuns === 7,
        'следующий день с якорем: настройка выделяется (0+7=7)',
        '(splits=' + JSON.stringify(res.splits) + ')');
    assert(sp && Number(sp.restPlanStart) === Number(NEXT.planDate) && sp.restReason === 'before-next',
        'остаток встаёт перед следующим заданием станка',
        '(' + (sp && fmt(sp.restPlanStart)) + ', ' + (sp && sp.restReason) + ')');
    assert(!moveOf(res, '771816'), 'задание целиком никуда не двигается',
        '(' + JSON.stringify(moveOf(res, '771816')) + ')');
})();

// ── 3. вечер план-дня (shiftClosed) с боевыми опциями: остаток переезжает из «stay» ──
// День план-дня для станка кончился (#4596), поэтому очередь кладёт остаток перед
// следующим заданием, перезаписывая предварительное «stay» — то же разделение, тот же writer.
(function () {
    var NEXT = { id: '880200', planDate: ts(2026, 9, 5, 8, 0), plannedRuns: 4, actualRuns: null,
        slitter: { id: '1279', label: 'Станок 2' }, slitterId: '1279' };
    var res = P.deviationSettlePlan([SETUP_JOB, NEXT], { shiftClosed: [SETUP_JOB] }, PROD_OPTS);
    var sp = splitOf(res, '771816');
    assert(!!sp && sp.doneRuns === 0 && sp.restRuns === 7,
        'вечер (смена закрыта): настройка выделяется (0+7=7)',
        '(splits=' + JSON.stringify(res.splits) + ')');
    assert(sp && Number(sp.restPlanStart) === Number(NEXT.planDate) && sp.restReason === 'before-next',
        'остаток уходит из закрывшегося дня к следующему заданию (#4596)',
        '(' + (sp && fmt(sp.restPlanStart)) + ', ' + (sp && sp.restReason) + ')');
    assert(!moveOf(res, '771816'), 'задание целиком никуда не двигается',
        '(' + JSON.stringify(moveOf(res, '771816')) + ')');
})();

// ── 4. наладка в СВОЙ план-день — прежнее правило: разделения нет (#4830) ──
(function () {
    var sameDay = { id: '880300', planDate: ts(2026, 9, 4, 8, 0), startDate: ts(2026, 9, 4, 7, 30),
        plannedRuns: 3, actualRuns: '', slitterId: '1279', slitter: { id: '1279', label: 'Станок 2' } };
    var res = P.deviationSettlePlan([sameDay], { overdue: [sameDay] }, PROD_OPTS);
    assert(!splitOf(res, '880300'), '#4830 наладка в свой план-день не разделяется');
})();

// ── 5. начатое с НЕИЗВЕСТНЫМ фактом, станок в смене — неприкосновенно (#4381) ──
(function () {
    var unknown = { id: '880400', planDate: ts(2026, 9, 4, 8, 0), startDate: ts(2026, 9, 3, 19, 26),
        plannedRuns: 7, actualRuns: null, slitterId: '1279', slitter: { id: '1279', label: 'Станок 2' } };
    var res = P.deviationSettlePlan([unknown], { overdue: [unknown] },
        { todayKey: 20260905, shiftStartMin: 480, shiftEndMin: 990, shiftNotOpenSlitters: {} });
    assert(!splitOf(res, '880400') && !moveOf(res, '880400'),
        '#4381 неизвестный факт — задание не двигается и не делится',
        '(moves=' + JSON.stringify(res.moves) + ', splits=' + JSON.stringify(res.splits) + ')');
})();

console.log('\n' + passed + '/' + total + ' passed');
if (process.exitCode) process.exit(process.exitCode);
