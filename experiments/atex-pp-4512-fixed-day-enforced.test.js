// 🔒 НЕ ВЫТЕСНЯЕТСЯ — в исполняемой форме (issue #4511/#4512/#4513, ТЗ §15).
//
// ЗАЧЕМ. Решение заказчика 30.07.2026: «Не вытеснять и не переносить зафиксированные задания из дня —
// НИ ПРИ КАКИХ ОБСТОЯТЕЛЬСТВАХ». PR #4514 реализовал это в УПАКОВЩИКЕ (`splitMachineQueue`: 🔒
// возвращается в свой день, день вправе уйти за потолок). Но в реестре инвариантов правило осталось
// НАБЛЮДАТЕЛЕМ (`FIXED_CUT_DAY`, `mode: 'audit'`), а причина наблюдения — «законный переезд не
// отделён от настоящего нарушения» — устарела ровно с #4514: теперь законный случай ОДИН и он
// назван движком явно (`onFixedDayLost` → `ops.fixedDayLost`, «день физически нерабочий»).
//
// Симптом до правила: #4513 — «зафиксированный в 30.07 паровоз заданий был целиком выкинут в 31.07
// ради нескольких незафиксированных», причём с ложным вердиктом «день нерабочий» про обычную
// пятницу. Тикеты #4511/#4512/#4513 сообщают об одном и том же в третий раз, потому что правило
// живёт в упаковщике и в прозе §15, а не в шлюзе: любой ДРУГОЙ путь записи его не соблюдает.
//
// ЧТО ЗДЕСЬ ПРОВЕРЯЕТСЯ (то, чего не проверял никто):
//   • правило исполняемо: у FIXED_CUT_DAY режим 'drop' и свой предикат отбрасывания;
//   • автоматика НЕ вправе увезти 🔒 в другой день — операция не доходит до записи;
//   • ЕДИНСТВЕННОЕ исключение — вердикт движка «день физически нерабочий» (ops.fixedDayLost);
//   • оператор не ограничен (ТЗ §15) — ручное действие проходит;
//   • пересчёт времени старта ВНУТРИ своего дня разрешён;
//   • DAY_CAPACITY не ругается на день, который ушёл за потолок ИЗ-ЗА неснимаемой 🔒 (иначе после
//     #4514 оператор получает ложное «день длиннее смены» на каждом таком дне — сообщения стража
//     видны ему с #4475).
//
// Run with: node experiments/atex-pp-4512-fixed-day-enforced.test.js

process.env.TZ = 'UTC';
global.window = { db: 'testdb', xsrf: 'x' };
var planning = require('../download/atex/js/production-planning.js').planning;

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

// ── Фикстура ────────────────────────────────────────────────────────────────────────────────
// Задание 10 — 🔒 в дне 20260730. Задание 11 — 🔒 в том же дне, и его замок движок СНЯЛ законно
// (день физически нерабочий). Задание 12 — свободное.
var DAY_A = 20260730, DAY_B = 20260731;
var TS_A = Math.floor(Date.UTC(2026, 6, 30, 8, 0, 0) / 1000);
var TS_A_LATE = Math.floor(Date.UTC(2026, 6, 30, 14, 0, 0) / 1000);
var TS_B = Math.floor(Date.UTC(2026, 6, 31, 8, 0, 0) / 1000);
function dayKeyOf(ts) {
    var d = new Date(Number(ts) * 1000);
    return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
}
var FIXED = { '10': true, '11': true }, CUT_DAY = { '10': DAY_A, '11': DAY_A, '12': DAY_A };
// Вердикт движка: замок снят законно только у 11 (ops.fixedDayLost).
var RELEASED = { '11': true };

function ctxWith(extra) {
    var c = {
        isFixedCut: function(id) { return !!FIXED[String(id)]; },
        isFrozenCut: function() { return false; },
        isFrozenTs: function() { return false; },
        dayKeyOfCut: function(id) { return CUT_DAY[String(id)] == null ? null : CUT_DAY[String(id)]; },
        dayKeyOfTs: function(ts) { return dayKeyOf(ts); },
        // #4512: «замок снят законно» — вердикт УПАКОВЩИКА, а не пересчёт в страже.
        isFixedReleasedCut: function(id) { return !!RELEASED[String(id)]; }
    };
    Object.keys(extra || {}).forEach(function(k) { c[k] = extra[k]; });
    return c;
}

var inv = {};
(planning.invariants || []).forEach(function(r) { if (r && r.id) inv[r.id] = r; });

// 1. Правило исполняемо.
assert(inv.FIXED_CUT_DAY && inv.FIXED_CUT_DAY.mode === 'drop',
    'FIXED_CUT_DAY: режим drop (правило исполняется, а не только считается)',
    'mode=' + (inv.FIXED_CUT_DAY && inv.FIXED_CUT_DAY.mode));
assert(inv.FIXED_CUT_DAY && typeof inv.FIXED_CUT_DAY.drop === 'function',
    'FIXED_CUT_DAY: несёт свой предикат drop');

// 2. Автоматика увозит 🔒 в другой день — операция отбрасывается.
var ops = { updates: [{ cutId: '10', planStartTs: TS_B }], deletes: [], creates: [] };
var r = planning.guardPlanOps(ops, ctxWith(), 'auto');
assert(r.skipped === 1 && r.ops.updates.length === 0,
    '🔒 в другой день: операция автоматики НЕ доходит до записи',
    'skipped=' + r.skipped + ' осталось=' + r.ops.updates.length);
assert(r.violations.some(function(v) { return v.rule === 'FIXED_CUT_DAY' && String(v.cutId) === '10'; }),
    'нарушение FIXED_CUT_DAY названо в отчёте');

// 3. Удаление 🔒 автоматикой — тоже запрет.
var opsDel = { updates: [], deletes: ['10'], creates: [] };
var rDel = planning.guardPlanOps(opsDel, ctxWith(), 'auto');
assert(rDel.skipped === 1 && rDel.ops.deletes.length === 0,
    'удаление 🔒 автоматикой отброшено', 'skipped=' + rDel.skipped);

// 4. ЕДИНСТВЕННОЕ исключение: движок сам снял замок — день физически нерабочий.
var opsRel = { updates: [{ cutId: '11', planStartTs: TS_B }], deletes: [], creates: [] };
var rRel = planning.guardPlanOps(opsRel, ctxWith(), 'auto');
assert(rRel.skipped === 0 && rRel.ops.updates.length === 1,
    'замок снят движком законно (нерабочий день) — переезд проходит',
    'skipped=' + rRel.skipped);

// 5. Оператор не ограничен (ТЗ §15).
var opsHuman = { updates: [{ cutId: '10', planStartTs: TS_B }], deletes: [], creates: [] };
var rHuman = planning.guardPlanOps(opsHuman, ctxWith(), 'human');
assert(rHuman.skipped === 0 && rHuman.ops.updates.length === 1,
    'ручной перенос 🔒 страж не отбрасывает', 'skipped=' + rHuman.skipped);

// 6. Пересчёт времени старта ВНУТРИ своего дня разрешён (переезд запрещён, сдвиг — нет).
var opsSame = { updates: [{ cutId: '10', planStartTs: TS_A_LATE }], deletes: [], creates: [] };
var rSame = planning.guardPlanOps(opsSame, ctxWith(), 'auto');
assert(rSame.skipped === 0 && rSame.ops.updates.length === 1,
    '🔒 сдвинулась внутри своего дня — это не переезд, проходит', 'skipped=' + rSame.skipped);

// 7. Свободное задание автоматика вправе увезти — вытеснять надо именно его (#4511).
var opsFree = { updates: [{ cutId: '12', planStartTs: TS_B }], deletes: [], creates: [] };
var rFree = planning.guardPlanOps(opsFree, ctxWith(), 'auto');
assert(rFree.skipped === 0 && rFree.ops.updates.length === 1,
    'незафиксированное задание вытесняется свободно (#4511)', 'skipped=' + rFree.skipped);

// ── DAY_CAPACITY: перебор из-за неснимаемой 🔒 — не нарушение ────────────────────────────────
// После #4514 день с 🔒, которую некуда увезти, ЗАКОННО уходит за потолок. Аудит обязан молчать:
// иначе оператор получает «день длиннее смены» на каждом таком дне (сообщения стража видны с #4475).
var CAP = 460;
var capCtx = ctxWith({
    dayCapacityMin: function() { return CAP; },
    dayLoadMinutes: function() {
        var m = {};
        m['7|' + DAY_A] = 610;   // перебор ЗАКОННЫЙ: в дне неснимаемая 🔒
        m['7|' + DAY_B] = 500;   // перебор обычный — о нём говорить надо
        return m;
    },
    // Станко-дни, где упаковщик ОСТАВИЛ 🔒 в своём дне (вердикт движка, ops.fixedDayHeld).
    fixedHeldDays: function() { return ['7|' + DAY_A]; }
});
var capOps = { updates: [], deletes: [], creates: [] };
var rCap = planning.guardPlanOps(capOps, capCtx, 'auto');
var capViol = rCap.violations.filter(function(v) { return v.rule === 'DAY_CAPACITY'; });
assert(!capViol.some(function(v) { return Number(v.dayKey) === DAY_A; }),
    'DAY_CAPACITY молчит о дне, который ушёл за потолок ИЗ-ЗА неснимаемой 🔒',
    'нарушения по дням=' + JSON.stringify(capViol.map(function(v) { return v.dayKey; })));
assert(capViol.some(function(v) { return Number(v.dayKey) === DAY_B; }),
    'DAY_CAPACITY по-прежнему ловит обычный перебор (день без удержанной 🔒)',
    'нарушения по дням=' + JSON.stringify(capViol.map(function(v) { return v.dayKey; })));

console.log('\n' + passed + '/' + total + ' проверок прошло');
if (passed !== total) process.exitCode = 1;
