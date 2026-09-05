// Regression coverage for local CAPTCHA configuration and non-default ports.
//
// Run with: node experiments/local-captcha-config.test.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const appSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
const phpSrc = fs.readFileSync(path.join(__dirname, '..', 'index.php'), 'utf8');
const startSrc = fs.readFileSync(path.join(__dirname, '..', 'start.html'), 'utf8');

function makeSandbox(fetchImpl) {
    const documentStub = {
        addEventListener() {},
        getElementById() { return null; },
        querySelectorAll() { return []; },
        querySelector() { return null; },
        createElement() {
            return {
                classList: { add() {} },
                dataset: {},
                style: {},
                addEventListener() {}
            };
        },
        get cookie() { return ''; },
        set cookie(_value) {},
        documentElement: { setAttribute() {} },
        body: { appendChild() {} },
        head: { appendChild() {} }
    };
    const localStorageStub = {
        getItem() { return null; },
        setItem() {},
        removeItem() {}
    };
    const ctx = {
        document: documentStub,
        window: {
            location: {
                protocol: 'http:',
                hostname: '127.0.0.1',
                host: '127.0.0.1:8080',
                origin: 'http://127.0.0.1:8080',
                search: ''
            },
            localStorage: localStorageStub
        },
        localStorage: localStorageStub,
        console,
        setTimeout,
        clearTimeout,
        URL,
        URLSearchParams,
        fetch: fetchImpl
    };
    vm.createContext(ctx);
    vm.runInContext(appSrc, ctx);
    return ctx;
}

let failures = 0;
function assert(condition, name, detail) {
    console.log((condition ? 'PASS' : 'FAIL') + ' — ' + name);
    if (!condition) {
        failures++;
        if (detail) console.log('  ', detail);
    }
}

async function run() {
    {
        const requests = [];
        const ctx = makeSandbox(async (url) => {
            requests.push(url);
            return {
                ok: true,
                json: async () => ({ required: false, siteKey: '' })
            };
        });

        const host = vm.runInContext('(new ApiConfig()).host', ctx);
        assert(host === '127.0.0.1:8080',
            'ApiConfig retains the local non-default port', host);

        const config = await ctx.getCaptchaConfig(host);
        assert(config.required === false,
            'server can explicitly disable CAPTCHA for local configuration');
        assert(requests[0] === 'http://127.0.0.1:8080/my/captcha-config?JSON',
            'CAPTCHA config request uses the page protocol and port', requests[0]);
    }

    {
        let requestCount = 0;
        const ctx = makeSandbox(async () => {
            requestCount++;
            await new Promise(resolve => setTimeout(resolve, 5));
            return {
                ok: true,
                json: async () => ({ required: false, siteKey: '' })
            };
        });
        const fakeApp = {
            apiConfig: { host: '127.0.0.1:8080' },
            _captchaBypass: false,
            _captchaBypassChecked: false,
            _captchaBypassPromise: null,
            _captchaClientKey: '',
            hidden: false,
            _hideCaptchaWidgets() { this.hidden = true; }
        };
        ctx.fakeApp = fakeApp;
        const first = vm.runInContext('App.prototype._ensureCaptchaBypass.call(fakeApp)', ctx);
        const second = vm.runInContext('App.prototype._ensureCaptchaBypass.call(fakeApp)', ctx);
        const results = await Promise.all([first, second]);

        assert(results.every(Boolean),
            'local disabled configuration bypasses the empty widget');
        assert(requestCount === 1,
            'concurrent render and submit share one CAPTCHA decision', requestCount);
        assert(fakeApp.hidden === true,
            'unused CAPTCHA containers are hidden');
    }

    {
        const silentConsole = { log() {}, error() {} };
        const ctx = makeSandbox(async () => {
            throw new Error('offline');
        });
        ctx.console = silentConsole;
        const config = await ctx.getCaptchaConfig('127.0.0.1:8080');
        assert(config.required === true,
            'configuration failure fails closed');
        assert(config.siteKey === '',
            'configuration failure does not invent a client key');
    }

    assert(/function\s+isCaptchaRequired\s*\(\)/.test(phpSrc),
        'server centralizes the CAPTCHA-required decision');
    assert(/case\s+"captcha-config"[\s\S]*"required"\s*=>\s*\$captchaRequired[\s\S]*"siteKey"/.test(phpSrc),
        'public configuration endpoint exposes only requirement and public site key');
    assert(/if\(!hasValidTokenCookie\(\)\s*&&\s*!verifyCaptcha\(isset\(\$_POST\["smart-token"\]\)/.test(phpSrc),
        'login enforces CAPTCHA server-side even when the token field is omitted');
    assert(!/<script[^>]+smartcaptcha\.yandexcloud\.net/i.test(startSrc),
        'local page does not eagerly load the third-party CAPTCHA script');
    assert(!/data-sitekey=/i.test(startSrc),
        'static HTML no longer hardcodes the CAPTCHA site key');
    assert(/src="js\/app\.js\?v=20260904-1"/.test(startSrc),
        'login script URL is versioned so open browsers cannot reuse the pre-fix file');

    console.log('\n' + (failures === 0 ? 'ALL TESTS PASSED' : failures + ' TEST(S) FAILED'));
    process.exit(failures === 0 ? 0 : 1);
}

run();
