// Test for issue #2314: dashboard pivot table controls are collapsed by
// default, exposed by a settings button over .pvtRendererArea, and opened
// automatically for newly added pivot tables without saved options.

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

function extractFunctionIfPresent(name) {
    return source.indexOf('function ' + name + '(') === -1 ? '' : extractFunction(name);
}

function assert(condition, message) {
    if (!condition) throw new Error('FAIL: ' + message);
    console.log('PASS: ' + message);
}

function assertEqual(actual, expected, message) {
    assert(actual === expected, message + ' (expected ' + expected + ', got ' + actual + ')');
}

class TestElement {
    constructor(className) {
        this.className = className || '';
        this.children = [];
        this.parentNode = null;
        this.style = {};
        this.dataset = {};
        this.attributes = {};
        this.listeners = {};
        this.textContent = '';
        this.type = '';
        this._innerHTML = '';
        this.classList = {
            add: (...names) => {
                const classes = new Set(this.className.split(/\s+/).filter(Boolean));
                names.forEach(name => classes.add(name));
                this.className = Array.from(classes).join(' ');
            },
            remove: (...names) => {
                const remove = new Set(names);
                this.className = this.className.split(/\s+/).filter(Boolean).filter(name => !remove.has(name)).join(' ');
            },
            contains: name => this.className.split(/\s+/).filter(Boolean).indexOf(name) !== -1,
            toggle: (name, force) => {
                const shouldAdd = force === undefined ? !this.classList.contains(name) : !!force;
                if (shouldAdd) this.classList.add(name);
                else this.classList.remove(name);
                return shouldAdd;
            }
        };
    }

    appendChild(child) {
        child.parentNode = this;
        this.children.push(child);
        return child;
    }

    addEventListener(eventName, handler) {
        this.listeners[eventName] = this.listeners[eventName] || [];
        this.listeners[eventName].push(handler);
    }

    click() {
        (this.listeners.click || []).forEach(handler => handler({
            preventDefault() {},
            stopPropagation() {},
            target: this,
            currentTarget: this
        }));
    }

    setAttribute(name, value) {
        this.attributes[name] = String(value);
    }

    getAttribute(name) {
        return this.attributes[name] || null;
    }

    set innerHTML(value) {
        this._innerHTML = String(value || '');
        if (!this._innerHTML) {
            this.children.forEach(child => { child.parentNode = null; });
            this.children = [];
        }
    }

    get innerHTML() {
        return this._innerHTML;
    }

    matches(selector) {
        if (selector.charAt(0) === '.')
            return this.classList.contains(selector.slice(1));
        return String(this.tagName || '').toLowerCase() === selector.toLowerCase();
    }

    querySelector(selector) {
        return this.querySelectorAll(selector)[0] || null;
    }

    querySelectorAll(selector) {
        const results = [];
        function walk(node) {
            node.children.forEach(child => {
                if (child.matches(selector)) results.push(child);
                walk(child);
            });
        }
        walk(this);
        return results;
    }

    closest(selector) {
        let node = this;
        while (node) {
            if (node.matches && node.matches(selector)) return node;
            node = node.parentNode;
        }
        return null;
    }
}

function createElement(tagName, className) {
    const el = new TestElement(className || '');
    el.tagName = tagName;
    return el;
}

function makePanel(withSettingsIcon) {
    const panel = createElement('div', 'f-panel');
    panel.id = 'fp42';
    panel.dataset.panelId = '42';
    const pivotWrap = createElement('div', 'f-pivot-wrap');
    panel.appendChild(pivotWrap);
    if (withSettingsIcon) panel.appendChild(createElement('a', 'f-panel-settings-icon'));
    return { panel, pivotWrap };
}

function appendPivotUi(el) {
    el.innerHTML = '';
    const table = createElement('table', 'pvtUi');
    const controlRow = createElement('tr', 'dash-test-control-row');
    const unusedCell = createElement('td', 'pvtAxisContainer pvtUnused');
    const rendererRow = createElement('tr', 'dash-test-renderer-row');
    const rowCell = createElement('td', 'pvtAxisContainer pvtRows');
    const rendererArea = createElement('td', 'pvtRendererArea');

    controlRow.appendChild(unusedCell);
    rendererRow.appendChild(rowCell);
    rendererRow.appendChild(rendererArea);
    table.appendChild(controlRow);
    table.appendChild(rendererRow);
    el.appendChild(table);
    return { rendererArea, rendererRow };
}

function makeJQuery() {
    const calls = [];
    function jQuery(el) {
        return {
            pivotUI(records, options) {
                calls.push({ el, records, options });
                appendPivotUi(el);
                el._pivotUIOptions = Object.assign({}, options);
                if (options.onRefresh) options.onRefresh(el._pivotUIOptions);
            },
            data(name) {
                return name === 'pivotUIOptions' ? el._pivotUIOptions : undefined;
            }
        };
    }
    jQuery.fn = { pivotUI() {}, sortable() {} };
    jQuery.calls = calls;
    return jQuery;
}

const code = `
var dashModelData = {
    fp42: {
        panelID: '42',
        settings: [
            { type: 'pivot', default: true, fieldMap: { pivotRows: 'Строка', pivotVals: 'План' } }
        ]
    }
};
function dashPivotDepsReady() { return true; }
function dashEnsurePivotJs(cb) { cb(); }
function dashSetStatus() {}
function dashPanelGetVizReportData() { return null; }
function dashReportColumnByField() { return null; }
function dashReportDefaultColumn() { return null; }
function dashReportColumnIsDimension() { return true; }
function dashReportColumnIsMeasure() { return true; }
function newApi() {}
${extractFunctionIfPresent('dashGetPivotUiElement')}
${extractFunctionIfPresent('dashEnsurePivotShell')}
${extractFunctionIfPresent('dashNormalizePivotConfig')}
${extractFunctionIfPresent('dashPivotConfigString')}
${extractFunctionIfPresent('dashDefaultPivotConfig')}
${extractFunctionIfPresent('dashPivotConfigForRender')}
${extractFunctionIfPresent('dashPanelCanSaveVizSettings')}
${extractFunctionIfPresent('dashReadPivotControlsState')}
${extractFunctionIfPresent('dashSetPivotControlsVisible')}
${extractFunctionIfPresent('dashPivotHasConfiguredOptions')}
${extractFunctionIfPresent('dashPivotControlsAutoOpened')}
${extractFunctionIfPresent('dashSetPivotControlsAutoOpened')}
${extractFunctionIfPresent('dashShouldAutoOpenPivotControls')}
${extractFunctionIfPresent('dashMarkPivotRendererArea')}
${extractFunctionIfPresent('dashEnsurePivotSettingsToggle')}
${extractFunctionIfPresent('dashRefreshPivotControls')}
${extractFunctionIfPresent('dashEnsurePivotSaveButton')}
${extractFunctionIfPresent('dashSetPivotSaveButtonDirty')}
${extractFunctionIfPresent('dashCurrentPivotConfig')}
${extractFunctionIfPresent('dashSetPivotSavedConfig')}
${extractFunctionIfPresent('dashGetPivotSavedConfig')}
${extractFunctionIfPresent('dashMergePivotConfigIntoSettings')}
${extractFunctionIfPresent('dashSaveCurrentPivotSettings')}
${extractFunction('dashRenderPivot')}
`;

const ctx = {
    console,
    document: { createElement },
    window: { jQuery: makeJQuery() }
};
vm.createContext(ctx);
vm.runInContext(code, ctx);

{
    const { panel, pivotWrap } = makePanel(false);
    ctx.dashRenderPivot(
        panel,
        pivotWrap,
        { labels: ['Январь'], datasets: [{ label: 'План', data: [7] }] },
        { pivotRows: 'Строка', pivotVals: 'План' },
        { type: 'pivot', fieldMap: { pivotRows: 'Строка', pivotVals: 'План' } }
    );

    const uiWrap = pivotWrap.querySelector('.dash-pivot-ui');
    const rendererArea = pivotWrap.querySelector('.pvtRendererArea');
    const toggle = rendererArea && rendererArea.querySelector('.dash-pivot-settings-toggle');
    assert(toggle, 'pivot settings button is rendered inside .pvtRendererArea for every user');
    assert(uiWrap.classList.contains('dash-pivot-controls-collapsed'), 'configured pivot controls are collapsed by default');
    assert(!uiWrap.classList.contains('dash-pivot-controls-open'), 'configured pivot controls are not open initially');
    assert(rendererArea.closest('tr').classList.contains('dash-pivot-renderer-row'), 'renderer row is marked for CSS-only view');
    assertEqual(toggle.getAttribute('aria-expanded'), 'false', 'collapsed toggle exposes aria-expanded=false');

    toggle.click();
    assert(uiWrap.classList.contains('dash-pivot-controls-open'), 'clicking settings opens pivot controls');
    assertEqual(toggle.getAttribute('aria-expanded'), 'true', 'opened toggle exposes aria-expanded=true');
}

{
    const { panel, pivotWrap } = makePanel(false);
    ctx.dashRenderPivot(
        panel,
        pivotWrap,
        { labels: ['Январь'], datasets: [{ label: 'План', data: [7] }] },
        {},
        { type: 'pivot', fieldMap: {} }
    );

    const uiWrap = pivotWrap.querySelector('.dash-pivot-ui');
    const toggle = pivotWrap.querySelector('.dash-pivot-settings-toggle');
    assert(toggle, 'unconfigured pivot still renders settings button');
    assert(uiWrap.classList.contains('dash-pivot-controls-open'), 'unconfigured pivot auto-opens controls for initial setup');
    assertEqual(toggle.getAttribute('aria-expanded'), 'true', 'auto-opened toggle exposes aria-expanded=true');

    toggle.click();
    assert(uiWrap.classList.contains('dash-pivot-controls-collapsed'), 'user can close auto-opened pivot controls');

    ctx.dashRenderPivot(
        panel,
        pivotWrap,
        { labels: ['Февраль'], datasets: [{ label: 'План', data: [9] }] },
        {},
        { type: 'pivot', fieldMap: {} }
    );
    assert(pivotWrap.querySelector('.dash-pivot-ui').classList.contains('dash-pivot-controls-collapsed'), 'auto-open happens only once for the same pivot table');
}

console.log('\nissue-2314 dashboard pivot controls: ok');
