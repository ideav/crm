/*
 * ideav/crm#5498: шестерёнка ИИ-чата — выбор модели (наш агент или свой LLM-прокси базы).
 * https://github.com/ideav/crm/issues/5498
 *
 * Настройка — строки «Настройки» (269) с «Тип» AI_LLM_*; окно пишет их штатными _m_*.
 *   S1) «Свой прокси»: новые строки — _m_new/269 с t271 = ключ, существующие — _m_set по id;
 *   S2) пустой ключ при заданном — ключ не трогаем; при незаданном — ошибка без записи;
 *   S3) адрес только https, ключ без пробелов;
 *   S4) «Наш агент» удаляет все строки AI_LLM_* (ключ чужого прокси в базе не остаётся);
 *   S5) отказ ядра «Недостаточно прав» — понятная ошибка про право записи в «Настройку»;
 *   U1) окно: поле ключа пустое, ключ не показывается; выбор прокси подставляет адрес и модель;
 *   U2) «Сохранить» шлёт ops по очереди с _xsrf и перечитывает настройку;
 *   U3) без права записи — всё выключено, кнопка не пишет.
 *
 * Run with: node experiments/ai-agent-settings-5498.test.js
 */
'use strict';

var realSetTimeout = global.setTimeout;
var failures = 0;
function expect(cond, name){
    if(cond){ console.log('PASS: ' + name); } else { console.log('FAIL: ' + name); failures++; }
}
function settle(){ return new Promise(function(res){ realSetTimeout(res, 20); }); }

// --- Фейковый DOM: ровно то, что трогает js/ai-agent-settings.js ---
function FE(tag){
    this.tag = tag; this.children = []; this.attrs = {}; this.className = '';
    this.hidden = false; this.disabled = false; this.value = ''; this.checked = false;
    this.listeners = {}; this._text = '';
}
FE.prototype.appendChild = function(c){ c.parentNode = this; this.children.push(c); return c; };
FE.prototype.removeChild = function(c){ this.children.splice(this.children.indexOf(c), 1); return c; };
Object.defineProperty(FE.prototype, 'firstChild', { get: function(){ return this.children[0] || null; } });
FE.prototype.setAttribute = function(k, v){ this.attrs[k] = String(v); };
FE.prototype.addEventListener = function(ev, fn){ this.listeners[ev] = fn; };
FE.prototype.fire = function(ev){ if(this.listeners[ev]) this.listeners[ev]({}); };
FE.prototype.click = function(){ if(!this.disabled) this.fire('click'); };
Object.defineProperty(FE.prototype, 'textContent', {
    get: function(){ return this._text + this.children.map(function(c){ return c.textContent; }).join(''); },
    set: function(v){ this._text = String(v); this.children = []; }
});
function all(node, pred, out){
    out = out || [];
    (node.children || []).forEach(function(c){ if(pred(c)) out.push(c); all(c, pred, out); });
    return out;
}
FE.prototype.querySelector = function(sel){
    var cls = sel.slice(1);
    return all(this, function(c){ return (' ' + c.className + ' ').indexOf(' ' + cls + ' ') >= 0; })[0] || null;
};
global.document = { createElement: function(t){ return new FE(t); },
                    createTextNode: function(t){ var n = new FE('#text'); n._text = String(t); return n; } };
function FormDataStub(){ this.fields = {}; }
FormDataStub.prototype.append = function(k, v){ this.fields[k] = v; };
global.FormData = FormDataStub;

var S = require('../js/ai-agent-settings.js');

// --- S: что пишется в «Настройку» ---
var empty = { ids: {}, hasToken: false };
var full = { hasToken: true, ids: { AI_LLM_URL: '501', AI_LLM_TOKEN: '502', AI_LLM_MODEL: '503', AI_LLM_PROVIDER: '504' } };
var form = { mode: 'custom', provider: 'openrouter', url: 'https://openrouter.ai/api/v1/', model: 'm1', token: 'sk-1' };

var p = S.planSave(empty, form);
expect(!p.error && p.ops.length === 4, 'S1: свой прокси с нуля — четыре новые строки');
expect(p.ops.every(function(o){ return o.path === '_m_new/269?JSON=1&up=1'; }), 'S1: новые строки — _m_new/269');
var byKey = {};
p.ops.forEach(function(o){ byKey[o.fields.t271] = o.fields.t269; });
expect(byKey.AI_LLM_URL === 'https://openrouter.ai/api/v1' && byKey.AI_LLM_TOKEN === 'sk-1'
    && byKey.AI_LLM_MODEL === 'm1' && byKey.AI_LLM_PROVIDER === 'openrouter', 'S1: Тип = ключ, значение — главное (хвостовой / снят)');

p = S.planSave(full, Object.assign({}, form, { token: '' }));
expect(!p.error && p.ops.length === 3, 'S2: пустой ключ при заданном — три правки, ключ не трогаем');
expect(p.ops.every(function(o){ return /^_m_set\/50[134]\?JSON=1$/.test(o.path) && !('t271' in o.fields); }),
    'S1: существующие строки — _m_set по id');
p = S.planSave(empty, Object.assign({}, form, { token: '' }));
expect(p.error && !p.ops, 'S2: ключ не задан и не введён — ошибка, ничего не пишем');
p = S.planSave(full, Object.assign({}, form, { model: '' }));
expect(p.ops.some(function(o){ return o.path === '_m_del/503?JSON=1'; }), 'S1: стёртая модель — строка удаляется');

expect(!!S.planSave(empty, Object.assign({}, form, { url: 'http://openrouter.ai/api/v1' })).error, 'S3: http — отказ');
expect(!!S.planSave(empty, Object.assign({}, form, { url: 'https://u:p@host/v1' })).error, 'S3: логин в адресе — отказ');
expect(!!S.planSave(empty, Object.assign({}, form, { token: 'sk 1' })).error, 'S3: пробел в ключе — отказ');

p = S.planSave(full, { mode: 'ours' });
expect(p.ops.length === 4 && p.ops.every(function(o){ return /^_m_del\/50[1-4]\?JSON=1$/.test(o.path); }),
    'S4: наш агент — все строки AI_LLM_* удаляются');
expect(S.planSave(empty, { mode: 'ours' }).ops.length === 0, 'S4: наш агент без строк — нечего писать');

expect(/Настройка/.test(S.responseError(200, '<html>Недостаточно прав на запись</html>')), 'S5: отказ прав — про «Настройку»');
expect(S.responseError(200, '[{"error":"Запись занята"}]') === 'Запись занята', 'S5: ошибка ядра — как есть');
expect(S.responseError(200, '{"id":7,"obj":7}') === '', 'S5: успех — без ошибки');

// --- U: окно в панели чата ---
var chat = {
    el: function(tag, cls, text){ var n = new FE(tag); if(cls) n.className = cls; if(text !== undefined) n.textContent = text; return n; },
    link: function(href, text, cls){ var a = this.el('a', cls, text); a.setAttribute('href', href); return a; },
    getCurrentDbName: function(){ return 'db5498'; },
    getXsrfToken: function(){ return 'X1'; }
};
var calls = [];
var serverState;
global.fetch = function(url, opts){
    calls.push({ url: url, opts: opts || {} });
    var body = /ai\/agent\/settings/.test(url) ? JSON.stringify(serverState) : '{"id":1}';
    return Promise.resolve({ status: 200, json: function(){ return Promise.resolve(JSON.parse(body)); },
                             text: function(){ return Promise.resolve(body); } });
};
function inputs(box){ return all(box, function(c){ return c.tag === 'input' || c.tag === 'select'; }); }
function byType(box, type){ return inputs(box).filter(function(i){ return i.type === type; }); }
function saveBtn(box){ return box.querySelector('.ai-agent-settings-save'); }

var box = new FE('div');
box.hidden = true;
serverState = { canRead: true, canEdit: true, mode: 'custom', provider: 'openrouter', url: 'https://openrouter.ai/api/v1',
                model: 'openai/gpt-4o-mini', hasToken: true, ids: full.ids };
S.toggle(chat, box);
settle().then(function(){
    expect(calls[0].url === '/db5498/ai/agent/settings?JSON=1', 'U1: окно читает /{db}/ai/agent/settings');
    var pwd = byType(box, 'password')[0];
    expect(pwd && pwd.value === '' && /задан/.test(pwd.placeholder), 'U1: поле ключа пустое, подсказка «ключ задан»');
    expect(byType(box, 'url')[0].value === 'https://openrouter.ai/api/v1', 'U1: адрес из настройки');
    var select = inputs(box).filter(function(i){ return i.tag === 'select'; })[0];
    select.value = 'deepseek';
    select.fire('change');
    expect(byType(box, 'url')[0].value === 'https://api.deepseek.com/v1' && byType(box, 'text')[0].value === 'deepseek-chat',
        'U1: выбор прокси подставляет адрес и модель');
    pwd.value = 'sk-new';
    calls = [];
    saveBtn(box).click();
    return settle();
}).then(function(){
    var posts = calls.filter(function(c){ return c.opts.method === 'POST'; });
    expect(posts.length === 4 && posts.every(function(c){ return c.opts.body.fields._xsrf === 'X1'; }), 'U2: четыре записи с _xsrf');
    expect(posts.some(function(c){ return c.url === '/db5498/_m_set/502?JSON=1' && c.opts.body.fields.t269 === 'sk-new'; }),
        'U2: новый ключ пишется в строку ключа');
    expect(calls[calls.length - 1].url === '/db5498/ai/agent/settings?JSON=1', 'U2: после записи настройка перечитана');
    expect(/Сохранено/.test(box.textContent), 'U2: «Сохранено»');

    // U3: только чтение
    box = new FE('div'); box.hidden = true;
    serverState = { canRead: true, canEdit: false, mode: 'ours', provider: '', url: '', model: '', hasToken: false, ids: {} };
    calls = [];
    S.toggle(chat, box);
    return settle();
}).then(function(){
    expect(inputs(box).every(function(i){ return i.disabled; }) && saveBtn(box).disabled, 'U3: без права записи всё выключено');
    expect(/правом записи/.test(box.textContent), 'U3: сказано, кто может изменить');
    calls = [];
    saveBtn(box).click();
    expect(calls.length === 0, 'U3: кнопка не пишет');

    box = new FE('div'); box.hidden = true;
    serverState = { canRead: false, canEdit: false };
    S.toggle(chat, box);
    return settle();
}).then(function(){
    expect(inputs(box).length === 0 && /нет к ней доступа/.test(box.textContent), 'U3: нет доступа к «Настройке» — только пояснение');
    console.log(failures ? '\n' + failures + ' FAILED' : '\nALL PASS');
    process.exitCode = failures ? 1 : 0;
});

// P1: Polza.ai — первая в списке, с партнёрской ссылкой владельца (#5498).
expect(S.PROVIDERS[0].id === 'polza' && S.PROVIDERS[0].url === 'https://polza.ai/api/v1'
    && /referral=JZIhyXi2V0/.test(S.PROVIDERS[0].link), 'P1: Polza.ai первой, адрес API и партнёрская ссылка');
