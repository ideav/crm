const fs = require('fs');
const path = require('path');

const docPath = path.join(__dirname, '..', 'docs', 'integram-app-workflow.md');
const text = fs.readFileSync(docPath, 'utf8');
const kb = fs.readFileSync(path.join(__dirname, '..', 'docs', 'kb', 'crud.md'), 'utf8');

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
    // Формулировка про id записи живёт в самой таблице параметров.
    ok: text.includes('только запись с `id=<recordId>`'),
    message: 'docs must explain that F_I filters by the object record id',
  },
  {
    ok: text.includes('фильтры по колонкам или специальные параметры `F_U`/`F_I`'),
    message: 'docs must distinguish special F_I from generic F_{colId} filters',
  },
  {
    // Та же пара параметров описана в базе знаний (docs/kb/ — источник истины по API).
    ok: kb.includes('`F_I={recordId}`') && kb.includes('`F_U={parentId}`'),
    message: 'docs/kb/crud.md lists F_I and F_U object filters',
  },
];

const failures = checks.filter(check => !check.ok).map(check => `- ${check.message}`);

if (failures.length) {
  console.error('Issue #2883 documentation checks failed:\n' + failures.join('\n'));
  process.exit(1);
}

console.log('Issue #2883 object filter documentation checks passed.');
