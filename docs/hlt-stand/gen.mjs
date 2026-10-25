// deterministic test-data generator (ASCII to dodge CP1251 issues), issue #5267
const ADJ = ['Red','Silent','Golden','Lost','Hidden','Bright','Last','First','Wild','Slow','Dark','New','Old','Blue','Iron','Paper','Winter','Summer','Broken','Golden'];
const NOUN = ['River','Mountain','Letter','Garden','Harbor','Signal','Shadow','Mirror','Highway','Island','Train','Crown','Field','Cipher','Orchard','Compass','Lantern','Voyage','Anchor','Prism'];

const DAY = 86400;
const D0 = Date.UTC(2020, 0, 1) / 1000; // released base
const NOW = Math.floor(Date.now() / 1000);

// i -> record fields (strings as the API takes them); dictIds: {author,genre,publisher,country} arrays
export function row(i, wide, dictIds) {
  const f = {
    title: `Book ${i} ${ADJ[i % ADJ.length]} ${NOUN[(i * 7) % NOUN.length]}`,
    code: String(i),
    year: String(1900 + (i % 127)),
    price: (Math.round((i % 50000)) / 100).toFixed(2),
    rating: (Math.round((i % 100)) / 10).toFixed(1),
    is_active: String(i % 2),
    released: new Date((D0 + (i % 2500) * DAY) * 1000).toISOString().slice(0, 10),
    created: String(NOW - (i % 2592000)),
    author: dictIds ? String(dictIds.author[i % dictIds.author.length]) : '',
    genre: dictIds ? String(dictIds.genre[i % dictIds.genre.length]) : '',
    publisher: dictIds ? String(dictIds.publisher[i % dictIds.publisher.length]) : '',
    country: dictIds ? String(dictIds.country[i % dictIds.country.length]) : '',
  };
  if (wide) {
    for (let k = 1; k <= 10; k++) f[`s${String(k).padStart(2, '0')}`] = `v${(i * k) % 100000}`;
    for (let k = 1; k <= 5; k++) f[`c${String(k).padStart(2, '0')}`] = `chunk ${k} of record ${i}: ${'x'.repeat(40 + (i % 60))}`;
    for (let k = 1; k <= 5; k++) f[`n${String(k).padStart(2, '0')}`] = String((i * (k + 3)) % 1000000);
    for (let k = 1; k <= 4; k++) f[`g${String(k).padStart(2, '0')}`] = ((i * (k + 1)) % 100000 / 100).toFixed(2);
    for (let k = 1; k <= 3; k++) f[`d${String(k).padStart(2, '0')}`] = new Date((D0 + ((i * k) % 2500) * DAY) * 1000).toISOString().slice(0, 10);
    for (let k = 1; k <= 3; k++) f[`t${String(k).padStart(2, '0')}`] = String(NOW - ((i * k) % 2592000));
    for (let k = 1; k <= 3; f[`b${String(k).padStart(2, '0')}`] = String((i >> k++) % 2));
  }
  return f;
}

// plain-data import: values in metadata order, refs by NAME, one extra empty field at the end
export function rowValues(i, wide, dref) {
  const f = row(i, wide, null);
  const refName = (a) => `${dref[a].name}_${String(i % dref[a].n).padStart(6, '0')}`;
  f.author = refName('author');
  f.genre = refName('genre');
  f.publisher = refName('publisher');
  f.country = refName('country');
  const order = wide
    ? ['code','year','price','rating','is_active','released','created','author','genre','publisher','country',
       's01','s02','s03','s04','s05','s06','s07','s08','s09','s10','c01','c02','c03','c04','c05',
       'n01','n02','n03','n04','n05','g01','g02','g03','g04','d01','d02','d03','t01','t02','t03','b01','b02','b03']
    : ['code','year','price','rating','is_active','released','created','author','genre','publisher','country'];
  return [f.title, ...order.map(a => f[a])];
}

// ops for _m_batch: add records of table tid starting at index `from`, count n
// keymap: alias -> "t<reqId>" (first column -> "t<tid>")
export function batchOps(tid, from, n, wide, dictIds, keymap) {
  const ops = [];
  for (let i = from; i < from + n; i++) {
    const r = row(i, wide, dictIds);
    const fields = {};
    for (const [k, v] of Object.entries(r)) fields[keymap[k]] = v;
    ops.push({ op: 'new', id: tid, up: 1, fields });
  }
  return ops;
}

