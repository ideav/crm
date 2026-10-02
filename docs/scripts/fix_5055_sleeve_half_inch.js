// Правка формулы «Диаметр втулки» (8194) импорта «Заказы из 1С» — issue #5055.
//
// Симптом: заказ 5661 — две позиции одной резки (один вал на станке), обе
// «OUT 0.5"», а импорт поставил разные втулки: «MWR200 110 х 74 OUT 0.5" (…)»
// получила 1" длина 1 метр, «MWR200 64 х 74 OUT 0.5" втулка 110 мм (…)» —
// 0.5" ширина 110 мм.
//
// Причина: головные ветки формулы /0\.5.*57/ и /0\.5.*110/ требуют, чтобы число
// ширины втулки стояло ПОСЛЕ «0.5». В первой строке «110» — ширина ролика до
// «0.5», явной втулки нет → ни одна ветка 0.5" не сработала → fallback 1".
//
// Фикс: диаметр 0.5" — по самому «0.5"» / «0,5"» / «0.5 дюйм»; ширина втулки:
// явная «вт 110» / «втулка 110 мм» → 110, иначе 57 в строке → 57, иначе 110
// (владелец: «MR194 57 х 74 OUT 0.5"» — втулка 57, не 110). Хвост формулы
// (пластик, цвета, fallback 1") не трогается. Правится ВО ВСЕХ трёх
// настройках-дублях («Настройка» 269): боевой 743249 «Заказы из 1С артикул»
// (UPLOAD) и резервных 66419, 130866 (UPLOAD_bak). Исполнение формулы страницей
// импорта проверяет experiments/issue-5055-upload-sleeve-half-inch.test.js.
//
// Использование:
//   TOKEN=<токен> DB=https://ideav.ru/ateh node docs/scripts/fix_5055_sleeve_half_inch.js          # сухой прогон
//   TOKEN=<токен> DB=https://ideav.ru/ateh node docs/scripts/fix_5055_sleeve_half_inch.js --apply  # записать
//
// Повторный запуск идемпотентен: уже исправленная настройка пропускается.
// Если голова формулы не совпадает ни со старой, ни с новой — скрипт ничего не
// пишет и печатает формулу: значит, её правили руками, нужен разбор.

'use strict';

const DB = (process.env.DB || 'https://ideav.ru/ateh').replace(/\/+$/, '');
const TOKEN = process.env.TOKEN;
const APPLY = process.argv.includes('--apply');

if (!TOKEN) { console.error('Нужен TOKEN=<токен базы>'); process.exit(2); }

const SETTINGS = ['66419', '130866', '743249'];
const FIELD = '8194';

const HEAD_OLD = String.raw`/0\.5.*57/.test('[Вид сырья]') ? 'Втулка картонная 0.5" ширина 57 мм' : /0\.5.*110/.test('[Вид сырья]') ? 'Втулка картонная 0.5" ширина 110 мм' : `;

// Первая редакция фикса (57 только при явном «вт 57») — тоже заменяется.
const HEAD_V1 = String.raw`/0[.,]5\s*(?:"|дюйм)/i.test('[Вид сырья]') ? (/(?:^|[^а-яё])вт(?:улк[а-яё]*)?\.?\s*57(?!\d)/i.test('[Вид сырья]') ? 'Втулка картонная 0.5" ширина 57 мм' : 'Втулка картонная 0.5" ширина 110 мм') : `;

const HEAD_NEW = String.raw`/0[.,]5\s*(?:"|дюйм)/i.test('[Вид сырья]') ? (/(?:^|[^а-яё])вт(?:улк[а-яё]*)?\.?\s*110(?!\d)/i.test('[Вид сырья]') ? 'Втулка картонная 0.5" ширина 110 мм' : /(?:^|\D)57(?!\d)/.test('[Вид сырья]') ? 'Втулка картонная 0.5" ширина 57 мм' : 'Втулка картонная 0.5" ширина 110 мм') : `;

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
  let bad = 0;
  for (const row of targets) {
    const setting = JSON.parse(row.r[2]);
    const f = (setting.formulas || {})[FIELD] || '';
    console.log(`\n=== Настройка ${row.i} «${row.r[0]}» (тип ${row.r[1]})`);
    if (f.startsWith(HEAD_NEW)) { console.log('  уже исправлена'); continue; }
    const head = [HEAD_OLD, HEAD_V1].find(h => f.startsWith(h));
    if (!head) { console.log(`  НЕОЖИДАННАЯ формула, не трогаю:\n    ${f}`); bad++; continue; }
    const nf = HEAD_NEW + f.slice(head.length);
    console.log(`  БЫЛО:  ${f}\n  СТАЛО: ${nf}`);
    setting.formulas[FIELD] = nf;
    plan.push({ id: row.i, json: JSON.stringify(setting) });
  }
  if (bad) { console.error(`\n${bad} настроек с неожиданной формулой — ничего не записано`); process.exit(1); }

  if (!APPLY) { console.log('\nСухой прогон. Для записи: --apply'); return; }

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
  console.log('Готово. Перечитать: GET /object/269?JSON_OBJ=1 (возможен read-after-write lag реплики).');
}

main().catch(e => { console.error(e); process.exit(1); });
