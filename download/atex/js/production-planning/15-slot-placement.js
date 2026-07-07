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
    function slotFromCut(cut, dueKey){
        cut = cut || {};
        var id = String(cut.id);
        var sid = (cut.slitter && cut.slitter.id != null) ? String(cut.slitter.id)
                : (cut.slitterId != null ? String(cut.slitterId) : null);
        var dk = (dueKey != null && isFinite(Number(dueKey))) ? Number(dueKey)
               : (isFinite(Number(cut.dueKey)) ? Number(cut.dueKey) : undefined);
        var fp = (cut.firstPartId != null && String(cut.firstPartId) !== '') ? String(cut.firstPartId) : id;
        return { kind: 'cut', id: id, slitterId: sid,
                 materialId: cut.materialId, winding: cut.winding, batchId: cut.batchId,
                 knifeWidths: cut.knifeWidths, knifeCount: cut.knifeCount, rollerWidth: cut.rollerWidth,
                 isFoil: !!cut.isFoil, leader: cut.leader, sleeveId: cut.sleeveId,
                 plannedRuns: Number(cut.plannedRuns) || 0, dueKey: dk, fixed: !!cut.fixed, firstPartId: fp,
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
    function scorePosition(machineSlots, index, slot, ctx){
        ctx = ctx || {};
        if (!canInsertAt(machineSlots, index)) return null;
        var prev = machineSlots[index - 1] || null;
        var next = machineSlots[index] || null;
        var prevCut = (prev && prev.kind === 'cut') ? prev : null;
        var nextCut = (next && next.kind === 'cut') ? next : null;
        var withSlot = machineSlots.slice(0, index).concat([slot], machineSlots.slice(index));
        var dayOff = prefixDayOffset(withSlot, index, ctx);
        var placementDayKey = (ctx.baseMidnightMs != null) ? dayKeyFromOffset(ctx.baseMidnightMs, dayOff) : undefined;
        var ctxBefore = {   // prev → slot: тут «next» = сам slot → срок/фольга/простой о слоте
            settings: ctx.settings,
            freeAfterCarry: !!(prev && prev.kind === 'vacation') || !!ctx.freeAfterCarry,
            placementDayKey: placementDayKey,
            foilNotEnd: !!(slot.isFoil && nextCut && !nextCut.isFoil),
            isMove: !!ctx.isMove,
            distanceExceeded: !!(ctx.distanceExceededFor && ctx.distanceExceededFor(ctx.slitterId, dayOff, index))
        };
        var ctxAfter = { settings: ctx.settings };   // slot → next: только стоимость перехода
        var cost = insertionCost(prevCut, slot, nextCut, ctxBefore, ctxAfter);
        var bf = cost.before.byFactor, af = cost.after.byFactor;
        var setupWeight = (bf.knife || 0) + (bf.material || 0) + (af.knife || 0) + (af.material || 0);
        // #4095: суммарный разбор ВЕСА по факторам (штрафным минутам) для трассировки причины выбора —
        // ножи/сырьё/лидер/фольга/срок/простой обоих переходов; «качество» (…Quality) не вес — отбрасываем.
        var byFactor = {};
        [bf, af].forEach(function(m){ Object.keys(m || {}).forEach(function(k){
            if (/Quality$/.test(k)) return;
            byFactor[k] = round3((byFactor[k] || 0) + Number(m[k] || 0));
        }); });
        return { weight: cost.weight, quality: cost.quality, setupWeight: round3(setupWeight),
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

    // Вставить slot в САМУЮ ДЕШЁВУЮ точку по ВСЕМ станкам (перебор всех позиций). Мутирует occupancy.
    // #4095: если ctx.traceTasks задан — пишет туда разбор выбора (первый рассмотренный вариант,
    // выбранный, число вариантов, дешёвший вариант В СРОК) для трассировки «Почему допущена просрочка».
    function placeSlot(occupancy, slot, ctx){
        ctx = ctx || {};
        var byMachine = occupancy.byMachine;
        var feasible = ctx.feasibleMachine || function(){ return true; };
        var best = null;
        var tr = ctx.traceTasks ? { id: slot.id, dueKey: isFinite(Number(slot.dueKey)) ? Number(slot.dueKey) : null,
                                    isFoil: !!slot.isFoil, workMin: round3(slotWorkMin(slot, ctx)),
                                    variants: 0, skipped: 0, first: null, bestInDue: null } : null;
        function candOf(sid, idx, sc){
            return { machineId: sid, index: idx, weight: sc.weight, quality: sc.quality, setupWeight: sc.setupWeight,
                     dayOffset: sc.dayOffset, placementDayKey: sc.placementDayKey, byFactor: sc.byFactor };
        }
        Object.keys(byMachine).forEach(function(sid){
            if (!feasible(sid, slot)) return;
            var arr = byMachine[sid];
            for (var idx = 0; idx <= arr.length; idx++){
                var sc = scorePosition(arr, idx, slot, slotExtend(ctx, { slitterId: sid }));
                if (!sc){ if (tr) tr.skipped++; continue; }
                var cand = candOf(sid, idx, sc);
                if (tr){
                    tr.variants++;
                    if (!tr.first) tr.first = cand;   // ПЕРВЫЙ рассмотренный вариант (порядок перебора)
                    // Дешёвший вариант, приземляющийся В СРОК (день ≤ срока) — для объяснения просрочки.
                    if (tr.dueKey != null && sc.placementDayKey != null && Number(sc.placementDayKey) <= tr.dueKey
                        && (!tr.bestInDue || cand.weight < tr.bestInDue.weight)) tr.bestInDue = cand;
                }
                best = betterCand(cand, best);
            }
        });
        var accThreshold = planWeight(ctx.settings, 'KNIVES_CHANGE_COST_MN') + planWeight(ctx.settings, 'MATERIAL_CHANGE_COST_MN');
        if (!best || best.setupWeight > accThreshold){
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

    // Стоимость слота НА ТЕКУЩЕЙ позиции (для сравнения с альтернативой в релокации).
    function positionCost(arr, i, ctx, sid){
        var withoutSelf = arr.slice(0, i).concat(arr.slice(i + 1));
        var sc = scorePosition(withoutSelf, i, arr[i], slotExtend(ctx, { slitterId: sid }));
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
        while (changed && iter++ < maxIters){
            changed = false;
            var byMachine = occupancy.byMachine, mids = Object.keys(byMachine);
            for (var mi = 0; mi < mids.length && !changed; mi++){
                var sid = mids[mi], arr = byMachine[sid];
                for (var i = 0; i < arr.length; i++){
                    var s = arr[i];
                    if (!shouldRelocate(arr, i, s, dayByCut, ctx)) continue;
                    var cur = positionCost(arr, i, ctx, sid);
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
                            var total = sc.weight + moveWeight(ctx, sid, tid);
                            if (!alt || total < alt.total){ alt = { machineId: tid, index: idx, total: total }; }
                        }
                    });
                    if (alt && alt.total < cur - 1e-6){
                        arr.splice(i, 1);
                        var insIdx = (alt.machineId === sid && alt.index > i) ? alt.index - 1 : alt.index;
                        byMachine[alt.machineId].splice(insIdx, 0, tagSlot(s, alt.machineId));
                        moves.push({ id: s.id, from: sid, to: alt.machineId });
                        changed = true; break;
                    }
                }
            }
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
                    'CHANGE_SLITTER_COST_MN','CHANGE_DAY_COST_MN','SLOT_SPLIT_COST_MN','MAX_SLOTS_DISTANCE_HR','MAX_OUTAGE_PLANNABLE_HR'];
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
        var slitterIds = (ctx.slitterIds && ctx.slitterIds.length) ? ctx.slitterIds.slice() : distinctSlitterIds(cutsList);
        var fixedSlots = [], movable = [];
        (cutsList || []).forEach(function(c){
            var id = String(c.id);
            var s = slotFromCut(c, dueKeyBy[id]);
            s.workMin = (Number(perPass[id]) || 0) * (Number(c.plannedRuns) || 0);
            if (c.fixed){ if (s.slitterId == null && c.slitter) s.slitterId = String(c.slitter.id); fixedSlots.push(s); }
            else movable.push(s);
        });
        // #3717/#4085: подвижную фольгу размещаем ПОСЛЕ нефольги. Жадная вставка «по одному» не видит
        // будущих нефольг, если фольгу поставить раньше, и та могла осесть не в конце (штраф FOIL_NOTEND
        // применяется к УЖЕ стоящим соседям). Разместив всю нефольгу первой, каждая фольга штрафом
        // уводится в конец своего дня, при этом сама выбирает срок-оптимальный день (deadline-штраф жив).
        // Стабильная перестановка: исходный порядок §7 внутри «нефольга»/«фольга» сохраняется.
        movable = movable.filter(function(s){ return !s.isFoil; }).concat(movable.filter(function(s){ return s.isFoil; }));
        var occ = seedOccupancy(fixedSlots, ctx.vacationSlots || [], slitterIds);
        var trace = ctx.trace ? buildPlacementVariables(ctx, slitterIds, movable.length, fixedSlots.length) : null;
        var placeCtx = { settings: ctx.settings, times: ctx.times, capacityMin: ctx.capacityMin,
                         baseMidnightMs: ctx.baseMidnightMs, perPassByCut: perPass,
                         machineDayOffFor: ctx.machineDayOffFor, feasibleMachine: ctx.feasibleMachine,
                         distanceExceededFor: ctx.distanceExceededFor,
                         traceTasks: trace ? trace.tasks : null };
        placeAllSlots(occ, movable, placeCtx);
        if (ctx.relocate !== false) relocatePass(occ, ctx.dayByCut || null, slotExtend(placeCtx, { dueDayByCut: ctx.dueDayByCut }));
        var asg = assignmentFromOccupancy(occ);
        return { slitterByCut: asg.slitterByCut, orderIdxByCut: asg.orderIdxByCut, occupancy: occ, trace: trace };
    }
