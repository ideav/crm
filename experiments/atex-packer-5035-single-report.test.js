// ideav/crm#5035: рабочее место упаковщика раз в минуту перечитывает задания, чтобы
// видеть новые номера джамбо. Обновление ходило в ТРИ отчёта (`packer`, `packer_next`,
// `task_jumbo`) над одними и теми же таблицами; теперь всё — один отчёт `packers`:
//   • колонка `jumbos` — номера джамбо задания строкой `"J-100":12:0,"J-101":3:1`
//     (номер:резки:брак; номер вводится руками и бывает с запятыми и кавычками);
//   • строка с `events` (id события «Резка») — в список упаковки; глубина — сегодня и
//     ОДИН предыдущий день, где у места есть порезанные позиции (после выходных —
//     пятница), глубже ничего;
//   • строка без `events` — кандидат «следующего задания», только сегодня и позже;
//   • «сегодня» — по времени сервера (#5007), часы планшета не влияют.
//
// Run with: node experiments/atex-packer-5035-single-report.test.js

var mod = require('../download/atex/js/packer.js');
var core = mod.core;
var Controller = mod.Controller;

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
function has(name) {
    if (typeof core[name] === 'function') return true;
    assertEqual('нет функции', name, 'core.' + name + ' существует');
    return false;
}

// Местный момент → Unix-секунды (как колонка task отчёта).
function unix(y, m, d, h) { return String(Math.round(new Date(y, m - 1, d, h || 8, 0, 0).getTime() / 1000)); }
function ms(y, m, d, h) { return new Date(y, m - 1, d, h || 12, 0, 0).getTime(); }

function row(over) {
    var base = {
        task: unix(2026, 9, 28), qty: '10', qty_fact: '', packed: '', notes: '', events: '',
        order: '', material: 'MWR118', cut_width: '55.00', cut_length: '1000.00',
        wind_direction: 'OUT', sleeve: '', add_sleeve: '', task_id: '1', gp_id: '11',
        order_no: '5550', tipo: '', tipo_id: '', material_type: '', packer_no: '1',
        art: '', leader: '', slitter: 'Станок 1', slitter_id: '1277', alt_material: '', jumbos: ''
    };
    Object.keys(over || {}).forEach(function(k) { base[k] = over[k]; });
    return base;
}

// ── jumbos: разбор колонки ──
if (has('parseJumbosField')) {
    var p = core.parseJumbosField;
    assertEqual(p('"J-100":12:0,"J-101":3:1'),
        [{ no: 'J-100', cuts: '12', defect: '0' }, { no: 'J-101', cuts: '3', defect: '1' }],
        'jumbos: номер, резки и брак каждого джамбо');
    assertEqual(p('"1026080508-1735"::0,"17260507-0859"::'),
        [{ no: '1026080508-1735', cuts: '', defect: '0' }, { no: '17260507-0859', cuts: '', defect: '' }],
        'jumbos: пустые резки/брак не теряют джамбо');
    assertEqual(p('",hg":8:0,"Z41320":8:0'),
        [{ no: ',hg', cuts: '8', defect: '0' }, { no: 'Z41320', cuts: '8', defect: '0' }],
        'jumbos: запятая в номере (боевой номер «,hg») не рвёт список');
    assertEqual(p('"J"7":1:0,"K":2:0'),
        [{ no: 'J"7', cuts: '1', defect: '0' }, { no: 'K', cuts: '2', defect: '0' }],
        'jumbos: кавычка в номере без экранирования');
    assertEqual(p('"J\\"7":1:0'), [{ no: 'J"7', cuts: '1', defect: '0' }],
        'jumbos: экранированная кавычка в номере снимается');
    assertEqual(p(''), [], 'jumbos: пусто — джамбо нет');
    assertEqual(p(null), [], 'jumbos: нет колонки — джамбо нет');
}

// ── jumbos → карты заданий (те же, что строились из task_jumbo) ──
if (has('jumboRowsFromReport')) {
    var rowsJ = [
        row({ task_id: '1', gp_id: '11', jumbos: '"A":0:0,"B":5:1' }),
        row({ task_id: '1', gp_id: '12', jumbos: '"A":0:0,"B":5:1' }),
        row({ task_id: '2', gp_id: '21', jumbos: '' })
    ];
    var jr = core.jumboRowsFromReport(rowsJ);
    assertEqual(core.jumbosByTask(jr), { '1': ['A', 'B'] },
        'jumbos: номера задания берутся один раз, хотя колонка повторяется у каждой Партии ГП');
    assertEqual(core.jumboStatsByTask(jr),
        { '1': [{ no: 'A', cuts: 0, defect: 0 }, { no: 'B', cuts: 5, defect: 1 }] },
        'jumbos: резки и брак по джамбо для «N шт с джамбо» (#5005)');
}

// ── splitReportRows: список упаковки и очередь ──
if (has('splitReportRows')) {
    var monday = ms(2026, 9, 28);
    var rowsS = [
        row({ gp_id: 'today-cut', task_id: 't1', task: unix(2026, 9, 28), events: '901' }),
        row({ gp_id: 'fri-packed', task_id: 't2', task: unix(2026, 9, 25), events: '902', packed: '135' }),
        row({ gp_id: 'fri-open', task_id: 't3', task: unix(2026, 9, 25), events: '903' }),
        row({ gp_id: 'wed-open', task_id: 't4', task: unix(2026, 9, 23), events: '904' }),
        row({ gp_id: 'past-uncut', task_id: 't5', task: unix(2026, 9, 25), events: '' }),
        row({ gp_id: 'today-uncut', task_id: 't6', task: unix(2026, 9, 28, 14), events: '' }),
        row({ gp_id: 'tue-uncut', task_id: 't7', task: unix(2026, 9, 29), events: '' })
    ];
    var gp = function(list) { return list.map(function(it) { return it.gpId; }); };
    var s = core.splitReportRows(rowsS, monday);
    assertEqual(gp(s.items), ['today-cut', 'fri-packed', 'fri-open'],
        'список: сегодня + предыдущий день с резками (пятница после выходных), среда — глубже, не видна');
    assertEqual(gp(s.nextItems), ['today-uncut', 'tue-uncut'],
        'очередь: задания без резки только сегодня и позже');

    var s2 = core.splitReportRows(rowsS, ms(2026, 9, 29));
    assertEqual(gp(s2.items), ['today-cut'],
        'список во вторник: предыдущий день с резками — понедельник, пятница уже не видна');

    var onlyToday = [row({ gp_id: 'a', task: unix(2026, 9, 28), events: '1' })];
    assertEqual(gp(core.splitReportRows(onlyToday, monday).items), ['a'],
        'список: предыдущего дня с резками нет — только сегодня');

    var cutToday = row({ gp_id: 'b', task_id: 'x', task: unix(2026, 9, 28), events: '905', slitter: 'Станок 3' });
    assertEqual(core.splitReportRows([cutToday], monday).items[0].slitter, 'Станок 3',
        'список: станок задания сохраняется в позиции');

    var noDate = [row({ gp_id: 'nd', task: '', events: '7' })];
    assertEqual(gp(core.splitReportRows(noDate, monday).items), ['nd'],
        'список: задание без даты старта не прячется');
}

// ── Контроллер: один запрос, «сегодня» — по часам сервера ──
var requested = [];
var c = Object.create(Controller.prototype);
c.place = { id: '669275', label: '1' };
c.items = [];
c.nextItems = [];
c.pendingWrites = {};
c.applyPendingWrites = function() {};
c.getJson = function(path) {
    requested.push(path);
    // Сервер говорит: понедельник 28.09. Часы планшета — не используются.
    this.serverTimeMs = ms(2026, 9, 28);
    return Promise.resolve([
        row({ gp_id: 'fri', task_id: 'T1', task: unix(2026, 9, 25), events: '1', jumbos: '"J-100":12:0,"J-101":3:1' }),
        row({ gp_id: 'mon-next', task_id: 'T2', task: unix(2026, 9, 28, 15), events: '' })
    ]);
};
c.loadItems().then(function() {
    assertEqual(requested, ['report/packers?JSON_KV&LIMIT=0,5000&FR_packer_no=1'],
        'загрузка: один запрос — отчёт packers с фильтром места');
    assertEqual(c.items.map(function(it) { return it.gpId; }), ['fri'],
        'загрузка: в списке — задание с резкой');
    assertEqual(c.nextItems.map(function(it) { return it.gpId; }), ['mon-next'],
        'загрузка: в очереди — задание без резки');
    assertEqual(c.items[0].jumbo, 'J-100, J-101',
        'загрузка: номера джамбо задания — на позиции');
    assertEqual(c.jumboStats.T1, [{ no: 'J-100', cuts: 12, defect: 0 }, { no: 'J-101', cuts: 3, defect: 1 }],
        'загрузка: резки и брак джамбо — для плашки «N шт с джамбо»');
    console.log('\n' + passed + ' passed');
}).catch(function(err) {
    assertEqual(String(err && err.message), '', 'загрузка без исключений');
});
