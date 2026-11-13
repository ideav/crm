// ideav/crm#5504 — окно прогресса длительных операций рабочих мест Фазы 2.
//
// Импорт из 1С при сверке читает позиции каждого заказа файла (сотни запросов), а пользователь
// видел только спиннер в строке таблицы и сразу результат. Правило: операция, которая шлёт
// много запросов, открывает модальное окно прогресса (js/atex-progress.js) со счётчиком
// «N из M» и закрывает его по окончании — и при успехе, и при ошибке.
//
//   P1  модуль окна: оверлей в body, счётчик, полоса, «бегущая» полоса без total, close убирает;
//   P2  сверка заказов: окно открыто, этап «позиции заказов» со счётчиком = числу заказов файла;
//   P3  запись: одно окно на запись и повторную сверку, счётчик операций, закрыто после;
//   P4  ошибка чтения — окно всё равно закрыто;
//   P5  run(steps) планирования высечки и мастер-рулонов: счётчик шагов.
//
// Run with: node experiments/atex-p2-5504-progress-modal.test.js

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

var PG = null;
try { PG = require('../download/atex-p2/js/atex-progress.js'); } catch (e) { PG = null; }

// ── Мини-DOM ─────────────────────────────────────────────────────────────────────────────────
function fakeDoc() {
    function El(tag) { this.tagName = tag; this.children = []; this.parentNode = null; this.className = ''; this.textContent = ''; this.style = {}; this.attrs = {}; }
    El.prototype.appendChild = function(c) { c.parentNode = this; this.children.push(c); return c; };
    El.prototype.removeChild = function(c) { this.children = this.children.filter(function(x) { return x !== c; }); c.parentNode = null; return c; };
    El.prototype.setAttribute = function(k, v) { this.attrs[k] = String(v); };
    var body = new El('body');
    return { body: body, createElement: function(t) { return new El(t); } };
}

// ── Запись вызовов окна ──────────────────────────────────────────────────────────────────────
function recorder() {
    var log = { opened: 0, closed: 0, steps: [], open: false };
    var ui = {
        open: function(title, opts) {
            log.opened++; log.open = true;
            var p = { title: title, total: (opts && opts.total) || 0, done: 0, detail: '' };
            log.steps.push(p.cur = { title: title, total: p.total, maxDone: 0 });
            p.step = function(t, n, d) { p.done = 0; log.steps.push(p.cur = { title: t, total: Number(n) || 0, maxDone: 0 }); return p; };
            p.set = function(n, d) { p.done = n; p.cur.maxDone = Math.max(p.cur.maxDone, n); return p; };
            p.tick = function(d) { return p.set(p.done + 1, d); };
            p.track = function(pr) { return Promise.resolve(pr).then(function(v) { p.tick(); return v; }, function(e) { p.tick(); throw e; }); };
            p.close = function() { if (log.open) { log.closed++; log.open = false; } };
            return p;
        }
    };
    return { ui: ui, log: log };
}

(async function main() {
    // ── P1. Модуль окна ──────────────────────────────────────────────────────────────────────
    assert(!!PG && typeof PG.open === 'function', 'P1 модуль download/atex-p2/js/atex-progress.js есть и отдаёт open()');
    if (PG) {
        var doc = fakeDoc(), t = 0;
        var p = PG.open('Сверка с базой', { document: doc, total: 200, timer: false, now: function() { return t; } });
        assert(doc.body.children.length === 1, 'P1 окно — оверлей в body');
        var ov = doc.body.children[0], box = ov.children[0];
        var texts = function() { return box.children.map(function(c) { return c.textContent; }); };
        assert(ov.attrs['aria-modal'] === 'true', 'P1 окно модальное (aria-modal)');
        assert(texts()[0] === 'Сверка с базой', 'P1 заголовок этапа');
        t = 12000; p.set(37, 'Заказ 12345');
        assert(texts()[2] === '37 из 200 · 12 с', 'P1 счётчик «N из M · сек»', JSON.stringify(texts()[2]));
        assert(texts()[3] === 'Заказ 12345', 'P1 строка «что делается»');
        assert(box.children[1].children[0].style.width === '19%', 'P1 полоса = доля', box.children[1].children[0].style.width);
        p.step('Сверяю файл с базой', 0);
        assert(/is-indeterminate/.test(box.children[1].className), 'P1 без total полоса «бегущая»');
        assert(texts()[2] === '12 с', 'P1 без total — только секунды', JSON.stringify(texts()[2]));
        p.close();
        assert(doc.body.children.length === 0, 'P1 close убирает окно');
        var mute = PG.open('x', {});
        assert(typeof mute.tick === 'function' && typeof mute.close === 'function', 'P1 без document — немое окно с тем же API');
    }

    // ── P2–P4. Импорт из 1С ─────────────────────────────────────────────────────────────────
    var LI = require('../download/atex-p2/js/label-import-core.js');
    var APP = require('../download/atex-p2/js/label-import.js');
    var origCtx = LI.orderContext, origPlan = LI.planOrders;
    LI.orderContext = function(tables, data) { return data; };
    LI.planOrders = function(parsed, ctx) { return { ops: [], counts: { new: 0, update: 0, same: 0, duplicate: 0, error: 0, warnings: 0, ordersNew: 0 }, rows: [], ctx: ctx }; };

    function makeApp(opts) {
        var o = opts || {};
        var app = new APP.AtexLabelImport({ getAttribute: function(k) { return k === 'data-db' ? 'ateh1' : ''; } });
        app.render = function() {};
        app.message = function() {};
        app.checkTables = function() {};
        app.tables = { order: { id: '1' }, position: { id: '2' }, client: { id: '3' }, article: { id: '4' }, productKind: { id: '5' } };
        var rec = recorder();
        app.progressUi = rec.ui;
        var N = o.orders || 200, inFlight = 0, maxInFlight = 0;
        app.objects = function(key) {
            if (o.fail && key === 'position') return Promise.reject(new Error('HTTP 500'));
            inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
            return new Promise(function(resolve) {
                setTimeout(function() {
                    inFlight--;
                    if (key === 'order') resolve(Array.from({ length: N }, function(_, i) { return { id: String(1000 + i), val: 'З-' + i, reqs: {} }; }));
                    else resolve([]);
                }, 1);
            });
        };
        app.parsed.orders = { items: Array.from({ length: N }, function(_, i) { return { order: 'З-' + i }; }) };
        return { app: app, log: rec.log, maxInFlight: function() { return maxInFlight; } };
    }

    var a = makeApp({ orders: 200 });
    await a.app.replan('orders');
    var posStep = a.log.steps.filter(function(s) { return s.total === 200; })[0];
    assert(a.log.opened === 1, 'P2 сверка заказов открывает окно прогресса', 'opened=' + a.log.opened);
    assert(!!posStep, 'P2 этап со счётчиком на 200 заказов файла', JSON.stringify(a.log.steps.map(function(s) { return [s.title, s.total]; })));
    assert(posStep && posStep.maxDone === 200, 'P2 счётчик позиций дошёл до 200', posStep && String(posStep.maxDone));
    assert(a.log.closed === 1 && !a.log.open, 'P2 после сверки окно закрыто');
    assert(a.maxInFlight() <= 10, 'P2 пул не раздут ради прогресса (≤ 10 одновременных чтений справочников)', String(a.maxInFlight()));

    // P3 — запись: одно окно на «запись + повторная сверка»
    var w = makeApp({ orders: 3 });
    w.app.confirm = function() { return Promise.resolve(true); };
    w.app.progress = function() {};
    w.app.sendBatch = function(ops) { return Promise.resolve({ results: ops.map(function(_, n) { return { n: n, ok: true, id: 1 }; }) }); };
    var ops = Array.from({ length: 1200 }, function(_, i) { return { op: 'set', id: String(i), fields: { 1: 'x' } }; });
    w.app.plan.orders = { ops: ops, counts: { new: 0, update: 1200, same: 0, duplicate: 0, error: 0, ordersNew: 0 }, rows: [] };
    await w.app.write();
    var opStep = w.log.steps.filter(function(s) { return s.total === 1200; })[0];
    assert(w.log.opened === 1, 'P3 запись и повторная сверка — в одном окне', 'opened=' + w.log.opened);
    assert(opStep && opStep.maxDone === 1200, 'P3 счётчик операций записи дошёл до 1200', opStep && String(opStep.maxDone));
    assert(w.log.steps.some(function(s) { return s.total === 3; }), 'P3 повторная сверка тоже идёт со счётчиком');
    assert(w.log.closed === 1 && !w.log.open, 'P3 после записи окно закрыто');
    assert(w.app.busy === false, 'P3 busy снят');

    // P4 — ошибка: окно закрыто
    var f = makeApp({ orders: 5, fail: true });
    var threw = false;
    try { await f.app.replan('orders'); } catch (e) { threw = true; }
    assert(threw, 'P4 ошибка чтения поднимается к вызывающему');
    assert(f.log.opened === 1 && f.log.closed === 1 && !f.log.open, 'P4 после ошибки окно закрыто');

    LI.orderContext = origCtx; LI.planOrders = origPlan;

    // ── P5. run(steps) планирования высечки и мастер-рулонов ─────────────────────────────────
    var RUNNERS = [
        ['die-planning', require('../download/atex-p2/js/die-planning.js').AtexDiePlanningApp, 'atex-dp-modal-ok'],
        ['master-rolls', require('../download/atex-p2/js/master-rolls.js').AtexMasterRollsApp, 'atex-mr-modal-ok']
    ];
    for (var ri = 0; ri < RUNNERS.length; ri++) {
        var name = RUNNERS[ri][0], Ctor = RUNNERS[ri][1];
        for (var failAt = -1; failAt <= 2; failAt += 3) {
            var rec5 = recorder(), reloaded = false, errText = '';
            var app5 = Object.create(Ctor.prototype);
            app5.progressUi = rec5.ui;
            app5.busy = false;
            app5.$ = function() { return { disabled: false, textContent: '' }; };
            app5.closeModal = function() {};
            app5.modalError = function(t) { errText = t; };
            app5.reload = function() { return new Promise(function(r) { setTimeout(function() { reloaded = true; r(); }, 2); }); };
            var steps = [0, 1, 2, 3].map(function(i) {
                return function() { return i === failAt ? Promise.reject(new Error('HTTP 500')) : Promise.resolve(); };
            });
            app5.run(steps, 'готово');
            await new Promise(function(r) { setTimeout(r, 30); });
            var st = rec5.log.steps.filter(function(s) { return s.total === 4; })[0];
            var tag = name + (failAt < 0 ? '' : ' (ошибка на шаге 3)');
            assert(rec5.log.opened === 1, 'P5 ' + tag + ': run открывает окно прогресса');
            assert(st && st.maxDone === (failAt < 0 ? 4 : 2), 'P5 ' + tag + ': счётчик шагов ' + (failAt < 0 ? '4 из 4' : '2 из 4'), st && String(st.maxDone));
            assert(rec5.log.closed === 1 && !rec5.log.open, 'P5 ' + tag + ': окно закрыто' + (failAt < 0 ? ' после перечитывания' : ''));
            if (failAt < 0) assert(reloaded, 'P5 ' + tag + ': данные перечитаны');
        }
    }

    // ── P6. «Записать подбор во все» в «Заказах этикетки» ───────────────────────────────────
    var LO = require('../download/atex-p2/js/label-orders.js');
    var rec6 = recorder(), posted = 0, reloaded6 = false;
    var lo = Object.create(LO.AtexLabelOrders.prototype);
    lo.progressUi = rec6.ui;
    lo.rows = Array.from({ length: 30 }, function(_, i) { return { id: String(500 + i), orderNo: 'З-' + i, dieId: '' }; });
    lo.planOf = function() { return { write: { die: '77' } }; };
    lo.fieldsOf = function(w) { return w; };
    lo.confirm = function() { return Promise.resolve(true); };
    lo.message = function() {};
    lo.post = function() { posted++; return posted === 7 ? Promise.reject(new Error('HTTP 500')) : Promise.resolve({}); };
    lo.reload = function() { return new Promise(function(r) { setTimeout(function() { reloaded6 = true; r(); }, 2); }); };
    await lo.pickAll();
    var st6 = rec6.log.steps.filter(function(s) { return s.total === 30; })[0];
    assert(rec6.log.opened === 1, 'P6 запись подбора открывает окно прогресса');
    assert(st6 && st6.maxDone === 30, 'P6 счётчик позиций 30 из 30 (ошибка одной позиции счёт не рвёт)', st6 && String(st6.maxDone));
    assert(reloaded6 && rec6.log.closed === 1 && !rec6.log.open, 'P6 окно закрыто после перечитывания');
    assert(lo.busy === false, 'P6 busy снят');

    console.log('\n' + passed + '/' + total + ' passed');
})().catch(function(e) { console.error(e); process.exitCode = 1; });
