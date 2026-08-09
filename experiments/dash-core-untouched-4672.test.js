// Сторож #4672: дэшборд и «Оптимизация» — ПРИКЛАДНАЯ вещь, ядро (`index.php`) под них
// не правится.
//
// Прикладная задача давит на ядро двумя способами, и оба здесь закрыты:
//   1) новой логикой в `index.php` (разрешение имени фильтра по псевдониму колонки —
//      её завела #4661 и убрала #4672): вместо ядра словарь периодов читается целиком,
//      а диапазон отбирается на клиенте (`dashFilterPeriodDict`);
//   2) бампом `VERSION` ради сброса кэша своих же ассетов: версия ассета живёт
//      посуффиксным счётчиком в шаблоне (`?{_global_.version}.N`), и ядро при правке
//      js/css не трогают (docs/WORKSPACE_DEVELOPMENT_GUIDE.md §2, docs/kb/deploy.md).
//
// Run with: node experiments/dash-core-untouched-4672.test.js

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const core = fs.readFileSync(path.join(root, 'index.php'), 'utf8');
const dash = fs.readFileSync(path.join(root, 'js', 'dash.js'), 'utf8');
const template = fs.readFileSync(path.join(root, 'templates', 'dash.html'), 'utf8');

test('index.php: в ядре нет прикладной логики разрешения псевдонимов', () => {
    assert.doesNotMatch(core, /REQALIASES/,
        'в ядро вернулась карта псевдонимов — прикладная задача снова правит index.php (#4672)');
    // Разрешение по ИМЕНИ ТИПА — штатное поведение ядра, оно остаётся.
    assert.match(core, /array_search\(\$col, \$GLOBALS\["REQNAMES"\]\)/,
        'пропало штатное разрешение имени фильтра по REQNAMES');
});

test('dash.js: словарь периодов читается целиком, без фильтра по псевдониму', () => {
    const dictCall = /object\/[^'"`]*\?[^'"`]*/g;
    const urls = dash.match(dictCall) || [];
    const aliasFiltered = urls.filter(function(u) { return /[FT][RO]?_(С|По)\b/.test(u); });
    assert.deepStrictEqual(aliasFiltered, [],
        'дэшборд снова фильтрует object/ по псевдониму колонки — это и требовало правки ядра');
    assert.match(dash, /function dashFilterPeriodDict\(/,
        'отбор диапазона [С; По] на клиенте пропал — без него словарь снова упрётся в ядро');
});

test('ассеты дэшборда версионируются шаблоном, а не ядровым VERSION', () => {
    ['dash.js', 'dash-optimize.js'].forEach(function(file) {
        const re = new RegExp('src="/js/' + file.replace('.', '\\.') + '\\?\\{_global_\\.version\\}\\.\\d+"');
        assert.match(template, re, file + ' подключён без посуффиксного счётчика — правка уедет в бамп ядра');
    });
});
