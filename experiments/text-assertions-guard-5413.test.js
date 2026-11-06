// issue #5413: сторож scripts/check-text-assertions.sh обязан ловить новые проверки по ТЕКСТУ
// исходника и в обёртках (check(…), ok(…), expect(…)), и для переменных вида formSource/coreSrc.
// Боевой пропуск — experiments/test-issue-4851-granted-absent-read-only.js:
//   check(formSource.includes("metadata.granted !== undefined ? …"))
//
// Тест поведенческий: во временном git-репозитории база = main, ветка добавляет тест-файл с
// одной строкой, сторож прогоняется против main, утверждаем о коде выхода.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const GUARD = path.join(__dirname, '..', 'scripts', 'check-text-assertions.sh');

function sh(cwd, cmd, args, env) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', env: Object.assign({}, process.env, env || {}) });
  if (r.error) throw r.error;
  return r;
}

// Возвращает код выхода сторожа для PR, который добавляет тест-файл с этими строками.
function guardExit(lines, opts) {
  opts = opts || {};
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ta5413-'));
  try {
    fs.mkdirSync(path.join(dir, 'scripts'));
    fs.mkdirSync(path.join(dir, 'experiments'));
    fs.copyFileSync(GUARD, path.join(dir, 'scripts', 'check-text-assertions.sh'));
    fs.writeFileSync(path.join(dir, 'experiments', 'keep.test.js'), '// база\n');
    const g = (...a) => {
      const r = sh(dir, 'git', a);
      assert.strictEqual(r.status, 0, 'git ' + a.join(' ') + ': ' + r.stderr);
    };
    g('init', '-q', '-b', 'main');
    g('config', 'user.email', 't@t');
    g('config', 'user.name', 't');
    g('config', 'core.autocrlf', 'false');
    g('add', '-A');
    g('commit', '-q', '-m', 'base');
    g('checkout', '-q', '-b', 'pr');
    const body = "const fs = require('fs');\n" + lines.join('\n') + '\n';
    fs.writeFileSync(path.join(dir, 'experiments', 'new-feature.test.js'), body);
    g('add', '-A');
    g('commit', '-q', '-m', opts.commitMsg || 'pr');
    const r = sh(dir, 'bash', ['scripts/check-text-assertions.sh', 'main'], opts.env);
    return { code: r.status, out: r.stdout + r.stderr };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const SRC = "const formSource = fs.readFileSync('x.js', 'utf8');";

test('обёртка check() над formSource.includes — нарушение (боевой случай 4851)', () => {
  const r = guardExit([SRC, "check(formSource.includes(\"metadata.granted !== undefined\"), 'нормализация');"]);
  assert.strictEqual(r.code, 1, r.out);
});

test('отрицание в обёртке check(!coreSource.includes(…)) — нарушение', () => {
  const r = guardExit(["const coreSource = fs.readFileSync('y.js', 'utf8');",
    "check(!coreSource.includes(\"metadataGranted !== null\"), 'старой формы нет');"]);
  assert.strictEqual(r.code, 1, r.out);
});

test('ok()/expect() и переменная tplSrc с .match — нарушение', () => {
  assert.strictEqual(guardExit(["const tplSrc = fs.readFileSync('t.html', 'utf8');",
    'ok(tplSrc.match(/data-role/g).length === 2);']).code, 1);
  assert.strictEqual(guardExit([SRC, "expect(formSource.indexOf('WRITE') >= 0);"]).code, 1);
});

test('регулярка .test(formSource) в обёртке — нарушение', () => {
  assert.strictEqual(guardExit([SRC, "check(/granted/.test(formSource), 'есть granted');"]).code, 1);
});

test('прежние формы assert(src.includes) ловятся по-прежнему', () => {
  assert.strictEqual(guardExit(["const src = fs.readFileSync('z.js', 'utf8');",
    "assert(src.includes('foo'));"]).code, 1);
});

test('поведенческие проверки в обёртке — не нарушение', () => {
  const r = guardExit([
    'const result = run();',
    "check(result.length === 2, 'две резки');",
    "check(cellText.includes('110'), 'в ячейке количество');",
    "ok(rows.some(x => x.name.includes('MR192')));",
  ]);
  assert.strictEqual(r.code, 0, r.out);
});

test('заявленное исключение TEXT-ASSERT-OK пропускает и обёртку', () => {
  const r = guardExit([SRC, "check(formSource.includes('x'));"],
    { commitMsg: 'pr\n\nTEXT-ASSERT-OK: ассет подключён в HTML' });
  assert.strictEqual(r.code, 0, r.out);
});
