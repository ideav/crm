'use strict';
// Демон web-socket Интеграма (issue #5269). Описание и выкладка — docs/kb/realtime.md.
//
//   GET  /ws?db=<база>  (Upgrade: websocket) — подключение браузера или внешнего клиента.
//        Вход — куки idb_<база> или заголовок X-Authorization / Authorization, как у API ядра;
//        демон проверяет его вызовом ядра GET /<база>/ws_auth?JSON.
//   POST /push — пачка событий от ядра (include/ws_push.php), подпись X-Ws-Signature =
//        HMAC-SHA256(тело, WS_SECRET).
//   GET  /health — число подключений.
//
// Сообщения клиента: {op:"sub",t}, {op:"unsub",t}, {op:"ping"}. Подписка на таблицу (тип) —
// только с правом чтения, его проверяет ядро (ws_auth?JSON&t=<тип>).
// Сообщения демона: {op:"hello",db,user}, {op:"sub",t,ok}, {op:"unsub",t[,revoked]},
// {op:"events",by,reload,events:[…]}, {op:"notify",from,data}, {op:"pong"}.

const http = require('http');
const crypto = require('crypto');
const frames = require('./lib/frames');
const { Hub } = require('./lib/hub');

const DB_MASK = /^[A-Za-z0-9_]{1,64}$/;
const MAX_PUSH_BYTES = 4 << 20;
const MAX_MSG_BYTES = 64 << 10;
const MAX_SUBS = 100;

function pickCookie(header, name) {
    for (const part of String(header || '').split(';')) {
        const eq = part.indexOf('=');
        if (eq > 0 && part.slice(0, eq).trim() === name) return `${name}=${part.slice(eq + 1).trim()}`;
    }
    return '';
}

function signatureOk(body, sig, secret) {
    if (!secret || typeof sig !== 'string' || !/^[0-9a-f]{64}$/i.test(sig)) return false;
    const want = crypto.createHmac('sha256', secret).update(body).digest();
    return crypto.timingSafeEqual(want, Buffer.from(sig, 'hex'));
}

function createWsServer(options) {
    const o = Object.assign({
        coreUrl: '', secret: '', allowedOrigins: [], reauthMs: 5 * 60 * 1000, pingMs: 30 * 1000,
        maxClients: 5000, fetch: globalThis.fetch, log: () => {},
    }, options);
    const coreBase = String(o.coreUrl).replace(/\/+$/, '');
    const hub = new Hub();
    const clients = new Set();
    const server = http.createServer(onRequest);
    server.on('upgrade', (req, socket, head) => {
        onUpgrade(req, socket, head).catch((e) => { o.log('upgrade: ' + e.message); socket.destroy(); });
    });
    let pingTimer = null;
    if (o.pingMs > 0) pingTimer = setInterval(pingAll, o.pingMs);

    // Ядро: {status:"ok",data} | {status:"denied"} | {status:"error"} (ядро недоступно)
    async function coreAuth(db, creds, t) {
        const url = `${coreBase}/${db}/ws_auth?JSON` + (t === undefined ? '' : `&t=${t}`);
        const headers = {};
        if (creds.cookie) headers.cookie = creds.cookie;
        if (creds.xauth) headers['x-authorization'] = creds.xauth;
        if (creds.auth) headers.authorization = creds.auth;
        try {
            const r = await o.fetch(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(5000) });
            if (r.status === 401 || r.status === 403 || (r.status >= 300 && r.status < 400)) return { status: 'denied' };
            if (r.status !== 200) return { status: 'error' };
            const data = await r.json();
            return data && typeof data.user === 'string' && data.user ? { status: 'ok', data } : { status: 'denied' };
        } catch (e) {
            return { status: 'error' };
        }
    }

    function onRequest(req, res) {
        const path = req.url.split('?')[0];
        if (req.method === 'GET' && path === '/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ clients: clients.size }));
        }
        if (req.method !== 'POST' || path !== '/push') {
            res.writeHead(404);
            return res.end();
        }
        if (!o.secret) {
            res.writeHead(503);
            return res.end();
        }
        const chunks = [];
        let size = 0;
        req.on('data', (c) => {
            size += c.length;
            if (size > MAX_PUSH_BYTES) {
                res.writeHead(413);
                res.end();
                req.destroy();
                return;
            }
            chunks.push(c);
        });
        req.on('end', () => {
            if (res.writableEnded) return;
            const body = Buffer.concat(chunks);
            if (!signatureOk(body, req.headers['x-ws-signature'], o.secret)) {
                res.writeHead(401);
                return res.end();
            }
            let payload;
            try {
                payload = JSON.parse(body.toString('utf8'));
            } catch (e) {
                payload = null;
            }
            if (!payload || typeof payload.db !== 'string' || !DB_MASK.test(payload.db)) {
                res.writeHead(400);
                return res.end();
            }
            hub.route(payload);
            res.writeHead(204);
            res.end();
        });
    }

    function reject(socket, code, text) {
        socket.end(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    }

    // Браузер шлёт куки и на чужой сайт: подключение со страницы другого сайта (Origin) не
    // принимается. Свой сайт — тот же хост, что в Host, или из WS_ALLOWED_ORIGINS.
    function originOk(req) {
        const origin = req.headers.origin;
        if (!origin) return true;
        if (o.allowedOrigins.includes(origin)) return true;
        try {
            return new URL(origin).host === req.headers.host;
        } catch (e) {
            return false;
        }
    }

    async function onUpgrade(req, socket, head) {
        socket.on('error', () => {});
        const url = new URL(req.url, 'http://local');
        const key = req.headers['sec-websocket-key'];
        if (!/\/ws\/?$/.test(url.pathname) || String(req.headers.upgrade).toLowerCase() !== 'websocket'
            || req.headers['sec-websocket-version'] !== '13' || !key) return reject(socket, 400, 'Bad Request');
        const db = url.searchParams.get('db') || '';
        if (!DB_MASK.test(db)) return reject(socket, 400, 'Bad Request');
        if (!originOk(req)) return reject(socket, 403, 'Forbidden');
        if (clients.size >= o.maxClients) return reject(socket, 503, 'Service Unavailable');
        const creds = {
            cookie: pickCookie(req.headers.cookie, `idb_${db}`),
            xauth: req.headers['x-authorization'] || '',
            auth: req.headers.authorization || '',
        };
        if (!creds.cookie && !creds.xauth && !creds.auth) return reject(socket, 401, 'Unauthorized');
        const auth = await coreAuth(db, creds);
        if (socket.destroyed) return;
        if (auth.status === 'denied') return reject(socket, 401, 'Unauthorized');
        if (auth.status !== 'ok') return reject(socket, 503, 'Service Unavailable');
        socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
            + `Sec-WebSocket-Accept: ${frames.acceptKey(key)}\r\n\r\n`);
        attach(socket, head, db, auth.data.user, creds);
    }

    function attach(socket, head, db, user, creds) {
        socket.setNoDelay(true);
        const reader = new frames.FrameReader({ requireMask: true, maxPayload: MAX_MSG_BYTES });
        const client = {
            db, user, creds, socket, subs: new Set(), alive: true, timer: null,
            send(obj) {
                if (!socket.destroyed) socket.write(frames.encodeFrame(frames.OP_TEXT, Buffer.from(JSON.stringify(obj))));
            },
        };
        clients.add(client);
        hub.add(client);
        const cleanup = () => {
            if (client.timer) clearInterval(client.timer);
            clients.delete(client);
            hub.remove(client);
        };
        socket.on('close', cleanup);
        socket.on('data', (chunk) => onData(client, reader, chunk));
        if (o.reauthMs > 0) client.timer = setInterval(() => reauth(client), o.reauthMs);
        client.send({ op: 'hello', db, user });
        if (head && head.length) onData(client, reader, head);
    }

    function closeClient(client, code, reason) {
        const payload = Buffer.alloc(2 + Buffer.byteLength(reason || ''));
        payload.writeUInt16BE(code, 0);
        payload.write(reason || '', 2);
        if (!client.socket.destroyed) client.socket.end(frames.encodeFrame(frames.OP_CLOSE, payload));
        setTimeout(() => client.socket.destroy(), 1000).unref();
    }

    function onData(client, reader, chunk) {
        let messages;
        try {
            messages = reader.push(chunk);
        } catch (e) {
            return closeClient(client, 1002, 'protocol error');
        }
        for (const m of messages) {
            if (m.opcode === frames.OP_PING) client.socket.write(frames.encodeFrame(frames.OP_PONG, m.payload));
            else if (m.opcode === frames.OP_PONG) client.alive = true;
            else if (m.opcode === frames.OP_CLOSE) closeClient(client, 1000, '');
            else if (m.opcode === frames.OP_TEXT) {
                client.alive = true;
                let msg = null;
                try {
                    msg = JSON.parse(m.payload.toString('utf8'));
                } catch (e) { /* не JSON — пропуск */ }
                if (msg && typeof msg === 'object') onMessage(client, msg).catch((e) => o.log('message: ' + e.message));
            }
        }
    }

    async function onMessage(client, msg) {
        const t = Number(msg.t);
        const typeOk = Number.isInteger(t) && t > 0;
        if (msg.op === 'ping') return client.send({ op: 'pong' });
        if (msg.op === 'unsub' && typeOk) {
            client.subs.delete(t);
            return client.send({ op: 'unsub', t });
        }
        if (msg.op !== 'sub' || !typeOk) return;
        if (client.subs.has(t)) return client.send({ op: 'sub', t, ok: true });
        let ok = false;
        if (client.subs.size < MAX_SUBS) {
            const a = await coreAuth(client.db, client.creds, t);
            ok = a.status === 'ok' && a.data.read === true;
        }
        if (ok) client.subs.add(t);
        client.send({ op: 'sub', t, ok });
    }

    // Вход отозван (выход, смена пароля, блокировка) — соединение закрывается кодом 4401;
    // право на таблицу снято — подписка снимается. Ядро недоступно — ничего не меняется.
    async function reauth(client) {
        const a = await coreAuth(client.db, client.creds);
        if (a.status === 'denied') return closeClient(client, 4401, 'unauthorized');
        if (a.status !== 'ok') return;
        for (const t of [...client.subs]) {
            const r = await coreAuth(client.db, client.creds, t);
            if (r.status === 'ok' && r.data.read !== true) {
                client.subs.delete(t);
                client.send({ op: 'unsub', t, revoked: true });
            }
        }
    }

    function pingAll() {
        for (const client of clients) {
            if (!client.alive) {
                client.socket.destroy();
                continue;
            }
            client.alive = false;
            if (!client.socket.destroyed) client.socket.write(frames.encodeFrame(frames.OP_PING, Buffer.alloc(0)));
        }
    }

    return {
        hub,
        server,
        clients,
        listen(port, host) {
            return new Promise((resolve) => server.listen(port, host, resolve));
        },
        address() {
            return server.address();
        },
        close() {
            if (pingTimer) clearInterval(pingTimer);
            for (const c of clients) {
                if (c.timer) clearInterval(c.timer);
                c.socket.destroy();
            }
            return new Promise((resolve) => server.close(() => resolve()));
        },
    };
}

module.exports = { createWsServer, pickCookie, signatureOk };

if (require.main === module) {
    const env = process.env;
    if (!env.WS_CORE_URL || !env.WS_SECRET) {
        console.error('ws-server: нужны WS_CORE_URL (например https://ideav.ru) и WS_SECRET (= INTEGRAM_WS_SECRET ядра)');
        process.exit(1);
    }
    const ws = createWsServer({
        coreUrl: env.WS_CORE_URL,
        secret: env.WS_SECRET,
        allowedOrigins: (env.WS_ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
        reauthMs: Number(env.WS_REAUTH_SEC || 300) * 1000,
        log: (m) => console.error(new Date().toISOString(), m),
    });
    const port = Number(env.WS_PORT || 8790);
    const host = env.WS_HOST || '127.0.0.1';
    ws.listen(port, host).then(() => console.log(`ws-server: ${host}:${port}, ядро ${env.WS_CORE_URL}`));
    const stop = () => ws.close().then(() => process.exit(0));
    process.on('SIGTERM', stop);
    process.on('SIGINT', stop);
}
