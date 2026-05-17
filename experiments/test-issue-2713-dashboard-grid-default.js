'use strict';

// Issue #2713: dashboard grid/tile mode is no longer enabled by default.
// A sheet starts in grid mode only when the dashboard model row has a non-empty
// "Сетка" field, unless the user already has an explicit grid-mode cookie.

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
        }
    };
}

function makeSheet(id) {
    return {
        id,
        dataset: {},
        querySelector() { return null; }
    };
}

const sheetTplStart = source.indexOf(', sheetTpl');
const sheetTplEnd = source.indexOf(', panelTpl', sheetTplStart);
const sheetTpl = source.slice(sheetTplStart, sheetTplEnd);
assert(sheetTpl.includes('aria-pressed="false"'), 'tile-mode button starts unpressed');
assert(sheetTpl.includes('title="Включить режим плитки"'), 'tile-mode button starts with enable title');

const code = `
var DASH_CHART_RESIZE_COOKIE_MAX_AGE = 31536000;
var dashRecordId = 'dash-2713';
var dashCurrentId = null;
${extractFunction('dashCookieGet')}
${extractFunction('dashCookieSet')}
${extractFunction('dashCookieRemove')}
${extractFunction('dashCookieNamePart')}
${extractFunction('dashSheetTileModeCookieName')}
${extractFunction('dashSheetDefaultTileMode')}
${extractFunction('dashSheetTileModeDefaultFromValue')}
${extractFunction('dashSheetTileModeDefaultFromRow')}
${extractFunction('dashSetSheetTileModeDefault')}
${extractFunction('dashReadSheetTileMode')}
`;

const doc = createCookieDocument();
const ctx = { console, document: doc };
vm.createContext(ctx);
vm.runInContext(code, ctx);

const plainSheet = makeSheet('ds-empty');
assert.strictEqual(ctx.dashReadSheetTileMode(plainSheet), false,
    'missing cookie and empty Сетка default keeps grid mode off');

const defaultSheet = makeSheet('ds-default');
ctx.dashSetSheetTileModeDefault(defaultSheet, { 'Сетка': '1' });
assert.strictEqual(defaultSheet.dataset.defaultTileMode, '1', 'non-empty Сетка marks the sheet grid default');
assert.strictEqual(ctx.dashReadSheetTileMode(defaultSheet), true,
    'missing cookie uses the non-empty Сетка default');

const falseSheet = makeSheet('ds-false');
ctx.dashSetSheetTileModeDefault(falseSheet, { 'Сетка': '' });
assert.strictEqual(ctx.dashReadSheetTileMode(falseSheet), false,
    'empty Сетка does not enable grid mode');

const offCookieSheet = makeSheet('ds-cookie-off');
ctx.dashSetSheetTileModeDefault(offCookieSheet, { 'Сетка': '1' });
ctx.dashCookieSet(ctx.dashSheetTileModeCookieName(offCookieSheet), '0', 31536000);
assert.strictEqual(ctx.dashReadSheetTileMode(offCookieSheet), false,
    'explicit off cookie overrides the Сетка default');

const onCookieSheet = makeSheet('ds-cookie-on');
ctx.dashSetSheetTileModeDefault(onCookieSheet, { 'Сетка': '' });
ctx.dashCookieSet(ctx.dashSheetTileModeCookieName(onCookieSheet), '1', 31536000);
assert.strictEqual(ctx.dashReadSheetTileMode(onCookieSheet), true,
    'explicit on cookie overrides an empty Сетка default');

console.log('issue-2713 dashboard grid default: ok');
