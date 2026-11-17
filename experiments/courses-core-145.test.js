// ideav/courses#145: портал курсов на новом ядре (python2node) — режим LMS.core в api.js/util.js и
// загрузчик core.js. Проверяется поведение с поддельным fetch, без сети:
// - чтение и запись идут в /nav-api/<база>/..., xsrf берётся из куки idx_<база> (поле _xsrf и заголовок);
// - ошибки ядра обоих видов ({error:{message}} у чтения, [{error}] у записи) доходят до вызывающего;
// - DATETIME приходит unix-секундами, в том числе с дробной частью;
// - загрузка файлов на новом ядре — multipart в /nav-api/<база>/_m_new|_m_set с X-XSRF-Token (python2node#1286),
//   значение FILE «<id>/<имя>» — ссылка на защищённый /api/v1/<база>/object/<строка>/file/<реквизит>;
// - без LMS.core адреса прежние (/<база>/...);
// - core.js по /api/v1/<база>/session и своей строке таблицы «Пользователь» узнаёт id и роль.
//
// Run with: node experiments/courses-core-145.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const dir = path.join(__dirname, '..', 'download', 'courses');
const schema = {
    tables: {
        'Прогресс': { id: 301, req: { 'Пользователь': 324, 'Курс': 325, 'Урок': 327, 'Дата и время': 338 } },
        'Файл ответа': { id: 308, req: { 'Пользователь': 380, 'Файл': 384 } },
    },
    reports: { 'Лента ответов': { id: 509 } },
};

function json(status, body) {
    return { ok: status < 400, status, json: () => Promise.resolve(body), text: () => Promise.resolve(JSON.stringify(body)) };
}

// util.js + api.js в песочнице; route(url, init) -> ответ
// xhrRoute(xhr) -> {status, body} — ответ на multipart-загрузку (XMLHttpRequest)
function portal(lms, route, xhrRoute) {
    const calls = [], xhr = [];
    const ctx = {
        console, URLSearchParams, Promise, Date,
        location: { search: '', origin: 'https://ai.ideav.online', href: 'https://ai.ideav.online/download/courses/core.html' },
        document: { cookie: 'idb_courses=; idx_courses=XS-145; other=1', addEventListener() {} },
        LMS: lms,
        FormData: class { constructor() { this.e = []; } append(...a) { this.e.push(a); } },
        XMLHttpRequest: class {
            constructor() { this.headers = {}; this.upload = {}; xhr.push(this); }
            open(m, url) { this.method = m; this.url = url; }
            setRequestHeader(k, v) { this.headers[k] = v; }
            send(fd) { this.fd = fd.e; const r = xhrRoute ? xhrRoute(this) : { status: 200, body: {} }; this.status = r.status; this.responseText = JSON.stringify(r.body); Promise.resolve().then(() => this.onload()); }
        },
    };
    ctx.window = ctx;
    ctx.fetch = (url, init) => {
        calls.push({ url, init: init || {} });
        if (/schema\.json$/.test(url)) return Promise.resolve(json(200, schema));
        return Promise.resolve(route(url, init || {}));
    };
    vm.createContext(ctx);
    for (const f of ['util.js', 'api.js']) vm.runInContext(fs.readFileSync(path.join(dir, 'js', f), 'utf8'), ctx);
    return { A: ctx.LMSApp, calls, xhr, get api() { return calls.filter(c => !/schema\.json$/.test(c.url)); } };
}

let failed = 0;
async function t(name, fn) {
    try { await fn(); console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + e.message); }
}

(async () => {
    await t('core: list читает /nav-api/courses/object/<id>/, ссылка id:текст, DATETIME с дробью', async () => {
        const p = portal({ core: true, z: 'courses' }, () => json(200, [{ i: 7, u: 1, o: 1, r: ['k', '600:lmstest', 'mini', '00-start', '1794898907.25'] }]));
        await p.A.loadSchema();
        const rows = await p.A.list('Прогресс', { 'Пользователь': '600' });
        assert.strictEqual(p.api[0].url, '/nav-api/courses/object/301/?JSON_OBJ&LIMIT=0,5000');
        assert.strictEqual(rows.length, 1);
        assert.strictEqual(rows[0]._id, '7');
        assert.strictEqual(p.A.refId(rows[0]['Пользователь']), '600');
        assert.strictEqual(rows[0]['Дата и время'], p.A.fmtUnix('1794898907'));
    });

    await t('core: create шлёт _m_new в /nav-api с xsrf из куки idx_courses (поле и заголовок)', async () => {
        const p = portal({ core: true, z: 'courses' }, () => json(200, { id: 900, obj: 900 }));
        await p.A.loadSchema();
        const id = await p.A.create('Прогресс', 'k', { 'Курс': 'mini' });
        assert.strictEqual(id, '900');
        const c = p.api[0];
        assert.strictEqual(c.url, '/nav-api/courses/_m_new/301?JSON&up=1');
        assert.strictEqual(c.init.method, 'POST');
        const body = new URLSearchParams(c.init.body);
        assert.strictEqual(body.get('_xsrf'), 'XS-145');
        assert.strictEqual(body.get('t301'), 'k');
        assert.strictEqual(body.get('t325'), 'mini');
        assert.strictEqual(c.init.headers['X-XSRF-Token'], 'XS-145');
    });

    await t('core: ошибка записи [{error}] и чтения {error:{message}} доходят текстом ядра', async () => {
        const w = portal({ core: true, z: 'courses' }, () => json(403, [{ error: 'XSRF token mismatch' }]));
        await w.A.loadSchema();
        await assert.rejects(w.A.update('Прогресс', 7, { 'Урок': 'x' }), /XSRF token mismatch/);
        const r = portal({ core: true, z: 'courses' }, () => json(401, { error: { code: 'err_access_denied', message: 'Authentication token required' } }));
        await r.A.loadSchema();
        await assert.rejects(r.A.list('Прогресс'), /Authentication token required/);
    });

    await t('core: загрузка — multipart в /nav-api/<база>/_m_new с заголовком X-XSRF-Token, файл в t<id реквизита>', async () => {
        const p = portal({ core: true, z: 'courses' }, () => json(200, {}), () => ({ status: 200, body: { id: '', obj: 77 } }));
        await p.A.loadSchema();
        const file = { name: 'отчёт.pdf' };
        const id = await p.A.upload('Файл ответа', 'k1', { 'Пользователь': '600' }, 'Файл', file);
        assert.strictEqual(id, '77');
        const x = p.xhr[0];
        assert.strictEqual(x.url, '/nav-api/courses/_m_new/308?JSON&up=1');
        assert.strictEqual(x.headers['X-XSRF-Token'], 'XS-145');
        assert.strictEqual(x.withCredentials, true);
        assert.deepStrictEqual(x.fd.find(e => e[0] === 't384'), ['t384', file, 'отчёт.pdf']);
        assert.strictEqual(x.fd.find(e => e[0] === 't308')[1], 'k1');
        assert.strictEqual(x.fd.find(e => e[0] === 't380')[1], '600');
    });

    await t('core: загрузка в строку — multipart в /nav-api/<база>/_m_set/<id>; ошибка ядра {error:{message}} доходит', async () => {
        const p = portal({ core: true, z: 'courses' }, () => json(200, {}), () => ({ status: 415, body: { error: { code: 'err_bad_request', message: 'File type is not allowed' } } }));
        await p.A.loadSchema();
        await assert.rejects(p.A.uploadTo('Файл ответа', 5, 'Файл', { name: 'a.html' }), /File type is not allowed/);
        assert.strictEqual(p.xhr[0].url, '/nav-api/courses/_m_set/5?JSON');
        assert.strictEqual(p.xhr[0].headers['X-XSRF-Token'], 'XS-145');
    });

    await t('core: значение FILE «<id>/<имя>» — ссылка на /api/v1/<база>/object/<строка>/file/<реквизит>', async () => {
        const p = portal({ core: true, z: 'courses' }, () => json(200, [
            { i: 9, u: 1, o: 1, r: ['k', '600:lmstest', '0123456789abcdef0123456789abcdef/отчёт <1>&.pdf'] },
            { i: 10, u: 1, o: 1, r: ['k2', '600:lmstest', ''] }]));
        await p.A.loadSchema();
        const rows = await p.A.list('Файл ответа');
        assert.deepStrictEqual(Object.assign({}, p.A.fileInfo(rows[0]['Файл'])), { url: '/api/v1/courses/object/9/file/384', name: 'отчёт <1>&.pdf' });
        assert.strictEqual(p.A.fileInfo(rows[1]['Файл']), null);
    });

    await t('без LMS.core значение FILE не переписывается, загрузка — в /<база>/_m_new', async () => {
        const p = portal({ z: 'courses' }, () => json(200, [{ i: 9, u: 1, o: 1, r: ['k', '600:lmstest', '<a href="/download/courses/x/a.pdf">a.pdf</a>'] }]),
            () => ({ status: 200, body: { obj: 3 } }));
        await p.A.loadSchema();
        const rows = await p.A.list('Файл ответа');
        assert.strictEqual(p.A.fileInfo(rows[0]['Файл']).url, '/download/courses/x/a.pdf');
        await p.A.upload('Файл ответа', 'k1', {}, 'Файл', { name: 'a.pdf' });
        assert.strictEqual(p.xhr[0].url, '/courses/_m_new/308?JSON&up=1');
        assert.strictEqual(p.xhr[0].headers['X-XSRF-Token'], undefined);
    });

    await t('core: удаление строки с файлом — один _m_del', async () => {
        const p = portal({ core: true, z: 'courses' }, () => json(200, { id: '', obj: 5 }));
        await p.A.loadSchema();
        await p.A.removeFile('Файл ответа', 5, 'Файл');
        assert.deepStrictEqual(p.api.map(c => c.url), ['/nav-api/courses/_m_del/5?JSON']);
    });

    await t('core: отчёт и схема — из /nav-api и core/schema.json', async () => {
        const p = portal({ core: true, z: 'courses' }, () => json(200, [{ a: 1 }]));
        await p.A.loadSchema();
        await p.A.reportRows('Лента ответов');
        assert.strictEqual(p.calls[0].url, '/download/courses/core/schema.json');
        assert.strictEqual(p.api[0].url, '/nav-api/courses/report/509?JSON_KV');
    });

    await t('без LMS.core адреса прежние: /courses/object, /courses/_m_new, schema.json', async () => {
        const p = portal({ z: 'courses', xsrf: 'OLD' }, () => json(200, []));
        await p.A.loadSchema();
        await p.A.list('Прогресс');
        p.A.create('Прогресс', 'k', {});
        assert.strictEqual(p.calls[0].url, '/download/courses/schema.json');
        assert.strictEqual(p.api[0].url, '/courses/object/301/?JSON_OBJ&LIMIT=0,5000');
        assert.strictEqual(p.api[1].url, '/courses/_m_new/301?JSON&up=1');
        assert.strictEqual(new URLSearchParams(p.api[1].init.body).get('_xsrf'), 'OLD');
    });

    // core.js: LMSCore.session(fetch, db) -> {user, userId, role}
    function core(route) {
        const ctx = { console, Promise, window: {}, document: { readyState: 'complete', addEventListener() {} }, location: { search: '' } };
        ctx.window = ctx;
        vm.createContext(ctx);
        vm.runInContext(fs.readFileSync(path.join(dir, 'js', 'core.js'), 'utf8'), ctx);
        const calls = [];
        const f = (url, init) => { calls.push(url); return Promise.resolve(route(url, init)); };
        return { S: ctx.LMSCore, f, calls, ctx };
    }
    const meta = { id: '18', val: 'Пользователь', reqs: [{ id: 115, val: 'Роль' }, { id: 33, val: 'Имя' }] };

    await t('core.js: вошедший — id и роль из своей строки «Пользователь»', async () => {
        const c = core(url => {
            if (url === '/api/v1/courses/session') return json(200, { user: 'kurator', admin: false, issuer: null });
            if (url === '/nav-api/courses/metadata/18') return json(200, meta);
            if (url === '/nav-api/courses/object/18/?F_18=kurator&LIMIT=0,20') return json(200, [{ i: 608, r: ['kurator', '493:Куратор', 'К'] }]);
            return json(404, {});
        });
        const s = await c.S.session(c.f, 'courses');
        assert.deepStrictEqual(JSON.parse(JSON.stringify(s)), { user: 'kurator', userId: '608', role: 'Куратор' });
    });

    await t('core.js: нет доступа к «Пользователь» — вход остаётся, id и роль пустые', async () => {
        const c = core(url => url === '/api/v1/courses/session' ? json(200, { user: 'kurator', admin: false })
            : json(403, { error: { code: 'err_access_denied', message: 'No read access to this term' } }));
        const s = await c.S.session(c.f, 'courses');
        assert.deepStrictEqual(JSON.parse(JSON.stringify(s)), { user: 'kurator', userId: '', role: '' });
    });

    await t('core.js: id и роль из /session, если ядро их отдаёт', async () => {
        const c = core(() => json(200, { user: 'kurator', admin: false, user_id: 608, role: 'Куратор' }));
        const s = await c.S.session(c.f, 'courses');
        assert.deepStrictEqual(JSON.parse(JSON.stringify(s)), { user: 'kurator', userId: '608', role: 'Куратор' });
        assert.deepStrictEqual(c.calls, ['/api/v1/courses/session']);
    });

    await t('core.js: без сессии — гость, без лишних запросов', async () => {
        const c = core(() => json(200, { user: null, admin: false, issuer: null }));
        const s = await c.S.session(c.f, 'courses');
        assert.strictEqual(s.user, 'guest');
        assert.deepStrictEqual(c.calls, ['/api/v1/courses/session']);
    });

    await t('core.js: мастер-вход — роль admin', async () => {
        const c = core(url => url === '/api/v1/courses/session' ? json(200, { user: 'admin', admin: true, issuer: null }) : json(401, {}));
        const s = await c.S.session(c.f, 'courses');
        assert.strictEqual(s.user, 'admin');
        assert.strictEqual(s.role, 'admin');
    });

    await t('core.js: вход — POST /api/v1/<база>/login JSON {user,password}, ошибка ядра текстом', async () => {
        let seen;
        const c = core((url, init) => { seen = { url, init }; return json(401, { error: { code: 'err_access_denied', message: 'Invalid login or password' } }); });
        await assert.rejects(c.S.login(c.f, 'courses', 'lmstest', 'x'), /Invalid login or password/);
        assert.strictEqual(seen.url, '/api/v1/courses/login');
        assert.strictEqual(seen.init.method, 'POST');
        assert.deepStrictEqual(JSON.parse(seen.init.body), { user: 'lmstest', password: 'x' });
    });

    await t('core.js: вход из ЛК — /my/coresso на ideav.ru, база и путь возврата закодированы', async () => {
        const c = core(() => json(200, {}));
        assert.strictEqual(c.S.cabinetUrl('courses', '/download/courses/core.html?db=courses&x=1'),
            'https://ideav.ru/my/coresso?db=courses&back=%2Fdownload%2Fcourses%2Fcore.html%3Fdb%3Dcourses%26x%3D1');
        assert.strictEqual(c.S.cabinetUrl('courses'), 'https://ideav.ru/my/coresso?db=courses&back=%2F');
    });

    // util.js открывает ссылки на чужой домен без target в новой вкладке (window.open): вход из ЛК
    // тогда ставит сессию в новой вкладке, а портал остаётся гостем. Ссылка входа — в этой же вкладке.
    await t('core.js: кнопка входа из ЛК — в этой же вкладке (target=_self) и с путём возврата', async () => {
        const c = core(() => json(200, {}));
        const made = [];
        const el = (tag, attrs, kids) => { const e = { tag, attrs: attrs || {}, kids: [].concat(kids || []), remove() {}, focus() {},
            querySelector() { return e; }, appendChild() {} }; made.push(e); return e; };
        c.ctx.location.pathname = '/download/courses/core.html';
        c.ctx.document.getElementById = () => null;
        c.ctx.document.body = { appendChild() {} };
        c.S.showLogin({ el }, 'courses');
        const link = made.find(e => e.tag === 'a' && /coresso/.test(e.attrs.href || ''));
        assert.ok(link, 'нет ссылки входа из ЛК');
        assert.strictEqual(link.attrs.href, 'https://ideav.ru/my/coresso?db=courses&back=%2Fdownload%2Fcourses%2Fcore.html');
        assert.strictEqual(link.attrs.target, '_self');
    });

    console.log(failed ? `\n${failed} FAIL` : '\nall ok');
    process.exit(failed ? 1 : 0);
})();
