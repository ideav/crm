// #4296 — «Почему смены сырья: 0, если других заданий нет и сырьё надо ставить на станок?»
// Все prev_cut_setup = [] (станки ПУСТЫ). Первая резка станка ставила ТОЛЬКО ножи (#3669/#4156
// firstSetupParts) → панель «смены сырья: 0», а идеал (planQuality §13) эту наладку сырья УЧИТЫВАЛ
// → факт<идеал = отрицательный избыток («план лучше идеала»).
//
// Фикс #4296: на ПУСТОМ станке первая резка СТАВИТ И НОЖИ, И СЫРЬЁ (заправка сырья с нуля — реальная
// наладка). firstSetupParts даёт KNIFE + MATERIAL_WINDING → хранимые колонки «Сырье/намотка» первой
// резки > 0 → панель «смены сырья: N», а факт сходится с идеалом (избыток ≥ 0).
//
// Run with: node experiments/atex-production-planning-4296.test.js

var planning = require('../download/atex/js/production-planning.js').planning;

var passed = 0, total = 0;
function assert(cond, name) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}
function eqo(a, e, name) { assert(JSON.stringify(a) === JSON.stringify(e), name + (JSON.stringify(a) === JSON.stringify(e) ? '' : '\n  ожидалось ' + JSON.stringify(e) + '\n  получено  ' + JSON.stringify(a))); }

var TIMES = { KNIFE: 30, MATERIAL_WINDING: 15, KNIFE_MOVE: 0, BETWEEN_CUTS: 0 };

// ── firstSetupParts: пустой станок — ножи + заправка сырья ─────────────────────────────────────────
(function () {
    var withMat = { id: 'A', knifeWidths: [50], knifeCount: 1, materialId: 'M1', winding: 'OUT' };
    var parts = planning.firstSetupParts(withMat, TIMES);
    var codes = parts.map(function (p) { return p.code + ':' + p.minutes; });
    eqo(codes, ['KNIFE:30', 'MATERIAL_WINDING:15'],
        '#4296: firstSetupParts пустого станка = ножи 30 + заправка сырья 15');
    assert(planning.firstSetupCost(withMat, TIMES) === 45, '#4296: firstSetupCost = 45 (было 30)');

    // Без сырья (materialId пусто) — только ножи (спурьёзной смены сырья нет).
    var noMat = { id: 'B', knifeWidths: [50], knifeCount: 1, materialId: '', winding: 'OUT' };
    eqo(planning.firstSetupParts(noMat, TIMES).map(function (p) { return p.code; }), ['KNIFE'],
        '#4296: резка без сырья — только ножи (не выдумываем смену сырья)');
    // Без ножей (setup-only хвост, 0 ножей) с сырьём — только заправка сырья.
    var setupOnly = { id: 'C', knifeWidths: [], knifeCount: 0, materialId: 'M1', winding: 'OUT' };
    eqo(planning.firstSetupParts(setupOnly, TIMES).map(function (p) { return p.code; }), ['MATERIAL_WINDING'],
        '#4296: резка без ножей — только заправка сырья');
})();

// ── setupActivityColumns (хранимые колонки → панель): первая резка пустого станка несёт сырьё ────────
(function () {
    var A = { id: 'A', slitterId: '1', knifeWidths: [50], knifeCount: 1, materialId: 'M1', winding: 'OUT', batchId: '', rollerWidth: 0 };
    var cols = planning.setupActivityColumns([A], TIMES, null);   // carryPrevCut=null = пустой станок
    eqo(cols['A'], { knifeMin: 30, materialWindingMin: 15 },
        '#4296: колонка первой резки пустого станка — ножи 30 + сырьё 15 (панель покажет «смены сырья»)');
})();

// ── planQuality: факт СХОДИТСЯ с идеалом (избыток ≥ 0, не «план лучше идеала») ───────────────────────
(function () {
    // 4 станка, каждый ПУСТ (prevSetupBySlitter {}), по 1 заданию — как в issue. Разные сырьё/ножи.
    function slot(id, mach, mat, kw) {
        return { id: id, slitterId: mach, dayKey: 20260721, planStartMs: 1000,
                 knifeWidths: kw, knifeCount: kw.length, materialId: mat, winding: 'OUT' };
    }
    var slots = [
        slot('t1', '1', 'MW308',  [59, 59, 59, 59, 59]),
        slot('t2', '2', 'MW411',  [50]),
        slot('t3', '3', 'MWR113L',[80]),
        slot('t4', '4', 'MR192',  [70])
    ];
    var pq = planning.planQuality(slots, { settings: {}, prevSetupBySlitter: {} });
    // Каждый станок пуст → каждая первая резка = ножи + сырьё. 4 ножа + 4 сырья.
    assert(pq.all.materialCount === 4 && pq.all.materialMin === 60,
        '#4296: факт «смены сырья» = 4 (60 мин) — заправка сырья на 4 пустых станка (было 0)');
    assert(pq.all.knifeCount === 4, '#4296: факт «ножи» = 4');
    // Идеал тоже учитывает эти наладки (§13) → избыток ≥ 0 (НЕ «план лучше идеала»).
    assert(pq.qualityAll.excessMin >= 0 && pq.qualityAll.excessCount >= 0,
        '#4296: избыток ≥ 0 — факт сошёлся с идеалом (не отрицательный «план лучше идеала»)');
})();

console.log('\n' + passed + '/' + total + ' passed');
