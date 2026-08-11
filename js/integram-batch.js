// МАССОВАЯ ЗАПИСЬ — ОБЩИЙ ИНСТРУМЕНТ (issue #4716).
//
// Правило (ТЗ atex §15, #4477/#3998): набор независимых записей отправляется **пулом до пяти
// потоков** — не цепочкой в один поток (на очереди в сотни записей это минуты ожидания) и не
// пачкой без предела (сервер и браузер захлёбываются). Порядок записи в базе не значим, поэтому
// параллелить можно всё, что не связано отношением «родитель → потомок».
//
// Инструмент общий, а не копия в каждом рабочем месте: пул уже переписывали в atex, в конверторе
// моделей и в выгрузке — и каждый раз заново решали, что делать с ошибкой и с вложенностью.
//
// Две вещи, ради которых он здесь:
//   • `runWithConcurrency(thunks, limit)` — выполнить набор задач, держа не больше `limit` разом;
//   • `limiter(fn, max)` — обернуть САМ транспорт (функцию запроса). Это важнее пула: пулы
//     вкладываются друг в друга (цепочка → её сегменты → их дети), и пять вложенных пулов по пять
//     дали бы двадцать пять запросов разом. Семафор на транспорте держит потолок независимо от
//     того, сколько пулов работает одновременно (#4480).
//
(function () {
    'use strict';

    var DEFAULT_LIMIT = 5;

    // Выполнить thunks (функции, возвращающие Promise) пулом. Первая ошибка останавливает подачу
    // новых задач и возвращается наружу: молча терять часть массовой записи нельзя.
    // → Promise<Array> с результатами в порядке ИСХОДНОГО массива, а не завершения.
    function runWithConcurrency(thunks, limit) {
        var tasks = Array.isArray(thunks) ? thunks.slice() : [];
        var max = Math.max(1, Math.min(Number(limit) || DEFAULT_LIMIT, tasks.length || 1));
        var results = new Array(tasks.length);
        return new Promise(function (resolve, reject) {
            if (!tasks.length) { resolve(results); return; }
            var next = 0, active = 0, failed = false, firstError = null, settled = false;
            function settle() {
                if (settled) return;
                settled = true;
                if (firstError) reject(firstError); else resolve(results);
            }
            // Запуск ОДНОЙ задачи вынесен в функцию намеренно: `var` в цикле делится между
            // замыканиями, и результат уезжал бы в ячейку последней запущенной задачи.
            function start(idx) {
                active += 1;
                Promise.resolve().then(tasks[idx]).then(function (res) {
                    results[idx] = res; active -= 1; pump();
                }, function (err) {
                    failed = true; if (!firstError) firstError = err;
                    active -= 1; pump();
                });
            }
            function pump() {
                if (settled) return;
                if (active === 0 && (failed || next >= tasks.length)) { settle(); return; }
                while (!failed && active < max && next < tasks.length) start(next++);
            }
            pump();
        });
    }

    // Обернуть транспортную функцию семафором: сколько бы пулов её ни звало, одновременно
    // выполняется не больше `max` вызовов. Возвращает функцию с тем же интерфейсом.
    function limiter(fn, max) {
        var cap = Math.max(1, Number(max) || DEFAULT_LIMIT);
        var active = 0, queue = [];
        function release() {
            active -= 1;
            var nextRun = queue.shift();
            if (nextRun) nextRun();
        }
        return function () {
            var self = this, args = arguments;
            return new Promise(function (resolve, reject) {
                function run() {
                    active += 1;
                    Promise.resolve().then(function () { return fn.apply(self, args); })
                        .then(function (res) { release(); resolve(res); },
                              function (err) { release(); reject(err); });
                }
                if (active < cap) run(); else queue.push(run);
            });
        };
    }

    var api = { runWithConcurrency: runWithConcurrency, limiter: limiter, DEFAULT_LIMIT: DEFAULT_LIMIT };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (typeof window !== 'undefined') window.IntegramBatch = api;
})();
