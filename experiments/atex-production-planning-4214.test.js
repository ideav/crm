// Repro / regression for #4214 — «разрыв по сырью: ножи и сырьё идентичны, и даже лидер такой же».
// Тот же блок ножей «110*8» Станка 1, что и в #4205: сырьё MWR200|OUT (партия 74922) — единичным
// заданием в начале (срок 01.07 = день 0, приколото сроком) и тройкой в конце. Их надо слить (−15 мин
// переналадки), и хирургический постпроход #4205 (materialIslandMergeCandidates) это умеет — НО ТОЛЬКО
// когда все резки «110*8» лежат в ОДНОМ блоке. Здесь MWR200 идёт с ДРУГОЙ шириной джамбо (rollerWidth),
// чем окружающие MW308/MR194. knifeBlockSig = knifeWidthSig + rollerWidth, поэтому визуально единый блок
// «110*8» ДРОБИТСЯ по границе джамбо на куски: единичное MWR200 — свой прогон длиной 1 (склеивать не с
// чем), тройка MWR200 — свой прогон (уже подряд). Постпроход #4205, шагающий ПО knifeBlockSig, острова
// одного сырья через границу джамбо не видит → дубль остаётся разорван (воспроизводит производство:
// MWR200 на днях 0 и 2, «разрыв по сырью»).
//
// #4214: границу блока в materialIslandMergeCandidates берём по knifeWidthSig (только ножи), а не по
// knifeBlockSig. Джамбо-ширина — измерение сырья, а её сужение — смена ножей (KNIFE в changeoverCost),
// которую приёмка (переналадка СТРОГО вниз + без новой просрочки + фольга не хуже) сама и взвесит.
// Тогда острова MWR200 через задания с другим джамбо оказываются в одном блоке и сливаются.
//
// Run with: node experiments/atex-production-planning-4214.test.js

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

// Блок ножей «110*8» Станка 1. id, сырьё, намотка, «Резка и Лидер» мин, срок YYYYMMDD, партия, джамбо.
// Ключевое отличие от #4205: MWR200 идёт на ДРУГОЙ ширине джамбо (roller 500), чем остальные (roller 0),
// — это дробит knifeBlockSig и прячет острова MWR200 друг от друга у постпрохода #4205.
var ROWS = [
    { id:'542015', mat:'MW411',   wind:'IN',  cut:14,  srok:20260702, batch:'74932', roller:0 },
    { id:'542191', mat:'MR194',   wind:'OUT', cut:7,   srok:20260702, batch:'74926', roller:0 },
    { id:'553104', mat:'MWR200',  wind:'OUT', cut:5,   srok:20260701, batch:'74922', roller:500 }, // единичное, срок день 0
    { id:'542026', mat:'MW308',   wind:'OUT', cut:23,  srok:20260702, batch:'74929', roller:0 },
    { id:'542492', mat:'MW308',   wind:'OUT', cut:16,  srok:20260706, batch:'74929', roller:0 },
    { id:'542588', mat:'MW308',   wind:'OUT', cut:100, srok:20260708, batch:'74929', roller:0 },
    { id:'542644', mat:'MW308',   wind:'OUT', cut:60,  srok:20260708, batch:'74929', roller:0 },
    { id:'542301', mat:'MR194',   wind:'OUT', cut:37,  srok:20260708, batch:'74926', roller:0 },
    { id:'545419', mat:'MR194',   wind:'OUT', cut:13,  srok:20260708, batch:'74926', roller:0 },
    { id:'542711', mat:'MR194',   wind:'OUT', cut:4,   srok:20260706, batch:'74926', roller:0 },
    { id:'543893', mat:'MW411',   wind:'OUT', cut:19,  srok:20260703, batch:'74932', roller:0 },   // чужой срок «день 2»
    { id:'555253', mat:'MWR200',  wind:'OUT', cut:23,  srok:20260706, batch:'74922', roller:500 }, // тройка-дубль
    { id:'554807', mat:'MWR200',  wind:'OUT', cut:23,  srok:20260703, batch:'74922', roller:500 },
    { id:'555628', mat:'MWR200',  wind:'OUT', cut:17,  srok:20260707, batch:'74922', roller:500 }
];

var perPassByCut = {}, dueDayByCut = {}, dueKeyByCut = {};
var cuts = ROWS.map(function(r){
    perPassByCut[r.id] = Number(r.cut) || 0.1;
    dueDayByCut[r.id] = ymdToOffset(r.srok); dueKeyByCut[r.id] = Number(r.srok);
    return { id: r.id, slitter: { id: '1277' }, materialId: r.mat, winding: r.wind,
             batchId: r.batch, knifeWidths: [110,110,110,110,110,110,110,110], knifeCount: 8,
             rollerWidth: r.roller, plannedRuns: 1, isFoil: false, planDate: '', status: '', fixed: false };
});

function run(){
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

function machineOrder(ops){
    return (ops.updates || []).slice().sort(function(a,b){ return Number(a.planStartTs) - Number(b.planStartTs); })
        .map(function(u){ return { id: String(u.cutId), day: calendarDay(u.planStartTs) }; });
}

var MWR200 = ['553104','555253','554807','555628'];
var ops = run();
var order = machineOrder(ops);
var seq = order.map(function(o){ return o.id; });
var idx = MWR200.map(function(id){ return seq.indexOf(id); }).filter(function(i){ return i>=0; });
var daysOf = {}; order.forEach(function(o){ daysOf[o.id] = o.day; });

console.log('\nПорядок Станка 1 (id@день), сырьё MWR200 (джамбо 500) помечено *:');
console.log(order.map(function(o){ return (MWR200.indexOf(o.id)>=0?'*':'') + o.id + '@' + o.day; }).join('  '));
idx.sort(function(a,b){return a-b;});
console.log('MWR200 позиции в очереди:', idx.join(','),
    '  дни:', MWR200.map(function(id){return id+':'+daysOf[id];}).join(' '));

// contiguous = все 4 MWR200 идут подряд в очереди станка (острова слиты через границу джамбо).
var contiguous = idx.length === 4 && (idx[3] - idx[0] === 3);
assert(contiguous, '#4214: MWR200|OUT (джамбо 500) слиты в один блок сквозь задания с другим джамбо');

// Все MWR200 в один день (не разорваны днём — жалоба «разрыв по сырью»).
var mwrDays = MWR200.map(function(id){ return daysOf[id]; }).filter(function(d){ return d != null; });
var oneDay = mwrDays.length === 4 && mwrDays.every(function(d){ return d === mwrDays[0]; });
assert(oneDay, '#4214: MWR200 не разорваны по дням (все на одном дне, а не 0 и 2)');

// Склейка не плодит просрочку.
var overdue = order.filter(function(o){ var d = dueDayByCut[o.id]; return d != null && o.day > Number(d); });
console.log('Просрочено:', overdue.length ? overdue.map(function(o){return o.id+'(день'+o.day+'>срок'+dueDayByCut[o.id]+')';}).join(' ') : 'нет');
assert(overdue.length === 0, '#4214: склейка не создаёт просрочки (ни одно задание не позже срока)');

console.log('\n' + passed + '/' + total + ' проверок прошло');
if (passed !== total) process.exitCode = 1;
