// Стенд портала на новом ядре (ideav/courses#145): портал с ядром на одном адресе.
//   /download/courses/*  — файлы этого каталога (download/courses), content/ — из CONTENT_DIR, если задан
//   /api/*               — прокси на ядро CORE_URL (Set-Cookie без Secure, чтобы вход работал по http)
// Запуск: CORE_URL=http://127.0.0.1:8099 PORT=8145 node download/courses/dev/core-dev.cjs
// Открыть: http://localhost:8145/download/courses/core.html
const http = require('http');
const fs = require('fs');
const path = require('path');

const CORE = new URL(process.env.CORE_URL || 'http://127.0.0.1:8099');
const PORT = Number(process.env.PORT || 8145);
const ROOT = path.resolve(__dirname, '..');
const CONTENT = process.env.CONTENT_DIR ? path.resolve(process.env.CONTENT_DIR) : path.join(ROOT, 'content');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.md': 'text/plain; charset=utf-8' };

function file(res, base, rel) {
    const p = path.resolve(base, '.' + path.posix.normalize('/' + rel));
    if (!p.startsWith(base + path.sep)) { res.writeHead(403); return res.end(); }
    fs.readFile(p, (err, buf) => {
        if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('not found'); }
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
        res.end(buf);
    });
}

function proxy(req, res) {
    const headers = { ...req.headers, host: CORE.host };
    const up = http.request({ hostname: CORE.hostname, port: CORE.port || 80, path: req.url, method: req.method, headers }, r => {
        const h = { ...r.headers };
        if (h['set-cookie']) h['set-cookie'] = h['set-cookie'].map(c => c.replace(/;\s*Secure/gi, ''));
        res.writeHead(r.statusCode, h);
        r.pipe(res);
    });
    up.on('error', e => { res.writeHead(502, { 'Content-Type': 'text/plain' }); res.end('core: ' + e.message); });
    req.pipe(up);
}

http.createServer((req, res) => {
    const u = req.url.split('?')[0];
    if (u.startsWith('/api/')) return proxy(req, res);
    if (u.startsWith('/download/courses/content/')) return file(res, CONTENT, decodeURIComponent(u.slice('/download/courses/content/'.length)));
    if (u.startsWith('/download/courses/')) return file(res, ROOT, decodeURIComponent(u.slice('/download/courses/'.length)));
    if (u === '/') { res.writeHead(302, { Location: '/download/courses/core.html' }); return res.end(); }
    res.writeHead(404); res.end();
}).listen(PORT, '127.0.0.1', () => console.log(`portal on http://127.0.0.1:${PORT}/download/courses/core.html -> core ${CORE.origin}`));
