// #4512 — 🔒 НЕ ВЫКИДЫВАЮТ РАДИ РАЗМЕЩЕНИЯ НЕЗАФИКСИРОВАННОГО ЗАДАНИЯ.
//
// СИМПТОМ (боевой): оператор переносит задание в день — и зафиксированные задания этого дня
// уезжают на следующий. Причём впустую: на освободившееся место перенесённое даже не встаёт.
// В цифрах теста: день с двумя 🔒 (165 + 165 из 460) после ручного переноса свободного задания
// оставался с ОДНОЙ 🔒 и дырой в 295 минут, а перенесённое уезжало вслед за вытесненной.
//
// КОРЕНЬ. #4488 («задание ручного переноса встаёт в день ЦЕЛИКОМ») резервирует его занятость в
// целевом дне — `wholeReserve` внутри `availFor`. Резерв вычитался из ёмкости у ВСЕХ соседей
// подряд, включая 🔒: у зафиксированной «не влезает ни одного прохода» → срабатывала ветка #4467
// и увозила её. То есть СВОБОДНОЕ задание отбирало место у ЗАМКА — при том что замок сильнее.
//
// ПРАВИЛО (блокер). Резерв чужого задания не отнимает ёмкость у 🔒 этого дня: место уступают
// только свободные соседи — ровно то, что #4488 и задумывал («сначала незафиксированные»).
//
// ЧЕГО ЗДЕСЬ НЕТ (сознательно, решение заказчика 30.07.2026). Лестница #4467 не тронута: когда
// день переполнен ПО-НАСТОЯЩЕМУ (сумма самих 🔒 больше смены), она по-прежнему может увезти 🔒.
// Этот случай зафиксирован тестом «пока так» — чтобы смена поведения не прошла незамеченной.
//
// Run with: node experiments/atex-pp-4512-fixed-never-evicted.test.js

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
var DAY_START = 480, CAP = 450;                  // окно смены 08:00–15:30
var OVER_CUTS = 5, OVER_TUNE = 10, CEILING = CAP + OVER_TUNE;
function W(w, n) { var a = []; for (var i = 0; i < n; i++) a.push(w); return a; }
function cut(id, mat, knives, runs, perPass, fixedDay) {
    return { id: id, materialId: mat, winding: 'OUT', batchId: 'B' + mat,
             knifeWidths: W(knives[0], knives[1]), knifeCount: knives[1], rollerWidth: 0,
             plannedRuns: runs, isFoil: false, fixed: fixedDay != null, firstPartId: id,
             _perPass: perPass, _fixedDay: fixedDay };
}
function pack(cuts, opts) {
    var perPass = {}, runs = {}, anchor = {};
    cuts.forEach(function (c) {
        perPass[String(c.id)] = c._perPass; runs[String(c.id)] = c.plannedRuns;
        if (c._fixedDay != null) anchor[String(c.id)] = c._fixedDay;
    });
    return P.splitMachineQueue(cuts, Object.assign({
        dayStartMin: DAY_START, dayEndMin: DAY_START + CAP, dayEndHourMin: DAY_START + CAP,
        maxOverworkCutsMin: OVER_CUTS, maxOverworkTuneMin: OVER_TUNE,
        times: TIMES, perPassByCut: perPass, runsByCut: runs, dayAnchorByCut: anchor,
        gapFill: true, orderAuthoritative: true, firstCutSetup: true
    }, opts || {}));
}
function daysOf(segs, id) {
    return segs.filter(function (s) { return String(s.cutId) === String(id); })
        .map(function (s) { return Number(s.dayOffset); }).sort(function (a, b) { return a - b; });
}
function loadByDay(segs) {
    var out = {};
    segs.forEach(function (s) {
        var d = Number(s.dayOffset);
        out[d] = (out[d] || 0) + (Number(s.setupMin) || 0) + (Number(s.durationMin) || 0);
    });
    return out;
}
function orderOfDay(segs, d) {
    return segs.filter(function (s) { return Number(s.dayOffset) === d; })
        .sort(function (a, b) { return a.windowStartMin - b.windowStartMin; })
        .map(function (s) { return String(s.cutId); });
}
// День 0: две 🔒 по одному проходу 120 мин — 165 + 165 = 330 из 460, помещаются с запасом.
function twoFixed() {
    return [cut('F1', 'MA', [30, 29], 1, 120, 0), cut('F2', 'MB', [60, 15], 1, 120, 0)];
}
var FREE = cut('X', 'MC', [150, 7], 1, 200, null);       // свободное: 200 мин + наладка 45

// ── 0. Контроль: без переносов обе 🔒 стоя́т в своём дне ──────────────────────────────────
(function () {
    var segs = pack(twoFixed());
    assert(orderOfDay(segs, 0).join(',') === 'F1,F2', 'обе 🔒 в дне 0',
        '(' + orderOfDay(segs, 0).join(' → ') + ', ' + Math.round(loadByDay(segs)[0]) + ' мин)');
})();

// ── 1. ГЛАВНОЕ: ручной перенос СВОБОДНОГО задания не выкидывает 🔒 ────────────────────────
(function () {
    var segs = pack(twoFixed().concat([FREE]), { wholeDayByCut: { X: 0 } });
    assert(daysOf(segs, 'F1').join(',') === '0' && daysOf(segs, 'F2').join(',') === '0',
        'обе 🔒 остались в своём дне при переносе свободного задания',
        '(F1 → день ' + daysOf(segs, 'F1').join('/') + ', F2 → день ' + daysOf(segs, 'F2').join('/') + ')');
    assert(orderOfDay(segs, 0).slice(0, 2).join(',') === 'F1,F2', 'порядок 🔒 в дне не изменился (#4464)',
        '(' + orderOfDay(segs, 0).join(' → ') + ')');
    assert((loadByDay(segs)[0] || 0) >= 330, 'дыры в дне не осталось: 🔒 держат свои минуты',
        '(' + Math.round(loadByDay(segs)[0] || 0) + ' мин)');
    assert((loadByDay(segs)[0] || 0) <= CEILING + 1e-6, 'при этом день не разбух',
        '(' + Math.round(loadByDay(segs)[0] || 0) + ' при потолке ' + CEILING + ')');
})();

// ── 2. То же, когда перестановки §8 поставили свободное задание ПЕРВЫМ в очереди дня ──────
(function () {
    var segs = pack([FREE].concat(twoFixed()), { wholeDayByCut: { X: 0 } });
    assert(daysOf(segs, 'F1').join(',') === '0' && daysOf(segs, 'F2').join(',') === '0',
        '🔒 не уступают место, даже если свободное идёт первым',
        '(день 0: ' + orderOfDay(segs, 0).join(' → ') + ')');
})();

// ── 3. Ручной перенос = обычная раскладка: результат тот же, что без резерва ──────────────
// Резерв #4488 больше не меняет судьбу 🔒 — сравниваем перенос и его отсутствие.
(function () {
    var withMove = pack(twoFixed().concat([FREE]), { wholeDayByCut: { X: 0 } });
    var noMove = pack(twoFixed().concat([FREE]));
    assert(JSON.stringify(loadByDay(withMove)) === JSON.stringify(loadByDay(noMove)),
        'нагрузка дней совпала с раскладкой без ручного переноса',
        '(перенос ' + JSON.stringify(loadByDay(withMove)) + ' vs без ' + JSON.stringify(loadByDay(noMove)) + ')');
})();

// ── 4. Резерв по-прежнему работает против СВОБОДНЫХ соседей (#4488 цел) ───────────────────
// Свободные Y и Z (по 150 мин) + ручной перенос X (200 мин): место под X резервируется, и
// свободный сосед Z уступает — уезжает на следующий день. Именно это #4488 и делал; блокер
// #4512 снял резерв ТОЛЬКО против 🔒.
// (Сам день перенесённого задания на этом уровне не проверяем: в `splitMachineQueue` у
// незафиксированного задания якоря дня нет — день ему держит слой размещения, pin/замок дня.)
(function () {
    var segs = pack([cut('Y', 'MA', [30, 29], 1, 150, null),
                     cut('Z', 'MB', [60, 15], 1, 150, null),
                     cut('X', 'MC', [150, 7], 1, 200, null)], { wholeDayByCut: { X: 0 } });
    var noReserve = pack([cut('Y', 'MA', [30, 29], 1, 150, null),
                          cut('Z', 'MB', [60, 15], 1, 150, null),
                          cut('X', 'MC', [150, 7], 1, 200, null)]);
    // Считаем по проходам: в дне-доноре у вытесненного соседа может остаться «настройка» (0 проходов).
    function passDay(segs, id) {
        var s = segs.filter(function (x) { return String(x.cutId) === id && Number(x.runs) > 0; })[0];
        return s ? Number(s.dayOffset) : null;
    }
    assert(passDay(segs, 'Z') === 1 && passDay(noReserve, 'Z') === 0,
        'резерв переноса вытесняет СВОБОДНОГО соседа из дня (а без резерва тот стои́т)',
        '(с резервом Z → день ' + passDay(segs, 'Z') + '; без резерва Z → день ' + passDay(noReserve, 'Z') + ')');
})();

// ── 5. Ручной перенос ЗАФИКСИРОВАННОГО задания: резерв как прежде ─────────────────────────
(function () {
    var segs = pack([cut('F1', 'MA', [30, 29], 1, 120, 0),
                     cut('M', 'MC', [150, 7], 1, 200, 0)], { wholeDayByCut: { M: 0 } });
    assert(daysOf(segs, 'M').join(',') === '0' && daysOf(segs, 'F1').join(',') === '0',
        'перенесённая 🔒 и соседняя 🔒 обе в дне 0',
        '(день 0: ' + orderOfDay(segs, 0).join(' → ') + ')');
})();

// ── 6. ЛЕСТНИЦА #4467 СНЯТА — 🔒 не уезжает даже при РЕАЛЬНОМ переполнении ─────────────────
// Здесь стояла заглушка «ПОКА ТАК: реальное переполнение дня всё ещё увозит 🔒»: #4514 закрыл
// только вытеснение РЕЗЕРВОМ, а последнюю ступень лестницы #4467 («когда незафиксированных нет —
// и 🔒») оставил. Заглушка требовала решения — решение получено: #4512, приёмка тикета, «у 🔒
// снимается ветка „уезжает целиком на следующий день“; остаётся разрыв по потолку (#4304)».
// Заказчик подтвердил и следствие: день, набитый одними 🔒, ОСТАНЕТСЯ за потолком — это видимый
// факт (бейдж минут), а не повод сдвинуть замок.
//
// День переполнен САМИМИ 🔒: три по 200 мин при потолке 460. Все три обязаны остаться в дне 0.
(function () {
    var segs = pack([cut('F1', 'MA', [30, 29], 1, 200, 0),
                     cut('F2', 'MB', [60, 15], 1, 200, 0),
                     cut('F3', 'MC', [150, 7], 1, 200, 0)]);
    var load = loadByDay(segs);
    assert(daysOf(segs, 'F1').indexOf(0) !== -1 && daysOf(segs, 'F2').indexOf(0) !== -1
           && daysOf(segs, 'F3').indexOf(0) !== -1,
        '🔒 остаются в своём дне и при РЕАЛЬНОМ переполнении (лестница #4467 снята)',
        '(F1 → ' + daysOf(segs, 'F1').join('/') + ', F2 → ' + daysOf(segs, 'F2').join('/')
        + ', F3 → ' + daysOf(segs, 'F3').join('/') + ')');
    assert(load[0] > CEILING,
        'день 0 ЗАКОННО ушёл за потолок — вместил неснимаемые 🔒 (#4512)',
        '(' + Math.round(load[0]) + ' при потолке ' + CEILING + ')');
})();

console.log('\n' + passed + '/' + total + ' passed');
if (passed !== total) process.exitCode = 1;
