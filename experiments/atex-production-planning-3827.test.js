// Unit tests for #3827 — «После кнопки упорядочить ошибки»: сумма минут дня станка в бейдже
// прыгала в зависимости от фильтра дат (Вт 23.06 → 483 мин при фильтре «23», но 467 мин при
// «23–30»).
//
// Причина: сегмент НАСТРОЙКИ (#3635 п.5: запись «Задание в производство» с «Кол-во план» = 0,
// настройка в хвосте дня N, намотка-продолжение с дня N+1) опознавался setupTaskIdSet только
// когда в ЗАГРУЖЕННОМ наборе была и резка той же цепочки (slitter|материал|намотка|ножи) с
// проходами > 0. При УЗКОМ фильтре дат продолжение (на след. дне) в набор не попадало →
// сегмент настройки оставался «одиноким», терял признак setup-only и в расписании
// (buildSchedule) считался обычной задачей: #3805 не дробил его настройку по концу смены, и в
// хвост дня падала ПОЛНАЯ переналадка (ножи 30 + сырьё 15 = 45) вместо хвостового подмножества
// (ножи 30) → бейдж дня прыгал на 15 мин и вылетал за «смену + один шаг наладки».
//
// Фикс (#3827): 0-проходную резку всегда создаёт только планировщик как разрыв настройки
// (splitMachineQueue, setupOnly) — других источников нет, поэтому setupTaskIdSet опознаёт её
// по самому признаку «0 проходов», НЕ требуя, чтобы продолжение было видно в наборе. Сумма дня
// в бейдже теперь одинаковая независимо от ширины фильтра дат.
//
// Run with: node experiments/atex-production-planning-3827.test.js

process.env.TZ = 'UTC';
var planning = require('../download/atex/js/production-planning.js').planning;

var passed = 0;
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; }
    else { console.log('  expected:', JSON.stringify(expected)); console.log('  actual:  ', JSON.stringify(actual)); process.exitCode = 1; }
}

var TIMES = { KNIFE: 30, MATERIAL_WINDING: 15, BETWEEN_CUTS: 0 };
// Рабочее окно дня 0..450 (без обеда) — ёмкость 450.
var WIN = { shiftStartMin: 0, shiftEndMin: 450 };

function cut(id, mat, kw, runs, dur) {
    return { id: id, slitter: { id: 'm1' }, materialId: mat, winding: 'IN',
        knifeWidths: kw, knifeCount: kw.length, rollerWidth: 0, plannedRuns: runs, duration: dur };
}
// День 0: A заполняет смену (настройка ножей с нуля 30 + намотка 400 → окно 0..430). Дальше
// сегмент НАСТРОЙКИ S (0 проходов, другое сырьё+ножи → переналадка 45) не влезает целиком в
// остаток 20 → #3805 кладёт в хвост подмножество (ножи 30), сырьё 15 — на продолжение C (день 1).
var A = cut('A', 'M1', [50], 1, 400);
var S = cut('S', 'M2', [60], 0, 0);     // setup-only (0 проходов)
var C = cut('C', 'M2', [60], 3, 60);    // намотка-продолжение, день 1

function dayBadge(cuts, anchors, day) {
    var sched = planning.buildSchedule(cuts, {
        times: TIMES, shiftStartMin: WIN.shiftStartMin, shiftEndMin: WIN.shiftEndMin,
        setupTaskIds: planning.setupTaskIdSet(cuts), dayAnchorByCut: anchors,
        firstCutSetup: true, gapFill: true
    });
    var sum = 0;
    sched.forEach(function(sc) {
        if (Math.floor((Number(sc.startMin) || 0) / 1440) !== day) return;
        sum += (Number(sc.setupMin) || 0) + (Number(sc.durationMin) || 0) + (Number(sc.leaderMin) || 0);
    });
    return Math.round(sum);
}

// ── 1) Сегмент настройки опознаётся по «0 проходов» даже без видимого продолжения ─────────────
assertEqual(planning.setupTaskIdSet([A, S]), { S: true },
    '#3827: одинокий сегмент настройки (0 проходов) опознаётся без продолжения в наборе');

// ── 2) Бейдж дня НЕ зависит от ширины фильтра дат ────────────────────────────────────────────
// Узкий фильтр «день 0» (продолжение C не загружено) и широкий «дни 0–1» (C загружено) дают
// ОДИНАКОВУЮ сумму минут дня 0. Раньше узкий фильтр давал +15 (полная переналадка в хвост).
var narrow = dayBadge([A, S], { A: 0, S: 0 }, 0);
var wide = dayBadge([A, S, C], { A: 0, S: 0, C: 1 }, 0);
assertEqual(narrow, wide,
    '#3827: сумма минут дня 0 одинакова при узком и широком фильтре дат (' + narrow + ' = ' + wide + ')');

// ── 3) В хвост дня попадает ТОЛЬКО подмножество настройки (ножи 30), не полная (45) ───────────
// Окно: A 30+400=430, хвостовая настройка S = 30 (ножи) → 460. Полная (45) дала бы 475.
assertEqual(narrow, 460,
    '#3827: бейдж дня 0 = 460 (A 30+400, хвост настройки S 30 — подмножество, не полная 45)');

console.log('\n' + passed + ' passed');
