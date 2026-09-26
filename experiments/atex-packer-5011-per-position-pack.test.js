// #5011 — «Упаковано» на каждую позицию слитой плашки.
//
// Кнопка «Упаковано» на карточке заказа (#4918) отмечает ВСЕ позиции разом:
// упаковщику, у которого размеры уезжают в разные моменты, нужно отметить
// одну позицию, не трогая остальные. Теперь:
//   • у каждой неупакованной строки-описания слитой плашки — СВОЯ кнопка
//     «Упаковано», пишущая только эту Партию ГП (и событие смены только по ней);
//   • карточная кнопка остаётся «упаковать всё остатком» (#4918 не сломан);
//   • частично упакованная плашка получает бейдж «частично» уже после
//     по-позиционной отметки — упакованная строка своей кнопки больше не имеет.
//
// Run with: node experiments/atex-packer-5011-per-position-pack.test.js

// ── Минимальный DOM-стаб (как в atex-packer-4999-per-size-qty.test.js) ──
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
            var has = self._classes().indexOf(c) !== -1;
            var want = force == null ? !has : !!force;
            if (want && !has) this.add(c);
            if (!want && has) this.remove(c);
            return want;
        }
    };
}
StubNode.prototype._classes = function() { return this._className.split(/\s+/).filter(Boolean); };
Object.defineProperty(StubNode.prototype, 'className', { get: function() { return this._className; }, set: function(v) { this._className = String(v || ''); } });
Object.defineProperty(StubNode.prototype, 'textContent', {
    get: function() { if (this.childNodes.length) return this.childNodes.map(function(c) { return c.textContent; }).join(''); return this._text; },
    set: function(v) { this._text = String(v == null ? '' : v); this.childNodes = []; } });
Object.defineProperty(StubNode.prototype, 'innerHTML', { get: function() { return ''; }, set: function(v) { if (v === '') { this.childNodes = []; this._text = ''; } } });
Object.defineProperty(StubNode.prototype, 'firstChild', { get: function() { return this.childNodes[0] || null; } });
StubNode.prototype.appendChild = function(n) { this.childNodes.push(n); n.parentNode = this; return n; };
StubNode.prototype.removeChild = function(n) { this.childNodes = this.childNodes.filter(function(c) { return c !== n; }); return n; };
StubNode.prototype.setAttribute = function(k, v) { this.attributes[k] = String(v); if (k === 'value') this.value = String(v); };
StubNode.prototype.getAttribute = function(k) { return this.attributes[k] == null ? null : this.attributes[k]; };
StubNode.prototype.addEventListener = function(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); };
StubNode.prototype.dispatch = function(ev, e) { (this._listeners[ev] || []).forEach(function(fn) { fn(e || {}); }); };
StubNode.prototype.click = function() { this.dispatch('click', { target: this }); };
StubNode.prototype.focus = function() {};
StubNode.prototype._all = function(acc) { this.childNodes.forEach(function(c) { if (c instanceof StubNode) { acc.push(c); c._all(acc); } }); return acc; };
StubNode.prototype.querySelectorAll = function(sel) {
    var tag = /^[A-Za-z]/.test(sel) ? sel.toUpperCase() : '';
    var classes = sel.replace(/^[A-Za-z]*/, '').split('.').filter(Boolean);
    return this._all([]).filter(function(n) {
        if (tag && n.tagName !== tag) return false;
        return classes.every(function(c) { return n.classList.contains(c); });
    });
};
StubNode.prototype.querySelector = function(sel) { return this.querySelectorAll(sel)[0] || null; };

global.document = {
    createElement: function(tag) { return new StubNode(tag); },
    createTextNode: function(t) { var n = new StubNode('#text'); n._text = String(t == null ? '' : t); return n; },
    body: new StubNode('body'), readyState: 'loading', getElementById: function() { return null; }, addEventListener: function() {}
};
global.window = { db: 'testdb' };

var mod = require('../download/atex/js/packer.js');
var core = mod.core;

var passed = 0, total = 0;
function assertEqual(actual, expected, name) {
    total++;
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name + (ok ? '' : ' (ожидалось ' + JSON.stringify(expected) + ', получено ' + JSON.stringify(actual) + ')'));
    if (ok) passed++; else process.exitCode = 1;
}
function assert(cond, name) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}
// Секция красного прогона: пока функций нет, падение секции — это FAIL, а не обрыв теста.
function section(name, fn) {
    try { fn(); } catch (e) {
        total++;
        console.log('FAIL — ' + name + ' (упало: ' + e.message + ')');
        process.exitCode = 1;
    }
}

// Строка отчёта `packer?JSON_KV` — база как в atex-packer-4999-per-size-qty.test.js.
function row(over) {
    var base = {
        task: '1786078800', task_id: '666355', gp_id: '666392',
        order_no: '4615', order: '',
        material: 'MWR113L', cut_width: '110.00', cut_length: '600.00',
        wind_direction: 'IN', sleeve: 'втулка пластик серая для Videojet', add_sleeve: '',
        qty: '5', qty_fact: '5', packed: '', notes: '', events: '1'
    };
    Object.keys(over || {}).forEach(function(k) { base[k] = over[k]; });
    return base;
}
function item(over) { return core.itemFromReportRow(row(over)); }
// Заказ из двух размеров резки — живой сценарий issue #5011 (2 шт + 12 шт).
function twoSizes() {
    return core.groupByOrder([
        item({ gp_id: 'a', task_id: '1', cut_width: '110.00', qty: '2', qty_fact: '2' }),
        item({ gp_id: 'b', task_id: '2', cut_width: '64.00', qty: '12', qty_fact: '12' })
    ])[0];
}

function makeList(items, showPacked) {
    var inst = Object.create(mod.Controller.prototype);
    inst.listEl = new StubNode('div');
    inst.items = items;
    inst.sizes = [];
    inst.showPacked = !!showPacked;
    inst.hasPlace = function() { return true; };
    inst.storeShowPacked = function() {};
    return inst;
}

// ── 1) карточка: кнопка «Упаковано» у каждой неупакованной строки ──
function lineByWidth(card, width) {
    return card.querySelectorAll('.atex-pk-desc').filter(function(d) {
        return d.textContent.indexOf(width) !== -1;
    })[0] || null;
}

section('#5011: у каждой неупакованной строки слитой плашки — своя кнопка «Упаковано»', function() {
    var inst = makeList([twoSizes().items[0], twoSizes().items[1]]);
    inst.renderList();
    var card = inst.listEl.querySelectorAll('.atex-pk-card')[0];
    assertEqual(inst.listEl.querySelectorAll('.atex-pk-btn-line').length, 2,
        '#5011: две неупакованные позиции — две строковые кнопки');
    var line110 = lineByWidth(card, '110 х 600');
    var line64 = lineByWidth(card, '64 х 600');
    assert(!!line110 && !!line110.querySelector('.atex-pk-btn-line'),
        '#5011: кнопка стоит у строки размера 110');
    assert(!!line64 && !!line64.querySelector('.atex-pk-btn-line'),
        '#5011: кнопка стоит у строки размера 64');
    if (line110) assertEqual(line110.querySelector('.atex-pk-btn-line').textContent, 'Упаковано',
        '#5011: на строковой кнопке тот же текст «Упаковано»');
    // Карточная кнопка на месте (#4918 не тронут).
    var side = card.querySelector('.atex-pk-side');
    assert(!!side && !!side.querySelectorAll('button').filter(function(b) { return b.textContent === 'Упаковано'; })[0],
        '#5011: карточная кнопка «Упаковано» осталась');
});

section('#5011: частично упакованный заказ — кнопка только у неупакованной строки', function() {
    var inst = makeList([
        item({ gp_id: 'a', task_id: '1', cut_width: '110.00', qty: '60', qty_fact: '60', packed: '60' }),
        item({ gp_id: 'b', task_id: '2', cut_width: '64.00', qty: '50', qty_fact: '50' })
    ]);
    inst.renderList();
    var card = inst.listEl.querySelectorAll('.atex-pk-card')[0];
    assertEqual(inst.listEl.querySelectorAll('.atex-pk-btn-line').length, 1,
        '#5011: упакованная строка без своей кнопки');
    var line64 = lineByWidth(card, '64 х 600');
    assert(!!line64 && !!line64.querySelector('.atex-pk-btn-line'),
        '#5011: кнопка — у неупакованной строки');
});

section('#5011: одиночная позиция — без строковой кнопки', function() {
    var inst = makeList([item({ gp_id: 'a', task_id: '1', qty: '110', qty_fact: '110' })]);
    inst.renderList();
    assertEqual(inst.listEl.querySelectorAll('.atex-pk-btn-line').length, 0,
        '#5011: у одиночной позиции карточная кнопка и так пишет её одну — дубля нет');
});

// ── 2) поведение: строковая кнопка пишет ТОЛЬКО свою позицию ──
function writtenFor(inst) {
    var written = [];
    inst._writePack = function(pos, qty, note) {
        written.push({ gpId: pos.gpId, qty: qty, note: note });
        return Promise.resolve();
    };
    return written;
}

section('#5011: клик по строке пишет только эту Партию ГП', function() {
    var inst = makeList([twoSizes().items[0], twoSizes().items[1]]);
    var written = writtenFor(inst);
    var said = [];
    inst.notify = function(message, kind) { said.push({ message: message, kind: kind }); };
    inst.renderList();
    var card = inst.listEl.querySelectorAll('.atex-pk-card')[0];
    var line64 = lineByWidth(card, '64 х 600');
    var btn = line64 && line64.querySelector('.atex-pk-btn-line');
    assert(!!btn, '#5011: у строки 64 есть кнопка');
    if (btn) btn.click();
    setImmediate(function() {
        assertEqual(written, [{ gpId: 'b', qty: 12, note: '' }],
            '#5011: записана только позиция 64 своим количеством');
        assertEqual(core.isPacked(inst.items[0]), false, '#5011: позиция 110 осталась неупакованной');
        assertEqual(core.isPacked(inst.items[1]), true, '#5011: позиция 64 закрыта');
        assertEqual(said[said.length - 1] && said[said.length - 1].kind, 'success',
            '#5011: оператор получил подтверждение');
        done();
    });
});

section('#5011: правка и примечание строки уезжают с ней же', function() {
    var inst = makeList([twoSizes().items[0], twoSizes().items[1]]);
    var written = writtenFor(inst);
    inst.notify = function() {};
    inst.items[0].editedQty = 1;
    inst.items[0].editedNote = '1 шт в брак';
    inst.renderList();
    var card = inst.listEl.querySelectorAll('.atex-pk-card')[0];
    var line110 = lineByWidth(card, '110 х 600');
    var btn = line110 && line110.querySelector('.atex-pk-btn-line');
    assert(!!btn, '#5011: у строки 110 есть кнопка');
    if (btn) btn.click();
    setImmediate(function() {
        assertEqual(written, [{ gpId: 'a', qty: 1, note: '1 шт в брак' }],
            '#5011: строка ушла с правленым количеством и своим примечанием');
        assertEqual(core.isPacked(inst.items[1]), false, '#5011: позиция 64 не тронута');
        done();
    });
});

section('#5011: после по-позиционной отметки — «частично» и остаток на карточке', function() {
    var inst = makeList([twoSizes().items[0], twoSizes().items[1]]);
    var written = writtenFor(inst);
    inst.notify = function() {};
    inst.renderList();
    var card = inst.listEl.querySelectorAll('.atex-pk-card')[0];
    var line64 = lineByWidth(card, '64 х 600');
    var btn = line64 && line64.querySelector('.atex-pk-btn-line');
    if (btn) btn.click();
    setImmediate(function() {
        assertEqual(written.length, 1, '#5011: подготовка — записана одна позиция');
        inst.renderList();
        card = inst.listEl.querySelectorAll('.atex-pk-card')[0];
        assert(!!card.querySelector('.atex-pk-badge.is-partial'), '#5011: плашка помечена «частично»');
        assertEqual(inst.listEl.querySelectorAll('.atex-pk-btn-line').length, 1,
            '#5011: кнопка осталась только у неупакованной строки');
        var qty = card.querySelector('.atex-pk-qty-value');
        assertEqual(qty ? qty.textContent : null, '2', '#5011: крупно — остаток по неупакованным');
        var side = card.querySelector('.atex-pk-side');
        assert(!!side && !!side.querySelectorAll('button').filter(function(b) { return b.textContent === 'Упаковано'; })[0],
            '#5011: карточная кнопка дописывает остаток');
        done();
    });
});

section('#5011: карточная кнопка по-прежнему пишет ВСЕ неупакованные (#4918)', function() {
    var inst = makeList([twoSizes().items[0], twoSizes().items[1]]);
    var written = writtenFor(inst);
    inst.notify = function() {};
    inst.renderList();
    var card = inst.listEl.querySelectorAll('.atex-pk-card')[0];
    var side = card.querySelector('.atex-pk-side');
    var btn = side && side.querySelectorAll('button').filter(function(b) { return b.textContent === 'Упаковано'; })[0];
    assert(!!btn, '#5011: карточная кнопка на месте');
    if (btn) btn.click();
    setImmediate(function() {
        assertEqual(written, [
            { gpId: 'a', qty: 2, note: '' },
            { gpId: 'b', qty: 12, note: '' }
        ], '#5011: карточная кнопка отметила обе позиции — по-позиционные не мешают (#4918)');
        done();
    });
});

// ── 3) неизвестное количество строки — правка, записи нет ──
section('#5011: строка без количества — сообщение и правка, записи нет', function() {
    var inst = makeList([
        item({ gp_id: 'a', task_id: '1', cut_width: '110.00', qty: '2', qty_fact: '2' }),
        item({ gp_id: 'b', task_id: '2', cut_width: '64.00', qty: '', qty_fact: '' })
    ]);
    var written = writtenFor(inst);
    var said = [], askedSizes = [], askedQty = [];
    inst.notify = function(message, kind) { said.push({ message: message, kind: kind }); };
    inst.openSizesDialog = function(group, unpacked) { askedSizes.push((unpacked || []).length); };
    inst.openQtyDialog = function() { askedQty.push(1); };
    inst.renderList();
    var card = inst.listEl.querySelectorAll('.atex-pk-card')[0];
    var line64 = lineByWidth(card, '64 х 600');
    var btn = line64 && line64.querySelector('.atex-pk-btn-line');
    assert(!!btn, '#5011: кнопка у нулевой строки есть — отмечать просто нечем');
    if (btn) btn.click();
    assertEqual(written, [], '#5011: нулевое количество строки не пишется');
    assertEqual(askedQty, [1], '#5011: вместо записи открыта правка количества позиции');
    assertEqual(askedSizes, [], '#5011: диалог по размерам не звался — строка и есть один размер');
    assertEqual(said.length, 1, '#5011: оператору сказано, почему отметка не прошла');
});

// Асинхронные секции — ждём все перед итоговой строкой.
var asyncLeft = 4;
function done() {
    if (--asyncLeft) return;
    console.log('\n' + passed + '/' + total + ' assertions passed');
    if (process.exitCode) process.exit(process.exitCode);
}
