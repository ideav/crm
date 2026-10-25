// loader: dictionaries first, then main tables in _m_batch chunks; resume by current record count
// usage: node load.mjs dicts | node load.mjs table T_1K_W12 [workers]
import { apiGet, apiPost, retry, log, sleep } from './api.mjs';
import { batchOps } from './gen.mjs';
import { DICTS, MAINS } from './schema.mjs';
import fs from 'fs';

const state = JSON.parse(fs.readFileSync('state.json', 'utf8'));
const WIDE = (name) => name.endsWith('_W45');

async function count(tid) {
  const j = await retry(() => apiGet(`/object/${tid}/?JSON_KV&_count=&TIME=120`));
  return +(Array.isArray(j) ? j[0]?.count ?? j[0]?.cnt ?? Object.values(j[0] || {})[0] : j.count);
}

async function loadBatch(tid, ops) {
  const r = await retry(() => apiPost('/_m_batch', { ops: JSON.stringify(ops) }, 600000));
  const bad = (r.results || []).filter(x => !x.ok);
  if (bad.length) throw new Error(`batch: ${bad.length}/${ops.length} failed, e.g. ${JSON.stringify(bad[0])}`);
  return r;
}

async function loadDict(d) {
  const tid = state.dicts[d.name].tid;
  let have = await count(tid);
  log(d.name, tid, 'have', have, '/', d.n);
  while (have < d.n) {
    const n = Math.min(500, d.n - have);
    const ops = Array.from({ length: n }, (_, k) => ({
      op: 'new', id: tid, up: 1, fields: { [`t${tid}`]: `${d.name.slice(2)}_${String(have + k).padStart(6, '0')}` },
    }));
    await loadBatch(tid, ops);
    have += n;
  }
  // collect record ids (JSON_OBJ rows: {i: id, ...}); paginate with dedup (kb: LIMIT/pg dups)
  const ids = new Set();
  let pg = 1;
  while (true) {
    const j = await retry(() => apiGet(`/object/${tid}/?JSON_OBJ&LIMIT=1000&pg=${pg}&TIME=120`));
    if (!Array.isArray(j) || !j.length) break;
    for (const r of j) ids.add(+r.i);
    if (j.length < 1000 || ids.size >= d.n) break;
    pg++;
  }
  state.dicts[d.name].ids = [...ids];
  log(d.name, 'ids collected:', ids.size);
  fs.writeFileSync('state.json', JSON.stringify(state, null, 1));
}

async function loadMain(name, workers = 3) {
  const m = MAINS.find(x => x.name === name);
  if (!m) throw new Error('no such table: ' + name);
  const st = state.tables[name];
  const tid = st.tid;
  const wide = WIDE(name);
  const dictIds = {
    author: state.dicts.D_Authors.ids,
    genre: state.dicts.D_Genres.ids,
    publisher: state.dicts.D_Publishers.ids,
    country: state.dicts.D_Countries.ids,
  };
  const CH = wide ? 500 : 1000; // ops per batch (payload bound)
  const keymap = { title: `t${tid}` };
  for (const [alias, reqId] of Object.entries(st.cols)) if (alias !== 'title') keymap[alias] = `t${reqId}`;
  let from = await count(tid);
  log(name, tid, wide ? 'wide' : 'narrow', 'from', from, '/', m.rows);
  const t0 = Date.now();
  let done = 0;
  let next = from;
  let failed = false;
  async function worker() {
    while (!failed) {
      const myFrom = next; // reserve
      if (myFrom >= m.rows) return;
      next = myFrom + CH;
      const n = Math.min(CH, m.rows - myFrom);
      try {
        await loadBatch(tid, batchOps(tid, myFrom, n, wide, dictIds, keymap));
        done += n;
        if ((done / CH) % 10 === 0) {
          const rate = done / ((Date.now() - t0) / 1000);
          log(name, 'at', myFrom + n, `${rate.toFixed(0)} rows/s, ETA ${((m.rows - from - done) / rate / 60).toFixed(1)} min`);
        }
      } catch (e) {
        failed = true;
        console.error('BATCH FAIL at', myFrom, e.message);
      }
    }
  }
  await Promise.all(Array.from({ length: workers }, worker));
  const have = await count(tid);
  const rate = done / ((Date.now() - t0) / 1000);
  log(name, 'done, count =', have, `(${rate.toFixed(0)} rows/s avg)`);
  if (have !== m.rows) throw new Error(`count mismatch: ${have} != ${m.rows} (failed batch above)`);
}

const [cmd, arg, w] = process.argv.slice(2);
if (cmd === 'dicts') {
  for (const d of DICTS) await loadDict(d);
} else if (cmd === 'table') {
  await loadMain(arg, +(w || 3));
} else {
  console.log('usage: node load.mjs dicts | node load.mjs table <T_name> [workers]');
}
