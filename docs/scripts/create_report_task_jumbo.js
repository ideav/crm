// Отчёт `task_jumbo` — защищённый слой над таблицей «Номер джамбо» (ideav/crm#4914).
//
// Зачем: показания джамбо переехали из реквизитов «Задания в производство» (1078) в
// подчинённую таблицу «Номер джамбо» (на задание может быть несколько джамбо — по
// записи на каждый). Пульт слиттера читает записи через этот отчёт с фильтром
// FR_task_id, упаковщик берёт из него номера джамбо для плашки в карточке.
//
// Колонки (t100 → источник):
//   jumbo_id      — id записи «Номер джамбо» (abn_ID)
//   jumbo_no      — главное значение записи = номер джамбо
//   task_id       — id вышестоящего задания (up-связь, abn_ID) — по нему FR_-фильтр
//   length_start  — Начальная длина, м        counter_start — Счётчик нач.
//   cuts_count    — Кол-во резок              counter_end   — Счётчик кон.
//   length_end    — Конечная длина, м         spent         — Рабочий расход, м
//   writeoff      — К списанию, м             defect_m      — Брак, м
//   defect_qty    — Брак, шт                  photo         — Фото брака
//
// ID реквизитов не хардкодятся — резолвятся по именам из живого GET metadata?JSON.
// Использование:
//   TOKEN=<токен> DB=https://ideav.ru/ateh node docs/scripts/create_report_task_jumbo.js          # сухой прогон
//   TOKEN=<токен> DB=https://ideav.ru/ateh node docs/scripts/create_report_task_jumbo.js --apply # записать
//
// Соглашения конструктора отчётов (docs/integram-reports.md §5, create_slitter_reports.py):
//   POST _m_new/22?JSON&up=1          t22=<имя>            → { id: queryId }
//   POST _m_new/28?JSON&up=queryId    t28=<tableId|reqId>  t100=<имя колонки>
//   POST _m_set/<colId>?JSON          t104=85 (abn_ID)  |  t84=DATETIME (формат)
// Колонка с t100 фильтруема снаружи через FR_<t100>.

'use strict';

const DB = (process.env.DB || 'https://ideav.ru/ateh').replace(/\/+$/, '');
const TOKEN = process.env.TOKEN;
const APPLY = process.argv.includes('--apply');
let XSRF = '';

if (!TOKEN) { console.error('Нужен TOKEN=<токен базы>'); process.exit(2); }

const REPORT = 'task_jumbo';
const BASE_TABLE = 'Номер джамбо';            // база отчёта (подчинена «Заданию в производство»)
const PARENT_TABLE = 'Задание в производство';

// [t100, источник, t104 (85=abn_ID), t84 (формат)]
const COLS = [
  ['jumbo_id',      { table: BASE_TABLE },    85,   null],
  ['jumbo_no',      { table: BASE_TABLE },    null, null],
  ['task_id',       { table: PARENT_TABLE },  85,   null],
  ['length_start',  { req: 'Начальная длина, м' },  null, null],
  ['counter_start', { req: 'Счётчик нач.' },        null, null],
  ['cuts_count',    { req: 'Кол-во резок' },        null, null],
  ['counter_end',   { req: 'Счётчик кон.' },        null, null],
  ['length_end',    { req: 'Конечная длина, м' },   null, null],
  ['spent',         { req: 'Рабочий расход, м' },   null, null],
  ['writeoff',      { req: 'К списанию, м' },       null, null],
  ['defect_m',      { req: 'Брак, м' },             null, null],
  ['defect_qty',    { req: 'Брак, шт' },            null, null],
  ['photo',         { req: 'Фото брака' },          null, null],
];

async function get(path) {
  const res = await fetch(`${DB}/${path}`, { headers: { 'X-Authorization': TOKEN } });
  return res.json();
}

// POST требует token + _xsrf (docs/kb/crud.md); XSRF берётся один раз до записи.
async function post(path, fields) {
  const body = new URLSearchParams({ token: TOKEN, _xsrf: XSRF, ...fields });
  const res = await fetch(`${DB}/${path}`, {
    method: 'POST',
    headers: { 'X-Authorization': TOKEN, 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
    body
  });
  return res.json();
}

function findTable(meta, names) {
  for (const nm of [].concat(names)) {
    const t = meta.find(x => String(x.val || '').trim().toLowerCase() === nm.trim().toLowerCase());
    if (t) return t;
  }
  throw new Error(`В metadata не найдена таблица: ${names}`);
}

function reqId(table, name) {
  const r = (table.reqs || []).find(x => String(x.val || '').trim().toLowerCase() === name.trim().toLowerCase());
  if (!r) throw new Error(`В таблице «${table.val}» нет реквизита: ${name}`);
  return String(r.id);
}

async function addColumn(qid, c) {
  const created = await post(`_m_new/28?JSON&up=${qid}`, { t28: c.t28, t100: c.t100 });
  const cid = String(created.id || created.obj);
  if (c.fn) await post(`_m_set/${cid}?JSON`, { t104: String(c.fn) });
  if (c.fmt) await post(`_m_set/${cid}?JSON`, { t84: c.fmt });
  return cid;
}

async function main() {
  const meta = await get('metadata?JSON');
  const base = findTable(meta, BASE_TABLE);

  const plan = COLS.map(([t100, src, fn, fmt]) => {
    const t28 = 'table' in src ? String(findTable(meta, src.table).id) : reqId(base, src.req);
    return { t100, t28, fn, fmt };
  });

  const reports = await get('object/22/?JSON_OBJ&LIMIT=0,5000');
  const existing = (reports || []).find(r => String((r.r || [])[0] || '').trim() === REPORT);
  const qid = existing ? String(existing.i) : null;

  if (qid) {
    const rpt = await get(`report/${qid}?JSON=1`);
    const have = new Set((rpt.columns || []).map(c => String(c.name || c.val || '').trim()));
    const missing = plan.filter(c => !have.has(c.t100));
    console.log(`${REPORT}: уже существует (queryId=${qid}); колонок в спецификации=${plan.length}, недостающих=${missing.length}`);
    for (const c of missing) {
      console.log(`  + ${c.t100} t28=${c.t28}${c.fn ? ' t104=' + c.fn : ''}`);
      if (APPLY) await addColumn(qid, c);
    }
    if (APPLY && missing.length) console.log(`  ✓ добавлено колонок: ${missing.length}`);
  } else {
    console.log(`${REPORT}: база «${base.val}» (${base.id}), колонок=${plan.length}`);
    for (const c of plan) console.log(`  - ${c.t100} t28=${c.t28}${c.fn ? ' t104=' + c.fn : ''}`);
    if (APPLY) {
      XSRF = (await get('xsrf?JSON'))['_xsrf'];
      const created = await post('_m_new/22?JSON&up=1', { t22: REPORT });
      const newQid = String(created.id || created.obj);
      console.log(`  → queryId=${newQid}`);
      for (const c of plan) await addColumn(newQid, c);
      console.log(`  ✓ ${REPORT} создан`);
    }
  }

  if (!APPLY) { console.log('\nСухой прогон. Для записи: --apply'); return; }

  // Читаем назад и показываем живые строки (возможен read-after-write lag реплики).
  const rows = await get(`report/${REPORT}?JSON_KV&LIMIT=0,5`);
  const list = Array.isArray(rows) ? rows : (rows.data || []);
  console.log(`\nreport/${REPORT}?JSON_KV: строк=${list.length}`);
  list.slice(0, 5).forEach(r => console.log('  ' + JSON.stringify(r)));
}

main().catch(e => { console.error(e); process.exit(1); });
