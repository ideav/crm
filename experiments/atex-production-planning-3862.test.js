// Unit tests — #3862: модалка тайминга резки рисует ТО ЖЕ окно, что карточка/Гант
// (scheduleFromStored), а не пересчитывает setup/лидер на лету.
//
// Симптом (#3862): у первой резки карточка показывала окно 51 мин (08:00–08:51 = сохранённые
// «Наладка ножей» 30 + «Сырьё-намотка» 15 + «Резка и Лидер» 6), а модалка справа — настройку
// ножей 30 с 08:15 (зазор 08:00–08:15) и «готово» 08:55 (лидер посчитан ВТОРОЙ раз поверх окна).
// Два пути расходились: карточка читала сохранённое, модалка пересчитывала.
//
// Фикс: при сохранённом расписании (sc.leaderMin == null) модалка берёт setup из сохранённых
// колонок (сумма = sc.setupMin → нет зазора), а лидер входит в окно → «готово» = finishMin.
// Live-расписание (buildSchedule, leaderMin задан числом) не трогаем: лидер ПОСЛЕ окна.
//
// Run with: node experiments/atex-production-planning-3862.test.js

process.env.TZ = 'UTC';
var planning = require('../download/atex/js/production-planning.js').planning;

var passed = 0;
function ok(cond, name) {
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}
function texts(lines) { return lines.map(function (l) { return l.text; }); }
function has(arr, sub) { return arr.some(function (t) { return t.indexOf(sub) !== -1; }); }

// База — полночь дня; planStart первой резки = 08:00 (480 мин).
var base = Date.UTC(2026, 5, 29);          // 2026-06-29 00:00 UTC, мс
var ts = base / 1000 + 8 * 3600;           // 08:00, сек

// Резка как на скриншоте #3862: сохранённые колонки — ножи 30 + сырьё 15, «Резка и Лидер» 6.
var cut = {
    id: 'c1', plannedRuns: 2, isFoil: false,
    knifeWidths: [30, 30], knifeCount: 2,
    planDate: String(ts), number: String(ts),
    duration: '2',
    storedKnifeSetupMin: '30', storedMaterialWindingMin: '15', storedCutAndLeaderMin: '6'
};

// ── Сохранённое расписание (карточка/Гант) ──
var sched = planning.scheduleFromStored([cut], base);
var sc = sched[0];
ok(sc && sc.setupMin === 45, 'scheduleFromStored: setupMin = 30+15 = 45 (окно карточки)');
ok(sc && sc.startMin === 525 && sc.finishMin === 531, 'scheduleFromStored: старт 08:45 (525), финиш 08:51 (531)');
ok(sc && sc.leaderMin == null, 'scheduleFromStored: leaderMin == null (лидер внутри durationMin)');

// ── Модалка тайминга из сохранённого расписания ──
var ctx = planning.buildCutTimingCtx(cut, null, sc, 200, [], {}, { firstCutSetup: true });
var setupSum = (ctx.setupParts || []).reduce(function (s, p) { return s + (Number(p.minutes) || 0); }, 0);

ok(ctx.leaderInWindow === true, 'модалка: leaderInWindow = true (лидер входит в окно)');
ok(setupSum === 45, 'модалка: сумма setupParts = 45 (= sc.setupMin, не пересчитанные 30)');

var lines = texts(planning.cutTimingTimelineLines(ctx));
// Первая строка тайминга окна (после «Тайминг окна:») — настройка от НАЧАЛА окна (08:00), без зазора.
var setupLine = lines.filter(function (t) { return /^08:00 · /.test(t); })[0];
ok(!!setupLine, 'модалка: настройка начинается в 08:00 (нет зазора 08:00–08:15)');
ok(has(lines, '08:51 · готово'), 'модалка: «готово» = 08:51 (= finishMin карточки)');
ok(!has(lines, '08:55'), 'модалка: НЕТ 08:55 (лидер не посчитан вторым окном)');

// ── Регрессия: live-расписание (buildSchedule, leaderMin число) — лидер ПОСЛЕ окна ──
var scLive = { cutId: 'c1', startMin: 525, finishMin: 527, setupMin: 30, durationMin: 2, leaderMin: 4 };
var ctxLive = planning.buildCutTimingCtx(cut, null, scLive, 200, [], {}, { firstCutSetup: true });
ok(ctxLive.leaderInWindow === false, 'live: leaderInWindow = false (лидер отдельной величиной)');
var linesLive = texts(planning.cutTimingTimelineLines(ctxLive));
// finishMin 527 (08:47) + лидер 4 → «готово» 531 (08:51).
ok(has(linesLive, '08:51 · готово'), 'live: «готово» = finishMin + лидер (08:47 + 4 = 08:51) — поведение прежнее');

console.log('\n' + passed + ' passed');
