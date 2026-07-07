// Характеризационные тесты #4085 (Стадия 0) — РЕГРЕСС-СЕТЬ.
//
// Фиксируют поведение splitMachineQueue. После стадии 6 (#4085) фолбэк-ключ БЕЗ дрейфа: фольга-last и
// EDD `dueDay·DEADLINE` сняты (теперь foil-last и срок — ЛОКАЛЬНЫЕ штрафы в слое размещения #3985); а
// весь ТАЙМИНГ (дробление по дням, обед, нахлёст, отпуск, продолжения firstPartId) — БЕЗ ИЗМЕНЕНИЙ.
// Любая непреднамеренная правка тайминга ловится немедленно (голдены тайминга неизменны с #4085).
//
// Run with: node experiments/atex-production-planning-4085-characterization.test.js

var planning = require('../download/atex/js/production-planning.js').planning;

var passed = 0, total = 0;
function assert(cond, name) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}
function eq(actual, expected, name) {
    assert(JSON.stringify(actual) === JSON.stringify(expected),
        name + (JSON.stringify(actual) === JSON.stringify(expected) ? '' :
            '\n    ожидалось ' + JSON.stringify(expected) + '\n    получено  ' + JSON.stringify(actual)));
}

function cut(id, o) {
    o = o || {};
    return { id: id, slitter: { id: o.m || 'm1' }, materialId: o.mat || 'M1', winding: o.w || 'OUT',
             knifeWidths: o.kw || [50, 50], knifeCount: o.kc || 2, rollerWidth: o.rw || 0,
             plannedRuns: o.runs || 3, isFoil: !!o.foil, firstPartId: o.fp, batchId: o.b };
}
function pack(ordered, opts) {
    var pp = {}, rb = {};
    ordered.forEach(function (c) { pp[c.id] = 30; rb[c.id] = c.plannedRuns || 3; });
    var base = { dayStartMin: 0, dayEndMin: 100,
                 times: { BETWEEN_CUTS: 0, KNIFE: 30, MATERIAL_WINDING: 15, CLEANUP_SHIFT: 30 },
                 leader: 0, perPassByCut: pp, runsByCut: rb, dayAnchorByCut: {},
                 gapFill: true, dueDayByCut: {}, deadlineAware: true };
    Object.keys(opts || {}).forEach(function (k) { base[k] = opts[k]; });
    return planning.splitMachineQueue(ordered, base);
}
// компактная форма сегмента — что именно фиксируем
function dwd(segs) { return segs.map(function (s) { return { id: s.cutId, day: s.dayOffset, win: s.windowStartMin, dur: s.durationMin }; }); }

// ── 1) Дробление по дням: 3 резки по 90 мин, ёмкость дня 100 → каждая на свой день ──────────────
eq(dwd(pack([cut('A'), cut('B'), cut('C')])),
   [{ id: 'A', day: 0, win: 0, dur: 90 }, { id: 'B', day: 1, win: 1440, dur: 90 }, { id: 'C', day: 2, win: 2880, dur: 90 }],
   '#4085 char: дробление по дням (90 мин при ёмкости 100 → дни 0/1/2, win = day×1440)');

// ── 2) Фольга-last СНЯТА (#4085): вход [A,F,B] → фолбэк-порядок = входной (фольга НЕ forced-last) ───
// Жёсткое «фольга в конец» убрано из фолбэк-ключа selectByConfig; foil-last теперь держит слой размещения (штраф).
eq(dwd(pack([cut('A'), cut('F', { foil: true }), cut('B')])),
   [{ id: 'A', day: 0, win: 0, dur: 90 }, { id: 'F', day: 1, win: 1440, dur: 90 }, { id: 'B', day: 2, win: 2880, dur: 90 }],
   '#4085 char: фольга F НЕ уходит в конец (жёсткое правило снято) — фолбэк-порядок входной A,F,B');

// ── 3) EDD СНЯТ (#4085): dueDayByCut больше НЕ переигрывает порядок — идёт входной A,B,C ────────────
eq(dwd(pack([cut('A'), cut('B'), cut('C')], { dueDayByCut: { A: 5, B: 0, C: 5 } })),
   [{ id: 'A', day: 0, win: 0, dur: 90 }, { id: 'B', day: 1, win: 1440, dur: 90 }, { id: 'C', day: 2, win: 2880, dur: 90 }],
   '#4085 char: EDD (dueDay×вес) снят — dueDayByCut не тянет ранний срок вперёд; фолбэк-порядок входной A,B,C');

// ── 4) Обед: два перерыва-прозрачны; резка после обеда стартует позже на длительность обеда ───────
eq(dwd(pack([cut('A', { runs: 2 }), cut('B', { runs: 2 })], { dayEndMin: 200, lunchStartMin: 40, lunchDurationMin: 40 })),
   [{ id: 'A', day: 0, win: 0, dur: 60 }, { id: 'B', day: 0, win: 100, dur: 60 }],
   '#4085 char: обед — B стартует в win100 (сдвиг на 40 мин обеда после A win0/dur60)');

// ── 5) Нахлёст за конец смены (dayEndHourMin + maxOverworkCutsMin): не влезающее уходит на след.день
eq(dwd(pack([cut('A'), cut('B')], { dayEndMin: 100, dayEndHourMin: 95, maxOverworkCutsMin: 5, maxOverworkTuneMin: 10 })),
   [{ id: 'A', day: 0, win: 0, dur: 90 }, { id: 'B', day: 1, win: 1440, dur: 90 }],
   '#4085 char: нахлёст — B (90 мин) не влезает в нахлёст 5 мин → на день 1');

// ── 6) Отпуск (blockedRanges [[startMin,endMin]]): резка сдвигается за окно простоя ──────────────
(function () {
    var segs = pack([cut('A', { runs: 6 })], { dayEndMin: 400, blockedRanges: [[20, 50]] });
    assert(segs[0].startMin === 50,
        '#4085 char: отпуск — startMin резки сдвинут за окно простоя [20;50] на 50 (было ' + segs[0].startMin + ')');
})();

// ── 7) Продолжение (firstPartId): цепочка H→T раскраивается по дням, чужое не вставляется между ──
(function () {
    var segs = pack([cut('H', { runs: 5 }), cut('T', { runs: 5, fp: 'H' })]);
    eq(dwd(segs),
       [{ id: 'H', day: 0, win: 0, dur: 90 }, { id: 'H', day: 1, win: 1440, dur: 60 },
        { id: 'T', day: 1, win: 1500, dur: 30 }, { id: 'T', day: 2, win: 2880, dur: 90 }, { id: 'T', day: 3, win: 4320, dur: 30 }],
       '#4085 char: продолжение — раскладка цепочки H/T по дням (текущая)');
    // Day-split-продолжение: первый сегмент резки cont=false/parent=null, последующие дни — cont=true/parent=<своя резка>.
    // (Слияние по firstPartId делает mergeContinuationChains ДО splitMachineQueue; здесь H и T — независимые резки.)
    eq(segs.map(function (s) { return { id: s.cutId, cont: s.isContinuation, parent: s.parentCutId }; }),
       [{ id: 'H', cont: false, parent: null }, { id: 'H', cont: true, parent: 'H' },
        { id: 'T', cont: false, parent: null }, { id: 'T', cont: true, parent: 'T' }, { id: 'T', cont: true, parent: 'T' }],
       '#4085 char: продолжение — day-split несёт isContinuation/parentCutId по своей резке');
})();

console.log('\n' + passed + '/' + total + ' passed');
