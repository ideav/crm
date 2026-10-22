// Issue #5221: вид приложения и раскладка меню выбираются по текущему пользователю.
// Предмет — js/app-view.js (браузерный файл, грузится в vm как есть).
//   вид:      гость (нет пользователя / guest) | админ (роль admin, владелец базы, доступ к
//             структуре) | пользователь (остальные);
//   раскладка: админу — левое меню; прочим — верхнее, пока пунктов верхнего уровня не больше
//             APP_TOP_MENU_MAX и нет третьего уровня, иначе левое; явный выбор шаблона сильнее.

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

check(AV && typeof AV.getView === 'function' && typeof AV.getMenuLayout === 'function', 'модуль AppView загружен');

// --- вид: таблица «вход × ожидание»
const views = [
    [{ db: 'shop', user: '', role: '' }, 'guest', 'нет пользователя'],
    [{ db: 'shop', user: 'guest', role: 'guest' }, 'guest', 'пользователь guest'],
    [{ db: 'shop', user: 'Guest', role: 'visitor' }, 'guest', 'guest в любом регистре и с любой ролью'],
    [{ db: 'shop', user: 'admin', role: 'admin', roleId: '145' }, 'admin', 'суперпользователь admin'],
    [{ db: 'shop', user: 'ivan', role: 'Admin' }, 'admin', 'роль admin в любом регистре'],
    [{ db: 'shop', user: 'ivan', role: 'boss', roleId: '145' }, 'admin', 'роль с id ADMINROLE'],
    [{ db: 'shop', user: 'shop', role: 'owner' }, 'admin', 'владелец базы (логин = имя базы)'],
    [{ db: 'shop', user: 'ivan', role: 'tech', grants: { '0': 'WRITE' } }, 'admin', 'правка структуры'],
    [{ db: 'shop', user: 'ivan', role: 'tech', grants: { '0': 'READ' } }, 'admin', 'просмотр структуры'],
    [{ db: 'shop', user: 'ivan', role: 'manager', grants: { '18': 'WRITE', '0': 'BARRED' } }, 'user', 'обычная роль'],
    [{ db: 'shop', user: 'ivan', role: 'manager', grants: [] }, 'user', 'роль без прав (grants — пустой массив)'],
    [{ db: 'shop', user: 'ivan', role: 'manager' }, 'user', 'grants не переданы'],
];
for (const [input, want, name] of views)
    check(AV.getView(input) === want, 'вид: ' + name + ' → ' + want + ' (получено ' + AV.getView(input) + ')');

// --- раскладка
function flat(n) {
    const items = [];
    for (let i = 1; i <= n; i++) items.push({ menu_id: String(i), menu_up: '', name: 'П' + i, href: 'p' + i });
    return items;
}
const max = AV.TOP_MENU_MAX;
check(Number.isInteger(max) && max >= 3, 'порог верхнего меню — целое число (' + max + ')');

check(AV.getMenuLayout('user', flat(max)) === 'top', 'пользователь, ' + max + ' пунктов → верхнее');
check(AV.getMenuLayout('user', flat(max + 1)) === 'left', 'пользователь, ' + (max + 1) + ' пунктов → левое');
check(AV.getMenuLayout('guest', flat(3)) === 'top', 'гость, 3 пункта → верхнее');
check(AV.getMenuLayout('guest', []) === 'top', 'гость без пунктов → верхнее (пустой сайдбар не показываем)');
check(AV.getMenuLayout('admin', flat(2)) === 'left', 'админ, 2 пункта → левое (админское меню)');
check(AV.getMenuLayout('admin', []) === 'left', 'админ без пунктов → левое');

// подпункты второго уровня — выпадающие списки, в счёт не идут
const twoLevel = flat(3).concat([
    { menu_id: '11', menu_up: '1', name: 'П1.1', href: 'a' },
    { menu_id: '12', menu_up: '1', name: 'П1.2', href: 'b' },
    { menu_id: '21', menu_up: '2', name: 'П2.1', href: 'c' },
    { menu_id: '22', menu_up: '2', name: 'П2.2', href: 'd' },
    { menu_id: '23', menu_up: '2', name: 'П2.3', href: 'e' },
]);
check(AV.getMenuLayout('user', twoLevel) === 'top', 'два уровня, 3 раздела → верхнее с выпадающими');
const threeLevel = twoLevel.concat([{ menu_id: '111', menu_up: '11', name: 'П1.1.1', href: 'f' }]);
check(AV.getMenuLayout('user', threeLevel) === 'left', 'третий уровень → левое');
// пункт с родителем, которого нет в меню роли, — верхний уровень (как в buildMenu)
const orphans = flat(max).concat([{ menu_id: '99', menu_up: '777', name: 'Сирота', href: 'x' }]);
check(AV.getMenuLayout('user', orphans) === 'left', 'сирота считается пунктом верхнего уровня');

// явный выбор шаблона
check(AV.getMenuLayout('admin', flat(2), 'top') === 'top', 'явное top сильнее админского правила');
check(AV.getMenuLayout('user', flat(2), 'left') === 'left', 'явное left сильнее подсчёта');
check(AV.getMenuLayout('user', flat(2), 'auto') === 'top', 'auto — автоматический выбор');
check(AV.getMenuLayout('user', flat(2), 'garbage') === 'top', 'неизвестное значение — автоматический выбор');

// --- применение к корню документа: классы вида и раскладки
function fakeRoot(attrs) {
    const classes = new Set();
    return {
        classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c) },
        getAttribute: n => (attrs && n in attrs ? attrs[n] : null),
        classes,
    };
}
let root = fakeRoot();
let res = AV.apply(root, { db: 'shop', user: 'guest', role: 'guest' }, flat(3));
check(res.view === 'guest' && res.layout === 'top', 'apply: гость → guest/top');
check(root.classes.has('app-view-guest') && root.classes.has('menu-layout-top'), 'apply: классы app-view-guest и menu-layout-top');

root = fakeRoot({ 'data-menu-layout': 'left' });
res = AV.apply(root, { db: 'shop', user: 'guest', role: 'guest' }, flat(3));
check(res.layout === 'left' && root.classes.has('menu-layout-left') && !root.classes.has('menu-layout-top'),
    'apply: data-menu-layout корня шаблона задаёт раскладку');

root = fakeRoot();
AV.apply(root, { db: 'shop', user: 'ivan', role: 'manager' }, flat(3));
AV.apply(root, { db: 'shop', user: 'ivan', role: 'manager' }, flat(max + 2));
check(root.classes.has('menu-layout-left') && !root.classes.has('menu-layout-top'), 'apply повторно: прежняя раскладка снимается');

if (failures) {
    console.log('\n' + failures + ' FAIL');
    process.exitCode = 1;
} else {
    console.log('\nOK');
}
