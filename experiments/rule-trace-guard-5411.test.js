// issue #5411: сторож scripts/check-rule-trace.sh — «у правила ТЗ есть тест, у теста есть правило».
//
// Тест поведенческий: во временном git-репозитории база = main с маленьким ТЗ, реестром и двумя
// тестами планирования; ветка PR меняет файлы, сторож прогоняется против main, утверждаем о коде
// выхода. Метки: `{#R-…}` в ТЗ плюс id инвариантов реестра; тест объявляет `// rules: …`.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const GUARD = path.join(__dirname, '..', 'scripts', 'check-rule-trace.sh');

const BASE_FILES = {
  'docs/atex_planning_tz.md': '# ТЗ\n\n## 12.1 Фольга {#R-12.1-foil-end}\n\nФольга в конец дня.\n',
  'download/atex/js/production-planning/05-invariants.js':
    "var PP_INVARIANTS = [\n  { id: 'FROZEN_DAY', tz: '§15' },\n  { id: 'DAY_CAPACITY', tz: '§15' }\n];\n",
  'experiments/atex-pp-1-old.test.js': '// старый тест без метки\n',
  'experiments/atex-pp-2-old.test.js': '// старый тест\n// rules: R-12.1-foil-end\n',
  // непокрыты FROZEN_DAY и DAY_CAPACITY; без rules: — atex-pp-1-old
  'scripts/rule-trace-baseline.txt': 'uncovered_labels=2\ntests_without_rules=1\n',
};

function sh(cwd, cmd, args, env) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', env: Object.assign({}, process.env, env || {}) });
  if (r.error) throw r.error;
  return r;
}

function writeAll(dir, files) {
  for (const [rel, body] of Object.entries(files)) {
    const p = path.join(dir, rel);
    if (body === null) { fs.rmSync(p, { force: true }); continue; }
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  }
}

// Код выхода сторожа для PR, который применяет `changes` (путь → текст | null = удалить).
function guardExit(changes, opts) {
  opts = opts || {};
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt5411-'));
  try {
    writeAll(dir, BASE_FILES);
    fs.copyFileSync(GUARD, path.join(dir, 'scripts', 'check-rule-trace.sh'));
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
    writeAll(dir, changes);
    g('add', '-A');
    g('commit', '-q', '--allow-empty', '-m', opts.commitMsg || 'pr');
    const r = sh(dir, 'bash', ['scripts/check-rule-trace.sh', 'main'], opts.env);
    return { code: r.status, out: r.stdout + r.stderr };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const BL = (u, t) => ({ 'scripts/rule-trace-baseline.txt': 'uncovered_labels=' + u + '\ntests_without_rules=' + t + '\n' });

test('ничего не изменилось — счётчики равны базису, зелёный', () => {
  const r = guardExit({});
  assert.strictEqual(r.code, 0, r.out);
});

test('новый тест планирования без rules: — красный', () => {
  const r = guardExit({ 'experiments/atex-pp-3-new.test.js': '// новый\n', ...BL(2, 2) });
  assert.strictEqual(r.code, 1, r.out);
});

test('новый тест с меткой инварианта и опущенным базисом — зелёный', () => {
  const r = guardExit({ 'experiments/atex-pp-3-new.test.js': '// новый\n// rules: FROZEN_DAY\n', ...BL(1, 1) });
  assert.strictEqual(r.code, 0, r.out);
});

test('счётчик упал, а базис не опущен — красный (храповик должен защёлкнуться)', () => {
  const r = guardExit({ 'experiments/atex-pp-1-old.test.js': '// rules: DAY_CAPACITY\n' });
  assert.strictEqual(r.code, 1, r.out);
  assert.match(r.out, /uncovered_labels=1/);
});

test('rules: none (defect #N) — тест размечен, правило не нужно', () => {
  const r = guardExit({ 'experiments/atex-pp-3-new.test.js': '// rules: none (defect #4618)\n' });
  assert.strictEqual(r.code, 0, r.out);
});

test('ссылка на несуществующую метку — красный даже с TRACE-OK', () => {
  const r = guardExit({ 'experiments/atex-pp-3-new.test.js': '// rules: R-99-gone\n' },
    { commitMsg: 'pr\n\nTRACE-OK: проверка' });
  assert.strictEqual(r.code, 1, r.out);
});

test('новая метка в ТЗ без теста — красный, TRACE-OK пропускает', () => {
  const tz = BASE_FILES['docs/atex_planning_tz.md'] + '\n## 8.2 Штраф {#R-8.2-penalty-sum}\n';
  assert.strictEqual(guardExit({ 'docs/atex_planning_tz.md': tz }).code, 1);
  const r = guardExit({ 'docs/atex_planning_tz.md': tz }, { env: { TRACE_DECLARATION: 'TRACE-OK: метка заведена, тест в PR 2' } });
  assert.strictEqual(r.code, 0, r.out);
});

test('снятая строка rules: у старого теста — красный', () => {
  const r = guardExit({ 'experiments/atex-pp-2-old.test.js': '// старый тест\n' });
  assert.strictEqual(r.code, 1, r.out);
});
