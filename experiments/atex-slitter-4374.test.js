// #4374 — пульт слиттера: при завершении задания вылетал красный тост
// «Ошибка завершения: Cannot read properties of null (reading 'remainderM')», статус задания
// на форме не обновлялся, а после F5 задание было уже «Завершена» (в БД всё записалось).
//
// Корень — ПОСЛЕДНИЙ шаг finishCut, уже после всех записей:
//     'Остаток партии: ' + (cut.batchId ? self.findBatch(cut.batchId) : {}).remainderM
// Партии в пуле больше нет → findBatch = null → TypeError → его ловит .catch всей цепочки →
// «Ошибка завершения», а advanceToNextCut/render не вызываются: форма со старым статусом.
//
// Почему партия исчезла из пула: loadBatches читает report/material_batches?FR_is_active=%25,
// и отчёт отдаёт ТОЛЬКО партии с проставленной «В работе» (живой ateh: 62 строки из 96 записей
// таблицы 1074, единственная запись с пустой «В работе» в отчёт не попала). А applyBatchConsumption
// в finishMode снимал «В работе» у ЛЮБОЙ завершённой резки — с #4366 (пустые значения доезжают
// до сервера) снятие наконец заработало, и рулон с остатком 109890 м уходил из оборота.
//
// Фикс: (1) сообщение не разыменовывает пустую партию, а .catch перерисовывает форму;
//       (2) «В работе» снимаем только когда партия ИСЧЕРПАНА — так же, как склад
//           (warehouse.js: оприходование ставит active=1, снимает при исчерпании).
//
// Run with: node experiments/atex-slitter-4374.test.js

process.env.TZ = 'Europe/Moscow';
var api = require('../download/atex/js/slitter.js');
var Controller = api.Controller;

var passed = 0, total = 0;
function assert(cond, name) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}

var CUT_META = { id: '1078', reqs: [
    { id: '1161', val: 'Начато' }, { id: '1162', val: 'В работе' }, { id: '1164', val: 'Счётчик нач.' },
    { id: '1166', val: 'Счётчик кон.' }, { id: '1168', val: 'Погонаж факт, м' }, { id: '16411', val: 'Закончено' }
] };
var BATCH_META = { id: '1074', reqs: [
    { id: '1123', val: 'Остаток, м²' }, { id: '8456', val: 'Остаток, м' }, { id: '16427', val: 'В работе' }
] };

// finishCut на завершаемом задании; partiya = что вернёт findBatch ПОСЛЕ перезагрузки партий.
function makeInst(batchAfterReload) {
    var inst = Object.create(Controller.prototype);
    inst.busy = false;
    inst.meta = { cut: CUT_META, batch: BATCH_META };
    inst.currentCut = { id: '90', batchId: '77', status: 'В работе',
        counterStart: '109890', counterEnd: '109610', runLength: '280', plannedRuns: '16' };
    inst.currentCutId = '90';
    inst.cuts = [];
    inst.batches = [];
    inst.materialWidths = {};
    inst.notes = [];
    inst.posts = [];
    inst.rendered = 0;
    inst.advanced = 0;
    inst.isCutLocked = function() { return false; };
    inst.eventDateTime = function() { return '2026-07-24 17:26:00'; };
    inst.notify = function(msg, kind) { this.notes.push({ msg: msg, kind: kind }); };
    inst.setBusy = function(v) { this.busy = v; };
    inst.post = function(path, params) { this.posts.push({ path: path, params: params }); return Promise.resolve({}); };
    inst.createEvent = function() { return Promise.resolve({}); };
    inst.loadEvents = function() { return Promise.resolve([]); };
    inst.loadCuts = function() { return Promise.resolve([]); };
    inst.loadBatches = function() { return Promise.resolve([]); };
    inst.recordActualRolls = function() { return Promise.resolve(); };
    inst.applyEventStatuses = function() {};
    inst.advanceToNextCut = function() { this.advanced++; };
    inst.render = function() { this.rendered++; };
    inst.findBatch = function(id) { return String(id) === '77' ? batchAfterReload : null; };
    return inst;
}
function texts(inst) { return inst.notes.map(function(n) { return n.kind + ': ' + n.msg; }); }

// ── симптом тикета: партии в пуле нет (её «В работе» снят) ─────────────────────────────────────
var gone = makeInst(null);
gone.finishCut();
setTimeout(function() {
    assert(gone.notes.filter(function(n) { return n.kind === 'error'; }).length === 0,
        '#4374: завершение НЕ падает с «Ошибка завершения», когда партии нет в пуле');
    assert(gone.notes.length === 1 && gone.notes[0].kind === 'success' &&
           gone.notes[0].msg.indexOf('Резка завершена') === 0,
        '#4374: тост об успешном завершении показан');
    assert(gone.notes[0].msg.indexOf('Остаток партии') === -1,
        '#4374: без партии в пуле про остаток не пишем (а не «null м»)');
    assert(gone.advanced === 1, '#4374: форма обновляется — advanceToNextCut отработал');

    // ── партия на месте: остаток в тосте ───────────────────────────────────────────────────────
    var withBatch = makeInst({ id: '77', remainderM: 109610.5, remainder: 0, widthMm: 500, active: 'X' });
    withBatch.finishCut();
    setTimeout(function() {
        assert(withBatch.notes.length === 1 && withBatch.notes[0].msg.indexOf('Остаток партии: 109610.5 м') !== -1,
            '#4374: партия в пуле → остаток в сообщении, как раньше');
        assert(withBatch.advanced === 1, '#4374: переход к следующему заданию отработал');

        // ── ошибка записи: сообщение об ошибке И перерисовка формы ─────────────────────────────
        var broken = makeInst(null);
        broken.post = function() { return Promise.reject(new Error('нет доступа')); };
        broken.finishCut();
        setTimeout(function() {
            assert(broken.notes.length === 1 && broken.notes[0].kind === 'error' &&
                   broken.notes[0].msg.indexOf('Ошибка завершения: нет доступа') === 0,
                '#4374: настоящая ошибка записи по-прежнему сообщается');
            assert(broken.rendered === 1,
                '#4374: после ошибки форма перерисовывается (часть записей могла пройти)');

            // ── партия «В работе»: снимаем только при исчерпании ───────────────────────────────
            var keep = makeInst(null);
            var batch = { id: '77', materialId: 'm', remainderM: 109890, remainder: 0, widthMm: 500, active: 'X' };
            keep.findBatch = function(id) { return String(id) === '77' ? batch : null; };
            keep.applyBatchConsumption({ batchId: '77' }, 280, true);
            var f = keep.posts[0].params;
            assert(f['t8456'] === 109610 && !('t16427' in f),
                '#4374: расход списан, но партия с остатком остаётся «В работе» (рулон нужен дальше)');

            var used = makeInst(null);
            var last = { id: '77', materialId: 'm', remainderM: 280, remainder: 0, widthMm: 500, active: 'X' };
            used.findBatch = function(id) { return String(id) === '77' ? last : null; };
            used.applyBatchConsumption({ batchId: '77' }, 280, true);
            var g = used.posts[0].params;
            assert(g['t8456'] === 0 && g['t16427'] === '0',
                '#3861/#4374: партия исчерпана → «В работе» снят нулём (#4366)');

            var mid = makeInst(null);
            var half = { id: '77', materialId: 'm', remainderM: 1000, remainder: 0, widthMm: 500, active: 'X' };
            mid.findBatch = function(id) { return String(id) === '77' ? half : null; };
            mid.applyBatchConsumption({ batchId: '77' }, 200, false);
            assert(!('t16427' in mid.posts[0].params),
                '#3861: без finishMode «В работе» не трогаем');

            console.log('\n' + passed + '/' + total + ' assertions passed');
            if (passed !== total) process.exitCode = 1;
        }, 30);
    }, 30);
}, 30);
