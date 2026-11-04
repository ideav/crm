// Issue #5386: docs/integram-app-workflow-short.md — это docs/integram-app-workflow.md
// без вводного блока «ПРАВИЛА БЕЗОПАСНОСТИ ИИ-АГЕНТА» и ни в чём больше не отличается.
// Короткая версия исторически дрейфовала: правки полной (issue #5100, #5277, #5292)
// в неё не переносились, и в ней оставались устаревшие формулировки (маски ролей и
// отчёты). Страж сравнивает тексты построчно, начиная с общего заголовка инструкции.
// Run with: node experiments/workflow-doc-sync-5386.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (rel) =>
  fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');

const FULL = 'docs/integram-app-workflow.md';
const SHORT = 'docs/integram-app-workflow-short.md';
const TITLE = '# Инструкция для ИИ-агента по разработке Low-Code приложений на Интеграм';

test('короткая инструкция = полная минус блок правил безопасности', () => {
  const full = read(FULL);
  const short = read(SHORT);

  assert.ok(full.startsWith('# 🛡️ ПРАВИЛА БЕЗОПАСНОСТИ ИИ-АГЕНТА'),
    `${FULL} начинается не с блока правил безопасности`);
  assert.ok(!short.includes('ПРАВИЛА БЕЗОПАСНОСТИ ИИ-АГЕНТА'),
    `${SHORT} содержит блок правил безопасности — он только для полной версии`);

  const idx = full.indexOf('\n' + TITLE + '\n');
  assert.ok(idx > 0, `в ${FULL} не найден заголовок инструкции «${TITLE}»`);
  const tail = full.slice(idx + 1);

  const a = tail.split('\n');
  const b = short.split('\n');
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    assert.strictEqual(b[i], a[i],
      `${SHORT} разошёлся с ${FULL} (строка ${i + 1} короткой):\n` +
      `  полная:   ${a[i] === undefined ? '<нет строки>' : JSON.stringify(a[i])}\n` +
      `  короткая: ${b[i] === undefined ? '<нет строки>' : JSON.stringify(b[i])}`);
  }
});
