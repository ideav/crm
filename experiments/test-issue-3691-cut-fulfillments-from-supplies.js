// Unit-тесты ideav/crm#3691: id «Обеспечений» удаляемой резки берутся из УЖЕ ЗАГРУЖЕННЫХ
// this.supplies (cut_planning), а НЕ из отчёта 81463 (cut→fulfillment) — тот зависел от
// совпадения дат резки/Партии ГП/Обеспечения и возвращал пусто, из-за чего _m_del резки
// падал на 409 (живая ссылка Обеспечения на Партию ГП).
//
// Run with: node experiments/test-issue-3691-cut-fulfillments-from-supplies.js

process.env.TZ = 'UTC';
var api = require('../download/atex/js/production-planning.js');
var planning = api.planning;

var passed = 0;
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; }
    else { console.log('  expected:', JSON.stringify(expected)); console.log('  actual:  ', JSON.stringify(actual)); process.exitCode = 1; }
}

// Форма this.supplies как из rowsToPlanning: { id, positionId, cutId, finishedBatchId, ... }
var SUP = [
    { id:'93151', cutId:'94345', positionId:'91750', finishedBatchId:'93123' },
    { id:'93156', cutId:'94345', positionId:'91747', finishedBatchId:'93131' },
    { id:'93161', cutId:'999',   positionId:'91748', finishedBatchId:'93131' }
];
assertEqual(planning.cutFulfillmentIds(SUP, '94345'), ['93151', '93156'],
    'cutFulfillmentIds: обеспечения резки 94345 из this.supplies');
assertEqual(planning.cutFulfillmentIds(SUP, 94345), ['93151', '93156'],
    'cutFulfillmentIds: числовой cutId приводится к строке');
assertEqual(planning.cutFulfillmentIds(SUP, '999'), ['93161'], 'cutFulfillmentIds: другая резка');
assertEqual(planning.cutFulfillmentIds(SUP, '7777'), [], 'cutFulfillmentIds: нет связей → []');
assertEqual(planning.cutFulfillmentIds(SUP, null), ['93151', '93156', '93161'],
    'cutFulfillmentIds: без cutId → все обеспечения');
// дедуп и пропуск пустых/null id
assertEqual(planning.cutFulfillmentIds([
    { id:'s1', cutId:'A' }, { id:'s1', cutId:'A' }, { id:'', cutId:'A' }, { id:null, cutId:'A' }, null
], 'A'), ['s1'], 'cutFulfillmentIds: дедуп + пропуск пустых/null');
assertEqual(planning.cutFulfillmentIds(null, 'A'), [], 'cutFulfillmentIds: null supplies → []');

// loadCutFulfillments читает из this.supplies (без сети/отчёта 81463) и возвращает Promise.
var controller = Object.create(api.Controller.prototype);
controller.supplies = SUP;
var reportCalled = false;
controller.getJson = function() { reportCalled = true; return Promise.reject(new Error('отчёт 81463 не должен дёргаться')); };
controller.loadCutFulfillments('94345').then(function(ids) {
    assertEqual(ids, ['93151', '93156'], 'loadCutFulfillments #3691: id из this.supplies');
    assertEqual(reportCalled, false, 'loadCutFulfillments #3691: отчёт 81463 НЕ запрашивается');
    console.log('\n' + passed + ' проверок прошло.');
    if (process.exitCode === 1) console.log('ЕСТЬ ПАДЕНИЯ — см. выше.');
    else console.log('Все проверки #3691 зелёные.');
}).catch(function(err) { console.error(err && err.stack || err); process.exitCode = 1; });
