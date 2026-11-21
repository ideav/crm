// Мерка к issue ideav/crm#5602: откат импорта на экране миграции (templates/migration.html).
//
// Сервер при отказе `_d_del` отвечает обычным текстом при HTTP 200
// («Нельзя удалить тип при наличии его экземпляров (всего: 1)!»), поэтому откат
// обязан: (1) не считать такой ответ успехом — иначе таблицы молча «удаляются»,
// оставаясь в базе; (2) перед таблицей снимать её ref-тип (`referenced` из
// metadata), если ref-тип создан этим же импортом — иначе таблица-справочник
// не удалима никогда (проверка `_d_del` считает ref-тип экземпляром).
//
// Проверяется поведение реального скрипта экрана: он вырезается из шаблона и
// запускается с фейковым DOM, хранилищем и сервером, который моделирует
// отказ-текстом. Никаких утверждений о тексте исходника.
//
// Run with: node experiments/migration-rollback-5602.test.js
'use strict';

const fs = require('fs');
const path = require('path');

let failures = 0;
function expect(cond, name){
    if(cond){ console.log('PASS: ' + name); } else { console.log('FAIL: ' + name); failures++; process.exitCode = 1; }
}

// --- скрипт экрана: последний <script>-блок templates/migration.html ---
const html = fs.readFileSync(path.join(__dirname, '..', 'templates', 'migration.html'), 'utf8');
const blocks = html.match(/<script>([\s\S]*?)<\/script>/g) || [];
const src = blocks.map(function(b){ return b.replace(/^<script>/, '').replace(/<\/script>$/, ''); })
                  .filter(function(s){ return s.indexOf('doRollback') > -1; })[0];
expect(!!src, 'скрипт экрана миграции найден в шаблоне');

// --- мини-DOM: ровно то, что трогает скрипт экрана ---
function El(id, tag){
    this.id = id; this.tag = tag || 'div';
    this.children = []; this.style = {}; this.listeners = {};
    this.disabled = false; this.value = ''; this.className = '';
    this.innerHTML = ''; this.textContent = '';
    this.scrollTop = 0; this.scrollHeight = 10;
}
El.prototype.appendChild = function(c){ this.children.push(c); return c; };
El.prototype.addEventListener = function(ev, fn){ this.listeners[ev] = fn; };
El.prototype.click = function(){ if(!this.disabled && this.listeners.click) return this.listeners.click({ preventDefault: function(){} }); };

function fakeDom(){
    const els = {};
    const doc = {
        title: '',
        getElementById: function(id){ if(!els[id]){ els[id] = new El(id); } return els[id]; },
        createElement: function(tag){ return new El('', tag); },
        querySelectorAll: function(){ return []; },
        body: new El('body')
    };
    return { doc: doc, els: els };
}

function fakeStorage(seed){
    const data = {};
    if(seed){ data['migration-last-acme'] = seed; }
    return {
        getItem: function(k){ return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
        setItem: function(k, v){ data[k] = String(v); },
        removeItem: function(k){ delete data[k]; }
    };
}

// --- фейковый сервер: ref-тип blocks таблицу, отказ — текст при HTTP 200 ---
// present: id -> {t: тип строки}; refRows: ref-типы (val='') — их наличие
// блокирует удаление таблицы t (как реальная проверка `_d_del`).
function fakeServer(state){
    return function(url, opts){
        const u = String(url);
        function res(obj){ return Promise.resolve({ ok: true, status: 200, text: function(){ return Promise.resolve(typeof obj === 'string' ? obj : JSON.stringify(obj)); } }); }
        if(/\/metadata$/.test(u)){ return res(state.metadata); }
        let m = u.match(/\/_d_del\/(\d+)\?JSON=1$/);
        if(m){
            const id = m[1];
            const blockers = Object.keys(state.present).filter(function(other){
                return other !== id && state.refRows[other] === id;
            });
            if(blockers.length){
                return res('Нельзя удалить тип при наличии его экземпляров (всего: ' + blockers.length + ')!');
            }
            delete state.present[id];
            return res({ obj: id });
        }
        m = u.match(/\/_m_del\/(\d+)\?JSON=1$/);
        if(m){ delete state.present[m[1]]; return res({ obj: m[1] }); }
        m = u.match(/\/_d_del_req\/(\d+)\?JSON=1$/);
        if(m){ delete state.present[m[1]]; return res({ id: m[1] }); }
        return res({ error: 'неизвестный вызов ' + u });
    };
}

// Запуск экрана с заданным состоянием; клик по «Удалить объекты последнего импорта».
async function runScreen(state, seed){
    const dom = fakeDom();
    const storage = fakeStorage(seed);
    const calls = [];
    global.fetch = function(url, opts){
        calls.push(String(url).replace(/^\/acme\//, '').replace(/\?JSON=1$/, ''));
        return fakeServer(state)(url, opts);
    };
    global.confirm = function(){ return true; };
    global.document = dom.doc;
    global.localStorage = storage;
    global.db = 'acme'; global.token = 't'; global.xsrf = 'x'; global.role = 'admin';
    global.location = { pathname: '/acme/main' };
    new Function(src)();
    await dom.els['mig-rollback-btn'].listeners.click();
    const logText = dom.els['mig-log'].children.map(function(l){ return l.textContent; }).join('\n');
    return { dom: dom, storage: storage, calls: calls, logText: logText };
}

const REFUSAL = 'Нельзя удалить тип при наличии его экземпляров (всего: 1)!';

function metaTable(id, name, referenced){
    const t = { id: id, up: '0', type: '3', val: name, unique: '0', reqs: [] };
    if(referenced){ t.referenced = referenced; }
    return t;
}

// Сценарий из issue: справочник «Города» (1000) создан импортом; ref-тип 300,
// ведущий на него, создан тем же импортом (id ниже — переиспользован `_d_ref`);
// таблица «Заявки» (1001) и её ref-колонка (1002) тоже из импорта.
// Отказ `_d_del/1000` — текст REFUSAL при HTTP 200 (ref-тип 300 жив).
async function caseDeleteReferencedFirst(){
    const state = {
        metadata: [metaTable('1000', 'Города', '300'), metaTable('1001', 'Заявки')],
        present: { '1000': { t: '3' }, '1001': { t: '3' }, '1002': { t: '1001' }, '300': { t: '1000' } },
        refRows: { '300': '1000' }
    };
    const seed = JSON.stringify({ created: [
        { id: '1000', kind: 'type' }, { id: '1001', kind: 'type' },
        { id: '1002', kind: 'req' }, { id: '300', kind: 'type' }
    ], firstId: 300, ts: '2026-11-21 12:00', source_db: 'src', count: 4 });
    const r = await runScreen(state, seed);
    // ref-тип снимается ДО таблицы, иначе сервер отвечает отказом
    expect(r.calls.indexOf('_d_del/300') > -1 && r.calls.indexOf('_d_del/300') < r.calls.indexOf('_d_del/1000'),
        'A: ref-тип 300 снят перед таблицей 1000 (вызовы: ' + r.calls.join(', ') + ')');
    expect(!state.present['1000'], 'A: таблица 1000 реально удалена на сервере');
    expect(Object.keys(state.present).length === 0, 'A: все объекты импорта удалены (осталось: ' + Object.keys(state.present).join(', ') + ')');
    expect(/Откат завершён/.test(r.logText), 'A: журнал сообщает завершение');
    expect(r.storage.getItem('migration-last-acme') === null, 'A: сохранённый импорт снят после полного отката');
}

// Тот же отказ, но ref-тип 300 НЕ из импорта (не трогаем) — таблица остаётся,
// и откат обязан об этом честно сказать, а не «удалить» её молча.
async function caseHonestRefusal(){
    const state = {
        metadata: [metaTable('1000', 'Города', '300')],
        present: { '1000': { t: '3' }, '300': { t: '1000' } },
        refRows: { '300': '1000' }
    };
    const seed = JSON.stringify({ created: [ { id: '1000', kind: 'type' } ], firstId: 1000, ts: '2026-11-21 12:00', source_db: 'src', count: 1 });
    const r = await runScreen(state, seed);
    expect(!r.calls.some(function(c){ return c.indexOf('_d_del/300') > -1; }), 'B: чужой ref-тип 300 не удаляется');
    expect(!/Откат завершён/.test(r.logText), 'B: отказ не засчитан как успех (журнал: ' + JSON.stringify(r.logText.slice(0, 200)) + ')');
    expect(/Остались объекты/.test(r.logText) && /1000/.test(r.logText), 'B: таблица 1000 честно показана в «Остались объекты»');
    const kept = JSON.parse(r.storage.getItem('migration-last-acme') || 'null');
    expect(!!kept && kept.created.length === 1 && kept.created[0].id === '1000', 'B: недокатанный импорт остался в хранилище для повторной попытки');
    expect(!!state.present['1000'], 'B: таблица 1000 осталась на сервере');
}

// JSON-отказ (как было и до #5602) по-прежнему показывается честно.
async function caseJsonErrorStillHonest(){
    const state = {
        metadata: [metaTable('1000', 'Города')],
        present: { '1000': { t: '3' } },
        refRows: {},
        jsonRefuse: true
    };
    const srv = fakeServer(state);
    const dom = fakeDom();
    const storage = fakeStorage(JSON.stringify({ created: [ { id: '1000', kind: 'type' } ], firstId: 1000, ts: '2026-11-21 12:00', source_db: 'src', count: 1 }));
    global.fetch = function(url, opts){
        const u = String(url);
        if(/\/_d_del\/1000\?JSON=1$/.test(u)){
            return Promise.resolve({ ok: true, status: 200, text: function(){ return Promise.resolve(JSON.stringify({ error: 'Тип используется в отчетах' })); } });
        }
        return srv(url, opts);
    };
    global.confirm = function(){ return true; };
    global.document = dom.doc;
    global.localStorage = storage;
    global.db = 'acme'; global.token = 't'; global.xsrf = 'x'; global.role = 'admin';
    global.location = { pathname: '/acme/main' };
    new Function(src)();
    await dom.els['mig-rollback-btn'].listeners.click();
    const logText = dom.els['mig-log'].children.map(function(l){ return l.textContent; }).join('\n');
    expect(/Остались объекты/.test(logText), 'C: JSON-ошибка показана как «Остались объекты»');
    expect(!!state.present['1000'], 'C: таблица не удалена');
}

(async function(){
    if(!src){ return; }
    await caseDeleteReferencedFirst();
    await caseHonestRefusal();
    await caseJsonErrorStillHonest();
    if(!failures){ console.log('PASS migration-rollback-5602 (3 сценария)'); }
})();
