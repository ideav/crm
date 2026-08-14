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
            title: 'Автоматика не изменяет замороженный день: не двигает и не удаляет его задания и не ставит в него новые (ручное действие оператора — вправе)',
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
            // #4569: РУЧНОЕ ДЕЙСТВИЕ СИЛЬНЕЕ ЗАМОРОЗКИ (решение заказчика 02.08.2026). Правило
            // ограничивает АВТОМАТИКУ — это сказано в его заголовке. Задание, которое оператор несёт
            // ПРЯМО СЕЙЧАС (`ctx.isManualMoveCut`), им не ограничено: то же исключение уже стои́т у
            // FIXED_CUT_DAY. Иначе ручная команда получает отказ и выполняется наполовину — «тут
            // сдвинули, а там не смогли», — а половинчатый результат недопустим: страж снимает
            // операции цепочки целиком (#4536), и задание остаётся с плейсхолдерным временем
            // (боевое #4569: «⏱ 07:59 – 09:53»). Заморозка при этом защищает ОСТАЛЬНЫЕ задания дня —
            // автоматика их по-прежнему не двигает и не удаляет.
            check: function(ops, ctx) {
                var frozenCut = ppCtxFn(ctx, 'isFrozenCut'), frozenTs = ppCtxFn(ctx, 'isFrozenTs');
                var manual = ppCtxFn(ctx, 'isManualMoveCut');
                var out = [];
                (ops && ops.updates || []).forEach(function(u) {
                    if (manual(u.cutId)) return;   // #4569: оператор несёт ЭТО задание сам
                    if (frozenCut(u.cutId)) {
                        if (isFrozenDayTrim(u, ctx)) return;   // #4494: разрыв по потолку в своём дне
                        out.push(ppViolation('FROZEN_DAY', u.cutId, 'сдвиг задания из замороженного дня'));
                    }
                    else if (frozenTs(u.planStartTs)) out.push(ppViolation('FROZEN_DAY', u.cutId, 'перенос задания В замороженный день'));
                });
                (ops && ops.deletes || []).forEach(function(id) {
                    if (manual(id)) return;
                    if (frozenCut(id)) out.push(ppViolation('FROZEN_DAY', id, 'удаление задания замороженного дня'));
                });
                (ops && ops.creates || []).forEach(function(cr) {
                    var parent = cr && cr.parentCutId;
                    if (manual(parent)) return;   // продолжение задания, которое несёт оператор
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
                var manual = ppCtxFn(ctx, 'isManualMoveCut');   // #4569: те же предикаты, что в check
                if (kind === 'delete') return !manual(op.cutId) && frozenCut(op.cutId);
                if (isFrozenDayTrim(op, ctx)) return false;   // #4494: разрыв по потолку — не нарушение
                if (kind === 'create') return !manual(op.parentCutId) && (frozenCut(op.parentCutId) || frozenTs(op.planStartTs));
                return !manual(op.cutId) && (frozenCut(op.cutId) || frozenTs(op.planStartTs));
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
            //
            // #4736 (решение заказчика 13.08.2026). РУЧНОЕ ДЕЙСТВИЕ ДВИГАЕТ И СОСЕДЕЙ ПОД 🔒. Одного
            // `isManualMoveCut` мало: он освобождает только НЕСОМОЕ задание, а уехать обязан ВЕСЬ
            // ХВОСТ ОЧЕРЕДИ за ним — иначе удаление оставляет дыру, а перенос распирает день, потому
            // что соседи зафиксированы и «не могут быть перемещены в другой день или разбиты»
            // (#4732). Кого именно двигает это действие, решает ОДИН расчёт (`manualShiftFixedIds`),
            // и его вердикт правило спрашивает предикатом `ctx.isFixedShiftedCut` — тот же набор
            // получает упаковщик. Замок при этом не отменён: он держит ПОРЯДОК (🔒 остаётся там же в
            // очереди) и по-прежнему абсолютен для АВТОМАТИКИ — «Сгенерировать»/«Упорядочить»
            // признака не ставят и ничего с 🔒 сделать не могут.
            check: function(ops, ctx) {
                var isFixed = ppCtxFn(ctx, 'isFixedCut');
                var released = ppCtxFn(ctx, 'isFixedReleasedCut');   // #4512: вердикт упаковщика
                var manual = ppCtxFn(ctx, 'isManualMoveCut');        // задание, которое оператор двигает СЕЙЧАС
                var shifted = ppCtxFn(ctx, 'isFixedShiftedCut');     // #4736: 🔒 в хвосте ручного сдвига
                var dayOfCut = (ctx && typeof ctx.dayKeyOfCut === 'function') ? ctx.dayKeyOfCut : null;
                var dayOfTs = (ctx && typeof ctx.dayKeyOfTs === 'function') ? ctx.dayKeyOfTs : null;
                var out = [];
                (ops && ops.updates || []).forEach(function(u) {
                    if (!isFixed(u.cutId) || !dayOfCut || !dayOfTs) return;
                    if (released(u.cutId)) return;   // день физически нерабочий — переезд законен
                    if (manual(u.cutId)) return;     // оператор несёт ЭТУ 🔒 сам — ТЗ §15, он не ограничен
                    if (shifted(u.cutId)) return;    // #4736: её двигает ручное действие над соседом
                    var was = dayOfCut(u.cutId), will = dayOfTs(u.planStartTs);
                    if (was != null && will != null && was !== will) {
                        out.push(ppViolation('FIXED_CUT_DAY', u.cutId, 'зафиксированное задание уезжает с ' + was + ' на ' + will,
                            { dayWas: was, dayWill: will }));
                    }
                });
                (ops && ops.deletes || []).forEach(function(id) {
                    if (isFixed(id) && !released(id) && !manual(id) && !shifted(id)) out.push(ppViolation('FIXED_CUT_DAY', id, 'удаление зафиксированного задания'));
                });
                return out;
            },
            // Те же предикаты, что и в check (иначе страж выбрасывал бы не то, о чём отчитался).
            drop: function(op, ctx, kind) {
                var isFixed = ppCtxFn(ctx, 'isFixedCut');
                var released = ppCtxFn(ctx, 'isFixedReleasedCut');
                var manual = ppCtxFn(ctx, 'isManualMoveCut');
                var shifted = ppCtxFn(ctx, 'isFixedShiftedCut');   // #4736
                if (!isFixed(op.cutId) || released(op.cutId) || manual(op.cutId) || shifted(op.cutId)) return false;
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
            id: 'FIXED_NO_OVERTAKE',
            tz: '§15 (#4542)',
            actor: 'auto',
            mode: 'audit',      // страж СЧИТАЕТ и кричит, но операцию не выбрасывает — причина в why
            why: 'то же, что у FIXED_NO_PUSH: очерёдность чинится построением плана, а не отказом от '
                 + 'записи — выброшенная операция оставила бы задание с прежним planStart',
            title: 'Автоматика не обгоняет зафиксированные (🔒) задания: подвижное не уезжает в день раньше замка, за которым стояло',
            // ЧТО ЗАПРЕЩЕНО. Поставить подвижное задание РАНЬШЕ (по времени старта) 🔒 того же станка,
            // если в ХРАНИМОМ плане оно стояло позже неё либо места в плане не имело вовсе. Симптом до
            // правила: диспетчер добавил задания по позициям на 03.08 — набивка ранних дней («тянем
            // будущее вперёд», #3739/#4469) перенесла их в 31.07, обогнав замки этого дня, и станко-день
            // стал 580 мин при потолке 460 (issue #4542). Правило #4497 защищало место 🔒 только ВНУТРИ
            // её дня и междневный обгон не ловило.
            //
            // ЧТО РАЗРЕШЕНО: задание, стоявшее перед этой 🔒 в хранимом плане на ТОМ ЖЕ станке (его
            // место не переворачиваем); ручное действие оператора (ТЗ §15 — `isManualMoveCut`); 🔒 сама
            // (её порядок между замками судит FIXED_BLOCK, день — FIXED_CUT_DAY). Соседство с 🔒 в
            // пределах ОДНОГО дня — дело FIXED_NO_PUSH; здесь речь о том, что задание уехало РАНЬШЕ.
            //
            // ПОЧЕМУ mode:'audit'. Как и у FIXED_NO_PUSH: выбросить операцию нельзя — очерёдность этим
            // не чинится. Запрет обеспечен ПО ПОСТРОЕНИЮ: слой размещения (точка вставки перед такой 🔒
            // недопустима, `overtakesFixed`) и упаковщик (день раньше замка для такого задания закрыт,
            // `fixedFloorDay`). Шлюз — АУДИТ: ловит регрессию на всех путях записи разом.
            //
            // ctx.planSnapshot() → [{ id, slitterId, planStartTs, fixed }] — ХРАНИМЫЙ план.
            // Нет предиката → правило не срабатывает (общая конвенция реестра).
            check: function(ops, ctx) {
                var snapFn = (ctx && typeof ctx.planSnapshot === 'function') ? ctx.planSnapshot : null;
                if (!snapFn) return [];
                var snap = snapFn() || [];
                var isFixed = ppCtxFn(ctx, 'isFixedCut');
                var isManual = ppCtxFn(ctx, 'isManualMoveCut');
                var storedById = {};
                snap.forEach(function(r) {
                    if (!r || r.id == null) return;
                    storedById[String(r.id)] = { sid: String(r.slitterId == null ? '' : r.slitterId),
                                                 ts: Number(r.planStartTs), fixed: !!(r.fixed || isFixed(r.id)) };
                });
                // Итоговый план = хранимый + операции (пишутся только изменившиеся записи, #3427).
                var byId = {};
                Object.keys(storedById).forEach(function(k) {
                    byId[k] = { id: k, label: k, sid: storedById[k].sid, ts: storedById[k].ts, fixed: storedById[k].fixed };
                });
                (ops && ops.updates || []).forEach(function(u) {
                    var k = String(u.cutId), cur = byId[k];
                    if (!cur) { byId[k] = { id: k, label: k, sid: String(u.slitterId == null ? '' : u.slitterId),
                                            ts: Number(u.planStartTs), fixed: !!isFixed(u.cutId) }; return; }
                    cur.ts = Number(u.planStartTs);
                    if (u.slitterId != null) cur.sid = String(u.slitterId);
                });
                (ops && ops.deletes || []).forEach(function(id) { delete byId[String(id)]; });
                (ops && ops.creates || []).forEach(function(cr, i) {
                    if (!cr || cr.planStartTs == null) return;
                    var parent = cr.parentCutId == null ? '' : String(cr.parentCutId);
                    // Хвост разбиения наследует признаки головы: её 🔒 и её хранимое место.
                    byId['new:' + i] = { id: 'new:' + i, label: parent || ('new:' + i),
                                         sid: String(cr.slitterId == null ? '' : cr.slitterId),
                                         ts: Number(cr.planStartTs), fixed: !!isFixed(parent),
                                         storedAs: parent };
                });
                var rows = Object.keys(byId).map(function(k) { return byId[k]; })
                    .filter(function(r) { return isFinite(r.ts); });
                var fixedRows = rows.filter(function(r) { return r.fixed; });
                var out = [];
                rows.forEach(function(m) {
                    if (m.fixed || isManual(m.id)) return;   // 🔒 и ручное действие правилом не связаны
                    var stored = storedById[String(m.storedAs != null ? m.storedAs : m.id)];
                    fixedRows.forEach(function(f) {
                        if (f.sid !== m.sid || !(m.ts < f.ts) || isManual(f.id)) return;
                        var fs = storedById[String(f.id)];
                        if (!fs || !isFinite(fs.ts)) return;          // хранимого места у 🔒 нет — защищать нечего
                        // Стояло перед ней в хранимом плане на том же станке — его место не трогаем.
                        if (stored && isFinite(stored.ts) && stored.sid === fs.sid && stored.ts < fs.ts) return;
                        out.push(ppViolation('FIXED_NO_OVERTAKE', m.id,
                            'задание ' + m.label + ' встало раньше зафиксированного ' + f.id,
                            { slitterId: m.sid, otherCutId: String(f.id), kind: 'overtake' }));
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
                // #4759: СТАНКО-ДЕНЬ, У КОТОРОГО СТРАЖ СНЯЛ ОПЕРАЦИИ, НЕ СУДИМ. Занятость (`load`)
                // считал упаковщик по СВОЕЙ раскладке — до отбрасывания; после него число дню
                // больше не соответствует, а честно пересчитать его снаружи нельзя: гейт потолка
                // (обед, простои, атомарность прохода, #4149) знает только упаковщик. Промолчать
                // здесь правильнее, чем соврать: боевая форма — движок вытащил работу из
                // ЗАМОРОЖЕННОГО дня в соседний и насчитал там 475 при потолке 455, страж операции
                // снял, в дне осталось 150, а правило рапортовало «превышение 20». День
                // пересматривается следующей записью, уже с верной меркой.
                var dayOfTs = (ctx && typeof ctx.dayKeyOfTs === 'function') ? ctx.dayKeyOfTs : null;
                var stale = {};
                var droppedSets = (ops && ops.droppedOps) || null;
                if (droppedSets && dayOfTs) {
                    [droppedSets.updates || [], droppedSets.creates || []].forEach(function(list) {
                        list.forEach(function(op) {
                            // Станок известен только у операций размещения; у остальных приписать
                            // день некому — такой станко-день судим как прежде.
                            var sid = op && op.slitterId;
                            if (sid == null || String(sid) === '' || op.planStartTs == null) return;
                            var k = dayOfTs(op.planStartTs);
                            if (k == null) return;
                            stale[String(sid) + '|' + k] = true;
                        });
                    });
                }
                var out = [];
                Object.keys(load).forEach(function(key) {
                    var min = Number(load[key]);
                    if (!isFinite(min) || min <= cap + 1e-6) return;
                    if (held[String(key)]) return;   // #4512: перебор из-за неснимаемой 🔒 — законен
                    if (stale[String(key)]) return;  // #4759: операции дня сняты — число уже не про него
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
            // #4751: ХРАПОВИК — набор операций не вправе РАЗОРВАТЬ цепочку, которая в хранимом плане
            // была цела. Ось `gate` ортогональна `mode`: причина наблюдателя выше остаётся верной
            // (одна выброшенная операция разрыв не сшивает), но НАБОР, который разрыв создаёт,
            // откатывается целиком. Подробности механики — у `refuseRatchetRegressions`.
            gate: 'ratchet',
            // Кого откатывать: саму цепочку и тех, кто в неё вклинился, — иначе части вернутся на
            // хранимые места, а чужое задание останется стоять между ними.
            subjects: function(v) {
                return { chains: [v && v.chainId], cuts: [v && v.cutId, v && v.headCutId].concat((v && v.betweenIds) || []) };
            },
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
            id: 'ORDER_PARTS_ADJACENT',
            tz: '§15 (#4735)',
            actor: 'any',      // рядом в дне их кладёт и автоматика, и человек
            mode: 'audit',     // отбрасывать нечего: соседей схлопывает СЛИЯНИЕ записей, а не отказ
            why: 'отбрасывать нечего: две записи одной работы, ставшие соседями в дне, чинятся '
                 + 'СЛИЯНИЕМ в одну (#4735), а не отказом от записи — отказ оставил бы их ровно так же',
            title: 'Части одной работы, оказавшиеся рядом в одном дне, — одно задание',
            // ЧТО ПРОВЕРЯЕТСЯ. Дробление задания по дням законно: не влезло в смену — хвост уезжает
            // назавтра (§9). Дробление ВНУТРИ ДНЯ бессмысленно: наладка платится дважды, оператор
            // видит два номера там, где работа одна, а сумма проходов живёт двумя записями. Если
            // два СОСЕДА по очереди станка стоят в ОДНОМ дне и это одна работа — общая цепочка
            // дробления либо один заказ при одной конфигурации, — они обязаны быть одной записью.
            // Боевое 12.08.2026 (issue #4735): после «Урегулировать» в Чт 13.08 подряд стояли
            // «проходов 7 из 38» и «проходов 31 из 38» одного заказа 4675.
            //
            // ПОЧЕМУ mode:'audit'. Выбросить операцию нельзя: соседство — свойство раскладки, а не
            // одной записи, и отказ оставил бы обе записи на месте. Чинится оно СЛИЯНИЕМ
            // (`mergeAdjacentOrderTasks` в хвосте любой записи плана). Правило здесь — детектор:
            // сработало — значит какой-то путь снова оставил работу двумя записями.
            //
            // ЧЕГО ПРАВИЛО НЕ ТРЕБУЕТ. Записи, которых автоматика не трогает вовсе, — НАЧАТАЯ
            // (#4381), завершённая и стоящая в замороженном дне (#4326) — слить нельзя, и это
            // нормальное, постоянное состояние плана: половина, сделанная сегодня, и её продолжение
            // так и живут двумя записями (#4564/#4651). Такая запись, как и чужое задание, СМЕЖНОСТЬ
            // РАЗРЫВАЕТ — иначе правило обвиняло бы план в том, чего чинить нельзя.
            //
            // ctx.planSnapshot() → [{ id, slitterId, planStartTs, chainId, orderId, workSig, started }],
            // ctx.isFrozenCut(id). `workSig` — подпись конфигурации (станок|сырьё|намотка|ножи). Нет
            // её ни у одной записи → правило не срабатывает (общая конвенция реестра: нет данных —
            // нет обвинений).
            check: function(ops, ctx) {
                var snapFn = (ctx && typeof ctx.planSnapshot === 'function') ? ctx.planSnapshot : null;
                var dayOfTs = (ctx && typeof ctx.dayKeyOfTs === 'function') ? ctx.dayKeyOfTs : null;
                if (!snapFn || !dayOfTs) return [];
                var frozenCut = ppCtxFn(ctx, 'isFrozenCut');
                var snap = snapFn() || [];
                if (!snap.some(function(r) { return r && r.workSig != null && String(r.workSig) !== ''; })) return [];
                // Итоговый план = хранимый + операции (пишутся только изменившиеся записи, #3427).
                var byId = {};
                snap.forEach(function(r) {
                    if (!r || r.id == null) return;
                    byId[String(r.id)] = { id: String(r.id), sid: String(r.slitterId == null ? '' : r.slitterId),
                                           ts: Number(r.planStartTs),
                                           chain: String(r.chainId == null ? '' : r.chainId).trim() || String(r.id),
                                           order: String(r.orderId == null ? '' : r.orderId).trim(),
                                           sig: String(r.workSig == null ? '' : r.workSig),
                                           started: !!r.started };
                });
                (ops && ops.updates || []).forEach(function(u) {
                    var cur = byId[String(u.cutId)];
                    if (!cur) return;   // запись вне снимка — о её работе мы ничего не знаем
                    cur.ts = Number(u.planStartTs);
                    if (u.slitterId != null) cur.sid = String(u.slitterId);
                });
                (ops && ops.deletes || []).forEach(function(id) { delete byId[String(id)]; });
                var rows = Object.keys(byId).map(function(k) { return byId[k]; })
                    .filter(function(r) { return isFinite(r.ts) && r.sig !== ''; });
                var bySlitter = {};
                rows.forEach(function(r) { (bySlitter[r.sid] = bySlitter[r.sid] || []).push(r); });
                var out = [];
                Object.keys(bySlitter).forEach(function(sid) {
                    // Порядок на станке — по времени старта, как читает очередь экран (#3923).
                    var seq = bySlitter[sid].sort(function(a, b) { return a.ts - b.ts; });
                    var prev = null;
                    seq.forEach(function(cur) {
                        if (cur.started || frozenCut(cur.id)) { prev = null; return; }   // слить нельзя — смежности нет
                        var day = dayOfTs(cur.ts);
                        var oneWork = prev && prev.sig === cur.sig
                            && ((prev.chain === cur.chain) || (prev.order !== '' && prev.order === cur.order));
                        if (oneWork && day != null && day === dayOfTs(prev.ts)) {
                            out.push(ppViolation('ORDER_PARTS_ADJACENT', cur.id,
                                'части одной работы стоят рядом в одном дне: ' + prev.id + ' и ' + cur.id
                                + (cur.order !== '' ? ' (заказ ' + cur.order + ')' : '') + ' — это одно задание',
                                { slitterId: sid, headCutId: String(prev.id), orderId: cur.order,
                                  chainId: String(cur.chain), dayKey: day }));
                        }
                        prev = cur;
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
        },
        {
            id: 'CHAIN_SETUP_ONCE',
            tz: '§15 (#4524)',
            actor: 'any',       // двойная наладка — брак независимо от того, кто её создал
            mode: 'audit',     // отбрасывать нечего: лишние минуты чинятся расчётом, а не отказом от записи
            why: 'отбрасывать нечего: лишние минуты наладки чинятся РАСЧЁТОМ (changeoverParts не берёт '
                 + 'переналадку между звеньями одной цепочки), а не отказом от записи — без записи '
                 + 'задание останется незапланированным и с той же двойной наладкой',
            title: 'Наладка задания, разорванного по дням, платится ОДИН раз на всю цепочку',
            // ЧТО ПРОВЕРЯЕТСЯ. Задание, не влезшее в смену, живёт цепочкой записей (голова +
            // продолжения, общий «ID первой части»). Ножи ему настраивают ОДИН раз: хвост дня N
            // держит столько наладки, сколько влезло до потолка нахлёста, продолжение — остаток
            // (#4030/#4111). Сумма по цепочке равна ОДНОЙ смене ножей и ОДНОЙ смене сырья — станок
            // как настроили вечером, так он и стои́т утром (правило «ножи те же с прошлого дня»).
            // Если сумма больше, наладку посчитали ДВАЖДЫ: оператор видит красную «↻ Пересчитать
            // наладку» на задании, у которого ножи не менялись (issue #4524: хвост 03.08 держит
            // 30 мин, а продолжению 04.08 детектор просит ещё 30).
            //
            // ПОЧЕМУ ЭТО ПРАВИЛО, А НЕ ПРОВЕРКА В ОДНОМ РАСЧЁТЕ. «Нужна ли переналадка» спрашивают
            // ПЯТЬ потребителей (упаковщик, колонки, детектор, панель качества, слой размещения), и
            // каждый выводил ответ сам — из своих входов. Поэтому правило возвращалось: чинили один
            // путь, остальные продолжали считать по-своему. Ответ теперь один (`changeoverParts` +
            // `sameSplitChain`), а это правило — храповик: если какой-то путь снова начнёт считать
            // наладку сам, шлюз скажет об этом на ВСЕХ входах записи разом.
            //
            // ctx.knifeSetupMin() / ctx.materialSetupMin() → минуты ОДНОЙ смены (из «Настройки»);
            // колонки берём у упаковщика (`planCols`, #4499) — он один решает, сколько наладки
            // остаётся в дне N. Нет предикатов или нет planCols → правило не срабатывает (общая
            // конвенция реестра: нет данных — нет обвинений).
            check: function(ops, ctx) {
                var knifeFn = (ctx && typeof ctx.knifeSetupMin === 'function') ? ctx.knifeSetupMin : null;
                var matFn = (ctx && typeof ctx.materialSetupMin === 'function') ? ctx.materialSetupMin : null;
                var chainFn = (ctx && typeof ctx.chainIdOfCut === 'function') ? ctx.chainIdOfCut : null;
                if (!knifeFn || !matFn || !chainFn) return [];
                var knifeOne = Math.round(Number(knifeFn()) || 0);
                var matOne = Math.round(Number(matFn()) || 0);
                if (knifeOne <= 0 && matOne <= 0) return [];
                var byChain = {};
                function add(chainId, cutId, cols) {
                    if (!cols) return;
                    var key = String(chainId == null ? '' : chainId);
                    if (key === '') return;
                    var acc = byChain[key] = byChain[key] || { knife: 0, material: 0, ids: [] };
                    acc.knife += Math.round(Number(cols.knife) || 0);
                    acc.material += Math.round(Number(cols.material) || 0);
                    acc.ids.push(String(cutId));
                }
                (ops && ops.updates || []).forEach(function(u) {
                    if (u) add(chainFn(u.cutId), u.cutId, u.planCols);
                });
                (ops && ops.creates || []).forEach(function(cr) {
                    if (cr) add(chainFn(cr.parentCutId), cr.parentCutId, cr.planCols);
                });
                var out = [];
                Object.keys(byChain).forEach(function(chainId) {
                    var acc = byChain[chainId];
                    if (acc.ids.length < 2) return;   // цепочки нет — одному звену платить один раз и положено
                    if (acc.knife > knifeOne) {
                        out.push(ppViolation('CHAIN_SETUP_ONCE', acc.ids[acc.ids.length - 1],
                            'наладка ножей посчитана дважды: по цепочке ' + chainId + ' сумма ' + acc.knife
                            + ' мин при одной смене ' + knifeOne + ' мин (звенья: ' + acc.ids.join(', ') + ')',
                            { chainId: String(chainId), kind: 'knife', sumMin: acc.knife, oneMin: knifeOne,
                              partIds: acc.ids.slice() }));
                    }
                    if (acc.material > matOne) {
                        out.push(ppViolation('CHAIN_SETUP_ONCE', acc.ids[acc.ids.length - 1],
                            'смена сырья посчитана дважды: по цепочке ' + chainId + ' сумма ' + acc.material
                            + ' мин при одной смене ' + matOne + ' мин (звенья: ' + acc.ids.join(', ') + ')',
                            { chainId: String(chainId), kind: 'material', sumMin: acc.material, oneMin: matOne,
                              partIds: acc.ids.slice() }));
                    }
                });
                return out;
            }
        },
        {
            id: 'SUPPLY_CONSERVED',
            tz: '§15 (#4536)',
            actor: 'any',       // недообеспеченный заказ — брак независимо от того, кто его создал
            mode: 'audit',
            why: 'отбрасывать нечего: недостача — это НЕ операция, а итог всего плана. Выбросив '
                 + 'операцию, мы не добавим заказу ни одного прохода, зато оставим задание с прежним '
                 + 'planStart и получим дыру в дне (#4300/#4312). Недостачу чинит план (проходы '
                 + 'добираются) или оператор; шлюз называет позицию и сколько штук не хватает',
            // #4751: ХРАПОВИК — набор операций не вправе УМЕНЬШИТЬ обеспечение заказа. Наблюдателем
            // правило видело недостачу и пропускало её: боевое 13.08.2026 записало 168 команд и
            // четырьмя проходами подряд напечатало «сработали бы» про 13 позиций (заказы 4340…4538).
            // Ось `gate` ортогональна `mode`: причина наблюдателя выше остаётся верной (выброшенная
            // ОПЕРАЦИЯ заказу проходов не добирает), но НАБОР, который недостачу создаёт или
            // углубляет, откатывается целиком. Подробности — у `refuseRatchetRegressions`.
            gate: 'ratchet',
            // Мера тяжести: недостача, УГЛУБЛЁННАЯ набором, — тоже ухудшение, а не «то же нарушение».
            severity: function(v) { return Number(v && v.shortRolls) || 0; },
            // Кого откатывать: все задания, покрывающие эту позицию, — иначе голова вернётся к
            // хранимым проходам, а удаление донора останется, и работа исчезнет совсем (#4536).
            subjects: function(v) { return { cuts: (v && v.cutIds) || [v && v.cutId] }; },
            title: 'Обеспечение равно заказу: выпуск позиции по всем заданиям не меньше заказанного количества',
            // ЧТО ПРОВЕРЯЕТСЯ. Позиция заказа обеспечена, когда сумма выпуска ВСЕХ покрывающих её
            // заданий («Кол-во полос» её «Партии ГП» × «Кол-во резок план» задания) не меньше
            // «Заказанного количества». Излишек — норма (проходы целые, остаток идёт на склад),
            // недостача — нет: заказ уедет неполным, и никакая кнопка об этом не скажет.
            //
            // ЗАЧЕМ ПРАВИЛО. Количество терялось молча и разными путями (issue #4536, боевая ateh1:
            // шесть позиций из 136 — заказ 4442 недосчитался 138 штук, 4404 — 108 и 12): шлюз
            // отбрасывал `create` продолжения, оставляя голове урезанные проходы; удаление звена
            // цепочки уносило его долю обеспечения; «Кол-во рулонов» обеспечения затиралось нулём.
            // Каждый путь чинился отдельно и возвращался. Здесь мерка ОДНА и на всех входах записи:
            // сколько заказу достанется по ИТОГОВОМУ плану.
            //
            // КАК СЧИТАЕТСЯ. Проходы после операций: `update` задаёт новое число, `delete` обнуляет
            // (записи не будет), `create` добавляет продолжение — оно режет ТЕ ЖЕ полосы, что и
            // голова (applySplitPlan копирует её «Партии ГП»), поэтому его выпуск считается по
            // полосам родителя. Записи, которых операции не касаются, дают свои ХРАНИМЫЕ проходы:
            // операции несут только изменившееся (#3427), и без хранимых цифра была бы ложной.
            //
            // ctx.coverageLinks() → [{ cutId, positionId, rollsPerRun }] — кто что выпускает
            //   (rollsPerRun = «Кол-во полос» партии, покрывающей позицию: столько штук этой позиции
            //   даёт ОДИН проход задания);
            // ctx.positionDemand() → { positionId: { qty, orderNo, width } } — заказанное количество;
            // ctx.plannedRunsOfCut(id) → ХРАНИМЫЕ проходы задания (null — не знаем).
            // Нет предикатов или нет данных — правило молчит (общая конвенция реестра: нет данных —
            // нет обвинений); недостача на позиции, чьи проходы неизвестны, не выдумывается.
            check: function(ops, ctx) {
                var linksFn = (ctx && typeof ctx.coverageLinks === 'function') ? ctx.coverageLinks : null;
                var demandFn = (ctx && typeof ctx.positionDemand === 'function') ? ctx.positionDemand : null;
                var runsFn = (ctx && typeof ctx.plannedRunsOfCut === 'function') ? ctx.plannedRunsOfCut : null;
                if (!linksFn || !demandFn || !runsFn) return [];
                var links = linksFn() || [];
                var demand = demandFn() || {};
                if (!links.length || !Object.keys(demand).length) return [];

                // Проходы задания после операций плана.
                var runsAfter = {}, removed = {};
                function storedRuns(cutId) {
                    var key = String(cutId);
                    if (!hasKey(runsAfter, key)) {
                        var v = runsFn(key);
                        runsAfter[key] = (v == null || !isFinite(Number(v))) ? null : Number(v);
                    }
                    return runsAfter[key];
                }
                function hasKey(obj, key) { return Object.prototype.hasOwnProperty.call(obj, key); }
                (ops && ops.updates || []).forEach(function(u) {
                    if (!u || u.cutId == null) return;
                    storedRuns(u.cutId);                                   // положим хранимое, затем перекроем
                    if (u.plannedRuns != null && isFinite(Number(u.plannedRuns))) runsAfter[String(u.cutId)] = Number(u.plannedRuns);
                });
                (ops && ops.deletes || []).forEach(function(id) { if (id != null) removed[String(id)] = true; });

                // Выпуск по позициям: хранимые записи + продолжения, которых ещё нет в базе.
                var produced = {}, unknown = {}, cutsByPos = {};
                links.forEach(function(l) {
                    if (!l || l.positionId == null || l.cutId == null) return;
                    var per = Number(l.rollsPerRun) || 0;
                    if (!(per > 0)) return;
                    var pid = String(l.positionId), cid = String(l.cutId);
                    if (!hasKey(produced, pid)) { produced[pid] = 0; cutsByPos[pid] = []; }
                    if (cutsByPos[pid].indexOf(cid) === -1) cutsByPos[pid].push(cid);
                    if (removed[cid]) return;                              // записи не будет — выпуска нет
                    var runs = storedRuns(cid);
                    if (runs == null) { unknown[pid] = true; return; }     // не знаем проходов — не обвиняем
                    produced[pid] = round3ppi(produced[pid] + per * runs);
                });
                (ops && ops.creates || []).forEach(function(cr) {
                    if (!cr || cr.parentCutId == null) return;
                    var addRuns = Number(cr.plannedRuns) || 0;
                    if (!(addRuns > 0)) return;
                    var parent = String(cr.parentCutId);
                    links.forEach(function(l) {
                        if (!l || String(l.cutId) !== parent || l.positionId == null) return;
                        var per = Number(l.rollsPerRun) || 0;
                        if (!(per > 0)) return;
                        var pid = String(l.positionId);
                        if (!hasKey(produced, pid)) { produced[pid] = 0; cutsByPos[pid] = [parent]; }
                        produced[pid] = round3ppi(produced[pid] + per * addRuns);
                    });
                });

                var out = [];
                Object.keys(produced).forEach(function(pid) {
                    if (unknown[pid]) return;
                    var need = demand[pid];
                    var ordered = Number(need && need.qty);
                    if (!(ordered > 0)) return;                            // позиции нет в плане/нулевой заказ
                    var made = produced[pid];
                    if (made >= ordered - 0.001) return;
                    var short = round3ppi(ordered - made);
                    var ids = cutsByPos[pid] || [];
                    out.push(ppViolation('SUPPLY_CONSERVED', ids[0] || null,
                        'позиция ' + pid + (need && need.orderNo ? ' (заказ ' + need.orderNo + ')' : '')
                        + ': заказано ' + ordered + ', выпуск по плану ' + made + ' — не хватает ' + short,
                        { positionId: pid, orderNo: need && need.orderNo != null ? String(need.orderNo) : '',
                          width: need && need.width != null ? Number(need.width) : undefined,
                          ordered: ordered, produced: made, shortRolls: short, cutIds: ids.slice() }));
                });
                return out;
            }
        }
    ];

    // Округление до 3 знаков — тот же приём, что и в остальных модулях (артефакты float).
    function round3ppi(n) { return Math.round(n * 1000) / 1000; }

    // Все нарушения, которые операции плана несут для указанного актора.
    //   actor: 'auto' — проверяются правила автоматики и общие; 'human' — только общие ('any').
    function checkPlanInvariants(ops, ctx, actor, rules) {
        return checkRules(rules || PP_INVARIANTS, ops, ctx, actor);
    }
    // Проверка ПРОИЗВОЛЬНОГО набора правил — одна реализация на всех: её зовёт и шлюз записи
    // (guardPlanOpsWith), и checkPlanInvariants. Раньше цикл был написан дважды, и «что считает
    // страж» могло разойтись с «что показывает проверка».
    function checkRules(rules, ops, ctx, actor) {
        var who = actor === 'human' ? 'human' : 'auto';
        var out = [];
        (rules || []).forEach(function(inv) {
            if (!inv || typeof inv.check !== 'function') return;
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
        var filled = [];
        (rules || []).forEach(function(inv) {
            if (!applies(inv) || typeof inv.fill !== 'function') return;
            filled = filled.concat(inv.fill(ops, ctx) || []);
        });
        // ПОЛНЫЙ отчёт — по набору, КАКИМ ОН ПРИШЁЛ. Им объясняется, ПОЧЕМУ операции отброшены
        // (FROZEN_DAY и прочие `mode: 'drop'`): после отбрасывания нарушающих операций уже нет, и
        // причина потерялась бы. Контракт `violations` прежний — на него смотрят журнал и тесты
        // #4494/#4512/реестра. Отчёт ДЛЯ ОПЕРАТОРА считается ниже отдельно (#4759).
        var violations = checkRules(rules, ops, ctx, who);

        // Правила, которые вправе отбрасывать: режим 'drop', актор подходит, предикат есть.
        var droppers = (rules || []).filter(function(inv) {
            return inv.mode === 'drop' && applies(inv) && typeof inv.drop === 'function';
        });
        if (!ops) return { ops: ops, violations: violations, skipped: 0, filled: filled,
                           restoredChains: [], lostWorkChains: [], ratchetChains: [], ratchetViolations: [] };

        var skipped = 0;
        // #4759: ЧТО ИМЕННО СНЯТО — вызывающему и правилам. Правило потолка по этому списку видит,
        // какие станко-дни судить больше нельзя: занятость им считал упаковщик ДО отбрасывания.
        var droppedOps = { updates: [], deletes: [], creates: [] };
        ops.droppedOps = droppedOps;
        function keep(op, kind) {
            for (var i = 0; i < droppers.length; i++) {
                if (droppers[i].drop(op, ctx, kind)) {
                    skipped++;
                    (kind === 'delete' ? droppedOps.deletes : (kind === 'create' ? droppedOps.creates : droppedOps.updates)).push(op);
                    return false;
                }
            }
            return true;
        }
        // #4536: баланс работы ДО отбрасывания — с чем сравнивать целостность задания (ниже).
        var balanceBefore = planWorkBalanceByChain(ops, ctx);
        // #4645: СОХРАННОСТЬ РАБОТЫ ПРОВЕРЯЕТСЯ ВСЕГДА, а не «когда есть кому отбрасывать». Прежде
        // шлюз выходил здесь же (`!droppers.length`), и на наборах, где ни одно правило не вправе
        // отбрасывать (актор `human`, реестр без `mode: 'drop'`), баланс не смотрел НИКТО. Отказ
        // теряющему работу набору — свойство самого шлюза, а не чьего-то правила.
        var lostWork = refuseWorkLosingChains(ops, ctx, balanceBefore);
        skipped += lostWork.skipped;
        if (!droppers.length) {
            // #4751: ХРАПОВИК СМОТРИТ ВСЕГДА — как и сохранность работы выше (#4645). Пути, где
            // отбрасывать некому (актор `human`, набор правил без `mode: 'drop'`), — это как раз
            // фазы, которые пишут сами: слияние соседей и сведе́ние стартов. Именно они и уносили
            // обеспечение в базу без единой проверки (боевые WRITE#61…70).
            var ratchetOnly = refuseRatchetRegressions(rules, ops, ctx, who);
            skipped += ratchetOnly.skipped;
            return { ops: ops, violations: violations, skipped: skipped, filled: filled,
                     restoredChains: [], lostWorkChains: lostWork.chains,
                     ratchetChains: ratchetOnly.chains, ratchetViolations: ratchetOnly.violations };
        }
        ops.updates = (ops.updates || []).filter(function(u) { return keep(u, 'update'); });
        // Удаления — «голые» id: нормализуем в операцию, чтобы у правил была одна форма входа.
        ops.deletes = (ops.deletes || []).filter(function(id) { return keep({ cutId: id }, 'delete'); });
        ops.creates = (ops.creates || []).filter(function(cr) { return keep(cr || {}, 'create'); });
        var restoredChains = restoreSplitChainIntegrity(ops, ctx, balanceBefore);
        skipped += restoredChains.skipped;
        // #4751: храповик — ПОСЛЕДНИЙ шаг: он судит набор, который реально уйдёт в базу, а не тот,
        // из которого страж ещё не выбросил операции по заморозке и 🔒.
        var ratchet = refuseRatchetRegressions(rules, ops, ctx, who);
        skipped += ratchet.skipped;
        // #4759: ОТЧЁТ ОПЕРАТОРУ — ПО НАБОРУ, КОТОРЫЙ ЗАПИШЕТСЯ, а не по тому, который страж тут же
        // разобрал. На 120 сгенерированных планах 60 из 78 срабатываний DAY_CAPACITY ИСЧЕЗАЛИ после
        // отбрасывания — то есть три четверти предупреждений оператору были ложными. Боевая форма:
        // движок вытащил работу из ЗАМОРОЖЕННОГО дня в соседний и насчитал там 475 при потолке 455;
        // страж эти операции снял, в дне осталось 150 — а предупреждение уходило.
        // `violations` при этом ПРЕЖНИЙ (полный, до отбрасывания): по нему журнал объясняет, что
        // именно снято, и на него смотрят тесты #4494/#4512.
        var violationsAfterDrop = checkRules(rules, ops, ctx, who);
        return { ops: ops, violations: violations, violationsAfterDrop: violationsAfterDrop,
                 skipped: skipped, filled: filled,
                 restoredChains: restoredChains.chains, lostWorkChains: lostWork.chains,
                 ratchetChains: ratchet.chains, ratchetViolations: ratchet.violations };
    }

    // #4645 (ТЗ §15): ПЛАН НЕ ВПРАВЕ УНИЧТОЖИТЬ РАБОТУ. `restoreSplitChainIntegrity` (#4536) лечит
    // ТОЛЬКО тот разрыв, который устроил сам страж: цепочка была сбалансирована ДО отбрасывания и
    // перестала быть после. Набор операций, пришедший к стражу УЖЕ несбалансированным, он пропускал
    // намеренно — «план менял объём работы, судить не за что».
    //
    // Боевая цена этой оговорки — issue #4645 (ateh, 07.08.2026, 12:01): «Упорядочить» принесло
    // ровно две операции — 666131 «проходов 15 → 1» и 667803 «5 → 1» — БЕЗ единого `create`.
    // Продолжений не родилось, и заказы 4607/4615 недосчитались 14 и 4 проходов. Журнал #4618 это
    // увидел (`CHAIN_BALANCE ⛔ РАБОТА НЕ СОХРАНЕНА`), но увидел ПОСЛЕ записи — свидетель, а не
    // сторож. Причина в упаковщике (остаток не разместился и пропал, #4645 в splitMachineQueue),
    // но полагаться на то, что упаковщик впредь всегда прав, нельзя: терять работу молча план не
    // должен НИКОГДА, из какой бы ветки такой набор ни пришёл.
    //
    // Поэтому цепочка, у которой операции ОТНИМАЮТ проходы (баланс < 0), теряет их ЦЕЛИКОМ — все
    // её операции снимаются, и записи остаются ровно такими, как хранятся. Это та же безопасная
    // семантика, что у #4536 («задание остаётся там, где стои́т», FIXED_CUT_DAY #4512): день может
    // остаться неоптимальным, но работа никуда не девается, а вызывающий получает список цепочек и
    // обязан сказать о нём оператору (молчания нет — ТЗ §14).
    //
    // ПРИБАВКА проходов (баланс > 0) под правило НЕ подпадает: она работу не теряет, и именно так
    // выглядит обратная правка — возврат урезанной головы к полному числу проходов.
    // `ops.manual === true` — осознанная ручная правка объёма (проходы правит человек): не трогаем.
    //   balanceBefore — баланс НАБОРА, каким он пришёл (до отбрасывания правилами).
    // → { chains: [chainId…], skipped: сколько операций снято }. ops мутируется на месте.
    function refuseWorkLosingChains(ops, ctx, balanceBefore) {
        var chainFn = (ctx && typeof ctx.chainIdOfCut === 'function') ? ctx.chainIdOfCut : null;
        if (!ops || !chainFn || ops.manual === true) return { chains: [], skipped: 0 };
        var broken = {}, chains = [];
        Object.keys(balanceBefore || {}).forEach(function(chainId) {
            if (Number(balanceBefore[chainId]) < -0.001) { broken[chainId] = true; chains.push(chainId); }
        });
        if (!chains.length) return { chains: [], skipped: 0 };
        function chainOf(cutId) {
            var c = chainFn(cutId);
            return String((c == null || c === '') ? cutId : c);
        }
        var skipped = 0;
        ops.updates = (ops.updates || []).filter(function(u) {
            if (u && u.cutId != null && broken[chainOf(u.cutId)]) { skipped++; return false; }
            return true;
        });
        ops.deletes = (ops.deletes || []).filter(function(id) {
            if (id != null && broken[chainOf(id)]) { skipped++; return false; }
            return true;
        });
        ops.creates = (ops.creates || []).filter(function(cr) {
            if (cr && cr.parentCutId != null && broken[chainOf(cr.parentCutId)]) { skipped++; return false; }
            return true;
        });
        return { chains: chains, skipped: skipped };
    }

    // #4751 (ТЗ §15): ХРАПОВИК ЖЁСТКИХ ПРАВИЛ — НАБОР ОПЕРАЦИЙ НЕ ВПРАВЕ УХУДШИТЬ ПРАВИЛО.
    //
    // ЗАЧЕМ ТРЕТЬЯ ОСЬ, А НЕ СМЕНА РЕЖИМА. У правила уже есть `mode`: 'drop' — «выброси нарушающую
    // ОПЕРАЦИЮ», 'audit' — «выбросить нельзя, кричи». Для SUPPLY_CONSERVED и CHAIN_CONTIGUOUS второе
    // верно и остаётся верным: одна выброшенная операция заказу проходов не добирает и цепочку не
    // сшивает, а задание осталось бы с прежним `planStart` — дыра в дне (#4300/#4312). Но из «нельзя
    // выбросить ОДНУ» не следует «надо записать ВЕСЬ набор»: недостача и разрыв — свойства ВСЕЙ
    // раскладки, значит и решение принимается о ВСЁМ наборе. `gate: 'ratchet'` — про набор,
    // `mode` — про операцию; они не конкурируют, поэтому режим правил не тронут.
    //
    // ПОЧЕМУ СРАВНЕНИЕ С ХРАНИМЫМ, А НЕ АБСОЛЮТНЫЙ ЗАПРЕТ. В боевом плане нарушение обычно УЖЕ
    // стои́т: 13.08.2026 одни и те же 13 недообеспеченных позиций печатались на всех четырёх
    // проходах с одними и теми же числами. Абсолютный запрет отказал бы КАЖДОЙ записи навсегда —
    // план нельзя было бы ни поправить, ни улучшить. Поэтому мерка та же, что у `capacityBreaksStored`
    // (#4622): за УНАСЛЕДОВАННОЕ нарушение запись не отвечает, за ДОБАВЛЕННОЕ — отвечает.
    //
    // ЧТО СЧИТАЕТСЯ УХУДШЕНИЕМ. Нарушение по субъекту (позиция заказа, цепочка), которого в хранимом
    // плане не было, — или было, но стало ТЯЖЕЛЕЕ (`severity` правила: сколько штук не хватает).
    // Субъект, а не текст сообщения: формулировка меняется от чисел, а сравнивать надо предмет.
    //
    // ЧЕМ ОТКАТЫВАЕМ. Тем же, чем #4536/#4645: снимаем ВСЕ операции затронутых ЦЕПОЧЕК. Половинчатый
    // откат («сняли правку головы, оставили удаление донора») — ровно та беда, из-за которой оба
    // тех правила и заведены: работа исчезает целиком. Какие цепочки трогать, называет САМО правило
    // (`subjects(v)` → { cuts, chains }) — теми же полями, которыми оно отчиталось в `check`.
    //
    // ПОЧЕМУ ЦИКЛ. Сняв операции одной цепочки, мы меняем итоговый план, и часть нарушений может
    // исчезнуть, а часть — вскрыться (соседняя цепочка держалась на снятых операциях). Гоняем до
    // схождения, но не больше RATCHET_PASSES проходов: набор конечен, каждый проход снимает хотя бы
    // одну цепочку, поэтому цикл всегда кончается.
    //
    // ЧЕГО ХРАПОВИК НЕ ТРОГАЕТ. `ops.manual === true` — осознанная ручная правка объёма (проходы
    // правит человек), та же оговорка, что у #4645. И правило БЕЗ `gate` им не ограничено: DAY_FILL
    // нарушается любым недобранным днём, и объявлять из-за него откат нельзя — выравнивание никогда
    // не записало бы свой результат.
    //   balance — ничего не нужно; работаем на самих правилах.
    // → { chains: [chainId…], violations: [нарушение…], skipped: сколько операций снято }.
    // ops мутируется на месте.
    var RATCHET_PASSES = 5;
    function refuseRatchetRegressions(rules, ops, ctx, actor) {
        var none = { chains: [], violations: [], skipped: 0 };
        var chainFn = (ctx && typeof ctx.chainIdOfCut === 'function') ? ctx.chainIdOfCut : null;
        if (!ops || !chainFn || ops.manual === true) return none;
        var who = actor === 'human' ? 'human' : 'auto';
        var gates = (rules || []).filter(function(inv) {
            return inv && inv.gate === 'ratchet' && typeof inv.check === 'function'
                && !(inv.actor === 'auto' && who !== 'auto');
        });
        if (!gates.length) return none;

        function chainOf(cutId) {
            var c = chainFn(cutId);
            return String((c == null || c === '') ? cutId : c);
        }
        // Субъект нарушения — предмет, а не фраза: позиция заказа, цепочка, задание. По нему
        // «то же самое нарушение» отличается от «нового».
        function subjectKey(inv, v) {
            var s = (v && (v.positionId != null ? v.positionId : (v.chainId != null ? v.chainId : v.cutId)));
            return inv.id + '|' + String(s == null ? '' : s);
        }
        function severityOf(inv, v) {
            return (typeof inv.severity === 'function') ? (Number(inv.severity(v)) || 0) : 0;
        }
        // Нарушения ХРАНИМОГО плана — с пустым набором операций (правила читают снимок и хранимые
        // проходы сами). Это и есть «за что запись не отвечает».
        var empty = { updates: [], deletes: [], creates: [] };
        var wasBy = {};
        gates.forEach(function(inv) {
            (inv.check(empty, ctx) || []).forEach(function(v) {
                var k = subjectKey(inv, v);
                var sev = severityOf(inv, v);
                if (wasBy[k] == null || sev > wasBy[k]) wasBy[k] = sev;
            });
        });

        var broken = {}, chains = [], reported = [], skipped = 0;
        for (var pass = 0; pass < RATCHET_PASSES; pass++) {
            var fresh = [];
            gates.forEach(function(inv) {
                (inv.check(ops, ctx) || []).forEach(function(v) {
                    var k = subjectKey(inv, v);
                    var was = wasBy[k];
                    if (was != null && severityOf(inv, v) <= was) return;   // унаследованное — не наше
                    fresh.push({ inv: inv, v: v });
                });
            });
            if (!fresh.length) break;
            var added = 0;
            fresh.forEach(function(hit) {
                reported.push(hit.v);
                var subj = (typeof hit.inv.subjects === 'function') ? (hit.inv.subjects(hit.v) || {}) : {};
                var keys = [];
                (subj.cuts || []).forEach(function(id) { if (id != null && id !== '') keys.push(chainOf(id)); });
                (subj.chains || []).forEach(function(id) { if (id != null && id !== '') keys.push(String(id)); });
                if (!keys.length && hit.v && hit.v.cutId != null) keys.push(chainOf(hit.v.cutId));
                keys.forEach(function(k) {
                    if (broken[k]) return;
                    broken[k] = true; chains.push(k); added++;
                });
            });
            if (!added) break;   // назвать некого — снимать нечего, второй проход даст то же самое
            ops.updates = (ops.updates || []).filter(function(u) {
                if (u && u.cutId != null && broken[chainOf(u.cutId)]) { skipped++; return false; }
                return true;
            });
            ops.deletes = (ops.deletes || []).filter(function(id) {
                if (id != null && broken[chainOf(id)]) { skipped++; return false; }
                return true;
            });
            ops.creates = (ops.creates || []).filter(function(cr) {
                if (cr && cr.parentCutId != null && broken[chainOf(cr.parentCutId)]) { skipped++; return false; }
                return true;
            });
        }
        return { chains: chains, violations: reported, skipped: skipped };
    }

    // #4536: СКОЛЬКО РАБОТЫ ОПЕРАЦИИ ДОБАВЛЯЮТ ИЛИ ОТНИМАЮТ У КАЖДОГО ЗАДАНИЯ.
    // Задание, не влезшее в смену, живёт цепочкой записей (голова + продолжения). Разбиение по
    // дням РАСПРЕДЕЛЯЕТ его проходы между записями, но не создаёт и не уничтожает их: сумма по
    // цепочке до и после операций одна и та же. Баланс цепочки = (что будет) − (что хранится):
    //   update  — проходы записи меняются на u.plannedRuns;
    //   delete  — запись исчезает вместе со своими проходами;
    //   create  — появляется продолжение со своими проходами.
    // → { chainId: баланс }; цепочка, у которой хранимые проходы хоть одной затронутой записи
    // неизвестны, в результат не попадает (нет данных — нет выводов).
    // Нужны ctx.plannedRunsOfCut(id) и ctx.chainIdOfCut(id); без них — пустой результат.
    function planWorkBalanceByChain(ops, ctx) {
        var runsFn = (ctx && typeof ctx.plannedRunsOfCut === 'function') ? ctx.plannedRunsOfCut : null;
        var chainFn = (ctx && typeof ctx.chainIdOfCut === 'function') ? ctx.chainIdOfCut : null;
        if (!ops || !runsFn || !chainFn) return {};
        var out = {}, blind = {};
        function chainOf(cutId) {
            var c = chainFn(cutId);
            return String((c == null || c === '') ? cutId : c);
        }
        function add(cutId, delta) {
            var key = chainOf(cutId);
            out[key] = round3ppi((out[key] || 0) + delta);
        }
        function stored(cutId) {
            var v = runsFn(cutId);
            return (v == null || !isFinite(Number(v))) ? null : Number(v);
        }
        (ops.updates || []).forEach(function(u) {
            if (!u || u.cutId == null) return;
            var was = stored(u.cutId);
            if (was == null || u.plannedRuns == null || !isFinite(Number(u.plannedRuns))) { blind[chainOf(u.cutId)] = true; return; }
            add(u.cutId, Number(u.plannedRuns) - was);
        });
        (ops.deletes || []).forEach(function(id) {
            if (id == null) return;
            var was = stored(id);
            if (was == null) { blind[chainOf(id)] = true; return; }
            add(id, -was);
        });
        (ops.creates || []).forEach(function(cr) {
            if (!cr || cr.parentCutId == null) return;
            if (cr.plannedRuns == null || !isFinite(Number(cr.plannedRuns))) { blind[chainOf(cr.parentCutId)] = true; return; }
            add(cr.parentCutId, Number(cr.plannedRuns));
        });
        Object.keys(blind).forEach(function(k) { delete out[k]; });
        return out;
    }

    // #4536: ОПЕРАЦИИ ОДНОГО ЗАДАНИЯ ЖИВУТ ИЛИ ОТБРАСЫВАЮТСЯ ВМЕСТЕ.
    // Страж отбрасывает операции ПООДИНОЧКЕ, а разорванное по дням задание — это `update` головы
    // (сколько проходов осталось в её дне) ПЛЮС `create` продолжения (остаток). Выбросив только
    // `create` (продолжение попало в замороженный день), шлюз оставлял голове урезанные проходы,
    // а остаток не создавался никогда: работа исчезала вместе с обеспечением заказа — ровно
    // симптом issue #4536 («найдено одно задание, и его количество меньше заказа»).
    // Поэтому после отбрасывания баланс каждой цепочки сверяется с тем, каким он был ДО: цепочка,
    // которая была сбалансирована (плановое перераспределение проходов), а стала нет, возвращается
    // ЦЕЛИКОМ — все её оставшиеся операции снимаются, и задание остаётся ровно таким, как хранится.
    // Это безопасно по той же причине, что и отбрасывание вообще: «задание остаётся там, где
    // стои́т» (FIXED_CUT_DAY, #4512).
    // План, который МЕНЯЕТ объём работы намеренно (баланс не сошёлся ещё ДО отбрасывания —
    // например ручная правка проходов), не трогаем: возвращать нечего, судить не за что.
    // → { chains: [chainId…], skipped: сколько операций снято }. ops мутируется на месте.
    function restoreSplitChainIntegrity(ops, ctx, balanceBefore) {
        var chainFn = (ctx && typeof ctx.chainIdOfCut === 'function') ? ctx.chainIdOfCut : null;
        if (!ops || !chainFn) return { chains: [], skipped: 0 };
        var after = planWorkBalanceByChain(ops, ctx);
        var broken = {}, chains = [];
        Object.keys(after).forEach(function(chainId) {
            var was = (balanceBefore || {})[chainId];
            if (was == null) return;                      // до отбрасывания баланса не знали — не судим
            if (Math.abs(was) > 0.001) return;            // план и так менял объём работы — это не мы
            if (Math.abs(after[chainId]) <= 0.001) return;
            broken[chainId] = true; chains.push(chainId);
        });
        if (!chains.length) return { chains: [], skipped: 0 };
        function chainOf(cutId) {
            var c = chainFn(cutId);
            return String((c == null || c === '') ? cutId : c);
        }
        var skipped = 0;
        ops.updates = (ops.updates || []).filter(function(u) {
            if (u && u.cutId != null && broken[chainOf(u.cutId)]) { skipped++; return false; }
            return true;
        });
        ops.deletes = (ops.deletes || []).filter(function(id) {
            if (id != null && broken[chainOf(id)]) { skipped++; return false; }
            return true;
        });
        ops.creates = (ops.creates || []).filter(function(cr) {
            if (cr && cr.parentCutId != null && broken[chainOf(cr.parentCutId)]) { skipped++; return false; }
            return true;
        });
        return { chains: chains, skipped: skipped };
    }

