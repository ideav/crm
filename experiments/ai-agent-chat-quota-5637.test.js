// #5637: строка остатка под ответом агента: quotaText(quota) и renderQuota(wrap, quota).
'use strict';
const test = require('node:test');
const assert = require('node:assert');
delete global.document;
const A = require('../js/ai-agent-chat.js');

test('included_left важнее лимита вопросов', () => {
    assert.strictEqual(A.quotaText({ included_left: 120, rate_left: 1, rate_limit: 3, rate_reset: '2026-11-22T14:05:00Z' }), 'ИИ: включено ещё 120 ед.');
    assert.strictEqual(A.quotaText({ included_left: 0 }), 'ИИ: включено ещё 0 ед.');
});
test('без included_left — остаток вопросов и локальное время сброса', () => {
    const t = A.quotaText({ included_left: null, rate_limit: 3, rate_left: 2, rate_reset: '2026-11-22T14:05:00Z' });
    const d = new Date('2026-11-22T14:05:00Z');
    const hm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    assert.strictEqual(t, 'Осталось 2 из 3 вопросов, обновится в ' + hm);
});
test('без reset — без времени; без данных и мусор — пусто', () => {
    assert.strictEqual(A.quotaText({ rate_limit: 3, rate_left: 0, rate_reset: 'мусор' }), 'Осталось 0 из 3 вопросов');
    assert.strictEqual(A.quotaText({ rate_left: 2 }), '');
    assert.strictEqual(A.quotaText(null), '');
    assert.strictEqual(A.quotaText({ included_left: '5', rate_left: -1 }), '');
});
test('renderQuota пишет textContent, без innerHTML', () => {
    const made = [];
    global.document = { createElement() { const e = { children: [], appendChild(c) { this.children.push(c); } }; made.push(e); return e; } };
    const wrap = { children: [], appendChild(c) { this.children.push(c); } };
    A.renderQuota(wrap, { included_left: 5 });
    delete global.document;
    assert.strictEqual(wrap.children.length, 1);
    assert.strictEqual(wrap.children[0].textContent, 'ИИ: включено ещё 5 ед.');
    assert.ok(/muted/.test(wrap.children[0].className));
    assert.strictEqual(wrap.children[0].innerHTML, undefined);
    A.renderQuota(wrap, null);
    assert.strictEqual(wrap.children.length, 1, 'нет quota — ничего не добавляется');
});
