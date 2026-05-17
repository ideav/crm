'use strict';

// Issue #2366: dashboard sheets need a tile mode that can align panel widths
// and visible table heights where possible.

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
        }
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

function makeSheet(id, button) {
    return {
        id,
        classList: makeClassList('f-sheet'),
        querySelector(selector) {
            if (selector === '.dash-tile-mode-icon') return button;
            return null;
        },
        querySelectorAll() { return []; }
    };
}

assert(source.includes('dash-tile-mode-icon'), 'dashboard sheet template renders a tile-mode button');
assert(css.includes('.f-sheet.dash-tile-mode'), 'dashboard stylesheet defines tile mode for sheets');
assert(/\.f-sheet\.dash-tile-mode\s*\{[^}]*display:\s*grid/.test(css), 'tile mode uses CSS grid');
assert(/\.f-sheet\.dash-tile-mode\s*\{[^}]*grid-template-columns:\s*repeat\(12,\s*minmax\(0,\s*1fr\)\)/.test(css),
    'tile mode uses a 12-column grid');
assert(/grid-column:\s*span\s+var\(--dash-panel-cols-xs,\s*12\)/.test(css),
    'tile panels default to full-width on the smallest screens');
assert(/\.f-sheet\.dash-tile-mode\s+\.f-panel-content\s*\{[^}]*display:\s*flex/.test(css), 'tile panels stretch their content');
assert(/\.f-sheet\.dash-tile-mode\s+\.f-table-wrap\s*>\s*table\s*\{[^}]*width:\s*100%/.test(css), 'tile tables fill equal tile width');
assert(/\.f-sheet\.dash-tile-mode\s+\.f-table-wrap\s*>\s*table\s*\{[^}]*white-space:\s*normal/.test(css), 'tile tables wrap long values inside the tile');

const code = `
var DASH_CHART_RESIZE_COOKIE_MAX_AGE = 31536000;
var dashRecordId = 'dash-2366';
var dashCurrentId = null;
var scheduledRoots = [];
var statusMessages = [];
function dashScheduleVisibleVizRefresh(rootEl) { scheduledRoots.push(rootEl.id); }
function dashSetStatus(message) { statusMessages.push(message); }
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

const ctx = {
    console,
    document: createCookieDocument()
};
vm.createContext(ctx);
vm.runInContext(code, ctx);

const button = makeButton();
const sheet = makeSheet('ds-main', button);
const cookieName = ctx.dashSheetTileModeCookieName(sheet);

assert.strictEqual(ctx.dashReadSheetTileMode(sheet), false, 'tile mode is off when cookie and sheet default are absent');
ctx.dashApplySheetTileMode(sheet, true, true);
assert(sheet.classList.contains('dash-tile-mode'), 'applying tile mode adds the sheet class');
assert(button.classList.contains('active'), 'button is highlighted when tile mode is active');
assert.strictEqual(button.getAttribute('aria-pressed'), 'true', 'active button exposes pressed state');
assert(ctx.document.hasCookie(cookieName), 'tile mode persists to a dashboard/sheet cookie');
assert.strictEqual(ctx.scheduledRoots.join(','), 'ds-main', 'toggling schedules a visible visualization refresh');

ctx.dashToggleSheetTileMode(sheet);
assert(!sheet.classList.contains('dash-tile-mode'), 'toggle removes tile mode from an active sheet');
assert(!button.classList.contains('active'), 'button highlight is removed when tile mode is off');
assert.strictEqual(button.getAttribute('aria-pressed'), 'false', 'inactive button exposes unpressed state');
assert.strictEqual(ctx.document.getCookie(cookieName), '0', 'disabling tile mode persists an explicit off cookie');
assert(ctx.statusMessages.includes('Режим плитки выключен'), 'toggle reports the disabled state');

const offSheet = makeSheet('ds-main', makeButton());
ctx.dashInitSheetTileMode(offSheet);
assert(!offSheet.classList.contains('dash-tile-mode'), 'initialization keeps tile mode off from the explicit off cookie');

ctx.dashApplySheetTileMode(sheet, true, true);
const restoredSheet = makeSheet('ds-main', makeButton());
ctx.dashInitSheetTileMode(restoredSheet);
assert(restoredSheet.classList.contains('dash-tile-mode'), 'initialization restores tile mode from the cookie');

console.log('issue-2366 dashboard tile mode: ok');
