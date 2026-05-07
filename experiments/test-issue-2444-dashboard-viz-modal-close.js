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

if (!template.includes('dash-viz-modal')) {
    throw new Error('dashboard template must include the visualization modal');
}
if (!template.includes('dash-viz-modal-box')) {
    throw new Error('dashboard template must include the visualization modal box');
}

const code = `
let dashVizModalCtx = { panelEl: { id: 'panel-1' }, panelKey: 'panel-1' };

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
        assert.strictEqual(id, 'dash-viz-modal');
        return modal;
    }
};

${extractFunction('dashVizModalIsOpen')}
${extractFunction('dashCloseVizModal')}
${extractFunction('dashHandleVizModalKeydown')}
${extractFunction('dashHandleVizModalBackdropClick')}

let prevented = false;
let stopped = false;
dashHandleVizModalKeydown({
    key: 'Escape',
    preventDefault() { prevented = true; },
    stopPropagation() { stopped = true; }
});
assert.strictEqual(modal.classList.contains('open'), false, 'Escape must close the open visualization modal');
assert.strictEqual(dashVizModalCtx, null, 'Escape must clear the visualization modal context');
assert.strictEqual(prevented, true, 'Escape close should prevent the browser default');
assert.strictEqual(stopped, true, 'Escape close should stop propagation to dashboard shortcuts');

modal = makeModal(true);
dashVizModalCtx = { panelEl: { id: 'panel-1' }, panelKey: 'panel-1' };
dashHandleVizModalKeydown({
    key: 'Enter',
    preventDefault() { throw new Error('Enter must not close the visualization modal'); },
    stopPropagation() { throw new Error('Enter must not close the visualization modal'); }
});
assert.strictEqual(modal.classList.contains('open'), true, 'non-Escape keys must leave the modal open');
assert.notStrictEqual(dashVizModalCtx, null, 'non-Escape keys must keep the modal context');

const modalBox = {};
dashHandleVizModalBackdropClick({ target: modalBox });
assert.strictEqual(modal.classList.contains('open'), true, 'clicking inside the modal box must not close it');

dashHandleVizModalBackdropClick({ target: modal });
assert.strictEqual(modal.classList.contains('open'), false, 'clicking the backdrop must close the visualization modal');
assert.strictEqual(dashVizModalCtx, null, 'backdrop click must clear the visualization modal context');
`;

vm.runInNewContext(code, { require });
console.log('issue-2444 dashboard visualization modal close: ok');
