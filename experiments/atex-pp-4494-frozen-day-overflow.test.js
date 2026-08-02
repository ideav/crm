// Tests for ideav/crm#4494 — потолок дня сильнее ЗАМОРОЗКИ на пути ручного переноса.
//
// Боевой случай (ateh, Станок 3, 28.07.2026 — день стои́т в таблице «Заморозка»): оператор перенёс
// туда задание 648931 (100 проходов, 410 мин), и день стал 761 мин при потолке 460. Планировщик
// разрыв СЧИТАЕТ правильно (задание замороженного дня закреплено #4326 → ветка fixedDay рвёт его по
// потолку, #4304/#4467), но записи не доходят до базы: страж `guardPlanOps` отбрасывает ЛЮБУЮ
// операцию по заданию замороженного дня (правило FROZEN_DAY, enforce) — в том числе ту, что просто
// уменьшает число проходов, никуда задание не двигая. Отсюда «План записан как есть».
//
// Правило (ТЗ §15, решение заказчика 29.07.2026): день не может быть длиннее смены. Задание,
// которое ОПЕРАТОР вручную перенёс в замороженный день, занимает там ровно столько, сколько есть,
// а остаток уезжает продолжением на ближайший свободный день. Заморозка при этом цела: чужие
// задания замороженного дня не двигаются, новые в него не кладутся, ничего не удаляется.
//
// Покрываем:
//   1) ПРАВИЛО (общий тест): страж пропускает РАЗРЫВ ПО ПОТОЛКУ задания ручного переноса —
//      update в ЕГО ЖЕ дне и create продолжения вне замороженного дня;
//   2) заморозка цела: перенос этого задания в другой день, операции по ЧУЖИМ заданиям
//      замороженного дня, удаление и новые задания в замороженный день — по-прежнему отбрасываются;
//   3) без признака ручного переноса (обычная пересборка) поведение прежнее — всё отбрасывается;
//   4) нарушение по-прежнему видно в отчёте стража (violations), даже когда операция пропущена.
//
// Run with: node experiments/atex-pp-4494-frozen-day-overflow.test.js

process.env.TZ = 'Europe/Moscow';

global.document = {
    createElement: function () { return { style: {}, dataset: {}, classList: { add: function () {}, remove: function () {}, contains: function () { return false; }, toggle: function () {} }, appendChild: function () {}, setAttribute: function () {}, addEventListener: function () {}, childNodes: [] }; },
    createTextNode: function () { return {}; },
    body: { appendChild: function () {} }, readyState: 'loading', getElementById: function () { return null; }, addEventListener: function () {}
};
global.window = { db: 'testdb' };

var mod = require('../download/atex/js/production-planning.js');
var planning = mod.planning;

var passed = 0, total = 0;
function assert(cond, name) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    total++;
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; } else {
        console.log('  expected:', JSON.stringify(expected));
        console.log('  actual:  ', JSON.stringify(actual));
        process.exitCode = 1;
    }
}

// День 28.07.2026 заморожен, 29.07 — свободен.
var FROZEN_DAY_KEY = 20260728, FREE_DAY_KEY = 20260729;
function tsOf(y, m, d, hh, mm) { return Math.floor(new Date(y, m - 1, d, hh, mm, 0, 0).getTime() / 1000); }
var TS_FROZEN = tsOf(2026, 7, 28, 8, 0);          // старт в замороженном дне
var TS_FROZEN_LATE = tsOf(2026, 7, 28, 15, 1);    // он же, позже в том же дне
var TS_FREE = tsOf(2026, 7, 29, 8, 0);            // следующий, свободный день

// MOVED — задание, которое оператор ВРУЧНУЮ перенёс в замороженный день (moveScope.wholeDayCutIds).
// OTHER — чужое задание того же замороженного дня.
function ctxOf(opts) {
    var manual = (opts && opts.manual) || [];
    return {
        isFrozenCut: function (id) { return String(id) === 'MOVED' || String(id) === 'OTHER'; },
        isFrozenTs: function (ts) { return dayKeyOfTs(ts) === FROZEN_DAY_KEY; },
        isFixedCut: function (id) { return String(id) === 'MOVED' || String(id) === 'OTHER'; },
        dayKeyOfCut: function (id) { return (String(id) === 'MOVED' || String(id) === 'OTHER') ? FROZEN_DAY_KEY : FREE_DAY_KEY; },
        dayKeyOfTs: dayKeyOfTs,
        isManualMoveCut: function (id) { return manual.map(String).indexOf(String(id)) !== -1; }
    };
}
function dayKeyOfTs(ts) {
    var d = new Date(Number(ts) * 1000);
    return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}
function opsOf() {
    return {
        // Разрыв по потолку: у перенесённого задания остаётся часть проходов, В ЕГО ЖЕ дне.
        updates: [{ cutId: 'MOVED', planStartTs: TS_FROZEN_LATE, plannedRuns: 30 }],
        // Остаток — продолжением на следующий (свободный) день.
        creates: [{ parentCutId: 'MOVED', planStartTs: TS_FREE, plannedRuns: 70 }],
        deletes: []
    };
}

// ── 1) ПРАВИЛО: разрыв задания ручного переноса проходит в запись ────────────
(function () {
    var ops = opsOf();
    var res = planning.guardPlanOps(ops, ctxOf({ manual: ['MOVED'] }), 'auto');
    assertEqual(ops.updates.length, 1,
        'update разрыва (то же задание, ТОТ ЖЕ день, меньше проходов) не отброшен');
    assertEqual(ops.creates.length, 1,
        'продолжение на свободный день не отброшено — остатку есть куда уехать');
    assertEqual(res.skipped, 0, 'ничего не отброшено: заморозка тут не нарушена');
    assert((res.violations || []).some(function (v) { return v.rule === 'FROZEN_DAY'; }) === false,
        'и нарушением это не считается — потолок дня сильнее заморозки (#4467 для 🔒, #4494 для заморозки)');
})();

// ── 2) Заморозка защищает ЧУЖИЕ задания дня; задание оператора ею не ограничено ──
// #4569 (решение заказчика 02.08.2026): РУЧНОЕ ДЕЙСТВИЕ СИЛЬНЕЕ ЗАМОРОЗКИ. Правило ограничивает
// АВТОМАТИКУ — это его заголовок. Отказ ручной команде означал бы половинчатый результат («тут
// сдвинули, а там не смогли»): страж снимает операции цепочки целиком (#4536), и задание остаётся
// с плейсхолдерным временем — боевое #4569 («⏱ 07:59 – 09:53» внахлёст).
(function () {
    // (а) задание, которое оператор несёт сам, вправе уехать и ИЗ замороженного дня.
    var moveOut = { updates: [{ cutId: 'MOVED', planStartTs: TS_FREE, plannedRuns: 100 }], creates: [], deletes: [] };
    var r1 = planning.guardPlanOps(moveOut, ctxOf({ manual: ['MOVED'] }), 'auto');
    assertEqual(moveOut.updates.length, 1, '#4569 переезд задания ОПЕРАТОРА из замороженного дня проходит');
    assertEqual(r1.skipped, 0, 'и отказа нет — ручное действие выполняется целиком');

    // (б) чужое задание того же дня не трогаем даже при ручном переносе соседа.
    var other = { updates: [{ cutId: 'OTHER', planStartTs: TS_FROZEN_LATE, plannedRuns: 5 }], creates: [], deletes: [] };
    planning.guardPlanOps(other, ctxOf({ manual: ['MOVED'] }), 'auto');
    assertEqual(other.updates.length, 0, 'ЧУЖОЕ задание замороженного дня не трогаем');

    // (в) чужое задание замороженного дня не удаляем.
    var delOther = { updates: [], creates: [], deletes: ['OTHER'] };
    planning.guardPlanOps(delOther, ctxOf({ manual: ['MOVED'] }), 'auto');
    assertEqual(delOther.deletes.length, 0, 'удаление ЧУЖОГО задания замороженного дня отброшено');

    // (г) новое задание В замороженный день от АВТОМАТИКИ — нельзя (набивка дня).
    var newInFrozen = { updates: [], creates: [{ parentCutId: 'FREECUT', planStartTs: TS_FROZEN, plannedRuns: 10 }], deletes: [] };
    planning.guardPlanOps(newInFrozen, ctxOf({ manual: ['MOVED'] }), 'auto');
    assertEqual(newInFrozen.creates.length, 0, 'новое задание в замороженный день по-прежнему отброшено');

    // (д) продолжение задания ОПЕРАТОРА вправе встать и в замороженный день — это его команда.
    var contInFrozen = { updates: [], creates: [{ parentCutId: 'MOVED', planStartTs: TS_FROZEN_LATE, plannedRuns: 70 }], deletes: [] };
    planning.guardPlanOps(contInFrozen, ctxOf({ manual: ['MOVED'] }), 'auto');
    assertEqual(contInFrozen.creates.length, 1, '#4569 продолжение задания оператора не отброшено');
})();

// ── 3) Без ручного переноса — поведение прежнее ─────────────────────────────
(function () {
    var ops = opsOf();
    var res = planning.guardPlanOps(ops, ctxOf({ manual: [] }), 'auto');
    assertEqual(ops.updates.length, 0, 'обычная пересборка задание замороженного дня не трогает');
    assertEqual(ops.creates.length, 0, 'и продолжений ему не создаёт');
    assert(res.skipped >= 2, 'обе операции отброшены, как и раньше');
    assert((res.violations || []).some(function (v) { return v.rule === 'FROZEN_DAY'; }),
        'нарушение названо в отчёте стража');
})();

// ── 4) Нет предиката ручного переноса (старый вызывающий) — прежнее поведение ─
(function () {
    var ops = opsOf();
    var ctx = ctxOf({ manual: ['MOVED'] });
    delete ctx.isManualMoveCut;
    planning.guardPlanOps(ops, ctx, 'auto');
    assertEqual([ops.updates.length, ops.creates.length], [0, 0],
        'без предиката правило работает как прежде (конвенция реестра: нет данных — нет исключений)');
})();

// ── 5) Упаковщик: задание рвётся по потолку, остаток уезжает из замороженного дня ─
// Тот же стенд, что у #4490 (atex-production-planning-4488.test.js): наладки нулевые, проход 10 мин.
(function () {
    var CAP = 450;
    function cut(id, work, fixed) {
        return { id: id, materialId: 'M1', winding: 'OUT', batchId: 'B1', knifeWidths: [100],
                 knifeCount: 1, rollerWidth: 100, isFoil: false, plannedRuns: 1, fixed: !!fixed, _work: work };
    }
    function pack(cuts, opts) {
        var perPass = {}, runs = {}, anchor = {};
        cuts.forEach(function (c) {
            perPass[String(c.id)] = 10; runs[String(c.id)] = Math.round(c._work / 10);
            if (c.fixed) anchor[String(c.id)] = 0;
        });
        var base = { dayStartMin: 480, dayEndMin: 480 + CAP, dayEndHourMin: 480 + CAP,
            times: { KNIFE: 0, MATERIAL_WINDING: 0, BETWEEN_CUTS: 0 },
            perPassByCut: perPass, runsByCut: runs, dayAnchorByCut: anchor,
            gapFill: true, orderAuthoritative: true };
        Object.keys(opts || {}).forEach(function (k) { base[k] = opts[k]; });
        return planning.splitMachineQueue(cuts, base);
    }
    function segsOf(rows, id) {
        return rows.filter(function (s) { return String(s.cutId) === String(id) && !s.setupOnly; })
            .sort(function (a, b) { return a.dayOffset - b.dayOffset; });
    }
    function daysOf(rows, id) { return segsOf(rows, id).map(function (s) { return s.dayOffset; }); }
    function runsOf(rows, id, day) {
        return segsOf(rows, id).filter(function (s) { return day == null || s.dayOffset === day; })
            .reduce(function (t, s) { return t + (Number(s.runs) || 0); }, 0);
    }
    function dayMinutes(rows, day) {
        return rows.filter(function (s) { return s.dayOffset === day; })
            .reduce(function (t, s) { return t + (Number(s.setupMin) || 0) + (Number(s.durationMin) || 0); }, 0);
    }

    // День 0 заморожен, в нём уже стои́т чужое задание S (200 мин), и туда переносят M (600 мин).
    var rows = pack([cut('S', 200, true), cut('M', 600, true)],
        { frozenDayFor: function (d) { return d === 0; }, wholeDayByCut: { M: 0 } });
    assert(runsOf(rows, 'M', 0) > 0, 'часть перенесённого встала в замороженный день',
        '(проходов в дне 0: ' + runsOf(rows, 'M', 0) + ' из 60)');
    assert(dayMinutes(rows, 0) <= CAP + 10, 'замороженный день не длиннее смены с нахлёстом',
        '(минут в дне 0: ' + Math.round(dayMinutes(rows, 0)) + ' при потолке ' + CAP + ')');
    assert(daysOf(rows, 'M').length > 1, 'остаток уехал продолжением, а не раздул день',
        '(дни M: ' + daysOf(rows, 'M').join(',') + ')');
    assert(runsOf(rows, 'M') === 60, 'проходы не потерялись', '(всего: ' + runsOf(rows, 'M') + ')');

    // Следующий день ТОЖЕ заморожен — остаток едет дальше, к ближайшему свободному.
    var rows2 = pack([cut('S', 200, true), cut('M', 600, true)],
        { frozenDayFor: function (d) { return d === 0 || d === 1; }, wholeDayByCut: { M: 0 } });
    var tailDays = daysOf(rows2, 'M').filter(function (d) { return d > 0; });
    assert(tailDays.length > 0 && tailDays.every(function (d) { return d !== 1; }),
        'остаток не встаёт в следующий ЗАМОРОЖЕННЫЙ день — едет к ближайшему свободному',
        '(дни остатка: ' + tailDays.join(',') + ')');
})();

process.on('exit', function () {
    console.log('\n' + passed + '/' + total + ' passed');
});
