const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('js/migr.js', 'utf8');
const template = fs.readFileSync('templates/migr.html', 'utf8');

assert(template.includes('{_global_.z}'), 'migr template must use recognized insertion point syntax');
assert(!template.includes('{ _global_.'), 'migr template must not use spaced insertion points');

function loadWorkspace(windowOverrides) {
    const window = Object.assign({
        location: { pathname: '/pathdb/migr', origin: 'https://ideav.ru' },
        db: 'globaldb',
        xsrf: 'global-xsrf',
        user: 'global-user'
    }, windowOverrides || {});
    const context = {
        console,
        window,
        document: {
            title: '',
            addEventListener: function() {}
        }
    };
    vm.createContext(context);
    vm.runInContext(source, context);
    return context.window.MigrationWorkspace;
}

let MigrationWorkspace = loadWorkspace();
let app = new MigrationWorkspace({
    dataset: {
        db: '{ _global_.z }',
        xsrf: '{ _global_.xsrf }',
        user: '{ _global_.user }'
    }
});

assert.strictEqual(app.db, 'globaldb', 'unresolved template db must fall back to window.db');
assert.strictEqual(app.xsrf, 'global-xsrf', 'unresolved template xsrf must fall back to window.xsrf');
assert.strictEqual(app.user, 'global-user', 'unresolved template user must fall back to window.user');
assert.strictEqual(app.apiUrl('metadata?JSON'), '/globaldb/metadata?JSON');

app = new MigrationWorkspace({
    dataset: {
        db: '%7B%20_global_.z%20%7D',
        xsrf: '',
        user: ''
    }
});

assert.strictEqual(app.db, 'globaldb', 'encoded unresolved template db must fall back to window.db');

MigrationWorkspace = loadWorkspace({
    db: '',
    xsrf: '',
    user: '',
    location: { pathname: '/pathdb/migr', origin: 'https://ideav.ru' }
});
app = new MigrationWorkspace({
    dataset: {
        db: '{ _global_.z }',
        xsrf: '',
        user: ''
    }
});

assert.strictEqual(app.db, 'pathdb', 'unresolved template db must fall back to URL path when globals are absent');

app = new MigrationWorkspace({
    dataset: {
        db: 'explicitdb',
        xsrf: 'explicit-xsrf',
        user: 'explicit-user'
    }
});

assert.strictEqual(app.db, 'explicitdb', 'resolved data-db must still take precedence');
assert.strictEqual(app.xsrf, 'explicit-xsrf', 'resolved data-xsrf must still take precedence');
assert.strictEqual(app.user, 'explicit-user', 'resolved data-user must still take precedence');

console.log('PASS issue-2185 migration workspace template variable fallback');
