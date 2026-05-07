// Issue #2416 — verify funnel chart logic added in js/dash.js
// The funnel viz reuses pie's data shape and renders via Chart.js as a
// horizontal bar chart with values sorted in descending order so the
// stages form a funnel-like silhouette.

var assert = require('assert');

// Replicate the chart-builder logic for vizType === 'funnel' in isolation.
var CHART_COLORS = [
    'rgba(54,162,235,0.7)', 'rgba(255,99,132,0.7)', 'rgba(255,206,86,0.7)',
    'rgba(75,192,192,0.7)', 'rgba(153,102,255,0.7)', 'rgba(255,159,64,0.7)',
    'rgba(99,255,132,0.7)', 'rgba(235,54,162,0.7)'
];

function buildFunnel(data) {
    var labels = data.labels.slice();
    var funnelVals = data.datasets.length ? data.datasets[0].data : [];
    var pairs = labels.map(function(lbl, i) {
        return { label: lbl, value: Number(funnelVals[i]) || 0 };
    }).sort(function(a, b) { return b.value - a.value; });
    var sortedLabels = pairs.map(function(p) { return p.label; });
    var dataset = {
        label: data.datasets[0] && data.datasets[0].label ? data.datasets[0].label : '',
        data: pairs.map(function(p) { return p.value; }),
        backgroundColor: pairs.map(function(_, i) { return CHART_COLORS[i % CHART_COLORS.length]; }),
        borderWidth: 0
    };
    var options = {
        indexAxis: 'y',
        plugins: { legend: { display: false } },
        scales: { x: { beginAtZero: true }, y: { ticks: { autoSkip: false } } }
    };
    return { type: 'bar', labels: sortedLabels, dataset: dataset, options: options };
}

// Test 1: values are sorted from largest to smallest.
var input1 = {
    labels: ['Заявка', 'Собеседование', 'Лид', 'Оффер', 'Найм'],
    datasets: [{ label: 'Кол-во', data: [50, 30, 100, 20, 10] }]
};
var out1 = buildFunnel(input1);
assert.deepStrictEqual(out1.labels, ['Лид', 'Заявка', 'Собеседование', 'Оффер', 'Найм']);
assert.deepStrictEqual(out1.dataset.data, [100, 50, 30, 20, 10]);
console.log('OK: stages sort from largest to smallest');

// Test 2: chart is rendered as a horizontal bar chart.
assert.strictEqual(out1.type, 'bar');
assert.strictEqual(out1.options.indexAxis, 'y');
console.log('OK: rendered as horizontal bar (indexAxis=y)');

// Test 3: legend is hidden — colours encode the stages directly.
assert.strictEqual(out1.options.plugins.legend.display, false);
assert.strictEqual(out1.dataset.backgroundColor.length, out1.dataset.data.length);
console.log('OK: legend hidden, per-stage colours assigned');

// Test 4: missing/non-numeric values fall back to zero.
var input2 = {
    labels: ['A', 'B', 'C'],
    datasets: [{ label: 'V', data: [null, 'oops', 7] }]
};
var out2 = buildFunnel(input2);
assert.deepStrictEqual(out2.dataset.data, [7, 0, 0]);
console.log('OK: non-numeric values fall back to 0');

// Test 5: empty datasets do not throw.
var out3 = buildFunnel({ labels: [], datasets: [] });
assert.deepStrictEqual(out3.labels, []);
assert.deepStrictEqual(out3.dataset.data, []);
console.log('OK: empty datasets handled');

console.log('All funnel chart logic tests passed.');
