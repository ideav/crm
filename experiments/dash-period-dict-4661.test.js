// Tests for ideav/crm#4661 — модель дэшборда без единой колонки периода.
//
// Панель рисует колонки из словаря периодов (`object/Квартал` и т.п.). dash.js звал его
// с серверным фильтром `FR_С=>=…&FR_По=<=…`, но `FR_<имя>` в object/ резолвится ТОЛЬКО
// по имени ТИПА реквизита; у этих словарей тип зовётся «С_т»/«По_т», а «С»/«По» — псевдоним.
// Нерезолвленное имя уезжало в SQL идентификатором, сервер отвечал
// `Unknown column 'По' in 'on clause'` — строкой, а не JSON, и словарь молча становился
// пустым: ни одной колонки, ни одного значения в модели.
//
// Здесь проверяются обе половины фикса в js/dash.js (функции берутся из ИСХОДНИКА):
//   1) dashFilterPeriodDict — отбор строк словаря по диапазону делает клиент;
//   2) запрос словаря уходит без FR_/TO_, а ошибка сервера не проглатывается молча.
//
// Run with: node experiments/dash-period-dict-4661.test.js

const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'js', 'dash.js'), 'utf8');

let passed = 0, total = 0;
function assert(c, msg) { total++; if (!c) throw new Error('FAIL: ' + msg); passed++; }

/** Тело функции верхнего уровня из исходника dash.js. */
function fnSource(name) {
    const start = SRC.indexOf('\nfunction ' + name + '(');
    if (start === -1) throw new Error('FAIL: в js/dash.js нет функции ' + name);
    const next = SRC.indexOf('\nfunction ', start + 1);
    return SRC.slice(start, next === -1 ? SRC.length : next);
}

// dashFilterPeriodDict опирается только на dashDateYMD — поднимаем обе как есть.
const sandbox = new Function(
    fnSource('dashDateYMD') + fnSource('dashFilterPeriodDict') +
    '\nreturn { dashDateYMD: dashDateYMD, dashFilterPeriodDict: dashFilterPeriodDict };')();

const quarters = [
    { i: 590, r: ['1 кв. 2024', '01.01.2024', '31.03.2024'] },
    { i: 593, r: ['2 кв. 2024', '01.04.2024', '30.06.2024'] },
    { i: 599, r: ['4 кв. 2024', '01.10.2024', '31.12.2024'] },
    { i: 602, r: ['1 кв. 2025', '01.01.2025', '31.03.2025'] },
    { i: 611, r: ['4 кв. 2025', '01.10.2025', '31.12.2025'] }
];
const names = rows => rows.map(r => r.r[0]);

// ── 1) отбор по диапазону ───────────────────────────────────────────────────
(function () {
    const all = sandbox.dashFilterPeriodDict(quarters, '20240101', '20251231');
    assert(all.length === 5, 'диапазон дэшборда 2024–2025 берёт все восемь кварталов подряд');

    const y2025 = sandbox.dashFilterPeriodDict(quarters, '20250101', '20251231');
    assert(JSON.stringify(names(y2025)) === JSON.stringify(['1 кв. 2025', '4 кв. 2025']),
        'год отбирает только свои кварталы');

    const none = sandbox.dashFilterPeriodDict(quarters, '20260101', '20261231');
    assert(none.length === 0, 'за 2026 кварталов нет — колонок тоже не будет');

    // Граница: период целиком внутри [С; По], как и делал серверный фильтр.
    const half = sandbox.dashFilterPeriodDict(quarters, '20240201', '20241231');
    assert(JSON.stringify(names(half)) === JSON.stringify(['2 кв. 2024', '4 кв. 2024']),
        'квартал, начавшийся ДО начала диапазона, не берётся (как FR_С=>=)');

    assert(sandbox.dashFilterPeriodDict(quarters, '', '').length === 5,
        'без диапазона словарь не режется');
    const broken = 'Couldn\'t execute query Unknown column';
    assert(sandbox.dashFilterPeriodDict(broken, '20240101', '20251231') === broken,
        'ответ-не-массив отдаётся как есть — его разбирает dashGetPeriods');
    assert(sandbox.dashFilterPeriodDict([{ i: 1, r: ['битый', '', ''] }], '20240101', '20251231').length === 0,
        'строка без дат в словарь периодов не годится');
})();

// ── 2) запрос словаря и громкая ошибка ──────────────────────────────────────
(function () {
    assert(!/object\/[^']*\?JSON_DATA[^']*FR_/.test(SRC),
        'словарь периодов запрашивается без FR_ (серверный фильтр по псевдониму не работает)');
    assert(/'object\/' \+ encodeURIComponent\(dict\) \+ '\?JSON_DATA&LIMIT=10000'/.test(SRC),
        'словарь периодов тянется целиком одним запросом на тип периода');
    assert(/dashGetPeriodDict/.test(SRC) && /window\.dashGetPeriodDict = dashGetPeriodDict/.test(SRC),
        'колбэк словаря объявлен и выставлен в window — newApi зовёт его по имени');

    const getPeriods = fnSource('dashGetPeriods');
    assert(/console\.error\(/.test(getPeriods),
        'непришедший словарь периодов не проглатывается молча (ошибка сервера приходит строкой)');
})();

// ── 3) строка фильтра показывает диапазон, по которому считали ──────────────
(function () {
    const model = SRC.slice(SRC.indexOf('\nfunction dashGetModel('), SRC.indexOf('\nfunction dashGetModel(') + 4000);
    assert(/dashDateFr = fr;/.test(model) && /dashDateTo = to;/.test(model),
        'диапазон дэшборда становится активным — поля дат не показывают текущий год вместо него');
    assert(/dashDateFr = null; dashDateTo = null;/.test(fnSource('dashReset')),
        'при переходе на другой дэшборд диапазон сбрасывается — он принадлежит дэшборду');
})();

// ── 4) формулы по имени строки считаются ────────────────────────────────────
// «[Выручка]-[Себестоимость]» — так формулы пишут в модели; dashCalcCells резолвит
// только `[id]`, поэтому вычисляемые строки (валовая прибыль, EBITDA, ROI) были пусты.
(function () {
    const resolve = new Function('document', 'dashItems', 'dashFormulas', 'itemRegex', 'repRegex', 'dashTrace',
        fnSource('dashFormulaNameKey') + fnSource('dashResolveFormulaNames') + '\nreturn dashResolveFormulaNames;');

    function fakeDom(panels) {                       // panels: { panelId: [ [rowId, name], … ] }
        const rows = {};
        Object.keys(panels).forEach(function (pid) {
            panels[pid].forEach(function (r) {
                rows[r[0]] = { id: String(r[0]), panelId: pid, closest: () => panelEl(pid) };
            });
        });
        const panelEl = pid => ({
            id: pid,
            querySelectorAll: () => panels[pid].map(r => rows[r[0]])
        });
        return {
            getElementById: id => rows[id] || null,
            querySelectorAll: () => Object.keys(rows).map(id => rows[id])
        };
    }

    const items = { 648: { name: 'Выручка' }, 652: { name: 'Себестоимость' }, 656: { name: 'Валовая прибыль' },
                    674: { name: 'ROI, %' } };
    const formulas = {
        656: '[Выручка]-[Себестоимость]',
        674: 'Math.round([Валовая прибыль]/[Выручка]*100)',
        652: '[Выручка]',                            // цельная ссылка — источник, не арифметика
        648: '[]'
    };
    const dom = fakeDom({ fp643: [[648, 'Выручка'], [652, 'Себестоимость'], [656, 'Валовая прибыль'], [674, 'ROI, %']] });
    resolve(dom, items, formulas, /^\[([A-Za-яЁё][ A-Za-яЁё0-9\(\)-]*)\]$/,
        /^\[([A-Za-яЁё][A-Za-яЁё0-9 ]*)(\.[A-Za-яЁё][A-Za-яЁё0-9 ]*)(\.[A-Za-яЁё][A-Za-яЁё0-9 ]*)?\]$/, () => {})();

    assert(formulas[656] === '[648]-[652]', 'имена строк в формуле переведены в id');
    assert(formulas[674] === 'Math.round([656]/[648]*100)', 'перевод работает и внутри Math.*');
    assert(formulas[652] === '[Выручка]', 'цельная ссылка «[Имя]» не трогается — это источник значения');
    assert(formulas[648] === '[]', 'пустая ссылка «[]» не трогается');

    // Незнакомое имя оставляем как есть: ячейка покажет ошибку, а не тихий ноль.
    const other = { 700: '[Выручка]-[Неизвестная строка]' };
    resolve(dom, items, other, /^\[([A-Za-яЁё][ A-Za-яЁё0-9\(\)-]*)\]$/, /^$/, () => {})();
    assert(other[700] === '[648]-[Неизвестная строка]', 'имя не из модели остаётся в формуле нетронутым');
})();

// ── 5) «Оптимизация» видит живую модель рабочего места ──────────────────────
// Адаптер читал window.dashItems/dashFormulas/dashMatrixValues, которых нет: dash.js держит
// модель в замыкании. Отчёт всегда упирался в «Модель не загружена…» (issue #4661).
(function () {
    const O = require(path.join(__dirname, '..', 'js', 'dash-optimize.js'));
    const state = {
        items: { 648: { name: 'Выручка', label: 'ТехноСбыт' }, 652: { name: 'Себестоимость', label: 'ТехноСбыт' },
                 656: { name: 'Валовая прибыль', label: 'ТехноСбыт' } },
        formulas: { 656: '[648]-[652]' },            // dash.js хранит формулу уже в id-форме
        values: {
            'выручка:факт': [{ date: '20240101', val: '12000', 'Метка': 'ТехноСбыт' },
                             { date: '20240401', val: '12500', 'Метка': 'ТехноСбыт' }],
            'себестоимость:факт': [{ date: '20240101', val: '6600', 'Метка': 'ТехноСбыт' },
                                   { date: '20240401', val: '6875', 'Метка': 'ТехноСбыт' }],
            'себестоимость:план': [{ date: '20240101', val: '1', 'Метка': 'ТехноСбыт' }]
        },
        periods: { 'Квартал': [
            { i: 590, r: ['1 кв. 2024', '01.01.2024', '31.03.2024'] },
            { i: 593, r: ['2 кв. 2024', '01.04.2024', '30.06.2024'] }
        ] }
    };
    const model = O.modelFromDashState({ dashLiveState: () => state });

    assert(JSON.stringify(model.companies) === JSON.stringify(['ТехноСбыт']), 'компания берётся из «Метки» строк');
    assert(JSON.stringify(model.quarters) === JSON.stringify(['1 кв. 2024', '2 кв. 2024']),
        'колонки — периоды словаря, по возрастанию начала');
    assert(model.series['ТехноСбыт']['Выручка']['1 кв. 2024'] === 12000, 'значение попало в свой квартал');
    assert(model.series['ТехноСбыт']['Себестоимость']['2 кв. 2024'] === 6875, 'ряды разложены по кварталам');
    assert(model.series['ТехноСбыт']['Себестоимость']['1 кв. 2024'] === 6600,
        'колонки группы не смешиваются: «Факт» не сложился с «Планом»');

    const gp = model.rows['ТехноСбыт'].filter(r => r.name === 'Валовая прибыль')[0];
    assert(gp.formula === '[Выручка]-[Себестоимость]', 'формула приведена к именам — по ним считают чистые функции');
    assert(O.periodValues(model, 'ТехноСбыт', '1 кв. 2024', null, true)['Валовая прибыль'] === 5400,
        'модель считается: 12 000 − 6 600 = 5 400');

    assert(JSON.stringify(O.modelFromDashState({}).companies) === '[]',
        'без dashLiveState модель пустая — отчёт честно скажет «не загружена»');
})();

console.log('OK: ' + passed + '/' + total + ' проверок (#4661 модель дэшборда: периоды, формулы, «Оптимизация»)');
