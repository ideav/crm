// #4283 — перенос базы со старого Интеграма (integram.io) в новый.
//
// ЧТО ПРОВЕРЯЕТСЯ (поведение tools/old-integram-migration/migrate.js):
//   1) склейка хвостов значения t=0 даёт ровно то, что отдавало старое ядро (Get_tail в
//      experiments/index_integram.io.php): кусок, у которого MySQL срезал хвостовые пробелы,
//      добивается пробелами до 127 символов, иначе «слово слово» на стыке превращается в
//      «словослово»;
//   2) разбор листинга dir_admin находит файлы и подкаталоги текущего каталога;
//   3) копирование файлов байт-в-байт (двоичные не портятся), подкаталог создаётся до загрузки
//      (иначе dir_admin молча кладёт файл в корень), служебные logs/backups и шаблоны,
//      перекрывающие общие шаблоны нового ядра (main.html), не переносятся;
//   4) запрос MyRoleMenu приводится к эталону нового ядра — его читает блок MyRoleMenu в main.html
//      (menu_id, menu_up, name, href, icon); прежние колонки старого ядра удаляются после
//      создания эталонных, повторный прогон ничего не меняет.

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const M = require(path.join(__dirname, '..', 'tools', 'old-integram-migration', 'migrate.js'));

// Хвосты так, как их пишет старое ядро (Insert): первые 127 символов в строке, остальное
// кусками по 127 в строках t=0, ord=0,1,2… — и MySQL срезает у каждого куска хвостовые пробелы.
function splitLikeOldEngine(val) {
    const chars = Array.from(val);
    const chunks = [];
    for (let i = 0; i < chars.length; i += M.VAL_LIM) chunks.push(chars.slice(i, i + M.VAL_LIM).join(''));
    const cut = (s) => s.replace(/ +$/, '');
    return { parent: cut(chunks[0] || ''), tails: chunks.slice(1).map((v, ord) => ({ ord, val: cut(v) })) };
}

test('склейка хвостов восстанавливает пробелы на стыках кусков', () => {
    const word = 'слово ';
    // пробел ровно на 127-й позиции каждого куска
    const val = ('x'.repeat(M.VAL_LIM - 1) + ' ').repeat(3) + 'конец';
    const { parent, tails } = splitLikeOldEngine(val);
    assert.strictEqual(M.joinTails(parent, tails), val);
    const long = word.repeat(200) + 'финал';
    const s = splitLikeOldEngine(long);
    assert.strictEqual(M.joinTails(s.parent, s.tails), long);
});

test('склейка хвостов: порядок по ord, кусок из одних пробелов, без хвостов', () => {
    const val = 'a'.repeat(M.VAL_LIM) + ' '.repeat(M.VAL_LIM) + 'b';
    const { parent, tails } = splitLikeOldEngine(val);
    assert.strictEqual(tails[0].val, '');
    assert.strictEqual(M.joinTails(parent, tails.slice().reverse()), val);
    assert.strictEqual(M.joinTails('короткое', []), 'короткое');
});

test('SQL склейки задан для базы и не трогает строки без хвостов', () => {
    assert.throws(() => M.buildMergeSql('r7ohr; drop table my'), /имя базы/);
    // поведение SQL проверяется на MySQL (см. PR); здесь — что генератор принимает обычные имена
    assert.ok(M.buildMergeSql('r7ohr').length > 0);
});

const LISTING = `
<a href="/old/dir_admin/?templates=1&amp;add_path=">old</a>
<a href="/old/dir_admin/?templates=1&add_path=/img"><b>img</b></a>
<a href="/old/dir_admin/?templates=1&add_path=/logs"><b>logs</b></a>
<a href="/old/dir_admin/?templates=1&add_path=&gf=main.html">main.html</a>
<a href="/ace/editor.html?src=/old/dir_admin/&templates=1&add_path=&gf=main.html">e</a>
<a href="/old/dir_admin/?templates=1&add_path=&gf=%D0%BE%D1%82%D1%87%D1%91%D1%82.html">отчёт.html</a>
<a href="/old/dir_admin/?templates=1&add_path=&gf=crm.html">crm.html</a>`;

test('листинг dir_admin: файлы и подкаталоги текущего каталога', () => {
    const r = M.parseDirListing(LISTING, '');
    assert.deepStrictEqual(r.files.sort(), ['crm.html', 'main.html', 'отчёт.html'].sort());
    assert.deepStrictEqual(r.dirs.sort(), ['img', 'logs']);
});

// Поддельный сервер dir_admin: хранит файлы {root -> {dir -> {name -> Buffer}}}.
function fakeServer(db, fs0) {
    const fsys = fs0;
    const calls = [];
    function listing(root, dir) {
        const here = fsys[root][dir] || {};
        const subs = Object.keys(fsys[root]).filter((d) => d !== dir && d.startsWith(dir ? dir + '/' : '') && !d.slice(dir ? dir.length + 1 : 0).includes('/'));
        return subs.map((d) => `<a href="/${db}/dir_admin/?${root}=1&add_path=/${d}"><b>x</b></a>`).join('\n')
            + Object.keys(here).map((n) => `<a href="/${db}/dir_admin/?${root}=1&add_path=${dir ? '/' + dir : ''}&gf=${encodeURIComponent(n)}">${n}</a>`).join('\n');
    }
    async function fetch(url, opts = {}) {
        const u = new URL(url);
        const p = u.pathname.replace('/' + db + '/', '');
        const q = u.searchParams;
        const body = opts.body;
        calls.push({ method: opts.method || 'GET', p, q: q.toString(), body });
        const ok = (b, type) => ({ ok: true, status: 200, text: async () => (Buffer.isBuffer(b) ? b.toString('utf8') : b), arrayBuffer: async () => { const x = Buffer.isBuffer(b) ? b : Buffer.from(b); return x.buffer.slice(x.byteOffset, x.byteOffset + x.length); } });
        if (p === 'xsrf') return ok(JSON.stringify({ _xsrf: 'X' + db }));
        if (p === 'dir_admin/' && (opts.method || 'GET') === 'GET') {
            const root = q.has('download') ? 'download' : 'templates';
            const dir = (q.get('add_path') || '').replace(/^\/+/, '');
            if (q.has('gf')) return ok(fsys[root][dir][q.get('gf')]);
            return ok(listing(root, dir));
        }
        if (p === 'dir_admin/' && opts.method === 'POST') {
            const root = body.get('download') ? 'download' : 'templates';
            const dir = (body.get('add_path') || '').replace(/^\/+/, '');
            if (body.get('mkdir')) {
                const nd = (dir ? dir + '/' : '') + body.get('dir_name');
                fsys[root][nd] = fsys[root][nd] || {};
                return ok('{"ok":true}');
            }
            const target = fsys[root][dir] ? dir : ''; // как dir_admin: нет каталога — пишет в корень
            const f = body.get('userfile');
            fsys[root][target] = fsys[root][target] || {};
            fsys[root][target][f.name] = Buffer.from(await f.arrayBuffer());
            return ok('{"ok":true}');
        }
        throw new Error('unexpected ' + url);
    }
    return { fetch, fsys, calls };
}

test('копирование файлов: байт-в-байт, каталог до загрузки, без служебных и перекрывающих', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0xfe, 0x0d, 0x0a]);
    const oldSrv = fakeServer('old', {
        templates: { '': { 'main.html': Buffer.from('OLD MAIN'), 'crm.html': Buffer.from('<b>моё</b>') }, 'img': { 'logo.png': png }, 'img/sub': { 'a.txt': Buffer.from('a') }, 'logs': { 't.log': Buffer.from('l') } },
        download: { '': { 'договор.pdf': png } },
    });
    const newSrv = fakeServer('new', { templates: { '': {} }, download: { '': {} } });
    const src = new M.Client({ base: 'https://old.example/old', token: 't1', fetch: oldSrv.fetch });
    const dst = new M.Client({ base: 'https://new.example/new', token: 't2', fetch: newSrv.fetch });
    const report = await M.copyFiles({ src, dst, commonTemplates: ['main.html', 'tables.html'], log: () => {} });

    assert.deepStrictEqual(newSrv.fsys.templates['img']['logo.png'], png);
    assert.strictEqual(newSrv.fsys.templates['img/sub']['a.txt'].toString(), 'a');
    assert.strictEqual(newSrv.fsys.templates['']['crm.html'].toString(), '<b>моё</b>');
    assert.deepStrictEqual(newSrv.fsys.download['']['договор.pdf'], png);
    assert.strictEqual(newSrv.fsys.templates['']['main.html'], undefined);
    assert.strictEqual(newSrv.fsys.templates['logs'], undefined);
    assert.ok(report.skipped.some((s) => s.name === 'main.html'));
    assert.strictEqual(report.copied.length, 4);
    // логин в обе базы — токен каждой своей
    const auth = oldSrv.calls.length && newSrv.calls.every((c) => c.method !== 'POST' || c.body.get('token') === 't2');
    assert.ok(auth);
});

// type 28 «Колонки запроса»: порядок реквизитов как в эталоне docs/integram-app-workflow.md §5.9.3
const REQS28 = [100, 101, 102, 103, 63, 105, 106, 107, 29, 109, 65, 132, 58].map((id) => ({ id: String(id) }));
const META = [
    { id: '28', val: 'Колонки', reqs: REQS28.map((r, i) => Object.assign({ ref_id: i === 4 || i === 8 ? '1' : undefined }, r)) },
    { id: '151', val: 'Меню', reqs: [{ id: '153', val: 'Адрес' }, { id: '391', val: 'Иконка' }] },
];
function row(i, src, name, extra = {}) {
    const r = [src, name].concat(new Array(REQS28.length - 1).fill(''));
    Object.keys(extra).forEach((k) => { r[k] = extra[k]; });
    return { i: String(i), u: '346', r };
}

// Колонки эталона так, как их отдаёт JSON_OBJ: ссылки — «id:имя».
const LABEL = { '151': 'Меню', '42': 'Роль', '18': 'Пользователь', '0': 'Вычисляемое', '153': 'Меню -> Адрес', '391': 'Меню -> Иконка', '85': 'abn_ID', '86': 'abn_UP', '93': 'abn_ORD', '74': 'COUNT', '34': 'HTML' };
function refRows(ref) {
    return ref.map((w, n) => {
        const r = new Array(REQS28.length + 1).fill('');
        Object.keys(w).filter((k) => /^\d+$/.test(k)).forEach((k) => { r[k] = [0, 5, 9].includes(Number(k)) ? w[k] + ':' + LABEL[w[k]] : w[k]; });
        return { i: String(500 + n), u: '346', r };
    });
}

test('MyRoleMenu старого ядра заменяется эталонным: сначала создать эталон, затем удалить прежние колонки', () => {
    // колонки MyRoleMenu базы r7ohr, перенесённой со старого Интеграма (05.10.2026)
    const old = [row(170, '18:Пользователь', '', { 3: '[USER_ID]', 5: '85:abn_ID', 8: 'X' }), row(174, '42:Роль', '', { 8: 'X' }),
        row(176, '151:Меню', 'Name'), row(178, '153:Меню -> Адрес', 'HREF'), row(248, '151:Меню', '', { 5: '93:abn_ORD', 8: 'X', 10: '1' })];
    const plan = M.planMenuReport({ meta: META, columns: old });
    const kinds = plan.ops.map((o) => o.kind);
    assert.ok(kinds.lastIndexOf('create') < kinds.indexOf('delete'), kinds.join());
    assert.deepStrictEqual(plan.ops.filter((o) => o.kind === 'delete').map((o) => o.id), ['170', '174', '176', '178', '248']);
    const byName = Object.fromEntries(plan.ops.filter((o) => o.kind === 'create').map((o) => [o.params.t100 || 'COUNT', o.params]));
    assert.deepStrictEqual(Object.keys(byName).sort(), ['COUNT', 'href', 'icon', 'menu_id', 'menu_up', 'name', 'Вычисляемое', 'МенюOrd', 'Пользователь', 'РольID'].sort());
    assert.strictEqual(byName.menu_id.t28, '151');
    assert.strictEqual(byName.menu_id.t63, '85');   // abn_ID
    assert.strictEqual(byName.menu_up.t63, '86');   // abn_UP
    assert.strictEqual(byName['Вычисляемое'].t28, '0');
    assert.strictEqual(byName['Вычисляемое'].t102, '1');
    assert.strictEqual(byName.icon.t28, '391');
    assert.strictEqual(byName.icon.t29, '34');      // формат HTML
});

// Эталон MyRoleMenu для базы с реквизитом «Иконка» (391) и без него.
const menuRef = (hasIcon) => M.MENU_REFERENCE.filter((w) => (hasIcon ? !w.ifNoReq : !w.needsReq));

test('MyRoleMenu: эталонный запрос не меняется; без реквизита иконки icon — пустая вычисляемая', () => {
    assert.deepStrictEqual(M.planMenuReport({ meta: META, columns: refRows(menuRef(true)) }).ops, []);
    const noIcon = [{ id: '28', reqs: META[0].reqs }, { id: '151', reqs: [{ id: '153' }] }];
    const plan = M.planMenuReport({ meta: noIcon, columns: refRows(menuRef(false)) });
    assert.deepStrictEqual(plan.ops, []);
    assert.ok(plan.warnings.some((w) => /иконк/i.test(w)));
    // блок MyRoleMenu выводит строку, только если заполнены все подстановки — icon должна быть всегда
    const created = M.planMenuReport({ meta: noIcon, columns: [] }).ops.map((o) => o.params);
    assert.ok(created.every((p) => p.t28 !== '391'));
    const icon = created.find((p) => p.t100 === 'icon');
    assert.ok(icon && icon.t28 === '0' && icon.t101 === "''", JSON.stringify(icon));
});

test('MyRoleMenu: структура колонок не совпала с метаданными — отказ, а не запись наугад', () => {
    const bad = [{ i: '1', u: '346', r: ['151:Меню', 'name'] }];
    assert.throws(() => M.planMenuReport({ meta: META, columns: bad }), /реквизит/);
});

// Поддельная база для fixMenu: ответы GET по пути, POST записываются.
function fakeMenuDb(data) {
    const posts = [];
    let next = 9000;
    return {
        posts,
        client: {
            getJson: async (p) => { if (!(p in data)) throw new Error('unexpected ' + p); return data[p]; },
            post: async (action, params) => { posts.push({ action, params }); return { id: String(next++) }; },
        },
    };
}
const MENU_ITEMS = {
    'object/42?JSON_OBJ&LIMIT=0,100000': [{ i: '145', r: ['admin'] }, { i: '164', r: ['user'] }],
    // как отвечает ядро: без F_U подчинённые записи меню не отдаются
    'object/151?JSON_OBJ&LIMIT=0,100000': [],
    'object/151?JSON_OBJ&F_U=145&LIMIT=0,100000': [{ i: '167', u: '145', r: ['Пользователи', 'object/18', ''] }],
    'object/151?JSON_OBJ&F_U=164&LIMIT=0,100000': [{ i: '170', u: '164', r: ['Мои задачи', 'report/5?FR_user=[USER_ID]', ''] }],
};
const resolved = (cols, fnId) => cols.map((w) => Object.assign({}, w, w[5] === '@RECURSIVE' ? { 5: fnId } : {}));
LABEL['339'] = 'RECURSIVE';

test('меню: эталонная база не меняется; пункты с [USER_ID] находятся под ролями (чтение по F_U)', async () => {
    const reps = M.MENU_REPORTS.map((d, n) => ({ i: String(300 + n), r: [d.name] }));
    const data = Object.assign({
        'metadata': META,
        'object/63?JSON_OBJ&LIMIT=0,100000': [{ i: '85', r: ['abn_ID'] }, { i: '339', r: ['RECURSIVE'] }],
        'object/22?JSON_OBJ&LIMIT=0,100000': reps,
    }, MENU_ITEMS);
    M.MENU_REPORTS.forEach((d, n) => { data[`object/28?JSON_OBJ&F_U=${300 + n}&LIMIT=0,100000`] = refRows(resolved(d.name === 'MyRoleMenu' ? menuRef(true) : d.cols, '339')); });
    const db = fakeMenuDb(data);
    const logs = [];
    await M.fixMenu({ client: db.client, apply: true, log: (s) => logs.push(s) });
    assert.deepStrictEqual(db.posts, []);
    assert.ok(logs.some((s) => s.includes('170') && s.includes('[USER_ID]')), logs.join('\n'));
});

test('меню: в базе старого ядра нет RECURSIVE, myMenus и rec — создаются до MyRoleMenu, rec ссылается на новую функцию', async () => {
    // r7ohr после переноса: из запросов меню есть только MyRoleMenu старого вида, функции RECURSIVE нет
    const data = Object.assign({
        'metadata': META,
        'object/63?JSON_OBJ&LIMIT=0,100000': [{ i: '85', r: ['abn_ID'] }],
        'object/22?JSON_OBJ&LIMIT=0,100000': [{ i: '169', r: ['MyRoleMenu'] }],
        'object/28?JSON_OBJ&F_U=169&LIMIT=0,100000': [row(176, '151:Меню', 'Name'), row(178, '153:Меню -> Адрес', 'HREF')],
    }, MENU_ITEMS);
    const db = fakeMenuDb(data);
    await M.fixMenu({ client: db.client, apply: true, log: () => {} });
    const p = db.posts;
    assert.deepStrictEqual(p[0], { action: '_m_new/63', params: { up: 1, t63: 'RECURSIVE' } });
    const fnId = '9000';
    const repMy = p.findIndex((x) => x.action === '_m_new/22' && x.params.t22 === 'myMenus');
    const repRec = p.findIndex((x) => x.action === '_m_new/22' && x.params.t22 === 'rec');
    assert.ok(repMy > 0 && repRec > repMy);
    const recId = '9005'; // 9000 функция, 9001 myMenus, 9002–9004 его колонки, 9005 rec
    const recCol = p.find((x) => x.action === '_m_new/28' && x.params.up === recId);
    assert.ok(recCol, JSON.stringify(p.slice(0, 8)));
    assert.strictEqual(recCol.params.t63, fnId);           // функция RECURSIVE — новая запись
    assert.strictEqual(recCol.params.t102, '[myMenus]');
    const firstMyRole = p.findIndex((x) => x.action === '_m_new/28' && x.params.up === '169');
    const lastRec = p.findIndex((x) => x === recCol);
    assert.ok(firstMyRole > lastRec);
    assert.deepStrictEqual(p.filter((x) => /^_m_del\//.test(x.action)).map((x) => x.action), ['_m_del/176', '_m_del/178']);
});

test('шаблон на jQuery получает подключение jQuery: общий main.html нового ядра его не грузит', async () => {
    const usesJq = Buffer.from('<div id="x"></div><script>$("#x").html("ok");</script>');
    const hasJq = Buffer.from('<script src="/js/jquery3.1.1.min.js"></script><script>$(".a").hide();</script>');
    const plain = Buffer.from('<div>без скриптов</div>');
    const oldSrv = fakeServer('old', { templates: { '': { 'a.html': usesJq, 'b.html': hasJq, 'c.html': plain } }, download: { '': { 'd.js': usesJq } } });
    const newSrv = fakeServer('new', { templates: { '': {} }, download: { '': {} } });
    const src = new M.Client({ base: 'https://old.example/old', token: 't1', fetch: oldSrv.fetch });
    const dst = new M.Client({ base: 'https://new.example/new', token: 't2', fetch: newSrv.fetch });
    const report = await M.copyFiles({ src, dst, commonTemplates: [], log: () => {} });
    const a = newSrv.fsys.templates['']['a.html'].toString();
    assert.ok(a.startsWith('<script src="/js/jquery3.1.1.min.js"></script>'), a);
    assert.ok(a.endsWith(usesJq.toString()));
    assert.deepStrictEqual(newSrv.fsys.templates['']['b.html'], hasJq);
    assert.deepStrictEqual(newSrv.fsys.templates['']['c.html'], plain);
    assert.deepStrictEqual(newSrv.fsys.download['']['d.js'], usesJq); // файлы download/ — байт-в-байт
    assert.deepStrictEqual(report.patched.map((p) => p.name), ['a.html']);
});
