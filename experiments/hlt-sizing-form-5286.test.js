// Гейт-тест формы калькулятора docs/hlt-stand/sizing.html (issue #5286):
//   1) все выпадающие списки при открытии стоят на минимальном значении;
//   2) выбранное «Строк в срезе» не сбрасывается при смене самого среза и соседних полей;
//   3) срез не больше таблицы: в списке только срезы меньше выбранного числа строк + «вся таблица».
// Исполняется настоящий <script> страницы на модели <select> с поведением браузера:
// значение по умолчанию — option[selected] или первый, присвоение несуществующего значения игнорируется.
//
// Run with: node experiments/hlt-sizing-form-5286.test.js [путь к sizing.html]

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, total = 0;
function assertTrue(ok, name, detail) {
    total++;
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; }
    else { console.log('  ' + detail); process.exitCode = 1; }
}

const pagePath = process.argv[2] || path.join(__dirname, '..', 'docs', 'hlt-stand', 'sizing.html');
const page = fs.readFileSync(pagePath, 'utf8');

// заглушка «на всё остальное»: любое свойство/вызов возвращает себя
function anyEl() {
    const store = { style: {}, dataset: {}, hidden: true, innerHTML: '', textContent: '' };
    const f = new Proxy(function () {}, {
        get(t, p) {
            if (p in store) return store[p];
            if (p === 'viewBox') return { baseVal: { width: 720, height: 330 } };
            if (p === 'getBoundingClientRect') return () => ({ width: 720, left: 0 });
            return f;
        },
        set(t, p, v) { store[p] = v; return true; },
        apply() { return f; }
    });
    return f;
}

// <select> с поведением браузера
function makeSelect(id, html) {
    const listeners = {};
    const sel = {
        id, style: {}, options: [], _value: null,
        get value() { return this._value !== null ? this._value : (this.options[0] ? this.options[0].value : ''); },
        set value(v) { v = String(v); if (this.options.some(o => o.value === v)) this._value = v; },
        get innerHTML() { return ''; },
        set innerHTML(v) { this.options = []; this._value = null; parseOptions(this, v); },
        appendChild(o) { this.options.push(o); if (o.selected && this._value === null) this._value = o.value; return o; },
        querySelector(q) {
            const m = q.match(/option\[value="([^"]*)"\]/);
            return m ? (this.options.find(o => o.value === m[1]) || null) : null;
        },
        addEventListener(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
        fire(ev) { (listeners[ev] || []).forEach(fn => fn({ target: sel })); },
    };
    parseOptions(sel, html);
    return sel;
}
function parseOptions(sel, html) {
    const re = /<option([^>]*)>([^<]*)<\/option>/g;
    let m;
    while ((m = re.exec(html || ''))) {
        const vm_ = m[1].match(/value="([^"]*)"/);
        sel.appendChild({ value: vm_ ? vm_[1] : m[2].trim(), textContent: m[2], selected: /\bselected\b/.test(m[1]) });
    }
}

function load() {
    const ids = {};
    const selRe = /<select id="(\w+)">([\s\S]*?)<\/select>/g;
    let m;
    while ((m = selRe.exec(page))) ids[m[1]] = makeSelect(m[1], m[2]);
    const coresM = page.match(/<input id="cores"[^>]*value="(\d+)"/);
    ids.cores = Object.assign(anyEl(), {});
    ids.cores.value = coresM ? coresM[1] : '2';
    ids.cores.addEventListener = () => {};
    const sandbox = {
        document: {
            getElementById: id => ids[id] || (ids[id] = anyEl()),
            querySelectorAll: () => [],
            createElement: () => ({ _v: '', get value() { return this._v; }, set value(v) { this._v = String(v); },
                textContent: '', selected: false }),
            createElementNS: () => anyEl()
        },
        console: { log: () => {} }
    };
    const script = page.match(/<script>([\s\S]*)<\/script>/)[1];
    vm.createContext(sandbox);
    vm.runInContext(script, sandbox);
    return ids;
}

const minOf = s => s.options.reduce((a, o) => {
    const v = +o.value;  // «вся таблица» = -1 — это максимум, не минимум
    return v >= 0 && (a === null || v < a) ? v : a;
}, null);

let ids = null;
try { ids = load(); assertTrue(true, 'скрипт страницы исполняется на модели формы', ''); }
catch (e) { assertTrue(false, 'скрипт страницы исполняется на модели формы', e.stack); }

if (ids) {
    // 1) при открытии — минимальные значения
    const chk = (where) => ['join', 'nrows', 'slice', 'threads'].forEach(k => {
        const s = ids[k];
        if (!s.options.length) return;
        assertTrue(+s.value === minOf(s), where + ': «' + k + '» стоит на минимуме',
            'значение ' + s.value + ', минимум ' + minOf(s));
    });
    chk('при открытии');
    // 2) выбор среза держится
    ['sel', 'agg'].forEach(o => {
        ids.op.value = o; ids.op.fire('change');
        if (o === 'agg') { ids.nrows.value = '1000000'; ids.nrows.fire('change'); }
        ids.slice.options.forEach(opt => {
            ids.slice.value = opt.value; ids.slice.fire('change');
            assertTrue(ids.slice.value === opt.value, o + ': выбранный срез ' + opt.value + ' держится после change',
                'стало ' + ids.slice.value);
        });
        const pick = ids.slice.options[ids.slice.options.length > 1 ? 1 : 0].value;
        ids.slice.value = pick; ids.slice.fire('change');
        ids.threads.value = ids.threads.options[ids.threads.options.length - 1].value; ids.threads.fire('change');
        assertTrue(ids.slice.value === pick, o + ': срез ' + pick + ' держится при смене потоков',
            'стало ' + ids.slice.value);
    });

    // 3) срез не больше таблицы
    ids.op.value = 'agg'; ids.op.fire('change');
    ids.nrows.options.forEach(n => {
        ids.nrows.value = n.value; ids.nrows.fire('change');
        const over = ids.slice.options.filter(o => +o.value >= +n.value);
        const whole = ids.slice.options.filter(o => +o.value < 0);
        assertTrue(over.length === 0 && whole.length === 1,
            'таблица ' + n.value + ': срезы меньше таблицы + «вся таблица»',
            'лишние: ' + over.map(o => o.value).join(', ') + '; «вся таблица»: ' + whole.length);
    });
}

console.log('\n' + passed + '/' + total + ' проверок пройдено');
