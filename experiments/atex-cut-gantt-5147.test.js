// Tests for #5147 — «В рабочем месте cut-gantt выводить детали заказа в title .atex-cg-label».
// title метки строки Ганта = сводка полос задания, по строке на ширину, в формате
// «Планирования» (#3354 п.1): «{сырьё} {номинал} x {длина} {намотка} — {факт}мм х {резок} x {полос} = {мотков} шт. (срок: ДД.ММ.ГГГГ)».
// Номинал — обратный резолв факт.ширины по справочнику «Фактическая ширина резки»
// (как resolveNominalWidth планирования, #3408); срок — due_date отчёта cut_planning (#4051).
//
// Run with: node experiments/atex-cut-gantt-5147.test.js

process.env.TZ = 'UTC';

var api = require('../download/atex/js/cut-gantt.js');
var gantt = api.gantt;

var passed = 0, total = 0;
function assert(cond, name) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}
function assertEqual(actual, expected, name) {
    var ok = actual === expected;
    if (!ok) name += ' [ожидалось: ' + JSON.stringify(expected) + ', получено: ' + JSON.stringify(actual) + ']';
    assert(ok, name);
}

// Пример из постановки #5147: задание режет 5 полос 150 мм и 2 полосы 59 мм (номинал 60),
// 12 проходов, длина 450, намотка IN, срок 12.10.2026.
function issueCut() {
    var rows = [
        { cut_id: '659000', order_no: '5092', cut_material: 'MW308', cut_material_id: '401',
          cut_winding: 'IN', cut_length: 450, cut_planned_runs: 12,
          due_date: '2026-10-12' }
    ];
    var cut = gantt.rowsToCuts(rows)[0];
    gantt.attachDueKeys([cut], rows);
    gantt.attachStrips([cut], [
        { cut_id: '659000', strip_width: 150, strip_qty: 5 },
        { cut_id: '659000', strip_width: 59, strip_qty: 2 }
    ]);
    return cut;
}

// ── 1) Строки полос в формате планирования, срок из due_date ────────────────────────────
(function () {
    var cut = issueCut();
    var title = gantt.cutStripsTitle(cut, {
        nominalWidthByMaterial: { '401': 910 },
        actualWidthIndex: gantt.buildActualWidthIndex([{ actual: 59, order: 60, code: '' }])
    });
    var lines = title.split('\n');
    assertEqual(lines.length, 2, '#5147 по строке на каждую ширину полос');
    assertEqual(lines[0], 'MW308 150 x 450 IN — 150мм х 12 x 5 = 60 шт. (срок: 12.10.2026)',
        '#5147 первая строка — пример из постановки (широкая полоса)');
    assertEqual(lines[1], 'MW308 60 x 450 IN — 59мм х 12 x 2 = 24 шт. (срок: 12.10.2026)',
        '#5147 вторая строка — номинал 60 по справочнику, факт 59мм после тире');
})();

// ── 2) Условное правило (j=) применяется, как у планирования (#3408) ───────────────────
(function () {
    var cut = issueCut();
    var matching = gantt.cutStripsTitle(cut, {
        nominalWidthByMaterial: { '401': 910 },
        actualWidthIndex: gantt.buildActualWidthIndex([{ actual: 59, order: 60, code: 'j=910' }])
    }).split('\n')[1];
    assertEqual(matching, 'MW308 60 x 450 IN — 59мм х 12 x 2 = 24 шт. (срок: 12.10.2026)',
        '#5147 условное правило j=910 при джамбо 910 → номинал 60');
    var notMatching = gantt.cutStripsTitle(cut, {
        nominalWidthByMaterial: { '401': 1000 },
        actualWidthIndex: gantt.buildActualWidthIndex([{ actual: 59, order: 60, code: 'j=910' }])
    }).split('\n')[1];
    assertEqual(notMatching, 'MW308 59 x 450 IN — 59мм х 12 x 2 = 24 шт. (срок: 12.10.2026)',
        '#5147 джамбо 1000 не удовлетворяет j=910 → номинал = факт 59');
})();

// ── 3) Без справочника/полос — деградация ───────────────────────────────────────────────
(function () {
    var cut = issueCut();
    var noRefs = gantt.cutStripsTitle(cut, {}).split('\n')[1];
    assertEqual(noRefs, 'MW308 59 x 450 IN — 59мм х 12 x 2 = 24 шт. (срок: 12.10.2026)',
        '#5147 пустой индекс правил → номинал = факт (деградация без поломки)');
    var bare = gantt.rowsToCuts([{ cut_id: '1', order_no: 'X' }])[0];
    assertEqual(gantt.cutStripsTitle(bare, {}), '', '#5147 нет полос → пустой title (метка показывает свой label)');
})();

// ── 4) Срок: несколько дат, дубли строк отчёта, разные форматы даты ─────────────────────
(function () {
    // Несколько строк отчёта на задание (join с обеспечением) — сроки собираются все, без дублей.
    var rows = [
        { cut_id: '1', due_date: '2026-10-12' },
        { cut_id: '1', due_date: '12.10.2026' },   // дубль в другом формате
        { cut_id: '1', due_date: '2026-11-01' },
        { cut_id: '1' }                             // строка без срока
    ];
    var cuts = gantt.rowsToCuts(rows);
    assertEqual(cuts.length, 1, '#5147 дедуп строк отчёта не сломан');
    assertEqual(gantt.attachDueKeys(cuts, rows)[0].dueKeys.length, 2,
        '#5147 дубли/пустые сроки схлопываются (attachDueKeys по всем строкам)');
    gantt.attachStrips(cuts, [{ cut_id: '1', strip_width: 100, strip_qty: 3 }]);
    var line = gantt.cutStripsTitle(cuts[0], {}).split('\n')[0];
    assertEqual(line, '— 100 x — — 100мм х — x 3 = 0 шт. (сроки: 12.10.2026, 01.11.2026)',
        '#5147 два срока → «сроки: …» по возрастанию, пропуски полей — прочерки');
})();

// ── 5) Группировка по убыванию ширины, как в планировании (#3354 п.1) ───────────────────
(function () {
    var cut = gantt.rowsToCuts([{ cut_id: '1', cut_material: 'MWR116L', cut_winding: 'OUT',
                                  cut_length: 300, cut_planned_runs: 4 }])[0];
    gantt.attachStrips([cut], [
        { cut_id: '1', strip_width: 60, strip_qty: 2 },
        { cut_id: '1', strip_width: 200, strip_qty: 1 },
        { cut_id: '1', strip_width: 60, strip_qty: 1 }
    ]);
    var lines = gantt.cutStripsTitle(cut, {}).split('\n');
    assertEqual(lines.length, 2, '#5147 одинаковые ширины схлопываются в одну строку');
    assertEqual(lines[0], 'MWR116L 200 x 300 OUT — 200мм х 4 x 1 = 4 шт.', '#5147 широкая полоса первой');
    assertEqual(lines[1], 'MWR116L 60 x 300 OUT — 60мм х 4 x 3 = 12 шт.', '#5147 узкая полоса второй, полосы суммированы');
})();

console.log('\n' + passed + '/' + total + ' проверок прошли');
if (passed !== total) process.exitCode = 1;
