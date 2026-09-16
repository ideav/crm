// Tests for ideav/crm#4956 — «Сопоставление каталогов» раздаётся шаблоном базы `cm`,
// а не установщиком в чужую базу.
//
// Шаблон базы в Интеграме — это ТАБЛИЦА MySQL, из которой `newDb()` (index.php) клонирует
// новую базу, плюс два каталога файлов, которые она же копирует рядом:
//     CREATE TABLE $z LIKE $template;  INSERT INTO $z SELECT * FROM $template;
//     cp -r templates/custom/$template templates/custom/$z
//     cp -r download/$template         download/$z
// Отсюда три условия, без любого из которых партнёр получает НЕ ту базу, которую выбрал,
// и узнаёт об этом уже на пустых экранах:
//
//   1. имя шаблона из выпадающего списка ЛК проходит проверку `TEMPLATES` (index.php:806).
//      Не прошло — ядро молча подставляет "ru", и вместо сопоставления каталогов
//      разворачивается обычная русская база;
//   2. каталоги `templates/custom/cm` и `download/cm` существуют на сервере, то есть
//      публикуются `update.conf` из СВОИХ каталогов шаблона `templates/cm` и `download/cm`.
//      Нет источника — `cp -r` копировать нечего, рабочие места открываются без JS и CSS
//      (ровно дефект #4949 п.4);
//   3. рабочие места адресуют свои ассеты через `{_global_.z}` и каждый такой ассет лежит в
//      каталогах шаблона. Зашитое имя базы или файл из чужого каталога не переживают
//      клонирование: база клиента запросила бы файл, которого у неё нет.
//
// Шаблон и проект конкретного клиента (`xcom`) — разные комплекты файлов: шаблон развивается
// дальше, клиентский проект зафиксирован. Поэтому проверяется не только цель публикации, но и
// источник: правило, ведущее в `templates/custom/cm` из чужого каталога, ронять этот тест.
//
// Run with: node experiments/xcom-4956-cm-template.test.js

var fs = require('fs');
var path = require('path');

var root = path.join(__dirname, '..');
var passed = 0, total = 0;

function assert(cond, name) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    total++;
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; } else {
        console.log('  expected:', JSON.stringify(expected));
        console.log('  actual:  ', JSON.stringify(actual));
        process.exitCode = 1;
    }
}
function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

// --- модель ядра -----------------------------------------------------------------------

// Список разрешённых шаблонов ядра: include/connection.php, значение по умолчанию для
// переменной окружения INTEGRAM_TEMPLATES.
function allowedTemplates() {
    var m = read('include/connection.php')
        .match(/define\("TEMPLATES",\s*integram_env\(\s*'INTEGRAM_TEMPLATES'\s*,\s*'([^']*)'\s*\)\)/);
    return m ? m[1] : '';
}

// index.php:806 — если имени нет в списке, ядро подставляет "ru" вместо выбранного шаблона.
function resolveTemplate(chosen, templates) {
    var name = String(chosen).toLowerCase();
    return templates.indexOf(':' + name + ':') !== -1 ? name : 'ru';
}

// Значения <option> выпадающего списка шаблонов. Закомментированные варианты не
// предлагаются пользователю, поэтому комментарии вырезаются до разбора.
function templateOptions(rel, selectId) {
    var html = read(rel).replace(/<!--[\s\S]*?-->/g, '');
    var select = html.match(new RegExp('<select[^>]*id="' + selectId + '"[^>]*>([\\s\\S]*?)<\\/select>'));
    if (!select) return null;
    var values = [], option, re = /<option([^>]*)>/g;
    while ((option = re.exec(select[1])) !== null) {
        var value = option[1].match(/value="([^"]*)"/);
        if (value) values.push(value[1]);
    }
    return values;
}

// Пары «источник : цель» из update.conf, которым файлы уезжают на боевой сервер.
function publishedTargets() {
    return read('update.conf').split(/\r?\n/).reduce(function (acc, line) {
        var text = line.replace(/^\s+|\s+$/g, '');
        if (!text || text.charAt(0) === '#') return acc;
        var parts = text.split(/\s*:\s(?=\/)/);       // двоеточие перед абсолютным путём цели
        if (parts.length === 2) acc.push({ source: parts[0].replace(/\s+$/, ''), target: parts[1] });
        return acc;
    }, []);
}
// Правила, раскладывающие файлы в каталог `dir` боевого сервера, с их источниками в репозитории.
function sourcesPublishedInto(dir) {
    return publishedTargets().filter(function (rule) {
        return rule.target.replace(/\/+$/, '').slice(-dir.length - 1) === '/' + dir;
    }).map(function (rule) { return rule.source.replace(/\/\*$/, ''); });
}

// --- 1. Шаблон «Сопоставление» доходит до ядра ------------------------------------------

var templates = allowedTemplates();
assert(templates.length > 0, 'include/connection.php: список TEMPLATES читается');

var cabinets = [
    { rel: 'templates/my/main.html', select: 'new-db-template' },
    { rel: 'templates/my/info.html', select: 'template' }
];

cabinets.forEach(function (cabinet) {
    var offered = templateOptions(cabinet.rel, cabinet.select);
    assert(offered !== null && offered.length > 0, cabinet.rel + ': список шаблонов найден');
    if (!offered) return;

    // Выбор, который ядро подменяет на "ru" — хуже ошибки: пользователь получает базу
    // другого шаблона и считает, что выбор сработал.
    offered.forEach(function (value) {
        assertEqual(resolveTemplate(value, templates), value.toLowerCase(),
            cabinet.rel + ': выбор «' + value + '» разворачивает именно этот шаблон');
    });

    assert(offered.map(function (v) { return v.toLowerCase(); }).indexOf('cm') !== -1,
        cabinet.rel + ': шаблон сопоставления каталогов предлагается в ЛК');
});

// --- 2. Файлы шаблона есть на сервере и берутся из каталогов шаблона ----------------------

[
    { dir: 'templates/custom/cm', from: 'templates/cm',    what: 'рабочие места' },
    { dir: 'download/cm/js',      from: 'download/cm/js',  what: 'JS' },
    { dir: 'download/cm/css',     from: 'download/cm/css', what: 'CSS' }
].forEach(function (rule) {
    assertEqual(sourcesPublishedInto(rule.dir), [rule.from],
        'update.conf: ' + rule.what + ' шаблона едут в ' + rule.dir + ' из ' + rule.from);
});

// --- 3. Ассеты рабочих мест переживают клонирование --------------------------------------

var workspaces = fs.readdirSync(path.join(root, 'templates/cm'))
    .filter(function (name) { return /\.html$/.test(name); });
assert(workspaces.length > 0, 'templates/cm: рабочие места шаблона на месте');

workspaces.forEach(function (name) {
    // Подстановка ядра: {_global_.z} → имя базы, в которую развёрнут шаблон.
    var rendered = read('templates/cm/' + name).replace(/\{_global_\.z\}/g, 'clientdb');
    var foreign = [], missing = [], link, re = /(?:src|href)="([^"]*)"/g;
    while ((link = re.exec(rendered)) !== null) {
        var own = link[1].match(/^\/download\/([^/]+)\/((?:css|js)\/[^?"]+)/);
        if (!own) continue;
        if (own[1] !== 'clientdb') { foreign.push(link[1]); continue; }
        // Файл окажется в базе клиента, только если он есть в каталогах шаблона: `cp -r`
        // копирует download/cm, а не тот каталог, откуда файл взят исторически.
        if (!fs.existsSync(path.join(root, 'download/cm', own[2]))) missing.push(own[2]);
    }
    assertEqual(foreign, [], 'templates/cm/' + name + ': ассеты берутся из своей базы');
    assertEqual(missing, [], 'templates/cm/' + name + ': ассеты лежат в download/cm');
});

console.log('\n' + passed + '/' + total + ' проверок пройдено');
