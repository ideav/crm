// Unit-тесты для ideav/crm#4364 — перетащил колонку «Закончено», нажал «Обновить»
// (.integram-table-settings-refresh) — и вся таблица «сломалась»: значения уехали
// на соседнюю колонку, даты показались ссылками, ссылки — числами.
//
// Причина. Перетаскивание колонки не только меняет локальный this.columnOrder, но и
// физически переставляет реквизит на сервере (POST _d_ord/{id}?order=N). После этого
// object/{typeId}/?JSON_OBJ раскладывает значения строки r[] в НОВОМ порядке, а
// this.columns остаётся построенным по старым метаданным: заново метаданные тянулись
// только при this.columns.length === 0 либо при расхождении ЧИСЛА колонок (#2526).
// Перестановка число колонок не меняет — детектор молчал, а render() читает ячейку как
// row[this.columns.indexOf(col)], то есть у соседа.
//
// Проверяем сквозной сценарий: загрузка → перетаскивание → «Обновить» → значение каждой
// колонки на месте. Плюс: докрутка (append) после перетаскивания и отсутствие лишних
// запросов метаданных, когда ничего не переставляли.
//
// Run with: node experiments/integram-table-4364.test.js

process.env.TZ = 'Europe/Moscow';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, total = 0;
function assertEqual(actual, expected, name) {
    total++;
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; }
    else { console.log('  expected:', JSON.stringify(expected)); console.log('  actual:  ', JSON.stringify(actual)); process.exitCode = 1; }
}

// ── Загрузка собранного бандла в песочницу ───────────────────────────────────
const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'integram-table.js'), 'utf8');
const sandbox = {
    console,
    URLSearchParams,
    location: { pathname: '/ateh/table/1078', search: '' },
    document: { getElementById: () => null, querySelectorAll: () => [], querySelector: () => null,
                addEventListener: () => {}, readyState: 'complete' },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
const { IntegramTable } = vm.runInContext(
    source + '\n;({ IntegramTable });', sandbox, { filename: 'integram-table.js' }
);

// ── Фейковый сервер «Задание в производство» (тип 1078) ──────────────────────
// Реквизиты в том порядке, в каком их отдаёт /metadata/1078 и в каком object/…?JSON_OBJ
// раскладывает r[]. Значение ячейки помечено именем своей колонки — так видно, если
// строка «уехала» на соседа.
const TYPE_ID = '1078';
const SHORT = '3', DATETIME = '4', NUMBER = '13';

function makeServer() {
    const server = {
        // Первый столбец таблицы (само значение объекта) + реквизиты по порядку ord
        reqs: [
            { id: '8474', val: 'Слиттер',            type: SHORT,    ref_id: '95358', orig: '95358' },
            { id: '8484', val: 'Вид сырья',          type: SHORT,    ref_id: '95358', orig: '95358' },
            { id: '8490', val: 'Резка и Лидер',      type: NUMBER },
            { id: '8491', val: 'Наладка ножей, мин', type: NUMBER },
            { id: '8492', val: 'Начато',             type: DATETIME },
            { id: '8493', val: 'В работе',           type: SHORT },
            { id: '8494', val: 'Закончено',          type: DATETIME },
            { id: '8495', val: 'Кол-во резок план',  type: NUMBER },
        ],
        metadataRequests: 0,
        dataRequests: 0,
    };

    server.metadata = () => {
        server.metadataRequests++;
        return {
            id: TYPE_ID, type: SHORT, val: 'Задание в производство', granted: 'WRITE',
            reqs: server.reqs.map((r, i) => Object.assign({ num: i + 1, attrs: '' }, r)),
        };
    };
    // Одна строка: главное значение + по значению на каждый реквизит, в порядке сервера
    server.rows = (count = 1) => {
        server.dataRequests++;
        const rows = [];
        for (let n = 0; n < count; n++) {
            rows.push({
                i: String(5000 + n), u: '1', o: '0',
                r: [`строка-${ n }`].concat(server.reqs.map(r => `val:${ r.val }`)),
            });
        }
        return rows;
    };
    // Ровно то, что делает index.php:_d_ord — ставит реквизит на позицию order (1-based)
    // среди реквизитов, сдвигая остальные.
    server.setOrder = (reqId, order) => {
        const from = server.reqs.findIndex(r => r.id === String(reqId));
        if (from === -1) return;
        const [moved] = server.reqs.splice(from, 1);
        server.reqs.splice(Math.min(Math.max(order - 1, 0), server.reqs.length), 0, moved);
    };
    return server;
}

// ── Экземпляр таблицы поверх фейкового сервера ───────────────────────────────
function makeTable(server, options = {}) {
    const noop = IntegramTable.prototype.init;
    IntegramTable.prototype.init = () => {};   // без DOM-бутстрапа и сетевого init
    const t = new IntegramTable('tbl', Object.assign({
        dataSource: 'table', tableTypeId: TYPE_ID, instanceName: 'tbl', pageSize: 20,
        apiUrl: '/ateh/object/1078/?JSON_OBJ',
    }, options));
    IntegramTable.prototype.init = noop;

    t.rowCount = 1;
    t.ordRequests = [];
    t.getApiBase = () => '/ateh';
    t.getPageUrlParams = () => new URLSearchParams();
    t.render = () => {};                       // рендер проверяем отдельно, через columns/data
    t.checkAndLoadMore = () => {};             // без DOM нечего домеривать
    t.saveColumnState = () => {};              // без cookie
    t.fetchJson = async () => server.rows(t.rowCount);
    // fetchMetadata/refetchTableMetadata и saveColumnOrderToServer ходят через глобальный fetch
    sandbox.fetch = async (url, init) => {
        const href = String(url);
        if (href.includes('/metadata/')) {
            return { ok: true, json: async () => server.metadata(), text: async () => JSON.stringify(server.metadata()) };
        }
        // POST _d_ord/{columnId}?JSON&order=N — сервер физически переставляет реквизит
        const ord = href.match(/\/_d_ord\/(\d+)/);
        if (ord) {
            const order = Number(new URLSearchParams(init.body).get('order'));
            t.ordRequests.push({ columnId: ord[1], order });
            server.setOrder(ord[1], order);
            return { ok: true, json: async () => ({}), text: async () => '{}' };
        }
        throw new Error(`unexpected fetch: ${ href }`);
    };
    return t;
}

// Ячейка так, как её достаёт render(): row[this.columns.indexOf(col)]
function cellsByHeader(t, rowIndex = 0) {
    const row = t.data[rowIndex] || [];
    const out = {};
    t.columnOrder
        .map(id => t.columns.find(c => c.id === id))
        .filter(Boolean)
        .forEach(col => { out[col.name] = row[t.columns.indexOf(col)]; });
    return out;
}
// _d_ord уходит без await — даём промису fetch долететь
const flush = () => new Promise(resolve => setImmediate(resolve));

function headers(t) {
    return t.columnOrder.map(id => (t.columns.find(c => c.id === id) || {}).name).filter(Boolean);
}

// ── 1. Базовая загрузка: каждая колонка показывает своё значение ─────────────
(async () => {
    const server = makeServer();
    const t = makeTable(server);
    await t.loadData(false);

    assertEqual(headers(t),
        ['Задание в производство', 'Слиттер', 'Вид сырья', 'Резка и Лидер', 'Наладка ножей, мин',
         'Начато', 'В работе', 'Закончено', 'Кол-во резок план'],
        'первая загрузка: шапка в порядке метаданных');
    assertEqual(cellsByHeader(t)['Закончено'], 'val:Закончено',
        'первая загрузка: «Закончено» показывает своё значение');

    // ── 2. #4364: перетащили «Закончено» левее и нажали «Обновить» ───────────
    // «Закончено» (id 8494) стоит 7-м реквизитом, тащим на место «Начато» (5-й).
    t.reorderColumns('8494', '8492');
    await flush();
    assertEqual(t.ordRequests, [{ columnId: '8494', order: 5 }],
        'перетаскивание шлёт на сервер _d_ord с новой позицией');
    assertEqual(headers(t),
        ['Задание в производство', 'Слиттер', 'Вид сырья', 'Резка и Лидер', 'Наладка ножей, мин',
         'Закончено', 'Начато', 'В работе', 'Кол-во резок план'],
        'после перетаскивания «Закончено» стоит перед «Начато»');

    t.refreshData();
    await t._loadDataPromise;

    assertEqual(cellsByHeader(t), {
        'Задание в производство': 'строка-0',
        'Слиттер': 'val:Слиттер',
        'Вид сырья': 'val:Вид сырья',
        'Резка и Лидер': 'val:Резка и Лидер',
        'Наладка ножей, мин': 'val:Наладка ножей, мин',
        'Закончено': 'val:Закончено',
        'Начато': 'val:Начато',
        'В работе': 'val:В работе',
        'Кол-во резок план': 'val:Кол-во резок план',
    }, '#4364: после «Обновить» каждая колонка по-прежнему показывает своё значение');

    // Типы тоже должны переехать вместе с колонками, иначе дата рисуется ссылкой
    const finished = t.columns.find(c => c.name === 'Закончено');
    const inWork = t.columns.find(c => c.name === 'В работе');
    assertEqual([finished.id, finished.type], ['8494', DATETIME],
        '#4364: у «Закончено» после обновления свой тип DATETIME');
    assertEqual([inWork.id, inWork.type], ['8493', SHORT],
        '#4364: у «В работе» после обновления свой тип SHORT');

    // ── 3. Порядок this.columns совпал с физической раскладкой сервера ───────
    assertEqual(t.columns.slice(1).map(c => c.id), server.reqs.map(r => r.id),
        '#4364: this.columns описывает ту раскладку r[], которую отдаёт сервер');
    assertEqual(t.metadataStale, false,
        '#4364: флаг metadataStale снят после успешной перезагрузки');

    // ── 4. Докрутка после перетаскивания не подмешивает строки новой раскладки ─
    const server2 = makeServer();
    const t2 = makeTable(server2);
    t2.rowCount = 21;                      // pageSize + 1 → hasMore = true
    await t2.loadData(false);
    assertEqual(t2.hasMore, true, 'докрутка: есть ещё страницы');

    t2.reorderColumns('8494', '8492');
    await flush();
    await t2.loadData(true);               // скролл вниз сразу после перетаскивания

    const misaligned = t2.data
        .map((_, i) => cellsByHeader(t2, i)['Закончено'])
        .filter(v => v !== 'val:Закончено');
    assertEqual(misaligned, [],
        '#4364: докрутка после перетаскивания перезагружает таблицу, а не смешивает раскладки');
    assertEqual(t2.columns.slice(1).map(c => c.id), server2.reqs.map(r => r.id),
        '#4364: после докрутки колонки тоже описывают текущую раскладку сервера');

    // ── 5. Без перетаскивания метаданные лишний раз не тянутся ───────────────
    const server3 = makeServer();
    const t3 = makeTable(server3);
    await t3.loadData(false);
    const afterFirstLoad = server3.metadataRequests;
    await t3.loadData(true);               // обычная докрутка
    assertEqual(server3.metadataRequests, afterFirstLoad,
        'докрутка без перестановки колонок метаданные не перезапрашивает');

    // «Обновить» тянет метаданные заново — чтобы подхватить и чужие правки схемы
    t3.refreshData();
    await t3._loadDataPromise;
    assertEqual(server3.metadataRequests, afterFirstLoad + 1,
        '«Обновить» перезапрашивает метаданные ровно один раз');

    // ── 6. Экспорт не должен подменять колонки таблицы на экране ─────────────
    // parseJsonDataArray переиспользуется выгрузкой; пока перезагрузки не было,
    // раскладка this.data остаётся старой — колонки трогать нельзя.
    const server4 = makeServer();
    const t4 = makeTable(server4);
    await t4.loadData(false);
    const columnsBefore = t4.columns.map(c => c.id);
    t4.reorderColumns('8494', '8492');
    await flush();
    await t4.parseJsonDataArray(server4.rows(1), false);   // как в exportTable()
    assertEqual(t4.columns.map(c => c.id), columnsBefore,
        '#4364: разбор выгрузки колонки таблицы на экране не переставляет');
    assertEqual(t4.metadataStale, true,
        '#4364: флаг остаётся взведённым до настоящей перезагрузки');

    console.log(`\n${ passed }/${ total } tests passed`);
})();
