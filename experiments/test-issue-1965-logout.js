const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('js/main-app.js', 'utf8')
    .replace(/document\.addEventListener\('DOMContentLoaded'[\s\S]*$/, 'globalThis.MainAppController = MainAppController;');

const context = {
    console,
    URLSearchParams,
    document: {
        createElement: () => ({ innerHTML: '', value: '' })
    },
    window: {}
};

vm.createContext(context);
vm.runInContext(source, context);

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function getLogoutParams(dbName, username) {
    return new URLSearchParams(context.MainAppController.getLogoutStartUrl(dbName, username).replace('/start.html?', ''));
}

const deletedCookies = [];
Object.defineProperty(context.document, 'cookie', {
    get() {
        return 'idb_demo=token; demo=legacy; idb_other=token2';
    },
    set(value) {
        deletedCookies.push(value);
    }
});

context.MainAppController.deleteCurrentDbCookies('demo');

assert(
    deletedCookies.some(cookie => cookie.startsWith('idb_demo=;') && cookie.includes('path=/')),
    'logout should delete idb_<db> cookie for the current DB'
);
assert(
    deletedCookies.some(cookie => cookie.startsWith('demo=;') && cookie.includes('path=/')),
    'logout should delete legacy <db> cookie for the current DB'
);
assert(
    !deletedCookies.some(cookie => cookie.startsWith('idb_other=;')),
    'logout should not delete cookies for other DBs'
);
assert(
    getLogoutParams('demo db').get('db') === 'demo db',
    'logout should redirect to start.html with the current DB preselected'
);
assert(
    context.MainAppController.getLogoutStartUrl('demo db').startsWith('/start.html?'),
    'logout should redirect to start.html'
);
assert(
    getLogoutParams('demo db', 'Иван Петров').get('u') === 'Иван Петров',
    'logout should include the logged-out username in the start.html link'
);
assert(
    !getLogoutParams('demo', '').has('u'),
    'logout should omit empty username parameter'
);

console.log('issue-1965 logout behavior: ok');
