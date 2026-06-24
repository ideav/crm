// Unit-тесты ideav/crm#3688:
//  • первая резка очереди станка бронирует переналадку от ТЕКУЩЕЙ ЗАПРАВКИ станка
//    (отчёт prev_cut_setup): смена сырья + ножи, если осталось другое; та же конфигурация → 0;
//  • лидер «между резками» вынесен в КОНЕЦ каждой резки (sc.leaderMin), не в стартовый сетап;
//  • порядок переналадки: СНАЧАЛА ножи, ПОТОМ смена сырья.
//
// Run with: node experiments/test-issue-3688-first-cut-setup.js

process.env.TZ = 'UTC';
var api = require('../download/atex/js/production-planning.js');
var planning = api.planning;

var passed = 0;
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; }
    else { console.log('  expected:', JSON.stringify(expected)); console.log('  actual:  ', JSON.stringify(actual)); process.exitCode = 1; }
}

// ── prevSetupFromRows: верхняя (последняя по task_start) задача станка ──
var ROWS = [
    { task_start:'2000', slitter_id:'1', task_id:'T2', wind_dir:'IN',  batch_ord:'1', width:'55.00', material_id:'39014' },
    { task_start:'2000', slitter_id:'1', task_id:'T2', wind_dir:'IN',  batch_ord:'2', width:'33.00', material_id:'39014' },
    { task_start:'1000', slitter_id:'1', task_id:'T1', wind_dir:'OUT', batch_ord:'1', width:'110.00', material_id:'2158' },
    { task_start:'3000', slitter_id:'2', task_id:'T3', wind_dir:'IN',  batch_ord:'1', width:'90.00', material_id:'500' }
];
assertEqual(planning.prevSetupFromRows(ROWS, '1'),
    { materialId:'39014', winding:'IN', knifeWidths:[55,33], knifeCount:2 },
    'prevSetupFromRows: станок 1 → верхняя задача T2 (полосы 55,33, IN, 39014)');
assertEqual(planning.prevSetupFromRows(ROWS, '2'),
    { materialId:'500', winding:'IN', knifeWidths:[90], knifeCount:1 },
    'prevSetupFromRows: станок 2 → T3');
assertEqual(planning.prevSetupFromRows(ROWS, '999'), null, 'prevSetupFromRows: нет задач станка → null');

// ── carryOverPrevCut: синтетическая «предыдущая резка» (партия нейтрализована) ──
var setup1 = planning.prevSetupFromRows(ROWS, '1');
assertEqual(planning.carryOverPrevCut(setup1, { batchId:'b9' }),
    { materialId:'39014', winding:'IN', batchId:'b9', knifeWidths:[55,33], knifeCount:2, rollerWidth:0 },
    'carryOverPrevCut: из заправки (партия = как у next)');
assertEqual(planning.carryOverPrevCut(null, { batchId:'b9' }).knifeCount, 0,
    'carryOverPrevCut: нет заправки → пустой станок (ножей 0)');

// ── эффект переналадки первой резки (changeoverCost от заправки) ──
function cut(extra){ var o = { materialId:'39014', winding:'IN', batchId:'b9', knifeWidths:[55,33], knifeCount:2, rollerWidth:0 }; if (extra) Object.keys(extra).forEach(function(k){ o[k]=extra[k]; }); return o; }
assertEqual(planning.changeoverCost(planning.carryOverPrevCut(setup1, cut()), cut(), null), 0,
    'первая резка: та же заправка (сырьё/намотка/ножи) → 0 (ничего не бронируем)');
assertEqual(planning.changeoverCost(planning.carryOverPrevCut(setup1, cut({materialId:'999'})), cut({materialId:'999'}), null), 15,
    'первая резка: другое сырьё → смена сырья 15 (ножи те же)');
assertEqual(planning.changeoverParts(planning.carryOverPrevCut(setup1, cut({knifeWidths:[40,40,40], knifeCount:3})), cut({knifeWidths:[40,40,40], knifeCount:3}), null),
    [{code:'KNIFE', label:'смена ножей / сужение ролика', minutes:30}],
    'первая резка: другие ножи → СНАЧАЛА ножи 30 (сырьё то же)');
assertEqual(planning.changeoverCost(planning.carryOverPrevCut(null, cut({materialId:'X'})), cut({materialId:'X'}), null), 45,
    'первая резка: пустой станок → ножи 30 + смена сырья 15 = 45');

// ── buildSchedule: carryPrevCut для первой резки + лидер в конце ──
var pts = [{ m:600, min:4 }];
var c0 = { id:'A', materialId:'39014', winding:'IN', batchId:'b9', knifeWidths:[55,33], knifeCount:2, rollerWidth:0, plannedRuns:1 };
// та же заправка → setupMin 0; лидер 2 в конце
var schedSame = planning.buildSchedule([c0], { windPoints: pts, runLengthByCut: { A:600 }, shiftStartMin:480,
    carryPrevCut: planning.carryOverPrevCut(setup1, c0), firstCutSetup:true });
assertEqual([schedSame[0].setupMin, schedSame[0].leaderMin, schedSame[0].startMin], [0, 2, 480],
    'buildSchedule #3688: первая резка, та же заправка → setupMin 0, лидер 2 в конце, старт 08:00');
// заправка станка: ДРУГОЕ сырьё, но ТЕ ЖЕ ножи [55,33] → только смена сырья 15; старт 08:15
var carryDiffMat = planning.carryOverPrevCut({ materialId:'500', winding:'IN', knifeWidths:[55,33] }, c0);
var schedDiff = planning.buildSchedule([c0], { windPoints: pts, runLengthByCut: { A:600 }, shiftStartMin:480,
    carryPrevCut: carryDiffMat, firstCutSetup:true });
assertEqual([schedDiff[0].setupMin, schedDiff[0].startMin], [15, 495],
    'buildSchedule #3688: первая резка, другое сырьё (ножи те же) → setupMin 15, старт 08:15');

console.log('\n' + passed + ' проверок прошло.');
if (process.exitCode === 1) console.log('ЕСТЬ ПАДЕНИЯ — см. выше.');
else console.log('Все проверки #3688 зелёные.');
