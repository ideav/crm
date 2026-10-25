// Перезамер срезов 1М (issue #5279, тихое окно 25.10 вечер):
// потолок 120 с вместо 30 (закрыть цензурированные «>30 с»), до 3 прогонов с медианой,
// новые точки 1k/5k для agg1 (третья точка линии «60 мкс/строку»).
// curl вместо node fetch — как в slice-curl.mjs (фetch деградирует на длинных сериях).
// Результат: remeasure-2510.json (сырые прогоны, batch: 'rm2510'); results.json не трогаем.
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
const run = promisify(execFile);
const S = JSON.parse(fs.readFileSync('state.json', 'utf8'));
const SPANS = { '1k': 1000, '5k': 5000, '10k': 10000, '50k': 50000, '100k': 100000 };
const out = [];

for (const t of ['T_1M_W12', 'T_1M_W45']) {
  for (const q of ['agg1', 'agg3', 'agg5']) {
    for (const [sp, spanN] of Object.entries(SPANS)) {
      if ((sp === '1k' || sp === '5k') && q !== 'agg1') continue; // новые точки — только agg1
      const scen = `${q}_${sp}`;
      const span = Math.min(spanN, S.tables[t].rows - 1);
      const url = `https://ideav.ru/hlt/report/${S.queries[t][q]}?JSON_KV&FR_code=>=0&TO_code=<${span}&TIME=120`;
      const msList = [];
      let fails = 0, lastErr = null;
      for (let r = 0; r < 3; r++) {
        const t0 = Date.now();
        try {
          const { stdout } = await run('curl', ['-s', '-m', '125', '-w', '\n%{http_code} %{time_total}', '-H', 'X-Authorization: YOUR_TOKEN', url], { timeout: 135000, maxBuffer: 20 * 1024 * 1024 });
          const nl = stdout.lastIndexOf('\n');
          JSON.parse(stdout.slice(0, nl)); // бросит на HTML/ошибке
          const ms = Math.round(parseFloat(stdout.slice(nl + 1).trim().split(' ')[1]) * 1000);
          msList.push(ms);
          console.log(`OK ${scen} ${t} r${r + 1}: ${ms}ms`);
        } catch (e) {
          fails++;
          lastErr = String(e.message).slice(0, 80);
          console.log(`FAIL ${scen} ${t} r${r + 1}: ${Date.now() - t0}ms ${lastErr}`);
          break; // таймаут/ошибка первой попытки — ячейку не долбим
        }
        if (msList[msList.length - 1] > 90000) break; // длинные третьим прогоном не долбим
        await new Promise(rslv => setTimeout(rslv, 1500));
      }
      const sorted = msList.slice().sort((a, b) => a - b);
      out.push({
        scenario: scen, table: t, threads: 1, batch: 'rm2510',
        rounds: msList.length,
        ...(msList.length ? { ms: sorted, median: sorted[Math.floor((sorted.length - 1) / 2)] } : {}),
        ...(fails ? { fails, err: lastErr } : {}),
      });
      fs.writeFileSync('remeasure-2510.json', JSON.stringify(out, null, 1));
    }
  }
}
console.log('done:', out.length, 'cells ->', 'remeasure-2510.json');
