'use strict';

const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('js/dash.js', 'utf8');
const css = fs.readFileSync('css/dash.css', 'utf8');

const panelTplStart = source.indexOf(', panelTpl');
const headTplStart = source.indexOf(', headTpl', panelTplStart);

assert(panelTplStart !== -1, 'dashboard panel template must be defined');
assert(headTplStart !== -1, 'dashboard head template must follow panel template');

const panelTpl = source.slice(panelTplStart, headTplStart);
const settingsIconIndex = panelTpl.indexOf('f-panel-settings-icon');
const filterIconIndex = panelTpl.indexOf('f-panel-filter-icon');

assert(settingsIconIndex !== -1, 'dashboard panels must render a settings icon for admins');
assert(filterIconIndex !== -1, 'dashboard panels must render a filter icon');
assert(
    settingsIconIndex < filterIconIndex,
    'settings icon must render before filter icon so an active filter icon stays anchored when panel hover reveals settings'
);
assert(
    /\.f-panel-filter-icon\.active\s*\{[^}]*display:\s*inline-flex/.test(css),
    'active panel filter icon must stay visible outside panel hover'
);

console.log('issue-2356 dashboard panel icon order: ok');
