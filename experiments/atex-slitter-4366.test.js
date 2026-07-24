// #4366 — пульт слиттера: при завершении задания «Закончено» проставлялось, а галка
// «В работе» оставалась стоять.
//
// Корень: AtexSlitter.prototype.post ВЫБРАСЫВАЛ из тела запроса пустые значения
// (`params[k] !== ''`), а очистка реквизита в Integram — это ровно `t{req}=` с пустым
// значением. finishCut клал в поля `t{В работе}=''` → поле в тело не попадало → `_m_set`
// писал только «Закончено». Тем же молчанием страдали «Прекратить»/«Пропуск» (снятие
// «В работе»), «Возобновить» (очистка «Закончено»), «В работе» партии сырья и стирание
// показаний (Счётчик кон. / Брак / Примечания).
//
// Проверено на живой ateh, таблица 1078 («В работе» 1162 BOOLEAN, «Закончено» 16411 DATETIME):
//   _m_set t1168=600&t16411=…&t1162=   → «В работе» СНЯТА, «Закончено» проставлено
//   _m_set t1168=700&t16411=…          → «В работе» ОСТАЁТСЯ «X» (симптом тикета)
//   _m_set t1162=0                     → «В работе» СНЯТА
//   _m_set t16411=                     → «Закончено» СТЁРТО («Возобновить»)
//
// Фикс: post шлёт пустые значения (не пишем только undefined/null), булевы реквизиты
// снимаем нулём — как «Зафиксировано» в планировании (#3508).
//
// Run with: node experiments/atex-slitter-4366.test.js

process.env.TZ = 'Europe/Moscow';
var api = require('../download/atex/js/slitter.js');
var Controller = api.Controller;

var passed = 0, total = 0;
function assert(cond, name) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}

// Реквизиты 1078 (реальные id ateh): «Начато» 1161, «В работе» 1162 (BOOLEAN),
// «Закончено» 16411 (DATETIME), «Погонаж факт, м» 1168, «Примечания» 1171, «Брак, м» 8458,
// «Счётчик нач.» 1164, «Счётчик кон.» 1166.
var CUT_META = { id: '1078', reqs: [
    { id: '1156', val: 'Слиттер' }, { id: '1161', val: 'Начато' }, { id: '1162', val: 'В работе' },
    { id: '16403', val: 'Кол-во резок план' }, { id: '1164', val: 'Счётчик нач.' },
    { id: '1166', val: 'Счётчик кон.' }, { id: '1168', val: 'Погонаж факт, м' },
    { id: '1171', val: 'Примечания' }, { id: '8458', val: 'Брак, м' },
    { id: '16411', val: 'Закончено' }, { id: '24305', val: 'Метраж, м' }
] };
var BATCH_META = { id: '1074', reqs: [
    { id: '1123', val: 'Остаток, м²' }, { id: '8456', val: 'Остаток, м' }, { id: '16427', val: 'В работе' }
] };

// ── 1. post: пустое значение доезжает до сервера (тело запроса) ────────────────────────────────
(function() {
    var sent = [];
    global.fetch = function(url, opts) {
        sent.push({ url: url, body: opts.body });
        return Promise.resolve({ text: function() { return Promise.resolve('{"ok":1}'); } });
    };
    var inst = Object.create(Controller.prototype);
    inst.db = 'ateh';
    inst.root = { getAttribute: function() { return 'test-token'; } };
    inst.post('_m_set/90?JSON', { t1168: 600, t16411: '2026-07-24 15:00:00', t1162: '' });
    var body = sent[0].body;
    assert(/(^|&)t1162=($|&)/.test(body),
        '#4366: пустое значение реквизита попадает в тело запроса (t1162=)');
    assert(body.indexOf('t1168=600') !== -1 && body.indexOf('t16411=') !== -1,
        '#4366: непустые значения на месте');
    sent.length = 0;
    inst.post('_m_set/90?JSON', { t1168: 600, t1162: undefined, t16411: null });
    assert(sent[0].body.indexOf('t1162') === -1 && sent[0].body.indexOf('t16411') === -1,
        '#4366: undefined/null — реквизит НЕ трогаем (в тело не идёт)');
})();

// ── харнесс: инстанс с перехватом post ─────────────────────────────────────────────────────────
function makeInst(cut) {
    var inst = Object.create(Controller.prototype);
    inst.busy = false;
    inst.meta = { cut: CUT_META, batch: BATCH_META };
    inst.currentCut = cut;
    inst.currentCutId = cut.id;
    inst.cuts = [cut];
    inst.batches = [];
    inst.shiftEvents = [];
    inst.selectedSlitterId = 'm1';
    inst.selectedDate = '2026-07-24';
    inst.posts = [];
    inst.notes = [];
    inst.isCutLocked = function() { return false; };
    inst.eventDateTime = function() { return '2026-07-24 15:00:00'; };
    inst.notify = function(msg) { this.notes.push(msg); };
    inst.setBusy = function(v) { this.busy = v; };
    inst.post = function(path, params) { this.posts.push({ path: path, params: params }); return Promise.resolve({}); };
    inst.createEvent = function() { return Promise.resolve({}); };
    inst.loadEvents = function() { return Promise.resolve([]); };
    inst.loadCuts = function() { return Promise.resolve([]); };
    inst.loadBatches = function() { return Promise.resolve([]); };
    inst.applyEventStatuses = function() {};
    inst.recordActualRolls = function() { return Promise.resolve(); };
    inst.findBatch = function() { return null; };
    inst.advanceToNextCut = function() {};
    inst.render = function() {};
    return inst;
}
function fieldsOf(inst, idx) { return (inst.posts[idx || 0] || {}).params || {}; }

// ── 2. finishCut: «Закончено»=now И «В работе»=0 в одном _m_set ────────────────────────────────
(function() {
    var inst = makeInst({ id: '90', status: 'В работе', counterStart: '1200', counterEnd: '750',
        runLength: '450', plannedRuns: '1', inWork: '1' });
    inst.finishCut();
    var f = fieldsOf(inst);
    assert(f.t16411 === '2026-07-24 15:00:00', '#4366 finishCut: «Закончено» проставлено');
    assert(f.t1162 === '0', '#4366 finishCut: «В работе» снимается нулём (галка гаснет)');
    assert(f.t1162 !== '' && f.t1162 !== undefined, '#4366 finishCut: снятие «В работе» не пустое и не пропущено');
})();

// ── 3. «Прекратить» и «Пропуск» тоже снимают галку ─────────────────────────────────────────────
[['abortCut', 'Прекратить'], ['skipCut', 'Пропуск']].forEach(function(pair) {
    var inst = makeInst({ id: '91', status: 'В работе', inWork: '1' });
    inst[pair[0]]();
    var f = fieldsOf(inst);
    assert(f.t1162 === '0' && f.t16411 === '2026-07-24 15:00:00',
        '#4366 «' + pair[1] + '»: «Закончено»=now и «В работе»=0');
});

// ── 4. «Возобновить»: «Закончено» стирается пустым значением, «В работе» ставится ──────────────
(function() {
    var inst = makeInst({ id: '92', status: 'Завершена', inWork: '', finishedAt: '2026-07-24 14:00:00' });
    inst.resumeCut();
    var f = fieldsOf(inst);
    assert(f.t16411 === '', '#4366 «Возобновить»: «Закончено» очищается пустым значением');
    assert(f.t1162 === '1', '#4366 «Возобновить»: «В работе» ставится');
})();

// ── 5. «В работе» партии сырья по завершении — тоже нулём ──────────────────────────────────────
(function() {
    var inst = makeInst({ id: '93', batchId: '77', status: 'В работе' });
    var batch = { id: '77', materialId: 'm', remainderM: 1000, remainder: 500, widthMm: 500, active: '1' };
    inst.findBatch = function(id) { return String(id) === '77' ? batch : null; };
    inst.materialWidths = {};
    inst.applyBatchConsumption(inst.currentCut, 300, true);
    var f = fieldsOf(inst);
    assert(f.t16427 === '0', '#4366: «В работе» партии сырья снимается нулём');
    assert(f.t8456 === 700, '#4366: остаток партии списан (1000 − 300)');
})();

// ── 6. стирание показаний доезжает до БД (тот же корень) ───────────────────────────────────────
(function() {
    var inst = makeInst({ id: '94', status: 'В работе', counterStart: '1200', counterEnd: '',
        defectM: '', notes: '' });
    inst.saveReadings();
    var f = fieldsOf(inst);
    assert(f.t1166 === '', '#4366: очищенный «Счётчик кон.» уходит пустым значением (сохранится)');
    assert(f.t8458 === '' && f.t1171 === '', '#4366: очищенные «Брак, м» и «Примечания» уходят пустыми');
})();

console.log('\n' + passed + '/' + total + ' assertions passed');
if (passed !== total) process.exitCode = 1;
