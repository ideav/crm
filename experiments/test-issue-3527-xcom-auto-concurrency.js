// Тест авто-регулировки числа потоков по скорости пачки (issue #3527).
// Правила: (1) пробуем +1 от текущего; (2) пока скорость растёт после повышения — повышаем;
// (3) если прироста нет — возвращаем обратно и ждём 3 пачки до следующей пробы;
// (4) если скорость упала на 10% и больше к прошлой пачке — понижаем.
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

function reset(concurrency, prevSpeed, lastTuneUp, cooldown, maxSpeed) {
    state.concurrency = concurrency;
    state.prevSpeed = prevSpeed === undefined ? null : prevSpeed;
    // issue #3549: исторический максимум — отдельная база; в этих сценариях по умолчанию = prevSpeed.
    state.maxSpeed = maxSpeed === undefined ? state.prevSpeed : maxSpeed;
    state.lastTuneUp = !!lastTuneUp;
    state.tuneCooldown = cooldown || 0;
}

// --- (1) Первая проба: повысить на 1 от начального --------------------------
reset(5, null, false, 0);
let r = tune(10);
assert.strictEqual(r.action, 'probe-up', '(1) первая пачка → проба повышения');
assert.strictEqual(state.concurrency, 6, '(1) 5 → 6');
assert.strictEqual(state.lastTuneUp, true, '(1) помечаем что повышали');

// --- (2) Скорость растёт после повышения → повышаем дальше -------------------
r = tune(15); // 15 > 10
assert.strictEqual(r.action, 'up', '(2) скорость выросла → +1');
assert.strictEqual(state.concurrency, 7, '(2) 6 → 7');
r = tune(20); // 20 > 15
assert.strictEqual(state.concurrency, 8, '(2) 7 → 8 пока растёт');

// --- (3) Нет прироста после повышения → revert + ждём 3 пачки ----------------
reset(6, 10, /*lastTuneUp*/ true, 0);
r = tune(10); // не больше прошлого и не падение ≥10%
assert.strictEqual(r.action, 'revert', '(3) нет прироста → возврат');
assert.strictEqual(state.concurrency, 5, '(3) 6 → 5 (обратно)');
assert.strictEqual(state.tuneCooldown, 3, '(3) ждать 3 пачки');
// три пачки ждём (потоки не меняются)
['wait', 'wait', 'wait'].forEach((exp, i) => {
    r = tune(10);
    assert.strictEqual(r.action, exp, `(3) пачка ожидания ${i + 1}`);
    assert.strictEqual(state.concurrency, 5, `(3) потоки держим 5 во время ожидания ${i + 1}`);
});
// после 3 пачек — снова проба повышения
r = tune(10);
assert.strictEqual(r.action, 'probe-up', '(3) через 3 пачки → новая проба');
assert.strictEqual(state.concurrency, 6, '(3) проба 5 → 6');

// --- (4) Падение скорости ≥10% → понижаем -----------------------------------
reset(7, 20, false, 0);
r = tune(17); // 17 < 18 (=20*0.9) → падение >10%
assert.strictEqual(r.action, 'down', '(4) падение >10% → понижаем');
assert.strictEqual(state.concurrency, 6, '(4) 7 → 6');

// ровно 10% падения тоже понижает (20 → 18)
reset(7, 20, false, 0);
r = tune(18);
assert.strictEqual(r.action, 'down', '(4) ровно 10% падения → понижаем');
assert.strictEqual(state.concurrency, 6, '(4) 7 → 6 при ровно 10%');

// падение приоритетнее оценки повышения (даже если только что повышали)
reset(8, 20, true, 0);
r = tune(15);
assert.strictEqual(r.action, 'down', '(4) падение важнее оценки пробы');
assert.strictEqual(state.concurrency, 7, '(4) 8 → 7');

// --- Границы: не выше MAX и не ниже MIN --------------------------------------
reset(20, 10, false, 0);
r = tune(10);
assert.strictEqual(state.concurrency, 20, 'не превышаем максимум 20');
assert.strictEqual(r.action, 'max', 'на максимуме — действие max');

reset(1, 20, false, 0);
r = tune(1); // падение → понизить, но уже минимум
assert.strictEqual(state.concurrency, 1, 'не опускаемся ниже минимума 1');

// небольшое падение (<10%) после повышения → revert, а не down
reset(6, 20, true, 0);
r = tune(19); // 19 > 18 (=20*0.9): не «падение», но и не прирост
assert.strictEqual(r.action, 'revert', 'небольшое падение после пробы → возврат, не down');
assert.strictEqual(state.concurrency, 5, '6 → 5');

console.log('OK: test-issue-3527-xcom-auto-concurrency');
