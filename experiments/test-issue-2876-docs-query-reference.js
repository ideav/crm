const fs = require('fs');
const path = require('path');

const docPath = path.join(__dirname, '..', 'docs', 'integram-app-workflow.md');
const text = fs.readFileSync(docPath, 'utf8');

const expectations = [
  ['JSON_DATA format is documented', '?JSON_DATA'],
  ['visible column limit is documented', '61 видим'],
  ['master table algorithm is documented', 'мастер-таблица'],
  ['Reference to us join branch is documented', 'Reference to us'],
  ['We are an Array join branch is documented', 'We are an Array'],
  ['We have a Reference join branch is documented', 'We have a Reference'],
  ['We got an Array join branch is documented', 'We got an Array'],
  ['FR_/TO_ filters are tied to t100', '`t100`'],
  ['internal report alias t58 is distinguished', '`t58`'],
  ['Abn_ID function is documented', 'Abn_ID'],
  ['JSON_ARRAYAGG aggregate is documented', 'JSON_ARRAYAGG'],
  ['runtime placeholder ROLE_ID is documented', '[ROLE_ID]'],
  ['issue SQL example is documented', "SELECT a18.val as 'Пользователь'"],
  ['permissions example columns are documented', 'Пользователь, Роль, Объекты, Описание'],
];

const missing = expectations
  .filter(([, needle]) => !text.includes(needle))
  .map(([label, needle]) => `- ${label}: ${needle}`);

if (missing.length) {
  console.error('Missing report-query documentation details:\n' + missing.join('\n'));
  process.exit(1);
}

console.log('Issue #2876 report-query documentation checks passed.');
