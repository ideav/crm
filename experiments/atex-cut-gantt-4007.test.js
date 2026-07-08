// Unit tests for #4007 (ТЗ §5) — короткие перерывы на диаграмме Ганта.
//
// Перерывы (FIRST_INTERVAL 10:00 / SECCOND_INTERVAL 15:00, по INTERVAL_DURATION_MN 10 мин) при
// планировании НЕ участвуют — их нет в сохранённых стартах. Гант рисует их накладкой на несущем
// задании (чьё СОХРАНЁННОЕ окно накрывает время перерыва) по РЕАЛЬНОМУ времени. #4099 «рисуй как
// есть»: бары за перерыв БОЛЬШЕ НЕ сдвигаются и несущий бар НЕ раздвигается (shiftMinByIndex = 0,
// маркер — на своём реальном времени). Проверяем ganttBreakMarkers (маркеры без сдвига) и
// интеграцию в layoutGroups (leftPx баров не меняются, маркеры перерывов в выдаче).
//
// Run with: node experiments/atex-cut-gantt-4007.test.js

process.env.TZ = 'Europe/Moscow';
var g = require('../download/atex/js/cut-gantt.js').gantt;

var passed = 0, total = 0;
function assertEqual(actual, expected, name) {
    total++;
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; }
    else { console.log('  expected:', JSON.stringify(expected)); console.log('  actual:  ', JSON.stringify(actual)); process.exitCode = 1; }
}
function assert(cond, name) { assertEqual(!!cond, true, name); }

var PPM = 2;   // px на минуту
// Резка в форме отчёта Ганта: planDate (план старт), cutTimeMin (минуты резки), наладка 0.
function cut(id, planIso, cutTimeMin, slitterId) {
    return { id: id, planDate: planIso, cutTimeMin: cutTimeMin,
             slitter: { id: slitterId || '1', label: 'Станок ' + (slitterId || '1') } };
}
function scaleFor(cuts, opts) {
    var range = g.ganttRange('2026-06-29', 'day');
    return g.ganttScale(g.workingSegments(cuts, range, opts || {}), PPM);
}
var BREAKS = [
    { startMin: 600, durationMin: 10, label: 'Перерыв' },   // 10:00
    { startMin: 900, durationMin: 10, label: 'Перерыв' }    // 15:00
];
var ms = function(iso) { return g.parseDateTimeMs(iso); };

// ── Основной сценарий: 4 резки одного станка, перерывы 10:00 (внутри C1) и 15:00 (внутри C3) ──
// C0 08:00–09:00, C1 09:00–11:00 (накрывает 10:00), C2 11:00–12:00, C3 13:00–16:00 (накрывает 15:00).
var dayCuts = [
    cut('C0', '2026-06-29 08:00', 60),
    cut('C1', '2026-06-29 09:00', 120),
    cut('C2', '2026-06-29 11:00', 60),
    cut('C3', '2026-06-29 13:00', 180)
];
var scale = scaleFor(dayCuts, { breakBufferMin: 20 });
var br = g.ganttBreakMarkers(dayCuts, scale, BREAKS, { pxPerMin: PPM });

assertEqual(br.shiftMinByIndex, [0, 0, 0, 0],
    '#4099: бары за перерыв НЕ сдвигаются (shiftMinByIndex нулевой)');
assertEqual(br.markers.length, 2, '#4007: два маркера перерыва (10:00 и 15:00)');
assertEqual(br.markers[0].carrierIndex, 1, '#4007: несущий перерыва 10:00 — C1 (index 1)');
assertEqual(br.markers[0].beforeIndex, 2, '#4007: строка перерыва 10:00 — после C1 (перед index 2)');
assertEqual([br.markers[0].startMs, br.markers[0].endMs], [ms('2026-06-29 10:00'), ms('2026-06-29 10:10')],
    '#4007: окно перерыва 10:00 = [10:00; 10:10]');
assertEqual(br.markers[0].durationMin, 10, '#4007: длительность перерыва = INTERVAL_DURATION (10)');
assertEqual(br.markers[0].widthPx, 10 * PPM, '#4007: ширина маркера = 10 × px/мин');
// 10:00 = +120 мин от 08:00 → 240px; сдвиг несущего C1 = 0 → маркер на 240.
assertEqual(br.markers[0].leftPx, 240, '#4007: перерыв 10:00 в несмещённом несущем — на 240px');
assertEqual(br.markers[1].carrierIndex, 3, '#4007: несущий перерыва 15:00 — C3 (index 3)');
// #4099: 15:00 = +420 мин → 840px, БЕЗ сдвига (перерыв на реальном времени).
assertEqual(br.markers[1].leftPx, 840, '#4099: перерыв 15:00 на реальном времени (840px, без сдвига)');

// ── Перерывов нет / выключены ──
assertEqual(g.ganttBreakMarkers(dayCuts, scale, [], { pxPerMin: PPM }),
    { markers: [], shiftMinByIndex: [0, 0, 0, 0] }, '#4007: перерывов нет → [] и нулевой сдвиг');
assertEqual(g.ganttBreakMarkers(dayCuts, scale, [{ startMin: 600, durationMin: 0 }], { pxPerMin: PPM }).markers, [],
    '#4007: длительность 0 → перерыв отфильтрован');
assertEqual(g.ganttBreakMarkers(dayCuts, scale, [{ startMin: NaN, durationMin: 10 }], { pxPerMin: PPM }).markers, [],
    '#4007: некорректное время → перерыв отфильтрован');

// ── Перерыв попал в простой (нет несущего) — не рисуется и никого не сдвигает ──
var gapCuts = [cut('A', '2026-06-29 08:00', 60), cut('B', '2026-06-29 13:00', 60)];   // разрыв 09:00–13:00
var gapBr = g.ganttBreakMarkers(gapCuts, scaleFor(gapCuts), [{ startMin: 600, durationMin: 10, label: 'Перерыв' }], { pxPerMin: PPM });
assertEqual(gapBr.markers, [], '#4007: перерыв в простое (нет задания) — не рисуется');
assertEqual(gapBr.shiftMinByIndex, [0, 0], '#4007: перерыв в простое никого не сдвигает');

// ── Граница: перерыв ровно на старте бара → несущий — бар, СТАРТУЮЩИЙ в это время ──
var edgeCuts = [cut('A', '2026-06-29 08:00', 60), cut('B', '2026-06-29 09:00', 120)];   // 09:00 = старт B
var edgeBr = g.ganttBreakMarkers(edgeCuts, scaleFor(edgeCuts), [{ startMin: 540, durationMin: 10, label: 'Перерыв' }], { pxPerMin: PPM });
assertEqual(edgeBr.markers.length, 1, '#4007: граница — один маркер');
assertEqual(edgeBr.markers[0].carrierIndex, 1, '#4007: перерыв на 09:00 — несущий B (стартует в 09:00), не A');

// ── Два дня: перерыв в каждом дне независимо ──
var twoDay = [cut('D1', '2026-06-29 09:00', 120, '1'), cut('D2', '2026-06-30 09:00', 120, '1')];
var twoBr = g.ganttBreakMarkers(twoDay, scaleFor(twoDay), [{ startMin: 600, durationMin: 10, label: 'Перерыв' }], { pxPerMin: PPM });
assertEqual(twoBr.markers.length, 2, '#4007: перерыв нарисован в каждом из двух дней');
assertEqual(twoBr.markers.map(function(m) { return m.carrierIndex; }), [0, 1], '#4007: несущие — резка каждого дня');

// ── Интеграция в layoutGroups: сдвиг leftPx + расширение несущего + строки-маркеры ──
var NOW = ms('2026-06-29 12:00');
var range = g.ganttRange('2026-06-29', 'day');
var base = g.layoutGroups(dayCuts, range, NOW, {}, { pxPerMin: PPM });
var withBr = g.layoutGroups(dayCuts, range, NOW, {}, { pxPerMin: PPM, breaks: BREAKS });
var baseTasks = base.groups[0].tasks, brTasks = withBr.groups[0].tasks;
// #4099: бары НЕ сдвигаются перерывами — leftPx с перерывами и без совпадают.
assertEqual(round3(brTasks[2].leftPx - baseTasks[2].leftPx), 0,
    '#4099 layoutGroups: C2 НЕ сдвинут перерывом (рисуем как есть)');
assertEqual(round3(brTasks[0].leftPx - baseTasks[0].leftPx), 0,
    '#4099 layoutGroups: C0 не сдвинут');
// #4110: несущий бар РАСШИРЯЕТСЯ на длительность своего перерыва (10 мин × PPM), накладка ложится
// на бар. Старт (leftPx) при этом не двигается (проверено выше) — раздвигаем только ширину несущего.
assertEqual(round3(brTasks[1].widthPx - baseTasks[1].widthPx), 10 * PPM,
    '#4110 layoutGroups: несущий C1 расширен на перерыв 10 мин (накладка легла на бар)');
assertEqual(withBr.groups[0].breaks.length, 2, '#4007 layoutGroups: два маркера перерыва в группе');
assert(base.groups[0].breaks == null || base.groups[0].breaks.length === 0,
    '#4007 layoutGroups: без настройки перерывов маркеров нет');

function round3(x) { return Math.round(x * 1000) / 1000; }

console.log('\n' + passed + '/' + total + ' проверок прошло');
if (passed !== total) process.exitCode = 1;
