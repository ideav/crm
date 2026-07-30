// Механика исполнения правил реестра (issue #4515) — не «что проверяет правило», а «чем оно
// обеспечено».
//
// ЗАЧЕМ. Реестр PP_INVARIANTS выглядел выключателем, которого нет: `enforce: true` стоял у одного
// правила из девяти, а ветка исполнения в `guardPlanOps` отбрасывала операции по ЖЁСТКО ВПИСАННЫМ
// предикатам `isFrozenCut`/`isFrozenTs`. Правило не имело своего способа сказать, что именно
// выбросить, поэтому `enforce: true` на FIXED_BLOCK не отбросил бы ничего — флаг был бы
// декорацией. Этот тест держит механику: режим объявлен у каждого правила, у отбрасывающего есть
// СВОЙ предикат, и состав режимов закреплён таблицей — понижение правила до наблюдателя роняет
// гейт, а не проходит тихой правкой флага.
//
// ЧЕГО ТЕСТ НЕ ТРЕБУЕТ. Он НЕ требует, чтобы все правила отбрасывали операции. Для 🔒-монолита
// (FIXED_BLOCK) отбрасывание ВРЕДНО: порядок им не чинится, задание останется с прежним
// `planStart` и день получит дыру или наложение (рецидив #4300/#4312) — правило обеспечено по
// построению в слое размещения, а шлюз для него аудит. Тест требует другого: чтобы режим был
// ОБЪЯВЛЕН с причиной, а не получился молча.
//
// Run with: node experiments/atex-pp-invariants-enforcement.test.js

process.env.TZ = 'UTC';
global.window = { db: 'testdb', xsrf: 'x' };
var planning = require('../download/atex/js/production-planning.js').planning;

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

// ── ОБЪЯВЛЕННЫЙ СОСТАВ РЕЖИМОВ ──────────────────────────────────────────────────────────────
// Таблица-храповик. Режим правила — решение, а не деталь реализации: 'drop' — страж выбрасывает
// нарушающие операции; 'audit' — выбросить нельзя (или нечего), правило ловит регрессию на всех
// путях записи и кричит. Меняется эта таблица ТОЛЬКО вместе с решением, записанным в ТЗ §15.
// Появилось новое правило — тест упадёт, пока режим не объявлен здесь.
var DECLARED_MODES = {
    FROZEN_DAY:       'drop',    // #4436: операцию по замороженному дню просто не пишем — план цел
    FIXED_CUT_DAY:    'drop',    // #4512: 🔒 не вытесняется; законный случай отделён (ops.fixedDayLost)
    FIXED_BLOCK:      'audit',   // отбрасывание рвёт день дырой/наложением (#4300/#4312)
    FIXED_NO_PUSH:    'audit',   // то же: порядок чинится построением, не отказом
    DAY_CAPACITY:     'audit',   // потолок чинит упаковщик; отказ оставил бы день переполненным
    DAY_FILL:         'audit',   // недоупаковка — недо-, а не сверх-: отбрасывать нечего
    CHAIN_CONTIGUOUS: 'audit',   // разрыв чинится СШИВАНИЕМ задания (#4488), а не отказом
    CUT_BATCH:        'audit',   // пустая партия чинится подстановкой (fill), а не отказом
    CHAIN_SETUP_ONCE: 'audit'    // двойная наладка чинится РАСЧЁТОМ (#4524), а не отказом
};

var inv = planning.invariants || [];
var byId = {};
inv.forEach(function(r) { if (r && r.id) byId[r.id] = r; });

// 1. Реестр и таблица режимов описывают ОДИН И ТОТ ЖЕ набор правил.
var inRegistry = Object.keys(byId).sort();
var inTable = Object.keys(DECLARED_MODES).sort();
assert(inRegistry.join(',') === inTable.join(','),
    'состав реестра совпадает с объявленной таблицей режимов',
    'реестр=[' + inRegistry.join(' ') + '] таблица=[' + inTable.join(' ') + ']');

// 2. У каждого правила режим ОБЪЯВЛЕН и совпадает с таблицей.
inv.forEach(function(r) {
    assert(r.mode === 'drop' || r.mode === 'audit',
        r.id + ': режим объявлен полем mode', 'mode=' + JSON.stringify(r.mode));
    assert(r.mode === DECLARED_MODES[r.id],
        r.id + ': режим совпадает с объявленным в таблице теста',
        'реестр=' + r.mode + ' таблица=' + DECLARED_MODES[r.id]);
});

// 3. Правило-наблюдатель объясняет, ПОЧЕМУ не отбрасывает. Без причины «audit» — это забытое
//    правило, а не решение.
inv.forEach(function(r) {
    if (r.mode !== 'audit') return;
    assert(typeof r.why === 'string' && r.why.trim().length >= 15,
        r.id + ': у наблюдателя записана причина (why)', 'why=' + JSON.stringify(r.why || null));
});

// 4. ГЛАВНОЕ. Правило с режимом 'drop' несёт СВОЙ предикат отбрасывания. Иначе исполнение опять
//    окажется вписанным в шлюз для одного правила, и режим 'drop' у нового правила будет ложью.
inv.forEach(function(r) {
    if (r.mode !== 'drop') return;
    assert(typeof r.drop === 'function',
        r.id + ': отбрасывающее правило имеет свой drop(op, ctx, kind)',
        'drop=' + typeof r.drop);
});

// 5. Наблюдателю drop не нужен — и его не должно быть: иначе непонятно, применяется он или нет.
inv.forEach(function(r) {
    if (r.mode !== 'audit') return;
    assert(r.drop === undefined, r.id + ': у наблюдателя нет drop');
});

// ── ФИКСТУРА: день 20260728 заморожен, 20260729 — нет ────────────────────────────────────────
var FROZEN_DAY_KEY = 20260728, FREE_DAY_KEY = 20260729;
var TS_FROZEN = Math.floor(Date.UTC(2026, 6, 28, 8, 0, 0) / 1000);
var TS_FREE = Math.floor(Date.UTC(2026, 6, 29, 8, 0, 0) / 1000);
function dayKeyOf(ts) {
    var d = new Date(Number(ts) * 1000);
    return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
}
var CUT_DAY = { '1': FROZEN_DAY_KEY, '2': FREE_DAY_KEY };
var ctx = {
    isFrozenCut: function(id) { return CUT_DAY[String(id)] === FROZEN_DAY_KEY; },
    isFrozenTs: function(ts) { return dayKeyOf(ts) === FROZEN_DAY_KEY; },
    isFixedCut: function() { return false; },
    dayKeyOfCut: function(id) { return CUT_DAY[String(id)] == null ? null : CUT_DAY[String(id)]; },
    dayKeyOfTs: function(ts) { return dayKeyOf(ts); }
};

// 6. Поведение стража не изменилось: операция по замороженному дню не доходит до записи.
//    Тот же случай, что держал #4436 до появления режимов — переход на per-rule drop обязан быть
//    поведенчески нейтральным.
var ops = {
    updates: [{ cutId: '1', planStartTs: TS_FREE },     // увезти ИЗ замороженного дня — нельзя
               { cutId: '2', planStartTs: TS_FROZEN },   // положить В замороженный день — нельзя
               { cutId: '2', planStartTs: TS_FREE }],    // свободный день → свободный — можно
    deletes: ['1'],                                      // удалить из замороженного дня — нельзя
    creates: [{ parentCutId: '2', planStartTs: TS_FROZEN }]   // новый сегмент в замороженный — нельзя
};
var r = planning.guardPlanOps(ops, ctx, 'auto');
assert(r.skipped === 4, 'страж отбросил ровно нарушающие операции (4)', 'skipped=' + r.skipped);
assert(r.ops.updates.length === 1 && String(r.ops.updates[0].cutId) === '2'
       && r.ops.updates[0].planStartTs === TS_FREE,
    'в updates осталась только операция по свободному дню',
    'осталось=' + JSON.stringify(r.ops.updates.map(function(u){ return u.cutId + '@' + dayKeyOf(u.planStartTs); })));
assert(r.ops.deletes.length === 0, 'удаление из замороженного дня отброшено');
assert(r.ops.creates.length === 0, 'создание в замороженном дне отброшено');
assert(r.violations.some(function(v) { return v.rule === 'FROZEN_DAY'; }),
    'нарушение FROZEN_DAY попало в отчёт');

// 7. Человеку правило автоматики не мешает (actor: 'auto').
var opsHuman = { updates: [{ cutId: '2', planStartTs: TS_FROZEN }], deletes: [], creates: [] };
var rh = planning.guardPlanOps(opsHuman, ctx, 'human');
assert(rh.skipped === 0 && rh.ops.updates.length === 1,
    'ручное действие в замороженный день страж не отбрасывает', 'skipped=' + rh.skipped);

// 8. МЕХАНИКА PER-RULE. Правило, объявленное 'drop' со своим предикатом, отбрасывает — даже если
//    оно НЕ про заморозку. Ровно это было невозможно до #4515: ветка исполнения знала только
//    предикаты замороженного дня. Проверяем синтетическим правилом на копии реестра.
var synthetic = {
    id: 'SYNTHETIC_ODD_CUT', tz: '§15 (тест #4515)', actor: 'auto', mode: 'drop',
    title: 'Синтетическое правило: задание с нечётным id автоматика не пишет',
    check: function(o) {
        var out = [];
        (o && o.updates || []).forEach(function(u) {
            if (Number(u.cutId) % 2 === 1) out.push({ rule: 'SYNTHETIC_ODD_CUT', cutId: String(u.cutId), msg: 'нечётное' });
        });
        return out;
    },
    drop: function(op, c, kind) { return kind === 'update' && Number(op.cutId) % 2 === 1; }
};
if (typeof planning.guardPlanOpsWith === 'function') {
    var ops8 = { updates: [{ cutId: '7', planStartTs: TS_FREE }, { cutId: '8', planStartTs: TS_FREE }],
                 deletes: [], creates: [] };
    var r8 = planning.guardPlanOpsWith([synthetic], ops8, ctx, 'auto');
    assert(r8.skipped === 1 && r8.ops.updates.length === 1 && String(r8.ops.updates[0].cutId) === '8',
        'предикат drop произвольного правила действительно отбрасывает операцию',
        'skipped=' + r8.skipped + ' осталось=' + JSON.stringify(r8.ops.updates.map(function(u){ return u.cutId; })));
} else {
    assert(false, 'planning.guardPlanOpsWith(rules, ops, ctx, actor) — исполнение по произвольному набору правил',
        'экспорта нет: механику per-rule нечем проверить');
}

console.log('\n' + passed + '/' + total + ' проверок прошло');
if (passed !== total) process.exitCode = 1;
