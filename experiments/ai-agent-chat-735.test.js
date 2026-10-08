/*
 * ideav/backlogram#735: панель ИИ-агента не перекрывает страницу и меняет ширину.
 * https://github.com/ideav/backlogram/issues/735
 *
 * Из страницы в чат копируют данные, поэтому:
 *   A) открытая панель не закрывает страницу подложкой — область вне чата кликабельна,
 *      а клик по ней панель не закрывает;
 *   B) Esc закрывает панель, только когда фокус внутри неё (Esc на странице — не наш);
 *   C) левый край панели перетаскивается: ширина растёт/сжимается в пределах
 *      [minWidth, окно − зазор], запоминается и восстанавливается при следующей загрузке;
 *      с клавиатуры — стрелками, двойной щелчок сбрасывает ширину.
 *
 * Харнесс без jsdom (как test-issue-3410-ai-agent-dom.js): фейковые document/window.
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
function load(store, innerWidth){
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
        db: 'acme', user: 'acme', location: { pathname: '/acme/main' }, innerWidth: innerWidth || 1400,
        localStorage: {
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

function px(v){ return parseInt(v, 10); }

test('A: открытая панель не перекрывает страницу и не закрывается кликом вне неё', function(){
    var env = load({});
    env.els['ai-chat-toggle'].dispatch('click');
    assert.ok(env.agent.isOpen(), 'панель открыта');
    assert.strictEqual(env.els['ai-agent-backdrop'].hidden, true, 'подложка не показана — страница кликабельна');
    env.els['ai-agent-backdrop'].dispatch('click');
    env.doc.dispatch('click', { target: env.page });
    assert.ok(env.agent.isOpen(), 'клик вне чата не закрывает панель');
});

test('B: Esc закрывает панель только при фокусе внутри неё', function(){
    var env = load({});
    env.agent.openPanel();
    env.page.focus();
    env.doc.dispatch('keydown', { key: 'Escape' });
    assert.ok(env.agent.isOpen(), 'Esc на странице панель не закрывает');
    env.els['ai-agent-input'].focus();
    env.doc.dispatch('keydown', { key: 'Escape' });
    assert.ok(!env.agent.isOpen(), 'Esc в поле чата закрывает панель');
});

test('C: левый край панели меняет ширину, ширина запоминается', function(){
    var store = {};
    var env = load(store, 1400);
    assert.ok(env.resizer, 'у панели есть ручка изменения ширины');
    assert.strictEqual(env.resizer.getAttribute('role'), 'separator');
    env.agent.openPanel();

    var start = env.resizer.dispatch('pointerdown', { clientX: 900, button: 0 });
    assert.ok(start.defaultPrevented, 'перетаскивание не выделяет текст страницы');
    env.doc.dispatch('pointermove', { clientX: 700 });
    assert.strictEqual(px(env.panel.style.width), 460 + 200, 'тянем влево — панель шире');
    env.doc.dispatch('pointermove', { clientX: 1300 });
    assert.strictEqual(px(env.panel.style.width), env.agent.minWidth, 'не уже минимальной ширины');
    env.doc.dispatch('pointermove', { clientX: -5000 });
    var max = px(env.panel.style.width);
    assert.ok(max < 1400 && max >= 1400 - 200, 'не шире окна, слева остаётся видимая полоса страницы: ' + max);
    env.doc.dispatch('pointermove', { clientX: 800 });
    env.doc.dispatch('pointerup', {});
    assert.strictEqual(px(env.panel.style.width), 560);

    // После отпускания движение мыши ширину не меняет.
    env.doc.dispatch('pointermove', { clientX: 100 });
    assert.strictEqual(px(env.panel.style.width), 560);

    // Следующая загрузка страницы — ширина восстановлена.
    var again = load(store, 1400);
    assert.strictEqual(px(again.panel.style.width), 560, 'ширина восстановлена после перезагрузки');

    // Сохранённая ширина больше нового окна — ужимается в окно.
    var narrow = load(store, 500);
    assert.ok(px(narrow.panel.style.width) <= 500, 'в узком окне панель не шире окна');
});

test('C: стрелки на ручке меняют ширину, двойной щелчок сбрасывает', function(){
    var store = {};
    var env = load(store, 1400);
    env.resizer.dispatch('keydown', { key: 'ArrowLeft' });
    var wider = px(env.panel.style.width);
    assert.ok(wider > 460, 'стрелка влево — шире: ' + wider);
    env.resizer.dispatch('keydown', { key: 'ArrowRight' });
    assert.ok(px(env.panel.style.width) < wider, 'стрелка вправо — уже');
    assert.ok(store[Object.keys(store)[0]], 'ширина сохранена');

    env.resizer.dispatch('dblclick', {});
    assert.strictEqual(env.panel.style.width, '', 'сброс к ширине по умолчанию');
    assert.strictEqual(Object.keys(store).length, 0, 'сохранённая ширина удалена');
});

test('C: без localStorage (приватный режим) панель работает', function(){
    var env = load({});
    global.window.localStorage = { getItem: function(){ throw new Error('denied'); }, setItem: function(){ throw new Error('denied'); }, removeItem: function(){ throw new Error('denied'); } };
    env.resizer.dispatch('keydown', { key: 'ArrowLeft' });
    assert.ok(px(env.panel.style.width) > 460);
});
