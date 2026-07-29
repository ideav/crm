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
        },
        {
            id: 'FIXED_BLOCK',
            tz: '§15 (🔒-монолит, #4464)',
            actor: 'auto',
            enforce: false,     // ПОКА только отчёт — см. ниже
            title: 'Зафиксированные задания одного дня — монолит: порядок между собой не меняется, между ними ничего не вставляется',
            // ЧТО ЗАПРЕЩЕНО. В пределах ОДНОГО дня одного станка: (1) менять взаимный порядок 🔒;
            // (2) ставить между двумя 🔒, стоявшими подряд, что-либо ещё. ЧТО РАЗРЕШЕНО: двигать
            // цепочку 🔒 целиком (сколько угодно), переставлять свободные задания вокруг неё,
            // ставить свободное ВПЛОТНУЮ к 🔒. На СТЫКЕ ДНЕЙ правило не действует: хвост дня N и
            // голова дня N+1 монолита не образуют (между ними и так ночь).
            //
            // ПОЧЕМУ enforce:false. Выбросить операцию нельзя: порядок этим не чинится — задание
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
                Object.keys(wasByDay).forEach(function(key) {
                    var fixedWas = wasByDay[key].filter(function(r) { return r.fixed; });
                    for (var i = 0; i < fixedWas.length; i++) {
                        var a = posNow[fixedWas[i].id];
                        if (!a || a.key !== key) continue;   // уехало на другой день/станок — это FIXED_CUT_DAY
                        if (i + 1 < fixedWas.length) {
                            var b = posNow[fixedWas[i + 1].id];
                            if (!b || b.key !== key) continue;
                            if (b.i < a.i) {
                                out.push(ppViolation('FIXED_BLOCK', fixedWas[i + 1].id,
                                    'зафиксированные задания дня переставлены местами: ' + fixedWas[i].id + ' ↔ ' + fixedWas[i + 1].id,
                                    { slitterId: key.split('|')[0], dayKey: Number(key.split('|')[1]),
                                      kind: 'swap', otherCutId: String(fixedWas[i].id) }));
                                continue;
                            }
                            // Стояли ПОДРЯД в хранимом плане → обязаны остаться соседями.
                            var wasIdxA = wasByDay[key].indexOf(fixedWas[i]);
                            var wasIdxB = wasByDay[key].indexOf(fixedWas[i + 1]);
                            if (wasIdxB === wasIdxA + 1 && b.i !== a.i + 1) {
                                var betweenIds = nowByDay[key].slice(a.i + 1, b.i).map(function(r) { return String(r.id); });
                                var between = betweenIds.join(', ');
                                out.push(ppViolation('FIXED_BLOCK', fixedWas[i + 1].id,
                                    'между зафиксированными ' + fixedWas[i].id + ' и ' + fixedWas[i + 1].id
                                    + ' вклинилось: ' + (between || '?'),
                                    { slitterId: key.split('|')[0], dayKey: Number(key.split('|')[1]),
                                      kind: 'insert', otherCutId: String(fixedWas[i].id), betweenIds: betweenIds }));
                            }
                        }
                    }
                });
                return out;
            }
        },
        {
            id: 'DAY_CAPACITY',
            tz: '§15 (потолок дня, #4467)',
            actor: 'auto',
            enforce: false,     // ПОКА только отчёт — см. ниже
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
            // ПОЧЕМУ enforce:false. Отбрасывать операции нечего: переполнение дня — это НЕ отдельная
            // «плохая» запись, а свойство всей раскладки; выбросив часть, мы получим дыры и потерянные
            // задания (#4300/#4312). Соблюдение обеспечивает упаковщик (`splitMachineQueue`: 🔒 рвётся
            // по потолку и уезжает целиком, если не влезает ни один проход), шлюз — АУДИТ: ловит
            // регрессию на любом пути записи и кричит.
            //
            // ctx.dayLoadMinutes() → { 'станок|ГГГГММДД': минуты }, ctx.dayCapacityMin() → число.
            // Источник нагрузки — сам движок (`planCutOperations` → `ops.dayLoad`): окна и разбиение
            // по дням знает только он. Нет предикатов → правило не срабатывает (конвенция реестра).
            check: function(ops, ctx) {
                var loadFn = (ctx && typeof ctx.dayLoadMinutes === 'function') ? ctx.dayLoadMinutes : null;
                var capFn = (ctx && typeof ctx.dayCapacityMin === 'function') ? ctx.dayCapacityMin : null;
                if (!loadFn || !capFn) return [];
                var cap = Number(capFn());
                if (!isFinite(cap) || cap <= 0) return [];
                var load = loadFn() || {};
                var out = [];
                Object.keys(load).forEach(function(key) {
                    var min = Number(load[key]);
                    if (!isFinite(min) || min <= cap + 1e-6) return;
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
            enforce: false,     // ПОКА только отчёт — см. ниже
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
            // ПОЧЕМУ enforce:false. Отбрасывать нечего: дыра в дне — свойство всей раскладки, а не
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
            enforce: false,     // отбрасывать нечего: разрыв чинится СШИВАНИЕМ задания, а не отказом
            title: 'Части задания, разорванного по дням, идут непрерывно: между ними нет чужих заданий',
            // ЧТО ПРОВЕРЯЕТСЯ. Задание, не влезшее в смену, живёт цепочкой записей (голова +
            // продолжения, общий «ID первой части»). Работа непрерывна: продолжение начинается там,
            // где кончилась голова, — следующим на том же станке. Если между частями встало чужое
            // задание, работа разорвана: станок перезаправляют туда-обратно, а оператор видит
            // огрызок в один проход (issue #4488: голова в 1 проход на 3-м месте дня, 11 проходов —
            // назавтра).
            //
            // ПОЧЕМУ enforce:false. Выбросить операцию нельзя: разрыв — свойство раскладки, а не
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
            enforce: false,     // отбрасывать нечего: пустая партия чинится подстановкой (fill), не отказом
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

    // Страж записи: чинит починяемое, убирает из операций то, что нарушает правила с
    // `enforce: true`, и возвращает ПОЛНЫЙ отчёт (включая правила-наблюдатели, которые пока
    // только считают). Возвращает { ops, violations, skipped, filled } — ops мутируется на месте
    // (updates/deletes/creates заменяются отфильтрованными массивами), как и ожидают вызывающие.
    function guardPlanOps(ops, ctx, actor) {
        var filled = repairPlanOps(ops, ctx, actor);
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
        if (!ops || !hasEnforced) return { ops: ops, violations: violations, skipped: 0, filled: filled };

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
        return { ops: ops, violations: violations, skipped: skipped, filled: filled };
    }

