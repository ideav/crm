// #4783 — пульт слиттера стал компактным: прокручивается только список заданий слева,
// правая часть влезает в экран целиком.
//
// Что проверяем (пункты тикета):
//   1. секции «События смены» в пульте нет;
//   2. на странице пульта левое меню скрыто (решение принимается в head main.html);
//   3. дата и станок — в шапке страницы (.navbar-workspace), а не в форме;
//   4. дата — текущая календарная, выбора дня нет;
//   5. «Открыть смену»/«Закрыть смену» — в шапке списка заданий;
//   6. кнопки «✓✓ Готовы все» нет — весь остаток отмечает «✓N Готовы несколько»;
//   7/9. вместо плашек-метрик одна строка «Вид сырья / Метраж / Намотка / Лидер», порядок
//        правой части: заказ + «Резка N из M» → спецификация → кнопки → раскладка →
//        показания → партия строкой;
//   8. бейджа статуса в шапке правой части нет (он виден на карточке слева);
//   10. кнопки «Сохранить показания» нет — запись уходит при выходе из ячейки.
//
// Run with: node experiments/atex-slitter-4783.test.js

process.env.TZ = 'Europe/Moscow';

var fs = require('fs');
var path = require('path');
var ROOT = path.join(__dirname, '..');

// ── Минимальный DOM-стаб (как в atex-slitter-4604.test.js) ────────────────────────────────────
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
StubNode.prototype.removeChild = function(node) {
    this.childNodes = this.childNodes.filter(function(c) { return c !== node; });
    node.parentNode = null; return node;
};
StubNode.prototype.setAttribute = function(k, v) { this.attributes[k] = String(v); };
StubNode.prototype.getAttribute = function(k) { return this.attributes[k] == null ? null : this.attributes[k]; };
StubNode.prototype.addEventListener = function(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); };
StubNode.prototype.dispatch = function(ev, e) { (this._listeners[ev] || []).forEach(function(fn) { fn(e || {}); }); };
StubNode.prototype.click = function() { this.dispatch('click', { target: this }); };
StubNode.prototype._all = function(acc) { this.childNodes.forEach(function(c) { if (c instanceof StubNode) { acc.push(c); c._all(acc); } }); return acc; };
StubNode.prototype.querySelectorAll = function(sel) { var cls = sel.replace(/^\./, ''); return this._all([]).filter(function(n) { return n.classList.contains(cls); }); };
StubNode.prototype.querySelector = function(sel) { return this.querySelectorAll(sel)[0] || null; };

var navbarSlot = new StubNode('div');
navbarSlot.classList.add('navbar-workspace');
global.document = {
    createElement: function(tag) { return new StubNode(tag); },
    createTextNode: function(text) { var n = new StubNode('#text'); n._text = String(text == null ? '' : text); return n; },
    body: new StubNode('body'), readyState: 'loading',
    getElementById: function() { return null; }, addEventListener: function() {},
    querySelector: function(sel) { return sel === '.navbar-workspace' ? navbarSlot : null; }
};
global.window = { db: 'ateh', atexPad: { id: '5', name: 'Планшет №3' } };

var api = require('../download/atex/js/slitter.js');
var Controller = api.Controller;
var core = api.core;

var passed = 0, total = 0;
function assert(cond, name) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}
// Запись показаний уходит цепочкой промисов — проверки, которым нужен её итог,
// копятся здесь и разрешаются в конце файла.
var pending = [];
function flush() { return new Promise(function(resolve) { setTimeout(resolve, 0); }); }
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    total++;
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; return; }
    console.log('  expected:', JSON.stringify(expected));
    console.log('  actual:  ', JSON.stringify(actual));
    process.exitCode = 1;
}

// ── п.3/п.4: подпись пульта в шапке страницы ──────────────────────────────────────────────────
assertEqual(core.workspaceTitleParts('Планшет №3', '2026-08-18', 'Станок 1'),
    ['Планшет №3', '18.08.2026', 'Станок 1'],
    '#4783 п.3: подпись пульта — планшет · дата · станок');
assertEqual(core.workspaceTitleParts('', '2026-08-18', 'Станок 1'), ['18.08.2026', 'Станок 1'],
    '#4783 п.3: имени планшета нет (пульт открыт мимо сторожа) — часть опускается');
assertEqual(core.workspaceTitleParts('Планшет №3', '2026-08-18', ''),
    ['Планшет №3', '18.08.2026', 'Станок не выбран'],
    '#4783 п.3: станок не выбран — подпись говорит об этом прямо');
assertEqual(core.formatDayISO('2026-08-18'), '18.08.2026', '#4783 п.4: день пульта — «ДД.ММ.ГГГГ»');
assertEqual(core.formatDayISO(''), '', '#4783: пустая дата остаётся пустой');

// ── каркас пульта: тулбара, счётчика заданий и секции событий больше нет ──────────────────────
assert(typeof Controller.prototype.renderToolbar === 'undefined',
    '#4783 п.3: тулбара с датой и станком в пульте нет');
assert(typeof Controller.prototype.updateSidebarTitle === 'undefined',
    '#4783 п.5: заголовка «Задание в производство (N)» нет — на его месте кнопка смены');
assert(typeof Controller.prototype.renderEvents === 'undefined',
    '#4783 п.1: секции «События смены» в пульте нет');
assert(typeof Controller.prototype.renderBatchSelection === 'undefined',
    '#4783 п.9: карточек выбора партии нет — партия показывается строкой');
assert(typeof Controller.prototype.renderCutMetrics === 'undefined',
    '#4783 п.7: плашек-метрик нет — спецификация задания одной строкой');
assert(typeof Controller.prototype.renderWorkspaceTitle === 'function'
    && typeof Controller.prototype.renderShiftHead === 'function'
    && typeof Controller.prototype.renderBatchLine === 'function'
    && typeof Controller.prototype.renderCutSpec === 'function',
    '#4783: на их месте — подпись в шапке, кнопка смены, строка партии и строка спецификации');

// ── экземпляр пульта на заглушках ─────────────────────────────────────────────────────────────
function makeInst(opts) {
    var o = opts || {};
    var inst = Object.create(Controller.prototype);
    inst.root = new StubNode('div');
    inst.busy = false;
    inst.db = 'ateh';
    inst.userId = '701';
    inst.selectedDate = '2026-08-18';
    inst.selectedSlitterId = o.slitterId === undefined ? '1' : o.slitterId;
    inst.slitters = [{ id: '1', label: 'Станок 1' }, { id: '2', label: 'Станок 2' }];
    inst.cuts = [];
    inst.cutOrders = { '90': ['3738', '3742'] };
    inst.batches = [];
    inst.shiftEvents = [];
    inst.selectedBatchIds = ['77'];
    inst.currentStrips = [];
    inst.seamlessNotice = null;
    inst.currentCut = {
        id: '90', batchId: '77', status: 'В работе', actualRuns: '1', plannedRuns: '4',
        runLength: '400', material: 'БОПП 20', winding: 'OUT', leader: 'Лидер 40',
        counterStart: '1000', counterEnd: '', defectM: '', notes: '', materialWidthMm: 900
    };
    inst.currentCutId = '90';
    inst.posts = [];
    inst.post = function(path, params) { this.posts.push({ path: path, params: params }); return Promise.resolve({}); };
    inst.cutFields = function() { return { t1: 1 }; };
    inst.setBusy = function(v) { this.busy = v; };
    inst.notify = function() {};
    inst.isShiftOpen = function() { return o.shiftOpen === undefined ? true : o.shiftOpen; };
    inst.isCutLocked = function() { return false; };
    inst.allCutsDone = function() { return false; };
    inst.currentQueue = function() { return { cuts: [], firstOpenCutId: null }; };
    inst.findBatch = function(id) {
        return String(id) === '77'
            ? { id: '77', label: '1781000001', date: '2026-05-10', remainderM: 900, barcode: 'BOPP-A100', widthMm: 900 }
            : null;
    };
    inst.loadCuts = function() { return Promise.resolve(); };
    inst.loadShiftEvents = function() { return Promise.resolve(); };
    inst.storeSelectedSlitter = function() {};
    inst.openShift = function() { this.opened = (this.opened || 0) + 1; };
    inst.closeShift = function() { this.closed = (this.closed || 0) + 1; };
    inst.mainEl = new StubNode('section');
    inst.shiftHeadEl = new StubNode('div');
    return inst;
}

// ── п.3: шапка страницы — планшет · дата · станок, станок кнопкой ─────────────────────────────
(function() {
    var inst = makeInst();
    navbarSlot.childNodes = [];
    inst.renderWorkspaceTitle();
    var texts = navbarSlot.childNodes.map(function(n) { return n.textContent; });
    assertEqual(texts, ['Планшет №3', '·', '18.08.2026', '·', 'Станок 1'],
        '#4783 п.3: в .navbar-workspace — «планшет · дата · станок»');
    var btn = navbarSlot.querySelector('.atex-sl-nav-slitter');
    assert(!!btn, '#4783 п.3: станок в шапке — кнопка (выбор станка ушёл из формы туда)');
    var opened = 0;
    inst.chooseSlitter = function() { opened++; };
    navbarSlot.childNodes = [];
    inst.renderWorkspaceTitle();
    navbarSlot.querySelector('.atex-sl-nav-slitter').click();
    assert(opened === 1, '#4783 п.3: клик по станку открывает выбор станка');
})();

// ── п.5: кнопка смены — в шапке списка заданий ────────────────────────────────────────────────
(function() {
    var open = makeInst({ shiftOpen: true });
    open.renderShiftHead();
    var btn = open.shiftHeadEl.childNodes[0];
    assert(open.shiftHeadEl.childNodes.length === 1 && btn.textContent === 'Закрыть смену',
        '#4783 п.5: смена открыта → в шапке списка «Закрыть смену»');
    btn.click();
    assert(open.closed === 1, '#4783 п.5: кнопка закрывает смену');

    var closed = makeInst({ shiftOpen: false });
    closed.renderShiftHead();
    var openBtn = closed.shiftHeadEl.childNodes[0];
    assert(openBtn.textContent === 'Открыть смену', '#4783 п.5: смена закрыта → «Открыть смену»');
    openBtn.click();
    assert(closed.opened === 1, '#4783 п.5: кнопка открывает смену');

    var noSlitter = makeInst({ slitterId: '' });
    noSlitter.renderShiftHead();
    assert(noSlitter.shiftHeadEl.childNodes[0].textContent === 'Выбрать станок',
        '#4783 п.3: станок не выбран → в шапке списка кнопка выбора станка');
})();

// ── п.7/п.8/п.9: верхняя строчка, спецификация, ряд кнопок ────────────────────────────────────
(function() {
    var inst = makeInst();
    inst.cutOrderText = function() { return '3738, 3742'; };
    var head = inst.renderHead();
    var row = head.querySelector('.atex-sl-head-main');
    assertEqual(row.childNodes.map(function(n) { return n.textContent; }), ['3738, 3742', 'Резка 2 из 4'],
        '#4783 п.9: верхняя строчка — номер заказа и «Резка N из M» рядом');
    assert(!head.querySelector('.atex-sl-badge'),
        '#4783 п.8: бейджа статуса в правой части нет — статус виден на карточке слева');
    assertEqual(head.querySelector('.atex-sl-spec').textContent, 'БОПП 20 / 400 м / OUT / Лидер 40',
        '#4783 п.7: спецификация — одна строка «Вид сырья / Метраж / Намотка / Лидер»');
    var actions = head.querySelector('.atex-sl-actions');
    var labels = actions.querySelectorAll('.atex-sl-btn').map(function(b) { return b.textContent; });
    assertEqual(labels, ['✓ Готово', '✓N Готовы несколько', 'Наладка', 'Перерыв', 'Прекратить', 'Пропуск'],
        '#4783 п.6/п.9: кнопки управления одним рядом, «✓✓ Готовы все» среди них нет');
})();

// ── п.1/п.9: состав правой части и его порядок ────────────────────────────────────────────────
(function() {
    var inst = makeInst();
    inst.cutOrderText = function() { return '3738'; };
    inst.renderMain();
    // #4785 п.1: заголовков у секций нет — секции опознаются составом (порядок ниже).
    assertEqual(inst.mainEl.querySelectorAll('.atex-sl-section').length, 2,
        '#4783 п.1: секций две — раскладка и показания; «События смены» убраны');
    var order = inst.mainEl.childNodes.map(function(n) { return n.className.split(' ')[0]; });
    assertEqual(order, ['atex-sl-headwrap', 'atex-sl-section', 'atex-sl-section', 'atex-sl-batch-line'],
        '#4783 п.9: порядок — шапка задания, раскладка, показания, партия строкой');
})();

// ── п.9: партия сырья строкой и без выбора ────────────────────────────────────────────────────
(function() {
    var inst = makeInst();
    var line = inst.renderBatchLine();
    var cells = line.querySelectorAll('.atex-sl-batch-cell').map(function(n) { return n.textContent; });
    assert(cells.length === 5 && cells[0].indexOf('Партия:') === 0 && cells[2] === 'Остаток, м: 900',
        '#4783 п.9: партия — одной строкой (партия · приход · остаток · штрих-код · проходы)');
    assert(line.querySelectorAll('.atex-sl-batch-card').length === 0 &&
        line._all([]).every(function(n) { return n.tagName !== 'BUTTON'; }),
        '#4783 п.9: выбирать партию в пульте нельзя — кнопок в строке нет');

    var empty = makeInst();
    empty.selectedBatchIds = [];
    empty.currentCut.batchId = '';
    assert(empty.renderBatchLine().textContent.indexOf('не подобрана') >= 0,
        '#4783 п.9: партии нет — строка говорит об этом прямо');
})();

// ── п.10: показания сохраняются при выходе из ячейки, кнопки сохранения нет ───────────────────
(function() {
    var inst = makeInst();
    var section = inst.renderReadings();
    var labels = section.querySelectorAll('.atex-sl-btn').map(function(b) { return b.textContent; });
    assertEqual(labels, ['Фото брака'], '#4783 п.10: кнопки «Сохранить показания» в секции нет');

    var inputs = section.querySelectorAll('.atex-sl-grid')[0].querySelectorAll('.atex-sl-input');
    var counterEnd = inputs[1];
    counterEnd.value = '820';
    counterEnd.dispatch('input');
    counterEnd.dispatch('blur');
    assert(inst.posts.length === 1 && inst.posts[0].path.indexOf('_m_set/90') === 0,
        '#4783 п.10: выход из ячейки сохраняет показания (одна запись)');
    assertEqual(inst.readingsStatusEl.textContent, 'сохраняем…',
        '#4783 п.10: у заголовка секции видно, что показания записываются');

    counterEnd.dispatch('blur');
    counterEnd.dispatch('change');
    assert(inst.posts.length === 1, '#4783 п.10: выход из НЕТРОНУТОЙ ячейки записи не делает');

    // правка, сделанная ПОКА идёт запись, не теряется — сохранение повторяется следом
    counterEnd.value = '810';
    counterEnd.dispatch('input');
    counterEnd.dispatch('change');
    assert(inst.posts.length === 1 && inst.readingsRetry === true,
        '#4783 п.10: правка во время записи ждёт своей очереди, а не теряется');
    pending.push(flush().then(function() {
        assert(inst.posts.length === 2,
            '#4783 п.10: как только предыдущая запись доехала, правка сохраняется следом');
    }));
})();

// ── п.2: на странице пульта левого меню нет (решение принято в head main.html) ────────────────
(function() {
    var tpl = fs.readFileSync(path.join(ROOT, 'templates/atex/main.html'), 'utf8');
    var head = tpl.slice(0, tpl.indexOf('</head>'));
    // Список полноэкранных пультов растёт (#4798 добавил втулкорез) — #4783 отвечает за то,
    // что слиттер в нём ЕСТЬ, а не за то, что он там один.
    assert(/FULLSCREEN_ACTIONS\s*=\s*\[[^\]]*'slitter'[^\]]*\]/.test(head),
        '#4783 п.2: список полноэкранных рабочих мест объявлен в head — до отрисовки body');
    assert(head.indexOf('.app-sidebar,#sidebar-backdrop,#mobile-sidebar-toggle{display:none!important;}') > 0,
        '#4783 п.2: для пульта скрываются левое меню, подложка и кнопка-гамбургер');
})();

// ── прокрутка: только список заданий; правая часть в экран ────────────────────────────────────
(function() {
    var css = fs.readFileSync(path.join(ROOT, 'download/atex/css/slitter.css'), 'utf8');
    // Смотрим базовые правила: узкий экран (@media) правила переопределяет намеренно —
    // там прокрутка возвращается странице целиком.
    var base = css.replace(/@media[^{]*\{[\s\S]*?\n\}/g, '');
    function rule(sel) {
        var m = base.match(new RegExp('\\' + sel + '\\s*\\{([^}]*)\\}'));
        return m ? m[1] : '';
    }
    assert(/@media[^{]*820px[\s\S]*?\.atex-sl-layout\s*\{[^}]*overflow:\s*auto/.test(css),
        '#4783: на узком экране колонки складываются, и прокрутка возвращается странице');
    assert(/overflow:\s*auto/.test(rule('.atex-sl-cuts')) && /flex:\s*1/.test(rule('.atex-sl-cuts')),
        '#4783: прокручивается список заданий — он и занимает остаток высоты сайдбара');
    assert(/overflow:\s*hidden/.test(rule('.atex-sl-main')),
        '#4783: правая часть не скроллится');
    assert(/height:\s*100%/.test(rule('.atex-sl')) && /overflow:\s*hidden/.test(rule('.atex-sl')),
        '#4783: пульт занимает высоту экрана целиком');
})();

// ── версия бандла поднята: правка js/css без бампа не доедет до планшета ──────────────────────
(function() {
    var tpl = fs.readFileSync(path.join(ROOT, 'templates/atex/slitter.html'), 'utf8');
    // Номер счётчика растёт с каждой правкой бандла (#4785 поднял его снова), поэтому
    // сторожим МЕХАНИЗМ: ассеты пульта подключены через счётчик версии базы, а не через
    // старую форму `?0{_global_.version}` (её сбрасывает только бамп ядра, #4058).
    assert(/js\/slitter\.js\?\{_global_\.version\}\.\d+/.test(tpl),
        '#4783: slitter.js подключён через счётчик версии базы');
    assert(/css\/slitter\.css\?\{_global_\.version\}\.\d+/.test(tpl),
        '#4783: slitter.css подключён через счётчик версии базы');
})();

Promise.all(pending).then(function() {
    console.log('\n' + passed + '/' + total + ' assertions passed');
    if (passed !== total) process.exitCode = 1;
});
