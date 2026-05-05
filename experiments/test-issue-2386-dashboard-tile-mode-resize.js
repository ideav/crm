'use strict';

// Issue #2386: when tile mode is enabled, the user must be able to drag
// the vertical border between tiles. The chosen width is persisted to a cookie
// and removed when tile mode is turned off.

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
    const listeners = {};
    const doc = {
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
        body: { classList: makeClassList('') },
        createElement(tag) {
            return makeButton(tag);
        },
        addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
        removeEventListener(type, fn) {
            const arr = listeners[type] || [];
            const idx = arr.indexOf(fn);
            if (idx !== -1) arr.splice(idx, 1);
        },
        dispatch(type, event) {
            (listeners[type] || []).slice().forEach(fn => fn(event));
        }
    };
    return doc;
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

function makeButton(tag) {
    const attrs = {};
    const handlers = {};
    const node = {
        tagName: (tag || 'button').toUpperCase(),
        type: '',
        title: '',
        className: '',
        dataset: {},
        style: makeStyle(),
        classList: makeClassList(''),
        parentEl: null,
        setAttribute(name, value) { attrs[name] = String(value); },
        getAttribute(name) { return attrs[name]; },
        addEventListener(type, fn) { handlers[type] = fn; },
        removeEventListener() {},
        dispatch(type, event) {
            const fn = handlers[type];
            if (fn) fn(event);
        },
        closest(selector) {
            if (!node.parentEl || !node.parentEl.closest) return null;
            return node.parentEl.closest(selector);
        }
    };
    return node;
}

function makePanel(width) {
    const handlers = {};
    let appendedHandle = null;
    const panel = {
        getBoundingClientRect() { return { width, height: 200, top: 0, left: 0 }; },
        offsetWidth: width,
        querySelector(selector) {
            if (selector === '.f-tile-resize-handle') return appendedHandle;
            return null;
        },
        querySelectorAll() { return []; },
        appendChild(node) { appendedHandle = node; node.parentEl = panel; return node; },
        closest(selector) {
            if (selector === '.f-panel') return panel;
            if (selector === '.f-sheet') return panel._sheet || null;
            return null;
        },
        get appendedHandle() { return appendedHandle; }
    };
    Object.defineProperty(panel, 'appendedHandle', { get() { return appendedHandle; }, configurable: true });
    return panel;
}

function makeSheet(id, panelWidths, button) {
    const panels = panelWidths.map(makePanel);
    const sheet = {
        id,
        style: makeStyle(),
        classList: makeClassList('f-sheet'),
        getBoundingClientRect() {
            return { width: 1200, height: 800, top: 0, left: 0 };
        },
        querySelector(selector) {
            if (selector === '.dash-tile-mode-icon') return button;
            return null;
        },
        querySelectorAll(selector) {
            if (selector === '.f-panel') return panels;
            return [];
        }
    };
    panels.forEach(p => { p._sheet = sheet; });
    return { sheet, panels };
}

// CSS-level checks
assert(/\.f-tile-resize-handle\s*\{/.test(css), 'tile resize handle has its own CSS class');
assert(/cursor:\s*ew-resize/.test(css), 'tile resize handle uses horizontal resize cursor');
assert(/\.f-sheet\.dash-tile-mode\s+\.f-panel\s+\.f-tile-resize-handle\s*\{[^}]*display:\s*block/.test(css),
    'tile resize handle is shown only when tile mode is active');
assert(/body\.dash-tile-resizing/.test(css), 'body cursor changes while dragging the tile border');

const code = `
var DASH_CHART_RESIZE_COOKIE_MAX_AGE = 31536000;
var DASH_TILE_PANEL_MIN_WIDTH = 200;
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
${extractFunction('dashReadSheetTileMode')}
${extractFunction('dashSetSheetTileModeButtonState')}
${extractFunction('dashMeasureSheetTilePanelMinWidth')}
${extractFunction('dashApplySheetTilePanelMinWidth')}
${extractFunction('dashPrepareSheetTileMode')}
${extractFunction('dashClearSheetTileMode')}
${extractFunction('dashEnsureSheetTilePanelResizeHandles')}
${extractFunction('dashApplySheetTileMode')}
${extractFunction('dashInitSheetTileMode')}
${extractFunction('dashToggleSheetTileMode')}
${extractFunction('dashEnsureTilePanelResizeHandle')}
${extractFunction('dashStartTilePanelResize')}
`;

const doc = createCookieDocument();
const ctx = {
    console,
    document: doc,
    window: { innerWidth: 1400, innerHeight: 900 }
};
vm.createContext(ctx);
vm.runInContext(code, ctx);

const button = makeButton('button');
const { sheet, panels } = makeSheet('ds-resize', [400, 400, 400], button);
const widthCookie = ctx.dashSheetTilePanelWidthCookieName(sheet);

// Enabling tile mode adds the resize handle to every panel
ctx.dashApplySheetTileMode(sheet, true, true);
panels.forEach((panel, idx) => {
    assert(panel.appendedHandle, `panel ${idx} receives a tile resize handle`);
    assert.strictEqual(panel.appendedHandle.className, 'f-tile-resize-handle',
        `panel ${idx} handle has the correct class`);
});

// No saved width yet
assert(!doc.hasCookie(widthCookie), 'no width cookie before any drag');

// Simulate a drag right by 120 pixels on the first panel handle
const handle = panels[0].appendedHandle;
const targetWidth = 520; // 400 + 120

let lastDownEvent;
handle.dispatch('mousedown', {
    button: 0,
    clientX: 800,
    currentTarget: handle,
    target: handle,
    preventDefault() { lastDownEvent = true; }
});

assert(sheet.classList.contains('f-sheet--tile-resizing'),
    'sheet gets a resizing class while drag is in progress');
assert(doc.body.classList.contains('dash-tile-resizing'),
    'document body gets a resizing class while drag is in progress');

doc.dispatch('mousemove', {
    clientX: 800 + 120,
    preventDefault() {}
});

assert.strictEqual(sheet.style.getPropertyValue('--dash-tile-panel-min-width'), targetWidth + 'px',
    'mid-drag updates the sheet column width to the new pixel value');

doc.dispatch('mouseup', { preventDefault() {} });

assert(!sheet.classList.contains('f-sheet--tile-resizing'),
    'sheet drops the resizing class on mouse up');
assert(!doc.body.classList.contains('dash-tile-resizing'),
    'body drops the resizing class on mouse up');
assert.strictEqual(doc.getCookie(widthCookie), String(targetWidth),
    'final tile width is persisted to a cookie');

// Re-entering tile mode (same dashboard) restores the saved width
const restoredButton = makeButton('button');
const { sheet: restored, panels: restoredPanels } = makeSheet('ds-resize', [400], restoredButton);
ctx.dashApplySheetTileMode(restored, true, false);
assert.strictEqual(restored.style.getPropertyValue('--dash-tile-panel-min-width'), targetWidth + 'px',
    'restored tile mode reads the saved width from the cookie instead of measuring panels');
assert(restoredPanels[0].appendedHandle, 'restored tile mode also gets handles');

// Disabling tile mode removes the saved width cookie
ctx.dashApplySheetTileMode(restored, false, true);
assert(!doc.hasCookie(widthCookie),
    'turning off tile mode resets the saved tile width');
assert.strictEqual(restored.style.getPropertyValue('--dash-tile-panel-min-width'), '',
    'turning off tile mode clears the inline custom property');

console.log('issue-2386 dashboard tile mode resize: ok');
