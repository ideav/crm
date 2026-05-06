'use strict';

// Issue #2368: entering dashboard tile mode must not make the new grid
// columns narrower than the panels were immediately before the switch.

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

function makePanel(width) {
    return {
        getBoundingClientRect() {
            return { width };
        }
    };
}

function makeSheet(id, panelWidths, button) {
    const panels = panelWidths.map(makePanel);
    return {
        id,
        style: makeStyle(),
        classList: makeClassList('f-sheet'),
        querySelector(selector) {
            if (selector === '.dash-tile-mode-icon') return button;
            return null;
        },
        querySelectorAll(selector) {
            if (selector === '.f-panel') return panels;
            return [];
        }
    };
}

assert(
    /grid-template-columns:\s*repeat\(auto-fit,[^;]*var\(--dash-tile-panel-min-width/.test(css),
    'tile grid uses the captured panel width as a minimum column width'
);

const code = `
var DASH_CHART_RESIZE_COOKIE_MAX_AGE = 31536000;
var DASH_TILE_PANEL_MIN_WIDTH = 200;
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
${extractFunction('dashSheetTilePanelWidthsCookieName')}
${extractFunction('dashReadSheetTilePanelWidth')}
${extractFunction('dashWriteSheetTilePanelWidth')}
${extractFunction('dashRemoveSheetTilePanelWidth')}
${extractFunction('dashReadSheetTilePanelWidths')}
${extractFunction('dashWriteSheetTilePanelWidths')}
${extractFunction('dashRemoveSheetTilePanelWidths')}
${extractFunction('dashReadSheetTileMode')}
${extractFunction('dashSetSheetTileModeButtonState')}
${extractFunction('dashMeasureSheetTilePanelMinWidth')}
${extractFunction('dashApplySheetTilePanelMinWidth')}
${extractFunction('dashApplySheetTileColumnWidths')}
${extractFunction('dashPrepareSheetTileMode')}
${extractFunction('dashClearSheetTileMode')}
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
const sheet = makeSheet('ds-main', [420.2, 720.6, 0], button);

assert.strictEqual(ctx.dashMeasureSheetTilePanelMinWidth(sheet), 721,
    'measurement rounds up the widest visible panel');

ctx.dashApplySheetTileMode(sheet, true, true);
assert(sheet.classList.contains('dash-tile-mode'), 'applying tile mode adds the sheet class');
assert.strictEqual(sheet.style.getPropertyValue('--dash-tile-panel-min-width'), '721px',
    'tile mode stores the current widest panel width before narrowing can occur');
assert(ctx.document.hasCookie(ctx.dashSheetTileModeCookieName(sheet)), 'tile mode still persists');
assert.strictEqual(ctx.scheduledRoots.join(','), 'ds-main', 'tile mode still schedules visualization refresh');

ctx.dashApplySheetTileMode(sheet, false, true);
assert.strictEqual(sheet.style.getPropertyValue('--dash-tile-panel-min-width'), '',
    'disabling tile mode clears the captured width');

console.log('issue-2368 dashboard tile mode panel width: ok');
