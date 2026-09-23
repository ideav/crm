// #4996 — альтернативное название Вида сырья в пульте слиттера.
//
// Отчёт cut_planning отдаёт колонку alt_material («MCHR ZNAK 3 Special» против
// внутреннего «MWR113L»). Карточка очереди и сводка задания показывают её вместо
// обычного имени; альта нет (колонка пуста/не отдалась) — как раньше.
//
// Run with: node experiments/atex-slitter-4996-alt-material.test.js

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

// Тест пишется ДО правки: пока ядро не знает rowsToCutAlts, зовём через обёртку,
// чтобы красное было читаемым списком ожиданий, а не стеком первого же вызова.
function rowsToCutAlts(rows) {
    if (typeof core.rowsToCutAlts !== 'function') return '(core.rowsToCutAlts нет)';
    return core.rowsToCutAlts(rows);
}

var DAY = '2026-09-14';
function stamp(dayISO, hhmm) { return String(Math.floor(new Date(dayISO + 'T' + hhmm + ':00+03:00').getTime() / 1000)); }

// ── карта alt_material из строк cut_planning (тот же запрос, что и заказы/ширины) ──────────────
var planningRows = [
    { cut_id: '625865', alt_material: 'MCHR ZNAK 3 Special' },
    { cut_id: '625865', alt_material: 'MCHR ZNAK 3 Special' },   // второе обеспечение — то же имя
    { cut_id: '625873', alt_material: '' },                       // альта нет — задания в карте нет
    { cut_id: '625874' }                                          // колонки нет вовсе
];
assertEqual(rowsToCutAlts(planningRows), { '625865': 'MCHR ZNAK 3 Special' },
    '#4996: alt_material → { задание: альт-имя }, без пустых');
assertEqual(rowsToCutAlts([]), {}, '#4996: пустой отчёт → пустая карта альтов');

// ── карточка очереди (cutSpecText) ─────────────────────────────────────────────────────────────
function specInst(opts) {
    var o = opts || {};
    var inst = Object.create(Controller.prototype);
    inst.cutAlts = o.cutAlts === undefined ? {} : o.cutAlts;
    inst.cutWidths = o.cutWidths === undefined ? { '625865': ['110'] } : o.cutWidths;
    inst.findBatch = function() { return o.batch || null; };
    return inst;
}
var CUT = { id: '625865', material: 'MWR113L', runLength: '1000', winding: 'OUT', plannedRuns: '10' };

assertEqual(Controller.prototype.cutSpecText.call(specInst({
        cutAlts: { '625865': 'MCHR ZNAK 3 Special' }
    }), CUT),
    'MCHR ZNAK 3 Special 110 x 1000 OUT - 10 резок',
    '#4996: карточка очереди пишет альт-имя вместо внутреннего');
assertEqual(Controller.prototype.cutSpecText.call(specInst(), CUT),
    'MWR113L 110 x 1000 OUT - 10 резок',
    '#4996: альта нет — карточка как раньше');
assertEqual(Controller.prototype.cutSpecText.call(specInst({
        cutAlts: { '625865': 'MCHR ZNAK 3 Special' },
        batch: { materialLabel: 'ИМЯ ИЗ ПАРТИИ' }
    }), CUT),
    'MCHR ZNAK 3 Special 110 x 1000 OUT - 10 резок',
    '#4996: альт старше и имени из партии сырья');

// ── сводка задания (renderCutSpec) ─────────────────────────────────────────────────────────────
function renderSpec(inst, cut) {
    inst.currentCut = cut;
    var node = Controller.prototype.renderCutSpec.call(inst);
    return node.textContent;
}
assertEqual(renderSpec(specInst({ cutAlts: { '625865': 'MCHR ZNAK 3 Special' } }), CUT),
    'MCHR ZNAK 3 Special / 1000 м / OUT / —',
    '#4996: сводка задания показывает альт-имя');
assertEqual(renderSpec(specInst(), CUT),
    'MWR113L / 1000 м / OUT / —',
    '#4996: альта нет — сводка как раньше');

// ── проводка: loadCutOrders кладёт карту альтов из ответа cut_planning ─────────────────────────
(function() {
    var inst = Object.create(Controller.prototype);
    inst.selectedSlitterId = '1282';
    inst.cutOrdersSlitterId = null;
    inst.cutAlts = {};
    inst.cutOrders = {};
    inst.cutWidths = {};
    inst.getJson = function(url) {
        assert(/report\/cut_planning/.test(url), '#4996: loadCutOrders читает cut_planning');
        return Promise.resolve([
            { cut_id: '625865', alt_material: 'MCHR ZNAK 3 Special' },
            { cut_id: '625873', alt_material: '' }
        ]);
    };
    Controller.prototype.loadCutOrders.call(inst).then(function() {
        assertEqual(inst.cutAlts, { '625865': 'MCHR ZNAK 3 Special' },
            '#4996: после загрузки очереди карта альтов на месте');
        // сброс при смене станка/без станка — альты не переживают старый выбор
        inst.selectedSlitterId = null;
        return Controller.prototype.loadCutOrders.call(inst).then(function() {
            assertEqual(inst.cutAlts, {}, '#4996: сброс очереди сбрасывает и альты');
            finish();
        });
    }).catch(function(err) {
        total++;
        console.log('FAIL — #4996: loadCutOrders упал: ' + (err && err.message || err));
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
