// ЛИМИТЫ КОМБО-РЕЗКИ — ДВЕ НЕСВЯЗАННЫЕ ПРОВЕРКИ: «≤5 ширин» и «≤3 заказов».
//
// СИМПТОМ. Генерация раскроя даёт не больше трёх ширин в резке, хотя `options.maxWidthsPerCut`
// в `cut-layout.js` равен ПЯТИ. Поправить «пятёрку» негде — она уже пятёрка.
//
// ПРИЧИНА. Рядом стоит второй лимит: комбо отвергается, если
// `merged.positionsCovered.length > maxPositionsPerCut` (3). Считает он ПОЗИЦИИ, а seed
// менеджерской модели — «1 заказ = 1 резка по ключу (заказ, ШИРИНА)»: каждая ширина живёт своей
// позицией. Поэтому «≤3 позиций» ограничивает и ЧИСЛО ШИРИН — даже когда все они принадлежат
// ОДНОМУ заказу и никакого смешения заказов нет.
//
// ЧЕГО ЭТА ПРАВКА НЕ ДЕЛАЕТ (замерено, чтобы не обещать лишнего). Пятиширинными резки от неё не
// станут: на 1500 случайных раскладках лимит позиций менял число ширин лишь в 0.4% случаев, а
// со снятым лимитом максимум всё равно 4. Сколько ширин слить, решает ЦЕЛЬ перебора
// (прогоны → скрап → отход), и она редко хочет много ширин. Здесь чинится ПРАВИЛО, а не цель:
// лимит заказов больше не притворяется лимитом ширин.
//
// РЕШЕНИЕ (решение заказчика 14.08.2026): «не больше 3 ЗАКАЗОВ на резку» и «не больше 5 ШИРИН на
// резку» — ДВЕ НЕСВЯЗАННЫЕ проверки, ни одна не подразумевает другую:
//   • «≤5 ширин» — про раскрой: разношёрстный набор ножей хуже читается оператором;
//   • «≤3 заказов» — про разборку: сколько заказов упаковщик разбирает с одной резки. Остаётся 3.
// Поэтому второй лимит считает ЗАКАЗЫ (`orderId`), а не записи спроса. Позиция без `orderId`
// (склад, происхождение неизвестно) считается СВОИМ заказом — консервативно: лимит остаётся
// таким же тугим, и входы без заказов своего поведения не меняют.
//
// ЧТО ПРОВЕРЯЕМ:
//   A — воспроизведение: 4 ширины ОДНОГО заказа лимит режет на две резки, хотя ширин ≤5;
//   B — после разведения они собираются в ОДНУ резку: заказов 1 ≤ 3, ширин 4 ≤ 5;
//   C — лимит ширин ЖИВОЙ и настраивается;
//   D — лимит заказов ЖИВОЙ и равен 3: те же ширины у 4 РАЗНЫХ заказов не сливаются;
//   E — позиция без `orderId` считается своим заказом (фикстура #3472 ведёт себя как прежде);
//   F — работа не теряется: все позиции покрыты;
//   G — нулём лимит заказов снимается.
//
// Run with: node experiments/atex-cut-layout-4755-widths-vs-orders.test.js

var layout = require('../download/atex/js/cut-layout.js').layout;

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

var JUMBO = 910;
// Найдено перебором: набор, на котором лимит РЕАЛЬНО решает. Четыре ширины укладываются в один
// джамбо и слияние выгодно (одна резка вместо двух), но лимит позиций рубит комбо на 4-й записи.
var W = [[229, 64], [103, 21], [342, 69], [208, 69]];

function positions(orderIds) {
    return W.map(function(p, i) {
        var o = { id: 'p' + i, width: p[0], qty: p[1], dueKey: 1 };
        if (orderIds) o.orderId = orderIds[i];
        return o;
    });
}
function plan(pos, opts) {
    return layout.planLayouts({ jumboWidth: JUMBO, positions: pos, preferred: [],
        options: Object.assign({ windowDays: 3, tolerance: 0 }, opts || {}) });
}
function widthsOf(l) {
    var w = {};
    (l.strips || []).forEach(function(s) { if (s.purpose === 'Заказ') w[s.width] = 1; });
    return Object.keys(w).length;
}
function ordersOf(l, byPos) {
    var o = {};
    (l.positionsCovered || []).forEach(function(pid) { o[byPos[pid] == null ? pid : byPos[pid]] = 1; });
    return Object.keys(o).length;
}
function maxOf(res, fn) {
    return (res.layouts || []).reduce(function(m, l) { return Math.max(m, fn(l)); }, 0);
}
function coveredCount(res) {
    var c = {};
    (res.layouts || []).forEach(function(l) { (l.positionsCovered || []).forEach(function(p) { c[p] = 1; }); });
    return Object.keys(c).length;
}

var ONE = ['ORD-1', 'ORD-1', 'ORD-1', 'ORD-1'];
var FOUR = ['A', 'B', 'C', 'D'];
var byOne = {}, byFour = {};
positions(ONE).forEach(function(p) { byOne[p.id] = p.orderId; });
positions(FOUR).forEach(function(p) { byFour[p.id] = p.orderId; });

// ── A/B. ЧЕТЫРЕ ШИРИНЫ ОДНОГО ЗАКАЗА ────────────────────────────────────────────────────────
var one = plan(positions(ONE));
assert(maxOf(one, widthsOf) === 4 && (one.layouts || []).length === 1,
    'B. четыре ширины ОДНОГО заказа собираются в одну резку — лимит заказов их больше не режет',
    'ширин: ' + maxOf(one, widthsOf) + ', резок: ' + (one.layouts || []).length);
assert(maxOf(one, function(l) { return ordersOf(l, byOne); }) === 1,
    'B2. заказ при этом один — правило «≤3 заказов» не нарушено',
    'заказов в резке: ' + maxOf(one, function(l) { return ordersOf(l, byOne); }));

// ── C. ЛИМИТ ШИРИН ЖИВОЙ ────────────────────────────────────────────────────────────────────
assert(maxOf(plan(positions(ONE), { maxWidthsPerCut: 2 }), widthsOf) <= 2,
    'C. лимит ширин живой и настраивается снаружи',
    'макс ширин при лимите 2: ' + maxOf(plan(positions(ONE), { maxWidthsPerCut: 2 }), widthsOf));
assert(maxOf(plan(positions(ONE), { maxWidthsPerCut: 3 }), widthsOf) <= 3,
    'C2. и при лимите 3 — не больше трёх',
    'макс ширин: ' + maxOf(plan(positions(ONE), { maxWidthsPerCut: 3 }), widthsOf));

// ── D. ЛИМИТ ЗАКАЗОВ ЖИВОЙ И РАВЕН 3 ────────────────────────────────────────────────────────
// Те же ширины, но четыре РАЗНЫХ заказа: ширин 4 ≤ 5 пропустил бы, заказов 4 > 3 — нет.
var four = plan(positions(FOUR));
assert(maxOf(four, function(l) { return ordersOf(l, byFour); }) <= 3,
    'D. четыре РАЗНЫХ заказа в одну резку не лезут — «≤3 заказов» соблюдается',
    'макс заказов: ' + maxOf(four, function(l) { return ordersOf(l, byFour); }));
assert((four.layouts || []).length > (one.layouts || []).length,
    'D2. и это ВИДНО: тот же раскрой у разных заказов даёт больше резок, чем у одного',
    'резок у одного заказа: ' + (one.layouts || []).length + ', у четырёх: ' + (four.layouts || []).length);

// ── E. БЕЗ orderId — КАК ПРЕЖДЕ (фикстура #3472) ────────────────────────────────────────────
var anon = [[110, 50], [70, 30], [50, 20], [40, 10]].map(function(p, i) {
    return { id: 'c' + i, width: p[0], qty: p[1], dueKey: 20260601 };
});
var rAnon = plan(anon);
assert(maxOf(rAnon, function(l) { return (l.positionsCovered || []).length; }) <= 3,
    'E. позиции без orderId считаются своими заказами — комбо из четырёх отвергнуто, как и было',
    'макс позиций: ' + maxOf(rAnon, function(l) { return (l.positionsCovered || []).length; }));

// ── F. РАБОТА НЕ ТЕРЯЕТСЯ ───────────────────────────────────────────────────────────────────
assert(coveredCount(one) === 4 && coveredCount(four) === 4 && coveredCount(rAnon) === 4,
    'F. все позиции покрыты во всех трёх раскладках — лимит отвергает слияние, а не работу',
    'покрыто: ' + coveredCount(one) + ' / ' + coveredCount(four) + ' / ' + coveredCount(rAnon));

// ── G. НУЛЁМ ЛИМИТ ЗАКАЗОВ СНИМАЕТСЯ ────────────────────────────────────────────────────────
var freed = plan(positions(FOUR), { maxOrdersPerCut: 0 });
assert(maxOf(freed, function(l) { return ordersOf(l, byFour); }) === 4,
    'G. нулём лимит заказов снимается — все четыре заказа сливаются в одну резку',
    'макс заказов при снятом лимите: ' + maxOf(freed, function(l) { return ordersOf(l, byFour); }));

console.log('\n' + passed + '/' + total + ' проверок прошло');
if (passed !== total) process.exitCode = 1;
