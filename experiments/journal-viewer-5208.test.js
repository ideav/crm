// Мерка к ревью PR #5208 (вкладка «Журнал» в dir_admin, js/journal-viewer.js).
// Вкладка гоняется целиком на поддельном DOM и поддельном fetch: ответы сервера приходят в том
// порядке, в каком их отпускает тест. Проверяется, что видит пользователь и какой запрос уходит
// следующим, а не текст модуля.
//   • поздний ответ старого запроса не перезаписывает новый (смена режима / «Найти» во время чтения);
//   • «← Новее» / «Старее →» двигают стек курсоров только после успешного ответа;
//   • строки, отобранные сервером по where, не досеиваются на клиенте (JSON PHP ≠ JSON JS: 12.0, {});
//   • CSV: разделитель «;» (русский Excel) и обезвреженные формулы (= + - @ \t \r в начале строки).

const test = require('node:test');
const assert = require('node:assert');
const api = require('../js/journal-viewer.js');

// ---- поддельный DOM: ровно то, чем пользуется модуль ----
class FakeEl {
    constructor(tag) {
        this.tagName = String(tag).toUpperCase();
        this.children = [];
        this.parentNode = null;
        this.className = '';
        this._text = '';
        this.value = '';
        this.disabled = false;
        this.listeners = {};
    }
    get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
    set textContent(v) { this._text = String(v); this.children.forEach(c => { c.parentNode = null; }); this.children = []; }
    get nextSibling() {
        if (!this.parentNode) return null;
        const sib = this.parentNode.children;
        return sib[sib.indexOf(this) + 1] || null;
    }
    appendChild(c) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; this.children.push(c); return c; }
    removeChild(c) { this.children.splice(this.children.indexOf(c), 1); c.parentNode = null; return c; }
    insertBefore(c, ref) {
        if (!ref) return this.appendChild(c);
        c.parentNode = this; this.children.splice(this.children.indexOf(ref), 0, c); return c;
    }
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
    fire(type, ev) { (this.listeners[type] || []).forEach(fn => fn(ev || {})); }
    click() { if (!this.disabled) this.fire('click'); }
    findAll(pred, out = []) { this.children.forEach(c => { if (pred(c)) out.push(c); c.findAll(pred, out); }); return out; }
}

function mount() {
    const host = new FakeEl('div');
    const calls = [];
    global.document = {
        createElement: tag => new FakeEl(tag),
        getElementById: () => host,
        body: new FakeEl('body')
    };
    global.fetch = url => new Promise(resolve => { calls.push({ url, resolve }); });
    api.init({ db: 'acme', container: 'journal-viewer' });
    const [bar, nav, status, wrap] = host.children;
    const ui = {
        host, calls, status, wrap,
        modeSel: bar.children[0], condBox: bar.children[1], addBtn: bar.children[2], applyBtn: bar.children[3],
        newer: nav.children[0], older: nav.children[1],
        rows: () => wrap.findAll(n => n.className === 'jv-row'),
        heads: () => wrap.findAll(n => n.tagName === 'TH').map(n => n.textContent),
        param: (i, name) => new URL('http://x' + calls[i].url).searchParams.get(name)
    };
    return ui;
}

const flush = () => new Promise(r => setImmediate(r));
async function reply(ui, i, status, body) {
    ui.calls[i].resolve({ status, text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)) });
    for (let k = 0; k < 5; k++) await flush();
}
const page = (rows, next) => ({ rows, more: !!next, next: next || null });

test('смена режима во время чтения: поздний ответ старого режима не перезаписывает новый', async () => {
    const ui = mount();
    ui.host.start();
    assert.strictEqual(ui.param(0, 'mode'), 'log');
    ui.modeSel.value = 'sql';
    ui.modeSel.fire('change');
    assert.strictEqual(ui.param(1, 'mode'), 'sql');

    await reply(ui, 1, 200, page([{ op: 'U', t: 18 }], 'acme_sql.1.jsonl:10'));
    await reply(ui, 0, 200, page([{ path: '/acme/x' }], 'acme_log.1.jsonl:5'));

    assert.ok(ui.heads().includes('op'), 'на экране страница изменений данных, а не запросов: ' + ui.heads());
    ui.older.click();
    assert.strictEqual(ui.calls.length, 3, '«Старее →» ушёл на сервер');
    assert.strictEqual(ui.param(2, 'mode'), 'sql');
    assert.strictEqual(ui.param(2, 'cursor'), 'acme_sql.1.jsonl:10', 'курсор своего режима, иначе сервер ответит «Неверный курсор журнала»');
});

test('«Найти» во время чтения: на экране ответ последнего поиска', async () => {
    const ui = mount();
    ui.host.start();
    ui.addBtn.click();
    const [f, op, v] = ui.condBox.children[0].children;
    f.value = 'user'; op.value = 'eq'; v.value = 'ivanov';
    ui.applyBtn.click();
    assert.strictEqual(ui.calls.length, 2);

    await reply(ui, 1, 200, page([{ user: 'ivanov' }]));
    await reply(ui, 0, 200, page([{ user: 'ivanov', st: 200 }, { user: 'ivanov', st: 500 }], 'acme_log.1.jsonl:5'));
    assert.strictEqual(ui.rows().length, 1, 'ответ первого (без условий) запроса пришёл позже и не должен затереть поиск');
});

test('«← Новее» с ошибкой: повтор идёт за той же страницей, стек не теряет курсор', async () => {
    const ui = mount();
    ui.host.start();
    await reply(ui, 0, 200, page([{ a: 1 }], 'c1'));
    ui.older.click();
    await reply(ui, 1, 200, page([{ a: 2 }], 'c2'));
    ui.older.click();
    await reply(ui, 2, 200, page([{ a: 3 }], 'c3'));
    assert.strictEqual(ui.param(2, 'cursor'), 'c2');

    ui.newer.click();
    assert.strictEqual(ui.param(3, 'cursor'), 'c1');
    await reply(ui, 3, 500, 'boom');
    assert.ok(!ui.newer.disabled, 'после ошибки назад всё ещё можно');
    ui.newer.click();
    assert.strictEqual(ui.param(4, 'cursor'), 'c1', 'повтор «← Новее» — та же страница c1, а не начало журнала');
});

test('«Старее →» с ошибкой: «← Новее» ведёт на страницу новее показанной, а не на неё же', async () => {
    const ui = mount();
    ui.host.start();
    await reply(ui, 0, 200, page([{ a: 1 }], 'c1'));
    ui.older.click();
    await reply(ui, 1, 200, page([{ a: 2 }], 'c2'));
    ui.older.click();
    assert.strictEqual(ui.param(2, 'cursor'), 'c2');
    await reply(ui, 2, 500, 'boom');
    ui.newer.click();
    assert.strictEqual(ui.calls.length, 4);
    assert.strictEqual(ui.param(3, 'cursor'), null, 'показана была страница c1, новее неё — начало журнала');
});

test('строки, отобранные сервером по where, клиент не выкидывает (12.0 и {} в записи PHP)', async () => {
    const ui = mount();
    ui.host.start();
    await reply(ui, 0, 200, page([]));
    ui.addBtn.click();
    const [f, op, v] = ui.condBox.children[0].children;
    f.value = 'ms'; op.value = 'contains'; v.value = '12.0';
    ui.applyBtn.click();
    assert.deepStrictEqual(JSON.parse(ui.param(1, 'where')), [{ f: 'ms', op: 'contains', v: '12.0' }], 'условие ушло на сервер');
    // сервер (json_encode PHP) увидел в ms «12.0» и в params «[]» — строки подходят
    await reply(ui, 1, 200, '{"rows":[{"ms":12.0,"params":{}},{"ms":12.05,"params":{}}],"more":false,"next":null}');
    assert.strictEqual(ui.rows().length, 2, 'все строки ответа сервера на экране');
});

test('CSV: разделитель «;» — русский Excel раскладывает по столбцам', () => {
    const csv = api.toCsv([{ a: 'x;y', b: '1,5', c: 7 }], ['a', 'b', 'c']);
    assert.strictEqual(csv, 'a;b;c\r\n"x;y";"1,5";7');
});

test('CSV: строка, которую Excel принял бы за формулу, обезврежена апострофом', () => {
    const rows = [{ a: '=HYPERLINK("http://e.vil","x")', b: '+1+1', c: '-2+3', d: '@SUM(A1)', e: '\tx', f: '\r=1' }];
    const csv = api.toCsv(rows, ['a', 'b', 'c', 'd', 'e', 'f']);
    const cells = csv.split('\r\n').slice(1).join('\r\n');
    assert.strictEqual(cells, '"\'=HYPERLINK(""http://e.vil"",""x"")";\'+1+1;\'-2+3;\'@SUM(A1);\'\tx;"\'\r=1"');
    // числа — не формулы: отрицательное число остаётся числом
    assert.strictEqual(api.toCsv([{ n: -5, s: 'ok' }], ['n', 's']).split('\r\n')[1], '-5;ok');
});
