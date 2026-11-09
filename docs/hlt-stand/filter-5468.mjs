// Срезы отчётов-агрегатов по диапазону дат — фильтр, который попадает в индекс (issue #5468).
// FR_released=01.01.2020&TO_released=31.01.2020 → ядро строит `a.val>='20200101' AND a.val<='20200131'`
// (границы дат в кавычках, index.php Construct_WHERE) — диапазон по индексу (t,val): MySQL сначала
// выбирает строки среза, потом джойнит и агрегирует только их. В генераторе стенда released = 2020-01-01 + (i % 2500) дней,
// на таблице 1 млн строк это 400 строк на дату: день / неделя / месяц / квартал / год = 400 / 2 800 / 12 400 / 36 400 / 146 400.
// Контроль на тех же данных: фильтр-диапазон FR_code=>=0&TO_code=<N (числовой реквизит → CAST(val AS FLOAT),
// индекс не используется) и вся таблица.
// 1 поток, 2 прогона на ячейку (длинные — 1), curl. Результат: filter-5468.json.
// Запуск: node filter-5468.mjs <qjson> [--more N], где qjson — {"T_1M_W12":{"agg1":id,"agg3":id,"agg5":id}}
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
const run = promisify(execFile);
const TOKEN = process.env.HLT_TOKEN || 'YOUR_TOKEN';
const Q = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const CAP = 150;
const PERIODS = [['day', '01.01.2020'], ['week', '07.01.2020'], ['month', '31.01.2020'], ['quarter', '31.03.2020'], ['year', '31.12.2020']];
const OUT = 'filter-5468.json';
const out = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : [];
const have = new Set(out.map(r => r.table + '/' + r.scenario));

async function once(url) {
  const { stdout } = await run('curl', ['-s', '-m', String(CAP + 5), '-w', '\n%{http_code} %{time_total}',
    '-H', 'X-Authorization: ' + TOKEN, url], { timeout: (CAP + 15) * 1000, maxBuffer: 20 * 1024 * 1024 });
  const nl = stdout.lastIndexOf('\n');
  const [code, tt] = stdout.slice(nl + 1).trim().split(' ');
  if (code !== '200') throw new Error('HTTP ' + code);
  const body = JSON.parse(stdout.slice(0, nl));
  if (!Array.isArray(body) || !body[0] || body[0].error) throw new Error('core: ' + stdout.slice(0, 80));
  return { ms: Math.round(parseFloat(tt) * 1000), cnt: +body[0].cnt };
}

async function cell(t, q, scenario, filter, rounds) {
  if (have.has(t + '/' + scenario)) return;
  const url = `https://ideav.ru/hlt/report/${Q[t][q]}?JSON_KV${filter ? '&' + filter : ''}&TIME=${CAP}`;
  const ms = []; let cnt = null, err = null;
  for (let r = 0; r < rounds; r++) {
    try {
      const x = await once(url); ms.push(x.ms); cnt = x.cnt;
      console.log(new Date().toISOString().slice(11, 19), t, scenario, 'r' + (r + 1), x.ms + ' ms', 'cnt=' + x.cnt);
      if (x.ms > 30000) break;
    } catch (e) { err = String(e.message).slice(0, 80); console.log('FAIL', t, scenario, err); break; }
    await new Promise(r => setTimeout(r, 1500));
  }
  ms.sort((a, b) => a - b);
  out.push({ part: 'F', table: t, scenario, filter, threads: 1, rows: cnt, ms, ...(err ? { err } : {}), at: new Date().toISOString() });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
}

// --more N: добрать N прогонов к уже снятым срезам по датам (кроме «дня» — он идёт мимо индекса, #5469)
const mi = process.argv.indexOf('--more');
if (mi > 0) {
  const n = +process.argv[mi + 1];
  for (const r of out) {
    if (!/_date_(week|month|quarter|year)$/.test(r.scenario) || !Q[r.table]) continue;
    const q = r.scenario.split('_')[0];
    const url = `https://ideav.ru/hlt/report/${Q[r.table][q]}?JSON_KV&${r.filter}&TIME=${CAP}`;
    for (let k = 0; k < n; k++) {
      try { const x = await once(url); r.ms.push(x.ms); console.log(r.table, r.scenario, '+', x.ms + ' ms'); }
      catch (e) { console.log('FAIL', r.scenario, String(e.message).slice(0, 80)); break; }
      await new Promise(rs => setTimeout(rs, 1500));
    }
    r.ms.sort((a, b) => a - b);
    fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  }
  process.exit(0);
}

for (const t of Object.keys(Q)) {
  for (const q of ['agg1', 'agg3', 'agg5'])
    for (const [p, to] of PERIODS)
      await cell(t, q, `${q}_date_${p}`, `FR_released=01.01.2020&TO_released=${to}`, 2);
  // контроль: фильтр мимо индекса и вся таблица — по одному прогону
  await cell(t, 'agg1', 'agg1_cast1k', 'FR_code=>=0&TO_code=<1000', 1);
  await cell(t, 'agg1', 'agg1_all', '', 1);
}
console.log('done:', out.length, 'cells ->', OUT);
