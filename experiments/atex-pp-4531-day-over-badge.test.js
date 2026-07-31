// UI-тесты: ideav/crm#4531 (продолжение) — переполненный день ВИДНО В ОЧЕРЕДИ, а не только в
// предупреждении.
//
// СИМПТОМ. Шапка дня показывает «Чт, 30.07.2026 (421 мин)» — сумму минут БЕЗ мерки: помещается
// эта сумма в смену или нет, по ней не понять. О переборе говорил только тост, и заказчик на него
// справедливо ругался («зачем мне пишут эти непонятные красные сообщения»): чтобы найти виноватый
// день, приходилось сверять числа глазами.
//
// ЧЕГО ЖДЁМ:
//   A — шапка переполненного дня помечена (`is-over`) и несёт бейдж с перебором «+N мин сверх смены»;
//   B — в подсказке бейджа названа мерка (до HH:MM при потолке HH:MM) и виновник (номер задания в
//       дне + сырьё/размеры) — то же, что в предупреждении: мерка ОДНА;
//   C — день в пределах смены не помечен ничем (не красим всё подряд);
//   D — мерка общая с предупреждением: `overfilledDaysFromCuts` — чистая функция над набором
//       заданий, её же зовёт `overfilledDaysOf` (#4408/#4497).
//
// Run with: node experiments/atex-pp-4531-day-over-badge.test.js

process.env.TZ = 'UTC';

// ── Минимальный DOM-стаб (как в atex-production-planning-3788-ui.test.js) ──
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
var Controller = api.Controller;
var planning = api.planning;

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

// Смена 08:00–16:30, обед 12:20×40, буфер уборки 15 мин → потолок резки 16:15.
var DAY_SETTINGS = { DAY_START_HOUR: '08:00', DAY_END_HOUR: '16:30', LUNCH_START: '12:20',
    LUNCH_DURATION: '40', TOTAL_INTERVALS: '15' };
function tsAt(y, m, d, hh, mm) { return Math.floor(new Date(y, m - 1, d, hh, mm, 0, 0).getTime() / 1000); }
function cutOf(id, dayOfMonth, hh, mm, occMin, over) {
    var ts = tsAt(2026, 7, dayOfMonth, hh, mm);
    var c = { id: id, number: String(ts), planDate: String(ts),
        slitter: { id: '101', label: 'Станок 1' },
        materialId: '500', materialName: 'MW308', winding: 'IN', status: '',
        knifeWidths: [110, 110], knifeCount: 2, plannedRuns: 12, length: 450,
        storedKnifeSetupMin: occMin >= 45 ? '30' : '0',
        storedMaterialWindingMin: occMin >= 45 ? '15' : '0',
        storedCutAndLeaderMin: String(occMin >= 45 ? occMin - 45 : occMin),
        leaders: [], sleeves: [] };
    for (var k in (over || {})) if (Object.prototype.hasOwnProperty.call(over, k)) c[k] = over[k];
    return c;
}

function makeController(cuts) {
    var root = new StubNode('div'); root.attributes['data-db'] = 'testdb';
    var c = new Controller(root);
    c.queueEl = new StubNode('div'); c.linkEl = new StubNode('div'); c.formEl = new StubNode('div');
    c.filter = { slitter: '', status: '', date: '2026-07-30', dateTo: '2026-07-31', query: '' };
    c.slitters = [{ id: '101', label: 'Станок 1' }];
    c.activeSlitter = '101';
    c.cuts = cuts;
    c.positions = []; c.genPositions = []; c.supplies = []; c.genBatches = [];
    c.opTimes = {}; c.changeTimes = {}; c.footageBySupply = {}; c.consumptionByCut = {};
    c.jumboWidthByMaterial = {}; c.nominalWidthByMaterial = {}; c.actualWidthIndex = null;
    c.daySettings = DAY_SETTINGS; c.prevSetupBySlitter = {}; c.downtimesBySlitter = {}; c.calendarByDay = {};
    c.renderLink = function() {};
    c.notify = function() {};
    return c;
}

// 30.07 — обычный день (08:00, 300 мин → до 13:00); 31.07 — переполненный (08:00 480 мин + хвост
// 16:00 30 мин → работа до 16:30 при потолке 16:15, перебор +15 мин).
function twoDays() {
    return [cutOf('ok', 30, 8, 0, 300),
            cutOf('big', 31, 8, 0, 480),
            cutOf('tail', 31, 16, 0, 30, { materialName: 'MR194', winding: 'OUT', length: 600, plannedRuns: 4 })];
}

// ── A/B/C: шапка дня ────────────────────────────────────────────────────────────────────────
(function () {
    var c = makeController(twoDays());
    c.renderQueue();
    var heads = c.queueEl.querySelectorAll('.atex-pp-day-date');
    assert(heads.length === 2, '#4531-A: в очереди две шапки дня', '(' + heads.length + ')');

    var ok = heads[0], over = heads[1];
    assert(/30\.07\.2026/.test(ok.textContent) && /31\.07\.2026/.test(over.textContent),
        '#4531-A: дни идут по порядку', '(' + ok.textContent + ' | ' + over.textContent + ')');

    assert(over.classList.contains('is-over'),
        '#4531-A: шапка переполненного дня помечена', '(' + over.className + ')');
    var badge = over.querySelector('.atex-pp-day-over');
    assert(!!badge, '#4531-A: и несёт бейдж перебора');
    assert(!!badge && /\+15 мин/.test(badge.textContent) && /смен/.test(badge.textContent),
        '#4531-A: бейдж называет перебор словами', '(' + (badge && badge.textContent) + ')');

    var tip = (badge && badge.attributes && badge.attributes.title) || '';
    assert(/16:30/.test(tip) && /16:15/.test(tip),
        '#4531-B: в подсказке мерка — до какого часа идёт работа и каков потолок', '(' + tip + ')');
    assert(/№ 2/.test(tip) && /MR194/.test(tip),
        '#4531-B: и виновник — номер задания в дне и его сырьё', '(' + tip + ')');

    assert(!ok.classList.contains('is-over') && !ok.querySelector('.atex-pp-day-over'),
        '#4531-C: день в пределах смены не помечен', '(' + ok.className + ')');
})();

// ── C2: все дни в пределах смены → в очереди ни одной пометки ────────────────────────────────
(function () {
    var c = makeController([cutOf('a', 30, 8, 0, 300), cutOf('b', 31, 8, 0, 300)]);
    c.renderQueue();
    assert(c.queueEl.querySelectorAll('.atex-pp-day-over').length === 0,
        '#4531-C2: ни одного бейджа перебора, когда переполнения нет');
})();

// ── D: мерка ОДНА — чистая функция над набором заданий ───────────────────────────────────────
(function () {
    var cuts = twoDays();
    var days = planning.overfilledDaysFromCuts(cuts, {
        baseMidnightMs: new Date(2026, 6, 30, 0, 0, 0, 0).getTime(),
        cutEndMin: 16 * 60 + 15,
        maxOverworkCutsMin: 0
    });
    assert(days.length === 1, '#4531-D: переполнен ровно один день', '(' + days.length + ')');
    var d = days[0] || {};
    assert(d.dayOffset === 1 && Math.round(d.overMin) === 15 && Math.round(d.endMin) === 16 * 60 + 30,
        '#4531-D: это день 31.07, работа до 16:30, перебор +15 мин',
        '(день ' + d.dayOffset + ', до ' + d.endMin + ', +' + d.overMin + ')');
    assert(String(d.cutId) === 'tail' && d.seq === 2,
        '#4531-D: виновник — второе задание дня', '(' + d.cutId + ', № ' + d.seq + ')');

    // Та же функция стои́т за предупреждением (#4408/#4497) — арифметика не раздваивается.
    var c = makeController(cuts);
    var viaController = c.overfilledDaysOf('101');
    assert(viaController.length === 1 && String(viaController[0].cutId) === 'tail'
        && Math.round(viaController[0].overMin) === 15,
        '#4531-D: overfilledDaysOf отдаёт то же самое', '(' + JSON.stringify(viaController.map(function(x) {
            return { d: x.dayOffset, over: Math.round(x.overMin), cut: x.cutId }; })) + ')');
})();

// ── E: пометка без вида — невидимая пометка (грабли #4409): у классов есть правила в CSS ──────
(function () {
    var fs = require('fs'), path = require('path');
    var css = fs.readFileSync(path.join(__dirname, '..', 'download', 'atex', 'css', 'production-planning.css'), 'utf8');
    assert(/\.atex-pp-day-over\s*\{/.test(css),
        '#4531-E: у бейджа перебора есть правило в production-planning.css');
    assert(/\.atex-pp-day-date\.is-over/.test(css),
        '#4531-E: и у пометки шапки дня — тоже (иначе пометка невидима, #4409)');
    // Выходной день (#3788) уже залит красным: правило .is-over идёт в файле ПОЗЖЕ и при равной
    // специфичности красит минуты красным ПО КРАСНОМУ — их не видно. Нужен явный разбор случая.
    assert(/\.atex-pp-day-date\.is-dayoff\.is-over\s+\.atex-pp-day-mins/.test(css),
        '#4531-E: на выходном дне минуты переполненного дня не красное-по-красному');
})();

console.log('\n' + passed + '/' + total + ' проверок пройдено');
if (passed !== total) process.exitCode = 1;
