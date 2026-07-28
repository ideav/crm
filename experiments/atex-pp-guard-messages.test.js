// Tests for ideav/crm#4475 — «Сообщения стража записи написаны разработчику и всплывают из-за
// планов, которые не применяются».
//
// ПРАВИЛО. Оператор получает сообщение о нарушении жёсткого правила (ТЗ §15) только когда это
// меняет его результат: план ЗАПИСАН или план ОТКЛОНЁН. Текст называет задание/день/станок так,
// как они подписаны на экране, и не отсылает «в консоль». РАСЧЁТ КАНДИДАТА оператору не пишет
// ничего — он пишет в журнал.
//
// ДО ПРАВКИ: `buildSequenceOps` сам звал `notify` на каждом построении плана, поэтому одно нажатие
// «Упорядочить» (кандидаты B и A) давало до трёх красных «Так быть не должно — детали в консоли»
// про планы, которые тут же выбрасывались.
//
// Run with: node experiments/atex-pp-guard-messages.test.js

process.env.TZ = 'Europe/Moscow';

var mod = require('../download/atex/js/production-planning.js');
var Controller = mod.Controller;
var planning = mod.planning;

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
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
// Слова разработчика, которым в интерфейсе оператора не место.
function talksToDeveloper(text) {
    return /консол|так быть не должно|ruleBreak|DAY_CAPACITY|FIXED_BLOCK|DAY_FILL|CUT_BATCH/i.test(String(text || ''));
}

// ── A) Формат сообщения — чистая функция, нарушение → человеческий текст ──────────────────────
(function () {
    var slitterLabel = function (sid) { return String(sid) === '1279' ? 'Станок 2' : ('#' + sid); };
    var dayLabel = function (key) { return String(key) === '20260729' ? 'Ср 29.07' : String(key); };
    var opts = { slitterLabel: slitterLabel, dayLabel: dayLabel };

    assertEqual(planning.formatPlanAuditMessage([], opts), null, 'нарушений нет — сообщения нет');

    var cap = planning.formatPlanAuditMessage([{ rule: 'DAY_CAPACITY', cutId: null,
        msg: 'станок 1279, день 20260729: 492 мин при потолке 460 (превышение 32)',
        slitterId: '1279', dayKey: 20260729, loadMin: 492, capMin: 460, overMin: 32 }], opts);
    assert(!!cap && cap.text.indexOf('Станок 2') !== -1 && cap.text.indexOf('Ср 29.07') !== -1,
        'потолок дня: назван станок и день, как они подписаны на экране', '→ ' + (cap && cap.text));
    assert(!!cap && cap.text.indexOf('492') !== -1 && cap.text.indexOf('460') !== -1,
        'потолок дня: названы минуты и потолок');
    assert(!!cap && !talksToDeveloper(cap.text), 'потолок дня: без «детали в консоли» и имён правил');

    var block = planning.formatPlanAuditMessage([{ rule: 'FIXED_BLOCK', cutId: '643660',
        msg: 'зафиксированные задания дня переставлены местами: 644467 ↔ 643660',
        slitterId: '1279', dayKey: 20260729, otherCutId: '644467', kind: 'swap' }], opts);
    assert(!!block && block.text.indexOf('644467') !== -1 && block.text.indexOf('643660') !== -1,
        'монолит 🔒: названы оба задания', '→ ' + (block && block.text));
    assert(!!block && !talksToDeveloper(block.text), 'монолит 🔒: без отсылки в консоль');

    var many = planning.formatPlanAuditMessage([
        { rule: 'DAY_CAPACITY', slitterId: '1279', dayKey: 20260729, loadMin: 492, capMin: 460, overMin: 32, msg: '' },
        { rule: 'FIXED_BLOCK', cutId: '643660', otherCutId: '644467', kind: 'swap', slitterId: '1279', dayKey: 20260729, msg: '' },
        { rule: 'DAY_FILL', slitterId: '1279', dayKey: 20260730, freeMin: 30, needMin: 2.33, donorCutId: '647159', msg: '' },
        { rule: 'DAY_FILL', slitterId: '1279', dayKey: 20260731, freeMin: 40, needMin: 3.8, donorCutId: '647160', msg: '' }
    ], Object.assign({ limit: 3 }, opts));
    assert(!!many && (many.text.match(/;/g) || []).length >= 2, 'несколько нарушений — ОДНО сообщение через «;»',
        '→ ' + (many && many.text));
    assert(!!many && /ещё\s+1/.test(many.text), 'обрезка не замалчивается — «…и ещё 1»');
})();

// ── Контроллер: фикстура, где нарушение потолка НЕИЗБЕЖНО ────────────────────────────────────
// Один проход длиной больше смены: разбить нельзя (проход атомарен, #4149), уехать некуда — день
// обязан выйти за потолок. Это единственный законный способ увидеть DAY_CAPACITY на живом плане.
var DAY_SETTINGS = { DAY_START_HOUR: '8:00', DAY_END_HOUR: '16:30', LUNCH_START: '12:20',
    LUNCH_DURATION: '40', TOTAL_INTERVALS: '20', MAX_OVERWORK_CUTS_MN: '5', MAX_OVERWORK_TUNE_MN: '10',
    SLOT_PLACEMENT: '1' };
var TIMES = { KNIFE: 30, MATERIAL_WINDING: 15, KNIFE_MOVE: 0, BETWEEN_CUTS: 2, CLEANUP_SHIFT: 30 };
// Две точки намотки — иначе метраж выше последней точки не экстраполируется (клампится), и
// «проход длиннее смены» из фикстуры ниже не получится.
var OP_TIMES = { WIND_300: 1.8, WIND_600: 3.6 };
var SID = '1279';
var BASE = new Date(2026, 6, 28, 0, 0, 0, 0).getTime();

function widths(n, w) { var a = []; for (var i = 0; i < n; i++) a.push(w); return a; }
function tsAt(dayOff, minute) { return String(Math.floor(BASE / 1000) + dayOff * 86400 + minute * 60); }
function cut(id, o) {
    o = o || {};
    return { id: id, orderId: 'O' + id, firstPartId: id,
        slitter: { id: SID, label: 'Станок 2' },
        materialId: o.mat || 'MW411', winding: 'OUT', batchId: 'B' + (o.mat || 'MW411'),
        knifeWidths: widths(o.knives || 15, o.width || 59), knifeCount: o.knives || 15,
        rollerWidth: 60, plannedRuns: o.runs, isFoil: false, length: o.length || 300, status: '',
        startDate: '', endDate: '', fixed: !!o.fixed,
        planDate: tsAt(o.day || 0, 480), number: tsAt(o.day || 0, 480),
        duration: String(Math.ceil((o.length || 300) / 300 * 1.8 * o.runs)),
        storedKnifeSetupMin: '30', storedMaterialWindingMin: '15',
        storedCutAndLeaderMin: String(Math.ceil((o.length || 300) / 300 * 1.8 * o.runs) + 2 * o.runs) };
}
function makeSelf(cuts) {
    var self = Object.create(Controller.prototype);
    self.cuts = cuts;
    self.changeTimes = TIMES; self.opTimes = OP_TIMES; self.daySettings = DAY_SETTINGS;
    self.filter = { slitter: '', status: '', date: '2026-07-28', dateTo: '2026-08-09', query: '' };
    self.supplies = []; self.genPositions = []; self.positions = [];
    self.footageBySupply = {}; self.positionLengthById = {}; self.consumptionByCut = {};
    self.jumboWidthByMaterial = {}; self.nominalWidthByMaterial = {}; self.actualWidthIndex = null;
    self.genBatches = []; self.slitters = [{ id: SID, label: 'Станок 2' }];
    self.downtimesBySlitter = {}; self.calendarByDay = {}; self.freezeByDay = {};
    self.prevSetupBySlitter = {};
    self.meta = { cut: { id: '1078', reqs: [
        { id: '96067', val: 'Наладка ножей, мин' },
        { id: '96069', val: 'Сырье/намотка, мин' },
        { id: '96778', val: 'Резка и Лидер' }
    ] }, calendar: { id: '1' }, freeze: null };
    self.nowMs = function () { return BASE; };
    self.busy = false;
    self.writes = [];
    self.post = function (url, fields) { self.writes.push({ url: url, fields: fields }); return Promise.resolve({ obj: '1' }); };
    self.reload = function () { return Promise.resolve(); };
    self.render = function () {}; self.renderLink = function () {};
    self.setBusy = function (v) { self.busy = !!v; };
    self.showProgress = function () {}; self.hideProgress = function () {}; self.updateProgress = function () {};
    self.notes = [];
    self.notify = function (m, k) { self.notes.push({ msg: String(m), kind: k }); };
    self.reconcileOrphanOrderSupplies = function () { return Promise.resolve(0); };
    self.persistCutSetupColumns = function () { return Promise.resolve(); };
    self.reconcilePlanStarts = function () { return Promise.resolve(0); };
    self.startPlanPreview = function (pend) { self.preview = pend; };
    return self;
}
function captureConsole(fn) {
    var out = [];
    var oe = console.error, ow = console.warn, ol = console.log;
    console.error = function () { out.push(Array.prototype.slice.call(arguments).map(String).join(' ')); };
    console.warn = function () { out.push(Array.prototype.slice.call(arguments).map(String).join(' ')); };
    console.log = function () { out.push(Array.prototype.slice.call(arguments).map(String).join(' ')); };
    try { return { value: fn(), log: out }; }
    finally { console.error = oe; console.warn = ow; console.log = ol; }
}
// Задание из ОДНОГО прохода длиной больше смены — днём его не разрезать и не унести.
function hugePassFixture() { return [cut('H1', { runs: 1, length: 120000 })]; }

// ── B) Расчёт плана оператору НЕ ПИШЕТ, но в журнал — пишет ──────────────────────────────────
(function () {
    var self = makeSelf(hugePassFixture());
    var res = captureConsole(function () {
        return self.buildSequenceOps(self.cuts, 'setup', false);
    });
    var breaks = (res.value.ops && res.value.ops.ruleBreaks) || [];
    assert(breaks.filter(function (v) { return v.rule === 'DAY_CAPACITY'; }).length > 0,
        'фикстура: страж поймал нарушение потолка дня (проход длиннее смены)',
        '(' + breaks.map(function (v) { return v.rule; }).join(',') + ')');
    assertEqual(self.notes, [], '#4475: расчёт плана-кандидата оператору не говорит НИЧЕГО');
    assert(res.log.filter(function (l) { return /#4467/.test(l) && /потолк/i.test(l); }).length > 0,
        'но в журнале нарушение названо полностью (правило, день, минуты)',
        '→ ' + (res.log.filter(function (l) { return /#4467/.test(l); })[0] || '—'));
    var audit = (res.value.ops && res.value.ops.ruleAudit) || [];
    assert(audit.length > 0, 'нарушения отданы вызывающему в ops.ruleAudit — есть о чём сказать при записи');
    assert(audit.every(function (v) { return v.rule !== 'DAY_CAPACITY' || (v.slitterId && v.dayKey && v.loadMin > 0); }),
        'нарушение несёт СТРУКТУРУ (станок, день, минуты), а не только текст для разработчика');
})();

// ── C) Запись плана говорит ОДИН раз и по-человечески ────────────────────────────────────────
var chain = Promise.resolve();
chain = chain.then(function () {
    var self = makeSelf(hugePassFixture());
    var built = captureConsole(function () { return self.buildSequenceOps(self.cuts, 'setup', false); }).value;
    self.notes = [];
    return captureConsole(function () {
        return self.applySplitPlan({ updates: [], creates: [], deletes: [], audit: built.ops.ruleAudit });
    }).value.then(function () {
        assertEqual(self.notes.length, 1, '#4475: запись плана с нарушением — РОВНО одно сообщение оператору');
        var text = (self.notes[0] || {}).msg || '';
        assert(!talksToDeveloper(text), 'сообщение написано оператору, а не разработчику', '→ ' + text);
        assert(/Станок 2/.test(text), 'в сообщении назван станок так, как он подписан на экране');
        assert(/\d{2}\.\d{2}/.test(text), 'и день — датой, а не ключом ГГГГММДД');
    });
});

// ── D) «Упорядочить» отказывает — тоже ОДИН тост, и он объясняет, что делать ──────────────────
chain = chain.then(function () {
    var self = makeSelf(hugePassFixture());
    self.computeReassignmentPlan = function () { return { changed: false }; };   // один станок — переназначать некуда
    captureConsole(function () { self.runOptimizeQueue(); });
    var errs = self.notes.filter(function (n) { return n.kind === 'error'; });
    assertEqual(errs.length, 0, '#4475: красных сообщений про выброшенных кандидатов нет');
    assertEqual(self.notes.length, 1, 'на одно нажатие «Упорядочить» — одно сообщение');
    var text = (self.notes[0] || {}).msg || '';
    assert(/отклон/i.test(text) && /🔒|день/i.test(text),
        'оператору сказано, что план отклонён и что с этим делать', '→ ' + text);
    assert(!talksToDeveloper(text), 'и это сообщение — тоже без отсылки в консоль');
});

chain.then(function () {
    console.log('\n' + passed + '/' + total + ' passed');
}).catch(function (e) {
    console.error('FAIL — исключение:', e && e.stack || e);
    process.exitCode = 1;
});
