// Unit tests for ideav/crm#3921 — балансировка по ВОЗМОЖНОЙ ДАТЕ НАЧАЛА (дате освобождения
// станка от задач/отпуска). Станок в отпуске «до 12 июля» не должен держать хвост работы на
// 13–16 июля, пока другие станки простаивают с 9 июля — этот хвост должен уехать на них.
//
// Причина прежнего поведения: счёт баланса начинался с maxDays (ЦЕЛЫЙ span, ceil дней). При
// отпуске у станка возникает «плато»: перенос одного задания не меняет целый span (1680→1500
// мин = те же 4 «дня»), но растит пик/суммакв → счёт не улучшается, и работа застревает ЗА
// отпуском. Фикс #3921: в счёт добавлен maxEndPos — ДРОБНАЯ дата окончания (по минутам, с
// учётом отпуска). Каждый перенос строго снижает дробный хвост → он «стекает» на свободные
// станки, пока станок в отпуске не перестанет работать после отпуска.
//
// Run with: node experiments/atex-production-planning-3921.test.js

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

var CAP = 450;   // 3 задачи по 150 мин в день
function plan(id, sid, dur) {
    return { id: id, slitterId: String(sid), materialId: 'A', winding: 'OUT', knifeWidths: [50], knifeCount: 1, isFoil: false, duration: dur || 150 };
}
function dist(plans) { var o = {}; plans.forEach(function (p) { o[p.slitterId] = (o[p.slitterId] || 0) + 1; }); return o; }

// ── Хвост за отпуском стекает на свободные станки ──
(function () {
    // 4 станка. Станок 1 перегружен (21 задача) и в отпуске дни 3..11 (04–12.07 от базы 01.07);
    // станки 2/3/4 — по 9 задач, без отпуска. Прежде Станок 1 держал хвост до дня 16 (span 17).
    var SL = [{ id: '1' }, { id: '2' }, { id: '3' }, { id: '4' }];
    var plans = [];
    for (var i = 0; i < 21; i++) plans.push(plan('a' + i, '1'));
    ['2', '3', '4'].forEach(function (m) { for (var j = 0; j < 9; j++) plans.push(plan(m + '_' + j, m)); });
    var res = planning.rebalanceSlitterLoad(plans, SL, {
        weights: null, dayCapacityMin: CAP,
        machineDayOff: function (id, d) { return String(id) === '1' && d >= 3 && d <= 11; }
    });
    // Станок 1 больше НЕ работает после отпуска: его дата окончания = конец отпуска (span 12).
    assertEqual(res.loadAfter['1'].days, 12, '#3921 Станок 1: дата окончания = конец отпуска (span 12), без хвоста за отпуском');
    // Работа стекла на свободные станки: каждый заканчивает НАМНОГО раньше конца отпуска.
    assert(res.loadAfter['2'].days < 12 && res.loadAfter['3'].days < 12 && res.loadAfter['4'].days < 12,
        '#3921 станки 2/3/4 приняли хвост и кончают раньше конца отпуска Станка 1');
    // Хвост реально уехал: у Станка 1 осталась лишь доотпускная работа (≤ 3 дней = 9 задач).
    assert((dist(plans)['1'] || 0) <= 9, '#3921 у Станка 1 осталась только доотпускная работа (≤ 9 задач)');
    assert(res.moves.length > 0, '#3921 переносы были');
})();

// ── #3881 сохранён: на станок В ОТПУСКЕ работу НЕ переносим (перенос лишь оттянул бы окончание) ──
(function () {
    var SL = [{ id: '1' }, { id: '2' }];
    var plans = [plan('a', '1'), plan('b', '1'), plan('c', '1'), plan('d', '1')];
    var res = planning.rebalanceSlitterLoad(plans, SL, {
        weights: null, dayCapacityMin: CAP,
        machineDayOff: function (id, d) { return String(id) === '2' && d >= 0 && d <= 2; }
    });
    assertEqual((dist(plans)['2'] || 0), 0, '#3921/#3881 на станок в отпуске задания не переносим');
    assertEqual(dist(plans)['1'], 4, '#3921/#3881 все 4 задачи остались на станке 1 (кончает раньше)');
})();

// ── Без отпусков — прежнее ровное распределение (доп. дробный ключ не ломает баланс) ──
(function () {
    var SL = [{ id: '1' }, { id: '2' }];
    var plans = [plan('a', '1'), plan('b', '1'), plan('c', '1'), plan('d', '1')];
    planning.rebalanceSlitterLoad(plans, SL, { weights: null, dayCapacityMin: CAP });
    assertEqual(dist(plans), { '1': 2, '2': 2 }, '#3921 без отпуска: 4 задачи раскиданы 2/2 (как прежде)');
})();

console.log('\n' + passed + ' assertions passed');
