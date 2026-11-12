// ideav/backlogram#930: капча на start.html при куче рабочих токенов.
// Куки входа idb_* — HttpOnly (python2node#1043): странице видны только метки idbs_*.
// Метку ставит не каждый путь входа (secret, JSON-auth, admin), и validateToken снимает
// её при любом сбое запроса — тогда перебор меток не находит ни одной базы, хотя сервер
// видит валидные куки. Решение о капче берётся у сервера: GET /{база}/_captcha?JSON →
// {bypass}; перебор меток остаётся запасным путём (сервер без _captcha, сбой сети).
//
// Run with: node experiments/captcha-server-bypass-bl930.test.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const appSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');

// Банка кук document.cookie: HttpOnly-куки сюда не попадают — как в браузере.
function makeSandbox(visibleCookies, responder, search) {
    const jar = Object.assign({}, visibleCookies);
    const calls = [];
    const documentStub = {
        addEventListener() {},
        getElementById() { return null; },
        querySelectorAll() { return []; },
        querySelector() { return null; },
        createElement() { return { classList: { add() {} }, style: {}, addEventListener() {} }; },
        get cookie() { return Object.keys(jar).map(k => k + '=' + jar[k]).join('; '); },
        set cookie(str) {
            const [pair] = str.split(';');
            const eq = pair.indexOf('=');
            const name = pair.slice(0, eq).trim();
            const value = pair.slice(eq + 1).trim();
            if (/expires=Thu, 01 Jan 1970/i.test(str) || value === '') delete jar[name];
            else jar[name] = value;
        },
        documentElement: { setAttribute() {} },
        body: { appendChild() {} },
    };
    const ctx = {
        document: documentStub,
        window: { location: { hostname: 'ideav.ru', host: 'ideav.ru', protocol: 'https:', origin: 'https://ideav.ru', search: search || '' } },
        localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
        console: { log() {}, warn() {}, error() {} },
        setTimeout,
        URLSearchParams,
        fetch: async (url) => { calls.push(url); return responder(url); },
    };
    ctx.window.localStorage = ctx.localStorage;
    vm.createContext(ctx);
    vm.runInContext(appSrc + '\n;this.App = App;', ctx);
    // Экземпляр без конструктора: конструктор тянет DOM-менеджеры, решению о капче они не нужны.
    const app = Object.create(ctx.App.prototype);
    app.apiConfig = { host: 'ideav.ru' };
    app._captchaBypass = false;
    app._captchaBypassChecked = false;
    app._hideCaptchaWidgets = () => { app._hidden = true; };
    return { ctx, app, calls, jar };
}

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

let failures = 0;
function check(cond, name, extra) {
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (!cond) { failures++; if (extra !== undefined) console.log('   ', extra); }
}

async function run() {
    // 1) Случай из скриншота: меток нет совсем, сервер видит валидную HttpOnly-куку → капчи нет.
    {
        const { app, calls } = makeSandbox({}, url =>
            /\/_captcha\?JSON$/.test(url) ? json(200, { bypass: true }) : json(404, null),
            '?db=db13417569248up&r=InvalidToken');
        const bypass = await app._ensureCaptchaBypass();
        check(bypass === true, 'без меток idbs_*, сервер подтвердил куку → капча не нужна', calls);
        check(app._hidden === true, 'виджеты капчи спрятаны');
        check(calls.length === 1 && calls[0] === 'https://ideav.ru/db13417569248up/_captcha?JSON',
            'один запрос к серверу, к базе из ?db=', calls);
    }

    // 2) Сервер сказал «нет валидных кук» → капча, и перебора меток нет (сервер видит больше страницы).
    {
        const { app, calls } = makeSandbox({ idbs_old: '1' }, url =>
            /\/_captcha\?JSON$/.test(url) ? json(200, { bypass: false }) : json(200, { _xsrf: 'x', user: 'alice' }));
        const bypass = await app._ensureCaptchaBypass();
        check(bypass === false, 'сервер: валидных кук нет → капча');
        check(calls.length === 1, 'без перебора xsrf по меткам', calls);
    }

    // 3) Сервер без _captcha (старое ядро, on-prem) → запасной путь: перебор меток, как раньше.
    {
        const { app, calls } = makeSandbox({ idbs_acme: '1' }, url =>
            /\/_captcha\?JSON$/.test(url) ? json(404, [{ error: 'not found' }])
                : json(200, { _xsrf: 'x', user: 'alice' }));
        const bypass = await app._ensureCaptchaBypass();
        check(bypass === true, 'нет _captcha → перебор меток находит валидный токен');
        check(calls.some(u => /\/acme\/xsrf\?JSON$/.test(u)), 'запасной путь спросил xsrf базы acme', calls);
    }

    // 4) Ответ сервера без булева bypass (например, HTML страницы входа) → запасной путь.
    {
        const { app } = makeSandbox({ idbs_acme: '1' }, url =>
            /\/_captcha\?JSON$/.test(url) ? { ok: true, status: 200, json: async () => { throw new Error('not json'); } }
                : json(200, { _xsrf: 'x', user: 'guest' }));
        const bypass = await app._ensureCaptchaBypass();
        check(bypass === false, 'не-JSON от сервера → перебор; гостевой токен капчу не снимает');
    }

    // 5) Без ?db база пробы — last_db, без неё — my.
    {
        const a = makeSandbox({ last_db: 'xcom' }, () => json(200, { bypass: true }));
        await a.app._ensureCaptchaBypass();
        check(a.calls[0] === 'https://ideav.ru/xcom/_captcha?JSON', 'проба к last_db', a.calls);
        const b = makeSandbox({}, () => json(200, { bypass: true }));
        await b.app._ensureCaptchaBypass();
        check(b.calls[0] === 'https://ideav.ru/my/_captcha?JSON', 'проба к my по умолчанию', b.calls);
    }

    console.log('\n' + (failures === 0 ? 'ALL TESTS PASSED' : failures + ' TEST(S) FAILED'));
    process.exit(failures === 0 ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
