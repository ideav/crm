/*
 * ideav/crm#5654: переключатель «Страж данных» в чате ИИ-агента.
 * https://github.com/ideav/crm/issues/5654
 *
 * Страж настраивается на сервисе агента; чат спрашивает GET /{db}/ai/agent/guard при первом
 * открытии панели и показывает переключатель, только если страж у базы есть и включается
 * пользователем (available && toggle). По умолчанию выключен; выбор пользователя помнится в
 * этом браузере для этой базы.
 *   G1) страж есть — переключатель виден и выключен, вопрос идёт без guard;
 *   G2) включён — вопрос и кнопка действия из ответа идут с guard=1, действие над планом — без;
 *   G3) стража нет / он без переключателя / ответ — мусор — переключатель скрыт, guard не уходит;
 *   G4) выбор помнится для базы; при недоступном хранилище чат работает;
 *   G5) шаблоны: переключатель в композере скрыт, снят, autocomplete="off".
 *
 * Run with: node experiments/ai-agent-guard-5654-ui.test.js
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

// --- Минимальный фейковый DOM (как в ai-agent-auto-apply-5118-ui.test.js) ---
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
    'ai-agent-auto-apply','ai-agent-guard','ai-agent-guard-wrap'];

function fakeStorage(log){
    var data = {};
    return {
        getItem: function(k){ return data.hasOwnProperty(k) ? data[k] : null; },
        setItem: function(k, v){ log.push(k + '=' + v); data[k] = String(v); },
        removeItem: function(k){ delete data[k]; }
    };
}

function fresh(fetchHandler, store){
    var els = {};
    IDS.forEach(function(id){ els[id] = new FE(/auto-apply|guard$/.test(id) ? 'input' : 'div'); });
    els['ai-agent-guard-wrap'].style.display = 'none';   // как в шаблоне
    new FE('div').appendChild(els['ai-agent-messages']);
    global.document = {
        readyState: 'complete',
        getElementById: function(id){ return els[id] || null; },
        createElement: function(tag){ return new FE(tag); },
        addEventListener: function(){},
        querySelector: function(){ return null; }
    };
    global.window = { db: 'acme', user: 'petrov', xsrf: 'x1', location: { pathname: '/acme/main' },
        localStorage: store || fakeStorage([]), sessionStorage: fakeStorage([]) };
    global.localStorage = global.window.localStorage;
    global.sessionStorage = global.window.sessionStorage;
    global.setInterval = function(){ return {}; };
    global.clearInterval = function(){};
    var posts = [], gets = [];
    global.fetch = function(url, opts){
        opts = opts || {};
        if((opts.method || 'GET') === 'POST') posts.push(opts.body); else gets.push(url);
        var res = fetchHandler(url, opts, posts.length);
        return Promise.resolve({ ok: true, status: 200, json: function(){
            return res === undefined ? Promise.reject(new Error('not json')) : Promise.resolve(res); } });
    };
    delete require.cache[path];
    var agent = require(path);
    return { agent: agent, els: els, posts: posts, gets: gets };
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
var ON = { available: true, toggle: true, topics: ['hr'], action: 'mask' };
function handler(guard, plan){
    return function(url, opts, n){
        if((opts.method || 'GET') !== 'POST') return url.indexOf('/ai/agent/guard') !== -1 ? guard : { job: null };
        if(plan) return n === 1 ? job('jP', PENDING) : job('jA');
        return job('j' + n, null, [{ type: 'text', text: 'ответ' }, { type: 'actions', items: [{ label: 'Ещё', message: 'И остальные' }] }]);
    };
}
function ask(ctx, text){
    ctx.els['ai-agent-input'].value = text;
    ctx.agent.send();
    return settle();
}

function g1(){
    var ctx = fresh(handler(ON));
    ctx.agent.openPanel();
    return settle().then(function(){
        expect(ctx.gets.indexOf('/acme/ai/agent/guard?JSON=1') !== -1, 'G1: чат спросил /acme/ai/agent/guard');
        expect(ctx.els['ai-agent-guard-wrap'].style.display === '', 'G1: страж есть — переключатель виден');
        expect(ctx.els['ai-agent-guard'].checked === false, 'G1: по умолчанию выключен');
        return ask(ctx, 'найди Петрова');
    }).then(function(){
        expect(ctx.posts[0] && ctx.posts[0].get('guard') === null, 'G1: выключен — guard не отправляется');
        ctx.agent.closePanel();
        ctx.agent.openPanel();
        return settle();
    }).then(function(){
        var n = ctx.gets.filter(function(u){ return u.indexOf('/ai/agent/guard') !== -1; }).length;
        expect(n === 1, 'G1: повторное открытие панели не спрашивает сервер заново (' + n + ')');
    });
}

function g2(){
    var ctx = fresh(handler(ON));
    ctx.agent.openPanel();
    return settle().then(function(){
        ctx.els['ai-agent-guard'].checked = true;
        return ask(ctx, 'найди Петрова');
    }).then(function(){
        expect(ctx.posts[0] && ctx.posts[0].get('guard') === '1', 'G2: включён — вопрос идёт с guard=1');
        ctx.agent.send('И остальные');
        return settle();
    }).then(function(){
        expect(ctx.posts[1] && ctx.posts[1].get('guard') === '1', 'G2: кнопка действия из ответа тоже с guard=1');
        var pc = fresh(handler(ON, true));
        pc.agent.openPanel();
        return settle().then(function(){
            pc.els['ai-agent-guard'].checked = true;
            return ask(pc, 'удали дубль');
        }).then(function(){
            buttonsIn(lastAssistant(pc.els))[0].click();
            var body = pc.posts[1];
            expect(body && body.get('action') === 'apply' && body.get('guard') === null, 'G2: действие над планом идёт без guard');
        });
    });
}

function g3(){
    var cases = [[{ available: false }, 'стража нет'], [{ available: true, toggle: false, topics: [], action: 'mask' }, 'страж без переключателя'],
        [undefined, 'ответ не JSON']];
    return cases.reduce(function(p, c){
        return p.then(function(){
            var ctx = fresh(handler(c[0]));
            ctx.agent.openPanel();
            return settle().then(function(){
                expect(ctx.els['ai-agent-guard-wrap'].style.display === 'none', 'G3: ' + c[1] + ' — переключатель скрыт');
                ctx.els['ai-agent-guard'].checked = true;   // даже если галку как-то поставили
                return ask(ctx, 'вопрос');
            }).then(function(){
                expect(ctx.posts[0] && ctx.posts[0].get('guard') === null, 'G3: ' + c[1] + ' — guard не отправляется');
            });
        });
    }, Promise.resolve());
}

function g4(){
    var store = fakeStorage([]);
    var ctx = fresh(handler(ON), store);
    ctx.agent.openPanel();
    return settle().then(function(){
        var box = ctx.els['ai-agent-guard'];
        box.checked = true;
        if(box.listeners.change) box.listeners.change({});
        var again = fresh(handler(ON), store);
        again.agent.openPanel();
        return settle().then(function(){
            expect(again.els['ai-agent-guard'].checked === true, 'G4: после перезагрузки выбор «включён» сохранён для базы');
            return ask(again, 'ещё');
        }).then(function(){
            expect(again.posts[0] && again.posts[0].get('guard') === '1', 'G4: и вопрос идёт с guard=1');
        });
    }).then(function(){
        var broken = { getItem: function(){ throw new Error('denied'); }, setItem: function(){ throw new Error('denied'); }, removeItem: function(){} };
        var ctx = fresh(handler(ON), broken);
        ctx.agent.openPanel();
        return settle().then(function(){
            var box = ctx.els['ai-agent-guard'];
            expect(box.checked === false && ctx.els['ai-agent-guard-wrap'].style.display === '', 'G4: хранилище недоступно — переключатель есть, выключен');
            box.checked = true;
            if(box.listeners.change) box.listeners.change({});
            return ask(ctx, 'вопрос');
        }).then(function(){
            expect(ctx.posts[0] && ctx.posts[0].get('guard') === '1', 'G4: хранилище недоступно — переключатель работает');
        });
    });
}

// Ревью: выбор «включён» сохранён, вопрос отправлен до ответа сервера — guard всё равно уходит;
// сбой запроса статуса — при следующем открытии панели спрашиваем снова.
function g6(){
    var store = fakeStorage([]);
    store.setItem('aiAgentGuard:acme', '1');
    var ctx = fresh(handler(ON), store);
    ctx.agent.openPanel();          // fetch статуса ещё не разрешился
    ctx.els['ai-agent-input'].value = 'сразу вопрос';
    ctx.agent.send();
    return settle().then(function(){
        expect(ctx.posts[0] && ctx.posts[0].get('guard') === '1', 'G6: вопрос до ответа сервера — guard по сохранённому выбору');
        var fails = 0;
        var c2 = fresh(function(url, opts, n){
            if((opts.method || 'GET') !== 'POST' && url.indexOf('/ai/agent/guard') !== -1){ fails++; return undefined; }
            return handler(ON)(url, opts, n);
        });
        c2.agent.openPanel();
        return settle().then(function(){
            c2.agent.closePanel();
            c2.agent.openPanel();
            return settle();
        }).then(function(){
            expect(fails === 2, 'G6: после сбоя статус спрашивается снова (' + fails + ')');
        });
    });
}

function g5(){
    ['../templates/main.html', '../templates/solutions/main.html'].forEach(function(t){
        var html = fs.readFileSync(require.resolve(t), 'utf8');
        var composer = html.slice(html.indexOf('ai-chat-composer'), html.indexOf('</aside>', html.indexOf('ai-chat-composer')));
        var wrap = (composer.match(/<label[^>]*id="ai-agent-guard-wrap"[^>]*>/) || [''])[0];
        var tag = (composer.match(/<input[^>]*id="ai-agent-guard"[^>]*>/) || [''])[0];
        expect(/display:\s*none/.test(wrap), 'G5 ' + t + ': переключатель скрыт до ответа сервера');
        expect(/type="checkbox"/.test(tag) && /autocomplete="off"/.test(tag) && !/\bchecked\b/.test(tag),
            'G5 ' + t + ': галка, autocomplete="off", снята');
    });
}

g1().then(g2).then(g3).then(g4).then(g6).then(g5).then(function(){
    console.log('');
    if(failures){ console.log('FAILED: ' + failures); process.exitCode = 1; }
    else console.log('ALL TESTS PASSED');
}).catch(function(e){ console.log('FAIL: исключение ' + (e && e.stack || e)); process.exitCode = 1; });
