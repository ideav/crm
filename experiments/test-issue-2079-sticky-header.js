/**
 * Experiment: verify the sticky header fix for issue #2079
 * 
 * The root problem: .integram-table-container has overflow-x: auto, which causes
 * the browser to treat overflow-y as auto too (CSS spec). This makes it a scroll
 * container, scoping position:sticky on <th> to it (instead of .app-content).
 * 
 * Fix: overflow-y: clip on .integram-table-container (clip doesn't create a scroll container)
 * + JS to compute filter row td top dynamically.
 *
 * This test validates the JS logic for updateFilterRowStickyTop.
 */

// Mock DOM environment
const { JSDOM } = require('jsdom');

const dom = new JSDOM(`
<!DOCTYPE html>
<html>
<body>
<div id="container">
  <div class="integram-table-container">
    <table class="integram-table">
      <thead>
        <tr><th style="height:40px;">Col A</th><th>Col B</th></tr>
        <tr class="filter-row"><td>filter A</td><td>filter B</td></tr>
      </thead>
      <tbody>
        <tr><td>data</td><td>data</td></tr>
      </tbody>
    </table>
  </div>
</div>
</body>
</html>
`, { pretendToBeVisual: true });

// JSDOM doesn't implement getBoundingClientRect fully but we can mock it
const { document } = dom.window;

// Mock getBoundingClientRect to return the right height for the header row
const theadRows = document.querySelectorAll('thead tr');
const headerRow = theadRows[0];
const filterRow = theadRows[1];

// Mock the header row height
headerRow.getBoundingClientRect = () => ({ height: 40, top: 0, bottom: 40 });
filterRow.getBoundingClientRect = () => ({ height: 36, top: 40, bottom: 76 });

// Simulate updateFilterRowStickyTop logic
function updateFilterRowStickyTop(container) {
    const thead = container.querySelector('.integram-table thead');
    if (!thead) return;
    const filterRow = thead.querySelector('.filter-row');
    if (!filterRow) return;

    let headerHeight = 0;
    const rows = thead.querySelectorAll('tr');
    for (const row of rows) {
        if (row === filterRow) break;
        headerHeight += row.getBoundingClientRect().height;
    }

    filterRow.querySelectorAll('td').forEach(td => {
        td.style.top = headerHeight + 'px';
    });
}

const container = document.getElementById('container');
updateFilterRowStickyTop(container);

// Verify
const filterTds = filterRow.querySelectorAll('td');
let allCorrect = true;
filterTds.forEach((td, i) => {
    const expected = '40px';
    if (td.style.top !== expected) {
        console.error(`FAIL: td[${i}].style.top = '${td.style.top}', expected '${expected}'`);
        allCorrect = false;
    }
});

if (allCorrect) {
    console.log('PASS: All filter row tds have correct sticky top offset (40px)');
}

// Test with no filter row (should not throw)
const dom2 = new JSDOM(`
<!DOCTYPE html>
<body>
<div id="c2"><div><table class="integram-table">
  <thead><tr><th>Col</th></tr></thead>
  <tbody><tr><td>data</td></tr></tbody>
</table></div></div>
</body>
`);
const c2 = dom2.window.document.getElementById('c2');
try {
    updateFilterRowStickyTop(c2);
    console.log('PASS: No error when no filter row is present');
} catch (e) {
    console.error('FAIL: Threw error when no filter row:', e);
}
