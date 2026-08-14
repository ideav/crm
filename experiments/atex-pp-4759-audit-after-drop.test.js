// #4759 — СТРАЖ СУДИЛ ПЛАН, КОТОРЫЙ САМ ЖЕ РАЗБИРАЛ.
//
// СИМПТОМ. Оператор получает «станок N, день D: 475 мин при потолке 455», а записанный план этого
// дня не создаёт: в нём остаётся 150 минут. Замер фаззером (`atex-pp-invariants-fuzz`, 120 планов ×
// 5 входов): из 78 срабатываний DAY_CAPACITY **8 приходятся на дни, чьи операции страж снял**,
// то есть описывают план, которого не будет. Остальные 70 — про дни, которые упаковщик и правда
// грузит сверх потолка (их судьба — в вопросе о самом потолке, 455 против 460).
//
// ПРИЧИНА — ДВЕ, И ОБЕ ПРО ОДНО «РАНО».
//   1. Правила-наблюдатели считались в `guardPlanOpsWith` ДО отбрасывания:
//        var violations = checkRules(rules, ops, ctx, who);   // ← здесь
//        ...
//        ops.updates = (ops.updates || []).filter(keep);      // ← а выбрасываем здесь
//      Отчёт описывал набор, которого не будет.
//   2. `DAY_CAPACITY` берёт занятость из `ops.dayLoad` — мерки УПАКОВЩИКА, которая после
//      отбрасывания не пересчитывается вовсе и пересчитана снаружи быть не может: гейт потолка
//      (обед, простои, атомарность прохода) знает только он.
//
// Боевая форма: день заморожен, движок вытащил из него работу в соседний день и насчитал там
// перебор; страж эти операции снял (FROZEN_DAY, режим `drop`) — а перебор остался в отчёте
// (`FUZZ_SEED=20886415`: до стража 475, после — 150, `ops.dayLoad` по-прежнему 475).
//
// РЕШЕНИЕ. Судим ТО, ЧТО УЙДЁТ В БАЗУ:
//   • отчёт стража считается ПОСЛЕ отбрасывания (набор, который запишется). Причина отбрасывания
//     не теряется — она отдаётся отдельно, `violationsBeforeDrop`, и идёт в журнал;
//   • станко-день, у которого страж СНЯЛ операции, правилом потолка НЕ СУДИТСЯ: число занятости
//     ему больше не соответствует, а честно пересчитать его снаружи нельзя. Промолчать здесь
//     правильнее, чем соврать: день пересматривается следующей записью, уже с верной меркой.
//
// ЧТО ПРОВЕРЯЕМ:
//   A — воспроизведение: до правки перебор попадал в отчёт, хотя операции дня были сняты;
//   B — станко-день со снятыми операциями в отчёт о переборе не попадает;
//   C — станко-день, чьи операции ЦЕЛЫ, судится как раньше (правило не выключено);
//   D — причина отбрасывания не потеряна: FROZEN_DAY виден в полном отчёте `violations`;
//   E — страж называет снятые операции вызывающему (`ops.droppedOps`) — по ним и считается B;
//   F — набор без отбрасывания ведёт себя как раньше: отчёт совпадает с «до».
//
// Run with: node experiments/atex-pp-4759-audit-after-drop.test.js

process.env.TZ = 'UTC';
global.window = { db: 'ateh1', xsrf: 'x' };
var planning = require('../download/atex/js/production-planning.js').planning;

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

var FROZEN = 20260814, FREE = 20260813;
var TS_FREE = Math.floor(Date.UTC(2026, 7, 13, 8, 0, 0) / 1000);
var TS_FROZEN = Math.floor(Date.UTC(2026, 7, 14, 8, 0, 0) / 1000);
function dayKeyOf(ts) {
    var d = new Date(Number(ts) * 1000);
    return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
}

// Задание 1 стои́т в ЗАМОРОЖЕННОМ дне; план хочет перетащить его в свободный день станка 1277 и
// этим переполняет его. Задание 2 — в свободном дне, его операция законна.
var STORED_DAY = { '1': FROZEN, '2': FREE };
var SID_OF = { '1': '1277', '2': '1277', '9': '1279' };

function ctxWith(load) {
    return {
        isFrozenCut: function(id) { return STORED_DAY[String(id)] === FROZEN; },
        isFrozenTs: function(ts) { return dayKeyOf(ts) === FROZEN; },
        isFixedCut: function() { return false; },
        dayKeyOfCut: function(id) { return STORED_DAY[String(id)] || null; },
        dayKeyOfTs: dayKeyOf,
        chainIdOfCut: function(id) { return String(id); },
        plannedRunsOfCut: function() { return 10; },
        dayCapacityMin: function() { return 455; },
        // Мерка УПАКОВЩИКА: он считал занятость по СВОЕЙ раскладке, до стража.
        dayLoadMinutes: function() { return load; },
        fixedHeldDays: function() { return []; }
    };
}
function opsFor() {
    return {
        updates: [
            { cutId: '1', planStartTs: TS_FREE, plannedRuns: 10, occMin: 320, slitterId: '1277' },  // из замороженного дня — страж снимет
            { cutId: '2', planStartTs: TS_FREE, plannedRuns: 10, occMin: 155, slitterId: '1277' },
            { cutId: '9', planStartTs: TS_FREE, plannedRuns: 10, occMin: 470, slitterId: '1279' }   // чужой станок, операция законна
        ],
        deletes: [], creates: []
    };
}
// Упаковщик насчитал: 1277 переполнен (475) и 1279 переполнен (470).
function loadMap(pairs) {
    var m = {};
    pairs.forEach(function(p) { m[p[0] + '|' + FREE] = p[1]; });
    return m;
}
var LOAD = loadMap([['1277', 475], ['1279', 470]]);

function capacityOf(list) {
    return (list || []).filter(function(v) { return v.rule === 'DAY_CAPACITY'; })
        .map(function(v) { return String(v.slitterId); }).sort();
}

// ── A. ВОСПРОИЗВЕДЕНИЕ ──────────────────────────────────────────────────────────────────────
var pre = planning.checkPlanInvariants(opsFor(), ctxWith(LOAD), 'auto');
assert(String(capacityOf(pre)) === String(['1277', '1279']),
    'A. воспроизведение: до стража перебор виден на ОБОИХ станках',
    JSON.stringify(capacityOf(pre)));

// ── B/C/D/E. ПОСЛЕ СТРАЖА ───────────────────────────────────────────────────────────────────
var ops = opsFor();
var g = planning.guardPlanOps(ops, ctxWith(LOAD), 'auto');
assert(g.skipped >= 1,
    'E0. страж снял операцию по замороженному дню', 'снято: ' + g.skipped);
assert(g.ops.updates.length === 2
       && g.ops.updates.every(function(u) { return String(u.cutId) !== '1'; }),
    'E1. в наборе осталось только законное', JSON.stringify(g.ops.updates.map(function(u) { return u.cutId; })));

var dropped = (ops.droppedOps && ops.droppedOps.updates) || [];
assert(dropped.length === 1 && String(dropped[0].cutId) === '1',
    'E. страж называет снятые операции вызывающему (ops.droppedOps)',
    JSON.stringify(dropped.map(function(u) { return u.cutId; })));

assert(capacityOf(g.violationsAfterDrop).indexOf('1277') < 0,
    'B. станко-день со СНЯТЫМИ операциями правилом потолка НЕ судится — ложной тревоги нет',
    'в отчёте: ' + JSON.stringify(capacityOf(g.violationsAfterDrop)));
assert(capacityOf(g.violationsAfterDrop).indexOf('1279') >= 0,
    'C. станко-день, чьи операции ЦЕЛЫ, судится как раньше — правило не выключено',
    'в отчёте: ' + JSON.stringify(capacityOf(g.violationsAfterDrop)));
assert((g.violations || []).some(function(v) { return v.rule === 'FROZEN_DAY'; }),
    'D. причина отбрасывания не потеряна — FROZEN_DAY есть в полном отчёте',
    JSON.stringify((g.violations || []).map(function(v) { return v.rule; })));

// ── F. БЕЗ ОТБРАСЫВАНИЯ — КАК РАНЬШЕ ────────────────────────────────────────────────────────
var clean = { updates: [{ cutId: '2', planStartTs: TS_FREE, plannedRuns: 10, occMin: 155, slitterId: '1277' }],
              deletes: [], creates: [] };
var gc = planning.guardPlanOps(clean, ctxWith(loadMap([['1277', 475]])), 'auto');
assert(gc.skipped === 0 && capacityOf(gc.violationsAfterDrop).indexOf('1277') >= 0,
    'F. ничего не снято — отчёт прежний, перебор назван',
    'снято: ' + gc.skipped + ', в отчёте: ' + JSON.stringify(capacityOf(gc.violationsAfterDrop)));

console.log('\n' + passed + '/' + total + ' проверок прошло');
if (passed !== total) process.exitCode = 1;
