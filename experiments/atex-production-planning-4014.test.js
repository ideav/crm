// Test for ideav/crm#4014 — applySplitPlan («Сохранение плана резок…») распараллелен.
//
// Раньше update/create/delete применялись ОДНОЙ последовательной цепочкой (chain.then) — сотни
// зависимых запросов в один поток, сохранение плана тянулось минутами (сеть-лесенка на скрине
// #4014). Теперь три фазы гоняются пулом runWithConcurrency(…, 5) с БАРЬЕРАМИ между фазами
// (updates → creates → deletes), как генерация (#3998/#4004) и удаление (#4005/#4009).
//
// Проверяем на реальном applySplitPlan (mock post/loadStripsForCut с задержкой):
//   • БАРЬЕРЫ: все запросы фазы updates завершаются ДО первого запроса creates, все creates — ДО
//     первого delete (порядок фаз сохранён, как в прежней цепочке);
//   • ПАРАЛЛЕЛИЗМ внутри фазы ограничен пулом (5) и реально > 1;
//   • прогресс splitBump вызван по разу на задачу (updates + родители + deletes);
//   • applySplitPlan возвращает true (успех).
//
// Run with: node experiments/atex-production-planning-4014.test.js

process.env.TZ = 'UTC';
global.window = { db: 'testdb', xsrf: 'x' };
var Controller = require('../download/atex/js/production-planning.js').Controller;

var passed = 0, total = 0;
function assertEqual(actual, expected, name) {
    total++;
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; }
    else { console.log('  expected:', JSON.stringify(expected)); console.log('  actual:  ', JSON.stringify(actual)); process.exitCode = 1; }
}
function delay(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

function meta(id, pairs) { return { id: String(id), reqs: pairs.map(function(p) { return { id: String(p[0]), val: p[1] }; }) }; }
var cutMeta = meta(100, [
    ['190', 'Вид сырья'], ['191', 'Слиттер'], ['192', 'Партия сырья'], ['193', 'Кол-во план'],
    ['194', 'Статус'], ['195', 'Очередность'], ['196', 'Тип намотки'], ['198', 'Лидер'],
    ['197', 'Метраж, м'], ['199', 'Длительность, минут'], ['188', 'ID первой части']
]);
var fbMeta = meta(200, [['201', 'Ширина, мм'], ['202', 'Кол-во полос'], ['203', 'Кол-во рулонов'], ['204', 'Кол-во план'], ['205', 'В работе']]);
var supMeta = meta(300, [['301', 'Метраж, м'], ['302', 'Кол-во рулонов'], ['303', 'В работе'], ['304', 'Статус'], ['305', 'Партия ГП']]);

var N = 8;   // задач в каждой фазе (> лимита пула 5 → виден потолок параллелизма)
function id(prefix, i) { return prefix + i; }
function stdCut(cid) {
    return { id: cid, length: 450, materialId: 'M7', status: 'В работе', slitter: { id: 'S1' }, batchId: 'B1', winding: 'IN', leaders: [] };
}

function makeController() {
    var root = { getAttribute: function() { return 'testdb'; } };
    var c = new Controller(root);
    c.meta.cut = cutMeta; c.meta.finishedBatch = fbMeta; c.meta.supply = supMeta;
    var cuts = [];
    for (var i = 0; i < N; i++) { cuts.push(stdCut(id('U', i))); cuts.push(stdCut(id('P', i))); }
    c.cuts = cuts;
    c.supplies = []; c.footageBySupply = {};
    c.resolveLeaderId = function() { return ''; };
    c.reload = function() { return Promise.resolve(); };
    c.persistCutSetupColumns = function() { return Promise.resolve(); };
    c.setBusy = function() {}; c.showProgress = function() {}; c.hideProgress = function() {};
    c.render = function() {}; c.notify = function() {};

    var st = { t: 0, inflight: 0, maxInflight: { update: 0, create: 0, delete: 0 },
               firstStart: {}, lastEnd: {}, progress: 0 };
    function phaseOf(path) {
        if (/_m_del\//.test(path)) return 'delete';
        for (var i = 0; i < N; i++) { if (path.indexOf('/' + id('U', i) + '?') >= 0) return 'update'; }
        return 'create';   // _m_new/100, _m_save/NEW, loadStripsForCut(parent) и пр.
    }
    function start(phase) {
        st.t++; st.inflight++;
        if (st.inflight > st.maxInflight[phase]) st.maxInflight[phase] = st.inflight;
        if (st.firstStart[phase] == null) st.firstStart[phase] = st.t;
    }
    function end(phase) { st.t++; st.inflight--; st.lastEnd[phase] = st.t; }

    c.post = function(path) {
        var phase = phaseOf(path);
        start(phase);
        return delay(5).then(function() { end(phase); return { obj: 'NEW' }; });
    };
    c.loadStripsForCut = function() {
        start('create');
        return delay(5).then(function() { end('create'); return []; });
    };
    c.updateProgress = function() { st.progress++; };
    c._st = st;
    return c;
}

// ── ops: N updates, N родителей-creates (по 1 продолжению), N deletes ──
var ops = { updates: [], creates: [], deletes: [] };
for (var i = 0; i < N; i++) {
    ops.updates.push({ cutId: id('U', i), sequence: i + 1, planStartTs: 1000 + i, plannedRuns: 5 });
    ops.creates.push({ parentCutId: id('P', i), sequence: i + 1, planStartTs: 2000 + i, plannedRuns: 3, firstPartId: id('P', i) });
    ops.deletes.push(id('D', i));
}

var c = makeController();
c.applySplitPlan(ops).then(function(ok) {
    var st = c._st;
    assertEqual(ok, true, '#4014: applySplitPlan вернул true (успех)');

    // Барьеры между фазами: последний END фазы раньше первого START следующей.
    assertEqual(st.lastEnd.update < st.firstStart.create, true,
        '#4014 БАРЬЕР: все updates завершились ДО первого create');
    assertEqual(st.lastEnd.create < st.firstStart.delete, true,
        '#4014 БАРЬЕР: все creates завершились ДО первого delete');

    // Параллелизм внутри фазы — ровно пул (5) при N=8 задачах.
    assertEqual(st.maxInflight.update, 5, '#4014: updates идут пулом до 5 одновременно');
    assertEqual(st.maxInflight.create, 5, '#4014: creates идут пулом до 5 одновременно');
    assertEqual(st.maxInflight.delete, 5, '#4014: deletes идут пулом до 5 одновременно');

    // Прогресс: по одному splitBump на задачу (N updates + N родителей + N deletes).
    assertEqual(st.progress, 3 * N, '#4014: прогресс = число задач всех фаз (' + (3 * N) + ')');

    console.log('\n' + passed + '/' + total + ' проверок прошло');
    if (passed !== total) process.exitCode = 1;
}).catch(function(err) {
    console.log('FAIL — тест бросил: ' + (err && err.stack || err));
    process.exitCode = 1;
});
