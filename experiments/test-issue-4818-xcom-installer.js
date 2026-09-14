const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');
const readJson = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const manifest = readJson('templates/xcom/manifest.json');
const metadata = readJson('docs/xcom_metadata.json');
const reports = readJson('docs/xcom_reports.json');
const installer = fs.readFileSync(path.join(root, 'docs/create_xcom_matching.ps1'), 'utf8');

assert.strictEqual(manifest.slug, 'xcom-matching');
assert.strictEqual(manifest.schema_version, 1);
assert.deepStrictEqual(manifest.workspaces, ['wizard', 'matching', 'mass_match', 'settings', 'export']);
assert.deepStrictEqual(manifest.reports, ['mass_match', 'Сопоставление', 'matching_export']);
assert.deepStrictEqual(manifest.roles.map(role => role.name), ['Партнёр', 'Оператор каталогов']);
manifest.assets.forEach(asset => assert(fs.existsSync(path.join(root, asset)), `manifest asset exists: ${asset}`));

const tables = new Map(metadata.map(table => [table.val, table]));
['SKU', 'RFP', 'Токен', 'Настройка сопоставления', 'Решение по паре', 'Журнал развёртывания', 'Профиль загрузки']
    .forEach(name => assert(tables.has(name), `schema contains ${name}`));
// Стороны связываются общим справочником токенов через МНОЖЕСТВЕННУЮ ссылку —
// так устроен рабочий кейс; таблиц-связок нет, и отчёт обходится без FROM.
['SKU', 'RFP'].forEach(name => {
    const link = tables.get(name).reqs.find(req => req.val === 'Токен');
    assert(link && link.ref === tables.get('Токен').id, `${name} ссылается на справочник токенов`);
    assert(JSON.parse(link.attrs || '{}').multi === true, `ссылка ${name}.Токен множественная`);
});
['Наш артикул', 'Кандидаты', 'Точность подбора', 'ИИ-вердикт']
    .forEach(name => assert(tables.get('RFP').reqs.some(req => req.val === name), `RFP contains ${name}`));
['RFP ID', 'SKU ID', 'Решение', 'Дата', 'Кто', 'Источник']
    .forEach(name => assert(tables.get('Решение по паре').reqs.some(req => req.val === name), `decision log contains ${name}`));

const reportMap = new Map(reports.map(report => [report.name, report]));
assert(reportMap.has('mass_match'));
assert(reportMap.has('Сопоставление'));
assert(reportMap.has('matching_export'));
assert(!reportMap.get('mass_match').joins, 'подбор идёт по общему справочнику токенов, а не через FROM-связки');
['Вес', 'ТММ'].forEach(name => assert(
    reportMap.get('mass_match').columns.some(column => column.name === name && column.computed === true),
    `mass report считает ${name} вычисляемой колонкой — её читают рабочие места`));
assert(reportMap.get('Сопоставление').inherits === 'mass_match', 'manual report reuses mass report definition');
assert(reportMap.get('matching_export').columns.some(column => column.name === 'Наш артикул'));

['DryRun', 'SkipSchema', 'SkipAssets', 'Ensure-XcomRole', 'Ensure-XcomMenu', 'Ensure-XcomReport', 'Resolve-XcomFunctionId', '_ref_reqs/104', 'create_xcom_matching_log.txt']
    .forEach(marker => assert(installer.includes(marker), `installer contains ${marker}`));
assert(/\[string\]\$Token,/.test(installer), 'installer accepts the token as an external parameter');
assert(!/(?:Bearer|sk-)[A-Za-z0-9_-]{16,}/.test(installer), 'installer does not contain a credential');
assert(!installer.includes('создана без агрегата'), 'installer never silently omits a requested aggregate');
assert(/Ensure-XcomRecord[\s\S]*\[switch\]\$UpdateExisting/.test(installer), 'seed helper preserves an existing partner config by default');
assert(installer.includes('+ @("269")'), 'roles receive the system upload-settings object used by the wizard');

console.log('OK: test-issue-4818-xcom-installer');
