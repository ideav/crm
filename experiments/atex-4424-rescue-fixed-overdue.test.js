// Tests for ideav/crm#4434 п.1 (замок дня 🔒 АБСОЛЮТЕН) на данных issue #4424.
//
// Правило: «Упорядочить»/«Сгенерировать» НИКОГДА не переносят зафиксированное (🔒) задание на другой
// день — ни ради срока, ни из-за переполнения дня, ни балансировкой. Приколол оператор — значит день
// его. Если 🔒 при этом стоит за своим сроком, просрочка не прячется: задание видно в панели
// «просрочено» (#4161) и в безусловном логе #4200, а решение (снять фиксацию / перенести руками)
// принимает оператор.
//
// Единственное исключение — день 🔒 ЦЕЛИКОМ нерабочий (выходной/праздник «Календаря» #3788 или
// «Отпуск» станка #3764 на всё окно): разместить на нём физически нечего. Тогда движок кладёт задание
// с ближайшего рабочего дня и КРИЧИТ (console.error + тост), а не двигает молча.
//
// Данные стенда ateh (Станок 2 = 1279): четыре 🔒-задания на 29.07 при свободном 27.07 и пустом 28.07.
// Прежний рескью (#4224/#4424) снимал им замок дня и тянул в срок — это поведение ОТМЕНЕНО (#4434 п.1).
//
// Run with: node experiments/atex-4424-rescue-fixed-overdue.test.js

process.env.TZ = 'Europe/Moscow';

var mod = require('../download/atex/js/production-planning.js');
var Controller = mod.Controller;

var passed = 0, total = 0;
function assert(cond, name) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    total++;
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; } else {
        console.log('  expected:', JSON.stringify(expected));
        console.log('  actual:  ', JSON.stringify(actual));
        process.exitCode = 1;
    }
}

var BASE = new Date(2026, 6, 24, 0, 0, 0, 0).getTime();   // «С» = Пт 24.07.2026; 25–26 выходные
var K11 = [80, 80, 80, 80, 80, 80, 80, 80, 80, 80, 80];
var TIMES = { KNIFE: 30, MATERIAL_WINDING: 15, KNIFE_MOVE: 0, BETWEEN_CUTS: 2, CLEANUP_SHIFT: 30 };
var OP_TIMES = { WIND_300: 1.2 };
var DAY_SETTINGS = { DAY_START_HOUR: '8:00', DAY_END_HOUR: '16:30', LUNCH_START: '12:20',
    LUNCH_DURATION: '40', TOTAL_INTERVALS: '20', MAX_OVERWORK_CUTS_MN: '5', MAX_OVERWORK_TUNE_MN: '10',
    SLOT_PLACEMENT: '1', DEADLINE_COST_MN: '200', EXACT_DEADLINE_COST_MN: '9',
    ORDER_DIFF_PENALTY_MN: '12', MAX_SLOTS_DISTANCE_HR: '24', MAX_DISTANCE_COST_MN: '10' };

function ts(dayOff, minute) { return String(Math.floor(BASE / 1000) + dayOff * 86400 + minute * 60); }
// Задание: runs проходов по 300 м; о — { fixed, started, due (день-смещение), mat }.
function cut(id, dayOff, minute, runs, o) {
    o = o || {};
    return { id: id, orderId: 'O' + id, firstPartId: id, slitter: { id: '1279', label: 'Станок 2' },
        materialId: o.mat || 'MW308', winding: 'OUT', knifeWidths: K11, knifeCount: 11, rollerWidth: 0,
        plannedRuns: runs, isFoil: false, length: 300, status: '',
        startDate: o.started ? ts(dayOff, minute) : '', endDate: '',
        fixed: !!o.fixed, planDate: ts(dayOff, minute), number: ts(dayOff, minute),
        duration: String(Math.ceil(runs * OP_TIMES.WIND_300)),
        storedKnifeSetupMin: '30', storedMaterialWindingMin: '15',
        storedCutAndLeaderMin: String(Math.ceil(runs * OP_TIMES.WIND_300) + 2 * runs) };
}
function dueKeyOf(dayOff) {
    var d = new Date(BASE + dayOff * 86400000);
    return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}
// Обеспечение с позицией — оттуда планировщик берёт срок (cutDueKeys → genPositions).
function supplyFor(cutId, dueDayOff) {
    return { id: 's' + cutId, cutId: cutId, positionId: 'p' + cutId, rolls: 1, dueKey: dueKeyOf(dueDayOff), orderNo: 'ord' + cutId };
}
function positionFor(cutId, dueDayOff) {
    return { id: 'p' + cutId, materialId: 'MW308', width: 80, qty: 1, length: 300, dueKey: dueKeyOf(dueDayOff), approved: true };
}
function planSelf(cuts, dues, freezeByDay) {
    var self = Object.create(Controller.prototype);
    self.cuts = cuts;
    self.changeTimes = TIMES; self.opTimes = OP_TIMES; self.daySettings = DAY_SETTINGS;
    self.filter = { date: '2026-07-24', dateTo: '2026-08-09' };
    self.supplies = Object.keys(dues).map(function (id) { return supplyFor(id, dues[id]); });
    self.genPositions = Object.keys(dues).map(function (id) { return positionFor(id, dues[id]); });
    self.footageBySupply = {}; self.positionLengthById = {};
    self.slitters = [{ id: '1279', label: 'Станок 2' }];
    self.downtimesBySlitter = {}; self.calendarByDay = {};
    self.freezeByDay = freezeByDay || {};
    self.meta = { cut: { id: '1078', reqs: [] }, calendar: { id: '1' },
        freeze: (freezeByDay && Object.keys(freezeByDay).length) ? { id: '2' } : null };
    self.nowMs = function () { return BASE; };
    self.prevSetupBySlitter = {};
    return self;
}
function dayOf(ts) { return Math.floor(((Number(ts) * 1000 - BASE) / 60000) / 1440); }
function place(cuts, dues, freeze) {
    var self = planSelf(cuts, dues, freeze);
    var ops = Controller.prototype.buildSequenceOps.call(self, cuts, 'SETUP', false,
        { withinSlitterIds: ['1279'] }).ops;
    var out = {};
    (ops.updates || []).forEach(function (u) { out[String(u.cutId)] = dayOf(u.planStartTs); });
    return out;
}

// ── 1) 🔒-задания за сроком ОСТАЮТСЯ на своём дне 5 (замок абсолютен, #4434 п.1) ──
(function () {
    // День 3 (27.07) занят одним крупным заданием; день 5 (29.07) держит четыре 🔒 за сроком.
    var cuts = [
        cut('big', 3, 480, 57),                      // 27.07 — 57 проходов, не фикс
        cut('late1', 5, 480, 8, { fixed: true }),    // 29.07, 🔒, срок 28.07 (день 4)
        cut('late2', 5, 540, 32, { fixed: true }),   // 29.07, 🔒, срок 28.07
        cut('late3', 5, 700, 4, { fixed: true }),    // 29.07, 🔒, срок 27.07 (день 3)
        cut('mine', 5, 720, 1, { fixed: true })      // 29.07, 🔒, срок 28.07 — «моё» задание из issue
    ];
    var dues = { big: 4, late1: 4, late2: 4, late3: 3, mine: 4 };
    var res = place(cuts, dues, null);
    ['late1', 'late2', 'late3', 'mine'].forEach(function (id) {
        assert(res[id] === 5,
            '#4434 п.1: ' + id + ' (🔒 за сроком) остался на своём дне 5, а не «спасён» переносом (день ' + res[id] + ')');
    });
    assert(res['big'] === 0, 'НЕзафиксированное задание планируется свободно от «С» (день ' + res['big'] + ')');
})();

// ── 2) 🔒 В СРОК тоже не трогаем ─────────────────────────────────────────────
(function () {
    var cuts = [cut('a', 3, 480, 20), cut('keep', 5, 480, 8, { fixed: true })];
    var res = place(cuts, { a: 5, keep: 6 }, null);   // keep в срок (день 5 ≤ 6)
    assertEqual(res['keep'], 5, '🔒 в срок остаётся на своём дне — замок дня не трогаем');
})();

// ── 3) Замороженный день (#4326) — задание из него не уводим ─────────────────
(function () {
    var cuts = [cut('big', 3, 480, 57), cut('frz', 5, 480, 8, { fixed: true })];
    // 29.07 (день 5) заморожен → задание оттуда не уводим, даже если оно за сроком.
    var d = new Date(BASE + 5 * 86400000);
    var key = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
    var freeze = {}; freeze[key] = { id: 'f1', notes: '' };
    var res = place(cuts, { big: 4, frz: 4 }, freeze);
    assertEqual(res['frz'], 5, 'задание замороженного дня остаётся в нём');
})();

// ── 4) Начатое задание неприкосновенно (#4381) ───────────────────────────────
(function () {
    var cuts = [cut('big', 3, 480, 57), cut('run', 5, 480, 8, { started: true })];
    var res = place(cuts, { big: 4, run: 4 }, null);
    assertEqual(res['run'], 5, 'начатое задание не двигаем — оно уже идёт на станке');
})();

// ── 5) Незафиксированное просроченное по-прежнему спасается ─────────────────
(function () {
    var cuts = [cut('big', 3, 480, 57), cut('free', 5, 480, 8)];
    var res = place(cuts, { big: 4, free: 4 }, null);
    assert(res['free'] <= 4, 'обычное просроченное задание уходит в срок (регрессия #4118/#4200)');
})();

process.on('exit', function () {
    console.log('\n' + passed + '/' + total + ' passed');
});
