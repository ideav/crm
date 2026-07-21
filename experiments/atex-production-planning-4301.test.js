// #4301 — «Нельзя пересчитывать длину в заданиях НИКОГДА».
//
// Симптом (ateh, заказ 4282): позиция заказа — 600 м, но задание показывает 1200 м (а на повторе
// 2400 м) — «длина намотки» удваивается на каждой пересборке. Реальные данные: cut 631088 —
// cut_length=1200, supply_footage=1200 при position_length=600.
//
// Корень: cutRunLength = MAX(«Длина, м» резки, «Метраж, м» обеспечения). Дробление/склейка заданий
// искажали метраж обеспечения, cutRunLength брал этот метраж как длину прогона И ЗАПИСЫВАЛ его
// обратно в «Длина, м» резки (runLenForCutId → _m_set при разбиении). max(600, 1200)=1200 →
// записалось 1200 → на следующей пересборке max(1200, …) и рост.
//
// Фикс: длина прогона = «Длина, м» ПОЗИЦИИ ЗАКАЗА (positionLengthMap по positionId обеспечения) —
// неизменная величина заказа. Метраж обеспечения в расчёте длины НЕ участвует. Нет позиции
// (сток/сирота) → сохранённая «Длина, м» резки как есть.
//
// Run with: node experiments/atex-production-planning-4301.test.js

process.env.TZ = 'UTC';
var planning = require('../download/atex/js/production-planning.js').planning;

var passed = 0, total = 0;
function assert(cond, name) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}

var positionLengthMap = planning.positionLengthMap;
var cutRunLength = planning.cutRunLength;

// ── Реальный кейс заказа 4282: позиция 600, метраж обеспечения искажён до 1200 ──────────────────────
(function () {
    // genPositions → карта длин позиций (источник истины). Позиция 626009 — 600 м.
    var posLen = positionLengthMap([{ id: '626009', length: 600 }]);
    // cut/supply с ИСКАЖЁННЫМИ значениями (как в БД ateh после дробления/склейки).
    var cut = { id: '631088', length: 1200 };                       // «Длина, м» резки уже удвоена
    var supplies = [{ id: '631110', cutId: '631088', positionId: '626009', footage: 1200 }]; // метраж тоже 1200

    assert(cutRunLength(cut, supplies, posLen) === 600,
        '#4301: длина прогона = «Длина, м» позиции (600), а НЕ искажённые 1200 резки/обеспечения');

    // Идемпотентность: даже если метраж «раздули» ещё сильнее (2400) — длина остаётся 600.
    var supplies2 = [{ id: '631110', cutId: '631088', positionId: '626009', footage: 2400 }];
    assert(cutRunLength({ id: '631088', length: 2400 }, supplies2, posLen) === 600,
        '#4301: рост метража/длины (2400) не влияет — длина фиксирована позицией (600)');
})();

// ── Метраж обеспечения НИКОГДА не задаёт длину (даже при пустой «Длина, м» резки) ────────────────────
(function () {
    var posLen = positionLengthMap([{ id: 'p1', length: 450 }]);
    assert(cutRunLength({ id: 'c1', length: '' }, [{ cutId: 'c1', positionId: 'p1', footage: 9999 }], posLen) === 450,
        '#4301: длина = позиция (450), метраж 9999 игнорируется даже при пустой «Длина, м» резки');
})();

// ── Несколько позиций разной длины → длина прогона = МАКС (параллельный слиттинг) ────────────────────
(function () {
    var posLen = positionLengthMap([{ id: 'a', length: 300 }, { id: 'b', length: 700 }]);
    var supplies = [
        { cutId: 'c1', positionId: 'a', footage: 300 },
        { cutId: 'c1', positionId: 'b', footage: 700 }
    ];
    assert(cutRunLength({ id: 'c1', length: 0 }, supplies, posLen) === 700,
        '#4301: длина прогона = МАКС длина покрытых позиций (700), как layoutRunLength');
})();

// ── Нет позиции (сток/сирота вне positions_list) → сохранённая «Длина, м» резки как есть ─────────────
(function () {
    assert(cutRunLength({ id: 'c1', length: 500 }, [{ cutId: 'c1', positionId: 'ZZ', footage: 9999 }], {}) === 500,
        '#4301: позиция не резолвится → сохранённая длина резки (500), НЕ метраж обеспечения (9999)');
    assert(cutRunLength({ id: 'c1', length: 0 }, [], {}) === 0,
        '#4301: ни позиции, ни длины → 0 (восстанавливать неоткуда, но не выдумываем из метража)');
})();

console.log('\n' + passed + '/' + total + ' passed');
