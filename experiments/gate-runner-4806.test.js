// #4806 — scripts/run-tests.sh не запускался на Windows: весь список гейта уходил в
// `node --test` ОДНОЙ командой, а Windows режет командную строку на 32767 символах.
// На 693 файлах строка аргументов — 34 КБ, и гейт падал с `Argument list too long`,
// не выполнив ни одного теста.
//
// Проверяем ПОВЕДЕНИЕ скрипта, а не его текст: подсовываем в PATH подставной `node`,
// который записывает каждый свой запуск, и смотрим, как скрипт его звал.
//   1. ни один запуск не длиннее безопасного бюджета аргументов;
//   2. пачки покрывают РОВНО набор гейта — ни один файл не потерян и не задвоен;
//   3. карантин по-прежнему исключён из гейта и прогнан отдельно;
//   4. красная пачка роняет весь прогон (код возврата не теряется за пачками).
//
// Run with: node experiments/gate-runner-4806.test.js

var fs = require('fs');
var os = require('os');
var path = require('path');
var cp = require('child_process');

var ROOT = path.join(__dirname, '..');
var SCRIPT = path.join(ROOT, 'scripts', 'run-tests.sh');

var passed = 0, total = 0;
function assert(cond, name) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    total++;
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; return; }
    console.log('  expected:', JSON.stringify(expected));
    console.log('  actual:  ', JSON.stringify(actual));
    process.exitCode = 1;
}

// Лимит командной строки Windows (CreateProcess). Держим запас: к аргументам
// добавляются путь к самому node, `--test` и окружение.
var WINDOWS_CMDLINE_LIMIT = 32767;

// Песочница: свой experiments/ с длинными именами, свой scripts/run-tests.sh и
// подставной node в PATH.
function makeSandbox(opts) {
    opts = opts || {};
    var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate4806-'));
    fs.mkdirSync(path.join(dir, 'experiments'));
    fs.mkdirSync(path.join(dir, 'scripts'));
    fs.mkdirSync(path.join(dir, 'bin'));
    fs.copyFileSync(SCRIPT, path.join(dir, 'scripts', 'run-tests.sh'));

    // Имена под стать боевым (`atex-pp-4461-fixed-day-position.test.js` — 42 символа).
    var names = [];
    for (var i = 0; i < (opts.count || 800); i++) {
        var n = 'atex-module-' + String(1000 + i) + '-some-long-behaviour-name.test.js';
        names.push(n);
        fs.writeFileSync(path.join(dir, 'experiments', n), '// пусто\n');
    }
    var quarantined = (opts.quarantine || []).map(function(i) { return names[i]; });
    fs.writeFileSync(path.join(dir, 'experiments', 'quarantine.txt'),
        '# карантин\n' + quarantined.join('\n') + (quarantined.length ? '\n' : ''));

    // Подставной node: пишет в лог свой argv и выходит с нужным кодом.
    var log = path.join(dir, 'calls.log');
    var failOn = opts.failOnBatch == null ? -1 : opts.failOnBatch;
    var shim = [
        '#!/usr/bin/env bash',
        '# Подставной node: фиксирует запуск и не выполняет ничего.',
        'printf "%s\\n" "$*" >> ' + JSON.stringify(log),
        'n=$(grep -c "" ' + JSON.stringify(log) + ')',
        'if [[ "$n" -eq ' + (failOn + 1) + ' ]]; then exit 1; fi',
        'exit 0'
    ].join('\n') + '\n';
    fs.writeFileSync(path.join(dir, 'bin', 'node'), shim);
    fs.chmodSync(path.join(dir, 'bin', 'node'), 0o755);

    return { dir: dir, log: log, names: names, quarantined: quarantined };
}

function runGate(box, args) {
    var res = cp.spawnSync('bash', [path.join(box.dir, 'scripts', 'run-tests.sh')].concat(args || []), {
        cwd: box.dir,
        encoding: 'utf8',
        env: Object.assign({}, process.env, { PATH: path.join(box.dir, 'bin') + path.delimiter + process.env.PATH })
    });
    var calls = fs.existsSync(box.log)
        ? fs.readFileSync(box.log, 'utf8').split('\n').filter(function(l) { return l.trim() !== ''; })
        : [];
    return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '', calls: calls };
}

// Файлы одного запуска подставного node (первый аргумент — «--test»).
function filesOf(call) {
    return call.split(/\s+/).filter(function(a) { return a && a !== '--test'; });
}

// ── Гейт крупнее лимита командной строки ──────────────────────────────────────────────────────
(function() {
    var box = makeSandbox({ count: 800, quarantine: [0, 5, 9] });
    var run = runGate(box);

    // Список, который скрипт ОБЯЗАН прогнать: все файлы, кроме карантинных.
    var expected = box.names.filter(function(n) { return box.quarantined.indexOf(n) === -1; })
        .map(function(n) { return 'experiments/' + n; }).sort();

    // Такой список одной командой не передать — ради этого и заводился тикет.
    var oneLine = expected.join(' ').length;
    assert(oneLine > WINDOWS_CMDLINE_LIMIT,
        '#4806: набор для проверки крупнее лимита Windows (' + oneLine + ' > ' + WINDOWS_CMDLINE_LIMIT + ')');

    assert(run.stderr.indexOf('Argument list too long') === -1,
        '#4806: гейт не падает с «Argument list too long»');

    // Запуски гейта — до карантинных (карантин скрипт гоняет по одному файлу).
    var gateCalls = run.calls.filter(function(c) { return filesOf(c).length > 1; });
    assert(gateCalls.length > 1, '#4806: список разбит на пачки, а не отправлен одной командой');

    var longest = gateCalls.reduce(function(m, c) { return Math.max(m, c.length); }, 0);
    assert(longest <= WINDOWS_CMDLINE_LIMIT,
        '#4806: самая длинная пачка укладывается в лимит (' + longest + ' ≤ ' + WINDOWS_CMDLINE_LIMIT + ')');

    // Пачки покрывают РОВНО набор гейта: ничего не потеряно и не задвоено.
    var ran = [];
    gateCalls.forEach(function(c) { ran = ran.concat(filesOf(c)); });
    assertEqual(ran.slice().sort(), expected,
        '#4806: пачки покрывают ровно набор гейта — без потерь и повторов');
    assertEqual(ran.length, new Set(ran).size,
        '#4806: ни один файл не прогнан дважды');

    // Карантин из гейта исключён и прогнан отдельно, по одному файлу.
    var quarPaths = box.quarantined.map(function(n) { return 'experiments/' + n; });
    var inGate = quarPaths.filter(function(q) { return ran.indexOf(q) !== -1; });
    assertEqual(inGate, [], '#4806: карантинные файлы в гейт не попали');
    var soloCalls = run.calls.filter(function(c) { return filesOf(c).length === 1; }).map(function(c) { return filesOf(c)[0]; });
    assertEqual(soloCalls.slice().sort(), quarPaths.slice().sort(),
        '#4806: карантин прогнан отдельно, по одному файлу');

    assertEqual(run.status, 0, '#4806: все пачки зелёные — гейт возвращает 0');
    fs.rmSync(box.dir, { recursive: true, force: true });
})();

// ── Красная пачка роняет весь прогон ──────────────────────────────────────────────────────────
(function() {
    // Ронять будем ПЕРВУЮ пачку: её код возврата не должен потеряться за следующими.
    var box = makeSandbox({ count: 800, failOnBatch: 0 });
    var run = runGate(box);
    assertEqual(run.status, 1, '#4806: красная пачка роняет гейт целиком, а не тонет за следующими');
    var gateCalls = run.calls.filter(function(c) { return filesOf(c).length > 1; });
    assert(gateCalls.length > 1, '#4806: после красной пачки остальные всё равно прогоняются');
    fs.rmSync(box.dir, { recursive: true, force: true });
})();

// ── Маленький гейт по-прежнему идёт одной командой ────────────────────────────────────────────
(function() {
    var box = makeSandbox({ count: 20 });
    var run = runGate(box);
    var gateCalls = run.calls.filter(function(c) { return filesOf(c).length > 1; });
    assertEqual(gateCalls.length, 1, '#4806: короткий список дробить незачем — одна команда');
    assertEqual(filesOf(gateCalls[0]).length, 20, '#4806: и в неё попадают все файлы');
    fs.rmSync(box.dir, { recursive: true, force: true });
})();

console.log('\n' + passed + '/' + total + ' проверок прошли');
if (passed !== total) process.exitCode = 1;
