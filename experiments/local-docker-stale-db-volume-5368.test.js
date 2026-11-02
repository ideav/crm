// #5368: переустановка локального Docker поверх старого тома БД.
// Скрипты запускаются по-настоящему, docker/mysql подменены заглушками в PATH.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repo = path.resolve(__dirname, '..');

function sandbox(stubs) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'i5368-'));
    const bin = path.join(dir, 'bin');
    fs.mkdirSync(bin);
    fs.mkdirSync(path.join(dir, 'scripts'));
    fs.mkdirSync(path.join(dir, 'docker'));
    for (const [name, body] of Object.entries(stubs)) {
        fs.writeFileSync(path.join(bin, name), '#!/usr/bin/env bash\n' + body + '\n', { mode: 0o755 });
    }
    return { dir, bin, log: path.join(dir, 'calls.log') };
}

function run(sb, script, input, env) {
    const res = spawnSync('bash', [script], {
        cwd: sb.dir,
        input,
        encoding: 'utf8',
        env: { ...process.env, ...env, CALLS_LOG: sb.log, PATH: sb.bin + path.delimiter + process.env.PATH },
    });
    const calls = fs.existsSync(sb.log) ? fs.readFileSync(sb.log, 'utf8') : '';
    return { code: res.status, out: res.stdout + res.stderr, calls };
}

const DOCKER = [
    'echo "docker $*" >> "$CALLS_LOG"',
    'case "$1 $2" in',
    '  "compose version") exit 0 ;;',
    '  "volume ls") [[ "${HAS_VOLUME:-}" == 1 ]] && echo integram-local_integram-db; exit 0 ;;',
    '  "ps -aq") echo c1; exit 0 ;;',
    'esac',
    'exit 0',
].join('\n');
const OPENSSL = [
    'if [[ "$1" == rand ]]; then echo stubrand; exit 0; fi',
    'while [[ $# -gt 0 ]]; do case "$1" in -keyout|-out) echo k > "$2"; shift ;; esac; shift; done',
].join('\n');

function installer(env) {
    const sb = sandbox({ docker: DOCKER, openssl: OPENSSL });
    fs.copyFileSync(path.join(repo, 'scripts/install-local-docker.sh'), path.join(sb.dir, 'scripts/install.sh'));
    const r = run(sb, 'scripts/install.sh', 'password1\npassword1\n', env);
    r.envCreated = fs.existsSync(path.join(sb.dir, '.env.local'));
    return r;
}

test('installer: no old DB volume -> installs as before', () => {
    const r = installer({ HAS_VOLUME: '0' });
    assert.strictEqual(r.code, 0, r.out);
    assert.ok(r.envCreated);
    assert.match(r.calls, /docker compose --env-file \.env\.local up -d --build/);
    assert.doesNotMatch(r.calls, /docker volume rm/);
});

test('installer: old DB volume -> stops before new passwords, keeps the volume', () => {
    const r = installer({ HAS_VOLUME: '1' });
    assert.notStrictEqual(r.code, 0, r.out);
    assert.ok(!r.envCreated, '.env.local with new passwords must not be written');
    assert.doesNotMatch(r.calls, /up -d/);
    assert.doesNotMatch(r.calls, /volume rm/);
    assert.match(r.out, /integram-local_integram-db/);
    assert.match(r.out, /INTEGRAM_RESET_DB=1/);
});

test('installer: old DB volume + INTEGRAM_RESET_DB=1 -> drops it, then installs', () => {
    const r = installer({ HAS_VOLUME: '1', INTEGRAM_RESET_DB: '1' });
    assert.strictEqual(r.code, 0, r.out);
    assert.ok(r.envCreated);
    const rm = r.calls.indexOf('docker volume rm integram-local_integram-db');
    const up = r.calls.indexOf('up -d --build');
    assert.ok(rm >= 0 && up > rm, r.calls);
});

test('entrypoint: DB rejects the password -> explains the stale volume, no bootstrap', () => {
    const sb = sandbox({
        mysqladmin: 'exit 0', // ping succeeds even on Access denied
        mysql: [
            'echo "mysql $*" >> "$CALLS_LOG"',
            'echo "ERROR 1045 (28000): Access denied for user \'ideav\'@\'172.18.0.3\' (using password: YES)" >&2',
            'exit 1',
        ].join('\n'),
    });
    const certs = path.join(sb.dir, 'certs');
    fs.mkdirSync(certs);
    fs.writeFileSync(path.join(certs, 'local.crt'), 'c');
    fs.writeFileSync(path.join(certs, 'local.key'), 'k');
    fs.copyFileSync(path.join(repo, 'docker/entrypoint.sh'), path.join(sb.dir, 'docker/entrypoint.sh'));
    const r = run(sb, 'docker/entrypoint.sh', '', { INTEGRAM_CERT_DIR: certs });
    assert.notStrictEqual(r.code, 0, r.out);
    assert.match(r.out, /ERROR 1045/);
    assert.match(r.out, /integram-db volume/);
    assert.match(r.out, /down -v/);
    assert.strictEqual(r.calls.trim().split('\n').length, 1, 'only the login check runs: ' + r.calls);
});
