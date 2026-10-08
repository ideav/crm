/*
 * python2node#846: кнопки плана ИИ-агента в чате (js/ai-agent-chat.js).
 * https://github.com/ideav/python2node/issues/846
 *
 * Агент, которого просят изменить данные, отвечает планом; сервис присылает его в
 * result.plan. Проверяется поведение чата:
 *   P1) план pending → «Применить» и «Отменить»; «Применить» отправляет action=apply с id
 *       плана, кнопки плана гаснут; ответ applied с отменой → кнопка «Отменить» → action=undo;
 *   P2) ответ без плана — без кнопок;
 *   P3) план восстанавливается с кнопками при открытии панели (другой браузер);
 *   P4) «Отменить» у плана pending → action=cancel;
 *   P5) выполненный план без отмены и отменённый план — без кнопок.
 *
 * Run with: node experiments/ai-agent-plan-846-ui.test.js
 */
'use strict';

var realSetTimeout = global.setTimeout;
var path = require.resolve('../js/ai-agent-chat.js');

var failures = 0;
function expect(cond, name){
    if(cond){ console.log('PASS: ' + name); } else { console.log('FAIL: ' + name); failures++; }
}
function flush(){ return new Promise(function(res){ realSetTimeout(res, 0); }); }
function settle(){ return flush().then(flush).then(flush).then(flush); }

// --- Минимальный фейковый DOM ---
function FE(tag){
    this.tag = tag; this.children = []; this.attrs = {}; this._classes = {};
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
    'ai-agent-send','ai-agent-attach','ai-agent-files','ai-agent-messages','ai-agent-attachments','ai-agent-status'];

function fresh(fetchHandler){
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
    global.window = { db: 'acme', user: 'petrov', xsrf: 'x1', location: { pathname: '/acme/main' } };
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
    return { agent: agent, els: els, posts: posts };
}

// Сообщения ленты: роль, текст и кнопки.
function feed(els){
    return els['ai-agent-messages'].children.map(function(m){
        var t = m.querySelector('.ai-chat-message-text');
        return { role: m._classes['ai-chat-message-user'] ? 'user' : 'assistant', text: t ? t.textContent : '',
                 buttons: buttonsIn(m), el: m };
    });
}
function last(els, role){ return feed(els).filter(function(m){ return m.role === role; }).pop(); }
function labels(msg){ return msg ? msg.buttons.map(function(b){ return b.textContent; }) : []; }

var PENDING = { id: 'jP', status: 'pending', summary: ['Изменю 3 записи таблицы «Сделка»: Статус → «Закрыта»'], undo: false };
function job(id, plan, message){
    var result = { assistant: { content: 'ответ ' + id } };
    if(plan) result.plan = plan;
    return { job: { id: id, status: 'done', message: message || 'вопрос', result: result } };
}

function p1(){
    var ctx = fresh(function(url, opts, n){
        if((opts.method || 'GET') !== 'POST') return { job: null };
        if(n === 1) return job('jP', PENDING, 'закрой сделки');
        if(n === 2) return job('jA', { id: 'jP', status: 'applied', summary: PENDING.summary, undo: true }, 'Применить план');
        return job('jU', { id: 'jP', status: 'undone', summary: PENDING.summary, undo: false }, 'Отменить действие агента');
    });
    var a = ctx.agent, els = ctx.els;
    els['ai-agent-input'].value = 'закрой сделки';
    a.send();
    return settle().then(function(){
        var ans = last(els, 'assistant');
        expect(JSON.stringify(labels(ans)) === JSON.stringify(['Применить', 'Отменить']), 'P1: план pending — «Применить» и «Отменить» (' + labels(ans) + ')');
        ans.buttons[0].click();
        var body = ctx.posts[1];
        expect(body && body.get('action') === 'apply' && body.get('plan') === 'jP', 'P1: «Применить» шлёт action=apply и id плана');
        expect(body && body.get('_xsrf') === 'x1', 'P1: действие идёт с _xsrf');
        expect(last(els, 'user').text === 'Применить план', 'P1: в ленте реплика «Применить план»');
        expect(ans.buttons.every(function(b){ return b.disabled; }), 'P1: кнопки плана погашены после нажатия');
        return settle();
    }).then(function(){
        var ans = last(els, 'assistant');
        expect(JSON.stringify(labels(ans)) === JSON.stringify(['Отменить']), 'P1: после «Применить» — кнопка «Отменить» (' + labels(ans) + ')');
        ans.buttons[0].click();
        var body = ctx.posts[2];
        expect(body && body.get('action') === 'undo' && body.get('plan') === 'jP', 'P1: «Отменить» выполненного шлёт action=undo');
        return settle();
    }).then(function(){
        expect(labels(last(els, 'assistant')).length === 0, 'P1: после отмены кнопок нет');
        var stale = feed(els).filter(function(m){ return m.role === 'assistant'; })
            .reduce(function(all, m){ return all.concat(m.buttons); }, []);
        expect(stale.every(function(b){ return b.disabled; }), 'P1: все прежние кнопки этого плана погашены');
    });
}

function p2(){
    var ctx = fresh(function(url, opts){ return (opts.method || 'GET') === 'POST' ? job('j2') : { job: null }; });
    ctx.els['ai-agent-input'].value = 'сколько сделок?';
    ctx.agent.send();
    return settle().then(function(){
        expect(last(ctx.els, 'assistant').text === 'ответ j2' && labels(last(ctx.els, 'assistant')).length === 0, 'P2: ответ без плана — без кнопок');
    });
}

function p3(){
    var ctx = fresh(function(url, opts){ return (opts.method || 'GET') === 'POST' ? job('x') : job('jR', PENDING, 'закрой сделки'); });
    return settle().then(function(){
        var ans = last(ctx.els, 'assistant');
        expect(JSON.stringify(labels(ans)) === JSON.stringify(['Применить', 'Отменить']), 'P3: восстановленный план — с кнопками');
    });
}

function p4(){
    var ctx = fresh(function(url, opts, n){
        if((opts.method || 'GET') !== 'POST') return { job: null };
        return n === 1 ? job('jP', PENDING) : job('jC', { id: 'jP', status: 'cancelled', summary: [], undo: false });
    });
    ctx.els['ai-agent-input'].value = 'удали дубли';
    ctx.agent.send();
    return settle().then(function(){
        last(ctx.els, 'assistant').buttons[1].click();
        var body = ctx.posts[1];
        expect(body && body.get('action') === 'cancel' && body.get('plan') === 'jP', 'P4: «Отменить» плана шлёт action=cancel');
        expect(last(ctx.els, 'user').text === 'Отменить план', 'P4: в ленте реплика «Отменить план»');
        return settle();
    }).then(function(){
        expect(labels(last(ctx.els, 'assistant')).length === 0, 'P4: отменённый план — без кнопок');
    });
}

function p5(){
    var ctx = fresh(function(url, opts){
        return (opts.method || 'GET') === 'POST' ? job('j5', { id: 'j5', status: 'applied', summary: [], undo: false }) : { job: null };
    });
    ctx.els['ai-agent-input'].value = 'поменяй';
    ctx.agent.send();
    return settle().then(function(){
        expect(labels(last(ctx.els, 'assistant')).length === 0, 'P5: выполненный план без отмены — без кнопок');
    });
}

p1().then(p2).then(p3).then(p4).then(p5).then(function(){
    console.log('');
    if(failures){ console.log('FAILED: ' + failures); process.exitCode = 1; }
    else console.log('ALL TESTS PASSED');
}).catch(function(e){ console.log('FAIL: исключение ' + (e && e.stack || e)); process.exitCode = 1; });
