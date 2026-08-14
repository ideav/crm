// #4751 — «ОПЯТЬ НЕ ЗАБИТ ДЕНЬ»: ЖЁСТКОЕ ПРАВИЛО, КОТОРОЕ ТОЛЬКО СМОТРИТ, НИЧЕГО НЕ ДЕРЖИТ.
//
// СИМПТОМ (боевое 13.08.2026, ateh1, бандл .150). Одно «Урегулировать» на станках 1279/1282 в дне
// 20260813 прошло пятью фазами и записало 168 команд в базу. В журнале одна и та же строка
// повторяется четырьмя проходами подряд:
//
//   ⚠️ инварианты-наблюдатели сработали бы: CHAIN_CONTIGUOUS #669328 (между 662289 и 669328
//   вклинилось: 666716); CHAIN_CONTIGUOUS #657653 …; SUPPLY_CONSERVED #641919 (позиция 632180,
//   заказ 4340: заказано 368, выпуск по плану 272 — не хватает 96); … заказ 4442 — не хватает 138;
//   заказ 4472 — 128; заказ 4538 — 168; всего 13 недообеспеченных позиций.
//
// «Сработали бы» — и не сработали: оба правила объявлены `mode: 'audit'`, а страж `guardPlanOps`
// стои́т ТОЛЬКО на пути `buildSequenceOps`. Фазы, которые пишут сами, до него не доходят вовсе:
// `reconcilePlanStarts` пишет через `postCutStarts` (боевые WRITE#61…64), `mergeAdjacentOrderTasks`
// — прямыми `_m_set`/`_m_del` (WRITE#65…70), и только потом `applySplitPlan` зовёт стража
// (WRITE#71…72). К моменту первой проверки записано уже семьдесят команд, три записи удалены
// (WRITE#66/67/68 DEL), и вернуть их некому.
//
// ПОЧЕМУ НЕЛЬЗЯ ПРОСТО ПОСТАВИТЬ `mode: 'drop'`. Причина, записанная у обоих правил в `why`, верна:
// выброшенная ОПЕРАЦИЯ ни недостачу не добирает, ни цепочку не сшивает — задание осталось бы с
// прежним `planStart`, и день получил бы дыру (рецидив #4300/#4312). Недостача и разрыв — свойства
// ВСЕЙ раскладки, а не отдельной «плохой» записи.
//
// ПОЧЕМУ НЕЛЬЗЯ И ПРОСТО ЗАПРЕТИТЬ НАРУШЕНИЕ. В боевом плане недостача УЖЕ ЕСТЬ до всякой записи —
// те же 13 позиций видны на всех четырёх проходах с ОДНИМИ И ТЕМИ ЖЕ числами. Абсолютный запрет
// отказал бы КАЖДОЙ записи навсегда: план нельзя было бы ни поправить, ни даже улучшить.
//
// РЕШЕНИЕ (ТЗ §15): ХРАПОВИК. Правило получает НЕ режим отбрасывания, а третью, ортогональную режиму
// ось — `gate: 'ratchet'`: набор операций не вправе УХУДШИТЬ правило по сравнению с ХРАНИМЫМ планом.
// Унаследованное нарушение запись пропускает (за него она не отвечает — та же логика, что у
// `capacityBreaksStored`, #4622), НОВОЕ — откатывает, и откатывает ЦЕЛИКОМ по цепочкам, которых
// нарушение касается (та же безопасная семантика, что у #4536/#4645: «задание остаётся ровно таким,
// как хранится»). Механика — одна на все пути записи: и на стража `guardPlanOps`, и на фазы,
// которые пишут сами.
//
// ЧТО ПРОВЕРЯЕМ:
//   A — боевой набор позиций: недостача, которую операции СОЗДАЮТ, набор до базы не доводит;
//   B — та же недостача, УЖЕ стоящая в хранимом плане, запись не блокирует (иначе план замерзает);
//   C — откат идёт ЦЕПОЧКОЙ: снимаются все операции задания, а не только «плохая»;
//   D — CHAIN_CONTIGUOUS тем же храповиком: разрыв, созданный набором, откатывается;
//   E — разрыв, который БЫЛ в хранимом плане, набор не блокирует;
//   F — храповик объявлен у обоих правил тикета и НЕ подменяет собой режим (`mode` не тронут);
//   G — правило без `gate` храповиком не ограничено (унаследованные наблюдатели ведут себя как были);
//   H — проводка: `guardPlanOps` возвращает откаченные цепочки вызывающему (молчания нет, ТЗ §14);
//   I — боевой кейс целиком: станки 1279/1282, день 20260813, заказы 4340/4377/4404/4420/4442/
//       4443/4472/4476/4257/4522/4538 — «после паровоза объём заказа не уменьшается».
//
// Run with: node experiments/atex-pp-4751-invariant-ratchet.test.js

process.env.TZ = 'UTC';
global.window = { db: 'ateh1', xsrf: 'x' };
var planning = require('../download/atex/js/production-planning.js').planning;

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

var DAY = 20260813;
var TS = Math.floor(Date.UTC(2026, 7, 13, 8, 0, 0) / 1000);
function at(min) { return TS + min * 60; }
function dayKeyOf(ts) {
    var d = new Date(Number(ts) * 1000);
    return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
}

// ── БОЕВАЯ ФИКСТУРА ─────────────────────────────────────────────────────────────────────────
// Одиннадцать заказов из тикета. Каждую позицию покрывают ДВЕ записи одной цепочки — голова и
// продолжение, как и живёт разорванное по дням задание. «Кол-во полос» партии ГП у них разное
// (голова и хвост режут разную ширину), поэтому ОДИН проход даёт им разное число штук. Хранимый
// план заказ обеспечивает ровно: заказано = полосГоловы × проходыГоловы + полосХвоста × проходыХвоста.
//
// ПОЧЕМУ ИМЕННО ТАКАЯ ФОРМА. Недостачу, возникшую от УРЕЗАНИЯ ПРОХОДОВ, шлюз уже держит с #4645:
// баланс цепочки уходит в минус, и все её операции снимаются. Но паровоз проходов не теряет — он их
// ПЕРЕРАСПРЕДЕЛЯЕТ между звеньями цепочки (сколько влезло до потолка — голове, остаток —
// продолжению, §9), и сумма по цепочке остаётся прежней. Баланс нулевой, #4645 молчит, а
// обеспечение падает: проход, переехавший из хвоста в голову, режет другую ширину и даёт заказу
// меньше штук. Эту дыру и закрывает храповик.
var LIVE = [
    // [позиция, заказ, голова, донор, цепочка, полосГоловы, полосДонора, проходыГоловы, проходыДонора, заказано]
    ['632180', '4340', '641919', '641920', '641919',  8, 10, 26, 16,  368],
    ['643315', '4377', '648542', '648543', '648542',  5, 11, 20, 10,  210],
    ['645083', '4404', '651326', '651327', '651326',  3,  5, 24,  8,  112],
    ['645084', '4404', '651326', '651327', '651326', 26, 48, 24,  8, 1008],
    ['645119', '4420', '649351', '649352', '649351',  2,  5, 18,  6,   66],
    ['646598', '4442', '649500', '649501', '649500',  3,  6, 20, 20,  180],
    ['646600', '4443', '650956', '650957', '650956',  4,  6, 30, 15,  210],
    ['651663', '4472', '652642', '652643', '652642',  4, 12, 23,  5,  152],
    ['651671', '4476', '652257', '652258', '652257',  1,  4, 10,  5,   30],
    ['651672', '4476', '652257', '652258', '652257',  5, 11, 10,  5,  105],
    ['660261', '4257', '660700', '660701', '660700',  1,  4, 16,  5,   36],
    ['660273', '4522', '660592', '660593', '660592',  2,  6, 30, 10,  120],
    ['660956', '4538', '661329', '661330', '661329',  4, 10, 36,  8,  224]
];

var STORED_RUNS = {}, CHAIN_OF = {};
LIVE.forEach(function(r) {
    STORED_RUNS[r[2]] = r[7]; CHAIN_OF[r[2]] = r[4];
    STORED_RUNS[r[3]] = r[8]; CHAIN_OF[r[3]] = r[4];
});

function supplyCtx(extra) {
    var ctx = {
        coverageLinks: function() {
            var out = [];
            LIVE.forEach(function(r) {
                out.push({ cutId: r[2], positionId: r[0], rollsPerRun: r[5] });
                out.push({ cutId: r[3], positionId: r[0], rollsPerRun: r[6] });
            });
            return out;
        },
        positionDemand: function() {
            var d = {};
            LIVE.forEach(function(r) { d[r[0]] = { qty: r[9], orderNo: r[1] }; });
            return d;
        },
        plannedRunsOfCut: function(id) {
            var v = STORED_RUNS[String(id)];
            return v == null ? null : v;
        },
        chainIdOfCut: function(id) { return CHAIN_OF[String(id)] || String(id); },
        dayKeyOfTs: dayKeyOf
    };
    for (var k in (extra || {})) ctx[k] = extra[k];
    return ctx;
}

// ПАРОВОЗ ПЕРЕРАСПРЕДЕЛЯЕТ ПРОХОДЫ ВНУТРИ ЦЕПОЧКИ. Ровно это делает разбиение по дням: сколько
// влезло до потолка — голове, остаток — продолжению (§9). Сумма по цепочке не меняется, поэтому
// баланс нулевой и защита #4645 такой набор пропускает. А обеспечение падает: голова и хвост режут
// разную ширину, и проход, переехавший из хвоста в голову, даёт заказу МЕНЬШЕ штук.
function trainOps(rows) {
    var byChain = {}, updates = [], i = 0;
    (rows || LIVE).forEach(function(r) {
        if (byChain[r[4]]) return;                     // цепочку берём один раз (позиций у неё две)
        byChain[r[4]] = 1;
        var move = Math.floor(r[8] / 2);               // половина хвоста уезжает в голову
        updates.push({ cutId: r[2], planStartTs: at(i * 20), plannedRuns: r[7] + move });
        updates.push({ cutId: r[3], planStartTs: at(i * 20 + 10), plannedRuns: r[8] - move });
        i++;
    });
    return { updates: updates, deletes: [], creates: [] };
}

function opsOf(o) {
    return { updates: (o && o.updates) || [], deletes: (o && o.deletes) || [], creates: (o && o.creates) || [] };
}
function shortfallRules(violations) {
    return (violations || []).filter(function(v) { return v.rule === 'SUPPLY_CONSERVED'; });
}

// ── A. НЕДОСТАЧУ, КОТОРУЮ СОЗДАЁТ НАБОР, ДО БАЗЫ НЕ ДОВОДИМ ─────────────────────────────────
// Боевая форма: паровоз перераспределил проходы внутри цепочки (голова взяла столько, сколько
// влезло до потолка, остаток — хвосту). Проходы СОХРАНЕНЫ, поэтому баланс цепочки нулевой и #4645
// такой набор пропускает; обеспечение при этом падает — переехавший проход режет другую ширину.
var beforeA = shortfallRules(planning.checkPlanInvariants(opsOf({}), supplyCtx(), 'any'));
assert(beforeA.length === 0,
    'A0. хранимый план заказы обеспечивает — недостачи до записи нет',
    JSON.stringify(beforeA.map(function(v) { return v.msg; })));

var one4442 = LIVE.filter(function(r) { return r[1] === '4442'; });
var opsA = trainOps(one4442);
var balA = planning.planWorkBalanceByChain(opsOf({ updates: opsA.updates.slice() }), supplyCtx());
assert(Math.abs(Number(balA['649500']) || 0) < 0.001,
    'A1. паровоз проходов НЕ теряет — баланс цепочки нулевой, и #4645 такой набор пропускает',
    'баланс 649500 = ' + JSON.stringify(balA['649500']));
var shortA = shortfallRules(planning.checkPlanInvariants(trainOps(one4442), supplyCtx(), 'any'));
assert(shortA.length === 1 && Number(shortA[0].shortRolls) > 0,
    'A2. и при этом заказ 4442 недосчитывается штук — недостачу СОЗДАЛ этот набор',
    (shortA[0] || {}).msg);

var rA = planning.guardPlanOps(trainOps(one4442), supplyCtx(), 'auto');
var leftA = (rA.ops.updates || []).filter(function(u) { return CHAIN_OF[String(u.cutId)] === '649500'; });
assert(leftA.length === 0,
    'A. недостача, СОЗДАННАЯ паровозом (заказ 4442), до базы не доходит',
    'осталось операций цепочки 649500: ' + leftA.length + ', снято всего: ' + rA.skipped);

// ── B. УНАСЛЕДОВАННАЯ НЕДОСТАЧА ЗАПИСЬ НЕ БЛОКИРУЕТ ────────────────────────────────────────
// В боевом плане недостача уже стоит (одни и те же 13 позиций на всех четырёх проходах). Если
// храповик начнёт отказывать и за неё, план замрёт: ни поправить, ни улучшить.
var poorRuns = {};
Object.keys(STORED_RUNS).forEach(function(k) { poorRuns[k] = STORED_RUNS[k]; });
poorRuns['649501'] = 10;   // хвост заказа 4442 недосчитывает 10 проходов — недостача УЖЕ в базе
var poorCtx = supplyCtx({ plannedRunsOfCut: function(id) {
    var v = poorRuns[String(id)];
    return v == null ? null : v;
} });
var beforeB = shortfallRules(planning.checkPlanInvariants(opsOf({}), poorCtx, 'any'));
assert(beforeB.length === 1,
    'B0. воспроизведение: недостача стои́т в ХРАНИМОМ плане ещё до операций',
    JSON.stringify(beforeB.map(function(v) { return v.msg; })));

// Набор лишь двигает задание по времени — обеспечения он не касается вовсе.
var innocent = opsOf({ updates: [{ cutId: '649500', planStartTs: at(180), plannedRuns: poorRuns['649500'] }] });
var rB = planning.guardPlanOps(innocent, poorCtx, 'auto');
assert((rB.ops.updates || []).length === 1,
    'B. унаследованная недостача запись НЕ блокирует — набор её не ухудшает, значит проходит',
    'осталось операций: ' + (rB.ops.updates || []).length + ', снято: ' + rB.skipped);

// ── C. ОТКАТ ИДЁТ ЦЕПОЧКОЙ, А НЕ ОДНОЙ ОПЕРАЦИЕЙ ───────────────────────────────────────────
// Снять «плохую» операцию и оставить остальные — это и есть половинчатая запись, из-за которой
// заведены #4536/#4645: голова осталась с новыми проходами, а хвост — со старыми, и работа
// цепочки посчиталась дважды.
var one4472 = LIVE.filter(function(r) { return r[1] === '4472'; });
var rC = planning.guardPlanOps(trainOps(one4472), supplyCtx(), 'auto');
var leftC = (rC.ops.updates || []).filter(function(u) { return CHAIN_OF[String(u.cutId)] === '652642'; });
assert(leftC.length === 0,
    'C. откат снимает ВСЕ операции цепочки — и правку головы, и правку хвоста (#4536)',
    'осталось операций цепочки 652642: ' + leftC.length);

// ── D/E. CHAIN_CONTIGUOUS ТЕМ ЖЕ ХРАПОВИКОМ ────────────────────────────────────────────────
// Боевое: «части задания разорваны: между 662289 и 669328 вклинилось: 666716».
function chainSnapCtx(rows) {
    return {
        planSnapshot: function() { return rows; },
        dayKeyOfTs: dayKeyOf,
        chainIdOfCut: function(id) {
            var hit = rows.filter(function(r) { return String(r.id) === String(id); })[0];
            return hit ? String(hit.chainId) : String(id);
        }
    };
}
// Хранимый план: части 662289 и 669328 одной цепочки стоят ПОДРЯД — разрыва нет.
var intactRows = [
    { id: '662289', slitterId: '1279', planStartTs: at(0), chainId: '662289' },
    { id: '669328', slitterId: '1279', planStartTs: at(30), chainId: '662289' },
    { id: '666716', slitterId: '1279', planStartTs: at(60), chainId: '666716' }
];
var ctxD = chainSnapCtx(intactRows);
var beforeD = planning.checkPlanInvariants(opsOf({}), ctxD, 'any')
    .filter(function(v) { return v.rule === 'CHAIN_CONTIGUOUS'; });
assert(beforeD.length === 0, 'D0. в хранимом плане части задания идут подряд — разрыва нет');

// Набор вклинивает чужое задание между частями — ровно боевая строка журнала.
var breaking = opsOf({ updates: [{ cutId: '666716', planStartTs: at(15), plannedRuns: 3 }] });
var rD = planning.guardPlanOps(breaking, ctxD, 'auto');
assert((rD.ops.updates || []).length === 0,
    'D. разрыв цепочки, СОЗДАННЫЙ набором, до базы не доходит',
    'осталось операций: ' + (rD.ops.updates || []).length);

// Хранимый план УЖЕ разорван — набор, который его не ухудшает, проходит.
var brokenRows = [
    { id: '662289', slitterId: '1279', planStartTs: at(0), chainId: '662289' },
    { id: '666716', slitterId: '1279', planStartTs: at(15), chainId: '666716' },
    { id: '669328', slitterId: '1279', planStartTs: at(30), chainId: '662289' }
];
var ctxE = chainSnapCtx(brokenRows);
var beforeE = planning.checkPlanInvariants(opsOf({}), ctxE, 'any')
    .filter(function(v) { return v.rule === 'CHAIN_CONTIGUOUS'; });
assert(beforeE.length === 1, 'E0. воспроизведение: разрыв стои́т в хранимом плане');
var harmless = opsOf({ updates: [{ cutId: '666716', planStartTs: at(20), plannedRuns: 3 }] });
var rE = planning.guardPlanOps(harmless, ctxE, 'auto');
assert((rE.ops.updates || []).length === 1,
    'E. унаследованный разрыв запись не блокирует — набор его не ухудшает',
    'осталось операций: ' + (rE.ops.updates || []).length + ', снято: ' + rE.skipped);

// ── F/G. ХРАПОВИК ОБЪЯВЛЕН, И ОН — НЕ РЕЖИМ ────────────────────────────────────────────────
// Ось `gate` ортогональна `mode`: причина, по которой оба правила остаются наблюдателями
// (выброшенная ОПЕРАЦИЯ ничего не чинит), верна и не отменяется. Храповик работает НАБОРОМ.
var byId = {};
(planning.invariants || []).forEach(function(r) { if (r && r.id) byId[r.id] = r; });
['SUPPLY_CONSERVED', 'CHAIN_CONTIGUOUS'].forEach(function(id) {
    var r = byId[id];
    assert(!!r && r.gate === 'ratchet',
        'F. ' + id + ': храповик объявлен полем gate', 'gate=' + JSON.stringify(r && r.gate));
    assert(!!r && r.mode === 'audit' && r.drop === undefined,
        'F2. ' + id + ': режим не подменён — правило по-прежнему наблюдатель без drop',
        'mode=' + (r && r.mode) + ' drop=' + typeof (r && r.drop));
});
// Правило БЕЗ gate храповиком не ограничено: DAY_FILL нарушается любым недобранным днём, и
// объявлять из-за него откат нельзя — иначе выравнивание никогда не запишет свой результат.
assert(byId.DAY_FILL && byId.DAY_FILL.gate === undefined,
    'G. правило без объявленного gate храповиком не ограничено (наблюдатели ведут себя как были)',
    'DAY_FILL.gate=' + JSON.stringify(byId.DAY_FILL && byId.DAY_FILL.gate));

// ── H. МОЛЧАНИЯ НЕТ ────────────────────────────────────────────────────────────────────────
assert(Object.prototype.toString.call(rA.ratchetChains) === '[object Array]' && rA.ratchetChains.length > 0,
    'H. страж возвращает откаченные цепочки вызывающему — оператору есть что сказать (ТЗ §14)',
    'ratchetChains=' + JSON.stringify(rA.ratchetChains));

// ── I. БОЕВОЙ КЕЙС ЦЕЛИКОМ ─────────────────────────────────────────────────────────────────
// «После паровоза объём заказа не должен уменьшаться и цепочка не должна рваться» — регресс на
// весь список тикета: станки 1279/1282, день 20260813, одиннадцать заказов.
var rI = planning.guardPlanOps(trainOps(), supplyCtx(), 'auto');
var afterI = shortfallRules(planning.checkPlanInvariants(rI.ops, supplyCtx(), 'any'));
assert(afterI.length === 0,
    'I. после паровоза объём заказа не уменьшился ни по одному из 11 заказов тикета',
    'осталось недообеспеченных позиций: ' + afterI.length + ' — '
        + JSON.stringify(afterI.map(function(v) { return v.orderNo + '/' + v.shortRolls; })));

console.log('\n' + passed + '/' + total + ' проверок прошло');
if (passed !== total) process.exitCode = 1;
