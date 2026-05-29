const fs = require('fs');
const path = require('path');

const docPath = path.join(__dirname, '..', 'docs', 'integram-app-workflow.md');
const text = fs.readFileSync(docPath, 'utf8');

const checks = [
  {
    ok: !text.includes('`F_T={typeId}`'),
    message: 'docs must not advertise unsupported F_T object filter',
  },
  {
    ok: text.includes('`F_I={recordId}`'),
    message: 'docs must list F_I as a useful object filter',
  },
  {
    ok: text.includes('vals.id'),
    message: 'docs must explain that F_I filters by the object record id',
  },
  {
    ok: text.includes('`F_I` не является `F_{colId}`'),
    message: 'docs must distinguish special F_I from generic F_{colId} filters',
  },
];

const failures = checks.filter(check => !check.ok).map(check => `- ${check.message}`);

if (failures.length) {
  console.error('Issue #2883 documentation checks failed:\n' + failures.join('\n'));
  process.exit(1);
}

console.log('Issue #2883 object filter documentation checks passed.');
