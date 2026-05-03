'use strict';

const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('js/dash.js', 'utf8');
const template = fs.readFileSync('templates/dash.html', 'utf8');

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

if (!template.includes('dash-panel-filter-modal')) {
    throw new Error('dashboard template must include the panel filter modal');
}
if (!template.includes('dash-panel-filter-modal-box')) {
    throw new Error('dashboard template must include the panel filter modal box');
}

const code = `
let dashPanelFilterModalCtx = { panelEl: { id: 'panel-1' }, fields: [] };

const assert = require('assert');

function makeModal(open) {
    const classes = new Set(open ? ['open'] : []);
    return {
        classList: {
            contains(name) { return classes.has(name); },
            add(name) { classes.add(name); },
            remove(name) { classes.delete(name); }
        }
    };
}

let modal = makeModal(true);
const document = {
    getElementById(id) {
        assert.strictEqual(id, 'dash-panel-filter-modal');
        return modal;
    }
};

${extractFunction('dashPanelFilterModalIsOpen')}
${extractFunction('dashClosePanelFilterModal')}
${extractFunction('dashHandlePanelFilterModalKeydown')}
${extractFunction('dashHandlePanelFilterBackdropClick')}

let prevented = false;
let stopped = false;
dashHandlePanelFilterModalKeydown({
    key: 'Escape',
    preventDefault() { prevented = true; },
    stopPropagation() { stopped = true; }
});
assert.strictEqual(modal.classList.contains('open'), false, 'Escape must close the open panel filter modal');
assert.strictEqual(dashPanelFilterModalCtx, null, 'Escape must clear the panel filter modal context');
assert.strictEqual(prevented, true, 'Escape close should prevent the browser default');
assert.strictEqual(stopped, true, 'Escape close should stop propagation to dashboard shortcuts');

modal = makeModal(true);
dashPanelFilterModalCtx = { panelEl: { id: 'panel-1' }, fields: [] };
dashHandlePanelFilterModalKeydown({
    key: 'Enter',
    preventDefault() { throw new Error('Enter must not close the panel filter modal'); },
    stopPropagation() { throw new Error('Enter must not close the panel filter modal'); }
});
assert.strictEqual(modal.classList.contains('open'), true, 'non-Escape keys must leave the modal open');
assert.notStrictEqual(dashPanelFilterModalCtx, null, 'non-Escape keys must keep the modal context');

const modalBox = {};
dashHandlePanelFilterBackdropClick({ target: modalBox });
assert.strictEqual(modal.classList.contains('open'), true, 'clicking inside the modal box must not close it');

dashHandlePanelFilterBackdropClick({ target: modal });
assert.strictEqual(modal.classList.contains('open'), false, 'clicking the backdrop must close the panel filter modal');
assert.strictEqual(dashPanelFilterModalCtx, null, 'backdrop click must clear the panel filter modal context');
`;

vm.runInNewContext(code, { require });
console.log('issue-2317 dashboard panel filter close: ok');
