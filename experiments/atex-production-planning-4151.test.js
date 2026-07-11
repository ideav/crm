// Tests for ideav/crm#4151 (+ #4150) — «Почему MWR233 влез между MR194? Это надо менять рулон,
// а потом обратно».
//
// changeoverParts берёт 15 мин за смену сырья ИЛИ намотки ИЛИ партии ОДИНАКОВО. Поэтому переход
// «тот же рулон, другая намотка» (MR194 OUT↔IN) и «другой рулон» (MR194→MWR233) стоят по 15 — и
// движку всё равно, рвать ли группу одного рулона чужим материалом. На Станке 1 03.07 очередь легла
// MR194×6 → MWR233 → MR194(IN) → MWR200: рулон MR194 демонтируется под MWR233 и монтируется снова.
// По реальным минутам это оптимально (4 группы = 3 перехода = 45), но физически — лишний перемонтаж.
//
// Фикс #4151 (тай-брейк группировки, ТЗ §14): sequencingCost внутри resequenceWithinDays добавляет
// КРОШЕЧНЫЙ штраф за смену РУЛОНА (материал/партия, НЕ намотка). При РАВНОЙ реальной переналадке DP
// держит резки одного рулона вместе; двойная приёмка (newReal ≤ oldReal) не даёт разменять перемонтаж
// на лишнюю смену ножей. Реальные минуты «Наладки»/«Смены сырья» и модель стоимости НЕ трогаем.
//
// Run with: node experiments/atex-production-planning-4151.test.js

process.env.TZ = 'UTC';
var planning = require('../download/atex/js/production-planning.js').planning;

var passed = 0, failed = 0;
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) passed++;
    else { failed++; console.log('  ожидалось:', JSON.stringify(expected)); console.log('  получено: ', JSON.stringify(actual)); process.exitCode = 1; }
}
function assert(cond, name) { assertEqual(!!cond, true, name); }

var TIMES = { MATERIAL_WINDING: 15, KNIFE: 30, KNIFE_MOVE: 2, BETWEEN_CUTS: 2, CLEANUP_SHIFT: 30 };

function parseKnives(s) {
    var widths = [], count = 0;
    String(s).split(',').forEach(function (part) {
        var m = part.split('*'); var w = Number(m[0]); var n = Number(m[1]) || 1;
        if (w > 0) { widths.push(w); count += n; }
    });
    return { widths: widths, count: count };
}
function cut(cid, mat, wind, knives, batch) {
    var k = parseKnives(knives);
    return { id: String(cid), slitter: { id: '1' }, materialId: mat, winding: wind, batchId: String(batch),
        knifeWidths: k.widths, knifeCount: k.count, rollerWidth: 0 };
}
function realCost(arr) {
    var t = 0;
    for (var i = 1; i < arr.length; i++) t += planning.changeoverCost(arr[i - 1], arr[i], TIMES);
    return t;
}
// перемонтажи рулона = число «прогонов» материала − число различных материалов
function remounts(arr) {
    var runs = [], mats = {};
    arr.forEach(function (c) { if (!runs.length || runs[runs.length - 1] !== c.materialId) runs.push(c.materialId); mats[c.materialId] = 1; });
    return runs.length - Object.keys(mats).length;
}
function contiguous(arr, mat) {
    var idx = arr.map(function (c, i) { return c.materialId === mat ? i : -1; }).filter(function (i) { return i >= 0; });
    return idx.every(function (i, k) { return k === 0 || i === idx[k - 1] + 1; });
}

// ── 1) Реальная очередь Станка 1 за 03.07 (вложение #4150/#4151), все ножи 110*8 кроме MW308 ──
var seq = [
    cut('475326', 'MWR113L', 'IN',  '110*8', 'b113'),
    cut('472473', 'MR194',   'OUT', '110*8', '74926'),
    cut('473432', 'MR194',   'OUT', '110*8', '74926'),
    cut('472886', 'MR194',   'OUT', '110*8', '74926'),
    cut('472891', 'MR194',   'OUT', '110*8', '74926'),
    cut('472618', 'MR194',   'OUT', '110*8', '74926'),
    cut('472509', 'MR194',   'OUT', '110*8', '74926'),
    cut('474921', 'MWR233',  'OUT', '110*8', '77345'),   // ← втиснут между MR194
    cut('473783', 'MR194',   'IN',  '110*8', '74926'),   // ← возврат к MR194
    cut('474209', 'MWR200',  'OUT', '110*8', '74922'),
    cut('474609', 'MWR200',  'OUT', '110*8', '74922'),
    cut('473278', 'MW308',   'OUT', '154*5,110*1', '74929'),
    cut('473308', 'MW308',   'OUT', '154*5,110*1', '74929')
];
var dayByCut = {}; seq.forEach(function (c) { dayByCut[c.id] = 0; });

assertEqual([contiguous(seq, 'MR194'), remounts(seq)], [false, 1],
    'ВХОД: MR194 разорван (MWR233 между), 1 перемонтаж рулона');

var out = planning.resequenceWithinDays(seq, dayByCut, {}, null, TIMES);
assert(!!out, 'resequenceWithinDays нашёл лучший порядок (не null)');
assert(contiguous(out, 'MR194'), 'ПОСЛЕ: все резки MR194 идут подряд (рулон монтируется один раз)');
assertEqual(remounts(out), 0, 'ПОСЛЕ: перемонтажей рулона MR194 нет');
assert(realCost(out) <= realCost(seq),
    'ПОСЛЕ: реальная переналадка НЕ выросла (' + realCost(out) + ' ≤ ' + realCost(seq) + ') — группировка бесплатна');
// MWR233 больше не окружён MR194 с обеих сторон
var iM = out.findIndex(function (c) { return c.id === '474921'; });
assert(!(out[iM - 1] && out[iM - 1].materialId === 'MR194' && out[iM + 1] && out[iM + 1].materialId === 'MR194'),
    'ПОСЛЕ: MWR233 не зажат между MR194 — не надо менять рулон и обратно');

// ── 2) Минимальный тай-брейк: A(M1) B(M2) A2(M1), равная реальная переналадка → группируем M1 ──
// Одни ножи у всех → смена ножей 0; сырьё меняется по 15 в любом порядке (2 перехода). Тай-брейк
// собирает A,A2 вместе (рулон M1 не перемонтируется). Приёмка: реальная переналадка та же (30).
var A  = cut('A',  'M1', 'OUT', '50*10', 'lot1');
var B  = cut('B',  'M2', 'OUT', '50*10', 'lot2');
var A2 = cut('A2', 'M1', 'OUT', '50*10', 'lot1');
var out2 = planning.resequenceWithinDays([A, B, A2], { A: 0, B: 0, A2: 0 }, {}, null, TIMES);
assert(!!out2 && contiguous(out2, 'M1'), 'тай-брейк: A,B,A2 → M1 группируется (A рядом с A2)');
assert(!out2 || realCost(out2) <= realCost([A, B, A2]), 'тай-брейк: реальная переналадка не выросла');

// ── 3) НЕ разменивать перемонтаж на смену ножей: если группировка требует лишних ножей — не трогаем ──
// A(M1, ножи 10) B(M2, ножи 20) A2(M1, ножи 10): сгруппировать A,A2 = убрать перемонтаж M1, НО тогда
// B уедет и добавит смену ножей 10→20→10 вместо 10→20→... Реальная переналадка выросла бы → приёмка
// (newReal ≤ oldReal) обязана отвергнуть перегруппировку с ростом реальных минут.
var K1 = cut('K1', 'M1', 'OUT', '10*5', 'l1');
var K2 = cut('K2', 'M2', 'OUT', '20*5', 'l2');
var K3 = cut('K3', 'M1', 'OUT', '10*5', 'l1');
var seqK = [K1, K2, K3];
var outK = planning.resequenceWithinDays(seqK, { K1: 0, K2: 0, K3: 0 }, {}, null, TIMES);
var applied = outK || seqK;
assert(realCost(applied) <= realCost(seqK),
    'приёмка: перегруппировка не разменивает перемонтаж рулона на лишнюю смену ножей (реальные минуты не растут)');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
