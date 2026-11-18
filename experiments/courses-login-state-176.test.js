// ideav/courses#176: «Вы вошли как …» + «Выйти» в шапке портала; выход гасит и сессию кабинета my;
// гость при живой куке idbs_my (вход не дошёл до базы) — один повтор запроса.
// Run with: node experiments/courses-login-state-176.test.js
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const dir = path.join(__dirname, '..', 'download', 'courses', 'js');
function load(user, cookie, core) {
  const calls = [], loc = { pathname: '/courses/', href: '' };
  const win = { LMS: { z: 'courses', user, core }, LMSCore: core ? { logout: (f, db) => { calls.push('core-logout ' + db); return Promise.resolve(); } } : undefined };
  const ctx = { window: win, document: { cookie, createElement: () => ({}), addEventListener() {}, querySelector: () => null }, location: loc, localStorage: { getItem: () => null, setItem() {} },
    fetch: (u) => { calls.push(u); return Promise.resolve({}); }, console, Date, Promise };
  win.window = win; ctx.window = win;
  vm.createContext(ctx);
  win.LMSApp = {};
  vm.runInContext(fs.readFileSync(path.join(dir, 'util.js'), 'utf8'), ctx);
  return { A: win.LMSApp, calls, loc };
}
(async () => {
  let t = load('my123', '', false);
  assert.strictEqual(t.A.whoLabel(), 'Вы вошли как my123');
  assert.strictEqual(load('guest', '', false).A.whoLabel(), '');
  assert.strictEqual(load('guest', 'a=1; idbs_my=1', false).A.cabinetSessionAlive(), true);
  assert.strictEqual(load('guest', 'a=1', false).A.cabinetSessionAlive(), false);
  assert.strictEqual(load('guest', 'idbs_my=1', true).A.cabinetSessionAlive(), false);
  await t.A.logout();
  assert.deepStrictEqual(t.calls, ['/courses/exit?next_act=nul', '/my/exit?next_act=nul']);
  assert.strictEqual(t.loc.href, '/courses/');
  t = load('u', '', true); await t.A.logout();
  assert.deepStrictEqual(t.calls, ['core-logout courses']);
  const lms = fs.readFileSync(path.join(dir, 'lms.js'), 'utf8');
  assert(/A\.logout/.test(lms) && /Выйти/.test(lms) && /A\.whoLabel\(\)/.test(lms) && /lms-sso-retry/.test(lms));
  console.log('ok');
})().catch(e => { console.error(e); process.exit(1); });
