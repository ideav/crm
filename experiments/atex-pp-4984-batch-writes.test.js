// Тесты для ideav/crm#4984 — ЗАПИСЬ ПЛАНА УХОДИТ ПАКЕТОМ `_m_batch`, а не командой на операцию.
//
// Из разбора #4979 (боевая ateh1, лог перемещения): одно перемещение задания = 142 команды `_m_*`,
// из них 85 `_m_save` и 17 `_m_set` — правка существующих записей по id. Параллелить больше нечего
// (семафор записи на 5, браузер держит 6 соединений на домен), упирается в КОЛИЧЕСТВО round-trip'ов.
// Ядро #4981/#4982 дало ручку `POST /{db}/_m_batch` (`ops=<массив JSON>`, ответ `results` по
// операции, пакет НЕ атомарен — docs/kb/crud.md).
//
// Здесь гоняется РЕАЛЬНЫЙ транспорт со стаб-fetch (как в #4177) и реальные шлюзы записи:
//   1 — postOps: N операций уходят ОДНИМ запросом `_m_batch`, порядок и поля сохранены;
//   2 — ответ разбирается ПОИМЁННО: упавшая операция называет себя, соседние применены;
//   3 — пакет режется по пределу (у ядра BATCH_OPS_LIMIT=1000);
//   4 — «Время старта»: 8 изменившихся заданий = ОДИН запрос, неизменившиеся в пакет не попали;
//   5 — колонки наладки уходят тем же пакетом операциями `set`;
//   6 — писать нечего / висит непринятый пересчёт → ни одного запроса;
//   7 — СТАРОЕ ЯДРО (ручки нет): операции переписываются по одной, и второй раз в `_m_batch`
//       клиент уже не стучится. Идёт ПОСЛЕДНИМ: флаг «ручки нет» живёт до перезагрузки страницы.
//
// Run with: node experiments/atex-pp-4984-batch-writes.test.js

process.env.TZ = 'Europe/Moscow';
global.window = { xsrf: 'xsrf-token' };
var Controller = require('../download/atex/js/production-planning.js').Controller;

// Предмет мерки. Без него проверки транспорта проверять нечего — говорим это прямо, а не падаем
// TypeError; проверки ШЛЮЗОВ (4 и 5) идут в любом случае и показывают поведение: сколько запросов
// стоит набор записей.
var hasPostOps = (typeof Controller.prototype.postOps === 'function');

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.error((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

// ── стаб fetch: программируемый ответ + журнал запросов ───────────────────────────────────────
var calls = [];          // { url, body }
var responder = null;    // function(url, body) -> { ok, status, body }
global.fetch = function (url, opts) {
    var body = (opts && opts.body) || '';
    calls.push({ url: url, body: String(body) });
    var r = responder ? responder(url, String(body)) : { ok: true, status: 200, body: '{}' };
    return Promise.resolve({
        ok: r.ok, status: r.status,
        text: function () { return Promise.resolve(r.body); }
    });
};
function reset(fn) { calls = []; responder = fn || null; }
function batchCalls() { return calls.filter(function (c) { return /\/_m_batch$/.test(String(c.url)); }); }
function opsOf(call) {
    var ops = new URLSearchParams(call.body).get('ops');
    try { return JSON.parse(ops); } catch (e) { return null; }
}
// Ответ ручки: все операции применены.
function allOk(url, body) {
    var ops = JSON.parse(new URLSearchParams(body).get('ops') || '[]');
    return { ok: true, status: 200, body: JSON.stringify({
        results: ops.map(function (o, n) { return { n: n, op: o.op, id: o.id, ok: true }; }),
        ok: ops.length, failed: 0
    }) };
}

function makeCtx(extra) {
    var ctx = {
        db: 'ateh1',
        _ppOp: 'test',
        root: { getAttribute: function () { return 'xsrf-token'; } },
        url: Controller.prototype.url,
        post: Controller.prototype.post,
        postOps: Controller.prototype.postOps,
        notify: function () {}
    };
    Object.keys(extra || {}).forEach(function (k) { ctx[k] = extra[k]; });
    return ctx;
}

// ── 1: N операций — один запрос ───────────────────────────────────────────────────────────────
function test1() {
    if (!hasPostOps) return Promise.resolve(assert(false, '#4984: в клиенте нет пакетной записи (Controller.prototype.postOps) — мерка потеряла предмет'));
    reset(allOk);
    var ops = [];
    for (var i = 0; i < 12; i++) {
        ops.push(i % 2
            ? { op: 'set', id: 'S' + i, fields: { t1085: String(i) } }
            : { op: 'save', id: 'V' + i, fields: { t1078: String(1790106240 + i) } });
    }
    return Controller.prototype.postOps.call(makeCtx(), ops).then(function (n) {
        var b = batchCalls();
        assert(b.length === 1 && calls.length === 1,
            '#4984-1: двенадцать операций уходят ОДНИМ запросом (было 12; сейчас запросов ' + calls.length + ')');
        assert(b.length === 1 && /\/ateh1\/_m_batch$/.test(b[0].url),
            '#4984-1: адрес пакета — /{db}/_m_batch');
        var sent = b.length ? opsOf(b[0]) : null;
        assert(!!sent && sent.length === 12,
            '#4984-1: в пакете все 12 операций (сейчас ' + (sent ? sent.length : 'пакета нет') + ')');
        assert(!!sent && sent[0].op === 'save' && String(sent[0].id) === 'V0' && sent[0].fields.t1078 === '1790106240'
            && sent[1].op === 'set' && String(sent[1].id) === 'S1',
            '#4984-1: операция, запись и поля переданы как есть, в исходном порядке');
        assert(b.length === 1 && new URLSearchParams(b[0].body).get('_xsrf') === 'xsrf-token',
            '#4984-1: XSRF-токен в теле пакета (раздел 4 гайда)');
        assert(n === 12, '#4984-1: промис резолвится числом применённых операций (сейчас ' + n + ')');
    });
}

// ── 2: поимённый разбор отказа ────────────────────────────────────────────────────────────────
function test2() {
    if (!hasPostOps) return Promise.resolve(assert(false, '#4984: в клиенте нет пакетной записи (Controller.prototype.postOps) — мерка потеряла предмет'));
    reset(function (url, body) {
        var ops = JSON.parse(new URLSearchParams(body).get('ops') || '[]');
        return { ok: true, status: 200, body: JSON.stringify({
            results: ops.map(function (o, n) {
                return (String(o.id) === 'B')
                    ? { n: n, op: o.op, id: o.id, ok: false, error: 'нет доступа к реквизиту объекта' }
                    : { n: n, op: o.op, id: o.id, ok: true };
            }),
            ok: ops.length - 1, failed: 1
        }) };
    });
    var ops = ['A', 'B', 'C'].map(function (id) { return { op: 'set', id: id, fields: { t1085: '1' } }; });
    return Controller.prototype.postOps.call(makeCtx(), ops).then(
        function () { assert(false, '#4984-2: упавшая операция обязана отклонить промис'); },
        function (err) {
            assert(/нет доступа к реквизиту объекта/.test(String(err && err.message)),
                '#4984-2: промис отклонён ТЕКСТОМ ошибки от сервера', String(err && err.message).slice(0, 80));
            assert(String(err && err.opId) === 'B',
                '#4984-2: отказ называет запись, на которой упал (пакет не атомарен — повторять поимённо)');
            assert(err && Array.isArray(err.results) && err.results.length === 3 && err.applied === 2,
                '#4984-2: соседние операции применены и видны в results (сейчас applied=' + (err && err.applied) + ')');
        });
}

// ── 3: пакет режется по пределу ───────────────────────────────────────────────────────────────
function test3() {
    if (!hasPostOps) return Promise.resolve(assert(false, '#4984: в клиенте нет пакетной записи (Controller.prototype.postOps) — мерка потеряла предмет'));
    reset(allOk);
    var ops = [];
    for (var i = 0; i < 1200; i++) ops.push({ op: 'save', id: 'X' + i, fields: { t1078: String(i) } });
    return Controller.prototype.postOps.call(makeCtx(), ops).then(function (n) {
        var b = batchCalls();
        var sizes = b.map(function (c) { var o = opsOf(c); return o ? o.length : 0; });
        var sum = sizes.reduce(function (a, x) { return a + x; }, 0);
        assert(b.length > 1 && b.length < 1200,
            '#4984-3: 1200 операций режутся на пакеты, а не на 1200 запросов (сейчас ' + b.length + ')');
        assert(sizes.every(function (s) { return s > 0 && s <= 1000; }),
            '#4984-3: ни один пакет не превышает предел ядра BATCH_OPS_LIMIT=1000 (сейчас ' + sizes.join(',') + ')');
        assert(sum === 1200 && n === 1200,
            '#4984-3: ни одна операция не потеряна при нарезке (отправлено ' + sum + ', применено ' + n + ')');
    });
}

// ── 4: «Время старта» — шлюз postCutStarts пишет пакетом ──────────────────────────────────────
// Правило #4477 «неизменившееся не сохраняем» остаётся: отсев идёт ДО пакета.
function test4() {
    reset(allOk);
    var D = Math.floor(new Date(2026, 8, 21, 8, 0, 0, 0).getTime() / 1000);
    var cuts = [];
    for (var i = 0; i < 8; i++) cuts.push({ id: 'C' + i, planDate: String(D + i * 600) });
    cuts.push({ id: 'SAME', planDate: String(D) });
    var ctx = makeCtx({ meta: { cut: { id: '1078', reqs: [] } }, cuts: cuts });
    var items = cuts.slice(0, 8).map(function (c) { return { cutId: c.id, ts: Number(c.planDate) + 60 }; });
    items.push({ cutId: 'SAME', ts: D });                          // ровно хранимое
    items.push({ cutId: 'SAME2', ts: D, wasTs: D });               // хранимое передано явно
    return Controller.prototype.saveCutStarts.call(ctx, items).then(function (n) {
        var b = batchCalls();
        assert(b.length === 1 && calls.length === 1,
            '#4984-4: восемь изменившихся стартов = ОДИН запрос (было 8; сейчас ' + calls.length + ')');
        var sent = b.length ? opsOf(b[0]) : [];
        assert(sent.length === 8 && n === 8,
            '#4984-4: в пакете ровно изменившиеся — 8 из 10 (в пакете ' + sent.length + ', записано ' + n + ')');
        assert(sent.every(function (o) { return o.op === 'save' && o.fields && o.fields.t1078 != null; }),
            '#4984-4: первая колонка (planStart) пишется операцией save с t{tableId} (issue #775)');
        var ids = sent.map(function (o) { return String(o.id); });
        assert(ids.indexOf('SAME') < 0 && ids.indexOf('SAME2') < 0,
            '#4984-4: совпавшему с хранимым стартом команды не даём — и в пакет он не попал (#4477)');
    });
}

// ── 5: колонки наладки — тем же пакетом, операциями set ───────────────────────────────────────
function test5() {
    reset(allOk);
    var ctx = makeCtx({
        computeCutSetupUpdates: function () {
            return {
                reqs: { knifeReq: '1085', matReq: '1086', cutTimeReq: '1087' },
                updates: [
                    { cutId: 'A', knife: 12, material: 7, cutTime: 40 },
                    { cutId: 'B', knife: 0, material: 5, cutTime: 33 },
                    { cutId: 'C', knife: 9, material: 0, cutTime: 21 }
                ]
            };
        }
    });
    return Controller.prototype.persistCutSetupColumns.call(ctx, null, null, {}).then(function () {
        var b = batchCalls();
        assert(b.length === 1 && calls.length === 1,
            '#4984-5: колонки наладки трёх заданий = ОДИН запрос (было 3; сейчас ' + calls.length + ')');
        var sent = b.length ? opsOf(b[0]) : [];
        assert(sent.length === 3 && sent.every(function (o) { return o.op === 'set'; }),
            '#4984-5: реквизиты пишутся операциями set (сейчас ' + sent.length + ' операций)');
        assert(sent.length === 3 && sent[0].fields.t1085 === '12' && sent[0].fields.t1087 === '40',
            '#4984-5: набор полей тот же, что у одиночного _m_set');
    });
}

// ── 6: писать нечего / висит непринятый пересчёт ──────────────────────────────────────────────
function test6() {
    if (!hasPostOps) return Promise.resolve(assert(false, '#4984: в клиенте нет пакетной записи (Controller.prototype.postOps) — мерка потеряла предмет'));
    reset(allOk);
    return Controller.prototype.postOps.call(makeCtx(), []).then(function (n) {
        assert(n === 0 && calls.length === 0,
            '#4984-6: пустой набор — ни одного запроса (пустой ops ядро отвергает конвертом)');
        var ctx = makeCtx({ _pendingPlan: { some: 'preview' } });
        return Controller.prototype.postOps.call(ctx, [{ op: 'set', id: 'A', fields: { t1: '1' } }]).then(
            function () { assert(false, '#4984-6: при непринятом пересчёте запись обязана быть закрыта'); },
            function (err) {
                assert(/Упорядочить/.test(String(err && err.message)) && calls.length === 0,
                    '#4984-6: пакет тоже закрыт предпросмотром «Упорядочить» (#4402) — и запроса не было');
            });
    });
}

// ── 7: старое ядро — ручки нет, операции переписываются по одной ──────────────────────────────
// ПОСЛЕДНИЙ тест: обнаруженное «ручки нет» запоминается до перезагрузки страницы.
function test7() {
    if (!hasPostOps) return Promise.resolve(assert(false, '#4984: в клиенте нет пакетной записи (Controller.prototype.postOps) — мерка потеряла предмет'));
    reset(function (url) {
        if (/\/_m_batch$/.test(String(url))) return { ok: false, status: 404, body: '<html>Not Found</html>' };
        return { ok: true, status: 200, body: JSON.stringify({ obj: 'OK' }) };
    });
    var ops = [
        { op: 'save', id: 'A', fields: { t1078: '1790106240' } },
        { op: 'set', id: 'B', fields: { t1085: '12' } },
        { op: 'set', id: 'C', fields: { t1085: '13' } }
    ];
    return Controller.prototype.postOps.call(makeCtx(), ops).then(function (n) {
        assert(n === 3, '#4984-7: на старом ядре пакет не теряется — операции применены по одной (сейчас ' + n + ')');
        var singles = calls.filter(function (c) { return !/\/_m_batch$/.test(String(c.url)); });
        assert(singles.length === 3,
            '#4984-7: три одиночные команды вместо пакета (сейчас ' + singles.length + ')');
        assert(/_m_save\/A\?JSON$/.test(String(singles[0].url)) && /_m_set\/B\?JSON$/.test(String(singles[1].url)),
            '#4984-7: одиночный путь прежний — _m_save/{id}?JSON и _m_set/{id}?JSON',
            singles.map(function (c) { return String(c.url).split('/').slice(-1)[0]; }).join(' '));
        var before = batchCalls().length;
        calls = [];
        return Controller.prototype.postOps.call(makeCtx(), ops).then(function () {
            assert(before === 1 && batchCalls().length === 0,
                '#4984-7: второй раз в отсутствующую ручку не стучимся (сейчас пакетных запросов ' + batchCalls().length + ')');
        });
    });
}

Promise.resolve()
    .then(test1).then(test2).then(test3).then(test4).then(test5).then(test6).then(test7)
    .then(function () { console.error('\n' + passed + '/' + total + ' проверок пройдено.'); })
    .catch(function (e) { console.error('НЕОЖИДАННАЯ ОШИБКА:', e && e.stack || e); process.exitCode = 1; });
