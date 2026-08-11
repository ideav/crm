// Массовая запись пулом — общий инструмент (issue #4716).
//
// Проверяем ровно то, ради чего он вынесен: потолок потоков соблюдается, порядок результатов не
// зависит от порядка завершения, ошибка не теряется, а семафор на транспорте держит потолок даже
// когда пулы вложены друг в друга (#4480: пять пулов по пять дали бы 25 запросов разом).
//
// Run with: node experiments/integram-batch.test.js

var B = require('../js/integram-batch.js');

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}
function delay(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

// Счётчик одновременных выполнений: задача сообщает пик.
function tracker() {
    var t = { active: 0, peak: 0, order: [] };
    t.task = function (name, ms) {
        return function () {
            t.active++; t.peak = Math.max(t.peak, t.active);
            return delay(ms).then(function () { t.active--; t.order.push(name); return name; });
        };
    };
    return t;
}

Promise.resolve()
    .then(function () {
        // ── Потолок потоков ──────────────────────────────────────────────────────────────
        var t = tracker();
        var tasks = [];
        for (var i = 0; i < 12; i++) tasks.push(t.task('t' + i, 10));
        return B.runWithConcurrency(tasks, 5).then(function (res) {
            assert(t.peak <= 5, 'одновременно выполняется не больше пяти задач', 'пик ' + t.peak);
            assert(t.peak === 5, 'пул действительно загружен — пик равен потолку, а не единице', 'пик ' + t.peak);
            assert(res.length === 12 && res[0] === 't0' && res[11] === 't11',
                'результаты возвращаются в порядке ИСХОДНОГО массива, а не завершения');
        });
    })
    .then(function () {
        // Порядок завершения обратный — результаты всё равно по местам.
        var tasks = [function () { return delay(30).then(function () { return 'a'; }); },
                     function () { return delay(1).then(function () { return 'b'; }); }];
        return B.runWithConcurrency(tasks, 5).then(function (res) {
            assert(res.join(',') === 'a,b', 'медленная задача не съезжает в конец результата', res.join(','));
        });
    })
    .then(function () {
        // ── Ошибка не теряется ───────────────────────────────────────────────────────────
        var started = 0;
        var tasks = [];
        for (var i = 0; i < 10; i++) {
            (function (n) {
                tasks.push(function () {
                    started++;
                    return n === 1 ? Promise.reject(new Error('запись не прошла')) : delay(5);
                });
            })(i);
        }
        return B.runWithConcurrency(tasks, 3).then(function () {
            assert(false, 'ошибка массовой записи обязана выйти наружу');
        }, function (err) {
            assert(/запись не прошла/.test(err.message), 'первая ошибка возвращается наружу', err.message);
            assert(started < 10, 'после ошибки новые задачи в работу не берутся', 'запущено ' + started);
        });
    })
    .then(function () {
        // ── Пустой набор ─────────────────────────────────────────────────────────────────
        return B.runWithConcurrency([], 5).then(function (res) {
            assert(Array.isArray(res) && res.length === 0, 'пустой набор — это успех, а не ошибка');
        });
    })
    .then(function () {
        // ── Семафор на транспорте: потолок держится при ВЛОЖЕННЫХ пулах (#4480) ─────────
        var t = tracker();
        var post = B.limiter(function (name) { return t.task(name, 8)(); }, 5);
        // Пять пулов по пять задач: без семафора это 25 запросов разом.
        var outer = [];
        for (var g = 0; g < 5; g++) {
            (function (grp) {
                outer.push(function () {
                    var inner = [];
                    for (var k = 0; k < 5; k++) inner.push((function (n) {
                        return function () { return post('g' + grp + 'n' + n); };
                    })(k));
                    return B.runWithConcurrency(inner, 5);
                });
            })(g);
        }
        return B.runWithConcurrency(outer, 5).then(function () {
            assert(t.peak <= 5, 'при вложенных пулах транспорт всё равно держит пять потоков', 'пик ' + t.peak);
            assert(t.order.length === 25, 'ни один запрос не потерян', String(t.order.length));
        });
    })
    .then(function () {
        // Семафор пропускает ошибку и не «залипает»: следующий вызов проходит.
        var post = B.limiter(function (ok) { return ok ? Promise.resolve('ok') : Promise.reject(new Error('нет')); }, 2);
        return post(false).then(function () { assert(false, 'ошибка должна выйти наружу'); },
            function (e) { assert(/нет/.test(e.message), 'семафор пропускает ошибку наружу'); })
            .then(function () { return post(true); })
            .then(function (r) { assert(r === 'ok', 'после ошибки семафор не заблокирован — слот освобождён'); });
    })
    .then(function () {
        assert(B.DEFAULT_LIMIT === 5, 'потолок по умолчанию — пять потоков (правило #4477/#3998)');
        console.log('\n' + passed + ' проверок прошли из ' + total);
    });
