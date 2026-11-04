// start.html#reg открывает форму входа сразу на вкладке «Регистрация».
// Ссылки вида https://ideav.ru/start.html#reg стоят в docs/integram-app-workflow*.md
// и на кнопке «Стать агентом» страниц курсов (ideav/courses).
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('js/app.js', 'utf8');
const start = source.indexOf('class App {');
const end = source.indexOf("document.addEventListener('DOMContentLoaded'", start);
const appSource = source.slice(start, end);

function el(display) {
    const classes = new Set();
    return {
        style: { display },
        classList: { add: c => classes.add(c), remove: c => classes.delete(c), has: c => classes.has(c) },
    };
}

function run(hash) {
    const dom = {
        'auth-panel': el('none'), 'welcome-section': el(''),
        'login-section': el(''), 'register-section': el('none'),
        'tab-login': el(''), 'tab-register': el(''),
    };
    const context = {
        console,
        document: { getElementById: id => dom[id] || null },
        window: { location: { hash, search: '' } },
        // showAuthPanel в фоне поднимает капчу — здесь она не проверяется
        hasValidAuthToken: async () => true,
        isCaptchaRendered: () => false,
    };
    vm.createContext(context);
    vm.runInContext(`${appSource}; this.App = App;`, context);
    const app = Object.create(context.App.prototype);
    app.auth = { buildAuthDbOptions() {} };
    app.apiConfig = { host: 'ideav.ru' };
    app.openAuthFromHash();
    return dom;
}

for (const hash of ['#reg', '#register']) {
    const dom = run(hash);
    assert.strictEqual(dom['auth-panel'].style.display, '', `${hash}: панель входа показана`);
    assert.strictEqual(dom['register-section'].style.display, '', `${hash}: форма регистрации видна`);
    assert.strictEqual(dom['login-section'].style.display, 'none', `${hash}: форма входа скрыта`);
    assert.ok(dom['tab-register'].classList.has('auth-tab-active'), `${hash}: вкладка «Регистрация» активна`);
}

for (const hash of ['', '#login', '#regular']) {
    const dom = run(hash);
    assert.strictEqual(dom['auth-panel'].style.display, 'none', `«${hash}»: панель не трогаем`);
    assert.strictEqual(dom['register-section'].style.display, 'none', `«${hash}»: регистрация скрыта`);
}

console.log('start-reg-hash: ok');
