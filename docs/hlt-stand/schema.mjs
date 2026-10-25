// hlt stand schema: 4 dictionaries + 8 main tables (4 sizes x 2 widths), issue ideav/crm#5267
import { apiGet, apiPost, log } from './api.mjs';
import fs from 'fs';
import { pathToFileURL } from 'url';

const CORE = [ // 12 columns, both widths
  { alias: 'code', type: 'code', code: 13 },
  { alias: 'year', type: 'year', code: 13 },
  { alias: 'price', type: 'price', code: 14 },
  { alias: 'rating', type: 'rating', code: 14 },
  { alias: 'is_active', type: 'is_active', code: 11 },
  { alias: 'released', type: 'released', code: 9 },
  { alias: 'created', type: 'created', code: 4 },
  { alias: 'author', ref: 'D_Authors' },
  { alias: 'genre', ref: 'D_Genres' },
  { alias: 'publisher', ref: 'D_Publishers' },
  { alias: 'country', ref: 'D_Countries' },
];
const EXTRA = [ // +33 for W45 (total 45)
  ...['s01','s02','s03','s04','s05','s06','s07','s08','s09','s10'].map(a => ({ alias: a, type: a, code: 3 })),
  ...['c01','c02','c03','c04','c05'].map(a => ({ alias: a, type: a, code: 8 })),
  ...['n01','n02','n03','n04','n05'].map(a => ({ alias: a, type: a, code: 13 })),
  ...['g01','g02','g03','g04'].map(a => ({ alias: a, type: a, code: 14 })),
  ...['d01','d02','d03'].map(a => ({ alias: a, type: a, code: 9 })),
  ...['t01','t02','t03'].map(a => ({ alias: a, type: a, code: 4 })),
  ...['b01','b02','b03'].map(a => ({ alias: a, type: a, code: 11 })),
];

export const DICTS = [
  { name: 'D_Authors', n: 1000 },
  { name: 'D_Genres', n: 100 },
  { name: 'D_Publishers', n: 500 },
  { name: 'D_Countries', n: 100 },
];
export const SIZES = [1000, 10000, 100000, 1000000];
export const MAINS = SIZES.flatMap(n => [
  { name: `T_${n >= 1000000 ? '1M' : n / 1000 + 'K'}_W12`, rows: n, cols: CORE },
  { name: `T_${n >= 1000000 ? '1M' : n / 1000 + 'K'}_W45`, rows: n, cols: [...CORE, ...EXTRA] },
]);

async function main() {
  const meta = await apiGet('/metadata?JSON=1');
  const byName = new Map(meta.map(t => [t.val, t]));
  const typeByName = new Map();
  for (const t of meta) for (const r of t.reqs || []) {
    if (+t.up === 0 && !r.ref && !r.arr_id) typeByName.set(r.val, r); // base types by type-name
  }
  const state = fs.existsSync('state.json') ? JSON.parse(fs.readFileSync('state.json', 'utf8')) : {};
  state.dicts = state.dicts || {};
  state.tables = state.tables || {};

  async function ensureDict(name) {
    if (state.dicts[name]?.tid) return state.dicts[name].tid;
    if (byName.has(name)) { state.dicts[name] = { tid: +byName.get(name).id }; return state.dicts[name].tid; }
    const r = await apiPost('/_d_new?JSON=1', { t: '3', val: name, unique: '1' });
    log('dict', name, r.obj);
    state.dicts[name] = { tid: +r.obj };
    return +r.obj;
  }

  async function ensureType(name, code) {
    if (typeByName.has(name)) return +typeByName.get(name).orig;
    const r = await apiPost('/_d_new?JSON=1', { t: String(code), val: name });
    typeByName.set(name, { orig: r.obj });
    log('type', name, code, r.obj);
    return +r.obj;
  }

  async function ensureCol(name, tid, { alias, type, code, ref }) {
    const st = state.tables;
    if (st[name]?.cols[alias]) return st[name].cols[alias];
    let typeId;
    if (ref) {
      const dictTid = await ensureDict(ref);
      const rr = await apiPost(`/_d_ref/${dictTid}?JSON=1`, {});
      typeId = +rr.obj; // ref-type (orig == dict tid)
    } else {
      typeId = await ensureType(type, code);
    }
    // existing req? (idempotent re-run)
    let reqId = null;
    const tbl = byName.get(name);
    if (tbl) for (const r of tbl.reqs || []) if (r.orig == typeId || (ref && +r.ref === typeId)) { reqId = +r.id; break; }
    if (!reqId) {
      const r = await apiPost(`/_d_req/${tid}?JSON=1`, { t: String(typeId) });
      reqId = +r.id;
    }
    await apiPost(`/_d_alias/${reqId}?JSON=1`, { val: alias });
    st[name].cols[alias] = reqId;
    return reqId;
  }

  for (const d of DICTS) await ensureDict(d.name);

  for (const m of MAINS) {
    let tid;
    if (state.tables[m.name]?.tid) tid = state.tables[m.name].tid;
    else if (byName.has(m.name)) tid = +byName.get(m.name).id;
    else {
      const r = await apiPost('/_d_new?JSON=1', { t: '3', val: m.name });
      tid = +r.obj;
      log('table', m.name, tid);
    }
    state.tables[m.name] = state.tables[m.name] || { tid, cols: {}, rows: m.rows };
    state.tables[m.name].cols.title = tid; // first column key = table id
    const tblMeta = meta.find(t => +t.id === tid) || await apiGet(`/metadata/${tid}?JSON=1`).then(a => a[0]);
    byName.set(m.name, tblMeta);
    for (const c of m.cols) await ensureCol(m.name, tid, c);
    // refresh metadata so later tables see new base types
    const fresh = await apiGet(`/metadata?JSON=1`);
    for (const t of fresh) for (const r of t.reqs || []) {
      if (+t.up === 0 && !r.ref && !r.arr_id) typeByName.set(r.val, r);
    }
    log('ok', m.name, tid, Object.keys(state.tables[m.name].cols).length, 'cols');
  }

  fs.writeFileSync('state.json', JSON.stringify(state, null, 1));
  log('state.json written');
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch(e => { console.error(e); process.exit(1); });
}
