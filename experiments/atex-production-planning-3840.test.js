// Unit tests for #3840 — «Образовался перерыв из-за перемещения срочных задач — надо схлопывать».
//
// Перенос срочной резки на другой день/станок (moveCutToDay) и удаление одной резки из середины
// дня (runDeleteCutTask) НЕ пересобирали станок-источник: прочие резки дня сохраняли прежний
// planStart, и на месте вынутой резки оставался простой. РМ «Диаграмма Ганта (задания)» рисует
// СОХРАНЁННЫЙ planStart, поэтому дыра была видна (на странице планирования очередь
// пересчитывается live через buildSchedule и выглядела упакованной — расхождение экранов).
//
// Фикс (#3840): после переноса/удаления вызывается autoSequenceQueue(preserveOrder=true) —
// пересчёт расписания (splitMachineQueue/buildSchedule с gapFill) пакует день ВСТЫК и сохраняет
// planStart. Эти тесты — гард ДВИЖКА, на который опирается фикс: при удалении резки из середины
// дня и пересчёте очереди последующие резки СДВИГАЮТСЯ ВЛЕВО (заполняют дыру), а день остаётся
// без простоя. Саму проводку (что move/delete теперь зовут autoSequenceQueue) проверяет E2E.
//
// Run with: node experiments/atex-production-planning-3840.test.js

process.env.TZ = 'UTC';
var planning = require('../download/atex/js/production-planning.js').planning;

var passed = 0;
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; }
    else { console.log('  expected:', JSON.stringify(expected)); console.log('  actual:  ', JSON.stringify(actual)); process.exitCode = 1; }
}
function assert(cond, name) { assertEqual(!!cond, true, name); }

// Рабочее окно смены: 08:00 (480) … 16:30 (990) — ёмкость 510 мин.
var DAY_START = 480, DAY_END = 990;
// Резки одной конфигурации (одно сырьё/намотка/ножи) → переналадка между ними = 0,
// чтобы геометрия дня была наглядной (простой, если он есть, виден сразу). Лидер 0.
function cut(id) {
    return { id: id, materialId: 'M', winding: 'IN', batchId: 'b',
        knifeCount: 1, knifeWidths: [30], rollerWidth: 0, isFoil: false, plannedRuns: 10 };
}
// 10 проходов × 5 мин = 50 мин намотки на резку; 4 резки = 200 мин ≤ 510 → один день.
var PER_PASS = {}, RUNS = {};
['U', 'A', 'B', 'C'].forEach(function(id) { PER_PASS[id] = 5; RUNS[id] = 10; });
var DUR = 50;

function schedule(cuts) {
    return planning.splitMachineQueue(cuts, {
        dayStartMin: DAY_START, dayEndMin: DAY_END,
        leader: 0, perPassByCut: PER_PASS, runsByCut: RUNS,
        gapFill: true   // #3739: как в очереди/генерации
    });
}
// Карта cutId → windowStartMin (начало занятости резки в минутах от полуночи).
function startsById(segs) {
    var m = {};
    segs.forEach(function(s) { m[s.cutId] = s.windowStartMin; });
    return m;
}
// Есть ли простой между соседними сегментами дня (встык: ws[i+1] == ws[i] + setup[i] + dur[i]).
function idleGaps(segs) {
    var gaps = [];
    for (var i = 1; i < segs.length; i++) {
        var prevEnd = segs[i - 1].windowStartMin + segs[i - 1].setupMin + segs[i - 1].durationMin;
        if (segs[i].dayOffset === segs[i - 1].dayOffset && segs[i].windowStartMin > prevEnd) {
            gaps.push({ after: segs[i - 1].cutId, before: segs[i].cutId, gap: segs[i].windowStartMin - prevEnd });
        }
    }
    return gaps;
}

// ── Базовый день: 4 резки встык от 08:00, без простоя ───────────────────────────────────────
var full = schedule([cut('U'), cut('A'), cut('B'), cut('C')]);
var sFull = startsById(full);
assertEqual([sFull.U, sFull.A, sFull.B, sFull.C], [480, 530, 580, 630],
    '#3840: исходный день — 4 резки встык от 08:00 (U,A,B,C)');
assertEqual(idleGaps(full), [], '#3840: в исходном дне простоя нет');

// ── Срочную U вынули из СЕРЕДИНЫ дня (перенос/удаление) и пересобрали очередь ────────────────
// Было: U=480, A=530, B=580, C=630. Стало (U ушла): A,B,C должны СДВИНУТЬСЯ ВЛЕВО и встать
// встык от 08:00 — иначе на месте U (480..530) остаётся дыра (баг #3840).
var afterMove = schedule([cut('A'), cut('B'), cut('C')]);
var sMove = startsById(afterMove);
assertEqual([sMove.A, sMove.B, sMove.C], [480, 530, 580],
    '#3840: после изъятия срочной резки очередь схлопнута встык от 08:00');
assertEqual(idleGaps(afterMove), [], '#3840: после изъятия простоя в дне нет');
assert(sMove.A < sFull.A + 1 && sMove.B < sFull.B && sMove.C < sFull.C,
    '#3840: A осталась в начале, B и C сдвинулись раньше (дыра закрыта)');

// ── Изъятие резки из НАЧАЛА дня — остальные тоже встают от 08:00 ─────────────────────────────
var afterHead = schedule([cut('A'), cut('B'), cut('C')]);  // U была первой → A теперь от 480
assertEqual(startsById(afterHead).A, 480, '#3840: изъятие резки из начала дня — следующий встаёт на 08:00');

console.log('\n' + passed + ' проверок прошло.');
