// Repro / regression for #4205 — постпроход склейки дубля сырья в блоке ножей (#4184/PR#4185)
// «не сработал»: на Станке 1 в блоке ножей «110*8» сырьё MWR200|OUT (партия 74922) стоит ОДНИМ
// заданием в начале (541900, срок 01.07 = день 0, приколото сроком) и группой в конце (544019/
// 543584/544415, день 2). Слить их = −15 мин переналадки. Единичное вниз двигать нельзя (свой срок
// день 0); группу вверх — можно (их сроки 03–07.07 ≥ день 0). Но #4184 переставляет ВЕСЬ блок ножей
// целиком и принимает лишь если ВЕСЬ порядок в срок — а глобальная перетасовка блока роняет чужое
// задание со сроком «день 2» за день → кандидат отвергается → выгодная локальная склейка не случается.
// #4205: добавлены ХИРУРГИЧЕСКИЕ кандидаты — склейка островов ОДНОЙ конфигурации, двигающая только её
// резки; чужие сроки не задеты → склейка проходит.
//
// Данные — блок ножей «110*8» Станка 1 (slitter 1277) из output(27).xlsx (лист «Комбинации»).
// Run with: node experiments/atex-production-planning-4205.test.js

var mod = require('../download/atex/js/production-planning.js');
var P = mod.planning;

var passed = 0, total = 0;
function assert(cond, name) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}

var BASE = new Date(2026, 6, 1, 0, 0, 0, 0).getTime();   // ср 01.07.2026 = день 0 (без выходных в 0..4)
function ymdToOffset(ymd){
    var y = Math.floor(ymd/10000), m = Math.floor(ymd/100)%100, d = ymd%100;
    return Math.round((new Date(y, m-1, d).getTime() - BASE) / 86400000);
}

// Блок ножей «110*8» Станка 1 (все резки одной конфигурации ножей → один блок). id, сырьё, намотка,
// «Резка и Лидер» мин, срок YYYYMMDD, партия. Порядок строк = как в выгрузке (не важен — слой
// размещения пересобирает очередь сам).
var ROWS = [
    { id:'542015', mat:'MW411', wind:'IN', cut:14, srok:20260702, batch:'74932' },
    { id:'542191', mat:'MR194', wind:'OUT', cut:7, srok:20260702, batch:'74926' },
    { id:'541900', mat:'MWR200', wind:'OUT', cut:5, srok:20260701, batch:'74922' },   // единичное, срок день 0
    { id:'542026', mat:'MW308', wind:'OUT', cut:23, srok:20260702, batch:'74929' },
    { id:'542492', mat:'MW308', wind:'OUT', cut:16, srok:20260706, batch:'74929' },
    { id:'542588', mat:'MW308', wind:'OUT', cut:100, srok:20260708, batch:'74929' },
    { id:'542644', mat:'MW308', wind:'OUT', cut:221, srok:20260708, batch:'74929' },
    { id:'544472', mat:'MWR113L', wind:'IN', cut:203, srok:20260708, batch:'74925' },
    { id:'542301', mat:'MR194', wind:'OUT', cut:0, srok:20260708, batch:'74926' },
    { id:'545419', mat:'MR194', wind:'OUT', cut:13, srok:20260708, batch:'74926' },
    { id:'543214', mat:'MR194', wind:'OUT', cut:37, srok:20260703, batch:'74926' },   // чужой срок «день 2»
    { id:'542701', mat:'MR194', wind:'OUT', cut:26, srok:20260703, batch:'74926' },   // чужой срок «день 2»
    { id:'542711', mat:'MR194', wind:'OUT', cut:4, srok:20260706, batch:'74926' },
    { id:'542425', mat:'MR194', wind:'OUT', cut:23, srok:20260710, batch:'74926' },
    { id:'542359', mat:'MR194', wind:'OUT', cut:13, srok:20260709, batch:'74926' },
    { id:'543598', mat:'MR194', wind:'IN', cut:16, srok:20260706, batch:'74926' },
    { id:'544729', mat:'MWR233', wind:'OUT', cut:4, srok:20260709, batch:'77345' },
    { id:'543893', mat:'MW411', wind:'OUT', cut:19, srok:20260703, batch:'74932' },   // чужой срок «день 2»
    { id:'544019', mat:'MWR200', wind:'OUT', cut:23, srok:20260706, batch:'74922' },  // группа-дубль
    { id:'543584', mat:'MWR200', wind:'OUT', cut:23, srok:20260703, batch:'74922' },
    { id:'544415', mat:'MWR200', wind:'OUT', cut:17, srok:20260707, batch:'74922' }
];

var perPassByCut = {}, dueDayByCut = {}, dueKeyByCut = {};
var cuts = ROWS.map(function(r){
    perPassByCut[r.id] = Number(r.cut) || 0.1;
    dueDayByCut[r.id] = ymdToOffset(r.srok); dueKeyByCut[r.id] = Number(r.srok);
    return { id: r.id, slitter: { id: '1277' }, materialId: r.mat, winding: r.wind,
             batchId: r.batch, knifeWidths: [110,110,110,110,110,110,110,110], knifeCount: 8, rollerWidth: 0,
             plannedRuns: 1, isFoil: false, planDate: '', status: '', fixed: false };
});

function run(){
    // Ёмкость дня ≈320 мин (окно 480–840 − обед 40): на реальном плане блок «110*8» начинался НЕ с
    // начала смены (перед ним другие блоки станка), день был плотнее полного 450 — при полной ёмкости
    // глобальная перестановка блока в срок укладывается и дубль сливается даже без фикса; при плотном
    // дне она роняет чужой срок и отвергается (baseline: MWR200 разорван, 0 просрочки — воспроизводит #4205).
    return P.planCutOperations(cuts, {
        planBaseMidnightMs: BASE, weights: {}, times: {},
        dayStartMin: 480, dayEndMin: 840, dayEndHourMin: 840,
        maxOverworkCutsMin: 5, maxOverworkTuneMin: 10,
        lunchStartMin: 740, lunchDurationMin: 40, gapFill: true,
        preserveOrder: false, slotPlacement: true, firstCutSetup: false,
        prevSetupBySlitter: {}, intraDayResequence: true,
        perPassByCut: perPassByCut, slitterIds: ['1277'],
        dueDayByCut: dueDayByCut, dueKeyByCut: dueKeyByCut
    });
}

function calendarDay(ts){ return Math.floor((Number(ts) * 1000 - BASE) / 86400000); }   // planStartTs — в секундах

// Порядок и дни заданий Станка 1 по planStart.
function machineOrder(ops){
    return (ops.updates || []).slice().sort(function(a,b){ return Number(a.planStartTs) - Number(b.planStartTs); })
        .map(function(u){ return { id: String(u.cutId), day: calendarDay(u.planStartTs) }; });
}

var MWR200 = ['541900','544019','543584','544415'];
var ops = run();
var order = machineOrder(ops);
var seq = order.map(function(o){ return o.id; });
var idx = MWR200.map(function(id){ return seq.indexOf(id); }).filter(function(i){ return i>=0; });
var daysOf = {}; order.forEach(function(o){ daysOf[o.id] = o.day; });

console.log('\nПорядок Станка 1 (id@день), сырьё MWR200 помечено *:');
console.log(order.map(function(o){ return (MWR200.indexOf(o.id)>=0?'*':'') + o.id + '@' + o.day; }).join('  '));
console.log('MWR200 позиции в очереди:', idx.slice().sort(function(a,b){return a-b;}).join(','),
    '  дни:', MWR200.map(function(id){return id+':'+daysOf[id];}).join(' '));

// contiguous = все 4 MWR200 идут подряд в очереди станка.
idx.sort(function(a,b){return a-b;});
var contiguous = idx.length === 4 && (idx[3] - idx[0] === 3);
assert(contiguous, '#4205: четыре MWR200|OUT слиты в один блок (подряд) после постпрохода');

// Ни одно задание НЕ должно оказаться позже своего срока (склейка не плодит просрочку).
var overdue = order.filter(function(o){ var d = dueDayByCut[o.id]; return d != null && o.day > Number(d); });
console.log('Просрочено:', overdue.length ? overdue.map(function(o){return o.id+'(день'+o.day+'>срок'+dueDayByCut[o.id]+')';}).join(' ') : 'нет');
assert(overdue.length === 0, '#4205: склейка не создаёт просрочки (ни одно задание не позже срока)');

console.log('\n' + passed + '/' + total + ' проверок прошло');
if (passed !== total) process.exitCode = 1;
