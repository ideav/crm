#!/usr/bin/env node
// backlogram#1011: «Что ещё можно добавить» на странице решения — хотелки для конфигуратора
// по 32 карточкам эпика backlogram#976. Данные — solutions-bl1011-wishes.json рядом. Идемпотентно:
// колонка «Хотелки» создаётся, если её нет; поле пишется, только если значение отличается.
// Без --apply печатает число строк БЫЛО/СТАЛО и ничего не пишет.
//
//   SOL_TOKEN=<токен> node docs/scripts/solutions-bl1011.cjs [--apply] [--proxy http://127.0.0.1:8899]
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const BASE = 'https://ideav.ru/solutions';
const TOKEN = process.env.SOL_TOKEN || '';
const APPLY = process.argv.includes('--apply');
const pi = process.argv.indexOf('--proxy');
const PROXY = pi > 0 ? process.argv[pi + 1] : '';
const TABLE = 472; // «Решение»
const COL = ['Хотелки', 12]; // MEMO

function curl(args) {
  const base = ['-s', '--retry', '4', '--retry-all-errors', '-H', 'X-Authorization: ' + TOKEN];
  if (PROXY) base.push('-x', PROXY);
  const out = execFileSync('curl', base.concat(args), { encoding: 'utf8', maxBuffer: 1 << 26 });
  try { return JSON.parse(out); } catch (e) { throw new Error('не JSON: ' + out.slice(0, 300)); }
}
const get = p => curl([BASE + '/' + p]);
let XSRF = '';
function post(p, form) {
  // значения — через файлы (-F k=<файл): curl на Windows перекодирует кириллицу аргументов в ANSI
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'sl1011-'));
  const args = ['-X', 'POST', '--form-string', '_xsrf=' + XSRF];
  Object.entries(form).forEach(([k, v], i) => {
    const f = path.join(dir, 'v' + i);
    fs.writeFileSync(f, String(v), 'utf8');
    args.push('-F', k + '=<' + f);
  });
  let r;
  try { r = curl(args.concat([BASE + '/' + p + (p.indexOf('?') < 0 ? '?JSON=1' : '&JSON=1')])); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
  if (Array.isArray(r) && r[0] && r[0].error) throw new Error(p + ': ' + r[0].error);
  return r;
}

function main() {
  if (!TOKEN) throw new Error('нужен SOL_TOKEN');
  const cards = JSON.parse(fs.readFileSync(path.join(__dirname, 'solutions-bl1011-wishes.json'), 'utf8'));
  XSRF = get('xsrf?JSON=1')._xsrf;
  const meta = get('metadata/' + TABLE + '?JSON=1');
  let col = (meta.reqs.find(r => r.val === COL[0]) || {}).id;
  if (col) console.log('колонка есть:', COL[0], col);
  else {
    console.log((APPLY ? 'создаю' : 'создам') + ' колонку:', COL[0]);
    if (APPLY) { const term = post('_d_new', { t: COL[1], val: COL[0] }).obj; col = post('_d_req/' + TABLE, { t: term }).id; console.log('  → t' + col); }
  }
  const rows = get('object/' + TABLE + '/?JSON_OBJ&NAMED&LIMIT=0,500');
  const byId = new Map(rows.map(r => [Number(r.id), r]));
  let changed = 0;
  for (const c of cards) {
    const row = byId.get(c.id);
    if (!row || row['Адрес'] !== c.slug) { console.log('#' + c.issue + ': нет записи ' + c.id + '/' + c.slug + ' — пропуск'); continue; }
    const want = c.wishes.join('\n'), was = row[COL[0]] == null ? '' : String(row[COL[0]]);
    if (was === want) continue;
    changed++;
    console.log('#' + c.issue + ' [' + c.id + '] ' + c.slug + ': строк ' + (was ? was.split('\n').length : 0) + ' → ' + c.wishes.length);
    if (APPLY) post('_m_set/' + c.id, { ['t' + col]: want });
  }
  console.log('\n' + (APPLY ? 'записано' : 'к записи') + ': ' + changed + ' решений');
}
main();
