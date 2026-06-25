/*
 * Regression test for issue #3410 (клиентская проводка js/ai-agent-chat.js).
 * https://github.com/ideav/crm/issues/3410
 *
 * Лёгкий харнесс без jsdom: подменяем document/window/fetch/setInterval и
 * проверяем поведение целиком:
 *   A) отправка -> «думает» -> готовый ответ в ленте;
 *   B) восстановление последней задачи при загрузке (заход с другого браузера);
 *   C) долгая задача -> поллинг статуса -> готовый ответ, таймеры остановлены.
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
FE.prototype.click = function(){};
FE.prototype.querySelector = function(sel){
    var cls = sel.charAt(0) === '.' ? sel.slice(1) : sel;
    return findByClass(this, cls);
};
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

var IDS = ['ai-chat-toggle','ai-agent-panel','ai-agent-backdrop','ai-agent-close','ai-agent-input',
    'ai-agent-send','ai-agent-attach','ai-agent-files','ai-agent-messages','ai-agent-attachments','ai-agent-status'];

function makeEnv(fetchHandler){
    var els = {};
    IDS.forEach(function(id){ els[id] = new FE('div'); });
    // messages нужен родитель со scroll-метриками.
    var body = new FE('div');
    body.appendChild(els['ai-agent-messages']);

    global.document = {
        readyState: 'complete',
        getElementById: function(id){ return els[id] || null; },
        createElement: function(tag){ return new FE(tag); },
        addEventListener: function(){},
        querySelector: function(){ return null; }
    };
    // #3716: ИИ-агент доступен только владельцу (имя пользователя = имя базы).
    global.window = { db: 'acme', user: 'acme', location: { pathname: '/acme/main' } };
    global.__intervals = [];
    global.setInterval = function(fn, ms){ var h = { fn: fn, ms: ms, cleared: false }; global.__intervals.push(h); return h; };
    global.clearInterval = function(h){ if(h) h.cleared = true; };
    global.fetch = function(url, opts){
        var res = fetchHandler(url, opts || {});
        return Promise.resolve({
            ok: res.ok !== false,
            status: res.status || 200,
            json: function(){ return Promise.resolve(res.data); }
        });
    };
    return els;
}

function freshAgent(fetchHandler){
    var els = makeEnv(fetchHandler);
    delete require.cache[path];
    var agent = require(path);  // авто-init выполнится сразу (document готов)
    return { agent: agent, els: els };
}

function messagesText(els, role){
    var msgs = els['ai-agent-messages'].children;
    var out = [];
    msgs.forEach(function(m){
        var isUser = m._classes['ai-chat-message-user'];
        var isAsst = m._classes['ai-chat-message-assistant'];
        if(role === 'user' && !isUser) return;
        if(role === 'assistant' && !isAsst) return;
        var t = m.querySelector('.ai-chat-message-text');
        out.push(t ? t.textContent : '');
    });
    return out;
}
function activeTimers(){ return global.__intervals.filter(function(h){ return !h.cleared; }).length; }

// ===================== A) Отправка -> ответ =====================
function scenarioA(){
    var ctx = freshAgent(function(url, opts){
        if((opts.method || 'GET') === 'POST')
            return { data: { job: { id: 'jA', status: 'done', message: 'привет', result: { assistant: { content: 'Ответ 42' } } } } };
        return { data: { job: null } }; // resume latest -> пусто
    });
    var a = ctx.agent, els = ctx.els;
    els['ai-agent-input'].value = 'привет';
    a.send();
    return settle().then(function(){
        expect(messagesText(els, 'user').indexOf('привет') !== -1, 'A: user message shown');
        expect(messagesText(els, 'assistant').indexOf('Ответ 42') !== -1, 'A: agent answer rendered');
        expect(a.sending === false, 'A: sending released after answer');
        expect(activeTimers() === 0, 'A: no timers left running after done');
        expect(els['ai-agent-status'].textContent === 'Готов к работе', 'A: status reset to ready');
    });
}

// ============ B) Восстановление при заходе (другой браузер) ============
function scenarioB(){
    var ctx = freshAgent(function(url, opts){
        // Любой GET latest отдаёт прошлую завершённую задачу.
        return { data: { job: { id: 'jB', status: 'done', message: 'прошлый вопрос', result: { assistant: { content: 'старый ответ' } } } } };
    });
    var els = ctx.els;
    return settle().then(function(){
        expect(messagesText(els, 'user').indexOf('прошлый вопрос') !== -1, 'B: restored user message from server');
        expect(messagesText(els, 'assistant').indexOf('старый ответ') !== -1, 'B: restored agent answer (survives reload / other browser)');
    });
}

// ============ C) Долгая задача -> поллинг -> готово ============
function scenarioC(){
    var phase = { done: false };
    var ctx = freshAgent(function(url, opts){
        if((opts.method || 'GET') === 'POST')
            return { data: { job: { id: 'jC', status: 'processing', message: 'долгий запрос' } } };
        // GET: сначала resume (latest) -> пусто до отправки; после отправки опрос
        // статуса jC возвращает processing, затем done.
        if(url.indexOf('job=jC') !== -1)
            return { data: { job: { id: 'jC', status: phase.done ? 'done' : 'processing', message: 'долгий запрос', result: phase.done ? { assistant: { content: 'итоговый ответ' } } : null } } };
        return { data: { job: null } };
    });
    var a = ctx.agent, els = ctx.els;
    return settle().then(function(){
        els['ai-agent-input'].value = 'долгий запрос';
        a.send();
        return settle();
    }).then(function(){
        expect(a.sending === true, 'C: still waiting while processing');
        var poll = global.__intervals.filter(function(h){ return !h.cleared && h.ms === a.pollIntervalMs; });
        expect(poll.length === 1, 'C: a status poll timer is running');
        expect(els['ai-agent-messages'].querySelector('.ai-chat-message-thinking') !== null, 'C: thinking bubble visible while processing');
        // Имитируем срабатывание опроса — задача всё ещё processing.
        poll[0].fn();
        return settle();
    }).then(function(){
        expect(a.sending === true, 'C: keeps waiting while still processing');
        // Теперь агент завершил — следующий опрос вернёт done.
        phase.done = true;
        var poll = global.__intervals.filter(function(h){ return !h.cleared && h.ms === a.pollIntervalMs; });
        poll[0].fn();
        return settle();
    }).then(function(){
        expect(messagesText(els, 'assistant').indexOf('итоговый ответ') !== -1, 'C: final answer rendered after polling');
        expect(a.sending === false, 'C: sending released after completion');
        expect(activeTimers() === 0, 'C: all timers cleared after completion');
    });
}

scenarioA().then(scenarioB).then(scenarioC).then(function(){
    console.log('');
    if(failures){ console.log('FAILED: ' + failures + ' check(s) failed'); process.exit(1); }
    console.log('ALL TESTS PASSED');
}).catch(function(e){
    console.log('ERROR: ' + (e && e.stack ? e.stack : e));
    process.exit(1);
});
