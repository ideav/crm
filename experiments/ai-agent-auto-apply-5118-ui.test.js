/*
 * ideav/crm#5118 (python2node#869): галка «Применить автоматически» в чате ИИ-агента.
 * https://github.com/ideav/crm/issues/5118
 *
 * Галка стоит — чат не просит подтверждения: вопрос уходит с auto_apply=1, и агент
 * исполняет план сразу. Галка не сохраняется: её ставят в каждой сессии заново.
 *   A1) галка снята — auto_apply не отправляется;
 *   A2) галка стоит — вопрос и кнопка действия из ответа идут с auto_apply=1;
 *   A3) кнопки плана («Применить»/«Отменить») — действие над планом, auto_apply не нужен;
 *   A4) галка не пишется в localStorage/sessionStorage и после перезагрузки снята;
 *   A5) шаблон: галка в композере, autocomplete="off" (браузер не восстанавливает её при
 *       перезагрузке).
 *
 * Run with: node experiments/ai-agent-auto-apply-5118-ui.test.js
 */
'use strict';

var fs = require('fs');
var realSetTimeout = global.setTimeout;
var path = require.resolve('../js/ai-agent-chat.js');

var failures = 0;
function expect(cond, name){
    if(cond){ console.log('PASS: ' + name); } else { console.log('FAIL: ' + name); failures++; }
}
function flush(){ return new Promise(function(res){ realSetTimeout(res, 0); }); }
function settle(){ return flush().then(flush).then(flush).then(flush); }

// --- Минимальный фейковый DOM (как в ai-agent-plan-846-ui.test.js) ---
function FE(tag){
    this.tag = tag; this.children = []; this.attrs = {}; this._classes = {};
    this._text = ''; this.style = {}; this.parentNode = null;
    this.scrollTop = 0; this.scrollHeight = 100; this.disabled = false;
    this.hidden = false; this.value = ''; this.checked = false; this.listeners = {};
    var self = this;
    this.classList = {
        add: function(c){ self._classes[c] = true; },
        remove: function(c){ delete self._classes[c]; },
        contains: function(c){ return !!self._classes[c]; },
        toggle: function(c){ self._classes[c] = !self._classes[c]; }
    };
}
FE.prototype.appendChild = function(c){ c.parentNode = this; this.children.push(c); return c; };
FE.prototype.setAttribute = function(k, v){ this.attrs[k] = v; };
FE.prototype.removeAttribute = function(k){ delete this.attrs[k]; };
FE.prototype.getAttribute = function(k){ return this.attrs.hasOwnProperty(k) ? this.attrs[k] : null; };
FE.prototype.addEventListener = function(ev, fn){ this.listeners[ev] = fn; };
FE.prototype.focus = function(){};
FE.prototype.click = function(){ if(!this.disabled && this.listeners.click) this.listeners.click({ preventDefault: function(){} }); };
FE.prototype.querySelector = function(sel){ return findByClass(this, sel.charAt(0) === '.' ? sel.slice(1) : sel); };
Object.defineProperty(FE.prototype, 'textContent', {
    get: function(){ return this._text; },
    set: function(v){ this._text = (v === undefined || v === null) ? '' : String(v); this.children = []; }
});
Object.defineProperty(FE.prototype, 'innerHTML', {
    get: function(){ return this._html || ''; },
    set: function(v){ this._html = String(v); if(v === '') this.children = []; }
});
Object.defineProperty(FE.prototype, 'className', {
    get: function(){ return Object.keys(this._classes).join(' '); },
    set: function(v){ this._classes = {}; var self = this; String(v).split(/\s+/).forEach(function(c){ if(c) self._classes[c] = true; }); }
});
function findByClass(node, cls){
    for(var i = 0; i < node.children.length; i++){
        var ch = node.children[i];
        if(ch._classes && ch._classes[cls]) return ch;
        var deep = findByClass(ch, cls);
        if(deep) return deep;
    }
    return null;
}
function buttonsIn(node){
    var out = [];
    (function walk(n){ n.children.forEach(function(ch){ if(ch.tag === 'button') out.push(ch); walk(ch); }); })(node);
    return out;
}

var IDS = ['ai-chat-toggle','ai-agent-panel','ai-agent-backdrop','ai-agent-close','ai-agent-input',
    'ai-agent-send','ai-agent-attach','ai-agent-files','ai-agent-messages','ai-agent-attachments','ai-agent-status',
    'ai-agent-auto-apply'];

function fakeStorage(log){
    var data = {};
    return {
        getItem: function(k){ return data.hasOwnProperty(k) ? data[k] : null; },
        setItem: function(k, v){ log.push(k + '=' + v); data[k] = String(v); },
        removeItem: function(k){ delete data[k]; }
    };
}

function fresh(fetchHandler, writes){
    var els = {};
    IDS.forEach(function(id){ els[id] = new FE(id === 'ai-agent-auto-apply' ? 'input' : 'div'); });
    new FE('div').appendChild(els['ai-agent-messages']);
    global.document = {
        readyState: 'complete',
        getElementById: function(id){ return els[id] || null; },
        createElement: function(tag){ return new FE(tag); },
        addEventListener: function(){},
        querySelector: function(){ return null; }
    };
    writes = writes || [];
    global.window = { db: 'acme', user: 'petrov', xsrf: 'x1', location: { pathname: '/acme/main' },
        localStorage: fakeStorage(writes), sessionStorage: fakeStorage(writes) };
    global.localStorage = global.window.localStorage;
    global.sessionStorage = global.window.sessionStorage;
    global.setInterval = function(){ return {}; };
    global.clearInterval = function(){};
    var posts = [];
    global.fetch = function(url, opts){
        opts = opts || {};
        if((opts.method || 'GET') === 'POST') posts.push(opts.body);
        var res = fetchHandler(url, opts, posts.length);
        return Promise.resolve({ ok: true, status: 200, json: function(){ return Promise.resolve(res); } });
    };
    delete require.cache[path];
    var agent = require(path);
    return { agent: agent, els: els, posts: posts, writes: writes };
}

function lastAssistant(els){
    var list = els['ai-agent-messages'].children.filter(function(m){ return !m._classes['ai-chat-message-user']; });
    return list[list.length - 1];
}

var PENDING = { id: 'jP', status: 'pending', summary: ['Удалю 1 запись'], undo: false };
function job(id, plan, blocks){
    var result = { assistant: { content: 'ответ ' + id } };
    if(plan) result.plan = plan;
    if(blocks) result.blocks = blocks;
    return { job: { id: id, status: 'done', message: 'вопрос', result: result } };
}

function a1(){
    var ctx = fresh(function(url, opts){ return (opts.method || 'GET') === 'POST' ? job('j1') : { job: null }; });
    ctx.els['ai-agent-input'].value = 'закрой сделки';
    ctx.agent.send();
    return settle().then(function(){
        var body = ctx.posts[0];
        expect(body && body.get('message') === 'закрой сделки', 'A1: вопрос отправлен');
        expect(body && body.get('auto_apply') === null, 'A1: галка снята — auto_apply не отправляется');
    });
}

function a2(){
    var actions = [{ type: 'text', text: 'ответ' }, { type: 'actions', items: [{ label: 'Ещё', message: 'Закрой и остальные' }] }];
    var ctx = fresh(function(url, opts, n){
        if((opts.method || 'GET') !== 'POST') return { job: null };
        return n === 1 ? job('j1', null, actions) : job('j2');
    });
    ctx.els['ai-agent-auto-apply'].checked = true;
    ctx.els['ai-agent-input'].value = 'закрой сделки';
    ctx.agent.send();
    return settle().then(function(){
        var body = ctx.posts[0];
        expect(body && body.get('auto_apply') === '1', 'A2: галка стоит — вопрос идёт с auto_apply=1');
        ctx.agent.send('Закрой и остальные');
        return settle();
    }).then(function(){
        var body = ctx.posts[1];
        expect(body && body.get('message') === 'Закрой и остальные' && body.get('auto_apply') === '1',
            'A2: кнопка действия из ответа тоже идёт с auto_apply=1');
    });
}

function a3(){
    var ctx = fresh(function(url, opts, n){
        if((opts.method || 'GET') !== 'POST') return { job: null };
        return n === 1 ? job('jP', PENDING) : job('jA', { id: 'jP', status: 'applied', summary: [], undo: true });
    });
    ctx.els['ai-agent-input'].value = 'удали дубль';
    ctx.agent.send();
    return settle().then(function(){
        ctx.els['ai-agent-auto-apply'].checked = true;
        buttonsIn(lastAssistant(ctx.els))[0].click();
        var body = ctx.posts[1];
        expect(body && body.get('action') === 'apply', 'A3: «Применить» шлёт action=apply');
        expect(body && body.get('auto_apply') === null, 'A3: действие над планом идёт без auto_apply');
    });
}

function a4(){
    var writes = [];
    var ctx = fresh(function(url, opts){ return (opts.method || 'GET') === 'POST' ? job('j1') : { job: null }; }, writes);
    var box = ctx.els['ai-agent-auto-apply'];
    box.checked = true;
    if(box.listeners.change) box.listeners.change({});
    ctx.els['ai-agent-input'].value = 'закрой сделки';
    ctx.agent.send();
    return settle().then(function(){
        expect(!writes.some(function(w){ return /auto/i.test(w); }), 'A4: галка не пишется в storage (' + writes.join(', ') + ')');
        // «Перезагрузка»: новая страница с тем же хранилищем — галка снята.
        var again = fresh(function(url, opts){ return (opts.method || 'GET') === 'POST' ? job('j2') : { job: null }; }, writes);
        again.els['ai-agent-input'].value = 'ещё';
        again.agent.send();
        return settle().then(function(){
            expect(again.els['ai-agent-auto-apply'].checked === false, 'A4: после перезагрузки галка снята');
            expect(again.posts[0] && again.posts[0].get('auto_apply') === null, 'A4: после перезагрузки auto_apply не отправляется');
        });
    });
}

function a5(){
    var html = fs.readFileSync(require.resolve('../templates/main.html'), 'utf8');
    var composer = html.slice(html.indexOf('ai-chat-composer'), html.indexOf('</aside>', html.indexOf('ai-chat-composer')));
    var tag = (composer.match(/<input[^>]*id="ai-agent-auto-apply"[^>]*>/) || [''])[0];
    expect(/type="checkbox"/.test(tag), 'A5: в композере есть галка #ai-agent-auto-apply');
    expect(/autocomplete="off"/.test(tag), 'A5: autocomplete="off" — браузер не восстанавливает галку');
    expect(!/\bchecked\b/.test(tag), 'A5: по умолчанию галка снята');
    expect(composer.indexOf('Применить автоматически') !== -1, 'A5: подпись «Применить автоматически»');
}

a1().then(a2).then(a3).then(a4).then(a5).then(function(){
    console.log('');
    if(failures){ console.log('FAILED: ' + failures); process.exitCode = 1; }
    else console.log('ALL TESTS PASSED');
}).catch(function(e){ console.log('FAIL: исключение ' + (e && e.stack || e)); process.exitCode = 1; });
