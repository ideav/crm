/*
 * ideav/crm#5171: черновик сообщения ИИ-агенту не пропадает.
 * https://github.com/ideav/crm/issues/5171
 *
 * Пользователь набрал текст, не отправил, ушёл на другую вкладку/страницу — при
 * возврате текст должен быть в поле ввода. Черновик живёт в localStorage:
 *   A) ввод сохраняется и восстанавливается при следующей загрузке страницы;
 *   B) отправка стирает черновик;
 *   C) стёртое поле стирает черновик;
 *   D) черновик одной базы/пользователя не попадает в другую базу/к другому пользователю;
 *   E) без localStorage (приватный режим) чат работает, просто без черновика.
 *
 * Харнесс — как в ai-agent-chat-735.test.js: фейковые document/window без jsdom.
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
FE.prototype.dispatch = function(ev, e){
    e = e || {}; e.type = ev; e.target = e.target || this;
    e.preventDefault = function(){ e.defaultPrevented = true; };
    (this.listeners[ev] || []).forEach(function(fn){ fn(e); });
    return e;
};
FE.prototype.contains = function(node){
    for(var n = node; n; n = n.parentNode) if(n === this) return true;
    return false;
};
FE.prototype.focus = function(){ global.document.activeElement = this; };
FE.prototype.click = function(){};
FE.prototype.querySelector = function(){ return null; };
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

function findByClass(node, cls){
    for(var i = 0; i < node.children.length; i++){
        var ch = node.children[i];
        if(ch._classes[cls]) return ch;
        var deep = findByClass(ch, cls);
        if(deep) return deep;
    }
    return null;
}

// store — общий «localStorage» между загрузками страницы (как у браузера).
function load(store, innerWidth, opts){
    opts = opts || {};
    var els = {};
    IDS.forEach(function(id){ els[id] = new FE('div'); });
    var panel = els['ai-agent-panel'];
    ['ai-agent-close', 'ai-agent-input', 'ai-agent-send', 'ai-agent-attach', 'ai-agent-status'].forEach(function(id){
        panel.appendChild(els[id]);
    });
    var body = new FE('div');
    body.appendChild(els['ai-agent-messages']);
    panel.appendChild(body);
    els['ai-agent-backdrop'].hidden = true;   // старая разметка: <div id="ai-agent-backdrop" hidden>
    var page = new FE('main');   // содержимое страницы вне чата

    var doc = new FE('document');
    doc.readyState = 'complete';
    doc.body = new FE('body');
    doc.activeElement = doc.body;
    doc.getElementById = function(id){ return els[id] || null; };
    doc.createElement = function(tag){ return new FE(tag); };
    global.document = doc;
    global.window = {
        db: opts.db || 'acme', user: opts.user || 'acme', location: { pathname: '/' + (opts.db || 'acme') + '/main' }, innerWidth: innerWidth || 1400,
        localStorage: store === null ? undefined : {
            getItem: function(k){ return store.hasOwnProperty(k) ? store[k] : null; },
            setItem: function(k, v){ store[k] = String(v); },
            removeItem: function(k){ delete store[k]; }
        }
    };
    global.setInterval = function(){ return {}; };
    global.clearInterval = function(){};
    global.fetch = function(){ return Promise.resolve({ ok: true, status: 200, json: function(){ return Promise.resolve({ job: null }); } }); };

    delete require.cache[path];
    var agent = require(path);
    return { agent: agent, els: els, panel: panel, page: page, doc: doc, resizer: findByClass(panel, 'ai-agent-resizer') };
}


function type(env, text){
    var input = env.els['ai-agent-input'];
    input.value = text;
    input.dispatch('input');
}

test('A: набранный текст переживает перезагрузку страницы', function(){
    var store = {};
    var env = load(store);
    type(env, 'покажи заказы за май');
    var env2 = load(store);
    assert.strictEqual(env2.els['ai-agent-input'].value, 'покажи заказы за май');
});

test('B: отправка стирает черновик', function(){
    var store = {};
    var env = load(store);
    type(env, 'привет');
    env.agent.send();
    assert.strictEqual(env.els['ai-agent-input'].value, '');
    var env2 = load(store);
    assert.strictEqual(env2.els['ai-agent-input'].value, '', 'после отправки старый текст не возвращается');
});

test('C: очищенное поле стирает черновик', function(){
    var store = {};
    var env = load(store);
    type(env, 'черновик');
    type(env, '');
    assert.deepStrictEqual(Object.keys(store).filter(function(k){ return /draft/.test(k); }), []);
});

test('D: черновик привязан к базе и пользователю', function(){
    var store = {};
    type(load(store, 0, { db: 'acme', user: 'ivan' }), 'для acme');
    assert.strictEqual(load(store, 0, { db: 'other', user: 'ivan' }).els['ai-agent-input'].value, '', 'другая база');
    assert.strictEqual(load(store, 0, { db: 'acme', user: 'petr' }).els['ai-agent-input'].value, '', 'другой пользователь');
    assert.strictEqual(load(store, 0, { db: 'acme', user: 'ivan' }).els['ai-agent-input'].value, 'для acme');
});

test('E: без localStorage ввод и отправка работают', function(){
    var env = load(null);
    assert.doesNotThrow(function(){ type(env, 'текст'); env.agent.send(); });
    assert.strictEqual(env.els['ai-agent-input'].value, '');
});
