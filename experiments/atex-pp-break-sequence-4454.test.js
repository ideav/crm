// #4454 — штраф за РАЗБИЕНИЕ последовательности: BREAK_KNIVES_COST_MN / BREAK_MATERIAL_COST_MN.
//
// ЧТО ЛОВИМ. Планировщик ставит подряд одинаковые комбинации ножей и сырья, чтобы не платить
// переналадку. Вклиниться в такую цепочку значит заплатить ДВЕ переналадки вместо нуля — но
// стоимость вставки считается как сумма двух переходов (`insertionCost`) и НЕ возвращает
// стоимость разрушенного перехода prev→next. Поэтому «внутрь однородной цепочки» и «в шов между
// разными» стои́т одинаково, ничью решает betterCand — и задание садится в середину цепочки
// (на скрине тикета: MW308 49 мм/18 полос встаёт между двумя MW411 59 мм/15 полос на стыке дней).
//
// Штрафы из «Настройки» 269 (ТЗ §8.2, числа §14) делают разрыв дорогим явно.
//
// Run with: node experiments/atex-pp-break-sequence-4454.test.js

process.env.TZ = 'UTC';
global.window = { db: 'testdb', xsrf: 'x' };
var planning = require('../download/atex/js/production-planning.js').planning;

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

var TIMES = { MATERIAL_WINDING: 15, KNIFE: 30 };
var SETTINGS = {
    KNIVES_CHANGE_COST_MN: 30, KNIVES_INCREASE_COST_MN: 50, MATERIAL_CHANGE_COST_MN: 15,
    LEADER_COST_MN: 0, FOIL_NOTEND_COST_MN: 0, DEADLINE_COST_MN: 0, EXACT_DEADLINE_COST_MN: 0,
    ORDER_DIFF_PENALTY_MN: 0, MAX_SLOTS_DISTANCE_HR: 0,
    BREAK_KNIVES_COST_MN: 50, BREAK_MATERIAL_COST_MN: 40
};
// Ёмкость дня огромная — оценка дня не должна вмешиваться в сравнение весов.
var CTX = { settings: SETTINGS, times: TIMES, capacityMin: 100000, slitterId: '1' };

// Задание: сырьё+партия задают «последовательность сырья», ножи — «последовательность ножей».
function slot(id, mat, batch, knives) {
    return { kind: 'cut', id: id, slitterId: '1', materialId: mat, winding: 'IN', batchId: batch,
             knifeWidths: knives, knifeCount: knives.length, rollerWidth: 0,
             firstPartId: id, plannedRuns: 1, workMin: 60 };
}
var K15 = [59, 59, 59];          // «15 полос» цепочки MW411
var K18 = [49, 49, 49, 49];      // чужая комбинация (MW308, 18 полос)

function weightAt(arr, index, s) {
    var sc = planning.scorePosition(arr, index, s, CTX);
    return sc ? sc.weight : null;
}

// ── 1. Ножи: вклинивание в цепочку одинаковых ножей дороже, чем в шов ────────────────────────
(function() {
    // Цепочка: A и B — один набор ножей и одно сырьё (переналадки между ними НЕТ).
    var A = slot('A', 'MW411', '900', K15);
    var B = slot('B', 'MW411', '900', K15);
    var X = slot('X', 'MW308', '901', K18);   // чужак: и ножи, и сырьё другие
    var inside = weightAt([A, B], 1, X);      // между A и B — РАЗРЫВ последовательности
    var atEnd = weightAt([A, B], 2, X);       // в конец — последовательность цела

    assert(inside > atEnd, 'вклинивание в цепочку дороже, чем дописать в конец',
        '(внутрь ' + inside + ' vs в конец ' + atEnd + ')');
    assert(inside - atEnd >= SETTINGS.BREAK_KNIVES_COST_MN + SETTINGS.BREAK_MATERIAL_COST_MN,
        'разница включает оба штрафа разрыва (ножи + сырьё/партия)',
        '(Δ=' + (inside - atEnd) + ', ожидали ≥ ' + (SETTINGS.BREAK_KNIVES_COST_MN + SETTINGS.BREAK_MATERIAL_COST_MN) + ')');
})();

// ── 2. Шов между РАЗНЫМИ заданиями штрафа разрыва не несёт ───────────────────────────────────
(function() {
    var A = slot('A', 'MW411', '900', K15);
    var C = slot('C', 'MWR200', '902', K18);   // A и C — уже разные: переналадка между ними ЕСТЬ
    var X = slot('X', 'MW308', '901', K18);
    var sc = planning.scorePosition([A, C], 1, X, CTX);
    assert(!(sc.byFactor.breakKnives || sc.byFactor.breakMaterial),
        'встать в уже существующий шов — не разрыв, штрафа нет', '(' + JSON.stringify(sc.byFactor) + ')');
})();

// ── 3. Продолжение той же комбинации внутрь цепочки — не разрыв ──────────────────────────────
(function() {
    var A = slot('A', 'MW411', '900', K15);
    var B = slot('B', 'MW411', '900', K15);
    var same = slot('S', 'MW411', '900', K15);   // тот же набор ножей и та же партия
    var sc = planning.scorePosition([A, B], 1, same, CTX);
    assert(!(sc.byFactor.breakKnives || sc.byFactor.breakMaterial),
        'своё же задание внутрь своей цепочки — последовательность не рвётся', '(' + JSON.stringify(sc.byFactor) + ')');
    assert(sc.weight === 0, 'и стои́т ноль (никакой переналадки не появилось)', '(вес ' + sc.weight + ')');
})();

// ── 4. Штрафы раздельные: рвётся только сырьё / только ножи ──────────────────────────────────
(function() {
    var A = slot('A', 'MW411', '900', K15);
    var B = slot('B', 'MW411', '900', K15);
    // #4481: другая партия ТОГО ЖЕ сырья — не смена сырья, значит и последовательность не рвётся:
    // вставка между двумя заданиями одной заправки бесплатна независимо от партий.
    var otherBatch = slot('X', 'MW411', '999', K15);
    var sc1 = planning.scorePosition([A, B], 1, otherBatch, CTX);
    assert(!sc1.byFactor.breakMaterial && !sc1.byFactor.breakKnives,
        '#4481: другая партия того же сырья последовательность не рвёт', '(' + JSON.stringify(sc1.byFactor) + ')');
    // Разрыв по сырью проверяем сменой САМОГО сырья — это по-прежнему разрыв.
    var otherMat = slot('X2', 'MR194', '900', K15);
    var sc1b = planning.scorePosition([A, B], 1, otherMat, CTX);
    assert(sc1b.byFactor.breakMaterial === SETTINGS.BREAK_MATERIAL_COST_MN && !sc1b.byFactor.breakKnives,
        'другое сырьё — штраф разрыва ТОЛЬКО по сырью', '(' + JSON.stringify(sc1b.byFactor) + ')');

    // То же сырьё и партия, ДРУГИЕ ножи → рвётся только последовательность ножей.
    var otherKnives = slot('Y', 'MW411', '900', K18);
    var sc2 = planning.scorePosition([A, B], 1, otherKnives, CTX);
    assert(sc2.byFactor.breakKnives === SETTINGS.BREAK_KNIVES_COST_MN && !sc2.byFactor.breakMaterial,
        'другие ножи — штраф разрыва ТОЛЬКО по ножам', '(' + JSON.stringify(sc2.byFactor) + ')');
})();

// ── 5. Веса читаются из «Настройки»: 0 выключает штраф ───────────────────────────────────────
(function() {
    var A = slot('A', 'MW411', '900', K15);
    var B = slot('B', 'MW411', '900', K15);
    var X = slot('X', 'MW308', '901', K18);
    var off = {};
    Object.keys(SETTINGS).forEach(function(k) { off[k] = SETTINGS[k]; });
    off.BREAK_KNIVES_COST_MN = 0; off.BREAK_MATERIAL_COST_MN = 0;
    var sc = planning.scorePosition([A, B], 1, X, { settings: off, times: TIMES, capacityMin: 100000, slitterId: '1' });
    assert(!(sc.byFactor.breakKnives || sc.byFactor.breakMaterial),
        'BREAK_*=0 в «Настройке» выключает штраф (аварийный рубильник)', '(' + JSON.stringify(sc.byFactor) + ')');
})();

// ── 6. Дефолты кода — значения тикета ────────────────────────────────────────────────────────
(function() {
    assert(planning.planWeight({}, 'BREAK_KNIVES_COST_MN') === 50, 'дефолт BREAK_KNIVES_COST_MN = 50',
        '(' + planning.planWeight({}, 'BREAK_KNIVES_COST_MN') + ')');
    assert(planning.planWeight({}, 'BREAK_MATERIAL_COST_MN') === 40, 'дефолт BREAK_MATERIAL_COST_MN = 40',
        '(' + planning.planWeight({}, 'BREAK_MATERIAL_COST_MN') + ')');
    assert(planning.planWeight({ BREAK_KNIVES_COST_MN: '70' }, 'BREAK_KNIVES_COST_MN') === 70,
        'значение из «Настройки» перебивает дефолт');
})();

// ── 7. Ядро тикета: РАЗРЫВ и ШОВ больше не стоят одинаково ──────────────────────────────────
// Станок: MW411 | MW411 (одна комбинация — на скрине она идёт через границу дней) … MR194 | MWR200
// (тут переналадка уже есть). Вставляем чужое всем задание MW308. Число полос везде одно, поэтому
// доплата за рост ножей (KNIVES_INCREASE) нигде не начисляется и оба перехода стоят поровну:
// сумма двух переходов ОДИНАКОВА в разрыве и в шве — ровно та ничья, из-за которой задание
// садилось в середину цепочки (шов уже оплачен, разрыв создаёт вторую переналадку с нуля).
(function() {
    var A = slot('A', 'MW411', '900', [59, 59, 59]);
    var B = slot('B', 'MW411', '900', [59, 59, 59]);   // A|B — последовательность: переналадки между ними нет
    var C = slot('C', 'MR194', '903', [49, 49, 49]);
    var D = slot('D', 'MWR200', '904', [39, 39, 39]);  // C|D — шов: переналадка уже оплачена
    var arr = [A, B, C, D];
    var X = slot('X', 'MW308', '901', [29, 29, 29]);   // чужое и по ножам, и по сырью

    var atBreak = weightAt(arr, 1, X);   // РАЗРЫВ последовательности A|B
    var atSeam = weightAt(arr, 3, X);    // ШОВ C|D
    assert(atBreak > atSeam, 'разрыв последовательности дороже шва (переходы стоят поровну — решает штраф разрыва)',
        '(разрыв ' + atBreak + ' vs шов ' + atSeam + ')');

    var best = null;
    for (var i = 0; i <= arr.length; i++) {
        var sc = planning.scorePosition(arr, i, X, CTX);
        if (!sc) continue;
        if (!best || sc.weight < best.weight) best = { index: i, weight: sc.weight };
    }
    assert(best.index !== 1, 'самая дешёвая точка — НЕ внутри последовательности',
        '(выбран индекс ' + best.index + ', вес ' + best.weight + ')');
})();

// ── 8. СТЫК ДНЕЙ: предыдущий день пришёл ЗАПРАВКОЙ станка, а не слотом ───────────────────────
// Это и есть «в частности на стыке дней» из тикета. Когда предыдущий день вне входа планировщика
// (прошлое / вне окна [С;По]), его хвост приходит не соседним слотом, а ЗАПРАВКОЙ станка
// (prevSetupBySlitter, #4288) — и позиция 0 оказывается точкой ВНУТРИ последовательности
// «заправка → первая резка дня». Разрыв там такой же настоящий: рулон снимут и поставят обратно.
// У заправки нет партии, поэтому сырьё сравниваем по виду и намотке (как carryOverPrevCut).
var CARRY = { materialId: 'MW411', winding: 'IN', knifeWidths: K15 };
var carryCtx = { settings: SETTINGS, times: TIMES, capacityMin: 450, slitterId: '1',
                 prevSetupBySlitter: { '1': CARRY } };
function withWork(s, work) { s.workMin = work; return s; }

(function() {
    // Станок заправлен под MW411/K15, первая резка дня — MW411/K15: продолжение той же комбинации.
    var head = withWork(slot('head', 'MW411', '900', K15), 200);
    var tail = withWork(slot('tail', 'MR194', '903', K18), 150);
    var arr = [head, tail];

    // Чужое сырьё на тех же ножах — рвётся последовательность СЫРЬЯ.
    var otherMat = withWork(slot('Y', 'MW308', '901', K15), 100);
    var sc = planning.scorePosition(arr, 0, otherMat, carryCtx);
    assert(sc.byFactor.breakMaterial === SETTINGS.BREAK_MATERIAL_COST_MN,
        'СТЫК ДНЕЙ: вклинивание между заправкой станка и первой резкой дня — разрыв по сырью',
        '(' + JSON.stringify(sc.byFactor) + ')');

    // Чужие ножи на том же сырье — рвётся последовательность НОЖЕЙ.
    var otherKn = withWork(slot('Z', 'MW411', '900', K18), 100);
    var sc2 = planning.scorePosition(arr, 0, otherKn, carryCtx);
    assert(sc2.byFactor.breakKnives === SETTINGS.BREAK_KNIVES_COST_MN,
        'СТЫК ДНЕЙ: то же, по ножам', '(' + JSON.stringify(sc2.byFactor) + ')');

    // И главное: начало дня перестаёт быть самым дешёвым местом для чужака.
    var occ = planning.seedOccupancy(arr, [], ['1']);
    var best = planning.placeSlot(occ, otherMat, carryCtx);
    assert(best.index !== 0, 'СТЫК ДНЕЙ: чужое задание не садится в начало дня',
        '(индекс ' + best.index + ', порядок ' + occ.byMachine['1'].map(function(s) { return s.id; }).join(' → ') + ')');
})();

(function() {
    // КОНТРОЛЬ: задание, ПРОДОЛЖАЮЩЕЕ заправку, встать первым имеет полное право — не разрыв.
    var head = withWork(slot('head', 'MW411', '900', K15), 200);
    var arr = [head];
    var same = withWork(slot('S', 'MW411', '900', K15), 100);
    var sc = planning.scorePosition(arr, 0, same, carryCtx);
    assert(!(sc.byFactor.breakKnives || sc.byFactor.breakMaterial),
        'КОНТРОЛЬ: продолжение заправки в начале дня — не разрыв', '(' + JSON.stringify(sc.byFactor) + ')');
})();

(function() {
    // КОНТРОЛЬ: станок заправлен ПОД ДРУГОЕ, чем первая резка дня — последовательности нет,
    // рвать нечего (шов уже оплачен), штрафа быть не должно.
    var head = withWork(slot('head', 'MR194', '903', K18), 200);
    var arr = [head];
    var X2 = withWork(slot('X', 'MW308', '901', [29, 29, 29]), 100);
    var sc = planning.scorePosition(arr, 0, X2, carryCtx);
    assert(!(sc.byFactor.breakKnives || sc.byFactor.breakMaterial),
        'КОНТРОЛЬ: заправка и первая резка дня разные — это шов, а не последовательность',
        '(' + JSON.stringify(sc.byFactor) + ')');
})();

console.log('\n' + passed + '/' + total + ' passed');
