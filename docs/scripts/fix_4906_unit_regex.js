// Правка формул импорта «Заказы из 1С» — issue #4906.
//
// Симптом: заказ 5243 — 21,96 тыс. пог. м при ролике 305 м должно дать 72 шт,
// импорт записал 22 (Math.ceil(21.96/1)): регулярка единицы требовала ровно
// «тыс. пог. м», а 1С прислал «тыс.пог.м.» — без пробелов, с точкой в конце.
//
// Фикс: точки в сокращениях необязательны — /^тыс\.?\s*пог\.?\s*м\.?$/i и
// /^пог\.?\s*м\.?$/i. Правится ВО ВСЕХ трёх настройках-дублях («Настройка» 269):
// боевой 743249 «Заказы из 1С артикул» (тип UPLOAD) и резервных 66419 «Заказы
// из 1С» и 130866 «Заказы из 1С ед изм» (тип UPLOAD_bak). В 66419 формул
// конвертации не было вовсе — добавляются. Исполнение формул страницей импорта
// проверяет experiments/issue-4906-upload-unit-conversion.test.js.
//
// Использование:
//   TOKEN=<токен> DB=https://ideav.ru/ateh node docs/scripts/fix_4906_unit_regex.js          # сухой прогон: покажет старое/новое
//   TOKEN=<токен> DB=https://ideav.ru/ateh node docs/scripts/fix_4906_unit_regex.js --apply  # записать
//
// Повторный запуск идемпотентен: та же формула записывается той же.

'use strict';

const DB = (process.env.DB || 'https://ideav.ru/ateh').replace(/\/+$/, '');
const TOKEN = process.env.TOKEN;
const APPLY = process.argv.includes('--apply');

if (!TOKEN) { console.error('Нужен TOKEN=<токен базы>'); process.exit(2); }

// Настройки-дубли семейства «Заказы из 1С» (таблица «Настройка», id 269).
const SETTINGS = ['66419', '130866', '743249'];

// Новые выражения полей. Единица: точки после «тыс», «пог», «м» необязательны.
const F1076_NEW = String.raw`'[Срок изготовления]'===''?'':Math.ceil([Заказанное количество] / (/^тыс\.?\s*пог\.?\s*м\.?$/i.test('[Ед.изм.]') ? +('[Вид сырья]'.replace(/^Образец\s*/i, '').match(/\d+\s*[хx×*]\s*(\d+)/)?.[1]) / 1000 : /^пог\.?\s*м\.?$/i.test('[Ед.изм.]') ? +('[Вид сырья]'.replace(/^Образец\s*/i, '').match(/\d+\s*[хx×*]\s*(\d+)/)?.[1]) : 1))`;

const F136894_NEW = String.raw`/^тыс\.?\s*пог\.?\s*м\.?$/i.test('[Ед.изм.]') ? [Заказанное количество] * 1000 : /^пог\.?\s*м\.?$/i.test('[Ед.изм.]') ? [Заказанное количество] : ''`;

const F129370_NEW = "'шт'";

const NEW_FORMULAS = { '1076': F1076_NEW, '129370': F129370_NEW, '136894': F136894_NEW };

async function main() {
  const res = await fetch(`${DB}/object/269?JSON_OBJ=1&LIMIT=0,500`, {
    headers: { 'X-Authorization': TOKEN }
  });
  const rows = await res.json();
  if (!Array.isArray(rows)) { console.error('Не удалось прочитать «Настройку» 269:', JSON.stringify(rows).slice(0, 300)); process.exit(1); }

  const targets = rows.filter(r => SETTINGS.includes(String(r.i)));
  if (targets.length !== SETTINGS.length) {
    console.error('Найдены не все настройки:', targets.map(r => r.i).join(', ') || '—');
    process.exit(1);
  }

  const plan = [];
  for (const row of targets) {
    const name = row.r[0];
    const scope = row.r[1];
    const setting = JSON.parse(row.r[2]);
    const oldFormulas = setting.formulas || {};
    const before = {};
    for (const [id, nf] of Object.entries(NEW_FORMULAS)) {
      before[id] = oldFormulas[id] === undefined ? '(не было)' : oldFormulas[id];
      if (before[id] !== nf) setting.formulas[id] = nf; // правка только расхождений
    }
    plan.push({ id: row.i, name, scope, before, after: JSON.parse(JSON.stringify(NEW_FORMULAS)), json: JSON.stringify(setting) });
  }

  for (const p of plan) {
    console.log(`\n=== Настройка ${p.id} «${p.name}» (тип ${p.scope})`);
    for (const id of Object.keys(NEW_FORMULAS)) {
      const changed = p.before[id] !== p.after[id];
      console.log(`  поле ${id}: ${changed ? 'ЗАМЕНЯЕТСЯ' : 'без изменений'}`);
      if (changed) {
        console.log(`    БЫЛО: ${p.before[id]}`);
        console.log(`    СТАЛО: ${p.after[id]}`);
      }
    }
  }

  if (!APPLY) {
    console.log('\nСухой прогон. Для записи: --apply');
    return;
  }

  const xsrfRes = await fetch(`${DB}/xsrf?JSON`, { headers: { 'X-Authorization': TOKEN } });
  const xsrf = (await xsrfRes.json())['_xsrf'];

  for (const p of plan) {
    const body = new URLSearchParams({ token: TOKEN, _xsrf: xsrf, t273: p.json });
    const setRes = await fetch(`${DB}/_m_set/${p.id}?JSON=1`, {
      method: 'POST',
      headers: { 'X-Authorization': TOKEN, 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body
    });
    const out = await setRes.json();
    console.log(`Записана настройка ${p.id}: ${JSON.stringify(out).slice(0, 120)}`);
  }
  console.log('Готово. Перечитать значения и убедиться: GET /object/269?JSON_OBJ=1 (возможен read-after-write lag реплики).');
}

main().catch(e => { console.error(e); process.exit(1); });
