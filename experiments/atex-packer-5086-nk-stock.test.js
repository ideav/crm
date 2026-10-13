// #5086 — склад неполных коробов (НК) у упаковщика.
//
// Что не упаковывается в целую коробку, уходит на склад НК и ждёт, пока этим
// артикулом можно будет упаковать целый короб. В модалке «Количество» справа от
// количества — два поля: «На склад НК» и «Со склада НК» (заполняется только одно,
// значение — целое > 0). Движение пишется в «Склад НК» Партии ГП: на склад — как есть,
// со склада — с минусом; и в событие смены «Упаковка» (примечанием). Сальдо по
// артикулу отдаёт отчёт `packers` колонкой `nk_stock` (за всё время), движение самой
// Партии ГП — колонкой `nk`. Взять со склада больше, чем там есть, нельзя; упаковать
// больше факта ровно на взятое со склада можно без примечания. Позиция без артикула —
// без полей НК. «Упаковано шт» — полный факт, движение НК его не уменьшает.
//
// Run with: node experiments/atex-packer-5086-nk-stock.test.js

process.env.TZ = 'UTC';

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
function section(name, fn) {
    try { fn(); } catch (e) {
        total++;
        console.log('FAIL — ' + name + ' (упало: ' + e.message + ')');
        process.exitCode = 1;
    }
}

// Строка отчёта `packers` — артикул 00000723 из вложения issue (сальдо 27).
function row(over) {
    var base = {
        task: '1789467000', task_id: '806984', gp_id: '807061',
        order_no: '5335', order: '3289',
        material: 'MW308', cut_width: '60.00', cut_length: '300.00',
        wind_direction: 'OUT', sleeve: 'Втулка картонная', add_sleeve: '',
        qty: '240', qty_fact: '240', packed: '', notes: '', events: '806984',
        art: '00000723', nk: '', nk_stock: '27'
    };
    Object.keys(over || {}).forEach(function(k) { base[k] = over[k]; });
    return base;
}
function item(over) { return core.itemFromReportRow(row(over)); }

var GP_META = { id: '1081', reqs: [
    { id: '673786', val: 'Упаковано шт' }, { id: '673789', val: 'Примечание' }, { id: '938992', val: 'Склад НК' }
] };
var EVENT_META = { id: '1082', reqs: [
    { id: '1196', val: 'Пользователь' }, { id: '1198', val: 'Значение' }, { id: '1199', val: 'Примечания' },
    { id: '16415', val: 'Задание в производство' }, { id: '16419', val: 'Тип события' }
] };

function makeList(items) {
    var inst = Object.create(mod.Controller.prototype);
    inst.listEl = new StubNode('div');
    inst.items = items;
    inst.sizes = [];
    inst.showPacked = true;
    inst.hasPlace = function() { return true; };
    inst.storeShowPacked = function() {};
    inst.notify = function() {};
    inst.meta = { gp: GP_META, event: EVENT_META };
    inst.userId = '7';
    inst.posts = [];
    inst.post = function(path, fields) { inst.posts.push({ path: path, fields: fields }); return Promise.resolve({}); };
    return inst;
}
function openDialog(inst, group) {
    inst.openQtyDialog(group);
    var all = global.document.body.querySelectorAll('.atex-pk-modal-overlay');
    return all[all.length - 1] || null;
}
function saveButton(overlay) {
    return overlay.querySelectorAll('button').filter(function(b) { return b.textContent === 'Сохранить'; })[0];
}
function type(input, value) { input.value = String(value); input.dispatch('input', { target: input }); }
function qtyInput(overlay) {
    return overlay.querySelectorAll('input').filter(function(i) {
        return i.attributes.type === 'number' && !i.classList.contains('atex-pk-nk-to') && !i.classList.contains('atex-pk-nk-from');
    })[0];
}
function errorText(overlay) { var e = overlay.querySelector('.atex-pk-error'); return e ? e.textContent : ''; }
function stockOf(items, art) { return core.nkStockByArt(items)[art] || 0; }

// ── 1) чистое ядро ──
section('#5086: колонки nk / nk_stock читаются в позицию', function() {
    var it = item({ nk: '-10', nk_stock: '17' });
    assertEqual([it.nk, it.nkReported, it.nkStock], [-10, -10, 17], 'движение и сальдо из отчёта');
    var empty = item({ nk: '', nk_stock: '' });
    assertEqual([empty.nk, empty.nkStock], [0, 0], 'пусто — ноль');
});

section('#5086: значение движения — на склад как есть, со склада с минусом', function() {
    assertEqual(core.nkValue('40', ''), 40, 'на склад 40 → +40');
    assertEqual(core.nkValue('', '10'), -10, 'со склада 10 → −10');
    assertEqual(core.nkValue('', ''), 0, 'оба пусты → 0');
});

section('#5086: проверка полей НК', function() {
    assertEqual(core.validateNk({ to: '', from: '', available: 27 }), '', 'оба пусты — можно');
    assert(/одно/.test(core.validateNk({ to: '5', from: '5', available: 27 })), 'оба заполнены — ошибка');
    assert(core.validateNk({ to: '0', from: '', available: 27 }) !== '', 'ноль — ошибка');
    assert(core.validateNk({ to: '-3', from: '', available: 27 }) !== '', 'минус — ошибка');
    assert(core.validateNk({ to: '2.5', from: '', available: 27 }) !== '', 'дробь — ошибка (целое число)');
    assertEqual(core.validateNk({ to: '', from: '30', available: 27 }), 'На складе НК только 27 шт', 'взять больше, чем есть, нельзя');
    assertEqual(core.validateNk({ to: '', from: '27', available: 27 }), '', 'взять всё — можно');
    assertEqual(core.validateNk({ to: '500', from: '', available: 0 }), '', 'сдать можно сколько угодно');
});

section('#5086: упаковать сверх факта ровно на взятое со склада — без примечания', function() {
    assertEqual(core.validatePack({ qty: 250, suggested: 240, note: '', nkFrom: 10 }), '', 'факт + взятое = без примечания');
    assert(core.validatePack({ qty: 250, suggested: 240, note: '' }) !== '', 'сверх факта без склада — примечание обязательно (как раньше)');
    assert(core.validatePack({ qty: 260, suggested: 240, note: '', nkFrom: 10 }) !== '', 'больше факта + взятого — примечание');
    assertEqual(core.validatePack({ qty: 240, suggested: 240, note: '', nkFrom: 0 }), '', 'без движения — как раньше');
});

section('#5086: сальдо по артикулу учитывает движения на экране', function() {
    var a = item({ gp_id: 'a' }), b = item({ gp_id: 'b', nk: '5' }), c = item({ gp_id: 'c', art: 'Y', nk_stock: '' });
    var items = [a, b, c];
    assertEqual(stockOf(items, '00000723'), 27, 'сальдо из отчёта');
    a.editedNk = -10;
    assertEqual(stockOf(items, '00000723'), 17, 'несохранённое «со склада 10» уже вычтено');
    b.nk = 8; // записали 8 вместо 5, отчёт ещё старый
    assertEqual(stockOf(items, '00000723'), 20, 'записанное, но не подтверждённое отчётом — по разнице');
    assertEqual(stockOf(items, 'Y'), 0, 'другой артикул не тронут');
    assertEqual(core.nkStockByArt([item({ art: '' })])[''], undefined, 'без артикула — сальдо нет');
});

section('#5086: поле «Склад НК» Партии ГП', function() {
    assertEqual(core.gpPackFields(GP_META, { qty: 240, nk: -10 }), { t673786: 240, t938992: -10 }, 'со склада — минусом');
    assertEqual(core.gpPackFields(GP_META, { qty: 240, nk: 40 }), { t673786: 240, t938992: 40 }, 'на склад — как есть');
    assertEqual(core.gpPackFields(GP_META, { qty: 240, nk: 0 }), { t673786: 240, t938992: '' }, 'снятое движение — очищается');
    assertEqual(core.gpPackFields(GP_META, { qty: 240 }), { t673786: 240 }, 'движения нет — поле не трогаем');
});

section('#5086: несохранённое движение НК держит авто-обновление', function() {
    var a = item({});
    assertEqual(core.hasUnsavedEdits([a]), false, 'без правок — можно обновлять');
    a.editedNk = 40;
    assertEqual(core.hasUnsavedEdits([a]), true, 'введённое движение — не затирать обновлением');
});

// ── 2) диалог ──
section('#5086: позиция без артикула — полей НК нет', function() {
    var inst = makeList([item({ art: '' })]);
    var overlay = openDialog(inst, inst.items[0]);
    assertEqual(overlay.querySelectorAll('.atex-pk-nk-to').length + overlay.querySelectorAll('.atex-pk-nk-from').length, 0, 'без артикула — игнор');
    overlay.close();
});

section('#5086: модалка — поля и сальдо', function() {
    var inst = makeList([item({})]);
    var overlay = openDialog(inst, inst.items[0]);
    assertEqual(overlay.querySelectorAll('.atex-pk-nk-to').length, 1, 'поле «На склад НК»');
    assertEqual(overlay.querySelectorAll('.atex-pk-nk-from').length, 1, 'поле «Со склада НК»');
    var stock = overlay.querySelector('.atex-pk-nk-stock');
    assert(!!stock && stock.textContent.indexOf('27') !== -1, 'сальдо склада НК видно в модалке');
    overlay.close();
});

section('#5086: взять больше, чем есть, — ошибка, ничего не записано', function() {
    var inst = makeList([item({})]);
    var overlay = openDialog(inst, inst.items[0]);
    type(overlay.querySelector('.atex-pk-nk-from'), 30);
    saveButton(overlay).click();
    assertEqual(errorText(overlay), 'На складе НК только 27 шт', 'проверка остатка');
    assert(inst.items[0].editedNk == null, 'движение не принято');
    overlay.close();
});

section('#5086: оба поля — ошибка', function() {
    var inst = makeList([item({})]);
    var overlay = openDialog(inst, inst.items[0]);
    type(overlay.querySelector('.atex-pk-nk-from'), 3);
    type(overlay.querySelector('.atex-pk-nk-to'), 4);
    saveButton(overlay).click();
    assert(/одно/.test(errorText(overlay)), 'заполнить можно только одно');
    overlay.close();
});

// #5139: при ненулевом сальдо упаковщик должен заметить строку склада НК —
// число выделено (модификатор is-nonzero, число отдельным узлом).
section('#5139: ненулевое сальдо выделено, нулевое — нет', function() {
    var inst = makeList([item({})]);
    var overlay = openDialog(inst, inst.items[0]);
    var stock = overlay.querySelector('.atex-pk-nk-stock');
    assert(stock.classList.contains('is-nonzero'), 'сальдо 27 — есть is-nonzero');
    var num = stock.querySelector('.atex-pk-nk-stock-num');
    assert(!!num && num.textContent === '27 шт', 'число — отдельным узлом');
    overlay.close();

    var zero = makeList([item({ nk_stock: '' })]);
    var overlay0 = openDialog(zero, zero.items[0]);
    var stock0 = overlay0.querySelector('.atex-pk-nk-stock');
    assert(!!stock0 && !stock0.classList.contains('is-nonzero'), 'сальдо 0 — без is-nonzero');
    assert(!!stock0.querySelector('.atex-pk-nk-stock-num'), 'разметка числа одинакова в обоих случаях');
    overlay0.close();
});

section('#5086: «Со склада НК» добавляет к количеству и пересчитывает сальдо', function() {
    var inst = makeList([item({})]);
    var overlay = openDialog(inst, inst.items[0]);
    type(overlay.querySelector('.atex-pk-nk-from'), 10);
    assertEqual(qtyInput(overlay).value, '250', 'количество = факт + взятое');
    saveButton(overlay).click();
    assertEqual(errorText(overlay), '', 'примечание не требуется');
    assertEqual([inst.items[0].editedNk, inst.items[0].editedQty], [-10, 250], 'правка запомнена до «Упаковано»');
    assertEqual(stockOf(inst.items, '00000723'), 17, 'остаток пересчитан');
    var card = inst.listEl.querySelectorAll('.atex-pk-card')[0];
    assert(!!card && card.textContent.indexOf('НК 17') !== -1, 'карточка показывает остаток склада НК');
});

section('#5086: «На склад НК» количество не меняет («Упаковано шт» — полный факт)', function() {
    var inst = makeList([item({})]);
    var overlay = openDialog(inst, inst.items[0]);
    type(overlay.querySelector('.atex-pk-nk-to'), 40);
    assertEqual(qtyInput(overlay).value, '240', 'количество — полный факт');
    saveButton(overlay).click();
    assertEqual(inst.items[0].editedNk, 40, 'на склад +40');
    assertEqual(stockOf(inst.items, '00000723'), 67, 'сальдо 27 + 40');
});

section('#5086: несколько позиций одного артикула не берут со склада больше остатка в сумме', function() {
    var a = item({ gp_id: 'a', cut_width: '110.00' }), b = item({ gp_id: 'b', task_id: '2', cut_width: '64.00' });
    var inst = makeList([a, b]);
    var overlay = openDialog(inst, core.groupByOrder(inst.items)[0]);
    var froms = overlay.querySelectorAll('.atex-pk-nk-from');
    assertEqual(froms.length, 2, 'по паре полей на позицию');
    type(froms[0], 20);
    type(froms[1], 10);
    saveButton(overlay).click();
    assertEqual(errorText(overlay), 'На складе НК только 7 шт', 'второй позиции досталось 27 − 20');
    assert(a.editedNk == null && b.editedNk == null, 'ничего не принято');
    overlay.close();
});

section('#5086: по размерам — взятое добавляется к количеству своей позиции', function() {
    var a = item({ gp_id: 'a', cut_width: '110.00' }), b = item({ gp_id: 'b', task_id: '2', cut_width: '64.00' });
    var inst = makeList([a, b]);
    var overlay = openDialog(inst, core.groupByOrder(inst.items)[0]);
    type(overlay.querySelectorAll('.atex-pk-nk-from')[1], 5);
    saveButton(overlay).click();
    assertEqual(errorText(overlay), '', 'примечание не требуется');
    assertEqual([a.editedNk, b.editedNk, b.editedQty], [null, -5, 245], 'движение и количество — у второй позиции');
});

// ── 3) запись ──
var queue = [];
function later(name, fn) { queue.push({ name: name, fn: fn }); }
function runQueue() {
    var next = queue.shift();
    if (!next) { console.log('\n' + passed + '/' + total + ' assertions passed'); process.exit(process.exitCode || 0); }
    try { next.fn(runQueue); } catch (e) { total++; console.log('FAIL — ' + next.name + ' (упало: ' + e.message + ')'); process.exitCode = 1; runQueue(); }
}

later('#5086: «Упаковано» пишет движение в Партию ГП и в событие смены', function(done) {
    var a = item({});
    var inst = makeList([a]);
    a.editedQty = 250; a.editedNk = -10;
    inst.packNow(core.groupByOrder(inst.items)[0]);
    setImmediate(function() {
        var gp = inst.posts.filter(function(p) { return p.path.indexOf('_m_set/807061') === 0; })[0];
        assertEqual(gp && gp.fields, { t673786: 250, t938992: -10 }, 'Партия ГП: 250 упаковано, −10 по складу НК');
        var ev = inst.posts.filter(function(p) { return p.path.indexOf('_m_new/1082') === 0; })[0];
        assert(!!ev && /со склада НК 10 шт/.test(ev.fields.t1199 || ''), 'событие смены: «со склада НК 10 шт» в примечаниях');
        assertEqual([a.nk, a.editedNk], [-10, null], 'записанное движение живёт в позиции');
        assertEqual(stockOf(inst.items, '00000723'), 17, 'до перечитывания отчёта остаток считается по разнице');
        inst.items = [item({ nk: '-10', nk_stock: '17', packed: '250' })];
        assertEqual(stockOf(inst.items, '00000723'), 17, 'после перечитывания — то же, без двойного учёта');
        done();
    });
});

later('#5086: отчёт ещё старый — записанное движение держится до подтверждения', function(done) {
    var a = item({});
    var inst = makeList([a]);
    a.editedNk = 40;
    inst.packNow(core.groupByOrder(inst.items)[0]);
    setImmediate(function() {
        inst.items = [item({})]; // read-after-write: отчёт ещё без записи
        inst.applyPendingWrites();
        assertEqual(inst.items[0].nk, 40, 'движение не потерялось');
        assertEqual(stockOf(inst.items, '00000723'), 67, 'сальдо с записанным движением');
        inst.items = [item({ packed: '240', nk: '40', nk_stock: '67' })];
        inst.applyPendingWrites();
        assertEqual(stockOf(inst.items, '00000723'), 67, 'отчёт подтвердил — без двойного учёта');
        done();
    });
});

later('#5086: без движения поле «Склад НК» не пишется', function(done) {
    var inst = makeList([item({})]);
    inst.packNow(core.groupByOrder(inst.items)[0]);
    setImmediate(function() {
        var gp = inst.posts.filter(function(p) { return p.path.indexOf('_m_set/') === 0; })[0];
        assertEqual(gp && gp.fields, { t673786: 240 }, 'только «Упаковано шт»');
        done();
    });
});

later('#5086: упакованная позиция — правка движения уходит сразу', function(done) {
    var a = item({ packed: '250', nk: '-10', nk_stock: '17' });
    var inst = makeList([a]);
    var overlay = openDialog(inst, a);
    var from = overlay.querySelector('.atex-pk-nk-from');
    assertEqual(from.value, '10', 'записанное движение подставлено');
    type(from, 20);
    assertEqual(qtyInput(overlay).value, '260', 'количество сдвинулось на разницу взятого');
    saveButton(overlay).click();
    setImmediate(function() {
        var gp = inst.posts.filter(function(p) { return p.path.indexOf('_m_set/') === 0; })[0];
        assertEqual(gp && gp.fields, { t673786: 260, t938992: -20 }, 'перезаписано: 260 и −20');
        assertEqual(stockOf(inst.items, '00000723'), 7, 'остаток 17 − ещё 10');
        done();
    });
});

later('#5086: у упакованной позиции своё прежнее взятое доступно', function(done) {
    var a = item({ packed: '250', nk: '-10', nk_stock: '0' });
    var inst = makeList([a]);
    var overlay = openDialog(inst, a);
    type(overlay.querySelector('.atex-pk-nk-from'), 10);
    saveButton(overlay).click();
    assertEqual(errorText(overlay), '', 'своё уже взятое не считается чужим');
    setImmediate(done);
});

runQueue();
