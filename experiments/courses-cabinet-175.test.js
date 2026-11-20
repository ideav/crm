// ideav/courses#175: сводка прогресса кабинета (A.cabinetSummary в me.js) — чистое вычисление.
// Run with: node experiments/courses-cabinet-175.test.js
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const src = fs.readFileSync(path.join(__dirname, '..', 'download', 'courses', 'js', 'me.js'), 'utf8');
const A = { el: () => ({}), data: {} };
vm.runInNewContext(src, { window: { LMSApp: A, LMS: {} } });
const courses = [
  { code: 'a', title: 'A', lessons: [{ id: 'l1' }, { id: 'l2' }, { id: 'l3' }] },
  { code: 'b', title: 'B', lessons: [{ id: 'x' }] },
  { code: 'c', title: 'C', lessons: [{ id: 'y' }, { id: 'z' }] },
  { code: 'd', title: 'D', lessons: [] },
];
const done = new Set(['a/l1', 'a/l3', 'b/x']);
const s = A.cabinetSummary(courses, (c, l) => done.has(c + '/' + l), c => c === 'c');
assert.deepStrictEqual([s[0].done, s[0].total, s[0].pct, s[0].state], [2, 3, 67, 'going']);
assert.strictEqual(s[0].next.id, 'l2');
assert.strictEqual(s[0].href, '#/c/a/l2');
assert.strictEqual(s[1].state, 'finished'); assert.strictEqual(s[1].next, null); assert.strictEqual(s[1].pct, 100);
assert.strictEqual(s[2].state, 'going'); assert.strictEqual(s[2].next.id, 'y');
assert.strictEqual(A.cabinetSummary([courses[2]], () => false)[0].state, 'new');
assert.strictEqual(s[3].state, 'empty'); assert.strictEqual(s[3].pct, 0);
assert.strictEqual(A.cabinetSummary(null, () => false).length, 0);
console.log('ok');
