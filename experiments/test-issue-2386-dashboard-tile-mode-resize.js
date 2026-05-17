'use strict';

// Issue #2386 added draggable tile widths. Issue #2428 removes that
// interaction: tile widths now come from 12-column panel spans.

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('js/dash.js', 'utf8');
const css = fs.readFileSync('css/dash.css', 'utf8');

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
        hasCookie(name) {
            return Object.prototype.hasOwnProperty.call(jar, name);
        },
        getCookie(name) {
            return jar[name];
        },
        body: { classList: makeClassList('dash-tile-resizing') }
    };
}

function makeStyle() {
    const props = {};
    return {
        setProperty(name, value) { props[name] = String(value); },
        removeProperty(name) { delete props[name]; },
        getPropertyValue(name) { return props[name] || ''; }
    };
}

function makeClassList(initial) {
    const values = {};
    (initial || '').split(/\s+/).filter(Boolean).forEach(name => { values[name] = true; });
    return {
        values,
        add(name) { values[name] = true; },
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

function makeButton() {
    const attrs = {};
    return {
        classList: makeClassList('dash-tile-mode-icon'),
        title: '',
        setAttribute(name, value) { attrs[name] = String(value); },
        getAttribute(name) { return attrs[name]; }
    };
}

function makePanel() {
    const panel = {
        removed: false,
        removeChild(node) {
            if (node === handle) panel.removed = true;
        }
    };
    const handle = { parentNode: panel };
    return { panel, handle };
}

function makeSheet(id, button) {
    const pair = makePanel();
    const sheet = {
        id,
        style: makeStyle(),
        classList: makeClassList('f-sheet f-sheet--tile-resizing'),
        querySelector(selector) {
            if (selector === '.dash-tile-mode-icon') return button;
            return null;
        },
        querySelectorAll(selector) {
            if (selector === '.f-tile-resize-handle') return [pair.handle];
            return [];
        }
    };
    return { sheet, pair };
}

// CSS- and source-level checks
assert(!/\.f-tile-resize-handle\s*\{/.test(css), 'tile resize handle CSS is removed');
assert(!/body\.dash-tile-resizing/.test(css), 'tile dragging body cursor CSS is removed');
assert.strictEqual(source.indexOf('function dashStartTilePanelResize('), -1,
    'tile panel drag handler is removed');
assert.strictEqual(source.indexOf('function dashEnsureTilePanelResizeHandle('), -1,
    'tile resize handle creation is removed');

const code = `
var DASH_CHART_RESIZE_COOKIE_MAX_AGE = 31536000;
var dashRecordId = 'dash-2386';
var dashCurrentId = null;
var scheduledRoots = [];
function dashScheduleVisibleVizRefresh(rootEl) { scheduledRoots.push(rootEl.id); }
function dashSetStatus() {}
${extractFunction('dashCookieGet')}
${extractFunction('dashCookieSet')}
${extractFunction('dashCookieRemove')}
${extractFunction('dashCookieNamePart')}
${extractFunction('dashSheetTileModeCookieName')}
${extractFunction('dashSheetTilePanelWidthCookieName')}
${extractFunction('dashReadSheetTilePanelWidth')}
${extractFunction('dashWriteSheetTilePanelWidth')}
${extractFunction('dashRemoveSheetTilePanelWidth')}
${extractFunction('dashSheetDefaultTileMode')}
${extractFunction('dashSheetTileModeDefaultFromValue')}
${extractFunction('dashSheetTileModeDefaultFromRow')}
${extractFunction('dashSetSheetTileModeDefault')}
${extractFunction('dashReadSheetTileMode')}
${extractFunction('dashSetSheetTileModeButtonState')}
${extractFunction('dashMeasureSheetTilePanelMinWidth')}
${extractFunction('dashApplySheetTilePanelMinWidth')}
${extractFunction('dashPrepareSheetTileMode')}
${extractFunction('dashClearSheetTileMode')}
${extractFunction('dashRemoveSheetTilePanelResizeHandles')}
${extractFunction('dashEnsureSheetTilePanelResizeHandles')}
${extractFunction('dashApplySheetTileMode')}
${extractFunction('dashInitSheetTileMode')}
${extractFunction('dashToggleSheetTileMode')}
`;

const doc = createCookieDocument();
const ctx = { console, document: doc };
vm.createContext(ctx);
vm.runInContext(code, ctx);

const button = makeButton();
const { sheet, pair } = makeSheet('ds-resize', button);
const widthCookie = ctx.dashSheetTilePanelWidthCookieName(sheet);

ctx.dashWriteSheetTilePanelWidth(sheet, 520);
assert.strictEqual(doc.getCookie(widthCookie), '520', 'legacy width cookie can exist before cleanup');

ctx.dashApplySheetTileMode(sheet, true, true);
assert(sheet.classList.contains('dash-tile-mode'), 'tile mode still applies');
assert(pair.panel.removed, 'enabling tile mode removes obsolete tile resize handles');
assert.strictEqual(sheet.style.getPropertyValue('--dash-tile-panel-min-width'), '',
    'enabling tile mode does not apply a saved drag width');
assert.strictEqual(doc.getCookie(widthCookie), '520',
    'enabling tile mode does not rewrite legacy width cookies during read-only initialization');

ctx.dashApplySheetTileMode(sheet, false, true);
assert(!sheet.classList.contains('f-sheet--tile-resizing'),
    'clearing tile mode drops any stale resizing class');
assert(!doc.body.classList.contains('dash-tile-resizing'),
    'clearing tile mode drops any stale body resizing class');
assert(!doc.hasCookie(widthCookie),
    'turning off tile mode removes the legacy saved tile width');

console.log('issue-2386 dashboard tile mode resize removal: ok');
