#!/usr/bin/env node
// backlogram#1023: новое решение портала «Решения» — органайзер знакомств и обещаний.
// Данные — solutions-bl1023-cards.json рядом. Запись создаётся НЕОПУБЛИКОВАННОЙ (реквизит «Опубликовано» пуст),
// порядок — в конец каталога. Идемпотентно: если запись с таким «Адрес» есть, пишутся только изменившиеся поля.
// Без --apply печатает план и ничего не пишет.
//
//   SOL_TOKEN=<токен> node docs/scripts/solutions-bl1023.cjs [--apply]
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const BASE = 'https://ideav.ru/solutions';
const TOKEN = process.env.SOL_TOKEN || '';
const APPLY = process.argv.includes('--apply');
const TABLE = 472; // «Решение»
const REQ = { short: 477, pain: 479, features: 481, steps: 483, category: 485, industries: 487, platforms: 489, order: 497, slug: 910 };

function curl(args) {
  const out = execFileSync('curl', ['-s', '--retry', '4', '--retry-all-errors', '-H', 'X-Authorization: ' + TOKEN].concat(args),
    { encoding: 'utf8', maxBuffer: 1 << 26 });
  try { return JSON.parse(out); } catch (e) { throw new Error('не JSON: ' + out.slice(0, 300)); }
}
const get = p => curl([BASE + '/' + p]);
function post(p, xsrf, form) {
  // значения — через файлы (-F k=<файл): curl на Windows перекодирует кириллицу аргументов в ANSI
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sl1023-'));
  const args = ['-X', 'POST', '--form-string', '_xsrf=' + xsrf];
  Object.entries(form).forEach(([k, v], i) => {
    const f = path.join(dir, 'v' + i);
    fs.writeFileSync(f, String(v), 'utf8');
    args.push('-F', k + '=<' + f);
  });
  let r;
  try { r = curl(args.concat([BASE + '/' + p + (p.indexOf('?') < 0 ? '?JSON=1' : '&JSON=1')])); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  if (Array.isArray(r) && r[0] && r[0].error) throw new Error(p + ': ' + r[0].error);
  return r;
}
const lines = a => (a || []).join('\n');
const numStr = v => (v === '' || v == null ? '' : String(Number(v)));

function main() {
  if (!TOKEN) throw new Error('нужен SOL_TOKEN');
  const cards = JSON.parse(fs.readFileSync(path.join(__dirname, 'solutions-bl1023-cards.json'), 'utf8'));
  const xsrf = get('xsrf?JSON=1')._xsrf;
  const colId = {};
  for (const r of get('metadata/' + TABLE + '?JSON=1').reqs) colId[r.val] = r.id;
  const rows = get('object/' + TABLE + '/?JSON_OBJ&NAMED&LIMIT=0,500');
  const bySlug = new Map(rows.map(r => [r['Адрес'], r]));
  let order = Math.max(0, ...rows.map(r => Number(r['Порядок']) || 0));
  let changed = 0;
  for (const c of cards) {
    const want = {
      'Наборные блоки': lines(c.blocks), 'Идеи кастомизации': lines(c.ideas),
      'Цена от': numStr(c.price_from), 'Цена до': numStr(c.price_to), 'Срок': c.term || '',
      'Цены конкурентов': lines(c.competitors), 'Картинка': c.image || '', 'Источник изображения': c.credit || ''
    };
    let row = bySlug.get(c.slug);
    if (!row) {
      console.log('#' + c.issue + ' НОВОЕ решение «' + c.title + '» /solutions/' + c.slug + ' (не опубликовано, порядок ' + (order + 1) + ')');
      changed++;
      if (!APPLY) continue;
      const f = { up: 1, ['t' + TABLE]: c.title, ['t' + REQ.short]: c.short, ['t' + REQ.pain]: c.pain,
        ['t' + REQ.features]: lines(c.features), ['t' + REQ.steps]: lines(c.steps), ['t' + REQ.category]: c.category_id,
        ['t' + REQ.industries]: (c.industry_ids || []).join(','), ['t' + REQ.platforms]: (c.platform_ids || []).join(','),
        ['t' + REQ.order]: ++order, ['t' + REQ.slug]: c.slug };
      row = { id: post('_m_new/' + TABLE, xsrf, f).obj };
      console.log('  id', row.id);
    }
    const set = {};
    for (const [k, v] of Object.entries(want)) {
      const was = row[k] == null ? '' : (k.startsWith('Цена') ? numStr(row[k]) : String(row[k]));
      if (was !== v) set['t' + colId[k]] = v;
    }
    if (Object.keys(set).length && APPLY) post('_m_set/' + row.id, xsrf, set);
  }
  console.log((APPLY ? 'записано' : 'к записи') + ': ' + changed);
}
main();
