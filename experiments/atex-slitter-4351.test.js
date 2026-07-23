// #4351 — пульт слиттера: «✓ Готово» на НЕ начатой резке ложно писал «Все проходы уже отмечены».
// Корень: markPassDone считал число отмеченных проходов из «Погонаж факт» (floor(meterage/метраж)),
// а у не начатой резки «Погонаж факт» = «Счётчик нач.» = остаток партии (пред-заполнение, #4321),
// поэтому floor(остаток/метраж) давал ≥ плана. Фикс: число отмеченных = donePassCount (события
// «Резка», #3621 — как в заголовке «Резка N из M»).
//
// Run with: node experiments/atex-slitter-4351.test.js

process.env.TZ = 'Europe/Moscow';
var api = require('../download/atex/js/slitter.js');
var Controller = api.Controller;

var passed = 0, total = 0;
function assert(cond, name) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}

function makeInst(shiftEvents) {
    var inst = Object.create(Controller.prototype);
    inst.busy = false;
    // сценарий из тикета: «Резка 1 из 60», счётчик мотает назад, остаток партии 49429.952,
    // «Погонаж факт» ЖЕ равен остатку (counterEnd пуст) — вот эта «загрязнённая» цифра.
    inst.currentCut = { id: '90', batchId: '77', status: 'Ожидает',
        meterage: '49429.952', counterStart: '49429.952', counterEnd: '', runLength: '300', plannedRuns: '60' };
    inst.shiftEvents = shiftEvents || [];
    inst.isCutLocked = function() { return false; };
    inst.eventDateTime = function() { return '2026-07-21 10:00:00'; };
    inst.meta = { cut: { id: '110', reqs: [
        { id: '1104', val: 'Погонаж факт, м' },
        { id: '1102', val: 'Счётчик кон.' },
        { id: '1110', val: 'Расход сырья' },
        { id: '1101', val: 'Начато' },
        { id: '1162', val: 'В работе' }
    ] } };
    inst.posts = [];
    inst.notes = [];
    inst.post = function(path, params) { this.posts.push({ path: path, params: params }); return Promise.resolve({}); };
    inst.createEvent = function() { return Promise.resolve({}); };
    inst.applyBatchConsumption = function() { return Promise.resolve(null); };
    inst.loadEvents = function() { return Promise.resolve(); };
    inst.loadCuts = function() { return Promise.resolve(); };
    inst.applyEventStatuses = function() {};
    inst.setBusy = function(v) { this.busy = v; };
    inst.notify = function(msg) { this.notes.push(msg); };
    inst.render = function() {};
    return inst;
}

// ── не начата (0 событий «Резка»), «Погонаж факт» = остаток партии → всё равно отмечаем проход 1 ──
var inst = makeInst([]);
inst.markPassDone(false);
assert(inst.notes.indexOf('Все проходы уже отмечены') === -1,
    '#4351: не начатая резка НЕ выдаёт «Все проходы уже отмечены»');
assert(inst.posts.length > 0 && inst.posts[0].params['t1104'] === 300,
    '#4351: отмечается проход 1 → «Погонаж факт» = 1×300 (а не блок по загрязнённому погонажу)');
assert(inst.posts[0].params['t1102'] === 49129.952,
    '#4351: «Счётчик кон.» = 49429.952 − 300 (счётчик мотает назад, #4321)');

// ── когда все 60 проходов реально отмечены (60 событий «Резка») — тогда блок законен ──
var ev = [];
for (var i = 0; i < 60; i++) ev.push({ type: 'Резка', cutId: '90' });
var inst2 = makeInst(ev);
inst2.markPassDone(false);
assert(inst2.notes.indexOf('Все проходы уже отмечены') !== -1,
    '#4351: реально все проходы отмечены (60 событий) → «Все проходы уже отмечены» законно');
assert(inst2.posts.length === 0, '#4351: при законном блоке запись не идёт');

console.log('\n' + passed + '/' + total + ' assertions passed');
if (passed !== total) process.exitCode = 1;
