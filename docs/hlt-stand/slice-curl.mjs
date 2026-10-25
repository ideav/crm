// finish slice cells via curl (node fetch is locally flaky after hours of TIME_WAIT buildup)
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
const run = promisify(execFile);
const S = JSON.parse(fs.readFileSync('state.json', 'utf8'));
const R = JSON.parse(fs.readFileSync('results.json', 'utf8'));
const SPANS = { '10k': 10000, '50k': 50000, '100k': 100000 };

for (const t of ['T_1M_W12', 'T_1M_W45']) {
  for (const q of ['agg1', 'agg3', 'agg5']) {
    for (const [sp, spanN] of Object.entries(SPANS)) {
      const scen = `${q}_${sp}`;
      const existing = R.find(x => x.scenario === scen && x.table === t && x.threads === 1);
      if (existing && !existing.error && !existing.saturation && existing.ok > 0) { console.log('skip ok:', scen, t); continue; }
      const span = Math.min(spanN, S.tables[t].rows - 1);
      const url = `https://ideav.ru/hlt/report/${S.queries[t][q]}?JSON_KV&FR_code=>=0&TO_code=<${span}&TIME=30`;
      const t0 = Date.now();
      let entry;
      try {
        const { stdout } = await run('curl', ['-s', '-m', '35', '-w', '\\n%{http_code} %{time_total}', '-H', 'X-Authorization: YOUR_TOKEN', url], { timeout: 40000 });
        const nl = stdout.lastIndexOf('\n');
        const body = stdout.slice(0, nl), meta = stdout.slice(nl + 1).trim();
        const ms = Math.round(parseFloat(meta.split(' ')[1]) * 1000);
        JSON.parse(body); // throws on HTML/error page
        entry = { scenario: scen, table: t, threads: 1, seconds: '1r', rounds: 1, rps: +(1000 / ms).toFixed(1), n: 1, ok: 1, fail: 0, avg: ms, p50: ms, p90: ms, p95: ms, p99: ms, max: ms };
        console.log('OK', scen, t, ms + 'мс');
      } catch (e) {
        const ms = Date.now() - t0;
        entry = { scenario: scen, table: t, threads: 1, seconds: '1r', rounds: 1, rps: 0, n: 1, ok: 0, fail: 1, avg: ms, p50: ms, errs: { [String(e.message).slice(0, 60)]: 1 } };
        console.log('FAIL', scen, t, ms + 'мс', String(e.message).slice(0, 60));
      }
      const k = R.findIndex(x => x.scenario === scen && x.table === t && x.threads === 1);
      if (k >= 0) R[k] = entry; else R.push(entry);
      fs.writeFileSync('results.json', JSON.stringify(R, null, 1));
      await new Promise(rslv => setTimeout(rslv, 1500));
    }
  }
}
// cells that failed both node and curl attempts -> saturation
for (let k = 0; k < R.length; k++) {
  const x = R[k];
  if (/_(10k|50k|100k)$/.test(x.scenario) && x.fail && !x.saturation && !x.ok) {
    R[k] = { scenario: x.scenario, table: x.table, threads: x.threads, saturation: true };
    console.log('SATURATION:', x.scenario, x.table);
  }
}
fs.writeFileSync('results.json', JSON.stringify(R, null, 1));
console.log('slice-curl done');
