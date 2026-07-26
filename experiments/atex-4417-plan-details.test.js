// Tests for ideav/crm#4417 — сводная форма непринятого плана («Упорядочить», #4402):
//   • кнопка «Детали» МЕЖДУ «Применить» и «Отменить» — модалка со ВСЕМИ изменёнными заданиями;
//   • карточки заданий, которых план коснулся (время старта, станок или ТАЙМИНГ), заметно
//     помечены — их ищут, листая станки и дни.
// Покрываем:
//   1) чистую planChangeRows: переставлено / только тайминг / смена станка / новый сегмент /
//      удаляется; нетронутое задание в список НЕ попадает; счётчики и сортировка по новому старту;
//   2) чистые planChangeSummary и planChangeTitle — подпись бейджа и «было → стало»;
//   3) панель: порядок кнопок «Применить» → «Детали» → «Отменить», модалка со списком, ссылка на
//      edit_obj у существующих записей и её отсутствие у нового сегмента;
//   4) карточку очереди: класс is-preview-changed и бейдж с перечнем изменений;
//   5) «Детали» без непринятого плана — понятный ответ, а не пустая модалка.
//
// Run with: node experiments/atex-4417-plan-details.test.js

process.env.TZ = 'UTC';

// ── Минимальный DOM-стаб (как в experiments/atex-4402-optimize-preview.test.js) ──
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
globalThis.PP_TRACE_PLACEMENT = false;

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
function clone(c) { return JSON.parse(JSON.stringify(c)); }
var SLITTERS = { '101': { id: '101', label: 'Станок 101' }, '202': { id: '202', label: 'Станок 202' } };

// ── 1) Чистая planChangeRows ────────────────────────────────────────────────
(function () {
    var snapshot = [
        cutOf('11', DAY1, '101'),               // уедет на другой день
        cutOf('12', DAY1 + 3600, '101'),        // сменит станок
        cutOf('13', DAY1 + 7200, '101'),        // не тронуто
        cutOf('14', DAY1 + 10800, '101'),       // только тайминг
        cutOf('15', DAY2, '101')                // удаляется
    ];
    var projected = [
        (function() { var c = clone(snapshot[0]); c.number = String(DAY2); c.planDate = String(DAY2); return c; })(),
        (function() { var c = clone(snapshot[1]); c.slitter = { id: '202', label: 'Станок 202' }; return c; })(),
        clone(snapshot[2]),
        clone(snapshot[3]),
        (function() { var c = clone(snapshot[0]); c.id = 'preview:1'; c.previewNew = true; c.firstPartId = '11';
            c.number = String(DAY2 + 3600); c.planDate = String(DAY2 + 3600); c.plannedRuns = 2; return c; })()
    ];
    var timingUpdates = [
        { cutId: '14', knife: 45, material: 15, cutTime: 72, wasKnife: '30', wasMaterial: '15', wasCutTime: '72' },
        { cutId: '13', knife: 30, material: 15, cutTime: 72, wasKnife: '30', wasMaterial: '15', wasCutTime: '72' }   // ничего не меняется
    ];
    var res = planning.planChangeRows(snapshot, projected, timingUpdates, { slitterById: SLITTERS });

    assertEqual([res.movedCount, res.createdCount, res.deletedCount], [3, 1, 1],
        'счётчики: переставлено 3 (старт/станок/тайминг), новых 1, удаляется 1');
    assertEqual(res.rows.map(function(r) { return r.cutId; }), ['12', '14', '11', 'preview:1', '15'],
        'порядок: сперва переставленные по новому старту, затем новые, затем удаляемые');
    assert(!res.byId['13'], 'нетронутое задание в список НЕ попало');

    var moved11 = res.byId['11'];
    assertEqual([moved11.kind, moved11.whenFrom, moved11.whenTo, moved11.startChanged, moved11.slitterChanged, moved11.timingChanged],
        ['moved', '27.07 08:00', '28.07 08:00', true, false, false], 'переезд на другой день: время до → после');
    var moved12 = res.byId['12'];
    assertEqual([moved12.slitterFrom, moved12.slitterTo, moved12.slitterChanged, moved12.startChanged],
        ['Станок 101', 'Станок 202', true, false], 'смена станка без сдвига времени тоже попадает в список');
    var moved14 = res.byId['14'];
    assertEqual([moved14.startChanged, moved14.slitterChanged, moved14.timingChanged, moved14.timing],
        [false, false, true, [{ key: 'knife', label: 'наладка ножей', from: 30, to: 45 }]],
        'изменение ТОЛЬКО тайминга видно (по planStart его не найти)');
    var created = res.byId['preview:1'];
    assertEqual([created.kind, created.parentCutId, created.whenTo, created.runs],
        ['new', '11', '28.07 09:00', 2], 'новый сегмент: от какой головы, когда, сколько проходов');
    assertEqual([res.byId['15'].kind, res.byId['15'].whenFrom], ['deleted', '28.07 08:00'], 'удаляемая запись помечена');

    // Пустое хранимое значение колонки — это тоже изменение («—» → 30), но подписывается честно.
    var fill = planning.planChangeRows([snapshot[3]], [clone(snapshot[3])],
        [{ cutId: '14', knife: 30, material: 0, cutTime: 72, wasKnife: '', wasMaterial: '', wasCutTime: '72' }],
        { slitterById: SLITTERS });
    assertEqual(fill.rows[0].timing, [{ key: 'knife', label: 'наладка ножей', from: null, to: 30 }],
        'пустая колонка наладки → изменение «— → 30» (нулевое «сырьё/намотка» из пустого — не изменение)');

    // Ничего не менялось — пустой разбор (панель тогда не врёт «переставлено N»).
    var none = planning.planChangeRows(snapshot, snapshot.map(clone), [], { slitterById: SLITTERS });
    assertEqual([none.rows.length, none.movedCount], [0, 0], 'без изменений список пуст');
})();

// ── 2) Подписи ──────────────────────────────────────────────────────────────
(function () {
    var moved = { kind: 'moved', cutId: '11', label: 'MW308 OUT', whenFrom: '27.07 08:00', whenTo: '28.07 08:00',
        slitterFrom: 'Станок 101', slitterTo: 'Станок 202', startChanged: true, slitterChanged: true,
        timingChanged: true, timing: [{ key: 'knife', label: 'наладка ножей', from: null, to: 45 }] };
    assertEqual(planning.planChangeSummary(moved), 'старт · станок · тайминг', 'бейдж перечисляет, что поменялось');
    assertEqual(planning.planChangeTitle(moved),
        'Изменится: старт 27.07 08:00 → 28.07 08:00 · станок Станок 101 → Станок 202 · наладка ножей — → 45 мин',
        'подсказка карточки — полное «было → стало»');
    assertEqual(planning.planChangeSummary({ kind: 'new' }), 'новое', 'новый сегмент подписан «новое»');
    assertEqual(planning.planChangeSummary({ kind: 'deleted' }), 'удаляется', 'удаляемая запись подписана');
    assert(/Новый сегмент разбиения/.test(planning.planChangeTitle(
        { kind: 'new', parentCutId: '11', whenTo: '28.07 09:00', runs: 2 })), 'у нового сегмента своя подсказка');
    assert(/удаляется по «Применить»/.test(planning.planChangeTitle(
        { kind: 'deleted', whenFrom: '28.07 08:00' })), 'у удаляемой записи своя подсказка');
})();

// ── 3–5) Контроллер: кнопка, модалка, пометка карточек ──────────────────────
function makeController(cuts) {
    var root = new StubNode('div'); root.attributes['data-db'] = 'testdb';
    var c = new Controller(root);
    c.root = root;
    c.db = 'testdb';
    c.planBarEl = new StubNode('div');
    c.formEl = new StubNode('div');
    c.queueEl = new StubNode('div');
    c.linkEl = new StubNode('div');
    c.filter = { slitter: '', status: '', date: '2026-07-27', dateTo: '2026-07-28', query: '' };
    c.slitters = [{ id: '101', label: 'Станок 101' }, { id: '202', label: 'Станок 202' }];
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

(function () {
    var cuts = [cutOf('11', DAY1, '101'), cutOf('12', DAY1 + 3600, '101')];
    var c = makeController(cuts);
    c.startPlanPreview({
        ops: { updates: [{ cutId: '11', planStartTs: DAY2, plannedRuns: 6 }],
               creates: [{ parentCutId: '11', planStartTs: DAY2 + 3600, plannedRuns: 2 }], deletes: [] },
        reassign: null, tailSetup: {}, slitterChange: false,
        coBefore: 120, coAfter: 90, lateBefore: 2, lateAfter: 0
    });

    // Кнопка «Детали» — между «Применить» и «Отменить».
    var btnBox = c.planBarEl.querySelector('.atex-pp-plan-btns');
    assert(!!btnBox, 'блок кнопок панели на месте');
    assertEqual(btnBox.childNodes.map(function(n) { return n.textContent; }), ['Применить', 'Детали', 'Отменить'],
        '«Детали» стоит МЕЖДУ «Применить» и «Отменить»');

    // Модалка со списком изменений.
    c.planBarEl.querySelector('.atex-pp-plan-details-btn').click();
    var modal = c.root.querySelector('.atex-pp-plan-details-modal');
    assert(!!modal, 'модалка «Детали» открылась');
    var items = modal.querySelectorAll('.atex-pp-plan-details-item');
    assertEqual(items.length, 2, 'в списке 2 строки: переставленное задание и новый сегмент');
    var text = modal.textContent;
    assert(/Переставлено заданий: 1/.test(text) && /новых сегментов: 1/.test(text), 'сводка над списком');
    assert(/27\.07 08:00 → 28\.07 08:00/.test(text), 'у переставленного видно «было → стало»');
    assert(/в базу ничего не записано|базу ничего не записано|базе ничего/i.test(text)
        || /НЕ записано|не записано/.test(text), 'сказано, что в базу ещё ничего не записано');

    var movedItem = items.filter(function(n) { return n.classList.contains('is-moved'); })[0];
    var idLink = movedItem && movedItem.querySelector('.atex-pp-plan-details-id');
    assertEqual(idLink && idLink.tagName, 'A', 'у существующей записи — ссылка на карточку задания');
    assert(/edit_obj\/11/.test((idLink && idLink.getAttribute('href')) || ''), 'ссылка ведёт на edit_obj задания');
    var newItem = items.filter(function(n) { return n.classList.contains('is-new'); })[0];
    var newId = newItem && newItem.querySelector('.atex-pp-plan-details-id');
    assertEqual(newId && newId.tagName, 'SPAN', 'у нового сегмента ссылки нет — записи в БД ещё не существует');

    // Карточка в очереди помечена, и видно чем именно.
    var changedCards = c.queueEl.querySelectorAll('.atex-pp-cut').filter(function(n) { return n.classList.contains('is-preview-changed'); });
    assertEqual(changedCards.length, 1, 'помечена ровно одна карточка — та, что переставили');
    var badge = changedCards[0] && changedCards[0].querySelector('.atex-pp-cut-chg-badge');
    assert(!!badge, 'на карточке бейдж изменения');
    assertEqual(badge && badge.textContent, 'старт', 'бейдж говорит, что поменялось');
    assert(/27\.07 08:00 → 28\.07 08:00/.test((badge && badge.getAttribute('title')) || ''),
        'в подсказке бейджа — «было → стало»');
    var newCards = c.queueEl.querySelectorAll('.atex-pp-cut').filter(function(n) { return n.classList.contains('is-preview-new'); });
    assertEqual(newCards.length, 1, 'новый сегмент помечен по-прежнему своим классом (#4402)');
    assert(!newCards[0].classList.contains('is-preview-changed'), 'новому сегменту метку «изменено» не ставим — он и так «новое»');

    // «Отменить» — метки уходят вместе с проекцией.
    c.planBarEl.querySelector('.atex-pp-plan-cancel').click();
    assert(c.cuts === cuts, 'после «Отменить» очередь — исходные записи');
    assert(!cuts[0].previewChanged, 'на исходных записях пометок предпросмотра не осталось');
    assertEqual(c.queueEl.querySelectorAll('.atex-pp-cut').filter(function(n) { return n.classList.contains('is-preview-changed'); }).length, 0,
        'после отмены помеченных карточек нет');
})();

// 5) «Детали» без непринятого плана — понятный ответ.
(function () {
    var c = makeController([cutOf('11', DAY1, '101')]);
    c.openPlanDetails();
    assert(!c.root.querySelector('.atex-pp-plan-details-modal'), 'пустая модалка не открывается');
    assert(c.notices.filter(function(n) { return /показывать нечего/.test(n); }).length === 1,
        'вместо неё — понятный ответ');
})();

process.on('exit', function () {
    console.log('\n' + passed + '/' + total + ' passed');
});
