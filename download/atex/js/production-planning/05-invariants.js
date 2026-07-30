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
    // ЧЕГО ЗДЕСЬ НЕТ. Правила проверяются по ОПЕРАЦИЯМ ПЛАНА (updates/creates/deletes), поэтому
    // запрет ТЗ §15 о МАССОВОЙ ЗАПИСИ (#4477: независимые запросы — пулом до 5 потоков; значение,
    // которое уже лежит в базе, не сохраняем) сюда не ложится — он про запросы, а не про план.
    // Его держит ШЛЮЗ ЗАПИСИ: `postCutStarts` («Время старта», метод `saveCutStarts`) и
    // `computeCutSetupUpdates`/`persistCutSetupColumns` (тайминг) в `20-controller.js`, предел
    // потоков — `MAX_PARALLEL_WRITES` (`10-planning-engine.js`). Тест —
    // `experiments/atex-production-planning-4477.test.js`.
    // Так же не ложится запрет ТЗ §15 о ВИДИМОСТИ ОТКЛОНЕНИЙ (#4479: найденное автоматической
    // проверкой оператор может увидеть на самих заданиях) — он про экран, а не про план. Его держит
    // ЕДИНЫЙ РАЗБОР: `recalcMismatchRows` (`20-controller.js`) отдаёт и число для кнопки
    // «↻ Пересчитать наладку», и строки для бейджей карточек — считаются они один раз и разойтись не
    // могут. Тест — `experiments/atex-pp-4479-mismatch-badges.test.js`.
    //
    // КОГО ОГРАНИЧИВАЕТ. `actor: 'auto'` — только автоматику (Сгенерировать / Упорядочить /
    // Пересчитать наладку / авто-разбиение по дням). Ручное действие оператора проходит без
    // предупреждения (решение заказчика 27.07.2026), но пишется в журнал: иначе на вопрос
    // «почему в замороженном дне что-то поменялось» ответа не найти. `actor: 'any'` — запрет
    // для всех, включая человека.
    //
    // ЧЕМ ОБЕСПЕЧЕНО (#4515). У каждого правила ОБЪЯВЛЕН режим:
    //   mode: 'drop'  — страж выбрасывает нарушающую операцию, и план от этого остаётся целым.
    //                   Такое правило обязано нести СВОЙ предикат `drop(op, ctx, kind)` — теми же
    //                   условиями, которыми оно отчиталось в `check`.
    //   mode: 'audit' — выбросить нельзя или нечего, и правило объясняет ПОЧЕМУ в поле `why`.
    //                   Переполнение дня, порядок 🔒, дыра в дне — свойства ВСЕЙ раскладки, а не
    //                   отдельной «плохой» записи: выбросив часть операций, получим не исправленный
    //                   план, а дыру, наложение или потерянное задание (#4300/#4312). Соблюдение
    //                   обеспечивается ПО ПОСТРОЕНИЮ (слой размещения, упаковщик), шлюз — аудит:
    //                   ловит регрессию на всех путях записи разом.
    // Раньше здесь стоял булев `enforce`, а условия отбрасывания были вписаны в САМ СТРАЖ и знали
    // только предикаты замороженного дня — поэтому `enforce: true` у любого другого правила не
    // отбросил бы ничего. Состав режимов закреплён тестом
    // `experiments/atex-pp-invariants-enforcement.test.js`: понижение правила до наблюдателя роняет
    // гейт, а не проходит тихой правкой флага.
    //
    // ФОРМА ПРОВЕРКИ. Чистые функции без DOM и без `self`: на вход — операции плана и контекст,
    // на выход — массив нарушений. Никаких побочных эффектов, поэтому их можно звать и до записи
    // (как страж), и в тестах (как утверждение).

    // Нарушение: какое правило, по какому заданию, человекочитаемо (msg — для ЖУРНАЛА).
    // extra — СТРУКТУРА нарушения (станок, день, минуты, второе задание): по ней интерфейс
    // собирает сообщение оператору, не разбирая текст (#4475). Правило отдаёт данные, а не фразу.
    function ppViolation(rule, cutId, msg, extra) {
        var v = { rule: rule, cutId: cutId == null ? null : String(cutId), msg: msg };
        if (extra) Object.keys(extra).forEach(function(k) { if (extra[k] !== undefined) v[k] = extra[k]; });
        return v;
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

    // #4494: операция — это РАЗРЫВ ПО ПОТОЛКУ задания, которое оператор вручную перенёс в
    // замороженный день? Такие операции заморозку не нарушают: состав дня не меняется, лишнее
    // уезжает. Разрешаются ровно две формы:
    //   • update ЭТОГО задания, остающийся в ТОМ ЖЕ дне (планировщик уменьшил ему проходы);
    //   • create ЕГО продолжения на день, который НЕ заморожен (остаток уехал).
    // Всё остальное по замороженному дню (переезд, удаление, чужие задания, новые задания в этот
    // день) остаётся запретом. Чистая; нет предикатов — false (исключения нет).
    function isFrozenDayTrim(op, ctx) {
        if (!op) return false;
        var manual = (ctx && typeof ctx.isManualMoveCut === 'function') ? ctx.isManualMoveCut : null;
        if (!manual) return false;
        var cutId = op.cutId != null ? op.cutId : op.parentCutId;
        if (cutId == null || !manual(cutId)) return false;
        var frozenTs = ppCtxFn(ctx, 'isFrozenTs');
        if (op.cutId != null) {
            // Разрыв оставляет задание в его дне: сравниваем ХРАНИМЫЙ день с предлагаемым.
            var dayOfCut = (ctx && typeof ctx.dayKeyOfCut === 'function') ? ctx.dayKeyOfCut : null;
            var dayOfTs = (ctx && typeof ctx.dayKeyOfTs === 'function') ? ctx.dayKeyOfTs : null;
            if (!dayOfCut || !dayOfTs) return false;
            var was = dayOfCut(op.cutId), now = dayOfTs(op.planStartTs);
            return was != null && now != null && was === now;
        }
        // Продолжение: остаток обязан уехать ИЗ замороженного дня.
        return op.planStartTs != null && !frozenTs(op.planStartTs);
    }

    var PP_INVARIANTS = [
        {
            id: 'FROZEN_DAY',
            tz: '§15',
            actor: 'auto',
            mode: 'drop',       // страж отбрасывает нарушающие операции (так было и до реестра, #4436)
            title: 'Автоматика не изменяет замороженный день: не двигает и не удаляет его задания и не ставит в него новые',
            // Проверяется в обе стороны: нельзя увезти ИЗ замороженного дня и нельзя положить В него.
            // Просрочка, возникшая из-за отказа, — это информация (задание уезжает на ближайший
            // доступный день и подсвечивается), а не повод нарушить заморозку (решение 27.07.2026,
            // тикеты #4338 → #4347 → #4436).
            //
            // #4494: ОДНО ИСКЛЮЧЕНИЕ — РАЗРЫВ ПО ПОТОЛКУ у задания, которое оператор САМ перенёс в
            // замороженный день (ctx.isManualMoveCut). День не может быть длиннее смены (решение
            // заказчика 29.07.2026): задание занимает там ровно столько, сколько есть, а остаток
            // уезжает продолжением на ближайший свободный день. Так же потолок уже сильнее замка дня
            // 🔒 (#4467) — заморозка тут ничем не отличается: 761 минута в смене физически не
            // помещается (боевая ateh, Станок 3, 28.07). Заморозка при этом ЦЕЛА:
            //   • разрешён только update ЭТОГО задания, остающийся в ЕГО ЖЕ дне (меняются проходы,
            //     не день) — переезд из замороженного дня по-прежнему запрет;
            //   • разрешён только create ЕГО продолжения ВНЕ замороженного дня — остаток обязан уехать;
            //   • чужие задания дня, удаления и новые задания в этот день — запрет, как раньше.
            // Нет предиката (старый вызывающий) — исключения нет, поведение прежнее.
            check: function(ops, ctx) {
                var frozenCut = ppCtxFn(ctx, 'isFrozenCut'), frozenTs = ppCtxFn(ctx, 'isFrozenTs');
                var out = [];
                (ops && ops.updates || []).forEach(function(u) {
                    if (frozenCut(u.cutId)) {
                        if (isFrozenDayTrim(u, ctx)) return;   // #4494: разрыв по потолку в своём дне
                        out.push(ppViolation('FROZEN_DAY', u.cutId, 'сдвиг задания из замороженного дня'));
                    }
                    else if (frozenTs(u.planStartTs)) out.push(ppViolation('FROZEN_DAY', u.cutId, 'перенос задания В замороженный день'));
                });
                (ops && ops.deletes || []).forEach(function(id) {
                    if (frozenCut(id)) out.push(ppViolation('FROZEN_DAY', id, 'удаление задания замороженного дня'));
                });
                (ops && ops.creates || []).forEach(function(cr) {
                    var parent = cr && cr.parentCutId;
                    if (frozenCut(parent)) {
                        if (isFrozenDayTrim(cr, ctx)) return;   // #4494: остаток уезжает из замороженного дня
                        out.push(ppViolation('FROZEN_DAY', parent, 'новый сегмент по заданию замороженного дня'));
                    }
                    else if (frozenTs(cr && cr.planStartTs)) out.push(ppViolation('FROZEN_DAY', parent, 'новое задание В замороженный день'));
                });
                return out;
            },
            // Что именно выбросить (#4515). Раньше эти условия стояли В САМОМ СТРАЖЕ, поэтому
            // `enforce: true` у любого ДРУГОГО правила ничего бы не отбросил: шлюз умел только
            // предикаты замороженного дня. Теперь отбрасывание — часть правила, ровно теми же
            // предикатами, что и `check` (иначе страж выбрасывал бы не то, о чём отчитался).
            //   kind: 'update' | 'delete' | 'create'; для 'delete' операция нормализована в {cutId}.
            drop: function(op, ctx, kind) {
                var frozenCut = ppCtxFn(ctx, 'isFrozenCut'), frozenTs = ppCtxFn(ctx, 'isFrozenTs');
                if (kind === 'delete') return frozenCut(op.cutId);
                if (isFrozenDayTrim(op, ctx)) return false;   // #4494: разрыв по потолку — не нарушение
                if (kind === 'create') return frozenCut(op.parentCutId) || frozenTs(op.planStartTs);
                return frozenCut(op.cutId) || frozenTs(op.planStartTs);
            }
        },
        {
            id: 'FIXED_CUT_DAY',
            tz: '§15 (🔒, #3508)',
            actor: 'auto',
            mode: 'drop',       // #4512: операция, увозящая 🔒 из её дня, до записи не доходит
            title: 'Автогенерация не меняет ДЕНЬ зафиксированного задания и не удаляет его',
            // Внутри своего дня зафиксированное задание пересчитывать можно (сдвиг времени старта
            // после смены порядка соседей) — запрещён именно переезд на другой день.
            //
            // ПОЧЕМУ ТЕПЕРЬ ЗАПРЕТ, А НЕ АУДИТ (#4511/#4512/#4513, решение заказчика 30.07.2026:
            // «не вытеснять и не переносить зафиксированные задания из дня — НИ ПРИ КАКИХ
            // ОБСТОЯТЕЛЬСТВАХ»). Наблюдателем правило было по одной причине: «законный переезд (день
            // 🔒 стал нерабочим) не отделён от настоящего нарушения». С #4514 он ОТДЕЛЁН и назван
            // движком явно: упаковщик снимает замок ТОЛЬКО когда день физически нерабочий
            // (`dayFullyBlocked` — окно смены целиком накрыто выходным/праздником/«Отпуском»), и
            // сообщает об этом через `onFixedDayLost` → `ops.fixedDayLost`. Контроллер отдаёт этот
            // вердикт стражу предикатом `isFixedReleasedCut`. Поэтому страж больше НЕ ПЕРЕСЧИТЫВАЕТ
            // законность: он спрашивает того, кто её установил, — и всё остальное отбрасывает.
            //
            // Симптом, который правило закрывает: #4513 — зафиксированный «паровоз» из 30.07 целиком
            // выкинут в 31.07 ради нескольких незафиксированных, причём с ложным вердиктом «день
            // нерабочий» про обычную пятницу. Упаковщик это уже не делает (#4514), но правило жило
            // только в нём и в прозе §15 — остальные пути записи его не соблюдали. Тикеты
            // #4511/#4512/#4513 сообщают об одном и том же в третий раз именно поэтому.
            //
            // ПОЧЕМУ ОТБРАСЫВАНИЕ ЗДЕСЬ БЕЗОПАСНО (в отличие от FIXED_BLOCK). Выброшенная операция
            // означает «задание остаётся там, где стои́т» — а это и есть требуемый результат. Дыры в
            // дне не возникает: 🔒 никуда не уезжала. День при этом вправе уйти за потолок — так и
            // решено 30.07.2026, и это видно оператору (см. DAY_CAPACITY: такой перебор законен).
            //
            // РУЧНОЕ ДЕЙСТВИЕ. Страж зовётся с actor:'auto' ВСЕГДА — даже когда пересчёт вызвал
            // перенос оператора (поэтому и у FROZEN_DAY исключение сделано предикатом, #4494). Значит
            // одного actor'а недостаточно: задание, которое оператор несёт ПРЯМО СЕЙЧАС
            // (`ctx.isManualMoveCut` из `moveScope.wholeDayCutIds`), правилом не ограничено — ТЗ §15,
            // и это же разрешают #4487/#4491 («по весу» вправе встроиться внутрь 🔒-блока). Запрет
            // защищает ОСТАЛЬНЫЕ 🔒 дня — ровно то, о чём #4511/#4512: «делаю перенос, а оно
            // выкидывает зафиксированные из этого дня».
            check: function(ops, ctx) {
                var isFixed = ppCtxFn(ctx, 'isFixedCut');
                var released = ppCtxFn(ctx, 'isFixedReleasedCut');   // #4512: вердикт упаковщика
                var manual = ppCtxFn(ctx, 'isManualMoveCut');        // задание, которое оператор двигает СЕЙЧАС
                var dayOfCut = (ctx && typeof ctx.dayKeyOfCut === 'function') ? ctx.dayKeyOfCut : null;
                var dayOfTs = (ctx && typeof ctx.dayKeyOfTs === 'function') ? ctx.dayKeyOfTs : null;
                var out = [];
                (ops && ops.updates || []).forEach(function(u) {
                    if (!isFixed(u.cutId) || !dayOfCut || !dayOfTs) return;
                    if (released(u.cutId)) return;   // день физически нерабочий — переезд законен
                    if (manual(u.cutId)) return;     // оператор несёт ЭТУ 🔒 сам — ТЗ §15, он не ограничен
                    var was = dayOfCut(u.cutId), will = dayOfTs(u.planStartTs);
                    if (was != null && will != null && was !== will) {
                        out.push(ppViolation('FIXED_CUT_DAY', u.cutId, 'зафиксированное задание уезжает с ' + was + ' на ' + will,
                            { dayWas: was, dayWill: will }));
                    }
                });
                (ops && ops.deletes || []).forEach(function(id) {
                    if (isFixed(id) && !released(id) && !manual(id)) out.push(ppViolation('FIXED_CUT_DAY', id, 'удаление зафиксированного задания'));
                });
                return out;
            },
            // Те же предикаты, что и в check (иначе страж выбрасывал бы не то, о чём отчитался).
            drop: function(op, ctx, kind) {
                var isFixed = ppCtxFn(ctx, 'isFixedCut');
                var released = ppCtxFn(ctx, 'isFixedReleasedCut');
                var manual = ppCtxFn(ctx, 'isManualMoveCut');
                if (!isFixed(op.cutId) || released(op.cutId) || manual(op.cutId)) return false;
                if (kind === 'delete') return true;
                if (kind === 'create') return false;   // продолжение — дело CHAIN_CONTIGUOUS, не переезд 🔒
                var dayOfCut = (ctx && typeof ctx.dayKeyOfCut === 'function') ? ctx.dayKeyOfCut : null;
                var dayOfTs = (ctx && typeof ctx.dayKeyOfTs === 'function') ? ctx.dayKeyOfTs : null;
                if (!dayOfCut || !dayOfTs) return false;
                var was = dayOfCut(op.cutId), will = dayOfTs(op.planStartTs);
                return was != null && will != null && was !== will;
            }
        },
        {
            id: 'FIXED_BLOCK',
            tz: '§15 (🔒-монолит, #4464)',
            actor: 'auto',
            mode: 'audit',      // страж СЧИТАЕТ и кричит, но операцию не выбрасывает — причина в why
            why: 'отбрасывание не чинит порядок: задание осталось бы с прежним planStart, и день получил '
                 + 'бы дыру или наложение (#4300/#4312). Запрет обеспечен ПО ПОСТРОЕНИЮ в слое размещения и '
                 + 'упаковщике; шлюз — аудит на всех путях записи',
            title: 'Зафиксированные задания одного дня — монолит: порядок между собой не меняется, между ними ничего не вставляется',
            // ЧТО ЗАПРЕЩЕНО. В пределах ОДНОГО дня одного станка: (1) менять взаимный порядок 🔒;
            // (2) ставить между двумя 🔒, стоявшими подряд, что-либо ещё. ЧТО РАЗРЕШЕНО: двигать
            // цепочку 🔒 целиком (сколько угодно), переставлять свободные задания вокруг неё,
            // ставить свободное ВПЛОТНУЮ к 🔒. На СТЫКЕ ДНЕЙ правило не действует: хвост дня N и
            // голова дня N+1 монолита не образуют (между ними и так ночь).
            //
            // ПОЧЕМУ mode:'audit'. Выбросить операцию нельзя: порядок этим не чинится — задание
            // просто останется с прежним `planStart`, и день получит дыру или наложение (рецидив
            // #4300/#4312). Запрет обеспечен ПО ПОСТРОЕНИЮ там, где собирается порядок: слой
            // размещения (точка вставки между двумя 🔒 одного дня недопустима), упаковщик дня
            // (после 🔒 сразу берётся следующее 🔒 монолита) и внутридневная пересортировка
            // (`resequenceWithinDays` не переставляет 🔒). Шлюз — АУДИТ: ловит регрессию на всех
            // путях записи разом и кричит в консоль.
            //
            // ctx.planSnapshot() → [{ id, slitterId, planStartTs, fixed }] — ХРАНИМЫЙ план (что
            // стои́т сейчас). Нет предиката → правило не срабатывает (общая конвенция реестра).
            check: function(ops, ctx) {
                var snapFn = (ctx && typeof ctx.planSnapshot === 'function') ? ctx.planSnapshot : null;
                var dayOfTs = (ctx && typeof ctx.dayKeyOfTs === 'function') ? ctx.dayKeyOfTs : null;
                if (!snapFn || !dayOfTs) return [];
                var snap = snapFn() || [];
                var isFixed = ppCtxFn(ctx, 'isFixedCut');
                // Итоговый план = хранимый + операции (пишутся только изменившиеся записи, #3427).
                var byId = {};
                snap.forEach(function(r) {
                    if (!r || r.id == null) return;
                    byId[String(r.id)] = { id: String(r.id), sid: String(r.slitterId == null ? '' : r.slitterId),
                                           ts: Number(r.planStartTs), fixed: !!(r.fixed || isFixed(r.id)) };
                });
                (ops && ops.updates || []).forEach(function(u) {
                    var k = String(u.cutId), cur = byId[k];
                    if (!cur) { byId[k] = { id: k, sid: String(u.slitterId == null ? '' : u.slitterId),
                                            ts: Number(u.planStartTs), fixed: !!isFixed(u.cutId) }; return; }
                    cur.ts = Number(u.planStartTs);
                    if (u.slitterId != null) cur.sid = String(u.slitterId);
                });
                (ops && ops.deletes || []).forEach(function(id) { delete byId[String(id)]; });
                (ops && ops.creates || []).forEach(function(cr, i) {
                    if (!cr || cr.planStartTs == null) return;
                    byId['new:' + i] = { id: 'new:' + i, sid: String(cr.slitterId == null ? '' : cr.slitterId),
                                         ts: Number(cr.planStartTs), fixed: false };
                });
                // Разложить план по (станок, день) в хронологии — так же читает очередь экран (#3923).
                function byDay(rows) {
                    var out = {};
                    rows.forEach(function(r) {
                        if (!isFinite(r.ts)) return;
                        var key = r.sid + '|' + dayOfTs(r.ts);
                        (out[key] = out[key] || []).push(r);
                    });
                    Object.keys(out).forEach(function(k) {
                        out[k].sort(function(a, b) { return a.ts - b.ts; });
                    });
                    return out;
                }
                var wasByDay = byDay(snap.map(function(r) {
                    return { id: String(r.id), sid: String(r.slitterId == null ? '' : r.slitterId),
                             ts: Number(r.planStartTs), fixed: !!(r.fixed || isFixed(r.id)) };
                }));
                var nowByDay = byDay(Object.keys(byId).map(function(k) { return byId[k]; }));
                var posNow = {};
                Object.keys(nowByDay).forEach(function(key) {
                    nowByDay[key].forEach(function(r, i) { posNow[r.id] = { key: key, i: i }; });
                });
                var out = [];
                // #4491: пару 🔒 проверяем ТАМ, ГДЕ ОНА ОКАЗАЛАСЬ, а не только в её прежнем дне.
                // Прежде пара пропускалась, если хоть одно звено сменило день (`a.key !== key`) —
                // а боевой случай выглядит ровно так: потолок дня (#4467) увозит монолит на
                // следующий день, и там его звенья переставлялись или раздвигались, а шлюз молчал.
                // Теперь достаточно, чтобы ОБА звена оказались в одном дне одного станка: где бы
                // монолит ни очутился, порядок и соседство внутри него обязаны сохраниться.
                // Разъехались по РАЗНЫМ дням — это FIXED_CUT_DAY (законный переезд по потолку),
                // соседства там требовать нечего: между днями и так ночь.
                Object.keys(wasByDay).forEach(function(key) {
                    var fixedWas = wasByDay[key].filter(function(r) { return r.fixed; });
                    for (var i = 0; i < fixedWas.length; i++) {
                        var a = posNow[fixedWas[i].id];
                        if (!a) continue;   // задание удалено — это FIXED_CUT_DAY
                        if (i + 1 < fixedWas.length) {
                            var b = posNow[fixedWas[i + 1].id];
                            if (!b || b.key !== a.key) continue;   // звенья в разных днях — FIXED_CUT_DAY
                            var atKey = a.key;   // день, ГДЕ пара оказалась (свой или тот, куда переехала)
                            if (b.i < a.i) {
                                out.push(ppViolation('FIXED_BLOCK', fixedWas[i + 1].id,
                                    'зафиксированные задания дня переставлены местами: ' + fixedWas[i].id + ' ↔ ' + fixedWas[i + 1].id,
                                    { slitterId: atKey.split('|')[0], dayKey: Number(atKey.split('|')[1]),
                                      kind: 'swap', otherCutId: String(fixedWas[i].id) }));
                                continue;
                            }
                            // Стояли ПОДРЯД в хранимом плане → обязаны остаться соседями.
                            var wasIdxA = wasByDay[key].indexOf(fixedWas[i]);
                            var wasIdxB = wasByDay[key].indexOf(fixedWas[i + 1]);
                            if (wasIdxB === wasIdxA + 1 && b.i !== a.i + 1) {
                                var betweenIds = nowByDay[atKey].slice(a.i + 1, b.i).map(function(r) { return String(r.id); });
                                var between = betweenIds.join(', ');
                                out.push(ppViolation('FIXED_BLOCK', fixedWas[i + 1].id,
                                    'между зафиксированными ' + fixedWas[i].id + ' и ' + fixedWas[i + 1].id
                                    + ' вклинилось: ' + (between || '?'),
                                    { slitterId: atKey.split('|')[0], dayKey: Number(atKey.split('|')[1]),
                                      kind: 'insert', otherCutId: String(fixedWas[i].id), betweenIds: betweenIds }));
                            }
                        }
                    }
                });
                return out;
            }
        },
        {
            id: 'FIXED_NO_PUSH',
            tz: '§15 (#4497)',
            actor: 'auto',
            mode: 'audit',      // страж СЧИТАЕТ и кричит, но операцию не выбрасывает — причина в why
            why: 'то же, что у FIXED_BLOCK: место в дне чинится построением очереди, а не отказом от '
                 + 'записи — выброшенная операция оставила бы день с дырой (#4300)',
            title: 'Перед зафиксированным (🔒) заданием автоматика ничего не ставит: 🔒 не сдвигают ни новое задание, ни хвост разбиения',
            // ЧТО ЗАПРЕЩЕНО. Поставить в дне 🔒 ПЕРЕД ней то, чего перед ней не было: новое задание
            // «Сгенерировать», приезжее с другого дня/станка, хвост разбиения соседа. Симптом до
            // правила: «Сгенерировать вставляет задание в начало дня, двигая весь паровоз
            // зафиксированных заданий после него» (issue #4497) — замок держал ДЕНЬ, но не место в
            // дне, и все 🔒 уезжали на своё время + длительность вставленного.
            //
            // ЧТО РАЗРЕШЕНО: задание, стоявшее перед этой 🔒 в ХРАНИМОМ плане, остаётся на месте
            // (иначе правило переворачивало бы дни на путях ручного порядка); 🔒 сдвигает ДРУГАЯ 🔒
            // (законный переезд по потолку, #4467/#4491 — их взаимный порядок судит FIXED_BLOCK);
            // время старта 🔒 внутри её дня может стать РАНЬШЕ (соседи ушли — дыр в дне не держим,
            // #4300); переезд 🔒 в другой день — дело FIXED_CUT_DAY, соседства там требовать нечего.
            // Ручной перенос (ctx.isManualMoveCut) не ограничен: ТЗ §15 — «ручное действие оператора
            // этими запретами не ограничено», а задание, которое оператор несёт «по весу» прямо
            // сейчас, вправе встроиться туда, где §8 насчитал минимальный штраф (#4487/#4491).
            //
            // ЦЕПОЧКА, А НЕ ЗАПИСЬ. Разбитое по дням задание живёт цепочкой записей, и при пересборке
            // хвост пересоздаётся заново (новый id). Сравнивать по id значило бы объявлять нарушением
            // ИДЕМПОТЕНТНУЮ пересборку того же плана, поэтому «кто стоял перед 🔒» считаем по
            // ЦЕПОЧКЕ («ID первой части», chainId снимка): хвост той же работы на том же месте —
            // не сдвиг.
            //
            // ПОЧЕМУ mode:'audit'. Выбросить операцию нельзя: порядок этим не чинится — задание
            // осталось бы с прежним `planStart`, и день получил бы дыру или наложение (рецидив
            // #4300/#4312), как и у FIXED_BLOCK. Запрет обеспечен ПО ПОСТРОЕНИЮ: слой размещения
            // (точка вставки перед 🔒 её дня недопустима), упаковщик (🔒 своего дня берётся раньше
            // свободных; задание не рвётся в день, чья голова 🔒 — уезжает целиком) и внутридневная
            // пересортировка (день с 🔒 не переупорядочивается). Шлюз — АУДИТ: ловит регрессию на
            // всех путях записи разом.
            //
            // ctx.planSnapshot() → [{ id, slitterId, planStartTs, fixed, chainId }] — ХРАНИМЫЙ план.
            // Нет предиката → правило не срабатывает (общая конвенция реестра).
            check: function(ops, ctx) {
                var snapFn = (ctx && typeof ctx.planSnapshot === 'function') ? ctx.planSnapshot : null;
                var dayOfTs = (ctx && typeof ctx.dayKeyOfTs === 'function') ? ctx.dayKeyOfTs : null;
                if (!snapFn || !dayOfTs) return [];
                var snap = snapFn() || [];
                var isFixed = ppCtxFn(ctx, 'isFixedCut');
                var isManual = ppCtxFn(ctx, 'isManualMoveCut');
                function chainKey(r) {
                    var c = (r && r.chainId != null) ? String(r.chainId).trim() : '';
                    return c !== '' ? c : String(r && r.id);
                }
                // Итоговый план = хранимый + операции (пишутся только изменившиеся записи, #3427).
                var chainById = {}, storedById = {};
                snap.forEach(function(r) {
                    if (!r || r.id == null) return;
                    var k = String(r.id);
                    chainById[k] = chainKey(r);
                    storedById[k] = { id: k, chain: chainById[k], sid: String(r.slitterId == null ? '' : r.slitterId),
                                      ts: Number(r.planStartTs), fixed: !!(r.fixed || isFixed(r.id)) };
                });
                var byId = {};
                Object.keys(storedById).forEach(function(k) {
                    var s = storedById[k];
                    byId[k] = { id: s.id, label: s.id, chain: s.chain, sid: s.sid, ts: s.ts, fixed: s.fixed };
                });
                (ops && ops.updates || []).forEach(function(u) {
                    var k = String(u.cutId), cur = byId[k];
                    if (!cur) {
                        byId[k] = { id: k, label: k, chain: k, sid: String(u.slitterId == null ? '' : u.slitterId),
                                    ts: Number(u.planStartTs), fixed: !!isFixed(u.cutId) };
                        return;
                    }
                    cur.ts = Number(u.planStartTs);
                    if (u.slitterId != null) cur.sid = String(u.slitterId);
                });
                (ops && ops.deletes || []).forEach(function(id) { delete byId[String(id)]; });
                (ops && ops.creates || []).forEach(function(cr, i) {
                    if (!cr || cr.planStartTs == null) return;
                    var parent = cr.parentCutId == null ? '' : String(cr.parentCutId);
                    // Хвост 🔒 считаем зафиксированным: его день диктует потолок (#4304/#4467), и
                    // «🔒 сдвигает другая 🔒» — не нарушение этого правила (см. выше).
                    byId['new:' + i] = { id: 'new:' + i, label: parent || ('new:' + i),
                                         chain: chainById[parent] || parent || ('new:' + i),
                                         sid: String(cr.slitterId == null ? '' : cr.slitterId),
                                         ts: Number(cr.planStartTs), fixed: !!isFixed(parent) };
                });
                // Разложить план по (станок, день) в хронологии — так же читает очередь экран (#3923).
                function byDay(rows) {
                    var out = {};
                    rows.forEach(function(r) {
                        if (!isFinite(r.ts)) return;
                        (out[r.sid + '|' + dayOfTs(r.ts)] = out[r.sid + '|' + dayOfTs(r.ts)] || []).push(r);
                    });
                    Object.keys(out).forEach(function(k) { out[k].sort(function(a, b) { return a.ts - b.ts; }); });
                    return out;
                }
                var storedRows = Object.keys(storedById).map(function(k) { return storedById[k]; });
                var wasByDay = byDay(storedRows);
                var nowByDay = byDay(Object.keys(byId).map(function(k) { return byId[k]; }));
                var out = [];
                Object.keys(nowByDay).forEach(function(key) {
                    var rows = nowByDay[key];
                    rows.forEach(function(f, fi) {
                        if (!f.fixed || isManual(f.id)) return;   // ручной перенос самой 🔒 — выбор оператора
                        var st = storedById[f.id];
                        // 🔒 сменила день/станок — это FIXED_CUT_DAY (законный переезд по потолку).
                        if (!st || st.sid !== f.sid || !isFinite(st.ts) || (st.sid + '|' + dayOfTs(st.ts)) !== key) return;
                        var beforeStored = {};
                        (wasByDay[key] || []).forEach(function(r) { if (r.ts < st.ts) beforeStored[r.chain] = true; });
                        var pushedBy = rows.slice(0, fi).filter(function(r) {
                            return !r.fixed && !isManual(r.id) && !beforeStored[r.chain];
                        });
                        if (!pushedBy.length) return;
                        var labels = pushedBy.map(function(r) { return String(r.label); });
                        out.push(ppViolation('FIXED_NO_PUSH', f.id,
                            'перед зафиксированным ' + f.id + ' встало: ' + labels.join(', '),
                            { slitterId: key.split('|')[0], dayKey: Number(key.split('|')[1]),
                              kind: 'before', beforeIds: labels }));
                    });
                });
                return out;
            }
        },
        {
            id: 'DAY_CAPACITY',
            tz: '§15 (потолок дня, #4467)',
            actor: 'auto',
            mode: 'audit',      // страж СЧИТАЕТ и кричит, но операцию не выбрасывает — причина в why
            why: 'переполнение дня — свойство всей раскладки, а не отдельной «плохой» записи: выбросив '
                 + 'часть операций, получим дыры и потерянные задания (#4300/#4312). Держит упаковщик '
                 + 'splitMachineQueue; шлюз — аудит',
            title: 'Станко-день не длиннее смены с нахлёстом: сумма минут дня ≤ ёмкость + нахлёст',
            // ЧТО ПРОВЕРЯЕТСЯ. Занятость станко-дня — наладка + намотка (лидер внутри намотки), ровно
            // та сумма, что стои́т в бейдже «(N мин)» у даты. Потолок — ёмкость смены (окно резки минус
            // обед) плюс нахлёст настройки. Превышение значит, что план обещает работу, которой в
            // смене физически нет: день «разбухает», а бейдж показывает 690 при потолке 460 (#4467,
            // рецидивы #4034/#3965 «опять 492 и 427»).
            //
            // ЗА НАПОЛНЕНИЕ ДНЯ ОТВЕЧАЕТ ОПЕРАТОР — за физику смены отвечает планировщик. Переносить и
            // фиксировать сколько угодно заданий можно; лишнее уезжает на следующий день (сперва
            // незафиксированное, затем 🔒 — не меняя своего порядка), а длинное рвётся по потолку.
            //
            // ПОЧЕМУ mode:'audit'. Отбрасывать операции нечего: переполнение дня — это НЕ отдельная
            // «плохая» запись, а свойство всей раскладки; выбросив часть, мы получим дыры и потерянные
            // задания (#4300/#4312). Соблюдение обеспечивает упаковщик (`splitMachineQueue`: 🔒 рвётся
            // по потолку и уезжает целиком, если не влезает ни один проход), шлюз — АУДИТ: ловит
            // регрессию на любом пути записи и кричит.
            //
            // ctx.dayLoadMinutes() → { 'станок|ГГГГММДД': минуты }, ctx.dayCapacityMin() → число.
            // Источник нагрузки — сам движок (`planCutOperations` → `ops.dayLoad`): окна и разбиение
            // по дням знает только он. Нет предикатов → правило не срабатывает (конвенция реестра).
            // #4512 (решение заказчика 30.07.2026): ЗАКОННЫЙ ПЕРЕБОР. Если в дне стои́т 🔒, которую
            // вытеснять НЕЛЬЗЯ, день обязан её вместить — и вправе уйти за потолок. Такой день —
            // не нарушение, а следствие приоритета «замок сильнее потолка» (обратно #4467). Список
            // таких станко-дней даёт упаковщик (`onFixedDayHeld` → `ops.fixedDayHeld`), а не
            // пересчёт в страже. Без этого исключения аудит ругался бы на КАЖДЫЙ такой день, а
            // сообщения стража оператор видит с #4475 — то есть мы бы штатно врали ему в лицо.
            check: function(ops, ctx) {
                var loadFn = (ctx && typeof ctx.dayLoadMinutes === 'function') ? ctx.dayLoadMinutes : null;
                var capFn = (ctx && typeof ctx.dayCapacityMin === 'function') ? ctx.dayCapacityMin : null;
                if (!loadFn || !capFn) return [];
                var cap = Number(capFn());
                if (!isFinite(cap) || cap <= 0) return [];
                var load = loadFn() || {};
                var heldFn = (ctx && typeof ctx.fixedHeldDays === 'function') ? ctx.fixedHeldDays : null;
                var held = {};
                (heldFn ? (heldFn() || []) : []).forEach(function(k) { held[String(k)] = true; });
                var out = [];
                Object.keys(load).forEach(function(key) {
                    var min = Number(load[key]);
                    if (!isFinite(min) || min <= cap + 1e-6) return;
                    if (held[String(key)]) return;   // #4512: перебор из-за неснимаемой 🔒 — законен
                    var parts = String(key).split('|');
                    out.push(ppViolation('DAY_CAPACITY', null,
                        'станок ' + parts[0] + ', день ' + parts[1] + ': ' + Math.round(min)
                        + ' мин при потолке ' + Math.round(cap) + ' (превышение ' + Math.round(min - cap) + ')',
                        { slitterId: parts[0], dayKey: Number(parts[1]), loadMin: Math.round(min),
                          capMin: Math.round(cap), overMin: Math.round(min - cap) }));
                });
                return out;
            }
        },
        {
            id: 'DAY_FILL',
            tz: '§15 (упаковка дня, #4469)',
            actor: 'auto',
            mode: 'audit',      // страж СЧИТАЕТ и кричит, но операцию не выбрасывает — причина в why
            why: 'дыра в дне — свойство всей раскладки: выбросив операцию, получим не плотный день, а '
                 + 'потерянное задание (#4300/#4312). Держит упаковщик splitMachineQueue; шлюз — аудит',
            title: 'Станко-день пакуется до потолка: если в его остаток влезает проход первого задания следующего дня — день обязан его забрать',
            // ЗЕРКАЛО DAY_CAPACITY (#4467). Тот ловит день ДЛИННЕЕ смены, этот — день КОРОЧЕ, чем
            // можно набить: разбитое по дням задание обязано отдать вчерашнему дню максимум проходов,
            // какой влезает под потолок нахлёста, а всё, что стои́т после него, — съехать. Иначе смена
            // держит 424 мин при потолке 455, а назавтра лежит продолжение на 24 прохода по 2.33 мин
            // (issue #4469: «после ручного переноса и „Упорядочить“ день не забивается»).
            //
            // НЕ НАРУШЕНИЕ: завтрашнее задание зафиксировано 🔒 (замок дня абсолютен, #4434), день —
            // приёмник или донор — заморожен (#4436), в остаток не влезает даже один проход вместе с
            // наладкой донора (проход атомарен, #4149), следующего дня с работой нет.
            //
            // ПОЧЕМУ mode:'audit'. Отбрасывать нечего: дыра в дне — свойство всей раскладки, а не
            // отдельной «плохой» записи; выбросив операцию, мы получим не плотный день, а потерянное
            // задание (#4300/#4312). Соблюдение обеспечивает упаковщик (splitMachineQueue кладёт
            // столько проходов, сколько влезает до потолка) и объектив «Упорядочить» (недоупакованные
            // дни — член выше переналадки, иначе плотный план выбрасывался как «не лучше», #4413).
            // Шлюз — АУДИТ: ловит регрессию на любом пути записи и кричит.
            //
            // ctx.underfilledDays() → [{ key:'станок|ГГГГММДД', freeMin, needMin, donorCutId }].
            // Источник — сам движок (`planCutOperations` → `ops.dayFill`): остаток дня меряется тем же
            // гейтом потолка, которым паковали. Нет предиката → правило не срабатывает (конвенция реестра).
            check: function(ops, ctx) {
                var listFn = (ctx && typeof ctx.underfilledDays === 'function') ? ctx.underfilledDays : null;
                if (!listFn) return [];
                var list = listFn() || [];
                return list.map(function(u) {
                    var parts = String((u && u.key) || '').split('|');
                    return ppViolation('DAY_FILL', null,
                        'станок ' + parts[0] + ', день ' + parts[1] + ': свободно ' + Math.round(Number(u.freeMin) || 0)
                        + ' мин, а проход задания ' + (u.donorCutId == null ? '?' : u.donorCutId)
                        + ' следующего дня стои́т ' + Math.round((Number(u.needMin) || 0) * 100) / 100
                        + ' мин — день недоупакован',
                        { slitterId: parts[0], dayKey: Number(parts[1]),
                          freeMin: Math.round(Number(u.freeMin) || 0),
                          needMin: Math.round((Number(u.needMin) || 0) * 100) / 100,
                          donorCutId: u.donorCutId == null ? null : String(u.donorCutId) });
                });
            }
        },
        {
            id: 'CHAIN_CONTIGUOUS',
            tz: '§15 (#4488)',
            actor: 'any',       // хвост нельзя оставлять ни автоматике, ни человеку
            mode: 'audit',     // отбрасывать нечего: разрыв чинится СШИВАНИЕМ задания, а не отказом
            why: 'отбрасывать нечего: разрыв цепочки чинится СШИВАНИЕМ задания в одну запись (#4488), а не '
                 + 'отказом от записи',
            title: 'Части задания, разорванного по дням, идут непрерывно: между ними нет чужих заданий',
            // ЧТО ПРОВЕРЯЕТСЯ. Задание, не влезшее в смену, живёт цепочкой записей (голова +
            // продолжения, общий «ID первой части»). Работа непрерывна: продолжение начинается там,
            // где кончилась голова, — следующим на том же станке. Если между частями встало чужое
            // задание, работа разорвана: станок перезаправляют туда-обратно, а оператор видит
            // огрызок в один проход (issue #4488: голова в 1 проход на 3-м месте дня, 11 проходов —
            // назавтра).
            //
            // ПОЧЕМУ mode:'audit'. Выбросить операцию нельзя: разрыв — свойство раскладки, а не
            // одной записи; отказ оставил бы задание разорванным ровно так же. Чинится он ДО
            // планирования — части сшиваются в одну запись (`mergeSplitChain` на ручных путях), и
            // дальше планировщик режет уже целое от нового места. Правило здесь — детектор: если
            // сработало, значит какой-то путь снова кладёт части врозь.
            //
            // ctx.planSnapshot() → [{ id, slitterId, planStartTs, fixed, chainId }]. `chainId` —
            // маркер цепочки («ID первой части»); нет его ни у одной записи → правило не срабатывает
            // (общая конвенция реестра: нет данных — нет обвинений).
            check: function(ops, ctx) {
                var snapFn = (ctx && typeof ctx.planSnapshot === 'function') ? ctx.planSnapshot : null;
                var dayOfTs = (ctx && typeof ctx.dayKeyOfTs === 'function') ? ctx.dayKeyOfTs : null;
                if (!snapFn || !dayOfTs) return [];
                var snap = snapFn() || [];
                if (!snap.some(function(r) { return r && r.chainId != null && String(r.chainId) !== ''; })) return [];
                // Итоговый план = хранимый + операции (пишутся только изменившиеся записи, #3427).
                var byId = {};
                snap.forEach(function(r) {
                    if (!r || r.id == null) return;
                    byId[String(r.id)] = { id: String(r.id), sid: String(r.slitterId == null ? '' : r.slitterId),
                                           ts: Number(r.planStartTs), chain: String(r.chainId == null ? '' : r.chainId) };
                });
                (ops && ops.updates || []).forEach(function(u) {
                    var k = String(u.cutId), cur = byId[k];
                    if (!cur) return;   // запись вне снимка — цепочки по ней не знаем
                    cur.ts = Number(u.planStartTs);
                    if (u.slitterId != null) cur.sid = String(u.slitterId);
                });
                (ops && ops.deletes || []).forEach(function(id) { delete byId[String(id)]; });
                var rows = Object.keys(byId).map(function(k) { return byId[k]; })
                    .filter(function(r) { return isFinite(r.ts); });
                // Порядок на станке — по времени старта, как читает очередь экран (#3923).
                var bySlitter = {};
                rows.forEach(function(r) { (bySlitter[r.sid] = bySlitter[r.sid] || []).push(r); });
                Object.keys(bySlitter).forEach(function(sid) {
                    bySlitter[sid].sort(function(a, b) { return a.ts - b.ts; });
                });
                var out = [];
                Object.keys(bySlitter).forEach(function(sid) {
                    var seq = bySlitter[sid];
                    var pos = {};
                    seq.forEach(function(r, i) { pos[r.id] = i; });
                    var chains = {};
                    seq.forEach(function(r) {
                        if (r.chain === '') return;
                        (chains[r.chain] = chains[r.chain] || []).push(r);
                    });
                    Object.keys(chains).forEach(function(chainId) {
                        var parts = chains[chainId];
                        if (parts.length < 2) return;
                        for (var i = 1; i < parts.length; i++) {
                            var prev = parts[i - 1], cur = parts[i];
                            var gap = pos[cur.id] - pos[prev.id];
                            if (gap === 1) continue;   // части идут подряд — работа непрерывна
                            var between = seq.slice(pos[prev.id] + 1, pos[cur.id]).map(function(r) { return r.id; });
                            out.push(ppViolation('CHAIN_CONTIGUOUS', cur.id,
                                'части задания разорваны: между ' + prev.id + ' и ' + cur.id + ' вклинилось: '
                                + (between.join(', ') || '?'),
                                { slitterId: sid, headCutId: String(prev.id), chainId: String(chainId),
                                  betweenIds: between.map(String),
                                  dayKey: dayOfTs(cur.ts) }));
                        }
                    });
                });
                return out;
            }
        },
        {
            id: 'CUT_BATCH',
            tz: '§15 (#4452)',
            actor: 'any',       // задание без партии — брак независимо от того, кто его тронул
            mode: 'audit',     // отбрасывать нечего: пустая партия чинится подстановкой (fill), не отказом
            why: 'отбрасывать нечего: пустая «Партия сырья» чинится подстановкой (fill правила), а не '
                 + 'отказом — задание без партии не должно исчезнуть, оно должно получить партию',
            title: 'Задание в производство обязано иметь «Партию сырья»',
            // ПОЧЕМУ ЭТО ЖЁСТКОЕ ПРАВИЛО. Партия — учёт сырья: какой физический рулон режет
            // задание (расход, прослеживаемость) и тай-брейк «не перемонтировать рулон» при
            // равной цене порядка. Времени переналадки она не стои́т: подпись заправки — вид
            // сырья и намотка (materialSetupSig, #4481).
            //
            // ПОЧЕМУ FILL, А НЕ ЗАПРЕТ. Отбросить операцию значило бы потерять работу: задание
            // никуда не денется, оно просто останется незапланированным и по-прежнему без партии.
            // Поэтому страж СНАЧАЛА чинит — просит ctx.resolveBatchForCut разрешить партию
            // (цепочка дробления → «Расход сырья» → FIFO активной партии, см. healCutBatches) и
            // проставляет её в саму операцию, чтобы запись плана сохранила её в базу. Нарушением
            // остаётся только то, что разрешить НЕ УДАЛОСЬ, — с причиной, чтобы «непонятно почему»
            // (формулировка тикета) больше не повторялось.
            //
            // ctx.resolveBatchForCut(cutId) → { batchId, source: 'own'|'chain'|'consumption'|'fifo',
            //   reason }. Предиката нет → правило не срабатывает (как и остальные здесь).
            fill: function(ops, ctx) {
                var resolve = (ctx && typeof ctx.resolveBatchForCut === 'function') ? ctx.resolveBatchForCut : null;
                if (!resolve) return [];
                var out = [];
                function stamp(op, cutId) {
                    if (!op || (op.materialBatchId != null && String(op.materialBatchId) !== '')) return;
                    var r = resolve(cutId) || {};
                    // source 'own' — партия уже стои́т в базе, переписывать её нечем и незачем.
                    if (!r.batchId || r.source === 'own') return;
                    op.materialBatchId = String(r.batchId);
                    out.push({ cutId: cutId == null ? null : String(cutId), batchId: String(r.batchId), source: r.source || '' });
                }
                (ops && ops.updates || []).forEach(function(u) { stamp(u, u.cutId); });
                (ops && ops.creates || []).forEach(function(cr) { stamp(cr, cr.parentCutId); });
                return out;
            },
            check: function(ops, ctx) {
                // Предиката нет — правило не срабатывает (общая конвенция реестра): разрешать
                // партию нечем, и объявлять всё подряд нарушением было бы враньём.
                var resolve = (ctx && typeof ctx.resolveBatchForCut === 'function') ? ctx.resolveBatchForCut : null;
                if (!resolve) return [];
                var out = [];
                var seen = {};
                function verify(op, cutId) {
                    if (op && op.materialBatchId != null && String(op.materialBatchId) !== '') return;
                    var key = String(cutId);
                    if (seen[key]) return;
                    var r = resolve(cutId) || {};
                    if (r.batchId) return;
                    seen[key] = true;
                    out.push(ppViolation('CUT_BATCH', cutId, 'задание без «Партии сырья»: ' + (r.reason || 'источник партии не найден'),
                        { reason: String(r.reason || 'источник партии не найден') }));
                }
                (ops && ops.updates || []).forEach(function(u) { verify(u, u.cutId); });
                (ops && ops.creates || []).forEach(function(cr) { verify(cr, cr.parentCutId); });
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

    // Починка операций перед проверкой: правило с `fill` дописывает в операцию недостающие
    // данные (сегодня — «Партию сырья», CUT_BATCH). Возвращает список правок для трассы.
    // Порядок «сначала fill, потом check» существенен: проверка обязана видеть уже починенное,
    // иначе страж ругался бы на то, что сам только что исправил.
    function repairPlanOps(ops, ctx, actor) {
        var who = actor === 'human' ? 'human' : 'auto';
        var out = [];
        PP_INVARIANTS.forEach(function(inv) {
            if (typeof inv.fill !== 'function') return;
            if (inv.actor === 'auto' && who !== 'auto') return;
            out = out.concat(inv.fill(ops, ctx) || []);
        });
        return out;
    }

    // Страж записи: чинит починяемое, убирает из операций то, что нарушает правила режима
    // `mode: 'drop'`, и возвращает ПОЛНЫЙ отчёт (включая наблюдателей `mode: 'audit'`, которые
    // только считают). Возвращает { ops, violations, skipped, filled } — ops мутируется на месте
    // (updates/deletes/creates заменяются отфильтрованными массивами), как и ожидают вызывающие.
    //
    // #4515: ЧТО ВЫБРОСИТЬ, РЕШАЕТ ПРАВИЛО, А НЕ ШЛЮЗ. Раньше эта функция фильтровала операции по
    // вписанным в неё предикатам замороженного дня, поэтому режим отбрасывания у любого ДРУГОГО
    // правила был бы декорацией: флаг стоит, а провода подведены к одному правилу. Теперь шлюз
    // спрашивает `inv.drop(op, ctx, kind)` — и правило отвечает теми же предикатами, которыми
    // отчитывалось в `check`. Механику держит тест `atex-pp-invariants-enforcement.test.js`.
    function guardPlanOps(ops, ctx, actor) {
        return guardPlanOpsWith(PP_INVARIANTS, ops, ctx, actor);
    }

    // Тот же страж по ПРОИЗВОЛЬНОМУ набору правил. Нужен тесту, чтобы проверить механику
    // отбрасывания на правиле, которое не про заморозку, — иначе «работает для любого правила»
    // проверить нечем (в реестре сегодня ровно один `mode: 'drop'`).
    function guardPlanOpsWith(rules, ops, ctx, actor) {
        var who = actor === 'human' ? 'human' : 'auto';
        var applies = function(inv) { return !(inv.actor === 'auto' && who !== 'auto'); };
        var filled = [], violations = [];
        (rules || []).forEach(function(inv) {
            if (!applies(inv) || typeof inv.fill !== 'function') return;
            filled = filled.concat(inv.fill(ops, ctx) || []);
        });
        (rules || []).forEach(function(inv) {
            if (!applies(inv)) return;
            violations = violations.concat(inv.check(ops, ctx) || []);
        });

        // Правила, которые вправе отбрасывать: режим 'drop', актор подходит, предикат есть.
        var droppers = (rules || []).filter(function(inv) {
            return inv.mode === 'drop' && applies(inv) && typeof inv.drop === 'function';
        });
        if (!ops || !droppers.length) return { ops: ops, violations: violations, skipped: 0, filled: filled };

        var skipped = 0;
        function keep(op, kind) {
            for (var i = 0; i < droppers.length; i++) {
                if (droppers[i].drop(op, ctx, kind)) { skipped++; return false; }
            }
            return true;
        }
        ops.updates = (ops.updates || []).filter(function(u) { return keep(u, 'update'); });
        // Удаления — «голые» id: нормализуем в операцию, чтобы у правил была одна форма входа.
        ops.deletes = (ops.deletes || []).filter(function(id) { return keep({ cutId: id }, 'delete'); });
        ops.creates = (ops.creates || []).filter(function(cr) { return keep(cr || {}, 'create'); });
        return { ops: ops, violations: violations, skipped: skipped, filled: filled };
    }

