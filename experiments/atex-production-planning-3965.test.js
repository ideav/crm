// Tests for ideav/crm#3965 — «на первый станок опять накидали после отпуска, и дни >460/недобор».
//
// Причина (лог+CSV из #3965): rebalanceSlitterLoad оценивал загрузку станка формулой poolMinutes
// (намотка + переналадки в порядке orderCuts + одна настройка). orderCuts группирует одинаковые
// конфиги (sequenceByDue: внутри одного срока — по переналадке), а РЕАЛЬНЫЙ день-сплит порядок не
// группирует: разные сроки (#3815) и направления намотки разносят одинаковые конфиги по очереди,
// поэтому почти каждая резка ставит ножи+сырьё заново. Итог: реальная загрузка настроечно-тяжёлого
// станка ВДВОЕ выше оценки (Станок 1: реально 2757 мин ≈ 42 мин настройки на резку, оценка ~1214
// мин). Балансировщик думал, что станок влезает до отпуска, докидывал на него, а хвост уезжал за
// отпуск, пока 2/3/4 простаивали.
//
// Фикс #3965: загрузка станка = ФАКТИЧЕСКАЯ укладка packMachine по рабочим дням (ёмкость cap,
// пропуск нерабочих дней, настройка КАЖДОЙ резки «с нуля» — ножи+сырьё). Дата окончания и минуты
// берутся из укладки, а не из заниженной формулы → реальный перегруз за отпуском виден, хвост
// стекает на свободные станки.
//
// Run with: node experiments/atex-production-planning-3965.test.js

process.env.TZ = 'UTC';
var planning = require('../download/atex/js/production-planning.js').planning;

var passed = 0;
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) passed++;
    else { console.log('  expected:', JSON.stringify(expected)); console.log('  actual:  ', JSON.stringify(actual)); process.exitCode = 1; }
}
function assert(cond, name) { assertEqual(!!cond, true, name); }

var CAP = 450;
// Настройка резки «с нуля» = ножи (KNIFE 30) + смена сырья (MATERIAL_WINDING 15) = 45 (DEFAULT_OP_TIMES).
var SCRATCH = 45;
function plan(id, sid, wind) {
    return { id: id, slitterId: String(sid), materialId: 'A', winding: 'OUT', knifeWidths: [50], knifeCount: 1, isFoil: false, duration: wind };
}
function dist(p) { var o = {}; p.forEach(function (x) { o[x.slitterId] = (o[x.slitterId] || 0) + 1; }); return o; }

// ── 1) Настройка считается У КАЖДОЙ резки (реальный день-сплит не группирует конфиги) ──
// 12 одинаковых резок (намотка 55) на станке 1 из двух. Реальная укладка: 12×(45+55)=1200 мин.
// Прежняя формула poolMinutes сгруппировала бы их: 12×55 + одна настройка ≈ 690 мин (занижение).
(function () {
    var plans = [];
    for (var i = 0; i < 12; i++) plans.push(plan('a' + i, '1', 55));
    var res = planning.rebalanceSlitterLoad(plans, [{ id: '1' }, { id: '2' }], { weights: null, dayCapacityMin: CAP });
    assertEqual(res.loadBefore['1'].minutes, 12 * (SCRATCH + 55), '#3965 настройка у КАЖДОЙ резки: 12×(45+55)=1200 мин (не сгруппированные ~690)');
    assert(res.moves.length > 0 && (dist(plans)['2'] || 0) > 0, '#3965 перегруз виден → часть резок ушла на станок 2');
})();

// ── 2) Настроечно-тяжёлый станок в отпуске: хвост за отпуском стекает, дни ≤ ёмкости ──
// Станок 1: 40 мелких резок (намотка 10 → 55 мин с настройкой) = 2200 мин ≈ 5 рабочих дней.
// Отпуск дни 3..11; доотпускных рабочих дней 0,1,2 = 3×450 = 1350 мин. 2/3/4 — загружены (по 12).
(function () {
    function vac1(d) { return d >= 3 && d <= 11; }
    var plans = [];
    for (var i = 0; i < 40; i++) plans.push(plan('s1_' + i, '1', 10));
    ['2', '3', '4'].forEach(function (m) { for (var j = 0; j < 12; j++) plans.push(plan(m + '_' + j, m, 10)); });
    var res = planning.rebalanceSlitterLoad(plans, [{ id: '1' }, { id: '2' }, { id: '3' }, { id: '4' }],
        { weights: null, dayCapacityMin: CAP, machineDayOff: function (id, d) { return String(id) === '1' && vac1(d); } });

    // ДО баланса: реальная укладка видит перелив ЗА отпуск (дата окончания > конца отпуска = 12).
    assert(res.loadBefore['1'].days > 12, '#3965 ДО: Станок 1 переливается за отпуск (дата оконч. ' + res.loadBefore['1'].days + ' > 12) — реальный перегруз виден');
    assert(res.loadBefore['1'].minutes >= 40 * (SCRATCH + 10) - 1, '#3965 ДО: минуты Станка 1 из реальной укладки (≈ 40×55=2200), не занижены');

    // ПОСЛЕ баланса: Станок 1 не работает после отпуска — дата окончания ≤ конца отпуска (12),
    // его работа влезает в доотпускные дни 0..2 (≤ 1350 мин), хвост уехал на 2/3/4.
    assert(res.loadAfter['1'].days <= 12, '#3965 ПОСЛЕ: Станок 1 кончает ≤ конца отпуска (дата оконч. ' + res.loadAfter['1'].days + '), хвоста за отпуском нет');
    assert(res.loadAfter['1'].minutes <= 1350, '#3965 ПОСЛЕ: работа Станка 1 (' + Math.round(res.loadAfter['1'].minutes) + 'м) влезает до отпуска (≤ 1350)');
    assert((dist(plans)['1'] || 0) < 40, '#3965 ПОСЛЕ: у Станка 1 резок меньше 40 (хвост стёк на 2/3/4)');
})();

// ── 3) Без machineDayOff (нет инфо об отпусках) — балансировка настроечно-тяжёлого станка работает ──
(function () {
    var plans = [];
    for (var i = 0; i < 24; i++) plans.push(plan('m_' + i, '1', 10));   // всё на станке 1
    var res = planning.rebalanceSlitterLoad(plans, [{ id: '1' }, { id: '2' }, { id: '3' }, { id: '4' }],
        { weights: null, dayCapacityMin: CAP });
    assert(res.moves.length > 0, '#3965 без отпусков: перегруженный станок разгружается');
    var d = dist(plans);
    assert((d['2'] || 0) > 0 && (d['3'] || 0) > 0 && (d['4'] || 0) > 0, '#3965 без отпусков: работа разошлась по всем станкам');
})();

console.log('\n' + passed + ' assertions passed');
