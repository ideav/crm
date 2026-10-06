// Unit-тесты для ideav/crm#5087 — фильтр и сортировка по табличному реквизиту
// в табличном компоненте (js/integram-table).
//
// Табличный реквизит (подчинённая таблица) в метаданных несёт arr_id — id типа,
// строками которого хранятся значения (t=arr_id, up=запись). Бекенд строит join
// a<key>.t=<key>, поэтому и фильтр FR_, и сортировка ORDER должны идти по arr_id,
// а не по id строки-реквизита. Старый интерфейс (templates/object.html) слал
// FR_1081 (arr_id реквизита «Партия ГП») и получал верный результат; компонент
// слал FR_<id реквизита> и пустую выборку.
//
// Run with: node experiments/integram-table-5087.test.js

process.env.TZ = 'Europe/Moscow';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, total = 0;
function assert(cond, name) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) { passed++; } else { process.exitCode = 1; }
}
function assertEqual(actual, expected, name) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    total++;
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; }
    else { console.log('  expected:', JSON.stringify(expected)); console.log('  actual:  ', JSON.stringify(actual)); process.exitCode = 1; }
}

// ── Загрузка бандла в песочницу ──────────────────────────────────────────────
const SRC_PATH = path.join(__dirname, '..', 'js', 'integram-table.js');
const source = fs.readFileSync(SRC_PATH, 'utf8');
const sandbox = {
    console, URLSearchParams,
    location: { pathname: '/ateh/table/1078', search: '' },
    document: { getElementById: () => null, querySelectorAll: () => [], querySelector: () => null,
                addEventListener: () => {}, readyState: 'complete' },
    history: { replaceState: () => {} },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
const IntegramTable = vm.runInContext(
    source + '\n;({ IntegramTable });', sandbox, { filename: 'integram-table.js' }
).IntegramTable;

// ── Фейковый сервер «Задание в производство» (тип 1078) — реквизиты из issue #5087
const TYPE_ID = '1078';

function makeServer() {
    const server = {
        reqs: [
            { num: 1, id: '27162', val: 'Партия ГП',    orig: '1081',  type: '4', arr_id: '1081' },
            { num: 2, id: '82389', val: 'Номер джамбо', orig: '82374', type: '3', arr_id: '82374' },
            // обычный ссылочный реквизит — значения хранятся по id самого реквизита
            { num: 3, id: '95358', val: 'Вид сырья',    orig: '1069',  type: '3', ref: '1069', ref_id: '1100' },
        ],
    };
    server.metadata = () => ({
        id: TYPE_ID, type: '4', val: 'Задание в производство', granted: 'WRITE',
        reqs: server.reqs.map(r => Object.assign({ attrs: '' }, r)),
    });
    server.rows = () => [{
        i: '5000', u: '1', o: '0',
        r: ['задание-1', 'партия-А', 'джамбо-1', '770:Сырьё-А'],
    }];
    return server;
}

function makeTable(server) {
    const noop = IntegramTable.prototype.init;
    IntegramTable.prototype.init = () => {};
    const t = new IntegramTable('tbl', {
        dataSource: 'table', tableTypeId: TYPE_ID, instanceName: 'tbl', pageSize: 20,
        apiUrl: '/ateh/object/1078/?JSON_OBJ',
    });
    IntegramTable.prototype.init = noop;
    t.getApiBase = () => '/ateh';
    t.getPageUrlParams = () => new URLSearchParams();
    t.render = () => {};
    t.checkAndLoadMore = () => {};
    t.saveColumnState = () => {};
    t.filters = {};
    t.dataUrls = [];
    t.fetchJson = async (url) => { t.dataUrls.push(String(url)); return server.rows(); };
    sandbox.fetch = async (url) => {
        const href = String(url);
        if (href.includes('/metadata/')) {
            const meta = server.metadata();
            return { ok: true, json: async () => meta, text: async () => JSON.stringify(meta) };
        }
        throw new Error('unexpected fetch: ' + href);
    };
    return t;
}

function lastDataUrl(t) { return t.dataUrls[t.dataUrls.length - 1]; }

(async () => {
    // ── 1. Фильтр «%» по «Партия ГП» (id 27162, arr_id 1081) → FR_1081 ────────
    {
        const t = makeTable(makeServer());
        t.filters = { '27162': { type: '%', value: '' } };
        await t.loadData(false);
        const url = lastDataUrl(t);
        assert(url.includes('FR_1081=%25'),
            'фильтр по «Партия ГП» уходит как FR_1081=% (id массива, как в старом UI)');
        assert(!url.includes('FR_27162'),
            'id строки-реквизита (27162) в запросе фильтра не участвует');
    }

    // ── 2. Фильтр «%» по «Номер джамбо» (id 82389, arr_id 82374) → FR_82374 ───
    {
        const t = makeTable(makeServer());
        t.filters = { '82389': { type: '%', value: '' } };
        await t.loadData(false);
        assert(lastDataUrl(t).includes('FR_82374=%25'),
            'фильтр по «Номер джамбо» уходит как FR_82374=% (а не FR_82389 из issue)');
    }

    // ── 3. Обычный ссылочный реквизит фильтруется по своему id, как раньше ────
    {
        const t = makeTable(makeServer());
        t.filters = { '95358': { type: '=', value: 'Сырьё-А' } };
        await t.loadData(false);
        const url = lastDataUrl(t);
        assert(url.includes('FR_95358='), 'обычный реквизит фильтруется по своему id (без arr_id)');
        assert(!url.includes('FR_1069'), 'для обычного реквизита orig в фильтр не подставляется');
    }

    // ── 4. Сортировка по табличной колонке → ORDER=1081 / ORDER=-1081 ─────────
    {
        const t = makeTable(makeServer());
        t.sortColumn = '27162';
        t.sortDirection = 'asc';
        await t.loadData(false);
        assert(lastDataUrl(t).includes('ORDER=1081'),
            'сортировка по «Партия ГП» asc уходит как ORDER=1081');

        t.sortDirection = 'desc';
        await t.loadData(false);
        assert(lastDataUrl(t).includes('ORDER=-1081'),
            'сортировка desc уходит как ORDER=-1081');
    }

    // ── 5. Обычные колонки сортируются по своему id; без сортировки ORDER нет ─
    {
        const t = makeTable(makeServer());
        t.sortColumn = '95358';
        t.sortDirection = 'asc';
        await t.loadData(false);
        assert(lastDataUrl(t).includes('ORDER=95358'),
            'сортировка по обычному реквизиту не изменилась');

        t.sortColumn = null;
        t.sortDirection = null;
        await t.loadData(false);
        assert(!lastDataUrl(t).includes('ORDER'),
            'без сортировки параметр ORDER не отправляется');
    }

    // ── 6. Старая ссылка с FR_1081 привязывается к колонке «Партия ГП» ────────
    {
        sandbox.location.search = '?FR_1081=%25';
        const t = makeTable(makeServer());
        await t.loadData(false); // колонки загружаются до разбора URL-фильтров
        t.parseUrlFiltersFromParams();
        assert(t.filters['27162'] && t.filters['27162'].type === '%',
            'FR_1081 из URL показан как фильтр колонки «Партия ГП» (27162)');
        assert(!t.filters['1081'],
            'ключ по arr_id (1081) в фильтрах не остаётся');

        await t.loadData(false);
        assert(lastDataUrl(t).includes('FR_1081=%25'),
            'фильтр из старой ссылки переиздаётся как FR_1081');
        assertEqual(lastDataUrl(t).split('FR_1081=%25').length - 1, 1,
            'FR_1081 встречается в запросе ровно один раз');
        sandbox.location.search = '';
    }

    // ── 7. Переопределение фильтра чистит и FR_<arr_id> из URL ────────────────
    {
        sandbox.location.search = '?FR_1081=%25';
        const t = makeTable(makeServer());
        await t.loadData(false); // колонки должны быть загружены
        t.handleFilterOverride('27162', 'А-12');
        assert(t.overriddenUrlParams.has('FR_1081'),
            'handleFilterOverride помечает FR_<arr_id> как переопределённый');
        sandbox.location.search = '';
    }

    console.log('');
    console.log(passed + '/' + total + ' passed');
})();
