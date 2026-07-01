// Unit tests for ideav/crm#3881 — распределение нагрузки по ДАТЕ ОКОНЧАНИЯ последней задачи
// (у кого позже — тот более загружен), а не по сумме минут.
//
// Иначе у станка может быть отпуск, и его загрузят на послеотпускное время, пока другие
// простаивают. rebalanceSlitterLoad теперь считает «загруженность» станка как СПАН календарных
// дней до окончания: содержимое кладётся по рабочим дням, ПРОПУСКАЯ дни отпуска (станок с
// отпуском кончает позже), а дни отпуска заняты (станок в отпуске без задач после него «занят»
// до конца отпуска — уточнение заказчика). machineDayOff(id, dayOffset)→bool задаёт отпуск.
//
// Run with: node experiments/atex-production-planning-3881.test.js

process.env.TZ = 'UTC';
var planning = require('../download/atex/js/production-planning.js').planning;

var passed = 0, failed = 0;
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) passed++; else { failed++; console.log('  expected:', JSON.stringify(expected)); console.log('  actual:  ', JSON.stringify(actual)); process.exitCode = 1; }
}
function assert(cond, name) { assertEqual(!!cond, true, name); }

var CAP = 450;   // 3 задачи по 150 в день
function plan(id, sid, dur) {
    return { id: id, slitterId: String(sid), materialId: 'A', winding: 'OUT', knifeWidths: [50], knifeCount: 1, isFoil: false, duration: dur || 150 };
}
function cutsByMachine(plans) { var o = {}; plans.forEach(function (p) { o[p.slitterId] = (o[p.slitterId] || 0) + 1; }); return o; }

// ── Уточнение заказчика: станок в отпуске без задач «занят» до конца отпуска ──
(function () {
    // 4 задачи на станке 1; станок 2 простаивает, но в отпуске дни 0–2.
    var SL = [{ id: '1' }, { id: '2' }];
    var plans = [plan('a', '1'), plan('b', '1'), plan('c', '1'), plan('d', '1')];
    var res = planning.rebalanceSlitterLoad(plans, SL, {
        weights: null, dayCapacityMin: CAP,
        machineDayOff: function (id, d) { return String(id) === '2' && d >= 0 && d <= 2; }
    });
    // Станок 2 без задач, но отпуск дни 0–2 → «дата окончания» = конец отпуска (span 3).
    assertEqual(res.loadBefore['2'].days, 3, '#3881 станок 2 в отпуске без задач → занят до конца отпуска (span 3)');
    assertEqual(res.loadBefore['1'].days, 2, '#3881 станок 1 (4×150) → 2 дня');
})();

// ── Не грузить станок в отпуске: задания НЕ уезжают на отпускной станок ──
(function () {
    var SL = [{ id: '1' }, { id: '2' }];
    // Контроль: без отпуска балансировка раскидала бы 4 задачи 2/2.
    var ctrl = [plan('a', '1'), plan('b', '1'), plan('c', '1'), plan('d', '1')];
    planning.rebalanceSlitterLoad(ctrl, SL, { weights: null, dayCapacityMin: CAP });
    assertEqual(cutsByMachine(ctrl), { '1': 2, '2': 2 }, '#3881 контроль (без отпуска): 4 задачи раскиданы 2/2');

    // С отпуском станка 2 (дни 0–2): перенос на него лишь оттянул бы окончание (span ↑) —
    // балансировка оставляет всё на станке 1 (он кончает раньше).
    var plans = [plan('a', '1'), plan('b', '1'), plan('c', '1'), plan('d', '1')];
    var res = planning.rebalanceSlitterLoad(plans, SL, {
        weights: null, dayCapacityMin: CAP,
        machineDayOff: function (id, d) { return String(id) === '2' && d >= 0 && d <= 2; }
    });
    assertEqual(cutsByMachine(plans)['2'] || 0, 0, '#3881 станок 2 в отпуске → задания НЕ переносим на него');
    assertEqual(cutsByMachine(plans)['1'], 4, '#3881 все 4 задачи остались на станке 1 (кончает раньше)');
    assert(res.stopReason === 'no-progress', '#3881 стоп: нет улучшающего хода');
})();

// ── Разгрузка перегруженного идёт на СВОБОДНЫЙ станок, а не на отпускной ──
(function () {
    var SL = [{ id: '1' }, { id: '2' }, { id: '3' }];
    // 6 задач на станке 1 (2 дня). Станок 2 — в отпуске дни 0–4. Станок 3 — свободен.
    var plans = [];
    for (var i = 1; i <= 6; i++) plans.push(plan('c' + i, '1'));
    planning.rebalanceSlitterLoad(plans, SL, {
        weights: null, dayCapacityMin: CAP,
        machineDayOff: function (id, d) { return String(id) === '2' && d >= 0 && d <= 4; }
    });
    var by = cutsByMachine(plans);
    assertEqual(by['2'] || 0, 0, '#3881 на отпускной станок 2 ничего не переносим');
    assert((by['3'] || 0) > 0, '#3881 разгрузка ушла на свободный станок 3');
    assert((by['1'] || 0) < 6, '#3881 станок 1 разгружен');
})();

// ── Содержимое продавливается ЗА отпуск: станок с отпуском кончает позже при тех же минутах ──
(function () {
    var SL = [{ id: '1' }, { id: '2' }];
    // По 2 задачи (2×150+30 = 330 ≤ 450 → 1 «день» содержимого). Станок 2 в отпуске дни 0–1.
    var plans = [plan('a', '1'), plan('b', '1'), plan('c', '2'), plan('d', '2')];
    var res = planning.rebalanceSlitterLoad(plans, SL, {
        weights: null, dayCapacityMin: CAP,
        machineDayOff: function (id, d) { return String(id) === '2' && d >= 0 && d <= 1; }
    });
    // Старт: станок 1 (2×150, без отпуска) → день 0 (span 1); станок 2 (2×150 + отпуск дни 0–1)
    //        → содержимое после отпуска, день 2 (span 3). Те же минуты — но окончание позже.
    assertEqual(res.loadBefore['1'].days, 1, '#3881 станок 1 (2×150, без отпуска) кончает в день 0 (span 1)');
    assertEqual(res.loadBefore['2'].days, 3, '#3881 станок 2 (2×150 + отпуск 0–1) кончает позже — span 3');
})();

// ── Обратная совместимость: без machineDayOff поведение прежнее (#3848) ──
(function () {
    var SL = [{ id: '1' }, { id: '2' }, { id: '3' }, { id: '4' }];
    var plans = [];
    for (var i = 1; i <= 8; i++) plans.push(plan('c' + i, '4'));
    var res = planning.rebalanceSlitterLoad(plans, SL, { weights: null, dayCapacityMin: CAP });
    assertEqual(cutsByMachine(plans), { '1': 2, '2': 2, '3': 2, '4': 2 }, '#3881 без отпусков — ровно 2/2/2/2 (как #3848)');
    assertEqual(res.loadBefore['4'].days, 4, '#3881 без machineDayOff: дата окончания из реальной укладки (#3965 per-day настройки), баланс всё равно 2/2/2/2');
})();

console.log('\n' + passed + ' проверок прошло' + (failed ? ', ' + failed + ' упало' : '') + '.');
if (!failed) console.log('Все проверки #3881 зелёные.');
