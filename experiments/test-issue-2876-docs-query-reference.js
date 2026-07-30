const fs = require('fs');
const path = require('path');

// Источник истины по API — docs/kb/ (CLAUDE.md); тему «запросы/отчёты» держит docs/kb/queries.md,
// обзор цикла разработки — docs/integram-app-workflow.md. Проверяем обе.
const docPath = path.join(__dirname, '..', 'docs', 'integram-app-workflow.md');
const text = fs.readFileSync(docPath, 'utf8')
  + '\n' + fs.readFileSync(path.join(__dirname, '..', 'docs', 'kb', 'queries.md'), 'utf8')
  + '\n' + fs.readFileSync(path.join(__dirname, '..', 'docs', 'integram-reports.md'), 'utf8');

const expectations = [
  ['JSON_DATA format is documented', '?JSON_DATA'],
  ['master table algorithm is documented', 'мастер-таблица'],
  ['FR_/TO_ filters are tied to t100', '`t100`'],
  ['JSON_ARRAYAGG aggregate is documented', 'JSON_ARRAYAGG'],
];

const missing = expectations
  .filter(([, needle]) => !text.includes(needle))
  .map(([label, needle]) => `- ${label}: ${needle}`);

if (missing.length) {
  console.error('Missing report-query documentation details:\n' + missing.join('\n'));
  process.exit(1);
}

console.log('Issue #2876 report-query documentation checks passed.');
