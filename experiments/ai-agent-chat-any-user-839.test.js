/*
 * python2node#839: кнопка ИИ-агента видна ЛЮБОМУ вошедшему пользователю базы.
 * https://github.com/ideav/python2node/issues/839
 *
 * Агент работает токеном пользователя и с его правами, поэтому ограничение «имя
 * пользователя = имя базы» снято и на сервере, и в клиенте. Проверяется поведение:
 *   1) isAgentAllowed() — любой вошедший да, не вошедший и guest нет, база значения не имеет;
 *   2) пользователь petrov в базе acme: кнопка видна, resume идёт к ai/agent текущей базы;
 *   3) guest: кнопка скрыта, ни одного запроса к ai/agent.
 *
 * Run with: node experiments/ai-agent-chat-any-user-839.test.js
 */
'use strict';

var path = require.resolve('../js/ai-agent-chat.js');
var realSetTimeout = global.setTimeout;
var failures = 0;
function expect(cond, name){ if(cond){ console.log('PASS: ' + name); } else { console.log('FAIL: ' + name); failures++; } }
function flush(){ return new Promise(function(res){ realSetTimeout(res, 0); }); }

// --- минимальный фейковый DOM ---
function FE(){
    this.style = {}; this.attrs = {}; this.listeners = {}; this.hidden = false; this.value = '';
    var self = this; this._cls = {};
    this.classList = {
        add: function(c){ self._cls[c] = 1; }, remove: function(c){ delete self._cls[c]; },
        contains: function(c){ return !!self._cls[c]; }, toggle: function(c){ self._cls[c] = !self._cls[c]; }
    };
}
FE.prototype.addEventListener = function(e, f){ this.listeners[e] = f; };
FE.prototype.setAttribute = function(k, v){ this.attrs[k] = v; };
FE.prototype.removeAttribute = function(k){ delete this.attrs[k]; };
FE.prototype.getAttribute = function(k){ return this.attrs.hasOwnProperty(k) ? this.attrs[k] : null; };
FE.prototype.focus = function(){}; FE.prototype.click = function(){};
FE.prototype.querySelector = function(){ return null; };
FE.prototype.appendChild = function(c){ return c; };
Object.defineProperty(FE.prototype, 'textContent', { get: function(){ return this._t || ''; }, set: function(v){ this._t = v; } });
Object.defineProperty(FE.prototype, 'innerHTML', { get: function(){ return this._h || ''; }, set: function(v){ this._h = v; } });

var IDS = ['ai-chat-toggle','ai-agent-panel','ai-agent-backdrop','ai-agent-close','ai-agent-input',
           'ai-agent-send','ai-agent-attach','ai-agent-files','ai-agent-messages','ai-agent-attachments','ai-agent-status'];

function makeEnv(userName, dbName){
    var els = {}; IDS.forEach(function(id){ els[id] = new FE(); });
    global.document = {
        readyState: 'complete',
        getElementById: function(id){ return els[id] || null; },
        createElement: function(){ return new FE(); },
        addEventListener: function(){}, querySelector: function(){ return null; }
    };
    global.window = { db: dbName, user: userName, location: { pathname: '/' + dbName + '/main' } };
    var calls = [];
    global.fetch = function(url, opts){ calls.push({ url: url, opts: opts || {} });
        return Promise.resolve({ ok: true, status: 200, json: function(){ return Promise.resolve({ job: null }); } }); };
    global.__calls = calls;
    global.setInterval = function(){ return {}; }; global.clearInterval = function(){};
    return els;
}
function fresh(userName, dbName){ var els = makeEnv(userName, dbName); delete require.cache[path]; var agent = require(path); return { agent: agent, els: els }; }

// ===================== 1) isAgentAllowed =====================
delete global.document;
delete require.cache[path];
var A = require(path);
function allowed(u, d){ A.getCurrentUserName = function(){ return u; }; A.getCurrentDbName = function(){ return d; }; return A.isAgentAllowed(); }

expect(allowed('petrov', 'acme') === true, '#839: пользователь petrov в базе acme → разрешён');
expect(allowed('acme', 'acme') === true,   '#839: владелец базы → разрешён');
expect(allowed('bob', 'ateh') === true,    '#839: пользователь в бывшей «открытой» базе → разрешён');
expect(allowed('Petrov', 'ACME') === true, '#839: регистр значения не имеет');
expect(allowed('', 'acme') === false,      '#839: не вошедший → запрещён');
expect(allowed('guest', 'acme') === false, '#839: guest → запрещён');
expect(allowed('GUEST', 'acme') === false, '#839: GUEST в другом регистре → запрещён');

// ===================== 2) Обычный пользователь: кнопка видна, resume идёт =====================
function scUser(){
    var ctx = fresh('petrov', 'acme');
    return flush().then(flush).then(function(){
        var calls = global.__calls || [];
        expect(ctx.els['ai-chat-toggle'].style.display !== 'none', '#839: petrov в acme → кнопка ИИ-агента видна');
        expect(calls.length >= 1 && /\/acme\/ai\/agent\?JSON=1/.test(calls[0].url),
            '#839: petrov в acme → resume обращается к ai/agent текущей базы');
    });
}

// ===================== 3) guest: ни одного вызова =====================
function scGuest(){
    var ctx = fresh('guest', 'acme');
    return flush().then(flush).then(function(){
        var calls = global.__calls || [];
        expect(calls.length === 0, '#839: guest → НИ ОДНОГО вызова ai/agent');
        expect(ctx.els['ai-chat-toggle'].style.display === 'none', '#839: guest → кнопка скрыта');
    });
}

scUser().then(scGuest).then(function(){
    console.log('');
    if(failures){ console.log('FAILED: ' + failures + ' check(s) failed'); process.exit(1); }
    console.log('ALL TESTS PASSED');
}).catch(function(e){ console.log('ERROR: ' + (e && e.stack ? e.stack : e)); process.exit(1); });
