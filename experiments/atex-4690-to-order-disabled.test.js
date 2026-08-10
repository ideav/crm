// «Расчёт оптимальной резки»: кнопка «В заказ» деактивирована (ideav/crm#4690).
//
// Кнопка создавала под заказом по одной Позиции на каждую ширину (#3474) —
// единственная запись данных из этого рабочего места. Заказы из оптимизатора
// больше не заводим: кнопка остаётся на экране, но не нажимается. Модалка
// (openOrderModal) не тронута, поэтому тест держит ровно два условия — кнопка
// disabled и на ней нет обработчика клика.
//
// Проверка не по исходнику: рендерим результат расчёта на заглушках DOM и
// смотрим на настоящий узел кнопки.
//
// Run with: node experiments/atex-4690-to-order-disabled.test.js

var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..');

var passed = 0;
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) {
        passed++;
    } else {
        console.log('  expected:', JSON.stringify(expected));
        console.log('  actual:  ', JSON.stringify(actual));
        process.exitCode = 1;
    }
}
function assertTrue(cond, name) { assertEqual(!!cond, true, name); }

// ── Заглушка DOM: ровно то, чем пользуется хелпер el() рабочего места ──
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
        classList: { add: function() {}, remove: function() {}, toggle: function() {} },
        setAttribute: function(key, value) { node.attrs[key] = String(value); },
        appendChild: function(child) { node.children.push(child); return child; },
        addEventListener: function(type, fn) {
            (node.listeners[type] = node.listeners[type] || []).push(fn);
        }
    };
    return node;
}

global.document = {
    createElement: makeNode,
    createTextNode: function(text) { var n = makeNode('#text'); n.textContent = text; return n; }
};

var Controller = require('../download/atex/js/cut-optimizer.js').Controller;

function findByClass(node, cls) {
    if (!node) return null;
    if (String(node.className || '').split(/\s+/).indexOf(cls) !== -1) return node;
    for (var i = 0; i < (node.children || []).length; i++) {
        var hit = findByClass(node.children[i], cls);
        if (hit) return hit;
    }
    return null;
}

// Живой план резки: остальные секции экрана к делу не относятся и заглушены.
var ctrl = Object.create(Controller.prototype);
ctrl.viewEl = makeNode('div');
ctrl.materialId = 1;
ctrl.plan = { feasible: true, proportionKept: true, overflow: [], maps: [] };
ctrl.materialById = function() { return { label: 'ПП 880' }; };
ctrl.renderSummary = function() { return makeNode('div'); };
ctrl.renderMaps = function() { return makeNode('div'); };
ctrl.renderTable = function() { return makeNode('div'); };

ctrl.renderResult();

var btn = findByClass(ctrl.viewEl, 'atex-co-to-order');
assertTrue(btn, 'кнопка «В заказ» на экране осталась');
assertEqual(btn && btn.textContent, 'В заказ', 'подпись кнопки прежняя');
assertEqual(btn && btn.disabled, true, 'кнопка деактивирована (disabled)');
assertEqual(btn && (btn.listeners.click || []).length, 0, 'обработчика клика на кнопке нет');
assertTrue(btn && btn.title, 'у деактивированной кнопки есть подсказка, почему она не нажимается');

// Деактивированная кнопка должна и выглядеть неактивной, иначе по ней будут
// кликать и считать рабочее место сломанным.
var css = fs.readFileSync(path.join(ROOT, 'download/atex/css/cut-optimizer.css'), 'utf8');
var disabledRule = css.match(/\.atex-co-btn:disabled\s*\{([^}]*)\}/);
assertTrue(disabledRule, 'в cut-optimizer.css есть правило для .atex-co-btn:disabled');
assertTrue(disabledRule && /cursor\s*:\s*not-allowed/.test(disabledRule[1]),
    'курсор над деактивированной кнопкой — not-allowed');
assertTrue(disabledRule && /opacity\s*:/.test(disabledRule[1]),
    'деактивированная кнопка приглушена по прозрачности');

console.log('\n' + passed + ' проверок прошли');
