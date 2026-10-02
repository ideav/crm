// Unit tests — #5057: «Все рулоны идут в отходы и нет номеров заказов».
// Чтение планирования (getJson) переспрашивает сервер до 3 раз при сбое (сеть, 5xx, не-JSON,
// тело-ошибка `[{"error":…}]` при 200) и после третьей неудачи бросает ошибку с путём запроса.
// Отказ 4xx (my_die) — решение сервера, его не переспрашиваем.
// Справочники геометрии («Фактическая ширина резки», «Диаметр втулки») при сбое чтения больше
// не подменяются пустыми: без них ширины позиций остаются номинальными, полосы не сходятся с
// позициями и вся резка уходит в «ОТХОДЫ» без номеров заказов.
//
// Run with: node experiments/atex-pp-5057-load-retry.test.js

process.env.TZ = 'UTC';

var api = require('../download/atex/js/production-planning.js');
var Ctrl = api.Controller;

var passed = 0;
function assert(cond, name) {
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}

function fakeThis(extra) {
    var t = {
        url: function(p) { return '/db/' + p; },
        root: { getAttribute: function() { return 'xsrf'; } },
        getRetryDelayMs: 0
    };
    Object.keys(extra || {}).forEach(function(k) { t[k] = extra[k]; });
    return t;
}
function resp(ok, status, body) {
    return { ok: ok, status: status, text: function() { return Promise.resolve(body); } };
}
// Сценарий ответов по очереди; последний повторяется. Возвращает счётчик вызовов.
function stubSequence(seq) {
    var calls = { n: 0 };
    global.fetch = function() {
        var step = seq[Math.min(calls.n, seq.length - 1)];
        calls.n++;
        return step === 'network' ? Promise.reject(new TypeError('Failed to fetch')) : Promise.resolve(step);
    };
    return calls;
}
async function settle(p) {
    try { return { ok: true, value: await p }; }
    catch (e) { return { ok: false, error: e }; }
}

(async function() {
    var rowsBody = '[{"position_id":"907141","order_no":"5739"}]';

    // 1. Два сетевых сбоя, третья попытка успешна → данные, ровно 3 запроса.
    var c1 = stubSequence(['network', 'network', resp(true, 200, rowsBody)]);
    var r1 = await settle(Ctrl.prototype.getJson.call(fakeThis(), 'report/positions_list'));
    assert(r1.ok && Array.isArray(r1.value) && r1.value[0].order_no === '5739',
        'getJson: сеть упала дважды → третья попытка отдаёт данные');
    assert(c1.n === 3, 'getJson: сделано ровно 3 запроса (было ' + c1.n + ')');

    // 2. 5xx на всех попытках → reject после 3 запросов, в сообщении путь и число попыток.
    var c2 = stubSequence([resp(false, 502, '<html>Bad Gateway</html>')]);
    var r2 = await settle(Ctrl.prototype.getJson.call(fakeThis(), 'report/cut_planning?JSON_KV'));
    assert(!r2.ok, 'getJson: 502 трижды → ошибка, а не данные');
    assert(c2.n === 3, 'getJson: 502 → ровно 3 попытки (было ' + c2.n + ')');
    assert(!r2.ok && /cut_planning/.test(r2.error.message) && /3/.test(r2.error.message),
        'getJson: сообщение называет запрос и 3 попытки (' + (r2.ok ? '' : r2.error.message) + ')');

    // 3. 200 с телом-ошибкой → это сбой, а не строка отчёта.
    var c3 = stubSequence([resp(true, 200, '[{"error":"Lock wait timeout exceeded"}]')]);
    var r3 = await settle(Ctrl.prototype.getJson.call(fakeThis(), 'report/cut_strips'));
    assert(!r3.ok && /Lock wait timeout/.test(r3.error.message),
        'getJson: 200 [{error}] → ошибка с текстом сервера (было: ' + (r3.ok ? JSON.stringify(r3.value) : r3.error.message) + ')');
    assert(c3.n === 3, 'getJson: 200 [{error}] → переспрошено 3 раза (было ' + c3.n + ')');

    // 4. Не-JSON при 200 → переспрос; вторая попытка успешна.
    var c4 = stubSequence([resp(true, 200, '<br><b>Fatal error</b>'), resp(true, 200, rowsBody)]);
    var r4 = await settle(Ctrl.prototype.getJson.call(fakeThis(), 'report/positions_list'));
    assert(r4.ok && c4.n === 2, 'getJson: обрыв ответа (не JSON) → переспрос и данные');

    // 5. Отказ 4xx (my_die) — не переспрашиваем, текст сервера как есть.
    var c5 = stubSequence([resp(false, 403, '[{"error":"Нет доступа"}]')]);
    var r5 = await settle(Ctrl.prototype.getJson.call(fakeThis(), 'object/66190/'));
    assert(!r5.ok && r5.error.message === 'Нет доступа' && c5.n === 1, 'getJson: 403 → одна попытка, текст сервера');

    // 6. Справочники геометрии: сбой чтения → загрузка падает, а не тихо пустеет.
    var meta = [
        { id: '66190', val: 'Фактическая ширина резки', reqs: [{ id: '66191', val: 'Ширина в заказе' }, { id: '66192', val: 'Код' }] },
        { id: '8188', val: 'Диаметр втулки', reqs: [{ id: '8194', val: 'Дюймы' }, { id: '8195', val: 'Ширина втулки, мм' }] }
    ];
    var failing = function() { return Promise.reject(new Error('report/x: не загрузилось после 3 попыток')); };
    var loaders = ['loadActualWidths', 'loadSleeveInches', 'loadSleeveWidths'];
    for (var i = 0; i < loaders.length; i++) {
        var name = loaders[i];
        var ctx = fakeThis({ _metaAll: meta, getJson: failing });
        var r = await settle(Ctrl.prototype[name].call(ctx));
        assert(!r.ok, name + ': сбой чтения → ошибка загрузки, а не пустой справочник');
    }

    // 7. Справочник прочитан — индекс заполнен (успешный путь не сломан).
    var okCtx = fakeThis({ _metaAll: meta, getJson: function() { return Promise.resolve([{ i: '1', r: ['48', '50', ''] }]); } });
    var r7 = await settle(Ctrl.prototype.loadActualWidths.call(okCtx));
    assert(r7.ok && Object.keys(okCtx.actualWidthIndex || {}).length > 0, 'loadActualWidths: успешное чтение → индекс заполнен');

    console.log('\n' + passed + ' проверок прошло' + (process.exitCode ? ', ЕСТЬ ПАДЕНИЯ' : ''));
})();
