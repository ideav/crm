// Регрессионный тест: клиентская часть входа по QR (#4667).
//
// Класс QrLoginManager вынимается из js/app.js как есть (app.js не модуль) и
// работает на заглушках DOM/fetch/таймеров. Проверяем:
//   1) в QR уходит ССЫЛКА С КОДОМ, а секрет остаётся в браузере — снятый с
//      экрана код чужую сессию не открывает;
//   2) опрос шлёт и код, и секрет;
//   3) confirmed → onAuthorized(db, token) ровно один раз, таймеры сняты;
//   4) expired/denied → код гасится, показывается «Обновить код», входа нет;
//   5) сетевая ошибка одного опроса сессию не гасит — следующий повторяет;
//   6) обратный отсчёт останавливается по истечении TTL.
//
// Дополнительно (если установлен jsqr): нарисованный вендорной библиотекой QR
// декодируется обратно в ту же ссылку — то, что увидит камера телефона.

const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function expect(cond, name) {
  if (cond) { console.log('PASS: ' + name); passed++; }
  else { console.log('FAIL: ' + name); failed++; process.exitCode = 1; }
}

// ───────── заглушки окружения ─────────
const timers = new Map();
let timerSeq = 0;
global.setInterval = (fn, ms) => { const id = ++timerSeq; timers.set(id, { fn, ms }); return id; };
global.clearInterval = (id) => { timers.delete(id); };
function fireTimers(ms) {
  for (const [, t] of Array.from(timers)) if (t.ms === ms) t.fn();
}

const els = {};
function makeEl(id) {
  return {
    id, innerHTML: '', textContent: '', style: { display: '' },
    _classes: new Set(),
    classList: {
      add: (c) => els[id]._classes.add(c),
      remove: (c) => els[id]._classes.delete(c),
      toggle: (c, on) => on ? els[id]._classes.add(c) : els[id]._classes.delete(c),
      contains: (c) => els[id]._classes.has(c)
    }
  };
}
['qr-login-code', 'qr-login-status', 'qr-refresh-btn'].forEach(id => { els[id] = makeEl(id); });
global.document = { getElementById: (id) => els[id] || null };

let drawn = [];
global.window = {
  qrcode: () => {
    const self = {
      addData: (d) => { self._data = d; },
      make: () => { drawn.push(self._data); },
      createSvgTag: () => '<svg data-payload="' + self._data + '"></svg>'
    };
    return self;
  }
};
global.console.log = console.log;

let fetchQueue = [];
let fetchCalls = [];
global.fetch = async (url, opts) => {
  fetchCalls.push({ url, opts });
  const next = fetchQueue.shift();
  if (!next) throw new Error('нет заготовленного ответа для ' + url);
  if (next.throw) throw new Error(next.throw);
  return { ok: next.ok !== false, json: async () => next.body };
};

// ───────── вынимаем класс из js/app.js ─────────
const appSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
const start = appSrc.indexOf('class QrLoginManager {');
if (start < 0) throw new Error('class QrLoginManager не найден в js/app.js');
let depth = 0, end = -1;
for (let i = appSrc.indexOf('{', start); i < appSrc.length; i++) {
  if (appSrc[i] === '{') depth++;
  else if (appSrc[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
}
const QrLoginManager = eval('(' + appSrc.slice(start, end) + ')');

function newManager() {
  drawn = []; fetchCalls = []; fetchQueue = []; timers.clear();
  els['qr-login-code'].innerHTML = '';
  els['qr-login-code']._classes.clear();
  els['qr-refresh-btn'].style.display = 'none';
  const authorized = [];
  const mgr = new QrLoginManager((db, token) => authorized.push({ db, token }));
  return { mgr, authorized };
}

const SESSION = {
  code: 'c'.repeat(64),
  secret: 's'.repeat(64),
  url: 'https://ideav.ru/ateh/qrlogin?c=' + 'c'.repeat(64),
  ttl: 120
};

(async () => {
  // 1) Код выдан, QR нарисован по ссылке из ответа — без секрета.
  let t = newManager();
  fetchQueue.push({ body: SESSION });
  await t.mgr.start('ateh');
  expect(fetchCalls[0].url === 'ateh/qrnew?JSON', 'код запрашивается у qrnew выбранной базы');
  expect(fetchCalls[0].opts.method === 'POST', 'qrnew запрашивается методом POST');
  expect(drawn.length === 1 && drawn[0] === SESSION.url, 'в QR уходит ссылка из ответа сервера');
  expect(drawn[0].indexOf(SESSION.secret) === -1, 'СЕКРЕТА в QR нет — он остаётся в браузере');
  expect(drawn[0].indexOf(SESSION.code) !== -1, 'код в ссылке есть');
  expect(els['qr-login-code'].innerHTML.indexOf('<svg') === 0, 'QR вставлен в страницу как svg');
  expect(els['qr-login-status'].textContent.indexOf('Код действует ещё') === 0, 'показан обратный отсчёт');

  // 2) Опрос шлёт и код, и секрет.
  fetchQueue.push({ body: { status: 'pending' } });
  fireTimers(2000);
  await new Promise(r => setImmediate(r));
  const pollUrl = fetchCalls[1].url;
  expect(pollUrl.indexOf('ateh/qrpoll?JSON') === 0, 'опрос идёт в qrpoll');
  expect(pollUrl.indexOf('c=' + SESSION.code) !== -1 && pollUrl.indexOf('s=' + SESSION.secret) !== -1
       , 'опрос шлёт и код, и секрет');
  expect(t.authorized.length === 0, 'пока pending — входа нет');

  // 3) Подтверждение: вход выполняется один раз, таймеры сняты.
  fetchQueue.push({ body: { status: 'confirmed', token: 'TOK-PERMANENT', user: 'ivan' } });
  fireTimers(2000);
  await new Promise(r => setImmediate(r));
  expect(t.authorized.length === 1 && t.authorized[0].token === 'TOK-PERMANENT', 'полученный токен уходит на вход');
  expect(t.authorized[0].db === 'ateh', 'вход выполняется в ту базу, для которой выдан код');
  expect(timers.size === 0, 'после подтверждения таймеры сняты');
  expect(t.mgr.session === null, 'сессия забыта — повторных опросов не будет');

  // 4) Отказ сервера: код гаснет, вход не выполняется.
  for (const status of ['expired', 'denied']) {
    t = newManager();
    fetchQueue.push({ body: SESSION });
    await t.mgr.start('ateh');
    fetchQueue.push({ body: { status } });
    fireTimers(2000);
    await new Promise(r => setImmediate(r));
    expect(t.authorized.length === 0, `status=${status} — входа нет`);
    expect(els['qr-login-code']._classes.has('qr-login-expired'), `status=${status} — код погашен`);
    expect(els['qr-refresh-btn'].style.display === '', `status=${status} — предложено обновить код`);
    expect(timers.size === 0, `status=${status} — опрос остановлен`);
  }

  // 5) Сетевая ошибка одного опроса сессию не гасит.
  t = newManager();
  fetchQueue.push({ body: SESSION });
  await t.mgr.start('ateh');
  fetchQueue.push({ throw: 'network down' });
  fireTimers(2000);
  await new Promise(r => setImmediate(r));
  expect(timers.size === 2, 'после сбоя сети опрос продолжается');
  expect(!els['qr-login-code']._classes.has('qr-login-expired'), 'после сбоя сети код не гасится');
  fetchQueue.push({ body: { status: 'confirmed', token: 'TOK-2' } });
  fireTimers(2000);
  await new Promise(r => setImmediate(r));
  expect(t.authorized.length === 1 && t.authorized[0].token === 'TOK-2', 'следующий опрос доводит вход до конца');

  // 6) Истёк TTL — отсчёт останавливается сам.
  t = newManager();
  fetchQueue.push({ body: SESSION });
  await t.mgr.start('ateh');
  t.mgr.expiresAt = Date.now() - 1;
  fireTimers(1000);
  expect(els['qr-login-status'].textContent === 'Код устарел', 'по истечении TTL код помечен устаревшим');
  expect(timers.size === 0, 'по истечении TTL таймеры сняты');

  // 7) Ошибка выдачи кода: сообщение и кнопка «Обновить», без входа.
  t = newManager();
  fetchQueue.push({ ok: false, body: { error: 'Не удалось создать код' } });
  await t.mgr.start('ateh');
  expect(els['qr-login-status'].textContent === 'Не удалось создать код', 'ошибка qrnew показана пользователю');
  expect(els['qr-refresh-btn'].style.display === '', 'после ошибки предложено обновить код');
  expect(timers.size === 0, 'после ошибки опрос не запускается');

  // 8) Необязательная проверка вендорной библиотеки: то, что увидит камера.
  let jsQR = null;
  try { jsQR = require('jsqr'); } catch (e) { /* нет зависимости — пропускаем */ }
  if (jsQR) {
    const qrcode = require('../assets/vendor/qrcode/qrcode.js');
    const qr = qrcode(0, 'M');
    qr.addData(SESSION.url);
    qr.make();
    const n = qr.getModuleCount(), quiet = 4, scale = 4, size = (n + quiet * 2) * scale;
    const data = new Uint8ClampedArray(size * size * 4).fill(255);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const r = Math.floor(y / scale) - quiet, c = Math.floor(x / scale) - quiet;
        const dark = r >= 0 && c >= 0 && r < n && c < n && qr.isDark(r, c);
        const i = (y * size + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = dark ? 0 : 255;
      }
    const decoded = jsQR(data, size, size);
    expect(decoded && decoded.data === SESSION.url, 'нарисованный QR читается обратно в ту же ссылку');
  } else {
    console.log('SKIP: декодирование QR (нет пакета jsqr: npm i jsqr)');
  }

  console.log(failed ? `\n${failed} FAILED` : `\nAll tests passed (${passed})`);
})();
