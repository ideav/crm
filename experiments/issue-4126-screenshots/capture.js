#!/usr/bin/env node
'use strict';

/**
 * capture.js — снимает экраны живых Integram-приложений под read-only токеном.
 *
 * Все запросы браузера проксируются через node fetch с X-Authorization + cookie:
 *  - браузер напрямую не тянет ideav.ru (известная проблема), node fetch — тянет;
 *  - integram.io (старая версия) ждёт cookie с именем БД (`crm`), новая — `idb_{db}`.
 *
 * Токен только на чтение: никаких изменений в БД, демо-данные подменяются в DOM.
 */

// Путь к модулю playwright и к бинарю Chromium можно переопределить переменными окружения.
const PW = process.env.PW_MODULE || 'playwright';
const CHROME = process.env.CHROME_PATH || undefined;
const { chromium } = require(PW);

// Read-only токен обеих баз. В репозитории не хранится.
const TOKEN = process.env.INTEGRAM_TOKEN;
if (!TOKEN) throw new Error('Задайте INTEGRAM_TOKEN — read-only токен Интеграма');
const FETCH_TIMEOUT = Number(process.env.FETCH_TIMEOUT || 60000);

// Внешние хосты, которые приложению реально нужны: шрифты и Chart.js
// (dash.js подгружает его с jsdelivr). Всё остальное режем.
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net'];

const APPS = {
  crm: { base: 'https://integram.io/crm', host: 'integram.io', cookie: 'crm' },
  sportzania: { base: 'https://ideav.ru/sportzania', host: 'ideav.ru', cookie: 'idb_sportzania' },
};

// Эндпоинты долгого опроса — их не ждём, сразу отдаём пустой ответ.
const LONGPOLL = /\/(updates|poll|events|notify|subscribe)\b/i;

// Отчёты и дашборды считаются десятками секунд; статика иногда подвисает — её ретраим.
const SLOW = /\/(report|dash)\//i;

async function proxyFetch(url, options) {
  const slow = SLOW.test(url);
  const perTry = slow ? Number(process.env.SLOW_TIMEOUT || 90000) : Number(process.env.FETCH_TIMEOUT || 12000);
  const attempts = slow ? 1 : 3;

  let lastErr = null;
  for (let i = 1; i <= attempts; i++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), perTry);
    try {
      const res = await fetch(url, { ...(options || {}), signal: ctrl.signal, redirect: 'follow' });
      return { status: res.status, headers: Object.fromEntries(res.headers.entries()), body: Buffer.from(await res.arrayBuffer()) };
    } catch (e) {
      lastErr = e;
      if (i === attempts) break;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr || new Error('fetch failed');
}

/**
 * opts.fixtures: [[regexp, (bodyText, url) => any]] — подменяет ответ демо-данными.
 * Функция может вернуть готовый объект либо преобразовать реальный ответ.
 */
async function makeContext(browser, app, opts = {}) {
  const viewport = opts.viewport;
  const fixtures = opts.fixtures || [];
  const context = await browser.newContext({
    viewport: viewport || { width: 1600, height: 1000 },
    deviceScaleFactor: 2,
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
    reducedMotion: 'reduce',
  });

  await context.route('**/*', async (route) => {
    const req = route.request();
    const url = req.url();

    if (FONT_HOSTS.some((h) => url.includes(h))) {
      try {
        const headers = { ...req.headers() };
        delete headers.host;
        const res = await proxyFetch(url, { method: 'GET', headers });
        const h = { ...res.headers };
        delete h['content-encoding']; delete h['content-length']; delete h['transfer-encoding'];
        await route.fulfill({ status: res.status, headers: h, body: res.body });
      } catch (_) { try { await route.abort(); } catch (__) {} }
      return;
    }

    if (!url.includes(app.host)) { try { await route.abort(); } catch (_) {} return; }
    if (LONGPOLL.test(url)) {
      try { await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }); } catch (_) {}
      return;
    }

    const fixture = fixtures.find(([re]) => re.test(url));

    try {
      const headers = { ...req.headers() };
      delete headers.host;
      delete headers['content-length'];
      headers['X-Authorization'] = TOKEN;
      headers['cookie'] = `${app.cookie}=${TOKEN}`;

      const body = ['GET', 'HEAD'].includes(req.method()) ? undefined : req.postDataBuffer();
      const res = await proxyFetch(url, { method: req.method(), headers, body });

      const h = { ...res.headers };
      delete h['content-encoding']; delete h['content-length']; delete h['transfer-encoding'];
      delete h['content-security-policy']; delete h['set-cookie'];
      h['access-control-allow-origin'] = '*';

      if (fixture) {
        const demo = fixture[1](res.body.toString('utf8'), url);
        console.log('FIXTURE', url.split('?')[0].replace(/^https?:\/\/[^/]+/, '').slice(0, 60));
        const isDocument = req.resourceType() === 'document';
        delete h['content-disposition'];
        return route.fulfill({
          status: 200,
          headers: {
            ...h,
            // при навигации браузер должен показать JSON, а не скачивать файл
            'content-type': isDocument ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
          },
          body: isDocument ? JSON.stringify(demo, null, 2) : JSON.stringify(demo),
        });
      }

      await route.fulfill({ status: res.status, headers: h, body: res.body });
    } catch (e) {
      if (fixture) {
        try {
          return await route.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify(fixture[1]('', url)) });
        } catch (_) {}
      }
      try { await route.fulfill({ status: 204, body: '' }); } catch (_) {}
    }
  });

  return context;
}

async function openPage(context, app, urlPath, settleMs) {
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  const target = app.base.replace(/\/$/, '') + (urlPath.startsWith('/') ? urlPath : '/' + urlPath);
  await page.goto(target, { waitUntil: 'commit', timeout: 30000 });
  await page.waitForSelector('body', { timeout: 20000 });
  await page.waitForTimeout(settleMs == null ? 6000 : settleMs);
  return page;
}

async function bodyText(page) {
  return page.evaluate(() => (document.body && document.body.innerText || '').replace(/\s+/g, ' ').trim());
}

module.exports = { APPS, TOKEN, chromium, CHROME, makeContext, openPage, bodyText };

// --- CLI: node capture.js <app> <path> <out.png> [settleMs] ---
if (require.main === module) {
  (async () => {
    const [appKey, urlPath = '/', out = '/tmp/shot.png', settle = '6000'] = process.argv.slice(2);
    const app = APPS[appKey];
    if (!app) throw new Error(`unknown app: ${appKey}`);

    const browser = await chromium.launch(CHROME ? { executablePath: CHROME, args: ['--no-sandbox'] } : { args: ['--no-sandbox'] });
    try {
      const context = await makeContext(browser, app);
      const page = await openPage(context, app, urlPath, Number(settle));
      console.log('URL:', page.url());
      console.log('TITLE:', await page.title());
      console.log('TEXT:', (await bodyText(page)).slice(0, 1200));
      await page.screenshot({ path: out });
      console.log('SAVED', out);
    } finally {
      await browser.close();
    }
  })().catch((e) => { console.error('FATAL', String(e.message || e).slice(0, 300)); process.exit(1); });
}
