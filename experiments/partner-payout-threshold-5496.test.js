// Мерка: порог выплаты партнёру один во всех местах (#5496).
//
// Оферта партнёра: «Если сумма к выплате меньше 1 000 ₽, она переносится на следующий месяц».
// Партнёр видит порог во вкладке «Правила» ЛК (templates/my/main.html), админ — в сигнале
// «выплата» сводного кабинета (js/partner-admin.js). Проверяется:
//   1) сигнал «выплата» появляется ровно с PartnerAdmin.PAYOUT_MIN (999 — нет, 1000 — да);
//   2) сумма во вкладке «Правила», которую читает партнёр, равна PartnerAdmin.PAYOUT_MIN.
// TEXT-ASSERT-OK: п.2 читает видимый партнёру текст правил из шаблона (контент, не код); отрисовать main.html без ядра нельзя.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
global.window = globalThis;
for (const f of ['js/partner-cabinet.js', 'js/partner-admin.js'])
    (0, eval)(fs.readFileSync(path.join(root, f), 'utf8'));

let failures = 0;
function check(name, fn) {
    try { fn(); console.log('PASS: ' + name); } catch (e) { failures++; console.log('FAIL: ' + name + '\n  ' + e.message); }
}
const A = window.PartnerAdmin;
const OFFER_MIN = 1000;

check('порог выплаты в коде равен оферте (1 000 ₽)', () => {
    assert.strictEqual(A.PAYOUT_MIN, OFFER_MIN);
});

check('сигнал «выплата» с порога: 999 — нет, 1000 — да', () => {
    const row = (id, payable) => ({ PartnerID: id, Name: 'П' + id, ExamPassed: '1', Payable: String(payable) });
    const partners = A.readPartners([row('1', OFFER_MIN - 1), row('2', OFFER_MIN)]);
    const pay = A.signals(partners, [], new Date(2026, 10, 17)).filter(s => s.kind === 'ok').map(s => s.pid);
    assert.deepStrictEqual(pay, ['2']);
});

check('вкладка «Правила» называет тот же порог', () => {
    const html = fs.readFileSync(path.join(root, 'templates/my/main.html'), 'utf8');
    const tab = html.split('id="referrals-tab-rules"')[1].split('referrals-tab-content')[0];
    const m = tab.match(/Минимальная сумма (?:вывода|выплаты):\s*([\d\s ]+)/);
    assert.ok(m, 'во вкладке «Правила» нет строки о минимальной сумме');
    assert.strictEqual(parseInt(m[1].replace(/[\s ]/g, ''), 10), A.PAYOUT_MIN);
});

if (failures) { console.log(failures + ' FAIL'); process.exit(1); }
console.log('OK');
