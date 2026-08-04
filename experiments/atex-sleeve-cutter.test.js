// Unit tests for the «Пульт втулкореза» core (ideav/crm#2916, #3869).
// Боевая схема ateh: главное значение задания — Unix плановой даты; статус
// выводится из «Начато»/«Закончено»/«Кол-во факт»; задания читаются отчётом
// `sleeve_tasks` и фильтруются по втулкорезу + дате. См. docs/atex_workplaces.md §3.6.
//
// Дата-хелперы используют ЛОКАЛЬНЫЙ TZ — тесты проверяют их через round-trip
// (TZ-независимо), а не сверкой с захардкоженными Unix-значениями.
//
// Run with: node experiments/atex-sleeve-cutter.test.js

var mod = require('../download/atex/js/sleeve-cutter.js');
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

// ── toNumber: терпимый разбор ──
assertEqual(core.toNumber('120'), 120, 'toNumber parses integer string');
assertEqual(core.toNumber('12,5'), 12.5, 'toNumber accepts comma decimal');
assertEqual(core.toNumber(' 1 000 '), 1000, 'toNumber strips spaces');
assertEqual(core.toNumber(''), 0, 'toNumber empty → 0');
assertEqual(core.toNumber('abc'), 0, 'toNumber garbage → 0');

// ── statusFromFields: статус выводится из полей задания ──
assertEqual(core.statusFromFields({ started: '', finished: '', factQty: '' }), 'Ожидает',
    'statusFromFields: пусто → Ожидает');
assertEqual(core.statusFromFields({ started: '1781000000', finished: '', factQty: '' }), 'В работе',
    'statusFromFields: только Начато → В работе');
assertEqual(core.statusFromFields({ started: '1781000000', finished: '1781003600', factQty: '5' }), 'Готово',
    'statusFromFields: Закончено + факт>0 → Готово');
assertEqual(core.statusFromFields({ started: '', finished: '1781003600', factQty: '' }), 'Пропущена',
    'statusFromFields: Закончено + факт пуст → Пропущена');
assertEqual(core.statusFromFields({ started: '', finished: '1781003600', factQty: '0' }), 'Пропущена',
    'statusFromFields: Закончено + факт 0 → Пропущена');

// ── isDone / isSkipped / isTerminal ──
assertEqual(core.isDone('Готово'), true, 'isDone true for Готово');
assertEqual(core.isDone('готово'), true, 'isDone case-insensitive');
assertEqual(core.isDone('В работе'), false, 'isDone false for В работе');
assertEqual(core.isSkipped('Пропущена'), true, 'isSkipped: Пропущена → true');
assertEqual(core.isSkipped('Готово'), false, 'isSkipped: Готово → false');
assertEqual(core.isTerminal('Готово'), true, 'isTerminal: Готово → true');
assertEqual(core.isTerminal('Пропущена'), true, 'isTerminal: Пропущена → true');
assertEqual(core.isTerminal('Ожидает'), false, 'isTerminal: Ожидает → false');
assertEqual(core.isTerminal('В работе'), false, 'isTerminal: В работе → false');

// ── Дата/время: round-trip (TZ-независимо) ──
var unixMorning = Math.floor(new Date(2026, 5, 1, 8, 30, 0).getTime() / 1000); // локально 2026-06-01 08:30
assertEqual(core.unixToLocalIso(unixMorning), '2026-06-01', 'unixToLocalIso: Unix → локальная дата');
assertEqual(core.unixToLocalTime(unixMorning), '08:30', 'unixToLocalTime: Unix → локальное HH:MM');
assertEqual(core.unixToLocalIso(''), '', 'unixToLocalIso: пусто → ""');
assertEqual(core.unixToLocalTime(0), '', 'unixToLocalTime: 0 → ""');

var bounds = core.dayBoundsUnix('2026-06-01');
assertEqual(core.unixToLocalIso(bounds.start), '2026-06-01', 'dayBoundsUnix: start попадает в выбранный день');
assertEqual(core.unixToLocalIso(bounds.end - 1), '2026-06-01', 'dayBoundsUnix: end-1 ещё в выбранном дне');
assertEqual(core.unixToLocalIso(bounds.end), '2026-06-02', 'dayBoundsUnix: end = начало следующего дня');
assertEqual(bounds.end - bounds.start, 86400, 'dayBoundsUnix: сутки = 86400 секунд');
assertEqual(core.dayBoundsUnix('мусор'), null, 'dayBoundsUnix: некорректная дата → null');

assertEqual(core.formatRuDate('2026-06-01'), '01.06.2026', 'formatRuDate: ISO → DD.MM.YYYY');
assertEqual(/^\d{4}-\d{2}-\d{2}$/.test(core.todayLocalIso()), true, 'todayLocalIso: формат YYYY-MM-DD');

// ── taskFromReportRow: строка отчёта sleeve_tasks → задание ──
var row = {
    task_id: '74105',
    task_date: String(unixMorning),
    cutter: 'TC-20',
    cutter_id: '2257',
    qty: '174',
    fact: '',
    started: '',
    finished: ''
};
assertEqual(core.taskFromReportRow(row), {
    id: '74105',
    dateUnix: unixMorning,
    dateIso: '2026-06-01',
    cutterId: '2257',
    cutterLabel: 'TC-20',
    planQty: '174',
    factQty: '',
    started: '',
    finished: '',
    status: 'Ожидает'
}, 'taskFromReportRow: маппинг полей + статус Ожидает');

// JSON_KV может отдать ref как {val,id} — берём val/id.
assertEqual(core.taskFromReportRow({
    task_id: { val: '80', id: '80' },
    task_date: { val: String(unixMorning) },
    cutter_id: { id: '2257', val: 'TC-20' },
    qty: '6', fact: '6', started: String(unixMorning), finished: String(unixMorning + 600)
}).status, 'Готово', 'taskFromReportRow: распознаёт {val,id}, статус Готово при Закончено+факт');

// ── dayTasks: фильтр по втулкорезу + дате, активные выше завершённых, по времени ──
var t1 = core.taskFromReportRow({ task_id: '1', task_date: String(unixMorning + 7200), cutter_id: '10', qty: '5' }); // 10:30 Ожидает
var t2 = core.taskFromReportRow({ task_id: '2', task_date: String(unixMorning), cutter_id: '10', qty: '5', finished: String(unixMorning + 100), fact: '5' }); // 08:30 Готово
var t3 = core.taskFromReportRow({ task_id: '3', task_date: String(unixMorning), cutter_id: '10', qty: '5' }); // 08:30 Ожидает
var t4 = core.taskFromReportRow({ task_id: '4', task_date: String(unixMorning), cutter_id: '20', qty: '5' }); // другой втулкорез
var allTasks = [t1, t2, t3, t4];
assertEqual(core.dayTasks(allTasks, '10', '2026-06-01').map(function(t){ return t.id; }), ['3', '1', '2'],
    'dayTasks: втулкорез 10, активные (по времени) выше завершённых');
assertEqual(core.dayTasks(allTasks, '', '2026-06-01').length, 0, 'dayTasks: без втулкореза → []');
assertEqual(core.dayTasks(allTasks, '10', '2026-06-02').length, 0, 'dayTasks: другой день → []');
assertEqual(core.dayTasks(allTasks, '99', '2026-06-01').length, 0, 'dayTasks: нет заданий втулкореза → []');
assertEqual(core.hasActiveTasks(allTasks, '10', '2026-06-01'), true, 'hasActiveTasks: есть активные → true');
assertEqual(core.hasActiveTasks([t2], '10', '2026-06-01'), false, 'hasActiveTasks: все терминальные → false');

// ── № задания постоянен: место в ПЛАНЕ дня, а не позиция в списке (#4612) ──
// План дня: 08:30 t2 (Готово) → 08:30 t3 → 10:30 t1, значит № 1, № 2 и № 3.
assertEqual(core.dayTasks(allTasks, '10', '2026-06-01').map(function(t){ return t.id + ':' + t.seq; }),
    ['3:2', '1:3', '2:1'], 'dayTasks: № по плановому старту, показ — активные выше завершённых');
assertEqual(core.visibleTasks(allTasks, '10', '2026-06-01').map(function(t){ return t.id + ':' + t.seq; }),
    ['3:2', '1:3'], 'visibleTasks: выполненные скрыты, оставшиеся НЕ перенумерованы (2 и 3)');
assertEqual(core.visibleTasks(allTasks, '10', '2026-06-01', true).map(function(t){ return t.id; }), ['3', '1', '2'],
    'visibleTasks: «показать выполненные» → в списке все задания дня');
assertEqual(core.terminalCount(core.dayTasks(allTasks, '10', '2026-06-01')), 1,
    'terminalCount: сколько заданий дня прячет переключатель');

// Закрыли задание — номера остальных не поехали.
(function() {
    var a = core.taskFromReportRow({ task_id: 'a', task_date: String(unixMorning), cutter_id: '10', qty: '5' });
    var b = core.taskFromReportRow({ task_id: 'b', task_date: String(unixMorning + 3600), cutter_id: '10', qty: '5' });
    var c = core.taskFromReportRow({ task_id: 'c', task_date: String(unixMorning + 7200), cutter_id: '10', qty: '5' });
    var list = [a, b, c];
    assertEqual(core.visibleTasks(list, '10', '2026-06-01').map(function(t){ return t.seq; }), [1, 2, 3],
        'нумерация до закрытия: 1, 2, 3');
    a.finished = String(unixMorning + 100); a.factQty = '5'; a.status = core.statusFromFields(a);
    assertEqual(core.visibleTasks(list, '10', '2026-06-01').map(function(t){ return t.id + ':' + t.seq; }),
        ['b:2', 'c:3'], 'после ✓ Готово у № 1 оставшиеся остаются № 2 и № 3');
    b.finished = String(unixMorning + 200); b.status = core.statusFromFields(b); // Пропущена
    assertEqual(core.visibleTasks(list, '10', '2026-06-01').map(function(t){ return t.id + ':' + t.seq; }),
        ['c:3'], 'после «Пропустить» у № 2 последнее остаётся № 3');
    assertEqual(core.visibleTasks(list, '10', '2026-06-01', true).map(function(t){ return t.id + ':' + t.seq; }),
        ['c:3', 'a:1', 'b:2'], 'с показом выполненных: закрытые внизу, но со своими номерами');
    assertEqual(core.summarize(core.dayTasks(list, '10', '2026-06-01')).total, 3,
        'сводка считает ВСЕ задания дня, а не только показанные');
})();

// ── summarize: агрегаты ──
var sm = core.summarize([
    { planQty: '100', factQty: '100', status: 'Готово' },
    { planQty: '100', factQty: '40', status: 'В работе' },
    { planQty: '50', factQty: '0', status: 'Ожидает' }
]);
assertEqual(sm, { total: 3, done: 1, planQty: 250, factQty: 140, percent: 56 },
    'summarize: план/факт суммарно, готовых, процент');
assertEqual(core.summarize([]), { total: 0, done: 0, planQty: 0, factQty: 0, percent: 0 }, 'summarize: пустой набор');
assertEqual(core.summarize([{ planQty: 10, factQty: 25, status: 'Готово' }]).percent, 100,
    'summarize: процент ограничен 100');

// ── formatRange: подпись диапазона диаметров втулкореза ──
assertEqual(core.formatRange(20, 25), '20–25 мм', 'formatRange: обе границы');
assertEqual(core.formatRange(20, ''), 'от 20 мм', 'formatRange: только min');
assertEqual(core.formatRange('', 76), 'до 76 мм', 'formatRange: только max');
assertEqual(core.formatRange('', ''), '', 'formatRange: пусто');

// ── Метаданные: поиск таблиц/реквизитов по имени (val/alias) ──
var metaList = [
    { id: '1080', val: 'Задача на втулки', attrs: '{"alias":"Задание на втулки"}',
      reqs: [ { id: '1180', val: 'Втулкорез' }, { id: '1183', val: 'Кол-во факт' }, { id: '27163', val: 'Закончено' } ] },
    { id: '1071', val: 'Втулкорез', reqs: [] }
];
assertEqual(core.tableByName(metaList, 'Задание на втулки').id, '1080', 'tableByName: по alias');
assertEqual(core.tableByName(metaList, 'Задача на втулки').id, '1080', 'tableByName: по val');
var taskMeta = core.tableByName(metaList, 'Задание на втулки');
assertEqual(core.reqIdByName(taskMeta, 'Закончено'), '27163', 'reqIdByName: Закончено → 27163');
assertEqual(core.reqIdByName(taskMeta, 'Кол-во факт'), '1183', 'reqIdByName: Кол-во факт → 1183');
assertEqual(core.colIndex(taskMeta, 'Втулкорез'), 1, 'colIndex: главное значение r[0], Втулкорез r[1]');

// ── Controller: запись завершения (Закончено + Кол-во факт) ──
(function() {
    var Controller = mod.Controller;
    var inst = Object.create(Controller.prototype);
    inst.busy = false;
    inst.meta = { task: taskMeta };
    var captured = [];
    inst.post = function(path, params) { captured.push({ path: path, params: params }); return Promise.resolve({}); };
    inst.setBusy = function(v) { this.busy = v; };
    inst.notify = function() {};
    inst.render = function() {};

    inst.markTaskDone({ id: '5', planQty: '120', factQty: '', finished: '' });
    assertEqual(captured[0].path, '_m_set/5?JSON', 'markTaskDone: _m_set по id задания');
    assertEqual(typeof captured[0].params['t27163'], 'number', 'markTaskDone: Закончено = Unix (число)');
    assertEqual(captured[0].params['t27163'] > 0, true, 'markTaskDone: Закончено заполнено');
    assertEqual(captured[0].params['t1183'], 120, 'markTaskDone: Кол-во факт = План');

    inst.busy = false; captured = [];
    inst.skipTask({ id: '6', planQty: '50', factQty: '', finished: '' });
    assertEqual('t27163' in captured[0].params, true, 'skipTask: Закончено пишем');
    assertEqual('t1183' in captured[0].params, false, 'skipTask: Кол-во факт не трогаем');
})();

// ── Controller: loadTasks строит URL отчёта с серверным фильтром ──
(function() {
    var Controller = mod.Controller;
    var inst = Object.create(Controller.prototype);
    inst.selectedCutterId = '2257';
    inst.selectedDate = '2026-06-01';
    var captured = null;
    inst.getJson = function(path) { captured = path; return Promise.resolve([]); };

    inst.loadTasks();
    var b = core.dayBoundsUnix('2026-06-01');
    assertEqual(captured.indexOf('report/sleeve_tasks?JSON_KV') === 0, true, 'loadTasks: читает отчёт sleeve_tasks');
    assertEqual(captured.indexOf('FR_cutter_id=2257') >= 0, true, 'loadTasks: серверный фильтр по втулкорезу');
    assertEqual(captured.indexOf('FR_task_date=' + b.start) >= 0, true, 'loadTasks: нижняя граница дня');
    assertEqual(captured.indexOf('TO_task_date=' + b.end) >= 0, true, 'loadTasks: верхняя граница дня');

    var inst2 = Object.create(Controller.prototype);
    inst2.selectedCutterId = null;
    inst2.tasks = [{ id: 'x' }];
    var called = false;
    inst2.getJson = function() { called = true; return Promise.resolve([]); };
    inst2.loadTasks();
    assertEqual(called, false, 'loadTasks: без втулкореза не ходит в сеть');
    assertEqual(inst2.tasks.length, 0, 'loadTasks: без втулкореза очищает список');
})();

// ── Controller: dayTasks / visibleTasks / отбор closeAll ──
(function() {
    var Controller = mod.Controller;
    var inst = Object.create(Controller.prototype);
    inst.selectedCutterId = '10';
    inst.selectedDate = '2026-06-01';
    inst.showDone = false;
    inst.tasks = [t1, t2, t3];
    assertEqual(inst.dayTasks().map(function(t){ return t.id; }), ['3', '1', '2'],
        'dayTasks (controller): все задания дня, активные выше завершённых');
    assertEqual(inst.visibleTasks().map(function(t){ return t.id; }), ['3', '1'],
        'visibleTasks (controller): по умолчанию выполненные скрыты');
    inst.showDone = true;
    assertEqual(inst.visibleTasks().map(function(t){ return t.id; }), ['3', '1', '2'],
        'visibleTasks (controller): с переключателем видны все');
    var pending = inst.dayTasks().filter(function(t){ return !core.isTerminal(t.status) && t.id; }).map(function(t){ return t.id; });
    assertEqual(pending, ['3', '1'], 'closeAll-отбор: только активные (независимо от переключателя)');
})();

// ── Controller: переключатель «показать выполненные» переживает перезагрузку ──
(function() {
    var Controller = mod.Controller;
    var store = {};
    var savedWindow = global.window;
    global.window = { localStorage: {
        getItem: function(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
        setItem: function(k, v) { store[k] = String(v); }
    } };
    var inst = Object.create(Controller.prototype);
    inst.showDone = true;
    inst.storeShowDone();
    assertEqual(store['atex-sc-show-done'], '1', 'storeShowDone: пишет флаг в localStorage');

    var fresh = Object.create(Controller.prototype);
    fresh.showDone = false;
    fresh.restoreShowDone();
    assertEqual(fresh.showDone, true, 'restoreShowDone: поднимает сохранённый показ выполненных');

    inst.showDone = false;
    inst.storeShowDone();
    fresh.restoreShowDone();
    assertEqual(fresh.showDone, false, 'restoreShowDone: снятый переключатель тоже запоминается');

    var virgin = Object.create(Controller.prototype);
    virgin.showDone = false;
    delete store['atex-sc-show-done'];
    virgin.restoreShowDone();
    assertEqual(virgin.showDone, false, 'restoreShowDone: без записи — выполненные скрыты');
    global.window = savedWindow;
})();

console.log('\n' + passed + ' assertions passed');
