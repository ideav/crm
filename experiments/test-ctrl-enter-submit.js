// Тест чистой логики глобального Ctrl+Enter (js/form-submit.js).
// DOM нет (jsdom отсутствует) — мокаем минимальный интерфейс closest/querySelectorAll.
'use strict';
var assert = require('assert');
var fs = require('../js/form-submit.js');
var SCOPE = fs.SCOPE_SELECTOR;
var PRIMARY = fs.PRIMARY_SELECTOR;

function btn(visible) {
    return {
        offsetParent: visible ? {} : null,
        disabled: false,
        hidden: false,
        getAttribute: function () { return null; },
        click: function () { this._clicked = true; }
    };
}
// Поле ввода: closest('form') → form; closest(SCOPE) → scope.
function input(opts) {
    return {
        tagName: 'INPUT',
        getAttribute: function (k) { return k === 'type' ? (opts.type || 'text') : null; },
        closest: function (sel) {
            if (sel === 'form') return opts.form || null;
            if (sel === SCOPE) return opts.scope || null;
            return null;
        }
    };
}
function scope(map) {
    return {
        querySelectorAll: function (sel) {
            if (sel === '[data-default-submit]') return map.explicit || [];
            if (sel === PRIMARY) return map.primary || [];
            return [];
        }
    };
}

// 1) Поле внутри <form> → отправка формы.
(function () {
    var form = { tagName: 'FORM' };
    var t = fs.resolveSubmitTarget(input({ form: form }));
    assert.deepStrictEqual(t, { kind: 'form', form: form }, '1: form → kind=form');
})();

// 2) Модалка без формы, только primary-кнопка → клик по ней.
(function () {
    var b = btn(true);
    var t = fs.resolveSubmitTarget(input({ scope: scope({ primary: [b] }) }));
    assert.strictEqual(t.kind, 'button', '2: scope+primary → kind=button');
    assert.strictEqual(t.button, b, '2: выбрана primary-кнопка');
})();

// 3) data-default-submit имеет приоритет над primary.
(function () {
    var explicit = btn(true), prim = btn(true);
    var t = fs.resolveSubmitTarget(input({ scope: scope({ explicit: [explicit], primary: [prim] }) }));
    assert.strictEqual(t.button, explicit, '3: data-default-submit приоритетнее primary');
})();

// 4) Невидимая primary-кнопка пропускается → цели нет.
(function () {
    var hidden = btn(false);
    var t = fs.resolveSubmitTarget(input({ scope: scope({ primary: [hidden] }) }));
    assert.strictEqual(t, null, '4: невидимая кнопка → null');
})();

// 5) Первая видимая из нескольких primary.
(function () {
    var a = btn(false), b = btn(true);
    var t = fs.resolveSubmitTarget(input({ scope: scope({ primary: [a, b] }) }));
    assert.strictEqual(t.button, b, '5: берётся первая видимая');
})();

// 6) Поле вне формы и вне scope → ничего (без ложных срабатываний).
(function () {
    var t = fs.resolveSubmitTarget(input({}));
    assert.strictEqual(t, null, '6: вне формы/scope → null');
})();

// 7) Безопасность: объект без closest → null.
assert.strictEqual(fs.resolveSubmitTarget({}), null, '7: нет closest → null');
assert.strictEqual(fs.resolveSubmitTarget(null), null, '7: null → null');

// 8) isTextEntry: какие поля считаются вводом.
(function () {
    function inp(type) { return { tagName: 'INPUT', getAttribute: function () { return type; } }; }
    assert.strictEqual(fs.isTextEntry(inp('text')), true, '8: text → true');
    assert.strictEqual(fs.isTextEntry(inp('number')), true, '8: number → true');
    assert.strictEqual(fs.isTextEntry(inp('checkbox')), false, '8: checkbox → false');
    assert.strictEqual(fs.isTextEntry(inp('button')), false, '8: button → false');
    assert.strictEqual(fs.isTextEntry({ tagName: 'TEXTAREA' }), true, '8: textarea → true');
    assert.strictEqual(fs.isTextEntry({ tagName: 'SELECT' }), true, '8: select → true');
    assert.strictEqual(fs.isTextEntry({ tagName: 'DIV', isContentEditable: true }), true, '8: contenteditable → true');
    assert.strictEqual(fs.isTextEntry({ tagName: 'DIV' }), false, '8: div → false');
    assert.strictEqual(fs.isTextEntry(null), false, '8: null → false');
})();

console.log('ctrl-enter-submit: ok — 8 групп проверок пройдены');
