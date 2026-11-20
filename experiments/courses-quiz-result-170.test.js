// ideav/courses#170: экран результата теста — «N из M», сдано/не сдано, разбор ошибок.
// Run with: node experiments/courses-quiz-result-170.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const src = fs.readFileSync(path.join(__dirname, '..', 'download', 'courses', 'js', 'quiz.js'), 'utf8');
const T = {};
const win = { LMSApp: { el: () => ({}), tasks: T } };
vm.runInNewContext(src, { window: win, Promise });
const sha = (s) => Promise.resolve(crypto.createHash('sha256').update(s).digest('hex'));
const h = (l, qi, k) => crypto.createHash('sha256').update(l + ':' + qi + ':' + k).digest('hex');
const qs = [0, 1, 2, 3].map((qi) => ({
    q: 'Вопрос ' + qi, explain: qi === 1 ? 'Потому что так' : '', hash: h('l1', qi, 'b'),
    options: [{ k: 'a', text: 'A' + qi }, { k: 'b', text: 'B' + qi }, { k: 'c', text: 'C' + qi }],
}));

(async () => {
    let r = await T.quizReview('l1', qs, ['b', 'b', 'b', 'b'], 0.7, sha);
    assert.strictEqual(r.n, 4); assert.ok(r.passed); assert.strictEqual(r.errors.length, 0); assert.strictEqual(r.percent, 100);
    r = await T.quizReview('l1', qs, ['b', 'a', 'b', 'c'], 0.7, sha);
    assert.strictEqual(r.n, 2); assert.strictEqual(r.percent, 50); assert.ok(!r.passed);
    assert.strictEqual(JSON.stringify(r.errors.map((e) => e.index)), '[1,3]');
    assert.strictEqual(r.errors[0].picked, 'A1'); assert.strictEqual(r.errors[0].correct, 'B1');
    assert.strictEqual(r.errors[0].explain, 'Потому что так');
    r = await T.quizReview('l1', qs, ['b', 'b', 'a', 'b'], 0.75, sha);
    assert.ok(r.passed && r.n === 3); // порог включительно
    r = await T.quizReview('l1', [], [], 0.7, sha);
    assert.ok(r.passed && r.total === 0);
    console.log('ok');
})().catch((e) => { console.error(e); process.exit(1); });
