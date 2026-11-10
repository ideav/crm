// Мерка: сводный кабинет партнёров в базе my (рабочее место админа и директора).
//
// Три уровня: все партнёры → клиенты партнёра → карточка клиента. Данные — отчёты
// adminPartners, adminClients, adminEvents (формат JSON_KV: массив объектов, значения строками).
// Браузерные файлы (не CommonJS) грузятся чтением и eval; проверяется поведение:
//   1) разбор строк отчётов в партнёров и клиентов; пустой или ошибочный ответ — пустые списки;
//   2) воронка по этапам, итоги, сигналы (выплата, нет экзамена, 3 прямых обращения, конец триала);
//   3) фильтры списка партнёров; 4) отрисовка пишет только текст, переход по клику на партнёра и клиента;
//   5) загрузка событий клиента — запросом отчёта с фильтром FR_ClientID.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
global.window = globalThis;
for (const f of ['js/partner-cabinet.js', 'js/partner-admin.js'])
    (0, eval)(fs.readFileSync(path.join(root, f), 'utf8'));

let failures = 0;
function check(name, fn) {
    try { fn(); console.log('PASS: ' + name); } catch (e) { failures++; console.log('FAIL: ' + name + '\n  ' + e.message); }
}
const A = window.PartnerAdmin;
const NOW = new Date(2026, 10, 10);

const P_ROWS = [
    { PartnerID: '1', Name: 'Алексей К.', Reg: '01.11.2026', ExamPassed: '1', ExamScore: '90', ExamDate: '08.11.2026', Opens: '41', BotStarts: '5', Flows: '4', Earned: '12500', Payable: '5000', LastActive: '10.11.2026 09:12', Minutes: '184' },
    { PartnerID: '2', Name: 'Мария С.', Reg: '02.11.2026', ExamPassed: '1', ExamScore: '85', ExamDate: '07.11.2026', Opens: '23', BotStarts: '3', Flows: '2', Earned: '5000', Payable: '5000', LastActive: '09.11.2026 18:40', Minutes: '96' },
    { PartnerID: '3', Name: 'Игорь Т.', Reg: '03.11.2026', ExamPassed: '0', ExamScore: '', ExamDate: '', Opens: '9', BotStarts: '2', Flows: '0', Earned: '0', Payable: '0', LastActive: '08.11.2026 12:05', Minutes: '41' },
    { PartnerID: '5', Name: 'Денис Р.', Reg: '06.11.2026', ExamPassed: '0', ExamScore: '75', ExamDate: '09.11.2026', Opens: '5', BotStarts: '1', Flows: '1', Earned: '0', Payable: '0', LastActive: '09.11.2026 21:10', Minutes: '55' }
];
const C_ROWS = [
    { ClientID: '11', PartnerID: '1', Client: 'ООО «Пример-1»', Came: '03.11.2026', Stage: '4', TrialStart: '03.11.2026', LastActive: '10.11.2026 08:50', DirectCount: '0', Paid: '0', Bases: '1', Records: '420', Tokens: '1800' },
    { ClientID: '12', PartnerID: '1', Client: 'ИП Клиент-2', Came: '29.10.2026', Stage: '5', TrialStart: '29.10.2026', LastActive: '09.11.2026 15:02', DirectCount: '1', Paid: '1', Bases: '2', Records: '3100', Tokens: '5200' },
    { ClientID: '14', PartnerID: '2', Client: 'ООО «Склад-М»', Came: '06.11.2026', Stage: '3', TrialStart: '06.11.2026', LastActive: '09.11.2026 10:15', DirectCount: '3', Paid: '0', Bases: '1', Records: '150', Tokens: '600' },
    { ClientID: '16', PartnerID: '3', Client: 'ООО «Пример-6»', Came: '01.11.2026', Stage: '1', TrialStart: '28.10.2026', LastActive: '05.11.2026 14:02', DirectCount: '0', Paid: '0', Bases: '0', Records: '0', Tokens: '0' }
];

check('партнёры: поля, статус экзамена (сдан / не сдан с баллом / не сдавал)', () => {
    const p = A.readPartners(P_ROWS);
    assert.strictEqual(p.length, 4);
    assert.strictEqual(p[0].id, '1');
    assert.strictEqual(p[0].earned, 12500);
    assert.strictEqual(p[0].payable, 5000);
    assert.deepStrictEqual(p.map(x => x.exam), ['passed', 'passed', 'none', 'failed']);
    assert.strictEqual(p[3].score, 75);
});
check('клиенты: этап ограничен 1–5, оплата — булево, числа — числами', () => {
    const c = A.readClients(C_ROWS.concat([{ ClientID: '99', PartnerID: '1', Client: 'X', Stage: '9', Paid: '0' }, { ClientID: '98', PartnerID: '1', Client: 'Y', Stage: '', Paid: '0' }]));
    assert.strictEqual(c[1].paid, true);
    assert.strictEqual(c[0].records, 420);
    assert.strictEqual(c[4].stage, 5);
    assert.strictEqual(c[5].stage, 1);
});
check('пустой или ошибочный ответ — пустые списки, а не исключение', () => {
    for (const bad of [null, undefined, {}, 'x', [{}], [null]]) {
        assert.deepStrictEqual(A.readPartners(bad), []);
        assert.deepStrictEqual(A.readClients(bad), []);
        assert.deepStrictEqual(A.readEvents(bad), []);
    }
});

check('воронка: сколько клиентов дошло до каждого этапа', () => {
    const f = A.funnel(A.readClients(C_ROWS));
    assert.deepStrictEqual(f.map(s => s.count), [4, 3, 3, 2, 1]);
    assert.strictEqual(f[0].label, 'Открыл материал');
    assert.strictEqual(f[4].label, 'Оплатил');
});
check('итоги: партнёры, сдавшие экзамен, клиенты в триале и оплатившие, суммы', () => {
    const t = A.totals(A.readPartners(P_ROWS), A.readClients(C_ROWS), NOW);
    assert.strictEqual(t.partners, 4);
    assert.strictEqual(t.passed, 2);
    assert.strictEqual(t.clients, 4);
    assert.strictEqual(t.paid, 1);
    assert.strictEqual(t.trial, 3);
    assert.strictEqual(t.opens, 78);
    assert.strictEqual(t.payable, 10000);
    assert.strictEqual(t.earned, 17500);
});
check('сигналы: к выплате от 1 000 ₽, клиенты без экзамена, 3 прямых обращения, конец триала', () => {
    const s = A.signals(A.readPartners(P_ROWS), A.readClients(C_ROWS), NOW);
    const text = s.map(x => x.kind + ':' + x.text).join('\n');
    assert.ok(/ok:Алексей К\.: к выплате 5 000 ₽/.test(text));
    assert.ok(/ok:Мария С\.: к выплате 5 000 ₽/.test(text));
    assert.ok(/wait:Игорь Т\.: есть клиенты, но экзамен не сдан/.test(text));
    assert.ok(/wait:ООО «Склад-М» \(Мария С\.\): 3 прямых обращения из 3/.test(text));
    assert.ok(/wait:ООО «Пример-6» \(Игорь Т\.\): триал заканчивается, день 14 из 14/.test(text));
    assert.strictEqual(s.filter(x => x.kind === 'ok').length, 2);
});
check('больше трёх прямых обращений — сигнал «внимание»: повышение по клиенту прекращено', () => {
    const c = A.readClients([Object.assign({}, C_ROWS[2], { DirectCount: '4' })]);
    const s = A.signals(A.readPartners(P_ROWS), c, NOW).filter(x => x.kind === 'bad');
    assert.strictEqual(s.length, 1);
    assert.ok(/ООО «Склад-М» \(Мария С\.\): 4 прямых обращения, больше 3/.test(s[0].text));
});
check('сигналы: у партнёра без клиентов экзамен не требуется; оплатившие и новые не в сигналах конца триала', () => {
    const s = A.signals(A.readPartners(P_ROWS), A.readClients(C_ROWS), NOW).map(x => x.text).join('\n');
    assert.ok(s.indexOf('Денис Р.') < 0);
    assert.ok(s.indexOf('ИП Клиент-2') < 0);
    assert.ok(s.indexOf('ООО «Пример-1»') < 0);
});

check('фильтры: без экзамена, с сигналами, поиск по имени без учёта регистра', () => {
    const p = A.readPartners(P_ROWS), c = A.readClients(C_ROWS);
    const names = f => A.filterPartners(p, c, f, NOW).map(x => x.name);
    assert.deepStrictEqual(names({ filter: 'all', q: '' }), ['Алексей К.', 'Мария С.', 'Игорь Т.', 'Денис Р.']);
    assert.deepStrictEqual(names({ filter: 'noexam', q: '' }), ['Игорь Т.', 'Денис Р.']);
    assert.deepStrictEqual(names({ filter: 'signal', q: '' }), ['Алексей К.', 'Мария С.', 'Игорь Т.']);
    assert.deepStrictEqual(names({ filter: 'all', q: 'мАр' }), ['Мария С.']);
});

check('события клиента: время, вид и текст из отчёта', () => {
    const e = A.readEvents([{ ClientID: '11', EventTime: '03.11.2026 10:02', Kind: 'Материал', Text: 'Открыл видео' }]);
    assert.deepStrictEqual(e, [{ time: '03.11.2026 10:02', kind: 'Материал', text: 'Открыл видео' }]);
});

function fakeDoc() {
    const byId = {};
    function el(tag) {
        const e = {
            tag, children: [], dataset: {}, style: {}, attrs: {}, _text: '', handlers: {}, className: '', value: '',
            appendChild(c) { this.children.push(c); return c; },
            setAttribute(k, v) { this.attrs[k] = v; },
            addEventListener(t, f) { this.handlers[t] = f; },
            get textContent() { return this._text + this.children.map(c => c.textContent).join(''); },
            set textContent(v) { this._text = String(v); this.children = []; }
        };
        Object.defineProperty(e, 'innerHTML', { set() { throw new Error('innerHTML запрещён: данные только текстом'); }, get() { return ''; } });
        return e;
    }
    ['partners-crumbs', 'partners-view'].forEach(id => { byId[id] = el('div'); });
    return { byId, createElement: el, getElementById: id => byId[id] || null };
}
const findAll = (n, pred, out = []) => { if (pred(n)) out.push(n); n.children.forEach(c => findAll(c, pred, out)); return out; };
const DATA = () => ({ partners: A.readPartners(P_ROWS), clients: A.readClients(C_ROWS) });

check('отрисовка: имя партнёра с разметкой остаётся текстом, innerHTML не используется', () => {
    const doc = fakeDoc();
    const data = { partners: A.readPartners([Object.assign({}, P_ROWS[0], { Name: '<img src=x onerror=alert(1)>' })]), clients: [] };
    A.render(doc, { level: 1, filter: 'all', q: '' }, data, {}, NOW);
    assert.ok(doc.byId['partners-view'].textContent.indexOf('<img src=x onerror=alert(1)>') >= 0);
});
check('отрисовка: клик по партнёру и по клиенту вызывает переход с их номером', () => {
    const doc = fakeDoc(), calls = [];
    const h = { openPartner: id => calls.push('p' + id), openClient: id => calls.push('c' + id), home: () => calls.push('home'), partner: () => calls.push('back') };
    A.render(doc, { level: 1, filter: 'all', q: '' }, DATA(), h, NOW);
    const pbtn = findAll(doc.byId['partners-view'], n => n.dataset && n.dataset.partner === '2')[0];
    assert.ok(pbtn, 'у партнёра есть кнопка перехода');
    pbtn.handlers.click();
    A.render(doc, { level: 2, pid: '1', filter: 'all', q: '' }, DATA(), h, NOW);
    const cbtn = findAll(doc.byId['partners-view'], n => n.dataset && n.dataset.client === '12')[0];
    assert.ok(cbtn, 'у клиента есть кнопка перехода');
    cbtn.handlers.click();
    assert.deepStrictEqual(calls, ['p2', 'c12']);
});
check('отрисовка: уровень клиентов показывает только клиентов выбранного партнёра', () => {
    const doc = fakeDoc();
    A.render(doc, { level: 2, pid: '1', filter: 'all', q: '' }, DATA(), {}, NOW);
    const txt = doc.byId['partners-view'].textContent;
    assert.ok(txt.indexOf('ООО «Пример-1»') >= 0 && txt.indexOf('ИП Клиент-2') >= 0);
    assert.ok(txt.indexOf('ООО «Склад-М»') < 0);
});
check('отрисовка: карточка клиента — этап, использование, хронология; без событий — подсказка', () => {
    const doc = fakeDoc();
    const ev = A.readEvents([{ EventTime: '03.11.2026 10:02', Kind: 'Материал', Text: 'Открыл видео' }]);
    A.render(doc, { level: 3, pid: '1', cid: '11', filter: 'all', q: '' }, DATA(), {}, NOW, ev);
    let txt = doc.byId['partners-view'].textContent;
    assert.ok(txt.indexOf('Открыл видео') >= 0 && txt.indexOf('баз 1') >= 0 && txt.indexOf('не показывается') >= 0);
    A.render(doc, { level: 3, pid: '1', cid: '11', filter: 'all', q: '' }, DATA(), {}, NOW, []);
    txt = doc.byId['partners-view'].textContent;
    assert.ok(txt.indexOf('Открыл видео') < 0 && txt.indexOf('нет событий') >= 0);
});

(async () => {
    const log = [];
    const ok = async (name, fn) => { try { await fn(); console.log('PASS: ' + name); } catch (e) { failures++; console.log('FAIL: ' + name + '\n  ' + e.message); } };
    await ok('загрузка отчётов: имена adminPartners/adminClients, формат JSON_KV; ошибка сервера — пустые списки', async () => {
        global.fetch = url => { log.push(url); return Promise.resolve({ ok: true, json: () => Promise.resolve(/adminPartners/.test(url) ? P_ROWS : C_ROWS) }); };
        const d = await A.load('/my');
        assert.strictEqual(d.partners.length, 4);
        assert.strictEqual(d.clients.length, 4);
        assert.ok(log.some(u => u === '/my/report/adminPartners?JSON_KV') && log.some(u => u === '/my/report/adminClients?JSON_KV'));
        global.fetch = () => Promise.resolve({ ok: false, json: () => Promise.resolve(null) });
        const bad = await A.load('/my');
        assert.deepStrictEqual(bad, { partners: [], clients: [] });
        global.fetch = () => Promise.reject(new Error('net'));
        assert.deepStrictEqual(await A.load('/my'), { partners: [], clients: [] });
    });
    await ok('события клиента: запрос отчёта с фильтром FR_ClientID, номер клиента кодируется', async () => {
        let asked = '';
        global.fetch = url => { asked = url; return Promise.resolve({ ok: true, json: () => Promise.resolve([{ EventTime: '03.11.2026 10:02', Kind: 'Бот', Text: 'Запустил' }]) }); };
        const e = await A.loadEvents('/my', '11&x=1');
        assert.strictEqual(asked, '/my/report/adminEvents?JSON_KV&FR_ClientID=11%26x%3D1');
        assert.strictEqual(e[0].kind, 'Бот');
        global.fetch = () => Promise.reject(new Error('net'));
        assert.deepStrictEqual(await A.loadEvents('/my', '11'), []);
    });
    if (failures) process.exitCode = 1;
})();
