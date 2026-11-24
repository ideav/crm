// Мерка к backlogram#1017: цель заявки портала «Решения» для Директа с оплатой за конверсии.
// Платная цель sol_lead уходит только от живого человека; всё прочее — sol_lead_blocked.
// rules: none (defect backlogram#1017)
const assert = require('assert');
const path = require('path');
const C = require(path.join(__dirname, '..', 'download', 'solutions', 'app.js'));

// счётчик ideav.ru — тот, к которому привязаны кампании кабинета ideav-ru
assert.strictEqual(C.METRIKA_ID, 108758829);

const human = { trusted: true, aliveMs: 40000, formMs: 15000, webdriver: false, honeypot: false };
assert.strictEqual(C.leadGoal(human), 'sol_lead');

// каждый признак робота по отдельности переводит цель в blocked
const bad = {
  trusted: false,          // не было ни одного настоящего жеста (isTrusted)
  webdriver: true,         // автоматизированный браузер
  honeypot: true,          // заполнено скрытое поле
  aliveMs: 2000,           // страница прожила меньше 2,5 с
  formMs: 2500             // форму «заполнили» быстрее 4 с
};
Object.keys(bad).forEach(function (k) {
  const sig = Object.assign({}, human); sig[k] = bad[k];
  assert.strictEqual(C.leadGoal(sig), 'sol_lead_blocked', k);
});
// пограничные значения — ещё человек
assert.strictEqual(C.leadGoal(Object.assign({}, human, { aliveMs: 2500, formMs: 4000 })), 'sol_lead');
// пустой вход — не платим
assert.strictEqual(C.leadGoal({}), 'sol_lead_blocked');
assert.strictEqual(C.leadGoal(null), 'sol_lead_blocked');

// параметры цели: адрес решения, без решения — каталог
assert.deepStrictEqual(C.goalParams({ id: 561, slug: 'wfm' }), { solution: 'wfm' });
assert.deepStrictEqual(C.goalParams({ id: 7, slug: '' }), { solution: 'id7' });
assert.deepStrictEqual(C.goalParams(null), { solution: 'catalog' });

console.log('solutions-bl1017: ok');
