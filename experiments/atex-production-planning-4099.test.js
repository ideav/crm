// Тест #4099 — потолок смены + перенос переполнения в scheduleFromStored.
//
// Симптом: в очереди/Ганте бары уходили после 16:30 и «параллельно». Причина: сохранённые planStart
// тяжёлых резок (с настройкой ножей) перекрываются (issue #4099: 01.07 у Станка 1 — 24 задания =
// 1120 мин при смене ~450), а анти-нахлёст #3885 разносил перекрытия встык БЕЗ потолка смены →
// цуг честно уходил в ночь. Фикс: scheduleFromStored с окном смены (opts) не пускает окно резки за
// конец смены (cutEndMin−обед, +нахлёст) и уносит переполнение на следующий РАБОЧИЙ день.
//
// Run with: node experiments/atex-production-planning-4099.test.js

process.env.TZ = 'UTC';
var P = require('../download/atex/js/production-planning.js').planning;

var passed = 0, total = 0;
function assert(cond, name) { total++; console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name); if (cond) passed++; else process.exitCode = 1; }

var BASE = Date.UTC(2026, 6, 1);                          // день 0 = 2026-07-01 00:00
function ts(dayIdx, hhmm) { return (BASE + dayIdx * 86400000) / 1000 + hhmm * 60; }   // сек для planDate
// резка для scheduleFromStored: planDate (planStart, сек), setup (ножи+сырьё), cutT (Резка+Лидер)
function C(id, dayIdx, startHHMM, setup, cutT) {
    return { id: id, planDate: String(ts(dayIdx, startHHMM)),
        storedKnifeSetupMin: String(setup), storedMaterialWindingMin: '0', storedCutAndLeaderMin: String(cutT) };
}
// окно смены: 08:00–16:15 (cutEnd), обед 40, без выходных
var WIN = { dayStartMin: 480, cutEndMin: 975, lunchDurationMin: 40, overworkMin: 0, dayOffAt: function () { return false; } };
function schedById(sched) { var m = {}; sched.forEach(function (s) { m[s.cutId] = s; }); return m; }
function todOf(min) { return min - Math.floor(min / 1440) * 1440; }        // минута суток
function dayOf(min) { return Math.floor(min / 1440); }

// ── 1) БЕЗ opts — прежнее поведение (#3885): нахлёст встык в пределах дня, без потолка/переноса ────
(function () {
    // две резки, вторая сохранена ВНУТРИ окна первой → сдвигается встык, остаётся в том же дне
    var sched = P.scheduleFromStored([C('A', 0, 480, 0, 180), C('B', 0, 500, 0, 60)], BASE);
    var m = schedById(sched);
    assert(Math.abs(m.B.startMin - m.A.finishMin) < 1e-6, '#4099 без opts: B встаёт встык за A (прежний #3885)');
    assert(dayOf(m.B.startMin) === 0, '#4099 без opts: перенос на след. день НЕ делается (потолка нет)');
})();

// ── 2) С opts — переполненный день: хвост уносится на следующий рабочий день, ничего за потолком ──
(function () {
    // 5 резок по 120 мин на 01.07: помещается ~3–4, остальные — на 02.07. Ёмкость = 975−480−40 = 455.
    var cuts = [];
    for (var i = 0; i < 6; i++) cuts.push(C('c' + i, 0, 480, 0, 120));   // все сохранены на 08:00 (перекрыты)
    var sched = P.scheduleFromStored(cuts, BASE, WIN);
    var ceil = WIN.cutEndMin - WIN.lunchDurationMin;   // 935 = потолок конца окна
    var overCeil = sched.filter(function (s) { return todOf(s.finishMin) > ceil + 1e-6; });
    assert(overCeil.length === 0, '#4099 с opts: ни одно окно не кончается за потолком смены (было бы: ' + overCeil.map(function (s) { return s.cutId; }).join(',') + ')');
    var days = {}; sched.forEach(function (s) { days[dayOf(s.startMin)] = (days[dayOf(s.startMin)] || 0) + 1; });
    assert(Object.keys(days).length >= 2, '#4099 с opts: переполнение раскидано минимум на 2 дня (' + JSON.stringify(days) + ')');
    // монотонность стартов (forward-only)
    var mono = true; for (var k = 1; k < sched.length; k++) if (sched[k].startMin < sched[k - 1].startMin - 1e-6) mono = false;
    assert(mono, '#4099 с opts: старты монотонны (перенос forward-only)');
})();

// ── 3) С opts — перенос ПЕРЕПРЫГИВАЕТ нерабочий день ──────────────────────────────────────────────
(function () {
    var win = { dayStartMin: 480, cutEndMin: 975, lunchDurationMin: 40, overworkMin: 0,
        dayOffAt: function (d) { return d === 1; } };   // день 1 — выходной
    var cuts = [];
    for (var i = 0; i < 6; i++) cuts.push(C('c' + i, 0, 480, 0, 120));
    var sched = P.scheduleFromStored(cuts, BASE, win);
    var usedDays = {}; sched.forEach(function (s) { usedDays[dayOf(s.startMin)] = 1; });
    assert(!usedDays[1], '#4099 перенос не ставит резки в нерабочий день 1 (' + Object.keys(usedDays).join(',') + ')');
    assert(usedDays[2], '#4099 перенос перепрыгнул выходной на день 2');
})();

// ── 4) Резка ДЛИННЕЕ смены (не разбить на показе) — ставится как есть, не зацикливаемся ────────────
(function () {
    var sched = P.scheduleFromStored([C('big', 0, 480, 0, 600)], BASE, WIN);   // 600 > ёмкости 455
    assert(sched.length === 1 && dayOf(sched[0].startMin) === 0, '#4099 сверх-длинная резка не переносится бесконечно, стоит в дне 0');
})();

// ── 5) РЕАЛЬНЫЕ данные Станка 1 (#4099 fixture): после фикса ничего не уходит в ночь ───────────────
(function () {
    var raw = require('./4099_cut_planning.fixture.json');
    var rows = raw.filter(function (r) { return r.cut_slitter_id === '1277' && r.cut_plan_date; });
    // база = полночь дня самого раннего старта
    var minTs = Math.min.apply(null, rows.map(function (r) { return Number(r.cut_plan_date); }));
    var base = Math.floor(minTs * 1000 / 86400000) * 86400000;
    var cuts = rows.map(function (r) {
        return { id: r.cut_id, planDate: r.cut_plan_date,
            storedKnifeSetupMin: r.cut_knife_setup_min, storedMaterialWindingMin: r.cut_material_winding_min,
            storedCutAndLeaderMin: r.cut_time, duration: r.cut_duration };
    });
    // окно в кадре base (старты в 05:00 UTC = 08:00 MSK); dayStart 300 (05:00), cutEnd 300+455, обед 40
    var win = { dayStartMin: 300, cutEndMin: 300 + 455 + 40, lunchDurationMin: 40, overworkMin: 5, dayOffAt: function () { return false; } };
    var before = P.scheduleFromStored(cuts, base);            // без потолка (как сейчас)
    var after = P.scheduleFromStored(cuts, base, win);        // с потолком
    function maxTod(sched) { return Math.max.apply(null, sched.map(function (s) { return todOf(s.finishMin); })); }
    function spanDays(sched) { var s = {}; sched.forEach(function (x) { s[dayOf(x.startMin)] = 1; }); return Object.keys(s).length; }
    var ceil = win.cutEndMin - win.lunchDurationMin + win.overworkMin;   // потолок конца окна
    assert(maxTod(before) > 1000, '#4099 РЕАЛ до фикса: бары уходят в ночь (макс конец суток ' + Math.round(maxTod(before)) + ' мин ≈ ' + Math.floor(maxTod(before) / 60) + ':xx)');
    var overCeil = after.filter(function (s) { return todOf(s.finishMin) > ceil + 1e-6; });
    assert(overCeil.length === 0, '#4099 РЕАЛ после фикса: ничего не кончается за потолком (нарушители: ' + overCeil.map(function (s) { return s.cutId; }).join(',') + ')');
    assert(spanDays(after) >= spanDays(before), '#4099 РЕАЛ после фикса: переполнение раскидано на ≥ дней, чем было (' + spanDays(before) + '→' + spanDays(after) + ')');
    console.log('   [инфо] РЕАЛ: до — макс конец суток ' + Math.round(maxTod(before)) + ' мин на ' + spanDays(before) + ' дн.; после — ' + Math.round(maxTod(after)) + ' мин на ' + spanDays(after) + ' дн.');
})();

console.log('\n' + passed + '/' + total + ' passed');
