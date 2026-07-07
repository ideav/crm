// Unit tests for scheduleFromStored — «РИСУЕМ КАК ЕСТЬ» (ideav/crm#4099, ревизия #3885/#3920).
//
// Since #3846 the production-planning queue renders the SAVED plan (scheduleFromStored).
// #3885/#3920 used to lay same-day cuts EDGE TO EDGE (anti-overlap): a cut's window was
// pushed past the previous same-day window. That HID an over-booked day (sum of work >
// shift) by turning it into one continuous train running far past the shift end (issue
// #4099). The customer asked to draw the plan AS IS. scheduleFromStored now keeps every
// window at its SAVED planStart with NO shift — overlaps are shown verbatim so it is
// obvious a day carries more work than fits.
//
// Run with: node experiments/atex-production-planning-3885.test.js

process.env.TZ = 'UTC';

var planning = require('../download/atex/js/production-planning.js').planning;
var scheduleFromStored = planning.scheduleFromStored;

var passed = 0;
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; }
    else {
        console.log('  expected:', JSON.stringify(expected));
        console.log('  actual:  ', JSON.stringify(actual));
        process.exitCode = 1;
    }
}

// base = 0 → windowStartMin = planDate(sec) / 60. 08:00 = 480 min → planDate 28800.
var BASE = 0;
var DAY = 1440;
function cut(id, startMin, setupKnife, setupMaterial, cutAndLeader) {
    return {
        id: id,
        planDate: String(startMin * 60),                 // unix-секунды старта окна
        storedKnifeSetupMin: String(setupKnife),
        storedMaterialWindingMin: String(setupMaterial),
        storedCutAndLeaderMin: String(cutAndLeader)
    };
}
// window-start (= startMin − setupMin) and window-end (= finishMin) per result entry.
function windows(sched) {
    return sched.map(function (sc) {
        return { id: sc.cutId, ws: sc.startMin - sc.setupMin, we: sc.finishMin };
    });
}

// ── 1. #4099: коллизия (обе резки сохранены на 08:00) — окна КАК ЕСТЬ, перекрытие видно ──
// 188600: наладка 45 (30+15), резка+лидер 475 → окно 08:00–16:40 (480..1000).
// 191769: наладка 45, резка+лидер 16 → сохранено тоже 08:00 → остаётся 08:00 (перекрытие).
(function () {
    var sched = scheduleFromStored([
        cut('188600', 480, 30, 15, 475),
        cut('191769', 480, 30, 15, 16)
    ], BASE);
    assertEqual(windows(sched), [
        { id: '188600', ws: 480, we: 1000 },   // 08:00–16:40 как есть
        { id: '191769', ws: 480, we: 541 }     // #4099: остаётся на 08:00 (не выталкивается)
    ], '#4099 коллизия — обе резки остаются на сохранённом 08:00 (перекрытие показываем как есть)');
})();

// ── 2. Непересекающиеся сохранённые старты (в т.ч. обеденный зазор) — как есть (#3846) ──
(function () {
    var sched = scheduleFromStored([
        cut('A', 480, 0, 0, 200),    // 08:00–11:20
        cut('B', 740, 0, 0, 60)      // 12:20–13:20 (зазор 11:20→12:20 = обед, сохраняем)
    ], BASE);
    assertEqual(windows(sched), [
        { id: 'A', ws: 480, we: 680 },
        { id: 'B', ws: 740, we: 800 }
    ], 'непересечение — разные старты и обеденный зазор не трогаются');
})();

// ── 3. Одинаковое 08:00, но РАЗНЫЕ дни — раздельно (как есть) ──
(function () {
    var sched = scheduleFromStored([
        cut('D0', 480, 0, 0, 60),            // day 0, 08:00
        cut('D1', DAY + 480, 0, 0, 60)       // day 1, 08:00
    ], BASE);
    assertEqual(windows(sched), [
        { id: 'D0', ws: 480, we: 540 },
        { id: 'D1', ws: DAY + 480, we: DAY + 540 }
    ], 'разные дни — оба в 08:00 остаются раздельными');
})();

// ── 4. #4099: три резки на 08:00 — все остаются на 08:00 (не встают встык) ──
(function () {
    var sched = scheduleFromStored([
        cut('C1', 480, 0, 0, 100),   // 08:00–09:40
        cut('C2', 480, 0, 0, 50),    // 08:00–08:50 (как есть)
        cut('C3', 480, 0, 0, 30)     // 08:00–08:30 (как есть)
    ], BASE);
    assertEqual(windows(sched), [
        { id: 'C1', ws: 480, we: 580 },
        { id: 'C2', ws: 480, we: 530 },
        { id: 'C3', ws: 480, we: 510 }
    ], '#4099 каскад — три резки с общим стартом остаются на 08:00 (перекрытие как есть)');
})();

// ── 5. #4099: частичный нахлёст сохраняется как есть (позднюю не выталкиваем) ──
(function () {
    var sched = scheduleFromStored([
        cut('P1', 480, 0, 0, 120),   // 08:00–10:00
        cut('P2', 540, 0, 0, 40)     // сохранено 09:00 → остаётся 09:00–09:40 (нахлёст виден)
    ], BASE);
    assertEqual(windows(sched), [
        { id: 'P1', ws: 480, we: 600 },
        { id: 'P2', ws: 540, we: 580 }
    ], '#4099 частичный нахлёст — поздняя резка остаётся на своём сохранённом старте');
})();

console.log('\n' + passed + ' assertions passed.');
