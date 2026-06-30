// Unit tests for scheduleFromStored anti-overlap guard (ideav/crm#3885).
//
// Since #3846 the production-planning queue renders the SAVED plan (scheduleFromStored)
// instead of recomputing on the fly (buildSchedule). If two cuts of the SAME machine in
// one day carry the same stored planStart (t1078) — a leftover of an incomplete start
// re-pack (move before #3840, or a re-sequence limited to the filter scope #3660) — the
// queue used to draw two cards at the same time («2 резки в одно время», #3885).
//
// scheduleFromStored now lays same-day cuts edge to edge: a cut's window never starts
// before the previous same-day cut's window ends. Non-overlapping saved starts (incl.
// lunch gaps) and cuts on different days stay exactly as stored.
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

// ── 1. The #3885 collision: both cuts stored at 08:00 on Станок 4 / 03.07 ──
// 188600: setup 45 (30+15), namotka+leader 475 → window 08:00–16:40 (480..1000).
// 191769: setup 45, namotka+leader 16 → stored also at 08:00, must move to 16:40.
(function () {
    var sched = scheduleFromStored([
        cut('188600', 480, 30, 15, 475),
        cut('191769', 480, 30, 15, 16)
    ], BASE);
    assertEqual(windows(sched), [
        { id: '188600', ws: 480, we: 1000 },   // first cut unchanged (08:00–16:40)
        { id: '191769', ws: 1000, we: 1061 }    // pushed to 16:40–17:41 (no overlap)
    ], '#3885 collision — second cut sequenced after the first (no two-at-08:00)');
})();

// ── 2. Non-overlapping saved starts (incl. lunch gap) stay verbatim (#3846) ──
(function () {
    var sched = scheduleFromStored([
        cut('A', 480, 0, 0, 200),    // 08:00–11:20
        cut('B', 740, 0, 0, 60)      // 12:20–13:20 (gap 11:20→12:20 = lunch, preserved)
    ], BASE);
    assertEqual(windows(sched), [
        { id: 'A', ws: 480, we: 680 },
        { id: 'B', ws: 740, we: 800 }
    ], 'non-overlap — distinct stored starts and lunch gap untouched');
})();

// ── 3. Same stored 08:00 but on DIFFERENT days must NOT be merged ──
(function () {
    var sched = scheduleFromStored([
        cut('D0', 480, 0, 0, 60),            // day 0, 08:00
        cut('D1', DAY + 480, 0, 0, 60)       // day 1, 08:00
    ], BASE);
    assertEqual(windows(sched), [
        { id: 'D0', ws: 480, we: 540 },
        { id: 'D1', ws: DAY + 480, we: DAY + 540 }
    ], 'different days — both at 08:00 stay separate');
})();

// ── 4. Cascading collision: three cuts stored at 08:00 stack in queue order ──
(function () {
    var sched = scheduleFromStored([
        cut('C1', 480, 0, 0, 100),   // 08:00–09:40
        cut('C2', 480, 0, 0, 50),    // → 09:40–10:30
        cut('C3', 480, 0, 0, 30)     // → 10:30–11:00
    ], BASE);
    assertEqual(windows(sched), [
        { id: 'C1', ws: 480, we: 580 },
        { id: 'C2', ws: 580, we: 630 },
        { id: 'C3', ws: 630, we: 660 }
    ], 'cascading — three same-start cuts stack edge to edge');
})();

// ── 5. Partial overlap (not exact-equal start) is also removed ──
(function () {
    var sched = scheduleFromStored([
        cut('P1', 480, 0, 0, 120),   // 08:00–10:00
        cut('P2', 540, 0, 0, 40)     // stored 09:00 (overlaps) → moved to 10:00–10:40
    ], BASE);
    assertEqual(windows(sched), [
        { id: 'P1', ws: 480, we: 600 },
        { id: 'P2', ws: 600, we: 640 }
    ], 'partial overlap — later cut pushed past the previous window end');
})();

console.log('\n' + passed + ' assertions passed.');
