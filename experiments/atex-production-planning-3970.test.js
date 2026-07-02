// Tests for ideav/crm#3970 — «Перегрузка и недогрузка опять, набито на станок 1 после отпуска».
//
// Follow-up к #3968. Симптом (лог ateh_log10 + отчёты): Станок 1 с недельным отпуском (06–12.07)
// перегружен и его работа переливается ЗА отпуск (13–15.07, дни 488/492 > ёмкости), пока Станок 4
// недогружен (15 резок). Балансировщик оценил Станок 1 всего в ~1300–1600 мин (реально ~2800+) и
// НЕ разгрузил его.
//
// Причина: раскладки, которые балансировщик (rebalanceSlitterLoad → packMachine → orderCuts →
// sequenceByDue) получал (layoutPlans), НЕ несли dueKey. Без срока все раскладки попадали в ОДИН
// «срок» (Infinity), и sequenceByDue группировала одинаковые конфиги ГЛОБАЛЬНО → настройка почти не
// начислялась. Реальное же расписание разносит одинаковые конфиги с РАЗНЫМИ сроками (#3815) по
// очереди — между ними встают другие конфиги, и каждый ставит ножи/сырьё заново. Поэтому оценка
// была ВДВОЕ ниже реальной укладки → станок казался лёгким, его не разгружали.
//
// Фикс #3970: layoutPlans получают dueKey (самый ранний срок покрываемых позиций) — как и реальная
// раскладка (autoSequenceQueue.dueKeyByCut). Теперь packMachine упорядочивает по тому же EDD-ключу,
// и оценка настройки совпадает с реальным расписанием (настроечно-разный станок виден тяжёлым).
//
// Здесь проверяем МЕХАНИЗМ через rebalanceSlitterLoad.loadBefore (packMachine): при ЧЕРЕДУЮЩИХСЯ по
// сроку конфигах оценка настройки ВЫШЕ (разнос), чем без сроков (глобальная группировка).
//
// Run with: node experiments/atex-production-planning-3970.test.js

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
// Два разных конфига A и B (переход между ними = KNIFE 30 + MATERIAL_WINDING 15 = 45).
function cut(id, sid, cfg, wind, dueKey) {
    var A = cfg === 'A';
    var c = { id: id, slitterId: String(sid), materialId: A ? 'A' : 'B', winding: 'OUT',
              knifeWidths: A ? [50] : [60], knifeCount: 1, isFoil: false, duration: wind };
    if (dueKey != null) c.dueKey = dueKey;
    return c;
}

// ── 1) Сроки ЧЕРЕДУЮТ конфиги → настройка начисляется чаще, чем при глобальной группировке ──
// A,B,A,B по возрастанию срока: реальная очередь A→B→A→B (3 перехода). Без сроков orderCuts
// сгруппировал бы в A,A,B,B (1 переход). Оценка packMachine со сроками должна быть ВЫШЕ.
(function () {
    // Без сроков (как БЫЛО: layoutPlans без dueKey) — глобальная группировка.
    var noDue = [cut('a1', '1', 'A', 30), cut('a2', '1', 'A', 30), cut('b1', '1', 'B', 30), cut('b2', '1', 'B', 30)];
    var rNo = planning.rebalanceSlitterLoad(noDue, [{ id: '1' }, { id: '2' }], { weights: null, dayCapacityMin: CAP, maxIters: 0 });

    // Со сроками (как СТАЛО): A(1), B(2), A(3), B(4) — EDD разносит конфиги.
    var due = [cut('a1', '1', 'A', 30, 1), cut('b1', '1', 'B', 30, 2), cut('a2', '1', 'A', 30, 3), cut('b2', '1', 'B', 30, 4)];
    var rDue = planning.rebalanceSlitterLoad(due, [{ id: '1' }, { id: '2' }], { weights: null, dayCapacityMin: CAP, maxIters: 0 });

    assert(rDue.loadBefore['1'].minutes > rNo.loadBefore['1'].minutes,
        '#3970 сроки ЧЕРЕДУЮТ конфиги → настройка выше (EDD-разнос): со сроками ' +
        rDue.loadBefore['1'].minutes + 'м > без сроков ' + rNo.loadBefore['1'].minutes + 'м');
    // Конкретика: без сроков 1 переход (A,A,B,B), со сроками 3 перехода (A,B,A,B) → +2×45 = +90.
    assertEqual(rDue.loadBefore['1'].minutes - rNo.loadBefore['1'].minutes, 90,
        '#3970 разница ровно 2 лишних перехода × 45 = 90 мин (A,B,A,B против A,A,B,B)');
})();

// ── 2) Одинаковый срок → конфиги группируются (настройка минимальна) ──
// A(1),A(1),B(1),B(1): один срок → sequenceByDue как без сроков (группировка), 1 переход.
(function () {
    var same = [cut('a1', '1', 'A', 30, 1), cut('a2', '1', 'A', 30, 1), cut('b1', '1', 'B', 30, 1), cut('b2', '1', 'B', 30, 1)];
    var noDue = [cut('a1', '1', 'A', 30), cut('a2', '1', 'A', 30), cut('b1', '1', 'B', 30), cut('b2', '1', 'B', 30)];
    var rSame = planning.rebalanceSlitterLoad(same, [{ id: '1' }, { id: '2' }], { weights: null, dayCapacityMin: CAP, maxIters: 0 });
    var rNo = planning.rebalanceSlitterLoad(noDue, [{ id: '1' }, { id: '2' }], { weights: null, dayCapacityMin: CAP, maxIters: 0 });
    assertEqual(rSame.loadBefore['1'].minutes, rNo.loadBefore['1'].minutes,
        '#3970 один срок ⇒ та же группировка, что без сроков (настройка не раздувается)');
})();

console.log('\n' + passed + ' assertions passed');
