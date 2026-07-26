// Tests for ideav/crm#4428 — «дать возможность наполнять задание корректно».
//
// Задание №5 (MW412, джамбо 891, 450 м, OUT, 3 прохода) — продолжение #4426:
//   1) добавляя позицию заказа, подтягиваем и ОСТАЛЬНЫЕ позиции ЭТОГО ЖЕ заказа (ТЗ: в задание
//      в первую очередь идёт то, что объединено одним заказом) — в том числе НОВОЙ полосой;
//   2) «Проходов» («Кол-во резок план») правится прямо в плашке задания: пересчитываются
//      длительность, «Кол-во план»/спрос «Партий ГП» и рулоны «Обеспечений»;
//   3) «+ позиция» переехала с панели «Связанные позиции» в плашку задания (после «+ полоса»)
//      и умеет резать НОВУЮ полосу в остаток джамбо — для позиции, которую удалили из задания
//      или дозаказали позже.
//
// Run with: node experiments/atex-4428-fill-task.test.js

process.env.TZ = 'Europe/Moscow';

// ── Минимальный DOM-стаб (как в atex-4426-add-position-to-task.test.js) ──
function StubNode(tag) {
    this.tagName = String(tag || '').toUpperCase();
    this.childNodes = []; this.attributes = {}; this.dataset = {}; this.style = {};
    this._className = ''; this._text = ''; this.value = ''; this.disabled = false; this.options = [];
    this.parentNode = null; this.listeners = {};
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
StubNode.prototype.appendChild = function(n) { n.parentNode = this; this.childNodes.push(n); return n; };
StubNode.prototype.removeChild = function(n) { n.parentNode = null; this.childNodes = this.childNodes.filter(function(c) { return c !== n; }); return n; };
StubNode.prototype.setAttribute = function(k, v) { this.attributes[k] = String(v); };
StubNode.prototype.getAttribute = function(k) { return this.attributes[k] == null ? null : this.attributes[k]; };
StubNode.prototype.addEventListener = function(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); };
StubNode.prototype.querySelector = function() { return null; };
StubNode.prototype.querySelectorAll = function() { return []; };
function walk(node, out) {
    out = out || [];
    out.push(node);
    (node.childNodes || []).forEach(function(c) { walk(c, out); });
    return out;
}
function byClass(node, cls) { return walk(node).filter(function(n) { return n.classList && n.classList.contains(cls); }); }
function texts(node, cls) { return byClass(node, cls).map(function(n) { return n.textContent; }); }
function byText(node, text) { return walk(node).filter(function(n) { return n.textContent === text; }); }

global.document = {
    createElement: function(tag) { return new StubNode(tag); },
    createTextNode: function(t) { var n = new StubNode('#text'); n._text = String(t == null ? '' : t); return n; },
    body: new StubNode('body'), readyState: 'loading', getElementById: function() { return null; }, addEventListener: function() {}
};
global.window = { db: 'testdb' };

var mod = require('../download/atex/js/production-planning.js');
var planning = mod.planning;
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
    if (ok) { passed++; } else {
        console.log('  expected:', JSON.stringify(expected));
        console.log('  actual:  ', JSON.stringify(actual));
        process.exitCode = 1;
    }
}

// ── Данные задания №5 из #4426/#4428 ────────────────────────────────────────
// MW412, джамбо 891 мм, 450 м, OUT, 3 прохода. Заказ 4385: 152мм × 100 шт и 110мм × 20 шт.
var JUMBO = 891;
var CUT = { id: '5', number: '1785000000', materialId: 'MW412', materialName: 'MW412',
    winding: 'OUT', length: 450, plannedRuns: 3, knifeCount: 6, slitter: { id: 'sl1', label: 'Слиттер 1' } };
var OP_TIMES = { WIND_450: 19, BETWEEN_CUTS: 2, KNIFE: 30, MATERIAL_WINDING: 15 };
function pos152(over) {
    var p = { id: 'p152', materialId: 'MW412', width: 152, orderWidth: 152, qty: 100, length: 450,
        windDir: 'OUT', windLength: 450, approved: true, orderId: '4385', dueKey: 20260730 };
    for (var k in (over || {})) p[k] = over[k];
    return p;
}
function pos110(over) {
    var p = { id: 'p110', materialId: 'MW412', width: 110, orderWidth: 110, qty: 20, length: 450,
        windDir: 'OUT', windLength: 450, approved: true, orderId: '4385', dueKey: 20260730 };
    for (var k in (over || {})) p[k] = over[k];
    return p;
}

// ── 1) newStripCount: сколько полос режем в остаток джамбо ──────────────────
(function () {
    assertEqual(planning.newStripCount(152, 781, 100, 3), 5,
        '#4428: в остаток 781 мм влезает 5 полос по 152 мм (нужно 34 — берём сколько влезло)');
    assertEqual(planning.newStripCount(152, 891, 6, 3), 2,
        'позиции хватит 2 полос (6 рул. / 3 прохода) — лишнего в запас не режем');
    assertEqual(planning.newStripCount(110, 131, 20, 3), 1, 'влезает ровно одна полоса');
    assertEqual(planning.newStripCount(152, 21, 100, 3), 0, 'в остаток 21 мм полоса 152 мм не влезает');
    assertEqual(planning.newStripCount(152, 152, 100, 3), 1, 'ширина ровно в остаток — одна полоса (без дребезга округления)');
})();

// ── 2) cutPositionFit: новая полоса в остаток джамбо ────────────────────────
(function () {
    // Свободной полосы 152 мм в задании НЕТ (её удалили) — режем новую в остаток 781 мм.
    var fit = planning.cutPositionFit(pos152(), CUT, [], 100, { jumboFreeMm: 781, passes: 3 });
    assertEqual([fit.ok, fit.mode, fit.stripCount, fit.width, fit.rolls], [true, 'new', 5, 152, 15],
        '#4428: нет свободной полосы — позиция ложится НОВОЙ полосой 152 мм × 5 (15 рул. за 3 прохода)');

    // Свободная полоса той же ширины есть — она в приоритете: геометрия задания не меняется.
    var onStrip = planning.cutPositionFit(pos152(), CUT, [{ id: 'b152', width: 152, rolls: 15 }], 100,
        { jumboFreeMm: 781, passes: 3 });
    assertEqual([onStrip.ok, onStrip.mode, onStrip.strip.id], [true, 'strip', 'b152'],
        'готовая свободная полоса важнее новой — раскрой не трогаем');

    // Остатка джамбо не хватает — причина называет и остаток (диспетчер видит, чего не хватило).
    var tight = planning.cutPositionFit(pos152(), CUT, [], 100, { jumboFreeMm: 21, passes: 3 });
    assertEqual([tight.ok, tight.reason], [false, 'нет свободной полосы 152 мм, в остаток джамбо (21 мм) новая не влезает'],
        'не влезает в остаток джамбо — так и говорим, с числом');

    // Без opts (старые вызовы, #4426) поведение прежнее: новая полоса не предлагается.
    assertEqual(planning.cutPositionFit(pos152(), CUT, [], 100).reason, 'нет свободной полосы 152 мм',
        'без остатка джамбо новых полос не режем — прежнее поведение #4426');

    // Ширина джамбо не задана (нет вида сырья) → opts с нулём = резать вслепую нельзя.
    assertEqual(planning.cutPositionFit(pos152(), CUT, [], 100, { jumboFreeMm: 0, passes: 3 }).ok, false,
        'ширина джамбо неизвестна — новую полосу не предлагаем');
})();

// ── 3) planCutPositionFill: вторая позиция ТОГО ЖЕ заказа подтягивается ──────
(function () {
    var cand110 = { id: 'p110', position: pos110(), remaining: 20, label: '4385 · 110мм * 450м' };
    var cand152 = { id: 'p152', position: pos152(), remaining: 100, label: '4385 · 152мм * 450м' };
    var alien = { id: 'pAlien', position: pos110({ id: 'pAlien', orderId: '4277' }), remaining: 20,
        label: '4277 · 110мм * 450м' };

    // Взяли 152 мм пятью новыми полосами (760 мм) — в оставшийся 131 мм лезет 110 мм своего заказа.
    var fill = planning.planCutPositionFill(CUT, [], [cand110], { '4385': true },
        { jumboFreeMm: 131, passes: 3 });
    assertEqual(fill, [{ positionId: 'p110', stripId: null, mode: 'new', width: 110, stripCount: 1,
        rolls: 3, sameOrder: true }],
        '#4428 п.1: вторая позиция ЗАКАЗА подтягивается новой полосой — «добавил одну, подтянулась другая»');

    // Чужой заказ геометрию задания не меняет: ему — только готовые свободные полосы.
    assertEqual(planning.planCutPositionFill(CUT, [], [alien], { '4385': true }, { jumboFreeMm: 400, passes: 3 }),
        [], 'чужому заказу новых полос не режем — остаток джамбо не его');
    var onFree = planning.planCutPositionFill(CUT, [{ id: 'b110', width: 110, rolls: 3 }], [alien],
        { '4385': true }, { jumboFreeMm: 400, passes: 3 });
    assertEqual([onFree.length, onFree[0].stripId, onFree[0].sameOrder], [1, 'b110', false],
        'на СВОБОДНУЮ полосу чужой заказ по-прежнему предлагается (со снятой галкой в UI)');

    // Своя позиция на свободной полосе — приоритет перед новой резкой (сперва разбираем готовое).
    var mixed = planning.planCutPositionFill(CUT, [{ id: 'b152', width: 152, rolls: 15 }], [cand152, cand110],
        { '4385': true }, { jumboFreeMm: 131, passes: 3 });
    assertEqual(mixed.map(function (f) { return [f.positionId, f.mode, f.stripId]; }),
        [['p152', 'strip', 'b152'], ['p110', 'new', null]],
        'сначала свободные полосы, потом остаток джамбо');

    // Остатка не хватает — молча ничего не режем (в UI видно, что предложений нет).
    assertEqual(planning.planCutPositionFill(CUT, [], [cand110], { '4385': true }, { jumboFreeMm: 21, passes: 3 }),
        [], 'в 21 мм ничего не влезает — предложений нет');
    // Без opts — прежнее поведение #4426 (только свободные полосы).
    assertEqual(planning.planCutPositionFill(CUT, [], [cand110], { '4385': true }), [],
        'без остатка джамбо (старый вызов) новых полос не появляется');
})();

// ── 4) planPassesUpdates: пересчёт под новые проходы ─────────────────────────
var BATCHES = [
    { id: 'b152', width: 152, strips: 5, rolls: 15, planned: 15 },
    { id: 'b110', width: 110, strips: 1, rolls: 3, planned: 3 }
];
var SUPPLIES = [
    { id: 's152', cutId: '5', finishedBatchId: 'b152', positionId: 'p152', rolls: 15 },
    { id: 's110', cutId: '5', finishedBatchId: 'b110', positionId: 'p110', rolls: 3 }
];
(function () {
    var upd = planning.planPassesUpdates('5', BATCHES, SUPPLIES, { p152: 100, p110: 20 }, 20);
    assertEqual(upd.batches, [
        { id: 'b152', width: 152, planned: 100, wasPlanned: 15, rolls: 100, wasRolls: 15 },
        { id: 'b110', width: 110, planned: 20, wasPlanned: 3, rolls: 20, wasRolls: 3 }
    ], '#4428 п.2: 20 проходов → «Кол-во план» = полосы × проходов, спрос = сумма обеспечений');
    assertEqual(upd.supplies, [
        { id: 's152', positionId: 'p152', rolls: 100, was: 15 },
        { id: 's110', positionId: 'p110', rolls: 20, was: 3 }
    ], 'обеспечения растут вместе с проходами — иначе добавленные рулоны ушли бы на склад');

    // Больше, чем нужно позиции, не обеспечиваем (правило 110% остатка, #3320).
    var over = planning.planPassesUpdates('5', BATCHES, SUPPLIES, { p152: 100, p110: 20 }, 60);
    assertEqual(over.supplies.map(function (s) { return [s.id, s.rolls]; }), [['s152', 110], ['s110', 22]],
        'потолок обеспечения — 110% остатка позиции, излишек остаётся складским');

    // Уменьшение проходов честно ужимает обеспечение до того, что задание реально произведёт.
    var down = planning.planPassesUpdates('5', BATCHES, SUPPLIES, { p152: 100, p110: 20 }, 1);
    assertEqual(down.supplies.map(function (s) { return [s.id, s.rolls]; }), [['s152', 5], ['s110', 1]],
        'проходов стало меньше — обеспечение ужимается, а не остаётся завышенным');

    // Позиции уже обеспечены другим заданием — связь не трогаем и не обнуляем.
    var covered = planning.planPassesUpdates('5', BATCHES,
        SUPPLIES.concat([{ id: 'sOther', cutId: '9', finishedBatchId: 'bx', positionId: 'p152', rolls: 100 }]),
        { p152: 100, p110: 20 }, 20);
    assertEqual([covered.keptSupplyIds, covered.supplies.map(function (s) { return s.id; })],
        [['s152'], ['s110']], 'остаток позиции покрыт другим заданием — живую связь не обнуляем');

    // Позиции нет в планировании (заказ закрыт) — потребность неизвестна, обеспечение как есть.
    var unknown = planning.planPassesUpdates('5', BATCHES, SUPPLIES, { p110: 20 }, 20);
    assertEqual([unknown.keptSupplyIds, unknown.batches[0].rolls], [['s152'], 15],
        'позиции нет в плане — её обеспечение не трогаем, спрос партии остаётся прежним');

    // Старая «Партия ГП» без «Кол-во полос» (#3431) — план считать нечем, не трогаем.
    var legacy = planning.planPassesUpdates('5',
        [{ id: 'bOld', width: 152, strips: 0, rolls: 5, planned: 0 }],
        [{ id: 'sOld', cutId: '5', finishedBatchId: 'bOld', positionId: 'p152', rolls: 5 }],
        { p152: 100 }, 20);
    assertEqual([legacy.legacyBatchIds, legacy.batches, legacy.supplies, legacy.keptSupplyIds],
        [['bOld'], [], [], ['sOld']], 'старая партия (полосы лежат в «Кол-во рулонов») из пересчёта исключена');

    assertEqual(planning.planPassesUpdates('5', BATCHES, SUPPLIES, { p152: 100 }, 0).batches, [],
        'ноль проходов — пересчитывать нечего');
})();

// ── Стенд контроллера ───────────────────────────────────────────────────────
var FB_TABLE = '1081', SUP_TABLE = '1075', CUT_TABLE = '1078';
var REQ = { fbWidth: 'w', fbStrips: 's', fbRolls: 'r', fbPlanned: 'p', fbOrder: 'o',
    supBatch: 'sb', supRolls: 'sr', supFootage: 'sf', supActive: 'sa', supStatus: 'ss',
    cutRuns: 'cr', cutDur: 'cd', cutTim: 'ct' };
function makeController(batches, supplies, positions) {
    var c = Object.create(Controller.prototype);
    c.cuts = [CUT];
    c.supplies = supplies || [];
    c.genPositions = positions || [];
    c.positions = (positions || []).map(function (p) {
        return { id: p.id, label: p.orderId + ' · ' + p.width + 'мм * ' + p.length + 'м', width: p.width, length: p.length, qty: p.qty };
    });
    c.positionLengthById = {}; (positions || []).forEach(function (p) { c.positionLengthById[p.id] = p.length; });
    c.footageBySupply = {};
    c.opTimes = OP_TIMES;
    c.jumboWidthByMaterial = { MW412: JUMBO };
    c.maxStockIndex = {}; c.stockBalanceIndex = {}; c.preferredByMaterial = {};
    c.meta = {
        cut: { id: CUT_TABLE, reqs: [
            { id: REQ.cutRuns, val: 'Кол-во резок план' }, { id: REQ.cutDur, val: 'Длительность, минут' },
            { id: REQ.cutTim, val: 'Тайминг' }
        ] },
        finishedBatch: { id: FB_TABLE, reqs: [
            { id: REQ.fbWidth, val: 'Ширина, мм' }, { id: REQ.fbStrips, val: 'Кол-во полос' },
            { id: REQ.fbRolls, val: 'Кол-во рулонов' }, { id: REQ.fbPlanned, val: 'Кол-во план' },
            { id: REQ.fbOrder, val: 'ID заказа' }
        ] },
        supply: { id: SUP_TABLE, reqs: [
            { id: REQ.supBatch, val: 'Партия ГП' }, { id: REQ.supRolls, val: 'Кол-во рулонов' },
            { id: REQ.supFootage, val: 'Метраж, м' }, { id: REQ.supActive, val: 'В работе' },
            { id: REQ.supStatus, val: 'Статус' }
        ] }
    };
    c.root = new StubNode('div');
    c.linkEl = new StubNode('div');
    c.selectedCutId = '5';
    c.busy = false;
    c.notes = []; c.notify = function (m, k) { c.notes.push({ msg: m, kind: k }); };
    c.setBusy = function (on) { c.busy = !!on; };
    c.render = function () {}; c.reopenStripsIfOpen = function () {};
    c.resolveToleranceMm = function () { return 21; };
    c.loadPlanning = function () { c.loaded = (c.loaded || 0) + 1; return Promise.resolve(); };
    c.reload = function () { c.reloaded = (c.reloaded || 0) + 1; return Promise.resolve(); };
    c.persistCutSetupColumns = function (ids) { c.setupCols = (c.setupCols || []).concat(ids); return Promise.resolve(); };
    c.warnOverfilledDays = function (sid) { c.warned = sid; return []; };
    c.posts = [];
    c.newIdSeq = 0;
    c.post = function (path, fields) {
        c.posts.push({ path: path, fields: fields || {} });
        c.newIdSeq += 1;
        return Promise.resolve({ obj: 'new' + c.newIdSeq });
    };
    c.getJson = function (path) {
        var byId = /F_I=([^&]+)/.exec(path);
        var rows = (batches || []).map(function (b) {
            return { i: b.id, r: ['', b.width, b.strips, b.rolls == null ? '' : b.rolls, b.planned == null ? '' : b.planned, b.orderId || ''] };
        });
        if (byId) {
            var id = decodeURIComponent(byId[1]);
            rows = rows.filter(function (r) { return String(r.i) === id; });
        }
        return Promise.resolve(rows);
    };
    return c;
}
function panelFor(c, cut, strips) {
    var panel = new StubNode('div');
    c.renderStripPanel(panel, cut || CUT, strips, strips.map(function (s) { return { id: s.id, width: s.width, qty: s.qty }; }));
    return panel;
}

// ── 5) Плашка задания: «+ позиция» рядом с «+ полоса», «Проходов» правится ──
(function () {
    var c = makeController(BATCHES, SUPPLIES, [pos152(), pos110()]);
    var panel = panelFor(c, CUT, [{ id: 'b152', width: '152', qty: '5' }, { id: 'b110', width: '110', qty: '1' }]);

    var addRow = byClass(panel, 'atex-pp-strip-add-row')[0];
    assert(!!addRow, '#4428 п.3: кнопки добавления — в одной строке плашки задания');
    assertEqual(addRow.childNodes.map(function (n) { return n.textContent; }), ['+ полоса', '+ позиция'],
        '«+ позиция» стоит СРАЗУ ПОСЛЕ «+ полоса»');

    var opened = [];
    c.openCutPositionPicker = function (cut, ctx) { opened.push([cut.id, ctx && ctx.jumbo, ctx && ctx.passes]); };
    byClass(panel, 'atex-pp-strip-add-pos')[0].listeners.click[0]();
    assertEqual(opened, [['5', 891, 3]], 'клик открывает выбор позиции с джамбо и проходами задания');

    var passesInput = byClass(panel, 'atex-pp-strip-passes')[0];
    assert(!!passesInput && passesInput.value === '3', '#4428 п.2: в шапке плашки — поле «Проходов» с текущим значением');
    var asked = [];
    c.changeCutPasses = function (cut, v) { asked.push([cut.id, v]); return Promise.resolve(true); };
    passesInput.value = '20';
    passesInput.listeners.change[0]();
    assertEqual(asked, [['5', '20']], 'правка поля уходит в changeCutPasses');

    // Начатое задание проходов не меняет (#4381).
    var c2 = makeController(BATCHES, SUPPLIES, [pos152()]);
    var started = Object.assign({}, CUT, { startDate: '1785000000' });
    var panel2 = panelFor(c2, started, [{ id: 'b152', width: '152', qty: '5' }]);
    assertEqual(byClass(panel2, 'atex-pp-strip-passes')[0].disabled, true,
        'у начатого задания поле «Проходов» выключено');
})();

// ── 6) Панель «Связанные позиции»: кнопки «+ позиция» больше нет ────────────
(function () {
    var c = makeController(BATCHES, SUPPLIES, [pos152(), pos110()]);
    c.renderLink();
    assertEqual(byClass(c.linkEl, 'atex-pp-linked-add').length, 0,
        '#4428 п.3: «+ позиция» ушла с панели связей (она меняет состав полос — её место в плашке задания)');
    assert(texts(c.linkEl, 'atex-pp-linked-hint').join(' ').indexOf('+ позиция') >= 0,
        'на панели связей осталась подсказка, где теперь добавляют позицию');
})();

// ── 7) Модалка «+ позиция»: новая полоса + добор позиции того же заказа ─────
(function (done) {
    // Полосы задания удалили — джамбо свободен целиком (891 мм), связей нет.
    var c = makeController([], [], [pos152(), pos110()]);
    c.openCutPositionPicker(CUT, { jumbo: JUMBO, passes: 3, strips: [] });
    setTimeout(function () {
        var modal = c.root.childNodes[0];
        var items = byClass(modal, 'atex-pp-supply-item');
        assertEqual(items.length, 2, 'в списке обе позиции заказа: свободных полос нет, но остаток джамбо есть');
        var i152 = items.filter(function (n) { return n.textContent.indexOf('152мм') >= 0; })[0];
        assert(!!i152 && i152.textContent.indexOf('новая полоса 152 мм × 5') >= 0,
            '#4428: позиция без свободной полосы предлагается НОВОЙ полосой (5 × 152 мм в джамбо 891 мм)');

        i152.listeners.click[0]();
        var count = byClass(modal, 'atex-pp-supply-count')[0];
        assertEqual(count && count.value, '5', 'в подтверждении число новых полос правится вручную');
        var fill = byClass(modal, 'atex-pp-supply-fill-row');
        assertEqual(fill.length, 1, 'вторая позиция ТОГО ЖЕ заказа предложена заодно');
        assert(fill[0].textContent.indexOf('новая полоса 110 мм × 1') >= 0,
            'ей тоже режется новая полоса в оставшийся джамбо (891 − 5 × 152 = 131 мм)');
        assert(texts(modal, 'atex-pp-supply-confirm-value').join(' ').indexOf('отложено 110 мм') >= 0,
            'под вторую позицию заказа ширина отложена ЗАРАНЕЕ — жадный добор её не съедает');
        assertEqual(walk(fill[0]).filter(function (n) { return n.tagName === 'INPUT'; })[0].checked, true,
            'позиция своего заказа отмечена заранее (ТЗ: заказ идёт в задание целиком)');

        var written = [];
        c.createStripSupplies = function (items2, opts) { written.push({ items: items2, opts: opts }); return Promise.resolve(); };
        byText(modal, 'Добавить позицию')[0].listeners.click[0]();
        assertEqual(written.length, 1, 'по «Добавить позицию» пишем обе связи одной пачкой');
        assertEqual(written[0].items.map(function (it) { return [it.candidate.id, it.strip.id, it.strip.width, it.strip.qty, it.rolls]; }),
            [['p152', null, 152, 5, 15], ['p110', null, 110, 1, 3]],
            'обе полосы — новые (id ещё нет), рулоны = полосы × проходов в пределах остатка позиции');
        assertEqual(written[0].opts, { cutId: '5', passes: 3 }, 'полосам передаём задание и проходы');
        done();
    }, 0);
})(function () {});

// ── 8) Запись: новая «Партия ГП» → «Обеспечение» → партия перестаёт быть складской ──
(function (done) {
    var c = makeController([{ id: 'new1', width: 152, strips: 5, rolls: 0, planned: 15 }], [], [pos152()]);
    var candidate = { id: 'p152', position: pos152(), label: '4385 · 152мм * 450м' };
    c.createStripSupplies([{ strip: { id: null, width: 152, qty: 5 }, candidate: candidate, rolls: 15 }],
        { cutId: '5', passes: 3 }).then(function () {
        var paths = c.posts.map(function (p) { return p.path; });
        assertEqual(paths.length, 3, 'три записи: партия, обеспечение, пометка партии заказной');
        assert(/^_m_new\/1081\?JSON&up=5$/.test(paths[0]), '#4428: сперва создаётся «Партия ГП» ПОД ЗАДАНИЕМ');
        assertEqual([c.posts[0].fields['t' + REQ.fbWidth], c.posts[0].fields['t' + REQ.fbStrips], c.posts[0].fields['t' + REQ.fbPlanned]],
            [152, 5, 15], 'у новой полосы ширина, «Кол-во полос» и «Кол-во план» = полосы × проходов');
        assert(/^_m_new\/1075\?JSON&up=p152$/.test(paths[1]), 'затем «Обеспечение» под позицией заказа');
        assertEqual(c.posts[1].fields['t' + REQ.supBatch], 'new1', 'обеспечение ссылается на СОЗДАННУЮ партию');
        assert(/^_m_set\/new1\?JSON$/.test(paths[2]), 'и партия помечается заказной (спрос + «ID заказа»)');
        assertEqual([c.posts[2].fields['t' + REQ.fbRolls], c.posts[2].fields['t' + REQ.fbOrder]], ['15', '4385'],
            'спрос = рулоны обеспечения, «ID заказа» = заказ позиции');
        done();
    });
})(function () {});

// ── 9) Смена проходов: подтверждение и запись ───────────────────────────────
(function (done) {
    var c = makeController(BATCHES, SUPPLIES, [pos152(), pos110()]);
    var reverted = 0;
    c.changeCutPasses(CUT, '20', function () { reverted += 1; }).then(function () {
        var modal = c.root.childNodes[0];
        assert(!!modal, '#4428 п.2: смена проходов сперва ПОКАЗЫВАЕТ, что изменится');
        var rows = texts(modal, 'atex-pp-supply-confirm-row').join('\n');
        assert(/Проходов3 → 20/.test(rows.replace(/\s+/g, '')) || /3 → 20/.test(rows), 'видно «было → стало» по проходам');
        assert(/57 → 380/.test(rows), 'длительность пересчитана: 19 мин × 20 проходов = 380');
        assert(/план15→100/.test(rows.replace(/\s+/g, '')), 'план «Партии ГП» 152 мм: 15 → 100 рул.');
        assert(/15 → 100 рул\./.test(rows), 'обеспечение позиции 152 мм: 15 → 100 рул.');

        byText(modal, 'Применить')[0].listeners.click[0]();
        setTimeout(function () {
            assertEqual(reverted, 0, 'по «Применить» поле не откатывается');
            var byPath = {};
            c.posts.forEach(function (p) { byPath[p.path] = p.fields; });
            assertEqual(byPath['_m_set/5?JSON'][
                't' + REQ.cutRuns], '20', 'заданию записаны новые «Кол-во резок план»');
            assertEqual(byPath['_m_set/5?JSON']['t' + REQ.cutDur], '380', 'и новая «Длительность, минут»');
            assert(String(byPath['_m_set/5?JSON']['t' + REQ.cutTim]).indexOf('19') >= 0, 'и пересчитанный «Тайминг»');
            assertEqual([byPath['_m_set/b152?JSON']['t' + REQ.fbPlanned], byPath['_m_set/b152?JSON']['t' + REQ.fbRolls]],
                ['100', '100'], '«Партия ГП» 152 мм: план и спрос под 20 проходов');
            assertEqual(byPath['_m_set/s152?JSON']['t' + REQ.supRolls], '100', 'обеспечение позиции доведено до заказа');
            assertEqual(c.setupCols, ['5'], 'хранимые колонки наладки задания пересчитаны (карточка и Гант не врут)');
            assertEqual(c.warned, 'sl1', 'после записи проверяем, вмещает ли день станка новую длительность');
            done();
        }, 0);
    });
})(function () {});

// ── 10) Смена проходов: отказы ──────────────────────────────────────────────
(function (done) {
    var c = makeController(BATCHES, SUPPLIES, [pos152()]);
    var reverted = 0;
    function rv() { reverted += 1; }
    Promise.resolve()
        .then(function () { return c.changeCutPasses(CUT, '0', rv); })
        .then(function () { return c.changeCutPasses(CUT, '5000', rv); })
        .then(function () { return c.changeCutPasses(Object.assign({}, CUT, { startDate: '1785000000' }), '20', rv); })
        .then(function () { return c.changeCutPasses(Object.assign({}, CUT, { fixed: true }), '20', rv); })
        .then(function () { return c.changeCutPasses(Object.assign({}, CUT, { plannedRuns: 0 }), '20', rv); })
        .then(function () {
            var msgs = c.notes.map(function (n) { return n.msg; }).join('\n');
            assertEqual(reverted, 5, 'на каждый отказ поле возвращается к прежнему значению');
            assert(/больше нуля/.test(msgs), 'ноль проходов — отказ');
            assert(/не больше 999/.test(msgs), 'опечатка «5000» — отказ с потолком');
            assert(/начато/.test(msgs), 'начатое задание не трогаем (#4381)');
            assert(/зафиксировано/.test(msgs), 'зафиксированное задание не трогаем (#3508)');
            assert(/хвост настройки/.test(msgs), 'setup-хвост (0 проходов) проходов не несёт — говорим об этом');
            assertEqual(c.posts.length, 0, 'ни одной записи при отказах');
            done();
        });
})(function () {});

setTimeout(function () {
    console.log('\n' + passed + '/' + total + ' passed');
}, 60);
