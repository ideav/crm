// Tests for ideav/crm#4426 — «дать возможность добавить позицию заказа в задание».
//
// Задание №5 (MW412, 450 м, OUT) резало две полосы: 110 мм — в заказ 4385, 152 мм — «ОТХОДЫ».
// Позиция 4385 · 152мм * 450м в планировании ЕСТЬ (её видно в форме нового задания), но
// добавить её в уже существующее задание с панели «Связанные позиции» было нечем: панель
// умела только отвязывать. Теперь у панели есть «+ позиция»:
//   • кандидат ложится на СВОБОДНУЮ «Партию ГП» задания той же ширины (cutPositionFit);
//   • номенклатура обязана совпасть: сырьё + метраж рулона + намотка;
//   • непроходные позиции того же сырья видны с ПРИЧИНОЙ (нет свободной полосы, не
//     согласована, уже обеспечена) — молча прятать их нельзя;
//   • «Партия ГП» перестаёт быть складской: «Кол-во рулонов» (спрос) += рулоны обеспечения,
//     «ID заказа» дополняется заказом позиции (как у генерации #3433 и слияния #4424).
//
// Run with: node experiments/atex-4426-add-position-to-task.test.js

process.env.TZ = 'Europe/Moscow';

// ── Минимальный DOM-стаб (как в atex-4424-merge-order-tasks.test.js) ──
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
// Обход дерева: все узлы с данным классом / первый узел с данным текстом.
function walk(node, out) {
    out = out || [];
    out.push(node);
    (node.childNodes || []).forEach(function(c) { walk(c, out); });
    return out;
}
function byClass(node, cls) { return walk(node).filter(function(n) { return n.classList && n.classList.contains(cls); }); }
function texts(node, cls) { return byClass(node, cls).map(function(n) { return n.textContent; }); }

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

// ── Данные задания №5 из #4426 ──────────────────────────────────────────────
// MW412, джамбо 891 мм, 3 прохода: 152 мм × 5 полос (отходы) + 110 мм × 1 полоса (заказ 4385).
var CUT = { id: '5', number: '1785000000', materialId: 'MW412', materialName: 'MW412',
    winding: 'OUT', length: 450, plannedRuns: 3, knifeCount: 6 };
var FREE = [{ id: 'b152', width: 152, rolls: 15 }];   // свободна только полоса 152 мм (5 × 3)
function pos(over) {
    var p = { id: 'p152', materialId: 'MW412', width: 152, orderWidth: 152, qty: 100, length: 450,
        windDir: 'OUT', windLength: 450, approved: true, orderId: '4385' };
    for (var k in (over || {})) p[k] = over[k];
    return p;
}

// ── 1) cutPositionFit: ключевой сценарий и все причины отказа ───────────────
(function () {
    var fit = planning.cutPositionFit(pos(), CUT, FREE, 100);
    assertEqual([fit.ok, fit.strip && fit.strip.id, fit.rolls], [true, 'b152', 15],
        '#4426: позиция 4385 · 152мм ложится на свободную полосу 152 мм — 15 рул. (5 полос × 3 прохода)');

    // Остаток позиции меньше рулонов полосы — берём не больше 110% остатка (правило #3320).
    assertEqual(planning.cutPositionFit(pos(), CUT, FREE, 10).rolls, 11,
        'обеспечиваем не больше 110% необеспеченного остатка');

    assertEqual(planning.cutPositionFit(pos(), CUT, FREE, 0).reason, 'уже обеспечена полностью',
        'позиция без остатка не предлагается — с причиной');
    assertEqual(planning.cutPositionFit(pos({ approved: false }), CUT, FREE, 100).reason, 'позиция не согласована',
        'несогласованную позицию в производство не берём');
    assertEqual(planning.cutPositionFit(pos({ materialId: 'MW411' }), CUT, FREE, 100).reason, 'другое сырьё',
        'другое сырьё — задание его физически не произведёт');
    assertEqual(planning.cutPositionFit(pos({ length: 300, windLength: 300 }), CUT, FREE, 100).reason,
        'другой метраж рулона (задание 450 м, позиция 300 м)',
        'другой метраж рулона — с числами в причине');
    assertEqual(planning.cutPositionFit(pos({ windDir: 'IN' }), CUT, FREE, 100).reason, 'другая намотка (OUT ≠ IN)',
        'другая намотка');
    assertEqual(planning.cutPositionFit(pos({ width: 130, orderWidth: 130 }), CUT, FREE, 100).reason,
        'нет свободной полосы 130 мм',
        'ширины нет среди свободных полос — так и говорим (полосу надо добавить в «Полосы»)');
    assertEqual(planning.cutPositionFit(pos(), CUT, [], 100).reason, 'нет свободной полосы 152 мм',
        'все полосы задания уже обеспечены — добавлять некуда');
    assertEqual(planning.cutPositionFit(pos(), { materialId: '', winding: 'OUT', length: 450 }, FREE, 100).reason,
        'у задания не определено сырьё',
        'сырьё задания неизвестно — не гадаем, а говорим');
    // Ширина сверяется по ФАКТИЧЕСКОЙ ширине реза (#3372) и терпит «152,00»/152.
    assertEqual(planning.cutPositionFit(pos(), CUT, [{ id: 'b152', width: '152,00', rolls: 15 }], 100).ok, true,
        'ширина полосы «152,00» из БД — та же полоса');
})();

// ── Стенд контроллера ───────────────────────────────────────────────────────
var FB_TABLE = '1081', SUP_TABLE = '1075';
var REQ = { fbWidth: 'w', fbStrips: 's', fbRolls: 'r', fbPlanned: 'p', fbOrder: 'o',
    supBatch: 'sb', supRolls: 'sr', supFootage: 'sf', supActive: 'sa', supStatus: 'ss' };
function makeController(strips, supplies, positions) {
    var c = Object.create(Controller.prototype);
    c.cuts = [CUT];
    c.supplies = supplies || [];
    c.genPositions = positions || [];
    c.positions = (positions || []).map(function (p) {
        return { id: p.id, label: p.orderId + ' · ' + p.width + 'мм * ' + p.length + 'м', width: p.width, length: p.length, qty: p.qty };
    });
    c.positionLengthById = {}; c.footageBySupply = {};
    c.meta = {
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
    c.loadPlanning = function () { c.loaded = (c.loaded || 0) + 1; return Promise.resolve(); };
    c.posts = [];
    c.post = function (path, fields) { c.posts.push({ path: path, fields: fields || {} }); return Promise.resolve({ obj: 'newSup' }); };
    c.getJson = function (path) {
        // Партии ГП задания (F_U) и одна партия по id (F_I). r[0] — главное значение записи.
        var byId = /F_I=([^&]+)/.exec(path);
        var rows = strips.map(function (s) {
            return { i: s.id, r: ['', s.width, s.strips, s.rolls == null ? '' : s.rolls, s.planned == null ? '' : s.planned, s.orderId || ''] };
        });
        if (byId) {
            var id = decodeURIComponent(byId[1]);
            rows = rows.filter(function (r) { return String(r.i) === id; });
        }
        return Promise.resolve(rows);
    };
    return c;
}
var STRIPS = [
    { id: 'b152', width: '152', strips: '5', rolls: '', planned: '15', orderId: '' },     // отходы — свободна
    { id: 'b110', width: '110', strips: '1', rolls: '3', planned: '3', orderId: '4385' }  // уже в заказе
];
var SUPPLIES = [{ id: 's1', cutId: '5', finishedBatchId: 'b110', positionId: 'p110', rolls: 3 }];

// ── 2) freeStripsOfCut: свободна только полоса без обеспечения ──────────────
(function () {
    var c = makeController(STRIPS, SUPPLIES, [pos()]);
    var free = c.freeStripsOfCut([{ id: 'b152', width: '152', qty: '5' }, { id: 'b110', width: '110', qty: '1' }], 3);
    assertEqual(free, [{ id: 'b152', width: '152', rolls: 15 }],
        'свободна полоса, на которую не ссылается «Обеспечение»; рулоны = полос × проходов');
})();

// ── 3) Панель «Связанные позиции»: кнопка «+ позиция» ───────────────────────
(function () {
    var c = makeController(STRIPS, SUPPLIES, [pos()]);
    c.renderLink();
    var add = byClass(c.linkEl, 'atex-pp-linked-add');
    assertEqual(add.length, 1, '#4426: на панели «Связанные позиции» есть кнопка «+ позиция»');
    assertEqual(add[0].textContent, '+ позиция', 'подпись кнопки');
    var opened = [];
    c.openCutPositionPicker = function (cut) { opened.push(cut.id); };
    add[0].listeners.click[0]();
    assertEqual(opened, ['5'], 'клик открывает выбор позиции ДЛЯ ВЫБРАННОГО задания');

    // Задание без связей — кнопка всё равно есть (иначе пустое задание не наполнить).
    var c2 = makeController(STRIPS, [], [pos()]);
    c2.renderLink();
    assertEqual(byClass(c2.linkEl, 'atex-pp-linked-add').length, 1, 'кнопка есть и у задания без связей');
})();

// ── 4) Модалка выбора: подходящие, причины отказа, чужое сырьё ──────────────
(function () {
    var positions = [
        pos(),                                                          // подходит
        pos({ id: 'p130', width: 130, orderWidth: 130, orderId: '4277' }),  // нет свободной полосы 130
        pos({ id: 'pNo', approved: false, orderId: '4300' }),               // не согласована
        pos({ id: 'pAlien', materialId: 'MW411', orderId: '4283' })         // другое сырьё — вне списка
    ];
    var c = makeController(STRIPS, SUPPLIES, positions);
    c.openCutPositionPicker(CUT);
    setTimeout(function () {
        var modal = c.root.childNodes[0];
        var items = byClass(modal, 'atex-pp-supply-item');
        assertEqual(items.length, 1, 'в списке ровно одна подходящая позиция');
        assert(items[0].textContent.indexOf('4385') >= 0 && items[0].textContent.indexOf('полоса 152 мм · 15 рул.') >= 0,
            'у позиции показано, на какую полосу она ляжет и сколько рулонов обеспечит');

        var rejects = byClass(modal, 'atex-pp-supply-reject').map(function (n) { return n.textContent; });
        assertEqual(rejects.length, 2, 'непроходные позиции ТОГО ЖЕ сырья показаны, а не спрятаны');
        assert(rejects.some(function (t) { return /4277/.test(t) && /нет свободной полосы 130 мм/.test(t); }),
            'причина «нет свободной полосы 130 мм» — видна');
        assert(rejects.some(function (t) { return /4300/.test(t) && /не согласована/.test(t); }),
            'причина «позиция не согласована» — видна');

        var hints = texts(modal, 'atex-pp-hint').join('\n');
        assert(/другого сырья \(1\)|Позиции другого сырья \(1\)/.test(hints),
            'позиции другого сырья не показаны, но посчитаны — диспетчер знает, почему их нет');
        assert(/свободных полос: 1 из 2/.test(hints), 'в шапке — сколько полос задания свободно');

        // Поиск фильтрует список, не пересоздавая поле ввода (иначе теряются фокус и каретка).
        var searchInput = walk(modal).filter(function (n) { return n.tagName === 'INPUT' && n.attributes.type === 'search'; })[0];
        assert(!!searchInput, 'в модалке есть поиск по номеру заказа/ширине');
        searchInput.value = '4277';
        searchInput.listeners.input[0]();
        assertEqual(byClass(modal, 'atex-pp-supply-item').length, 0, 'поиск «4277»: подходящих нет');
        assertEqual(byClass(modal, 'atex-pp-supply-reject').length, 1, 'поиск «4277»: осталась одна непроходная позиция');
        assert(walk(modal).indexOf(searchInput) >= 0, 'поле поиска пережило перерисовку списка');
        searchInput.value = '';
        searchInput.listeners.input[0]();
        items = byClass(modal, 'atex-pp-supply-item');
        assertEqual(items.length, 1, 'сброс поиска возвращает полный список');

        // Подтверждение → создание обеспечения.
        items[0].listeners.click[0]();
        var confirmVals = texts(modal, 'atex-pp-supply-confirm-value');
        assert(confirmVals.indexOf('15 рул.') >= 0, 'на подтверждении — сколько рулонов будет обеспечено');
        var okBtn = byClass(modal, 'atex-pp-btn-primary')[0];
        assertEqual(okBtn.textContent, 'Добавить позицию', 'кнопка подтверждения');
        okBtn.listeners.click[0]();
        setTimeout(function () {
            var sup = c.posts.filter(function (p) { return p.path.indexOf('_m_new/' + SUP_TABLE) === 0; });
            assertEqual(sup.length, 1, 'создано ОДНО «Обеспечение»');
            assert(/up=p152/.test(sup[0].path), 'обеспечение подчинено выбранной ПОЗИЦИИ (up=)');
            assertEqual(sup[0].fields['t' + REQ.supBatch], 'b152', 'ссылается на свободную «Партию ГП» 152 мм');
            assertEqual(String(sup[0].fields['t' + REQ.supRolls]), '15', 'рулонов — 15');

            // #4426: партия перестала быть складской.
            var mark = c.posts.filter(function (p) { return p.path.indexOf('_m_set/b152') === 0; });
            assertEqual(mark.length, 1, '«Партия ГП» помечена заказной одним _m_set');
            assertEqual(mark[0].fields['t' + REQ.fbRolls], '15', 'спрос партии = 0 + 15 рулонов обеспечения');
            assertEqual(mark[0].fields['t' + REQ.fbOrder], '4385', '«ID заказа» — заказ покрытой позиции');
            assert(c.notes.some(function (n) { return n.kind === 'success'; }), 'диспетчеру сказали, что связь создана');
            done();
        }, 0);
    }, 0);
})();

// ── 5) markFinishedBatchOrdered: спрос суммируется, заказы не дублируются ───
function tailChecks() {
    var c = makeController([{ id: 'b152', width: '152', strips: '5', rolls: '10', planned: '15', orderId: '4111' }], [], []);
    return c.markFinishedBatchOrdered('b152', 5, '4385').then(function () {
        var set = c.posts.filter(function (p) { return p.path.indexOf('_m_set/b152') === 0; })[0];
        assertEqual(set.fields['t' + REQ.fbRolls], '15', 'спрос партии += рулоны обеспечения (10 + 5)');
        assertEqual(set.fields['t' + REQ.fbOrder], '4111,4385', 'заказы копятся списком, как при слиянии (#4424)');
        var c2 = makeController([{ id: 'b152', width: '152', strips: '5', rolls: '10', planned: '15', orderId: '4385' }], [], []);
        return c2.markFinishedBatchOrdered('b152', 5, '4385').then(function () {
            var s2 = c2.posts.filter(function (p) { return p.path.indexOf('_m_set/b152') === 0; })[0];
            assertEqual(s2.fields['t' + REQ.fbOrder], '4385', 'тот же заказ второй раз в «ID заказа» не пишем');
        });
    }).then(function () {
        // #3431: у старой партии «Кол-во полос» пусто (полосы лежат в «Кол-во рулонов») —
        // спрос не трогаем, иначе у полосы уедет количество в редакторе.
        var cL = makeController([{ id: 'b152', width: '152', strips: '', rolls: '5', planned: '15', orderId: '' }], [], []);
        return cL.markFinishedBatchOrdered('b152', 15, '4385').then(function () {
            var set = cL.posts.filter(function (p) { return p.path.indexOf('_m_set/b152') === 0; })[0];
            assertEqual(set.fields['t' + REQ.fbRolls], undefined, 'старой партии спрос не прибавляем');
            assertEqual(set.fields['t' + REQ.fbOrder], '4385', 'но «ID заказа» ей ставим — партия больше не складская');
        });
    }).then(function () {
        // Нет реквизитов «Партии ГП» — обеспечение не рушим, но ОРЁМ (не молчим).
        var c3 = makeController([], [], []);
        c3.meta.finishedBatch = { id: FB_TABLE, reqs: [{ id: 'x', val: 'Ширина, мм' }] };
        return c3.markFinishedBatchOrdered('b152', 5, '4385').then(function (ok) {
            assertEqual(ok, false, 'нет реквизитов — метка не поставлена');
            assert(c3.notes.some(function (n) { return n.kind === 'warning'; }), 'и об этом предупредили тостом');
            assertEqual(c3.posts.length, 0, 'вслепую ничего не писали');
        });
    });
}

function done() {
    tailChecks().then(function () {
        console.log('\n' + passed + '/' + total + ' passed');
        if (passed !== total) process.exitCode = 1;
    });
}
