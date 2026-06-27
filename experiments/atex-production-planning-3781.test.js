// Integration test for #3781 — записи-продолжения дробления по дням получают «Метраж, м»
// (длину прогона цепочки). Без него cutRunLength откатывался к ПОДЕЛЁННОМУ метражу
// обеспечения (splitSupplyShares делит footage пропорционально проходам) и в очереди
// мелькала заниженная длина: 281.25 = 450 × (10/16) вместо 450. Проявлялось редко — когда
// резка, изначально влезавшая в один день, при перепланировании начинала переполнять день.
//
// Гоняем НАСТОЯЩИЙ applySplitPlan поверх стаба post и проверяем, что:
//   • создаваемая запись-продолжение пишет «Метраж, м» = длине прогона головы (450);
//   • обновляемая запись (голова/реюзнутое продолжение) тоже получает «Метраж, м» (лечит старые).
//
// Run with: node experiments/atex-production-planning-3781.test.js

process.env.TZ = 'UTC';

// Без global.document модуль не запускает init при require (window есть, document — нет).
global.window = { db: 'testdb', xsrf: 'x' };

var api = require('../download/atex/js/production-planning.js');
var Controller = api.Controller;
var planning = api.planning;

var passed = 0;
function assert(cond, name) {
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}

function meta(id, pairs) {
    return { id: String(id), reqs: pairs.map(function(p) { return { id: String(p[0]), val: p[1] }; }) };
}

// id таблиц/реквизитов для теста (числа произвольные, важны имена).
var LEN = '197';   // «Метраж, м» в «Задании в производство»
var cutMeta = meta(100, [
    [191, 'Слиттер'], [192, 'Партия сырья'], [193, 'Кол-во план'], [194, 'Статус'],
    [195, 'Очередность'], [196, 'Тип намотки'], [198, 'Лидер'], [LEN, 'Метраж, м'],
    [199, 'Длительность, минут']
]);
var fbMeta = meta(200, [[201, 'Ширина, мм'], [202, 'Кол-во полос'], [203, 'Кол-во рулонов'],
    [204, 'Кол-во план'], [205, 'В работе']]);
var supMeta = meta(300, [[301, 'Метраж, м'], [302, 'Кол-во рулонов'], [303, 'В работе'],
    [304, 'Статус'], [305, 'Партия ГП']]);

var root = { getAttribute: function() { return 'testdb'; } };
var c = new Controller(root);
c.meta.cut = cutMeta; c.meta.finishedBatch = fbMeta; c.meta.supply = supMeta;

// Голова цепочки H: длина прогона (Метраж) = 450, 8 рулонов в обеспечении (метраж 450 = на рулон).
c.cuts = [{ id: 'H', length: 450, status: 'В работе', slitter: { id: 'S1' }, batchId: 'B1',
    winding: 'IN', leaders: [] }];
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
// splitSupplyShares(8, 450, [5,3]) → метраж обеспечения делится 281.25 / 168.75 — но длина
// прогона записей ДОЛЖНА остаться 450.
applySplitDone();
function applySplitDone() {
    c.applySplitPlan({
        updates: [{ cutId: 'H', sequence: 1, planStartTs: 1000, plannedRuns: 5 }],
        creates: [{ parentCutId: 'H', sequence: 2, planStartTs: 2000, plannedRuns: 3 }],
        deletes: []
    }).then(function() {
        var tLen = 't' + LEN;

        // 1) Создаваемое продолжение B (_m_new в таблицу резки) пишет «Метраж, м» = 450.
        var createCut = posts.filter(function(p) { return p.path === '_m_new/100?JSON&up=1'; });
        assert(createCut.length === 1, '#3781: создаётся ровно одна запись-продолжение резки');
        assert(createCut[0] && String(createCut[0].params[tLen]) === '450',
            '#3781: продолжение получает «Метраж, м» = 450 (длина прогона головы), а не делёный метраж');

        // 2) Обновляемая запись головы тоже несёт «Метраж, м» = 450 (лечит старые пустые длины).
        var updCut = posts.filter(function(p) { return p.path === '_m_set/H?JSON'; });
        assert(updCut.length === 1 && String(updCut[0].params[tLen]) === '450',
            '#3781: обновление записи пишет «Метраж, м» = 450 (восстановление длины)');

        // 3) Контроль арифметики: 281.25 — это делёный метраж обеспечения (450 × доля проходов),
        //    а НЕ длина прогона. Мы чиним длину РЕЗКИ; деление метража обеспечения не трогаем.
        assert(round3(450 * 5 / 8) === 281.25 && round3(450 * 10 / 16) === 281.25,
            '#3781: 281.25 = 450 × (доля проходов) — делёный метраж обеспечения, не длина прогона');

        console.log('\n' + passed + ' assertions passed');
    }).catch(function(err) {
        console.log('FAIL — applySplitPlan бросил: ' + (err && err.stack || err));
        process.exitCode = 1;
    });
}
function round3(n) { return Math.round(n * 1000) / 1000; }
