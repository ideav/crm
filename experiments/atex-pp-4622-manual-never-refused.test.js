// issue #4622: РУЧНОЕ ДЕЙСТВИЕ НЕ ПОЛУЧАЕТ ОТКАЗА + пометка дня меряет тем, что показывает.
//
// Боевое (ateh, 05.08.2026). Диспетчер нажал «Упорядочить» — не изменилось НИЧЕГО:
//   [pp-opt] текущий план: опозданий 1642 дн, переналадка 6630 мин
//   [pp-opt] КАНДИДАТ B: опозданий 1641 дн, переналадка 6475 мин, недоупаковано дней 0
//                        НАРУШЕНИЙ ТЗ §15: 2 → ХУЖЕ: применять нельзя
//   [pp-opt] ВЫБОР: НЕТ — план НЕ трогаем
// Кандидат был ЛУЧШЕ по всем меркам и вдобавок чинил главный перебор (Станок 2, 10.08:
// 620 → 537 мин). Отвергли его за DAY_CAPACITY — нарушение, которое он НЕ вносил: в записанном
// плане таких станко-дней было ДЕВЯТЬ. Причина в одной строке объектива:
//     before = combined(dtBefore.length, 0, …)   // у хранимого плана нарушения приняты за НОЛЬ
//     objB   = combined(dtB.length, rbB.length, …)  // кандидат платит 1e12 за то же самое
// План, однажды попавший за потолок, запирался НАВСЕГДА.
//
// Решение заказчика (02.08 и 05.08.2026): «если ручное действие говорит, что надо что-то
// подвинуть в будущее — двигаем безусловно». Правило касается ПОТОЛКА ДНЯ: нехватка места —
// причина ПЕРЕНОСА работы вперёд, а не запрета записать план. Пороки самого кандидата
// (🔒-монолит, разорванная цепочка, обеспечение) ветируют как ветировали.
//
// Второй симптом того же дня: тост ругался «458 мин при потолке 455», а шапка дня показывала
// «(456 мин)» спокойным цветом — заказчик решил, что подсветка сломалась. Виноват допуск
// `loadMin > cap + 1`: перебор ровно в 1 минуту пометку не зажигал.
//
//   A — пометка дня зажигается при переборе +1 (456 при 455);
//   B — ровно потолок (455) переполнением НЕ считается;
//   C — большой перебор помечается и число совпадает с тем, что покажут (overMin);
//   D — вердикт: УНАСЛЕДОВАННЫЙ перебор дней (2 при 9 в плане) отказом НЕ является;
//   E — вердикт: ДОБАВЛЕННЫЙ перебор (10 при 9) отвергается, и 🔒-монолит ветирует ВСЕГДА —
//       правило сужено до DAY_CAPACITY, прочие жёсткие правила §15 не ослаблены (#4471/#4464).
//
// Run with: node experiments/atex-pp-4622-manual-never-refused.test.js

process.env.TZ = 'UTC';
global.window = { db: 'ateh', xsrf: 'x' };
var P = require('../download/atex/js/production-planning.js').planning;

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

// Окно смены как в боевой ateh: 08:00–16:10, обед 40 мин, нахлёст 5 → ёмкость резки 455.
var BASE = Date.UTC(2026, 7, 6);
var WIN = { baseMidnightMs: BASE, dayStartMin: 8 * 60, cutEndMin: 16 * 60 + 10,
            lunchStartMin: 12 * 60 + 20, lunchDurationMin: 40, maxOverworkCutsMin: 5 };
// задание дня: хранимые колонки (наладка + намотка + «Резка и Лидер») дают занятость дня —
// ровно та сумма, что стои́т в бейдже «(N мин)» рядом с датой.
function cut(id, minutes, atMin) {
    return { id: String(id), planDate: String(Math.floor((BASE + (atMin || 8 * 60) * 60000) / 1000)),
             storedKnifeSetupMin: 0, storedMaterialWindingMin: 0, storedCutAndLeaderMin: minutes };
}
function overDays(totalMinutes) {
    return P.overfilledDaysFromCuts([cut(1, totalMinutes, 8 * 60)], WIN);
}

// ── A. Перебор ровно на минуту: боевой случай Станка 1 на 06.08.
(function () {
    var d = overDays(456);
    assert(d.length === 1 && d[0].overMin === 1,
        'A: 456 мин при потолке 455 — день ПОМЕЧЕН как переполненный (+1)', JSON.stringify(d.map(function(x){ return x.overMin; })));
})();

// ── B. Ровно потолок — не переполнен (иначе бы кричали на каждый полный день).
(function () {
    var d = overDays(455);
    assert(d.length === 0, 'B: 455 мин при потолке 455 — переполнением НЕ считается', JSON.stringify(d));
})();

// ── C. Большой перебор: число в пометке = число, которое показывают оператору.
(function () {
    var d = overDays(488);
    assert(d.length === 1 && d[0].overMin === 33 && d[0].loadMin === 488,
        'C: 488 при 455 — помечен, перебор 33 мин (то же число, что в тосте)',
        d.length ? JSON.stringify({ loadMin: d[0].loadMin, overMin: d[0].overMin }) : '—');
})();

// ── D/E. Вердикт «Упорядочить»: унаследованный перебор дней — не отказ, чужие правила — отказ.
// Зовём НАСТОЯЩИЙ код (formatOptimizeTrace выносит вердикт и печатает его строкой). Числа боевые:
// текущий план — 1642 дн опозданий и 9 переполненных станко-дней; кандидат B — 1641 дн, 6475 мин.
function cap(n) { var a = []; for (var i = 0; i < n; i++) a.push({ rule: 'DAY_CAPACITY', msg: 'день ' + i }); return a; }
function verdictOf(candidateBreaks, capacityBreaksBefore) {
    var lines = P.formatOptimizeTrace({
        start: { cutCount: 237, fixedCount: 224, slitterCount: 4, windowLabel: '06.08.2026 – 06.08.2026',
                 lateBefore: 1642, coBefore: 6630, downtimeBefore: 0, underfilledBefore: 1,
                 capacityBreaksBefore: capacityBreaksBefore },
        candidates: [{ key: 'B', title: 'порядок/дни на текущих станках', late: 1641, changeover: 6475,
                       downtime: 0, underfilled: 0, ruleBreaks: candidateBreaks.length,
                       ruleBreakList: candidateBreaks }]
    });
    // Берём ВСЮ строку кандидата: внутри вердикта тоже есть «→», захват по стрелке отрезал бы начало.
    var m = /КАНДИДАТ B[^\n]*/.exec((lines || []).join('\n'));
    return m ? m[0] : '';
}
(function () {
    var v = verdictOf(cap(2), 9);
    assert(!/применять нельзя/.test(v),
        'D: перебор дней УНАСЛЕДОВАН (2 при 9 в плане) — отказа НЕТ (боевой случай #4622)', v);
    assert(/ЛУЧШЕ/.test(v), 'D2: и кандидат признан ЛУЧШЕ — опозданий меньше', v);

    var v2 = verdictOf(cap(9), 9);
    assert(!/применять нельзя/.test(v2), 'D3: столько же переполненных дней, сколько в плане — отказа НЕТ', v2);

    var v3 = verdictOf(cap(10), 9);
    assert(/применять нельзя/.test(v3),
        'E: кандидат ДОБАВЛЯЕТ переполненный день (10 при 9) — отказ ОСТАЁТСЯ', v3);

    // #4471/#4464: 🔒-монолит — порок САМОГО кандидата, вето по нему абсолютное и от базы не зависит.
    var v4 = verdictOf([{ rule: 'FIXED_BLOCK', msg: 'между 🔒 вклинилось' }], 9);
    assert(/применять нельзя/.test(v4),
        'E2: сломанный 🔒-монолит ветирует ВСЕГДА, даже при 9 переполненных днях в плане', v4);

    var v5 = verdictOf(cap(1), 0);
    assert(/применять нельзя/.test(v5),
        'E3: чистый план + кандидат с переполненным днём — отказ ОСТАЁТСЯ', v5);
})();

console.log('\n' + passed + '/' + total + ' пройдено');
