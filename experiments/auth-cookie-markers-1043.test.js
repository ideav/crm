// python2node#1043: кука входа idb_<база> — HttpOnly, страница её не видит и не снимает.
//   A) список баз со входом (CookieUtil.getAllIdb) строится по меткам idbs_<база>, а читаемая
//      idb_<база> (кука, выданная до HttpOnly) тоже считается — без дублей;
//   B) CookieUtil.delete('idb_<база>') снимает и метку;
//   C) выход по простою (idle-logout) без оболочки рабочего места идёт на сервер
//      (POST /<база>/_logout) и уводит на форму входа только после ответа.
// Run with: node experiments/auth-cookie-markers-1043.test.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let failures = 0;
function check(cond, name) {
    if (cond) console.log('PASS: ' + name);
    else { console.log('FAIL: ' + name); failures++; }
}

// ── A, B) CookieUtil из js/app.js ──
const appSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
const start = appSrc.indexOf('const CookieUtil = {');
const end = appSrc.indexOf('\n};', start);
const writes = [];
const ctx = {
    document: {
        get cookie() { return 'idbs_alpha=1; idb_beta=legacy; idbname_alpha=Альфа; idbs_beta=1; last_db=alpha; other=1'; },
        set cookie(v) { writes.push(v); }
    },
    encodeURIComponent, decodeURIComponent, RegExp, Date
};
vm.createContext(ctx);
vm.runInContext(appSrc.slice(start, end + 3) + '\nthis.CookieUtil = CookieUtil;', ctx);

const dbs = ctx.CookieUtil.getAllIdb();
check(JSON.stringify([...dbs].sort()) === JSON.stringify(['alpha', 'beta']),
    'A: базы со входом — по меткам idbs_ и по прежней idb_, без дублей и без idbname_: ' + JSON.stringify(dbs));

ctx.CookieUtil.delete('idb_alpha');
check(writes.some(w => w.startsWith('idb_alpha=;')) && writes.some(w => w.startsWith('idbs_alpha=;')),
    'B: delete(idb_<база>) снимает и метку idbs_<база>');

// ── C) idle-logout без оболочки ──
(async () => {
    const calls = [];
    let resolveFetch;
    const nav = [];
    global.MainAppController = undefined;
    const root = {
        document: { set cookie(v) { calls.push('cookie:' + v.split('=')[0]); } },
        URLSearchParams,
        fetch: (url, opts) => { calls.push('fetch:' + opts.method + ' ' + url); return new Promise(r => { resolveFetch = r; }); },
        location: { replace: (u) => nav.push(u) }
    };
    // Модуль берёт окружение из root при загрузке — грузим заново с подменённым window
    const src = fs.readFileSync(path.join(__dirname, '..', 'download', 'atex', 'js', 'idle-logout.js'), 'utf8');
    const sandbox = { window: root, module: { exports: {} }, console };
    sandbox.window.document.currentScript = null;
    vm.createContext(sandbox);
    vm.runInContext(src, sandbox);
    const api = sandbox.module.exports;
    check(typeof api.logout === 'function', 'C: модуль отдаёт logout для проверки');
    const logout = api.logout;
    logout('ateh', 'operator');
    check(calls.includes('fetch:POST /ateh/_logout'), 'C: выход идёт на сервер POST /ateh/_logout: ' + JSON.stringify(calls));
    check(nav.length === 0, 'C: до ответа сервера форма входа не открывается');
    resolveFetch({ ok: true });
    await new Promise(r => setTimeout(r, 0));
    check(nav.length === 1 && nav[0] === '/start.html?db=ateh&u=operator', 'C: после ответа — форма входа: ' + JSON.stringify(nav));

    console.log(failures ? '\n' + failures + ' FAILED' : '\nALL PASSED');
    process.exitCode = failures ? 1 : 0;
})();
