// #4604 — пульт слиттера: отметить готовыми СРАЗУ НЕСКОЛЬКО проходов.
// Было: «✓ Готово» (один проход) или «✓✓ Готовы все» (весь план). Оператор не отмечает каждый
// проход по ходу работы — он отрабатывает задание и закрывает его разом; при плане 100 и факте
// 99 приходилось жать кнопку 99 раз.
// Стало: кнопка «✓N Готовы несколько» → ввод числа выполненных проходов → ОДНА отметка
// (та же арифметика: «Кол-во резок факт», «Погонаж факт», «Счётчик кон.», расход партии).
//
// Run with: node experiments/atex-slitter-4604.test.js

process.env.TZ = 'Europe/Moscow';

// ── Минимальный DOM-стаб (как в atex-slitter-4362.test.js) ────────────────────────────────────
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

// ── правило «сколько проходов можно отметить» — один предикат ─────────────────────────────────
(function() {
    var r = core.passTargetFromInput('99', 0, 100);
    assert(r.ok && r.target === 99 && r.added === 99, '#4604: «99» при плане 100 — отмечаем 99 проходов');
    var partial = core.passTargetFromInput('99', 8, 100);
    assert(partial.ok && partial.target === 99 && partial.added === 91,
        '#4604: ввод — число выполненных ВСЕГО (99), добавляется 91 к отмеченным 8');
    assert(core.passTargetFromInput('100', 0, 100).ok === true, '#4604: весь план ввести можно');
    assert(core.passTargetFromInput('101', 0, 100).ok === false, '#4604: больше плана — нельзя');
    assert(core.passTargetFromInput('8', 8, 100).ok === false, '#4604: столько уже отмечено — не отметка');
    assert(core.passTargetFromInput('5', 8, 100).ok === false, '#4604: назад счёт проходов не идёт');
    assert(core.passTargetFromInput('0', 0, 100).ok === false, '#4604: ноль проходов — не отметка');
    assert(core.passTargetFromInput('', 0, 100).ok === false, '#4604: пусто — просим ввести');
    assert(core.passTargetFromInput('99,5', 0, 100).ok === false, '#4604: половина прохода не бывает');
    assert(core.passTargetFromInput('абв', 0, 100).ok === false, '#4604: не число — ошибка, а не молчаливый 0');
    assert(core.passTargetFromInput('101', 0, 100).error.indexOf('100') >= 0,
        '#4604: в ошибке сказано, сколько в плане (оператору видно, что вводить)');
})();

// ── отметка пачкой: одна запись на 99 проходов ────────────────────────────────────────────────
function makeInst(opts) {
    var o = opts || {};
    var inst = Object.create(Controller.prototype);
    inst.busy = false;
    // сценарий тикета: план 100 проходов по 450 м, оператор сделал 99
    inst.currentCut = { id: '90', batchId: '77', status: 'В работе', actualRuns: o.actualRuns || '',
        meterage: '', counterStart: '60000', counterEnd: '', runLength: '450',
        plannedRuns: String(o.plannedRuns == null ? 100 : o.plannedRuns) };
    inst.currentCutId = '90';
    inst.shiftEvents = [];
    inst.isCutLocked = function() { return false; };
    inst.eventDateTime = function() { return '2026-08-04 16:00:00'; };
    inst.meta = { cut: { id: '110', reqs: [
        { id: '1105', val: 'Кол-во резок факт' },
        { id: '1104', val: 'Погонаж факт, м' },
        { id: '1102', val: 'Счётчик кон.' },
        { id: '1110', val: 'Расход сырья' },
        { id: '1101', val: 'Начато' },
        { id: '1162', val: 'В работе' }
    ] } };
    inst.posts = [];
    inst.events = [];
    inst.consumed = [];
    inst.notes = [];
    inst.finished = 0;
    inst.post = function(path, params) { this.posts.push({ path: path, params: params }); return Promise.resolve({}); };
    inst.createEvent = function(ev) { this.events.push(ev); return Promise.resolve({}); };
    inst.applyBatchConsumption = function(cut, m, finishMode) { this.consumed.push({ m: m, finishMode: finishMode }); return Promise.resolve(null); };
    inst.loadEvents = function() { return Promise.resolve(); };
    inst.loadCuts = function() { return Promise.resolve(); };
    inst.applyEventStatuses = function() {};
    inst.setBusy = function(v) { this.busy = v; };
    inst.notify = function(msg) { this.notes.push(msg); };
    inst.render = function() {};
    inst.finishCut = function() { this.finished++; };
    inst.findBatch = function() { return null; };
    inst.isShiftOpen = function() { return true; };
    inst.allCutsDone = function() { return false; };
    inst.currentQueue = function() { return { cuts: [], firstOpenCutId: null }; };
    return inst;
}

// запись идёт цепочкой промисов — даём ей доработать
function flush() { return new Promise(function(resolve) { setTimeout(resolve, 0); }); }

async function markBatchScenarios() {
    var inst = makeInst();
    inst.markPassDone(false, 99);
    assert(inst.posts.length === 1, '#4604: 99 проходов — ОДНА запись, а не 99');
    var p = inst.posts[0].params;
    assert(p['t1105'] === 99, '#4604: «Кол-во резок факт» = 99');
    assert(p['t1104'] === 44550, '#4604: «Погонаж факт» = 99 × 450');
    assert(p['t1102'] === 15450, '#4604: «Счётчик кон.» = 60000 − 44550 (счётчик мотает назад, #4321)');
    assert(p['t1110'] === 44550, '#3861: расход сырья — накопленный погонаж резки');
    await flush();
    assert(inst.consumed.length === 1 && inst.consumed[0].m === 44550,
        '#3861: с партии списаны метры всех 99 проходов разом');
    assert(inst.consumed[0].finishMode === false, '#4604: 99 из 100 — задание НЕ завершается');
    assert(inst.finished === 0, '#4604: недоделанный план не завершает задание (остаётся в работе)');
    assert(inst.events.length === 1 && inst.events[0].value === '99',
        '#4604: событие «Резка» одно, значение — достигнутый номер прохода');
    assert(inst.notes.some(function(m) { return m.indexOf('+99') >= 0 && m.indexOf('99 из 100') >= 0; }),
        '#4604: оператору сказано, сколько отмечено: «+99 → 99 из 100»');

    // ── уже отмеченные проходы не теряются и не пересчитываются заново ────────────────────────
    var partial = makeInst({ actualRuns: '8' });
    partial.markPassDone(false, 99);
    assert(partial.posts[0].params['t1105'] === 99, '#4604: было 8 → стало 99 (ввод — «сколько сделано всего»)');
    await flush();
    assert(partial.consumed[0].m === core.round3(91 * 450),
        '#4604: с партии списаны только НОВЫЕ 91 проход, а не все 99');

    // ── ввод, равный плану, завершает задание — как «✓✓ Готовы все» ───────────────────────────
    var full = makeInst();
    full.markPassDone(false, 100);
    assert(full.posts[0].params['t1105'] === 100, '#4604: 100 из 100 — пишем весь план');
    await flush();
    assert(full.consumed[0].finishMode === true, '#4604: план выполнен → у партии снимается «В работе»');
    assert(full.finished === 1, '#4604: план выполнен → задание завершается (finishCut)');
}

// ── негодный ввод до записи не доходит (тот же предикат, что в модалке) ───────────────────────
[['101', 'больше плана'], ['0', 'ноль'], ['5', 'меньше уже отмеченных'], ['абв', 'не число']].forEach(function(pair) {
    var inst = makeInst({ actualRuns: '8' });
    inst.markPassDone(false, pair[0]);
    assert(inst.posts.length === 0, '#4604: ввод «' + pair[0] + '» (' + pair[1] + ') — записи нет');
    assert(inst.notes.length === 1, '#4604: ввод «' + pair[0] + '» — оператору сказано, почему (молча не глотаем)');
});

// ── прежние проверки отметки прохода живы и для пачки ─────────────────────────────────────────
(function() {
    var noBatch = makeInst();
    noBatch.currentCut.batchId = '';
    noBatch.markPassDone(false, 99);
    assert(noBatch.posts.length === 0 && noBatch.notes.some(function(m) { return m.indexOf('Партии сырья') >= 0; }),
        '#4580: без «Партии сырья» пачка проходов тоже не отмечается');

    var noStart = makeInst();
    noStart.currentCut.counterStart = '';
    noStart.markPassDone(false, 99);
    assert(noStart.posts.length === 0 && noStart.notes.some(function(m) { return m.indexOf('Счётчик нач.') >= 0; }),
        '#4580: без «Счётчик нач.» пачка проходов тоже не отмечается');

    var doneCut = makeInst({ actualRuns: '100' });
    doneCut.currentCut.status = 'Завершена';
    doneCut.markPassDone(false, 100);
    assert(doneCut.posts.length === 0, '#3583: завершённое задание отметку не принимает');
})();

// ── кнопка и модалка ──────────────────────────────────────────────────────────────────────────
function passButtons(inst) {
    return inst.renderPassButtons(inst.currentCut).childNodes
        .filter(function(n) { return n.classList.contains('atex-sl-btn-pass'); });
}
(function() {
    var inst = makeInst();
    var btns = passButtons(inst);
    // #4783 п.6: «✓✓ Готовы все» убрана — весь остаток отмечает эта же кнопка (в её модалке
    // по умолчанию предложен ВЕСЬ план), поэтому кнопок проходов две.
    assert(btns.length === 2 && btns[1].textContent === '✓N Готовы несколько',
        '#4604: рядом с «✓ Готово» — кнопка отметки нескольких проходов');

    // остался один проход — пачку набирать не из чего, кнопки нет
    var lastOne = makeInst({ actualRuns: '99' });
    assert(passButtons(lastOne).length === 1,
        '#4604: остался 1 проход — «✓N Готовы несколько» не показываем (это «✓ Готово»)');

    // задание-«настройка» (#3635 п.5, «Кол-во резок план» = 0) — проходов нет вовсе
    var setup = makeInst({ plannedRuns: 0 });
    assert(passButtons(setup).length === 1, '#3635 п.5: у задания-«настройки» кнопки пачки нет');
})();

(function() {
    var inst = makeInst({ actualRuns: '8' });
    var marked = [];
    inst.markPassDone = function(all, target) { marked.push([all, target]); };
    inst.askPassCount(inst.currentCut);
    var overlay = document.body.childNodes[document.body.childNodes.length - 1];
    var input = overlay.querySelector('.atex-sl-confirm-input');
    assert(!!input && input.value === '100', '#4604: по умолчанию предложен весь план — чаще всего сделано всё');
    assert(overlay.querySelector('.atex-sl-confirm-sub').textContent.indexOf('Уже отмечено: 8') >= 0,
        '#4604: видно, сколько проходов уже отмечено');

    input.value = '99';
    input.dispatch('input');
    var hint = overlay.querySelector('.atex-sl-confirm-hint').textContent;
    assert(hint.indexOf('91') >= 0 && hint.indexOf('40950') >= 0,
        '#4604: до записи показано, сколько проходов добавится и на сколько метров (91 × 450)');
    assert(hint.indexOf('Останется 1') >= 0, '#4604: сказано, что задание останется в работе с остатком 1 прохода');

    // Кнопку подтверждения ищем по классу, а не по подписи: подпись — вопрос
    // формулировки и меняется (#4692), правило же тут про то, что уходит в
    // markPassDone.
    overlay.querySelector('.atex-sl-btn-primary').click();
    assert(JSON.stringify(marked) === '[[false,99]]', '#4604: «Отметить» отдаёт число проходов в markPassDone');
    assert(document.body.childNodes.indexOf(overlay) === -1, '#4604: после отметки модалка закрывается');
})();

(function() {
    var inst = makeInst();
    var marked = [];
    inst.markPassDone = function(all, target) { marked.push([all, target]); };
    inst.askPassCount(inst.currentCut);
    var overlay = document.body.childNodes[document.body.childNodes.length - 1];
    var input = overlay.querySelector('.atex-sl-confirm-input');
    input.value = '150';
    input.dispatch('input');
    assert(overlay.querySelector('.atex-sl-confirm-error').textContent.indexOf('100') >= 0,
        '#4604: 150 при плане 100 — ошибка видна сразу, до нажатия');
    overlay.querySelector('.atex-sl-btn-primary').click();
    assert(marked.length === 0 && document.body.childNodes.indexOf(overlay) !== -1,
        '#4604: с негодным числом модалка не закрывается и ничего не отмечает');
    overlay.querySelector('.atex-sl-btn-secondary').click();
    assert(document.body.childNodes.indexOf(overlay) === -1, '#4604: «Отмена» закрывает модалку без записи');
})();

markBatchScenarios().then(function() {
    console.log('\n' + passed + '/' + total + ' assertions passed');
    if (passed !== total) process.exitCode = 1;
});
