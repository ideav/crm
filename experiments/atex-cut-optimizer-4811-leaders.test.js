// #4811 — в «Расчёте оптимальной резки» менеджеру оставлены ЧЕТЫРЕ лидера, а не весь
// справочник «Лидер» (1132, семь записей): MONOCHROME, MONOCHROME ZNAK, Прозрачный и
// Клиентский. Список захардкожен по решению заказчика.
//
// «Клиентский» — лидер заказчика: записи в справочнике у него нет и ТОЧЕК ЗАПАСА не бывает
// (нарезать впрок под чужой лидер нечего). Поэтому при его выборе точки запаса не подбираются
// вовсе, и панель говорит почему.
//
// id записей не хардкодим: три «своих» лидера сводятся со справочником ПО ПОДПИСИ — как и все
// прочие сущности рабочего места (WORKSPACE_DEVELOPMENT_GUIDE.md, раздел 3).
//
// Run with: node experiments/atex-cut-optimizer-4811-leaders.test.js

// ── Заглушка DOM (как в atex-4690-to-order-disabled.test.js) ──────────────────────────────────
function makeNode(tag) {
    var node = {
        tagName: String(tag).toUpperCase(),
        className: '',
        textContent: '',
        innerHTML: '',
        dataset: {},
        style: {},
        attrs: {},
        children: [],
        listeners: {},
        value: '',
        classList: { add: function() {}, remove: function() {}, toggle: function() {} },
        setAttribute: function(key, value) { node.attrs[key] = String(value); },
        appendChild: function(child) { node.children.push(child); return child; },
        addEventListener: function(type, fn) { (node.listeners[type] = node.listeners[type] || []).push(fn); }
    };
    return node;
}
global.document = {
    createElement: makeNode,
    createTextNode: function(text) { var n = makeNode('#text'); n.textContent = text; return n; }
};

var mod = require('../download/atex/js/cut-optimizer.js');
var core = mod.core;
var Controller = mod.Controller;

var passed = 0, total = 0;
function assert(cond, name) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    total++;
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; return; }
    console.log('  expected:', JSON.stringify(expected));
    console.log('  actual:  ', JSON.stringify(actual));
    process.exitCode = 1;
}
// Собрать весь видимый текст поддерева.
function textOf(node) {
    if (!node) return '';
    var own = String(node.textContent || '');
    return own + (node.children || []).map(textOf).join(' ');
}
function findAllByClass(node, cls, acc) {
    acc = acc || [];
    if (!node) return acc;
    if (String(node.className || '').split(/\s+/).indexOf(cls) !== -1) acc.push(node);
    (node.children || []).forEach(function(c) { findAllByClass(c, cls, acc); });
    return acc;
}

// Боевой справочник «Лидер» (1132) — семь записей, из которых менеджеру нужны три.
var LEADERS = [
    { id: '66410', label: 'Прозрачный' },
    { id: '66411', label: 'Софмикс' },
    { id: '66412', label: 'Этикетка37' },
    { id: '66413', label: 'Глобал Принтинг' },
    { id: '66414', label: 'MONOCHROME' },
    { id: '81124', label: 'MONOCHROME ZNAK' },
    { id: '119942', label: 'Глобал' }
];

// ── Список из четырёх лидеров ─────────────────────────────────────────────────────────────────
assertEqual(core.optimizerLeaders().map(function(o) { return o.label; }),
    ['MONOCHROME', 'MONOCHROME ZNAK', 'Прозрачный', 'Клиентский'],
    '#4811: в калькуляторе ровно четыре лидера, в порядке из тикета');

assertEqual(core.CLIENT_LEADER, 'Клиентский',
    '#4811: «Клиентский» назван одной константой — по ней его и узнают');

assert(core.isClientLeader('Клиентский') === true,
    '#4811: «Клиентский» опознаётся');
assert(core.isClientLeader('  клиентский  ') === true,
    '#4811: регистр и пробелы опознанию не мешают');
assert(core.isClientLeader('MONOCHROME') === false,
    '#4811: свой лидер клиентским не считается');
assert(core.isClientLeader('') === false,
    '#4811: лидер не выбран — это ещё не «Клиентский»');

// ── Сведение со справочником по подписи (id не хардкодим) ─────────────────────────────────────
assertEqual((core.resolveLeader(LEADERS, 'MONOCHROME') || {}).id, '66414',
    '#4811: MONOCHROME сведён со справочником по подписи');
assertEqual((core.resolveLeader(LEADERS, 'MONOCHROME ZNAK') || {}).id, '81124',
    '#4811: MONOCHROME ZNAK — отдельная запись, не путается с MONOCHROME');
assertEqual((core.resolveLeader(LEADERS, 'Прозрачный') || {}).id, '66410',
    '#4811: Прозрачный сведён со справочником');
assertEqual((core.resolveLeader(LEADERS, ' monochrome ') || {}).id, '66414',
    '#4811: сведение не зависит от регистра и пробелов');
assertEqual(core.resolveLeader(LEADERS, 'Клиентский'), null,
    '#4811: у «Клиентского» записи в справочнике нет — и подставлять чужую нельзя');
assertEqual(core.resolveLeader(LEADERS, ''), null,
    '#4811: лидер не выбран — записи нет');
assertEqual(core.resolveLeader([], 'MONOCHROME'), null,
    '#4811: справочник не прочитался — записи нет, но разбор не падает');

// ── Точки запаса ──────────────────────────────────────────────────────────────────────────────
// Точки боевого вида: ссылочные поля приходят как { id, label }.
function point(width, leader) {
    return {
        id: 'p' + width, width: width, length: 450, winding: 'OUT',
        material: { id: '202', label: 'MW308' },
        sleeve: { id: '', label: '' },
        leader: leader,
        limit: 10
    };
}
var MONO = { id: '66414', label: 'MONOCHROME' };
var CLEAR = { id: '66410', label: 'Прозрачный' };

function makeController(leaderLabel) {
    var inst = Object.create(Controller.prototype);
    inst.stockEl = makeNode('div');
    inst.meta = { maxStock: { id: '671' } };
    inst.stockLoadFailed = false;
    inst.stockPoints = [point(100, MONO), point(120, CLEAR)];
    inst.materialId = '202';
    inst.materialById = function() { return { id: '202', label: 'MW308' }; };
    inst.lengthValue = '450';
    inst.lengthInput = null;
    inst.windingValue = 'OUT';
    inst.sleeveInches = '';
    inst.sleeveMaterialId = '';
    inst.sleeves = [];
    inst.leaders = LEADERS;
    inst.leaderLabel = leaderLabel;
    inst.rows = [];
    return inst;
}

(function() {
    var inst = makeController('MONOCHROME');
    inst.renderStockPoints();
    var rows = findAllByClass(inst.stockEl, 'atex-co-stock-point');
    assertEqual(rows.length, 1, '#4811: под свой лидер точки запаса подбираются');
    assert(textOf(rows[0]).indexOf('100') !== -1,
        '#4811: подобрана точка именно этого лидера');
})();

(function() {
    var inst = makeController(core.CLIENT_LEADER);
    inst.renderStockPoints();
    var rows = findAllByClass(inst.stockEl, 'atex-co-stock-point');
    assertEqual(rows.length, 0,
        '#4811: при «Клиентском» точки запаса не подбираются вовсе');
    var hints = findAllByClass(inst.stockEl, 'atex-co-stock-hint');
    assert(hints.length > 0, '#4811: панель не молчит — объясняет, почему точек нет');
    var said = hints.map(textOf).join(' ').toLowerCase();
    assert(said.indexOf('клиентск') !== -1,
        '#4811: в объяснении назван клиентский лидер, а не «ничего не нашлось»');
})();

(function() {
    // Лидер не выбран — прежнее поведение: точки подбираются по остальным параметрам.
    var inst = makeController('');
    inst.renderStockPoints();
    var rows = findAllByClass(inst.stockEl, 'atex-co-stock-point');
    assertEqual(rows.length, 2,
        '#4811: лидер не выбран — по нему не фильтруем (обе точки видны)');
})();

console.log('\n' + passed + '/' + total + ' проверок прошли');
if (passed !== total) process.exitCode = 1;
