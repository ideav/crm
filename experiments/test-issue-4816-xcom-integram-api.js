'use strict';

const assert = require('assert');
const data = require('../demo/xcom/demo-data.json');
const {matchDatasets} = require('../scripts/xcom-api-lib');
const {chunkBki, persistMatchRun} = require('../scripts/xcom-integram-client');

const rfp = {sheetName: data.files.rfp.sheet, headers: data.files.rfp.columns, rows: data.files.rfp.rows};
const sku = {sheetName: data.files.sku.sheet, headers: data.files.sku.columns, rows: data.files.sku.rows};
const result = matchDatasets(rfp, sku, {threshold: 85, grayZoneMin: 30});

const metadata = [
  {id: '500', val: 'SKU', reqs: [
    {id: '501', val: 'Наименование'}, {id: '502', val: 'Артикул'}, {id: '503', val: 'Бренд'}
  ]},
  {id: '600', val: 'RFP', reqs: [
    {id: '601', val: 'Наименование'}, {id: '602', val: 'Артикул поставщика'},
    {id: '603', val: 'Бренд'}, {id: '604', val: 'Наш артикул'},
    {id: '605', val: 'Кандидаты'}, {id: '606', val: 'Точность подбора'}
  ]}
];
const requests = [];

async function fakeFetch(url, options) {
  const request = {url: String(url), options: options || {}};
  requests.push(request);
  assert.strictEqual(request.options.headers['X-Authorization'], 'server-secret', 'token is sent only by server client');
  assert.strictEqual(request.options.headers.Cookie, 'idb_demo=server-secret', 'xsrf session uses matching database cookie');
  if (request.url.endsWith('/xsrf?JSON=1')) {
    return new Response(JSON.stringify({_xsrf: 'xsrf-value'}), {status: 200});
  }
  if (request.url.endsWith('/metadata?JSON=1')) {
    return new Response(JSON.stringify(metadata), {status: 200});
  }
  if (request.url.includes('?JSON&import=1')) {
    assert.strictEqual(request.options.method, 'POST');
    assert.strictEqual(request.options.body.get('token'), 'server-secret');
    assert.strictEqual(request.options.body.get('_xsrf'), 'xsrf-value');
    request.bki = await request.options.body.get('bki_file').text();
    return new Response(JSON.stringify({ok: true}), {status: 200});
  }
  return new Response('not found', {status: 404});
}

(async function test() {
  const persisted = await persistMatchRun({rfp, sku, result}, {
    baseUrl: 'https://integram.example', database: 'demo', token: 'server-secret'
  }, fakeFetch);
  assert.strictEqual(persisted.backend, 'integram');
  assert.strictEqual(persisted.skuRows, 6);
  assert.strictEqual(persisted.rfpRows, 5);

  const imports = requests.filter(request => request.bki);
  assert.strictEqual(imports.length, 2, 'SKU and RFP use bulk import endpoints');
  assert(imports.every(request => request.bki.startsWith('DATA\n')), 'every import chunk starts with DATA');
  assert(imports.every(request => request.bki.trimEnd().endsWith(';')), 'every BKI row has a trailing semicolon');
  const rfpImport = imports.find(request => request.url.includes('/object/600'));
  assert(rfpImport.bki.includes('CE285A'), 'matched article is written into RFP through Integram API');

  const chunks = chunkBki(['one;' + 'x'.repeat(600) + ';', 'two;' + 'y'.repeat(600) + ';'], 1024);
  assert(chunks.length > 1, 'large imports are split below the configured byte limit');
  assert(chunks.every(chunk => Buffer.byteLength(chunk) <= 1024), 'chunk byte limit is respected');

  console.log('OK: test-issue-4816-xcom-integram-api');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
