// Unit tests for #3616 — дата-заголовок рабочего дня очереди (после записи об уборке).
// Нумерация заданий начинается с 1 на каждый день расписания (см. renderQueue:
// группировка dayCutsBySched по schedDay). Здесь покрываем чистый форматтер даты дня.
//
// Run with: node experiments/atex-production-planning-3616.test.js

process.env.TZ = 'UTC';

var api = require('../download/atex/js/production-planning.js');
var planning = api.planning;
var heading = planning.formatPlanDayHeading;

var passed = 0;
function assert(cond, name) {
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}

// База — полночь дня фильтра; смещение 0 = сам день, 1 = следующий рабочий день и т.д.
var base = Date.UTC(2026, 5, 23);   // 23.06.2026 (вторник)

assert(heading(base, 0) === 'Вт, 23.06.2026', 'день 0 → Вт, 23.06.2026');
assert(heading(base, 1) === 'Ср, 24.06.2026', 'день 1 → Ср, 24.06.2026 (после уборки дня 0)');
assert(heading(base, 2) === 'Чт, 25.06.2026', 'день 2 → Чт, 25.06.2026');

// Переход через границу месяца.
var endMonth = Date.UTC(2026, 5, 30);   // 30.06.2026 (вторник)
assert(heading(endMonth, 1) === 'Ср, 01.07.2026', 'через границу месяца → 01.07.2026');

// Переход через границу года.
var endYear = Date.UTC(2026, 11, 31);   // 31.12.2026 (четверг)
assert(heading(endYear, 1) === 'Пт, 01.01.2027', 'через границу года → 01.01.2027');

// Однозначные день/месяц — с ведущим нулём.
assert(heading(Date.UTC(2026, 0, 5), 0) === 'Пн, 05.01.2026', 'ведущие нули дня/месяца');

// Нечисловая/пустая база → пусто (без падения).
assert(heading(null, 0) === '', 'null база → пусто');
assert(heading(undefined, 1) === '', 'undefined база → пусто');
assert(heading(NaN, 0) === '', 'NaN база → пусто');

// Смещение по умолчанию (нечисловое → 0).
assert(heading(base, undefined) === 'Вт, 23.06.2026', 'смещение undefined → день 0');

console.log('\n' + passed + ' passed');
