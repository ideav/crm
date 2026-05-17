'use strict';

// Issue #2428: tile mode uses a 12-column grid, removes tile-width dragging,
// and exposes panel height/column settings.

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('js/dash.js', 'utf8');
const css = fs.readFileSync('css/dash.css', 'utf8');
const modalTemplate = fs.readFileSync('templates/dash.html', 'utf8');

function extractFunction(name) {
    const marker = 'function ' + name + '(';
    const start = source.indexOf(marker);
    if (start === -1) throw new Error('Missing function ' + name);

    const braceStart = source.indexOf('{', start);
    let depth = 0;
    for (let i = braceStart; i < source.length; i++) {
        if (source[i] === '{') depth++;
        if (source[i] === '}') depth--;
        if (depth === 0) return source.slice(start, i + 1);
    }
    throw new Error('Unclosed function ' + name);
}

function createCookieDocument() {
    const jar = {};
    return {
        get cookie() {
            return Object.keys(jar).map(name => name + '=' + jar[name]).join('; ');
        },
        set cookie(value) {
            const first = String(value).split(';')[0];
            const eq = first.indexOf('=');
            const name = first.slice(0, eq);
            const val = first.slice(eq + 1);
            if (/max-age=0/i.test(value)) delete jar[name];
            else jar[name] = val;
        },
        getCookie(name) {
            return jar[name];
        },
        body: { classList: makeClassList('dash-tile-resizing') }
    };
}

function makeClassList(initial) {
    const values = {};
    (initial || '').split(/\s+/).filter(Boolean).forEach(name => { values[name] = true; });
    return {
        values,
        remove(name) { delete values[name]; },
        contains(name) { return !!values[name]; },
        toggle(name, force) {
            const enabled = force === undefined ? !values[name] : !!force;
            if (enabled) values[name] = true;
            else delete values[name];
            return enabled;
        }
    };
}

function makeStyle() {
    const props = {};
    return {
        props,
        setProperty(name, value) { props[name] = String(value); },
        removeProperty(name) { delete props[name]; },
        getPropertyValue(name) { return props[name] || ''; }
    };
}

function makeButton() {
    const attrs = {};
    return {
        classList: makeClassList('dash-tile-mode-icon'),
        title: '',
        setAttribute(name, value) { attrs[name] = String(value); },
        getAttribute(name) { return attrs[name]; }
    };
}

function makeSheet(id, button) {
    return {
        id,
        dataset: {},
        style: makeStyle(),
        classList: makeClassList('f-sheet'),
        querySelector(selector) {
            if (selector === '.dash-tile-mode-icon') return button;
            return null;
        },
        querySelectorAll(selector) {
            if (selector === '.f-tile-resize-handle') return [];
            return [];
        }
    };
}

function plain(value) {
    return JSON.parse(JSON.stringify(value));
}

const sheetTplStart = source.indexOf(', sheetTpl');
const sheetTplEnd = source.indexOf(', panelTpl', sheetTplStart);
const sheetTpl = source.slice(sheetTplStart, sheetTplEnd);
assert(sheetTpl.indexOf('dash-settings-icon') < sheetTpl.indexOf('dash-tile-mode-icon'),
    'tile mode button is after dashboard settings');
assert(sheetTpl.indexOf('dash-tile-mode-icon') < sheetTpl.indexOf('dash-reset-size-icon'),
    'tile mode button is before reset sizes');
assert(sheetTpl.includes('aria-pressed="false"'), 'tile mode button starts unpressed');
assert(sheetTpl.includes('title="Включить режим плитки"'), 'tile mode button starts with enable title');

assert(/grid-template-columns:\s*repeat\(12,\s*minmax\(0,\s*1fr\)\)/.test(css),
    'tile mode uses a 12-column grid');
['xs', 'sm', 'md', 'lg', 'xl', 'xxl'].forEach(key => {
    assert(css.includes('--dash-panel-cols-' + key), key + ' column custom property is supported');
});
assert(!/\.f-tile-resize-handle\s*\{/.test(css), 'tile resize handle styles are removed');
assert.strictEqual(source.indexOf('function dashStartTilePanelResize('), -1,
    'tile drag implementation is removed');
assert(!modalTemplate.includes('dash-panel-max-width-settings'),
    'panel max-width settings container is removed from the modal');

const code = `
var DASH_CHART_RESIZE_COOKIE_MAX_AGE = 31536000;
var DASH_PANEL_COLUMN_BREAKPOINTS = [
    { key: 'xs', label: 'XS', range: '<576px', minWidth: 0, defaultValue: 12 },
    { key: 'sm', label: 'SM', range: '>=576px', minWidth: 576, defaultValue: 12 },
    { key: 'md', label: 'MD', range: '>=768px', minWidth: 768, defaultValue: 6 },
    { key: 'lg', label: 'LG', range: '>=992px', minWidth: 992, defaultValue: 4 },
    { key: 'xl', label: 'XL', range: '>=1200px', minWidth: 1200, defaultValue: 4 },
    { key: 'xxl', label: 'XXL', range: '>=1400px', minWidth: 1400, defaultValue: 3 }
];
var dashRecordId = 'dash-2428';
var dashCurrentId = null;
var dashModelData = {};
var scheduledRoots = [];
function dashScheduleVisibleVizRefresh(rootEl) { scheduledRoots.push(rootEl.id); }
function dashSetStatus() {}
function dashApplyPanelMaxWidth() {}
${extractFunction('dashAttr')}
${extractFunction('dashNormalizeIntegerInRange')}
${extractFunction('dashCookieGet')}
${extractFunction('dashCookieSet')}
${extractFunction('dashCookieRemove')}
${extractFunction('dashCookieNamePart')}
${extractFunction('dashSheetTileModeCookieName')}
${extractFunction('dashSheetTilePanelWidthCookieName')}
${extractFunction('dashRemoveSheetTilePanelWidth')}
${extractFunction('dashSheetDefaultTileMode')}
${extractFunction('dashSheetTileModeDefaultFromValue')}
${extractFunction('dashSheetTileModeDefaultFromRow')}
${extractFunction('dashSetSheetTileModeDefault')}
${extractFunction('dashReadSheetTileMode')}
${extractFunction('dashSetSheetTileModeButtonState')}
${extractFunction('dashApplySheetTilePanelMinWidth')}
${extractFunction('dashPrepareSheetTileMode')}
${extractFunction('dashClearSheetTileMode')}
${extractFunction('dashRemoveSheetTilePanelResizeHandles')}
${extractFunction('dashApplySheetTileMode')}
${extractFunction('dashNormalizePanelHeight')}
${extractFunction('dashPanelHeightFromSettings')}
${extractFunction('dashSetPanelHeightInSettings')}
${extractFunction('dashNormalizePanelColumns')}
${extractFunction('dashPanelColumnsWithDefaults')}
${extractFunction('dashPanelColumnsFromSettings')}
${extractFunction('dashSetPanelColumnsInSettings')}
${extractFunction('dashIsResizableChartViz')}
${extractFunction('dashPanelActiveVizType')}
${extractFunction('dashApplyPanelHeight')}
${extractFunction('dashApplyPanelColumns')}
${extractFunction('dashApplyPanelLayout')}
${extractFunction('dashBuildPanelHeightHtml')}
${extractFunction('dashBuildPanelColumnsHtml')}
${extractFunction('dashCollectPanelHeight')}
${extractFunction('dashCollectPanelColumns')}
`;

const doc = createCookieDocument();
const ctx = { console, document: doc };
vm.createContext(ctx);
vm.runInContext(code, ctx);

const button = makeButton();
const sheet = makeSheet('ds-main', button);
const tileCookie = ctx.dashSheetTileModeCookieName(sheet);

assert.strictEqual(ctx.dashReadSheetTileMode(sheet), false, 'missing tile cookie and sheet default means tile mode is off');
ctx.dashSetSheetTileModeDefault(sheet, { 'Сетка': '1' });
assert.strictEqual(ctx.dashReadSheetTileMode(sheet), true, 'non-empty Сетка enables tile mode by default');
ctx.dashApplySheetTileMode(sheet, false, true);
assert.strictEqual(doc.getCookie(tileCookie), '0', 'disabling tile mode stores an explicit off state');
assert.strictEqual(ctx.dashReadSheetTileMode(sheet), false, 'explicit off cookie disables tile mode');

const heightHtml = ctx.dashBuildPanelHeightHtml({ min: 180, max: 360 });
assert(heightHtml.includes('Высота панели / графика'), 'panel/chart height settings are rendered');
assert(heightHtml.includes('name="panelHeightMin"'), 'minimum panel height input is rendered');
assert(heightHtml.includes('name="panelHeightMax"'), 'maximum panel height input is rendered');

const columnsHtml = ctx.dashBuildPanelColumnsHtml({ md: 5, lg: 3 });
assert(columnsHtml.includes('Ширина панели (12 колонок)'), 'panel column settings are rendered');
assert(columnsHtml.includes('name="panelColumnsXS" value="12"'), 'XS uses the default full-width span');
assert(columnsHtml.includes('name="panelColumnsMD" value="5"'), 'MD renders the custom span');
assert(columnsHtml.includes('name="panelColumnsLG" value="3"'), 'LG renders the custom span');

let settings = [{ type: 'bar', fieldMap: {} }];
settings = ctx.dashSetPanelHeightInSettings(settings, { min: '220', max: '180' });
settings = ctx.dashSetPanelColumnsInSettings(settings, { xs: 12, sm: 12, md: 5, lg: 3, xl: 4, xxl: 3 });
assert.deepStrictEqual(plain(ctx.dashPanelHeightFromSettings(settings)), { min: 220, max: 220 },
    'panel height normalizes max below min');
assert.deepStrictEqual(plain(ctx.dashPanelColumnsFromSettings(settings)),
    { xs: 12, sm: 12, md: 5, lg: 3, xl: 4, xxl: 3 },
    'custom panel columns are persisted');

const contentStyle = makeStyle();
const panelStyle = makeStyle();
const panel = {
    id: 'fp-main',
    style: panelStyle,
    querySelector(selector) {
        if (selector === '.f-panel-content') return { style: contentStyle };
        return null;
    }
};
ctx.dashModelData['fp-main'] = { settings };
ctx.dashApplyPanelLayout(panel);
assert.strictEqual(contentStyle.minHeight, '220px', 'panel min height is applied');
assert.strictEqual(contentStyle.maxHeight, '220px', 'panel max height is applied');
assert.strictEqual(contentStyle.overflow, 'auto', 'panel max height enables scrolling');
assert.strictEqual(panelStyle.getPropertyValue('--dash-panel-cols-md'), '5',
    'custom medium column span is applied as a CSS variable');
assert.strictEqual(panelStyle.getPropertyValue('--dash-panel-cols-lg'), '3',
    'custom large column span is applied as a CSS variable');

const values = {
    panelHeightMin: '240',
    panelHeightMax: '600',
    panelColumnsXS: '12',
    panelColumnsSM: '12',
    panelColumnsMD: '6',
    panelColumnsLG: '6',
    panelColumnsXL: '4',
    panelColumnsXXL: '3'
};
ctx.document = {
    getElementById(id) {
        if (id !== 'dash-panel-general-settings') return null;
        return {
            querySelector(selector) {
                const match = selector.match(/\[name="([^"]+)"\]/);
                if (!match || !(match[1] in values)) return null;
                return { value: values[match[1]] };
            }
        };
    },
    body: doc.body
};
assert.deepStrictEqual(plain(ctx.dashCollectPanelHeight()), { min: 240, max: 600 },
    'panel height is collected from the general settings tab');
assert.deepStrictEqual(plain(ctx.dashCollectPanelColumns()),
    { xs: 12, sm: 12, md: 6, lg: 6, xl: 4, xxl: 3 },
    'custom panel columns are collected from the general settings tab');

console.log('issue-2428 dashboard tile layout: ok');
