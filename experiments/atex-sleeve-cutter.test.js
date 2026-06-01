// Unit tests for the «Пульт втулкореза» core (ideav/crm#2916).
// Verifies the design-spec behaviour from the atex spec (§3.6):
//   • статусы задания: Ожидает → В работе → Готово (жёсткая цепочка);
//   • сводка по заданиям: план/факт суммарно, сколько готово, % выполнения.
//
// Run with: node experiments/atex-sleeve-cutter.test.js

var core = require('../download/atex/js/sleeve-cutter.js').core;

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
assertEqual(core.normalizeStatus('  в работе '), 'В работе', 'normalizes case/spaces');
assertEqual(core.normalizeStatus('Готово'), 'Готово', 'keeps terminal status');
assertEqual(core.normalizeStatus('Архив'), 'Архив', 'unknown status preserved verbatim');

// ── nextStatus: цепочка переходов ──
assertEqual(core.nextStatus('Ожидает'), 'В работе', 'Ожидает → В работе');
assertEqual(core.nextStatus('В работе'), 'Готово', 'В работе → Готово');
assertEqual(core.nextStatus('Готово'), 'Готово', 'Готово is terminal (stays)');
assertEqual(core.nextStatus(''), 'В работе', 'empty treated as Ожидает → В работе');
assertEqual(core.nextStatus('Архив'), 'Архив', 'unknown status has no next');

// ── isDone ──
assertEqual(core.isDone('Готово'), true, 'isDone true for Готово');
assertEqual(core.isDone('готово'), true, 'isDone case-insensitive');
assertEqual(core.isDone('В работе'), false, 'isDone false for В работе');

// ── summarize: агрегаты по заданиям ──
var tasks = [
    { planQty: 100, factQty: 100, status: 'Готово' },
    { planQty: 100, factQty: 40, status: 'В работе' },
    { planQty: 50, factQty: 0, status: 'Ожидает' }
];
assertEqual(core.summarize(tasks), {
    total: 3,
    done: 1,
    planQty: 250,
    factQty: 140,
    percent: 56   // round(140/250*100) = 56
}, 'summarize aggregates plan/fact, counts done, computes percent');

// Пустой набор заданий.
assertEqual(core.summarize([]), {
    total: 0,
    done: 0,
    planQty: 0,
    factQty: 0,
    percent: 0
}, 'summarize of empty set');

// Факт превышает план → процент ограничен 100.
assertEqual(core.summarize([{ planQty: 10, factQty: 25, status: 'Готово' }]).percent, 100,
    'percent capped at 100 when fact exceeds plan');

// Запятые-разделители из формы суммируются корректно.
assertEqual(core.summarize([
    { planQty: '12,5', factQty: '6,25', status: 'В работе' },
    { planQty: '7,5', factQty: '3,75', status: 'Ожидает' }
]), {
    total: 2,
    done: 0,
    planQty: 20,
    factQty: 10,
    percent: 50
}, 'summarize parses comma decimals from form inputs');

// ── pickCutter: подбор втулкореза по диапазону ──
var CUTTERS = [
    { id: '1', label: 'Втулкорез 1', diaMin: 20, diaMax: 25 },
    { id: '2', label: 'Втулкорез 2', diaMin: 26, diaMax: 40 },
    { id: '3', label: 'Втулкорез 3', diaMin: 41, diaMax: 76 },
    { id: '4', label: 'Узкий 40',    diaMin: 40, diaMax: 40 }
];
assertEqual(core.pickCutter(20, CUTTERS).id, '1', 'pickCutter: внутри диапазона');
assertEqual(core.pickCutter(25, CUTTERS).id, '1', 'pickCutter: верхняя граница включительно');
assertEqual(core.pickCutter(26, CUTTERS).id, '2', 'pickCutter: нижняя граница включительно');
assertEqual(core.pickCutter(40, CUTTERS).id, '4', 'pickCutter: несколько покрывают → самый узкий');
assertEqual(core.pickCutter(100, CUTTERS), null, 'pickCutter: нет покрытия → null');
assertEqual(core.pickCutter('', CUTTERS), null, 'pickCutter: пустой диаметр → null');

// ── formatRange: подпись диапазона ──
assertEqual(core.formatRange(20, 25), '20–25 мм', 'formatRange: обе границы');
assertEqual(core.formatRange(20, ''), 'от 20 мм', 'formatRange: только min');
assertEqual(core.formatRange('', 76), 'до 76 мм', 'formatRange: только max');
assertEqual(core.formatRange('', ''), '', 'formatRange: пусто');

console.log('\n' + passed + ' assertions passed');
