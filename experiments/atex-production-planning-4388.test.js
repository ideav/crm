// Unit test for ideav/crm#4388 — «Планирование производства».
// Неустойчивый дефект: после снятия/постановки фиксации кнопка 🔒 (и замок карточки)
// иногда не меняла состояние до перезагрузки страницы. Причина: reload() читает флаг
// «Зафиксировано» через object/{cut}/?JSON_OBJ, и это чтение сразу после _m_set изредка
// отдаёт СТАРОЕ значение (реплика/кеш отчёта отстаёт от записи). Фикс: после успешных
// _m_set применяем записанное value к затронутым резкам поверх отставшего чтения.
//
// Тест эмулирует «отстающий» reload (флаг НЕ изменился) и проверяет, что после
// setCutsFixed затронутая резка всё равно имеет fixed = записанному value и что render()
// вызывается уже с исправленным значением.
//
// Run with: node experiments/atex-production-planning-4388.test.js

var Controller = require('../download/atex/js/production-planning.js').Controller;

var passed = 0, failed = 0;
function assert(cond, name) {
    if (cond) { passed++; console.log('PASS — ' + name); }
    else { failed++; process.exitCode = 1; console.log('FAIL — ' + name); }
}

// Строит контроллер с заглушками I/O. staleReload=true → reload перечитывает резки,
// но флаг fixed НЕ меняет (эмуляция отстающего object/-чтения после записи).
function makeController(initialCuts, staleReload) {
    var c = Object.create(Controller.prototype);
    c.busy = false;
    c.meta = { cut: { id: 1078, reqs: [{ id: 81530, val: 'Зафиксировано' }] } };
    c.cuts = initialCuts.map(function(x) { return { id: x.id, fixed: x.fixed }; });
    c._snapshotAtInitial = initialCuts.map(function(x) { return { id: x.id, fixed: x.fixed }; });
    c.posted = [];
    c.renderFixedSeen = null;   // снимок fixed на момент render()

    c.post = function(path, fields) { c.posted.push({ path: path, fields: fields }); return Promise.resolve({}); };
    // reload перечитывает список НОВЫМИ объектами; при staleReload флаг остаётся старым
    c.reload = function() {
        c.cuts = c._snapshotAtInitial.map(function(x) { return { id: x.id, fixed: x.fixed }; });
        return Promise.resolve();
    };
    c.computeCutSetupUpdates = function() { return { reqs: {}, updates: [] }; };
    c.setBusy = function(on) { c.busy = !!on; };
    c.showProgress = function() {};
    c.updateProgress = function() {};
    c.hideProgress = function() {};
    c.notify = function() {};
    c.render = function() {
        c.renderFixedSeen = c.cuts.map(function(x) { return { id: String(x.id), fixed: x.fixed }; });
    };
    return c;
}

function findFixed(list, id) {
    for (var i = 0; i < list.length; i++) if (String(list[i].id) === String(id)) return list[i].fixed;
    return undefined;
}

// ── СНЯТИЕ фиксации при отстающем reload ──
(function() {
    var c = makeController([{ id: '10', fixed: true }, { id: '20', fixed: false }], true);
    return c.setCutsFixed(['10'], false, { silent: true }).then(function(ok) {
        assert(ok === true, 'снятие: setCutsFixed резолвится true');
        // записали флаг='0' в _m_set
        var f = c.posted[0] && c.posted[0].fields;
        assert(f && f.t81530 === '0', 'снятие: _m_set пишет t81530=0');
        // несмотря на отстающий reload (вернул fixed=true), в модели теперь false
        assert(findFixed(c.cuts, '10') === false, 'снятие: c.fixed скорректирован в false (не ждём F5)');
        // render() увидел уже исправленное значение
        assert(findFixed(c.renderFixedSeen, '10') === false, 'снятие: render() рисует кнопку по false');
        // соседняя нетронутая резка не изменена
        assert(findFixed(c.cuts, '20') === false, 'снятие: чужая резка не тронута');
    });
})();

// ── ПОСТАНОВКА фиксации при отстающем reload ──
(function() {
    var c = makeController([{ id: '10', fixed: false }, { id: '20', fixed: false }], true);
    return c.setCutsFixed(['10'], true, { silent: true }).then(function(ok) {
        assert(ok === true, 'фиксация: setCutsFixed резолвится true');
        var f = c.posted[0] && c.posted[0].fields;
        assert(f && f.t81530 === '1', 'фиксация: _m_set пишет t81530=1');
        assert(findFixed(c.cuts, '10') === true, 'фиксация: c.fixed скорректирован в true');
        assert(findFixed(c.renderFixedSeen, '10') === true, 'фиксация: render() рисует кнопку по true');
    });
})();

// ── Множественная фиксация: применяется ко ВСЕМ записанным id ──
(function() {
    var c = makeController([{ id: '10', fixed: false }, { id: '20', fixed: false }, { id: '30', fixed: false }], true);
    return c.setCutsFixed(['10', '30'], true, { silent: true }).then(function() {
        assert(findFixed(c.cuts, '10') === true && findFixed(c.cuts, '30') === true, 'набор: обе записанные резки true');
        assert(findFixed(c.cuts, '20') === false, 'набор: не записанная резка осталась false');
    });
})();

// финальный барьер
setTimeout(function() {
    console.log('\n' + passed + ' passed, ' + failed + ' failed');
}, 50);
