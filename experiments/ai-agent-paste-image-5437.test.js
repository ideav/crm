/*
 * ideav/crm#5437: картинка из буфера обмена — сразу во вложения ИИ-чата.
 * https://github.com/ideav/crm/issues/5437
 *
 *   A) Ctrl+V скриншота в поле чата кладёт картинку во вложения (без сохранения
 *      файла и скрепки); стандартная вставка подавлена — в поле ничего не вставляется;
 *   B) у вставленной картинки осмысленное уникальное имя с расширением по типу —
 *      две вставки подряд не дают двух «image.png»;
 *   C) буфер с текстом (копия ячеек Excel несёт и text/plain, и картинку) — обычная
 *      вставка текста, вложение не создаётся; не-картинки из буфера не берутся;
 *   D) вставленная картинка уходит на сервер в files[] вместе с сообщением.
 *
 * Харнесс — из ai-agent-chat-735.test.js (фейковые document/window).
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


function blob(type, size){ return { type: type, size: size || 10, name: 'image.png' }; }
function clip(items){
    return {
        types: items.map(function(it){ return it.kind === 'string' ? it.type : 'Files'; }),
        items: items.map(function(it){
            return { kind: it.kind || 'file', type: it.type, getAsFile: function(){ return it.file || null; } };
        }),
        getData: function(t){ var it = items.filter(function(x){ return x.type === t; })[0]; return it ? it.text : ''; }
    };
}
// paste всплывает, как в браузере: поле ввода → … → панель.
function paste(el, data){
    var e = { clipboardData: data, target: el };
    for(var n = el; n; n = n.parentNode) n.dispatch('paste', e);
    return e;
}

test('A: скриншот из буфера попадает во вложения, вставка в поле подавлена', function(){
    var env = load({});
    var e = paste(env.els['ai-agent-input'], clip([{ type: 'image/png', file: blob('image/png') }]));
    assert.strictEqual(e.defaultPrevented, true, 'обычная вставка подавлена');
    assert.strictEqual(env.agent.attachments.length, 1, 'одно вложение');
    assert.strictEqual(env.agent.attachments[0].type, 'image/png');
    assert.strictEqual(env.els['ai-agent-attachments'].children.length, 1, 'вложение показано в списке');
});

test('B: имена вставленных картинок уникальны и с расширением по типу', function(){
    var env = load({});
    var input = env.els['ai-agent-input'];
    paste(input, clip([{ type: 'image/png', file: blob('image/png') }]));
    paste(input, clip([{ type: 'image/jpeg', file: blob('image/jpeg') }]));
    var names = env.agent.attachments.map(function(f){ return f.name; });
    assert.strictEqual(names.length, 2);
    assert.notStrictEqual(names[0], names[1], 'имена различаются: ' + names.join(', '));
    assert.match(names[0], /\.png$/);
    assert.match(names[1], /\.jpe?g$/);
});

test('C: буфер с текстом — обычная вставка, не-картинки не берутся', function(){
    var env = load({});
    var input = env.els['ai-agent-input'];
    var e = paste(input, clip([
        { kind: 'string', type: 'text/plain', text: 'A1\tB1' },
        { type: 'image/png', file: blob('image/png') }
    ]));
    assert.ok(!e.defaultPrevented, 'текст вставляется как обычно');
    assert.strictEqual(env.agent.attachments.length, 0, 'картинка-снимок ячеек не прикреплена');
    e = paste(input, clip([{ type: 'application/pdf', file: blob('application/pdf') }]));
    assert.ok(!e.defaultPrevented);
    assert.strictEqual(env.agent.attachments.length, 0, 'не-картинка из буфера не прикреплена');
    e = paste(input, { types: [], items: null, getData: function(){ return ''; } });
    assert.strictEqual(env.agent.attachments.length, 0, 'пустой буфер не ломает вставку');
});

test('D: вставленная картинка уходит в files[] вместе с сообщением', async function(){
    var env = load({});
    var sent = [];
    global.FormData = function(){ this.parts = []; };
    global.FormData.prototype.append = function(k, v, n){ this.parts.push([k, v, n]); };
    global.fetch = function(url, opts){
        if(opts && opts.body) sent.push(opts.body);
        return Promise.resolve({ ok: true, status: 200, json: function(){ return Promise.resolve({ job: null }); } });
    };
    paste(env.els['ai-agent-input'], clip([{ type: 'image/png', file: blob('image/png') }]));
    var name = env.agent.attachments[0].name;
    env.els['ai-agent-input'].value = 'что на скриншоте?';
    env.agent.send();
    await new Promise(function(r){ setImmediate(r); });
    var form = sent.filter(function(b){ return b && b.parts; })[0];
    assert.ok(form, 'форма отправлена');
    var files = form.parts.filter(function(p){ return p[0] === 'files[]'; });
    assert.strictEqual(files.length, 1, 'одна картинка в files[]');
    assert.strictEqual(files[0][2], name, 'под тем же именем');
    assert.strictEqual(env.agent.attachments.length, 0, 'после отправки вложения очищены');
});
