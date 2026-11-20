// Мерка: партнёрский раздел ЛК — материалы с персональными ссылками, клиенты на сопровождении,
// статус экзамена и активность (раздел 14 оферты партнёра, ideav/backlogram).
//
// Браузерные файлы (не CommonJS) грузятся чтением и eval; проверяется поведение:
//   1) разбор ответа /my/cabdata?JSON в данные партнёра (блоки partnerLinks, partnerClients,
//      partnerExam, partnerStats); пустой или ошибочный ответ — пустые данные, не исключение;
//   2) адрес персональной ссылки строится только из токена нужной формы (нет подстановки чужого);
//   3) день пробного периода из 14, итог по клиенту, статус экзамена;
//   4) отрисовка пишет только текст (textContent): имя клиента с разметкой не становится разметкой;
//   5) одна загрузка cabdata кормит и тарифы, и данные партнёра.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
global.window = globalThis;
for (const f of ['js/my-mode.js', 'js/partner-cabinet.js'])
    (0, eval)(fs.readFileSync(path.join(root, f), 'utf8'));

let failures = 0;
function check(name, fn) {
    try { fn(); console.log('PASS: ' + name); } catch (e) { failures++; console.log('FAIL: ' + name + '\n  ' + e.message); }
}

const TOKEN = 'k7Qm2xVd9LpR4tWe';
const live = {
    '&main.a.partnerlinks': {
        material: ['video_excel', 'bot', 'service', 'broken'],
        title: ['Видео «Как перенести учёт из Excel в приложение»', 'Бот для клиента', 'Страница услуги', 'Сломанная'],
        token: [TOKEN, 'Gv2cN8yRq5TjW3mD', '', '../etc/passwd'],
        kind: ['video', 'bot', 'service', 'page']
    },
    '&main.a.partnerexam': { passed: ['1'], score: ['90'], examdate: ['08.11.2026'], attemptsleft: ['3'], threshold: ['80'] },
    '&main.a.partnerclients': {
        client: ['ООО «Пример-1»', 'ИП Клиент-2', 'ООО Пример-3'],
        came: ['03.11.2026', '29.10.2026', '09.11.2026'],
        did: ['вошёл в бота, 2 дашборда', '3 дашборда, приёмка', 'открыл видео'],
        start: ['03.11.2026', '29.10.2026', '09.11.2026'],
        paid: ['0', '1', '0']
    },
    '&main.a.partnerstats': {
        clients: ['5'], onsupport: ['3'], paidclients: ['2'], earned: ['12500'],
        opens: ['41'], people: ['17'], videopeople: ['17'], presentationpeople: ['9'], kppeople: ['6'],
        botstarts: ['5'], flows: ['4']
    }
};
const NOW = new Date(2026, 10, 10); // 10.11.2026

check('cabdata: ссылки, клиенты, экзамен и статистика партнёра разбираются из ответа', () => {
    const d = window.MyMode.readPartnerData(live);
    assert.strictEqual(d.links.length, 4);
    assert.strictEqual(d.links[0].token, TOKEN);
    assert.strictEqual(d.clients.length, 3);
    assert.strictEqual(d.clients[1].paid, true);
    assert.strictEqual(d.exam.passed, true);
    assert.strictEqual(d.exam.score, 90);
    assert.strictEqual(d.stats.clients, 5);
    assert.strictEqual(d.stats.earned, 12500);
});
check('cabdata: пустой или ошибочный ответ — пустые данные партнёра, а не исключение', () => {
    for (const bad of [null, [], { error: 'x' }, '[]']) {
        const d = window.MyMode.readPartnerData(bad);
        assert.deepStrictEqual(d.links, []);
        assert.deepStrictEqual(d.clients, []);
        assert.strictEqual(d.exam, null);
        assert.strictEqual(d.stats, null);
    }
});

const ctx = { host: 'https://ideav.ru', bot: 'Integrammbot', userId: '12' };
check('ссылка на материал — /m/<токен>; бот — start=<токен>; услуга — ?aff=<номер партнёра>', () => {
    const P = window.PartnerCabinet;
    assert.strictEqual(P.linkUrl({ kind: 'video', token: TOKEN }, ctx), 'https://ideav.ru/m/' + TOKEN);
    assert.strictEqual(P.linkUrl({ kind: 'bot', token: 'Gv2cN8yRq5TjW3mD' }, ctx), 'https://t.me/Integrammbot?start=Gv2cN8yRq5TjW3mD');
    assert.strictEqual(P.linkUrl({ kind: 'service', token: '' }, ctx), 'https://ideav.ru/excel-to-app.html?aff=12');
});
check('токен неправильной формы не превращается в ссылку (нет обхода каталога и чужого адреса)', () => {
    const P = window.PartnerCabinet;
    for (const t of ['../etc/passwd', 'short', 'a b c d e f g h i j k l', 'https://evil.example/x', ''])
        assert.strictEqual(P.linkUrl({ kind: 'video', token: t }, ctx), '');
});

check('пробный период: день из 14 и доля шкалы по дате начала', () => {
    const P = window.PartnerCabinet;
    assert.deepStrictEqual(P.trialDay('03.11.2026', NOW), { day: 8, total: 14, percent: 57, done: false });
    assert.deepStrictEqual(P.trialDay('10.11.2026', NOW), { day: 1, total: 14, percent: 7, done: false });
    assert.deepStrictEqual(P.trialDay('2026-11-09', NOW).day, 2);
});
check('пробный период закончен через 14 дней, дата в будущем — первый день, мусор — null', () => {
    const P = window.PartnerCabinet;
    const old = P.trialDay('25.10.2026', NOW);
    assert.strictEqual(old.done, true);
    assert.strictEqual(old.percent, 100);
    assert.strictEqual(P.trialDay('25.12.2026', NOW).day, 1);
    assert.strictEqual(P.trialDay('вчера', NOW), null);
    assert.strictEqual(P.trialDay('', NOW), null);
});

check('статус экзамена: сдан с баллом и датой; не сдан — сколько попыток осталось; данных нет — исходные 3 попытки', () => {
    const P = window.PartnerCabinet;
    assert.strictEqual(P.examView({ passed: true, score: 90, date: '08.11.2026', attemptsLeft: 3, threshold: 80 }).label, 'Сдан · 90% · 08.11.2026');
    const fail = P.examView({ passed: false, score: 70, date: '', attemptsLeft: 2, threshold: 80 });
    assert.strictEqual(fail.passed, false);
    assert.strictEqual(fail.label, 'Не сдан · осталось попыток: 2');
    const none = P.examView(null);
    assert.strictEqual(none.passed, false);
    assert.strictEqual(none.label, 'Не сдан · осталось попыток: 3');
    assert.strictEqual(none.threshold, 80);
});

check('клиенты: оплатил, в триале (день), триал окончен без оплаты', () => {
    const P = window.PartnerCabinet;
    const vm = P.viewModel(window.MyMode.readPartnerData(live), ctx, NOW);
    assert.deepStrictEqual(vm.clients.map(c => c.status), ['trial', 'paid', 'trial']);
    assert.strictEqual(vm.clients[0].dayText, 'день 8 из 14');
    assert.strictEqual(vm.clients[1].dayText, 'поддержка завершена');
    const lapsed = P.viewModel({ links: [], exam: null, stats: null, clients: [{ name: 'X', came: '', did: '', start: '01.10.2026', paid: false }] }, ctx, NOW);
    assert.strictEqual(lapsed.clients[0].status, 'lapsed');
});
check('в списке ссылок остаются только те, у которых получается адрес; услуга — без токена', () => {
    const vm = window.PartnerCabinet.viewModel(window.MyMode.readPartnerData(live), ctx, NOW);
    assert.deepStrictEqual(vm.links.map(l => l.material), ['video_excel', 'bot', 'service']);
    assert.strictEqual(vm.links[2].url, 'https://ideav.ru/excel-to-app.html?aff=12');
});
check('сводка и активность из статистики; без статистики — нули', () => {
    const P = window.PartnerCabinet;
    const vm = P.viewModel(window.MyMode.readPartnerData(live), ctx, NOW);
    assert.strictEqual(vm.summary.clients, 5);
    assert.strictEqual(vm.summary.opens, 41);
    assert.deepStrictEqual(vm.activity.map(a => a.value), [17, 9, 6, 5, 4]);
    const empty = P.viewModel(window.MyMode.readPartnerData(null), ctx, NOW);
    assert.strictEqual(empty.summary.clients, 0);
    assert.deepStrictEqual(empty.activity.map(a => a.value), [0, 0, 0, 0, 0]);
    assert.strictEqual(empty.links.length, 1); // услуга доступна и без данных
});

// Минимальный DOM: проверяется, что имя клиента попадает как текст, а не как разметка
function fakeDoc() {
    const byId = {};
    function el(tag) {
        const e = {
            tag, children: [], dataset: {}, style: {}, attrs: {}, _text: '', handlers: {}, className: '',
            appendChild(c) { this.children.push(c); return c; },
            setAttribute(k, v) { this.attrs[k] = v; },
            addEventListener(t, f) { this.handlers[t] = f; },
            get textContent() { return this._text + this.children.map(c => c.textContent).join(''); },
            set textContent(v) { this._text = String(v); this.children = []; }
        };
        Object.defineProperty(e, 'innerHTML', { set() { throw new Error('innerHTML запрещён: данные только текстом'); }, get() { return ''; } });
        return e;
    }
    ['partner-summary', 'partner-exam', 'partner-links', 'partner-clients', 'partner-activity'].forEach(id => { byId[id] = el('div'); byId[id].id = id; });
    return { byId, createElement: el, getElementById: id => byId[id] || null };
}
check('отрисовка: имя клиента с разметкой остаётся текстом, innerHTML не используется', () => {
    const doc = fakeDoc();
    const data = window.MyMode.readPartnerData({
        '&main.a.partnerclients': { client: ['<img src=x onerror=alert(1)>'], start: ['09.11.2026'], paid: ['0'], did: [''], came: [''] }
    });
    window.PartnerCabinet.render(doc, window.PartnerCabinet.viewModel(data, ctx, NOW));
    assert.ok(doc.byId['partner-clients'].textContent.indexOf('<img src=x onerror=alert(1)>') >= 0);
});
check('отрисовка: кнопка «Копировать ссылку» кладёт в буфер именно персональный адрес', () => {
    const doc = fakeDoc();
    let copied = null;
    global.navigator = { clipboard: { writeText: t => { copied = t; return Promise.resolve(); } } };
    const data = window.MyMode.readPartnerData(live);
    window.PartnerCabinet.render(doc, window.PartnerCabinet.viewModel(data, ctx, NOW));
    const find = (n, pred) => pred(n) ? n : n.children.map(c => find(c, pred)).find(Boolean);
    const btn = find(doc.byId['partner-links'], n => n.dataset && n.dataset.copyUrl === 'https://ideav.ru/m/' + TOKEN);
    assert.ok(btn, 'у ссылки есть кнопка копирования');
    btn.handlers.click();
    assert.strictEqual(copied, 'https://ideav.ru/m/' + TOKEN);
});

(async () => {
    try {
        let calls = 0;
        global.fetch = () => { calls++; return Promise.resolve({ ok: true, json: () => Promise.resolve(Object.assign({
            '&main.a.plans': { planid: ['1'], price: ['10'], limit: ['5'], planname: ['A'] } }, live)) }); };
        const base = 'https://ideav.ru/my';
        const a = await window.MyMode.loadCabData(base);
        const b = await window.MyMode.loadPartnerData(base);
        assert.strictEqual(a.plans.length, 1);
        assert.strictEqual(b.links.length, 4);
        assert.strictEqual(calls, 1);
        console.log('PASS: один запрос cabdata кормит и тарифы, и данные партнёра');
    } catch (e) {
        failures++; console.log('FAIL: один запрос cabdata кормит и тарифы, и данные партнёра\n  ' + e.message);
    }
    if (failures) process.exitCode = 1;
})();
