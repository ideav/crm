'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const XLSX = require('../js/xlsx0.18.5.full.min.js');
const {createXcomDemoServer} = require('../scripts/xcom-demo-server');

function workbookBuffer(file) {
  const sheet = XLSX.utils.json_to_sheet(file.rows, {header: file.columns});
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, file.sheet);
  return XLSX.write(workbook, {type: 'buffer', bookType: 'xlsx'});
}

async function jsonRequest(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json();
  if (!response.ok) throw new Error(`${response.status}: ${payload.error || 'request failed'}`);
  return payload;
}

async function waitForRun(base, id) {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const payload = await jsonRequest(`${base}/demo/api/runs/${id}`);
    if (payload.run.status === 'done') return payload.run;
    if (payload.run.status === 'error') throw new Error(payload.run.error);
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error('API run timed out');
}

(async function test() {
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xcom-api-test-'));
  const server = createXcomDemoServer({storageRoot, runTtlMs: 60 * 1000});
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const health = await jsonRequest(`${base}/demo/api/health`);
    assert.strictEqual(health.execution, 'server-worker', 'matching runs outside the page thread');

    // Встроенные файлы проходят тот же API и worker, что пользовательские.
    const createdDemo = await jsonRequest(`${base}/demo/api/runs`, {
      method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({demo: true})
    });
    const demoId = createdDemo.run.id;
    assert.strictEqual(createdDemo.run.files.rfp.storedName, undefined, 'server paths are not exposed');
    await jsonRequest(`${base}/demo/api/runs/${demoId}/start`, {
      method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({threshold: 85})
    });
    const demoRun = await waitForRun(base, demoId);
    assert.strictEqual(demoRun.progress.processed, 5, 'all RFP rows are processed on the server');
    assert.strictEqual(demoRun.summary.total, 5, 'summary comes from server result');

    const firstPage = await jsonRequest(`${base}/demo/api/runs/${demoId}/results?offset=0&limit=2`);
    assert.strictEqual(firstPage.rows.length, 2, 'result endpoint is paginated');
    assert.strictEqual(firstPage.total, 5, 'pagination reports the full result size');

    const reviewPage = await jsonRequest(`${base}/demo/api/runs/${demoId}/results?status=review&limit=1`);
    if (reviewPage.rows.length) {
      const row = reviewPage.rows[0];
      const target = row.candidates[0];
      assert(target, 'review row contains server-ranked candidates');
      const decision = await jsonRequest(`${base}/demo/api/runs/${demoId}/decisions`, {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({sourceId: row.sourceId, targetId: target.id})
      });
      assert.strictEqual(decision.row.status, 'matched', 'manual decision is persisted by API');
      assert.strictEqual(decision.summary.review, demoRun.summary.review - 1, 'server summary reflects the decision');
    }

    const exportedJson = await fetch(`${base}/demo/api/runs/${demoId}/export?format=json`);
    assert(exportedJson.ok, 'JSON export is generated on the server');
    const jsonBody = await exportedJson.json();
    assert.strictEqual(jsonBody.rows.length, 5, 'JSON export contains every row');
    const exportedXlsx = await fetch(`${base}/demo/api/runs/${demoId}/export?format=xlsx`);
    assert(exportedXlsx.ok, 'XLSX export is generated on the server');
    assert((await exportedXlsx.arrayBuffer()).byteLength > 1000, 'XLSX export is not empty');

    // Пользовательские файлы отправляются сырыми: браузер не вызывает SheetJS и не
    // держит разобранный каталог в памяти.
    const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'demo', 'xcom', 'demo-data.json'), 'utf8'));
    const createdCustom = await jsonRequest(`${base}/demo/api/runs`, {
      method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{}'
    });
    const customId = createdCustom.run.id;
    for (const role of ['rfp', 'sku']) {
      const response = await fetch(`${base}/demo/api/runs/${customId}/files/${role}?filename=${encodeURIComponent(data.files[role].filename)}`, {
        method: 'PUT',
        headers: {'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'},
        body: workbookBuffer(data.files[role])
      });
      assert(response.ok, `raw ${role} workbook upload succeeds`);
    }
    await jsonRequest(`${base}/demo/api/runs/${customId}/start`, {
      method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({threshold: 85})
    });
    const customRun = await waitForRun(base, customId);
    assert.strictEqual(customRun.summary.total, 5, 'uploaded workbooks use the same API pipeline');

    console.log('OK: test-issue-4816-xcom-api');
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(storageRoot, {recursive: true, force: true});
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
