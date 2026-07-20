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
        var s = firstSetupCost(slot, ctx.times);
        var mw = (ctx.times && ctx.times.MATERIAL_WINDING != null) ? Number(ctx.times.MATERIAL_WINDING) : DEFAULT_OP_TIMES.MATERIAL_WINDING;
        if (slot && slot.materialId != null && String(slot.materialId).trim() !== '') s += (Number(mw) || 0);
        return s;
    }

    // Оценка ДНЯ СТАРТА слота на позиции index (порт packMachine): пакуем префикс [0..index] по
    // дням (ёмкость ctx.capacityMin, настройка = переход/с-нуля, пропуск нерабочих ctx.machineDayOff).
    // Отпуск-слот закреплён на своём дне и «занимает» его. Возвращает day-offset старта слота index.
    function prefixDayOffset(machineSlots, index, ctx){
        ctx = ctx || {};
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
    function scorePosition(machineSlots, index, slot, ctx){
        ctx = ctx || {};
        if (!canInsertAt(machineSlots, index)) return null;
        var prev = machineSlots[index - 1] || null;
        var next = machineSlots[index] || null;
        var prevCut = (prev && prev.kind === 'cut') ? prev : null;
        var nextCut = (next && next.kind === 'cut') ? next : null;
        // #4288: ПЕРВАЯ резка очереди станка (index 0, реального prev нет) НАСЛЕДУЕТ ТЕКУЩУЮ
        // ЗАПРАВКУ станка (prev_cut_setup → ctx.prevSetupBySlitter) как ВИРТУАЛЬНЫЙ prev для
        // перехода prev→slot — ровно как упаковщик (splitMachineQueue carryPrevSetup, #3853) и
        // оценка идеала (qualityIdeal, #4029). Без этого слой размещения считал старт станка «с
        // нуля» и НЕ поощрял продолжить УЖЕ СТОЯЩУЮ на станке комбинацию: первая резка 22.07 не
        // подхватывала заправку 21.07 → у неё лишняя смена сырья/ножей, а совпадающая по сырью/
        // намотке/ножам резка не получала преимущества встать первой (issue #4288). Лидер/втулку
        // нейтрализуем (= как у slot): отчёт prev_cut_setup их не несёт, и changeoverParts
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
        return { weight: round3(cost.weight + orderPenalty), quality: cost.quality, setupWeight: round3(setupWeight),
                 dayOffset: dayOff, placementDayKey: placementDayKey, byFactor: byFactor };
    }

    // Лучший из двух кандидатов: меньше вес → меньше «качество» → меньше день → меньший станок →
    // ПОЗЖЕ по индексу (при равной цене дописываем В КОНЕЦ, сохраняя входной порядок §7, а не
    // разворачивая одинаковые конфиги).
    function betterCand(a, b){
        if (!b) return a; if (!a) return b;
        if (a.weight !== b.weight) return a.weight < b.weight ? a : b;
        if (a.quality !== b.quality) return a.quality < b.quality ? a : b;
        if (a.dayOffset !== b.dayOffset) return a.dayOffset < b.dayOffset ? a : b;
        var byM = String(a.machineId).localeCompare(String(b.machineId), 'ru');
        if (byM !== 0) return byM < 0 ? a : b;
        return a.index >= b.index ? a : b;
    }
    function tagSlot(slot, machineId){ var s = slotExtend(slot, {}); s.slitterId = String(machineId); return s; }

    // §8.4-исключение: нет приемлемого кандидата (setup > KNIVES_CHANGE+MATERIAL_CHANGE) → станок,
    // освобождающийся раньше всех за период (или без слотов). Кладём слот в КОНЕЦ такого станка.
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
        return { machineId: best.machineId, index: best.index, weight: 0, quality: 0, dayOffset: best.endDay, fallback: true };
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
        var tr = ctx.traceTasks ? { id: slot.id, dueKey: isFinite(Number(slot.dueKey)) ? Number(slot.dueKey) : null,
                                    isFoil: !!slot.isFoil, workMin: round3(slotWorkMin(slot, ctx)),
                                    variants: 0, skipped: 0, first: null, bestInDue: null } : null;
        function candOf(sid, idx, sc){
            return { machineId: sid, index: idx, weight: sc.weight, quality: sc.quality, setupWeight: sc.setupWeight,
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
                }
                if (lockDay != null){                                 // #4221: только точки замкового дня
                    bestAny = betterCand(cand, bestAny);
                    if (Number(sc.dayOffset) !== lockDay){ if (tr) tr.skipped++; continue; }
                }
                best = betterCand(cand, best);
            }
        });
        if (best == null && bestAny != null) best = bestAny;          // #4221: замковый день переполнен — не терять задание
        var accThreshold = planWeight(ctx.settings, 'KNIVES_CHANGE_COST_MN') + planWeight(ctx.settings, 'MATERIAL_CHANGE_COST_MN');
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
    // Триггеры релокации (ТЗ §12): слот идёт ПОСЛЕ фольги в своём дне; или день ≥ его срока.
    function shouldRelocate(arr, i, slot, dayByCut, ctx){
        if (slot.kind !== 'cut' || slot.fixed) return false;
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
        var maxRounds = ctx.maxRounds || 3, moves = [];
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
                var best = null;      // { tid, idx, real, penalty }
                Object.keys(byMachine).forEach(function(tid){
                    if (!feasible(tid, slot)) return;
                    // #4224: зафиксированное (🔒) задание рескьюим ТОЛЬКО в пределах СВОЕГО станка —
                    // станок выбрал пользователь; чиним лишь день (в срок), не перекидывая на другой станок.
                    if (slot.fixed && String(tid) !== String(sid)) return;
                    var tarr = byMachine[tid];
                    var baseIds = cutIdsOf(tid);
                    var baseReal = realDayFn(baseIds, tid) || {};   // дни приёмника БЕЗ задания (для проверки «не навредили»)
                    var fixedOnTid = {};   // #4224: чужие фиксы приёмника — их НЕЛЬЗЯ вытолкнуть на день позже
                    tarr.forEach(function(s){ if (s && s.kind === 'cut' && s.fixed) fixedOnTid[String(s.id)] = 1; });
                    for (var idx = 0; idx <= tarr.length; idx++){
                        if (!canInsertAt(tarr, idx)) continue;
                        var before = tarr.slice(0, idx).filter(function(s){ return s && s.kind === 'cut'; }).map(function(s){ return String(s.id); });
                        var after = tarr.slice(idx).filter(function(s){ return s && s.kind === 'cut'; }).map(function(s){ return String(s.id); });
                        var trialIds = before.concat([task.id], after);
                        var real = realDayFn(trialIds, tid) || {};
                        var myReal = real[task.id];
                        if (myReal == null || Number(myReal) >= task.curReal) continue;   // не улучшает реальный день — мимо
                        var harms = false;   // вставка не должна УГЛУБИТЬ ничью просрочку И не увести чужой фикс на день позже
                        for (var bi = 0; bi < baseIds.length && !harms; bi++){
                            var oid = baseIds[bi];
                            var wasOd = (Number(baseReal[oid]) - Number(dueDayByCut[oid]));   wasOd = (dueDayByCut[oid] == null || baseReal[oid] == null || wasOd < 0) ? 0 : wasOd;
                            var nowOd = (Number(real[oid]) - Number(dueDayByCut[oid]));        nowOd = (dueDayByCut[oid] == null || real[oid] == null || nowOd < 0) ? 0 : nowOd;
                            if (nowOd > wasOd) harms = true;
                            // #4224: не ломаем чужой замок дня — фикс не должен переехать на более поздний день
                            if (fixedOnTid[oid] && baseReal[oid] != null && real[oid] != null && Number(real[oid]) > Number(baseReal[oid])) harms = true;
                        }
                        if (harms) continue;
                        var sc = scorePosition(tarr, idx, slot, slotExtend(ctx, { slitterId: tid, isMove: true }));
                        var penalty = (sc ? sc.weight : 0) + moveWeight(ctx, sid, tid);
                        if (!best || Number(myReal) < best.real || (Number(myReal) === best.real && penalty < best.penalty)){
                            best = { tid: tid, idx: idx, real: Number(myReal), penalty: penalty };
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
                         note: 'capacityMin — лишь ЭВРИСТИКА оценки дня для порядка вставки; АРБИТР срока — РЕАЛЬНЫЕ дни splitMachineQueue (§12).' },
                 tasks: [], refine: null };
    }

    // #4095: разбор одного кандидата (станок/позиция/вес/оценка дня/факторы штрафа) для лога.
    function fmtSlotCand(c){
        if (!c) return '—';
        var f = c.byFactor || {}, parts = [];
        Object.keys(f).forEach(function(k){ if (f[k]) parts.push(k + ' +' + f[k]); });
        return 'станок ' + c.machineId + ' поз ' + c.index + ' → вес ' + c.weight
             + ' (день~' + (c.placementDayKey == null ? '?' : c.placementDayKey)
             + (parts.length ? ('; ' + parts.join(', ')) : '; без штрафов') + ')';
    }
    // #4095: структурный trace размещения → строки лога (ЧИСТАЯ, покрыта тестом). «день~» — ОЦЕНКА
    // порядка; «РЕАЛЬНЫЙ день» — из splitMachineQueue (арбитр срока, §12).
    function formatSlotPlacementTrace(trace){
        var L = [];
        if (!trace) return L;
        L.push('═══ РАЗМЕЩЕНИЕ #3985 (#4085): перебор ВСЕХ точек вставки по мин. штрафу ═══');
        L.push('ПЕРЕМЕННЫЕ (⚙ = из «Настройки» / ▫ = дефолт кода):');
        (trace.variables || []).forEach(function(v){
            L.push('  ' + (v.source === 'Настройка' ? '⚙' : '▫') + ' ' + v.key + ' = ' + v.value + '  [' + v.source + ']');
        });
        var m = trace.meta || {};
        L.push('  ёмкость-ОЦЕНКА дня (эвристика порядка): ' + m.capacityMin + ' мин; станков ' + (m.slitterIds || []).length
             + '; заданий: подвижных ' + m.movable + ', фикс ' + m.fixed + ', отпусков ' + m.vacations);
        L.push('  ⚠ ' + (m.note || ''));
        (trace.tasks || []).forEach(function(t){
            L.push('── задание ' + t.id + ' (срок ' + (t.dueKey == null ? '—' : t.dueKey) + ', '
                 + (t.isFoil ? 'фольга' : 'обычн.') + ', работа ' + t.workMin + ' мин): рассмотрено вариантов ' + t.variants
                 + (t.skipped ? (' (+ ' + t.skipped + ' недопустимых пропущено)') : '') + ' ──');
            if (t.first) L.push('   ПЕРВЫЙ рассмотренный: ' + fmtSlotCand(t.first));
            if (t.chosen) L.push('   ВЫБРАН: ' + fmtSlotCand(t.chosen) + (t.chosen.fallback ? ' [фолбэк §8.4: некуда пристроить]' : ''));
            if (t.overdue){
                if (t.bestInDue) L.push('   ⚠️ ОЦЕНКА за срок: день~' + t.chosen.placementDayKey + ' > срок ' + t.dueKey
                     + '; вариант В СРОК БЫЛ (вес ' + t.bestInDue.weight + ' vs выбран ' + t.chosen.weight + ') — переналадка дороже штрафа опоздания');
                else L.push('   ⚠️ ОЦЕНКА за срок: день~' + t.chosen.placementDayKey + ' > срок ' + t.dueKey
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
        var fixedSlots = [], movable = [];
        (cutsList || []).forEach(function(c){
            var id = String(c.id);
            var s = slotFromCut(c, dueKeyBy[id], orderIdsBy[id]);
            s.workMin = (Number(perPass[id]) || 0) * (Number(c.plannedRuns) || 0);
            if (s.slitterId == null && c.slitter) s.slitterId = String(c.slitter.id);
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
                         traceTasks: trace ? trace.tasks : null };
        placeAllSlots(occ, movable, placeCtx);
        if (ctx.relocate !== false) relocatePass(occ, ctx.dayByCut || null, slotExtend(placeCtx, { dueDayByCut: ctx.dueDayByCut }));
        var asg = assignmentFromOccupancy(occ);
        return { slitterByCut: asg.slitterByCut, orderIdxByCut: asg.orderIdxByCut, occupancy: occ, trace: trace };
    }
