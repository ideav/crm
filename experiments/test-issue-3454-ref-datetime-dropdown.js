/**
 * Regression test for issue #3454.
 *
 * The dropdown LIST of references to a справочник whose main value is DATETIME
 * must show formatted dates, not raw Unix timestamps. Issue #3211 fixed the table
 * CELL; #3454 covers the option list (inline edit / form / filter dropdowns).
 *
 * A reference column/req to a DATETIME table carries type='4'
 * (normalizeFormat → 'DATETIME'); _ref_reqs returns the label as a Unix stamp.
 * formatReferenceOptionLabel formats it ONLY for DATETIME refs (no false positives
 * for NUMBER/SHORT справочники), and renderReferenceOptions keeps the record id.
 */

process.env.TZ = 'UTC';

const IntegramTable = require('../js/integram-table.js');

global.window = { location: { pathname: '/crm/table/1078' }, INTEGRAM_DEBUG: false };

const table = Object.create(IntegramTable.prototype);
Object.assign(table, { columns: [], data: [] });

let passed = 0;
function assert(condition, message) {
    if (!condition) {
        console.error(`FAIL: ${message}`);
        process.exit(1);
    }
    passed++;
    console.log(`PASS: ${message}`);
}

const stamp = '1772312400';
const expectedDate = table.formatDateTimeDisplay(table.parseDDMMYYYYHHMMSS(stamp));

// ── formatReferenceOptionLabel: gated on DATETIME ref type (type='4') ──
assert(table.formatReferenceOptionLabel(stamp, { type: '4' }) === expectedDate,
    'DATETIME ref (type=4): stamp formatted as date');
assert(table.formatReferenceOptionLabel(stamp, { type: '13' }) === stamp,
    'NUMBER ref (type=13): stamp left untouched (no false positive)');
assert(table.formatReferenceOptionLabel(stamp, { type: '3' }) === stamp,
    'SHORT ref (type=3): value left untouched');
assert(table.formatReferenceOptionLabel('Иванов', { type: '4' }) === 'Иванов',
    'non-numeric label left untouched even for DATETIME ref');
assert(table.formatReferenceOptionLabel(stamp, null) === stamp,
    'no column → untouched');
assert(table.formatReferenceOptionLabel(expectedDate, { type: '4' }) === expectedDate,
    'already-formatted date is idempotent (not re-parsed)');

// ── renderReferenceOptions (inline-edit dropdown list): DATETIME column ──
const dtHtml = table.renderReferenceOptions([['23077', stamp]], '', { type: '4' });
assert(dtHtml.includes(`data-id="23077"`), 'inline-edit: option keeps record id');
assert(dtHtml.includes(`>${expectedDate}</div>`), 'inline-edit: DATETIME label rendered as date');
assert(!dtHtml.includes(`>${stamp}</div>`), 'inline-edit: raw stamp not shown as label');

// ── renderReferenceOptions: NUMBER ref column — labels untouched ──
const numHtml = table.renderReferenceOptions([['5', stamp]], '', { type: '13' });
assert(numHtml.includes(`>${stamp}</div>`), 'inline-edit: NUMBER ref label shown as raw value');

// ── renderReferenceOptions: no column (legacy callers) — untouched ──
const legacyHtml = table.renderReferenceOptions([['5', stamp]], '');
assert(legacyHtml.includes(`>${stamp}</div>`), 'inline-edit: no column → label unchanged');

console.log(`\n${passed} assertions passed`);
