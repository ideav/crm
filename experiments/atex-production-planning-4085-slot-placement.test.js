// Тесты #4085 (Стадия 2) — модуль слоя РАЗМЕЩЕНИЯ (15-slot-placement.js, модель #3985).
//
// Перебор ВСЕХ точек вставки по мин. штрафу, оценка дня приземления (порт packMachine),
// сид занятости, запрет вставки в цепочку/сквозь отпуск, §8.4-исключение, проход релокации.
// Всё ЧИСТО и НЕ врезано → на живое поведение не влияет (врезка — стадии 4-5).
//
// Run with: node experiments/atex-production-planning-4085-slot-placement.test.js

var planning = require('../download/atex/js/production-planning.js').planning;
var P = planning;

var passed = 0, total = 0;
function assert(cond, name) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}
function eq(a, e, name) {
    var ok = JSON.stringify(a) === JSON.stringify(e);
    assert(ok, name + (ok ? '' : '\n    ожидалось ' + JSON.stringify(e) + '\n    получено  ' + JSON.stringify(a)));
}

// резка контроллера → слот; wm = явные рабочие минуты (для предсказуемой оценки дня)
function C(id, o) {
    o = o || {};
    return P.slotFromCut({ id: id, slitter: o.m ? { id: o.m } : undefined, materialId: o.mat || 'M1',
        winding: o.w || 'OUT', knifeWidths: o.kw || [50], knifeCount: (o.kw || [50]).length,
        rollerWidth: 0, plannedRuns: o.runs || 3, isFoil: !!o.foil, firstPartId: o.fp, workMin: o.wm,
        dayOffset: o.day }, o.due);
}
var ZERO = { KNIFE: 0, KNIFE_MOVE: 0, MATERIAL_WINDING: 0, BETWEEN_CUTS: 0 };   // обнулить настройку для чистой оценки дня

// ── slotFromCut ────────────────────────────────────────────────────────────────────────────────
(function () {
    var s = C('A', { m: 'm1', due: 20260701 });
    assert(s.kind === 'cut' && s.id === 'A' && s.slitterId === 'm1' && s.firstPartId === 'A' && s.dueKey === 20260701,
        '#4085 slotFromCut: нормализация (kind/id/slitterId/firstPartId=id/dueKey)');
    var cont = C('T', { fp: 'H' });
    assert(cont.firstPartId === 'H', '#4085 slotFromCut: продолжение несёт firstPartId головы (H)');
})();

// ── seedOccupancy: группировка по станку, порядок сохранён, отпуск по dayOffset ──────────────────
(function () {
    var occ = P.seedOccupancy([C('A', { m: 'm1', day: 0 }), C('B', { m: 'm1', day: 3 }), C('X', { m: 'm2', day: 0 })],
        [P.vacationSlot('m1', 1)], ['m1', 'm2']);
    eq(occ.byMachine.m1.map(function (s) { return s.id; }), ['A', 'vac:m1:1', 'B'],
        '#4085 seedOccupancy: отпуск (день 1) встал между A(день0) и B(день3)');
    eq(occ.byMachine.m2.map(function (s) { return s.id; }), ['X'], '#4085 seedOccupancy: m2 = [X]');
})();

// ── prefixDayOffset: оценка дня старта слота (порт packMachine) ──────────────────────────────────
(function () {
    var slots = [C('A', { wm: 90 }), C('B', { wm: 90 }), C('C', { wm: 90 })];
    var ctx = { capacityMin: 100, times: ZERO };
    eq([0, 1, 2].map(function (i) { return P.prefixDayOffset(slots, i, ctx); }), [0, 1, 2],
        '#4085 prefixDayOffset: 90 мин при ёмкости 100 → дни 0/1/2');
    var two = [C('A', { wm: 40 }), C('B', { wm: 40 })];
    eq([0, 1].map(function (i) { return P.prefixDayOffset(two, i, ctx); }), [0, 0],
        '#4085 prefixDayOffset: 40+40 < 100 → обе в день 0');
    // пропуск нерабочего дня 1
    var off = { capacityMin: 100, times: ZERO, machineDayOff: function (d) { return d === 1; } };
    eq([0, 1].map(function (i) { return P.prefixDayOffset(slots, i, off); }), [0, 2],
        '#4085 prefixDayOffset: нерабочий день 1 пропущен → второй слот в день 2');
    // отпуск-слот в середине толкает следующий за свой день
    var withVac = [C('A', { wm: 90 }), P.vacationSlot('m1', 2), C('B', { wm: 90 })];
    assert(P.prefixDayOffset(withVac, 2, ctx) === 3, '#4085 prefixDayOffset: слот после отпуска (день2) → день 3');
})();

// ── canInsertAt: нельзя между частями одной цепочки ─────────────────────────────────────────────
(function () {
    var arr = [C('H', { fp: 'H' }), C('H2', { fp: 'H' }), C('Z')];   // H,H2 — одна цепочка
    assert(P.canInsertAt(arr, 1) === false, '#4085 canInsertAt: между H и H2 (общий firstPartId) — нельзя');
    assert(P.canInsertAt(arr, 2) === true, '#4085 canInsertAt: между H2 и Z — можно');
    assert(P.canInsertAt(arr, 0) === true && P.canInsertAt(arr, 3) === true, '#4085 canInsertAt: по краям — можно');
})();

// ── scorePosition: стоимость вставки, срок как локальный штраф ───────────────────────────────────
(function () {
    var arr = [C('A', { mat: 'M1' })];
    var base = new Date(2026, 6, 1).getTime();
    var ctx = { settings: {}, capacityMin: 450, times: ZERO, perPass: 30, baseMidnightMs: base };
    // тот же материал рядом с A → вес 0
    var same = P.scorePosition(arr, 1, C('B', { mat: 'M1' }), ctx);
    assert(same.weight === 0, '#4085 scorePosition: тот же материал рядом → вес 0');
    // другой материал → вес 15
    var diff = P.scorePosition(arr, 1, C('B', { mat: 'M2' }), ctx);
    assert(diff.weight === 15, '#4085 scorePosition: другой материал → MATERIAL_CHANGE 15');
    // срок: слот со сроком РАНЬШЕ дня приземления → +DEADLINE 100. День приземления слота на m1 —
    // нагрузим m1 так, чтобы слот лёг в день 1 (> срока day0).
    var loaded = [C('A', { mat: 'M1', wm: 450 })];   // A занимает весь день 0
    var late = P.scorePosition(loaded, 1, C('B', { mat: 'M1', wm: 90, due: 20260701 }), ctx);
    assert(late.dayOffset === 1 && late.weight === 100,
        '#4085 scorePosition: слот лёг в день 1 > срока (01.07=day0) → DEADLINE 100 (день ' + late.dayOffset + ', вес ' + late.weight + ')');
    // нельзя в цепочку → null
    var chain = [C('H', { fp: 'H' }), C('H2', { fp: 'H' })];
    assert(P.scorePosition(chain, 1, C('B'), ctx) === null, '#4085 scorePosition: позиция внутри цепочки → null');
})();

// ── placeSlot/placeAllSlots: перебор по всем станкам, группировка, порядок ───────────────────────
(function () {
    var ctx = { settings: {}, capacityMin: 450, times: ZERO, perPass: 30 };
    // 3 резки одного сырья → на один станок, ВХОДНОЙ порядок сохранён (append при равной цене)
    var occ = P.seedOccupancy([], [], ['m1', 'm2']);
    P.placeAllSlots(occ, [C('A'), C('B'), C('D')], ctx);
    eq(P.slotOrderByMachine(occ).m1, ['A', 'B', 'D'], '#4085 placeAllSlots: одинаковое сырьё группируется на m1 в порядке входа');
    // §8.4-исключение: сырьё запрещено на m1 (feasibleMachine) → уходит на m2
    var occ2 = P.seedOccupancy([C('A', { m: 'm1', mat: 'M1' })], [], ['m1', 'm2']);
    var ctxF = { settings: {}, capacityMin: 450, times: ZERO, perPass: 30,
        feasibleMachine: function (sid, slot) { return !(sid === 'm1' && slot.materialId === 'BAD'); } };
    P.placeSlot(occ2, C('N', { mat: 'BAD' }), ctxF);
    assert(P.slotOrderByMachine(occ2).m1.indexOf('N') === -1 && P.slotOrderByMachine(occ2).m2.indexOf('N') === 0,
        '#4085 placeSlot: стоп-лист сырья на m1 → слот уходит на m2');
})();

// ── relocatePass: нефольга после фольги в дне → релокация на более дешёвый станок ────────────────
(function () {
    var ctx = { settings: {}, capacityMin: 450, times: ZERO, perPass: 30 };
    // m1: [F(фольга, сырьё M1), B(нефольга, сырьё M2)] день 0 оба; B стоит ПОСЛЕ фольги F.
    // На m2 пусто → B там дешевле (нет перехода F→B на 15) даже с CHANGE_SLITTER 3.
    var occ = P.seedOccupancy([C('F', { m: 'm1', mat: 'M1', foil: true }), C('B', { m: 'm1', mat: 'M2' })], [], ['m1', 'm2']);
    var dayByCut = { F: 0, B: 0 };
    var res = P.relocatePass(occ, dayByCut, ctx);
    assert(res.moves.length >= 1 && res.moves.some(function (m) { return m.id === 'B' && m.to === 'm2'; }),
        '#4085 relocatePass: B (нефольга после фольги) перенесён на m2 (дешевле)');
    // стабильность: одинаковое сырьё на своих местах, ничего не двигать
    var occ3 = P.seedOccupancy([C('A', { m: 'm1', mat: 'M1' }), C('B', { m: 'm1', mat: 'M1' })], [], ['m1', 'm2']);
    var res3 = P.relocatePass(occ3, { A: 0, B: 0 }, ctx);
    eq(res3.moves, [], '#4085 relocatePass: нет триггеров (нет фольги/просрочки) → без перемещений');
})();

console.log('\n' + passed + '/' + total + ' passed');
