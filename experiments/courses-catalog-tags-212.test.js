// ideav/courses#212: теги каталога — лента в одну строку с горизонтальной прокруткой.
// - клик по тегу не пересоздаёт кнопки ленты (иначе прокрутка ленты сбрасывается в начало),
//   у выбранной меняется класс on и aria-pressed;
// - колесо мыши листает ленту вбок, пока есть куда; на краю событие уходит странице;
// - выбранный в ссылке тег (#/catalog?tag=) подкручивается в видимую часть ленты;
// - края затухают (fade-l / fade-r) только там, где лента продолжается.
// rules: none (defect ideav/courses#212)
//
// Run with: node experiments/courses-catalog-tags-212.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const dir = path.join(__dirname, '..', 'download', 'courses', 'js');

// Мини-DOM: ровно то, что трогают el() и каталог. Ширина кнопки 80, зазор 0, видимая часть ленты 200.
function makeDoc() {
  function Node(tag) {
    this.tagName = tag; this.children = []; this.attrs = {}; this.listeners = {}; this.textContent = '';
    this.scrollLeft = 0; this.offsetLeft = 0; this.offsetWidth = 80; this.clientWidth = 200;
    const self = this;
    this.classList = {
      contains: (c) => self.className.split(/\s+/).includes(c),
      toggle: (c, on) => { const s = new Set(self.className.split(/\s+/).filter(Boolean)); on ? s.add(c) : s.delete(c); self.className = [...s].join(' '); },
    };
  }
  Node.prototype.setAttribute = function (k, v) { this.attrs[k] = String(v); if (k === 'class') this.className = String(v); };
  Node.prototype.getAttribute = function (k) { return k === 'class' ? this.className : this.attrs[k]; };
  Node.prototype.appendChild = function (c) { c.parentNode = this; c.offsetLeft = this.children.length * 80; this.children.push(c); return c; };
  Node.prototype.addEventListener = function (t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); };
  Node.prototype.dispatch = function (t, ev) { (this.listeners[t] || []).forEach((fn) => fn(ev || {})); };
  Node.prototype.focus = function () {};
  Object.defineProperty(Node.prototype, 'innerHTML', { set() { this.children = []; }, get() { return ''; } });
  Object.defineProperty(Node.prototype, 'scrollWidth', { get() { return Math.max(this.clientWidth, this.children.length * 80); } });
  Node.prototype.className = '';
  return { createElement: (t) => new Node(t), createTextNode: (t) => ({ textContent: t }), addEventListener() {}, getElementById: () => null, cookie: '' };
}

const COURSES = [
  { code: 'a', title: 'Альфа', free: true, tags: ['agile', 'бд', 'crm'], lessons: [] },
  { code: 'b', title: 'Бета', price: 100, tags: ['вайбкодинг', 'интеграм', 'отчёты', 'продажи'], lessons: [] },
];

function render(query) {
  const document = makeDoc();
  const timers = [];
  const ctx = {
    console, URLSearchParams, document, Math,
    setTimeout: (fn) => timers.push(fn), clearTimeout() {},
    location: { pathname: '/courses', search: '', hash: '' }, history: { replaceState() {} },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(dir, 'util.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(dir, 'authors.js'), 'utf8'), ctx);
  ctx.LMSApp.data = ctx.LMSApp.data || {};
  ctx.LMSApp.data.catalogList = () => COURSES;
  ctx.LMSApp.query = new URLSearchParams(query || '');
  vm.runInContext(fs.readFileSync(path.join(dir, 'catalog.js'), 'utf8'), ctx);
  const root = document.createElement('div');
  ctx.LMSApp.views.catalog(root);
  timers.splice(0).forEach((fn) => fn());
  const box = root.children.find((n) => n.className.split(' ').includes('chips-tags'));
  return { box };
}
const label = (b) => b.textContent;
const wheel = (box, deltaY, deltaX) => { let prevented = false; box.dispatch('wheel', { deltaY, deltaX: deltaX || 0, preventDefault() { prevented = true; } }); return prevented; };

let failed = 0;
function t(name, fn) { try { fn(); console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + e.message); } }

t('клик по тегу не пересоздаёт кнопки ленты, меняется только выбранная', () => {
  const { box } = render('');
  const before = box.children.slice();
  assert.strictEqual(before.length, 7);
  box.scrollLeft = 160;
  const crm = before.find((b) => label(b) === '#crm');
  crm.dispatch('click');
  assert.ok(box.children.length === 7 && box.children.every((b, i) => b === before[i]), 'те же кнопки в том же порядке');
  assert.strictEqual(box.scrollLeft, 160, 'прокрутка ленты сохранилась');
  assert.ok(crm.classList.contains('on'));
  assert.strictEqual(crm.getAttribute('aria-pressed'), 'true');
  assert.ok(before.filter((b) => b !== crm).every((b) => !b.classList.contains('on')));
  crm.dispatch('click');
  assert.ok(!crm.classList.contains('on'), 'повторный клик снимает выбор');
});

t('колесо листает ленту вбок; на краю отдаёт прокрутку странице', () => {
  const { box } = render('');           // ширина ленты 7*80=560, видно 200 → максимум 360
  assert.strictEqual(wheel(box, 100), true);
  assert.strictEqual(box.scrollLeft, 100);
  assert.strictEqual(wheel(box, -50), true);
  assert.strictEqual(box.scrollLeft, 50);
  box.scrollLeft = 360;
  assert.strictEqual(wheel(box, 100), false, 'в конце ленты колесо вниз — странице');
  box.scrollLeft = 0;
  assert.strictEqual(wheel(box, -100), false, 'в начале ленты колесо вверх — странице');
  assert.strictEqual(wheel(box, 5, 40), false, 'горизонтальный жест тачпада ленте не перехватываем');
});

t('выбранный в ссылке тег подкручивается в середину ленты, края затухают', () => {
  const { box } = render('tag=отчёты');
  const on = box.children.find((b) => b.classList.contains('on'));
  assert.strictEqual(label(on), '#отчёты');
  assert.strictEqual(box.scrollLeft, on.offsetLeft - (200 - 80) / 2);
  assert.ok(box.classList.contains('fade-l') && box.classList.contains('fade-r'), box.className);
  box.scrollLeft = 0; box.dispatch('scroll');
  assert.ok(!box.classList.contains('fade-l') && box.classList.contains('fade-r'), 'в начале — только правое');
});

if (failed) { console.log(failed + ' failed'); process.exit(1); }
console.log('all passed');
