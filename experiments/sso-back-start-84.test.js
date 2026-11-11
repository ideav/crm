// ideav/courses#84: база из SSO_DBS (index.php, Sso_enter) отправляет посетителя без входа на вход
// в кабинет: /start.html?db=my&r=InvalidToken&uri=/<база>/… и ставит куку sso_back=<база>.
// После входа в my паролем start.html возвращает на uri — только когда кука sso_back называет базу
// из uri; прочие входы в my, как и раньше, ведут в /my.
//
// Run with: node experiments/sso-back-start-84.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const appSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');

function makeApp(cookies) {
    const documentStub = {
        addEventListener() {},
        getElementById() { return null; },
        querySelectorAll() { return []; },
        querySelector() { return null; },
        createElement() { return { classList: { add() {} }, style: {}, addEventListener() {} }; },
        cookie: Object.keys(cookies).map(k => k + '=' + cookies[k]).join('; '),
        documentElement: { setAttribute() {} },
        body: { appendChild() {} },
    };
    const ctx = {
        document: documentStub,
        window: { location: { hostname: 'ideav.ru', host: 'ideav.ru', protocol: 'https:', origin: 'https://ideav.ru', search: '' } },
        localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
        console: { log() {}, warn() {}, error() {} },
        setTimeout,
        URLSearchParams,
        URL,
    };
    ctx.window.localStorage = ctx.localStorage;
    vm.createContext(ctx);
    vm.runInContext(appSrc + '\n;this.App = App;', ctx);
    const app = Object.create(ctx.App.prototype);
    app.auth = { validDbs: [], allIdbDbs: [] };
    app.showAuthPanel = () => {};
    app._postLoginUri = '';
    app._postLoginDb = '';
    return app;
}

function afterLogin(cookies, search, selectedDb) {
    const app = makeApp(cookies);
    app.openAuthFromParams(new URLSearchParams(search));
    return app._getPostLoginUriForDb(selectedDb);
}

const fromSso = 'db=my&r=InvalidToken&uri=' + encodeURIComponent('/cources/?aff=42');
const cases = [
    ['кука sso_back=cources: вход в my возвращает в базу', { sso_back: 'cources' }, fromSso, 'my', '/cources/?aff=42'],
    ['без куки sso_back: вход в my — в /my, как раньше', {}, fromSso, 'my', ''],
    ['sso_back другой базы: вход в my — в /my', { sso_back: 'demo' }, fromSso, 'my', ''],
    ['вход в саму базу из uri — возврат, как раньше', {}, 'db=cources&r=InvalidToken&uri=%2Fcources%2Fx', 'cources', '/cources/x'],
    ['вход в другую базу, не my — без возврата, как раньше', { sso_back: 'cources' }, fromSso, 'demo', ''],
];
let failed = 0;
for (const [name, cookies, search, db, want] of cases) {
    const got = afterLogin(cookies, search, db);
    if (got === want) console.log('PASS: ' + name);
    else { console.log('FAIL: ' + name + ' — ждали ' + JSON.stringify(want) + ', получили ' + JSON.stringify(got)); failed++; }
}
assert.strictEqual(failed, 0, failed + ' FAIL');
