// Tests for ideav/crm#4918 — задания на упаковку одного заказа — ОДНА плашка.
//
// Заказ, разбитый на несколько заданий, показывался упаковщику несколькими карточками,
// и оператор не видел, сколько ему всего упаковать. Теперь список группируется по
// ЗАКАЗУ (order_no), а не по заданию:
//   • количество плашки — общая сумма рулонов неупакованных позиций;
//   • выполненные и невыполненные позиции одного заказа — одна плашка «как невыполненная»
//     со статусом «частично»;
//   • «Упаковано» отмечает ВСЕ позиции заказа — каждая своим количеством (запись, как
//     и прежде, в каждую Партию ГП — «Дэшборд отклонений» (#4774) остаётся согласованным);
//   • правка количества на плашке меняет ОБЩУЮ сумму, разница уходит в последнюю
//     неупакованную позицию и может получиться отрицательной.
// Голый item в renderCard/packNow/openQtyDialog по-прежнему работает — это одна позиция.
//
// Run with: node experiments/atex-packer-4918-order-merge.test.js

process.env.TZ = 'UTC';

// ── Минимальный DOM-стаб (как в atex-slitter-4916-jumbo-tab-row.test.js) ──
function StubNode(tag) {
    this.tagName = String(tag || '').toUpperCase();
    this.childNodes = []; this.attributes = {}; this.dataset = {}; this.style = {};
    this._className = ''; this._text = ''; this._listeners = {}; this.value = ''; this.disabled = false;
    var self = this;
    this.classList = {
        add: function(c) { if (self._classes().indexOf(c) === -1) self._className = (self._className + ' ' + c).trim(); },
        remove: function(c) { self._className = self._classes().filter(function(x) { return x !== c; }).join(' '); },
        contains: function(c) { return self._classes().indexOf(c) !== -1; }
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

// Строка отчёта `packer?JSON_KV` (как в базовом atex-packer.test.js).
function row(over) {
    var base = {
        task: '1786078800', task_id: '666355', gp_id: '666392',
        order_no: '4619', order: '',
        material: 'MWR113L', cut_width: '110.00', cut_length: '600.00',
        wind_direction: 'IN', sleeve: 'втулка пластик серая для Videojet', add_sleeve: '',
        qty: '110', qty_fact: '110', packed: '', notes: '', events: '1'
    };
    Object.keys(over || {}).forEach(function(k) { base[k] = over[k]; });
    return base;
}
function item(over) { return core.itemFromReportRow(row(over)); }
function gpIds(group) { return group.items.map(function(i) { return i.gpId; }); }

// ── 1) группировка по ЗАКАЗУ, а не по заданию ──
section('#4918: core.groupByOrder', function() {
    var groups = core.groupByOrder([
        item({ task_id: '666355', gp_id: 'a', order_no: '4619' }),
        item({ task_id: '662041', gp_id: 'b', order_no: '4572' }),
        item({ task_id: '670001', gp_id: 'c', order_no: '4619' }),
        item({ task_id: '662999', gp_id: 'd', order_no: '' }),
        item({ task_id: '663000', gp_id: 'e', order_no: '' })
    ]);
    assertEqual(groups.map(function(g) { return g.orderNo; }), ['4619', '4572', '', ''],
        '#4918: группы по order_no, порядок — первое появление');
    assertEqual(gpIds(groups[0]), ['a', 'c'], '#4918: задания одного заказа — в одной группе');
    assertEqual(gpIds(groups[1]), ['b'], '#4918: чужой заказ — отдельная группа');
    assertEqual(gpIds(groups[2]), ['d'], '#4918: пустой номер — одиночная группа');
    assertEqual(gpIds(groups[3]), ['e'], '#4918: пустые номера друг с другом не сливаются');
    assertEqual(groups[0].taskUnix, 1786078800, '#4918: время задания у группы — от первой позиции');
});

// ── 2) сумма, «частично», готовность ──
section('#4918: orderTotal/orderPartial/orderDone', function() {
    var groups = core.groupByOrder([
        item({ gp_id: 'a', order_no: '4619', task_id: '1', qty: '60', qty_fact: '60', packed: '60' }),
        item({ gp_id: 'b', order_no: '4619', task_id: '2', qty: '50', qty_fact: '50', packed: '' })
    ]);
    var g = groups[0];
    assertEqual(core.orderDone(g), false, '#4918: не всё упаковано — заказ живёт');
    assertEqual(core.orderPartial(g), true, '#4918: выполненные и невыполненные — статус «частично»');
    assertEqual(core.orderTotal(g), 50, '#4918: сумма к упаковке — по НЕупакованным позициям');
    g.items[1].editedQty = 45;
    assertEqual(core.orderTotal(g), 45, '#4918: правка позиции входит в общую сумму');

    var all = core.groupByOrder([
        item({ gp_id: 'x', order_no: '1', qty: '10', qty_fact: '10', packed: '10' }),
        item({ gp_id: 'y', order_no: '1', qty: '5', qty_fact: '5', packed: '5' })
    ])[0];
    assertEqual(core.orderDone(all), true, '#4918: всё упаковано — заказ готов');
    assertEqual(core.orderPartial(all), false, '#4918: у готового заказа «частично» нет');
    assertEqual(core.orderTotal(all), 0, '#4918: готовому заказу упаковывать нечего');

    var fresh = core.groupByOrder([
        item({ gp_id: 'p', order_no: '2', qty: '10', qty_fact: '' }),
        item({ gp_id: 'q', order_no: '2', qty: '6', qty_fact: '' })
    ])[0];
    assertEqual(core.orderPartial(fresh), false, '#4918: ничего не упаковано — «частично» нет');
    assertEqual(core.orderTotal(fresh), 16, '#4918: факта нет — сумма считается от плана');
});

// ── 3) правка ОБЩЕГО количества: разница — в последнюю неупакованную ──
section('#4918: applyOrderQty', function() {
    var g = core.groupByOrder([
        item({ gp_id: 'a', order_no: '4619', task_id: '1', qty: '60', qty_fact: '60', packed: '' }),
        item({ gp_id: 'b', order_no: '4619', task_id: '2', qty: '50', qty_fact: '50', packed: '' })
    ])[0];

    core.applyOrderQty(g, 100);
    assert(g.items[0].editedQty == null, '#4918: первая позиция правка общего не трогает');
    assertEqual(g.items[1].editedQty, 40, '#4918: разница (100 − 110) ушла в последнюю');
    assertEqual(core.orderTotal(g), 100, '#4918: общая сумма стала введённой');

    core.applyOrderQty(g, 55);
    assertEqual(g.items[1].editedQty, -5, '#4918: разница может получиться ОТРИЦАТЕЛЬНОЙ');
    assertEqual(core.orderTotal(g), 55, '#4918: сумма следует за правкой');

    // Упакованные позиции не участвуют: последняя неупакованная — «b».
    var mixed = core.groupByOrder([
        item({ gp_id: 'a', order_no: '1', qty: '60', qty_fact: '60', packed: '60' }),
        item({ gp_id: 'b', order_no: '1', qty: '50', qty_fact: '50', packed: '' }),
        item({ gp_id: 'c', order_no: '1', qty: '20', qty_fact: '20', packed: '' })
    ])[0];
    core.applyOrderQty(mixed, 60);
    assert(mixed.items[1].editedQty == null, '#4918: упакованную и не-последнюю правка не касается');
    assertEqual(mixed.items[2].editedQty, 10, '#4918: последняя НЕупакованная — в неё разница');
});

// ── 4) отрицательная «Упаковано шт» закрывает позицию ──
section('#4918: isPacked с отрицательной записью', function() {
    assertEqual(core.isPacked(item({ packed: '-5' })), true,
        '#4918: запись −5 (разница уехала в минус) — позиция закрыта');
    assertEqual(core.isPacked(item({ packed: '0' })), false, '#4918: 0 — по-прежнему не упаковано');
    assertEqual(core.isPacked(item({ packed: '' })), false, '#4918: пусто — не упаковано');
    assertEqual(core.isPacked(item({ packed: '110' })), true, '#4918: положительная запись — упаковано');
});

// ── 5) список: плашка на ЗАКАЗ ──
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

section('#4918: renderList — плашка на заказ', function() {
    var inst = makeList([
        item({ gp_id: 'a', order_no: '4619', task_id: '1', qty: '60', qty_fact: '60', task: '1786078800' }),
        item({ gp_id: 'b', order_no: '4572', task_id: '2', qty: '16', qty_fact: '16' }),
        item({ gp_id: 'c', order_no: '4619', task_id: '3', qty: '50', qty_fact: '50' })
    ]);
    inst.renderList();
    var cards = inst.listEl.querySelectorAll('.atex-pk-card');
    assertEqual(cards.length, 2, '#4918: плашка на заказ — задания 4619 схлопнулись');
    var qty = cards[0] ? cards[0].querySelector('.atex-pk-qty-value') : null;
    assertEqual(qty ? qty.textContent : null, '110', '#4918: на плашке ОБЩЕЕ количество (60 + 50)');
    var badge = cards[0] ? cards[0].querySelector('.atex-pk-badge.is-partial') : null;
    assertEqual(badge ? badge.textContent : '', '', '#4918: ничего не упаковано — «частично» нет');

    // Смешанный заказ: часть упакована → «частично», сумма — остаток.
    var inst2 = makeList([
        item({ gp_id: 'a', order_no: '4619', task_id: '1', qty: '60', qty_fact: '60', packed: '60' }),
        item({ gp_id: 'b', order_no: '4619', task_id: '2', qty: '50', qty_fact: '50', packed: '' })
    ]);
    inst2.renderList();
    var cards2 = inst2.listEl.querySelectorAll('.atex-pk-card');
    assertEqual(cards2.length, 1, '#4918: выполненные и невыполненные — одна плашка');
    var badge2 = cards2[0] ? cards2[0].querySelector('.atex-pk-badge.is-partial') : null;
    assertEqual(badge2 ? badge2.textContent : null, 'частично', '#4918: статус «частично» на плашке');
    var qty2 = cards2[0] ? cards2[0].querySelector('.atex-pk-qty-value') : null;
    assertEqual(qty2 ? qty2.textContent : null, '50', '#4918: на плашке остаток (упакованное не считается)');

    // Полностью упакованный заказ скрыт, переключатель показывает.
    var inst3 = makeList([
        item({ gp_id: 'a', order_no: '1', qty: '10', qty_fact: '10', packed: '10' }),
        item({ gp_id: 'b', order_no: '2', qty: '6', qty_fact: '6', packed: '' })
    ]);
    inst3.renderList();
    assertEqual(inst3.listEl.querySelectorAll('.atex-pk-card').length, 1,
        '#4918: упакованный заказ скрыт');
    inst3.showPacked = true;
    inst3.renderList();
    assertEqual(inst3.listEl.querySelectorAll('.atex-pk-card').length, 2,
        '#4918: с «Показать упакованные» видны все заказы');
});

// ── 6) «Упаковано» на плашке отмечает ВСЕ позиции заказа ──
section('#4918: Упаковано на плашке заказа', function() {
    var inst = makeList([
        item({ gp_id: 'a', order_no: '4619', task_id: '1', qty: '60', qty_fact: '60' }),
        item({ gp_id: 'b', order_no: '4619', task_id: '2', qty: '50', qty_fact: '50' })
    ]);
    var written = [];
    inst._writePack = function(pos, qty, note) {
        written.push({ gpId: pos.gpId, qty: qty, note: note });
        return Promise.resolve();
    };
    inst.notify = function() {};
    inst.renderList();
    var cards = inst.listEl.querySelectorAll('.atex-pk-card');
    assertEqual(cards.length, 1, '#4918: один заказ из двух заданий — одна плашка');
    var btn = cards[0].querySelectorAll('button').filter(function(b) { return b.textContent === 'Упаковано'; })[0];
    assert(!!btn, '#4918: на плашке заказа одна кнопка «Упаковано»');
    if (btn) btn.click();
    setImmediate(function() {
        assertEqual(written, [
            { gpId: 'a', qty: 60, note: '' },
            { gpId: 'b', qty: 50, note: '' }
        ], '#4918: «Упаковано» пишет КАЖДУЮ позицию своим количеством');
        done();
    });
});

// ── 7) совместимость: голый item — по-прежнему одна позиция ──
section('#4918: packNow(голый item)', function() {
    var inst = Object.create(mod.Controller.prototype);
    var written = [], asked = [], said = [];
    inst._writePack = function(pos, qty, note) {
        written.push({ gpId: pos.gpId, qty: qty, note: note });
        return Promise.resolve();
    };
    inst.openQtyDialog = function(x) { asked.push(x ? 1 : null); }; // голый item или группа — неважно
    inst.notify = function() { said.push(1); };

    var bare = item({ gp_id: 'a', qty: '110', qty_fact: '60' });
    inst.packNow(bare);
    assertEqual(written, [{ gpId: 'a', qty: 60, note: '' }],
        '#4918: packNow(голый item) — одна запись, как раньше');
    setImmediate(function() {
        written = []; said = [];
        inst.packNow(item({ gp_id: 'b', qty: '', qty_fact: '' }));
        assertEqual(written, [], '#4918: нулевое количество не пишется');
        assertEqual(asked, [1], '#4918: вместо нуля — правка количества');
        assertEqual(said.length, 1, '#4918: и сообщение, почему отметка не прошла');
        done();
    });
});

// Секции 6 и 7 асинхронные — ждём обе перед итоговой строкой.
var asyncLeft = 2;
function done() {
    if (--asyncLeft) return;
    console.log('\n' + passed + '/' + total + ' assertions passed');
    if (process.exitCode) process.exit(process.exitCode);
    process.exit(0);
}
