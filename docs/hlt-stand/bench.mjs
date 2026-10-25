// load bench for hlt stand, issue ideav/crm#5267
// usage:
//   node bench.mjs all                          — full grid (see GRID below)
//   node bench.mjs cell <scenario> <table> <threads> [limit]   — one cell, prints json line
//   node bench.mjs cleanup                      — delete zz_bench% rows from all tables
import { apiGet, apiPost, log, getXsrf, sleep, TOKEN, retry } from './api.mjs';
import fs from 'fs';

const BASE = 'https://ideav.ru/hlt';
const state = JSON.parse(fs.readFileSync('state.json', 'utf8'));
const MARK = 'zz_bench';

const T = (name) => state.tables[name]; // {tid, cols}
const Q = (name) => state.queries[name]; // {sel1, sel3, sel5, agg1, agg3, agg5, upd}

let ID_CACHE = {};
async function recIds(name, n = 200) {
  ID_CACHE[name] = ID_CACHE[name] ||
    (await retry(() => apiGet(`/object/${T(name).tid}/?JSON_OBJ&LIMIT=${n}&TIME=60`), 6, 2000)).map(r => +r.i);
  return ID_CACHE[name];
}

// one measured request -> {ok, ms}
async function req(fn) {
  const t0 = Date.now();
  try { await fn(); return { ok: true, ms: Date.now() - t0 }; }
  catch (e) { return { ok: false, ms: Date.now() - t0, err: String(e.message).slice(0, 120) }; }
}

async function addOne(name, i) {
  const tid = T(name).tid;
  return req(() => apiPost(`/_m_new/${tid}?JSON`, { up: '1', [`t${tid}`]: `${MARK}_${Date.now()}_${i}`, [`t${T(name).cols.code}`]: String(3000000000 + i) }, 35000));
}
async function upd5(name, id, i) {
  const c = T(name).cols;
  const read = await req(() => apiGet(`/object/${T(name).tid}/?JSON_OBJ&F_I=${id}&TIME=30`, 35000));
  const write = await req(() => apiPost(`/_m_set/${id}?JSON&TIME=30`, {
    [`t${c.year}`]: String(1950 + (i % 76)), [`t${c.price}`]: (i % 1000).toFixed(2),
    [`t${c.rating}`]: (i % 100 / 10).toFixed(1), [`t${c.is_active}`]: String(i % 2), [`t${c.released}`]: '2021-06-15',
  }, 35000));
  return { ok: read.ok && write.ok, ms: read.ms + write.ms, err: read.err || write.err };
}
async function updN(name, n) {
  return req(() => apiPost(`/report/${Q(name).upd}?JSON_KV&TIME=30`, { confirmed: '1', 'TO_code': `<${n}` }, 35000));
}
async function batch100(name, i) {
  const tid = T(name).tid, c = T(name).cols;
  const ops = Array.from({ length: 100 }, (_, k) => ({
    op: 'new', id: tid, up: 1,
    fields: { [`t${tid}`]: `${MARK}_b${i}_${k}`, [`t${c.code}`]: String(3000000000 + i * 100 + k) },
  }));
  return req(() => apiPost('/_m_batch', { ops: JSON.stringify(ops) }, 35000));
}
async function oneRec(name) {
  const ids = await recIds(name, 50);
  const id = ids[Math.floor(Math.random() * ids.length)];
  return req(() => apiGet(`/object/${T(name).tid}/?JSON_OBJ&F_I=${id}&TIME=30`, 35000));
}
async function page(name, pg) {
  return req(() => apiGet(`/object/${T(name).tid}/?JSON_KV&LIMIT=20&pg=${pg}&TIME=30`, 35000));
}
// hard 30s ceiling everywhere (owner: >30s = "не обслуживается", фиксируем и не ждём)
async function sel(name, q, limit) {
  return req(() => apiGet(`/report/${Q(name)[q]}?JSON_KV&LIMIT=${limit}&TIME=30`, 35000));
}
async function agg(name, q, limit) {
  // aggregate over ~100x more rows than the sel LIMIT (issue #5267 item 4)
  const rows = T(name).rows;
  const span = Math.min(limit * 100, rows - 1);
  return req(() => apiGet(`/report/${Q(name)[q]}?JSON_KV&FR_code=>=0&TO_code=<${span}&TIME=30`, 35000));
}
// aggregations over day/week/month-sized slices of the million tables.
// Owner rule (final): hard 30s ceiling everywhere — above that we record "не обслуживается"
async function aggSpan(name, q, span) {
  span = Math.min(span, T(name).rows - 1);
  return req(() => apiGet(`/report/${Q(name)[q]}?JSON_KV&FR_code=>=0&TO_code=<${span}&TIME=30`, 35000));
}

const SCEN = {
  add1: (n, i) => addOne(n, i),
  upd5: async (n, i) => upd5(n, (await recIds(n))[i % 200], i),
  upd10: (n) => updN(n, 10),
  upd100: (n) => updN(n, 100),
  upd500: (n) => updN(n, 500),
  batch100: (n, i) => batch100(n, i),
  one: (n) => oneRec(n),
  page1: (n) => page(n, 1),
  pagemid: (n) => page(n, Math.floor(T(n).rows / 20 / 2)),
  pagelast: (n) => page(n, Math.floor(T(n).rows / 20)),
};
for (const q of ['sel1', 'sel3', 'sel5']) for (const lim of [10, 100, 500, 5000]) SCEN[`${q}_${lim}`] = (n) => sel(n, q, lim);
for (const q of ['agg1', 'agg3', 'agg5']) for (const lim of [10, 100, 500, 5000]) SCEN[`${q}_${lim}`] = (n) => agg(n, q, lim);
// slices of the million tables: ~day (10k) / week (50k) / month (100k)
for (const q of ['agg1', 'agg3', 'agg5']) for (const [sp, n] of [['10k', 10000], ['50k', 50000], ['100k', 100000]]) SCEN[`${q}_${sp}`] = (t) => aggSpan(t, q, n);

// run scenario cell: threads workers, time-boxed seconds (or fixed rounds per worker).
// Warmup round first (staggered, untimed): 50 fresh TLS connects fail en masse when cold.
async function cell(scenario, table, threads, seconds = 10, rounds = 0) {
  const fn = SCEN[scenario];
  const lat = []; let ok = 0, fail = 0; const errs = {};
  await Promise.all(Array.from({ length: threads }, async (_, w) => {
    await sleep(w * 40);
    try { await fn(table, w); } catch { /* warmup: errors don't count */ }
  }));
  const t0 = Date.now();
  async function worker(w) {
    let i = w;
    while (rounds ? i < rounds * threads : Date.now() - t0 < seconds * 1000) {
      const r = await fn(table, i);
      lat.push(r.ms);
      if (r.ok) ok++; else { fail++; errs[r.err || 'unknown'] = (errs[r.err || 'unknown'] || 0) + 1; }
      i += threads;
    }
  }
  await Promise.all(Array.from({ length: threads }, (_, w) => worker(w)));
  lat.sort((a, b) => a - b);
  const p = (q) => lat.length ? lat[Math.min(lat.length - 1, Math.floor(q * lat.length))] : null;
  const dur = (Date.now() - t0) / 1000;
  return {
    scenario, table, threads, seconds: rounds ? `${rounds}r` : seconds, rounds,
    rps: +(lat.length / dur).toFixed(1),
    n: lat.length, ok, fail,
    avg: +(lat.reduce((a, b) => a + b, 0) / (lat.length || 1)).toFixed(0),
    p50: p(0.5), p90: p(0.9), p95: p(0.95), p99: p(0.99), max: lat[lat.length - 1] || null,
    errs: Object.keys(errs).length ? errs : undefined,
  };
}

const ALL_TABLES = ['T_1K_W12', 'T_1K_W45', 'T_10K_W12', 'T_10K_W45', 'T_100K_W12', 'T_100K_W45', 'T_1M_W12', 'T_1M_W45'];
const WRITE_TABLES = ['T_1K_W12', 'T_100K_W12', 'T_100K_W45', 'T_1M_W12', 'T_1M_W45'];
const SLOW = /^upd(10|100|500)$|^agg\w+_(500|5000|10k|50k|100k)$|^pagemid$|^pagelast$/; // rounds-mode: bounded wall time
// x50 only for fast ops (reports at x50 overflow the server worker queue -> connect timeouts)
const FAST50 = new Set(['add1', 'upd5', 'batch100', 'one', 'page1', 'sel1_10']);
const REP4 = ['T_100K_W12', 'T_100K_W45', 'T_1M_W12', 'T_1M_W45'];
const SIZES = [10, 100, 500, 5000];
const GRID = [];
const push = (s, t, th, sec) => GRID.push([s, t, th, sec, SLOW.test(s) ? (th <= 5 ? 2 : 1) : 0]);
for (const t of ALL_TABLES) {
  for (const q of ['sel1', 'sel3', 'sel5']) for (const lim of SIZES) {
    push(`${q}_${lim}`, t, 5, 8);
    if (lim !== 5000 || REP4.includes(t)) push(`${q}_${lim}`, t, 25, 6);
    if (q === 'sel1' && lim === 10) push(`${q}_${lim}`, t, 50, 6);
  }
  for (const q of ['agg1', 'agg3', 'agg5']) for (const lim of SIZES) {
    push(`${q}_${lim}`, t, 5, 8);
    if (lim !== 5000 || REP4.includes(t)) push(`${q}_${lim}`, t, 25, 6);
  }
}
for (const t of WRITE_TABLES) {
  for (const s of ['add1', 'upd5', 'upd10', 'upd100', 'upd500', 'batch100', 'one']) {
    push(s, t, 5, 8); push(s, t, 25, 6); if (FAST50.has(s)) push(s, t, 50, 6);
  }
}
for (const s of ['page1', 'pagemid', 'pagelast']) {
  const ths = FAST50.has(s) ? [5, 25, 50] : [5, 25];
  for (const th of ths) { push(s, 'T_100K_W12', th, 8); push(s, 'T_1M_W12', th, 8); }
}
// extra concurrency step (x10) on representative tables for the scaling curve
const DETAIL = ['sel1_100', 'sel3_100', 'sel5_100', 'sel5_500', 'agg1_100', 'agg5_500'];
for (const t of REP4) for (const s of DETAIL) push(s, t, 10, 6);
// rare heavy aggregations over day/week/month slices of the million tables (single-threaded, 30s cap, 1 probe)
for (const t of ['T_1M_W12', 'T_1M_W45']) for (const q of ['agg1', 'agg3', 'agg5']) for (const sp of ['10k', '50k', '100k']) {
  GRID.push([`${q}_${sp}`, t, 1, 0, 1]);
}

async function runAll() {
  // resume: keep good cells from results.json, re-run failed/missing, drop cells no longer in the grid
  const gridKeys = new Set(GRID.map(([s, t, th]) => `${s}|${t}|${th}`));
  let results = fs.existsSync('results.json') ? JSON.parse(fs.readFileSync('results.json', 'utf8')) : [];
  results = results.filter(r => gridKeys.has(`${r.scenario}|${r.table}|${r.threads}`));
  const good = new Set();
  for (const r of results) {
    if (r.saturation) { good.add(`${r.scenario}|${r.table}|${r.threads}`); continue; } // two strikes already
    if (!r.error && r.n && r.fail / r.n < 0.2) good.add(`${r.scenario}|${r.table}|${r.threads}`);
  }
  const todo = GRID.filter(([s, t, th]) => !good.has(`${s}|${t}|${th}`));
  log('grid:', GRID.length, 'cells,', results.length, 'have,', good.size, 'good,', todo.length, 'to run');
  const total = GRID.length;
  let i = 0;
  for (const [s, t, th, sec, rounds] of todo) {
    i++;
    if (!Q(t)) { log('skip (no queries yet):', t); continue; }
    let r;
    try {
      r = await cell(s, t, th, sec, rounds);
    } catch (e) { // transient network death must not kill the grid
      log(`[${i}/${todo.length}] CELL CRASH`, s, t, `x${th}:`, String(e.message).slice(0, 100));
      results.push({ scenario: s, table: t, threads: th, seconds: sec, error: String(e.message).slice(0, 150) });
      await sleep(5000);
      continue;
    }
    // replace previous bad result for the same cell, if any
    const k = results.findIndex(x => x.scenario === s && x.table === t && x.threads === th);
    if (k >= 0) results[k] = r; else results.push(r);
    fs.writeFileSync('results.json', JSON.stringify(results, null, 1));
    log(`[${i}/${todo.length}]`, s, t, `x${th}`, `rps=${r.rps} p50=${r.p50} p95=${r.p95} p99=${r.p99} fail=${r.fail}`);
    await sleep(1500); // breather between cells
  }
  fs.writeFileSync('results.json', JSON.stringify(results, null, 1));
  log('grid done:', results.length, 'cells stored');
}

// re-run cells with heavy failures (transient network blips) and merge back.
// A cell that failed in the grid AND fails the rerun is past the saturation point:
// mark it and never wait on timeouts for it again (owner rule: two strikes = stop climbing)
async function rerun(threshold = 0.2) {
  const results = JSON.parse(fs.readFileSync('results.json', 'utf8'));
  let fixed = 0, saturated = 0;
  for (let k = 0; k < results.length; k++) {
    const r = results[k];
    if (r.saturation) continue;
    const bad = r.error || (r.n && r.fail / r.n >= threshold);
    if (!bad) continue;
    // second strike on this cell (failed grid run + failed rerun) => saturation
    const prevBad = r.retried === true;
    if (prevBad) {
      results[k] = { scenario: r.scenario, table: r.table, threads: r.threads, saturation: true };
      saturated++;
      log('SATURATION:', r.scenario, r.table, `x${r.threads}`);
      continue;
    }
    const sec = typeof r.seconds === 'string' && r.seconds.endsWith('r') ? 6 : r.seconds;
    log('rerun', r.scenario, r.table, `x${r.threads}`);
    try {
      const again = await cell(r.scenario, r.table, r.threads, sec, r.rounds || 0);
      results[k] = again;
      results[k].retried = true;
      if (again.n && again.fail / again.n >= threshold) { // still bad after retry -> saturation
        results[k] = { scenario: r.scenario, table: r.table, threads: r.threads, saturation: true };
        saturated++;
        log('SATURATION:', r.scenario, r.table, `x${r.threads}`);
      } else fixed++;
    } catch (e) {
      results[k] = { scenario: r.scenario, table: r.table, threads: r.threads, saturation: true };
      saturated++;
      log('SATURATION (crash):', r.scenario, r.table, `x${r.threads}`);
    }
    fs.writeFileSync('results.json', JSON.stringify(results, null, 1));
    await sleep(1500);
  }
  fs.writeFileSync('results.json', JSON.stringify(results, null, 1));
  log('rerun done:', fixed, 'cells fixed,', saturated, 'marked saturated');
}

async function cleanup() {
  for (const t of ALL_TABLES) {
    const tid = T(t).tid;
    for (let pg = 1; ; pg++) {
      const rows = await apiGet(`/object/${tid}/?JSON_OBJ&F_${tid}=${MARK}%25&LIMIT=1000&pg=${pg}&TIME=120`);
      if (!rows.length) break;
      const ops = rows.map(r => ({ op: 'del', id: r.i }));
      const res = await apiPost('/_m_batch', { ops: JSON.stringify(ops) }, 300000);
      log(t, 'del', ops.length, 'failed:', res.failed || 0);
      if (rows.length < 1000) break;
    }
    const c = await apiGet(`/object/${tid}/?JSON_KV&_count=&TIME=120`);
    log(t, 'count now:', Object.values(c[0] || c)[0]);
  }
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === 'all') await runAll();
else if (cmd === 'rerun') await rerun(+(args[0] || 0.2));
else if (cmd === 'cell') console.log(JSON.stringify(await cell(args[0], args[1], +args[2], +(args[3] || 10), 0)));
else if (cmd === 'cleanup') await cleanup();
else if (cmd === 'grid') console.log(GRID.length, 'cells');
else console.log('usage: node bench.mjs all | cell <scenario> <table> <threads> [sec] | cleanup | grid');
