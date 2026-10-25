// create 7 reports per main table: sel1/sel3/sel5 (10 cols, joins 1/3/5 tables),
// agg1/agg3/agg5 (COUNT+SUM+AVG over FR_code range) and upd (SET price), issue #5267
import { apiGet, apiPost, log, retry } from './api.mjs';
import { MAINS } from './schema.mjs';
import fs from 'fs';

const state = JSON.parse(fs.readFileSync('state.json', 'utf8'));

async function functionIds() {
  const rows = await retry(() => apiGet('/object/63/?JSON_OBJ&LIMIT=1000&TIME=60'));
  const map = {};
  for (const r of rows) map[String(r.r[0]).toUpperCase()] = +r.i;
  return map; // e.g. {SUM: 73, 'ABN_ID': 85, COUNT: ..., AVG: ...}
}

const SCALARS_W12 = ['code', 'year', 'price', 'rating', 'is_active', 'released', 'created'];
const SEL1 = (wide) => wide
  ? ['code', 'year', 'price', 'rating', 'is_active', 'released', 'created', 's01', 's02', 'n01']
  : [...SCALARS_W12]; // +2 ref-id cols appended below to reach 10
const SEL5_TAIL = ['author', 'genre', 'publisher', 'country']; // ref name displays

async function col(qid, fieldId, t100, opts = {}) {
  const f = { t28: String(fieldId), t100 };
  if (opts.func) f.t104 = String(opts.func);
  if (opts.set) f.t132 = opts.set;
  await retry(() => apiPost(`/_m_new/28?JSON&up=${qid}`, f));
}

async function main() {
  const FN = await functionIds();
  log('functions:', JSON.stringify(FN));
  const ABN = FN['ABN_ID'] || 85;
  const out = {};
  for (const m of MAINS) {
    const name = m.name;
    const tid = state.tables[name].tid;
    const C = state.tables[name].cols; // alias -> reqId (title -> tid)
    const wide = name.endsWith('_W45');
    const slug = name.toLowerCase();
    out[name] = {};

    async function mkQuery(qname, colsSpec) {
      const r = await retry(() => apiPost('/_m_new/22?JSON&up=1', { t22: qname }));
      const qid = +r.id;
      let first = true;
      for (const c of colsSpec) {
        // anchor: first column must be master-table field
        await col(qid, c.fid, c.t100, c);
        first = false;
      }
      out[name][qname.split('_')[0]] = qid;
      log(qname, qid);
    }

    const idCol = { fid: tid, t100: 'id', func: ABN };
    // sel1: 10 cols, master only (W12: +2 ref id cols)
    const sel1 = wide
      ? [idCol, ...SEL1(true).map(a => ({ fid: C[a], t100: a }))]
      : [idCol, ...SEL1(false).map(a => ({ fid: C[a], t100: a })),
         { fid: C.author, t100: 'author_id', func: ABN }, { fid: C.genre, t100: 'genre_id', func: ABN }];
    await mkQuery(`sel1_${slug}`, sel1);

    // sel3: master + Authors + Genres
    await mkQuery(`sel3_${slug}`, [
      idCol, { fid: tid, t100: 'title' },
      ...['code', 'year', 'price', 'rating', 'released'].map(a => ({ fid: C[a], t100: a })),
      { fid: C.author, t100: 'author' }, { fid: C.genre, t100: 'genre' },
      { fid: C.author, t100: 'author_id', func: ABN },
    ]);

    // sel5: master + 4 dicts
    await mkQuery(`sel5_${slug}`, [
      idCol, { fid: tid, t100: 'title' },
      ...['code', 'year', 'price', 'rating', 'released'].map(a => ({ fid: C[a], t100: a })),
      { fid: C.author, t100: 'author' }, { fid: C.genre, t100: 'genre' },
      { fid: C.publisher, t100: 'publisher' }, { fid: C.country, t100: 'country' },
    ]);

    // agg1/3/5: COUNT(code), SUM(price), AVG(rating) + code for FR_ range filters
    const aggCols = (extra = []) => [
      { fid: C.code, t100: 'cnt', func: FN['COUNT'] || FN['COUNT(*)'] || FN['ABN_ID'] },
      { fid: C.price, t100: 'sum_price', func: FN['SUM'] },
      { fid: C.rating, t100: 'avg_rating', func: FN['AVG'] || FN['SUM'] },
      { fid: C.code, t100: 'code' },
      ...extra,
    ];
    await mkQuery(`agg1_${slug}`, aggCols());
    await mkQuery(`agg3_${slug}`, aggCols([{ fid: C.author, t100: 'author' }, { fid: C.genre, t100: 'genre' }]));
    await mkQuery(`agg5_${slug}`, aggCols(SEL5_TAIL.map(a => ({ fid: C[a], t100: a }))));

    // upd: SET price="77.77" over FR_code range
    await mkQuery(`upd_${slug}`, [
      { fid: tid, t100: 'title' },
      { fid: C.code, t100: 'code' },
      { fid: C.price, t100: 'price', set: '"77.77"' },
    ]);
  }
  state.queries = out;
  fs.writeFileSync('state.json', JSON.stringify(state, null, 1));
  log('queries created:', Object.values(out).length * 7);
}

main().catch(e => { console.error(e); process.exit(1); });
