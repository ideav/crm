// Мерка к issue #5420: ЛК базы my без ролевых блоков шаблонизатора.
// https://github.com/ideav/crm/issues/5420
//
// Браузерные файлы (не CommonJS) грузятся чтением и eval; проверяется поведение функций:
//   1) режим страницы: вид admin (роль admin, суперадмин user_id 0, владелец базы) — рабочее
//      место админа, остальные — ЛК (выбор — настоящий AppView.getView из js/app-view.js);
//   2) разбор API-ответа шаблонизатора /my/cabdata?JSON (формат снят с живого /my/?JSON);
//   3) сводка раздела «Обзор»; 4) плитки разделов админа из меню роли;
//   5) MyMode.put вставляет разметку только своего режима.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
global.window = globalThis;
for (const f of ['js/app-view.js', 'js/my-mode.js', 'js/my-cabinet.js', 'js/my-admin-home.js'])
    (0, eval)(fs.readFileSync(path.join(root, f), 'utf8'));

let failures = 0;
function check(name, fn) {
    try { fn(); console.log('PASS: ' + name); } catch (e) { failures++; console.log('FAIL: ' + name + '\n  ' + e.message); }
}

const getView = window.AppView.getView;
const mode = ctx => window.MyMode.getMode(ctx, getView);

check('суперадмин (ADMINHASH, user_id 0, грантов нет) — рабочее место админа', () => {
    assert.strictEqual(mode({ db: 'my', user: 'admin', role: 'admin', roleId: '145', grants: null }), 'admin');
});
check('роль admin — рабочее место админа', () => {
    assert.strictEqual(mode({ db: 'my', user: 'boss', role: 'admin', roleId: '145', grants: {} }), 'admin');
});
check('владелец базы my — рабочее место админа', () => {
    assert.strictEqual(mode({ db: 'my', user: 'my', role: 'user', roleId: '42', grants: {} }), 'admin');
});
check('клиент с ролью user — ЛК', () => {
    assert.strictEqual(mode({ db: 'my', user: 'drynny', role: 'user', roleId: '42', grants: {} }), 'cabinet');
});
check('без входа — ЛК (cabinet.js сам уводит на start.html)', () => {
    assert.strictEqual(mode({ db: 'my', user: '', role: '', grants: null }), 'cabinet');
});

// Формат ответа шаблонизатора: ключ — путь блока, значения — столбцы точек вставки
const live = {
    '&main.a.noadmin': { role: ['user'], limit: ['5000'] },
    '&main.a.paidthismonth': { payment: [''] },
    '&main.a.plans': {
        planid: ['1146', '1147', '1148'], price: ['0.00', '1950.00', '4900.00'],
        limit: ['3000', '5000', '10000'], planname: ['Знакомство', 'Стартап', 'Масштабируемый']
    }
};
check('cabdata: тарифы в порядке отчёта с ценой и лимитом', () => {
    const d = window.MyMode.readCabData(live);
    assert.deepStrictEqual(d.plans.map(p => p.id), ['1146', '1147', '1148']);
    assert.deepStrictEqual(d.plans[1], { id: '1147', name: 'Стартап', price: 1950, limit: 5000 });
    assert.strictEqual(d.limit, 5000);
    assert.strictEqual(d.paidThisMonth, 0);
});
check('cabdata: оплата месяца суммируется, имя блока — без учёта регистра и пути', () => {
    const d = window.MyMode.readCabData({ 'paidThisMonth': { Payment: ['1000.50', '949,5'] } });
    assert.strictEqual(d.paidThisMonth, 1950);
});
check('cabdata: пустой или ошибочный ответ — пустые данные, а не исключение', () => {
    for (const bad of [null, [], { error: 'x' }, '[]'])
        assert.deepStrictEqual(window.MyMode.readCabData(bad), { plans: [], paidThisMonth: 0, limit: 0 });
});

check('обзор: базы, расход, процент и недавние базы по дате создания', () => {
    const user = { Name: 'Ал', Plan: 'Стартап', 'Plan date': '01.12.2026', Balance: '120.5', Bonus: '30', PlanID: '1147', PlanLimit: '5000' };
    const dbs = [
        Object.assign({ DB: 'alpha', Count: '1000', Date: '05.01.2026' }, user),
        { DB: 'beta', Count: '3000', Date: '12.10.2026' },
        { DB: 'gamma', Count: '500', Date: '28.02.2026' }
    ];
    const ov = window.MyCabinet.overview(user, dbs, { limit: 3000 });
    assert.strictEqual(ov.dbs, 3);
    assert.strictEqual(ov.units, 4500);
    assert.strictEqual(ov.limit, 5000);
    assert.strictEqual(ov.percent, 90);
    assert.deepStrictEqual(ov.recent.map(d => d.name), ['beta', 'gamma', 'alpha']);
    assert.strictEqual(ov.balance, 120.5);
    assert.strictEqual(ov.dbsNote, '');
});
check('обзор: без баз и данных — нули, лимит из cabdata, бесплатный план подсказывает предел', () => {
    const ov = window.MyCabinet.overview({ PlanID: '1146' }, [], { limit: 3000 });
    assert.strictEqual(ov.dbs, 0);
    assert.strictEqual(ov.limit, 3000);
    assert.strictEqual(ov.percent, 0);
    assert.strictEqual(ov.dbsNote, 'из 3 на бесплатном плане');
    assert.strictEqual(window.MyCabinet.overview(null, null, null).limit, 3000);
});
check('обзор: расход сверх лимита — 100%, не больше', () => {
    assert.strictEqual(window.MyCabinet.overview({ PlanLimit: '100' }, [{ DB: 'a', Count: '250' }]).percent, 100);
});

check('админ: плитки — разделы верхнего уровня меню роли с адресом', () => {
    const items = [
        { menu_id: '1', menu_up: '', name: 'Пользователи', href: 'object/18' },
        { menu_id: '2', menu_up: '1', name: 'Базы', href: 'object/271' },
        { menu_id: '3', menu_up: '', name: 'Группа', href: '' },
        { menu_id: '4', menu_up: '99', name: 'Платежи', href: 'report/1095' },
        { menu_id: '{menu_id}', menu_up: '', name: '{name}', href: '{href}' }
    ];
    assert.deepStrictEqual(window.MyAdminHome.sections(items).map(i => i.name), ['Пользователи', 'Платежи']);
    assert.deepStrictEqual(window.MyAdminHome.sections(undefined), []);
});

check('админ: иконка плитки — PrimeIcons из HTML меню, эмодзи как текст, иначе папка', () => {
    const ic = window.MyAdminHome.iconOf;
    assert.deepStrictEqual(ic('<i class="pi pi-users"></i>'), { pi: 'pi-users' });
    assert.deepStrictEqual(ic('&lt;i class=&quot;pi pi-tag&quot;&gt;&lt;/i&gt;'), { pi: 'pi-tag' });
    assert.deepStrictEqual(ic('📊'), { text: '📊' });
    assert.deepStrictEqual(ic(''), { pi: 'pi-folder' });
    assert.deepStrictEqual(ic('{icon}'), { pi: 'pi-folder' });
});

check('MyMode.put вставляет разметку только своего режима', () => {
    const written = [];
    const tpls = { 'my-body-admin': '<nav>админ</nav>', 'my-body-cabinet': '<main>ЛК</main>' };
    const doc = { getElementById: id => (id in tpls ? { innerHTML: tpls[id] } : null), write: s => written.push(s) };
    window.MY_MODE = 'cabinet';
    window.MyMode.put('body', doc);
    window.MY_MODE = 'admin';
    window.MyMode.put('body', doc);
    window.MyMode.put('head', doc);
    assert.deepStrictEqual(written, ['<main>ЛК</main>', '<nav>админ</nav>']);
});

console.log(failures ? '\n' + failures + ' FAIL' : '\nALL PASS');
if (failures) process.exitCode = 1;
