// #4999 — в резке несколько размеров: количество в упаковщике — ПО КАЖДОЙ позиции.
//
// Плашка заказа (#4918) схлопывает позиции в одну сумму: упаковщик видит «65 шт»,
// но не видит, сколько из них размера 110 и сколько размера 64. Правка общей суммы
// кладёт разницу в последнюю неупакованную позицию — отдельный размер ею не поправить.
// Теперь:
//   • на слитой плашке у каждой строки-описания — СВОЁ количество (у одиночной
//     позиции оно и так стоит крупно, дублировать нечего);
//   • правка количества при нескольких неупакованных позициях — по полям, по одной
//     на размер, с общей подсказкой отчёта и общим примечанием (оно уходит только
//     изменённым позициям); «разница в последнюю» (#4918) остаётся для случая одной
//     неупакованной позиции;
//   • «Упаковано» по-прежнему пишет каждую Партию ГП своим количеством (#4918).
//
// Run with: node experiments/atex-packer-4999-per-size-qty.test.js

// ── Минимальный DOM-стаб (как в atex-packer-4918-order-merge.test.js) ──
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

// Строка отчёта `packer?JSON_KV` — база как в atex-packer.test.js.
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
// Заказ из двух размеров резки — живой сценарий из experiments/atex-packer.fixture.html.
function twoSizes() {
    return core.groupByOrder([
        item({ gp_id: 'a', task_id: '1', cut_width: '110.00', qty: '5', qty_fact: '5' }),
        item({ gp_id: 'b', task_id: '2', cut_width: '64.00', qty: '60', qty_fact: '60' })
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

// ── 1) ядро: правка по каждой позиции ──
section('#4999: core.applySizesQty — распределяет по позициям', function() {
    var g = twoSizes();
    var changed = core.applySizesQty(g, ['55', '45'], 'уточнено по смене');
    assertEqual(changed, 2, '#4999: изменились обе позиции');
    assertEqual(g.items[0].editedQty, 55, '#4999: размер 110 — своё количество 55');
    assertEqual(g.items[1].editedQty, 45, '#4999: размер 64 — своё количество 45');
    assertEqual(g.items[0].editedNote, 'уточнено по смене', '#4999: примечание ушло первой позиции');
    assertEqual(g.items[1].editedNote, 'уточнено по смене', '#4999: примечание ушло второй позиции');
    assertEqual(core.orderTotal(g), 100, '#4999: общая сумма сложилась из по-позиционных правок');
});

section('#4999: core.applySizesQty — неизменённые позиции не трогаются', function() {
    var g = twoSizes();
    var changed = core.applySizesQty(g, ['5', '45'], 'брак 15');
    assertEqual(changed, 1, '#4999: изменена одна позиция');
    assert(g.items[0].editedQty == null, '#4999: количество «как подсказал отчёт» — правки нет');
    assert(g.items[0].editedNote == null, '#4999: неизменённой позиции примечание не нужно');
    assertEqual(g.items[1].editedQty, 45, '#4999: изменённой позиции — правка');
    assertEqual(g.items[1].editedNote, 'брак 15', '#4999: изменённой позиции — примечание');
});

section('#4999: core.applySizesQty — пустые значения пропускаются', function() {
    var g = twoSizes();
    assertEqual(core.applySizesQty(g, ['', ''], ''), 0, '#4999: пустые поля ничего не меняют');
    assertEqual(core.applySizesQty(g, null, ''), 0, '#4999: значения не переданы — ничего не меняют');
    assert(g.items[0].editedQty == null && g.items[1].editedQty == null, '#4999: правок нет');
});

section('#4999: core.applySizesQty — упакованные позиции не участвуют', function() {
    var g = core.groupByOrder([
        item({ gp_id: 'a', task_id: '1', cut_width: '110.00', qty: '60', qty_fact: '60', packed: '60' }),
        item({ gp_id: 'b', task_id: '2', cut_width: '64.00', qty: '50', qty_fact: '50' }),
        item({ gp_id: 'c', task_id: '3', cut_width: '90.00', qty: '20', qty_fact: '20' })
    ])[0];
    var changed = core.applySizesQty(g, ['50', '25'], '');
    assertEqual(changed, 1, '#4999: из двух неупакованных изменена одна');
    assertEqual(g.items[0].packedQty, 60, '#4999: упакованную позицию правка не касается');
    assert(g.items[0].editedQty == null, '#4999: упакованной позиции правки нет');
    assert(g.items[1].editedQty == null, '#4999: количество совпало с подсказкой — правки нет');
    assertEqual(g.items[2].editedQty, 25, '#4999: значения идут по НЕупакованным позициям');
});

section('#4999: core.applySizesQty — возврат к подсказке снимает правку', function() {
    var g = twoSizes();
    g.items[0].editedQty = 3;
    assertEqual(core.isEdited(g.items[0]), true, '#4999: подготовка — позиция правлена');
    core.applySizesQty(g, ['5', '60'], 'вернули как было');
    assertEqual(g.items[0].editedQty, 5, '#4999: возврат к подсказке записан');
    assertEqual(core.isEdited(g.items[0]), false, '#4999: правки больше нет');
    assert(g.items[1].editedQty == null, '#4999: вторая позиция 60 → 60 не менялась — правки нет');
});

// ── 2) карточка: количество у каждой строки описания ──
function descQtyTexts(card) {
    return card.querySelectorAll('.atex-pk-desc-qty').map(function(s) { return s.textContent; });
}
function descLineByWidth(card, width) {
    return card.querySelectorAll('.atex-pk-desc').filter(function(d) {
        return d.textContent.indexOf(width) !== -1;
    })[0] || null;
}

section('#4999: плашка заказа из двух размеров — количество у каждой строки', function() {
    var inst = makeList([item({ gp_id: 'a', task_id: '1', cut_width: '110.00', qty: '5', qty_fact: '5' }),
                         item({ gp_id: 'b', task_id: '2', cut_width: '64.00', qty: '60', qty_fact: '60' })]);
    inst.renderList();
    var card = inst.listEl.querySelectorAll('.atex-pk-card')[0];
    assertEqual(inst.listEl.querySelectorAll('.atex-pk-card').length, 1, '#4999: заказ из двух размеров — одна плашка');
    assertEqual(descQtyTexts(card), [' · 5 шт', ' · 60 шт'],
        '#4999: у каждой строки — СВОЁ количество');
    var line110 = descLineByWidth(card, '110 х 600');
    var line64 = descLineByWidth(card, '64 х 600');
    assert(!!line110 && !!line110.querySelector('.atex-pk-desc-qty'), '#4999: количество стоит у строки размера 110');
    assert(!!line64 && !!line64.querySelector('.atex-pk-desc-qty'), '#4999: количество стоит у строки размера 64');
    var qty = card.querySelector('.atex-pk-qty-value');
    assertEqual(qty ? qty.textContent : null, '65', '#4999: крупно по-прежнему ОБЩАЯ сумма (5 + 60)');
});

section('#4999: одиночная позиция — без по-позиционных количеств', function() {
    var inst = makeList([item({ gp_id: 'a', task_id: '1', qty: '110', qty_fact: '110' })]);
    inst.renderList();
    var card = inst.listEl.querySelectorAll('.atex-pk-card')[0];
    assertEqual(descQtyTexts(card), [], '#4999: у одиночной позиции количество и так крупно — дублей нет');
});

section('#4999: частично упакованный заказ — у упакованной строки записанное', function() {
    var inst = makeList([
        item({ gp_id: 'a', task_id: '1', cut_width: '110.00', qty: '60', qty_fact: '60', packed: '60' }),
        item({ gp_id: 'b', task_id: '2', cut_width: '64.00', qty: '50', qty_fact: '50' })
    ]);
    inst.renderList();
    var card = inst.listEl.querySelectorAll('.atex-pk-card')[0];
    assertEqual(descQtyTexts(card), [' · 60 шт', ' · 50 шт'],
        '#4999: упакованная строка показывает записанное, неупакованная — остаток');
    var qty = card.querySelector('.atex-pk-qty-value');
    assertEqual(qty ? qty.textContent : null, '50', '#4999: крупно — остаток по неупакованным (#4918 не сломан)');
});

section('#4999: полные повторы строки с тем же количеством схлопываются', function() {
    var inst = makeList([item({ gp_id: 'a', task_id: '1', qty: '5', qty_fact: '5' }),
                         item({ gp_id: 'b', task_id: '2', qty: '5', qty_fact: '5' })]);
    inst.renderList();
    var card = inst.listEl.querySelectorAll('.atex-pk-card')[0];
    assertEqual(inst.listEl.querySelectorAll('.atex-pk-desc').length, 1, '#4999: одинаковые строки — одна');
    assertEqual(descQtyTexts(card), [' · 5 шт'], '#4999: и количество при ней одно');
});

// ── 3) диалог правки: по полю на размер ──
function openDialog(inst, group) {
    inst.openQtyDialog(group);
    // В body висят и оверлеи прошлых секций (диалог с ошибкой не закрывается сам) —
    // берём СВОЙ, последний открытый.
    var all = global.document.body.querySelectorAll('.atex-pk-modal-overlay');
    return all[all.length - 1] || null;
}
function numberInputs(overlay) {
    return overlay.querySelectorAll('input').filter(function(i) { return i.attributes.type === 'number'; });
}
function saveButton(overlay) {
    return overlay.querySelectorAll('button').filter(function(b) { return b.textContent === 'Сохранить'; })[0];
}

section('#4999: диалог многослойного заказа — поле на каждый размер', function() {
    var g = twoSizes();
    var inst = makeList([g.items[0], g.items[1]]);
    var overlay = openDialog(inst, g);
    assert(!!overlay, '#4999: диалог открылся');
    if (!overlay) return;
    var inputs = numberInputs(overlay);
    assertEqual(inputs.length, 2, '#4999: по полю на каждую неупакованную позицию');
    assertEqual(inputs.map(function(i) { return i.value; }), ['5', '60'], '#4999: поля подставлены из карточки');
    var labels = overlay.querySelectorAll('.atex-pk-field').map(function(l) { return l.textContent; });
    assert(labels.some(function(t) { return t.indexOf('110 х 600') !== -1; }), '#4999: у поля размера 110 своя подпись');
    assert(labels.some(function(t) { return t.indexOf('64 х 600') !== -1; }), '#4999: у поля размера 64 своя подпись');
    overlay.close(); // секция закончена — оверлей не висит над следующими секциями
});

section('#4999: правка одного размера без примечания — ошибка, ничего не записано', function() {
    var g = twoSizes();
    var inst = makeList([g.items[0], g.items[1]]);
    var overlay = openDialog(inst, g);
    if (!overlay) { assert(false, '#4999: диалог открылся'); return; }
    var inputs = numberInputs(overlay);
    inputs[0].value = '3';
    saveButton(overlay).click();
    var error = overlay.querySelector('.atex-pk-error');
    assert(!!error && error.textContent.indexOf('примечание') !== -1, '#4999: изменённое количество требует примечания');
    assert(g.items[0].editedQty == null, '#4999: пока ошибка — правка не записана');
    overlay.close(); // оператор отменил — оверлей не висит над следующими секциями
});

section('#4999: правка одного размера — другой не тронут', function() {
    var g = twoSizes();
    var inst = makeList([g.items[0], g.items[1]]);
    var overlay = openDialog(inst, g);
    if (!overlay) { assert(false, '#4999: диалог открылся'); return; }
    var inputs = numberInputs(overlay);
    inputs[0].value = '3';
    var note = overlay.querySelectorAll('input').filter(function(i) { return i.attributes.type !== 'number'; })[0];
    note.value = '2 шт в брак';
    saveButton(overlay).click();
    assertEqual(g.items[0].editedQty, 3, '#4999: размеру 110 записано 3');
    assertEqual(g.items[0].editedNote, '2 шт в брак', '#4999: примечание при изменённом размере');
    assert(g.items[1].editedQty == null, '#4999: размер 64 остался как подсказал отчёт');
    assert(g.items[1].editedNote == null, '#4999: неизменённому размеру примечание не нужно');
    assert(global.document.body.querySelectorAll('.atex-pk-modal-overlay').length === 0, '#4999: после сохранения диалог закрыт');
    var card = inst.listEl.querySelectorAll('.atex-pk-card')[0];
    assertEqual(descQtyTexts(card), [' · 3 шт', ' · 60 шт'], '#4999: карточка показывает правленое по размерам');
    var qty = card.querySelector('.atex-pk-qty-value');
    assertEqual(qty ? qty.textContent : null, '63', '#4999: крупная сумма пересчиталась (3 + 60)');
});

console.log('\n' + passed + '/' + total + ' assertions passed');
if (process.exitCode) process.exit(process.exitCode);
process.exit(0);
