/*
 * Guard against editing the generated bundle without updating its source modules.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const modulesDir = path.join(root, 'js', 'integram-table');
const header = '// AUTO-GENERATED — DO NOT EDIT. Edit files in js/integram-table/ and run: bash build.sh\n';

const moduleFiles = fs.readdirSync(modulesDir)
    .filter(file => file.endsWith('.js'))
    .sort();
const rebuilt = header + moduleFiles
    .map(file => fs.readFileSync(path.join(modulesDir, file), 'utf8'))
    .join('');
const generated = fs.readFileSync(path.join(root, 'js', 'integram-table.js'), 'utf8');
const normalizeNewlines = value => value.replace(/\r\n/g, '\n');

assert.strictEqual(normalizeNewlines(generated), normalizeNewlines(rebuilt),
    'js/integram-table.js must be rebuilt after changing js/integram-table/*.js');

console.log('PASS integram-table generated bundle matches source modules');
