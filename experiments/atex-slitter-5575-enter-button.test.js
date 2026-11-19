// #5575 — пульт слиттера.
//   1) Спецификация задания (.atex-sl-spec: «Вид сырья / Метраж / Намотка / Лидер» и втулка)
//      читается у станка — кегль не меньше 20px (был 15px, «мелко»).
//   2) В секции показаний (.atex-sl-section) — явная кнопка «Ввод». Её дело — только снять
//      фокус с поля: запись уходит тем же автосохранением по выходу из ячейки (#4783 п.10).
//      Пока ничего не правили — кнопка погашена; правка любого поля панели её зажигает;
//      выход из поля (кнопкой или иначе) — снова гасит.
//
// Run with: node experiments/atex-slitter-5575-enter-button.test.js

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

// ── 2) кнопка «Ввод» в секции показаний ──
(function() {
    var inst = makeInst();
    var wrap = inst.renderReadings();
    var section = wrap.querySelectorAll('.atex-sl-section')[0];
    var btn = section && enterButton(section);
    assert(!!btn, '#5575: в секции показаний есть кнопка «Ввод»');
    if (!btn) return;
    assert(!lit(btn), '#5575: ничего не правили — кнопка погашена');

    var inputs = section.querySelectorAll('.atex-sl-grid')[0].querySelectorAll('.atex-sl-input');
    var cstart = inputs[0];
    cstart.focus();
    cstart.value = '820';
    cstart.dispatch('input');
    assert(lit(btn), '#5575: правка поля зажигает кнопку');
    assert(inst.posts.length === 0, '#5575: пока фокус в поле — записи нет');

    btn.click();
    assert(global.document.activeElement !== cstart, '#5575: «Ввод» снимает фокус с поля');
    assert(inst.posts.length === 1 && inst.posts[0].path.indexOf('_m_set/90') === 0,
        '#5575: снятие фокуса кнопкой сохраняет показания тем же автосохранением');
    assert(!lit(btn), '#5575: после выхода из поля кнопка снова погашена');

    // примечания — тоже поле панели
    var notes = section.querySelectorAll('.atex-sl-textarea')[0];
    notes.focus();
    notes.value = 'перемотка';
    notes.dispatch('input');
    assert(lit(btn), '#5575: правка примечаний зажигает кнопку');
    notes.blur();
    assert(!lit(btn), '#5575: выход из поля без кнопки тоже гасит её');

    // любое поле панели, а не только сохраняемые показаниями
    var defect = inputs.filter(function(n) { return n.getAttribute('readonly') == null; }).slice(-1)[0];
    defect.focus();
    defect.value = '3';
    defect.dispatch('input');
    assert(lit(btn), '#5575: правка любого поля панели зажигает кнопку');
})();

// ── 1) кегль спецификации задания ──
(function() {
    var sheet = fs.readFileSync(path.join(ROOT, 'download', 'atex', 'css', 'slitter.css'), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '');
    var flat = sheet.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
    var rules = [];
    var re = /([^{}]+)\{([^{}]*)\}/g, m, order = 0;
    while ((m = re.exec(flat))) {
        var decls = {};
        m[2].split(';').forEach(function(p) {
            var k = p.indexOf(':');
            if (k > 0) decls[p.slice(0, k).trim()] = p.slice(k + 1).trim();
        });
        m[1].split(',').forEach(function(sel) { rules.push({ sel: sel.trim(), decls: decls, order: order++ }); });
    }
    // кегль строки спецификации: последнее по каскаду объявление font-size у .atex-sl-spec-line,
    // иначе — наследуемое от .atex-sl-spec
    function fontSize(cls) {
        var best = null;
        rules.forEach(function(r) {
            var last = r.sel.split(/\s+/).pop();
            if (!('font-size' in r.decls) || last.split('.').filter(Boolean).indexOf(cls) === -1) return;
            if (/[:\[>+~*]/.test(last)) return;
            if (!best || r.order > best.order) best = r;
        });
        return best ? parseFloat(best.decls['font-size']) : null;
    }
    var line = fontSize('atex-sl-spec-line');
    var size = line != null ? line : fontSize('atex-sl-spec');
    assert(size >= 20, '#5575: спецификация задания — кегль не меньше 20px (сейчас ' + size + 'px)');
    var sleeve = fontSize('atex-sl-spec-sleeve');
    assert(sleeve == null || sleeve >= 20, '#5575: строка втулки не мельче спецификации');
})();

console.log('\n' + passed + '/' + total + ' assertions passed');
if (passed !== total) process.exitCode = 1;
