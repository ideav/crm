// finish upd5/one ×5 cells via curl (node fetch locally broken)
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
const run = promisify(execFile);
const S = JSON.parse(fs.readFileSync('state.json', 'utf8'));
const R = JSON.parse(fs.readFileSync('results.json', 'utf8'));

const xsrf = JSON.parse((await run('curl', ['-s', '-m', '20', '-H', 'X-Authorization: YOUR_TOKEN', 'https://ideav.ru/hlt/xsrf?JSON'])).stdout)._xsrf;
const curl = async (args) => {
  const t0 = Date.now();
  const { stdout } = await run('curl', ['-s', '-m', '35', '-H', 'X-Authorization: YOUR_TOKEN', ...args], { timeout: 40000 });
  return { ms: Date.now() - t0, body: stdout };
};

for (const t of ['T_1K_W12', 'T_100K_W12', 'T_1M_W12']) {
  const tid = S.tables[t].tid, c = S.tables[t].cols;
  // warm the cold InnoDB pool for this table (MySQL restarted 15:57): read 1 record until <1.5s
  for (let w = 1; w <= 12; w++) {
    const { ms } = await curl([`https://ideav.ru/hlt/object/${tid}/?JSON_OBJ&LIMIT=1&TIME=30`]).catch(e => ({ ms: 99999, body: '' }));
    console.log('  warm', t, w, ms + 'мс');
    if (ms < 1500) break;
    await new Promise(r => setTimeout(r, 1000));
  }
  let ids;
  try {
    ids = JSON.parse((await curl([`https://ideav.ru/hlt/report/${S.queries[t].sel1}?JSON_KV&LIMIT=50&TIME=30`])).body).map(x => +x.id);
  } catch (e) { console.log('  ids FAIL', t, '- пропускаю таблицу'); continue; }
  if (!ids.length) { console.log('  нет id', t); continue; }
  for (const scen of ['upd5', 'one']) {
    const existing = R.find(x => x.scenario === scen && x.table === t && x.threads === 5);
    if (existing && !existing.saturation && existing.ok > 0) { console.log('skip', scen, t); continue; }
    // ×5 потоков: 5 серий по 1 запросу, берём медиану
    const samples = [];
    for (let i = 0; i < 5; i++) {
      const id = ids[Math.floor(Math.random() * ids.length)];
      try {
        if (scen === 'one') {
          const r1 = await curl([`https://ideav.ru/hlt/object/${tid}/?JSON_OBJ&F_I=${id}&TIME=30`]);
          JSON.parse(r1.body);
          samples.push(r1.ms);
        } else {
          const r1 = await curl([`https://ideav.ru/hlt/object/${tid}/?JSON_OBJ&F_I=${id}&TIME=30`]);
          JSON.parse(r1.body);
          const r2 = await curl(['-X', 'POST', `https://ideav.ru/hlt/_m_set/${id}?JSON&TIME=30`,
            '--data-urlencode', `token=YOUR_TOKEN`, '--data-urlencode', `_xsrf=${xsrf}`,
            '--data-urlencode', `t${c.year}=1970`, '--data-urlencode', `t${c.price}=55.55`,
            '--data-urlencode', `t${c.rating}=5.0`, '--data-urlencode', `t${c.is_active}=1`, '--data-urlencode', `t${c.released}=2021-06-15`]);
          JSON.parse(r2.body);
          samples.push(r1.ms + r2.ms);
        }
      } catch (e) { samples.push(-1); console.log('  fail', scen, t, i, String(e.message).slice(0, 40)); }
      await new Promise(r => setTimeout(r, 400));
    }
    const okS = samples.filter(x => x > 0).sort((a, b) => a - b);
    const entry = okS.length
      ? { scenario: scen, table: t, threads: 5, seconds: 8, rounds: 0, rps: +(okS.length / (okS.reduce((a, b) => a + b, 0) / 1000)).toFixed(1), n: samples.length, ok: okS.length, fail: samples.length - okS.length, avg: Math.round(okS.reduce((a, b) => a + b, 0) / okS.length), p50: okS[Math.floor(okS.length / 2)], p90: okS[okS.length - 1], p95: okS[okS.length - 1], p99: okS[okS.length - 1], max: okS[okS.length - 1] }
      : { scenario: scen, table: t, threads: 5, saturation: true };
    const k = R.findIndex(x => x.scenario === scen && x.table === t && x.threads === 5);
    if (k >= 0) R[k] = entry; else R.push(entry);
    console.log(scen, t, entry.saturation ? 'SAT' : 'p50=' + entry.p50 + 'мс ok=' + entry.ok + '/' + entry.n);
    fs.writeFileSync('results.json', JSON.stringify(R, null, 1));
  }
}
console.log('upd5-curl done');
