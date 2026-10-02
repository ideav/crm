// Коннектор b24ig обязан раскладываться через update.conf (ideav/crm#5061).
//
// update.php копирует только то, что перечислено в update.conf, а `dir/*` берёт
// лишь прямых детей каталога. Правило, которое держит тест: всё, что b24ig.php
// подключает на сервере (include/b24ig/<Файл>.php), и эталон конфига проекта
// (templates/<проект>/connector/<имя>.default.json) доезжают до своих мест.
// Рабочий <имя>.json в репозиторий не кладётся: его правят из «Коннектора»,
// и деплой не должен его перезаписывать.
//
// Run with: node experiments/b24ig-deploy-5061.test.js

var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var SITE = '/var/www/www-root/data/www/ideav.ru/';
var passed = 0;
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) {
        passed++;
    } else {
        console.log('  expected:', JSON.stringify(expected));
        console.log('  actual:  ', JSON.stringify(actual));
        process.exitCode = 1;
    }
}

// Маппинги update.conf → куда попадёт каждый файл репозитория (как update.php: `dir/*` — только прямые дети).
function deployed(text) {
    var out = {};
    text.split(/\r?\n/).forEach(function(line) {
        var raw = line.trim();
        if (!raw || raw.charAt(0) === '#' || raw.charAt(0) === '[') return;
        var colon = raw.indexOf(' : ');
        if (colon === -1) return;
        var src = raw.slice(0, colon).trim(), dst = raw.slice(colon + 3).trim().replace(/\/?$/, '/');
        var files;
        if (/\/\*$/.test(src)) {
            var dir = src.slice(0, -2);
            var abs = path.join(ROOT, dir);
            files = fs.existsSync(abs) ? fs.readdirSync(abs).filter(function(n) {
                return fs.statSync(path.join(abs, n)).isFile();
            }).map(function(n) { return dir + '/' + n; }) : [];
        } else {
            files = fs.existsSync(path.join(ROOT, src)) ? [src] : [];
        }
        files.forEach(function(f) {
            (out[f] = out[f] || []).push(dst + path.posix.basename(f));
        });
    });
    return out;
}
var MAP = deployed(fs.readFileSync(path.join(ROOT, 'update.conf'), 'utf8'));
function targetsOf(f) { return MAP[f] || []; }

assertEqual(targetsOf('b24ig/b24ig.php'), [SITE + 'b24ig.php'], 'b24ig.php — в корень сайта');

// Список подключаемых модулей — из самого b24ig.php: на сервере код ищется в include/b24ig.
var entry = fs.readFileSync(path.join(ROOT, 'b24ig/b24ig.php'), 'utf8');
var list = /foreach \(array\(([^)]*)\) as \$b24igFile\)/.exec(entry);
var modules = list ? list[1].match(/'([A-Za-z0-9]+)'/g).map(function(s) { return s.slice(1, -1); }) : [];
assertEqual(modules.length > 5, true, 'список модулей b24ig.php найден: ' + modules.join(','));
var missing = modules.filter(function(m) {
    return targetsOf('b24ig/src/' + m + '.php').indexOf(SITE + 'include/b24ig/' + m + '.php') < 0;
});
assertEqual(missing, [], 'каждый модуль доезжает в include/b24ig/');

// Проекты с коннектором: templates/<проект>/connector/
var tplRoot = path.join(ROOT, 'templates');
fs.readdirSync(tplRoot).forEach(function(proj) {
    var cdir = path.join(tplRoot, proj, 'connector');
    if (!fs.existsSync(cdir) || !fs.statSync(cdir).isDirectory()) return;
    fs.readdirSync(cdir).forEach(function(name) {
        var rel = 'templates/' + proj + '/connector/' + name;
        if (/\.json$/.test(name)) {
            assertEqual(/\.default\.json$/.test(name), true,
                rel + ': в репозитории только эталон <имя>.default.json (рабочий конфиг живёт на сервере)');
        }
        var t = targetsOf(rel);
        assertEqual(t.length === 1 && /\/templates\/custom\/[^/]+\/connector\/[^/]+$/.test(t[0]), true,
            rel + ' → templates/custom/<база>/connector/ (' + t.join(', ') + ')');
    });
});

assertEqual(targetsOf('templates/sportzania/connector/sportzania.default.json'),
    [SITE + 'templates/custom/sportzania/connector/sportzania.default.json'],
    'эталон sportzania — в папку боевой базы sportzania');
var spz = JSON.parse(fs.readFileSync(path.join(ROOT, 'templates/sportzania/connector/sportzania.default.json'), 'utf8'));
assertEqual(spz.target.db, undefined, 'в эталоне нет target.db — база берётся из --db/?db=');

console.log('\n' + passed + ' passed' + (process.exitCode ? ', есть FAIL' : ''));
