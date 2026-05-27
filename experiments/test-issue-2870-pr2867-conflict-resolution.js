/*
 * Test for issue #2870: resolve the conflicts from PR #2867 without
 * regressing the already-merged delete-by-filter implementation from PR #2752.
 *
 * PR #2867 added an always-visible toolbar button, but its delete flow used
 * one _m_del request per record. PR #2752 merged a safer batch endpoint.
 * This regression test documents the conflict resolution: keep the toolbar
 * affordance and keep the _m_del_batch implementation.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function readSource(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function extractMethod(source, name) {
    const re = new RegExp(`(?:^|\\n)        (async\\s+)?${name}\\s*\\([^)]*\\)\\s*\\{`);
    const match = source.match(re);
    if (!match) throw new Error(`Could not find method ${name}`);

    const start = match.index + match[0].length - 1;
    let depth = 0;
    for (let i = start; i < source.length; i++) {
        const ch = source[i];
        if (ch === '{') depth++;
        if (ch === '}') {
            depth--;
            if (depth === 0) {
                return source.slice(match.index + 1, i + 1);
            }
        }
    }
    throw new Error(`Could not find matching closing brace for ${name}`);
}

function assertIncludes(source, needle, message) {
    assert.ok(source.includes(needle), message || `Expected source to include: ${needle}`);
}

function assertNotIncludes(source, needle, message) {
    assert.ok(!source.includes(needle), message || `Expected source not to include: ${needle}`);
}

function testToolbarUsesResolvedMainlineButton() {
    const renderSource = readSource('js/integram-table/04-render-table.js');

    assertIncludes(
        renderSource,
        'this.isTableDeletable() && this.isTableWritable()',
        'delete-by-filter button should be gated by delete metadata and table writability'
    );
    assertIncludes(
        renderSource,
        'integram-table-settings-filter-delete',
        'toolbar should use the mainline icon button class'
    );
    assertIncludes(
        renderSource,
        'showFilterDeleteConfirm(event)',
        'toolbar should call the mainline confirmation flow with count preview'
    );
    assertNotIncludes(
        renderSource,
        'integram-delete-by-filter-btn',
        'conflict resolution should not reintroduce the PR #2867 button class'
    );
    assertNotIncludes(
        renderSource,
        'showDeleteByFilterConfirm(event)',
        'conflict resolution should not reintroduce the PR #2867 per-record confirmation flow'
    );
    assertNotIncludes(
        renderSource,
        'this.tableDeleteGranted && this.getDataSourceType()',
        'conflict resolution should keep the tableDeletable/isTableWritable gate'
    );

    console.log('PASS toolbar keeps the resolved mainline delete-by-filter button');
}

function testCoreUsesMainlineDeleteGrantState() {
    const coreSource = readSource('js/integram-table/01-core.js');

    assertIncludes(coreSource, 'this.tableDeletable = false');
    assertIncludes(coreSource, 'isTableDeletable()');
    assertIncludes(coreSource, 'this.tableDeletable = metadata.delete ===');
    assertIncludes(coreSource, 'this.tableDeletable = refreshedMetadata.delete ===');
    assertNotIncludes(coreSource, 'this.tableDeleteGranted');

    console.log('PASS core keeps the PR #2752 delete grant state');
}

function testFilterDeleteKeepsBatchEndpoint() {
    const bulkExportSource = readSource('js/integram-table/23-bulk-export.js');
    const methodSource = extractMethod(bulkExportSource, 'bulkDeleteByFilter');

    assertIncludes(
        methodSource,
        '_m_del_batch/${ this.objectTableId }?JSON',
        'filter delete must use the batch endpoint'
    );
    assertIncludes(
        methodSource,
        'for (let i = 0; i < records.length; i += FILTER_DELETE_CHUNK)',
        'filter delete should send sequential chunks'
    );
    assertIncludes(
        methodSource,
        'loadDataFromTableForExport(0, 1000000)',
        'filter delete should reuse the export loader so filters and page params stay consistent'
    );
    assertNotIncludes(
        methodSource,
        '_m_del/${ record.id }?JSON',
        'filter delete must not fall back to one request per record'
    );
    assertNotIncludes(
        methodSource,
        'Promise.all(records.map',
        'filter delete must not issue all record deletes in parallel'
    );
    assertNotIncludes(
        bulkExportSource,
        'async deleteByFilter()',
        'conflict resolution should not reintroduce the PR #2867 per-record method'
    );

    console.log('PASS filter delete keeps the batch endpoint conflict resolution');
}

testToolbarUsesResolvedMainlineButton();
testCoreUsesMainlineDeleteGrantState();
testFilterDeleteKeepsBatchEndpoint();
console.log('\nAll issue #2870 conflict-resolution tests passed.');
