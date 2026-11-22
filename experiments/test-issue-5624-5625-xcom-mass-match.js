// issue #5624: у SKU без артикула «Наш артикул» и «Кандидаты» получали внутренний id записи
// SKU — партнёр видел число. Теперь пишется код SKU (колонка «Код SKU» отчёта mass_match —
// главное значение записи), id — только если отчёт кода не отдал.
// issue #5625: позиция, которой нет в каталоге, получала случайный SKU с точностью 2–3.
// Теперь ниже порога min_accuracy (конфиг сопоставления, по умолчанию 5) строка помечается
// «нет совпадений», а найденные SKU остаются в «Кандидатах» на ручной выбор.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const OUR = '31', CAND = '32', ACC = '33', NAME = '30', RFP_TABLE = '2032189';

function makeServer(rfp, skuByRfp) {
    const rows = rfp.map((name, i) => ({ id: String(1000 + i), name, our: '', cand: '', acc: '' }));
    const server = { rows };
    server.fetch = async function(url, options) {
        const u = new URL(url, 'https://ideav.ru');
        const reply = (status, body) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) });
        if (options && options.method === 'POST') {
            const row = rows.find(r => r.id === u.pathname.split('/').pop());
            const body = new URLSearchParams(options.body);
            if (body.has('t' + OUR)) row.our = body.get('t' + OUR);
            if (body.has('t' + CAND)) row.cand = body.get('t' + CAND);
            if (body.has('t' + ACC)) row.acc = body.get('t' + ACC);
            return reply(200, { id: row.id, obj: row.id });
        }
        if (u.pathname.indexOf('/object/' + RFP_TABLE + '/') >= 0) {
            const filter = u.searchParams.get('F_' + OUR);
            const [offset, limit] = (u.searchParams.get('LIMIT') || '0,50').split(',').map(Number);
            const picked = rows.filter(r => filter === '!%' ? r.our === '' : (filter == null || r.our === filter));
            return reply(200, picked.slice(offset, offset + limit).map(r => ({ i: r.id, r: [r.name, r.our, r.cand, r.acc] })));
        }
        if (u.pathname.indexOf('/report/') >= 0) {
            const rfpId = u.searchParams.get('FR_RFPID');
            const row = rows.find(r => r.id === rfpId);
            return reply(200, skuByRfp[row.name] || []);
        }
        return reply(404, 'unexpected ' + url);
    };
    return server;
}

function load(rel, server, config) {
    const source = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
    const sandbox = {
        window: {},
        document: { readyState: 'loading', addEventListener() {}, getElementById() { return null; }, querySelector() { return null; } },
        console, URLSearchParams, URL, setTimeout, clearTimeout, setInterval() { return 0; }, clearInterval() {},
        fetch: (url, options) => server.fetch(url, options)
    };
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox, { filename: rel });
    const api = sandbox.window.XcomMassMatchWorkspace;
    const state = api._state;
    Object.assign(state, {
        db: 'pilot', rfpTable: RFP_TABLE, query: 'mass_match', rfpFilter: 'RFPID', batchSize: 10, concurrency: 1,
        autoConcurrency: false, maxCandidates: 20, placeholderOurId: '0', skuIdKey: 'SKUID',
        skuLabelKey: 'Наименование SKU', skuArticleKey: 'Артикул', tokensKey: 'токены', tmaKey: 'ТММ',
        fields: { rfpName: { id: NAME, index: 0 }, our: { id: OUR, index: 1 }, candidates: { id: CAND, index: 2 }, accuracy: { id: ACC, index: 3 } }
    });
    if (config) state.matchConfig = api.mergeMatchingConfig(state.matchConfig, config);
    return api;
}

const sku = (id, code, article, label, tokens) => ({ RFP: '', SKUID: id, 'Код SKU': code, 'Наименование SKU': label, 'Артикул': article, 'токены': tokens, 'ТММ': '0' });

(async () => {
    for (const rel of ['download/cm/js/xcom-mass-match.js', 'download/xcom/js/xcom-mass-match.js']) {
        const cable = 'Кабель ВВГнг-LS 3х2,5 ГОСТ';
        const shield = 'Щит распределительный ЩРН-24 IP31';
        const skuByRfp = {};
        skuByRfp[cable] = [
            sku('7529182', 'ЭТ-100200', '', 'Кабель ВВГнг-LS 3х2,5 ГОСТ', 'ВВГнг-LS,3х2,5,ГОСТ,Кабель'),
            sku('7529183', 'ЭТ-100201', 'VVG325', 'Кабель ВВГнг-LS 3х1,5', 'ВВГнг-LS,Кабель')
        ];
        skuByRfp[shield] = [sku('7529300', 'ЭТ-300100', '', 'Лампа светодиодная E27 10Вт', 'Вт')];

        // #5624: код SKU вместо id записи, артикул по-прежнему главнее кода.
        const server = makeServer([cable, shield], skuByRfp);
        const api = load(rel, server);
        assert.strictEqual(api._state.matchConfig.min_accuracy, 5, rel + ': порог по умолчанию 5');
        await api.loadBatch();
        await api.runAuto();
        const cableRow = server.rows.find(r => r.name === cable);
        assert.strictEqual(cableRow.our, 'ЭТ-100200', rel + ': #5624 у SKU без артикула «Наш артикул» = код SKU, а не id записи');
        assert.strictEqual(cableRow.cand, 'VVG325', rel + ': у кандидата с артикулом — артикул');
        assert(Number(cableRow.acc) >= 5, rel + ': настоящий подбор выше порога (' + cableRow.acc + ')');

        // #5625: позиция не из каталога — «нет совпадений», найденное — в кандидатах.
        const shieldRow = server.rows.find(r => r.name === shield);
        assert(Number(shieldRow.acc) < 5, rel + ': точность слабого совпадения ниже порога (' + shieldRow.acc + ')');
        assert.strictEqual(shieldRow.our, '0', rel + ': #5625 ниже порога — заглушка «нет совпадений»');
        assert.strictEqual(shieldRow.cand, 'ЭТ-300100', rel + ': #5625 слабое совпадение оставлено кандидатом');

        // Порог 0 отключает отсечку: работает как раньше.
        const loose = makeServer([shield], skuByRfp);
        const api2 = load(rel, loose, { min_accuracy: 0 });
        await api2.loadBatch();
        await api2.runAuto();
        assert.strictEqual(loose.rows[0].our, 'ЭТ-300100', rel + ': min_accuracy 0 — отсечки нет');

        // Отчёт без колонки «Код SKU» (база до #5624) — по-прежнему id.
        const old = {};
        old[cable] = [Object.assign(sku('7529182', '', '', 'Кабель ВВГнг-LS 3х2,5 ГОСТ', 'ВВГнг-LS,3х2,5,ГОСТ,Кабель'))];
        delete old[cable][0]['Код SKU'];
        const legacy = makeServer([cable], old);
        const api3 = load(rel, legacy);
        await api3.loadBatch();
        await api3.runAuto();
        assert.strictEqual(legacy.rows[0].our, '7529182', rel + ': без колонки кода — id, как раньше');

        // Конфиг: порог — число 0..100.
        assert.deepStrictEqual([...api.validateMatchingConfig({ min_accuracy: 30 })], [], rel + ': min_accuracy 30 валиден');
        assert.match(api.validateMatchingConfig({ min_accuracy: 150 }).join(';'), /min_accuracy/, rel + ': min_accuracy вне 0..100 — ошибка');
    }

    // Форма настроек сохраняет порог.
    for (const rel of ['download/cm/js/xcom-settings.js', 'download/xcom/js/xcom-settings.js']) {
        const sandbox = { window: {}, document: { readyState: 'loading', addEventListener() {}, getElementById() { return null; } }, console };
        vm.createContext(sandbox);
        vm.runInContext(fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'), sandbox, { filename: rel });
        const settings = sandbox.window.XcomMatchingSettingsWorkspace;
        assert.strictEqual(settings.formFromConfig({}).min_accuracy, undefined, rel + ': порог не задан — в конфиг не дописывается');
        assert.strictEqual(settings.formFromConfig({ min_accuracy: 12 }).min_accuracy, 12);
        assert.strictEqual(settings.configFromForm({ tma_weight: 0.5, min_accuracy: '12', required_attributes: [] }).min_accuracy, 12, rel + ': порог сохраняется числом');
    }

    // Отчёт подбора отдаёт код SKU.
    const specs = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs/xcom_reports.json'), 'utf8'));
    const col = specs.find(s => s.name === 'mass_match').columns.find(c => c.name === 'Код SKU');
    assert(col && col.source === 'SKU' && col.field === '$id' && col.function === 'MAX', 'mass_match: колонка «Код SKU» = MAX главного значения SKU');
    const defaults = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs/xcom_matching_config.default.json'), 'utf8'));
    assert.strictEqual(defaults.min_accuracy, 5, 'дефолт-файл конфига: min_accuracy 5');

    console.log('test-issue-5624-5625-xcom-mass-match: ok');
})().catch(error => { console.error(error); process.exit(1); });
