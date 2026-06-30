// Unit tests for ideav/crm#3898 — отпуск станка длиной НЕ БОЛЕЕ 2 КАЛЕНДАРНЫХ дней НЕ
// сбрасывает заправку (сырьё/ножи): первая резка после короткого простоя наследует
// настройку, а не пересчитывает её с нуля (#3876 смягчён). Порог — константа
// DOWNTIME_KEEP_SETUP_MAX_DAYS.
//
//   • downtimeSpanDays       — длина окна отпуска в КАЛЕНДАРНЫХ днях;
//   • vacationSpanDaysOnDay  — длина отпуска, накрывающего сутки дня базы;
//   • longVacationOnDay      — длинный ли отпуск (> порога) — только он обнуляет заправку;
//   • planningPrevSetupBySlitter — короткий отпуск сохраняет заправку, длинный обнуляет.
//
// Run with: node experiments/atex-production-planning-3898.test.js

process.env.TZ = 'UTC';
global.window = { db: 'testdb', xsrf: 'x' };
var api = require('../download/atex/js/production-planning.js');
var planning = api.planning;
var Controller = api.Controller;

var passed = 0, failed = 0;
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) passed++; else { failed++; console.log('  expected:', JSON.stringify(expected)); console.log('  actual:  ', JSON.stringify(actual)); process.exitCode = 1; }
}
function assert(cond, name) { assertEqual(!!cond, true, name); }

function dayMs(y, m, d) { return Date.UTC(y, m - 1, d); }
function sec(ms) { return Math.floor(ms / 1000); }

// ── downtimeSpanDays: длина окна в КАЛЕНДАРНЫХ днях ──
(function () {
    // 02.07 08:00 → 02.07 18:00 — часть одного дня = 1 календарный день.
    assertEqual(planning.downtimeSpanDays(sec(dayMs(2026, 7, 2) + 8 * 3600000), sec(dayMs(2026, 7, 2) + 18 * 3600000)), 1,
        'downtimeSpanDays: 02.07 08:00–18:00 = 1 день');
    // 02.07 00:00 → 04.07 00:00 — простой 02 и 03 = 2 дня (окончание в 00:00 04-го не добавляет 4-й).
    assertEqual(planning.downtimeSpanDays(sec(dayMs(2026, 7, 2)), sec(dayMs(2026, 7, 4))), 2,
        'downtimeSpanDays: 02.07→04.07 00:00 = 2 дня');
    // 02.07 → 03.07 18:00 = 2 дня.
    assertEqual(planning.downtimeSpanDays(sec(dayMs(2026, 7, 2) + 8 * 3600000), sec(dayMs(2026, 7, 3) + 18 * 3600000)), 2,
        'downtimeSpanDays: 02.07 08:00–03.07 18:00 = 2 дня');
    // 02.07 08:00 → 04.07 10:00 — заходит в 4-й день = 3 дня.
    assertEqual(planning.downtimeSpanDays(sec(dayMs(2026, 7, 2) + 8 * 3600000), sec(dayMs(2026, 7, 4) + 10 * 3600000)), 3,
        'downtimeSpanDays: 02.07 08:00–04.07 10:00 = 3 дня');
    // Битое/пустое окно.
    assertEqual(planning.downtimeSpanDays(sec(dayMs(2026, 7, 4)), sec(dayMs(2026, 7, 2))), 0, 'downtimeSpanDays: конец раньше начала = 0');
})();

// ── vacationSpanDaysOnDay: длина отпуска, накрывающего день базы ──
(function () {
    var twoDay = [{ start: sec(dayMs(2026, 7, 2)), end: sec(dayMs(2026, 7, 4)) }];        // 02–03 (2 дня)
    var threeDay = [{ start: sec(dayMs(2026, 7, 2)), end: sec(dayMs(2026, 7, 5)) }];       // 02–04 (3 дня)
    assertEqual(planning.vacationSpanDaysOnDay(twoDay, dayMs(2026, 7, 2)), 2, 'vacationSpanDaysOnDay: 2-дневный отпуск на 02.07 = 2');
    assertEqual(planning.vacationSpanDaysOnDay(threeDay, dayMs(2026, 7, 2)), 3, 'vacationSpanDaysOnDay: 3-дневный отпуск на 02.07 = 3');
    assertEqual(planning.vacationSpanDaysOnDay(twoDay, dayMs(2026, 7, 5)), 0, 'vacationSpanDaysOnDay: день вне отпуска = 0');
    // Открытое окно (нет «Окончания») — не учитываем.
    assertEqual(planning.vacationSpanDaysOnDay([{ start: sec(dayMs(2026, 7, 2)) }], dayMs(2026, 7, 2)), 0,
        'vacationSpanDaysOnDay: окно без «Окончания» = 0');
})();

// ── longVacationOnDay + planningPrevSetupBySlitter: короткий отпуск НЕ сбрасывает заправку ──
(function () {
    function makeCtl(downtimes) {
        var root = { getAttribute: function () { return 'testdb'; } };
        var c = new Controller(root);
        c.slitters = [{ id: 'S1' }];
        c.downtimesBySlitter = { S1: downtimes };
        // prevSetup станка ДО отпуска (унаследованная заправка).
        c.prevSetupBySlitter = { S1: { materialId: 'A', winding: 'OUT', knifeWidths: [50] } };
        // Рабочее окно — полный день (slitterOnVacationDay требует полного покрытия).
        c.workingWindow = function () { return { startMin: 0, cutEndMin: 1440 }; };
        return c;
    }
    var twoDay = [{ start: sec(dayMs(2026, 7, 2)), end: sec(dayMs(2026, 7, 4)) }];     // 2 дня (02–03)
    var threeDay = [{ start: sec(dayMs(2026, 7, 2)), end: sec(dayMs(2026, 7, 5)) }];    // 3 дня (02–04)

    var cShort = makeCtl(twoDay);
    assert(cShort.slitterOnVacationDay('S1', dayMs(2026, 7, 2)), 'предусловие: 02.07 покрыт отпуском');
    assert(!cShort.longVacationOnDay('S1', dayMs(2026, 7, 2)), 'longVacationOnDay: 2-дневный отпуск — НЕ длинный (порог 2)');
    assertEqual(cShort.planningPrevSetupBySlitter(dayMs(2026, 7, 2)).S1, { materialId: 'A', winding: 'OUT', knifeWidths: [50] },
        'короткий отпуск (2 дня) → заправка СОХРАНЕНА (нет полной настройки)');

    var cLong = makeCtl(threeDay);
    assert(cLong.longVacationOnDay('S1', dayMs(2026, 7, 2)), 'longVacationOnDay: 3-дневный отпуск — длинный');
    assertEqual(cLong.planningPrevSetupBySlitter(dayMs(2026, 7, 2)).S1, { materialId: '', winding: '', knifeWidths: [] },
        'длинный отпуск (3 дня) → заправка ОБНУЛЕНА (полная настройка после отпуска, #3876)');

    // Станок НЕ в отпуске в день базы → заправка как была (контроль).
    assertEqual(cLong.planningPrevSetupBySlitter(dayMs(2026, 7, 10)).S1, { materialId: 'A', winding: 'OUT', knifeWidths: [50] },
        'день базы вне отпуска → заправка не трогается (контроль)');
})();

console.log('\n' + passed + ' проверок прошло' + (failed ? ', ' + failed + ' упало' : '') + '.');
if (!failed) console.log('Все проверки #3898 зелёные.');
