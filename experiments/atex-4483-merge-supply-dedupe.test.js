// Tests for ideav/crm#4483 — слияние заданий одного заказа (#4424) НЕ плодит двойную связь
// с позицией.
//
// Что было (боевая ateh, заказ 4443, задание 649598): два задания одного заказа — 8 и 4 прохода —
// слились в одно на 12 проходов, а их «Обеспечения» остались ДВУМЯ записями на ОДНОЙ позиции
// (646600) и ОДНОЙ «Партии ГП» (649651): 400 м/120 рул + 200 м/60 рул. Панель «Связанные позиции»
// показывала одну и ту же позицию дважды, карточка — «связей: 2». Тем же путём разошлись заказы
// 4404, 4405, 4421, 4424 — 11 лишних записей на 7 заданиях.
//
// Правило: у задания на пару (позиция × «Партия ГП») — РОВНО ОДНА запись «Обеспечение».
// Донорское обеспечение позиции, которая уже обеспечена головой из той же партии, не
// перевешивается, а ВЛИВАЕТСЯ: метраж и рулоны складываются в головное, донорское удаляется.
//
// Run with: node experiments/atex-4483-merge-supply-dedupe.test.js

process.env.TZ = 'Europe/Moscow';

// ── Минимальный DOM-стаб (как в atex-4424-merge-order-tasks.test.js) ──
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
StubNode.prototype.appendChild = function(n) { this.childNodes.push(n); return n; };
StubNode.prototype.removeChild = function(n) { this.childNodes = this.childNodes.filter(function(c) { return c !== n; }); return n; };
StubNode.prototype.setAttribute = function(k, v) { this.attributes[k] = String(v); };
StubNode.prototype.getAttribute = function(k) { return this.attributes[k] == null ? null : this.attributes[k]; };
StubNode.prototype.addEventListener = function() {};
global.document = {
    createElement: function(tag) { return new StubNode(tag); },
    createTextNode: function(t) { var n = new StubNode('#text'); n._text = String(t == null ? '' : t); return n; },
    body: new StubNode('body'), readyState: 'loading', getElementById: function() { return null; }, addEventListener: function() {}
};
global.window = { db: 'testdb' };

var mod = require('../download/atex/js/production-planning.js');
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

var BASE = new Date(2026, 6, 24, 0, 0, 0, 0).getTime();
function ts(dayOff, minute) { return String(Math.floor(BASE / 1000) + dayOff * 86400 + minute * 60); }
function cutOf(id, dayOff, minute, runs, orderId, over) {
    var c = { id: id, orderId: orderId, firstPartId: id, slitter: { id: '1279', label: 'Станок 2' },
        materialId: 'MW308', winding: 'OUT', knifeWidths: [60, 60, 60], knifeCount: 3, rollerWidth: 0,
        plannedRuns: runs, isFoil: false, length: 600, status: '', startDate: '', endDate: '',
        planDate: ts(dayOff, minute), number: ts(dayOff, minute), duration: String(runs * 2) };
    for (var k in (over || {})) c[k] = over[k];
    return c;
}

// ── Стенд контроллера с фейковой БД ─────────────────────────────────────────
// getJson различает две таблицы: «Партии ГП» (F_U = задание) и «Обеспечение» (F_U = позиция).
var CUT_TABLE = '1078', FB_TABLE = '1081', SUP_TABLE = '1077';
var REQ = { runs: '16403', duration: '26584', timing: '26990',
    fbWidth: 'w', fbStrips: 's', fbRolls: 'r', fbPlanned: 'p', fbOrder: 'o',
    supFootage: '1149', supActive: '1154', supBatch: '15016', supRolls: '16424' };
function makeController(cuts, batchesByCut, supplies, suppliesByPosition) {
    var c = Object.create(Controller.prototype);
    c.cuts = cuts;
    c.supplies = supplies || [];
    c.meta = {
        cut: { id: CUT_TABLE, reqs: [
            { id: REQ.runs, val: 'Кол-во резок план' },
            { id: REQ.duration, val: 'Длительность, минут' },
            { id: REQ.timing, val: 'Тайминг' }
        ] },
        finishedBatch: { id: FB_TABLE, reqs: [
            { id: REQ.fbWidth, val: 'Ширина, мм' }, { id: REQ.fbStrips, val: 'Кол-во полос' },
            { id: REQ.fbRolls, val: 'Кол-во рулонов' }, { id: REQ.fbPlanned, val: 'Кол-во план' },
            { id: REQ.fbOrder, val: 'ID заказа' }
        ] },
        // Порядок реквизитов — как в боевой ateh (1077): Метраж, В работе, Партия ГП, Кол-во рулонов.
        supply: { id: SUP_TABLE, reqs: [
            { id: REQ.supFootage, val: 'Метраж, м' }, { id: REQ.supActive, val: 'В работе' },
            { id: REQ.supBatch, val: 'Партия ГП' }, { id: REQ.supRolls, val: 'Кол-во рулонов' }
        ] }
    };
    c.opTimes = { WIND_600: 2.4 }; c.changeTimes = {}; c.daySettings = {};
    c.positionLengthById = {}; c.genPositions = []; c.footageBySupply = {};
    c.freezeByDay = {};
    c.filter = { date: '2026-07-24', dateTo: '2026-08-09' };
    c.nowMs = function () { return BASE; };
    c.notes = []; c.notify = function (m, k) { c.notes.push({ msg: m, kind: k }); };
    c.render = function () {}; c.renderLink = function () {};
    c.posts = [];
    c.post = function (path, fields) { c.posts.push({ path: path, fields: fields || {} }); return Promise.resolve({ obj: '1' }); };
    c.reads = [];
    c.getJson = function (path) {
        c.reads.push(path);
        var m = /F_U=([^&]+)/.exec(path);
        var key = m ? decodeURIComponent(m[1]) : '';
        if (path.indexOf('object/' + SUP_TABLE + '/') === 0) {
            // Обеспечения позиции: [главное, Метраж, В работе, Партия ГП, Кол-во рулонов].
            return Promise.resolve(((suppliesByPosition || {})[key] || []).map(function (s) {
                return { i: s.id, u: key, r: ['1', String(s.footage), 'X', String(s.batchId) + ':1', String(s.rolls)] };
            }));
        }
        return Promise.resolve((batchesByCut[key] || []).map(function (b) {
            var r = []; r[0] = b.width; r[1] = b.strips; r[2] = b.rolls; r[3] = b.planned; r[4] = b.orderId || '';
            return { i: b.id, r: r };
        }));
    };
    c.reload = function () { c.reloaded = (c.reloaded || 0) + 1; return Promise.resolve(); };
    return c;
}
function pathsOf(c) { return c.posts.map(function (p) { return p.path.replace(/\?.*$/, ''); }); }
function postFor(c, prefix) { return c.posts.filter(function (p) { return p.path.indexOf(prefix) === 0; }); }

// ── 1) ПРАВИЛО: пара (позиция × Партия ГП) остаётся одной записью ───────────
// Боевой случай #4483: заказ 4443, задания на 8 и 4 прохода, одна позиция, одна ширина.
(function run1() {
    var cuts = [
        cutOf('A', 0, 480, 8, '4443'),    // голова — первое по порядку
        cutOf('B', 2, 480, 4, '4443')     // донор
    ];
    var batches = {
        A: [{ id: 'bA60', width: 60, strips: 15, rolls: 120, planned: 120, orderId: '4443' }],
        B: [{ id: 'bB60', width: 60, strips: 15, rolls: 60, planned: 60, orderId: '4443' }]
    };
    var supplies = [
        { id: 'sA', cutId: 'A', finishedBatchId: 'bA60', positionId: 'pos1', rolls: 120 },
        { id: 'sB', cutId: 'B', finishedBatchId: 'bB60', positionId: 'pos1', rolls: 60 }
    ];
    var byPosition = {
        pos1: [{ id: 'sA', batchId: 'bA60', footage: 400, rolls: 120 },
               { id: 'sB', batchId: 'bB60', footage: 200, rolls: 60 }]
    };
    var c = makeController(cuts, batches, supplies, byPosition);
    c.mergeSameOrderTasks().then(function (n) {
        assertEqual(n, 1, 'донор слит в голову');

        // Главное: второй связи с той же позицией не остаётся.
        assert(pathsOf(c).indexOf('_m_del/sB') !== -1,
            'донорское «Обеспечение» той же позиции УДАЛЕНО, а не перевешено второй записью');
        assertEqual(postFor(c, '_m_set/sB').length, 0,
            'перевешивания донорского обеспечения нет — оно влилось в головное');

        // Данные не потеряны: метраж и рулоны сложены в головное обеспечение.
        var sASet = postFor(c, '_m_set/sA')[0];
        assert(!!sASet, 'головное «Обеспечение» обновлено суммой');
        assertEqual(sASet && sASet.fields['t' + REQ.supFootage], '600', 'метраж 400 + 200 = 600');
        assertEqual(sASet && sASet.fields['t' + REQ.supRolls], '180', 'рулоны 120 + 60 = 180');

        // Партии и задания сливаются как раньше (#4424).
        assert(pathsOf(c).indexOf('_m_del/bB60') !== -1, 'донорская «Партия ГП» удалена');
        assert(pathsOf(c).indexOf('_m_del/B') !== -1, 'запись-донор удалена');
        assertEqual(postFor(c, '_m_set/A')[0].fields['t' + REQ.runs], '12', 'у головы 8 + 4 = 12 проходов');
        return run2();
    }).catch(function (e) { console.log('FAIL — исключение:', e && e.stack || e); process.exitCode = 1; });
})();

// ── 2) Позиции, которой у головы нет, — перевешиваем как раньше ─────────────
function run2() {
    var cuts = [cutOf('A', 0, 480, 8, '4404'), cutOf('B', 2, 480, 4, '4404')];
    var batches = {
        A: [{ id: 'bA60', width: 60, strips: 15, rolls: 120, planned: 120, orderId: '4404' }],
        B: [{ id: 'bB60', width: 60, strips: 15, rolls: 60, planned: 60, orderId: '4404' }]
    };
    var supplies = [
        { id: 'sA', cutId: 'A', finishedBatchId: 'bA60', positionId: 'pos1', rolls: 120 },
        { id: 'sB', cutId: 'B', finishedBatchId: 'bB60', positionId: 'pos2', rolls: 60 }   // ДРУГАЯ позиция
    ];
    var byPosition = {
        pos1: [{ id: 'sA', batchId: 'bA60', footage: 400, rolls: 120 }],
        pos2: [{ id: 'sB', batchId: 'bB60', footage: 200, rolls: 60 }]
    };
    var c = makeController(cuts, batches, supplies, byPosition);
    return c.mergeSameOrderTasks().then(function () {
        var moved = postFor(c, '_m_set/sB')[0];
        assert(!!moved && moved.fields['t' + REQ.supBatch] === 'bA60',
            'обеспечение ДРУГОЙ позиции перевешено на партию головы (связь не теряем)');
        assertEqual(pathsOf(c).indexOf('_m_del/sB'), -1, 'и не удалено — эта позиция обеспечена только им');
        assertEqual(postFor(c, '_m_set/sA').length, 0, 'головное обеспечение не трогаем — складывать нечего');
        return run3();
    });
}

// ── 3) Три задания одного заказа: одна позиция → одна запись ────────────────
function run3() {
    var cuts = [cutOf('A', 0, 480, 1, '4421'), cutOf('B', 3, 480, 5, '4421'), cutOf('C', 5, 480, 2, '4421')];
    var batches = {
        A: [{ id: 'bA60', width: 60, strips: 10, rolls: 10, planned: 10, orderId: '4421' }],
        B: [{ id: 'bB60', width: 60, strips: 10, rolls: 50, planned: 50, orderId: '4421' }],
        C: [{ id: 'bC60', width: 60, strips: 10, rolls: 20, planned: 20, orderId: '4421' }]
    };
    var supplies = [
        { id: 'sA', cutId: 'A', finishedBatchId: 'bA60', positionId: 'pos1', rolls: 10 },
        { id: 'sB', cutId: 'B', finishedBatchId: 'bB60', positionId: 'pos1', rolls: 50 },
        { id: 'sC', cutId: 'C', finishedBatchId: 'bC60', positionId: 'pos1', rolls: 20 }
    ];
    var byPosition = {
        pos1: [{ id: 'sA', batchId: 'bA60', footage: 100, rolls: 10 },
               { id: 'sB', batchId: 'bB60', footage: 500, rolls: 50 },
               { id: 'sC', batchId: 'bC60', footage: 200, rolls: 20 }]
    };
    var c = makeController(cuts, batches, supplies, byPosition);
    return c.mergeSameOrderTasks().then(function () {
        assert(pathsOf(c).indexOf('_m_del/sB') !== -1 && pathsOf(c).indexOf('_m_del/sC') !== -1,
            'оба донорских обеспечения влиты и удалены');
        var sets = postFor(c, '_m_set/sA');
        var last = sets[sets.length - 1];
        assertEqual(last && last.fields['t' + REQ.supFootage], '800', 'метраж 100 + 500 + 200 = 800 (копится по донорам)');
        assertEqual(last && last.fields['t' + REQ.supRolls], '80', 'рулоны 10 + 50 + 20 = 80');
        return run4();
    });
}

// ── 4) Значений обеспечений не прочитать — связь НЕ теряем и не молчим ──────
function run4() {
    var cuts = [cutOf('A', 0, 480, 8, '4405'), cutOf('B', 2, 480, 4, '4405')];
    var batches = {
        A: [{ id: 'bA60', width: 60, strips: 15, rolls: 120, planned: 120, orderId: '4405' }],
        B: [{ id: 'bB60', width: 60, strips: 15, rolls: 60, planned: 60, orderId: '4405' }]
    };
    var supplies = [
        { id: 'sA', cutId: 'A', finishedBatchId: 'bA60', positionId: 'pos1', rolls: 120 },
        { id: 'sB', cutId: 'B', finishedBatchId: 'bB60', positionId: 'pos1', rolls: 60 }
    ];
    var c = makeController(cuts, batches, supplies, {});   // чтение обеспечений позиции даёт пусто
    var warns = [];
    var origWarn = console.warn, origErr = console.error;
    console.warn = function () { warns.push(Array.prototype.slice.call(arguments).join(' ')); };
    console.error = function () { warns.push(Array.prototype.slice.call(arguments).join(' ')); };
    return c.mergeSameOrderTasks().then(function () {
        console.warn = origWarn; console.error = origErr;
        var moved = postFor(c, '_m_set/sB')[0];
        assert(!!moved && moved.fields['t' + REQ.supBatch] === 'bA60',
            'не смогли сложить → перевешиваем (связь с заказом важнее аккуратности записи)');
        assertEqual(pathsOf(c).indexOf('_m_del/sB'), -1, 'донорское обеспечение при этом не удаляем');
        assert(warns.filter(function (w) { return /4483/.test(w); }).length > 0,
            'и не молча — в консоли сказано, почему не сложили');
    }, function (e) { console.warn = origWarn; console.error = origErr; throw e; });
}

process.on('exit', function () {
    console.log('\n' + passed + '/' + total + ' passed');
});
