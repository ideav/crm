// #4921: пульт слиттера «съезжает» — шапка браузера и клавиатура сдвигают документ,
// низ карточки задания уходит за адресную строку. Выравнивание прокрутки: при запуске
// и после закрытия клавиатуры — в начало. Логика — core.createScrollAlign («окно»
// подставляется снаружи, проверяется без браузера).
var assert = require('assert');
var modules = [
    require('../download/atex/js/slitter.js')
];

function fakeWin(vvHeight) {
    var listeners = {};
    return {
        scrollToCalls: [],
        visualViewport: {
            height: vvHeight,
            addEventListener: function(type, fn) { listeners[type] = fn; }
        },
        scrollTo: function(x, y) { this.scrollToCalls.push([x, y]); },
        _listeners: listeners
    };
}

modules.forEach(function(mod, i) {
    var tag = 'atex-slitter-4921[' + i + ']';
    var core = mod.core;

    // при запуске: страница выравнивается наверх
    var w1 = fakeWin(600);
    core.createScrollAlign(w1).alignTop();
    assert.deepStrictEqual(w1.scrollToCalls, [[0, 0]],
        tag + ': при запуске прокрутка возвращается в начало');

    // клавиатура открылась (вьюпорт сжался) — прокрутку не трогаем
    var w2 = fakeWin(600);
    var align2 = core.createScrollAlign(w2).install();
    assert.strictEqual(typeof w2._listeners.resize, 'function',
        tag + ': подписка на resize визуального вьюпорта установлена');
    w2.visualViewport.height = 450;
    align2.onViewportResize();
    assert.strictEqual(w2.scrollToCalls.length, 0,
        tag + ': открытие клавиатуры страницу не выравнивает');

    // клавиатура закрылась (высота выросла) — выравниваем
    w2.visualViewport.height = 600;
    align2.onViewportResize();
    assert.deepStrictEqual(w2.scrollToCalls, [[0, 0]],
        tag + ': после закрытия клавиатуры страница выравнивается наверх');

    // дребезг высоты до 5px (адресная строка плавает) — не считается закрытием клавиатуры
    var w3 = fakeWin(600);
    var align3 = core.createScrollAlign(w3).install();
    w3.visualViewport.height = 596;
    align3.onViewportResize();
    w3.visualViewport.height = 600;
    align3.onViewportResize();
    assert.strictEqual(w3.scrollToCalls.length, 0,
        tag + ': дребезг адресной строки ≤5px страницу не выравнивает');

    // без visualViewport (старый браузер) — установка не падает, выравнивание работает
    var w4 = { scrollToCalls: [], scrollTo: function(x, y) { this.scrollToCalls.push([x, y]); } };
    core.createScrollAlign(w4).install().alignTop();
    assert.deepStrictEqual(w4.scrollToCalls, [[0, 0]],
        tag + ': без visualViewport выравнивание при запуске всё равно работает');
});

console.log('atex-slitter-4921: ок (копий файла: ' + modules.length + ')');
