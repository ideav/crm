// Regression for ideav/crm#4175 — «Ещё пустые заказы»: задание ВЫПУСКАЕТ заказ (его «Партия ГП»
// несёт «ID заказа», проходы дают спрос), но ПОСЛЕ дробления по дням у него нет ни одного
// «Обеспечения» → отчёт cut_planning (join через Обеспечение→позицию) отдаёт пустые
// order_id/order_no/cut_winding/срок, и задание висит «нет связей».
//
// КОРЕНЬ: day-split РЕЮЗит существующие резки цепочки как новые сегменты (update-путь НЕ создаёт
// Обеспечений), а свежесгенерированные покрывающие сегменты с Обеспечением удаляет → проходы
// уезжают на реюзнутую резку, Обеспечение остаётся на удалённой. Признак заказной сироты — по
// РЕАЛЬНОМУ «ID заказа» самой «Партии ГП» (order_id из отчёта тут пуст, как и намотка — целить в них
// было симптомом). ФИКС reconcileOrphanOrderSupplies: НЕ удаляем (резка — единственный выпуск
// заказа), а ВОССТАНАВЛИВАЕМ Обеспечение на позицию заказа (orderId+ширина Партии ГП из genPositions).
//
// Run with: node experiments/atex-production-planning-4175.test.js

process.env.TZ = 'UTC';
global.window = { db: 'testdb', xsrf: 'x' };
var Controller = require('../download/atex/js/production-planning.js').Controller;

var passed = 0, total = 0, pending = 0;
function assert(cond, name, extra) { total++; console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : '')); if (cond) passed++; else process.exitCode = 1; }
function done() { if (--pending === 0) console.log('\n' + passed + '/' + total + ' проверок пройдено.'); }

// Метаданные «Партии ГП»: r[] = [главное, Ширина, Кол-во полос, Кол-во рулонов, Кол-во план, ID заказа]
var fbMeta = { id: '1081', reqs: [
    { id: 'w',    val: 'Ширина, мм' },
    { id: 's',    val: 'Кол-во полос' },
    { id: 'roll', val: 'Кол-во рулонов' },
    { id: 'pl',   val: 'Кол-во план' },
    { id: 'ord',  val: 'ID заказа' }
] };
// В реальных метаданных reqs несут поле name; columnIndex → reqIdByName(meta,name). Дублируем name.
fbMeta.reqs.forEach(function(r) { r.name = r.val; });
var supMeta = { id: '1077', reqs: [
    { id: 'sfb',  name: 'Партия ГП' },
    { id: 'sr',   name: 'Кол-во рулонов' },
    { id: 'sf',   name: 'Метраж, м' },
    { id: 'sa',   name: 'В работе' },
    { id: 'sst',  name: 'Статус' }
] };

function fbRec(id, width, orderId, rolls) {
    // r индексируется [главное(0), Ширина(1), Кол-во полос(2), Кол-во рулонов(3), Кол-во план(4), ID заказа(5)]
    return { i: id, r: [null, String(width), '11', String(rolls), String(rolls), orderId] };
}

function ctrl(opts) {
    var c = new Controller({ getAttribute: function() { return 'testdb'; } });
    c.meta.finishedBatch = fbMeta;
    c.meta.supply = supMeta;
    c.cuts = opts.cuts;
    c.supplies = opts.supplies || [];
    c.genPositions = opts.genPositions || [];
    c._posts = [];
    c._errors = [];
    var realErr = console.error;
    c.getJson = function(url) {
        var m = /F_U=([^&]+)/.exec(url);
        var cid = m ? decodeURIComponent(m[1]) : '';
        return Promise.resolve((opts.fbByCut && opts.fbByCut[cid]) || []);
    };
    c.post = function(url, fields) { c._posts.push({ url: url, fields: fields }); return Promise.resolve({ obj: 'newsup' }); };
    c.reload = function() { return Promise.resolve(); };
    c.notify = function() {};
    c.loadPositions = function() { c._loadPositionsCalled = true; return Promise.resolve(); };
    return c;
}

// ── 1) Заказная сирота (реюз): проходы, без Обеспечения, «Партия ГП» с «ID заказа» → ВОССТАНОВЛЕНИЕ ──
(function() {
    pending++;
    var c = ctrl({
        cuts: [ { id: 'O', plannedRuns: 43, winding: '', materialId: 'MW411' } ],
        supplies: [],   // ← ни одного Обеспечения
        genPositions: [ { id: 'POS4059', orderId: '4059', width: 80, length: 100 } ],
        fbByCut: { 'O': [ fbRec('FB1', 80, '4059', 473) ] }
    });
    c.reconcileOrphanOrderSupplies().then(function(n) {
        assert(n === 1, '#4175 заказная сирота → восстановлена 1 связь', '(n=' + n + ')');
        assert(c._posts.length === 1, '#4175 создано ровно одно Обеспечение', '(posts=' + c._posts.length + ')');
        var p = c._posts[0] || {};
        assert(/_m_new\/1077\?JSON&up=POS4059/.test(p.url || ''), '#4175 Обеспечение создано на позицию заказа (up=POS4059)', '(url=' + (p.url || '') + ')');
        done();
    }).catch(function(e) { assert(false, '#4175 сирота — без исключения', String(e && e.stack || e)); done(); });
})();

// ── 2) Складская резка (проходы, без Обеспечения, «Партия ГП» БЕЗ «ID заказа») → НЕ трогаем ──
(function() {
    pending++;
    var c = ctrl({
        cuts: [ { id: 'STK', plannedRuns: 10, winding: 'OUT', materialId: 'MW308' } ],
        supplies: [],
        genPositions: [ { id: 'POS4059', orderId: '4059', width: 80, length: 100 } ],
        fbByCut: { 'STK': [ fbRec('FBs', 154, '', 5) ] }   // ← «ID заказа» пусто = запас
    });
    c.reconcileOrphanOrderSupplies().then(function(n) {
        assert(n === 0, '#4175 складская резка (Партия ГП без заказа) → 0 восстановлений', '(n=' + n + ')');
        assert(c._posts.length === 0, '#4175 складской резке Обеспечение НЕ создаём', '(posts=' + c._posts.length + ')');
        done();
    }).catch(function(e) { assert(false, '#4175 склад — без исключения', String(e && e.stack || e)); done(); });
})();

// ── 3) Привязанное задание (есть Обеспечение) → не кандидат, не читаем/не трогаем ──
(function() {
    pending++;
    var read = 0;
    var c = ctrl({
        cuts: [ { id: 'L', plannedRuns: 20, winding: 'OUT', materialId: 'MW411' } ],
        supplies: [ { id: 'sup1', cutId: 'L', positionId: 'POS4059', finishedBatchId: 'FBL' } ],
        genPositions: [ { id: 'POS4059', orderId: '4059', width: 80, length: 100 } ],
        fbByCut: { 'L': [ fbRec('FBL', 80, '4059', 220) ] }
    });
    var g = c.getJson; c.getJson = function(u) { read++; return g(u); };
    c.reconcileOrphanOrderSupplies().then(function(n) {
        assert(n === 0, '#4175 привязанное задание → 0 восстановлений', '(n=' + n + ')');
        assert(c._posts.length === 0, '#4175 привязанному Обеспечение не дублируем', '(posts=' + c._posts.length + ')');
        assert(read === 0, '#4175 привязанное задание даже не читаем (не кандидат)', '(reads=' + read + ')');
        done();
    }).catch(function(e) { assert(false, '#4175 привязанное — без исключения', String(e && e.stack || e)); done(); });
})();

// ── 4) Заказная сирота, но позиции нет в positions_list → НЕ создаём (loud), 0 восстановлений ──
(function() {
    pending++;
    var c = ctrl({
        cuts: [ { id: 'U', plannedRuns: 5, winding: '', materialId: 'MR192' } ],
        supplies: [],
        genPositions: [ { id: 'POS4059', orderId: '4059', width: 80, length: 100 } ],
        fbByCut: { 'U': [ fbRec('FBu', 999, 'ZZZ', 12) ] }   // ← заказ/ширина без позиции
    });
    // Не молча: тост про несопоставленную позицию (notify — на контроллере, без гонок за global console).
    var notes = [];
    c.notify = function(msg) { notes.push(String(msg)); };
    c.reconcileOrphanOrderSupplies().then(function(n) {
        var loud = notes.filter(function(m) { return /не нашёл позицию заказа/.test(m); }).length;
        assert(n === 0, '#4175 нет позиции заказа → 0 восстановлений (не фабрикуем связь)', '(n=' + n + ')');
        assert(c._posts.length === 0, '#4175 без позиции Обеспечение НЕ создаём', '(posts=' + c._posts.length + ')');
        assert(loud === 1, '#4175 несопоставленную сироту ОРЁМ пользователю (не молча)', '(loud=' + loud + ')');
        done();
    }).catch(function(e) { assert(false, '#4175 unmapped — без исключения', String(e && e.stack || e)); done(); });
})();

// ── 5) genPositions пусты → освежаем через loadPositions (не молчим о невозможности сопоставить) ──
(function() {
    pending++;
    var c = ctrl({
        cuts: [ { id: 'O2', plannedRuns: 32, winding: '', materialId: 'MR192' } ],
        supplies: [],
        genPositions: [],   // ← пусто на входе
        fbByCut: { 'O2': [ fbRec('FB2', 80, '3969', 352) ] }
    });
    c.reconcileOrphanOrderSupplies().then(function() {
        assert(c._loadPositionsCalled === true, '#4175 при пустых genPositions зовём loadPositions', '(called=' + c._loadPositionsCalled + ')');
        done();
    }).catch(function(e) { assert(false, '#4175 пустые позиции — без исключения', String(e && e.stack || e)); done(); });
})();
