// Мерка к issue #5652: у каждого решения портала «Решения» свой индексируемый адрес /solutions/<slug>.
// rules: none (defect #5652)
// TEXT-ASSERT-OK: серверная вёрстка шаблонов; отрисовать блок отчёта без базы нельзя, живая проверка — curl гостем на боевом адресе
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const C = require(path.join(root, 'download', 'solutions', 'app.js'));
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');

// адреса 21 решения: это и контракт для рекламы, и список обязательных файлов-переходников
const SLUGS = ['wfm', 'mdm', 'sverka', 'bi', 'loyalty', 'budgeting', 'srm', 'b2b-portal', 'service-desk', 'resource-planning',
  'toir', 'field-service', 'pim', 'mes', 'kedo', 'debitorka', 'cpq', 'task-tracker', 'bpm-camunda', 'ohrana-truda', 'llm-router'];
assert.strictEqual(new Set(SLUGS).size, 21);

// slug: короткая латиница, цифры, дефис; ядро приводит адрес к нижнему регистру, поэтому заглавные не годятся
SLUGS.forEach(s => assert.strictEqual(C.safeSlug(s), s, s));
assert.strictEqual(C.safeSlug('WFM'), '');
assert.strictEqual(C.safeSlug('a/b'), '');
assert.strictEqual(C.safeSlug('../x'), '');
assert.strictEqual(C.safeSlug('a" onclick="x'), '');
assert.strictEqual(C.safeSlug(null), '');

// запись решения несёт адрес
const row = (id, o) => Object.assign({ id, 'Решение': 'S' + id, 'Кратко': 'k', 'Боль': 'b', 'Что умеет': '', 'Как переезжаем': '', 'Категория': null,
  'Отрасль': [], 'Надстройка над': null, 'Демо ссылка': '', 'Демо скоро': '', 'Опубликовано': '1', 'Порядок': '' }, o);
assert.strictEqual(C.normalize(row(1, { 'Адрес': 'wfm' })).slug, 'wfm');
assert.strictEqual(C.normalize(row(1, { 'Адрес': 'Нельзя так' })).slug, '');
assert.strictEqual(C.normalize(row(1, {})).slug, '');

// ссылка карточки: обычная, на чистый адрес; без адреса — прежняя hash-ссылка
assert.strictEqual(C.solutionHref('solutions', { id: 561, slug: 'wfm' }), '/solutions/wfm');
assert.strictEqual(C.solutionHref('solutions', { id: 561, slug: '' }), '#/s/561');

// разбор адреса страницы: путь важнее, hash остаётся для каталога и заявки
const loc = (p, h) => C.parseLocation(p, h);
assert.deepStrictEqual(loc('/solutions/wfm', ''), { view: 'solution', slug: 'wfm' });
assert.deepStrictEqual(loc('/solutions/wfm/', ''), { view: 'solution', slug: 'wfm' });
assert.deepStrictEqual(loc('/solutions/b2b-portal', '#/apply/5'), { view: 'apply', id: 5 });
assert.deepStrictEqual(loc('/solutions/catalog', '#/s/12'), { view: 'legacy', id: 12 });
assert.deepStrictEqual(loc('/solutions/wfm', '#/s/12'), { view: 'legacy', id: 12 });
assert.deepStrictEqual(loc('/solutions/catalog', '#/?cat=2'), { view: 'catalog', q: { cat: '2' } });
assert.deepStrictEqual(loc('/solutions/catalog', ''), { view: 'catalog', q: {} });
assert.deepStrictEqual(loc('/solutions/catalog/', '#/apply'), { view: 'apply', id: 0 });
assert.strictEqual(loc('/solutions/WFM', '').slug, 'wfm');
assert.strictEqual(loc('/solutions/a%', '').view, 'solution');

// старая ссылка #/s/<id> уводит на новый адрес, если у решения он есть
const list = [{ id: 561, slug: 'wfm' }, { id: 578, slug: '' }];
assert.strictEqual(C.legacyTarget(list, 561, 'solutions'), '/solutions/wfm');
assert.strictEqual(C.legacyTarget(list, 578, 'solutions'), '');
assert.strictEqual(C.legacyTarget(list, 999, 'solutions'), '');

// поиск решения по адресу
assert.strictEqual(C.bySlug(list, 'wfm').id, 561);
assert.strictEqual(C.bySlug(list, 'nope'), null);

// переходники: файл на каждый адрес, содержимое одинаковое, фигурных скобок нет
const shim = read('templates', 'solutions', 'wfm.html');
assert.ok(/<!--\s*File:\s*solution\s*-->/.test(shim), 'переходник подключает solution.html');
assert.ok(!/[{}]/.test(shim));
SLUGS.forEach(s => assert.strictEqual(read('templates', 'solutions', s + '.html'), shim, s + '.html отличается от переходника'));

// адрес не должен совпасть с действием ядра или общим шаблоном: иначе страница решения не откроется
const core = read('index.php');
SLUGS.forEach(s => {
  assert.ok(!core.includes('case "' + s + '"'), s + ': совпало с действием ядра');
  assert.ok(!fs.existsSync(path.join(root, 'templates', s + '.html')), s + ': совпало с общим шаблоном');
});

// шапка страницы: title, description, canonical, og:* конкретного решения отдаёт сервер блоком отчёта solseo
const main = read('templates', 'solutions', 'main.html');
const head = main.slice(0, main.indexOf('</head>'));
const blk = head.match(/<!--\s*Begin:\s*solseo\s*-->([\s\S]*?)<!--\s*End:\s*solseo\s*-->/);
assert.ok(blk, 'в head нет блока solseo');
const b = blk[1];
assert.ok(/<title>\{title\}[^<{}]*<\/title>/.test(b), 'title');
assert.ok(/<meta name="description" content="\{descr\}">/.test(b), 'description');
assert.ok(/<link rel="canonical" href="https:\/\/ideav\.ru\/solutions\/\{slug\}">/.test(b), 'canonical');
assert.ok(/<meta property="og:title" content="\{title\}">/.test(b), 'og:title');
assert.ok(/<meta property="og:description" content="\{descr\}">/.test(b), 'og:description');
assert.ok(/<meta property="og:image" content="https:\/\/ideav\.ru\/download\/solutions\/img\/\{img\}-l\.webp">/.test(b), 'og:image');
assert.ok(/<meta property="og:url" content="https:\/\/ideav\.ru\/solutions\/\{slug\}">/.test(b), 'og:url');
assert.ok(/<meta name="twitter:card" content="summary_large_image">/.test(b), 'twitter:card');
// в блоке только колонки отчёта solseo: любая другая точка вставки уронила бы весь блок
(b.match(/\{[^}]*\}/g) || []).forEach(p => assert.ok(['{title}', '{descr}', '{slug}', '{img}'].includes(p), 'лишняя точка вставки ' + p));
// общий каркас сохранён: рабочее место по-прежнему подключается маркером
assert.ok(/<!--\s*File:\s*a\s*-->/.test(main));

// тело страницы: h1 и краткий текст в HTML без JS
const sol = read('templates', 'solutions', 'solution.html');
const sb = sol.match(/<!--\s*Begin:\s*solseo\s*-->([\s\S]*?)<!--\s*End:\s*solseo\s*-->/);
assert.ok(sb, 'в solution.html нет блока solseo');
assert.ok(/<h1[^>]*>\{title\}<\/h1>/.test(sb[1]), 'h1');
assert.ok(/\{descr\}/.test(sb[1]) && /\{pain\}/.test(sb[1]), 'краткий текст и боль');
(sb[1].match(/\{[^}]*\}/g) || []).forEach(p => assert.ok(['{title}', '{descr}', '{pain}'].includes(p), 'лишняя точка вставки ' + p));
assert.ok((sol.replace(sb[0], '').match(/\{[^}]*\}/g) || []).length === 0, 'вне блока точек вставки быть не должно');
assert.ok(/id="sl-app"/.test(sol) && /download\/solutions\/app\.js\?v=\d+/.test(sol) && /download\/solutions\/app\.css\?v=\d+/.test(sol));
assert.ok(/href="\/solutions\/catalog"/.test(sol), 'ссылка на каталог — обычная');

// версия ассетов одна во всех шаблонах портала и поднята
const v = t => (t.match(/app\.js\?v=(\d+)/) || [])[1];
assert.strictEqual(v(sol), v(read('templates', 'solutions', 'catalog.html')));
assert.ok(Number(v(sol)) >= 4, 'версия ассетов не поднята');
console.log('solutions-slug: ok');
