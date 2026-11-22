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
    const mapping = { code: 'Код', name: 'Номенклатура', article: 'Артикул', brand: 'Производитель' };
    const upload = plain(api.buildUploadSetting('sku', dataset, mapping, table, 'Лист1'));
    assert.strictEqual(upload.importMap['904'], 2, rel + ': Д4 бренд → поле-ссылка, а не подчинённая таблица');
    assert.strictEqual(upload.importMap['902'], undefined, rel + ': Д4 подчинённая таблица не в раскладке');
    const onlyArr = { id: '900', val: 'SKU', reqs: [{ id: '901', val: 'Наименование' }, { id: '902', val: 'Бренд', arr_id: '7528650' }] };
    assert.throws(() => api.buildUploadSetting('sku', dataset, { code: 'Код', name: 'Номенклатура', brand: 'Производитель' }, onlyArr, 'Лист1'),
        /Бренд/, rel + ': Д4 без загружаемого поля «Бренд» — внятная ошибка');

    // Д3: незамапленные колонки правее последней размеченной не читаются (xlsx.c1), иначе
    // экран загрузки (#3810) раскладывает в них оставшиеся поля таблицы.
    assert.strictEqual(upload.xlsx.c1, 3, rel + ': Д3 чтение колонок ограничено последней размеченной');

    // Д5: наименование — в поле «Наименование», которое читают отчёты токенизации,
    // а не в главное значение записи.
    assert.strictEqual(upload.importMap['901'], 1, rel + ': Д5 наименование → поле «Наименование»');
    // Д6: главное значение — ключ записи («Код» из 1С), артикул — в своё поле.
    const skuMapping = api.suggestMapping(skuHeaders, skuRows);
    assert.strictEqual(skuMapping.code, 'Код', rel + ': колонка «Код» распознана как ключ записи');
    assert.strictEqual(skuMapping.article, 'Артикул');
    const withCode = plain(api.buildUploadSetting('sku', dataset, skuMapping, table, 'Лист1'));
    assert.strictEqual(withCode.importMap['900'], 0, rel + ': Д6 ключ записи — код');
    assert.strictEqual(withCode.importMap['903'], 3, rel + ': артикул — в поле «Артикул»');
    assert.strictEqual(withCode.importMap['901'], 1);
    // RFP: номер строки заявки — ключ записи.
    const rfpHeaders = ['№ п/п', 'Наименование товара', 'Производитель', 'Кол-во', 'Ед.'];
    const rfpRows = [{ '№ п/п': '1', 'Наименование товара': 'Кабель ВВГ 3х2,5', Производитель: 'Кольчугино', 'Кол-во': '100', 'Ед.': 'м' }];
    const rfpMapping = api.suggestMapping(rfpHeaders, rfpRows);
    assert.strictEqual(rfpMapping.code, '№ п/п', rel + ': «№ п/п» — ключ записи RFP');
    assert.strictEqual(rfpMapping.name, 'Наименование товара');
    const rfpTable = { id: '800', val: 'RFP', reqs: [{ id: '801', val: 'Наименование' }, { id: '802', val: 'Бренд', ref_id: '7528650', ref: '7528650' }] };
    const rfpUpload = plain(api.buildUploadSetting('rfp', { headers: rfpHeaders, headerRow: 3 }, rfpMapping, rfpTable, 'Лист1'));
    assert.deepStrictEqual(rfpUpload.importMap, { 800: 0, 801: 1, 802: 2 }, rel + ': RFP — ключ, наименование, бренд');
    // Без ключа записи шаг 2 не пускает дальше: строки с пустым главным значением экран
    // загрузки пропускает (#3389), одинаковые ключи SKU схлопываются (Д6).
    const noKey = { datasets: {}, mappings: { rfp: { name: 'Наименование товара' }, sku: skuMapping } };
    assert.match(api.validateStep(2, noKey), /ключ/i, rel + ': без ключа записи шаг 2 не проходит');
    assert.throws(() => api.buildUploadSetting('rfp', { headers: rfpHeaders }, { name: 'Наименование товара' }, rfpTable, 'Лист1'), /ключ/i);
    const skuData = { headers: skuHeaders, rows: skuRows.concat([{ Код: '', Номенклатура: 'Лампа', Артикул: 'L1' }]) };
    const rfpData = { headers: rfpHeaders, rows: rfpRows };
    assert.strictEqual(api.validateStep(2, { datasets: { rfp: rfpData, sku: { headers: skuHeaders, rows: skuRows } }, mappings: { rfp: rfpMapping, sku: skuMapping } }), '');
    assert.match(api.validateStep(2, { datasets: { rfp: rfpData, sku: skuData }, mappings: { rfp: rfpMapping, sku: skuMapping } }),
        /пуст.*1/i, rel + ': пустой ключ в строке — ошибка с числом строк');
    const dupData = { headers: skuHeaders, rows: skuRows.concat([Object.assign({}, skuRows[0], { Номенклатура: 'Другое' })]) };
    assert.match(api.validateStep(2, { datasets: { rfp: rfpData, sku: dupData }, mappings: { rfp: rfpMapping, sku: skuMapping } }),
        /повтор/i, rel + ': повторы ключа SKU — ошибка');
    // Артикул можно назначить ключом, если колонки кода нет; одна колонка — одна роль.
    const byArticle = { code: 'Артикул', name: 'Номенклатура' };
    assert.strictEqual(plain(api.buildUploadSetting('sku', dataset, byArticle, table, 'Лист1')).importMap['900'], 3);
    assert.match(api.validateStep(2, { datasets: {}, mappings: { rfp: rfpMapping, sku: { code: 'Артикул', article: 'Артикул', name: 'Номенклатура' } } }),
        /одн/i, rel + ': одна колонка на две роли — ошибка');
}

console.log('test-issue-5617-xcom-wizard: ok');
