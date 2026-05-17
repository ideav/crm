'use strict';

// Issue #2368 was superseded by issue #2428: tile mode no longer captures
// the widest panel as a min column width. Panels now occupy configurable
// spans in a 12-column grid.

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
        }
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
        remove(name) { delete values[name]; },
        toggle(name, force) {
            const enabled = force === undefined ? !values[name] : !!force;
            if (enabled) values[name] = true;
            else delete values[name];
            return enabled;
        },
        contains(name) { return !!values[name]; }
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
        style: makeStyle(),
        classList: makeClassList('f-sheet'),
        querySelector(selector) {
            if (selector === '.dash-tile-mode-icon') return button;
            return null;
        },
        querySelectorAll(selector) {
            if (selector === '.f-panel') return [
                { getBoundingClientRect() { return { width: 420.2 }; } },
                { getBoundingClientRect() { return { width: 720.6 }; } }
            ];
            if (selector === '.f-tile-resize-handle') return [];
            return [];
        }
    };
}

assert(
    /grid-template-columns:\s*repeat\(12,\s*minmax\(0,\s*1fr\)\)/.test(css),
    'tile grid uses twelve fixed tracks'
);
assert(
    !/grid-template-columns:\s*repeat\(auto-fit,[^;]*--dash-tile-panel-min-width/.test(css),
    'tile grid no longer depends on a captured panel width'
);
assert(
    /grid-column:\s*span\s+var\(--dash-panel-cols-md,\s*6\)/.test(css),
    'medium screens default panels to six of twelve columns'
);
assert(
    /grid-column:\s*span\s+var\(--dash-panel-cols-lg,\s*4\)/.test(css),
    'large screens default panels to four of twelve columns'
);

const code = `
var DASH_CHART_RESIZE_COOKIE_MAX_AGE = 31536000;
var dashRecordId = 'dash-2368';
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
${extractFunction('dashToggleSheetTileMode')}
`;

const ctx = {
    console,
    document: createCookieDocument()
};
vm.createContext(ctx);
vm.runInContext(code, ctx);

const button = makeButton();
const sheet = makeSheet('ds-main', button);

assert.strictEqual(ctx.dashMeasureSheetTilePanelMinWidth(sheet), 721,
    'legacy measurement helper still reports the widest panel for compatibility');

ctx.dashApplySheetTileMode(sheet, true, true);
assert(sheet.classList.contains('dash-tile-mode'), 'applying tile mode adds the sheet class');
assert.strictEqual(sheet.style.getPropertyValue('--dash-tile-panel-min-width'), '',
    'tile mode does not store the current widest panel width');
assert(ctx.document.hasCookie(ctx.dashSheetTileModeCookieName(sheet)), 'tile mode still persists');
assert.strictEqual(ctx.scheduledRoots.join(','), 'ds-main', 'tile mode still schedules visualization refresh');

ctx.dashApplySheetTileMode(sheet, false, true);
assert.strictEqual(sheet.style.getPropertyValue('--dash-tile-panel-min-width'), '',
    'disabling tile mode leaves the obsolete captured width cleared');

console.log('issue-2368 dashboard tile mode panel width: ok');
