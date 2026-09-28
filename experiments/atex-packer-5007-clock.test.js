// ideav/crm#5007: «не появились новые следующие заказы» — блок «Следующие задания»
// на планшете показывал заказы 5248/5235, запланированные на 10–11.09, в день,
// когда на станках были 5552/5491. Причина: окно очереди задавал фильтр
// `FR_task=>{полночь УСТРОЙСТВА}`, а он ПЕРЕКРЫВАЕТ внутреннюю границу отчёта
// «>= [TODAY]» (серверную). Часы планшета стояли на ~11.09 — и в «следующие»
// попадали двухнедельной давности нерезанные задания. Фикс: окно держит сам
// отчёт (внешний FR_task не шлётся вовсе), а расхождение часов устройства
// с сервером показывается в шапке — сбитые часы врут и в подписях заданий,
// и во времени событий упаковки.
//
// Run with: node experiments/atex-packer-5007-clock.test.js

var mod = require('../download/atex/js/packer.js');
var core = mod.core;

var passed = 0;
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) {
        passed++;
    } else {
        console.log('  expected:', JSON.stringify(expected));
        console.log('  actual:  ', JSON.stringify(actual));
        process.exitCode = 1;
    }
}

var MINUTE = 60 * 1000;

// ── Окно очереди не зависит от часов устройства (#5035: делит клиент по часам сервера) ──

assertEqual(core.itemsPath({ id: '1', label: '1' }).indexOf('FR_task'), -1,
    'itemsPath: внешнего FR_task от часов устройства нет');
(function() {
    var sec = function(d) { return String(Math.floor(d.getTime() / 1000)); };
    var rows = [
        { gp_id: 'old', task_id: '1', events: '', task: sec(new Date(2026, 8, 8, 8, 0)) },
        { gp_id: 'today', task_id: '2', events: '', task: sec(new Date(2026, 8, 22, 8, 0)) }
    ];
    // Сервер: 22.09. Планшет может считать хоть 08.09 — функция его часов не читает.
    var next = core.splitReportRows(rows, new Date(2026, 8, 22, 12, 0).getTime()).nextItems;
    assertEqual(next.map(function(it) { return it.gpId; }), ['today'],
        'splitReportRows: в «следующие» не попадают задания двухнедельной давности — окно по серверу');
})();

// ── clockSkewMs / isClockSkewed: расхождение часов устройства с сервером ──

var server = new Date(2026, 8, 25, 10, 0, 0).getTime();

assertEqual(core.clockSkewMs(server + 2 * MINUTE, server), 2 * MINUTE,
    'clockSkewMs: устройство спешит на 2 минуты');
assertEqual(core.clockSkewMs(server - 14 * 24 * 60 * MINUTE, server), -14 * 24 * 60 * MINUTE,
    'clockSkewMs: устройство отстаёт на 14 дней (кейс #5007)');

assertEqual(core.isClockSkewed(server + 2 * MINUTE, server), false,
    'isClockSkewed: спешит на 2 минуты — не предупреждать');
assertEqual(core.isClockSkewed(server - 9 * MINUTE, server), false,
    'isClockSkewed: отстаёт на 9 минут — не предупреждать');
assertEqual(core.isClockSkewed(server + 11 * MINUTE, server), true,
    'isClockSkewed: спешит на 11 минут — предупреждать');
assertEqual(core.isClockSkewed(server - 14 * 24 * 60 * MINUTE, server), true,
    'isClockSkewed: отстаёт на 14 дней — предупреждать');
assertEqual(core.isClockSkewed(server, server), false,
    'isClockSkewed: часы совпадают — не предупреждать');
assertEqual(core.isClockSkewed(0, server), false,
    'isClockSkewed: время устройства неизвестно — не предупреждать');
assertEqual(core.isClockSkewed(server, 0), false,
    'isClockSkewed: серверного времени нет — не предупреждать');

console.log('passed: ' + passed);
