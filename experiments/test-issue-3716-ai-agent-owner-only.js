/*
 * Issue #3716: /{db}/ai/agent?JSON не вызывается, если имя пользователя ≠ имя базы.
 * https://github.com/ideav/crm/issues/3716
 *
 * Лёгкий харнесс без jsdom: подменяем document/window/fetch и проверяем:
 *   1) isAgentAllowed() — сравнение имени пользователя и имени базы;
 *   2) НЕ владелец (user != db): init не делает НИ ОДНОГО fetch к ai/agent,
 *      кнопка ИИ-агента скрыта;
 *   3) владелец (user == db): init поднимает последнюю задачу (resume → ai/agent?JSON),
 *      кнопка видна.
 *
 * Run with: node experiments/test-issue-3716-ai-agent-owner-only.js
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

// ===================== 1) isAgentAllowed (логика) =====================
// require без auto-init: document отсутствует.
delete global.document;
delete require.cache[path];
var A = require(path);
A.getCurrentDbName = function(){ return 'acme'; };
A.getCurrentUserName = function(){ return 'acme'; };
expect(A.isAgentAllowed() === true, '#3716: user == db → разрешён');
A.getCurrentUserName = function(){ return 'bob'; };
expect(A.isAgentAllowed() === false, '#3716: user != db → запрещён');
A.getCurrentUserName = function(){ return ''; };
expect(A.isAgentAllowed() === false, '#3716: пустой user → запрещён');
A.getCurrentUserName = function(){ return 'acme'; };
A.getCurrentDbName = function(){ return ''; };
expect(A.isAgentAllowed() === false, '#3716: пустая база → запрещён');
// регистронезависимо (зеркало strtolower на сервере).
A.getCurrentUserName = function(){ return 'ACME'; };
A.getCurrentDbName = function(){ return 'acme'; };
expect(A.isAgentAllowed() === true, '#3716: разный регистр (ACME/acme) → разрешён');
A.getCurrentUserName = function(){ return 'Acme'; };
A.getCurrentDbName = function(){ return 'AcMe'; };
expect(A.isAgentAllowed() === true, '#3716: разный регистр (Acme/AcMe) → разрешён');

// ===================== 2) НЕ владелец: ноль вызовов =====================
function scNotOwner(){
    var ctx = fresh('bob', 'acme');   // имя пользователя ≠ имя базы
    return flush().then(flush).then(function(){
        var calls = global.__calls || [];
        expect(calls.length === 0, '#3716: НЕ владелец → НИ ОДНОГО вызова ai/agent?JSON');
        expect(ctx.els['ai-chat-toggle'].style.display === 'none', '#3716: НЕ владелец → кнопка ИИ-агента скрыта');
    });
}

// ===================== 3) Владелец: работает как прежде =====================
function scOwner(){
    var ctx = fresh('acme', 'acme');  // имя пользователя = имя базы
    return flush().then(flush).then(function(){
        var calls = global.__calls || [];
        expect(calls.length >= 1, '#3716: владелец → resume обращается к ai/agent?JSON');
        expect(calls.length >= 1 && /\/acme\/ai\/agent\?JSON=1/.test(calls[0].url),
            '#3716: владелец → URL ai/agent текущей базы (?latest)');
        expect(ctx.els['ai-chat-toggle'].style.display !== 'none', '#3716: владелец → кнопка видна');
    });
}

scNotOwner().then(scOwner).then(function(){
    console.log('');
    if(failures){ console.log('FAILED: ' + failures + ' check(s) failed'); process.exit(1); }
    console.log('ALL TESTS PASSED');
}).catch(function(e){ console.log('ERROR: ' + (e && e.stack ? e.stack : e)); process.exit(1); });
