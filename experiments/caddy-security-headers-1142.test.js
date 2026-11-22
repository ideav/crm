// python2node#1142 — защитные заголовки ideav.ru ставит Caddy (deploy/caddy/Caddyfile), на всех путях.
// Правило: ответ ideav.ru несёт HSTS на год, XFO, nosniff, Referrer-Policy и CSP frame-ancestors —
// и там, где Apache их не прислал (/my/, ядро), и без дублей там, где прислал (.htaccess вебрута);
// чужие сайты сервера (тот же сниппет apache) заголовки не получают.
// Боевой случай 22.11.2026: ideav.ru/ — заголовки есть, ideav.ru/my/ — ни одного.
//
// Тест поднимает настоящий Caddy: блок заголовков из Caddyfile перед фейковым Apache.
// Нужен caddy в PATH или в переменной CADDY, иначе пропуск.
//
// Run with: node --test experiments/caddy-security-headers-1142.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const http = require('http');
const { spawn, spawnSync } = require('child_process');

const CADDYFILE = path.join(__dirname, '..', 'deploy', 'caddy', 'Caddyfile');
const CADDY = process.env.CADDY || 'caddy';
const skip = spawnSync(CADDY, ['version'], { encoding: 'utf8' }).error && 'нет caddy';

const freePort = () => new Promise((res) => {
  const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
});

const get = (port, host, p) => new Promise((res, rej) => {
  const req = http.get({ host: '127.0.0.1', port, path: p, headers: { Host: host } }, (r) => {
    r.resume(); r.on('end', () => res(r));
  });
  req.on('error', rej);
});

// Строки блока заголовков из сниппета (apache): матчер @ideav и header @ideav { … }.
function headerBlock() {
  const src = fs.readFileSync(CADDYFILE, 'utf8');
  const snippet = (src.match(/\n\(apache\) \{\n([\s\S]*?)\n\}\n/) || [])[1] || '';
  const lines = snippet.split('\n');
  const out = [];
  let depth = 0;
  for (const l of lines) {
    if (depth === 0 && /^\t@ideav\s/.test(l)) { out.push(l); continue; }
    if (depth === 0 && /^\theader @ideav \{/.test(l)) { depth = 1; out.push(l); continue; }
    if (depth > 0) { out.push(l); if (/^\t\}/.test(l)) depth = 0; }
  }
  return out.join('\n');
}

const WANT = {
  'strict-transport-security': 'max-age=31536000',
  'x-frame-options': 'SAMEORIGIN',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
};

test('Caddy ставит заголовки ideav.ru на всех путях, без дублей, только для ideav.ru', { skip }, async (t) => {
  const [up, front] = [await freePort(), await freePort()];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'caddy1142-'));
  const conf = path.join(dir, 'Caddyfile');
  fs.writeFileSync(conf, `{
	admin off
	auto_https off
}
# Фейковый Apache: /with — как вебрут с .htaccess (HSTS 300 + XFO), остальное — как /my/ без заголовков.
http://127.0.0.1:${up} {
	bind 127.0.0.1
	handle /with {
		header Strict-Transport-Security "max-age=300"
		header X-Frame-Options SAMEORIGIN
		respond "with"
	}
	respond "bare"
}
http://ideav.ru:${front}, http://www.ideav.ru:${front}, http://blog.ideav.ru:${front} {
	bind 127.0.0.1
${headerBlock()}
	reverse_proxy 127.0.0.1:${up}
}
`);
  const proc = spawn(CADDY, ['run', '--adapter', 'caddyfile', '--config', conf], { stdio: ['ignore', 'ignore', 'pipe'] });
  let log = '';
  proc.stderr.on('data', (d) => { log += d; });
  t.after(() => { proc.kill(); fs.rmSync(dir, { recursive: true, force: true }); });

  let ready = false;
  for (let i = 0; i < 50 && !ready; i++) {
    try { await get(front, 'blog.ideav.ru', '/'); ready = true; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  assert.ok(ready, 'caddy не поднялся:\n' + log.slice(-2000));

  for (const host of ['ideav.ru', 'www.ideav.ru']) {
    for (const p of ['/my/', '/with']) {
      const r = await get(front, host, p);
      for (const [h, v] of Object.entries(WANT)) {
        assert.equal(r.headers[h], v, `${host}${p}: ${h}`);
      }
      assert.match(r.headers['content-security-policy'] || '', /^frame-ancestors 'self' /, `${host}${p}: CSP`);
      const xfo = r.rawHeaders.filter((x, i) => i % 2 === 0 && x.toLowerCase() === 'x-frame-options');
      assert.equal(xfo.length, 1, `${host}${p}: X-Frame-Options ровно один`);
    }
  }

  const other = await get(front, 'blog.ideav.ru', '/my/');
  assert.equal(other.headers['x-frame-options'], undefined, 'blog.ideav.ru: XFO не ставится');
  assert.equal(other.headers['strict-transport-security'], undefined, 'blog.ideav.ru: HSTS не ставится');
});
