// #4547 — ДЕНЬ РАЗМЕЩЕНИЯ СЧИТАЕТ УПАКОВЩИК, А НЕ ЭВРИСТИКА.
//
// Заказчик (31.07.2026): «Я просил не использовать эвристику, у нас не те объёмы, чтобы гадать.
// НИЧЕГО ПОДОБНОГО В ТЗ НЕТ». И правда: ни «ёмкость-оценки дня», ни `capacityMin` в ТЗ нет —
// это была деталь реализации слоя размещения (§8). Она же и порождала расхождение, из-за которого
// не сработал запрет обгона 🔒 (#4542): в журнале боевого случая
//     ВЫБРАН: станок 1277 поз 18 → вес 15 (день~20260803)
//     РЕАЛЬНЫЙ день (splitMachineQueue, арбитр §12): 0
// — §8 «прикидывал» день, складывая работу префикса в ёмкость 450 мин, а раскладывал план
// splitMachineQueue, который знает якоря 🔒, обед, «Отпуск», нерабочие дни и атомарность прохода.
// Две арифметики на один вопрос — расхождение неизбежно.
//
//   A — день, выбранный §8, СОВПАДАЕТ с днём реальной упаковки (по каждому заданию трассы);
//   B — разбор выбора больше не называет день оценкой («день~» и «эвристика» ушли из журнала);
//   C — scorePosition отдаёт день упаковщика (точечно, без контроллера);
//   D — упаковщика не дали → правило говорит об этом вслух (ТЗ §14), а не гадает молча.
//
// Run with: node experiments/atex-pp-4547-exact-day.test.js

process.env.TZ = 'UTC';
global.window = { db: 'ateh1', xsrf: 'x' };
var api = require('../download/atex/js/production-planning.js');
var P = api.planning;

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

var BASE = new Date(2026, 6, 30, 0, 0, 0, 0).getTime();   // чт 30.07.2026 = день 0
var D0 = Math.round(BASE / 1000) + 8 * 3600;
var DAY = 86400, CAP = 450;
function W(w, n) { var a = []; for (var i = 0; i < n; i++) a.push(w); return a; }
function cut(id, mat, kn, dayOff, min, fixed, runs) {
    return { id: id, slitter: { id: '1' }, materialId: mat, winding: 'OUT', batchId: 'B' + mat,
             knifeWidths: W(kn[0], kn[1]), knifeCount: kn[1], rollerWidth: 0,
             plannedRuns: runs, isFoil: false, status: '', fixed: !!fixed, firstPartId: id,
             planDate: String(D0 + dayOff * DAY + min * 60) };
}
function plan(cuts, perPass, extra) {
    var pp = {}, anchor = {}, due = {};
    cuts.forEach(function (c) {
        pp[String(c.id)] = perPass[String(c.id)] != null ? perPass[String(c.id)] : 10;
        due[String(c.id)] = 30;
        if (c.fixed) anchor[String(c.id)] = Math.floor((Number(c.planDate) * 1000 - BASE) / 86400000);
    });
    var o = { planBaseMidnightMs: BASE, weights: {}, times: { KNIFE: 30, MATERIAL_WINDING: 15, BETWEEN_CUTS: 0 },
        dayStartMin: 480, dayEndMin: 480 + CAP, dayEndHourMin: 480 + CAP,
        maxOverworkCutsMin: 5, maxOverworkTuneMin: 10, lunchStartMin: 740, lunchDurationMin: 40,
        gapFill: true, preserveOrder: false, slotPlacement: true, firstCutSetup: false,
        prevSetupBySlitter: {}, intraDayResequence: true, perPassByCut: pp, slitterIds: ['1'],
        dueDayByCut: due, dueKeyByCut: {}, dayAnchorByCut: anchor };
    for (var k in (extra || {})) o[k] = extra[k];
    return P.planCutOperations(cuts, o);
}
function dayKeyOfOffset(off) {
    var d = new Date(2026, 6, 30 + Math.round(off));
    return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

// Расхождение по построению: 🔒G заякорена на день 3, но работы в ней на два дня. Эвристика
// складывает её работу в бегущие сутки и уводит соседа вперёд; упаковщик ставит 🔒 на ЕЁ день,
// а свободное X кладёт в день 0, где место есть.
function corpus() {
    return [
        cut('G', 'MC', [90, 10], 3, 0, true, 30),      // 🔒 день 3, 900 мин работы
        cut('X', 'MB', [110, 8], 0, 0, false, 4),      // свободное, хранится в дне 0
        cut('Y', 'MB', [110, 8], 0, 120, false, 4)
    ];
}
var PP = { G: 30, X: 20, Y: 20 };

// ── A: день §8 = день упаковщика ────────────────────────────────────────────────────────────
(function () {
    var ops = plan(corpus(), PP);
    var tasks = ((ops.placement || {}).tasks) || [];
    assert(tasks.length > 0, '#4547-A: разбор размещения есть', '(заданий ' + tasks.length + ')');
    var mismatch = tasks.filter(function (t) {
        return t && t.chosen && t.realDay != null
            && Number(t.chosen.placementDayKey) !== dayKeyOfOffset(t.realDay);
    });
    assert(mismatch.length === 0,
        '#4547-A: выбранный §8 день совпадает с днём реальной упаковки — двух арифметик нет',
        '(' + (mismatch.map(function (t) {
            return t.id + ': §8 ' + t.chosen.placementDayKey + ' vs упаковщик ' + dayKeyOfOffset(t.realDay);
        }).join('; ') || 'расхождений нет') + ')');
})();

// ── B: разбор выбора больше не называет день оценкой ────────────────────────────────────────
// Оператор читает тот же разбор в подсказке карточки. Пока в нём стоя́ло «день~» рядом с
// «РЕАЛЬНЫЙ день», расхождение двух арифметик было НАПИСАНО прямо в журнале — и никого не смущало.
(function () {
    var ops = plan(corpus(), PP);
    var lines = P.formatSlotPlacementTrace(ops.placement) || [];
    var text = lines.join('\n');
    assert(text.indexOf('день~') === -1,
        '#4547-B: в разборе размещения нет «день~» — день один',
        '(' + (text.split('\n').filter(function (l) { return l.indexOf('день~') !== -1; })[0] || 'нет') + ')');
    assert(!/ЭВРИСТИКА|эвристика/.test(text),
        '#4547-B: и слова «эвристика» тоже нет',
        '(' + (text.split('\n').filter(function (l) { return /эвристик/i.test(l); })[0] || 'нет') + ')');
    assert(/упаковщик/i.test(text),
        '#4547-B: сказано, что день считает упаковщик');
})();

// ── C: scorePosition отдаёт день упаковщика ─────────────────────────────────────────────────
(function () {
    var cuts = corpus();
    var byId = {}; cuts.forEach(function (c) { byId[String(c.id)] = c; });
    var slots = cuts.filter(function (c) { return c.id !== 'Y'; }).map(function (c) { return P.slotFromCut(c); });
    slots.forEach(function (s) { s.workMin = PP[s.id] * Number(byId[s.id].plannedRuns); });
    // Упаковщик — тот же, что раскладывает план: очередь станка → день старта каждого задания.
    function realStartDayFn(ids, sid) {
        var objs = (ids || []).map(function (id) { return byId[String(id)]; }).filter(Boolean);
        var pp = {}, runs = {}, anchor = {};
        objs.forEach(function (c) {
            pp[String(c.id)] = PP[String(c.id)]; runs[String(c.id)] = Number(c.plannedRuns) || 0;
            if (c.fixed) anchor[String(c.id)] = Math.floor((Number(c.planDate) * 1000 - BASE) / 86400000);
        });
        var segs = P.splitMachineQueue(objs, {
            dayStartMin: 480, dayEndMin: 480 + CAP, dayEndHourMin: 480 + CAP,
            maxOverworkCutsMin: 5, maxOverworkTuneMin: 10,
            times: { KNIFE: 30, MATERIAL_WINDING: 15, BETWEEN_CUTS: 0 },
            perPassByCut: pp, runsByCut: runs, dayAnchorByCut: anchor,
            lunchStartMin: 740, lunchDurationMin: 40, gapFill: true, orderAuthoritative: true
        });
        var out = {};
        (segs || []).forEach(function (s) {
            var d = Number(s.dayOffset), id = String(s.cutId);
            if (!isFinite(d)) return;
            if (out[id] == null || d < out[id]) out[id] = d;
        });
        return out;
    }
    var ctx = { settings: {}, times: { KNIFE: 30, MATERIAL_WINDING: 15, BETWEEN_CUTS: 0 },
                capacityMin: CAP, baseMidnightMs: BASE, slitterId: '1',
                perPassByCut: PP, realStartDayFn: realStartDayFn };
    var arr = [slots[0]];                       // на станке стои́т 🔒G (день 3, 900 мин работы)
    var sc = P.scorePosition(arr, 1, slots[1], ctx);
    var real = realStartDayFn(['G', 'X'], '1');
    assert(sc && sc.dayOffset === real.X,
        '#4547-C: scorePosition вернул день упаковщика',
        '(§8 ' + (sc ? sc.dayOffset : 'null') + ' vs упаковщик ' + real.X + ')');

    // Та же точка, но «ёмкость-оценка» абсурдная — день не меняется.
    var ctx2 = {}; Object.keys(ctx).forEach(function (k) { ctx2[k] = ctx[k]; });
    ctx2.capacityMin = 30;
    var sc2 = P.scorePosition(arr, 1, slots[1], ctx2);
    assert(sc2 && sc2.dayOffset === real.X,
        '#4547-C: и с абсурдной ёмкость-оценкой — тот же день упаковщика',
        '(' + (sc2 ? sc2.dayOffset : 'null') + ')');
})();

// ── D: упаковщика не дали — говорим вслух (ТЗ §14), а не гадаем молча ───────────────────────
(function () {
    var warned = [];
    var origWarn = console.warn;
    console.warn = function () { warned.push(Array.prototype.slice.call(arguments).join(' ')); };
    try {
        var cuts = corpus();
        var slots = [P.slotFromCut(cuts[0]), P.slotFromCut(cuts[1])];
        slots.forEach(function (s) { s.workMin = 300; });
        P.scorePosition([slots[0]], 1, slots[1],
            { settings: {}, times: {}, capacityMin: CAP, baseMidnightMs: BASE, slitterId: '1' });
    } finally { console.warn = origWarn; }
    assert(warned.some(function (m) { return /4547/.test(m) && /упаковщик/i.test(m); }),
        '#4547-D: без упаковщика оценка дня объявлена в журнале, а не применена молча',
        '(' + (warned.join(' | ').slice(0, 120) || 'ни одного предупреждения') + ')');
})();

console.log('\n' + passed + '/' + total + ' проверок пройдено');
if (passed !== total) process.exitCode = 1;
