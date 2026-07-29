// Tests for ideav/crm#4488 — при перемещении задания его хвост в другом дне подтягивается:
// части цепочки дробления СШИВАЮТСЯ в одно задание ПЕРЕД планированием вставки.
//
// Боевой случай (ateh): цепочка 649598 (голова, 1 проход, 29.07, 🔒) + 650956 (продолжение,
// 11 проходов, 30.07). Оператор перетащил голову на 3-е место — уехал огрызок в 1 проход, вся
// работа (11 проходов) осталась в следующем дне. `moveCutToDay` двигает ОДНУ запись, а
// планировщик пересобрать цепочку уже не мог: перенос ставит на голову замок 🔒.
//
// Правило (ТЗ §15): нельзя оставлять хвосты. Перенос ЛЮБОЙ части цепочки сшивает все её части в
// одну запись (сумма проходов; приёмник — та запись, которую тащат), и планируется вставка уже
// целого задания. Замок, стоявший на любой из частей, переходит на результат.
//
// Покрываем:
//   1) ПРАВИЛО (общий тест): перенос головы / хвоста / середины — в очереди остаётся ОДНА запись
//      цепочки с суммой проходов, остальные удалены; маркер «ID первой части» указывает на неё;
//   2) замок: 🔒 любой части → 🔒 на слитом задании;
//   3) идемпотентность: цепочки нет — ни одной записи в БД;
//   4) `moveCutToDay` сшивает ДО записи стартов и планирует вставку уже слитого задания
//      (вместо прежней отвязки сегмента, #4357);
//   5) инвариант реестра CHAIN_CONTIGUOUS: разорванная цепочка — нарушение, штатное дробление
//      по дням (хвост первым в следующем дне) — норма.
//
// Run with: node experiments/atex-pp-4488-move-merges-chain.test.js

process.env.TZ = 'Europe/Moscow';

// ── Минимальный DOM-стаб (как в atex-4483-merge-supply-dedupe.test.js) ──
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

var BASE = new Date(2026, 6, 29, 0, 0, 0, 0).getTime();
function ts(dayOff, minute) { return String(Math.floor(BASE / 1000) + dayOff * 86400 + minute * 60); }

// ── Стенд контроллера с фейковой БД ─────────────────────────────────────────
var CUT_TABLE = '1078', FB_TABLE = '1081', SUP_TABLE = '1077';
var REQ = { runs: '16403', duration: '26584', timing: '26990', fixed: '81530', firstPart: '196458',
    slitter: '1156',
    fbWidth: 'w', fbStrips: 's', fbRolls: 'r', fbPlanned: 'p', fbOrder: 'o',
    supFootage: '1149', supBatch: '15016', supRolls: '16424' };
// Часть цепочки: id, проходов, день, маркер «ID первой части», замок.
function partOf(id, dayOff, minute, runs, firstPartId, fixed) {
    return { id: id, orderId: '4443', firstPartId: firstPartId, fixed: !!fixed,
        slitter: { id: '1277', label: 'Станок 1' },
        materialId: 'MW308', winding: 'OUT', knifeWidths: [60, 60, 60], knifeCount: 3, rollerWidth: 60,
        plannedRuns: runs, isFoil: false, length: 600, status: '', startDate: '', endDate: '',
        planDate: ts(dayOff, minute), number: ts(dayOff, minute), duration: String(runs * 6) };
}
function makeController(cuts, batchesByCut, supplies, supplyValuesByPosition) {
    var c = Object.create(Controller.prototype);
    c.cuts = cuts;
    c.supplies = supplies || [];
    c.meta = {
        cut: { id: CUT_TABLE, reqs: [
            { id: REQ.slitter, val: 'Слиттер' },
            { id: REQ.runs, val: 'Кол-во резок план' },
            { id: REQ.duration, val: 'Длительность, минут' },
            { id: REQ.timing, val: 'Тайминг' },
            { id: REQ.firstPart, val: 'ID первой части' },
            { id: REQ.fixed, val: 'Зафиксировано' }
        ] },
        finishedBatch: { id: FB_TABLE, reqs: [
            { id: REQ.fbWidth, val: 'Ширина, мм' }, { id: REQ.fbStrips, val: 'Кол-во полос' },
            { id: REQ.fbRolls, val: 'Кол-во рулонов' }, { id: REQ.fbPlanned, val: 'Кол-во план' },
            { id: REQ.fbOrder, val: 'ID заказа' }
        ] },
        supply: { id: SUP_TABLE, reqs: [
            { id: REQ.supFootage, val: 'Метраж, м' }, { id: REQ.supBatch, val: 'Партия ГП' },
            { id: REQ.supRolls, val: 'Кол-во рулонов' }
        ] }
    };
    c.opTimes = { WIND_600: 4 }; c.changeTimes = {}; c.daySettings = {};
    c.positionLengthById = {}; c.genPositions = []; c.footageBySupply = {};
    c.freezeByDay = {};
    c.filter = { date: '2026-07-29', dateTo: '2026-08-09' };
    c.slitters = [{ id: '1277', label: 'Станок 1' }];
    c.nowMs = function () { return BASE; };
    c.notes = []; c.notify = function (m, k) { c.notes.push({ msg: m, kind: k }); };
    c.render = function () {}; c.renderLink = function () {};
    c.showProgress = function () {}; c.hideProgress = function () {}; c.updateProgress = function () {};
    c.setBusy = function (v) { c.busy = !!v; };
    c.posts = [];
    c.post = function (path, fields) { c.posts.push({ path: path, fields: fields || {} }); return Promise.resolve({ obj: '1' }); };
    c.getJson = function (path) {
        var m = /F_U=([^&]+)/.exec(path);
        var key = m ? decodeURIComponent(m[1]) : '';
        if (path.indexOf('object/' + SUP_TABLE + '/') === 0) {
            return Promise.resolve(((supplyValuesByPosition || {})[key] || []).map(function (s) {
                return { i: s.id, u: key, r: ['1', String(s.footage), String(s.batchId) + ':1', String(s.rolls)] };
            }));
        }
        return Promise.resolve(((batchesByCut || {})[key] || []).map(function (b) {
            var r = []; r[0] = b.width; r[1] = b.strips; r[2] = b.rolls; r[3] = b.planned; r[4] = b.orderId || '';
            return { i: b.id, r: r };
        }));
    };
    c.reload = function () { c.reloaded = (c.reloaded || 0) + 1; return Promise.resolve(); };
    return c;
}
function pathsOf(c) { return c.posts.map(function (p) { return p.path.replace(/\?.*$/, ''); }); }
function postFor(c, prefix) { return c.posts.filter(function (p) { return p.path.indexOf(prefix) === 0; }); }
// Цепочка боевого случая: A — голова 1 прохода (29.07, 🔒), B — продолжение 11 проходов (30.07).
function chainCase(fixedOn) {
    return {
        cuts: [partOf('A', 0, 557, 1, 'A', fixedOn === 'A'), partOf('B', 1, 480, 11, 'A', fixedOn === 'B')],
        batches: {
            A: [{ id: 'bA60', width: 60, strips: 15, rolls: 15, planned: 15, orderId: '4443' }],
            B: [{ id: 'bB60', width: 60, strips: 15, rolls: 165, planned: 165, orderId: '4443' }]
        },
        supplies: [
            { id: 'sA', cutId: 'A', finishedBatchId: 'bA60', positionId: 'pos1', rolls: 15 },
            { id: 'sB', cutId: 'B', finishedBatchId: 'bB60', positionId: 'pos1', rolls: 165 }
        ],
        byPosition: { pos1: [{ id: 'sA', batchId: 'bA60', footage: 50, rolls: 15 },
                             { id: 'sB', batchId: 'bB60', footage: 550, rolls: 165 }] }
    };
}

// ── 1) ПРАВИЛО: тащим ЛЮБУЮ часть — цепочка сшита в ту запись, которую тащат ─
(function run1() {
    var cases = [
        { name: 'тащим голову', drag: 'A', gone: 'B' },
        { name: 'тащим хвост', drag: 'B', gone: 'A' }
    ];
    var chain = Promise.resolve();
    cases.forEach(function (cs) {
        chain = chain.then(function () {
            var f = chainCase('A');
            var c = makeController(f.cuts, f.batches, f.supplies, f.byPosition);
            return c.mergeSplitChain(cs.drag).then(function (n) {
                assertEqual(n, 1, cs.name + ': влита одна часть');
                var set = postFor(c, '_m_set/' + cs.drag)[0];
                assert(!!set, cs.name + ': запись, которую тащат, обновлена');
                assertEqual(set && set.fields['t' + REQ.runs], '12', cs.name + ': проходы 1 + 11 = 12');
                assertEqual(set && set.fields['t' + REQ.firstPart], cs.drag,
                    cs.name + ': маркер цепочки указывает на неё саму — задание снова цельное');
                assert(pathsOf(c).indexOf('_m_del/' + cs.gone) !== -1, cs.name + ': вторая часть удалена');
                assertEqual(pathsOf(c).indexOf('_m_del/' + cs.drag), -1, cs.name + ': перетаскиваемая запись жива');
                // Обеспечения обеих частей — одна связь с позицией (#4483).
                var supSets = postFor(c, '_m_set/s');
                assert(supSets.length > 0, cs.name + ': обеспечение слито, а не потеряно');
                assert(c.reloaded > 0, cs.name + ': очередь перечитана');
            });
        });
    });
    return chain.then(run2).catch(function (e) { console.log('FAIL — исключение:', e && e.stack || e); process.exitCode = 1; });
})();

// ── 2) Замок любой части переходит на слитое задание ────────────────────────
function run2() {
    var f = chainCase('A');   // 🔒 стои́т на голове, тащим хвост
    var c = makeController(f.cuts, f.batches, f.supplies, f.byPosition);
    return c.mergeSplitChain('B').then(function () {
        var set = postFor(c, '_m_set/B')[0];
        assertEqual(set && set.fields['t' + REQ.fixed], '1',
            'замок с поглощённой части перешёл на слитое задание');
        // А если замка не было ни на одной — не ставим.
        var f2 = chainCase(null);
        var c2 = makeController(f2.cuts, f2.batches, f2.supplies, f2.byPosition);
        return c2.mergeSplitChain('B').then(function () {
            var set2 = postFor(c2, '_m_set/B')[0];
            assert(!set2 || set2.fields['t' + REQ.fixed] == null, 'незафиксированная цепочка замок не приобретает');
            return run3();
        });
    });
}

// ── 3) Сшивать нечего — ни одной записи (идемпотентно) ──────────────────────
function run3() {
    var single = [partOf('A', 0, 480, 12, 'A', false)];
    var c = makeController(single, { A: [] }, [], {});
    return c.mergeSplitChain('A').then(function (n) {
        assertEqual(n, 0, 'задание целое — сшивать нечего');
        assertEqual(c.posts.length, 0, 'и ни одной записи в БД');
        return run4();
    });
}

// ── 4) moveCutToDay: сшивает ДО планирования вставки, отвязки сегмента нет ──
function run4() {
    var f = chainCase('A');
    var c = makeController(f.cuts, f.batches, f.supplies, f.byPosition);
    var order = [];
    var realMerge = c.mergeSplitChain;
    c.mergeSplitChain = function (id) { order.push('merge:' + id); return realMerge.call(c, id); };
    c.autoSequenceQueue = function () { order.push('plan'); return Promise.resolve(true); };
    c.workingWindow = function () { return { startMin: 480, cutEndMin: 990, lunchStartMin: 740, lunchDurationMin: 40 }; };
    c.slitterOnVacationDay = function () { return false; };
    var origPost = c.post;
    c.post = function (path, fields) {
        if (/_m_save\//.test(path)) order.push('start:' + path.replace(/\?.*$/, ''));
        return origPost.call(c, path, fields);
    };
    return c.moveCutToDay(f.cuts[1], '2026-07-29', 'weight', true, '1277', true).then(function () {
        var mergeAt = order.findIndex(function (x) { return /^merge:/.test(x); });
        var startAt = order.findIndex(function (x) { return /^start:/.test(x); });
        var planAt = order.indexOf('plan');
        assert(mergeAt !== -1, 'перенос сшил цепочку');
        assert(startAt === -1 || mergeAt < startAt, 'сшивание идёт ДО записи времени старта');
        assert(planAt === -1 || mergeAt < planAt, 'и ДО планирования вставки');
        // #4357-отвязка отменена: маркер цепочки не переписывается на «сам себе» у сегмента,
        // потому что сегментов больше нет — задание слито.
        assert(pathsOf(c).indexOf('_m_del/A') !== -1, 'вторая часть цепочки удалена переносом');
        return run4b();
    });
}

// ── 4b) ↑↓ и перетаскивание — тоже перемещение: сшивают перед перестановкой ─
function run4b() {
    // ↑↓: тащим часть цепочки вверх мимо соседа того же дня.
    var f = chainCase('A');
    var neighbour = partOf('N', 0, 480, 4, 'N', false);   // сосед в дне головы, стои́т раньше
    var c = makeController([neighbour].concat(f.cuts), f.batches, f.supplies, f.byPosition);
    var stitched = [];
    var realMerge = c.mergeSplitChain;
    c.mergeSplitChain = function (id) { stitched.push(String(id)); return realMerge.call(c, id); };
    c.recalcSetupTiming = function () { return Promise.resolve(true); };
    var sameDay = [neighbour, f.cuts[0]];   // очередь дня: сосед, затем голова цепочки
    return c.moveCutInDay(sameDay, 1, -1).then(function () {
        assert(stitched.indexOf('A') !== -1, '↑↓: перед перестановкой части задания сшиты');
        // Перетаскивание (drag) — тот же путь.
        var f2 = chainCase('A');
        var n2 = partOf('N', 0, 480, 4, 'N', false);
        var c2 = makeController([n2].concat(f2.cuts), f2.batches, f2.supplies, f2.byPosition);
        var stitched2 = [];
        var realMerge2 = c2.mergeSplitChain;
        c2.mergeSplitChain = function (id) { stitched2.push(String(id)); return realMerge2.call(c2, id); };
        c2.recalcSetupTiming = function () { return Promise.resolve(true); };
        return c2.reorderCutInDay([n2, f2.cuts[0]], 'A', 'N').then(function () {
            assert(stitched2.indexOf('A') !== -1, 'перетаскивание: части задания сшиты перед перестановкой');
            return run5();
        });
    });
}

// ── 5) Инвариант реестра: разорванная цепочка — нарушение ───────────────────
function run5() {
    var inv = (planning.invariants || []).filter(function (r) { return r.id === 'CHAIN_CONTIGUOUS'; })[0];
    assert(!!inv, 'правило CHAIN_CONTIGUOUS есть в реестре PP_INVARIANTS (ТЗ §15)');
    assertEqual(inv && inv.actor, 'any', 'действует на любого автора: и автоматику, и ручной перенос');
    if (!inv) return;

    var DAY = 86400;
    var base = Math.floor(BASE / 1000);
    // Хранимый план: день 0 — X(08:00), Y(09:00), голова A(09:17); день 1 — хвост B(08:00).
    var snapshot = [
        { id: 'X', slitterId: '1277', planStartTs: base + 8 * 3600, fixed: false, chainId: 'X' },
        { id: 'Y', slitterId: '1277', planStartTs: base + 9 * 3600, fixed: false, chainId: 'Y' },
        { id: 'A', slitterId: '1277', planStartTs: base + 9 * 3600 + 1020, fixed: true, chainId: 'A' },
        { id: 'B', slitterId: '1277', planStartTs: base + DAY + 8 * 3600, fixed: false, chainId: 'A' }
    ];
    function dayKeyOfTs(ts) { var d = new Date(Number(ts) * 1000); return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); }
    var ctx = { planSnapshot: function () { return snapshot; }, dayKeyOfTs: dayKeyOfTs,
                isFixedCut: function (id) { return id === 'A'; } };

    // Между головой и хвостом стои́т чужое задание Z (день 0, после A) → цепочка разорвана.
    var broken = snapshot.concat([{ id: 'Z', slitterId: '1277', planStartTs: base + 10 * 3600, fixed: false, chainId: 'Z' }]);
    var brokenCtx = { planSnapshot: function () { return broken; }, dayKeyOfTs: dayKeyOfTs,
                      isFixedCut: function (id) { return id === 'A'; } };
    var v = inv.check({ updates: [], creates: [], deletes: [] }, brokenCtx);
    assertEqual(v.length, 1, 'между частями задания вклинилось чужое — нарушение');
    assertEqual(v[0] && v[0].cutId, 'B', 'нарушение названо по оторванной части');
    assert(/A/.test((v[0] && v[0].msg) || ''), 'в сообщении названа голова цепочки');

    // Штатное дробление: голова последняя в дне, хвост первый в следующем — норма.
    assertEqual(inv.check({ updates: [], creates: [], deletes: [] }, ctx), [],
        'штатное дробление по дням (хвост первым в следующем дне) нарушением не считается');

    // Нет chainId в снимке (легаси) → правило молчит, а не считает всё нарушением.
    var noChain = snapshot.map(function (r) { var o = {}; for (var k in r) o[k] = r[k]; delete o.chainId; return o; });
    assertEqual(inv.check({ updates: [], creates: [], deletes: [] },
        { planSnapshot: function () { return noChain; }, dayKeyOfTs: dayKeyOfTs }), [],
        'без маркера цепочки правило не срабатывает (конвенция реестра)');
}

process.on('exit', function () {
    console.log('\n' + passed + '/' + total + ' passed');
});
