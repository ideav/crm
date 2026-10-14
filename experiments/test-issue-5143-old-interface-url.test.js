/*
 * Issue #5143: ссылка «Перейти в старый интерфейс» в табличном компоненте
 * должна переносить текущие параметры: F_U (родитель), F_I (точная запись),
 * фильтры колонок FR_/TO_ и сортировку ORDER — всё, что старый интерфейс
 * понимает из URL (index.php: F_U → vals.up, F_I → vals.id, F_/FR_/TO_ →
 * Construct_WHERE, ORDER со знаком минус = по убыванию, одиночный LIMIT =
 * размер страницы).
 *
 * Ссылка строится getOldInterfaceUrl() (js/integram-table/12-table-settings.js)
 * из того же состояния, из которого loadData() строит запрос к API: сериализатор
 * фильтров — тот же applyFilter, сортировка — тот же getOrderParamValue.
 *
 * Тест гоняет метод против хоста с методами, вырезанными из исходников модулей
 * (браузерные файлы не CommonJS — грузятся чтением и eval).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

// --- Вырезаем методы из исходников модулей ----------------------------------

function extractMethod(file, name) {
    const source = fs.readFileSync(
        path.join(__dirname, '..', 'js', 'integram-table', file),
        'utf8'
    );
    // Методы класса в модуле имеют отступ 8 пробелов (IIFE + тело класса).
    const re = new RegExp(`(?:^|\\n)        (async\\s+)?${name}\\s*\\([^)]*\\)\\s*\\{`);
    const match = source.match(re);
    if (!match) {
        throw new Error(`Could not find method ${name} in ${file}`);
    }
    const start = match.index + match[0].length - 1; // позиция открывающей {
    let depth = 0;
    for (let i = start; i < source.length; i++) {
        const ch = source[i];
        if (ch === '{') depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0) return source.slice(match.index + 1, i + 1);
        }
    }
    throw new Error(`Could not find matching closing brace for ${name} in ${file}`);
}

function extractObjectLiteral(file, anchor) {
    const source = fs.readFileSync(
        path.join(__dirname, '..', 'js', 'integram-table', file),
        'utf8'
    );
    const idx = source.indexOf(anchor);
    if (idx === -1) {
        throw new Error(`Could not find ${anchor} in ${file}`);
    }
    const start = source.indexOf('{', idx);
    let depth = 0;
    for (let i = start; i < source.length; i++) {
        const ch = source[i];
        if (ch === '{') depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0) return source.slice(start, i + 1);
        }
    }
    throw new Error(`Could not find matching closing brace for ${anchor} in ${file}`);
}

const methodSources = [
    extractMethod('12-table-settings.js', 'getOldInterfaceUrl'),
    extractMethod('03-filters-core.js', 'applyFilter'),
    extractMethod('03-filters-core.js', 'getColumnFilterTypes'),
    extractMethod('03-filters-core.js', 'isFirstColumn'),
    extractMethod('15-sort.js', 'getOrderParamValue'),
].join('\n');

const filterTypesLiteral = extractObjectLiteral('01-core.js', 'this.filterTypes = {');

function makeHostClass(win) {
    return new Function(`
        const window = ${JSON.stringify(win)};
        const filterTypes = ${filterTypesLiteral};
        class Host {
            constructor(opts) {
                Object.assign(this, opts);
                this.filterTypes = filterTypes;
                // Псевдонимы форматов — как в 01-core.js сразу после литерала.
                this.filterTypes['SHORT'] = this.filterTypes['CHARS'];
                this.filterTypes['MEMO'] = this.filterTypes['CHARS'];
                this.filterTypes['DATETIME'] = this.filterTypes['DATE'];
                this.filterTypes['SIGNED'] = this.filterTypes['NUMBER'];
            }
            ${methodSources}
        }
        return Host;
    `)();
}

const Host = makeHostClass({ db: 'mydb', location: { pathname: '/mydb/table/42' } });

// --- Хелперы -----------------------------------------------------------------

function makeHost(opts) {
    return new Host(Object.assign({
        objectTableId: '42',
        options: {},
        columns: [],
        filters: {},
        settings: {},
        // как в конструкторе класса: состояние сортировки всегда инициализировано
        sortColumn: null,
        sortDirection: null,
    }, opts));
}

function queryParams(url) {
    assert.ok(url.startsWith('/'), `URL должен начинаться с /: ${url}`);
    const qIndex = url.indexOf('?');
    return new URLSearchParams(qIndex === -1 ? '' : url.slice(qIndex + 1));
}

// --- Тесты -------------------------------------------------------------------

// Базовый вид: без состояния — чистый адрес старого интерфейса без «?».
{
    const url = makeHost({}).getOldInterfaceUrl();
    assert.strictEqual(url, '/mydb/object/42');
}

// F_U: родитель > 1 переносится, 1 и 0 — нет (корень/все — состояние по умолчанию).
{
    const url = makeHost({ options: { parentId: '7' } }).getOldInterfaceUrl();
    assert.strictEqual(url, '/mydb/object/42?F_U=7');
}
{
    for (const parentId of ['1', 1, '0', 0]) {
        const params = queryParams(makeHost({ options: { parentId } }).getOldInterfaceUrl());
        assert.strictEqual(params.has('F_U'), false, `F_U не должен переноситься при parentId=${parentId}`);
    }
}

// F_I: точная запись переносится, синтезированный по ней @-фильтр первой
// колонки (issue #861) сериализуется рядом — в старом интерфейсе F_I
// сбрасывается при наличии других условий, @-фильтр условие сохраняет.
{
    const url = makeHost({
        options: { recordId: '123' },
        columns: [{ id: '42', name: 'Имя' }],
        filters: { 42: { type: '=', value: '@123' } },
    }).getOldInterfaceUrl();
    const params = queryParams(url);
    assert.strictEqual(params.get('F_I'), '123');
    assert.strictEqual(params.get('FR_42'), '@123');
}
{
    const params = queryParams(makeHost({ options: { recordId: '123' } }).getOldInterfaceUrl());
    assert.strictEqual(params.get('F_I'), '123');
}

// Фильтры колонок идут тем же сериализатором, что и запрос к API.
{
    const url = makeHost({
        columns: [{ id: '4547', name: 'Название' }],
        filters: { 4547: { type: '~', value: 'abc' } },
    }).getOldInterfaceUrl();
    assert.strictEqual(queryParams(url).get('FR_4547'), '%abc%');
}

// Диапазон «...» — пара FR_/TO_, открытый борт опускается.
{
    const url = makeHost({
        columns: [{ id: '501', format: 'DATE', name: 'Дата' }],
        filters: { 501: { type: '...', value: '10.10.2026,20.10.2026' } },
    }).getOldInterfaceUrl();
    const params = queryParams(url);
    assert.strictEqual(params.get('FR_501'), '10.10.2026');
    assert.strictEqual(params.get('TO_501'), '20.10.2026');
}
{
    const params = queryParams(makeHost({
        columns: [{ id: '501', format: 'NUMBER', name: 'Кол' }],
        filters: { 501: { type: '...', value: ',5' } },
    }).getOldInterfaceUrl());
    assert.strictEqual(params.has('FR_501'), false);
    assert.strictEqual(params.get('TO_501'), '5');
}

// Числовое сравнение «≥» и признак «пустые» («%» без значения).
{
    const url = makeHost({
        columns: [{ id: '501', format: 'NUMBER', name: 'Кол' }],
        filters: { 501: { type: '≥', value: '5' } },
    }).getOldInterfaceUrl();
    assert.strictEqual(queryParams(url).get('FR_501'), '>=5');
}
{
    const url = makeHost({
        columns: [{ id: '4547', name: 'Название' }],
        filters: { 4547: { type: '%', value: '' } },
    }).getOldInterfaceUrl();
    assert.strictEqual(queryParams(url).get('FR_4547'), '%');
}

// Пустое значение фильтра не переносится.
{
    const params = queryParams(makeHost({
        columns: [{ id: '4547', name: 'Название' }],
        filters: { 4547: { type: '~', value: '' } },
    }).getOldInterfaceUrl());
    assert.strictEqual(params.has('FR_4547'), false);
}

// Сортировка: ORDER с минусом = по убыванию; для табличного реквизита — по arr_id.
{
    const url = makeHost({
        columns: [{ id: '501', name: 'Кол' }],
        sortColumn: '501',
        sortDirection: 'desc',
    }).getOldInterfaceUrl();
    assert.strictEqual(queryParams(url).get('ORDER'), '-501');
}
{
    const url = makeHost({
        columns: [{ id: '501', name: 'Кол' }],
        sortColumn: '501',
        sortDirection: 'asc',
    }).getOldInterfaceUrl();
    assert.strictEqual(queryParams(url).get('ORDER'), '501');
}
{
    const url = makeHost({
        columns: [{ id: '900', arr_id: '1081', name: 'Партия' }],
        sortColumn: '900',
        sortDirection: 'desc',
    }).getOldInterfaceUrl();
    assert.strictEqual(queryParams(url).get('ORDER'), '-1081');
}
{
    const params = queryParams(makeHost({ sortColumn: null, sortDirection: null }).getOldInterfaceUrl());
    assert.strictEqual(params.has('ORDER'), false);
}

// Размер страницы — одиночный LIMIT (в старом интерфейсе это размер страницы).
{
    const url = makeHost({ settings: { pageSize: 50 } }).getOldInterfaceUrl();
    assert.strictEqual(queryParams(url).get('LIMIT'), '50');
}
{
    const params = queryParams(makeHost({ settings: null }).getOldInterfaceUrl());
    assert.strictEqual(params.has('LIMIT'), false);
}

// Всё вместе.
{
    const url = makeHost({
        options: { parentId: '7', recordId: '123' },
        columns: [
            { id: '42', name: 'Имя' },
            { id: '4547', name: 'Название' },
        ],
        filters: {
            42: { type: '=', value: '@123' },
            4547: { type: '~', value: 'abc' },
        },
        sortColumn: '4547',
        sortDirection: 'desc',
        settings: { pageSize: 50 },
    }).getOldInterfaceUrl();
    const params = queryParams(url);
    assert.strictEqual(params.get('F_U'), '7');
    assert.strictEqual(params.get('F_I'), '123');
    assert.strictEqual(params.get('FR_42'), '@123');
    assert.strictEqual(params.get('FR_4547'), '%abc%');
    assert.strictEqual(params.get('ORDER'), '-4547');
    assert.strictEqual(params.get('LIMIT'), '50');
}

// Кодировка: кириллица и пробелы в значении фильтра переживают round-trip.
{
    const url = makeHost({
        columns: [{ id: '4547', name: 'Название' }],
        filters: { 4547: { type: '~', value: 'кофе tea' } },
    }).getOldInterfaceUrl();
    assert.strictEqual(queryParams(url).get('FR_4547'), '%кофе tea%');
}

// Имя базы: window.db, при его отсутствии — первый сегмент pathname.
{
    const FallbackHost = makeHostClass({ location: { pathname: '/db2/table/1' } });
    const url = new FallbackHost({ objectTableId: '42', options: {}, columns: [], filters: {}, settings: {} }).getOldInterfaceUrl();
    assert.ok(url.startsWith('/db2/object/42'), `URL должен начинаться с /db2/object/42: ${url}`);
}

// Без известного id таблицы ссылки нет.
{
    assert.strictEqual(makeHost({ objectTableId: null, options: {} }).getOldInterfaceUrl(), null);
}

console.log('test-issue-5143-old-interface-url: all checks passed');
