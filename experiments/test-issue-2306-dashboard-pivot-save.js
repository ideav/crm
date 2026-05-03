// Test for issue #2306: dashboard pivot UI changes should expose a save
// action for users who can edit panel visualization settings, and persist the
// PivotTable UI config inside panelSettings.

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
            contains: name => this.className.split(/\s+/).filter(Boolean).indexOf(name) !== -1
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
        if (!this._innerHTML) this.children = [];
    }

    get innerHTML() {
        return this._innerHTML;
    }

    matches(selector) {
        if (selector.charAt(0) === '.')
            return this.classList.contains(selector.slice(1));
        return false;
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

function makePanel(withSettingsIcon) {
    const panel = new TestElement('f-panel');
    panel.id = 'fp42';
    panel.dataset.panelId = '42';
    const pivotWrap = new TestElement('f-pivot-wrap');
    panel.appendChild(pivotWrap);
    if (withSettingsIcon) panel.appendChild(new TestElement('f-panel-settings-icon'));
    return { panel, pivotWrap };
}

function makeJQuery(callInitialRefresh = true) {
    const calls = [];
    function jQuery(el) {
        return {
            pivotUI(records, options) {
                calls.push({ el, records, options });
                el._pivotUIOptions = Object.assign({}, options);
                if (callInitialRefresh && options.onRefresh) options.onRefresh(el._pivotUIOptions);
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
            { type: 'pivot', default: true, fieldMap: { pivotRows: 'Строка', pivotVals: 'План' } },
            { type: 'line', fieldMap: { valueField: 'План' } }
        ]
    }
};
function dashPivotDepsReady() { return true; }
function dashEnsurePivotJs(cb) { cb(); }
function dashSetStatus(msg) { dashSetStatus.last = msg; }
function dashApplyNewVizSettings(panelEl, panelKey, settings) {
    dashModelData[panelKey].settings = settings;
}
${extractFunctionIfPresent('dashGetPivotUiElement')}
${extractFunctionIfPresent('dashEnsurePivotShell')}
${extractFunctionIfPresent('dashNormalizePivotConfig')}
${extractFunctionIfPresent('dashPivotConfigString')}
${extractFunctionIfPresent('dashDefaultPivotConfig')}
${extractFunctionIfPresent('dashPivotConfigForRender')}
${extractFunctionIfPresent('dashPanelCanSaveVizSettings')}
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
    document: {
        createElement(tagName) {
            const el = new TestElement('');
            el.tagName = tagName;
            return el;
        }
    },
    window: { jQuery: makeJQuery() },
    newApi(method, url, callback, params, apiCtx) {
        ctx.newApi.last = { method, url, callback, params, ctx: apiCtx };
    }
};
vm.createContext(ctx);
vm.runInContext(code, ctx);

{
    const { panel, pivotWrap } = makePanel(true);
    ctx.dashRenderPivot(
        panel,
        pivotWrap,
        { labels: ['Январь'], datasets: [{ label: 'План', data: [7] }] },
        { pivotRows: 'Строка', pivotVals: 'План' },
        { type: 'pivot', fieldMap: { pivotRows: 'Строка', pivotVals: 'План' } }
    );

    const saveBtn = pivotWrap.querySelector('.dash-pivot-save-settings');
    assert(saveBtn, 'save button is available for a panel with settings access');
    assertEqual(saveBtn.style.display, 'none', 'save button is hidden until pivot config changes');

    const pivotCall = ctx.window.jQuery.calls[0];
    pivotCall.options.onRefresh(Object.assign({}, pivotCall.options, {
        rows: ['Строка'],
        cols: [],
        vals: ['План'],
        aggregatorName: 'Sum',
        rendererName: 'Table',
        renderers: { Table: function() {} },
        aggregators: { Sum: function() {} },
        onRefresh: function() {}
    }));
    assertEqual(saveBtn.style.display, 'none', 'same pivot config keeps save button hidden');

    pivotCall.options.onRefresh(Object.assign({}, pivotCall.options, {
        rows: ['Строка'],
        cols: [],
        vals: ['План'],
        aggregatorName: 'Average',
        rendererName: 'Table',
        renderers: { Table: function() {} },
        aggregators: { Average: function() {} },
        onRefresh: function() {}
    }));
    assertEqual(saveBtn.style.display, '', 'changed pivot config shows save button');

    saveBtn.click();
    assertEqual(ctx.newApi.last.method, 'POST', 'pivot save uses POST');
    assertEqual(ctx.newApi.last.url, '_m_set/42?JSON', 'pivot save writes panel settings field');
    assert(ctx.newApi.last.params.indexOf('t1165=') === 0, 'pivot save serializes panelSettings to t1165');

    const savedSettings = JSON.parse(decodeURIComponent(ctx.newApi.last.params.replace('t1165=', '')));
    assertEqual(savedSettings.length, 2, 'saving pivot preserves other visualization settings');
    assertEqual(savedSettings[0].type, 'pivot', 'pivot entry is updated in place');
    assertEqual(savedSettings[0].pivotConfig.aggregatorName, 'Average', 'changed pivot aggregator is persisted');
    assert(!savedSettings[0].pivotConfig.renderers, 'renderer functions are stripped from persisted config');
    assert(!savedSettings[0].pivotConfig.aggregators, 'aggregator functions are stripped from persisted config');
    assert(!savedSettings[0].pivotConfig.onRefresh, 'onRefresh callback is stripped from persisted config');
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
    assert(!pivotWrap.querySelector('.dash-pivot-save-settings'), 'save button is not rendered without settings access');
}

{
    ctx.window.jQuery = makeJQuery(false);
    const { panel, pivotWrap } = makePanel(true);
    ctx.dashRenderPivot(
        panel,
        pivotWrap,
        { labels: ['Январь'], datasets: [{ label: 'План', data: [7] }] },
        {},
        { type: 'pivot', fieldMap: {} }
    );
    const saveBtn = pivotWrap.querySelector('.dash-pivot-save-settings');
    assertEqual(saveBtn.style.display, 'none', 'save button is hidden when pivotUI does not emit initial refresh');
    const pivotCall = ctx.window.jQuery.calls[0];
    pivotCall.options.onRefresh(Object.assign({}, pivotCall.options, {
        rows: ['Строка'],
        cols: [],
        vals: ['План'],
        aggregatorName: 'Average',
        rendererName: 'Table'
    }));
    assertEqual(saveBtn.style.display, '', 'first user refresh after fallback baseline shows save button');
}

console.log('\nissue-2306 dashboard pivot config save: ok');
