    // ============================================================================
    // #4085 — Слой РАЗМЕЩЕНИЯ (модель #3985, ТЗ §8/§12). Перебор ВСЕХ точек вставки по
    // МИНИМАЛЬНОМУ штрафу (вес + «качество» двух переходов) + проход релокации. ЧИСТЫЕ
    // функции поверх примитивов движка (insertionCost/transitionCost/changeoverCost/
    // firstSetupCost/planWeight/dayKeyFromOffset). Слой владеет ТОЛЬКО ПОРЯДКОМ (станок +
    // индекс в очереди станка); тайминг по дням остаётся за splitMachineQueue.
    // Оценка дня приземления слота — порт математики packMachine (§Фаза 3).
    // На этой стадии модуль НЕ врезан в Generate/Reorder (стадии 4-5) → прод-риск нулевой.
    // ============================================================================

    function slotExtend(a, b){ var o = {}, k; for (k in a){ if (Object.prototype.hasOwnProperty.call(a, k)) o[k] = a[k]; }
                              for (k in b){ if (Object.prototype.hasOwnProperty.call(b, k)) o[k] = b[k]; } return o; }

    // Scoring-слот из резки контроллера. dueKey (YYYYMMDD) — из cutDueKeys()[0] (кладёт вызывающий).
    // firstPartId — голова цепочки дробления (продолжение НЕ считается независимым соседом, §9).
    function slotFromCut(cut, dueKey, orderIds){
        cut = cut || {};
        var id = String(cut.id);
        var sid = (cut.slitter && cut.slitter.id != null) ? String(cut.slitter.id)
                : (cut.slitterId != null ? String(cut.slitterId) : null);
        var dk = (dueKey != null && isFinite(Number(dueKey))) ? Number(dueKey)
               : (isFinite(Number(cut.dueKey)) ? Number(cut.dueKey) : undefined);
        var fp = (cut.firstPartId != null && String(cut.firstPartId) !== '') ? String(cut.firstPartId) : id;
        // #4194: множество «заказов» задания (id заказов обеспечиваемых позиций) — для штрафа/бонуса
        // смежности заказа в scorePosition. Кладёт вызывающий (из обеспечения); нет → cut.orderIds → undefined.
        var ords = orderIds || (cut.orderIds && typeof cut.orderIds === 'object' ? cut.orderIds : undefined);
        return { kind: 'cut', id: id, slitterId: sid,
                 materialId: cut.materialId, winding: cut.winding, batchId: cut.batchId,
                 knifeWidths: cut.knifeWidths, knifeCount: cut.knifeCount, rollerWidth: cut.rollerWidth,
                 isFoil: !!cut.isFoil, leader: cut.leader, sleeveId: cut.sleeveId,
                 plannedRuns: Number(cut.plannedRuns) || 0, dueKey: dk, fixed: !!cut.fixed, firstPartId: fp,
                 // #4497: ХРАНИМОЕ место задания — время старта («Дата план», сек) и станок, где оно
                 // лежит. По ним видно, чьё место в дне защищать (у 🔒) и кто стоял перед ней раньше.
                 // storedSid НЕ перезаписывается при назначении станка (tagSlot меняет slitterId).
                 storedTs: (function(){ var t = Number(cut.planDate); return (isFinite(t) && t > 0) ? t : undefined; })(),
                 storedSid: sid == null ? undefined : String(sid),
                 orderIds: (ords && Object.keys(ords).length) ? ords : undefined,
                 workMin: isFinite(Number(cut.workMin)) ? Number(cut.workMin) : undefined,
                 dayOffset: isFinite(Number(cut.dayOffset)) ? Number(cut.dayOffset) : undefined };
    }

    // Отпуск станка как НЕПОДВИЖНЫЙ сосед: занимает индекс (виден как сосед для стоимости), но
    // вставлять СКВОЗЬ него нельзя и по времени он не двигается (ТЗ §10).
    function vacationSlot(slitterId, dayOffset){
        return { kind: 'vacation', immovable: true, slitterId: String(slitterId),
                 dayOffset: Number(dayOffset), id: 'vac:' + String(slitterId) + ':' + String(dayOffset) };
    }

    // «Массив занятости» станков: { byMachine: { sid: [slot…] } }. Существующие резки — в
    // переданном (хронологическом) порядке; отпуска вставляются по своему dayOffset.
    function seedOccupancy(existingSlots, vacationSlots, slitterIds){
        var byMachine = {};
        (slitterIds || []).forEach(function(id){ byMachine[String(id)] = []; });
        (existingSlots || []).forEach(function(s){
            var sid = String(s.slitterId == null ? '' : s.slitterId);
            (byMachine[sid] = byMachine[sid] || []).push(s);
        });
        (vacationSlots || []).forEach(function(v){
            var sid = String(v.slitterId);
            var arr = (byMachine[sid] = byMachine[sid] || []);
            var pos = arr.length;
            for (var i = 0; i < arr.length; i++){
                var d = arr[i].dayOffset;
                if (isFinite(Number(d)) && Number(d) > Number(v.dayOffset)){ pos = i; break; }
            }
            arr.splice(pos, 0, v);
        });
        return { byMachine: byMachine };
    }

    // Рабочие минуты слота (намотка): slot.workMin, иначе perPass×plannedRuns (для оценки дня).
    function slotWorkMin(slot, ctx){
        if (slot && isFinite(Number(slot.workMin))) return Number(slot.workMin);
        ctx = ctx || {};
        var pp = (ctx.perPassByCut && slot && ctx.perPassByCut[slot.id] != null) ? ctx.perPassByCut[slot.id]
               : (ctx.perPass != null ? ctx.perPass : 0);
        return (Number(pp) || 0) * (Number(slot && slot.plannedRuns) || 0);
    }
    // Настройка «с нуля» первой резки очереди (ножи + смена сырья) — как packMachine.scratchSetup.
    function scratchSetupMin(slot, ctx){
        ctx = ctx || {};
        // #4296: сырьё теперь ВНУТРИ firstSetupCost (firstSetupParts даёт KNIFE + MATERIAL_WINDING на
        // пустом станке) — отдельно не добавляем, иначе двойной счёт сырья.
        return firstSetupCost(slot, ctx.times);
    }

    // #4547 (решение заказчика 31.07.2026): ДЕНЬ СЧИТАЕТ УПАКОВЩИК, А НЕ ОЦЕНКА. Слой размещения
    // спрашивает у `splitMachineQueue` (через ctx.realStartDayFn) день СТАРТА задания при ТОЙ ЖЕ
    // очереди станка, что рассматривается. Один вопрос — одна арифметика: якоря 🔒, обед, «Отпуск»,
    // нерабочие дни календаря, атомарность прохода и разрыв по потолку знает только упаковщик.
    //
    // ЗАЧЕМ. Прежде день «прикидывался» сложением работы префикса в ёмкость дня (`capacityMin`).
    // Такой оценки нет в ТЗ, и она расходилась с раскладкой: в боевом журнале (#4542) §8 выбрал
    // «день~20260803», а упаковщик положил задание на день 0 — на этом расхождении не сработал
    // запрет обгона 🔒. «У нас не те объёмы, чтобы гадать» (заказчик): очередь станка — десятки
    // заданий, точная упаковка по карману.
    //   ctx.realStartDayFn(ids, slitterId) → { cutId: dayOffset старта }; ids — очередь станка
    //   ЦЕЛИКОМ в рассматриваемом порядке (не префикс: с gapFill день задания зависит и от того,
    //   что стои́т после него).
    // → day-offset старта слота на позиции index.
    function packedDayOffset(machineSlots, index, ctx){
        var slot = machineSlots[index];
        if (slot && slot.kind === 'vacation') return Number(slot.dayOffset) || 0;   // отпуск стои́т на своём дне
        var ids = [];
        for (var i = 0; i < machineSlots.length; i++){
            var s = machineSlots[i];
            if (s && s.kind === 'cut' && s.id != null) ids.push(String(s.id));
        }
        if (!ids.length || !slot || slot.id == null) return 0;
        // Кэш держит САМА функция (одна на прогон planCutOperations): ctx здесь копируется на каждый
        // станок (slotExtend), и кэш на нём терялся бы на каждом вызове.
        var days = ctx.realStartDayFn(ids, ctx.slitterId) || null;
        var d = days ? days[String(slot.id)] : null;
        return (d != null && isFinite(Number(d))) ? Number(d) : 0;
    }
    // Оценка ДНЯ СТАРТА слота на позиции index (порт packMachine): пакуем префикс [0..index] по
    // дням (ёмкость ctx.capacityMin, настройка = переход/с-нуля, пропуск нерабочих ctx.machineDayOff).
    // Отпуск-слот закреплён на своём дне и «занимает» его. Возвращает day-offset старта слота index.
    //
    // #4547: ЗАПАСНОЙ путь — только там, где упаковщика не дали (точечные юнит-тесты scorePosition).
    // На путях плана его даёт planCutOperations; молча гадать нельзя (ТЗ §14), поэтому о переходе на
    // оценку сообщается в журнал.
    var warnedNoPacker = false;
    function prefixDayOffset(machineSlots, index, ctx){
        ctx = ctx || {};
        if (typeof ctx.realStartDayFn === 'function') return packedDayOffset(machineSlots, index, ctx);
        if (!warnedNoPacker){
            warnedNoPacker = true;
            if (typeof console !== 'undefined' && console.warn){
                console.warn('[pp-slot] ⚠️ #4547: упаковщик размещению не передан (realStartDayFn) — '
                    + 'день считается ОЦЕНКОЙ по ёмкости. На путях плана так быть не должно.');
            }
        }
        var cap = Number(ctx.capacityMin);
        if (!isFinite(cap) || cap <= 0) cap = Infinity;
        // Нерабочие дни — этого станка: ctx.machineDayOff (прямо) либо ctx.machineDayOffFor(sid) при переборе.
        var dayOffFn = ctx.machineDayOff || (ctx.machineDayOffFor && ctx.slitterId != null ? ctx.machineDayOffFor(ctx.slitterId) : null);
        function skipOff(d){ var g = 0; while (dayOffFn && dayOffFn(d) && g++ < 4000) d++; return d; }
        var day = skipOff(0), clock = 0, startOf = day;
        for (var i = 0; i <= index && i < machineSlots.length; i++){
            var cur = machineSlots[i];
            if (cur && cur.kind === 'vacation'){
                if (isFinite(Number(cur.dayOffset)) && Number(cur.dayOffset) > day){ day = skipOff(Number(cur.dayOffset)); clock = 0; }
                if (i === index){ startOf = day; }
                day = skipOff(day + 1); clock = 0;   // после отпуска — следующий рабочий день
                continue;
            }
            var prevCut = (i > 0 && machineSlots[i - 1] && machineSlots[i - 1].kind === 'cut') ? machineSlots[i - 1] : null;
            var setup = prevCut ? changeoverCost(prevCut, cur, ctx.times) : scratchSetupMin(cur, ctx);
            var need = setup + slotWorkMin(cur, ctx);
            if (clock > 0 && clock + need > cap){ day = skipOff(day + 1); clock = 0; }
            if (i === index){ startOf = day; }
            clock += need;
            while (clock > cap){ clock -= cap; day = skipOff(day + 1); }
        }
        return startOf;
    }

    // Можно ли вставить на позицию index (между machineSlots[index-1] и [index]).
    // Нельзя: между двумя частями ОДНОЙ цепочки дробления (общий firstPartId) — ТЗ §9.
    function canInsertAt(machineSlots, index){
        var prev = machineSlots[index - 1], next = machineSlots[index];
        if (prev && next && prev.kind === 'cut' && next.kind === 'cut'
            && prev.firstPartId != null && prev.firstPartId === next.firstPartId) return false;
        return true;
    }

    // #4497 (ТЗ §15): встанет ли slot на позицию index ПЕРЕД ЗАФИКСИРОВАННЫМ (🔒) заданием В ЕГО ЖЕ
    // ДНЕ. Замок 🔒 держит не только день, но и место в дне: вставленное перед ней задание сдвигает
    // её — и весь паровоз 🔒 за ней — на своё время + длительность («Сгенерировать вставляет задание
    // в начало дня, двигая весь паровоз зафиксированных», issue #4497). Дни по очереди станка не
    // убывают, поэтому смотрим ПЕРВУЮ 🔒 после точки вставки и сравниваем её день с днём приземления
    // слота: на СТЫКЕ ДНЕЙ правило не действует (между хвостом дня N и головой дня N+1 и так ночь).
    // День 🔒 берём по очереди БЕЗ слота — это её законный день; день слота — со вставкой.
    // #4508: ЗАДАНИЕ, КОТОРОЕ ОПЕРАТОР ДВИГАЕТ ПРЯМО СЕЙЧАС. ТЗ §15: ручное действие оператора
    // запретами формы плана не связано — ни «перед 🔒 ничего не ставить» (#4497), ни «между двумя 🔒
    // ничего не вставлять» (#4464/#4491). Признаки ровно два: `manualMove` (из `manualMoveByCut` —
    // его дают все ручные пути через `moveScope.wholeDayCutIds`) и замок ДНЯ «по весу` (#4221).
    // `lockSlitter` признаком НЕ является: при переносе, задействовавшем два станка, замок станка
    // (#4225) получают ВСЕ задания scope — по нему исключение расползлось бы на автоматику.
    function isManualMoveSlot(slot){
        return !!(slot && (slot.manualMove || slot.lockDay != null));
    }

    // Правило НЕ ограничивает:
    //   • приезжую 🔒 (взаимный порядок 🔒 судит FIXED_BLOCK, #4464/#4491);
    //   • ручной перенос — и сам переносимый слот (замок дня/станка «по весу», #4221), и 🔒, которую
    //     оператор двигает ПРЯМО СЕЙЧАС (`manualMove`): ТЗ §15 — ручное действие оператора этими
    //     запретами не связано;
    //   • НЕФОЛЬГУ перед зафиксированной ФОЛЬГОЙ: «фольга всегда в конец дня» (#3717) — правило той же
    //     твёрдости, и место 🔒-фольги от него не страдает (она и остаётся последней в дне).
    // #4542 (ТЗ §15): встанет ли slot на позицию index ПЕРЕД 🔒, которую он обгонять не вправе, —
    // в ЛЮБОМ дне, а не только в её собственном. Замок держит и очерёдность: подвижное задание не
    // уезжает раньше 🔒, за которой оно стояло, а новое (места в плане ещё нет) идёт после
    // последнего замка станка. Прежняя проверка сравнивала ДНИ приземления (pushesFixedSameDay) и
    // междневный обгон пропускала — тем более что день там ЭВРИСТИКА (capacityMin), а раскладывает
    // splitMachineQueue: в боевом случае §8 выбрал «день~20260803», а упаковщик положил на день 0
    // (issue #4542). Здесь дни не нужны вовсе — сравниваем ПОРЯДОК очереди станка.
    // Исключения те же: ручной перенос, нефольга перед 🔒-фольгой (#3717), стоявшее перед ней в
    // ХРАНИМОМ плане на том же станке.
    function overtakesFixed(machineSlots, index, slot){
        if (!slot || slot.fixed || isManualMoveSlot(slot)) return false;
        for (var j = index; j < machineSlots.length; j++){
            var f = machineSlots[j];
            if (!f || f.kind !== 'cut' || !f.fixed) continue;
            if (f.manualMove) continue;
            if (f.isFoil && !slot.isFoil) continue;   // #3717: фольга обязана остаться последней
            if (f.storedTs == null) continue;         // хранимого места у 🔒 нет — защищать нечего
            if (slot.storedTs != null && slot.storedTs < f.storedTs
                && (slot.storedSid == null ? null : String(slot.storedSid))
                   === (f.storedSid == null ? null : String(f.storedSid))) continue;   // стояло перед ней
            return true;
        }
        return false;
    }

    function pushesFixedSameDay(machineSlots, index, slot, ctx){
        if (!slot || slot.fixed || isManualMoveSlot(slot)) return false;
        var dayOff = null;
        for (var j = index; j < machineSlots.length; j++){
            var f = machineSlots[j];
            if (!f || f.kind !== 'cut' || !f.fixed) continue;
            if (f.manualMove) continue;
            if (f.isFoil && !slot.isFoil) continue;   // #3717: фольга обязана остаться последней
            if (f.storedTs == null) continue;         // хранимого места у 🔒 нет — защищать нечего
            // Стоял перед этой 🔒 в ХРАНИМОМ плане — на ТОМ ЖЕ станке (задание из того же дня, но с
            // ДРУГОГО станка перед ней не стояло: здесь оно новое) и раньше по времени (одна смена =
            // ±12 ч от её старта).
            if (slot.storedTs != null && slot.storedTs < f.storedTs
                && (f.storedTs - slot.storedTs) < 43200
                && (slot.storedSid == null ? null : String(slot.storedSid))
                   === (f.storedSid == null ? null : String(f.storedSid))) continue;
            if (dayOff == null){
                var withSlot = machineSlots.slice(0, index).concat([slot], machineSlots.slice(index));
                dayOff = prefixDayOffset(withSlot, index, ctx);
            }
            var fDay = prefixDayOffset(machineSlots, j, ctx);
            if (fDay === dayOff) return true;
            if (fDay > dayOff) return false;   // дни по очереди станка не убывают — дальше только позже
        }
        return false;
    }

    // Стоимость вставки slot на позицию index станка (ТЗ §8: вес + «качество» двух переходов) |
    // null если позиция недопустима. Срок/фольга/простой — на переходе prev→slot (о самом слоте).
    // #4194: пересекаются ли множества «заказов» двух заданий (объекты-множества {orderId: true}).
    function ordersOverlap(a, b){
        if (!a || !b) return false;
        for (var k in a){ if (Object.prototype.hasOwnProperty.call(a, k) && b[k]) return true; }
        return false;
    }
    // #4194: штраф/бонус СМЕЖНОСТИ ЗАКАЗА для вставки slot между prevCut и nextCut (веc минут):
    //  • slot делит заказ с соседом (prev ИЛИ next) → БОНУС −ORDER_DIFF_PENALTY_MN (тянуть слот к своему
    //    заказу; вес может стать отрицательным — преимущество перед идентичной конфигурацией ЧУЖОГО заказа,
    //    чтобы одинаковые конфиги разных заказов не склеивались, ТЗ #4194 п.2);
    //  • иначе, если prev и next принадлежат ОБЩЕМУ заказу, а slot — НИ ОДНОМУ из их заказов → ШТРАФ
    //    +ORDER_DIFF_PENALTY_MN (не разрывать смежный заказ чужой вставкой, ТЗ #4194 п.1).
    // Выкл при ORDER_DIFF_PENALTY_MN=0 / отсутствии заказов у slot. Действует и при вставке, и при релокации.
    function orderAdjacencyPenalty(prevCut, slot, nextCut, settings){
        var w = planWeight(settings, 'ORDER_DIFF_PENALTY_MN');
        if (!isFinite(w) || w === 0 || !slot || !slot.orderIds) return 0;
        if (ordersOverlap(slot.orderIds, prevCut && prevCut.orderIds)
            || ordersOverlap(slot.orderIds, nextCut && nextCut.orderIds)) return -w;   // бонус: рядом со своим заказом
        if (prevCut && nextCut && ordersOverlap(prevCut.orderIds, nextCut.orderIds)) return w;   // штраф: разрывает чужой заказ
        return 0;
    }
    // #4454 (ТЗ §12): РАЗБИЕНИЕ ПОСЛЕДОВАТЕЛЬНОСТИ — ТРИГГЕР пересмотра места. Планировщик ставит
    // подряд одинаковые комбинации ножей и одно сырьё, чтобы не платить переналадку; задание,
    // вклинившееся в такую цепочку, обязано быть пере-спрошено на собранной расстановке (§12):
    // место выбирается по одному, и в момент вставки будущих соседей ещё нет. ЦЕНУ разрыва считает
    // сам вес места (§8.1, честная разница — см. `scorePosition`): разрыв однородной цепочки стои́т
    // двух переналадок, готовый шов — одной. Отдельных весов у триггера нет.
    //
    // СТЫК ДНЕЙ. «Предыдущим» бывает не только соседний слот. Когда предыдущий день вне входа
    // планировщика (прошлое / вне окна [С;По]), его хвост приходит ЗАПРАВКОЙ СТАНКА
    // (`prevSetupBySlitter`, #4288) — и позиция 0 очереди станка оказывается точкой ВНУТРИ
    // последовательности «заправка → первая резка дня». Разрыв там ровно такой же: рулон снимут и
    // поставят обратно (#4454). У заправки нет ни партии, ни лидера, поэтому сырьё с ней сравниваем
    // по ВИДУ и НАМОТКЕ — так же, как их нейтрализует `carryOverPrevCut`; партия была бы выдумкой.
    function sameMaterialWinding(a, b){
        if (!a || !b) return false;
        return String(a.materialId) === String(b.materialId) && normWinding(a.winding) === normWinding(b.winding);
    }
    // prevSetup — сырая заправка станка ({materialId, winding, knifeWidths}) вместо соседа-слота.
    function breaksSequence(prevCut, slot, nextCut, prevSetup){
        if (!slot || !nextCut) return { knives: false, material: false };
        var before = prevCut || prevSetup;
        if (!before) return { knives: false, material: false };
        var carry = !prevCut;   // сравниваем с заправкой, а не с реальным соседом
        // Ножи: before и next — одна комбинация, а слот её меняет.
        var knives = !knifeChangeNeeded(before, nextCut) && knifeChangeNeeded(before, slot);
        // Сырьё/намотка(/партия у реальных соседей): before и next режут один рулон, а слот
        // встаёт между ними чужим.
        var matSame = carry ? sameMaterialWinding(before, nextCut) : !materialChangeNeeded(before, nextCut);
        var matBreaks = carry ? !sameMaterialWinding(before, slot) : materialChangeNeeded(before, slot);
        return { knives: knives, material: matSame && matBreaks };
    }
    function scorePosition(machineSlots, index, slot, ctx){
        ctx = ctx || {};
        if (!canInsertAt(machineSlots, index)) return null;
        var prev = machineSlots[index - 1] || null;
        var next = machineSlots[index] || null;
        var prevCut = (prev && prev.kind === 'cut') ? prev : null;
        var nextCut = (next && next.kind === 'cut') ? next : null;
        // #4464 (ТЗ §15): 🔒 одного дня — МОНОЛИТ. Точка между двумя зафиксированными заданиями
        // ОДНОГО дня недопустима: оператор поставил их подряд, и вклиниваться туда нельзя ни
        // размещению, ни релокации. На СТЫКЕ ДНЕЙ правило не действует (между хвостом дня N и
        // головой дня N+1 монолита нет) — потому и сравниваем дни, а не просто соседство.
        // #4508 (ТЗ §15, исключение): задание, которое оператор переносит ПРЯМО СЕЙЧАС, вправе
        // встроиться внутрь блока — туда, где §8 насчитал минимальный штраф; порядок остальных
        // звеньев при этом не меняется (упаковщик держит его по хранимому плану дня, #4491). Без
        // этого исключения в дне-стене 🔒 недопустимы почти все точки, и перенесённое «по весу»
        // задание садилось на КРАЙ блока — в голову дня, отрываясь от своей комбинации ножей
        // (issue #4508: 29 из 43 точек отброшены, выбрана поз 0 ценой смены ножей).
        // #4497 (ТЗ §15): перед 🔒 её дня ставить нельзя — вставленное сдвинуло бы её (см. выше).
        // #4542 (ТЗ §15): и в любом ДРУГОМ дне тоже — 🔒 не обгоняют (overtakesFixed шире и включает
        // случай одного дня; pushesFixedSameDay оставлен как отдельная проверка того же семейства).
        // #4547: проверки БЕЗ дней идут первыми — день теперь считает упаковщик, и спрашивать его о
        // точке, которую и так отбрасывает правило, незачем (на боевом объёме так отсеивается
        // большинство точек: «рассмотрено вариантов 3 (+ 38 недопустимых пропущено)»).
        if (overtakesFixed(machineSlots, index, slot)) return null;
        if (pushesFixedSameDay(machineSlots, index, slot, ctx)) return null;
        if (prevCut && nextCut && prevCut.fixed && nextCut.fixed && !isManualMoveSlot(slot)
            && prefixDayOffset(machineSlots, index - 1, ctx) === prefixDayOffset(machineSlots, index, ctx)) return null;
        // #4288: ПЕРВАЯ резка очереди станка (index 0, реального prev нет) НАСЛЕДУЕТ ТЕКУЩУЮ
        // ЗАПРАВКУ станка (ctx.prevSetupBySlitter) как ВИРТУАЛЬНЫЙ prev для
        // перехода prev→slot — ровно как упаковщик (splitMachineQueue carryPrevSetup, #3853) и
        // оценка идеала (qualityIdeal, #4029). Без этого слой размещения считал старт станка «с
        // нуля» и НЕ поощрял продолжить УЖЕ СТОЯЩУЮ на станке комбинацию: первая резка 22.07 не
        // подхватывала заправку 21.07 → у неё лишняя смена сырья/ножей, а совпадающая по сырью/
        // намотке/ножам резка не получала преимущества встать первой (issue #4288). Лидер/втулку
        // нейтрализуем (= как у slot): заправка партию не несёт, и changeoverParts
        // упаковщика их для carry тоже не считает — мнимую смену лидера не штрафуем. Только когда
        // carry по станку известна (иначе prev остаётся null → прежнее поведение). Для смежности
        // заказа/фольги (ниже) синтетический prev НЕ используем — у заправки нет заказа/дня.
        var beforePrev = prevCut;
        if (!beforePrev && index === 0 && ctx.prevSetupBySlitter && ctx.slitterId != null){
            var carrySetup = ctx.prevSetupBySlitter[String(ctx.slitterId)];
            if (carrySetup){
                beforePrev = carryOverPrevCut(carrySetup, slot);
                beforePrev.leader = slot.leader; beforePrev.sleeveId = slot.sleeveId;
            }
        }
        var withSlot = machineSlots.slice(0, index).concat([slot], machineSlots.slice(index));
        var dayOff = prefixDayOffset(withSlot, index, ctx);
        var placementDayKey = (ctx.baseMidnightMs != null) ? dayKeyFromOffset(ctx.baseMidnightMs, dayOff) : undefined;
        // #4202: штраф «фольга не в конце дня» (FOIL_NOTEND) был АСИММЕТРИЧЕН — начислялся только когда
        // ОЦЕНИВАЕМЫЙ слот сам фольга, а после него нефольга. Тогда РЕШЕНИЕ О ПЕРЕМЕЩЕНИИ нефольги
        // (её «цена остаться»/«цена встать» ЗА фольгой) штраф НЕ видело → любой перенос считал неполный
        // набор штрафов и мог оставить/поставить резку после фольги (жалоба юзера: «любое перемещение
        // должно вычислять ВЕСЬ набор штрафов и их сумму»). Делаем штраф СИММЕТРИЧНЫМ: нефольга сразу
        // ПОСЛЕ фольги В ТОМ ЖЕ дне тоже несёт FOIL_NOTEND. Гейт «тот же день» обязателен — нефольга в
        // НАЧАЛЕ следующего дня после фольги, закрывшей прошлый день, нарушением НЕ является (фольга там
        // последняя). Слой размещения кладёт нефольгу ПЕРВОЙ (movable сортируется), поэтому при вставке
        // нефольги фольги в занятости ещё нет → на первичное размещение симметричный член не влияет;
        // он «включается» лишь на РЕЛОКАЦИИ/оценке позиций, где фольга уже стои́т.
        var prevSameDayFoil = !slot.isFoil && prevCut && prevCut.isFoil
            && index > 0 && prefixDayOffset(withSlot, index - 1, ctx) === dayOff;
        // #4098: штраф срока (DEADLINE/EXACT_DEADLINE) при оценке «остаться» (релокация) считаем по
        // РЕАЛЬНОМУ дню слота (ctx.selfRealDayKey, из splitMachineQueue), а не по ОЦЕНКЕ дня. Иначе
        // просрочку, которую упаковка сделала реально (day1), оценка видит как «в притык» (day0) и
        // штраф в потолок (DEADLINE) не начисляется → просроченное не вытесняется дешёвым местом в срок.
        var dueDayKey = (ctx.selfRealDayKey != null) ? ctx.selfRealDayKey : placementDayKey;
        var ctxBefore = {   // prev → slot: тут «next» = сам slot → срок/фольга/простой о слоте
            settings: ctx.settings,
            freeAfterCarry: !!(prev && prev.kind === 'vacation') || !!ctx.freeAfterCarry,
            placementDayKey: dueDayKey,
            foilNotEnd: !!((slot.isFoil && nextCut && !nextCut.isFoil) || prevSameDayFoil),
            isMove: !!ctx.isMove,
            distanceExceeded: !!(ctx.distanceExceededFor && ctx.distanceExceededFor(ctx.slitterId, dayOff, index))
        };
        var ctxAfter = { settings: ctx.settings };   // slot → next: только стоимость перехода
        var cost = insertionCost(beforePrev, slot, nextCut, ctxBefore, ctxAfter);   // #4288: beforePrev = реальный prev либо заправка станка на старте
        var bf = cost.before.byFactor, af = cost.after.byFactor;
        var setupWeight = (bf.knife || 0) + (bf.material || 0) + (af.knife || 0) + (af.material || 0);
        // #4095: суммарный разбор ВЕСА по факторам (штрафным минутам) для трассировки причины выбора —
        // ножи/сырьё/лидер/фольга/срок/простой обоих переходов; «качество» (…Quality) не вес — отбрасываем.
        var byFactor = {};
        [bf, af].forEach(function(m){ Object.keys(m || {}).forEach(function(k){
            if (/Quality$/.test(k)) return;
            byFactor[k] = round3((byFactor[k] || 0) + Number(m[k] || 0));
        }); });
        // #4194: штраф/бонус смежности заказа — в ВЕС (не в setupWeight: гейт §8.4-фолбэка по setup не трогаем).
        var orderPenalty = orderAdjacencyPenalty(prevCut, slot, nextCut, ctx.settings);
        if (orderPenalty) byFactor.order = round3((byFactor.order || 0) + orderPenalty);
        // #4510 (ТЗ §8.1): ЗАЧЁТ СНЯТОГО ШВА. Цена места — НА СКОЛЬКО ДОРОЖЕ станет очередь, а не
        // сколько стоят два новых перехода. Вставая между prev и next, задание не только создаёт
        // переходы prev→slot и slot→next, но и УБИРАЕТ переход prev→next: он больше не случится.
        // Без вычета «встать в готовый шов, где переналадка уже оплачена» стои́т столько же, сколько
        // «разорвать однородную цепочку», и место рядом со СВОЕЙ комбинацией ножей проигрывает
        // чужому шву: у близнеца по ножам соседи обычно одного сырья, и приезжее задание платило за
        // них дважды (issue #4510: задание 32.5×27 встало в голову дня, хотя в том же дне стои́т
        // задание с той же комбинацией). С вычетом порядок мест совпадает с реальными минутами
        // наладки: разрыв однородной цепочки = две переналадки, готовый шов = одна.
        // На позиции 0 «предыдущим» выступает ЗАПРАВКА станка (#4288/#4454) — стык дней, когда
        // предыдущий день вне входа планировщика. Берём её СЫРОЙ (не нейтрализованный beforePrev:
        // тот подогнан под slot) и нейтрализуем партию/лидер уже под nextCut.
        var carrySetupRaw = (!prevCut && index === 0 && ctx.prevSetupBySlitter && ctx.slitterId != null)
            ? ctx.prevSetupBySlitter[String(ctx.slitterId)] : null;
        var brokenPrev = prevCut;
        if (!brokenPrev && carrySetupRaw && nextCut){
            brokenPrev = carryOverPrevCut(carrySetupRaw, nextCut);
            brokenPrev.leader = nextCut.leader; brokenPrev.sleeveId = nextCut.sleeveId;
        }
        // Переход после «хвоста» прошлого дня и так бесплатен (§8.4) — снимать нечего.
        var seamCredit = (brokenPrev && nextCut && !ctxBefore.freeAfterCarry)
            ? round3(transitionCost(brokenPrev, nextCut, { settings: ctx.settings }).weight) : 0;
        if (seamCredit) byFactor.seam = round3((byFactor.seam || 0) - seamCredit);
        return { weight: round3(cost.weight + orderPenalty - seamCredit),
                 quality: cost.quality, setupWeight: round3(setupWeight),
                 // #4457: сколько РЕАЛЬНЫХ стыков у этой точки — 1 у дописывания в конец (только
                 // вход), 2 у вставки в середину. Гейт §8.4 меряет setupWeight (сумму ПО СТЫКАМ)
                 // порогом «смена ножей + смена сырья», а это цена ОДНОГО стыка: без нормировки
                 // любая вставка в середину, требующая переналадки с обеих сторон, объявлялась
                 // «некуда пристроить» — и задание уходило мимо всех штрафов.
                 setupLinks: (beforePrev ? 1 : 0) + (nextCut ? 1 : 0),
                 dayOffset: dayOff, placementDayKey: placementDayKey, byFactor: byFactor };
    }

    // Порядок кандидатов: меньше вес → меньше «качество» → меньше день → меньший станок →
    // ПОЗЖЕ по индексу (при равной цене дописываем В КОНЕЦ, сохраняя входной порядок §7, а не
    // разворачивая одинаковые конфиги). <0 ⇒ a лучше b.
    // #4462: вынесено из betterCand в СРАВНИТЕЛЬ, чтобы тем же правилом строить топ проигравших
    // (история решения). Победитель и «ближайшие альтернативы» обязаны ранжироваться ОДИНАКОВО —
    // иначе подсказка показывала бы вторым не того, кто реально проиграл выбору.
    function cmpCand(a, b){
        if (a.weight !== b.weight) return a.weight < b.weight ? -1 : 1;
        if (a.quality !== b.quality) return a.quality < b.quality ? -1 : 1;
        if (a.dayOffset !== b.dayOffset) return a.dayOffset < b.dayOffset ? -1 : 1;
        var byM = String(a.machineId).localeCompare(String(b.machineId), 'ru');
        if (byM !== 0) return byM < 0 ? -1 : 1;
        return a.index >= b.index ? -1 : 1;
    }
    function betterCand(a, b){
        if (!b) return a; if (!a) return b;
        return cmpCand(a, b) <= 0 ? a : b;
    }
    // #4462: топ-N кандидатов в порядке cmpCand (N=3: победитель + две ближайшие альтернативы).
    function pushTopCand(list, cand){
        if (!list) return;
        var i = 0;
        while (i < list.length && cmpCand(list[i], cand) <= 0) i++;
        list.splice(i, 0, cand);
        if (list.length > TOP_CAND_N) list.length = TOP_CAND_N;
    }
    var TOP_CAND_N = 4;   // #4462: победитель + две альтернативы + запас на вычёркивание победителя
    function tagSlot(slot, machineId){ var s = slotExtend(slot, {}); s.slitterId = String(machineId); return s; }

    // §8.4-исключение: нет приемлемого кандидата → станок, освобождающийся раньше всех за период
    // (или без слотов). ТЗ §8.4 задаёт СТАНОК; позицию на нём выбираем дописыванием в конец, но
    // вес считаем ЧЕСТНО (#4457): прежняя версия возвращала `weight: 0, quality: 0`, и трасса
    // писала «вес 0 (без штрафов)» о варианте, который на деле стои́т переналадки. По такой записи
    // невозможно понять, почему задание оказалось там, где оказалось, — а именно этот вопрос и
    // задавали (issue #4457).
    function earliestFreeMachine(occupancy, slot, ctx, feasible){
        var byMachine = occupancy.byMachine, best = null;
        Object.keys(byMachine).forEach(function(sid){
            if (feasible && !feasible(sid, slot)) return;
            var arr = byMachine[sid];
            var endDay = arr.length ? prefixDayOffset(arr, arr.length - 1, slotExtend(ctx, { slitterId: sid })) : 0;
            var cand = { machineId: sid, index: arr.length, endDay: endDay };
            if (!best || cand.endDay < best.endDay
                || (cand.endDay === best.endDay && String(sid).localeCompare(String(best.machineId), 'ru') < 0)) best = cand;
        });
        if (!best) return null;
        var sc = scorePosition(byMachine[best.machineId], best.index, slot, slotExtend(ctx, { slitterId: best.machineId }));
        return { machineId: best.machineId, index: best.index,
                 weight: sc ? sc.weight : 0, quality: sc ? sc.quality : 0,
                 setupWeight: sc ? sc.setupWeight : 0, byFactor: sc ? sc.byFactor : {},
                 dayOffset: sc ? sc.dayOffset : best.endDay,
                 placementDayKey: sc ? sc.placementDayKey : undefined, fallback: true };
    }

    // #4106 (ТЗ §8 п.6): предикат «большой простой между станками». Строит по ЗАНЯТОСТИ функцию
    // distanceExceeded(candSid, candDayOff): true, если станок-кандидат УЖЕ ушёл вперёд больше чем на
    // MAX_SLOTS_DISTANCE_HR от самого рано освобождающегося ДРУГОГО станка — то есть класть на него
    // ещё одно задание значит держать другой станок простаивающим. Тогда transitionCost прибавит
    // MAX_DISTANCE_COST_MN, и выбор минимального штрафа сам уводит слот на простаивающий — БЕЗ
    // балансировщика, чисто штрафом (иначе одинаковое сырьё копится на одном станке: совпадение сырья
    // = вес 0 всегда бьёт смену сырья, а другого спред-штрафа нет, #4106).
    //
    // Меру «как далеко ушёл станок» берём как max(день слота-кандидата, СВОБОДНЫЙ день станка):
    // «текущий старт» ТЗ = день слота при ДОПИСЫВАНИИ в хвост (там он ≈ конец станка); но оценка дня
    // предпочитает МЕНЬШИЙ день (betterCand), поэтому одинаковое сырьё вставляется в НАЧАЛО дня 0
    // (candDayOff=0) и литеральный «старт слота» штраф бы не поймал, а станко-день лишь распухал.
    // Свободный день станка ловит и это: перегруженный станок дорог для ЛЮБОЙ вставки. Для дописывания
    // обе меры совпадают → согласуется с литералом ТЗ. Свободный день = день старта последнего слота
    // (как earliestFreeMachine); фиксируем ОДИН раз — за скан позиций занятость не меняется. Порог в
    // днях = MAX_SLOTS_DISTANCE_HR/24 (сутки). Пустой станок → день 0 (простаивает → штрафа нет).
    function makeDistanceExceeded(occupancy, ctx){
        var maxHr = planWeight(ctx.settings, 'MAX_SLOTS_DISTANCE_HR');
        if (!isFinite(maxHr) || maxHr <= 0) return null;   // выключено (0/пусто) → штраф не начисляем
        var maxDays = maxHr / 24;
        var byMachine = occupancy.byMachine, sids = Object.keys(byMachine), freeByMachine = {};
        sids.forEach(function(sid){
            var arr = byMachine[sid];
            freeByMachine[sid] = arr.length ? prefixDayOffset(arr, arr.length - 1, slotExtend(ctx, { slitterId: sid })) : 0;
        });
        return function(candSid, candDayOff){
            var self = Math.max(Number(candDayOff) || 0, Number(freeByMachine[candSid]) || 0);
            var minOther = Infinity;
            sids.forEach(function(sid){
                if (String(sid) === String(candSid)) return;
                if (freeByMachine[sid] < minOther) minOther = freeByMachine[sid];
            });
            if (!isFinite(minOther)) return false;   // других станков нет
            return (self - minOther) > maxDays;
        };
    }

    // Вставить slot в САМУЮ ДЕШЁВУЮ точку по ВСЕМ станкам (перебор всех позиций). Мутирует occupancy.
    // #4095: если ctx.traceTasks задан — пишет туда разбор выбора (первый рассмотренный вариант,
    // выбранный, число вариантов, дешёвший вариант В СРОК) для трассировки «Почему допущена просрочка».
    function placeSlot(occupancy, slot, ctx){
        ctx = ctx || {};
        var byMachine = occupancy.byMachine;
        var feasible = ctx.feasibleMachine || function(){ return true; };
        var distFn = makeDistanceExceeded(occupancy, ctx);   // #4106: спред-штраф §8 п.6 по текущей занятости
        var best = null;
        // #4221: «замок дня/станка» для ручного переноса 🗓 «По весу». Задание должно остаться на
        // ВЫБРАННОМ пользователем дне и станке, а ПОЗИЦИЯ в дне — по наилучшему весу (полный набор
        // штрафов scorePosition). lockSid — единственный допустимый станок; lockDay — единственный
        // допустимый день-смещение. Кандидаты вне замка отбрасываем; bestAny — страховка, если на
        // замковом дне нет ни одной точки (день переполнен → любая вставка переливает на след. день):
        // тогда ставим лучший по весу на замковом станке, чтобы задание не потерялось.
        var lockSid = slot.lockSlitter != null ? String(slot.lockSlitter) : null;
        var lockDay = isFinite(Number(slot.lockDay)) ? Number(slot.lockDay) : null;
        var bestAny = null;
        // #4462: lockSkipped — отброшено ЗАМКОМ дня (ручной перенос), отдельно от недопустимых по §9
        // (skipped): это не «нельзя вставить», а «вы сами выбрали день», и в подсказке это разные строки.
        var tr = ctx.traceTasks ? { id: slot.id, dueKey: isFinite(Number(slot.dueKey)) ? Number(slot.dueKey) : null,
                                    isFoil: !!slot.isFoil, workMin: round3(slotWorkMin(slot, ctx)),
                                    variants: 0, skipped: 0, lockSkipped: 0, first: null, bestInDue: null,
                                    alternatives: [], movedAfter: false, movedBy: null,
                                    lockDay: lockDay, lockSlitter: lockSid } : null;
        // #4462: ИСТОРИЯ РЕШЕНИЯ. betterCand схлопывает весь перебор в одного победителя, и проигравшие
        // исчезали бесследно: в трассе (#4095) оставались «первый рассмотренный» и «выбранный», а вопрос
        // оператора звучит иначе — «с чем сравнивали и насколько выбранное дешевле?». Держим топ-4 по
        // ТОМУ ЖЕ сравнителю (чтобы после вычёркивания победителя осталось две альтернативы).
        // Пул — ВСЕ просмотренные точки, включая отброшенные замком дня при ручном переносе: при замке
        // самый дешёвый вариант часто лежит в другом дне, и молчать о нём нельзя — это и есть ответ на
        // «нарушена ожидаемая математика весов» (место выбрал не вес, а ваш замок). Такие помечаются.
        var topAll = tr ? [] : null;
        function candOf(sid, idx, sc){
            return { machineId: sid, index: idx, weight: sc.weight, quality: sc.quality, setupWeight: sc.setupWeight,
                     setupLinks: sc.setupLinks,   // #4457: число стыков — гейт §8.4 нормируется на него
                     dayOffset: sc.dayOffset, placementDayKey: sc.placementDayKey, byFactor: sc.byFactor };
        }
        Object.keys(byMachine).forEach(function(sid){
            if (lockSid != null && String(sid) !== lockSid) return;   // #4221: перенос только в пределах замкового станка
            if (!feasible(sid, slot)) return;
            var arr = byMachine[sid];
            for (var idx = 0; idx <= arr.length; idx++){
                var sc = scorePosition(arr, idx, slot, slotExtend(ctx, { slitterId: sid, distanceExceededFor: distFn }));
                if (!sc){ if (tr) tr.skipped++; continue; }
                var cand = candOf(sid, idx, sc);
                if (tr){
                    tr.variants++;
                    if (!tr.first) tr.first = cand;   // ПЕРВЫЙ рассмотренный вариант (порядок перебора)
                    // Дешёвший вариант, приземляющийся В СРОК (день ≤ срока) — для объяснения просрочки.
                    if (tr.dueKey != null && sc.placementDayKey != null && Number(sc.placementDayKey) <= tr.dueKey
                        && (!tr.bestInDue || cand.weight < tr.bestInDue.weight)) tr.bestInDue = cand;
                    // #4462: запоминаем ДО фильтра замка — вариант из другого дня тоже часть ответа.
                    pushTopCand(topAll, cand);
                }
                if (lockDay != null){                                 // #4221: только точки замкового дня
                    bestAny = betterCand(cand, bestAny);
                    if (Number(sc.dayOffset) !== lockDay){ if (tr) tr.lockSkipped++; continue; }
                }
                best = betterCand(cand, best);
            }
        });
        if (best == null && bestAny != null) best = bestAny;          // #4221: замковый день переполнен — не терять задание
        // §8.4: «ни у одного станка нет подходящего соседа — везде пришлось бы и ножи менять, и
        // сырьё». Цена «и ножи, и сырьё» — это ОДИН стык; setupWeight суммирует ПО ВСЕМ стыкам
        // точки. #4457: нормируем порог на число стыков лучшего кандидата, иначе вставка в
        // середину (2 стыка) перебивала порог одного стыка почти всегда, и задание с уникальной
        // комбинацией ножей уходило в фолбэк ВСЕГДА — мимо штрафов, в том числе мимо штрафа
        // разрыва (#4454). На боевой это давало 4 слепые укладки за прогон (issue #4457).
        var accLink = planWeight(ctx.settings, 'KNIVES_CHANGE_COST_MN') + planWeight(ctx.settings, 'MATERIAL_CHANGE_COST_MN');
        var accThreshold = accLink * Math.max(1, (best && best.setupLinks) || 1);
        // #4221: замок дня/станка НЕ отпускаем на «самый свободный станок» — задание держит выбор
        // пользователя (день+станок), а не уходит на пустой станок ради экономии наладки.
        if (lockSid == null && lockDay == null && (!best || best.setupWeight > accThreshold)){
            var fb = earliestFreeMachine(occupancy, slot, ctx, feasible);
            if (fb && (!best || fb.machineId !== best.machineId)) best = fb;
        }
        if (tr){
            tr.chosen = best ? { machineId: best.machineId, index: best.index, weight: best.weight, quality: best.quality,
                                 dayOffset: best.dayOffset, placementDayKey: best.placementDayKey,
                                 byFactor: best.byFactor || {}, fallback: !!best.fallback } : null;
            // #4462: две ближайшие альтернативы = топ перебора без победителя, по ВСЕМ просмотренным
            // точкам (другие станки и дни тоже). Δ = насколько альтернатива дороже выбранного; Δ<0
            // означает, что более дешёвый вариант БЫЛ, и его отклонило не сравнение весов, а правило:
            // замок дня ручного переноса (outOfLock) либо фолбэк §8.4. Ровно это и просили увидеть.
            tr.alternatives = (topAll || []).filter(function(c){
                return !(tr.chosen && String(c.machineId) === String(tr.chosen.machineId) && Number(c.index) === Number(tr.chosen.index));
            }).slice(0, 2).map(function(c){
                return { machineId: c.machineId, index: c.index, weight: c.weight, quality: c.quality,
                         dayOffset: c.dayOffset, placementDayKey: c.placementDayKey, byFactor: c.byFactor || {},
                         outOfLock: lockDay != null && Number(c.dayOffset) !== Number(lockDay),
                         delta: round3(c.weight - (tr.chosen ? tr.chosen.weight : 0)) };
            });
            tr.overdue = !!(best && tr.dueKey != null && best.placementDayKey != null && Number(best.placementDayKey) > tr.dueKey);
            ctx.traceTasks.push(tr);
        }
        if (!best) return null;
        byMachine[best.machineId].splice(best.index, 0, tagSlot(slot, best.machineId));
        return best;
    }

    // Разместить пачку новых слотов по очереди (порядок входа сохраняем — отчёт отсортирован §7).
    function placeAllSlots(occupancy, newSlots, ctx){
        var placements = [];
        (newSlots || []).forEach(function(slot){ placements.push(placeSlot(occupancy, slot, ctx)); });
        return { occupancy: occupancy, placements: placements };
    }

    // Стоимость слота НА ТЕКУЩЕЙ позиции (для сравнения с альтернативой в релокации). #4098:
    // selfRealDayKey — РЕАЛЬНЫЙ день слота (YYYYMMDD, из splitMachineQueue) для честного штрафа срока.
    function positionCost(arr, i, ctx, sid, selfRealDayKey){
        var withoutSelf = arr.slice(0, i).concat(arr.slice(i + 1));
        var ext = { slitterId: sid };
        if (selfRealDayKey != null) ext.selfRealDayKey = selfRealDayKey;
        var sc = scorePosition(withoutSelf, i, arr[i], slotExtend(ctx, ext));
        return sc ? sc.weight : Infinity;
    }
    // Триггеры релокации (ТЗ §12): слот идёт ПОСЛЕ фольги в своём дне; день ≥ его срока; или он
    // РАЗРЫВАЕТ последовательность (#4457).
    function shouldRelocate(arr, i, slot, dayByCut, ctx){
        if (slot.kind !== 'cut' || slot.fixed) return false;
        // #4457: слот стои́т между двумя заданиями, которые без него — одна комбинация ножей или
        // одно сырьё/партия. Цена разрыва в «остаться» УЖЕ считается (#4510: зачёт снятого шва —
        // разорванная цепочка не возвращает ничего, готовый шов возвращает свою переналадку), но
        // без этого триггера её никто не спрашивает: релокация запускалась только по фольге и
        // просрочке. Жадная укладка «по одному» разрыва не видит по построению — когда слот
        // кладётся, будущих соседей ещё нет в очереди, последовательность возникает ПОЗЖЕ. Значит
        // ловить разрыв можно только здесь, на собранной расстановке (issue #4457).
        var prevCut = (i > 0 && arr[i - 1] && arr[i - 1].kind === 'cut') ? arr[i - 1] : null;
        var nextCut = (arr[i + 1] && arr[i + 1].kind === 'cut') ? arr[i + 1] : null;
        var carry = (!prevCut && i === 0 && ctx && ctx.prevSetupBySlitter && slot.slitterId != null)
            ? ctx.prevSetupBySlitter[String(slot.slitterId)] : null;
        var brk = breaksSequence(prevCut, slot, nextCut, carry);
        if (brk.knives || brk.material) return true;
        var myDay = dayByCut ? dayByCut[slot.id] : (slot.dayOffset);
        if (isFinite(Number(myDay)) && isFinite(Number(slot.dueKey))){
            var dueOff = (ctx && ctx.dueDayByCut && ctx.dueDayByCut[slot.id] != null) ? Number(ctx.dueDayByCut[slot.id]) : null;
            if (dueOff != null && Number(myDay) >= dueOff) return true;   // за/в срок → искать раньше
        }
        for (var j = 0; j < i; j++){   // есть ли фольга ПЕРЕД слотом в том же дне
            var o = arr[j];
            if (o && o.kind === 'cut' && o.isFoil && !slot.isFoil){
                var od = dayByCut ? dayByCut[o.id] : o.dayOffset;
                if (isFinite(Number(od)) && isFinite(Number(myDay)) && Number(od) === Number(myDay)) return true;
            }
        }
        return false;
    }
    function moveWeight(ctx, fromSid, toSid){
        var w = planWeight(ctx.settings, 'CHANGE_SLITTER_COST_MN');   // перенос на другой станок
        return String(fromSid) === String(toSid) ? planWeight(ctx.settings, 'CHANGE_DAY_COST_MN') : w;
    }

    // Проход релокации (ТЗ §12): по авторитетным дням (dayByCut, от splitMachineQueue при врезке;
    // в тестах — синтетические) двигать сдвинутые слоты, если новое место СТРОГО дешевле (с учётом
    // веса перемещения), кроме позиций в том же дне того же станка. Монотонно + cap итераций.
    function relocatePass(occupancy, dayByCut, ctx){
        ctx = ctx || {};
        var moves = [], maxIters = ctx.maxIters || 500, iter = 0, changed = true;
        var feasible = ctx.feasibleMachine || function(){ return true; };
        // #4104: каждый слот релоцируем НЕ БОЛЕЕ раза за проход. `dayByCut` (реальные дни от
        // splitMachineQueue) — ФИКСИРОВАННЫЙ снимок на весь проход: после переезда слота его реальный
        // день не пересчитывается до следующего пере-пакинга. Цену «остаться» (cur) считаем со штрафом
        // срока по этому реальному дню (#4098), а цену «переехать» (alt) — по оценке дня-приземления
        // кандидата. Пока слот РЕАЛЬНО за сроком (снимок фиксирован), cur всегда «дорого», а найдётся
        // место, что «дешевле» → слот пинг-понгует до cap (лог #4104: «переносов 2000» = 4 раунда × 500,
        // «он правит время»). Заморозка после первого переноса рвёт этот цикл; внешний цикл §12
        // (planCutOperations) пере-пакует и обновляет реальные дни — слот получает следующий шанс на
        // СВЕЖИХ данных (переехав, он мог перестать быть просроченным → штраф уходит → перенос не нужен).
        var movedIds = {};
        while (changed && iter++ < maxIters){
            changed = false;
            var byMachine = occupancy.byMachine, mids = Object.keys(byMachine);
            for (var mi = 0; mi < mids.length && !changed; mi++){
                var sid = mids[mi], arr = byMachine[sid];
                for (var i = 0; i < arr.length; i++){
                    var s = arr[i];
                    if (movedIds[String(s.id)]) continue;   // #4104: уже перенесён в этом проходе — не трогаем
                    if (!shouldRelocate(arr, i, s, dayByCut, ctx)) continue;
                    // #4098: если слот РЕАЛЬНО (dayByCut, splitMachineQueue) за своим сроком — цену
                    // «остаться» считаем по реальному дню (штраф DEADLINE в потолок), а не по оценке.
                    // Тогда штатный выбор самого дешёвого места сам уводит его в срок (день в срок
                    // дешевле штрафа опоздания). Иначе (в срок / без срока) — прежняя оценка.
                    var realOff = dayByCut ? dayByCut[s.id] : null;
                    var dueOff = (ctx.dueDayByCut && ctx.dueDayByCut[s.id] != null) ? Number(ctx.dueDayByCut[s.id]) : null;
                    var selfKey = (realOff != null && dueOff != null && Number(realOff) > dueOff && ctx.baseMidnightMs != null)
                        ? dayKeyFromOffset(ctx.baseMidnightMs, Number(realOff)) : null;
                    var cur = positionCost(arr, i, ctx, sid, selfKey);
                    var hasDue = isFinite(Number(s.dueKey));
                    var alt = null;
                    Object.keys(byMachine).forEach(function(tid){
                        if (!feasible(tid, s)) return;
                        var tarr = byMachine[tid];
                        for (var idx = 0; idx <= tarr.length; idx++){
                            if (tid === sid && (idx === i || idx === i + 1)) continue;   // та же позиция
                            var scanArr = (tid === sid) ? arr.slice(0, i).concat(arr.slice(i + 1)) : tarr;
                            var adjIdx = (tid === sid && idx > i) ? idx - 1 : idx;
                            var sc = scorePosition(scanArr, adjIdx, s, slotExtend(ctx, { slitterId: tid, isMove: true }));
                            if (!sc) continue;
                            // #4098 (единственное исключение): не двигаем срочное задание НА место ЗА
                            // сроком — штраф всё равно вернёт его обратно, это пустой перенос.
                            if (hasDue && sc.placementDayKey != null && Number(sc.placementDayKey) > Number(s.dueKey)) continue;
                            var total = sc.weight + moveWeight(ctx, sid, tid);
                            if (!alt || total < alt.total){ alt = { machineId: tid, index: idx, total: total }; }
                        }
                    });
                    if (alt && alt.total < cur - 1e-6){
                        arr.splice(i, 1);
                        var insIdx = (alt.machineId === sid && alt.index > i) ? alt.index - 1 : alt.index;
                        byMachine[alt.machineId].splice(insIdx, 0, tagSlot(s, alt.machineId));
                        moves.push({ id: s.id, from: sid, to: alt.machineId });
                        movedIds[String(s.id)] = true;   // #4104: заморозить слот до следующего раунда §12
                        changed = true; break;
                    }
                }
            }
        }
        return { occupancy: occupancy, moves: moves };
    }

    // #4118 — ДОПОЛНИТЕЛЬНЫЙ проход после §12-цикла: всё, что ВСЁ ЕЩЁ просрочено по РЕАЛЬНЫМ дням
    // (splitMachineQueue), заталкиваем обратно в НАИМЕНЕЕ штрафное место — можно на другой станок —
    // стандартным механизмом перебора точек вставки. КЛЮЧЕВОЕ отличие от relocatePass: кандидата
    // оцениваем не ОЦЕНКОЙ дня (эвристика capacityMin, оптимистична — из-за неё §12-цикл может
    // «переносить вхолостую» и оставить просрочку, issue #4118), а РЕАЛЬНОЙ упаковкой (realDayFn).
    //
    // realDayFn(orderIds, machineId) → { cutId: dayOffset } — реальный день ЗАВЕРШЕНИЯ каждого задания
    // очереди при заданном порядке (#4290: ПОСЛЕДНИЙ день намотки его сегментов — разбитое по дням
    // задание в срок, лишь когда готова последняя часть). Даёт вызывающий (planCutOperations),
    // прокидывая настоящий splitMachineQueue с параметрами станка (обед/отпуск/нахлёст/заправка).
    //
    // Гарантии (чтобы не навредить): двигаем ТОЛЬКО само просроченное задание; принимаем перенос,
    // лишь если его реальный день СТРОГО меньше (монотонность → сходимость), и лишь если НИ ОДНО
    // другое задание станка-приёмника от вставки не станет БОЛЬШЕ просрочено (не создаём/не углубляем
    // чужую просрочку). Среди допустимых мест — наименьший реальный день, затем наименьший штраф §8.
    function relocateOverdueReal(occupancy, dueDayByCut, realDayFn, ctx){
        ctx = ctx || {};
        dueDayByCut = dueDayByCut || {};
        var byMachine = occupancy.byMachine;
        var feasible = ctx.feasibleMachine || function(){ return true; };
        var maxRounds = ctx.maxRounds || 12, moves = [];   // #4338: цепочка вытеснений сходится (netGain монотонно ↓); 12 — потолок-бэкстоп
        function cutIdsOf(key){
            return byMachine[key].filter(function(s){ return s && s.kind === 'cut'; }).map(function(s){ return String(s.id); });
        }
        function overdueDays(id, real){   // на сколько дней задание id за своим сроком (0 если в срок/без срока)
            var due = dueDayByCut[id];
            if (due == null || real[id] == null) return 0;
            var d = Number(real[id]) - Number(due);
            return d > 0 ? d : 0;
        }
        for (var round = 0; round < maxRounds; round++){
            var changed = false;
            // текущие реальные дни по каждому станку (станки независимы — день задания задаёт его очередь)
            var realBy = {}; Object.keys(byMachine).forEach(function(k){ realBy[k] = realDayFn(cutIdsOf(k), k) || {}; });
            // собрать просроченные (самые «глубокие» первыми — им труднее найти место)
            // #4224: рескьюем даже ЗАФИКСИРОВАННОЕ (🔒) просроченное задание. Просрочка недопустима
            // НИКАКИМ образом; фикс, оставивший задание за сроком, невалиден (пользователь приколол
            // задание, ожидая его В СРОК, а перестройка увела за срок). НЕ просроченный фикс не трогаем
            // (od=0 отсеет), а при переносе бережём чужие фиксы — не выталкиваем их на день позже (ниже).
            var overdue = [];
            Object.keys(byMachine).forEach(function(sid){
                byMachine[sid].forEach(function(s){
                    if (!s || s.kind !== 'cut') return;
                    if (s.fixed) return;   // #4434 п.1: 🔒 не двигаем НИКОГДА — даже ради спасения от просрочки
                    var od = overdueDays(String(s.id), realBy[sid]);
                    if (od > 0) overdue.push({ id: String(s.id), sid: sid, curReal: Number(realBy[sid][String(s.id)]), depth: od });
                });
            });
            if (!overdue.length) break;
            overdue.sort(function(a, b){ return b.depth - a.depth; });
            for (var oi = 0; oi < overdue.length; oi++){
                var task = overdue[oi], sid = task.sid, arr = byMachine[sid];
                var pos = -1;
                for (var i = 0; i < arr.length; i++){ if (arr[i].kind === 'cut' && String(arr[i].id) === task.id){ pos = i; break; } }
                if (pos < 0) continue;
                var slot = arr[pos];
                arr.splice(pos, 1);   // снять с текущего места — оцениваем ЧИСТЫЕ станки-приёмники
                // #4434 п.1: рескью 🔒 УБРАН (был #4224/#4424). Замок дня абсолютен: задание, которое
                // оператор приколол к дню, не переезжает НИ ПО КАКОЙ причине, включая просрочку —
                // просрочку 🔒 показывает панель «просрочено» и лог #4200, решение за оператором.
                // Сюда 🔒 больше не попадает (отфильтровано при сборе overdue выше).
                var best = null;      // { tid, idx, real, penalty }
                Object.keys(byMachine).forEach(function(tid){
                    if (!feasible(tid, slot)) return;
                    var tarr = byMachine[tid];
                    var baseIds = cutIdsOf(tid);
                    var baseReal = realDayFn(baseIds, tid) || {};   // дни приёмника БЕЗ задания (для проверки «не навредили»)
                    var fixedOnTid = {};   // #4224: чужие фиксы приёмника — их НЕЛЬЗЯ вытолкнуть на день позже
                    tarr.forEach(function(s){ if (s && s.kind === 'cut' && s.fixed) fixedOnTid[String(s.id)] = 1; });
                    for (var idx = 0; idx <= tarr.length; idx++){
                        if (!canInsertAt(tarr, idx)) continue;
                        // #4497 (ТЗ §15): перед 🔒 её дня не встаёт и СПАСЕНИЕ ПРОСРОЧКИ. Замок 🔒 —
                        // жёсткое правило, просрочка — видимая информация (её называет панель #4161 и
                        // лог #4200), ровно как с заморозкой дня: правило сильнее срока.
                        if (pushesFixedSameDay(tarr, idx, slot, slotExtend(ctx, { slitterId: tid }))) continue;
                        var before = tarr.slice(0, idx).filter(function(s){ return s && s.kind === 'cut'; }).map(function(s){ return String(s.id); });
                        var after = tarr.slice(idx).filter(function(s){ return s && s.kind === 'cut'; }).map(function(s){ return String(s.id); });
                        var trialIds = before.concat([task.id], after);
                        var real = realDayFn(trialIds, tid) || {};
                        var myReal = real[task.id];
                        if (myReal == null || Number(myReal) >= task.curReal) continue;   // не улучшает СВОЙ реальный день — мимо
                        // #4338: ВЫТЕСНЕНИЕ несрочного соседа под срочное. Раньше вставка отвергалась, если
                        // углубляла просрочку ЛЮБОГО соседа (harms) — в плотном графике это блокировало все
                        // ранние вставки, и срочное уходило «дозакладом» в хвост (день 6 при свободном дне 1).
                        // По ТЗ §8/§11 DEADLINE(200) доминирует над переналадкой: подвинуть НЕСРОЧНОГО (или
                        // менее просроченного) соседа под срочное — выгодно. Критерий приёма — СУММАРНОЕ
                        // опоздание плана строго уменьшается (netGain>0). Т.к. измеритель монотонно убывает,
                        // зацикливания нет (см. §6 docs/atex_planning_actual_behavior.md). Жёсткое исключение:
                        // чужой замок 🔒 нельзя увести на более поздний день (это запрет, не вес).
                        var hardBlock = false, costDays = 0;
                        for (var bi = 0; bi < baseIds.length; bi++){
                            var oid = baseIds[bi];
                            var wasOd = (dueDayByCut[oid] == null || baseReal[oid] == null) ? 0 : Math.max(0, Number(baseReal[oid]) - Number(dueDayByCut[oid]));
                            var nowOd = (dueDayByCut[oid] == null || real[oid] == null) ? 0 : Math.max(0, Number(real[oid]) - Number(dueDayByCut[oid]));
                            if (nowOd > wasOd) costDays += (nowOd - wasOd);   // насколько углубилась просрочка вытесненных
                            // #4224: не ломаем чужой замок дня — фикс не должен переехать на более поздний день
                            if (fixedOnTid[oid] && baseReal[oid] != null && real[oid] != null && Number(real[oid]) > Number(baseReal[oid])) hardBlock = true;
                        }
                        if (hardBlock) continue;
                        var dueT = dueDayByCut[task.id];
                        var savedDays = task.depth - (dueT == null ? 0 : Math.max(0, Number(myReal) - Number(dueT)));   // на сколько дней срочное перестало опаздывать
                        var netGain = savedDays - costDays;   // >0 ⇒ суммарное опоздание плана уменьшилось
                        if (netGain <= 0) continue;
                        var sc = scorePosition(tarr, idx, slot, slotExtend(ctx, { slitterId: tid, isMove: true }));
                        var penalty = (sc ? sc.weight : 0) + moveWeight(ctx, sid, tid);
                        if (!best || netGain > best.netGain || (netGain === best.netGain && penalty < best.penalty)){
                            best = { tid: tid, idx: idx, real: Number(myReal), netGain: netGain, penalty: penalty };
                        }
                    }
                });
                if (best){
                    byMachine[best.tid].splice(best.idx, 0, tagSlot(slot, best.tid));
                    moves.push({ id: task.id, from: sid, to: best.tid, real: best.real });
                    changed = true;
                } else {
                    arr.splice(pos, 0, slot);   // некуда лучше — вернуть на место
                }
            }
            if (!changed) break;
        }
        return { occupancy: occupancy, moves: moves };
    }

    // #4338: ЕДИНЫЙ жадный проход (ТЗ §8/§11). Берём задание с ХУДШИМ штрафом (DEADLINE=200 доминирует ⇒
    // просроченное первым) и двигаем в позицию с МИНИМАЛЬНЫМ суммарным штрафом плана: переналадка по
    // очереди станка (changeoverCost/firstSetupCost) + срок по РЕАЛЬНОМУ дню завершения (realDayFn).
    // Выталкивание соседа ЗА СРОК невыгодно само — его +DEADLINE входит в суммарный штраф. Хэш
    // посещённых расстановок: ход в виденное состояние — пропускаем, берём следующий по списку. Стоп —
    // когда ни одно задание нельзя улучшить. МОНОТОННО (суммарный штраф строго убывает) ⇒ без
    // зацикливания; + cap итераций как бэкстоп. 🔒 двигаем только в пределах своего станка. realDayFn(ids,
    // mid) → {id: реальный день завершения}. Заменяет оценочные §12-релокацию + #4118/#4203.
    function greedyRefine(occupancy, dueDayByCut, realDayFn, ctx){
        ctx = ctx || {}; dueDayByCut = dueDayByCut || {};
        var byMachine = occupancy.byMachine;
        var feasible = ctx.feasibleMachine || function(){ return true; };
        var times = ctx.times, settings = ctx.settings;
        var W_DL = planWeight(settings, 'DEADLINE_COST_MN'), W_EX = planWeight(settings, 'EXACT_DEADLINE_COST_MN');
        var maxIters = Number(ctx.greedyMaxIters) || 300, EPS = 1e-6;
        var moves = [];   // #4462: чьё место переопределил жадный проход (для честной подсказки карточки)
        function cutsOf(key){ return byMachine[key].filter(function(s){ return s && s.kind === 'cut'; }); }
        function idsOf(key){ return cutsOf(key).map(function(s){ return String(s.id); }); }
        // Мемо упаковщика: одна и та же очередь станка пакуется многократно (перебор точек вставки).
        // Ключ — станок + порядок id; результат (дни завершения) детерминирован ⇒ кэш валиден весь проход.
        var packMemo = {};
        function rday(ids, mid){ var k = mid + '#' + ids.join(','); return packMemo[k] || (packMemo[k] = (realDayFn(ids, mid) || {})); }
        // Штраф срока ПРОПОРЦИОНАЛЕН опозданию (× дней) — иначе плоский +DEADLINE не даёт градиента, и
        // жадный проход свободно двигает просроченное ещё позже. Минимизируем СУММАРНОЕ опоздание плана.
        function dlPen(id, rd){ var due = dueDayByCut[id]; if (due == null || rd[id] == null) return 0;
            var d = Number(rd[id]) - Number(due); return d > 0 ? W_DL * d : (d === 0 ? W_EX : 0); }
        // Штраф очереди станка = переналадка (посл. переходы + первая настройка) + срок его заданий по
        // РЕАЛЬНОМУ дню (одна упаковка realDayFn — единый источник дня).
        function machineCost(key){
            var arr = byMachine[key], rd = rday(idsOf(key), key), c = 0, prev = null;
            for (var i = 0; i < arr.length; i++){ var s = arr[i]; if (!s || s.kind !== 'cut') continue;
                c += prev ? changeoverCost(prev, s, times) : firstSetupCost(s, times);
                c += dlPen(String(s.id), rd); prev = s; }
            return c;
        }
        function hashState(){ return Object.keys(byMachine).sort().map(function(k){ return k + ':' + idsOf(k).join(','); }).join('|'); }
        var seen = {}; seen[hashState()] = 1;
        for (var iter = 0; iter < maxIters; iter++){
            // штраф каждого задания (срок по реальному дню + его входящая переналадка) → худшее первым
            var realNow = {}; Object.keys(byMachine).forEach(function(k){ var r = rday(idsOf(k), k); Object.keys(r).forEach(function(id){ realNow[id] = r[id]; }); });
            // #4338 перф+фокус: двигаем ТОЛЬКО ПРОСРОЧЕННЫЕ задания (dlPen>0). Их единицы, а переналадку
            // прочих и так оптимизируют слой размещения + внутридневная пересортировка + склейка островов.
            // Уникальная ценность greedy — ВЫТЕСНЕНИЕ просроченного (чего старые проходы не умеют); её и
            // делаем, быстро. Стоимость хода при этом учитывает ВСЕХ вытесняемых (не загоняем их за срок).
            var tasks = [];
            Object.keys(byMachine).forEach(function(sid){ var arr = byMachine[sid], prev = null;
                for (var i = 0; i < arr.length; i++){ var s = arr[i]; if (!s || s.kind !== 'cut') continue;
                    var dp = dlPen(String(s.id), realNow);
                    // #4434 п.1: 🔒 не двигаем даже в пределах своего станка — позиция в очереди задаёт
                    // ДЕНЬ, значит любой такой ход = переезд зафиксированного задания на другой день.
                    if (dp > 0 && !s.fixed) tasks.push({ id: String(s.id), sid: sid, pos: i, slot: s, pen: dp + (prev ? changeoverCost(prev, s, times) : firstSetupCost(s, times)) });
                    prev = s; } });
            if (!tasks.length) break;   // просроченных нет — оптимизация переналадки остаётся за прочими проходами
            tasks.sort(function(a, b){ return b.pen - a.pen; });
            var applied = false;
            for (var ti = 0; ti < tasks.length && !applied; ti++){
                var T = tasks[ti];
                var oldCostSid = machineCost(T.sid);          // штраф sid С заданием T (база)
                byMachine[T.sid].splice(T.pos, 1);            // снять T с текущего места
                var oldSidNoT = machineCost(T.sid);           // штраф sid БЕЗ T
                // #4338 перф: ищем ЛУЧШИЙ ход, но пакуем позиции лениво — ПОЗИЦИИ С НАЧАЛА (просроченное
                // выгоднее раньше ⇒ хорошая вставка находится в первых индексах). Раньше считали ВСЕ дельты
                // и сортировали (десятки упаковок/итерацию → 22с). Теперь на каждом станке останавливаем
                // перебор индексов, как только нашли улучшение (delta<0): более поздние индексы для срока
                // не лучше. Из по-станочных кандидатов берём глобально лучший (устойчиво к балансу).
                var tids = Object.keys(byMachine);
                var best = null;
                for (var mi = 0; mi < tids.length; mi++){
                    var tid = tids[mi];
                    if (!feasible(tid, T.slot)) continue;
                    var same = String(tid) === String(T.sid);
                    var oldCostTid = same ? 0 : machineCost(tid);
                    var tarr = byMachine[tid], mBest = null;
                    for (var idx = 0; idx <= tarr.length; idx++){
                        if (!canInsertAt(tarr, idx)) continue;
                        // #4497 (ТЗ §15): жадный проход тоже не ставит задание перед 🔒 её дня.
                        if (pushesFixedSameDay(tarr, idx, T.slot, slotExtend(ctx, { slitterId: tid }))) continue;
                        tarr.splice(idx, 0, tagSlot(T.slot, tid));
                        var newCostTid = machineCost(tid);
                        tarr.splice(idx, 1);
                        var delta = (same ? (newCostTid - oldCostSid)
                                          : (oldSidNoT + newCostTid - oldCostSid - oldCostTid))
                                    + moveWeight(ctx, T.sid, tid);
                        if (delta < -EPS && (!mBest || delta < mBest.delta)) mBest = { tid: tid, idx: idx, delta: delta };
                        if (mBest) break;   // на этом станке лучшая вставка — самая ранняя улучшающая (перф)
                    }
                    if (mBest && (!best || mBest.delta < best.delta)) best = mBest;
                }
                if (best && best.delta < -EPS){
                    byMachine[best.tid].splice(best.idx, 0, tagSlot(T.slot, best.tid));
                    var h = hashState();
                    if (seen[h]){ byMachine[best.tid].splice(best.idx, 1); byMachine[T.sid].splice(T.pos, 0, T.slot); }   // виденное — вернуть, к следующему заданию
                    else { seen[h] = 1; applied = true; moves.push({ id: T.id, from: T.sid, to: best.tid }); }
                } else byMachine[T.sid].splice(T.pos, 0, T.slot);   // вернуть T на место
            }
            if (!applied) break;
        }
        return { occupancy: occupancy, moves: moves };
    }

    // Порядок резок по станкам для splitMachineQueue (отпуска отбрасываются — они не резки).
    function slotOrderByMachine(occupancy){
        var out = {};
        Object.keys(occupancy.byMachine).forEach(function(sid){
            out[sid] = occupancy.byMachine[sid].filter(function(s){ return s && s.kind === 'cut'; })
                                               .map(function(s){ return s.id; });
        });
        return out;
    }

    function distinctSlitterIds(cutsList){
        var seen = {}, out = [];
        (cutsList || []).forEach(function(c){
            var sid = c && c.slitter && c.slitter.id;
            if (sid != null && !seen[String(sid)]){ seen[String(sid)] = 1; out.push(String(sid)); }
        });
        return out;
    }

    // cutId→станок и порядок в его очереди из занятости. Общий помощник: финал размещения и
    // ПЕРЕ-СБОРКА после релокации по реальным дням (§12) в planCutOperations.
    function assignmentFromOccupancy(occ){
        var slitterByCut = {}, orderIdxByCut = {};
        Object.keys(occ.byMachine).forEach(function(sid){
            var idx = 0;
            occ.byMachine[sid].forEach(function(s){
                if (s.kind !== 'cut') return;
                slitterByCut[s.id] = sid; orderIdxByCut[s.id] = idx++;
            });
        });
        return { slitterByCut: slitterByCut, orderIdxByCut: orderIdxByCut };
    }

    // #4095: снимок ПЕРЕМЕННЫХ размещения для трассировки — веса штрафов (⚙ из «Настройки» /
    // ▫ дефолт кода, как решает planWeight) + мета (ёмкость-оценка, станки, счётчики).
    function buildPlacementVariables(ctx, slitterIds, movableN, fixedN){
        var s = ctx.settings || {};
        var KEYS = ['DEADLINE_COST_MN','EXACT_DEADLINE_COST_MN','FOIL_NOTEND_COST_MN','KNIVES_CHANGE_COST_MN',
                    'KNIVES_INCREASE_COST_MN','MATERIAL_CHANGE_COST_MN','LEADER_COST_MN','MAX_DISTANCE_COST_MN',
                    'CHANGE_SLITTER_COST_MN','CHANGE_DAY_COST_MN','SLOT_SPLIT_COST_MN','MAX_SLOTS_DISTANCE_HR','MAX_OUTAGE_PLANNABLE_HR',
                    'ORDER_DIFF_PENALTY_MN'];   // #4194: смежность заказа
        var vars = KEYS.map(function(k){
            var raw = s[k];
            var fromTable = raw != null && String(raw).trim() !== '' && isFinite(Number(raw));
            return { key: k, value: planWeight(s, k), source: fromTable ? 'Настройка' : 'дефолт' };
        });
        return { variables: vars,
                 meta: { capacityMin: ctx.capacityMin, baseMidnightMs: ctx.baseMidnightMs,
                         slitterIds: (slitterIds || []).slice(), movable: movableN, fixed: fixedN,
                         vacations: (ctx.vacationSlots || []).length,
                         note: 'День варианта — из splitMachineQueue (та же упаковка, что раскладывает план): ёмкость-оценки в решении нет (#4547).' },
                 tasks: [], refine: null };
    }

    // #4095: разбор одного кандидата (станок/позиция/вес/оценка дня/факторы штрафа) для лога.
    function fmtSlotCand(c){
        if (!c) return '—';
        var f = c.byFactor || {}, parts = [];
        // Знак берём у самого слагаемого: бонус соседства заказа (#4194) и зачёт снятого шва
        // (#4510) отрицательны, и «+-95» в трассе читалось бы как опечатка.
        Object.keys(f).forEach(function(k){ if (f[k]) parts.push(k + ' ' + (f[k] > 0 ? '+' : '') + f[k]); });
        return 'станок ' + c.machineId + ' поз ' + c.index + ' → вес ' + c.weight
             + ' (день ' + (c.placementDayKey == null ? '?' : c.placementDayKey)
             + (parts.length ? ('; ' + parts.join(', ')) : '; без штрафов') + ')';
    }
    // #4462: подписи факторов штрафа ДЛЯ ОПЕРАТОРА (ключи byFactor приходят из transitionCost/
    // scorePosition). Незнакомый ключ печатаем как есть — молча терять слагаемое веса нельзя.
    var PLACE_FACTOR_LABELS = {
        knife: 'ножи', material: 'сырьё/намотка', leader: 'лидер+втулка',
        foilNotEnd: 'фольга не в конце дня', foilMove: 'перенос за фольгу',
        deadline: 'просрочка', exactDeadline: 'впритык к сроку',
        distance: 'простой другого станка', order: 'соседство заказа',
        seam: 'зачёт снятого шва'   // #4510: переналадка prev→next, которой больше не будет
    };
    // #4462: разбор веса — только ПРИМЕНЁННЫЕ слагаемые. Аннигилированные (0) не печатаем: «ножи +0»
    // ничего не объясняет, а десяток нулей прячет настоящую причину («вижу все применённые веса, кроме
    // аннигилированных»). Крупные первыми — сверху то, что решило исход, а не то, что стои́т первым в объекте.
    function formatFactorParts(byFactor){
        var f = byFactor || {}, parts = [];
        Object.keys(f).forEach(function(k){
            var v = Number(f[k]) || 0;
            if (!v) return;
            parts.push({ k: k, v: v });
        });
        parts.sort(function(a, b){ return Math.abs(b.v) - Math.abs(a.v); });
        return parts.map(function(p){ return (PLACE_FACTOR_LABELS[p.k] || p.k) + ' ' + (p.v > 0 ? '+' : '') + p.v; }).join(', ');
    }
    // #4462: одна строка кандидата для подсказки: где, почём и из чего вес. delta — насколько дороже
    // выбранного (у самого выбранного нет).
    function fmtPlaceCandLine(c){
        if (!c) return '—';
        var f = formatFactorParts(c.byFactor);
        return 'станок ' + c.machineId + ', позиция ' + c.index
             + (c.placementDayKey == null ? '' : (', день ' + c.placementDayKey))
             + ' — вес ' + c.weight
             + (c.delta == null ? '' : (c.delta === 0 ? ' (тот же вес)' : (' (' + (c.delta > 0 ? '+' : '') + c.delta + ')')))
             + (f ? (': ' + f) : ': без штрафов')
             // #4462: вариант вне выбранного дня отклонён ЗАМКОМ ручного переноса, а не ценой. Без этой
             // пометки более дешёвая альтернатива читалась бы как ошибка планировщика.
             + (c.outOfLock ? '  ← вне выбранного вами дня: отклонён замком переноса, не весом' : '');
    }
    // #4462: ИСТОРИЯ ПРИНЯТИЯ РЕШЕНИЯ одним заданием — текст для title карточки очереди
    // (.atex-pp-cut-time). Отвечает на вопрос «почему именно этот слот победил»: сколько вариантов
    // просмотрено, что выбрано и из каких весов сложилась цена, две ближайшие альтернативы с Δ.
    // ЧИСТАЯ (покрыта тестом): DOM и настройки трассировки её не касаются — подсказка обязана быть
    // и при выключенном логе [pp-slot].
    function formatPlacementDecisionTitle(t){
        if (!t || !t.chosen) return '';
        var L = [];
        var head = 'Выбор места (§8): рассмотрено вариантов ' + (Number(t.variants) || 0);
        if (t.skipped) head += ', недопустимых ' + t.skipped;
        if (t.lockSkipped) head += ', вне выбранного дня ' + t.lockSkipped;
        if (t.dueKey != null) head += '; срок ' + t.dueKey;
        L.push(head);
        L.push('Выбрано: ' + fmtPlaceCandLine(t.chosen)
             + (t.chosen.fallback ? '  [§8.4: подходящего соседа нет ни на одном станке — станок выбран правилом, не ценой]' : ''));
        if ((t.alternatives || []).length){
            L.push('Ближайшие альтернативы (Δ — насколько дороже выбранного):');
            t.alternatives.forEach(function(a, i){ L.push('  ' + (i + 1) + ') ' + fmtPlaceCandLine(a)); });
        } else {
            L.push('Альтернатив нет: другой допустимой точки вставки перебор не нашёл.');
        }
        if (t.overdue){
            L.push(t.bestInDue
                ? ('⚠️ Оценка ставит ЗА СРОК: вариант в срок был (вес ' + t.bestInDue.weight + ' против ' + t.chosen.weight + ') — переналадка вышла дороже штрафа опоздания.')
                : '⚠️ Оценка ставит ЗА СРОК: варианта в срок нет — ёмкость дней до срока исчерпана.');
        }
        if (t.movedAfter){
            L.push('⚠️ После этого выбора задание переносил проход «' + (t.movedBy || 'последующий') + '»: итоговое место выбрано НЕ этим сравнением.');
        } else if (t.reseqBy){
            L.push('Порядок в дне после выбора ещё пересобирали: ' + t.reseqBy + ' (день и станок при этом не менялись).');
        }
        if (t.realDay != null){
            L.push('Итог по реальной упаковке: день №' + t.realDay + ' от начала периода'
                 + (t.overdueReal ? (' — ПОСЛЕ срока (день №' + t.dueDayOffset + ')') : ' — в срок'));
        }
        return L.join('\n');
    }
    // #4462: разбор размещения → карта cutId → подсказка. touchedIds (если задан) оставляет ТОЛЬКО
    // задания, которые план реально тронул: подсказка о выборе места на карточке, которую последний
    // пересчёт не двигал, вводила бы в заблуждение — она описывала бы прошлое решение.
    function placementTitlesByCut(placement, touchedIds){
        var out = {};
        if (!placement || !placement.tasks) return out;
        var want = null;
        if (touchedIds){ want = {}; touchedIds.forEach(function(id){ want[String(id)] = 1; }); }
        placement.tasks.forEach(function(t){
            if (!t || t.id == null) return;
            if (want && !want[String(t.id)]) return;
            var title = formatPlacementDecisionTitle(t);
            if (title) out[String(t.id)] = title;
        });
        return out;
    }
    // #4095: структурный trace размещения → строки лога (ЧИСТАЯ, покрыта тестом). #4547: день —
    // ОДИН, из splitMachineQueue: и в разборе выбора, и в итоге. Прежде разбор печатал «день~»
    // (ёмкость-оценка) рядом с «РЕАЛЬНЫМ днём» упаковщика, и они расходились.
    function formatSlotPlacementTrace(trace){
        var L = [];
        if (!trace) return L;
        L.push('═══ РАЗМЕЩЕНИЕ #3985 (#4085): перебор ВСЕХ точек вставки по мин. штрафу ═══');
        L.push('ПЕРЕМЕННЫЕ (⚙ = из «Настройки» / ▫ = дефолт кода):');
        (trace.variables || []).forEach(function(v){
            L.push('  ' + (v.source === 'Настройка' ? '⚙' : '▫') + ' ' + v.key + ' = ' + v.value + '  [' + v.source + ']');
        });
        var m = trace.meta || {};
        L.push('  день КАЖДОГО варианта считает упаковщик (#4547); станков ' + (m.slitterIds || []).length
             + '; заданий: подвижных ' + m.movable + ', фикс ' + m.fixed + ', отпусков ' + m.vacations);
        L.push('  ⚠ ' + (m.note || ''));
        (trace.tasks || []).forEach(function(t){
            L.push('── задание ' + t.id + ' (срок ' + (t.dueKey == null ? '—' : t.dueKey) + ', '
                 + (t.isFoil ? 'фольга' : 'обычн.') + ', работа ' + t.workMin + ' мин): рассмотрено вариантов ' + t.variants
                 + (t.skipped ? (' (+ ' + t.skipped + ' недопустимых пропущено)') : '') + ' ──');
            if (t.first) L.push('   ПЕРВЫЙ рассмотренный: ' + fmtSlotCand(t.first));
            if (t.chosen) L.push('   ВЫБРАН: ' + fmtSlotCand(t.chosen) + (t.chosen.fallback ? ' [фолбэк §8.4: некуда пристроить]' : ''));
            // #4462: две ближайшие альтернативы — то же, что видит оператор в подсказке карточки.
            (t.alternatives || []).forEach(function(a, i){
                L.push('   альтернатива ' + (i + 1) + ' (Δ ' + (a.delta > 0 ? '+' : '') + a.delta + '): ' + fmtSlotCand(a));
            });
            if (t.overdue){
                if (t.bestInDue) L.push('   ⚠️ ЗА СРОК: день ' + t.chosen.placementDayKey + ' > срок ' + t.dueKey
                     + '; вариант В СРОК БЫЛ (вес ' + t.bestInDue.weight + ' vs выбран ' + t.chosen.weight + ') — переналадка дороже штрафа опоздания');
                else L.push('   ⚠️ ЗА СРОК: день ' + t.chosen.placementDayKey + ' > срок ' + t.dueKey
                     + '; варианта В СРОК НЕТ — ёмкость дней ≤ срока исчерпана (честный конфликт)');
            }
            if (t.realDay != null) L.push('   РЕАЛЬНЫЙ день (splitMachineQueue, арбитр §12): ' + t.realDay
                 + (t.overdueReal ? (' — ⚠️ ПОСЛЕ срока (' + t.dueDayOffset + ') → ПРОСРОЧКА') : ' — в срок ✓'));
        });
        if (trace.refine) L.push('§12 релокация по РЕАЛЬНЫМ дням: раундов ' + trace.refine.rounds
             + ', переносов ' + trace.refine.moves + (trace.refine.overdueLeft ? (', осталось за срок ' + trace.refine.overdueLeft) : ', просрочек нет ✓'));
        // #4118: доп. проход — затолкать всё ещё просроченное в наименее штрафное место по РЕАЛЬНЫМ дням.
        if (trace.refine && trace.refine.overdueMoves != null) L.push('#4118 доп. проход (просроченное → наименее штрафное место по РЕАЛЬНЫМ дням): переносов ' + trace.refine.overdueMoves);
        return L;
    }

    // ЕДИНАЯ точка входа размещения (для planCutOperations, стадии 4-5): по резкам контроллера
    // строит занятость (фикс. 🔒 — неподвижные соседи + отпуска), размещает подвижные перебором
    // всех точек вставки → { slitterByCut, orderIdxByCut, occupancy, trace }. Чистая: dueKey/workMin/
    // ёмкость-оценка/нерабочие дни/допустимость — из ctx. Релокацию по РЕАЛЬНЫМ дням (§12) ведёт
    // planCutOperations после реального splitMachineQueue; здесь ctx.relocate=false → пропускаем.
    function computeSlotPlacement(cutsList, ctx){
        ctx = ctx || {};
        var perPass = ctx.perPassByCut || {};
        var dueKeyBy = ctx.dueKeyByCut || {};
        var orderIdsBy = ctx.orderIdsByCut || {};   // #4194: cutId → множество заказов (штраф/бонус смежности)
        var slitterIds = (ctx.slitterIds && ctx.slitterIds.length) ? ctx.slitterIds.slice() : distinctSlitterIds(cutsList);
        var dayLockBy = ctx.dayLockByCut || {};   // #4221: cutId → день-смещение замка (перенос 🗓 «По весу»)
        var machineLockBy = ctx.machineLockByCut || {};   // #4225: cutId → станок замка (перенос «В пределах одного станка»)
        // #4497: задания, которые оператор двигает ПРЯМО СЕЙЧАС. Запрет «перед 🔒 ничего не ставим»
        // на них не действует (ТЗ §15: ручное действие оператора не ограничено) — ни когда двигают
        // само задание, ни когда двигают 🔒, рядом с которой выбирается место.
        var manualMoveBy = ctx.manualMoveByCut || {};
        var fixedSlots = [], movable = [];
        (cutsList || []).forEach(function(c){
            var id = String(c.id);
            var s = slotFromCut(c, dueKeyBy[id], orderIdsBy[id]);
            s.workMin = (Number(perPass[id]) || 0) * (Number(c.plannedRuns) || 0);
            if (s.slitterId == null && c.slitter) s.slitterId = String(c.slitter.id);
            if (manualMoveBy[id]) s.manualMove = true;   // #4497: перенос оператора правилом не связан
            // #4221: перенос 🗓 «По весу» — задание НЕ приколото позицией (как 🔒), а «замкнуто» на
            // ВЫБРАННЫЙ день и станок: кладём его как ПОДВИЖНОЕ (позиция в дне по весу scorePosition),
            // но с lockDay/lockSlitter (placeSlot держит день/станок). Замок ловит день сам (порядок
            // размещения → упаковка), поэтому c.fixed не нужен (иначе задание осело бы неподвижным).
            var dl = dayLockBy[id];
            if (dl != null && isFinite(Number(dl))){
                s.lockDay = Number(dl);
                s.lockSlitter = s.slitterId != null ? String(s.slitterId) : null;
                movable.push(s);
            } else if (c.fixed){ fixedSlots.push(s); }
            else {
                // #4225: «В пределах одного станка» — задание НЕ мигрирует на другой станок (только
                // позиция/день внутри своего станка по весу). lockSlitter без lockDay: день свободен.
                var ml = machineLockBy[id];
                if (ml != null && String(ml) !== '') s.lockSlitter = String(ml);
                movable.push(s);
            }
        });
        // #3717/#4085: подвижную фольгу размещаем ПОСЛЕ нефольги. Жадная вставка «по одному» не видит
        // будущих нефольг, если фольгу поставить раньше, и та могла осесть не в конце (штраф FOIL_NOTEND
        // применяется к УЖЕ стоящим соседям). Разместив всю нефольгу первой, каждая фольга штрафом
        // уводится в конец своего дня, при этом сама выбирает срок-оптимальный день (deadline-штраф жив).
        // Стабильная перестановка: исходный порядок §7 внутри «нефольга»/«фольга» сохраняется.
        // #4221: задание с замком ДНЯ («По весу») размещаем ПОСЛЕДНИМ в своём классе (нефольга/фольга):
        // оно должно ВСТАТЬ В ЛУЧШУЮ ЩЕЛЬ между уже разложенными соседями (иначе, встав первым, оно
        // осело бы в индекс 0 пустого дня — не по весу). Ключ — именно замок ДНЯ: замок только СТАНКА
        // (#4225, «В пределах одного станка») позицию по весу не ищет, его задания сохраняют свой
        // порядок (иначе last-перестановка коснулась бы всех заданий scope).
        function lockLast(arr){
            return arr.filter(function(s){ return s.lockDay == null; })
                      .concat(arr.filter(function(s){ return s.lockDay != null; }));
        }
        movable = lockLast(movable.filter(function(s){ return !s.isFoil; }))
            .concat(lockLast(movable.filter(function(s){ return s.isFoil; })));
        var occ = seedOccupancy(fixedSlots, ctx.vacationSlots || [], slitterIds);
        var trace = ctx.trace ? buildPlacementVariables(ctx, slitterIds, movable.length, fixedSlots.length) : null;
        var placeCtx = { settings: ctx.settings, times: ctx.times, capacityMin: ctx.capacityMin,
                         baseMidnightMs: ctx.baseMidnightMs, perPassByCut: perPass,
                         machineDayOffFor: ctx.machineDayOffFor, feasibleMachine: ctx.feasibleMachine,
                         distanceExceededFor: ctx.distanceExceededFor,
                         prevSetupBySlitter: ctx.prevSetupBySlitter,   // #4288: заправка станков — первая резка очереди наследует её как prev
                         realStartDayFn: ctx.realStartDayFn,   // #4547: день задания считает упаковщик, а не оценка
                         traceTasks: trace ? trace.tasks : null };
        placeAllSlots(occ, movable, placeCtx);
        if (ctx.relocate !== false) relocatePass(occ, ctx.dayByCut || null, slotExtend(placeCtx, { dueDayByCut: ctx.dueDayByCut }));
        var asg = assignmentFromOccupancy(occ);
        return { slitterByCut: asg.slitterByCut, orderIdxByCut: asg.orderIdxByCut, occupancy: occ, trace: trace };
    }
