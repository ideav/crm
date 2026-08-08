// Tests for ideav/crm#4659 — кнопка «Оптимизация» в рабочем месте dash появляется
// ТОЛЬКО по явному запросу: хэш `#opti`. Без него ни кнопки, ни модалки в DOM нет.
//
//   1) грамматика флага: optiRequested('#opti') — да, '#optimize'/'#tab=X' — нет,
//      флаг живёт рядом с другими токенами хэша ('#tab=X&opti');
//   2) живой bootstrap на подставном DOM: без флага кнопка и модалка УДАЛЯЮТСЯ,
//      с флагом — остаются и получают класс показа `dash-opt-on`.
//
// Run with: node experiments/dash-optimize-gate-4659.test.js

var path = require('path');
var MODULE = path.join(__dirname, '..', 'js', 'dash-optimize.js');

var passed = 0, total = 0;
function assert(c, msg) { total++; if (!c) throw new Error('FAIL: ' + msg); passed++; }

// ── подставной DOM: ровно то, чего касается bootstrap модуля ────────────────
function fakeElement(id) {
    var classes = [];
    var node = {
        id: id,
        removed: false,
        listeners: {},
        innerHTML: '',
        classList: {
            add: function (c) { if (classes.indexOf(c) < 0) classes.push(c); },
            remove: function (c) { classes = classes.filter(function (x) { return x !== c; }); },
            contains: function (c) { return classes.indexOf(c) >= 0; }
        },
        addEventListener: function (t, fn) { (node.listeners[t] = node.listeners[t] || []).push(fn); }
    };
    node.parentNode = { removeChild: function (child) { child.removed = true; } };
    return node;
}

function loadWithHash(hash) {
    var ids = ['dash-opt-open', 'dash-opt-modal', 'dash-opt-body', 'dash-opt-close'];
    var els = {};
    ids.forEach(function (id) { els[id] = fakeElement(id); });
    var docListeners = {};
    var doc = {
        addEventListener: function (t, fn) { (docListeners[t] = docListeners[t] || []).push(fn); },
        getElementById: function (id) { return els[id] || null; }
    };
    var win = { location: { hash: hash }, document: doc };

    var prevWin = global.window, prevDoc = global.document;
    global.window = win; global.document = doc;
    try {
        delete require.cache[require.resolve(MODULE)];
        require(MODULE);
        (docListeners['DOMContentLoaded'] || []).forEach(function (fn) { fn(); });
    } finally {
        global.window = prevWin; global.document = prevDoc;
        delete require.cache[require.resolve(MODULE)];
    }
    return els;
}

// ── 1) грамматика флага ─────────────────────────────────────────────────────
(function () {
    var O = require(MODULE);
    assert(typeof O.optiRequested === 'function', 'модуль экспортирует предикат optiRequested');

    assert(O.optiRequested('#opti') === true, '#opti включает оптимизацию');
    assert(O.optiRequested('opti') === true, 'хэш без решётки тоже считается');
    assert(O.optiRequested('#OPTI') === true, 'регистр флага не важен');
    assert(O.optiRequested('#opti=1') === true, '#opti=1 включает оптимизацию');
    assert(O.optiRequested('#tab=Модель&opti') === true, 'флаг живёт рядом с #tab=');
    assert(O.optiRequested('#opti&tab=Модель') === true, 'порядок токенов не важен');

    assert(O.optiRequested('') === false, 'пустой хэш — кнопки нет');
    assert(O.optiRequested(undefined) === false, 'нет хэша — кнопки нет');
    assert(O.optiRequested('#') === false, 'голая решётка — кнопки нет');
    assert(O.optiRequested('#tab=Модель') === false, 'обычный хэш вкладки — кнопки нет');
    assert(O.optiRequested('#optimize') === false, 'похожий токен не включает: только точное opti');
    assert(O.optiRequested('#noopti') === false, 'флаг внутри другого слова не считается');
    delete require.cache[require.resolve(MODULE)];
})();

// ── 2) bootstrap без флага: разметки не остаётся ────────────────────────────
(function () {
    var els = loadWithHash('#tab=Модель');
    assert(els['dash-opt-open'].removed === true, 'без #opti кнопка удалена из DOM');
    assert(els['dash-opt-modal'].removed === true, 'без #opti модалка удалена из DOM');
    assert(!els['dash-opt-open'].listeners['click'], 'без #opti обработчик клика не вешается');
})();

// ── 3) bootstrap с флагом: кнопка на месте и показана ───────────────────────
(function () {
    var els = loadWithHash('#opti');
    assert(els['dash-opt-open'].removed === false, 'с #opti кнопка остаётся в DOM');
    assert(els['dash-opt-modal'].removed === false, 'с #opti модалка остаётся в DOM');
    assert(els['dash-opt-open'].classList.contains('dash-opt-on'), 'с #opti кнопка получает класс показа');
    assert((els['dash-opt-open'].listeners['click'] || []).length === 1, 'с #opti кнопка открывает отчёт по клику');
})();

// ── 4) флаг рядом с вкладкой — тот же результат ─────────────────────────────
(function () {
    var els = loadWithHash('#tab=Модель&opti');
    assert(els['dash-opt-open'].removed === false, 'вкладка + opti: кнопка остаётся');
    assert(els['dash-opt-open'].classList.contains('dash-opt-on'), 'вкладка + opti: кнопка показана');
})();

console.log('OK: ' + passed + '/' + total + ' проверок (#4659 гейт кнопки «Оптимизация»)');
