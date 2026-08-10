// Единственный пункт меню: левого меню нет совсем, с корня базы уходим в этот
// пункт (ideav/crm#4690).
//
// Меню роли приходит в шаблон блоком `MyRoleMenu`. Пока `var menuData` стоял
// перед скриптами внизу страницы, решение «меню не показываем» принималось уже
// после того, как браузер отрисовал `<aside class="app-sidebar">`, — меню
// мелькало. Поэтому и данные меню, и решение по ним живут в `<head>`.
//
// Тест не грепает шаблон, а ИСПОЛНЯЕТ его head-скрипты на заглушках DOM:
// подставляет глобальные переменные, разворачивает блок MyRoleMenu нужным
// числом строк и смотрит, что скрипты сделали с документом.
//
// Run with: node experiments/issue-4690-single-menu.test.js

var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var TEMPLATES = ['templates/ru/main.html', 'templates/atex/main.html'];

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
function assertTrue(cond, name) { assertEqual(!!cond, true, name); }

function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }

// ── Мини-шаблонизатор: то же, что делает Make_tree/Parse_block в index.php ──
var BLOCK_RE = /<!-- Begin: MyRoleMenu -->([\s\S]*?)<!-- End: MyRoleMenu -->/;

function render(tpl, globals, menuRows) {
    var block = tpl.match(BLOCK_RE);
    if (!block) throw new Error('в шаблоне нет блока MyRoleMenu');
    var rows = menuRows.map(function(row) {
        return block[1].replace(/\{(\w+)\}/g, function(all, key) {
            return row[key] !== undefined ? row[key] : '';
        });
    }).join('');
    return tpl
        .replace(BLOCK_RE, rows)
        .replace(/\{_global_\.(\w+)\}/g, function(all, key) {
            return globals[key] !== undefined ? globals[key] : '';
        });
}

// ── Заглушки DOM: ровно то, чем пользуются head-скрипты ──
function makeNode(tag) {
    var node = {
        tagName: String(tag).toUpperCase(),
        id: '',
        className: '',
        textContent: '',
        value: '',
        dataset: {},
        style: {
            setProperty: function() {},
            removeProperty: function() {}
        },
        classList: { add: function() {}, remove: function() {}, toggle: function() {} },
        setAttribute: function() {},
        appendChild: function(child) { node.children.push(child); return child; },
        addEventListener: function() {},
        children: []
    };
    return node;
}

function runHeadScripts(rendered, ctx) {
    var head = rendered.slice(0, rendered.indexOf('</head>'));
    var scripts = [];
    var re = /<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi;
    var m;
    while ((m = re.exec(head)) !== null) scripts.push(m[1]);
    if (!scripts.length) throw new Error('в head нет встроенных скриптов');

    var appended = [];
    var doc = {
        cookie: '',
        body: null,
        documentElement: {
            style: { setProperty: function() {}, removeProperty: function() {} },
            classList: { add: function() {}, remove: function() {} }
        },
        head: { appendChild: function(node) { appended.push(node); return node; } },
        createElement: makeNode,
        addEventListener: function() {},
        getElementById: function() { return null; },
        querySelectorAll: function() { return []; }
    };
    var navigated = [];
    var loc = { pathname: ctx.pathname, replace: function(url) { navigated.push(url); } };
    var store = { getItem: function() { return null; }, setItem: function() {} };

    new Function('document', 'window', 'localStorage', 'location', scripts.join('\n;\n'))
        (doc, {}, store, loc);

    return {
        styles: appended.map(function(node) { return node.textContent || ''; }),
        navigated: navigated
    };
}

function boot(tplRel, opts) {
    var rendered = render(read(tplRel), {
        z: 'testdb', xsrf: 'xsrf', id: '', token: 'tok', user_id: '1',
        user: 'user', role: 'Диспетчер', role_id: '2',
        action: opts.action, version: '1',
        grants: Buffer.from('[]').toString('base64')
    }, opts.menu);
    return runHeadScripts(rendered, { pathname: opts.pathname });
}

function hidesSidebar(result) {
    return result.styles.some(function(css) {
        return /\.app-sidebar[^{]*\{[^}]*display\s*:\s*none/i.test(css);
    });
}

var ONE = [{ menu_id: '10', menu_up: '', name: 'Упаковщик', href: 'packer', icon: 'pi-box', expanded: '' }];
var TWO = [
    { menu_id: '10', menu_up: '', name: 'Упаковщик', href: 'packer', icon: 'pi-box', expanded: '' },
    { menu_id: '11', menu_up: '', name: 'Резчик', href: 'slitter', icon: 'pi-cog', expanded: '' }
];

TEMPLATES.forEach(function(tpl) {
    // Пункт один: меню не должно появиться вообще, а с корня базы (action пуст)
    // пользователь уходит прямо в него.
    var one = boot(tpl, { menu: ONE, action: '', pathname: '/testdb' });
    assertTrue(hidesSidebar(one), tpl + ': один пункт — левое меню скрыто ещё до отрисовки body');
    assertEqual(one.navigated, ['/testdb/packer'], tpl + ': один пункт — с корня базы переходим в него');

    // Тот же единственный пункт, но пользователь уже внутри: меню по-прежнему
    // не показываем, а никуда не перебрасываем — иначе из карточки не выйти.
    var inside = boot(tpl, { menu: ONE, action: 'object', pathname: '/testdb/object/5' });
    assertTrue(hidesSidebar(inside), tpl + ': один пункт — меню скрыто и на внутренней странице');
    assertEqual(inside.navigated, [], tpl + ': один пункт — внутреннюю страницу не перебиваем редиректом');

    // Пунктов больше одного — поведение прежнее.
    var two = boot(tpl, { menu: TWO, action: '', pathname: '/testdb' });
    assertEqual(hidesSidebar(two), false, tpl + ': два пункта — меню на месте');
    assertEqual(two.navigated, [], tpl + ': два пункта — никаких редиректов');

    // Меню пустое (роль без пунктов) — не прячем и не редиректим.
    var none = boot(tpl, { menu: [], action: '', pathname: '/testdb' });
    assertEqual(hidesSidebar(none), false, tpl + ': пустое меню — меню не прячем');
    assertEqual(none.navigated, [], tpl + ': пустое меню — никаких редиректов');

    // Единственный пункт без адреса (заголовок группы): спрятать меню значило бы
    // запереть пользователя на пустой странице.
    var noHref = boot(tpl, {
        menu: [{ menu_id: '10', menu_up: '', name: 'Раздел', href: '', icon: '', expanded: '' }],
        action: '', pathname: '/testdb'
    });
    assertEqual(hidesSidebar(noHref), false, tpl + ': единственный пункт без href — меню оставляем');
    assertEqual(noHref.navigated, [], tpl + ': единственный пункт без href — никуда не уводим');

    // Данные меню объявлены один раз и до body — иначе решение принимается
    // после первой отрисовки и меню мелькает.
    var src = read(tpl);
    var blocks = src.match(/<!-- Begin: MyRoleMenu -->/g) || [];
    assertEqual(blocks.length, 1, tpl + ': блок MyRoleMenu ровно один');
    assertTrue(src.indexOf('var menuData') < src.indexOf('<body'), tpl + ': menuData объявлен в head, до <body>');
});

console.log('\n' + passed + ' проверок прошли');
