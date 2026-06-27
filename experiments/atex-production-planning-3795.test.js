// Integration test for ideav/crm#3795 — записи-продолжения дробления по дням должны
// нести «Вид сырья». Карточка очереди показывает сырьё из cut_material (своего реквизита
// резки, грузится в c.materialId/materialName), а applySplitPlan копировал в продолжение
// только Слиттер/Партию сырья/Полосы/Очередность/Намотку/Лидера/Метраж — но НЕ «Вид сырья».
// Обеспечения продолжения привязаны к позиции (up=positionId), а не к самой резке по
// «Заданию», поэтому materialByCut сырьё тоже не восстанавливал → у заказа, продолженного
// с прошлого дня (напр. 3716), сырьё в очереди следующего дня показывалось как «—».
//
// Гоняем НАСТОЯЩИЙ applySplitPlan поверх стаба post и проверяем, что:
//   • создаваемая запись-продолжение пишет «Вид сырья» = сырью головы цепочки;
//   • обновляемая запись (голова/реюзнутое продолжение) тоже получает «Вид сырья»
//     (лечит реюзнутые продолжения, созданные до фикса с пустым «Вид сырья»).
//
// Run with: node experiments/atex-production-planning-3795.test.js

process.env.TZ = 'UTC';

// Без global.document модуль не запускает init при require (window есть, document — нет).
global.window = { db: 'testdb', xsrf: 'x' };

var api = require('../download/atex/js/production-planning.js');
var Controller = api.Controller;

var passed = 0;
function assert(cond, name) {
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}

function meta(id, pairs) {
    return { id: String(id), reqs: pairs.map(function(p) { return { id: String(p[0]), val: p[1] }; }) };
}

// id таблиц/реквизитов для теста (числа произвольные, важны имена).
var MAT = '190';   // «Вид сырья» в «Задании в производство»
var LEN = '197';   // «Метраж, м»
var cutMeta = meta(100, [
    [MAT, 'Вид сырья'], [191, 'Слиттер'], [192, 'Партия сырья'], [193, 'Кол-во план'],
    [194, 'Статус'], [195, 'Очередность'], [196, 'Тип намотки'], [198, 'Лидер'],
    [LEN, 'Метраж, м'], [199, 'Длительность, минут']
]);
var fbMeta = meta(200, [[201, 'Ширина, мм'], [202, 'Кол-во полос'], [203, 'Кол-во рулонов'],
    [204, 'Кол-во план'], [205, 'В работе']]);
var supMeta = meta(300, [[301, 'Метраж, м'], [302, 'Кол-во рулонов'], [303, 'В работе'],
    [304, 'Статус'], [305, 'Партия ГП']]);

var root = { getAttribute: function() { return 'testdb'; } };
var c = new Controller(root);
c.meta.cut = cutMeta; c.meta.finishedBatch = fbMeta; c.meta.supply = supMeta;

// Голова цепочки H: «Вид сырья» = 'M7' (как грузится из cut_material_id). 8 рулонов обеспечения.
c.cuts = [{ id: 'H', length: 450, materialId: 'M7', status: 'В работе', slitter: { id: 'S1' },
    batchId: 'B1', winding: 'IN', leaders: [] }];
c.supplies = [{ id: 'SUP1', cutId: 'H', rolls: 8, footage: 450, finishedBatchId: 'FB1', positionId: 'P1' }];
c.footageBySupply = {};

// Стабы побочных эффектов.
var posts = [];
var idc = 0;
c.post = function(path, params) { posts.push({ path: path, params: params || {} }); return Promise.resolve({ obj: 'NEW' + (++idc) }); };
c.loadStripsForCut = function() { return Promise.resolve([]); };
c.resolveLeaderId = function() { return ''; };
c.reload = function() { return Promise.resolve(); };
c.persistCutSetupColumns = function() { return Promise.resolve(); };
c.setBusy = function() {}; c.showProgress = function() {}; c.updateProgress = function() {};
c.hideProgress = function() {}; c.render = function() {}; c.notify = function() {};

// План: голова H (5 проходов) обновляется, продолжение B (3 прохода) создаётся.
c.applySplitPlan({
    updates: [{ cutId: 'H', sequence: 1, planStartTs: 1000, plannedRuns: 5 }],
    creates: [{ parentCutId: 'H', sequence: 2, planStartTs: 2000, plannedRuns: 3 }],
    deletes: []
}).then(function() {
    var tMat = 't' + MAT;

    // 1) Создаваемое продолжение B (_m_new в таблицу резки) пишет «Вид сырья» = 'M7'.
    var createCut = posts.filter(function(p) { return p.path === '_m_new/100?JSON&up=1'; });
    assert(createCut.length === 1, '#3795: создаётся ровно одна запись-продолжение резки');
    assert(createCut[0] && String(createCut[0].params[tMat]) === 'M7',
        '#3795: продолжение получает «Вид сырья» = M7 (сырьё головы цепочки), а не пустоту');

    // 2) Обновляемая запись головы тоже несёт «Вид сырья» = 'M7' (лечит реюзнутые продолжения).
    var updCut = posts.filter(function(p) { return p.path === '_m_set/H?JSON'; });
    assert(updCut.length === 1 && String(updCut[0].params[tMat]) === 'M7',
        '#3795: обновление записи пишет «Вид сырья» = M7 (восстановление сырья реюзнутых продолжений)');

    console.log('\n' + passed + ' assertions passed');
}).catch(function(err) {
    console.log('FAIL — applySplitPlan бросил: ' + (err && err.stack || err));
    process.exitCode = 1;
});
