// issue #5617: дефекты мастера шаблона cm, найденные самопрогоном пилота #4823.
// Обе копии мастера (download/cm — шаблон из ЛК, download/xcom — рабочая база) обязаны вести себя одинаково.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const plain = value => JSON.parse(JSON.stringify(value));

function load(rel) {
    const source = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
    const sandbox = {
        window: {},
        document: { readyState: 'loading', addEventListener() {}, getElementById() { return null; } },
        console, module: { exports: {} }, setInterval() {}, clearInterval() {}
    };
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox, { filename: rel });
    return sandbox.window.XcomWizardWorkspace;
}

for (const rel of ['download/cm/js/xcom-wizard.js', 'download/xcom/js/xcom-wizard.js']) {
    const api = load(rel);

    // Д2: «Номенклатура» — заголовок наименования в выгрузках 1С.
    const skuHeaders = ['Код', 'Номенклатура', 'Производитель', 'Артикул', 'Ед. изм.', 'Цена'];
    const skuRows = [
        { Код: '00-001', Номенклатура: 'Кабель ВВГнг-LS 3х2,5 ГОСТ', Производитель: 'Кольчугино', Артикул: 'VVG325', 'Ед. изм.': 'м', Цена: '95' },
        { Код: '00-002', Номенклатура: 'Автоматический выключатель 1P 16А C', Производитель: 'IEK', Артикул: 'MVA20-1-016-C', 'Ед. изм.': 'шт', Цена: '210' }
    ];
    assert.strictEqual(api.suggestMapping(skuHeaders, skuRows).name, 'Номенклатура', rel + ': Д2 «Номенклатура» → наименование');

    // Д1: шапка-заголовок над таблицей не принимается за строку заголовка.
    const matrix = [
        ['Заявка на поставку электротехники № 17 от 20.11.2026', '', '', '', ''],
        ['', '', '', '', ''],
        ['№ п/п', 'Наименование товара', 'Производитель', 'Кол-во', 'Ед.'],
        ['1', 'Кабель ВВГ 3х2,5', 'Кольчугино', '100', 'м'],
        ['2', 'Авт. выкл. 1п 16А', 'IEK', '10', 'шт']
    ];
    const auto = api.matrixToDataset(matrix);
    assert.strictEqual(auto.headerRow, 3, rel + ': Д1 заголовок найден в строке 3');
    assert.deepStrictEqual(plain(auto.headers), ['№ п/п', 'Наименование товара', 'Производитель', 'Кол-во', 'Ед.']);
    assert.strictEqual(auto.totalRows, 2);
    // Строку заголовка можно задать вручную (номер строки листа, с единицы).
    const manual = api.matrixToDataset(matrix, 1);
    assert.strictEqual(manual.headerRow, 1, rel + ': Д1 ручной выбор строки заголовка');
    assert.strictEqual(manual.headers[0], 'Заявка на поставку электротехники № 17 от 20.11.2026');
    // Узкая таблица в одну колонку по-прежнему берёт первую непустую строку.
    assert.strictEqual(api.matrixToDataset([['', ''], ['Наименование', ''], ['Лампа', '']]).headerRow, 2);

    // Д4: роль «Бренд» не маппится на подчинённую таблицу (arr_id) — её не загрузить колонкой.
    const table = {
        id: '900', val: 'SKU',
        reqs: [
            { id: '901', val: 'Наименование', type: '3' },
            { id: '902', val: 'Бренд', arr_id: '7528650' },
            { id: '903', val: 'Артикул', type: '3' },
            { id: '904', val: 'Бренд', type: '3', ref_id: '7528650' }
        ]
    };
    const dataset = { headers: skuHeaders, headerRow: 1 };
    const mapping = { name: 'Номенклатура', article: 'Артикул', brand: 'Производитель' };
    const upload = plain(api.buildUploadSetting('sku', dataset, mapping, table, 'Лист1'));
    assert.strictEqual(upload.importMap['904'], 2, rel + ': Д4 бренд → поле-ссылка, а не подчинённая таблица');
    assert.strictEqual(upload.importMap['902'], undefined, rel + ': Д4 подчинённая таблица не в раскладке');
    const onlyArr = { id: '900', val: 'SKU', reqs: [{ id: '901', val: 'Наименование' }, { id: '902', val: 'Бренд', arr_id: '7528650' }] };
    assert.throws(() => api.buildUploadSetting('sku', dataset, { name: 'Номенклатура', brand: 'Производитель' }, onlyArr, 'Лист1'),
        /Бренд/, rel + ': Д4 без загружаемого поля «Бренд» — внятная ошибка');

    // Д3: незамапленные колонки правее последней размеченной не читаются (xlsx.c1), иначе
    // экран загрузки (#3810) раскладывает в них оставшиеся поля таблицы.
    assert.strictEqual(upload.xlsx.c1, 3, rel + ': Д3 чтение колонок ограничено последней размеченной');
}

console.log('test-issue-5617-xcom-wizard: ok');
