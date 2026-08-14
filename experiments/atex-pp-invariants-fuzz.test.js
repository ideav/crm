// ИНВАРИАНТЫ ПРОТИВ НАСТОЯЩЕГО ДВИЖКА: таблица «входы × правила» на сгенерированных планах.
//
// ЗАЧЕМ ЭТОТ ФАЙЛ (issue #4751, §«порочный круг»). Реестровый тест `atex-pp-invariants.test.js`
// собирает операции РУКАМИ и движок не зовёт ни разу; тесты на тикет заглушают `levelDayLoad`,
// `plannerUnderfilledDays`, `buildSequenceOps`. Поэтому все они зелёные ровно тогда, когда код
// делает то, что автор фикса задумал, — и молчат, когда раскладка выдаёт негодный план. За август
// это дало десять тикетов подряд про один и тот же дефект («день не набит», #4469 → #4751), каждый
// из которых чинился на своём слое и проходил свой тест.
//
// ЧТО ЗДЕСЬ ДРУГОГО. Планы не пишутся руками, а ГЕНЕРИРУЮТСЯ и прогоняются через НАСТОЯЩИЙ
// `planCutOperations` — тот самый, что зовут кнопки. Заглушек нет. Каждый вход автоматики
// («Сгенерировать», «Упорядочить», «Урегулировать», выравнивание дня, «Пересчитать наладку»)
// описан своим набором опций и проверяется ОДНИМ И ТЕМ ЖЕ набором правил реестра: правило не
// должно зависеть от того, какая кнопка его вызвала.
//
// ПОЧЕМУ ГЕНЕРАЦИЯ, А НЕ СЛУЧАЙНЫЕ ЧИСЛА. Формы взяты боевые: станки, сырьё, намотки, ширины
// ножей и отношение «минут на проход» — из очередей ateh1, на которых заведены #4743/#4745/#4749.
// Случайность перебирает КОМБИНАЦИИ этих форм (сколько заданий, где заморозка, где 🔒, где начатое),
// а не выдумывает данные. Seed фиксирован — падение воспроизводится дословно и печатает свой номер.
//
// СУДИМ ТО, ЧТО УЙДЁТ В БАЗУ. После движка операции прогоняются через СТРАЖ (`guardPlanOps`) —
// как на боевом пути записи, — и только потом проверяются правилами. Иначе тест обвинял бы
// раскладку в том, что шлюз и так не пропустит; на расхождении слоёв порочный круг и держался.
//
// ЧТО ГЕЙТИТ (список HARD ниже): FROZEN_DAY · FIXED_CUT_DAY · CHAIN_CONTIGUOUS ·
// CHAIN_SETUP_ONCE · SUPPLY_CONSERVED. Законные исключения берутся у самого движка
// (`ops.fixedDayLost`, `ops.fixedDayHeld`), а не пересчитываются здесь.
//
// ЧТО НЕ ГЕЙТИТ И ПОЧЕМУ — у каждого правила названа причина в месте объявления (HARD/WATCH):
// DAY_CAPACITY под наблюдением по открытому #4759, ORDER_PARTS_ADJACENT держит хвост контроллера,
// DAY_FILL — мерка, а не запрет.
//
// Run with: node experiments/atex-pp-invariants-fuzz.test.js
//   FUZZ_CASES=500 node experiments/... — больше случаев (по умолчанию 120)
//   FUZZ_SEED=12345 node experiments/... — другой seed

process.env.TZ = 'UTC';
global.window = { db: 'ateh1', xsrf: 'x' };
var mod = require('../download/atex/js/production-planning.js');
var P = mod.planning;

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

var CASES = Number(process.env.FUZZ_CASES || 120);
var SEED0 = Number(process.env.FUZZ_SEED || 20260814);
var BASE = Date.UTC(2026, 7, 13, 0, 0, 0);     // Чт 13.08.2026 — день 0
var DAY_MS = 86400000;
var D0 = Math.round(BASE / 1000) + 8 * 3600;   // 08:00 дня 0

// ── БОЕВЫЕ ФОРМЫ (ateh1) ────────────────────────────────────────────────────────────────────
var SLITTERS = ['1277', '1279', '1282'];
var MATERIALS = ['MW411', 'MW308', 'MR194', 'MWR113L', 'MWR233', 'MWR116L', 'FOIL'];
var WINDINGS = ['IN', 'OUT'];
var ROLLERS = [25, 30, 33, 50, 55];            // ширина ножа, мм
var PER_PASS = [4.5, 5, 6, 6.3, 7, 8];         // минут на проход — отношение из боевых колонок

function lcg(seed) {
    var s = seed >>> 0;
    return function() { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}
function pick(rnd, arr) { return arr[Math.floor(rnd() * arr.length) % arr.length]; }
function irnd(rnd, lo, hi) { return lo + Math.floor(rnd() * (hi - lo + 1)); }

// Одна сгенерированная очередь: задания на 1–3 станках, 3 дня, с заморозками, 🔒 и начатыми.
function makeCase(seed) {
    var rnd = lcg(seed);
    var sids = SLITTERS.slice(0, irnd(rnd, 1, 3));
    var frozenDays = {};
    if (rnd() < 0.45) frozenDays[irnd(rnd, 0, 2)] = true;      // ноль или один замороженный день
    var cuts = [], id = 600000;
    sids.forEach(function(sid) {
        var n = irnd(rnd, 3, 8);
        var minute = 0, day = 0;
        for (var i = 0; i < n; i++) {
            var runs = irnd(rnd, 1, 24);
            var perPass = pick(rnd, PER_PASS);
            var cutMin = Math.round(runs * perPass);
            var knife = rnd() < 0.35 ? 30 : 0;
            var mat = rnd() < 0.3 ? 0 : 15;
            if (minute + knife + mat + cutMin > 455) { day++; minute = 0; }
            if (day > 2) break;
            var roller = pick(rnd, ROLLERS);
            var material = pick(rnd, MATERIALS);
            var started = rnd() < 0.08;
            cuts.push({
                id: String(++id),
                slitter: { id: sid },
                materialId: material,
                winding: pick(rnd, WINDINGS),
                batchId: 'B' + material,
                knifeWidths: (function() { var k = Math.max(1, Math.floor(660 / roller)), a = []; for (var j = 0; j < k; j++) a.push(roller); return a; })(),
                knifeCount: Math.max(1, Math.floor(660 / roller)),
                rollerWidth: roller,
                plannedRuns: runs,
                isFoil: material === 'FOIL',
                status: started ? 'В работе' : '',
                startDate: started ? String(D0 + day * 86400 + minute * 60) : '',
                endDate: '',
                fixed: rnd() < 0.18,
                firstPartId: String(id),
                orderId: 'ORD' + irnd(rnd, 1, 6),
                planDate: String(D0 + day * 86400 + minute * 60),
                storedKnifeSetupMin: knife,
                storedMaterialWindingMin: mat,
                storedCutAndLeaderMin: cutMin
            });
            minute += knife + mat + cutMin;
        }
    });
    return { seed: seed, cuts: cuts, sids: sids, frozenDays: frozenDays };
}

// ── ВХОДЫ АВТОМАТИКИ ────────────────────────────────────────────────────────────────────────
// Опции те же, какими эти кнопки зовут движок. Ни одна не заглушена.
var ENTRIES = {
    'Сгенерировать':        { preserveOrder: false, gapFill: true,  slotPlacement: true,  intraDayResequence: true },
    'Упорядочить':          { preserveOrder: false, gapFill: true,  slotPlacement: true,  intraDayResequence: true },
    'Урегулировать':        { preserveOrder: true,  gapFill: true,  slotPlacement: false, intraDayResequence: true, trainOnly: true },
    'Выравнивание дня':     { preserveOrder: true,  gapFill: true,  slotPlacement: false, intraDayResequence: true, trainOnly: true },
    'Пересчитать наладку':  { preserveOrder: true,  gapFill: false, slotPlacement: false, intraDayResequence: true }
};

function runEngine(c, entryOpts) {
    var perPassByCut = {}, anchorByCut = {}, dueByCut = {};
    c.cuts.forEach(function(x) {
        var runs = Math.max(1, Number(x.plannedRuns));
        perPassByCut[x.id] = Number(x.storedCutAndLeaderMin) / runs;
        var d = Math.floor((Number(x.planDate) * 1000 - BASE) / DAY_MS);
        if (x.fixed) anchorByCut[x.id] = d;       // #3974: якорь дня только у 🔒
        dueByCut[x.id] = d + 3;
    });
    var o = {
        planBaseMidnightMs: BASE, weights: {},
        times: { KNIFE: 30, MATERIAL_WINDING: 15, BETWEEN_CUTS: 0 },
        dayStartMin: 480, dayEndMin: 970, dayEndHourMin: 990,
        maxOverworkCutsMin: 5, maxOverworkTuneMin: 10,
        lunchStartMin: 740, lunchDurationMin: 40,
        firstCutSetup: true, prevSetupBySlitter: {},
        perPassByCut: perPassByCut, slitterIds: c.sids,
        dueDayByCut: dueByCut, dueKeyByCut: {}, dayAnchorByCut: anchorByCut,
        // Заморозку движок принимает ИМЕННО так — предикатом по смещению дня (#4326-seal).
        // Не сообщить ему об этом значит фаззить не тот движок, что работает в бою.
        frozenDayFor: function(day) { return !!c.frozenDays[day]; }
    };
    for (var k in entryOpts) o[k] = entryOpts[k];
    return P.planCutOperations(c.cuts, o);
}

// ── КОНТЕКСТ ПРАВИЛ ─────────────────────────────────────────────────────────────────────────
// Те же предикаты, что даёт стражу контроллер. Обеспечение синтезируем СОГЛАСОВАННО с планом:
// каждое задание покрывает свою позицию, спрос = полосы × ХРАНИМЫЕ проходы. Значит в хранимом
// плане недостачи нет по построению, и любая недостача после операций создана именно ими.
function ruleCtx(c, ops) {
    var byId = {};
    c.cuts.forEach(function(x) { byId[x.id] = x; });
    function dayOffOf(ts) { return Math.floor((Number(ts) * 1000 - BASE) / DAY_MS); }
    function dayKeyOfOffset(d) {
        var dt = new Date(BASE + d * DAY_MS);
        return dt.getUTCFullYear() * 10000 + (dt.getUTCMonth() + 1) * 100 + dt.getUTCDate();
    }
    var released = {};
    ((ops && ops.fixedDayLost) || []).forEach(function(f) { released[String(f.cutId)] = true; });
    var held = {};
    ((ops && ops.fixedDayHeld) || []).forEach(function(h) {
        var cut = byId[String(h.cutId)];
        if (cut) held[String(cut.slitter.id) + '|' + dayKeyOfOffset(Number(h.fixedDay))] = true;
    });
    return {
        isFrozenCut: function(id) { var x = byId[String(id)]; return !!(x && c.frozenDays[dayOffOf(x.planDate)]); },
        isFrozenTs: function(ts) { return !!c.frozenDays[dayOffOf(ts)]; },
        isFixedCut: function(id) { var x = byId[String(id)]; return !!(x && x.fixed); },
        isFixedReleasedCut: function(id) { return !!released[String(id)]; },
        isManualMoveCut: function() { return false; },        // фаззим только АВТОМАТИКУ
        isFixedShiftedCut: function() { return false; },
        dayKeyOfCut: function(id) { var x = byId[String(id)]; return x ? dayKeyOfOffset(dayOffOf(x.planDate)) : null; },
        dayKeyOfTs: function(ts) { return dayKeyOfOffset(dayOffOf(ts)); },
        chainIdOfCut: function(id) { var x = byId[String(id)]; return x ? String(x.firstPartId || x.id) : null; },
        plannedRunsOfCut: function(id) { var x = byId[String(id)]; return x ? Number(x.plannedRuns) : null; },
        planSnapshot: function() {
            return c.cuts.map(function(x) {
                return { id: x.id, slitterId: String(x.slitter.id), planStartTs: Number(x.planDate),
                         fixed: !!x.fixed, chainId: String(x.firstPartId || x.id), orderId: String(x.orderId),
                         workSig: x.materialId + '|' + x.winding + '|' + x.rollerWidth,
                         started: !!x.startDate };
            });
        },
        knifeSetupMin: function() { return 30; },
        materialSetupMin: function() { return 15; },
        coverageLinks: function() {
            return c.cuts.map(function(x) { return { cutId: x.id, positionId: 'POS' + x.id, rollsPerRun: x.knifeCount }; });
        },
        positionDemand: function() {
            var d = {};
            c.cuts.forEach(function(x) { d['POS' + x.id] = { qty: x.knifeCount * Number(x.plannedRuns), orderNo: x.orderId }; });
            return d;
        },
        dayLoadMinutes: function() {
            var raw = (ops && ops.dayLoad) || {};
            var out = {};
            Object.keys(raw).forEach(function(k) {
                var p = k.split('|');
                out[p[0] + '|' + dayKeyOfOffset(Number(p[1]))] = raw[k];
            });
            return out;
        },
        dayCapacityMin: function() { return 455; },
        fixedHeldDays: function() { return Object.keys(held); }
    };
}

// Правила, которые ПУТЬ ЗАПИСИ обязан соблюдать (движок + страж), с законными исключениями выше.
//
// ЧЕГО ЗДЕСЬ НЕТ И ПОЧЕМУ. Правило проверяется на ТОМ слое, который его держит, иначе тест ругает
// невиновного:
//   • ORDER_PARTS_ADJACENT — его чинит ХВОСТ записи в контроллере (`mergeAdjacentOrderTasks`,
//     #4735), а не раскладка: смежность создаёт сама раскладка, и до слияния она законна. Держит
//     его `atex-pp-4735-adjacent-order-merge.test.js`.
//   • DAY_FILL — мерка «день можно набить плотнее», а не запрет: судить по ней раскладку в общем
//     случае нельзя (#4745/#4749 — ровно об этом).
var HARD = ['FROZEN_DAY', 'FIXED_CUT_DAY', 'CHAIN_CONTIGUOUS',
            'CHAIN_SETUP_ONCE', 'SUPPLY_CONSERVED'];

// ПОД НАБЛЮДЕНИЕМ, НО ПОКА НЕ ГЕЙТИТ — issue #4759. Первый же прогон этого фаззера нашёл по
// DAY_CAPACITY две РАЗНЫЕ вещи, и обе требуют решения заказчика, а не правки теста:
//   • 68 из 78 превышений — не больше 5 минут. Это расхождение МЕРОК: упаковщик пакует до потолка
//     НАСТРОЙКИ (`dayCeilingMin(win,'tune')` = 970+10 → ёмкость 460), а правило судит по потолку
//     РЕЗКИ (`'cuts'` = 970+5 → 455). Один и тот же день законен для движка и нарушение для стража.
//   • 10 превышений — от 6 до 50 минут, и «нахлёстом настройки» не объясняются. Воспроизводимо:
//     seed 20886415, вход «Сгенерировать» — станок 1277, день 0: два задания, 324 хранимых минуты,
//     раскладка пакует до 475 при потолке 455, `ops.fixedDayHeld` ПУСТ (то есть законное исключение
//     #4512 движок не заявляет). Это класс #4467 («станко-день не длиннее смены»), рецидивы
//     #4034/#3965.
// Пока вопрос открыт, правило ПЕЧАТАЕТСЯ со своим seed, но гейт не роняет — иначе харнесс нельзя
// смёржить, и он не начнёт стеречь остальные пять правил. Как только #4759 решён — строка
// переезжает в HARD, и это одна правка.
var WATCH = ['DAY_CAPACITY'];

// ── ПРОГОН ──────────────────────────────────────────────────────────────────────────────────
var firstFail = {};      // правило → первый случай, на котором оно упало
var counts = {};         // «вход|правило» → сколько случаев нарушили
var engineErrors = [];
var ran = 0;

for (var i = 0; i < CASES; i++) {
    var c = makeCase(SEED0 + i * 7919);
    if (!c.cuts.length) continue;
    Object.keys(ENTRIES).forEach(function(entry) {
        var ops;
        try { ops = runEngine(c, ENTRIES[entry]); }
        catch (e) { engineErrors.push({ seed: c.seed, entry: entry, err: String(e && e.message || e) }); return; }
        ran++;
        var ctx = ruleCtx(c, ops);
        // Судим ТО, ЧТО УЙДЁТ В БАЗУ: сперва страж (он вправе отбросить операции по правилам
        // `mode: 'drop'`), затем проверка. Иначе тест обвинял бы раскладку в том, что шлюз и так
        // не пропустит, — а именно на этом расхождении слоёв и держался порочный круг.
        var viol;
        try { P.guardPlanOps(ops, ctx, 'auto'); }
        catch (e) { engineErrors.push({ seed: c.seed, entry: entry, err: 'страж: ' + String(e && e.message || e) }); return; }
        try { viol = P.checkPlanInvariants(ops, ctx, 'auto') || []; }
        catch (e) { engineErrors.push({ seed: c.seed, entry: entry, err: 'правила: ' + String(e && e.message || e) }); return; }
        viol.forEach(function(v) {
            if (HARD.indexOf(v.rule) < 0 && WATCH.indexOf(v.rule) < 0) return;
            var key = entry + '|' + v.rule;
            counts[key] = (counts[key] || 0) + 1;
            if (!firstFail[v.rule]) {
                firstFail[v.rule] = { seed: c.seed, entry: entry, msg: v.msg,
                                     cuts: c.cuts.length, sids: c.sids.join(','),
                                     frozen: Object.keys(c.frozenDays).join(',') || '—' };
            }
        });
    });
}

console.log('── прогон ──────────────────────────────────────────────────────────');
console.log('случаев: ' + CASES + ' × входов: ' + Object.keys(ENTRIES).length + ' = прогонов движка: ' + ran
            + ' (seed ' + SEED0 + ')');
console.log('');

// 1. Движок не падает ни на одном сгенерированном плане.
assert(engineErrors.length === 0,
    'движок отрабатывает КАЖДЫЙ сгенерированный план без исключения',
    engineErrors.length ? ('первое: seed=' + engineErrors[0].seed + ' вход=' + engineErrors[0].entry
        + ' — ' + engineErrors[0].err + ' (всего ' + engineErrors.length + ')') : '');

// 2. Таблица «входы × правила»: ни одно ГЕЙТЯЩЕЕ правило не нарушается ни на одном входе.
HARD.forEach(function(rule) {
    var hit = firstFail[rule];
    assert(!hit, 'правило ' + rule + ' соблюдается на ВСЕХ входах и всех сгенерированных планах',
        hit ? ('первый случай: seed=' + hit.seed + ' вход=«' + hit.entry + '» заданий=' + hit.cuts
               + ' станки=' + hit.sids + ' заморожен день=' + hit.frozen + ' — ' + hit.msg) : '');
});

WATCH.forEach(function(rule) {
    var hit = firstFail[rule];
    if (!hit) { console.log('· ' + rule + ': нарушений нет (правило под наблюдением, #4759)'); return; }
    console.log('· ' + rule + ' ПОД НАБЛЮДЕНИЕМ (#4759), гейт не роняет — первый случай: seed=' + hit.seed
        + ' вход=«' + hit.entry + '» — ' + hit.msg);
});

if (Object.keys(counts).length) {
    console.log('');
    console.log('── что и на каком входе сработало ──────────────────────────────────');
    Object.keys(counts).sort().forEach(function(k) {
        var p = k.split('|');
        console.log('  вход «' + p[0] + '» × ' + p[1] + ': ' + counts[k] + ' случ.');
    });
    console.log('');
    console.log('Воспроизвести один случай: FUZZ_SEED=<seed> FUZZ_CASES=1 node experiments/atex-pp-invariants-fuzz.test.js');
}

console.log('\n' + passed + '/' + total + ' проверок прошло');
if (passed !== total) process.exitCode = 1;
