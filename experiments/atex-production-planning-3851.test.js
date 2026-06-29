// Unit tests for #3851 — генерация падала «Неполный payload задания N: Не записано поле
// «Длительность, минут» (t26584); Не записано поле «Тайминг» (t26990)».
//
// Корень: дробление резок по дням (splitMachineQueue, #3635 п.5) создаёт сегмент НАСТРОЙКИ
// — отдельную запись с «Кол-во резок план»=0, которая кладёт переналадку в хвост дня N, а
// проходы начинаются с дня N+1. У такого сегмента намотки НЕТ, поэтому «Длительность,
// минут»=0 и «Тайминг»='' ПО ЗАМЫСЛУ; buildFields пустые значения не пишет. Но runGenerateCuts
// требовал ['plannedRuns','duration','timing','length'] у КАЖДОЙ записи → traceCutCreatePayload
// помечал duration/timing отсутствующими и генерация бросала исключение на хвостовом сегменте
// настройки (в боевом логе — «задание 87»).
//
// Фикс: cutCreateRequiredKeys — для обычной резки (есть проходы) требуем намотку/тайминг
// (страховка от несконфигурированных норм), для сегмента настройки (0 проходов) — нет.
// buildSchedule всё равно форсит его намотку в 0 по «Кол-во резок план»=0, так что пустые
// «Длительность, минут»/«Тайминг» безвредны.
//
// Run with: node experiments/atex-production-planning-3851.test.js

process.env.TZ = 'UTC';
var planning = require('../download/atex/js/production-planning.js').planning;

var passed = 0;
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; }
    else { console.log('  expected:', JSON.stringify(expected)); console.log('  actual:  ', JSON.stringify(actual)); process.exitCode = 1; }
}

// ── 1) splitMachineQueue (путь генерации, БЕЗ gapFill) реально рождает сегмент настройки ──
// Окно 0..100, лидер 0. A (намотка 80 мин/проход, 1 проход) заполняет день 0 до 80 (остаток
// 20). B — другое сырьё (те же ножи → переналадка = смена сырья 15), намотка 96 мин/проход.
// В хвост дня 0 влезает только настройка (15 ≤ 20), но не настройка+проход (15+96 > 20) →
// отдельный сегмент НАСТРОЙКИ B (0 проходов), проходы B — с дня 1.
function cut(id, material, kw, runs) {
    return { id: id, slitter: { id: 'm1' }, materialId: material, winding: 'OUT',
        knifeWidths: kw, knifeCount: kw.length, rollerWidth: 0, plannedRuns: runs };
}
var A = cut('A', 'MA', [10, 10], 1);
var B = cut('B', 'MB', [10, 10], 3);
var segs = planning.splitMachineQueue([A, B], {
    dayStartMin: 0, dayEndMin: 100, times: { BETWEEN_CUTS: 0 },
    perPassByCut: { A: 80, B: 96 }, runsByCut: { A: 1, B: 3 }
});
var bSegs = segs.filter(function(s) { return s.cutId === 'B'; });
var bSetup = bSegs.filter(function(s) { return s.runs === 0; });
assertEqual(bSetup.length, 1, '#3851: B даёт ровно один сегмент настройки (0 проходов)');
assertEqual({ runs: bSetup[0].runs, setupOnly: !!bSetup[0].setupOnly, dur: bSetup[0].durationMin },
    { runs: 0, setupOnly: true, dur: 0 }, '#3851: сегмент настройки — runs 0, setupOnly, намотка 0');
assertEqual(bSegs.some(function(s) { return s.runs > 0; }), true, '#3851: проходы B всё же создаются (на след. днях)');

// ── 2) cutCreateRequiredKeys: набор обязательных полей зависит от наличия проходов ──
assertEqual(planning.cutCreateRequiredKeys(3), ['plannedRuns', 'duration', 'timing', 'length'],
    '#3851: обычная резка (есть проходы) обязана нести намотку/тайминг');
assertEqual(planning.cutCreateRequiredKeys(0), ['plannedRuns', 'length'],
    '#3851: сегмент настройки (0 проходов) намотку/тайминг не требует');
assertEqual(planning.cutCreateRequiredKeys('0'), ['plannedRuns', 'length'],
    '#3851: «0» строкой — тоже сегмент настройки');

// ── 3) Интеграция: payload сегмента настройки, собранный как в runGenerateCuts ──
// reqIds боевой ateh: duration=26584, timing=26990 (из лога #3851). buildFields пустые
// значения опускает, поэтому в payload их нет.
var LABELS = { plannedRuns: 'Кол-во резок план', duration: 'Длительность, минут',
    timing: 'Тайминг', length: 'Метраж, м' };
var reqIds = { plannedRuns: 8000, duration: 26584, timing: 26990, length: 8001 };
function buildPayload(plannedRuns, runLength, duration, timing) {
    return planning.buildFields(reqIds, {
        plannedRuns: plannedRuns,
        duration: duration > 0 ? Math.ceil(duration) : '',   // как в runGenerateCuts
        timing: timing,
        length: runLength > 0 ? runLength : ''
    });
}
// Сегмент настройки: 0 проходов, метраж прогона есть (450), намотки/тайминга нет.
var setupPayload = buildPayload(0, 450, 0, '');
assertEqual(Object.prototype.hasOwnProperty.call(setupPayload, 't26584'), false,
    '#3851: payload настройки без «Длительность, минут» (buildFields опускает пустое)');
assertEqual(Object.prototype.hasOwnProperty.call(setupPayload, 't26990'), false,
    '#3851: payload настройки без «Тайминг»');
assertEqual(Object.prototype.hasOwnProperty.call(setupPayload, 't8000'), true,
    '#3851: «Кол-во резок план»=0 в payload остаётся (для распознавания сегмента настройки)');

// ДО фикса: жёсткий список требовал duration+timing → 2 диагностики (воспроизводит падение).
var oldDiag = planning.cutWriteDiagnostics(reqIds, setupPayload,
    ['plannedRuns', 'duration', 'timing', 'length'], LABELS);
assertEqual(oldDiag.map(function(d) { return d.field; }), ['t26584', 't26990'],
    '#3851: со старым набором — две ложные диагностики (duration+timing) = падение генерации');

// ПОСЛЕ фикса: для 0 проходов эти поля не обязательны → диагностик нет, генерация проходит.
var newDiag = planning.cutWriteDiagnostics(reqIds, setupPayload,
    planning.cutCreateRequiredKeys(0), LABELS);
assertEqual(newDiag, [], '#3851: с cutCreateRequiredKeys(0) — диагностик нет, сегмент настройки создаётся');

// ── 4) Страховка сохранена: обычная резка с пустым таймингом (нормы намотки не настроены) ──
// по-прежнему ловится (иначе вся очередь была бы «0 мин»).
var brokenNormal = buildPayload(3, 450, 0, '');   // проходы есть, но намотка/тайминг пусты
var normalDiag = planning.cutWriteDiagnostics(reqIds, brokenNormal,
    planning.cutCreateRequiredKeys(3), LABELS);
assertEqual(normalDiag.map(function(d) { return d.field; }), ['t26584', 't26990'],
    '#3851: обычная резка без намотки/тайминга — диагностика срабатывает (страховка цела)');

// Полная обычная резка — без диагностик.
var goodNormal = buildPayload(3, 450, 12, 'Метраж прохода: 450 м\nИтого резка: 4 * 3 = 12 мин');
var goodDiag = planning.cutWriteDiagnostics(reqIds, goodNormal,
    planning.cutCreateRequiredKeys(3), LABELS);
assertEqual(goodDiag, [], '#3851: корректная обычная резка — диагностик нет');

console.log('\n' + passed + ' passed');
