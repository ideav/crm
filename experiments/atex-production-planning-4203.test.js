// #4203 — просрочка ПОСЛЕ рескью #4118: арбитр записал «день N», финал = «день M>N» при СВОБОДНОМ
// станке в срок. Кастомер: «В предыдущие дни полно место … почему пихать в конец дня да ещё после фольги?»
// (реальный 543436: MWR113L IN, срок 03.07=день2, финал Станок1/06.07=день5; Станок3 крутит MWR113L IN
// и имел ~300 своб.мин на 03.07). Причина — СТЕЙЛ best.real: последующий перенос того же раунда
// пере-упаковывает станок-приёмник, и «в срок» уезжает за выходные, а внутреннего цикла relocateOverdueReal
// (maxRounds=3) не хватает. Минимальный синтетический РЕПРО не удался: на простых топологиях арбитр
// НАХОДИТ слот в срок (реальный триггер эмерджентен на 111 резках). Поэтому фикс — ЗАЩИТНЫЙ и монотонный:
//   (1) ВНЕШНИЙ цикл: пере-сеять занятость из АВТОРИТЕТНОГО packAll и повторять рескью, ПОКА остаток за
//       срок СТРОГО убывает (10-planning-engine.js, «#4203 ... ВНЕШНИЙ цикл»);
//   (2) ДИАГНОСТИКА: для каждого оставшегося за сроком — какой день дал бы дозаклад на каждый ДОПУСТИМЫЙ
//       станок (realPackFn), чтобы отличить пропущенный слот (Станок3:день2✓) от истинного дефицита.
// Тесты ниже — РЕГРЕСС-ГАРД (арбитр использует свободный станок, где может) + проверка ДИАГНОСТИКИ (sc7).
globalThis.PP_TRACE_PLACEMENT = (process.env.PP_TRACE === '1');   // PP_TRACE=1 node … чтобы видеть трассу

var mod = require('../download/atex/js/production-planning.js');
var P = mod.planning;

var passed = 0, total = 0;
function assert(cond, name) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}

function midnight(y, m, d) { return new Date(y, m - 1, d, 0, 0, 0, 0).getTime(); }
function ymd(y, m, d) { return y * 10000 + m * 100 + d; }
function scut(id, machine, planOrderTs, opt) {
    opt = opt || {};
    return { id: id, orderId: 'O_' + id, slitter: { id: machine }, materialId: opt.mat || 'A', winding: 'OUT',
             knifeWidths: [50], knifeCount: 1, rollerWidth: 0, plannedRuns: 1, isFoil: !!opt.foil, length: 100,
             planDate: String(planOrderTs), status: '', fixed: false };
}
function dayOf(ops, base, id) {
    var u = (ops.updates || []).filter(function (x) { return String(x.cutId) === String(id); })[0];
    if (!u) return null;
    return Math.floor((Number(u.planStartTs) * 1000 - base) / 86400000);
}
function machineOf(ops, id) {
    var u = (ops.updates || []).filter(function (x) { return String(x.cutId) === String(id); })[0];
    return u ? u.slitterId : undefined;
}
function overdueIds(ops) { return (ops.overdue || []).map(function (o) { return String(o.cutId); }); }

function baseOpts(base, extra) {
    var o = {
        planBaseMidnightMs: base, weights: {}, times: {},
        dayStartMin: 480, dayEndMin: 540, dayEndHourMin: 540, maxOverworkCutsMin: 0, maxOverworkTuneMin: 0,
        lunchStartMin: 0, lunchDurationMin: 0, gapFill: true, preserveOrder: true,
        firstCutSetup: false, prevSetupBySlitter: {}, intraDayResequence: false, slotPlacement: false
    };
    Object.keys(extra || {}).forEach(function (k) { o[k] = extra[k]; });
    return o;
}

// Report a full picture of where each cut landed.
function dump(ops, base, ids) {
    ids.forEach(function (id) {
        console.log('   ' + id + ' → станок ' + machineOf(ops, id) + ', день ' + dayOf(ops, base, id));
    });
    console.log('   overdue: ' + JSON.stringify(ops.overdue));
}

// ── Scenario 1: multi-move congestion. m1 переполнен просроченными; m2 частично занят, есть окно РАНЬШЕ.
// window 60 мин, perPass 25 ⇒ 2 резки/день. m1: A,B,C,D,E,F (все mat A). m2: G (далёкий срок) день0.
(function () {
    var base = midnight(2026, 7, 6);        // Mon, все будни
    var cuts = [];
    // m1: 6 резок по 25 мин ⇒ дни 0,0,1,1,2,2. Сроки затянуты (day0) → C,D,E,F просрочены.
    ['A','B','C','D','E','F'].forEach(function (n, i) { cuts.push(scut(n, 'm1', base + (i + 1))); });
    // m2: одна резка G, далёкий срок, день 0 (25 мин). Остаётся окно на день0 (ещё 25 мин) и дни 1,2 пусты.
    cuts.push(scut('G', 'm2', base + 1));
    var d0 = ymd(2026, 7, 6);
    var far = ymd(2026, 7, 31);
    var due = { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0, G: 25 };
    var dueKey = { A: d0, B: d0, C: d0, D: d0, E: d0, F: d0, G: far };
    var perPass = { A: 25, B: 25, C: 25, D: 25, E: 25, F: 25, G: 25 };
    console.log('\n=== Scenario 1 ===');
    var ops = P.planCutOperations(cuts, baseOpts(base, {
        perPassByCut: perPass, slitterIds: ['m1', 'm2'],
        dueDayByCut: due, dueKeyByCut: dueKey, blockedRangesBySlitter: {}
    }));
    dump(ops, base, ['A','B','C','D','E','F','G']);
})();

// ── Scenario 2: ФОЛЬГА. m1: A,B (далёкие, 25) + X (срок0) ⇒ X→день1 просрочен. m2: только Gf (фольга,
// далёкий срок, 50 мин) день0 ⇒ 10 мин своб. X=25 после фольги НЕ влезает (10<25) → перелив в день1;
// НО перед фольгой X влезает (день0). Проверяем: рескью кладёт X ПЕРЕД фольгой (в срок), а не «после».
(function () {
    var base = midnight(2026, 7, 6);
    var A = scut('A', 'm1', base + 1), B = scut('B', 'm1', base + 2), X = scut('X', 'm1', base + 3);
    var Gf = scut('Gf', 'm2', base + 1, { foil: true });
    var d0 = ymd(2026, 7, 6), far = ymd(2026, 7, 31);
    var due = { A: 25, B: 25, X: 0, Gf: 25 };
    var dueKey = { A: far, B: far, X: d0, Gf: far };
    var perPass = { A: 25, B: 25, X: 25, Gf: 50 };
    console.log('\n=== Scenario 2 (foil) ===');
    var ops = P.planCutOperations([A, B, X, Gf], baseOpts(base, {
        perPassByCut: perPass, slitterIds: ['m1', 'm2'],
        dueDayByCut: due, dueKeyByCut: dueKey, blockedRangesBySlitter: {}
    }));
    dump(ops, base, ['A','B','X','Gf']);
    assert(overdueIds(ops).indexOf('X') < 0 && dayOf(ops, base, 'X') === 0,
        '#4203 sc2: рескью кладёт X в срок (день0, перед фольгой) — арбитр НЕ застревает на фольге (preserveOrder)');
})();

// ── Scenario 3: путь ГЕНЕРАЦИИ (slotPlacement:true, preserveOrder:false). Тот же расклад — но теперь
// работает слой размещения #4085 + §12 + intra-day resequence. Здесь ищем ДРЕЙФ (арбитр «день N», финал >N).
(function () {
    var base = midnight(2026, 7, 6);
    var A = scut('A', 'm1', base + 1), B = scut('B', 'm1', base + 2), X = scut('X', 'm1', base + 3);
    var Gf = scut('Gf', 'm2', base + 1, { foil: true });
    var d0 = ymd(2026, 7, 6), far = ymd(2026, 7, 31);
    var due = { A: 25, B: 25, X: 0, Gf: 25 };
    var dueKey = { A: far, B: far, X: d0, Gf: far };
    var perPass = { A: 25, B: 25, X: 25, Gf: 50 };
    console.log('\n=== Scenario 3 (foil, slotPlacement) ===');
    var ops = P.planCutOperations([A, B, X, Gf], baseOpts(base, {
        perPassByCut: perPass, slitterIds: ['m1', 'm2'],
        dueDayByCut: due, dueKeyByCut: dueKey, blockedRangesBySlitter: {},
        preserveOrder: false, slotPlacement: true, intraDayResequence: true
    }));
    dump(ops, base, ['A','B','X','Gf']);
    assert(overdueIds(ops).indexOf('X') < 0,
        '#4203 sc3: генерация (slotPlacement) кладёт X в срок — арбитр НЕ застревает на фольге');
})();

// ── Scenario 4: топология кастомера. m1 забит; РАНЬШЕ (m2) дни полны ДАЛЁКИМИ сроками (июль) + фольга
// в конце дня. X (срок рано) на m1 уезжает поздно. Чтобы X попал в срок, надо втиснуть в ранний день m2,
// сдвинув далёкие вниз (не вредит) — но «после фольги» перелив. Тот же материал A у всех (без смены сырья).
// slotPlacement генерация. Ищем: X остаётся overdue, хотя ранний день m2 имел место (перед фольгой).
(function () {
    var base = midnight(2026, 7, 6);
    var cuts = [];
    // m1: 4 далёких(25) заполняют дни 0,0,1,1 + X(срок день1) → уедет на день2 (просрочка).
    ['P','Q','R','S'].forEach(function (n, i) { cuts.push(scut(n, 'm1', base + (i + 1))); });
    cuts.push(scut('X', 'm1', base + 5));
    // m2: день0 = обычная(25) + ФОЛЬГА(30) [итого 55, своб 5]; день1 = обычная(25)+фольга(30); далёкие сроки.
    cuts.push(scut('M0', 'm2', base + 1));
    cuts.push(scut('F0', 'm2', base + 2, { foil: true }));
    cuts.push(scut('M1', 'm2', base + 3));
    cuts.push(scut('F1', 'm2', base + 4, { foil: true }));
    var d1 = ymd(2026, 7, 7), far = ymd(2026, 7, 31);
    var due = { P: 25, Q: 25, R: 25, S: 25, X: 1, M0: 25, F0: 25, M1: 25, F1: 25 };
    var dueKey = { P: far, Q: far, R: far, S: far, X: d1, M0: far, F0: far, M1: far, F1: far };
    var perPass = { P: 25, Q: 25, R: 25, S: 25, X: 25, M0: 25, F0: 30, M1: 25, F1: 30 };
    console.log('\n=== Scenario 4 (customer topology, slotPlacement) ===');
    var ops = P.planCutOperations(cuts, baseOpts(base, {
        perPassByCut: perPass, slitterIds: ['m1', 'm2'],
        dueDayByCut: due, dueKeyByCut: dueKey, blockedRangesBySlitter: {},
        preserveOrder: false, slotPlacement: true, intraDayResequence: true
    }));
    dump(ops, base, ['X','M0','F0','M1','F1','P','Q','R','S']);
    assert(overdueIds(ops).indexOf('X') < 0,
        '#4203 sc4: X в срок — арбитр использует ранний день соседнего станка (двигая ДАЛЁКИЕ вниз, не вредя)');
})();

// ── Scenario 5: DRIFT-hunt. Много просроченных на m1 тянутся на m2 в ОДИН раунд; поздний перенос
// пере-упорядочивает m2 так, что ранее перенесённый уезжает позже в ФИНАЛЬНОЙ упаковке (арбитр «день N», финал >N).
(function () {
    var base = midnight(2026, 7, 6);
    var cuts = [];
    // m1: 4 просроченных (срок день0), 25 мин ⇒ дни 0,0,1,1. Все на m1.
    ['X1','X2','X3','X4'].forEach(function (n, i) { cuts.push(scut(n, 'm1', base + (i + 1), { mat: 'A' })); });
    // m2 пуст. Все mat A. Сроки день0.
    var d0 = ymd(2026, 7, 6);
    var due = {}, dueKey = {}, perPass = {};
    ['X1','X2','X3','X4'].forEach(function (n) { due[n] = 0; dueKey[n] = d0; perPass[n] = 25; });
    console.log('\n=== Scenario 5 (drift hunt, empty m2) ===');
    var ops = P.planCutOperations(cuts, baseOpts(base, {
        perPassByCut: perPass, slitterIds: ['m1', 'm2'],
        dueDayByCut: due, dueKeyByCut: dueKey, blockedRangesBySlitter: {}
    }));
    dump(ops, base, ['X1','X2','X3','X4']);
    assert(overdueIds(ops).length === 0,
        '#4203 sc5 (drift-hunt): нет ДРЕЙФА — арбитр записал «день 0» и финал = день 0 для перенесённых (best.real не устаревает)');
})();

// ── Scenario 7: ЯВНОЕ исключение станка с местом (feasibleMachineFor). m2 пуст и физически влезло бы,
// но feasibleMachineFor(m2) == false для материала X → арбитр НЕ рассматривает m2 → X застревает overdue.
// Подтверждает: «застрял за срок при наличии места» = станок с местом ОТФИЛЬТРОВАН (ширина #4006 / стоп-лист).
(function () {
    var base = midnight(2026, 7, 6);
    var cuts = [];
    ['Y1','Y2','Y3','Y4'].forEach(function (n, i) { cuts.push(scut(n, 'm1', base + (i + 1), { mat: 'A' })); });
    var d0 = ymd(2026, 7, 6);
    var due = {}, dueKey = {}, perPass = {};
    ['Y1','Y2','Y3','Y4'].forEach(function (n) { due[n] = 0; dueKey[n] = d0; perPass[n] = 25; });
    console.log('\n=== Scenario 7 (feasibility exclusion of empty machine) ===');
    var ops = P.planCutOperations(cuts, baseOpts(base, {
        perPassByCut: perPass, slitterIds: ['m1', 'm2'],
        dueDayByCut: due, dueKeyByCut: dueKey, blockedRangesBySlitter: {},
        feasibleMachineFor: function (sid, slot) { return String(sid) === 'm1'; }   // m2 «недопустим» для всего
    }));
    dump(ops, base, ['Y1','Y2','Y3','Y4']);
    // ГЛАВНЫЙ вывод #4203: «переносов 0 / честный дефицит ёмкости» при ФИЗИЧЕСКИ свободном m2 — это
    // НЕ дрейф арбитра, а СЛЕДСТВИЕ того, что станок с местом ОТФИЛЬТРОВАН feasibleMachineFor
    // (ширина #4006 / стоп-лист). Ровно этот трейс видели в реальных данных (543436).
    assert(overdueIds(ops).indexOf('Y3') >= 0 && overdueIds(ops).indexOf('Y4') >= 0,
        '#4203 sc7 (МЕХАНИЗМ): исключение станка с местом → ложный «честный дефицит», Y3/Y4 застряли overdue при пустом m2');
})();

// ── Scenario 8: РЕАЛЬНАЯ топология 543436 (preserveOrder / «Пересчитать наладку»). Все станки ДОПУСТИМЫ
// (feasibleMachineFor не задан → всё feasible), т.е. это НЕ sc7-исключение. Воспроизводим «день 2 записан,
// финал день 5» при СВОБОДНОМ станке m3 в срок.
//   • ВЫХОДНЫЕ: база = ср 01.07; дни 3,4 (сб/вс 04–05.07) заблокированы на ВСЕХ станках ⇒ перелив дня 2
//     (пт 03.07) прыгает на день 5 (пн 06.07) — как в реале.
//   • window 60 мин, perPass 18 ⇒ ~3 резки/день.
//   • m1 (Станок 1): ЗАБИТ дни 0,1,2 далёкими 'A' (9 резок). Втискивание X сюда = перелив за выходные.
//   • m3 (Станок 3): дни 0,1 ЗАБИТЫ материалом 'W' (далёкие); день 2 — 1 резка 'W' (место на 2 ещё).
//     X — тот же материал 'W' ⇒ чистый дозаклад в день 2 БЕЗ смены сырья, В СРОК.
//   • X (срок день 2) + конкуренты C* (срок день 0, просрочены) на m2 — рескью тянет их, в т.ч. в начало m1,
//     что дестабилизирует втиснутый X (аналог 542191→в начало 1277).
(function () {
    var base = midnight(2026, 7, 1);          // Wed 01.07; 04–05 = сб/вс (дни 3,4)
    var cuts = [];
    var far = ymd(2026, 7, 31), d0 = ymd(2026, 7, 1), d2 = ymd(2026, 7, 3);
    var due = {}, dueKey = {}, perPass = {};
    function add(id, mach, ord, mat, dueOff, dueK, pp) {
        cuts.push(scut(id, mach, base + ord, { mat: mat }));
        due[id] = dueOff; dueKey[id] = dueK; perPass[id] = pp;
    }
    var d1 = ymd(2026, 7, 2);
    // m1 (Станок 1): материал 'W' (как у X ⇒ ДЁШЕВО, без смены сырья). Дни 0,1 — ТОЧНО-в-срок (срок дн0/дн1):
    // втискивание X в начало утопит их за срок (harm-гейт) ⇒ X может только на день 2 (дозаклад). День 2 'W' далёкий.
    add('P0', 'm1', 1, 'W', 0, d0, 18); add('P1', 'm1', 2, 'W', 0, d0, 18); add('P2', 'm1', 3, 'W', 0, d0, 18);
    add('Q0', 'm1', 4, 'W', 1, d1, 18); add('Q1', 'm1', 5, 'W', 1, d1, 18); add('Q2', 'm1', 6, 'W', 1, d1, 18);
    add('Z0', 'm1', 7, 'W', 25, far, 18); add('Z1', 'm1', 8, 'W', 25, far, 18); add('Z2', 'm1', 9, 'W', 25, far, 18);
    // m3 (Станок 3): материал 'V' (ОТЛИЧНЫЙ от X ⇒ дозаклад X = смена сырья, ДОРОЖЕ m1). Дни 0,1 забиты 'V',
    // день 2 — 1 'V' далёкая + место. Стабильный слот X в срок (день 2), но дороже фрагильного m1-втискивания.
    for (var j = 0; j < 7; j++) add('V' + j, 'm3', j + 1, 'V', 25, far, 18);
    // m4 (Станок 4): ЗАБИТ 'U' далёкими (9 резок) — НЕ пустой, чтобы не было лёгкого слива рескью.
    for (var u = 0; u < 9; u++) add('U' + u, 'm4', u + 1, 'U', 25, far, 18);
    // m2 (Станок 2): дни 0,1,2 забиты ТОЧНО-в-срок 'B' (срок дн0/дн1/дн2) — X (после них) переливается на
    // день 5 (за выходные) ⇒ просрочен; втиснуть X в начало m2 нельзя (утопит 'B' за срок). X обязан УЙТИ.
    var bdue = [0,0,0,1,1,1,2,2,2], bkey = [d0,d0,d0,d1,d1,d1,d2,d2,d2];
    for (var k = 0; k < 9; k++) add('B' + k, 'm2', k + 1, 'B', bdue[k], bkey[k], 18);
    add('X', 'm2', 20, 'W', 2, d2, 18);       // срок день 2, материал 'W' (как MWR113L) — сейчас day5, обязан уйти
    console.log('\n=== Scenario 8 (real 543436 topology, weekend, free m3 in-срок) ===');
    var ops = P.planCutOperations(cuts, baseOpts(base, {
        perPassByCut: perPass, slitterIds: ['m1', 'm2', 'm3', 'm4'],
        dueDayByCut: due, dueKeyByCut: dueKey,
        blockedRangesBySlitter: { m1: [[3 * 1440, 5 * 1440]], m2: [[3 * 1440, 5 * 1440]], m3: [[3 * 1440, 5 * 1440]], m4: [[3 * 1440, 5 * 1440]] }
    }));
    dump(ops, base, ['X', 'C0', 'C1', 'C2', 'W6']);
    console.log('   X → станок ' + machineOf(ops, 'X') + ', день ' + dayOf(ops, base, 'X') + ' (срок день 2)');
    assert(overdueIds(ops).indexOf('X') < 0,
        '#4203 sc8: X (срок день2) НЕ просрочен — арбитр использует свободный m3/день2, а не втискивает в забитый m1 за выходные');
})();

console.log('\n' + passed + '/' + total + ' проверок прошло');
