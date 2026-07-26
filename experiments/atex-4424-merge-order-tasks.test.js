// Tests for ideav/crm#4424 (вторая часть) — «объедини по первому по порядку».
//
// Заказ 4362 жил ТРЕМЯ заданиями одной конфигурации на одном станке: у каждого своя наладка, они
// не сливались и разъезжались по дням. Теперь планировщик сливает такие записи в ОДНО задание —
// голова = ПЕРВОЕ ПО ПОРЯДКУ (минимальная «Дата план»), остальные вливаются и удаляются.
//
// Данные при этом не теряются:
//   • «Партия ГП» донора той же ШИРИНЫ вливается в партию головы: «Обеспечения» перевешиваются на
//     партию головы, рулоны суммируются, «ID заказа» объединяется, партия-донор удаляется;
//   • партия ширины, которой у головы нет, переезжает под голову целиком (`_m_move&up=`);
//   • «Кол-во план» партий головы = полос × новые проходы; голова получает сумму проходов и
//     пересчитанные «Длительность, минут» / «Тайминг».
// Не объединяем: начатые (#4381), задания замороженных дней (#4326), завершённые, складские (без
// заказа) и уже единую цепочку дробления (общий «ID первой части»).
//
// Run with: node experiments/atex-4424-merge-order-tasks.test.js

process.env.TZ = 'Europe/Moscow';

// ── Минимальный DOM-стаб (как в atex-pp-4401-recalc-timing-only.test.js) ──
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

var BASE = new Date(2026, 6, 24, 0, 0, 0, 0).getTime();
function ts(dayOff, minute) { return String(Math.floor(BASE / 1000) + dayOff * 86400 + minute * 60); }
function cutOf(id, dayOff, minute, runs, orderId, over) {
    var c = { id: id, orderId: orderId, firstPartId: id, slitter: { id: '1279', label: 'Станок 2' },
        materialId: 'MW308', winding: 'OUT', knifeWidths: [80, 80, 80], knifeCount: 3, rollerWidth: 0,
        plannedRuns: runs, isFoil: false, length: 300, status: '', startDate: '', endDate: '',
        planDate: ts(dayOff, minute), number: ts(dayOff, minute), duration: String(runs * 2) };
    for (var k in (over || {})) c[k] = over[k];
    return c;
}

// ── 1) Чистая mergeableOrderGroups: кого с кем и кто голова ─────────────────
(function () {
    var cuts = [
        cutOf('B', 3, 480, 57, '4362'),          // 27.07
        cutOf('A', 0, 890, 1, '4362'),           // 24.07 — ПЕРВОЕ по порядку
        cutOf('C', 5, 700, 1, '4362'),           // 29.07
        cutOf('X', 5, 480, 8, '4383'),           // другой заказ
        cutOf('S', 4, 480, 5, '')                // склад — без заказа
    ];
    var g = planning.mergeableOrderGroups(cuts, {});
    assertEqual(g.length, 1, 'группа одна — только задания одного заказа и одной конфигурации');
    assertEqual([g[0].headId, g[0].memberIds, g[0].runs], ['A', ['A', 'B', 'C'], 59],
        '#4424: голова — ПЕРВОЕ по порядку (24.07), проходы суммируются');
    assertEqual(planning.mergeableOrderGroups(cuts, { skipIds: { A: 1 } })[0].headId, 'B',
        'исключённая запись не берётся ни головой, ни в состав — голова следующая по порядку');

    // Другая конфигурация того же заказа — отдельное задание.
    var otherCfg = [cutOf('A', 0, 480, 1, '4362'), cutOf('D', 1, 480, 1, '4362', { knifeWidths: [55, 55] })];
    assertEqual(planning.mergeableOrderGroups(otherCfg, {}), [], 'разные ножи — не объединяем');

    // Уже одна цепочка дробления — трогать нечего.
    var chained = [cutOf('H', 0, 480, 10, '999'), cutOf('H2', 1, 480, 10, '999', { firstPartId: 'H' })];
    assertEqual(planning.mergeableOrderGroups(chained, {}), [], 'цепочка дробления — это и так одно задание');

    // Одна запись — не группа.
    assertEqual(planning.mergeableOrderGroups([cutOf('A', 0, 480, 1, '4362')], {}), [],
        'одиночное задание объединять не с чем');
})();

// ── Стенд контроллера с фейковой БД ─────────────────────────────────────────
var CUT_TABLE = '1078', FB_TABLE = '1081', SUP_TABLE = '1075';
var REQ = { runs: '16403', duration: '26584', timing: '26990',
    fbWidth: 'w', fbStrips: 's', fbRolls: 'r', fbPlanned: 'p', fbOrder: 'o', supBatch: 'sb' };
function makeController(cuts, batchesByCut, supplies, freezeByDay) {
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
        supply: { id: SUP_TABLE, reqs: [{ id: REQ.supBatch, val: 'Партия ГП' }] }
    };
    c.opTimes = { WIND_300: 1.2 }; c.changeTimes = {}; c.daySettings = {};
    c.positionLengthById = {}; c.genPositions = []; c.footageBySupply = {};
    c.freezeByDay = freezeByDay || {};
    if (freezeByDay) c.meta.freeze = { id: 'fz' };
    c.filter = { date: '2026-07-24', dateTo: '2026-08-09' };
    c.nowMs = function () { return BASE; };
    c.notes = []; c.notify = function (m, k) { c.notes.push({ msg: m, kind: k }); };
    c.render = function () {}; c.renderLink = function () {};
    c.posts = [];
    c.post = function (path, fields) { c.posts.push({ path: path, fields: fields || {} }); return Promise.resolve({ obj: '1' }); };
    c.getJson = function (path) {
        var m = /F_U=([^&]+)/.exec(path);
        var cutId = m ? decodeURIComponent(m[1]) : '';
        return Promise.resolve((batchesByCut[cutId] || []).map(function (b) {
            var r = []; r[0] = b.width; r[1] = b.strips; r[2] = b.rolls; r[3] = b.planned; r[4] = b.orderId || '';
            return { i: b.id, r: r };
        }));
    };
    // Колонки «Партии ГП» в JSON_OBJ идут в порядке reqs — совпадает с r[] выше.
    c.reload = function () { c.reloaded = (c.reloaded || 0) + 1; return Promise.resolve(); };
    return c;
}
function pathsOf(c) { return c.posts.map(function (p) { return p.path.replace(/\?.*$/, ''); }); }
function postFor(c, prefix) { return c.posts.filter(function (p) { return p.path.indexOf(prefix) === 0; }); }

// ── 2) Слияние: партии, обеспечения, проходы, удаление доноров ──────────────
(function run() {
    var cuts = [
        cutOf('A', 0, 890, 1, '4362'),     // голова (первое по порядку)
        cutOf('B', 3, 480, 57, '4362'),
        cutOf('C', 5, 700, 1, '4362')
    ];
    var batches = {
        A: [{ id: 'bA80', width: 80, strips: 11, rolls: 11, planned: 11, orderId: '4362' }],
        B: [{ id: 'bB80', width: 80, strips: 11, rolls: 627, planned: 627, orderId: '4362' }],
        C: [{ id: 'bC80', width: 80, strips: 11, rolls: 11, planned: 11, orderId: '4362' },
            { id: 'bC55', width: 55, strips: 4, rolls: 8, planned: 8, orderId: '4362' }]   // ширины у головы нет
    };
    var supplies = [
        { id: 'sA', cutId: 'A', finishedBatchId: 'bA80', positionId: 'p1', rolls: 11 },
        { id: 'sB', cutId: 'B', finishedBatchId: 'bB80', positionId: 'p1', rolls: 627 },
        { id: 'sC', cutId: 'C', finishedBatchId: 'bC80', positionId: 'p1', rolls: 11 },
        { id: 'sC2', cutId: 'C', finishedBatchId: 'bC55', positionId: 'p2', rolls: 8 }
    ];
    var c = makeController(cuts, batches, supplies, null);
    c.mergeSameOrderTasks().then(function (n) {
        assertEqual(n, 2, 'слито две записи — обе в голову A');

        // Обеспечения доноров перевешены на партию головы той же ширины.
        var supMoves = postFor(c, '_m_set/sB').concat(postFor(c, '_m_set/sC'));
        assertEqual(supMoves.length, 2, 'обеспечения донорских партий 80 мм перевешены');
        assert(supMoves.every(function (p) { return p.fields['t' + REQ.supBatch] === 'bA80'; }),
            'перевешены именно на «Партию ГП» головы');
        assertEqual(postFor(c, '_m_set/sC2').length, 0,
            'обеспечение партии, которой у головы нет, не трогаем — переезжает вместе с партией');

        // Донорские партии 80 мм удалены, партия 55 мм ПЕРЕЕХАЛА под голову.
        assert(pathsOf(c).indexOf('_m_del/bB80') !== -1 && pathsOf(c).indexOf('_m_del/bC80') !== -1,
            'донорские партии той же ширины удалены (их содержимое влито)');
        var moved = postFor(c, '_m_move/bC55');
        assertEqual(moved.length, 1, 'партия 55 мм переехала под голову');
        assert(/up=A/.test(moved[0].path), 'перенос именно под голову (up=A)');

        // Сами записи-доноры удалены.
        assert(pathsOf(c).indexOf('_m_del/B') !== -1 && pathsOf(c).indexOf('_m_del/C') !== -1,
            'записи-доноры удалены');
        assertEqual(pathsOf(c).indexOf('_m_del/A'), -1, 'голова НЕ удалена');

        // Голова: сумма проходов и пересчитанные тайминг-поля.
        var headSet = postFor(c, '_m_set/A')[0];
        assertEqual(headSet.fields['t' + REQ.runs], '59', 'у головы сумма проходов 1+57+1');
        assert(headSet.fields['t' + REQ.duration] != null && headSet.fields['t' + REQ.timing] != null,
            '«Длительность» и «Тайминг» головы пересчитаны');

        // Партия головы: рулоны просуммированы, «Кол-во план» = полос × новые проходы.
        var bSet = postFor(c, '_m_set/bA80')[0];
        assertEqual(bSet.fields['t' + REQ.fbRolls], '649', 'рулоны партии головы = 11+627+11');
        assertEqual(bSet.fields['t' + REQ.fbPlanned], '649', '«Кол-во план» = 11 полос × 59 проходов');

        assert(c.notes.filter(function (n2) { return /Объединено заданий/.test(n2.msg); }).length === 1,
            'оператору сказано, что и во что слито');
        assert(c.reloaded > 0, 'после слияния очередь перечитана');

        // ── 3) Нечего сливать → ни одной записи ──
        var solo = makeController([cutOf('A', 0, 480, 1, '4362'), cutOf('X', 1, 480, 2, '4383')],
            { A: [], X: [] }, [], null);
        return solo.mergeSameOrderTasks().then(function (n2) {
            assertEqual(n2, 0, 'сливать нечего → 0');
            assertEqual(solo.posts.length, 0, 'и ни одной записи в БД (идемпотентно)');

            // ── 4) Начатое и замороженный день не сливаем ──
            var started = makeController([
                cutOf('A', 0, 480, 1, '4362'),
                cutOf('B', 1, 480, 5, '4362', { startDate: ts(1, 480) })
            ], { A: [], B: [] }, [], null);
            return started.mergeSameOrderTasks().then(function (n3) {
                assertEqual(n3, 0, 'начатое задание (#4381) в слияние не берём');

                // Прошлый день (раньше «С») не переписываем.
                var past = makeController([cutOf('P', -2, 480, 1, '4362'), cutOf('B', 1, 480, 5, '4362')],
                    { P: [], B: [] }, [], null);
                return past.mergeSameOrderTasks().then(function (nPast) {
                    assertEqual(nPast, 0, 'задание прошлого дня (раньше «С») в слияние не берём (#4294)');
                    assertEqual(past.posts.length, 0, 'и ни одной записи в БД');
                    return null;
                }).then(function () {
                var frozenKey = (function () {
                    var d = new Date(BASE);
                    return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
                })();
                var fz = {}; fz[frozenKey] = { id: 'f', notes: '' };
                var frozen = makeController([cutOf('A', 0, 480, 1, '4362'), cutOf('B', 1, 480, 5, '4362')],
                    { A: [], B: [] }, [], fz);
                return frozen.mergeSameOrderTasks().then(function (n4) {
                    assertEqual(n4, 0, 'задание замороженного дня (#4326) в слияние не берём');
                    console.log('\n' + passed + '/' + total + ' passed');
                });
                });
            });
        });
    }).catch(function (e) { console.error('FAIL — исключение:', e && e.stack || e); process.exitCode = 1; });
})();
