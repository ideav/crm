// Тесты ideav/crm#5089 — js/integram-table.js не должен пересылать параметр `_itc`
// в каждый запрос к API.
//
// `_itc` — упакованный (base64+URL) конфиг таблицы для кнопки «Поделиться ссылкой»
// (issue #510). Ядро (PHP/Node) этот параметр не читает — см. issue #5089 — но
// getPageUrlParams()/appendPageUrlParams() (issue #476) пересылали в API ВСЕ параметры
// адресной строки, включая `_itc`. Он раздувал каждый запрос данных/экспорта сотнями
// байт впустую.
//
// Проверяем поведение реальных методов (бандл исполняется в песочнице):
//   1. getPageUrlParams() не отдаёт `_itc`, но продолжает пересылать FR_* (issue #476);
//   2. appendPageUrlParams() не добавляет `_itc` к параметрам запроса;
//   3. сама функция «Поделиться ссылкой» жива: getConfigUrl() по-прежнему строит URL с `_itc`;
//   4. открытие такой ссылки восстанавливает конфиг: loadConfigFromUrl() читает `_itc`.
//
// Run with: node experiments/integram-table-5089.test.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, total = 0;
function assert(cond, name) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) { passed++; } else { process.exitCode = 1; }
}

// ── Загрузка бандла в песочницу ──────────────────────────────────────────────
const SRC_PATH = path.join(__dirname, '..', 'js', 'integram-table.js');
const source = fs.readFileSync(SRC_PATH, 'utf8');
const sandbox = {
    console, URL, URLSearchParams, btoa, atob,
    encodeURIComponent, decodeURIComponent, setTimeout,
    location: {
        href: 'https://ideav.ru/ateh/object/1078/',
        pathname: '/ateh/object/1078/',
        search: '',
    },
    document: { getElementById: () => null, querySelectorAll: () => [], querySelector: () => null,
                addEventListener: () => {}, readyState: 'complete' },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
const { IntegramTable } = vm.runInContext(
    source + '\n;({ IntegramTable });', sandbox, { filename: 'integram-table.js' }
);

// ── Реалистичный `_itc`: конфиг с фильтром и порядком колонок (как в issue) ──
function encodeItc(config) {
    return btoa(encodeURIComponent(JSON.stringify(config)));
}
const ITC = encodeItc({
    f: { 27162: { t: '%', v: '' }, 82389: { t: '%', v: '' } },
    o: ['1078', '1156', '95358'],
    v: ['1078', '1156', '95358'],
});

function makeTable(search) {
    sandbox.location.search = search;
    sandbox.location.href = 'https://ideav.ru/ateh/object/1078/' + search;
    const t = Object.create(IntegramTable.prototype);
    t.overriddenUrlParams = new Set();
    return t;
}

// ── 1. getPageUrlParams: `_itc` не пересылается, FR_* продолжают ─────────────
const pageUrl = '?JSON_OBJ&LIMIT=0,21&FR_1081=%25&FR_82374=%25000%25&_itc=' + encodeURIComponent(ITC);
const forwarded = makeTable(pageUrl).getPageUrlParams();
assert(forwarded.get('_itc') === null,
    'getPageUrlParams: `_itc` НЕ попадает в запрос к API (#5089)');
assert(forwarded.get('FR_1081') === '%' && forwarded.get('FR_82374') === '%000%',
    'getPageUrlParams: FR_* из адресной строки по-прежнему пересылаются (#476)');
assert(forwarded.get('JSON_OBJ') === null && forwarded.get('LIMIT') === null,
    'getPageUrlParams: служебные параметры по-прежнему исключены');

// ── 2. appendPageUrlParams: второй путь (параметры уже частично собраны) ─────
const params = new URLSearchParams('JSON_OBJ&FR_1081=%');
makeTable(pageUrl).appendPageUrlParams(params);
assert(!params.toString().includes('_itc'),
    'appendPageUrlParams: `_itc` не дописывается к параметрам запроса (#5089)');

// ── 3. Кнопка «Поделиться ссылкой» (#510) жива ───────────────────────────────
const sharer = makeTable(pageUrl);
sharer.filters = { 1081: { type: '%', value: '' } };
sharer.groupingEnabled = false;
sharer.groupingColumns = [];
sharer.sortColumn = null;
sharer.sortDirection = null;
sharer.columnOrder = ['1078', '1156'];
sharer.visibleColumns = ['1078', '1156'];
const configUrl = sharer.getConfigUrl();
assert(configUrl.includes('_itc='), 'getConfigUrl: ссылка для коллег содержит `_itc` (#510 не сломан)');

// ── 4. Открытие ссылки восстанавливает конфиг (#510) ─────────────────────────
const restorer = makeTable('?JSON_OBJ&_itc=' + encodeURIComponent(ITC));
restorer.filters = {};
restorer.filtersEnabled = false;
restorer.groupingEnabled = false;
restorer.groupingColumns = [];
restorer.sortColumn = null;
restorer.sortDirection = null;
restorer.columnOrder = [];
restorer.visibleColumns = [];
restorer.configFromUrl = false;
IntegramTable.prototype.loadConfigFromUrl.call(restorer);
assert(restorer.filtersEnabled === true && restorer.filters['27162'] && restorer.filters['27162'].type === '%',
    'loadConfigFromUrl: фильтры из `_itc` восстанавливаются');
assert(Array.isArray(restorer.columnOrder) && restorer.columnOrder[0] === '1078',
    'loadConfigFromUrl: порядок колонок из `_itc` восстанавливается');

console.log(`\n${passed}/${total} проверок прошли`);
if (passed !== total) process.exitCode = 1;
