// #4753 — «Ошибка удаления задания: sleevePositionIds is not defined».
//
// СИМПТОМ (боевое, ateh1). Оператор удаляет задание — вместо удаления красное
// «Ошибка удаления задания: sleevePositionIds is not defined».
//
// ПРИЧИНА. Правило #4631 («задание ушло — „Задачи на втулки“ его позиций приводим к оставшемуся
// плану») дописали в ДВА пути удаления, но переменную завели только в одном:
//   • `runDeleteDayTasks` — объявляет `var sleevePositionIds` и заполняет её ДО удаления;
//   • `runDeleteCutTask`  — НЕ объявляет, но в хвосте зовёт `reconcileSleeveTasks(sleevePositionIds)`.
// В браузере (строгий разбор модуля) это `ReferenceError` на КАЖДОМ удалении задания, причём
// падает оно уже ПОСЛЕ того, как записи снесены: обеспечения и резки удалены, а `reload`/`render`
// и разбор втулок не выполнены — оператор видит ошибку и старый экран.
//
// ПОЧЕМУ ЭТО НЕ ПОЙМАЛ ТЕСТ #4631. Он проверяет ИСХОДНЫЙ ТЕКСТ регуляркой
// (`/#4631[\s\S]{0,400}sleevePositionIds/`) — то есть что нужные слова в файле есть. Слова есть в
// первом пути; второй путь такой проверкой не покрыт вовсе. Тест на текст не видит, из какой
// функции переменная видна.
//
// ЧТО ПРОВЕРЯЕМ (по ОБОИМ путям удаления, чтобы правило #4631 не разъехалось снова):
//   A — удаление ЗАДАНИЯ доходит до конца без исключения;
//   B — и зовёт разбор втулок по позициям удалённых звеньев;
//   C — позиции собраны ДО удаления (после него связь потеряна) и без дублей;
//   D — удаление ДНЯ (второй путь) продолжает работать так же;
//   E — записи действительно удалены: обеспечения и вся цепочка;
//   F — нет `reconcileSleeveTasks` (стаб-self старых тестов) — удаление всё равно доходит до конца.
//
// Run with: node experiments/atex-pp-4753-delete-cut-sleeve-ids.test.js
//
// rules: none (defect #4753)

process.env.TZ = 'UTC';
global.window = { db: 'ateh1', xsrf: 'x' };
var Controller = require('../download/atex/js/production-planning.js').Controller;

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

// Стенд: контроллер с настоящим прототипом, но без сети и DOM. `post` только записывает вызовы.
function stand(opts) {
    var self = Object.create(Controller.prototype);
    self.deleted = [];
    self.sleeveCalls = [];
    self.notices = [];
    self.busy = false;
    self.cuts = [];
    self.slitters = [];
    // Обеспечения: два звена цепочки (голова 100 и продолжение 101) выпускают позиции P1 и P2,
    // причём P1 покрыта обоими — проверяем, что дублей в наборе не будет.
    self.supplies = [
        { id: 'S1', cutId: '100', positionId: 'P1' },
        { id: 'S2', cutId: '100', positionId: 'P2' },
        { id: 'S3', cutId: '101', positionId: 'P1' },
        { id: 'S4', cutId: '999', positionId: 'P9' }   // чужое задание — попасть в набор не должно
    ];
    self.post = function(path) {
        self.deleted.push(String(path).replace(/^_m_del\//, '').replace(/\?JSON$/, ''));
        return Promise.resolve({});
    };
    self.reload = function() { return Promise.resolve(); };
    self.render = function() {};
    self.notify = function(msg, kind) { self.notices.push({ msg: msg, kind: kind }); };
    self.updateProgress = function() {};
    self.setBusy = function(v) { self.busy = !!v; };
    // Рамку действия открывает `actionBegin` ЧЕРЕЗ ПРОТОТИП (#4742), поэтому переопределять
    // `beginAction` бесполезно — глушим то, что она зовёт: окно прогресса.
    self.showProgress = function() {};
    self.hideProgress = function() {};
    self.reconcileSleeveTasks = function(ids) {
        self.sleeveCalls.push((ids || []).slice());
        return Promise.resolve();
    };
    // Хвост удаления пересобирает очередь — на стенде это не предмет проверки.
    self.autoSequenceQueue = function() { return Promise.resolve(true); };
    self.reconcileOrphanOrderSupplies = function() { return Promise.resolve(0); };
    self.levelOverfilledAfterWrite = function(x, r) { return Promise.resolve(r); };
    for (var k in (opts || {})) self[k] = opts[k];
    return self;
}

var failures = [];
function guard(label, fn) {
    return Promise.resolve().then(fn).catch(function(e) {
        failures.push(label + ': ' + (e && e.message || e));
    });
}

// ── A/B/C/E. УДАЛЕНИЕ ЗАДАНИЯ (цепочка 100 + 101) ───────────────────────────────────────────
var cut = stand();
guard('удаление задания', function() {
    return cut.runDeleteCutTask(['100', '101'], ['S1', 'S2', 'S3'], 'MW411 450×9');
}).then(function() {
    assert(failures.length === 0,
        'A. удаление ЗАДАНИЯ доходит до конца без исключения (был ReferenceError)',
        failures.join('; '));
    assert(cut.sleeveCalls.length === 1,
        'B. разбор «Задач на втулки» вызван ровно один раз',
        'вызовов: ' + cut.sleeveCalls.length);
    var ids = (cut.sleeveCalls[0] || []).slice().sort();
    assert(String(ids) === String(['P1', 'P2']),
        'C. позиции собраны ДО удаления, без дублей и без чужих',
        'передано: ' + JSON.stringify(cut.sleeveCalls[0] || null));
    assert(cut.deleted.indexOf('S1') >= 0 && cut.deleted.indexOf('S3') >= 0
           && cut.deleted.indexOf('100') >= 0 && cut.deleted.indexOf('101') >= 0,
        'E. удалены и обеспечения, и вся цепочка',
        'удалено: ' + JSON.stringify(cut.deleted));

    // ── D. УДАЛЕНИЕ ДНЯ — второй путь того же правила ───────────────────────────────────────
    var day = stand();
    var dayCuts = [{ id: '100' }, { id: '101' }];
    var daySupplies = [{ id: 'S1' }, { id: 'S2' }, { id: 'S3' }];
    return guard('удаление дня', function() {
        return day.runDeleteDayTasks(dayCuts, daySupplies, 'Чт, 13.08.2026');
    }).then(function() {
        assert(failures.length === 0, 'D. удаление ДНЯ по-прежнему доходит до конца', failures.join('; '));
        var dids = ((day.sleeveCalls[0]) || []).slice().sort();
        assert(day.sleeveCalls.length === 1 && String(dids) === String(['P1', 'P2']),
            'D2. и тоже разбирает втулки по позициям удалённых звеньев',
            'передано: ' + JSON.stringify(day.sleeveCalls[0] || null));
    });
}).then(function() {
    // ── F. СТАРЫЙ СТАБ БЕЗ reconcileSleeveTasks ─────────────────────────────────────────────
    var bare = stand({ reconcileSleeveTasks: undefined });
    delete bare.reconcileSleeveTasks;
    var before = failures.length;
    return guard('стаб без reconcileSleeveTasks', function() {
        return bare.runDeleteCutTask(['100'], ['S1'], 'x');
    }).then(function() {
        assert(failures.length === before,
            'F. без reconcileSleeveTasks (стаб старых тестов) удаление всё равно доходит до конца',
            failures.slice(before).join('; '));
    });
}).then(function() {
    console.log('\n' + passed + '/' + total + ' проверок прошло');
    if (passed !== total) process.exitCode = 1;
}).catch(function(err) {
    console.error('FAIL — исключение стенда: ' + (err && err.stack || err));
    process.exitCode = 1;
});
