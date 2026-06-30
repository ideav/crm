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
assertEqual(core.pickCutter(5, [{ id: 'a', diaMin: '', diaMax: 10 }]).id, 'a', 'pickCutter: открытый min (только max)');
assertEqual(core.pickCutter(50, [{ id: 'b', diaMin: 40, diaMax: '' }]).id, 'b', 'pickCutter: открытый max (только min)');

// ── formatRange: подпись диапазона ──
assertEqual(core.formatRange(20, 25), '20–25 мм', 'formatRange: обе границы');
assertEqual(core.formatRange(20, ''), 'от 20 мм', 'formatRange: только min');
assertEqual(core.formatRange('', 76), 'до 76 мм', 'formatRange: только max');
assertEqual(core.formatRange('', ''), '', 'formatRange: пусто');

// ── autoAssignCutter: авто-подбор без перетирания ручного выбора ──
function mkTask(o){ return Object.assign({ diameter:'', cutterId:null, cutterAuto:false }, o); }
assertEqual(core.autoAssignCutter(mkTask({diameter:20}), CUTTERS).cutterId, '1', 'autoAssign: пустое → авто');
assertEqual(core.autoAssignCutter(mkTask({diameter:20}), CUTTERS).cutterAuto, true, 'autoAssign: ставит признак авто');
assertEqual(core.autoAssignCutter(mkTask({diameter:20, cutterId:'3', cutterAuto:false}), CUTTERS).cutterId, '3', 'autoAssign: ручной выбор не трогаем');
assertEqual(core.autoAssignCutter(mkTask({diameter:30, cutterId:'1', cutterAuto:true}), CUTTERS).cutterId, '2', 'autoAssign: прежний авто пере-подбирается');
assertEqual(core.autoAssignCutter(mkTask({diameter:100, cutterId:'1', cutterAuto:true}), CUTTERS).cutterId, null, 'autoAssign: нет подходящего → очищаем');

// ── rowsToPositions: задания на втулки теперь подчинены «Позиции заказа» (#3139) ──
var sleevePositions = core.rowsToPositions([
    { order_no: 'АТХ-1', position_id: '501', position_no: '1', position_qty: '10',
      position_width: '57.00', position_length: '1200', position_sleeve: '8188:76', position_status: 'В работе' },
    { order_no: 'АТХ-1', position_id: '501', position_no: '1', position_qty: '10',
      position_width: '57.00', position_length: '1200', position_sleeve: '8188:76', position_status: 'В работе' },
    { order_no: 'АТХ-1', position_id: '', position_no: '', position_qty: '' }
]);
assertEqual(sleevePositions, [{
    id: '501',
    orderNo: 'АТХ-1',
    no: '1',
    qty: '10',
    width: '57.00',
    length: '1200',
    sleeve: '8188:76',
    status: 'В работе',
    label: 'АТХ-1/1 · 57.00 мм'
}], 'rowsToPositions: orders_list rows → dedup positions with display label');

assertEqual(core.rowsToPositions([
    { position_id: '601', position_no: '3', position_qty: '5', position_width: '40.00' }
]), [{
    id: '601',
    orderNo: '',
    no: '3',
    qty: '5',
    width: '40.00',
    length: '',
    sleeve: '',
    status: '',
    label: '№3 · 40.00 мм'
}], 'rowsToPositions: positions_list fallback without order/sleeve columns');

assertEqual(core.taskDefaultsFromPosition({
    qty: '10',
    sleeve: '8188:76'
}), { planQty: '10', diameter: 76 }, 'taskDefaultsFromPosition: plan qty and sleeve diameter from position');

// ── #3869: фильтр заданий по втулкорезу, терминальные статусы, действия ──

assertEqual(core.isSkipped('Пропущена'), true, '#3869 isSkipped: Пропущена → true');
assertEqual(core.isSkipped('готово'), false, '#3869 isSkipped: Готово → false');
assertEqual(core.isTerminal('Готово'), true, '#3869 isTerminal: Готово → true');
assertEqual(core.isTerminal('Пропущена'), true, '#3869 isTerminal: Пропущена → true');
assertEqual(core.isTerminal('Ожидает'), false, '#3869 isTerminal: Ожидает → false');

var allTasks = [
    { id: '1', cutterId: '10', status: 'Готово' },
    { id: '2', cutterId: '20', status: 'Ожидает' },
    { id: '3', cutterId: '10', status: 'Ожидает' },
    { id: '4', cutterId: '10', status: 'Пропущена' }
];
assertEqual(core.tasksForCutter(allTasks, '10').map(function(t){ return t.id; }), ['3', '1', '4'],
    '#3869 tasksForCutter: только втулкорез 10, активные выше завершённых');
assertEqual(core.tasksForCutter(allTasks, '').length, 0, '#3869 tasksForCutter: без втулкореза → []');
assertEqual(core.tasksForCutter(allTasks, '99').length, 0, '#3869 tasksForCutter: нет заданий втулкореза → []');
assertEqual(core.hasActiveTasks(allTasks, '10'), true, '#3869 hasActiveTasks: есть активное → true');
assertEqual(core.hasActiveTasks([{ id: '1', cutterId: '10', status: 'Готово' }], '10'), false,
    '#3869 hasActiveTasks: все терминальные → false');

// Controller.markTaskDone / skipTask — запись «Статус» (+ Кол-во факт для Готово)
(function() {
    var Controller = require('../download/atex/js/sleeve-cutter.js').Controller;
    var inst = Object.create(Controller.prototype);
    inst.busy = false;
    inst.meta = { task: { id: '112', reqs: [ { id: '1124', val: 'Статус' }, { id: '1122', val: 'Кол-во факт' } ] } };
    var captured = [];
    inst.post = function(path, params) { captured.push({ path: path, params: params }); return Promise.resolve({}); };
    inst.setBusy = function(v) { this.busy = v; };
    inst.notify = function() {};
    inst.render = function() {};

    inst.markTaskDone({ id: '5', planQty: '120', factQty: '', status: 'Ожидает' });
    assertEqual(captured[0].path, '_m_set/5?JSON', '#3869 markTaskDone: _m_set по id задания');
    assertEqual(captured[0].params['t1124'], 'Готово', '#3869 markTaskDone: Статус=Готово');
    assertEqual(captured[0].params['t1122'], 120, '#3869 markTaskDone: Кол-во факт = К-во план');

    inst.busy = false; captured = [];
    inst.skipTask({ id: '6', planQty: '50', factQty: '', status: 'Ожидает' });
    assertEqual(captured[0].params['t1124'], 'Пропущена', '#3869 skipTask: Статус=Пропущена');
    assertEqual('t1122' in captured[0].params, false, '#3869 skipTask: Кол-во факт не трогаем');
})();

// Controller.visibleTasks / отбор closeAll — только активные задания втулкореза
(function() {
    var Controller = require('../download/atex/js/sleeve-cutter.js').Controller;
    var inst = Object.create(Controller.prototype);
    inst.selectedCutterId = '10';
    inst.tasks = [
        { id: '1', cutterId: '10', status: 'Ожидает' },
        { id: '2', cutterId: '10', status: 'Готово' },
        { id: '3', cutterId: '10', status: 'В работе' },
        { id: '4', cutterId: '20', status: 'Ожидает' }
    ];
    assertEqual(inst.visibleTasks().map(function(t){ return t.id; }), ['1', '3', '2'],
        '#3869 visibleTasks: задания втулкореза 10, активные выше завершённых');
    var pending = inst.visibleTasks().filter(function(t){ return !core.isTerminal(t.status) && t.id; }).map(function(t){ return t.id; });
    assertEqual(pending, ['1', '3'], '#3869 closeAll-отбор: к закрытию только активные (не Готово, не чужой втулкорез)');
})();

console.log('\n' + passed + ' assertions passed');
