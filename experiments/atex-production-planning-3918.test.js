// Unit tests for #3918 — follow-up к #3916/#3917: «Время 571 мин и разбиение в 17:00».
//
// Симптом (боевой лог ateh, Станок 1, Чт 02.07.2026): бейдж дня = 571 мин при ёмкости ≈450,
// карточки лезут за конец смены (17:01, 20:03, 23:31). На день 02.07 легли 8 заданий (571 мин),
// хотя splitMachineQueue при генерации давал день ≤475. Из stored planStart видно ДВА
// НЕЗАВИСИМЫХ РАСПИСАНИЯ на одном дне: продолжение разбитой по дням резки día-0 (chain 233844:
// 30 проходов día0 + 52 продолжения) село на 02.07 08:00, а «свежие» резки día1 (MR192/MWR200…)
// упакованы с 08:12 — обе цепочки начинаются в 08:00 и НАКЛАДЫВАЮТСЯ.
//
// Корень: пост-генерационная пересборка (autoSequenceQueue → planCutOperations) идёт в SCOPE
// фильтра дат (#3660). Узкий фильтр (напр. [01.07;01.07]) оставляет día1 ВНЕ scope: цепочка
// día0, чьё ПРОДОЛЖЕНИЕ по дроблению переливается на día1, планируется в изоляции и кладёт
// продолжение в día1 08:00 — как будто día1 пуст. Но собственные (вне scope) резки día1 НЕ
// перепланируются и остаются на своих pass-1 стартах с 08:00. Итог: día1 = продолжение +
// свежие резки = переполнение, нахлёст, каскад в scheduleFromStored до 23:31.
//
// Инвариант фикса: генерация (splitMachineQueue) даёт день ≤ ёмкости; продолжение цепочки día0,
// переходящее на día1, НЕ должно накладываться на резки día1 (день не переполняется сверх
// ёмкости из-за границы scope).
//
// Run with: node experiments/atex-production-planning-3918.test.js

process.env.TZ = 'Europe/Moscow';

var planning = require('../download/atex/js/production-planning.js').planning;

var passed = 0, failed = 0;
function assert(cond, name) {
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else { failed++; process.exitCode = 1; }
}

var BASE = new Date(2026, 6, 1, 0, 0, 0).getTime();   // día 0 = 01.07, día 1 = 02.07
var DAY0_KEY = 20260701, DAY1_KEY = 20260702;
var CAP = 450;                                          // ёмкость окна резки (мин)
var DAY_SEC = 86400;
var baseSec = Math.floor(BASE / 1000);

// Резка: perPass=min/проход, setup нулевой (times нулевые), окно дня = CAP. planDate — día якоря.
function cut(id, dayOffset, runs, perPassMin, matSig) {
    return {
        id: id, slitter: { id: 'm1' }, materialId: matSig, winding: 'OUT',
        knifeWidths: [String(matSig)], knifeCount: 1, plannedRuns: runs,
        planDate: String(baseSec + dayOffset * DAY_SEC), sequence: null, isFoil: false,
        _perPass: perPassMin
    };
}

// Прогон planCutOperations с заданным scope. Возвращает { updates, creates } + карту día старта.
function run(cuts, scopeFrom, scopeTo) {
    var perPass = {}; cuts.forEach(function(c){ perPass[c.id] = c._perPass; });
    var anchor = {}; cuts.forEach(function(c){ anchor[String(c.id)] = Math.round((Number(c.planDate) - baseSec) / DAY_SEC); });
    return planning.planCutOperations(cuts, {
        perPassByCut: perPass, dayStartMin: 0, dayEndMin: CAP,
        times: { BETWEEN_CUTS: 0, MATERIAL_WINDING: 0, KNIFE: 0 },
        planBaseMidnightMs: BASE, preserveOrder: false, gapFill: true,
        dayAnchorByCut: anchor,
        scopeFromKey: scopeFrom, scopeToKey: scopeTo
    });
}
function tsDay(ts){ return Math.floor((Number(ts) - baseSec) / DAY_SEC); }
function tsMinOfDay(ts){ return Math.round((Number(ts) - baseSec - tsDay(ts) * DAY_SEC) / 60); }

// Собрать «сохранённое» расписание как в бою: сегменты in-scope цепочек берём из ops
// (перепланированы), out-of-scope резки — по их СОБСТВЕННОМУ planDate (pass-1, не тронуты).
function storedSegments(cuts, ops, scopeFrom, scopeTo) {
    var inScopeIds = {};
    ops.updates.forEach(function(u){ inScopeIds[String(u.cutId)] = true; });
    var segs = [];
    ops.updates.forEach(function(u){ segs.push({ id: u.cutId, day: tsDay(u.planStartTs), min: tsMinOfDay(u.planStartTs), runs: u.plannedRuns, perPass: perPassOf(cuts, u.cutId) }); });
    (ops.creates || []).forEach(function(cr){ segs.push({ id: String(cr.parentCutId) + '~cont', day: tsDay(cr.planStartTs), min: tsMinOfDay(cr.planStartTs), runs: cr.plannedRuns, perPass: perPassOf(cuts, cr.parentCutId) }); });
    // out-of-scope резки: их запись НЕ переписана — остаётся на исходном planDate (día якоря, 08:00).
    cuts.forEach(function(c){
        var k = planning.planDateDayKey ? null : null;   // (scope считаем по anchor día ниже)
        var day = Math.round((Number(c.planDate) - baseSec) / DAY_SEC);
        var dayKey = day === 0 ? DAY0_KEY : (day === 1 ? DAY1_KEY : (20260701 + day));
        var inRange = (scopeFrom == null || dayKey >= scopeFrom) && (scopeTo == null || dayKey <= scopeTo);
        if (!inRange && !inScopeIds[String(c.id)]) {
            segs.push({ id: c.id, day: day, min: 0, runs: c.plannedRuns, perPass: c._perPass });   // pass-1 старт día*08:00
        }
    });
    return segs;
}
function perPassOf(cuts, id){ for (var i=0;i<cuts.length;i++) if (String(cuts[i].id)===String(id)) return cuts[i]._perPass; return 0; }

// Минуты, занятые в дне D (сумма длительностей сегментов дня) — «бейдж дня».
function dayMinutes(segs, D) {
    return segs.filter(function(s){ return s.day === D; })
        .reduce(function(a, s){ return a + s.runs * s.perPass; }, 0);
}

// ── Сцена #3918 ──
// Станок m1. Chain H (día0): 90 проходов × 10 мин = 900 мин → día0 45п(450) + продолжение día1 45п(450)...
// возьмём так, чтобы продолжение было ЧАСТИЧНЫМ: H = 60 проходов × 10 = 600 → día0 45п(450) + cont día1 15п(150).
// Плюс своя резка X día1: 40 проходов × 10 = 400 мин.
// Полный план (scope шире): día1 = cont(150) + X(300 из 400) = 450 (X добивает día2 100). Ни нахлёста, ни переполнения.
// Узкий scope [día0;día0]: обрабатываем только H → cont села на día1 08:00 (150). X ВНЕ scope, стоит на día1 08:00 (400).
//   → día1 = 150 + 400 = 550 (ПЕРЕПОЛНЕНИЕ), cont и X оба с 08:00 — нахлёст.
function scene() {
    return [ cut('H', 0, 60, 10, 'MH'), cut('X', 1, 40, 10, 'MX') ];
}

// 1) Полный scope (null) — согласованный план: día1 не переполнен.
var full = run(scene(), null, null);
var fullSegs = storedSegments(scene(), full, null, null);
var fullDay1 = dayMinutes(fullSegs, 1);
console.log('  [полный scope] día1 =', fullDay1, 'мин; сегменты día1:', JSON.stringify(fullSegs.filter(function(s){return s.day===1;})));
assert(fullDay1 <= CAP, '#3918: при полном scope día1 (' + fullDay1 + ') ≤ ёмкости ' + CAP);

// 2) Узкий scope [día0;día0] — воспроизводит баг: día1 переполнен (продолжение día0 + резка día1).
var narrow = run(scene(), DAY0_KEY, DAY0_KEY);
var narrowSegs = storedSegments(scene(), narrow, DAY0_KEY, DAY0_KEY);
var narrowDay1 = dayMinutes(narrowSegs, 1);
console.log('  [узкий scope] día1 =', narrowDay1, 'мин; сегменты día1:', JSON.stringify(narrowSegs.filter(function(s){return s.day===1;})));
// Демонстрация бага (до фикса): narrowDay1 > CAP и нахлёст двух сегментов с min=0.
var day1Starts = narrowSegs.filter(function(s){ return s.day === 1; }).map(function(s){ return s.min; });
var overlapAt0 = day1Starts.filter(function(m){ return m === 0; }).length >= 2;
console.log('  [узкий scope] стартов в 08:00 на día1:', day1Starts.filter(function(m){return m===0;}).length, '(нахлёст:', overlapAt0, ')');

// Инвариант фикса: día1 при узком scope НЕ должен переполняться (продолжение día0 учитывает резки día1).
assert(narrowDay1 <= CAP, '#3918 ФИКС: узкий scope — día1 (' + narrowDay1 + ') ≤ ёмкости ' + CAP + ' (продолжение día0 не накладывается на резки día1)');

// 3) #3660 сохранён: ДАЛЬНЯЯ резка (за зазором, куда продолжение НЕ дотягивается) при узком
//    scope НЕ перепланируется. H(día0) переливается только на día1; Z стоит на día5 — между
//    ними пустые дни. Расширение границы должно остановиться на día1, Z остаться нетронутой.
function sceneGap() {
    // H: 60 проходов × 10 → día0(45п=450) + продолжение día1(15п=150). Z: día5, 10 проходов.
    return [ cut('H', 0, 60, 10, 'MH'), cut('Z', 5, 10, 10, 'MZ') ];
}
var gapOps = run(sceneGap(), DAY0_KEY, DAY0_KEY);
var touchedIds = {};
gapOps.updates.forEach(function(u){ touchedIds[String(u.cutId)] = true; });
(gapOps.creates || []).forEach(function(cr){ touchedIds[String(cr.parentCutId)] = true; });
console.log('  [#3660 зазор] тронутые цепочки:', Object.keys(touchedIds).join(',') || '—');
assert(touchedIds['H'] && !touchedIds['Z'],
    '#3660 сохранён: узкий scope + зазор — тронута только цепочка día0 (H); дальняя día5 (Z) НЕ перепланирована');
// Продолжение H всё же переехало на día1 (спил в следующий день — разрешён #3660).
var hCont = (gapOps.creates || []).concat(gapOps.updates).filter(function(o){ return String(o.parentCutId || '') === 'H'; });
assert(hCont.length >= 1 && hCont.some(function(o){ return tsDay(o.planStartTs) === 1; }),
    '#3660: продолжение H легло на día1 (перелив в следующий день сохранён)');

console.log('\n' + (failed ? ('ПРОВАЛЕНО: ' + failed) : 'Все проверки пройдены') + ' (passed ' + passed + ')');
