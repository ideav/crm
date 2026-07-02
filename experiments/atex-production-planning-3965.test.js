// Tests for ideav/crm#3965 — «на первый станок опять накидали после отпуска, и дни >460/недобор».
//
// Причина (лог+CSV из #3965): rebalanceSlitterLoad оценивал загрузку станка формулой poolMinutes
// (намотка + переналадки в порядке orderCuts + одна настройка). Оценка занижала настроечно-тяжёлый
// станок с МНОГИМИ РАЗНЫМИ конфигами (разные сырьё/намотка/сроки #3815 → почти каждая резка ставит
// ножи+сырьё заново): реально ≈ 42 мин настройки на резку, а формула — почти ноль. Балансировщик
// думал, что станок влезает до отпуска, докидывал, а хвост уезжал за отпуск, пока 2/3/4 простаивали.
//
// Фикс (текущий, #3968): загрузка станка = ФАКТИЧЕСКАЯ укладка packMachine по рабочим дням, а
// настройка каждой резки — переналадка от ПРЕДЫДУЩЕЙ в очереди (changeoverCost, как buildSchedule/
// splitMachineQueue selectByConfig), НЕ «с нуля» у каждой. Это честно в обе стороны:
//   • МНОГО РАЗНЫХ конфигов (сценарий #3965) → каждый переход = полная настройка → станок тяжёлый,
//     хвост за отпуском стекает (как и требовал #3965);
//   • ОДИНАКОВЫЕ конфиги (просроченная партия одного сырья, #3968) → соседние ставят ножи/сырьё
//     ОДИН раз → станок лёгкий, балансировщик не завышает его загрузку и не оставляет недогруженным.
// (Промежуточная версия #3965 считала настройку «с нуля» у КАЖДОЙ резки — это завышало
// настроечно-СГРУППИРОВАННЫЙ станок почти вдвое, см. #3968.)
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

// Настроечно-РАЗНАЯ резка: у каждой уникальные сырьё И набор ножей → переналадка от любой соседней
// = KNIFE 30 + MATERIAL_WINDING 15 = 45 (группировка невозможна). Модель настроечно-тяжёлого станка
// из #3965 (разные сроки/намотки разносят конфиги). Уникальность стабильна по id.
var _distinctW = {}, _distinctN = 0;
function distinct(id, sid, wind) {
    if (!(id in _distinctW)) _distinctW[id] = 50 + (_distinctN++) * 3;
    return { id: id, slitterId: String(sid), materialId: 'M' + id, winding: 'OUT',
             knifeWidths: [_distinctW[id]], knifeCount: 1, isFoil: false, duration: wind };
}
// Настроечно-ОДИНАКОВАЯ резка: один конфиг → соседние группируются (переход 0).
function same(id, sid, wind) {
    return { id: id, slitterId: String(sid), materialId: 'A', winding: 'OUT',
             knifeWidths: [50], knifeCount: 1, isFoil: false, duration: wind };
}
function dist(p) { var o = {}; p.forEach(function (x) { o[x.slitterId] = (o[x.slitterId] || 0) + 1; }); return o; }

// ── 1) РАЗНЫЕ конфиги → настройка у КАЖДОЙ резки; ОДИНАКОВЫЕ → группируются (#3968) ──
(function () {
    // 12 РАЗНЫХ резок (намотка 55) на станке 1 из двух: реальная укладка 12×(45+55)=1200 мин.
    var diff = [];
    for (var i = 0; i < 12; i++) diff.push(distinct('a' + i, '1', 55));
    var rDiff = planning.rebalanceSlitterLoad(diff, [{ id: '1' }, { id: '2' }], { weights: null, dayCapacityMin: CAP });
    assertEqual(rDiff.loadBefore['1'].minutes, 12 * (SCRATCH + 55), '#3965 РАЗНЫЕ конфиги: настройка у каждой — 12×(45+55)=1200 мин');
    assert(rDiff.moves.length > 0 && (dist(diff)['2'] || 0) > 0, '#3965 РАЗНЫЕ: перегруз виден → часть резок ушла на станок 2');

    // 12 ОДИНАКОВЫХ резок (намотка 55): соседние ставят ножи/сырьё один раз → 45 + 12×55 = 705 мин.
    var grp = [];
    for (var j = 0; j < 12; j++) grp.push(same('b' + j, '1', 55));
    var rGrp = planning.rebalanceSlitterLoad(grp, [{ id: '1' }, { id: '2' }], { weights: null, dayCapacityMin: CAP });
    assertEqual(rGrp.loadBefore['1'].minutes, SCRATCH + 12 * 55, '#3968 ОДИНАКОВЫЕ конфиги ГРУППИРУЮТСЯ: 45 + 12×55 = 705 мин (не 1200) — станок не завышен');
    assert(rGrp.loadBefore['1'].minutes < rDiff.loadBefore['1'].minutes, '#3968 сгруппированный станок ЛЕГЧЕ настроечно-разного при той же намотке');
})();

// ── 2) Настроечно-тяжёлый (РАЗНЫЕ конфиги) станок в отпуске: хвост за отпуском стекает ──
// Станок 1: 40 РАЗНЫХ резок (намотка 10 → 55 мин с настройкой) = 2200 мин ≈ 5 рабочих дней.
// Отпуск дни 3..11; доотпускных рабочих дней 0,1,2 = 3×450 = 1350 мин. 2/3/4 — загружены (по 12).
(function () {
    function vac1(d) { return d >= 3 && d <= 11; }
    var plans = [];
    for (var i = 0; i < 40; i++) plans.push(distinct('s1_' + i, '1', 10));
    ['2', '3', '4'].forEach(function (m) { for (var j = 0; j < 12; j++) plans.push(distinct(m + '_' + j, m, 10)); });
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
    for (var i = 0; i < 24; i++) plans.push(distinct('m_' + i, '1', 10));   // всё на станке 1, разные конфиги
    var res = planning.rebalanceSlitterLoad(plans, [{ id: '1' }, { id: '2' }, { id: '3' }, { id: '4' }],
        { weights: null, dayCapacityMin: CAP });
    assert(res.moves.length > 0, '#3965 без отпусков: перегруженный станок разгружается');
    var d = dist(plans);
    assert((d['2'] || 0) > 0 && (d['3'] || 0) > 0 && (d['4'] || 0) > 0, '#3965 без отпусков: работа разошлась по всем станкам');
})();

console.log('\n' + passed + ' assertions passed');
