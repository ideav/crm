// Unit tests for #3613 — значок перехода задания на следующий/предыдущий рабочий день.
// Задание, не влезшее в рабочий день, нормально дробить по дням. На первой и последней
// карточке такой цепочки рисуется значок смежности.
//
// ПРИЗНАК СМЕЖНОСТИ ИЗМЕНЁН (решение заказчика 31.07.2026): это ЯВНЫЙ «ID первой части» (#3892),
// а не совпадение конфигурации (станок|сырьё|намотка|ножи) и заказа. Конфигурация у РАЗНЫХ заданий
// совпадает сплошь и рядом, и значок вставал у соседей, которые одним заданием никогда не были.
//
// Run with: node experiments/atex-production-planning-3613.test.js

process.env.TZ = 'UTC';

var api = require('../download/atex/js/production-planning.js');
var planning = api.planning;
var sibling = planning.isDaySplitSibling;

var passed = 0;
function assert(cond, name) {
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}

// Базовый сегмент: станок 7, сырьё M1, намотка IN, ножи [600,600,194], заказ 3690.
function cut(over) {
    var base = {
        id: '1', slitter: { id: '7' }, materialId: 'M1', winding: 'IN',
        knifeWidths: [600, 600, 194], orderId: '3690', firstPartId: 'H1'
    };
    over = over || {};
    for (var k in over) if (Object.prototype.hasOwnProperty.call(over, k)) base[k] = over[k];
    return base;
}

// Общий «ID первой части» → один разрезанный по дням задание.
assert(sibling(cut(), cut({ id: '2' })) === true,
    'общий «ID первой части» → смежные сегменты одного задания');

// Конфигурация на признак больше НЕ влияет — ни в одну сторону.
assert(sibling(cut(), cut({ id: '2', knifeWidths: [194, 600, 600] })) === true,
    'тот же маркер при любом порядке ножей → всё ещё смежные');
assert(sibling(cut(), cut({ id: '2', materialId: 'M2' })) === true,
    'тот же маркер при другом сырье → смежные (это одно задание, разрезанное по дням)');

// Разные маркеры → разные задания, чем бы они ни были похожи.
assert(sibling(cut(), cut({ id: '2', firstPartId: 'H2' })) === false,
    'другой «ID первой части» → НЕ смежные');
assert(sibling(cut({ firstPartId: '' }), cut({ id: '2', firstPartId: '' })) === false,
    'маркера нет ни у кого → НЕ смежные (по конфигурации больше не гадаем)');
assert(sibling(cut(), cut({ id: '2', firstPartId: '' })) === false,
    'маркер только у одного → НЕ смежные');

// Защита от null/undefined.
assert(sibling(null, cut()) === false, 'null слева → false');
assert(sibling(cut(), undefined) === false, 'undefined справа → false');

// ── daySplitBadges: какие значки на карточке очереди (по соседям через границу дня) ──
var badges = planning.daySplitBadges;

// Очередь станка: задание A разрезано на 3 рабочих дня (заказ 3690), затем чужое
// задание B на 3-й день (заказ 3691), затем чужое C на 4-й день (заказ 3692).
// Имитируем расписание: каждой карточке — её день (schedDay).
var A1 = cut({ id: 'A1' }), A2 = cut({ id: 'A2' }), A3 = cut({ id: 'A3' });
// B и C — ЧУЖИЕ задания: у каждого свой «ID первой части» (конфигурация может совпадать с A —
// на признак смежности она больше не влияет).
var B  = cut({ id: 'B', orderId: '3691', firstPartId: 'HB' });
var C  = cut({ id: 'C', orderId: '3692', firstPartId: 'HC' });
var queue = [
    { c: A1, day: 0 },
    { c: A2, day: 1 },
    { c: A3, day: 2 },
    { c: B,  day: 2 },
    { c: C,  day: 3 }
];
function badgesAt(i) {
    var prev = queue[i - 1], cur = queue[i], next = queue[i + 1];
    return badges(
        prev ? prev.c : undefined, prev ? prev.day : null,
        cur.c, cur.day,
        next ? next.c : undefined, next ? next.day : null
    );
}

// A1 — первая карточка цепочки: продолжение в следующем дне (→), начала в прошлом нет.
assert(badgesAt(0).fromPrev === false && badgesAt(0).toNext === true,
    'A1 (первый день цепочки): только «→» (продолжение завтра)');

// A2 — середина цепочки (одна на свой день): и «←», и «→».
assert(badgesAt(1).fromPrev === true && badgesAt(1).toNext === true,
    'A2 (середина цепочки): и «←», и «→»');

// A3 — последняя карточка цепочки: пришла из прошлого дня (←); сосед справа B — тот же
// день и другое задание, продолжения нет.
assert(badgesAt(2).fromPrev === true && badgesAt(2).toNext === false,
    'A3 (последний день цепочки): только «←» (началось вчера)');

// B — чужое задание того же дня, что A3: ни один сосед не смежен → без значков.
assert(badgesAt(3).fromPrev === false && badgesAt(3).toNext === false,
    'B (чужой заказ, тот же день): без значков');

// C — чужое задание следующего дня (свой маркер, не как у B) → без значков.
assert(badgesAt(4).fromPrev === false && badgesAt(4).toNext === false,
    'C (чужой заказ, другой день): без значков');

// Карточка без расписания (myDay == null) — значков нет (защита).
assert(badges(A1, 0, A2, null, A3, 2).fromPrev === false &&
       badges(A1, 0, A2, null, A3, 2).toNext === false,
    'нет расписания у карточки (myDay==null) → без значков');

// Соседи в том же дне (нет границы) — значков нет даже у смежных по заданию.
assert(badges(A1, 0, A2, 0, A3, 0).fromPrev === false &&
       badges(A1, 0, A2, 0, A3, 0).toNext === false,
    'соседи в одном дне → без значков (нет перехода через день)');

console.log('\n' + passed + ' passed');
