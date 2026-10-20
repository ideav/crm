// #5209 (решение владельца: «нельзя выбрать такую партию») — пульт слиттера не даёт привязать
// к заданию партию сырья (таблица 1074) ДРУГОГО вида сырья ни одним путём:
//   • плановая «Партия сырья» записи задания (реквизит 15018) чужого сырья — сбрасывается при
//     открытии с понятным отказом, вместо неё подбирается партия своего сырья (если есть);
//   • партии нет в пуле — её «Вид сырья» дочитывается из объекта партии, та же проверка;
//   • сырьё задания НЕ перезаписывается сырьём партии (шапка не меняется на чужое);
//   • запись на границе: отметка прохода и сведение остатка партии (_m_set партии) отказывают,
//     если в состоянии пульта осталась чужая партия (устаревший UI);
//   • #4996: партия, чьё сырьё совпадает с АЛЬТЕРНАТИВНЫМ названием сырья задания, — своя;
//   • задание без вида сырья — поведение прежнее (любая партия).
//
// Run with: node experiments/atex-slitter-5209-foreign-batch.test.js

process.env.TZ = 'Europe/Moscow';
var api = require('../download/atex/js/slitter.js');
var Controller = api.Controller;
var core = api.core || api;

var passed = 0, total = 0;
function assert(cond, name) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}

var cutMeta = { id: '1078', reqs: [
    { id: '1156', val: 'Слиттер' }, { id: '95358', val: 'Вид сырья' }, { id: '1161', val: 'Начато' },
    { id: '1162', val: 'В работе' }, { id: '16403', val: 'Кол-во резок план' },
    { id: '1164', val: 'Счётчик нач.' }, { id: '1166', val: 'Счётчик кон.' },
    { id: '15018', val: 'Партия сырья' }, { id: '16411', val: 'Закончено' },
    { id: '24305', val: 'Метраж, м' }, { id: '28144', val: 'Тип намотки' }
] };
// «Партия сырья» (1074): главное значение, Вид сырья, Остаток, м.
var batchMeta = { id: '1074', reqs: [
    { id: '1075', val: 'Вид сырья' }, { id: '16420', val: 'Остаток, м' }, { id: '1077', val: 'Остаток, м²' }
] };

function mr190() { return { id: '753078', label: '1781038800', materialId: '2073', materialLabel: 'MR190', remainderM: 4271, date: '1781038800' }; }
function r300v() { return { id: '800001', label: 'R300V-1', materialId: '919491', materialLabel: 'R300V', remainderM: 1500, date: '1790000000' }; }

// Слиттер, Вид сырья, Начато, В работе, Кол-во план, Счётчик нач., Счётчик кон., Партия сырья,
// Закончено, Метраж, Тип намотки.
function taskRow(material, batchRef) {
    return ['1792484220', '1282:Станок 3', material, '', '', '1', '', '', batchRef || '', '', '200.00', 'OUT'];
}

function makeInst(row, batches, batchObjects) {
    var inst = Object.create(Controller.prototype);
    inst.meta = { cut: cutMeta, batch: batchMeta };
    inst.batches = batches;
    inst.materialWidths = {};
    inst.selectedBatchIds = [];
    inst.cuts = [];
    inst.posts = [];
    inst.getJson = function(path) {
        if (/^object\/1078\//.test(path)) return Promise.resolve([{ i: '972638', r: row }]);
        if (/^object\/1074\//.test(path)) {
            var m = /F_I=(\d+)/.exec(path);
            var obj = (batchObjects || {})[m && m[1]];
            return Promise.resolve(obj ? [obj] : []);
        }
        return Promise.reject(new Error('unexpected request ' + path));
    };
    inst.post = function(path, body) { inst.posts.push({ path: path, body: body }); return Promise.resolve({}); };
    inst.postRetry = inst.post;
    inst.loadStrips = function() { return Promise.resolve(); };
    inst.loadEvents = function() { return Promise.resolve(); };
    inst.computeSeamless = function() { return Promise.resolve(); };
    inst.setBusy = function() {};
    inst.errors = [];
    inst.done = new Promise(function(resolve) {
        inst.render = resolve;
        inst.notify = function(msg, kind) {
            if (kind === 'error') inst.errors.push(msg);
            if (/Не удалось открыть/.test(msg)) resolve();
        };
    });
    return inst;
}

function open(inst) { inst.openCut('972638'); return inst.done; }

var FOREIGN_MSG = 'Партия 753078 — сырьё MR190, задание на R300V. Выбрать нельзя.';

Promise.resolve()
.then(function() {
    // ── 0. Чистое правило: сообщение отказа и альтернативное имя сырья (#4996) ─────────────
    assert(typeof core.foreignBatchMessage === 'function', 'core.foreignBatchMessage экспортирован');
    if (typeof core.foreignBatchMessage !== 'function') return;
    var cut = { materialId: '919491', materialLabel: 'R300V', material: 'R300V' };
    assert(core.foreignBatchMessage(mr190(), cut) === FOREIGN_MSG, 'отказ: «' + FOREIGN_MSG + '»');
    assert(core.foreignBatchMessage(r300v(), cut) === '', 'партия своего сырья — без отказа');
    assert(core.foreignBatchMessage(null, cut) === '', 'нет партии — нечего отвергать');
    var noMat = { materialId: '', materialLabel: '' };
    assert(core.foreignBatchMessage(mr190(), noMat) === '', 'задание без сырья — любая партия (как раньше)');
    // #4996: у партии только имя сырья, и оно — альтернативное название сырья задания.
    var altCut = { materialId: '', materialLabel: 'R300V', altMaterial: 'Р-300 бел' };
    var altBatch = { id: '9', materialId: '', materialLabel: 'Р-300 бел', remainderM: 10 };
    assert(core.batchMatchesCut(altBatch, altCut), '#4996: партия с альтернативным именем сырья задания — своя');
    assert(core.foreignBatchMessage(altBatch, altCut) === '', '#4996: и отказа нет');
    assert(!core.batchMatchesCut({ id: '8', materialLabel: 'MR190' }, altCut), '#4996: чужое имя — по-прежнему чужая');
})
.then(function() {
    // ── 1. Плановая партия задания — чужого сырья, своих нет → сброшена, отказ, шапка R300V ──
    var inst = makeInst(taskRow('919491:R300V', '753078:1781038800'), [mr190()]);
    return open(inst).then(function() {
        var cut = inst.currentCut;
        assert(!cut.batchId, '#5209: плановая партия чужого сырья снята с задания');
        assert(inst.selectedBatchIds.indexOf('753078') < 0, '#5209: чужая партия не выбрана');
        assert(inst.errors.indexOf(FOREIGN_MSG) >= 0, '#5209: оператору — «' + FOREIGN_MSG + '»');
        assert(cut.material === 'R300V' && String(cut.materialId) === '919491',
            '#5209: сырьё задания не перезаписано сырьём чужой партии');
        assert(cut.counterStart !== '4271', '#5209: «Счётчик нач.» не из остатка чужой партии');
    });
})
.then(function() {
    // ── 2. Плановая чужая, своя есть → берётся своя ────────────────────────────────────────
    var inst = makeInst(taskRow('919491:R300V', '753078:1781038800'), [mr190(), r300v()]);
    return open(inst).then(function() {
        var cut = inst.currentCut;
        assert(String(cut.batchId) === '800001', '#5209: вместо чужой плановой — партия своего сырья');
        assert(inst.selectedBatchIds.join(',') === '800001', '#5209: выбрана своя партия');
        assert(cut.material === 'R300V', '#5209: шапка R300V');
    });
})
.then(function() {
    // ── 3. Плановой чужой партии нет в пуле — сырьё дочитывается из объекта партии ─────────
    var objects = { '753078': { i: '753078', r: ['1781038800', '2073:MR190', '4271', ''] } };
    var inst = makeInst(taskRow('919491:R300V', '753078:1781038800'), [], objects);
    return open(inst).then(function() {
        var cut = inst.currentCut;
        assert(!cut.batchId, '#5209: партия вне пула, сырьё MR190 — снята с задания');
        assert(cut.material === 'R300V' && String(cut.materialId) === '919491', '#5209: шапка осталась R300V');
        assert(inst.errors.indexOf(FOREIGN_MSG) >= 0, '#5209: отказ с названием сырья партии');
    });
})
.then(function() {
    // ── 4. Плановая партия своего сырья — остаётся, отказов нет ────────────────────────────
    var inst = makeInst(taskRow('919491:R300V', '800001:R300V-1'), [mr190(), r300v()]);
    return open(inst).then(function() {
        assert(String(inst.currentCut.batchId) === '800001', 'плановая партия своего сырья сохраняется');
        assert(inst.errors.length === 0, 'и без отказов');
    });
})
.then(function() {
    // ── 5. Задание без вида сырья — плановая партия любая, как раньше ──────────────────────
    var inst = makeInst(taskRow('', '753078:1781038800'), [mr190()]);
    return open(inst).then(function() {
        assert(String(inst.currentCut.batchId) === '753078', 'задание без сырья: плановая партия не трогается');
        assert(inst.errors.length === 0, 'и без отказов');
    });
})
.then(function() {
    // ── 6. Граница записи: устаревшее состояние с чужой партией — остаток партии не пишется ─
    var inst = makeInst(taskRow('919491:R300V', ''), [mr190()]);
    var cut = { id: '972638', materialId: '919491', materialLabel: 'R300V', material: 'R300V', batchId: '753078' };
    return Promise.resolve(inst.syncBatchRemainder(cut, 4000, false)).then(function() {
        assert(inst.posts.length === 0, '#5209: _m_set чужой партии НЕ отправлен');
        assert(inst.errors.indexOf(FOREIGN_MSG) >= 0, '#5209: сведение остатка — отказ «Выбрать нельзя»');
    });
})
.then(function() {
    // ── 7. Граница записи: отметка прохода с чужой партией в состоянии — отказ до записи ──────
    var inst = makeInst(taskRow('919491:R300V', ''), [mr190()]);
    inst.currentCut = { id: '972638', status: '', materialId: '919491', materialLabel: 'R300V', material: 'R300V',
        batchId: '753078', runLength: '200', plannedRuns: '5', counterStart: '' };
    inst.isCutLocked = function() { return false; };
    inst.donePassCount = function() { return 0; };
    inst.activeJumbo = function() { return null; };
    try { inst.markPassDone(false); } catch (e) { /* после отказа сюда не дойдёт */ }
    return new Promise(function(r) { setTimeout(r, 20); }).then(function() {
        assert(inst.posts.length === 0, '#5209: отметка прохода с чужой партией ничего не записала');
        assert(inst.errors.indexOf(FOREIGN_MSG) >= 0, '#5209: отметка прохода — отказ «Выбрать нельзя»');
        assert(inst.currentCut.counterStart !== '4271', '#5209: «Счётчик нач.» не взят из чужой партии');
    });
})
.then(function() {
    console.log('\n' + passed + '/' + total + ' assertions passed');
    if (passed !== total) process.exitCode = 1;
}).catch(function(e) {
    console.error(e);
    process.exitCode = 1;
});
