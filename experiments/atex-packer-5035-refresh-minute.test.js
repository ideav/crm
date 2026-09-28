// ideav/crm#5035: рабочее место упаковщика должно раз в минуту перечитывать задания —
// оператор слиттера, меняя закончившийся рулон, вводит новый номер джамбо, и упаковщик
// должен увидеть его без ручного «Обновить». Авто-обновление (#5003) срабатывало раз в
// 5 минут — новый джамбо появлялся на плашке с задержкой до пяти минут.
//
// Проверяется поведение: какой период получает таймер, и что его срабатывание через
// минуту после загрузки действительно перечитывает отчёт packers и обновляет плашку.
//
// Run with: node experiments/atex-packer-5035-refresh-minute.test.js

var mod = require('../download/atex/js/packer.js');
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

// Окружение браузера: слушатели событий и таймер перехватываются.
var timers = [];
global.document = { visibilityState: 'visible', addEventListener: function() {} };
global.window = { addEventListener: function() {} };
var realSetInterval = global.setInterval;
global.setInterval = function(fn, ms) { timers.push({ fn: fn, ms: ms }); return timers.length; };

// Контроллер без DOM: сеть — заглушка, отдающая текущий ответ отчёта packers
// (строка задания с резкой; номера джамбо — в колонке jumbos).
function packersRows(jumbos) {
    return [{ task: String(Math.round(new Date().getTime() / 1000)), task_id: '666355',
        gp_id: '666392', events: '901', qty: '110', jumbos: jumbos }];
}
var jumbosField = '"J-100"::';
var requested = [];
var c = Object.create(Controller.prototype);
c.root = null;
c.items = [];
c.jumbos = {};
c.jumboStats = {};
c.place = { id: '1' };
c.busy = false;
c.writing = false;
c.loading = false;
c.hasPlace = function() { return true; };
c.getJson = function(path) {
    requested.push(path);
    return Promise.resolve(path.indexOf('report/packers?') === 0 ? packersRows(jumbosField) : []);
};
c.applyPendingWrites = function() {};
c.render = function() {};

c.armAutoRefresh();
global.setInterval = realSetInterval;

var periodic = timers.filter(function(t) { return typeof t.fn === 'function'; });
assertEqual(periodic.length, 1, '#5035: авто-обновление заводит один периодический таймер');
assertEqual(periodic.length && periodic[0].ms, 60 * 1000,
    '#5035: период авто-обновления — 1 минута');

// Прошла минута с последней загрузки; оператор ввёл новый джамбо J-101.
c.jumbos = { '666355': ['J-100'] };
c.loadedAt = new Date(new Date().getTime() - 60 * 1000);
jumbosField = '"J-100"::,"J-101"::';
periodic[0].fn();

setTimeout(function() {
    assertEqual(requested.some(function(p) { return p.indexOf('report/packers?') === 0; }), true,
        '#5035: минутный тик перечитывает отчёт packers');
    assertEqual(c.jumbos['666355'], ['J-100', 'J-101'],
        '#5035: новый номер джамбо попадает в данные упаковщика через минуту');
    console.log('\n' + passed + ' passed');
}, 20);
