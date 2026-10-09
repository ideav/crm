/*
 * ideav/crm#5113: ИИ-чат не видел, что на экране рабочего места (планирование: станок, день).
 * https://github.com/ideav/crm/issues/5113
 *
 * Рабочее место само описывает свой экран: регистрирует window.integramAgentContext(), чат кладёт
 * результат в context.screen. Проверяется поведение:
 *   1) mergePageScreen — чистая функция: ключи, значения, списки, подпись, предел размера;
 *   2) чат на рабочем месте с хуком: context.screen уходит в запросе, подпись строки контекста —
 *      из хука; хук бросил исключение / вернул null — запрос уходит с прежним контекстом;
 *   3) планирование производства: agentScreenContext() отдаёт активный станок, даты, задания на
 *      экране, расхождения наладки; страница убрана из DOM — хук молчит.
 *
 * Run with: node experiments/ai-agent-page-screen-5113.test.js
 */
'use strict';

process.env.TZ = 'UTC';

var path = require.resolve('../js/ai-agent-chat.js');
var realSetTimeout = global.setTimeout;
var failures = 0;
function expect(cond, name){ if(cond){ console.log('PASS: ' + name); } else { console.log('FAIL: ' + name); failures++; } }
function flush(){ return new Promise(function(res){ realSetTimeout(res, 0); }); }

// ===================== 1) mergePageScreen — чистая функция =====================
delete require.cache[path];
var A = require(path);

var base = function(){ return { page: 'workplace', workplace: 'production-planning', label: 'Рабочее место production-planning' }; };

var m = A.mergePageScreen(base(), {
    label: '  Планирование ·   Станок 1 ',
    machine: 'Станок 1',
    machine_id: 1101,
    plan_dates: '09.10.2026',
    machines: ['Станок 1 (id 1101)', 'Станок 2 (id 1102)', '', null, { x: 1 }],
    empty: '',
    'Плохой ключ': 'x',
    nested: { a: 1 },
    flag: true
});
expect(m.label === 'Планирование · Станок 1', '#5113: подпись экрана — из хука, в одну строку');
expect(m.screen && m.screen.machine === 'Станок 1' && m.screen.machine_id === 1101 && m.screen.plan_dates === '09.10.2026',
    '#5113: скалярные поля хука → context.screen');
expect(m.screen && m.screen.machines.join('|') === 'Станок 1 (id 1101)|Станок 2 (id 1102)',
    '#5113: списки — только непустые скаляры');
expect(m.screen && !('empty' in m.screen) && !('Плохой ключ' in m.screen) && !('nested' in m.screen) && !('label' in m.screen),
    '#5113: пустые значения, чужие ключи, вложенные объекты и label в screen не попадают');
expect(m.screen && m.screen.flag === true, '#5113: логические значения сохраняются');
expect(m.page === 'workplace' && m.workplace === 'production-planning', '#5113: базовый контекст страницы не теряется');

var long = A.mergePageScreen(base(), { note: new Array(400).join('я') });
expect(long.screen.note.length === 200, '#5113: строка обрезается до 200 символов');

var many = {};
for(var k = 0; k < 40; k++) many['k' + k] = 'v' + k;
expect(Object.keys(A.mergePageScreen(base(), many).screen).length === 20, '#5113: в screen не больше 20 полей');

var rows = [];
for(var r = 0; r < 100; r++) rows.push('id ' + (900000 + r) + ': ' + new Array(150).join('ж'));
var big = A.mergePageScreen(base(), { machine: 'Станок 1', jobs_on_screen: rows });
expect(big.screen.jobs_on_screen.length <= 30, '#5113: список не длиннее 30 элементов');
expect(JSON.stringify(big.screen).length <= A.maxScreenChars, '#5113: screen целиком не больше maxScreenChars');
expect(big.screen.machine === 'Станок 1', '#5113: при ужатии скалярные поля остаются');

expect(A.mergePageScreen(base(), null).screen === undefined, '#5113: хук вернул null → screen нет');
expect(A.mergePageScreen(base(), 'строка').screen === undefined, '#5113: хук вернул не объект → screen нет');
expect(A.mergePageScreen(base(), { label: 'Только подпись' }).screen === undefined
    && A.mergePageScreen(base(), { label: 'Только подпись' }).label === 'Только подпись',
    '#5113: хук только с подписью → подпись есть, пустого screen нет');
expect(A.mergePageScreen(null, { machine: 'Станок 1' }) === null, '#5113: на главной (контекста нет) хук не создаёт контекст');

// ===================== 1б) снимок экрана любого рабочего места из DOM =====================
function fakeRoot(){
    var dateWrap = { querySelector: function(){ return null; } };
    var field = { querySelector: function(sel){ return sel === 'label' ? { textContent: ' Дата плана ' } : null; } };
    dateWrap.parentNode = field;
    var attrs = function(map){ return function(k){ return map.hasOwnProperty(k) ? map[k] : null; }; };
    var controls = [
        { tagName: 'INPUT', type: 'date', value: '2026-10-09', parentNode: dateWrap, getAttribute: attrs({ title: 'С (дата плана, от)' }) },
        { tagName: 'INPUT', type: 'date', value: '2026-10-09', parentNode: dateWrap, getAttribute: attrs({}) },
        { tagName: 'INPUT', type: 'search', value: '', parentNode: null, getAttribute: attrs({ placeholder: 'Поиск по позициям…' }) },
        { tagName: 'SELECT', options: [{ textContent: 'Все статусы' }], selectedIndex: 0, labels: [{ textContent: 'Статус' }], getAttribute: attrs({}) },
        { tagName: 'INPUT', type: 'password', value: 'секрет', getAttribute: attrs({ name: 'pwd' }) },
        { tagName: 'INPUT', type: 'text', value: 'скрытое', getClientRects: function(){ return []; }, getAttribute: attrs({ name: 'x' }) },
        { tagName: 'INPUT', type: 'checkbox', checked: true, getAttribute: attrs({ 'aria-label': 'Только мои' }) }
    ];
    var tabs = [{ textContent: '  Станок 1   8 ' }, { textContent: 'Станок 1 8' }];
    return {
        innerText: 'Очередь заданий по станкам\n  Станок 1 8   Станок 2 6 \n\n № 1   01:00 – 02:38 · MWR113L IN',
        querySelectorAll: function(sel){ return sel.indexOf('input') === 0 ? controls : (sel.indexOf('aria-selected') >= 0 ? tabs : []); },
        querySelector: function(sel){ return sel.indexOf('h1') === 0 ? { textContent: ' Очередь заданий по станкам ' } : null; }
    };
}
var snap = A.collectPageScreen(fakeRoot());
expect(snap && snap.fields && snap.fields.join('|') === 'Дата плана: 2026-10-09|Статус: Все статусы|Только мои: да',
    '#5113: снимок — значения полей с подписями (обёртка, <label for>, aria-label), без дублей');
expect(snap && snap.fields.join('|').indexOf('секрет') < 0 && snap.fields.join('|').indexOf('скрытое') < 0,
    '#5113: пароли и невидимые поля в снимок не попадают');
expect(snap && snap.active && snap.active.join('|') === 'Станок 1 8', '#5113: снимок — активная вкладка');
expect(snap && snap.title === 'Очередь заданий по станкам', '#5113: снимок — заголовок рабочего места');
expect(snap && snap.text.indexOf('Станок 1 8 Станок 2 6\n№ 1 01:00 – 02:38 · MWR113L IN') >= 0,
    '#5113: снимок — видимый текст, пробелы схлопнуты');
expect(A.collectPageScreen(null) === null, '#5113: нет области рабочего места → снимка нет');
var longText = A.mergePageScreen(base(), { text: new Array(5000).join('ы') });
expect(longText.screen.text.length === A.maxScreenText, '#5113: видимый текст обрезается до maxScreenText');

// ===================== 2) чат на рабочем месте с хуком =====================
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

function setup(extra, mainRoot){
    var els = {}; IDS.forEach(function(id){ els[id] = new FE('div'); });
    var composer = new FE('div');
    composer.appendChild(els['ai-agent-attachments']);
    els.composer = composer;
    global.document = {
        readyState: 'complete',
        getElementById: function(id){ return els[id] || null; },
        createElement: function(tag){ return new FE(tag); },
        addEventListener: function(){},
        querySelector: function(sel){ return sel === 'main.app-content' ? (mainRoot || null) : null; }
    };
    global.window = Object.assign({ db: 'ateh', user: 'petrov', action: 'production-planning', id: '',
        location: { pathname: '/ateh/production-planning', search: '' } }, extra || {});
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

function scHook(){
    var screen = { label: 'Планирование · Станок 1 · 09.10.2026', machine: 'Станок 1', machine_id: 1101, plan_dates: '09.10.2026' };
    var env = setup({ integramAgentContext: function(){ return screen; } });
    env.agent.openPanel();
    var el = contextEl(env);
    expect(el && el.children[0].textContent === 'Контекст: Планирование · Станок 1 · 09.10.2026',
        '#5113: строка контекста называет станок и день с экрана');
    // Пользователь переключил вкладку — отправка берёт свежий экран, а не снимок при открытии.
    screen = { label: 'Планирование · Станок 2 · 09.10.2026', machine: 'Станок 2', machine_id: 1102, plan_dates: '09.10.2026' };
    return sendText(env, 'тот день и станок, что на экране').then(function(){
        var parsed = JSON.parse(env.posts[0].get('context'));
        expect(parsed.page === 'workplace' && parsed.workplace === 'production-planning',
            '#5113: страница рабочего места в контексте');
        expect(parsed.screen && parsed.screen.machine === 'Станок 2' && parsed.screen.machine_id === 1102
            && parsed.screen.plan_dates === '09.10.2026', '#5113: context.screen — станок и день на момент отправки');
    });
}

function scHookThrows(){
    var env = setup({ integramAgentContext: function(){ throw new Error('boom'); } });
    return sendText(env, 'что тут?').then(function(){
        var parsed = JSON.parse(env.posts[0].get('context'));
        expect(parsed.page === 'workplace' && parsed.screen === undefined,
            '#5113: хук упал → запрос уходит с контекстом страницы без screen');
    });
}

function scDom(){
    var env = setup({}, fakeRoot());
    env.agent.openPanel();
    var el = contextEl(env);
    expect(el && el.children[0].textContent === 'Контекст: Очередь заданий по станкам',
        '#5113: без хука — подпись контекста из заголовка рабочего места');
    return sendText(env, 'тот день и станок, что на экране').then(function(){
        var parsed = JSON.parse(env.posts[0].get('context'));
        expect(parsed.screen && parsed.screen.fields.indexOf('Дата плана: 2026-10-09') >= 0
            && parsed.screen.active.join('|') === 'Станок 1 8' && parsed.screen.text.indexOf('MWR113L') >= 0,
            '#5113: без хука — день, станок и видимый текст уходят агенту (рабочее место ничего не делает)');
    });
}

function scDomPlusHook(){
    var env = setup({ integramAgentContext: function(){ return { machine_id: 1101, active: ['Станок 1'] }; } }, fakeRoot());
    return sendText(env, 'что тут?').then(function(){
        var s = JSON.parse(env.posts[0].get('context')).screen;
        expect(s.machine_id === 1101 && s.active.join('|') === 'Станок 1' && s.fields.length === 3,
            '#5113: поля хука дополняют снимок и перекрывают совпадающие');
    });
}

function scNoHook(){
    var env = setup({});
    return sendText(env, 'что тут?').then(function(){
        var parsed = JSON.parse(env.posts[0].get('context'));
        expect(parsed.page === 'workplace' && parsed.screen === undefined && parsed.label === 'Рабочее место production-planning',
            '#5113: без хука — прежний контекст рабочего места');
    });
}

// ===================== 3) планирование производства =====================
function scPlanning(){
    delete global.window; delete global.document;
    var mod = require('../download/atex/js/production-planning.js');
    var c = Object.create(mod.Controller.prototype);
    c.root = { isConnected: true };
    c.meta = { cut: { id: 1125 }, slitter: { id: 1100 } };
    c.filter = { slitter: '', status: '', date: '2026-10-09', dateTo: '2026-10-09', query: '' };
    c.slitters = [
        { id: '1101', label: 'Станок 1' }, { id: '1102', label: 'Станок 2' },
        { id: '1103', label: 'Станок 3' }, { id: '1104', label: 'Станок 4' }
    ];
    c.selectedCutId = null;
    c.cuts = [
        { id: '921254', materialName: 'MWR113L', winding: 'IN', status: 'Запланирован', timing: '01:00–02:38' },
        { id: '921300', materialName: 'MB', winding: 'IN', status: '', timing: '' }
    ];
    c._agentScreen = { slitter: { id: '1101', label: 'Станок 1' }, cutIds: ['921254', '921300'], mismatchIds: ['921300'] };

    var s = c.agentScreenContext();
    expect(s && s.machine === 'Станок 1' && s.machine_id === 1101, '#5113: планирование — активный станок с id');
    expect(s && s.plan_dates === '09.10.2026', '#5113: планирование — диапазон дат плана');
    expect(s && s.label.indexOf('Станок 1') >= 0 && s.label.indexOf('09.10.2026') >= 0,
        '#5113: планирование — подпись называет станок и день');
    expect(s && s.machines.length === 4 && s.machines[3].indexOf('Станок 4') === 0,
        '#5113: планирование — все станки справочника (вкладки)');
    expect(s && s.jobs_table_id === 1125 && s.machines_table_id === 1100,
        '#5113: планирование — id таблиц заданий и станков для чтения');
    expect(s && s.jobs_on_screen_count === 2 && s.jobs_on_screen[0].indexOf('921254') >= 0
        && s.jobs_on_screen[0].indexOf('MWR113L') >= 0, '#5113: планирование — задания на экране с id');
    expect(s && s.setup_mismatch_jobs && s.setup_mismatch_jobs.join(',') === '921300',
        '#5113: планирование — задания, у которых разошлась наладка');
    expect(s && !('search' in s) && !('status' in s) && !('selected_job' in s),
        '#5113: планирование — пустые фильтры не передаются');

    c.filter.query = 'MWR'; c.filter.status = 'Запланирован'; c.filter.dateTo = '2026-10-12'; c.selectedCutId = '921254';
    s = c.agentScreenContext();
    expect(s.search === 'MWR' && s.status === 'Запланирован' && s.selected_job === 921254,
        '#5113: планирование — поиск, статус и выбранное задание');
    expect(s.plan_dates === '09.10.2026 – 12.10.2026', '#5113: планирование — диапазон из двух дат');

    c.root = { isConnected: false };
    expect(c.agentScreenContext() === null, '#5113: страница убрана из DOM → хук молчит');
    c.root = { isConnected: true }; c._agentScreen = null;
    expect(c.agentScreenContext() === null, '#5113: очередь ещё не отрисована → хук молчит');
}

scHook().then(scHookThrows).then(scDom).then(scDomPlusHook).then(scNoHook).then(scPlanning).then(function(){
    console.log('');
    if(failures){ console.log('FAILED: ' + failures + ' check(s) failed'); process.exit(1); }
    console.log('ALL TESTS PASSED');
}).catch(function(e){ console.log('ERROR: ' + (e && e.stack ? e.stack : e)); process.exit(1); });
