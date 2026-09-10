'use strict';

const assert = require('assert');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const {spawn, spawnSync} = require('child_process');
const XLSX = require('../js/xlsx0.18.5.full.min.js');
const {createXcomDemoServer} = require('../scripts/xcom-demo-server');

function freePort() {
  return new Promise((resolve, reject) => {
    const socket = net.createServer();
    socket.once('error', reject);
    socket.listen(0, '127.0.0.1', () => {
      const port = socket.address().port;
      socket.close(() => resolve(port));
    });
  });
}

function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function waitJson(url, attempts) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch (error) { lastError = error; }
    await wait(50);
  }
  throw lastError || new Error(`Timed out waiting for ${url}`);
}

function makeWorkbook(file, target) {
  const sheet = XLSX.utils.json_to_sheet(file.rows, {header: file.columns});
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, file.sheet);
  fs.writeFileSync(target, XLSX.write(workbook, {type: 'buffer', bookType: 'xlsx'}));
}

class Cdp {
  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.pending = new Map();
    this.exceptions = [];
  }
  async open() {
    this.socket = new WebSocket(this.url);
    this.socket.onmessage = event => {
      const message = JSON.parse(String(event.data));
      if (message.id && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
      } else if (message.method === 'Runtime.exceptionThrown') {
        this.exceptions.push(message.params.exceptionDetails.text || 'Runtime exception');
      }
    };
    await new Promise((resolve, reject) => {
      this.socket.onopen = resolve;
      this.socket.onerror = reject;
    });
  }
  call(method, params) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, {resolve, reject});
      this.socket.send(JSON.stringify({id, method, params: params || {}}));
    });
  }
  async evaluate(expression) {
    const result = await this.call('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true});
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || expression);
    return result.result.value;
  }
  close() { if (this.socket) this.socket.close(); }
}

async function waitForExpression(cdp, expression, label) {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    if (await cdp.evaluate(expression)) return;
    await wait(50);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function run() {
  const browserExecutable = [
    process.env.CHROME_BIN,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
  ].find(candidate => candidate && fs.existsSync(candidate));
  assert(browserExecutable, 'Chrome, Chromium or Edge is installed');

  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'xcom-browser-test-'));
  const storageRoot = path.join(temporary, 'runs');
  const profile = path.join(temporary, 'browser-profile');
  const rfpFile = path.join(temporary, 'rfp.xlsx');
  const skuFile = path.join(temporary, 'sku.xlsx');
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'demo', 'xcom', 'demo-data.json'), 'utf8'));
  makeWorkbook(data.files.rfp, rfpFile);
  makeWorkbook(data.files.sku, skuFile);

  const server = createXcomDemoServer({storageRoot});
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const appPort = server.address().port;
  const debugPort = await freePort();
  const browser = spawn(browserExecutable, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
    '--no-first-run', '--no-default-browser-check',
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, 'about:blank'
  ], {stdio: 'ignore', windowsHide: true});
  let cdp;

  try {
    await waitJson(`http://127.0.0.1:${debugPort}/json/version`, 160);
    const page = await fetch(
      `http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(`http://127.0.0.1:${appPort}/#setup`)}`,
      {method: 'PUT'}
    ).then(response => response.json());
    cdp = new Cdp(page.webSocketDebuggerUrl);
    await cdp.open();
    await cdp.call('Runtime.enable');
    await cdp.call('Page.enable');

    await waitForExpression(cdp, "document.querySelector('#execution-badge') && document.querySelector('#execution-badge').textContent.includes('Серверная')", 'API mode');
    assert.strictEqual(await cdp.evaluate("document.querySelector('[data-mode=setup]').textContent.includes('Настройка шаблона') && document.querySelector('[data-mode=setup]').textContent.includes('для интегратора')"), true, 'setup mode explains the integrator role');
    assert.strictEqual(await cdp.evaluate("document.querySelector('[data-mode=workspace]').textContent.includes('Рабочее место') && document.querySelector('[data-mode=workspace]').textContent.includes('для оператора')"), true, 'workspace mode explains the operator role');
    assert.strictEqual(await cdp.evaluate("document.querySelector('#workflow-chrome').hidden"), true, 'operator journey stays out of one-time setup');
    assert.strictEqual(await cdp.evaluate("document.querySelector('#step-number').textContent"), '1', 'setup opens on its first step');
    await cdp.evaluate("document.querySelector('#wizard-next').click()");
    assert.strictEqual(await cdp.evaluate("document.querySelector('#step-number').textContent"), '2', 'setup proceeds to column mapping');
    assert.strictEqual(await cdp.evaluate("document.querySelector('[data-step=\"2\"]').textContent.includes('Сейчас товары ещё не сравниваются')"), true, 'column mapping explains its effect');
    assert.strictEqual(await cdp.evaluate("document.querySelector('[data-step=\"2\"] thead').textContent.includes('Уверенность подсказки')"), true, 'mapping confidence is explained in the rendered UI');

    await cdp.evaluate("document.querySelector('[data-page=mass]').click()");
    await waitForExpression(cdp, "document.querySelector('#mass').classList.contains('is-active')", 'operator files step');
    assert.deepStrictEqual(await cdp.evaluate("Array.from(document.querySelectorAll('[data-flow-page]')).map(function (button) { return [button.dataset.flowPage, button.disabled]; })"), [['mass', false], ['review', true], ['export', true]], 'later journey stages start gated');
    assert.deepStrictEqual(await cdp.evaluate("[document.querySelector('#mass-next').hidden, document.querySelector('#review-next').hidden, document.querySelector('#download-export').disabled, document.querySelector('#export-blocker').hidden, document.querySelector('#completion-note').hidden]"), [true, true, true, false, true], 'next actions and export start in the safe state');

    const documentNode = await cdp.call('DOM.getDocument', {depth: -1});
    const rfpNode = await cdp.call('DOM.querySelector', {nodeId: documentNode.root.nodeId, selector: '#run-rfp-input'});
    const skuNode = await cdp.call('DOM.querySelector', {nodeId: documentNode.root.nodeId, selector: '#run-sku-input'});
    await cdp.call('DOM.setFileInputFiles', {nodeId: rfpNode.nodeId, files: [rfpFile]});
    await cdp.evaluate("document.querySelector('#run-rfp-input').dispatchEvent(new Event('change',{bubbles:true}))");
    await cdp.call('DOM.setFileInputFiles', {nodeId: skuNode.nodeId, files: [skuFile]});
    await cdp.evaluate("document.querySelector('#run-sku-input').dispatchEvent(new Event('change',{bubbles:true}))");
    assert.strictEqual(await cdp.evaluate("document.querySelector('#start-match').disabled"), false, 'start is enabled after two files');

    await cdp.evaluate("document.querySelector('#start-match').click()");
    await waitForExpression(cdp, "document.querySelector('#run-status-pill').textContent.includes('завершено')", 'server matching');
    assert.strictEqual(await cdp.evaluate("document.querySelector('#total-stat').textContent"), '5', 'UI shows server total');
    assert.strictEqual(await cdp.evaluate("document.querySelector('#review-stat').textContent"), '1', 'UI shows review queue');
    assert.strictEqual(await cdp.evaluate("document.querySelectorAll('#result-body tr').length"), 5, 'UI renders API result page');
    assert.strictEqual(await cdp.evaluate("document.querySelector('[data-flow-page=review]').disabled"), false, 'review unlocks after matching');
    assert.strictEqual(await cdp.evaluate("document.querySelector('[data-flow-page=export]').disabled"), true, 'export stays locked while a decision is pending');
    assert.strictEqual(await cdp.evaluate("document.querySelector('#mass-next').hidden"), false, 'matching reveals the review action');

    await cdp.evaluate("document.querySelector('#mass-next [data-go=review]').click()");
    await waitForExpression(cdp, "document.querySelector('#review').classList.contains('is-active') && document.querySelector('[data-candidate]')", 'review page');
    await cdp.evaluate("document.querySelector('[data-candidate]').click(); document.querySelector('#accept-candidate').click()");
    await waitForExpression(cdp, "document.querySelector('#review-queue-pill').textContent.includes('завершена')", 'saved API decision');
    assert.strictEqual(await cdp.evaluate("document.querySelector('#download-export').disabled"), false, 'export unlocks after API decision');
    assert.strictEqual(await cdp.evaluate("document.querySelector('#review-next').hidden"), false, 'saved decision reveals the export action');
    assert.strictEqual(await cdp.evaluate("document.querySelector('[data-flow-page=export]').disabled"), false, 'export stage unlocks after review');
    assert.deepStrictEqual(await cdp.evaluate("[document.querySelector('#export-blocker').hidden, document.querySelector('#completion-note').hidden]"), [true, false], 'completed journey replaces the blocker with a repeat action');

    await cdp.evaluate("document.querySelector('#review-next [data-go=export]').click()");
    await waitForExpression(cdp, "document.querySelector('#export').classList.contains('is-active')", 'export page');
    await cdp.evaluate("document.querySelector('#completion-note [data-go=mass]').click()");
    await waitForExpression(cdp, "document.querySelector('#mass').classList.contains('is-active')", 'new run');
    assert.deepStrictEqual(await cdp.evaluate("[document.querySelector('[data-flow-page=review]').disabled, document.querySelector('[data-flow-page=export]').disabled, document.querySelector('#mass-next').hidden, document.querySelector('#download-export').disabled, document.querySelector('#completion-note').hidden]"), [true, true, true, true, true], 'new run resets journey gates');
    assert.strictEqual(cdp.exceptions.length, 0, `browser has no runtime exceptions: ${cdp.exceptions.join('; ')}`);

    console.log('OK: test-issue-4816-xcom-api-browser');
  } finally {
    if (cdp) {
      try { await cdp.call('Browser.close'); } catch (_) {}
      cdp.close();
    }
    if (browser.exitCode == null) {
      await Promise.race([
        new Promise(resolve => browser.once('exit', resolve)),
        wait(1000).then(() => { if (browser.exitCode == null) browser.kill(); })
      ]);
    }
    await new Promise(resolve => server.close(resolve));
    try {
      fs.rmSync(temporary, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
    } catch (error) {
      // Edge/Windows иногда оставляет Crashpad с открытым profile lock уже после
      // Browser.close. Это не результат теста; системный TEMP будет очищен ОС.
      if (error.code !== 'EPERM') throw error;
    }
  }
}

if (typeof WebSocket === 'undefined') {
  if (process.env.XCOM_BROWSER_WS_CHILD === '1') {
    console.error(new Error('Node.js cannot enable the WebSocket client required by the browser test'));
    process.exitCode = 1;
  } else {
    const child = spawnSync(process.execPath, ['--experimental-websocket', __filename], {
      stdio: 'inherit',
      env: Object.assign({}, process.env, {XCOM_BROWSER_WS_CHILD:'1'})
    });
    if (child.error) console.error(child.error);
    process.exitCode = child.error ? 1 : (child.status == null ? 1 : child.status);
  }
} else {
  run().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
