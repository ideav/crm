/*
 * Issue #5176: дэшборд пишет в «Значение» и в «Настройки» панели не по зашитым id
 * (1010/1039/1042/1104/155556, t1165), а по id, найденным в metadata по именам.
 * Фикстура — схема finmo: val реквизитов с суффиксом «_т», исходное имя в attrs.alias;
 * таблиц «Панель» две — системная панель форм (без «Настроек») и панель дэшборда.
 * Без metadata или при неполной схеме — прежние id исходной базы.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'dash.js'), 'utf8');

function extractFunction(name) {
    const marker = 'function ' + name + '(';
    const start = source.indexOf(marker);
    if (start === -1) throw new Error('Missing function ' + name);
    let depth = 0;
    for (let i = source.indexOf('{', start); i < source.length; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
    }
    throw new Error('Unclosed function ' + name);
}

const alias = a => JSON.stringify({ alias: a });
const FINMO_METADATA = [
    { id: '138', val: 'Панель', reqs: [{ id: '184', val: 'Объект' }, { id: '225', val: 'config' }] },
    { id: '496', val: 'Значение', reqs: [
        { id: '498', val: 'Дата_т', attrs: alias('Дата') },
        { id: '500', val: 'Строка бюджета', ref: '493', attrs: alias('Строка бюджета') },
        { id: '502', val: 'Столбец_т', attrs: alias('Столбец') },
        { id: '506', val: 'Колонка группы', ref: '495', attrs: alias('Колонка группы') },
        { id: '508', val: 'Метка_т', attrs: alias('Метка') }
    ] },
    { id: '537', val: 'Панель', reqs: [
        { id: '538', val: 'Строка', attrs: alias('Строка') },
        { id: '547', val: 'Настройки_т', attrs: alias('Настройки') }
    ] }
];

const sandbox = { DASH_VALUE_LABEL_FIELD_ID: '155556', dashMetadata: null, result: {} };
vm.createContext(sandbox);
vm.runInContext(['dashSchemaDef', 'dashMetadataList', 'dashReqAlias', 'dashFindReqByName', 'dashSchema',
    'dashCellItemRef', 'dashCellRgHead', 'dashValueSearchUrl'].map(extractFunction).join('\n'), sandbox);

const schema = key => JSON.parse(JSON.stringify(vm.runInContext(`dashSchema(${JSON.stringify(key)})`, sandbox)));

// 1. Без metadata — схема исходной базы.
assert.deepStrictEqual(schema('value'), { id: '1010', fields: { date: '1039', item: '1042', group: '1104', label: '155556' } });
assert.deepStrictEqual(schema('panel'), { id: '', fields: { settings: '1165' } });

// 2. Схема finmo — по alias, «Панель» дэшборда, а не панель форм.
sandbox.dashMetadata = FINMO_METADATA;
assert.deepStrictEqual(schema('value'), { id: '496', fields: { date: '498', item: '500', group: '506', label: '508' } });
assert.deepStrictEqual(schema('panel'), { id: '537', fields: { settings: '547' } });

// 3. Без attrs.alias — по val (исходная база, metadata без alias).
sandbox.dashMetadata = [{ id: '1010', val: 'Значение', reqs: [
    { id: '1039', val: 'Дата' }, { id: '1042', val: 'Строка бюджета' },
    { id: '1104', val: 'Колонка группы' }, { id: '155556', val: 'Метка' }] }];
assert.deepStrictEqual(schema('value'), { id: '1010', fields: { date: '1039', item: '1042', group: '1104', label: '155556' } });

// 4. Неполная схема — не смешивать id: целиком запасные.
sandbox.dashMetadata = [{ id: '777', val: 'Значение', reqs: [{ id: '778', val: 'Дата' }] }];
assert.strictEqual(schema('value').id, '1010');

// 5. URL поиска значения в finmo — только id finmo.
sandbox.dashMetadata = FINMO_METADATA;
const td = {
    dataset: { valueItemId: '', dashLabel: 'Интеграм' },
    getAttribute: n => (n === 'range' ? '20260101-20261231' : null),
    closest: () => ({ getAttribute: () => 'Лицензии', querySelector: () => null, cells: [] })
};
sandbox.dashCellDateFr = () => '20260101';
sandbox.dashCellDateTo = () => '20261231';
sandbox.dashCellItemRef = () => 'Лицензии';
sandbox.dashCellRgHead = () => 'Факт';
const url = vm.runInContext('dashValueSearchUrl', sandbox)(td);
assert.strictEqual(url, 'object/496?JSON_OBJ&FR_498=20260101&TO_498=20261231&FR_500=' + encodeURIComponent('Лицензии')
    + '&F_506=' + encodeURIComponent('Факт') + '&F_508=%');

console.log('OK: схема дэшборда разрешается по именам —', url);
