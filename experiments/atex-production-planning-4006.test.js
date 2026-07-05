// Unit tests for #4006 — три части:
//  1) Формат тайминга резки: одна строка «Намотка и лидер» (намотка + лидер BETWEEN_CUTS)
//     и «Итого резка», включающее лидер; отдельной строки «лидер между резками» больше нет.
//  2) Захлёст (overhang) за конец смены: при MAX_OVERWORK_CUTS_MN упаковщик добирает лишний
//     проход в тот же день (демонстрация, почему день без захлёста останавливается на проход раньше).
//  3) Лимит ширины джамбо станка из поля «Код» (напр. «j<1000»): сырьё с номинальной шириной
//     ≥ 1000 (MWR500L=1000) не ставится на станок 1/4, только на 2/3.
//
// Run with: node experiments/atex-production-planning-4006.test.js

process.env.TZ = 'UTC';

var api = require('../download/atex/js/production-planning.js');
var P = api.planning;

var passed = 0, failed = 0;
function assert(cond, name) {
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else { failed++; process.exitCode = 1; }
}
function eqNum(a, b) { return Math.abs(Number(a) - Number(b)) < 1e-6; }

// ─────────────────────────────────────────────────────────────────────────────
// Часть 3 — лимит ширины джамбо станка («Код» j<1000)
// ─────────────────────────────────────────────────────────────────────────────
var codeLt1000 = P.parseActualWidthCode('j<1000');
var codeEmpty = P.parseActualWidthCode('');
var codeBad = P.parseActualWidthCode('чепуха');

assert(P.isSlitterWidthBlocked(codeLt1000, 1000) === true,
    'j<1000: номинал 1000 → станок заблокирован (MWR500L нельзя)');
assert(P.isSlitterWidthBlocked(codeLt1000, 990) === false,
    'j<1000: фактические 990 не важны — сверяем номинал; номинал 999 не блокируем');
assert(P.isSlitterWidthBlocked(codeLt1000, 800) === false,
    'j<1000: номинал 800 < 1000 → станок допустим');
assert(P.isSlitterWidthBlocked(codeLt1000, 1200) === true,
    'j<1000: номинал 1200 → заблокирован');
assert(P.isSlitterWidthBlocked(codeEmpty, 1000) === false,
    'пустой «Код» → без ограничения (любая ширина)');
assert(P.isSlitterWidthBlocked(codeBad, 1000) === false,
    'нераспознанный «Код» → без ограничения (не теряем резку)');
assert(P.isSlitterWidthBlocked(codeLt1000, null) === false,
    'нет номинала → не блокируем (пробел в справочнике не теряет резку)');

// Станки как на ateh: 1 и 4 несут «j<1000», 2 и 3 — без кода.
function slitter(id, code) { return { id: id, stopMaterialIds: [], widthCode: P.parseActualWidthCode(code) }; }
var slitters4 = [slitter('1', 'j<1000'), slitter('2', ''), slitter('3', ''), slitter('4', 'j<1000')];
var nomWidths = { 'MWR500L': 1000, 'MWR400L': 900 };

function cut(mat) { return { id: 'c-' + mat, materialId: mat, winding: 'OUT', knifeWidths: [300], plannedRuns: 10, duration: 40 }; }

var chosenWide = P.chooseSlitterBySetup(cut('MWR500L'), slitters4, {}, {}, {}, 0, {}, nomWidths);
assert(chosenWide === '2' || chosenWide === '3',
    'chooseSlitterBySetup: MWR500L (номинал 1000) идёт на станок 2/3, НЕ на 1/4 (получили ' + chosenWide + ')');

var chosenNarrow = P.chooseSlitterBySetup(cut('MWR400L'), slitters4, {}, {}, {}, 0, {}, nomWidths);
assert(chosenNarrow === '1' || chosenNarrow === '2' || chosenNarrow === '3' || chosenNarrow === '4',
    'chooseSlitterBySetup: MWR400L (номинал 900) допустим на любом станке (получили ' + chosenNarrow + ')');

// Все станки с лимитом → резку не теряем «молча»: возвращаем null (как для стоп-листа).
var onlyRestricted = [slitter('1', 'j<1000'), slitter('4', 'j<1000')];
assert(P.chooseSlitterBySetup(cut('MWR500L'), onlyRestricted, {}, {}, {}, 0, {}, nomWidths) === null,
    'chooseSlitterBySetup: широкое сырьё, все станки с лимитом → null (некуда ставить)');

// pickSlitter (тест-экспорт): та же фильтрация по номиналу.
assert(['2', '3'].indexOf(P.pickSlitter(slitters4, 'MWR500L', {}, 1000)) >= 0,
    'pickSlitter: MWR500L (1000) → станок 2/3');
assert(P.pickSlitter(slitters4, 'MWR400L', {}, 900) === '1',
    'pickSlitter: MWR400L (900) → наименьший id среди допустимых (станок 1)');

// ─────────────────────────────────────────────────────────────────────────────
// Часть 1 — формат тайминга «Намотка и лидер» + «Итого резка» с лидером
// ─────────────────────────────────────────────────────────────────────────────
var opTimes = { WIND_450: 1.8, BETWEEN_CUTS: 2.0 };
var details = P.cutTimingDetails(450, 118, opTimes, false);
assert(/Норма намотки: WIND_450=1\.8 мин/.test(details),
    'cutTimingDetails: строка нормы намотки WIND_450=1.8');
assert(/Намотка и лидер: 3\.8 мин/.test(details),
    'cutTimingDetails: «Намотка и лидер: 3.8 мин» (1.8 намотка + 2.0 лидер)');
assert(/Итого резка: 3\.8 \* 118 = 448\.4 мин/.test(details),
    'cutTimingDetails: «Итого резка: 3.8 * 118 = 448.4 мин» (лидер включён)');
assert(!/Намотка 1 прохода/.test(details),
    'cutTimingDetails: старой строки «Намотка 1 прохода» больше нет');

// Модалка тайминга окна (cutTimingTimelineLines) — та же семантика.
var ctx = {
    length: 450, runs: 118,
    oneRun: 1.8, total: 212.4,           // намотка одного прохода / всего намотки
    leaderMin: 236, leaderInWindow: false, // лидер = 2.0 × 118 = 236 (после намотки, live)
    norms: [{ m: 450, min: 1.8 }],
    setupParts: [],
    startMin: 8 * 60,                      // 08:00
    finishMin: 8 * 60 + 212.4             // конец намотки; лидер идёт после
};
var lines = P.cutTimingTimelineLines(ctx).map(function(l) { return l.text; });
var joined = lines.join('\n');
assert(lines.indexOf('Норма намотки: WIND_450=1.8 мин') >= 0,
    'timeline: норма намотки отдельной строкой');
assert(lines.indexOf('Намотка и лидер: 3.8 мин') >= 0,
    'timeline: «Намотка и лидер: 3.8 мин»');
assert(/Итого резка: 3\.8 \* 118 = 448\.4 мин/.test(joined),
    'timeline: «Итого резка: 3.8 * 118 = 448.4 мин» (лидер включён в итог)');
assert(!/лидер между резками/.test(joined),
    'timeline: отдельной строки «лидер между резками» больше нет');
assert(!/Намотка 1 прохода/.test(joined),
    'timeline: старой строки «Намотка 1 прохода» больше нет');
assert(lines.filter(function(t) { return /· готово$/.test(t); }).length === 1,
    'timeline: ровно одна строка «готово»');

// ─────────────────────────────────────────────────────────────────────────────
// Часть 2 — захлёст за конец смены упаковывает лишний проход в тот же день
// ateh: окно 08:00–16:10 (cutEnd), обед 40, DAY_END_HOUR 16:30; перегон 5/10.
// Проход 450 м: намотка 1.8 + лидер 2.0 = 3.8 мин. Ёмкость дня ≈ 490−40 = 450 мин,
// потолок захлёста для резки = 450 + 5 = 455 → floor(455/3.8) = 119 проходов.
// ─────────────────────────────────────────────────────────────────────────────
var baseOpts = {
    dayStartMin: 8 * 60, dayEndMin: 16 * 60 + 10, dayEndHourMin: 16 * 60 + 30,
    leader: 2.0, times: { BETWEEN_CUTS: 2.0 },
    lunchStartMin: 12 * 60 + 20, lunchDurationMin: 40
};
function packOneCut(runs, extra) {
    var opts = Object.assign({}, baseOpts, { perPassByCut: { '1': 1.8 }, runsByCut: { '1': runs } }, extra || {});
    var c = { id: '1', slitter: { id: '7' }, materialId: 'M1', winding: 'OUT', knifeWidths: [300], plannedRuns: runs };
    return P.splitMachineQueue([c], opts);
}

// Захлёст ВКЛ (+5): спрос 119 проходов помещается в ОДИН день (452.2 мин).
var on119 = packOneCut(119, { maxOverworkCutsMin: 5, maxOverworkTuneMin: 10 });
assert(on119.length === 1 && on119[0].runs === 119,
    'overhang ON (+5): 119 проходов в один день (' + on119.map(function(s){ return s.runs; }).join('+') + ')');
assert(eqNum(on119[0].durationMin, 452.2),
    'overhang ON: длительность дня 452.2 мин (119 × 3.8)');

// Захлёст ВЫКЛ: тот же спрос 119 → 118 сегодня + 1 назавтра (день останавливается на проход раньше).
var off119 = packOneCut(119, {});
assert(off119.length === 2 && off119[0].runs === 118 && off119[1].runs === 1,
    'overhang OFF: 118 + 1 (лишний проход уезжает на след. день) — так выглядел план ДО настройки MAX_OVERWORK_CUTS_MN');

// Захлёст ВКЛ, спрос ровно 118 → день ограничен СПРОСОМ (не ёмкостью): 118, добавить нечего.
var on118 = packOneCut(118, { maxOverworkCutsMin: 5, maxOverworkTuneMin: 10 });
assert(on118.length === 1 && on118[0].runs === 118,
    'overhang ON, спрос 118: день = 118 (ограничен спросом; 119-го прохода не существует)');

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n' + passed + ' passed, ' + failed + ' failed');
