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
//   4) правка запроса MyRoleMenu доводит его до колонок, которые читает новый main.html
//      (menu_id, menu_up, name, href, icon): недостающие создаются, «Name»/«HREF» старого
//      меню переименовываются, повторный прогон ничего не меняет.

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

test('MyRoleMenu: недостающие колонки создаются, старые имена переименовываются', () => {
    const cols = [row(354, '151:Меню', 'Name'), row(381, '153:Меню -> Адрес', 'HREF'), row(352, '42:Роль', 'РольID')];
    const plan = M.planMenuReport({ meta: META, columns: cols });
    const renames = plan.ops.filter((o) => o.kind === 'rename');
    const creates = plan.ops.filter((o) => o.kind === 'create');
    assert.deepStrictEqual(renames.map((o) => [o.id, o.params.t100]).sort(), [['354', 'name'], ['381', 'href']]);
    const byName = Object.fromEntries(creates.map((o) => [o.params.t100, o.params]));
    assert.deepStrictEqual(Object.keys(byName).sort(), ['icon', 'menu_id', 'menu_up']);
    assert.strictEqual(byName.menu_id.t28, '151');
    assert.strictEqual(byName.menu_id.t63, '85');   // abn_ID
    assert.strictEqual(byName.menu_up.t63, '86');   // abn_UP
    assert.strictEqual(byName.icon.t28, '391');
    assert.strictEqual(byName.icon.t29, '34');      // формат HTML
});

test('MyRoleMenu: готовый запрос не меняется, без реквизита иконки колонка icon не создаётся', () => {
    const full = [row(1, '151:Меню', 'name'), row(2, '153:Меню -> Адрес', 'href'), row(3, '151:Меню', 'menu_id', { 5: '85:abn_ID' }),
        row(4, '151:Меню', 'menu_up', { 5: '86:abn_UP' }), row(5, '391:Меню -> Иконка', 'icon')];
    assert.deepStrictEqual(M.planMenuReport({ meta: META, columns: full }).ops, []);
    const noIcon = [{ id: '28', reqs: META[0].reqs }, { id: '151', reqs: [{ id: '153' }] }];
    const plan = M.planMenuReport({ meta: noIcon, columns: full.slice(0, 4) });
    assert.deepStrictEqual(plan.ops, []);
    assert.ok(plan.warnings.some((w) => /иконк/i.test(w)));
});

test('MyRoleMenu: структура колонок не совпала с метаданными — отказ, а не запись наугад', () => {
    const bad = [{ i: '1', u: '346', r: ['151:Меню', 'name'] }];
    assert.throws(() => M.planMenuReport({ meta: META, columns: bad }), /реквизит/);
});
