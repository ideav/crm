// ideav/courses#26: успешная регистрация на start.html — цель Метрики reg_ok; пришёл с лендинга
// курсов (cookie ig_src=kurs-agents ставит кнопка «Стать агентом» на ideav.ru/kurs/) — ещё и
// kurs_agent_reg. Метка снимается после регистрации. Нет Метрики (on-prem) — регистрация не падает.
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('js/app.js', 'utf8');
function slice(from, to) {
    const s = source.indexOf(from);
    assert.ok(s >= 0, `в js/app.js нет «${from}»`);
    return source.slice(s, source.indexOf(to, s));
}
const code = slice('const CookieUtil = {', '// ===') + slice('const REG_METRIKA_ID', '// ===');

function run(cookie, withYm = true, ymThrows = false) {
    const calls = [];
    const jar = { value: cookie };
    const document = {};
    Object.defineProperty(document, 'cookie', {
        get: () => jar.value,
        set: v => { // снятие куки: имя=; expires=1970 → убрать из jar
            const name = v.split('=')[0];
            if (/expires=Thu, 01 Jan 1970/.test(v)) {
                jar.value = jar.value.split('; ').filter(c => !c.startsWith(name + '=')).join('; ');
            }
        },
    });
    const window = {};
    if (withYm) window.ym = (...a) => { if (ymThrows) throw new Error('ym'); calls.push(a); };
    const ctx = { window, document, console };
    vm.createContext(ctx);
    vm.runInContext(code + '; reachRegistrationGoal();', ctx);
    return { calls, cookie: jar.value };
}

// с лендинга курсов
let r = run('_aff=77; ig_src=kurs-agents');
assert.deepStrictEqual(r.calls.map(c => c[2]), ['reg_ok', 'kurs_agent_reg'], 'с лендинга: обе цели');
assert.ok(r.calls.every(c => c[0] === 108758829 && c[1] === 'reachGoal'), 'цели — на счётчик ideav.ru');
assert.deepStrictEqual(JSON.parse(JSON.stringify(r.calls[0][3])), { src: 'kurs-agents' }, 'reg_ok несёт источник');
assert.strictEqual(r.cookie, '_aff=77', 'метка ig_src снята, aff не тронут');

// обычная регистрация
r = run('_aff=77');
assert.deepStrictEqual(r.calls.map(c => c[2]), ['reg_ok'], 'без метки: только reg_ok');

// другой источник — не агент
r = run('ig_src=kurs-adept');
assert.deepStrictEqual(r.calls.map(c => c[2]), ['reg_ok'], 'чужой источник: kurs_agent_reg не ставится');

// без Метрики и со сбоем Метрики регистрация не падает, метка всё равно снимается
assert.strictEqual(run('ig_src=kurs-agents', false).cookie, '', 'без ym: метка снята');
assert.strictEqual(run('ig_src=kurs-agents', true, true).cookie, '', 'ym бросает: не падаем, метка снята');

console.log('start-reg-goal-courses26: ok');
