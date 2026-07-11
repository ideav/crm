// Regression for ideav/crm#4168 — «Какого хрена опять? Тот же заказ»: рецидив #4163 после PR#4165.
//
// #4163 добавил чистку сирот в НАЧАЛЕ applySplitPlan. Но по живым данным ateh: сироту (484659 → потом
// 488485, одна и та же сигнатура) РОЖДАЕТ САМА пересборка applySplitPlan — она появляется в self.cuts
// только ПОСЛЕ reload'а разбиения. Чистка в начале удаляла сироту ПРОШЛОГО прогона, а текущий прогон
// создавал новую → всегда ровно одна висит «нет связей» (484659 пропала, 488485 появилась).
//
// Фикс #4168: чистка переехала в removeCorruptedDaySplitOrphans(), которую applySplitPlan зовёт ПОСЛЕ
// своего reload — по СВЕЖИМ self.cuts, где сирота уже видна. Признак тот же (проходы>0 И пустая намотка
// И без Обеспечения), удаление каскадит Партии ГП.
//
// Run with: node experiments/atex-production-planning-4168.test.js

process.env.TZ = 'UTC';
global.window = { db: 'testdb', xsrf: 'x' };
var Controller = require('../download/atex/js/production-planning.js').Controller;

var passed = 0, total = 0, pending = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}
function meta(id, pairs) { return { id: String(id), reqs: pairs.map(function(p) { return { id: String(p[0]), val: p[1] }; }) }; }
var cutMeta = meta(100, [['190','Вид сырья'],['191','Слиттер'],['192','Партия сырья'],['193','Кол-во план'],['194','Статус'],['196','Тип намотки'],['198','Лидер'],['197','Метраж, м'],['199','Длительность, минут'],['200','Резка и Лидер'],['188','ID первой части'],['189','Зафиксировано']]);
var fbMeta  = meta(300, [['301','Ширина, мм'],['302','Кол-во полос'],['303','Кол-во рулонов'],['304','Кол-во план'],['305','В работе']]);
var supMeta = meta(400, [['401','Метраж, м'],['402','Кол-во рулонов'],['403','В работе'],['404','Статус'],['405','Партия ГП']]);
function baseController() {
    var root = { getAttribute: function() { return 'testdb'; } };
    var c = new Controller(root);
    c.meta.cut = cutMeta; c.meta.finishedBatch = fbMeta; c.meta.supply = supMeta;
    c.opTimes = { KNIFE: 30, MATERIAL_WINDING: 15, BETWEEN_CUTS: 1 }; c.changeTimes = { BETWEEN_CUTS: 1, KNIFE: 30, MATERIAL_WINDING: 15 };
    c.resolveLeaderId = function(l) { return l ? ('LID_' + l) : ''; };
    c.persistCutSetupColumns = function() { return Promise.resolve(); };
    c.setBusy = function() {}; c.showProgress = function() {}; c.hideProgress = function() {}; c.render = function() {}; c.updateProgress = function() {};
    c._notes = []; c.notify = function(m, l) { c._notes.push({ m: m, l: l }); };
    c.footageBySupply = {};
    var posts = []; c.post = function(path, fields) { posts.push({ path: path, fields: fields || {} }); return Promise.resolve({ obj: 'NEW_' + posts.length }); }; c._posts = posts;
    return c;
}
function pathsOf(posts, re) { return posts.filter(function(p) { return re.test(p.path); }); }
function cut(id, extra) {
    var b = { id: id, length: 450, materialId: 'MW308', status: 'В работе', slitter: { id: 'S1' }, batchId: '74929',
              winding: 'OUT', leaders: ['MONO'], plannedRuns: 5, firstPartId: id, isFoil: false, knifeWidths: [154], knifeCount: 1 };
    return Object.assign(b, extra || {});
}
function done() { if (--pending === 0) console.log('\n' + passed + '/' + total + ' проверок пройдено.'); }

// ── 1) removeCorruptedDaySplitOrphans: удаляет сироту, НЕ трогает валидные (заказ / склад) ──
(function() {
    pending++;
    var c = baseController();
    c.cuts = [ cut('H', { winding: 'OUT' }),
               cut('ORPH', { winding: '', plannedRuns: 4, leaders: [] }),   // сирота
               cut('STK', { winding: 'OUT', plannedRuns: 4 }) ];            // склад: намотка есть, Обеспечения нет
    c.supplies = [ { id: 'SUP_H', cutId: 'H', positionId: 'P1', finishedBatchId: 'FBH', rolls: 100, footage: 1000 } ];
    var reloads = 0; c.reload = function() { reloads++; return Promise.resolve(); };
    c.removeCorruptedDaySplitOrphans().then(function(n) {
        assert(n === 1, '#4168 удалена ровно 1 сирота', '(n=' + n + ')');
        assert(pathsOf(c._posts, /_m_del\/ORPH\?/).length === 1, '#4168 _m_del сироты (каскадит её Партии ГП)');
        assert(pathsOf(c._posts, /_m_del\/STK\?/).length === 0, '#4168 складская резка (намотка есть, без Обеспечения) НЕ удалена');
        assert(pathsOf(c._posts, /_m_del\/H\?/).length === 0, '#4168 заказная резка H НЕ удалена');
        assert(reloads === 1, '#4168 есть удаления → один reload (очередь без сироты)');
        assert(c._notes.some(function(nt) { return nt.l === 'error' && /сирот/.test(nt.m); }), '#4168 НЕ молча: тост');
    }).catch(function(e) { assert(false, '(1) threw', String(e && e.stack || e)); }).then(done);
})();

// ── 2) Контроль: сирот нет → метод ничего не пишет и НЕ грузит (0 удалений, 0 reload) ──
(function() {
    pending++;
    setTimeout(function() {
        var c = baseController();
        c.cuts = [ cut('H', { winding: 'OUT' }) ];
        c.supplies = [ { id: 'SUP_H', cutId: 'H', positionId: 'P1', finishedBatchId: 'FBH', rolls: 100, footage: 1000 } ];
        var reloads = 0; c.reload = function() { reloads++; return Promise.resolve(); };
        c.removeCorruptedDaySplitOrphans().then(function(n) {
            assert(n === 0 && c._posts.length === 0 && reloads === 0, '#4168 нет сирот → ни удалений, ни reload');
        }).catch(function(e) { assert(false, '(2) threw', String(e && e.stack || e)); }).then(done);
    }, 100);
})();

// ── 3) ТАЙМИНГ (суть #4168): сирота видна ТОЛЬКО ПОСЛЕ reload разбиения — applySplitPlan чистит её
//       в конце (пост-reload), а не в начале. Моделируем: 1-й reload (после записи) добавляет сироту,
//       2-й (после удаления сироты) — убирает. ──
(function() {
    pending++;
    setTimeout(function() {
        var c = baseController();
        c.cuts = [ cut('H', { winding: 'OUT' }) ];   // в начале сироты НЕТ (её родит пересборка)
        c.supplies = [ { id: 'SUP_H', cutId: 'H', positionId: 'P1', finishedBatchId: 'FBH', rolls: 100, footage: 1000 } ];
        c.loadStripsForCut = function() { return Promise.resolve([{ id: 'FBH', width: 154, qty: 5, orderId: 'O1' }]); };
        var reloads = 0;
        c.reload = function() {
            reloads++;
            if (reloads === 1) c.cuts = [ cut('H', { winding: 'OUT' }), cut('ORPH', { winding: '', plannedRuns: 4, leaders: [] }) ];  // после записи разбиения сирота появилась
            else c.cuts = [ cut('H', { winding: 'OUT' }) ];   // после удаления сироты — чисто
            return Promise.resolve();
        };
        var ops = { updates: [ { cutId: 'H', sequence: 1, planStartTs: 1751778540, plannedRuns: 5 } ], creates: [], deletes: [] };
        c.applySplitPlan(ops).then(function() {
            assert(pathsOf(c._posts, /_m_del\/ORPH\?/).length === 1, '#4168 сироту, рождённую пересборкой, ловит ПОСТ-reload чистка', '(было бы 0 при чистке в начале)');
            assert(c.cuts.length === 1 && String(c.cuts[0].id) === 'H', '#4168 после разбиения очередь без сироты');
        }).catch(function(e) { assert(false, '(3) threw', String(e && e.stack || e)); }).then(done);
    }, 200);
})();
