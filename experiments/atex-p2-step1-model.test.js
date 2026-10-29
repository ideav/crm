// ideav/crm#5301 §1.1 — Фаза 2 atex (этикетка), шаг 1: модель данных и позиция заказа.
//
// Что проверяется (план тестирования #5301, блок 1.1):
//   1. таблицы этикетки (§3.2 состава) резолвятся из /metadata по конфигурации
//      производства «этикетка»; id берутся из метаданных, а не из кода;
//      конфигурация совпадает с декларацией схемы docs/atex_phase2_schema.json;
//   2. позиция «Вид продукции = этикетка» не попадает в планирование резок Фазы 1,
//      позиция «рулон» — в планирование высечки (оба фильтра);
//   3. позиция без вида продукции (старые данные) ведёт себя как «рулон» — Фаза 1
//      не теряет ни одной позиции;
//   4. разбор «Типа ножей» из выгрузки 1С: «85 х 38 (80)» → этикетка 85×38, втулка
//      80 мм; кривая строка → ошибка строки, а не тихий 0.
//
// Run with: node experiments/atex-p2-step1-model.test.js

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

// ── Синтетические метаданные из декларации схемы ─────────────────────────────
// Так выглядит ответ /metadata после наката docs/atex_phase2_schema.json:
// таблица — { id, val, reqs }, ссылка — реквизит с val = имя цели и alias = имя поля,
// подчинённая — отдельная запись массива плюс реквизит родителя с arr_id.
// Существующие таблицы Фазы 1 добавляются с тем же устройством.
function flattenTables(list, out) {
    (list || []).forEach(function(t) {
        out.push(t);
        flattenTables(t.children, out);
    });
    return out;
}
var SCHEMA_TABLES = flattenTables(schema.tables, []);

function buildMetadata(base) {
    var next = base;
    var meta = [];
    var byName = {};
    SCHEMA_TABLES.forEach(function(t) {
        if (byName[t.name]) return;
        var entry = { id: String(next++), val: t.name, type: '3', reqs: [] };
        byName[t.name] = entry;
        meta.push(entry);
    });
    SCHEMA_TABLES.forEach(function(t) {
        var entry = byName[t.name];
        (t.fields || []).forEach(function(f) {
            var req = { id: String(next++), val: f.ref || f.name, type: '3' };
            if (f.ref) { req.ref = byName[f.ref] ? byName[f.ref].id : '18'; req.ref_id = String(next++); }
            if (f.ref && f.ref !== f.name) req.field_attrs = { alias: f.name };
            entry.reqs.push(req);
        });
        (t.children || []).forEach(function(c) {
            entry.reqs.push({ id: String(next++), val: c.name, type: '3', arr_id: byName[c.name].id });
        });
    });
    return meta;
}

// ── 1. Резолв таблиц по конфигурации производства ────────────────────────────
(function() {
    var cfg = LP.PRODUCTION_CONFIGS[LP.PRODUCT_KIND.LABEL];
    assert(cfg && cfg.tables, 'есть конфигурация производства «этикетка»');

    // Конфигурация и декларация схемы говорят об одних и тех же таблицах и полях.
    var declared = {};
    SCHEMA_TABLES.forEach(function(t) {
        declared[t.name] = declared[t.name] || {};
        (t.fields || []).forEach(function(f) { declared[t.name][f.name] = true; });
        (t.children || []).forEach(function(c) { declared[t.name][c.name] = true; });
    });
    var notDeclared = [];
    Object.keys(cfg.tables).forEach(function(key) {
        var spec = cfg.tables[key];
        if (!declared[spec.name]) { notDeclared.push(spec.name); return; }
        Object.keys(spec.reqs || {}).forEach(function(rk) {
            if (!declared[spec.name][spec.reqs[rk]]) notDeclared.push(spec.name + ' → ' + spec.reqs[rk]);
        });
    });
    assert(notDeclared.length === 0, 'все таблицы и поля конфигурации «этикетка» объявлены в docs/atex_phase2_schema.json',
        notDeclared.length ? '(нет: ' + notDeclared.join('; ') + ')' : '');

    // Все таблицы §3.2 состава решения входят в конфигурацию.
    var names = Object.keys(cfg.tables).map(function(k) { return cfg.tables[k].name; });
    ['Сырьё этикетки', 'Партия джамбо', 'Вал', 'Нож', 'Движение пробега', 'Станок высечки',
        'Задание первичной резки', 'Полоса раскроя', 'Мастер-рулон', 'Задание высечки',
        'Событие смены высечки', 'Обеспечение этикетки', 'Партия ГП этикетки',
        'Заказанное количество', 'Заказ', 'Задача на втулки'].forEach(function(n) {
        assert(names.indexOf(n) >= 0, 'конфигурация «этикетка» содержит таблицу «' + n + '»');
    });

    // id приходят из метаданных: на двух разных сборках — разные id, оба верные.
    [1000, 70000].forEach(function(base) {
        var meta = buildMetadata(base);
        var res = LP.resolveProductionTables(meta, LP.PRODUCT_KIND.LABEL);
        assert(res.ok === true && res.missing.length === 0, 'база с id от ' + base + ': всё резолвится',
            res.missing.length ? '(нет: ' + res.missing.join('; ') + ')' : '');
        var die = meta.filter(function(t) { return t.val === 'Нож'; })[0];
        assert(res.tables.die && res.tables.die.id === die.id, 'база с id от ' + base + ': «Нож» = ' + die.id,
            '(получено ' + (res.tables.die && res.tables.die.id) + ')');
        var job = meta.filter(function(t) { return t.val === 'Задание высечки'; })[0];
        var posReq = job.reqs.filter(function(r) { return r.field_attrs && r.field_attrs.alias === 'Позиция заказа'; })[0];
        assert(res.tables.dieJob && res.tables.dieJob.reqs.position === posReq.id,
            'база с id от ' + base + ': ссылка «Позиция заказа» задания высечки найдена по псевдониму',
            '(получено ' + (res.tables.dieJob && res.tables.dieJob.reqs.position) + ', ждём ' + posReq.id + ')');
        var pos = meta.filter(function(t) { return t.val === 'Заказанное количество'; })[0];
        var kindReq = pos.reqs.filter(function(r) { return r.val === 'Вид продукции'; })[0];
        assert(res.tables.position.reqs.productKind === kindReq.id,
            'база с id от ' + base + ': «Вид продукции» позиции = ' + kindReq.id);
    });

    // Недостающая таблица называется вслух, а не превращается в undefined-id.
    var broken = buildMetadata(1000).filter(function(t) { return t.val !== 'Движение пробега'; });
    var res2 = LP.resolveProductionTables(broken, LP.PRODUCT_KIND.LABEL);
    assert(res2.ok === false && res2.missing.indexOf('Движение пробега') >= 0,
        'нет таблицы «Движение пробега» → ok=false и она в missing', '(missing: ' + res2.missing.join('; ') + ')');
    assert(!res2.tables.dieRun, 'ненайденная таблица не попадает в результат с пустым id');

    var unknown = LP.resolveProductionTables(buildMetadata(1000), 'флексопечать');
    assert(unknown.ok === false && unknown.missing.length > 0, 'неизвестная конфигурация производства → ok=false');
})();

// ── 2–3. Вид продукции позиции и фильтры планировщиков ───────────────────────
(function() {
    var cases = [
        [undefined, 'рулон'], [null, 'рулон'], ['', 'рулон'], ['  ', 'рулон'],
        ['рулон', 'рулон'], ['Рулон', 'рулон'], ['этикетка', 'этикетка'], [' Этикетка ', 'этикетка'],
        ['5312:этикетка', 'этикетка'], ['5311:рулон', 'рулон']
    ];
    cases.forEach(function(c) {
        var got = LP.productKindOf(c[0]);
        assert(got === c[1], 'вид продукции ' + JSON.stringify(c[0]) + ' → «' + c[1] + '»', '(получено ' + JSON.stringify(got) + ')');
    });
    assert(LP.productKindOf('флексо') === '', 'неизвестный вид продукции → «» (не угадываем)');

    var rows = [
        { position_id: '1', product_kind: 'рулон' },
        { position_id: '2', product_kind: 'этикетка' },
        { position_id: '3' },                        // старые данные — колонки нет
        { position_id: '4', product_kind: '' },      // поле не заполнено
        { position_id: '5', product_kind: '77:этикетка' },
        { position_id: '6', product_kind: 'флексо' }
    ];
    var ids = function(list) { return list.map(function(r) { return r.position_id; }).join(','); };
    var rolls = LP.filterPositionRows(rows, LP.PRODUCT_KIND.ROLL);
    assert(ids(rolls.rows) === '1,3,4', 'планирование резок Фазы 1 получает рулоны и позиции без вида', '(получено ' + ids(rolls.rows) + ')');
    var labels = LP.filterPositionRows(rows, LP.PRODUCT_KIND.LABEL);
    assert(ids(labels.rows) === '2,5', 'планирование высечки получает только этикетку', '(получено ' + ids(labels.rows) + ')');
    assert(ids(rolls.unknown) === '6' && ids(labels.unknown) === '6',
        'позиция с неизвестным видом не уходит ни в один планировщик и называется', '(рулоны: ' + ids(rolls.unknown) + ', этикетка: ' + ids(labels.unknown) + ')');
})();

// Планировщик Фазы 1: loadPositions не пускает этикетку ни в дропдаун, ни в генерацию.
(function() {
    pending++;
    global.window = { db: 'testdb', xsrf: 'x' };
    var Controller = require('../download/atex/js/production-planning.js').Controller;
    var c = new Controller({ getAttribute: function() { return 'testdb'; } });
    c.getJson = function() {
        return Promise.resolve([
            { position_id: '11', position_width: '85', position_qty: '10', product_kind: 'рулон' },
            { position_id: '12', position_width: '85', position_qty: '50', product_kind: 'этикетка' },
            { position_id: '13', position_width: '120', position_qty: '7' }
        ]);
    };
    var log = console.log, warn = console.warn;
    console.log = function() {}; console.warn = function() {};
    c.loadPositions().then(function() {
        console.log = log; console.warn = warn;
        var gen = (c.genPositions || []).map(function(p) { return p.id; }).join(',');
        var drop = (c.positions || []).map(function(p) { return p.id; }).join(',');
        assert(gen === '11,13', 'loadPositions: генерация резок без позиции-этикетки', '(получено ' + gen + ')');
        assert(drop === '11,13', 'loadPositions: дропдаун привязки без позиции-этикетки', '(получено ' + drop + ')');
    }).catch(function(e) {
        console.log = log; console.warn = warn;
        assert(false, 'loadPositions не падает', String(e && e.stack || e));
    }).then(function() { pending--; done(); });
})();

// ── 4. Разбор «Типа ножей» ───────────────────────────────────────────────────
(function() {
    var ok = [
        ['85 х 38 (80)',          { width: 85, length: 38, sleeveWidth: 80, streams: null, round: false }],
        ['148 х 210 (80)',        { width: 148, length: 210, sleeveWidth: 80, streams: null, round: false }],
        ['58 х 60 (70)',          { width: 58, length: 60, sleeveWidth: 70, streams: null, round: false }],
        ['18 х 18 (80)15 ручъев', { width: 18, length: 18, sleeveWidth: 80, streams: 15, round: false }],
        ['18 х 18 (80) 15 ручьёв', { width: 18, length: 18, sleeveWidth: 80, streams: 15, round: false }],
        ['102 х 120,5 (76)',      { width: 102, length: 120.5, sleeveWidth: 76, streams: null, round: false }],
        ['58 x 60 (70)',          { width: 58, length: 60, sleeveWidth: 70, streams: null, round: false }],
        ['85×38(80)',             { width: 85, length: 38, sleeveWidth: 80, streams: null, round: false }],
        ['D х 40 (76)',           { width: 40, length: 40, sleeveWidth: 76, streams: null, round: true }]
    ];
    ok.forEach(function(c) {
        var r = LP.parseKnifeType(c[0]);
        var e = c[1];
        var same = r && r.ok === true && r.width === e.width && r.length === e.length &&
            r.sleeveWidth === e.sleeveWidth && r.streams === e.streams && r.round === e.round;
        assert(same, 'тип ножей «' + c[0] + '» → ' + JSON.stringify(e), '(получено ' + JSON.stringify(r) + ')');
    });
    ['', null, '85 х 38', '85 х (80)', 'х 38 (80)', 'нож 85', '0 х 38 (80)', '85 х 38 (0)', '85 х 38 (80) чего-то'].forEach(function(s) {
        var r = LP.parseKnifeType(s);
        assert(r && r.ok === false && typeof r.error === 'string' && r.error !== '' && r.width === undefined,
            'кривой тип ножей ' + JSON.stringify(s) + ' → ошибка строки без чисел', '(получено ' + JSON.stringify(r) + ')');
    });
})();

done();
