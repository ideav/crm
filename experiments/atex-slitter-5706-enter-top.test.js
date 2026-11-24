// #5706 — пульт слиттера, кнопка «Ввод» (продолжение #5575, решение владельца).
//   1) Стоит справа вверху, под именем пользователя в шапке: вне сетки полей показаний,
//      position: fixed у правого края, сразу под навбаром.
//   2) Видна, только если есть несохранённая правка; без правок её нет (hidden + display: none).
//   3) В 1.5 раза больше прежней: кегль не меньше 24px (был 16px).
//   4) Нажатие не уводит фокус до click: кнопка прячется на blur поля, и без
//      preventDefault на mousedown касание доставалось бы тому, что под ней.
//
// rules: none (defect #5706)
// Run with: node experiments/atex-slitter-5706-enter-top.test.js

process.env.TZ = 'Europe/Moscow';

var fs = require('fs');
var path = require('path');
var ROOT = path.join(__dirname, '..');

// ── Минимальный DOM-стаб (как в atex-slitter-4783.test.js) ──
function StubNode(tag) {
    this.tagName = String(tag || '').toUpperCase();
    this.childNodes = []; this.attributes = {}; this.dataset = {}; this.style = {};
    this._className = ''; this._text = ''; this._listeners = {}; this.value = ''; this.disabled = false;
    var self = this;
    this.classList = {
        add: function(c) { if (self._classes().indexOf(c) === -1) self._className = (self._className + ' ' + c).trim(); },
        remove: function(c) { self._className = self._classes().filter(function(x) { return x !== c; }).join(' '); },
        contains: function(c) { return self._classes().indexOf(c) !== -1; },
        toggle: function(c, force) {
            var has = self.classList.contains(c);
            var want = force === undefined ? !has : !!force;
            if (want && !has) self.classList.add(c);
            if (!want && has) self.classList.remove(c);
        }
    };
}
StubNode.prototype._classes = function() { return this._className.split(/\s+/).filter(Boolean); };
Object.defineProperty(StubNode.prototype, 'className', { get: function() { return this._className; }, set: function(v) { this._className = String(v || ''); } });
Object.defineProperty(StubNode.prototype, 'textContent', {
    get: function() { if (this.childNodes.length) return this.childNodes.map(function(c) { return c.textContent; }).join(''); return this._text; },
    set: function(v) { this._text = String(v == null ? '' : v); this.childNodes = []; } });
StubNode.prototype.appendChild = function(n) { this.childNodes.push(n); n.parentNode = this; return n; };
StubNode.prototype.setAttribute = function(k, v) { this.attributes[k] = String(v); };
StubNode.prototype.getAttribute = function(k) { return this.attributes[k] == null ? null : this.attributes[k]; };
StubNode.prototype.addEventListener = function(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); };
StubNode.prototype.dispatch = function(ev, e) { (this._listeners[ev] || []).forEach(function(fn) { fn(e || {}); }); };
StubNode.prototype.focus = function() { global.document.activeElement = this; this.dispatch('focus'); };
StubNode.prototype.blur = function() {
    if (global.document.activeElement !== this) return;
    global.document.activeElement = global.document.body;
    this.dispatch('blur');
};
StubNode.prototype.click = function() { this.dispatch('click', { target: this }); };
StubNode.prototype._all = function(acc) { this.childNodes.forEach(function(c) { if (c instanceof StubNode) { acc.push(c); c._all(acc); } }); return acc; };
StubNode.prototype.querySelectorAll = function(sel) { var cls = sel.replace(/^\./, ''); return this._all([]).filter(function(n) { return n.classList.contains(cls); }); };
StubNode.prototype.querySelector = function(sel) { return this.querySelectorAll(sel)[0] || null; };

global.document = {
    createElement: function(tag) { return new StubNode(tag); },
    createTextNode: function(t) { var n = new StubNode('#text'); n._text = String(t == null ? '' : t); return n; },
    body: new StubNode('body'), readyState: 'loading',
    getElementById: function() { return null; }, addEventListener: function() {},
    querySelector: function() { return null; }
};
global.document.activeElement = global.document.body;
global.window = { db: 'ateh' };

var api = require('../download/atex/js/slitter.js');
var Controller = api.Controller;

var passed = 0, total = 0;
function assert(cond, name) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}

function makeInst() {
    var inst = Object.create(Controller.prototype);
    inst.root = new StubNode('div');
    inst.busy = false;
    inst.db = 'ateh';
    inst.selectedBatchIds = ['77'];
    inst.currentStrips = [];
    inst.currentCut = {
        id: '90', batchId: '77', status: 'В работе', actualRuns: '1', plannedRuns: '4',
        runLength: '400', material: 'БОПП 20', winding: 'OUT', leader: 'Лидер 40',
        counterStart: '1000', counterEnd: '', defectM: '', notes: '', materialWidthMm: 900
    };
    inst.currentCutId = '90';
    inst.posts = [];
    inst.post = function(p, params) { this.posts.push({ path: p, params: params }); return Promise.resolve({}); };
    inst.cutFields = function() { return { t1: 1 }; };
    inst.setBusy = function(v) { this.busy = v; };
    inst.notify = function() {};
    inst.loadJumboRecords = function() {};
    inst.findBatch = function() { return null; };
    return inst;
}

function enterButton(wrap) {
    return wrap.querySelectorAll('.atex-sl-btn').filter(function(b) { return b.textContent === 'Ввод'; })[0] || null;
}
function lit(btn) { return !!btn && !btn.disabled && btn.classList.contains('is-dirty'); }
function shown(btn) { return lit(btn) && !btn.hidden; }

// ── 1, 2, 4) место, видимость и нажатие ──
(function() {
    var inst = makeInst();
    var wrap = inst.renderReadings();
    var section = wrap.querySelectorAll('.atex-sl-section')[0];
    var btn = section && enterButton(section);
    assert(!!btn, '#5706: кнопка «Ввод» есть в панели показаний');
    if (!btn) return;
    var grid = section.querySelectorAll('.atex-sl-grid')[0];
    assert(grid._all([]).indexOf(btn) === -1, '#5706: «Ввод» не в сетке полей (место — справа вверху)');
    assert(!shown(btn) && btn.hidden === true, '#5706: без правок кнопки не видно');

    var cstart = grid.querySelectorAll('.atex-sl-input')[0];
    cstart.focus();
    cstart.value = '820';
    cstart.dispatch('input');
    assert(shown(btn), '#5706: правка поля показывает кнопку');

    var prevented = false;
    btn.dispatch('mousedown', { preventDefault: function() { prevented = true; } });
    assert(prevented, '#5706: нажатие на «Ввод» не уводит фокус раньше click (кнопка не прячется из-под пальца)');
    btn.click();
    assert(global.document.activeElement !== cstart, '#5706: «Ввод» снимает фокус с поля');
    assert(inst.posts.length === 1, '#5706: запись уходит прежним автосохранением');
    assert(!shown(btn) && btn.hidden === true, '#5706: после записи кнопка снова скрыта');
})();

// ── 1, 2, 3) стили ──
(function() {
    var sheet = fs.readFileSync(path.join(ROOT, 'download', 'atex', 'css', 'slitter.css'), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '');
    var flat = sheet.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
    var rules = [];
    var re = /([^{}]+)\{([^{}]*)\}/g, m;
    while ((m = re.exec(flat))) {
        var decls = {};
        m[2].split(';').forEach(function(p) {
            var k = p.indexOf(':');
            if (k > 0) decls[p.slice(0, k).trim()] = p.slice(k + 1).trim();
        });
        m[1].split(',').forEach(function(sel) { rules.push({ sel: sel.trim(), decls: decls }); });
    }
    function decl(sel, prop) {
        var v = null;
        rules.forEach(function(r) { if (r.sel === sel && prop in r.decls) v = r.decls[prop]; });
        return v;
    }
    assert(decl('.atex-sl-enter', 'position') === 'fixed', '#5706: «Ввод» закреплена в окне (position: fixed)');
    assert(decl('.atex-sl-enter', 'right') != null && decl('.atex-sl-enter', 'top') != null,
        '#5706: «Ввод» у правого верхнего края');
    var top = parseFloat(decl('.atex-sl-enter', 'top'));
    assert(top >= 44 && top <= 80, '#5706: «Ввод» под шапкой с именем пользователя (top=' + top + 'px)');
    var fs_ = parseFloat(decl('.atex-sl-enter', 'font-size'));
    assert(fs_ >= 24, '#5706: кегль «Ввод» в 1.5 раза больше прежних 16px (сейчас ' + fs_ + 'px)');
    assert(decl('.atex-sl-enter:not(.is-dirty)', 'display') === 'none', '#5706: без правки кнопка не отображается');
})();

console.log('\n' + passed + '/' + total + ' assertions passed');
if (passed !== total) process.exitCode = 1;
