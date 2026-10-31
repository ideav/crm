// ideav/crm#5306 — доработки модели данных этикетки после #5305.
//
//   1. «Вид движения пробега» — справочник, а не свободный текст: пробег ножа = сумма
//      всех движений за жизнь ножа (ножи не затачиваются, #5323), «начальный остаток» у ножа ровно один и
//      повторный импорт его перезаписывает;
//   2. раппорт хранится только у вала (зубья × 3.175 мм); пара «зубья ↔ раппорт» вала и
//      раппорт ножа из базы 1С против раппорта его вала проверяются;
//   3. без модуля label-production.js позиции этикетки всё равно не уходят в резки Фазы 1;
//   4. у ножа хранится основа (бумага / ПП) — справочник «Основа сырья», тот же, что у
//      «Сырья этикетки».
//
// Run with: node experiments/atex-p2-5306-model-fixes.test.js

process.env.TZ = 'UTC';
var fs = require('fs');
var path = require('path');

var passed = 0, total = 0, pending = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}
function done() { if (pending === 0) console.log('\n' + passed + '/' + total + ' проверок пройдено.'); }

var LP = require('../download/atex/js/label-production.js').core;
var schema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'atex_phase2_schema.json'), 'utf8'));
function flatten(list, out) { (list || []).forEach(function(t) { out.push(t); flatten(t.children, out); }); return out; }
var TABLES = flatten(schema.tables, []);
function table(name) { return TABLES.filter(function(t) { return t.name === name; })[0]; }
function field(t, name) { return ((t && t.fields) || []).filter(function(f) { return f.name === name; })[0]; }

// ── 1, 2, 4. Декларация схемы и конфигурация ─────────────────────────────────
(function() {
    var kindDict = table('Вид движения пробега');
    assert(kindDict && kindDict.unique === true, 'справочник «Вид движения пробега» объявлен');
    var kindField = field(table('Движение пробега'), 'Вид движения пробега');
    assert(kindField && kindField.ref === 'Вид движения пробега', '«Движение пробега» → «Вид движения пробега» — ссылка на справочник',
        '(получено ' + JSON.stringify(kindField) + ')');

    var baseDict = table('Основа сырья');
    assert(baseDict && baseDict.unique === true, 'справочник «Основа сырья» объявлен');
    var matBase = field(table('Сырьё этикетки'), 'Основа');
    assert(matBase && matBase.ref === 'Основа сырья', '«Сырьё этикетки» → «Основа» — ссылка на «Основа сырья»', '(получено ' + JSON.stringify(matBase) + ')');
    var die = table('Нож');
    var dieBase = field(die, 'Основа');
    assert(dieBase && dieBase.ref === 'Основа сырья', '«Нож» → «Основа» — ссылка на «Основа сырья»', '(получено ' + JSON.stringify(dieBase) + ')');
    assert(!field(die, 'Сырьё этикетки'), 'у ножа нет ссылки на конкретное сырьё');
    assert(!field(die, 'Раппорт, мм'), 'у ножа нет своего раппорта — он у вала');
    assert(field(table('Вал'), 'Раппорт, мм'), 'раппорт хранится у вала');

    var cfg = LP.PRODUCTION_CONFIGS[LP.PRODUCT_KIND.LABEL].tables;
    assert(cfg.die.reqs.base === 'Основа' && !cfg.die.reqs.material && !cfg.die.reqs.repeat,
        'конфигурация ножа: основа есть, сырья и раппорта нет', '(reqs: ' + JSON.stringify(cfg.die.reqs) + ')');
    assert(cfg.material.reqs.base === 'Основа', 'конфигурация сырья: основа');
    assert(cfg.runKind && cfg.runKind.name === 'Вид движения пробега', 'конфигурация: справочник видов движения пробега');
    assert(cfg.materialBase && cfg.materialBase.name === 'Основа сырья', 'конфигурация: справочник основ сырья');
})();

// ── 1. Пробег ножа по движениям ──────────────────────────────────────────────
(function() {
    var K = LP.RUN_KIND;
    var runs = [
        { id: 'a', date: 100, kind: 'начальный остаток', meters: 12000 },
        { id: 'b', date: 200, kind: '71:вырубка', meters: 500 },
        { id: 'c', date: 300, kind: 'ВЫРУБКА', meters: 1000 },
        { id: 'd', date: 400, kind: ' вырубка ', meters: 300 },
        { id: 'e', date: 500, kind: 'вырубка', meters: 200 }
    ];
    var r = LP.dieMileage(runs);
    assert(r.meters === 14000 && r.errors.length === 0, 'пробег — начальный остаток + все вырубки: 12000 + 500 + 1000 + 300 + 200 = 14000',
        '(получено ' + JSON.stringify(r) + ')');
    var shuffled = [runs[4], runs[2], runs[0], runs[3], runs[1]];
    assert(LP.dieMileage(shuffled).meters === 14000, 'порядок записей в ответе не важен');
    var head = LP.dieMileage(runs.slice(0, 2));
    assert(head.meters === 12500, 'начальный остаток + вырубка = 12500', '(получено ' + head.meters + ')');
    var typo = LP.dieMileage(runs.concat([{ id: 'f', date: 600, kind: 'вырубкаа', meters: 999 }]));
    assert(typo.meters === 14000 && typo.errors.length === 1 && /вырубкаа/.test(typo.errors[0]),
        'неизвестный вид движения не попадает в сумму и называется', '(получено ' + JSON.stringify(typo) + ')');
    assert(LP.runKindOf('12:Начальный остаток') === K.INITIAL && LP.runKindOf(' Вырубка ') === K.CUT && LP.runKindOf('заточка') === '' && LP.runKindOf('x') === '',
        'вид движения: подпись или «id:подпись», регистр и пробелы не важны');

    // «Начальный остаток» — одна запись на нож; повторный импорт её перезаписывает.
    var p0 = LP.initialRunPlan([{ id: 'b', date: 1, kind: 'вырубка', meters: 5 }], 12000);
    assert(p0.op === 'new', 'начального остатка нет → создать', JSON.stringify(p0));
    var p1 = LP.initialRunPlan(runs, 12000);
    assert(p1.op === 'none', 'тот же начальный остаток → ничего не писать', JSON.stringify(p1));
    var p2 = LP.initialRunPlan(runs, 15000);
    assert(p2.op === 'set' && p2.id === 'a' && p2.meters === 15000, 'другой пробег в 1С → перезаписать ту же запись', JSON.stringify(p2));
    var p3 = LP.initialRunPlan(runs.concat([{ id: 'z', date: 50, kind: 'начальный остаток', meters: 1 }]), 12000);
    assert(p3.op === 'error' && p3.ids.join(',') === 'a,z', 'два начальных остатка → ошибка с id обоих, а не выбор наугад', JSON.stringify(p3));
})();

// ── 2. Раппорт вала и ножа ───────────────────────────────────────────────────
(function() {
    [[96, 304.8], [104, 330.2], [106, 336.55], [116, 368.3], [120, 381.0], [132, 419.1]].forEach(function(c) {
        var got = LP.cylinderRepeatMm(c[0]);
        assert(Math.abs(got - c[1]) < 1e-9, 'вал ' + c[0] + ' зубьев → раппорт ' + c[1] + ' мм', '(получено ' + got + ')');
    });
    assert(LP.checkCylinderRepeat(96, 304.8).ok === true, 'пара 96 ↔ 304.8 согласована');
    assert(LP.checkCylinderRepeat(96, '304,8').ok === true, 'раппорт с запятой из Excel принимается');
    assert(LP.checkCylinderRepeat(106, 336.6).ok === true, 'раппорт, округлённый до десятых (106 → 336.6), согласован');
    var bad = LP.checkCylinderRepeat(96, 330.2);
    assert(bad.ok === false && /96/.test(bad.error) && /304\.8/.test(bad.error), 'пара 96 ↔ 330.2 → ошибка с ожидаемым раппортом', JSON.stringify(bad));
    assert(LP.checkCylinderRepeat(0, 0).ok === false && LP.checkCylinderRepeat('', 304.8).ok === false, 'пустой или нулевой вал → ошибка');

    assert(LP.checkDieRepeat(330.2, 104).ok === true, 'раппорт ножа из 1С совпадает с валом 104');
    var dieBad = LP.checkDieRepeat(368.3, 104);
    assert(dieBad.ok === false && /368\.3/.test(dieBad.error) && /330\.2/.test(dieBad.error), 'раппорт ножа ≠ раппорту его вала → ошибка строки', JSON.stringify(dieBad));
    assert(LP.checkDieRepeat('', 104).ok === true, 'раппорт ножа в выгрузке пуст → берётся из вала, ошибки нет');
})();

// ── 3. Без модуля этикетки позиции этикетки в резки не уходят ────────────────
(function() {
    pending++;
    global.window = { db: 'testdb', xsrf: 'x' };
    var bundlePath = require.resolve('../download/atex/js/production-planning.js');
    var modPath = require.resolve('../download/atex/js/label-production.js');
    delete require.cache[bundlePath];
    var savedMod = require.cache[modPath];
    require.cache[modPath] = { id: modPath, filename: modPath, loaded: true, exports: {} };   // модуль «не загрузился»
    var Controller = require(bundlePath).Controller;
    var c = new Controller({ getAttribute: function() { return 'testdb'; } });
    var notes = [];
    c.notify = function(msg, kind) { notes.push((kind || '') + ': ' + msg); };
    c.getJson = function() {
        return Promise.resolve([
            { position_id: '21', position_width: '85', position_qty: '10', product_kind: 'рулон' },
            { position_id: '22', position_width: '85', position_qty: '50', product_kind: 'этикетка' },
            { position_id: '23', position_width: '120', position_qty: '7' },
            { position_id: '24', position_width: '120', position_qty: '7', product_kind: '5:Рулон' },
            { position_id: '25', position_width: '90', position_qty: '3', product_kind: 'флексо' }
        ]);
    };
    var log = console.log, warn = console.warn, err = console.error;
    console.log = function() {}; console.warn = function() {}; console.error = function() {};
    c.loadPositions().then(function() {
        console.log = log; console.warn = warn; console.error = err;
        var gen = (c.genPositions || []).map(function(p) { return p.id; }).join(',');
        assert(gen === '21,23,24', 'без модуля: в генерацию только рулоны и позиции без вида', '(получено ' + gen + ')');
        assert(notes.some(function(n) { return /^error/.test(n) && /label-production/.test(n); }),
            'без модуля: ошибка показана пользователю', '(notify: ' + JSON.stringify(notes) + ')');
    }).catch(function(e) {
        console.log = log; console.warn = warn; console.error = err;
        assert(false, 'loadPositions без модуля не падает', String(e && e.stack || e));
    }).then(function() {
        if (savedMod) require.cache[modPath] = savedMod; else delete require.cache[modPath];
        pending--; done();
    });
})();

done();
