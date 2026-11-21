// Проверка допустимого тарифа в запросе my/1278 user_changePlan — issue #5608.
//
// Симптом: колонка 1302 («Вычисляемое», реквизит Formula 101) разрешает смену
// тарифа условием FIND_IN_SET('_request_.plan','1146,1148,1147')>=0. FIND_IN_SET
// даёт 0, когда значения нет в списке, поэтому >=0 истинно всегда, и колонка
// 1310 (Set planID='_request_.plan') пишет в план пользователя любой id.
//
// Фикс: >=0 → >0. Остальная формула не меняется.
//
// Использование:
//   TOKEN=<админ-токен my> node docs/scripts/fix_5608_changeplan_find_in_set.js          # сухой прогон: БЫЛО/СТАЛО
//   TOKEN=<админ-токен my> node docs/scripts/fix_5608_changeplan_find_in_set.js --apply  # записать и перечитать
//
// Повторный запуск идемпотентен: если формула уже исправлена, ничего не пишется.

'use strict';

const DB = (process.env.DB || 'https://ideav.ru/my').replace(/\/+$/, '');
const TOKEN = process.env.TOKEN;
const APPLY = process.argv.includes('--apply');
const COLUMN = '1302';
const FORMULA = '101';

const OLD = "FIND_IN_SET('_request_.plan','1146,1148,1147')>=0";
const NEW = "FIND_IN_SET('_request_.plan','1146,1148,1147')>0";

module.exports = { OLD, NEW };
if (require.main !== module) return;

if (!TOKEN) { console.error('Нужен TOKEN=<админ-токен базы my>'); process.exit(2); }

async function call(path, fields) {
  const opt = { headers: { 'X-Authorization': TOKEN } };
  if (fields) {
    opt.method = 'POST';
    opt.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    opt.body = new URLSearchParams(fields).toString();
  }
  const res = await fetch(`${DB}/${path}`, opt);
  const text = await res.text();
  try { return JSON.parse(text); } catch { throw new Error(`${path}: не JSON: ${text.slice(0, 300)}`); }
}

async function readFormula() {
  const j = await call(`edit_obj/${COLUMN}?JSON`);
  if (!j.obj || j.obj.parent !== '1278') throw new Error(`колонка ${COLUMN} не из запроса 1278: ${JSON.stringify(j.obj)}`);
  const v = j.reqs && j.reqs[FORMULA] && j.reqs[FORMULA].value;
  if (typeof v !== 'string') throw new Error(`нет формулы ${FORMULA} у колонки ${COLUMN}`);
  return v;
}

async function main() {
  const before = await readFormula();
  if (!before.includes(OLD)) {
    if (before.includes(NEW)) { console.log('Уже исправлено:\n  ' + before); return; }
    console.error('Формула не та, что ожидалась, правка не делается:\n  ' + before);
    process.exit(1);
  }
  const after = before.replace(OLD, NEW);
  console.log(`Колонка ${COLUMN} (запрос 1278 user_changePlan), реквизит Formula ${FORMULA}:`);
  console.log('  БЫЛО:  ' + before);
  console.log('  СТАЛО: ' + after);
  if (!APPLY) { console.log('\nСухой прогон. Для записи: --apply'); return; }

  const { _xsrf } = await call('xsrf?JSON');
  const r = await call(`_m_set/${COLUMN}?JSON`, { [`t${FORMULA}`]: after, _xsrf });
  console.log('Ответ _m_set:', JSON.stringify(r).slice(0, 300));
  const check = await readFormula();
  if (check !== after) { console.error('Перечитано не то:\n  ' + check); process.exit(1); }
  console.log('Записано и перечитано.');
}

main().catch(e => { console.error(e.message || e); process.exit(1); });
