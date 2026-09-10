'use strict';

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const {Worker} = require('worker_threads');
const XLSX = require('../js/xlsx0.18.5.full.min.js');
const {summarize} = require('./xcom-api-lib');

const root = path.resolve(__dirname, '..');
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
};

function atomicJson(target, value) {
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value));
  fs.renameSync(temporary, target);
}

function createXcomDemoServer(options) {
  const opts = options || {};
  const storageRoot = path.resolve(opts.storageRoot || process.env.XCOM_API_STORAGE || path.join(os.tmpdir(), 'xcom-demo-runs'));
  const maxFileBytes = Number(opts.maxFileBytes || process.env.XCOM_MAX_FILE_BYTES || 64 * 1024 * 1024);
  const runTtlMs = Number(opts.runTtlMs || process.env.XCOM_RUN_TTL_MS || 60 * 60 * 1000);
  const allowedOrigins = opts.allowedOrigins || String(process.env.XCOM_ALLOWED_ORIGINS || '')
    .split(',').map(value => value.trim()).filter(Boolean);
  const runsPerHour = Number(opts.runsPerHour || process.env.XCOM_RUNS_PER_HOUR || 20);
  const envIntegram = {
    baseUrl: process.env.INTEGRAM_BASE_URL,
    database: process.env.INTEGRAM_DB,
    token: process.env.INTEGRAM_TOKEN
  };
  const integram = opts.integram || (envIntegram.baseUrl && envIntegram.database && envIntegram.token ? envIntegram : null);
  const workers = new Map();
  const rateBuckets = new Map();
  fs.mkdirSync(storageRoot, {recursive: true});

  function runDir(id) {
    if (!/^[a-f0-9]{32}$/.test(id)) return '';
    return path.join(storageRoot, id);
  }

  function metaPath(id) {
    const directory = runDir(id);
    return directory ? path.join(directory, 'run.json') : '';
  }

  function readRun(id) {
    const target = metaPath(id);
    if (!target || !fs.existsSync(target)) return null;
    try { return JSON.parse(fs.readFileSync(target, 'utf8')); } catch (_) { return null; }
  }

  function writeRun(run) {
    atomicJson(metaPath(run.id), run);
    return run;
  }

  function updateRun(id, changes) {
    const current = readRun(id);
    if (!current) return null;
    const next = Object.assign({}, current, changes || {}, {updatedAt: Date.now()});
    if (changes && changes.progress) next.progress = Object.assign({}, current.progress || {}, changes.progress);
    if (changes && changes.files) next.files = Object.assign({}, current.files || {}, changes.files);
    return writeRun(next);
  }

  function publicRun(run) {
    if (!run) return null;
    const result = JSON.parse(JSON.stringify(run));
    Object.keys(result.files || {}).forEach(role => { delete result.files[role].storedName; });
    return result;
  }

  function responseHeaders(res, type, extra) {
    return Object.assign({
      'Content-Type': type,
      'Cache-Control': 'no-store'
    }, res.xcomCorsHeaders || {}, extra || {});
  }

  function send(res, status, body, type, extra) {
    res.writeHead(status, responseHeaders(res, type || 'text/plain; charset=utf-8', extra));
    res.end(body);
  }

  function sendJson(res, status, value) {
    send(res, status, JSON.stringify(value), mime['.json']);
  }

  function apiError(res, status, message) {
    sendJson(res, status, {error: message});
  }

  function requestOrigin(req) {
    const protocol = req.socket && req.socket.encrypted ? 'https' : 'http';
    return `${protocol}://${req.headers.host || '127.0.0.1'}`;
  }

  function allowApiOrigin(req, res) {
    const origin = req.headers.origin;
    if (!origin) return true;
    const allowed = origin === requestOrigin(req) || allowedOrigins.includes(origin);
    if (!allowed) return false;
    res.xcomCorsHeaders = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Vary': 'Origin'
    };
    return true;
  }

  function readJson(req, limit) {
    const max = limit || 64 * 1024;
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', chunk => {
        size += chunk.length;
        if (size > max) {
          reject(Object.assign(new Error('Слишком большой JSON-запрос'), {statusCode: 413}));
          req.resume();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => {
        if (!chunks.length) return resolve({});
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch (_) { reject(Object.assign(new Error('Некорректный JSON'), {statusCode: 400})); }
      });
      req.on('error', reject);
    });
  }

  function streamUpload(req, target) {
    return new Promise((resolve, reject) => {
      const declared = Number(req.headers['content-length'] || 0);
      if (declared > maxFileBytes) {
        req.resume();
        return reject(Object.assign(new Error(`Файл больше ${Math.round(maxFileBytes / 1024 / 1024)} МБ`), {statusCode: 413}));
      }
      const temporary = `${target}.${process.pid}.upload`;
      const output = fs.createWriteStream(temporary, {flags: 'wx'});
      let size = 0;
      let settled = false;
      function fail(error) {
        if (settled) return;
        settled = true;
        output.destroy();
        fs.rm(temporary, {force: true}, () => {});
        reject(error);
      }
      req.on('data', chunk => {
        size += chunk.length;
        if (size > maxFileBytes) fail(Object.assign(new Error(`Файл больше ${Math.round(maxFileBytes / 1024 / 1024)} МБ`), {statusCode: 413}));
      });
      req.on('error', fail);
      output.on('error', fail);
      output.on('finish', () => {
        if (settled) return;
        settled = true;
        fs.renameSync(temporary, target);
        resolve(size);
      });
      req.pipe(output);
    });
  }

  function makeWorkbook(file, target) {
    const sheet = XLSX.utils.json_to_sheet(file.rows, {header: file.columns});
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, file.sheet);
    fs.writeFileSync(target, XLSX.write(workbook, {type: 'buffer', bookType: 'xlsx'}));
  }

  function createRun(useDemo) {
    const id = crypto.randomBytes(16).toString('hex');
    const directory = runDir(id);
    fs.mkdirSync(directory, {recursive: false});
    const now = Date.now();
    const run = {
      id,
      status: 'draft',
      phase: 'upload',
      createdAt: now,
      updatedAt: now,
      expiresAt: now + runTtlMs,
      progress: {processed: 0, total: 0},
      files: {},
      summary: null,
      mappings: null,
      backend: integram ? 'integram' : 'ephemeral',
      persistence: null,
      error: null
    };
    if (useDemo) {
      const data = JSON.parse(fs.readFileSync(path.join(root, 'demo', 'xcom', 'demo-data.json'), 'utf8'));
      ['rfp', 'sku'].forEach(role => {
        const storedName = `${role}.xlsx`;
        const target = path.join(directory, storedName);
        makeWorkbook(data.files[role], target);
        run.files[role] = {name: data.files[role].filename, size: fs.statSync(target).size, storedName};
      });
    }
    writeRun(run);
    return run;
  }

  function loadResult(id) {
    const target = path.join(runDir(id), 'result.json');
    if (!fs.existsSync(target)) return null;
    try { return JSON.parse(fs.readFileSync(target, 'utf8')); } catch (_) { return null; }
  }

  function resultPath(id) {
    return path.join(runDir(id), 'result.json');
  }

  function startWorker(run, options) {
    const directory = runDir(run.id);
    const worker = new Worker(path.join(__dirname, 'xcom-api-worker.js'), {
      workerData: {
        rfpPath: path.join(directory, run.files.rfp.storedName),
        skuPath: path.join(directory, run.files.sku.storedName),
        resultPath: resultPath(run.id),
        options: options || {},
        integram
      }
    });
    workers.set(run.id, worker);
    updateRun(run.id, {status: 'processing', phase: 'reading', error: null});
    worker.on('message', message => {
      if (!message || !message.type) return;
      if (message.type === 'progress') {
        updateRun(run.id, {phase: message.phase, progress: message.progress, files: message.files});
      } else if (message.type === 'done') {
        updateRun(run.id, {
          status: 'done', phase: 'done', summary: message.summary,
          mappings: message.mappings, files: message.files,
          persistence: message.persistence,
          progress: {processed: message.summary.total, total: message.summary.total}
        });
      } else if (message.type === 'error') {
        updateRun(run.id, {status: 'error', phase: 'error', error: message.error});
      }
    });
    worker.on('error', error => {
      updateRun(run.id, {status: 'error', phase: 'error', error: error.message || 'Серверная задача завершилась с ошибкой'});
    });
    worker.on('exit', code => {
      workers.delete(run.id);
      const latest = readRun(run.id);
      if (code !== 0 && latest && latest.status === 'processing') {
        updateRun(run.id, {status: 'error', phase: 'error', error: `Обработчик остановился с кодом ${code}`});
      }
    });
  }

  function checkRate(req) {
    const key = req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : 'unknown';
    const now = Date.now();
    const bucket = (rateBuckets.get(key) || []).filter(time => now - time < 60 * 60 * 1000);
    if (bucket.length >= runsPerHour) return false;
    bucket.push(now);
    rateBuckets.set(key, bucket);
    return true;
  }

  function cleanupExpired() {
    const now = Date.now();
    fs.readdirSync(storageRoot, {withFileTypes: true}).forEach(entry => {
      if (!entry.isDirectory() || !/^[a-f0-9]{32}$/.test(entry.name)) return;
      const run = readRun(entry.name);
      if (!run || Number(run.expiresAt || 0) > now || workers.has(entry.name)) return;
      fs.rmSync(runDir(entry.name), {recursive: true, force: true});
    });
  }

  async function handleApi(req, res, url) {
    if (!allowApiOrigin(req, res)) return apiError(res, 403, 'Этот источник не разрешён для API');
    if (req.method === 'OPTIONS') return send(res, 204, '', 'text/plain; charset=utf-8');
    if (url.pathname === '/demo/api/health' && req.method === 'GET') {
      return sendJson(res, 200, {
        service: 'xcom-matching-api',
        status: 'ok',
        maxFileBytes,
        runTtlSeconds: Math.round(runTtlMs / 1000),
        execution: 'server-worker',
        backend: integram ? 'integram' : 'ephemeral'
      });
    }
    if (url.pathname === '/demo/api/runs' && req.method === 'POST') {
      if (!checkRate(req)) return apiError(res, 429, 'Слишком много запусков. Попробуйте позже.');
      const body = await readJson(req);
      const run = createRun(Boolean(body.demo));
      return sendJson(res, 201, {run: publicRun(run)});
    }

    const fileMatch = url.pathname.match(/^\/demo\/api\/runs\/([a-f0-9]{32})\/files\/(rfp|sku)$/);
    if (fileMatch && req.method === 'PUT') {
      const run = readRun(fileMatch[1]);
      if (!run) return apiError(res, 404, 'Запуск не найден или уже удалён');
      if (run.status !== 'draft') return apiError(res, 409, 'Файлы этого запуска уже обрабатываются');
      const filename = path.basename(url.searchParams.get('filename') || `${fileMatch[2]}.xlsx`);
      const extension = path.extname(filename).toLowerCase();
      if (!['.xlsx', '.xls', '.csv'].includes(extension)) return apiError(res, 415, 'Поддерживаются XLSX, XLS и CSV');
      const storedName = `${fileMatch[2]}${extension}`;
      const size = await streamUpload(req, path.join(runDir(run.id), storedName));
      const next = updateRun(run.id, {files: {[fileMatch[2]]: {name: filename, size, storedName}}});
      return sendJson(res, 200, {run: publicRun(next)});
    }

    const startMatch = url.pathname.match(/^\/demo\/api\/runs\/([a-f0-9]{32})\/start$/);
    if (startMatch && req.method === 'POST') {
      const run = readRun(startMatch[1]);
      if (!run) return apiError(res, 404, 'Запуск не найден или уже удалён');
      if (run.status !== 'draft') return apiError(res, 409, 'Запуск уже начат');
      if (!run.files.rfp || !run.files.sku) return apiError(res, 400, 'Нужно загрузить заявку и каталог');
      const body = await readJson(req);
      startWorker(run, body);
      return sendJson(res, 202, {run: publicRun(readRun(run.id))});
    }

    const runMatch = url.pathname.match(/^\/demo\/api\/runs\/([a-f0-9]{32})$/);
    if (runMatch && req.method === 'GET') {
      const run = readRun(runMatch[1]);
      if (!run) return apiError(res, 404, 'Запуск не найден или уже удалён');
      return sendJson(res, 200, {run: publicRun(run)});
    }

    const resultsMatch = url.pathname.match(/^\/demo\/api\/runs\/([a-f0-9]{32})\/results$/);
    if (resultsMatch && req.method === 'GET') {
      const run = readRun(resultsMatch[1]);
      if (!run) return apiError(res, 404, 'Запуск не найден или уже удалён');
      if (run.status !== 'done') return apiError(res, 409, 'Результат ещё не готов');
      const result = loadResult(run.id);
      if (!result) return apiError(res, 500, 'Файл результата недоступен');
      const status = url.searchParams.get('status');
      const filtered = status ? result.rows.filter(row => row.status === status) : result.rows;
      const offset = Math.max(0, Number(url.searchParams.get('offset') || 0));
      const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit') || 100)));
      return sendJson(res, 200, {
        rows: filtered.slice(offset, offset + limit),
        offset, limit, total: filtered.length,
        summary: result.summary,
        mappings: result.mappings
      });
    }

    const decisionMatch = url.pathname.match(/^\/demo\/api\/runs\/([a-f0-9]{32})\/decisions$/);
    if (decisionMatch && req.method === 'POST') {
      const run = readRun(decisionMatch[1]);
      if (!run) return apiError(res, 404, 'Запуск не найден или уже удалён');
      if (run.status !== 'done') return apiError(res, 409, 'Результат ещё не готов');
      const body = await readJson(req);
      const result = loadResult(run.id);
      const row = result && result.rows.find(item => String(item.sourceId) === String(body.sourceId));
      if (!row) return apiError(res, 404, 'Позиция заявки не найдена');
      if (body.targetId == null || body.targetId === '') {
        row.targetId = null;
        row.target = 'Подходящий товар не найден';
        row.accuracy = 0;
        row.price = null;
        row.status = 'empty';
      } else {
        const candidate = (row.candidates || []).find(item => String(item.id) === String(body.targetId));
        if (!candidate) return apiError(res, 400, 'Кандидат не относится к этой позиции');
        row.targetId = candidate.id;
        row.target = candidate.name;
        row.accuracy = candidate.accuracy;
        row.price = candidate.price;
        row.status = 'matched';
      }
      row.candidates = [];
      result.summary = summarize(result.rows);
      atomicJson(resultPath(run.id), result);
      updateRun(run.id, {summary: result.summary});
      return sendJson(res, 200, {row, summary: result.summary});
    }

    const exportMatch = url.pathname.match(/^\/demo\/api\/runs\/([a-f0-9]{32})\/export$/);
    if (exportMatch && req.method === 'GET') {
      const run = readRun(exportMatch[1]);
      if (!run) return apiError(res, 404, 'Запуск не найден или уже удалён');
      const result = loadResult(run.id);
      if (!result) return apiError(res, 409, 'Результат ещё не готов');
      const rows = result.rows.map(row => ({
        'ID заявки': row.sourceId,
        'Позиция заявки': row.source,
        'ID товара': row.targetId || '',
        'Подобранный товар': row.target,
        'Совпадение, %': row.accuracy,
        'Статус': row.status,
        'Цена, руб.': row.price == null ? '' : row.price
      }));
      if (url.searchParams.get('format') === 'json') {
        return send(res, 200, JSON.stringify({
          meta: {generatedAt: result.generatedAt, runId: run.id, summary: result.summary}, rows
        }, null, 2), mime['.json'], {
          'Content-Disposition': `attachment; filename="xcom-${run.id.slice(0, 8)}.json"`
        });
      }
      const sheet = XLSX.utils.json_to_sheet(rows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, sheet, 'Сопоставление');
      const buffer = XLSX.write(workbook, {type: 'buffer', bookType: 'xlsx'});
      return send(res, 200, buffer, mime['.xlsx'], {
        'Content-Disposition': `attachment; filename="xcom-${run.id.slice(0, 8)}.xlsx"`,
        'Content-Length': buffer.length
      });
    }

    return apiError(res, 404, 'Метод API не найден');
  }

  function handleStatic(req, res, url) {
    if (url.pathname === '/') {
      res.writeHead(302, {'Location': '/demo/xcom/'});
      return res.end();
    }
    const fileMatch = url.pathname.match(/^\/demo\/files\/(rfp|sku)\.xlsx$/);
    if (fileMatch) {
      const data = JSON.parse(fs.readFileSync(path.join(root, 'demo', 'xcom', 'demo-data.json'), 'utf8'));
      const file = data.files[fileMatch[1]];
      const sheet = XLSX.utils.json_to_sheet(file.rows, {header: file.columns});
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, sheet, file.sheet);
      const body = XLSX.write(workbook, {type: 'buffer', bookType: 'xlsx'});
      return send(res, 200, body, mime['.xlsx'], {
        'Content-Disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(file.filename),
        'Content-Length': body.length
      });
    }
    if (url.pathname === '/demo/api/matching_export') {
      const data = JSON.parse(fs.readFileSync(path.join(root, 'demo', 'xcom', 'demo-data.json'), 'utf8'));
      return sendJson(res, 200, {generatedAt: new Date().toISOString(), demo: true, rows: data.results});
    }
    const requested = url.pathname === '/demo/xcom/' ? '/demo/xcom/index.html' : decodeURIComponent(url.pathname);
    const filePath = path.resolve(root, `.${requested}`);
    if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) return send(res, 403, 'Forbidden');
    fs.stat(filePath, (error, stat) => {
      if (error || !stat.isFile()) return send(res, 404, 'Not found');
      res.writeHead(200, responseHeaders(res, mime[path.extname(filePath).toLowerCase()] || 'application/octet-stream'));
      fs.createReadStream(filePath).pipe(res);
    });
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
    const task = url.pathname.startsWith('/demo/api/')
      ? handleApi(req, res, url)
      : Promise.resolve(handleStatic(req, res, url));
    Promise.resolve(task).catch(error => {
      if (res.headersSent) return res.destroy();
      apiError(res, error.statusCode || 500, error.message || 'Внутренняя ошибка API');
    });
  });

  const cleanupTimer = setInterval(cleanupExpired, Math.min(runTtlMs, 10 * 60 * 1000));
  cleanupTimer.unref();
  server.on('close', () => {
    clearInterval(cleanupTimer);
    workers.forEach(worker => worker.terminate());
    workers.clear();
  });
  server.xcom = {storageRoot, cleanupExpired};
  return server;
}

if (require.main === module) {
  const port = Number(process.env.XCOM_DEMO_PORT || 8765);
  const server = createXcomDemoServer();
  server.listen(port, '127.0.0.1', () => {
    console.log(`XCOM demo with API: http://127.0.0.1:${port}/`);
  });
}

module.exports = {createXcomDemoServer};
