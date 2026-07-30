// #4510 (ТЗ §8.1) — ЦЕНА МЕСТА = НАСКОЛЬКО ДОРОЖЕ СТАНЕТ ОЧЕРЕДЬ (честная разница).
//
// СИМПТОМ (issue #4510, боевой лог, сборка ?118.94): задание `MWR400L 33 x 300 IN` (32.5мм × 27
// полос) перенесли в день 30.07 — оно встало ПЕРВЫМ в дне, хотя в этом же дне стои́т задание с ТОЙ
// ЖЕ комбинацией ножей `MR194 33 x 600 OUT` (32.5мм × 27). Трасса:
//     ── задание 651567 … рассмотрено вариантов 42 ──   (ни одной недопустимой: #4508 работает)
//        ВЫБРАН: поз 0 → вес 125 (knife +95, material +30)
//        альтернатива 1 (Δ +9): поз 23 → вес 134 …
// То есть место рядом со «своими ножами» перебор ВИДЕЛ и всё равно оценил дороже головы дня.
//
// ПРИЧИНА. Вес места складывался из ДВУХ переходов (prev→slot и slot→next) и НЕ возвращал
// стоимость разрушенного перехода prev→next. Поэтому «встать в готовый шов, где переналадка уже
// оплачена» и «разорвать однородную цепочку» стоили почти одинаково, а соседство со своими ножами
// сверх того наказывалось штрафом разрыва цепочки СЫРЬЯ (`BREAK_MATERIAL`): у близнеца по ножам
// соседи одного сырья, и приезжее задание их «разрывает». Итог: реальные минуты наладки говорили
// «рядом с близнецом +30 мин», а вес говорил «в чужой шов дешевле».
//
// ПРАВИЛО (ТЗ §8.1): вес места — это РАЗНИЦА `цена(prev→slot) + цена(slot→next) − цена(prev→next)`,
// то есть НА СКОЛЬКО ДОРОЖЕ станет очередь от вставки. Разрыв однородной цепочки тогда стои́т ровно
// вдвое дороже готового шва САМ ПО СЕБЕ — отдельные веса `BREAK_*` не нужны.
//
// Что проверяем:
//   A — вес места совпадает с РЕАЛЬНЫМИ добавленными минутами наладки (changeoverCost);
//   B — перенесённое «по весу» садится ВПЛОТНУЮ к своим ножам, а не в голову дня (issue #4510);
//   C — разрыв однородной цепочки дороже готового шва вдвое (инвариант #4454 цел);
//   D — стык дней: чужое задание не садится первым в день перед продолжением заправки (#4454/#4459);
//   E — дописывание в конец очереди зачёта не получает (разрушать нечего).
//
// Run with: node experiments/atex-pp-4510-marginal-seam-cost.test.js

process.env.TZ = 'UTC';
global.window = { db: 'ateh1', xsrf: 'x' };
var P = require('../download/atex/js/production-planning.js').planning;

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

var TIMES = { KNIFE: 30, KNIFE_MOVE: 2, MATERIAL_WINDING: 15, BETWEEN_CUTS: 0 };
// Веса «Настройки» из боевой трассы #4510.
var W = { KNIVES_CHANGE_COST_MN: 30, KNIVES_INCREASE_COST_MN: 35, MATERIAL_CHANGE_COST_MN: 15,
          LEADER_COST_MN: 2, DEADLINE_COST_MN: 200, EXACT_DEADLINE_COST_MN: 9,
          FOIL_NOTEND_COST_MN: 80, MAX_DISTANCE_COST_MN: 10, ORDER_DIFF_PENALTY_MN: 12 };
var BASE = new Date(2026, 6, 30).getTime();
var TS0 = Math.floor(BASE / 1000) + 8 * 3600;   // 30.07.2026 08:00 — начало дня 0
function K(w, n) { var a = []; for (var i = 0; i < n; i++) a.push(w); return a; }

function S(id, o) {
    o = o || {};
    var kw = o.kw;
    var s = P.slotFromCut({ id: id, slitter: { id: '1282' }, materialId: o.mat, winding: o.wind || 'OUT',
        batchId: '', knifeWidths: kw, knifeCount: kw.length, rollerWidth: 0, plannedRuns: 1,
        isFoil: false, fixed: o.fixed !== false, planDate: String(TS0 + (o.ts || 0) * 60) });
    s.workMin = o.wm;
    if (o.manual) s.manualMove = true;
    if (o.lockDay != null) { s.lockDay = o.lockDay; s.lockSlitter = '1282'; }
    return s;
}

// День 30.07 из скриншота #4510: пять заданий на ножах 30 мм, затем БЛИЗНЕЦ по ножам (32.5×27),
// затем снова 30 мм и другие конфигурации. Всё — 🔒 (день-стена, как на боевой).
function day() {
    return [
        S('A', { mat: 'MW411', kw: K(30, 29), wm: 19, ts: 0 }),
        S('B', { mat: 'MR194', kw: K(30, 29), wm: 19, ts: 60 }),
        S('C', { mat: 'MR194', kw: K(30, 29), wm: 4, ts: 90 }),
        S('D', { mat: 'MR194', kw: K(30, 29), wm: 4, ts: 100 }),
        S('E', { mat: 'MR194', kw: K(30, 29), wm: 7, ts: 110 }),
        S('TWIN', { mat: 'MR194', kw: K(32.5, 27), wm: 42, ts: 130 }),   // «ножи 33» — близнец
        S('G', { mat: 'MR194', kw: K(30, 29), wm: 40, ts: 200 }),
        S('H', { mat: 'MW411', kw: K(60, 14), wm: 60, ts: 250 }),
        S('I', { mat: 'MW308', kw: K(110, 8), wm: 60, ts: 320 })
    ];
}
// Перенесённое: ТЕ ЖЕ ножи, что у близнеца, но другое сырьё и намотка.
function moved(o) {
    o = o || {};
    var opt = { mat: 'MWR400L', kw: K(32.5, 27), wind: 'IN', wm: 5, ts: -60, fixed: false };
    Object.keys(o).forEach(function (k) { opt[k] = o[k]; });
    return S('X', opt);
}
// Заправка станка (хвост 29.07): чужое сырьё и чужие ножи.
var CARRY = { '1282': { materialId: 'MR192', winding: 'OUT', knifeWidths: K(40, 28) } };
var CTX = { settings: W, times: TIMES, capacityMin: 450, perPass: 0, baseMidnightMs: BASE,
            slitterId: '1282', prevSetupBySlitter: CARRY };

// РЕАЛЬНЫЕ добавленные минуты наладки от вставки slot между prev и next (мерка оператора).
function realAddedMin(prev, slot, next) {
    var a = prev ? P.changeoverCost(prev, slot, TIMES) : 0;
    var b = next ? P.changeoverCost(slot, next, TIMES) : 0;
    var was = (prev && next) ? P.changeoverCost(prev, next, TIMES) : 0;
    return a + b - was;
}
// Ожидаемый вес §8: разница весов переходов (тот же набор факторов, что у scorePosition).
function marginalWeight(prev, slot, next) {
    var w = { settings: W };
    var a = prev ? P.transitionCost(prev, slot, w).weight : 0;
    var b = next ? P.transitionCost(slot, next, w).weight : 0;
    var was = (prev && next) ? P.transitionCost(prev, next, w).weight : 0;
    return Math.round((a + b - was) * 1000) / 1000;
}

// ── A. Вес места = честная разница переходов, и порядок мест = порядок реальных минут ────────
(function () {
    var arr = day(), X = moved({ manual: true });
    var ok = true, detail = [];
    for (var i = 1; i < arr.length; i++) {   // i=0 — стык с заправкой, проверяется в D
        var sc = P.scorePosition(arr, i, X, CTX);
        var exp = marginalWeight(arr[i - 1], X, arr[i]);
        if (Math.round(sc.weight) !== Math.round(exp)) { ok = false; detail.push(i + ': вес ' + sc.weight + ' ≠ ' + exp); }
    }
    assert(ok, 'A1 вес каждой точки = цена(prev→slot)+цена(slot→next)−цена(prev→next) (ТЗ §8.1)', detail.join('; '));
    // Мерка оператора: самое дешёвое по весу место — оно же самое дешёвое по реальным минутам.
    var bestW = null, bestR = null;
    for (var j = 1; j < arr.length; j++) {
        var w = P.scorePosition(arr, j, X, CTX).weight, r = realAddedMin(arr[j - 1], X, arr[j]);
        if (!bestW || w < bestW.w) bestW = { i: j, w: w };
        if (!bestR || r < bestR.r) bestR = { i: j, r: r };
    }
    assert(realAddedMin(arr[bestW.i - 1], X, arr[bestW.i]) === bestR.r,
        'A2 самое дешёвое по весу место = самое дешёвое по РЕАЛЬНЫМ минутам наладки',
        '(вес выбрал поз ' + bestW.i + ' → ' + realAddedMin(arr[bestW.i - 1], X, arr[bestW.i])
        + ' мин; минимум минут ' + bestR.r + ' на поз ' + bestR.i + ')');
})();

// ── B. Перенесённое садится к своим ножам, а не в голову дня ─────────────────────────────────
(function () {
    var arr = day();
    var iTwin = 5;
    var atTwinBefore = P.scorePosition(arr, iTwin, moved({ manual: true }), CTX);       // E | TWIN
    var atTwinAfter = P.scorePosition(arr, iTwin + 1, moved({ manual: true }), CTX);    // TWIN | G
    var atHead = P.scorePosition(arr, 0, moved({ manual: true }), CTX);
    assert(atTwinBefore.weight < atHead.weight && atTwinAfter.weight < atHead.weight,
        'B1 место у близнеца по ножам дешевле головы дня',
        '(перед ' + atTwinBefore.weight + ', после ' + atTwinAfter.weight + ', голова ' + atHead.weight + ')');

    var occ = P.seedOccupancy(day(), [], ['1282']);
    var best = P.placeSlot(occ, moved({ manual: true, lockDay: 0 }), CTX);
    var order = occ.byMachine['1282'].map(function (s) { return String(s.id); });
    var iX = order.indexOf('X'), iT = order.indexOf('TWIN');
    assert(best && Math.abs(iX - iT) === 1,
        'B2 перебор всех точек: перенесённое встало ВПЛОТНУЮ к своим ножам', '(' + order.join(' → ') + ')');
    assert(iX !== 0, 'B3 и это не голова дня (issue #4510)', '(' + order.join(' → ') + ')');
    // Смысл «встало по ножам»: стык с близнецом не требует переставлять ножи.
    var neighbour = occ.byMachine['1282'][iX < iT ? iX + 1 : iX - 1];
    var seam = iX < iT ? P.changeoverParts(occ.byMachine['1282'][iX], neighbour, TIMES)
                       : P.changeoverParts(neighbour, occ.byMachine['1282'][iX], TIMES);
    assert(!seam.some(function (p) { return p.code === 'KNIFE'; }),
        'B4 стык с близнецом не стои́т смены ножей — только смена сырья',
        '(' + seam.map(function (p) { return p.code + ' ' + p.minutes; }).join(', ') + ')');
})();

// ── C. Разрыв однородной цепочки дороже готового шва вдвое (инвариант #4454) ─────────────────
(function () {
    // Цепочка: три задания одной конфигурации подряд; вставляем чужое ВНУТРЬ и в ГОТОВЫЙ ШОВ.
    var chain = [
        S('P1', { mat: 'MR194', kw: K(30, 29), wm: 30, ts: 0 }),
        S('P2', { mat: 'MR194', kw: K(30, 29), wm: 30, ts: 60 }),
        S('P3', { mat: 'MR194', kw: K(30, 29), wm: 30, ts: 120 }),
        S('Q1', { mat: 'MW308', kw: K(110, 8), wm: 30, ts: 180 }),   // шов P3|Q1 уже оплачен
        S('Q2', { mat: 'MW308', kw: K(110, 8), wm: 30, ts: 240 })
    ];
    var alien = S('Z', { mat: 'MWR400L', kw: K(60, 14), wind: 'IN', wm: 20, ts: -60, fixed: false, manual: true });
    var inChain = P.scorePosition(chain, 2, alien, CTX);   // между P2 и P3 — однородно
    var inSeam = P.scorePosition(chain, 3, alien, CTX);    // между P3 и Q1 — готовый шов
    assert(inChain.weight >= 2 * inSeam.weight,
        'C1 разрыв однородной цепочки минимум ВДВОЕ дороже готового шва (инвариант #4454)',
        '(цепочка ' + inChain.weight + ', шов ' + inSeam.weight + ')');
    assert(Math.round(inChain.weight) === Math.round(marginalWeight(chain[1], alien, chain[2]))
        && Math.round(inSeam.weight) === Math.round(marginalWeight(chain[2], alien, chain[3])),
        'C2 обе цены — та же честная разница, без отдельных весов BREAK_*',
        '(цепочка ' + inChain.weight + ', шов ' + inSeam.weight + ')');
})();

// ── D. Стык дней: начало дня не бесплатная щель (#4454/#4459) ────────────────────────────────
(function () {
    var alien = S('Z', { mat: 'MWR400L', kw: K(60, 14), wind: 'IN', wm: 20, ts: -60, fixed: false, manual: true });
    // (а) Первое задание дня ПРОДОЛЖАЕТ заправку станка → разрушать нечего, зачёта нет.
    var cont = [
        S('F1', { mat: 'MR192', kw: K(40, 28), wm: 40, ts: 0 }),   // = заправка CARRY
        S('F2', { mat: 'MR192', kw: K(40, 28), wm: 40, ts: 60 })
    ];
    var head = P.scorePosition(cont, 0, alien, CTX);
    var tail = P.scorePosition(cont, 2, alien, CTX);
    assert(head.weight > tail.weight,
        'D1 вклиниться перед продолжением заправки дороже, чем дописать в конец',
        '(голова ' + head.weight + ', конец ' + tail.weight + ')');
    // (б) Первое задание дня заправку НЕ продолжает → шов уже оплачен, зачёт есть.
    var seam = [
        S('F1', { mat: 'MW308', kw: K(110, 8), wm: 40, ts: 0 }),   // ≠ заправка CARRY
        S('F2', { mat: 'MW308', kw: K(110, 8), wm: 40, ts: 60 })
    ];
    var headSeam = P.scorePosition(seam, 0, alien, CTX);
    assert(headSeam.weight < head.weight,
        'D2 голова дня с ГОТОВЫМ швом дешевле головы дня, разрывающей продолжение заправки',
        '(шов ' + headSeam.weight + ', продолжение ' + head.weight + ')');
})();

// ── E. Дописывание в конец: разрушать нечего, зачёта нет ─────────────────────────────────────
(function () {
    var arr = day(), X = moved({ manual: true });
    var end = P.scorePosition(arr, arr.length, X, CTX);
    assert(Math.round(end.weight) === Math.round(marginalWeight(arr[arr.length - 1], X, null)),
        'E1 в конце очереди вес = один переход, зачёта нет', '(вес ' + end.weight + ')');
})();

console.log('\n' + passed + '/' + total + ' passed');
