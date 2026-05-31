// Regression guard for issue #3017.
//
// The SQL-building section must describe Integram storage as IDEAV in practical
// terms: one physical table, record id, structural fields, and indexes. Avoid
// calling the section a plain EAV model; that wording hides the id/index parts
// that make the implementation usable at scale.
//
// Run with: node experiments/issue-3017-ideav-wording.test.js

const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..');
const docPath = path.join(repoRoot, 'docs', 'integram-app-workflow.md');
const doc = fs.readFileSync(docPath, 'utf8');
const heading = '### Как ядро строит SQL из колонок запроса';

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

const headingOffset = doc.indexOf(heading);
assert(headingOffset !== -1, `Heading not found: ${heading}`);

const afterHeading = doc.slice(headingOffset + heading.length);
const nextHeadingOffset = afterHeading.search(/\n###\s/u);
const section = nextHeadingOffset === -1
    ? afterHeading
    : afterHeading.slice(0, nextHeadingOffset);

assert(!section.includes('это EAV-модель'), 'Section still calls the storage "это EAV-модель".');
assert(!/\bEAV\b/u.test(section), 'Section still uses standalone EAV wording.');
assert(section.includes('IDEAV'), 'Section must name IDEAV.');

for (const field of ['`id`', '`t`', '`up`', '`val`']) {
    assert(section.includes(field), `Section must mention ${field}.`);
}

assert(/индекс/iu.test(section), 'Section must mention indexes.');

console.log('OK: issue #3017 IDEAV wording is present and plain EAV wording is absent.');
