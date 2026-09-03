// #4798 — пульт втулкореза приведён к виду пульта слиттера:
//   1. левого меню на странице пульта нет (решение принимается в head main.html);
//   2. даты и выбора втулкореза в форме нет — они ушли в шапку страницы
//      (.navbar-workspace), дата — текущая календарная, втулкорез выбирается кнопкой;
//   3. «✓✓ Закрыть все» в тулбаре нет: #4798 переехал её из тулбара к сводке,
//      #4861 — в заголовок дня (.atex-sc-day-head), ведь день закрывают целиком.
//
// Run with: node experiments/atex-sc-4798-fullscreen.test.js

process.env.TZ = 'Europe/Moscow';

var fs = require('fs');
var path = require('path');
var vm = require('vm');
var ROOT = path.join(__dirname, '..');

// ── Минимальный DOM-стаб (как в atex-slitter-4783.test.js) ────────────────────────────────────
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
global.window = { db: 'ateh', atexPad: { id: '7', name: 'Планшет №7' } };

var mod = require('../download/atex/js/sleeve-cutter.js');
var core = mod.core;
var Controller = mod.Controller;

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

// ── п.1: левого меню на странице пульта нет ───────────────────────────────────────────────────
// Проверяем ПОВЕДЕНИЕ head-скрипта main.html, а не его текст: исполняем блок с разными
// значениями `action` и смотрим, появился ли в head стиль, прячущий меню. Скрипт живёт в
// шаблоне (не CommonJS-модуль), поэтому его достают чтением и исполняют — так же, как это
// делает браузер.
function runFullscreenHeadScript(action) {
    var tpl = fs.readFileSync(path.join(ROOT, 'templates/atex/main.html'), 'utf8');
    var head = tpl.slice(0, tpl.indexOf('</head>'));
    var block = head.split(/<script>/).filter(function(s) { return s.indexOf('FULLSCREEN_ACTIONS') !== -1; })[0];
    if (!block) return null;   // блока нет — вызывающий увидит null и покажет FAIL
    var appended = [];
    var sandbox = {
        action: action,
        document: {
            createElement: function() { return { id: '', textContent: '' }; },
            head: { appendChild: function(node) { appended.push(node); } }
        }
    };
    vm.runInNewContext(block.split('</script>')[0], sandbox);
    return appended;
}
(function() {
    var forCutter = runFullscreenHeadScript('sleeve-cutter');
    assert(!!forCutter && forCutter.length === 1 && forCutter[0].id === 'fullscreen-workspace-style',
        '#4798 п.1: на пульте втулкореза head добавляет стиль полноэкранного рабочего места');
    assert(!!forCutter && forCutter.length === 1
        && forCutter[0].textContent.indexOf('.app-sidebar') !== -1
        && forCutter[0].textContent.indexOf('display:none!important') !== -1,
        '#4798 п.1: этот стиль прячет левое меню');

    var forSlitter = runFullscreenHeadScript('slitter');
    assert(!!forSlitter && forSlitter.length === 1,
        '#4798 п.1: пульт слиттера остался полноэкранным (#4783 не сломан)');

    var forPlanning = runFullscreenHeadScript('production-planning');
    assertEqual(forPlanning, [],
        '#4798 п.1: обычному рабочему месту меню не трогаем');
})();

// ── п.2: дата и втулкорез — в шапке страницы, а не в форме ────────────────────────────────────
assert(typeof Controller.prototype.renderToolbar === 'undefined',
    '#4798 п.2: тулбара с датой и втулкорезом в пульте нет');
assert(typeof Controller.prototype.field === 'undefined',
    '#4798 п.2: обёртки «подпись + контрол» тулбара нет — её некому звать');
assert(typeof Controller.prototype.storeDate === 'undefined'
    && typeof Controller.prototype.restoreDate === 'undefined',
    '#4798 п.2: выбранный день не запоминается — дата всегда текущая календарная');
assert(typeof Controller.prototype.renderWorkspaceTitle === 'function',
    '#4798 п.2: подпись пульта рисуется в шапке страницы');
assert(typeof Controller.prototype.chooseCutter === 'function',
    '#4798 п.2: втулкорез выбирается из шапки — модалкой');

assertEqual(core.workspaceTitleParts('Планшет №7', '2026-08-20', 'Втулкорез 1'),
    ['Планшет №7', '20.08.2026', 'Втулкорез 1'],
    '#4798 п.2: подпись пульта — планшет · дата · втулкорез');
assertEqual(core.workspaceTitleParts('', '2026-08-20', 'Втулкорез 1'),
    ['20.08.2026', 'Втулкорез 1'],
    '#4798 п.2: имени планшета нет (пульт открыт мимо сторожа) — часть опускается');
assertEqual(core.workspaceTitleParts('Планшет №7', '2026-08-20', ''),
    ['Планшет №7', '20.08.2026', 'Втулкорез не выбран'],
    '#4798 п.2: втулкорез не выбран — подпись говорит об этом прямо');

// ── Живой рендер: сводка, шапка, «Закрыть все» ────────────────────────────────────────────────
function makeController(opts) {
    opts = opts || {};
    var inst = Object.create(Controller.prototype);
    inst.root = new StubNode('div');
    inst.root.classList.add('atex-sc');
    inst.db = 'ateh';
    inst.cutters = [{ id: '10', label: 'Втулкорез 1' }, { id: '20', label: 'Втулкорез 2' }];
    inst.selectedCutterId = opts.cutterId === undefined ? '10' : opts.cutterId;
    inst.selectedDate = '2026-08-20';
    inst.showDone = false;
    inst.missingCols = [];
    inst.busy = false;
    inst.tasks = opts.tasks || [];
    inst.tasksEl = new StubNode('section');
    inst.tasksEl.classList.add('atex-sc-main');
    inst.root.appendChild(inst.tasksEl);
    inst.toastHost = inst.root;
    return inst;
}
// Плановый старт — внутри выбранного дня (локальная полночь + 9 ч).
var dayStart = core.dayBoundsUnix('2026-08-20').start;
function task(id, extra) {
    var row = { task_id: id, task_date: String(dayStart + 9 * 3600), cutter_id: '10', qty: '5' };
    Object.keys(extra || {}).forEach(function(k) { row[k] = extra[k]; });
    return core.taskFromReportRow(row);
}

(function() {
    var inst = makeController({ tasks: [task('1'), task('2')] });
    navbarSlot.childNodes = [];
    inst.render();

    // п.2: в форме не осталось ни select-а втулкореза, ни поля даты
    assert(inst.root.querySelectorAll('.atex-sc-input').length === 0,
        '#4798 п.2: в форме пульта не осталось полей ввода тулбара');
    assert(inst.root.querySelector('.atex-sc-toolbar') === null,
        '#4798 п.2: тулбара в разметке пульта нет');

    // п.2: шапка страницы несёт планшет · дату · втулкорез, последний — кнопка
    assert(navbarSlot.textContent.indexOf('Планшет №7') !== -1
        && navbarSlot.textContent.indexOf('20.08.2026') !== -1
        && navbarSlot.textContent.indexOf('Втулкорез 1') !== -1,
        '#4798 п.2: шапка страницы показывает планшет, дату и втулкорез');
    var navBtn = navbarSlot.querySelector('.atex-sc-nav-cutter');
    assert(!!navBtn && navBtn.tagName === 'BUTTON',
        '#4798 п.2: втулкорез в шапке — кнопка выбора');
    if (navBtn) {
        navBtn.click();
        assert(inst.root.querySelector('.atex-sc-cutter-list') !== null,
            '#4798 п.2: клик по втулкорезу открывает выбор из справочника');
    } else {
        assert(false, '#4798 п.2: клик по втулкорезу открывает выбор из справочника');
    }

    // п.3 (#4861): «Закрыть все» — в заголовке ДНЯ (.atex-sc-day-head), рядом со сводкой
    // этого дня: день закрывают целиком, а не окно. В тулбаре её по-прежнему нет.
    var summary = inst.root.querySelector('.atex-sc-summary');
    assert(!!summary, '#4798 п.3: сводка окна отрисована');
    var allBtn = inst.root.querySelectorAll('.atex-sc-btn').filter(function(n) {
        return n.textContent.indexOf('Закрыть все') !== -1;
    })[0];
    assert(!!allBtn, '#4798 п.3: кнопка «✓✓ Закрыть все» на месте');
    assert(!!allBtn && !!allBtn.parentNode && allBtn.parentNode.classList.contains('atex-sc-day-head'),
        '#4798 п.3/#4861: «✓✓ Закрыть все» — в заголовке дня, а не в тулбаре');
})();

(function() {
    // Все задания дня закрыты — закрывать нечего, кнопки нет.
    var done = task('1', { finished: String(dayStart + 10 * 3600), fact: '5' });
    var inst = makeController({ tasks: [done] });
    navbarSlot.childNodes = [];
    inst.render();
    var allBtn = inst.root.querySelectorAll('.atex-sc-btn').filter(function(n) {
        return n.textContent.indexOf('Закрыть все') !== -1;
    })[0];
    assert(!allBtn, '#4798 п.3: активных заданий нет — кнопки «Закрыть все» в сводке нет');
})();

(function() {
    // Втулкорез не выбран — подпись в шапке об этом говорит, список просит выбрать.
    var inst = makeController({ cutterId: null });
    navbarSlot.childNodes = [];
    inst.render();
    assert(navbarSlot.textContent.indexOf('Втулкорез не выбран') !== -1,
        '#4798 п.2: без втулкореза шапка объясняет, почему список пуст');
})();

console.log('\n' + passed + '/' + total + ' проверок прошли');
if (passed !== total) process.exitCode = 1;
