const assert = require('assert');
const fs = require('fs');

const template = fs.readFileSync('templates/dash.html', 'utf8');
const tabMatch = template.match(/<li\b[^>]*class="dash-viz-tab active"[^>]*data-viz-tab="panels"[^>]*>([^<]*)<\/li>/);

assert(tabMatch, 'dashboard visualization panels tab should exist and stay active by default');
assert.strictEqual(tabMatch[1].trim(), 'Диаграммы');
assert(template.includes('data-viz-tab-pane="panels"'), 'panels tab content pane should keep its data binding');

console.log('issue-2419 dashboard visualization tab label: ok');
