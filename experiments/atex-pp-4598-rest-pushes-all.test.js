// issue #4598: ОСТАТОК СДВИГАЕТ ПЕРЕД СОБОЙ ВСЁ, НЕ МЕНЯЯ ПОРЯДКА.
//
// Требование заказчика (issue #4598, 04.08.2026): «ОСТАТОК СДВИГАЕТ ПЕРЕД СОБОЙ ВООБЩЕ ВСЁ КАК
// ЕСТЬ! Не меняя порядка». То есть остаток просроченного задания встаёт на место следующего
// задания станка и занимает СВОИ проходы целиком, а всё, что стояло дальше, едет вправо в том же
// порядке — вплоть до переезда в следующие дни. Урезать/задвигать в хвост дня надо НЕ остаток:
// вытесняется ХВОСТ очереди.
//
// Боевое: остаток заказа 4461 (55 проходов) встал на 04.08 в 14:05 с 25 проходами, а ~30 уехали
// на 05.08 — за видимый диапазон; оператор увидел «не хватает 25 резок».
//
// Run with: node experiments/atex-pp-4598-rest-pushes-all.test.js

process.env.TZ = 'Europe/Moscow';
global.window = { db: 'ateh', xsrf: 'x' };
var P = require('../download/atex/js/production-planning.js').planning;

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

var TIMES = { KNIFE: 30, MATERIAL_WINDING: 15, BETWEEN_CUTS: 2, CLEANUP_SHIFT: 30 };
var CAP = 450;
var BASE = new Date(2026, 7, 4, 0, 0, 0, 0).getTime();
function ts(dayOff, hh, mm) { return Math.floor(BASE / 1000) + dayOff * 86400 + hh * 3600 + (mm || 0) * 60; }

// День станка: остаток REST стоит ПЕРВЫМ (08:00), за ним пять обычных заданий.
// Каждое обычное — 10 проходов по 5 мин намотки (+2 лидер) = 70 мин; пятеро = 350 мин.
// REST — 55 проходов по 1.8 мин (+2) = 209 мин. Вместе 559 мин при ёмкости 450: день переполнен,
// и кто-то обязан уехать. Требование: уезжает ХВОСТ, а REST остаётся целым.
function fixture(opt) {
    var cuts = [], perPass = {};
    cuts.push({ id: 'REST', slitter: { id: '1' }, materialId: 'M1', winding: 'OUT', batchId: 'B1',
                knifeWidths: [110, 110, 110, 110, 110, 110, 110, 110], knifeCount: 8, rollerWidth: 110,
                plannedRuns: 55, isFoil: false, fixed: false, status: '', firstPartId: 'REST',
                planDate: String(ts(0, 8, 0)) });
    perPass['REST'] = 1.8;
    for (var i = 0; i < 5; i++) {
        var id = 'Q' + i;
        cuts.push({ id: id, slitter: { id: '1' }, materialId: 'M1', winding: 'OUT', batchId: 'B1',
                    knifeWidths: [110, 110, 110, 110, 110, 110, 110, 110], knifeCount: 8, rollerWidth: 110,
                    plannedRuns: 10, isFoil: false, fixed: !!(opt && opt.fixedQueue), status: '', firstPartId: id,
                    planDate: String(ts(0, 9 + i, 0)) });
        perPass[id] = 5;
    }
    var anchors = {};
    if (opt && opt.fixedQueue) cuts.forEach(function(c) { if (c.id !== 'REST') anchors[c.id] = 0; });
    return { cuts: cuts, perPass: perPass, anchors: anchors };
}

function plan(f) {
    return P.planCutOperations(f.cuts, {
        planBaseMidnightMs: BASE, weights: {}, times: TIMES,
        dayStartMin: 480, dayEndMin: 480 + CAP, dayEndHourMin: 480 + CAP,
        maxOverworkCutsMin: 5, maxOverworkTuneMin: 10, lunchStartMin: 740, lunchDurationMin: 40,
        gapFill: false, preserveOrder: true, slotPlacement: false, firstCutSetup: false,
        prevSetupBySlitter: {}, intraDayResequence: false, perPassByCut: f.perPass,
        slitterIds: ['1'], dueDayByCut: {}, dueKeyByCut: {}, dayAnchorByCut: f.anchors || {}
    });
}

function measure(f, ops) {
    var all = (ops.updates || []).concat(ops.creates || []);
    var runsById = {}, dayById = {}, segDays = {};
    f.cuts.forEach(function(c) { runsById[c.id] = 0; segDays[c.id] = []; });
    all.forEach(function(o) {
        var id = String(o.cutId != null ? o.cutId : o.parentCutId);
        if (runsById[id] == null) { runsById[id] = 0; segDays[id] = []; }
        runsById[id] += Number(o.plannedRuns) || 0;
        var day = Math.floor((Number(o.planStartTs) * 1000 - BASE) / 86400000);
        segDays[id].push(day);
        if (dayById[id] == null || day < dayById[id]) dayById[id] = day;
    });
    return { runs: runsById, day: dayById, segs: segDays, all: all };
}

// ── Б: то же самое, но вся очередь дня ЗАФИКСИРОВАНА (🔒) ───────────────────────────────────
// Тикет: «заказы должны сдвигаться, невзирая на … фиксирование». Значит 🔒 соседей не может
// заставить остаток ужаться или уехать в хвост дня.
function checkFixed() {
    var f2 = fixture({ fixedQueue: true });
    var m = measure(f2, plan(f2));
    console.log('🔒-раскладка: ' + f2.cuts.map(function(c) {
        return c.id + '=' + m.runs[c.id] + 'п/день' + m.day[c.id];
    }).join('  '));
    assert(m.runs['REST'] === 55, '🔒: остаток сохранил все 55 проходов', 'получили ' + m.runs['REST']);
    assert((m.segs['REST'] || []).length === 1 && m.segs['REST'][0] === 0,
        '🔒 соседей не заставляет остаток рваться и уезжать в хвост дня',
        'сегменты остатка по дням: [' + (m.segs['REST'] || []).join(', ') + ']');
}

var f = fixture();
var ops = plan(f);
var all = (ops.updates || []).concat(ops.creates || []);

// Проходы задания ПОСЛЕ операций и день, в котором стои́т его первый сегмент.
var runsById = {}, dayById = {};
f.cuts.forEach(function(c) { runsById[c.id] = 0; });
all.forEach(function(o) {
    var id = String(o.cutId != null ? o.cutId : o.parentCutId);
    if (runsById[id] == null) runsById[id] = 0;
    runsById[id] += Number(o.plannedRuns) || 0;
    var day = Math.floor((Number(o.planStartTs) * 1000 - BASE) / 86400000);
    if (dayById[id] == null || day < dayById[id]) dayById[id] = day;
});
// В какой день попал КАЖДЫЙ сегмент остатка.
var restDays = all.filter(function(o) {
    return String(o.cutId != null ? o.cutId : o.parentCutId) === 'REST';
}).map(function(o) { return Math.floor((Number(o.planStartTs) * 1000 - BASE) / 86400000); });

console.log('раскладка: ' + f.cuts.map(function(c) {
    return c.id + '=' + runsById[c.id] + 'п/день' + dayById[c.id];
}).join('  '));

assert(runsById['REST'] === 55, 'остаток сохранил все свои 55 проходов',
       'получили ' + runsById['REST']);
assert(dayById['REST'] === 0, 'остаток остался в СВОЁМ дне (день 0), а не уехал',
       'день ' + dayById['REST']);
assert(restDays.length === 1 && restDays[0] === 0,
    'остаток НЕ разорван по дням — он стоит первым, рвать надо хвост очереди',
    'сегменты остатка по дням: [' + restDays.join(', ') + ']');

// Вытеснен именно ХВОСТ, и порядок не изменился: дни не убывают вдоль очереди.
var order = ['REST', 'Q0', 'Q1', 'Q2', 'Q3', 'Q4'];
var monotone = true, prev = -1, seq = [];
order.forEach(function(id) { seq.push(id + ':' + dayById[id]); if (dayById[id] < prev) monotone = false; prev = dayById[id]; });
assert(monotone, 'порядок очереди не изменился — дни вдоль неё не убывают', seq.join('  '));
assert(dayById['Q4'] >= 1, 'переполнение забрал ХВОСТ очереди (Q4 уехал на следующий день)',
       'Q4 в дне ' + dayById['Q4']);

checkFixed();

console.log('\n' + passed + '/' + total + ' passed');
