// Отчёт `MyPads` — реквизит «Планшеты» ТЕКУЩЕГО пользователя (ideav/crm#5046).
//
// Зачем: в «Планшеты» (таблица «Пользователь») через запятую пишутся коды устройств,
// с которых пользователю можно работать. Читать таблицу «Пользователь» ролям вроде
// «Оператора» не положено, поэтому значение отдаёт шаблон `templates/atex/main.html`
// блоком `<!-- Begin: MyPads -->{pads}<!-- End: MyPads -->`: отчёт, вызванный из
// шаблона, строится без проверки грантов (index.php, Get_block_data → Compile_Report
// с $check=FALSE) — так же работает меню роли MyRoleMenu.
//
// Колонки (t100 → источник):
//   uid   — id записи «Пользователь» (abn_ID), фильтр «Значение (от)» = [USER_ID], скрыта
//   pads  — реквизит «Планшеты»
//
// Использование:
//   TOKEN=<токен> DB=https://ideav.ru/ateh node docs/scripts/create_report_my_pads.js          # сухой прогон
//   TOKEN=<токен> DB=https://ideav.ru/ateh node docs/scripts/create_report_my_pads.js --apply # записать
//
// Соглашения конструктора отчётов (docs/integram-reports.md §5):
//   POST _m_new/22?JSON&up=1          t22=<имя>            → { id: queryId }
//   POST _m_new/28?JSON&up=queryId    t28=<tableId|reqId>  t100=<имя колонки>
//   POST _m_set/<colId>?JSON          t104=85 (abn_ID) | t102=<значение от> | t107=X (скрыть)

'use strict';

const DB = (process.env.DB || 'https://ideav.ru/ateh').replace(/\/+$/, '');
const TOKEN = process.env.TOKEN;
const APPLY = process.argv.includes('--apply');
let XSRF = '';

if (!TOKEN) { console.error('Нужен TOKEN=<токен базы>'); process.exit(2); }

const REPORT = 'MyPads';
const BASE_TABLE = 'Пользователь';

// [t100, источник, доп. поля колонки]
const COLS = [
  ['uid',  { table: BASE_TABLE },  { t104: '85', t102: '[USER_ID]', t107: 'X' }],
  ['pads', { req: 'Планшеты' },    {}],
];

async function get(path) {
  const res = await fetch(`${DB}/${path}`, { headers: { 'X-Authorization': TOKEN } });
  return res.json();
}

async function post(path, fields) {
  const body = new URLSearchParams({ token: TOKEN, _xsrf: XSRF, ...fields });
  const res = await fetch(`${DB}/${path}`, {
    method: 'POST',
    headers: { 'X-Authorization': TOKEN, 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
    body
  });
  return res.json();
}

function findTable(meta, name) {
  const t = meta.find(x => String(x.val || '').trim().toLowerCase() === name.trim().toLowerCase());
  if (!t) throw new Error(`В metadata не найдена таблица: ${name}`);
  return t;
}

function reqId(table, name) {
  const r = (table.reqs || []).find(x => String(x.val || '').trim().toLowerCase() === name.trim().toLowerCase());
  if (!r) throw new Error(`В таблице «${table.val}» нет реквизита: ${name}`);
  return String(r.id);
}

async function main() {
  const meta = await get('metadata?JSON');
  const base = findTable(meta, BASE_TABLE);
  const plan = COLS.map(([t100, src, extra]) => ({
    t100, extra, t28: 'table' in src ? String(findTable(meta, src.table).id) : reqId(base, src.req)
  }));

  const reports = await get('object/22/?JSON_OBJ&LIMIT=0,5000');
  const existing = (reports || []).find(r => String((r.r || [])[0] || '').trim() === REPORT);
  if (existing) {
    console.log(`${REPORT}: уже существует (queryId=${existing.i}) — ничего не делаем`);
  } else {
    console.log(`${REPORT}: база «${base.val}» (${base.id})`);
    for (const c of plan) console.log(`  - ${c.t100} t28=${c.t28} ${JSON.stringify(c.extra)}`);
    if (!APPLY) { console.log('\nСухой прогон. Для записи: --apply'); return; }
    XSRF = (await get('xsrf?JSON'))['_xsrf'];
    const created = await post('_m_new/22?JSON&up=1', { t22: REPORT });
    const qid = String(created.id || created.obj);
    console.log(`  → queryId=${qid}`);
    for (const c of plan) {
      const col = await post(`_m_new/28?JSON&up=${qid}`, { t28: c.t28, t100: c.t100 });
      const cid = String(col.id || col.obj);
      if (Object.keys(c.extra).length) await post(`_m_set/${cid}?JSON`, c.extra);
    }
    console.log(`  ✓ ${REPORT} создан`);
  }

  // Своя строка: ровно одна, uid = id вошедшего.
  const rows = await get(`report/${REPORT}?JSON_KV`);
  console.log(`\nreport/${REPORT}?JSON_KV → ${JSON.stringify(rows).slice(0, 300)}`);
}

main().catch(e => { console.error(e); process.exit(1); });
