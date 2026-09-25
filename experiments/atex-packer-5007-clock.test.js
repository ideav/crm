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

// ── nextTasksPath: окно очереди не зависит от часов устройства ──

assertEqual(core.nextTasksPath({ id: '1', label: '1' }),
    'report/packer_next?JSON_KV&LIMIT=0,5000&FR_packer_no=1',
    'nextTasksPath: фильтр места, без фильтра даты от устройства');
assertEqual(core.nextTasksPath({ id: '1', label: '1' }).indexOf('FR_task'), -1,
    'nextTasksPath: внешнего FR_task нет — окно держит серверная граница «>= [TODAY]»');
assertEqual(core.nextTasksPath(null), '',
    'nextTasksPath: без места отчёт не запрашивается');
assertEqual(core.nextTasksPath({ id: '2', label: 'Особое место' }),
    'report/packer_next?JSON_KV&LIMIT=0,5000&FR_packer_no=' + encodeURIComponent('Особое место'),
    'nextTasksPath: место подставляется как значение фильтра');

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
