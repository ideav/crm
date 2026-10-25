// results.json -> markdown tables for issue #5267
// ВНИМАНИЕ: сданный results.md содержит ручные правки после генерации (шапка «Замер»,
// раздел «Дочер 25.10») — полный перезапуск report.mjs их затрёт.
import fs from 'fs';
const R = JSON.parse(fs.readFileSync('results.json', 'utf8'));
const get = (s, t, th) => R.find(r => r.scenario === s && r.table === t && r.threads === th);
const cell = (r) => !r ? '—' : r.saturation ? 'нас.' : (r.error ? '—' : `${r.rps}/${r.p95}${r.fail ? ' ⚠️' : ''}`);
const trio = (s, t) => [5, 25, 50].map(th => cell(get(s, t, th))).join(' · ');
const sec = (r) => !r ? '—' : (r.error || r.fail || r.saturation) ? '>30 с' : `${(r.p50 / 1000).toFixed(1)} с`;
const TABLES = ['T_1K_W12', 'T_1K_W45', 'T_10K_W12', 'T_10K_W45', 'T_100K_W12', 'T_100K_W45', 'T_1M_W12', 'T_1M_W45'];

const lines = [];
lines.push('# Нагрузочный стенд hlt — результаты (issue #5267)');
lines.push('');
lines.push(`Замер: 24–25.10.2026, база https://ideav.ru/hlt/. Железо: 2 vCPU AMD EPYC-Milan, 1.9 ГБ RAM, MySQL 8.0.46, PHP 8.3.6. Сервер боевой: кроме стенда на нём ideav.ru (~7.7 тыс. запросов/ч в пик) и ещё 12 клиентских баз — т.е. цифры сняты при реальной фоновой нагрузке (CPU занят на 50–80 % ещё до теста).`);
lines.push('Формат: `rps`/`p95,мс` при 5 · 25 · 50 потоках. ⚠️ — ≥20 % запросов ячейки с ошибками. «нас.» — точка насыщения (два подряд отказа соединений, выше не поднимали). Потолок ожидания — 30 с.');
lines.push('');

// Один сценарий — одна колонка: у строки данных столько же ячеек, сколько в шапке,
// иначе GFM-рендер молча отбрасывает лишние (issue #5279 — раньше три сценария группы
// склеивались в одну ячейку, escape '\|' в шаблонной строке съедался JS, и колонки
// разъезжались).
const FAMS = [
  ['Выборки (п.3): 10 полей из 1/3/5 таблиц', { sel1: '1 таблица', sel3: '3 таблицы (JOIN)', sel5: '5 таблиц (JOIN)' }],
  ['Агрегация (п.4): COUNT+SUM+AVG по ~100× объёму выборки', { agg1: '1 таблица', agg3: '3 таблицы (JOIN)', agg5: '5 таблиц (JOIN)' }],
];
for (const [fam, scen] of FAMS) {
  lines.push(`## ${fam}`);
  lines.push('');
  for (const [s, label] of Object.entries(scen)) {
    lines.push(`### ${s} — ${label}`);
    lines.push('');
    lines.push('| таблица | 10 строк: 5·25·50 | 100: 5·25·50 | 500: 5·25·50 | 5000: 5·25 |');
    lines.push('|---|---|---|---|---|');
    for (const t of TABLES) {
      lines.push(`| ${t} | ${trio(`${s}_10`, t)} | ${trio(`${s}_100`, t)} | ${trio(`${s}_500`, t)} | ${cell(get(`${s}_5000`, t, 5))} · ${cell(get(`${s}_5000`, t, 25))} |`);
    }
    lines.push('');
  }
}

lines.push('## Срезы миллионных таблиц (×1 поток): агрегат за «день/неделю/месяц»');
lines.push('');
lines.push('«>30 с» — обе попытки вышли за потолок 30 с: фактическое время не измерено, известна нижняя граница.');
lines.push('');
lines.push('| таблица | вход | agg1 (1 табл) | agg3 (3 табл) | agg5 (5 табл) |');
lines.push('|---|---|---|---|---|');
for (const t of ['T_1M_W12', 'T_1M_W45']) {
  for (const sp of ['10k', '50k', '100k']) {
    lines.push(`| ${t} | ${sp} строк | ${['agg1', 'agg3', 'agg5'].map(q => sec(get(`${q}_${sp}`, t, 1))).join(' | ')} |`);
  }
}
lines.push('');
lines.push('## Запись (п.1, 2, 5, 6) и точечное чтение (п.8)');
lines.push('');
lines.push('| таблица | сценарий | ×5 | ×25 | ×50 |');
lines.push('|---|---|---|---|---|');
for (const t of ['T_1K_W12', 'T_100K_W12', 'T_100K_W45', 'T_1M_W12', 'T_1M_W45']) {
  for (const s of ['add1', 'upd5', 'upd10', 'upd100', 'upd500', 'batch100', 'one']) {
    const a = get(s, t, 5), b = get(s, t, 25), c = get(s, t, 50);
    if (!a && !b && !c) continue;
    lines.push(`| ${t} | ${s} | ${cell(a)} | ${cell(b)} | ${cell(c)} |`);
  }
}
lines.push('');
lines.push('## Пагинация (п.7): страница по 20 строк');
lines.push('');
lines.push('| таблица | страница | ×5 | ×25 | ×50 |');
lines.push('|---|---|---|---|---|');
for (const t of ['T_100K_W12', 'T_1M_W12']) {
  for (const s of ['page1', 'pagemid', 'pagelast']) {
    lines.push(`| ${t} | ${s.replace('page', '')} | ${cell(get(s, t, 5))} | ${cell(get(s, t, 25))} | ${cell(get(s, t, 50))} |`);
  }
}
lines.push('');
lines.push('## Ступени 5/10/25 потоков (кривая масштабирования, T_100K_W12 и T_1M_W45)');
lines.push('');
lines.push('| сценарий | таблица | ×5 | ×10 | ×25 |');
lines.push('|---|---|---|---|---|');
for (const s of ['sel1_100', 'sel3_100', 'sel5_100', 'sel5_500', 'agg1_100', 'agg5_500']) {
  for (const t of ['T_100K_W12', 'T_1M_W45']) {
    lines.push(`| ${s} | ${t} | ${cell(get(s, t, 5))} | ${cell(get(s, t, 10))} | ${cell(get(s, t, 25))} |`);
  }
}
lines.push('');
// extrapolation for saturated cells
const satEst = {};
for (const r of R.filter(x => x.saturation)) {
  const lower = [5, 10, 25].map(th => get(r.scenario, r.table, th)).filter(x => x && !x.error && !x.saturation && x.n);
  if (!lower.length) continue;
  const lo = lower[lower.length - 1];
  let k = 1, base = 'линейная оценка';
  if (lower.length >= 2) {
    const a = lower[0], b = lower[lower.length - 1];
    k = Math.log(b.p50 / a.p50) / Math.log(b.threads / a.threads);
    if (isFinite(k) && k > 0) base = `k=${k.toFixed(2)}`;
  }
  const est = Math.round(lo.p50 * Math.pow(r.threads / lo.threads, k) / 100) / 10;
  satEst[`${r.scenario}|${r.table}|${r.threads}`] = `~${est} с (${base}, от ×${lo.threads}=${lo.p50} мс)`;
}
const sat = R.filter(r => r.saturation);
if (sat.length) {
  lines.push(`## За точкой насыщения: ${sat.length} ячеек + экстраполяция`);
  lines.push('');
  lines.push('Две подряд попытки заканчивались отказом соединений (очередь воркеров переполнена) — за saturation point латентность неизмеряема, нагрузку не поднимали. Оценка — степенная экстраполяция почти линейного участка:');
  lines.push('');
  for (const r of sat) lines.push(`- ${r.scenario} ${r.table} ×${r.threads}: ${satEst[`${r.scenario}|${r.table}|${r.threads}`] || 'нижних ступеней нет'}`);
  lines.push('');
}
const fails = R.filter(r => !r.saturation && ((r.fail && r.n && r.fail / r.n >= 0.2) || r.error));
if (fails.length) {
  lines.push(`## Ячейки с ошибками, но ниже порога насыщения (${fails.length})`);
  lines.push('');
  for (const r of fails) lines.push(`- ${r.scenario} ${r.table} ×${r.threads}: ${r.fail ?? 'ERR'}/${r.n ?? '?'} — ${JSON.stringify(r.errs || r.error).slice(0, 140)}`);
  lines.push('');
}
fs.writeFileSync('results.md', lines.join('\n'));
console.log('results.md:', lines.length, 'lines | cells:', R.length, '| good:', R.filter(x => !x.error && !x.saturation && x.n && x.fail / x.n < 0.2).length, '| sat:', sat.length);
