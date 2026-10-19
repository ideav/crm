/*
 * ideav/crm#5203: раздельные диалоги в ИИ-чате.
 * https://github.com/ideav/crm/issues/5203
 *
 * «Когда перезаходишь, там 1 простыня и всё»: была одна лента и одна сессия агента на
 * пользователя. Теперь у пользователя несколько диалогов. Проверяем клиент
 * (js/ai-agent-chat.js):
 *   A) вопрос уходит с id диалога, id запоминается;
 *   B) при заходе открывается запомненный диалог — вся его лента, а не одна последняя задача;
 *   C) «Новый чат» — пустая лента (только приветствие) и новый id для следующего вопроса;
 *   D) список чатов: открыть другой диалог — его лента, запомнен он;
 *   E) ответ на вопрос из прошлого диалога не попадает в ленту открытого после него;
 *   F) удаление чата из списка — в два нажатия; удалён открытый — начинается новый.
 *
 * Харнесс — как в ai-agent-poll-dedup-5193.test.js: фейковые document/window без jsdom,
 * fetch управляется из теста.
 */
'use strict';

var test = require('node:test');
var assert = require('node:assert');
var path = require.resolve('../js/ai-agent-chat.js');

function FE(tag){
    this.tag = tag; this.children = []; this.attrs = {}; this._classes = {};
    this.style = {}; this.parentNode = null; this.hidden = false; this.value = '';
    this.listeners = {}; this.scrollTop = 0; this.scrollHeight = 100;
    var self = this;
    this.classList = {
        add: function(c){ self._classes[c] = true; },
        remove: function(c){ delete self._classes[c]; },
        contains: function(c){ return !!self._classes[c]; }
    };
}
FE.prototype.appendChild = function(c){
    if(c.parentNode) c.parentNode.removeChild(c);
    c.parentNode = this; this.children.push(c); return c;
};
FE.prototype.insertBefore = function(c, ref){
    if(c.parentNode) c.parentNode.removeChild(c);
    var i = ref ? this.children.indexOf(ref) : -1;
    c.parentNode = this;
    if(i < 0) this.children.push(c); else this.children.splice(i, 0, c);
    return c;
};
FE.prototype.removeChild = function(c){
    var i = this.children.indexOf(c);
    if(i >= 0) this.children.splice(i, 1);
    c.parentNode = null;
    return c;
};
Object.defineProperty(FE.prototype, 'nextSibling', {
    get: function(){
        if(!this.parentNode) return null;
        var sib = this.parentNode.children;
        return sib[sib.indexOf(this) + 1] || null;
    }
});
FE.prototype.setAttribute = function(k, v){ this.attrs[k] = String(v); };
FE.prototype.removeAttribute = function(k){ delete this.attrs[k]; };
FE.prototype.getAttribute = function(k){ return this.attrs.hasOwnProperty(k) ? this.attrs[k] : null; };
FE.prototype.addEventListener = function(ev, fn){ (this.listeners[ev] = this.listeners[ev] || []).push(fn); };
FE.prototype.click = function(){ (this.listeners.click || []).forEach(function(fn){ fn({}); }); };
FE.prototype.contains = function(node){
    for(var n = node; n; n = n.parentNode) if(n === this) return true;
    return false;
};
FE.prototype.focus = function(){ global.document.activeElement = this; };
FE.prototype.querySelector = function(sel){
    var cls = /^\.([\w-]+)$/.exec(sel);
    if(!cls) return null;
    for(var i = 0; i < this.children.length; i++){
        var ch = this.children[i];
        if(ch._classes[cls[1]]) return ch;
        var deep = ch.querySelector(sel);
        if(deep) return deep;
    }
    return null;
};
FE.prototype.findAll = function(cls, out){
    out = out || [];
    this.children.forEach(function(ch){ if(ch._classes[cls]) out.push(ch); ch.findAll(cls, out); });
    return out;
};
Object.defineProperty(FE.prototype, 'className', {
    get: function(){ return Object.keys(this._classes).join(' '); },
    set: function(v){ var s = this; s._classes = {}; String(v).split(/\s+/).forEach(function(c){ if(c) s._classes[c] = true; }); }
});
Object.defineProperty(FE.prototype, 'textContent', {
    get: function(){ return this._text || ''; }, set: function(v){ this._text = String(v); }
});
Object.defineProperty(FE.prototype, 'innerHTML', {
    get: function(){ return ''; }, set: function(){ this.children.forEach(function(c){ c.parentNode = null; }); this.children = []; }
});

var IDS = ['ai-chat-toggle', 'ai-agent-panel', 'ai-agent-close', 'ai-agent-input',
    'ai-agent-send', 'ai-agent-attach', 'ai-agent-files', 'ai-agent-messages', 'ai-agent-attachments', 'ai-agent-status'];

function allText(node){
    return (node._text || '') + node.children.map(allText).join('');
}

var C1 = 'aaaa1111aaaa1111aaaa1111aaaa1111';
var C2 = 'bbbb2222bbbb2222bbbb2222bbbb2222';
var KEY = 'integram.aiAgent.conversation.ateh.petrov';

// Разметка панели как в templates/main.html: шапка (заголовок + «Закрыть»), тело с лентой,
// в ленте — приветствие. Каждый fetch — отложенный ответ, тест решает, чем он завершится.
function load(stored){
    var els = {};
    IDS.forEach(function(id){ els[id] = new FE('div'); });
    var panel = els['ai-agent-panel'];
    var header = new FE('div'); header.className = 'ai-chat-header';
    header.appendChild(new FE('div'));
    header.appendChild(els['ai-agent-close']);
    panel.appendChild(header);
    var body = new FE('div');
    body.appendChild(els['ai-agent-messages']);
    panel.appendChild(body);
    var hello = new FE('div'); hello.className = 'ai-chat-message ai-chat-message-assistant';
    hello.textContent = 'Здравствуйте!';
    els['ai-agent-messages'].appendChild(hello);

    var doc = new FE('document');
    doc.readyState = 'complete';
    doc.body = new FE('body');
    doc.activeElement = doc.body;
    doc.getElementById = function(id){ return els[id] || null; };
    doc.createElement = function(tag){ return new FE(tag); };
    global.document = doc;
    var ls = {};
    if(stored) ls[KEY] = stored;
    global.window = {
        db: 'ateh', user: 'petrov', location: { pathname: '/ateh/main', search: '' }, innerWidth: 1400,
        localStorage: {
            getItem: function(k){ return ls.hasOwnProperty(k) ? ls[k] : null; },
            setItem: function(k, v){ ls[k] = String(v); },
            removeItem: function(k){ delete ls[k]; }
        }
    };

    var calls = [];
    global.setInterval = function(){ return 1; };
    global.clearInterval = function(){};
    global.fetch = function(url, opts){
        var call = { url: String(url), method: (opts && opts.method) || 'GET', body: opts && opts.body };
        call.promise = new Promise(function(resolve, reject){ call.resolve = resolve; call.reject = reject; });
        calls.push(call);
        return call.promise;
    };

    delete require.cache[path];
    var agent = require(path);
    return { agent: agent, els: els, calls: calls, ls: ls, header: header, panel: panel };
}

function reply(call, data, status){
    status = status || 200;
    call.resolve({ ok: status < 400, status: status, json: function(){ return Promise.resolve(data); } });
}
function flush(){ return new Promise(function(r){ setImmediate(r); }); }
function last(env){ return env.calls[env.calls.length - 1]; }

function feed(env){
    return env.els['ai-agent-messages'].children
        .filter(function(m){ return !m._classes['ai-chat-message-thinking']; })
        .map(allText);
}
function headerButton(env, title){
    var found = null;
    (function walk(n){ n.children.forEach(function(c){ if(c.title === title) found = c; walk(c); }); })(env.header);
    return found;
}
function turn(id, q, a){ return { id: id, status: 'done', message: q, result: { assistant: { content: a } } }; }
function chat(id, turns){ return { conversation: { id: id, title: turns[0] ? turns[0].message : '', turns: turns } }; }

// Заход с запомненным диалогом: лента с сервера.
async function open(env, id, turns){
    env.agent.openPanel();
    var get = last(env);
    assert.ok(get.url.indexOf('conversation=' + id) >= 0, 'при заходе запрошен диалог ' + id + ': ' + get.url);
    reply(get, chat(id, turns));
    await flush();
}

test('A: вопрос уходит с id диалога, id запоминается', async function(){
    var env = load();
    env.agent.openPanel();
    reply(last(env), { error: 'нет диалогов' }, 404);   // conversation=latest — диалогов ещё нет
    await flush();
    env.els['ai-agent-input'].value = 'Сколько сделок?';
    env.agent.send();
    var post = last(env);
    assert.strictEqual(post.method, 'POST');
    var cid = post.body.get('conversation');
    assert.ok(/^[a-f0-9]{32}$/.test(cid || ''), 'вопрос несёт id диалога: ' + cid);
    assert.strictEqual(env.ls[KEY], cid, 'id диалога запомнен');
});

test('B: при заходе — вся лента запомненного диалога', async function(){
    var env = load(C1);
    await open(env, C1, [turn('j1', 'Сколько сделок?', '12 сделок'), turn('j2', 'А закрытых?', '5 закрытых')]);
    assert.deepStrictEqual(feed(env), ['Здравствуйте!', 'ВыСколько сделок?', 'ИИ-агент12 сделок', 'ВыА закрытых?', 'ИИ-агент5 закрытых']);
});

test('C: «Новый чат» — пустая лента и новый id', async function(){
    var env = load(C1);
    await open(env, C1, [turn('j1', 'Сколько сделок?', '12 сделок')]);
    var btn = headerButton(env, 'Новый чат');
    assert.ok(btn, 'в шапке есть кнопка «Новый чат»');
    btn.click();
    assert.deepStrictEqual(feed(env), ['Здравствуйте!'], 'в ленте только приветствие');
    env.els['ai-agent-input'].value = 'Добавь таблицу Склад';
    env.agent.send();
    var cid = last(env).body.get('conversation');
    assert.ok(/^[a-f0-9]{32}$/.test(cid) && cid !== C1, 'новый вопрос — в новом диалоге: ' + cid);
    assert.strictEqual(env.ls[KEY], cid);
});

test('D: список чатов — открыть другой диалог', async function(){
    var env = load(C1);
    await open(env, C1, [turn('j1', 'Сколько сделок?', '12 сделок')]);
    headerButton(env, 'Чаты').click();
    var get = last(env);
    assert.ok(/[?&]conversations=1/.test(get.url), 'запрошен список: ' + get.url);
    reply(get, { conversations: [
        { id: C1, title: 'Сколько сделок?', updatedAt: 1700000000 },
        { id: C2, title: 'Добавь таблицу Склад', updatedAt: 1690000000 }
    ] });
    await flush();
    var items = env.panel.findAll('ai-agent-chat-open');
    assert.deepStrictEqual(items.map(function(i){ return i.children[0].textContent; }), ['Сколько сделок?', 'Добавь таблицу Склад']);
    assert.ok(env.panel.findAll('ai-agent-chat-item')[0]._classes['is-active'], 'открытый диалог отмечен');
    items[1].click();
    var load2 = last(env);
    assert.ok(load2.url.indexOf('conversation=' + C2) >= 0, 'запрошена лента второго диалога: ' + load2.url);
    reply(load2, chat(C2, [turn('j3', 'Добавь таблицу Склад', 'Таблица создана')]));
    await flush();
    assert.deepStrictEqual(feed(env), ['Здравствуйте!', 'ВыДобавь таблицу Склад', 'ИИ-агентТаблица создана']);
    assert.strictEqual(env.ls[KEY], C2, 'запомнен открытый диалог');
});

test('E: ответ из прошлого диалога не попадает в открытый после него', async function(){
    var env = load(C1);
    await open(env, C1, []);
    env.els['ai-agent-input'].value = 'Долгий вопрос';
    env.agent.send();
    var post = last(env);
    env.agent.openConversation(C2);
    reply(last(env), chat(C2, [turn('j3', 'Добавь таблицу Склад', 'Таблица создана')]));
    await flush();
    reply(post, { job: turn('j9', 'Долгий вопрос', 'Ответ на долгий вопрос') });
    await flush();
    assert.deepStrictEqual(feed(env), ['Здравствуйте!', 'ВыДобавь таблицу Склад', 'ИИ-агентТаблица создана']);
    assert.strictEqual(env.agent.sending, false, 'во втором диалоге можно спрашивать');
});

test('F: удаление чата в два нажатия; удалён открытый — новый чат', async function(){
    var env = load(C1);
    await open(env, C1, [turn('j1', 'Сколько сделок?', '12 сделок')]);
    headerButton(env, 'Чаты').click();
    reply(last(env), { conversations: [{ id: C1, title: 'Сколько сделок?', updatedAt: 1700000000 }] });
    await flush();
    var del = env.panel.findAll('ai-agent-chat-delete')[0];
    var before = env.calls.length;
    del.click();
    assert.strictEqual(env.calls.length, before, 'первое нажатие только спрашивает');
    del.click();
    var post = last(env);
    assert.strictEqual(post.method, 'POST');
    assert.strictEqual(post.body.get('action'), 'delete_conversation');
    assert.strictEqual(post.body.get('conversation'), C1);
    reply(post, { ok: true, deleted: true });
    await flush();
    assert.strictEqual(env.panel.findAll('ai-agent-chat-item').length, 0, 'строка убрана из списка');
    assert.deepStrictEqual(feed(env), ['Здравствуйте!'], 'лента пуста');
    assert.ok(env.ls[KEY] !== C1 && /^[a-f0-9]{32}$/.test(env.ls[KEY]), 'открыт новый диалог');
});
