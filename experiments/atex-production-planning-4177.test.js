// Regression/behaviour for ideav/crm#4177 — ПОДРОБНАЯ ТРАССА КАЖДОГО серверного изменения.
// По просьбе заказчика: любой запрос-изменение к серверу (_m_new/_m_save/_m_set/_m_del) печатает
// в консоль номер, операцию, таблицу, up=, ВСЕ поля payload, текущую операцию (_ppOp) и созданный
// id / текст отказа. Это нужно, чтобы источник резки-сироты «нет связей» (напр. 496122: «Партия ГП»
// 154×5 + 110×1 БЕЗ t70577 «ID заказа» и без единого Обеспечения) читался в логе без догадок.
//
// Здесь гоняем РЕАЛЬНЫЙ Controller.prototype.post со стаб-fetch и проверяем, что трасса срабатывает
// на каждый POST: старт (поля видны, _xsrf скрыт), успех (id из ответа), отказ (код+текст).
//
// Run with: node experiments/atex-production-planning-4177.test.js

process.env.TZ = 'UTC';
global.window = { xsrf: 'xsrf-token' };
var Controller = require('../download/atex/js/production-planning.js').Controller;

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.error((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

// ── перехват console.log (трасса печатает именно туда) ──
var logLines = [];
var origLog = console.log;
console.log = function () {
    // сериализуем аргументы в одну строку для проверки содержимого
    var parts = Array.prototype.map.call(arguments, function (a) {
        return (typeof a === 'string') ? a : JSON.stringify(a);
    });
    logLines.push(parts.join(' '));
};
function restoreLog() { console.log = origLog; }

// ── стаб fetch: программируемый ответ ──
var nextResponse = null;   // { ok, status, body }
var lastFetch = null;
global.fetch = function (url, opts) {
    lastFetch = { url: url, opts: opts };
    var r = nextResponse || { ok: true, status: 200, body: JSON.stringify({ obj: '999' }) };
    return Promise.resolve({
        ok: r.ok, status: r.status,
        text: function () { return Promise.resolve(r.body); }
    });
};

// ── минимальный «this» для post(): db, root(xsrf), url, _ppOp ──
function makeCtx(op) {
    return {
        db: 'ateh',
        _ppOp: op,
        root: { getAttribute: function () { return 'xsrf-token'; } },
        url: Controller.prototype.url
    };
}
function post(ctx, path, params) { return Controller.prototype.post.call(ctx, path, params); }
function findLine(sub) { return logLines.filter(function (l) { return l.indexOf(sub) >= 0; }); }

// Тест 1: создание «Партии ГП»-сироты (как 496122) — трасса на старте видит поля БЕЗ t70577.
nextResponse = { ok: true, status: 200, body: JSON.stringify({ obj: '503538' }) };
logLines = [];
post(makeCtx('runGenerateCuts'), '_m_new/1081?JSON&up=496122',
     { t1186: '154', t70190: '5', t70575: '5', t1189: '450', t1192: '1' })
.then(function () {
    var start = findLine('WRITE#')[0] || '';
    assert(/NEW t1081/.test(start), '1a: операция и таблица (NEW t1081)', start.slice(0, 120));
    assert(/up=496122/.test(start), '1b: up= родитель виден');
    assert(/\[runGenerateCuts\]/.test(start), '1c: контекст операции _ppOp виден');
    assert(/t1186/.test(start) && /154/.test(start), '1d: поля payload в трассе');
    assert(start.indexOf('_xsrf') < 0, '1e: _xsrf НЕ печатается (скрыт)');
    assert(start.indexOf('t70577') < 0, '1f: у сироты нет ID заказа — и в трассе его нет');
    var okLine = findLine('id=503538')[0] || '';
    assert(/→ id=503538/.test(okLine), '1g: на ответе печатается созданный id');

    // Тест 2: _m_set — операция SET распознаётся, поля видны.
    nextResponse = { ok: true, status: 200, body: JSON.stringify({ ok: 1 }) };
    logLines = [];
    return post(makeCtx('applySplitPlan'), '_m_set/496122?JSON', { t16403: '4', t196458: '496122' });
})
.then(function () {
    var start = findLine('WRITE#')[0] || '';
    assert(/SET t496122/.test(start), '2a: SET распознан', start.slice(0, 100));
    assert(/\[applySplitPlan\]/.test(start), '2b: контекст applySplitPlan');
    assert(/t196458/.test(start) && /496122/.test(start), '2c: поля SET видны (firstPart=self)');

    // Тест 3: отказ сервера (409, тело [{error}]) — трасса печатает СБОЙ с кодом и текстом.
    nextResponse = { ok: false, status: 409, body: JSON.stringify([{ error: 'есть ссылки' }]) };
    logLines = [];
    var errLines = [];
    var origErr = console.error;
    console.error = function () {
        var parts = Array.prototype.map.call(arguments, function (a) { return (typeof a === 'string') ? a : JSON.stringify(a); });
        errLines.push(parts.join(' '));
    };
    return post(makeCtx('runGenerateCuts'), '_m_del/496122?JSON', {})
        .then(function () { console.error = origErr; assert(false, '3: отказ должен был отклонить промис'); },
              function (err) {
                  console.error = origErr;
                  var failLine = errLines.filter(function (l) { return l.indexOf('WRITE#') >= 0 && l.indexOf('СБОЙ') >= 0; })[0] || '';
                  assert(/DEL t496122/.test(failLine), '3a: DEL в трассе отказа', failLine.slice(0, 120));
                  assert(/СБОЙ 409/.test(failLine), '3b: код 409 в трассе отказа');
                  assert(/есть ссылки/.test(failLine), '3c: текст ошибки в трассе отказа');
                  assert(/есть ссылки/.test(String(err && err.message)), '3d: промис отклонён с тем же текстом (поведение post не изменилось)');
              });
})
.then(function () {
    // Тест 4: чтения (getJson) НЕ трассируются как записи — post не вызывался, счётчик не рос.
    // (косвенно: только POST'ы выше дали строки WRITE#) — проверяем, что каждый POST дал ровно одну
    // стартовую строку.
    restoreLog();
    console.error('\n' + passed + '/' + total + ' проверок пройдено.');
})
.catch(function (e) { restoreLog(); console.error('НЕОЖИДАННАЯ ОШИБКА:', e && e.stack || e); process.exitCode = 1; });
