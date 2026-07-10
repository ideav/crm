// Unit tests for ideav/crm#4131 — минуты и число заданий КАЖДОГО дня в строке-заголовке станка.
//
// Первая ячейка строки станка даёт итог по всему выбранному интервалу («34 (1298 мин)»). Теперь
// над колонкой каждого дня оси стоит бейдж со своим числом заданий и своей суммой минут. Сумма
// бейджей дней = итогу станка; дни без заданий бейджа не получают.
//
// Run with: node experiments/atex-cut-gantt-4131.test.js

process.env.TZ = 'Europe/Moscow';
var g = require('../download/atex/js/cut-gantt.js').gantt;

var passed = 0;
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; }
    else { console.log('  expected:', JSON.stringify(expected)); console.log('  actual:  ', JSON.stringify(actual)); process.exitCode = 1; }
}

function cut(id, planIso, knife, material, cutTime) {
    return { id: id, planDate: planIso, setupKnifeMin: knife, setupMaterialMin: material, cutTimeMin: cutTime };
}
var PPM = 2;   // режим «День»: 2 px на минуту → рабочее окно 08:00–18:30 = 630 мин = 1260px

// Три дня подряд на одном станке. Минуты бара = наладка + резка (cutBarSpanMin).
var cuts = [
    cut('A1', '2026-06-29 08:00', 30, 15, 60),    // 105 мин
    cut('A2', '2026-06-29 10:00', 0, 0, 45),      //  45 мин  → день 29.06: 2 задания, 150 мин
    cut('B1', '2026-06-30 08:00', 0, 20, 100),    // 120 мин  → день 30.06: 1 задание, 120 мин
    cut('C1', '2026-07-01 09:00', 0, 0, 30),      //  30 мин
    cut('C2', '2026-07-01 11:00', 15, 0, 55)      //  70 мин  → день 01.07: 2 задания, 100 мин
];

var range = g.ganttRange('2026-06-29', 'three');
var data = g.layoutGroups(cuts, range, Date.parse('2026-06-29T07:00:00+03:00'), {}, { pxPerMin: PPM });
var group = data.groups[0];
var stats = g.machineDayStats(group.tasks, data.scale);

assertEqual(stats.map(function(s) { return [s.count, s.min]; }),
    [[2, 150], [1, 120], [2, 100]],
    'по дням: число заданий и сумма минут каждого дня');

assertEqual(stats.reduce(function(sum, s) { return sum + s.min; }, 0), group.tasksMin,
    'сумма минут по дням = итогу станка (tasksMin)');

assertEqual(stats.reduce(function(sum, s) { return sum + s.count; }, 0), group.tasks.length,
    'сумма заданий по дням = числу заданий станка');

// Бейдж стоит ровно над колонкой своего дня (leftPx/widthPx = отрезок оси этого дня).
assertEqual(stats.map(function(s) { return [s.leftPx, s.widthPx]; }),
    data.scale.segments.map(function(seg) { return [seg.leftPx, seg.widthPx]; }),
    'геометрия бейджа = колонка дня на свёрнутой оси');

// День без заданий станка бейджа не получает: у второго станка резка только 30.06.
var twoSlitters = [
    Object.assign(cut('S1a', '2026-06-29 08:00', 0, 0, 60), { slitter: { id: 1, label: 'Станок 1' } }),
    Object.assign(cut('S1b', '2026-06-30 08:00', 0, 0, 90), { slitter: { id: 1, label: 'Станок 1' } }),
    Object.assign(cut('S2a', '2026-06-30 08:00', 0, 0, 40), { slitter: { id: 2, label: 'Станок 2' } })
];
var d2 = g.layoutGroups(twoSlitters, g.ganttRange('2026-06-29', 'three'), Date.parse('2026-06-29T07:00:00+03:00'), {}, { pxPerMin: PPM });
var s2 = g.machineDayStats(d2.groups[1].tasks, d2.scale);
assertEqual(s2.length, 1, 'станок без заданий в дне — бейджа за этот день нет');
assertEqual([s2[0].count, s2[0].min], [1, 40], 'бейдж стоит за 30.06 с минутами своего станка');
assertEqual(s2[0].leftPx, d2.scale.segments[1].leftPx, 'бейдж 30.06 — над колонкой второго дня');

// Ширина колонки решает, что влезет в подпись: полная, только число, ничего (минуты — в подсказке).
// Оценка ширины — 10px полей + 7.5px на символ: «34 (1298 мин)» (13 симв.) требует 107.5px.
assertEqual(g.machineDayStatText({ count: 34, min: 1298, widthPx: 1260 }), '34 (1298 мин)', 'широкая колонка — полная подпись');
assertEqual(g.machineDayStatText({ count: 34, min: 1298, widthPx: 107.5 }), '34 (1298 мин)', 'ровно по оценке — ещё полная');
assertEqual(g.machineDayStatText({ count: 34, min: 1298, widthPx: 107 }), '34', 'на пиксель уже — усыхает до числа заданий');
assertEqual(g.machineDayStatText({ count: 34, min: 1298, widthPx: 50 }), '34', 'узкая колонка (месяц ≈50px) — только число заданий');
assertEqual(g.machineDayStatText({ count: 34, min: 1298, widthPx: 20 }), '', 'совсем узкая — пусто, минуты в подсказке');
assertEqual(g.machineDayStatText({ count: 128, min: 10298, widthPx: 120 }), '128 (10298 мин)', 'длинная подпись (15 симв.) влезает в 120px');
assertEqual(g.machineDayStatText({ count: 128, min: 10298, widthPx: 110 }), '128', 'та же подпись в 110px — только число');
assertEqual(g.machineDayStatText({ count: 3, min: 0, widthPx: 20 }), '3', 'нет минут — подпись и есть «N» (как в итоге станка)');
assertEqual(g.machineDayStatText({ count: 0, min: 0, widthPx: 500 }), '', 'нет заданий — нет подписи');

// Пустая ось / нет заданий — не падаем.
assertEqual(g.machineDayStats([], data.scale), [], 'нет заданий — нет бейджей');
assertEqual(g.machineDayStats(group.tasks, null), [], 'нет оси — нет бейджей');

console.log('\n' + passed + ' assertions passed');
