// Unit tests for parallel deletion — «Удалить» тоже параллельно (ideav/crm#4005, follow-up #4004).
//
// runDeleteDayTasks / runDeleteCutTask раньше сносили записи строго последовательной цепочкой
// (chain.then). #4005 распараллелил их тем же пулом runWithConcurrency(…, 5), что и сохранение
// (#3998/#4004), НЕ нарушая жёсткий порядок «сперва ВСЕ обеспечения, потом резки» (иначе _m_del
// резки → 409: пока живы ссылки Обеспечений на Партии ГП). Порядок держится БАРЬЕРОМ между
// фазами: фаза 1 — обеспечения (пулом), дожидаемся ВСЕХ, фаза 2 — резки (пулом).
//
// Прототипные методы вызываем на минимальном mock-`this` (post/reload/render/notify/…),
// runWithConcurrency берётся из замыкания модуля. Проверяем:
//   • ИНВАРИАНТ 409: ни один _m_del резки не стартует, пока не сняты ВСЕ обеспечения;
//   • параллелизм внутри фазы ограничен пулом (5) и реально > 1;
//   • удалены ВСЕ записи (по одному _m_del на id), reload/render/notify success — по разу;
//   • runDeleteCutTask: обеспечения пулом → затем ровно одна резка → autoSequenceQueue.
//
// Run with: node experiments/atex-production-planning-4005.test.js

process.env.TZ = 'UTC';

var Controller = require('../download/atex/js/production-planning.js').Controller;

var passed = 0, total = 0;
function assertEqual(actual, expected, name) {
    total++;
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; }
    else {
        console.log('  expected:', JSON.stringify(expected));
        console.log('  actual:  ', JSON.stringify(actual));
        process.exitCode = 1;
    }
}

function delay(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

// Минимальный mock-`this`: только то, что трогают runDeleteDayTasks/runDeleteCutTask.
// `post` классифицирует id (обеспечение/резка) по supplySet, считает активные по фазам,
// фиксирует нарушение инварианта (резка стартовала, пока не сняты все обеспечения).
function makeCtx(supplyIds) {
    var supplySet = {};
    supplyIds.forEach(function(id) { supplySet[String(id)] = true; });
    var st = {
        suppliesTotal: supplyIds.length,
        suppliesDone: 0,
        cutStartedEarly: [],          // резки, стартовавшие до снятия всех обеспечений — ДОЛЖНО быть пусто
        activeSupply: 0, maxActiveSupply: 0,
        activeCut: 0, maxActiveCut: 0,
        deleted: [],                  // все успешно удалённые id (в порядке завершения)
        reloadCount: 0, renderCount: 0, autoSeqCount: 0,
        notifications: []
    };
    var settleResolve;
    var settled = new Promise(function(res) { settleResolve = res; });
    var ctx = {
        busy: false,
        selectedCutId: null,
        _st: st,
        settled: settled,
        post: function(url) {
            var m = /_m_del\/([^?]+)/.exec(url);
            var id = m ? decodeURIComponent(m[1]) : url;
            var isSupply = supplySet[String(id)] === true;
            if (!isSupply && st.suppliesDone < st.suppliesTotal) {
                // Инвариант 409: резка не должна удаляться, пока живо хоть одно обеспечение.
                st.cutStartedEarly.push(id);
            }
            if (isSupply) { st.activeSupply++; if (st.activeSupply > st.maxActiveSupply) st.maxActiveSupply = st.activeSupply; }
            else          { st.activeCut++;    if (st.activeCut    > st.maxActiveCut)    st.maxActiveCut    = st.activeCut; }
            return delay(4).then(function() {
                if (isSupply) { st.activeSupply--; st.suppliesDone++; }
                else          { st.activeCut--; }
                st.deleted.push(String(id));
            });
        },
        setBusy: function(v) { this.busy = !!v; },
        showProgress: function() {},
        updateProgress: function() {},
        hideProgress: function() {},
        render: function() { st.renderCount++; },
        reload: function() { st.reloadCount++; return Promise.resolve(); },
        notify: function(msg, kind) {
            st.notifications.push({ msg: msg, kind: kind });
            // Терминал: даём догореть autoSequenceQueue (cut task зовёт её ПОСЛЕ notify).
            setTimeout(settleResolve, 8);
        },
        autoSequenceQueue: function() { st.autoSeqCount++; return Promise.resolve(); }
    };
    return ctx;
}

function run() {
    return Promise.resolve()
    // 1) runDeleteDayTasks: 12 обеспечений + 8 резок. Инвариант 409 соблюдён, параллелизм по 5.
    .then(function() {
        var supplies = [], cuts = [];
        for (var i = 0; i < 12; i++) supplies.push({ id: 's' + i, cutId: 'c' + (i % 8) });
        for (var j = 0; j < 8; j++) cuts.push({ id: 'c' + j });
        var supplyIds = supplies.map(function(s) { return s.id; });
        var ctx = makeCtx(supplyIds);
        Controller.prototype.runDeleteDayTasks.call(ctx, cuts, supplies, '05.07.2026');
        return ctx.settled.then(function() {
            var st = ctx._st;
            assertEqual(st.cutStartedEarly, [], 'день: ни одна резка не удалена до снятия всех обеспечений (нет 409)');
            assertEqual(st.maxActiveSupply, 5, 'день: обеспечения сносятся пулом до 5 одновременно');
            assertEqual(st.maxActiveCut, 5, 'день: резки сносятся пулом до 5 одновременно');
            assertEqual(st.deleted.length, 20, 'день: удалены все 20 записей (12 обеспечений + 8 резок)');
            var uniq = {}; st.deleted.forEach(function(id) { uniq[id] = (uniq[id] || 0) + 1; });
            assertEqual(Object.keys(uniq).length, 20, 'день: каждый id удалён ровно один раз');
            assertEqual(st.reloadCount, 1, 'день: reload вызван один раз');
            assertEqual(st.notifications.length && st.notifications[st.notifications.length - 1].kind, 'success',
                'день: финальный тост — success');
        });
    })
    // 2) runDeleteDayTasks: обеспечений меньше лимита (3) — параллелизм = числу задач, не больше.
    .then(function() {
        var supplies = [{ id: 's0' }, { id: 's1' }, { id: 's2' }];
        var cuts = [{ id: 'c0' }, { id: 'c1' }];
        var ctx = makeCtx(supplies.map(function(s) { return s.id; }));
        Controller.prototype.runDeleteDayTasks.call(ctx, cuts, supplies, '05.07.2026');
        return ctx.settled.then(function() {
            var st = ctx._st;
            assertEqual(st.cutStartedEarly, [], 'день(мало): инвариант 409 соблюдён');
            assertEqual(st.maxActiveSupply, 3, 'день(мало): максимум активных = числу обеспечений (3)');
            assertEqual(st.maxActiveCut, 2, 'день(мало): максимум активных резок = 2');
            assertEqual(st.deleted.length, 5, 'день(мало): удалены все 5 записей');
        });
    })
    // 3) runDeleteDayTasks: обеспечений нет — сразу фаза резок, инвариант тривиально соблюдён.
    .then(function() {
        var ctx = makeCtx([]);
        Controller.prototype.runDeleteDayTasks.call(ctx, [{ id: 'c0' }, { id: 'c1' }, { id: 'c2' }], [], '05.07.2026');
        return ctx.settled.then(function() {
            var st = ctx._st;
            assertEqual(st.cutStartedEarly, [], 'день(без обеспечений): резки удаляются, инвариант ок');
            assertEqual(st.deleted.length, 3, 'день(без обеспечений): удалены 3 резки');
            assertEqual(st.reloadCount, 1, 'день(без обеспечений): reload один раз');
        });
    })
    // 4) runDeleteCutTask: 9 обеспечений резки пулом (до 5), затем РОВНО ОДНА резка, потом autoSequenceQueue.
    .then(function() {
        var ids = [];
        for (var i = 0; i < 9; i++) ids.push('s' + i);
        var ctx = makeCtx(ids);
        Controller.prototype.runDeleteCutTask.call(ctx, 'CUT1', ids, 'Плёнка · 05.07.2026');
        return ctx.settled.then(function() {
            var st = ctx._st;
            assertEqual(st.cutStartedEarly, [], 'резка: сама резка не удалена до снятия всех её обеспечений (нет 409)');
            assertEqual(st.maxActiveSupply, 5, 'резка: обеспечения сносятся пулом до 5 одновременно');
            assertEqual(st.maxActiveCut, 1, 'резка: сама резка удаляется одна (после барьера)');
            assertEqual(st.deleted.length, 10, 'резка: удалены 9 обеспечений + 1 резка');
            assertEqual(st.deleted[st.deleted.length - 1], 'CUT1', 'резка: резка удалена ПОСЛЕДНЕЙ');
            assertEqual(st.autoSeqCount, 1, 'резка: autoSequenceQueue вызван один раз (пересборка старта дня)');
            assertEqual(st.notifications.length && st.notifications[st.notifications.length - 1].kind, 'success',
                'резка: финальный тост — success');
        });
    })
    // 5) runDeleteCutTask без обеспечений: удаляется только сама резка.
    .then(function() {
        var ctx = makeCtx([]);
        Controller.prototype.runDeleteCutTask.call(ctx, 'CUT2', [], 'Плёнка · 05.07.2026');
        return ctx.settled.then(function() {
            var st = ctx._st;
            assertEqual(st.deleted, ['CUT2'], 'резка(без обеспечений): удалена только сама резка');
            assertEqual(st.autoSeqCount, 1, 'резка(без обеспечений): autoSequenceQueue вызван один раз');
        });
    })
    .then(function() {
        console.log('\n' + passed + '/' + total + ' проверок прошло');
        if (passed !== total) process.exitCode = 1;
    });
}

run();
