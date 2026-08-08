// Unit tests — #4655: остаток партии втулок читается из «Кол-во» (колонка отчёта
// sleeve_batches_active `remaining_qty`), а не из «Остаток, м».
//
// До #4655 loadSleeveBatches брал только remaining_m, поэтому видел лишь шесть
// старых заглушек без склада с «бесконечным» остатком 1 000 000, а 27 карточек с
// реальными складскими остатками втулок были для планировщика пусты.
//
// Run with: node experiments/atex-production-planning-4655-sleeve-qty.test.js

process.env.TZ = 'UTC';

var api = require('../download/atex/js/production-planning.js');
var Controller = api.Controller;

var passed = 0;
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) passed++; else {
        console.log('  expected:', JSON.stringify(expected));
        console.log('  actual:  ', JSON.stringify(actual));
        process.exitCode = 1;
    }
}

// Контроллер без DOM: подменяем сетевой слой и резолв втулкореза.
function controllerWith(rows) {
    var c = Object.create(Controller.prototype);
    c.getJson = function(path) {
        if (path.indexOf('report/sleeve_batches_active') === 0) return Promise.resolve(rows);
        return Promise.resolve([]);
    };
    c.resolveSleeveCutterId = function() { return Promise.resolve(); };
    return c;
}

var ROWS = [
    // Перенесённая карточка склада: количество в «Кол-во», «Остаток, м» пуст.
    { batch_id: '104736', batch_date: '1781384400', sleeve_diameter_id: '35561',
      remaining_m: '', remaining_qty: '20000.00', active: 'X' },
    // Заглушка без склада: «Кол-во» перенесено, легаси-метры пока оставлены.
    { batch_id: '54316', batch_date: '1781198100', sleeve_diameter_id: '35561',
      remaining_m: '1000000.00', remaining_qty: '1000000.00', active: 'X' },
    // Ещё не перенесённая карточка: «Кол-во» пусто — работает фолбэк на метры.
    { batch_id: '104625', batch_date: '1781038800', sleeve_diameter_id: '8190',
      remaining_m: '1757.082', remaining_qty: '', active: 'X' }
];

var ctl = controllerWith(ROWS);
var done = ctl.loadSleeveBatches().then(function() {
    assertEqual(ctl.sleeveBatches.map(function(b) { return b.remaining; }),
        [20000, 1000000, 1757.082],
        'остаток берётся из remaining_qty, при пустом — фолбэк на remaining_m');
    assertEqual(ctl.sleeveBatches.map(function(b) { return b.id; }),
        ['104736', '54316', '104625'], 'партии не теряются и не переупорядочиваются');
    assertEqual(ctl.sleeveBatches[0].diameterId, '35561', 'тип втулки читается как прежде');
    assertEqual(ctl.sleeveBatches.every(function(b) { return b.active === true; }), true,
        '«В работе» читается как прежде');

    // Отчёт без новой колонки (база, где скрипт миграции ещё не прогнан):
    // планировщик продолжает работать по прежнему полю.
    var legacy = controllerWith([
        { batch_id: '54316', batch_date: '1781198100', sleeve_diameter_id: '35561',
          remaining_m: '1000000.00', active: 'X' }
    ]);
    return legacy.loadSleeveBatches().then(function() {
        assertEqual(legacy.sleeveBatches[0].remaining, 1000000,
            'старый отчёт без remaining_qty не ломает подбор партии');
    });
}).then(function() {
    console.log('\n' + passed + ' assertions passed');
});

done.catch(function(err) {
    console.log('FAIL — необработанная ошибка: ' + err.message);
    process.exitCode = 1;
});
