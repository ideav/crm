#!/usr/bin/env node
// backlogram#1019: фото-обложки 13 новых решений портала «Решения» вместо одинаковых рисованных.
// Берёт из solutions-bl1016-cards.json карточки без id (новые): image → «Картинка»,
// credit («Автор | Unsplash | URL») → «Источник изображения». Записи ищутся по «Адрес» (slug).
// Идемпотентно; без --apply печатает БЫЛО/СТАЛО и ничего не пишет.
//
//   SOL_TOKEN=<токен> node docs/scripts/solutions-bl1019-covers.cjs [--apply]
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const BASE = 'https://ideav.ru/solutions';
const TOKEN = process.env.SOL_TOKEN || '';
const APPLY = process.argv.includes('--apply');
const TABLE = 472; // «Решение»
const FIELDS = { image: 'Картинка', credit: 'Источник изображения' };

function curl(args) {
  const out = execFileSync('curl', ['-s', '--retry', '4', '--retry-all-errors', '-H', 'X-Authorization: ' + TOKEN].concat(args),
    { encoding: 'utf8', maxBuffer: 1 << 26 });
  try { return JSON.parse(out); } catch (e) { throw new Error('не JSON: ' + out.slice(0, 300)); }
}
const get = p => curl([BASE + '/' + p]);
function post(p, xsrf, form) {
  // значения — через файлы (-F k=<файл): curl на Windows перекодирует кириллицу аргументов в ANSI
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sl1019-'));
  const args = ['-X', 'POST', '--form-string', '_xsrf=' + xsrf];
  Object.entries(form).forEach(([k, v], i) => {
    const f = path.join(dir, 'v' + i);
    fs.writeFileSync(f, String(v), 'utf8');
    args.push('-F', k + '=<' + f);
  });
  let r;
  try { r = curl(args.concat([BASE + '/' + p + '?JSON=1'])); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  if (Array.isArray(r) && r[0] && r[0].error) throw new Error(p + ': ' + r[0].error);
  return r;
}

function main() {
  if (!TOKEN) throw new Error('нужен SOL_TOKEN');
  const cards = JSON.parse(fs.readFileSync(path.join(__dirname, 'solutions-bl1016-cards.json'), 'utf8')).filter(c => !c.id);
  const xsrf = get('xsrf?JSON=1')._xsrf;
  const colId = {};
  for (const r of get('metadata/' + TABLE + '?JSON=1').reqs) colId[r.val] = r.id;
  for (const name of Object.values(FIELDS)) if (!colId[name]) throw new Error('нет колонки «' + name + '»');
  const bySlug = new Map(get('object/' + TABLE + '/?JSON_OBJ&NAMED&LIMIT=0,500').map(r => [r['Адрес'], r]));
  let changed = 0;
  for (const c of cards) {
    const row = bySlug.get(c.slug);
    if (!row) { console.log('#' + c.issue + ': нет записи /solutions/' + c.slug + ' — пропуск'); continue; }
    const set = {};
    for (const [key, name] of Object.entries(FIELDS)) {
      const was = row[name] == null ? '' : String(row[name]), want = c[key] || '';
      if (was === want) continue;
      set['t' + colId[name]] = want;
      console.log('#' + c.issue + ' [' + row.id + '] ' + name + '\n  БЫЛО: ' + JSON.stringify(was) + '\n  СТАЛО: ' + JSON.stringify(want));
    }
    if (!Object.keys(set).length) continue;
    changed++;
    if (APPLY) post('_m_set/' + row.id, xsrf, set);
  }
  console.log('\n' + (APPLY ? 'записано' : 'к записи') + ': ' + changed + ' решений');
}
main();
