// Issue #5221: автовыбор раскладки меню — по включению, существующие приложения не меняются.
// Предмет — js/app-view.js (браузерный файл, грузится в vm как есть).
//   раскладка = <html data-menu-layout> шаблона → файл базы _menu_layout.html → left;
//   файл базы читается из <template id="app-menu-layout">: туда же попадает info.html,
//   если файла нет, — такое содержимое не выбор и даёт left;
//   право писать в таблицу меню (грант 151) — админский вид: правка меню живёт в левом меню.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'app-view.js'), 'utf8');
const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(src, ctx);
const AV = ctx.window.AppView;

let failures = 0;
function check(cond, name) {
    console.log((cond ? 'PASS: ' : 'FAIL: ') + name);
    if (!cond) failures++;
}

function flat(n) {
    const items = [];
    for (let i = 1; i <= n; i++) items.push({ menu_id: String(i), menu_up: '', name: 'П' + i, href: 'p' + i });
    return items;
}
function fakeRoot(attrs) {
    const classes = new Set();
    return {
        classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c) },
        getAttribute: n => (attrs && n in attrs ? attrs[n] : null),
        classes,
    };
}
const guest = { db: 'shop', user: 'guest', role: 'guest' };
const manager = { db: 'shop', user: 'ivan', role: 'manager' };

// --- умолчание: прежнее левое меню
for (const [who, c] of [['гость', guest], ['пользователь', manager]]) {
    const root = fakeRoot();
    const res = AV.apply(root, c, flat(3));
    check(res.layout === 'left' && root.classes.has('menu-layout-left') && !root.classes.has('menu-layout-top'),
        who + ', 3 пункта, без настройки → левое (как до #5221)');
}

// --- включение файлом базы
let root = fakeRoot();
check(AV.apply(root, manager, flat(3), 'auto').layout === 'top', 'файл базы auto, 3 пункта → верхнее');
check(AV.apply(fakeRoot(), manager, flat(AV.TOP_MENU_MAX + 1), 'auto').layout === 'left', 'файл базы auto, много пунктов → левое');
check(AV.apply(fakeRoot(), { db: 'shop', user: 'shop', role: 'owner' }, flat(2), 'auto').layout === 'left', 'файл базы auto, админ → левое');
check(AV.apply(fakeRoot(), manager, flat(20), 'top').layout === 'top', 'файл базы top → верхнее всегда');
check(AV.apply(fakeRoot({ 'data-menu-layout': 'left' }), manager, flat(3), 'auto').layout === 'left', 'атрибут шаблона сильнее файла базы');
check(AV.apply(fakeRoot({ 'data-menu-layout': '' }), manager, flat(3), 'auto').layout === 'top', 'пустой атрибут — берётся файл базы');

// --- чтение файла базы из <template>
const tpl = html => ({ innerHTML: html });
check(AV.readLayoutConfig(tpl('auto')) === 'auto', 'конфиг: auto');
check(AV.readLayoutConfig(tpl('  TOP \r\n')) === 'top', 'конфиг: пробелы, перевод строки и регистр не мешают');
check(AV.readLayoutConfig(tpl('left')) === 'left', 'конфиг: left');
check(AV.readLayoutConfig(tpl('<div class="info"><h1>Добро пожаловать</h1> auto</div>')) === '',
    'конфиг: подставленный вместо файла info.html — не выбор');
check(AV.readLayoutConfig(tpl('')) === '', 'конфиг: пусто');
check(AV.readLayoutConfig(null) === '', 'конфиг: нет элемента (свой main.html)');
check(AV.apply(fakeRoot(), manager, flat(3), AV.readLayoutConfig(tpl('<p>info</p>'))).layout === 'left',
    'info.html вместо файла → левое');

// --- право на правку меню — админский вид
const editor = { db: 'shop', user: 'ivan', role: 'editor', grants: { '151': 'WRITE' } };
check(AV.getView(editor) === 'admin', 'грант WRITE на меню (151) → вид admin');
check(AV.apply(fakeRoot(), editor, flat(3), 'auto').layout === 'left', 'редактор меню при auto → левое (правка меню доступна)');
check(AV.getView({ db: 'shop', user: 'ivan', role: 'reader', grants: { '151': 'READ' } }) === 'user', 'грант READ на меню → вид user');

if (failures) {
    console.log('\n' + failures + ' FAIL');
    process.exitCode = 1;
} else {
    console.log('\nOK');
}
