// Tests for issue #2681:
//   1. .f-first-cell and <th> cells participate in the multi-cell selection.
//   2. Stats badge (Σ / N / ⌀) skips non-data cells so a "2024" period header
//      doesn't pollute the sum.
//   3. TSV copy of the whole table walks every row, joining cells with TAB
//      and rows with newline; numeric cells get spaces stripped, text cells
//      keep their internal spaces.
//   4. Issue #2703: whole-table copy expands header colspan cells so grouped
//      month headers stay aligned with the two subcolumns below them.

let passed = 0, failed = 0;
function assert(cond, msg) {
    if (cond) { console.log('  PASS: ' + msg); passed++; }
    else { console.error('  FAIL: ' + msg); failed++; }
}

// ─── Tiny DOM stand-in ──────────────────────────────────────────────────
// Enough surface for the bits of dash.js under test.

function makeEl(tag, props) {
    var classes = (props && props.classes) || [];
    var children = [];
    var attrs = (props && props.attrs) || {};
    var text = (props && props.text) || '';
    return {
        tagName: tag.toUpperCase(),
        children: children,
        classList: {
            _set: new Set(classes),
            contains: function(c) { return this._set.has(c); },
            add: function(c) { this._set.add(c); },
            remove: function(c) { this._set.delete(c); }
        },
        textContent: text,
        _attrs: attrs,
        getAttribute: function(name) { return this._attrs[name]; },
        closest: function(sel) {
            // Walk up via _parent links until we match a tag selector
            var node = this;
            while (node) {
                if (sel === 'tr' && node.tagName === 'TR') return node;
                if (sel === 'table' && node.tagName === 'TABLE') return node;
                if (sel === '.f-panel table'
                    && node.tagName === 'TABLE'
                    && node._parent && node._parent.classList && node._parent.classList.contains('f-panel-content')
                    && node._parent._parent && node._parent._parent.classList && node._parent._parent.classList.contains('f-panel')) {
                    return node;
                }
                node = node._parent;
            }
            return null;
        }
    };
}

function appendChild(parent, child) {
    child._parent = parent;
    parent.children.push(child);
    return child;
}

// Walks .children recursively; mimics querySelectorAll('tr') without caring
// about thead/tbody nesting.
function queryAllRows(root) {
    var out = [];
    (function walk(node) {
        if (node.tagName === 'TR') out.push(node);
        node.children.forEach(walk);
    })(root);
    return out;
}

// ─── Copies of the helpers from js/dash.js (issue #2681) ────────────────

function isSelectableCell(node) {
    if (!node || !node.classList) return false;
    if (node.classList.contains('f-cell')) return true;
    if (node.classList.contains('f-first-cell')) return true;
    if (node.tagName === 'TH' && node.closest('.f-panel table')) return true;
    return false;
}

function isStatsCell(node) {
    return !!(node && node.classList && node.classList.contains('f-cell'));
}

function dashCellText(el) {
    return el && el.textContent !== undefined ? el.textContent : (el ? '' : '');
}

function stripSpaces(text) {
    return String(text).replace(/\s+/g, '');
}

function dashGetFloat(v) {
    var f = parseFloat(String(v).replace(/\s+/g, '').replace(',', '.'));
    return isNaN(f) ? NaN : f;
}

function tsvCellText(cell) {
    if (!cell) return '';
    if (isStatsCell(cell)) return stripSpaces(dashCellText(cell));
    if (cell.classList && cell.classList.contains('f-first-cell')) {
        var tr = cell.closest('tr');
        var attr = tr && tr.getAttribute && tr.getAttribute('item-name');
        if (attr) return String(attr).trim();
        return (cell.textContent || '').trim();
    }
    return (cell.textContent != null ? String(cell.textContent) : '').trim();
}

function tsvCellColSpan(cell) {
    if (!cell) return 1;
    var raw = typeof cell.colSpan === 'number'
        ? cell.colSpan
        : (cell.getAttribute && cell.getAttribute('colspan'));
    var span = parseInt(raw, 10);
    return span > 1 ? span : 1;
}

function appendTsvCell(rowCells, cell) {
    rowCells.push(tsvCellText(cell));
    for (var i = 1, span = tsvCellColSpan(cell); i < span; i++) {
        rowCells.push('');
    }
}

function buildTableTsv(table) {
    if (!table) return '';
    var rows = [];
    queryAllRows(table).forEach(function(tr) {
        var rowCells = [];
        for (var i = 0; i < tr.children.length; i++) {
            appendTsvCell(rowCells, tr.children[i]);
        }
        rows.push(rowCells.join('\t'));
    });
    return rows.join('\n');
}

// Badge stats logic — direct port of the updated forEach in updateBadge.
function statsFor(cells) {
    var sum = 0, n = 0;
    cells.forEach(function(td) {
        if (isStatsCell(td)) {
            var v = dashGetFloat(dashCellText(td));
            if (!isNaN(v)) { sum += v; n++; }
        }
    });
    return { sum: sum, n: n };
}

// ─── Fixture: a tiny dashboard panel ────────────────────────────────────
// <f-panel>
//   <f-panel-content>
//     <table>
//       <thead>
//         <tr> <th></th> <th>2024</th> <th>2025</th> </tr>
//       </thead>
//       <tbody>
//         <tr item-name="Total revenue">
//            <td.f-first-cell>id<br>Total revenue</td>
//            <td.f-cell>1 000</td>
//            <td.f-cell>2 500,5</td>
//         </tr>
//         <tr item-name="Net profit">
//            <td.f-first-cell>Net profit</td>
//            <td.f-cell>300</td>
//            <td.f-cell>-50</td>
//         </tr>
//       </tbody>
//     </table>
//   </f-panel-content>
// </f-panel>

function buildFixture() {
    var panel = makeEl('div', { classes: ['f-panel'] });
    var content = makeEl('div', { classes: ['f-panel-content'] });
    appendChild(panel, content);
    var table = makeEl('table');
    appendChild(content, table);

    var thead = makeEl('thead');
    appendChild(table, thead);
    var headTr = makeEl('tr', { classes: ['f-head'] });
    appendChild(thead, headTr);
    var th0 = appendChild(headTr, makeEl('th', { text: '' }));
    var th1 = appendChild(headTr, makeEl('th', { text: '2024' }));
    var th2 = appendChild(headTr, makeEl('th', { text: '2025' }));

    var tbody = makeEl('tbody');
    appendChild(table, tbody);

    var r1 = appendChild(tbody, makeEl('tr', { classes: ['f-item'], attrs: { 'item-name': 'Total revenue' } }));
    var r1c0 = appendChild(r1, makeEl('td', {
        classes: ['dash-first-cell', 'f-first-cell'],
        text: 'XYZ Total revenue'  // simulates show-id text leaking via textContent
    }));
    var r1c1 = appendChild(r1, makeEl('td', { classes: ['f-cell'], text: '1 000' }));
    var r1c2 = appendChild(r1, makeEl('td', { classes: ['f-cell'], text: '2 500,5' }));

    var r2 = appendChild(tbody, makeEl('tr', { classes: ['f-item'], attrs: { 'item-name': 'Net profit' } }));
    var r2c0 = appendChild(r2, makeEl('td', { classes: ['dash-first-cell', 'f-first-cell'], text: 'Net profit' }));
    var r2c1 = appendChild(r2, makeEl('td', { classes: ['f-cell'], text: '300' }));
    var r2c2 = appendChild(r2, makeEl('td', { classes: ['f-cell'], text: '-50' }));

    return {
        panel: panel, table: table,
        headers: [th0, th1, th2],
        firstCells: [r1c0, r2c0],
        dataCells: [r1c1, r1c2, r2c1, r2c2]
    };
}

// =========================================================================
// Test 1: isSelectableCell extends to f-first-cell and th.
// =========================================================================
console.log('\nTest 1: selection predicate covers headers and first column');
var fx = buildFixture();
assert(isSelectableCell(fx.dataCells[0]) === true, 'f-cell is selectable');
assert(isSelectableCell(fx.firstCells[0]) === true, 'f-first-cell is selectable');
assert(isSelectableCell(fx.headers[1]) === true, 'th inside a panel table is selectable');
var loneTh = makeEl('th', { text: 'orphan' }); // not under any panel
assert(isSelectableCell(loneTh) === false, 'orphan th outside .f-panel is not selectable');

// =========================================================================
// Test 2: Stats predicate stays narrow — only f-cell counts.
// =========================================================================
console.log('\nTest 2: only f-cell contributes to Σ / N');
assert(isStatsCell(fx.dataCells[0]) === true, 'f-cell is a stats cell');
assert(isStatsCell(fx.firstCells[0]) === false, 'f-first-cell is NOT a stats cell');
assert(isStatsCell(fx.headers[1]) === false, '<th> is NOT a stats cell');

// Mixed selection: header "2024", first cell, two data cells.
// Stats should reflect only the two data cells (1 000 + 2 500,5).
var mixed = [fx.headers[1], fx.firstCells[0], fx.dataCells[0], fx.dataCells[1]];
var stats = statsFor(mixed);
assert(stats.n === 2, 'N excludes header & first-cell: ' + stats.n);
var expectedSum = 1000 + 2500.5;
assert(Math.abs(stats.sum - expectedSum) < 1e-9,
    'Σ excludes header "2024" and label cell (got ' + stats.sum + ', expected ' + expectedSum + ')');

// =========================================================================
// Test 3: tsvCellText
//   - numeric f-cell loses its internal thousand-space
//   - f-first-cell uses item-name (no leaked row-id text)
//   - <th> keeps its text verbatim
// =========================================================================
console.log('\nTest 3: tsvCellText respects cell type');
assert(tsvCellText(fx.dataCells[0]) === '1000',
    'numeric f-cell strips spaces: ' + tsvCellText(fx.dataCells[0]));
assert(tsvCellText(fx.firstCells[0]) === 'Total revenue',
    'f-first-cell uses item-name even when textContent includes show-id: '
    + tsvCellText(fx.firstCells[0]));
assert(tsvCellText(fx.headers[1]) === '2024',
    '<th> text is preserved verbatim: ' + tsvCellText(fx.headers[1]));

// Text cell with internal spaces stays intact (regression for the bug we'd
// hit if stripSpaces ran on header text).
var spacedHeader = makeEl('th', { text: '1 квартал' });
appendChild(fx.panel.children[0].children[0].children[0], spacedHeader);
assert(tsvCellText(spacedHeader) === '1 квартал',
    'header with internal spaces is unmodified: "' + tsvCellText(spacedHeader) + '"');

// =========================================================================
// Test 4: buildTableTsv — whole-table copy
//   Expected layout:
//        \t 2024 \t 2025
//   Total revenue \t 1000 \t 2500,5
//   Net profit \t 300 \t -50
// =========================================================================
console.log('\nTest 4: buildTableTsv emits the full table as TSV');
var tsv = buildTableTsv(fx.table);
var lines = tsv.split('\n');
assert(lines.length === 3, 'three rows (header + 2 data): ' + lines.length);
assert(lines[0] === '\t2024\t2025', 'header line: ' + JSON.stringify(lines[0]));
assert(lines[1] === 'Total revenue\t1000\t2500,5',
    'first data line uses item-name and strips spaces: ' + JSON.stringify(lines[1]));
assert(lines[2] === 'Net profit\t300\t-50',
    'second data line: ' + JSON.stringify(lines[2]));

// =========================================================================
// Test 5: buildTableTsv keeps colspan headers aligned with body columns.
// =========================================================================
console.log('\nTest 5: buildTableTsv expands header colspan cells');
var colSpanFx = buildFixture();
colSpanFx.headers[1]._attrs.colspan = '2';
colSpanFx.headers[1].textContent = 'янв 26';
colSpanFx.headers[2]._attrs.colspan = '2';
colSpanFx.headers[2].textContent = 'фев 26';
appendChild(colSpanFx.firstCells[0].closest('tr'), makeEl('td', { classes: ['f-cell'], text: '10' }));
appendChild(colSpanFx.firstCells[0].closest('tr'), makeEl('td', { classes: ['f-cell'], text: '20' }));
appendChild(colSpanFx.firstCells[1].closest('tr'), makeEl('td', { classes: ['f-cell'], text: '30' }));
appendChild(colSpanFx.firstCells[1].closest('tr'), makeEl('td', { classes: ['f-cell'], text: '40' }));
var colSpanTsv = buildTableTsv(colSpanFx.table);
var colSpanLines = colSpanTsv.split('\n');
assert(colSpanLines[0] === '\tянв 26\t\tфев 26\t',
    'colspan header line includes blank covered cells: ' + JSON.stringify(colSpanLines[0]));
assert(colSpanLines[0].split('\t').length === 5,
    'colspan header line has 5 TSV columns: ' + JSON.stringify(colSpanLines[0]));
assert(colSpanLines[1].split('\t').length === colSpanLines[0].split('\t').length,
    'colspan header column count matches body row: '
    + colSpanLines[0].split('\t').length + ' vs ' + colSpanLines[1].split('\t').length);

// =========================================================================
// Test 6: buildTableTsv on null / missing table is harmless.
// =========================================================================
console.log('\nTest 6: buildTableTsv handles a missing table');
assert(buildTableTsv(null) === '', 'null table -> empty string');
assert(buildTableTsv(undefined) === '', 'undefined table -> empty string');

console.log('\n=== Summary ===');
console.log('Passed: ' + passed);
console.log('Failed: ' + failed);
process.exit(failed === 0 ? 0 : 1);
