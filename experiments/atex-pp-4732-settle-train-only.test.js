// #4732 — «УРЕГУЛИРОВАТЬ» СДВИГАЕТ ПАРОВОЗ: только вперёд, только по потолку дня.
//
// ПРАВИЛО (решение заказчика 11.08.2026, повторено 12.08.2026): «Урегулировать не рассуждает. Его
// дело — сдвинуть паровоз после урегулированного задания, соблюдая потолок дня и последовательность
// заданий, и больше ничего»; «не перемещать их относительно друг друга, не перемешивать».
//
// СИМПТОМ (боевое 12.08.2026, ateh1 — состояние «после», ateh — «до»). Одно нажатие в 18:14:40:
//   • четыре сессии `applySplitPlan` и четыре сведе́ния стартов за две минуты (журнал 665850) —
//     «множество каких-то проходов планирования»;
//   • 35 изменённых заданий, 5 созданных, 1 удалённое там, где действие несло два разделения;
//   • остаток 690758 встал на 12:54 в НАЧАТЫЙ день 12.08 МЕЖДУ выполненными заданиями, остаток
//     690747 — на 12:30 туда же (оба переехали из 13.08 обратно), и оба немедленно снова стали
//     просроченными: «Отклонения 3/0» на экране после урегулирования;
//   • последнее сведе́ние стартов всё равно сообщило «день выше потолка на 60 мин».
//
// ПРИЧИНА. Урегулирование заканчивается выравниванием дня по потолку
// (`levelOverfilledAfterWrite` → `levelDayLoad`), а оно звало упаковщик БЕЗ двух ограничений:
//   • `orderAuthoritative = false` — следующее задание выбиралось по цене переналадки, то есть
//     очередь пересобиралась;
//   • набивка хвоста смены (#3739) тянула работу НАЗАД, в день, который станок уже отработал.
// Пересборку из самого «Урегулировать» сняли в #4726, но она осталась внутри выравнивания.
//
// ЧТО ПРОВЕРЯЕМ:
//   A — БЕЗ режима паровоза упаковщик тянет задание в день РАНЬШЕ хранимого (воспроизведение);
//   B — В режиме паровоза ни одно задание не встаёт в день раньше своего хранимого;
//   C — порядок очереди сохраняется (переналадка мест не переигрывает);
//   D — потолок дня по-прежнему соблюдается: лишнее рвётся и уезжает ВПЕРЁД;
//   E — выравнивание зовёт паровоз (`trainOnly`) и берёт ВСЕ переполненные станки ОДНИМ вызовом.
//
// Run with: node experiments/atex-pp-4732-settle-train-only.test.js

process.env.TZ = 'UTC';
global.window = { db: 'ateh1', xsrf: 'x' };
var mod = require('../download/atex/js/production-planning.js');
var P = mod.planning;
var Controller = mod.Controller;

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

var BASE = new Date(2026, 7, 12, 0, 0, 0, 0).getTime();   // Ср 12.08.2026 = день 0 (день из тикета)
var D0 = Math.round(BASE / 1000) + 8 * 3600;
var DAY = 86400, CAP = 450;

function widths(w, n) { var a = []; for (var i = 0; i < n; i++) a.push(w); return a; }
// dayOff/min — ХРАНИМОЕ место задания («Дата план»), как его видит очередь.
function cut(id, o) {
    return { id: id, slitter: { id: o.sid || '1279' }, materialId: o.mat, winding: 'OUT', batchId: 'B' + o.mat,
             knifeWidths: widths(o.width || 59, o.knives || 10), knifeCount: o.knives || 10, rollerWidth: 60,
             plannedRuns: o.runs, isFoil: false, status: '', fixed: !!o.fixed, firstPartId: id,
             planDate: String(D0 + o.day * DAY + (o.min || 0) * 60) };
}

// Раскладка очереди упаковщиком ровно теми параметрами, какими её зовёт выравнивание дня
// (`levelDayLoad` → `autoSequenceQueueAfterMerge`: preserveOrder, без слоя размещения).
// dayAnchorByCut заполняем ДЛЯ ВСЕХ заданий — так его строит контроллер (buildSequenceOps), и
// именно он приезжает в упаковщик как «хранимый день» (storedDayByCut).
function pack(cuts, opts) {
    var pp = {}, anchor = {}, due = {};
    cuts.forEach(function (c) {
        pp[String(c.id)] = 10;                               // 10 мин на проход
        due[String(c.id)] = 30;                              // сроки далеко — на раскладку не влияют
        anchor[String(c.id)] = Math.floor((Number(c.planDate) * 1000 - BASE) / 86400000);
    });
    var sids = {}; cuts.forEach(function (c) { sids[String(c.slitter.id)] = 1; });
    var o = { planBaseMidnightMs: BASE, weights: {}, times: { KNIFE: 30, MATERIAL_WINDING: 15, BETWEEN_CUTS: 0 },
        dayStartMin: 480, dayEndMin: 480 + CAP, dayEndHourMin: 480 + CAP,
        maxOverworkCutsMin: 5, maxOverworkTuneMin: 10, lunchStartMin: 740, lunchDurationMin: 40,
        gapFill: true, preserveOrder: true, slotPlacement: false, firstCutSetup: false,
        prevSetupBySlitter: {}, intraDayResequence: true, perPassByCut: pp,
        slitterIds: Object.keys(sids), dueDayByCut: due, dueKeyByCut: {}, dayAnchorByCut: anchor };
    for (var k in (opts || {})) o[k] = opts[k];
    var ops = P.planCutOperations(cuts, o);
    // День и порядок КАЖДОГО задания в получившемся плане: голова — из updates, продолжения — из
    // creates (их записи ещё нет). Ключ порядка — время старта, как в очереди на экране.
    var placed = [];
    (ops.updates || []).forEach(function (u) {
        placed.push({ id: String(u.cutId), ts: Number(u.planStartTs), runs: Number(u.plannedRuns), isNew: false });
    });
    (ops.creates || []).forEach(function (cr) {
        placed.push({ id: String(cr.parentCutId), ts: Number(cr.planStartTs), runs: Number(cr.plannedRuns), isNew: true });
    });
    placed.sort(function (a, b) { return a.ts - b.ts; });
    placed.forEach(function (p) { p.day = Math.floor((p.ts * 1000 - BASE) / 86400000); });
    return { ops: ops, placed: placed,
             dayOf: function (id) {
                 var own = placed.filter(function (p) { return p.id === String(id) && !p.isNew; })[0];
                 return own ? own.day : null;
             },
             order: placed.filter(function (p) { return !p.isNew; }).map(function (p) { return p.id; }) };
}
function storedDay(c) { return Math.floor((Number(c.planDate) * 1000 - BASE) / 86400000); }

// ── Боевая форма: начатый день 12.08 (сделанное, между заданиями дыра) + работа 13.08 ───────────
// День 0: три ВЫПОЛНЕННЫХ задания (для планировщика они закреплены — c.fixed, как их закрепляет
// контроллер по «Начато», #4381) занимают 200 из 450 минут; в дне остаётся место.
// День 1: остаток «Урегулировать» (X) и два задания за ним.
function productionShape() {
    return [
        cut('done1', { mat: 'MW308', day: 0, min: 0,   runs: 5,  fixed: true }),
        cut('done2', { mat: 'MW308', day: 0, min: 100, runs: 5,  fixed: true }),
        cut('done3', { mat: 'MW308', day: 0, min: 300, runs: 3,  fixed: true }),
        cut('X',     { mat: 'MR194', day: 1, min: 0,   runs: 3 }),
        cut('Y',     { mat: 'MWR200', day: 1, min: 60, runs: 4 }),
        cut('Z',     { mat: 'MW411', day: 1, min: 150, runs: 4 })
    ];
}

// A — воспроизведение: без паровоза остаток уезжает НАЗАД, в начатый день.
var loose = pack(productionShape());
assert(loose.dayOf('X') === 0,
    'A. без паровоза остаток X садится в НАЧАТЫЙ день 0 — тот самый «вброс между выполненными»',
    'день X = ' + loose.dayOf('X'));

// B — с паровозом ни одно задание не встаёт раньше своего хранимого дня.
var train = pack(productionShape(), { trainOnly: true });
var back = productionShape().filter(function (c) {
    var d = train.dayOf(c.id);
    return d != null && d < storedDay(c);
}).map(function (c) { return c.id; });
assert(back.length === 0,
    'B. паровоз не двигает назад: заданий, уехавших в день раньше хранимого, — нет',
    back.length ? ('назад уехали: ' + back.join(', ')) : '');
assert(train.dayOf('X') === 1 && train.dayOf('Y') === 1 && train.dayOf('Z') === 1,
    'B2. работа 13.08 остаётся в 13.08 — начатый день не набивается задним числом',
    'X=' + train.dayOf('X') + ' Y=' + train.dayOf('Y') + ' Z=' + train.dayOf('Z'));

// C — порядок очереди сохраняется. Задания подобраны так, что «по цене переналадки» упаковщик
// собрал бы их в другом порядке (одинаковое сырьё рядом), а паровоз обязан оставить хранимый.
function mixedOrder() {
    return [
        cut('m1', { mat: 'MW308', day: 0, min: 0,   runs: 6 }),
        cut('m2', { mat: 'MR194', day: 0, min: 100, runs: 6 }),
        cut('m3', { mat: 'MW308', day: 0, min: 200, runs: 6 }),
        cut('m4', { mat: 'MR194', day: 0, min: 300, runs: 6 })
    ];
}
var mixedLoose = pack(mixedOrder());
var mixedTrain = pack(mixedOrder(), { trainOnly: true });
assert(mixedTrain.order.join(',') === 'm1,m2,m3,m4',
    'C. паровоз сохраняет хранимый порядок очереди', 'получилось: ' + mixedTrain.order.join(','));
assert(mixedLoose.order.join(',') !== 'm1,m2,m3,m4',
    'C2. без паровоза тот же вход упаковщик пересобирает по переналадке (это и видел диспетчер)',
    'получилось: ' + mixedLoose.order.join(','));

// D — потолок дня жив: день, набитый выше смены, рвётся по потолку и лишнее уезжает ВПЕРЁД.
// 44 прохода × 10 мин + 30 (ножи) = 470 > 450: последнее задание дня обязано разорваться.
function overfilledDay() {
    return [
        cut('big', { mat: 'MW308', day: 0, min: 0, runs: 44 }),
        cut('next', { mat: 'MW308', day: 1, min: 0, runs: 4 })
    ];
}
var over = pack(overfilledDay(), { trainOnly: true });
var bigParts = over.placed.filter(function (p) { return p.id === 'big'; });
assert(bigParts.length > 1 && bigParts[0].day === 0 && bigParts[bigParts.length - 1].day > 0,
    'D. потолок дня соблюдается: лишнее разбито по потолку и уехало на следующий день',
    'сегменты big по дням: ' + bigParts.map(function (p) { return p.day + ':' + p.runs; }).join(' '));
assert(over.dayOf('next') >= 1,
    'D2. и при этом соседний день не подтягивается назад', 'день next = ' + over.dayOf('next'));

// ── E. Проводка в контроллере: выравнивание = паровоз, и оно ОДНО на все станки ────────────────
var levelCalls = [];
var stub = Object.create(Controller.prototype);
stub.slitters = [{ id: '1279' }, { id: '1282' }, { id: '1277' }];
stub.overfilledDaysOf = function (sid) {
    return (sid === '1279' || sid === '1282') ? [{ dayOffset: 0, overMin: 60 }] : [];
};
stub.levelDayLoad = function (ids) { levelCalls.push(ids); return Promise.resolve(true); };
var levelDone = stub.levelOverfilledAfterWrite({ withinSlitterIds: ['1279', '1282', '1277'] }, true);

// Сам `levelDayLoad` — на настоящем прототипе: смотрим, с каким scope он зовёт пересборку.
var scopeSeen = null;
var lvl = Object.create(Controller.prototype);
lvl.filter = { date: '2026-08-12' };
lvl.nowMs = function () { return BASE; };
lvl.overfilledDaysOf = function (sid) { return sid === '1279' ? [{ dayOffset: 0, overMin: 60 }] : []; };
lvl.autoSequenceQueueAfterMerge = function (strategy, preserveOrder, scope) {
    scopeSeen = { preserveOrder: preserveOrder, scope: scope };
    return Promise.resolve(true);
};
lvl.warnOverfilledDays = function () {};
lvl.notify = function () {};
var lvlDone = lvl.levelDayLoad(['1279', '1282']);

Promise.all([levelDone, lvlDone]).then(function () {
    assert(levelCalls.length === 1,
        'E. одно нажатие — ОДИН проход выравнивания на все станки (было: по проходу на станок)',
        'вызовов levelDayLoad: ' + levelCalls.length);
    assert(levelCalls.length === 1 && String(levelCalls[0]) === String(['1279', '1282']),
        'E2. в него уходят ВСЕ переполненные станки разом, а чистые не трогаются',
        'станки: ' + JSON.stringify(levelCalls[0]));
    assert(scopeSeen && scopeSeen.scope && scopeSeen.scope.trainOnly === true,
        'E3. выравнивание зовёт упаковщик в режиме паровоза (trainOnly)',
        'scope: ' + JSON.stringify(scopeSeen && scopeSeen.scope));
    assert(scopeSeen && scopeSeen.preserveOrder === true,
        'E4. и по-прежнему без пересборки порядка (preserveOrder)');
    assert(scopeSeen && String((scopeSeen.scope || {}).withinSlitterIds) === String(['1279', '1282']),
        'E5. рамка «свои станки» сохранена');
    console.log('\n' + passed + ' проверок прошли из ' + total);
});
