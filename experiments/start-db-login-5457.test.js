// start.html?db=<база> открывает форму входа в эту базу, если входа в неё у браузера нет (#5457).
// Туда ведут кнопка «Войти» гостевого режима (templates/main.html, #guest-login), выход из базы
// (index.php _logout → /start.html?db=<база>) и ссылки «для входа». Входы в ДРУГИЕ базы
// (метки idbs_*) форму не отменяют: так было у владельца, заходящего гостем в свою же базу.
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('js/app.js', 'utf8');
const start = source.indexOf('class App {');
const end = source.indexOf("document.addEventListener('DOMContentLoaded'", start);
const appSource = source.slice(start, end);

const context = { console, document: { getElementById: () => null }, window: { location: {} }, showToast() {} };
vm.createContext(context);
vm.runInContext(`${appSource}; this.App = App;`, context);

// allIdbDbs — базы, куда у браузера есть вход (метки idbs_* / читаемые idb_*), как их видит AuthManager.init
function run(search, allIdbDbs) {
    const app = Object.create(context.App.prototype);
    app.auth = { allIdbDbs, validDbs: allIdbDbs.filter(d => d !== 'my') };
    const shown = [];
    app.showAuthPanel = (db, msg) => shown.push(db === undefined ? '(любая)' : db);
    app.openAuthFromParams(new URLSearchParams(search));
    return { shown, validDbs: app.auth.validDbs };
}

const cases = [
    // [адрес, входы браузера, ожидаемая форма (null — формы нет)]
    ['?db=guestdb', [], 'guestdb'],                      // гость без входов
    ['?db=guestdb', ['my'], 'guestdb'],                  // гость, вошедший в ЛК
    ['?db=guestdb', ['my', 'other'], 'guestdb'],         // владелец, вошедший в свои базы (#5457)
    ['?db=left', ['my', 'other'], 'left'],               // выход из left при входе в other
    ['?db=my', ['other'], 'my'],                         // выход из ЛК
    ['?db=other', ['my', 'other'], null],                // во вход в other уже есть — формы нет
    ['?db=tgroup&u=ivan', ['other'], 'tgroup'],          // ссылка «для входа» с именем
    ['', ['other'], null],                               // просто start.html
];

let failed = 0;
for (const [search, dbs, expected] of cases) {
    const { shown, validDbs } = run(search, dbs);
    const got = shown.length ? shown[0] : null;
    const label = `«${search}» при входах [${dbs.join(', ')}]`;
    try {
        assert.strictEqual(got, expected, `${label}: форма ${expected === null ? 'не нужна' : 'входа в ' + expected}, получено ${got}`);
        if (expected && expected !== 'my')
            assert.ok(validDbs.includes(expected), `${label}: база ${expected} есть в выборе базы формы`);
    } catch (e) {
        failed++;
        console.error('FAIL', e.message);
    }
}
if (failed) {
    console.error(`start-db-login-5457: ${failed} из ${cases.length} случаев не прошли`);
    process.exit(1);
}
console.log(`start-db-login-5457: ok (${cases.length} случаев)`);
