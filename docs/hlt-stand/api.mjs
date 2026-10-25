// API helper for ideav.ru/{db} (Integram v2 REST, docs/kb)
const BASE = 'https://ideav.ru';
const DB = 'hlt';
export const TOKEN = 'YOUR_TOKEN';

let XSRF = null;

export async function apiGet(path, timeoutMs = 120000) {
  const r = await fetch(`${BASE}/${DB}${path}`, {
    headers: { 'X-Authorization': TOKEN },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await r.text();
  if (r.status !== 200) throw new Error(`GET ${path} -> ${r.status}: ${text.slice(0, 300)}`);
  try { return JSON.parse(text); }
  catch { throw new Error(`GET ${path} -> non-JSON: ${text.slice(0, 300)}`); }
}

export async function getXsrf() {
  if (XSRF) return XSRF;
  const j = await apiGet('/xsrf?JSON=1');
  XSRF = j._xsrf;
  return XSRF;
}

// POST form-urlencoded. fields: object of string->string. Returns parsed JSON.
export async function apiPost(path, fields, timeoutMs = 330000) {
  const xsrf = await getXsrf();
  const body = new URLSearchParams({ token: TOKEN, _xsrf: xsrf, ...fields });
  const r = await fetch(`${BASE}/${DB}${path}`, {
    method: 'POST',
    headers: { 'X-Authorization': TOKEN, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await r.text();
  if (r.status !== 200) throw new Error(`POST ${path} -> ${r.status}: ${text.slice(0, 300)}`);
  try { return JSON.parse(text); }
  catch { throw new Error(`POST ${path} -> non-JSON: ${text.slice(0, 300)}`); }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function retry(fn, tries = 5, base = 1000) {
  let err;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); }
    catch (e) {
      err = e;
      if (/-> 4\d\d/.test(e.message) && !/-> 429/.test(e.message)) throw e; // client errors don't heal
      await sleep(base * 2 ** i);
    }
  }
  throw err;
}

export function log(...a) {
  console.log(new Date().toISOString().slice(11, 19), ...a);
}
