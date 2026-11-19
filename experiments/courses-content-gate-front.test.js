// Защита платного курса в LMS ideav.ru/courses, клиентская часть (download/courses/js/data.js).
// Урок платного курса ученик получает от сервера (courses-content.php), а не по адресу с ключом:
// - доступ есть, когда у ученика есть строка «Доступ» на курс; ключ в ней может быть скрыт ролью;
// - ни один запрос ученика не содержит ключа курса и адреса файла публикации;
// - бесплатные курсы читаются как раньше; в мок-режиме (локальный стенд без сервера) — прежний путь.
//
// Run with: node experiments/courses-content-gate-front.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const dir = path.join(__dirname, '..', 'download', 'courses', 'js');
const KEY = '0123456789abcdef0123456789abcdef';
const MAN = '/download/courses/aaa111/manifest.json';

// Портал с поддельной сетью: что запрошено — в gets, ответы — из files.
function portal(opts) {
    const gets = [];
    const files = Object.assign({
        '/download/courses/content/courses.json': { courses: [
            { code: 'mini', title: 'Мини-курс', free: true, lessons: [{ id: '00-start', n: 1, title: 'Старт' }] },
            { code: 'adept', title: 'Адепт', free: false, price: 9900, lessons: [{ id: 'm1', n: 1, title: 'Модуль 1' }] }] },
        '/download/courses/content/mini/00-start.json': { id: '00-start', html: '<p>бесплатно</p>' },
        ['/download/courses/content/adept-' + KEY + '/m1.json']: { id: 'm1', html: '<p>по ключу</p>' },
        '/courses-content.php?course=adept&lesson=m1': { id: 'm1', html: '<p>от сервера</p>' },
        '/courses-content.php?course=a12&lesson=l7': { id: 'l7', html: '<p>автор</p><script>x()</script>', tasks: [] },
        '/courses-content.php?course=a99': { code: 'a99', title: 'Снятый курс', author: 'Автор', lessons: [{ id: 'l1', n: 1, title: 'Урок', task: null }] },
        '/courses-content.php?course=a12': { code: 'a12', title: 'Курс автора', forWhom: 'Бухгалтерам', lessons: [{ id: 'l7', n: 1, title: 'Первый' }] },
        '/download/courses/free1/manifest.json': { code: 'a5', lessons: [{ id: 'l2', n: 1, title: 'Открытый', url: '/download/courses/free1/l2.json' }] },
        '/download/courses/free1/l2.json': { id: 'l2', html: '<p>открытый урок</p>', tasks: [] },
    }, opts.files || {});
    const tables = Object.assign({ 'Каталог': [
        { _id: '70', _main: 'a12', 'Название': 'Курс автора', 'Цена': '4900', 'Уроки': JSON.stringify([{ id: 'l7', n: 1, title: 'Первый' }]), 'Видимость': 'каталог', 'Манифест': '' },
        { _id: '71', _main: 'a5', 'Название': 'Бесплатный', 'Цена': '0', 'Уроки': JSON.stringify([{ id: 'l2', n: 1, title: 'Открытый' }]), 'Видимость': 'каталог', 'Манифест': '/download/courses/free1/manifest.json' },
    ] }, opts.tables || {});
    const ctx = { console, LMS: Object.assign({ user: 'my236968', userId: '1102', role: 'Ученик' }, opts.lms || {}) };
    ctx.window = ctx;
    ctx.DOMPurify = { addHook() {}, sanitize: html => String(html).replace(/<script[\s\S]*?<\/script>/gi, '') };
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(dir, 'vendor', 'marked-18.0.5.umd.js'), 'utf8'), ctx);
    ctx.LMSApp = {
        mock: !!opts.mock,
        contentRoot: '/download/courses/content/',
        isGuest: () => ctx.LMS.user === 'guest',
        loadSchema: () => Promise.resolve(),
        list: name => Promise.resolve((tables[name] || []).slice()),
        getJSON(url) {
            gets.push(url);
            if (url in files) return Promise.resolve(JSON.parse(JSON.stringify(files[url])));
            const e = new Error(url + ' -> 404'); e.status = 404; return Promise.reject(e);
        },
    };
    vm.runInContext(fs.readFileSync(path.join(dir, 'authors.js'), 'utf8'), ctx);
    vm.runInContext(fs.readFileSync(path.join(dir, 'data.js'), 'utf8'), ctx);
    return { D: ctx.LMSApp.data, gets };
}
const access = (course, key) => ({ _id: '9', _main: '1102:' + course, 'Пользователь': '1102:my236968', 'Курс': course, 'Ключ': key, 'Основание': 'оплата' });
const leaks = gets => gets.filter(u => u.includes(KEY) || u.includes('aaa111') || u.includes('bbb222'));

let failed = 0;
async function t(name, fn) {
    try { await fn(); console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + e.message); }
}

(async () => {
    await t('платный курс: ключ в «Доступе» скрыт — урок приходит от сервера', async () => {
        for (const hidden of [undefined, '']) {
            const row = access('adept', hidden); if (hidden === undefined) delete row['Ключ'];
            const { D, gets } = portal({ tables: { 'Доступ': [row] } });
            await D.init();
            const c = D.course('adept');
            assert.strictEqual(D.hasAccess(c), true);
            const l = await D.loadLesson(c, 'm1');
            assert.strictEqual(l.html, '<p>от сервера</p>');
            assert.ok(gets.includes('/courses-content.php?course=adept&lesson=m1'), gets.join('\n'));
        }
    });

    await t('платный курс: ключ в «Доступе» виден — запросов с ключом всё равно нет', async () => {
        const { D, gets } = portal({ tables: { 'Доступ': [access('adept', KEY), access('a12', MAN)] } });
        await D.init();
        assert.strictEqual((await D.loadLesson(D.course('adept'), 'm1')).html, '<p>от сервера</p>');
        await D.loadLesson(D.course('a12'), 'l7');
        assert.deepStrictEqual(leaks(gets), []);
    });

    await t('нет строки «Доступ» — курс закрыт, сервер не опрашивается', async () => {
        const { D, gets } = portal({ tables: { 'Доступ': [access('a12', MAN)] } });
        await D.init();
        const c = D.course('adept');
        assert.strictEqual(D.hasAccess(c), false);
        await assert.rejects(D.loadLesson(c, 'm1'));
        assert.ok(!gets.some(u => u.includes('course=adept')), gets.join('\n'));
    });

    await t('авторский платный курс: урок от сервера и очищен перед показом', async () => {
        const { D, gets } = portal({ tables: { 'Доступ': [access('a12', undefined)] } });
        await D.init();
        const c = D.course('a12');
        assert.strictEqual(D.hasAccess(c), true);
        const l = await D.loadLesson(c, 'l7');
        assert.strictEqual(l.html, '<p>автор</p>');
        assert.ok(gets.includes('/courses-content.php?course=a12&lesson=l7'));
        assert.ok(D.myCourses().some(x => x.code === 'a12'), 'курс с доступом есть на карте ученика');
        assert.strictEqual((await D.courseManifest(c)).forWhom, 'Бухгалтерам');
    });

    await t('авторский платный курс без «Доступа» закрыт', async () => {
        const { D } = portal({ tables: { 'Доступ': [] } });
        await D.init();
        assert.strictEqual(D.hasAccess(D.course('a12')), false);
        await assert.rejects(D.loadLesson(D.course('a12'), 'l7'));
    });

    await t('снятый с каталога курс собирается из манифеста, который отдаёт сервер', async () => {
        const { D, gets } = portal({ tables: { 'Доступ': [access('a99', undefined)] } });
        await D.init();
        const c = D.course('a99');
        assert.ok(c && c.title === 'Снятый курс' && c.lessons.length === 1);
        assert.ok(gets.includes('/courses-content.php?course=a99'));
    });

    await t('бесплатные курсы читаются как раньше, мимо сервера', async () => {
        const { D, gets } = portal({ tables: { 'Доступ': [] } });
        await D.init();
        assert.strictEqual(D.hasAccess(D.course('mini')), true);
        assert.strictEqual((await D.loadLesson(D.course('mini'), '00-start')).html, '<p>бесплатно</p>');
        assert.strictEqual(D.hasAccess(D.course('a5')), true);
        assert.strictEqual((await D.loadLesson(D.course('a5'), 'l2')).html, '<p>открытый урок</p>');
        assert.ok(!gets.some(u => u.includes('courses-content.php')), gets.join('\n'));
    });

    await t('гость: платный курс закрыт', async () => {
        const { D } = portal({ lms: { user: 'guest', userId: '1114', role: 'guest' } });
        await D.init();
        assert.strictEqual(D.hasAccess(D.course('adept')), false);
        assert.strictEqual(D.hasAccess(D.course('mini')), true);
    });

    await t('мок-режим (стенд без сервера): платный урок по ключу, как раньше', async () => {
        const { D, gets } = portal({ mock: true, tables: { 'Доступ': [access('adept', KEY)] } });
        await D.init();
        assert.strictEqual((await D.loadLesson(D.course('adept'), 'm1')).html, '<p>по ключу</p>');
        assert.ok(!gets.some(u => u.includes('courses-content.php')));
    });

    if (failed) { console.log('\n' + failed + ' failed'); process.exit(1); }
    console.log('\nall passed');
})();
