// Regression for ideav/crm#4155 — день-сплит продолжение резки теряло «Партию сырья»
// (пустая) и «Обеспечение» (не привязано к заказу).
//
// Данные с ateh (issue #4155): резка MW308 154*5,110*1 OUT (заказ 3966, срок 07.07),
// разбитая по дням. Голова 477144 (03.07, партия сырья 74929) + продолжение 479056
// (06.07 08:00) — продолжение приходило с ПУСТОЙ «Партией сырья», хотя голова обеспечена.
//
// Корень «пустой партии сырья» (ФИКС #4155):
//   Отчёт cut_planning НЕ отдаёт «Партию сырья» (rowsToPlanning: batchId:'' — отчётный
//   batch_id это «Партия ГП», не сырьё), поэтому applySplitPlan создавал продолжение с
//   materialBatch = parentCut.batchId = ''. Фикс: loadCutSequences читает «Партию сырья»
//   (req 192) прямо с записи через object/ (parseRef ref-колонки), loadPlanning кладёт её в
//   cut.batchId, applySplitPlan берёт партию ГОЛОВЫ цепочки (batchForCutId) для продолжений.
//
// Run with: node experiments/atex-production-planning-4155.test.js

process.env.TZ = 'UTC';
global.window = { db: 'testdb', xsrf: 'x' };
var Controller = require('../download/atex/js/production-planning.js').Controller;

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

function meta(id, pairs) { return { id: String(id), reqs: pairs.map(function(p) { return { id: String(p[0]), val: p[1] }; }) }; }
// Реквизиты «Задания в производство» (1078). id 192 = «Партия сырья».
var cutMeta = meta(100, [
    ['190', 'Вид сырья'], ['191', 'Слиттер'], ['192', 'Партия сырья'], ['193', 'Кол-во план'],
    ['194', 'Статус'], ['196', 'Тип намотки'], ['198', 'Лидер'], ['197', 'Метраж, м'],
    ['199', 'Длительность, минут'], ['200', 'Резка и Лидер'], ['188', 'ID первой части'],
    ['189', 'Зафиксировано']
]);
var fbMeta = meta(300, [['301', 'Ширина, мм'], ['302', 'Кол-во полос'], ['303', 'Кол-во рулонов'], ['304', 'Кол-во план'], ['305', 'В работе']]);
var supMeta = meta(400, [['401', 'Метраж, м'], ['402', 'Кол-во рулонов'], ['403', 'В работе'], ['404', 'Статус'], ['405', 'Партия ГП']]);
var MATERIAL_BATCH_REQ = '192';
var HEAD_BATCH = '74929';   // «Партия сырья» головы (как на ateh)

function makeController(headBatchId) {
    var root = { getAttribute: function() { return 'testdb'; } };
    var c = new Controller(root);
    c.meta.cut = cutMeta; c.meta.finishedBatch = fbMeta; c.meta.supply = supMeta;

    // Голова цепочки: заказ 3966, MW308, OUT, 450 м. batchId — как ПОСЛЕ loadPlanning #4155
    // (object/ отдаёт «Партию сырья»); до фикса cut_planning клал '' → пусто у продолжения.
    var head = {
        id: 'H', length: 450, materialId: 'MW308', status: 'В работе', slitter: { id: 'S1' },
        batchId: headBatchId, winding: 'OUT', leaders: ['MONOCHROME'], plannedRuns: 16,
        firstPartId: 'H', isFoil: false
    };
    c.cuts = [head];

    // Обеспечения головы: 154×100 (поз 435287) и 110×20 (поз 435288). finishedBatchId = id Партии ГП головы.
    c.supplies = [
        { id: 'SUP154', cutId: 'H', positionId: '435287', finishedBatchId: 'FB154', rolls: 100, footage: 45000 },
        { id: 'SUP110', cutId: 'H', positionId: '435288', finishedBatchId: 'FB110', rolls: 20,  footage: 9000 }
    ];
    c.footageBySupply = { SUP154: 45000, SUP110: 9000 };
    c.opTimes = { WIND_100: 2, WIND_1000: 20, KNIFE: 30, MATERIAL_WINDING: 15, BETWEEN_CUTS: 1 };
    c.changeTimes = { BETWEEN_CUTS: 1, KNIFE: 30, MATERIAL_WINDING: 15 };
    c.resolveLeaderId = function(l) { return l ? ('LID_' + l) : ''; };
    c.reload = function() { return Promise.resolve(); };
    c.persistCutSetupColumns = function() { return Promise.resolve(); };
    c.setBusy = function() {}; c.showProgress = function() {}; c.hideProgress = function() {};
    c.render = function() {}; c.notify = function() {}; c.updateProgress = function() {};

    // Полосы (Партии ГП) головы — то, что копируется в продолжение.
    c.loadStripsForCut = function() {
        return Promise.resolve([
            { id: 'FB154', width: 154, qty: 5, orderId: 'O3966' },
            { id: 'FB110', width: 110, qty: 1, orderId: 'O3966' }
        ]);
    };

    // Перехват всех записей.
    var posts = [];
    c.post = function(path, fields) {
        posts.push({ path: path, fields: fields || {} });
        return Promise.resolve({ obj: 'NEW_' + posts.length });
    };
    c._posts = posts;
    return c;
}

// ops: голова H обновляется (seg0=16 проходов), + одно продолжение (seg1=4 прохода 06.07 08:00).
var ops = {
    updates: [{ cutId: 'H', sequence: 1, planStartTs: 1751778540, plannedRuns: 16 }],
    creates: [{ parentCutId: 'H', sequence: 2, planStartTs: 1752040800, plannedRuns: 4 }],
    deletes: []
};

function pathsOf(posts, re) { return posts.filter(function(p) { return re.test(p.path); }); }

// ── Тест 1: loadCutSequences читает «Партию сырья» (req 192) с записи через object/ ──
// (parseRef ref-колонки "74929:label" → id). Голова r[3] = ref; фикс #4155.
(function() {
    var c = makeController(HEAD_BATCH);
    // r = [main, 190, 191, 192(ref), 193, 194, 196, 198, 197, 199, 200, 188, 189]
    var r = [1751778540, 'MW308', 'S1', HEAD_BATCH + ':MW308 154*5,110*1', 16, 'В работе', 'OUT', 'LID', 45000, 3600, 3604, 'H', ''];
    c.getJson = function() { return Promise.resolve([{ i: 'H', r: r }]); };
    c.loadCutSequences().then(function(res) {
        var mb = (res.materialBatch || {})['H'];
        assert(mb === HEAD_BATCH, 'T1: loadCutSequences отдаёт «Партию сырья» головы из object/ (parseRef)', '(materialBatch.H=' + JSON.stringify(mb) + ')');
    }).catch(function(e) { assert(false, 'T1 threw', String(e && e.stack || e)); });
})();

// ── Тест 2: applySplitPlan копирует «Партию сырья» головы в продолжение (ГЛАВНЫЙ фикс) ──
(function() {
  setTimeout(function() {
    var c = makeController(HEAD_BATCH);
    c.applySplitPlan(JSON.parse(JSON.stringify(ops))).then(function() {
        var posts = c._posts;
        var contCreate = pathsOf(posts, /_m_new\/100\?/);
        assert(contCreate.length === 1, 'T2: создано одно продолжение-резка', '(' + contCreate.length + ')');
        var contBatch = contCreate.length ? contCreate[0].fields['t' + MATERIAL_BATCH_REQ] : undefined;
        console.log('  [T2] Партия сырья продолжения (t192) =', JSON.stringify(contBatch));
        assert(String(contBatch) === HEAD_BATCH, 'T2(#4155 ФИКС): продолжение несёт «Партию сырья» головы', '(t192=' + JSON.stringify(contBatch) + ')');
        // Обеспечение головы не пусто → продолжение получает обеспечение (привязку к заказу).
        var contSupplies = pathsOf(posts, /_m_new\/400\?/);
        assert(contSupplies.length === 2, 'T2: продолжение получило обеспечение обеих позиций', '(' + contSupplies.length + ')');
    }).catch(function(e) { assert(false, 'T2 threw', String(e && e.stack || e)); });
  }, 150);
})();

// ── Тест 3: голова без «Партии сырья» (batchId='') → копировать нечего (не падаем) ──
(function() {
  setTimeout(function() {
    var c = makeController('');
    c.applySplitPlan(JSON.parse(JSON.stringify(ops))).then(function() {
        var contCreate = pathsOf(c._posts, /_m_new\/100\?/);
        var contBatch = contCreate.length ? contCreate[0].fields['t' + MATERIAL_BATCH_REQ] : undefined;
        assert(!contBatch, 'T3: у головы нет партии → продолжение без партии (штатно, не крэш)', '(t192=' + JSON.stringify(contBatch) + ')');
        console.log('\n  Итог: ' + passed + '/' + total + ' проверок пройдено.');
    }).catch(function(e) { assert(false, 'T3 threw', String(e && e.stack || e)); });
  }, 300);
})();
