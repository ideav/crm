/*
 * Regression test for issue #3003.
 *
 * Atex workplace templates must not hardcode table object ids or the `atex`
 * database name. Workplaces resolve object ids from /metadata by table
 * names, while scripts use window.db (or the template data-db fallback).
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');
const templatesDir = path.join(root, 'templates', 'atex');
const scriptsDir = path.join(root, 'download', 'atex', 'js');
const metadata = JSON.parse(fs.readFileSync(path.join(root, 'docs', 'atex_metadata.json'), 'utf8'));

const requiredTables = [
    'Вид сырья',
    'Слиттер',
    'Втулкорез',
    'Клиент',
    'Тип резки',
    'Полоса',
    'Партия сырья',
    'Заказ',
    'Позиция заказа',
    'Обеспечение',
    'Производственная резка',
    'Расход сырья',
    'Задание на втулки',
    'Партия ГП',
    'Событие смены',
    'Пользователь'
];

const metadataNames = new Set(metadata.map(function(item) { return item.val; }));
requiredTables.forEach(function(name) {
    assert(metadataNames.has(name), 'metadata contains table "' + name + '"');
});

function listFiles(dir, suffix) {
    return fs.readdirSync(dir)
        .filter(function(file) { return file.endsWith(suffix); })
        .map(function(file) { return path.join(dir, file); })
        .sort();
}

listFiles(templatesDir, '.html').forEach(function(file) {
    const rel = path.relative(root, file);
    const source = fs.readFileSync(file, 'utf8');

    assert(!/data-[a-z-]*table="\d+"/.test(source), rel + ' does not hardcode table ids in data-* attributes');
    assert(!/data-db="atex"/i.test(source), rel + ' does not hardcode the atex database');
    assert(!/\/download\/atex\//i.test(source), rel + ' uses /download/{_global_.z}/ for workspace assets');

    if (rel !== path.join('templates', 'atex', 'main.html')) {
        assert(source.includes('data-db="{_global_.z}"'), rel + ' passes the current database to the script');
    }
});

listFiles(scriptsDir, '.js').forEach(function(file) {
    const rel = path.relative(root, file);
    const source = fs.readFileSync(file, 'utf8');

    assert(!/DEFAULT_[A-Z_]*_TABLE\s*=\s*['"]\d+['"]/.test(source), rel + ' does not hardcode table id defaults');
    assert(!/location\.pathname\.split\('\/'\)/.test(source), rel + ' does not derive the database from the URL path');
});

console.log('issue-3003 atex workplace references: ok');
