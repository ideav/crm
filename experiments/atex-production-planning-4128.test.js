// Integration test for ideav/crm#4128 — «Тип намотки» (IN/OUT) терялась у цепочки дробления
// по дням: её не было ни на карточке очереди, ни в «задании на наладку» (setup-сегмент).
//
// Причина — источник. Колонка отчёта `cut_winding` идёт цепочкой Обеспечение → Позиция, но
// обеспечения записи-продолжения создаются `up = positionId` БЕЗ ссылки на «Задание в
// производство», а у setup-сегмента (0 проходов) доли обеспечений обнулены. Значит у звеньев
// цепочки колонка отдаёт пустоту, хотя собственный реквизит «Тип намотки» на резке задан
// планировщиком. Дальше пустота копировалась в новые продолжения (applySplitPlan брал намотку
// у родителя) — и намотка пропадала насовсем. Ровно та же болезнь, что у «Вида сырья» в #3868.
//
// Проверяем оба конца:
//   A) loadPlanning берёт намотку из СОБСТВЕННОГО реквизита резки (object/{cutTable}), а
//      колонку отчёта оставляет фолбэком;
//   B) applySplitPlan пишет намотку ГОЛОВЫ цепочки и в создаваемое, и в реюзнутое продолжение
//      (намотка известна в момент создания записи), не трогая уже корректную голову (#4001).
//
// Run with: node experiments/atex-production-planning-4128.test.js

process.env.TZ = 'UTC';

// Без global.document модуль не запускает init при require (window есть, document — нет).
global.window = { db: 'testdb', xsrf: 'x' };

var api = require('../download/atex/js/production-planning.js');
var Controller = api.Controller;

var passed = 0;
function assert(cond, name) {
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}

function meta(id, pairs) {
    return { id: String(id), reqs: pairs.map(function(p) { return { id: String(p[0]), val: p[1] }; }) };
}

// id таблиц/реквизитов для теста (числа произвольные, важны имена).
var MAT = '190';     // «Вид сырья»
var LEN = '197';     // «Метраж, м»
var WIND = '196';    // «Тип намотки» — собственный реквизит резки (в бою 28144)
var FIXED = '188';   // «Зафиксировано»
var cutMeta = meta(100, [
    [MAT, 'Вид сырья'], [191, 'Слиттер'], [192, 'Партия сырья'], [193, 'Кол-во план'],
    [194, 'Статус'], [195, 'Очередность'], [WIND, 'Тип намотки'], [198, 'Лидер'],
    [LEN, 'Метраж, м'], [199, 'Длительность, минут'], [189, 'ID первой части'], [FIXED, 'Зафиксировано']
]);
var fbMeta = meta(200, [[201, 'Ширина, мм'], [202, 'Кол-во полос'], [203, 'Кол-во рулонов'],
    [204, 'Кол-во план'], [205, 'В работе']]);
var supMeta = meta(300, [[301, 'Метраж, м'], [302, 'Кол-во рулонов'], [303, 'В работе'],
    [304, 'Статус'], [305, 'Партия ГП']]);

var root = { getAttribute: function() { return 'testdb'; } };

// columnIndex: порядок колонок = [id таблицы, ...id реквизитов] → главное значение r[0].
var I_WIND = 7;    // MAT,191,192,193,194,195,WIND → 1..7
var I_FIXED = 12;
function cutRow(id, winding) {
    var r = ['1000', 'M7', 'S1', 'B1', '5', 'В работе', '', winding, '', '450', '60', id, ''];
    return { i: id, r: r };
}

// ── A) loadPlanning: собственный реквизит побеждает пустую колонку отчёта ──────────────
var a = new Controller(root);
a.meta.cut = cutMeta;
a.stripAgg = {};
a.notify = function() {};

// Отчёт: у головы H и продолжения C намотка ПУСТА (join через Обеспечение→Позицию не
// разрешается), у обычной резки N — 'OUT'.
var reportRows = [
    { cut_id: 'H', cut_winding: '', supply_id: 's1', supply_position_id: 'p1' },
    { cut_id: 'C', cut_winding: '' },
    { cut_id: 'N', cut_winding: 'OUT', supply_id: 's2', supply_position_id: 'p2' }
];
// object/{cutTable}: у головы H намотка задана планировщиком ('OUT'); у продолжения C её
// нет (запись создана до фикса — пустота уже уехала в БД); у N — 'OUT'.
var objRows = [cutRow('H', 'OUT'), cutRow('C', ''), cutRow('N', 'OUT')];

a.getJson = function(path) {
    if (path.indexOf('report/cut_planning') === 0) return Promise.resolve(reportRows);
    if (path.indexOf('object/100/') === 0) return Promise.resolve(objRows);
    return Promise.reject(new Error('неожиданный запрос: ' + path));
};

a.loadPlanning().then(function() {
    function cut(id) { return (a.cuts || []).filter(function(c) { return String(c.id) === id; })[0]; }

    assert(cut('H') && cut('H').winding === 'OUT',
        '#4128: setup-сегмент (голова) берёт намотку из своего реквизита, а не из пустой колонки отчёта');
    assert(cut('N') && cut('N').winding === 'OUT',
        '#4128: обычная резка не сломана — намотка по-прежнему OUT');
    assert(cut('C') && cut('C').winding === '',
        '#4128: у записи без своего реквизита и без колонки намотки нет (фолбэк не выдумывает значение)');

    return partB();
}).catch(function(err) {
    console.log('FAIL — часть A бросила: ' + (err && err.stack || err));
    process.exitCode = 1;
});

// ── B) applySplitPlan: намотка головы пишется во ВСЕ сегменты цепочки ──────────────────
function partB() {
    var c = new Controller(root);
    c.meta.cut = cutMeta; c.meta.finishedBatch = fbMeta; c.meta.supply = supMeta;

    // Цепочка: голова H (намотка 'OUT') + реюзнутое продолжение C с ПУСТОЙ намоткой.
    c.cuts = [
        { id: 'H', length: 450, materialId: 'M7', status: 'В работе', slitter: { id: 'S1' },
            batchId: 'B1', winding: 'OUT', leaders: [], firstPartId: 'H', plannedRuns: 5, number: 1000 },
        { id: 'C', length: 450, materialId: 'M7', status: 'В работе', slitter: { id: 'S1' },
            batchId: 'B1', winding: '', leaders: [], firstPartId: 'H', plannedRuns: 3, number: 2000 }
    ];
    c.supplies = [{ id: 'SUP1', cutId: 'H', rolls: 8, footage: 450, finishedBatchId: 'FB1', positionId: 'P1' }];
    c.footageBySupply = {};

    var posts = [];
    var idc = 0;
    c.post = function(path, params) { posts.push({ path: path, params: params || {} }); return Promise.resolve({ obj: 'NEW' + (++idc) }); };
    c.loadStripsForCut = function() { return Promise.resolve([]); };
    c.resolveLeaderId = function() { return ''; };
    c.reload = function() { return Promise.resolve(); };
    c.persistCutSetupColumns = function() { return Promise.resolve(); };
    c.setBusy = function() {}; c.showProgress = function() {}; c.updateProgress = function() {};
    c.hideProgress = function() {}; c.render = function() {}; c.notify = function() {};

    return c.applySplitPlan({
        updates: [
            { cutId: 'H', sequence: 1, planStartTs: 1000, plannedRuns: 5 },
            { cutId: 'C', sequence: 2, planStartTs: 2000, plannedRuns: 3 }
        ],
        creates: [{ parentCutId: 'H', sequence: 3, planStartTs: 3000, plannedRuns: 2 }],
        deletes: []
    }).then(function() {
        var tWind = 't' + WIND;

        var createCut = posts.filter(function(p) { return p.path === '_m_new/100?JSON&up=1'; });
        assert(createCut.length === 1 && String(createCut[0].params[tWind]) === 'OUT',
            '#4128: создаваемое продолжение получает «Тип намотки» = OUT (намотка головы цепочки)');

        var updC = posts.filter(function(p) { return p.path === '_m_set/C?JSON'; });
        assert(updC.length === 1 && String(updC[0].params[tWind]) === 'OUT',
            '#4128: реюзнутое продолжение с пустой намоткой получает OUT — пустота не расползается');

        var updH = posts.filter(function(p) { return p.path === '_m_set/H?JSON'; });
        assert(updH.length === 0,
            '#4001: голова с уже корректной намоткой не переписывается (лишнего _m_set нет)');

        console.log('\n' + passed + ' assertions passed');
    });
}
