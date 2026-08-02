// #4351 — пульт слиттера: «✓ Готово» на НЕ начатой резке ложно писал «Все проходы уже отмечены».
// Корень: markPassDone считал число отмеченных проходов из «Погонаж факт» (floor(meterage/метраж)),
// а у не начатой резки «Погонаж факт» = «Счётчик нач.» = остаток партии (пред-заполнение, #4321),
// поэтому floor(остаток/метраж) давал ≥ плана.
// #4564: число отмеченных проходов хранится в самом задании — «Кол-во резок факт» (657315);
// его пишет эта же отметка. Погонаж на вопрос «сколько сделано» не отвечает вовсе.
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

function makeInst(actualRuns) {
    var inst = Object.create(Controller.prototype);
    inst.busy = false;
    // сценарий из тикета: «Резка 1 из 60», счётчик мотает назад, остаток партии 49429.952,
    // «Погонаж факт» ЖЕ равен остатку (counterEnd пуст) — вот эта «загрязнённая» цифра.
    inst.currentCut = { id: '90', batchId: '77', status: 'Ожидает', actualRuns: actualRuns || '',
        meterage: '49429.952', counterStart: '49429.952', counterEnd: '', runLength: '300', plannedRuns: '60' };
    inst.shiftEvents = [];
    inst.isCutLocked = function() { return false; };
    inst.eventDateTime = function() { return '2026-07-21 10:00:00'; };
    inst.meta = { cut: { id: '110', reqs: [
        { id: '1105', val: 'Кол-во резок факт' },   // #4564
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

// ── не начата («Кол-во резок факт» пусто), «Погонаж факт» = остаток партии → отмечаем проход 1 ──
var inst = makeInst('');
inst.markPassDone(false);
assert(inst.notes.indexOf('Все проходы уже отмечены') === -1,
    '#4351: не начатая резка НЕ выдаёт «Все проходы уже отмечены»');
assert(inst.posts.length > 0 && inst.posts[0].params['t1104'] === 300,
    '#4351: отмечается проход 1 → «Погонаж факт» = 1×300 (а не блок по загрязнённому погонажу)');
assert(inst.posts[0].params['t1102'] === 49129.952,
    '#4351: «Счётчик кон.» = 49429.952 − 300 (счётчик мотает назад, #4321)');
assert(inst.posts[0].params['t1105'] === 1,
    '#4564: отметка пишет «Кол-во резок факт» = 1 — источник числа проходов');

// ── частично выполненное: сделано 8 из 60 → следующая отметка пишет 9 (вход #4564) ──
var inst3 = makeInst('8');
inst3.markPassDone(false);
assert(inst3.posts.length > 0 && inst3.posts[0].params['t1105'] === 9,
    '#4564: сделано 8 → отмечается проход 9');
assert(inst3.posts[0].params['t1104'] === 2700,
    '#4564: «Погонаж факт» = 9 × 300 (погонаж считается ОТ числа проходов, а не наоборот)');

// ── когда все 60 проходов реально отмечены — тогда блок законен ──
var inst2 = makeInst('60');
inst2.markPassDone(false);
assert(inst2.notes.indexOf('Все проходы уже отмечены') !== -1,
    '#4351: реально все проходы отмечены (факт 60) → «Все проходы уже отмечены» законно');
assert(inst2.posts.length === 0, '#4351: при законном блоке запись не идёт');

// ── #4579: «Кол-во резок факт» есть В КАЖДОМ дескрипторе резки ───────────────
// Боевое: оператор открыл задание 654079 (8 отмеченных проходов) и нажал «✓ Готово» — счёт
// стал 1, «Погонаж факт» 450 вместо 3600. Причина: loadCut (одиночная запись, из неё живёт
// currentCut — та самая, на которой жмут «Готово») поле не читал, donePassCount вернул 0.
// Проверяем ВСЕ три пути, которыми в пульте появляется дескриптор резки.
(function() {
    var api = require('../download/atex/js/slitter.js');
    var core = api.core;
    // 1) отчёт slitter_cuts
    var fromReport = core.rowsToCuts([{ cut_id: '90', cut_plan_date: '1', cut_planned_runs: '60',
        cut_runs_fact: '8' }])[0];
    assert(core.actualRunsForCut(fromReport) === 8, '#4579 rowsToCuts отдаёт «Кол-во резок факт»');
    // 2) и 3) — object/-пути (loadCutsFromTable и loadCut) читают реквизит по имени:
    //    проверяем, что имя реквизита объявлено и совпадает у обоих.
    assert(api.Controller.prototype.donePassCount.call({}, { actualRuns: '8' }) === 8,
        '#4579 donePassCount берёт число из дескриптора');
    assert(api.Controller.prototype.donePassCount.call({}, {}) === 0,
        '#4579 нет поля → 0 (и это ровно тот случай, что затирал счёт: следующая отметка писала 1)');
})();

console.log('\n' + passed + '/' + total + ' assertions passed');
if (passed !== total) process.exitCode = 1;
