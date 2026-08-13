// #4736 — РУЧНОЕ ДЕЙСТВИЕ ДВИГАЕТ И ЗАФИКСИРОВАННЫЕ (🔒) ЗАДАНИЯ.
//
// ПРАВИЛО (решение заказчика 13.08.2026, тело #4736): «Если задание удалено, перетащено внутри дня
// или перемещено кнопкой, то все вызванные этим смещения должны игнорировать факт, что смещаемое по
// пути задание зафиксировано»; «зафиксированные задания при ручных действиях должны сдвигаться по
// правилам незафиксированных — разрываться и схлопываться, по-прежнему не меняя порядок». И второе:
// «если впереди изменяемого задания есть замороженные дни, то в действии отказывать — выдавать
// сообщение об этом».
//
// СИМПТОМ (#4732). «Урегулировать оставила все дни после сдвинутых заданий неполными, потому что
// задания зафиксированы и не могут быть перемещены в другой день или разбиты».
//
// ЧТО ПРОВЕРЯЕМ:
//   A — воспроизведение: 🔒 держит свой день, освободившееся место не схлопывается;
//   A2 — с признаком ручного сдвига 🔒 схлопывается в освободившийся день;
//   B — 🔒 РВЁТСЯ по потолку, когда ручное действие переполнило её день;
//   C — порядок очереди после сдвига прежний;
//   D — сдвиг не тянет 🔒 НАЗАД: в режиме паровоза (#4732) пол дня действует и на неё;
//   E — АВТОМАТИКА не затронута: без признака замок дня абсолютен (#4434/#4512);
//   F — сдвиг двигает только ХВОСТ: 🔒 ПЕРЕД изменяемым заданием остаётся на своём дне;
//   G — чистые правила: кого двигает сдвиг, откуда он считается, начатое/выполненное неприкосновенно;
//   H — замороженные дни ВПЕРЕДИ: перечисляются, и ручное действие получает отказ;
//   I — страж (реестр §15): FIXED_CUT_DAY не отбрасывает переезд 🔒 из хвоста ручного сдвига,
//       но по-прежнему отбрасывает переезд 🔒, к которому действие отношения не имеет;
//   J — проводка контроллера: все четыре кнопки кладут `manualShift` в scope и зовут шлюз отказа.
//
// Run with: node experiments/atex-pp-4736-manual-shift-over-fixed.test.js

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

var BASE = new Date(2026, 7, 13, 0, 0, 0, 0).getTime();   // Чт 13.08.2026 = день 0
var D0 = Math.round(BASE / 1000) + 8 * 3600;              // 08:00 дня 0
var DAY = 86400, CAP = 450;
var SID = '1279';

function widths(w, n) { var a = []; for (var i = 0; i < n; i++) a.push(w); return a; }
// day/min — ХРАНИМОЕ место задания («Дата план»), как его видит очередь.
function cut(id, o) {
    return { id: id, slitter: { id: o.sid || SID }, materialId: o.mat, winding: 'OUT', batchId: 'B' + o.mat,
             knifeWidths: widths(o.width || 59, o.knives || 10), knifeCount: o.knives || 10, rollerWidth: 60,
             plannedRuns: o.runs, isFoil: false, status: '', fixed: !!o.fixed, firstPartId: id,
             startDate: o.startDate || '', endDate: o.endDate || '',
             planDate: String(D0 + o.day * DAY + (o.min || 0) * 60) };
}
function tsOf(day, min) { return D0 + day * DAY + (min || 0) * 60; }
function storedDay(c) { return Math.floor((Number(c.planDate) * 1000 - BASE) / 86400000); }

// Раскладка очереди упаковщиком теми же параметрами, какими её зовёт контроллер
// (`buildSequenceOps` → `planCutOperations`: preserveOrder, без слоя размещения).
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
             partsOf: function (id) { return placed.filter(function (p) { return p.id === String(id); }); },
             order: placed.filter(function (p) { return !p.isNew; }).map(function (p) { return p.id; }) };
}
// Набор «двигает ручное действие» — так его строит контроллер (`manualShiftFixedIds` от точки сдвига).
function shiftMap(cuts, fromTs, sid) {
    var shift = { fromBySlitter: {} };
    shift.fromBySlitter[sid || SID] = fromTs;
    var m = {};
    P.manualShiftFixedIds(cuts, shift).forEach(function (id) { m[id] = true; });
    return m;
}

// ── A/A2. УДАЛЕНИЕ ОСВОБОДИЛО ДЕНЬ — 🔒 ЗА НИМ ОБЯЗАНА СХЛОПНУТЬСЯ ────────────────────────────
// День 0 после удаления пуст, в дне 1 стоят две 🔒 по 200 мин (влезают в одну смену: 400 ≤ 450).
function afterDelete() {
    return [
        cut('L1', { mat: 'MW308', day: 1, min: 0,  runs: 17, fixed: true }),   // 30 ножи + 170 = 200
        cut('L2', { mat: 'MW308', day: 1, min: 210, runs: 20, fixed: true })   // та же конфигурация — без переналадки
    ];
}
var delLoose = pack(afterDelete());
assert(delLoose.dayOf('L1') === 1 && delLoose.dayOf('L2') === 1,
    'A. воспроизведение: 🔒 держит свой день — освободившийся день 0 остаётся пустым',
    'L1=' + delLoose.dayOf('L1') + ' L2=' + delLoose.dayOf('L2'));

var delShift = pack(afterDelete(), { manualShiftByCut: shiftMap(afterDelete(), tsOf(0, 0)) });
assert(delShift.dayOf('L1') === 0 && delShift.dayOf('L2') === 0,
    'A2. ручной сдвиг: 🔒 схлопывается в освободившийся день — дыры от удалённого не остаётся',
    'L1=' + delShift.dayOf('L1') + ' L2=' + delShift.dayOf('L2'));

// ── B. РУЧНОЕ ДЕЙСТВИЕ ПЕРЕПОЛНИЛО ДЕНЬ — 🔒 РВЁТСЯ И УЕЗЖАЕТ ────────────────────────────────
// Оператор перенёс в день 0 задание на 300 минут; там уже стоя́т две 🔒 по 200 мин.
// 300 + 200 + 200 = 700 при потолке 450: хвост обязан уехать.
function overfilledByMove() {
    return [
        cut('MOVED', { mat: 'MR194', day: 0, min: 0,  runs: 27 }),              // 30 + 270 = 300
        cut('F1',    { mat: 'MW308', day: 0, min: 310, runs: 17, fixed: true }),
        cut('F2',    { mat: 'MW308', day: 0, min: 520, runs: 20, fixed: true })
    ];
}
var moveLoose = pack(overfilledByMove());
assert(moveLoose.dayOf('F1') === 0 && moveLoose.dayOf('F2') === 0,
    'B. воспроизведение: обе 🔒 остаются в переполненном дне 0 — день уходит за потолок',
    'F1=' + moveLoose.dayOf('F1') + ' F2=' + moveLoose.dayOf('F2'));

var moveShifted = pack(overfilledByMove(), { manualShiftByCut: shiftMap(overfilledByMove(), tsOf(0, 0)) });
var f2Parts = moveShifted.partsOf('F2');
assert(moveShifted.dayOf('F2') !== 0 || f2Parts.length > 1,
    'B2. ручной сдвиг: хвост дня (🔒) уезжает на следующий день или рвётся по потолку',
    'F2 по дням: ' + f2Parts.map(function (p) { return p.day + ':' + p.runs; }).join(' '));
var minutesDay0 = 0;
moveShifted.placed.forEach(function (p) { if (p.day === 0) minutesDay0 += p.runs * 10; });
assert(minutesDay0 <= CAP,
    'B3. и день 0 укладывается в смену — потолок соблюдён без вытеснения ручного задания',
    'минут работы в дне 0: ' + minutesDay0 + ' при потолке ' + CAP);

// ── C. ПОРЯДОК ОЧЕРЕДИ ПОСЛЕ СДВИГА ПРЕЖНИЙ ─────────────────────────────────────────────────
assert(moveShifted.order.join(',') === 'MOVED,F1,F2',
    'C. сдвиг не меняет порядок очереди — «по-прежнему не меняя порядок»',
    'получилось: ' + moveShifted.order.join(','));

// ── D. СДВИГ НЕ ТЯНЕТ 🔒 НАЗАД: ПАРОВОЗ (#4732) ДЕРЖИТ ЕЁ, КАК СВОБОДНОЕ ─────────────────────
// «Урегулировать» зовёт упаковщик паровозом: назад — никогда. Прежде 🔒 из-под правила выпадала
// (про саму 🔒 пол не спрашивали), и сняв ей замок дня, мы бы её одну и утащили в отработанный день.
function trainShape() {
    return [
        cut('T0', { mat: 'MW308', day: 0, min: 0,   runs: 5 }),                  // отработанный день
        cut('T1', { mat: 'MW308', day: 1, min: 0,   runs: 6, fixed: true }),
        cut('T2', { mat: 'MW308', day: 1, min: 100, runs: 6, fixed: true })
    ];
}
var train = pack(trainShape(), { trainOnly: true, manualShiftByCut: shiftMap(trainShape(), tsOf(1, 0)) });
var pulledBack = trainShape().filter(function (c) {
    var d = train.dayOf(c.id);
    return d != null && d < storedDay(c);
}).map(function (c) { return c.id; });
assert(pulledBack.length === 0,
    'D. паровоз держит и расфиксированную 🔒: назад в отработанный день никто не едет',
    pulledBack.length ? ('назад уехали: ' + pulledBack.join(', ')) : '');

// ── E. АВТОМАТИКА НЕ ЗАТРОНУТА ──────────────────────────────────────────────────────────────
// Тот же вход БЕЗ признака ручного сдвига: замок дня абсолютен (#4434 п.1 / #4512).
var autoRun = pack(overfilledByMove(), {});
assert(autoRun.dayOf('F1') === 0 && autoRun.dayOf('F2') === 0,
    'E. без признака ручного сдвига замок дня прежний — «Сгенерировать»/«Упорядочить» 🔒 не двигают',
    'F1=' + autoRun.dayOf('F1') + ' F2=' + autoRun.dayOf('F2'));

// ── F. ДВИГАЕТСЯ ТОЛЬКО ХВОСТ ───────────────────────────────────────────────────────────────
// 🔒 ПЕРЕД изменяемым заданием сдвиг не касается: она стои́т раньше точки сдвига.
var tailOnly = shiftMap(overfilledByMove(), tsOf(0, 520));
assert(!tailOnly['F1'] && tailOnly['F2'],
    'F. сдвиг двигает только то, что стои́т ПОСЛЕ точки: F1 (раньше) не тронута, F2 (позже) — да',
    'набор: ' + JSON.stringify(Object.keys(tailOnly)));

// ── G. ЧИСТЫЕ ПРАВИЛА ───────────────────────────────────────────────────────────────────────
var mixed = [
    cut('free', { mat: 'MW308', day: 0, min: 0,  runs: 4 }),
    cut('lock', { mat: 'MW308', day: 0, min: 60, runs: 4, fixed: true }),
    cut('busy', { mat: 'MW308', day: 1, min: 0,  runs: 4, fixed: true, startDate: String(tsOf(1, 0)) }),
    cut('done', { mat: 'MW308', day: 1, min: 60, runs: 4, fixed: true, endDate: String(tsOf(1, 120)) }),
    cut('other', { mat: 'MW308', day: 1, min: 0, runs: 4, fixed: true, sid: '1282' })
];
var gIds = P.manualShiftFixedIds(mixed, { fromBySlitter: { '1279': tsOf(0, 0) } });
assert(gIds.join(',') === 'lock',
    'G. сдвиг двигает только 🔒 своего станка: свободное — и так подвижно, начатое/выполненное — факт, чужой станок — не его дело',
    'получилось: ' + JSON.stringify(gIds));

var gFrom = P.manualShiftFrom(mixed, ['lock'], { '1279': tsOf(0, 0) });
assert(gFrom && gFrom.fromBySlitter['1279'] === tsOf(0, 0),
    'G2. точка сдвига — самое раннее из «где задание стои́т» и «куда его кладут»',
    'получилось: ' + JSON.stringify(gFrom));
assert(P.manualShiftFrom(mixed, [], null) === null,
    'G3. трогать нечего — точки сдвига нет, и правило молчит (автоматика идёт прежним путём)');

// ── H. ЗАМОРОЖЕННЫЕ ДНИ ВПЕРЕДИ ─────────────────────────────────────────────────────────────
var frozenAheadCuts = [
    cut('h0', { mat: 'MW308', day: 0, min: 0, runs: 4 }),
    cut('h1', { mat: 'MW308', day: 2, min: 0, runs: 4 }),          // этот день заморожен
    cut('h2', { mat: 'MW308', day: 3, min: 0, runs: 4 })
];
var frozenDay2Key = Number(new Date(BASE + 2 * 86400000).getFullYear() * 10000
    + (new Date(BASE + 2 * 86400000).getMonth() + 1) * 100 + new Date(BASE + 2 * 86400000).getDate());
function frozenTs(planDate) {
    var d = new Date(Number(planDate) * 1000);
    var key = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
    return key === frozenDay2Key;
}
var ahead = P.manualShiftFrozenDaysAhead(frozenAheadCuts, { fromBySlitter: { '1279': tsOf(0, 0) } }, frozenTs);
assert(ahead.length === 1 && Number(ahead[0]) === frozenDay2Key,
    'H. замороженный день впереди назван — по нему и отказывают',
    'дни: ' + JSON.stringify(ahead));
var aheadNone = P.manualShiftFrozenDaysAhead(frozenAheadCuts, { fromBySlitter: { '1279': tsOf(3, 0) } }, frozenTs);
assert(aheadNone.length === 0,
    'H2. заморозка ПОЗАДИ точки сдвига действию не мешает — отказа нет',
    'дни: ' + JSON.stringify(aheadNone));

var refused = null;
var frz = Object.create(Controller.prototype);
frz.cuts = frozenAheadCuts;
frz.meta = { freeze: { id: 1 } };
frz.freezeByDay = {}; frz.freezeByDay[String(frozenDay2Key)] = true;
frz.dayIsFrozen = function (ts) { return frozenTs(ts); };
frz.notify = function (msg, kind) { refused = { msg: msg, kind: kind }; };
var refusedVerdict = frz.manualShiftRefused({ fromBySlitter: { '1279': tsOf(0, 0) } }, 'Удаление задания');
assert(refusedVerdict === true && refused && refused.kind === 'error'
        && /замороженные дни/.test(refused.msg) && /Удаление задания/.test(refused.msg),
    'H3. шлюз отказывает ручному действию и называет дни — молча половину сдвига не делаем',
    'сообщение: ' + (refused && refused.msg));

var okVerdict = frz.manualShiftRefused({ fromBySlitter: { '1279': tsOf(3, 0) } }, 'Удаление задания');
assert(okVerdict === false,
    'H4. заморозки впереди нет — действие идёт своим ходом');

// ── F2. ЗАДАНИЕ, КОТОРОЕ ДЕЙСТВИЕ НЕСЁТ САМО, ИЗ ХВОСТА ИСКЛЮЧЕНО ────────────────────────────
// День ему выбрал оператор, и держится выбор ТЕМ ЖЕ якорем. Сняв якорь заодно с соседями, мы
// отменили бы саму команду: остаток «Урегулировать» уехал бы с выбранного дня (#4574).
var carriedCuts = [
    cut('carried', { mat: 'MW308', day: 0, min: 0,  runs: 4, fixed: true }),
    cut('tail',    { mat: 'MW308', day: 0, min: 60, runs: 4, fixed: true })
];
var seenScope = P.manualShiftFixedIds(carriedCuts, { fromBySlitter: { '1279': tsOf(0, 0) } },
    function (c) { return String(c.id) === 'carried'; });
assert(seenScope.join(',') === 'tail',
    'F2. задание, которое действие несёт само, из хвоста исключается — его день выбрал оператор',
    'получилось: ' + JSON.stringify(seenScope));
var srcCarried = require('fs').readFileSync(
    __dirname + '/../download/atex/js/production-planning/20-controller.js', 'utf8');
assert(/carriedNow\[String\(c\.id\)\]\) return true;/.test(srcCarried),
    'F3. и это исключение стои́т в общей сборке признака (buildSequenceOps), а не в кнопках');

// ── I. СТРАЖ (реестр §15) ───────────────────────────────────────────────────────────────────
var guardOps = { updates: [
    { cutId: 'shifted', planStartTs: String(tsOf(1, 0)), plannedRuns: 4 },
    { cutId: 'foreign', planStartTs: String(tsOf(1, 0)), plannedRuns: 4 }
], creates: [], deletes: [] };
var guardCtx = {
    isFixedCut: function (id) { return id === 'shifted' || id === 'foreign'; },
    isFixedShiftedCut: function (id) { return id === 'shifted'; },
    dayKeyOfCut: function () { return 20260813; },
    dayKeyOfTs: function () { return 20260814; }
};
var viol = P.checkPlanInvariants(guardOps, guardCtx)
    .filter(function (v) { return v.rule === 'FIXED_CUT_DAY'; });
assert(viol.length === 1 && String(viol[0].cutId) === 'foreign',
    'I. FIXED_CUT_DAY молчит про 🔒 из хвоста ручного сдвига и по-прежнему ловит чужую',
    'нарушения: ' + JSON.stringify(viol.map(function (v) { return v.cutId; })));
var kept = P.guardPlanOps(guardOps, guardCtx);
var keptIds = (kept.ops.updates || []).map(function (u) { return String(u.cutId); });
assert(keptIds.indexOf('shifted') >= 0 && keptIds.indexOf('foreign') < 0,
    'I2. и операция сдвинутой 🔒 доходит до базы, а чужая — отбрасывается',
    'осталось: ' + JSON.stringify(keptIds));

// ── J. ПРОВОДКА КОНТРОЛЛЕРА: ВСЕ ЧЕТЫРЕ КНОПКИ ──────────────────────────────────────────────
// Признак обязан дойти до пересборки очереди и до ВЫРАВНИВАНИЯ ДНЯ — иначе последний шаг снова
// упрётся в 🔒 (правило половинчатым быть не может).
var lvlScope = null;
var lvl = Object.create(Controller.prototype);
lvl.filter = { date: '2026-08-13' };
lvl.nowMs = function () { return BASE; };
lvl.overfilledDaysOf = function (sid) { return sid === SID ? [{ dayOffset: 0, overMin: 60 }] : []; };
lvl.autoSequenceQueueAfterMerge = function (strategy, preserveOrder, scope) { lvlScope = scope; return Promise.resolve(true); };
lvl.warnOverfilledDays = function () {};
lvl.notify = function () {};
var lvlDone = lvl.levelDayLoad([SID], { manualShift: { fromBySlitter: { '1279': tsOf(0, 0) } } });

var passedScope = null;
var lvlAfter = Object.create(Controller.prototype);
lvlAfter.slitters = [{ id: SID }];
lvlAfter.overfilledDaysOf = function () { return [{ dayOffset: 0, overMin: 60 }]; };
lvlAfter.levelDayLoad = function (ids, opts) { passedScope = opts; return Promise.resolve(true); };
var afterDone = lvlAfter.levelOverfilledAfterWrite(
    { withinSlitterIds: [SID], manualShift: { fromBySlitter: { '1279': tsOf(0, 0) } } }, true);

Promise.all([lvlDone, afterDone]).then(function () {
    assert(lvlScope && lvlScope.manualShift && lvlScope.manualShift.fromBySlitter['1279'] === tsOf(0, 0),
        'J. выравнивание дня несёт признак ручного сдвига в пересборку',
        'scope: ' + JSON.stringify(lvlScope));
    assert(passedScope && passedScope.manualShift,
        'J2. и общий хвост записи (levelOverfilledAfterWrite) его туда передаёт',
        'opts: ' + JSON.stringify(passedScope));

    // Исходники: каждая из четырёх кнопок кладёт признак в scope и спрашивает шлюз отказа.
    var fs = require('fs');
    var src = fs.readFileSync(__dirname + '/../download/atex/js/production-planning/20-controller.js', 'utf8');
    [['moveShift', 'ручной перенос 🗓'],
     ['deleteShift', 'удаление задания'],
     ['dragShift', 'перетаскивание внутри дня'],
     ['settleShift', '«Урегулировать»']].forEach(function (pair) {
        assert(src.indexOf('refuseManualShift(self, ' + pair[0]) >= 0,
            'J3. ' + pair[1] + ' спрашивает общий шлюз отказа до записи');
    });
    assert(/moveScope\.manualShift = moveShift/.test(src)
        && /manualShift: shift/.test(src)
        && /settleScope\.manualShift = settleShift/.test(src)
        && /manualShift: dragShift/.test(src),
        'J4. и все четыре кладут точку сдвига в scope пересборки');

    console.log('\n' + passed + '/' + total + ' проверок пройдено');
}).catch(function (err) {
    console.error('FAIL — исключение: ' + (err && err.stack || err));
    process.exitCode = 1;
});
