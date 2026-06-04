#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repo = path.resolve(__dirname, '..');
const outDir = path.join(repo, 'docs/screenshots');
const baseUrl = process.env.ATEX_BASE_URL || 'https://ideav.ru/ateh';
const requestTimeoutMs = Number(process.env.ATEX_CAPTURE_REQUEST_TIMEOUT_MS || 15000);

const roles = {
  manager: {
    token: process.env.ATEX_MANAGER_TOKEN,
    label: 'Manager / Менеджер'
  },
  dispatcher: {
    token: process.env.ATEX_DISPATCHER_TOKEN,
    label: 'Dispatcher / Диспетчер'
  },
  operator: {
    token: process.env.ATEX_OPERATOR_TOKEN,
    label: 'Operator / Оператор'
  },
  director: {
    token: process.env.ATEX_DIRECTOR_TOKEN,
    label: 'Director / Руководитель'
  },
  client: {
    token: process.env.ATEX_CLIENT_TOKEN,
    label: 'Client / Клиент'
  }
};

const pages = [
  {
    file: 'issue-3002-01-manager-orders.png',
    template: 'orders',
    js: 'orders',
    css: ['orders'],
    role: 'manager',
    title: 'Приём и ведение заказов',
    ready: ['ООО Ромашка-Термолента #3002', '1966'],
    focus: 'ООО Ромашка-Термолента #3002'
  },
  {
    file: 'issue-3002-02-dispatcher-cut-calc.png',
    template: 'cut-calc',
    js: 'cut-calc',
    css: ['cut-calc'],
    role: 'dispatcher',
    title: 'Калькулятор типов резки',
    ready: ['TT-АТХ-3002-2026-05-31'],
    focus: 'Тип резки: TT-АТХ-3002-2026-05-31'
  },
  {
    file: 'issue-3002-03-dispatcher-planning.png',
    template: 'production-planning',
    js: 'production-planning',
    css: ['production-planning'],
    role: 'dispatcher',
    title: 'Планирование производства',
    ready: ['АТХ-3002-2026-05-31', 'Завершён', 'Выполнен'],
    focus: 'АТХ-3002-2026-05-31'
  },
  {
    file: 'issue-3002-04-operator-intake.png',
    template: 'intake',
    js: 'intake',
    css: ['intake'],
    role: 'operator',
    title: 'Приёмка сырья',
    ready: ['2026-05-31', '3640.00', '2440.00'],
    focus: '2026-05-31'
  },
  {
    file: 'issue-3002-05-operator-cut-map.png',
    template: 'cut-map',
    js: 'cut-map',
    css: ['cut-map'],
    role: 'operator',
    title: 'Карта резки',
    ready: ['4', 'Завершён'],
    focus: 'АТХ-3002-2026-05-31'
  },
  {
    file: 'issue-3002-06-operator-slitter.png',
    template: 'slitter',
    js: 'slitter',
    css: ['slitter'],
    role: 'operator',
    title: 'Рабочее место слиттера',
    ready: ['АТХ-3002-2026-05-31', '1200', 'Завершён'],
    focus: 'АТХ-3002-2026-05-31'
  },
  {
    file: 'issue-3002-07-operator-sleeve-cutter.png',
    template: 'sleeve-cutter',
    js: 'sleeve-cutter',
    css: ['sleeve-cutter'],
    role: 'operator',
    title: 'Втулкорез',
    ready: ['4', 'Завершён'],
    focus: 'Втулкорез 3'
  },
  {
    file: 'issue-3002-08-operator-warehouse.png',
    template: 'warehouse',
    js: 'warehouse',
    css: ['warehouse'],
    role: 'operator',
    title: 'Склад готовой продукции',
    ready: ['A-3002-01'],
    focus: 'A-3002-01'
  },
  {
    file: 'issue-3002-09-director-dashboards.png',
    template: 'dashboards',
    js: 'dashboards',
    css: ['dashboards'],
    role: 'director',
    title: 'Дашборды руководителя',
    ready: ['Заказы', 'Выпуск ГП', 'Остатки сырья'],
    focus: 'Выпуск ГП'
  },
  {
    file: 'issue-3002-10-client-portal.png',
    template: 'portal',
    js: 'portal',
    css: ['portal'],
    role: 'client',
    title: 'Клиентский портал',
    ready: ['1966', 'Выполнен'],
    focus: '1966'
  }
];

function requireTokens() {
  const missing = Object.entries(roles)
    .filter(([, role]) => !role.token)
    .map(([key]) => `ATEX_${key.toUpperCase()}_TOKEN`);

  if (missing.length) {
    throw new Error(`Missing token env vars: ${missing.join(', ')}`);
  }
}

function read(relPath) {
  return fs.readFileSync(path.join(repo, relPath), 'utf8');
}

async function fetchBodyWithRetry(url, options, label) {
  var lastError = null;

  for (var attempt = 1; attempt <= 3; attempt++) {
    var controller = new AbortController();
    var timer = setTimeout(function() {
      controller.abort();
    }, requestTimeoutMs);

    try {
      var response = await fetch(url, { ...(options || {}), signal: controller.signal });
      return {
        ok: response.ok,
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body: Buffer.from(await response.arrayBuffer())
      };
    } catch (error) {
      lastError = error;
      console.log('FETCH_RETRY', label || url, attempt, error.message || error);
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError || new Error('fetch failed');
}

function stripTemplate(html, roleInfo) {
  return html
    .replace(/<link[^>]+>/g, '')
    .replace(/<script[^>]*><\/script>/g, '')
    .replace(/\{_global_\.z\}/g, 'ateh')
    .replace(/\{_global_\.xsrf\}/g, roleInfo.xsrf || '')
    .replace(/\{_global_\.user\}/g, roleInfo.user || '')
    .replace(/\{_global_\.user_id\}/g, roleInfo.id || '')
    .replace(/\{_global_\.version\}/g, 'issue-3002');
}

function htmlShell(pageDef, body, roleInfo) {
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${pageDef.title}</title>
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background: #f3f5f7;
      color: #17202a;
      font-family: Arial, Helvetica, sans-serif;
    }
    .shot-topbar {
      height: 56px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 18px;
      padding: 0 24px;
      background: #263238;
      color: #fff;
      box-shadow: 0 1px 0 rgba(0, 0, 0, .12);
    }
    .shot-title { font-size: 17px; font-weight: 700; }
    .shot-role { font-size: 13px; opacity: .88; }
    .shot-main { padding: 22px; }
    .issue-3002-focus {
      outline: 3px solid #d97706 !important;
      outline-offset: 2px;
      border-radius: 6px;
    }
    .pi::before { font-style: normal; content: ''; }
  </style>
</head>
<body>
  <header class="shot-topbar">
    <div class="shot-title">Atex · ${pageDef.title}</div>
    <div class="shot-role">${roleInfo.label}</div>
  </header>
  <main class="shot-main">${body}</main>
</body>
</html>`;
}

async function getSession(roleKey) {
  const role = roles[roleKey];
  if (role.session) return role.session;

  const resp = await fetchBodyWithRetry(`${baseUrl}/xsrf?JSON=1`, {
    headers: { 'X-Authorization': role.token }
  }, `xsrf:${roleKey}`);
  const text = resp.body.toString('utf8');

  if (!resp.ok) {
    throw new Error(`xsrf ${roleKey} HTTP ${resp.status}: ${text.slice(0, 200)}`);
  }

  role.session = { ...role, ...JSON.parse(text) };
  return role.session;
}

async function makeContext(browser, session, label) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1
  });
  let logged = 0;

  await context.route(`${baseUrl}/**`, async (route) => {
    const req = route.request();
    try {
      const headers = { ...req.headers(), 'X-Authorization': session.token };
      delete headers.host;
      delete headers['content-length'];
      const body = ['GET', 'HEAD'].includes(req.method()) ? undefined : req.postDataBuffer();
      const response = await fetchBodyWithRetry(req.url(), {
        method: req.method(),
        headers,
        body
      }, `${label}:${req.url()}`);
      const responseHeaders = {
        ...response.headers,
        'access-control-allow-origin': '*'
      };
      delete responseHeaders['content-encoding'];
      delete responseHeaders['content-length'];
      delete responseHeaders['transfer-encoding'];

      if (++logged <= 8) {
        console.log('ROUTE', label, response.status, req.method(), req.url());
      }

      await route.fulfill({
        status: response.status,
        headers: responseHeaders,
        body: response.body
      });
    } catch (error) {
      console.log('ROUTEERR', label, error.message || error);
      try {
        await route.abort();
      } catch (_) {
        // The context may already be closing after the screenshot is captured.
      }
    }
  });

  return context;
}

async function installFetchMapper(page, session) {
  await page.evaluate(({ token, xsrf, user, id, baseUrl }) => {
    window.db = 'ateh';
    window.xsrf = xsrf || '';
    window.token = token;
    window.user = user || '';
    window.uid = id || '';

    const nativeFetch = window.fetch.bind(window);
    window.fetch = function(input, init) {
      init = init || {};
      let url = typeof input === 'string' ? input : input.url;

      if (url.indexOf(baseUrl) !== 0) {
        url = url.charAt(0) === '/'
          ? baseUrl.replace(/\/ateh$/, '') + url
          : `${baseUrl.replace(/\/$/, '')}/${url}`;
      }

      const headers = new Headers(init.headers || (input && input.headers) || {});
      const body = init.body;
      if (body instanceof URLSearchParams && !body.has('token')) {
        body.set('token', token);
      }

      return nativeFetch(url, { ...init, headers, body, credentials: 'omit' });
    };
  }, { ...session, baseUrl });
}

async function addStyles(page, cssNames) {
  for (const relPath of ['css/integram-table.css', 'download/atex/css/atex-brand.css']) {
    if (fs.existsSync(path.join(repo, relPath))) {
      await page.addStyleTag({ content: read(relPath) });
    }
  }

  for (const name of cssNames) {
    await page.addStyleTag({ content: read(`download/atex/css/${name}.css`) });
  }
}

async function bodyText(page) {
  return page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' ').trim());
}

async function waitTextAny(page, needles, label) {
  return waitTextMode(page, needles, label, false);
}

async function waitTextAll(page, needles, label) {
  return waitTextMode(page, needles, label, true);
}

async function waitTextMode(page, needles, label, all) {
  let last = '';

  for (let i = 0; i < 80; i++) {
    last = await bodyText(page);
    if (last.includes('Ошибка')) {
      throw new Error(`${label}: ${last.slice(0, 1000)}`);
    }

    const ok = all
      ? needles.every((needle) => last.includes(needle))
      : needles.some((needle) => last.includes(needle));

    if (ok) return last;
    await page.waitForTimeout(500);
  }

  throw new Error(`${label}: did not find ${needles.join(' | ')}. Last text: ${last.slice(0, 1500)}`);
}

async function waitEval(page, fn, label) {
  for (let i = 0; i < 80; i++) {
    if (await page.evaluate(fn)) return;
    await page.waitForTimeout(500);
  }

  throw new Error(`${label}: condition did not become true`);
}

async function prepareScenario(page, def) {
  if (def.js === 'orders') {
    await page.evaluate(() => document.querySelector('[data-toggle="1966"]')?.click());
    await waitTextAll(page, ['TT-АТХ-3002', '57', '1200.00'], 'orders positions');
  } else if (def.js === 'cut-calc') {
    await page.evaluate(() => {
      Array.from(document.querySelectorAll('.atex-cc-list-item'))
        .find((el) => el.innerText.includes('TT-АТХ-3002'))
        ?.click();
    });
    await waitTextAll(page, ['Тип резки: TT-АТХ-3002-2026-05-31', '57', '10'], 'cut-calc open');
  } else if (def.js === 'intake') {
    await waitEval(page, () => !!document.getElementById('atex-intake')._atexIntake?.batches?.length, 'intake loaded');
    await waitTextAll(page, ['2026-05-31', '3640.00', '2440.00'], 'intake live batch');
  } else if (def.js === 'cut-map') {
    await waitEval(page, () => !!document.getElementById('atex-cut-map')._atexCutMap?.cuts?.length, 'cut-map loaded');
    await page.evaluate(() => document.getElementById('atex-cut-map')._atexCutMap.openCut('1982'));
    await waitTextAll(page, ['TT-АТХ-3002-2026-05-31', '57', '40'], 'cut-map open');
  } else if (def.js === 'slitter') {
    await waitEval(page, () => !!document.getElementById('atex-slitter')._atexSlitter?.cuts?.length, 'slitter loaded');
    await page.evaluate(() => document.getElementById('atex-slitter')._atexSlitter.openCut('1982'));
    await waitTextAll(page, ['TT-АТХ-3002-2026-05-31', '1200', 'Завершён'], 'slitter open');
  } else if (def.js === 'sleeve-cutter') {
    await waitEval(page, () => !!document.getElementById('atex-sleeve-cutter')._atexSleeveCutter?.positions?.length, 'sleeve loaded');
    await page.evaluate(() => document.getElementById('atex-sleeve-cutter')._atexSleeveCutter.openPosition('1974'));
    await waitTextAll(page, ['Втулкорез 3', 'Готово', '10'], 'sleeve open');
  } else if (def.js === 'portal') {
    await waitEval(page, () => !!document.querySelector('[data-toggle="1966"]'), 'portal order row');
    await page.evaluate(() => document.querySelector('[data-toggle="1966"]').click());
    await waitTextAll(page, ['TT-АТХ-3002', '57', '1200.00'], 'portal positions');
  }
}

async function focusNeedle(page, needle) {
  if (!needle) return false;

  const ok = await page.evaluate((needle) => {
    const nodes = Array.from(document.querySelectorAll([
      'tr',
      'button',
      '.atex-cc-form',
      '.atex-in-form',
      '.atex-cm-view',
      '.atex-sl-main',
      '.atex-sc-main',
      '.atex-wh-card',
      '.atex-dashboard-card',
      '.atex-portal-row',
      'section',
      'article',
      'div'
    ].join(',')));

    let best = nodes.find((el) => (el.innerText || '').includes(needle));
    if (!best) {
      best = Array.from(document.querySelectorAll('*'))
        .find((el) => (el.innerText || '').includes(needle));
    }
    if (!best) return false;

    best.classList.add('issue-3002-focus');
    best.scrollIntoView({ block: 'center', inline: 'nearest' });
    return true;
  }, needle);

  if (ok) await page.waitForTimeout(250);
  return ok;
}

async function capture(page, filename) {
  const client = await page.context().newCDPSession(page);
  const data = (await client.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true
  })).data;

  fs.writeFileSync(path.join(outDir, filename), Buffer.from(data, 'base64'));
  await client.detach();
}

async function loadShot(browser, def) {
  const session = await getSession(def.role);
  const context = await makeContext(browser, session, def.file);
  const page = await context.newPage();

  page.on('console', (msg) => console.log('CONSOLE', def.file, msg.type(), msg.text()));
  page.on('pageerror', (err) => console.log('PAGEERROR', def.file, err.message));

  const template = stripTemplate(read(`templates/atex/${def.template}.html`), session);
  await page.setContent(htmlShell(def, template, session), { waitUntil: 'domcontentloaded' });
  await installFetchMapper(page, session);
  await addStyles(page, def.css);
  await page.addScriptTag({ path: path.join(repo, `download/atex/js/${def.js}.js`) });
  await waitTextAny(page, def.ready, `${def.file} ready`);
  await prepareScenario(page, def);

  const focused = await focusNeedle(page, def.focus);
  await capture(page, def.file);
  console.log('SHOT', def.file, `focused=${focused}`);
  console.log('TEXT', (await bodyText(page)).slice(0, 900));

  await page.waitForTimeout(500);
  await context.close();
}

async function main() {
  requireTokens();
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROME || '/usr/bin/google-chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });

  const beforeRole = await getSession('manager');
  const beforeContext = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1
  });
  const beforePage = await beforeContext.newPage();
  const beforeBody = stripTemplate(read('templates/atex/orders.html'), beforeRole);

  await beforePage.setContent(
    htmlShell({ title: 'До исправления: приём заказов' }, beforeBody, beforeRole),
    { waitUntil: 'domcontentloaded' }
  );
  await addStyles(beforePage, ['orders']);
  await capture(beforePage, 'issue-3002-00-before-orders-loading.png');
  console.log('SHOT issue-3002-00-before-orders-loading.png');
  await beforeContext.close();

  for (const def of pages) {
    await loadShot(browser, def);
  }

  await browser.close();
}

main().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});
