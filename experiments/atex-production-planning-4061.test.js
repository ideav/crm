// Unit tests for #4061 — «Гант/очередь накидывают минуты к старту заданий».
//
// Корень: ПЛАНИРОВЩИК miscalculates the next task's start. Упаковщик (buildSchedule/
// splitMachineQueue) ведёт часы в ДРОБНЫХ минутах (намотка scheduleDurationMinutes/perPass —
// дробная), и planStart резки = ceil(дробного НАКОПЛЕННОГО окна). А сохранённые колонки
// «Наладка ножей» + «Сырьё/намотка» + «Резка и Лидер» пишутся ЦЕЛЫМИ, округляя вверх (#3635 п.4,
// #3700). Поэтому старт СЛЕДУЮЩЕГО задания расходился с суммой колонок текущего, и Гант/очередь,
// пакуя встык ПО КОЛОНКАМ, «накидывали» к дню до +N минут.
//
// Фикс (#4061): snapWindowStartsWholeMinutes снапит начало окна каждой резки к целой минуте так,
// что planStart[i+1] = planStart[i] + ЦЕЛАЯ занятость[i] (= сумма колонок), а зазоры (обед/
// простой/выходной) между резками сохраняются. Упаковку/дни/колонки не трогаем.
//
// Run with: node experiments/atex-production-planning-4061.test.js

process.env.TZ = 'UTC';
var planning = require('../download/atex/js/production-planning.js').planning;
var snap = planning.snapWindowStartsWholeMinutes;
var planStartTimestamps = planning.planStartTimestamps;

var passed = 0;
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; }
    else { console.log('  expected:', JSON.stringify(expected)); console.log('  actual:  ', JSON.stringify(actual)); process.exitCode = 1; }
}
function assert(cond, name) { assertEqual(!!cond, true, name); }

// ── 1. Дрейф из скриншота #4061: дробная намотка ⇒ ceil-колонка на 1 мин больше зазора planStart.
// Станок 1 (день 0, смена с 08:00 = 480 мин): 4 целые резки, затем дробная (namotka 9.4 → «Резка
// и Лидер» = 10) — без снапа её конец 586.4 → ceil 587, а планировщик писал 586 (зазор 9). Снап
// делает окно D целым (10), старт следующей = 480+36+38+23+10 = 587, встык по колонкам.
var drift = snap([
    { ws: 480,   setup: 30, cutLeader: 6 },     // A: занятость 36
    { ws: 516,   setup: 30, cutLeader: 8 },     // B: 38
    { ws: 554,   setup: 0,  cutLeader: 23 },    // C: 23
    { ws: 577,   setup: 0,  cutLeader: 9.4 },   // D: ceil(9.4)=10  (колонка «Резка и Лидер» = 10)
    { ws: 586.4, setup: 0,  cutLeader: 12.6 }   // E: ceil(12.6)=13
]);
assertEqual(drift, [480, 516, 554, 577, 587], '#4061: окна встык по ЦЕЛЫМ колонкам (дробная намотка снапнута вверх)');
// Старт следующего = старт текущего + сумма колонок текущего (наладка+сырьё+резка/лидер).
var deltas = drift.slice(1).map(function(v, i){ return v - drift[i]; });
assertEqual(deltas, [36, 38, 23, 10], '#4061: Δ planStart = целая занятость (D = ceil(намотка)+лидер = 10, не 9)');

// ── 2. Зазоры (обед/простой) между резками СОХРАНЯЮТСЯ (не съедаются снапом).
// A занимает 100 мин от 480 (→ конец 580), следующая начата в 620 — зазор 40 (обед). После снапа
// старт B = 480 + 100 + 40 = 620.
var withGap = snap([
    { ws: 480, setup: 0, cutLeader: 100 },
    { ws: 620, setup: 0, cutLeader: 20 }
]);
assertEqual(withGap, [480, 620], '#4061: обеденный зазор (40 мин) сохранён');

// Дробная намотка перед зазором: занятость округляется вверх, зазор считается от ДРОБНОГО конца.
var fracGap = snap([
    { ws: 480,   setup: 0, cutLeader: 99.4 },   // occWhole 100, дробный конец 579.4
    { ws: 620,   setup: 0, cutLeader: 20 }       // зазор round(620-579.4)=round(40.6)=41
]);
assertEqual(fracGap, [480, 621], '#4061: зазор от дробного конца окна, занятость целая');

// ── 3. Разные ДНИ не смешиваются: первое окно каждого дня — якорь (ceil), не кумулятив.
var twoDays = snap([
    { ws: 480,  setup: 0, cutLeader: 20 },       // день 0
    { ws: 1920, setup: 0, cutLeader: 30 }        // день 1 (1440+480) — якорь, не 480+20+…
]);
assertEqual(twoDays, [480, 1920], '#4061: новый рабочий день — окно-якорь, без кумулятива с прошлого дня');

// ── 4. Регресс: целочисленное встык-расписание снап НЕ меняет (no-op).
var already = snap([
    { ws: 480, setup: 30, cutLeader: 6 },   // 36 → конец 516
    { ws: 516, setup: 0,  cutLeader: 24 },  // 24 → конец 540
    { ws: 540, setup: 0,  cutLeader: 10 }
]);
assertEqual(already, [480, 516, 540], '#4061: целочисленное расписание — снап no-op');

// ── 5. Интеграция через planStartTimestamps (buildSchedule-путь): 3 одинаковые резки с ДРОБНОЙ
// намоткой (250 м при норме 1 мин/100 м = 2.5 мин/проход, ceil 3) на одном станке. Без снапа
// накопленное дробное окно давало planStart-дельты [.., 4] (дрейф); со снапом — целая занятость
// (ceil(2.5)+лидер 2 = 5) для КАЖДОЙ пары стартов.
var BASE = Date.UTC(2026, 5, 29, 0, 0, 0);   // полночь дня плана (UTC)
function cut(id) {
    return { id: id, plannedRuns: 1, runLength: 250, materialId: 'M1', winding: 'OUT',
             knifeWidths: [100], slitter: { id: 'S1', label: 'Станок 1' } };
}
var stamps = planStartTimestamps([cut('a'), cut('b'), cut('c')], {
    windPoints: [{ m: 100, min: 1 }],           // линейная норма: 1 мин / 100 м → 250 м = 2.5 мин
    times: { MATERIAL_WINDING: 15, KNIFE: 30, KNIFE_MOVE: 2, BETWEEN_CUTS: 2 },
    runLengthByCut: { a: 250, b: 250, c: 250 },
    dayStartMin: 480, dayEndMin: 1080,
    planBaseMidnightMs: BASE
});
var order = ['a', 'b', 'c'];
var mins = order.map(function(id){ return Math.round((stamps[id] * 1000 - BASE) / 60000); });
var dMin = mins.slice(1).map(function(v, i){ return v - mins[i]; });
// Занятость каждой резки целая: setup 0 (идентичные) + ceil(2.5 намотки)=3. БЕЗ снапа накопленное
// дробное окно (480, 482.5, 485.0) давало planStart-дельты [3, 2] — 2-я на минуту короче (дрейф);
// со снапом обе пары ровно по 3 (окно каждой резки — целая минута = сумма её колонок).
assertEqual(dMin, [3, 3], '#4061: planStartTimestamps — Δ planStart одинаковы (снап убрал дрейф [3,2] → [3,3])');
assert(dMin[0] === dMin[1], '#4061: старт следующего задания не дрейфует (Δ стабильна)');

console.log('\n' + passed + ' assertions passed');
