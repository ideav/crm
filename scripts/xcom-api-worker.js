'use strict';

const fs = require('fs');
const path = require('path');
const {parentPort, workerData} = require('worker_threads');
const {readDataset, matchDatasets} = require('./xcom-api-lib');
const {persistMatchRun} = require('./xcom-integram-client');

function atomicJson(target, value) {
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value));
  fs.renameSync(temporary, target);
}

async function run() {
  const rfp = readDataset(workerData.rfpPath, workerData.options && workerData.options.rfp);
  const sku = readDataset(workerData.skuPath, workerData.options && workerData.options.sku);
  if (!rfp.rows.length) throw new Error('В заявке нет строк с данными');
  if (!sku.rows.length) throw new Error('В каталоге нет строк с данными');

  parentPort.postMessage({
    type: 'progress',
    phase: 'matching',
    progress: {processed: 0, total: rfp.rows.length},
    files: {
      rfp: {sheet: rfp.sheetName, rows: rfp.rows.length, columns: rfp.headers},
      sku: {sheet: sku.sheetName, rows: sku.rows.length, columns: sku.headers}
    }
  });

  const result = matchDatasets(rfp, sku, workerData.options || {}, progress => {
    parentPort.postMessage({type: 'progress', phase: 'matching', progress});
  });
  let persistence = {backend: 'ephemeral'};
  if (workerData.integram) {
    parentPort.postMessage({
      type: 'progress', phase: 'persisting',
      progress: {processed: rfp.rows.length, total: rfp.rows.length}
    });
    persistence = await persistMatchRun({rfp, sku, result}, workerData.integram);
  }
  const payload = {
    generatedAt: new Date().toISOString(),
    rows: result.rows,
    summary: result.summary,
    mappings: result.mappings,
    persistence,
    files: {
      rfp: {sheet: rfp.sheetName, rows: rfp.rows.length, columns: rfp.headers},
      sku: {sheet: sku.sheetName, rows: sku.rows.length, columns: sku.headers}
    }
  };
  atomicJson(path.resolve(workerData.resultPath), payload);
  parentPort.postMessage({
    type: 'done',
    summary: payload.summary,
    mappings: payload.mappings,
    files: payload.files,
    persistence
  });
}

run().catch(error => {
  parentPort.postMessage({
    type: 'error',
    error: error && error.message ? error.message : 'Не удалось обработать файлы'
  });
});
