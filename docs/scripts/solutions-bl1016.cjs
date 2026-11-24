#!/usr/bin/env node
// backlogram#1016: карточки портала «Решения» к публикации — готовые блоки, идеи кастомизации,
// ориентир цены и срока, публичные цены коробок; 13 новых решений эпика backlogram#976.
// Данные — solutions-bl1016-cards.json рядом. Идемпотентно: колонки создаются, если их нет;
// поля пишутся, только если значение отличается. Без --apply печатает БЫЛО/СТАЛО и ничего не пишет.
//
//   SOL_TOKEN=<токен> node docs/scripts/solutions-bl1016.cjs [--apply] [--proxy http://127.0.0.1:8899]
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
const NEW_COLS = [ // [имя, базовый тип]: 12 MEMO, 14 NUMBER, 8 CHARS
  ['Наборные блоки', 12], ['Идеи кастомизации', 12], ['Цена от', 14], ['Цена до', 14], ['Срок', 8], ['Цены конкурентов', 12]
];
const REQ = { short: 477, pain: 479, features: 481, steps: 483, category: 485, industries: 487, platforms: 489, published: 495, order: 497, slug: 910 };

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
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'sl1016-'));
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

const lines = a => (a || []).join('\n');
const numStr = v => (v === '' || v == null ? '' : String(Number(v)));

function main() {
  if (!TOKEN) throw new Error('нужен SOL_TOKEN');
  const cards = JSON.parse(fs.readFileSync(path.join(__dirname, 'solutions-bl1016-cards.json'), 'utf8'));
  XSRF = get('xsrf?JSON=1')._xsrf;

  // 1. колонки
  let meta = get('metadata/' + TABLE + '?JSON=1');
  const colId = {};
  for (const r of meta.reqs) colId[r.val] = r.id;
  for (const [name, type] of NEW_COLS) {
    if (colId[name]) { console.log('колонка есть:', name, colId[name]); continue; }
    console.log((APPLY ? 'создаю' : 'создам') + ' колонку:', name, 'тип', type);
    if (!APPLY) continue;
    const term = post('_d_new', { t: type, val: name }).obj;
    colId[name] = post('_d_req/' + TABLE, { t: term }).id;
    console.log('  → t' + colId[name]);
  }

  // 2. записи
  const rows = get('object/' + TABLE + '/?JSON_OBJ&NAMED&LIMIT=0,500');
  const byId = new Map(rows.map(r => [Number(r.id), r]));
  const bySlug = new Map(rows.map(r => [r['Адрес'], r]));
  let order = Math.max(0, ...rows.map(r => Number(r['Порядок']) || 0));
  let changed = 0;
  for (const c of cards) {
    const want = {
      'Наборные блоки': lines(c.blocks), 'Идеи кастомизации': lines(c.ideas),
      'Цена от': numStr(c.price_from), 'Цена до': numStr(c.price_to), 'Срок': c.term || '',
      'Цены конкурентов': lines(c.competitors)
    };
    if (!c.id) { want['Картинка'] = c.image || ''; want['Опубликовано'] = '1'; } // новые: обложка и публикация
    let row = c.id ? byId.get(c.id) : bySlug.get(c.slug);
    if (!row && !c.id) {
      console.log('\n#' + c.issue + ' НОВОЕ решение «' + c.title + '» /solutions/' + c.slug + ' (не опубликовано)');
      changed++;
      if (!APPLY) continue;
      const f = { up: 1, ['t' + TABLE]: c.title, ['t' + REQ.short]: c.short, ['t' + REQ.pain]: c.pain,
        ['t' + REQ.features]: lines(c.features), ['t' + REQ.steps]: lines(c.steps), ['t' + REQ.category]: c.category_id,
        ['t' + REQ.industries]: (c.industry_ids || []).join(','), ['t' + REQ.platforms]: (c.platform_ids || []).join(','),
        ['t' + REQ.order]: ++order, ['t' + REQ.slug]: c.slug };
      const id = post('_m_new/' + TABLE, f).obj;
      console.log('  → id', id);
      row = { id };
    }
    if (!row) { console.log('#' + c.issue + ': записи id ' + c.id + ' нет — пропуск'); continue; }
    const set = {};
    for (const [k, v] of Object.entries(want)) {
      const was = row[k] == null ? '' : (k.startsWith('Цена') ? numStr(row[k]) : String(row[k]));
      if (was === v) continue;
      set['t' + colId[k]] = v;
      if (c.id) console.log('#' + c.issue + ' [' + row.id + '] ' + k + '\n  БЫЛО: ' + JSON.stringify(was) + '\n  СТАЛО: ' + JSON.stringify(v));
    }
    if (!Object.keys(set).length) continue;
    changed++;
    if (APPLY) post('_m_set/' + row.id, set);
  }
  console.log('\n' + (APPLY ? 'записано' : 'к записи') + ': ' + changed + ' решений');
}
main();
