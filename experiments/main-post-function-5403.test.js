// ideav/crm#5403: функция post(a) есть в рабочих местах на templates/main.html,
// как на странице отчёта (templates/report.html). Кнопки колонок-действий отчёта
// onclick="post('_m_new/…')" должны отправлять POST на /<база>/<a> с текущим xsrf.
// Проверка поведенческая: блок глобалов main.html исполняется в vm с поддельным DOM.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const html = fs.readFileSync(path.join(__dirname, '..', 'templates', 'main.html'), 'utf8');

// Блок глобальных переменных страницы — тот, где объявлена переменная db.
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const globals = blocks.find(b => /var db\s*=/.test(b));
assert(globals, 'не найден блок глобалов main.html');

const values = { z: 'demo', xsrf: 'X1', grants: Buffer.from('{}').toString('base64') };
const src = globals
    .replace(/\{_global_\.(\w+)\}/g, (m, k) => (k in values ? values[k] : ''))
    .replace(/<!--[\s\S]*?-->/g, '');

function makeContext(existingForm) {
    const submitted = [];
    const appended = [];
    function makeEl(tag) {
        const el = { tagName: tag, style: {}, children: [], appendChild(c) { this.children.push(c); if (c.name) this[c.name] = c; } };
        if (tag === 'form') el.submit = function () { submitted.push({ action: this.action, method: this.method, xsrf: this._xsrf && this._xsrf.value }); };
        return el;
    }
    let form = existingForm ? makeEl('form') : null;
    if (form) { form.method = 'POST'; form.id = 'post'; const x = makeEl('input'); x.name = '_xsrf'; x.value = 'OLD'; form.appendChild(x); }
    const document = {
        getElementById(id) { return id === 'post' ? form : null; },
        createElement: makeEl,
        body: { appendChild(el) { appended.push(el); if (el.id === 'post') form = el; } },
    };
    let prevented = 0;
    const ctx = { document, atob: s => Buffer.from(s, 'base64').toString('utf8'), JSON };
    ctx.window = ctx;
    ctx.window.event = { preventDefault() { prevented++; } };
    vm.createContext(ctx);
    vm.runInContext(src, ctx);
    return { ctx, submitted, appended, prevented: () => prevented };
}

let failed = 0;
function check(name, fn) {
    try { fn(); console.log('ok   ' + name); }
    catch (e) { failed++; console.log('FAIL ' + name + ': ' + e.message); }
}

check('post определена в main.html', () => {
    const { ctx } = makeContext(false);
    assert.strictEqual(typeof ctx.post, 'function');
});

check('без формы #post: создаёт форму и шлёт POST на /<база>/<a> с xsrf', () => {
    const t = makeContext(false);
    t.ctx.post('_m_new/3536?t3540=3549&up=17');
    assert.strictEqual(t.submitted.length, 1);
    assert.strictEqual(t.submitted[0].action, '/demo/_m_new/3536?t3540=3549&up=17');
    assert.strictEqual(String(t.submitted[0].method).toUpperCase(), 'POST');
    assert.strictEqual(t.submitted[0].xsrf, 'X1');
    assert.strictEqual(t.prevented(), 1);
});

check('повторный вызов не дописывает адрес к прежнему', () => {
    const t = makeContext(false);
    t.ctx.post('_m_new/1?up=1');
    t.ctx.post('_m_new/2?up=1');
    assert.strictEqual(t.submitted[1].action, '/demo/_m_new/2?up=1');
    assert.strictEqual(t.appended.length, 1, 'форма создаётся один раз');
});

check('xsrf берётся текущий (после обновления переменной xsrf)', () => {
    const t = makeContext(true);
    vm.runInContext("xsrf = 'X2'", t.ctx);
    t.ctx.post('_m_new/1?up=1');
    assert.strictEqual(t.submitted[0].xsrf, 'X2');
});

if (failed) { console.log(failed + ' FAIL'); process.exitCode = 1; } else console.log('PASS');
