// Прокси reg.ru → phpMyAdmin через Caddy (deploy/caddy/Caddyfile, блок cv5378055.regru.cloud).
// Правило: прокси reg.ru ходит на :443 сервера БЕЗ SNI; по Host cv5378055.regru.cloud путь
// phpMyAdmin доходит до Apache, прочие пути этого имени — 404 без Apache. Ловушка, которую держит
// тест: рядом стоит https:// с on-demand TLS, и без default_sni + сертификата-файла рукопожатие
// без SNI уходит в on-demand, ядро отказывает, прокси отдаёт 502.
// Боевой случай 23.11.2026: https://cv5378055.regru.cloud/<путь>/phpmyadmin/ — 502 с 21.11.
//
// Тест поднимает настоящий Caddy: глобальный default_sni и блок из Caddyfile, фейковый Apache
// по HTTPS. Нужны caddy (PATH или CADDY) и openssl, иначе пропуск.
//
// Run with: node --test experiments/caddy-regru-proxy-pma.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const tls = require('tls');
const https = require('https');
const http = require('http');
const { spawn, spawnSync } = require('child_process');

const CADDYFILE = process.env.CADDYFILE || path.join(__dirname, '..', 'deploy', 'caddy', 'Caddyfile');
const CADDY = process.env.CADDY || 'caddy';
const HOST = 'cv5378055.regru.cloud';
const skip = (spawnSync(CADDY, ['version']).error && 'нет caddy') || (spawnSync('openssl', ['version']).error && 'нет openssl');

const freePort = () => new Promise((res) => {
  const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
});

// HTTP/1.1 поверх TLS без SNI — так, как ходит прокси reg.ru.
const getNoSni = (port, host, p) => new Promise((res, rej) => {
  const sock = tls.connect({ host: '127.0.0.1', port, rejectUnauthorized: false }, () => {
    sock.write(`GET ${p} HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`);
  });
  let buf = '';
  sock.on('data', (d) => { buf += d; });
  sock.on('end', () => res({ status: Number((buf.match(/^HTTP\/1\.1 (\d{3})/) || [])[1]), text: buf.split('\r\n\r\n').slice(1).join('\r\n\r\n') }));
  sock.on('error', rej);
});

test('прокси reg.ru без SNI: phpMyAdmin — в Apache, прочие пути — 404', { skip }, async (t) => {
  const src = fs.readFileSync(CADDYFILE, 'utf8');
  const global = (src.match(/\n\{\n([\s\S]*?)\n\}\n/) || [])[1] || '';
  const sni = (global.match(/^\tdefault_sni (\S+)$/m) || [])[1];
  assert.equal(sni, HOST, 'в глобальных опциях нет default_sni ' + HOST + ' — рукопожатие без SNI уйдёт в on-demand');
  const block = (src.match(new RegExp('\\n' + HOST.replace(/\./g, '\\.') + ' \\{\\n([\\s\\S]*?)\\n\\}\\n')) || [])[1];
  assert.ok(block, 'нет блока ' + HOST);
  // Путь phpMyAdmin — из переменной PMA_PATH (/etc/caddy/env), в репо его нет.
  const pma = '/t3stPath/phpmyadmin';

  const [up, front, plain, deny] = [await freePort(), await freePort(), await freePort(), await freePort()];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'caddy-pma-'));
  const crt = path.join(dir, 'c.pem').replace(/\\/g, '/');
  const key = path.join(dir, 'c.key').replace(/\\/g, '/');
  const gen = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=' + HOST,
    '-addext', 'subjectAltName=DNS:' + HOST, '-keyout', key, '-out', crt], { encoding: 'utf8' });
  assert.equal(gen.status, 0, 'openssl: ' + gen.stderr);

  // Фейковый Apache по HTTPS и «ядро», которое отказывает on-demand.
  const apache = https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(crt) }, (q, r) => r.end('apache ' + q.url)).listen(up, '127.0.0.1');
  const core = http.createServer((q, r) => { r.statusCode = 404; r.end(); }).listen(deny, '127.0.0.1');
  const body = block
    .replace(/^\ttls \S+ \S+$/m, `\ttls ${crt} ${key}`)
    .split('https://127.0.0.1:8443').join(`https://127.0.0.1:${up}`);
  const conf = path.join(dir, 'Caddyfile');
  fs.writeFileSync(conf, `{
	admin off
	http_port ${plain}
	https_port ${front}
	default_sni ${sni}
	auto_https disable_redirects
	storage file_system ${path.join(dir, 'data').replace(/\\/g, '/')}
	on_demand_tls {
		ask http://127.0.0.1:${deny}/
	}
}
https:// {
	bind 127.0.0.1
	tls {
		on_demand
	}
	respond "ondemand"
}
${HOST} {
	bind 127.0.0.1
${body}
}
`);
  const proc = spawn(CADDY, ['run', '--adapter', 'caddyfile', '--config', conf], {
    stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, PMA_PATH: pma },
  });
  let log = '';
  proc.stderr.on('data', (d) => { log += d; });
  t.after(async () => {
    const exited = proc.exitCode !== null ? Promise.resolve() : new Promise((r) => proc.once('exit', r));
    proc.kill();
    await exited;
    apache.close(); core.close();
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  let r = null;
  for (let i = 0; i < 50 && !r; i++) {
    try { r = await getNoSni(front, HOST, pma + '/'); } catch { await new Promise((res) => setTimeout(res, 100)); }
  }
  assert.ok(r, 'рукопожатие без SNI не прошло:\n' + log.slice(-2000));
  assert.equal(r.status, 200, 'phpMyAdmin без SNI: статус');
  assert.equal(r.text, 'apache ' + pma + '/', 'phpMyAdmin без SNI дошёл до Apache');
  const idx = await getNoSni(front, HOST, pma + '/index.php?route=/');
  assert.equal(idx.text, 'apache ' + pma + '/index.php?route=/', 'index.php с запросом — в Apache как есть');
  for (const p of ['/', '/other/phpmyadmin/', '/__pma_path_not_set__/']) {
    const other = await getNoSni(front, HOST, p);
    assert.equal(other.status, 404, `${HOST}${p}: статус`);
    assert.ok(!other.text.includes('apache'), `${HOST}${p} ушёл в Apache`);
  }
});
