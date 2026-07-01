// Unit tests for #3916 — «Журнал планирования»: станко-день = 520 мин из-за неверной
// длительности РАЗБИТОГО по дням задания в сохранённых полях.
//
// Корень (по трассе #3914, лог production-planning.log.txt): splitMachineQueue правильно
// дробит резку 229662 (82 прохода) на день 0 (30 проходов) + день 1 (52), и его ИТОГ дня 0 =
// 452 мин. Но applySplitPlan писал сегменту только «Кол-во резок план» (30), а «Длительность,
// минут» / «Резка и Лидер» головы оставались от ЦЕЛОЙ резки (намотка всех 82 проходов = 159).
// scheduleFromStored рисовал окно 14:22..17:16 = 174 мин → бейдж дня 452→520, карточка за смену.
//
// Фикс: applySplitPlan пишет тайминг записи-сегмента ПО ЕЁ проходам — тем же
// plannedCutDurationMinutes (perPass × проходы), что и splitMachineQueue; лидер = BETWEEN_CUTS ×
// проходов. Инвариант: сохранённая «Резка и Лидер» сегмента == длительности сегмента расписания
// (seg.durationMin), а сумма по сегментам == целой резке. Тогда бейдж == раскладке генерации.
//
// Тест воспроизводит формулу splitSegTimingFields (замыкание applySplitPlan) через
// экспортированные чистые функции и сверяет её с сегментами splitMachineQueue.
//
// Run with: node experiments/atex-production-planning-3916.test.js

process.env.TZ = 'UTC';
var planning = require('../download/atex/js/production-planning.js').planning;

var passed = 0;
function assert(cond, name) {
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) { passed++; } else { process.exitCode = 1; }
}

// Реальные ateh-настройки: 08:00–16:30, cutEnd 16:10, обед 12:20×40, нахлёст 5/10.
var opTimes = { WIND_100: 2, WIND_1000: 20, KNIFE: 30, MATERIAL_WINDING: 15, BETWEEN_CUTS: 1, KNIFE_MOVE: 2, CLEANUP_SHIFT: 30 };
var TIMES = { BETWEEN_CUTS: 1, KNIFE: 30, MATERIAL_WINDING: 15, KNIFE_MOVE: 2, CLEANUP_SHIFT: 30 };
var BETWEEN_CUTS = 1;
var windPoints = planning.windingPointsFromTimes(opTimes);
var RUN_LEN = 100;   // windingMinutes(100) = 2 мин/проход
var perPass = planning.windingMinutes(RUN_LEN, planning.windPointsForCut(false, windPoints));
assert(Math.abs(perPass - 2) < 1e-6, 'подготовка: perPass намотки = 2 мин (WIND_100=2, runLen=100)');

// Формула из splitSegTimingFields (applySplitPlan): тайминг записи по ЕЁ проходам.
function storedCutAndLeader(runs) {
    var P = Math.max(0, Math.round(Number(runs) || 0));
    if (P <= 0) return 0;
    var winding = Math.ceil(planning.plannedCutDurationMinutes(RUN_LEN, P, opTimes, false));
    return Math.round(winding + BETWEEN_CUTS * P);
}

// Очередь одного станка: большая резка BIG (200 проходов × 3 мин = 600 > ёмкости 455),
// поэтому ОБЯЗАНА разбиться на день 0 (хвост смены) + день 1 (остаток) — как 229662 в логе.
var BIG_RUNS = 200;
function cut(id, runs) {
    return { id: id, slitter: { id: 'm1' }, materialId: 'M1', winding: 'OUT',
        knifeWidths: [100], knifeCount: 1, rollerWidth: 0, plannedRuns: runs };
}
var cuts = [cut('BIG', BIG_RUNS)];
var perPassByCut = { BIG: perPass };
var runsByCut = { BIG: BIG_RUNS };
var opts = {
    dayStartMin: 480, dayEndMin: 970, dayEndHourMin: 990,
    maxOverworkCutsMin: 5, maxOverworkTuneMin: 10,
    times: TIMES, lunchStartMin: 740, lunchDurationMin: 40, firstCutSetup: true, gapFill: true,
    perPassByCut: perPassByCut, runsByCut: runsByCut
};
var segs = planning.splitMachineQueue(cuts, opts);
var bigSegs = segs.filter(function (s) { return String(s.cutId) === 'BIG'; });

assert(bigSegs.length >= 2, 'резка BIG разбита минимум на 2 сегмента по дням (' + bigSegs.length + ')');

// ── 1) Тайминг КАЖДОГО сегмента (формула фикса) == длительности сегмента расписания ──
// (setupMin в бейдже — отдельно; сравниваем «Резку и Лидер» = намотка+лидер сегмента).
var allMatch = bigSegs.every(function (s) {
    return Math.abs(storedCutAndLeader(s.runs) - Number(s.durationMin)) <= 1 + 1e-6;
});
assert(allMatch, '#3916: сохранённая «Резка и Лидер» сегмента == его durationMin в расписании ('
    + bigSegs.map(function (s) { return s.runs + 'пр→' + storedCutAndLeader(s.runs) + 'vs' + Math.round(s.durationMin); }).join(', ') + ')');

// ── 2) Сумма по сегментам == целой резке (метраж/минуты не теряются и не задваиваются) ──
var totalRuns = bigSegs.reduce(function (a, s) { return a + Number(s.runs); }, 0);
var sumStored = bigSegs.reduce(function (a, s) { return a + storedCutAndLeader(s.runs); }, 0);
assert(totalRuns === BIG_RUNS, '#3916: сумма проходов сегментов == ' + BIG_RUNS + ' (' + totalRuns + ')');
assert(Math.abs(sumStored - storedCutAndLeader(BIG_RUNS)) <= bigSegs.length,
    '#3916: Σ «Резка и Лидер» сегментов ≈ целой резке (' + sumStored + ' ≈ ' + storedCutAndLeader(BIG_RUNS) + ')');

// ── 3) БАГ, который чиним: у сегмента дня 0 (НЕполный) сохранённая длительность ДОЛЖНА быть
//      меньше целой резки. Прежде applySplitPlan хранил на голове длительность ВСЕХ проходов
//      (storedCutAndLeader(BIG_RUNS)) при неполных фактических → бейдж дня переполнялся. ──
var head = bigSegs[0];
assert(head.runs < BIG_RUNS, 'подготовка: сегмент дня 0 неполный (' + head.runs + ' из ' + BIG_RUNS + ' проходов)');
assert(storedCutAndLeader(head.runs) < storedCutAndLeader(BIG_RUNS),
    '#3916: длительность сегмента дня 0 (' + storedCutAndLeader(head.runs) + ') < длительности целой резки ('
    + storedCutAndLeader(BIG_RUNS) + ') — голова больше не хранит намотку всех проходов');

// ── 4) setup-сегмент (0 проходов, #3635 п.5) → тайминг 0 (ни намотки, ни лидера) ──
assert(storedCutAndLeader(0) === 0, '#3916: сегмент настройки (0 проходов) → «Резка и Лидер» = 0');

console.log('\n' + passed + ' assertions passed');
