// Мерка к issue #5461: публичная афиша базы timepad (download/timepad/app.js).
// https://github.com/ideav/crm/issues/5461
//
// Поведение, на котором держится приватность регистраций:
//   1) гость создаёт билет одним _m_new в таблицу «Билет» (494) с первым полем «~<код>»:
//      маска гранта гостя «~%» пускает только такие записи, а триггер CREATE снимает «~»;
//   2) участник, событие, почта, телефон уходят в свои реквизиты того же _m_new — в SET-запросе
//      новый реквизит со знаками препинания портится (#5463);
//   3) совпадение кода (таблица уникальна, сервер отвечает warning «Запись уже существует»)
//      — повтор с НОВЫМ кодом, не больше 4 попыток;
//   4) остаток мест: без «Всего мест» — без ограничения, перебор продаж — ноль, не минус.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'download', 'timepad', 'app.js'), 'utf8');
const calls = [];
let replies = [];
global.fetch = function(url, opt){
    const body = opt && opt.body ? Object.fromEntries(new URLSearchParams(opt.body)) : null;
    calls.push({ url, method: opt && opt.method || 'GET', body, auth: opt && opt.headers && opt.headers['X-Authorization'] });
    const reply = replies.length ? replies.shift() : { id: 1 };
    return Promise.resolve({ status: 200, text: () => Promise.resolve(JSON.stringify(reply)) });
};
global.crypto = require('crypto').webcrypto;
const module_ = { exports: {} };
new Function('module', 'exports', src)(module_, module_.exports);
const tp = module_.exports;

let failures = 0;
async function check(name, fn){
    calls.length = 0; replies = [];
    try { await fn(); console.log('PASS: ' + name); }
    catch(e){ failures++; console.log('FAIL: ' + name + '\n  ' + (e && e.message)); }
}

(async () => {
    await check('билет — один _m_new в «Билет» с «~кодом» и реквизитами участника', async () => {
        replies = [{ id: 900, val: '~X' }];
        const code = await tp.create({ id: 668 }, 'XS', 'Анна Смирнова', 'anna@example.com', '+7 911 111-22-33', 0);
        assert.strictEqual(calls.length, 1, 'запросов: ' + calls.length);
        const c = calls[0];
        assert.strictEqual(c.method, 'POST');
        assert.strictEqual(c.url, '/timepad/_m_new/494?JSON');
        assert.strictEqual(c.auth, 'gtuoeksetn', 'запрос от гостя');
        assert.match(code, /^TP[A-Z2-9]{8}$/, 'код ' + code);
        assert.strictEqual(c.body.t494, '~' + code, 'первое поле = ~код');
        assert.strictEqual(c.body.t496, '668', 'событие');
        assert.strictEqual(c.body.t546, 'Анна Смирнова', 'участник');
        assert.strictEqual(c.body.t609, 'anna@example.com', 'почта');
        assert.strictEqual(c.body.t611, '+7 911 111-22-33', 'телефон');
        assert.strictEqual(c.body._xsrf, 'XS');
        assert.strictEqual(c.body.up, '1');
    });

    await check('пустой телефон не отправляется', async () => {
        replies = [{ id: 901 }];
        await tp.create({ id: 668 }, 'XS', 'Иван', 'i@example.com', '', 0);
        assert.ok(!('t611' in calls[0].body), 'телефон в теле: ' + JSON.stringify(calls[0].body));
    });

    await check('совпадение кода — повтор с новым кодом', async () => {
        replies = [{ id: 5, warning: 'Запись уже существует' }, { id: 902 }];
        const code = await tp.create({ id: 668 }, 'XS', 'Иван', 'i@example.com', '', 0);
        assert.strictEqual(calls.length, 2);
        assert.notStrictEqual(calls[0].body.t494, calls[1].body.t494, 'код повторён');
        assert.strictEqual(calls[1].body.t494, '~' + code);
    });

    await check('совпадения подряд — не больше 4 попыток и ошибка', async () => {
        replies = [1, 2, 3, 4, 5, 6].map(() => ({ id: 5, warning: 'Запись уже существует' }));
        await assert.rejects(tp.create({ id: 668 }, 'XS', 'Иван', 'i@example.com', '', 0));
        assert.strictEqual(calls.length, 4, 'попыток: ' + calls.length);
    });

    await check('ошибка сервера доходит до формы текстом', async () => {
        replies = [[{ error: 'У вас нет доступа к <b>объекту</b>' }]];
        await assert.rejects(tp.create({ id: 668 }, 'XS', 'Иван', 'i@example.com', '', 0), /нет доступа к объекту/);
    });

    await check('остаток мест', async () => {
        tp.state.sold = { 1: 3, 2: 12 };
        assert.strictEqual(tp.left({ id: 1, cap: 10 }), 7);
        assert.strictEqual(tp.left({ id: 2, cap: 10 }), 0, 'перебор — ноль');
        assert.strictEqual(tp.left({ id: 3, cap: 0 }), Infinity, 'без лимита');
        assert.strictEqual(tp.left({ id: 3, cap: 5 }), 5, 'нет продаж');
    });

    await check('склонение «место»', async () => {
        const f = n => tp.plural(n, 'место', 'места', 'мест');
        assert.deepStrictEqual([1, 2, 5, 11, 12, 21, 22, 25, 111, 104].map(f),
            ['место', 'места', 'мест', 'мест', 'мест', 'место', 'места', 'мест', 'мест', 'места']);
    });

    console.log(failures ? '\n' + failures + ' FAIL' : '\nALL PASS');
    if(failures) process.exitCode = 1;
})();
