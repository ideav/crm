// #5060 — информация о втулке в сводке задания пульта слиттера.
//
// Отчёт cut_planning отдаёт колонки «Дюймы» («1.00») и «Материал втулки» («Пластик черная»).
// Сводка задания (.atex-sl-spec) второй строчкой показывает их в формате
// {Дюймы}", {Материал}; данных о втулке нет — сводка остаётся одной строкой.
//
// Run with: node experiments/atex-slitter-5060-sleeve.test.js

process.env.TZ = 'Europe/Moscow';

// ── Минимальный DOM-стаб (как в atex-slitter-4996-alt-material.test.js) ────────────────────────
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
StubNode.prototype.setAttribute = function(k, v) { this.attributes[k] = String(v); };
StubNode.prototype.getAttribute = function(k) { return this.attributes[k] == null ? null : this.attributes[k]; };

global.document = {
    createElement: function(tag) { return new StubNode(tag); },
    createTextNode: function(text) { var n = new StubNode('#text'); n._text = String(text == null ? '' : text); return n; },
    body: new StubNode('body'), readyState: 'loading',
    getElementById: function() { return null; }, addEventListener: function() {}
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

// Тест пишется ДО правки: обёртка даёт читаемое красное вместо стека первого вызова.
function rowsToCutSleeves(rows) {
    if (typeof core.rowsToCutSleeves !== 'function') return '(core.rowsToCutSleeves нет)';
    return core.rowsToCutSleeves(rows);
}

// ── карта втулок из строк cut_planning (строки — как в боевом ответе отчёта) ───────────────────
var planningRows = [
    { cut_id: '626987', 'Дюймы': '1.00', 'Материал втулки': 'Пластик черная' },
    { cut_id: '626987', 'Дюймы': '1.00', 'Материал втулки': 'Пластик черная' }, // второе обеспечение
    { cut_id: '626990', 'Дюймы': '3', 'Материал втулки': '' },                  // материала нет
    { cut_id: '626991', 'Дюймы': '', 'Материал втулки': 'Картон' },             // дюймов нет
    { cut_id: '626992', 'Дюймы': '', 'Материал втулки': '' },                   // втулки нет
    { cut_id: '626993' }                                                        // колонок нет вовсе
];
assertEqual(rowsToCutSleeves(planningRows), {
    '626987': '1", Пластик черная',
    '626990': '3"',
    '626991': 'Картон'
}, '#5060: Дюймы + Материал втулки → { задание: «{Дюймы}", {Материал}» }, без пустых');
assertEqual(rowsToCutSleeves([{ cut_id: '1', 'Дюймы': '1.50', 'Материал втулки': 'Картон' }]),
    { '1': '1.5", Картон' }, '#5060: дробные дюймы без хвостовых нулей');
assertEqual(rowsToCutSleeves([]), {}, '#5060: пустой отчёт → пустая карта втулок');

// ── сводка задания (renderCutSpec) ─────────────────────────────────────────────────────────────
function specInst(sleeves) {
    var inst = Object.create(Controller.prototype);
    inst.cutAlts = {};
    inst.cutWidths = {};
    inst.cutSleeves = sleeves;
    inst.findBatch = function() { return null; };
    return inst;
}
var CUT = { id: '626987', material: 'MWR113L', runLength: '900', winding: 'IN', leader: 'MONOCHROME' };
function renderSpec(inst) {
    inst.currentCut = CUT;
    return Controller.prototype.renderCutSpec.call(inst);
}

var withSleeve = renderSpec(specInst({ '626987': '1", Пластик черная' }));
assert(withSleeve.classList.contains('atex-sl-spec'), '#5060: сводка — по-прежнему .atex-sl-spec');
assertEqual(withSleeve.childNodes.map(function(n) { return n.textContent; }),
    ['MWR113L / 900 м / IN / MONOCHROME', '1", Пластик черная'],
    '#5060: втулка — второй строчкой в .atex-sl-spec');

var noSleeve = renderSpec(specInst({}));
assertEqual(noSleeve.textContent, 'MWR113L / 900 м / IN / MONOCHROME',
    '#5060: втулки нет — сводка одной строкой, как раньше');
assert(noSleeve.childNodes.length <= 1, '#5060: без втулки второй строчки нет');

// ── проводка: loadCutOrders кладёт карту втулок из ответа cut_planning ─────────────────────────
(function() {
    var inst = Object.create(Controller.prototype);
    inst.selectedSlitterId = '1285';
    inst.cutOrdersSlitterId = null;
    inst.getJson = function() {
        return Promise.resolve([
            { cut_id: '626987', 'Дюймы': '1.00', 'Материал втулки': 'Пластик черная' }
        ]);
    };
    Controller.prototype.loadCutOrders.call(inst).then(function() {
        assertEqual(inst.cutSleeves, { '626987': '1", Пластик черная' },
            '#5060: после загрузки очереди карта втулок на месте');
        inst.selectedSlitterId = null;
        return Controller.prototype.loadCutOrders.call(inst).then(function() {
            assertEqual(inst.cutSleeves, {}, '#5060: сброс очереди сбрасывает и втулки');
            finish();
        });
    }).catch(function(err) {
        total++;
        console.log('FAIL — #5060: loadCutOrders упал: ' + (err && err.message || err));
        process.exitCode = 1;
        finish();
    });
})();

var finished = false;
function finish() {
    if (finished) return;
    finished = true;
    console.log('\n' + passed + '/' + total + ' assertions passed');
    if (passed !== total) process.exitCode = 1;
}
