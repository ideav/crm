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
const tls = require('tls');
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

// ── Раздача: готовые строки, маски, плашка новых записей ─────────────────────
//
// Подписчик сообщает, какие записи у него на экране (shown). Демон берёт изменённые строки
// одним запросом ядра на группу с одинаковым отпечатком прав (fp) — входом участника группы, со
// всеми масками ядра. Правка записи на экране — строкой; запись стала невидима или удалена —
// «убрать»; новая видимая запись — только родитель (u) для счётчика плашки, без id и значений.
// Записи вне экрана и скрытые маской подписчику не сообщаются ничем.

function fakeClient(db, user, fp, subs) {
    const m = new Map();
    for (const [t, o] of Object.entries(subs)) m.set(+t, { shown: new Set(o.shown || []), feed: !!o.feed, masked: !!o.masked });
    return { db, user, fp, subs: m, creds: { cookie: user }, got: [], send(msg) { this.got.push(msg); } };
}

// Ядро-заглушка: строки, видимые каждой группе прав (fp → id → строка)
function fakeRows(visible, opts = {}) {
    const calls = [];
    const fetchRows = async (client, t, ids) => {
        calls.push({ user: client.user, fp: client.fp, t, ids: [...ids].sort((x, y) => x - y) });
        if (opts.fail && opts.fail.includes(client.user)) return null;
        const rows = visible[client.fp] || {};
        return ids.filter((id) => rows[id]).map((id) => rows[id]);
    };
    return { fetchRows, calls };
}

const row = (i, u, v) => ({ i, u, o: 1, r: [v] });
// Таблица 500: запись 10 и 11 — на первом уровне, 111 — значение реквизита записи 11
const ev = (op, id, chain) => ({ k: 'change', op, id, up: 0, t: chain[0][1], types: chain.map((c) => c[1]), chain });

test('правка на экране — строкой, новая видимая — счётчиком, скрытая маской — ничем', async () => {
    const visible = { A: { 10: row(10, 1, 'a10'), 11: row(11, 1, 'a11'), 12: row(12, 1, 'a12') }, B: { 10: row(10, 1, 'b10') } };
    const { fetchRows, calls } = fakeRows(visible);
    const hub = new Hub({ fetchRows });
    const ann = fakeClient('demo', 'ann', 'A', { 500: { shown: [10, 11] } });
    const bob = fakeClient('demo', 'bob', 'A', { 500: { shown: [10] } });
    const carl = fakeClient('demo', 'carl', 'B', { 500: { shown: [10], masked: true } });
    const eve = fakeClient('other', 'eve', 'A', { 500: { shown: [10] } });
    [ann, bob, carl, eve].forEach((c) => hub.add(c));
    await hub.route({ db: 'demo', by: 'dan', bulk: false, notify: [], events: [
        ev('update', 10, [[10, 500]]),
        ev('update', 111, [[111, 501], [11, 500]]),
        ev('insert', 12, [[12, 500]]),
        ev('delete', 13, [[13, 500]]),
    ] });
    assert.deepEqual(ann.got, [{ op: 'rows', t: 500, by: 'dan', rows: [visible.A[10], visible.A[11]], added: [1] }]);
    assert.deepEqual(bob.got, [{ op: 'rows', t: 500, by: 'dan', rows: [visible.A[10]], added: [1] }]);
    assert.deepEqual(carl.got, [{ op: 'rows', t: 500, by: 'dan', rows: [visible.B[10]] }],
        'запись 12 скрыта маской: ни строки, ни счётчика; удалённая 13 не была на экране — ничего');
    assert.equal(eve.got.length, 0, 'другая база — ничего');
    assert.deepEqual(calls.map((c) => [c.fp, c.ids]), [['A', [10, 11, 12]], ['B', [10, 12]]],
        'один запрос ядра на группу прав, только нужные id');
});

test('запись ушла из-под маски или удалена — «убрать» тем, у кого она на экране', async () => {
    const { fetchRows } = fakeRows({ B: {} });
    const hub = new Hub({ fetchRows });
    const carl = fakeClient('demo', 'carl', 'B', { 500: { shown: [14, 15], masked: true } });
    const kim = fakeClient('demo', 'kim', 'B', { 500: { shown: [], masked: true } });
    hub.add(carl); hub.add(kim);
    await hub.route({ db: 'demo', by: 'dan', events: [ev('update', 14, [[14, 500]]), ev('delete', 15, [[15, 500]])] });
    assert.deepEqual(carl.got, [{ op: 'rows', t: 500, by: 'dan', remove: [14, 15] }]);
    assert.equal(kim.got.length, 0, 'у кого записи не было на экране — id не узнаёт');
    await hub.route({ db: 'demo', by: 'dan', events: [ev('update', 14, [[14, 500]])] });
    assert.equal(carl.got.length, 1, 'убранная запись больше не считается показанной');
});

test('лента (feed) для внешних систем: все видимые строки; удаления — только без масок', async () => {
    const visible = { A: { 20: row(20, 1, 'x'), 21: row(21, 1, 'y') } };
    const { fetchRows } = fakeRows(visible);
    const hub = new Hub({ fetchRows });
    const open = fakeClient('demo', 'svc', 'A', { 500: { feed: true } });
    const masked = fakeClient('demo', 'svc2', 'A', { 500: { feed: true, masked: true } });
    hub.add(open); hub.add(masked);
    await hub.route({ db: 'demo', by: 'dan', events: [ev('insert', 20, [[20, 500]]), ev('update', 21, [[21, 500]]), ev('delete', 22, [[22, 500]])] });
    assert.deepEqual(open.got, [{ op: 'rows', t: 500, by: 'dan', rows: [visible.A[20], visible.A[21]], remove: [22] }]);
    assert.deepEqual(masked.got, [{ op: 'rows', t: 500, by: 'dan', rows: [visible.A[20], visible.A[21]] }],
        'при масках удалённая запись могла быть скрытой — её id не уходит');
});

test('схема и массовое изменение — «устарело» без запроса строк; уведомление — адресату', async () => {
    const { fetchRows, calls } = fakeRows({});
    const hub = new Hub({ fetchRows });
    const ann = fakeClient('demo', 'ann', 'A', { 500: { shown: [10] }, 700: { shown: [] } });
    const idle = fakeClient('demo', 'bob', 'A', {});
    hub.add(ann); hub.add(idle);
    await hub.route({ db: 'demo', by: 'dan', events: [{ k: 'schema', t: 500 }, ev('update', 10, [[10, 500]])], notify: [] });
    assert.deepEqual(ann.got, [{ op: 'rows', t: 500, by: 'dan', stale: 'schema' }]);
    ann.got = [];
    await hub.route({ db: 'demo', by: 'dan', bulk: true, events: [], notify: [{ to: ['bob'], from: 'dan', data: { msg: 'Готово' } }] });
    assert.deepEqual(ann.got, [{ op: 'rows', t: 500, by: 'dan', stale: 'bulk' }, { op: 'rows', t: 700, by: 'dan', stale: 'bulk' }]);
    assert.deepEqual(idle.got, [{ op: 'notify', from: 'dan', data: { msg: 'Готово' } }], 'без подписок — только уведомление');
    assert.equal(calls.length, 0, 'строки не запрашиваются');
});

test('ядро не отдало строки: вход другого участника группы; никто — «устарело» тем, у кого запись на экране', async () => {
    const visible = { A: { 10: row(10, 1, 'a10') } };
    const one = fakeRows(visible, { fail: ['ann'] });
    const hub = new Hub({ fetchRows: one.fetchRows });
    const ann = fakeClient('demo', 'ann', 'A', { 500: { shown: [10] } });
    const bob = fakeClient('demo', 'bob', 'A', { 500: { shown: [10] } });
    hub.add(ann); hub.add(bob);
    await hub.route({ db: 'demo', by: 'dan', events: [ev('update', 10, [[10, 500]])] });
    assert.deepEqual(ann.got, [{ op: 'rows', t: 500, by: 'dan', rows: [visible.A[10]] }], 'вход ann не принят — строки по входу bob');
    const none = fakeRows(visible, { fail: ['ann', 'bob'] });
    const hub2 = new Hub({ fetchRows: none.fetchRows });
    const a2 = fakeClient('demo', 'ann', 'A', { 500: { shown: [10] } });
    const b2 = fakeClient('demo', 'bob', 'A', { 500: { shown: [] } });
    hub2.add(a2); hub2.add(b2);
    await hub2.route({ db: 'demo', by: 'dan', events: [ev('update', 10, [[10, 500]]), ev('insert', 12, [[12, 500]])] });
    assert.deepEqual(a2.got, [{ op: 'rows', t: 500, by: 'dan', stale: 'lost' }]);
    assert.equal(b2.got.length, 0, 'новая запись неизвестной видимости — ничего');
});

test('больше maxFetch записей на группу — «устарело» вместо огромного запроса', async () => {
    const { fetchRows, calls } = fakeRows({});
    const hub = new Hub({ fetchRows, maxFetch: 2 });
    const ann = fakeClient('demo', 'ann', 'A', { 500: { shown: [1, 2, 3] } });
    hub.add(ann);
    await hub.route({ db: 'demo', by: 'dan', events: [1, 2, 3].map((i) => ev('update', i, [[i, 500]])) });
    assert.deepEqual(ann.got, [{ op: 'rows', t: 500, by: 'dan', stale: 'bulk' }]);
    assert.equal(calls.length, 0);
});

// ── Сквозной путь на поддельном ядре ─────────────────────────────────────────

const SECRET = 'test-secret';

// Ядро: куки idb_demo=good (ann) или X-Authorization: tok-bob (bob); право чтения — на тип 500.
// У bob маска: запись 12 таблицы 500 ему не видна. Листинг object/500/?JSON_OBJ&F_500=@IN(…).
const CORE_ROWS = { 11: { i: 11, u: 1, o: 1, r: ['одиннадцать'] }, 12: { i: 12, u: 1, o: 2, r: ['двенадцать'] } };
function startCore() {
    const seen = [];
    const srv = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://x');
        seen.push({ path: url.pathname, query: url.search, cookie: req.headers.cookie || '', auth: req.headers['x-authorization'] || '' });
        let user = null;
        if (/(^|;\s*)idb_demo=good(;|$)/.test(req.headers.cookie || '')) user = 'ann';
        if (req.headers['x-authorization'] === 'tok-bob') user = 'bob';
        if (!user) { res.writeHead(401, { 'Content-Type': 'application/json' }); return res.end('{"error":"auth"}'); }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        if (url.pathname === '/demo/object/500/' && url.searchParams.has('JSON_OBJ')) {
            const m = /^@IN\(([\d,]+)\)$/.exec(url.searchParams.get('F_500') || '');
            const ids = m ? m[1].split(',').map(Number) : [];
            return res.end(JSON.stringify(ids.filter((id) => CORE_ROWS[id] && !(user === 'bob' && id === 12)).map((id) => CORE_ROWS[id])));
        }
        if (url.pathname !== '/demo/ws_auth' || !url.searchParams.has('JSON')) return res.end('[]');
        const body = { user, user_id: '7', role: 'r', fp: user === 'bob' ? 'fp-bob' : 'fp-ann' };
        if (url.searchParams.has('t')) { body.t = +url.searchParams.get('t'); body.read = body.t === 500; body.masked = user === 'bob'; }
        res.end(JSON.stringify(body));
    });
    return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve({ srv, seen, url: `http://127.0.0.1:${srv.address().port}` })));
}

// Клиент web-socket на голом сокете: рукопожатие, затем JSON-сообщения
function wsConnect(port, pathQuery, headers, connect = (p) => net.connect(p, '127.0.0.1')) {
    return new Promise((resolve, reject) => {
        const sock = connect(port);
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

    ann.send({ op: 'sub', t: 500, shown: [11, 12] });
    assert.deepEqual(await ann.next(), { op: 'sub', t: 500, ok: true });
    ann.send({ op: 'sub', t: 600 });
    assert.deepEqual(await ann.next(), { op: 'sub', t: 600, ok: false }, 'нет права — нет подписки');
    bob.send({ op: 'sub', t: 500 });
    await bob.next();
    bob.send({ op: 'shown', t: 500, ids: [11, 12, 'x', -1] });

    // Неподписанный и с чужим секретом push — отказ, ничего не разослано
    assert.equal((await fetch(`http://127.0.0.1:${port}/push`, { method: 'POST', body: '{}' })).status, 401);
    const chg = (id) => ({ k: 'change', op: 'update', id: id * 10 + 1, up: id, t: 501, types: [501, 500], chain: [[id * 10 + 1, 501], [id, 500]] });
    const ev = { db: 'demo', by: 'carl', bulk: false, notify: [], events: [chg(11), chg(12)] };
    assert.equal((await push(port, ev, 'wrong')).status, 401);
    const before = core.seen.length;
    assert.equal((await push(port, ev)).status, 204);
    assert.deepEqual(await ann.next(), { op: 'rows', t: 500, by: 'carl', rows: [CORE_ROWS[11], CORE_ROWS[12]] });
    assert.deepEqual(await bob.next(), { op: 'rows', t: 500, by: 'carl', rows: [CORE_ROWS[11]], remove: [12] },
        'маска bob: запись 12 убирается с его экрана, её значения ему не приходят');
    const reads = core.seen.slice(before).filter((s) => s.path === '/demo/object/500/');
    assert.equal(reads.length, 2, 'по запросу строк на группу прав');
    assert.ok(reads.every((s) => /[?&]F_500=%40IN%2811%2C12%29/.test(s.query) && /LIMIT=0%2C2/.test(s.query)), 'строки — листингом по id: ' + reads.map((s) => s.query));
    assert.ok(reads.some((s) => s.auth === 'tok-bob') && reads.some((s) => s.cookie === 'idb_demo=good'), 'каждой группе — входом её участника');

    await push(port, { db: 'demo', by: 'carl', bulk: false, events: [], notify: [{ to: ['bob'], from: 'carl', data: { msg: 'hi' } }] });
    assert.deepEqual(await bob.next(), { op: 'notify', from: 'carl', data: { msg: 'hi' } });
    assert.equal(ann.pending(), 0, 'чужое уведомление не приходит');

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

// Самоподписанный сертификат только для теста (CN=127.0.0.1).
const TEST_CERT = "-----BEGIN CERTIFICATE-----\r\nMIIBfzCCASWgAwIBAgIUehVZk9Eq5kYDzG+o9gU9SwiORaEwCgYIKoZIzj0EAwIw\r\nFDESMBAGA1UEAwwJMTI3LjAuMC4xMCAXDTI2MTEyMTEwMDg1NloYDzIxMjYxMDI4\r\nMTAwODU2WjAUMRIwEAYDVQQDDAkxMjcuMC4wLjEwWTATBgcqhkjOPQIBBggqhkjO\r\nPQMBBwNCAAQq9jF3U1ayYwS09PXei2IJzQV6aU/Fhpxm7iBmTC6P/i9OvP+hHdgZ\r\nVgllhDuZvM75aoE2QFBnmY14JFh5ms3qo1MwUTAdBgNVHQ4EFgQULQi6Pp+RQ8TB\r\nqpDqFk3TQTnuCT8wHwYDVR0jBBgwFoAULQi6Pp+RQ8TBqpDqFk3TQTnuCT8wDwYD\r\nVR0TAQH/BAUwAwEB/zAKBggqhkjOPQQDAgNIADBFAiA4/3PU8sAhrcCO58502+Ck\r\n8nJ06mbIl4aIf/pySwMbTwIhAP7c9zM9BmnS+QeoqOF1js5CdQle3vUTsiU6DzId\r\nXdr3\r\n-----END CERTIFICATE-----\r\n";
const TEST_KEY = "-----BEGIN PRIVATE KEY-----\r\nMIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgPiRMXMXGhOtYOc9R\r\nsVrgBu+VhESjl59z0dIpbvNeC3ihRANCAAQq9jF3U1ayYwS09PXei2IJzQV6aU/F\r\nhpxm7iBmTC6P/i9OvP+hHdgZVgllhDuZvM75aoE2QFBnmY14JFh5ms3q\r\n-----END PRIVATE KEY-----\r\n";

test('свой порт wss: браузер подключается по TLS мимо веб-сервера, /push снаружи закрыт', async (t) => {
    const core = await startCore();
    const ws = createWsServer({ coreUrl: core.url, secret: SECRET, allowedOrigins: ['https://ideav.ru'], reauthMs: 0, pingMs: 0 });
    t.after(async () => { await ws.close(); core.srv.close(); });
    await ws.listen(0, '127.0.0.1');
    await ws.listenTls({ cert: TEST_CERT, key: TEST_KEY }, 0, '127.0.0.1');
    const tport = ws.tlsAddress().port;

    const viaTls = (p) => tls.connect({ port: p, host: '127.0.0.1', rejectUnauthorized: false });
    const ann = await wsConnect(tport, '/ws?db=demo', { Cookie: 'idb_demo=good', Origin: 'https://ideav.ru' }, viaTls);
    assert.equal(ann.status, 101, 'wss на своём порту');
    assert.deepEqual(await ann.next(), { op: 'hello', db: 'demo', user: 'ann' });
    ann.send({ op: 'sub', t: 500, shown: [11] });
    assert.deepEqual(await ann.next(), { op: 'sub', t: 500, ok: true });

    // события ядро шлёт на внутренний порт — подписчик TLS-порта их получает
    await push(ws.address().port, { db: 'demo', by: 'bob', events: [{ k: 'change', op: 'update', id: 11, up: 1, t: 500, types: [500], chain: [[11, 500]] }] });
    const m = await ann.next();
    assert.equal(m.op, 'rows');
    assert.deepEqual(m.rows.map((r) => r.i), [11]);

    // на TLS-порту только web-socket: ни /push, ни /health
    const get = (pathname, method) => new Promise((res) => {
        const r = require('https').request({ host: '127.0.0.1', port: tport, path: pathname, method, rejectUnauthorized: false }, (x) => { x.resume(); res(x.statusCode); });
        r.on('error', () => res(0));
        r.end(method === 'POST' ? '{}' : undefined);
    });
    assert.equal(await get('/push', 'POST'), 404);
    assert.equal(await get('/health', 'GET'), 404);
    ann.close();
});
