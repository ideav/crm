#!/usr/bin/env node
'use strict';

const { APPS, chromium, CHROME, makeContext, openPage, bodyText } = require('./capture.js');
const D = require('./demo-data.js');

const OUT = process.argv[2] || '/tmp/kanban.png';

const FIXTURES = [
  [/\/report\/3769\b/, () => D.kanbanCards()],
  [/\/report\/3796\b/, () => D.stages()],
  [/\/report\/5230\b/, () => D.refList(D.MANAGERS, 'Пользователь')],
  [/\/report\/5172\b/, () => D.refList(D.PRODUCTS, 'Продукт')],
  [/\/report\/5089\b/, () => D.PARTNERS.map((p) => ({ 'Партнер': p.name, 'ПартнерID': p.id, 'ДистрибьюторID': '' }))],
  [/\/report\/4506\b/, () => D.refList(D.DISTRIBUTORS, 'Дистрибьютор')],
  [/\/report\/4500\b/, () => D.refList(D.SOURCES, 'Источник')],
];

(async () => {
  const app = APPS.crm;
  const browser = await chromium.launch(CHROME ? { executablePath: CHROME, args: ['--no-sandbox'] } : { args: ['--no-sandbox'] });
  try {
    const context = await makeContext(browser, app, { fixtures: FIXTURES, viewport: { width: 1920, height: 940 } });
    const page = await openPage(context, app, '/kanban', 9000);

    // Косметика: убрать служебную отладочную плашку внизу (счётчик запросов и таймингов)
    await page.evaluate(() => {
      document.querySelectorAll('.dropdown-menu.show, .show').forEach((el) => el.classList.remove('show'));
      Array.from(document.querySelectorAll('*')).forEach((el) => {
        const t = (el.textContent || '').trim();
        if (el.children.length === 0 && /^\[[^\]]+\]\s*\d+\s*\/\s*[\d.]+\s*\/\s*[\d.]+/.test(t)) {
          const box = el.closest('div') || el;
          box.style.visibility = 'hidden';
        }
      });
    });
    await page.waitForTimeout(600);

    console.log('TEXT:', (await bodyText(page)).slice(0, 400));
    await page.screenshot({ path: OUT });
    console.log('SAVED', OUT);
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error('FATAL', String(e.message || e).slice(0, 250)); process.exit(1); });
