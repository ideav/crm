    // ── Реестр жёстких правил планирования (ТЗ §15) ──────────────────────────────────────────
    //
    // ЗАЧЕМ ОТДЕЛЬНЫМ МОДУЛЕМ. Правило «автоматика не лезет в замороженный день» возвращалось
    // тикетами трижды за четыре дня (#4347, #4434, #4436), потому что жило в трёх разных местах
    // одной функции и не действовало на остальные пути записи. Здесь оно ОДНО, проверяемое
    // машиной и покрытое тестом на все входы (experiments/atex-pp-invariants.test.js).
    //
    // ЧТО СЮДА ПОПАДАЕТ. Только запреты из ТЗ §15 — то, что нарушать нельзя никогда. Штрафы и
    // предпочтения (срок, переналадка, фольга в конец дня — ТЗ §8.2/§12.1) сюда НЕ ПОПАДАЮТ: они
    // могут проигрывать друг другу, это норма, и «фольга не последняя» — не дефект, а результат
    // сравнения весов (см. панель качества плана, ТЗ §13).
    //
    // КОГО ОГРАНИЧИВАЕТ. `actor: 'auto'` — только автоматику (Сгенерировать / Упорядочить /
    // Пересчитать наладку / авто-разбиение по дням). Ручное действие оператора проходит без
    // предупреждения (решение заказчика 27.07.2026), но пишется в журнал: иначе на вопрос
    // «почему в замороженном дне что-то поменялось» ответа не найти. `actor: 'any'` — запрет
    // для всех, включая человека.
    //
    // ФОРМА ПРОВЕРКИ. Чистые функции без DOM и без `self`: на вход — операции плана и контекст,
    // на выход — массив нарушений. Никаких побочных эффектов, поэтому их можно звать и до записи
    // (как страж), и в тестах (как утверждение).

    // Нарушение: какое правило, по какому заданию, человекочитаемо.
    function ppViolation(rule, cutId, msg) {
        return { rule: rule, cutId: cutId == null ? null : String(cutId), msg: msg };
    }

    // Контекст проверки (ctx):
    //   isFrozenCut(cutId)  — ХРАНИМЫЙ день задания заморожен (где оно стои́т сейчас);
    //   isFrozenTs(ts)      — день, куда план предлагает положить, заморожен;
    //   isFixedCut(cutId)   — задание зафиксировано оператором (🔒);
    //   dayKeyOfCut(cutId)  — ключ ГГГГММДД хранимого дня задания (для сравнения «день сменился»);
    //   dayKeyOfTs(ts)      — ключ ГГГГММДД предлагаемого времени старта.
    // Любой отсутствующий предикат считается «всегда false» — правило просто не срабатывает
    // (например, таблицы «Заморозка» в базе нет — значит замороженных дней не бывает).
    function ppCtxFn(ctx, name) {
        return (ctx && typeof ctx[name] === 'function') ? ctx[name] : function() { return false; };
    }

    var PP_INVARIANTS = [
        {
            id: 'FROZEN_DAY',
            tz: '§15',
            actor: 'auto',
            enforce: true,      // страж отбрасывает нарушающие операции (так было и до реестра, #4436)
            title: 'Автоматика не изменяет замороженный день: не двигает и не удаляет его задания и не ставит в него новые',
            // Проверяется в обе стороны: нельзя увезти ИЗ замороженного дня и нельзя положить В него.
            // Просрочка, возникшая из-за отказа, — это информация (задание уезжает на ближайший
            // доступный день и подсвечивается), а не повод нарушить заморозку (решение 27.07.2026,
            // тикеты #4338 → #4347 → #4436).
            check: function(ops, ctx) {
                var frozenCut = ppCtxFn(ctx, 'isFrozenCut'), frozenTs = ppCtxFn(ctx, 'isFrozenTs');
                var out = [];
                (ops && ops.updates || []).forEach(function(u) {
                    if (frozenCut(u.cutId)) out.push(ppViolation('FROZEN_DAY', u.cutId, 'сдвиг задания из замороженного дня'));
                    else if (frozenTs(u.planStartTs)) out.push(ppViolation('FROZEN_DAY', u.cutId, 'перенос задания В замороженный день'));
                });
                (ops && ops.deletes || []).forEach(function(id) {
                    if (frozenCut(id)) out.push(ppViolation('FROZEN_DAY', id, 'удаление задания замороженного дня'));
                });
                (ops && ops.creates || []).forEach(function(cr) {
                    var parent = cr && cr.parentCutId;
                    if (frozenCut(parent)) out.push(ppViolation('FROZEN_DAY', parent, 'новый сегмент по заданию замороженного дня'));
                    else if (frozenTs(cr && cr.planStartTs)) out.push(ppViolation('FROZEN_DAY', parent, 'новое задание В замороженный день'));
                });
                return out;
            }
        },
        {
            id: 'FIXED_CUT_DAY',
            tz: '§15 (🔒, #3508)',
            actor: 'auto',
            enforce: false,     // ПОКА только отчёт, не запрет — см. ниже
            title: 'Автогенерация не меняет ДЕНЬ зафиксированного задания и не удаляет его',
            // Внутри своего дня зафиксированное задание пересчитывать можно (сдвиг времени старта
            // после смены порядка соседей) — запрещён именно переезд на другой день.
            //
            // ПОЧЕМУ enforce:false. Существует законный случай переезда: день зафиксированного
            // задания стал нерабочим — тогда упаковщик сдвигает его и сообщает об этом
            // («Зафиксированных заданий сдвинуто: N», #4434 п.1). Пока этот случай не отделён от
            // настоящих нарушений, страж только СЧИТАЕТ и пишет в журнал. Включать запрет — после
            // того, как в журнале станет видно, что срабатывает лишь на нерабочих днях (тогда
            // условие уточняется), либо что не срабатывает вовсе (тогда enforce:true безопасен).
            check: function(ops, ctx) {
                var isFixed = ppCtxFn(ctx, 'isFixedCut');
                var dayOfCut = (ctx && typeof ctx.dayKeyOfCut === 'function') ? ctx.dayKeyOfCut : null;
                var dayOfTs = (ctx && typeof ctx.dayKeyOfTs === 'function') ? ctx.dayKeyOfTs : null;
                var out = [];
                (ops && ops.updates || []).forEach(function(u) {
                    if (!isFixed(u.cutId) || !dayOfCut || !dayOfTs) return;
                    var was = dayOfCut(u.cutId), will = dayOfTs(u.planStartTs);
                    if (was != null && will != null && was !== will) {
                        out.push(ppViolation('FIXED_CUT_DAY', u.cutId, 'зафиксированное задание уезжает с ' + was + ' на ' + will));
                    }
                });
                (ops && ops.deletes || []).forEach(function(id) {
                    if (isFixed(id)) out.push(ppViolation('FIXED_CUT_DAY', id, 'удаление зафиксированного задания'));
                });
                return out;
            }
        }
    ];

    // Все нарушения, которые операции плана несут для указанного актора.
    //   actor: 'auto' — проверяются правила автоматики и общие; 'human' — только общие ('any').
    function checkPlanInvariants(ops, ctx, actor) {
        var who = actor === 'human' ? 'human' : 'auto';
        var out = [];
        PP_INVARIANTS.forEach(function(inv) {
            if (inv.actor === 'auto' && who !== 'auto') return;
            out = out.concat(inv.check(ops, ctx) || []);
        });
        return out;
    }

    // Страж записи: убирает из операций то, что нарушает правила с `enforce: true`, и возвращает
    // ПОЛНЫЙ отчёт (включая правила-наблюдатели, которые пока только считают).
    // Возвращает { ops, violations, skipped } — ops мутируется на месте (updates/deletes/creates
    // заменяются отфильтрованными массивами), как и ожидают вызывающие.
    function guardPlanOps(ops, ctx, actor) {
        var violations = checkPlanInvariants(ops, ctx, actor);
        var enforced = {};
        PP_INVARIANTS.forEach(function(inv) { if (inv.enforce) enforced[inv.id] = true; });
        var blockedCuts = {};
        var hasEnforced = false;
        violations.forEach(function(v) {
            if (!enforced[v.rule]) return;
            hasEnforced = true;
            if (v.cutId != null) blockedCuts[String(v.cutId)] = true;
        });
        if (!ops || !hasEnforced) return { ops: ops, violations: violations, skipped: 0 };

        // Отбрасываем ровно то, что нарушает enforce-правила: те же предикаты, что и в check.
        var frozenCut = ppCtxFn(ctx, 'isFrozenCut'), frozenTs = ppCtxFn(ctx, 'isFrozenTs');
        var skipped = 0;
        ops.updates = (ops.updates || []).filter(function(u) {
            if (frozenCut(u.cutId) || frozenTs(u.planStartTs)) { skipped++; return false; }
            return true;
        });
        ops.deletes = (ops.deletes || []).filter(function(id) {
            if (frozenCut(id)) { skipped++; return false; }
            return true;
        });
        ops.creates = (ops.creates || []).filter(function(cr) {
            var parent = cr && cr.parentCutId;
            if (frozenCut(parent) || frozenTs(cr && cr.planStartTs)) { skipped++; return false; }
            return true;
        });
        return { ops: ops, violations: violations, skipped: skipped };
    }

