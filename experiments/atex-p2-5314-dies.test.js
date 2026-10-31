// ideav/crm#5314 — рабочее место «Ножи и валы» (ИТС): статусы ножа и учёт пробега.
//
//   1. состояние ножа — запись справочника «Состояние ножа» (Рабочий, Резерв, На экспертизе,
//      Списан); переходы кнопок карточки ножа проверяются ДО записи: из «Списан» нож не
//      выходит, «уже в этом состоянии» — ошибка, а не пустая запись;
//   2. ножи не затачиваются (#5323): состояния «Заточка» и движения «заточка» нет, смена
//      состояния движений пробега не пишет;
//   3. пробег всех ножей считается одним отчётом движений: индекс «нож → пробег, движений» —
//      сумма за всю жизнь ножа; дата движения приходит unix-секундами (object/) или строкой;
//   4. история пробега ножа — с колонкой «Накоплено» (нарастающий итог);
//   5. ресурс ножа — у его марки (справочник «Марка ножа»), без марки — ресурс по умолчанию
//      из «Настройки» (DIE_RESOURCE_DEFAULT_M); ресурса нет нигде — «у ресурса» не считается.
//
// Run with: node experiments/atex-p2-5314-dies.test.js

process.env.TZ = 'UTC';

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

var LP = require('../download/atex/js/label-production.js').core;
var S = LP.DIE_STATE || {};
var A = LP.DIE_ACTION || {};

// ── 1, 2. Переходы состояний ─────────────────────────────────────────────────
(function() {
    assert(typeof LP.dieStateAction === 'function', 'dieStateAction экспортирована');
    if (typeof LP.dieStateAction !== 'function') return;

    assert(LP.dieStateOf('1000162:Рабочий') === S.WORKING && LP.dieStateOf(' на экспертизе ') === S.EXPERTISE,
        'состояние разбирается из «id:подпись» и без учёта регистра');
    assert(LP.dieStateOf('') === '' && LP.dieStateOf('нет данных') === '',
        'пустое и неизвестное состояние → «» (нож из базы с «нет данных»)');

    assert(!('SHARPENING' in S) && !('SHARPEN' in A) && !('SHARPEN' in LP.RUN_KIND),
        'заточки нет: ни состояния «Заточка», ни кнопки «На заточку», ни движения «заточка» (#5323)');
    assert(LP.dieStateOf('Заточка') === '', 'подпись «Заточка» не опознаётся как состояние ножа');

    // [из, действие, ожидаемое состояние | null = ошибка]
    var CASES = [
        [S.RESERVE, A.RETURN, S.WORKING],
        [S.EXPERTISE, A.RETURN, S.WORKING],
        [S.WORKING, A.RESERVE, S.RESERVE],
        [S.EXPERTISE, A.RESERVE, S.RESERVE],
        [S.WORKING, A.EXPERTISE, S.EXPERTISE],
        [S.RESERVE, A.EXPERTISE, S.EXPERTISE],
        [S.WORKING, A.WRITE_OFF, S.WRITTEN_OFF],
        [S.RESERVE, A.WRITE_OFF, S.WRITTEN_OFF],
        [S.EXPERTISE, A.WRITE_OFF, S.WRITTEN_OFF],
        ['', A.RETURN, S.WORKING],
        ['', A.WRITE_OFF, S.WRITTEN_OFF],
        [S.WORKING, A.RETURN, null],
        [S.RESERVE, A.RESERVE, null],
        [S.WRITTEN_OFF, A.RETURN, null],
        [S.WRITTEN_OFF, A.RESERVE, null],
        [S.WRITTEN_OFF, A.WRITE_OFF, null],
        [S.WORKING, 'sharpen', null],
        [S.WORKING, 'нечто', null]
    ];
    var bad = [];
    CASES.forEach(function(c) {
        var r = LP.dieStateAction(c[0], c[1]);
        if (c[2] === null) {
            if (r.ok !== false || !r.error) bad.push((c[0] || '∅') + ' + ' + c[1] + ' → ' + JSON.stringify(r) + ', ждали ошибку');
        } else if (!r.ok || r.state !== c[2] || r.run) {
            bad.push((c[0] || '∅') + ' + ' + c[1] + ' → ' + JSON.stringify(r) + ', ждали ' + c[2] + ' без движения пробега');
        }
    });
    assert(bad.length === 0, 'таблица переходов: ' + CASES.length + ' случаев', bad.join('; '));

    var listed = LP.dieStateActions(S.WORKING).map(function(x) { return x.action; }).sort();
    assert(JSON.stringify(listed) === JSON.stringify([A.EXPERTISE, A.RESERVE, A.WRITE_OFF].sort()),
        'кнопки карточки рабочего ножа — ровно допустимые переходы', '(получено ' + JSON.stringify(listed) + ')');
    assert(LP.dieStateActions(S.WRITTEN_OFF).length === 0, 'у списанного ножа кнопок перехода нет');
})();

// ── 3. Индекс пробега по ножам ───────────────────────────────────────────────
(function() {
    assert(typeof LP.dieMileageIndex === 'function', 'dieMileageIndex экспортирована');
    if (typeof LP.dieMileageIndex !== 'function') return;
    var rows = [
        // нож 10: начальный остаток 5000, вырубка 2000, вырубка 700 (дата строкой)
        { die_id: '10', run_id: '1', run_date: '1790000000', run_kind: '1000304:начальный остаток', meters: '5000' },
        { die_id: '10', run_id: '2', run_date: '1790003600', run_kind: 'вырубка', meters: '2000.00' },
        { die_id: '10', run_id: '4', run_date: '25.09.2026 10:00:00', run_kind: 'вырубка', meters: '700' },
        // нож 20: две вырубки
        { die_id: '20', run_id: '5', run_date: '1790000000', run_kind: 'вырубка', meters: '100' },
        { die_id: '20', run_id: '6', run_date: '1790000001', run_kind: 'вырубка', meters: '250,5' },
        // нож 30: неизвестный вид; «заточка» — тоже неизвестный вид, пробег не обнуляет
        { die_id: '30', run_id: '7', run_date: '1790000000', run_kind: 'перемотка', meters: '9' },
        { die_id: '30', run_id: '8', run_date: '1790000001', run_kind: 'вырубка', meters: '40' },
        { die_id: '30', run_id: '9', run_date: '1790000002', run_kind: 'заточка', meters: '0' },
        { die_id: '30', run_id: '10', run_date: '1790000003', run_kind: 'вырубка', meters: '60' }
    ];
    var idx = LP.dieMileageIndex(rows);
    assert(idx['10'] && idx['10'].meters === 7700 && idx['10'].runs === 3 && idx['10'].errors.length === 0,
        'нож 10: пробег за всю жизнь 5000 + 2000 + 700 = 7700 м, 3 движения', JSON.stringify(idx['10']));
    assert(idx['20'] && Math.abs(idx['20'].meters - 350.5) < 1e-9,
        'нож 20: 350.5 м (десятичная запятая)', JSON.stringify(idx['20']));
    assert(idx['30'] && idx['30'].meters === 100 && idx['30'].errors.length === 2,
        'нож 30: неизвестные виды (и «заточка») в сумму не идут, счёт не обнуляют и названы ошибками', JSON.stringify(idx['30']));
    assert(!idx['40'], 'нож без движений в индекс не попадает (пробег 0 считает вызывающий)');
})();

// ── 4. История пробега ножа ──────────────────────────────────────────────────
(function() {
    assert(typeof LP.dieRunHistory === 'function', 'dieRunHistory экспортирована');
    if (typeof LP.dieRunHistory !== 'function') return;
    var h = LP.dieRunHistory([
        { id: 'c', date: 30, kind: 'вырубка', meters: 300 },
        { id: 'a', date: 10, kind: 'начальный остаток', meters: 1000 },
        { id: 'b', date: 20, kind: 'вырубка', meters: 200 },
        { id: 'd', date: 40, kind: 'вырубка', meters: 50 }
    ]);
    var acc = h.map(function(r) { return r.id + ':' + r.accumulated; }).join(',');
    assert(acc === 'a:1000,b:1200,c:1500,d:1550', 'история по дате, «Накоплено» — нарастающий итог за всю жизнь ножа', '(получено ' + acc + ')');
})();

// ── 5. Ресурс ножа ───────────────────────────────────────────────────────────
(function() {
    assert(typeof LP.dieResource === 'function', 'dieResource экспортирована');
    if (typeof LP.dieResource === 'function') {
        var r1 = LP.dieResource('490 000', '300000'), r2 = LP.dieResource('', '300 000'),
            r3 = LP.dieResource('0', '300000'), r4 = LP.dieResource('', '');
        assert(r1.meters === 490000 && r1.source === 'brand', 'ресурс марки важнее ресурса по умолчанию', JSON.stringify(r1));
        assert(r2.meters === 300000 && r2.source === 'default' && r3.meters === 300000 && r3.source === 'default',
            'марки нет или у марки ресурс пуст/0 — ресурс по умолчанию', JSON.stringify([r2, r3]));
        assert(isNaN(r4.meters) && r4.source === '', 'ресурса нет нигде — NaN, а не 0', JSON.stringify(r4));
    }
    var cfg = (LP.PRODUCTION_CONFIGS[LP.PRODUCT_KIND.LABEL] || {}).tables || {};
    assert(cfg.dieBrand && cfg.dieBrand.name === 'Марка ножа' && cfg.dieBrand.reqs.resource === 'Ресурс, м' &&
        cfg.die.reqs.brand === 'Марка ножа', 'конфигурация: справочник «Марка ножа» с «Ресурс, м», у ножа ссылка на марку');
    assert(typeof LP.dieWearLevel === 'function', 'dieWearLevel экспортирована');
    if (typeof LP.dieWearLevel !== 'function') return;
    assert(LP.dieWearLevel(1000, '') === '' && LP.dieWearLevel(1000, '0') === '',
        'без ресурса уровень износа не определяется');
    assert(LP.dieWearLevel(100, 1000) === 'ok' && LP.dieWearLevel(900, 1000) === 'near' &&
        LP.dieWearLevel(1000, 1000) === 'over' && LP.dieWearLevel(1500, '1 000') === 'over',
        'ok < 90 % ≤ near < 100 % ≤ over; ресурс с пробелами разбирается');
    assert(LP.parseSettingNumber('1 200 000') === 1200000 && isNaN(LP.parseSettingNumber('много')),
        'число настройки: пробелы-разделители, мусор → NaN');
})();

// ── 6. Рабочее место: ножи, показатели, валы (download/atex/js/dies.js) ──────
(function() {
    var D = null;
    try { D = require('../download/atex/js/dies.js').core; } catch (e) { /* модуля нет */ }
    assert(!!D, 'модуль рабочего места dies.js загружается в Node');
    if (!D) return;

    // Таблицы, как их отдаёт resolveProductionTables на копии ateh1 (/metadata).
    var t = {
        die: { id: '14', reqs: { labelWidth: '74', labelLength: '75', streams: '77', cylinder: '86', base: '99', brand: '102', state: '101' } },
        cylinder: { id: '12', reqs: { repeat: '65' } },
        machine: { id: '13', reqs: { cylinders: '69' } }
    };
    // object/{Нож}/?JSON_KV: главные значения — в object[], реквизиты — в reqs[id].
    var dieJson = {
        object: [
            { id: '1', val: '736116' }, { id: '2', val: '728065' }, { id: '3', val: '737311' },
            { id: '4', val: '100500' }, { id: '5', val: '200600' }, { id: '6', val: '300700' }
        ],
        reqs: {
            '1': { '74': '148.00', '75': '210.00', 'ref_86': '12:96', '86': '96', 'ref_102': '20:b1', '102': 'AI(Standard)', 'ref_101': '7:162', '101': 'Рабочий' },
            '2': { 'ref_86': '12:96', '86': '96', 'ref_102': '20:b3', '102': 'GLUEX PLUS', 'ref_101': '7:162', '101': 'Рабочий' },
            '3': { 'ref_86': '12:98', '86': '98', 'ref_102': '20:b2', '102': 'BLACK TOP 3in1', 'ref_101': '7:165', '101': 'На экспертизе' },
            '4': { 'ref_101': '7:166', '101': 'Списан' },
            '5': { 'ref_101': '7:164', '101': 'Резерв' },
            '6': {}
        }
    };
    var dies = D.kvRecords(dieJson);
    assert(dies.length === 6 && dies[0].val === '736116' && dies[0].reqs['86'] === '96', 'kvRecords: главное значение + реквизиты записи');
    assert(JSON.stringify(D.refIds({ reqs: { 'ref_69': '12:96,104,116' } }, '69')) === '["96","104","116"]',
        'refIds: «таблица:id,id» → список id');

    // Марки: ресурс AI(Standard) 1000 м, BLACK TOP 3in1 3000 м, у GLUEX PLUS ресурс не задан.
    var brands = D.brandResources(D.kvRecords({
        object: [{ id: 'b1', val: 'AI(Standard)' }, { id: 'b2', val: 'BLACK TOP 3in1' }, { id: 'b3', val: 'GLUEX PLUS' }],
        reqs: { b1: { '91': '1 000' }, b2: { '91': '3000' }, b3: {} }
    }), { id: '20', reqs: { resource: '91' } });
    assert(brands.b1 === '1 000' && brands.b2 === '3000' && brands.b3 === '', 'марка → ресурс из справочника', JSON.stringify(brands));

    var mileage = LP.dieMileageIndex([
        { die_id: '1', run_id: '1', run_date: '1', run_kind: 'вырубка', meters: '950' },     // near (ресурс марки 1000)
        { die_id: '2', run_id: '2', run_date: '1', run_kind: 'вырубка', meters: '2100' },    // over (ресурс по умолчанию 2000)
        { die_id: '3', run_id: '3', run_date: '1', run_kind: 'вырубка', meters: '2500' },    // ok: у BLACK TOP 3in1 ресурс 3000
        { die_id: '4', run_id: '4', run_date: '1', run_kind: 'вырубка', meters: '7000' },    // over, но списан
        { die_id: '5', run_id: '5', run_date: '1', run_kind: 'вырубка', meters: '10' }
    ]);
    var rows = D.buildDieRows(dies, t, mileage, brands, '2000');
    var r1 = rows[0];
    assert(r1.no === '736116' && r1.cylinderId === '96' && r1.state === LP.DIE_STATE.WORKING && r1.meters === 950 &&
        r1.brand === 'AI(Standard)' && r1.resource === 1000 && r1.resourceSource === 'brand' && r1.wear === 'near' && r1.width === '148.00',
        'строка ножа: номер, вал, марка, ресурс марки, состояние, пробег, износ', JSON.stringify(r1));
    assert(rows[1].resource === 2000 && rows[1].resourceSource === 'default' && rows[1].wear === 'over',
        'у марки ресурс не задан — ресурс по умолчанию', JSON.stringify(rows[1]));
    assert(rows[2].resource === 3000 && rows[2].wear === 'ok', 'износ считается от ресурса своей марки: 2500 из 3000 — ещё ok', JSON.stringify(rows[2]));
    assert(rows[5].meters === 0 && rows[5].state === '' && rows[5].brand === '' && rows[5].resource === 2000 && rows[5].wear === 'ok',
        'нож без движений и без марки: пробег 0, ресурс по умолчанию', JSON.stringify(rows[5]));

    var k = D.dieKpi(rows);
    assert(k.total === 6 && k.working === 2 && k.expertise === 1 && k.writtenOff === 1 && k.reserve === 1 && k.noState === 1 && !('sharpening' in k),
        'показатели по состояниям, без «на заточке»', JSON.stringify(k));
    assert(k.near === 1 && k.over === 1, 'у ресурса / ресурс выработан — только ножи, которые режут (списанные не в счёт)', JSON.stringify(k));
    var wl = D.wearList(rows).map(function(d) { return d.no; }).join(',');
    assert(wl === '728065,736116', 'список «у ресурса»: больший пробег выше, списанные исключены', '(получено ' + wl + ')');
    var noRes = D.buildDieRows(dies, t, mileage, {}, '');
    assert(D.dieKpi(noRes).near === 0 && D.dieKpi(noRes).over === 0 && isNaN(noRes[0].resource),
        'ни марок, ни ресурса по умолчанию — «у ресурса» не считается');

    var cyl = D.cylinderRows(
        D.kvRecords({ object: [{ id: '98', val: '98' }, { id: '96', val: '96' }, { id: '104', val: '104' }],
            reqs: { '96': { '65': '304.80' }, '98': { '65': '311.15' }, '104': { '65': '331.00' } } }),
        D.kvRecords({ object: [{ id: 'm1', val: '1 высечка' }, { id: 'm2', val: '2 высечка' }, { id: 'm3', val: '3 высечка' }],
            reqs: { m1: { 'ref_69': '12:96,104' }, m2: { 'ref_69': '12:104' }, m3: {} } }),
        rows, t);
    var c96 = cyl[0], c98 = cyl[1], c104 = cyl[2];
    assert(cyl.map(function(c) { return c.teeth; }).join(',') === '96,98,104', 'валы по числу зубьев');
    assert(c96.machines.join('|') === '1 высечка|3 высечка' && c98.machines.join('|') === '3 высечка',
        'станки вала: из «Допустимых валов»; станок с пустым списком принимает любой вал', JSON.stringify(cyl.map(function(c) { return c.machines; })));
    assert(c96.dies === 2 && c96.working === 2 && c98.dies === 1 && c98.working === 0, 'ножей на валу (рабочих)');
    assert(c96.repeatCheck.ok && !c104.repeatCheck.ok, 'раппорт вала сверяется с зубьями × 3.175 (104 → 330.2, а не 331)');

    assert(D.RESOURCE_KEY === 'DIE_RESOURCE_DEFAULT_M', 'ресурс по умолчанию — настройка DIE_RESOURCE_DEFAULT_M');
    var settings = [
        { key: 'DIE_RESOURCE_DEFAULT_M', type: '', value: '200000' },
        { key: 'DIE_RESOURCE_DEFAULT_M', type: 'ATEH1', value: '300 000' },
        { key: 'DIE_RESOURCE_DEFAULT_M', type: 'ATEH', value: '250000' }
    ];
    assert(D.settingValue(settings, D.RESOURCE_KEY, 'ateh1') === '300 000' && D.settingValue(settings, D.RESOURCE_KEY, 'ateh') === '250000' &&
        D.settingValue(settings.slice(0, 1), D.RESOURCE_KEY, 'ateh') === '200000' && D.settingValue([], D.RESOURCE_KEY, 'ateh') === '',
        'ресурс по умолчанию из «Настройки»: строка базы > ATEH > общая; нет строки — пусто');

    // 1790234127 = 2026-09-24 07:15:27 UTC = 10:15 по Москве
    assert(D.fmtRunDate('1790234127') === '24.09.2026 10:15' && D.fmtRunDate('24.09.2026 10:15:27') === '24.09.2026 10:15',
        'дата движения показывается по Москве одинаково из unix и из строки отчёта', D.fmtRunDate('1790234127'));
})();

console.log('\n' + passed + '/' + total + ' проверок пройдено.');
