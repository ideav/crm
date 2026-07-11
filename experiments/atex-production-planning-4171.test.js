// Regression for ideav/crm#4168 (корень) — продолжение дробления НЕ должно рождаться с ПУСТОЙ
// намоткой. Это корень сироты «нет связей» (#4163/#4168): applySplitPlan создаёт продолжение с
// winding = windingForCutId(parentId); если ГОЛОВА цепочки не резолвится (chainHeadById указал на
// резку не из self.cuts), было `normWinding(undefined)` = '' → пустая намотка рвёт
// continuationSignature → задание висит «нет связей».
//
// Фикс #4171: windingForCutId падает на намотку САМОЙ резки cutId, если голова вне self.cuts.
//
// Run with: node experiments/atex-production-planning-4171.test.js

process.env.TZ = 'UTC';
global.window = { db: 'testdb', xsrf: 'x' };
var Controller = require('../download/atex/js/production-planning.js').Controller;

var passed = 0, total = 0, pending = 0;
function assert(cond, name, extra) { total++; console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : '')); if (cond) passed++; else process.exitCode = 1; }
function meta(id, pairs) { return { id: String(id), reqs: pairs.map(function(p) { return { id: String(p[0]), val: p[1] }; }) }; }
var cutMeta = meta(100, [['190','Вид сырья'],['191','Слиттер'],['192','Партия сырья'],['193','Кол-во план'],['194','Статус'],['196','Тип намотки'],['198','Лидер'],['197','Метраж, м'],['199','Длительность, минут'],['200','Резка и Лидер'],['188','ID первой части'],['189','Зафиксировано']]);
var fbMeta  = meta(300, [['301','Ширина, мм'],['302','Кол-во полос'],['303','Кол-во рулонов'],['304','Кол-во план'],['305','В работе']]);
var supMeta = meta(400, [['401','Метраж, м'],['402','Кол-во рулонов'],['403','В работе'],['404','Статус'],['405','Партия ГП']]);
var WIND = 't196';
function baseController() {
    var root = { getAttribute: function() { return 'testdb'; } };
    var c = new Controller(root);
    c.meta.cut = cutMeta; c.meta.finishedBatch = fbMeta; c.meta.supply = supMeta;
    c.opTimes = { KNIFE: 30, MATERIAL_WINDING: 15, BETWEEN_CUTS: 1 }; c.changeTimes = { BETWEEN_CUTS: 1, KNIFE: 30, MATERIAL_WINDING: 15 };
    c.resolveLeaderId = function(l) { return l ? ('LID_' + l) : ''; };
    c.reload = function() { return Promise.resolve(); }; c.persistCutSetupColumns = function() { return Promise.resolve(); };
    c.removeCorruptedDaySplitOrphans = function() { return Promise.resolve(0); };   // изолируем от #4168-чистки
    c.setBusy = function() {}; c.showProgress = function() {}; c.hideProgress = function() {}; c.render = function() {}; c.updateProgress = function() {}; c.notify = function() {};
    c.footageBySupply = {};
    var posts = []; c.post = function(path, fields) { posts.push({ path: path, fields: fields || {} }); return Promise.resolve({ obj: 'NEW_' + posts.length }); }; c._posts = posts;
    return c;
}
function cut(id, extra) {
    var b = { id: id, length: 450, materialId: 'MW308', status: 'В работе', slitter: { id: 'S1' }, batchId: '74929',
              winding: 'OUT', leaders: ['MONO'], plannedRuns: 10, firstPartId: id, isFoil: false, knifeWidths: [154], knifeCount: 1 };
    return Object.assign(b, extra || {});
}
function contWindings(posts) {   // намотки, записанные при _m_new продолжения-резки (up=1)
    return posts.filter(function(p) { return /_m_new\/100\?JSON&up=1/.test(p.path); }).map(function(p) { return p.fields[WIND]; });
}
function done() { if (--pending === 0) console.log('\n' + passed + '/' + total + ' проверок пройдено.'); }

// ── 1) Обычный случай: голова H (OUT) резолвится → продолжение с OUT ──
(function() {
    pending++;
    var c = baseController();
    c.cuts = [ cut('H', { winding: 'OUT', firstPartId: 'H' }) ];
    c.supplies = [ { id: 'SUP_H', cutId: 'H', positionId: 'P1', finishedBatchId: 'FBH', rolls: 100, footage: 1000 } ];
    c.loadStripsForCut = function() { return Promise.resolve([{ id: 'FBH', width: 154, qty: 5, orderId: 'O1' }]); };
    var ops = { updates: [{ cutId: 'H', sequence: 1, planStartTs: 1751778540, plannedRuns: 6 }],
                creates: [{ parentCutId: 'H', sequence: 2, planStartTs: 1752040800, plannedRuns: 4 }], deletes: [] };
    c.applySplitPlan(ops).then(function() {
        var w = contWindings(c._posts);
        assert(w.length === 1 && w[0] === 'OUT', '#4171 обычная голова резолвится → продолжение с намоткой OUT', '(' + JSON.stringify(w) + ')');
    }).catch(function(e) { assert(false, '(1) threw', String(e && e.stack || e)); }).then(done);
})();

// ── 2) КОРЕНЬ: голова НЕ резолвится (firstPartId='GHOST' — цепочка указывает на резку вне self.cuts).
//       Без фикса продолжение получило бы ПУСТУЮ намотку (сирота). Фикс: берём намотку у самой H → OUT. ──
(function() {
    pending++;
    setTimeout(function() {
        var c = baseController();
        c.cuts = [ cut('H', { winding: 'OUT', firstPartId: 'GHOST' }) ];   // голова цепочки = GHOST, которой нет в self.cuts
        c.supplies = [ { id: 'SUP_H', cutId: 'H', positionId: 'P1', finishedBatchId: 'FBH', rolls: 100, footage: 1000 } ];
        c.loadStripsForCut = function() { return Promise.resolve([{ id: 'FBH', width: 154, qty: 5, orderId: 'O1' }]); };
        var ops = { updates: [{ cutId: 'H', sequence: 1, planStartTs: 1751778540, plannedRuns: 6 }],
                    creates: [{ parentCutId: 'H', sequence: 2, planStartTs: 1752040800, plannedRuns: 4 }], deletes: [] };
        c.applySplitPlan(ops).then(function() {
            var w = contWindings(c._posts);
            assert(w.length === 1 && w[0] === 'OUT', '#4171 КОРЕНЬ: голова вне self.cuts → намотка берётся у самой резки (OUT), НЕ пусто → не сирота', '(' + JSON.stringify(w) + ')');
        }).catch(function(e) { assert(false, '(2) threw', String(e && e.stack || e)); }).then(done);
    }, 120);
})();

// ── 3) autoSequenceQueue БЕЗ изменений (план оптимален) всё равно чистит сирот — иначе «Упорядочить»/
//       «Сгенерировать» на стабильном плане не убирает висящую «нет связей» (applySplitPlan не зовётся). ──
(function() {
    pending++;
    setTimeout(function() {
        var c = baseController();
        c.cuts = [ cut('H', { winding: 'OUT' }) ];
        c.supplies = [ { id: 'SUP_H', cutId: 'H', positionId: 'P1', finishedBatchId: 'FBH', rolls: 100, footage: 1000 } ];
        c.buildSequenceOps = function() { return { ops: { updates: [], creates: [], deletes: [] }, cutsById: {} }; };   // изменений нет
        var cleaned = 0, rendered = 0, splitCalls = 0;
        c.removeCorruptedDaySplitOrphans = function() { cleaned++; return Promise.resolve(1); };   // как будто убрали 1 сироту
        c.render = function() { rendered++; };
        c.applySplitPlan = function() { splitCalls++; return Promise.resolve(true); };
        c.autoSequenceQueue('SETUP', false).then(function(changed) {
            assert(cleaned === 1, '#4171 no-change autoSequenceQueue ВСЁ РАВНО зовёт чистку сирот', '(cleaned=' + cleaned + ')');
            assert(splitCalls === 0, '#4171 no-change: applySplitPlan НЕ зовётся (изменений нет)', '(split=' + splitCalls + ')');
            assert(changed === true, '#4171 убрана сирота → autoSequenceQueue вернул true');
            assert(rendered === 1, '#4171 после удаления сироты — render');
        }).catch(function(e) { assert(false, '(3) threw', String(e && e.stack || e)); }).then(done);
    }, 240);
})();
