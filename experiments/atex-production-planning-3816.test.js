// Unit tests for #3816 — «Как опять могло получиться 502 минуты?»
//
// Реальные настройки ATEH: окно резки 08:00–16:10 (DAY_END 16:30 − TOTAL_INTERVALS 20),
// обед LUNCH_START 12:20 длительностью 40 → рабочая ёмкость дня = 490 − 40 = 450 мин.
//
// Корень: buildSchedule (отображение очереди станка) вставлял обед паузой ТОЛЬКО перед
// резкой, СТАРТУЮЩЕЙ в/после LUNCH_START. Длинная резка, которая стартует ДО обеда и идёт
// сквозь него, обед не получала: день «работал сквозь обед», конец дня приходился на ~16:22,
// а в окно 490 мин укладывалось ~502 мин РАБОТЫ (450 ёмкости + один захлёстный проход #3760),
// потому что зарезервированные под обед 40 мин съедал захлёстный проход.
//
// Фикс (#3816): резка, чья намотка ПЕРЕСЕКАЕТ окно обеда (старт < LUNCH_START < старт+намотка),
// паузит на обед В ХОДЕ намотки — финиш сдвигается на длительность обеда, обед помечается
// вставленным. Поведение #3739/#3760 (один захлёстный проход) сохранено: durationMin (минуты
// работы, основа бейджа дня) не меняется; меняется только конец дня и положение обеда.
//
// Run with: node experiments/atex-production-planning-3816.test.js

process.env.TZ = 'UTC';
var planning = require('../download/atex/js/production-planning.js').planning;

var passed = 0;
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; }
    else { console.log('  expected:', JSON.stringify(expected)); console.log('  actual:  ', JSON.stringify(actual)); process.exitCode = 1; }
}

// Окно ATEH: 08:00 (480) — 16:10 (970); обед 12:20 (740) на 40 мин.
var SHIFT_START = 8 * 60;          // 480
var SHIFT_END = 16 * 60 + 10;      // 970
var LUNCH_START = 12 * 60 + 20;    // 740
var LUNCH_DUR = 40;

// Резки одной конфигурации (setup 0, лидер 0); длительность задаём напрямую полем `duration`.
function dcut(id, dur) {
    return { id: id, slitter: { id: 'm1' }, materialId: 'M1', winding: 'OUT',
        knifeWidths: [55, 55], knifeCount: 2, rollerWidth: 0, plannedRuns: 0, duration: dur };
}
var TIMES = { BETWEEN_CUTS: 0 };

function build(cuts) {
    return planning.buildSchedule(cuts, {
        windPoints: [], times: TIMES, runLengthByCut: {},
        shiftStartMin: SHIFT_START, shiftEndMin: SHIFT_END,
        lunchStartMin: LUNCH_START, lunchDurationMin: LUNCH_DUR,
        dayAnchorByCut: cuts.reduce(function(m, c){ m[c.id] = 0; return m; }, {}),
        gapFill: true
    });
}
function byId(sched) { var m = {}; sched.forEach(function(s){ m[s.cutId] = s; }); return m; }

// ── 1) Длинная резка, ПЕРЕСЕКАЮЩАЯ обед — намотка паузит на обед (финиш +40) ──────────────
// X стартует в 08:00 (480), намотка 300 мин. Без обеда финиш = 480+300 = 780 (13:00); окно
// обеда 740 (12:20) попадает в намотку → финиш сдвигается на 40 → 820 (13:40).
var s1 = byId(build([ dcut('X', 300) ]));
assertEqual({ start: s1.X.startMin, dur: s1.X.durationMin, finish: s1.X.finishMin },
    { start: 480, dur: 300, finish: 820 },
    '#3816: намотка через обед — финиш сдвинут на обед (40), durationMin не изменился');

// ── 2) Резка целиком ДО обеда — обед не вставляется ───────────────────────────────────────
// Y: 08:00 (480) + 120 = 600 (10:00), весь до 740 → без обеда.
var s2 = byId(build([ dcut('Y', 120) ]));
assertEqual({ finish: s2.Y.finishMin }, { finish: 600 },
    '#3816: резка целиком до обеда — финиш без сдвига');

// ── 3) Резка стартует ПОСЛЕ обеда — пауза ПЕРЕД ней (прежнее поведение #3342) ──────────────
// Z1 (08:00,+260=12:20 ровно 740 — стартует не позже обеда, идёт через него: финиш +40),
// затем Z2 должен начаться после обеда. Проверяем отдельным кейсом: одна резка после обеда.
var s3 = byId(build([ dcut('P', 240), dcut('Q', 60) ]));
// P: 480..720 (08:00–12:00), весь до обеда. Q стартует в 720 (12:00) < 740 и идёт до 780 —
// пересекает обед → финиш Q = 720+60+40 = 820 (13:40); обед — внутри Q.
assertEqual({ pFin: s3.P.finishMin, qStart: s3.Q.startMin, qFin: s3.Q.finishMin },
    { pFin: 720, qStart: 720, qFin: 820 },
    '#3816: P до обеда (фин 12:00), Q пересекает обед (фин 13:40, обед внутри Q)');

// ── 4) Обед вставляется ОДИН раз: длинная резка через обед, потом ещё резки ────────────────
// A (08:00,+300 → пересекает обед, финиш 480+300+40=820=13:40), B (старт 820, +60 → 880),
// B уже ПОСЛЕ обеда — второй раз обед не вставляем.
var s4 = byId(build([ dcut('A', 300), dcut('B', 60) ]));
assertEqual({ aFin: s4.A.finishMin, bStart: s4.B.startMin, bFin: s4.B.finishMin },
    { aFin: 820, bStart: 820, bFin: 880 },
    '#3816: обед вставлен один раз (в A); B после обеда — без повторной паузы');

// ── 5) Сумма РАБОТЫ за день (бейдж) не меняется от вставки обеда (поведение #3760 сохранено) ─
// Бейдж = сумма durationMin (+setup+leader). Обед в durationMin не входит.
var work = build([ dcut('A', 300), dcut('B', 60) ]).reduce(function(m, s){
    return m + (s.setupMin || 0) + (s.durationMin || 0) + (s.leaderMin || 0); }, 0);
assertEqual(work, 360, '#3816: бейдж (минуты работы) = 360, обед в сумму не входит');

console.log('\n' + passed + ' passed');
