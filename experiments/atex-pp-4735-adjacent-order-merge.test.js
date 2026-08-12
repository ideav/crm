// #4735 — ЧАСТИ ОДНОЙ РАБОТЫ, ОКАЗАВШИЕСЯ РЯДОМ В ОДНОМ ДНЕ, СХЛОПЫВАЮТСЯ В ОДНО ЗАДАНИЕ.
//
// ПРАВИЛО (ТЗ §15): «Задания одного заказа, оказавшись рядом, должны схлопываться в одно задание,
// сохраняя суммарное количество резок». Область действия — «Сгенерировать» / «Упорядочить» /
// «Пересчитать наладку» / ручной перенос / «Урегулировать».
//
// СИМПТОМ (боевое 12.08.2026, продолжение #4732). После «Урегулировать» в Чт 13.08.2026 подряд
// стояли ДВЕ карточки одного заказа 4675 одной конфигурации (MW308, 450 × 8, втулка 1"):
//   № 2 — 08:28–09:10, «проходов 7 из 38 · остальные 31 → 13.08.2026»
//   № 3 — 09:10–11:18, «проходов 31 из 38 · остальные 7 → 13.08.2026»
// Работа одна, записи две: наладка платится дважды, а 38 проходов живут двумя числами.
//
// ПРИЧИНА. Слияние одинаковых заданий (#4424, `mergeableOrderGroups`) цепочку дробления
// ПРОПУСКАЕТ — она законный результат разрезания задания потолком смены (§9). Про случай «обе
// части оказались в ОДНОМ дне» не спрашивал никто, а «Урегулировать» именно его и создаёт:
// паровоз подтягивает остаток к его же половине.
//
// ЧТО ПРОВЕРЯЕМ:
//   A — предикат `adjacentOrderMergeGroups` видит вход из тикета, а прежний `mergeableOrderGroups`
//       на нём молчит (воспроизведение дефекта);
//   B — слияние: одна запись, «Кол-во резок план» = 7 + 31 = 38, донор удалён, задание цельное;
//   C — части одной цепочки в РАЗНЫХ днях не сливаются (законное дробление §9);
//   D — идемпотентность: сливать нечего → ни одной записи в БД;
//   E — чужое задание между частями разрывает смежность; начатое и замороженный день — тоже;
//   F — разные заказы и разные конфигурации не сливаются;
//   G — хвост любой записи плана (`levelOverfilledAfterWrite`) зовёт слияние ДО выравнивания дня,
//       сводит старты встык и приходит туда со всех кнопок области действия;
//   H — правило реестра ORDER_PARTS_ADJACENT (ТЗ §15): actor 'any', mode 'audit'.
//
// Run with: node experiments/atex-pp-4735-adjacent-order-merge.test.js

process.env.TZ = 'Europe/Moscow';

// ── Минимальный DOM-стаб (как в atex-pp-4488-move-merges-chain.test.js) ──
function StubNode(tag) {
    this.tagName = String(tag || '').toUpperCase();
    this.childNodes = []; this.attributes = {}; this.dataset = {}; this.style = {};
    this._className = ''; this._text = ''; this.value = ''; this.disabled = false; this.options = [];
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
global.window = { db: 'ateh1' };

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

var BASE = new Date(2026, 7, 12, 0, 0, 0, 0).getTime();   // Ср 12.08.2026 = день 0 фильтра
function ts(dayOff, minute) { return String(Math.floor(BASE / 1000) + dayOff * 86400 + minute * 60); }

var CUT_TABLE = '1078', FB_TABLE = '1081', SUP_TABLE = '1077';
var REQ = { runs: '16403', duration: '26584', timing: '26990', fixed: '81530', firstPart: '196458',
    slitter: '1156',
    fbWidth: 'w', fbStrips: 's', fbRolls: 'r', fbPlanned: 'p', fbOrder: 'o',
    supFootage: '1149', supBatch: '15016', supRolls: '16424' };

// Запись очереди. По умолчанию — конфигурация заказа 4675 из тикета (MW308, 8 ножей по 110 мм).
function cut(id, o) {
    o = o || {};
    return { id: id,
        orderId: o.orderId === undefined ? '4675' : o.orderId,
        firstPartId: o.chain === undefined ? id : o.chain,
        fixed: !!o.fixed,
        slitter: { id: o.sid || '1279', label: 'Станок 2' },
        materialId: o.mat || 'MW308', winding: 'IN',
        knifeWidths: o.knives || [110, 110, 110, 110, 110, 110, 110, 110],
        knifeCount: (o.knives || [1, 1, 1, 1, 1, 1, 1, 1]).length, rollerWidth: 110,
        plannedRuns: o.runs, isFoil: false, length: 450,
        status: o.status || '', startDate: o.startDate || '', endDate: o.endDate || '',
        planDate: ts(o.day, o.min), number: ts(o.day, o.min), duration: String(o.runs * 3) };
}

// Вход из тикета: обе части цепочки 4675 стоят подряд в Чт 13.08 (день 1 фильтра).
function ticketCase() {
    return {
        cuts: [cut('P1', { day: 1, min: 508, runs: 7, chain: 'P1' }),      // 08:28 — «7 из 38»
               cut('P2', { day: 1, min: 550, runs: 31, chain: 'P1' })],    // 09:10 — «31 из 38»
        batches: {
            P1: [{ id: 'bP1', width: 110, strips: 8, rolls: 56, planned: 56, orderId: '4675' }],
            P2: [{ id: 'bP2', width: 110, strips: 8, rolls: 248, planned: 248, orderId: '4675' }]
        },
        supplies: [{ id: 'sP1', cutId: 'P1', finishedBatchId: 'bP1', positionId: 'pos1', rolls: 56 },
                   { id: 'sP2', cutId: 'P2', finishedBatchId: 'bP2', positionId: 'pos1', rolls: 248 }],
        byPosition: { pos1: [{ id: 'sP1', batchId: 'bP1', footage: 3150, rolls: 56 },
                             { id: 'sP2', batchId: 'bP2', footage: 13950, rolls: 248 }] }
    };
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
    c.opTimes = { WIND_450: 3 }; c.changeTimes = {}; c.daySettings = {};
    c.positionLengthById = {}; c.genPositions = []; c.footageBySupply = {};
    c.freezeByDay = {};
    c.filter = { date: '2026-08-12', dateTo: '2026-08-21' };
    c.slitters = [{ id: '1279', label: 'Станок 2' }];
    c.nowMs = function() { return BASE; };
    c.notes = []; c.notify = function(m, k) { c.notes.push({ msg: m, kind: k }); };
    c.render = function() {}; c.renderLink = function() {};
    c.showProgress = function() {}; c.hideProgress = function() {}; c.updateProgress = function() {};
    c.setBusy = function(v) { c.busy = !!v; };
    c.posts = [];
    c.post = function(path, fields) { c.posts.push({ path: path, fields: fields || {} }); return Promise.resolve({ obj: '1' }); };
    c.getJson = function(path) {
        var m = /F_U=([^&]+)/.exec(path);
        var key = m ? decodeURIComponent(m[1]) : '';
        if (path.indexOf('object/' + SUP_TABLE + '/') === 0) {
            return Promise.resolve(((supplyValuesByPosition || {})[key] || []).map(function(s) {
                return { i: s.id, u: key, r: ['1', String(s.footage), String(s.batchId) + ':1', String(s.rolls)] };
            }));
        }
        return Promise.resolve(((batchesByCut || {})[key] || []).map(function(b) {
            var r = []; r[0] = b.width; r[1] = b.strips; r[2] = b.rolls; r[3] = b.planned; r[4] = b.orderId || '';
            return { i: b.id, r: r };
        }));
    };
    c.reload = function() { c.reloaded = (c.reloaded || 0) + 1; return Promise.resolve(); };
    return c;
}
function pathsOf(c) { return c.posts.map(function(p) { return p.path.replace(/\?.*$/, ''); }); }
function postFor(c, prefix) { return c.posts.filter(function(p) { return p.path.indexOf(prefix) === 0; }); }
function dayKeyOf(c) { var d = new Date(Number(c.planDate) * 1000); return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); }
function groupsOf(cuts, skipIds) {
    return planning.adjacentOrderMergeGroups(cuts, { skipIds: skipIds || {}, dayKeyOf: dayKeyOf });
}

// ── A) Воспроизведение: прежний предикат вход из тикета не видит, новый — видит ─
(function runA() {
    var f = ticketCase();
    assertEqual(planning.mergeableOrderGroups(f.cuts, {}), [],
        'A: #4424 цепочку дробления пропускает — заказ 4675 остаётся разбитым (воспроизведение)');
    var g = groupsOf(f.cuts);
    assertEqual(g.length, 1, 'A: смежные части одного дня — одна группа слияния');
    assertEqual(g[0].headId, 'P1', 'A: голова — первая по порядку (её место в дне не меняется)');
    assertEqual(g[0].memberIds, ['P1', 'P2'], 'A: в группе обе части');
    assertEqual(g[0].runs, 38, 'A: сумма проходов 7 + 31 = 38 — резки не теряются');
    assertEqual(g[0].dayKey, 20260813, 'A: день группы — Чт 13.08.2026');
})();

// ── B) Слияние: одна запись, 38 проходов, донор удалён, задание цельное ─────
function runB() {
    var f = ticketCase();
    var c = makeController(f.cuts, f.batches, f.supplies, f.byPosition);
    return c.mergeAdjacentOrderTasks().then(function(res) {
        assertEqual(res.merged, 1, 'B: влита одна запись');
        assertEqual(res.dayKeys, [20260813], 'B: назван тронутый день — по нему сводятся старты');
        var set = postFor(c, '_m_set/P1')[0];
        assert(!!set, 'B: голова обновлена');
        assertEqual(set && set.fields['t' + REQ.runs], '38', 'B: «Кол-во резок план» = 7 + 31 = 38');
        assertEqual(set && set.fields['t' + REQ.firstPart], 'P1',
            'B: маркер цепочки указывает на голову — задание снова цельное');
        assert(pathsOf(c).indexOf('_m_del/P2') !== -1, 'B: вторая запись удалена');
        assertEqual(pathsOf(c).indexOf('_m_del/P1'), -1, 'B: голова жива');
        assert(c.reloaded > 0, 'B: очередь перечитана');
        // Замок с любой из частей переходит на результат (как при сшивании #4488).
        var f2 = ticketCase();
        f2.cuts[1].fixed = true;
        var c2 = makeController(f2.cuts, f2.batches, f2.supplies, f2.byPosition);
        return c2.mergeAdjacentOrderTasks().then(function() {
            var s2 = postFor(c2, '_m_set/P1')[0];
            assertEqual(s2 && s2.fields['t' + REQ.fixed], '1', 'B: 🔒 с поглощённой части перешёл на голову');
            return runC();
        });
    });
}

// ── C) Разные дни — законное дробление §9, не сливаем ───────────────────────
function runC() {
    var split = [cut('P1', { day: 1, min: 900, runs: 7, chain: 'P1' }),
                 cut('P2', { day: 2, min: 480, runs: 31, chain: 'P1' })];
    assertEqual(groupsOf(split), [], 'C: части в РАЗНЫХ днях не сливаются — задание не влезло в смену');
    var c = makeController(split, { P1: [], P2: [] }, [], {});
    return c.mergeAdjacentOrderTasks().then(function(res) {
        assertEqual(res.merged, 0, 'C: сливать нечего');
        assertEqual(c.posts.length, 0, 'C: и ни одной записи в БД');
        return runD();
    });
}

// ── D) Идемпотентность: цельное задание — ни одной записи ───────────────────
function runD() {
    var whole = [cut('P1', { day: 1, min: 508, runs: 38, chain: 'P1' })];
    assertEqual(groupsOf(whole), [], 'D: одно задание — сливать нечего');
    var c = makeController(whole, { P1: [] }, [], {});
    return c.mergeAdjacentOrderTasks().then(function(res) {
        assertEqual(res.merged, 0, 'D: повторное действие — 0');
        assertEqual(c.posts.length, 0, 'D: и ни одной записи в БД (идемпотентно)');
        return runE();
    });
}

// ── E) Смежность разрывают: чужое задание, начатое, замороженный день ───────
function runE() {
    // Чужое задание между частями — работа и правда разорвана (это случай CHAIN_CONTIGUOUS #4488).
    var alien = [cut('P1', { day: 1, min: 508, runs: 7, chain: 'P1' }),
                 cut('Z', { day: 1, min: 550, runs: 5, chain: 'Z', orderId: '4700', mat: 'MW412' }),
                 cut('P2', { day: 1, min: 620, runs: 31, chain: 'P1' })];
    assertEqual(groupsOf(alien), [], 'E: между частями чужое задание — соседями они не стали');

    // Начатое задание (#4381) сливать нельзя — и через него сливать тоже нельзя.
    var started = ticketCase().cuts.concat([]);
    assertEqual(groupsOf(started, { P2: 1 }), [],
        'E: начатую/завершённую часть не трогаем — правило её не переставляет');

    // Замороженный день (#4326) — тот же отказ, но уже на стороне контроллера.
    var f = ticketCase();
    var c = makeController(f.cuts, f.batches, f.supplies, f.byPosition);
    c.dayIsFrozen = function() { return true; };
    return c.mergeAdjacentOrderTasks().then(function(res) {
        assertEqual(res.merged, 0, 'E: замороженный день автоматика не трогает (#4326)');
        assertEqual(c.posts.length, 0, 'E: и ни одной записи в БД');
        return runF();
    });
}

// ── F) Разные заказы и разные конфигурации — это две работы ─────────────────
function runF() {
    var otherOrder = [cut('A', { day: 1, min: 508, runs: 7, chain: 'A' }),
                      cut('B', { day: 1, min: 550, runs: 31, chain: 'B', orderId: '4700' })];
    assertEqual(groupsOf(otherOrder), [], 'F: соседи РАЗНЫХ заказов не сливаются');

    var otherKnives = [cut('A', { day: 1, min: 508, runs: 7, chain: 'A' }),
                       cut('B', { day: 1, min: 550, runs: 31, chain: 'B', knives: [85, 85, 85, 85] })];
    assertEqual(groupsOf(otherKnives), [],
        'F: между разными наборами ножей стои́т переналадка — это две работы');

    // А два ОТДЕЛЬНЫХ задания одного заказа и одной конфигурации, ставшие соседями, — сливаются.
    var sameOrder = [cut('A', { day: 1, min: 508, runs: 7, chain: 'A' }),
                     cut('B', { day: 1, min: 550, runs: 31, chain: 'B' })];
    var g = groupsOf(sameOrder);
    assertEqual(g.length, 1, 'F: два задания одного заказа рядом в дне — одна группа');
    assertEqual(g[0].runs, 38, 'F: и сумма проходов сохранена');
    return runG();
}

// ── G) Общий хвост записи: слияние → сведе́ние стартов → выравнивание дня ────
function runG() {
    function tailStand(mergedCount) {
        var c = Object.create(Controller.prototype);
        c.order = [];
        c.slitters = [{ id: '1279' }];
        c.mergeAdjacentOrderTasks = function() {
            c.order.push('merge');
            return Promise.resolve({ merged: mergedCount, dayKeys: [20260813] });
        };
        c.reconcilePlanStarts = function(opts) { c.order.push('starts:' + JSON.stringify(opts.dayKeys)); return Promise.resolve(1); };
        c.overfilledDaysOf = function() { return [{ dayOffset: 1, overMin: 60 }]; };
        c.levelDayLoad = function() { c.order.push('level'); return Promise.resolve(true); };
        return c;
    }
    var c = tailStand(1);
    return c.levelOverfilledAfterWrite({ withinSlitterIds: ['1279'] }, 'RES').then(function(res) {
        assertEqual(c.order, ['merge', 'starts:[20260813]', 'level'],
            'G: хвост сначала схлопывает соседей, потом сводит старты встык, потом выравнивает день');
        assertEqual(res, 'RES', 'G: результат исходной операции не подменяется');
        // Сливать было нечего — сведе́ния стартов нет (лишних записей не делаем).
        var c2 = tailStand(0);
        return c2.levelOverfilledAfterWrite({ withinSlitterIds: ['1279'] }, 'RES').then(function() {
            assertEqual(c2.order, ['merge', 'level'], 'G: слить нечего — старты не переписываем');
            return runG2();
        });
    });
}

// Все кнопки области действия приходят в ЭТОТ хвост — проверяем по исходнику.
function runG2() {
    var fs = require('fs');
    var src = fs.readFileSync(__dirname + '/../download/atex/js/production-planning/20-controller.js', 'utf8');
    function bodyOf(name) {
        var at = src.indexOf('AtexProductionPlanning.prototype.' + name + ' = function');
        if (at === -1) return '';
        var end = src.indexOf('\n    AtexProductionPlanning.prototype.', at + 10);
        return src.slice(at, end === -1 ? src.length : end);
    }
    assert(/levelOverfilledAfterWrite\(/.test(bodyOf('settleDeviations')),
        'G: «Урегулировать» заканчивается общим хвостом записи');
    assert(/levelOverfilledAfterWrite\(/.test(bodyOf('autoSequenceQueueAfterMerge')),
        'G: «Сгенерировать»/«Упорядочить»/ручной перенос — тем же хвостом');
    assert(/levelOverfilledAfterWrite\(/.test(bodyOf('recalcSetupTiming'))
        && !/levelDayLoad\(/.test(bodyOf('recalcSetupTiming')),
        'G: «Пересчитать наладку» зовёт хвост, а не выравнивание напрямую');
    assert(/levelOverfilledAfterWrite\(/.test(bodyOf('recalcFromCut'))
        && !/levelDayLoad\(/.test(bodyOf('recalcFromCut')),
        'G: «Пересчитать отсюда» — тоже');
    return runH();
}

// ── H) Правило реестра (ТЗ §15) ─────────────────────────────────────────────
function runH() {
    var inv = (planning.invariants || []).filter(function(r) { return r.id === 'ORDER_PARTS_ADJACENT'; })[0];
    assert(!!inv, 'H: правило ORDER_PARTS_ADJACENT есть в реестре PP_INVARIANTS (ТЗ §15)');
    if (!inv) return;
    assertEqual(inv.actor, 'any', 'H: действует на любого автора — и на автоматику, и на человека');
    assertEqual(inv.mode, 'audit', 'H: наблюдатель — соседей чинит слияние, а не отказ от записи');

    var base = Math.floor(BASE / 1000), DAY = 86400;
    var SIG = '1279|MW308|IN|110,110,110,110,110,110,110,110';
    function row(id, dayOff, minute, o) {
        o = o || {};
        return { id: id, slitterId: '1279', planStartTs: base + dayOff * DAY + minute * 60,
                 chainId: o.chain === undefined ? id : o.chain,
                 orderId: o.orderId === undefined ? '4675' : o.orderId,
                 workSig: o.sig || SIG };
    }
    function dayKeyOfTs(t) { var d = new Date(Number(t) * 1000); return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); }
    function ctxOf(rows) { return { planSnapshot: function() { return rows; }, dayKeyOfTs: dayKeyOfTs }; }
    var noOps = { updates: [], creates: [], deletes: [] };

    var bad = [row('P1', 1, 508, { chain: 'P1' }), row('P2', 1, 550, { chain: 'P1' })];
    var v = inv.check(noOps, ctxOf(bad));
    assertEqual(v.length, 1, 'H: две части одной работы рядом в дне — нарушение');
    assertEqual(v[0].cutId, 'P2', 'H: нарушение названо по второй записи');
    assertEqual(v[0].dayKey, 20260813, 'H: и назван день');

    var okDays = [row('P1', 1, 900, { chain: 'P1' }), row('P2', 2, 480, { chain: 'P1' })];
    assertEqual(inv.check(noOps, ctxOf(okDays)), [], 'H: дробление по дням (§9) нарушением не считается');

    var okWork = [row('A', 1, 508, { chain: 'A' }), row('B', 1, 550, { chain: 'B', orderId: '4700' })];
    assertEqual(inv.check(noOps, ctxOf(okWork)), [], 'H: соседи разных заказов — норма');

    // Начатая/завершённая половина (#4564/#4651) и замороженный день (#4326) — слить нельзя,
    // и это ПОСТОЯННОЕ состояние плана: обвинять его в этом нельзя.
    var doneHalf = [row('P1', 1, 508, { chain: 'P1' }), row('P2', 1, 550, { chain: 'P1' })];
    doneHalf[0].started = true;
    assertEqual(inv.check(noOps, ctxOf(doneHalf)), [],
        'H: выполненная половина рядом со своим остатком — норма, а не нарушение');
    assertEqual(inv.check(noOps, { planSnapshot: function() { return bad; }, dayKeyOfTs: dayKeyOfTs,
                                   isFrozenCut: function() { return true; } }), [],
        'H: замороженный день автоматика не трогает — обвинять её не в чем');

    // А чужое задание между частями — случай CHAIN_CONTIGUOUS (#4488), не этот.
    var alien = [row('P1', 1, 508, { chain: 'P1' }),
                 row('Z', 1, 530, { chain: 'Z', orderId: '4700', sig: '1279|MW412|IN|85,85' }),
                 row('P2', 1, 560, { chain: 'P1' })];
    assertEqual(inv.check(noOps, ctxOf(alien)), [], 'H: между частями чужое задание — соседями они не стали');

    // Операции учитываются: план ПРИВОДИТ части в один день → правило видит это ДО записи.
    var wasOk = [row('P1', 1, 508, { chain: 'P1' }), row('P2', 2, 480, { chain: 'P1' })];
    var willBeBad = inv.check({ updates: [{ cutId: 'P2', planStartTs: base + DAY + 550 * 60 }], creates: [], deletes: [] }, ctxOf(wasOk));
    assertEqual(willBeBad.length, 1, 'H: правило меряет ИТОГОВЫЙ план (хранимый + операции)');

    // Удаление донора нарушение снимает — ровно это и делает слияние.
    assertEqual(inv.check({ updates: [], creates: [], deletes: ['P2'] }, ctxOf(bad)), [],
        'H: слияние (удаление донора) нарушение снимает');

    // Нет подписи конфигурации (легаси-снимок) → правило молчит, а не обвиняет всех.
    var noSig = bad.map(function(r) { var o = {}; for (var k in r) o[k] = r[k]; delete o.workSig; return o; });
    assertEqual(inv.check(noOps, ctxOf(noSig)), [],
        'H: без подписи конфигурации правило не срабатывает (конвенция реестра)');
}

runB().catch(function(e) { console.log('FAIL — исключение:', e && e.stack || e); process.exitCode = 1; });

process.on('exit', function() {
    console.log('\n' + passed + '/' + total + ' passed');
});
