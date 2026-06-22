// Unit tests — отказ команды `_m_*` (напр. 409 при удалении задания с живыми ссылками)
// больше не проглатывается как «успех». Сервер (index.php my_die/api_dump) отдаёт тело
// `[{"error":"…"}]` с HTTP-кодом 4xx; planning.extractApiError разворачивает обе формы
// (массив-обёртку и объект), а getJson/post при !resp.ok бросают это сообщение.
//
// Run with: node experiments/atex-production-planning-delete-errors.test.js

process.env.TZ = 'UTC';

var api = require('../download/atex/js/production-planning.js');
var planning = api.planning;
var extract = planning.extractApiError;

var passed = 0;
function assert(cond, name) {
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}

// Боевая форма отказа: массив с одним объектом-ошибкой (my_die → api_dump).
assert(extract([{ error: 'Нельзя удалить объект, на который существует ссылки (всего: 2)!' }])
    === 'Нельзя удалить объект, на который существует ссылки (всего: 2)!',
    'массив [{error}] (my_die) → текст ошибки');

// Объектная форма — тоже поддерживаем.
assert(extract({ error: 'boom' }) === 'boom', 'объект {error} → текст');

// Синоним `err`.
assert(extract({ err: 'oops' }) === 'oops', 'объект {err} → текст');
assert(extract([{ err: 'oops' }]) === 'oops', 'массив [{err}] → текст');

// Пробелы по краям обрезаются.
assert(extract([{ error: '  trimmed  ' }]) === 'trimmed', 'сообщение тримится');

// Данные без ошибки — не ложная тревога.
assert(extract([{ position_id: '82746', order_no: '3741' }]) === '', 'строка данных → пусто');
assert(extract({ obj: 123, i: 123 }) === '', 'успех _m_new {obj,i} → пусто');
assert(extract([]) === '', 'пустой массив → пусто');
assert(extract(null) === '', 'null → пусто');
assert(extract(undefined) === '', 'undefined → пусто');
assert(extract('строка') === '', 'строка → пусто');
assert(extract(42) === '', 'число → пусто');

// error пустой/невалидный → пусто (нет ложного сообщения).
assert(extract([{ error: '' }]) === '', 'пустой error → пусто');
assert(extract([{ error: null }]) === '', 'error=null → пусто');

// ── Интеграция: проводка getJson/post (стаб fetch) — отказ 4xx больше не «успех» ──
var Ctrl = api.Controller;
function fakeThis() {
    return { url: function(p) { return '/db/' + p; }, root: { getAttribute: function() { return 'xsrf'; } } };
}
function stubFetch(ok, status, body) {
    global.fetch = function() {
        return Promise.resolve({ ok: ok, status: status, text: function() { return Promise.resolve(body); } });
    };
}

(async function() {
    // post: 409 [{error}] (my_die) → ОТКЛОНЯЕТСЯ текстом ошибки (раньше молчком «успех»).
    stubFetch(false, 409, '[{"error":"Нельзя удалить объект, на который существует ссылки (всего: 2)!"}]');
    var rejected = false, msg = '';
    try { await Ctrl.prototype.post.call(fakeThis(), '_m_del/123', {}); }
    catch (e) { rejected = true; msg = e.message; }
    assert(rejected && /существует ссылки/.test(msg), 'post: 409 [{error}] → reject с текстом сервера (не «успех»)');

    // post: успех (200, объект) → РЕЗОЛВ с данными.
    stubFetch(true, 200, '{"obj":777,"i":777}');
    var ok = false, val = null;
    try { val = await Ctrl.prototype.post.call(fakeThis(), '_m_new/110', {}); ok = true; } catch (e) {}
    assert(ok && val && String(val.i) === '777', 'post: 200 {obj,i} → resolve с данными');

    // getJson: 400 [{error}] → ОТКЛОНЯЕТСЯ; 200 массив-данные → РЕЗОЛВ.
    stubFetch(false, 400, '[{"error":"boom"}]');
    var gr = false;
    try { await Ctrl.prototype.getJson.call(fakeThis(), 'report/x'); } catch (e) { gr = (e.message === 'boom'); }
    assert(gr, 'getJson: 4xx [{error}] → reject с текстом');

    stubFetch(true, 200, '[{"position_id":"82746","order_no":"3741"}]');
    var rows = await Ctrl.prototype.getJson.call(fakeThis(), 'report/positions_list');
    assert(Array.isArray(rows) && rows[0].order_no === '3741', 'getJson: 200 данные → resolve (строка с error-колонки тут нет)');

    console.log('\n' + passed + ' passed');
})();
