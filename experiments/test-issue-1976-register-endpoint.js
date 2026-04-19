const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('js/app.js', 'utf8');
const classStart = source.indexOf('class AuthManager');
const classEnd = source.indexOf('// ============================================================\n// App initialization');
const authSource = source.slice(classStart, classEnd);

let fetchCall = null;
const context = {
    console,
    URLSearchParams,
    fetch: async (url, options) => {
        fetchCall = { url, options };
        return {
            ok: true,
            async json() {
                return { message: 'toConfirm' };
            }
        };
    },
    CookieUtil: { get: () => '', set: () => {} },
    validateToken: async () => ({})
};

vm.createContext(context);
vm.runInContext(`${authSource}; this.AuthManager = AuthManager;`, context);

(async () => {
    const auth = new context.AuthManager({ host: 'app.integram.io' });
    const result = await auth.register('user@example.com', 'secret1', 'secret1', true);

    assert.strictEqual(fetchCall.url, 'https://app.integram.io/my/register?JSON');
    assert.strictEqual(fetchCall.options.method, 'POST');
    assert.strictEqual(fetchCall.options.credentials, 'include');
    assert.strictEqual(fetchCall.options.headers['Content-Type'], 'application/x-www-form-urlencoded');

    const body = new URLSearchParams(fetchCall.options.body);
    assert.strictEqual(body.get('email'), 'user@example.com');
    assert.strictEqual(body.get('regpwd'), 'secret1');
    assert.strictEqual(body.get('regpwd1'), 'secret1');
    assert.strictEqual(body.get('agree'), '1');
    assert.strictEqual(body.has('_xsrf'), false);
    assert.strictEqual(body.has('t18'), false);
    assert.strictEqual(body.has('t20'), false);

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.message, 'Регистрация прошла успешно. Проверьте вашу почту для подтверждения.');

    console.log('issue-1976 register endpoint test passed');
})().catch(err => {
    console.error(err);
    process.exit(1);
});
