// Тесты для ideav/crm#4491 — 🔒-монолит не рвётся приезжей зафиксированной резкой.
//
// ПРАВИЛО (ТЗ §15, #4464 → #4491): зафиксированные задания, стоящие в дне ПОДРЯД, монолитны —
// их взаимный порядок автоматика не меняет и между ними ничего не ставит. ИСКЛЮЧЕНИЕ: задание,
// которое оператор переносит вручную «по весу», вправе встроиться с минимальным штрафом — но
// последовательность ОСТАЛЬНЫХ при этом не меняется.
//
// Симптом (#4491): «перенёс задание из следующего дня — все задания поменяли места». В трейсе
// две 🔒 уехали на следующий день (`FIXED_CUT_DAY`), а приехав, встали МЕЖДУ звеньями чужого
// монолита. Причина: упаковщик держал монолит по очереди слоя размещения (§8, `poolOrder`) —
// «после 🔒 сразу следующая 🔒 очереди». Приезжая 🔒 в этой очереди оказывается между звеньями,
// и правило само же её туда и пропускало. Звенья монолита обязаны браться из ХРАНИМОГО плана
// СВОЕГО дня (`storedFixedSeqByDay`), а не из очереди размещения.
//
//   A — приезжая 🔒 не рвёт монолит дня-приёмника: X → Y → C вместо X → C → Y;
//   B — 🔒, уехавшие вместе, сохраняют свой взаимный порядок;
//   C — ИСКЛЮЧЕНИЕ: задание ручного переноса (`wholeDayByCut`) встроиться внутрь монолита вправе;
//   D — без приезжих 🔒 поведение прежнее (монолит дня цел, регресс-контроль #4464).
//
// Run with: node experiments/atex-production-planning-4491.test.js

process.env.TZ = 'UTC';
global.window = { db: 'ateh1', xsrf: 'x' };
var P = require('../download/atex/js/production-planning.js').planning;

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

var TIMES = { KNIFE: 30, MATERIAL_WINDING: 15, BETWEEN_CUTS: 0 };
var BASE = new Date(2026, 6, 29, 0, 0, 0, 0).getTime();
var D0 = Math.floor(BASE / 1000) + 8 * 3600;
function K(pairs) { var a = []; pairs.forEach(function (p) { for (var i = 0; i < p[1]; i++) a.push(p[0]); }); return a; }
function cut(id, mat, knives, runs, fixed, dayOff, off) {
    return { id: id, materialId: mat, winding: 'OUT', batchId: 'B1', knifeWidths: knives,
             knifeCount: knives.length, rollerWidth: knives[0], plannedRuns: runs, isFoil: false,
             fixed: !!fixed, planDate: String(D0 + (dayOff || 0) * 86400 + (off || 0)) };
}
// cuts идут в ПОРЯДКЕ СЛОЯ РАЗМЕЩЕНИЯ (orderAuthoritative) — именно он и ставил приезжую внутрь.
function pack(cuts, anchors, extra) {
    var perPass = {}, runs = {};
    cuts.forEach(function (c) { perPass[String(c.id)] = 20; runs[String(c.id)] = Number(c.plannedRuns) || 0; });
    var o = { dayStartMin: 480, dayEndMin: 930, dayEndHourMin: 930, times: TIMES,
              perPassByCut: perPass, runsByCut: runs, dayAnchorByCut: anchors,
              gapFill: true, orderAuthoritative: true };
    Object.keys(extra || {}).forEach(function (k) { o[k] = extra[k]; });
    return P.splitMachineQueue(cuts, o);
}
function order(segs) {
    return segs.filter(function (s) { return !s.setupOnly; })
        .sort(function (a, b) { return (a.dayOffset - b.dayOffset) || (a.windowStartMin - b.windowStartMin); })
        .map(function (s) { return String(s.cutId); });
}
function adjacent(ord, a, b) { return ord.indexOf(b) === ord.indexOf(a) + 1; }

// ── A: приезжая 🔒 не рвёт монолит дня-приёмника ────────────────────────────────────────────
// День 0 забит свободным F → 🔒 C (её день — 0) уезжает на день 1, где стои́т монолит X,Y.
// Очередь §8 ставит C МЕЖДУ ними (у C и X одни ножи) — упаковщик обязан этого не допустить.
(function () {
    var cuts = [cut('F', 'MA', K([[40, 22]]), 20, false, 0, 0),
                cut('X', 'MD', K([[80, 11]]), 3, true, 1, 0),
                cut('C', 'MD', K([[80, 11]]), 3, true, 0, 1200),
                cut('Y', 'ME', K([[59, 15]]), 3, true, 1, 600)];
    var ord = order(pack(cuts, { X: 1, C: 0, Y: 1 }));
    assert(adjacent(ord, 'X', 'Y'),
        '#4491-A: монолит дня-приёмника цел — X и Y остались соседями', '(' + ord.join(' → ') + ')');
    assert(ord.indexOf('C') > ord.indexOf('Y'),
        '#4491-A: приезжая 🔒 встала ПОСЛЕ монолита, а не внутрь него', '(' + ord.join(' → ') + ')');
})();

// ── B: 🔒, уехавшие вместе, сохраняют свой взаимный порядок ─────────────────────────────────
// P и Q — монолит дня 0; день 0 забит, обе уезжают на день 1. Очередь §8 ставит их в обратном
// порядке (Q раньше P) — упаковщик обязан вернуть хранимый порядок P → Q.
(function () {
    var cuts = [cut('F', 'MA', K([[40, 22]]), 20, false, 0, 0),
                cut('Q', 'MB', K([[110, 8]]), 3, true, 0, 1800),
                cut('P', 'MB', K([[110, 8]]), 3, true, 0, 1200)];
    var ord = order(pack(cuts, { Q: 0, P: 0 }));
    assert(ord.indexOf('P') < ord.indexOf('Q'),
        '#4491-B: уехавшие вместе 🔒 сохранили хранимый порядок P → Q', '(' + ord.join(' → ') + ')');
    assert(adjacent(ord, 'P', 'Q'),
        '#4491-B: и остались соседями (монолит переехал целиком)', '(' + ord.join(' → ') + ')');
})();

// ── C: ИСКЛЮЧЕНИЕ — ручной перенос «по весу» вправе встроиться внутрь ───────────────────────
// Тот же расклад, что в A, но C оператор переносит ПРЯМО СЕЙЧАС (wholeDayByCut). Место ей выбрал
// §8 по минимальному штрафу — упаковщик его уважает; порядок остальных не меняется.
(function () {
    // C уже на дне 1 (оператор её туда переносит прямо сейчас), §8 ставит её между X и Y.
    var cuts = [cut('X', 'MD', K([[80, 11]]), 3, true, 1, 0),
                cut('C', 'MD', K([[80, 11]]), 3, true, 1, 300),
                cut('Y', 'ME', K([[59, 15]]), 3, true, 1, 600)];
    var ord = order(pack(cuts, { X: 1, C: 1, Y: 1 }, { wholeDayByCut: { C: 1 } }));
    assert(ord.indexOf('X') < ord.indexOf('Y'),
        '#4491-C: порядок ОСТАЛЬНЫХ не изменился — X по-прежнему раньше Y', '(' + ord.join(' → ') + ')');
    assert(ord.indexOf('C') === ord.indexOf('X') + 1,
        '#4491-C: перенесённое вручную встроилось туда, где §8 насчитал минимальный штраф',
        '(' + ord.join(' → ') + ')');
})();

// ── D: регресс-контроль #4464 — монолит дня без приезжих ────────────────────────────────────
(function () {
    var cuts = [cut('F1', 'MB', K([[110, 8]]), 3, true, 0, 0),
                cut('S', 'MB', K([[110, 8]]), 3, false, 0, 1800),
                cut('F2', 'MC', K([[25, 35]]), 3, true, 0, 600)];
    var ord = order(pack(cuts, { F1: 0, F2: 0 }));
    assert(adjacent(ord, 'F1', 'F2'),
        '#4491-D: свободное между двумя 🔒 одного дня не встаёт (#4464)', '(' + ord.join(' → ') + ')');
})();

console.log('\n' + passed + '/' + total + ' проверок пройдено');
if (passed !== total) process.exitCode = 1;
