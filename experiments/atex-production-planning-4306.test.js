// #4306 — перетаскивание задания ВНУТРИ дня (drag-drop) + предпросмотр «Пересчитать наладку».
//
// Здесь юнит-тесты ЧИСТОЙ логики перестановки planDragReorder (порядок дня задаёт planStart; при drag
// набор сохранённых времён дня переставляется под новый порядок; зафиксированные — «стены»). UI-части
// (drag-handle, панель ДО/ПОСЛЕ, кнопки Ок/Отменить, previewRecalcSetup/applyPendingRecalc) —
// контроллерные, проверяются в браузере.
//
// Run with: node experiments/atex-production-planning-4306.test.js

process.env.TZ = 'UTC';
var planning = require('../download/atex/js/production-planning.js').planning;
var planDragReorder = planning.planDragReorder;

var passed = 0;
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; } else { console.log('  expected:', JSON.stringify(expected)); console.log('  actual:  ', JSON.stringify(actual)); process.exitCode = 1; }
}

// День из 4 заданий со стартами 08:00..08:03 (сек), порядок A,B,C,D.
function day() {
    return [
        { id: 'A', planDate: 1000 },
        { id: 'B', planDate: 2000 },
        { id: 'C', planDate: 3000 },
        { id: 'D', planDate: 4000 }
    ];
}

// ── Перетащить D на позицию B (вставить ПЕРЕД B): новый порядок A, D, B, C ───────────────────────────
// Времена дня (1000,2000,3000,4000) переставляются под новый порядок: A←1000, D←2000, B←3000, C←4000.
(function () {
    var r = planDragReorder(day(), 'D', 'B');
    assertEqual(r.error, null, '#4306: перенос D→перед B без ошибки');
    // Изменились D (4000→2000), B (2000→3000), C (3000→4000); A остался 1000.
    assertEqual(r.assignments, [
        { id: 'D', planStartTs: 2000 },
        { id: 'B', planStartTs: 3000 },
        { id: 'C', planStartTs: 4000 }
    ], '#4306: набор времён дня переставлен под порядок A,D,B,C (реальные времена сохранены)');
})();

// ── Перетащить A вниз на позицию C (вставить ПЕРЕД C): порядок B, A, C? Нет — вставка ПЕРЕД C ────────
// without A = [B,C,D]; вставить A перед C (idx 1) → B, A, C, D. Времена: B←1000, A←2000, C←3000, D←4000.
(function () {
    var r = planDragReorder(day(), 'A', 'C');
    assertEqual(r.assignments, [
        { id: 'B', planStartTs: 1000 },
        { id: 'A', planStartTs: 2000 }
    ], '#4306: перенос A→перед C даёт порядок B,A,C,D (C,D не изменились)');
})();

// ── Бросок на себя / та же позиция — пустой результат без ошибки ─────────────────────────────────────
(function () {
    assertEqual(planDragReorder(day(), 'B', 'B'), { assignments: [], error: null }, '#4306: бросок на себя — ничего');
    // Перенос B перед C: without B=[A,C,D], вставить перед C → A,B,C,D — тот же порядок, пустые assignments.
    assertEqual(planDragReorder(day(), 'B', 'C').assignments, [], '#4306: перенос на соседнюю позицию без смены порядка — пусто');
})();

// ── Зафиксированные — «стены»: перенос ЧЕРЕЗ фикс запрещён ───────────────────────────────────────────
(function () {
    var d = [
        { id: 'A', planDate: 1000 },
        { id: 'F', planDate: 2000, fixed: true },   // «стена»
        { id: 'C', planDate: 3000 },
        { id: 'D', planDate: 4000 }
    ];
    // Перетащить D (за фиксом) на A (до фикса) — прошли бы ЧЕРЕЗ F → запрет.
    assertEqual(planDragReorder(d, 'D', 'A').error, 'fixed', '#4306: перенос ЧЕРЕЗ зафиксированное — ошибка fixed');
    // Перестановка ПОСЛЕ фикса (C↔D, оба справа от F) — разрешена, F не двигается.
    var ok = planDragReorder(d, 'D', 'C');
    assertEqual(ok.error, null, '#4306: перестановка справа от фикса — без ошибки');
    assertEqual(ok.assignments, [ { id: 'D', planStartTs: 3000 }, { id: 'C', planStartTs: 4000 } ],
        '#4306: C↔D переставлены, зафиксированный F (2000) не тронут');
})();

// ── Нет времени старта у задания дня → ошибка notime (подсказать «Упорядочить») ──────────────────────
(function () {
    var d = [ { id: 'A', planDate: 1000 }, { id: 'B', planDate: 0 }, { id: 'C', planDate: 3000 } ];
    assertEqual(planDragReorder(d, 'C', 'A').error, 'notime', '#4306: пустой planStart у соседа → ошибка notime');
})();

console.log('\n' + passed + ' assertions passed');
