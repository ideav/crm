// ideav/crm#5358 — Фаза 2 atex: пульт высечки ставит статусы позиции и заказа после выполнения задания.
//
// Что проверяется (download/atex-p2/js/die-cutter.js + templates/atex-p2/die-cutter.html):
//   1. «Готово» (finish): сначала статус задания «Выполнено», затем пересчёт статусов позиции и заказа
//      (AtexLabelStatus.completeAfterJob из label-status-core.js, #5341) по этому заданию;
//   2. итог пересчёта — в сообщении пульта («Позиция выполнена», «Заказ выполнен»);
//   3. ошибка пересчёта не откатывает закрытие задания: сообщение-предупреждение «Задание закрыто, но …»;
//   4. модуль статусов не загружен — тоже предупреждение, без исключения;
//   5. run() показывает вид сообщения, который вернула работа ({ text, kind });
//   6. шаблон подключает label-status-core.js, версия die-cutter.js поднята (планшеты кэшируют);
//   7. права Оператора: запись «Статус позиции» и «Статус заказа», чтение справочников статусов.
//
// Run with: node experiments/atex-p2-5358-die-cutter-status.test.js

var fs = require('fs');
var path = require('path');

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

var mod = require('../download/atex-p2/js/die-cutter.js');
var P = mod.AtexDieCutter.prototype;
var ROOT = path.join(__dirname, '..');

function statusFake(impl) {
    var calls = [];
    return { calls: calls, completeAfterJob: function(client, meta, jobId) { calls.push([client, meta, jobId]); return impl(); } };
}

Promise.resolve().then(function() {
    // ── 1–2. afterJobDone: вызов модуля статусов и текст итога ──────────────
    assert(typeof P.afterJobDone === 'function', '1: у пульта есть afterJobDone(jobId)');
    if (typeof P.afterJobDone !== 'function') return;
    var client = { name: 'client' }, meta = [{ id: '1', val: 'Заказ' }];
    var st = statusFake(function() { return Promise.resolve({ positionsDone: ['P1'], orderDone: true, ops: [{}, {}], skipped: [] }); });
    return P.afterJobDone.call({ client: client, meta: meta, labelStatus: st }, 'J7').then(function(res) {
        assert(st.calls.length === 1 && st.calls[0][0] === client && st.calls[0][1] === meta && String(st.calls[0][2]) === 'J7',
            '1: completeAfterJob(client пульта, metadata, id задания)');
        assert(res && res.kind === 'ok' && /Задание закрыто/.test(res.text) && /[Пп]озиция выполнена/.test(res.text) && /[Зз]аказ выполнен/.test(res.text),
            '2: итог — «Задание закрыто. Позиция выполнена. Заказ выполнен.»', JSON.stringify(res));

        var st2 = statusFake(function() { return Promise.resolve({ positionsDone: [], orderDone: false, ops: [], skipped: [] }); });
        return P.afterJobDone.call({ client: client, meta: meta, labelStatus: st2 }, 'J8');
    }).then(function(res) {
        assert(res && res.kind === 'ok' && res.text === 'Задание закрыто.', '2: у позиции остались невыполненные задания — просто «Задание закрыто.»', JSON.stringify(res));

        var st3 = statusFake(function() { return Promise.resolve({ positionsDone: ['P1', 'P2'], orderDone: false, ops: [{}], skipped: [] }); });
        return P.afterJobDone.call({ client: client, meta: meta, labelStatus: st3 }, 'J9');
    }).then(function(res) {
        assert(res && /[Пп]озиции выполнены/.test(res.text) && !/[Зз]аказ выполнен/.test(res.text), '2: две позиции — «Позиции выполнены», заказ не выполнен', JSON.stringify(res));

        // ── 3. ошибка пересчёта — предупреждение ───────────────────────────
        var st4 = statusFake(function() { return Promise.reject(new Error('нет прав')); });
        return P.afterJobDone.call({ client: client, meta: meta, labelStatus: st4 }, 'J10');
    }).then(function(res) {
        assert(res && res.kind === 'warn' && /Задание закрыто/.test(res.text) && /статус/i.test(res.text) && /нет прав/.test(res.text),
            '3: ошибка статусов — предупреждение, задание закрыто', JSON.stringify(res));

        var st5 = statusFake(function() { return Promise.resolve({ positionsDone: [], orderDone: false, ops: [], skipped: ['в справочнике «Статус заказа» нет «Выполнен»'] }); });
        return P.afterJobDone.call({ client: client, meta: meta, labelStatus: st5 }, 'J11');
    }).then(function(res) {
        assert(res && res.kind === 'warn' && /нет «Выполнен»/.test(res.text), '3: пропуск по данным (skipped) — предупреждение с причиной', JSON.stringify(res));

        // ── 4. модуль не загружен ──────────────────────────────────────────
        var saved = globalThis.AtexLabelStatus;
        delete globalThis.AtexLabelStatus;
        return P.afterJobDone.call({ client: client, meta: meta }, 'J12').then(function(res) {
            if (saved) globalThis.AtexLabelStatus = saved;
            assert(res && res.kind === 'warn' && /Задание закрыто/.test(res.text) && /label-status-core/.test(res.text),
                '4: нет label-status-core.js — предупреждение, без исключения', JSON.stringify(res));
        });
    }).then(function() {
        // ── 5. run() берёт вид сообщения из результата работы ──────────────
        var shown = [];
        var fake = { busy: false, message: function(t, k) { shown.push(k + ':' + t); }, reload: function() { return Promise.resolve(); } };
        return P.run.call(fake, function() { return { text: 'Задание закрыто, но …', kind: 'warn' }; }).then(function() {
            assert(shown[shown.length - 1] === 'warn:Задание закрыто, но …', '5: run() показывает { text, kind } из работы', shown.join(' | '));
            return P.run.call(fake, function() { return 'x'; }, 'Записано.');
        }).then(function() {
            assert(shown[shown.length - 1] === 'ok:Записано.', '5: прежний вызов run(work, okText) не изменился', shown.join(' | '));
        });
    }).then(function() {
        // ── 1. finish: «Выполнено» записано ДО пересчёта статусов ──────────
        var order = [], shown = null;
        var fake = {
            state: { tables: { dieJob: { reqs: { status: '1000146' } } }, runs: [], gps: [] },
            current: function() { return { id: 'J1', pullsPlan: 0, pullsFact: 0, footage: 0, status: 'В работе' }; },
            modal: function() { return Promise.resolve(true); },
            writePullsSilent: function() { order.push('tail'); return Promise.resolve(); },
            client: { post: function(p, f) { order.push('post:' + p + ':' + f.t1000146); return Promise.resolve({}); } },
            afterJobDone: function(id) { order.push('status:' + id); return Promise.resolve({ text: 'Задание закрыто. Позиция выполнена.', kind: 'ok' }); },
            run: function(work, okText) { return Promise.resolve().then(work).then(function(r) { shown = { r: r, okText: okText }; }); }
        };
        P.finish.call(fake);
        return new Promise(function(res) { setTimeout(res, 20); }).then(function() {
            var iDone = order.findIndex(function(x) { return /^post:_m_set\/J1\?JSON:Выполнено$/.test(x); });
            var iSt = order.indexOf('status:J1');
            assert(iDone >= 0 && iSt > iDone, '1: finish пишет «Выполнено», затем пересчитывает статусы', order.join(' | '));
            assert(shown && shown.okText == null && shown.r && /Позиция выполнена/.test(shown.r.text), '1: сообщение «Готово» — итог пересчёта статусов', JSON.stringify(shown));
        });
    });
}).then(function() {
    // ── 6. шаблон ─────────────────────────────────────────────────────────
    var html = fs.readFileSync(path.join(ROOT, 'templates', 'atex-p2', 'die-cutter.html'), 'utf8');
    assert(/<script[^>]+js\/label-status-core\.js\?\{_global_\.version\}\.\d+/.test(html), '6: шаблон подключает label-status-core.js с версией');
    var v = (html.match(/die-cutter\.js\?\{_global_\.version\}\.(\d+)/) || [])[1];
    assert(Number(v) >= 10, '6: версия die-cutter.js поднята (было .9 после #5355)', 'v=' + v);

    // ── 7. права Оператора ────────────────────────────────────────────────
    var g = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'atex_p2_die_cutter_status_5358.json'), 'utf8'));
    var op = (g.roles || []).filter(function(r) { return r.name === 'Оператор'; })[0] || { grants: [] };
    function grant(table, field, level) {
        return op.grants.some(function(x) { return x.table === table && (x.field || '') === (field || '') && x.level === level; });
    }
    assert(grant('Заказанное количество', 'Статус позиции', 'WRITE'), '7: Оператор пишет «Статус позиции»');
    assert(grant('Заказ', 'Статус заказа', 'WRITE'), '7: Оператор пишет «Статус заказа»');
    assert(grant('Статус позиции', '', 'READ') && grant('Статус заказа', '', 'READ'), '7: Оператор читает справочники статусов');
}).then(function() {
    console.log('\n' + passed + '/' + total + ' проверок пройдено.');
}).catch(function(e) {
    console.error(e); process.exitCode = 1;
});
