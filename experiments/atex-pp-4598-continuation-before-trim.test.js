// issue #4598: ГОЛОВУ НЕ УРЕЗАЕМ, ПОКА ЕЁ ПРОДОЛЖЕНИЕ НЕ СОЗДАНО.
//
// `applySplitPlan` пишет план тремя фазами с барьерами и НЕ атомарно: реальная ошибка реджектит
// пул ПЕРВОЙ ошибкой, а всё, что успела применить предыдущая фаза, остаётся в базе. Пока порядок
// был `updates → creates`, сбой на создании продолжения оставлял задание с проходами СЕГМЕНТА, а
// остаток не рождался никогда — работа исчезала молча, вместе с обеспечением заказа.
//
// Боевое (ateh, 04.08.2026): 5 заданий с урезанными проходами и ЦЕЛЫМ обеспечением, недобор по
// §15 — 581 шт. У 658253 (заказ 4512) «Кол-во резок план» = 1 при 6 в хранимом «Тайминге», а
// «Партия ГП» хранит исходные 210 = 35 полос × 6 проходов: голова урезана, а create-фаза (она же
// правит партии и обеспечение головы) не отработала.
//
// Порядок фаз — `creates → updates → deletes`. Тогда сбой оставляет ЛИШНЮЮ работу (задание целое,
// продолжение видно оператору), а не потерянную.
//
//   A — create упал: проходы головы НЕ переписаны (ни _m_set, ни _m_save по голове);
//   B — всё прошло: продолжение создано РАНЬШЕ, чем урезана голова;
//   C — сбой не проглочен: applySplitPlan сообщает об ошибке, а не рапортует успех.
//
// Run with: node experiments/atex-pp-4598-continuation-before-trim.test.js

process.env.TZ = 'Europe/Moscow';
global.window = { db: 'testdb', xsrf: 'x' };

var Controller = require('../download/atex/js/production-planning.js').Controller;

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

function meta(id, pairs) {
    return { id: String(id), reqs: pairs.map(function(p) { return { id: String(p[0]), val: p[1] }; }) };
}
var RUNS = '193';
var cutMeta = meta(100, [
    ['190', 'Вид сырья'], ['191', 'Слиттер'], ['192', 'Партия сырья'], [RUNS, 'Кол-во план'],
    ['194', 'Статус'], ['196', 'Тип намотки'], ['198', 'Лидер'], ['197', 'Метраж, м'],
    ['199', 'Длительность, минут'], ['189', 'ID первой части']
]);
var fbMeta = meta(200, [['201', 'Ширина, мм'], ['202', 'Кол-во полос'], ['203', 'Кол-во рулонов'],
    ['204', 'Кол-во план'], ['205', 'В работе']]);
var supMeta = meta(300, [['301', 'Метраж, м'], ['302', 'Кол-во рулонов'], ['303', 'В работе'],
    ['304', 'Статус'], ['305', 'Партия ГП']]);

var CREATE_CUT = '_m_new/100?JSON&up=1';

// Голова H: ХРАНИТСЯ 6 проходов. План рвёт её по дням: 1 остаётся, 5 уезжают продолжением.
function controller(opts) {
    var root = { getAttribute: function() { return 'testdb'; } };
    var c = new Controller(root);
    c.meta.cut = cutMeta; c.meta.finishedBatch = fbMeta; c.meta.supply = supMeta;
    c.cuts = [{ id: 'H', length: 300, materialId: 'M1', status: 'В работе', slitter: { id: 'S1' },
                batchId: 'B1', winding: 'OUT', leaders: [], firstPartId: 'H',
                plannedRuns: 6, number: 1000 }];
    c.supplies = [{ id: 'SUP1', cutId: 'H', rolls: 210, footage: 300, finishedBatchId: 'FB1', positionId: 'P1' }];
    c.footageBySupply = {};
    c.posts = [];
    var idc = 0;
    c.post = function(path, params) {
        c.posts.push({ path: path, params: params || {} });
        if (opts && opts.failCreateCut && path === CREATE_CUT) {
            return Promise.reject(new Error('Сервер отказал: нет прав на создание записи'));
        }
        return Promise.resolve({ obj: 'NEW' + (++idc) });
    };
    c.loadStripsForCut = function() { return Promise.resolve([]); };
    c.resolveLeaderId = function() { return ''; };
    c.reload = function() { return Promise.resolve(); };
    c.reconcileOrphanOrderSupplies = function() { return Promise.resolve(0); };
    c.persistCutSetupColumns = function() { return Promise.resolve(); };
    c.reconcilePlanStarts = function() { return Promise.resolve(); };
    c.reportPlanAudit = function() {}; c.reportOverfilledDays = function() {};
    c.setBusy = function() {}; c.showProgress = function() {}; c.updateProgress = function() {};
    c.hideProgress = function() {}; c.render = function() {};
    c.notices = [];
    c.notify = function(text, kind) { c.notices.push({ text: String(text), kind: kind }); };
    return c;
}

var OPS = {
    updates: [{ cutId: 'H', sequence: 1, planStartTs: 1000, plannedRuns: 1 }],
    creates: [{ parentCutId: 'H', sequence: 2, planStartTs: 90000, plannedRuns: 5 }],
    deletes: []
};
function ops() { return JSON.parse(JSON.stringify(OPS)); }
function headRunsWrites(c) {
    return c.posts.filter(function(p) {
        return p.path === '_m_set/H?JSON' && p.params['t' + RUNS] != null;
    });
}

// ── A/C: создание продолжения упало ──────────────────────────────────────────────────────────
var cFail = controller({ failCreateCut: true });
cFail.applySplitPlan(ops()).then(function(res) {
    assert(headRunsWrites(cFail).length === 0,
        '#4598-A: create упал — «Кол-во резок план» головы НЕ переписано',
        headRunsWrites(cFail).length ? ('записано ' + JSON.stringify(headRunsWrites(cFail)[0].params)) : '');
    assert(cFail.posts.filter(function(p) { return p.path === '_m_save/H?JSON'; }).length === 0,
        '#4598-A: create упал — время старта головы тоже не тронуто');
    assert(res === false && cFail.notices.some(function(n) { return n.kind === 'error'; }),
        '#4598-C: сбой назван ошибкой, а не тихим успехом',
        'notices=' + JSON.stringify(cFail.notices.map(function(n) { return n.kind; })));

    // ── B: нормальный ход — продолжение раньше урезания головы ───────────────────────────────
    var cOk = controller();
    return cOk.applySplitPlan(ops()).then(function() {
        var paths = cOk.posts.map(function(p) { return p.path; });
        var iCreate = paths.indexOf(CREATE_CUT);
        var trim = headRunsWrites(cOk)[0];
        var iTrim = trim ? cOk.posts.indexOf(trim) : -1;
        assert(iCreate >= 0, '#4598-B: продолжение создано');
        assert(iTrim >= 0 && String(trim.params['t' + RUNS]) === '1',
            '#4598-B: голова урезана до проходов сегмента (1)');
        assert(iCreate < iTrim,
            '#4598-B: продолжение создаётся РАНЬШЕ, чем урезается голова',
            'create@' + iCreate + ' trim@' + iTrim);
    });
}).then(function() {
    console.log('\n' + passed + '/' + total + ' passed');
}).catch(function(err) {
    process.exitCode = 1;
    console.log('FAIL — тест бросил: ' + (err && err.stack || err));
});
