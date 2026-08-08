// Tests for ideav/python2node#249 (frontend D1 graph + A/B/C) — js/dash-optimize.js.
// Покрываем на детерминированной синтетической модели фонда (без сети):
//   D1) buildGraph: классификация вход/вычисляемая/KPI и рёбра формул [имя];
//   A)  goalSeek: сценарии рычагов доводят KPI до цели (+20%);
//   B)  findAnomalies: ловит заложенный выброс (робаст-z) и дрейф соотношения;
//   C)  diagnose: детектит проседание ROI и называет верный драйвер.
//
// Run with: node experiments/dash-optimize-249.test.js

var O = require('../js/dash-optimize.js');

var passed = 0, total = 0;
function assert(c, msg) { total++; if (!c) throw new Error('FAIL: ' + msg); passed++; }
function near(a, b, eps, msg) { assert(Math.abs(a - b) <= (eps || 0.5), msg + ' (' + a + ' ≈ ' + b + ')'); }

function pnl(rev, cost, opex, invest) {
    return {
        rows: [
            { name: 'Выручка', formula: '', level: 1 },
            { name: 'Себестоимость', formula: '', level: 1 },
            { name: 'Валовая прибыль', formula: '[Выручка]-[Себестоимость]', level: 1 },
            { name: 'Операционные расходы', formula: '', level: 1 },
            { name: 'EBITDA', formula: '[Валовая прибыль]-[Операционные расходы]', level: 1 },
            { name: 'Инвестиции', formula: '', level: 1 },
            { name: 'ROI, %', formula: 'Math.round([EBITDA]/[Инвестиции]*100)', level: 1 }
        ],
        series: { 'Выручка': rev, 'Себестоимость': cost, 'Операционные расходы': opex, 'Инвестиции': invest }
    };
}

// A: стабильная (аномалия себестоимости в q3). B: деградация ROI (выручка↓, себест↑).
var A = pnl([100,100,100,100], [50,50,90,50], [20,20,20,20], [200,200,200,200]);
var B = pnl([100,90,80,70],    [50,55,60,65], [10,10,10,10], [100,100,100,100]);
var model = {
    quarters: ['q1','q2','q3','q4'], companies: ['A','B'],
    rows: { A: A.rows, B: B.rows }, series: { A: A.series, B: B.series }
};

// ── D1 ──────────────────────────────────────────────────────────────────────
(function () {
    var g = O.buildGraph(model, 'A');
    var by = {}; g.nodes.forEach(function (n) { by[n.name] = n; });
    assert(by['Выручка'].kind === 'input', 'D1: Выручка — вход');
    assert(by['Валовая прибыль'].kind === 'computed', 'D1: Валовая прибыль — вычисляемая');
    assert(by['ROI, %'].kind === 'kpi', 'D1: ROI — KPI');
    assert(by['Валовая прибыль'].refs.indexOf('Выручка') !== -1 && by['Валовая прибыль'].refs.indexOf('Себестоимость') !== -1,
        'D1: рёбра валовой прибыли — на выручку и себестоимость');
    assert(by['ROI, %'].refs.indexOf('EBITDA') !== -1 && by['ROI, %'].refs.indexOf('Инвестиции') !== -1,
        'D1: рёбра ROI — на EBITDA и инвестиции');
    assert(g.edges.length === 6, 'D1: всего 6 рёбер в графе (' + g.edges.length + ')');
})();

// ── A goal-seek ──────────────────────────────────────────────────────────────
(function () {
    // q4: EBITDA=100-50-20=30, ROI raw=30/200*100=15 → цель 18
    var r = O.goalSeek(model, 'A', 'ROI, %', 20, 3);
    near(r.current, 15, 0.01, 'A: текущий ROI 15%');
    near(r.target, 18, 0.01, 'A: цель 18%');
    assert(r.scenarios.length >= 3, 'A: есть сценарии по рычагам (' + r.scenarios.length + ')');
    r.scenarios.forEach(function (s) { near(s.roi, 18, 0.6, 'A: сценарий «' + s.lever + '» доводит ROI до цели'); });
    var rev = r.scenarios.filter(function (s) { return s.lever === 'Выручка'; })[0];
    assert(rev && rev.pct > 0, 'A: рычаг выручки — рост (положительный сдвиг)');
    var cost = r.scenarios.filter(function (s) { return s.lever === 'Себестоимость'; })[0];
    assert(cost && cost.pct < 0, 'A: рычаг себестоимости — снижение');
})();

// ── B anomalies ──────────────────────────────────────────────────────────────
(function () {
    var flags = O.findAnomalies(model);
    var spike = flags.filter(function (f) { return f.type === 'outlier' && f.company === 'A' && f.line === 'Себестоимость'; })[0];
    assert(spike, 'B: найден выброс себестоимости A');
    assert(spike.period === 'q3', 'B: выброс именно в q3');
    assert(Math.abs(spike.z) >= 3.5, 'B: робаст-z выброса ≥ 3.5 (' + spike.z.toFixed(1) + ')');
    var drift = flags.filter(function (f) { return f.type === 'drift' && f.company === 'B'; })[0];
    assert(drift, 'B: найден дрейф себест/выручка у B');
    assert(drift.to > drift.from, 'B: соотношение растёт (' + (drift.from*100).toFixed(0) + '%→' + (drift.to*100).toFixed(0) + '%)');
})();

// ── C diagnosis ──────────────────────────────────────────────────────────────
(function () {
    var c = O.diagnose(model, 'B', 'ROI, %');
    assert(c.declining, 'C: ROI B признан проседающим');
    assert(c.from > c.to, 'C: ROI падает во времени');
    assert(c.driver === 'падение выручки', 'C: главный драйвер — падение выручки (dRev −30 > dCost +15)');
    var rev = c.factors.filter(function (f) { return f.name === 'Выручка'; })[0];
    assert(rev && rev.delta === -30, 'C: фактор «Выручка» Δ = −30');
})();

console.log('\n' + passed + '/' + total + ' passed');
