// #4642 — «Упорядочить» разделена на три смежные части: подпись | «Станок» | «Все».
//
// ЗАПРОС ЗАКАЗЧИКА (07.08.2026): «Разделить кнопку Упорядочить на 3 смежные части:
// Упорядочить | Станок | Все. Кнопку "Добавить вручную" переименовать в "Добавить".
// Упорядочить не нажимается, "Станок" упорядочивает только в рамках выбранного станка,
// "Все" — работает как сейчас».
//
// ЗАЧЕМ. У кнопки было два разных смысла, а выбора не было: нажатие всегда пересобирало ВЕСЬ
// горизонт по всем станкам, включая переназначение станков (кандидат A). Диспетчер же обычно
// правит ОДИН станок, на который смотрит, и не хочет, чтобы заодно переехали соседние.
//
//   A — разметка: три части, подпись НЕ кнопка, «Добавить» без «вручную»;
//   B — рамки режима «Станок»: кандидат B с withinSlitterIds, кандидата A нет вовсе, C сужен;
//   C — режим «Все» ведёт себя ровно как прежде (A рассматривается, scope не передаётся);
//   D — «Станок» без выбранного станка ОТКАЗЫВАЕТ, а не подменяет себя режимом «Все»;
//   E — intraDayImprovementOps({slitterId}) трогает только свой станок.
//
// Run with: node experiments/atex-pp-4642-order-scope.test.js

process.env.TZ = 'UTC';
global.window = { db: 'ateh', xsrf: 'x' };

var fs = require('fs');
var path = require('path');

// Минимальный DOM-стаб: подтверждающая плашка строится через el() (см. issue-3411-search.test.js).
function StubNode(tag) {
    this.tagName = String(tag || '').toUpperCase();
    this.childNodes = []; this.attributes = {}; this.dataset = {}; this.style = {};
    this.className = ''; this.textContent = ''; this.disabled = false;
}
StubNode.prototype.appendChild = function (n) { this.childNodes.push(n); n.parentNode = this; return n; };
StubNode.prototype.removeChild = function (n) {
    this.childNodes = this.childNodes.filter(function (c) { return c !== n; }); return n;
};
StubNode.prototype.setAttribute = function (k, v) { this.attributes[k] = String(v); };
StubNode.prototype.addEventListener = function () {};
StubNode.prototype.querySelector = function () { return null; };
StubNode.prototype.querySelectorAll = function () { return []; };
global.document = {
    readyState: 'complete',
    // Корня рабочего места нет — api.init() при загрузке модуля молча выходит.
    getElementById: function () { return null; },
    addEventListener: function () {},
    createElement: function (tag) { return new StubNode(tag); },
    createTextNode: function (t) { var n = new StubNode('#text'); n.textContent = String(t); return n; }
};

var mod = require('../download/atex/js/production-planning.js');
var Controller = mod.Controller;

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

var ctrlSrc = fs.readFileSync(path.join(__dirname, '..', 'download', 'atex', 'js',
    'production-planning', '20-controller.js'), 'utf8');
var cssSrc = fs.readFileSync(path.join(__dirname, '..', 'download', 'atex', 'css',
    'production-planning.css'), 'utf8');

// ── A. РАЗМЕТКА ────────────────────────────────────────────────────────────────────────────────
(function () {
    assert(/atex-pp-order-title'?,?\s*text:\s*'Упорядочить'/.test(ctrlSrc.replace(/\s+/g, ' '))
        || /class:\s*'atex-pp-order-title',\s*text:\s*'Упорядочить'/.test(ctrlSrc),
        'A1 «Упорядочить» — подпись группы (span), нажимать её нечего');
    assert(!/text:\s*'Упорядочить'\s*,[\s\S]{0,200}?addEventListener/.test(ctrlSrc),
        'A2 на подписи нет обработчика клика');
    assert(/atex-pp-order-one'[^)]*text:\s*'Станок'/.test(ctrlSrc), 'A3 есть кнопка «Станок»');
    assert(/atex-pp-order-all'[^)]*text:\s*'Все'/.test(ctrlSrc), 'A4 есть кнопка «Все»');
    assert(/optimizeQueue\(queueActions,\s*\{\s*slitterId:\s*self\.activeSlitterId\(\)\s*\}\)/.test(ctrlSrc),
        'A5 «Станок» зовёт упорядочивание с id АКТИВНОЙ вкладки');
    assert(/orderAllBtn\.addEventListener\('click',\s*function\(\)\s*\{\s*self\.optimizeQueue\(queueActions\);/.test(ctrlSrc),
        'A6 «Все» зовёт прежнее упорядочивание без области действия');
    assert(/text:\s*'Добавить'\s*\}/.test(ctrlSrc) && !/text:\s*'Добавить вручную'/.test(ctrlSrc),
        'A7 «Добавить вручную» переименована в «Добавить»');
    // Части обязаны быть СМЕЖНЫМИ: группа склеивает их одной рамкой, кнопки свою теряют.
    assert(/\.atex-pp-order-group\s*\{[^}]*display:\s*inline-flex/.test(cssSrc),
        'A8 CSS: группа — inline-flex (части встык)');
    assert(/\.atex-pp-order-group\s+\.atex-pp-btn\s*\{[^}]*border-radius:\s*0/.test(cssSrc),
        'A9 CSS: у кнопок внутри группы своих скруглений нет — рамка общая');
    // Гашение панели под непринятым планом (#4402) ловит кнопки по .atex-pp-btn — класс сохранён.
    assert(/atex-pp-order-one/.test(ctrlSrc) && /atex-pp-btn atex-pp-order-queue atex-pp-order-one/.test(ctrlSrc),
        'A10 кнопки остались .atex-pp-btn — предпросмотр их гасит, как прежде (#4402)');
    assert(/is-plan-preview \.atex-pp-order-title/.test(cssSrc),
        'A11 под непринятым планом гаснет и подпись — иначе она читалась бы как живая кнопка');
    // Порядок частей — тот, что просил заказчик: «Упорядочить | Станок | Все».
    var order = ctrlSrc.slice(ctrlSrc.indexOf('atex-pp-order-group'));
    var iTitle = order.indexOf('atex-pp-order-title');
    var iOne = order.indexOf('orderGroup.appendChild(orderOneBtn)');
    var iAll = order.indexOf('orderGroup.appendChild(orderAllBtn)');
    assert(iTitle > -1 && iOne > iTitle && iAll > iOne,
        'A12 части идут в порядке «Упорядочить | Станок | Все»');
    // Ряд кнопок панели получает ГРУППУ, а не три кнопки врозь.
    assert(/queueActions\.appendChild\(orderGroup\)/.test(ctrlSrc),
        'A13 в панель добавлена группа целиком (части не разъедутся по ряду)');
})();

// ── Стенд для runOptimizeQueue: подменяем всё, что считает и пишет ─────────────────────────────
function stand(opts) {
    var self = Object.create(Controller.prototype);
    var log = { built: [], reassignCalls: 0, intraArgs: [], preview: null, notes: [] };
    self.busy = false;
    self.setBusy = function (v) { self.busy = !!v; };
    self.notify = function (m, k) { log.notes.push({ msg: m, kind: k }); };
    self.slitters = [{ id: '1277', label: 'Станок 1' }, { id: '1285', label: 'Станок 4' }];
    self.cuts = [{ id: 'c1', slitter: { id: '1277' } }, { id: 'c2', slitter: { id: '1285' } }];
    self.filter = { date: '2026-08-07', dateTo: '2026-08-11' };
    self.plannedTailSetup = {};
    // Мерки: текущий план хуже кандидата B ровно на 10 мин переналадки → выбор падёт на B.
    self.planChangeoverMin = function (cuts, ops) { return ops ? 90 : 100; };
    self.planLatenessDays = function () { return 0; };
    self.planDowntimeConflicts = function () { return []; };
    self.planUnderfilledDays = function () { return []; };
    self.capacityBreaksStored = function () { return 0; };
    self.optimizeWindowLabel = function () { return '07.08.2026 – 11.08.2026'; };
    self.fillOptimizeMovesTrace = function () {};
    self.planAuditMessage = function () { return { shown: [], rest: 0 }; };
    self.buildSequenceOps = function (cuts, strategy, preserveOrder, moveScope) {
        log.built.push({ preserveOrder: preserveOrder, moveScope: moveScope || null });
        return { ops: { updates: [{ cutId: 'c1', planStartTs: 1786078800, plannedRuns: 5 }],
                        creates: [], deletes: [], ruleBreaks: [] },
                 cutsById: { c1: { id: 'c1', planDate: '1786000000', plannedRuns: 4 } } };
    };
    self.computeReassignmentPlan = function () {
        log.reassignCalls++;
        return { changed: false, slitterByRecordId: {} };
    };
    self.intraDayImprovementOps = function (o) { log.intraArgs.push(o || null); return { updates: [], gainMin: 0 }; };
    self.startPlanPreview = function (p) { log.preview = p; };
    for (var k in (opts || {})) self[k] = opts[k];
    return { self: self, log: log };
}

// ── B. РЕЖИМ «СТАНОК» ──────────────────────────────────────────────────────────────────────────
(function () {
    var s = stand();
    s.self.runOptimizeQueue({ slitterId: '1285' });
    assertEqual(s.log.built.map(function (b) { return b.moveScope; }),
        [{ withinSlitterIds: ['1285'] }],
        'B1 кандидат B строится с withinSlitterIds выбранного станка (#4225)');
    assert(s.log.reassignCalls === 0,
        'B2 переназначение станков (кандидат A) НЕ считается вовсе — миграции быть не должно',
        '(вызовов ' + s.log.reassignCalls + ')');
    assertEqual(s.log.intraArgs, [{ slitterId: '1285' }],
        'B3 кандидат C (перестановка внутри дней) сужен тем же станком');
    assert(s.log.preview && String(s.log.preview.slitterId) === '1285',
        'B4 предпросмотр несёт рамки режима — полировка не выйдет за станок',
        '(' + (s.log.preview && s.log.preview.slitterId) + ')');
})();

// ── C. РЕЖИМ «ВСЕ» — КАК ПРЕЖДЕ ────────────────────────────────────────────────────────────────
(function () {
    var s = stand();
    s.self.runOptimizeQueue();
    assertEqual(s.log.built.map(function (b) { return b.moveScope; }), [null],
        'C1 кандидат B строится БЕЗ области действия (весь горизонт)');
    assert(s.log.reassignCalls === 1, 'C2 переназначение станков рассматривается, как раньше',
        '(вызовов ' + s.log.reassignCalls + ')');
    assertEqual(s.log.intraArgs, [null], 'C3 кандидат C считается по всем станкам');
    assert(s.log.preview && !s.log.preview.slitterId, 'C4 предпросмотр без рамок станка');

    // Пустой slitterId = тот же режим «Все» (метод зовут и из тестов — нормализация одна).
    var s2 = stand();
    s2.self.runOptimizeQueue({ slitterId: '' });
    assertEqual(s2.log.built.map(function (b) { return b.moveScope; }), [null],
        'C5 пустой станок — это режим «Все», а не «пересборка ничего»');
})();

// ── D. «СТАНОК» БЕЗ ВЫБРАННОГО СТАНКА — ОТКАЗ, А НЕ ПОДМЕНА РЕЖИМА ─────────────────────────────
(function () {
    var s = stand();
    var confirmed = 0;
    s.self.confirmAction = function () { confirmed++; };
    s.self.root = null;
    s.self.optimizeQueue(null, { slitterId: '' });
    assert(confirmed === 0, 'D1 подтверждение не показано — упорядочивать нечего');
    assert(s.log.built.length === 0, 'D2 пересборка не запускалась');
    assert(s.log.notes.length === 1 && /Станок не выбран/.test(s.log.notes[0].msg),
        'D3 оператору сказано, почему ничего не произошло',
        '(' + (s.log.notes[0] && s.log.notes[0].msg) + ')');

    // А с выбранным станком — подтверждение с ЕГО именем.
    var s2 = stand();
    var shown = null;
    s2.self.confirmAction = function (msg, host, actions) { shown = { msg: msg, actions: actions }; };
    s2.self.root = null;
    s2.self.optimizeQueue(null, { slitterId: '1285' });
    assert(shown && /Станок 4/.test(String((shown.msg && shown.msg.textContent) || '')),
        'D4 в подтверждении назван станок',
        '(' + (shown && shown.msg && shown.msg.textContent) + ')');
    assert(shown && shown.actions && shown.actions[0] && shown.actions[0].label === 'Упорядочить станок',
        'D5 кнопка подтверждения говорит, что именно упорядочиваем');
})();

// ── E. intraDayImprovementOps СУЖАЕТСЯ СТАНКОМ ─────────────────────────────────────────────────
// Сценарий #4440 (15→15→8→15→8→18 ножей — четыре смены вместо двух), ПОВТОРЁННЫЙ на двух станках:
// улучшать есть что на обоих. Без сужения метод чинит оба, с сужением — только названный.
(function () {
    var BASE = new Date(2026, 7, 7, 0, 0, 0, 0).getTime();
    var TIMES = { KNIFE: 30, MATERIAL_WINDING: 15, KNIFE_MOVE: 0, BETWEEN_CUTS: 2, CLEANUP_SHIFT: 30 };
    function ts(minute) { return String(Math.floor(BASE / 1000) + minute * 60); }
    function widths(n, w) { var a = []; for (var i = 0; i < n; i++) a.push(w); return a; }
    function cut(id, sid, minute, knives, mat, k) {
        var runs = 10, mins = Math.ceil(runs * 1.2) + 2 * runs;
        return { id: id, orderId: 'O' + id, firstPartId: id, slitter: { id: sid, label: 'Станок ' + sid },
            materialId: mat, winding: 'OUT', batchId: '', knifeWidths: widths(knives, 900 / knives),
            knifeCount: knives, rollerWidth: 60, plannedRuns: runs, isFoil: false, length: 300,
            status: '', startDate: '', endDate: '', fixed: false,
            planDate: ts(minute), number: ts(minute), duration: String(Math.ceil(runs * 1.2)),
            storedKnifeSetupMin: String(k == null ? 30 : k), storedMaterialWindingMin: '15',
            storedCutAndLeaderMin: String(mins) };
    }
    function dayOf(sid) {
        return [cut(sid + 'a', sid, 480, 15, 'MW411', 0), cut(sid + 'b', sid, 620, 15, 'MR194', 0),
                cut(sid + 'c', sid, 670, 8, 'MW411'),     cut(sid + 'd', sid, 790, 15, 'MWR200'),
                cut(sid + 'e', sid, 900, 8, 'MR194'),     cut(sid + 'f', sid, 970, 18, 'MW308')];
    }
    function makeSelf() {
        var self = Object.create(Controller.prototype);
        self.cuts = dayOf('1277').concat(dayOf('1285'));
        self.changeTimes = TIMES; self.opTimes = { WIND_300: 1.2 };
        self.daySettings = { DAY_START_HOUR: '8:00', DAY_END_HOUR: '16:30', LUNCH_START: '12:20',
            LUNCH_DURATION: '40', TOTAL_INTERVALS: '20', MAX_OVERWORK_CUTS_MN: '5',
            MAX_OVERWORK_TUNE_MN: '10', SLOT_PLACEMENT: '1' };
        self.filter = { date: '2026-08-07', dateTo: '2026-08-11' };
        self.supplies = []; self.genPositions = []; self.footageBySupply = {}; self.positionLengthById = {};
        self.slitters = [{ id: '1277', label: 'Станок 1' }, { id: '1285', label: 'Станок 4' }];
        self.downtimesBySlitter = {}; self.calendarByDay = {}; self.freezeByDay = {};
        self.meta = { cut: { id: '1078', reqs: [] }, calendar: { id: '1' }, freeze: null };
        self.nowMs = function () { return BASE; };
        self.prevSetupBySlitter = {};
        return self;
    }
    function machinesOf(res) {
        var m = {};
        (res.updates || []).forEach(function (u) { m[String(u.cutId).slice(0, 4)] = true; });
        return Object.keys(m).sort();
    }

    var all = makeSelf().intraDayImprovementOps();
    assertEqual(machinesOf(all), ['1277', '1285'],
        'E1 без сужения чинятся ОБА станка (улучшать есть что на каждом)');

    var one = makeSelf().intraDayImprovementOps({ slitterId: '1285' });
    assert((one.updates || []).length > 0, 'E2 на выбранном станке улучшение найдено',
        '(правок ' + (one.updates || []).length + ')');
    assertEqual(machinesOf(one), ['1285'], 'E3 правки ТОЛЬКО выбранного станка — соседа не тронули');
    assertEqual(Object.keys(one.gainByMachine || {}), ['1285'], 'E4 и выигрыш посчитан только по нему');
})();

console.log('\n' + passed + '/' + total + ' проверок пройдено');
if (passed !== total) process.exit(1);
