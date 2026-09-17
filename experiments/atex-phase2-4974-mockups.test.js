// Макеты рабочих мест Фазы 2 (этикетка/высечка) — ideav/crm#4974.
//
// ЧТО ДЕРЖИТ ТЕСТ. Макеты показывают заказчику состав решения, и ломаются они ровно двумя
// способами: страница есть, но в навигацию не попала (её никто не откроет), либо страница в
// навигацию попала, но на диске/на сервере её нет (404 у заказчика). Оба случая проверяются
// поведением: список PHASE2_PAGES берётся из самого файла каркаса, шапка рисуется в игрушечный
// DOM, ссылки со страниц разрешаются в файлы, карта деплоя update.conf разбирается в пары
// «источник → приёмник».
//
// ПОЧЕМУ МАКЕТЫ ЛЕЖАТ В js/ И css/. Маппинги деплоя читаются из конфига НА СЕРВЕРЕ рядом с
// update.php; репозиторный update.conf — образец и на бой не копируется. Свой каталог макетов
// потребовал бы ручной правки боевого конфига и до неё отдавал бы 302 вместо страницы
// (docs/kb/deploy.md), а download/atex/js и download/atex/css выкладываются давно.
//
// Run with: node experiments/atex-phase2-4974-mockups.test.js

var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var DIR = path.join(ROOT, 'download', 'atex', 'js');
var CSS_DIR = path.join(ROOT, 'download', 'atex', 'css');

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

// ── Загрузка каркаса ────────────────────────────────────────────────────────────────────────
// Браузерный файл, не CommonJS: грузим чтением и eval. Обращений к DOM на верхнем уровне нет
// (там страж `typeof document !== 'undefined'`), поэтому вне браузера он просто объявляет функции.
eval(fs.readFileSync(path.join(DIR, 'phase2-mockup.js'), 'utf8'));

// ── Игрушечный DOM ──────────────────────────────────────────────────────────────────────────
// Ровно та часть, которой пользуется каркас: создание узла, перенос детей, класс, текст.
function Node(tag) {
    this.tag = tag;
    this.childNodes = [];
    this.className = '';
    this.parentNode = null;
    this._html = '';
    this._text = '';
}
Object.defineProperty(Node.prototype, 'firstChild', {
    get: function () { return this.childNodes.length ? this.childNodes[0] : null; }
});
Object.defineProperty(Node.prototype, 'innerHTML', {
    get: function () { return this._html; },
    set: function (v) { this._html = String(v); }
});
Object.defineProperty(Node.prototype, 'textContent', {
    get: function () { return this._text; },
    set: function (v) { this._text = String(v); }
});
Node.prototype.appendChild = function (node) {
    if (node.parentNode) {
        var i = node.parentNode.childNodes.indexOf(node);
        if (i >= 0) { node.parentNode.childNodes.splice(i, 1); }
    }
    node.parentNode = this;
    this.childNodes.push(node);
    return node;
};
Node.prototype.find = function (pred, acc) {
    acc = acc || [];
    this.childNodes.forEach(function (ch) {
        if (pred(ch)) { acc.push(ch); }
        ch.find(pred, acc);
    });
    return acc;
};

function makeDoc(bodyKids) {
    var doc = { body: new Node('body') };
    doc.createElement = function (tag) { return new Node(tag); };
    (bodyKids || []).forEach(function (k) { doc.body.appendChild(k); });
    return doc;
}

// ── 1. Список макетов и файлы на диске ──────────────────────────────────────────────────────
// Макеты делят каталог с боевыми ассетами, поэтому их отличает префикс имени: страница макета —
// это phase2-*.html, и чужих .html в каталоге быть не должно.
var onDisk = fs.readdirSync(DIR).filter(function (n) { return /\.html$/.test(n); }).sort();
var listed = PHASE2_PAGES.map(function (p) { return p.file; });

var stray = onDisk.filter(function (name) { return name.indexOf('phase2-') !== 0; });
assert(stray.length === 0,
    'в каталоге нет посторонних html рядом с макетами',
    stray.length ? '(' + stray.join(', ') + ')' : '(' + onDisk.length + ' страниц)');

var mockupFiles = listed.concat(['phase2-mockup.js']);
var collisions = mockupFiles.filter(function (name) { return name.indexOf('phase2-') !== 0; });
assert(collisions.length === 0,
    'имена файлов макетов начинаются с phase2- и не перебивают боевые ассеты',
    collisions.length ? '(' + collisions.join(', ') + ')' : '');

assert(listed.length === PHASE2_PAGES.length && new Set(listed).size === listed.length,
    'в PHASE2_PAGES нет повторов файлов', '(' + listed.length + ')');

listed.forEach(function (file) {
    assert(fs.existsSync(path.join(DIR, file)),
        'страница из навигации есть на диске: ' + file);
});

onDisk.forEach(function (file) {
    assert(listed.indexOf(file) >= 0,
        'страница на диске попала в навигацию: ' + file);
});

assert(listed.indexOf('phase2-mockups.html') === 0,
    'навигатор phase2-mockups.html — первый пункт и вход в комплект');

PHASE2_PAGES.forEach(function (page) {
    assert(!!page.group && !!page.title && !!page.role,
        'у пункта заполнены группа, заголовок и роль: ' + page.file,
        '(' + page.group + ' / ' + page.title + ' / ' + page.role + ')');
});

// Группы идут подряд: разорванная группа дала бы в навигации два одинаковых заголовка.
var seenGroups = [];
var prevGroup = null;
PHASE2_PAGES.forEach(function (page) {
    if (page.group !== prevGroup) { seenGroups.push(page.group); prevGroup = page.group; }
});
assert(new Set(seenGroups).size === seenGroups.length,
    'группы в списке не разорваны', '(' + seenGroups.join(', ') + ')');

// ── 2. Шапка рисуется из списка ─────────────────────────────────────────────────────────────
var kept = new Node('h1');
var doc = makeDoc([kept]);
phase2RenderChrome(doc, 'phase2-dies.html');

var links = doc.body.find(function (n) { return n.tag === 'a'; });
assert(links.length === PHASE2_PAGES.length,
    'в навигации по ссылке на каждый макет', '(' + links.length + ' из ' + PHASE2_PAGES.length + ')');
assert(links.map(function (a) { return a.href; }).join('|') === listed.join('|'),
    'ссылки ведут на файлы списка и в том же порядке');

var current = links.filter(function (a) { return a.className === 'is-current'; });
assert(current.length === 1 && current[0].href === 'phase2-dies.html',
    'текущая страница отмечена ровно одна', '(' + current.length + ')');

var caps = doc.body.find(function (n) { return n.className === 'mk-nav-group'; });
assert(caps.map(function (c) { return c.textContent; }).join('|') === seenGroups.join('|'),
    'заголовки групп нарисованы по одному на группу', '(' + caps.length + ')');

var mains = doc.body.find(function (n) { return n.tag === 'main'; });
assert(mains.length === 1 && mains[0].childNodes.indexOf(kept) === 0,
    'содержимое страницы переехало внутрь mk-main, а не потерялось');

var tops = doc.body.find(function (n) { return n.className === 'mk-top'; });
assert(tops.length === 1, 'шапка добавлена один раз');

// Повторный вызов на том же документе не должен задваивать шапку — так каркас ведёт себя,
// если страница перерисовывается.
phase2RenderChrome(doc, 'phase2-dies.html');
assert(doc.body.find(function (n) { return n.tag === 'main'; }).length === 2
    && doc.body.find(function (n) { return n.tag === 'a'; }).length === PHASE2_PAGES.length * 2,
    'перерисовка складывает каркас предсказуемо, без потери содержимого');

// ── 3. Ссылки со страниц разрешаются в файлы ────────────────────────────────────────────────
// Собираем href/src каждой страницы и проверяем, что локальный адрес указывает на
// существующий файл: битая ссылка на соседний макет или на общий css — это 404 у заказчика.
function localRefs(file) {
    var page = fs.readFileSync(path.join(DIR, file), 'utf8');
    var out = [];
    var re = /(?:href|src)\s*=\s*"([^"]+)"/g;
    var m;
    while ((m = re.exec(page)) !== null) {
        var ref = m[1].split('#')[0].split('?')[0];
        if (!ref || /^(https?:|mailto:|data:|\/\/)/.test(ref)) { continue; }
        out.push(ref);
    }
    return out;
}

// Общий каркас: без этих двух файлов страница открывается без шапки и навигации, то есть
// из неё нельзя попасть в остальные макеты. Стиль лежит в соседнем каталоге css, и путь
// `../css/…` должен разрешаться ровно так же, как он разрешится на сервере: страницы едут в
// download/ateh/js, стиль — в download/ateh/css. Утверждаем о РАЗОБРАННОМ списке адресов
// страницы, а не о её тексте.
var CHROME = ['../css/phase2-mockup.css', 'phase2-mockup.js'];

onDisk.forEach(function (name) {
    var refs = localRefs(name);
    var broken = refs.filter(function (ref) { return !fs.existsSync(path.join(DIR, ref)); });
    assert(broken.length === 0,
        'все локальные ссылки страницы разрешаются: ' + name,
        '(' + refs.length + ' ссылок' + (broken.length ? ', битые: ' + broken.join(', ') : '') + ')');

    var missing = CHROME.filter(function (asset) { return refs.indexOf(asset) < 0; });
    assert(missing.length === 0,
        'страница подключает общий каркас: ' + name,
        missing.length ? '(нет: ' + missing.join(', ') + ')' : '');
});

assert(fs.existsSync(path.join(CSS_DIR, 'phase2-mockup.css')),
    'стиль макетов лежит в download/atex/css');

// ── 4. Карта деплоя ─────────────────────────────────────────────────────────────────────────
// update.conf разбираем в пары «источник → приёмник» и спрашиваем у карты, куда поедет каждый
// файл макетов. Шаблон `*` у update.php не рекурсивный и берёт только файлы, поэтому макеты
// лежат прямо в каталогах js и css, без вложенных папок.
function deployMap() {
    var lines = fs.readFileSync(path.join(ROOT, 'update.conf'), 'utf8').split(/\r?\n/);
    var pairs = [];
    lines.forEach(function (line) {
        var row = line.trim();
        if (!row || row.charAt(0) === '#' || row.charAt(0) === '[') { return; }
        var parts = row.split(' : ');
        if (parts.length !== 2) { return; }
        pairs.push({ from: parts[0].trim(), to: parts[1].trim() });
    });
    return pairs;
}

function targetOf(pairs, repoPath) {
    var dir = path.posix.dirname(repoPath);
    var hit = pairs.filter(function (p) {
        if (p.from === repoPath) { return true; }
        return p.from.slice(-2) === '/*' && p.from.slice(0, -2) === dir;
    });
    return hit.length ? hit[hit.length - 1].to : null;
}

var maps = deployMap();
var deployTargets = mockupFiles.map(function (name) {
    return { name: name, to: targetOf(maps, 'download/atex/js/' + name) };
}).concat([{
    name: 'phase2-mockup.css',
    to: targetOf(maps, 'download/atex/css/phase2-mockup.css')
}]);

var undeployed = deployTargets.filter(function (t) { return !t.to; });
assert(undeployed.length === 0,
    'каждый файл макетов попадает под правило деплоя',
    '(' + deployTargets.length + ' файлов' + (undeployed.length
        ? ', без правила: ' + undeployed.map(function (t) { return t.name; }).join(', ') : '') + ')');

var LIVE_JS = '/var/www/www-root/data/www/ideav.ru/download/ateh/js/';
var LIVE_CSS = '/var/www/www-root/data/www/ideav.ru/download/ateh/css/';

var pagesTo = new Set(deployTargets.filter(function (t) { return t.name !== 'phase2-mockup.css'; })
    .map(function (t) { return t.to; }));
assert(pagesTo.size === 1 && pagesTo.has(LIVE_JS),
    'страницы и каркас едут в download/ateh/js живого сайта',
    '(' + Array.from(pagesTo).join(', ') + ')');

var cssTo = deployTargets[deployTargets.length - 1].to;
assert(cssTo === LIVE_CSS,
    'стиль едет в download/ateh/css живого сайта', '(' + cssTo + ')');

// Относительный `../css/…` со страницы должен попадать ровно в тот каталог, куда карта везёт
// стиль: иначе на бою страница откроется без оформления.
var cssFromPage = path.posix.normalize(LIVE_JS + '../css/');
assert(cssFromPage === LIVE_CSS,
    'путь ../css/ со страницы указывает на каталог стиля на сервере', '(' + cssFromPage + ')');

// Живая ссылка для заказчика собирается из той же строки карты: подменили приёмник — тест
// покажет другой адрес, и ссылку в составе решения тоже надо будет менять.
var liveDir = LIVE_JS.replace('/var/www/www-root/data/www/', 'https://');
assert(liveDir + PHASE2_PAGES[0].file === 'https://ideav.ru/download/ateh/js/phase2-mockups.html',
    'навигатор открывается по адресу из состава решения',
    '(' + liveDir + PHASE2_PAGES[0].file + ')');

// ── 5. Палитра применяется к странице ───────────────────────────────────────────────────────
// Токены макета объявлены не на :root, а на классе: файл лежит в общем каталоге стилей рядом с
// боевыми рабочими местами, и его палитра не должна перекрывать бренд-переменные чужой страницы.
// Цена такого решения — класс обязан стоять на <body> каждой страницы: без него токены не
// применяются и макет открывается без оформления. Проверяем разобранное правило и разобранный
// список классов страницы, а не написание файлов.
function paletteRule() {
    var sheet = fs.readFileSync(path.join(CSS_DIR, 'phase2-mockup.css'), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '');
    var re = /([^{}]+)\{([^{}]*)\}/g;
    var m, light = null, dark = null;
    while ((m = re.exec(sheet)) !== null) {
        if (m[2].indexOf('--atex-paper') < 0) { continue; }
        var sel = m[1].trim();
        if (sel.indexOf('[data-theme') === 0) { dark = sel; } else if (!light) { light = sel; }
    }
    return { light: light, dark: dark };
}

function pageClasses(name) {
    var markup = fs.readFileSync(path.join(DIR, name), 'utf8');
    var m = /<body[^>]*\sclass="([^"]*)"/.exec(markup);
    return m ? m[1].trim().split(/\s+/) : [];
}

var palette = paletteRule();
var scoped = palette.light && palette.light.charAt(0) === '.' && palette.light.indexOf(' ') < 0;
assert(scoped, 'палитра макетов объявлена на классе, а не на :root', '(' + palette.light + ')');

var paletteScope = scoped ? palette.light.slice(1) : palette.light;
var unscoped = onDisk.filter(function (name) { return pageClasses(name).indexOf(paletteScope) < 0; });
assert(unscoped.length === 0,
    'класс палитры стоит на body каждой страницы: ' + paletteScope,
    unscoped.length ? '(нет на: ' + unscoped.join(', ') + ')' : '(' + onDisk.length + ' страниц)');

// ── Итог ────────────────────────────────────────────────────────────────────────────────────
console.log('\n' + passed + '/' + total + ' проверок прошли');
