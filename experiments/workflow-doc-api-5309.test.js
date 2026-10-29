// Issue #5309: инструкция сборщика (docs/integram-app-workflow*.md) ведёт агента по API
// страницы ideav.ru/api.html: схема — одним описанием _d_schema, данные — пакетом _m_batch
// или файлом import=1, поля — по именам (fields, NAMED). Примеры инструкции агент копирует
// как есть, поэтому каждый пример _d_schema и _m_batch проверяется на исполнимость:
// валидный JSON, только известные ядру ключи, ссылки ":idN" — на более раннюю операцию new,
// размер пакета — не больше BATCH_OPS_LIMIT ядра.
// Run with: node experiments/workflow-doc-api-5309.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const DOCS = ['docs/integram-app-workflow.md', 'docs/integram-app-workflow-short.md'];
const core = fs.readFileSync(path.join(root, 'index.php'), 'utf8');
const BATCH_OPS_LIMIT = Number((core.match(/define\("BATCH_OPS_LIMIT",\s*(\d+)\)/) || [])[1]);

const KEYS = {
  table: ['name', 'type', 'unique', 'fields', 'children'],
  field: ['name', 'type', 'ref', 'multi', 'required', 'key', 'default'],
  role: ['name', 'description', 'grants'],
  grant: ['table', 'field', 'report', 'object', 'level', 'mask', 'export', 'delete'],
  report: ['name', 'columns'],
  column: ['name', 'table', 'field', 'formula', 'func', 'hide', 'sort', 'from', 'to'],
};
const TYPES = ['SHORT', 'CHARS', 'MEMO', 'NUMBER', 'SIGNED', 'DATE', 'DATETIME', 'BOOLEAN',
  'FILE', 'STRING', 'TEXT', 'INT', 'DECIMAL', 'FLOAT', 'MONEY', 'BOOL'];

function onlyKeys(obj, kind, where) {
  for (const k of Object.keys(obj))
    assert.ok(KEYS[kind].includes(k), `${where}: ключ «${k}» не известен _d_schema (${kind})`);
}

function checkTables(list, where) {
  for (const t of list) {
    onlyKeys(t, 'table', where);
    for (const f of t.fields || []) {
      onlyKeys(f, 'field', `${where} «${t.name}»`);
      if (f.type) assert.ok(TYPES.includes(f.type), `${where}: тип ${f.type}`);
    }
    checkTables(t.children || [], where);
  }
}

function checkSchema(spec, where) {
  checkTables(spec.tables || [], where);
  for (const r of spec.reports || []) {
    onlyKeys(r, 'report', where);
    for (const c of r.columns) onlyKeys(c, 'column', where);
  }
  for (const r of spec.roles || []) {
    onlyKeys(r, 'role', where);
    for (const g of r.grants) {
      onlyKeys(g, 'grant', where);
      assert.ok(['READ', 'WRITE', 'BARRED'].includes(g.level), `${where}: level ${g.level}`);
    }
  }
}

function checkBatch(ops, where) {
  assert.ok(ops.length <= BATCH_OPS_LIMIT, `${where}: ${ops.length} > ${BATCH_OPS_LIMIT}`);
  const news = [];
  ops.forEach((op, n) => {
    assert.ok(['new', 'set', 'save', 'del'].includes(op.op), `${where}[${n}]: op ${op.op}`);
    const refs = [op.id, op.up, ...Object.values(op.fields || {})].filter((v) => /^:id\d*$/.test(v));
    for (const r of refs) {
      const idx = r === ':id' ? news.length - 1 : Number(r.slice(3));
      assert.ok(news.includes(idx), `${where}[${n}]: «${r}» — нет более ранней операции new с этим номером`);
    }
    if (op.op === 'new') news.push(n);
  });
}

for (const rel of DOCS) {
  const doc = fs.readFileSync(path.join(root, rel), 'utf8');

  test(`${rel}: ведёт по API api.html — _d_schema, _m_batch, import=1, fields, NAMED`, () => {
    for (const word of ['_d_schema', '_m_batch', 'import=1', 'fields={', 'NAMED'])
      assert.ok(doc.includes(word), `в ${rel} нет «${word}»`);
    assert.ok(doc.includes(String(BATCH_OPS_LIMIT)), `предел пакета ${BATCH_OPS_LIMIT} не назван`);
  });

  test(`${rel}: примеры _d_schema исполнимы`, () => {
    const specs = [...doc.matchAll(/json=(\{[\s\S]*?\})'/g)];
    assert.ok(specs.length >= 2, 'примеров _d_schema меньше двух');
    for (const m of specs) checkSchema(JSON.parse(m[1]), `${rel} json=`);
  });

  test(`${rel}: примеры _m_batch исполнимы`, () => {
    const batches = [...doc.matchAll(/ops=(\[[\s\S]*?\])'/g)];
    assert.ok(batches.length >= 2, 'примеров _m_batch меньше двух');
    for (const m of batches) checkBatch(JSON.parse(m[1]), `${rel} ops=`);
  });
}
