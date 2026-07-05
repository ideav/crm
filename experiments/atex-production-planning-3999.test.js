// Tests for ideav/crm#3999 — «число полос по дню не по убыванию».
//
// Причина: направленное убывание полос (#3996/#3991) жило ТОЛЬКО в orderCuts→sequencingCost,
// а реальный порядок дня собирает жадный упаковщик splitMachineQueue(gapFill) через selectByConfig
// по ЧИСТОЙ переналадке (setupCostFor = changeoverParts, физминуты #3600). Штраф за рост полос
// туда не входил, поэтому день мог идти «мелкие → крупный блок» (issue #3999: Станок 1 23.06 —
// 18,18,11,11,9, затем блок 29).
//
// Фикс #3999: в ключ selectByConfig добавлено число полос по УБЫВАНИЮ тай-брейком (ниже
// переналадки — группировка сырья/ножей #3783 остаётся главной, выше idx). «При прочих равных»
// (равная переналадка) раньше идёт бо́льшее число ножей → день убывает к вечеру (#3130), суммарной
// переналадки это не ухудшает.
//
// Run with: node experiments/atex-production-planning-3999.test.js

process.env.TZ = 'UTC';
var api = require('../download/atex/js/production-planning.js');
var P = api.planning;

var passed = 0;
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) passed++;
    else { console.log('  expected:', JSON.stringify(expected)); console.log('  actual:  ', JSON.stringify(actual)); process.exitCode = 1; }
}
function assert(cond, name) { assertEqual(!!cond, true, name); }

var TIMES = { KNIFE: 30, MATERIAL_WINDING: 15, BETWEEN_CUTS: 0 };
function W(w, n) { var a = []; for (var i = 0; i < n; i++) a.push(w); return a; }
function cut(id, mat, win, strips, width) {
    return { id: id, materialId: mat, winding: win, batchId: null,
             knifeWidths: W(width, strips), knifeCount: strips, rollerWidth: 0, isFoil: false, plannedRuns: 1 };
}
// Разложить очередь одного станка упаковщиком (как generateCuts/autoSequenceQueue: gapFill=true),
// вернуть число полос в порядке исполнения (по windowStartMin) по дням.
function packStripsByDay(cuts, capMin) {
    var perPass = {}, runs = {};
    cuts.forEach(function(c){ perPass[String(c.id)] = 1; runs[String(c.id)] = 1; });
    var segs = P.splitMachineQueue(cuts, {
        dayStartMin: 480, dayEndMin: 480 + (capMin || 450), dayEndHourMin: 480 + (capMin || 450),
        times: TIMES, perPassByCut: perPass, runsByCut: runs, firstCutSetup: true, gapFill: true
    });
    var byId = {}; cuts.forEach(function(c){ byId[String(c.id)] = c; });
    var byDay = {};
    segs.forEach(function(s){ if (s.setupOnly) return; (byDay[s.dayOffset] = byDay[s.dayOffset] || []).push(s); });
    return Object.keys(byDay).map(Number).sort(function(a,b){return a-b;}).map(function(d){
        return byDay[d].slice().sort(function(a,b){ return a.windowStartMin - b.windowStartMin; })
            .map(function(s){ return byId[String(s.cutId)].knifeCount; });
    });
}
function isDesc(arr) { return arr.every(function(v,i){ return i === 0 || arr[i-1] >= v; }); }

// ── 1) минимальный кейс: равная переналадка → раньше больше полос (тай-брейк #3999) ──
// A(9,X), B(29,Y), C(18,Z) — разные наборы ножей, вход по возрастанию полос [A,B,C].
// Первый выбор дня: firstSetup=30 у всех (ничья) → без фикса берётся idx (A=9), с фиксом — B=29.
(function () {
    var cuts = [ cut('A', 'X', 'OUT', 9, 40), cut('B', 'Y', 'OUT', 29, 30), cut('C', 'Z', 'OUT', 18, 50) ];
    var days = packStripsByDay(cuts, 450);
    assertEqual(days.length, 1, '#3999 min: всё в один день');
    assertEqual(days[0], [29, 18, 9], '#3999 min: порядок дня по УБЫВАНИЮ полос (29,18,9), а не по входу (9,29,18)');
    assert(isDesc(days[0]), '#3999 min: день строго по убыванию');
})();

// ── 2) кейс issue: блок общих ножей {30}×29 + мелкие группы, несколько дней ──
// Каждый день обязан идти по убыванию (а не «мелкие → блок 29», как в issue #3999).
(function () {
    var cuts = [];
    // мелкие группы
    cuts.push(cut('m1', 'MR314L', 'OUT', 18, 32.5), cut('m2', 'MR314L', 'IN', 18, 32.5));
    cuts.push(cut('m3', 'MR314L', 'IN', 11, 54.5), cut('m4', 'MR314L', 'OUT', 11, 54.5));
    cuts.push(cut('m5', 'MW308', 'OUT', 9, 99));
    // большой блок общих ножей {30}×29 (разные сырьё, один набор ножей)
    ['MW308','MWR200','MWR200','MWR200','MR194','MR194','MR194','MR194','MR194','MR194'].forEach(function(mat, i){
        cuts.push(cut('b' + i, mat, 'OUT', 29, 30));
    });
    // ёмкость поменьше — заставляем раскладку на 2+ дня
    var days = packStripsByDay(cuts, 200);
    assert(days.length >= 2, '#3999 issue: раскладка на 2+ дня (n=' + days.length + ')');
    days.forEach(function(day, i){
        assert(isDesc(day), '#3999 issue: день ' + i + ' по убыванию [' + day.join(',') + ']');
    });
})();

// ── 3) фольга остаётся в конце дня (isFoil — старший разряд ключа, #3717 не нарушен) ──
(function () {
    var cuts = [ cut('reg1', 'A', 'OUT', 9, 40), cut('reg2', 'A', 'OUT', 29, 30) ];
    var foil = cut('f', 'ФОЛЬГА', 'IN', 40, 20); foil.isFoil = true;   // много полос, но фольга
    cuts.push(foil);
    var days = packStripsByDay(cuts, 450);
    var last = days[0][days[0].length - 1];
    // фольга (40 полос) НЕ уходит в начало несмотря на макс. полосы — она последняя
    assertEqual(last, 40, '#3999 фольга: несмотря на 40 полос, фольга в КОНЦЕ дня (#3717 сохранён)');
    assertEqual(days[0], [29, 9, 40], '#3999 фольга: нефольга по убыванию (29,9), фольга — в конец');
})();

console.log('\n' + passed + ' checks passed');
