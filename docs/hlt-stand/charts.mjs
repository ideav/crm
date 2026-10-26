// Графики нагрузочного стенда hlt (issue #5286): одна разметка на две страницы.
//   load-charts.html — пишется целиком;
//   sizing.html      — заменяется блок между <!--CHARTS-START--> и <!--CHARTS-END-->.
// Источник: ramp-2610.json (лесенки потоков A/D, агрегат от объёма B, срезы E — одна партия 26.10).
// Запуск из docs/hlt-stand: node charts.mjs
import fs from 'fs';

const RAMP = JSON.parse(fs.readFileSync('ramp-2610.json', 'utf8'));
// медиана по сырым прогонам (при чётном числе — среднее двух средних; в файле при 2 прогонах лежит меньший)
for (const r of RAMP) if (r.ms && r.ms.length) {
  const m = r.ms.slice().sort((x, y) => x - y), h = m.length >> 1;
  r.median = m.length % 2 ? m[h] : Math.round((m[h - 1] + m[h]) / 2);
}
const ROWS = { T_1K_W12: 1000, T_10K_W12: 10000, T_100K_W12: 100000, T_1M_W12: 1000000,
  T_1K_W45: 1000, T_10K_W45: 10000, T_100K_W45: 100000, T_1M_W45: 500000 };
const C = ['#3987e5', '#d95926', '#199e70', '#c98500'];
const INK = '#f1f5f9', MUTED = '#94a3b8', FAINT = '#64748b', GRID = '#1e293b', AXIS = '#475569', BG = '#0f172a';
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function fmtNum(v) {
  if (v >= 1e6) return (v / 1e6) + ' млн';
  if (v >= 1000) return (v / 1000) + ' тыс.';
  return String(v);
}
function fmtSec(v) {
  if (v >= 10) return Math.round(v) + ' с';
  if (v >= 1) return v.toFixed(1).replace('.0', '') + ' с';
  return Math.round(v * 1000) + ' мс';
}

// Линейный график с числовыми осями (линейные или логарифмические), легендой и подсказками <title>.
const CAP = 60, AFTER_TIMEOUT = 2; // порог обслуживания, с; критерий остановки лесенки — как в ramp-2610.mjs
function chart({ title, note, xTitle, yTitle, xLog, yLog, xTicks, yTicks, series, vline, hlines = [], cap, marks = [] }) {
  const W = 720, H = 340, m = { l: 70, r: 24, t: 18, b: 56 };
  const all = series.flatMap(s => s.pts);
  const xv = xTicks.map(t => t[0]), yv = yTicks.map(t => t[0]);
  const x0 = Math.min(...xv), x1 = Math.max(...xv), y0 = Math.min(...yv), y1 = Math.max(...yv);
  const f = (lg, v) => lg ? Math.log10(v) : v;
  const X = v => m.l + (f(xLog, v) - f(xLog, x0)) / (f(xLog, x1) - f(xLog, x0)) * (W - m.l - m.r);
  const Y = v => H - m.b - (f(yLog, v) - f(yLog, y0)) / (f(yLog, y1) - f(yLog, y0)) * (H - m.t - m.b);
  if (all.some(([x, y]) => x < x0 || x > x1 || y < y0 || y > y1)) throw new Error('точка вне осей: ' + title);
  let g = '';
  for (const [v, lab] of yTicks) {
    g += `<line x1="${m.l}" y1="${Y(v).toFixed(1)}" x2="${W - m.r}" y2="${Y(v).toFixed(1)}" stroke="${GRID}"/>` +
      `<text x="${m.l - 8}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end" font-size="12" fill="${FAINT}">${esc(lab)}</text>`;
  }
  for (const [v, lab] of xTicks) {
    g += `<line x1="${X(v).toFixed(1)}" y1="${H - m.b}" x2="${X(v).toFixed(1)}" y2="${H - m.b + 5}" stroke="${AXIS}"/>` +
      `<text x="${X(v).toFixed(1)}" y="${H - m.b + 20}" text-anchor="middle" font-size="12" fill="${FAINT}">${esc(lab)}</text>`;
  }
  g += `<line x1="${m.l}" y1="${H - m.b}" x2="${W - m.r}" y2="${H - m.b}" stroke="${AXIS}"/>`;
  g += `<text x="${(m.l + W - m.r) / 2}" y="${H - 10}" text-anchor="middle" font-size="12.5" fill="${MUTED}">${esc(xTitle)}</text>`;
  g += `<text transform="translate(16 ${(m.t + H - m.b) / 2}) rotate(-90)" text-anchor="middle" font-size="12.5" fill="${MUTED}">${esc(yTitle)}</text>`;
  for (const h of hlines) {
    g += `<line x1="${m.l}" y1="${Y(h.y).toFixed(1)}" x2="${W - m.r}" y2="${Y(h.y).toFixed(1)}" stroke="${h.color}" stroke-width="1.2" stroke-dasharray="5 4" opacity=".75"/>` +
      `<text x="${W - m.r - 4}" y="${(Y(h.y) - 6).toFixed(1)}" text-anchor="end" font-size="11.5" fill="${h.color}">${esc(h.label)}</text>`;
  }
  if (cap) {
    g += `<rect x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${(Y(cap) - m.t).toFixed(1)}" fill="#d95926" opacity=".07"/>` +
      `<line x1="${m.l}" y1="${Y(cap).toFixed(1)}" x2="${W - m.r}" y2="${Y(cap).toFixed(1)}" stroke="#e5794e" stroke-width="1.3"/>` +
      `<text x="${m.l + 6}" y="${(Y(cap) - 6).toFixed(1)}" font-size="11.5" fill="#e5794e">порог ${cap} с — выше не обслуживается</text>`;
  }
  for (const mk of marks) {
    g += `<text x="${X(mk.x).toFixed(1)}" y="${H - m.b - 8}" text-anchor="middle" font-size="15" fill="${FAINT}">×<title>${esc(mk.label)}</title></text>`;
  }
  if (vline) {
    g += `<line x1="${X(vline.x).toFixed(1)}" y1="${m.t}" x2="${X(vline.x).toFixed(1)}" y2="${H - m.b}" stroke="${FAINT}" stroke-dasharray="3 4"/>` +
      `<text x="${(X(vline.x) + 6).toFixed(1)}" y="${m.t + 12}" font-size="11.5" fill="${MUTED}">${esc(vline.label)}</text>`;
  }
  series.forEach(s => {
    const d = s.pts.map(([x, y], i) => (i ? 'L' : 'M') + X(x).toFixed(1) + ',' + Y(y).toFixed(1)).join('');
    g += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"${s.dash ? ' stroke-dasharray="7 5"' : ''}/>`;
    s.pts.forEach(([x, y, lo, hi]) => {
      if (lo != null && hi > lo) g += `<line x1="${X(x).toFixed(1)}" y1="${Y(lo).toFixed(1)}" x2="${X(x).toFixed(1)}" y2="${Y(hi).toFixed(1)}" stroke="${s.color}" stroke-width="2.5" opacity=".7"/>`;
      const over = cap && y > cap, hollow = over || (s.dash && !cap);
      g += `<circle cx="${X(x).toFixed(1)}" cy="${Y(y).toFixed(1)}" r="${over ? 5.5 : 4.5}" fill="${hollow ? BG : s.color}" stroke="${hollow ? s.color : BG}" stroke-width="2">` +
        `<title>${esc(s.name)} · ${esc(s.tipX(x))}: ${esc(s.tipY(y))}${lo != null && hi > lo ? ' (прогоны ' + esc(s.tipY(lo)) + ' – ' + esc(s.tipY(hi)) + ')' : ''}${over ? ' — за порогом, не обслуживается' : ''}</title></circle>`;
    });
  });
  const legend = series.map(s =>
    `<span><svg width="26" height="10" aria-hidden="true"><line x1="1" y1="5" x2="25" y2="5" stroke="${s.color}" stroke-width="2.5"${s.dash ? ' stroke-dasharray="6 4"' : ''}/></svg>${esc(s.name)}</span>`).join('') +
    hlines.filter(h => h.legend).map(h =>
      `<span><svg width="26" height="10" aria-hidden="true"><line x1="1" y1="5" x2="25" y2="5" stroke="${h.color}" stroke-width="1.5" stroke-dasharray="5 4"/></svg>${esc(h.legend)}</span>`).join('');
  return `<figure class="fig"><div class="fighead"><h3>${esc(title)}</h3>${note ? `<p class="note">${esc(note)}</p>` : ''}</div>` +
    `<div class="legend">${legend}</div>` +
    `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">${g}</svg></figure>`;
}
function table(head, rows) {
  return `<details><summary>Таблица значений</summary><table><thead><tr>${head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>` +
    rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('') + `</tbody></table></details>`;
}

// ——— данные ———
const ramp = sc => RAMP.filter(r => r.part === 'A' && r.scenario === sc).sort((a, b) => a.threads - b.threads);
const R1 = ramp('sel1_100'), R5 = ramp('sel5_500');
const RAMP_SERIES = [
  { key: 'sel1_100', name: 'выборка 100 строк, 1 таблица', rows: R1, color: C[0] },
  { key: 'sel5_500', name: 'выборка 500 строк, JOIN 5 таблиц', rows: R5, color: C[1] },
];
const THREADS = [...new Set(RAMP.filter(r => r.part === 'A').map(r => r.threads))].sort((a, b) => a - b);
const peak = rows => Math.max(...rows.map(r => r.rps));
// колено: первая ступень, где rps достиг 90 % полки
const knee = rows => rows.find(r => r.rps >= 0.9 * peak(rows)).threads;

const vol = (q, w) => RAMP.filter(r => r.part === 'B' && r.scenario === q + '_all' && r.table.endsWith(w) && r.median)
  .map(r => [ROWS[r.table], r.median / 1000]).sort((a, b) => a[0] - b[0]);
const whole = (q, t) => { const r = RAMP.find(x => x.part === 'B' && x.scenario === q + '_all' && x.table === t); return r && r.median ? r.median / 1000 : null; };
const slices = (q, t) => {
  const pts = {};
  // одна партия: перезамер всех срезов 26.10 (часть E)
  for (const r of RAMP) if (r.part === 'E' && r.table === t && r.scenario.startsWith(q + '_') && r.median)
    pts[r.scenario.split('_')[1]] = [r.median / 1000, Math.min(...r.ms) / 1000, Math.max(...r.ms) / 1000];
  return Object.entries(pts).map(([k, v]) => [parseFloat(k) * 1000, ...v]).sort((a, b) => a[0] - b[0]);
};

const tTicks = THREADS.filter(t => [1, 2, 4, 6, 10, 15, 25, 50].includes(t)).map(t => [t, String(t)]);
const rpsMax = Math.ceil(Math.max(...RAMP_SERIES.map(s => peak(s.rows))) / 2) * 2 + 2;
const p95Max = Math.max(...RAMP_SERIES.flatMap(s => s.rows.map(r => r.p95))) / 1000;
const p95Top = Math.ceil(p95Max / 2) * 2;
const k1 = knee(R1);

const F1 = chart({
  title: 'Пропускная способность от числа потоков',
  note: `запросов в секунду, все потоки вместе; ${THREADS.length} ступеней по 20 с`,
  xTitle: 'Параллельных потоков (клиентов)', yTitle: 'Запросов в секунду', xLog: true,
  xTicks: tTicks, yTicks: Array.from({ length: rpsMax / 2 + 1 }, (_, i) => [i * 2, String(i * 2)]),
  vline: { x: k1, label: `насыщение ≈ ${k1} потоков` },
  series: RAMP_SERIES.map(s => ({ name: s.name, color: s.color, pts: s.rows.map(r => [r.threads, r.rps]),
    tipX: x => x + ' потоков', tipY: y => y.toFixed(1) + ' запросов/с' })),
});
const F2 = chart({
  title: 'Время ответа от числа потоков',
  note: 'сплошная — p95 (95 % запросов быстрее), пунктир — медиана',
  xTitle: 'Параллельных потоков (клиентов)', yTitle: 'Время ответа, с', xLog: true,
  xTicks: tTicks, yTicks: Array.from({ length: p95Top / 2 + 1 }, (_, i) => [i * 2, (i * 2) + ' с']),
  vline: { x: k1, label: `насыщение ≈ ${k1} потоков` },
  series: RAMP_SERIES.flatMap(s => [
    { name: s.name + ' — p95', color: s.color, pts: s.rows.map(r => [r.threads, r.p95 / 1000]), tipX: x => x + ' потоков', tipY: fmtSec },
    { name: s.name + ' — медиана', color: s.color, dash: true, pts: s.rows.map(r => [r.threads, r.p50 / 1000]), tipX: x => x + ' потоков', tipY: fmtSec },
  ]),
});
const T1 = table(['потоков', ...RAMP_SERIES.flatMap(s => [s.key + ' rps', s.key + ' медиана', s.key + ' p95', s.key + ' ошибок'])],
  THREADS.map(t => [t, ...RAMP_SERIES.flatMap(s => {
    const r = s.rows.find(x => x.threads === t);
    return r ? [r.rps.toFixed(1), fmtSec(r.p50 / 1000), fmtSec(r.p95 / 1000), r.fail + ' из ' + r.n] : ['—', '—', '—', '—'];
  })]));

const AGG = [['agg1', 'агрегат, 1 таблица', C[0]], ['agg3', 'агрегат, JOIN 3 таблиц', C[1]], ['agg5', 'агрегат, JOIN 5 таблиц', C[2]]];
const volSeries = AGG.flatMap(([q, name, color]) => [
  { name: name + ' — 12 реквизитов', color, pts: vol(q, 'W12'), tipX: x => fmtNum(x) + ' строк', tipY: fmtSec },
  { name: name + ' — 45 реквизитов', color, dash: true, pts: vol(q, 'W45'), tipX: x => fmtNum(x) + ' строк', tipY: fmtSec },
]).filter(s => s.pts.length);
const volMin = Math.min(...volSeries.flatMap(s => s.pts.map(p => p[1])));
const volMax = Math.max(...volSeries.flatMap(s => s.pts.map(p => p[1])));
const decades = [0.01, 0.1, 1, 10, 100, 1000].filter(v => v / 10 < volMax && v * 10 > volMin);
const F3 = chart({
  title: 'Отчёт-агрегат: время от объёма таблицы',
  note: '1 поток, медиана 2–3 прогонов; обе оси логарифмические — прямая означает, что время растёт пропорционально числу строк',
  xTitle: 'Строк в таблице', yTitle: 'Время отчёта', xLog: true, yLog: true,
  xTicks: [[1000, '1 тыс.'], [10000, '10 тыс.'], [100000, '100 тыс.'], [1000000, '1 млн']],
  yTicks: decades.map(v => [v, fmtSec(v)]), series: volSeries, cap: CAP,
});
const T3 = table(['строк', ...AGG.flatMap(([q]) => [q + ' (12)', q + ' (45)'])],
  [1000, 10000, 100000, 500000, 1000000].map(n => [fmtNum(n), ...AGG.flatMap(([q]) => ['W12', 'W45'].map(w => {
    const p = vol(q, w).find(x => x[0] === n); return p ? fmtSec(p[1]) : '—';
  }))]));

function sliceFig(t, label) {
  const series = AGG.map(([q, name, color]) => ({ name, color, pts: slices(q, t), tipX: x => 'срез ' + fmtNum(x), tipY: fmtSec }));
  const top = Math.ceil(Math.max(...series.flatMap(s => s.pts.map(p => p[3] || p[1])), ...AGG.map(([q]) => whole(q, t) || 0)) / 20) * 20;
  const hl = AGG.map(([q, , color], i) => ({ y: whole(q, t), color, label: i === 0 ? 'вся таблица' : '',
    legend: i === 0 ? 'пунктир — тот же отчёт по всей таблице' : null })).filter(h => h.y);
  return chart({
    title: `Срез почти не экономит: ${label}`,
    note: 'отчёт с фильтром по диапазону кода, 1 поток; точка — медиана 2 прогонов, вертикальная черта — разброс прогонов (за порогом — 1 прогон); замер 26.10.2026',
    xTitle: 'Строк в срезе (диапазон кода)', yTitle: 'Время отчёта, с', xLog: true,
    xTicks: [[1000, '1 тыс.'], [5000, '5 тыс.'], [10000, '10 тыс.'], [50000, '50 тыс.'], [100000, '100 тыс.']],
    yTicks: Array.from({ length: top / 20 + 1 }, (_, i) => [i * 20, (i * 20) + ' с']), series, hlines: hl, cap: CAP,
  });
}
const F4 = sliceFig('T_1M_W12', 'таблица 1 млн строк, 12 реквизитов');
const F5 = sliceFig('T_1M_W45', 'таблица 500 тыс. строк, 45 реквизитов');
const T4 = table(['срез', ...['T_1M_W12', 'T_1M_W45'].flatMap(t => AGG.map(([q]) => q + ' ' + t.slice(-3)))],
  [1000, 5000, 10000, 50000, 100000, 'вся'].map(s => [s === 'вся' ? 'вся таблица' : fmtNum(s),
    ...['T_1M_W12', 'T_1M_W45'].flatMap(t => AGG.map(([q]) => {
      const v = s === 'вся' ? whole(q, t) : (slices(q, t).find(p => p[0] === s) || [])[1];
      return v ? fmtSec(v) : '—';
    }))]));

const r50 = rows => rows.find(r => r.threads === 50);
const p95at = (rows, t) => rows.find(r => r.threads === t).p95 / 1000;
// «спокойная» зона: медиана не выросла больше чем на 30 % от одиночного клиента
const calm = R1.filter(r => r.p50 <= R1[0].p50 * 1.3).pop();
const SUM1 = `<ul class="out">
<li>пока сервер не загружен (до <b>${calm.threads} потоков</b>), пропускная способность растёт почти пропорционально числу клиентов — ${R1[0].rps.toFixed(1)} → ${calm.rps.toFixed(1)} запросов/с, а время ответа почти не меняется: ${fmtSec(R1[0].p50 / 1000)} → ${fmtSec(calm.p50 / 1000)};</li>
<li>к ${k1} потокам — полка <b>≈${peak(R1).toFixed(0)} запросов/с</b> (2 vCPU заняты): новые потоки встают в очередь, и время ответа растёт пропорционально их числу;</li>
<li>на 50 потоках выборка по-прежнему обслуживается: ${r50(R1).rps.toFixed(1)} запросов/с, p95 ${fmtSec(p95at(R1, 50))}, ошибок ${r50(R1).fail} из ${r50(R1).n};</li>
<li>выборка с JOIN 5 таблиц и 500 строками тяжелее: полка <b>≈${peak(R5).toFixed(0)} запросов/с</b>, на 50 потоках p95 ${fmtSec(p95at(R5, 50))}.</li>
</ul>`;
// выводы по агрегатам — из данных, не руками
const v1 = vol('agg1', 'W12');
const growth = v1[v1.length - 1][1] / v1[0][1];
const usRow = AGG.flatMap(([q]) => ['W12', 'W45'].map(w => vol(q, w).find(p => p[0] === 100000)))
  .filter(Boolean).map(p => p[1] / 1e5 * 1e6);
const share = ['T_1M_W12', 'T_1M_W45'].flatMap(t => AGG.map(([q]) => {
  const s1 = (slices(q, t).find(p => p[0] === 1000) || [])[1], w = whole(q, t);
  return s1 && w ? s1 / w : null;
})).filter(Boolean);
const lastOk = AGG.flatMap(([q]) => ['W12', 'W45'].flatMap(w => vol(q, w))).filter(p => p[1] <= CAP).reduce((a, p) => Math.max(a, p[0]), 0);
const pctR = a => Math.round(Math.min(...a) * 100) + '–' + Math.round(Math.max(...a) * 100) + ' %';
const SUM2 = `<ul class="out">
<li>время отчёта растёт пропорционально объёму таблицы: от 1 тыс. до 1 млн строк — в <b>${Math.round(growth)}</b> раза;
на 100 тыс. строк это <b>${Math.round(Math.min(...usRow))}–${Math.round(Math.max(...usRow))} мкс на строку</b> (2 vCPU);</li>
<li>в порог ${CAP} с укладываются отчёты по таблицам до <b>${fmtNum(lastOk)} строк</b>; по миллиону строк отчёт идёт дольше минуты — для интерактива он не годится;</li>
<li>фильтр по диапазону почти не помогает: срез 1 тыс. строк из миллиона стоит <b>${pctR(share)}</b> полного прохода, а не 0.1 % — EAV-джойн читает всю таблицу, фильтр применяется после чтения.</li>
</ul>`;

// D: лесенка потоков для тяжёлых отчётов, с критерием остановки
const DR = t => RAMP.filter(r => r.part === 'D' && r.table === t).sort((a, b) => a.threads - b.threads);
const D_SERIES = [['T_10K_W12', 'отчёт по таблице 10 тыс. строк', C[2]], ['T_100K_W12', 'отчёт по таблице 100 тыс. строк', C[3]]]
  .map(([t, name, color]) => ({ t, name, color, rows: DR(t) })).filter(s => s.rows.length);
let F6 = '', F7 = '', T6 = '', SUM3 = '';
if (D_SERIES.length) {
  const meas = s => s.rows.filter(r => !r.skipped);
  const tout = r => Object.entries(r.errs || {}).filter(([e]) => e.startsWith('timeout')).reduce((a, [, n]) => a + n, 0);
  const skips = D_SERIES.flatMap(s => s.rows.filter(r => r.skipped).map(r => ({ x: r.threads, label: s.name + ': ' + r.reason })));
  const dRpsTop = Math.ceil(Math.max(...D_SERIES.flatMap(s => meas(s).map(r => r.rps))) + 0.5);
  F6 = chart({
    title: 'Тяжёлые отчёты: пропускная способность от числа потоков',
    note: 'успешных отчётов в секунду' + (skips.length ? `; × на оси — ступень не измерялась (критерий остановки: не больше ${AFTER_TIMEOUT} ступеней после первых таймаутов)` : ''),
    xTitle: 'Параллельных потоков (клиентов)', yTitle: 'Успешных отчётов в секунду', xLog: true, xTicks: tTicks,
    yTicks: Array.from({ length: dRpsTop + 1 }, (_, i) => [i, String(i)]), marks: skips,
    series: D_SERIES.map(s => ({ name: s.name, color: s.color, pts: meas(s).map(r => [r.threads, r.rps]),
      tipX: x => x + ' потоков', tipY: y => y.toFixed(2) + ' отчётов/с' })),
  });
  F7 = chart({
    title: 'Тяжёлые отчёты: доля таймаутов от числа потоков',
    note: `запрос дольше ${CAP} с — таймаут; зависший запрос в MySQL добивается сразу`,
    xTitle: 'Параллельных потоков (клиентов)', yTitle: 'Таймаутов, % запросов', xLog: true, xTicks: tTicks,
    yTicks: [0, 25, 50, 75, 100].map(v => [v, v + ' %']), marks: skips,
    series: D_SERIES.map(s => ({ name: s.name, color: s.color, pts: meas(s).map(r => [r.threads, r.n ? tout(r) / r.n * 100 : 0]),
      tipX: x => x + ' потоков', tipY: y => Math.round(y) + ' %' })),
  });
  T6 = table(['потоков', ...D_SERIES.flatMap(s => [s.t + ' отчётов/с', 'медиана', 'p95', 'таймаутов'])],
    THREADS.map(t => [t, ...D_SERIES.flatMap(s => {
      const r = s.rows.find(x => x.threads === t);
      if (!r) return ['—', '—', '—', '—'];
      if (r.skipped) return ['не измерялось', '', '', ''];
      return [r.rps.toFixed(2), r.p50 ? fmtSec(r.p50 / 1000) : '—', r.p95 ? fmtSec(r.p95 / 1000) : '—', tout(r) + ' из ' + r.n];
    })]));
  SUM3 = '<ul class="out">' + D_SERIES.map(s => {
    const m = meas(s), first = m.find(r => tout(r) > 0), best = m.reduce((a, r) => r.rps > a.rps ? r : a, m[0]);
    return `<li>${s.name}: полка <b>${best.rps.toFixed(2)} отчётов/с</b> на ${best.threads} потоках; ` +
      (first ? `первые таймауты — на <b>${first.threads} потоках</b> (${tout(first)} из ${first.n}): одиночный отчёт идёт ${fmtSec(m[0].p50 / 1000)}, ` +
        `${first.threads} одновременных делят 2 ядра — каждому ≈${fmtSec(m[0].p50 / 1000 * first.threads / 2)}, больше порога ${CAP} с` : 'таймаутов до 50 потоков нет') + ';</li>';
  }).join('') + `<li>зависшие после таймаута запросы в MySQL добиваются (KILL QUERY) — иначе они догорают и грузят следующие ступени.</li></ul>`;
}

export const BLOCKS = { F1, F2, T1, SUM1, F3, T3, F4, F5, T4, SUM2, F6, F7, T6, SUM3 };
const CSS = `.fig { border: 1px solid rgba(255,255,255,.10); border-radius: 12px; padding: 18px 18px 10px; margin: 20px 0; }
  .fighead h3 { font-size: 16px; margin: 0; }
  .fighead .note { color:#64748b; font-size: 13px; margin: 2px 0 6px; }
  svg.chart { width: 100%; height: auto; display: block; }
  .legend { display:flex; flex-wrap:wrap; gap: 4px 18px; margin: 4px 0 6px; font-size:13px; color:#94a3b8; }
  .legend span { display:inline-flex; align-items:center; gap:6px; }
  details { margin: 6px 0 0; color:#94a3b8; font-size: 14px; }
  details table { border-collapse: collapse; margin-top: 8px; width: 100%; font-size: 13px; display:block; overflow-x:auto; }
  details th, details td { border: 1px solid rgba(255,255,255,.12); padding: 4px 8px; text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  details th:first-child, details td:first-child { text-align: left; }`;
const section = (n1, n2, prefix) => `<h2>${n1}. ${prefix ? prefix + 'нагрузка' : 'Нагрузка'} по потокам</h2>
<p class="lead">Классическая «лесенка»: число параллельных клиентов растёт ступенями от 1 до 50, на каждой ступени
20 секунд каждый клиент шлёт запрос за запросом. Таблица 100 тыс. строк, 12 реквизитов; замер 26.10.2026 на тихом сервере.</p>
${F1}
${F2}
${T1}
${SUM1}
${F6 ? `<p class="lead">Та же лесенка для отчётов-агрегатов по всей таблице: один запрос — от секунды до десятков секунд.</p>
${F6}
${F7}
${T6}
${SUM3}` : ''}

<h2>${n2}. ${prefix ? prefix + 'отчёты' : 'Отчёты'}-агрегаты — объём таблицы и срезы</h2>
${F3}
${T3}
${F4}
${F5}
${T4}
${SUM2}`;

// sizing.html: блок между маркерами
const SZ = 'sizing.html';
let sz = fs.readFileSync(SZ, 'utf8');
const a = sz.indexOf('<!--CHARTS-START-->'), b = sz.indexOf('<!--CHARTS-END-->');
if (a < 0 || b < 0) throw new Error('в sizing.html нет маркеров CHARTS');
sz = sz.slice(0, a) + '<!--CHARTS-START-->\n' + section(3, 4, 'Замеры: ') + '\n' + sz.slice(b);

// модель калькулятора — из тех же замеров (блок DATA между маркерами)
const dm = sz.match(/\/\*DATA-START\*\/([\s\S]*?)\/\*DATA-END\*\//);
const DATA = JSON.parse(dm[1]);
// выборка: множители потоков к ×5 по лесенке sel1_100 (×5 — между ступенями 4 и 6, геометрически)
const p95 = t => R1.find(r => r.threads === t).p95;
const p5 = Math.sqrt(p95(4) * p95(6));
DATA.sel.mul = Object.fromEntries([1, 2, 4, 5, 10, 25, 50].map(t => [String(t), t === 5 ? 1 : +(p95(t) / p5).toFixed(2)]));
DATA.sel.calm = calm.threads; DATA.sel.knee = k1; DATA.sel.plateau = Math.round(peak(R1));
delete DATA.sel.x50;
DATA.sel.ramp = { 100: R1.map(r => [r.threads, r.p95]), 500: R5.map(r => [r.threads, r.p95]) };  // sel1_100 и sel5_500
// агрегат: срезы — МНК по партии E (a — с при нулевом срезе, b — с на тысячу строк среза), вся таблица — часть B
const fit = pts => {
  const n = pts.length, sx = pts.reduce((s, p) => s + p[0], 0), sy = pts.reduce((s, p) => s + p[1], 0);
  const sxx = pts.reduce((s, p) => s + p[0] * p[0], 0), sxy = pts.reduce((s, p) => s + p[0] * p[1], 0);
  const b = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  return { a: +((sy - b * sx) / n).toFixed(2), b: +b.toFixed(4) };
};
for (const [w, t] of [['W12', 'T_1M_W12'], ['W45', 'T_1M_W45']]) {
  DATA.agg[w].refRows = ROWS[t];
  DATA.agg[w].whole = {};
  for (const [q] of AGG) {
    const j = q.slice(3);
    const pts = slices(q, t).map(([s, v]) => [s / 1000, +v.toFixed(1)]);  // разброс в модель не идёт
    DATA.agg[w].j[j] = { ...fit(pts), pts };
    DATA.agg[w].whole[j] = vol(q, w).map(([n, v]) => [n, +v.toFixed(2)]);
  }
}
const dataTxt = JSON.stringify(DATA, null, 1);
sz = sz.replace(dm[0], '/*DATA-START*/\n' + dataTxt + '\n/*DATA-END*/');
fs.writeFileSync(SZ, sz);

fs.writeFileSync('load-charts.html', `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Нагрузочные замеры Интеграма</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; background:${BG}; color:${INK};
    font: 16px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 960px; margin: 0 auto; padding: 32px 16px 64px; }
  h1 { font-size: 28px; margin: 0 0 8px; }
  h2 { font-size: 20px; margin: 40px 0 4px; }
  .lead { color:${MUTED}; margin: 0 0 18px; }
  a { color:${C[0]}; }
  ul.out { color:${MUTED}; }
  ul.out b { color:${INK}; }
  code { background:${GRID}; border-radius:5px; padding:1px 6px; font-size: .92em; }
  ${CSS}
</style>
</head>
<body>
<main>
<h1>Нагрузочные замеры: выборки, отчёты, потоки</h1>
<p class="lead">Сервер: 2 vCPU AMD EPYC, 1.9 ГБ RAM, MySQL 8.0.46, PHP 8.3.6. 8 таблиц от 1 тыс. до 1 млн строк
(12 и 45 реквизитов), выборки и отчёты-агрегаты по 1, 3 и 5 таблицам. Сырые данные и скрипты —
<code>docs/hlt-stand/</code> в ideav/crm. Калькулятор по этим замерам — <a href="sizing.html">sizing.html</a>.</p>
${section(1, 2, '')}
</main>
</body>
</html>
`);
console.log('ok: load-charts.html, sizing.html');
