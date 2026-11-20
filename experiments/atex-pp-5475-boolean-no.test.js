// rules: none (defect #5475)
// ideav/crm#5475: «снимаю фиксацию на одном — ставится на соседнем». С #5442 ядро хранит
// у BOOLEAN «нет» явным "-1" (и отдаёт его в API), а "1" — «да», пусто — «не задано».
// Флаг, снятый записью '0', читается обратно как "-1"; разбор «непусто = да» превращал
// его в «да» — задание после перезагрузки снова 🔒. Тот же разбор — у «На склад» полосы,
// «В работе» партии сырья в слиттере и «Зафиксировано» задания высечки.
//
// Run with: node experiments/atex-pp-5475-boolean-no.test.js

var PP = require('../download/atex/js/production-planning.js');
var Slitter = require('../download/atex/js/slitter.js').core;
var Die = require('../download/atex-p2/js/die-planning-core.js').core;
var Opt = require('../download/atex/js/cut-optimizer.js').core;
// Склад — браузерный модуль: грузим в песочнице, помощники в window.AtexWarehouseTesting.
var Wh = (function() {
    var fs = require('fs'), path = require('path'), vm = require('vm');
    var file = path.join(__dirname, '..', 'download', 'atex', 'js', 'warehouse.js');
    var doc = { readyState: 'loading', addEventListener: function() {} };
    var sb = { window: { document: doc }, document: doc, console: console, URLSearchParams: URLSearchParams,
               URL: URL, Date: Date, setTimeout: setTimeout, clearTimeout: clearTimeout };
    sb.window.window = sb.window;
    vm.runInNewContext(fs.readFileSync(file, 'utf8'), sb, { filename: file });
    return sb.window.AtexWarehouseTesting;
})();
var LO = require('../download/atex-p2/js/label-orders.js').core;

var passed = 0, failed = 0;
function assert(cond, name, extra) {
    if (cond) { passed++; console.log('PASS — ' + name); }
    else { failed++; process.exitCode = 1; console.log('FAIL — ' + name + (extra ? ' ' + extra : '')); }
}

// ── 1. Планирование: loadCutSequences — «Зафиксировано» из object/?JSON_OBJ ──
(function() {
    var c = Object.create(PP.Controller.prototype);
    c.meta = { cut: { id: '1078', reqs: [{ id: '81530', val: 'Зафиксировано' }] } };
    c.getJson = function() {
        return Promise.resolve([
            { i: 'YES', r: ['p', '1'] },
            { i: 'NO', r: ['p', '-1'] },
            { i: 'UNSET', r: ['p', ''] },
            { i: 'NULL', r: ['p', null] }
        ]);
    };
    c.loadCutSequences().then(function(res) {
        assert(res.fixed.YES === true, 'планирование: "1" — зафиксировано');
        assert(res.fixed.NO === false, 'планирование: "-1" (снята фиксация) — НЕ зафиксировано', '(got ' + res.fixed.NO + ')');
        assert(res.fixed.UNSET === false && res.fixed.NULL === false, 'планирование: пусто/null — не зафиксировано');
    });
})();

// ── 2. Слиттер: «В работе» партии сырья ──
(function() {
    assert(Slitter.isActiveBatch({ active: '1' }) === true, 'слиттер: партия "1" — активна');
    assert(Slitter.isActiveBatch({ active: '-1' }) === false, 'слиттер: партия "-1" — НЕ активна');
})();

// ── 3. Высечка: flagOn и «Зафиксировано» задания ──
(function() {
    assert(Die.flagOn('1') === true, 'высечка: "1" — да');
    assert(Die.flagOn('-1') === false, 'высечка: "-1" — нет');
    assert(Die.flagOn(-1) === false, 'высечка: число -1 — нет');
    assert(Die.flagOn('') === false && Die.flagOn(null) === false, 'высечка: пусто — нет');
})();

// ── 4. Склад ГП: «В работе» партии ──
(function() {
    assert(Wh.isActiveBatch({ values: { active: '1' } }) === true, 'склад: партия "1" — в работе');
    assert(Wh.isActiveBatch({ values: { active: '-1' } }) === false, 'склад: партия "-1" — НЕ в работе');
})();

// ── 5. Оптимизатор резки: «Для расчета резки» вида сырья ──
(function() {
    var list = [{ id: 'A', cutFlag: '1' }, { id: 'B', cutFlag: '-1' }, { id: 'C', cutFlag: '' }, { id: 'D', cutFlag: 'X' }];
    var ids = Opt.materialsForCutting(list, true).map(function(m) { return m.id; }).join(',');
    assert(ids === 'A,D', 'оптимизатор: в расчёт только "1"/"X", "-1" и пусто — нет', '(got ' + ids + ')');
})();

// ── 6. Заказы этикетки: bool (ИТС нужен/подтверждено, «Выбираемо» состояния ножа) ──
(function() {
    assert(LO.bool('1') === true && LO.bool('X') === true, 'этикетка: "1"/"X" — да');
    assert(LO.bool('-1') === false, 'этикетка: "-1" — нет');
})();

setTimeout(function() { console.log('\n' + passed + ' passed, ' + failed + ' failed'); }, 50);
