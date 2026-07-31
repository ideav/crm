// Unit tests for #3846 — «Данные по дырам» + «Минуты не совпадают между production-planning и Гантом».
//
// Корень: страница планирования ПЕРЕСЧИТЫВАЛА расписание live (buildSchedule на каждый рендер) —
// firstCutSetup вместо реальной заправки станка + неучтённый обед (#3342). РМ «Диаграмма Ганта»
// рисует СОХРАНЁННЫЙ planStart без пересчёта. Поэтому минуты/времена двух экранов расходились, а
// 40-минутный обед, уже зашитый генерацией в planStart послеобеденных резок, выглядел «дырой».
//
// Фикс (#3846): production-planning показывает СОХРАНЁННЫЙ план через scheduleFromStored (тот же
// источник, что у Ганта → времена/минуты ВСЕГДА совпадают). Единственное, что «считаем» на показе, —
// обед: показывается накладкой на несущей карточке (#4075/#4052), а не отдельным блоком.
//
// Эти тесты гардируют обе чистые функции.
//
// Run with: node experiments/atex-production-planning-3846.test.js

process.env.TZ = 'UTC';
var planning = require('../download/atex/js/production-planning.js').planning;

var passed = 0;
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; }
    else { console.log('  expected:', JSON.stringify(expected)); console.log('  actual:  ', JSON.stringify(actual)); process.exitCode = 1; }
}
function assert(cond, name) { assertEqual(!!cond, true, name); }

// База — полночь дня планирования (день 0). planStart резки = Unix-сек = окно/начало настройки.
var BASE = Date.UTC(2026, 5, 29, 0, 0, 0);   // 29.06.2026 00:00 UTC
function ts(h, m) { return Math.floor((BASE + (h * 60 + m) * 60000) / 1000); }   // planStart для HH:MM дня 0
function cut(id, h, m, knife, material, cutTime) {
    return { id: id, planDate: ts(h, m),
        storedKnifeSetupMin: knife, storedMaterialWindingMin: material,
        storedCutAndLeaderMin: cutTime, duration: cutTime, plannedRuns: 1 };
}

// ── scheduleFromStored: окно = setup + cut_time, без live-пересчёта ───────────────────────────
// №1 окно 08:00, наладка 15 (ножи 5 + сырьё 10), «Резка и Лидер» 19 → намотка 08:15, финиш 08:34.
var s1 = planning.scheduleFromStored([cut('A', 8, 0, 5, 10, 19)], BASE);
assertEqual(s1.length, 1, '#3846: одна резка → один сегмент');
assertEqual([s1[0].setupMin, s1[0].durationMin, s1[0].leaderMin], [15, 19, null],
    '#3846: setup=ножи+сырьё, duration=«Резка и Лидер», leader=null (включён в duration)');
assertEqual([s1[0].startMin, s1[0].finishMin], [480 + 15, 480 + 15 + 19],
    '#3846: старт намотки = окно+setup, финиш = старт+duration');
// Окно (как рисует Гант и строка карточки): начало = startMin−setup, длина = setup+duration.
assertEqual(s1[0].startMin - s1[0].setupMin, 480, '#3846: начало окна = планстарт (08:00)');
assertEqual(s1[0].setupMin + s1[0].durationMin, 34, '#3846: длина окна = 34 мин (15+19)');

// Нет planStart → резка не попадает на ось (не выдумываем время).
assertEqual(planning.scheduleFromStored([{ id: 'X', planDate: null }], BASE), [],
    '#3846: резка без planStart пропущена');
// duration как запасной источник, если «Резка и Лидер» пуст.
var sFallback = planning.scheduleFromStored([cut('B', 9, 0, 0, 0, '')], BASE);
sFallback = planning.scheduleFromStored([{ id: 'B', planDate: ts(9, 0), storedCutAndLeaderMin: '', duration: 25 }], BASE);
assertEqual(sFallback[0].durationMin, 25, '#3846: пустой cut_time → fallback на duration');

// Обеденный зазор больше не рисуется отдельным блоком: обед и перерывы показываются накладкой на
// несущей карточке (#4075 в очереди, #4052 на Ганте) — их проверяют atex-production-planning-4075
// и atex-cut-gantt-4052. Прежний помощник lunchBlocksFromSchedule удалён как мёртвый код.

