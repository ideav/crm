// #4544 — ВОССТАНОВЛЕНИЕ ИЗ БЭКАПА НЕ ТЕРЯЕТ ЗНАЧЕНИЯ-ТЕГИ.
//
// СИМПТОМ (issue #4544, боевая база ateh). После `backup` и восстановления по ссылке
// `/{db}/restore/?backup_file=…dmp.zip` левое меню осталось на месте — названия, ссылки,
// вложенность целы, — но У ВСЕХ пунктов пропали иконки: в DOM вместо своей иконки стои́т
// запасная `<i class="pi pi-file"></i>`, которую `main-app.js` подставляет, когда `item.icon`
// пуст.
//
// ПРИЧИНА. Обработчик `restore` (index.php) отдаёт дамп командой `die("INSERT INTO …")` и НЕ
// объявляет тип ответа. PHP по умолчанию ставит `text/html`, и браузер разбирает выданный SQL
// как РАЗМЕТКУ. Значение, которое само является тегом, из показанного текста исчезает:
//     '<i class="pi pi-upload"></i>'  →  ''
// а числовая сущность молча превращается в символ:
//     '&#128196;'                     →  '📄'
// Обычные значения (имена пунктов, ссылки) — целы, поэтому восстановленная база выглядит
// рабочей, и потеря видна только по иконкам. Иконки меню atex хранятся именно тегами
// (docs/atex_menu.json: `"icon": "<i class=\"pi pi-calendar\"></i>"`), а исторически —
// html-сущностями эмодзи (#624/PR#625), то есть под удар попадают оба формата.
//
// ПРАВИЛО: эндпоинт, отдающий ДАННЫЕ, обязан объявить тип ответа. Дамп — не страница.
//
// Что проверяем:
//   A — `restore` объявляет `Content-Type: text/plain` (с charset utf-8) ДО выдачи дампа;
//   B — воспроизведение потери: разбор дампа как HTML съедает значение-тег и подменяет
//       сущность, а обычные значения оставляет целыми (ровно наблюдавшаяся картина);
//   C — иконки меню atex действительно хранятся тегами — то есть правило защищает боевые данные;
//   D — запасная иконка в main-app.js ставится ИМЕННО при пустом значении (связь симптома
//       с причиной: пустой icon → `pi pi-file` у всех пунктов).
//
// Run with: node experiments/issue-4544-restore-plain-text.test.js

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
let passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

// ── A. Обработчик restore объявляет тип ответа ───────────────────────────────────────────────
const indexPhp = fs.readFileSync(path.join(root, 'index.php'), 'utf8');
const restoreStart = indexPhp.indexOf('case "restore":');
const restoreEnd = indexPhp.indexOf('case "backup":', restoreStart);
assert(restoreStart !== -1 && restoreEnd > restoreStart, '#4544-A предпосылка: обработчик restore найден');
const restoreBlock = indexPhp.slice(restoreStart, restoreEnd);

const headerAt = restoreBlock.search(/header\(\s*"Content-Type:\s*text\/plain/i);
const dieAt = restoreBlock.indexOf('die("INSERT INTO');
assert(headerAt !== -1,
    '#4544-A: restore объявляет Content-Type: text/plain (дамп — данные, а не страница)');
assert(/charset\s*=\s*utf-8/i.test(restoreBlock),
    '#4544-A: у типа ответа указан charset=utf-8 (значения в UTF-8, иначе кириллица как cp1251)');
assert(headerAt !== -1 && dieAt !== -1 && headerAt < dieAt,
    '#4544-A: заголовок выставлен ДО выдачи дампа');

// ── B. Воспроизведение потери: дамп, разобранный как HTML ────────────────────────────────────
// Минимальный разбор «как браузер»: выкидываем теги, раскрываем числовые сущности.
function visibleAsHtml(markup) {
    return String(markup)
        .replace(/<[^>]*>/g, '')
        .replace(/&#(\d+);/g, (m, code) => String.fromCodePoint(Number(code)));
}
const dump = 'INSERT INTO `ateh` (`id`, `t`, `up`, `ord`, `val`) VALUES '
    + "(242,151,145,1,'Загрузка'),"
    + "(243,153,242,1,'upload'),"
    + '(244,391,242,1,\'<i class="pi pi-upload"></i>\'),'
    + "(245,391,246,1,'&#128196;');";
const seen = visibleAsHtml(dump);

assert(seen.indexOf('<i class="pi pi-upload"></i>') === -1 && seen.indexOf("(244,391,242,1,'')") !== -1,
    '#4544-B: значение-тег из показанного дампа ИСЧЕЗАЕТ (иконка становится пустой)');
assert(seen.indexOf('&#128196;') === -1 && seen.indexOf('📄') !== -1,
    '#4544-B: числовая сущность молча подменяется символом');
assert(seen.indexOf("'Загрузка'") !== -1 && seen.indexOf("'upload'") !== -1,
    '#4544-B: обычные значения целы — потому база и выглядит восстановленной');

// ── C. Боевые иконки меню atex — это теги ────────────────────────────────────────────────────
const menu = JSON.parse(fs.readFileSync(path.join(root, 'docs', 'atex_menu.json'), 'utf8'));
const icons = (menu.roles || []).reduce((acc, r) => acc.concat((r.menus || []).map((m) => m.icon || '')), []);
const tagIcons = icons.filter((icon) => icon.indexOf('<') !== -1);
assert(icons.length > 0 && tagIcons.length === icons.length,
    '#4544-C: все иконки меню atex хранятся тегами — под правило попадают боевые данные',
    '(' + tagIcons.length + ' из ' + icons.length + ', напр. ' + JSON.stringify(icons[0]) + ')');

// ── D. Запасная иконка ставится именно при ПУСТОМ значении ───────────────────────────────────
const mainApp = fs.readFileSync(path.join(root, 'js', 'main-app.js'), 'utf8');
const fallbackBranch = /\}\s*else\s*\{\s*\n\s*\/\/[^\n]*\n\s*iconSpan\.innerHTML\s*=\s*'<i class="pi pi-file"><\/i>'/;
assert(fallbackBranch.test(mainApp),
    '#4544-D: `pi pi-file` — ветка ПУСТОГО icon (пустое значение → одинаковая иконка у всех пунктов)');

console.log('\n' + passed + '/' + total + ' проверок пройдено');
if (passed !== total) process.exitCode = 1;
