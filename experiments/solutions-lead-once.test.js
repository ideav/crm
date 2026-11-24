// Мерка к ideav/backlogram#1017: платная цель sol_lead — не больше одного раза за сессию браузера;
// повторная отправка заявки засчитывается как sol_lead_blocked (Директ за неё не платит).
// rules: none (defect #1017)
const assert = require('assert');
const path = require('path');
const C = require(path.join(__dirname, '..', 'download', 'solutions', 'app.js'));

const human = { trusted: true, webdriver: false, honeypot: false, aliveMs: 60000, formMs: 30000 };
assert.strictEqual(C.leadGoal(human), 'sol_lead');
assert.strictEqual(C.leadGoal(Object.assign({}, human, { repeat: false })), 'sol_lead');
assert.strictEqual(C.leadGoal(Object.assign({}, human, { repeat: true })), 'sol_lead_blocked', 'повтор в сессии');
console.log('solutions-lead-once: ok');
