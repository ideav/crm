// Test for ideav/crm#3895 — applySplitPlan не должен валить ВСЮ пересборку из-за ОДНОЙ
// отсутствующей записи. Раньше единичная устаревшая ссылка (сервер: «No such record» при
// _m_set/_m_del) обрывала промис-цепочку на середине → план применялся ЧАСТИЧНО, planStart-ы
// оставались с коллизиями (#3885) и каскадили в Ганте, а «Упорядочить» показывал «Ошибка
// разбиения заданий: JSON: No such record» (и возвращал false → «Очередь уже оптимальна»).
//
// Теперь операции плана-разбиения глотают «No such record» (запись уже удалена — править/
// удалять нечего) и продолжают; остальные (валидные) записи применяются.
//
// Run with: node experiments/atex-production-planning-3895.test.js

process.env.TZ = 'UTC';
global.window = { db: 'testdb', xsrf: 'x' };
var api = require('../download/atex/js/production-planning.js');
var Controller = api.Controller;

var passed = 0;
function assert(cond, name) {
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) { passed++; } else { process.exitCode = 1; }
}
function meta(id, pairs) { return { id: String(id), reqs: pairs.map(function (p) { return { id: String(p[0]), val: p[1] }; }) }; }
var cutMeta = meta(100, [
    ['190', 'Вид сырья'], ['191', 'Слиттер'], ['192', 'Партия сырья'], ['193', 'Кол-во план'],
    ['194', 'Статус'], ['195', 'Очередность'], ['196', 'Тип намотки'], ['198', 'Лидер'],
    ['197', 'Метраж, м'], ['199', 'Длительность, минут'], ['188', 'ID первой части']
]);
var fbMeta = meta(200, [['201', 'Ширина, мм'], ['202', 'Кол-во полос'], ['203', 'Кол-во рулонов'], ['204', 'Кол-во план'], ['205', 'В работе']]);
var supMeta = meta(300, [['301', 'Метраж, м'], ['302', 'Кол-во рулонов'], ['303', 'В работе'], ['304', 'Статус'], ['305', 'Партия ГП']]);

function makeController(missingIds) {
    var root = { getAttribute: function () { return 'testdb'; } };
    var c = new Controller(root);
    c.meta.cut = cutMeta; c.meta.finishedBatch = fbMeta; c.meta.supply = supMeta;
    c.cuts = [
        { id: 'H', length: 450, materialId: 'M7', status: 'В работе', slitter: { id: 'S1' }, batchId: 'B1', winding: 'IN', leaders: [] },
        { id: 'H2', length: 300, materialId: 'M7', status: 'В работе', slitter: { id: 'S1' }, batchId: 'B1', winding: 'IN', leaders: [] }
    ];
    c.supplies = []; c.footageBySupply = {};
    c._posts = [];
    c.post = function (path, params) {
        c._posts.push(path);
        // Сервер отвечает «No such record» для операций над отсутствующими записями.
        var hit = (missingIds || []).some(function (id) { return path.indexOf('/' + id + '?') >= 0; });
        if (hit) return Promise.reject(new Error('JSON: No such record'));
        return Promise.resolve({ obj: 'NEW' });
    };
    c.loadStripsForCut = function () { return Promise.resolve([]); };
    c.resolveLeaderId = function () { return ''; };
    c.reload = function () { return Promise.resolve(); };
    c.persistCutSetupColumns = function () { return Promise.resolve(); };
    c.setBusy = function () {}; c.showProgress = function () {}; c.updateProgress = function () {};
    c.hideProgress = function () {}; c.render = function () {}; c.notify = function () {};
    return c;
}

// ── 1: удаление ОТСУТСТВУЮЩЕЙ записи не валит пересборку; валидный update применяется. ──
var c1 = makeController(['GONE']);
c1.applySplitPlan({
    updates: [{ cutId: 'H', sequence: 1, planStartTs: 1000, plannedRuns: 5 }],
    creates: [],
    deletes: ['GONE']   // запись уже удалена на сервере → «No such record»
}).then(function (ok) {
    assert(ok === true, '1: applySplitPlan НЕ падает из-за отсутствующей записи в deletes (вернул true)');
    assert(c1._posts.some(function (p) { return p.indexOf('_m_set/H?') >= 0; }),
        '1: валидный update (H) всё равно применился, несмотря на сбой удаления GONE');

    // ── 2: update ОТСУТСТВУЮЩЕЙ записи пропускается; СЛЕДУЮЩИЙ валидный update применяется. ──
    var c2 = makeController(['GONE']);
    return c2.applySplitPlan({
        updates: [
            { cutId: 'GONE', sequence: 1, planStartTs: 1000, plannedRuns: 5 },   // запись исчезла
            { cutId: 'H2', sequence: 2, planStartTs: 2000, plannedRuns: 3 }       // валидная
        ],
        creates: [], deletes: []
    }).then(function (ok2) {
        assert(ok2 === true, '2: applySplitPlan НЕ падает из-за отсутствующей записи в updates');
        assert(c2._posts.some(function (p) { return p.indexOf('_m_set/H2?') >= 0; }),
            '2: следующий валидный update (H2) применился после пропуска GONE');

        // ── 3: РЕАЛЬНАЯ (не «No such record») ошибка по-прежнему валит пересборку. ──
        var c3 = makeController([]);
        c3.post = function (path) { c3._posts.push(path); return Promise.reject(new Error('JSON: Server boom')); };
        return c3.applySplitPlan({ updates: [{ cutId: 'H', sequence: 1, planStartTs: 1000, plannedRuns: 5 }], creates: [], deletes: [] })
            .then(function (ok3) {
                assert(ok3 === false, '3: посторонняя ошибка (не «No such record») по-прежнему ловится (вернул false)');
                console.log('\n' + passed + ' assertions passed.');
            });
    });
}).catch(function (err) {
    console.log('FAIL — тест бросил: ' + (err && err.stack || err));
    process.exitCode = 1;
});
