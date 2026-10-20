// #5209 — пульт слиттера: в шапке задания 6094 (запись 972638, сырьё R300V) стояло MR190.
//
// Корень: loadCut перечитывал запись задания, но НЕ брал её «Вид сырья» (реквизит 95358,
// ссылка) → currentCut.materialId/material пустые. batchMatchesCut при пустом сырье задания
// пропускает ЛЮБУЮ партию, syncInitialBatchSelection взял по FIFO партию 753078 (MR190), а
// loadCutMaterial переписал cut.material сырьём партии → шапка renderCutSpec показала MR190.
//
// Фикс: loadCut берёт «Вид сырья» задания (из записи, иначе из уже загруженной строки очереди
// slitter_cuts). Партии чужого сырья больше не подбираются; нет партии своего сырья — пульт
// показывает «Партия сырья не подобрана…». Задание без вида сырья ведёт себя как раньше.
//
// Run with: node experiments/atex-slitter-5209-task-material.test.js

process.env.TZ = 'Europe/Moscow';
var api = require('../download/atex/js/slitter.js');
var Controller = api.Controller;

var passed = 0, total = 0;
function assert(cond, name) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}

// Реквизиты — реальные имена таблицы 1078 (ateh), как в atex-slitter-4353.
var cutMeta = { id: '1078', reqs: [
    { id: '1156', val: 'Слиттер' }, { id: '95358', val: 'Вид сырья' }, { id: '1161', val: 'Начато' },
    { id: '1162', val: 'В работе' }, { id: '16403', val: 'Кол-во резок план' },
    { id: '1164', val: 'Счётчик нач.' }, { id: '1166', val: 'Счётчик кон.' },
    { id: '15018', val: 'Партия сырья' }, { id: '16411', val: 'Закончено' },
    { id: '24305', val: 'Метраж, м' }, { id: '28144', val: 'Тип намотки' }
] };
// Метаданные без реквизита «Вид сырья» — сырьё берётся из строки очереди slitter_cuts.
var cutMetaNoMaterial = { id: '1078', reqs: cutMeta.reqs.filter(function(r) { return r.val !== 'Вид сырья'; }) };

// Боевые партии из тикета: 753078 MR190 (остаток 4271), активных партий R300V нет.
function liveBatches() {
    return [
        { id: '753078', label: '1781038800', materialId: '2073', materialLabel: 'MR190', remainderM: 4271, date: '1781038800' },
        { id: '74925', label: '1781038800', materialId: '2208', materialLabel: 'MWR113L', remainderM: 900, date: '1781038801' }
    ];
}

// Запись 972638 в порядке cutMeta.reqs: Слиттер, Вид сырья, Начато, В работе, Кол-во план,
// Счётчик нач., Счётчик кон., Партия сырья (пусто), Закончено, Метраж, Тип намотки.
function taskRow(material) {
    return ['1792484220', '1282:Станок 3', material, '1792494628', '', '1', '', '4271', '', '1792494629', '200.00', 'OUT'];
}
function taskRowNoMaterial() {
    var r = taskRow('');
    r.splice(2, 1);
    return r;
}

function makeInst(meta, row, batches, queue) {
    var inst = Object.create(Controller.prototype);
    inst.meta = { cut: meta };
    inst.batches = batches;
    inst.materialWidths = {};
    inst.selectedBatchIds = [];
    inst.cuts = queue || [];
    inst.getJson = function(path) {
        if (/^object\/1078\//.test(path)) return Promise.resolve([{ i: '972638', r: row }]);
        return Promise.reject(new Error('unexpected request ' + path));
    };
    // Остальные загрузки openCut к дефекту не относятся.
    inst.loadStrips = function() { return Promise.resolve(); };
    inst.loadEvents = function() { return Promise.resolve(); };
    inst.computeSeamless = function() { return Promise.resolve(); };
    inst.setBusy = function() {};
    inst.errors = [];
    // openCut не возвращает промис — конец цепочки ловим по render / тосту ошибки.
    inst.done = new Promise(function(resolve) {
        inst.render = resolve;
        inst.notify = function(msg, kind) { if (kind === 'error') { inst.errors.push(msg); resolve(); } };
    });
    return inst;
}

function open(inst) {
    inst.openCut('972638');
    return inst.done;
}

var queueRow = { id: '972638', slitterId: '1282', materialId: '919491', material: 'R300V', batchId: null, batch: '' };

Promise.resolve()
.then(function() {
    // ── 1. Боевой случай: задание R300V, партий R300V нет → партия не подбирается ───────────
    var inst = makeInst(cutMeta, taskRow('919491:R300V'), liveBatches(), [queueRow]);
    return open(inst).then(function() {
        var cut = inst.currentCut;
        assert(inst.errors.length === 0, '#5209: задание открывается без ошибок');
        assert(String(cut.materialId) === '919491', '#5209: loadCut берёт «Вид сырья» задания (id 919491)');
        assert(cut.material === 'R300V', '#5209: сырьё открытого задания — R300V, а не сырьё чужой партии');
        assert(inst.selectedBatchIds.length === 0, '#5209: партия чужого сырья (753078 MR190) НЕ подобрана');
        assert(!cut.batchId, '#5209: в задание не подставлена партия другого сырья');
        assert(cut.counterStart !== '4271', '#5209: «Счётчик нач.» не взят из остатка чужой партии');
    });
})
.then(function() {
    // ── 2. Реквизита в записи нет — сырьё берётся из строки очереди slitter_cuts ──────────────
    var inst = makeInst(cutMetaNoMaterial, taskRowNoMaterial(), liveBatches(), [queueRow]);
    return open(inst).then(function() {
        var cut = inst.currentCut;
        assert(String(cut.materialId) === '919491' && cut.material === 'R300V',
            '#5209: без реквизита в записи сырьё задания берётся из строки очереди');
        assert(inst.selectedBatchIds.length === 0, '#5209: и тогда партия чужого сырья не подобрана');
    });
})
.then(function() {
    // ── 3. Партия своего сырья есть — подбирается она, а не первая по FIFO чужая ──────────────
    var batches = liveBatches().concat([
        { id: '800001', label: 'R300V-1', materialId: '919491', materialLabel: 'R300V', remainderM: 1500, date: '1790000000' }
    ]);
    var inst = makeInst(cutMeta, taskRow('919491:R300V'), batches, [queueRow]);
    return open(inst).then(function() {
        var cut = inst.currentCut;
        assert(inst.selectedBatchIds.join(',') === '800001', '#5209: подобрана партия сырья задания (R300V)');
        assert(cut.material === 'R300V', '#5209: шапка — R300V');
    });
})
.then(function() {
    // ── 4. Задание без вида сырья (ни в записи, ни в очереди) — поведение прежнее ────────────
    var inst = makeInst(cutMeta, taskRow(''), liveBatches(), []);
    return open(inst).then(function() {
        assert(inst.selectedBatchIds.length === 1, '#5209: задание без вида сырья — автоподбор как раньше');
    });
})
.then(function() {
    console.log('\n' + passed + '/' + total + ' assertions passed');
    if (passed !== total) process.exitCode = 1;
}).catch(function(e) {
    console.error(e);
    process.exitCode = 1;
});
