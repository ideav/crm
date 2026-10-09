/*
 * python2node#847: ИИ-чат передаёт агенту контекст экрана.
 * https://github.com/ideav/python2node/issues/847
 *
 * Проверяется поведение js/ai-agent-chat.js:
 *   1) buildScreenContext собирает context для страниц object (карточка), table (object/{id}),
 *      report; фильтры F_/FR_/TO_ — из адреса; на главной контекста нет;
 *   2) выделенные строки integram-table попадают в selection (id записей, не индексы);
 *   3) на карточке «Сделка №5231» панель показывает «Контекст: Сделка №5231», отправка кладёт
 *      context в форму; крестик снимает контекст — следующая отправка идёт без него;
 *   4) на главной отправка без поля context (поведение прежнее).
 *
 * Run with: node experiments/ai-agent-screen-context-847.test.js
 */
'use strict';

var path = require.resolve('../js/ai-agent-chat.js');
var realSetTimeout = global.setTimeout;
var failures = 0;
function expect(cond, name){ if(cond){ console.log('PASS: ' + name); } else { console.log('FAIL: ' + name); failures++; } }
function flush(){ return new Promise(function(res){ realSetTimeout(res, 0); }); }

// ===================== 1) buildScreenContext — чистая функция =====================
delete require.cache[path];
var A = require(path);

var obj = A.buildScreenContext({ action: 'edit_obj', id: '5231', typeId: 18, typeName: 'Сделка',
    pathname: '/acme/edit_obj/5231', search: '' });
expect(obj && obj.page === 'object' && obj.object_id === 5231 && obj.table_id === 18,
    '#847: карточка записи → page=object, object_id и table_id');
expect(obj && obj.label === 'Сделка №5231', '#847: подпись карточки — «Сделка №5231»');
expect(obj && obj.url === '/acme/edit_obj/5231', '#847: url страницы передаётся');

var tbl = A.buildScreenContext({ action: 'object', id: '18', title: ' Сделки ',
    pathname: '/acme/object/18/', search: '?F_20=%D0%9F%D0%B5%D1%82%D1%80%D0%BE%D0%B2&F_U=1&LIMIT=20&_xsrf=zzz' });
expect(tbl && tbl.page === 'table' && tbl.table_id === 18, '#847: список таблицы → page=table, table_id');
expect(tbl && tbl.filters && tbl.filters.F_20 === 'Петров' && tbl.filters.F_U === '1',
    '#847: фильтры F_* из адреса декодированы');
expect(tbl && tbl.filters && !('LIMIT' in tbl.filters) && !('_xsrf' in tbl.filters),
    '#847: в filters только F_/FR_/TO_, служебные параметры не уходят');
expect(tbl && tbl.label === 'Таблица Сделки', '#847: подпись таблицы — из «хлебных крошек»');

var card = A.buildScreenContext({ action: 'object', id: '18', search: '?F_I=5231' });
expect(card && card.object_id === 5231, '#847: object/{id}/?F_I=N — запись N тоже в контексте');

var rep = A.buildScreenContext({ action: 'report', id: '77',
    search: '?FR_%D0%A1%D1%82%D0%B0%D1%82%D1%83%D1%81=%D0%9D%D0%BE%D0%B2%D1%8B%D0%B9&TO_Date=31.12.2026' });
expect(rep && rep.page === 'report' && rep.report_id === 77, '#847: отчёт → page=report, report_id');
expect(rep && rep.filters && rep.filters['FR_Статус'] === 'Новый' && rep.filters.TO_Date === '31.12.2026',
    '#847: фильтры отчёта FR_/TO_ (кириллица в имени) переданы');

expect(A.buildScreenContext({ action: '', id: '', pathname: '/acme' }) === null, '#847: главная → контекста нет');
expect(A.buildScreenContext({ action: 'main' }) === null, '#847: main → контекста нет');
expect(A.buildScreenContext({ action: 'edit_obj', id: '0' }) === null, '#847: карточка без id → контекста нет');
var wp = A.buildScreenContext({ action: 'kanban' });
expect(wp && wp.page === 'workplace' && wp.workplace === 'kanban', '#847: прочие страницы → рабочее место');

var big = [];
for(var i = 1; i <= 80; i++) big.push(i);
var sel = A.buildScreenContext({ action: 'object', id: '18', selection: [5231, '5232', 5231, 'x', -3].concat(big) });
expect(sel && sel.selection[0] === 5231 && sel.selection[1] === 5232 && sel.selection.indexOf(-3) < 0,
    '#847: selection — уникальные положительные id');
expect(sel && sel.selection.length === 50, '#847: selection ограничен 50 id');

// ===================== 2) выделение integram-table → id записей =====================
global.window = { _integramTableInstances: [
    { selectedRows: new Set([0, 2]), rawObjectData: [{ i: 5231 }, { i: 5232 }, { i: 5240 }] },
    { selectedRows: new Set(), rawObjectData: [{ i: 1 }] }
] };
var ids = A.collectSelection();
expect(ids.join(',') === '5231,5240', '#847: выделенные строки → id записей, а не индексы строк');
delete global.window;

// ===================== 3) панель на карточке записи =====================
function FE(tag){
    this.tagName = tag; this.style = {}; this.attrs = {}; this.listeners = {}; this.hidden = false; this.value = '';
    this.children = []; this.parentNode = null;
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
FE.prototype.appendChild = function(c){ c.parentNode = this; this.children.push(c); return c; };
FE.prototype.insertBefore = function(c, ref){
    c.parentNode = this; var i = this.children.indexOf(ref);
    if(i < 0) this.children.push(c); else this.children.splice(i, 0, c); return c;
};
Object.defineProperty(FE.prototype, 'textContent', { get: function(){ return this._t || ''; }, set: function(v){ this._t = v; } });
Object.defineProperty(FE.prototype, 'innerHTML', { get: function(){ return this._h || ''; }, set: function(v){ this._h = v; } });

var IDS = ['ai-chat-toggle','ai-agent-panel','ai-agent-close','ai-agent-input','ai-agent-send','ai-agent-attach',
           'ai-agent-files','ai-agent-messages','ai-agent-attachments','ai-agent-status'];

function setup(pageAction, pageId, extra){
    var els = {}; IDS.forEach(function(id){ els[id] = new FE('div'); });
    var composer = new FE('div');
    composer.appendChild(els['ai-agent-attachments']);
    els.composer = composer;
    global.document = {
        readyState: 'complete',
        getElementById: function(id){ return els[id] || null; },
        createElement: function(tag){ return new FE(tag); },
        addEventListener: function(){},
        querySelector: function(){ return null; }
    };
    global.window = Object.assign({ db: 'acme', user: 'petrov', action: pageAction, id: pageId,
        location: { pathname: '/acme/' + pageAction + (pageId ? '/' + pageId : ''), search: '' } }, extra || {});
    var posts = [];
    global.fetch = function(url, opts){
        opts = opts || {};
        if(opts.method === 'POST') posts.push(opts.body);
        return Promise.resolve({ ok: true, status: 200, json: function(){
            return Promise.resolve(opts.method === 'POST' ? { job: { id: 'j' + posts.length, status: 'done', result: { content: 'ok' } } } : { job: null });
        } });
    };
    global.setInterval = function(){ return {}; }; global.clearInterval = function(){};
    delete require.cache[path];
    var agent = require(path);
    return { agent: agent, els: els, posts: posts };
}

function contextEl(env){
    return env.els.composer.children.filter(function(c){ return c.className === 'ai-agent-context'; })[0] || null;
}
function sendText(env, text){
    env.els['ai-agent-input'].value = text;
    env.agent.send();
    return flush().then(flush);
}

function scCard(){
    var env = setup('edit_obj', '5231', { type: 18, typeName: 'Сделка' });
    env.agent.openPanel();
    var el = contextEl(env);
    expect(el && !el.hidden, '#847: на карточке над полем ввода есть строка контекста');
    var label = el && el.children[0];
    expect(label && label.textContent === 'Контекст: Сделка №5231', '#847: строка — «Контекст: Сделка №5231»');
    return sendText(env, 'что тут не так?').then(function(){
        var ctx = env.posts[0] && env.posts[0].get('context');
        var parsed = ctx ? JSON.parse(ctx) : null;
        expect(parsed && parsed.page === 'object' && parsed.object_id === 5231 && parsed.table_id === 18,
            '#847: отправка с карточки кладёт context с этой записью');
        // Крестик снимает контекст: строка скрыта, следующий запрос без context.
        var remove = el.children[1];
        remove.listeners.click();
        expect(el.hidden === true, '#847: крестик скрывает строку контекста');
        return sendText(env, 'а теперь в целом');
    }).then(function(){
        expect(env.posts.length === 2 && env.posts[1].get('context') === null, '#847: после крестика context не передаётся');
    });
}

function scMain(){
    var env = setup('', '');
    env.agent.openPanel();
    expect(!contextEl(env), '#847: на главной строки контекста нет');
    return sendText(env, 'сколько таблиц?').then(function(){
        expect(env.posts.length === 1 && env.posts[0].get('context') === null, '#847: на главной отправка без context');
        expect(env.posts[0].get('message') === 'сколько таблиц?', '#847: на главной сообщение уходит как раньше');
    });
}

function scSelection(){
    var env = setup('object', '18', { _integramTableInstances: [
        { selectedRows: new Set([1]), rawObjectData: [{ i: 7001 }, { i: 7002 }] }] });
    return sendText(env, 'удали выделенные').then(function(){
        var parsed = JSON.parse(env.posts[0].get('context'));
        expect(parsed.page === 'table' && parsed.table_id === 18 && parsed.selection.join(',') === '7002',
            '#847: список таблицы — selection с id выделенной строки');
    });
}

scCard().then(scMain).then(scSelection).then(function(){
    console.log('');
    if(failures){ console.log('FAILED: ' + failures + ' check(s) failed'); process.exit(1); }
    console.log('ALL TESTS PASSED');
}).catch(function(e){ console.log('ERROR: ' + (e && e.stack ? e.stack : e)); process.exit(1); });
