'use strict';

// Issue #2407: dragging the vertical separator in tile mode must affect the
// individual column track of the dragged tile, not all tiles uniformly.
// Narrowing the dragged column gives the freed horizontal space to the rest
// of the row, so additional auto-fit columns may appear and tiles from later
// rows can flow up — exactly the layout behaviour that was originally meant
// for tile mode.

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('js/dash.js', 'utf8');

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

function createDocument() {
    const jar = {};
    const listeners = {};
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
        getCookie(name) { return jar[name]; },
        body: { classList: makeClassList('') },
        createElement(tag) { return makeButton(tag); },
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

function makePanel(width, left) {
    let appendedHandle = null;
    const panelLeft = typeof left === 'number' ? left : 0;
    const panel = {
        getBoundingClientRect() {
            return { width, height: 200, top: 0, left: panelLeft, right: panelLeft + width, bottom: 200 };
        },
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

function makeSheet(id, panelWidths, button, opts) {
    const options = opts || {};
    const sheetWidth = options.sheetWidth || 1200;
    const gap = options.gap || 0;
    let cursor = 0;
    const panels = panelWidths.map(width => {
        const panel = makePanel(width, cursor);
        cursor += width + gap;
        return panel;
    });
    const trackTokens = options.tracks || panelWidths.map(w => w + 'px');
    const sheet = {
        id,
        style: makeStyle(),
        classList: makeClassList('f-sheet'),
        getBoundingClientRect() { return { width: sheetWidth, height: 800, top: 0, left: 0 }; },
        querySelector(selector) {
            if (selector === '.dash-tile-mode-icon') return button;
            return null;
        },
        querySelectorAll(selector) {
            if (selector === '.f-panel') return panels;
            return [];
        },
        _trackTokens: trackTokens,
        _gap: gap
    };
    panels.forEach(p => { p._sheet = sheet; });
    return { sheet, panels };
}

const code = `
var DASH_CHART_RESIZE_COOKIE_MAX_AGE = 31536000;
var DASH_TILE_PANEL_MIN_WIDTH = 200;
var dashRecordId = 'dash-2407';
var dashCurrentId = null;
function dashScheduleVisibleVizRefresh() {}
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
${extractFunction('dashGetSheetGap')}
${extractFunction('dashGetSheetResolvedColumnTracks')}
${extractFunction('dashFindPanelColumnIndex')}
${extractFunction('dashPrepareSheetTileMode')}
${extractFunction('dashClearSheetTileMode')}
${extractFunction('dashEnsureSheetTilePanelResizeHandles')}
${extractFunction('dashApplySheetTileMode')}
${extractFunction('dashInitSheetTileMode')}
${extractFunction('dashToggleSheetTileMode')}
${extractFunction('dashEnsureTilePanelResizeHandle')}
${extractFunction('dashStartTilePanelResize')}
`;

const doc = createDocument();
const ctx = {
    console,
    document: doc,
    window: {
        innerWidth: 1400,
        innerHeight: 900,
        getComputedStyle(el) {
            const tracks = (el && el._trackTokens) || [];
            const gap = (el && el._gap) || 0;
            return {
                gridTemplateColumns: tracks.join(' '),
                columnGap: gap + 'px',
                gap: gap + 'px'
            };
        }
    }
};
vm.createContext(ctx);
vm.runInContext(code, ctx);

// Scenario from the issue: 2 rows × 2 tiles, equal width.
// Sheet width 1200 → two columns of 600 each.
const button = makeButton('button');
const layout = makeSheet('ds-2x2', [600, 600, 600, 600], button,
    { sheetWidth: 1200, tracks: ['600px', '600px'] });
const sheet = layout.sheet;
const panels = layout.panels;
const widthsCookieName = ctx.dashSheetTilePanelWidthsCookieName(sheet);
const legacyCookieName = ctx.dashSheetTilePanelWidthCookieName(sheet);

ctx.dashApplySheetTileMode(sheet, true, true);

// Dragging the vertical separator on the FIRST tile to the LEFT must shrink
// only that column track. The remaining auto-fit space grows enough to host
// a third column, which is what allows the second-row tiles to flow up.
const firstHandle = panels[0].appendedHandle;
assert(firstHandle, 'first panel receives a tile resize handle');

firstHandle.dispatch('mousedown', {
    button: 0,
    clientX: 600, // right edge of first column
    currentTarget: firstHandle,
    target: firstHandle,
    preventDefault() {}
});

doc.dispatch('mousemove', {
    clientX: 600 - 200, // drag the separator 200px to the left
    preventDefault() {}
});

const midDrag = sheet.style.getPropertyValue('grid-template-columns');
assert(midDrag.indexOf('400px') === 0,
    'first column track is pinned to the new (smaller) width: ' + midDrag);
assert(/repeat\(auto-fit, minmax\(/.test(midDrag),
    'remaining tracks fall through the auto-fit pattern to absorb the freed space: ' + midDrag);
assert(midDrag.indexOf('600px') === -1,
    'other column tracks are not pinned; they keep flowing as auto-fit so tiles can reflow');

doc.dispatch('mouseup', { preventDefault() {} });

const persisted = ctx.dashCookieGet(widthsCookieName);
assert(persisted, 'per-column widths cookie is written on mouse up: ' + persisted);
assert.strictEqual(persisted.split(',').length, 1,
    'only the dragged column is persisted; the rest still auto-fits: ' + persisted);
assert.strictEqual(persisted, '400',
    'persisted value matches the dragged column track: ' + persisted);

// Re-entering tile mode reapplies the per-column widths and uses auto-fit
// for everything to the right.
const restoreLayout = makeSheet('ds-2x2', [400, 400, 400], makeButton('button'),
    { sheetWidth: 1200, tracks: ['400px', '400px', '400px'] });
ctx.dashApplySheetTileMode(restoreLayout.sheet, true, false);
const restoredColumns = restoreLayout.sheet.style.getPropertyValue('grid-template-columns');
assert(restoredColumns.indexOf('400px') === 0,
    'restored tile mode pins the previously saved first column: ' + restoredColumns);
assert(/repeat\(auto-fit/.test(restoredColumns),
    'restored tile mode keeps auto-fit on the remaining tracks: ' + restoredColumns);

// Drag a MIDDLE column. With pinned width 400 in column 0 and auto-fit columns
// to the right, dragging the column-1 panel adjusts its track only.
const middleHandle = restoreLayout.panels[1].appendedHandle;
assert(middleHandle, 'middle panel receives a tile resize handle');

middleHandle.dispatch('mousedown', {
    button: 0,
    clientX: 800, // right edge of the middle (column 1) panel at left=400, width=400
    currentTarget: middleHandle,
    target: middleHandle,
    preventDefault() {}
});

doc.dispatch('mousemove', {
    clientX: 800 - 100,
    preventDefault() {}
});

const midDragTwo = restoreLayout.sheet.style.getPropertyValue('grid-template-columns');
assert(midDragTwo.indexOf('400px 300px') === 0,
    'two columns are pinned (column 0 unchanged, column 1 narrower): ' + midDragTwo);
assert(/repeat\(auto-fit/.test(midDragTwo),
    'columns to the right of the dragged one stay auto-fit: ' + midDragTwo);

doc.dispatch('mouseup', { preventDefault() {} });
const persistedTwo = ctx.dashCookieGet(widthsCookieName);
assert.strictEqual(persistedTwo, '400,300',
    'both pinned column widths are persisted: ' + persistedTwo);

// Disabling tile mode clears both the array cookie and the legacy single
// width cookie.
ctx.dashApplySheetTileMode(restoreLayout.sheet, false, true);
assert(!doc.hasCookie(widthsCookieName),
    'turning off tile mode resets the saved per-column widths');
assert(!doc.hasCookie(legacyCookieName),
    'turning off tile mode also clears the legacy single-width cookie');
assert.strictEqual(restoreLayout.sheet.style.getPropertyValue('grid-template-columns'), '',
    'turning off tile mode clears the inline grid-template-columns');

console.log('issue-2407 dashboard tile mode column resize: ok');
