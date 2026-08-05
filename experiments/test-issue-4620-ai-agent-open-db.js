/*
 * Issue #4620: для БД `ateh` ИИ-агент показывается ЛЮБОМУ пользователю (временно).
 * https://github.com/ideav/crm/issues/4620
 *
 * Исключение обязано быть УЗКИМ и СИММЕТРИЧНЫМ:
 *   1) чужой пользователь в `ateh` — агент разрешён, кнопка видна, resume идёт к ai/agent;
 *   2) чужой пользователь в ЛЮБОЙ другой базе — по-прежнему запрещён (#3716 не отменён);
 *   3) владелец — работает как раньше и в открытой базе, и в обычной;
 *   4) регистр имени базы значения не имеет (`ATEH` = `ateh`) — как и на сервере;
 *   5) пустой пользователь (не аутентифицирован) запрещён ДАЖЕ в открытой базе —
 *      исключение снимает проверку «владелец», а не проверку «вошёл».
 *
 * Списки баз обязаны совпадать: AI_AGENT_OPEN_DBS (js/ai-agent-chat.js) и
 * aiAgentOpenDbs() (index.php). Пункт 6 проверяет это чтением обоих файлов —
 * разъехавшиеся списки дают «кнопка видна, сервер 403».
 *
 * Run with: node experiments/test-issue-4620-ai-agent-open-db.js
 */
'use strict';

var fs = require('fs');
var path = require.resolve('../js/ai-agent-chat.js');
var realSetTimeout = global.setTimeout;
var failures = 0;
function expect(cond, name){ if(cond){ console.log('PASS: ' + name); } else { console.log('FAIL: ' + name); failures++; } }
function flush(){ return new Promise(function(res){ realSetTimeout(res, 0); }); }

// --- минимальный фейковый DOM (тот же харнесс, что у #3716) ---
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

// ===================== 1) Логика isAgentAllowed =====================
delete global.document;
delete require.cache[path];
var A = require(path);
function allowed(u, d){ A.getCurrentUserName = function(){ return u; }; A.getCurrentDbName = function(){ return d; }; return A.isAgentAllowed(); }

expect(allowed('bob', 'ateh') === true,  '#4620: чужой пользователь в ateh → разрешён');
expect(allowed('bob', 'ATEH') === true,  '#4620: имя базы в другом регистре (ATEH) → разрешён');
expect(allowed('ateh', 'ateh') === true, '#4620: владелец ateh → разрешён (как и был)');
expect(allowed('', 'ateh') === false,    '#4620: НЕ аутентифицирован → запрещён даже в открытой базе');
expect(allowed('bob', 'acme') === false, '#3716 не отменён: чужой в обычной базе → запрещён');
expect(allowed('acme', 'acme') === true, '#3716 не отменён: владелец обычной базы → разрешён');
expect(allowed('bob', 'ateh1') === false, '#4620: исключение УЗКОЕ — ateh1 не открыт');

// ===================== 2) Чужой в ateh: кнопка видна, resume идёт =====================
function scStrangerOpenDb(){
    var ctx = fresh('bob', 'ateh');
    return flush().then(flush).then(function(){
        var calls = global.__calls || [];
        expect(ctx.els['ai-chat-toggle'].style.display !== 'none', '#4620: чужой в ateh → кнопка ИИ-агента ВИДНА');
        expect(calls.length >= 1 && /\/ateh\/ai\/agent\?JSON=1/.test(calls[0].url),
            '#4620: чужой в ateh → resume обращается к ai/agent текущей базы');
    });
}

// ===================== 3) Чужой в обычной базе: как было (#3716) =====================
function scStrangerOtherDb(){
    var ctx = fresh('bob', 'acme');
    return flush().then(flush).then(function(){
        var calls = global.__calls || [];
        expect(calls.length === 0, '#3716 не отменён: чужой в acme → НИ ОДНОГО вызова ai/agent');
        expect(ctx.els['ai-chat-toggle'].style.display === 'none', '#3716 не отменён: чужой в acme → кнопка скрыта');
    });
}

// ===================== 4) Списки баз на клиенте и на сервере совпадают =====================
function scListsMatch(){
    var js = fs.readFileSync(__dirname + '/../js/ai-agent-chat.js', 'utf8');
    var php = fs.readFileSync(__dirname + '/../index.php', 'utf8');
    var mJs = /AI_AGENT_OPEN_DBS\s*=\s*\[([^\]]*)\]/.exec(js);
    var mPhp = /function\s+aiAgentOpenDbs\s*\(\)\s*\{\s*return\s+array\(([^)]*)\)/.exec(php);
    var names = function(s){
        return (s || '').split(',').map(function(x){ return x.trim().replace(/^['"]|['"]$/g, '').toLowerCase(); })
            .filter(Boolean).sort().join(',');
    };
    expect(!!mJs, '#4620: в js/ai-agent-chat.js есть список AI_AGENT_OPEN_DBS');
    expect(!!mPhp, '#4620: в index.php есть aiAgentOpenDbs()');
    if(mJs && mPhp){
        expect(names(mJs[1]) === names(mPhp[1]),
            '#4620: списки открытых баз СОВПАДАЮТ (клиент/сервер)', );
        console.log('       клиент: [' + names(mJs[1]) + ']  сервер: [' + names(mPhp[1]) + ']');
    }
    return Promise.resolve();
}

scStrangerOpenDb().then(scStrangerOtherDb).then(scListsMatch).then(function(){
    console.log('');
    if(failures){ console.log('FAILED: ' + failures + ' check(s) failed'); process.exit(1); }
    console.log('ALL TESTS PASSED');
}).catch(function(e){ console.log('ERROR: ' + (e && e.stack ? e.stack : e)); process.exit(1); });
