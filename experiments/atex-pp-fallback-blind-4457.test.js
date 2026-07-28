// #4457 — почему штраф разрыва (#4454) не спас: его никто не спрашивал.
//
// ТРАССА С БОЕВОЙ (ateh1, issue #4457):
//   ── задание 644294 (срок 20260728, обычн., работа 3.6 мин): рассмотрено вариантов 73 ──
//      ВЫБРАН: станок 1279 поз 16 → вес 0 (день~?; без штрафов) [фолбэк §8.4: некуда пристроить]
// 73 варианта посчитаны и выброшены. За прогон так ушли ЧЕТЫРЕ задания (поз 12, 16, 18, 26).
//
// ДВЕ НЕЗАВИСИМЫЕ ДЫРЫ:
//  1. Гейт §8.4 меряет `setupWeight` (сумму по ВСЕМ стыкам точки) порогом «смена ножей + смена
//     сырья» — а это цена ОДНОГО стыка. Вставка в середину даёт два стыка, порог перебит почти
//     всегда → задание с уникальной комбинацией ножей уходило в фолбэк ВСЕГДА, мимо штрафов.
//  2. Жадная укладка «по одному» разрыв не видит ПО ПОСТРОЕНИЮ: когда слот кладётся, будущих
//     соседей ещё нет, последовательность возникает позже. Ловить разрыв можно только на
//     собранной расстановке — в проходе релокации; но его триггеры были только «фольга» и
//     «просрочка». Замер: «остаться» 175 (в т.ч. breakKnives 50) против «в конец» 80 —
//     и НОЛЬ переносов.
//
// Run with: node experiments/atex-pp-fallback-blind-4457.test.js

process.env.TZ = 'UTC';
global.window = { db: 'testdb', xsrf: 'x' };
var planning = require('../download/atex/js/production-planning.js').planning;

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

// Веса — как на боевой ateh1 (блок ПЕРЕМЕННЫЕ из трассы #4457).
var TIMES = { MATERIAL_WINDING: 15, KNIFE: 30 };
var SETTINGS = {
    KNIVES_CHANGE_COST_MN: 30, KNIVES_INCREASE_COST_MN: 35, MATERIAL_CHANGE_COST_MN: 15,
    LEADER_COST_MN: 0, FOIL_NOTEND_COST_MN: 0, DEADLINE_COST_MN: 0, EXACT_DEADLINE_COST_MN: 0,
    ORDER_DIFF_PENALTY_MN: 0, MAX_SLOTS_DISTANCE_HR: 0, CHANGE_SLITTER_COST_MN: 3, CHANGE_DAY_COST_MN: 3,
    BREAK_KNIVES_COST_MN: 50, BREAK_MATERIAL_COST_MN: 40
};
var CTX = { settings: SETTINGS, times: TIMES, capacityMin: 450 };
function slot(id, mat, batch, knives, work) {
    return { kind: 'cut', id: id, slitterId: '1', materialId: mat, winding: 'OUT', batchId: batch,
             knifeWidths: knives, knifeCount: knives.length, rollerWidth: 0,
             firstPartId: id, plannedRuns: 1, workMin: work };
}
var K15 = [59, 59, 59], K18 = [49, 49, 49, 49];
function ids(occ, m) { return occ.byMachine[m || '1'].map(function(s) { return s.id; }).join(' → '); }

// Расстановка боевого прогона: MW308 (18 полос) вклинился между двумя MW411 (59 мм, 15 полос),
// идущими через границу дней 27→28.07.
function wedged() {
    return [slot('t27', 'MW411', '642324', K15, 61),
            slot('mw308', 'MW308', '644303', K18, 55),
            slot('h28', 'MW411', '643940', K15, 122),
            slot('mwr', 'MWR200', '644945', K15, 79),
            slot('mr', 'MR194', '644583', K15, 47)];
}

// ── 1. Цена разрыва посчитана — и она в разы выше альтернативы ───────────────────────────────
(function() {
    var arr = wedged();
    var without = [arr[0], arr[2], arr[3], arr[4]];
    var stay = planning.scorePosition(without, 1, arr[1], CTX);
    var end = planning.scorePosition(without, 4, arr[1], CTX);
    assert(stay.byFactor.breakKnives === SETTINGS.BREAK_KNIVES_COST_MN,
        'штраф разрыва в цене «остаться» есть', '(' + JSON.stringify(stay.byFactor) + ')');
    assert(stay.weight > end.weight + 50, 'и «остаться» заметно дороже «встать в конец»',
        '(остаться ' + stay.weight + ' vs в конец ' + end.weight + ')');
})();

// ── 2. Проход релокации ВЫВОДИТ задание из разрыва ───────────────────────────────────────────
// Это и есть дыра #4457: штраф считался, но триггеры релокации («после фольги», «за сроком»)
// разрыв не покрывали, и задание оставалось на месте.
(function() {
    var occ = planning.seedOccupancy(wedged(), [], ['1']);
    var r = planning.relocatePass(occ, null, CTX);
    assert(r.moves.length > 0, 'релокация видит разрыв и переносит задание', '(переносов ' + r.moves.length + ')');
    var order = ids(occ);
    assert(order.indexOf('t27 → mw308 → h28') < 0,
        'MW308 больше не стои́т между двумя MW411 (стык дней)', '(' + order + ')');
})();

// ── 3. Гейт §8.4 нормирован на число стыков ──────────────────────────────────────────────────
// Вставка в середину — два стыка; порог «смена ножей + смена сырья» — цена одного. Без
// нормировки любая такая вставка объявлялась «некуда пристроить».
// Фикстура повторяет замер трассы: у 644294 лучший вариант стоил «knife +60, material +15» =
// setupWeight 75 — дороже ОДНОГО стыка (45) и дешевле ДВУХ (90).
(function() {
    var arr = [slot('A', 'MW411', '900', K18, 200), slot('B', 'MR194', '903', K15, 150)];
    var mid = planning.scorePosition(arr, 1, slot('X', 'MW308', '901', K18, 60), CTX);
    var tail = planning.scorePosition(arr, 2, slot('X', 'MW308', '901', K18, 60), CTX);
    assert(mid.setupLinks === 2, 'вставка в середину — два стыка', '(' + mid.setupLinks + ')');
    assert(tail.setupLinks === 1, 'дописывание в конец — один стык', '(' + tail.setupLinks + ')');
    var accLink = SETTINGS.KNIVES_CHANGE_COST_MN + SETTINGS.MATERIAL_CHANGE_COST_MN;
    assert(mid.setupWeight > accLink && mid.setupWeight <= accLink * 2,
        'середина дороже ОДНОГО стыка, но дешевле ДВУХ — «некуда пристроить» это не значит',
        '(setupWeight ' + mid.setupWeight + ', порог/стык ' + accLink + ')');

    // Гейт §8.4 на такой точке молчит: порог нормирован на её два стыка (90), а не на один (45).
    var occ = planning.seedOccupancy(arr, [], ['1', '2']);
    occ.byMachine['2'] = [slot('Z', 'MWR400', '905', [99, 99], 400)];
    occ.byMachine['2'][0].slitterId = '2';
    var best = planning.placeSlot(occ, slot('X', 'MW308', '901', K18, 60), CTX);
    assert(!best.fallback, 'такая точка — не «некуда пристроить», задание размещается по весу',
        '(fallback=' + !!best.fallback + ', станок ' + best.machineId + ', вес ' + best.weight + ')');
})();

// ── 4. Фолбэк, когда он всё же срабатывает, не врёт про вес ──────────────────────────────────
// «вес 0 (без штрафов)» в трассе — запись, по которой невозможно понять решение. Позиция обязана
// быть посчитана даже когда станок выбран правилом §8.4, а не весом.
(function() {
    var m1 = [slot('A', 'MW411', '900', K15, 300), slot('B', 'MW411', '900', K15, 300)];
    var m2 = [slot('Z', 'MWR400', '905', [99, 99], 60)];
    var occ = planning.seedOccupancy(m1.concat(m2.map(function(s) { s.slitterId = '2'; return s; })), [], ['1', '2']);
    var X = slot('X', 'MW308', '901', [29, 29, 29, 29, 29], 60);   // чужой всем
    var best = planning.placeSlot(occ, X, CTX);
    if (best.fallback) {
        assert(best.weight > 0 && best.byFactor && Object.keys(best.byFactor).length > 0,
            'фолбэк отдаёт ЧЕСТНЫЙ вес и факторы, а не «0, без штрафов»',
            '(вес ' + best.weight + ', ' + JSON.stringify(best.byFactor) + ')');
    } else {
        assert(best.weight >= 0, 'задание размещено по весу (фолбэк не понадобился)',
            '(станок ' + best.machineId + ', вес ' + best.weight + ')');
    }
    assert(ids(occ).indexOf('A → X → B') < 0, 'последовательность A|B не разорвана', '(станок 1: ' + ids(occ) + ')');
})();

// ── 5. КОНТРОЛЬ: непричастные задания релокация не дёргает ──────────────────────────────────
(function() {
    var arr = [slot('A', 'MW411', '900', K15, 100), slot('B', 'MW411', '900', K15, 100),
               slot('C', 'MW411', '900', K15, 100)];
    var occ = planning.seedOccupancy(arr, [], ['1']);
    var r = planning.relocatePass(occ, null, CTX);
    assert(r.moves.length === 0 && ids(occ) === 'A → B → C',
        'КОНТРОЛЬ: однородная очередь без разрывов — ни одного переноса', '(' + ids(occ) + ')');
})();

console.log('\n' + passed + '/' + total + ' passed');
