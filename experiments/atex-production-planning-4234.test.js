// Tests for ideav/crm#4234 — «Разное поведение в EDGE и Chrome — разные результаты».
//
// Корень (детерминированный, не гонка и не кэш): план стабильно расходился по браузерам,
// потому что в EDGE активна сессия/роль БЕЗ READ-гранта на «Максимальный запас» и «Календарь».
// Сервер (index.php, `case "&uni_obj"`) на чтение без гранта делал `break` → отдавал ПУСТО,
// БЕЗ ошибки. Клиентские загрузчики этот пустой ответ (или ошибку) ГЛУШИЛИ в `.catch` и
// молча продолжали с пустым справочником → план уходил в просрочку.
//
// Фикс #4234:
//  • Сервер: API-чтение (`isApi()`) без READ-гранта → `my_die(...403 Forbidden)` вместо `break`
//    (внятная ошибка `[{"error":…}]`, а не пусто). HTML-UI сохраняет мягкое поведение.
//  • Клиент: loadCalendar / loadMaxStock больше НЕ глушат ошибку чтения — пробрасывают её
//    (init → fatal), а не строят план на неполных данных. Тихая деградация исключена.
//
// Здесь проверяем клиентскую часть (серверная — PHP, юнит-тестом не покрывается).
// Run with: node experiments/atex-production-planning-4234.test.js

process.env.TZ = 'UTC';
var api = require('../download/atex/js/production-planning.js');
var Controller = api.Controller;

var passed = 0, planned = 0;
function ok(cond, name) { planned++; console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name); if (cond) passed++; else process.exitCode = 1; }

function ctrlWithMeta(meta) {
    var c = Object.create(Controller.prototype);
    c.meta = meta;
    return c;
}
var DENY = function () { return Promise.reject(new Error('У вас нет доступа на чтение этой таблицы (123)')); };

// Собираем цепочку проверок последовательно, каждая возвращает Promise.
var checks = [];

// ── loadCalendar ──
checks.push(function () {
    var c = ctrlWithMeta({ calendar: { id: 123, reqs: [] } });
    c.getJson = DENY;
    return c.loadCalendar().then(
        function () { ok(false, '#4234 loadCalendar: отказ чтения при наличии meta ДОЛЖЕН пробрасываться (а не resolve)'); },
        function (err) {
            ok(/Календар/i.test(err && err.message), '#4234 loadCalendar: отказ чтения пробрасывается с именем «Календарь» (' + (err && err.message) + ')');
        }
    );
});
checks.push(function () {
    var c = ctrlWithMeta({});   // нет meta.calendar → фича выключена
    c.getJson = function () { ok(false, '#4234 loadCalendar: без meta не должно быть чтения'); return Promise.resolve([]); };
    return c.loadCalendar().then(
        function () { ok(true, '#4234 loadCalendar: без meta.calendar — тихий resolve (фича выключена, не роняем)'); },
        function () { ok(false, '#4234 loadCalendar: без meta.calendar НЕ должен падать'); }
    );
});

// ── loadMaxStock ──
checks.push(function () {
    var c = ctrlWithMeta({ maxStock: { id: 456, reqs: [] } });
    c.getJson = DENY;
    return c.loadMaxStock().then(
        function () { ok(false, '#4234 loadMaxStock: отказ чтения при наличии meta ДОЛЖЕН пробрасываться (а не resolve)'); },
        function (err) {
            ok(/Максимальный запас/i.test(err && err.message), '#4234 loadMaxStock: отказ чтения пробрасывается с именем «Максимальный запас» (' + (err && err.message) + ')');
        }
    );
});
checks.push(function () {
    var c = ctrlWithMeta({});   // нет meta.maxStock → фича выключена
    c.getJson = function () { ok(false, '#4234 loadMaxStock: без meta не должно быть чтения'); return Promise.resolve([]); };
    return c.loadMaxStock().then(
        function () { ok(true, '#4234 loadMaxStock: без meta.maxStock — тихий resolve (фича выключена, не роняем)'); },
        function () { ok(false, '#4234 loadMaxStock: без meta.maxStock НЕ должен падать'); }
    );
});

checks.reduce(function (p, fn) { return p.then(fn); }, Promise.resolve())
    .then(function () { console.log('\n' + passed + '/' + planned + ' проверок пройдено'); });
