// fast bulk loader via object/{tid}?JSON&import=1 (plain-data BKI, docs/kb/import.md)
// usage: node import.mjs table T_1K_W45 [workers] [fromOverride]
import { apiGet, retry, log, getXsrf, sleep, TOKEN } from './api.mjs';
import { rowValues } from './gen.mjs';
import { MAINS } from './schema.mjs';
import fs from 'fs';

const BASE = 'https://ideav.ru/hlt';
const state = JSON.parse(fs.readFileSync('state.json', 'utf8'));
const WIDE = (name) => name.endsWith('_W45');
const DREF = {
  author: { name: 'Authors', n: 1000 },
  genre: { name: 'Genres', n: 100 },
  publisher: { name: 'Publishers', n: 500 },
  country: { name: 'Countries', n: 100 },
};

async function count(tid) {
  const j = await retry(() => apiGet(`/object/${tid}/?JSON_KV&_count=&TIME=120`));
  const o = Array.isArray(j) ? j[0] : j; return +Object.values(o)[0];
}

function chunkFile(tid, from, n, wide) {
  const lines = ['DATA'];
  for (let i = from; i < from + n; i++) {
    lines.push(rowValues(i, wide, DREF).join(';') + ';;'); // trailing extra empty field (kb gotcha)
  }
  return lines.join('\n') + '\n';
}

async function importChunk(name, tid, from, n, wide) {
  const content = chunkFile(tid, from, n, wide);
  const xsrf = await getXsrf();
  const form = new FormData();
  form.append('token', TOKEN);
  form.append('_xsrf', xsrf);
  form.append('bki_file', new Blob([content], { type: 'text/plain' }), 'chunk.bki');
  const r = await retry(async () => {
    const resp = await fetch(`${BASE}/object/${tid}?JSON&import=1&TIME=600`, {
      method: 'POST',
      headers: { 'X-Authorization': TOKEN },
      body: form,
      signal: AbortSignal.timeout(600000),
    });
    const text = await resp.text();
    if (resp.status !== 200) throw new Error(`import ${from}+${n} -> ${resp.status}: ${text.slice(0, 200)}`);
    if (/^\s*<|<!DOCTYPE|<html/i.test(text.slice(0, 200)))
      throw new Error(`import ${from}+${n} -> HTML error page: ${text.slice(0, 200).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')}`);
    return text;
  });
  return r;
}

async function loadMain(name, workers = 2, fromOverride = null, cap = 0) {
  const m = MAINS.find(x => x.name === name);
  const st = state.tables[name];
  const tid = st.tid;
  const wide = WIDE(name);
  const CH = wide ? 4000 : 15000; // rows per file; >4k wide / >15k narrow chunks were silently dropped
  const total = cap ? Math.min(cap, m.rows) : m.rows;
  const from0 = fromOverride ?? await count(tid);
  if (from0 >= total) { log(name, 'already full:', from0); return; }
  log(name, tid, wide ? 'wide' : 'narrow', 'from', from0, '/', total);
  const t0 = Date.now();
  let next = from0, done = 0, failed = null;
  const secs = () => (Date.now() - t0) / 1000;
  async function worker() {
    while (!failed) {
      const myFrom = next;
      if (myFrom >= total) return;
      next = myFrom + CH;
      const n = Math.min(CH, total - myFrom);
      try {
        await importChunk(name, tid, myFrom, n, wide);
        done += n;
        const rate = done / secs();
        log(name, 'at', myFrom + n, `${rate.toFixed(0)} rows/s, ETA ${((total - from0 - done) / rate / 60).toFixed(1)} min`);
      } catch (e) { failed = e.message; }
    }
  }
  await Promise.all(Array.from({ length: workers }, worker));
  if (failed) console.error('IMPORT FAIL:', failed);
  const have = await count(tid);
  log(name, 'count =', have, `${(done / secs()).toFixed(0)} rows/s avg`);
  if (have !== total) throw new Error(`count mismatch: ${have} != ${total}`);
}

const [cmd, arg, w, fromOv, capArg] = process.argv.slice(2);
if (cmd === 'table') await loadMain(arg, +(w || 2), fromOv === undefined || fromOv === '' ? null : +fromOv, +(capArg || 0));
else console.log('usage: node import.mjs table <T_name> [workers] [from] [cap]');
