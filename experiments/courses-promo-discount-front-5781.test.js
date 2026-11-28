// ideav/crm#5781: промокод со скидкой на странице курса. Сервер отвечает status=discount с ценой —
// курс не открывается, под полем промокода появляется ссылка оплаты /courses-pay.php?course=<код>&promo=<код>
// с ценой со скидкой. Ошибка кода — сообщение, ссылки нет.
// Поведение проверяется отрисовкой A.views.course (catalog.js + map.js) на поддельном DOM и кликом по кнопке.
//
// Run with: node experiments/courses-promo-discount-front-5781.test.js


const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const dir = path.join(__dirname, '..', 'download', 'courses', 'js');

function node(tag) {
    return {
        tag, attrs: {}, children: [], text: '', listeners: {},
        setAttribute(k, v) { this.attrs[k] = String(v); },
        getAttribute(k) { return this.attrs[k]; },
        appendChild(c) { this.children.push(c); return c; },
        addEventListener(ev, fn) { this.listeners[ev] = fn; },
        set textContent(v) { this.text = String(v); this.children = []; },
        get textContent() { return this.text + this.children.map(c => c.textContent).join(''); },
        set innerHTML(v) { this.text = String(v); },
    };
}
function all(n, pred, out = []) { if (pred(n)) out.push(n); (n.children || []).forEach(c => all(c, pred, out)); return out; }

function render(course, { guest = false, requests = [], redeem } = {}) {
    const document = { createElement: node, createTextNode: t => ({ textContent: t, children: [] }) };
    const A = {
        views: {}, isGuest: () => guest, loginButtons: () => [node('button')], refId: v => String(v).split(':')[0], route() {},
        el(tag, attrs, kids) {
            const e = document.createElement(tag);
            Object.keys(attrs || {}).forEach(k => {
                const v = attrs[k];
                if (v == null || v === false) return;
                if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v);
                else if (k === 'text') e.textContent = v;
                else if (k !== 'html') e.setAttribute(k, v === true ? '' : v);
            });
            [].concat(kids == null ? [] : kids).forEach(c => { if (c != null && c !== false) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
            return e;
        },
    };
    A.data = {
        uid: '1102', requests, progress: {}, PROMO_MSG: { invalid: "нет такого" }, requestNote: 'заявка',
        course: code => (code === course.code ? course : null), catalogList: () => [course], hasAccess: () => false,
        firstOpen: () => null, isDone: () => false, myCourses: () => [], redeemPromo: redeem || (() => Promise.resolve({ ok: true })),
        courseManifest: () => Promise.reject(new Error('нет')), requestPaid: () => Promise.resolve(),
    };
    const ctx = { console, Promise, Number, encodeURIComponent, setTimeout, document, location: { hash: '', search: '' }, history: { replaceState() {} } };
    ctx.window = ctx; ctx.LMSApp = A;
    vm.createContext(ctx);
    for (const f of ['map.js', 'catalog.js']) vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f });
    const root = node('main');
    A.views.course(root, course.code);
    return root;
}

const course = { code: 'adept', title: 'Адепт', free: false, price: 9900, payUrl: '', lessons: [{ id: '1-1', title: 'урок' }] };
const links = root => all(root, n => n.tag === 'a');
const tick = () => new Promise(r => setTimeout(r, 0));

async function enter(code, answer) {
    const r = render(course, { redeem: () => Promise.resolve(answer) });
    const inp = all(r, n => n.tag === 'input' && n.attrs.placeholder === 'Промокод')[0];
    const btn = all(r, n => n.tag === 'button' && n.textContent === 'Ввести промокод')[0];
    inp.value = code;
    btn.listeners.click();
    await tick(); await tick();
    return r;
}

let failed = 0;
async function t(name, fn) { try { await fn(); console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + e.message); } }

(async () => {
    await t('скидка 90%: ссылка оплаты с промокодом и ценой со скидкой', async () => {
        const r = await enter('sale90', { ok: true, status: 'discount', course: 'adept', code: 'SALE90', discount: 90, full: 9900, price: 990 });
        const a = links(r).filter(x => (x.attrs.href || '').indexOf('promo=') >= 0)[0];
        assert.ok(a, 'нет ссылки с promo=: ' + JSON.stringify(links(r).map(x => x.attrs.href)));
        assert.strictEqual(a.attrs.href, '/courses-pay.php?course=adept&promo=SALE90');
        assert.ok(/990/.test(a.textContent), 'в кнопке нет новой цены: ' + a.textContent);
        assert.ok(/90\s*%/.test(r.textContent), 'не сказано, какая скидка: ' + r.textContent);
    });

    await t('неверный код: сообщение, ссылки со скидкой нет', async () => {
        const r = await enter('nope', { ok: false, error: 'invalid' });
        assert.ok(!links(r).some(x => (x.attrs.href || '').indexOf('promo=') >= 0));
        assert.ok(/нет такого/.test(r.textContent));
    });

    console.log(failed ? `\n${failed} FAIL` : '\nall ok');
    process.exit(failed ? 1 : 0);
})();
