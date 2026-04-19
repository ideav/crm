const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('js/main-app.js', 'utf8')
    .replace(/document\.addEventListener\('DOMContentLoaded'[\s\S]*$/, 'globalThis.MainAppController = MainAppController;');

const context = {
    console,
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
    context.MainAppController.getLogoutStartUrl('demo db') === '/start.html?db=demo%20db',
    'logout should redirect to start.html with the current DB preselected'
);

console.log('issue-1965 logout behavior: ok');
