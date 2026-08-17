// #4776 — «после урегулирования 2 станок не заполняется на целый день, а третий набит больше 450».
//
// ЖАЛОБА (боевая ateh, 17.08.2026 20:45 МСК). После «Урегулировать» Станок 2 держал 18.08 ≈ 404 мин
// при потолке 455 (716861 обрезано с 15 проходов до 9), а Станок 3 ушёл за смену (`DAY_OVER`: 1020
// при 975). Диспетчер нажал «Упорядочить → Станок» по каждому станку — дни набились правильно, и
// спросил: «как так, если мы должны использовать единый механизм?».
//
// МЕХАНИЗМ ОДИН. Разное — ОКНО: в 20:41 «С» стояло на СЕГОДНЯ (17.08), в 20:48 — на 18.08.
// `prevSetupBeforeWindow` брала заправку станка от последнего задания СТРОГО РАНЬШЕ «С». Когда «С» =
// сегодня, сегодняшний ОТРАБОТАННЫЙ день в раскладку не идёт (у заданий заполнено «Закончено», их
// отбрасывает `planInput`) — и заправкой тоже не считался. Станок входил в окно с ножами и сырьём
// резки двух-трёхдневной давности, и первое задание завтрашнего дня платило полную переналадку,
// которой в жизни нет: вечером 17.08 Станок 2 резал MW308/IN и утром 18.08 режет MW308/IN, хранимая
// наладка 0, а упаковщик заряжал 45 мин от MW208/OUT (15.08).
//
// Фантомные 45 минут дают ОБА симптома сразу: работа не влезает в день → упаковщик режет задания и
// плодит продолжения (НЕДОБОР), а где резать нечего — конец дня уезжает за смену (ПЕРЕБОР).
//
// ПРАВИЛО: заправка станка на входе в окно — конфигурация последней работы, которую станок успеет
// СДЕЛАТЬ до первого планируемого задания. Признак «работа сделана» — тот же `cutIsFinishedWork`,
// которым `buildSequenceOps` отбирает вход упаковщика.
//
// Run with: node experiments/atex-pp-4776-carry-setup-over-worked-day.test.js

process.env.TZ = 'UTC';
var planning = require('../download/atex/js/production-planning.js').planning;

var passed = 0, total = 0;
function assert(cond, name) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}
function eqo(a, e, name) {
    var ok = JSON.stringify(a) === JSON.stringify(e);
    assert(ok, name + (ok ? '' : '\n  ожидалось ' + JSON.stringify(e) + '\n  получено  ' + JSON.stringify(a)));
}

var TIMES = { KNIFE: 30, MATERIAL_WINDING: 15, KNIFE_MOVE: 0, BETWEEN_CUTS: 0 };
var BASE_MS = new Date(2026, 7, 17, 0, 0, 0, 0).getTime();   // «С» = 17.08 (СЕГОДНЯ, день уже отработан)

// dayOffset — день от «С»: -3 = 14.08, 0 = сегодня, 1 = завтра. done — заполнено «Закончено».
function cut(id, dayOffset, mat, wind, kw, runs, done) {
    var ms = BASE_MS + dayOffset * 86400000 + 8 * 3600000;
    var c = { id: id, slitter: { id: 'm1' }, materialId: mat, winding: wind, batchId: '',
        knifeWidths: kw, knifeCount: kw.length, rollerWidth: 0, plannedRuns: runs,
        planDate: String(Math.floor(ms / 1000)), duration: String(runs * 10) };
    if (done) {
        c.startDate = String(Math.floor((ms + 3600000) / 1000));
        c.endDate = String(Math.floor((ms + 7 * 3600000) / 1000));
    }
    return c;
}

// Боевая расстановка Станка 2: 15.08 резали MW208/OUT, ВЕСЬ 17.08 отработан на MW308/IN,
// 18.08 первым стои́т MW308/IN — та же заправка, наладки быть не должно.
var OLD  = cut('old',  -2, 'MW208', 'OUT', [80], 4, true);        // 15.08 — последнее раньше «С»
var TODAY = cut('today', 0, 'MW308', 'IN',  [59, 59], 6, true);   // 17.08 — ВЫПОЛНЕНО сегодня
var NEXT = cut('next',   1, 'MW308', 'IN',  [59, 59], 9, false);  // 18.08 — первое планируемое

// ── 1) Заправка входа — от СДЕЛАННОЙ сегодня работы, а не от позавчерашней ────────────────────
eqo(planning.prevSetupBeforeWindow([OLD, TODAY, NEXT], BASE_MS).m1,
    { materialId: 'MW308', winding: 'IN', knifeWidths: [59, 59], knifeCount: 2, dayOffset: 0 },
    '#4776: «С» = сегодня, день отработан → заправка от последней ВЫПОЛНЕННОЙ резки этого дня');

// ── 2) Фантомной наладки больше нет: хранимая колонка и упаковщик сходятся ────────────────────
// Хранимые колонки считаются по ВСЕЙ группе станка (вчера MW308/IN → сегодня MW308/IN) → 0.
var stored = planning.setupActivityColumns([OLD, TODAY, NEXT], TIMES, null);
eqo(stored.next, { knifeMin: 0, materialWindingMin: 0 },
    '#4776: хранимая наладка первого задания следующего дня = 0 (сырьё и ножи те же)');
var carry = planning.prevSetupBeforeWindow([OLD, TODAY, NEXT], BASE_MS);
var packOpts = {
    dayStartMin: 480, dayEndMin: 935, times: TIMES,
    perPassByCut: { next: 10 }, runsByCut: { next: 9 },
    dayAnchorByCut: {}, firstCutSetup: true, gapFill: true
};
var segs = planning.splitMachineQueue([NEXT], Object.assign({}, packOpts, { carryPrevSetup: carry.m1 }));
assert(segs.length === 1 && segs[0].runs === 9,
    '#4776: все 9 проходов встают в свой день — резать задание не из-за чего');
assert(segs[0].startMin - segs[0].windowStartMin === 0,
    '#4776: наладки перед первым заданием дня нет — окно упаковщика равно хранимому');

// Как было ДО фикса: заправка от позавчерашней MW208/OUT — чужие и сырьё, и ножи.
var stale = { materialId: 'MW208', winding: 'OUT', knifeWidths: [80], knifeCount: 1 };
var segsStale = planning.splitMachineQueue([NEXT], Object.assign({}, packOpts, { carryPrevSetup: stale }));
assert(segsStale[0].startMin - segsStale[0].windowStartMin === 45,
    '#4776 (как было): заправка от позавчерашней резки → фантомные 45 мин наладки перед днём');

// ── 3) Фантомные минуты выталкивают работу из дня — на смене, которой хватало ровно впритык ───
(function () {
    // День: 480–935 (455 мин). Работы ровно на 450 мин + 0 наладки → влезает целиком.
    var tight = cut('tight', 1, 'MW308', 'IN', [59, 59], 45, false);
    var opts = { dayStartMin: 480, dayEndMin: 935, times: TIMES,
        perPassByCut: { tight: 10 }, runsByCut: { tight: 45 }, dayAnchorByCut: {}, firstCutSetup: true, gapFill: true };
    var ok = planning.splitMachineQueue([tight], Object.assign({}, opts, { carryPrevSetup: carry.m1 }));
    var cutOff = planning.splitMachineQueue([tight], Object.assign({}, opts, { carryPrevSetup: stale }));
    assert(ok.length === 1 && ok[0].runs === 45,
        '#4776: с верной заправкой день берёт всю работу (45 проходов, 450 мин при потолке 455)');
    assert(cutOff.length > 1 && cutOff[0].runs < 45,
        '#4776 (как было): 45 фантомных минут выпихивают проходы в следующий день — «день не набит»');
})();

// ── 4) Границы правила ────────────────────────────────────────────────────────────────────────
// Задание базового дня, которое упаковщик КЛАДЁТ (не выполнено), заправкой входа не становится.
var todayOpen = cut('open', 0, 'MW308', 'IN', [59, 59], 6, false);
eqo(planning.prevSetupBeforeWindow([OLD, todayOpen, NEXT], BASE_MS).m1.materialId, 'MW208',
    '#4776: невыполненное задание базового дня раскладывает упаковщик — заправка прежняя (раньше «С»)');

// Смешанный день: утром выполнено, днём открытое — заправка от УТРЕННЕГО (оно раньше первого открытого).
(function () {
    var morning = cut('morning', 0, 'MWR200', 'OUT', [100], 3, true);
    var afternoon = cut('afternoon', 0, 'MW308', 'IN', [59, 59], 3, false);
    afternoon.planDate = String(Number(morning.planDate) + 4 * 3600);
    eqo(planning.prevSetupBeforeWindow([OLD, morning, afternoon, NEXT], BASE_MS).m1.materialId, 'MWR200',
        '#4776: смешанный день — заправка от сделанной работы, стоящей раньше первого невыполненного');
})();

// Выполненное ДОСРОЧНО задание будущего дня (#4593) заправкой ВХОДА не является.
(function () {
    var earlyDone = cut('early', 2, 'MR194', 'OUT', [50], 2, true);
    eqo(planning.prevSetupBeforeWindow([OLD, TODAY, NEXT, earlyDone], BASE_MS).m1.materialId, 'MW308',
        '#4776: выполненное досрочно в будущем дне заправкой входа не становится');
})();

// Регрессия #4300/#4312: базовый день пуст → правило прежнее (последнее задание раньше «С»).
eqo(planning.prevSetupBeforeWindow([OLD, NEXT], BASE_MS).m1,
    { materialId: 'MW208', winding: 'OUT', knifeWidths: [80], knifeCount: 1, dayOffset: -2 },
    '#4300/#4312: в базовом дне работы нет → заправка от последнего задания раньше «С»');
// #4371: заданий раньше первого планируемого нет вовсе → станка в ответе нет.
eqo(planning.prevSetupBeforeWindow([NEXT], BASE_MS), {},
    '#4371: заправку взять неоткуда → станка в ответе нет (наладка считается с нуля)');

// ── 5) Признак «работа сделана» — один на раскладку и на заправку ─────────────────────────────
assert(planning.cutIsFinishedWork({ endDate: '1786000000' }) === true,
    '#4776: заполненное «Закончено» — работа сделана');
assert(planning.cutIsFinishedWork({ status: 'Завершён' }) === true,
    '#4572: статус «Завершён» без «Закончено» — тоже сделана (отчёт статус не отдаёт, но если отдал — верим)');
assert(planning.cutIsFinishedWork({ startDate: '1786000000' }) === false,
    '#4381: только «Начато» — работа ИДЁТ, упаковщик её раскладывает, заправкой входа она не является');
assert(planning.cutIsFinishedWork(null) === false, '#4776: пустой вход — не сделана');

console.log('\n' + passed + '/' + total + ' проверок пройдено');
