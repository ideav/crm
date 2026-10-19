// #5196 — «Счётчик нач.» джамбо берётся из остатка партии, а не из прошлой записи этого
// джамбо (боевое 16.10, Станок 4, джамбо 09260124-0535-1). Задание 960075 резало два рулона:
// запись джамбо закончилась на 15199, а «Счётчик кон.» задания = 17000 − погонаж по ОБОИМ
// рулонам = 11299 ушёл в «Остаток, м» партии. Следующее задание 960603 завело тот же джамбо
// с 11299 (−3900 м), задание 963542 — с 5595 вместо ≈9495: 12 резок по 600 «не влезли».
//
// Правило: «Счётчик нач.» новой записи джамбо = остаток ЭТОГО джамбо — «Счётчик кон.»
// его последней записи по номеру (любого задания), у записи без отметок — её «Счётчик нач.».
// Записей с номером нет — прежний порядок (начало задания / «Счётчик кон.» предыдущей
// записи задания, #4914). Начало, вписанное оператором, не перебивается.
//
// Run with: node experiments/atex-slitter-5196-jumbo-start-by-number.test.js

process.env.TZ = 'UTC';

// ── Минимальный DOM-стаб (как в atex-slitter-4914-jumbo-tabs.test.js) ──
function StubNode(tag) {
    this.tagName = String(tag || '').toUpperCase();
    this.childNodes = []; this.attributes = {}; this.dataset = {}; this.style = {};
    this._className = ''; this._text = ''; this._listeners = {}; this.value = ''; this.disabled = false; this.options = [];
    var self = this;
    this.classList = {
        add: function(c) { if (self._classes().indexOf(c) === -1) self._className = (self._className + ' ' + c).trim(); },
        remove: function(c) { self._className = self._classes().filter(function(x) { return x !== c; }).join(' '); },
        contains: function(c) { return self._classes().indexOf(c) !== -1; },
        toggle: function(c, force) {   // setBusy переключает is-busy
            var has = self.classList.contains(c);
            var want = force === undefined ? !has : !!force;
            if (want && !has) self.classList.add(c);
            if (!want && has) self.classList.remove(c);
        }
    };
}
StubNode.prototype._classes = function() { return this._className.split(/\s+/).filter(Boolean); };
Object.defineProperty(StubNode.prototype, 'className', { get: function() { return this._className; }, set: function(v) { this._className = String(v || ''); } });
Object.defineProperty(StubNode.prototype, 'textContent', {
    get: function() { if (this.childNodes.length) return this.childNodes.map(function(c) { return c.textContent; }).join(''); return this._text; },
    set: function(v) { this._text = String(v == null ? '' : v); this.childNodes = []; } });
StubNode.prototype.appendChild = function(n) { this.childNodes.push(n); n.parentNode = this; return n; };
StubNode.prototype.setAttribute = function(k, v) { this.attributes[k] = String(v); };
StubNode.prototype.getAttribute = function(k) { return this.attributes[k] == null ? null : this.attributes[k]; };
StubNode.prototype.addEventListener = function(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); };
StubNode.prototype._all = function(acc) { this.childNodes.forEach(function(c) { if (c instanceof StubNode) { acc.push(c); c._all(acc); } }); return acc; };
StubNode.prototype.querySelectorAll = function(sel) { var cls = sel.replace(/^\./, ''); return this._all([]).filter(function(n) { return n.classList.contains(cls); }); };
StubNode.prototype.querySelector = function(sel) { return this.querySelectorAll(sel)[0] || null; };

global.document = {
    createElement: function(tag) { return new StubNode(tag); },
    createTextNode: function(t) { var n = new StubNode('#text'); n._text = String(t == null ? '' : t); return n; },
    body: new StubNode('body'), readyState: 'loading', getElementById: function() { return null; }, addEventListener: function() {}
};
global.window = { db: 'testdb' };

var slitter = require('../download/atex/js/slitter.js');
var Controller = slitter.Controller;

var passed = 0;
function assertEqual(actual, expected, name) {
    var a = JSON.stringify(actual), e = JSON.stringify(expected);
    var ok = a === e;
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name + (ok ? '' : ' (ожидалось ' + e + ', получено ' + a + ')'));
    if (ok) passed++; else process.exitCode = 1;
}

var core = slitter.core;

// ── Боевая схема 82374 «Номер джамбо» (как в atex-slitter-4914) ──
var JUMBO_82374 = {
    id: '82374',
    reqs: [
        { id: '82376', val: 'Начальная длина, м' },
        { id: '791706', val: 'Счётчик нач.' },
        { id: '82378', val: 'Кол-во резок' },
        { id: '791707', val: 'Счётчик кон.' },
        { id: '82380', val: 'Конечная длина, м' },
        { id: '82382', val: 'Рабочий расход, м' },
        { id: '82384', val: 'К списанию, м' },
        { id: '82386', val: 'Брак, м' },
        { id: '791708', val: 'Брак, шт' },
        { id: '791712', val: 'Фото брака' }
    ]
};

// Строка object/82374/?JSON_OBJ: r[0] — номер, далее реквизиты в порядке reqs.
function jumboObj(id, taskId, no, start, cuts, end) {
    return { i: id, u: taskId, r: [no, '', start, cuts, end, '', '', '', '', '', ''] };
}

// Боевые записи джамбо 09260124-0535-1 на 16.10 (и чужой номер рядом).
var BATTLE_ROWS = [
    jumboObj('969899', '960075', '10260124-0013-1', '4136', '13', '236'),
    jumboObj('969999', '960075', '09260124-0535-1', '17000', '6', '15199')
];

function makeController(rows, opts) {
    opts = opts || {};
    var root = new StubNode('div');
    root.attributes['data-db'] = 'testdb';
    var c = new Controller(root);
    c.db = 'testdb';
    c.meta = { jumboTable: JUMBO_82374 };
    c.notices = [];
    c.notify = function(msg, kind) { c.notices.push({ msg: msg, kind: kind }); };
    c.render = function() {};
    c.posts = [];
    c.gets = [];
    c.post = function(path, fields) {
        c.posts.push({ path: path, fields: fields });
        return Promise.resolve({ obj: String(980000 + c.posts.length) });
    };
    c.getJson = function(path) {
        c.gets.push(path);
        if (opts.failGet) return Promise.reject(new Error('сеть'));
        var m = /F_82374=([^&]*)/.exec(path);
        var no = m ? decodeURIComponent(m[1]) : null;
        // фильтр сервера по главному значению; без фильтра — все строки
        return Promise.resolve((rows || []).filter(function(r) { return no == null || r.r[0] === no; }));
    };
    return c;
}

function newJumboPost(c) {
    return c.posts.filter(function(p) { return /^_m_new\/82374/.test(p.path); }).pop() || null;
}

// ── 1. core: остаток джамбо по его записям ──
(function() {
    var recs = core.jumbosFromObjects(JUMBO_82374, [
        jumboObj('969999', '960075', '09260124-0535-1', '17000', '6', '15199'),
        jumboObj('970051', '960603', '09260124-0535-1', '15199', '19', '9495'),
        jumboObj('970166', '963542', '09260124-0535-1', '9495', '', ''),
        jumboObj('969899', '960075', '10260124-0013-1', '4136', '13', '236')
    ]);
    assertEqual(core.jumboLastCounter(recs.slice(0, 2), '09260124-0535-1'), '9495',
        '#5196: остаток джамбо — «Счётчик кон.» его записи с наибольшим id');
    assertEqual(core.jumboLastCounter(recs, '09260124-0535-1'), '9495',
        '#5196: у последней записи без отметок остаток — её «Счётчик нач.»');
    assertEqual(core.jumboLastCounter(recs, '10260124-0013-1'), '236',
        '#5196: записи чужого номера не смешиваются');
    assertEqual(core.jumboLastCounter(recs, 'НОВЫЙ'), '',
        '#5196: номер не встречался — остатка нет');
    assertEqual(core.jumboLastCounter(recs.slice(2).reverse(), '09260124-0535-1'), '9495',
        '#5196: последняя запись — по id, а не по порядку строк');
})();

// ── 2. боевое: задание 960603, первая запись джамбо, начало задания — из партии ──
function battleFirstRecord() {
    var c = makeController(BATTLE_ROWS);
    var cut = { id: '960603', counterStart: '11299', counterStartFromBatch: true, jumbos: [], jumboActive: 0,
                pendingJumbo: { id: '', jumboNo: '09260124-0535-1', counterStart: '' } };
    c.currentCut = cut;
    return c.ensureJumboRecord(cut).then(function() {
        var p = newJumboPost(c);
        assertEqual(p && String(p.fields['t791706']), '15199',
            '#5196: боевое 960603 — «Счётчик нач.» записи = «Счётчик кон.» прошлой записи джамбо (15199, не 11299)');
        assertEqual(String(cut.counterStart), '15199',
            '#5196: подставленное из партии начало задания заменено остатком джамбо');
    });
}

// ── 3. начало, вписанное оператором, не перебивается ──
function operatorStartKept() {
    var c = makeController(BATTLE_ROWS);
    var cut = { id: '960603', counterStart: '14000', jumbos: [], jumboActive: 0,
                pendingJumbo: { id: '', jumboNo: '09260124-0535-1', counterStart: '' } };
    c.currentCut = cut;
    return c.ensureJumboRecord(cut).then(function() {
        var p = newJumboPost(c);
        assertEqual(p && String(p.fields['t791706']), '14000',
            '#5196: «Счётчик нач.», вписанный оператором, остаётся');
    });
}

// ── 4. новый номер — как прежде, из начала задания ──
function unknownNumberFirst() {
    var c = makeController(BATTLE_ROWS);
    var cut = { id: '960603', counterStart: '11299', counterStartFromBatch: true, jumbos: [], jumboActive: 0,
                pendingJumbo: { id: '', jumboNo: 'НОВЫЙ-1', counterStart: '' } };
    c.currentCut = cut;
    return c.ensureJumboRecord(cut).then(function() {
        var p = newJumboPost(c);
        assertEqual(p && String(p.fields['t791706']), '11299',
            '#5196: номер не встречался — начало из начала задания, как прежде');
    });
}

// ── 5. «+ Джамбо»: второй рулон задания, номер уже резали ──
function addKnownJumbo() {
    var rows = BATTLE_ROWS.concat([jumboObj('950001', '940000', '09260124-0777-1', '17000', '10', '14000')]);
    var c = makeController(rows);
    var prev = core.jumbosFromObjects(JUMBO_82374, [BATTLE_ROWS[0]])[0];
    var cut = { id: '960075', counterStart: '4136', jumbos: [prev], jumboActive: 0 };
    c.currentCut = cut;
    return c.addJumbo(cut, '09260124-0777-1').then(function() {
        var p = newJumboPost(c);
        assertEqual(p && String(p.fields['t791706']), '14000',
            '#5196: «+ Джамбо» с известным номером — остаток этого джамбо, а не «Счётчик кон.» прошлого рулона (236)');
    });
}

// ── 6. «+ Джамбо» с новым номером — #4914 как прежде ──
function addUnknownJumbo() {
    var c = makeController(BATTLE_ROWS);
    var prev = core.jumbosFromObjects(JUMBO_82374, [BATTLE_ROWS[0]])[0];
    var cut = { id: '960075', counterStart: '4136', jumbos: [prev], jumboActive: 0 };
    c.currentCut = cut;
    return c.addJumbo(cut, 'НОВЫЙ-2').then(function() {
        var p = newJumboPost(c);
        assertEqual(p && String(p.fields['t791706']), '236',
            '#4914: новый номер — «Счётчик кон.» предыдущей записи задания');
    });
}

// ── 7. записи джамбо не прочитались — запись всё равно заводится, ошибка видна ──
function lookupFails() {
    var c = makeController(BATTLE_ROWS, { failGet: true });
    var origError = console.error;
    var errors = [];
    console.error = function() { errors.push([].slice.call(arguments).join(' ')); };
    var cut = { id: '960603', counterStart: '11299', counterStartFromBatch: true, jumbos: [], jumboActive: 0,
                pendingJumbo: { id: '', jumboNo: '09260124-0535-1', counterStart: '' } };
    c.currentCut = cut;
    return c.ensureJumboRecord(cut).then(function() {
        console.error = origError;
        var p = newJumboPost(c);
        assertEqual(p && String(p.fields['t791706']), '11299',
            '#5196: чтение записей упало — начало как прежде, запись заведена');
        assertEqual(errors.some(function(e) { return /5196/.test(e); }), true,
            '#5196: сбой чтения не молчит (console.error)');
    }, function(err) { console.error = origError; throw err; });
}

battleFirstRecord()
    .then(operatorStartKept)
    .then(unknownNumberFirst)
    .then(addKnownJumbo)
    .then(addUnknownJumbo)
    .then(lookupFails)
    .then(function() { console.log('\n' + passed + ' проверок прошло'); })
    .catch(function(err) { console.log('FAIL — исключение: ' + (err && err.stack || err)); process.exitCode = 1; });
