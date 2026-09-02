// #4847 — Диаграмма Ганта: заказ клиента в подписи строки + ссылки только при WRITE.
//
// ТЗ (issue #4847):
//   1. первым слотом подписи строки — номер заказа КЛИЕНТА (`client_order_no` из cut_planning),
//      при отсутствии — прочерк: «2550 / 5082 / MR192 · OUT · 300 x 1» / «— / 5082 / …»;
//   2. ссылки на «Планирование производства» не рисуются, если в метаданных роли нет
//      WRITE на таблицу «Задание в производство».
//
// Run with: node experiments/atex-cut-gantt-4847.test.js

process.env.TZ = 'UTC';

var gantt = require('../download/atex/js/cut-gantt.js').gantt;

var passed = 0, total = 0;
function assertEqual(actual, expected, name) {
    total++;
    var a = JSON.stringify(actual), e = JSON.stringify(expected);
    var ok = a === e;
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name + (ok ? '' : ' (ожидалось ' + e + ', получено ' + a + ')'));
    if (ok) passed++; else process.exitCode = 1;
}

// ── 1) подпись строки: заказ клиента первым слотом, прочерк при отсутствии ──
assertEqual(gantt.cutRowLabel({ clientOrderNo: '2550', orderNo: '5082', materialName: 'MR192', winding: 'OUT', length: 300 }),
    '2550 / 5082 / MR192 · OUT · 300', '#4847 заказ клиента — первый слот подписи');
assertEqual(gantt.cutRowLabel({ orderNo: '5082', materialName: 'MR192', winding: 'OUT', length: 300 }),
    '— / 5082 / MR192 · OUT · 300', '#4847 нет заказа клиента — прочерк «—»');
assertEqual(gantt.cutRowLabel({ clientOrderNo: '2550', id: '658857' }), '2550 / #658857', '#4847 есть только заказ клиента — номер резки как «#id»');
assertEqual(gantt.cutRowLabel({ id: '658857' }), '— / #658857', '#4847 нет обоих номеров — прочерк и «#id»');
assertEqual(gantt.cutRowLabel({ clientOrderNo: '2550', number: '06.05.2026 08:00' }),
    '2550 / 06.05.2026 08:00', '#4847 без заказа — номер резки (плановая дата-время)');

// ── 2) rowsToCuts несёт client_order_no из отчёта ──
var cuts = gantt.rowsToCuts([
    { cut_id: '10', cut_plan_date: '06.05.2026', order_no: '5082', client_order_no: '2550' },
    { cut_id: '11', cut_plan_date: '07.05.2026' }
]);
assertEqual([cuts[0].clientOrderNo, cuts[1].clientOrderNo], ['2550', ''],
    '#4847 rowsToCuts читает client_order_no (пусто, если колонки нет)');

// ── 3) WRITE на «Задание в производство» — предикат по метаданным ──
var CUT_TABLE = 'Задание в производство';
var metaWithWrite = [
    { id: '1078', val: CUT_TABLE, granted: 'WRITE' },
    { id: '1070', val: 'Слиттер', granted: 'READ' }
];
var metaNoWrite = [
    { id: '1078', val: CUT_TABLE, granted: 'READ' }
];
assertEqual(gantt.hasTableWrite(metaWithWrite, CUT_TABLE), true, '#4847 granted WRITE → ссылки рисуются');
assertEqual(gantt.hasTableWrite(metaNoWrite, CUT_TABLE), false, '#4847 granted READ → ссылок нет');
assertEqual(gantt.hasTableWrite(metaWithWrite, 'Нет такой таблицы'), true,
    '#4847 таблицы нет в метаданных → ссылки не прячем (меняем поведение только при заведомом запрете)');
assertEqual(gantt.hasTableWrite([], CUT_TABLE), true, '#4847 пустые метаданные → не прячем');
assertEqual(gantt.hasTableWrite([{ id: '1078', val: CUT_TABLE, granted: 'WRITE, DELETE' }], CUT_TABLE), true,
    '#4847 WRITE среди нескольких прав — тоже WRITE');

console.log('\n' + passed + '/' + total + ' passed');
if (process.exitCode) process.exit(process.exitCode);
