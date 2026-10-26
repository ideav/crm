// Перезамер 26.10 (issue ideav/crm#5286): классические кривые нагрузки.
//   A. «лесенка» потоков 1→50 для выборок: rps растёт до насыщения, затем полка; латентность — наоборот.
//   B. агрегат по всей таблице ×1 поток на 1К/10К/100К/1М — время от объёма данных.
//   C. agg3/agg5 на срезах 1k/5k таблиц 1М — недостающие точки графика срезов.
//   D. «лесенка» потоков для отчётов-агрегатов по всей таблице 10К/100К.
// Порог обслуживания — CAP = 60 с: запрос дольше — таймаут (отказ). Критерий остановки лесенки:
// после первой ступени с таймаутами — не больше 2 ступеней, остальные пишутся как
// «не измерялось — сработал критерий остановки» (skipped: true).
// curl вместо node fetch (fetch деградирует на длинных сериях). Запросы НЕ прерываются:
// потолок задаёт сервер (TIME=), клиент ждёт на 10 с дольше — прерванный агрегат догорает в MySQL.
// Результат: ramp-2610.json (дописывается после каждой ячейки). Запуск: node ramp-2610.mjs [A|B|C ...]
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import { TOKEN } from './api.mjs';
const run = promisify(execFile);
const S = JSON.parse(fs.readFileSync('state.json', 'utf8'));
const OUT = 'ramp-2610.json';
const out = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : [];
const done = new Set(out.map(r => `${r.part}|${r.scenario}|${r.table}|${r.threads}`));
const save = () => fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const parts = process.argv.slice(2).length ? process.argv.slice(2) : ['A', 'B', 'C', 'D'];
const CAP = 60, AFTER_TIMEOUT = 2;

async function curl(url, cap) {
  const t0 = Date.now();
  try {
    const { stdout } = await run('curl', ['-s', '-m', String(cap + 10), '-w', '\n%{http_code} %{time_total}',
      '-H', `X-Authorization: ${TOKEN}`, url], { timeout: (cap + 20) * 1000, maxBuffer: 50 * 1024 * 1024 });
    const nl = stdout.lastIndexOf('\n');
    const [code, tt] = stdout.slice(nl + 1).trim().split(' ');
    if (code !== '200') throw new Error('HTTP ' + code);
    const body = JSON.parse(stdout.slice(0, nl)); // бросит на HTML/ошибке ядра
    if (body && !Array.isArray(body) && body.error) throw new Error('core: ' + String(body.error).slice(0, 60));
    const ms = Math.round(parseFloat(tt) * 1000);
    if (ms > cap * 1000) { await sweep(); return { ok: false, ms, err: 'timeout >' + cap + ' s' }; }
    return { ok: true, ms };
  } catch (e) {
    if (e.code === 28 || e.killed) { await sweep(); return { ok: false, ms: Date.now() - t0, err: 'timeout >' + cap + ' s' }; }
    return { ok: false, ms: Date.now() - t0, err: String(e.message).split('\n')[0].slice(0, 80) };
  }
}
// Хвосты: клиентский таймаут и TIME= ядра запрос в MySQL не останавливают — он догорает и грузит
// следующие ячейки. Добиваем KILL QUERY всё, что идёт по таблице стенда (FROM hlt) дольше порога.
// Отбор только по таблице hlt: в той же схеме живут соседние базы со своими таблицами.
const SSH = process.env.HLT_SSH || 'root@92.242.60.37';
async function killTails(minSec = CAP) {
  const sql = `SELECT GROUP_CONCAT(ID) FROM information_schema.PROCESSLIST WHERE COMMAND='Query' ` +
    `AND ID<>CONNECTION_ID() AND TIME>=${minSec} AND INFO LIKE '%FROM hlt a%'`;
  try {
    const { stdout } = await run('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', SSH, `mysql -N -e "${sql}"`], { timeout: 30000 });
    const ids = stdout.trim().split(',').filter(x => /^\d+$/.test(x));
    for (const id of ids) await run('ssh', ['-o', 'BatchMode=yes', SSH, `mysql -e "KILL QUERY ${id}"`], { timeout: 30000 }).catch(() => {});
    if (ids.length) console.log(`  killed ${ids.length} tail(s): ${ids.join(',')}`);
    return ids.length;
  } catch (e) { console.log('  killTails failed:', String(e.message).split('\n')[0].slice(0, 80)); return 0; }
}
let killed = 0, sweeping = null;
// одна чистка на всех: на насыщении таймаут ловят сразу десятки потоков
const sweep = () => sweeping || (sweeping = killTails().then(n => { killed += n; sweeping = null; }));
const pct = (a, q) => a.length ? a[Math.min(a.length - 1, Math.floor(q * a.length))] : null;
const selUrl = (t, q, lim) => `https://ideav.ru/hlt/report/${S.queries[t][q]}?JSON_KV&LIMIT=${lim}&TIME=${CAP}`;
const aggUrl = (t, q, span, cap) =>
  `https://ideav.ru/hlt/report/${S.queries[t][q]}?JSON_KV&FR_code=>=0&TO_code=<${span}&TIME=${cap}`;

// A: T потоков крутят запрос SEC секунд; прогрев — по одному запросу на поток, не считается
const RAMP = [1, 2, 3, 4, 6, 8, 10, 15, 25, 50], SEC = 20;
// Каждый поток делает не меньше 2 запросов, даже если ступень дольше SEC (тяжёлые отчёты).
async function rampCell(url, threads) {
  await Promise.all(Array.from({ length: threads }, async (_, w) => { await sleep(w * 40); await curl(url, CAP); }));
  const lat = []; let ok = 0, fail = 0; const errs = {};
  const t0 = Date.now();
  await Promise.all(Array.from({ length: threads }, async () => {
    let mine = 0;
    while (Date.now() - t0 < SEC * 1000 || mine < 2) {
      mine++;
      const r = await curl(url, CAP);
      if (r.ok) { ok++; lat.push(r.ms); } else { fail++; errs[r.err] = (errs[r.err] || 0) + 1; }
    }
  }));
  const dur = (Date.now() - t0) / 1000;
  lat.sort((a, b) => a - b);
  return { rps: +(ok / dur).toFixed(2), n: ok + fail, ok, fail, p50: pct(lat, 0.5), p95: pct(lat, 0.95),
    max: lat[lat.length - 1] || null, ...(fail ? { errs } : {}) };
}

// B, C: одиночный агрегат RUNS раз подряд, медиана; первый отказ — ячейку не долбим
async function aggCell(table, q, span, cap, runs) {
  const ms = []; let err = null;
  for (let r = 0; r < runs; r++) {
    const x = await curl(aggUrl(table, q, span, cap), cap);
    console.log(`  r${r + 1}: ${x.ok ? x.ms + 'ms' : 'FAIL ' + x.err}`);
    if (!x.ok) { err = x.err; break; }
    ms.push(x.ms);
    await sleep(1500);
  }
  ms.sort((a, b) => a - b);
  return { rounds: ms.length, ...(ms.length ? { ms, median: ms[Math.floor((ms.length - 1) / 2)] } : {}), ...(err ? { err } : {}) };
}

async function cellOnce(part, scenario, table, threads, fn) {
  const k = `${part}|${scenario}|${table}|${threads}`;
  if (done.has(k)) { console.log('skip', k); return out.find(r => `${r.part}|${r.scenario}|${r.table}|${r.threads}` === k); }
  console.log(new Date().toISOString().slice(11, 19), part, scenario, table, '×' + threads);
  await sweep(); // хвосты прошлой ячейки не должны грузить эту
  killed = 0;
  const r = await fn();
  await sweep();
  const rec = { part, scenario, table, threads, batch: 'rm2610', at: new Date().toISOString(), ...r, ...(killed ? { killed } : {}) };
  out.push(rec);
  save();
  console.log('  ->', JSON.stringify(r));
  return rec;
}

// лесенка с критерием остановки
async function ramp(part, scenario, table, url) {
  let firstTimeout = null;
  for (const th of RAMP) {
    if (firstTimeout !== null && RAMP.indexOf(th) - RAMP.indexOf(firstTimeout) > AFTER_TIMEOUT) {
      await cellOnce(part, scenario, table, th, async () => ({ skipped: true,
        reason: `не измерялось — сработал критерий остановки (таймауты >${CAP} с с ×${firstTimeout})` }));
      continue;
    }
    const rec = await cellOnce(part, scenario, table, th, () => rampCell(url, th));
    if (firstTimeout === null && rec && !rec.skipped && Object.keys(rec.errs || {}).some(e => e.startsWith('timeout')))
      firstTimeout = th;
    await sleep(5000); // дать серверу выдохнуть между ступенями
  }
}

if (parts.includes('A')) {
  for (const [sc, t] of [['sel1_100', 'T_100K_W12'], ['sel5_500', 'T_100K_W12']]) {
    const [q, lim] = sc.split('_');
    await ramp('A', sc, t, selUrl(t, q, lim));
  }
}
if (parts.includes('B')) {
  for (const t of ['T_1K_W12', 'T_10K_W12', 'T_100K_W12', 'T_1M_W12', 'T_1K_W45', 'T_10K_W45', 'T_100K_W45', 'T_1M_W45']) {
    const big = t.startsWith('T_1M');
    for (const q of ['agg1', 'agg3', 'agg5']) {
      await cellOnce('B', q + '_all', t, 1, () => aggCell(t, q, S.tables[t].rows, big ? 150 : 60, big ? 2 : 3));
    }
  }
}
if (parts.includes('C')) {
  for (const t of ['T_1M_W12', 'T_1M_W45']) for (const q of ['agg3', 'agg5']) for (const [sp, n] of [['1k', 1000], ['5k', 5000]]) {
    await cellOnce('C', `${q}_${sp}`, t, 1, () => aggCell(t, q, n, 150, 2));
  }
}
if (parts.includes('D')) {
  for (const t of ['T_10K_W12', 'T_100K_W12']) {
    await ramp('D', 'agg1_all', t, aggUrl(t, 'agg1', S.tables[t].rows, CAP));
  }
}
// E: все срезы таблиц 1М одной партией. Одиночный запрос ждём до конца (150 с) — нужна цифра;
// дольше порога CAP — второй прогон не делаем, на графике точка помечается «за порогом».
if (parts.includes('E')) {
  const SP = [['1k', 1000], ['5k', 5000], ['10k', 10000], ['50k', 50000], ['100k', 100000]];
  for (const t of ['T_1M_W12', 'T_1M_W45']) for (const q of ['agg1', 'agg3', 'agg5']) for (const [sp, n] of SP) {
    await cellOnce('E', `${q}_${sp}`, t, 1, async () => {
      const ms = []; let err = null;
      for (let r = 0; r < 2; r++) {
        const x = await curl(aggUrl(t, q, n, 150), 150);
        const v = x.ok ? x.ms : (x.err.startsWith('timeout') && x.ms < 150000 ? x.ms : null); // 60–150 с — время известно
        console.log(`  r${r + 1}: ${v ? v + 'ms' : 'FAIL ' + x.err}`);
        if (v == null) { err = x.err; break; }
        ms.push(v);
        if (v > CAP * 1000) break;
        await sleep(1500);
      }
      ms.sort((a, b) => a - b);
      return { rounds: ms.length, ...(ms.length ? { ms, median: ms[Math.floor((ms.length - 1) / 2)] } : {}), ...(err ? { err } : {}) };
    });
  }
}
console.log('done:', out.length, 'cells ->', OUT);
