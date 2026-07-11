// Regression for ideav/crm#4163 — задание-«сирота» дробления висит «нет связей», хотя его заказ
// полностью покрыт ДРУГОЙ цепочкой (рецидив после #4155/#4158/#4160).
//
// Диагноз по ЖИВЫМ данным ateh (заказ 3966: 100×154 + 20×110 = 20 проходов, покрыт цепочкой
// 484765→486694): рядом осталась резка 484659 — проходы>0, но ПУСТЫЕ «Тип намотки»/лидер/ролик,
// «Кол-во план» Партии ГП рассинхронено с проходами, и НЕТ ни одного «Обеспечения» (единственная
// из 114 резок без него). Обрезанная намотка рвёт continuationSignature (станок|сырьё|НАМОТКА|ножи),
// поэтому mergeContinuationChains не подхватывает её в цепочку и не удаляет как лишний сегмент.
//
// Фикс #4163: applySplitPlan удаляет такие повреждённые сироты — проходы>0 И пустая намотка И без
// «Обеспечения». Признак надёжный: у ЛЮБОЙ валидной резки (заказной и складской) намотка заполнена.
//
// Run with: node experiments/atex-production-planning-4163.test.js

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
var cutMeta = meta(100, [
    ['190', 'Вид сырья'], ['191', 'Слиттер'], ['192', 'Партия сырья'], ['193', 'Кол-во план'],
    ['194', 'Статус'], ['196', 'Тип намотки'], ['198', 'Лидер'], ['197', 'Метраж, м'],
    ['199', 'Длительность, минут'], ['200', 'Резка и Лидер'], ['188', 'ID первой части'], ['189', 'Зафиксировано']
]);
var fbMeta  = meta(300, [['301', 'Ширина, мм'], ['302', 'Кол-во полос'], ['303', 'Кол-во рулонов'], ['304', 'Кол-во план'], ['305', 'В работе']]);
var supMeta = meta(400, [['401', 'Метраж, м'], ['402', 'Кол-во рулонов'], ['403', 'В работе'], ['404', 'Статус'], ['405', 'Партия ГП']]);

function baseController() {
    var root = { getAttribute: function() { return 'testdb'; } };
    var c = new Controller(root);
    c.meta.cut = cutMeta; c.meta.finishedBatch = fbMeta; c.meta.supply = supMeta;
    c.opTimes = { WIND_100: 2, WIND_1000: 20, KNIFE: 30, MATERIAL_WINDING: 15, BETWEEN_CUTS: 1 };
    c.changeTimes = { BETWEEN_CUTS: 1, KNIFE: 30, MATERIAL_WINDING: 15 };
    c.resolveLeaderId = function(l) { return l ? ('LID_' + l) : ''; };
    c.reload = function() { return Promise.resolve(); };
    c.persistCutSetupColumns = function() { return Promise.resolve(); };
    c.setBusy = function() {}; c.showProgress = function() {}; c.hideProgress = function() {};
    c.render = function() {}; c.updateProgress = function() {};
    c._notes = []; c.notify = function(m, l) { c._notes.push({ m: m, l: l }); };
    c.footageBySupply = {};
    var posts = [];
    c.post = function(path, fields) { posts.push({ path: path, fields: fields || {} }); return Promise.resolve({ obj: 'NEW_' + posts.length }); };
    c._posts = posts;
    return c;
}
function pathsOf(posts, re) { return posts.filter(function(p) { return re.test(p.path); }); }
function cut(id, extra) {
    var base = { id: id, length: 450, materialId: 'MW308', status: 'В работе', slitter: { id: 'S1' },
                 batchId: '74929', winding: 'OUT', leaders: ['MONO'], plannedRuns: 5, firstPartId: id, isFoil: false,
                 knifeWidths: [154], knifeCount: 1 };
    return Object.assign(base, extra || {});
}
var HEAD_STRIPS = function() { return Promise.resolve([{ id: 'FBH', width: 154, qty: 5, orderId: 'O1' }]); };

// ── 1) Повреждённая сирота (проходы>0, ПУСТАЯ намотка, БЕЗ Обеспечения) удаляется; валидная — нет ──
(function() {
    pending++;
    var c = baseController();
    c.cuts = [ cut('H', { winding: 'OUT', plannedRuns: 5 }),
               cut('ORPH', { winding: '', plannedRuns: 4, firstPartId: 'ORPH', leaders: [] }) ];
    c.supplies = [ { id: 'SUP_H', cutId: 'H', positionId: 'P1', finishedBatchId: 'FBH', rolls: 100, footage: 1000 } ];   // ORPH без Обеспечения
    c.loadStripsForCut = HEAD_STRIPS;
    var ops = { updates: [ { cutId: 'H', sequence: 1, planStartTs: 1751778540, plannedRuns: 5 },
                           { cutId: 'ORPH', sequence: 2, planStartTs: 1751782140, plannedRuns: 4 } ],
                creates: [], deletes: [] };
    c.applySplitPlan(ops).then(function() {
        var delOrph = pathsOf(c._posts, /_m_del\/ORPH\?/);
        var delH = pathsOf(c._posts, /_m_del\/H\?/);
        assert(delOrph.length === 1, '#4163 повреждённая сирота (пустая намотка + без Обеспечения) УДАЛЕНА', '(_m_del/ORPH=' + delOrph.length + ')');
        assert(delH.length === 0, '#4163 валидная резка H НЕ удалена', '(_m_del/H=' + delH.length + ')');
        // #4168: чистка переехала в removeCorruptedDaySplitOrphans ПОСЛЕ reload (не в начале applySplitPlan) —
        // сироту рождает сама пересборка; здесь reload застаблен no-op, поэтому applySplitPlan её всё равно удаляет.
        assert(c._notes.some(function(n) { return n.l === 'error' && /сирот/.test(n.m); }), '#4163 НЕ молча: тост об удалении сирот');
    }).catch(function(e) { assert(false, '(1) threw', String(e && e.stack || e)); }).then(done);
})();

// ── 2) Контроль: пустая намотка, НО есть Обеспечение → НЕ удаляем (нужный сегмент, лечится намоткой цепочки) ──
(function() {
    pending++;
    setTimeout(function() {
        var c = baseController();
        c.cuts = [ cut('H', { winding: 'OUT', plannedRuns: 5 }),
                   cut('S', { winding: '', plannedRuns: 4, firstPartId: 'H' }) ];
        c.supplies = [ { id: 'SUP_H', cutId: 'H', positionId: 'P1', finishedBatchId: 'FBH', rolls: 60, footage: 600 },
                       { id: 'SUP_S', cutId: 'S', positionId: 'P1', finishedBatchId: 'FBS', rolls: 40, footage: 400 } ];   // S ИМЕЕТ Обеспечение
        c.loadStripsForCut = HEAD_STRIPS;
        var ops = { updates: [ { cutId: 'H', sequence: 1, planStartTs: 1751778540, plannedRuns: 5 },
                               { cutId: 'S', sequence: 2, planStartTs: 1751782140, plannedRuns: 4 } ], creates: [], deletes: [] };
        c.applySplitPlan(ops).then(function() {
            assert(pathsOf(c._posts, /_m_del\/S\?/).length === 0, '#4163 контроль: пустая намотка, НО с Обеспечением → НЕ удалена');
        }).catch(function(e) { assert(false, '(2) threw', String(e && e.stack || e)); }).then(done);
    }, 120);
})();

// ── 3) Контроль: БЕЗ Обеспечения, НО намотка заполнена (валидная складская резка) → НЕ удаляем ──
(function() {
    pending++;
    setTimeout(function() {
        var c = baseController();
        c.cuts = [ cut('H', { winding: 'OUT', plannedRuns: 5 }),
                   cut('STK', { winding: 'OUT', plannedRuns: 4, firstPartId: 'STK' }) ];   // склад: намотка есть, Обеспечения нет
        c.supplies = [ { id: 'SUP_H', cutId: 'H', positionId: 'P1', finishedBatchId: 'FBH', rolls: 100, footage: 1000 } ];
        c.loadStripsForCut = HEAD_STRIPS;
        var ops = { updates: [ { cutId: 'H', sequence: 1, planStartTs: 1751778540, plannedRuns: 5 },
                               { cutId: 'STK', sequence: 2, planStartTs: 1751782140, plannedRuns: 4 } ], creates: [], deletes: [] };
        c.applySplitPlan(ops).then(function() {
            assert(pathsOf(c._posts, /_m_del\/STK\?/).length === 0, '#4163 контроль: складская резка (намотка есть, без Обеспечения) → НЕ удалена');
        }).catch(function(e) { assert(false, '(3) threw', String(e && e.stack || e)); }).then(done);
    }, 240);
})();

function done() { if (--pending === 0) console.log('\n' + passed + '/' + total + ' проверок пройдено.'); }
