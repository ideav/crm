// Test for ideav/crm#4023 — persistCutSetupColumns («последний набор запросов») распараллелен.
//
// После «Создать»/«Упорядочить» applySplitPlan уже гонит update/create/delete пулом (#4014), но
// ЗАВЕРШАЮЩИЙ шаг persistCutSetupColumns (запись тайминга «Наладка ножей / Сырье-намотка / Резка
// и Лидер», по одному _m_set/<cutId>?JSON на резку) оставался последовательной цепочкой chain.then
// — «последний набор запросов» шёл лесенкой в 1 поток, окно висело на 100% (скрин #4023). Теперь
// эти независимые записи гоняются пулом runWithConcurrency(…, 5), как #3998/#4005/#4014.
//
// Фикс — только обёртка вокруг цикла записи (chain → пул); computeCutSetupUpdates/setupTimingFields
// не менялись. Поэтому мокаем computeCutSetupUpdates (даёт N готовых updates) и проверяем РЕАЛЬНЫЙ
// persistCutSetupColumns (mock post с задержкой):
//   • ПАРАЛЛЕЛИЗМ: до 5 _m_set одновременно при N=8 (> лимита пула);
//   • ПОЛНОТА: ровно N запросов, по одному _m_set/<cutId>?JSON на резку;
//   • путь и поля запроса верны (t<req> = значение);
//   • УСПЕХ: промис резолвится, notify не зовётся;
//   • ОШИБКА (как прежняя цепочка): реджект одного _m_set → промис всё равно резолвится, notify
//     зовётся РОВНО раз (тихо не глотаем, но и очередь старта/порядка не валим, #3778).
//
// Run with: node experiments/atex-production-planning-4023.test.js

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

var N = 8;   // резок с тайминг-обновлением (> лимита пула 5 → виден потолок параллелизма)
var KNIFE_REQ = '501', MAT_REQ = '502', CUTTIME_REQ = '503';

function makeController(failCutId) {
    var root = { getAttribute: function() { return 'testdb'; } };
    var c = new Controller(root);
    c.notify = function() { c._notifyCount++; };
    c._notifyCount = 0;

    // Мок вычисления: N готовых обновлений тайминга (реквизиты + значения на резку).
    c.computeCutSetupUpdates = function() {
        var updates = [];
        for (var i = 0; i < N; i++) updates.push({ cutId: 'C' + i, knife: 10 + i, material: 20 + i, cutTime: 30 + i });
        return { reqs: { knifeReq: KNIFE_REQ, matReq: MAT_REQ, cutTimeReq: CUTTIME_REQ }, updates: updates };
    };

    var st = { inflight: 0, maxInflight: 0, posts: [], batches: [] };
    c._st = st;
    // #4984: колонки наладки уходят ПАКЕТОМ `_m_batch` (ядро #4981). Стенд отвечает как эта
    // ручка и раскладывает пакет на отдельные записи — проверки ниже про ЗАПИСИ, а не про
    // запросы. Отказ одной записи в пакете — это `ok:false` по своей операции: пакет не
    // атомарен, соседние применяются (docs/kb/crud.md).
    c.post = function(path, fields) {
        st.inflight++;
        if (st.inflight > st.maxInflight) st.maxInflight = st.inflight;
        var ops = (path === '_m_batch') ? JSON.parse(fields.ops) : null;
        if (ops) {
            ops.forEach(function(o) { st.posts.push({ path: '_m_set/' + o.id + '?JSON', fields: o.fields }); });
            st.batches.push(ops.length);
        } else {
            st.posts.push({ path: path, fields: fields });
        }
        return delay(5).then(function() {
            st.inflight--;
            if (ops) {
                return { results: ops.map(function(o, n) {
                    return (failCutId != null && String(o.id) === String(failCutId))
                        ? { n: n, op: o.op, id: o.id, ok: false, error: 'boom' }
                        : { n: n, op: o.op, id: o.id, ok: true };
                }), ok: ops.length, failed: 0 };
            }
            if (failCutId != null && path.indexOf('/' + failCutId + '?') >= 0) throw new Error('boom');
            return { obj: 'OK' };
        });
    };
    return c;
}

// ── happy path ──
var c = makeController(null);
c.persistCutSetupColumns().then(function() {
    var st = c._st;
    assertEqual(st.batches, [N], '#4023: все ' + N + ' записей уходят ОДНИМ запросом-пакетом (#4984; было ' + N + ' запросов пулом по 5)');
    assertEqual(st.posts.length, N, '#4023: ровно ' + N + ' запросов (по одному _m_set на резку)');

    var paths = st.posts.map(function(p) { return p.path; }).sort();
    var expectPaths = [];
    for (var i = 0; i < N; i++) expectPaths.push('_m_set/C' + i + '?JSON');
    expectPaths.sort();
    assertEqual(paths, expectPaths, '#4023: путь каждого запроса = _m_set/<cutId>?JSON');

    // Поля первой резки C0: t501=10, t502=20, t503=30 (setupTimingFields из reqs+update).
    var p0 = st.posts.filter(function(p) { return p.path === '_m_set/C0?JSON'; })[0];
    assertEqual(p0.fields, { t501: '10', t502: '20', t503: '30' }, '#4023: поля запроса — t<req>=значение');

    assertEqual(c._notifyCount, 0, '#4023: при успехе notify не зовётся');

    // ── error path: один _m_set падает ──
    var c2 = makeController('C3');
    return c2.persistCutSetupColumns().then(function(r) {
        assertEqual(r === undefined, true, '#4023: при ошибке промис РЕЗОЛВИТСЯ (очередь не валим)');
        assertEqual(c2._notifyCount, 1, '#4023: при ошибке notify зовётся ровно раз');
    });
}).then(function() {
    console.log('\n' + passed + '/' + total + ' проверок прошло');
    if (passed !== total) process.exitCode = 1;
}).catch(function(err) {
    console.log('FAIL — тест бросил: ' + (err && err.stack || err));
    process.exitCode = 1;
});
