// Портал курсов грузит одни и те же js/css из двух страниц: templates/courses/info.html (ядро PHP)
// и download/courses/core.html (новое ядро). Кэш файлов immutable по ?v=N, поэтому у одного файла
// номер версии на обеих страницах один: иначе одна из страниц отдаёт ученику устаревший код.
// rules: none (defect #5574)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
function versions(file) {
  const html = fs.readFileSync(path.join(root, file), 'utf8');
  const out = {};
  for (const m of html.matchAll(/\/download\/courses\/((?:js|css)\/[\w.-]+\.(?:js|css))\?v=(\d+)/g)) out[m[1]] = m[2];
  return out;
}

test('у общих файлов портала курсов одна версия ?v= на обеих страницах', () => {
  const a = versions('templates/courses/info.html');
  const b = versions('download/courses/core.html');
  const shared = Object.keys(a).filter((k) => k in b);
  assert.ok(shared.length > 10, 'обе страницы найдены и грузят файлы портала: ' + shared.length);
  const diff = shared.filter((k) => a[k] !== b[k]).map((k) => `${k}: info.html v=${a[k]}, core.html v=${b[k]}`);
  assert.deepStrictEqual(diff, []);
});
