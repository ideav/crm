// rules: none (defect #5644)
// ЛК базы my, раздел «Тариф»: смена плана через запрос my/1278 user_changePlan и баланс на экране.
// https://github.com/ideav/crm/issues/5644
//
// js/cabinet.js грузится чтением и eval в песочнице с заглушками DOM и fetch. Заглушка fetch
// отвечает так же, как ядро (index.php, вывод отчёта): ?JSON_KV — массив строк
// [{"User":"…",…}], пустой результат — []; ?JSON без _KV — объект {columns, data, header},
// где data — массив столбцов. Проверяется поведение changePlan и populateUserData.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'cabinet.js'), 'utf8');

function makeEnv(rowsFor1278) {
    const els = {};
    const el = id => (els[id] = els[id] || {
        id, textContent: '', value: '', disabled: false, style: {}, dataset: {},
        querySelector: () => null, appendChild() {}, addEventListener() {}, classList: { add() {}, remove() {}, toggle() {} },
    });
    const toasts = [];
    const calls = [];
    const document = {
        getElementById: el, querySelector: () => null, querySelectorAll: () => [],
        addEventListener() {}, cookie: '', createElement: () => el('_tmp' + Math.random()),
    };
    function respond(url) {
        if (url.indexOf('/my/report/1278') >= 0) {
            if (url.indexOf('JSON_KV') >= 0) return rowsFor1278;
            const cols = ['User', 'User -> Plan', 'User -> Balance'];
            return { columns: cols.map(name => ({ name })), data: cols.map(c => rowsFor1278.map(r => r[c] || '')), header: 'user_changePlan' };
        }
        return [];
    }
    const sandbox = {
        console: { log() {}, warn() {}, error() {} }, document, xsrf: 'x',
        URLSearchParams, URL, FormData: class { append() {} }, setTimeout, clearTimeout,
        location: { href: '', hash: '', pathname: '/my', search: '' },
        showToast: (msg, type) => toasts.push({ msg, type }),
        fetch: async url => { calls.push(url); const body = respond(url); return { ok: true, status: 200, json: async () => body }; },
    };
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(src + '\n;globalThis.CabinetController = CabinetController;', sandbox);
    const c = Object.create(sandbox.CabinetController.prototype);
    c.apiConfig = { host: 'ideav.ru' };
    c.userData = { Balance: '5000', PlanID: '1146', Plan: 'Знакомство' };
    c.reloads = 0;
    c.loadUserData = async function () { this.reloads++; };
    c.loadTransactionHistory = function () {};
    el('plan-select').value = '1147';
    el('change-plan-amount').textContent = '1950 руб.';
    return { c, els, el, toasts, calls };
}

let failures = 0;
async function check(name, fn) {
    try { await fn(); console.log('PASS: ' + name); } catch (e) { failures++; console.log('FAIL: ' + name + '\n  ' + e.message); }
}

(async () => {
    await check('план сменился (запрос вернул строку) — сообщение об успехе и данные ЛК перечитаны', async () => {
        const env = makeEnv([{ User: '236968', 'User -> Plan': '1146', 'User -> Balance': '5000' }]);
        await env.c.changePlan();
        assert.deepStrictEqual(env.toasts.map(t => t.type), ['success'], JSON.stringify(env.toasts));
        assert.strictEqual(env.c.reloads, 1, 'данные ЛК не перечитаны');
    });

    await check('план не сменился (пустой результат) — не ошибка поддержки, а причина; данные ЛК перечитаны', async () => {
        const env = makeEnv([]);
        await env.c.changePlan();
        assert.strictEqual(env.toasts.length, 1, JSON.stringify(env.toasts));
        assert.notStrictEqual(env.toasts[0].type, 'success');
        assert.ok(/средств|подключ/i.test(env.toasts[0].msg), 'нет причины в сообщении: ' + env.toasts[0].msg);
        assert.strictEqual(env.c.reloads, 1, 'данные ЛК не перечитаны — на экране остался прежний план и баланс');
    });

    await check('раздел «Тариф» показывает текущий баланс', async () => {
        const env = makeEnv([]);
        env.c.populateBalance();
        assert.strictEqual(env.el('tariff-balance').textContent, '5000');
    });

    await check('раздел «Тариф»: баланс пуст — 0', async () => {
        const env = makeEnv([]);
        env.c.userData = { Balance: '' };
        env.c.populateBalance();
        assert.strictEqual(env.el('tariff-balance').textContent, '0');
    });

    const html = fs.readFileSync(path.join(__dirname, '..', 'templates', 'my', 'main.html'), 'utf8');
    const tariff = html.slice(html.indexOf('id="section-tariff"'), html.indexOf('id="section-balance"'));
    await check('в разметке раздела «Тариф» есть место под баланс', async () => {
        assert.ok(tariff.indexOf('id="tariff-balance"') > 0);
    });

    if (failures) { console.log(`\nFAILED: ${failures} check(s) failed`); process.exit(1); }
    console.log('\nALL PASSED');
})();
