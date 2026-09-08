// Перенос показаний джамбо: реквизиты «Задания в производство» (1078) → записи
// «Номер джамбо» (82374) (ideav/crm#4914).
//
// Зачем: на задании может быть несколько джамбо, данные по каждому хранятся в своей
// записи подчинённой таблицы «Номер джамбо» (up = задание, главное значение = номер).
// Разовые реквизиты резки 1078 выводятся из эксплуатации.
//
// Что делает (по каждому заданию 1078, у которого непусто хоть что-то из
// № джамбо / Рабочий расход / К списанию / Брак м / Брак шт / Фото брака):
//   1. находит запись 82374 up=задание с тем же номером (или заводит новую);
//   2. мёржит в неё НЕПУСТЫЕ значения (ноль и пустая строка = «нет данных»):
//        Рабочий расход, м  787042 → Рабочий расход, м   82382
//        К списанию, м      787043 → К списанию, м       82384
//        Брак, м            8458   → Брак, м             82386
//        Брак, шт           785730 → Брак, шт            791708
//        Фото брака         8460   → Фото брака          791712
//      плюс дублирует счётчики задания (пустые поля записи не трогаем):
//        Счётчик нач.       1164   → Счётчик нач.        791706
//        Счётчик кон.       1166   → Счётчик кон.        791707
//      Непустые поля существующей записи НЕ затираются.
//   3. после записи очищает перенесённые реквизиты задания (пустое значение в
//      _m_set = очистка, docs/kb/crud.md #4366);
//   4. убирает из отчёта `packer` колонку `jumbo` — её источник (787045) пустеет,
//      плашку упаковщика теперь кормит отчёт task_jumbo.
//
// Перед записью складывает снимок затронутых записей в
// docs/scripts/out/migrate_4914_snapshot_<метка>.json (ручной откат).
//
// Использование:
//   TOKEN=<токен> DB=https://ideav.ru/ateh node docs/scripts/migrate_4914_jumbo_records.js          # сухой прогон: БЫЛО/СТАЛО
//   TOKEN=<токен> DB=https://ideav.ru/ateh node docs/scripts/migrate_4914_jumbo_records.js --apply # записать
//
// Повторный запуск идемпотентен: перенесённые реквизиты пусты → делать нечего.

'use strict';

const fs = require('fs');
const path = require('path');

const DB = (process.env.DB || 'https://ideav.ru/ateh').replace(/\/+$/, '');
const TOKEN = process.env.TOKEN;
const APPLY = process.argv.includes('--apply');
let XSRF = '';

if (!TOKEN) { console.error('Нужен TOKEN=<токен базы>'); process.exit(2); }

const TABLE_TASK = 'Задание в производство'; // 1078
const TABLE_JUMBO = 'Номер джамбо';          // 82374
const REPORT_PACKER = 'packer';
const PACKER_DROP_COL = 'jumbo';             // колонка отчёта packer, подлежащая удалению

// Перенос: [поле записи 82374, реквизит 1078, тип, отбирает ли задание].
// Счётчики задания (1164/1166) НЕ отбирают — у сотен заданий они заполнены без
// всякого джамбо; они дублируются в запись только вслед за джамбо-данными.
const MOVE = [
  ['spent',         'Рабочий расход, м', 'num',  true],
  ['writeoff',      'К списанию, м',     'num',  true],
  ['defect_m',      'Брак, м',           'num',  true],
  ['defect_qty',    'Брак, шт',          'num',  true],
  ['photo',         'Фото брака',        'text', true],
  ['counter_start', 'Счётчик нач.',      'num',  false],
  ['counter_end',   'Счётчик кон.',      'num',  false],
];
const CLEAR_ON_TASK = ['№ джамбо', 'Рабочий расход, м', 'К списанию, м', 'Брак, м', 'Брак, шт', 'Фото брака'];

async function get(p) {
  const res = await fetch(`${DB}/${p}`, { headers: { 'X-Authorization': TOKEN } });
  return res.json();
}

async function post(p, fields) {
  const body = new URLSearchParams({ token: TOKEN, _xsrf: XSRF, ...fields });
  const res = await fetch(`${DB}/${p}`, {
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

// «0.00»/«0»/пустая строка = нет данных; иначе число.
function numVal(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return null;
  const n = parseFloat(s.replace(',', '.'));
  return Number.isFinite(n) && n !== 0 ? s : null;
}

function textVal(v) {
  const s = String(v == null ? '' : v).trim();
  return s || null;
}

// Строки object/{tbl}?JSON_OBJ: r[0] — главное значение, r[i] — реквизит i из
// metadata/{tbl} (отдельный запрос: в списке массива reqs нет).
// Подчинённые записи голым листингом не отдаются — только F_U/F_I-фильтром.
async function loadObjects(tblId, query) {
  const md = await get(`metadata/${tblId}?JSON=1`);
  const order = (md.reqs || []).map(r => String(r.id));
  const rows = await get(`object/${tblId}/?JSON_OBJ&${query}`);
  const out = [];
  for (const row of (rows || [])) {
    const rec = { id: String(row.i), up: String(row.u), main: String((row.r || [])[0] || ''), vals: {} };
    (row.r || []).forEach((v, idx) => { if (idx > 0) rec.vals[order[idx - 1]] = v; });
    out.push(rec);
  }
  return { order, records: out };
}

async function main() {
  const meta = await get('metadata?JSON');
  const taskTbl = findTable(meta, TABLE_TASK);
  const jumboTbl = findTable(meta, TABLE_JUMBO);

  // Реквизит → имя в его таблице: у 1078 и 82374 имена полей переноса совпадают
  // («Рабочий расход, м» и т.д.), но id реквизитов разные.
  function reqOf(tbl, name) {
    const r = (tbl.reqs || []).find(x => String(x.val || '').trim().toLowerCase() === name.trim().toLowerCase());
    if (!r) throw new Error(`В таблице «${tbl.val}» нет реквизита: ${name}`);
    return String(r.id);
  }
  const taskReq = {}; const jumboReq = {};
  for (const taskName of CLEAR_ON_TASK) taskReq[taskName] = reqOf(taskTbl, taskName);
  for (const [recField, name] of MOVE) jumboReq[recField] = reqOf(jumboTbl, name);
  const noReq = reqOf(taskTbl, '№ джамбо');

  const tasks = await loadObjects(taskTbl.id, 'LIMIT=0,2000');

  // Выбираем задания с непустыми джамбо-данными (счётчики отбору не подлежат).
  const affected = [];
  for (const t of tasks.records) {
    const src = { no: textVal(t.vals[noReq]) };
    let has = !!src.no;
    for (const [field, name, kind, selects] of MOVE) {
      const raw = t.vals[reqOf(taskTbl, name)];
      src[field] = kind === 'num' ? numVal(raw) : textVal(raw);
      if (src[field] != null && selects) has = true;
    }
    if (has) affected.push({ task: t, src });
  }

  console.log(`Заданий всего=${tasks.records.length}, к переносу=${affected.length}`);
  const snapshot = [];
  const ops = [];

  for (const { task, src } of affected) {
    // Уже заведённые записи этого задания (подчинённые голым листингом не отдаются).
    const existing = await loadObjects(jumboTbl.id, `F_U=${task.id}`);
    // Запись с тем же номером; при пустом номере — запись без номера.
    let rec = existing.records.find(r => (src.no ? r.main.trim() === src.no : r.main.trim() === ''));
    const fills = {};
    for (const [field] of MOVE) {
      if (src[field] == null) continue;
      if (rec) {
        const cur = String(rec.vals[jumboReq[field]] ?? '').trim();
        const curEmpty = cur === '' || parseFloat(cur.replace(',', '.')) === 0;
        if (!curEmpty) continue;      // непустое поле записи не затираем
      }
      fills[field] = src[field];
    }
    // Номер: в существующую запись без номера — дописываем.
    const setMain = rec && !rec.main.trim() && src.no ? src.no : null;

    console.log(`\n=== Задание ${task.id}${src.no ? ` (№ джамбо «${src.no}»)` : ' (номер пуст)'}`);
    console.log(`    запись: ${rec ? `найдена ${rec.id}` : 'будет создана (up=' + task.id + ')'}`);
    for (const [field] of MOVE) {
      if (src[field] == null) continue;
      const before = rec ? String(rec.vals[jumboReq[field]] ?? '').trim() : '(новая)';
      const skip = !fills[field];
      console.log(`    ${field}: БЫЛО ${before === '' ? '(пусто)' : before} → СТАЛО ${skip ? 'без изменений' : src[field]}${skip ? ' (поле записи непусто)' : ''}`);
    }
    if (setMain) console.log(`    номер: БЫЛО (пусто) → СТАЛО ${setMain}`);

    snapshot.push({ task: task.id, taskFields: src, record: rec ? { id: rec.id, main: rec.main, vals: rec.vals } : null });
    ops.push({ kind: rec ? 'set' : 'new', task: task.id, recId: rec && rec.id, main: setMain || (rec ? null : src.no), fills });
  }

  // Колонка jumbo отчёта packer.
  const reports = await get('object/22/?JSON_OBJ&LIMIT=0,5000');
  const packer = (reports || []).find(r => String((r.r || [])[0] || '').trim() === REPORT_PACKER);
  let dropCol = null;
  if (packer) {
    const rpt = await get(`report/${packer.i}?JSON=1`);
    const col = (rpt.columns || []).find(c => String(c.name || c.val || '').trim() === PACKER_DROP_COL);
    if (col) {
      dropCol = String(col.id);
      console.log(`\n=== Отчёт ${REPORT_PACKER} (${packer.i}): колонка «${PACKER_DROP_COL}» (id=${dropCol}, t28=${col.type})`);
      console.log(`    БЫЛО: колонка ${PACKER_DROP_COL} (источник 787045 «№ джамбо» задания)`);
      console.log(`    СТАЛО: колонки нет — плашку джамбо упаковщика кормит отчёт task_jumbo`);
    }
  }

  if (!APPLY) { console.log('\nСухой прогон. Для записи: --apply'); return; }
  if (!ops.length && !dropCol) { console.log('\nДелать нечего — уже перенесено.'); return; }

  if (snapshot.length) {
    const dir = path.join(__dirname, 'out');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `migrate_4914_snapshot_${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(file, JSON.stringify(snapshot, null, 2));
    console.log(`\nСнимок затронутых записей: ${file}`);
  }

  XSRF = (await get('xsrf?JSON'))['_xsrf'];

  for (const op of ops) {
    if (op.kind === 'new') {
      const fields = {};
      if (op.main) fields[`t${jumboTbl.id}`] = op.main;
      for (const [field] of MOVE) if (op.fills[field] != null) fields[`t${jumboReq[field]}`] = op.fills[field];
      const created = await post(`_m_new/${jumboTbl.id}?JSON&up=${op.task}`, fields);
      console.log(`Создана запись ${created.id || created.obj} (up=${op.task})`);
    } else {
      const fields = {};
      if (op.main) fields[`t${jumboTbl.id}`] = op.main;
      for (const [field] of MOVE) if (op.fills[field] != null) fields[`t${jumboReq[field]}`] = op.fills[field];
      await post(`_m_set/${op.recId}?JSON`, fields);
      console.log(`Запись ${op.recId} дополнена: ${Object.keys(fields).join(', ')}`);
    }
  }

  // Очищаем перенесённые реквизиты задания только после успешной записи записей.
  for (const op of ops) {
    const clear = {};
    for (const name of CLEAR_ON_TASK) clear[`t${taskReq[name]}`] = '';
    await post(`_m_set/${op.task}?JSON`, clear);
    console.log(`Задание ${op.task}: очищены ${CLEAR_ON_TASK.join(', ')}`);
  }

  if (dropCol) {
    await post(`_m_del/${dropCol}?JSON=1`, {});
    console.log(`Отчёт ${REPORT_PACKER}: колонка ${PACKER_DROP_COL} (id=${dropCol}) удалена`);
  }

  console.log('\nГотово. Проверка: GET object/1078?JSON_OBJ (поля пусты) и report/task_jumbo?JSON_KV (данные в записях).');
}

main().catch(e => { console.error(e); process.exit(1); });
