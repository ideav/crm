// Unit tests for #3737 — значок смежности дня (←/→) при выборе ОДНОГО дня в планировании.
// Сегмент-продолжение задания, перешедший границу выбранного диапазона дат, лежит в дне ВНЕ
// фильтра и в очередь не попадает (хотя cut_planning грузится целиком и он есть в self.cuts).
// planning.boundaryDaySibling находит этого недостающего соседа через границу дня — по нему
// renderQueue подменяет отсутствующего prev/next и рисует значок даже для одного дня.
//
// Run with: node experiments/atex-production-planning-3737.test.js

process.env.TZ = 'UTC';

var api = require('../download/atex/js/production-planning.js');
var planning = api.planning;
var boundary = planning.boundaryDaySibling;
var badges = planning.daySplitBadges;

var passed = 0;
function assert(cond, name) {
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}

// Базовый сегмент задания 3690 на станке 7: сырьё M1, намотка IN, ножи [600,600,194].
function cut(over) {
    var base = {
        id: 'x', slitter: { id: '7' }, materialId: 'M1', winding: 'IN',
        knifeWidths: [600, 600, 194], orderId: '3690', planDate: '2026-06-27'
    };
    over = over || {};
    for (var k in over) if (Object.prototype.hasOwnProperty.call(over, k)) base[k] = over[k];
    return base;
}

// Цепочка одного задания, разрезанного по трём календарным дням (та же конфигурация + заказ).
var A0 = cut({ id: 'A0', planDate: '2026-06-25' });
var A1 = cut({ id: 'A1', planDate: '2026-06-26' });
var A2 = cut({ id: 'A2', planDate: '2026-06-27' });
var A3 = cut({ id: 'A3', planDate: '2026-06-28' });
// Чужое задание того же дня, что A2 (другой заказ) — не сосед по заданию.
var B  = cut({ id: 'B', orderId: '3691', planDate: '2026-06-27' });
// Тот же раскрой/заказ, но ДРУГОЙ станок — не сосед (станок входит в сигнатуру).
var F  = cut({ id: 'F', slitter: { id: '8' }, planDate: '2026-06-26' });
var all = [A0, A1, A2, A3, B, F];

// Сосед через границу дня: ближайший более ранний/поздний день той же цепочки.
assert(boundary(all, A2, -1) === A1, 'A2 ←: ближайший более ранний день цепочки = A1 (26-е, не 25-е)');
assert(boundary(all, A2, 1) === A3, 'A2 →: ближайший более поздний день цепочки = A3 (28-е)');
assert(boundary(all, A1, 1) === A2, 'A1 →: следующий день цепочки = A2');
assert(boundary(all, A1, -1) === A0, 'A1 ←: предыдущий день цепочки = A0 (25-е)');

// Края цепочки в наборе: нет более раннего/позднего соседа.
assert(boundary(all, A0, -1) === null, 'A0 ←: раньше 25-го соседа нет → null');
assert(boundary(all, A3, 1) === null, 'A3 →: позже 28-го соседа нет → null');

// Чужой заказ (B) — соседа по заданию нет ни в одном дне.
assert(boundary(all, B, -1) === null, 'B ←: нет смежного по заданию → null');
assert(boundary(all, B, 1) === null, 'B →: нет смежного по заданию → null');

// Чужой станок (F) в более раннем дне не считается соседом A2.
assert(boundary([A2, F], A2, -1) === null, 'A2 ←: сегмент другого станка не сосед → null');

// Резка без «Даты план» — дня нет, границы не определить.
assert(boundary(all, cut({ id: 'Z', planDate: '' }), -1) === null, 'нет даты плана → null');
assert(boundary([], A2, -1) === null, 'пустой набор → null');

// ── Интеграция: значок появляется при подмене недостающего соседа (как в renderQueue) ──
// Сценарий «выбран один день 27-е»: в очередь попала только A2 (idx 0 и последняя). Её
// schedDay = myDay; соседей через границу в очереди нет. С boundaryDaySibling находим A1
// слева и A3 справа и рисуем оба значка (синтетические дни myDay∓1 дают переход).
(function () {
    var myDay = 5;
    var bPrev = boundary(all, A2, -1);
    var bNext = boundary(all, A2, 1);
    var spans = badges(bPrev, bPrev ? myDay - 1 : null, A2, myDay, bNext, bNext ? myDay + 1 : null);
    assert(spans.fromPrev === true && spans.toNext === true,
        'один день (A2) с соседями в днях вне фильтра → значки и «←», и «→»');
})();

// Первый день цепочки выбран один: слева соседа нет (←), справа A2 (→).
(function () {
    var myDay = 5;
    var bPrev = boundary([A1, A2, A3, B], A1, -1);   // нет более раннего (A0 не в наборе)
    var bNext = boundary([A1, A2, A3, B], A1, 1);
    var spans = badges(bPrev, bPrev ? myDay - 1 : null, A1, myDay, bNext, bNext ? myDay + 1 : null);
    assert(spans.fromPrev === false && spans.toNext === true,
        'первый день цепочки выбран один → только «→» (продолжение дальше)');
})();

console.log('\n' + passed + ' passed');
