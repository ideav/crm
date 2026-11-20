// ideav/courses#198: лендинг ставит .lms-main класс «ld» (снимает max-width); после перехода
// «Все курсы в каталоге» / в карточку курса класс оставался, и страница шла во всю ширину до F5.
// rules: none (defect courses#198)
// Run with: node experiments/courses-landing-class-198.test.js
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const src = fs.readFileSync(path.join(__dirname, '..', 'download', 'courses', 'js', 'lms.js'), 'utf8');

function el(tag) {
  const cls = new Set();
  return { tag, kids: [], set innerHTML(v) { this.kids = []; }, appendChild(k) { this.kids.push(k); return k; },
    querySelectorAll: () => [], getAttribute: () => null,
    classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c), toggle() {} } };
}
const app = el('div'), loc = { hash: '' };
let main = null;
const A = {
  el: (tag, attrs) => { const e = el(tag); if (attrs && /lms-main/.test(attrs.class || '')) { attrs.class.split(' ').forEach((c) => e.classList.add(c)); main = e; } return e; },
  data: { init: () => ({ then: (ok) => ok() }), course: () => null, hasAnyProgress: () => false },
  isGuest: () => true, cabinetSessionAlive: () => false, rememberAff() {}, store: { get() {}, set() {} },
  isCurator: () => false, isAdmin: () => false, whoLabel: () => '', loginYandex() {}, logout() {},
  views: { landing: (r) => r.classList.add('ld'), catalog() {}, course() {} },
};
const ctx = { window: { LMSApp: A, LMS: {}, addEventListener() {}, scrollTo() {} }, location: loc, URLSearchParams,
  document: { readyState: 'complete', getElementById: (id) => (id === 'lms-app' ? app : null), addEventListener() {} } };
vm.createContext(ctx);
vm.runInContext(src, ctx);
assert(main, 'оболочка создала .lms-main');

loc.hash = '#/'; A.route();
assert(main.classList.contains('ld'), 'на лендинге класс ld стоит');
for (const h of ['#/catalog', '#/course/a2009']) {
  loc.hash = '#/'; A.route();
  loc.hash = h; A.route();
  assert(!main.classList.contains('ld'), 'после перехода с лендинга на ' + h + ' класса ld нет');
}
console.log('ok');
