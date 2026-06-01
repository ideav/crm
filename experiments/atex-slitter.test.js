// Unit tests for the «Пульт слиттера» core (ideav/crm#2915).
// Verifies the design-spec behaviour from the atex spec (§3.5):
//   • статусы резки: Ожидает → Наладка → В работе → Завершён (жёсткая цепочка);
//   • расход сырья уменьшает остаток партии (FIFO-подбор + списание);
//   • событие смены пишется с датой/временем (формат хронологии).
//
// Run with: node experiments/atex-slitter.test.js

var core = require('../download/atex/js/slitter.js').core;

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

// ── toNumber: терпимый разбор ──
assertEqual(core.toNumber('120'), 120, 'toNumber parses integer string');
assertEqual(core.toNumber('12,5'), 12.5, 'toNumber accepts comma decimal');
assertEqual(core.toNumber(' 1 000 '), 1000, 'toNumber strips spaces');
assertEqual(core.toNumber(''), 0, 'toNumber empty → 0');
assertEqual(core.toNumber('abc'), 0, 'toNumber garbage → 0');

// ── normalizeStatus: приведение к известным, пустое → первый статус ──
assertEqual(core.normalizeStatus(''), 'Ожидает', 'empty status → Ожидает');
assertEqual(core.normalizeStatus('  наладка '), 'Наладка', 'normalizes case/spaces');
assertEqual(core.normalizeStatus('Завершён'), 'Завершён', 'keeps terminal status');
assertEqual(core.normalizeStatus('Архив'), 'Архив', 'unknown status preserved verbatim');

// ── nextStatus: цепочка переходов Ожидает → Наладка → В работе → Завершён ──
assertEqual(core.nextStatus('Ожидает'), 'Наладка', 'Ожидает → Наладка');
assertEqual(core.nextStatus('Наладка'), 'В работе', 'Наладка → В работе');
assertEqual(core.nextStatus('В работе'), 'Завершён', 'В работе → Завершён');
assertEqual(core.nextStatus('Завершён'), 'Завершён', 'Завершён is terminal (stays)');
assertEqual(core.nextStatus(''), 'Наладка', 'empty treated as Ожидает → Наладка');
assertEqual(core.nextStatus('Архив'), 'Архив', 'unknown status has no next');

// ── isDone ──
assertEqual(core.isDone('Завершён'), true, 'isDone true for Завершён');
assertEqual(core.isDone('завершён'), true, 'isDone case-insensitive');
assertEqual(core.isDone('В работе'), false, 'isDone false for В работе');

// ── meterageFromCounters: погонаж = кон. − нач., не ниже нуля ──
assertEqual(core.meterageFromCounters(1000, 1850), 850, 'meterage = end − start');
assertEqual(core.meterageFromCounters('1 000', '1 850,5'), 850.5, 'meterage parses formatted input');
assertEqual(core.meterageFromCounters(2000, 1500), 0, 'meterage never negative (counter does not rewind)');
assertEqual(core.meterageFromCounters('', ''), 0, 'meterage of empty counters → 0');

// ── sumConsumption: сумма израсходованного ──
assertEqual(core.sumConsumption([
    { amount: '120,5' }, { amount: 80 }, { amount: '' }
]), 200.5, 'sumConsumption totals amounts (with comma decimals)');
assertEqual(core.sumConsumption([]), 0, 'sumConsumption of empty set → 0');

// ── sortFifo: партии раньше пришли — раньше расходуем (стабильно) ──
var batches = [
    { id: 'b3', date: '2026-05-20', remainder: 100 },
    { id: 'b1', date: '2026-05-10', remainder: 0 },
    { id: 'b2', date: '2026-05-15', remainder: 50 },
    { id: 'b4', date: '2026-05-15', remainder: 30 } // равная дата → исходный порядок
];
assertEqual(core.sortFifo(batches).map(function(b) { return b.id; }),
    ['b1', 'b2', 'b4', 'b3'], 'sortFifo orders by arrival date, stable on ties');

// ── pickFifoBatch: первая по FIFO партия с положительным остатком ──
assertEqual(core.pickFifoBatch(batches).id, 'b2', 'pickFifoBatch skips empty (b1), picks earliest with remainder');
assertEqual(core.pickFifoBatch([{ id: 'x', date: '2026-01-01', remainder: 0 }]), null,
    'pickFifoBatch → null when nothing left to consume');

// ── applyConsumption: остаток уменьшается на списанное (критерий §3.5) ──
assertEqual(core.applyConsumption(100, 30), 70, 'applyConsumption reduces remainder');
assertEqual(core.applyConsumption(50, 80), 0, 'applyConsumption clamps at zero (no negative remainder)');
assertEqual(core.applyConsumption('100,5', '0,5'), 100, 'applyConsumption parses formatted values');

// ── restoreConsumption: возврат остатка при отмене расхода ──
assertEqual(core.restoreConsumption(70, 30), 100, 'restoreConsumption adds back to remainder');

// Полный цикл: списали 30, затем правка на 50 (дельта +20), затем отмена (−50).
var rem = 100;
rem = core.applyConsumption(rem, 30);            // 70
assertEqual(rem, 70, 'cycle: consume 30 → 70');
rem = core.applyConsumption(rem, 20);            // дельта при правке 30→50
assertEqual(rem, 50, 'cycle: edit 30→50 applies delta 20 → 50');
rem = core.restoreConsumption(rem, 50);          // отмена расхода
assertEqual(rem, 100, 'cycle: cancel restores full 50 → 100');

// ── formatDateTime: дата/время события смены (хронология) ──
assertEqual(core.formatDateTime(new Date(2026, 4, 30, 9, 5, 7)), '2026-05-30 09:05:07',
    'formatDateTime pads month/day/time to YYYY-MM-DD HH:MM:SS');

// ── остаток,м по дельте погонажа (используем applyConsumption/restoreConsumption) ──
assertEqual(core.applyConsumption(4000, 300 - 0), 3700, 'остаток,м: первое списание погонажа');
assertEqual(core.restoreConsumption(3700, 300 - 250), 3750, 'остаток,м: правка погонажа вниз возвращает');
assertEqual(core.applyConsumption(100, 300), 0, 'остаток,м: не ниже нуля');

console.log('\n' + passed + ' assertions passed');
