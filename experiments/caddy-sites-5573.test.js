// #5573 — deploy/caddy/sites.sh собирает /etc/caddy/sites.caddy из вхостов ispmanager.
// Правило: список сайтов одинаковый ДО переключения (вхосты на <IP>:80/443) и ПОСЛЕ него (вхосты на
// 127.0.0.1:8080/8443 — их туда переводит apache-behind-caddy.sh, и сторож в cron пересобирает список
// уже из них), а файл читается Caddy, который работает не от root.
// Боевой случай 21.11.2026: после переключения sites.caddy вышел пустым и с правами 600 — Caddy не
// стартовал («permission denied»), откат.
//
// Run with: node --test experiments/caddy-sites-5573.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SITES = path.join(__dirname, '..', 'deploy', 'caddy', 'sites.sh');
const have = (cmd, args) => !spawnSync(cmd, args, { encoding: 'utf8' }).error;
const skip = !(have('sh', ['-c', 'true']) && have('openssl', ['version'])) && 'нет sh или openssl';

// Самоподписанный сертификат только для теста: a.test, www.a.test.
const CERT = `-----BEGIN CERTIFICATE-----
MIIBmTCCAT6gAwIBAgIUHw0PNZ/USQ8Z4ieH0lTMXo2C608wCgYIKoZIzj0EAwIw
ETEPMA0GA1UEAwwGYS50ZXN0MCAXDTI2MTEyMTEwMzgwOFoYDzIxMjYxMDI4MTAz
ODA4WjARMQ8wDQYDVQQDDAZhLnRlc3QwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNC
AATcZJLEa2Z7guvSSMmy+aublTV376KFw6Ykeda1W7Zmn7BvS1oaQjAoMW/E1ZjZ
XlD6V+pevmmzVbEGQ0PuFzdwo3IwcDAdBgNVHQ4EFgQU4ytZ9fUkeIKCqjDvsSuY
vhZCJ0MwHwYDVR0jBBgwFoAU4ytZ9fUkeIKCqjDvsSuYvhZCJ0MwDwYDVR0TAQH/
BAUwAwEB/zAdBgNVHREEFjAUggZhLnRlc3SCCnd3dy5hLnRlc3QwCgYIKoZIzj0E
AwIDSQAwRgIhANVcSMnvYM3WhQg5Sh/cnCpoRjb9i8jFpKl8Xsjn5k7HAiEAo50G
0sG4MXC69bxqw+TuShp1lGV6WF4rCnqky2uoGNM=
-----END CERTIFICATE-----
`;
const KEY = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQggCWdC+2yK+9Za9GQ
I4rDRA3nTZvo5uaBpbFExkw/FkmhRANCAATcZJLEa2Z7guvSSMmy+aublTV376KF
w6Ykeda1W7Zmn7BvS1oaQjAoMW/E1ZjZXlD6V+pevmmzVbEGQ0PuFzdw
-----END PRIVATE KEY-----
`;

function vhosts(dir, http, https) {
    fs.mkdirSync(path.join(dir, 'vhosts', 'www-root'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'a.crt'), CERT);
    fs.writeFileSync(path.join(dir, 'a.key'), KEY);
    const a = `<VirtualHost ${http}>
	ServerName a.test
	ServerAlias www.a.test
</VirtualHost>
<VirtualHost ${https}>
	ServerName a.test
	SSLEngine on
	SSLCertificateFile "${path.join(dir, 'a.crt').replace(/\\/g, '/')}"
	SSLCertificateKeyFile "${path.join(dir, 'a.key').replace(/\\/g, '/')}"
	ServerAlias www.a.test
</VirtualHost>
`;
    const b = `<VirtualHost ${http}>
	ServerName b.test
</VirtualHost>
`;
    fs.writeFileSync(path.join(dir, 'vhosts', 'www-root', 'a.test.conf'), a);
    fs.writeFileSync(path.join(dir, 'vhosts', 'www-root', 'b.test.conf'), b);
}

function build(http, https) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sites-5573-'));
    vhosts(dir, http, https);
    const out = path.join(dir, 'sites.caddy');
    const r = spawnSync('sh', [SITES], {
        encoding: 'utf8',
        env: { ...process.env, VHOSTS: path.join(dir, 'vhosts').replace(/\\/g, '/'), OUT: out.replace(/\\/g, '/'), CERTS: path.join(dir, 'certs').replace(/\\/g, '/') },
    });
    assert.equal(r.status, 0, r.stderr);
    return { text: fs.readFileSync(out, 'utf8'), mode: fs.statSync(out).mode & 0o777 };
}

for (const [name, http, https] of [
    ['до переключения: вхосты на публичном адресе', '192.168.0.74:80', '192.168.0.74:443'],
    ['после переключения: вхосты на 127.0.0.1:8080/8443', '127.0.0.1:8080', '127.0.0.1:8443'],
]) {
    test(`sites.sh — ${name}: сайт с сертификатом и сайт только с HTTP`, { skip }, () => {
        const { text } = build(http, https);
        assert.match(text, /^a\.test, www\.a\.test \{\n\ttls \S+a\.test\.pem \S+a\.test\.key\n\timport apache\n\}/m);
        assert.match(text, /^http:\/\/b\.test \{\n\timport apache_http\n\}/m);
        assert.doesNotMatch(text, /http:\/\/a\.test/, 'у сайта с сертификатом нет отдельного http-блока');
    });
}

test('sites.caddy читается не только root: Caddy работает от пользователя caddy', { skip: skip || (process.platform === 'win32' && 'права файлов на Windows не проверить') }, () => {
    const { mode } = build('127.0.0.1:8080', '127.0.0.1:8443');
    assert.equal(mode & 0o044, 0o044, 'права ' + mode.toString(8));
});

test('ни одного сайта не нашлось — ошибка, прежний sites.caddy не тронут (сторож не снесёт все сайты)', { skip }, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sites-5573-'));
    fs.mkdirSync(path.join(dir, 'vhosts', 'www-root'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'vhosts', 'www-root', 'x.conf'), '<VirtualHost 10.0.0.1:2222>\n\tServerName x.test\n</VirtualHost>\n');
    const out = path.join(dir, 'sites.caddy');
    fs.writeFileSync(out, 'old.test {\n\timport apache_http\n}\n');
    const unix = (p) => p.replace(/\\/g, '/');
    const r = spawnSync('sh', [SITES], { encoding: 'utf8', env: { ...process.env, VHOSTS: unix(path.join(dir, 'vhosts')), OUT: unix(out), CERTS: unix(path.join(dir, 'certs')) } });
    assert.notEqual(r.status, 0, 'пустой список — не успех');
    assert.equal(fs.readFileSync(out, 'utf8'), 'old.test {\n\timport apache_http\n}\n');
});
