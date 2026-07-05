// Unit tests for runWithConcurrency — параллельное сохранение заданий (ideav/crm#3998).
// Генерация (runGenerateCuts) собирает по одной задаче на резку-сегмент и гоняет их пулом
// не более 5 одновременно (внутри резки запросы остаются последовательными). Проверяем сам
// пул:
//   • все задачи выполняются, промис резолвится;
//   • одновременно активно не больше `limit` (и не больше числа задач);
//   • limit=1 → строго последовательно (макс. активных = 1);
//   • пустой список → сразу резолв;
//   • первая ошибка реджектит пул ПЕРВОЙ ошибкой и НЕ запускает новые задачи (уже
//     запущенные до лимита — дорабатывают), как обрывалась прежняя последовательная цепочка.
//
// Run with: node experiments/atex-production-planning-3998.test.js

process.env.TZ = 'UTC';

var runWithConcurrency = require('../download/atex/js/production-planning.js').planning.runWithConcurrency;

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

// Фабрика набора задач с трекингом: max одновременно активных + порядок стартов/финишей.
function makeTracker() {
    var t = { active: 0, maxActive: 0, started: [], finished: [] };
    t.task = function(i, opts) {
        opts = opts || {};
        return function() {
            t.started.push(i);
            t.active++;
            if (t.active > t.maxActive) t.maxActive = t.active;
            // Синхронный (микротаск) реджект — срабатывает РАНЬШЕ setTimeout остальных задач,
            // т.е. до того, как первая волна успеет доработать и подтянуть новые задачи.
            if (opts.rejectSync) { t.active--; return Promise.reject(new Error('boom-' + i)); }
            return delay(opts.ms == null ? 5 : opts.ms).then(function() {
                t.active--;
                if (opts.reject) throw new Error('boom-' + i);
                t.finished.push(i);
            });
        };
    };
    return t;
}

function run() {
    return Promise.resolve()
    // 1) 20 задач, лимит 5: все выполнены, макс. активных ровно 5.
    .then(function() {
        var t = makeTracker();
        var tasks = [];
        for (var i = 0; i < 20; i++) tasks.push(t.task(i));
        return runWithConcurrency(tasks, 5).then(function() {
            assertEqual(t.finished.length, 20, '20 задач/лимит 5: все выполнены');
            assertEqual(t.maxActive, 5, '20 задач/лимит 5: максимум 5 одновременно');
        });
    })
    // 2) Задач меньше лимита (3 задачи, лимит 5): максимум активных = 3.
    .then(function() {
        var t = makeTracker();
        var tasks = [t.task(0), t.task(1), t.task(2)];
        return runWithConcurrency(tasks, 5).then(function() {
            assertEqual(t.finished.length, 3, '3 задачи/лимит 5: все выполнены');
            assertEqual(t.maxActive, 3, '3 задачи/лимит 5: максимум 3 (не больше числа задач)');
        });
    })
    // 3) limit=1 → строго последовательно (макс. активных = 1), порядок сохранён.
    .then(function() {
        var t = makeTracker();
        var tasks = [];
        for (var i = 0; i < 6; i++) tasks.push(t.task(i));
        return runWithConcurrency(tasks, 1).then(function() {
            assertEqual(t.maxActive, 1, 'limit=1: строго по одному');
            assertEqual(t.finished, [0, 1, 2, 3, 4, 5], 'limit=1: порядок сохранён');
        });
    })
    // 4) Пустой список → сразу резолв.
    .then(function() {
        return runWithConcurrency([], 5).then(function() {
            assertEqual(true, true, 'пустой список: резолвится');
        });
    })
    // 5) Первая ошибка (синхронный реджект задачи 2, пока первая волна ещё в работе): реджект
    //    ПЕРВОЙ ошибкой; новые задачи (индексы ≥ 5) НЕ стартуют — стартовала только волна 0..4.
    .then(function() {
        var t = makeTracker();
        var tasks = [];
        for (var i = 0; i < 20; i++) tasks.push(t.task(i, { rejectSync: i === 2 }));
        return runWithConcurrency(tasks, 5).then(function() {
            assertEqual('resolved', 'rejected', 'ошибка: пул должен реджектнуться');
        }, function(err) {
            assertEqual(err && err.message, 'boom-2', 'ошибка: реджект первой ошибкой (boom-2)');
            assertEqual(t.started.slice().sort(function(a, b){ return a - b; }), [0, 1, 2, 3, 4],
                'ошибка: стартовала только первая волна из 5, новые не запущены');
        });
    })
    // 6) Ошибка НЕ в первой волне (индекс 7 из 5-поточного пула): всё до 7 успевает,
    //    после реджекта новые не стартуют, in-flight дорабатывают.
    .then(function() {
        var t = makeTracker();
        var tasks = [];
        for (var i = 0; i < 20; i++) tasks.push(t.task(i, { reject: i === 7, ms: 3 }));
        return runWithConcurrency(tasks, 5).then(function() {
            assertEqual('resolved', 'rejected', 'ошибка-в-середине: пул должен реджектнуться');
        }, function(err) {
            assertEqual(err && err.message, 'boom-7', 'ошибка-в-середине: реджект boom-7');
            var startedMax = Math.max.apply(null, t.started);
            assertEqual(startedMax < 20 && t.started.length < 20, true,
                'ошибка-в-середине: не все 20 задач стартовали (' + t.started.length + ' из 20)');
        });
    })
    .then(function() {
        console.log('\n' + passed + '/' + total + ' проверок прошло');
        if (passed !== total) process.exitCode = 1;
    });
}

run();
