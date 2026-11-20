// #5269 — WEB-SOCKET В ЯДРЕ, браузерный клиент js/ws-client.js.
//
// Клиент один на страницу: держит соединение с демоном ws-server/, подписывает таблицы
// (типы) вместе с записями на экране, раздаёт пришедшие строки подписчикам таблиц и
// уведомления. После обрыва переподключается с нарастающей паузой, повторяет подписки и
// сообщает подписчикам «устарело» — изменения за время обрыва потеряны. Вход отозван (код 4401) — не переподключается.
//
// Run with: node --test experiments/ws-client-5269.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { WsClient } = require(path.join(__dirname, '..', 'js', 'ws-client.js'));

// Поддельный WebSocket и таймеры: тест сам открывает, закрывает и доставляет сообщения
function harness() {
    const sockets = [];
    const timers = [];
    class FakeWS {
        constructor(url) { this.url = url; this.sent = []; this.readyState = 0; sockets.push(this); }
        send(text) { this.sent.push(JSON.parse(text)); }
        close() { this.readyState = 3; }
        open() { this.readyState = 1; this.onopen && this.onopen(); }
        msg(obj) { this.onmessage && this.onmessage({ data: JSON.stringify(obj) }); }
        drop(code = 1006) { this.readyState = 3; this.onclose && this.onclose({ code }); }
    }
    FakeWS.OPEN = 1;
    const setTimer = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
    const runTimers = () => { const list = timers.splice(0); list.forEach((t) => t.fn()); return list; };
    return { sockets, timers, runTimers, FakeWS, setTimer };
}

test('без адреса демона клиент выключен: подписка ничего не открывает', () => {
    const h = harness();
    const c = new WsClient({ url: '', db: 'demo', WebSocket: h.FakeWS, setTimeout: h.setTimer });
    assert.equal(c.enabled(), false);
    const off = c.subscribe(500, () => {});
    assert.equal(typeof off, 'function');
    assert.equal(h.sockets.length, 0);
});

test('адрес: относительный путь — от текущего хоста, схема ws/wss по странице; база в запросе', () => {
    const h = harness();
    new WsClient({ url: '/ws', db: 'demo', WebSocket: h.FakeWS, setTimeout: h.setTimer,
        location: { protocol: 'https:', host: 'ideav.ru' } }).subscribe(1, () => {});
    assert.equal(h.sockets[0].url, 'wss://ideav.ru/ws?db=demo');
    new WsClient({ url: 'ws://127.0.0.1:8790/ws', db: 'a b', WebSocket: h.FakeWS, setTimeout: h.setTimer }).subscribe(1, () => {});
    assert.equal(h.sockets[1].url, 'ws://127.0.0.1:8790/ws?db=a%20b');
});

test('подписка с записями на экране; строки — подписчикам своей таблицы; последняя отписка — unsub', () => {
    const h = harness();
    const c = new WsClient({ url: 'ws://x/ws', db: 'demo', WebSocket: h.FakeWS, setTimeout: h.setTimer });
    const got500 = []; const got700 = [];
    const off500 = c.subscribe(500, (m) => got500.push(m));
    const two = c.subscribe(500, () => {});
    c.subscribe(700, (m) => got700.push(m));
    off500.shown([10, 11]);
    two.shown([11, 12]);
    const ws = h.sockets[0];
    assert.deepEqual(ws.sent, [], 'до открытия ничего не шлётся');
    ws.open();
    assert.deepEqual(ws.sent, [{ op: 'sub', t: 500, shown: [10, 11, 12] }, { op: 'sub', t: 700, shown: [] }],
        'подписка несёт записи на экране всех таблиц этого типа на странице');
    two.shown([13]);
    assert.deepEqual(ws.sent.at(-1), { op: 'shown', t: 500, ids: [10, 11, 13] }, 'смена экрана — сразу демону');
    const m1 = { op: 'rows', t: 500, by: 'carl', rows: [{ i: 10, u: 1, o: 1, r: ['x'] }], added: [1] };
    ws.msg(m1);
    ws.msg({ op: 'rows', t: 700, by: 'carl', stale: 'schema' });
    assert.deepEqual(got500, [{ by: 'carl', rows: m1.rows, remove: [], added: [1], stale: '' }]);
    assert.deepEqual(got700, [{ by: 'carl', rows: [], remove: [], added: [], stale: 'schema' }]);
    two();
    off500();
    assert.deepEqual(ws.sent.at(-1), { op: 'unsub', t: 500 });
    ws.msg(m1);
    assert.equal(got500.length, 1, 'после отписки строк нет');
});

test('обрыв: переподключение с растущей паузой, повтор подписок, «устарело»; 4401 — конец', () => {
    const h = harness();
    const c = new WsClient({ url: 'ws://x/ws', db: 'demo', WebSocket: h.FakeWS, setTimeout: h.setTimer });
    const got = [];
    c.subscribe(500, (m) => got.push(m)).shown([7]);
    h.sockets[0].open();
    h.sockets[0].drop();
    const first = h.runTimers();
    assert.equal(h.sockets.length, 2, 'новое соединение');
    h.sockets[1].drop();
    const second = h.runTimers();
    assert.ok(second[0].ms > first[0].ms, `пауза растёт: ${first[0].ms} → ${second[0].ms}`);
    h.sockets[2].open();
    assert.deepEqual(h.sockets[2].sent, [{ op: 'sub', t: 500, shown: [7] }], 'подписки повторены');
    assert.deepEqual(got, [{ by: '', rows: [], remove: [], added: [], stale: 'lost' }], 'пропущенное за обрыв — плашкой');
    h.sockets[2].drop(4401);
    assert.equal(h.runTimers().length, 0, 'вход отозван — без переподключения');
});

test('уведомления — слушателям onNotify', () => {
    const h = harness();
    const c = new WsClient({ url: 'ws://x/ws', db: 'demo', WebSocket: h.FakeWS, setTimeout: h.setTimer });
    const got = [];
    c.onNotify((n) => got.push(n));
    assert.equal(h.sockets.length, 1, 'слушатель уведомлений открывает соединение');
    h.sockets[0].open();
    h.sockets[0].msg({ op: 'notify', from: 'carl', data: { msg: 'Готово' } });
    assert.deepEqual(got, [{ from: 'carl', data: { msg: 'Готово' } }]);
});
