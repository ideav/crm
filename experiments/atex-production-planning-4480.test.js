// Тесты для ideav/crm#4480 — по трейсу переноса: последовательный ХВОСТ записи.
//
// Что показал лог из #4480 (перенос задания с 1 станка на 3, 34 записи):
//   фаза updates (applySplitPlan)         22 запроса, пик 5   ✔
//   фаза creates (разбиение одной цепочки)  6 запросов, пик 1  ✘ — строго по одному
//   фаза reconcileOrphanOrderSupplies      7 запросов, пик 5   ✔
// Пул `runWithConcurrency` гоняет РОДИТЕЛЬСКИЕ цепочки, а внутри цепочки всё шло цепочкой
// `chain.then`. Когда разбивается ОДНО задание (обычный случай переноса), родитель ровно один —
// и вся фаза вырождается в лесенку: `_m_set` Обеспечения A → `_m_set` Партии ГП A → `_m_new`
// продолжения → `_m_save` → `_m_new` Партии ГП → `_m_new` Обеспечения.
//
// Зависимость внутри цепочки ровно одна: id продолжения возвращает `_m_new`, поэтому его дети
// ждут ответа. Всё остальное — разные записи, и они обязаны идти пулом (правило ТЗ §15, #4477).
//
//   A — фаза creates ОДНОЙ цепочки идёт параллельно (пик > 1; на origin/main пик = 1);
//   B — потолок соблюдается ГЛОБАЛЬНО: вложенные пулы (цепочки × сегменты × дети) суммарно не
//       дают больше 5 одновременных запросов — за это отвечает семафор в post();
//   C — порядок ступеней удаления сохранён (обеспечения → партии ГП → резка), но внутри
//       ступени записи идут пулом;
//   D — трасса #4177 называет АВТОРА записи: `_ppOp` ставится каждой операцией оператора.
//       В логе #4480 перетаскивание было подписано `[reconcileOrphanOrderSupplies]` — ярлык
//       остался от предыдущей операции и вводил в заблуждение при разборе.
//
// Run with: node experiments/atex-production-planning-4480.test.js

process.env.TZ = 'UTC';
global.window = { db: 'testdb', xsrf: 'x' };
var Controller = require('../download/atex/js/production-planning.js').Controller;

var passed = 0, total = 0;
function assert(cond, name) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}
function delay(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

function meta(id, pairs) { return { id: String(id), reqs: pairs.map(function(p) { return { id: String(p[0]), val: p[1] }; }) }; }
var cutMeta = meta(100, [
    ['190', 'Вид сырья'], ['191', 'Слиттер'], ['192', 'Партия сырья'], ['193', 'Кол-во план'],
    ['194', 'Статус'], ['196', 'Тип намотки'], ['198', 'Лидер'],
    ['197', 'Метраж, м'], ['199', 'Длительность, минут'], ['188', 'ID первой части']
]);
var fbMeta = meta(200, [['201', 'Ширина, мм'], ['202', 'Кол-во полос'], ['203', 'Кол-во рулонов'], ['204', 'Кол-во план'], ['205', 'В работе']]);
var supMeta = meta(300, [['301', 'Метраж, м'], ['302', 'Кол-во рулонов'], ['303', 'В работе'], ['304', 'Статус'], ['305', 'Партия ГП']]);

var STRIPS = 4, SUPPLIES = 4, SEGMENTS = 2;   // одна цепочка: 4 полосы, 4 обеспечения, 2 продолжения

// Одна родительская цепочка (как в трейсе #4480) + одна удаляемая резка со своими детьми.
function makeController() {
    var root = { getAttribute: function() { return 'testdb'; } };
    var c = new Controller(root);
    c.meta.cut = cutMeta; c.meta.finishedBatch = fbMeta; c.meta.supply = supMeta;
    c.cuts = [{ id: 'P', length: 450, materialId: 'M7', status: 'В работе', slitter: { id: 'S1' }, batchId: 'B1', winding: 'IN', leaders: [] },
              { id: 'D', length: 450, materialId: 'M7', status: 'В работе', slitter: { id: 'S1' }, batchId: 'B1', winding: 'IN', leaders: [] }];
    var supplies = [];
    for (var i = 0; i < SUPPLIES; i++) {
        supplies.push({ id: 'SUP' + i, cutId: 'P', finishedBatchId: 'FB' + i, positionId: 'POS' + i, rolls: 20, footage: 400 });
        supplies.push({ id: 'DSUP' + i, cutId: 'D', finishedBatchId: 'DFB' + i, positionId: 'POS' + i, rolls: 5, footage: 100 });
    }
    c.supplies = supplies; c.footageBySupply = {};
    c.resolveLeaderId = function() { return ''; };
    c.reload = function() { return Promise.resolve(); };
    c.persistCutSetupColumns = function() { return Promise.resolve(); };
    c.setBusy = function() {}; c.showProgress = function() {}; c.hideProgress = function() {};
    c.updateProgress = function() {}; c.render = function() {}; c.notify = function() {};

    var st = { inflight: 0, maxGlobal: 0, maxByPhase: {}, order: [] };
    function phaseOf(path) {
        if (/_m_del\//.test(path)) return 'delete';
        if (path.indexOf('/U?') >= 0) return 'update';
        return 'create';
    }
    function track(phase, tag) {
        st.inflight++;
        if (st.inflight > st.maxGlobal) st.maxGlobal = st.inflight;
        if (!(st.maxByPhase[phase] >= st.inflight)) st.maxByPhase[phase] = st.inflight;
        st.order.push(tag);
        return delay(5).then(function() { st.inflight--; });
    }
    c.post = function(path) {
        return track(phaseOf(path), path.split('?')[0]).then(function() { return { obj: 'NEW' + (st.order.length) }; });
    };
    c.loadStripsForCut = function() {
        return track('create', 'strips').then(function() {
            var out = [];
            for (var i = 0; i < STRIPS; i++) out.push({ id: 'FB' + i, width: 100 + i, qty: 3, orderId: 'ORD' });
            return out;
        });
    };
    c._st = st;
    return c;
}

var ops = {
    updates: [{ cutId: 'U', planStartTs: 1000, plannedRuns: 5 }],
    creates: [], deletes: ['D']
};
for (var s = 0; s < SEGMENTS; s++) {
    ops.creates.push({ parentCutId: 'P', planStartTs: 2000 + s, plannedRuns: 3, firstPartId: 'P' });
}

var c = makeController();
c.applySplitPlan(ops).then(function(ok) {
    var st = c._st;
    assert(ok === true, '#4480: applySplitPlan вернул true (успех)');

    // ── A: фаза creates ОДНОЙ цепочки идёт параллельно ──
    assert(st.maxByPhase.create > 1,
        '#4480-A: записи одной цепочки разбиения идут параллельно (пик ' + st.maxByPhase.create + ', на origin/main был 1)');

    // Вложенные пулы (цепочки × сегменты × дети) СУММАРНО просят больше пяти — здесь post
    // замокан, поэтому виден чистый планировщик. Потолок держит не он, а семафор в post(): его
    // проверяет отдельная часть B ниже, на настоящем post() с моком fetch.
    assert(st.maxGlobal > 5,
        '#4480-A: планировщик пулов сам по себе просит больше 5 (пик ' + st.maxGlobal + ') — потолок обязан быть в post()');

    // ── C: ступени удаления сохраняют порядок обеспечения → партии ГП → резка ──
    var dels = st.order.filter(function(p) { return p.indexOf('_m_del/') === 0; })
        .map(function(p) { return p.replace('_m_del/', ''); });
    var lastSupply = -1, firstFb = 1e9, lastFb = -1, cutAt = -1;
    dels.forEach(function(idv, i) {
        if (idv.indexOf('DSUP') === 0) lastSupply = i;
        else if (idv.indexOf('DFB') === 0) { if (i < firstFb) firstFb = i; lastFb = i; }
        else if (idv === 'D') cutAt = i;
    });
    assert(lastSupply < firstFb && lastFb < cutAt,
        '#4480-C: порядок удаления сохранён — обеспечения, затем партии ГП, затем сама резка');
    assert(st.maxByPhase.delete > 1,
        '#4480-C: внутри ступени удаления записи идут пулом (пик ' + st.maxByPhase.delete + ')');

    // ── B: потолок в самом post() ──
    return runWriteCeiling();
}).then(function() {
    // ── D: трасса называет автора записи ──
    return runOpLabel();
}).then(function() {
    console.log('\n' + passed + '/' + total + ' проверок пройдено');
    if (passed !== total) process.exitCode = 1;
}).catch(function(err) {
    console.log('FAIL — тест бросил: ' + (err && err.stack || err));
    process.exitCode = 1;
});

// #4480-B: ПОТОЛОК держит семафор в самом post() — единственной точке, через которую идут все
// команды `_m_*`. Проверяем на НАСТОЯЩЕМ post() (мок на уровне fetch): запускаем два независимых
// пула по 5 задач каждый — планировщики про друг друга не знают и вместе просят 10, а в сеть
// уходит не больше MAX_PARALLEL_WRITES.
function runWriteCeiling() {
    var planning = require('../download/atex/js/production-planning.js').planning;
    var inflight = 0, max = 0, sent = 0;
    global.fetch = function() {
        inflight++; sent++;
        if (inflight > max) max = inflight;
        return delay(5).then(function() {
            inflight--;
            return { ok: true, status: 200, text: function() { return Promise.resolve('{"obj":"1"}'); } };
        });
    };
    var root = { getAttribute: function() { return 'testdb'; } };
    var c = new Controller(root);
    c.url = function(p) { return '/testdb/' + p; };
    function pool(prefix) {
        var tasks = [];
        for (var i = 0; i < 5; i++) (function(i) {
            tasks.push(function() { return c.post('_m_set/' + prefix + i + '?JSON', { t1: '1' }); });
        })(i);
        return planning.runWithConcurrency(tasks, 5);
    }
    return Promise.all([pool('X'), pool('Y')]).then(function() {
        assert(sent === 10, '#4480-B: отправлены все 10 запросов (сейчас ' + sent + ')');
        assert(max <= planning.MAX_PARALLEL_WRITES,
            '#4480-B: два пула по 5 суммарно не превышают потолок ' + planning.MAX_PARALLEL_WRITES + ' (пик ' + max + ')');
        assert(max === planning.MAX_PARALLEL_WRITES,
            '#4480-B: потолок при этом ВЫБИРАЕТСЯ полностью — не сериализация (пик ' + max + ')');
    });
}

// #4480-D: каждая операция оператора подписывает записи собой (_ppOp), а не ярлыком прошлой.
function runOpLabel() {
    var seenOp = null;
    var day = [{ id: 'A', slitter: { id: '1' }, planDate: 1785132000, status: '' },
               { id: 'B', slitter: { id: '1' }, planDate: 1785135600, status: '' }];
    var self = {
        busy: false, cuts: day.slice(), meta: { cut: { id: '1078', reqs: [] } },
        _ppOp: 'reconcileOrphanOrderSupplies',   // ярлык от ПРЕДЫДУЩЕЙ операции — так было в логе #4480
        setBusy: function() {}, render: function() {}, notify: function() {},
        post: function() { seenOp = self._ppOp; return Promise.resolve({}); },
        reload: function() { return Promise.resolve(); }
    };
    return Controller.prototype.moveCutInDay.call(self, day, 0, 1).then(function() {
        assert(seenOp === 'moveCutInDay',
            '#4480-D: запись подписана своей операцией (было «' + seenOp + '», ожидалось «moveCutInDay»)');
    });
}
