// #5269 — WEB-SOCKET В ЯДРЕ, демон ws-server/ (Node, без зависимостей).
//
// Ядро после записи шлёт демону подписанный POST /push с событиями (include/ws_push.php);
// демон держит соединения браузеров и внешних клиентов и раздаёт события подписчикам таблиц.
// Подключение и каждая подписка проверяются ядром (GET /{db}/ws_auth?JSON) куки или токеном
// самого клиента — демон своих прав не знает.
//
// Проверяется: кодек кадров RFC 6455, маршрутизация событий (база, типы, схема, массовое,
// уведомления) и сквозной путь на поддельном ядре: рукопожатие, подписка, push, отказы.
//
// Run with: node --test experiments/ws-server-5269.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const net = require('net');
const crypto = require('crypto');
const path = require('path');

const root = path.join(__dirname, '..', 'ws-server');
const frames = require(path.join(root, 'lib', 'frames.js'));
const { Hub } = require(path.join(root, 'lib', 'hub.js'));
const { createWsServer } = require(path.join(root, 'server.js'));

// ── Кодек кадров ──────────────────────────────────────────────────────────────

test('Sec-WebSocket-Accept по примеру RFC 6455', () => {
    assert.equal(frames.acceptKey('dGhlIHNhbXBsZSBub25jZQ=='), 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
});

test('кадр туда-обратно: короткий, 16- и 64-битная длина, с маской и без', () => {
    for (const len of [0, 5, 125, 126, 300, 65535, 70000]) {
        for (const masked of [false, true]) {
            const payload = crypto.randomBytes(len);
            const buf = frames.encodeFrame(frames.OP_BINARY, payload, masked);
            const reader = new frames.FrameReader({ requireMask: masked, maxPayload: 1 << 20 });
            const out = reader.push(buf);
            assert.equal(out.length, 1, `len=${len} masked=${masked}`);
            assert.equal(out[0].opcode, frames.OP_BINARY);
            assert.ok(out[0].payload.equals(payload), `len=${len} masked=${masked}`);
        }
    }
});

test('кадры, пришедшие по байту, и сообщение из фрагментов собираются', () => {
    const a = frames.encodeFrame(frames.OP_TEXT, Buffer.from('при'), true, false);
    const b = frames.encodeFrame(frames.OP_CONT, Buffer.from('вет'), true, true);
    const ping = frames.encodeFrame(frames.OP_PING, Buffer.from('p'), true);
    const all = Buffer.concat([a, ping, b]);
    const reader = new frames.FrameReader({ requireMask: true, maxPayload: 1024 });
    const got = [];
    for (const byte of all) got.push(...reader.push(Buffer.from([byte])));
    assert.deepEqual(got.map((m) => [m.opcode, m.payload.toString()]),
        [[frames.OP_PING, 'p'], [frames.OP_TEXT, 'привет']]);
});

test('кадр клиента без маски и сверхдлинный кадр — ошибка протокола', () => {
    const plain = frames.encodeFrame(frames.OP_TEXT, Buffer.from('x'), false);
    assert.throws(() => new frames.FrameReader({ requireMask: true, maxPayload: 10 }).push(plain), /mask/i);
    const big = frames.encodeFrame(frames.OP_TEXT, Buffer.alloc(11), true);
    assert.throws(() => new frames.FrameReader({ requireMask: true, maxPayload: 10 }).push(big), /too large/i);
});

// ── Маршрутизация ─────────────────────────────────────────────────────────────

function fakeClient(db, user, subs) {
    return { db, user, subs: new Set(subs), got: [], send(msg) { this.got.push(msg); } };
}

test('событие получает подписчик любого типа из цепочки, в своей базе', () => {
    const hub = new Hub();
    const ann = fakeClient('demo', 'ann', [500]);
    const bob = fakeClient('demo', 'bob', [700]);
    const eve = fakeClient('other', 'eve', [500]);
    const kim = fakeClient('demo', 'kim', [999]);
    [ann, bob, eve, kim].forEach((c) => hub.add(c));
    hub.route({ db: 'demo', by: 'carl', bulk: false, notify: [], events: [
        { k: 'change', op: 'update', id: 21, up: 20, t: 701, types: [701, 700, 500] },
        { k: 'change', op: 'insert', id: 30, up: 1, t: 800, types: [800] },
        { k: 'schema', t: 500 },
    ] });
    assert.deepEqual(ann.got, [{ op: 'events', by: 'carl', reload: false, events: [
        { k: 'change', op: 'update', id: 21, up: 20, t: 701, types: [701, 700, 500] },
        { k: 'schema', t: 500 },
    ] }]);
    assert.deepEqual(bob.got[0].events.map((e) => e.id), [21]);
    assert.equal(eve.got.length, 0, 'другая база — ничего');
    assert.equal(kim.got.length, 0, 'тип не из цепочки — ничего');
});

test('массовое изменение — «перечитать» всем подписанным в базе; уведомление — адресату', () => {
    const hub = new Hub();
    const ann = fakeClient('demo', 'ann', [500]);
    const idle = fakeClient('demo', 'bob', []);
    hub.add(ann); hub.add(idle);
    hub.route({ db: 'demo', by: 'carl', bulk: true, events: [], notify: [
        { to: ['bob'], from: 'carl', data: { msg: 'Готово' } },
    ] });
    assert.deepEqual(ann.got, [{ op: 'events', by: 'carl', reload: true, events: [] }]);
    assert.deepEqual(idle.got, [{ op: 'notify', from: 'carl', data: { msg: 'Готово' } }],
        'без подписок — только уведомление, без «перечитать»');
    hub.remove(ann);
    hub.route({ db: 'demo', by: 'carl', bulk: true, events: [], notify: [] });
    assert.equal(ann.got.length, 1, 'отключённый клиент больше ничего не получает');
});

// ── Сквозной путь на поддельном ядре ─────────────────────────────────────────

const SECRET = 'test-secret';

// Ядро: куки idb_demo=good или X-Authorization: tok-bob; право чтения — на тип 500
function startCore() {
    const seen = [];
    const srv = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://x');
        seen.push({ path: url.pathname, cookie: req.headers.cookie || '', auth: req.headers['x-authorization'] || '' });
        let user = null;
        if (url.pathname === '/demo/ws_auth' && url.searchParams.has('JSON')) {
            if (/(^|;\s*)idb_demo=good(;|$)/.test(req.headers.cookie || '')) user = 'ann';
            if (req.headers['x-authorization'] === 'tok-bob') user = 'bob';
        }
        if (!user) { res.writeHead(401, { 'Content-Type': 'application/json' }); return res.end('{"error":"auth"}'); }
        const body = { user, user_id: '7', role: 'r' };
        if (url.searchParams.has('t')) { body.t = +url.searchParams.get('t'); body.read = body.t === 500; }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
    });
    return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve({ srv, seen, url: `http://127.0.0.1:${srv.address().port}` })));
}

// Клиент web-socket на голом сокете: рукопожатие, затем JSON-сообщения
function wsConnect(port, pathQuery, headers) {
    return new Promise((resolve, reject) => {
        const sock = net.connect(port, '127.0.0.1');
        const key = crypto.randomBytes(16).toString('base64');
        const lines = [`GET ${pathQuery} HTTP/1.1`, `Host: 127.0.0.1:${port}`, 'Upgrade: websocket', 'Connection: Upgrade',
            `Sec-WebSocket-Key: ${key}`, 'Sec-WebSocket-Version: 13'];
        for (const [k, v] of Object.entries(headers || {})) lines.push(`${k}: ${v}`);
        sock.write(lines.join('\r\n') + '\r\n\r\n');
        let head = Buffer.alloc(0);
        const reader = new frames.FrameReader({ requireMask: false, maxPayload: 1 << 20 });
        const inbox = []; const waiters = [];
        const client = {
            status: 0, closed: false,
            send(obj) { sock.write(frames.encodeFrame(frames.OP_TEXT, Buffer.from(JSON.stringify(obj)), true)); },
            next(ms = 2000) {
                if (inbox.length) return Promise.resolve(inbox.shift());
                return new Promise((res, rej) => {
                    const timer = setTimeout(() => rej(new Error('нет сообщения за ' + ms + ' мс')), ms);
                    waiters.push((m) => { clearTimeout(timer); res(m); });
                });
            },
            pending: () => inbox.length,
            close() { sock.destroy(); },
        };
        const deliver = (m) => (waiters.length ? waiters.shift()(m) : inbox.push(m));
        sock.on('data', (chunk) => {
            if (!client.status) {
                head = Buffer.concat([head, chunk]);
                const end = head.indexOf('\r\n\r\n');
                if (end < 0) return;
                const text = head.slice(0, end).toString();
                client.status = +text.split(' ')[1];
                if (client.status === 101) {
                    const accept = /sec-websocket-accept:\s*(\S+)/i.exec(text);
                    if (!accept || accept[1] !== frames.acceptKey(key)) return reject(new Error('неверный accept'));
                }
                resolve(client);
                chunk = head.slice(end + 4);
                if (!chunk.length) return;
            }
            for (const f of reader.push(chunk)) {
                if (f.opcode === frames.OP_TEXT) deliver(JSON.parse(f.payload.toString()));
                if (f.opcode === frames.OP_CLOSE) { client.closed = true; client.closeCode = f.payload.length >= 2 ? f.payload.readUInt16BE(0) : 0; deliver({ op: '_closed', code: client.closeCode }); }
            }
        });
        sock.on('close', () => { client.closed = true; if (!client.status) resolve(client); });
        sock.on('error', () => {});
    });
}

function push(port, payload, secret = SECRET) {
    const body = JSON.stringify(payload);
    const sig = crypto.createHmac('sha256', secret).update(body).digest('hex');
    return fetch(`http://127.0.0.1:${port}/push`, { method: 'POST', body, headers: { 'Content-Type': 'application/json', 'X-Ws-Signature': sig } });
}

test('сквозной путь: подключение, подписка с проверкой ядром, push, отказы', async (t) => {
    const core = await startCore();
    const ws = createWsServer({ coreUrl: core.url, secret: SECRET, allowedOrigins: ['https://ideav.ru'], reauthMs: 0, pingMs: 0 });
    await ws.listen(0, '127.0.0.1');
    const port = ws.address().port;
    t.after(async () => { await ws.close(); core.srv.close(); });

    // Чужой сайт с куки пользователя (CSWSH) — отказ до обращения к ядру
    const evil = await wsConnect(port, '/ws?db=demo', { Cookie: 'idb_demo=good', Origin: 'https://evil.example' });
    assert.equal(evil.status, 403, 'чужой Origin');
    // Неверное имя базы и неверный вход
    assert.equal((await wsConnect(port, '/ws?db=../x', { Cookie: 'idb_demo=good' })).status, 400, 'имя базы');
    assert.equal((await wsConnect(port, '/ws?db=demo', { Cookie: 'idb_demo=bad' })).status, 401, 'куки не принят ядром');

    const ann = await wsConnect(port, '/ws?db=demo', { Cookie: 'other=1; idb_demo=good', Origin: 'https://ideav.ru' });
    assert.equal(ann.status, 101, 'браузер со своего сайта');
    assert.deepEqual(await ann.next(), { op: 'hello', db: 'demo', user: 'ann' });
    const bob = await wsConnect(port, '/ws?db=demo', { 'X-Authorization': 'tok-bob' });
    assert.equal(bob.status, 101, 'внешний клиент с токеном, без Origin');
    await bob.next();
    const toCore = core.seen.find((s) => s.cookie.includes('idb_demo=good'));
    assert.equal(toCore.cookie, 'idb_demo=good', 'ядру уходит только куки этой базы');

    ann.send({ op: 'sub', t: 500 });
    assert.deepEqual(await ann.next(), { op: 'sub', t: 500, ok: true });
    ann.send({ op: 'sub', t: 600 });
    assert.deepEqual(await ann.next(), { op: 'sub', t: 600, ok: false }, 'нет права — нет подписки');
    bob.send({ op: 'sub', t: 600 });
    await bob.next();

    // Неподписанный и с чужим секретом push — отказ, ничего не разослано
    assert.equal((await fetch(`http://127.0.0.1:${port}/push`, { method: 'POST', body: '{}' })).status, 401);
    const ev = { db: 'demo', by: 'carl', bulk: false, notify: [], events: [{ k: 'change', op: 'update', id: 11, up: 10, t: 501, types: [501, 500] }] };
    assert.equal((await push(port, ev, 'wrong')).status, 401);
    assert.equal((await push(port, ev)).status, 204);
    assert.deepEqual(await ann.next(), { op: 'events', by: 'carl', reload: false, events: ev.events });

    await push(port, { db: 'demo', by: 'carl', bulk: false, events: [], notify: [{ to: ['bob'], from: 'carl', data: { msg: 'hi' } }] });
    assert.deepEqual(await bob.next(), { op: 'notify', from: 'carl', data: { msg: 'hi' } });
    assert.equal(ann.pending(), 0, 'чужое уведомление не приходит');
    assert.equal(bob.pending(), 0, 'события таблицы 500 не приходят тому, у кого нет подписки');

    ann.send({ op: 'ping' });
    assert.deepEqual(await ann.next(), { op: 'pong' });
    ann.close(); bob.close();
});

test('повторная проверка входа: токен отозван — соединение закрывается кодом 4401', async (t) => {
    const core = await startCore();
    const ws = createWsServer({ coreUrl: core.url, secret: SECRET, allowedOrigins: [], reauthMs: 50, pingMs: 0 });
    await ws.listen(0, '127.0.0.1');
    t.after(async () => { await ws.close(); core.srv.close(); });
    const bob = await wsConnect(ws.address().port, '/ws?db=demo', { 'X-Authorization': 'tok-bob' });
    await bob.next();
    core.srv.removeAllListeners('request');
    core.srv.on('request', (req, res) => { res.writeHead(401); res.end('{}'); });
    assert.deepEqual(await bob.next(3000), { op: '_closed', code: 4401 });
});
