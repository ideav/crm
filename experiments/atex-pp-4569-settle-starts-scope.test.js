// Tests for ideav/crm#4569 — «⏱ 07:59 – 09:53 · 114 мин — почему 07:59?»
//
// 07:59 — это ПЛЕЙСХОЛДЕР порядка, который ставит «Урегулировать» («минута назад от следующего
// задания станка», #4346). Заменить его реальными минутами должна пересборка, но она может не
// переписать задание вовсе: страж снимает операции цепочки ЦЕЛИКОМ, если часть их отбросило
// правило (#4536 после #4436 «замороженные дни не трогаем»). Тогда запись остаётся с прежним
// временем — а у ТОЛЬКО ЧТО СОЗДАННОГО остатка прежнего времени нет, есть плейсхолдер.
//
// Боевое (ateh, 04.08.2026, Станок 1): 657439 → 07:59 (плейсхолдер), 655485 → 08:00 (своё старое),
// 652452 → 09:09 (единственное, что переписала пересборка). Три задания внахлёст.
//
// КОРЕНЬ ВТОРОГО ПОРЯДКА: сведе́ние честных стартов (`reconcilePlanStarts` → `recalcScopeCutIds`,
// #4408/#4438) ограничено ВИДИМЫМ диапазоном фильтра [С;По], а запись плана — нет (#3974).
// «Урегулировать» ставит остаток перед следующим заданием станка, и оно может стоять в любом дне:
// день, куда уехала работа, за фильтр не попадал и оставался несведённым.
//
// ПРАВИЛА (решения заказчика 02.08.2026):
//   • вызывающий, который САМ унёс работу за фильтр, называет эти дни (`opts.dayKeys`) — они входят
//     в набор пересчёта помимо диапазона. Замороженный день в ПЕРЕСЧЁТ СТАРТОВ не входит: тот идёт
//     по всей очереди станка и чужих заданий замороженного дня касаться не вправе;
//   • РУЧНОЕ ДЕЙСТВИЕ СИЛЬНЕЕ ЗАМОРОЗКИ: операции по заданиям, которые оператор несёт сам, страж не
//     отбрасывает. «Урегулировать» — однозначная команда «сдвинуть всё», и половинчатый результат
//     («тут сдвинули, а там не смогли») недопустим.
//
// Run with: node experiments/atex-pp-4569-settle-starts-scope.test.js

process.env.TZ = 'Europe/Moscow';

global.document = {
    createElement: function() { return { style: {}, classList: { add: function() {}, remove: function() {}, contains: function() { return false; } },
        appendChild: function() {}, addEventListener: function() {}, setAttribute: function() {} }; },
    body: {}, readyState: 'loading', getElementById: function() { return null; }, addEventListener: function() {}
};
global.window = { db: 'testdb' };

var Controller = require('../download/atex/js/production-planning.js').Controller;

var passed = 0, total = 0;
function assertEqual(actual, expected, name) {
    total++;
    var a = JSON.stringify(actual), e = JSON.stringify(expected);
    var ok = a === e;
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name + (ok ? '' : ' (ожидалось ' + e + ', получено ' + a + ')'));
    if (ok) passed++; else process.exitCode = 1;
}

function tsAt(y, m, d, hh, mm) { return Math.floor(new Date(y, m - 1, d, hh, mm, 0, 0).getTime() / 1000); }

// Очередь Станка 1: по заданию в трёх днях. Фильтр показывает ТОЛЬКО 02.08.
// 03.08 заморожен — как в боевой ateh (запись «Заморозки» 656165).
function makeController() {
    var c = Object.create(Controller.prototype);
    c.meta = { cut: { id: '1078' }, freeze: { id: '633483' } };
    c.freezeByDay = { 20260803: { id: '656165' } };
    c.filter = { date: '2026-08-02', dateTo: '2026-08-02' };
    c.cuts = [
        { id: 'visible', slitter: { id: '1' }, planDate: String(tsAt(2026, 8, 2, 8, 0)) },
        { id: 'frozen',  slitter: { id: '1' }, planDate: String(tsAt(2026, 8, 3, 8, 0)) },
        { id: 'faraway', slitter: { id: '1' }, planDate: String(tsAt(2026, 8, 4, 7, 59)) },   // остаток с плейсхолдером
        { id: 'other',   slitter: { id: '2' }, planDate: String(tsAt(2026, 8, 4, 8, 0)) }
    ];
    return c;
}

// ── 1. Было: пересчёт видит только видимый диапазон ──────────────────────────
(function() {
    var c = makeController();
    assertEqual(c.recalcScopeCutIds('1'), ['visible'],
        'без названных дней в набор входит только видимый диапазон [С;По]');
    assertEqual(c.recalcScopeCutIds('1').indexOf('faraway'), -1,
        '#4569 КОРЕНЬ: день, куда «Урегулировать» унесло остаток, за фильтром — и старты там не сводились');
})();

// ── 2. Стало: названный день входит в набор ─────────────────────────────────
(function() {
    var c = makeController();
    var ids = c.recalcScopeCutIds('1', { dayKeys: [20260804] });
    assertEqual(ids.sort(), ['faraway', 'visible'],
        '#4569 названный день входит в пересчёт помимо диапазона');
    assertEqual(ids.indexOf('other'), -1, 'чужой станок в набор не попадает (правило прежнее)');
})();

// ── 3. Замороженный день не входит, даже если его назвали ───────────────────
(function() {
    var c = makeController();
    var ids = c.recalcScopeCutIds('1', { dayKeys: [20260803, 20260804] });
    assertEqual(ids.indexOf('frozen'), -1,
        '#4436 старше: замороженный день не трогает НИКАКОЙ пересчёт, даже названный явно');
    assertEqual(ids.sort(), ['faraway', 'visible'], 'остальные названные дни при этом работают');
})();

// ── 4. Пустой/отсутствующий список ничего не меняет ─────────────────────────
(function() {
    var c = makeController();
    assertEqual(c.recalcScopeCutIds('1', { dayKeys: [] }), ['visible'], 'пустой список дней — поведение прежнее');
    assertEqual(c.recalcScopeCutIds('1', {}), ['visible'], 'opts без dayKeys — поведение прежнее');
})();

// ── 5. Дни, названные «Урегулировать», покрывают ОБЕ части разделения ────────
(function() {
    var c = makeController();
    // Тот же набор, что собирает settleTouchedDayKeys: перенос + выполненная часть + остаток.
    var moves = [{ id: 'm1', planStart: tsAt(2026, 8, 2, 8, 0) }];
    var splits = [{ id: 's1', donePlanStart: tsAt(2026, 8, 1, 8, 0), restPlanStart: tsAt(2026, 8, 4, 7, 59) }];
    c.cuts.push({ id: 'factday', slitter: { id: '1' }, planDate: String(tsAt(2026, 8, 1, 8, 0)) });
    var keys = [];
    [].concat(moves.map(function(m) { return m.planStart; }),
              splits.map(function(s) { return s.donePlanStart; }),
              splits.map(function(s) { return s.restPlanStart; })).forEach(function(ts) {
        var d = new Date(ts * 1000);
        keys.push(d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate());
    });
    var ids = c.recalcScopeCutIds('1', { dayKeys: keys });
    assertEqual(ids.sort(), ['factday', 'faraway', 'visible'],
        '#4569 в пересчёт входят и день выполненной части, и день остатка — обе половины разделения');
})();

// ── 6. #4569: ручное действие сильнее заморозки — операции «Урегулировать» не отбрасываются ──
// Решение заказчика 02.08.2026. «Урегулировать» — однозначная команда «сдвинуть всё»; отказ
// означал бы половинчатый результат, а страж снимает операции цепочки ЦЕЛИКОМ (#4536).
(function() {
    var planning = require('../download/atex/js/production-planning.js').planning;
    var TS_FROZEN = Math.floor(new Date(2026, 7, 3, 8, 0, 0, 0).getTime() / 1000);   // 03.08 — заморожен
    function ctx(manualIds) {
        var manual = {};
        (manualIds || []).forEach(function(id) { manual[String(id)] = true; });
        return {
            isFrozenCut: function(id) { return String(id) === 'INFROZEN'; },
            isFrozenTs: function(ts) { return Number(ts) === TS_FROZEN; },
            isFixedCut: function() { return false; },
            isManualMoveCut: function(id) { return !!manual[String(id)]; },
            dayKeyOfCut: function() { return null; },
            dayKeyOfTs: function() { return null; }
        };
    }
    // Остаток, созданный «Урегулировать», едет В замороженный день — команда оператора проходит.
    var mine = { updates: [{ cutId: 'REST', planStartTs: TS_FROZEN, plannedRuns: 18 }], creates: [], deletes: [] };
    var r = planning.guardPlanOps(mine, ctx(['REST']), 'auto');
    assertEqual(mine.updates.length, 1, '#4569 операция ручного действия НЕ отброшена (ручное сильнее заморозки)');
    assertEqual(r.skipped, 0, '#4569 отказов нет — команда выполняется целиком');

    // Та же операция БЕЗ пометки «ручное» — отброшена, как и раньше: автоматика в заморозку не лезет.
    var auto = { updates: [{ cutId: 'REST', planStartTs: TS_FROZEN, plannedRuns: 18 }], creates: [], deletes: [] };
    var r2 = planning.guardPlanOps(auto, ctx([]), 'auto');
    assertEqual(auto.updates.length, 0, 'автоматика в замороженный день по-прежнему не кладёт');
    assertEqual(r2.skipped > 0, true, 'и это по-прежнему считается отброшенным');
})();

console.log('\n' + passed + '/' + total + ' passed');
if (passed !== total) process.exitCode = 1;
