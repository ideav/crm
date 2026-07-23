// #4348 — пульт слиттера: «Закончено» (и любое событие/атрибут) фиксируется ТЕКУЩИМ моментом,
// а НЕ выбранным в пульте днём. Под одной сменой (#4332) оператор выполняет задания будущих дней,
// поэтому eventDateTime не должен подставлять плановую дату задания (selectedDate) в дату события.
//
// Run with: node experiments/atex-slitter-4348.test.js

process.env.TZ = 'Europe/Moscow';
var api = require('../download/atex/js/slitter.js');
var core = api.core, Controller = api.Controller;

var passed = 0, total = 0;
function assert(cond, name) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}

var today = core.todayISO();                 // локальная сегодняшняя дата (как её берёт eventDateTime)
var DT_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

// selectedDate — заведомо НЕ сегодня (будущий день задания)
var inst = Object.create(Controller.prototype);
inst.selectedDate = '2099-12-31';
var dt = inst.eventDateTime();

assert(DT_RE.test(dt), 'eventDateTime: формат «YYYY-MM-DD HH:MM:SS»');
assert(dt.slice(0, 10) === today, 'eventDateTime #4348: дата = СЕГОДНЯ (текущая), не дата задания');
assert(dt.slice(0, 10) !== inst.selectedDate, 'eventDateTime #4348: выбранный будущий день (2099-12-31) НЕ попадает в штамп');

// и когда selectedDate вовсе не задан — тоже сегодня
var inst2 = Object.create(Controller.prototype);
inst2.selectedDate = null;
assert(inst2.eventDateTime().slice(0, 10) === today, 'eventDateTime: без выбранного дня — тоже сегодня');

console.log('\n' + passed + '/' + total + ' assertions passed');
if (passed !== total) process.exitCode = 1;
