/*
 * python2node#849: структурный ответ ИИ-агента (blocks) и ход работы (progress) в
 * js/ai-agent-chat.js.
 *
 *   A) «Покажи сделки Петрова»: таблица, ссылки на записи и кнопки вместо перечня текстом;
 *   B) HTML и скрипты из ответа агента не исполняются: всё, что пришло от агента, ложится
 *      только в textContent, ссылки ведут только внутрь базы, неизвестные блоки пропадают;
 *   C) кнопка действия отправляет её сообщение в чат и гаснет;
 *   D) во время работы в «думает»-пузыре видна последняя строка хода работы;
 *   E) ответ без blocks показывается как раньше (content).
 */
'use strict';

var realSetTimeout = global.setTimeout;
var path = require.resolve('../js/ai-agent-chat.js');

var failures = 0;
function expect(cond, name){
    if(cond){ console.log('PASS: ' + name); } else { console.log('FAIL: ' + name); failures++; }
}
function flush(){ return new Promise(function(res){ realSetTimeout(res, 0); }); }
function settle(){ return flush().then(flush).then(flush); }

// --- Фейковый DOM: innerHTML запоминается, но не разбирается — любая строка агента,
// попавшая в innerHTML, видна в журнале htmlWrites и считается исполнимой разметкой.
var htmlWrites = [];
function FE(tag){
    this.tagName = String(tag).toUpperCase(); this.children = []; this.attrs = {}; this._classes = {};
    this._text = ''; this.style = {}; this.parentNode = null;
    this.scrollTop = 0; this.scrollHeight = 100; this.disabled = false;
    this.hidden = false; this.value = ''; this.listeners = {};
    var self = this;
    this.classList = {
        add: function(c){ self._classes[c] = true; },
        remove: function(c){ delete self._classes[c]; },
        contains: function(c){ return !!self._classes[c]; },
        toggle: function(c){ self._classes[c] = !self._classes[c]; }
    };
}
FE.prototype.appendChild = function(c){ c.parentNode = this; this.children.push(c); return c; };
FE.prototype.setAttribute = function(k, v){ this.attrs[k] = String(v); };
FE.prototype.removeAttribute = function(k){ delete this.attrs[k]; };
FE.prototype.getAttribute = function(k){ return this.attrs.hasOwnProperty(k) ? this.attrs[k] : null; };
FE.prototype.addEventListener = function(ev, fn){ this.listeners[ev] = fn; };
FE.prototype.focus = function(){};
FE.prototype.click = function(){ if(this.listeners.click) this.listeners.click({ preventDefault: function(){} }); };
FE.prototype.querySelector = function(sel){ return findAll(this, sel.replace(/^\./, ''))[0] || null; };
FE.prototype.querySelectorAll = function(sel){ return findAll(this, sel.replace(/^\./, '')); };
Object.defineProperty(FE.prototype, 'href', {
    get: function(){ return this.attrs.href || ''; },
    set: function(v){ this.attrs.href = String(v); }
});
Object.defineProperty(FE.prototype, 'textContent', {
    get: function(){
        if(this.children.length) return this.children.map(function(c){ return c.textContent; }).join('');
        return this._text;
    },
    set: function(v){ this._text = (v === undefined || v === null) ? '' : String(v); this.children = []; }
});
Object.defineProperty(FE.prototype, 'innerHTML', {
    get: function(){ return this._html || ''; },
    set: function(v){ htmlWrites.push(String(v)); this._html = String(v); if(v === '') this.children = []; }
});
Object.defineProperty(FE.prototype, 'className', {
    get: function(){ return Object.keys(this._classes).join(' '); },
    set: function(v){ this._classes = {}; var self = this; String(v).split(/\s+/).forEach(function(c){ if(c) self._classes[c] = true; }); }
});
function findAll(node, key, out){
    out = out || [];
    node.children.forEach(function(ch){
        if(ch._classes[key] || ch.tagName === key.toUpperCase()) out.push(ch);
        findAll(ch, key, out);
    });
    return out;
}
function walk(node, fn){ fn(node); node.children.forEach(function(c){ walk(c, fn); }); }

var IDS = ['ai-chat-toggle','ai-agent-panel','ai-agent-close','ai-agent-input',
    'ai-agent-send','ai-agent-attach','ai-agent-files','ai-agent-messages','ai-agent-attachments','ai-agent-status'];

function freshAgent(fetchHandler){
    var els = {};
    IDS.forEach(function(id){ els[id] = new FE('div'); });
    new FE('div').appendChild(els['ai-agent-messages']);
    global.document = {
        readyState: 'complete',
        getElementById: function(id){ return els[id] || null; },
        createElement: function(tag){ return new FE(tag); },
        addEventListener: function(){},
        querySelector: function(){ return null; }
    };
    global.window = { db: 'acme', user: 'petrov', location: { pathname: '/acme/main' } };
    global.__intervals = [];
    global.setInterval = function(fn, ms){ var h = { fn: fn, ms: ms, cleared: false }; global.__intervals.push(h); return h; };
    global.clearInterval = function(h){ if(h) h.cleared = true; };
    global.__posts = [];
    global.fetch = function(url, opts){
        opts = opts || {};
        if((opts.method || 'GET') === 'POST') global.__posts.push(opts.body);
        var res = fetchHandler(url, opts);
        return Promise.resolve({ ok: res.ok !== false, status: res.status || 200, json: function(){ return Promise.resolve(res.data); } });
    };
    global.FormData = function(){ this.fields = {}; };
    global.FormData.prototype.append = function(k, v){ this.fields[k] = v; };
    delete require.cache[path];
    return { agent: require(path), els: els };
}

function lastAnswer(els){
    var msgs = els['ai-agent-messages'].children.filter(function(m){ return m._classes['ai-chat-message-assistant']; });
    return msgs[msgs.length - 1];
}

var XSS = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
var DEALS = {
    content: 'Нашёл 3 сделки Петрова.\n\nСделка | Сумма\nПоставка | 1200',
    blocks: [
        { type: 'text', text: 'Нашёл 3 сделки Петрова.' },
        { type: 'table', title: 'Сделки Петрова', columns: ['Сделка', 'Сумма'],
          rows: [['Поставка', '1200'], ['Монтаж', '300']], total: 37, more: 'object/310/?F_U=Петров' },
        { type: 'records', items: [{ t: 310, id: 5001, label: 'Поставка' }, { t: 310, id: 5002, label: 'Монтаж' }] },
        { type: 'actions', items: [{ label: 'Закрыть открытые', message: 'Закрой открытые сделки Петрова' },
                                   { label: 'Все сделки', href: 'object/310/' }] }
    ]
};

function answerWith(result){
    return freshAgent(function(url, opts){
        if((opts.method || 'GET') === 'POST')
            return { data: { job: { id: 'j' + global.__posts.length, status: 'done', message: 'q', result: { assistant: result } } } };
        return { data: { job: null } };
    });
}

// ===================== A) таблица, ссылки, кнопки =====================
function scenarioA(){
    var ctx = answerWith(DEALS), a = ctx.agent, els = ctx.els;
    return settle().then(function(){
        els['ai-agent-input'].value = 'Покажи сделки Петрова';
        a.send();
        return settle();
    }).then(function(){
        var ans = lastAnswer(els);
        var table = ans.querySelector('table');
        expect(!!table, 'A: ответ с blocks рисует таблицу');
        var ths = ans.querySelectorAll('th').map(function(t){ return t.textContent; });
        expect(ths.join('|') === 'Сделка|Сумма', 'A: заголовки колонок (' + ths.join('|') + ')');
        var tds = ans.querySelectorAll('td').map(function(t){ return t.textContent; });
        expect(tds.join('|') === 'Поставка|1200|Монтаж|300', 'A: ячейки строк (' + tds.join('|') + ')');
        var links = ans.querySelectorAll('a').map(function(l){ return l.getAttribute('href') + ' ' + l.textContent; });
        expect(links.indexOf('/acme/object/310/?F_I=5001 Поставка') !== -1, 'A: ссылка на запись внутри базы (' + links.join(', ') + ')');
        expect(links.some(function(l){ return l.indexOf('/acme/object/310/?F_U=Петров ') === 0 && /37/.test(l); }),
            'A: «показать всё» ведёт на фильтр таблицы и называет общее число');
        expect(links.indexOf('/acme/object/310/ Все сделки') !== -1, 'A: кнопка-ссылка ведёт внутрь базы');
        var buttons = ans.querySelectorAll('button').map(function(b){ return b.textContent; });
        expect(buttons.indexOf('Закрыть открытые') !== -1, 'A: кнопка действия');
        expect(ans.textContent.indexOf('Сделка | Сумма') === -1, 'A: при blocks текстовый перечень content не дублируется');
    });
}

// ===================== B) HTML и скрипты не исполняются =====================
function scenarioB(){
    htmlWrites = [];
    var ctx = answerWith({
        content: XSS,
        blocks: [
            { type: 'text', text: XSS },
            { type: 'html', html: XSS },
            { type: 'table', title: XSS, columns: [XSS], rows: [[XSS]], more: 'javascript:alert(1)' },
            { type: 'table', columns: ['a'], rows: [['b']], more: '//evil.example/object/1' },
            { type: 'records', items: [{ t: '1"><script>', id: 2, label: XSS }, { t: 7, id: 9, label: XSS }] },
            { type: 'actions', items: [{ label: XSS, href: 'https://evil.example/' }, { label: XSS, message: 'ok' }] }
        ]
    });
    var a = ctx.agent, els = ctx.els;
    return settle().then(function(){
        els['ai-agent-input'].value = 'x';
        a.send();
        return settle();
    }).then(function(){
        var ans = lastAnswer(els);
        expect(htmlWrites.every(function(h){ return h.indexOf('alert') === -1; }), 'B: строки агента не попадают в innerHTML');
        var tags = [];
        walk(ans, function(n){ tags.push(n.tagName); });
        expect(tags.indexOf('SCRIPT') === -1 && tags.indexOf('IMG') === -1 && tags.indexOf('IFRAME') === -1,
            'B: элементов script/img/iframe нет (' + tags.join(',') + ')');
        expect(ans.textContent.indexOf(XSS) !== -1, 'B: разметка агента видна как текст');
        var hrefs = ans.querySelectorAll('a').map(function(l){ return l.getAttribute('href'); });
        expect(hrefs.length > 0 && hrefs.every(function(h){ return /^\/acme\/(object|report|edit_obj)\/\d+/.test(h); }),
            'B: все ссылки — внутрь базы (' + hrefs.join(', ') + ')');
        expect(hrefs.indexOf('/acme/object/7/?F_I=9') !== -1, 'B: корректная запись осталась ссылкой');
        var attrs = [];
        walk(ans, function(n){ Object.keys(n.attrs).forEach(function(k){ attrs.push(k); }); });
        expect(attrs.every(function(k){ return !/^on/i.test(k); }), 'B: обработчиков событий в атрибутах нет');
    });
}

// ===================== C) кнопка действия =====================
function scenarioC(){
    var ctx = answerWith(DEALS), a = ctx.agent, els = ctx.els;
    return settle().then(function(){
        els['ai-agent-input'].value = 'Покажи сделки Петрова';
        a.send();
        return settle();
    }).then(function(){
        var btn = lastAnswer(els).querySelectorAll('button').filter(function(b){ return b.textContent === 'Закрыть открытые'; })[0];
        btn.click();
        return settle().then(function(){ return btn; });
    }).then(function(btn){
        var last = global.__posts[global.__posts.length - 1];
        expect(global.__posts.length === 2 && last.fields.message === 'Закрой открытые сделки Петрова',
            'C: кнопка отправляет своё сообщение агенту');
        var users = els['ai-agent-messages'].children.filter(function(m){ return m._classes['ai-chat-message-user']; });
        expect(users[users.length - 1].querySelector('.ai-chat-message-text').textContent === 'Закрой открытые сделки Петрова',
            'C: сообщение кнопки видно в ленте как реплика пользователя');
        expect(btn.disabled === true, 'C: нажатая кнопка гаснет');
    });
}

// ===================== D) ход работы =====================
function scenarioD(){
    var progress = 'Читаю таблицу Сделки…';
    var ctx = freshAgent(function(url, opts){
        if((opts.method || 'GET') === 'POST') return { data: { job: { id: 'jD', status: 'processing', message: 'q' } } };
        if(url.indexOf('job=jD') !== -1) return { data: { job: { id: 'jD', status: 'processing', message: 'q', progress: progress } } };
        return { data: { job: null } };
    });
    var a = ctx.agent, els = ctx.els;
    return settle().then(function(){
        els['ai-agent-input'].value = 'q';
        a.send();
        return settle();
    }).then(function(){
        var poll = global.__intervals.filter(function(h){ return !h.cleared && h.ms === a.pollIntervalMs; })[0];
        poll.fn();
        return settle();
    }).then(function(){
        var label = els['ai-agent-messages'].querySelector('.ai-agent-thinking-label');
        expect(label && label.textContent === progress, 'D: в пузыре последняя строка хода (' + (label && label.textContent) + ')');
        // Тик ожидания раз в секунду не затирает ход работы.
        global.__intervals.filter(function(h){ return !h.cleared && h.ms === 1000; }).forEach(function(h){ h.fn(); });
        expect(label.textContent === progress, 'D: тик ожидания не затирает ход работы');
        progress = '<b>Нашёл 37</b>';
        global.__intervals.filter(function(h){ return !h.cleared && h.ms === a.pollIntervalMs; })[0].fn();
        return settle().then(function(){ return label; });
    }).then(function(label){
        expect(label.textContent === '<b>Нашёл 37</b>', 'D: следующая строка хода — как текст');
    });
}

// ===================== E) старый ответ без blocks =====================
function scenarioE(){
    var ctx = answerWith({ content: 'В базе 12 таблиц' }), a = ctx.agent, els = ctx.els;
    return settle().then(function(){
        els['ai-agent-input'].value = 'Сколько таблиц?';
        a.send();
        return settle();
    }).then(function(){
        var t = lastAnswer(els).querySelector('.ai-chat-message-text');
        expect(t.textContent === 'В базе 12 таблиц', 'E: ответ без blocks — текстом, как раньше');
    });
}

scenarioA().then(scenarioB).then(scenarioC).then(scenarioD).then(scenarioE).then(function(){
    console.log('');
    if(failures){ console.log('FAILED: ' + failures + ' check(s) failed'); process.exit(1); }
    console.log('ALL TESTS PASSED');
}).catch(function(e){
    console.log('ERROR: ' + (e && e.stack ? e.stack : e));
    process.exit(1);
});
