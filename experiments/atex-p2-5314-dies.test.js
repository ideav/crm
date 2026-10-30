// ideav/crm#5314 — рабочее место «Ножи и валы» (ИТС): статусы ножа и учёт пробега.
//
//   1. состояние ножа — запись справочника «Состояние ножа» (Рабочий, Резерв, На экспертизе,
//      Заточка, Списан); переходы кнопок карточки ножа проверяются ДО записи: из «Списан»
//      нож не выходит, «уже в этом состоянии» — ошибка, а не пустая запись;
//   2. выход из «Заточки» в работу или резерв = заточка выполнена → движение пробега
//      «заточка», счёт пробега начинается заново, история остаётся (§1.1 состава решения);
//   3. пробег всех ножей считается одним отчётом движений: индекс «нож → пробег, заточек,
//      движений»; дата движения приходит unix-секундами (object/) или строкой (report/);
//   4. история пробега ножа — с колонкой «Накоплено», которая обнуляется на заточке;
//   5. порог заточки — настройка; без порога «у порога» не считается, а не «у всех 0 %».
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

    // [из, действие, ожидаемое состояние | null = ошибка, ожидаемое движение]
    var CASES = [
        [S.WORKING, A.SHARPEN, S.SHARPENING, ''],
        [S.RESERVE, A.SHARPEN, S.SHARPENING, ''],
        [S.EXPERTISE, A.SHARPEN, S.SHARPENING, ''],
        [S.SHARPENING, A.RETURN, S.WORKING, LP.RUN_KIND.SHARPEN],
        [S.SHARPENING, A.RESERVE, S.RESERVE, LP.RUN_KIND.SHARPEN],
        [S.SHARPENING, A.EXPERTISE, S.EXPERTISE, ''],
        [S.SHARPENING, A.WRITE_OFF, S.WRITTEN_OFF, ''],
        [S.RESERVE, A.RETURN, S.WORKING, ''],
        [S.EXPERTISE, A.RETURN, S.WORKING, ''],
        [S.WORKING, A.RESERVE, S.RESERVE, ''],
        [S.WORKING, A.EXPERTISE, S.EXPERTISE, ''],
        [S.WORKING, A.WRITE_OFF, S.WRITTEN_OFF, ''],
        ['', A.RETURN, S.WORKING, ''],
        ['', A.SHARPEN, S.SHARPENING, ''],
        [S.WORKING, A.RETURN, null],
        [S.SHARPENING, A.SHARPEN, null],
        [S.RESERVE, A.RESERVE, null],
        [S.WRITTEN_OFF, A.RETURN, null],
        [S.WRITTEN_OFF, A.SHARPEN, null],
        [S.WRITTEN_OFF, A.WRITE_OFF, null],
        [S.WORKING, 'нечто', null]
    ];
    var bad = [];
    CASES.forEach(function(c) {
        var r = LP.dieStateAction(c[0], c[1]);
        if (c[2] === null) {
            if (r.ok !== false || !r.error) bad.push((c[0] || '∅') + ' + ' + c[1] + ' → ' + JSON.stringify(r) + ', ждали ошибку');
        } else if (!r.ok || r.state !== c[2] || (r.run || '') !== c[3]) {
            bad.push((c[0] || '∅') + ' + ' + c[1] + ' → ' + JSON.stringify(r) + ', ждали ' + c[2] + (c[3] ? ' + «' + c[3] + '»' : ''));
        }
    });
    assert(bad.length === 0, 'таблица переходов: ' + CASES.length + ' случаев', bad.join('; '));

    var listed = LP.dieStateActions(S.SHARPENING).map(function(x) { return x.action; }).sort();
    assert(JSON.stringify(listed) === JSON.stringify([A.EXPERTISE, A.RESERVE, A.RETURN, A.WRITE_OFF].sort()),
        'кнопки карточки ножа на заточке — ровно допустимые переходы', '(получено ' + JSON.stringify(listed) + ')');
    assert(LP.dieStateActions(S.WRITTEN_OFF).length === 0, 'у списанного ножа кнопок перехода нет');
})();

// ── 3. Индекс пробега по ножам ───────────────────────────────────────────────
(function() {
    assert(typeof LP.dieMileageIndex === 'function', 'dieMileageIndex экспортирована');
    if (typeof LP.dieMileageIndex !== 'function') return;
    var rows = [
        // нож 10: начальный остаток 5000, вырубка 2000, заточка, вырубка 700 (дата строкой)
        { die_id: '10', run_id: '1', run_date: '1790000000', run_kind: '1000304:начальный остаток', meters: '5000' },
        { die_id: '10', run_id: '2', run_date: '1790003600', run_kind: 'вырубка', meters: '2000.00' },
        { die_id: '10', run_id: '4', run_date: '25.09.2026 10:00:00', run_kind: 'вырубка', meters: '700' },
        { die_id: '10', run_id: '3', run_date: '1790007200', run_kind: 'заточка', meters: '0' },
        // нож 20: две вырубки
        { die_id: '20', run_id: '5', run_date: '1790000000', run_kind: 'вырубка', meters: '100' },
        { die_id: '20', run_id: '6', run_date: '1790000001', run_kind: 'вырубка', meters: '250,5' },
        // нож 30: неизвестный вид
        { die_id: '30', run_id: '7', run_date: '1790000000', run_kind: 'перемотка', meters: '9' }
    ];
    var idx = LP.dieMileageIndex(rows);
    assert(idx['10'] && idx['10'].meters === 700 && idx['10'].sharpenings === 1 && idx['10'].runs === 4,
        'нож 10: пробег после заточки 700 м, 1 заточка, 4 движения (строковая дата позже unix)', JSON.stringify(idx['10']));
    assert(idx['20'] && Math.abs(idx['20'].meters - 350.5) < 1e-9 && idx['20'].sharpenings === 0,
        'нож 20: 350.5 м (десятичная запятая)', JSON.stringify(idx['20']));
    assert(idx['30'] && idx['30'].meters === 0 && idx['30'].errors.length === 1,
        'нож 30: неизвестный вид — в сумму не идёт и назван ошибкой', JSON.stringify(idx['30']));
    assert(!idx['40'], 'нож без движений в индекс не попадает (пробег 0 считает вызывающий)');
})();

// ── 4. История пробега ножа ──────────────────────────────────────────────────
(function() {
    assert(typeof LP.dieRunHistory === 'function', 'dieRunHistory экспортирована');
    if (typeof LP.dieRunHistory !== 'function') return;
    var h = LP.dieRunHistory([
        { id: 'c', date: 30, kind: 'вырубка', meters: 300 },
        { id: 'a', date: 10, kind: 'начальный остаток', meters: 1000 },
        { id: 'b', date: 20, kind: 'заточка', meters: 0 },
        { id: 'd', date: 40, kind: 'вырубка', meters: 50 }
    ]);
    var acc = h.map(function(r) { return r.id + ':' + r.accumulated; }).join(',');
    assert(acc === 'a:1000,b:0,c:300,d:350', 'история по дате, «Накоплено» обнуляется на заточке', '(получено ' + acc + ')');
})();

// ── 5. Порог заточки ─────────────────────────────────────────────────────────
(function() {
    assert(typeof LP.dieWearLevel === 'function', 'dieWearLevel экспортирована');
    if (typeof LP.dieWearLevel !== 'function') return;
    assert(LP.dieWearLevel(1000, '') === '' && LP.dieWearLevel(1000, '0') === '',
        'без порога уровень износа не определяется');
    assert(LP.dieWearLevel(100, 1000) === 'ok' && LP.dieWearLevel(900, 1000) === 'near' &&
        LP.dieWearLevel(1000, 1000) === 'over' && LP.dieWearLevel(1500, '1 000') === 'over',
        'ok < 90 % ≤ near < 100 % ≤ over; порог с пробелами разбирается');
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
        die: { id: '14', reqs: { labelWidth: '74', labelLength: '75', streams: '77', cylinder: '86', base: '99', state: '101' } },
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
            '1': { '74': '148.00', '75': '210.00', 'ref_86': '12:96', '86': '96', 'ref_101': '7:162', '101': 'Рабочий' },
            '2': { 'ref_86': '12:96', '86': '96', 'ref_101': '7:162', '101': 'Рабочий' },
            '3': { 'ref_86': '12:98', '86': '98', 'ref_101': '7:165', '101': 'Заточка' },
            '4': { 'ref_101': '7:166', '101': 'Списан' },
            '5': { 'ref_101': '7:164', '101': 'Резерв' },
            '6': {}
        }
    };
    var dies = D.kvRecords(dieJson);
    assert(dies.length === 6 && dies[0].val === '736116' && dies[0].reqs['86'] === '96', 'kvRecords: главное значение + реквизиты записи');
    assert(JSON.stringify(D.refIds({ reqs: { 'ref_69': '12:96,104,116' } }, '69')) === '["96","104","116"]',
        'refIds: «таблица:id,id» → список id');

    var mileage = LP.dieMileageIndex([
        { die_id: '1', run_id: '1', run_date: '1', run_kind: 'вырубка', meters: '950' },     // near
        { die_id: '2', run_id: '2', run_date: '1', run_kind: 'вырубка', meters: '1200' },    // over
        { die_id: '3', run_id: '3', run_date: '1', run_kind: 'вырубка', meters: '5000' },    // over, но на заточке
        { die_id: '4', run_id: '4', run_date: '1', run_kind: 'вырубка', meters: '7000' },    // over, но списан
        { die_id: '5', run_id: '5', run_date: '1', run_kind: 'вырубка', meters: '10' }
    ]);
    var rows = D.buildDieRows(dies, t, mileage, '1000');
    var r1 = rows[0];
    assert(r1.no === '736116' && r1.cylinderId === '96' && r1.state === LP.DIE_STATE.WORKING && r1.meters === 950 && r1.wear === 'near' && r1.width === '148.00',
        'строка ножа: номер, вал, состояние, пробег, износ', JSON.stringify(r1));
    assert(rows[5].meters === 0 && rows[5].state === '' && rows[5].wear === 'ok', 'нож без движений: пробег 0, без состояния');

    var k = D.dieKpi(rows);
    assert(k.total === 6 && k.working === 2 && k.sharpening === 1 && k.writtenOff === 1 && k.reserve === 1 && k.noState === 1,
        'показатели по состояниям', JSON.stringify(k));
    assert(k.near === 1 && k.over === 1, 'у порога / за порогом — только ножи, которые режут (заточка и списанные не в счёт)', JSON.stringify(k));
    var wl = D.wearList(rows).map(function(d) { return d.no; }).join(',');
    assert(wl === '728065,736116', 'список «у порога»: больший пробег выше, заточка и списанные исключены', '(получено ' + wl + ')');
    var noThr = D.dieKpi(D.buildDieRows(dies, t, mileage, ''));
    assert(noThr.near === 0 && noThr.over === 0, 'без порога «у порога» не считается');

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

    var settings = [
        { key: 'DIE_SHARPEN_THRESHOLD_M', type: '', value: '900000' },
        { key: 'DIE_SHARPEN_THRESHOLD_M', type: 'ATEH1', value: '1 200 000' },
        { key: 'DIE_SHARPEN_THRESHOLD_M', type: 'ATEH', value: '1000000' }
    ];
    assert(D.settingValue(settings, D.THRESHOLD_KEY, 'ateh1') === '1 200 000' && D.settingValue(settings, D.THRESHOLD_KEY, 'ateh') === '1000000' &&
        D.settingValue(settings.slice(0, 1), D.THRESHOLD_KEY, 'ateh') === '900000' && D.settingValue([], D.THRESHOLD_KEY, 'ateh') === '',
        'порог из «Настройки»: строка базы > ATEH > общая; нет строки — пусто');

    assert(D.serverUnix('Fri, 30 Oct 2026 12:00:00 GMT') === Date.UTC(2026, 9, 30, 12) / 1000 && isNaN(D.serverUnix(null)),
        'время движения — из заголовка Date сервера; нет заголовка — NaN, а не часы устройства');
    // 1790234127 = 2026-09-24 07:15:27 UTC = 10:15 по Москве
    assert(D.fmtRunDate('1790234127') === '24.09.2026 10:15' && D.fmtRunDate('24.09.2026 10:15:27') === '24.09.2026 10:15',
        'дата движения показывается по Москве одинаково из unix и из строки отчёта', D.fmtRunDate('1790234127'));
})();

console.log('\n' + passed + '/' + total + ' проверок пройдено.');
