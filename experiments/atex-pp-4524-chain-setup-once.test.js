// #4524 (ТЗ §15) — НАЛАДКА РАЗОРВАННОГО ПО ДНЯМ ЗАДАНИЯ ПЛАТИТСЯ ОДИН РАЗ.
//
// СИМПТОМ (issue #4524). По «Сгенерировать» задание 04.08 08:00 (MWR200, 12 ножей, продолжение
// вчерашней цепочки) получило бейдж «НАЛАДКА» и подсказку «Расхождение с текущим порядком заданий:
// наладка ножей 0 → 30 мин», хотя в дне 03.08 прямо перед ним стои́т setup-only хвост той же
// цепочки — «Настройка ножей и сырья · 16:03–16:33 · 30 мин, ножей: 12». Ножи те же, станок как
// настроили вечером, так он и стои́т утром: 30 минут просят ВТОРОЙ раз.
//
// ПРИЧИНА КЛАССА. «Нужна ли переналадка» спрашивают ПЯТЬ потребителей — упаковщик, колонки
// (`computeCutSetupUpdates`), детектор «↻ Пересчитать наладку», панель качества и слой размещения —
// и каждый выводил ответ сам, из своих входов. Перебор конфигураций одного и того же стыка дней дал
// «0 → 30» пятью РАЗНЫМИ способами: пустые `knifeWidths` у любого из звеньев, более широкий ролик у
// хвоста, чужая резка между звеньями, звенья на разных станках, хвост без хранимых колонок.
//
// ПРАВИЛО (ТЗ §15): звенья одной цепочки дробления (общий «ID первой части») — это ОДНО задание,
// разрезанное потолком смены. Переналадки между ними не бывает по построению, а сумма наладки по
// цепочке равна ОДНОЙ смене ножей и ОДНОЙ смене сырья.
//
// Что проверяем:
//   A — ответ ОДИН: `changeoverParts` не берёт переналадку между звеньями цепочки, какими бы
//       кривыми ни были входы (пустые ширины, ролик, порядок ширин);
//   B — правило не расползлось: РАЗНЫЕ задания той же конфигурации переналадку платят как раньше,
//       длинный отпуск наладку по-прежнему сбрасывает;
//   C — детектор «↻ Пересчитать наладку» больше не просит вторую наладку у продолжения;
//   D — храповик: правило CHAIN_SETUP_ONCE в реестре §15 ловит двойную наладку на ВСЕХ входах
//       записи (шлюз guardPlanOps), режим — audit.
//
// Run with: node experiments/atex-pp-4524-chain-setup-once.test.js

process.env.TZ = 'Europe/Moscow';
global.window = { db: 'ateh1', xsrf: 'x' };
var api = require('../download/atex/js/production-planning.js');
var P = api.planning;

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

var TIMES = { KNIFE: 30, MATERIAL_WINDING: 15, BETWEEN_CUTS: 0 };
function K(w, n) { var a = []; for (var i = 0; i < n; i++) a.push(w); return a; }
var KW12 = [110].concat(K(70, 11));
function cut(id, o) {
    o = o || {};
    return { id: String(id), firstPartId: o.fp === null ? '' : String(o.fp || id),
             materialId: String(o.matId || '200'), materialName: o.mat || 'MWR200', winding: o.wind || 'OUT',
             knifeWidths: o.kw || KW12, knifeCount: (o.kw || KW12).length, rollerWidth: o.rw || 0,
             plannedRuns: o.runs == null ? 11 : o.runs };
}
function codes(prev, next) {
    return P.changeoverParts(prev, next, TIMES).map(function (p) { return p.code; }).join('+') || '—';
}

// ── A. Между звеньями цепочки переналадки нет — при любых входах ─────────────────────────────
(function () {
    var tail = cut('n6', { runs: 0 });                    // setup-only хвост дня 03.08
    var cont = cut('n1', { fp: 'n6' });                   // продолжение 04.08
    assert(codes(tail, cont) === '—', 'A1 хвост → продолжение: переналадки нет', '(' + codes(tail, cont) + ')');

    var contNoWidths = cut('n1', { fp: 'n6' }); contNoWidths.knifeWidths = [];
    assert(codes(tail, contNoWidths) === '—',
        'A2 пустые ширины полос у продолжения правило не ломают', '(' + codes(tail, contNoWidths) + ')');
    var tailNoWidths = cut('n6', { runs: 0 }); tailNoWidths.knifeWidths = [];
    assert(codes(tailNoWidths, cont) === '—',
        'A3 пустые ширины полос у хвоста — тоже', '(' + codes(tailNoWidths, cont) + ')');

    var tailWide = cut('n6', { runs: 0, rw: 110 }), contNarrow = cut('n1', { fp: 'n6', rw: 70 });
    assert(codes(tailWide, contNarrow) === '—',
        'A4 «сужение ролика» внутри цепочки — не смена ножей', '(' + codes(tailWide, contNarrow) + ')');

    var contOrder = cut('n1', { fp: 'n6', kw: K(70, 11).concat([110]) });
    assert(codes(tail, contOrder) === '—',
        'A5 другой порядок ширин внутри цепочки ничего не меняет', '(' + codes(tail, contOrder) + ')');

    // Голова ↔ продолжение в обе стороны (порядок в очереди задаёт planStart, не наша забота).
    assert(codes(cont, tail) === '—', 'A6 правило симметрично', '(' + codes(cont, tail) + ')');
})();

// ── B. Правило не расползлось на чужие задания ───────────────────────────────────────────────
(function () {
    var a = cut('a', { fp: 'a' }), b = cut('b', { fp: 'b', kw: K(63.5, 14) });
    assert(codes(a, b) === 'KNIFE', 'B1 разные задания с разными ножами — смена ножей как раньше', '(' + codes(a, b) + ')');
    var c = cut('c', { fp: 'c', mat: 'MW308', matId: '308' });
    assert(codes(a, c) === 'MATERIAL_WINDING',
        'B2 разные задания, те же ножи, другое сырьё — смена сырья как раньше', '(' + codes(a, c) + ')');
    // Разные задания ОДНОЙ конфигурации переналадки и раньше не платили — это не про цепочку.
    var d = cut('d', { fp: 'd' });
    assert(codes(a, d) === '—', 'B3 разные задания одной конфигурации — переналадки нет (как и раньше)', '(' + codes(a, d) + ')');
    // Пустой «ID первой части» у обоих: цепочки нет, сравниваем по конфигурации.
    var e = cut('e', { fp: null, kw: K(63.5, 14) }), f = cut('f', { fp: null });
    assert(codes(e, f) === 'KNIFE', 'B4 без маркера цепочки правило не срабатывает', '(' + codes(e, f) + ')');
    // Само с собой (одна и та же запись) — не «звенья», сравнивать нечего.
    assert(codes(cut('x', { fp: 'x' }), cut('x', { fp: 'x', kw: K(63.5, 14) })) === 'KNIFE',
        'B5 одна и та же запись звеном себе не считается');
})();

// ── C. Детектор «↻ Пересчитать наладку» второй наладки не просит ─────────────────────────────
(function () {
    // Очередь станка: 03.08 резка (14 ножей) → setup-only хвост (12 ножей) | 04.08 продолжение.
    function ts(d, h, m) { return Math.floor(new Date(2026, 7, d, h, m, 0).getTime() / 1000); }
    var queue = [
        (function () { var c = cut('n5', { fp: 'n5', kw: K(63.5, 14), runs: 14 }); c.planDate = String(ts(3, 15, 5)); return c; })(),
        (function () { var c = cut('n6', { fp: 'n6', runs: 0 }); c.planDate = String(ts(3, 16, 3)); return c; })(),
        (function () { var c = cut('n1', { fp: 'n6', runs: 11 }); c.planDate = String(ts(4, 8, 0)); return c; })()
    ];
    var cols = P.setupActivityColumns(queue, TIMES, null, {});
    assert(Math.round(cols['n1'].knifeMin) === 0 && Math.round(cols['n1'].materialWindingMin) === 0,
        'C1 продолжению наладка не начисляется — ножи те же с прошлого дня',
        '(ножи ' + cols['n1'].knifeMin + ', сырьё ' + cols['n1'].materialWindingMin + ')');
    assert(Math.round(cols['n6'].knifeMin) === 30,
        'C2 наладку платит ХВОСТ — там, где её и делают', '(' + cols['n6'].knifeMin + ')');
    var sumKnife = Math.round(cols['n6'].knifeMin) + Math.round(cols['n1'].knifeMin);
    assert(sumKnife === TIMES.KNIFE, 'C3 сумма по цепочке = ОДНА смена ножей', '(' + sumKnife + ' мин)');
})();

// ── D. Храповик: правило CHAIN_SETUP_ONCE в реестре §15 ──────────────────────────────────────
(function () {
    var rule = (P.invariants || []).filter(function (r) { return r && r.id === 'CHAIN_SETUP_ONCE'; })[0];
    assert(!!rule, 'D1 правило есть в реестре инвариантов');
    assert(rule && rule.mode === 'audit' && rule.actor === 'any',
        'D2 режим audit (чинится расчётом) и действует на всех', '(' + (rule && rule.mode) + '/' + (rule && rule.actor) + ')');
    var chainOf = { n6: 'n6', n1: 'n6', z: 'z' };
    var ctx = { knifeSetupMin: function () { return 30; }, materialSetupMin: function () { return 15; },
                chainIdOfCut: function (id) { return chainOf[String(id)] || null; } };
    // Двойная наладка по цепочке: хвост 30 + продолжение 30.
    var bad = { updates: [{ cutId: 'n6', planCols: { knife: 30, material: 0, cutTime: 0 } },
                          { cutId: 'n1', planCols: { knife: 30, material: 0, cutTime: 3 } }], creates: [], deletes: [] };
    var v = rule.check(bad, ctx);
    assert(v.length === 1 && v[0].kind === 'knife' && v[0].sumMin === 60,
        'D3 двойную наладку ножей по цепочке правило ловит', '(' + JSON.stringify(v.map(function (x) { return x.kind + ':' + x.sumMin; })) + ')');
    // Честный делёж по потолку: хвост 10 + продолжение 20 = одна смена.
    var ok = { updates: [{ cutId: 'n6', planCols: { knife: 10, material: 0, cutTime: 0 } },
                         { cutId: 'n1', planCols: { knife: 20, material: 0, cutTime: 3 } }], creates: [], deletes: [] };
    assert(rule.check(ok, ctx).length === 0,
        'D4 делёж одной наладки между звеньями нарушением НЕ считается');
    // Одиночное задание платит свою наладку целиком — это не цепочка.
    var single = { updates: [{ cutId: 'z', planCols: { knife: 30, material: 15, cutTime: 20 } }], creates: [], deletes: [] };
    assert(rule.check(single, ctx).length === 0, 'D5 одиночное задание правило не трогает');
    // Нет предикатов/колонок упаковщика → правило молчит (конвенция реестра).
    assert(rule.check(bad, {}).length === 0, 'D6 нет данных — нет обвинений');
    var noCols = { updates: [{ cutId: 'n6' }, { cutId: 'n1' }], creates: [], deletes: [] };
    assert(rule.check(noCols, ctx).length === 0, 'D7 без planCols правило молчит');
    // Смена сырья считается отдельным членом.
    var badMat = { updates: [{ cutId: 'n6', planCols: { knife: 0, material: 15, cutTime: 0 } },
                             { cutId: 'n1', planCols: { knife: 0, material: 15, cutTime: 3 } }], creates: [], deletes: [] };
    var vm = rule.check(badMat, ctx);
    assert(vm.length === 1 && vm[0].kind === 'material' && vm[0].sumMin === 30,
        'D8 двойную смену сырья по цепочке — тоже', '(' + JSON.stringify(vm.map(function (x) { return x.kind + ':' + x.sumMin; })) + ')');
})();

console.log('\n' + passed + '/' + total + ' passed');
