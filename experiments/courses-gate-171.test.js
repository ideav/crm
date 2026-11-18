// ideav/courses#171 + #177: страница «Нет доступа» для урока, закрытого предыдущим заданием; закрытый урок
// в списке карты — не ссылка; подписи «Пройдено: N из M» (карта) и «Урок N из M» (внутри урока).
// Run with: node experiments/courses-gate-171.test.js
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const dir = path.join(__dirname, '..', 'download', 'courses', 'js');
function node(tag, attrs, kids) { return { tag, attrs: attrs || {}, kids: [].concat(kids || []).filter(Boolean), innerHTML: '', appendChild(k) { this.kids.push(k); } }; }
function E(tag, attrs, kids) { return node(tag, attrs, kids); }
function texts(n) { return typeof n === 'string' ? [n] : [(n.attrs && n.attrs.text) || ''].concat(...(n.kids || []).map(texts)); }
function find(n, f, out = []) { if (n && typeof n === 'object') { if (f(n)) out.push(n); (n.kids || []).forEach(k => find(k, f, out)); } return out; }
function load(files, ctx) { vm.createContext(ctx); files.forEach(f => vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f })); return ctx; }
function mk(progress, loadErr) {
  const A = { el: E, isGuest: () => false, au: {}, getJSON: () => Promise.reject(loadErr), views: {}, loginButtons: () => [], fixLinks() {} };
  const ctx = { window: { LMSApp: A, LMS: {} }, document: {}, location: {}, clearTimeout() {}, setTimeout() {} };
  load(['data.js', 'lesson.js', 'map.js'], ctx);
  const D = A.data;
  D.courses = [{ code: 'c', title: 'C', free: true, lessons: [{ id: 'a', title: 'Первый' }, { id: 'b', title: 'Второй' }, { id: 'c3', title: 'Третий', gate: true }] }];
  D.progress = progress;
  return { A, D };
}
(async () => {
  // гейт по флагу: урок с gate, предыдущий не пройден
  let { A, D } = mk({});
  let c = D.course('c');
  assert.strictEqual(D.gateFor(c, 'a', false), null);
  assert.strictEqual(D.gateFor(c, 'b', false), null, 'без флага гейта нет');
  assert.strictEqual(D.gateFor(c, 'c3', false).id, 'a', 'блокер — первый невыполненный');
  A.data.progress = { 'c/a': { 'Статус': 'done' } };
  assert.strictEqual(D.gateFor(c, 'c3', false).id, 'b');
  A.data.progress = { 'c/a': { 'Статус': 'done' }, 'c/b': { 'Статус': 'done' } };
  assert.strictEqual(D.gateFor(c, 'c3', false), null);

  // прямая ссылка на закрытый урок — страница «Нет доступа» со ссылкой, без запроса
  let root = node('div');
  ({ A, D } = mk({}));
  root = node('div'); A.views.lesson(root, 'c', 'c3');
  let t = texts(root).join('|');
  assert(/Нет доступа/.test(t) && /«Первый»/.test(t) && !/Не удалось/.test(t));
  assert(find(root, n => n.attrs.href === '#/c/c/a').length);

  // сервер отказал (403) на обычном уроке, предыдущий не пройден — тоже «Нет доступа»
  ({ A, D } = mk({}, Object.assign(new Error('x'), { status: 403 })));
  root = node('div'); A.views.lesson(root, 'c', 'b'); await new Promise(r => setImmediate(r));
  assert(/Нет доступа/.test(texts(root).join('|')));
  // настоящая ошибка сети / сервера — прежний текст
  for (const e of [new Error('network'), Object.assign(new Error('x'), { status: 500 })]) {
    ({ A, D } = mk({}, e));
    root = node('div'); A.views.lesson(root, 'c', 'b'); await new Promise(r => setImmediate(r));
    assert(/Не удалось загрузить урок/.test(texts(root).join('|')));
  }
  // 404 у первого урока (блокера нет) — это ошибка, а не гейт
  ({ A, D } = mk({}, Object.assign(new Error('x'), { status: 404 })));
  root = node('div'); A.views.lesson(root, 'c', 'a'); await new Promise(r => setImmediate(r));
  assert(/Не удалось загрузить урок/.test(texts(root).join('|')));

  // карта: подпись и закрытый урок — не ссылка
  ({ A, D } = mk({ 'c/a': { 'Статус': 'done' } }));
  D.courses[0].lessons[2].gate = true; D.courses[0].lessons[1].gate = true;
  D.progress = {};
  root = node('div'); A.views.map(root);
  t = texts(root).join('|');
  assert(/Пройдено: 0 из 3/.test(t), t);
  assert(find(root, n => n.tag === 'a' && /#\/c\/c\/b$/.test(n.attrs.href || '')).length === 0, 'закрытый урок не ссылка');
  assert(find(root, n => n.tag === 'a' && n.attrs.href === '#/c/c/a').length === 1);
  assert(/Сначала: Первый/.test(t));

  console.log('ok');
})().catch(e => { console.error(e); process.exit(1); });
