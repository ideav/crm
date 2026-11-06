// #5209 (комментарий владельца к PR #5434, 06.11) — в шапке задания пульта слиттера стоит
// ТЕКСТ ПРИМЕЧАНИЯ позиции заказа целиком, а не собранная строка «сырьё / метраж / намотка /
// лидер». Задание 1011650 (заказ 6444, Станок 2) показывало «MWR265 / 450 м / IN / MONOCHROME»,
// а должно: «6444 / MWR265 100 х 450 IN (без трейлера в начале намотки) (П) / 99мм х 9 /
// 20 резок (891мм)». Примечание приходит колонкой position_note отчёта cut_planning (1019626).
// Нет Примечания — шапка как раньше. Втулка — второй строкой, как раньше.
//
// Run with: node experiments/atex-slitter-5209-note-header.test.js

process.env.TZ = 'Europe/Moscow';

// ── Минимальный DOM-стаб (как в atex-slitter-4958-queue-card.test.js) ──────────────────────────
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

function rowsToCutNotes(rows) {
    if (typeof core.rowsToCutNotes !== 'function') return '(core.rowsToCutNotes нет)';
    return core.rowsToCutNotes(rows);
}

var N6444 = '6444 / MWR265 100 х 450 IN (без трейлера в начале намотки) (П) / 99мм х 9 / 20 резок (891мм)';

// ── карта Примечаний по строкам cut_planning ───────────────────────────────────────────────────
assertEqual(rowsToCutNotes([
    { cut_id: '1011650', position_note: N6444 },
    { cut_id: '1011650', position_note: 'второе' },
    { cut_id: '7', position_note: '   ' },
    { cut_id: '8' },
    { cut_id: '9', position_note: '  ' + N6444 + ' ' }
]), { '1011650': N6444, '9': N6444 }, 'карта: первое непустое Примечание задания, пробелы по краям срезаны');

// ── шапка задания ──────────────────────────────────────────────────────────────────────────────
var CUT = { id: '1011650', material: 'MR377/MWR265', runLength: '450', winding: 'IN', leader: 'MONOCHROME', plannedRuns: '10' };
function inst(notes, sleeves) {
    var o = Object.create(Controller.prototype);
    o.cutAlts = { '1011650': 'MWR265' }; o.cutNotes = notes; o.cutSleeves = sleeves || {};
    o.cutWidths = {}; o.findBatch = function() { return null; };
    o.currentCut = CUT;
    return o;
}
var notes = rowsToCutNotes([{ cut_id: '1011650', position_note: N6444 }]);
if (typeof notes !== 'object') notes = {};
var head = Controller.prototype.renderCutSpec.call(inst(notes, { '1011650': '1", Картон' }));
assertEqual(head.childNodes.map(function(n) { return n.textContent; }), [N6444, '1", Картон'],
    '6444: шапка — текст Примечания, второй строкой втулка');
assertEqual(Controller.prototype.renderCutSpec.call(inst({})).textContent, 'MWR265 / 450 м / IN / MONOCHROME',
    'нет Примечания → шапка как раньше');
assertEqual(Controller.prototype.renderCutSpec.call(inst(undefined)).textContent, 'MWR265 / 450 м / IN / MONOCHROME',
    'карта Примечаний не загружена → шапка как раньше');

console.log('\n' + passed + '/' + total + ' assertions passed');
if (passed !== total) process.exitCode = 1;
