// Инвариантный тест планирования (ТЗ §15) — таблицей «входы × правила».
//
// ОТЛИЧИЕ ОТ ТЕСТА-НА-ТИКЕТ. Тест на тикет ловит вчерашний баг в той кнопке, где его заметили.
// Этот ловит завтрашний: каждое правило из реестра PP_INVARIANTS прогоняется по КАЖДОМУ входу
// автоматики (Сгенерировать / Упорядочить / Пересчитать наладку / авто-разбиение). Новый
// обработчик, забывший про заморозку, роняет тест по построению — вспоминать правила руками не надо.
//
// Почему именно так: «не лезть в замороженный день» возвращалось тикетами #4347 → #4434 → #4436
// за четыре дня, каждый раз через другую кнопку.
//
// Run with: node experiments/atex-pp-invariants.test.js

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
// День 20260728 заморожен, 20260729 — нет. Задание 1 стои́т в замороженном дне, 2 — в свободном,
// 3 — зафиксировано (🔒) в свободном дне.
var FROZEN_DAY_KEY = 20260728, FREE_DAY_KEY = 20260729;
var TS_FROZEN = Date.UTC(2026, 6, 28, 8, 0, 0);   // 28.07.2026 08:00
var TS_FREE = Date.UTC(2026, 6, 29, 8, 0, 0);     // 29.07.2026 08:00
var dayKeyOf = function(ts) {
    var d = new Date(Number(ts));
    return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
};
var CUT_DAY = { '1': FROZEN_DAY_KEY, '2': FREE_DAY_KEY, '3': FREE_DAY_KEY };
var ctx = {
    isFrozenCut: function(id) { return CUT_DAY[String(id)] === FROZEN_DAY_KEY; },
    isFrozenTs: function(ts) { return dayKeyOf(ts) === FROZEN_DAY_KEY; },
    isFixedCut: function(id) { return String(id) === '3'; },
    dayKeyOfCut: function(id) { return CUT_DAY[String(id)] == null ? null : CUT_DAY[String(id)]; },
    dayKeyOfTs: function(ts) { return dayKeyOf(ts); }
};
var emptyOps = function() { return { updates: [], deletes: [], creates: [] }; };

// Входы автоматики: имя → операции, которые этот вход способен породить. Проверяем ОДИН И ТОТ ЖЕ
// набор нарушений по каждому: правило не должно зависеть от того, какая кнопка его вызвала.
var AUTO_INPUTS = ['generate', 'order', 'recalc-setup', 'auto-split'];

// ── 1. FROZEN_DAY на всех входах ────────────────────────────────────────────────────────────
AUTO_INPUTS.forEach(function(input) {
    var ops = emptyOps();
    ops.updates.push({ cutId: '1', planStartTs: TS_FREE });     // увезти ИЗ замороженного
    var v = planning.checkPlanInvariants(ops, ctx, 'auto');
    assert(v.length === 1 && v[0].rule === 'FROZEN_DAY' && v[0].cutId === '1',
        'FROZEN_DAY × ' + input + ': сдвиг ИЗ замороженного дня — нарушение', '(' + v.length + ')');
});

AUTO_INPUTS.forEach(function(input) {
    var ops = emptyOps();
    ops.updates.push({ cutId: '2', planStartTs: TS_FROZEN });   // положить В замороженный
    var v = planning.checkPlanInvariants(ops, ctx, 'auto');
    assert(v.length === 1 && v[0].rule === 'FROZEN_DAY' && v[0].cutId === '2',
        'FROZEN_DAY × ' + input + ': перенос В замороженный день — нарушение', '(' + v.length + ')');
});

(function() {
    var ops = emptyOps();
    ops.deletes.push('1');
    var v = planning.checkPlanInvariants(ops, ctx, 'auto');
    assert(v.length === 1 && v[0].rule === 'FROZEN_DAY', 'FROZEN_DAY: удаление задания замороженного дня — нарушение');
})();

(function() {
    var ops = emptyOps();
    ops.creates.push({ parentCutId: '2', planStartTs: TS_FROZEN });   // новый сегмент В замороженный
    var v = planning.checkPlanInvariants(ops, ctx, 'auto');
    assert(v.length === 1 && v[0].rule === 'FROZEN_DAY', 'FROZEN_DAY: новое задание В замороженный день — нарушение');
})();

(function() {
    var ops = emptyOps();
    ops.updates.push({ cutId: '2', planStartTs: TS_FREE });
    ops.creates.push({ parentCutId: '2', planStartTs: TS_FREE });
    var v = planning.checkPlanInvariants(ops, ctx, 'auto');
    assert(v.length === 0, 'КОНТРОЛЬ: работа в свободных днях нарушением не считается');
})();

// ── 2. Ручное действие оператора правилами автоматики не ограничено ─────────────────────────
(function() {
    var ops = emptyOps();
    ops.updates.push({ cutId: '2', planStartTs: TS_FROZEN });
    var v = planning.checkPlanInvariants(ops, ctx, 'human');
    assert(v.length === 0, 'РУЧНОЕ: перенос в замороженный день оператором — не нарушение (решение 27.07.2026)');
})();

// ── 3. Страж записи: отбрасывает нарушающие операции и только их ────────────────────────────
(function() {
    var ops = emptyOps();
    ops.updates.push({ cutId: '1', planStartTs: TS_FREE });    // нарушение
    ops.updates.push({ cutId: '2', planStartTs: TS_FREE });    // законно
    ops.deletes.push('1');                                     // нарушение
    ops.deletes.push('2');                                     // законно
    ops.creates.push({ parentCutId: '2', planStartTs: TS_FROZEN });   // нарушение
    ops.creates.push({ parentCutId: '2', planStartTs: TS_FREE });     // законно
    var r = planning.guardPlanOps(ops, ctx, 'auto');
    assert(r.skipped === 3, 'страж отбросил ровно нарушающие операции', '(skipped=' + r.skipped + ')');
    assert(ops.updates.length === 1 && ops.updates[0].cutId === '2', 'страж сохранил законный update');
    assert(ops.deletes.length === 1 && ops.deletes[0] === '2', 'страж сохранил законный delete');
    assert(ops.creates.length === 1 && ops.creates[0].planStartTs === TS_FREE, 'страж сохранил законный create');
})();

(function() {
    var ops = emptyOps();
    ops.updates.push({ cutId: '2', planStartTs: TS_FREE });
    var r = planning.guardPlanOps(ops, ctx, 'auto');
    assert(r.skipped === 0 && ops.updates.length === 1, 'КОНТРОЛЬ: без нарушений страж не трогает операции');
})();

// ── 4. Правило-наблюдатель (enforce:false) считает, но не отбрасывает ────────────────────────
(function() {
    var ops = emptyOps();
    ops.updates.push({ cutId: '3', planStartTs: TS_FROZEN });   // 🔒 уезжает + в замороженный день
    var r = planning.guardPlanOps(ops, ctx, 'auto');
    var kinds = (r.violations || []).map(function(v) { return v.rule; }).sort();
    assert(kinds.indexOf('FIXED_CUT_DAY') >= 0, 'FIXED_CUT_DAY фиксируется как нарушение', '(' + kinds.join(',') + ')');
    assert(kinds.indexOf('FROZEN_DAY') >= 0, 'FROZEN_DAY фиксируется в том же прогоне');
})();

(function() {
    var ops = emptyOps();
    ops.updates.push({ cutId: '3', planStartTs: Date.UTC(2026, 6, 29, 14, 0, 0) });   // 🔒 внутри своего дня
    var v = planning.checkPlanInvariants(ops, ctx, 'auto');
    assert(v.length === 0, 'КОНТРОЛЬ: сдвиг 🔒 ВНУТРИ своего дня — не нарушение (запрещён переезд, не пересчёт)');
})();

(function() {
    var ops = emptyOps();
    ops.updates.push({ cutId: '3', planStartTs: TS_FROZEN });
    var before = ops.updates.length;
    planning.guardPlanOps(ops, ctx, 'auto');
    // ОЖИДАНИЕ ИЗМЕНЕНО (#4512, решение заказчика 30.07.2026). Здесь утверждалось, что
    // FIXED_CUT_DAY — НАБЛЮДАТЕЛЬ и операцию не отбрасывает. Приёмка #4512 требует обратного:
    // «страж записи, правило FIXED_CUT_DAY — включается запрет: операция, уводящая 🔒 в другой день,
    // до базы не доходит ни с какого пути записи». Теперь правило `mode: 'drop'`, и переезд
    // зафиксированного задания автоматикой отбрасывается — даже когда день-приёмник не заморожен.
    var ops2 = emptyOps();
    ops2.updates.push({ cutId: '3', planStartTs: Date.UTC(2026, 6, 30, 8, 0, 0) });   // переезд в НЕзамороженный день
    var r2 = planning.guardPlanOps(ops2, ctx, 'auto');
    assert(before === 1 && r2.skipped === 1 && ops2.updates.length === 0,
        'FIXED_CUT_DAY отбрасывает переезд 🔒 автоматикой (#4512: запрет, а не наблюдение)',
        'skipped=' + r2.skipped + ' осталось=' + ops2.updates.length);
})();

// ── 5. CUT_BATCH: задание обязано иметь «Партию сырья» (ТЗ §15, #4452) ───────────────────────
// Задание 10 — партия своя; 11 — партии нет нигде (ни цепочка, ни расход, ни FIFO); 12 — своей
// нет, но резольвер находит её по цепочке дробления. Заморозки в этой фикстуре нет, поэтому
// срабатывает только CUT_BATCH.
var BATCH = {
    '10': { batchId: '900', source: 'own' },
    '11': { batchId: '', source: '', reason: 'нет активной «Партии сырья» этого вида с остатком' },
    '12': { batchId: '901', source: 'chain' }
};
var batchCtx = {
    resolveBatchForCut: function(id) { return BATCH[String(id)] || { batchId: '', source: '', reason: 'задания нет в очереди' }; }
};

AUTO_INPUTS.forEach(function(input) {
    var ops = emptyOps();
    ops.updates.push({ cutId: '11', planStartTs: TS_FREE });
    var v = planning.checkPlanInvariants(ops, batchCtx, 'auto');
    assert(v.length === 1 && v[0].rule === 'CUT_BATCH' && v[0].cutId === '11',
        'CUT_BATCH × ' + input + ': задание без «Партии сырья» — нарушение', '(' + v.length + ')');
});

(function() {
    var ops = emptyOps();
    ops.updates.push({ cutId: '10', planStartTs: TS_FREE });
    var v = planning.checkPlanInvariants(ops, batchCtx, 'auto');
    assert(v.length === 0, 'КОНТРОЛЬ: задание со своей партией нарушением не считается');
})();

(function() {
    var ops = emptyOps();
    ops.creates.push({ parentCutId: '11', planStartTs: TS_FREE });
    var v = planning.checkPlanInvariants(ops, batchCtx, 'auto');
    assert(v.length === 1 && v[0].rule === 'CUT_BATCH',
        'CUT_BATCH: продолжение по заданию без партии — нарушение (пустота расползается по цепочке)');
})();

(function() {
    var ops = emptyOps();
    ops.updates.push({ cutId: '11', planStartTs: TS_FREE });
    var v = planning.checkPlanInvariants(ops, batchCtx, 'human');
    assert(v.length === 1 && v[0].rule === 'CUT_BATCH',
        'CUT_BATCH действует и на ручное действие: задание без партии — брак при любом авторе (actor: any)');
})();

// Страж не отбрасывает операцию, а ЧИНИТ её: подставляет разрешённую партию в саму операцию,
// чтобы запись плана её сохранила. Отказ от операции потерял бы работу — это не тот способ.
(function() {
    var ops = emptyOps();
    ops.updates.push({ cutId: '12', planStartTs: TS_FREE });
    ops.creates.push({ parentCutId: '12', planStartTs: TS_FREE });
    var r = planning.guardPlanOps(ops, batchCtx, 'auto');
    assert(r.skipped === 0 && ops.updates.length === 1 && ops.creates.length === 1,
        'CUT_BATCH ничего не отбрасывает (работа не теряется)', '(skipped=' + r.skipped + ')');
    assert(String(ops.updates[0].materialBatchId) === '901' && String(ops.creates[0].materialBatchId) === '901',
        'страж проставил разрешённую партию в операции — она уйдёт в базу', '(' + ops.updates[0].materialBatchId + '/' + ops.creates[0].materialBatchId + ')');
    assert((r.violations || []).filter(function(v) { return v.rule === 'CUT_BATCH'; }).length === 0,
        'после починки нарушения CUT_BATCH не остаётся');
})();

(function() {
    var ops = emptyOps();
    ops.updates.push({ cutId: '10', planStartTs: TS_FREE });
    planning.guardPlanOps(ops, batchCtx, 'auto');
    assert(ops.updates[0].materialBatchId == null,
        'у задания со СВОЕЙ партией страж ничего не переписывает (лишний _m_set не нужен)');
})();

(function() {
    var ops = emptyOps();
    ops.updates.push({ cutId: '11', planStartTs: TS_FREE });
    var r = planning.guardPlanOps(ops, batchCtx, 'auto');
    var v = (r.violations || []).filter(function(x) { return x.rule === 'CUT_BATCH'; });
    assert(v.length === 1 && /нет активной/.test(v[0].msg),
        'неразрешимая партия доезжает до отчёта С ПРИЧИНОЙ, а не молчит', '(' + (v[0] && v[0].msg) + ')');
})();

(function() {
    var ops = emptyOps();
    ops.updates.push({ cutId: '11', planStartTs: TS_FREE });
    var v = planning.checkPlanInvariants(ops, {}, 'auto');   // ctx без resolveBatchForCut
    assert(v.length === 0, 'КОНВЕНЦИЯ РЕЕСТРА: нет предиката разрешения партии — правило молчит, а не винит всех');
})();

// ── 5b. FIXED_NO_PUSH (#4497) на всех входах автоматики ─────────────────────────────────────
// Перед 🔒 автоматика ничего не ставит. Хранимый план: 🔒 «3» стои́т в свободном дне в 10:00,
// свободное «2» — в 12:00 (после неё). Любой вход, поставивший «2» перед 🔒, ловится правилом.
(function() {
    var TS_LOCK = Date.UTC(2026, 6, 29, 10, 0, 0);
    var TS_AFTER = Date.UTC(2026, 6, 29, 12, 0, 0);
    var pushCtx = {
        isFixedCut: ctx.isFixedCut,
        dayKeyOfCut: ctx.dayKeyOfCut,
        dayKeyOfTs: ctx.dayKeyOfTs,
        planSnapshot: function() {
            return [{ id: '3', slitterId: '1', planStartTs: TS_LOCK, fixed: true, chainId: '' },
                    { id: '2', slitterId: '1', planStartTs: TS_AFTER, fixed: false, chainId: '' }];
        }
    };
    AUTO_INPUTS.forEach(function(input) {
        var ops = emptyOps();
        ops.updates.push({ cutId: '2', slitterId: '1', planStartTs: Date.UTC(2026, 6, 29, 9, 0, 0) });
        var v = planning.checkPlanInvariants(ops, pushCtx, 'auto')
            .filter(function(x) { return x.rule === 'FIXED_NO_PUSH'; });
        assert(v.length === 1 && v[0].cutId === '3',
            'FIXED_NO_PUSH × ' + input + ': свободное задание встало перед 🔒 — нарушение', '(' + v.length + ')');
    });
    // Ручное действие оператора правилом не ограничено (ТЗ §15).
    var manual = emptyOps();
    manual.updates.push({ cutId: '2', slitterId: '1', planStartTs: Date.UTC(2026, 6, 29, 9, 0, 0) });
    var mctx = {}; Object.keys(pushCtx).forEach(function(k) { mctx[k] = pushCtx[k]; });
    mctx.isManualMoveCut = function(id) { return String(id) === '2'; };
    assert(planning.checkPlanInvariants(manual, mctx, 'auto')
        .filter(function(x) { return x.rule === 'FIXED_NO_PUSH'; }).length === 0,
        'FIXED_NO_PUSH: ручной перенос оператора не ограничен');
    // КОНВЕНЦИЯ РЕЕСТРА: нет снимка плана — правило молчит.
    var bare = emptyOps();
    bare.updates.push({ cutId: '2', slitterId: '1', planStartTs: TS_LOCK });
    assert(planning.checkPlanInvariants(bare, { isFixedCut: ctx.isFixedCut }, 'auto')
        .filter(function(x) { return x.rule === 'FIXED_NO_PUSH'; }).length === 0,
        'FIXED_NO_PUSH: без хранимого плана правило не срабатывает (конвенция реестра)');
})();

// ── 6. Реестр не пуст и правила описаны ─────────────────────────────────────────────────────
(function() {
    var inv = planning.invariants || [];
    assert(inv.length >= 3, 'в реестре есть правила', '(' + inv.length + ')');
    var ok = inv.every(function(i) { return i.id && i.tz && i.title && typeof i.check === 'function'; });
    assert(ok, 'у каждого правила есть id, ссылка на пункт ТЗ, формулировка и проверка');
})();

console.log('\n' + passed + '/' + total + ' passed');
