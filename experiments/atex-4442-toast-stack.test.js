// Tests for ideav/crm — красные сообщения должны стоять СТОПКОЙ с частичным перекрытием:
// новое чуть выше старого, а не точно поверх него.
//
// Тосты прибиты к правому нижнему углу (`position: fixed; right: 20px; bottom: 20px`), и каждый
// новый ложился РОВНО на предыдущий. Важные сообщения (ошибка/предупреждение) живут до нажатия «×»
// (#4418), поэтому их набирается несколько — и было видно только последнее: сколько сообщений под
// ним и какие, понять нельзя.
//
// Теперь notify() держит живые тосты списком и раскладывает каскадом (`toastStackLayout`): каждое
// следующее на шаг выше предыдущего и рисуется ПОВЕРХ него, у нижних остаётся видна кромка. Шаг
// накапливается не бесконечно — иначе стопка уползёт за верх экрана. Раскладка пересчитывается и
// при добавлении, и при закрытии, иначе в стопке остаются дыры.
//
// Run with: node experiments/atex-4442-toast-stack.test.js

process.env.TZ = 'Europe/Moscow';

var fs = require('fs');
var path = require('path');
var mod = require('../download/atex/js/production-planning.js');
var P = mod.planning;
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
    if (ok) { passed++; } else {
        console.log('  expected:', JSON.stringify(expected));
        console.log('  actual:  ', JSON.stringify(actual));
        process.exitCode = 1;
    }
}

// ── 1) Раскладка стопки: каждое следующее выше и поверх предыдущего ────────────────────────────
(function () {
    var one = P.toastStackLayout(1);
    assertEqual(one.length, 1, 'одно сообщение — одна позиция');
    assertEqual(one[0].bottom, 20, 'одиночный тост стои́т на базовом отступе (как в CSS)');

    var four = P.toastStackLayout(4);
    var bottoms = four.map(function (x) { return x.bottom; });
    var zs = four.map(function (x) { return x.zIndex; });
    for (var i = 1; i < four.length; i++) {
        assert(bottoms[i] > bottoms[i - 1], 'сообщение ' + (i + 1) + ' ВЫШЕ предыдущего (' + bottoms[i - 1] + ' → ' + bottoms[i] + ')');
        assert(zs[i] > zs[i - 1], 'сообщение ' + (i + 1) + ' рисуется ПОВЕРХ предыдущего');
    }
    var step = bottoms[1] - bottoms[0];
    assert(step > 0 && step < 60,
        'шаг стопки — ЧАСТИЧНОЕ перекрытие: ' + step + 'px (не «точно поверх» и не отдельными строками)');
    assert(four.every(function (x, i) { return x.bottom === bottoms[0] + step * i; }),
        'шаг одинаковый — стопка ровная');
})();

// ── 2) Стопка не уползает за верх экрана ──────────────────────────────────────────────────────
(function () {
    var many = P.toastStackLayout(40);
    var maxBottom = Math.max.apply(null, many.map(function (x) { return x.bottom; }));
    assert(maxBottom < 400, 'даже у 40 сообщений стопка не уходит вверх без предела (макс ' + maxBottom + 'px)');
    var lastTwo = many.slice(-2);
    assertEqual(lastTwo[0].bottom, lastTwo[1].bottom, 'после потолка новые сообщения ложатся на ту же высоту');
    assert(lastTwo[1].zIndex > lastTwo[0].zIndex, 'но самое новое всё равно ПОВЕРХ');
})();

// ── 3) notify(): тосты собираются в стопку, закрытие её пересобирает ──────────────────────────
(function () {
    // Минимальный DOM: notify() строит элементы через el() и вешает их на toastHost.
    function fakeEl(tag) {
        return {
            tagName: tag, children: [], parentNode: null, style: {},
            classList: { list: {}, add: function (c) { this.list[c] = 1; }, remove: function (c) { delete this.list[c]; },
                         contains: function (c) { return !!this.list[c]; } },
            appendChild: function (c) { c.parentNode = this; this.children.push(c); return c; },
            removeChild: function (c) { var i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parentNode = null; },
            addEventListener: function (name, fn) { (this._on = this._on || {})[name] = fn; },
            setAttribute: function () {}
        };
    }
    var host = fakeEl('div');
    global.document = { createElement: fakeEl, body: host };
    var timers = [];
    global.setTimeout = function (fn) { timers.push(fn); return timers.length; };

    var self = Object.create(Controller.prototype);
    self.toastHost = host;

    Controller.prototype.notify.call(self, 'первая ошибка', 'error');
    Controller.prototype.notify.call(self, 'вторая ошибка', 'error');
    Controller.prototype.notify.call(self, 'третья ошибка', 'error');

    var stack = self._toastStack;
    assertEqual(stack.length, 3, 'три висящих сообщения — три элемента стопки');
    var bottoms = stack.map(function (t) { return parseInt(t.style.bottom, 10); });
    assert(bottoms[0] < bottoms[1] && bottoms[1] < bottoms[2],
        'новое сообщение ВЫШЕ старого: ' + bottoms.join(' → '));
    var zs = stack.map(function (t) { return Number(t.style.zIndex); });
    assert(zs[0] < zs[1] && zs[1] < zs[2], 'новое рисуется поверх старого: ' + zs.join(' → '));

    // Закрываем СРЕДНЕЕ (кнопка «×») — стопка обязана сомкнуться без дыр.
    var middle = stack[1];
    var closeBtn = middle.children.filter(function (c) { return /atex-pp-toast-close/.test(c.className || ''); })[0];
    assert(!!closeBtn, 'у сообщения есть кнопка «×» (#4418)');
    closeBtn._on.click({ stopPropagation: function () {} });

    assertEqual(self._toastStack.length, 2, 'закрытое сообщение вышло из стопки');
    var after = self._toastStack.map(function (t) { return parseInt(t.style.bottom, 10); });
    assertEqual(after, [20, 38], 'оставшиеся сомкнулись — дыры в стопке не осталось');

    delete global.document;
})();

// ── 4) CSS: базовые правила тоста на месте (стопку проставляет notify инлайном) ────────────────
(function () {
    var css = fs.readFileSync(path.join(__dirname, '..', 'download', 'atex', 'css', 'production-planning.css'), 'utf8');
    var block = css.slice(css.indexOf('.atex-pp-toast {'), css.indexOf('.atex-pp-toast.is-visible'));
    assert(/position:\s*fixed/.test(block), 'тост позиционируется fixed — иначе инлайновый bottom не сработает');
    assert(/bottom:\s*20px/.test(block), 'база стопки в CSS совпадает с toastStackLayout(1)');
    assertEqual(P.toastStackLayout(1)[0].bottom, 20, 'и наоборот — раскладка не разъехалась с CSS');
})();

process.on('exit', function () {
    console.log('\n' + passed + '/' + total + ' passed');
});
