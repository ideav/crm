// issue #5410: пакет миграции конфигурации (templates/migration.html) — круговой прогон
// «экспорт из базы-источника → импорт в чистую базу» настоящим скриптом шаблона против
// поддельного API ядра. Форма ответов повторяет index.php: metadata (req.id, ref = id
// таблицы-цели, ref_id = строка-определение ссылки, arr_id = подчинённая таблица,
// field_attrs.alias), object/{t}?JSON_OBJ без F_U отдаёт только записи с up=1 (Prepare_parent_filter),
// ссылка в r[] — «id:значение», _m_new ищет ссылку по тексту и иначе заводит новую запись.
const test = require('node:test');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'templates', 'migration.html'), 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const mainScript = scripts.find((s) => s.indexOf('doExport') > -1);

// ---- служебная часть схемы, одинаковая у обеих баз (шаблон «ru») ----
const SERVICE_META = [
    { id: '22', up: '0', type: '3', val: 'Запрос', unique: '0', reqs: [
        { num: 1, id: '99', val: 'Колонки запроса', orig: '28', type: '16', arr_id: '28', field_attrs: { alias: null } },
        { num: 2, id: '134', val: 'LIMIT', orig: '134', type: '3', field_attrs: { alias: null } },
        { num: 3, id: '111', val: 'Сформировать', orig: '110', type: '3', field_attrs: { alias: null } }
    ] },
    { id: '28', up: '0', type: '16', val: 'Колонки запроса', unique: '0', reqs: [
        { num: 1, id: '100', val: 'Имя в отчете', orig: '100', type: '3' },
        { num: 2, id: '101', val: 'Формула', orig: '101', type: '12' },
        { num: 3, id: '102', val: 'Значение (от)', orig: '102', type: '3' },
        { num: 4, id: '103', val: 'Значение (до)', orig: '103', type: '3' },
        { num: 5, id: '104', val: 'Функция', orig: '63', type: '3', ref: '63', ref_id: '104' },
        { num: 6, id: '105', val: 'HAVING (от)', orig: '105', type: '3' },
        { num: 7, id: '106', val: 'HAVING (до)', orig: '106', type: '3' },
        { num: 8, id: '107', val: 'Скрыть', orig: '107', type: '11' },
        { num: 9, id: '84', val: 'Формат', orig: '29', type: '3', ref: '29', ref_id: '84' },
        { num: 10, id: '109', val: 'Сорт.', orig: '109', type: '13' },
        { num: 11, id: '132', val: 'Значение', orig: '132', type: '12' }
    ] },
    { id: '151', up: '0', type: '3', val: 'Меню', unique: '0', reqs: [
        { num: 1, id: '153', val: 'Адрес', orig: '152', type: '3' },
        { num: 2, id: '391', val: 'Иконка', orig: '390', type: '3' }
    ] }
];

// ---- база-источник ----
// «Договор» (500): ссылка на справочник «Статус договора» (520) с подписью «Статус»,
// подчинённая таблица «Платёж» (530), число «Сумма». Справочник идёт в metadata ПОСЛЕ
// таблицы, которая на него ссылается.
const SRC_META = SERVICE_META.concat([
    { id: '500', up: '0', type: '3', val: 'Договор', unique: '0', reqs: [
        { num: 1, id: '510', val: 'Статус договора', orig: '520', type: '3', ref: '520', ref_id: '511',
          attrs: '{"alias":"Статус"}', field_attrs: { required: false, multi: false, key: false, alias: 'Статус', default: '' } },
        { num: 2, id: '512', val: 'Платёж', orig: '530', type: '13', arr_id: '530',
          field_attrs: { required: false, multi: false, key: false, alias: null, default: '' } },
        { num: 3, id: '513', val: 'Сумма', orig: '540', type: '13',
          field_attrs: { required: false, multi: false, key: false, alias: null, default: '' } },
        // issue #5596: колонка-кнопка, действие (#5116) — в field_attrs.action
        { num: 4, id: '514', val: 'Передать', orig: '560', type: '7',
          field_attrs: { required: false, multi: false, key: false, alias: null, default: 'report/Q?FR_ДоговорID=[ID]',
              action: { type: 'link', label: 'Передать', url: 'report/Q?FR_ДоговорID=[ID]', newTab: false } } }
    ] },
    { id: '520', up: '0', type: '3', val: 'Статус договора', unique: '1', referenced: '511' },
    { id: '530', up: '0', type: '13', val: 'Платёж', unique: '0', reqs: [
        { num: 1, id: '531', val: 'Дата платежа', orig: '550', type: '9',
          field_attrs: { required: false, multi: false, key: false, alias: null, default: '' } }
    ] }
]);
const SRC_RECORDS = {
    '500': [{ i: '601', u: '1', r: ['Д-1', '521:Активен', '1', '1000', 'report/Q?FR_ДоговорID=601'] }],
    '520': [{ i: '521', u: '1', r: ['Активен'] }, { i: '522', u: '1', r: ['Закрыт'] }],
    '530': [{ i: '701', u: '601', r: ['5', '01.11.2026'] }],
    '22': [{ i: '800', u: '1', r: ['Договоры по статусу', '2', '50', 'report/800'] }],
    // issue #5599: пункт меню ведёт на запись по id
    '151': [{ i: '900', u: '145', r: ['Договор Д-1', 'dash/601', ''] }],
    '28': [
        { i: '801', u: '800', r: ['510:Статус', 'Статус', '', 'Активен', '', '', '', '', '1', '', '', '522'] },
        { i: '802', u: '800', r: ['500:Договор', 'Кол-во', '', '', '', '74:COUNT', '', '', '', '13:NUMBER', '-1', '601'] }
    ]
};

function sourceGet(endpoint) {
    const [p, q = ''] = endpoint.split('?');
    const params = new URLSearchParams(q);
    if (p === 'metadata') return SRC_META;
    const m = p.match(/^object\/(\d+)$/);
    if (!m) return null;
    const recs = SRC_RECORDS[m[1]] || [];
    if (params.has('F_U')) {
        const fu = parseInt(params.get('F_U'), 10);
        return recs.filter((r) => (fu > 0 ? r.u === String(fu) : r.u !== '0'));
    }
    return recs.filter((r) => r.u === '1'); // по умолчанию — дети корня
}

// ---- чистая база-приёмник: служебная схема + справочник функций (63) ----
function makeTarget() {
    let nextId = 1000;
    const terms = {};      // id -> { t, val }
    const refDefs = {};    // id строки-определения -> id таблицы-цели
    const reqs = {};       // id реквизита -> { up, t, alias, attrs }
    const records = { '74': { type: '63', up: '1', val: 'COUNT', params: {} }, '13': { type: '29', up: '1', val: 'NUMBER', params: {} } };
    const posts = [];
    const svcReq = (type, id) => {
        const t = SERVICE_META.find((x) => x.id === String(type));
        return t ? t.reqs.find((r) => r.id === String(id)) : null;
    };
    function refTargetOf(type, reqId) {
        const s = svcReq(type, reqId);
        if (s) return s.ref || null;
        const r = reqs[reqId];
        return r && refDefs[r.t] ? refDefs[r.t] : null;
    }
    function resolveRef(target, value) {
        if (/^\d+(,\d+)*$/.test(value)) return value;
        const hit = Object.keys(records).find((id) => records[id].type === String(target) && records[id].val === value);
        if (hit) return hit;
        const id = String(nextId++);
        records[id] = { type: String(target), up: '1', val: value, params: {}, autoCreated: true };
        return id;
    }
    function handle(action, id, body) {
        posts.push({ action, id, body });
        if (action === '_d_new') {
            const hit = Object.keys(terms).find((k) => terms[k].val === body.val && terms[k].t === String(body.t));
            if (hit) return { obj: hit, warnings: 'Тип ' + body.val + ' уже существует!' };
            const nid = String(nextId++); terms[nid] = { t: String(body.t), val: body.val }; return { obj: nid };
        }
        if (action === '_d_save') { // index.php: id типа — из адреса _d_save/{id}
            if (!terms[id]) return [{ error: 'Тип не найден.' }];
            terms[id].unique = body.unique ? '1' : '0'; return { obj: id };
        }
        if (action === '_d_action') { reqs[id].action = body.action ? JSON.parse(body.action) : null; return { obj: reqs[id].up }; }
        if (action === '_d_ref') {
            const hit = Object.keys(refDefs).find((k) => refDefs[k] === String(id));
            if (hit) return { obj: hit };
            const nid = String(nextId++); refDefs[nid] = String(id); return { obj: nid };
        }
        if (action === '_d_req') {
            const hit = Object.keys(reqs).find((k) => reqs[k].up === String(id) && reqs[k].t === String(body.t));
            if (hit) return { id: hit, obj: id, warnings: 'Реквизит уже существует!' };
            const nid = String(nextId++); reqs[nid] = { up: String(id), t: String(body.t), alias: null, attrs: null }; return { id: nid, obj: id };
        }
        if (action === '_d_alias') { reqs[id].alias = body.val; return { id: reqs[id].up, obj: reqs[id].up }; }
        if (action === '_d_attrs') { reqs[id].attrs = body; if (body.alias != null) reqs[id].alias = body.alias; return { id: reqs[id].up, obj: reqs[id].up }; }
        if (action === '_m_new' || action === '_m_set') {
            const rec = action === '_m_new' ? { type: String(id), up: String(body.up), val: body['t' + id], params: {} } : records[id];
            Object.keys(body).forEach((k) => {
                const m = k.match(/^t(\d+)$/);
                if (!m || m[1] === rec.type) return;
                const target = refTargetOf(rec.type, m[1]);
                rec.params[m[1]] = target && body[k] !== '' ? resolveRef(target, String(body[k])) : String(body[k]);
            });
            if (action === '_m_set') return { id, obj: id };
            const nid = String(nextId++); records[nid] = rec; return { id: nid, obj: nid };
        }
        return { id, obj: id };
    }
    function metadata() {
        const user = Object.keys(terms).map((tid) => ({ id: tid, up: '0', type: terms[tid].t, val: terms[tid].val,
            reqs: Object.keys(reqs).filter((r) => reqs[r].up === tid).map((r) => ({ id: r, orig: refDefs[reqs[r].t] || reqs[r].t })) }));
        return SERVICE_META.concat(user);
    }
    return { terms, refDefs, reqs, records, posts, handle, metadata };
}

// ---- запуск скрипта шаблона в поддельном окне ----
function makeEl(id) {
    return { id, value: '', checked: false, disabled: false, innerHTML: '', textContent: '', className: '', style: {},
        scrollTop: 0, scrollHeight: 0, _h: {}, addEventListener(type, fn) { this._h[type] = fn; }, appendChild() {} };
}
function loadPage(dbName, apiGet, apiPost, checks) {
    const els = {};
    const el = (id) => (els[id] || (els[id] = makeEl(id)));
    el('mig-threshold').value = '460';
    const boxes = Object.keys(checks).map((k) => {
        const [cls, key] = k.split(':');
        return Object.assign(makeEl(k), { cls, checked: checks[k], getAttribute: () => key });
    });
    const store = {};
    const ctx = {
        console: { log() {}, warn() {}, error: console.error },
        db: dbName, token: 'tok', xsrf: 'xs', role: 'admin',
        location: { pathname: '/' + dbName + '/migration' },
        URLSearchParams, setTimeout, Promise, JSON,
        localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
        confirm: () => true,
        document: {
            getElementById: el,
            createElement: () => makeEl('x'),
            querySelectorAll: (sel) => boxes.filter((b) => '.' + b.cls === sel)
        },
        fetch: async (url, opts) => {
            const rel = String(url).replace('/' + dbName + '/', '');
            let out;
            if (opts && opts.method === 'POST') {
                const [p] = rel.split('?');
                const [action, id] = p.split('/');
                out = apiPost(action, id, Object.fromEntries(new URLSearchParams(opts.body)));
            } else {
                out = apiGet(rel);
            }
            return { ok: true, status: 200, text: async () => JSON.stringify(out) };
        }
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    vm.runInContext(mainScript, ctx);
    return { el };
}

async function roundTrip() {
    const src = loadPage('src', sourceGet, () => ({}), {
        'mig-exp:data': true, 'mig-exp:queries': true, 'mig-exp:users': false, 'mig-exp:menus': true, 'mig-exp:files': false
    });
    await src.el('mig-export-btn')._h.click();
    const json = src.el('mig-export-json').value;
    assert.ok(json, 'экспорт сформировал JSON');
    const target = makeTarget();
    const dst = loadPage('dst', (rel) => (rel.split('?')[0] === 'metadata' ? target.metadata() : []), target.handle, {
        'mig-imp:tables': true, 'mig-imp:queries': true, 'mig-imp:menus': true, 'mig-imp:files': false, 'mig-imp:users': false
    });
    dst.el('mig-import-json').value = json;
    await dst.el('mig-import-btn')._h.click();
    return { pkg: JSON.parse(json), target };
}
const termId = (target, name) => Object.keys(target.terms).find((k) => target.terms[k].val === name);
const recordsOf = (target, type) => Object.keys(target.records).filter((k) => target.records[k].type === String(type));

test('#5410 п.1: записи подчинённой таблицы выгружаются и встают под свою родительскую запись', async () => {
    const { pkg, target } = await roundTrip();
    const pay = pkg.tables.find((t) => t.name === 'Платёж');
    assert.strictEqual(pay.records.length, 1, 'в пакете есть запись «Платёж»');
    const contractT = termId(target, 'Договор');
    const payT = termId(target, 'Платёж');
    const contractRec = recordsOf(target, contractT);
    assert.strictEqual(contractRec.length, 1);
    const payRec = recordsOf(target, payT);
    assert.strictEqual(payRec.length, 1, 'запись «Платёж» создана');
    assert.strictEqual(target.records[payRec[0]].up, contractRec[0], 'up платежа = новая запись договора');
    const arrReq = Object.keys(target.reqs).find((r) => target.reqs[r].up === contractT && target.reqs[r].t === payT);
    assert.ok(arrReq, '«Платёж» — подчинённая таблица договора (реквизит t = id таблицы), а не новый термин');
});

test('#5410 п.2: ссылочная колонка ведёт на таблицу-справочник, значение — на её запись', async () => {
    const { target } = await roundTrip();
    const contractT = termId(target, 'Договор');
    const dictT = termId(target, 'Статус договора');
    const refReq = Object.keys(target.reqs).find((r) => target.reqs[r].up === contractT && target.refDefs[target.reqs[r].t] === dictT);
    assert.ok(refReq, 'у «Договора» есть ссылка на «Статус договора»');
    const active = recordsOf(target, dictT).find((id) => target.records[id].val === 'Активен');
    const rec = target.records[recordsOf(target, contractT)[0]];
    assert.strictEqual(rec.params[refReq], active, 'договор ссылается на «Активен» справочника');
    const extra = Object.keys(target.records).filter((id) => target.records[id].autoCreated);
    assert.deepStrictEqual(extra.map((id) => target.records[id].val), [], 'лишних записей по тексту ссылки не заведено');
});

test('#5410 п.3: функция и формат колонки запроса уходят значением, справочник функций не засоряется', async () => {
    const { pkg, target } = await roundTrip();
    assert.ok(JSON.stringify(pkg).indexOf('74:COUNT') === -1, 'в пакете нет «74:COUNT»');
    const cols = recordsOf(target, 28).map((id) => target.records[id]);
    const cnt = cols.find((c) => c.params['100'] === 'Кол-во');
    assert.strictEqual(cnt.params['104'], '74', 'функция = существующая запись COUNT');
    assert.strictEqual(cnt.params['84'], '13', 'формат = существующая запись NUMBER');
    assert.strictEqual(recordsOf(target, 63).length, 1, 'в справочнике функций по-прежнему одна запись');
});

test('#5410 п.4: подпись колонки сохраняется, а не заменяется именем термина', async () => {
    const { pkg, target } = await roundTrip();
    const col = pkg.tables.find((t) => t.name === 'Договор').columns.find((c) => c.old_req_id === '510');
    assert.strictEqual(col.name, 'Статус');
    const contractT = termId(target, 'Договор');
    const dictT = termId(target, 'Статус договора');
    const refReq = Object.keys(target.reqs).find((r) => target.reqs[r].up === contractT && target.refDefs[target.reqs[r].t] === dictT);
    assert.strictEqual(target.reqs[refReq].alias, 'Статус');
});

test('#5410 п.5: фильтр, «скрыть», сортировка колонок и параметры запроса переносятся', async () => {
    const { target } = await roundTrip();
    const q = recordsOf(target, 22).map((id) => target.records[id]);
    assert.strictEqual(q.length, 1);
    assert.strictEqual(q[0].params['134'], '50', 'LIMIT запроса');
    const cols = recordsOf(target, 28).map((id) => target.records[id]);
    const st = cols.find((c) => c.params['100'] === 'Статус');
    assert.strictEqual(st.params['102'], 'Активен', 'фильтр «от»');
    assert.strictEqual(st.params['107'], '1', 'скрыть');
    const contractT = termId(target, 'Договор');
    const dictT = termId(target, 'Статус договора');
    const refReq = Object.keys(target.reqs).find((r) => target.reqs[r].up === contractT && target.refDefs[target.reqs[r].t] === dictT);
    assert.strictEqual(st.val, refReq, 'колонка запроса — на новый реквизит-ссылку');
    assert.strictEqual(cols.find((c) => c.params['100'] === 'Кол-во').params['109'], '-1', 'сортировка');
});

test('#5410: пакет прежнего формата (ref_target = строка-определение, «74:COUNT») разворачивается верно', async () => {
    const legacy = { kind: 'integram-migration', version: 1, source_db: 'old', service_max: 460, tables: [
        { old_id: '500', name: 'Договор', base_code: 3, unique: false, columns: [
            { old_req_id: '510', name: 'Статус договора', type_code: 3, old_type_id: '520', ref_target: '511', attrs: '' },
            { old_req_id: '512', name: 'Платёж', type_code: 13, old_type_id: '530', ref_target: null, attrs: '' }
        ], records: [{ old_id: '601', up: '1', values: ['Д-1', '521:Активен', '1'] }] },
        { old_id: '520', name: 'Статус договора', base_code: 3, unique: true, columns: [], records: [{ old_id: '521', up: '1', values: ['Активен'] }] },
        { old_id: '530', name: 'Платёж', base_code: 13, unique: false, columns: [
            { old_req_id: '531', name: 'Дата платежа', type_code: 9, old_type_id: '550', ref_target: null, attrs: '' }
        ], records: [{ old_id: '701', up: '601', values: ['5', '01.11.2026'] }] }
    ], queries: [{ old_id: '800', name: 'Q', columns: [{ source_old_id: '500', name: 'Кол-во', formula: '', func: '74:COUNT', format: '13:NUMBER', sort: '-1' }] }],
    users: [], menus: [], files: [] };
    const target = makeTarget();
    const dst = loadPage('dst', (rel) => (rel.split('?')[0] === 'metadata' ? target.metadata() : []), target.handle, {
        'mig-imp:tables': true, 'mig-imp:queries': true, 'mig-imp:menus': false, 'mig-imp:files': false, 'mig-imp:users': false
    });
    dst.el('mig-import-json').value = JSON.stringify(legacy);
    await dst.el('mig-import-btn')._h.click();
    const contractT = termId(target, 'Договор');
    const dictT = termId(target, 'Статус договора');
    const payT = termId(target, 'Платёж');
    assert.ok(Object.keys(target.reqs).some((r) => target.reqs[r].up === contractT && target.refDefs[target.reqs[r].t] === dictT), 'ссылка на справочник');
    assert.ok(Object.keys(target.reqs).some((r) => target.reqs[r].up === contractT && target.reqs[r].t === payT), 'подчинённая таблица');
    assert.strictEqual(target.records[recordsOf(target, payT)[0]].up, recordsOf(target, contractT)[0]);
    const col = target.records[recordsOf(target, 28)[0]];
    assert.strictEqual(col.params['104'], '74');
    assert.strictEqual(col.params['84'], '13');
});

test('#5596: флаг «уникальный» таблицы переносится', async () => {
    const { target } = await roundTrip();
    assert.strictEqual(target.terms[termId(target, 'Статус договора')].unique, '1', 'справочник уникальный, как в источнике');
    assert.notStrictEqual(target.terms[termId(target, 'Договор')].unique, '1', 'неуникальная таблица не помечена');
});

test('#5596: действие колонки-кнопки переносится', async () => {
    const { target } = await roundTrip();
    const contractT = termId(target, 'Договор');
    const btn = Object.keys(target.reqs).find((r) => target.reqs[r].up === contractT && target.terms[target.reqs[r].t] && target.terms[target.reqs[r].t].val === 'Передать');
    assert.ok(btn, 'колонка «Передать» создана');
    assert.deepStrictEqual(target.reqs[btn].action, { type: 'link', label: 'Передать', url: 'report/Q?FR_ДоговорID=[ID]', newTab: false });
    const plain = Object.keys(target.reqs).filter((r) => r !== btn && target.reqs[r].action !== undefined);
    assert.deepStrictEqual(plain, [], 'у колонок без действия _d_action не зовётся');
});

test('#5599: «Присвоить» ссылочной колонки запроса — id записи в приёмнике', async () => {
    const { target } = await roundTrip();
    const closed = recordsOf(target, termId(target, 'Статус договора')).find((id) => target.records[id].val === 'Закрыт');
    const cols = recordsOf(target, 28).map((id) => target.records[id]);
    assert.strictEqual(cols.find((c) => c.params['100'] === 'Статус').params['132'], closed, 'SET = новая запись «Закрыт»');
    assert.strictEqual(cols.find((c) => c.params['100'] === 'Кол-во').params['132'], '601', 'число у нессылочной колонки — как есть');
});

test('#5599: «Сформировать» запроса ведёт на сам новый запрос', async () => {
    const { target } = await roundTrip();
    const q = recordsOf(target, 22)[0];
    assert.strictEqual(target.records[q].params['111'], 'report/' + q);
});

test('#5599: адрес пункта меню dash/<id> — на новую запись', async () => {
    const { target } = await roundTrip();
    const contract = recordsOf(target, termId(target, 'Договор'))[0];
    const menu = recordsOf(target, 151).map((id) => target.records[id]);
    assert.strictEqual(menu.length, 1);
    assert.strictEqual(menu[0].params['153'], 'dash/' + contract);
});
