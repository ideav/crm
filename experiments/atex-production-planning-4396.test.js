// Tests for ideav/crm#4396 — форма «Новое производственное задание»:
//   A) ДЕНЬ ВСТАВКИ — можно не указывать, но УКАЗАННЫЙ ОБЯЗАТЕЛЕН: задание встаёт именно в него
//      (перенос с фиксацией — только фикс-якорь даёт эту гарантию, #4390);
//   B) свободное окно больше НЕ ставит задание на нерабочий день (выходные/праздники
//      «Календаря» #3788 и «Отпуск» станка #3764) — раньше форма показывала окно на выходном,
//      создавала на нём задание, и очередь тут же писала «Выходной/праздничный день —
//      заданий быть не должно».
//
// Покрываем:
//   1) insertDayIso — разбор значения date-поля;
//   2) окно, пропускающее нерабочие дни, — на живой freeSlotFromStoredQueue (тест #4416);
//   3) freeSlotForCut — контроллер эти блокировки действительно передаёт;
//   4) форму (renderForm на DOM-стабе): поле есть, пишет в draft, превью показывает выбранный
//      день вместо «Свободного окна», выходной/отпуск гасят «Создать задание»;
//   5) createCutForPosition — день пуст → как раньше; указан → moveCutToDay(день,'weight',
//      fix=TRUE, свой станок, withinSlitter); выходной/отпуск → не создаём ничего.
//
// Run with: node experiments/atex-production-planning-4396.test.js

process.env.TZ = 'UTC';

// ── Минимальный DOM-стаб (как в atex-production-planning-4381.test.js) ──
function StubNode(tag) {
    this.tagName = String(tag || '').toUpperCase();
    this.childNodes = []; this.attributes = {}; this.dataset = {}; this.style = {};
    this._className = ''; this._text = ''; this._listeners = {}; this.value = ''; this.disabled = false; this.options = [];
    var self = this;
    this.classList = {
        add: function(c) { if (self._classes().indexOf(c) === -1) self._className = (self._className + ' ' + c).trim(); },
        remove: function(c) { self._className = self._classes().filter(function(x) { return x !== c; }).join(' '); },
        contains: function(c) { return self._classes().indexOf(c) !== -1; },
        toggle: function(c, on) { if (on) this.add(c); else this.remove(c); }
    };
}
StubNode.prototype._classes = function() { return this._className.split(/\s+/).filter(Boolean); };
Object.defineProperty(StubNode.prototype, 'className', { get: function() { return this._className; }, set: function(v) { this._className = String(v || ''); } });
Object.defineProperty(StubNode.prototype, 'textContent', {
    get: function() { if (this.childNodes.length) return this.childNodes.map(function(c) { return c.textContent; }).join(''); return this._text; },
    set: function(v) { this._text = String(v == null ? '' : v); this.childNodes = []; } });
Object.defineProperty(StubNode.prototype, 'innerHTML', { get: function() { return ''; }, set: function(v) { if (v === '') { this.childNodes = []; this._text = ''; } } });
Object.defineProperty(StubNode.prototype, 'firstChild', { get: function() { return this.childNodes[0] || null; } });
StubNode.prototype.appendChild = function(n) { this.childNodes.push(n); n.parentNode = this; if (this.tagName === 'SELECT' && n.tagName === 'OPTION') this.options.push(n); return n; };
StubNode.prototype.removeChild = function(n) { this.childNodes = this.childNodes.filter(function(c) { return c !== n; }); return n; };
StubNode.prototype.setAttribute = function(k, v) { this.attributes[k] = String(v); };
StubNode.prototype.getAttribute = function(k) { return this.attributes[k] == null ? null : this.attributes[k]; };
StubNode.prototype.addEventListener = function(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); };
StubNode.prototype.dispatch = function(ev, e) { (this._listeners[ev] || []).forEach(function(fn) { fn(e || {}); }); };
StubNode.prototype.click = function() { this.dispatch('click', { target: this }); };
StubNode.prototype.focus = function() {}; StubNode.prototype.setSelectionRange = function() {};
StubNode.prototype._all = function(acc) { this.childNodes.forEach(function(c) { if (c instanceof StubNode) { acc.push(c); c._all(acc); } }); return acc; };
StubNode.prototype.querySelectorAll = function(sel) { var cls = sel.replace(/^\./, ''); return this._all([]).filter(function(n) { return n.classList.contains(cls); }); };
StubNode.prototype.querySelector = function(sel) { return this.querySelectorAll(sel)[0] || null; };

global.document = {
    createElement: function(tag) { return new StubNode(tag); },
    createTextNode: function(t) { var n = new StubNode('#text'); n._text = String(t == null ? '' : t); return n; },
    body: new StubNode('body'), readyState: 'loading', getElementById: function() { return null; }, addEventListener: function() {}
};
global.window = { db: 'testdb' };

var api = require('../download/atex/js/production-planning.js');
var planning = api.planning;
var Controller = api.Controller;

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
    if (ok) { passed++; } else {
        console.log('  expected:', JSON.stringify(expected));
        console.log('  actual:  ', JSON.stringify(actual));
        process.exitCode = 1;
    }
}

// ── 1) insertDayIso ──────────────────────────────────────────────────────────
assertEqual(planning.insertDayIso('2026-07-27'), '2026-07-27', 'insertDayIso: полная дата принимается');
assertEqual(planning.insertDayIso('  2026-07-27  '), '2026-07-27', 'insertDayIso: пробелы обрезаются');
assertEqual(planning.insertDayIso(''), '', 'insertDayIso: пусто — законное значение (день не указан)');
assertEqual(planning.insertDayIso(null), '', 'insertDayIso: null → пусто');
assertEqual(planning.insertDayIso(undefined), '', 'insertDayIso: undefined → пусто');
assertEqual(planning.insertDayIso('2026-7-7'), '', 'insertDayIso: недописанный ввод не считается днём');
assertEqual(planning.insertDayIso('завтра'), '', 'insertDayIso: мусор → пусто');

// ── 2) окно, пропускающее нерабочие дни, проверяется на ЖИВОЙ freeSlotFromStoredQueue
//      (experiments/atex-4416-free-slot-stored.test.js): «день 0 нерабочий → окно на дне 1».
//      Прежний freeSlotForQueue (пересчёт очереди от дня 0) удалён как мёртвый код — его заменил
//      расчёт по сохранённому плану (#4416).

// ── Общий стенд формы ────────────────────────────────────────────────────────
var INSERT_DAY = '2026-07-27';
var INSERT_MIDNIGHT = new Date(2026, 6, 27, 0, 0, 0, 0).getTime();

function fakeProspect(positionId, qty) {
    return {
        forKey: String(positionId) + '|' + qty,
        positionId: String(positionId), position: { id: 'p1', length: 1000, orderId: 'o1' }, qty: qty,
        materialId: '500', layout: { windDir: 'нар', strips: [{ width: 330, qty: 3 }] },
        plannedRuns: 2, runLength: 1000, duration: 40, timing: '',
        batches: [{ width: 330, strips: 3, length: 1000 }],
        posWidth: 330, stripsPerPass: 3, producedPosRolls: 6, supplyRolls: qty,
        stockRolls: 1, sleeveTasks: [], multiLayout: false,
        scheduleCut: { id: '__new__', plannedRuns: 2, materialId: '500', winding: 'нар', knifeWidths: [330, 330, 330], runLength: 1000 }
    };
}
function makeController() {
    var root = new StubNode('div'); root.attributes['data-db'] = 'testdb';
    var c = new Controller(root);
    c.formEl = new StubNode('div'); c.queueEl = new StubNode('div'); c.linkEl = new StubNode('div');
    c.filter = { slitter: '', status: '', date: '2026-07-24', dateTo: '', query: '' };
    c.slitters = [{ id: '101', label: 'Станок 3', stopMaterialIds: [], widthCode: '' }];
    c.activeSlitter = '101';
    c.cuts = [];
    var pos = { id: 'p1', approved: true, qty: 5, materialId: '500', width: 330, orderWidth: 330,
        length: 1000, dueKey: 20260731, orderId: 'o1', leader: '' };
    c.positions = [pos]; c.genPositions = [pos];
    c.supplies = []; c.genBatches = [];
    c.opTimes = {}; c.changeTimes = {}; c.footageBySupply = {}; c.consumptionByCut = {};
    c.jumboWidthByMaterial = { '500': 1000 }; c.nominalWidthByMaterial = {}; c.actualWidthIndex = null;
    c.daySettings = {}; c.prevSetupBySlitter = {}; c.downtimesBySlitter = {}; c.calendarByDay = {};
    c.renderLink = function() {}; c.render = function() {}; c.closeForm = function() {};
    c._notes = [];
    c.notify = function(msg, kind) { c._notes.push({ msg: msg, kind: kind }); };
    // Раскладка считается асинхронно и лезет в сеть — подменяем готовым проспектом.
    c.buildCutProspect = function(positionId, qty) {
        return Promise.resolve(fakeProspect(positionId, Math.floor(Number(qty) || 0)));
    };
    return c;
}
function renderReady(c) {
    c.draft.prospect = fakeProspect(c.draft.positionId, Math.floor(Number(c.draft.qty) || 0));
    c.renderForm();
    return c.formEl;
}
function fieldByLabel(formEl, labelText) {
    var labels = formEl.querySelectorAll('.atex-pp-label');
    for (var i = 0; i < labels.length; i++) {
        if (String(labels[i].textContent).indexOf(labelText) !== -1) return labels[i].parentNode;
    }
    return null;
}
function previewLines(formEl) {
    return formEl.querySelectorAll('.atex-pp-cut-preview-line').map(function(n) { return n.textContent; });
}

// ── 3) freeSlotForCut: контроллер передаёт блокировки в расчёт окна ──────────
(function () {
    var c = makeController();
    var open = c.freeSlotForCut('101', fakeProspect('p1', 5).scheduleCut);
    assertEqual(open && open.day, 0, 'freeSlotForCut: рабочий день — окно в дне 0');

    var blocked = makeController();
    // День 0 (24.07 — база фильтра) нерабочий: календарь/отпуск отдают его целиком.
    blocked.blockedRangesForSlitter = function() { return [[0, 1440]]; };
    var slot = blocked.freeSlotForCut('101', fakeProspect('p1', 5).scheduleCut);
    assertEqual(slot && slot.day, 1, 'freeSlotForCut: нерабочий день 0 → окно на следующем дне');
    var startDate = new Date(slot.startTs * 1000);
    assertEqual([startDate.getFullYear(), startDate.getMonth() + 1, startDate.getDate()], [2026, 7, 25],
        'freeSlotForCut: startTs — уже 25.07, а не нерабочее 24.07');
})();

// ── 4) Форма: поле есть, пишет в draft, меняет превью, нерабочий день гасит кнопку ──
(function () {
    var c = makeController();
    c.draft.positionId = 'p1'; c.draft.qty = '5'; c.draft.slitterId = '101';
    var form = renderReady(c);

    var box = fieldByLabel(form, 'День вставки');
    assert(!!box, 'поле «День вставки» есть на форме');
    var input = box && box.querySelectorAll('.atex-pp-date-input')[0];
    assert(!!input, 'это <input type=date>');
    assertEqual(input && input.getAttribute('type'), 'date', 'тип поля — date');
    assertEqual(input && input.value, '', 'по умолчанию пусто — день указывать не обязательно');
    assert(String(box.textContent).indexOf('можно не указывать') !== -1,
        'подпись говорит, что поле необязательное');
    assert(String(box.textContent).indexOf('указан — обязателен') !== -1,
        'подпись говорит, что УКАЗАННЫЙ день обязателен');

    var linesEmpty = previewLines(form);
    assert(linesEmpty.length > 0 && linesEmpty[0].indexOf('Свободное окно') === 0,
        'без выбранного дня первая строка превью — «Свободное окно…» (как было)');

    input.value = INSERT_DAY;
    input.dispatch('change');
    assertEqual(c.draft.insertDate, INSERT_DAY, 'выбранный день попал в draft.insertDate');

    var form2 = renderReady(c);
    var lines = previewLines(form2);
    assert(lines.length > 0 && lines[0].indexOf('День вставки') === 0,
        'с выбранным днём превью говорит про него, а не про свободное окно');
    assert(lines[0].indexOf('зафиксировано') !== -1,
        'превью честно предупреждает, что задание будет зафиксировано на этом дне');
    assert(lines[0].indexOf('27.07.2026') !== -1, 'в превью — выбранная дата');
    var btn = form2.querySelectorAll('.atex-pp-btn-primary')[0];
    assertEqual(btn && btn.disabled, false, '«Создать задание» доступно на рабочий день');
})();

(function () {
    // Выходной/праздник как предпочтительный день: предупреждаем и не даём создать.
    var c = makeController();
    c.dayIsWorking = function(ms) { return ms !== INSERT_MIDNIGHT; };
    c.draft.positionId = 'p1'; c.draft.qty = '5'; c.draft.slitterId = '101'; c.draft.insertDate = INSERT_DAY;
    var form = renderReady(c);
    assert(previewLines(form).filter(function(t) { return t.indexOf('Выходной/праздничный') !== -1; }).length === 1,
        'превью предупреждает про выходной/праздничный день');
    assertEqual(form.querySelectorAll('.atex-pp-btn-primary')[0].disabled, true,
        '«Создать задание» заблокировано на выходной');
})();

(function () {
    // Отпуск станка на выбранный день.
    var c = makeController();
    c.slitterOnVacationDay = function(sid, ms) { return String(sid) === '101' && ms === INSERT_MIDNIGHT; };
    c.draft.positionId = 'p1'; c.draft.qty = '5'; c.draft.slitterId = '101'; c.draft.insertDate = INSERT_DAY;
    var form = renderReady(c);
    assert(previewLines(form).filter(function(t) { return t.indexOf('в отпуске') !== -1; }).length === 1,
        'превью предупреждает об отпуске станка в выбранный день');
    assertEqual(form.querySelectorAll('.atex-pp-btn-primary')[0].disabled, true,
        '«Создать задание» заблокировано на отпуск');
})();

// ── 5) createCutForPosition: перенос на выбранный день ───────────────────────
function makeCreateController() {
    var c = makeController();
    c.meta.cut = { id: '1078', reqs: [{ id: '9001', name: 'Слиттер' }, { id: '9002', name: 'Кол-во план' }] };
    c.meta.finishedBatch = { id: '1080', reqs: [] };
    c.meta.supply = { id: '1079', reqs: [] };
    c.meta.sleeveTask = null;
    c._posts = []; c._moves = [];
    c.post = function(path, fields) { c._posts.push({ path: path, fields: fields }); return Promise.resolve({ obj: 'NEW1' }); };
    c.reload = function() {
        c.cuts = [{ id: 'NEW1', number: '1', slitter: { id: '101', label: 'Станок 3' },
            materialId: '500', planDate: '', startDate: '', endDate: '' }];
        return Promise.resolve();
    };
    c.persistCutSetupColumns = function() { return Promise.resolve(); };
    c.moveCutToDay = function(cut, dateStr, position, fix, slitterId, withinSlitter) {
        c._moves.push({ cutId: String(cut && cut.id), dateStr: dateStr, position: position,
            fix: fix, slitterId: String(slitterId), withinSlitter: withinSlitter });
        return Promise.resolve(true);
    };
    c.resolveLeaderId = function() { return ''; };
    c.sleeveTaskReqIds = function() { return null; };
    c.draft.positionId = 'p1'; c.draft.qty = '5'; c.draft.slitterId = '101';
    c.draft.prospect = fakeProspect('p1', 5);
    return c;
}
// createCutForPosition ничего не возвращает — ждём микрозадачи его цепочки промисов.
function flush() {
    var p = Promise.resolve();
    for (var i = 0; i < 40; i++) p = p.then(function() {});
    return p;
}

(function run() {
    var noDay = makeCreateController();
    noDay.createCutForPosition();
    flush().then(function() {
        assertEqual(noDay._moves.length, 0, 'день не указан → moveCutToDay не зовём (поведение прежнее)');
        assert(noDay._posts.length > 0, 'день не указан → задание всё равно создано');

        var withDay = makeCreateController();
        withDay.draft.insertDate = INSERT_DAY;
        withDay.createCutForPosition();
        return flush().then(function() {
            assertEqual(withDay._moves.length, 1, 'день указан → зовём moveCutToDay ровно один раз');
            assertEqual(withDay._moves[0], {
                cutId: 'NEW1', dateStr: INSERT_DAY, position: 'weight', fix: true,
                slitterId: '101', withinSlitter: true
            }, 'перенос: выбранный день, «по весу» внутри дня, С ФИКСАЦИЕЙ (день обязателен), свой станок');

            var onVac = makeCreateController();
            onVac.draft.insertDate = INSERT_DAY;
            onVac.slitterOnVacationDay = function(sid, ms) { return String(sid) === '101' && ms === INSERT_MIDNIGHT; };
            onVac.createCutForPosition();
            return flush().then(function() {
                assertEqual(onVac._posts.length, 0, 'отпуск станка в выбранный день → задание не создаём вовсе');
                assertEqual(onVac._moves.length, 0, 'отпуск → и переносить нечего');
                assert(onVac._notes.filter(function(n) { return n.kind === 'error' && n.msg.indexOf('в отпуске') !== -1; }).length === 1,
                    'отпуск → внятная ошибка диспетчеру');

                var onOff = makeCreateController();
                onOff.draft.insertDate = INSERT_DAY;
                onOff.dayIsWorking = function(ms) { return ms !== INSERT_MIDNIGHT; };
                onOff.createCutForPosition();
                return flush().then(function() {
                    assertEqual(onOff._posts.length, 0, 'выходной как день вставки → задание не создаём');
                    assert(onOff._notes.filter(function(n) { return n.kind === 'error' && n.msg.indexOf('выходной') !== -1; }).length === 1,
                        'выходной → внятная ошибка диспетчеру');

                    console.log('\n' + passed + '/' + total + ' passed');
                });
            });
        });
    }).catch(function(e) { console.error('FAIL — исключение в асинхронной части:', e && e.stack || e); process.exitCode = 1; });
})();
