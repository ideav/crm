// #4317 — «Почему теряется партия?»: после «Готово»/«Готовы все» панель «Партии сырья» пишет
// «Нет партий в работе с остатком минимум на один проход», хотя партии есть; после перезагрузки
// страницы они появляются.
//
// Корень: «Остаток, м» у партии в базе обычно ПУСТ — приход заводят в м², а метры появляются лишь
// после первого списания расходом. Метры досчитывались из м² и ширины (fillBatchRemainderM), но
// звались они ТОЛЬКО в start(). Перечитывание партий после завершения резки (finishCut → loadBatches)
// шло без досчёта: remainderM = 0 → batchPasses = 0 → availableBatchesForCut отбрасывает партию →
// «Нет партий». F5 запускал start() и всё чинил. На боевой ateh без метров 56 партий из 62 —
// поэтому «терялись» практически все.
//
// Фикс: досчёт — часть loadBatches (обе ветки: отчёт и фолбэк на таблицу).
//
// Run with: node experiments/atex-slitter-4317.test.js

var api = require('../download/atex/js/slitter.js');
var core = api.core, Controller = api.Controller;

var passed = 0, total = 0;
function assert(cond, name) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}
function eqo(a, e, name) {
    var ok = JSON.stringify(a) === JSON.stringify(e);
    assert(ok, name + (ok ? '' : '\n  ожидалось ' + JSON.stringify(e) + '\n  получено  ' + JSON.stringify(a)));
}

// Строки отчёта material_batches — форма боевого ответа ateh. У обеих партий «Остаток, м» ПУСТ.
var REPORT_ROWS = [
    { batch_id: '74926', batch_no: '1781038800', batch_material: 'MR194', batch_material_id: '2086',
      batch_remainder_m2: '10468.241', batch_remainder_m: '', is_active: 'X', 'Склад': 'Производство', width_mm: '910.00' },
    // Ширины в отчёте нет — метры досчитываются по справочнику «Вид сырья» (materialWidths).
    { batch_id: '77334', batch_no: '1781384400', batch_material: 'MB', batch_material_id: '2090',
      batch_remainder_m2: '1805.947', batch_remainder_m: '', is_active: 'X', 'Склад': 'Производство', width_mm: '' }
];
// Резка, для которой оператор ищет партию: MR194, проход 700 м.
var CUT = { materialId: '2086', materialLabel: 'MR194', runLength: '700', plannedRuns: '20' };

function controller(rows) {
    var c = Object.create(Controller.prototype);
    c.batches = [];
    c.materialWidths = { '2090': 1000 };   // справочник ширин (для партии без width_mm в отчёте)
    c.meta = {};
    c.getJson = function () { return Promise.resolve(rows); };
    return c;
}

// ── 1) Загрузка партий сама досчитывает «Остаток, м» ────────────────────────────────────────────
var c1 = controller(REPORT_ROWS);
c1.loadBatches().then(function () {
    eqo(c1.batches.map(function (b) { return b.remainderM; }), [11503.562, 1805.947],
        '#4317: после loadBatches остаток в метрах досчитан (10468.241 м² × 1000 / 910 мм; 1805.947 м² при ширине 1000 мм)');
    assert(core.availableBatchesForCut(c1.batches, CUT).length === 1,
        '#4317: партия MR194 видна в панели (проходов ' + core.batchPasses(c1.batches[0], CUT) + ' ≥ 1)');

    // ── 2) Демонстрация бага: без досчёта партия отбрасывается ──────────────────────────────────
    var raw = core.rowsToActiveBatches(REPORT_ROWS);   // ровно то, что клал прежний loadBatches
    eqo(raw.map(function (b) { return b.remainderM; }), [0, 0],
        '#4317 (демонстрация): без досчёта остаток в метрах = 0 — «Остаток, м» в базе пуст');
    assert(core.availableBatchesForCut(raw, CUT).length === 0,
        '#4317 (демонстрация): с нулевым остатком панель показывает «Нет партий в работе…» — это и есть дефект');

    // ── 3) Идемпотентность: повторный досчёт (start() зовёт его ещё раз) ничего не портит ───────
    var before = JSON.stringify(c1.batches);
    c1.fillBatchRemainderM();
    eqo(JSON.stringify(c1.batches), before, '#4317: повторный fillBatchRemainderM не меняет уже досчитанные партии');

    // ── 4) Партия с ЗАПОЛНЕННЫМИ метрами не пересчитывается (метры — основная мера) ─────────────
    var c2 = controller([{ batch_id: '1', batch_no: 'A', batch_material: 'MR194', batch_material_id: '2086',
        batch_remainder_m2: '999', batch_remainder_m: '700.5', is_active: 'X', 'Склад': 'Производство', width_mm: '910.00' }]);
    return c2.loadBatches().then(function () {
        eqo(c2.batches[0].remainderM, 700.5, '#4317: заполненный «Остаток, м» остаётся как есть');
    });
}).then(function () {
    // ── 5) Фолбэк на прямое чтение таблицы тоже досчитывает ────────────────────────────────────
    // Колонки таблицы «Партия сырья»: r[0] — главное значение, дальше по порядку reqs.
    var c3 = Object.create(Controller.prototype);
    c3.batches = [];
    c3.materialWidths = { '2086': 910 };
    c3.meta = { batch: { id: '1080', reqs: [
        { id: '11', val: 'Вид сырья' }, { id: '12', val: 'Дата прихода' },
        { id: '13', val: 'Остаток, м²' }, { id: '14', val: 'Остаток, м' }, { id: '15', val: 'В работе' }] } };
    c3.getJson = function (url) {
        if (url.indexOf('report/') === 0) return Promise.reject(new Error('отчёта нет в сборке'));
        //            r[0]     Вид сырья      Дата     Остаток,м²    Остаток,м  В работе
        return Promise.resolve([{ i: '5', r: ['A-5', '2086:MR194', '', '10468.241', '', 'X'] }]);
    };
    return c3.loadBatches().then(function () {
        eqo(c3.batches.map(function (b) { return b.remainderM; }), [11503.562],
            '#4317: фолбэк на прямое чтение таблицы проходит через тот же досчёт');
        assert(core.availableBatchesForCut(c3.batches, CUT).length === 1,
            '#4317: и партия из фолбэка тоже видна в панели');
    });
}).then(function () {
    console.log('\n' + passed + '/' + total + ' passed');
}).catch(function (e) {
    console.log('FAIL — исключение: ' + (e && e.stack || e));
    process.exitCode = 1;
});
