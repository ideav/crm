const fs = require('fs');
const path = require('path');

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

const repoRoot = path.join(__dirname, '..');
const builtJsPath = path.join(repoRoot, 'js', 'integram-table.js');
const sourceEditPath = path.join(repoRoot, 'js', 'integram-table', '19-form-edit.js');
const sourceCreatePath = path.join(repoRoot, 'js', 'integram-table', '25-create-form-helper.js');
const cssPath = path.join(repoRoot, 'css', 'integram-table.css');

const builtJs = fs.readFileSync(builtJsPath, 'utf8');
const sourceEdit = fs.readFileSync(sourceEditPath, 'utf8');
const sourceCreate = fs.readFileSync(sourceCreatePath, 'utf8');
const css = fs.readFileSync(cssPath, 'utf8');

// 1. Refresh button markup is in both render functions (edit form + standalone)
const refreshButtonMarkup = '<button type="button" class="subordinate-refresh-btn" title="Обновить"><i class="pi pi-refresh"></i></button>';
assert(
    sourceEdit.includes(refreshButtonMarkup),
    'edit-form render should include refresh button markup'
);
assert(
    sourceCreate.includes(refreshButtonMarkup),
    'standalone render should include refresh button markup'
);

// Built artifact should match (build.sh concatenates the modules)
const refreshButtonOccurrences = (builtJs.match(/subordinate-refresh-btn/g) || []).length;
assert(
    refreshButtonOccurrences >= 4,
    'built integram-table.js should reference subordinate-refresh-btn at least 4 times (2 markup + 2 handlers), got: ' + refreshButtonOccurrences
);

// 2. Click handlers call the appropriate refresh function
assert(
    /refreshBtn\.addEventListener\('click',\s*\(\)\s*=>\s*\{\s*this\.loadSubordinateTable\(container,\s*arrId,\s*parentRecordId\)/.test(sourceEdit),
    'edit-form refresh handler should call loadSubordinateTable(container, arrId, parentRecordId)'
);
assert(
    /refreshBtn\.addEventListener\('click',\s*\(\)\s*=>\s*\{\s*this\.loadSubordinateTableStandalone\(container,\s*arrId,\s*parentRecordId\)/.test(sourceCreate),
    'standalone refresh handler should call loadSubordinateTableStandalone(container, arrId, parentRecordId)'
);

// 3. Refresh button uses the unified .subordinate-table-actions color scheme (issue #2570 reuse)
const groupedSelector = '.subordinate-table-actions .subordinate-refresh-btn,';
assert(
    css.includes(groupedSelector),
    'CSS should include .subordinate-refresh-btn in the grouped .subordinate-table-actions color rule'
);

const groupedHoverSelector = '.subordinate-table-actions .subordinate-refresh-btn:hover,';
assert(
    css.includes(groupedHoverSelector),
    'CSS should include .subordinate-refresh-btn:hover in the grouped .subordinate-table-actions hover rule'
);

// 4. Base style for the refresh button mirrors the copy-buffer button
const refreshBaseIdx = css.indexOf('.subordinate-refresh-btn {');
assert(refreshBaseIdx > 0, 'CSS should define a .subordinate-refresh-btn base rule');
const refreshBaseBlock = css.slice(refreshBaseIdx, css.indexOf('}', refreshBaseIdx));
assert(refreshBaseBlock.includes('background: none'), 'refresh button should have transparent background');
assert(refreshBaseBlock.includes('border: none'), 'refresh button should have no border');
assert(refreshBaseBlock.includes('cursor: pointer'), 'refresh button should have pointer cursor');

console.log('issue 2574 subordinate refresh button checks passed');
