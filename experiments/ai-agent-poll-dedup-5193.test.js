/*
 * ideav/crm#5193: один ответ ИИ-агента — один пузырь в ленте.
 * https://github.com/ideav/crm/issues/5193
 *
 * Опрос статуса идёт по setInterval раз в 2,5 с. Когда сеть тормозит (в консоли
 * ERR_PROXY_CONNECTION_FAILED), запросы опроса копятся в полёте, и каждый вернувшийся
 * «done» дорисовывал ответ заново — 9 одинаковых ответов. Запоздавший опрос прошлой
 * задачи подменял «думает» следующего вопроса прошлым ответом. Проверяем:
 *   A) несколько опросов одной задачи вернули «done» — в ленте один ответ;
 *   B) пока опрос в полёте, следующий тик не шлёт новый запрос;
 *   C) запоздавший «done» прошлой задачи не занимает место ответа на новый вопрос;
 *   D) отправка не дошла, а последняя задача на сервере — уже показанная прошлая:
 *      прошлый ответ не повторяется, вместо него — сообщение об ошибке связи.
 *
 * Харнесс — как в ai-agent-draft-5171.test.js: фейковые document/window без jsdom,
 * fetch и таймер опроса управляются из теста.
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
FE.prototype.appendChild = function(c){ c.parentNode = this; this.children.push(c); return c; };
FE.prototype.setAttribute = function(k, v){ this.attrs[k] = String(v); };
FE.prototype.removeAttribute = function(k){ delete this.attrs[k]; };
FE.prototype.getAttribute = function(k){ return this.attrs.hasOwnProperty(k) ? this.attrs[k] : null; };
FE.prototype.addEventListener = function(ev, fn){ (this.listeners[ev] = this.listeners[ev] || []).push(fn); };
FE.prototype.contains = function(node){
    for(var n = node; n; n = n.parentNode) if(n === this) return true;
    return false;
};
FE.prototype.focus = function(){ global.document.activeElement = this; };
FE.prototype.click = function(){};
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
Object.defineProperty(FE.prototype, 'className', {
    get: function(){ return Object.keys(this._classes).join(' '); },
    set: function(v){ var s = this; s._classes = {}; String(v).split(/\s+/).forEach(function(c){ if(c) s._classes[c] = true; }); }
});
Object.defineProperty(FE.prototype, 'textContent', {
    get: function(){ return this._text || ''; }, set: function(v){ this._text = String(v); }
});
Object.defineProperty(FE.prototype, 'innerHTML', {
    get: function(){ return ''; }, set: function(){ this.children = []; }
});

var IDS = ['ai-chat-toggle', 'ai-agent-panel', 'ai-agent-backdrop', 'ai-agent-close', 'ai-agent-input',
    'ai-agent-send', 'ai-agent-attach', 'ai-agent-files', 'ai-agent-messages', 'ai-agent-attachments', 'ai-agent-status'];

function allText(node){
    return (node._text || '') + node.children.map(allText).join('');
}

// Каждый fetch — отложенный ответ: тест сам решает, когда и чем он завершится.
function load(){
    var els = {};
    IDS.forEach(function(id){ els[id] = new FE('div'); });
    var panel = els['ai-agent-panel'];
    var body = new FE('div');
    body.appendChild(els['ai-agent-messages']);
    panel.appendChild(body);

    var doc = new FE('document');
    doc.readyState = 'complete';
    doc.body = new FE('body');
    doc.activeElement = doc.body;
    doc.getElementById = function(id){ return els[id] || null; };
    doc.createElement = function(tag){ return new FE(tag); };
    global.document = doc;
    global.window = { db: 'ateh', user: 'ateh', location: { pathname: '/ateh/main', search: '' }, innerWidth: 1400 };

    var calls = [];
    var ticks = [];
    global.setInterval = function(fn){ ticks.push(fn); return ticks.length; };
    global.clearInterval = function(){};
    global.fetch = function(url, opts){
        var call = { url: String(url), method: (opts && opts.method) || 'GET' };
        call.promise = new Promise(function(resolve, reject){ call.resolve = resolve; call.reject = reject; });
        calls.push(call);
        return call.promise;
    };

    delete require.cache[path];
    var agent = require(path);
    agent.resumeChecked = true;
    return { agent: agent, els: els, calls: calls };
}

function reply(call, data){
    call.resolve({ ok: true, status: 200, json: function(){ return Promise.resolve(data); } });
}

function flush(){ return new Promise(function(r){ setImmediate(r); }); }

function assistantTexts(env){
    return env.els['ai-agent-messages'].children
        .filter(function(m){ return m._classes['ai-chat-message-assistant'] && !m._classes['ai-chat-message-thinking']; })
        .map(allText);
}

function done(id, content){ return { job: { id: id, status: 'done', result: { assistant: { content: content } } } }; }
function processing(id){ return { job: { id: id, status: 'processing' } }; }

// Опросы задачи (без начального запроса последней задачи при загрузке).
function polls(env){ return env.calls.filter(function(c){ return /[?&]job=/.test(c.url); }); }

// Вопрос → сервер принял задачу → опрос запущен.
async function ask(env, text, jobId){
    env.agent.send(text);
    var post = env.calls[env.calls.length - 1];
    assert.strictEqual(post.method, 'POST');
    reply(post, processing(jobId));
    await flush();
}

test('A: несколько опросов вернули «done» — ответ в ленте один', async function(){
    var env = load();
    await ask(env, 'Заказ 6042 — проверь резки', 'j1');
    // Сеть тормозит: три тика опроса, ни один не вернулся.
    env.agent.pollOnce();
    var first = polls(env)[0];
    env.agent.pollInFlight = false;   // на случай, если ограничение одного запроса снято — моделируем худшее
    env.agent.pollOnce();
    env.agent.pollInFlight = false;
    env.agent.pollOnce();
    polls(env).forEach(function(c){ reply(c, done('j1', 'Факт 7 резок')); });
    await flush();
    assert.ok(first, 'опрос ушёл');
    assert.deepStrictEqual(assistantTexts(env).filter(function(t){ return /Факт 7 резок/.test(t); }).length, 1,
        'ответ на один вопрос показан один раз: ' + JSON.stringify(assistantTexts(env)));
});

test('B: пока опрос в полёте, новый тик не шлёт второй запрос', async function(){
    var env = load();
    await ask(env, 'вопрос', 'j1');
    env.agent.pollOnce();
    env.agent.pollOnce();
    env.agent.pollOnce();
    assert.strictEqual(polls(env).length, 1, 'в полёте один опрос, а не очередь');
    reply(polls(env)[0], processing('j1'));
    await flush();
    env.agent.pollOnce();
    assert.strictEqual(polls(env).length, 2, 'после ответа опрос продолжается');
});

test('C: запоздавший «done» прошлой задачи не подменяет ответ на новый вопрос', async function(){
    var env = load();
    await ask(env, 'Заказ 6042 — проверь резки', 'j1');
    env.agent.pollOnce();
    var stale = polls(env)[0];               // завис в полёте
    var fresh = done('j1', 'Факт 7 резок');
    // Ответ пришёл другим путём (повторный опрос после восстановления сети).
    env.agent.pollInFlight = false;
    env.agent.pollOnce();
    reply(polls(env)[1], fresh);
    await flush();

    await ask(env, 'Исправить факт на 12', 'j2');
    reply(stale, fresh);                     // старый запрос наконец вернулся
    await flush();
    assert.strictEqual(assistantTexts(env).filter(function(t){ return /Факт 7 резок/.test(t); }).length, 1,
        'прошлый ответ не продублирован');

    env.agent.pollOnce();
    var last = polls(env)[polls(env).length - 1];
    assert.ok(/job=j2/.test(last.url), 'опрашивается новая задача: ' + last.url);
    reply(last, done('j2', 'Факт исправлен на 12'));
    await flush();
    assert.deepStrictEqual(assistantTexts(env), ['ИИ-агентФакт 7 резок', 'ИИ-агентФакт исправлен на 12']);
});

test('D: отправка не дошла — прошлый ответ не выдаётся за новый', async function(){
    var env = load();
    await ask(env, 'Заказ 6042 — проверь резки', 'j1');
    env.agent.pollOnce();
    reply(polls(env)[0], done('j1', 'Факт 7 резок'));
    await flush();

    env.agent.send('Исправить факт на 12');
    var post = env.calls[env.calls.length - 1];
    post.reject(new TypeError('Failed to fetch'));   // ERR_PROXY_CONNECTION_FAILED
    await flush();
    var recover = env.calls[env.calls.length - 1];
    assert.strictEqual(recover.method, 'GET');
    reply(recover, done('j1', 'Факт 7 резок'));       // последняя задача — всё та же прошлая
    await flush();
    var texts = assistantTexts(env);
    assert.strictEqual(texts.filter(function(t){ return /Факт 7 резок/.test(t); }).length, 1, 'прошлый ответ не повторён');
    assert.ok(/Не удалось связаться/.test(texts[texts.length - 1]), 'вместо него — ошибка связи: ' + texts[texts.length - 1]);
    assert.strictEqual(env.agent.sending, false, 'можно отправить снова');
});
