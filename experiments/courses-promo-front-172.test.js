// ideav/courses#172: промокод проверяет и списывает сервер, портал только зовёт его (api.js A.redeemPromo).
// Поддельный fetch, без сети:
// - ideav.ru: POST /courses-promo.php, JSON {course, code}, заголовок X-Requested-With;
// - ядро: POST /api/v1/<база>/promo/redeem с X-XSRF-Token из куки idx_<база>;
// - {ok:false,error:'exhausted'} при HTTP 4xx доходит до вызывающего как значение, не как исключение;
// - 404/405 (обработчика нет на сервере) → ошибка с unsupported (портал откатывается на заявку);
// - ошибка ядра {error:{code}} приводится к {ok:false,error}.
//
// Run with: node experiments/courses-promo-front-172.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const dir = path.join(__dirname, '..', 'download', 'courses');
const json = (status, body) => ({ ok: status < 400, status, json: () => Promise.resolve(body), text: () => Promise.resolve(JSON.stringify(body)) });

function portal(lms, route) {
    const calls = [];
    const ctx = {
        console, URLSearchParams, Promise, Date,
        location: { search: '', origin: 'https://ideav.ru', href: 'https://ideav.ru/courses/' },
        document: { cookie: 'idb_courses=; idx_courses=XS-172', addEventListener() {} },
        LMS: lms,
    };
    ctx.window = ctx;
    ctx.fetch = (url, init) => { calls.push({ url, init: init || {} }); return Promise.resolve(route(url, init || {})); };
    vm.createContext(ctx);
    for (const f of ['util.js', 'api.js']) vm.runInContext(fs.readFileSync(path.join(dir, 'js', f), 'utf8'), ctx);
    return { A: ctx.LMSApp, calls };
}

let failed = 0;
async function t(name, fn) {
    try { await fn(); console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + e.message); }
}

(async () => {
    await t('ideav.ru: POST /courses-promo.php с X-Requested-With, ответ granted', async () => {
        const p = portal({ z: 'courses' }, () => json(200, { ok: true, status: 'granted', course: 'adept' }));
        const r = await p.A.redeemPromo('adept', 'ALPHA');
        assert.strictEqual(JSON.stringify(r), JSON.stringify({ ok: true, status: 'granted', course: 'adept' }));
        const c = p.calls[0];
        assert.strictEqual(c.url, '/courses-promo.php');
        assert.strictEqual(c.init.method, 'POST');
        assert.strictEqual(c.init.headers['X-Requested-With'], 'courses');
        assert.deepStrictEqual(JSON.parse(c.init.body), { course: 'adept', code: 'ALPHA' });
    });

    await t('исчерпанный код: HTTP 200/4xx с ok:false возвращается значением', async () => {
        const p = portal({ z: 'courses' }, () => json(200, { ok: false, error: 'exhausted' }));
        assert.strictEqual(JSON.stringify(await p.A.redeemPromo('adept', 'X')), JSON.stringify({ ok: false, error: 'exhausted' }));
        const q = portal({ z: 'courses' }, () => json(429, { ok: false, error: 'too_many' }));
        assert.strictEqual((await q.A.redeemPromo('adept', 'X')).error, 'too_many');
    });

    await t('ядро: POST /api/v1/courses/promo/redeem, X-XSRF-Token из куки', async () => {
        const p = portal({ core: true, z: 'courses' }, () => json(200, { ok: true, status: 'granted' }));
        await p.A.redeemPromo('adept', 'ALPHA');
        const c = p.calls[0];
        assert.strictEqual(c.url, '/api/v1/courses/promo/redeem');
        assert.strictEqual(c.init.headers['X-XSRF-Token'], 'XS-172');
        assert.strictEqual(c.init.headers['Content-Type'], 'application/json');
    });

    await t('ядро: ошибка {error:{code}} приводится к {ok:false,error}; 401 — login', async () => {
        const p = portal({ core: true, z: 'courses' }, () => json(409, { error: { code: 'exhausted', message: 'x' } }));
        assert.strictEqual(JSON.stringify(await p.A.redeemPromo('adept', 'X')), JSON.stringify({ ok: false, error: 'exhausted' }));
        const q = portal({ core: true, z: 'courses' }, () => json(401, { error: { code: 'err_access_denied' } }));
        assert.strictEqual((await q.A.redeemPromo('adept', 'X')).error, 'login');
    });

    await t('нет обработчика на сервере (404/405) → unsupported', async () => {
        for (const st of [404, 405]) {
            const p = portal({ z: 'courses' }, () => json(st, { error: 'nf' }));
            await p.A.redeemPromo('adept', 'X').then(() => assert.fail('ждали ошибку'), e => assert.strictEqual(e.unsupported, true));
        }
    });

    console.log(failed ? `\n${failed} FAIL` : '\nall ok');
    process.exit(failed ? 1 : 0);
})();
