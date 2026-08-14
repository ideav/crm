// issue #4631: «ЗАДАЧИ НА ВТУЛКИ» НЕ КОПЯТСЯ ДУБЛЯМИ.
//
// Боевое (ateh, 06.08.2026): 574 задачи при 212 позициях, 67 086 лишних втулок. Заказ 4285
// (позиция 626023) — 18 задач на 11 376 втулок при заказе 1264, девять комплектов подряд.
//
// ПРИЧИНА. Таблица «Задача на втулки» подчинена ПОЗИЦИИ, а запись создаётся при создании
// ЗАДАНИЯ; связи «задача ↔ задание» в схеме нет. Оба места создания писали безусловный `_m_new`
// без поиска существующей, а `_m_del` по этой таблице в коде не было вовсе: снос задания уносит
// «Обеспечение» и «Партию ГП», задача остаётся сиротой. Каждая перегенерация клала НОВЫЙ полный
// комплект поверх старого.
//
// ПРАВИЛО (одно на всех потребителей, чистая функция `planSleeveTaskReconcile`): набор задач
// позиции повторяет ЗВЕНЬЯ резки — по задаче на звено, «Кол-во» = доле обеспечения звена, а Σ
// равна заказанному количеству (втулка нужна каждому рулону). Задача с «Начато»/«Закончено»/
// «Кол-во факт» — сделанная работа: не удаляется НИКОГДА.
//
//   A — РЕПРО 4288: 12 задач (4 старых по 660 + 4 поколения 352+308) → остаётся свежая пара;
//   B — РЕПРО 4285: 18 задач при звеньях 1088+176 → остаются ровно они;
//   C — идемпотентность: набор уже верный → ни удалений, ни созданий (второй прогон не «чинит»);
//   D — ВЫПОЛНЕННОЕ неприкосновенно: задача с фактом остаётся даже будучи лишней;
//   E — недостающая задача создаётся (звено есть, задачи нет);
//   F — СТРАХОВКА: у позиции нет звеньев → не трогаем ничего (иначе снесли бы живой спрос);
//   G — СТРАХОВКА: звенья не сходятся с заказом (историческое) → не трогаем ничего;
//   H — всё уже сделано выполненными задачами → новых не заводим.
//
// Пункты F/G — не перестраховка задним числом: разовая чистка этих же данных с критерием
// «оставить совпадающие с заданиями» снесла бы 441 задачу из 448 и оставила 87 позиций с НУЛЁМ
// втулок при живом спросе. Правило обязано молчать там, где не уверено.
//
// Run with: node experiments/atex-pp-4631-sleeve-dedup.test.js

process.env.TZ = 'UTC';
global.window = { db: 'ateh', xsrf: 'x' };
var P = require('../download/atex/js/production-planning.js').planning;

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}
function T(id, qty, ts, touched) { return { id: id, qty: qty, plannedTs: ts || 0, touched: !!touched }; }
function L(qty, ts) { return { qty: qty, plannedTs: ts || 0 }; }
function kept(r, tasks) {
    return r.keep.map(function (id) {
        for (var i = 0; i < tasks.length; i++) if (tasks[i].id === id) return tasks[i].qty;
        return null;
    }).sort(function (a, b) { return a - b; });
}

// ── A. Боевой 4288: заказ 660, звенья 352+308, четыре поколения задач + четыре ранних по 660.
(function () {
    var tasks = [T(626675, 660), T(627450, 660), T(628055, 660), T(629834, 660),
                 T(634559, 352), T(634585, 308), T(636743, 352), T(636776, 308),
                 T(638894, 352), T(638950, 308), T(641136, 352), T(641183, 308)];
    var r = P.planSleeveTaskReconcile(660, tasks, [L(352, 100), L(308, 200)]);
    assert(String(r.keep.sort()) === String([641136, 641183]) && r.drop.length === 10 && !r.create.length,
        'A: 4288 — остаётся СВЕЖАЯ пара 352+308, снято 10 дублей',
        JSON.stringify({ keep: r.keep, drop: r.drop.length }));
})();

// ── B. Боевой 4285: заказ 1264, звенья 1088+176, 18 задач вперемешку.
(function () {
    var tasks = [T(626684, 408), T(626767, 856), T(627478, 136), T(627554, 1128), T(628165, 168),
                 T(628192, 1096), T(629822, 544), T(629975, 720), T(631331, 744), T(631352, 520),
                 T(634603, 176), T(634607, 1088), T(636790, 1088), T(636805, 176), T(638938, 1088),
                 T(638974, 176), T(641228, 176), T(641233, 1088)];
    var r = P.planSleeveTaskReconcile(1264, tasks, [L(1088, 100), L(176, 200)]);
    assert(String(kept(r, tasks)) === String([176, 1088]) && r.drop.length === 16,
        'B: 4285 — из 18 задач остаются ровно звенья 1088+176', JSON.stringify(kept(r, tasks)));
})();

// ── C. Идемпотентность: набор уже верный — не трогаем ничего.
(function () {
    var tasks = [T(1, 352, 100), T(2, 308, 200)];
    var r = P.planSleeveTaskReconcile(660, tasks, [L(352, 100), L(308, 200)]);
    assert(!r.drop.length && !r.create.length && r.keep.length === 2,
        'C: верный набор второй раз НЕ «чинится» (нет ни удалений, ни созданий)', JSON.stringify(r));
})();

// ── D. Выполненная задача неприкосновенна, даже когда лишняя.
(function () {
    var tasks = [T(1, 424, 100, true), T(2, 576, 200), T(3, 1000, 300), T(4, 1000, 400)];
    var r = P.planSleeveTaskReconcile(1000, tasks, [L(424, 100), L(576, 200)]);
    assert(r.keep.indexOf(1) >= 0 && r.drop.indexOf(1) < 0,
        'D: задача с фактом остаётся (боевой 4461: 424 закончена + 576)', JSON.stringify(r));
    assert(String(r.drop.sort()) === String([3, 4]),
        'D2: снимаются только лишние нетронутые (две по 1000)', JSON.stringify(r.drop));
})();

// ── E. Недостающая задача создаётся: звено есть, задачи под него нет.
(function () {
    var tasks = [T(1, 352, 100)];
    var r = P.planSleeveTaskReconcile(660, tasks, [L(352, 100), L(308, 200)]);
    assert(r.create.length === 1 && r.create[0].qty === 308 && r.create[0].plannedTs === 200,
        'E: под звено без задачи задача СОЗДАЁТСЯ (308 на плановом старте звена)', JSON.stringify(r.create));
})();

// ── F. Нет звеньев вовсе — не трогаем ничего (позиция ещё без заданий).
(function () {
    var tasks = [T(1, 100), T(2, 100)];
    var r = P.planSleeveTaskReconcile(100, tasks, []);
    assert(!r.drop.length && !r.create.length && r.keep.length === 2 && /нет звеньев/.test(r.reason),
        'F: у позиции нет звеньев — набор НЕ трогаем', r.reason);
})();

// ── G. Звенья не сходятся с заказом (историческое) — не трогаем ничего.
(function () {
    var tasks = [T(1, 40), T(2, 40)];
    var r = P.planSleeveTaskReconcile(180, tasks, [L(40, 100)]);     // боевой 4442: задачи 40/40 при заказе 180
    assert(!r.drop.length && !r.create.length && /не сходится с заказом/.test(r.reason),
        'G: звенья не сходятся с заказом — набор НЕ трогаем (4442)', r.reason);
})();

// ── H. Всё закрыто выполненными — новых не заводим, лишние нетронутые снимаем.
(function () {
    var tasks = [T(1, 660, 100, true), T(2, 660, 200)];
    var r = P.planSleeveTaskReconcile(660, tasks, [L(660, 100)]);
    assert(r.keep.length === 1 && r.keep[0] === 1 && String(r.drop) === '2' && !r.create.length,
        'H: спрос закрыт выполненной задачей — дубль снят, новых нет', JSON.stringify(r));
})();

// ── I. Правило зовут ВСЕ пути удаления — иначе фикс наполовину.
//
// ПРОВЕРЯЕТСЯ ПОВЕДЕНИЕМ, А НЕ ТЕКСТОМ. Раньше здесь стоял счётчик вхождений
// `self.reconcileSleeveTasks(` в исходнике (`calls === 2`). Такая проверка не видит, ЧТО код
// делает: число 2 спокойно уживалось с тем, что путь удаления ДНЯ разбор не звал вовсе, а его
// вызов стоял в соседней функции, где переменной не существовало, — `ReferenceError` на каждом
// удалении (issue #4753). Текстовая проверка молчала о дефекте и краснела бы от рефакторинга.
// Теперь оба пути удаления ПРОГОНЯЮТСЯ, и правило считается соблюдённым, когда разбор ПОЛУЧИЛ
// позиции удалённых звеньев.
(function () {
    var Controller = require('../download/atex/js/production-planning.js').Controller;
    function stand() {
        var s = Object.create(Controller.prototype);
        s.busy = false; s.cuts = []; s.slitters = []; s.got = [];
        s.supplies = [{ id: 'S1', cutId: '100', positionId: 'P1' },
                      { id: 'S2', cutId: '101', positionId: 'P2' }];
        s.post = function () { return Promise.resolve({}); };
        s.reload = function () { return Promise.resolve(); };
        s.render = function () {};
        s.notify = function () {};
        s.updateProgress = function () {};
        s.setBusy = function () {};
        s.showProgress = function () {};
        s.hideProgress = function () {};
        s.autoSequenceQueue = function () { return Promise.resolve(true); };
        s.reconcileOrphanOrderSupplies = function () { return Promise.resolve(0); };
        s.levelOverfilledAfterWrite = function (x, r) { return Promise.resolve(r); };
        s.reconcileSleeveTasks = function (ids) { s.got.push((ids || []).slice()); return Promise.resolve(); };
        return s;
    }
    assert(typeof Controller.prototype.reconcileSleeveTasks === 'function',
        'I: reconcileSleeveTasks определён на прототипе');

    var byTask = stand(), byDay = stand();
    Promise.all([
        byTask.runDeleteCutTask(['100', '101'], ['S1', 'S2'], 'x'),
        byDay.runDeleteDayTasks([{ id: '100' }, { id: '101' }], [{ id: 'S1' }, { id: 'S2' }], 'Чт')
    ]).then(function () {
        assert(byTask.got.length === 1 && String((byTask.got[0] || []).slice().sort()) === String(['P1', 'P2']),
            'I2: удаление ЗАДАНИЯ отдаёт разбору позиции удалённых звеньев',
            JSON.stringify(byTask.got));
        assert(byDay.got.length === 1 && String((byDay.got[0] || []).slice().sort()) === String(['P1', 'P2']),
            'I3: удаление ДНЯ — тоже (путь, который молчал до #4753)',
            JSON.stringify(byDay.got));
        console.log('\n' + passed + '/' + total + ' пройдено');
        if (passed !== total) process.exitCode = 1;
    }).catch(function (e) {
        console.error('FAIL — исключение: ' + (e && e.stack || e));
        process.exitCode = 1;
    });
})();
// Итог печатается внутри блока I — он асинхронный, и до его конца счётчики не полны.
