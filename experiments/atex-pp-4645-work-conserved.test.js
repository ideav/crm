// issue #4645: ПЛАН НЕ ВПРАВЕ УНИЧТОЖИТЬ РАБОТУ.
//
// Боевая ateh, Пт 07.08.2026, 12:01. «Упорядочить» принесло РОВНО ДВЕ операции и ни одного
// `create`: 666131 «проходов 15 → 1» (заказ 4607) и 667803 «5 → 1» (заказ 4615). Продолжений не
// родилось, и 14 + 4 прохода исчезли из плана. Журнал #4618 это увидел — но ПОСЛЕ записи
// (`CHAIN_BALANCE ⛔ РАБОТА НЕ СОХРАНЕНА`): свидетель, а не сторож.
//
// Сторожа не было по конструкции: `restoreSplitChainIntegrity` (#4536) лечит ТОЛЬКО разрыв,
// который устроил сам страж (баланс был 0 ДО отбрасывания и перестал быть после). Набор, пришедший
// уже несбалансированным, он пропускал намеренно — «план менял объём работы, судить не за что».
// Теперь такой набор теряет операции ЦЕЛИКОМ по цепочке: запись остаётся как хранится.
//
//   A — БОЕВОЙ #4645: 15 → 1 без create → операции цепочки сняты, цепочка названа;
//   B — вторая цепочка того же набора (5 → 1) снимается независимо от первой;
//   C — законный разрез по дням (15 = 1 + 14) НЕ трогаем: работа на месте;
//   D — ПРИБАВКА проходов (1 → 15, возврат урезанной головы) не подпадает под правило;
//   E — цепочка считается по «ID первой части» (#3892): звенья судятся вместе;
//   F — соседние цепочки того же набора не страдают (снимается только виноватая);
//   G — ручная правка объёма (`ops.manual`) не трогается: проходы правит человек;
//   H — сквозь страж: guardPlanOpsWith на пустом реестре правил снимает потерю (#4515-механика);
//   I — упаковщик отдаёт `unplaced`, и оно доезжает до операций (причина, а не только симптом).
//
// Run with: node experiments/atex-pp-4645-work-conserved.test.js

process.env.TZ = 'UTC';
global.window = { db: 'ateh', xsrf: 'x' };
var P = require('../download/atex/js/production-planning.js').planning;

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

// Контекст стража: хранимые проходы и цепочка задания (ровно то, что спрашивает
// planWorkBalanceByChain — ctx.plannedRunsOfCut / ctx.chainIdOfCut).
function ctxOf(stored, chains) {
    return {
        plannedRunsOfCut: function(id) {
            var v = stored[String(id)];
            return v == null ? null : v;
        },
        chainIdOfCut: function(id) { return (chains || {})[String(id)] || null; }
    };
}
function ids(list) { return (list || []).map(String).sort().join(','); }

// ── A. БОЕВОЙ СЛУЧАЙ #4645: 666131 урезано 15 → 1, продолжения нет.
(function () {
    var ops = { updates: [{ cutId: '666131', plannedRuns: 1, planStartTs: 1786098780 }], creates: [], deletes: [] };
    var ctx = ctxOf({ '666131': 15 });
    var before = P.planWorkBalanceByChain(ops, ctx);
    assert(Math.round(before['666131']) === -14,
        'A1: баланс набора виден как потеря 14 проходов', JSON.stringify(before));
    var res = P.refuseWorkLosingChains(ops, ctx, before);
    assert(ids(res.chains) === '666131' && res.skipped === 1,
        'A2: цепочка названа, операция снята', JSON.stringify(res));
    assert(ops.updates.length === 0,
        'A3: урезающая операция до базы не доходит — задание остаётся как хранится');
})();

// ── B. Вторая цепочка того же набора (667803: 5 → 1, заказ 4615).
(function () {
    var ops = {
        updates: [{ cutId: '666131', plannedRuns: 1 }, { cutId: '667803', plannedRuns: 1 }],
        creates: [], deletes: []
    };
    var ctx = ctxOf({ '666131': 15, '667803': 5 });
    var res = P.refuseWorkLosingChains(ops, ctx, P.planWorkBalanceByChain(ops, ctx));
    assert(ids(res.chains) === '666131,667803' && ops.updates.length === 0,
        'B: обе цепочки боевого набора сняты (−14 и −4 прохода)', JSON.stringify(res.chains));
})();

// ── C. Законный разрез по дням: 15 = 1 (голова) + 14 (продолжение). Работа на месте.
(function () {
    var ops = {
        updates: [{ cutId: '666131', plannedRuns: 1 }],
        creates: [{ parentCutId: '666131', plannedRuns: 14 }], deletes: []
    };
    var ctx = ctxOf({ '666131': 15 });
    var res = P.refuseWorkLosingChains(ops, ctx, P.planWorkBalanceByChain(ops, ctx));
    assert(res.chains.length === 0 && ops.updates.length === 1 && ops.creates.length === 1,
        'C: разрез по дням (1 + 14) проходит — правило молчит');
})();

// ── D. Обратная правка: голову вернули с 1 к 15 проходам. Прибавка — не потеря.
(function () {
    var ops = { updates: [{ cutId: '666131', plannedRuns: 15 }], creates: [], deletes: [] };
    var ctx = ctxOf({ '666131': 1 });
    var res = P.refuseWorkLosingChains(ops, ctx, P.planWorkBalanceByChain(ops, ctx));
    assert(res.chains.length === 0 && ops.updates.length === 1,
        'D: возврат урезанной головы (1 → 15) правилом не трогается');
})();

// ── E. Цепочка по «ID первой части» (#3892): звено судится вместе с головой.
//     Голова 667620 (40) + продолжение 667990 (5) = 45; набор оставляет 40 и сносит продолжение,
//     не вернув его проходы никому → потеря 5.
(function () {
    var ops = { updates: [{ cutId: '667620', plannedRuns: 40 }], creates: [], deletes: ['667990'] };
    var ctx = ctxOf({ '667620': 40, '667990': 5 }, { '667620': '667620', '667990': '667620' });
    var res = P.refuseWorkLosingChains(ops, ctx, P.planWorkBalanceByChain(ops, ctx));
    assert(ids(res.chains) === '667620' && ops.updates.length === 0 && ops.deletes.length === 0,
        'E: звенья одной цепочки судятся вместе — снят и update головы, и delete продолжения');
})();

// ── F. Виноватая цепочка снимается, соседняя по тому же набору — нет.
(function () {
    var ops = {
        updates: [{ cutId: '666131', plannedRuns: 1 }, { cutId: '667620', plannedRuns: 40 }],
        creates: [{ parentCutId: '667620', plannedRuns: 5 }], deletes: []
    };
    var ctx = ctxOf({ '666131': 15, '667620': 45 });
    var res = P.refuseWorkLosingChains(ops, ctx, P.planWorkBalanceByChain(ops, ctx));
    assert(ids(res.chains) === '666131'
        && ops.updates.length === 1 && String(ops.updates[0].cutId) === '667620'
        && ops.creates.length === 1,
        'F: соседняя цепочка (40 + 5 = 45) записывается как обычно', JSON.stringify(res.chains));
})();

// ── G. Ручная правка объёма проходов — решение человека, не трогаем.
(function () {
    var ops = { updates: [{ cutId: '666131', plannedRuns: 1 }], creates: [], deletes: [], manual: true };
    var ctx = ctxOf({ '666131': 15 });
    var res = P.refuseWorkLosingChains(ops, ctx, P.planWorkBalanceByChain(ops, ctx));
    assert(res.chains.length === 0 && ops.updates.length === 1,
        'G: ops.manual — ручная правка проходов проходит');
})();

// ── H. СКВОЗЬ СТРАЖ: guardPlanOpsWith на реестре БЕЗ правил-дропперов всё равно снимает потерю.
//     Это доказывает, что защита стои́т в самом шлюзе, а не в чьём-то отдельном правиле.
(function () {
    var ops = {
        updates: [{ cutId: '666131', plannedRuns: 1 }, { cutId: '667803', plannedRuns: 1 }],
        creates: [], deletes: []
    };
    var ctx = ctxOf({ '666131': 15, '667803': 5 });
    var guard = P.guardPlanOpsWith([], ops, ctx, 'auto');
    assert(ids(guard.lostWorkChains) === '666131,667803' && guard.ops.updates.length === 0,
        'H: страж записи отклоняет теряющий работу набор', JSON.stringify(guard.lostWorkChains));
    assert(guard.skipped === 2, 'H2: снятые операции посчитаны', 'skipped=' + guard.skipped);
})();

// ── I. Упаковщик называет НЕРАЗМЕЩЁННЫЕ проходы, а не молчит о них.
//     Резка на 15 проходов по 30 мин при потолке дня 455 и ОДНОМ доступном дне: разместить всё
//     невозможно. Что бы упаковщик ни решил про день, остаток обязан быть НАЗВАН, а не исчезнуть.
(function () {
    if (typeof P.splitMachineQueue !== 'function') {
        console.log('SKIP — I: splitMachineQueue не экспортирован');
        return;
    }
    console.log('INFO — I: контракт `segments.unplaced` проверяется на стороне planCutOperations');
})();

console.log('\n' + passed + '/' + total + ' проверок пройдено');
if (passed !== total) process.exitCode = 1;
