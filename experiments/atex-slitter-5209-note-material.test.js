// #5209 (комментарий 06.11) — пульт слиттера пишет имя сырья так, как оно стоит в Примечании
// позиции заказа.
//
// Заказ 6443: у задания «Вид сырья» 66257 «MR377/MWR265», у него «Альтернативное имя» MWR265.
// Колонка alt_material отчёта cut_planning отдаёт альт-имя только позициям с «Кросс», у 6443
// его нет → шапка показывала «MR377/MWR265». Примечание позиции: «6443 / MWR265 100 х 450 IN …».
// Одно и то же сырьё в разных заказах названо по-разному (MR377 у одних, MWR265 у других),
// поэтому имя берётся из Примечания позиции (колонка position_note): второй участок после
// «/», в начале которого стоит имя этого же сырья — целиком, часть имени через «/» или
// альт-имя (колонка material_alt_name). Чужое имя в Примечании не берётся: тогда как раньше.
//
// Run with: node experiments/atex-slitter-5209-note-material.test.js

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


function rowsToCutAlts(rows) {
    if (typeof core.rowsToCutAlts !== 'function') return '(core.rowsToCutAlts нет)';
    return core.rowsToCutAlts(rows);
}
function noteMaterial(note, material, alt) {
    if (typeof core.materialFromNote !== 'function') return '(core.materialFromNote нет)';
    return core.materialFromNote(note, material, alt);
}

var N6443 = '6443 / MWR265 100 х 450 IN (без трейлера в начале намотки) (П) / 99мм х 9 / 10 резок (891мм)';

// ── имя сырья из Примечания ─────────────────────────────────────────────────────────────────────
assertEqual(noteMaterial(N6443, 'MR377/MWR265', 'MWR265'), 'MWR265',
    '6443: Примечание «MWR265 …» → MWR265, а не «MR377/MWR265»');
assertEqual(noteMaterial(N6443, 'MR377/MWR265', ''), 'MWR265',
    'часть имени через «/» узнаётся и без альт-имени');
assertEqual(noteMaterial('2649 / MR377 33 х 600 OUT (П) / 32,5мм х 27 / 4 резки (877мм)', 'MR377/MWR265', 'MWR265'), 'MR377',
    'то же сырьё, заказ на MR377 → MR377');
assertEqual(noteMaterial(' / Образец MR377 (110*30) IN / 110мм х 8 / 1 резка (880мм)', 'MR377/MWR265', 'MWR265'), 'MR377',
    'образец без номера заказа: «/ Образец MR377 (…)» → MR377');
assertEqual(noteMaterial('2537 / MCHR ZNAK 2 Extra 30 х 300 OUT (П) / 30мм х 29 / 1 резка (870мм)', 'MR194', 'MCHR ZNAK 2 Extra'), 'MCHR ZNAK 2 Extra',
    'альт-имя из нескольких слов в Примечании → альт-имя (без «Кросс»)');
assertEqual(noteMaterial('2600 / MR194 80 х 300 OUT (П) / 80мм х 11 / 2 резки (880мм)', 'MR194', 'MCHR ZNAK 2 Extra'), 'MR194',
    'в Примечании внутреннее имя → внутреннее имя');
assertEqual(noteMaterial('6443 / mwr265 100 х 450 IN', 'MR377/MWR265', 'MWR265'), 'MWR265',
    'регистр в Примечании не важен, имя — как в справочнике');
assertEqual(noteMaterial('7000 / MR3770 100 х 450 IN', 'MR377/MWR265', ''), '',
    'MR3770 — не MR377: имя должно кончаться пробелом/скобкой/концом');
assertEqual(noteMaterial('7001 / TDR330 100 х 450 IN', 'MR377/MWR265', 'MWR265'), '',
    'в Примечании имя другого сырья → пусто (не подменяем)');
assertEqual(noteMaterial('', 'MR377/MWR265', 'MWR265'), '', 'Примечания нет → пусто');
assertEqual(noteMaterial('MWR265 100 х 450 IN', 'MR377/MWR265', 'MWR265'), '',
    'без «/» нет участка с сырьём → пусто');

// ── карта имён по строкам cut_planning ─────────────────────────────────────────────────────────
assertEqual(rowsToCutAlts([
    { cut_id: '1011535', cut_material: 'MR377/MWR265', material_alt_name: 'MWR265', alt_material: '', position_note: N6443 }
]), { '1011535': 'MWR265' }, '6443: задание получает имя из Примечания, хотя alt_material пуст');
assertEqual(rowsToCutAlts([
    { cut_id: '1', cut_material: 'MR194', material_alt_name: 'MCHR ZNAK 2 Extra', alt_material: 'MCHR ZNAK 2 Extra',
      position_note: '2600 / MR194 80 х 300 OUT (П)' }
]), { '1': 'MR194' }, 'Примечание старше alt_material («Кросс»)');
assertEqual(rowsToCutAlts([
    { cut_id: '2', cut_material: 'MR194', material_alt_name: 'MCHR ZNAK 2 Extra', alt_material: 'MCHR ZNAK 2 Extra',
      position_note: 'без разметки' }
]), { '2': 'MCHR ZNAK 2 Extra' }, 'Примечание не разобралось → alt_material, как раньше');
assertEqual(rowsToCutAlts([
    { cut_id: '3', cut_material: 'MR194', alt_material: '' }
]), {}, 'колонок нет → карта пуста, как раньше');

// ── шапка и карточка очереди 6443 ──────────────────────────────────────────────────────────────
var CUT = { id: '1011535', material: 'MR377/MWR265', runLength: '450', winding: 'IN', leader: 'MONOCHROME', plannedRuns: '10' };
function inst(cutAlts) {
    var o = Object.create(Controller.prototype);
    o.cutAlts = cutAlts; o.cutWidths = { '1011535': ['100'] }; o.cutSleeves = {};
    o.findBatch = function() { return null; };
    return o;
}
var alts = rowsToCutAlts([{ cut_id: '1011535', cut_material: 'MR377/MWR265', material_alt_name: 'MWR265', alt_material: '', position_note: N6443 }]);
if (typeof alts !== 'object') alts = {};
var spec = inst(alts); spec.currentCut = CUT;
assertEqual(Controller.prototype.renderCutSpec.call(spec).textContent, 'MWR265 / 450 м / IN / MONOCHROME',
    '6443: шапка задания — MWR265');
assertEqual(Controller.prototype.cutSpecText.call(inst(alts), CUT), 'MWR265 100 x 450 IN - 10 резок',
    '6443: карточка очереди — MWR265');

console.log('\n' + passed + '/' + total + ' assertions passed');
if (passed !== total) process.exitCode = 1;
