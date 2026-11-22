// issue #5617, Д8: пустой прогон (отчёт подбора не даёт SKU ни для одной строки) писал
// «Наш артикул = 0» во ВСЕ строки RFP, и повторный «Старт» отвечал «не осталось».
// Поведение: прогон останавливается на первой пачке без единого кандидата; ошибка отчёта
// строку не помечает; строки «нет совпадений» возвращаются в подбор кнопкой сброса.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const OUR = '31', CAND = '32', ACC = '33', NAME = '30', RFP_TABLE = '2032189';

function makeServer(rowCount, reportMode) {
    const rows = [];
    for (let i = 1; i <= rowCount; i++) rows.push({ id: String(1000 + i), name: 'Кабель ВВГ 3х' + i, our: '', cand: '', acc: '' });
    const server = { rows, posts: 0, reportMode };
    server.fetch = async function(url, options) {
        const u = new URL(url, 'https://ideav.ru');
        const reply = (status, body) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) });
        if (options && options.method === 'POST') {
            const id = u.pathname.split('/').pop();
            const row = rows.find(r => r.id === id);
            const body = new URLSearchParams(options.body);
            server.posts++;
            if (body.has('t' + OUR)) row.our = body.get('t' + OUR);
            if (body.has('t' + CAND)) row.cand = body.get('t' + CAND);
            if (body.has('t' + ACC)) row.acc = body.get('t' + ACC);
            return reply(200, { id, obj: id });
        }
        if (u.pathname.indexOf('/object/' + RFP_TABLE + '/') >= 0) {
            const filter = u.searchParams.get('F_' + OUR);
            const [offset, limit] = (u.searchParams.get('LIMIT') || '0,50').split(',').map(Number);
            const picked = rows.filter(r => filter === '!%' ? r.our === '' : (filter == null || r.our === filter));
            return reply(200, picked.slice(offset, offset + limit).map(r => ({ i: r.id, r: [r.name, r.our, r.cand, r.acc] })));
        }
        if (u.pathname.indexOf('/report/') >= 0) {
            const rfpId = u.searchParams.get('FR_RFPID');
            if (server.reportMode === 'error') return reply(500, 'SQL error');
            if (server.reportMode === 'empty') return reply(200, [{ RFP: rfpId, SKUID: '', 'Наименование SKU': '', 'токены': '' }]);
            return reply(200, [{ RFP: rfpId, SKUID: '777', 'Наименование SKU': 'Кабель ВВГ', 'Артикул': 'VVG', 'токены': 'ВВГ,Кабель', 'Вес': '2', 'ТММ': '0' }]);
        }
        return reply(404, 'unexpected ' + url);
    };
    return server;
}

function load(rel, server) {
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
    state.db = 'pilot';
    state.rfpTable = RFP_TABLE;
    state.query = 'mass_match';
    state.rfpFilter = 'RFPID';
    state.batchSize = 10;
    state.concurrency = 3;
    state.autoConcurrency = false;
    state.maxCandidates = 20;
    state.placeholderOurId = '0';
    state.skuIdKey = 'SKUID';
    state.skuLabelKey = 'Наименование SKU';
    state.skuArticleKey = 'Артикул';
    state.tokensKey = 'токены';
    state.tmaKey = 'ТММ';
    state.fields = { rfpName: { id: NAME, index: 0 }, our: { id: OUR, index: 1 }, candidates: { id: CAND, index: 2 }, accuracy: { id: ACC, index: 3 } };
    return api;
}

(async () => {
    for (const rel of ['download/cm/js/xcom-mass-match.js', 'download/xcom/js/xcom-mass-match.js']) {
        // 1. Сломанный отчёт (строка RFP без SKU для всех строк): помечена только первая пачка.
        const broken = makeServer(53, 'empty');
        const api = load(rel, broken);
        await api.loadBatch();
        await api.runAuto();
        const marked = broken.rows.filter(r => r.our === '0').length;
        assert.strictEqual(marked, 10, rel + ': пустой прогон остановлен на первой пачке, помечено ' + marked + ' из 53');

        // Сброс возвращает строки «нет совпадений» в подбор.
        assert.strictEqual(typeof api.resetNoMatch, 'function', rel + ': есть сброс строк «нет совпадений»');
        await api.resetNoMatch();
        assert.strictEqual(broken.rows.filter(r => r.our !== '').length, 0, rel + ': после сброса «Наш артикул» пуст у всех');

        // После починки отчёта повторный «Старт» подбирает все строки.
        broken.reportMode = 'ok';
        await api.loadBatch();
        await api.runAuto();
        assert.strictEqual(broken.rows.filter(r => r.our === 'VVG').length, 53, rel + ': повторный прогон подобрал все 53');

        // 2. Ошибка отчёта строку не помечает: она остаётся в подборе.
        const failing = makeServer(25, 'error');
        const api2 = load(rel, failing);
        await api2.loadBatch();
        await api2.runAuto();
        assert.strictEqual(failing.rows.filter(r => r.our !== '').length, 0, rel + ': ошибка отчёта не пишет заглушку');
        assert.strictEqual(failing.posts, 0, rel + ': при ошибке отчёта записей нет');

        // 3. Рабочий отчёт: обычный прогон проходит все пачки до конца.
        const healthy = makeServer(23, 'ok');
        const api3 = load(rel, healthy);
        await api3.loadBatch();
        await api3.runAuto();
        assert.strictEqual(healthy.rows.filter(r => r.our === 'VVG').length, 23, rel + ': рабочий прогон дошёл до конца');
    }
    console.log('test-issue-5617-xcom-mass-empty-run: ok');
})().catch(error => { console.error(error); process.exit(1); });
