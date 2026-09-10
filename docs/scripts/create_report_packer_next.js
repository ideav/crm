// Отчёт `packer_next` — очередь заданий упаковщика БЕЗ фильтра по событию «Резка»
// (ideav/crm#4929).
//
// Зачем: РМ «Упаковка» показывает задание только после первой резки (отчёт `packer`
// отфильтрован по событию «Резка»), а оператор отмечает резку в конце работы —
// ролики едут упаковщику раньше отметки. Блок «Следующие задания» берёт из этого
// отчёта самое раннее задание каждого станка, по которому резки ещё нет, — упаковщик
// заранее готовит тару, наклейки и короба.
//
// Состав — как у `packer` (docs/integram-reports.md §11) МИНУС обе колонки «Тип
// события» (COUNT `events` и скрытый фильтр «Резка») ПЛЮС станок задания:
//   task/task_id       — плановый старт задания (Unix, сорт. ↑) и его id
//   slitter/slitter_id — «Слиттер» задания: подпись карточки и группировка «по станку»
//   leader, material, material_type — подпись ролика и признак фольги
//   gp_id, qty, tipo, tipo_id       — Партия ГП: план и типоразмер (короб)
//   (скрытые) Обеспечение, Заказанное количество — звенья join
//   cut_width, cut_length, wind_direction, sleeve, add_sleeve, art — позиция заказа
//   order_no, order    — номера заказа (наш и клиентский)
//   packer_no          — «Слиттер → Упаковочное место»: внешний фильтр FR_packer_no
// Клиент фильтрует запуском: FR_packer_no={номер места} и FR_task=>{полночь сегодня}.
//
// ID таблиц и реквизитов не хардкодятся — резолвятся по именам (val/alias) из живого
// GET metadata?JSON. Использование:
//   TOKEN=<токен> DB=https://ideav.ru/ateh node docs/scripts/create_report_packer_next.js          # сухой прогон
//   TOKEN=<токен> DB=https://ideav.ru/ateh node docs/scripts/create_report_packer_next.js --apply  # записать
//
// Соглашения конструктора отчётов (docs/integram-reports.md §5):
//   POST _m_new/22?JSON&up=1          t22=<имя>            → { id: queryId }
//   POST _m_new/28?JSON&up=queryId    t28=<tableId|reqId>  t100=<имя колонки>
//   POST _m_set/<colId>?JSON          t104=85 (abn_ID) | t107=X (скрыть) | t109=1 (сорт.)
// Порядок создания колонок = порядок join слева-направо; первая реальная колонка —
// мастер-таблица (задание), дальше вниз по цепочке Партия ГП → Обеспечение →
// Заказанное количество → Заказ.

'use strict';

const DB = (process.env.DB || 'https://ideav.ru/ateh').replace(/\/+$/, '');
const TOKEN = process.env.TOKEN;
const APPLY = process.argv.includes('--apply');
let XSRF = '';

if (!TOKEN) { console.error('Нужен TOKEN=<токен базы>'); process.exit(2); }

const REPORT = 'packer_next';
const TASK = 'Задание в производство';
const GP = 'Партия ГП';
const SLITTER = 'Слиттер';
const MATERIAL = 'Вид сырья';
const PROVISION = 'Обеспечение';
const POSITION = 'Заказанное количество';
const ORDER = 'Заказ';

// [t100, источник, опции]: table — главное значение таблицы; req — реквизит таблицы
// of. fn=85 → abn_ID; sort=1 → сортировка ↑ (t109); hide → скрытое звено join;
// from → «Значение (от)» (t102, фильтр по умолчанию).
//
// Порядок колонок ЗЕРКАЛИТ живой `packer` (queryId 673812) с выкинутыми колонками
// «Тип события» и qty_fact/packed/notes: порядок задаёт join, и от него зависит,
// через что цепляется «Обеспечение». Вариант «таблица Партия ГП раньше её
// реквизитов» давал декартово произведение — один gp_id на все позиции задания.
// Станок задания (slitter/slitter_id) — реквизиты мастер-таблицы, идут хвостом.
const COLS = [
  ['task',           { table: TASK },                        { sort: 1, from: '>=[TODAY]' }],
  ['qty',            { of: GP, req: 'Кол-во рулонов' },      {}],
  [null,             { table: PROVISION },                   { hide: true }],
  [null,             { table: POSITION },                    { hide: true }],
  ['order',          { of: POSITION, req: 'Заказ клиента' }, {}],
  ['material',       { of: TASK, req: 'Вид сырья' },         {}],
  ['cut_width',      { of: POSITION, req: 'Ширина, мм' },    {}],
  ['cut_length',     { of: POSITION, req: 'Длина, м' },      {}],
  ['wind_direction', { of: POSITION, req: 'Тип намотки' },   {}],
  ['sleeve',         { of: POSITION, req: 'Диаметр втулки' },{}],
  ['add_sleeve',     { of: POSITION, req: 'Доп. втулка' },   {}],
  ['task_id',        { table: TASK },                        { fn: 85 }],
  ['gp_id',          { table: GP },                          { fn: 85 }],
  ['order_no',       { table: ORDER },                       {}],
  ['tipo',           { of: GP, req: 'Типоразмер' },          {}],
  ['tipo_id',        { of: GP, req: 'Типоразмер' },          { fn: 85 }],
  ['material_type',  { of: MATERIAL, req: 'Тип сырья' },     {}],
  ['packer_no',      { of: SLITTER, req: 'Упаковочное место' }, {}],
  ['art',            { of: POSITION, req: 'Артикул' },       {}],
  ['leader',         { of: TASK, req: 'Лидер' },             {}],
  ['slitter',        { of: TASK, req: 'Слиттер' },           {}],
  ['slitter_id',     { of: TASK, req: 'Слиттер' },           { fn: 85 }],
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

function norm(s) { return String(s == null ? '' : s).trim().toLowerCase(); }

function aliasOf(entry) {
  if (entry && entry.alias != null && entry.alias !== '') return String(entry.alias);
  if (entry && entry.attrs) {
    try { const a = JSON.parse(entry.attrs); if (a && a.alias != null) return String(a.alias); }
    catch (e) { /* attrs не JSON */ }
  }
  return '';
}

function findTable(meta, name) {
  const t = meta.find(x => norm(x.val) === norm(name) || norm(aliasOf(x)) === norm(name));
  if (!t) throw new Error(`В metadata не найдена таблица: ${name}`);
  return t;
}

function reqId(table, name) {
  const r = (table.reqs || []).find(x => norm(x.val) === norm(name) || norm(aliasOf(x)) === norm(name));
  if (!r) throw new Error(`В таблице «${table.val}» нет реквизита: ${name}`);
  return String(r.id);
}

async function addColumn(qid, c) {
  const fields = { t28: c.t28 };
  if (c.t100) fields.t100 = c.t100;
  const created = await post(`_m_new/28?JSON&up=${qid}`, fields);
  const cid = String(created.id || created.obj);
  if (c.fn) await post(`_m_set/${cid}?JSON`, { t104: String(c.fn) });
  if (c.sort) await post(`_m_set/${cid}?JSON`, { t109: String(c.sort) });
  if (c.hide) await post(`_m_set/${cid}?JSON`, { t107: 'X' });
  if (c.from) await post(`_m_set/${cid}?JSON`, { t102: c.from });
  return cid;
}

async function main() {
  const meta = await get('metadata?JSON');
  const list = Array.isArray(meta) ? meta : [meta];

  const plan = COLS.map(([t100, src, opts]) => {
    const t28 = 'table' in src
      ? String(findTable(list, src.table).id)
      : reqId(findTable(list, src.of), src.req);
    return { t100, t28, fn: opts.fn, sort: opts.sort, hide: opts.hide, from: opts.from };
  });

  const reports = await get('object/22/?JSON_OBJ&LIMIT=0,5000');
  const existing = (reports || []).find(r => String((r.r || [])[0] || '').trim() === REPORT);
  const qid = existing ? String(existing.i) : null;

  if (qid) {
    const rpt = await get(`report/${qid}?JSON=1`);
    const have = new Set((rpt.columns || []).map(c => String(c.name || c.val || '').trim()));
    const missing = plan.filter(c => c.t100 && !have.has(c.t100));
    console.log(`${REPORT}: уже существует (queryId=${qid}); колонок в спецификации=${plan.length}, недостающих именованных=${missing.length}`);
    if (APPLY && missing.length) XSRF = (await get('xsrf?JSON'))['_xsrf'];
    for (const c of missing) {
      console.log(`  + ${c.t100} t28=${c.t28}${c.fn ? ' t104=' + c.fn : ''}`);
      if (APPLY) await addColumn(qid, c);
    }
    if (APPLY && missing.length) console.log(`  ✓ добавлено колонок: ${missing.length}`);
  } else {
    console.log(`${REPORT}: колонок=${plan.length}`);
    for (const c of plan) {
      console.log(`  - ${c.t100 || '(скрытое звено)'} t28=${c.t28}` +
        `${c.fn ? ' t104=' + c.fn : ''}${c.sort ? ' t109=' + c.sort : ''}${c.hide ? ' t107=X' : ''}${c.from ? ' t102=' + c.from : ''}`);
    }
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

  // Проверка: отчёт отвечает и отдаёт колонки; затем то, что видит клиент (#4929) —
  // с места «1» от полуночи. Пустой список строк сам по себе не ошибка (очередь может
  // быть пуста), ошибка в ответе — повод разбираться с порядком join.
  const midnight = Math.floor(new Date(new Date().toDateString()).getTime() / 1000);
  const rows = await get(`report/${REPORT}?JSON_KV&LIMIT=0,5&FR_packer_no=1&FR_task=${encodeURIComponent('>' + midnight)}`);
  const sample = Array.isArray(rows) ? rows : (rows.data || []);
  console.log(`\nreport/${REPORT}?JSON_KV&FR_packer_no=1&FR_task=>{полночь}: строк=${sample.length}`);
  sample.slice(0, 5).forEach(r => console.log('  ' + JSON.stringify(r)));
}

main().catch(e => { console.error(e); process.exit(1); });
