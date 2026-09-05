'use strict';

const DEFAULT_CHUNK_BYTES = 7 * 1024 * 1024;

function text(value) {
  return String(value == null ? '' : value).trim();
}

function normalize(value) {
  return text(value).toLowerCase().replace(/ё/g, 'е');
}

function safeCell(value) {
  return text(value).replace(/[;\r\n]+/g, ' ');
}

function findTable(metadata, name) {
  const wanted = normalize(name);
  return (Array.isArray(metadata) ? metadata : []).find(table => normalize(table && table.val) === wanted) || null;
}

function buildBkiLines(dataset, mapping, table, resultIndex) {
  const reqs = Array.isArray(table.reqs) ? table.reqs : [];
  return dataset.rows.map((row, rowIndex) => {
    const id = text(mapping.id && row[mapping.id]) || `${table.val}-${rowIndex + 1}`;
    const result = resultIndex && resultIndex.get(id);
    const values = [id].concat(reqs.map(req => {
      const field = normalize(req && req.val);
      if (field === 'наименование') return mapping.name ? row[mapping.name] : '';
      if (field === 'артикул' || field === 'артикул поставщика') return mapping.article ? row[mapping.article] : '';
      if (field === 'бренд' || field === 'производитель') return mapping.brand ? row[mapping.brand] : '';
      if (field === 'наш артикул') return result ? (result.targetArticle || result.targetId || '0') : '';
      if (field === 'кандидаты') return result ? (result.candidates || []).map(candidate => candidate.article || candidate.id).filter(Boolean).join(', ') : '';
      if (field === 'точность подбора') return result ? result.accuracy : '';
      return '';
    }));
    return values.map(safeCell).join(';') + ';';
  });
}

function chunkBki(lines, maxBytes) {
  const limit = Math.max(1024, Number(maxBytes || DEFAULT_CHUNK_BYTES));
  const chunks = [];
  let current = ['DATA'];
  let size = Buffer.byteLength('DATA\n');
  lines.forEach(line => {
    const lineSize = Buffer.byteLength(line + '\n');
    if (lineSize + Buffer.byteLength('DATA\n') > limit) throw new Error('Одна строка импорта превышает допустимый размер чанка');
    if (current.length > 1 && size + lineSize > limit) {
      chunks.push(current.join('\n') + '\n');
      current = ['DATA'];
      size = Buffer.byteLength('DATA\n');
    }
    current.push(line);
    size += lineSize;
  });
  if (current.length > 1) chunks.push(current.join('\n') + '\n');
  return chunks;
}

class IntegramClient {
  constructor(config, fetchImpl) {
    this.baseUrl = text(config.baseUrl).replace(/\/$/, '');
    this.database = text(config.database).replace(/^\/+|\/+$/g, '');
    this.token = text(config.token);
    this.fetch = fetchImpl || fetch;
    this.xsrf = '';
    if (!this.baseUrl || !this.database || !this.token) throw new Error('Не заполнены INTEGRAM_BASE_URL, INTEGRAM_DB и INTEGRAM_TOKEN');
  }

  url(endpoint) {
    return `${this.baseUrl}/${encodeURIComponent(this.database)}/${String(endpoint || '').replace(/^\/+/, '')}`;
  }

  headers(extra) {
    return Object.assign({
      'X-Authorization': this.token,
      'Cookie': `idb_${this.database}=${this.token}`
    }, extra || {});
  }

  async json(endpoint) {
    const response = await this.fetch(this.url(endpoint), {headers: this.headers()});
    const body = await response.text();
    if (!response.ok) throw new Error(`Integram HTTP ${response.status}: ${body.slice(0, 180)}`);
    try { return JSON.parse(body); } catch (_) { throw new Error('Integram вернул ответ не в формате JSON'); }
  }

  async initialize() {
    const session = await this.json('xsrf?JSON=1');
    this.xsrf = text(session && session._xsrf);
    if (!this.xsrf) throw new Error('Integram не вернул _xsrf для служебной сессии');
    return this;
  }

  async importBki(tableId, contents, filename) {
    const form = new FormData();
    form.append('token', this.token);
    form.append('_xsrf', this.xsrf);
    form.append('bki_file', new Blob([contents], {type: 'text/plain;charset=utf-8'}), filename || 'xcom.bki');
    const response = await this.fetch(this.url(`object/${encodeURIComponent(tableId)}?JSON&import=1`), {
      method: 'POST', headers: this.headers(), body: form
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`Integram import HTTP ${response.status}: ${body.slice(0, 180)}`);
    return body;
  }
}

async function persistMatchRun(input, config, fetchImpl) {
  const client = await new IntegramClient(config, fetchImpl).initialize();
  const metadata = await client.json('metadata?JSON=1');
  const skuTable = findTable(metadata, config.skuTable || 'SKU');
  const rfpTable = findTable(metadata, config.rfpTable || 'RFP');
  if (!skuTable || !rfpTable) throw new Error('В базе Integram не найдены таблицы SKU и RFP; сначала запустите инсталлятор XCOM');

  const resultIndex = new Map(input.result.rows.map(row => [String(row.sourceId), row]));
  const imports = [
    {table: skuTable, lines: buildBkiLines(input.sku, input.result.mappings.sku, skuTable, null), prefix: 'sku'},
    {table: rfpTable, lines: buildBkiLines(input.rfp, input.result.mappings.rfp, rfpTable, resultIndex), prefix: 'rfp'}
  ];
  let chunks = 0;
  for (const item of imports) {
    const bodies = chunkBki(item.lines, config.chunkBytes || DEFAULT_CHUNK_BYTES);
    for (let index = 0; index < bodies.length; index += 1) {
      await client.importBki(item.table.id, bodies[index], `${item.prefix}-${index + 1}.bki`);
      chunks += 1;
    }
  }
  return {backend: 'integram', skuRows: input.sku.rows.length, rfpRows: input.rfp.rows.length, chunks};
}

module.exports = {
  DEFAULT_CHUNK_BYTES,
  safeCell,
  findTable,
  buildBkiLines,
  chunkBki,
  IntegramClient,
  persistMatchRun
};
