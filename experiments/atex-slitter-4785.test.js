// #4785 — пульт слиттера: раскладка ножей читается с одного взгляда.
//
// Что проверяем (пункты тикета):
//   1. заголовков секций (.atex-sl-section-title) в пульте нет — всё говорят сами данные;
//   2. цвет полосы на раскладке — по ЕЁ ШИРИНЕ (одна ширина = один цвет), под картой
//      легенда ширин тем же цветом, подпись крупная и неприглушённая;
//   3. подсказок под полями (.atex-sl-hint) нет: остаток партии виден строкой партии,
//      пересчёт «= N м²» оператору не нужен. Осталось единственное сообщение — когда
//      ширины сырья нет и м² посчитать нечем.
//
// Run with: node experiments/atex-slitter-4785.test.js

process.env.TZ = 'Europe/Moscow';

var fs = require('fs');
var path = require('path');
var ROOT = path.join(__dirname, '..');

// ── Минимальный DOM-стаб (как в atex-slitter-4783.test.js) ────────────────────────────────────
function StubNode(tag) {
    this.tagName = String(tag || '').toUpperCase();
    this.childNodes = [];
    this.attributes = {};
    this.dataset = {};
    this.style = {};
    this._className = '';
    this._text = '';
    this._listeners = {};
    this.value = '';
    this.disabled = false;
    var self = this;
    this.classList = {
        add: function(c) { if (self._classes().indexOf(c) === -1) self._className = (self._className + ' ' + c).trim(); },
        remove: function(c) { self._className = self._classes().filter(function(x) { return x !== c; }).join(' '); },
        contains: function(c) { return self._classes().indexOf(c) !== -1; }
    };
}
StubNode.prototype._classes = function() { return this._className.split(/\s+/).filter(Boolean); };
Object.defineProperty(StubNode.prototype, 'className', {
    get: function() { return this._className; }, set: function(v) { this._className = String(v || ''); }
});
Object.defineProperty(StubNode.prototype, 'textContent', {
    get: function() { if (this.childNodes.length) return this.childNodes.map(function(c) { return c.textContent; }).join(''); return this._text; },
    set: function(v) { this._text = String(v == null ? '' : v); this.childNodes = []; }
});
Object.defineProperty(StubNode.prototype, 'innerHTML', {
    get: function() { return ''; }, set: function() { this.childNodes = []; this._text = ''; }
});
StubNode.prototype.appendChild = function(node) { this.childNodes.push(node); node.parentNode = this; return node; };
StubNode.prototype.removeChild = function(node) {
    this.childNodes = this.childNodes.filter(function(c) { return c !== node; });
    node.parentNode = null; return node;
};
StubNode.prototype.setAttribute = function(k, v) { this.attributes[k] = String(v); };
StubNode.prototype.getAttribute = function(k) { return this.attributes[k] == null ? null : this.attributes[k]; };
StubNode.prototype.addEventListener = function(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); };
StubNode.prototype.dispatch = function(ev, e) { (this._listeners[ev] || []).forEach(function(fn) { fn(e || {}); }); };
StubNode.prototype.click = function() { this.dispatch('click', { target: this }); };
StubNode.prototype._all = function(acc) { this.childNodes.forEach(function(c) { if (c instanceof StubNode) { acc.push(c); c._all(acc); } }); return acc; };
StubNode.prototype.querySelectorAll = function(sel) { var cls = sel.replace(/^\./, ''); return this._all([]).filter(function(n) { return n.classList.contains(cls); }); };
StubNode.prototype.querySelector = function(sel) { return this.querySelectorAll(sel)[0] || null; };

global.document = {
    createElement: function(tag) { return new StubNode(tag); },
    createTextNode: function(text) { var n = new StubNode('#text'); n._text = String(text == null ? '' : text); return n; },
    body: new StubNode('body'), readyState: 'loading',
    getElementById: function() { return null; }, addEventListener: function() {},
    querySelector: function() { return null; }
};
global.window = { db: 'ateh' };

var api = require('../download/atex/js/slitter.js');
var Controller = api.Controller;
var core = api.core;

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

// ── п.2: цвет — свойство ШИРИНЫ ───────────────────────────────────────────────────────────────
(function() {
    var map = core.widthColorIndex([{ width: '250' }, { width: '150' }, { width: '250' }]);
    assertEqual(map, { '150': 0, '250': 1 },
        '#4785 п.2: цвет назначается ширине; порядок по возрастанию ширины, повтор не плодит цвет');
    assertEqual(core.widthColorClass(map, '250'), 'atex-sl-cm-seg-w1',
        '#4785 п.2: класс полосы берётся из карты ширин');
    assertEqual(core.widthColorClass(map, '250,000'), 'atex-sl-cm-seg-w1',
        '#4785 п.2: ширина «250,000» и «250» — одна ширина и один цвет');
    assertEqual(core.widthColorClass(map, '90'), 'atex-sl-cm-seg-w0',
        '#4785 п.2: незнакомая ширина не роняет раскладку — красится первым цветом');
    // Палитра циклится: девятая ширина берёт цвет первой, а не пропадает.
    var many = core.widthColorIndex([10, 20, 30, 40, 50, 60, 70, 80, 90]);
    assertEqual(core.widthColorClass(many, 90), 'atex-sl-cm-seg-w0',
        '#4785 п.2: ширин больше палитры — цвета идут по кругу');
    // Порядок полос в задании карту цветов не меняет.
    assertEqual(core.widthColorIndex([{ width: '150' }, { width: '250' }]),
        core.widthColorIndex([{ width: '250' }, { width: '150' }]),
        '#4785 п.2: карта цветов не зависит от порядка полос');
})();

// ── экземпляр пульта на заглушках ─────────────────────────────────────────────────────────────
function makeInst(opts) {
    var o = opts || {};
    var inst = Object.create(Controller.prototype);
    inst.root = new StubNode('div');
    inst.busy = false;
    inst.selectedDate = '2026-08-18';
    inst.selectedSlitterId = '1';
    inst.selectedBatchIds = ['77'];
    inst.currentStrips = o.strips || [
        { id: '1', width: '250', qty: '3', purpose: 'Заказ' },
        { id: '2', width: '150', qty: '1', purpose: 'Склад' }
    ];
    inst.currentCut = {
        id: '90', batchId: '77', status: 'В работе', actualRuns: '1', plannedRuns: '4',
        runLength: '400', material: 'БОПП 20', winding: 'OUT', leader: 'Лидер 40',
        counterStart: '1000', counterEnd: '', defectM: '', notes: '',
        materialWidthMm: o.materialWidthMm === undefined ? 910 : o.materialWidthMm
    };
    inst.currentCutId = '90';
    inst.posts = [];
    inst.post = function(p, f) { this.posts.push({ path: p, params: f }); return Promise.resolve({}); };
    inst.cutFields = function() { return { t1: 1 }; };
    inst.setBusy = function(v) { this.busy = v; };
    inst.notify = function() {};
    inst.isShiftOpen = function() { return true; };
    inst.isCutLocked = function() { return false; };
    inst.allCutsDone = function() { return false; };
    inst.currentQueue = function() { return { cuts: [], firstOpenCutId: null }; };
    inst.cutOrderText = function() { return '3738'; };
    inst.findBatch = function(id) {
        return String(id) === '77'
            ? { id: '77', label: '1781000001', date: '2026-05-10', remainderM: 900, barcode: 'BOPP-A100', widthMm: 900 }
            : null;
    };
    inst.mainEl = new StubNode('section');
    return inst;
}

// ── п.1: заголовков секций нет ────────────────────────────────────────────────────────────────
(function() {
    var inst = makeInst();
    inst.renderMain();
    assertEqual(inst.mainEl.querySelectorAll('.atex-sl-section-title').length, 0,
        '#4785 п.1: заголовков секций в пульте нет');
    assertEqual(inst.mainEl.querySelectorAll('.atex-sl-section').length, 2,
        '#4785 п.1: сами секции на месте — раскладка и показания');
    // Число полос переехало в строку над картой (заголовок его больше не несёт).
    assert(inst.renderCutMap().querySelector('.atex-sl-cm-caption').textContent.indexOf('полос: 4') >= 0,
        '#4785 п.1: сколько полос за проход — в строке над картой');
})();

// ── п.2: раскладка цветная по ширине, легенда ширин тем же цветом ─────────────────────────────
(function() {
    var inst = makeInst();
    var map = inst.renderCutMap();
    var segs = map.querySelectorAll('.atex-sl-cm-seg')
        .filter(function(n) { return !n.classList.contains('atex-sl-cm-seg-remainder'); });
    assertEqual(segs.length, 4, '#4785 п.2: полос на карте столько же, сколько ножей (3 × 250 + 1 × 150)');
    var byWidth = {};
    segs.forEach(function(seg) {
        var color = seg.className.split(/\s+/).filter(function(c) { return /^atex-sl-cm-seg-w\d$/.test(c); })[0];
        (byWidth[seg.dataset.width] = byWidth[seg.dataset.width] || []).push(color);
    });
    assert(byWidth['250'].length === 3 && byWidth['250'].every(function(c) { return c === byWidth['250'][0]; }),
        '#4785 п.2: все полосы одной ширины — одного цвета');
    assert(byWidth['250'][0] !== byWidth['150'][0],
        '#4785 п.2: разные ширины — разные цвета (карта читается по ширинам)');
    assert(segs.every(function(s) { return !/atex-sl-cm-seg-(order|stock|waste|other)\b/.test(s.className); }),
        '#4785 п.2: цвет больше не про назначение — задание из одних заказных полос было одноцветным');

    var items = map.querySelectorAll('.atex-sl-cm-legend-item');
    assertEqual(items.length, 2, '#4785 п.2: в легенде по строке на каждую ширину');
    assertEqual(items.map(function(n) { return n.querySelector('.atex-sl-cm-legend-width').textContent; }),
        ['250 мм × 3', '150 мм × 1'],
        '#4785 п.2: легенда называет ширину и число полос');
    var swatch = items[0].querySelector('.atex-sl-cm-swatch').className;
    assert(swatch.indexOf(byWidth['250'][0]) >= 0,
        '#4785 п.2: значок в легенде того же цвета, что полосы этой ширины');
    assertEqual(items[0].querySelector('.atex-sl-cm-legend-purpose').textContent, 'Заказ',
        '#4785 п.2: назначение осталось припиской — цветом его больше не показывают');
})();

// ── п.3: подсказок под полями нет ─────────────────────────────────────────────────────────────
(function() {
    var inst = makeInst();
    var section = inst.renderReadings();
    assertEqual(section.querySelectorAll('.atex-sl-hint').length, 0,
        '#4785 п.3: подсказок под полями нет (остаток партии виден строкой партии)');
    assert(section.textContent.indexOf('остаток партии') === -1,
        '#4785 п.3: остаток партии под «Счётчиком нач.» не дублируется');

    // ввод брака больше не рисует пересчёт «= N м²», но сам пересчёт живёт.
    // #4860: в сетке показаний появились поля расхода джамбо (после «Счётчика кон.»),
    // поэтому поле «Брак, м» ищем ПО ПОДПИСИ, а не позицией: порядок полей — продукт,
    // а не контракт теста; проверяемое поведение (пересчёт м² при вводе) не менялось.
    var defectField = section.querySelectorAll('.atex-sl-field').filter(function(f) {
        var lbl = f.querySelector('.atex-sl-label');
        return lbl && lbl.textContent === 'Брак, м';
    })[0];
    var defect = defectField.querySelectorAll('.atex-sl-input')[0];
    defect.value = '12';
    defect.dispatch('input');
    assertEqual(inst.currentCut.defect, String(core.defectM2('12', 910)),
        '#4785 п.3: «Брак, м²» по-прежнему считается — просто не показывается строкой');
    assert(section.textContent.indexOf('м²') === -1,
        '#4785 п.3: пересчёта «= N м²» на экране нет');

    // ширины сырья нет — считать м² нечем, и об этом сказано (молча не глотаем)
    var noWidth = makeInst({ materialWidthMm: 0 });
    assert(noWidth.renderReadings().textContent.indexOf('ширина сырья не определена') >= 0,
        '#4785 п.3: без ширины сырья предупреждение остаётся — брак в м² не посчитать');

    // ответ на загрузку фото — не подсказка, он остался
    var withPhoto = makeInst();
    withPhoto.currentCut.defectPhoto = '1';
    assertEqual(withPhoto.renderReadings().querySelector('.atex-sl-photo-status').textContent, 'фото загружено',
        '#4785 п.3: ответ на действие («фото загружено») остаётся — иначе не видно, доехал ли снимок');
})();

// ── стили: палитра ширин и читаемая легенда ───────────────────────────────────────────────────
(function() {
    var css = fs.readFileSync(path.join(ROOT, 'download/atex/css/slitter.css'), 'utf8');
    var colors = (css.match(/--sl-cm-w\d:/g) || []).length;
    assertEqual(colors, 8, '#4785 п.2: в палитре восемь цветов ширин');
    assert(/\.atex-sl-cm-legend-item\s*\{[^}]*color:\s*var\(--text-primary/.test(css),
        '#4785 п.2: легенда ширин — основным цветом текста, без приглушения');
})();

console.log('\n' + passed + '/' + total + ' assertions passed');
if (passed !== total) process.exitCode = 1;
