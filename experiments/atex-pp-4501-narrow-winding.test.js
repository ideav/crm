// Tests for ideav/crm#4501 — узкие полосы (≤ 30 мм) наматываются по СВОЕЙ норме.
//
// ПРАВИЛО (ТЗ §6/§15): время намотки задания считается по норме, соответствующей его САМОЙ УЗКОЙ
// полосе. Есть хоть одна полоса ≤ 30 мм — действует серия «Время операции, мин» `WIND_W30_<метры>`
// (300→2.4, 450→3.6, 600→8), а не базовая `WIND_<метры>` (1.2/1.8/4). Физика: на вал насаживается
// множество узких втулок, и это время не пропорционально метражу — поэтому норма ЗАДАЁТСЯ СТРОКАМИ
// справочника (можно сделать не «×2», а аддитивной), а не множителем в коде.
//
// ШЛЮЗ. Норма выбирается в ОДНОМ месте — `windPointsForCut` (10-planning-engine.js). Тест гоняет
// таблицу «входы × норма»: все публичные расчёты длительности обязаны дать для одной и той же
// резки одно и то же — иначе правило снова разъедется по обработчикам (как было с #3606).
//
// Run with: node experiments/atex-pp-4501-narrow-winding.test.js

process.env.TZ = 'UTC';
var api = require('../download/atex/js/production-planning.js');
var planning = api.planning;

var passed = 0, failed = 0;
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; }
    else { failed++; console.log('  expected:', JSON.stringify(expected)); console.log('  actual:  ', JSON.stringify(actual)); process.exitCode = 1; }
}
function assertTrue(cond, name) { assertEqual(!!cond, true, name); }
function round3(n) { return Math.round((Number(n) || 0) * 1000) / 1000; }

// Нормы ateh + три новые строки узкой серии (#4501).
var TIMES = {
    WIND_300: 1.2, WIND_450: 1.8, WIND_600: 4, WIND_900: 5, WIND_1000: 5.3, WIND_1100: 5.6,
    WIND_FOIL_305: 4, WIND_05_110: 4,
    WIND_W30_300: 2.4, WIND_W30_450: 3.6, WIND_W30_600: 8,
    BETWEEN_CUTS: 2, MATERIAL_WINDING: 15, KNIFE: 30, CLEANUP_SHIFT: 30
};
var BASE_ONLY = { WIND_300: 1.2, WIND_450: 1.8, WIND_600: 4, WIND_900: 5, BETWEEN_CUTS: 2 };

function cut(o) {
    return { id: o.id || '1', isFoil: !!o.foil, knifeWidths: o.kw, knifeCount: (o.kw || []).length,
        plannedRuns: o.runs == null ? 3 : o.runs, materialId: 'm1', winding: 'OUT',
        slitter: { id: '1' }, duration: 0 };
}
var narrowCut = cut({ id: 'n', kw: [110, 110, 30] });        // 30 мм ровно — порог включительный
var wideCut   = cut({ id: 'w', kw: [110, 59, 32.5] });       // самая узкая 32.5 → базовая норма
var foilCut   = cut({ id: 'f', kw: [110, 30], foil: true }); // узкая фольга без своей строки

// ─────────────────────────── 1. Разбор справочника ───────────────────────────
var pts = planning.windingPointsFromTimes(TIMES);
assertEqual(pts.map(function(p) { return p.m; }), [300, 450, 600, 900, 1000, 1100],
    'windingPointsFromTimes: базовая серия не изменилась (узкие строки в неё не попали)');
assertEqual((pts.narrow || []).map(function(t) { return [t.maxWidth, !!t.foil, t.points.length]; }),
    [[30, false, 3]], 'windingPointsFromTimes: серия W30 разобрана отдельным ярусом');
assertEqual(planning.windingPointsFromTimes(BASE_ONLY).narrow, [],
    'нет строк W<N>_<метры> → ярусов нет (поведение как до #4501)');

// ─────────────────────── 2. Выбор нормы: шлюз windPointsForCut ───────────────
var narrowPts = planning.windPointsForCut(narrowCut, pts);
assertEqual(narrowPts.map(function(p) { return [p.m, p.min]; }), [[300, 2.4], [450, 3.6], [600, 8]],
    'windPointsForCut: резка с полосой 30 мм → узкая серия');
assertEqual(planning.windPointsForCut(wideCut, pts), pts,
    'windPointsForCut: самая узкая полоса 32.5 мм → базовая серия');
assertEqual(planning.windPointsForCut(cut({ kw: [110, 30.5] }), pts), pts,
    'порог включительный: 30.5 мм — уже не узкая');
assertEqual(planning.windPointsForCut(cut({ kw: [25, 110] }), pts).length, 3,
    'полоса 25 мм — тоже узкая (порог «не шире 30»)');
assertEqual(planning.windPointsForCut(narrowCut, planning.windingPointsFromTimes(BASE_ONLY)),
    planning.windingPointsFromTimes(BASE_ONLY),
    'нет узких строк в справочнике → узкая резка считается по базовой (обратная совместимость)');
assertEqual(planning.windPointsForCut(false, pts), pts, 'старый булев isFoil=false → базовая серия');
assertEqual(planning.windPointsForCut(true, pts), pts.foil, 'старый булев isFoil=true → фольговая серия');
assertEqual(planning.windPointsForCut(cut({ kw: [] }), pts), pts, 'полос не знаем → базовая серия');

// ─────────────────────────── 3. Минуты намотки ───────────────────────────────
assertEqual(planning.windingMinutes(600, narrowPts), 8, 'узкая: 600 м → 8 мин (было 4)');
assertEqual(planning.windingMinutes(450, narrowPts), 3.6, 'узкая: 450 м → 3.6 мин (было 1.8)');
assertEqual(planning.windingMinutes(300, narrowPts), 2.4, 'узкая: 300 м → 2.4 мин (было 1.2)');
assertEqual(planning.windingMinutes(150, narrowPts), 1.2, 'узкая: 150 м → пропорция от нуля (1.2)');
assertEqual(planning.windingMinutes(525, narrowPts), 5.8, 'узкая: 525 м → интерполяция 3.6…8');
assertEqual(planning.windingMinutes(900, narrowPts), 8,
    'узкая: 900 м → клампим на последней точке серии (не экстраполируем и не падаем на базовую 5)');
assertEqual(planning.windingMinutes(600, pts), 4, 'базовая серия не тронута: 600 м → 4');

// ─────────────────── 4. Фольга: своя норма сильнее узкой ─────────────────────
assertEqual(planning.windingMinutes(305, planning.windPointsForCut(foilCut, pts)), 4,
    'узкая фольга без строки WIND_FOIL_W30_*: остаётся блочная фольговая норма (4 мин за 305 м)');
var foilNarrowPts = planning.windingPointsFromTimes(
    Object.assign({}, TIMES, { WIND_FOIL_W30_305: 8 }));
assertEqual(planning.windingMinutes(305, planning.windPointsForCut(foilCut, foilNarrowPts)), 8,
    'заведена строка WIND_FOIL_W30_305=8 → узкая фольга едет по ней');
assertEqual(planning.windingMinutes(305, planning.windPointsForCut(cut({ kw: [110, 59], foil: true }), foilNarrowPts)), 4,
    'широкая фольга при заведённой узко-фольговой серии считается по обычной фольговой');

// ─────────────── 5. Таблица «входы × норма»: все расчёты согласны ────────────
// Одна и та же резка (600 м, 3 прохода) — что бы её ни считало, намотка 8 мин/проход.
var RUN = 600, RUNS = 3;
var entries = {
    plannedCutDurationMinutes: planning.plannedCutDurationMinutes(RUN, RUNS, TIMES, narrowCut),
    scheduleDurationMinutes: planning.scheduleDurationMinutes(narrowCut, RUN, pts),
    windPointsForCut: round3(planning.windingMinutes(RUN, planning.windPointsForCut(narrowCut, pts)) * RUNS),
    buildCutTimingCtx: round3(
        planning.buildCutTimingCtx(narrowCut, null, null, RUN, pts, TIMES).oneRun * RUNS)
};
assertEqual(entries, { plannedCutDurationMinutes: 24, scheduleDurationMinutes: 24,
    windPointsForCut: 24, buildCutTimingCtx: 24 },
    'входы × норма: все расчёты дают 8 мин/проход × 3 = 24 мин');
assertEqual(planning.plannedCutDurationMinutes(RUN, RUNS, TIMES, wideCut), 12,
    'та же резка без узких полос — 4 × 3 = 12 мин');
// Расписание очереди/Ганта (buildSchedule → scheduleDurationMinutes) — тот же шлюз.
var schedOpts = { windPoints: pts, times: TIMES, shiftStartMin: 480,
    runLengthByCut: { n: RUN, w: RUN } };
assertEqual(planning.buildSchedule([narrowCut], schedOpts)[0].durationMin, 24,
    'buildSchedule: окно узкой резки — 24 мин намотки');
assertEqual(planning.buildSchedule([wideCut], schedOpts)[0].durationMin, 12,
    'buildSchedule: окно обычной резки не изменилось — 12 мин');
assertEqual(planning.plannedCutDurationMinutes(RUN, RUNS, TIMES, false), 12,
    'старый вызов с булевым isFoil продолжает работать');

// ─────────────────────── 6. Подпись нормы для оператора ──────────────────────
var timing = planning.cutTimingDetails(RUN, RUNS, TIMES, narrowCut);
assertTrue(/WIND_W30_600=8 мин/.test(timing), 'cutTimingDetails: в тайминге видно, что норма узкая');
assertTrue(/Намотка: 8 \* 3 = 24 мин/.test(timing), 'cutTimingDetails: намотка по узкой норме');
assertTrue(/WIND_600=4 мин/.test(planning.cutTimingDetails(RUN, RUNS, TIMES, wideCut)),
    'cutTimingDetails: широкая резка — прежняя подпись нормы');
assertEqual(planning.formatWindingNorms(planning.relevantWindingNorms(600, narrowPts)),
    'Норма намотки: WIND_W30_600=8 мин', 'formatWindingNorms: код яруса в подписи');

// ─────────── 7. «Код» вместо «Кода операции» — нормализация при загрузке ─────
// Строка справочника может нести условие в новой колонке «Код» (как в «Фактической ширине
// резки»): `w<=30`. Загрузчик приводит её к каноническому WIND_W30_<метры>.
assertEqual(planning.normalizeOperationTimes([
        { code: 'WIND_300', minutes: 1.2, widthCode: '' },
        { code: 'WIND_600', minutes: 4, widthCode: '' },
        { code: 'WIND_NARROW_300', minutes: 2.4, widthCode: 'w<=30' },
        { code: 'WIND_NARROW_600', minutes: 8, widthCode: 'w<= 30' },
        { code: 'WIND_W30_450', minutes: 3.6, widthCode: '' },
        { code: 'WIND_FOIL_305', minutes: 4, widthCode: '' },
        { code: 'WIND_FOIL_NARROW_305', minutes: 8, widthCode: 'w<=30' },
        { code: 'BETWEEN_CUTS', minutes: 2, widthCode: '' },
        { code: '', minutes: 0, widthCode: '' }
    ]),
    { WIND_300: 1.2, WIND_600: 4, WIND_W30_300: 2.4, WIND_W30_600: 8, WIND_W30_450: 3.6,
      WIND_FOIL_305: 4, WIND_FOIL_W30_305: 8, BETWEEN_CUTS: 2 },
    'normalizeOperationTimes: «Код» w<=30 → канонический ключ WIND_W30_<метры>');
assertEqual(planning.normalizeOperationTimes([{ code: 'WIND_300', minutes: 1.2, widthCode: 'j<=910' }]),
    { WIND_300: 1.2 }, 'условие не про ширину полосы («j») норму намотки не переносит');

// ─────────── 8. Загрузчик читает колонку «Код» таблицы 13588 ─────────────────
var ctrl = Object.create(api.Controller.prototype);
ctrl._metaAll = [{ id: '13588', val: 'Время операции, мин',
    reqs: [{ id: '13619', val: 'Тип операции' }, { id: '13620', val: 'Код операции' }, { id: '651496', val: 'Код' }] }];
ctrl.getJson = function() {
    return Promise.resolve([
        { i: 1, r: ['1.20', 'Намотка 300 метров резки', 'WIND_300', ''] },
        { i: 2, r: ['4.00', 'Намотка 600 метров резки', 'WIND_600', ''] },
        { i: 3, r: ['8.00', 'Узкая намотка 600 м', 'WIND_NARROW_600', 'w<=30'] },
        { i: 4, r: ['2.00', 'Лидер', 'BETWEEN_CUTS', ''] }
    ]);
};
ctrl.loadOperationTimes().then(function() {
    assertEqual(ctrl.opTimes, { WIND_300: 1.2, WIND_600: 4, WIND_W30_600: 8, BETWEEN_CUTS: 2 },
        'loadOperationTimes: колонка «Код» доезжает до opTimes каноническим ключом');
    console.log('\n' + passed + ' passed, ' + failed + ' failed');
    if (failed) process.exitCode = 1;
});
