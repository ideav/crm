// Тесты: ideav/crm#4780 — «Это не ошибка, это норма — почему подсвечено как ошибка?»
//
// СИМПТОМ (боевая ateh, Станок 1, 18.08.2026, скрин из тикета). Шапка дня:
// «Вт, 18.08.2026 (453 мин)» и рядом КРАСНОЕ «+3 мин сверх смены». День состоит из четырёх резок
// (222 + 106 + 53 + 42) и хвоста-наладки на 30 мин («Настройка ножей и сырья · 16:03–16:33 ·
// проходов 0 из 44»). По правилу #4759 такой день судится потолком НАСТРОЙКИ — 16:20 (450+10),
// работы в нём 453 при ёмкости 460: план законный, метка врёт.
//
// ПРИЧИНА — ПОЛЕ ОКНА, КОТОРОЕ НЕ ДОЕХАЛО ДО МЕРКИ. #4759 научил `overfilledDaysFromCuts` читать
// `maxOverworkTuneMin`, но ни один из трёх её зовущих этого поля не передавал: каждый перекладывал
// окно дня в опции вручную. Нахлёст настройки приходил нулём, и потолок дня с наладкой на конце
// падал с 460 до 450 — ровно те «+3». Упаковщик при этом всегда пакует хвост настройки до
// `availFor(day,'tune')`, то есть до 460: половина системы кладёт работу, вторая объявляет её
// нарушением (тот же класс расхождения, что #4559/#4561/#4563).
//
// ЧТО ПРОВЕРЯЕМ:
//   A — РЕПРО ЭКРАНА: очередь на боевых настройках ateh с днём из тикета — шапка не помечена и
//       бейджа «+N мин сверх смены» нет (до правки — «+3 мин»);
//   B — все три потребителя мерки молчат об этом дне (шапка очереди, `overfilledDaysOf` → тост и
//       выравнивание, счётчик `capacityBreaksStored`);
//   C — РЕГРЕСС: настоящий перебор виден, и потолок в подсказке — ПО ХВОСТУ дня (наладка 16:20,
//       резка 16:15), а не один на всех;
//   D — СТОРОЖ ИСХОДНИКОВ: опции мерки нигде не собираются на месте — только `overfillMeasureOpts`;
//   E — перекладка не теряет полей: всё, что мерка читает, доехало из `resolveWorkingWindow`.
//
// Run with: node experiments/atex-pp-4780-over-badge-tune-tail.test.js

process.env.TZ = 'UTC';

// ── Минимальный DOM-стаб (как в atex-pp-4531-day-over-badge.test.js) ──
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
global.window = { db: 'ateh1' };

var fs = require('fs');
var path = require('path');
var api = require('../download/atex/js/production-planning.js');
var Controller = api.Controller;
var P = api.planning;

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

// Боевая «Настройка» ateh (269): смена 08:00–16:30, буфер уборки 20 → окно резки до 16:10,
// обед 12:20×40, нахлёст резки 5 (потолок 16:15, ёмкость 455), настройки 10 (16:20, ёмкость 460).
var DAY_SETTINGS = { DAY_START_HOUR: '8:00', DAY_END_HOUR: '16:30', TOTAL_INTERVALS: '20',
    LUNCH_START: '12:20', LUNCH_DURATION: '40',
    MAX_OVERWORK_CUTS_MN: '5', MAX_OVERWORK_TUNE_MN: '10' };
var SID = '1277';
var DAY = [2026, 8, 18];   // 18.08.2026 — день из тикета

function tsAt(hh, mm) { return Math.floor(new Date(DAY[0], DAY[1] - 1, DAY[2], hh, mm, 0, 0).getTime() / 1000); }
// Задание очереди: старт окна + ХРАНИМЫЕ колонки занятости (то же, что складывает бейдж «(N мин)»).
function cutOf(id, hh, mm, knife, material, cutMin, runs) {
    var ts = String(tsAt(hh, mm));
    return { id: id, number: ts, planDate: ts,
        slitter: { id: SID, label: 'Станок 1' },
        materialId: '500', materialName: 'MW308', winding: 'OUT', status: '',
        knifeWidths: [110, 110], knifeCount: 2, plannedRuns: runs, length: 450,
        storedKnifeSetupMin: String(knife), storedMaterialWindingMin: String(material),
        storedCutAndLeaderMin: String(cutMin), leaders: [], sleeves: [] };
}

// День из тикета: 222 + 106 + 53 + 42 = 423 мин резки и хвост-наладка 30 мин (0 проходов) = 453.
function ticketDay() {
    return [cutOf('c1', 8, 0, 0, 0, 222, 11),
            cutOf('c2', 11, 52, 0, 0, 106, 10),
            cutOf('c3', 14, 18, 0, 0, 53, 8),
            cutOf('c4', 15, 21, 0, 0, 42, 35),
            cutOf('tail', 16, 3, 30, 0, 0, 0)];   // «Настройка ножей и сырья», проходов 0 из 44
}

function makeController(cuts) {
    var root = new StubNode('div'); root.attributes['data-db'] = 'ateh1';
    var c = new Controller(root);
    c.queueEl = new StubNode('div'); c.linkEl = new StubNode('div'); c.formEl = new StubNode('div');
    c.filter = { slitter: '', status: '', date: '2026-08-18', dateTo: '2026-08-18', query: '' };
    c.slitters = [{ id: SID, label: 'Станок 1' }];
    c.activeSlitter = SID;
    c.cuts = cuts;
    c.positions = []; c.genPositions = []; c.supplies = []; c.genBatches = [];
    c.opTimes = {}; c.changeTimes = {}; c.footageBySupply = {}; c.consumptionByCut = {};
    c.jumboWidthByMaterial = {}; c.nominalWidthByMaterial = {}; c.actualWidthIndex = null;
    c.daySettings = DAY_SETTINGS; c.prevSetupBySlitter = {}; c.downtimesBySlitter = {}; c.calendarByDay = {};
    c.renderLink = function() {}; c.notify = function() {};
    return c;
}

// ── A: РЕПРО ЭКРАНА — шапка дня из тикета чиста ──────────────────────────────────────────────
(function () {
    var c = makeController(ticketDay());
    c.renderQueue();
    var heads = c.queueEl.querySelectorAll('.atex-pp-day-date');
    assert(heads.length === 1, '#4780-A: в очереди одна шапка дня', '(' + heads.length + ')');
    var head = heads[0] || new StubNode('div');
    assert(/453 мин/.test(head.textContent),
        '#4780-A: сумма минут дня — та же, что на скрине', '(' + head.textContent + ')');
    var badge = head.querySelector('.atex-pp-day-over');
    assert(!badge,
        '#4780-A: день кончается наладкой (потолок 16:20, ёмкость 460) — бейджа «сверх смены» нет',
        badge ? '(бейдж: ' + badge.textContent + ')' : '');
    assert(!head.classList.contains('is-over'),
        '#4780-A: и сама шапка не помечена как переполненная', '(' + head.className + ')');
})();

// ── B: все три потребителя мерки молчат ──────────────────────────────────────────────────────
(function () {
    var c = makeController(ticketDay());
    var days = c.overfilledDaysOf(SID) || [];
    assert(days.length === 0,
        '#4780-B: `overfilledDaysOf` (тост #4497 и вход в выравнивание) переполнения не видит',
        '(' + JSON.stringify(days.map(function (d) { return '+' + Math.round(d.overMin); })) + ')');
    assert(c.capacityBreaksStored() === 0,
        '#4780-B: и счётчик переполненных станко-дней тоже', '(' + c.capacityBreaksStored() + ')');
})();

// ── C: РЕГРЕСС — настоящий перебор виден, потолок берётся ПО ХВОСТУ дня ──────────────────────
(function () {
    // (а) день кончается НАЛАДКОЙ и стои́т 465 мин при ёмкости 460 → +5, потолок 16:20.
    var tuneOver = ticketDay();
    tuneOver[0] = cutOf('c1', 8, 0, 0, 0, 234, 11);          // 222 → 234, день 465
    var c1 = makeController(tuneOver);
    c1.renderQueue();
    var b1 = c1.queueEl.querySelector('.atex-pp-day-over');
    assert(!!b1 && /\+5 мин/.test(b1.textContent),
        '#4780-C: 465 мин с наладкой на конце — перебор +5 показан',
        '(' + (b1 && b1.textContent) + ')');
    assert(!!b1 && /16:20/.test(b1.attributes.title || ''),
        '#4780-C: и потолок в подсказке — потолок НАСТРОЙКИ (16:20)',
        '(' + (b1 && b1.attributes.title) + ')');

    // (б) тот же день, но кончается РЕЗКОЙ: ёмкость 455, 465 мин → +10, потолок 16:15.
    var cutsOver = ticketDay();
    cutsOver[0] = cutOf('c1', 8, 0, 0, 0, 234, 11);
    cutsOver[4] = cutOf('tail', 16, 3, 0, 0, 30, 4);          // хвост несёт минуты резки
    var c2 = makeController(cutsOver);
    c2.renderQueue();
    var b2 = c2.queueEl.querySelector('.atex-pp-day-over');
    assert(!!b2 && /\+10 мин/.test(b2.textContent),
        '#4780-C: тот же день с резкой на конце судится потолком РЕЗКИ — +10',
        '(' + (b2 && b2.textContent) + ')');
    assert(!!b2 && /16:15/.test(b2.attributes.title || ''),
        '#4780-C: и потолок в подсказке — 16:15', '(' + (b2 && b2.attributes.title) + ')');
})();

// ── D: СТОРОЖ ИСХОДНИКОВ — опции мерки собираются только в одном месте ───────────────────────
// Зелёный гейт ничего не значит, если завтра четвёртый зовущий снова перечислит поля окна руками:
// разойдётся молча и вернётся тикетом через недели — ровно так и пришёл #4780.
(function () {
    var dir = path.join(__dirname, '..', 'download', 'atex', 'js', 'production-planning');
    var bad = [];
    fs.readdirSync(dir).filter(function (f) { return /\.js$/.test(f); }).forEach(function (f) {
        var lines = fs.readFileSync(path.join(dir, f), 'utf8').split('\n');
        lines.forEach(function (line, i) {
            var code = line.replace(/\/\/.*$/, '');
            if (code.indexOf('overfilledDaysFromCuts(') === -1) return;
            if (/function\s+overfilledDaysFromCuts\s*\(/.test(code)) return;      // само определение
            if (/overfilledDaysFromCuts:\s*overfilledDaysFromCuts/.test(code)) return;   // экспорт
            // Опции зовущего — из общей перекладки: она либо на этой строке, либо на следующей.
            var near = code + '\n' + (lines[i + 1] || '');
            if (near.indexOf('overfillMeasureOpts(') === -1) bad.push(f + ':' + (i + 1) + '  ' + line.trim().slice(0, 100));
        });
    });
    assert(bad.length === 0,
        '#4780-D: каждый зовущий мерку берёт опции из `overfillMeasureOpts` — руками поля окна не перечисляет',
        bad.length ? ('\n      ' + bad.join('\n      ')) : '');
})();

// ── E: перекладка не теряет полей окна ───────────────────────────────────────────────────────
(function () {
    var win = P.resolveWorkingWindow(DAY_SETTINGS, 30);
    var o = P.overfillMeasureOpts(win, 1234567890);
    var pairs = [['dayStartMin', 'startMin'], ['cutEndMin', 'cutEndMin'], ['lunchStartMin', 'lunchStartMin'],
                 ['lunchDurationMin', 'lunchDurationMin'], ['maxOverworkCutsMin', 'maxOverworkCutsMin'],
                 ['maxOverworkTuneMin', 'maxOverworkTuneMin']];
    var lost = pairs.filter(function (p) { return o[p[0]] !== win[p[1]]; }).map(function (p) { return p[0]; });
    assert(lost.length === 0 && o.baseMidnightMs === 1234567890,
        '#4780-E: все поля окна, которые читает мерка, доехали до неё', '(потеряно: ' + lost.join(', ') + ')');
    assert(o.maxOverworkTuneMin === 10,
        '#4780-E: в том числе нахлёст НАСТРОЙКИ — поле, которого не хватало (#4759)',
        '(' + o.maxOverworkTuneMin + ')');
    // И правило потолка при этих опциях даёт ровно те два числа, о которых шёл спор.
    assert(P.dayCapacityMinutes(win, 'tune') === 460 && P.dayCapacityMinutes(win, 'cuts') === 455,
        '#4780-E: ёмкость дня на боевых настройках ateh — 460 (наладка) / 455 (резка)',
        '(' + P.dayCapacityMinutes(win, 'tune') + ' / ' + P.dayCapacityMinutes(win, 'cuts') + ')');
})();

console.log('\n' + passed + '/' + total + ' проверок пройдено');
if (passed !== total) process.exitCode = 1;
