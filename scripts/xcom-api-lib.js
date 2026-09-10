'use strict';

const fs = require('fs');
const XLSX = require('../js/xlsx0.18.5.full.min.js');

const DEFAULT_MATCH_CONFIG = {
  threshold: 85,
  grayZoneMin: 30,
  tmaWeight: 0.5,
  maxCandidates: 3,
  maxCandidatePool: 600
};

const HEADER_ALIASES = {
  rfp: {
    id: ['id', 'номер', 'номер строки', 'код заявки', 'позиция'],
    name: ['наименование', 'название', 'товар', 'описание', 'номенклатура'],
    article: ['код производителя', 'артикул', 'part number', 'partnumber', 'код товара'],
    brand: ['бренд', 'производитель', 'марка'],
    price: ['предельная цена', 'максимальная цена', 'бюджет', 'цена']
  },
  sku: {
    id: ['sku', 'sku id', 'id', 'код sku', 'код позиции', 'код товара'],
    name: ['название', 'наименование', 'товар', 'описание', 'номенклатура'],
    article: ['артикул', 'код производителя', 'part number', 'partnumber', 'код товара'],
    brand: ['производитель', 'бренд', 'марка'],
    price: ['цена, руб.', 'цена руб', 'цена', 'стоимость']
  }
};

const STOP_TOKENS = new Set([
  'и', 'или', 'для', 'на', 'в', 'во', 'с', 'со', 'по', 'из', 'от', 'до',
  'the', 'a', 'an', 'for', 'with', 'and', 'of'
]);

function text(value) {
  return String(value == null ? '' : value).trim();
}

function normalize(value) {
  return text(value)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^0-9a-zа-я]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(value) {
  const tokens = normalize(value).match(/[0-9a-zа-я]+/g) || [];
  return tokens.filter(token => token.length > 1 && !STOP_TOKENS.has(token));
}

function alnumLength(value) {
  return tokenize(value).reduce((sum, token) => sum + token.length, 0);
}

function matchedAlnumLength(left, right) {
  const pool = Object.create(null);
  tokenize(left).forEach(token => { pool[token] = (pool[token] || 0) + 1; });
  return tokenize(right).reduce((sum, token) => {
    if (!pool[token]) return sum;
    pool[token] -= 1;
    return sum + token.length;
  }, 0);
}

// Та же формула, что в download/xcom/js/xcom-mass-match.js. Отдельный серверный
// модуль не загружает DOM и может выполняться в worker_threads.
function computeAccuracy(rfpName, skuName, matchedTokens, tmaFlag, tmaWeight) {
  const weight = Number.isFinite(Number(tmaWeight)) ? Math.max(0, Math.min(1, Number(tmaWeight))) : 0.5;
  const denom = (alnumLength(skuName) + alnumLength(rfpName)) / 2;
  const matchedLength = text(matchedTokens)
    ? alnumLength(matchedTokens)
    : matchedAlnumLength(rfpName, skuName);
  const lengthScore = denom > 0 ? Math.min(1, matchedLength / denom) : 0;
  const tmaScore = text(tmaFlag) === '1' ? 1 : 0;
  return Math.round(((1 - weight) * lengthScore + weight * tmaScore) * 100);
}

function uniqueHeaders(row) {
  const used = Object.create(null);
  return row.map((cell, index) => {
    const base = text(cell) || `Колонка ${index + 1}`;
    used[base] = (used[base] || 0) + 1;
    return used[base] === 1 ? base : `${base} (${used[base]})`;
  });
}

function detectHeaderIndex(matrix) {
  let best = {index: 0, score: -1};
  matrix.slice(0, 25).forEach((row, index) => {
    const values = Array.isArray(row) ? row.map(text).filter(Boolean) : [];
    const distinct = new Set(values.map(normalize)).size;
    const words = values.filter(value => /[a-zа-я]/i.test(value)).length;
    const score = values.length * 3 + distinct + words;
    if (score > best.score) best = {index, score};
  });
  return best.index;
}

function readDataset(filePath, options) {
  const opts = options || {};
  const workbook = XLSX.read(fs.readFileSync(filePath), {type: 'buffer', cellDates: true});
  if (!workbook.SheetNames.length) throw new Error('В файле нет листов');
  const sheetName = opts.sheet && workbook.SheetNames.includes(opts.sheet) ? opts.sheet : workbook.SheetNames[0];
  const matrix = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
    header: 1,
    raw: false,
    defval: '',
    blankrows: false
  });
  if (!matrix.length) throw new Error(`Лист «${sheetName}» пуст`);
  const headerIndex = Number.isInteger(opts.headerIndex) ? opts.headerIndex : detectHeaderIndex(matrix);
  const headers = uniqueHeaders(matrix[headerIndex] || []);
  if (!headers.length) throw new Error(`Не найдена строка заголовков в листе «${sheetName}»`);
  const rows = matrix.slice(headerIndex + 1).filter(row => {
    return Array.isArray(row) && row.some(value => text(value) !== '');
  }).map(row => {
    const record = {};
    headers.forEach((header, index) => { record[header] = row[index] == null ? '' : row[index]; });
    return record;
  });
  return {sheetName, headerIndex, headers, rows};
}

function headerScore(header, alias) {
  const candidate = normalize(header);
  const expected = normalize(alias);
  if (!candidate || !expected) return 0;
  if (candidate === expected) return 100;
  if (candidate.startsWith(expected) || expected.startsWith(candidate)) return 75;
  if (candidate.includes(expected) || expected.includes(candidate)) return 60;
  const expectedTokens = new Set(tokenize(expected));
  const overlap = tokenize(candidate).filter(token => expectedTokens.has(token)).length;
  return overlap ? 20 + overlap * 10 : 0;
}

function resolveHeader(headers, preferred, aliases, excluded) {
  const blocked = excluded || new Set();
  if (preferred) {
    const exact = headers.find(header => normalize(header) === normalize(preferred) && !blocked.has(header));
    if (exact) return exact;
  }
  let best = {header: '', score: 0};
  headers.forEach(header => {
    if (blocked.has(header)) return;
    (aliases || []).forEach(alias => {
      const score = headerScore(header, alias);
      if (score > best.score) best = {header, score};
    });
  });
  return best.score >= 40 ? best.header : '';
}

function resolveMapping(dataset, side, preferred) {
  const aliases = HEADER_ALIASES[side];
  const requested = preferred || {};
  const used = new Set();
  const mapping = {};
  ['name', 'article', 'brand', 'price', 'id'].forEach(role => {
    const header = resolveHeader(dataset.headers, requested[role], aliases[role], used);
    if (header) {
      mapping[role] = header;
      used.add(header);
    } else {
      mapping[role] = '';
    }
  });
  // ID и артикул нередко намеренно совпадают. Разрешаем это как последний фолбэк.
  if (!mapping.id) mapping.id = resolveHeader(dataset.headers, requested.id, aliases.id, new Set());
  if (!mapping.name) {
    throw new Error(`Не удалось определить колонку наименования в файле «${dataset.sheetName}»`);
  }
  return mapping;
}

function numeric(value) {
  const prepared = text(value).replace(/\s/g, '').replace(',', '.').replace(/[^0-9.+-]/g, '');
  const parsed = Number(prepared);
  return Number.isFinite(parsed) ? parsed : null;
}

function valueOf(row, header) {
  return header ? text(row[header]) : '';
}

function sharedTokens(left, right) {
  const rightSet = new Set(tokenize(right));
  return Array.from(new Set(tokenize(left).filter(token => rightSet.has(token))));
}

function makeSkuIndex(rows, mapping) {
  const articles = new Map();
  const tokens = new Map();
  rows.forEach((row, index) => {
    const article = normalize(valueOf(row, mapping.article));
    if (article) {
      if (!articles.has(article)) articles.set(article, []);
      articles.get(article).push(index);
    }
    new Set(tokenize(valueOf(row, mapping.name))).forEach(token => {
      if (!tokens.has(token)) tokens.set(token, []);
      tokens.get(token).push(index);
    });
  });
  return {articles, tokens};
}

function candidatePool(rfpRow, skuRows, rfpMapping, index, maxPool) {
  const counts = new Map();
  const article = normalize(valueOf(rfpRow, rfpMapping.article));
  if (article && index.articles.has(article)) {
    index.articles.get(article).forEach(skuIndex => counts.set(skuIndex, 1000));
  }
  tokenize(valueOf(rfpRow, rfpMapping.name)).forEach(token => {
    const matches = index.tokens.get(token) || [];
    // Очень частые слова не должны раздувать пул на весь каталог.
    if (matches.length > Math.max(5000, skuRows.length * 0.2)) return;
    matches.forEach(skuIndex => counts.set(skuIndex, (counts.get(skuIndex) || 0) + 1));
  });
  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, maxPool)
    .map(item => item[0]);
}

function describeSku(row, mapping) {
  const ignored = new Set(Object.values(mapping).filter(Boolean));
  return Object.keys(row).filter(key => !ignored.has(key) && text(row[key])).slice(0, 3)
    .map(key => `${key}: ${text(row[key])}`).join(' · ');
}

function scorePair(rfpRow, skuRow, mappings, config) {
  const rfpName = valueOf(rfpRow, mappings.rfp.name);
  const skuName = valueOf(skuRow, mappings.sku.name);
  const rfpArticle = normalize(valueOf(rfpRow, mappings.rfp.article));
  const skuArticle = normalize(valueOf(skuRow, mappings.sku.article));
  const articleExact = Boolean(rfpArticle && skuArticle && rfpArticle === skuArticle);
  let accuracy = computeAccuracy(rfpName, skuName, '', articleExact ? '1' : '0', config.tmaWeight);
  const common = sharedTokens(rfpName, skuName);
  accuracy += Math.min(18, common.length * 4);

  const rfpBrand = normalize(valueOf(rfpRow, mappings.rfp.brand));
  const skuBrand = normalize(valueOf(skuRow, mappings.sku.brand));
  if (rfpBrand && skuBrand) {
    if (rfpBrand === skuBrand) accuracy += 10;
    else accuracy -= config.strictBrand ? 100 : 18;
  }

  const budget = numeric(valueOf(rfpRow, mappings.rfp.price));
  const price = numeric(valueOf(skuRow, mappings.sku.price));
  if (budget != null && price != null && price > budget) accuracy -= 12;
  return Math.max(0, Math.min(100, Math.round(accuracy)));
}

function summarize(rows) {
  return rows.reduce((summary, row) => {
    summary.total += 1;
    if (row.status === 'matched') summary.matched += 1;
    else if (row.status === 'review') summary.review += 1;
    else summary.empty += 1;
    return summary;
  }, {total: 0, matched: 0, review: 0, empty: 0});
}

function matchDatasets(rfpDataset, skuDataset, options, onProgress) {
  const supplied = options || {};
  const config = Object.assign({}, DEFAULT_MATCH_CONFIG, supplied);
  const preferred = supplied.mapping || {};
  const mappings = {
    rfp: resolveMapping(rfpDataset, 'rfp', preferred.rfp),
    sku: resolveMapping(skuDataset, 'sku', preferred.sku)
  };
  const skuIndex = makeSkuIndex(skuDataset.rows, mappings.sku);
  const rows = [];

  rfpDataset.rows.forEach((rfpRow, rowIndex) => {
    const pool = candidatePool(rfpRow, skuDataset.rows, mappings.rfp, skuIndex, config.maxCandidatePool);
    const ranked = pool.map(skuRowIndex => {
      const skuRow = skuDataset.rows[skuRowIndex];
      return {
        row: skuRow,
        accuracy: scorePair(rfpRow, skuRow, mappings, config),
        skuRowIndex
      };
    }).sort((left, right) => right.accuracy - left.accuracy).slice(0, config.maxCandidates);

    const sourceId = valueOf(rfpRow, mappings.rfp.id) || `RFP-${rowIndex + 1}`;
    const source = valueOf(rfpRow, mappings.rfp.name);
    const best = ranked[0];
    const candidates = ranked.map((candidate, index) => {
      const skuRow = candidate.row;
      const id = valueOf(skuRow, mappings.sku.id) || valueOf(skuRow, mappings.sku.article) || `SKU-${candidate.skuRowIndex + 1}`;
      return {
        id,
        name: valueOf(skuRow, mappings.sku.name),
        article: valueOf(skuRow, mappings.sku.article),
        brand: valueOf(skuRow, mappings.sku.brand),
        price: numeric(valueOf(skuRow, mappings.sku.price)),
        accuracy: candidate.accuracy,
        details: describeSku(skuRow, mappings.sku),
        recommended: index === 0
      };
    });

    let status = 'empty';
    if (best && best.accuracy >= config.threshold) status = 'matched';
    else if (best && best.accuracy >= config.grayZoneMin) status = 'review';
    const selected = status === 'empty' ? null : candidates[0];
    rows.push({
      sourceId,
      source,
      sourceDetails: Object.keys(rfpRow).reduce((out, key) => {
        if (text(rfpRow[key])) out[key] = text(rfpRow[key]);
        return out;
      }, {}),
      targetId: selected ? selected.id : null,
      targetArticle: selected ? selected.article : null,
      target: selected ? selected.name : 'Подходящий товар не найден',
      accuracy: selected ? selected.accuracy : 0,
      status,
      price: selected ? selected.price : null,
      candidates: status === 'review' ? candidates : []
    });

    if (onProgress && (rowIndex === 0 || (rowIndex + 1) % 25 === 0 || rowIndex + 1 === rfpDataset.rows.length)) {
      onProgress({processed: rowIndex + 1, total: rfpDataset.rows.length});
    }
  });

  return {rows, summary: summarize(rows), mappings};
}

module.exports = {
  DEFAULT_MATCH_CONFIG,
  normalize,
  tokenize,
  computeAccuracy,
  detectHeaderIndex,
  readDataset,
  resolveMapping,
  matchDatasets,
  summarize
};
