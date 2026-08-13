// #4749 — «ОПЯТЬ НЕ ЗАБИТ ДЕНЬ»: МЕРКА СМОТРЕЛА НЕ НА ТОТ ПЛАН.
//
// СИМПТОМ (боевое 13.08.2026, ateh1, бандл .149 — уже с #4740/#4743/#4745): Станок 1, Чт 13.08 —
// «(306 мин)» при потолке 455. Выполненные вчера задания из дня ушли, остаток сведён к 08:00,
// станок стои́т пустым с 13:56 до 16:15, а в трассе «Урегулировать» — `under: []`: ни
// предупреждения, ни выравнивания. Первым заданием следующего дня стои́т #684571 — ПРОДОЛЖЕНИЕ
// цепочки #678349, которой этот день кончается: шесть проходов по 6.3 мин, влезли бы все.
//
// ПРИЧИНА. После #4745 недобор называл `ops.dayFill` — вердикт упаковщика о СВОЕЙ раскладке. Своя
// раскладка у него всегда плотная: дыру хранимого плана он ЗАКРЫВАЕТ (тянет проходы следующего дня
// к себе) и потому о ней молчит. Мерка отвечала про план, которого на экране нет, а дыра осталась
// в том, который на экране есть. #4745 снял ложную тревогу и вместе с ней — весь путь недобора:
// предупреждение #4638 и вход в выравнивание #4743 стали недостижимы.
//
// РЕШЕНИЕ (ТЗ §15, «одна арифметика» #4499): НЕДОБОР = РАЗНИЦА С ТЕМ ПЛАНОМ, КОТОРЫЙ МЫ САМИ И
// ЗАПИШЕМ. День недобран, когда раскладка успевает в нём больше работы, чем стои́т в хранимом
// плане. Считаем ПРОХОДАМИ (целые, не зависят от округления занятости и пересчёта переналадки),
// накопительно (день, ПРИНЯВШИЙ лишнее из переполненного соседа, недобранным не зовём) и только по
// работе, которой план касается (выполненное он не перекладывает — иначе сделанное вчера навсегда
// перевесит чашу).
//
// ЧТО ПРОВЕРЯЕМ:
//   A — воспроизведение: на боевом дне вердикт упаковщика (`ops.dayFill`) ПУСТ;
//   B — раскладка при этом кладёт в день больше проходов, чем стои́т, — мерка разницы день называет;
//   C — назван донор: работа, которая стои́т в следующих днях;
//   D — хранимый план равен раскладке (набивать нечем, случай #4745) — мерка МОЛЧИТ;
//   E — день, принявший работу из переполненного соседа, недобранным НЕ зовём;
//   F — выполненная работа чашу не перевешивает (её в операциях нет — нет и в сравнении);
//   G — проводка: вердикт `plannerUnderfilledDays` день отдаёт, вход в выравнивание открывается;
//   H — фраза оператору разворачивает число в объекты (ТЗ §14): день, сколько ещё успеваем, донор.
//
// Run with: node experiments/atex-pp-4749-underfill-vs-stored.test.js

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
var D0 = Math.round(BASE / 1000) + 8 * 3600, DAY = 86400, SID = '1277';

// Боевая очередь Станка 1 колонками живой ateh1 (наладка ножей + сырьё/намотка + резка и лидер).
// [id, день, минута старта, проходы, ножи, сырьё, резка, материал, намотка, ширина ножа, цепочка]
var LIVE = [
    ['690758', 0,   0,  6,  0,  0,  36, 'FOIL',    'IN',  30, '677234'],
    ['677843', 0,  36,  4, 30, 15,  16, 'MR194',   'OUT', 33, null],
    ['678367', 0,  97,  7,  0, 15,  37, 'MWR113L', 'OUT', 33, null],
    ['678776', 0, 149,  5,  0,  0,  30, 'MWR113L', 'OUT', 33, null],
    ['678377', 0, 179,  2,  0, 15,  14, 'MWR113L', 'IN',  33, null],
    ['678349', 0, 208, 11, 30,  0,  68, 'MWR113L', 'IN',  55, null],
    ['684571', 1,   0,  6,  0,  0,  38, 'MWR113L', 'IN',  55, '678349'],
    ['687969', 1,  38,  1,  0,  0,   5, 'MWR113L', 'IN',  55, null],
    ['687365', 1,  43,  1,  0, 15,   7, 'MWR116L', 'IN',  55, null],
    ['687416', 1,  65,  7, 30, 15,  70, 'MR194',   'IN',  25, null],
    ['688050', 1, 180,  6,  0, 15,  34, 'MR194',   'OUT', 25, null],
    ['687374', 1, 229,  1, 30,  0,   6, 'MR194',   'OUT', 30, null],
    ['687581', 1, 305, 35,  0, 15, 154, 'MWR233',  'OUT', 30, null],
    ['688083', 1, 474,  1,  0, 15,   6, 'FOIL',    'IN',  30, null],
    ['690158', 4,   0,  2,  0,  0,  12, 'FOIL',    'IN',  30, '688083'],
    ['689099', 4,  12,  5, 30,  0,  30, 'FOIL',    'IN',  50, null],
    ['688763', 4,  72,  6,  0,  0,  36, 'FOIL',    'IN',  50, null]
];

function widths(w) { var n = Math.max(1, Math.floor(660 / w)), a = []; for (var i = 0; i < n; i++) a.push(w); return a; }
function liveCuts(rows) {
    return (rows || LIVE).map(function (r) {
        return { id: r[0], slitter: { id: SID }, materialId: r[7], winding: r[8], batchId: 'B' + r[7],
                 knifeWidths: widths(r[9]), knifeCount: widths(r[9]).length, rollerWidth: r[9],
                 plannedRuns: r[3], isFoil: r[7] === 'FOIL', status: '', fixed: false,
                 firstPartId: r[10] || r[0], startDate: '', endDate: '',
                 planDate: String(D0 + r[1] * DAY + r[2] * 60),
                 storedKnifeSetupMin: r[4], storedMaterialWindingMin: r[5], storedCutAndLeaderMin: r[6] };
    });
}
// Раскладка теми же параметрами, какими её зовут «Урегулировать» и выравнивание дня.
function pack(cuts, extra) {
    var pp = {}, anchor = {}, due = {};
    cuts.forEach(function (c) {
        pp[String(c.id)] = Number(c.storedCutAndLeaderMin) / Math.max(1, Number(c.plannedRuns));
        anchor[String(c.id)] = Math.floor((Number(c.planDate) * 1000 - BASE) / 86400000);
        due[String(c.id)] = anchor[String(c.id)] + 3;
    });
    var o = { planBaseMidnightMs: BASE, weights: {}, times: { KNIFE: 30, MATERIAL_WINDING: 15, BETWEEN_CUTS: 0 },
        dayStartMin: 480, dayEndMin: 970, dayEndHourMin: 990, maxOverworkCutsMin: 5, maxOverworkTuneMin: 10,
        lunchStartMin: 740, lunchDurationMin: 40, gapFill: true, preserveOrder: true, trainOnly: true,
        slotPlacement: false, firstCutSetup: true, prevSetupBySlitter: {}, intraDayResequence: true,
        perPassByCut: pp, slitterIds: [SID], dueDayByCut: due, dueKeyByCut: {}, dayAnchorByCut: anchor };
    for (var k in (extra || {})) o[k] = extra[k];
    return P.planCutOperations(cuts, o);
}
function runsIn(cuts, day) {
    var n = 0;
    cuts.forEach(function (c) {
        if (Math.floor((Number(c.planDate) * 1000 - BASE) / 86400000) === day) n += Number(c.plannedRuns) || 0;
    });
    return n;
}
function measure(cuts, ops) { return P.underfilledDaysFromPlan(cuts, ops, { baseMidnightMs: BASE }); }

// ── A/B/C. БОЕВОЙ ДЕНЬ ─────────────────────────────────────────────────────────────────────
var cuts = liveCuts();
var ops = pack(cuts);
assert((ops.dayFill || []).length === 0,
    'A. воспроизведение: вердикт упаковщика о своей раскладке ПУСТ — дыру он закрывает и о ней молчит',
    'dayFill: ' + JSON.stringify(ops.dayFill || []));

var plannedRuns0 = 0;
(ops.updates || []).concat(ops.creates || []).forEach(function (u) {
    if (Math.floor((Number(u.planStartTs) * 1000 - BASE) / 86400000) === 0) plannedRuns0 += Number(u.plannedRuns) || 0;
});
assert(plannedRuns0 > runsIn(cuts, 0),
    'A2. и при этом раскладка кладёт в день БОЛЬШЕ работы, чем стои́т в хранимом плане',
    'раскладка: ' + plannedRuns0 + ' проходов, хранимый план: ' + runsIn(cuts, 0));

var rows = measure(cuts, ops);
var day0 = rows.filter(function (r) { return r.day === 0; })[0];
assert(!!day0 && day0.slitterId === SID && day0.addRuns === plannedRuns0 - runsIn(cuts, 0),
    'B. мерка разницы называет боевой день и говорит, на сколько проходов план успевает больше',
    JSON.stringify(rows));
assert(!!day0 && String(day0.donorCutId) === '684571',
    'C. назван донор — работа, которая стои́т в следующих днях (продолжение цепочки дня)',
    'донор: ' + (day0 && day0.donorCutId));

// ── D. НАБИВАТЬ НЕЧЕМ — МОЛЧИМ (случай #4745, идемпотентность) ──────────────────────────────
// Хранимый план = то, что раскладка и написала: второй прогон обязан молчать, иначе выравнивание
// зацикливается, а оператор слышит «день не набит» про день, который только что набили.
var settled = liveCuts();
var byId = {};
settled.forEach(function (c) { byId[String(c.id)] = c; });
(ops.updates || []).forEach(function (u) {
    var c = byId[String(u.cutId)];
    if (!c) return;
    c.planDate = String(u.planStartTs);
    c.plannedRuns = Number(u.plannedRuns);
    c.storedKnifeSetupMin = (u.planCols || {}).knife;
    c.storedMaterialWindingMin = (u.planCols || {}).material;
    c.storedCutAndLeaderMin = (u.planCols || {}).cutTime;
});
(ops.deletes || []).forEach(function (id) {
    settled = settled.filter(function (c) { return String(c.id) !== String(id); });
});
var again = measure(settled, pack(settled));
assert(again.length === 0,
    'D. хранимый план равен раскладке — мерка молчит (набивать нечем: случай #4745, сходимость #4652)',
    JSON.stringify(again));

// ── E. ДЕНЬ, ПРИНЯВШИЙ ЛИШНЕЕ ИЗ ПЕРЕПОЛНЕННОГО СОСЕДА, — НЕ НЕДОБРАН ───────────────────────
// Работа уехала ВПЕРЁД: до конца дня-приёмника раскладка успевает не больше хранимого плана,
// и звать его недобранным нельзя — иначе выравнивание гоняло бы по кругу перебор и «недобор».
var pushed = { updates: [
        { cutId: 'a', planStartTs: D0, plannedRuns: 6, occMin: 60 },              // день 0: было 10 проходов
        { cutId: 'b', planStartTs: D0 + DAY, plannedRuns: 8, occMin: 80 }         // день 1: было 4 — принял 4
    ], creates: [], deletes: [] };
var pushedCuts = [
    { id: 'a', slitter: { id: SID }, plannedRuns: 10, planDate: String(D0), storedCutAndLeaderMin: 100 },
    { id: 'b', slitter: { id: SID }, plannedRuns: 4, planDate: String(D0 + DAY), storedCutAndLeaderMin: 40 }
];
assert(measure(pushedCuts, pushed).length === 0,
    'E. день, принявший работу из переполненного соседа, недобранным не зовём (сравнение накопительное)',
    JSON.stringify(measure(pushedCuts, pushed)));

// ── F. ВЫПОЛНЕННАЯ РАБОТА ЧАШУ НЕ ПЕРЕВЕШИВАЕТ ─────────────────────────────────────────────
// Ровно то, что произошло 13.08: три вчерашних задания стоя́т в дне «Датой план», но раскладка их
// не перекладывает (их нет ни в одной операции). Считать их хранимой стороной значило бы навсегда
// перевесить чашу — недобор стал бы невидим.
var withDone = liveCuts().concat([
    { id: '678201', slitter: { id: SID }, materialId: 'MR194', winding: 'OUT', plannedRuns: 8,
      planDate: String(D0), endDate: String(D0 - 3600), status: '', firstPartId: '678201',
      storedKnifeSetupMin: 30, storedMaterialWindingMin: 0, storedCutAndLeaderMin: 36 },
    { id: '678007', slitter: { id: SID }, materialId: 'MWR200', winding: 'OUT', plannedRuns: 4,
      planDate: String(D0 + 87 * 60), endDate: String(D0 - 3600), status: '', firstPartId: '678007',
      storedKnifeSetupMin: 0, storedMaterialWindingMin: 15, storedCutAndLeaderMin: 18 }
]);
var doneRows = measure(withDone, ops);   // операции те же: выполненных в них нет
assert(doneRows.filter(function (r) { return r.day === 0; }).length === 1,
    'F. выполненная работа в сравнение не входит — недобор дня остаётся виден',
    JSON.stringify(doneRows));

// ── I. ДЕНЬ У ПОТОЛКА — МОЛЧИМ (ложная тревога #4745 не должна вернуться) ───────────────────
// Боевое 13.08.2026: Станок 2, Чт 13.08 — 453 мин при потолке 455. Раскладка «успевает» на
// 2 прохода больше, потому что переразбила бы работу иначе, но положить эти 23 минуты некуда.
var tightCuts = [
    { id: 'x1', slitter: { id: SID }, plannedRuns: 40, planDate: String(D0), storedCutAndLeaderMin: 453 },
    { id: 'x2', slitter: { id: SID }, plannedRuns: 10, planDate: String(D0 + DAY), storedCutAndLeaderMin: 100 }
];
var tightOps = { updates: [
        { cutId: 'x1', planStartTs: D0, plannedRuns: 42, occMin: 476 },
        { cutId: 'x2', planStartTs: D0 + DAY, plannedRuns: 8, occMin: 80 }
    ], creates: [], deletes: [] };
assert(P.underfilledDaysFromPlan(tightCuts, tightOps, { baseMidnightMs: BASE, capMin: 455 }).length === 0,
    'I. день у потолка (453 при 455) недобранным не зовём — класть эти минуты некуда (#4745)',
    JSON.stringify(P.underfilledDaysFromPlan(tightCuts, tightOps, { baseMidnightMs: BASE, capMin: 455 })));

// ── J. ЗАДАНИЕ СМЕНИЛО СТАНОК — ЭТО НЕ НАБИВКА ДНЯ ─────────────────────────────────────────
// Боевое 13.08.2026: 678732 уезжала со Станка 2 на Станок 3, и у Станка 3 появлялся «недобор»
// на 4 прохода в дне, куда запись (паровоз заперт на своём станке, #4225) ничего не положит.
var migCuts = [
    { id: 'm1', slitter: { id: '1279' }, plannedRuns: 4, planDate: String(D0), storedCutAndLeaderMin: 40 },
    { id: 'm2', slitter: { id: '1282' }, plannedRuns: 5, planDate: String(D0), storedCutAndLeaderMin: 50 }
];
var migOps = { updates: [
        { cutId: 'm1', planStartTs: D0 + DAY, plannedRuns: 4, occMin: 40, slitterId: '1282' },   // переезд
        { cutId: 'm2', planStartTs: D0, plannedRuns: 5, occMin: 50, slitterId: '1282' }
    ], creates: [], deletes: [] };
assert(P.underfilledDaysFromPlan(migCuts, migOps, { baseMidnightMs: BASE, capMin: 455 }).length === 0,
    'J. работа, приехавшая с ДРУГОГО станка, недобором дня не считается (перекидывание — дело «Упорядочить», #4001)',
    JSON.stringify(P.underfilledDaysFromPlan(migCuts, migOps, { baseMidnightMs: BASE, capMin: 455 })));

// ── G/H. ПРОВОДКА И ФРАЗА ──────────────────────────────────────────────────────────────────
function ctrl(list) {
    var self = Object.create(Controller.prototype);
    self.filter = { date: '2026-08-13' };
    self.nowMs = function () { return BASE + 9 * 3600000; };
    self.meta = {}; self.supplies = []; self.cuts = list;
    self.slitters = [{ id: SID, label: 'Станок 1' }];
    self.shiftClosedSlittersToday = function () { return {}; };
    self.blockedRangesBySlitter = function () { return {}; };
    self.workingWindow = function () {
        return { startMin: 480, cutEndMin: 970, endMin: 990,
                 maxOverworkCutsMin: 5, maxOverworkTuneMin: 10, lunchStartMin: 740, lunchDurationMin: 40 };
    };
    return self;
}
var said = [];
var c = ctrl(liveCuts());
c.notify = function (msg, kind) { said.push({ msg: msg, kind: kind }); };
c.buildSequenceOps = function (list) { return { ops: pack(list) }; };
var verdict = c.plannerUnderfilledDays();
assert(verdict.filter(function (r) { return r.day === 0 && String(r.slitterId) === SID; }).length === 1,
    'G. вердикт РМ (вход в выравнивание и предупреждение) боевой день отдаёт',
    JSON.stringify(verdict));
assert(c.warnUnderfilledAfterSettle() >= 1 && said.length === 1 && said[0].kind === 'warning',
    'G2. молчать о недоборе нельзя (#4638) — оператору сказано', 'сообщений: ' + said.length);
assert(/Станок 1/.test(said[0].msg) && /проход/.test(said[0].msg) && /684571/.test(said[0].msg),
    'H. фраза разворачивает число в объекты: день, сколько ещё успеваем, донор (ТЗ §14)',
    '(' + (said[0] && said[0].msg) + ')');

var seen = null;
var lvl = Object.create(Controller.prototype);
lvl.slitters = [{ id: SID }];
lvl.cuts = [];
lvl.overfilledDaysOf = function () { return []; };
lvl.plannerUnderfilledDays = function () { return [{ key: SID + '|0', slitterId: SID, day: 0, addRuns: 6, addMin: 83, donorCutId: '684571' }]; };
lvl.levelDayLoad = function (ids) { seen = ids; return Promise.resolve(true); };
lvl.levelOverfilledAfterWrite({ withinSlitterIds: [SID] }, true).then(function () {
    assert(seen && String(seen) === String([SID]),
        'G3. вход в выравнивание открывается по этому же вердикту — недобранный день чинит запись, а не совет',
        'станки: ' + JSON.stringify(seen));
    console.log('\n' + passed + '/' + total + ' проверок пройдено');
}).catch(function (err) {
    console.error('FAIL — исключение: ' + (err && err.stack || err));
    process.exitCode = 1;
});
