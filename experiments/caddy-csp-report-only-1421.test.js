// python2node#1421 — CSP для скриптов и стилей ideav.ru: сначала report-only, отчёты — в журнал Caddy.
// Правило: ответ ideav.ru/www.ideav.ru несёт Content-Security-Policy-Report-Only со script-src и
// style-src без 'unsafe-inline' и с report-uri /_csp-report; POST на /_csp-report отвечает 204, в Apache
// не уходит и пишет тело отчёта строкой JSON в журнал csp-report.log (тело — не больше 8 КБ);
// обычные запросы в этот журнал не попадают; чужие сайты сервера заголовка не получают, а их
// /_csp-report уходит в Apache как обычный путь.
//
// Тест поднимает настоящий Caddy: начало сниппета (apache) из Caddyfile (до web-socket) перед
// фейковым Apache. Нужен caddy в PATH или в переменной CADDY, иначе пропуск.
// CADDYFILE — другой Caddyfile (для прогона на версии до правки).
//
// Run with: node --test experiments/caddy-csp-report-only-1421.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const http = require('http');
const { spawn, spawnSync } = require('child_process');

const CADDYFILE = process.env.CADDYFILE || path.join(__dirname, '..', 'deploy', 'caddy', 'Caddyfile');
const CADDY = process.env.CADDY || 'caddy';
const skip = spawnSync(CADDY, ['version'], { encoding: 'utf8' }).error && 'нет caddy';
const PROD_LOG = '/var/log/caddy/csp-report.log';

const freePort = () => new Promise((res) => {
  const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
});

const request = (port, host, p, method = 'GET', body = null, type = 'application/csp-report') => new Promise((res, rej) => {
  const headers = { Host: host };
  if (body !== null) { headers['Content-Type'] = type; headers['Content-Length'] = Buffer.byteLength(body); }
  const req = http.request({ host: '127.0.0.1', port, path: p, method, headers }, (r) => {
    let text = '';
    r.setEncoding('utf8');
    r.on('data', (d) => { text += d; });
    r.on('end', () => { r.text = text; res(r); });
  });
  req.on('error', rej);
  if (body !== null) req.write(body);
  req.end();
});

// Сниппет (apache) до блока web-socket: заголовки, матчеры и журнал отчётов CSP.
function snippetHead(logFile) {
  const src = fs.readFileSync(CADDYFILE, 'utf8');
  const snippet = (src.match(/\n\(apache\) \{\n([\s\S]*?)\n\}\n/) || [])[1] || '';
  const head = snippet.split(/\n\t@ws \{\n/)[0];
  return head.split(PROD_LOG).join(logFile.replace(/\\/g, '/'));
}

const readLog = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

test('ideav.ru: CSP report-only для скриптов и стилей, отчёты — в журнал Caddy', { skip }, async (t) => {
  const [up, front] = [await freePort(), await freePort()];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'caddy1421-'));
  const conf = path.join(dir, 'Caddyfile');
  const logFile = path.join(dir, 'csp-report.log');
  fs.writeFileSync(conf, `{
	admin off
	auto_https off
}
# Фейковый Apache: отвечает «apache» с путём — видно, что запрос дошёл до него.
http://:${up} {
	bind 127.0.0.1
	respond "apache {path}"
}
(apache) {
${snippetHead(logFile)}
	handle {
		reverse_proxy 127.0.0.1:${up}
	}
}
http://ideav.ru:${front}, http://www.ideav.ru:${front} {
	bind 127.0.0.1
	import apache
}
http://blog.ideav.ru:${front} {
	bind 127.0.0.1
	import apache
}
`);
  const proc = spawn(CADDY, ['run', '--adapter', 'caddyfile', '--config', conf], { stdio: ['ignore', 'ignore', 'pipe'] });
  let log = '';
  proc.stderr.on('data', (d) => { log += d; });
  // Caddy держит журнал открытым: каталог удаляется после выхода процесса (на Windows — иначе EPERM).
  t.after(async () => {
    const exited = proc.exitCode !== null ? Promise.resolve() : new Promise((r) => proc.once('exit', r));
    proc.kill();
    await exited;
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  let ready = false;
  for (let i = 0; i < 50 && !ready; i++) {
    try { await request(front, 'blog.ideav.ru', '/'); ready = true; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  assert.ok(ready, 'caddy не поднялся:\n' + log.slice(-2000));

  // Заголовок на всех путях ideav.ru, включая ядро и /my/.
  for (const host of ['ideav.ru', 'www.ideav.ru']) {
    for (const p of ['/', '/my/', '/demo/object/18']) {
      const r = await request(front, host, p);
      const csp = r.headers['content-security-policy-report-only'] || '';
      assert.ok(csp, `${host}${p}: нет Content-Security-Policy-Report-Only`);
      const dirs = Object.fromEntries(csp.split(';').map((d) => d.trim().split(/\s+/)).filter((d) => d[0]).map((d) => [d[0], d.slice(1)]));
      for (const d of ['script-src', 'style-src']) {
        assert.ok(dirs[d], `${host}${p}: нет ${d}`);
        assert.ok(dirs[d].includes("'self'"), `${host}${p}: ${d} без 'self'`);
        assert.ok(!dirs[d].includes("'unsafe-inline'"), `${host}${p}: ${d} с 'unsafe-inline' — inline не попадёт в отчёты`);
      }
      assert.ok(dirs['script-src'].includes('https://mc.yandex.ru'), `${host}${p}: Метрика не в script-src`);
      assert.deepEqual(dirs['report-uri'], ['/_csp-report'], `${host}${p}: report-uri`);
      assert.match(r.headers['content-security-policy'] || '', /^frame-ancestors /, `${host}${p}: боевая CSP frame-ancestors на месте`);
    }
  }

  // Отчёт: 204, в Apache не идёт, тело — в журнал.
  const report = JSON.stringify({ 'csp-report': { 'document-uri': 'https://ideav.ru/my/', 'violated-directive': 'script-src-elem', 'blocked-uri': 'inline' } });
  const r = await request(front, 'ideav.ru', '/_csp-report', 'POST', report);
  assert.equal(r.statusCode, 204, '/_csp-report: статус');
  assert.ok(!r.text.includes('apache'), '/_csp-report ушёл в Apache');
  await request(front, 'www.ideav.ru', '/_csp-report', 'POST', report.replace('/my/', '/www/'));

  // Обрезка тела и чужие запросы.
  await request(front, 'ideav.ru', '/_csp-report', 'POST', 'x'.repeat(50000));
  await request(front, 'ideav.ru', '/my/');
  await request(front, 'ideav.ru', '/_csp-report');
  const other = await request(front, 'blog.ideav.ru', '/_csp-report', 'POST', report);
  assert.equal(other.text, 'apache /_csp-report', 'blog.ideav.ru: /_csp-report — обычный путь Apache');
  const blog = await request(front, 'blog.ideav.ru', '/');
  assert.equal(blog.headers['content-security-policy-report-only'], undefined, 'blog.ideav.ru: заголовок не ставится');

  let lines = [];
  for (let i = 0; i < 30 && lines.length < 3; i++) { await new Promise((res) => setTimeout(res, 100)); lines = readLog(logFile); }
  assert.equal(lines.length, 3, 'в журнале ровно три отчёта, без обычных запросов:\n' + JSON.stringify(lines.map((l) => l.request && l.request.uri)));
  for (const l of lines) {
    assert.equal(l.request.uri, '/_csp-report');
    assert.equal(l.request.method, 'POST');
    assert.equal(l.status, 204);
  }
  assert.deepEqual(JSON.parse(lines[0].csp_report), JSON.parse(report), 'тело отчёта ideav.ru в поле csp_report');
  assert.equal(JSON.parse(lines[1].csp_report)['csp-report']['document-uri'], 'https://ideav.ru/www/', 'отчёт www.ideav.ru');
  assert.ok(lines[2].csp_report.length <= 8 * 1024 + 1, `тело обрезано до 8 КБ, а в журнале ${lines[2].csp_report.length}`);
  assert.ok(!log.includes('csp_report'), 'отчёты дублируются в общий журнал (journald)');
});
