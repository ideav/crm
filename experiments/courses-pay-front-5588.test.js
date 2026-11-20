// ideav/crm#5588: страница платного курса (#/course/<код>) без своей ссылки оплаты автора ведёт
// на оплату картой/СБП (/courses-pay.php?course=<код>) и показывает поле промокода; со ссылкой автора —
// как раньше: вкладка + «Я оплатил». Гостю — только вход.
// Поведение проверяется отрисовкой A.views.course (catalog.js + map.js) на поддельном DOM.
//
// Run with: node experiments/courses-pay-front-5588.test.js

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

function render(course, { guest = false, requests = [] } = {}) {
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
        uid: '1102', requests, progress: {}, PROMO_MSG: {}, requestNote: 'заявка',
        course: code => (code === course.code ? course : null), catalogList: () => [course], hasAccess: () => false,
        firstOpen: () => null, isDone: () => false, myCourses: () => [], redeemPromo: () => Promise.resolve({ ok: true }),
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

const authored = { code: 'a2026', title: 'Биоэнергетика. Ступень 1', authored: true, free: false, price: 16900, payUrl: '', lessons: [{ id: '1-1', title: 'урок' }] };
const links = root => all(root, n => n.tag === 'a').map(a => a.attrs.href);
const buttons = root => all(root, n => n.tag === 'button').map(b => b.textContent);
const promoInputs = root => all(root, n => n.tag === 'input' && n.attrs.placeholder === 'Промокод');

let failed = 0;
function t(name, fn) { try { fn(); console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + e.message); } }

t('платный авторский курс без ссылки автора: кнопка оплаты картой/СБП на courses-pay.php', () => {
    const r = render(authored);
    assert.ok(links(r).includes('/courses-pay.php?course=a2026'), 'ссылки: ' + JSON.stringify(links(r)));
    assert.ok(!buttons(r).includes('Я оплатил'), 'при своей оплате «Я оплатил» не нужен: ' + JSON.stringify(buttons(r)));
});

t('страница курса: поле промокода есть', () => {
    assert.strictEqual(promoInputs(render(authored)).length, 1);
});

t('ссылка оплаты автора: как раньше — вкладка и «Я оплатил», courses-pay.php не подставляем', () => {
    const r = render(Object.assign({}, authored, { payUrl: 'https://pay.example/edgul' }));
    assert.ok(links(r).includes('https://pay.example/edgul'));
    assert.ok(!links(r).includes('/courses-pay.php?course=a2026'));
    assert.ok(buttons(r).includes('Я оплатил'));
    assert.strictEqual(promoInputs(r).length, 1, 'промокод — и здесь');
});

t('гость: только вход, без оплаты и промокода', () => {
    const r = render(authored, { guest: true });
    assert.ok(!links(r).some(h => /courses-pay/.test(h || '')));
    assert.strictEqual(promoInputs(r).length, 0);
});

if (failed) { console.log('\n' + failed + ' FAIL'); process.exitCode = 1; } else console.log('\nOK');
