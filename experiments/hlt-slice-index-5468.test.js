// Гейт-тест для docs/hlt-stand/sizing.html (issue #5468): срез отчёта фильтром по индексу.
// Фильтр, попадающий в индекс (диапазон дат), сначала выбирает строки среза и агрегирует только их,
// поэтому оценка калькулятора для среза:
//   1) опирается на замеры срезов по датам (filter-5468.json, часть F) — каждая ячейка неделя/месяц/квартал/год
//      есть в DATA.agg.W12 с той же медианой;
//   2) воспроизводит эти замеры (исполняется реальный <script> страницы, aggEstimate) в пределах 5 %;
//   3) не зависит от размера таблицы: срез 36 400 строк из 1 млн и из 10 млн стоит одинаково.
//
// Run with: node experiments/hlt-slice-index-5468.test.js
// (HLT_SIZING_PAGE=<путь> — проверить другую версию страницы)

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, total = 0;
function assertTrue(ok, name, detail) {
    total++;
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) passed++;
    else { console.log('  ' + detail); process.exitCode = 1; }
}
const pct = (a, b) => Math.abs(a / b - 1) * 100;
const med = ms => { const m = ms.slice().sort((a, b) => a - b), h = m.length >> 1;
    return m.length % 2 ? m[h] : (m[h - 1] + m[h]) / 2; };

const dir = path.join(__dirname, '..', 'docs', 'hlt-stand');
const page = fs.readFileSync(process.env.HLT_SIZING_PAGE || path.join(dir, 'sizing.html'), 'utf8');
const FILT = JSON.parse(fs.readFileSync(path.join(dir, 'filter-5468.json'), 'utf8'));
const DATA = JSON.parse(page.match(/\/\*DATA-START\*\/([\s\S]*?)\/\*DATA-END\*\//)[1]);

// строк в срезе — по agg1 того же периода (agg3/agg5 группируют по справочнику)
const rowsOf = p => FILT.find(r => r.scenario === 'agg1_date_' + p).rows;
const cells = FILT.filter(r => /_date_(week|month|quarter|year)$/.test(r.scenario))
    .map(r => ({ j: r.scenario[3], S: rowsOf(r.scenario.split('_')[2]), median: med(r.ms) / 1000, name: r.scenario }));
assertTrue(cells.length === 12, 'в filter-5468.json 12 ячеек срезов по датам (3 отчёта × 4 периода)', 'ячеек ' + cells.length);

// 1) DATA покрывает замеры
const missing = cells.filter(c => {
    const fam = DATA.agg.W12.j[c.j];
    const pt = fam && fam.pts.find(p => Math.round(p[0] * 1000) === c.S);
    return !pt || Math.abs(pt[1] - c.median) > 0.05;
}).map(c => c.name);
assertTrue(missing.length === 0, 'DATA.agg.W12 содержит все срезы по датам с медианами из filter-5468.json',
    'нет или расходится: ' + missing.join(', '));

// исполняем скрипт страницы с DOM-заглушкой
const script = page.match(/<script>([\s\S]*)<\/script>/)[1];
function fakeEl(def) {
    const store = Object.assign({ value: '5', innerHTML: '', hidden: true, style: {} }, def || {});
    const f = new Proxy(function () {}, {
        get(t, p) {
            if (p in store) return store[p];
            if (p === 'viewBox') return { baseVal: { width: 720, height: 330 } };
            if (p === 'querySelector' || p === 'appendChild' || p === 'addEventListener' ||
                p === 'querySelectorAll') return () => fakeEl({});
            return f;
        },
        set(t, p, v) { store[p] = v; return true; },
        apply() { return f; }
    });
    return f;
}
const ids = {};
['op', 'join', 'width', 'nrows', 'slice', 'threads', 'cores', 'stats', 'formula', 'flag',
    'nearest', 'mtitle', 'mnote', 'mplot', 'mtable', 'calc',
    'lw', 'lw2', 'lw3', 'lw4', 'lw5'].forEach(id => { ids[id] = fakeEl({}); });
const sandbox = {
    document: {
        getElementById: id => ids[id],
        querySelectorAll: () => [],
        createElement: () => fakeEl({}),
        createElementNS: () => fakeEl({})
    },
    console: { log: () => {} }
};
vm.createContext(sandbox);
vm.runInContext(script, sandbox);
const aggEstimate = vm.runInContext('aggEstimate', sandbox);
const setSel = (w, j) => { ids.width.value = w; ids.join.value = j; };

// 2) оценка воспроизводит замеры (1 поток, 2 vCPU — как на стенде)
let worst = ['', 0];
cells.forEach(c => {
    setSel('W12', c.j);
    const d = pct(aggEstimate(1000000, c.S, '1', 2).t1 / 1000, c.median);
    if (d > worst[1]) worst = [c.name, d];
});
assertTrue(worst[1] <= 5, 'оценка среза воспроизводит замеры по датам в пределах 5 %',
    'худшая: ' + worst[0] + ' ' + worst[1].toFixed(1) + ' %');

// 3) срез по индексу не зависит от размера таблицы
const dep = [];
['W12', 'W45'].forEach(w => ['1', '3', '5'].forEach(j => {
    setSel(w, j);
    const a = aggEstimate(1000000, 36400, '1', 2).t1, b = aggEstimate(10000000, 36400, '1', 2).t1;
    if (pct(b, a) > 1) dep.push(w + ' agg' + j + ': 1 млн ' + (a / 1000).toFixed(1) + ' с, 10 млн ' + (b / 1000).toFixed(1) + ' с');
}));
assertTrue(dep.length === 0, 'срез 36 400 строк стоит одинаково в таблице 1 млн и 10 млн', dep.join('; '));

console.log(`\n${passed}/${total} passed`);
