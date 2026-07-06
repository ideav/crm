// Unit + UI tests for ideav/crm#4035 — «обед не везде отрисован» на Ганте.
//
// Обед раньше находился ТОЛЬКО зазор-детектором: маркер появлялся там, где генерация оставила
// «дыру» ≈ LUNCH_DURATION между двумя резками дня. На днях БЕЗ такой дыры (переходящие/непрерывные
// дни, одна длинная резка через полдень) строка «🍽 Обед» пропадала. #4035 добавляет carrier-фолбэк:
// если у дня зазор-обеда нет, но окно резки накрывает LUNCH_START — обед рисуется ВНУТРИ этой
// «несущей» резки отдельной строкой (как перерыв, #4007), без сдвига/растяжки баров (дыры нет).
//
// Проверяем чистый ganttLunchMarkers (фолбэк vs зазор-обед) и рендер _buildBody (строка .atex-cg-lunch-row
// появляется на непрерывном дне).
//
// Run with: node experiments/atex-cut-gantt-4035.test.js

process.env.TZ = 'Europe/Moscow';
var api = require('../download/atex/js/cut-gantt.js');
var g = api.gantt;
var Controller = api.Controller;

var passed = 0, total = 0;
function assertEqual(actual, expected, name) {
    total++;
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; }
    else { console.log('  expected:', JSON.stringify(expected)); console.log('  actual:  ', JSON.stringify(actual)); process.exitCode = 1; }
}
function assert(cond, name) { assertEqual(!!cond, true, name); }

var PPM = 2;   // px на минуту
var LUNCH_START = 12 * 60 + 20;   // 12:20 = 740 мин
var ms = function(iso) { return g.parseDateTimeMs(iso); };
function cut(id, planIso, knife, material, cutTime) {
    return { id: id, planDate: planIso, setupKnifeMin: knife, setupMaterialMin: material, cutTimeMin: cutTime };
}
function scaleFor(cuts) {
    return g.ganttScale(g.workingSegments(cuts, g.ganttRange('2026-06-29', 'day'), {}), PPM);
}

// ── Фолбэк: одна длинная резка через полдень, зазора нет → обед-бэнд ВНУТРИ неё ──
var single = [cut('L', '2026-06-29 11:00', 0, 0, 300)];   // 11:00–16:00 накрывает 12:20
var m1 = g.ganttLunchMarkers(single, scaleFor(single), 40, LUNCH_START);
assertEqual(m1.length, 1, '#4035: длинная резка через полдень без зазора → один обед-бэнд');
assertEqual(m1[0].fallback, true, '#4035: это carrier-фолбэк (fallback=true)');
assertEqual(m1[0].carrierIndex, 0, '#4035: несущая обеда — резка index 0');
assertEqual(m1[0].beforeIndex, null, '#4035: у фолбэка нет послеобеденной резки (beforeIndex null)');
assertEqual(m1[0].postStartMs, null, '#4035: фолбэк не растягивает несущую (postStartMs null)');
assertEqual([m1[0].startMs, m1[0].endMs], [ms('2026-06-29 12:20'), ms('2026-06-29 13:00')],
    '#4035: окно обеда = [12:20; 13:00] (40 мин)');
assertEqual(m1[0].widthPx, 40 * PPM, '#4035: ширина обед-бэнда = 40 × px/мин');

// ── Фолбэк: две резки ВСТЫК через полдень (переходящий день, как на скрине #4035) ──
var chain = [cut('H', '2026-06-29 08:00', 0, 0, 228),    // 08:00–11:48
             cut('T', '2026-06-29 11:48', 0, 0, 192)];   // 11:48–15:00 накрывает 12:20, зазор 0
var m2 = g.ganttLunchMarkers(chain, scaleFor(chain), 40, LUNCH_START);
assertEqual(m2.length, 1, '#4035: непрерывные резки через полдень → один обед-бэнд');
assertEqual(m2[0].fallback, true, '#4035: непрерывный день — тоже фолбэк');
assertEqual(m2[0].carrierIndex, 1, '#4035: несущая обеда — резка, чьё окно накрывает 12:20 (index 1)');

// ── Зазор-обед приоритетнее: день с реальной дырой ≈ обеда → обычный маркер, фолбэка НЕТ ──
var gapDay = [cut('A', '2026-06-29 11:00', 0, 0, 86),    // 11:00–12:26
              cut('B', '2026-06-29 13:06', 0, 0, 30)];   // дыра 12:26–13:06 = 40
var m3 = g.ganttLunchMarkers(gapDay, scaleFor(gapDay), 40, LUNCH_START);
assertEqual(m3.length, 1, '#4035: день с зазор-обедом — ровно один маркер (без дубля фолбэка)');
assertEqual([!!m3[0].fallback, m3[0].beforeIndex], [false, 1],
    '#4035: это зазор-обед (не фолбэк), строкой перед послеобеденной резкой B');

// ── Станок заканчивает до обеда → обеда нет (ни зазор, ни фолбэк) ──
var early = [cut('E', '2026-06-29 08:00', 0, 0, 120)];   // 08:00–10:00, полдень не накрыт
assertEqual(g.ganttLunchMarkers(early, scaleFor(early), 40, LUNCH_START), [],
    '#4035: работа кончилась до 12:20 → обеда нет');

// ── Без LUNCH_START фолбэк не строим (нет времени привязки) — прежнее поведение ──
assertEqual(g.ganttLunchMarkers(single, scaleFor(single), 40), [],
    '#4035: одна резка, LUNCH_START неизвестен → фолбэка нет (деградация без поломки)');

// ── Обед выключен (durationMin 0) → [] ──
assertEqual(g.ganttLunchMarkers(single, scaleFor(single), 0, LUNCH_START), [],
    '#4035: LUNCH_DURATION 0 → обеда нет');

// ── UI-смоук: на непрерывном дне рендерится строка обеда ──────────────────────────────────────
// Минимальный DOM-стаб (копия из atex-cut-gantt-4007-ui.test.js).
function StubNode(tag) {
    this.tagName = String(tag || '').toUpperCase();
    this.childNodes = []; this.attributes = {}; this.dataset = {}; this.style = {};
    this._className = ''; this._text = '';
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
StubNode.prototype.appendChild = function(n) { this.childNodes.push(n); n.parentNode = this; return n; };
StubNode.prototype.setAttribute = function(k, v) { this.attributes[k] = String(v); };
StubNode.prototype.getAttribute = function(k) { return this.attributes[k] == null ? null : this.attributes[k]; };
StubNode.prototype._all = function(acc) { this.childNodes.forEach(function(c) { if (c instanceof StubNode) { acc.push(c); c._all(acc); } }); return acc; };
StubNode.prototype.querySelectorAll = function(sel) { var cls = sel.replace(/^\./, ''); return this._all([]).filter(function(n) { return n.classList.contains(cls); }); };
StubNode.prototype.querySelector = function(sel) { return this.querySelectorAll(sel)[0] || null; };
global.document = { createElement: function(tag) { return new StubNode(tag); } };

function buildBody(cuts) {
    var inst = Object.create(Controller.prototype);
    inst.root = new StubNode('div');
    inst.cuts = cuts;
    inst.state = { mode: 'day', anchor: '2026-06-29', slitter: '', status: '', zoom: 1, fromIso: '2026-06-29', toIso: '2026-06-29' };
    inst.lunchDurationMin = 40;
    inst.lunchStartMin = LUNCH_START;
    inst.breaks = [];
    inst.calendarByDay = {};
    inst.calendarEnabled = false;
    inst._fitTrackPx = function() { return 0; };
    var range = g.ganttRangeFromTo('2026-06-29', '2026-06-29');
    return inst._buildBody(range, g.parseDateTimeMs('2026-06-29 12:00'));
}
function uiCut(id, planIso, cutTime) {
    return { id: id, planDate: planIso, cutTimeMin: cutTime, slitter: { id: '10', label: 'SL-01' } };
}

// Непрерывный день (как на скрине): 08:00–11:48 + 11:48–15:00, зазора у полудня нет.
var uiChain = buildBody([uiCut('H', '2026-06-29 08:00', 228), uiCut('T', '2026-06-29 11:48', 192)]);
var lunchRows = uiChain.querySelectorAll('.atex-cg-lunch-row');
assert(lunchRows.length === 1, '#4035 UI: непрерывный день через полдень → одна строка обеда (.atex-cg-lunch-row)');
var lunchBar = uiChain.querySelector('.atex-cg-lunch');
assert(lunchBar && /🍽 Обед · 40 мин/.test(lunchBar.textContent), '#4035 UI: подпись «🍽 Обед · 40 мин»');

// Контроль: станок кончает до обеда → строки обеда нет.
var uiEarly = buildBody([uiCut('E', '2026-06-29 08:00', 120)]);
assert(uiEarly.querySelectorAll('.atex-cg-lunch-row').length === 0, '#4035 UI: работа до 12:20 → строки обеда нет');

console.log('\n' + passed + '/' + total + ' проверок прошло.');
if (!process.exitCode) console.log('Все проверки #4035 зелёные.');
