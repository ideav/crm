/*
 * Regression coverage for reliable column reordering.
 * Run with: node experiments/test-integram-table-column-drag.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const bundle = fs.readFileSync(path.join(root, 'js', 'integram-table.js'), 'utf8');
const render = fs.readFileSync(path.join(root, 'js', 'integram-table', '04-render-table.js'), 'utf8');
const cells = fs.readFileSync(path.join(root, 'js', 'integram-table', '06-render-cell.js'), 'utf8');
const interactions = fs.readFileSync(path.join(root, 'js', 'integram-table', '07-inline-edit.js'), 'utf8');
const settings = fs.readFileSync(path.join(root, 'js', 'integram-table', '11-column-settings.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css', 'integram-table.css'), 'utf8');

const sandbox = {
    console,
    URLSearchParams,
    location: { pathname: '/demo/table/1', search: '' },
    document: {
        getElementById: () => null,
        querySelectorAll: () => [],
        querySelector: () => null,
        addEventListener: () => {},
        readyState: 'complete'
    }
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
const result = vm.runInContext(bundle + '\n;({ IntegramTable });', sandbox, { filename: 'integram-table.js' });
const IntegramTable = result.IntegramTable;

let passed = 0;
function check(name, condition) {
    assert.ok(condition, name);
    passed++;
    console.log('PASS: ' + name);
}

function makeTable(order) {
    const originalInit = IntegramTable.prototype.init;
    IntegramTable.prototype.init = function () {};
    const table = new IntegramTable('table', {
        apiUrl: '/demo/object/1',
        instanceName: 'table'
    });
    IntegramTable.prototype.init = originalInit;
    table.columnOrder = order.slice();
    table.visibleColumns = order.slice();
    table.columns = order.map(id => ({ id, name: id.toUpperCase() }));
    table.saved = 0;
    table.rendered = 0;
    table.requests = [];
    table.saveColumnState = function () { this.saved++; };
    table.render = function () { this.rendered++; };
    table.saveColumnOrderToServer = function (id, position) {
        this.requests.push({ id, position });
    };
    return table;
}

let table = makeTable(['fixed', 'a', 'b', 'c']);
check('drop before target reports a move', table.reorderColumns('a', 'c', 'before') === true);
check('drop before target preserves intended order',
    JSON.stringify(table.columnOrder) === JSON.stringify(['fixed', 'b', 'a', 'c']));
check('drop before target persists final server position',
    JSON.stringify(table.requests) === JSON.stringify([{ id: 'a', position: 2 }]));

table = makeTable(['fixed', 'a', 'b', 'c']);
check('drop after target reports a move', table.reorderColumns('a', 'c', 'after') === true);
check('drop after target lands on the right side',
    JSON.stringify(table.columnOrder) === JSON.stringify(['fixed', 'b', 'c', 'a']));
check('drop after target persists final server position',
    JSON.stringify(table.requests) === JSON.stringify([{ id: 'a', position: 3 }]));

table = makeTable(['fixed', 'a', 'b', 'c']);
check('right-to-left drop can insert after target', table.reorderColumns('c', 'a', 'after') === true);
check('right-to-left after order is correct',
    JSON.stringify(table.columnOrder) === JSON.stringify(['fixed', 'a', 'c', 'b']));

table = makeTable(['fixed', 'a', 'b', 'c']);
check('same-position move is ignored', table.reorderColumns('a', 'b', 'before') === false);
check('same-position move has no persistence or render side effects',
    table.saved === 0 && table.rendered === 0 && table.requests.length === 0);
check('fixed first column cannot move', table.reorderColumns('fixed', 'b', 'after') === false);
check('nothing can be dropped onto the fixed first column', table.reorderColumns('b', 'fixed', 'before') === false);

table = makeTable(['fixed', 'a', 'b', 'c']);
check('near half of the adjacent right target resolves to a swap',
    table.resolveColumnDropPosition('a', 'b', 'before', table.columnOrder) === 'after');
check('near half of the adjacent left target resolves to a swap',
    table.resolveColumnDropPosition('b', 'a', 'after', table.columnOrder) === 'before');
check('non-adjacent drop keeps its preferred side',
    table.resolveColumnDropPosition('a', 'c', 'before', table.columnOrder) === 'before');
const adjacentPosition = table.resolveColumnDropPosition('a', 'b', 'before', table.columnOrder);
check('adjacent near-edge gesture swaps the two columns',
    table.reorderColumns('a', 'b', adjacentPosition) === true &&
    JSON.stringify(table.columnOrder) === JSON.stringify(['fixed', 'b', 'a', 'c']));

check('headers use a dedicated draggable button',
    render.includes('class="column-drag-handle" draggable="true"') &&
    cells.includes('class="column-drag-handle" draggable="true"'));
check('header cells themselves are no longer draggable',
    !/<th data-column-id="[^"]*" draggable="true"/.test(render + cells));
check('drop side follows the horizontal midpoint',
    interactions.includes("event.clientX >= rect.left + rect.width / 2 ? 'after' : 'before'"));
check('adjacent no-op zones are resolved in table and settings',
    interactions.includes('this.resolveColumnDropPosition(') &&
    settings.includes('this.resolveColumnDropPosition('));
check('quick drops are accepted from dragenter and dragover',
    interactions.includes("addEventListener('dragenter', updateDropTarget)") &&
    interactions.includes("addEventListener('dragover', updateDropTarget)"));
check('wide tables auto-scroll near an edge',
    interactions.includes('autoScrollColumns(event.clientX)') &&
    interactions.includes('scroller.scrollLeft += delta'));
check('touch and pen use Pointer Events',
    interactions.includes("addEventListener('pointermove'") &&
    interactions.includes("event.pointerType === 'mouse'"));
check('keyboard reordering is available in table and settings',
    interactions.includes("event.key !== 'ArrowLeft'") &&
    settings.includes("event.key !== 'ArrowUp'"));
check('visual insertion markers distinguish both sides',
    css.includes('th.drag-over-before::before') &&
    css.includes('th.drag-over-after::after') &&
    css.includes('.column-settings-item.drag-over-after::after'));
check('interactive descendants are stabilized during dragging',
    css.includes('.integram-table.column-drag-active th[data-column-id] > *') &&
    css.includes('.column-settings-list--dragging .column-settings-item > *') &&
    css.includes('.column-settings-item.dragging > .col-settings-drag-handle'));

console.log('\n' + passed + ' column drag checks passed.');
