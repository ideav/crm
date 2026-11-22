// issue #5617: правка шаблона cm (Д4, Д7, Д9, дубли полей).
// 1) Правило установщика: в отчётах подбора нет колонок по бренду — с ними ядро соединяет
//    RFP и SKU через «Бренд», а не через общие токены, и подбор пуст (Д7).
// 2) docs/scripts/fix_5617_cm_template.js против поддельной базы: dry-run ничего не пишет,
//    --apply приводит схему, отчёты и меню к нужному виду, повторный запуск — «нечего менять».
const fs = require('fs');
const path = require('path');
const http = require('http');
const { execFile } = require('child_process');
const assert = require('assert');

const root = path.join(__dirname, '..');
const specs = JSON.parse(fs.readFileSync(path.join(root, 'docs/xcom_reports.json'), 'utf8'));
for (const name of ['mass_match', 'Сопоставление']) {
    const spec = specs.find(s => s.name === name);
    assert(spec, 'в docs/xcom_reports.json есть отчёт ' + name);
    const cols = spec.columns || specs.find(s => s.name === spec.inherits).columns;
    const brandCols = cols.filter(c => c.source === 'Бренд' || (c.field === 'Бренд' && (c.source === 'RFP' || c.source === 'SKU')));
    assert.deepStrictEqual(brandCols.map(c => c.name), [], name + ': колонок по бренду нет');
}

// --- поддельная база в форме шаблона cm --------------------------------------------------
function makeDb() {
    const db = {
        meta: [
            { id: '1953593', val: 'SKU', reqs: [
                { id: '1953597', val: 'Наименование', type: '8' },
                { id: '1953595', val: 'Артикул', type: '3' },
                { id: '7528649', val: 'Наименование', type: '12' },
                { id: '7528650', val: 'Бренд', type: '3', arr_id: '2032775' }] },
            { id: '2032189', val: 'RFP', reqs: [
                { id: '2032307', val: 'Наименование', type: '8' },
                { id: '2033352', val: 'Бренд', type: '3', ref: '2032775', ref_id: '2032775' },
                { id: '6334032', val: 'Кандидаты', type: '8' },
                { id: '6333968', val: 'Точность подбора', type: '14' },
                { id: '7528656', val: 'Наименование', type: '12' },
                { id: '7528659', val: 'Бренд', type: '3', arr_id: '2032775' },
                { id: '7528664', val: 'Кандидаты', type: '12' },
                { id: '7528666', val: 'Точность подбора', type: '13' }] },
            { id: '2032775', val: 'Бренд', reqs: [] }
        ],
        objects: {
            22: [{ i: 6333912, u: 1, r: ['mass_match'] }, { i: 2535910, u: 1, r: ['Сопоставление'] },
                { i: 2098323, u: 1, r: ['Токенизация SKU'] }, { i: 2185203, u: 1, r: ['Токенизация RFP'] }],
            28: [
                { i: 6333920, u: 6333912, r: ['2032189:RFP', 'RFPID', '', '5787441'] },
                { i: 6333914, u: 6333912, r: ['2032775:Бренд', 'Бренд', '', ''] },
                { i: 6333916, u: 6333912, r: ['1953597:SKU -> Наименование', 'Наименование SKU', '', ''] },
                { i: 7528724, u: 6333912, r: ['2033352:RFP -> Бренд', 'Бренд RFP', '', ''] },
                { i: 7528727, u: 6333912, r: ['7528650:SKU -> Бренд', 'Бренд SKU', '', ''] },
                { i: 2956466, u: 2535910, r: ['2032189:RFP', 'RFP', '', '10458721-1'] },
                { i: 2215492, u: 2185203, r: ['2032307:RFP -> Наименование', 'Наименование', 'Наименование', ''] }],
            42: [{ i: 145, u: 1, r: ['admin'] }, { i: 7528778, u: 1, r: ['Партнёр'] }],
            151: [{ i: 6975321, u: 145, r: ['XCOM', ''] }, { i: 242, u: 6975321, r: ['Загрузка', 'upload'] },
                { i: 7528808, u: 7528778, r: ['Первичная настройка', 'wizard'] }],
            1953593: [], 2032189: []
        },
        writes: [], nextId: 9000000
    };
    return db;
}

function serve(db) {
    return http.createServer((req, res) => {
        const u = new URL(req.url, 'http://x');
        const parts = u.pathname.split('/').filter(Boolean); // [db, cmd, id?]
        const send = body => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); };
        let body = '';
        req.on('data', d => { body += d; });
        req.on('end', () => {
            const form = new URLSearchParams(body);
            const cmd = parts[1], id = parts[2];
            if (cmd === 'xsrf') return send({ _xsrf: 'x' });
            if (cmd === 'metadata') return send(db.meta);
            if (cmd === '_ref_reqs') return send({ 85: 'abn_ID', 86: 'MAX', 87: 'COUNT' });
            if (cmd === 'object') {
                const fu = u.searchParams.get('F_U');
                let list = db.objects[id] || [];
                if (fu) list = list.filter(x => String(x.u) === fu);
                const filled = [...u.searchParams.keys()].find(k => /^F_\d+$/.test(k));
                if (filled) list = [];
                return send(list);
            }
            if (req.method !== 'POST') return send({ error: 'unexpected ' + req.url });
            db.writes.push(cmd + '/' + id);
            const all = Object.values(db.objects).flat();
            if (cmd === '_m_del') {
                for (const k of Object.keys(db.objects)) db.objects[k] = db.objects[k].filter(x => String(x.i) !== id);
                return send({ id: '28', obj: Number(id) });
            }
            if (cmd === '_m_set') {
                const row = all.find(x => String(x.i) === id);
                if (form.has('t102')) row.r[3] = form.get('t102');
                if (form.has('t104')) row.r[4] = form.get('t104');
                return send({ id, obj: id });
            }
            if (cmd === '_d_del_req') { for (const t of db.meta) t.reqs = t.reqs.filter(r => r.id !== id); return send({ id }); }
            if (cmd === '_d_ref') return send({ id, obj: '7534216' });
            if (cmd === '_d_req') {
                db.meta.find(t => t.id === id).reqs.push({ id: String(db.nextId++), val: 'Бренд', type: '3', ref: '2032775', ref_id: '7534216' });
                return send({ id: 'new', obj: id });
            }
            if (cmd === '_m_new' && id === '28') {
                const i = db.nextId++;
                db.objects[28].push({ i, u: Number(form.get('up')), r: [form.get('t28') + ':SKU', form.get('t100'), '', '', ''] });
                return send({ id: '28', obj: i });
            }
            if (cmd === '_m_new') {
                db.objects[151].push({ i: db.nextId++, u: Number(u.searchParams.get('up')), r: [form.get('t151'), form.get('t153')] });
                return send({ id: 'new', obj: 'new' });
            }
            send({ error: 'unexpected ' + cmd });
        });
    });
}

function run(port, extra) {
    return new Promise((resolve, reject) => {
        execFile(process.execPath, [path.join(root, 'docs/scripts/fix_5617_cm_template.js'),
            '--base', 'http://127.0.0.1:' + port, '--db', 'cm', '--token', 't'].concat(extra || []), (error, stdout, stderr) => {
            if (error) return reject(new Error(stderr || stdout || error.message));
            resolve(stdout);
        });
    });
}

(async () => {
    const db = makeDb();
    const server = serve(db);
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    try {
        const dry = await run(port);
        assert.strictEqual(db.writes.length, 0, 'dry-run ничего не пишет');
        assert.match(dry, /БЫЛО 5787441 → СТАЛО \(пусто\)/);

        await run(port, ['--apply']);
        const cols = db.objects[28].map(c => c.r[1]);
        assert.deepStrictEqual(cols.sort(), ['RFP', 'RFPID', 'Код SKU', 'Код SKU', 'Наименование', 'Наименование SKU'].sort(), 'Д7: колонки по бренду удалены, #5624: «Код SKU» добавлен');
        const codeCols = db.objects[28].filter(c => c.r[1] === 'Код SKU');
        assert.deepStrictEqual(codeCols.map(c => [c.u, c.r[0], c.r[4]]).sort(), [[6333912, '1953593:SKU', '86'], [2535910, '1953593:SKU', '86']].sort(),
            '#5624: «Код SKU» в mass_match и «Сопоставлении» — главное значение SKU с функцией MAX');
        assert.strictEqual(db.objects[28].find(c => c.r[1] === 'RFPID').r[3], '', 'Д7: вшитый RFPID снят');
        assert.strictEqual(db.objects[28].find(c => c.r[1] === 'RFP').r[3], '', 'вшитый фильтр «Сопоставления» снят');
        const sku = db.meta.find(t => t.val === 'SKU').reqs, rfp = db.meta.find(t => t.val === 'RFP').reqs;
        assert.deepStrictEqual(sku.filter(r => r.val === 'Наименование').map(r => r.id), ['1953597'], 'дубль «Наименование» SKU снят');
        assert(sku.some(r => r.val === 'Бренд' && r.ref === '2032775') && !sku.some(r => r.arr_id), 'Д4: у SKU «Бренд» — ссылка');
        assert.deepStrictEqual(rfp.map(r => r.id).sort(), ['2032307', '2033352', '6333968', '6334032'].sort(), 'дубли RFP сняты, ссылка «Бренд» осталась');
        const menu = up => db.objects[151].filter(m => m.u === up).map(m => m.r[1]);
        assert.deepStrictEqual(menu(6975321).sort(), ['settings', 'upload', 'wizard'].sort(), 'Д9: мастер и настройки в меню admin');
        assert.deepStrictEqual(menu(7528778).sort(), ['report/2098323', 'report/2185203', 'upload', 'wizard'].sort(), 'Д9: загрузка и токенизация у Партнёра');

        const writes = db.writes.length;
        const again = await run(port);
        assert.match(again, /нечего менять/, 'повторный запуск — нечего менять');
        assert.strictEqual(db.writes.length, writes);
    } finally {
        server.close();
    }
    console.log('test-issue-5617-cm-template-fix: ok');
})().catch(error => { console.error(error); process.exit(1); });
