// Тест issue #3549: авто-регулировка числа потоков запоминает ИСТОРИЧЕСКИ МАКСИМАЛЬНУЮ скорость
// пачки и меряет ПРИРОСТ относительно неё, а ПАДЕНИЕ — относительно ПОСЛЕДНЕЙ пачки.
// До #3549 прирост сравнивался с прошлой пачкой (prevSpeed): после revert/wait на сниженных
// потоках следующая проба сравнивалась с деградированной базой и «прирост» засчитывался ложно.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.join(__dirname, '..');
const scriptPath = path.join(root, 'download', 'xcom', 'js', 'xcom-mass-match.js');
const source = fs.readFileSync(scriptPath, 'utf8');
const sandbox = {
    window: {},
    document: { readyState: 'loading', addEventListener() {}, getElementById() { return null; } },
    console, URLSearchParams, URL, setTimeout, clearTimeout, setInterval, clearInterval, Date,
    fetch() { throw new Error('fetch should not be called'); }
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: 'xcom-mass-match.js' });

const api = sandbox.window.XcomMassMatchWorkspace;
assert(api && typeof api.tuneConcurrency === 'function', 'tuneConcurrency is exported');
const state = api._state;
const tune = api.tuneConcurrency;

function reset(concurrency, prevSpeed, maxSpeed, lastTuneUp, cooldown) {
    state.concurrency = concurrency;
    state.prevSpeed = prevSpeed === undefined ? null : prevSpeed;
    state.maxSpeed = maxSpeed === undefined ? null : maxSpeed;
    state.lastTuneUp = !!lastTuneUp;
    state.tuneCooldown = cooldown || 0;
}

// --- Прирост относительно МАКСИМУМА, а не последней пачки --------------------
// Был исторический максимум 20, после revert+wait опустились до c=6, последняя пачка дала 12.
// Проба повышения даёт 15: это БОЛЬШЕ прошлой пачки (12), но МЕНЬШЕ исторического максимума (20).
// До #3549: 15 > 12 → ложный «прирост» → up. После #3549: 15 не побило 20 → revert.
reset(6, /*prev*/ 12, /*max*/ 20, /*lastTuneUp*/ true, 0);
let r = tune(15);
assert.strictEqual(r.action, 'revert', 'прирост меряем vs максимум: 15<20 → revert (а не up)');
assert.strictEqual(state.concurrency, 5, '6 → 5 (возврат)');
assert.strictEqual(state.tuneCooldown, 3, 'после возврата ждём 3 пачки');
assert.strictEqual(state.maxSpeed, 20, 'максимум держится (15 его не побило)');

// --- Новый максимум после повышения → продолжаем повышать -------------------
// Проба дала 21 — это НОВЫЙ исторический максимум (>20) → up, максимум обновляется на 21.
reset(6, /*prev*/ 18, /*max*/ 20, /*lastTuneUp*/ true, 0);
r = tune(21);
assert.strictEqual(r.action, 'up', 'новый максимум (21>20) → up');
assert.strictEqual(state.concurrency, 7, '6 → 7');
assert.strictEqual(state.maxSpeed, 21, 'максимум обновился до 21');

// --- Падение меряем относительно ПОСЛЕДНЕЙ пачки, а не максимума ------------
// Последняя пачка 10, исторический максимум 20. Текущая 11: относительно последней (10) это РОСТ
// (не падение), хотя относительно максимума (20) было бы «−45%». Значит down НЕ срабатывает —
// падение считается от последней пачки. Идёт обычная проба повышения.
reset(7, /*prev*/ 10, /*max*/ 20, /*lastTuneUp*/ false, 0);
r = tune(11);
assert.strictEqual(r.action, 'probe-up', 'падение меряем vs последней: 11>10 → не down, обычная проба');
assert.strictEqual(state.concurrency, 8, '7 → 8 (проба)');

// --- Падение относительно последней пачки по-прежнему понижает --------------
// Последняя 20, текущая 14: −30% к последней → down. Исторический максимум держится.
reset(5, /*prev*/ 20, /*max*/ 20, /*lastTuneUp*/ false, 0);
r = tune(14);
assert.strictEqual(r.action, 'down', 'падение ≥10% к последней → down');
assert.strictEqual(state.concurrency, 4, '5 → 4');
assert.strictEqual(state.maxSpeed, 20, 'максимум переживает понижение');

// --- Первая пачка: максимум инициализируется из null -----------------------
reset(5, /*prev*/ undefined, /*max*/ undefined, /*lastTuneUp*/ false, 0);
r = tune(10);
assert.strictEqual(r.action, 'probe-up', 'первая пачка → проба');
assert.strictEqual(state.prevSpeed, 10, 'prevSpeed = скорость первой пачки');
assert.strictEqual(state.maxSpeed, 10, 'maxSpeed инициализирован первой пачкой');

console.log('OK: test-issue-3549-xcom-max-speed');
