// Tests for ideav/crm#4402 — «Упорядочить» даёт откатить пересчёт: план сперва ПОКАЗЫВАЕТСЯ
// (карточки перерисованы, липкая панель со статистикой сверху) и пишется в БД только по
// «Применить»; «Отменить» (и обновление страницы) возвращает прежний план.
// Покрываем:
//   1) чистую projectPlanOnCuts: updates/creates/deletes/смена станка, исходные записи не мутируются;
//   2) startPlanPreview: очередь = проекция, панель .atex-pp-plan-bar со статистикой и кнопками,
//      карточка нового сегмента помечена «новое» и без ссылки на edit_obj, корень получил
//      класс is-plan-preview (действия над очередью гасятся);
//   3) запись в БД закрыта, пока план не принят (post отклоняется);
//   4) «Отменить» — очередь ровно та же (те же объекты), в БД ничего не писали;
//   5) «Применить» — applySplitPlan получает ТЕ ЖЕ ops, причём self.cuts к моменту записи
//      возвращены к исходным (иначе applySplitPlan лечил бы цепочки по синтетическим id).
//
// Run with: node experiments/atex-4402-optimize-preview.test.js

process.env.TZ = 'UTC';

// ── Минимальный DOM-стаб (как в atex-production-planning-4396.test.js) ──
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

function tsAt(y, m, d, hh, mm) { return Math.floor(new Date(y, m - 1, d, hh, mm, 0, 0).getTime() / 1000); }
var DAY1 = tsAt(2026, 7, 27, 8, 0);
var DAY2 = tsAt(2026, 7, 28, 8, 0);

function cutOf(id, planTs, slitterId) {
    return { id: id, number: String(planTs), planDate: String(planTs),
        slitter: { id: slitterId, label: 'Станок ' + slitterId },
        materialName: 'MW308', materialId: '500', winding: 'OUT', knifeWidths: [110], knifeCount: 1,
        plannedRuns: 6, length: 1000, duration: 60, status: '', startDate: '', endDate: '',
        leaders: [], sleeves: [], storedKnifeSetupMin: '30', storedMaterialWindingMin: '15', storedCutAndLeaderMin: '72' };
}

// ── 1) Чистая проекция плана ─────────────────────────────────────────────────
(function () {
    var cuts = [cutOf('11', DAY1, '101'), cutOf('12', DAY1, '101'), cutOf('13', DAY1, '101')];
    var ops = {
        updates: [{ cutId: '11', planStartTs: DAY2, plannedRuns: 4, sequence: 1 }],
        creates: [{ parentCutId: '11', planStartTs: DAY2 + 3600, plannedRuns: 2, sequence: 2 }],
        deletes: ['13']
    };
    var res = planning.projectPlanOnCuts(cuts, ops, {
        slitterById: { '101': { id: '101', label: 'Станок 101' }, '202': { id: '202', label: 'Станок 202' } },
        slitterByRecordId: { '12': '202' },
        durationForSegment: function(head, runs) { return runs * 10; }
    });

    var byId = {}; res.cuts.forEach(function(c) { byId[String(c.id)] = c; });
    assertEqual(res.cuts.length, 3, 'в проекции 3 записи: 2 прежних + новый сегмент (одна удалена)');
    assertEqual([byId['11'].planDate, byId['11'].plannedRuns, byId['11'].duration], [String(DAY2), 4, 40],
        'update переставил задание: новый planStart, проходы сегмента и его длительность');
    assertEqual(byId['11'].number, String(DAY2), '«номер» задания = плановый старт (#3242)');
    assertEqual(byId['12'].slitter, { id: '202', label: 'Станок 202' }, 'смена станка (кандидат A) с подписью из справочника');
    assert(!byId['13'], 'удаляемая запись цепочки из очереди убрана');

    var created = res.cuts.filter(function(c) { return c.previewNew; })[0];
    assert(!!created, 'создан синтетический сегмент предпросмотра');
    assert(planning.isPreviewCutId(created.id), 'его id помечен префиксом предпросмотра (в БД такого нет)');
    assertEqual([created.planDate, created.plannedRuns, created.duration, created.firstPartId],
        [String(DAY2 + 3600), 2, 20, '11'], 'сегмент наследует голову: старт/проходы/длительность/«ID первой части»');
    assertEqual([created.status, created.startDate, created.endDate, created.storedKnifeSetupMin],
        ['', '', '', ''], 'у нового сегмента нет ни статуса, ни факта, ни сохранённых колонок наладки');
    assertEqual([created.materialId, created.knifeCount], ['500', 1], 'сырьё и ножи — от головы цепочки');
    assertEqual(res.createdIds.length + '|' + res.deletedIds.join(','), '1|13', 'созданные/удаляемые перечислены');

    // Исходные записи не мутируются — по «Отменить» их возвращаем как есть.
    assertEqual([cuts[0].planDate, cuts[0].plannedRuns, cuts[1].slitter.id, cuts.length],
        [String(DAY1), 6, '101', 3], 'исходная очередь не тронута проекцией');

    // create без головы в очереди рисовать не от чего — пропускаем, а не падаем.
    var noHead = planning.projectPlanOnCuts(cuts, { updates: [], creates: [{ parentCutId: 'нет', planStartTs: DAY2, plannedRuns: 1 }], deletes: [] }, {});
    assertEqual(noHead.createdIds.length, 0, 'create с неизвестной головой пропущен');
})();

// ── 2–5) Контроллер: показ, блокировка записи, отмена, применение ────────────
function makeController(cuts) {
    var root = new StubNode('div'); root.attributes['data-db'] = 'testdb';
    var c = new Controller(root);
    c.root = root;
    c.planBarEl = new StubNode('div');
    c.formEl = new StubNode('div');
    c.queueEl = new StubNode('div');
    c.linkEl = new StubNode('div');
    c.filter = { slitter: '', status: '', date: '2026-07-27', dateTo: '2026-07-28', query: '' };
    c.slitters = [{ id: '101', label: 'Станок 101' }];
    c.activeSlitter = '101';
    c.cuts = cuts;
    c.positions = []; c.genPositions = []; c.supplies = []; c.genBatches = [];
    c.opTimes = {}; c.changeTimes = {}; c.footageBySupply = {}; c.consumptionByCut = {};
    c.jumboWidthByMaterial = {}; c.nominalWidthByMaterial = {}; c.actualWidthIndex = null;
    c.daySettings = {}; c.prevSetupBySlitter = {};
    c.notices = [];
    c.notify = function(msg, kind) { c.notices.push(kind + ': ' + msg); };
    c.renderLink = function() {};
    return c;
}
function previewPayload() {
    return {
        ops: { updates: [{ cutId: '11', planStartTs: DAY2, plannedRuns: 4 }],
               creates: [{ parentCutId: '11', planStartTs: DAY2 + 3600, plannedRuns: 2 }], deletes: [] },
        reassign: null, tailSetup: {}, slitterChange: false,
        coBefore: 120, coAfter: 90, lateBefore: 2, lateAfter: 0
    };
}

(function () {
    var cuts = [cutOf('11', DAY1, '101'), cutOf('12', DAY1, '101')];
    var c = makeController(cuts);
    var writes = [];
    c.applySplitPlan = function(ops) { writes.push({ cutsAtWrite: c.cuts, ops: ops }); return Promise.resolve(true); };
    c.persistSlitterReassignment = function() { writes.push({ reassign: true }); return Promise.resolve(true); };
    c.reload = function() { return Promise.resolve(true); };

    var payload = previewPayload();
    c.startPlanPreview(payload);

    assert(!!c._pendingPlan, 'план отложен (не записан)');
    assert(c.cuts !== cuts, 'очередь на экране — ПРОЕКЦИЯ, а не исходный массив');
    assertEqual(c.cuts.length, 3, 'в проекции появился новый сегмент');
    assertEqual(String(c.cuts[0].planDate), String(DAY2), 'задание переехало на новый день прямо в очереди');
    assertEqual([cuts[0].planDate, cuts.length], [String(DAY1), 2], 'исходная очередь (снимок) не изменилась');
    assertEqual(writes.length, 0, 'в БД ничего не писали');

    // Липкая панель со статистикой и кнопками.
    var bar = c.planBarEl.querySelector('.atex-pp-plan-bar');
    assert(!!bar, 'липкая панель показана');
    var barText = bar ? bar.textContent : '';
    assert(barText.indexOf('НЕ сохранён') !== -1, 'панель прямо говорит, что план не сохранён');
    assert(barText.indexOf('Было:') !== -1 && barText.indexOf('Станет:') !== -1,
        'в панели статистика «Было»/«Станет» (как в .atex-pp-recalc-preview)');
    assert(barText.indexOf('опоздания: 2 → 0 дн') !== -1, 'панель показывает опоздания до/после');
    assert(!!c.planBarEl.querySelector('.atex-pp-plan-apply'), 'кнопка «Применить» на месте');
    assert(!!c.planBarEl.querySelector('.atex-pp-plan-cancel'), 'кнопка «Отменить» на месте');
    assert(c.root.classList.contains('is-plan-preview'), 'корень помечен is-plan-preview (действия гасятся)');

    // Карточка нового сегмента: пометка «новое», без ссылки на несуществующий объект.
    var newCard = c.queueEl.querySelectorAll('.atex-pp-cut').filter(function(n) { return n.classList.contains('is-preview-new'); })[0];
    assert(!!newCard, 'карточка нового сегмента отрисована и помечена классом');
    assert(!!(newCard && newCard.querySelector('.atex-pp-cut-new-badge')), 'на карточке бейдж «новое»');
    var seq = newCard && newCard.querySelector('.atex-pp-cut-seq');
    assertEqual(seq && seq.tagName, 'SPAN', 'номер нового сегмента — текст, а не ссылка на edit_obj');

    // Запись в БД закрыта, пока план не принят.
    var postErr = null;
    return c.post('_m_set/11?JSON', { t1: '1' }).then(function() {
        assert(false, 'post обязан быть отклонён при непринятом плане');
    }, function(err) {
        postErr = err;
        assert(!!postErr && /Применить/.test(postErr.message), 'post отклонён с подсказкой «Применить»/«Отменить»');
    }).then(function() {
        // «Отменить» — очередь возвращается ровно к прежним объектам, в БД ничего не писали.
        c.planBarEl.querySelector('.atex-pp-plan-cancel').click();
        assert(c.cuts === cuts, 'после «Отменить» очередь — ТЕ ЖЕ исходные записи');
        assert(!c._pendingPlan, 'отложенный план снят');
        assert(!c.planBarEl.querySelector('.atex-pp-plan-bar'), 'липкая панель убрана');
        assert(!c.root.classList.contains('is-plan-preview'), 'класс блокировки снят');
        assertEqual(writes.length, 0, 'отмена ничего не записала');
        assert(c.notices.filter(function(n) { return /отменён/i.test(n); }).length === 1, 'сказано, что пересчёт отменён');
    });
})();

// ── 5) «Применить» пишет тот же план и от ИСХОДНОГО состояния очереди ────────
(function () {
    var cuts = [cutOf('11', DAY1, '101'), cutOf('12', DAY1, '101')];
    var c = makeController(cuts);
    var writes = [];
    c.applySplitPlan = function(ops) { writes.push({ cutsAtWrite: c.cuts, ops: ops }); return Promise.resolve(true); };
    c.persistSlitterReassignment = function(map, req) { writes.push({ reassign: map, req: req }); return Promise.resolve(true); };
    c.reload = function() { return Promise.resolve(true); };

    var payload = previewPayload();
    payload.reassign = { slitterByRecordId: { '12': '101' }, slitterReqId: '1156' };
    payload.slitterChange = true;
    c.startPlanPreview(payload);
    var sentOps = c._pendingPlan.ops;

    return c.applyPendingPlan().then(function() {
        assertEqual(writes.length, 2, 'записано двумя шагами: станки + план');
        assertEqual(writes[0].reassign, { '12': '101' }, 'смена станков записана первой (persistSlitterReassignment)');
        assert(writes[1].ops === sentOps, 'applySplitPlan получил ТЕ ЖЕ ops, что показывал предпросмотр');
        assert(writes[1].cutsAtWrite === cuts, 'к моменту записи self.cuts возвращены к исходным (не проекция)');
        assert(!c._pendingPlan, 'отложенный план снят');
        assert(!c.planBarEl.querySelector('.atex-pp-plan-bar'), 'панель убрана после применения');
        assert(c.notices.filter(function(n) { return /Очередь упорядочена/.test(n); }).length === 1,
            'итог отчитан: опоздания и переналадка до/после');
        // Запись снова разрешена (флаг снят ДО applySplitPlan).
        assert(!c._pendingPlan, 'post больше не блокируется — предпросмотра нет');
    });
})();

process.on('exit', function () {
    console.log('\n' + passed + '/' + total + ' passed');
});
