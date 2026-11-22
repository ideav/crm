// issue #5621: шаблоны ядра подключают /js/*.js и /css/*.css, которых не было в репо
// (на ideav.ru их когда-то выложили руками). Docker/on-prem-стенд из main получал вместо
// них HTML лендинга (FallbackResource): без js.js не работал edit_types, без moment —
// дата в edit_obj. Сторож: каждая локальная ссылка на js/css в шаблонах ядра обязана
// указывать на файл, который лежит в репозитории.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TPL = path.join(ROOT, 'templates');

// Только шаблоны ядра (верхний уровень templates/): подкаталоги — шаблоны отдельных баз.
function coreTemplates() {
  return fs.readdirSync(TPL)
    .filter(f => f.endsWith('.html') && fs.statSync(path.join(TPL, f)).isFile());
}

test('#5621: локальные js/css шаблонов ядра есть в репозитории', () => {
  const re = /(?:src|href)\s*=\s*["']\/?((?:js|css)\/[^"'?#{}\s]+)/g;
  const missing = [];
  for (const f of coreTemplates()) {
    const html = fs.readFileSync(path.join(TPL, f), 'utf8');
    for (const m of html.matchAll(re)) {
      if (!fs.existsSync(path.join(ROOT, m[1]))) missing.push(`${f}: ${m[1]}`);
    }
  }
  assert.deepStrictEqual([...new Set(missing)], [], 'нет файлов в репо');
});

test('#5621: js.js и moment — настоящие скрипты, а не заглушки', () => {
  const js = fs.readFileSync(path.join(ROOT, 'js/js.js'), 'utf8');
  assert.match(js, /function byId\(/);
  const moment = fs.readFileSync(path.join(ROOT, 'js/moment2.29.4.min.js'), 'utf8');
  assert.match(moment, /2\.29\.4/);
  assert.doesNotMatch(moment.slice(0, 200), /<html|<!doctype/i);
});
