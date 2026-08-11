// #4718 — цепочка ЗАПИСИ рабочего места `dash-import`, а не её ядро.
//
// Дефект жил ровно здесь и никаким тестом ядра не ловился: `buildCreateOps` отдавала операцию
// `create-period-dict` (тест #4704 её проверяет), но обработчик кнопки «Создать модель» исполнял
// собственную цепочку и словарь периода не трогал. В боевой finmo после переноса модель, листы,
// панели, строки и значения были — а таблица «Год» (/finmo/table/490) осталась пустой, и дэшборд
// нарисовался без единой колонки.
//
// Поэтому тест поднимает поддельный DOM и поддельную сеть, прогоняет экран целиком (выбор файла →
// «Создать модель») и смотрит, ЧТО УШЛО В БАЗУ. На прежнем коде `_m_new/490` не было ни одного.
//
// Run with: node experiments/dash-import-4718-workplace.test.js

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    total++;
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; } else {
        console.log('  ожидалось:', JSON.stringify(expected));
        console.log('  получено: ', JSON.stringify(actual));
        process.exitCode = 1;
    }
}

// ── Поддельная схема базы (finmo в миниатюре) ───────────────────────────────────────────────
function req(id, val, alias, target, kind) {
    var r = { id: String(id), val: val, attrs: JSON.stringify({ alias: alias || val }) };
    if (target) r[kind || 'arr_id'] = String(target);
    return r;
}
var META = [
    { id: '559', val: 'Дэшборд', reqs: [req(562, 'Период', 'Период', 481, 'ref'), req(563, 'Лист', 'Лист', 551)] },
    { id: '551', val: 'Лист',    reqs: [req(552, 'Панель', 'Панель', 537), req(554, 'Год', 'Год', 490, 'ref')] },
    { id: '537', val: 'Панель',  reqs: [req(538, 'Строка', 'Строка', 509), req(539, 'RG', 'RG', 525)] },
    { id: '509', val: 'Строка',  reqs: [req(515, 'Формула_т', 'Формула'), req(524, 'Метка_т', 'Метка')] },
    { id: '525', val: 'RG',      reqs: [req(527, 'Тип RG', 'Тип RG', 473, 'ref')] },
    { id: '496', val: 'Значение', reqs: [req(498, 'Дата_т', 'Дата'), req(500, 'Строка бюджета', 'Строка бюджета', 493, 'ref'),
                                         req(508, 'Метка_т', 'Метка')] },
    { id: '473', val: 'Тип RG', reqs: [req(475, 'Код', 'Код')] }, { id: '481', val: 'Период', reqs: [] },
    { id: '493', val: 'Строка бюджета', reqs: [] },
    { id: '490', val: 'Год', reqs: [req(491, 'С_т', 'С'), req(492, 'По_т', 'По')] }
];

// ── Поддельный DOM ──────────────────────────────────────────────────────────────────────────
var ELS = {};
function mkEl(id) {
    return { id: id, hidden: true, disabled: false, value: '', textContent: '', className: '',
             innerHTML: '', href: '', download: '', files: null, handlers: {},
             addEventListener: function (t, f) { this.handlers[t] = f; },
             setAttribute: function () {}, select: function () {},
             getAttribute: function (k) {
                 return ({ 'data-db': 'finmo', 'data-xsrf': 'XSRF', 'data-user': 'admin' })[k] || ''; } };
}
global.document = {
    getElementById: function (id) { return ELS[id] || (ELS[id] = mkEl(id)); },
    createElement: function () { return mkEl('tmp'); },
    head: { appendChild: function () {} },
    body: { appendChild: function () {}, removeChild: function () {} },
    execCommand: function () { return true; }
};

// ── Поддельный SheetJS: сетка «шапка лет + две строки» ──────────────────────────────────────
var GRID = [
    [null, { v: 'Годы:' }, { v: 2026 }, { v: 2027 }, { v: 2028 }, { v: 'Итог:' }],
    [null, { v: 'Выручка' }, { v: 10 }, { v: 20 }, { v: 30 }, { v: 60 }],
    [null, { v: 'ФОТ' }, { v: 1 }, { v: 2 }, { v: 3 }, { v: 6 }]
];
var ws = {};
GRID.forEach(function (row, r) { row.forEach(function (cell, c) { if (cell) ws[r + ',' + c] = cell; }); });
ws['!ref'] = 'A1:F3';
global.window = {
    XLSX: {
        read: function () { return { SheetNames: ['Лист1'], Sheets: { 'Лист1': ws } }; },
        utils: {
            decode_range: function () { return { s: { r: 0, c: 0 }, e: { r: 2, c: 5 } }; },
            encode_cell: function (a) { return a.r + ',' + a.c; },
            encode_range: function (m) { return String(m); }
        }
    }
};

// ── Поддельная сеть ─────────────────────────────────────────────────────────────────────────
// ROUTES меняется между прогонами: второй сценарий поднимает УЖЕ СУЩЕСТВУЮЩУЮ модель и ПУСТОЙ
// справочник «Тип RG» — так проверяется дописывание в готовую базу.
var CALLS = [], newId = 1000;
var ROUTES = {
    '473': [{ i: 574, r: ['Repeating group', 'rg'] }, { i: 566, r: ['Сумма строки', 'line'] }],
    '559': []                                            // моделей ещё нет
};
global.FormData = function () {
    this.pairs = {};
    this.append = function (k, v) { this.pairs[k] = v; };
};
global.fetch = function (url, opts) {
    var body = (opts && opts.body) || null;
    CALLS.push({ url: url, method: (opts && opts.method) || 'GET', fields: body ? body.pairs : null });
    var answer = [];
    var table = (url.match(/object\/(\d+)\//) || [])[1];
    if (/metadata\?JSON/.test(url)) answer = META;
    else if (/_m_new\//.test(url)) answer = { id: ++newId };
    else if (/_m_set\//.test(url)) answer = { id: 1 };
    else if (table && ROUTES[table]) answer = ROUTES[table];
    else answer = [];                                    // пустая база: словарь «Год» тоже пуст
    return Promise.resolve({
        ok: true, status: 200,
        text: function () { return Promise.resolve(JSON.stringify(answer)); }
    });
};

// Модуль читает DOM при загрузке — поэтому подключаем ПОСЛЕ подмены глобалей.
var DI = require('../js/dash-import.js');

// Элементы читаем через document: на коде БЕЗ фикса панели отладки в разметке нет, и тест должен
// сказать «не открылась», а не упасть на undefined.
function el(id) { return document.getElementById(id); }

function settle(times) {                                  // дать промисам экрана отработать
    var p = Promise.resolve();
    for (var i = 0; i < (times || 60); i++) p = p.then(function () {
        return new Promise(function (r) { setTimeout(r, 0); }); });
    return p;
}

var file = { name: 'Лангемак.xlsx', size: 1024,
             arrayBuffer: function () { return Promise.resolve(new ArrayBuffer(8)); } };

el('di-file').handlers.change({ target: { files: [file] } });

settle(10).then(function () {
    assert(!el('di-preview-step').hidden, 'после разбора файла показан предпросмотр');
    assert(!el('di-debug-step').hidden, '#4718: панель отладки открывается сразу после разбора');
    assert(/файл разобран/.test(el('di-debug-text').value),
        '#4718: в панели видно, что распознано', el('di-debug-text').value.split('\n')[0]);

    CALLS.length = 0;
    el('di-create').handlers.click();
    return settle(120);
}).then(function () {
    var years = CALLS.filter(function (c) { return /_m_new\/490/.test(c.url); });

    assert(years.length === 6,
        '#4718: словарь «Год» заполняется — годы файла (2026–2028) плюс запас в три года',
        'создано записей: ' + years.length);

    assertEqual(years.map(function (c) { return c.fields.t490; }),
        ['2026', '2027', '2028', '2029', '2030', '2031'],
        '#4718: имя записи словаря — сам год');

    assertEqual((years[0] || {}).fields, { t490: '2026', t491: '01.01.2026', t492: '31.12.2026', _xsrf: 'XSRF' },
        '#4718: у года заполнены обе границы — без «С»/«По» `dash` строку словаря отбрасывает');

    // Порядок важен: дэшборд ссылается на период, поэтому словарь пишется ДО модели.
    var firstYear = CALLS.findIndex(function (c) { return /_m_new\/490/.test(c.url); });
    var dashboard = CALLS.findIndex(function (c) { return /_m_new\/559/.test(c.url); });
    assert(firstYear !== -1 && dashboard !== -1 && firstYear < dashboard,
        '#4718: словарь периода пишется ПЕРВЫМ, до дэшборда',
        'словарь #' + firstYear + ', дэшборд #' + dashboard);

    // Остальное поведение не сломано: модель, лист, панель, строки и значения на месте.
    var by = function (t) { return CALLS.filter(function (c) {
        return new RegExp('_m_new/' + t + '\\?').test(c.url); }).length; };
    assertEqual([by(559), by(551), by(537), by(509), by(496)], [1, 1, 1, 2, 6],
        'модель, лист, панель, две строки и шесть значений записаны как прежде');

    assert(/Готово: годов 6/.test(el('di-status').textContent),
        '#4718: итог называет число созданных годов', el('di-status').textContent);

    var trace = JSON.parse(JSON.stringify(DI.createTrace({}).toJSON()));   // форма выгрузки
    assert(trace.tool === 'dash-import' && Array.isArray(trace.entries),
        '#4718: выгрузка отладки — это JSON с трассой');
    assert(/создано в таблице 490/.test(el('di-debug-text').value),
        '#4718: запись года видна в панели отладки — по ней разбирают чужой прогон');

    // ── Справочники вообще: «Период», «Строка бюджета» и запись ссылки ID ───────────────────
    var periodRecs = CALLS.filter(function (c) { return /_m_new\/481/.test(c.url); });
    assertEqual(periodRecs.map(function (c) { return c.fields.t481; }), ['Год'],
        'справочник «Период» дополняется записью вида оси — раньше её никто не заводил');

    var dash = CALLS.filter(function (c) { return /_m_new\/559/.test(c.url); })[0];
    assert(dash && dash.fields.t562 === String(periodRecs[0] ? 1001 : ''),
        'вид оси записан ID записи справочника: `_m_set` имя приводит к 0 и стирает ссылку',
        JSON.stringify(dash && dash.fields.t562));

    var budget = CALLS.filter(function (c) { return /_m_new\/493/.test(c.url); });
    assertEqual(budget.map(function (c) { return c.fields.t493; }), ['Выручка', 'ФОТ'],
        'справочник «Строка бюджета» получает имена строк модели — без них числа записать некуда');

    // ── Второй прогон: модель уже есть, словарь «Тип RG» пуст ───────────────────────────────
    ROUTES['559'] = [{ i: 900, r: ['Лангемак'] }];         // модель нашлась по имени
    ROUTES['473'] = [];                                    // а кодов режимов колонок в базе нет
    ROUTES['481'] = [{ i: 1001, r: ['Год'] }];             // вид оси уже заведён первым прогоном
    CALLS.length = 0;
    el('di-create').handlers.click();
    return settle(120);
}).then(function () {
    var rgTypes = CALLS.filter(function (c) { return /_m_new\/473/.test(c.url); });
    assertEqual(rgTypes.map(function (c) { return c.fields.t475; }), ['rg', 'line'],
        'пустой справочник «Тип RG» конвертор заполняет сам — коды `rg` и `line`, а не названия');

    var setDash = CALLS.filter(function (c) { return /_m_set\/900/.test(c.url); })[0];
    assert(setDash && setDash.fields.t562 === '1001',
        'у найденной модели вид оси проставляется правкой записи — пустой период оставлял её без колонок',
        JSON.stringify(setDash && setDash.fields));

    assertEqual(CALLS.filter(function (c) { return /_m_new\/481/.test(c.url); }).length, 0,
        'существующая запись справочника переиспользуется, дубль не заводится (#4327)');

    assert(!CALLS.some(function (c) { return /_m_new\/490/.test(c.url); }) === false,
        'годы дописываются и во второй раз (словарь по-прежнему пуст в этой фикстуре)');

    console.log('\n' + passed + ' проверок прошли из ' + total);
});
