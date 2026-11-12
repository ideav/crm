// ideav/courses#93: авторские курсы в LMS ideav.ru/cources — поиск по каталогу и сборка lesson.json
// из черновика урока (download/cources/js/authors.js).
// - поиск: без регистра, ё = е, все слова запроса (И), по названию/описанию/автору/тегам/урокам;
// - хэш правильного ответа теста = sha256(<id урока>:<номер вопроса>:<буква>) — ровно то, что сверяет quiz.js;
// - в собранном уроке нет поля answer, внешние ссылки открываются в новой вкладке, файлы ответа — по белому списку;
// - курс ждёт модератора, пока «На проверку» позже «Опубликован».
//
// Run with: node experiments/cources-authors-93.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const dir = path.join(__dirname, '..', 'download', 'cources', 'js');
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const ctx = {
    console,
    window: {},
    // DOMPurify в node без DOM не работает: заглушка вырезает <script> и on*-атрибуты, чтобы проверить, что
    // сборка урока вообще зовёт санитайзер (настоящий DOMPurify проверяется в браузере, мок-режим).
    DOMPurify: null,
};
ctx.window = ctx;
ctx.DOMPurify = {
    calls: 0,
    addHook() {},
    sanitize(html) { this.calls++; return String(html).replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\son\w+="[^"]*"/gi, ''); },
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(dir, 'vendor', 'marked-18.0.5.umd.js'), 'utf8'), ctx);
assert.ok(ctx.marked && ctx.marked.parse, 'marked из vendor/ поднимается как глобальный объект');
ctx.LMSApp = { sha256: s => Promise.resolve(sha(s)) };
vm.runInContext(fs.readFileSync(path.join(dir, 'authors.js'), 'utf8'), ctx);
const AU = ctx.LMSApp.au;

let failed = 0;
async function t(name, fn) {
    try { await fn(); console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + e.message); }
}

(async () => {
    const courses = [
        { code: 'mini', title: 'Мини-курс', free: true, desc: 'Первое приложение из Excel', author: 'Интеграм', tags: ['ИИ-агент'], lessons: [{ title: 'Таблицы и реквизиты' }] },
        { code: 'a1', title: 'Учёт заказов пекарни', free: true, desc: 'Ёмкости и сроки', author: 'Мария Петрова', tags: ['пекарня', 'учёт'], lessons: [{ title: 'Заказы и клиенты' }] },
        { code: 'a2', title: 'CRM для автосервиса', free: false, price: 4900, desc: 'Запчасти', author: 'Иван Сидоров', tags: ['CRM'], lessons: [{ title: 'Запись на ремонт' }] },
    ];
    const codes = f => AU.filter(courses, f).map(c => c.code).join(',');

    await t('поиск без регистра и с ё = е', () => {
        assert.strictEqual(codes({ q: 'УЧЕТ' }), 'a1');
        assert.strictEqual(codes({ q: 'емкости' }), 'a1');
        assert.strictEqual(codes({ q: 'Ёмкости' }), 'a1');
    });
    await t('все слова запроса должны найтись (И), в любом поле', () => {
        assert.strictEqual(codes({ q: 'пекарни петрова' }), 'a1', 'название + автор');
        assert.strictEqual(codes({ q: 'пекарни сидоров' }), '', 'слова из разных курсов не дают совпадения');
        assert.strictEqual(codes({ q: 'ремонт' }), 'a2', 'по названию урока');
        assert.strictEqual(codes({ q: 'ии-агент' }), 'mini', 'по тегу');
        assert.strictEqual(codes({ q: '   ' }), 'mini,a1,a2', 'пустой запрос — все');
    });
    await t('фильтр цены и тега', () => {
        assert.strictEqual(codes({ price: 'free' }), 'mini,a1');
        assert.strictEqual(codes({ price: 'paid' }), 'a2');
        assert.strictEqual(codes({ tag: 'crm' }), 'a2');
        assert.strictEqual(codes({ tag: 'учет', q: 'заказ' }), 'a1');
    });

    await t('строка «Каталога» → курс: цена 0 = бесплатно, уроки из JSON, видимость', () => {
        const c = AU.fromCatalog({ _id: '7', _main: 'a12', 'Название': 'Курс', 'Цена': '0', 'Теги': 'а, б, А', 'Уроки': '[{"id":"l3","n":1,"title":"Урок"}]', 'Видимость': 'ссылка', 'Обложка': 'javascript:alert(1)', 'Ссылка оплаты': 'http://pay' });
        assert.strictEqual(c.free, true);
        assert.strictEqual(c.lessons[0].id, 'l3');
        assert.deepStrictEqual(Array.from(c.tags), ['а', 'б'], 'теги без дублей');
        assert.strictEqual(c.visibility, 'ссылка');
        assert.strictEqual(c.cover, '', 'опасный адрес обложки отбрасывается');
        assert.strictEqual(c.payUrl, '', 'ссылка оплаты только https');
        assert.strictEqual(AU.fromCatalog({ _main: 'a1', 'Цена': '4900', 'Уроки': 'битый' }).free, false);
    });

    await t('сборка урока: хэш теста как в quiz.js, без answer, prev/next', async () => {
        const rows = [
            { _id: '31', _main: 'Второй', 'Порядок': '2', 'Текст': 'b', 'Задания': '[]' },
            { _id: '30', _main: 'Первый', 'Порядок': '1', 'Текст': '## Привет\n\n[сайт](https://example.com) и [свой](/cources/)<script>alert(1)</script>',
              'Задания': JSON.stringify([{ kind: 'quiz', pass: 0.5, questions: [
                  { q: 'Где **заказы**?', options: [{ k: 'а', text: 'В таблице' }, { k: 'б', text: 'В файлах' }, { k: 'в', text: '' }], answer: 'б', explain: 'Так' }] },
                  { kind: 'file', prompt: 'Файл', accept: '.html,.pdf,svg', max: 50 },
                  { kind: 'selfcheck', items: ['Сделал', ''] }]) },
        ];
        const d = AU.drafts('a5', rows);
        assert.deepStrictEqual(d.map(x => x.id), ['l30', 'l31'], 'порядок по «Порядок», id = l<строка>');
        assert.strictEqual(d[0].next, 'l31'); assert.strictEqual(d[1].prev, 'l30'); assert.strictEqual(d[0].prev, null);
        const lj = await AU.buildLesson(d[0]);
        assert.strictEqual(lj.id, 'l30'); assert.strictEqual(lj.course, 'a5');
        const q = lj.tasks[0];
        assert.strictEqual(q.questions[0].hash, sha('l30:0:б'), 'hash = sha256(урок:вопрос:буква)');
        assert.ok(!('answer' in q.questions[0]), 'правильная буква не попадает в урок');
        assert.ok(!JSON.stringify(lj).includes('"answer"'));
        assert.strictEqual(q.questions[0].options.length, 2, 'пустой вариант отброшен');
        assert.strictEqual(q.pass, 0.5);
        assert.ok(/<strong>заказы<\/strong>/.test(q.questions[0].q), 'markdown в вопросе');
        assert.ok(!/<script/i.test(lj.html), 'html прошёл санитайзер');
        assert.ok(/href="https:\/\/example\.com" target="_blank" rel="noopener"/.test(lj.html), 'внешняя ссылка — в новой вкладке: ' + lj.html);
        assert.ok(!/href="\/cources\/"[^>]*target/.test(lj.html), 'своя ссылка — без target');
        assert.strictEqual(lj.tasks[1].accept, '.pdf', '.html/.svg выброшены из белого списка');
        assert.strictEqual(lj.tasks[1].max, 10);
        assert.deepStrictEqual(Array.from(lj.tasks[2].items), ['Сделал']);
        assert.deepStrictEqual(Array.from(lj.attachments), []);
        assert.strictEqual(AU.mainKind(lj.tasks), 'file');
    });

    await t('проверка черновика заданий: нет правильного ответа / вариантов / пунктов', () => {
        const p = AU.taskProblems([{ kind: 'quiz', questions: [{ q: 'x', options: [{ k: 'а', text: '1' }, { k: 'б', text: '2' }], answer: '' }] }, { kind: 'selfcheck', items: [] }, { kind: 'html' }]);
        assert.strictEqual(p.length, 3, p.join(' | '));
        assert.deepStrictEqual(Array.from(AU.taskProblems([{ kind: 'quiz', questions: [{ q: 'x', options: [{ k: 'а', text: '1' }, { k: 'б', text: '2' }], answer: 'а' }] }, { kind: 'text' }])), []);
    });

    await t('курс ждёт проверки, пока «На проверку» позже «Опубликован»', () => {
        assert.strictEqual(AU.pending({ 'На проверку': '' }), false);
        assert.strictEqual(AU.pending({ 'На проверку': '10.11.2026 12:00:00' }), true);
        assert.strictEqual(AU.pending({ 'На проверку': '10.11.2026 12:00:00', 'Опубликован': '10.11.2026 12:05:00' }), false);
        assert.strictEqual(AU.pending({ 'На проверку': '11.11.2026 09:00', 'Опубликован': '10.11.2026 12:05:00' }), true);
        assert.strictEqual(AU.pending({ 'На проверку': String(Math.floor(Date.UTC(2026, 10, 11) / 1000)), 'Опубликован': '01.11.2026 00:00:00' }), true, 'unix-время');
        assert.strictEqual(AU.statusOf({ 'На проверку': '11.11.2026 09:00', 'Статус': 'отклонён' }), 'на проверке');
        assert.strictEqual(AU.statusOf({}), 'черновик');
    });

    await t('обложка: только png/jpg/webp до 2 МБ', () => {
        assert.strictEqual(AU.coverError({ name: 'a.PNG', type: 'image/png', size: 10 }), '');
        assert.ok(AU.coverError({ name: 'a.svg', type: 'image/svg+xml', size: 10 }));
        assert.ok(AU.coverError({ name: 'a.html', type: 'text/html', size: 10 }));
        assert.ok(AU.coverError({ name: 'a.jpg', type: 'image/jpeg', size: 3 * 1048576 }));
    });

    await t('урок из файла ещё раз проходит санитайзер при показе', () => {
        const before = ctx.DOMPurify.calls;
        const l = AU.cleanLesson({ id: 'l1', html: '<p onclick="x()">a</p>', tasks: [{ kind: 'quiz', questions: [{ q: '<script>1</script>q', options: [{ k: 'а', text: 't' }] }] }, { kind: 'practicum', spec: 'p1' }], attachments: [{ url: 'javascript:1' }] });
        assert.ok(ctx.DOMPurify.calls > before);
        assert.ok(!/onclick/.test(l.html));
        assert.ok(!/script/.test(l.tasks[0].questions[0].q));
        assert.strictEqual(l.tasks.length, 1, 'practicum в авторском курсе не поддерживается');
        assert.strictEqual(l.attachments.length, 0);
    });

    console.log(failed ? `\n${failed} FAILED` : '\nall passed');
    process.exit(failed ? 1 : 0);
})();
