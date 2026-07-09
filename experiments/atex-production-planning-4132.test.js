// Unit tests for ideav/crm#4132 — «Почему план вылез за 16:30 + допустимый нахлёст?»
//
// План НЕ вылезал: в сохранённых planStart хвост дня (Станок 1, 02.07.2026) стоит 15:35–16:20,
// то есть ровно на потолке cutEndMin(16:10) + MAX_OVERWORK_TUNE(10). Вылезала ОТРИСОВКА очереди:
// она вставляла обед ВТОРОЙ раз и уводила весь день после обеда на 40 минут вперёд → хвост
// рисовался 16:35–17:20 (и налезал на «Уборку после смены» 16:30–17:00).
//
// Причина — гард в lunchBakedIntoStarts: «зазор не за несущим обеда» (prev.startClock > LUNCH_START).
// Генерация решает, куда вставить обед, по НЕПРЕРЫВНЫМ минутам (insertLunchBefore: dayStart+clock ≥
// LUNCH_START), а сохранённые старты округляются вверх (#4061 снап + целые колонки). Карточка,
// начавшаяся у генерации в 12:19, лежит в базе как 12:23 — гард видел «12:23 > 12:20» и объявлял
// настоящий обеденный зазор «поздним простоем», то есть обед — «сквозным».
//
// Фикс: зазор опознаётся по ДЛИНЕ (≈ обед, двусторонний допуск ±1) и по тому, что он не утренний.
// Роль «позднего простоя» (#4121, второй «Отпуск») отсекает верхняя граница длины.
//
// Данные дня — РЕАЛЬНЫЕ, из вложений к issue #4132 («Задание в производство_2026-07-09.xlsx»).
//
// Run with: node experiments/atex-production-planning-4132.test.js

process.env.TZ = 'UTC';
global.window = { db: 'testdb', xsrf: 'x' };

var planning = require('../download/atex/js/production-planning.js').planning;

var passed = 0;
function assert(cond, name) {
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}
function hhmm(m) { m = Math.round(m); return ('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + (m % 60)).slice(-2); }

// Реальный день Станка 1 (02.07.2026): [id, planStart, setupMin, durationMin, leaderMin].
// Единственный зазор дня — обеденный, 13:12→13:52 (40 мин), СРАЗУ ЗА карточкой K12,
// которая стартует в 12:23 — на 3 минуты ПОЗЖЕ LUNCH_START 12:20.
var DAY = [
    ['K1', 480, 30, 10, 16], ['K2', 536, 0, 16, 8], ['K3', 560, 15, 3, 4], ['K4', 582, 15, 5, 8],
    ['K5', 610, 0, 5, 8], ['K6', 623, 0, 3, 4], ['K7', 630, 0, 5, 8], ['K8', 643, 0, 6, 6],
    ['K9', 655, 0, 2, 2], ['K10', 659, 15, 9, 14], ['K11', 697, 30, 6, 10], ['K12', 743, 45, 2, 2],
    ['K13', 832, 0, 2, 2], ['K14', 836, 0, 3, 4], ['K15', 843, 0, 8, 4], ['K16', 855, 15, 12, 20],
    ['K17', 902, 15, 12, 6], ['K18', 935, 45, 0, 0]   // K18 — setup-only хвост (0 проходов, #3635 п.5)
];
var cards = DAY.map(function(r) { return { id: r[0] }; });
var schedById = {};
DAY.forEach(function(r) {
    schedById[r[0]] = { startMin: r[1] + r[2], setupMin: r[2], finishMin: r[1] + r[2] + r[3], leaderMin: r[4] };
});
// Настройка ateh: перерывы 10:00 и 15:00 по 10 мин (TOTAL_INTERVALS=20), обед 12:20 × 40 мин.
var BREAKS = [
    { startMin: 600, durationMin: 10, kind: 'break', label: 'Перерыв' },
    { startMin: 740, durationMin: 40, kind: 'lunch', label: 'Обед' },
    { startMin: 900, durationMin: 10, kind: 'break', label: 'Перерыв' }
];

var r = planning.computeQueueBreakMarkers({ '0': cards }, schedById, BREAKS);

// 1) Обед распознан как ЗАШИТЫЙ: хвост двигают только два перерыва (10+10), не обед.
assert((r.shiftByCut.K18 || 0) === 20,
    '#4132: хвост дня сдвинут только перерывами (+20), обед-зазор не считается сквозным');

// 2) Окно хвоста на экране — 15:55–16:40, а не 16:35–17:20 (скриншот из issue).
var tail = DAY[DAY.length - 1];
var sh = r.shiftByCut.K18 || 0, ex = r.extendByCut.K18 || 0;
var winStart = tail[1] + sh, winEnd = tail[1] + tail[2] + tail[3] + tail[4] + sh + ex;
assert(hhmm(winStart) === '15:55' && hhmm(winEnd) === '16:40',
    '#4132: хвост рисуется ' + hhmm(winStart) + '–' + hhmm(winEnd) + ' (конец смены 16:30 + нахлёст настройки 10), а не 16:35–17:20');

// 3) Конец хвоста не залезает на «Уборку после смены» дальше допустимого нахлёста.
assert(winEnd <= 990 + 10, '#4132: конец хвоста ≤ DAY_END_HOUR(16:30) + MAX_OVERWORK_TUNE(10)');

// 4) Карточка перед обедом (K12, старт 12:23 — ПОЗЖЕ LUNCH_START) не мешает распознать зазор.
assert((r.shiftByCut.K13 || 0) === 10,
    '#4132: первая послеобеденная карточка сдвинута только утренним перерывом (+10)');

// ── Регресс #4121: «сквозной» обед + ПОЗДНИЙ простой (60 мин) — простой не забирает роль обеда ──
function sc(id, start, len) { return { startMin: start, setupMin: 0, finishMin: start + len, leaderMin: 0 }; }
var lateGap = { L1: sc('L1', 600, 120), L2: sc('L2', 720, 60), L3: sc('L3', 780, 120), L4: sc('L4', 960, 30) };
var rl = planning.computeQueueBreakMarkers({ '0': [{ id: 'L1' }, { id: 'L2' }, { id: 'L3' }, { id: 'L4' }] },
    lateGap, [{ startMin: 740, durationMin: 40, kind: 'lunch', label: 'Обед' }]);
assert(rl.shiftByCut.L3 === 40 && rl.shiftByCut.L4 === 40,
    '#4121 не сломан: поздний простой 60 мин — не обед, сквозной обед двигает L3/L4');

// ── Регресс #4121: утренний зазор — не обед ──
var morningGap = { M1: sc('M1', 480, 60), M2: sc('M2', 620, 180), M3: sc('M3', 800, 30) };
var rm = planning.computeQueueBreakMarkers({ '0': [{ id: 'M1' }, { id: 'M2' }, { id: 'M3' }] },
    morningGap, [{ startMin: 740, durationMin: 40, kind: 'lunch', label: 'Обед' }]);
assert(rm.shiftByCut.M3 === 40, '#4121 не сломан: утренний зазор — не обед, обед сквозной → M3 +40');

console.log('\n' + passed + ' assertions passed');
