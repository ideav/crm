#!/usr/bin/env node
'use strict';

const { APPS, chromium, CHROME, makeContext, openPage, bodyText } = require('./capture.js');
const S = require('./demo-sz.js');
const C = require('./demo-charts.js');

const target = process.argv[2];   // clients | dashboard
const OUT = process.argv[3] || `/tmp/sz-${target}.png`;

const SCENES = {
  capital: {
    path: '/dash/1161',
    viewport: { width: 1600, height: 1000 },
    settle: 22000,
    fixtures: [
      [/\/report\/.*modelID/i, (real) => S.fillDashboard(real)],
      [/\/report\/158715\b/, (real) => C.asReport(real, C.shareholders())],
      [/\/report\/158810\b/, (real) => C.asReport(real, C.valuationHistory())],
    ],
    after: async (page) => {
      await page.evaluate(() => {
        const t = document.getElementById('158685');
        if (t) (t.matches('a,button') ? t : t.querySelector('a,button') || t).click();
      });
      await page.waitForTimeout(14000);
    },
  },
  invest: {
    path: '/dash/1161',
    viewport: { width: 1600, height: 1000 },
    settle: 22000,
    fixtures: [
      [/\/report\/.*modelID/i, (real) => S.fillDashboard(real)],
      [/\/report\/445106\b/, (real) => C.asReport(real, C.threeYearSeries())],
      [/\/report\/452608\b/, (real) => C.asReport(real, C.currentYearSegments())],
      [/\/report\/159287\b/, (real) => C.asReport(real, C.loans())],
    ],
    after: async (page) => {
      await page.evaluate(() => {
        const t = document.getElementById('158931');
        if (t) (t.matches('a,button') ? t : t.querySelector('a,button') || t).click();
      });
      await page.waitForTimeout(14000);
    },
  },
  tables: {
    path: '/tables',
    viewport: { width: 1500, height: 860 },
    settle: 6000,
    fixtures: [],
  },
  api: {
    path: '/object/415/?JSON_OBJ&LIMIT=0,6',
    viewport: { width: 1200, height: 620 },
    settle: 3000,
    fixtures: [
      [/\/object\/415\/\?JSON_OBJ/, (_real, url) => {
        const { offset, limit } = S.parseLimit(url);
        return S.clientRows(offset, Math.min(limit, 6));
      }],
    ],
  },
  clients: {
    path: '/table/415',
    viewport: { width: 1600, height: 820 },
    settle: 7000,
    fixtures: [
      [/\/object\/415\/\?JSON_OBJ/, (_real, url) => {
        const { offset, limit } = S.parseLimit(url);
        return S.clientRows(offset, limit);
      }],
    ],
  },
  dashboard: {
    path: '/dash/1161',
    viewport: { width: 1600, height: 1020 },
    fullPage: true,
    settle: 25000,
    fixtures: [
      [/\/report\/.*modelID/i, (real) => S.fillDashboard(real)],
      [/%D0%97%D0%BD%D0%B0%D1%87%D0%B5%D0%BD%D0%B8%D1%8F%D0%97%D0%B0%D0%9F%D0%B5%D1%80%D0%B8%D0%BE%D0%B4/i, () => S.ceoValuesFeed()],
    ],
    after: async (page) => {
      // Лист «Показатели для CEO» (sheetID=1883): его панели однокол`оночные
      await page.evaluate(() => {
        const tab = document.getElementById('1883');
        if (!tab) return;
        const link = tab.matches('a,button') ? tab : tab.querySelector('a,button');
        (link || tab).click();
      });
      await page.waitForTimeout(6000);
    },
  },
};

/** Общая косметика: закрыть баннер cookie, убрать реальный логин из шапки. */
async function polish(page) {
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button, a')).find((b) => (b.textContent || '').trim() === 'Принять');
    if (btn) btn.click();
  });
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    // Баннер cookie, если остался
    document.querySelectorAll('.cookie-banner, .cookie-consent, [class*="cookie"]').forEach((el) => {
      const t = (el.textContent || '');
      if (t.includes('куки') || t.includes('cookie')) el.remove();
    });
    // Имя реального служебного пользователя в шапке -> демо-роль
    document.querySelectorAll('*').forEach((el) => {
      if (el.children.length === 0 && /Claude\s*\/\s*Read/i.test(el.textContent || '')) {
        el.textContent = 'Смирнова А. П. / Менеджер';
      }
    });
    document.querySelectorAll('*').forEach((el) => {
      if (el.children.length === 0 && (el.textContent || '').trim() === 'C') el.textContent = 'С';
    });
  });
  await page.waitForTimeout(300);
}

(async () => {
  const scene = SCENES[target];
  if (!scene) throw new Error(`unknown scene: ${target}`);

  const app = APPS.sportzania;
  const browser = await chromium.launch(CHROME ? { executablePath: CHROME, args: ['--no-sandbox'] } : { args: ['--no-sandbox'] });
  try {
    const context = await makeContext(browser, app, { fixtures: scene.fixtures, viewport: scene.viewport });
    const page = await openPage(context, app, scene.path, scene.settle);
    if (scene.after) await scene.after(page);
    await polish(page);
    console.log('TEXT:', (await bodyText(page)).slice(0, 500));
    await page.screenshot({ path: OUT, fullPage: !!scene.fullPage });
    console.log('SAVED', OUT);
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error('FATAL', String(e.message || e).slice(0, 250)); process.exit(1); });
