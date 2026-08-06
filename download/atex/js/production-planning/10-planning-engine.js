    // Времена переналадок (мин) — по умолчанию (fallback). Реальные берутся из таблицы
    // «Время операции, мин» (13588) по кодам (loadOperationTimes → this.changeTimes):
    //   MATERIAL_WINDING — смена сырья/намотки/партии/неудобный остаток (одна операция);
    //   KNIFE_MOVE — стоимость ОДНОГО перемещения ножа (#3472, позиционная модель: цена
    //     ножей = KNIFE_MOVE × число переставленных ножей; идентичные полосы → 0);
    //   KNIFE — устар.: прежняя плоская «смена ножей» (оставлен для совместимости настроек);
    //   BETWEEN_CUTS — лидер между резками (база);
    //   CLEANUP_SHIFT — уборка в конце рабочего дня (#3155, ставится после последней резки дня).
    // #3472: приоритет — неизменность полос (0), затем меньше перемещений (2×ножи),
    // смена сырья (15); полная смена ~16 ножей ≈ 32 ≈ прежняя «смена ножей» 30.
    var DEFAULT_OP_TIMES = { MATERIAL_WINDING: 15, KNIFE: 30, KNIFE_MOVE: 2, BETWEEN_CUTS: 2, CLEANUP_SHIFT: 30 };
    var FATIGUE_MACHINE_WIDTH_MM = 1600;  // базовая ширина вала для оценки числа ножей (#3270/#3272)
    var FATIGUE_FACTOR = 2.0;             // alpha: штраф последней позиции = 1 + alpha
    var FATIGUE_START_COST_MIN = 45;      // условная стоимость старта маршрута, мин
    var PLANNING_STRATEGY_SETUP = 'setup';
    var PLANNING_STRATEGY_FATIGUE = 'fatigue';

    function normWinding(v){ var s = String(v == null ? '' : v).trim().toUpperCase(); return (s === 'IN' || s === 'OUT') ? s : ''; }

    // #3472: число НОЖЕЙ для перестановки prev→next. Нож, чья ширина есть в ОБОИХ
    // наборах, сохраняется (не двигается) — это приоритет неизменности полос. Поэтому
    // moves = max(|prev|, |next|) − |пересечение мультимножеств ширин|: добавить/убрать
    // нож = 1 перемещение, сменить ширину = 1, идентичный набор = 0. (Смена количества —
    // частный случай перемещений, отдельно не штрафуем.)
    function knifeMoves(prevWidths, nextWidths){
        function tally(arr){ var m = {}; (arr || []).forEach(function(x){ var k = String(x); m[k] = (m[k] || 0) + 1; }); return m; }
        var a = prevWidths || [], b = nextWidths || [];
        var ta = tally(a), tb = tally(b), inter = 0;
        Object.keys(ta).forEach(function(k){ if (tb[k]) inter += Math.min(ta[k], tb[k]); });
        return Math.max(a.length, b.length) - inter;
    }

    // Ширины ножей резки для knifeMoves. В реальных данных knifeWidths развёрнут по числу
    // ножей (длина == knifeCount, см. aggregateStrips). Если ширины не развёрнуты
    // (placeholder/пусто), а число ножей задано — дополняем сентинелом «нож без известной
    // ширины», чтобы перестановка считалась по числу ножей (фоллбэк совместимости).
    function effKnifeWidths(cut){
        var w = (cut && cut.knifeWidths) || [];
        var keys = w.map(function(x){ return String(Number(x)); });
        var n = Number(cut && cut.knifeCount) || 0;
        while (keys.length < n) keys.push('·');
        return keys;
    }

    // #3666: подпись НАБОРА ШИРИН ножей резки (уникальные ширины ↑, через запятую) — «та же
    // конфигурация ножей» в терминах оператора. Нужна для выбора станка: резки с одинаковым
    // набором ширин кладём на ОДИН станок (оператор работает тем же набором ножей, а не
    // настраивает их с нуля на другом станке), даже если число ножей/намотка отличаются.
    // Ширин нет (неизвестны) → '' (без группировки по ножам).
    function knifeWidthSig(cut){
        var set = {};
        ((cut && cut.knifeWidths) || []).forEach(function(x){ var n = Number(x); if (isFinite(n) && n > 0) set[String(n)] = 1; });
        return Object.keys(set).map(Number).sort(function(a, b){ return a - b; }).join(',');
    }

    // Компоненты переналадки prev→next (МИНУТЫ, БЕЗ лидера BETWEEN_CUTS) — те операции,
    // что реально применились, для расшифровки тайминга (#3240):
    //   смена сырья ИЛИ намотки ИЛИ партии → MATERIAL_WINDING (одна операция «смена
    //   сырья/намотки»; неудобный остаток — её же частный случай, отдельно не считаем);
    //   смена набора ножей ИЛИ сужение ролика → KNIFE. Бинарно (изменилось/нет), без
    //   нормировок. prev/next отсутствует → [] (первой резке переналадка не нужна).
    //   → [{ code, label, minutes }] (только применившиеся, с minutes > 0).

    // #3871: ускорение выравнивания загрузки станков (rebalanceSlitterLoad). Пост-проход
    // на каждую пробу переноса пересчитывал переналадку по ПОЛНЫМ наборам станка
    // (orderedChangeoverCost → greedySequence c перебором стартов, O(n³)). При ~170 резках это
    // ≈40 с на перенос — «Создать» висел минутами, окно прогресса не успевало отрисоваться.
    // На время выравнивания включаются два упрощения: changeoverCost кэшируется по паре id
    // (в пределах прохода times постоянен, объекты резок по id не меняются), а greedySequence
    // строит цепочку от ОДНОГО старта (O(n²)) вместо перебора всех. Оценка переналадки тут
    // нужна лишь как ориентир баланса — финальную очередь всё равно собирает planCutOperations.
    // Вне выравнивания (false/null) планировщик считает переналадку как прежде, побайтово.
    var balanceFastChangeover = false;   // greedySequence: цепочка от одного старта (без перебора)
    var balancePairCostMemo = null;      // changeoverCost: кэш по паре id { 'prevId>nextId': минуты }

    // #4151: тай-брейк группировки рулона. changeoverParts берёт 15 мин за смену сырья ИЛИ намотки
    // ИЛИ партии одинаково, поэтому чужой материал (смена РУЛОНА) свободно рвёт группу одного рулона
    // (жалоба #4151: «MWR233 влез между MR194 — менять рулон, а потом обратно»). При РАВНОЙ реальной
    // переналадке предпочитаем не перемонтировать рулон: sequencingCost добавляет КРОШЕЧНЫЙ штраф за
    // смену материала/партии (НЕ намотки — та же катушка), и resequenceWithinDays группирует резки
    // одного рулона. Штраф — ПОРЯДКА величины ниже любой реальной разницы (0.001 ≪ 15), поэтому лишь
    // разрешает ничьи; двойная приёмка resequenceWithinDays (newReal ≤ oldReal) не даёт разменять
    // перемонтаж на лишнюю смену ножей. Флаг включаем ТОЛЬКО вокруг resequenceWithinDays — greedy/
    // orderCuts не трогаем (их тай-брейк — полосы по убыванию #3785). Смена намотки на том же рулоне
    // (MR194 OUT↔IN) штрафа НЕ несёт.
    var ROLL_TIEBREAK_MN = 0.001;
    var sequencingRollTiebreak = false;
    function isRollRemount(prev, next){
        return !!prev && !!next && (
            String(prev.materialId) !== String(next.materialId) ||
            String(prev.batchId) !== String(next.batchId));
    }

    // #4481 (ТЗ §15): ЧТО СЧИТАЕТСЯ СМЕНОЙ СЫРЬЯ — одна функция на весь модуль. Подпись заправки
    // станка: ВИД СЫРЬЯ и НАПРАВЛЕНИЕ НАМОТКИ. «Партия сырья» в неё НЕ входит: поставить другой
    // рулон того же сырья времени не требует, в том числе переход «партия не указана» ↔ «указана»
    // (решение заказчика 29.07.2026). Через эту функцию идут ВСЕ потребители — реальные минуты
    // (changeoverParts), вес §8 (materialChangeNeeded → transitionCost) и подпись конфигурации
    // для перестановки внутри дня (cutConfigSig), — поэтому правило нельзя соблюсти в одном месте
    // и забыть в другом (симптом #4481: «после перепланирования появляются наладки при том же
    // сырье» — на стыке партий начислялось MATERIAL_WINDING).
    // Партия остаётся в данных (учёт сырья, #4452) и в тай-брейке «не перемонтировать рулон»
    // (isRollRemount, 0.001 мин) — но минут наладки не стои́т.
    function materialSetupSig(c){
        return String(c && c.materialId == null ? '' : c.materialId) + '|' + normWinding(c && c.winding);
    }
    function materialSetupChanged(prev, next){
        if (!prev || !next) return false;
        return materialSetupSig(prev) !== materialSetupSig(next);
    }

    // #4524 (ТЗ §15): КОРЕНЬ ЦЕПОЧКИ ДРОБЛЕНИЯ — «ID первой части» (у головы он указывает на себя,
    // у продолжений — на голову). Нормализуем так же, как группировка цепочек #3892.
    function splitChainRoot(cut){
        var fp = (cut && cut.firstPartId != null) ? String(cut.firstPartId).trim() : '';
        if (fp !== '') return fp;
        var id = (cut && cut.id != null) ? String(cut.id).trim() : '';
        return id;
    }
    // #4524 (ТЗ §15): ДВА ЗВЕНА ОДНОЙ ЦЕПОЧКИ ДРОБЛЕНИЯ. Хвост дня N и его продолжение в дне N+1 —
    // это ОДНО задание, разрезанное потолком смены: те же ножи, тот же рулон, та же намотка.
    // Переналадки между ними не бывает ПО ПОСТРОЕНИЮ — станок как настроили вечером, так он и
    // стои́т утром (правило «ножи те же с прошлого дня» ТЗ §15; длинный отпуск снимает заправку
    // ОТДЕЛЬНО — через `setupResetCutIds`, до этой проверки).
    function sameSplitChain(prev, next){
        if (!prev || !next) return false;
        var a = splitChainRoot(prev), b = splitChainRoot(next);
        if (a === '' || b === '') return false;
        if (a !== b) return false;
        return String(prev.id) !== String(next.id);
    }

    function changeoverParts(prev, next, times){
        var t = times || DEFAULT_OP_TIMES;
        var matWind = Number(t.MATERIAL_WINDING != null ? t.MATERIAL_WINDING : DEFAULT_OP_TIMES.MATERIAL_WINDING) || 0;
        var knifeTime = Number(t.KNIFE != null ? t.KNIFE : DEFAULT_OP_TIMES.KNIFE) || 0; // #3600: фикс. время любой смены ножей (по умолч. 30 мин), независимо от числа ножей
        var parts = [];
        if (!prev || !next) return parts;
        // #4524: между звеньями ОДНОЙ цепочки дробления переналадки нет. Мерка одна для всех, кто
        // спрашивает про наладку (упаковщик, колонки, детектор «↻ Пересчитать наладку», панель
        // качества, слой размещения), — иначе правило выводится заново в каждом и расходится:
        // хватало «пустых» ширин полос у одного из звеньев или более широкого ролика у хвоста,
        // чтобы продолжению начислилась ВТОРАЯ наладка тех же ножей (issue #4524: хвост 03.08
        // держит 30 мин, а продолжению 04.08 детектор просит ещё 30).
        if (sameSplitChain(prev, next)) return parts;
        var matWindChange = materialSetupChanged(prev, next);   // #4481: партия в подпись не входит
        // #3600: любая смена набора ножей ИЛИ сужение ролика → ФИКСИРОВАННО KNIFE (30 мин)
        // «на всё вместе», независимо от числа переставленных ножей (раньше #3472: стоимость =
        // KNIFE_MOVE × число перестановок). Смена сырья/намотки считается отдельно (ниже).
        // Бинарно: изменился набор ножей (knifeMoves>0) ИЛИ сузился ролик → одна переналадка ножей.
        // #3688: порядок операций — СНАЧАЛА настройка ножей, ПОТОМ смена сырья (так на станке).
        var moves = knifeMoves(effKnifeWidths(prev), effKnifeWidths(next));
        var knifeChanged = moves > 0 || (Number(prev.rollerWidth) || 0) > (Number(next.rollerWidth) || 0);
        if (knifeChanged && knifeTime > 0) parts.push({ code: 'KNIFE', label: 'смена ножей / сужение ролика', minutes: round3(knifeTime) });
        if (matWindChange && matWind > 0) parts.push({ code: 'MATERIAL_WINDING', label: 'смена сырья / намотки', minutes: round3(matWind) });
        return parts;
    }

    // #3688: синтетическая «предыдущая резка» для расчёта переналадки ПЕРВОЙ резки очереди
    // станка от его заправки на входе в окно (#4300/#4312: из заданий прошлых дней). Партию нейтрализуем
    // (= как у next) — сравниваем лишь материал/намотку/ножи, как задаёт отчёт. Нет данных
    // (null) → пустой станок: материал/намотка/ножи отличны → полный сетап (смена сырья +
    // настройка ножей с нуля). nextCut нужен только для нейтрализации партии.
    function carryOverPrevCut(prevSetup, nextCut) {
        if (!nextCut) return null;
        var batchId = (nextCut.batchId == null ? '' : nextCut.batchId);
        if (!prevSetup) {
            return { materialId: '\u0000none', winding: '\u0000none', batchId: batchId,
                     knifeWidths: [], knifeCount: 0, rollerWidth: 0 };
        }
        return { materialId: prevSetup.materialId, winding: prevSetup.winding, batchId: batchId,
                 knifeWidths: (prevSetup.knifeWidths || []).slice(),
                 knifeCount: (prevSetup.knifeWidths || []).length, rollerWidth: 0 };
    }

    // Стоимость перехода prev→next в МИНУТАХ переналадки (Σ компонентов changeoverParts;
    // две операции — обе вычитают время смены).
    function changeoverCost(prev, next, times){
        // #3871: во время выравнивания загрузки — кэш по паре id (тот же переход считается
        // тысячи раз по разным наборам станка). Объекты резок и times в проходе неизменны.
        if (balancePairCostMemo && prev && next && prev.id != null && next.id != null) {
            var ck = String(prev.id) + '>' + String(next.id);
            if (balancePairCostMemo[ck] !== undefined) return balancePairCostMemo[ck];
            return (balancePairCostMemo[ck] = round3(changeoverParts(prev, next, times).reduce(function(sum, p){ return sum + (Number(p.minutes) || 0); }, 0)));
        }
        return round3(changeoverParts(prev, next, times).reduce(function(sum, p){ return sum + (Number(p.minutes) || 0); }, 0));
    }

    // #3669 п.2: первая задача очереди станка требует настройки С НУЛЯ на ПУСТОМ станке (нет
    // заправки — станок пуст / нет заданий раньше окна). Прочие задачи считают переналадку с
    // предыдущей (changeoverParts, «та же конфигурация → 0»), а первая резка станка с ИЗВЕСТНОЙ
    // заправкой (#3688/#3853) — от неё (вызывающий передаёт carry как prev). Включается флагом
    // firstCutSetup (см. buildSchedule/splitMachineQueue/setupBreakdown).
    // #4296: на пустом станке первая резка СТАВИТ И НОЖИ, И СЫРЬЁ (заправка сырья на станок с нуля —
    // реальная наладка, а не «менять не с чего»): совпадает с моделью §13 (planQuality.actualFor
    // засчитывает первой резке ножи+сырьё) и с оценками дня/загрузки (scratchSetupMin, packMachine),
    // которые уже добавляли сырьё. Раньше был ТОЛЬКО KNIFE (#3669/#4156) → «смены сырья: 0» и факт<идеал
    // («план лучше идеала», отрицательный избыток), хотя сырьё надо заправлять (issue #4296). [] — если
    // у резки нет ни ножей, ни сырья (или соответствующее время 0).
    function firstSetupParts(next, times){
        var t = times || DEFAULT_OP_TIMES;
        var knifeTime = Number(t.KNIFE != null ? t.KNIFE : DEFAULT_OP_TIMES.KNIFE) || 0;
        var matWind = Number(t.MATERIAL_WINDING != null ? t.MATERIAL_WINDING : DEFAULT_OP_TIMES.MATERIAL_WINDING) || 0;
        if (!next) return [];
        var parts = [];
        var hasKnives = (Number(next.knifeCount) || 0) > 0 || ((next.knifeWidths || []).length > 0);
        if (hasKnives && knifeTime > 0) parts.push({ code: 'KNIFE', label: 'настройка ножей', minutes: round3(knifeTime) });
        var hasMaterial = next.materialId != null && String(next.materialId).trim() !== '';
        if (hasMaterial && matWind > 0) parts.push({ code: 'MATERIAL_WINDING', label: 'заправка сырья', minutes: round3(matWind) });
        return parts;
    }

    function firstSetupCost(next, times){
        return round3(firstSetupParts(next, times).reduce(function(sum, p){ return sum + (Number(p.minutes) || 0); }, 0));
    }

    // #3698: расщепить переналадку prev→next на ДВЕ активности (минуты) для хранения в
    // «Задание в производство»: «Наладка ножей, мин» (KNIFE) и «Сырье/намотка, мин»
    // (MATERIAL_WINDING). Та же логика, что setupBreakdown, но числом по каждой активности.
    // → { knifeMin, materialWindingMin }. Чистая (тест).
    function setupActivityMinutes(prev, next, times, opts){
        var knife = 0, matWind = 0;
        setupBreakdown(prev, next, times, opts).forEach(function(p){
            if (p.code === 'KNIFE') knife += Number(p.minutes) || 0;
            else if (p.code === 'MATERIAL_WINDING') matWind += Number(p.minutes) || 0;
        });
        return { knifeMin: round3(knife), materialWindingMin: round3(matWind) };
    }

    // #3760: какие компоненты настройки положить в хвост смены, когда настройка целиком
    // не влезает. Берём ПОДМНОЖЕСТВО компонентов с суммой ≥ остатка дня (дотягивает до конца
    // смены) и МИНИМАЛЬНОЙ суммой (минимальный нахлёст). Остальное — на следующий день.
    // Живёт ради buildSchedule (показ расписания): там потолка нахлёста настройки нет, окно
    // кончается концом смены. Упаковщик и колонки задания считают хвост по chooseTailSetupSubset.
    //   parts — [{minutes}], avail — остаток дня (мин), total — сумма всех компонентов.
    // Примеры (ножи 30, сырьё 15): avail 8 → сырьё 15 (нахлёст 7); avail 20 → ножи 30
    // (сырьё 15 < 20 не дотягивает, оставило бы простой); avail 35 → ножи+сырьё 45.
    // Полный набор (сумма total ≥ avail в этой ветке) всегда годится; компонентов мало —
    // полный перебор подмножеств. → минуты настройки в хвост (round3).
    function minOverlapTailSetupMinutes(parts, avail, total) {
        var mins = (parts || []).map(function(p){ return Number(p && p.minutes) || 0; })
            .filter(function(m){ return m > 0; });
        var tot = Number(total) || mins.reduce(function(s, m){ return s + m; }, 0);
        if (!mins.length) return round3(tot);
        var a = Number(avail) || 0, n = mins.length, best = tot;
        if (n <= 16) {
            for (var mask = 1; mask < (1 << n); mask++) {
                var s = 0;
                for (var b = 0; b < n; b++) if (mask & (1 << b)) s += mins[b];
                if (s >= a && s < best) best = s;
            }
        } else {
            var sorted = mins.slice().sort(function(x, y){ return y - x; }), acc = 0;
            for (var i = 0; i < sorted.length && acc < a; i++) acc += sorted[i];
            best = acc || tot;
        }
        return round3(best);
    }

    // #4144: ЕДИНОЕ правило хвоста дня (setup-only сегмент, #3635 п.5) — «оператор делает МАКСИМУМ
    // наладки, который успевает в пределах допустимого нахлёста НАСТРОЙКИ» (#3955). Из подмножеств
    // компонентов наладки (ножи 30 / смена сырья 15) берём НАИБОЛЬШЕЕ с суммой ≤ ceilingRoom
    // (= остаток окна резки + MAX_OVERWORK_TUNE). Ничего не влезает — null: в дне N НИЧЕГО, вся резка
    // одной карточкой на следующий день. Остаток наладки уходит на продолжение (pendingSetup).
    // Примеры (ножи 30, сырьё 15): потолок 30 → ножи 30 (#3858: «сделать что-то одно — настройку
    // ножей»); потолок 50 → ножи+сырьё 45; потолок 29 → сырьё 15 (ножи не влезают, #4144 Станок 4);
    // потолок 10 → ничего (#3847).
    // Одно правило на всех: обе ветки splitMachineQueue (упаковка) и splitTailSetupAtCeiling (колонки).
    // Раньше ветки расходились: базовая целилась в потолок через minOverlapTailSetupMinutes и при
    // наладке из двух компонентов почти всегда отказывала; gapFill целилась в конец окна резки и, увидев
    // выход за потолок, не клала НИЧЕГО — без отката на влезающее подмножество (issue #4144: остаток
    // окна 19 мин, ножи 30 за потолком 29 → хвоста нет, хотя смена сырья 15 кончалась ДО конца окна).
    //   parts — [{ code, minutes }]; ceilingRoom — минуты до потолка нахлёста настройки.
    // → { minutes, keep: [parts] } либо null. Компонентов много (>16) — жадно по убыванию.
    function chooseTailSetupSubset(parts, ceilingRoom) {
        var list = (parts || []).filter(function(p){ return (Number(p && p.minutes) || 0) > 0; });
        if (!list.length) return null;
        var ceil = Number(ceilingRoom);
        if (!isFinite(ceil)) ceil = Infinity;
        var n = list.length, EPS = 1e-9;
        if (n > 16) {
            var sorted = list.slice().sort(function(a, b){ return b.minutes - a.minutes; });
            var acc = 0, keepG = [];
            for (var g = 0; g < sorted.length; g++) {
                if (acc + sorted[g].minutes > ceil + EPS) continue;
                acc += sorted[g].minutes; keepG.push(sorted[g]);
            }
            return keepG.length ? { minutes: round3(acc), keep: keepG } : null;
        }
        var largest = null;
        for (var mask = 1; mask < (1 << n); mask++) {
            var s = 0;
            for (var b = 0; b < n; b++) if (mask & (1 << b)) s += Number(list[b].minutes) || 0;
            s = round3(s);
            if (s > ceil + EPS) continue;                                     // за потолок нахлёста — нельзя
            if (!largest || s > largest.s) largest = { s: s, mask: mask };
        }
        if (!largest) return null;
        var keep = [];
        for (var b2 = 0; b2 < n; b2++) if (largest.mask & (1 << b2)) keep.push(list[b2]);
        return { minutes: largest.s, keep: keep };
    }

    // #4144: разложить выбранный хвост по ХРАНИМЫМ колонкам «Наладка ножей» / «Сырье-намотка».
    // Компоненты без кода (слитый остаток настройки продолжения, pendingSetup) разложить нельзя → null.
    function tailSetupColumns(chosen) {
        if (!chosen) return { knifeMin: 0, materialWindingMin: 0 };
        var knife = 0, mat = 0;
        for (var i = 0; i < chosen.keep.length; i++) {
            var p = chosen.keep[i];
            if (p.code === 'KNIFE') knife += Number(p.minutes) || 0;
            else if (p.code === 'MATERIAL_WINDING') mat += Number(p.minutes) || 0;
            else return null;
        }
        return { knifeMin: round3(knife), materialWindingMin: round3(mat) };
    }

    // #4529: ОСТАТОК наладки, который хвост дня N НЕ успел и уносит на продолжение (день N+1) —
    // те же ИМЕНОВАННЫЕ компоненты, а не одно число. Без кодов продолжение раскладывало остаток
    // целиком в «Наладку ножей»: хвост держит ножи 30, продолжение получало «ножи 15» вместо
    // «смена сырья 15», по цепочке выходило 45 минут ножей при одной смене 30 — и наблюдатель
    // CHAIN_SETUP_ONCE (§15) честно сообщал о двойной наладке на верно упакованном плане.
    //   parts — все компоненты наладки; chosen — результат chooseTailSetupSubset (что осталось
    //   в дне N). Сравниваем по ССЫЛКЕ на элемент: минуты у компонентов совпадают сплошь и рядом.
    // → [{ code, minutes }] (пусто, если хвост забрал всё).
    function remainingSetupParts(parts, chosen) {
        var keep = (chosen && chosen.keep) || [];
        return (parts || []).filter(function(p){
            return (Number(p && p.minutes) || 0) > 0 && keep.indexOf(p) < 0;
        });
    }

    // #4111: наладка setup-only ХВОСТА дня, поделённая между днём N и продолжением (день N+1) —
    // ХРАНИМЫЕ колонки задания, что оператор увидит в карточке дня N (computeCutSetupUpdates).
    // Правило то же, что у упаковщика (chooseTailSetupSubset — наибольшее подмножество под потолком
    // нахлёста настройки), только с ДВУМЯ именованными компонентами — чтобы поделить их по колонкам
    // «Наладка ножей» / «Сырье-намотка».
    //   tailStartMin — минута старта хвоста (planStart, от полуночи дня); knifeMin/materialMin —
    //   компоненты наладки; cutEndMin/overTuneMin — окно (мин от полуночи / нахлёст настройки).
    // → { keepKnife, keepMaterial } — что ОСТАЁТСЯ в дне N (остальное уносится на продолжение).
    // Нет окна (cutEndMin/tailStartMin не число) → держим всё в дне N (прежнее поведение, без окна).
    // ВНИМАНИЕ (#4144): tailStartMin из ХРАНИМОГО planStart прошёл снап к целым минутам (#4061) и
    // позже упаковочного на накопленный ceil — room выходит меньше настоящего, и решение может
    // «схлопнуться» в ноль. Поэтому писатель зовёт эту функцию только как ФОЛБЭК, когда решения
    // упаковщика под рукой нет (см. plannedTailSetup в 20-controller.js).
    function splitTailSetupAtCeiling(tailStartMin, knifeMin, materialMin, cutEndMin, overTuneMin) {
        var k = Math.max(0, Math.round(Number(knifeMin) || 0));
        var m = Math.max(0, Math.round(Number(materialMin) || 0));
        if (k + m <= 0) return { keepKnife: 0, keepMaterial: 0 };
        var start = Number(tailStartMin), cutEnd = Number(cutEndMin);
        if (!isFinite(start) || !isFinite(cutEnd)) return { keepKnife: k, keepMaterial: m };
        // #4563: потолок — только через общую функцию (нахлёст НАСТРОЙКИ), своей формулы здесь нет.
        var ceilingRoom = dayCeilingMin({ cutEndMin: cutEnd, maxOverworkTuneMin: Number(overTuneMin) || 0 }, 'tune') - start;
        var cols = tailSetupColumns(chooseTailSetupSubset(
            [{ code: 'KNIFE', minutes: k }, { code: 'MATERIAL_WINDING', minutes: m }], ceilingRoom));
        return { keepKnife: cols.knifeMin, keepMaterial: cols.materialWindingMin };
    }

    // #3698: активности переналадки на каждую резку упорядоченной очереди ОДНОГО станка
    // (порядок исполнения — по planStart, как в Ганте orderCutsInGroup, #3923). Первая резка —
    // от текущей заправки станка (carryPrevCut, строится вызывающим через
    // carryOverPrevCut); нет заправки (carryPrevCut=null) → настройка ножей с нуля
    // (firstCutSetup). Зеркалит ветку setup в buildSchedule. → { cutId: { knifeMin, materialWindingMin } }.
    // #4314: resetIds (из setupResetCutIds) — задания, ПЕРЕД которыми станок стоял в длинном отпуске:
    // ножи сняты, сырьё убрано, поэтому наладка считается С НУЛЯ (firstCutSetup), а не переналадкой от
    // предыдущей резки. Пустой/не задан → прежнее поведение.
    // Чистая (тест).
    function setupActivityColumns(orderedCuts, times, carryPrevCut, resetIds){
        var out = {};
        var reset = resetIds || {};
        (orderedCuts || []).forEach(function(c, i){
            var afterVacation = !!reset[String(c && c.id)];
            var prev = afterVacation ? null : (i > 0 ? orderedCuts[i - 1] : (carryPrevCut || null));
            var opts = (afterVacation || (i === 0 && !carryPrevCut)) ? { firstCutSetup: true } : null;
            out[String(c.id)] = setupActivityMinutes(prev, c, times, opts);
        });
        return out;
    }

    // #3401: число резок в цуге (в терминологии заказчика общая «резка» состоит из
    // множества резок — бывших «проходов», см. «Кол-во резок план»). Лидер BETWEEN_CUTS
    // («лидер между резками») заправляется ПЕРЕД КАЖДОЙ резкой, поэтому его множим на это
    // число. Нет «Кол-во план»/0 → 1 (как раньше — один лидер на резку без проходов).
    function cutLeaderRuns(cut){
        var r = stripNum(cut && cut.plannedRuns);
        return r > 0 ? Math.round(r) : 1;
    }

    // Полный setup перед резкой (#3240): лидер между резками (BETWEEN_CUTS, база × число
    // резок цуга, #3401) + переналадка с предыдущей (changeoverParts). prev=null (первая
    // резка очереди/дня) → только лидер. Σ minutes == setupMin расписания buildSchedule.
    // → [{ code, label, minutes }].
    function setupBreakdown(prev, next, times, opts){
        var parts = [];
        // #3688: лидер вынесен в КОНЕЦ резки (см. cutTimingTimelineLines) — в стартовый сетап
        // он больше не входит. Здесь только переналадка ПЕРЕД резкой (ножи + смена сырья).
        // #3669 п.2: первая задача (нет предыдущей) с флагом firstCutSetup → настройка ножей с
        // нуля; иначе — переналадка с предыдущей резкой (changeoverParts, [] для первой). Для
        // первой резки с известной заправкой станка (#3688) вызывающий передаёт carry-over как
        // prev — тогда сюда приходит непустой prev и считается обычная переналадка.
        if (!prev && opts && opts.firstCutSetup) {
            Array.prototype.push.apply(parts, firstSetupParts(next, times));
        } else {
            Array.prototype.push.apply(parts, changeoverParts(prev, next, times));
        }
        return parts;
    }

    function planningStrategy(options){
        var raw = options;
        if (options && typeof options === 'object') {
            raw = options.strategy || options.planningStrategy || options.queueStrategy || options.mode || '';
        }
        var s = String(raw == null ? '' : raw).trim().toLowerCase();
        return s === PLANNING_STRATEGY_FATIGUE ? PLANNING_STRATEGY_FATIGUE : PLANNING_STRATEGY_SETUP;
    }

    function planningStrategyLabel(strategy){
        return planningStrategy(strategy) === PLANNING_STRATEGY_FATIGUE ? 'сложные резки раньше' : 'минимум переналадок';
    }

    function fatigueOptionNumber(options, keys, fallback){
        var opts = options || {};
        for (var i = 0; i < keys.length; i++) {
            var n = Number(opts[keys[i]]);
            if (isFinite(n) && n > 0) return n;
        }
        return fallback;
    }

    function fatigueChangeTimes(options){
        if (!options) return null;
        if (options.times) return options.times;
        if (options.changeTimes) return options.changeTimes;
        if (options.opTimes) return options.opTimes;
        if (options.MATERIAL_WINDING != null || options.KNIFE != null || options.BETWEEN_CUTS != null) return options;
        return null;
    }

    function planningChangeTimes(options){
        return fatigueChangeTimes(options) || options || null;
    }

    // #4059: settings — веса/лимиты из «Настройки» (this.daySettings). Их числовые ключи
    // (DEADLINE_COST_MN, EXACT_DEADLINE_COST_MN, KNIVES_*, MATERIAL_* и т.д.) кладём ПЛОСКО в opts,
    // чтобы planWeight(opts, …) в жадном упаковщике (splitMachineQueue/orderCuts) видел кастомные
    // значения из таблицы, а не только PLAN_WEIGHT_DEFAULTS. Копируем ПЕРВЫМИ — стратегия/переданные
    // опции их перекрывают при совпадении (orderCuts прокидывает уже собранный planOptions обратно
    // одним аргументом, ключи весов при этом сохраняются).
    function makePlanningOptions(strategyOrOptions, times, settings){
        var opts = {};
        if (settings && typeof settings === 'object') {
            for (var sk in settings) {
                if (Object.prototype.hasOwnProperty.call(settings, sk)) opts[sk] = settings[sk];
            }
        }
        if (strategyOrOptions && typeof strategyOrOptions === 'object') {
            for (var k in strategyOrOptions) {
                if (Object.prototype.hasOwnProperty.call(strategyOrOptions, k)) opts[k] = strategyOrOptions[k];
            }
        } else if (strategyOrOptions != null && String(strategyOrOptions).trim() !== '') {
            opts.strategy = strategyOrOptions;
        }
        if (times) opts.times = times;
        opts.strategy = planningStrategy(opts);
        return opts;
    }

    function fatigueJobWidth(cut){
        var candidates = cut ? [cut.width, cut.rollerWidth, cut.widthMm, cut.rollerWidthMm] : [];
        for (var i = 0; i < candidates.length; i++) {
            var n = stripNum(candidates[i]);
            if (isFinite(n) && n > 0) return n;
        }
        return 0;
    }

    // Оценка сложности резки по ножам. Если strip-агрегация ещё не влита в очередь,
    // используем приближение из задачи: N_j ~= Wmax / W_j.
    function estimatedKnifeCount(cut, machineWidth){
        var explicit = Number(cut && cut.knifeCount);
        if (isFinite(explicit) && explicit > 0) return explicit;
        var width = fatigueJobWidth(cut);
        if (!(width > 0)) return 999;
        var maxWidth = Number(machineWidth);
        if (!isFinite(maxWidth) || maxWidth <= 0) maxWidth = FATIGUE_MACHINE_WIDTH_MM;
        return Math.max(1, Math.floor(maxWidth / width));
    }

    function fatiguePositionWeight(positionIndex, totalPositions, fatigueFactor){
        var total = Number(totalPositions) || 0;
        if (total <= 1) return 1;
        var alpha = Number(fatigueFactor);
        if (!isFinite(alpha)) alpha = FATIGUE_FACTOR;
        var idx = Number(positionIndex) || 0;
        if (idx < 0) idx = 0;
        if (idx > total - 1) idx = total - 1;
        return round3(1 + alpha * (idx / (total - 1)));
    }

    function fatigueRouteScore(route, options){
        var list = route || [];
        if (!list.length) return 0;
        var opts = options || {};
        var machineWidth = fatigueOptionNumber(opts, ['machineWidth', 'machineWidthMm', 'Wmax'], FATIGUE_MACHINE_WIDTH_MM);
        var alpha = fatigueOptionNumber(opts, ['fatigueFactor', 'alpha'], FATIGUE_FACTOR);
        var startCost = fatigueOptionNumber(opts, ['startCost', 'startCostMin'], FATIGUE_START_COST_MIN);
        var times = fatigueChangeTimes(opts);
        var total = 0;
        for (var i = 0; i < list.length; i++) {
            var transitionCost = i === 0 ? startCost : changeoverCost(list[i - 1], list[i], times);
            var knifeFactor = 1 + estimatedKnifeCount(list[i], machineWidth) / 100;
            total += transitionCost * fatiguePositionWeight(i, list.length, alpha) * knifeFactor;
        }
        return round3(total);
    }

    // ───────────────────── Хелперы генерации резок ─────────────────────

    // #4536: ПОЛОС ЗА ПРОХОД по «Партии ГП» — из того же отчёта cut_strips (gp_id — id партии).
    // Столько штук даёт ОДИН проход задания позиции, которую эта партия обеспечивает; на этом
    // стои́т мерка правила SUPPLY_CONSERVED (выпуск = полосы × проходы). Отдельно от
    // `aggregateStrips` (там сумма ножей по резке) — контракт того результата не трогаем.
    // → { gpId: полос }. Вход не мутируется; строки без gp_id пропускаются.
    function stripsByFinishedBatch(rows) {
        var out = {};
        (rows || []).forEach(function(row) {
            var gpId = String(row && row.gp_id == null ? '' : row.gp_id);
            if (gpId === '') return;
            out[gpId] = round3((out[gpId] || 0) + (Number(row.strip_qty) || 0));
        });
        return out;
    }

    // Строки отчёта cut_strips (JSON_KV) → { cutId: {knifeCount, knifeWidths:[...]} }.
    // cut_id — abn «Производственной резки»; strip_width — «Партия ГП» «Ширина, мм»;
    // strip_qty — число ПОЛОС за проход. #3431: источник strip_qty в серверном отчёте
    // cut_strips (queryId 8656) — «Партия ГП» «Кол-во полос» (а НЕ «Кол-во рулонов»,
    // которое теперь = полосы × проходов). Группировка по cut_id:
    //   knifeCount += Number(strip_qty);
    //   knifeWidths — Number(strip_width), развёрнутый по qty (полоса 110×2 → [110,110]),
    //   нужен для widthSetDistance в changeoverCost. Заменяет удалённую в F2 колонку
    //   cut_knives отчёта cut_planning (knifeCount теперь считается клиентом).
    // Вход не мутируется.
    function aggregateStrips(rows) {
        var out = {};
        (rows || []).forEach(function(row) {
            var cutId = String(row.cut_id == null ? '' : row.cut_id);
            if (cutId === '') return;
            if (!out[cutId]) out[cutId] = { knifeCount: 0, knifeWidths: [] };
            var qty = Number(row.strip_qty) || 0;
            var width = Number(row.strip_width) || 0;
            out[cutId].knifeCount += qty;
            for (var n = 0; n < qty; n++) out[cutId].knifeWidths.push(width);
        });
        return out;
    }

    // ── Чистая сводка по полосам редактора (зеркало cut-calc calc.*) ──
    // Модули самостоятельны: дублируем формулы из cut-calc, чтобы редактор полос
    // не зависел от загрузки cut-calc.js. Вход — массив полос [{width, qty}];
    // значения терпимо приводятся к числу (запятая → точка, мусор → 0), вход не мутируется.

    // Терпимый разбор числа: запятая как десятичный разделитель, мусор/пусто → 0.
    function stripNum(value) {
        if (typeof value === 'number') return isFinite(value) ? value : 0;
        var text = String(value == null ? '' : value).replace(/\s+/g, '').replace(',', '.');
        var n = parseFloat(text);
        return isFinite(n) ? n : 0;
    }

    // Округление до 3 знаков — убрать артефакты float-арифметики.
    function round3(n) { return Math.round(n * 1000) / 1000; }

    // sortStripsByWidthDesc: единый порядок полос резки — по УБЫВАНИЮ ширины (широкие
    // раньше узких). Заказ/Склад/втулка идут одним рядом вперемешку по ширине (минимум
    // переналадки ножей, единый подход к формированию). Миррор sortStripsByWidthDesc в
    // cut-layout.js — там сортируется генерируемый раскрой, здесь довешенные втулочные
    // полосы (appendCoreStrip) и полосы редактора (загрузка/ручной добор). Тай-брейк при
    // равной ширине — назначение (Заказ→Склад→Отходы); полосы без ширины (пустые строки
    // редактора) — в конец. Мутирует и возвращает массив.
    function sortStripsByWidthDesc(strips) {
        if (!strips || !strips.sort) return strips;
        function rank(p) { return p === 'Заказ' ? 0 : p === 'Склад' ? 1 : p === 'Отходы' ? 2 : 3; }
        return strips.sort(function(a, b) {
            var wa = stripNum(a && a.width), wb = stripNum(b && b.width);
            var pa = wa > 0 ? wa : -Infinity, pb = wb > 0 ? wb : -Infinity;
            if (pa !== pb) return pb - pa;               // ширина по убыванию
            return rank(a && a.purpose) - rank(b && b.purpose);
        });
    }

    function truthyFlag(value) {
        if (value === true) return true;
        if (value === false || value == null) return false;
        if (typeof value === 'number') return isFinite(value) && value !== 0;
        var s = String(value).trim().toLowerCase();
        if (s === '') return false;
        if (s === '0' || s === 'false' || s === 'нет' || s === 'no' || s === 'off') return false;
        return true;
    }

    function batchIsActive(batch) {
        if (!batch || batch.active === undefined || batch.active === null || String(batch.active).trim() === '') return true;
        if (batch.active === true) return true;
        if (batch.active === false) return false;
        var s = String(batch.active).trim().toLowerCase();
        return !(s === '0' || s === 'false' || s === 'нет' || s === 'no' || s === 'off' || s === 'неактивно');
    }

    function activeReqId(meta) {
        return reqIdByName(meta, 'В работе') ||   // #3242: «Активно» переименовано в «В работе»
            reqIdByName(meta, 'Активно') ||
            reqIdByName(meta, 'Активная') ||
            reqIdByName(meta, 'Действует');
    }

    function stockPurpose(value) {
        var s = String(value == null ? '' : value).trim().toLowerCase();
        return s === 'склад' || s === 'на склад';
    }

    function isStockStrip(strip) {
        if (!strip) return false;
        return truthyFlag(strip.toStock) || stockPurpose(strip.purpose);
    }

    // ───────── «Максимальный запас» (#3391, table/67113) ─────────
    // Таблица перечисляет номенклатуры «Партии ГП», которые целесообразно нарезать
    // впрок. Излишек резки (полоса «Склад»), номенклатуры которого нет в списке,
    // на склад не идёт — это отход. Чистое ядро ниже классифицирует номенклатуру.

    // Канонический ключ номенклатуры запаса: вид сырья + ширина + длина + намотка.
    // Диаметр втулки и Лидер в ключ не входят — в контексте добора планирования они,
    // как правило, неизвестны; на них только доуточняем при наличии у обеих сторон
    // (см. maxStockMatches). Числа округляются (round3), намотка нормализуется.
    function maxStockKey(nom) {
        nom = nom || {};
        var mat = String(nom.material == null ? '' : nom.material).trim();
        var w = stripNum(nom.width);
        var len = windLengthValue(nom.length);
        return mat + '|' + (w > 0 ? round3(w) : '') + '|' +
            (len > 0 ? round3(len) : '') + '|' + normWinding(nom.winding);
    }

    // Разбор строк таблицы «Максимальный запас» (JSON_OBJ) → номенклатуры запаса.
    // Главное значение (r[0]) — максимально допустимый запас (число); реквизиты —
    // параметры «Партии ГП». Ссылочные поля (Вид сырья/Втулка/Лидер) разбираем parseRef.
    function parseMaxStockRows(rows, meta) {
        if (!meta) return [];
        var iMat = columnIndex(meta, MAX_STOCK_REQ.material);
        var iWidth = columnIndex(meta, MAX_STOCK_REQ.width);
        var iLength = columnIndex(meta, MAX_STOCK_REQ.length);
        var iWind = columnIndex(meta, MAX_STOCK_REQ.winding);
        var iSleeve = columnIndex(meta, MAX_STOCK_REQ.sleeve);
        var iLeader = columnIndex(meta, MAX_STOCK_REQ.leader);
        return (rows || []).map(function(rec) {
            var r = (rec && rec.r) || [];
            function refId(idx) { return (idx >= 0 ? (parseRef(r[idx]).id || '') : ''); }
            return {
                material: refId(iMat),
                width: iWidth >= 0 ? stripNum(r[iWidth]) : 0,
                length: iLength >= 0 ? windLengthValue(r[iLength]) : 0,
                winding: iWind >= 0 ? normWinding(r[iWind]) : '',
                sleeve: refId(iSleeve),
                leader: refId(iLeader),
                limit: stripNum(r[0])
            };
        }).filter(function(n) { return n.material !== '' || n.width > 0; });
    }

    // Индекс таблицы: { list: [номенклатуры], byKey: {ключ→макс. лимит} }.
    // empty=true → таблица не настроена/пуста, фича выключена (поведение не меняем).
    function buildMaxStockIndex(rows, meta) {
        var list = parseMaxStockRows(rows, meta);
        var byKey = {};
        list.forEach(function(n) {
            var k = maxStockKey(n);
            if (byKey[k] == null || n.limit > byKey[k]) byKey[k] = n.limit;
        });
        return { list: list, byKey: byKey, empty: list.length === 0 };
    }

    // Настроена ли таблица «Максимальный запас» (есть хотя бы одна номенклатура).
    function maxStockConfigured(index) {
        return !!(index && index.list && index.list.length);
    }

    // Строки таблицы, совпадающие с номенклатурой nom. Совпадение — по ключу
    // (сырьё/ширина/длина/намотка); втулка/лидер доуточняют, только если заданы
    // у обеих сторон (иначе игнорируются — мы их в планировании обычно не знаем).
    function maxStockMatches(index, nom) {
        if (!index || !index.list) return [];
        var key = maxStockKey(nom);
        var sleeve = String((nom && nom.sleeve) == null ? '' : nom.sleeve).trim();
        var leader = String((nom && nom.leader) == null ? '' : nom.leader).trim();
        return index.list.filter(function(n) {
            if (maxStockKey(n) !== key) return false;
            if (sleeve && n.sleeve && String(n.sleeve) !== sleeve) return false;
            if (leader && n.leader && String(n.leader) !== leader) return false;
            return true;
        });
    }

    // Максимально допустимый запас для номенклатуры nom (макс. лимит среди совпавших
    // строк) или null, если номенклатуры нет в списке (нарезать впрок нельзя).
    function maxStockLimit(index, nom) {
        var m = maxStockMatches(index, nom);
        if (!m.length) return null;
        return m.reduce(function(max, n) {
            var v = stripNum(n.limit);
            return v > max ? v : max;
        }, 0);
    }

    // Можно ли нарезать номенклатуру nom впрок (на склад). Если таблица не настроена —
    // true (фича выключена, поведение прежнее). Иначе — есть ли совпадение в списке.
    function isStockableNomenclature(index, nom) {
        if (!maxStockConfigured(index)) return true;
        return maxStockMatches(index, nom).length > 0;
    }

    // Назначение складской (необеспеченной) полосы с учётом «Максимального запаса»:
    // «Склад», если номенклатуру целесообразно хранить, иначе «Отходы».
    function stockStripPurpose(index, nom) {
        return isStockableNomenclature(index, nom) ? 'Склад' : 'Отходы';
    }

    // Фильтр ходовых ширин (добор джамбо) по «Максимальному запасу»: оставляем только
    // те, чья номенклатура (профиль резки + ширина) целесообразна к хранению. Если
    // таблица не настроена — список не меняем. profile = { material, winding, length }.
    function filterStockableWidths(index, preferred, profile) {
        if (!maxStockConfigured(index)) return (preferred || []).slice();
        profile = profile || {};
        return (preferred || []).filter(function(p) {
            return isStockableNomenclature(index, {
                material: profile.material,
                width: p && p.width,
                length: profile.length,
                winding: profile.winding
            });
        });
    }

    // #3954: есть ли в «Максимальном запасе» хоть одна номенклатура семейства
    // (сырьё + длина + намотка, БЕЗ учёта ширины). Только по такому семейству добор
    // ходовыми в принципе возможен — иначе filterStockableWidths отсеет любую ходовую
    // в пустоту. Служит гейтом: запрашивать отчёт preferable_widths лишь когда его данные
    // могут пригодиться. Таблица не настроена → true (фича добора выключена, ходовые
    // применяются как есть, поведение прежнее). family = { material, length, winding }.
    function maxStockFamilyStockable(index, family) {
        if (!maxStockConfigured(index)) return true;
        family = family || {};
        var mat = String(family.material == null ? '' : family.material).trim();
        var len = windLengthValue(family.length);
        var wind = normWinding(family.winding);
        return (index.list || []).some(function(n) {
            return String(n.material == null ? '' : n.material).trim() === mat &&
                windLengthValue(n.length) === len &&
                normWinding(n.winding) === wind;
        });
    }

    // ───────── Лимит запаса (#3445): остаток склада + capping ─────────
    // PR #3395/#3391 решал ЧЛЕНСТВО (Склад vs Отходы). #3445 добавляет КОЛИЧЕСТВЕННЫЙ
    // лимит: на склад по номенклатуре нельзя нарезать больше «Максимального запаса»
    // (первая колонка) с учётом того, что уже лежит на складе.

    // Текущий остаток ГП: суммарные рулоны «Партий ГП», физически лежащих на складе
    // (статус не «Отгружен»), по номенклатуре. batches: [{ material, width, length,
    // winding, rolls, shipped }]; ключ — тот же maxStockKey (сырьё|ширина|длина|намотка).
    function buildStockBalanceIndex(batches) {
        var byKey = {};
        (batches || []).forEach(function(b) {
            if (!b || b.shipped) return;
            var rolls = stripNum(b.rolls);
            if (!(rolls > 0)) return;
            var k = maxStockKey(b);
            byKey[k] = round3((byKey[k] || 0) + rolls);
        });
        return { byKey: byKey };
    }

    // Текущий остаток (рулонов) по номенклатуре nom; 0, если на складе ничего нет.
    function currentStock(balanceIndex, nom) {
        if (!balanceIndex || !balanceIndex.byKey) return 0;
        var v = balanceIndex.byKey[maxStockKey(nom)];
        return v > 0 ? v : 0;
    }

    // Свободный остаток лимита (рулонов) — на сколько ещё можно нарезать впрок:
    // maxStockLimit − текущий остаток (не отрицателен). null — если номенклатуры нет
    // в «Максимальном запасе» (количественного лимита нет; членство решает #3391).
    function stockHeadroom(maxStockIndex, balanceIndex, nom) {
        var limit = maxStockLimit(maxStockIndex, nom);
        if (limit == null) return null;
        var head = round3(limit - currentStock(balanceIndex, nom));
        return head > 0 ? head : 0;
    }

    // Обрезать планируемые НА СКЛАД рулоны по «Максимальному запасу» (#3445, capping).
    // Складские рулоны = перепроизводство заказных ширин (qty×проходов − спрос) + добор
    // ходовыми (полосы «Склад»). По каждой номенклатуре их суммарно (по всем раскладкам)
    // ≤ headroom (свободный остаток лимита). Заказное покрытие НЕ трогаем — режем только
    // излишек впрок; добор режем раньше перепроизводства (ходовые наиболее спекулятивны).
    // Лишнее не нарезается (уходит в остаток джамбо). МУТИРУЕТ strip.qty и убирает
    // обнулённые складские полосы. ctx:
    //   runsForLayout(layout)          → число проходов (≥1);
    //   demandRollsForWidth(layout, w) → рулонов заказа по ширине w в этой раскладке;
    //   headroomForNom(nom)            → рулонов | null (null = без лимита, ширину пропускаем).
    // → { trimmed: [{ key, width, kind:'добор'|'перепроизводство', droppedRolls }] }.
    function capStockToHeadroom(layouts, ctx) {
        var remaining = {};   // key → остаток лимита (рулонов), копится по раскладкам
        var trimmed = [];
        function ensure(key, head) {
            if (!(key in remaining)) remaining[key] = head > 0 ? head : 0;
            return remaining[key];
        }
        (layouts || []).forEach(function(layout) {
            var runs = Math.ceil(Number(ctx.runsForLayout(layout)) || 1);
            if (!(runs >= 1)) runs = 1;
            var strips = (layout && layout.strips) || [];
            // Сгруппировать полосы раскладки по ширине: заказная + складская.
            var byWidth = {};
            var order = [];
            strips.forEach(function(s) {
                if (s && s.core) return;   // #3812: втулочные полосы не урезаются по запасу
                var w = round3(Number(s.width) || 0);
                if (w <= 0) return;
                var key = String(w);
                if (!byWidth[key]) { byWidth[key] = { width: w, order: null, stock: null }; order.push(key); }
                if (isStockStrip(s)) byWidth[key].stock = s; else byWidth[key].order = s;
            });
            order.forEach(function(wKey) {
                var g = byWidth[wKey];
                var nom = { material: layout.mat, width: g.width, length: layout.windLength, winding: layout.windDir };
                var head = ctx.headroomForNom(nom);
                if (head == null) return;   // нет количественного лимита — ширину не трогаем
                var key = maxStockKey(nom);
                ensure(key, head);
                // 1) добор (полосы «Склад»): весь объём — впрок, режем первым.
                if (g.stock) {
                    var producedS = round3((Number(g.stock.qty) || 0) * runs);
                    if (producedS > remaining[key]) {
                        var allowedQtyS = Math.floor(remaining[key] / runs);
                        if (allowedQtyS < 0) allowedQtyS = 0;
                        var droppedS = round3((Number(g.stock.qty) || 0) * runs - allowedQtyS * runs);
                        g.stock.qty = allowedQtyS;
                        if (droppedS > 0) trimmed.push({ key: key, width: g.width, kind: 'добор', droppedRolls: droppedS });
                        remaining[key] = round3(remaining[key] - allowedQtyS * runs);
                    } else {
                        remaining[key] = round3(remaining[key] - producedS);
                    }
                }
                // 2) перепроизводство заказной ширины (qty×проходов − спрос): режем до
                //    минимума, покрывающего заказ (ceil(спрос/проходов)).
                if (g.order) {
                    var demand = round3(Number(ctx.demandRollsForWidth(layout, g.width)) || 0);
                    var qtyO = Number(g.order.qty) || 0;
                    var producedO = round3(qtyO * runs);
                    var excess = round3(producedO - demand);
                    if (excess > 0) {
                        if (excess > remaining[key]) {
                            var minQty = Math.ceil(demand / runs);
                            if (!(minQty >= 1)) minQty = (demand > 0 ? 1 : 0);
                            var allowedQtyO = minQty + Math.floor(remaining[key] / runs);
                            if (allowedQtyO < minQty) allowedQtyO = minQty;
                            if (allowedQtyO > qtyO) allowedQtyO = qtyO;
                            var droppedO = round3((qtyO - allowedQtyO) * runs);
                            if (droppedO > 0) {
                                g.order.qty = allowedQtyO;
                                trimmed.push({ key: key, width: g.width, kind: 'перепроизводство', droppedRolls: droppedO });
                            }
                            var newExcess = round3(Math.max(0, allowedQtyO * runs - demand));
                            remaining[key] = round3(remaining[key] - newExcess);
                        } else {
                            remaining[key] = round3(remaining[key] - excess);
                        }
                    }
                }
                if (remaining[key] < 0) remaining[key] = 0;
            });
            // Убрать обнулённые складские полосы (заказные с qty≥1 сохраняем).
            if (layout && layout.strips) {
                layout.strips = layout.strips.filter(function(s) {
                    return !(isStockStrip(s) && (Number(s.qty) || 0) <= 0);
                });
            }
        });
        return { trimmed: trimmed };
    }

    function positionMap(positions) {
        if (!positions) return {};
        if (!Array.isArray(positions)) return positions;
        var map = {};
        positions.forEach(function(p) {
            if (p && p.id != null && String(p.id) !== '') map[String(p.id)] = p;
        });
        return map;
    }

    function stripWidthKey(width) {
        return String(round3(Number(width) || 0));
    }

    // ── #3372: фактическая ширина резки ──────────────────────────────────────
    // Справочник «Фактическая ширина резки» (table 66190) задаёт пары
    // номинал («Ширина в заказе») → факт (главное значение записи) с условием в
    // поле «Код»: '' (пусто) — безусловно; 'j=910'/'j>1000' — по ширине джамбо
    // вида сырья; 's=0.5'/'s=1' — по диаметру втулки в дюймах (8188 «Дюймы»).
    // Поддержаны операторы = > < >= <=. ⚠️ Жёсткий фильтр (#3372): факт. ширина
    // применяется ТОЛЬКО при выполнении условия, иначе берётся номинал заказа.
    // #4501: сюда же добавлен ключ 'w' — ШИРИНА ПОЛОСЫ (мм). Им пользуется колонка «Код»
    // таблицы «Время операции, мин» («w<=30» — норма для узких полос, normalizeOperationTimes).
    function parseActualWidthCode(code) {
        var c = String(code == null ? '' : code).trim().toLowerCase().replace(/\s+/g, '');
        if (!c) return { key: '', op: '', val: 0 };           // безусловно
        var m = c.match(/^([jsw])(>=|<=|=|>|<)(\d+(?:\.\d+)?)$/);
        if (!m) return { key: '?', op: '', val: 0 };          // нераспознан → не применяем
        return { key: m[1], op: m[2], val: Number(m[3]) };
    }

    // ctx: { jumbo, inches, width } (любое поле может быть null/undefined). key 'j' →
    // сверяем с jumbo (ширина джамбо), 's' → с inches (дюймы втулки), 'w' → с width
    // (ширина полосы, #4501). '' → всегда true; '?' → всегда false (жёсткий фильтр).
    function actualWidthCodeMatches(parsed, ctx) {
        if (!parsed || parsed.key === '') return true;
        if (parsed.key === '?') return false;
        var v = parsed.key === 'j' ? (ctx && ctx.jumbo)
            : (parsed.key === 'w' ? (ctx && ctx.width) : (ctx && ctx.inches));
        if (v == null || v === '' || !isFinite(Number(v))) return false;
        v = Number(v);
        switch (parsed.op) {
            case '=':  return Math.abs(v - parsed.val) < 1e-6;
            case '>':  return v > parsed.val + 1e-9;
            case '<':  return v < parsed.val - 1e-9;
            case '>=': return v >= parsed.val - 1e-9;
            case '<=': return v <= parsed.val + 1e-9;
        }
        return false;
    }

    // #4006: ограничение станка по ширине джамбо из поля «Код» слиттера. widthCode —
    // разобранное parseActualWidthCode условие ({key,op,val}); станок принимает сырьё,
    // только если его НОМИНАЛЬНАЯ ширина (nominalWidth, рулон) удовлетворяет условию
    // (контекст 'j', как в actualWidthCodeMatches). Пример: «Станок 4 → j<1000» означает
    // «только сырьё уже метра»; MWR500L (номинал 1000) на такой станок не ставится.
    // Пусто / нераспознанный код (key '' или '?') → без ограничения (не блокируем).
    // Нет номинала (null/битый) → не блокируем — иначе теряли бы резку из-за пробела в справочнике.
    function isSlitterWidthBlocked(widthCode, nominalWidth) {
        if (!widthCode || widthCode.key === '' || widthCode.key === '?') return false;
        var n = Number(nominalWidth);
        if (!isFinite(n) || n <= 0) return false;
        return !actualWidthCodeMatches(widthCode, { jumbo: n });
    }

    // rows: [{ actual, order, code }] из справочника → индекс
    // { stripWidthKey(order): [{ actual, parsed }] }. Условные строки идут раньше
    // безусловных — приоритет более специфичного правила при совпадении номинала.
    function buildActualWidthIndex(rows) {
        var index = {};
        (rows || []).forEach(function(row) {
            var order = Number(row && row.order);
            var actual = Number(row && row.actual);
            if (!isFinite(order) || order <= 0 || !isFinite(actual) || actual <= 0) return;
            var key = stripWidthKey(order);
            // #3408: храним и сам номинал (order), чтобы по факт.ширине восстановить
            // номинал в сводке полос (resolveNominalWidth) — полосы хранят факт.ширину.
            (index[key] || (index[key] = [])).push({ order: order, actual: actual, parsed: parseActualWidthCode(row.code) });
        });
        Object.keys(index).forEach(function(key) {
            index[key].sort(function(a, b) {
                return (b.parsed.key !== '' ? 1 : 0) - (a.parsed.key !== '' ? 1 : 0);
            });
        });
        return index;
    }

    // Фактическая ширина резки для номинальной ширины заказа с учётом контекста
    // позиции (ширина джамбо вида сырья, диаметр втулки в дюймах). Нет правила или
    // ни одно условие не выполнено → возвращаем номинал как есть (жёсткий фильтр).
    function resolveCutWidth(nominalWidth, ctx, index) {
        var n = Number(nominalWidth);
        if (!isFinite(n) || n <= 0) return nominalWidth;
        var rows = (index && index[stripWidthKey(n)]) || [];
        for (var i = 0; i < rows.length; i++) {
            if (actualWidthCodeMatches(rows[i].parsed, ctx)) {
                var w = Number(rows[i].actual);
                return isFinite(w) && w > 0 ? w : n;
            }
        }
        return n;
    }

    // #3408: обратный резолв к resolveCutWidth — по ФАКТИЧЕСКОЙ ширине вернуть номинал
    // заказа. Полосы резки (Партии ГП) хранят факт.ширину (#3372: p.width = факт.),
    // поэтому в сводке полос («сначала номинал, потом реальные мм») номинал нужно
    // восстановить. Берём правило справочника, чья факт.ширина равна заданной и условие
    // выполнено в этом контексте; условные правила приоритетнее безусловных (как в
    // прямом резолве). Нет совпадения — возвращаем факт. как есть (ширина не
    // корректировалась → номинал == факт.).
    function resolveNominalWidth(actualWidth, ctx, index) {
        var a = Number(actualWidth);
        if (!isFinite(a) || a <= 0) return actualWidth;
        var best = null, bestConditional = -1;
        Object.keys(index || {}).forEach(function(key) {
            (index[key] || []).forEach(function(entry) {
                if (Math.abs(Number(entry.actual) - a) > 1e-6) return;
                if (!actualWidthCodeMatches(entry.parsed, ctx)) return;
                var cond = (entry.parsed && entry.parsed.key !== '') ? 1 : 0;
                if (cond > bestConditional) { bestConditional = cond; best = entry.order; }
            });
        });
        return best != null ? best : a;
    }

    // ── #3812: втулочные полосы для втулки 0.5″ шириной 110 мм ────────────────
    // На втулке 0.5″ риббон у́же 55 мм не производится (ограниченная размерная
    // сетка). При ширине втулки 110 мм в раскрой добавляются полосы 110 мм:
    // продуктовая ширина 55–57 → 2 полосы; 63–64 → 1 полоса; иначе (58–62, 65–70,
    // >70) — полос нет (>70 режется по обычному правилу втулки 1″). Полосы 110 мм
    // занимают ширину джамбо той же резки (резервируются ДО укладки продукта).

    // Ширина втулки из названия записи «Диаметр втулки» (фолбэк к реквизиту):
    // «Втулка картонная 0.5" ширина 110 мм» → 110. Нет шаблона → null.
    function parseSleeveWidthFromName(name) {
        var m = String(name == null ? '' : name).match(/ширина\s*(\d+(?:[.,]\d+)?)\s*мм/i);
        if (!m) return null;
        var n = Number(m[1].replace(',', '.'));
        return isFinite(n) && n > 0 ? n : null;
    }

    // Позицию можно произвести? Втулка 0.5″ запрещает ширину < 55 мм.
    function isSleeveWidthProducible(inches, orderWidth) {
        var w = Number(orderWidth);
        if (Number(inches) === 0.5 && isFinite(w) && w < 55) return false;
        return true;
    }

    // План втулочных полос для раскроя: { stripWidth, count }. Срабатывает только
    // для втулки 0.5″ шириной 110 мм. orderWidths — НОМИНАЛЬНЫЕ ширины продукта в
    // раскрое (резка разбита по count в профиле, поэтому ширины одного диапазона).
    function sleeveCoreStripPlan(inches, coreWidthMm, orderWidths) {
        var none = { stripWidth: 0, count: 0 };
        if (Number(inches) !== 0.5 || Number(coreWidthMm) !== 110) return none;
        var ws = (orderWidths || []).map(Number).filter(function(w) { return isFinite(w) && w > 0; });
        if (!ws.length) return none;
        var allIn = function(lo, hi) {
            return ws.every(function(w) { return w >= lo - 1e-9 && w <= hi + 1e-9; });
        };
        if (allIn(55, 57)) return { stripWidth: 110, count: 2 };
        if (allIn(63, 64)) return { stripWidth: 110, count: 1 };
        return none;
    }

    // Дописать в раскрой втулочные полосы (#3812). Помечаем core:true — раскрой их
    // показывает «Партией ГП» (Σ ширина×полос ≤ ширина джамбо), но capStockToHeadroom
    // их не урезает и не считает перепроизводством, а число проходов от них не зависит
    // (проходы по продукту, см. plannedRunsForLayout). Идемпотентно: повторная ширина не двоится.
    //
    // #3872: если 110-мм втулки уже заказаны (есть позиции заказа той же ширины — обычно в том
    // же заказе), полосы ПРИВЯЗЫВАЮТСЯ к этим позициям (fillerPositionIds): полоса несёт их id,
    // а сами позиции добавляются в positionsCovered — резка их обеспечивает (на произведённое
    // min(заказ, полосы×проходов), излишек в запас). Нет таких позиций → fillerPositionIds пуст,
    // полоса синтетическая (positionIds: []), поведение #3812. core:true остаётся в обоих случаях
    // (проходы не растут от 110 мм — фикс. число полос задаёт продукт-носитель).
    function appendCoreStrip(layout, coreWidth, count, fillerPositionIds) {
        if (!layout || !(count > 0) || !(coreWidth > 0)) return layout;
        layout.strips = layout.strips || [];
        var w = round3(coreWidth);
        var ids = (fillerPositionIds || []).map(String);
        if (ids.length) {
            layout.positionsCovered = layout.positionsCovered || [];
            ids.forEach(function(id) { if (layout.positionsCovered.indexOf(id) < 0) layout.positionsCovered.push(id); });
        }
        for (var i = 0; i < layout.strips.length; i++) {
            var s = layout.strips[i];
            if (s && s.core && round3(s.width) === w) {
                s.qty = count;
                if (ids.length) s.positionIds = ids.slice();
                return layout;
            }
        }
        layout.strips.push({ width: w, qty: count, purpose: 'Заказ', core: true, positionIds: ids.slice() });
        sortStripsByWidthDesc(layout.strips);   // единый ряд по убыванию: втулочная полоса встаёт по своей ширине
        return layout;
    }

    // #3872: позиция заказа подходит под «втулочную полосу» носителя (group), если её можно
    // отрезать тем же джамбо (то же сырьё/намотка/длина), её фактическая ширина = ширине полосы
    // (coreStripWidth, 110 мм), она производима и сама не требует втулочных полос. Такие позиции
    // резка-носитель использует вместо синтетических полос. Чистая (тест).
    function isCoreStripFiller(position, group) {
        if (!position || !group) return false;
        if (!(Number(group.coreStripCount) > 0) || !(Number(group.coreStripWidth) > 0)) return false;
        if (position.producible === false) return false;
        if (Number(position.coreStripCount) > 0) return false;   // сам носитель — не филлер
        if (round3(Number(position.width) || 0) !== round3(Number(group.coreStripWidth) || 0)) return false;
        if (String(position.materialId == null ? '' : position.materialId) !== String(group.materialId == null ? '' : group.materialId)) return false;
        if (normWinding(position.windDir) !== normWinding(group.windDir)) return false;
        if (windLengthValue(position.windLength) !== windLengthValue(group.windLength)) return false;
        return true;
    }

    // #3872: выбрать позиции заказа, которые раскладка-носитель забирает под втулочные полосы.
    // Кандидаты — необеспеченные позиции (candidates); берём подходящие группе (isCoreStripFiller),
    // чей заказ ПОКРЫТ этой раскладкой (coveredOrderIds), и ещё не забранные (claimed). Помечает
    // выбранные в claimed (мутирует), чтобы одна 110-мм позиция не ушла в две резки. → [positionId].
    function selectCoreStripFillers(candidates, group, coveredOrderIds, claimed) {
        var picked = [];
        var orders = coveredOrderIds || {};
        var taken = claimed || {};
        (candidates || []).forEach(function(p) {
            if (!p || p.id == null) return;
            var id = String(p.id);
            if (taken[id]) return;
            if (!orders[String(p.orderId)]) return;
            if (!isCoreStripFiller(p, group)) return;
            taken[id] = true;
            picked.push(id);
        });
        return picked;
    }

    function nonStockStripQtyForWidth(layout, width) {
        var key = stripWidthKey(width);
        return (layout && layout.strips || []).reduce(function(sum, s) {
            if (isStockStrip(s)) return sum;
            return stripWidthKey(s.width) === key ? sum + (Number(s.qty) || 0) : sum;
        }, 0);
    }

    // #3812/#3872: ширины, обслуживаемые ТОЛЬКО втулочными полосами (core) и ни одной обычной
    // полосой. Их потребность не определяет число проходов: фикс. число полос задаёт продукт-
    // носитель, а позиции 110 мм обеспечиваются на произведённое (см. plannedRunsForLayout).
    function coreOnlyStripWidths(layout) {
        var core = {}, nonCore = {};
        (layout && layout.strips || []).forEach(function(s) {
            if (!s) return;
            var key = stripWidthKey(s.width);
            if (s.core) core[key] = true;
            else if (!isStockStrip(s)) nonCore[key] = true;
        });
        var out = {};
        Object.keys(core).forEach(function(k) { if (!nonCore[k]) out[k] = true; });
        return out;
    }

    function plannedRunsForLayout(layout, positions) {
        var direct = Number(layout && (layout.plannedRuns || layout.runCount || layout.runs));
        if (isFinite(direct) && direct > 0) return Math.ceil(direct);
        var byId = positionMap(positions);
        var coreOnly = coreOnlyStripWidths(layout);   // #3872: 110-мм позиции не двигают проходы
        var demandByWidth = {};
        (layout && layout.positionsCovered || []).forEach(function(pid) {
            var p = byId[String(pid)];
            if (!p) return;
            var w = Number(p.width) || 0;
            var qty = Number(p.qty) || 0;
            if (w <= 0 || qty <= 0) return;
            var key = stripWidthKey(w);
            if (coreOnly[key]) return;   // #3872: ширина только из втулочных полос — проходы по продукту
            demandByWidth[key] = (demandByWidth[key] || 0) + qty;
        });
        var runs = 1;
        Object.keys(demandByWidth).forEach(function(key) {
            var out = nonStockStripQtyForWidth(layout, key);
            if (out > 0) runs = Math.max(runs, Math.ceil(demandByWidth[key] / out));
        });
        return runs;
    }

    // #3435: рулоны обеспечения позиции = её заказанное кол-во, НО не больше выпуска
    // этой ширины (runs × полос). Несколько позиций одной ширины делят выпуск по своему
    // заказу, а не получают каждая полный выпуск (иначе спрос/обеспечение задваивались —
    // у партии на 2 заказа «Кол-во рулонов» = 2 × «Кол-во план»). Излишек выпуска над
    // заказом — в запас. qty неизвестно (≤0) → весь выпуск ширины (прежнее поведение).
    function supplyRollsForPosition(layout, position, plannedRuns) {
        if (!position) return 0;
        var runs = Number(plannedRuns) || 0;
        if (runs <= 0) runs = plannedRunsForLayout(layout, [position]);
        var strips = nonStockStripQtyForWidth(layout, position.width);
        var produced = round3(runs * strips);
        var qty = Number(position.qty) || 0;
        return qty > 0 ? Math.min(qty, produced) : produced;
    }

    function layoutRunLength(layout, positions) {
        var direct = Number(layout && (layout.runLength || layout.length));
        if (isFinite(direct) && direct > 0) return direct;
        var byId = positionMap(positions);
        var out = 0;
        (layout && layout.positionsCovered || []).forEach(function(pid) {
            var p = byId[String(pid)];
            var len = Number(p && p.length) || 0;
            if (len > out) out = len;
        });
        return out;
    }

    // #3242/#3253: состав резки = «Партия ГП» по каждой РАЗЛИЧНОЙ ширине. Храним
    // «количество ПОЛОС за один проход» (Σ полос этой ширины), БЕЗ умножения на проходы —
    // это геометрия раскроя (Σ ширина×полос ≤ ширина джамбо). Число рулонов (полос ×
    // проходов) — производная величина, отдельно не храним. → [{ width, strips, length }]
    // по порядку первого появления ширины.
    function producedBatchesForLayout(layout, runLength) {
        var len = Number(runLength) || 0;
        var byWidth = {};
        var order = [];
        (layout && layout.strips || []).forEach(function(s) {
            var width = Number(s.width) || 0;
            var qty = Number(s.qty) || 0;
            if (width <= 0 || qty <= 0) return;
            var key = stripWidthKey(width);
            if (!(key in byWidth)) { byWidth[key] = { width: width, strips: 0, length: len }; order.push(key); }
            byWidth[key].strips = round3(byWidth[key].strips + qty);
        });
        return order.map(function(k) { return byWidth[k]; });
    }

    // #3242: план обеспечений резки — каждая покрытая позиция ссылается на «Партию ГП»
    // своей ширины, забирая supplyRollsForPosition рулонов и метраж позиции (posLength).
    // → [{ positionId, width, rolls, footage }] (позиции с нулевыми рулонами пропускаются).
    function supplyPlanForLayout(layout, positions, plannedRuns, posLength) {
        var byId = positionMap(positions);
        var out = [];
        (layout && layout.positionsCovered || []).forEach(function(pid) {
            var p = byId[String(pid)];
            if (!p) return;
            var rolls = supplyRollsForPosition(layout, p, plannedRuns);
            if (!(rolls > 0)) return;
            var len = posLength ? (Number(posLength[String(pid)]) || 0) : (Number(p.length) || 0);
            out.push({ positionId: String(pid), width: Number(p.width) || 0, rolls: rolls, footage: len });
        });
        return out;
    }

    // #3340: задание на втулки нужно позициям, у которых есть тип втулки (sleeveId)
    // и он НЕ «готов» (sleeveReady пуст). qty = кол-во рулонов покрытия позиции.
    // → [{ positionId, sleeveId, qty }].
    function positionSleeveTasksForLayout(layout, positions, plannedRuns) {
        var byId = positionMap(positions);
        var out = [];
        (layout && layout.positionsCovered || []).forEach(function(pid) {
            var positionId = String(pid);
            var p = byId[positionId];
            if (!p) return;
            var sleeveId = p.sleeveId == null ? '' : String(p.sleeveId).trim();
            if (!sleeveId) return;        // у позиции нет втулки
            if (p.sleeveReady) return;    // тип втулки уже нарезан — задание не нужно
            var qty = supplyRollsForPosition(layout, p, plannedRuns);
            if (qty <= 0) return;
            out.push({ positionId: positionId, sleeveId: sleeveId, qty: qty });
        });
        return out;
    }

    // #3340: FIFO-партия втулок для типа sleeveId из отчёта sleeve_batches_active.
    // Отбираем партии «в работе» с совпадающим «Диаметр втулки», берём самую раннюю
    // по дате (dateKey, Unix). batches: [{ id, diameterId, dateKey, active }].
    // → id партии (строка) или '' если подходящей нет.
    function pickSleeveBatchId(batches, sleeveId) {
        var sid = sleeveId == null ? '' : String(sleeveId).trim();
        if (!sid) return '';
        var best = null;
        (batches || []).forEach(function(b) {
            if (!b || !b.active) return;
            if (String(b.diameterId == null ? '' : b.diameterId).trim() !== sid) return;
            if (best == null || (Number(b.dateKey) || 0) < (Number(best.dateKey) || 0)) best = b;
        });
        return best ? String(best.id) : '';
    }

    // #4525: «Зафиксированные (🔒) задания сдвинуты» — ТОЛЬКО о том, что делает ЗАПИСЫВАЕМЫЙ план.
    //
    // Движок зовёт `onFixedDayLost` из КАЖДОЙ раскладки, а их за один расчёт много: кроме итоговой,
    // упаковщик прогоняет пробные — рескью просрочки перебирает станки-кандидаты (#4118/#4203
    // «дозаклад по станкам»). Если среди кандидатов есть станок, который в «Отпуске» всю неделю
    // (боевое: Станок 4, отпуск 30.07–06.08), проба честно сообщает «день 🔒 нерабочий» — и оператор
    // получал красный тост о сдвиге зафиксированного, хотя в записанном плане задание осталось на
    // своём дне (issue #4525: «как могло так выйти, что генерация пишет такое?»).
    //
    // Фильтр: запись о сдвиге остаётся, только если план ДЕЙСТВИТЕЛЬНО переносит это задание в
    // другой день — то есть в `ops.updates` есть его обновление с ДРУГИМ днём. Нет обновления
    // (плана эта запись не касается) или день тот же — это была проба, молчим. Дубли по заданию
    // схлопываем: проб бывает несколько.
    //   lost — [{ cutId, fixedDay, placedDay }]; dayKeyByCut — карта/функция «id → ГГГГММДД сейчас»;
    //   dayKeyOfTs — «планируемый ts → ГГГГММДД». Нет чем сравнить — отдаём как есть (не молчим зря).
    function realFixedDayLost(lost, ops, dayKeyByCut, dayKeyOfTs) {
        var list = lost || [];
        if (!list.length) return [];
        var updates = (ops && ops.updates) || [];
        if (typeof dayKeyOfTs !== 'function' || !dayKeyByCut) return list;
        function dayNow(id) {
            var v = (typeof dayKeyByCut === 'function') ? dayKeyByCut(id) : dayKeyByCut[String(id)];
            return (v == null || v === Infinity) ? null : v;
        }
        var willBe = {};
        updates.forEach(function(u) {
            if (!u || u.cutId == null) return;
            willBe[String(u.cutId)] = dayKeyOfTs(u.planStartTs);
        });
        var seen = {}, out = [];
        list.forEach(function(f) {
            var id = String(f && f.cutId);
            if (seen[id]) return;
            if (!(id in willBe)) return;                 // план эту запись не трогает — сдвига нет
            var was = dayNow(id), will = willBe[id];
            if (was == null || will == null || was === will) return;   // день не меняется
            seen[id] = true;
            out.push(f);
        });
        return out;
    }

    function sleeveMinutes(qty, opTimes) {
        var one = Number(opTimes && opTimes.SLEEVE_CUT) || 0;
        return round3((Number(qty) || 0) * one);
    }

    // Точки «намотка N метров → минуты» из кодов WIND_<метры> таблицы времён операций
    // (WIND_300=1.2 … WIND_1100=5.6). Спец-коды (WIND_FOIL_305, WIND_05_110) не парсятся
    // как серия — это отдельные режимы (учтём позже). → [{m, min}] по возрастанию метров.
    function windingPointsFromTimes(opTimes){
        var pts = [];
        Object.keys(opTimes || {}).forEach(function(code){
            var m = /^WIND_(\d+)$/.exec(code);
            if (m) pts.push({ m: Number(m[1]), min: Number(opTimes[code]) || 0 });
        });
        pts.sort(function(a, b){ return a.m - b.m; });
        // #3606: фольга наматывается медленнее — отдельная серия WIND_FOIL_<метры>
        // (в данных только WIND_FOIL_305=4). Прикрепляем её к набору, чтобы выбирать
        // для резок-фольги (cut.isFoil по position_material_type), не меняя сигнатуры.
        pts.foil = foilWindingPointsFromTimes(opTimes);
        // #4501: ярусы УЗКИХ полос (WIND_W30_<метры>) — тем же приёмом.
        pts.narrow = narrowWindingTiersFromTimes(opTimes);
        return pts;
    }

    // #4501: ЯРУСЫ УЗКОЙ НАМОТКИ. Полоса ≤ 30 мм наматывается дольше — на вал насаживается
    // множество узких втулок, и эта доплата не пропорциональна метражу. Норма задаётся СТРОКАМИ
    // справочника (можно сделать не «×2», а аддитивной), код строки: `WIND_W<макс.ширина>_<метры>`
    // — «самая узкая полоса задания не шире <макс.ширина> мм». Для фольги — `WIND_FOIL_W<…>_<…>`
    // (у неё своя блочная модель, см. foilWindingMinutes). Порог и покрытый диапазон метража
    // целиком в данных: нет строк — нет и правила (поведение до #4501).
    // → [{ maxWidth, foil, points:[{m,min,narrow,maxWidth,foil}] }] по возрастанию порога
    //   (первым идёт самый узкий ярус — он специфичнее).
    function narrowWindingTiersFromTimes(opTimes){
        var byKey = {};
        Object.keys(opTimes || {}).forEach(function(code){
            var m = /^WIND_(FOIL_)?W(\d+(?:[.,]\d+)?)_(\d+)$/.exec(code);
            if (!m) return;
            var foil = !!m[1];
            var maxWidth = Number(String(m[2]).replace(',', '.'));
            if (!(maxWidth > 0)) return;
            var key = (foil ? 'F' : 'B') + maxWidth;
            var tier = byKey[key] || (byKey[key] = { maxWidth: maxWidth, foil: foil, points: [] });
            tier.points.push({ m: Number(m[3]), min: Number(opTimes[code]) || 0,
                narrow: true, maxWidth: maxWidth, foil: foil });
        });
        var tiers = Object.keys(byKey).map(function(k){ return byKey[k]; });
        tiers.forEach(function(t){ t.points.sort(function(a, b){ return a.m - b.m; }); });
        tiers.sort(function(a, b){ return a.maxWidth - b.maxWidth; });
        return tiers;
    }

    // #4501: самая узкая полоса резки (мм) — по ней выбирается ярус нормы намотки. Источник, в
    // порядке достоверности: явный minStripWidth → knifeWidths (развёрнуты по qty из cut_strips)
    // → strips раскладки ([{width,qty}], резка ещё не создана). Не знаем полос → 0 («не узкая»):
    // молча ускорять задание из-за пробела в данных нельзя, но и замедлять — тоже.
    function minStripWidthOfCut(cut){
        if (!cut || typeof cut !== 'object') return 0;
        var best = 0;
        function take(value){
            var w = Number(value) || 0;
            if (w > 0 && (best === 0 || w < best)) best = w;
        }
        take(cut.minStripWidth);
        if (!best && Array.isArray(cut.knifeWidths)) cut.knifeWidths.forEach(take);
        if (!best && Array.isArray(cut.strips)) cut.strips.forEach(function(s){ take(s && s.width); });
        return best;
    }

    // #3606: точки намотки ФОЛЬГИ из кодов WIND_FOIL_<метры>. #3742: норма «4 мин за каждые
    // 305 м» считается БЛОКАМИ (foilWindingMinutes), а не пропорцией: проход короче нормы всё
    // равно стоит полную норму (122м→4, 305→4, 400→8, 610→8). Помечаем foil:true — по флагу
    // windingMinutes выбирает блочную модель и подпись нормы. Нет кодов WIND_FOIL_ → [].
    function foilWindingPointsFromTimes(opTimes){
        var pts = [];
        Object.keys(opTimes || {}).forEach(function(code){
            var m = /^WIND_FOIL_(\d+)$/.exec(code);
            if (m) pts.push({ m: Number(m[1]), min: Number(opTimes[code]) || 0, foil: true });
        });
        pts.sort(function(a, b){ return a.m - b.m; });
        return pts;
    }

    // ШЛЮЗ ВЫБОРА НОРМЫ НАМОТКИ. Единственное место, где решается, по какой серии считать резку;
    // все расчёты длительности («Сгенерировать», «Упорядочить», дробление по дням, тайминг,
    // расписание очереди и Ганта, модалка) обязаны ходить сюда, иначе правило разъедется по
    // обработчикам.
    //   #3606: фольговые точки при isFoil (если серия WIND_FOIL_ задана), иначе обычные.
    //   #4501: если у резки есть полоса не шире порога яруса — ярус узкой намотки (самый узкий
    //     подходящий, он специфичнее). У фольги свой ярус (WIND_FOIL_W…): без него узкая фольга
    //     остаётся на блочной фольговой норме — линейная узкая серия её бы УСКОРИЛА.
    // Первый аргумент — резка/дескриптор/план целиком (из него берём isFoil и самую узкую полосу)
    // либо, как раньше, булев isFoil (тогда ширины полос неизвестны и ярус не выбирается).
    function windPointsForCut(cutOrIsFoil, windPoints){
        var isFoil, minWidth;
        if (cutOrIsFoil && typeof cutOrIsFoil === 'object') {
            isFoil = !!cutOrIsFoil.isFoil;
            minWidth = minStripWidthOfCut(cutOrIsFoil);
        } else {
            isFoil = !!cutOrIsFoil;
            minWidth = 0;
        }
        var tiers = (windPoints && windPoints.narrow) || [];
        for (var i = 0; minWidth > 0 && i < tiers.length; i++){
            if (!!tiers[i].foil !== isFoil) continue;
            if (tiers[i].points.length && minWidth <= tiers[i].maxWidth + 1e-9) return tiers[i].points;
        }
        if (isFoil && windPoints && windPoints.foil && windPoints.foil.length) return windPoints.foil;
        return windPoints || [];
    }

    // #3742: намотка ФОЛЬГИ — БЛОКАМИ, не пропорцией. Норма WIND_FOIL_<метры>=<мин> читается
    // как «<мин> за каждые НАЧАТЫЕ <метры>»: время прохода = ceil(метраж / <метры>) × <мин>.
    // Короткий проход всё равно стоит полную норму (122 м при норме 305 м = 4 мин, а не 1.6;
    // 400 м = 8 мин — начат второй блок). Блок = наименьшая по метражу точка серии. Нет
    // нормы / метраж ≤ 0 → 0.
    function foilWindingMinutes(runMeters, foilPoints){
        var x = Number(runMeters) || 0;
        if (x <= 0) return 0;
        var ref = (foilPoints || []).filter(function(p){ return Number(p.m) > 0; })
            .sort(function(a, b){ return a.m - b.m; })[0];
        if (!ref) return 0;
        return round3(Math.ceil(x / Number(ref.m)) * (Number(ref.min) || 0));
    }

    // Время намотки runMeters (мин) по точкам — кусочно-линейно: ниже первой точки —
    // пропорционально от 0; между точками — линейно; выше последней — экстраполяция по
    // последнему отрезку (при одной точке — клампим). #3742: точки фольги (флаг foil) —
    // блочная модель foilWindingMinutes, а не интерполяция. Нет точек / runMeters≤0 → 0.
    function windingMinutes(runMeters, points){
        var x = Number(runMeters) || 0;
        var p = (points || []).slice().sort(function(a, b){ return a.m - b.m; });
        if (!p.length || x <= 0) return 0;
        if (p.some(function(q){ return q.foil; })) return foilWindingMinutes(x, p);   // #3742: фольга — блоками
        if (x <= p[0].m) return round3(p[0].min * (x / p[0].m));
        for (var i = 1; i < p.length; i++){
            if (x <= p[i].m){
                var t = (x - p[i-1].m) / (p[i].m - p[i-1].m);
                return round3(p[i-1].min + t * (p[i].min - p[i-1].min));
            }
        }
        // #4501: узкая серия ВЫШЕ последней своей точки не экстраполируется — клампим. Диапазон
        // задан справочником («×2 до 600 м включительно»): доплата за узкие втулки на длинном
        // рулоне не исчезает (падать на базовую норму нельзя), но и выдумывать за справочник
        // наклон не следует. Нужен 900 м — заводится строка WIND_W30_900.
        if (p[p.length-1].narrow) return round3(p[p.length-1].min);
        if (p.length < 2) return round3(p[p.length-1].min);
        var a = p[p.length-2], b = p[p.length-1];
        var slope = (b.min - a.min) / (b.m - a.m);
        return round3(b.min + slope * (x - b.m));
    }

    // cutRef — резка/дескриптор/план целиком (#4501: из него берётся и фольга, и самая узкая
    // полоса) либо старый булев isFoil.
    function plannedCutDurationMinutes(runMeters, plannedRuns, opTimes, cutRef) {
        var runs = Number(plannedRuns) || 0;
        if (runs <= 0) return 0;
        var pts = windPointsForCut(cutRef, windingPointsFromTimes(opTimes || {})); // #3606/#4501: своя норма
        return round3(windingMinutes(runMeters, pts) * runs);
    }

    // Норма(ы) намотки, реально применённые для метража runMeters (зеркало windingMinutes,
    // #3240 «привести только ту, которая здесь подходит»):
    //   точное совпадение точки → [та точка]; ниже первой → [первая] (пропорция от 0);
    //   между точками → [нижняя, верхняя] (интерполяция); выше последней → [предпоследняя,
    //   последняя] (экстраполяция). Нет точек / runMeters≤0 → []. → подмножество points.
    function relevantWindingNorms(runMeters, points){
        var x = Number(runMeters) || 0;
        var p = (points || []).slice().sort(function(a, b){ return a.m - b.m; });
        if (!p.length || x <= 0) return [];
        for (var k = 0; k < p.length; k++){ if (p[k].m === x) return [p[k]]; }
        if (x <= p[0].m) return [p[0]];
        for (var i = 1; i < p.length; i++){ if (x <= p[i].m) return [p[i-1], p[i]]; }
        return p.length >= 2 ? [p[p.length-2], p[p.length-1]] : [p[p.length-1]];
    }

    // norms → строка «Норма намотки: WIND_600=4 мин» (одна) либо «Нормы намотки:
    // WIND_600=4 мин; WIND_900=5 мин (интерполяция)» (две). Пусто → ''.
    function formatWindingNorms(norms){
        var items = (norms || []).filter(function(n){ return Number(n.m) > 0; }) // пропускаем нулевые опорные точки
            .map(function(n){ return windNormCode(n) + '=' + formatTimingNumber(n.min) + ' мин'; });
        if (!items.length) return '';
        if (items.length === 1) return 'Норма намотки: ' + items[0];
        return 'Нормы намотки: ' + items.join('; ') + ' (интерполяция)';
    }

    function formatTimingNumber(value) {
        return String(round3(Number(value) || 0));
    }

    // Код нормы намотки для подписи оператору: WIND_600 / WIND_FOIL_305 / WIND_W30_600 (#4501 —
    // по коду видно, что применена узкая серия, и какой у неё порог).
    function windNormCode(norm){
        return 'WIND_' + (norm && norm.foil ? 'FOIL_' : '')
            + (norm && norm.narrow ? 'W' + formatTimingNumber(norm.maxWidth) + '_' : '')
            + formatTimingNumber(norm && norm.m);
    }

    // #4501: строки таблицы «Время операции, мин» → плоская карта {КОД: минуты}, которая летает
    // по всем расчётам (opTimes). Условие «норма для узких полос» можно задать двумя способами:
    //   • «Код операции» = WIND_W30_600 (канон: порог живёт в ключе и доезжает всюду сам);
    //   • колонка «Код» = `w<=30` на строке WIND_…_600 (как в справочнике «Фактическая ширина
    //     резки») — здесь она приводится к тому же каноническому ключу.
    // Так заполнить можно любое поле, а движок знает ОДНУ форму. rows: [{code, minutes, widthCode}].
    function normalizeOperationTimes(rows){
        var out = {};
        (rows || []).forEach(function(row){
            var code = String((row && row.code) == null ? '' : row.code).trim();
            if (!code) return;
            out[narrowCodeFromWidthCode(code, row && row.widthCode)] = Number(row && row.minutes) || 0;
        });
        return out;
    }

    // Код строки намотки + условие «Код» (`w<=30` / `w<30`) → канонический WIND_[FOIL_]W<порог>_<метры>.
    // Метраж берём из хвостового числа кода (WIND_NARROW_600 → 600). Не намотка, пустое или чужое
    // условие (j/s — они не про ширину полосы) → код как есть.
    // ПРИОРИТЕТ — у «Кода операции»: если он УЖЕ несёт порог (WIND_W30_600), колонка «Код» его не
    // переопределяет. Иначе строка, где поля разошлись (код `W30`, колонка `w<=25`), молча считалась
    // бы по колонке — в справочнике написано одно, в плане другое.
    function narrowCodeFromWidthCode(code, widthCode){
        if (/^WIND_(FOIL_)?W\d+(?:[.,]\d+)?_\d+$/i.test(String(code || '').trim())) return code;
        var parsed = parseActualWidthCode(widthCode);
        if (parsed.key !== 'w' || (parsed.op !== '<=' && parsed.op !== '<')) return code;
        var m = /^WIND_(FOIL_)?(?:[A-Z0-9]+_)*(\d+)$/i.exec(code);
        if (!m) return code;
        // Строгое «<» порогом выразить нельзя — берём ближайшее снизу (w<30 → W29.999).
        var maxWidth = parsed.op === '<' ? round3(parsed.val - 0.001) : parsed.val;
        if (!(maxWidth > 0)) return code;
        return 'WIND_' + (m[1] ? 'FOIL_' : '') + 'W' + formatTimingNumber(maxWidth) + '_' + m[2];
    }

    function cutTimingDetails(runMeters, plannedRuns, opTimes, cutRef) {
        var length = stripNum(runMeters);
        var runs = stripNum(plannedRuns);
        if (!(length > 0) || !(runs > 0)) return '';
        var points = windPointsForCut(cutRef, windingPointsFromTimes(opTimes || {})); // #3606/#4501: своя норма
        if (!points.length) return '';
        var oneRun = windingMinutes(length, points);
        if (!(oneRun > 0)) return '';
        // #4006: лидер между резками (BETWEEN_CUTS) заправляется ПОСЛЕ каждого прохода —
        // включаем его в тайминг прохода, чтобы «Итого резка» отражало полное время окна
        // (намотка + лидер), а не только намотку. Норма намотки остаётся отдельной строкой.
        var t = opTimes || {};
        var leaderUnit = Number(t.BETWEEN_CUTS != null ? t.BETWEEN_CUTS : DEFAULT_OP_TIMES.BETWEEN_CUTS) || 0;
        // #4421: намотка и лидер — РАЗНЫМИ строками (как в модалке): смешанный «тайминг прохода»
        // читался как норма, хотя нормой не был. Итог тот же — намотка по норме + лидер.
        var windTotal = round3(oneRun * runs);
        var leaderTotal = round3(leaderUnit * runs);
        var total = round3(windTotal + leaderTotal);
        if (!(total > 0)) return '';
        return [
            'Метраж прохода: ' + formatTimingNumber(length) + ' м',
            'Плановых проходов: ' + formatTimingNumber(runs),
            formatWindingNorms(relevantWindingNorms(length, points)),
            'Намотка: ' + formatTimingNumber(oneRun) + ' * ' + formatTimingNumber(runs) + ' = ' + formatTimingNumber(windTotal) + ' мин',
            'Лидер: ' + formatTimingNumber(leaderUnit) + ' * ' + formatTimingNumber(runs) + ' = ' + formatTimingNumber(leaderTotal) + ' мин',
            'Итого резка: ' + formatTimingNumber(windTotal) + ' + ' + formatTimingNumber(leaderTotal) + ' = ' + formatTimingNumber(total) + ' мин'
        ].filter(function(x){ return x; }).join('\n');
    }

    function cutTimingModalText(cut) {
        var text = String(cut && cut.timing != null ? cut.timing : '').trim();
        return text || 'Тайминг резки не заполнен';
    }

    // Заголовок модалки тайминга (#3240). Авто-номер резки = метка времени создания
    // («08.06.2026 11:37») — для пользователя это шум, поэтому такой номер не показываем;
    // вместо него — сырьё и намотка для опознания резки. Человекочитаемый номер (не
    // timestamp) оставляем. → «Тайминг резки · MW308 · намотка IN».
    function cutTimingModalTitle(cut) {
        var rawNo = cut && cut.number;
        var s = rawNo == null ? '' : String(rawNo).trim();
        var no = (s !== '' && !isTimestampCutNumber(s)) ? formatCutNumber(rawNo) : '';
        var material = (cut && (cut.materialName || (cut.materialId ? '#' + cut.materialId : ''))) || '';
        var winding = normWinding(cut && cut.winding);
        var parts = ['Тайминг резки'];
        if (no) parts.push('№ ' + no);
        if (material) parts.push(material);
        if (winding) parts.push('намотка ' + winding);
        return parts.join(' · ');
    }

    // Строки тайминга окна резки для модалки (#3240, DOM-независимо — рендер в openCutTiming).
    // Включает время на смену сырья/типа/ножи и лидер (setupParts) хронологически от старта
    // окна, «Итого резка» выделяется жирным (bold). ctx: { length, runs, oneRun, total,
    // setupParts:[{label,minutes}], norms:[{m,min}], startMin, finishMin }. → [{ text, bold }].
    function cutTimingTimelineLines(ctx) {
        ctx = ctx || {};
        var length = stripNum(ctx.length);
        var runs = stripNum(ctx.runs);
        var oneRun = round3(Number(ctx.oneRun) || 0);
        var total = round3(Number(ctx.total) || 0);
        var setupParts = ctx.setupParts || [];
        // #3889: сегмент НАСТРОЙКИ (0 проходов) — последняя резка смены, не успевшая начаться:
        // в этот день делается только переналадка (ножи/сырьё), а намотка переносится на
        // продолжение следующего рабочего дня. Раньше модалка печатала «Итого резка: X * 0 = X»
        // (бессмысленно) и не объясняла, что задание продолжится — отсюда вопросы заказчика #3889.
        var setupOnly = ctx.setupOnly === true || !(runs > 0);
        var lines = [];
        // #3889: продолжение предыдущего рабочего дня (тот же логический задание, ножи на станке) —
        // тег сверху, чтобы было видно, что настройка уже выполнена накануне (см. daySplitBadges).
        if (ctx.continuesFromPrevDay) {
            lines.push({ text: '↩ Продолжение резки предыдущего рабочего дня (ножи на станке).', bold: true });
        }
        lines.push({ text: 'Метраж прохода: ' + formatTimingNumber(length) + ' м' });
        lines.push({ text: 'Плановых проходов: ' + formatTimingNumber(runs) });
        // #4006: лидер (BETWEEN_CUTS) заправляется после каждой резки цуга и входит в «Итого резка».
        // #4421: НО показываем его ОТДЕЛЬНОЙ строкой, а не размазанным по проходам. Прежняя одна
        // строка «Намотка и лидер» = намотка + leaderMin/runs давала ДРОБЬ вида «3.211 мин» и
        // «Итого 3.211 * 57 = 183.027» при окне 183: у СОХРАНЁННОГО расписания (#3862) leaderMin —
        // это ОСТАТОК окна после намотки по норме, а в остатке сидит округление «Длительности»
        // ВВЕРХ до целой минуты (#3916: 68.4 → 69). Лидер (2×57=114) при этом ровный — дробь была
        // чужая. Теперь разложено честно: намотка по норме → сколько её в плане → лидер → итог.
        var leaderMin = round3(Number(ctx.leaderMin) || 0);
        var leaderInWindow4421 = ctx.leaderInWindow === true;
        var leaderUnit = round3(Number(ctx.leaderUnit) || 0);
        var leaderRuns = stripNum(ctx.leaderRuns);
        // Лидер по НОРМЕ (база × резок цуга). У сохранённого расписания берём его, а не остаток окна.
        var leaderNorm = (leaderUnit > 0 && leaderRuns > 0) ? round3(leaderUnit * leaderRuns) : leaderMin;
        var leaderShown = leaderInWindow4421 ? leaderNorm : leaderMin;
        // Намотка: по норме и «сколько её в плане» (хранимая «Длительность», #3916 — целые минуты).
        var windNorm = round3(oneRun * runs);
        var plannedWind = round3(Number(ctx.plannedWindMin) || 0);
        var windShown = (leaderInWindow4421 && plannedWind > 0) ? plannedWind : windNorm;
        var totalFull = round3(windShown + leaderShown);
        if (!setupOnly) {
            var normLine = formatWindingNorms(ctx.norms);
            if (normLine) lines.push({ text: normLine });
            lines.push({ text: 'Намотка: ' + formatTimingNumber(oneRun) + ' * ' + formatTimingNumber(runs)
                + ' = ' + formatTimingNumber(windNorm) + ' мин'
                + (windShown !== windNorm ? (' → в плане ' + formatTimingNumber(windShown)
                    + ' мин (округление до целой минуты)') : '') });
            // Норму лидера показываем ТОЛЬКО если она сходится с показанной суммой: в ctx без
            // leaderUnit/leaderRuns её нет, а у live-расписания сумма берётся из sc.leaderMin и
            // может отличаться от базы×резок — «2 * 23 = 47» было бы враньём в арифметике.
            var leaderCalc = (leaderUnit > 0 && leaderRuns > 0 && round3(leaderUnit * leaderRuns) === leaderShown)
                ? (formatTimingNumber(leaderUnit) + ' * ' + formatTimingNumber(leaderRuns) + ' = ') : '';
            lines.push({ text: 'Лидер: ' + leaderCalc + formatTimingNumber(leaderShown)
                + ' мин (заправка после каждой резки цуга)' });
        }
        lines.push({ text: '' });
        lines.push({ text: 'Тайминг окна:' });
        var setupTotal = setupParts.reduce(function(sum, p){ return sum + (Number(p.minutes) || 0); }, 0);
        var hasStart = ctx.startMin != null && isFinite(Number(ctx.startMin));
        var clock = hasStart ? round3(Number(ctx.startMin) - setupTotal) : null;
        setupParts.forEach(function(p){
            var mins = round3(Number(p.minutes) || 0);
            var prefix = clock != null ? (formatClock(clock) + ' · ') : '';
            lines.push({ text: prefix + p.label + ' — ' + formatTimingNumber(mins) + ' мин' });
            if (clock != null) clock += mins;
        });
        var cutPrefix = hasStart ? (formatClock(ctx.startMin) + ' · ') : '';
        if (setupOnly) {
            // #3889: вместо «Итого резка: X * 0» — только настройка; намотка пойдёт с дня N+1.
            // Лидер не показываем (он заправляется в конце намотки, которой в этот день нет).
            lines.push({ text: cutPrefix + 'Только настройка станка — намотка начнётся в следующем рабочем дне', bold: true });
            if (hasStart) lines.push({ text: formatClock(ctx.startMin) + ' · готово (настройка)' });
            lines.push({ text: '' });
            lines.push({ text: '↪ Это последняя резка смены. Намотка (резка) — продолжение в следующем рабочем дне.' });
            return lines;
        }
        // #4421: итог = намотка + лидер (обе строки выше), поэтому он СХОДИТСЯ с окном карточки.
        // Если сохранённое окно всё же шире/уже суммы (правили колонки руками, старый расчёт) —
        // расхождение печатаем, а не прячем: иначе «Итого» и «готово» опять разъедутся молча.
        var windowMin4421 = (ctx.startMin != null && ctx.finishMin != null
            && isFinite(Number(ctx.startMin)) && isFinite(Number(ctx.finishMin)))
            ? round3(Number(ctx.finishMin) - Number(ctx.startMin)) : null;
        var mismatch4421 = (leaderInWindow4421 && windowMin4421 != null && windowMin4421 !== totalFull)
            ? (' · сохранённое окно ' + formatTimingNumber(windowMin4421) + ' мин, расхождение '
               + formatTimingNumber(round3(windowMin4421 - totalFull)) + ' мин') : '';
        lines.push({
            text: cutPrefix + 'Итого резка: ' + formatTimingNumber(windShown) + ' + ' + formatTimingNumber(leaderShown)
                + ' = ' + formatTimingNumber(totalFull) + ' мин' + mismatch4421,
            bold: true
        });
        // #4006: лидер (BETWEEN_CUTS) включён в «Итого резка» — отдельной строкой не показываем.
        // #3688/#3862: «готово» = конец окна с лидером. Для СОХРАНЁННОГО расписания (scheduleFromStored)
        // лидер уже ВХОДИТ в окно (finishMin — конец лидера). Для live-расписания (buildSchedule)
        // лидер идёт ПОСЛЕ намотки: «готово» = finishMin + лидер. Обе ветки дают start + (намотка +
        // лидер) = тот же конец окна, что у карточки/Ганта.
        var hasFinish = ctx.finishMin != null && isFinite(Number(ctx.finishMin));
        var leaderInWindow = ctx.leaderInWindow === true;
        if (hasFinish) {
            var doneClock = leaderInWindow ? Number(ctx.finishMin) : round3(Number(ctx.finishMin) + leaderMin);
            lines.push({ text: formatClock(doneClock) + ' · готово' });
        }
        // #3889: обычная резка с проходами, у которой остаток проходов уходит на следующий день
        // (дробление по проходам, не по настройке) — поясняем, что задание продолжится.
        if (ctx.continuesNextDay) {
            lines.push({ text: '' });
            lines.push({ text: '↪ Остаток проходов — продолжение в следующем рабочем дне.' });
        }
        return lines;
    }

    // #3862: разбивка setup для модалки из СОХРАНЁННЫХ колонок резки («Наладка ножей»+«Сырьё-
    // намотка»), а не пересчётом на лету. Минуты — из хранимого (сумма точно = sc.setupMin окна
    // карточки/Ганта, иначе модалка рисовала setup короче окна и оставляла зазор перед настройкой,
    // напр. начало в 08:15 вместо 08:00). Метки — из live-разбивки (firstSetupParts/changeoverParts),
    // по коду компонента; если live не дал компонент (расходится с хранимым) — метка по умолчанию.
    function storedSetupBreakdown(cut, prevCut, times, opts) {
        function num(v) { return (v == null || v === '') ? 0 : (Number(v) || 0); }
        var knife = round3(num(cut && cut.storedKnifeSetupMin));
        var matWind = round3(num(cut && cut.storedMaterialWindingMin));
        var liveLabel = {};
        setupBreakdown(prevCut, cut, times, opts).forEach(function(p) { liveLabel[p.code] = p.label; });
        var parts = [];
        if (knife > 0) parts.push({ code: 'KNIFE', label: liveLabel.KNIFE || 'настройка ножей', minutes: knife });
        if (matWind > 0) parts.push({ code: 'MATERIAL_WINDING', label: liveLabel.MATERIAL_WINDING || 'смена сырья / намотки / партии', minutes: matWind });
        return parts;
    }

    // Контекст тайминга одной резки для модалки (#3240): метраж/проходы/намотка, разбивка
    // setup (prevCut — предыдущая резка очереди или null для первой), релевантные нормы и
    // старт/финиш из расписания sc. → объект для cutTimingTimelineLines.
    function buildCutTimingCtx(cut, prevCut, sc, runMeters, windPoints, times, opts) {
        var t = times || DEFAULT_OP_TIMES;
        var length = stripNum(runMeters);
        var runs = stripNum(cut && cut.plannedRuns);
        var pts = windPointsForCut(cut, windPoints); // #3606/#4501: фольга и узкие полосы — своя норма
        var oneRun = windingMinutes(length, pts);
        // #3889: сегмент НАСТРОЙКИ (хвост дня N перед намоткой дня N+1) — «Кол-во план» = 0.
        // У него намотки нет (вся намотка переносится на продолжение след. дня), поэтому total = 0,
        // а не oneRun: модалка не печатает «Итого резка: X * 0 = X» (бессмысленное «namotka * 0»).
        var setupOnly = !(runs > 0);
        var total = setupOnly ? 0 : round3(oneRun * runs);
        // #3688: лидер после намотки — из расписания (sc.leaderMin) либо считаем сами.
        // #3862: сохранённое расписание (scheduleFromStored) НЕ хранит лидер отдельно — он входит в
        // окно (durationMin = намотка+лидер, finishMin = конец лидера, sc.leaderMin == null). Тогда
        // лидер для разбивки = остаток окна после намотки = (finishMin − startMin) − намотка, чтобы
        // «готово» совпало с finishMin карточки/Ганта (а не пересчитывался независимо и не выезжал за окно).
        var leaderUnit = Number(t.BETWEEN_CUTS != null ? t.BETWEEN_CUTS : DEFAULT_OP_TIMES.BETWEEN_CUTS) || 0;
        var leaderInWindow = !!(sc && sc.leaderMin == null && sc.finishMin != null && sc.startMin != null);
        var leaderMin = leaderInWindow
            ? round3(Math.max(0, (Number(sc.finishMin) - Number(sc.startMin)) - round3(total)))
            : ((sc && sc.leaderMin != null) ? round3(Number(sc.leaderMin) || 0) : round3(leaderUnit * cutLeaderRuns(cut)));
        return {
            length: length,
            runs: runs,
            oneRun: round3(oneRun),
            total: round3(total),
            // #4421: составляющие лидера и намотки — чтобы модалка разложила окно честно (норма
            // лидера отдельно, округление «Длительности» отдельно), а не смешивала их в дробный
            // «тайминг прохода». plannedWindMin — намотка, которую ДЕРЖИТ план (хранимая
            // «Длительность, минут», #3916 — целые минуты).
            leaderUnit: round3(leaderUnit),
            leaderRuns: cutLeaderRuns(cut),
            plannedWindMin: stripNum(cut && cut.duration),
            // #3862: при сохранённом расписании setup берём из хранимых колонок (sum = sc.setupMin),
            // иначе — live-разбивка (buildSchedule). Так модалка не расходится с карточкой/Гантом.
            setupParts: leaderInWindow ? storedSetupBreakdown(cut, prevCut, times, opts) : setupBreakdown(prevCut, cut, times, opts),
            leaderMin: leaderMin,   // #3688: лидер в конце резки
            leaderInWindow: leaderInWindow,   // #3862: лидер входит в окно (сохранённое расписание) → «готово» = finishMin
            norms: relevantWindingNorms(length, pts),
            setupOnly: setupOnly,   // #3889: 0 проходов — только настройка, намотка с дня N+1
            startMin: sc ? sc.startMin : null,
            finishMin: sc ? sc.finishMin : null
        };
    }

    function scheduleDurationMinutes(cut, runMeters, windPoints) {
        var oneRun = windingMinutes(runMeters, windPointsForCut(cut, windPoints)); // #3606/#4501: своя норма
        var runs = stripNum(cut && cut.plannedRuns);
        var computed = runs > 0 ? round3(oneRun * runs) : oneRun;
        if (computed > 0) return computed;
        var stored = stripNum(cut && cut.duration);
        return stored > 0 ? round3(stored) : 0;
    }

    // #3635 п.5: id сегментов НАСТРОЙКИ — резки с 0 проходов (голова разбиения «настройка в
    // конце дня N → намотка с дня N+1»): у них намотки нет, поэтому в расписании их длительность
    // 0 (а не оценка «1 проход» из scheduleDurationMinutes), и карточка показывает «Настройка».
    function setupTaskIdSet(cuts) {
        // #3635 п.5: запись «Задание в производство» с «Кол-во план» = 0 — это сегмент НАСТРОЙКИ
        // (настройка в хвосте дня N, намотка-продолжение с дня N+1). Помечаем её setup-only по
        // самому признаку «0 проходов».
        // #3827: НЕ требуем, чтобы продолжение (с проходами) той же цепочки присутствовало в
        // наборе. Раньше setup-сегмент опознавался лишь когда в загруженных резках была и резка
        // той же цепочки (slitter|материал|намотка|ножи). При УЗКОМ фильтре дат продолжение
        // (на след. дне) в набор не попадало → сегмент настройки оставался «одиноким», терял
        // признак и в расписании считался обычной задачей с ПОЛНОЙ переналадкой в хвосте дня:
        // #3805 не дробил его настройку по концу смены, и сумма дня прыгала (бейдж 483 при
        // фильтре «23», но 467 при «23–30» — #3827). 0-проходную резку всегда создаёт только
        // планировщик как разрыв настройки (splitMachineQueue, setupOnly) — другого источника нет,
        // поэтому опознаём её независимо от того, виден ли её «хвост»-продолжение.
        var ids = {};
        (cuts || []).forEach(function(c) {
            if (c && (Number(c.plannedRuns) || 0) <= 0) ids[String(c.id)] = true;
        });
        return ids;
    }

    var DAY_START_MIN = 8 * 60;          // DAY_START_HOUR по умолчанию: 08:00
    var DAY_END_MIN = 17 * 60;           // DAY_END_HOUR по умолчанию: 17:00
    var SHIFT_START_MIN = DAY_START_MIN; // старый экспорт: начало окна резок
    var SHIFT_END_MIN = DAY_END_MIN - DEFAULT_OP_TIMES.CLEANUP_SHIFT; // старый экспорт: 16:30

    function parseClockMinutes(value, fallback) {
        var fb = Number(fallback);
        if (!isFinite(fb)) fb = 0;
        var s = String(value == null ? '' : value).trim();
        if (s === '') return fb;
        var hm = /^(\d{1,2})(?::(\d{1,2}))?$/.exec(s);
        if (hm) {
            var h = Number(hm[1]);
            var m = Number(hm[2] || 0);
            if (h >= 0 && h <= 23 && m >= 0 && m <= 59) return h * 60 + m;
            return fb;
        }
        var n = Number(s.replace(',', '.'));
        if (!isFinite(n) || n < 0) return fb;
        return n <= 24 ? Math.round(n * 60) : Math.round(n);
    }

    // #3342: длительность обеда из настройки LUNCH_DURATION — целое число минут
    // (например «40»). Пусто/некорректно/≤0 → 0 (обед выключен).
    function parseDurationMinutes(value) {
        var n = Number(String(value == null ? '' : value).replace(',', '.').trim());
        return isFinite(n) && n > 0 ? Math.round(n) : 0;
    }

    // #3847: лимит нахлёста из настройки (MAX_OVERWORK_CUTS/MAX_OVERWORK_TUNE) — целое число
    // минут ≥ 0. В отличие от parseDurationMinutes, ОТЛИЧАЕТ отсутствие (пусто/некорректно → null,
    // фича выключена) от заданного «0» (нахлёст запрещён, но ограничение активно). Отрицательное → null.
    function parseOverworkMinutes(value) {
        var s = String(value == null ? '' : value).replace(',', '.').trim();
        if (s === '') return null;
        var n = Number(s);
        return isFinite(n) && n >= 0 ? Math.round(n) : null;
    }

    // ---- #3989 Фаза 2 / #3992: настройки нового алгоритма (ТЗ §5, §14) ----------
    // Значение настройки по имени: приоритет ключа с суффиксом _MN (новый формат «Настройки»),
    // откат на имя без суффикса (старый формат). Пустое → fallback-ключ.
    function pickSetting(cfg, primary, fallback){
        var v = cfg ? cfg[primary] : undefined;
        if (v != null && String(v).trim() !== '') return v;
        return cfg ? cfg[fallback] : undefined;
    }
    function settingMinutes(cfg, baseName, fallback){
        var n = Number(pickSetting(cfg, baseName + '_MN', baseName));
        return isFinite(n) ? n : fallback;
    }
    // #3992: лимиты захлёста за конец смены (мин). Ключи получили суффикс _MN
    // (MAX_OVERWORK_CUTS_MN/MAX_OVERWORK_TUNE_MN), откат на старые имена. Пусто → null (выкл).
    // Задан только один — второй наследует его (общий смысл «допустимый нахлёст», #3847).
    function resolveOverworkLimits(settings){
        var cfg = settings || {};
        var cuts = parseOverworkMinutes(pickSetting(cfg, 'MAX_OVERWORK_CUTS_MN', 'MAX_OVERWORK_CUTS'));
        var tune = parseOverworkMinutes(pickSetting(cfg, 'MAX_OVERWORK_TUNE_MN', 'MAX_OVERWORK_TUNE'));
        return { cutsMin: cuts != null ? cuts : tune, tuneMin: tune != null ? tune : cuts };
    }
    // #3989 Фаза 2: явная длительность рабочего дня (мин), ТЗ §5. DAY_DURATION_MN (по умолч. 450).
    function resolveDayDurationMin(settings){ return settingMinutes(settings, 'DAY_DURATION', 450); }
    // #3989 Фаза 2: внутридневные паузы — два перерыва (FIRST_INTERVAL/SECCOND_INTERVAL по
    // INTERVAL_DURATION_MN) и обед — как НЕрабочие интервалы дня. Прозрачны для планирования (не
    // вычитаются из ёмкости), рисуются на Ганте (ТЗ §5). → отсортированный по началу
    // [{ startMin, durationMin, kind:'break'|'lunch', label }]. Не заданы → [].
    function intraDayBreaks(settings){
        var cfg = settings || {};
        var out = [];
        var intervalDur = settingMinutes(cfg, 'INTERVAL_DURATION', 10);
        function addBreak(startRaw, durMin, kind, label){
            if (startRaw == null || String(startRaw).trim() === '' || !(durMin > 0)) return;
            var m = parseClockMinutes(startRaw, NaN);
            if (isFinite(m)) out.push({ startMin: round3(m), durationMin: round3(durMin), kind: kind, label: label });
        }
        addBreak(cfg.FIRST_INTERVAL, intervalDur, 'break', 'Перерыв');
        // ТЗ пишет ключ с опечаткой SECCOND_INTERVAL — принимаем и корректное написание SECOND_INTERVAL.
        addBreak(pickSetting(cfg, 'SECCOND_INTERVAL', 'SECOND_INTERVAL'), intervalDur, 'break', 'Перерыв');
        addBreak(cfg.LUNCH_START, settingMinutes(cfg, 'LUNCH_DURATION', 0), 'lunch', 'Обед');
        out.sort(function(a, b){ return a.startMin - b.startMin; });
        return out;
    }

    function resolveWorkingWindow(settings, cleanupMin) {
        var cfg = settings || {};
        var start = parseClockMinutes(cfg.DAY_START_HOUR, DAY_START_MIN);
        var end = parseClockMinutes(cfg.DAY_END_HOUR, DAY_END_MIN);
        if (end <= start) end = DAY_END_MIN > start ? DAY_END_MIN : start + 1;
        var cleanup = Number(cleanupMin != null ? cleanupMin : DEFAULT_OP_TIMES.CLEANUP_SHIFT);
        if (!isFinite(cleanup) || cleanup < 0) cleanup = DEFAULT_OP_TIMES.CLEANUP_SHIFT;
        // #3599: резку планируем вплотную до DAY_END_HOUR − TOTAL_INTERVALS (буфер из
        // Настройки), а блок уборки идёт ПОСЛЕ DAY_END_HOUR (см. dayCleanups). Нет
        // TOTAL_INTERVALS → прежнее поведение (буфер = длительность уборки).
        var totalIntervals = parseDurationMinutes(cfg.TOTAL_INTERVALS);
        if (!(totalIntervals > 0)) totalIntervals = cleanup;
        var cutEnd = end - totalIntervals;
        if (cutEnd < start) cutEnd = start;
        // #3342: плавающий обед. LUNCH_START задан (HH:MM) → minutes, иначе null (обед выкл).
        var lunchDur = parseDurationMinutes(cfg.LUNCH_DURATION);
        var lunchStart = (cfg.LUNCH_START != null && String(cfg.LUNCH_START).trim() !== '' && lunchDur > 0)
            ? parseClockMinutes(cfg.LUNCH_START, NaN) : NaN;
        var hasLunch = isFinite(lunchStart) && lunchDur > 0;
        // #3847: максимальный нахлёст за конец рабочего дня (DAY_END_HOUR=endMin). Резку (проход)
        // можно положить с нахлёстом, только если она кончится ≤ DAY_END_HOUR+MAX_OVERWORK_CUTS;
        // настройку (ножи/смена сырья) — ≤ DAY_END_HOUR+MAX_OVERWORK_TUNE. Пусто/некорректно →
        // null (фича выключена: планировщик пакует до cutEndMin без сверхнормативного нахлёста).
        // #3992: лимиты захлёста читаем по новым ключам с суффиксом _MN (откат на старые имена).
        var over = resolveOverworkLimits(cfg);
        return {
            startMin: round3(start),
            endMin: round3(end),
            cutEndMin: round3(cutEnd),
            cleanupMin: round3(cleanup),
            lunchStartMin: hasLunch ? round3(lunchStart) : null,  // #3342: начало окна обеда (мин от полуночи)
            lunchDurationMin: hasLunch ? round3(lunchDur) : 0,    // #3342: длительность обеда (мин)
            // #3847: лимиты нахлёста (мин за DAY_END_HOUR); null = фича выключена. Если задан только
            // один — второй наследует его (общий смысл «допустимый нахлёст»), чтобы частичная
            // настройка не отключала ограничение целиком.
            maxOverworkCutsMin: over.cutsMin,
            maxOverworkTuneMin: over.tuneMin
        };
    }

    // #4563 (ТЗ §15): ПОТОЛОК ДНЯ — ОДНА ФУНКЦИЯ НА ВСЮ СИСТЕМУ. Решение заказчика 01.08.2026:
    // потолок = `cutEndMin` + нахлёст ПО ВИДУ ОПЕРАЦИИ (резка → MAX_OVERWORK_CUTS, настройка →
    // MAX_OVERWORK_TUNE). Другого правила нет ни у кого.
    //
    // ЗАЧЕМ ФУНКЦИЯ, А НЕ ФОРМУЛА НА МЕСТЕ. Формула «ёмкость дня» была переписана в коде ДЕВЯТЬ раз
    // независимо, и копии разошлись: одни прибавляли нахлёст НАСТРОЙКИ (страж DAY_CAPACITY, трасса
    // бейджа, раскрой), другие — нахлёст РЕЗКИ (planUnderfilledDays), третьи не прибавляли ничего
    // (слой размещения, генерация, выбор станка). На боевых настройках ateh это давало ТРИ разных
    // потолка одного дня — 450, 455 и 460, — и оператор видел то одно число, то другое.
    // Хуже: расхождение читалось как «новый баг» каждый раз, когда две копии встречались в одном
    // сценарии (#4559 — обед, #4561 — цепочка из прошлого): одна половина системы кричит
    // «переполнен», вторая отвечает «влезает», и кнопка не помогает.
    //
    // win — объект `resolveWorkingWindow` (или любой с теми же полями). kind: 'cuts' (по умолчанию)
    // | 'tune'. → dayCeilingMin: абсолютная минута от полуночи, позже которой операция идти не
    // вправе; dayCapacityMinutes: сколько минут РАБОТЫ помещается в день (потолок − начало − обед).
    // Обед вычитается всегда: станок на него встаёт (#3342/#3816), это не свободные минуты (#4559).
    // Новое правило потолка добавляется ровно сюда; сторож `atex-pp-4563-one-day-ceiling.test.js`
    // краснеет, если формулу снова напишут на месте.
    function dayCeilingMin(win, kind) {
        var cutEnd = Number(win && win.cutEndMin);
        if (!isFinite(cutEnd)) return NaN;
        var over = Number(kind === 'tune' ? (win && win.maxOverworkTuneMin) : (win && win.maxOverworkCutsMin));
        return round3(cutEnd + (isFinite(over) ? over : 0));
    }
    function dayCapacityMinutes(win, kind) {
        var ceil = dayCeilingMin(win, kind);
        if (!isFinite(ceil)) return 0;
        var cap = ceil - (Number(win && win.startMin) || 0) - (Number(win && win.lunchDurationMin) || 0);
        return cap > 0 ? round3(cap) : 0;
    }
    // Окно из опций планировщика (dayStartMin/dayEndMin/…) в вид `resolveWorkingWindow`: у движка
    // `dayEndMin` — это и есть `cutEndMin` (потолок резки, см. planCutOperations), поля называются
    // иначе, а правило потолка обязано остаться одним.
    function windowFromOpts(opts) {
        return { startMin: Number(opts && opts.dayStartMin) || 0,
                 cutEndMin: Number(opts && opts.dayEndMin),
                 lunchDurationMin: Number(opts && opts.lunchDurationMin) || 0,
                 maxOverworkCutsMin: Number(opts && opts.maxOverworkCutsMin) || 0,
                 maxOverworkTuneMin: Number(opts && opts.maxOverworkTuneMin) || 0 };
    }

    // #3764: окна «Отпуска» станка → блокированные интервалы в МИНУТАХ от полуночи дня 0
    // (той же оси, что startMin/windowStartMin расписания). downtimes — [{ start, end }]
    // в unix-секундах (start — главное значение записи, end — «Окончание»). baseMidnightMs —
    // полночь дня 0 (planBaseMidnightFrom). Возвращает отсортированный по началу массив
    // [[startMin, endMin], …]; пустые/перевёрнутые/полностью прошедшие до базы окна отброшены.
    function downtimeBlockedRanges(downtimes, baseMidnightMs) {
        var base = Number(baseMidnightMs);
        if (!isFinite(base)) return [];
        var out = [];
        (downtimes || []).forEach(function(d) {
            var s = Number(d && d.start), e = Number(d && d.end);
            if (!isFinite(s) || s <= 0) return;
            // Без «Окончания» окно не ограничено по верху — игнорируем (нечего блокировать осмысленно).
            if (!isFinite(e) || e <= s) return;
            var sMin = (s * 1000 - base) / 60000;
            var eMin = (e * 1000 - base) / 60000;
            if (eMin <= 0) return;   // окно целиком до дня 0 — на план не влияет
            out.push([sMin, eMin]);
        });
        out.sort(function(a, b) { return a[0] - b[0]; });
        return out;
    }

    // #4413: задания, СТОЯЩИЕ в окне «Отпуска» своего станка (или в нерабочем дне) — станок в это
    // время не работает, выполнить их нельзя. Это НЕ «дорого», а НЕВОЗМОЖНО: такое нарушение старше
    // и срока, и переналадки, поэтому «Упорядочить» обязано применить план, который его снимает,
    // даже когда опоздания и переналадка не изменились (issue #4413: «Отпуск» добавили перед
    // запуском, задание осталось стоять внутри него, а кнопка ответила «просрочка не устранена»).
    // items — [{ id, slitterId, windowStartMin, occMin }] (минуты от полуночи дня 0, та же ось, что
    // blockedRangesBySlitter #3764); occMin — занятость станка заданием (наладка + резка), 0 — считаем
    // точкой старта. blockedBySlitter — { slitterId: [[s, e], …] }.
    // → массив id заданий-нарушителей В ПОРЯДКЕ items. Чистая — покрыта тестом.
    function downtimeConflictCuts(items, blockedBySlitter) {
        var map = blockedBySlitter || {};
        var out = [];
        (items || []).forEach(function(it) {
            if (!it) return;
            var ranges = map[String(it.slitterId == null ? '' : it.slitterId)];
            if (!ranges || !ranges.length) return;
            var ws = Number(it.windowStartMin);
            if (!isFinite(ws)) return;
            var occ = Math.max(0, Number(it.occMin) || 0);
            for (var i = 0; i < ranges.length; i++) {
                var bS = Number(ranges[i][0]), bE = Number(ranges[i][1]);
                if (!(bE > bS)) continue;
                // Окно задания [ws, ws+occ] пересекает простой (нулевую занятость меряем точкой старта).
                var hit = occ > 0 ? (ws < bE && ws + occ > bS) : (ws >= bS && ws < bE);
                if (hit) { out.push(String(it.id)); return; }
            }
        });
        return out;
    }

    // #3876: на отпуске ли станок ВЕСЬ рабочий день. downtimes — окна простоя [{ start, end }]
    // в unix-секундах (start — начало «Отпуска», end — «Окончание»), как
    // this.downtimesBySlitter[slitterId]. dayMidnightMs — полночь дня (локально). workStartMin/
    // workEndMin — рабочее окно резки (мин от полуночи: startMin..cutEndMin).
    //
    // #3883: true ТОЛЬКО если закрытые окна отпуска ПОЛНОСТЬЮ покрывают рабочее окно [workStart;
    // workEnd] этого дня. ЧАСТИЧНЫЙ отпуск (напр. 2 часа 08:00–10:00) день НЕ блокирует — станок
    // работает остаток дня, а расписание само сдвигает резки за окно простоя (#3764,
    // shiftPlacementsPastDowntime). Раньше любое пересечение суток считалось «весь день в отпуске»,
    // и 2-часовое окно исключало станок из планирования совсем (Гант пустой во все дни). Окна без
    // «Окончания» игнорируем (как в расписании). Рабочее окно не задано → проверяем сутки [0;1440].
    function slitterDownOnDay(downtimes, dayMidnightMs, workStartMin, workEndMin) {
        var base = Number(dayMidnightMs);
        if (!isFinite(base)) return false;
        var wsMin = isFinite(Number(workStartMin)) ? Number(workStartMin) : 0;
        var weMin = isFinite(Number(workEndMin)) ? Number(workEndMin) : 1440;
        var ws = base + wsMin * 60000, we = base + weMin * 60000;
        if (!(we > ws)) return false;
        var ivs = [];
        (downtimes || []).forEach(function(d) {
            var s = Number(d && d.start), e = Number(d && d.end);
            if (!isFinite(s) || s <= 0 || !isFinite(e) || e <= s) return;   // без «Окончания» — не учитываем
            var a = Math.max(ws, s * 1000), b = Math.min(we, e * 1000);
            if (b > a) ivs.push([a, b]);
        });
        if (!ivs.length) return false;
        ivs.sort(function(x, y) { return x[0] - y[0]; });
        var cur = ws;
        for (var i = 0; i < ivs.length; i++) {
            if (ivs[i][0] > cur) return false;     // дыра в покрытии → есть рабочее время
            if (ivs[i][1] > cur) cur = ivs[i][1];
            if (cur >= we) return true;
        }
        return cur >= we;
    }

    // #3898: полночь (локального) дня для метки в мс. Шкала календарная — как dayKeyFromMs.
    function startOfDayMs(ms) {
        var d = new Date(Number(ms));
        if (isNaN(d.getTime())) return NaN;
        d.setHours(0, 0, 0, 0);
        return d.getTime();
    }

    // #3898: длина окна отпуска [startSec; endSec] (unix-сек) в КАЛЕНДАРНЫХ днях — сколько
    // суток станок простаивает. Считаем от полуночи дня «начала» до полуночи последнего
    // ПОКРЫТОГО дня включительно; «Окончание» ровно в 00:00 нового дня этот день не добавляет
    // (−1 мс). Примеры: 02.07 08:00→18:00 = 1; 02.07→04.07 00:00 = 2; 02.07 08:00→04.07 10:00 = 3.
    function downtimeSpanDays(startSec, endSec) {
        var s = Number(startSec) * 1000, e = Number(endSec) * 1000;
        if (!isFinite(s) || !isFinite(e) || e <= s) return 0;
        var sd = startOfDayMs(s), ed = startOfDayMs(e - 1);
        if (isNaN(sd) || isNaN(ed)) return 0;
        return Math.round((ed - sd) / 86400000) + 1;
    }

    // #3898: максимальная длина (в КАЛЕНДАРНЫХ днях) закрытого окна «Отпуска», накрывающего
    // сутки дня dayMidnightMs. Отпуск = одна запись окна [начало; окончание]; если простой
    // разбит на несколько записей — берём наибольшую из накрывающих день базы. 0 — день не
    // накрыт ни одним окном. downtimes — [{ start, end }] в unix-секундах.
    function vacationSpanDaysOnDay(downtimes, dayMidnightMs) {
        var base = Number(dayMidnightMs);
        if (!isFinite(base)) return 0;
        var dayEnd = base + 86400000, maxDays = 0;
        (downtimes || []).forEach(function(d) {
            var s = Number(d && d.start), e = Number(d && d.end);
            if (!isFinite(s) || s <= 0 || !isFinite(e) || e <= s) return;
            if (!(s * 1000 < dayEnd && e * 1000 > base)) return;   // окно не накрывает день базы
            var span = downtimeSpanDays(s, e);
            if (span > maxDays) maxDays = span;
        });
        return maxDays;
    }

    // #3788: «ДД.ММ.ГГГГ» → числовой ключ дня ГГГГММДД (для карты календаря). null — мусор.
    function parseDmyKey(str) {
        var m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(String(str == null ? '' : str).trim());
        return m ? (Number(m[3]) * 10000 + Number(m[2]) * 100 + Number(m[1])) : null;
    }

    // #3788: миллисекунды → ключ дня ГГГГММДД (локальный день).
    function dayKeyFromMs(ms) {
        var d = new Date(Number(ms));
        if (isNaN(d.getTime())) return null;
        return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
    }

    // #3788: рабочий ли день. calendarByDay: { ГГГГММДД: 'Праздничный день'|'Рабочий день' }
    // (исключения); dow — день недели (0=Вс … 6=Сб). «Рабочий день» делает выходной рабочим,
    // «Праздничный день» — будни нерабочим; иначе обычное правило (Сб/Вс — выходные).
    function dayTypeWorking(dayKey, dow, calendarByDay) {
        var t = calendarByDay && calendarByDay[dayKey];
        if (t === DAY_TYPE_WORKING) return true;
        if (t === DAY_TYPE_HOLIDAY) return false;
        return dow !== 0 && dow !== 6;
    }

    // #3788: рабочий ли календарный день (по мс). Пустая/битая дата → считаем рабочим (не блокируем).
    function dayIsWorking(ms, calendarByDay) {
        var d = new Date(Number(ms));
        if (isNaN(d.getTime())) return true;
        return dayTypeWorking(dayKeyFromMs(d.getTime()), d.getDay(), calendarByDay);
    }

    // #3788: нерабочие (выходные/праздничные) дни горизонта [0..horizonDays] от базы →
    // блокированные интервалы в МИНУТАХ от полуночи дня 0 (та же ось, что blockedRanges #3764).
    // Каждый нерабочий день — целиком [d*1440, (d+1)*1440]; смежные дни СЛИВАЮТСЯ в один
    // интервал (выходные+праздники подряд → один блок, меньше работы свипу). Пустой calendarByDay
    // → блокируются только Сб/Вс. baseMidnightMs нечисловой → []. Вход не мутирует.
    function calendarBlockedRanges(calendarByDay, baseMidnightMs, horizonDays) {
        var base = Number(baseMidnightMs);
        if (!isFinite(base)) return [];
        var bd = new Date(base);
        if (isNaN(bd.getTime())) return [];
        var H = Math.max(0, Number(horizonDays) || 0);
        var offs = [];
        for (var d = 0; d <= H; d++) {
            // setDate(+d) — корректный календарный день (без накопления через DST, в МСК DST нет).
            var day = new Date(bd.getFullYear(), bd.getMonth(), bd.getDate() + d, 0, 0, 0, 0);
            if (!dayTypeWorking(dayKeyFromMs(day.getTime()), day.getDay(), calendarByDay)) offs.push(d);
        }
        var out = [];
        for (var i = 0; i < offs.length; ) {
            var s = offs[i], e = offs[i];
            while (i + 1 < offs.length && offs[i + 1] === e + 1) { e = offs[++i]; }
            out.push([s * 1440, (e + 1) * 1440]);   // целые сутки; стык на полуночь сольёт соседние
            i++;
        }
        return out;
    }

    // #3788: слить два набора блокированных интервалов (минуты от базы) в один отсортированный
    // массив (окна простоя станка #3764 ∪ нерабочие дни календаря). Дубли не схлопываем —
    // свип (nextFreeWorkMinute) корректно работает с перекрытиями.
    function mergeBlockedRanges(a, b) {
        var out = (a || []).concat(b || []);
        out.sort(function(x, y) { return x[0] - y[0]; });
        return out;
    }

    // #3764: рабочее окно дня для абсолютной минуты от полуночи дня 0. Если минута до начала
    // окна (ночь/утро) — подтягиваем к dayStart; если в/после конца окна — к dayStart следующего
    // дня. blocked — отсортированные [[s,e],…]. Возвращает ближайшую минуту ≥ from, которая
    // (а) внутри рабочего окна и (б) не попадает в блокированный интервал; для сегмента длиной
    // len ещё и (в) ни один блок не НАЧИНАЕТСЯ внутри [m, m+len) (иначе сегмент въехал бы в
    // простой — выталкиваем целиком за конец блока). Итераций ≤ числа блоков + дни (ограничено).
    // #3907: fitEnd (необяз.) — предел, до которого сегмент должен ЗАКОНЧИТЬСЯ (конец смены с
    // учётом нахлёста-овертайма). Задан → сегмент, чей конец (start+len) выходит за fitEnd, но
    // сам влезающий в рабочее окно дня, переносится на начало СЛЕДУЮЩЕГО рабочего дня (а не
    // оставляется с нахлёстом за смену). Не задан → прежнее поведение (проверяли только старт).
    // dayEnd по-прежнему граница, ПОСЛЕ которой новый сегмент не начинают.
    // #4434 п.1: keepDay — сегмент ОБЯЗАН остаться в своём дне (зафиксированное 🔒 задание). Тогда ни
    // потолок нахлёста, ни граница «после dayEnd новый сегмент не начинают» его с дня не выталкивают:
    // замок дня абсолютен, перегруз дня допустим. Блоки простоя (нерабочий день/«Отпуск») по-прежнему
    // обходятся — там разместить физически нечего.
    function nextFreeWorkMinute(from, len, blocked, dayStart, dayEnd, fitEnd, movedInit, skipCeiling, keepDay) {
        var m = Number(from);
        var L = Number(len) || 0;
        var hasFit = (fitEnd != null && isFinite(Number(fitEnd)));
        var endLimit = hasFit ? Number(fitEnd) : 0;
        var dayCap = endLimit - dayStart;   // длина рабочего окна дня (с овертаймом)
        // #3934: потолок нахлёста (fitEnd, #3907) применяем ТОЛЬКО к сегменту, СДВИНУТОМУ простоем —
        // блоком либо встык-курсором (movedInit). Сегмент, НЕ сдвинутый простоем, splitMachineQueue
        // положил в хвост дня с НАМЕРЕННЫМ нахлёстом (#3635 п.5/#3739/#3805 — «настройка в хвосте
        // дня N, резка с дня N+1»); выталкивать его на начало след. дня по потолку нельзя — иначе он
        // уезжает ПОВЕРХ своего продолжения («настройка в начале дня» + бейдж дня растёт, issue #3934).
        var moved = !!movedInit;
        // #3907: с переносом за конец дня итераций больше (пропуск целых дней) — запас увеличен.
        var guard = 0, guardMax = (blocked || []).length * 2 + 768;
        while (guard++ < guardMax) {
            var day = Math.floor(m / 1440);
            var within = m - day * 1440;
            if (within < dayStart) { m = day * 1440 + dayStart; continue; }
            if (within >= dayEnd && !keepDay) { m = (day + 1) * 1440 + dayStart; moved = true; continue; }
            // #3907: сегмент должен влезть в рабочее окно дня ЦЕЛИКОМ. Конец за fitEnd, а сам
            // сегмент в день влезает (L ≤ dayCap) → на начало следующего дня. Только для сдвинутого
            // простоем сегмента (#3934). Сегмент длиннее целого окна разбить нельзя — кладём как есть.
            // #4021: setup-only хвост дня (skipCeiling) — намеренный нахлёст #3635 п.5, потолком НЕ
            // выталкиваем (иначе встык-курсор, нудживший хвост на 1 мин, делал movedInit=true и хвост
            // уезжал за конец смены — а перед выходными за все выходные, оседая ОДИНОКОЙ наладкой на
            // понедельник и вытесняя #3951 весь дневной объём на вторник: день «недогружен, только наладка»).
            // Блоки простоя (ниже) хвост по-прежнему обходит; выталкивание касается лишь проходов (#3907).
            if (moved && !skipCeiling && !keepDay && hasFit && (within + L > endLimit) && (L <= dayCap)) { m = (day + 1) * 1440 + dayStart; continue; }
            var bumped = false;
            for (var i = 0; i < (blocked || []).length; i++) {
                var bS = blocked[i][0], bE = blocked[i][1];
                // m внутри блока, либо блок начинается в пределах занимаемого сегментом окна.
                if ((bS <= m && m < bE) || (m < bS && bS < m + L)) {
                    if (bE > m) { m = bE; bumped = true; moved = true; break; }
                }
            }
            if (!bumped) return m;
        }
        return m;
    }

    // #3764: общий проход — сдвигает уже построенные размещения за окна «Отпуска» станка,
    // сохраняя порядок. items — массив; acc — аксессоры { windowStart, length, shift } чтения
    // окна-старта (минуты), длины (setup+намотка) и применения сдвига (delta) к элементу. blocked
    // — отсортированные [[s,e],…] (минуты от полуночи дня 0). Сохраняет встык-упаковку (курсор =
    // конец предыдущего): резку, сдвинутую простоем, догоняют следующие. Пустой blocked → no-op.
    function shiftPlacementsPastDowntime(items, blocked, dayStart, dayEnd, acc, fitEnd) {
        if (!blocked || !blocked.length || !items || !items.length) return items;
        var cursor = -Infinity;
        var prevOrigDay = null, prevPlacedDay = null;   // #3951: сохранение границ дней при сдвиге
        items.forEach(function(it) {
            var origWs = acc.windowStart(it);
            var origDay = Math.floor(origWs / 1440);
            var ws = origWs;
            if (ws < cursor) ws = cursor;
            // #3951: сегмент, исходно стоявший на БОЛЕЕ ПОЗДНЕМ дне, чем предыдущий, обязан и после
            // сдвига за простой оказаться на более позднем дне. Иначе встык-курсор паковал продолжение
            // разбитой по дням резки в ХВОСТ дня её первой части (после длинного «Отпуска» день-сплит
            // схлопывался в один день → бейдж дня за ёмкость: 490 при 460, а следующий день недобирал,
            // issue #3951). Сегменты одного исходного дня по-прежнему пакуются встык (заполняют день).
            if (prevPlacedDay != null && prevOrigDay != null && origDay > prevOrigDay) {
                var nextDayStart = (prevPlacedDay + 1) * 1440 + dayStart;
                if (ws < nextDayStart) ws = nextDayStart;
            }
            var len = acc.length(it);
            // #3934: сегмент «сдвинут простоем» уже если встык-курсор поднял его старт (предыдущий
            // уехал за простой) — тогда к нему применяем потолок нахлёста (#3907); сегмент на своём
            // месте (не тронут ни блоком, ни курсором) оставляем как есть (намеренный хвост дня).
            var cursorMoved = (ws !== origWs);
            // #4021: setup-only хвост — намеренный нахлёст (#3635 п.5), потолок нахлёста к нему не
            // применяем (иначе одиночная наладка уезжает за выходные, недогружая день). acc.overhangTail
            // необязателен; нет — прежнее поведение.
            var skipCeiling = acc.overhangTail ? !!acc.overhangTail(it) : false;
            // #3907: fitEnd — не оставлять сегмент с нахлёстом за смену (см. nextFreeWorkMinute).
            var keepDay = acc.keepDay ? !!acc.keepDay(it) : false;   // #4434 п.1: 🔒 остаётся в своём дне
            var placed = nextFreeWorkMinute(ws, len, blocked, dayStart, dayEnd, fitEnd, cursorMoved, skipCeiling, keepDay);
            var delta = placed - origWs;
            if (delta !== 0) acc.shift(it, delta);
            cursor = placed + len;
            prevOrigDay = origDay;
            prevPlacedDay = Math.floor(placed / 1440);
        });
        return items;
    }

    // Расписание очереди (по порядку): для каждой резки — старт/финиш в минутах от
    // полуночи дня 0 (через сутки — следующий рабочий день). setup перед резкой = лидер
    // (BETWEEN_CUTS × число резок цуга, #3401) + переналадка с предыдущей (changeoverCost, мин); длительность =
    // намотка прогона × «Кол-во план» либо сохранённая «Длительность, минут» как
    // fallback. Рабочее окно дня — [shiftStartMin, shiftEndMin] (08:00–16:30);
    // резка, не влезающая до конца окна, переносится на 08:00 следующего дня.
    // opts: { windPoints, times, shiftStartMin, shiftEndMin,
    // runLengthByCut:{cutId:метры}, blockedRanges:[[s,e],…] (#3764) }. Вход не мутирует.
    function buildSchedule(cuts, opts){
        opts = opts || {};
        var wind = opts.windPoints || [];
        var times = opts.times || DEFAULT_OP_TIMES;
        var leader = Number(times.BETWEEN_CUTS != null ? times.BETWEEN_CUTS : DEFAULT_OP_TIMES.BETWEEN_CUTS) || 0;
        var runLen = opts.runLengthByCut || {};
        var shiftStart = Number(opts.shiftStartMin != null ? opts.shiftStartMin : SHIFT_START_MIN) || 0;
        var shiftEnd = Number(opts.shiftEndMin != null ? opts.shiftEndMin : SHIFT_END_MIN) || 0;
        var hasWindow = shiftEnd > shiftStart;
        // #3342: плавающий обед. Пока обед дня не вставлен, в конце окна резервируем
        // lunchDur (день закончится раньше, если обед не удалось встроить между резками).
        var lunch = lunchParams(opts, shiftStart, shiftEnd);
        var lunchDone = {};
        var t = shiftStart;   // день 0, начало смены
        var out = [];
        var setupIds = opts.setupTaskIds || {};   // #3635 п.5: сегменты настройки — намотка 0
        var anchorByCut = opts.dayAnchorByCut || {};   // #3652: якорь дня по «Дате план»
        // #3805: остаток настройки setup-only-сегмента (хвост дня N), который переносится на
        // его продолжение (день N+1) — keyed по continuationSignature цепочки.
        var carrySetupBySig = {};
        (cuts || []).forEach(function(c, i){
            // #3652: привязать резку к её рабочему дню «Даты план» — если очередь не дотянула
            // до этого дня, прыгаем вперёд к его началу (08:00). Иначе при ДИАПАЗОНЕ дат «С–По»
            // задания одного дня (напр. 30.05) ложились под дату «С» (напр. 20.05). Назад не
            // двигаем (переполнение предыдущих сохраняется); резки без «Даты план» — без якоря.
            var anchorDay = anchorByCut[String(c && c.id)];
            if (anchorDay != null && anchorDay > Math.floor(t / 1440)) {
                t = anchorDay * 1440 + shiftStart;
            }
            // #3688: ПЕРЕД резкой — только переналадка (ножи + смена сырья), БЕЗ лидера. Лидер
            // («лидер между резками») заправляют В КОНЦЕ каждой резки → он добавляется ПОСЛЕ
            // намотки (leaderMin), а не в стартовый сетап. Для первой резки очереди (i===0)
            // переналадка считается от текущей заправки станка (opts.carryPrevCut — из отчёта
            // заправка станка: тот же материал/намотка/ножи → 0); нет данных → настройка ножей
            // с нуля (#3669, firstCutSetup).
            var setup = i > 0
                ? changeoverCost(cuts[i-1], c, times)
                : (opts.carryPrevCut ? changeoverCost(opts.carryPrevCut, c, times)
                                     : (opts.firstCutSetup ? firstSetupCost(c, times) : 0));
            // #3805: продолжение setup-only-сегмента (тот же день N+1) несёт остаток настройки,
            // не уместившийся в хвост дня N (changeoverCost между ними = 0, т.к. конфигурация та же).
            var carrySig = continuationSignature(c);
            if (carrySetupBySig[carrySig] != null) {
                setup = round3(setup + carrySetupBySig[carrySig]);
                delete carrySetupBySig[carrySig];
            }
            // #3688: лидер в конце резки. #4021: setup-only сегмент (0 проходов, хвост дня) намотки и
            // лидера не несёт — иначе окно/бейдж дня прибавляли фантомный BETWEEN_CUTS (см. computeCutSetupUpdates).
            var leaderMin = setupIds[String(c && c.id)] ? 0 : leader * cutLeaderRuns(c);
            var dur = setupIds[String(c && c.id)] ? 0 : scheduleDurationMinutes(c, Number(runLen[String(c.id)]) || 0, wind);
            // #3562: задания пакуются встык по очереди. Зафиксированные больше не «прикалываются»
            // к плановому старту — автогенерация двигает их по времени в течение дня и меняет
            // очередность (пины #3508 п.6 убраны).
            var start = t + setup;
            var day = Math.floor(start / 1440);
            if (start < day * 1440 + shiftStart) start = day * 1440 + shiftStart;   // до 08:00 → ждём открытия
            // #3342: резка стартует в/после LUNCH_START и обед ещё не был → пауза перед ней.
            if (lunch && !lunchDone[day] && (start - day * 1440) >= lunch.startMin) {
                start += lunch.durationMin;
                lunchDone[day] = true;
            }
            // не влезает до конца окна (резерв обеда, если не вставлен) → 08:00 след. дня.
            // #3688: в окно должны влезть резка И лидер после неё (станок занят до конца лидера).
            // #3739/#3760: при gapFill нахлёст за конец смены ограничен ОДНИМ шагом — резку,
            // чьё ОКНО (начало настройки = start − setup) уже за концом смены, выталкиваем на
            // следующий день; резка, начавшаяся в пределах смены, может выйти за край (один
            // нахлёст), но следующая за ней уйдёт на завтра. Так тайминг не накапливается в ночь.
            var fitEnd = day * 1440 + shiftEnd - ((lunch && !lunchDone[day]) ? lunch.durationMin : 0);
            var pushNextDay = opts.gapFill ? ((start - setup) >= fitEnd) : (start + dur + leaderMin > fitEnd);
            if (hasWindow && pushNextDay) {
                day += 1;
                start = day * 1440 + shiftStart + setup;
                if (lunch && !lunchDone[day] && (start - day * 1440) >= lunch.startMin) {
                    start += lunch.durationMin;
                    lunchDone[day] = true;
                }
            }
            // #3805: setup-only-сегмент (#3635 п.5), чья настройка вылезает за конец смены, —
            // в хвост дня кладём только МИНИМАЛЬНОЕ подмножество компонентов настройки
            // (minOverlapTailSetupMinutes, как splitMachineQueue), а остаток переносим на
            // продолжение (день N+1). Иначе вся настройка (напр. ножи+сырьё=45) копилась бы в
            // дне N, и сумма за день вылетала за рамки «смена + один шаг наладки» (#3805: 495
            // мин при максимуме ~480). Считаем по окну ДО смещения на след. день (pushNextDay
            // не сработал, иначе настройка влезает целиком в свежий день — дробить нечего).
            var fitEndForDay = day * 1440 + shiftEnd - ((lunch && !lunchDone[day]) ? lunch.durationMin : 0);
            if (hasWindow && setupIds[String(c && c.id)] && setup > 0 && start > fitEndForDay) {
                var windowStartMin = start - setup;            // начало настройки (= t после якоря)
                var availTail = fitEndForDay - windowStartMin; // остаток смены до её конца
                if (availTail > 0) {
                    var setupParts = i > 0 ? changeoverParts(cuts[i-1], c, times)
                        : (opts.carryPrevCut ? changeoverParts(opts.carryPrevCut, c, times)
                            : (opts.firstCutSetup ? firstSetupParts(c, times) : []));
                    var tailSetup = minOverlapTailSetupMinutes(setupParts, availTail, setup);
                    if (tailSetup < setup) {
                        carrySetupBySig[carrySig] = round3(setup - tailSetup);
                        setup = round3(tailSetup);
                        start = round3(windowStartMin + setup);
                    }
                }
            }
            // #3816: резка, ПЕРЕСЕКАЮЩАЯ окно обеда (намотка стартует ДО LUNCH_START и идёт
            // через него), — станок паузит на обед В ХОДЕ намотки. Раньше обед вставлялся
            // паузой только перед резкой, СТАРТУЮЩЕЙ в/после LUNCH_START (см. выше), поэтому
            // длинная резка через обед шла без паузы: день «работал сквозь обед», конец дня
            // приходился на ~16:22 вместо ~17:00, а сумма за день получалась как целое окно без
            // вычета обеда (#3816: 502 мин при ёмкости 450). Сдвигаем финиш намотки на
            // длительность обеда (намотка прерывается на обед), обед помечаем вставленным;
            // durationMin (минуты РАБОТЫ, основа бейджа дня) не меняется — захлёст #3760 сохранён.
            var lunchGap = 0;
            if (lunch && !lunchDone[day] && dur > 0) {
                var nStartInDay = start - day * 1440;
                if (nStartInDay < lunch.startMin && (nStartInDay + dur) > lunch.startMin) {
                    lunchGap = lunch.durationMin;
                    lunchDone[day] = true;
                }
            }
            var finish = start + dur + lunchGap;
            // #3688: окно-старт = startMin − setupMin (без лидера); leaderMin — лидер после намотки.
            out.push({ cutId: String(c.id), startMin: round3(start), finishMin: round3(finish), setupMin: round3(setup), durationMin: dur, leaderMin: round3(leaderMin) });
            t = finish + leaderMin;   // #3688: следующая резка стартует после лидера текущей (#3816: после обеда, если он попал в эту резку)
        });
        // #3764: вынести задания за окна «Отпуска» станка (ТО и т.п.). Окно занимает
        // [windowStart, +setup+намотка+лидер]; пустой blockedRanges → no-op (поведение прежнее).
        // #3816: длину окна берём из finishMin (= setup + намотка + ОБЕД, если он попал в резку)
        // + лидер, иначе у резки через обед окно занятости было бы на длительность обеда короче.
        // Для резок без обеда finishMin − startMin = durationMin — поведение прежнее.
        if (hasWindow) shiftPlacementsPastDowntime(out, opts.blockedRanges, shiftStart, shiftEnd, {
            windowStart: function(o) { return o.startMin - o.setupMin; },
            length: function(o) { return o.setupMin + (o.finishMin - o.startMin) + o.leaderMin; },
            shift: function(o, delta) { o.startMin = round3(o.startMin + delta); o.finishMin = round3(o.finishMin + delta); }
        });
        return out;
    }

    // #3846: показываем СОХРАНЁННЫЙ план БЕЗ live-пересчёта. Единый источник правды с РМ
    // «Диаграмма Ганта (задания)»: и очередь production-planning, и cut-gantt берут одни и те
    // же записанные поля резки, поэтому времена/минуты ВСЕГДА совпадают (раньше очередь
    // пересчитывала расписание через buildSchedule на каждый рендер и расходилась с сохранённым:
    // другая наладка — firstCutSetup вместо реальной заправки станка — и неучтённый обед).
    // Тайминг строим из полей, записанных ГЕНЕРАЦИЕЙ: planStart (главное значение, t1078 —
    // окно/начало настройки), сохранённая наладка (ножи + смена сырья) и «Резка и Лидер»
    // (#3700: намотка + лидер). Обед (#3342) уже учтён в сохранённых planStart (генерация
    // сдвинула старты послеобеденных резок) — на показе он отдельный блок (lunchBlocksFromSchedule).
    // Форма результата совпадает с buildSchedule: { cutId, startMin, finishMin, setupMin,
    // durationMin, leaderMin } в минутах от полуночи дня 0 (baseMidnightMs); лидер входит в
    // durationMin (отдельной leaderMin нет — окно = setup + durationMin).
    function scheduleFromStored(cuts, baseMidnightMs) {
        var base = Number(baseMidnightMs);
        function num(v) { return (v == null || v === '') ? 0 : (Number(v) || 0); }
        // #3885: сохранённые planStart двух резок ОДНОГО станка в один день могут совпасть
        // (напр. обе t1078 = 08:00) — след незавершённой пересборки времени старта: перенос
        // до #3840 не пересобирал planStart, а пересборка #3660 идёт только в scope фильтра, и
        // «осиротевший» старт остаётся прежним. Раньше очередь пересчитывала расписание на лету
        // (buildSchedule) и нахлёст не показывала; с #3846 (показ сохранённого) две карточки
        // вставали в одно время. Раскладываем встык: старт ОКНА резки не раньше конца окна
        // предыдущей резки ЭТОГО дня. Непересекающиеся сохранённые старты не трогаем (display ==
        // сохранённое).
        //
        // #3920: анти-нахлёст обрабатываем СТРОГО ПО ВРЕМЕНИ сохранённого planStart, а НЕ в
        // порядке «Очередности», в котором резки приходят из groupBySlitter. После scope-огра-
        // ниченной пересборки (#3660) «Очередность» и planStart могут разойтись: застрявшая резка
        // с ранней «Очередностью», но поздним planStart (напр. хвостовая настройка на 15:58, тогда
        // как остальные резки дня стоят с 08:00). Анти-нахлёст forward-only: попав в обработку
        // ПЕРВОЙ (по «Очередности»), такая резка выталкивала за собой ВСЕ резки дня в овертайм
        // (день лез до 23:15 — issue #3920). По времени planStart страница совпадает с РМ «Диаграмма
        // Ганта», которая рисует бары по сохранённому planStart без пересчёта (#3846: обе РМ — один
        // источник, сохранённые поля): резка стоит там, где записана, а не выталкивает соседей.
        var items = [];
        (cuts || []).forEach(function(c) {
            if (!c) return;
            var tsSec = Number(c.planDate != null && c.planDate !== '' ? c.planDate : c.number);
            if (!isFinite(tsSec) || tsSec <= 0 || !isFinite(base)) return;   // нет planStart — нечего ставить на ось
            // #4572: у ВЫПОЛНЕННОГО задания окно заканчивается «Закончено» — это уже не план, а
            // запись о том, что было. Иначе расчётная длина (наладка + резки) вылезала за фактическое
            // окно и карточки налезали друг на друга.
            var factEndSec = planTsSeconds(c.endDate);
            items.push({
                cutId: String(c.id),
                windowStartMin: round3((tsSec * 1000 - base) / 60000),   // окно = начало настройки
                factEndMin: factEndSec == null ? null : round3((factEndSec * 1000 - base) / 60000),
                setupMin: round3(num(c.storedKnifeSetupMin) + num(c.storedMaterialWindingMin)),
                durationMin: round3(num(c.storedCutAndLeaderMin) || num(c.duration))   // намотка + лидер
            });
        });
        // #3920: по сохранённому старту окна (возр.); равные — стабильно в исходном порядке очереди.
        items.forEach(function(it, i) { it._i = i; });
        items.sort(function(a, b) { return (a.windowStartMin - b.windowStartMin) || (a._i - b._i); });
        var out = [];
        items.forEach(function(it) {
            // #4099: РИСУЕМ КАК ЕСТЬ. Раньше нахлёст сохранённых окон одного дня разносился встык
            // (#3885/#3920) — это скрывало переполнение дня (сумма > смены), превращая его в цуг,
            // уходящий далеко за конец смены. Заказчик (#4099): «нефиг сжимать/растягивать — рисуй
            // как есть». Ставим окно по СОХРАНЁННОМУ старту без сдвига: перекрытие видно как есть,
            // сразу ясно, что на день назначено больше работы, чем влезает в смену.
            var windowStartMin = it.windowStartMin;
            var startMin = round3(windowStartMin + it.setupMin);            // старт намотки (после настройки)
            var finishMin = round3(startMin + it.durationMin);
            var durationMin = it.durationMin;
            // #4572: выполненное — только УКОРАЧИВАЕМ до «Закончено». Удлинять фактом нельзя: это
            // вернуло бы наложения, от которых ушли (#4334 — факт не растягивает плановое окно).
            // Наладка внутри окна остаётся: она тоже была, режется хвост намотки.
            if (it.factEndMin != null && it.factEndMin > startMin && it.factEndMin < finishMin) {
                finishMin = it.factEndMin;
                durationMin = round3(finishMin - startMin);
            }
            out.push({
                cutId: it.cutId,
                startMin: startMin,
                finishMin: finishMin,
                setupMin: it.setupMin,
                durationMin: durationMin,
                // Лидер уже включён в durationMin (storedCutAndLeaderMin = намотка + лидер, #3700) —
                // отдельной величины в сохранённом нет. null (а не 0): окно/минуты считают его 0
                // (не двойной счёт), а модалка тайминга (buildCutTimingCtx) оценивает лидер для
                // СВОЕЙ разбивки, не трогая расписание очереди/Ганта.
                leaderMin: null
            });
        });
        return out;
    }

    // #4121: обед УЖЕ учтён в сохранённых стартах, если генерация оставила под него зазор — то же
    // правило, что у зазор-детектора Ганта (ganttLunchMarkers): зазор ≈ длительности обеда, идущий
    // СРАЗУ ЗА заданием, начавшимся не позже LUNCH_START (генерация вставляет обед после него), и
    // перед заданием, стартующим не раньше LUNCH_START. Оба гарда обязательны: без первого роль
    // обеда забирает любой поздний простой дня (второй «Отпуск» станка), без второго — утренний
    // зазор. Нет такого зазора → обед «сквозной»: генерация его потеряла (день после «Отпуска»
    // пакуется встык, shiftPlacementsPastDowntime) и он обязан двигать карточки после несущей.
    // wins — окна карточек дня [{ startClock, endClock }]; порядок дорожки («Очередность») может
    // расходиться с временем (#3920/#3885), поэтому зазоры ищем по времени. Чистая — покрыта тестом.
    // #4132: зазор опознаём ПО ЕГО ДЛИНЕ (≈ обед) и по тому, что он не утренний, — но НЕ по тому,
    // где начинается несущая его карточка. Прежний гард «prev.startClock > LUNCH_START → не обед»
    // сравнивал СОХРАНЁННЫЙ старт с 12:20, а генерация решает, где вставить обед, по своим
    // НЕПРЕРЫВНЫМ минутам (insertLunchBefore: dayStart+clock ≥ LUNCH_START). Хранимые старты
    // округляются вверх (#4061 снап + целые колонки), поэтому карточка, начавшаяся у генерации в
    // 12:19, лежит в базе как 12:23 — и гард ошибочно объявлял настоящий обеденный зазор «поздним
    // простоем». Очередь вставляла обед ВТОРОЙ раз: весь день после обеда уезжал на 40 мин вперёд,
    // и хвост дня (02.07, Станок 1) рисовался 16:35–17:20 вместо 15:55–16:40 — issue #4132.
    // Роль «позднего простоя» (второй «Отпуск» станка, #4121) теперь отсекает ВЕРХНЯЯ граница длины:
    // генерация вставляет ровно lunch.durationMin, а окно «Отпуска» такой длины (±1 мин) — редкость.
    function lunchBakedIntoStarts(wins, lunch) {
        var byTime = (wins || []).filter(Boolean).slice()
            .sort(function(a, b) { return a.startClock - b.startClock; });
        for (var k = 1; k < byTime.length; k++) {
            var prev = byTime[k - 1], cur = byTime[k];
            var gap = cur.startClock - prev.endClock;
            if (gap < lunch.durationMin - 1) continue;   // зазор меньше обеда
            if (gap > lunch.durationMin + 1) continue;   // #4132: зазор ДЛИННЕЕ обеда — это простой, не обед
            if (cur.startClock < lunch.startMin) continue;                          // зазор до обеда (утренний)
            return true;
        }
        return false;
    }

    // #4075: несущие карточки обеда/перерывов + сдвиг последующих окон — перенос логики накладок
    // Ганта (ganttBreakMarkers/ganttLunchMarkers) на очередь РМ «Планирование». Для каждого
    // перерыва/обеда дня находим НЕСУЩУЮ карточку — первую, чьё СОХРАНЁННОЕ окно (наладка+резка+
    // лидер) накрывает его время; на ней рисуется серый значок. Обед (kind 'lunch') генерация
    // ЗАШИВАЕТ в planStart (послеобеденные задания уже сдвинуты) → только значок, БЕЗ доп. сдвига;
    // обед лежит ЗАЗОРОМ, поэтому окно несущей кончается ровно на LUNCH_START (строгое «<» не
    // ловит) — фолбэк берёт последнюю карточку, закончившуюся до обеда. Перерыв (kind 'break',
    // 10:00/15:00) в planStart НЕ входит → значок + сдвиг всех ПОСЛЕДУЮЩИХ карточек дня на его
    // длительность (breakShift, накопительно — как shiftMinByIndex Ганта). Перерыв в простое/после
    // последней резки дня (несущей нет) — не рисуется и никого не сдвигает.
    // #4121: обед зашит в planStart НЕ ВСЕГДА. На дне после «Отпуска» станка (#3764) сдвиг за
    // простой пакует резки встык (shiftPlacementsPastDowntime) и обеденный зазор схлопывается —
    // день идёт цугом через 12:20. Такой «сквозной» обед — реальный простой станка, которого нет
    // в сохранённых стартах, поэтому он двигает карточки после несущей, как перерыв (иначе №3
    // начинается на 40 мин раньше конца №2 — issue #4121). Отличаем по наличию зазора в дне
    // (lunchBakedIntoStarts) — тем же правилом, что зазор-детектор Ганта (ganttLunchMarkers).
    //   dayGroups — { schedDayKey → [cut,...] } в порядке дорожки; schedById — cutId → sc
    //   (startMin/setupMin/finishMin/leaderMin, минуты от полуночи дня 0); breaks — intraDayBreaks().
    // → { markersByCut: { cutId: [{ label, startMin, endMin, kind }] }, shiftByCut: { cutId: минуты },
    //     extendByCut: { cutId: минуты } }. extendByCut (#4094) — на сколько удлинить КОНЕЦ окна несущей
    // карточки (сумма длительностей её обедов/перерывов); shiftByCut — на сколько сдвинуть ПОСЛЕДУЮЩИЕ.
    // Чистая (без DOM) — покрыта тестом.
    function computeQueueBreakMarkers(dayGroups, schedById, breaks) {
        var markersByCut = {}, shiftByCut = {}, extendByCut = {};
        var brks = (breaks || []).filter(function(b) {
            return b && Number(b.durationMin) > 0 && isFinite(Number(b.startMin));
        }).slice().sort(function(a, b) { return Number(a.startMin) - Number(b.startMin); });
        if (!brks.length) return { markersByCut: markersByCut, shiftByCut: shiftByCut, extendByCut: extendByCut };
        Object.keys(dayGroups || {}).forEach(function(dayKey) {
            var dayNum = Number(dayKey);
            if (!isFinite(dayNum)) return;   // резки без расписания (ключ ' ') — пропускаем
            var base = dayNum * 1440;
            var cards = dayGroups[dayKey] || [];
            // Окно каждой карточки в минутах ОТ ПОЛУНОЧИ дня (по СОХРАНЁННОМУ старту, до сдвига).
            var wins = cards.map(function(c) {
                var sc = schedById[String(c && c.id)];
                if (!sc) return null;
                var setup = Number(sc.setupMin) || 0, leader = Number(sc.leaderMin) || 0;
                return {
                    startClock: (Number(sc.startMin) - setup) - base,
                    endClock: (Number(sc.finishMin) + leader) - base
                };
            });
            brks.forEach(function(B) {
                var dur = Number(B.durationMin);
                var carrierIdx = -1;
                for (var k = 0; k < wins.length; k++) {
                    var w = wins[k];
                    if (w && w.startClock <= B.startMin && B.startMin < w.endClock) { carrierIdx = k; break; }
                }
                // Обед зашит зазором — окно несущей кончается на LUNCH_START; берём последнюю
                // карточку, закончившуюся к обеду (несущая перед зазором, как carrierIndex=i-1 Ганта).
                if (carrierIdx < 0 && B.kind === 'lunch') {
                    for (var k2 = 0; k2 < wins.length; k2++) {
                        if (wins[k2] && wins[k2].endClock <= B.startMin + 1) carrierIdx = k2;
                    }
                }
                if (carrierIdx < 0) return;
                var carrierId = String(cards[carrierIdx].id);
                (markersByCut[carrierId] = markersByCut[carrierId] || []).push({
                    label: B.label, startMin: B.startMin, endMin: B.startMin + dur, kind: B.kind
                });
                // #4094: несущая карточка «удлиняется» на длительность своего обеда/перерыва — её ОКНО
                // (конец) честно охватывает работу + перерыв, как бар Ганта (extendMinByTask, cut-gantt
                // #4052). И обед (зазор/сквозной), и перерыв 10:00/15:00 расширяют конец окна несущей.
                extendByCut[carrierId] = (extendByCut[carrierId] || 0) + dur;
                // #4121: двигают последующие карточки перерывы (их нет в planStart) и обед, который
                // генерация в planStart не оставила (нет зазора). Зазор-обед уже сдвинул старты сам.
                var shiftsFollowing = B.kind === 'break' || (B.kind === 'lunch' && !lunchBakedIntoStarts(wins, B));
                if (shiftsFollowing) {
                    for (var m = carrierIdx + 1; m < cards.length; m++) {
                        var id = String(cards[m].id);
                        shiftByCut[id] = (shiftByCut[id] || 0) + dur;
                    }
                }
            });
        });
        return { markersByCut: markersByCut, shiftByCut: shiftByCut, extendByCut: extendByCut };
    }

    // #3342: параметры плавающего обеда из opts, валидные только если обед попадает
    // в рабочее окно и помещается в нём. → { startMin, durationMin } | null.
    function lunchParams(opts, shiftStart, shiftEnd) {
        var ls = Number(opts && opts.lunchStartMin);
        var ld = Number(opts && opts.lunchDurationMin) || 0;
        if (!isFinite(ls) || ld <= 0) return null;
        if (!(shiftEnd > shiftStart) || (shiftEnd - shiftStart) <= ld) return null;
        if (ls < shiftStart || ls >= shiftEnd) return null;
        return { startMin: ls, durationMin: ld };
    }

    // Уборка в конце рабочего дня (#3155, код CLEANUP_SHIFT): для каждого дня, где есть
    // хотя бы одна резка, — блок уборки длиной cleanupMin, начинающийся в конце рабочего
    // окна (shiftEnd, 16:30) и идущий до 17:00. Вход — расписание buildSchedule
    // (по startMin определяем день каждой резки). opts: { cleanupMin, shiftEndMin }.
    // cleanupMin ≤ 0 → нет уборки ([]). → [{ day, startMin, finishMin, durationMin }] по дням ↑.
    function dayCleanups(schedule, opts){
        opts = opts || {};
        var cleanup = Number(opts.cleanupMin != null ? opts.cleanupMin : DEFAULT_OP_TIMES.CLEANUP_SHIFT) || 0;
        var shiftEnd = Number(opts.shiftEndMin != null ? opts.shiftEndMin : SHIFT_END_MIN) || 0;
        if (cleanup <= 0) return [];
        var days = {};
        (schedule || []).forEach(function(sc){
            if (!sc) return;
            days[Math.floor((Number(sc.startMin) || 0) / 1440)] = true;
        });
        return Object.keys(days).map(Number).sort(function(a, b){ return a - b; }).map(function(day){
            var start = day * 1440 + shiftEnd;
            return { day: day, startMin: round3(start), finishMin: round3(start + cleanup), durationMin: round3(cleanup) };
        });
    }

    // #4469 (ТЗ §15): НЕДОУПАКОВАННЫЕ станко-дни раскладки — зеркало DAY_CAPACITY (#4467).
    // Тот ловит день ДЛИННЕЕ смены, этот — день КОРОЧЕ, чем можно набить: если в остаток дня (до
    // потолка нахлёста РЕЗКИ) влезает хотя бы один проход ПЕРВОГО задания следующего дня, день
    // обязан был забрать часть завтрашней работы — задание рвётся по проходам (#3280), а всё, что
    // стои́т после него, съезжает. Боевой случай: 424 мин при потолке 455, назавтра продолжение на
    // 24 прохода по 2.33 мин (issue #4469).
    //   segs — сегменты ОДНОГО станка [{ cutId, dayOffset, windowStartMin, runs, setupMin,
    //          durationMin, setupOnly, fixedDayLock, immovable }];
    //   opts.freeMinFor(day) → минуты от занятости дня до потолка резки (availFor(day,'cuts'));
    //   opts.isFrozenDay(day) → день заморожен (автоматика в него не лезет, #4436).
    // НЕ нарушение: донор зафиксирован 🔒 (замок дня абсолютен, #4434) или неприкосновенен
    // (`immovable` — начатое #4381 / завершённое), день-приёмник или день-донор заморожен, у донора
    // нет проходов (наладочный хвост #3635 п.5), в остаток не влезает даже один проход ВМЕСТЕ с
    // наладкой донора, приёмник — день РАНЬШЕ «С» (туда не ставят, ТЗ §15), следующего дня нет.
    // → [{ day, freeMin, needMin, donorCutId }] по возрастанию дня. Чистая, вход не мутирует.
    function underfilledLayoutDays(segs, opts) {
        opts = opts || {};
        var freeFn = typeof opts.freeMinFor === 'function' ? opts.freeMinFor : null;
        if (!freeFn) return [];
        var frozen = typeof opts.isFrozenDay === 'function' ? opts.isFrozenDay : function() { return false; };
        var firstOfDay = {}, days = [];
        (segs || []).forEach(function(s) {
            if (!s) return;
            var d = Number(s.dayOffset);
            if (!isFinite(d)) return;
            if (!(d in firstOfDay)) { firstOfDay[d] = s; days.push(d); }
            else if (Number(s.windowStartMin) < Number(firstOfDay[d].windowStartMin)) firstOfDay[d] = s;
        });
        days.sort(function(a, b) { return a - b; });
        var out = [];
        for (var i = 0; i + 1 < days.length; i++) {
            var day = days[i], next = days[i + 1];
            if (day < 0) continue;                                             // раньше «С» ничего не ставим (ТЗ §15)
            if (frozen(day) || frozen(next)) continue;
            var donor = firstOfDay[next];
            if (donor.fixedDayLock || donor.immovable) continue;               // #4434: 🔒 держит свой день; #4381: начатое не трогаем
            // #4542 (ТЗ §15): донора нельзя затянуть в этот день, если он ОБОГНАЛ БЫ 🔒 — замок
            // сильнее набивки. Такой день недоупакован ЗАКОННО, и страж DAY_FILL о нём молчит.
            if (typeof opts.overtakesFixedAt === 'function' && opts.overtakesFixedAt(String(donor.cutId), day)) continue;
            var runs = Number(donor.runs) || 0, dur = Number(donor.durationMin) || 0;
            if (!(runs > 0) || !(dur > 0)) continue;                           // #3635 п.5: хвост без проходов
            var need = round3((Number(donor.setupMin) || 0) + dur / runs);     // наладка донора + ОДИН проход
            var free = round3(Number(freeFn(day)) || 0);
            if (free + 1e-6 < need) continue;
            out.push({ day: day, freeMin: free, needMin: need, donorCutId: String(donor.cutId) });
        }
        return out;
    }

    // #3280: разбиение очереди ОДНОГО станка по рабочим дням на уровне проходов.
    // Длительность резки линейна по проходам (windingMinutes × «Кол-во план»), поэтому
    // резку, упирающуюся в конец рабочего окна, обрезаем по числу влезающих проходов;
    // остаток проходов — продолжение с 08:00 следующего дня ТОЙ ЖЕ резки без переналадки
    // (ножи остаются на станке → setup продолжения = 0).
    // #3401: лидер (BETWEEN_CUTS) заправляют ПЕРЕД КАЖДОЙ резкой цуга — он входит в стоимость
    // одного прохода (perPass + leader), а не в одноразовый setup. Так лидеры раскладываются
    // по дням вместе с проходами (а не упираются все в первый день/переполняют окно).
    //   orderedCuts — уже упорядоченная очередь станка (как из orderCuts).
    //   opts: { dayStartMin, dayEndMin, leader, times, perPassByCut:{cutId:мин/проход},
    //           runsByCut:{cutId:проходов} } (perPass/runs можно не задавать — берём из резки).
    // → массив сегментов [{ cutId, dayOffset, runs, windowStartMin, startMin, setupMin,
    //    durationMin, isContinuation, parentCutId }] (windowStartMin = первый шаг окна =
    //    startMin − setupMin; именно его выводим в .atex-pp-cut-num и пишем в t1078).
    // Вход не мутирует.
    function splitMachineQueue(orderedCuts, opts){
        opts = opts || {};
        var dayStart = Number(opts.dayStartMin != null ? opts.dayStartMin : SHIFT_START_MIN) || 0;
        var dayEnd = Number(opts.dayEndMin != null ? opts.dayEndMin : SHIFT_END_MIN) || 0;
        var times = opts.times || DEFAULT_OP_TIMES;
        var leader = Number(opts.leader != null ? opts.leader : (times.BETWEEN_CUTS != null ? times.BETWEEN_CUTS : DEFAULT_OP_TIMES.BETWEEN_CUTS)) || 0;
        var perPassByCut = opts.perPassByCut || {};
        var runsByCut = opts.runsByCut || {};
        // #4085: режим «порядок задан извне» — слой размещения (15-slot-placement, модель #3985) уже
        // выбрал порядок перебором точек вставки; здесь его НЕ переигрываем. Ключ выбора схлопывается в
        // [idx] (исходный порядок), роняя члены переналадка / −stripBandCount. Вся механика тайминга
        // (нахлёст, обед, отпуск, дробление, setup-хвост) — без изменений.
        var orderAuthoritative = !!opts.orderAuthoritative;
        // #4085 (модель #3985): резерв хвоста дня под дедлайн-фольгу (#4068, ТЗ §12) СНЯТ — фольга у
        // своего срока обеспечивается локальным штрафом в слое размещения, а не резервированием минут.
        // Карты резерва всегда пусты → ветки reserveForDay/isReservedFoil в цикле упаковки ниже инертны
        // (сохранены как есть, чтобы не трогать проверенный цикл; это и есть режим, проверенный на ateh).
        var foilReserveByDay = {};
        var resFoilDayByCut = {};
        function reserveForDay(d) { return 0; }
        var capacity = dayEnd - dayStart;            // минут резки в рабочем окне дня
        var hasWindow = capacity > 0;
        // #3847: лимиты нахлёста за конец рабочего дня. dayEndHour = реальный конец смены
        // (DAY_END_HOUR, обычно > dayEnd = cutEndMin = DAY_END_HOUR−TOTAL_INTERVALS). Резку (проход)
        // можно положить с нахлёстом, только если она кончится ≤ dayEndHour+maxOverworkCuts;
        // настройку — ≤ dayEndHour+maxOverworkTune. Лимит не задан (null) → фича выключена: пакуем
        // как раньше, до cutEndMin (effCapacity), без сверхнормативного нахлёста.
        var dayEndHour = Number(opts.dayEndHourMin != null ? opts.dayEndHourMin : dayEnd) || 0;
        var maxOverworkCuts = (opts.maxOverworkCutsMin != null && isFinite(Number(opts.maxOverworkCutsMin)))
            ? Math.max(0, Number(opts.maxOverworkCutsMin)) : null;
        var maxOverworkTune = (opts.maxOverworkTuneMin != null && isFinite(Number(opts.maxOverworkTuneMin)))
            ? Math.max(0, Number(opts.maxOverworkTuneMin)) : maxOverworkCuts;
        var overworkOn = maxOverworkCuts != null;
        // #4563: ПОТОЛОК И ВЕЛИЧИНУ НАХЛЁСТА берём у общей функции — своей формулы у упаковщика нет.
        // Нахлёст выключен (лимит не задан) → потолок равен cutEndMin, как и раньше.
        var ceilingCuts = dayCeilingMin(windowFromOpts(opts), 'cuts');   // абсолютный потолок РЕЗКИ
        var overCuts = round3(ceilingCuts - dayEnd);                     // сколько его сверх cutEndMin
        // #3914: заголовок трассировки станко-очереди — параметры окна и ёмкости дня.
        ppTrace('splitMachineQueue: резок=' + (orderedCuts || []).length +
            ' окно=' + ppClock(dayStart) + '..' + ppClock(dayEnd) + ' (cutEnd, ёмкость ' + Math.round(capacity) + ')' +
            ' конецСмены=' + ppClock(dayEndHour) +
            ' нахлёст[резка ' + (maxOverworkCuts != null ? maxOverworkCuts : '—') + ', настр ' + (maxOverworkTune != null ? maxOverworkTune : '—') + ']' +
            ' обед=' + (opts.lunchStartMin != null ? (ppClock(opts.lunchStartMin) + '×' + (Number(opts.lunchDurationMin) || 0)) : 'нет') +
            ' gapFill=' + !!opts.gapFill +
            ' блокировок=' + ((opts.blockedRanges && opts.blockedRanges.length) || 0));
        // #3764: вынести сегменты за окна «Отпуска» станка (общий проход по результату, как в
        // buildSchedule). Окно сегмента — [windowStartMin, +setup+намотка]; пустой blockedRanges
        // → no-op. Вызываем перед каждым return (gapFill-ветка и базовая).
        function applyDowntime(segs) {
            // #3907: предел конца сегмента при сдвиге за простой — тот же потолок, что в упаковке
            // (availFor 'cuts'): cutEndMin + maxOverworkCuts; нет овертайма → cutEndMin (dayEnd).
            // #3909/#3910: потолок привязан к cutEndMin (dayEnd), а не к DAY_END_HOUR (см. availFor).
            // Без него сегмент на целый день, сдвинутый простоем/выходным на старт в середине дня,
            // вылезал за смену (#3907: 108 проходов с 10:35 до 17:26) — теперь переносится на завтра.
            var fitEnd = ceilingCuts;   // #4563: один потолок на всех
            // #3914: трассировка сдвига за «Отпуск»/выходной — до и после (положения окон меняются).
            var traceDown = ppTraceOn() && hasWindow && opts.blockedRanges && opts.blockedRanges.length;
            var before = traceDown ? segs.map(function(s) { return { cut: s.cutId, ws: s.windowStartMin }; }) : null;
            if (traceDown) {
                ppTrace('applyDowntime: блокировки станка (мин от базы): ' +
                    opts.blockedRanges.map(function(r) { return ppClock(r.start != null ? r.start : r[0]) + '..' + ppClock(r.end != null ? r.end : r[1]); }).join(', ') +
                    ' | fitEnd(потолок конца)=' + ppClock(fitEnd));
            }
            if (hasWindow) shiftPlacementsPastDowntime(segs, opts.blockedRanges, dayStart, dayEnd, {
                windowStart: function(s) { return s.windowStartMin; },
                length: function(s) { return (Number(s.setupMin) || 0) + (Number(s.durationMin) || 0); },
                shift: function(s, delta) { s.windowStartMin = round3(s.windowStartMin + delta); s.startMin = round3(s.startMin + delta); },
                // #4021: setup-only хвост дня — намеренный нахлёст (#3635 п.5), не выталкивать потолком.
                // #4434 п.1: сегмент зафиксированного (🔒) задания — тоже: его день абсолютен, перегруз дня
                // допустим, а перенос на следующий день — нет.
                overhangTail: function(s) { return !!s.setupOnly || !!s.fixedDayLock; },
                keepDay: function(s) { return !!s.fixedDayLock; }   // #4434 п.1: сегмент 🔒 не покидает свой день
            }, fitEnd);
            if (traceDown) {
                segs.forEach(function(s, i) {
                    var was = before[i];
                    if (was && Math.abs((was.ws || 0) - (s.windowStartMin || 0)) > 1e-6) {
                        ppTrace('  сдвиг ' + s.cutId + ': ' + ppClock(was.ws) + ' → ' + ppClock(s.windowStartMin));
                    }
                });
            }
            return segs;
        }
        // #3342: плавающий обед. lunch.startMin — минуты от полуночи; durationMin — длина.
        var lunch = lunchParams(opts, dayStart, dayEnd);
        var lunchDone = {};
        // #3978: минуты простоя (blockedRanges) ВНУТРИ рабочего окна дня уменьшают его ёмкость.
        // Иначе укладчик пакует день логически от dayStart БЕЗ учёта простоя, applyDowntime затем
        // сдвигает ЦЕЛЫЕ сегменты за простой, и вылезший за конец окна сегмент уезжает на следующий
        // день ЦЕЛИКОМ (дробить после сдвига нечем) → день с простоем недобирает: issue #3978,
        // 02.07 после утреннего простоя 08:00–10:00 держал 129 мин вместо достижимых ~330, а работа
        // каскадом стекала на следующие дни. Учитывая простой в ёмкости, укладчик дробит резку и
        // добивает частично-простойный день. ПОЛНОСТЬЮ заблокированный день (выходной #3788/отпуск
        // на всё окно) НЕ трогаем — им занимается applyDowntime/shiftPlacementsPastDowntime
        // (#3764/#3951), поведение прежнее (иначе задели бы отлаженную раскладку выходных/отпуска).
        var blockedRangesLocal = opts.blockedRanges || [];
        function dayLostToBlock(d) {
            if (!hasWindow || !blockedRangesLocal.length) return 0;
            var ws = d * 1440 + dayStart, we = d * 1440 + dayEnd, sum = 0;
            for (var bi = 0; bi < blockedRangesLocal.length; bi++) {
                var r = blockedRangesLocal[bi];
                var s = r.start != null ? r.start : r[0], e = r.end != null ? r.end : r[1];
                var lo = Math.max(ws, s), hi = Math.min(we, e);
                if (hi > lo) sum += hi - lo;
            }
            return (sum < capacity) ? sum : 0;   // полный блок окна — день пропускаем целиком (dayFullyBlocked)
        }
        // #4418: день ЦЕЛИКОМ закрыт для станка — рабочее окно [dayStart; dayEnd] полностью накрыто
        // окнами простоя (выходной/праздник «Календаря» #3788 или «Отпуск» #3764 на всю смену).
        // Такой день упаковщик ПРОПУСКАЕТ, а не раскладывает в него «логически» с последующим
        // сдвигом applyDowntime: иначе его ось дней расходится с календарём, а зафиксированные
        // задания (fixedDay — КАЛЕНДАРНЫЙ день) оказываются «позади» уже разложенного и правило
        // #3951 выталкивает их на день позже (issue #4418).
        function dayFullyBlocked(d) {
            if (!hasWindow || !blockedRangesLocal.length) return false;
            var ws = d * 1440 + dayStart, we = d * 1440 + dayEnd;
            for (var bi = 0; bi < blockedRangesLocal.length; bi++) {
                var r = blockedRangesLocal[bi];
                var s = r.start != null ? r.start : r[0], e = r.end != null ? r.end : r[1];
                if (s <= ws && e >= we) return true;
            }
            return false;
        }
        // До вставки обеда доступную ёмкость дня уменьшаем на длительность обеда (резерв):
        // если обед не получится поставить паузой между резками, день закончится раньше.
        // #3978: и на простой внутри окна (dayLostToBlock).
        function effCapacity(d) { return ((lunch && !lunchDone[d]) ? (capacity - lunch.durationMin) : capacity) - dayLostToBlock(d); }
        // #3847: доступные минуты от текущего clock до потолка нахлёста для дня d. kind='cuts' —
        // потолок DAY_END_HOUR+maxOverworkCuts (для проходов), 'tune' — DAY_END_HOUR+maxOverworkTune
        // (для настройки). Минус резерв обеда (как effCapacity). Фича выключена → обычная ёмкость до
        // cutEndMin (effCapacity−clock), поведение не меняется. clock/lunchDone — из замыкания.
        // #4149: занятость дня в ЦЕЛЫХ минутах — ровно то, что уйдёт в колонки/бейдж
        // (round(наладка) + ceil(намотка) на сегмент, как snapWindowStartsWholeMinutes #4061),
        // плюс обед, если он уже вставлен. Гейт потолка (availFor) считает по ней, а не по дробному
        // clock: упаковщик решал, что влезает, ДРОБНОЙ намоткой (день ≤ 460), но хранится/рисуется
        // ЦЕЛАЯ — накопленный по резкам дня ceil выносил последнюю карточку/хвост за потолок нахлёста
        // (бейдж 461/462 при допуске 460, issue #4149; ту же природу спец описывает как «447+15=462»).
        // Считая потолок в ЦЕЛЫХ минутах, упаковщик роняет лишний ceil на следующий день сам.
        function dayWholeOccupied(d) {
            var sum = 0;
            for (var i = 0; i < segments.length; i++) {
                var s = segments[i];
                if (s.dayOffset !== d) continue;
                sum += Math.round(round3(Number(s.setupMin) || 0)) + Math.ceil(round3(Number(s.durationMin) || 0));
            }
            if (lunch && lunchDone[d]) sum += lunch.durationMin;   // обед уже вставлен — как в дробном clock
            return sum;
        }
        // #4488 (ТЗ §15): ЗАДАНИЕ РУЧНОГО ПЕРЕНОСА ВСТАЁТ В ДЕНЬ ЦЕЛИКОМ. Оператор двигает задание
        // сознательно; рвать по потолку именно ЕГО, пока в дне стои́т то, что можно подвинуть, —
        // значит не выполнить перенос (issue #4488: на выбранный день лёг ОДИН проход из двенадцати,
        // остальные остались хвостом в следующем дне). Поэтому его полная занятость РЕЗЕРВИРУЕТСЯ в
        // его дне: соседи считают остаток дня уже без неё и уезжают на следующий день сами — сначала
        // незафиксированные, затем 🔒 (порядок выбора не меняется). Само перенесённое рвётся В
        // ПОСЛЕДНЮЮ ОЧЕРЕДЬ: когда резерв снят (оно и есть текущий кандидат), ему доступна ВСЯ
        // ёмкость дня, и разрыв случается, только если оно не влезает даже в пустую смену.
        //   wholeDayByCut: { cutId: dayOffset } — задаёт контроллер (moveCutToDay → moveScope).
        // Резерв снимается, как только задание размещено (remaining = 0), и не действует на другие дни.
        var wholeDayBy = opts.wholeDayByCut || {};
        var wholeDayIds = Object.keys(wholeDayBy);
        // #4542: задания, которые оператор двигает ПРЯМО СЕЙЧАС (все ручные признаки — см.
        // planCutOperations). Запрет «🔒 не обгонять» их не связывает (ТЗ §15).
        var manualMoveBy = opts.manualMoveByCut || {};
        // #4497 (ТЗ §15): ХРАНИМОЕ МЕСТО 🔒 В ДНЕ. Перед зафиксированным заданием автоматика ничего не
        // ставит: замок держит не только ДЕНЬ, но и МЕСТО в дне — иначе новое задание садится в голову
        // дня, а весь паровоз 🔒 уезжает на его длительность (issue #4497). Единственное, чему
        // разрешено идти впереди 🔒, — задание, которое СТОЯЛО перед ней в хранимом плане: пути
        // ручного порядка («Пересчитать наладку», ↑↓) отдают очередь как есть и день не переворачивают.
        //   storedDayByCut: { cutId: dayOffset } — ХРАНИМЫЙ день задания (тот же расчёт, что
        //   dayAnchorByCut: смещение «Даты план» от «С»); своё время старта берём из c.planDate.
        var storedDayBy = opts.storedDayByCut || {};
        function wholeReserve(d, exceptId, fixedOnly) {
            if (!wholeDayIds.length) return 0;
            var total = 0;
            for (var wi = 0; wi < wholeDayIds.length; wi++) {
                var id = wholeDayIds[wi];
                if (String(id) === String(exceptId)) continue;
                var st = state[id];
                if (!st || !(st.remaining > 0) || !(st.perPass > 0)) continue;   // размещено или вырожденное
                // #4512: считаем резерв только зафиксированных переносов — см. reserveAgainst.
                if (fixedOnly && st.fixedDay == null) continue;
                // День берём АКТУАЛЬНЫЙ: у 🔒 он мог сдвинуться (нерабочий день, #4467).
                var wDay = (st.fixedDay != null) ? st.fixedDay : Number(wholeDayBy[id]);
                if (!isFinite(wDay) || wDay !== d) continue;
                total += setupCostFor(prevPhysical, st.cut) + st.remaining * (st.perPass + leader);
            }
            return round3(total);
        }
        // #4497: вытесненное потолком задание нельзя «увезти» в ЗАМОРОЖЕННЫЙ день — автоматика
        // его не трогает (ТЗ §15, #4326/#4347), и запись по такому дню страж выбрасывает: задание
        // молча остаётся в прежнем дне, а день так и стои́т переполненным (боевое: 502 мин при 460
        // после ручного переноса «из 30 в 29», когда 30 заморожен). Едем к ближайшему СВОБОДНОМУ
        // дню — то же решение, что #4494 принял для остатка задания ручного переноса.
        function nextUnfrozenDay(d) {
            if (!opts.frozenDayFor) return d;
            var n = d, guard = 0;
            while (opts.frozenDayFor(n) && guard++ < 400) n += 1;
            return n;
        }
        // #4512 (ТЗ §15, решение заказчика 30.07.2026): РЕЗЕРВ ЧУЖОГО ЗАДАНИЯ НЕ ВЫТАЛКИВАЕТ 🔒 С ЕГО
        // ДНЯ. Резерв #4488 держит место под задание РУЧНОГО ПЕРЕНОСА, и вычитался он у всех соседей
        // подряд — включая зафиксированные. Для 🔒 это значило «в остаток дня не влезает ни одного
        // прохода» → ветка #4467 увозила её на следующий день: свободное задание отбирало место у
        // замка. Причём впустую — освободившееся место переносимое даже не занимало (боевое: день с
        // двумя 🔒 по 165 мин после переноса свободного остался с ОДНОЙ 🔒 и дырой в 295 минут, а
        // перенесённое уехало в следующий день вслед за вытесненной).
        // Теперь 🔒 своего дня видит ёмкость БЕЗ этого резерва: место уступают только свободные
        // соседи (ровно то, что #4488 и задумывал — «сначала незафиксированные»). Само переполнение
        // дня правило не отменяет: лестница #4467 (реальная нехватка минут) действует как прежде.
        // Для 🔒 своего дня из резерва исключаются НЕЗАФИКСИРОВАННЫЕ переносы: свободное задание
        // не отбирает место у замка. Перенос САМОЙ 🔒 (оператор и зафиксировал, и подвинул) резерв
        // сохраняет — там лестница #4467 решает, как прежде (#4497).
        function reserveAgainst(d, exceptId) {
            var stEx = exceptId == null ? null : state[String(exceptId)];
            var isFixedHere = !!(stEx && stEx.fixedDay != null && stEx.fixedDay === d);
            return wholeReserve(d, exceptId, isFixedHere);
        }
        function availFor(d, kind, exceptId) {
            var occWhole = dayWholeOccupied(d);   // #4149: потолок считаем по ЦЕЛОЙ занятости (= колонки/бейдж), не по дробному clock
            var reserveWhole = reserveAgainst(d, exceptId);   // #4488: место под задание ручного переноса; #4512: не против 🔒
            var base = effCapacity(d) - occWhole - reserveWhole;
            if (!overworkOn || !hasWindow) return base;
            // #4563: потолок берём у ОБЩЕЙ функции — та же, что у стража, бейджа, генерации и
            // раскроя. Она вычитает обед всегда; упаковщику он не нужен, если в этот день уже
            // вставлен, — возвращаем обратно. Прочее (простой, занятость, резерв) — как было.
            var lunchBack = (lunch && lunchDone[d]) ? lunch.durationMin : 0;
            // #3909/#3910: нахлёст добавляем к cutEndMin (dayEnd = DAY_END_HOUR−TOTAL_INTERVALS),
            // а НЕ к DAY_END_HOUR. Последнее задание дня обязано кончиться ≤ cutEndMin+margin
            // (резка → +MAX_OVERWORK_CUTS, настройка → +MAX_OVERWORK_TUNE). Раньше базой был
            // dayEndHour (16:30), и день паковался до 16:35+, копя 475–494 раб. мин (#3910 «494
            // мин во 2 июле»). Теперь потолок 16:15 (резка) / 16:20 (настройка) — буфер уборки
            // (TOTAL_INTERVALS) поглощает нахлёст, а не растёт за конец смены.
            // #3978: минус простой внутри окна дня (dayLostToBlock) — как в effCapacity.
            // #4149: минус ЦЕЛАЯ занятость дня (occWhole) — потолок держится на хранимой раскладке.
            // #4488: минус место под задание ручного переноса (reserveWhole) — оно ложится целиком.
            return dayCapacityMinutes(windowFromOpts(opts), kind) + lunchBack - dayLostToBlock(d) - occWhole - reserveWhole;
        }
        // #3974: якорь дня несёт ТОЛЬКО «Зафиксировано» (🔒) — фикс-резка держит свой день
        // (fixedDay ниже). Свободные задания якоря не имеют (dayAnchorByCut #3658 отменён): день
        // раскладки начинаем с «С» (day 0) и плотно набиваем вперёд. Фикс-резку с днём РАНЬШЕ «С»
        // (fixedDay < 0) не размещаем — цикл идёт только вперёд от 0, и она остаётся как есть.
        var anchorByCut = opts.dayAnchorByCut || {};
        var segments = [];
        var day = 0, clock = 0;   // clock — минут занято в текущем дне (от dayStart)
        var prevPhysical = null;                     // предыдущая ФИЗИЧЕСКАЯ резка (для переналадки)
        // #4314: длинный отпуск станка (> DOWNTIME_KEEP_SETUP_MAX_DAYS дней) СНИМАЕТ заправку: первая
        // резка после него считает настройку С НУЛЯ, как и хранимые колонки (setupResetCutIds). Иначе
        // упаковщик зарядил бы ей переналадку от резки ДО отпуска, колонки — полную настройку, и окна
        // разъехались бы ровно так же, как в #4300/#4312. prevPhysicalDay — день предыдущей размещённой
        // резки; для ПЕРВОЙ резки очереди роль предшественника играет заправка станка, а описывает она
        // день carryPrevSetupDay (день последнего задания раньше «С», #4312; по умолчанию 0 —
        // снят на день базы). Пустые longVacationRanges → ветка инертна, поведение прежнее.
        var longVacationRanges = opts.longVacationRanges || [];
        var carryPrevSetupDay = isFinite(Number(opts.carryPrevSetupDay)) ? Number(opts.carryPrevSetupDay) : 0;
        var prevPhysicalDay = null;                  // день prevPhysical (null — ещё ничего не клали)
        // Обед как пауза перед НОВОЙ резкой: если в этот день он ещё не был и время дня
        // (dayStart+clock) дошло до LUNCH_START — вставляем паузу (clock += длительность).
        function insertLunchBefore() {
            if (lunch && !lunchDone[day] && clock > 0 && (dayStart + clock) >= lunch.startMin) {
                clock += lunch.durationMin;
                lunchDone[day] = true;
            }
        }
        // #3739: setup (минуты) и его компоненты для переналадки prev→c с учётом первой
        // резки/заправки станка. cost == changeoverCost(...) — единый источник.
        // #3853: первая резка станка считается переналадкой от РЕАЛЬНОЙ заправки станка
        // (carryPrevSetup) — ровно как окно резки в setupActivityColumns
        // (persistence). Раньше генерация planStart брала здесь «ножи с нуля» (firstCutSetup),
        // а окно — переналадку от заправки → на первой карточке дня возникал разрыв/перекрытие.
        // carryOverPrevCut нейтрализует партию ИМЕННО первой резки c (как arr[0] в persistence),
        // поэтому батч не считается ложной сменой даже при gapFill-перестановке.
        // #4314: упаковщик набивает дни ПОДРЯД, включая дни отпуска, — за окна «Отпуска» сегменты
        // выносит уже applyDowntime (#3764, shiftPlacementsPastDowntime) в самом конце. Поэтому день
        // ВНУТРИ отпуска — фикция: в базе задание окажется первым днём ПОСЛЕ него, и хранимые колонки
        // (setupResetCutIds по итоговым planStart) будут считать по нему. Приводим день к этой же шкале,
        // иначе два задания, упакованные в разные дни отпуска, у упаковщика оказались бы «через отпуск»
        // (лишний сброс наладки), а в колонках — соседями одного дня → окна разъехались бы.
        function effDayForSetup(d) {
            for (var vi = 0; vi < longVacationRanges.length; vi++) {
                var r = longVacationRanges[vi];
                if (d >= r.fromDay && d <= r.toDay) return r.toDay + 1;
            }
            return d;
        }
        function setupPartsFor(prev, c) {
            // #4314: между предшественником и текущим днём стоял длинный отпуск → станок разряжен,
            // настройка с нуля (то же, что пишут хранимые колонки, setupResetCutIds).
            if (longVacationRanges.length
                && setupResetByVacation(effDayForSetup(prev ? prevPhysicalDay : carryPrevSetupDay),
                                        effDayForSetup(day), longVacationRanges)) {
                return firstSetupParts(c, times);
            }
            if (prev) return changeoverParts(prev, c, times);
            if (opts.carryPrevCut) return changeoverParts(opts.carryPrevCut, c, times);   // #3688
            if (opts.carryPrevSetup) return changeoverParts(carryOverPrevCut(opts.carryPrevSetup, c), c, times);   // #3853
            if (opts.firstCutSetup) return firstSetupParts(c, times);                     // #3669
            return [];
        }
        function setupCostFor(prev, c) {
            return setupPartsFor(prev, c).reduce(function(s, p){ return s + (Number(p.minutes) || 0); }, 0);
        }
        // #4499: РАЗЛОЖЕНИЕ наладки сегмента по колонкам «Наладка ножей» / «Сырьё-намотка».
        // Колонки обязаны нести ТО ЖЕ, что напаковал упаковщик: их сумма — это бейдж дня и мерка
        // потолка. Раньше их считала отдельная функция контроллера по своей развёртке очереди, и
        // две арифметики расходились на разбитых по дням заданиях и наладочных хвостах — до +75
        // минут на день, то есть «502 при 460» в бейдже при честной раскладке упаковщика.
        //   total — сумма, реально записанная в setupMin сегмента (в вырожденных ветках к ней
        //   добавлен лидер).
        //   contParts (#4529) — компоненты ОСТАТКА наладки, унесённого на это продолжение хвостом
        //   дня N (remainingSetupParts). Есть они — раскладываем остаток по его настоящим кодам;
        //   нет (остаток известен только числом) — всё в «Наладку ножей», как раньше.
        // Расхождение частей с total кладём в «Наладку ножей», чтобы сумма колонок СОВПАДАЛА с
        // занятостью сегмента до минуты.
        function setupColsFor(prev, c, total, isCont, contParts) {
            var t = round3(Number(total) || 0);
            if (!(t > 0)) return { knife: 0, material: 0 };
            if (isCont && !(contParts && contParts.length)) return { knife: t, material: 0 };
            var k = 0, m = 0;
            (isCont ? contParts : setupPartsFor(prev, c)).forEach(function(pt) {
                if (pt && pt.code === 'MATERIAL_WINDING') m += Number(pt.minutes) || 0;
                else k += Number(pt.minutes) || 0;
            });
            k = round3(k); m = round3(m);
            var sum = round3(k + m);
            if (sum !== t) k = round3(k + (t - sum));
            return { knife: k, material: m };
        }
        // #3739: gap-fill. Вместо простоя в хвосте смены тянем будущую резку вперёд (раньше
        // срока — допустимо, «с запасом по сроку») и заполняем день; нахлёст за конец смены
        // разрешён. Выбор следующей резки — по НЕПРЕРЫВНОСТИ КОНФИГУРАЦИИ (минимальная
        // переналадка от предыдущей): «начинать с той конфигурации, на которой закончили».
        // Когда в хвост влезает только настройка — кладём КРУПНЕЙШИЙ её компонент (ножи/сырьё)
        // с минимальным нахлёстом, остаток настройки — на след. день перед проходами.
        if (opts.gapFill) {
            var state = {};
            var poolOrder = [];
            (orderedCuts || []).forEach(function(c, i){
                var id = String(c && c.id);
                state[id] = {
                    cut: c, idx: i,
                    remaining: Math.round(Number(runsByCut[id] != null ? runsByCut[id] : c && c.plannedRuns) || 0),
                    perPass: Number(perPassByCut[id] != null ? perPassByCut[id] : 0) || 0,
                    anchor: anchorByCut[id] != null ? anchorByCut[id] : null,
                    dueDay: null,   // #4085: EDD-приоритет `dueDay×вес` (#4059) снят — срок стал локальным штрафом в слое размещения; поле инертно
                    // #3792/#3974: «Зафиксировано» (🔒) — замок на ДЕНЬ. fixedDay = якорь дня фикс-резки
                    // (без 🔒 задание свободно и набивается от «С»). Внутри дня оптимизатор переставляет,
                    // на другой день/в разбивку — нет.
                    fixedDay: (c && c.fixed && anchorByCut[id] != null) ? anchorByCut[id] : null,
                    // #4068: резервная дедлайн-фольга ставится ТОЛЬКО на этот день (в хвост, конец дня).
                    resFoilDay: (resFoilDayByCut[id] != null && isFinite(Number(resFoilDayByCut[id]))) ? Number(resFoilDayByCut[id]) : null,
                    isCont: false, pendingSetup: 0,
                    pendingParts: null   // #4529: компоненты остатка наладки, унесённого хвостом на продолжение
                };
                poolOrder.push(id);
            });
            // #4491 (ТЗ §15): ХРАНИМЫЙ порядок 🔒-МОНОЛИТА по дням. Пара 🔒, стоявшая в дне ПОДРЯД,
            // обязана остаться подряд — в том числе когда в этот день приезжает 🔒 из другого дня
            // (её вытеснил потолок, #4467/#4488) и очередь §8 ставит её МЕЖДУ звеньями. Звенья
            // берём по ХРАНИМОМУ плану (planDate + свой день), а не по очереди размещения:
            // приезжая 🔒 звеном чужого монолита не является и вклиниваться в него не вправе.
            // st.anchor — СВОЙ день задания (fixedDay мутируется при вытеснении, anchor нет).
            var storedFixedSeqByDay = {};
            poolOrder.forEach(function(id){
                var st = state[id];
                if (!st || !(st.cut && st.cut.fixed) || st.anchor == null) return;
                (storedFixedSeqByDay[st.anchor] = storedFixedSeqByDay[st.anchor] || []).push(id);
            });
            Object.keys(storedFixedSeqByDay).forEach(function(d){
                storedFixedSeqByDay[d].sort(function(a, b){
                    var ta = Number(state[a].cut && state[a].cut.planDate);
                    var tb = Number(state[b].cut && state[b].cut.planDate);
                    if (!isFinite(ta) || ta <= 0) ta = Infinity;
                    if (!isFinite(tb) || tb <= 0) tb = Infinity;
                    return (ta - tb) || (state[a].idx - state[b].idx);
                });
            });
            // #4542 (ТЗ §15): АВТОМАТИКА НЕ ОБГОНЯЕТ 🔒. Замок держит не только день и место в дне
            // (#4497), но и ОЧЕРЁДНОСТЬ: подвижное задание не встаёт РАНЬШЕ зафиксированного, за
            // которым оно стояло. Прежде правило смотрело только ВНУТРЬ дня 🔒, а набивка ранних
            // дней («тянем будущее вперёд», #3739/#4469) свободно перетаскивала задание с 03.08 в
            // 30–31.07, обгоняя замки этих дней (issue #4542: «добавил задания на 3.08 — всплыли в
            // 31.07 перед зафиксированными»; станко-день 20260731 стал 580 мин при потолке 460).
            //
            // ЧТО РАЗРЕШЕНО (прежние исключения ТЗ §15): задание, стоявшее перед этой 🔒 в ХРАНИМОМ
            // плане на том же станке, своё место сохраняет; нефольга обгоняет 🔒-фольгу («фольга в
            // конец дня», #3717); ручное действие оператора правилом не связано. У задания, которого
            // в плане ещё нет («Сгенерировать», «по позициям»), хранимого места нет — значит, оно не
            // стояло перед 🔒 нигде и идёт ПОСЛЕ последнего замка станка.
            function mayPrecedeFixed(candId, fixedId) {
                if (wholeDayBy[String(candId)] != null || manualMoveBy[String(candId)]) return true;   // оператор двигает прямо сейчас
                var fst = state[fixedId], cst = state[candId];
                if (!fst || fst.anchor == null) return true;           // хранимого дня 🔒 нет — защищать нечего
                if (storedPlanTs(fixedId) == null) return true;
                if (fst.cut && cst && cst.cut && fst.cut.isFoil && !cst.cut.isFoil) return true;   // #3717
                var a = storedPlanTs(candId);
                if (a == null) return false;                           // места в плане нет — только после 🔒
                if (storedSidOf(candId) !== storedSidOf(fixedId)) return false;   // на другом станке перед ней не стояло
                return a < storedPlanTs(fixedId);
            }
            // Самый поздний день 🔒, которую задание обгонять не вправе: раньше него его не кладём.
            var fixedFloorDay = {};
            poolOrder.forEach(function(id) {
                var st = state[id];
                if (!st || (st.cut && st.cut.fixed)) return;   // про саму 🔒 правило не спрашивают
                var floor = null;
                poolOrder.forEach(function(fid) {
                    var fst = state[fid];
                    if (!fst || !(fst.cut && fst.cut.fixed) || fst.anchor == null) return;
                    if (mayPrecedeFixed(id, fid)) return;
                    if (floor == null || fst.anchor > floor) floor = fst.anchor;
                });
                if (floor != null) fixedFloorDay[String(id)] = floor;
            });
            // ТЗ §14: правило не срабатывает молча — в трассе видно, кого и до какого дня оно
            // придержало. Без этой строки «день недобит, а задание уехало дальше» выглядело бы
            // необъяснимым: причина (замок впереди) нигде не названа.
            Object.keys(fixedFloorDay).forEach(function(id) {
                ppTrace('#4542 задание ' + id + ' не ставим раньше дня ' + fixedFloorDay[id]
                    + ' — там стои́т 🔒, которую оно не обгоняет');
            });
            function floorAllows(id, d) {
                var f = fixedFloorDay[String(id)];
                return f == null || d >= f;
            }
            // #4491: звено монолита нельзя взять РАНЬШЕ своих предшественников по хранимому дню.
            // Без этого первое звено уехавшего монолита выбирает очередь §8 — и пара, стоявшая
            // подряд, приезжает в новый день в обратном порядке (боевое: Q → P вместо P → Q).
            function monolithReady(id) {
                var st = state[id];
                if (!st || st.anchor == null) return true;
                var seq = storedFixedSeqByDay[st.anchor] || [];
                var i = seq.indexOf(String(id));
                for (var k = 0; k < i; k++) {
                    var pst = state[seq[k]];
                    if (!pst) continue;
                    if (pst.remaining > 0 || (pst.perPass <= 0 && !pst.placedEmpty)) return false;
                }
                return true;
            }
            function monolithFilter(ids) {
                var ready = ids.filter(monolithReady);
                return ready.length ? ready : ids;   // страховка от тупика: пусто — берём как есть
            }
            function pending() {
                return poolOrder.filter(function(id){ return state[id].remaining > 0 || (state[id].perPass <= 0 && !state[id].placedEmpty); });
            }
            // #4434 п.1: ЗАМОК ДНЯ АБСОЛЮТЕН. Указатель дня не имеет права уйти вперёд, пока на
            // текущем дне остались НЕразмещённые зафиксированные (🔒) резки: уйдя, он оставляет их
            // «позади», и они попадают в ветку stranded, которая раньше снимала им замок и клала на
            // текущий день — 🔒 молча переезжало (issue #4434 п.1). Ждём: 🔒 этого дня разместим
            // здесь же, пусть и с перегрузом дня.
            function fixedPendingOn(d) {
                for (var fi = 0; fi < poolOrder.length; fi++) {
                    var fst = state[poolOrder[fi]];
                    if (fst.fixedDay !== d) continue;
                    if (fst.remaining > 0 || (fst.perPass <= 0 && !fst.placedEmpty)) return true;
                }
                return false;
            }
            // #4434 п.1: перейти на следующий день. Возвращает false и НЕ двигает день, если на нём
            // ещё стоят 🔒 (их размещаем на их дне). Единая точка ухода с дня для всех веток разрыва.
            // Отказ помечает день в forceFixedDay: следующий выбор берёт 🔒 этого дня ВПЕРЁД продолжений
            // и свободных — иначе тот же кандидат выбирался бы снова и цикл не сходился бы.
            var forceFixedDay = {};
            function leaveDay() {
                if (fixedPendingOn(day)) { forceFixedDay[day] = true; return false; }
                day += 1; clock = 0; return true;
            }
            // #3974: среди кандидатов — приоритет (по возрастанию ключа): нефольга раньше фольги
            // (#3717 — фольга в конец дня), затем минимальная переналадка от prevPhysical
            // (непрерывность конфигурации, «начинать с той конфигурации, на которой закончили»),
            // затем — при РАВНОЙ переналадке — БОЛЬШЕ полос раньше (#3999), затем исходный порядок
            // очереди (idx). Срок (EDD) в раскладке не участвует (#3974).
            // #3999: направленное убывание полос (#3996/#3991) жило только в orderCuts→sequencingCost,
            // а РЕАЛЬНЫЙ порядок дня собирает этот жадный упаковщик по чистой переналадке
            // (setupCostFor=changeoverParts, физминуты #3600), из-за чего число полос по дню не
            // убывало (issue #3999: Станок 1 23.06 — 18,18,11,11,9, затем блок 29). Добавляем число
            // полос по УБЫВАНИЮ ТАЙ-БРЕЙКОМ — ниже переналадки (группировка сырья/ножей #3783 остаётся
            // главной, «блоки сырья → число полос», ТЗ §14), выше idx. Действует лишь «при прочих
            // равных» (одинаковая переналадка) — суммарной переналадки не ухудшает, но каждый день
            // теперь начинается с бо́льшего числа ножей и убывает к вечеру (#3130).
            // #4085 (модель #3985): EDD-приоритет `dueDay × DEADLINE_COST_MN` (#4059) в этом фолбэк-ключе
            // СНЯТ — срок теперь локальный штраф в слое размещения (scorePosition), а не сортировка дней
            // здесь. `deadlineCostFor` удалён; порядок фолбэка — только переналадка/полосы (см. ключ ниже).
            function selectByConfig(ids) {
                var best = null;
                ids.forEach(function(id){
                    var c = state[id].cut;
                    var key = orderAuthoritative
                        ? [ state[id].idx ]   // #4085: порядок слоя размещения — по исходному индексу
                        // #4085 (модель #3985): жёсткая «фольга-last» (#3717) и EDD-приоритет `dueDay×вес`
                        // (#4059) СНЯТЫ — фолбэк-порядок пакера только по переналадке и полосам (#3785).
                        : [ setupCostFor(prevPhysical, c), -stripBandCount(c), state[id].idx ];
                    if (!best) { best = { id: id, key: key }; return; }
                    for (var k = 0; k < key.length; k++) {
                        if (key[k] < best.key[k]) { best = { id: id, key: key }; return; }
                        if (key[k] > best.key[k]) return;
                    }
                });
                return best && best.id;
            }
            // Предохранитель от зацикливания: каждая итерация уменьшает remaining либо
            // ставит настройку и двигает день (после чего проход точно ложится). Верхняя
            // оценка — по суммарным проходам + запас на дни/настройки. На практике не срабатывает.
            var totalRuns = 0;
            poolOrder.forEach(function(id){ totalRuns += Math.max(0, state[id].remaining); });
            var guard = 0, guardMax = (totalRuns + (orderedCuts || []).length + 8) * 8 + 1024;
            // #4068: резервная дедлайн-фольга не участвует в обычном выборе, пока не наступил её день.
            function isReservedFoil(id){ return state[id].resFoilDay != null; }
            // #4068: влезает ли обычная (нерезервная) резка в ёмкость дня МИНУС резерв под фольгу —
            // хотя бы один проход или наладочный хвост. false → нефольга в бюджет дня исчерпана, пора
            // ставить резервную фольгу в зарезервированный хвост (конец дня). Зеркалит логику ниже.
            // #4464: явное место в дне для приколотого ручным переносом 🗓 задания:
            // 'start' — «в начало дня», 'end' — «в конец дня» (форма #4221). Задаёт контроллер
            // (moveCutToDay → moveScope.pinDayPosByCut); пусто — место выбирает планировщик.
            var pinDayPosMap = opts.pinDayPosByCut || {};
            function pinDayPosOf(id){
                var v = pinDayPosMap[String(id)];
                return v === 'start' || v === 'end' ? v : '';
            }
            // #4461: останется ли на дне место под 🔒 этого дня, если ВПЕРЁД неё положить свободную
            // резку cand. Правило #3792 («на своём дне 🔒 берётся раньше свободных») защищало ЁМКОСТЬ —
            // чтобы нахлёст свободных не вытеснил зафиксированную с её дня. Но оно диктовало и ПОЗИЦИЮ:
            // 🔒 вставала в голову дня, обгоняя свободные, чей порядок уже выбран слоем размещения (§8)
            // со всеми штрафами, включая штраф разрыва последовательности (#4454). Гарантию оставляем,
            // позицию возвращаем очереди: свободную пропускаем вперёд, пока после неё каждая 🔒 этого
            // дня ещё начинается в пределах ёмкости (наладка + один проход). Мерка — как pickFitsReduced.
            function fixedRoomAfter(candId, fixedIds){
                if (candId == null) return false;
                if (!fixedIds || !fixedIds.length) return true;
                var cst = state[candId], cap = effCapacity(day);
                var used = round3(clock + setupCostFor(prevPhysical, cst.cut)
                    + (cst.perPass > 0 ? cst.perPass + leader : 0));
                var prevCut = cst.cut;
                for (var fi = 0; fi < fixedIds.length; fi++){
                    var fst = state[fixedIds[fi]];
                    used = round3(used + setupCostFor(prevCut, fst.cut)
                        + (fst.perPass > 0 ? fst.perPass + leader : 0));
                    if (used > cap) return false;
                    prevCut = fst.cut;
                }
                return true;
            }
            // #4497 (ТЗ §15): стояло ли свободное задание cand ПЕРЕД этой 🔒 в ХРАНИМОМ плане — тот же
            // день, раньше по «Дате план». Только такому разрешено идти впереди 🔒; всё остальное
            // (новое от «Сгенерировать», приезжее из другого дня, хвост разбиения) — только ПОСЛЕ неё.
            function storedPlanTs(id){
                var v = Number(state[id] && state[id].cut && state[id].cut.planDate);
                return (isFinite(v) && v > 0) ? v : null;
            }
            // Хранимый СТАНОК задания (`c.slitter.id`); слой размещения назначает новый станок, а этот
            // остаётся тем, где задание лежало. null — неизвестен (очередь одного станка в тестах).
            function storedSidOf(id){
                var c = state[id] && state[id].cut;
                var sid = c && ((c.slitter && c.slitter.id != null) ? c.slitter.id : c.slitterId);
                return (sid == null || String(sid) === '') ? null : String(sid);
            }
            function storedBeforeFixed(candId, fixedId){
                var fst = state[fixedId];
                if (!fst || fst.anchor == null) return false;   // хранимого дня 🔒 нет — сравнивать нечем
                var a = storedPlanTs(candId), b = storedPlanTs(fixedId);
                if (a == null || b == null || a >= b) return false;   // стояло позже / хранимого времени нет
                // #4497 follow-up: «стоял перед ней» — это место НА ТОМ ЖЕ СТАНКЕ. Задание, лежавшее в
                // тот же день на ДРУГОМ станке, перед этой 🔒 не стояло: приехав сюда, оно новое для дня
                // и обязано встать после неё. Без сравнения станков шесть заданий, переехавших со
                // Станка 2, вставали в голову дня Станка 1 и выдавливали 🔒 на следующий день (боевое:
                // Станок 1, Чт 30.07.2026 — 649432 и 653120 сдвинуты, одна 🔒 уехала на 31.07).
                var cs = storedSidOf(candId), fs = storedSidOf(fixedId);
                if (cs !== fs) return false;
                var cDay = storedDayBy[String(candId)];
                // Хранимый день задания: из карты (её даёт planCutOperations) либо — если карту не
                // передали — по «Дате план» относительно 🔒: одна смена = ±12 ч от её старта.
                if (cDay != null) return Number(cDay) === Number(fst.anchor);
                return (b - a) < 43200;
            }
            // #4497: 🔒, чьё место в дне правило НЕ защищает от кандидата cand:
            //   • её двигает оператор прямо сейчас (ручной перенос — ТЗ §15);
            //   • это ФОЛЬГА, а кандидат — нефольга: «фольга всегда в конец дня» (#3717) той же
            //     твёрдости, и 🔒-фольга от уступки не страдает — она остаётся последней в дне;
            //   • кандидат стоял перед ней в ХРАНИМОМ плане (его место не переворачиваем).
            function fixedYieldsTo(fixedId, candId, atDay){
                if (wholeDayBy[fixedId] != null) return true;
                if (storedPlanTs(fixedId) == null) return true;   // хранимого места у 🔒 нет — защищать нечего
                var fst = state[fixedId], cst = state[candId];
                // Приезжая 🔒 (её день сдвинул потолок, #4467/#4491): в ЭТОМ дне её место не хранимое —
                // защищать нечего, порядок между 🔒 держит FIXED_BLOCK, а день — FIXED_CUT_DAY.
                if (atDay != null && fst && fst.anchor !== atDay) return true;
                if (fst && cst && fst.cut && cst.cut && fst.cut.isFoil && !cst.cut.isFoil) return true;
                return storedBeforeFixed(candId, fixedId);
            }
            // #4497: первый день ПОСЛЕ d, в который станок вообще работает — туда уехал бы хвост разбиения.
            function nextWorkDay(d){
                var n = d + 1, g = 0;
                while (dayFullyBlocked(n) && g++ < 400) n += 1;
                return n;
            }
            // #4497 (ТЗ §15): МОЖНО ЛИ РВАТЬ задание id, если хвост уедет в день nd. Нельзя, когда в
            // этом дне стои́т 🔒, которую хвост сдвинул бы: продолжение доводят ПЕРВЫМ (inProgress),
            // значит оно займёт голову дня, а 🔒 уедет на его длительность. Тогда задание уезжает
            // ЦЕЛИКОМ — в этот день ПОСЛЕ 🔒 либо дальше (ТЗ §15, «на следующее свободное место»).
            // НЕ ограничивает: ручной перенос 🗓 (ТЗ §15: ручное действие оператора не ограничено),
            // саму 🔒 (её рвёт потолок дня — #4304/#4467, потолок сильнее замка), уже начатое
            // продолжение (работа идёт) и задание, стоявшее перед этой 🔒 в хранимом плане. И не
            // ограничивает физику: задание, которое не влезает даже в ПУСТУЮ смену, рвать придётся —
            // смена не может быть длиннее себя (#4467), проход атомарен (#4149).
            function maySplitInto(id, nd){
                var st2 = state[id];
                if (!st2 || st2.isCont || st2.fixedDay != null || wholeDayBy[String(id)] != null) return true;
                var blocked = false;
                for (var bi = 0; bi < poolOrder.length; bi++){
                    var fid = poolOrder[bi], fst2 = state[fid];
                    if (!fst2 || fst2.fixedDay !== nd) continue;
                    if (!(fst2.remaining > 0 || (fst2.perPass <= 0 && !fst2.placedEmpty))) continue;   // уже размещена
                    if (fixedYieldsTo(fid, id, nd)) continue;
                    blocked = true; break;
                }
                if (!blocked) return true;
                var needWhole = round3(setupCostFor(prevPhysical, st2.cut) + st2.remaining * (st2.perPass + leader));
                return needWhole > round3(effCapacity(nd) + overCuts);   // #4563: нахлёст — из общей функции
            }
            function pickFitsReduced(id){
                var reserve = reserveForDay(day);
                if (reserve <= 0) return true;
                var st = state[id], c = st.cut;
                if (!(st.remaining > 0) || !(st.perPass > 0) || !hasWindow) return true;   // вырожденную кладём всегда
                var setup = st.isCont ? (Number(st.pendingSetup) || 0) : setupCostFor(prevPhysical, c);
                var perPassEff = st.perPass + leader;
                if (Math.floor((availFor(day, 'cuts') - reserve - setup) / perPassEff) >= 1) return true;
                if (clock > 0 && !st.isCont && setup > 0) {   // #3847: наладочный хвост в ёмкость−резерв
                    var room = round3(effCapacity(day) - reserve - clock);
                    var tail = minOverlapTailSetupMinutes(setupPartsFor(prevPhysical, c), room, setup);
                    if (tail > 0 && (availFor(day, 'tune') - reserve) >= tail) return true;
                }
                return false;
            }
            while (guard++ < guardMax) {
                var rem = pending();
                if (!rem.length) break;
                // #4418: день ЦЕЛИКОМ закрыт для станка (выходной/праздник «Календаря» #3788 или
                // «Отпуск» #3764 на всё рабочее окно) — пропускаем его СРАЗУ. Иначе упаковщик клал
                // сюда «логически», а сдвиг за простой (applyDowntime) переносил сегменты на первый
                // рабочий день ПОСЛЕ — и ось дней упаковщика расходилась с календарём: остаток
                // разорванной фикс-резки уезжал на «логический» день 1 → календарный 27.07, а
                // зафиксированная НА 27.07 резка (fixedDay = календарный день 3) вставала «после»
                // него и правилом #3951 выталкивалась на 28.07 (issue #4418: «перенёс на 27 —
                // оказалось на 28», хотя день занят на 180 из 450 минут).
                if (dayFullyBlocked(day)) { day += 1; clock = 0; continue; }
                // #4068: резервная фольга дня уже поставлена (в rem её нет), но резерв дня был — день
                // закрыт для нефольги (она не встаёт ПОСЛЕ фольги), переходим на следующий день.
                if (reserveForDay(day) > 0 && clock > 0 && !rem.some(function(id){ return state[id].resFoilDay === day; })) {
                    if (leaveDay()) continue;   // #4434 п.1: с дня не уходим, пока на нём есть 🔒
                }
                // Незавершённая резка (продолжение, ножи на станке) — доводим её первой.
                var inProgress = rem.filter(function(id){ return state[id].isCont && state[id].remaining > 0; });
                // #3792: «Зафиксировано» — замок на день. Фиксированная резка ложится ТОЛЬКО на
                // свой день (fixedDay === day): в пул «тянуть будущее вперёд» (#3739) не попадает,
                // а на своём дне берётся раньше свободных, чтобы её не вытеснил их нахлёст. Свободные
                // (fixedDay == null) — как прежде: по сроку (anchor ≤ day), иначе тянем будущую вперёд.
                var fixedToday = rem.filter(function(id){ return state[id].fixedDay != null && state[id].fixedDay === day; });
                // #4068: резервную дедлайн-фольгу исключаем из обычных пулов ДО её дня; на её дне она
                // берётся ниже (после нефольги, влезающей в ёмкость−резерв) — в хвост, конец дня.
                // #4497: `deferDay` — задание, которое НЕЛЬЗЯ рвать в этот день (хвост сдвинул бы 🔒
                // следующего дня) и которое целиком в остаток дня не влезло: на ЭТОМ дне его больше не
                // предлагаем, оно уезжает целиком. Метка на день, поэтому назавтра оно снова кандидат.
                // #4542 (ТЗ §15): в оба пула не пускаем задание, которое на этом дне ОБОГНАЛО БЫ 🔒
                // (floorAllows) — ни как «созревшее по сроку», ни как подтянутое из будущего.
                var freeDue = rem.filter(function(id){ return state[id].fixedDay == null && !isReservedFoil(id) && state[id].deferDay !== day && floorAllows(id, day) && (state[id].anchor == null || state[id].anchor <= day); });
                var freeAny = rem.filter(function(id){ return state[id].fixedDay == null && !isReservedFoil(id) && state[id].deferDay !== day && floorAllows(id, day); });
                var resFoilToday = rem.filter(function(id){ return state[id].resFoilDay === day && state[id].fixedDay == null; });
                // #4326-seal: ЗАМОРОЗКА — планировщик НЕ кладёт в этот день ничего НОВОГО. Существующие
                // резки замороженного дня закреплены (#4326: c.fixed → fixedDay===day) и остаются здесь;
                // незавершённое продолжение доводим. Свободные и резервную фольгу НЕ берём — они уходят
                // на следующий день (их наладка настраивается там же). Когда на замороженном дне брать
                // нечего (нет продолжения/закреплённых) — переходим на следующий день, иначе свободные
                // всё равно встали бы сюда (баг Варианта A: «срочные вставали в замороженный день»).
                if (opts.frozenDayFor && opts.frozenDayFor(day)) {
                    // #4494: ОСТАТОК ЗАДАНИЯ РУЧНОГО ПЕРЕНОСА в замороженный день НЕ доводим. Его
                    // голову оператор положил в замороженный день сам, а всё, что не влезло в смену,
                    // обязано уехать к ближайшему СВОБОДНОМУ дню (решение заказчика 29.07.2026):
                    // иначе разрыв по потолку просто перекладывал бы перегруз в следующий
                    // замороженный день. Чужие продолжения доводим как раньше — их наладка здесь.
                    inProgress = inProgress.filter(function(id){ return wholeDayIds.indexOf(String(id)) === -1; });
                    // #4512: и остаток, родившийся разрывом 🔒 по потолку, — тоже не доводим здесь.
                    inProgress = inProgress.filter(function(id){ return !state[id].splitFromFixed; });
                    if (!inProgress.length && !fixedToday.length) { day += 1; clock = 0; continue; }
                    freeDue = []; freeAny = []; resFoilToday = [];
                }
                var pick;
                // #4434 п.1: день ИСЧЕРПАН (занято больше ёмкости) — с него можно уйти только тогда,
                // когда на нём не осталось 🔒: замок дня абсолютен. Поэтому на исчерпанном дне 🔒 берём
                // ПЕРЕД продолжением: продолжение всё равно уедет на следующий день (там его ветка это
                // и сделает), а зафиксированное обязано лечь здесь — иначе указатель дня уйдёт вперёд и
                // 🔒 «отстанет» (прежний путь: ветка stranded снимала замок и задание переезжало).
                var dayExhausted = clock > 0 && (effCapacity(day) - clock) <= 0;
                // #4461: 🔒 своего дня идёт вперёд свободных, ПОКА ЭТО НЕ СТОИТ ЛИШНЕЙ ПЕРЕНАЛАДКИ.
                // Правило #3792 («на своём дне 🔒 берётся раньше свободных») защищало ЁМКОСТЬ — чтобы
                // нахлёст свободных не вытеснил зафиксированную с её дня. Но оно брало 🔒 первой ВСЕГДА,
                // а значит рвало блок одинаковых ножей, который слой размещения (§8) собрал со всеми
                // штрафами, включая штраф разрыва последовательности (#4454). Боевой случай (ateh1,
                // 29.07.2026, Станок 2): 647845 (110/55, 14 полос) → 🔒 647159 (150/59, 7 полос) →
                // 646483 (110/55, 14 полос) — две смены ножей там, где §8 не оставил ни одной; день
                // 459 мин вместо 429 (issue #4461). Замок 🔒 — на ДЕНЬ, а не на голову дня: пропускаем
                // свободную вперёд, когда с текущей заправки она ДЕШЕВЛЕ, и только пока после неё 🔒
                // этого дня ещё влезает в день (fixedRoomAfter) — гарантия #3792 цела. Ничья по
                // переналадке остаётся за 🔒 (прежнее поведение, в т.ч. прикол 🗓 «в начало дня» #4221).
                var freeCandNow = freeDue.length ? selectByConfig(freeDue)
                                : (freeAny.length ? selectByConfig(freeAny) : null);
                // #4464: ручной перенос 🗓 с явным местом в дне — «в начало дня» берём первой,
                // «в конец дня» держим до последнего (после всех свободных этого дня). Прежде оба
                // варианта давали ГОЛОВУ дня: приколотое задание забиралось правилом #3792, и
                // «в конец» не работало вовсе. Место 🔒-монолита от этого не страдает — приколотое
                // задание встаёт ПЕРЕД блоком или ПОСЛЕ него, но не между его звеньями.
                var headPinToday = fixedToday.filter(function(id){ return pinDayPosOf(id) === 'start'; });
                var tailPinToday = fixedToday.filter(function(id){ return pinDayPosOf(id) === 'end'; });
                // #4491: среди 🔒 этого дня берём только те, чьи предшественники по монолиту уже
                // размещены — иначе уехавшая пара приезжает в новый день в обратном порядке.
                var fixedNow = monolithFilter(fixedToday.filter(function(id){ return pinDayPosOf(id) !== 'end'; }));
                // #4464: МОНОЛИТ 🔒 — если только что легло зафиксированное задание этого дня, а
                // следующее НЕразмещённое во входной очереди тоже 🔒 этого дня, берём именно его:
                // вклиниваться между звеньями монолита нельзя (ТЗ §15).
                var monolithNext = null;
                if (!inProgress.length && prevPhysical && prevPhysical.fixed) {
                    // #4491: следующее звено берём из ХРАНИМОГО монолита ДНЯ последней 🔒, а не из
                    // очереди §8. Иначе 🔒, приехавшая из другого дня, встаёт в очереди между
                    // звеньями и рвёт пару, стоявшую подряд (боевой случай: X → C → Y вместо
                    // X → Y → C). Звено берём, только если оно всё ещё в ТЕКУЩЕМ дне.
                    var prevSt = state[String(prevPhysical.id)];
                    var seq = (prevSt && prevSt.anchor != null) ? (storedFixedSeqByDay[prevSt.anchor] || []) : [];
                    var si = seq.indexOf(String(prevPhysical.id));
                    for (var mk = si + 1; si >= 0 && mk < seq.length; mk++) {
                        var mid = seq[mk], mst = state[mid];
                        if (!mst || !(mst.remaining > 0 || (mst.perPass <= 0 && !mst.placedEmpty))) continue;
                        if (mst.fixedDay === day) monolithNext = mid;
                        break;   // смотрим ровно на СЛЕДУЮЩЕЕ неразмещённое звено монолита
                    }
                    // #4491 (ИСКЛЮЧЕНИЕ): задание, которое оператор ПРЯМО СЕЙЧАС переносит в этот
                    // день «по весу», вправе встроиться внутрь монолита — место ему выбрал §8 по
                    // минимальному штрафу, и это решение человека. Порядок ОСТАЛЬНЫХ звеньев при
                    // этом не меняется: монолит лишь расступается в одной точке.
                    if (monolithNext != null && wholeDayIds.length) {
                        var pi491 = poolOrder.indexOf(String(prevPhysical.id));
                        for (var pk = pi491 + 1; pi491 >= 0 && pk < poolOrder.length; pk++) {
                            var pid = poolOrder[pk], pst = state[pid];
                            if (!pst || !(pst.remaining > 0 || (pst.perPass <= 0 && !pst.placedEmpty))) continue;
                            if (wholeDayBy[pid] != null && pst.fixedDay === day) monolithNext = null;   // пропускаем перенесённое
                            break;
                        }
                    }
                }
                var yieldToFixedFree = false;
                if (fixedNow.length && freeCandNow != null && !inProgress.length
                    && !forceFixedDay[day] && !dayExhausted) {
                    // #4497 (ТЗ §15): КОГО ПРОПУСКАТЬ ВПЕРЁД 🔒. Перед 🔒 автоматика ничего не ставит:
                    // её место в дне — такая же часть замка, как и день. Вперёд идут только те, кому
                    // 🔒 уступает (fixedYieldsTo): стоявшие перед ней в ХРАНИМОМ плане, нефольга перед
                    // 🔒-фольгой (#3717) и всё, что оператор двигает прямо сейчас (ручной перенос —
                    // #4487/#4491). Новому заданию «Сгенерировать» и приезжему из другого дня место
                    // только ПОСЛЕ 🔒: иначе она уезжает на его длительность, а с ней — весь паровоз
                    // 🔒 за ней (issue #4497).
                    //
                    // Дальше — ПОРЯДОК §8 (#4487): среди пропущенных первым идёт тот, кого раньше
                    // поставил слой размещения (он сравнил ВСЕ штрафы разом: переналадку, разрыв
                    // последовательности #4454, срок, фольгу), а не тот, у кого дешевле попарная цена
                    // заправки. Фолбэк-порядок пакера (без слоя размещения) считает по цене заправки.
                    // Гарантия #3792 (замок держит ДЕНЬ) не трогается: пропускаем свободную ТОЛЬКО
                    // пока после неё каждая 🔒 этого дня ещё влезает в день (fixedRoomAfter).
                    // #4506: спрашиваем ВСЕ 🔒 ЭТОГО ДНЯ (`fixedToday`), а не только готовых к укладке
                    // (`fixedNow` — после фильтра монолита #4491 там бывает ровно одна). Боевой случай:
                    // первой в дне стои́т 🔒, которую оператор переносит прямо сейчас; она правилу
                    // уступает — и через открывшийся шлюз проходили ВСЕ свободные, обгоняя остальные 🔒
                    // дня, которых в `fixedNow` ещё не было (Станок 1, Чт 30.07.2026: шесть заданий
                    // встали перед 649432 и 653120, а те уехали в конец дня). Разрешение обязано быть
                    // у КАЖДОЙ 🔒, стоящей в дне, — как и у гарантии ёмкости `fixedRoomAfter` ниже.
                    var mayPassFixed = wholeDayBy[String(freeCandNow)] != null
                        || fixedToday.every(function(fid){ return fixedYieldsTo(fid, freeCandNow, day); });
                    var earlierByOrder;
                    if (orderAuthoritative) {
                        var minFixedIdx = null;
                        fixedNow.forEach(function(fid){
                            var v = state[fid].idx;
                            if (minFixedIdx == null || v < minFixedIdx) minFixedIdx = v;
                        });
                        earlierByOrder = state[freeCandNow].idx < minFixedIdx;
                    } else {
                        var freeSetup = setupCostFor(prevPhysical, state[freeCandNow].cut);
                        var fixedSetup = null;
                        fixedNow.forEach(function(fid){
                            var v = setupCostFor(prevPhysical, state[fid].cut);
                            if (fixedSetup == null || v < fixedSetup) fixedSetup = v;
                        });
                        earlierByOrder = freeSetup < fixedSetup;
                    }
                    yieldToFixedFree = mayPassFixed && earlierByOrder && fixedRoomAfter(freeCandNow, fixedToday);
                }
                if (monolithNext != null) pick = monolithNext;
                else if (headPinToday.length && !inProgress.length) pick = selectByConfig(headPinToday);
                else if (fixedNow.length && !yieldToFixedFree
                    && (forceFixedDay[day] || dayExhausted || !inProgress.length)) pick = selectByConfig(fixedNow);
                else if (inProgress.length) pick = selectByConfig(inProgress);
                else {
                    // #3974: набиваем день от «С» — selectByConfig ставит нефольгу раньше фольги
                    // (isFoil-last key), поэтому фольга уходит в конец дня (#3717) сама.
                    // #4068: сперва обычная резка, влезающая в ёмкость дня МИНУС резерв под дедлайн-фольгу;
                    // когда нефольга в этот бюджет больше не влезает — ставим резервную фольгу этого дня
                    // в зарезервированный хвост (она вытесняет поздне-срочную нефольгу за срок, ТЗ §12).
                    var cand = freeCandNow;
                    // #4464: «в конец дня» — когда свободных кандидатов на этот день больше нет.
                    if (cand == null && tailPinToday.length) cand = selectByConfig(tailPinToday);
                    if (cand != null && state[cand].fixedDay != null) pick = cand;   // 🔒 — мимо резерва фольги
                    else if (cand != null && pickFitsReduced(cand)) pick = cand;
                    else if (resFoilToday.length) pick = selectByConfig(resFoilToday);
                    else if (cand != null) pick = cand;   // резерва под сегодня нет — обычное переполнение (day++ ниже)
                    else {
                        // #4497: на дне остались задания, которые нельзя рвать в день с 🔒 (deferDay) —
                        // уходим на следующий день, там они лягут целиком ПОСЛЕ 🔒. Без этой ветки они
                        // попали бы в «прыжок к ближайшему фикс-дню» ниже и потерялись бы из плана.
                        if (rem.some(function(id){ return state[id].deferDay === day; })) { leaveDay(); continue; }
                        // Остались только будущие зафиксированные/резервные — прыгаем к ближайшему их дню
                        // (свободных в пуле нет, нахлёст-простой заполнять некем).
                        var nextDay = null;
                        rem.forEach(function(id){
                            // #4542: и день, раньше которого свободное задание не встаёт (обгон 🔒),
                            // — иначе оно провалилось бы в ветку «дня нет» и легло бы ЗДЕСЬ, обогнав замок.
                            [state[id].fixedDay, state[id].resFoilDay, fixedFloorDay[String(id)]].forEach(function(d){
                                if (d != null && d > day && (nextDay == null || d < nextDay)) nextDay = d;
                            });
                        });
                        if (nextDay == null) {
                            // #4434 п.1: сюда доходят зафикс-резки (fixedDay ≥ 0), чей день уже ПОЗАДИ.
                            // Обычное переполнение дня сюда больше не приводит — leaveDay() не отпускает
                            // указатель с дня, пока на нём есть 🔒. Остаётся единственная физическая
                            // причина: день 🔒 ЦЕЛИКОМ нерабочий (выходной/праздник «Календаря» #3788 или
                            // «Отпуск» станка #3764 на всё окно) — разместить на нём нечего. Бросить
                            // задание нельзя (пропадёт из плана), поэтому кладём с текущего дня и КРИЧИМ
                            // (ТЗ §14, [[crm-no-silent-fallback]]) — оператор обязан узнать, что замок дня
                            // не соблюдён, а не обнаружить это глазами. Зафикс-резку РАНЬШЕ «С» (fixedDay < 0)
                            // НЕ трогаем — она остаётся на своём прошлом дне (#3974).
                            var stranded = rem.filter(function(id){ return state[id].fixedDay != null && state[id].fixedDay >= 0; });
                            if (!stranded.length) break;
                            // #4512 (ТЗ §15, решение заказчика 30.07.2026): БЛОКЕР «🔒 НЕ ВЫКИДЫВАЕМ».
                            // Эта ветка объявляла причиной «день нерабочий» ВСЁ, что сюда дошло, и снимала
                            // замок. Трассировка боевого случая (issue #4513, ateh 30.07.2026) показала
                            // ложные вердикты: «задание 648799 не удержало свой день 1 — день нерабочий,
                            // размещено с дня 8», хотя день 1 = пт 31.07.2026 — обычный рабочий день
                            // (в «Календаре» исключений нет, «Отпуск станка» пуст, заморозка только по
                            // 29.07). Так зафиксированный паровоз улетал на неделю вперёд, освобождая день
                            // незафиксированным заданиям. Теперь замок снимается ТОЛЬКО когда день ФИЗИЧЕСКИ
                            // нерабочий (`dayFullyBlocked` — окно смены целиком накрыто выходным/праздником/
                            // «Отпуском»). Иначе возвращаем указатель на день 🔒 и кладём её ТАМ: день уйдёт
                            // за потолок (это видно оператору), но задание останется в своём дне.
                            var keepOwnDay = stranded.filter(function(id){ return !dayFullyBlocked(state[id].fixedDay); });
                            if (keepOwnDay.length) {
                                var backDay = null;
                                keepOwnDay.forEach(function(id){
                                    state[id].strandedOwnDay = true;   // #4512: лестница #4467 её больше не выталкивает
                                    var fd = state[id].fixedDay;
                                    if (backDay == null || fd < backDay) backDay = fd;
                                    // #4512: сообщаем, что замок УДЕРЖАН — симметрично onFixedDayLost. По
                                    // этому вердикту страж DAY_CAPACITY знает, что перебор дня ЗАКОННЫЙ:
                                    // день вместил 🔒, которую вытеснять нельзя. Иначе аудит ругался бы на
                                    // каждый такой день, а его сообщения видит оператор (#4475).
                                    // Станок упаковщик не знает (его очередь одна) — сопоставит контроллер по заданию.
                                    if (typeof opts.onFixedDayHeld === 'function') opts.onFixedDayHeld(String(id), fd);
                                });
                                ppTraceWarn('#4512 ЗАМОК ЦЕЛ: зафикс-резки ' + keepOwnDay.join(', ') +
                                    ' остаются в своих днях (день рабочий) — возвращаемся на день ' + backDay +
                                    '; день может уйти за потолок.');
                                day = backDay; clock = dayWholeOccupied(backDay);
                                continue;
                            }
                            stranded.forEach(function(id){
                                var lostDay = state[id].fixedDay;
                                state[id].fixedDay = null;   // разместить на своём дне физически нельзя
                                ppTraceWarn('#4434 ⛔ ЗАМОК ДНЯ НЕ СОБЛЮДЁН: зафикс-резка ' + id + ' (день ' + lostDay +
                                    ') — этот день нерабочий для станка; кладём с дня ' + day);
                                if (typeof console !== 'undefined' && console.error) {
                                    console.error('[pp] ⛔ #4434: зафиксированное задание ' + id + ' не удержало свой день ' +
                                        lostDay + ' — день нерабочий (выходной/праздник/«Отпуск» станка). Размещено с дня ' + day + '.');
                                }
                                if (typeof opts.onFixedDayLost === 'function') opts.onFixedDayLost(String(id), lostDay, day);
                            });
                            continue;
                        }
                        day = nextDay; clock = 0; continue;
                    }
                }
                var st = state[pick], c = st.cut;
                // #3914: что взяли на размещение и в каком состоянии день (время суток = dayStart+clock).
                ppTrace('day ' + day + ' ' + ppClock(dayStart + clock) + ' (занято ' + Math.round(clock) + ') → выбрана резка ' + pick +
                    (c && c.isFoil ? ' [ФОЛЬГА]' : '') +
                    (st.fixedDay != null ? ' [ЗАФИКСИРОВАНА day=' + st.fixedDay + ']' : '') +
                    (st.isCont ? ' [продолжение]' : '') +
                    ' остаток проходов=' + st.remaining + '/проход=' + Math.round(st.perPass));
                // #3792/#4304: зафиксированная резка держит СВОЙ ДЕНЬ (голова), но, как и обычная,
                // РАЗРЫВАЕТСЯ по потолку дня (cutEndMin + нахлёст), а не кладётся целиком за смену
                // (issue #4304: 158 проходов до 20:33). Голова с влезающими проходами остаётся на
                // зафиксированном дне; остаток — продолжением на следующий день (снимаем fixedDay,
                // чтобы остаток шёл штатной веткой продолжения). Настройка — переналадка с предыдущей
                // физической резкой.
                if (st.fixedDay != null) {
                    insertLunchBefore();
                    var setupF = setupCostFor(prevPhysical, c);
                    var perPassF = st.perPass + leader;
                    var canRunF = st.remaining > 0 && st.perPass > 0 && hasWindow;
                    // #4304: сколько проходов влезает в день до потолка нахлёста РЕЗКИ (как обычная резка,
                    // #3821/#3847). availFor уже учёл занятость дня и обед.
                    var availCutsF = availFor(day, 'cuts', pick);   // #4488: своё место под резервом не считаем
                    var fittingF = (canRunF && availCutsF >= setupF) ? Math.floor((availCutsF - setupF) / perPassF) : 0;
                    if (fittingF < 0) fittingF = 0;
                    // #4467: ПОТОЛОК ДНЯ СИЛЬНЕЕ ЗАМКА ДНЯ. Прежде (#4434 п.1) 🔒, влезавшая в ПУСТОЙ
                    // день, но не в остаток занятого, клалась на свой день ЦЕЛИКОМ С ПЕРЕГРУЗОМ —
                    // отсюда «день разбухает» (боевой сценарий: оператор переносит задания в день и
                    // фиксирует их, пока сумма не перевалит за смену). Оператор отвечает за наполнение
                    // дня, но не за физику: день не может быть длиннее смены с нахлёстом. Поэтому 🔒
                    // теперь ведёт себя как обычная резка — рвётся по потолку (#4304), а если в остаток
                    // дня не влезает ни одного прохода, уезжает на следующий день ЦЕЛИКОМ (ниже).
                    if (!canRunF || fittingF >= st.remaining) {
                        // #3792: влезает целиком (в пределах нахлёста) ИЛИ вырожденная (0 проходов/без
                        // окна) — один сегмент на зафиксированном дне, БЕЗ разрыва.
                        var wsF = day * 1440 + dayStart + clock;
                        var durF = canRunF ? st.remaining * perPassF : 0;
                        var colsF = setupColsFor(prevPhysical, c, setupF, st.isCont, st.pendingParts);   // #4499/#4529
                        segments.push({ cutId: pick, dayOffset: day, runs: st.remaining,
                            windowStartMin: round3(wsF), startMin: round3(wsF + setupF), setupMin: round3(setupF),
                            durationMin: round3(durF), isContinuation: false, parentCutId: null,
                            setupKnifeMin: colsF.knife, setupMaterialMin: colsF.material,
                            fixedDayLock: true });   // #4434 п.1: сегмент 🔒 — потолок нахлёста его с дня не выталкивает
                        clock += setupF + durF;
                        ppTrace('  ФИКС-резка ' + pick + ' целиком на дне ' + day + ': настр ' + Math.round(setupF) +
                            ' + намотка ' + Math.round(durF) + ' → занято ' + Math.round(clock));
                        prevPhysical = c; prevPhysicalDay = day; st.remaining = 0; st.placedEmpty = true;
                        continue;
                    }
                    // ЛЕСТНИЦА #4467 СНЯТА (#4511/#4512/#4513, решение заказчика 30.07.2026).
                    //
                    // Здесь стоял вывоз 🔒 на следующий день целиком, когда в остаток дня не влезает ни
                    // одного прохода: «потолок дня сильнее замка дня» (#4467, решение 28.07.2026). Это
                    // решение ОТМЕНЕНО обратным: «не вытеснять и не переносить зафиксированные задания
                    // из дня — НИ ПРИ КАКИХ ОБСТОЯТЕЛЬСТВАХ. Можно разорвать последнее задание и
                    // перенести на другой день» (#4512). Боевая цена прежнего порядка — #4513:
                    // зафиксированный «паровоз» из 30.07 целиком уехал в 31.07 ради нескольких
                    // незафиксированных заданий.
                    //
                    // Что происходит вместо вывоза: управление ПАДАЕТ НИЖЕ, в ветку #4304 — 🔒 РВЁТСЯ
                    // по потолку дня. Голова (хотя бы один проход) остаётся на зафиксированном дне,
                    // остаток уезжает продолжением. Это дословно то, что разрешил заказчик, и путь этот
                    // уже существовал и покрыт тестами — новой механики не появляется.
                    // День при этом вправе уйти за потолок: перебор ИЗ-ЗА неснимаемой 🔒 законен и
                    // нарушением не считается (страж DAY_CAPACITY о таких днях молчит — `fixedHeldDays`).
                    //
                    // Вытеснять по-прежнему НАДО, но только НЕЗАФИКСИРОВАННЫХ соседей (#4511) — этим
                    // занимается основная ветка упаковщика, её правило не касается.
                    // #4304: НЕ влезает — РАЗРЫВАЕМ зафиксированную резку по потолку дня. Голова с fittingF
                    // проходами (хотя бы 1, чтобы фикс-день нёс проходы) остаётся на зафиксированном дне;
                    // остаток — продолжением на следующий день. fixedDay снимаем: остаток идёт штатной
                    // веткой продолжения (inProgress), продолжение НЕ зафиксировано. Красное предупреждение
                    // рисует рендер: зафикс-резка с признаком дробления «→» (#4304 renderQueue).
                    var passesNowF = fittingF > 0 ? fittingF : 1;   // хотя бы 1 проход держим на фикс-дне
                    var wsF2 = day * 1440 + dayStart + clock;
                    var durF2 = passesNowF * perPassF;
                    var colsF2 = setupColsFor(prevPhysical, c, setupF, st.isCont, st.pendingParts);   // #4499/#4529
                    segments.push({ cutId: pick, dayOffset: day, runs: passesNowF,
                        windowStartMin: round3(wsF2), startMin: round3(wsF2 + setupF), setupMin: round3(setupF),
                        durationMin: round3(durF2), isContinuation: false, parentCutId: null,
                        setupKnifeMin: colsF2.knife, setupMaterialMin: colsF2.material,
                        fixedDayLock: true });   // #4434 п.1: голова 🔒 остаётся на зафиксированном дне
                    st.remaining -= passesNowF; st.isCont = true; st.pendingSetup = 0; st.pendingParts = null; st.fixedDay = null; prevPhysical = c; prevPhysicalDay = day;
                    // #4512: остаток РОЖДЁН разрывом 🔒 сегодня — для замороженного дня он НОВЫЙ, а
                    // не «недоведённое продолжение, чья наладка здесь». Кладём его по тому же
                    // правилу, что и остаток ручного переноса (#4494, решение заказчика 29.07.2026):
                    // к ближайшему СВОБОДНОМУ дню, замороженные пропускаем.
                    st.splitFromFixed = true;
                    ppTraceWarn('#4304 ЗАФИКС-резка ' + pick + ' РАЗОРВАНА по потолку дня: ' + passesNowF +
                        ' проходов на дне ' + day + ' (конец ' + ppClock(dayStart + clock + setupF + durF2) + '), остаток ' +
                        st.remaining + ' проходов → день ' + (day + 1));
                    // #4434 п.1: голова осталась на зафиксированном дне; уйти с дня можно, только если
                    // на нём не осталось ДРУГИХ 🔒 (иначе они «отстанут» от указателя и переедут).
                    clock += setupF + durF2;
                    leaveDay();
                    continue;
                }
                // #3792: предыдущая фикс-резка могла переполнить день (нахлёст) — свободные тогда
                // начинают со следующего дня, без хвостовой настройки на уже переполненном дне.
                if (clock > 0 && (effCapacity(day) - clock) < 0) { if (leaveDay()) continue; }   // #4434 п.1: 🔒 этого дня — сначала
                insertLunchBefore();
                // Резка без проходов/окна — один сегментик (как базовая ветка).
                if (!(st.remaining > 0) || !(st.perPass > 0) || !hasWindow) {
                    var s0 = leader + setupCostFor(prevPhysical, c);
                    var w0 = day * 1440 + dayStart + clock;
                    var cols0 = setupColsFor(prevPhysical, c, s0, st.isCont, st.pendingParts);   // #4499/#4529
                    segments.push({ cutId: pick, dayOffset: day, runs: st.remaining,
                        windowStartMin: round3(w0), startMin: round3(w0 + s0), setupMin: round3(s0),
                        durationMin: 0, isContinuation: false, parentCutId: null,
                        setupKnifeMin: cols0.knife, setupMaterialMin: cols0.material });
                    clock += s0;
                    prevPhysical = c; prevPhysicalDay = day; st.remaining = 0; st.placedEmpty = true;
                    continue;
                }
                // #4068: обычная (нерезервная) резка не должна заходить в хвост, зарезервированный под
                // дедлайн-фольгу этого дня — её ёмкость видна МИНУС резерв; сама резервная фольга берёт
                // полный хвост (reserveNF=0). Так поздне-срочная нефольга переливается позже, а фольга
                // занимает конец дня своего срока.
                var reserveNF = (st.resFoilDay === day) ? 0 : reserveForDay(day);
                var perPassEffG = st.perPass + leader;
                var setupG = st.isCont ? (Number(st.pendingSetup) || 0) : setupCostFor(prevPhysical, c);
                var availG = effCapacity(day) - reserveNF - clock;
                // #3847: ёмкость хвоста с учётом разрешённого нахлёста. Для проходов потолок —
                // DAY_END_HOUR+MAX_OVERWORK_CUTS, для настройки — DAY_END_HOUR+MAX_OVERWORK_TUNE
                // (фича выкл → обычная ёмкость до cutEndMin, как #3821). #4068: минус резерв под фольгу.
                var availCutsG = availFor(day, 'cuts', pick) - reserveNF;   // #4488
                var availTuneG = availFor(day, 'tune', pick) - reserveNF;
                // #3821/#3847: в хвост дня кладём проходы, влезающие в ёмкость С УЧЁТОМ нахлёста —
                // последний проход обязан кончиться ≤ DAY_END_HOUR+MAX_OVERWORK_CUTS (нахлёст за
                // конец смены ограничен, а не «один любой проход» #3760 и не «строго встык» #3821:
                // короткий хвост проходит, длинный — на следующий день). Остаток проходов — на завтра;
                // не влезает ни один — настройку в хвост (ветка ниже), проходы — на завтра.
                var fittingG = (availCutsG >= setupG) ? Math.floor((availCutsG - setupG) / perPassEffG) : 0;
                if (fittingG < 0) fittingG = 0;
                // #3914: сколько минут доступно в хвосте дня до потолка нахлёста (резка/настройка).
                ppTrace('  ёмкость хвоста: до резки=' + Math.round(availCutsG) + ' до настройки=' + Math.round(availTuneG) +
                    ' | настройка=' + Math.round(setupG) + ' проход=' + round3(perPassEffG) + ' → влезает проходов=' + fittingG);
                // #4497 (ТЗ §15): РВАТЬ В ДЕНЬ, ЧЬЯ ГОЛОВА 🔒, НЕЛЬЗЯ. Хвост разбиения доводят первым
                // (inProgress), то есть он занял бы голову следующего дня и сдвинул стоящую там 🔒.
                // Задание уезжает ЦЕЛИКОМ — в тот день ПОСЛЕ 🔒 либо дальше; на этом дне его больше не
                // предлагаем (deferDay), а остаток дня добираем другими заданиями.
                if (fittingG > 0 && fittingG < st.remaining && !maySplitInto(pick, nextWorkDay(day))) {
                    st.deferDay = day;
                    ppTraceWarn('#4497 задание ' + pick + ' НЕ РВЁМ на дне ' + day + ': голову дня ' +
                        nextWorkDay(day) + ' держит зафиксированное задание — уезжает целиком.');
                    continue;
                }
                if (fittingG > 0) {
                    var passesNowG = Math.min(st.remaining, fittingG);
                    var wsG = day * 1440 + dayStart + clock, durG = passesNowG * perPassEffG;
                    var colsGn = setupColsFor(prevPhysical, c, setupG, st.isCont, st.pendingParts);   // #4499/#4529
                    segments.push({ cutId: pick, dayOffset: day, runs: passesNowG,
                        windowStartMin: round3(wsG), startMin: round3(wsG + setupG), setupMin: round3(setupG),
                        durationMin: round3(durG), isContinuation: st.isCont, parentCutId: st.isCont ? pick : null,
                        setupKnifeMin: colsGn.knife, setupMaterialMin: colsGn.material });
                    st.remaining -= passesNowG; st.isCont = true; st.pendingSetup = 0; st.pendingParts = null; prevPhysical = c; prevPhysicalDay = day;
                    // #4434 п.1: остаток — на следующий день, НО уйти с текущего можно, только если на
                    // нём не осталось 🔒 (иначе зафиксированное «отстаёт» от указателя дня и переезжает).
                    if (st.remaining > 0) { clock += setupG + durG; leaveDay(); ppTrace('  положено ' + passesNowG + ' проходов (' + Math.round(setupG + durG) + ' мин), остаток ' + st.remaining + ' → день ' + day); }     // остаток проходов — на следующий день
                    else { clock += setupG + durG; ppTrace('  положено ' + passesNowG + ' проходов (' + Math.round(setupG + durG) + ' мин) целиком, занято дня ' + Math.round(clock) + ' (конец ' + ppClock(dayStart + clock) + ')'); }
                } else if (clock > 0) {
                    // #3760/#3805/#3821: в хвост дня не влезает ни один проход. ЕСТЬ настройка — кладём в
                    // хвост НАИБОЛЬШЕЕ подмножество её компонентов (ножи/сырьё), влезающее под потолок
                    // нахлёста НАСТРОЙКИ (availFor 'tune' = cutEndMin+MAX_OVERWORK_TUNE) — единое правило
                    // хвоста chooseTailSetupSubset (#3955/#4144: «оператор делает максимум того, что успеет
                    // в пределах допустимого нахлёста»). Ничего не влезает — вся резка на следующий день
                    // ОДНОЙ карточкой (#3847), день не раздут за нахлёст (#3939). Остаток настройки
                    // (pendingSetup) + проходы уходят на день N+1. НЕТ настройки (та же конфигурация,
                    // #3821: setupG=0) — ничего в хвост, иначе пустой сегмент.
                    var tailAvailG = availFor(day, 'tune', pick) - reserveNF;   // до потолка нахлёста настройки (#3847); #4068: минус резерв; #4488
                    // Продолжение несёт слитый остаток настройки (pendingSetup) — компонентов у него нет,
                    // делить нечего: либо влезает целиком, либо не кладём.
                    var setupPartsG = st.isCont ? [{ minutes: setupG }] : setupPartsFor(prevPhysical, c);
                    // #4497 (ТЗ §15): наладочный хвост в дне N делает задание ПРОДОЛЖЕНИЕМ дня N+1, то
                    // есть головой того дня. Голову дня, которую держит 🔒, занимать нельзя — хвост не
                    // кладём, задание целиком встанет ПОСЛЕ 🔒 (или дальше).
                    var chosenG = (setupG > 0 && maySplitInto(pick, nextWorkDay(day)))
                        ? chooseTailSetupSubset(setupPartsG, tailAvailG) : null;
                    if (chosenG) {
                        var tailSetupG = chosenG.minutes;
                        var wsS = day * 1440 + dayStart + clock;
                        var colsG = tailSetupColumns(chosenG);   // #4144: разложение хвоста по колонкам для писателя
                        segments.push({ cutId: pick, dayOffset: day, runs: 0,
                            windowStartMin: round3(wsS), startMin: round3(wsS + tailSetupG), setupMin: round3(tailSetupG),
                            durationMin: 0, isContinuation: false, parentCutId: null, setupOnly: true,
                            setupKnifeMin: colsG ? colsG.knifeMin : null, setupMaterialMin: colsG ? colsG.materialWindingMin : null });
                        clock += tailSetupG; prevPhysical = c; prevPhysicalDay = day;
                        st.isCont = true; st.pendingSetup = round3(setupG - tailSetupG);
                        st.pendingParts = remainingSetupParts(setupPartsG, chosenG);   // #4529: остаток — своими кодами
                        ppTrace('  проход не влез — в хвост дня положена настройка ' + Math.round(tailSetupG) +
                            ' мин (нахлёст ≤ ' + Math.round(maxOverworkTune != null ? maxOverworkTune : 0) + '), остаток настройки ' +
                            Math.round(st.pendingSetup) + ' + проходы → день ' + (day + 1));
                    } else {
                        ppTrace('  проход не влез, настройка (' + Math.round(setupG) + ') не влезает в хвост дня в пределах нахлёста (' +
                            Math.round(tailAvailG) + ') → резка целиком на день ' + (day + 1));
                    }
                    leaveDay();   // #4434 п.1: с дня не уходим, пока на нём есть 🔒
                } else {
                    // Вырожденно: даже ПУСТОЙ день не вмещает настройку + один проход (настройка или
                    // одиночный проход длиннее целого окна). Разбить одиночный проход нельзя — кладём
                    // настройку + 1 проход с нахлёстом, остальное на следующий день (#3821: единственный
                    // случай, где нахлёстный проход сохраняется, иначе резка не разместилась бы никогда).
                    var wsO = day * 1440 + dayStart + clock, durO = 1 * perPassEffG;
                    var colsO = setupColsFor(prevPhysical, c, setupG, st.isCont, st.pendingParts);   // #4499/#4529
                    segments.push({ cutId: pick, dayOffset: day, runs: 1,
                        windowStartMin: round3(wsO), startMin: round3(wsO + setupG), setupMin: round3(setupG),
                        durationMin: round3(durO), isContinuation: st.isCont, parentCutId: st.isCont ? pick : null,
                        setupKnifeMin: colsO.knife, setupMaterialMin: colsO.material });
                    st.remaining -= 1; st.isCont = true; st.pendingSetup = 0; st.pendingParts = null; prevPhysical = c; prevPhysicalDay = day;
                    ppTraceWarn('вырожденно: настройка+1 проход (' + Math.round(setupG + perPassEffG) + ' мин) длиннее целого дня — кладём 1 проход с нахлёстом, остаток ' + st.remaining + ' → день ' + (day + 1));
                    clock += setupG + durO;
                    leaveDay();   // #4434 п.1: с дня не уходим, пока на нём есть 🔒
                }
            }
            // #4469 (ТЗ §15): недоупакованные дни этой раскладки — для стража DAY_FILL. Считаем ЗДЕСЬ,
            // потому что мерка остатка — тот же гейт потолка, которым паковали (availFor(day,'cuts') по
            // ЦЕЛОЙ занятости #4149); снаружи её не воспроизвести. applyDowntime ниже двигает окна, но
            // dayOffset сегментов не меняет — числа те же. Отдаём свойством массива: контракт возврата
            // splitMachineQueue (список сегментов) остаётся прежним, а planCutOperations собирает из
            // этого ops.dayFill — ровно как ops.dayLoad для DAY_CAPACITY (#4467).
            segments.underfilled = underfilledLayoutDays(segments, {
                freeMinFor: function(d) { return availFor(d, 'cuts'); },
                isFrozenDay: opts.frozenDayFor,
                overtakesFixedAt: function(id, d) { return !floorAllows(id, d); }   // #4542: замок сильнее набивки
            });
            (segments.underfilled || []).forEach(function(u) {
                ppTraceWarn('#4469 ДЕНЬ НЕДОУПАКОВАН: день ' + u.day + ' — свободно ' + Math.round(u.freeMin) +
                    ' мин, а проход задания ' + u.donorCutId + ' следующего дня стоит ' + round3(u.needMin) +
                    ' мин: его надо было затянуть сюда.');
            });
            // #3914: итог генерации (gapFill) по дням — какие дни превысили бюджет.
            ppTraceDaySummary('splitMachineQueue[gapFill] ИТОГ', segments,
                function(s) { return (Number(s.setupMin) || 0) + (Number(s.durationMin) || 0); },
                { dayOf: function(s) { return Math.floor(Number(s.windowStartMin) / 1440); },
                  dayStartMin: dayStart, dayEndMin: dayEnd, lunchDurationMin: (lunch ? lunch.durationMin : 0), maxOverworkTuneMin: maxOverworkTune });
            return applyDowntime(segments);   // #3764
        }
        (orderedCuts || []).forEach(function(c){
            var cid = c && c.id;
            // #3658: если очередь не дотянула до рабочего дня этой резки — прыгаем вперёд к
            // нему (08:00). Назад не двигаем (переполнение предыдущих дней сохраняется).
            var anchorDay = anchorByCut[String(cid)];
            if (anchorDay != null && anchorDay > day) { day = anchorDay; clock = 0; }
            var runs = Math.round(Number(runsByCut[String(cid)] != null ? runsByCut[String(cid)] : c && c.plannedRuns) || 0);
            var perPass = Number(perPassByCut[String(cid)] != null ? perPassByCut[String(cid)] : 0) || 0;
            var remaining = runs;
            var isCont = false;
            var pendingSetup = 0;   // #3635 п.5: остаток настройки, перенесённый на продолжение след. дня
            var pendingParts = null;   // #4529: его компоненты (ножи/сырьё) — чтобы продолжение писало их в СВОИ колонки
            insertLunchBefore();  // #3342: обед перед началом этой резки
            // Резка без проходов/длительности — один сегментик без раскладки по проходам.
            if (!(runs > 0) || !(perPass > 0) || !hasWindow) {
                var setup0 = leader + setupCostFor(prevPhysical, c);   // #3688/#3853: первая резка — от заправки станка (carryPrevSetup)
                var ws0 = day * 1440 + dayStart + clock;
                var colsZ = setupColsFor(prevPhysical, c, setup0, false);   // #4499
                segments.push({ cutId: String(cid), dayOffset: day, runs: runs, windowStartMin: round3(ws0),
                    startMin: round3(ws0 + setup0), setupMin: round3(setup0),
                    durationMin: round3((runs > 0 && perPass > 0) ? runs * perPass : 0),
                    isContinuation: false, parentCutId: null,
                    setupKnifeMin: colsZ.knife, setupMaterialMin: colsZ.material });
                clock += setup0 + ((runs > 0 && perPass > 0) ? runs * perPass : 0);
                prevPhysical = c; prevPhysicalDay = day;
                return;
            }
            // #3401: каждая резка цуга включает свой лидер — добавляем его к стоимости прохода.
            var perPassEff = perPass + leader;
            while (remaining > 0) {
                // #3401: setup сегмента — переналадка с предыдущей резкой; лидер уже в perPassEff.
                // #3635 п.5: у продолжения после сегмента настройки setup = ОСТАТОК настройки
                // (pendingSetup), перенесённый с дня N (а не 0 — иначе остаток настройки терялся).
                var setup = isCont ? pendingSetup : setupCostFor(prevPhysical, c);   // #3688/#3853: первая резка — от заправки станка (carryPrevSetup)
                var avail = effCapacity(day) - clock;
                // #3847: проходы — до потолка DAY_END_HOUR+MAX_OVERWORK_CUTS, настройка-хвост — до
                // DAY_END_HOUR+MAX_OVERWORK_TUNE (фича выкл → обычная ёмкость до cutEndMin).
                var maxPasses = Math.floor((availFor(day, 'cuts', pick) - setup) / perPassEff);   // #4488
                if (maxPasses < 1) {
                    // #3635 п.5: первый проход в остаток дня уже не влезает → в хвост дня N кладём
                    // отдельный сегмент НАСТРОЙКИ, а намотку начинаем с дня N+1 как продолжение.
                    // #3760/#3805: в хвост — НЕ всю переналадку, а ПОДМНОЖЕСТВО её компонентов
                    // (ножи/сырьё), заполняющее окно резки до конца смены с минимальным нахлёстом
                    // (minOverlapTailSetupMinutes по остатку cut-окна effCapacity−clock). Остаток
                    // настройки (pendingSetup) переносим на продолжение дня N+1. Раньше тут клалась
                    // ВСЯ настройка (ножи+сырьё), нахлёстывая за конец смены: оператору доставалось
                    // «и ножи, и сырьё в один день», хотя влезала только часть (заказчик: «надо было
                    // сделать что-то одно — настройку ножей, остальное завтра»).
                    if (clock > 0 && !isCont && setup > 0) {
                        // #3847/#4144: в хвост кладём наибольшее подмножество настройки, влезающее под
                        // потолок нахлёста настройки (availFor 'tune') — единое правило хвоста
                        // chooseTailSetupSubset, то же, что в ветке gapFill и в колонках задания.
                        // Раньше это место звало minOverlapTailSetupMinutes с ПОТОЛКОМ вместо остатка окна:
                        // при наладке из двух компонентов (ножи 30 + сырьё 15) она возвращала минимальное
                        // подмножество, дотягивающее до потолка (ножи 30), а гейт «≤ потолка» его отвергал —
                        // хвост не клался почти никогда (issue #4144). Остаток настройки (pendingSetup) — на
                        // продолжение; ничего под потолком — вся резка на чистый следующий день.
                        var tailAvail = availFor(day, 'tune', pick);   // #4488
                        var setupParts = setupPartsFor(prevPhysical, c);
                        var chosen = chooseTailSetupSubset(setupParts, tailAvail);
                        if (chosen) {
                            var tailSetup = chosen.minutes;
                            var wsSet = day * 1440 + dayStart + clock;
                            var colsT = tailSetupColumns(chosen);   // #4144: разложение хвоста по колонкам для писателя
                            segments.push({ cutId: String(cid), dayOffset: day, runs: 0,
                                windowStartMin: round3(wsSet), startMin: round3(wsSet + tailSetup),
                                setupMin: round3(tailSetup), durationMin: 0,
                                isContinuation: false, parentCutId: null, setupOnly: true,
                                setupKnifeMin: colsT ? colsT.knifeMin : null, setupMaterialMin: colsT ? colsT.materialWindingMin : null });
                            clock += tailSetup;
                            prevPhysical = c; prevPhysicalDay = day;
                            isCont = true;                          // проходы дня N+1 — продолжение
                            pendingSetup = round3(setup - tailSetup);   // остаток настройки → на продолжение
                        pendingParts = remainingSetupParts(setupParts, chosen);   // #4529: остаток — своими кодами
                            day += 1; clock = 0; continue;
                        }
                    }
                    if (clock > 0) { day += 1; clock = 0; continue; }   // переносим на чистый след. день
                    maxPasses = 1;   // целый день не вмещает даже setup+1 проход — кладём 1 (переполнение)
                }
                var passesNow = Math.min(remaining, maxPasses);
                var windowStart = day * 1440 + dayStart + clock;
                var segDur = passesNow * perPassEff;
                var colsN = setupColsFor(prevPhysical, c, setup, isCont, pendingParts);   // #4499/#4529
                segments.push({ cutId: String(cid), dayOffset: day, runs: passesNow,
                    windowStartMin: round3(windowStart), startMin: round3(windowStart + setup),
                    setupMin: round3(setup), durationMin: round3(segDur),
                    isContinuation: isCont, parentCutId: isCont ? String(cid) : null,
                    setupKnifeMin: colsN.knife, setupMaterialMin: colsN.material });
                clock += setup + segDur;
                remaining -= passesNow;
                prevPhysical = c; prevPhysicalDay = day;
                isCont = true;   // дальнейшие сегменты этой резки — продолжения (ножи остаются)
                pendingSetup = 0;   // #3635 п.5: остаток настройки применён к этому сегменту — больше не добавляем
                pendingParts = null;
            }
        });
        // #3914: итог базовой ветки по дням (на случай, если gapFill выключен).
        ppTraceDaySummary('splitMachineQueue[base] ИТОГ', segments,
            function(s) { return (Number(s.setupMin) || 0) + (Number(s.durationMin) || 0); },
            { dayOf: function(s) { return Math.floor(Number(s.windowStartMin) / 1440); },
              dayStartMin: dayStart, dayEndMin: dayEnd, lunchDurationMin: (lunch ? lunch.durationMin : 0), maxOverworkTuneMin: maxOverworkTune });
        return applyDowntime(segments);   // #3764
    }

    // #3280: минуты расписания (от полуночи дня планирования) → Unix-штамп (секунды).
    // dayMidnightMs — полночь дня планирования (мс); windowStartMin — минуты окна резки.
    function scheduleStartTimestamp(dayMidnightMs, windowStartMin){
        var base = Number(dayMidnightMs);
        var min = Number(windowStartMin);
        if (!isFinite(base) || !isFinite(min)) return 0;
        // planStart всегда на ЦЕЛОЙ минуте, округление ВВЕРХ. Иначе при дробном окне (раздроблённая
        // намотка) в штампе оставались секунды, и Гант (обрезает :SS вниз) расходился со страницей
        // (округляет вверх) на ±1 мин. splitMachineQueue остаётся ЕДИНСТВЕННЫМ источником planStart
        // (он же знает про нахлёст настройки #3805 и разрыв по дням #3635 п.5) — здесь только снап к
        // минуте, без отдельного пересчёта по сохранённым окнам.
        return Math.floor((base + Math.ceil(min) * 60000) / 1000);
    }

    // #4061: снап НАЧАЛ ОКОН резок к ЦЕЛЫМ минутам, чтобы старт СЛЕДУЮЩЕГО задания = старт
    // текущего + его ЦЕЛАЯ занятость = сумма сохранённых колонок «Наладка ножей» + «Сырьё/намотка»
    // + «Резка и Лидер». Упаковщик (splitMachineQueue/buildSchedule) считает намотку ДРОБНОЙ и
    // решает, что в какой день (это НЕ трогаем), но planStart и колонки пишутся ЦЕЛЫМИ, округляя
    // вверх (namely #3635 п.4 «Длительность» и #3700 «Резка и Лидер»). Поэтому старт следующего
    // задания — ceil дробного НАКОПЛЕННОГО окна — расходился с суммой колонок: Гант и очередь,
    // пакуя бары/карточки встык ПО КОЛОНКАМ, «накидывали» к дню до +N минут (issue #4061). Снап
    // убирает расхождение в ИСТОЧНИКЕ (planStart), не трогая упаковку/колонки/показ: внутри одного
    // рабочего дня станка окна идут встык по ЦЕЛОЙ занятости, а ЗАЗОРЫ между резками (обед/простой/
    // выходной) сохраняются как есть. Дни (floor(окно/1440)) не смешиваем — первое окно дня якорь
    // (ceil, как scheduleStartTimestamp). items — [{ ws, setup, cutLeader }] в ПОРЯДКЕ расписания
    // (ws — начало окна, мин; setup — наладка+сырьё; cutLeader — намотка+лидер, дробное). Занятость
    // целая = round(setup) + ceil(cutLeader) (лидер целый ⇒ ceil(намотка)+лидер = «Резка и Лидер»).
    // → массив ЦЕЛЫХ начал окон (в том же порядке). Чистая — покрыта тестом.
    function snapWindowStartsWholeMinutes(items){
        var out = [];
        var prevByDay = {};   // день → { start (целое окно), occWhole (целая занятость), origEnd (дробный конец окна) }
        (items || []).forEach(function(it){
            var ws = Number(it && it.ws) || 0;
            var setup = Number(it && it.setup) || 0;
            var cutLeader = Number(it && it.cutLeader) || 0;
            var occWhole = Math.round(setup) + Math.ceil(round3(cutLeader));   // = наладка+сырьё+«Резка и Лидер»
            var day = Math.floor(ws / 1440);
            var prev = prevByDay[day];
            var start;
            if (!prev) {
                start = Math.ceil(round3(ws));   // якорь дня — вверх до целой минуты (как scheduleStartTimestamp)
            } else {
                var gap = Math.max(0, Math.round(ws - prev.origEnd));   // обед/простой/выходной между резками — сохраняем
                start = prev.start + prev.occWhole + gap;
            }
            out.push(start);
            prevByDay[day] = { start: start, occWhole: occWhole, origEnd: ws + setup + cutLeader };
        });
        return out;
    }

    // #4061: мутирует окна сегментов splitMachineQueue (windowStartMin/startMin) снапом к целым
    // минутам. durationMin сегмента = намотка + лидер (perPassEff), leaderMin отдельно нет.
    function snapSplitSegmentWindows(segs){
        var snapped = snapWindowStartsWholeMinutes((segs || []).map(function(s){
            return { ws: stripNum(s && s.windowStartMin), setup: stripNum(s && s.setupMin), cutLeader: stripNum(s && s.durationMin) };
        }));
        (segs || []).forEach(function(s, i){
            if (!s) return;
            s.windowStartMin = snapped[i];
            s.startMin = round3(snapped[i] + stripNum(s.setupMin));
        });
        return segs;
    }

    // #4408: РАЗБОР РАСКЛАДКИ ОДНОГО ДНЯ станка по ХРАНИМЫМ колонкам — что стоит между заданиями.
    // items — задания дня В ПОРЯДКЕ ОЧЕРЕДИ: [{ cutId, windowStartMin, occMin, started }], где
    // windowStartMin — начало окна (мин от полуночи дня 0, ось расписания), occMin — ЦЕЛАЯ занятость
    // станка «Наладка ножей» + «Сырьё/намотка» + «Резка и Лидер», started — «Начато» заполнено
    // (#4381: такое задание уже идёт на станке, его старт неприкосновенен).
    // opts: { dayStartMin, lunchStartMin, lunchDurationMin, blocked }.
    // → [{ cutId, gapMin, kind }] по каждому заданию: сколько минут пустует ПЕРЕД ним и чем этот
    // зазор объясняется: 'ok' (встык), 'lunch' (обед), 'downtime' («Отпуск»/нерабочий день, #3764),
    // 'started' (перед начатым заданием — двигать его нельзя), 'hole' (НИЧЕМ — дыра),
    // 'overlap' (задания наезжают друг на друга). Отсчёт первого зазора — от начала смены.
    // Допуск ±1 мин — снап начал окон к целым минутам (#4061). Чистая — покрыта тестом.
    function dayLayoutGaps(items, opts) {
        opts = opts || {};
        var list = (items || []).filter(Boolean);
        if (!list.length) return [];
        var dayFrom = Math.floor(stripNum(list[0].windowStartMin) / 1440) * 1440;
        var lunchDur = Number(opts.lunchDurationMin) || 0;
        var lunchAbs = (isFinite(Number(opts.lunchStartMin)) && lunchDur > 0)
            ? dayFrom + Number(opts.lunchStartMin) : null;
        var blocked = opts.blocked || [];
        var TOL = 1;
        var prevEnd = dayFrom + (Number(opts.dayStartMin) || 0);
        var lunchSeen = false;
        return list.map(function(it) {
            var ws = stripNum(it.windowStartMin);
            var gapFrom = prevEnd;                       // конец предыдущего окна (начало зазора)
            var gap = round3(ws - gapFrom);
            prevEnd = round3(ws + stripNum(it.occMin));
            var kind;
            if (gap < -TOL) kind = 'overlap';
            else if (gap <= TOL) kind = 'ok';
            else if (it.started) kind = 'started';       // #4381: начатое стоит там, где стоит
            else if (!lunchSeen && lunchAbs != null && Math.abs(gap - lunchDur) <= TOL && ws >= lunchAbs - TOL) {
                lunchSeen = true; kind = 'lunch';        // #3342: обед зашит зазором в planStart
            } else {
                var byBlock = false;
                for (var i = 0; i < blocked.length; i++) {
                    if (blocked[i][0] < ws && blocked[i][1] > gapFrom) { byBlock = true; break; }
                }
                kind = byBlock ? 'downtime' : 'hole';    // #3764: простой станка объясняет зазор
            }
            return { cutId: String(it.cutId), gapMin: gap, kind: kind };
        });
    }

    // #4408: раскладка дня ЦЕЛА — задания идут встык, а зазоры между ними объяснимы (обед, простой,
    // начатое задание). Дыра или наезд = день надо пересобрать. Чистая — покрыта тестом.
    function dayLayoutIsSound(items, opts) {
        return dayLayoutGaps(items, opts).every(function(g) {
            return g.kind !== 'hole' && g.kind !== 'overlap';
        });
    }

    // #4408: ЧЕСТНАЯ пере-сборка СТАРТОВ ОДНОГО ДНЯ станка по хранимым колонкам. Ручная
    // перестановка (↑↓ #4189, drag #4306) меняет ПОРЯДОК, не трогая длительности, а «Пересчитать
    // наладку» (#4401) переписывает колонки, не трогая старты, — в итоге день ехал внахлёст: №1
    // 08:00–11:20, а №2 стартовал в 08:51 (issue #4408). Раскладываем день ЗАНОВО: первое задание —
    // с начала смены, каждое следующее — встык к предыдущему (старт = старт предыдущего + его ЦЕЛАЯ
    // занятость, правило #4061), обед вставляем ОДИН раз за день ровно как упаковщик
    // (splitMachineQueue.insertLunchBefore: курсор дошёл до LUNCH_START и это не первое задание дня),
    // окна «Отпуска» (#3764) обходим.
    //   • ЗА ПРЕДЕЛЫ ДНЯ НИЧЕГО НЕ ВЫНОСИМ (#4408): переполненный день остаётся переполненным — он
    //     виден как есть (#4099), а задание НЕ уезжает на следующий день. Старт, который не влезает
    //     в сутки, оставляем хранимым (двигать некуда).
    //   • Начатое задание (#4381) — якорь: его старт не меняем, курсор продолжается от него.
    //   • #4555: `it.anchored` — тот же якорь по решению ВЫЗЫВАЮЩЕГО. «Пересчитать отсюда и до
    //     конца» помечает им заданий, стоящих в дне ДО выбранного: они остаются на своих местах,
    //     а курсор идёт от последнего из них — иначе пересборка утащила бы выбранное задание к
    //     началу смены, поверх нетронутого прошлого.
    // items/opts — как в dayLayoutGaps. → { cutId: windowStartMin } (только ЦЕЛЫЕ минуты).
    // Чистая, идемпотентная (повторный прогон даёт то же) — покрыта тестом.
    function repackDayWindowStarts(items, opts) {
        opts = opts || {};
        var list = (items || []).filter(Boolean);
        var out = {};
        if (!list.length) return out;
        var dayFrom = Math.floor(stripNum(list[0].windowStartMin) / 1440) * 1440;
        var dayTo = dayFrom + 1440;
        var lunchDur = Number(opts.lunchDurationMin) || 0;
        var lunchAbs = (isFinite(Number(opts.lunchStartMin)) && lunchDur > 0)
            ? dayFrom + Number(opts.lunchStartMin) : null;
        var blocked = opts.blocked || [];
        // Ближайшая минута ≥ from, где окно длиной len не попадает в простой (#3764). Выйти за
        // сутки не даём (#4408) — вернём null, задание останется на хранимом старте.
        function freeFrom(from, len) {
            var m = from, guard = 0;
            while (guard++ < blocked.length + 8) {
                var bumped = false;
                for (var i = 0; i < blocked.length; i++) {
                    var bS = blocked[i][0], bE = blocked[i][1];
                    if (((bS <= m && m < bE) || (m < bS && bS < m + len)) && bE > m) { m = bE; bumped = true; break; }
                }
                if (!bumped) break;
            }
            return m >= dayTo ? null : Math.ceil(round3(m));
        }
        var cur = dayFrom + (Number(opts.dayStartMin) || 0);
        var lunchDone = false, placedAny = false;
        list.forEach(function(it) {
            var occ = Math.round(stripNum(it.occMin));
            var ws = stripNum(it.windowStartMin);
            if (it.started || it.anchored) {   // #4381 / #4555: якорь — стои́т там, где стои́т
                out[String(it.cutId)] = ws;
                cur = Math.max(cur, ws + occ);
                placedAny = true;
                if (lunchAbs != null && ws >= lunchAbs) lunchDone = true;   // обед уже позади
                return;
            }
            if (lunchAbs != null && !lunchDone && placedAny && cur >= lunchAbs) {
                cur = round3(cur + lunchDur);
                lunchDone = true;
            }
            var placed = freeFrom(cur, occ);
            if (placed == null) { out[String(it.cutId)] = ws; return; }   // не влезает в сутки — не трогаем
            out[String(it.cutId)] = placed;
            cur = placed + occ;
            placedAny = true;
        });
        return out;
    }

    // #4416: ближайшее свободное окно станка ПО СОХРАНЁННОМУ ПЛАНУ — минута, с которой новое
    // задание встанет в хвост очереди, не наехав на уже запланированное и не оставив дыры.
    // #4416: ближайшее свободное окно станка — ПО СОХРАНЁННОМУ ПЛАНУ. Считаем от того, что
    // записано (#3846/#4144): окна очереди берутся из хранимых planStart и колонок, а не пакуются
    // заново от дня 0 — иначе растянутый по дням план (сроки, фиксация, разрывы) сжимался в первые
    // дни и созданное вручную задание вставало ВНУТРИ занятого дня, с дырой или нахлёстом.
    //   items — окна заданий станка [{ windowStartMin, occMin }] (scheduleFromStored + колонки);
    //   opts — { occMin (занятость нового задания = наладка + «Резка и Лидер»), dayStartMin,
    //            dayEndMin (потолок резки, cutEndMin), lunchStartMin, lunchDurationMin,
    //            blocked:[[s,e],…] (#3764 «Отпуск» + нерабочие дни), minStartMin (не раньше базы) }.
    // Правила дня — как у упаковщика: обед вставляется один раз (splitMachineQueue.insertLunchBefore),
    // не влезающее до потолка уезжает на следующий рабочий день (nextFreeWorkMinute), окна простоя
    // обходятся. → минута начала окна (целая) | null. Чистая — покрыта тестом.
    function freeSlotFromStoredQueue(items, opts){
        opts = opts || {};
        var list = (items || []).filter(function(it){ return it && isFinite(Number(it.windowStartMin)); });
        var occ = Math.max(0, Math.round(Number(opts.occMin) || 0));
        var dayStart = Number(opts.dayStartMin) || 0;
        var dayEnd = Number(opts.dayEndMin);
        if (!isFinite(dayEnd) || dayEnd <= dayStart) dayEnd = 1440;
        var lunchDur = Number(opts.lunchDurationMin) || 0;
        var lunchStart = Number(opts.lunchStartMin);
        var hasLunch = lunchDur > 0 && isFinite(lunchStart);
        var blocked = opts.blocked || [];
        // Курсор = конец СОХРАНЁННОЙ очереди станка (но не раньше начала окна планирования).
        var cursor = isFinite(Number(opts.minStartMin)) ? Number(opts.minStartMin) : dayStart;
        list.forEach(function(it){
            var end = Number(it.windowStartMin) + Math.max(0, Number(it.occMin) || 0);
            if (end > cursor) cursor = end;
        });
        // Обед этого дня уже стоит в сохранённых стартах? (тем же правилом, что #4408 разбирает день)
        function dayHasLunch(day){
            if (!hasLunch) return true;
            var dayItems = list.filter(function(it){ return Math.floor(Number(it.windowStartMin) / 1440) === day; })
                .sort(function(a, b){ return a.windowStartMin - b.windowStartMin; });
            if (!dayItems.length) return false;
            return dayLayoutGaps(dayItems, { dayStartMin: dayStart, lunchStartMin: lunchStart,
                lunchDurationMin: lunchDur, blocked: blocked })
                .some(function(g){ return g.kind === 'lunch'; });
        }
        var guard = 0;
        while (guard++ < 400) {
            var day = Math.floor(cursor / 1440);
            var base = day * 1440;
            if (cursor - base < dayStart) cursor = base + dayStart;
            var lunchPending = hasLunch && !dayHasLunch(day);
            if (lunchPending && (cursor - base) >= lunchStart) { cursor = round3(cursor + lunchDur); lunchPending = false; }
            // Потолок дня резервирует обед, если он в этом дне ещё впереди (как effCapacity упаковщика).
            var fitEnd = dayEnd - (lunchPending ? lunchDur : 0);
            var placed = nextFreeWorkMinute(cursor, occ, blocked, dayStart, dayEnd, fitEnd, true);
            if (Math.floor(placed / 1440) === day) return Math.ceil(round3(placed));
            cursor = placed;   // уехали на другой день — там свои обед и потолок
        }
        return Math.ceil(round3(cursor));
    }

    // Ближайшее свободное окно станка для НОВОЙ резки. Повторяет расписание очереди
    // (buildSchedule по порядку), добавляя проспект-резку в КОНЕЦ очереди станка, и
    // возвращает окно последнего сегмента — то же время, что покажет очередь после
    // создания (резка станет последней в своём дне). Вход не мутирует.
    // #4416: для РАЗМЕЩЕНИЯ больше не используется (окно считает freeSlotFromStoredQueue по
    // сохранённому плану) — остаётся источником канонических наладки/намотки нового задания.
    //   stationCuts — резки станка в порядке очереди (как из groupBySlitter);
    //   prospect — { id, plannedRuns, materialId, winding, knifeWidths, runLength };
    //   opts — { windPoints, times, runLengthByCut:{cutId:м}, shiftStartMin, shiftEndMin,
    //            blockedRanges:[[s,e],…] (#4396: нерабочие дни календаря #3788 + «Отпуск» #3764 —
    //            окно обязано их пропускать, иначе задание встаёт на выходной) }.
    // → { windowStartMin, startMin, finishMin, durationMin, setupMin, day } | null.
    // #3280: номер календарного дня плановой даты (для смежности «продолжений»). null — нет даты.
    function planDayNumber(c){
        var s = String(c && c.planDate != null && c.planDate !== '' ? c.planDate : (c && c.number)).trim();
        if (!/^\d{9,13}$/.test(s)) return null;
        var num = Number(s);
        var ms = num >= 1e12 ? num : num * 1000;
        return Math.floor(ms / 86400000);
    }

    // #3280: сигнатура «той же резки на станке» — станок|сырьё|намотка|набор ножей.
    // По ней распознаём цепочки записей-продолжений (без схемного маркера).
    function continuationSignature(c){
        var ks = ((c && c.knifeWidths) || []).slice().map(Number).sort(function(a, b){ return a - b; });
        return [
            (c && c.slitter && c.slitter.id) == null ? '' : String(c.slitter.id),
            (c && c.materialId) == null ? '' : String(c.materialId),
            normWinding(c && c.winding),
            ks.join(',')
        ].join('|');
    }

    // #3613: две соседние карточки очереди — один и тот же логический «задание», физически
    // разрезанное по рабочим дням (не влезло в день — нормально дробить). По этому признаку
    // renderQueue рисует значок смежности «←»/«→» на первой/последней карточке дня.
    // Признак — тот же «ID первой части» (#3892), что и у слияния цепочек: конфигурация (сырьё,
    // намотка, набор ножей) у РАЗНЫХ заданий совпадает сплошь и рядом, и по ней значок вставал у
    // соседей, которые одним заданием никогда не были (решение заказчика 31.07.2026 — не гадать).
    function isDaySplitSibling(a, b){
        if (!a || !b) return false;
        var fa = String((a.firstPartId == null ? '' : a.firstPartId)).trim();
        var fb = String((b.firstPartId == null ? '' : b.firstPartId)).trim();
        return fa !== '' && fa === fb;
    }

    // #4424: ГРУППЫ ЗАДАНИЙ ПОД ОБЪЕДИНЕНИЕ — одно и то же дело, разложенное по нескольким
    // записям: один станок, один ЗАКАЗ и одна конфигурация (continuationSignature: станок|сырьё|
    // намотка|ножи). Такие задания оператор видит как «3 задания одного заказа», хотя это одна
    // работа: у каждого своя наладка, и они не сливаются (issue #4424). Голова группы — ПЕРВОЕ ПО
    // ПОРЯДКУ (минимальная «Дата план»; при равенстве — меньший id, чтобы результат был устойчив).
    //   cuts — задания (обычно очередь одного станка или весь план);
    //   opts.skipIds — id, которые объединять НЕЛЬЗЯ (начатые #4381, замороженный день #4326,
    //                  завершённые): такая запись не попадает ни в голову, ни в поглощаемые.
    // Записи БЕЗ заказа (складские) не объединяем — ключа нет. Записи одной цепочки дробления
    // (общий «ID первой части») уже суть одно задание — их не трогаем.
    // → [{ headId, memberIds:[…], orderId, runs }] (только группы из ≥2 записей). Чистая — покрыта тестом.
    function mergeableOrderGroups(cuts, opts){
        opts = opts || {};
        var skip = opts.skipIds || {};
        var groups = {}, order = [];
        (cuts || []).forEach(function(c){
            if (!c || c.id == null) return;
            if (skip[String(c.id)]) return;
            var oid = String(c.orderId == null ? '' : c.orderId).trim();
            if (oid === '') return;                                   // склад — без заказа не объединяем
            var key = continuationSignature(c) + '|' + oid;
            if (!groups[key]) { groups[key] = []; order.push(key); }
            groups[key].push(c);
        });
        var out = [];
        order.forEach(function(key){
            var arr = groups[key];
            if (arr.length < 2) return;
            // Уже одна цепочка дробления (все с общим «ID первой части») — это и так одно задание.
            var roots = {};
            arr.forEach(function(c){
                var fp = (c.firstPartId != null && String(c.firstPartId).trim() !== '') ? String(c.firstPartId).trim() : String(c.id);
                roots[fp] = 1;
            });
            if (Object.keys(roots).length < 2) return;
            var sorted = arr.slice().sort(function(a, b){
                var pa = planTsSeconds(a.planDate), pb = planTsSeconds(b.planDate);
                if (pa == null) pa = Infinity;
                if (pb == null) pb = Infinity;
                if (pa !== pb) return pa - pb;
                return String(a.id).localeCompare(String(b.id), 'ru');
            });
            out.push({
                headId: String(sorted[0].id),
                memberIds: sorted.map(function(c){ return String(c.id); }),
                orderId: String(sorted[0].orderId),
                runs: sorted.reduce(function(s, c){ return s + (Number(c.plannedRuns) || 0); }, 0)
            });
        });
        return out;
    }

    // #3613: какие значки смежности дня показать на карточке очереди. Карточка —
    // первая в своём рабочем дне, если сосед слева (prev) попал в другой день; последняя —
    // если сосед справа (next) в другом дне. Значок ставим только когда соседний сегмент
    // через границу дня — тот же логический задание (isDaySplitSibling): задание не влезло
    // в день и его раздробили. Дни берём из расписания (schedDay) — те же, что разделяют
    // дни блоком уборки. → { fromPrev, toNext }. Чистая (без DOM) → проверяется тестом.
    function daySplitBadges(prevCut, prevDay, cut, myDay, nextCut, nextDay){
        if (myDay == null) return { fromPrev: false, toNext: false };
        return {
            fromPrev: prevDay != null && prevDay !== myDay && isDaySplitSibling(prevCut, cut),
            toNext: nextDay != null && nextDay !== myDay && isDaySplitSibling(cut, nextCut)
        };
    }

    // #4304: красное предупреждение на карточке — задание ПРИШЛОСЬ РАЗОРВАТЬ по дням (не влезло
    // в смену). Предупреждаем в двух независимых случаях, оба реальные:
    //   А) ПРОСРОЧЕНО и разорвано — авто-планирование: объём больше смены, часть работы уезжает
    //      за «Срок изготовления» (ateh: 158 проходов ≈ 506 мин против 470 мин нетто в смене —
    //      физически не влезает в день до срока, хвост встаёт на следующий день);
    //   Б) ЗАФИКСИРОВАНО и разорвано — ручной перенос: фиксация подразумевает «в один день», но
    //      выносить работу за конец смены нельзя, генерация делит задание по потолку дня
    //      (splitMachineQueue, #4304).
    // Разрыв бывает не только на 2 дня — объём может не влезть и в 2, и в 3 смены, поэтому
    // «разорвано» = у сегмента есть ЛЮБОЙ значок смежности (fromPrev «←» и/или toNext «→»):
    // так помечены и голова, и середина, и хвост цепочки. Просрочка — по КОНКРЕТНОМУ сегменту:
    // голова может стоять в срок, красным горит лишь тот кусок, что уехал за срок.
    // → { text, title } для плашки либо null. Чистая (без DOM) → проверяется тестом.
    function daySplitWarning(o){
        o = o || {};
        if (!(o.fromPrev || o.toNext)) return null;          // не разорвано — предупреждать не о чем
        var overdue = !!o.overdue, fixed = !!o.fixed;
        if (!overdue && !fixed) return null;                 // штатное дробление большого задания в срок
        var subj = fixed ? 'Зафиксированное задание' : 'Задание';
        return {
            text: '⚠ ' + subj + ' разорвано по дням' + (overdue
                ? ' и просрочено — не помещается в смену до срока'
                : ' — не помещается в смену'),
            title: subj + ' не помещается в смену и разорвано по дням' + (overdue
                ? ' — часть работы выходит за «Срок изготовления»'
                : ' — продолжение перенесено на следующие рабочие дни')
        };
    }

    // #4617: АРИФМЕТИКА ЦЕПОЧКИ на карточке — «проходов 1 из 5 · остальные 4 → 07.08».
    // Разорванное по дням задание живёт НЕСКОЛЬКИМИ записями, и карточка показывала только свою:
    // боевая ateh, Станок 2, 06.08.2026 — у заказов 4580/4567/4564/4561 в дне остался ОДИН проход,
    // остальные 4–5 стояли отдельной записью на 07.08. Проходы целы, но по очереди это читалось как
    // «потерянные резки»: значок «→» в углу не называет ни числа проходов, ни дня, куда уехал остаток.
    // parts — записи цепочки (splitChainPartsOf), dateLabel(planDate) → подпись дня или ''.
    // → { text, title } либо null (не разорвано / считать нечего). Чистая (без DOM) → покрыта тестом.
    function daySplitChainNote(parts, cutId, dateLabel) {
        var id = String(cutId == null ? '' : cutId);
        var list = (parts || []).filter(function(p){ return p && p.id != null; });
        if (id === '' || list.length < 2) return null;
        function runsOf(p){ var n = Number(p && p.plannedRuns); return isFinite(n) && n > 0 ? n : 0; }
        var mine = null, others = [];
        list.forEach(function(p){ if (String(p.id) === id) mine = p; else others.push(p); });
        if (!mine) return null;
        var total = list.reduce(function(s, p){ return s + runsOf(p); }, 0);
        if (!(total > 0)) return null;                       // наладочный хвост без проходов — считать нечего
        var here = runsOf(mine), rest = total - here;
        var labels = [];
        others.forEach(function(p){
            var lab = (typeof dateLabel === 'function') ? String(dateLabel(p.planDate) || '') : '';
            if (lab && labels.indexOf(lab) === -1) labels.push(lab);
        });
        var where = labels.length ? ' → ' + labels.join(', ') : '';
        return {
            text: 'проходов ' + here + ' из ' + total + ' · остальные ' + rest + where,
            title: 'Задание разорвано по дням на ' + list.length + ' части: здесь ' + here + ' из ' + total +
                   ' проходов, остальные ' + rest + (labels.length ? ' — ' + labels.join(', ') : '') +
                   '. Проходы не потеряны: части одного задания связаны, при переносе собираются в одно.'
        };
    }

    // #3737: недостающий сосед карточки через ВНЕШНЮЮ границу выбранного диапазона дат.
    // Сегмент-продолжение задания за границей диапазона лежит в дне ВНЕ фильтра — в очередь
    // он не попадает, но присутствует в полном наборе резок (cut_planning грузится целиком).
    // Поэтому у первой/последней карточки диапазона соседа через границу дня нет и значок
    // ←/→ не рисуется (баг при выборе одного дня). Возвращает ближайший по КАЛЕНДАРНОМУ дню
    // смежный по заданию (isDaySplitSibling) сегмент того же станка в более раннем (dir<0, ←)
    // либо позднем (dir>0, →) дне, чем у `cut`; null — нет такого. Чистая → покрыта тестом.
    function boundaryDaySibling(cuts, cut, dir){
        if (!cut) return null;
        var d0 = planDateDayKey(cut.planDate);
        if (d0 === Infinity) return null;
        var sid = String((cut.slitter && cut.slitter.id) || '');
        var best = null, bestKey = dir < 0 ? -Infinity : Infinity;
        (cuts || []).forEach(function(o){
            if (!o || String(o.id) === String(cut.id)) return;
            if (String((o.slitter && o.slitter.id) || '') !== sid) return;
            if (!isDaySplitSibling(o, cut)) return;
            var k = planDateDayKey(o.planDate);
            if (k === Infinity) return;
            if (dir < 0 ? (k < d0 && k > bestKey) : (k > d0 && k < bestKey)) { bestKey = k; best = o; }
        });
        return best;
    }

    // #3280: слить записи-продолжения обратно в логические резки перед пере-разбиением.
    // Признак цепочки ОДИН — явный «ID первой части» (firstPartId = id головы, #3892): все части
    // разбитого по дням задания несут его, голова ссылается на саму себя. Выживает голова, её
    // «Кол-во план» = сумма проходов цепочки; остальные записи — в deletes.
    //
    // ЗАПАСНОГО ПРАВИЛА НЕТ (решение заказчика 31.07.2026). Прежде записи без маркера группировались
    // ЭВРИСТИКОЙ «та же конфигурация (станок|сырьё|намотка|ножи) + смежные календарные дни + тот же
    // заказ». Она гадала: две РАЗНЫЕ резки одной конфигурации в соседние дни склеивались в одно
    // логическое задание, его голова уезжала на ранний день, и «Упорядочить» пропускал всю «цепочку»
    // как одну запись (issue #3892 ровно об этом). Маркер проставлен всем боевым записям (ateh,
    // 31.07.2026: 158 из 158), легаси-данных нет — гадать больше не за кого. Запись без маркера
    // считается САМОСТОЯТЕЛЬНОЙ и называется в журнале (ТЗ §14): это дефект данных, который чинят,
    // а не угадывают.
    // → { cuts:[логические резки], deletes:[id записей-продолжений], chainByLogical:{logicalId:[id…]} }.
    // Вход не мутирует.
    function mergeContinuationChains(cuts){
        var logical = [], deletes = [], chainByLogical = {};
        function sortByDay(arr){
            return arr.slice().sort(function(a, b){
                var da = planDayNumber(a), db = planDayNumber(b);
                if (da == null && db == null) return 0;
                if (da == null) return 1;
                if (db == null) return -1;
                return da - db;
            });
        }
        // chain — записи одной логической резки по возрастанию дня (chain[0] = голова).
        function emitChain(chain){
            var head = chain[0];
            var lg = {};
            for (var k in head) { if (Object.prototype.hasOwnProperty.call(head, k)) lg[k] = head[k]; }
            lg.plannedRuns = chain.reduce(function(sum, c){ return sum + (Number(c.plannedRuns) || 0); }, 0);
            logical.push(lg);
            chainByLogical[String(head.id)] = chain.map(function(c){ return String(c.id); });
            for (var m = 1; m < chain.length; m++) deletes.push(String(chain[m].id));
        }
        // #3892: основной признак цепочки — ЯВНЫЙ «ID первой части» (firstPartId = id головы).
        // Записи с непустым маркером группируем по нему (надёжно: не зависит от совпадения
        // сигнатуры/сырья и не склеивает разные заказы одной конфигурации соседних дней).
        // Записи без маркера (легаси до миграции) — прежней эвристикой (сигнатура + смежные дни).
        var explicitGroups = {}, explicitOrder = [], legacyCuts = [];
        (cuts || []).forEach(function(c){
            var fp = (c && c.firstPartId != null) ? String(c.firstPartId).trim() : '';
            if (fp !== '') {
                if (!explicitGroups[fp]) { explicitGroups[fp] = []; explicitOrder.push(fp); }
                explicitGroups[fp].push(c);
            } else {
                legacyCuts.push(c);
            }
        });
        explicitOrder.forEach(function(fp){
            var arr = sortByDay(explicitGroups[fp]);
            // Голова = запись, чей id == маркеру (ссылается на себя). Нет такой (голову удалили/
            // перенесли) → самый ранний сегмент становится головой; следующее сохранение
            // перепроставит маркер на его id. Голову держим первой, остальное — по дню.
            var headIdx = -1;
            for (var i = 0; i < arr.length; i++) { if (String(arr[i].id) === fp) { headIdx = i; break; } }
            if (headIdx > 0) { var h = arr.splice(headIdx, 1)[0]; arr.unshift(h); }
            emitChain(arr);
        });
        // Записи без маркера — самостоятельные логические задания. Молчать нельзя (ТЗ §14):
        // «ID первой части» проставляет каждый путь записи плана, и его отсутствие — дефект данных.
        if (legacyCuts.length && typeof console !== 'undefined' && console.warn) {
            console.warn('[pp] ⚠️ #3892: записи БЕЗ «ID первой части» (' + legacyCuts.length + ') — '
                + 'считаю их самостоятельными заданиями (цепочку по конфигурации больше не угадываем): '
                + legacyCuts.map(function(c){ return String(c && c.id); }).join(', '));
        }
        legacyCuts.forEach(function(c){ emitChain([c]); });
        return { cuts: logical, deletes: deletes, chainByLogical: chainByLogical };
    }

    // #4292: ПОЛНАЯ цепочка дробления по дням для записи cutId — ГОЛОВА + все ПРОДОЛЖЕНИЯ (это
    // ОДНА логическая резка). Удаление любого звена обязано снести ВСЮ цепочку: иначе
    // продолжение остаётся без «Обеспечения»/заказа (обеспечение висело на голове) — «нет связей»,
    // и попадает в ОТХОДЫ; автогенерация такую сироту НЕ чистит (у неё проходы>0, planCutOperations
    // сносит лишь setup-only-мусор с 0 проходов). Возвращает id записей (голова первой, как в
    // chainByLogical), гарантированно включая сам cutId. Standalone-резка → [cutId]. Вход не мутирует.
    function chainRecordIdsForCut(cuts, cutId) {
        var id = String(cutId == null ? '' : cutId);
        if (id === '') return [];
        var chainByLogical = (mergeContinuationChains(cuts || []).chainByLogical) || {};
        var headById = {};
        Object.keys(chainByLogical).forEach(function(head){
            (chainByLogical[head] || [head]).forEach(function(m){ headById[String(m)] = String(head); });
        });
        var head = headById[id];
        var chain = (head != null && chainByLogical[head]) ? chainByLogical[head].map(String) : [id];
        if (chain.indexOf(id) < 0) chain.push(id);
        return chain;
    }

    // #4434 п.2: задания, ИСКЛЮЧЁННЫЕ из входа планировщика, продолжают физически занимать станок.
    // Главный случай — цепочки прошлых дней (#4294): голова стоит 27.07 (раньше «С»), а её
    // продолжение / наладочный хвост (#3635 п.5) — уже 28.07 в 08:00, ВНУТРИ окна. Планировщик такую
    // цепочку в глаза не видит и набивает тот же день с 08:00 → два задания стартуют в одну минуту
    // (issue #4434 п.2: «Почему 2 задания в 1 день в 8 утра?»). Сюда же «Завершён» с плановым днём в
    // окне — станок в это время был занят.
    //
    // Отдаём их станку как БЛОКИРОВАННЫЕ интервалы (та же ось и формат, что «Отпуск» #3764,
    // [[s,e]] в минутах от полуночи дня 0): ёмкость дня уменьшается (#3978), а новые сегменты
    // обходят занятое время (shiftPlacementsPastDowntime).
    //
    // Занятость = хранимый тайминг задания («Наладка ножей» + «Сырьё/намотка» + «Резка и Лидер»),
    // фолбэк — «Длительность, минут». Нечем измерить — НЕ занижаем день молча: пропускаем и кричим
    // ([[crm-no-silent-fallback]]). Резервируем только то, что попадает в окно (день ≥ 0).
    // Чистая (вход не мутирует) — покрыта тестом. → { slitterId: [[startMin, endMin], …] }.
    function excludedCutBlockedRanges(cuts, excludedIds, baseMidnightMs) {
        var out = {};
        if (!excludedIds || !excludedIds.length || !isFinite(Number(baseMidnightMs))) return out;
        var want = {};
        excludedIds.forEach(function(id){ want[String(id)] = true; });
        (cuts || []).forEach(function(c){
            if (!c || c.id == null || !want[String(c.id)]) return;
            var sid = (c.slitter && c.slitter.id != null) ? String(c.slitter.id) : '';
            if (sid === '') return;
            var tsSec = Number(c.planDate != null && String(c.planDate) !== '' ? c.planDate : c.number);
            if (!isFinite(tsSec) || tsSec <= 0) return;                       // никогда не планировалось — места не занимает
            var startMin = Math.round((tsSec * 1000 - Number(baseMidnightMs)) / 60000);
            if (startMin < 0) return;                                          // сегмент раньше «С» — вне окна раскладки
            var occ = Math.round(stripNum(c.storedKnifeSetupMin)) + Math.round(stripNum(c.storedMaterialWindingMin))
                    + Math.round(stripNum(c.storedCutAndLeaderMin));
            if (!(occ > 0)) occ = Math.round(stripNum(c.duration));            // фолбэк: «Длительность, минут»
            if (!(occ > 0)) {
                if (typeof console !== 'undefined' && console.warn) {
                    console.warn('[pp] ⚠️ #4434: задание ' + c.id + ' стоит в окне (' + startMin +
                        ' мин от базы), но НЕ участвует в раскладке и его занятость измерить нечем ' +
                        '(тайминг и «Длительность» пусты) — время станка под него НЕ зарезервировано.');
                }
                return;
            }
            (out[sid] = out[sid] || []).push([startMin, startMin + occ]);
        });
        Object.keys(out).forEach(function(sid){ out[sid].sort(function(a, b){ return a[0] - b[0]; }); });
        return out;
    }

    // #4357 (отменено #4488): отвязка перенесённого сегмента от цепочки. Правило ТЗ §15 «хвостов не
    // остаётся» сделало её вредной: она превращала одну работу в два задания с двумя наладками.
    // Вместо неё перенос СШИВАЕТ части (`mergeSplitChain`) и планирует вставку целого задания.

    // #4488: очередь ДНЯ, в котором стои́т задание, — записи того же станка и того же дня по времени
    // старта (порядок, который читает экран, #3923). Нужна после сшивания частей: список дня,
    // с которым пришли ↑↓/перетаскивание, к этому моменту устарел (записей стало меньше).
    // Чистая, вход не мутирует. Нет задания/дня — пустой массив.
    function dayQueueOf(cuts, cut) {
        if (!cut) return [];
        var sid = String((cut.slitter && cut.slitter.id) == null ? '' : cut.slitter.id);
        var dayKey = planDateDayKey(cut.planDate);
        if (dayKey == null) return [];
        return (cuts || []).filter(function(c) {
            if (!c) return false;
            var csid = String((c.slitter && c.slitter.id) == null ? '' : c.slitter.id);
            return csid === sid && planDateDayKey(c.planDate) === dayKey;
        }).sort(function(a, b) { return Number(a.planDate) - Number(b.planDate); });
    }

    // #4488: ЧАСТИ задания, разорванного по дням, — записи его цепочки в порядке дней (первая —
    // голова). Одна запись (задание целое) → массив из неё же; нет такой записи → пусто. Чистая,
    // вход не мутирует. По ней перенос понимает, что тащат часть, и сшивает задание перед вставкой
    // (`mergeSplitChain`), а диалог переноса говорит оператору, сколько частей поедет вместе.
    function splitChainPartsOf(cuts, cutId) {
        var id = String(cutId == null ? '' : cutId);
        if (id === '') return [];
        var byId = {};
        (cuts || []).forEach(function(c){ if (c && c.id != null) byId[String(c.id)] = c; });
        if (!byId[id]) return [];
        var chain = chainRecordIdsForCut(cuts || [], id) || [];
        if (chain.length < 2) return [byId[id]];
        return chain.map(function(x){ return byId[String(x)]; }).filter(Boolean);
    }

    // #4294: id записей заданий, запланированных РАНЬШЕ базы «С» (в прошлые рабочие дни), которые НЕ
    // надо пере-планировать — задание уже стоит на своём дне. Планировщик кладёт всё от «С» вперёд
    // (#3974, «база размещения — С») и день держит лишь у 🔒 (fixedDay); поэтому НЕзафиксированное
    // задание прошлого дня иначе затягивалось в «С» и садилось в середину дня (issue #4294), а
    // зафиксированные оставались на месте. Признак «прошлого дня» — день ГОЛОВЫ цепочки < 0 (голова —
    // самый ранний сегмент; берём по ней, чтобы, исключая цепочку из входа, НЕ осиротить продолжение,
    // попавшее в окно, — ср. #4292). Цепочку с ЗАФИКСИРОВАННОЙ головой НЕ трогаем: её день движок
    // и так держит (fixedDay<0), пусть идёт штатным входом. → массив id ВСЕХ записей таких цепочек.
    // Пустая «Дата план» (никогда не планировалось) → offset null → НЕ исключаем (новое задание — в окно).
    // Вход не мутирует.
    function cutsBeforeWindowToKeep(cuts, baseMidnightMs) {
        var out = [];
        var chains = (mergeContinuationChains(cuts || []).chainByLogical) || {};
        var byId = {};
        (cuts || []).forEach(function(c){ if (c && c.id != null) byId[String(c.id)] = c; });
        Object.keys(chains).forEach(function(head){
            var hc = byId[head];
            // #4561: ЗАМОК ЗДЕСЬ НИ ПРИ ЧЁМ — решает ТОЛЬКО день головы. Прежде цепочка с
            // ЗАФИКСИРОВАННОЙ (🔒) головой раньше «С» из входа НЕ исключалась: считалось, что
            // «фикс-цепочку держит движок сам (fixedDay<0)». Движок её не держит, а ПРОПУСКАЕТ —
            // `splitMachineQueue` кладёт задания только вперёд от дня 0, и якорь < 0 не размещается
            // вовсе («остаётся как есть»). В итоге хвост такой цепочки, СТОЯЩИЙ в окне, исчезал из
            // занятости дня: упаковщик считал его минуты свободными и набивал день поверх.
            // Боевое 01.08.2026 (issue #4561): Станок 1, цепочка MW411 — голова 31.07 (🔒, вне окна),
            // хвост 03.08 на 27 мин. Упаковщик этих 27 мин не видел, ставил соседнюю резку с 08:00 и
            // оставлял ей все 107 проходов — станко-день 479 мин при потолке 450+5. Выравнивание
            // (#4473) гоняло пересборку по кругу: мерка кричит «+29», упаковщик отвечает «влезает».
            // Исключённая из входа запись становится ЗАНЯТЫМ окном станка (excludedCutBlockedRanges),
            // и день считается честно — как и для цепочки с НЕзафиксированной головой.
            if (!hc) return;
            var hoff = dayOffsetFromBase(hc.planDate, baseMidnightMs);
            if (hoff != null && hoff < 0) {                    // голова раньше «С» — вся цепочка остаётся как есть
                (chains[head] || [head]).forEach(function(m){ out.push(String(m)); });
            }
        });
        return out;
    }

    // #4300/#4312: заправка станков НА ВХОДЕ в окно планирования — конфигурация ПОСЛЕДНЕГО задания
    // станка, запланированного РАНЬШЕ базы «С». Станок к началу окна уже несёт наладку вчерашней резки
    // ПЛАНА (ножи/сырьё загружены и остаются на ночь). Без неё splitMachineQueue зарядил бы ПЕРВОЙ резке
    // окна настройку с нуля, а computeCutSetupUpdates считает ту же резку по ВСЕЙ группе станка
    // (вчерашняя резка плана → сегодняшняя) near-zero переналадкой. Окно упаковщика получается длиннее
    // хранимой наладки → «дыра» после первого задания дня (#4300: Станок 1 — 45 мин ножи+сырьё,
    // Станок 2 — 30 мин ножи).
    //
    // #4312: источник — ВСЯ очередь станка (groupBySlitter: день → planStart, тот же порядок, в котором
    // считает колонки computeCutSetupUpdates), а НЕ только резки, исключённые из planInput механизмом
    // #4294. Иначе мимо проходят два живых случая, и «дыра в полчаса» возвращается (issue #4312,
    // Станок 3 22.07: 08:00–09:06, следующее с 09:36):
    //   • вчерашняя резка «Завершён» — она ЕСТЬ в keepIds (cutsBeforeWindowToKeep смотрит все резки),
    //     но её нет в planInput (там фильтр по статусу);
    //   • вчерашняя резка в ЗАФИКСИРОВАННОЙ (🔒) цепочке — cutsBeforeWindowToKeep её намеренно не
    //     возвращает (день такой цепочки движок держит сам).
    // Статус и замок на заправку станка не влияют: физически на нём остаются ножи и сырьё ПОСЛЕДНЕГО
    // задания, что бы с этим заданием ни было в учёте. Инвариант — заправка ровно та, от которой
    // computeCutSetupUpdates считает наладку первой резки окна: упаковщик и хранимые колонки сходятся,
    // дыры нет. #4371: это ЕДИНСТВЕННЫЙ источник заправки — нет заданий раньше «С» → станка в ответе
    // нет, и первая резка окна считает настройку с нуля. Вход не мутирует.
    function prevSetupBeforeWindow(cuts, baseMidnightMs) {
        var out = {};
        groupBySlitter(cuts || []).forEach(function(group){
            var sid = (group.slitter && group.slitter.id != null) ? String(group.slitter.id) : '';
            if (sid === '') return;
            // Группа отсортирована день → planStart, поэтому ПОСЛЕДНЯЯ подходящая резка и есть та,
            // с которой станок войдёт в окно (та же, что становится предшественником первой резки
            // окна в setupActivityColumns).
            var last = null;
            (group.cuts || []).forEach(function(c){
                var off = dayOffsetFromBase(c && c.planDate, baseMidnightMs);
                if (off == null || off >= 0) return;
                last = c;
            });
            if (!last) return;
            // #4314: dayOffset — день, который эта заправка ОПИСЫВАЕТ (нужен правилу сброса наладки
            // после длинного отпуска: отпуск между этим днём и днём первой резки окна снимает
            // ножи/сырьё). Для changeoverParts поле инертно — оно читает сырьё/намотку/ножи.
            out[sid] = { materialId: last.materialId, winding: last.winding,
                         knifeWidths: (last.knifeWidths || []).slice(),
                         knifeCount: (last.knifeWidths || []).length,
                         dayOffset: dayOffsetFromBase(last.planDate, baseMidnightMs) };
        });
        return out;
    }

    // #4314: ДЛИННЫЕ окна «Отпуска» станка (> DOWNTIME_KEEP_SETUP_MAX_DAYS календарных дней, #3898)
    // в индексах дней от базы «С» — [{ fromDay, toDay }] включительно, по возрастанию. За такой простой
    // с валов снимают ножи, а сырьё уходит со станка, поэтому первая резка ПОСЛЕ него считает настройку
    // С НУЛЯ (а короткий, ≤ порога, наладку сохраняет). downtimes — [{ start, end }] в unix-секундах
    // (this.downtimesBySlitter[slitterId]); окна без «Окончания» не учитываем (как везде в расписании).
    function longVacationDayRanges(downtimes, baseMidnightMs) {
        var base = Number(baseMidnightMs);
        if (!isFinite(base)) return [];
        var out = [];
        (downtimes || []).forEach(function(d) {
            var s = Number(d && d.start), e = Number(d && d.end);
            if (!isFinite(s) || s <= 0 || !isFinite(e) || e <= s) return;
            if (downtimeSpanDays(s, e) <= DOWNTIME_KEEP_SETUP_MAX_DAYS) return;   // короткий простой заправку держит
            var fromDay = Math.round((startOfDayMs(s * 1000) - base) / 86400000);
            var toDay = Math.round((startOfDayMs(e * 1000 - 1) - base) / 86400000);   // последний ПОКРЫТЫЙ день
            if (!isFinite(fromDay) || !isFinite(toDay)) return;
            out.push({ fromDay: fromDay, toDay: toDay });
        });
        out.sort(function(a, b) { return a.fromDay - b.fromDay; });
        return out;
    }

    // #4314: стоял ли станок в ДЛИННОМ отпуске между днём prevDay (день предыдущей резки либо день,
    // который описывает заправка станка) и днём curDay размещаемой резки. Полуинтервал (prevDay; curDay]:
    // отпуск, накрывающий сам день предыдущей резки, наладку не снимает (она была ПОСЛЕ него/в этот день),
    // а накрывающий день текущей — снимает (резка идёт после простоя). Ranges — из longVacationDayRanges.
    function setupResetByVacation(prevDay, curDay, ranges) {
        var p = Number(prevDay), c = Number(curDay);
        if (!isFinite(p) || !isFinite(c) || c <= p) return false;
        var list = ranges || [];
        for (var i = 0; i < list.length; i++) {
            if (list[i].toDay > p && list[i].fromDay <= c) return true;
        }
        return false;
    }

    // #4314: id заданий очереди станка, ПЕРЕД которыми стоял длинный отпуск, — им хранимые колонки
    // («Наладка ножей»/«Сырье-намотка») пишут настройку С НУЛЯ, а не переналадку от предыдущей резки:
    // за такой простой станок разряжают. Очередь — в порядке groupBySlitter (день → planStart), тот же,
    // в котором считает setupActivityColumns. Для ПЕРВОГО задания очереди предшественник — заправка
    // станка, и её день задаёт carryDayOffset (день последнего задания раньше «С» — prevSetupBeforeWindow,
    // #4312; заправки нет → 0, отсчёт от дня базы). Пустые ranges → {}.
    function setupResetCutIds(orderedCuts, ranges, baseMidnightMs, carryDayOffset) {
        var out = {};
        if (!(ranges || []).length) return out;
        var prevDay = isFinite(Number(carryDayOffset)) ? Number(carryDayOffset) : 0;
        (orderedCuts || []).forEach(function(c) {
            var day = dayOffsetFromBase(c && c.planDate, baseMidnightMs);
            if (day == null) return;                          // без «Даты план» день не определить — не трогаем
            if (setupResetByVacation(prevDay, day, ranges)) out[String(c.id)] = true;
            prevDay = day;
        });
        return out;
    }

    // #3280: план операций физического разбиения резок по дням. Сливает цепочки-продолжения
    // (mergeContinuationChains), упорядочивает очередь каждого станка (orderCuts) и
    // раскладывает по дням на уровне проходов (splitMachineQueue). →
    //   { updates:[{cutId, sequence, planStartTs, plannedRuns}],            // сегменты, легшие на существующие записи цепочки
    //     creates:[{parentCutId, sequence, planStartTs, plannedRuns}],       // сегменты сверх имеющихся записей → новые
    //     deletes:[cutId…] }                                                 // лишние записи цепочки (сегментов стало меньше)
    // #3427: ИДЕМПОТЕНТНОСТЬ. Сегменты-продолжения переиспользуют УЖЕ существующие записи
    // цепочки (chainByLogical: голова + продолжения по дням), а не пересоздаются каждый раз.
    // Поэтому повторный прогон при неизменной раскладке даёт те же записи с теми же
    // очередностью/временем/проходами → autoSequenceQueue отфильтрует их как «без изменений»
    // и не сделает ни одной записи. Прежняя версия всегда удаляла продолжения и создавала их
    // заново, а аппликатор при этом повторно делил уже делённое Обеспечение головы (метраж
    // усыхал на каждый повтор). Новые записи — только если сегментов стало БОЛЬШЕ, чем записей
    // в цепочке; удаления — только лишние записи, когда сегментов стало МЕНЬШЕ.
    // Деление Обеспечения и копию Полос на новые продолжения выполняет аппликатор (нужны id
    // новых записей и метаданные ссылок) — здесь только очередь/время/проходы. Вход не мутирует.
    // #4085 (модель #3985): функция computeFoilDeadlineReservation (#4068 — резерв хвоста дня под
    // дедлайн-фольгу) УДАЛЕНА. Фольга у своего срока теперь обеспечивается локальным штрафом в слое
    // размещения (15-slot-placement, scorePosition), а не пробным проходом с резервированием минут.

    function planCutOperations(cuts, opts){
        opts = opts || {};
        var base = Number(opts.planBaseMidnightMs);
        var merged = mergeContinuationChains(cuts);
        var chainByLogical = merged.chainByLogical || {};
        // #3974: «Срок изготовления» (EDD) БОЛЬШЕ НЕ участвует в раскладке — он только красит
        // строку очереди (dueColorClass, #3769). Раннему сроку НЕ отдаём ранний день: всё
        // необеспеченное набивается от «С» плотно (splitMachineQueue day 0). c.dueKey не
        // проставляем — планировщик его не читает (EDD #3815/#3820/#3826 отменён, issue #3974).
        // #3974: якорь дня оставляем ТОЛЬКО за «Зафиксировано» (🔒) — единственное, что не
        // двигаем. Фикс-резка держит свой день (fixedDay в splitMachineQueue); свободные задания
        // якоря «Даты план» не имеют (dayAnchorByCut #3658 отменён) и при «Создать» перепаковываются
        // от «С». Ручной перенос 🗓 без 🔒 не держится (day-anchor свободных снят).
        var anchorIn = opts.dayAnchorByCut || {};
        var effAnchorByCut = {};
        merged.cuts.forEach(function(c){
            var id = String(c && c.id);
            if (c && c.fixed && anchorIn[id] != null) effAnchorByCut[id] = anchorIn[id];   // 🔒 держит свой день
        });
        // #4434 п.1: ЗАМОК ДНЯ АБСОЛЮТЕН. Прежний механизм «рескью снимает замок дня у просроченного
        // 🔒» (#4224/#4424) убран целиком: задание, приколотое оператором к дню, не переезжает НИ ПО
        // КАКОЙ причине — ни ради срока, ни из-за переполнения дня. Просрочка 🔒 не прячется: её
        // показывает панель «просрочено: N» (#4161) и безусловный лог #4200. Анкер «Даты план»
        // действует и в пробной, и в финальной упаковке одинаково.
        var perPass = opts.perPassByCut || {};
        // #3974: фильтр входа по «Дате план» ∈ [С;По] (#3660 inScopeUpTo / #3918 спил-день)
        // ОТМЕНЁН. Вход планировщика = всё необеспеченное (открытые задания, отобраны вызывающим:
        // не «Завершён»), за ЛЮБЫЕ даты. [С;По] — не фильтр входа, а окно РАЗМЕЩЕНИЯ: база = «С»
        // (day 0), splitMachineQueue набивает дни от неё и переливает за «По». Раскладываем ВСЕ
        // переданные резки (группировка по станку ниже); ничего не «бережём по чужой дате» —
        // держит день только 🔒 «Зафиксировано».
        // #3924: осиротевшие сегменты НАСТРОЙКИ (0 проходов) — мусор прежних пересборок. У них
        // пустой/висячий «ID первой части» (голову-резку удалили/перенесли), поэтому
        // mergeContinuationChains не подшивает их к цепочке, а делает ОТДЕЛЬНОЙ логической резкой с
        // plannedRuns=0. Планировщик такую резку не раскладывает (0 проходов) → обычный delete-путь
        // (usedByHead, ниже) её не трогает, и она оседает отдельной «настройкой» в дне, раздувая бейдж
        // за ёмкость (issue #3924/#3943, тот же станко-день, что #3920: Станок 1, 02.07, MW308).
        // #3943: удаляем такие сироты ВНЕ ЗАВИСИМОСТИ от scope [фильтра]. Логическая резка с суммой
        // проходов 0 — это чистый мусор: ни одного прохода, ни обеспечений, ни ручной раскладки (её
        // защищает «Зафиксировано»). #3660 бережёт РАСКЛАДКУ чужих дат (не двигать реальные резки), а
        // не право копить мусор: иначе сирота на дне ВНЕ окна пересборки (пользователь упорядочивал
        // другой день) переживала чистку и продолжала пухнуть бейдж — «оверворк опять» (#3943). Реальные
        // резки (проходы>0) и настоящие setup-хвосты (член цепочки, у чьей ГОЛОВЫ проходы>0 → сумма
        // цепочки>0) под условие не попадают; зафиксированные (#3508) не трогаем.
        var orphanDeletes = [];
        merged.cuts = merged.cuts.filter(function(c){
            if (Number(c && c.plannedRuns) > 0) return true;       // есть проходы где-либо в цепочке — реальная резка
            if (c && c.fixed) return true;                         // #3508: зафиксированное авто-чисткой не удаляем
            (chainByLogical[String(c && c.id)] || [String(c && c.id)]).forEach(function(id){ orphanDeletes.push(String(id)); });
            return false;
        });
        // #4118/#4547: cutId → объект резки. Нужен и слою размещения (день ему считает упаковщик,
        // #4547), и доп. проходам по РЕАЛЬНЫМ дням (#4118), поэтому строим ДО размещения.
        var cutById = {};
        merged.cuts.forEach(function(c){ if (c && c.id != null) cutById[String(c.id)] = c; });
        // #4547 (решение заказчика 31.07.2026): ДЕНЬ СТАРТА задания в очереди станка — от УПАКОВЩИКА,
        // а не от ёмкость-оценки. Порядок очереди здесь АВТОРИТЕТЕН: слой размещения спрашивает про
        // КОНКРЕТНУЮ рассматриваемую расстановку, и переигрывать её упаковщик не должен.
        //   ids — очередь станка целиком; → { cutId: dayOffset первого сегмента }.
        // Кэш на прогон: слой размещения спрашивает про одну и ту же очередь много раз (соседние
        // точки вставки, оценка «остаться» в релокации, повторные проходы), а упаковка очереди —
        // самая дорогая операция размещения.
        var packStartDayMemo = {};
        function packStartDayFn(orderIds, machineId){
            var ids = orderIds || [];
            if (!ids.length) return {};
            var key = String(machineId) + '|' + ids.join(',');
            var hit = packStartDayMemo[key];
            if (hit !== undefined) return hit;
            var objs = ids.map(function(id){ return cutById[String(id)]; }).filter(Boolean);
            var out = {};
            if (objs.length){
                (packOrderedMachine(objs, String(machineId), true) || []).forEach(function(s){
                    var d = Number(s && s.dayOffset);
                    if (!isFinite(d)) return;
                    var id = String(s.cutId);
                    if (out[id] == null || d < out[id]) out[id] = d;
                });
            }
            packStartDayMemo[key] = out;
            return out;
        }
        // #4497/#4542: КОГО ОПЕРАТОР ДВИГАЕТ ПРЯМО СЕЙЧАС. ТЗ §15: ручное действие оператора запретами
        // формы плана не связано — ни «перед 🔒 ничего не ставить» (#4497), ни «🔒 не обгонять» (#4542).
        // Признак один на все слои (размещение и упаковщик), иначе исключение разъедется: все ручные
        // пути дают wholeDayCutIds (#4488), замок дня (#4221) и явное место в дне (#4464) — на случай
        // вызова только с ними.
        var manualMoveByCut = (function(){
            var m = {};
            [opts.wholeDayByCut, opts.dayLockByCut, opts.pinDayPosByCut].forEach(function(src){
                Object.keys(src || {}).forEach(function(id){ m[String(id)] = true; });
            });
            return m;
        })();
        // #4085: слой размещения (модель #3985) решает СТАНОК + порядок перебором ВСЕХ точек вставки
        // по мин. штрафу. Включается ТОЛЬКО при opts.slotPlacement && !preserveOrder (врезка стадий
        // 4-5). По умолчанию выкл → прежний путь (orderCuts + текущий станок) не тронут.
        var slotPlan = null, slotRefineCtx = null;
        if (opts.slotPlacement && !opts.preserveOrder) {
            // #4095: capacityMin — ЛИШЬ эвристика оценки дня для ПЕРВИЧНОГО порядка вставки, НЕ арбитр
            // срока. Раньше = сырое окно (dayEnd−dayStart) без обеда → оптимистично, оценённый день
            // раньше реального → штраф срока считался против слишком раннего дня → просрочка. Теперь
            // вычитаем обед (ближе к реальным ≈450); а СРОК держат РЕАЛЬНЫЕ дни splitMachineQueue (§12,
            // цикл релокации ниже). slotRefineCtx переиспользуем и для той релокации.
            var winMin = dayCapacityMinutes(windowFromOpts(opts), 'cuts');   // #4563: один потолок на всех
            slotRefineCtx = {
                settings: opts.weights, times: opts.times, capacityMin: winMin > 0 ? winMin : Infinity,
                baseMidnightMs: Number(opts.planBaseMidnightMs), perPassByCut: perPass,
                machineDayOffFor: opts.machineDayOffFor, feasibleMachine: opts.feasibleMachineFor,
                distanceExceededFor: opts.distanceExceededFor, dueDayByCut: opts.dueDayByCut,
                prevSetupBySlitter: opts.prevSetupBySlitter,   // #4288: заправка станков — первая резка очереди наследует её как prev (размещение + релокация)
                realStartDayFn: packStartDayFn   // #4547: день задания считает упаковщик, а не оценка
            };
            slotPlan = computeSlotPlacement(merged.cuts, slotExtend(slotRefineCtx, {
                dueKeyByCut: opts.dueKeyByCut, slitterIds: opts.slitterIds, vacationSlots: opts.vacationSlots,
                dayByCut: opts.dayByCut, relocate: false,   // #4095/§12: релокация — ниже, по РЕАЛЬНЫМ дням упаковщика
                orderIdsByCut: opts.orderIdsByCut,   // #4194: множества заказов заданий (штраф/бонус смежности в scorePosition)
                dayLockByCut: opts.dayLockByCut,   // #4221: замок дня/станка для переноса 🗓 «По весу» (позиция в дне по весу)
                // #4497: кого оператор двигает ПРЯМО СЕЙЧАС — на них запрет «перед 🔒 не ставить» не
                // действует (ТЗ §15). Признаки собраны в manualMoveByCut (см. выше) — тот же набор
                // получает и упаковщик (#4542), чтобы исключение не расходилось между слоями.
                manualMoveByCut: manualMoveByCut,
                machineLockByCut: opts.machineLockByCut,   // #4225: замок станка (перенос «В пределах одного станка» — без миграции между станками)
                // #4462: разбор выбора собираем ВСЕГДА, а не по тумблеру лога. Он теперь не только
                // печатается в [pp-slot], но и уходит наружу (ops.placement) в подсказку карточки
                // очереди: выключенный лог не должен отбирать у оператора объяснение выбора.
                trace: true
            }));
        }
        // Разложить резки станка в порядке очереди (preserveOrder — по «Дате план»/planStart
        // #3635/#3923; slotPlan — порядок слоя размещения #4085; иначе — orderCuts) и раскроить по дням.
        function orderMachineQueue(cutsOfMachine){
            // #3619: preserveOrder — расщеплять задания по дням, СОХРАНЯЯ текущий порядок
            // очереди, а не пересобирая её по стратегии (orderCuts). Нужно, чтобы автозаполнение
            // дней после генерации не перетасовывало ручной порядок оператора (#3449). Без флага —
            // обычная пересборка по весам (#3421).
            // #3635 п.1/п.2 + #3923: сортируем СПЕРВА по дню «Даты план», затем по СОХРАНЁННОМУ
            // planStart (planDate) — как groupBySlitter (#3616) и РМ «Диаграмма Ганта» (#3846).
            // planStart несёт и день, и позицию внутри дня, поэтому день-первым нужен лишь чтобы
            // сгруппировать; внутри дня время старта задаёт порядок (ручной ↑↓ переставляет
            // именно planStart, #3923). «Очередность» больше не хранится.
            // #3717: фольга ВСЕГДА в конец дня — критично (медленная намотка, отдельная норма).
            // preserveOrder сохраняет ручной порядок ВНУТРИ группы (день, фольга?), но фольгу
            // принудительно отправляет за все обычные резки того же дня (orderCuts при генерации
            // делает фольгу последней ПО ИСХОДНОМУ дню, а кросс-дневный re-pack и посменная
            // сборка иначе перемешивали её обратно).
            // #4200: рескью просрочки #4118 (relocateOverdueReal) на preserveOrder-пути даёт НОВЫЙ
            // порядок (ручной + просроченные подтянуты в срок) в slotPlan.orderIdxByCut с флагом
            // _rescued — его надо СОХРАНИТЬ при пере-упаковке, а не пере-сортировать по planStart.
            var useSlotOrder = slotPlan && slotPlan.orderIdxByCut && (slotPlan._rescued || !opts.preserveOrder);
            var ordered = useSlotOrder   // #4085/#4200: порядок слоя размещения / рескью (индекс в очереди станка)
                ? cutsOfMachine.slice().sort(function(a, b){
                      return (slotPlan.orderIdxByCut[String(a && a.id)] || 0) - (slotPlan.orderIdxByCut[String(b && b.id)] || 0); })
                : (opts.preserveOrder
                    ? cutsOfMachine.slice().sort(function(a, b){
                          // #3923: внутри дня ручной порядок оператора хранится в planStart
                          // (planDate), а не в «Очередности». Пустой planStart — в конец дня.
                          var pa = Number(a && a.planDate); if (!isFinite(pa) || pa <= 0) pa = Infinity;
                          var pb = Number(b && b.planDate); if (!isFinite(pb) || pb <= 0) pb = Infinity;
                          return comparePlanDayKeys(cutPlanDayKey(a), cutPlanDayKey(b))
                              // #4085: жёсткое «фольга — в конец дня» (#3717) снято; ручной порядок оператора
                              // (planStart) сохраняется как есть — фольга оседает в конец дня штрафом при генерации.
                              || (pa - pb)
                              || String((a && a.id) || '').localeCompare(String((b && b.id) || ''), 'ru');
                      })
                    : orderCuts(cutsOfMachine, opts.weights));
            return ordered;
        }
        function planMachineSegs(cutsOfMachine, key){
            return packOrderedMachine(orderMachineQueue(cutsOfMachine), key);
        }
        // #4118: упаковка УЖЕ упорядоченной очереди станка splitMachineQueue (без пере-сортировки).
        // Выделено из planMachineSegs, чтобы доп. проход по РЕАЛЬНЫМ дням (relocateOverdueReal) мог
        // паковать пробные порядки на любом станке теми же параметрами (обед/отпуск/нахлёст/заправка).
        function packOrderedMachine(ordered, key, forceOrderAuthoritative){
            var runsByCut = {};
            ordered.forEach(function(c){ runsByCut[String(c.id)] = Number(c.plannedRuns) || 0; });
            var packOpts = {
                dayStartMin: opts.dayStartMin, dayEndMin: opts.dayEndMin,
                dayEndHourMin: opts.dayEndHourMin,   // #3847: DAY_END_HOUR (реальный конец смены) для лимита нахлёста
                maxOverworkCutsMin: opts.maxOverworkCutsMin,   // #3847: макс. нахлёст резки за DAY_END_HOUR
                maxOverworkTuneMin: opts.maxOverworkTuneMin,   // #3847: макс. нахлёст настройки за DAY_END_HOUR
                leader: opts.leader, times: opts.times,
                perPassByCut: perPass, runsByCut: runsByCut,
                lunchStartMin: opts.lunchStartMin, lunchDurationMin: opts.lunchDurationMin,
                dayAnchorByCut: effAnchorByCut,   // #3974: якорь дня ТОЛЬКО за 🔒; #4434: замок абсолютен — не снимаем никогда
                storedDayByCut: anchorIn,         // #4497: ХРАНИМЫЙ день КАЖДОГО задания — по нему видно, кто стоял перед 🔒
                onFixedDayLost: opts.onFixedDayLost,   // #4434: 🔒 не удержало свой день (день нерабочий) — кричим наверх
                weights: opts.weights,            // #4050: веса §8 (DEADLINE/EXACT_DEADLINE_COST_MN)
                firstCutSetup: opts.firstCutSetup,   // #3669 п.2: настройка ножей первой задачи (от вызывающего)
                carryPrevSetup: (opts.prevSetupBySlitter || {})[key],   // #3853: реальная заправка станка для первой резки (как окно в setupActivityColumns)
                // #4314: длинные окна «Отпуска» этого станка (сбрасывают наладку) + день, который
                // описывает его заправка (последнее задание раньше «С», #4312; иначе день базы).
                longVacationRanges: (opts.longVacationRangesBySlitter || {})[key],
                carryPrevSetupDay: ((opts.prevSetupBySlitter || {})[key] || {}).dayOffset,
                gapFill: opts.gapFill,   // #3739: заполнять хвосты смены будущими резками, нахлёст разрешён
                blockedRanges: (opts.blockedRangesBySlitter || {})[key],   // #3764: окна «Отпуска» этого станка
                frozenDayFor: opts.frozenDayFor,   // #4326-seal: замороженный день — новые резки в него НЕ кладём (существующие остаются)
                // #4085: порядок задан слоем размещения — не переигрывать. #4547: при вопросе ИЗ
                // размещения (слой ещё считает) порядок авторитетен явно — спрашивают про конкретную
                // рассматриваемую расстановку.
                orderAuthoritative: forceOrderAuthoritative || !!slotPlan,
                pinDayPosByCut: opts.pinDayPosByCut,   // #4464: ручной перенос 🗓 «в начало дня» / «в конец дня»
                wholeDayByCut: opts.wholeDayByCut,     // #4488: перенесённое задание ложится в свой день ЦЕЛИКОМ
                manualMoveByCut: manualMoveByCut       // #4542: кого оператор двигает СЕЙЧАС — запрет обгона 🔒 их не связывает
            };
            // #4085 (модель #3985): дедлайн-фольга у своего срока обеспечивается локальным штрафом в слое
            // размещения (scorePosition), а не резервированием хвоста дня (#4068 снят — computeFoilDeadlineReservation
            // удалён). Один проход упаковки без пробного второго прохода/резерва.
            return splitMachineQueue(ordered, packOpts);
        }
        // #3974: группируем ВСЕ переданные резки по станку (без scope-фильтра дат) и раскладываем
        // каждую очередь от «С». Перелив продолжений за конец дня/«По» — обычная работа
        // splitMachineQueue (#3280); спец-обработки #3918 «спил-день вне окна» больше не нужно:
        // окна-фильтра нет, все дни раскладки — наши.
        // Группировка резок по станку (назначение слоя размещения #4085 либо текущий станок) + реальная
        // упаковка каждой очереди splitMachineQueue. Пере-запускается §12-циклом релокации по реальным дням.
        function packAll(){
            var bm = {}, order = [];
            merged.cuts.forEach(function(c){
                var sid = (slotPlan && slotPlan.slitterByCut[String(c && c.id)] != null)
                    ? slotPlan.slitterByCut[String(c && c.id)]   // #4085: станок выбран слоем размещения
                    : (c && c.slitter && c.slitter.id);
                if (sid == null) return;
                var key = String(sid);
                if (!bm[key]) { bm[key] = []; order.push(key); }
                bm[key].push(c);
            });
            var segsBy = {};
            order.forEach(function(key){ segsBy[key] = planMachineSegs(bm[key], key); });
            return { byMachine: bm, mOrder: order, segsByMachine: segsBy };
        }
        // #4139/#3717: сколько раз в сегментах станка нефольга идёт ПОСЛЕ фольги в том же дне
        // (сегменты идут в порядке упаковки, день не убывает). Считаем, а не «да/нет»: #4085 снял
        // жёсткое правило (фольгу держит штраф FOIL_NOTEND_COST_MN), поэтому нарушения бывают и до
        // пересортировки — проход не должен их ДОБАВЛЯТЬ, но и отказываться из-за чужих не обязан.
        function foilNotLastCount(segs, byId){
            var day = null, foilSeen = false, n = 0;
            (segs || []).forEach(function(s){
                var off = Number(s.dayOffset); if (!isFinite(off)) return;
                if (off !== day){ day = off; foilSeen = false; }
                var c = byId[String(s.cutId)];
                if (!c) return;
                if (c.isFoil) foilSeen = true;
                else if (foilSeen) n++;
            });
            return n;
        }
        // #4200: РЕАЛЬНЫЙ день = КАЛЕНДАРНЫЙ день приземления сегмента, а НЕ логический dayOffset.
        // splitMachineQueue пакует по ЛОГИЧЕСКИМ дням (dayOffset 0,1,2…), а нерабочие дни
        // (выходные/праздники/отпуск) сдвигают ОКНО (windowStartMin) вперёд, НЕ трогая dayOffset
        // (проверено: блок дней 2-3 → сегмент dayOffset=2, windowStartMin=6240 ⇒ календарный день 4).
        // Панель просрочки (countOverdueCuts → planDateDayKey(planStart)) и dueDayByCut считают по
        // КАЛЕНДАРЮ (dueDayOffsetFromBase), поэтому арбитр §12/#4118 ОБЯЗАН сравнивать календарный
        // день, иначе задание за выходными числится «в срок ✓», а панель — просроченным (issue #4200,
        // расхождение «§12: просрочек нет» vs «панель: N»). Календарный день = floor(windowStartMin/1440)
        // = день planStart (scheduleStartTimestamp = base + windowStartMin·60000).
        function segCalDay(s){
            var ws = Number(s && s.windowStartMin);
            if (isFinite(ws)) return Math.floor(ws / 1440);
            var off = Number(s && s.dayOffset);
            return isFinite(off) ? off : null;
        }
        // cutId → РЕАЛЬНЫЙ (календарный) день ЗАВЕРШЕНИЯ НАМОТКИ из реальной упаковки.
        // #4209: раньше брали день ПО ВСЕМ сегментам, включая setup-only ХВОСТ (#3889: настройка в
        // конце дня N, 0 проходов, намотка-продолжение с дня N+k за выходные). Резка с настройкой в день 2
        // и намоткой в день 5 числилась «день 2, в срок», рескью #4118 её НЕ видел («осталось за срок 0»),
        // а панель (#4161, planDate ПРОДОЛЖЕНИЯ) — просрочку. Срок держит ДЕНЬ НАМОТКИ.
        // #4290: у РАЗБИТОГО по дням задания намотка идёт на НЕСКОЛЬКО дней; срок выполняется, лишь когда
        // готова ПОСЛЕДНЯЯ часть, поэтому берём МАКС (последний) день среди сегментов С ПРОХОДАМИ —
        // ДЕНЬ ЗАВЕРШЕНИЯ. Раньше брали МИН (день СТАРТА): голова влезала в срок, хвост переливался за
        // срок, но арбитр §12/#4118 видел задание «в срок» по дню головы и не сдвигал его раньше —
        // хвост оставался просроченным (issue #4290; расходилось с панелью, которая считает по planDate
        // хвоста-продолжения). setup-only хвост срок по-прежнему НЕ держит (0 проходов исключены). Если у
        // резки одни setup-сегменты (штатный setup-рекорд #3635) — фолбэк на общий минимум, чтобы день
        // был определён всегда.
        function segHasWinding(s){ return (Number(s && s.runs) || 0) > 0 || (Number(s && s.durationMin) || 0) > 0; }
        function windingDaysFromSegs(segList){
            var wind = {}, any = {};
            (segList || []).forEach(function(s){
                var off = segCalDay(s); if (off == null) return;
                var id = String(s.cutId);
                if (any[id] == null || off < any[id]) any[id] = off;
                if (!segHasWinding(s)) return;                       // #4209: setup-only хвост срок НЕ держит
                if (wind[id] == null || off > wind[id]) wind[id] = off;   // #4290: МАКС намоточный день = день ЗАВЕРШЕНИЯ (все части в срок)
            });
            Object.keys(any).forEach(function(id){ if (wind[id] == null) wind[id] = any[id]; });   // фолбэк
            return wind;
        }
        function realDaysFrom(segsBy){
            var all = [];
            Object.keys(segsBy).forEach(function(key){ (segsBy[key] || []).forEach(function(s){ all.push(s); }); });
            return windingDaysFromSegs(all);
        }
        // #4118: реальный день ЗАВЕРШЕНИЯ каждого задания при заданном порядке очереди станка (реальная
        // упаковка splitMachineQueue с параметрами станка). realDayFn(orderIds, machineId) → {id: day}.
        function realPackFn(orderIds, machineId){
            var objs = (orderIds || []).map(function(id){ return cutById[String(id)]; }).filter(Boolean);
            // #4200: календарный день; #4209/#4290: по сегментам НАМОТКИ, ПОСЛЕДНИЙ день (setup-only хвост срок не держит).
            return windingDaysFromSegs(packOrderedMachine(objs, String(machineId)));
        }
        var packed = packAll();
        // #4095 / ТЗ §12: срок держат РЕАЛЬНЫЕ дни splitMachineQueue, а НЕ ёмкость-оценка размещения.
        // Пакуем → у кого реальный день ≥ срока (shouldRelocate), релокация тянет раньше, ПОКА ЕСТЬ
        // ёмкость → пере-пакуем. Монотонно (relocatePass двигает лишь строго дешевле) + cap раундов.
        // Только при активном слое размещения и заданных сроках; иначе прежнее поведение не тронуто.
        var refineRounds = 0, refineMoves = 0;
        // #4462: КТО тронул задание ПОСЛЕ §8-размещения. Подсказка карточки объясняет выбор §8, и если
        // место потом переопределил другой проход, она обязана это сказать, а не выдавать сравнение
        // весов за окончательное решение (иначе объяснение расходится с тем, что оператор видит).
        var movedByPass = {};
        function markMoved(id, passName){ if (id != null && !movedByPass[String(id)]) movedByPass[String(id)] = passName; }
        if (slotPlan && slotPlan.occupancy && opts.dueDayByCut && slotRefineCtx) {
            var maxRounds = Number(opts.slotRefineRounds) || 4;
            for (var rr = 0; rr < maxRounds; rr++) {
                var rel = relocatePass(slotPlan.occupancy, realDaysFrom(packed.segsByMachine), slotRefineCtx);
                if (!rel.moves.length) break;
                refineRounds++; refineMoves += rel.moves.length;
                rel.moves.forEach(function(m){ markMoved(m.id, 'релокация §12'); });
                var asg = assignmentFromOccupancy(slotPlan.occupancy);
                slotPlan.slitterByCut = asg.slitterByCut; slotPlan.orderIdxByCut = asg.orderIdxByCut;
                packed = packAll();
            }
        }
        // #4118: ДОП. ПРОХОД после §12-цикла. Мягкая релокация (relocatePass) оценивает кандидатов
        // ОПТИМИСТИЧНОЙ оценкой дня (capacityMin) и может «переносить вхолостую», оставив задание
        // просроченным (лог #4118: 4 раунда / 28 переносов, 458219 всё ещё за сроком). Затолкаем всё
        // ВСЁ ЕЩЁ просроченное (по РЕАЛЬНЫМ дням) в наименее штрафное место — можно на другой станок —
        // стандартным перебором точек вставки, но проверяя каждого кандидата РЕАЛЬНОЙ упаковкой
        // (realPackFn), и НЕ трогая остальные задания (перенос лишь если чужая просрочка не углубится).
        // #4200: раньше #4118 был заперт за (slotPlan && !preserveOrder) → «Пересчитать наладку» после
        // ручной ↑/↓ (autoSequenceQueue preserveOrder=true) паковал в ручном порядке БЕЗ единой проверки
        // срока и без трассы → задания уезжали за срок молча (issue #4200). Теперь #4118 идёт на ВСЕХ
        // путях, где заданы сроки: на preserveOrder строим занятость из ТЕКУЩЕГО (ручного) порядка,
        // relocateOverdueReal двигает ТОЛЬКО просроченные (по КАЛЕНДАРНЫМ дням, #4200 realDaysFrom),
        // порядок задач В СРОК не трогает. ctx нужен и без слоя размещения — собираем refineCtx4200.
        var refineCtx4200 = slotRefineCtx || {
            settings: opts.weights, times: opts.times,
            capacityMin: (function(){ var w = dayCapacityMinutes(windowFromOpts(opts), 'cuts'); return w > 0 ? w : Infinity; })(),   // #4563: один потолок на всех
            baseMidnightMs: Number(opts.planBaseMidnightMs), perPassByCut: perPass,
            machineDayOffFor: opts.machineDayOffFor, feasibleMachine: opts.feasibleMachineFor,
            distanceExceededFor: opts.distanceExceededFor, dueDayByCut: opts.dueDayByCut,
            realStartDayFn: packStartDayFn   // #4547: и на пути БЕЗ слоя размещения день считает упаковщик
        };
        // #4200: занятость из ТЕКУЩЕГО порядка станков (ручной planStart на preserveOrder) — вход #4118
        // на пути без слоя размещения. slotFromCut даёт полноценный слот (сырьё/ножи/срок) для scorePosition.
        function occupancyFromCurrentOrder(){
            var bm = {};
            (opts.slitterIds || []).forEach(function(sid){ bm[String(sid)] = []; });   // #4200: и ПУСТЫЕ станки — возможная цель рескью
            packed.mOrder.forEach(function(key){
                bm[key] = orderMachineQueue(packed.byMachine[key]).map(function(c){
                    return slotFromCut(c, opts.dueKeyByCut ? opts.dueKeyByCut[String(c && c.id)] : undefined);
                });
            });
            return { byMachine: bm };
        }
        // #4203: рескью #4118 записывает best.real в МОМЕНТ переноса (реальный день кандидата), но
        // последующие переносы того же раунда пере-упаковывают станок-приёмник, и задание, «положенное в
        // срок», в ФИНАЛЬНОМ packAll уезжает позже — стейл best.real (реальный лог 543436: «день 2» записан,
        // финал «день 5», при СВОБОДНОМ станке в срок с тем же сырьём). Внутренний цикл relocateOverdueReal
        // (maxRounds) снимает дни со СВОЕЙ мутируемой занятости; этого мало, если задание дестабилизируется
        // на последнем раунде. ВНЕШНИЙ цикл: ПЕРЕ-СЕЯТЬ занятость из АВТОРИТЕТНОГО packAll (occupancyFrom-
        // CurrentOrder читает packed.byMachine в порядке orderMachineQueue = порядок финальной упаковки) и
        // повторить рескью, ПОКА остаток за срок по РЕАЛЬНЫМ дням СТРОГО убывает. Монотонно (каждый перенос
        // строго уменьшает реальный день — см. relocateOverdueReal) ⇒ сходимость; на пере-сев задание видно
        // на его НАСТОЯЩЕМ (позднем) дне и рескью может увести его на свободный станок в срок.
        var overduePass = { moves: 0, moveLog: [], rounds: 0 };
        if (opts.dueDayByCut) {
            var prevResid4203 = Infinity, maxOuter4203 = Number(opts.overdueRescueRounds) || 4;
            function residualOverdueCount(){
                var real = realDaysFrom(packed.segsByMachine), n = 0;
                Object.keys(real).forEach(function(id){ var d = opts.dueDayByCut[id]; if (d != null && Number(real[id]) > Number(d)) n++; });
                return n;
            }
            for (var oR4203 = 0; oR4203 < maxOuter4203; oR4203++) {
                // Итерация 0 на пути размещения — богатая занятость слоя (#4085); дальше — пере-сев из packed.
                var occ4118 = (oR4203 === 0 && slotPlan && slotPlan.occupancy) ? slotPlan.occupancy : occupancyFromCurrentOrder();
                var rel2 = relocateOverdueReal(occ4118, opts.dueDayByCut, realPackFn,
                    slotExtend(refineCtx4200, { feasibleMachine: opts.feasibleMachineFor }));
                if (rel2.moves.length) {
                    overduePass.moves += rel2.moves.length;
                    rel2.moves.forEach(function(m){ overduePass.moveLog.push(m); markMoved(m.id, 'спасение просрочки #4118'); });
                    var asg2 = assignmentFromOccupancy(occ4118);
                    if (!slotPlan) slotPlan = { occupancy: occ4118 };
                    slotPlan._rescued = true;   // #4200: пере-упаковка обязана взять этот порядок (см. orderMachineQueue)
                    slotPlan.slitterByCut = asg2.slitterByCut; slotPlan.orderIdxByCut = asg2.orderIdxByCut;
                    packed = packAll();
                }
                overduePass.rounds++;
                var resid4203 = residualOverdueCount();
                // Стоп: нет ходов / всё в срок / остаток НЕ уменьшился (защита от пинг-понга, монотонность).
                if (!rel2.moves.length || resid4203 === 0 || resid4203 >= prevResid4203) break;
                prevResid4203 = resid4203;
            }
        }
        // #4338: ЕДИНЫЙ жадный проход по СУММАРНОМУ штрафу (ТЗ §8/§11) — поверх занятости слоя. Двигает
        // худшее по штрафу задание (срок доминирует) в позицию с минимальным суммарным штрафом; хэш-
        // пропуск виденных расстановок; монотонно ⇒ без зацикливания. Идёт ПОСЛЕ оценочных проходов
        // (может только уменьшить суммарный штраф). Выключается slotGreedy=false. Пере-упаковываем итог.
        var greedyMovePath = opts.preserveOrder
            || (opts.dayLockByCut && Object.keys(opts.dayLockByCut).length)
            || (opts.machineLockByCut && Object.keys(opts.machineLockByCut).length);   // #4338: ручной перенос/порядок — не переоптимизируем
        if (slotPlan && slotPlan.occupancy && opts.dueDayByCut && opts.slotGreedy !== false && !greedyMovePath) {
            var greedyOut = greedyRefine(slotPlan.occupancy, opts.dueDayByCut, realPackFn,
                slotExtend(refineCtx4200, { feasibleMachine: opts.feasibleMachineFor }));
            (greedyOut.moves || []).forEach(function(m){ markMoved(m.id, 'жадный проход #4338'); });   // #4462
            var asgG = assignmentFromOccupancy(slotPlan.occupancy);
            slotPlan._rescued = true;   // пере-упаковка обязана взять этот порядок
            slotPlan.slitterByCut = asgG.slitterByCut; slotPlan.orderIdxByCut = asgG.orderIdxByCut;
            packed = packAll();
        }
        // #4139: ВНУТРИДНЕВНАЯ ПЕРЕСОРТИРОВКА. Слой размещения вставляет резки по одной и собранный
        // день больше не чинит, поэтому одинаковая конфигурация попадает в день дважды, разорванная
        // чужим сырьём. День уже назначен реальной упаковкой → перестановка ВНУТРИ дня не двигает
        // день и не меняет штрафы срока. Цель — sequencingCost (#3996), а не голые минуты: минимум
        // минут разгоняет РОСТ числа полос вопреки #3130.
        // Проверяем и применяем ПОСТАНОЧНО: очереди станков пакуются независимо (packOrderedMachine),
        // поэтому неудача на одном станке не должна отменять выигрыш на остальных. Принимаем новый
        // порядок станка, только если пере-упаковка не отправила НИ ОДНУ его резку на более поздний
        // день и не сломала «фольга в конце дня» (#3717).
        // #4462: reorderedMachines — станки, ЧЕЙ ПОРЯДОК переставили пост-проходы (#4139 пересортировка
        // внутри дня, #4184 склейка островов). Поимённо «кто поехал» они не сообщают, поэтому в подсказке
        // это отдельная, более слабая формулировка: «порядок в дне после выбора ещё пересортировали».
        var reorderedMachines = {};
        var reseqPass = { machines: 0, skipped: 0 };
        if (slotPlan && !opts.preserveOrder && opts.intraDayResequence !== false) {
            var reseqTimes = planningChangeTimes(opts);
            packed.mOrder.forEach(function(key){
                var segs = packed.segsByMachine[key] || [];
                var dayByCut = {}, spanning = {}, seen = {};
                segs.forEach(function(s){
                    var off = Number(s.dayOffset); if (!isFinite(off)) return;
                    var id = String(s.cutId);
                    if (dayByCut[id] == null || off < dayByCut[id]) dayByCut[id] = off;
                    if (!seen[id]) seen[id] = {};
                    seen[id][off] = 1;
                    if (Object.keys(seen[id]).length > 1) spanning[id] = true;   // день-сплит: хвост дня закреплён
                });
                var ordered = orderMachineQueue(packed.byMachine[key]);
                if (!ordered.length) return;
                var prevSetup = (opts.prevSetupBySlitter || {})[key];
                var entry = prevSetup ? carryOverPrevCut(prevSetup, ordered[0]) : null;
                // #4434 п.5: веса «Настройки» (KNIVES_INCREASE_COST_MN и пр.) — В цель пересортировки.
                // Без них она считала направленный штраф по дефолтам кода, игнорируя таблицу.
                var better = resequenceWithinDays(ordered, dayByCut, spanning, entry, reseqTimes, opts.weights);
                if (!better) return;
                var trialSegs = packOrderedMachine(better, key);
                var trialDays = {};
                (trialSegs || []).forEach(function(s){
                    var off = Number(s.dayOffset); if (!isFinite(off)) return;
                    var id = String(s.cutId);
                    if (trialDays[id] == null || off < trialDays[id]) trialDays[id] = off;
                });
                var later = Object.keys(trialDays).some(function(id){
                    return dayByCut[id] != null && trialDays[id] > dayByCut[id];
                });
                var oldFoilBad = foilNotLastCount(segs, cutById);
                var newFoilBad = foilNotLastCount(trialSegs, cutById);
                var foilWorse = newFoilBad > oldFoilBad;
                // #4224: этот порядок ЧИНИТ «фольга в конец дня» (#3717 — ЖЁСТКОЕ правило). Принимаем
                // починку, даже если пере-упаковка (фольга в хвост переполненного дня) увела резку на
                // более поздний день, — НО никогда ЗА СРОК (просрочка недопустима #4224). Иначе
                // (foil-end не улучшается) — прежняя строгая приёмка: не двигать ничего на день позже.
                if (newFoilBad < oldFoilBad) {
                    var dueBy = opts.dueDayByCut || {};
                    var causesOverdue = Object.keys(trialDays).some(function(id){
                        return dueBy[id] != null && trialDays[id] > Number(dueBy[id]);
                    });
                    if (causesOverdue) { reseqPass.skipped++; return; }
                } else if (later || foilWorse) { reseqPass.skipped++; return; }   // инвариант важнее экономии
                better.forEach(function(c, i){ slotPlan.orderIdxByCut[String(c.id)] = i; });
                packed.segsByMachine[key] = trialSegs;
                reorderedMachines[String(key)] = 'внутридневная пересортировка #4139';   // #4462
                reseqPass.machines++;
            });
        }
        // #4184: ПОСТПРОХОД устранения лишней переналадки. Одинаковое сырьё+намотка попадает в
        // ОДИН блок ножей ДВАЖДЫ, не подряд, часто через границу дня — #4139 склеивает такое лишь
        // ВНУТРИ дня, а тут дубль может лежать в разных днях (напр. первая резка 01.07, группа-дубль
        // 03.07). Пробуем склеить дубль внутри блока ножей (порядок блоков/ножей не меняем),
        // притягивая ту сторону дубля, у которой ЕСТЬ запас по сроку, и принимаем перестановку лишь
        // если РЕАЛЬНАЯ упаковка: (1) снижает минуты наладки (ушла хотя бы одна смена сырья),
        // (2) не двигает НИ ОДНУ резку на день позже её срока (не плодит и не углубляет просрочку —
        // иначе штраф опоздания перебьёт экономию), (3) не портит «фольга в конце дня» (#3717).
        // Обе стороны дубля пробуются (byLast=false/true); безопасную оставляет проверка срока.
        // #4205: глобальная перестановка блока отвергалась, если ХОТЬ ОДНО ЧУЖОЕ задание блока от
        // неё уезжало за срок — и выгодная ЛОКАЛЬНАЯ склейка дубля не случалась (единичное сырьё в
        // начале + группа-дубль в конце: byLast роняет свой срок у приколотого сроком единичного,
        // byFirst — чужой срок соседа при тасовке всего блока). К глобальным кандидатам добавлены
        // ХИРУРГИЧЕСКИЕ (materialIslandMergeCandidates): склейка островов ОДНОЙ конфигурации, двигающая
        // ТОЛЬКО её резки — остальной порядок блока цел, чужие сроки не задеты. Per-machine цикл
        // применяет ЛУЧШИЙ безопасный кандидат, пока есть улучшение (монотонно по наладке → сходится).
        var dedupPass = { machines: 0 };
        if (slotPlan && !opts.preserveOrder && opts.intraBlockDedup !== false && opts.dueDayByCut) {
            var dedupTimes = planningChangeTimes(opts);
            var dueDay = opts.dueDayByCut;
            packed.mOrder.forEach(function(key){
                var prevSetup = (opts.prevSetupBySlitter || {})[key];
                var applied = false, guard = 0, hardCap = (packed.byMachine[key] || []).length + 4;
                while (guard++ < hardCap){
                    var segs = packed.segsByMachine[key] || [];
                    var oldDayByCut = {};
                    segs.forEach(function(s){
                        var off = Number(s.dayOffset); if (!isFinite(off)) return;
                        var id = String(s.cutId);
                        if (oldDayByCut[id] == null || off < oldDayByCut[id]) oldDayByCut[id] = off;
                    });
                    var ordered = orderMachineQueue(packed.byMachine[key]);
                    if (ordered.length < 3) break;
                    var entry = prevSetup ? carryOverPrevCut(prevSetup, ordered[0]) : null;
                    var oldReal = runChainCost(ordered, entry, dedupTimes, changeoverCost);
                    var oldFoil = foilNotLastCount(segs, cutById);
                    var cands = [];
                    [false, true].forEach(function(byLast){ var c = clusterMaterialWithinKnifeBlocks(ordered, byLast); if (c) cands.push(c); });
                    materialIslandMergeCandidates(ordered).forEach(function(c){ cands.push(c); });
                    var best = null;
                    cands.forEach(function(cand){
                        var newReal = runChainCost(cand, entry, dedupTimes, changeoverCost);
                        if (!(newReal < oldReal - 1e-9)) return;   // должна уйти хотя бы одна наладка
                        var trialSegs = packOrderedMachine(cand, key);
                        var newDayByCut = {};
                        (trialSegs || []).forEach(function(s){
                            var off = Number(s.dayOffset); if (!isFinite(off)) return;
                            var id = String(s.cutId);
                            if (newDayByCut[id] == null || off < newDayByCut[id]) newDayByCut[id] = off;
                        });
                        // ни одна резка не должна уехать на день позже срока (новая/углублённая просрочка)
                        var worse = Object.keys(newDayByCut).some(function(id){
                            var due = dueDay[id]; if (due == null) return false;
                            due = Number(due);
                            var nd = newDayByCut[id], od = oldDayByCut[id];
                            if (nd <= due) return false;         // укладывается в срок
                            if (od == null) return true;         // не было в упаковке — не рискуем
                            if (od <= due) return true;          // была в срок, стала просрочена — новое опоздание
                            return nd > od;                      // была просрочена, стала ещё позже — углубление
                        });
                        if (worse) return;
                        if (foilNotLastCount(trialSegs, cutById) > oldFoil) return;
                        if (!best || newReal < best.newReal) best = { cand: cand, segs: trialSegs, newReal: newReal };
                    });
                    if (!best) break;
                    best.cand.forEach(function(c, i){ slotPlan.orderIdxByCut[String(c.id)] = i; });
                    packed.segsByMachine[key] = best.segs;
                    reorderedMachines[String(key)] = 'склейка островов сырья #4184';   // #4462
                    if (!applied){ applied = true; dedupPass.machines++; }
                }
            });
        }
        var byMachine = packed.byMachine, mOrder = packed.mOrder, segsByMachine = packed.segsByMachine;
        // #4095: дополнить trace РЕАЛЬНЫМИ днями (арбитр §12) и напечатать (slotTrace ВКЛ по умолчанию).
        if (slotPlan && slotPlan.trace) {
            var finalReal = realDaysFrom(segsByMachine), overdueLeft = 0;
            (slotPlan.trace.tasks || []).forEach(function(t){
                // #4462: место, выбранное §8, могли переопределить последующие проходы. Дописываем это
                // в разбор — подсказка обязана сказать оператору, что итог не равен сравнению весов.
                var pass = movedByPass[String(t.id)];
                var finalMid = slotPlan.slitterByCut ? slotPlan.slitterByCut[String(t.id)] : null;
                if (!pass && finalMid != null && t.chosen && String(finalMid) !== String(t.chosen.machineId)) pass = 'последующая пересборка';
                if (pass){ t.movedAfter = true; t.movedBy = pass; }
                t.finalMachineId = finalMid == null ? null : String(finalMid);
                if (!t.movedAfter && finalMid != null && reorderedMachines[String(finalMid)]) t.reseqBy = reorderedMachines[String(finalMid)];
                var rd = finalReal[String(t.id)];
                if (rd == null) return;
                t.realDay = rd;
                var due = opts.dueDayByCut ? opts.dueDayByCut[String(t.id)] : null;
                if (due != null) { t.dueDayOffset = Number(due); t.overdueReal = rd > Number(due); if (t.overdueReal) overdueLeft++; }
            });
            slotPlan.trace.refine = { rounds: refineRounds, moves: refineMoves, overdueLeft: overdueLeft, overdueMoves: overduePass.moves };
            formatSlotPlacementTrace(slotPlan.trace).forEach(function(line){ slotTrace(line); });
        }
        // #4200: ГРОМКАЯ трасса рескью просрочки + ОСТАТОК на ВСЕХ путях (вкл. preserveOrder-пересчёт, где
        // slotPlan.trace нет вовсе). Панель «просрочено: N» (#4161) показывает итог; здесь — КАЖДЫЙ перенос
        // #4118 и поимённо задания, ОСТАВШИЕСЯ за сроком по КАЛЕНДАРНЫМ дням (честный дефицит ёмкости),
        // чтобы просрочка не появлялась молча (issue #4200: «проверять КАЖДОЕ перемещение и писать в трейс»).
        var overdueResidual = [];
        if (opts.dueDayByCut) {
            var finalRealAll = realDaysFrom(segsByMachine);
            Object.keys(finalRealAll).forEach(function(id){
                var due = opts.dueDayByCut[id];
                if (due != null && Number(finalRealAll[id]) > Number(due)) overdueResidual.push({ cutId: id, realDay: Number(finalRealAll[id]), dueDay: Number(due) });
            });
            if (overduePass.moves || overdueResidual.length) {
                slotTrace('#4200 доп. проход #4118 (' + (opts.preserveOrder ? 'пересчёт наладки / ручной порядок' : 'генерация / упорядочить')
                    + '): переносов ' + overduePass.moves + ', осталось за срок ' + overdueResidual.length + (overdueResidual.length ? '' : ' — просрочек нет ✓'));
                (overduePass.moveLog || []).forEach(function(m){ slotTrace('  ↳ перенос просроченного ' + m.id + ': станок ' + m.from + ' → ' + m.to + (m.real != null ? (', реальный (календарный) день ' + m.real) : '')); });
                overdueResidual.forEach(function(o){ slotTrace('  ⚠️ ОСТАЁТСЯ ЗА СРОКОМ ' + o.cutId + ': календарный день ' + o.realDay + ' > срок(день) ' + o.dueDay + ' — честный дефицит ёмкости, вручную не разместить без вытеснения'); });
                // #4203 ДИАГНОСТИКА: для КАЖДОГО оставшегося за сроком — какой день дал бы ДОЗАКЛАД (append)
                // на каждый ДОПУСТИМЫЙ станок по АВТОРИТЕТНОЙ упаковке (realPackFn на текущей очереди станка +
                // резка в конец). Показывает, был ли СВОБОДНЫЙ слот в срок (пропущенный) или это истинный
                // дефицит: «станок K: день D (в срок ✓ / позже)». Кастомер #4203: «в предыдущие дни полно место».
                var feas4203 = opts.feasibleMachineFor || function(){ return true; };
                overdueResidual.forEach(function(o){
                    var cut = cutById[String(o.cutId)]; if (!cut) return;
                    var slot4203 = slotFromCut(cut, opts.dueKeyByCut ? opts.dueKeyByCut[String(o.cutId)] : undefined);
                    var probes = [];
                    (opts.slitterIds || mOrder).forEach(function(key){
                        key = String(key);
                        if (!feas4203(key, slot4203)) { probes.push(key + ':✗недоп'); return; }
                        var ids = (packed.byMachine[key] ? orderMachineQueue(packed.byMachine[key]) : [])
                            .map(function(c){ return String(c && c.id); }).filter(function(id){ return id !== String(o.cutId); });
                        ids.push(String(o.cutId));
                        var day = (realPackFn(ids, key) || {})[String(o.cutId)];
                        probes.push(key + ':день' + (day == null ? '?' : day) + (day != null && Number(day) <= o.dueDay ? '✓' : ''));
                    });
                    slotTrace('     ↳ #4203 дозаклад ' + o.cutId + ' (срок день ' + o.dueDay + ') по станкам: ' + probes.join('  '));
                });
            }
        }
        var updates = [], creates = [], deletes = [];
        // #4467: занятость станко-дня (наладка + намотка; лидер уже внутри намотки) — ровно то, что
        // показывает бейдж «(N мин)» у даты. Отдаём вместе с операциями: страж записи (инвариант
        // DAY_CAPACITY) сверяет её с потолком дня, а считать её заново в контроллере нечем — окна и
        // разбиение по дням знает только упаковщик. Ключ — «станок|смещение дня».
        var dayLoad = {};
        // #4469: недоупакованные станко-дни этой раскладки (для стража DAY_FILL) — считает сам
        // упаковщик своим гейтом потолка (underfilledLayoutDays в splitMachineQueue).
        var dayFill = [];
        // headId → число использованных записей цепочки (голова + переиспользованные продолжения).
        var usedByHead = {};
        mOrder.forEach(function(key){
            var segs = segsByMachine[key];
            segs.forEach(function(seg){
                var dk = String(key) + '|' + Number(seg.dayOffset);
                dayLoad[dk] = round3((dayLoad[dk] || 0) + (Number(seg.setupMin) || 0) + (Number(seg.durationMin) || 0));
            });
            (segs.underfilled || []).forEach(function(u){
                dayFill.push({ key: String(key) + '|' + Number(u.day), slitterId: String(key), day: Number(u.day),
                               freeMin: u.freeMin, needMin: u.needMin, donorCutId: u.donorCutId });
            });
            // #4061: снап окон к целым минутам — старт следующего сегмента = старт текущего + сумма
            // его колонок (без дрейфа Ганта/очереди). Упаковку/дни/проходы это не трогает.
            snapSplitSegmentWindows(segs);
            // headId → индекс продолжения в цепочке (0=голова, 1,2,… — продолжения по дням).
            var contIndexByHead = {};
            segs.forEach(function(seg, idx){
                var ts = scheduleStartTimestamp(base, seg.windowStartMin);
                // #4471: ЗАНЯТОСТЬ станка этим сегментом в ЦЕЛЫХ минутах — round(наладка) + ceil(намотка),
                // ровно то, что уйдёт в колонки, сложит бейдж дня (#4131/#4149) и нарисует Гант. Отдаём
                // вместе с операцией: объектив «Упорядочить» обязан мерить кандидата ЕГО минутами, а не
                // хранимыми колонками прошлого плана (те описывают ДРУГУЮ раскладку — issue #4471).
                var setupWhole = Math.round(round3(Number(seg.setupMin) || 0));
                var occMin = setupWhole + Math.ceil(round3(Number(seg.durationMin) || 0));
                // #4499: КОЛОНКИ СЕГМЕНТА — то, что напаковал упаковщик, а не отдельный пересчёт.
                // knife+material = setupWhole, cutTime = вся намотка с лидером ⇒ сумма трёх колонок
                // РАВНА occMin, то есть бейджу дня и мерке потолка. Раньше их считал контроллер по
                // своей развёртке очереди, и на разбитых по дням заданиях/наладочных хвостах две
                // арифметики расходились — в бейдже появлялись минуты, которых в плане нет.
                var kMin = Math.round(round3(Number(seg.setupKnifeMin) || 0));
                var mMin = Math.round(round3(Number(seg.setupMaterialMin) || 0));
                if (kMin + mMin !== setupWhole) kMin = setupWhole - mMin;   // сумма обязана сойтись
                if (kMin < 0) { kMin = setupWhole; mMin = 0; }
                var planCols = { knife: kMin, material: mMin, cutTime: occMin - setupWhole };
                // #4144: разложение setup-only ХВОСТА дня по колонкам — решение УПАКОВЩИКА (он считал
                // room по дробному окну). Отдаём его вызывающему: писатель колонок обязан взять это, а не
                // пересчитывать от снапнутого planStart (снап позже на накопленный ceil → room меньше).
                if (seg.setupOnly && seg.setupKnifeMin != null && typeof opts.onTailSetup === 'function') {
                    opts.onTailSetup(key, ts, { knife: Math.round(seg.setupKnifeMin), material: Math.round(seg.setupMaterialMin) });
                }
                if (!seg.isContinuation) {
                    var head0 = String(seg.cutId);
                    contIndexByHead[head0] = 0;
                    usedByHead[head0] = 1;   // голова цепочки всегда занята первым сегментом
                    updates.push({ cutId: head0, sequence: idx + 1, planStartTs: ts, plannedRuns: seg.runs, slitterId: slotPlan ? key : undefined, occMin: occMin, setupMin: setupWhole, planCols: planCols });
                } else {
                    var head = String(seg.parentCutId);
                    var k = (contIndexByHead[head] = (contIndexByHead[head] || 0) + 1);
                    var chain = chainByLogical[head] || [head];
                    var reuseId = chain[k];   // chain[0]=голова, chain[1..]=записи-продолжения
                    if (reuseId != null) {
                        usedByHead[head] = k + 1;
                        updates.push({ cutId: String(reuseId), sequence: idx + 1, planStartTs: ts, plannedRuns: seg.runs, slitterId: slotPlan ? key : undefined, occMin: occMin, setupMin: setupWhole, planCols: planCols });
                    } else {
                        creates.push({ parentCutId: head, sequence: idx + 1, planStartTs: ts, plannedRuns: seg.runs, slitterId: slotPlan ? key : undefined, occMin: occMin, setupMin: setupWhole, planCols: planCols });
                    }
                }
                // #3892: «ID первой части» (голова цепочки) НЕ кладём в ops — applySplitPlan
                // выводит её из chainHeadById (для update) / parentCutId (для create), чтобы не
                // менять контракт planCutOperations (строгие сравнения ops в тестах #3280/#3427).
            });
        });
        // Лишние записи цепочки (сегментов стало меньше, чем записей) — на удаление. Цепочки
        // станков, которые мы НЕ раскладывали (usedByHead нет), не трогаем — данные не теряем.
        Object.keys(chainByLogical).forEach(function(head){
            var chain = chainByLogical[head];
            var used = usedByHead[head];
            if (used == null) return;
            for (var k = used; k < chain.length; k++) deletes.push(String(chain[k]));
        });
        // #3924: осиротевшие setup-сегменты (0 проходов) — на удаление (собраны выше при отсеве
        // из merged.cuts). Дедуп на случай пересечения с delete-путём цепочек.
        orphanDeletes.forEach(function(id){ if (deletes.indexOf(id) < 0) deletes.push(id); });
        // #4200: overdue — задания, ОСТАВШИЕСЯ за сроком по календарю после рескью #4118 (для громкого
        // отчёта в контроллере: console.error + тост, не молча). Пусто → плана без просрочки (гарантия).
        // #4462: placement — разбор выбора места (варианты, выбранное, две ближайшие альтернативы,
        // кто переносил после §8). Наружу нужен для подсказки карточки очереди: раньше он существовал
        // только строками в консоли, и «почему этот слот победил» приходилось искать в трейсе.
        // #4467: dayLoad — занятость станко-дня из самой раскладки (для стража DAY_CAPACITY).
        // #4469: dayFill — станко-дни, которые раскладка оставила недоупакованными (страж DAY_FILL).
        return { updates: updates, creates: creates, deletes: deletes, overdue: overdueResidual,
                 placement: slotPlan ? (slotPlan.trace || null) : null, dayLoad: dayLoad, dayFill: dayFill };
    }

    // #3280: разделить рулоны/метраж одной строки Обеспечения между сегментами резки
    // ПРОПОРЦИОНАЛЬНО проходам. Рулоны — целые, сумма долей = исходным рулонам
    // (остаток по наибольшей дробной части). Метраж — дробно, последняя доля = остаток.
    //   rolls, footage — исходные; runs — массив проходов по сегментам (сегмент 0 = «сегодня»).
    // → [{ rolls, footage }] длиной runs.length. runs пуст/сумма 0 → всё в сегмент 0.
    // #4536: rolls === null («не знаем» — отчёт колонку не отдаёт) делится в null у ВСЕХ долей:
    // делить неизвестное нельзя, а ноль — это утверждение «заказу не достанется ничего», и оно
    // уезжало в базу поверх реального количества. Метраж при этом делится как прежде.
    function splitSupplyShares(rolls, footage, runs){
        var r = (runs || []).map(function(x){ return Number(x) || 0; });
        var n = r.length;
        var unknownRolls = (rolls === null || rolls === undefined || rolls === '');
        var R = unknownRolls ? null : Math.round(Number(rolls) || 0);
        var F = Number(footage) || 0;
        if (n === 0) return [];
        var total = r.reduce(function(s, x){ return s + x; }, 0);
        var out = [];
        if (!(total > 0)) {
            for (var z = 0; z < n; z++) {
                out.push({ rolls: unknownRolls ? null : (z === 0 ? R : 0), footage: z === 0 ? round3(F) : 0 });
            }
            return out;
        }
        if (unknownRolls) {
            // Количество неизвестно — считаем только метраж, доли рулонов остаются «не знаем».
            var fAcc0 = 0, lastKnown = -1;
            for (var q = 0; q < n; q++) if (r[q] > 0) lastKnown = q;
            for (var w = 0; w < n; w++) {
                var fw;
                if (r[w] <= 0) fw = 0;
                else if (w === lastKnown) fw = round3(F - fAcc0);
                else { fw = round3(F * r[w] / total); fAcc0 += fw; }
                out.push({ rolls: null, footage: fw });
            }
            return out;
        }
        // Рулоны: floor + раздача остатка по наибольшей дробной части.
        var base = [], rem = [], used = 0;
        for (var i = 0; i < n; i++) {
            var exact = R * r[i] / total;
            var fl = Math.floor(exact);
            base.push(fl); rem.push({ idx: i, frac: exact - fl }); used += fl;
        }
        var left = R - used;
        rem.sort(function(a, b){ return b.frac - a.frac; });
        for (var k = 0; k < left; k++) base[rem[k % n].idx] += 1;
        // Метраж: пропорционально, последняя ненулевая доля добирает остаток (точная сумма).
        var fAcc = 0, lastIdx = -1;
        for (var j = 0; j < n; j++) if (r[j] > 0) lastIdx = j;
        for (var m2 = 0; m2 < n; m2++) {
            var fv;
            if (r[m2] <= 0) fv = 0;
            else if (m2 === lastIdx) fv = round3(F - fAcc);
            else { fv = round3(F * r[m2] / total); fAcc += fv; }
            out.push({ rolls: base[m2], footage: fv });
        }
        return out;
    }

    // Минуты от полуночи → «ЧЧ:ММ» (с «+Nд», если перевалило за сутки). Терпимо к числам.
    function formatClock(min){
        var m = Math.round(Number(min) || 0);
        var hm = ((m % 1440) + 1440) % 1440;
        var h = Math.floor(hm / 60), mm = hm % 60;
        return (h < 10 ? '0' : '') + h + ':' + (mm < 10 ? '0' : '') + mm;
    }

    // #3280: на карточке (.atex-pp-cut-num) показываем то же время, что и начало
    // окна в .atex-pp-cut-time — первый шаг тайминга (startMin − setupMin), ЧЧ:ММ.
    function cutStartWindowMin(sc) {
        return stripNum(sc && sc.startMin) - stripNum(sc && sc.setupMin);
    }
    // #3280: title карточки — плановая дата+время старта до минут. baseMidnightMs —
    // полночь дня планирования (день 0 расписания); сегмент сдвинут на windowStartMin.
    function formatCutStartTitle(sc, baseMidnightMs) {
        if (!sc) return '';
        return formatCutNumber(scheduleStartTimestamp(baseMidnightMs, cutStartWindowMin(sc)));
    }

    // Свободное окно для опции станка / превью: «дата ЧЧ:ММ (старт–финиш)».
    function formatFreeSlot(slot) {
        if (!slot) return 'нет данных';
        return formatCutNumber(slot.startTs) + ' (' + formatClock(slot.startMin) + '–' + formatClock(slot.finishMin) + ')';
    }

    function formatScheduleLine(sc, runLength, hasWindingPoints, shiftMin, extendMin) {
        if (!sc) return '';
        var dur = stripNum(sc.durationMin);
        if (dur <= 0) {
            if (stripNum(runLength) <= 0) return '⏱ ошибка: нет метража прохода; длительность не рассчитана';
            if (!hasWindingPoints) return '⏱ ошибка: нет норм WIND_*; длительность не рассчитана';
            return '⏱ ошибка: длительность 0 мин; проверьте проходы и нормы намотки';
        }
        // #3262: показываем всё ОКНО (setup + резка + лидер), как «Тайминг окна» в модалке —
        // старт = начало setup (startMin − setupMin), длительность = setup + резка + лидер
        // (диапазон совпадает с числом минут, как у блока уборки). Так начало в карточке
        // равно первому шагу тайминга окна, а не старту самой резки.
        // #3688: лидер заправляют В КОНЦЕ резки — он входит в окно станка (после намотки).
        var setup = stripNum(sc.setupMin);
        var leaderMin = stripNum(sc.leaderMin);
        // #4075: сдвиг окна на суммарную длительность перерывов, попавших ДО этой карточки в дне
        // (перерывы не зашиты в planStart — показываем их как визуальный сдвиг, как накладки Ганта).
        var shift = Number(shiftMin) || 0;
        // #4094: карточка НЕСЁТ обед/перерыв → её КОНЕЦ окна удлиняется на его длительность (окно честно
        // охватывает работу + перерыв, как бар Ганта). Расширяем ТОЛЬКО конец (старт не трогаем); число
        // минут «· N мин» остаётся РАБОЧИМ (setup+резка+лидер), как «(N мин)» в скобках у бара Ганта.
        var extend = Number(extendMin) || 0;
        var windowStart = stripNum(sc.startMin) - setup + shift;
        var windowEnd = stripNum(sc.finishMin) + leaderMin + shift + extend;
        // #3635 п.4: минуты окна показываем ЦЕЛЫМ числом, округляя ВВЕРХ (36.264 → 37). #4094: при
        // несомом перерыве диапазон времени длиннее числа минут (диапазон = стенные часы с перерывом,
        // минуты = чистая работа) — как у Ганта «08:00-12:40 (240 мин)».
        return '⏱ ' + formatClock(windowStart) + ' – ' + formatClock(windowEnd) + ' · ' + Math.ceil(setup + dur + leaderMin) + ' мин';
    }

    // #4121: строка времени карточки НАСТРОЙКИ (setup-only, #3635 п.5 — 0 проходов, намотка с дня
    // N+1). У неё нет длительности резки, поэтому formatScheduleLine отдал бы «ошибку длительности»,
    // и карточка показывала только «· N мин» — когда настройка начинается и кончается, было не
    // видно. Показываем то же ОКНО, что и у обычной карточки: [startMin − setupMin; finishMin],
    // с теми же сдвигом и удлинением от обеда/перерывов (#4075/#4094/#4121). Чистая — покрыта тестом.
    function formatSetupScheduleLine(sc, shiftMin, extendMin) {
        if (!sc) return '';
        var setup = stripNum(sc.setupMin);
        var shift = Number(shiftMin) || 0;
        var extend = Number(extendMin) || 0;
        var windowStart = stripNum(sc.startMin) - setup + shift;
        var windowEnd = stripNum(sc.finishMin) + stripNum(sc.leaderMin) + shift + extend;
        return '⚙ Настройка ножей и сырья · ' + formatClock(windowStart) + ' – ' + formatClock(windowEnd) +
               ' · ' + Math.ceil(setup) + ' мин';
    }

    // Допуск остатка джамбо (мм): если задан (непустая строка) — берём его (терпимо
    // к запятой), иначе дефолт. «0» считается заданным значением. #3120 + ideav/crm#3127.
    function resolveTolerance(rawValue, defaultMm) {
        var s = String(rawValue == null ? '' : rawValue).trim();
        if (s === '') return Number(defaultMm) || 0;
        var n = Number(s.replace(',', '.'));
        return isFinite(n) ? n : (Number(defaultMm) || 0);
    }

    // Занятая полосами ширина — Σ(ширина × количество).
    function stripsUsedWidth(strips) {
        return round3((strips || []).reduce(function(sum, s) {
            return sum + stripNum(s.width) * stripNum(s.qty);
        }, 0));
    }

    // «Итого ножей» — сумма всех количеств полос (Σ qty).
    function stripsTotalKnives(strips) {
        return (strips || []).reduce(function(sum, s) { return sum + stripNum(s.qty); }, 0);
    }

    function knifeWidthsForStrips(strips) {
        var out = [];
        (strips || []).forEach(function(s) {
            var width = stripNum(s.width);
            var qty = Math.max(0, Math.floor(stripNum(s.qty)));
            for (var i = 0; i < qty; i++) out.push(width);
        });
        return out;
    }

    // «Остаток, мм» — ширина джамбо минус занятая полосами ширина.
    function stripsRemainder(jumboWidth, strips) {
        return round3(stripNum(jumboWidth) - stripsUsedWidth(strips));
    }

    // #3706: статус остатка джамбо резки относительно допуска — для подсветки кнопки
    // «Полосы» в очереди (та же логика, что у бейджа «вне допуска» в панели полос).
    //   jumboWidth  — «Ширина, мм» сырья (факт. ширина джамбо);
    //   knifeWidths — факт.ширины полос резки, развёрнутые по qty (cut.knifeWidths);
    //   tolerance   — допуск остатка (мм) вида сырья.
    // → 'warn' (|остаток| > допуска), 'ok' (в допуске), 'unknown' (джамбо не задан —
    //   не сигналим ложный негатив, #3116 п.5).
    function cutRemainderStatus(jumboWidth, knifeWidths, tolerance) {
        var jumbo = stripNum(jumboWidth);
        if (!(jumbo > 0)) return 'unknown';
        var used = (knifeWidths || []).reduce(function(sum, w) {
            var n = stripNum(w);
            return sum + (n > 0 ? n : 0);
        }, 0);
        var rem = round3(jumbo - used);
        return Math.abs(rem) <= Math.abs(stripNum(tolerance)) ? 'ok' : 'warn';
    }

    // Подпись кнопки «Полосы» в строке резки: показывает количество полос резки
    // (Σ qty = knifeCount). При нуле/некорректном значении — без числа (#3147).
    function stripsButtonLabel(knifeCount) {
        var n = Number(knifeCount);
        return (isFinite(n) && n > 0) ? ('Полосы (' + n + ')') : 'Полосы';
    }

    // ── #3354: компактная шапка карточки и сводка полос ──────────────────────
    // Метраж прохода для показа: фактический runLength (учёт обеспечения), а при
    // его отсутствии — сохранённый «Метраж, м» резки.
    function cutDisplayLength(cut, runLength) {
        var len = stripNum(runLength);
        if (len <= 0) len = stripNum(cut && cut.length);
        return len;
    }

    // Хвост первой строки карточки: «{длина} х {количество резок}» (#3354 п.1).
    // Разделитель — кириллическая «х», как в постановке задачи.
    function formatCutDimensions(cut, runLength) {
        var len = cutDisplayLength(cut, runLength);
        var runs = stripNum(cut && cut.plannedRuns);
        var lenText = len > 0 ? String(round3(len)) : '—';
        var runsText = runs > 0 ? String(round3(runs)) : '—';
        return lenText + ' х ' + runsText;
    }

    // Полосы резки, сгруппированные по ширине → [{ width, count }] (#3354 п.1).
    // Источник — knifeWidths (развёрнут по qty из cut_strips «Партия ГП»); count —
    // «кол-во полос» этой ширины. Сортировка по ширине убыв., как в раскладке.
    function cutStripGroups(cut) {
        var byKey = {}, order = [];
        ((cut && cut.knifeWidths) || []).forEach(function(wRaw) {
            var w = stripNum(wRaw);
            if (!(w > 0)) return;
            var key = stripWidthKey(w);
            if (!byKey[key]) { byKey[key] = { width: w, count: 0 }; order.push(key); }
            byKey[key].count += 1;
        });
        return order.map(function(k) { return byKey[k]; })
            .sort(function(a, b) { return b.width - a.width; });
    }

    // Сводная строка полосы данной ширины (#3354 п.1), формат из постановки:
    // «{сырьё} {ширина} x {длина} {намотка} — {факт.ширина}мм х {резок} x {полос} = {мотков} шт.»
    // actualWidth — фактическая ширина резки (#3372; при отсутствии правила = номинал);
    // мотков = резок × полос. Чистая (DOM не трогает) → проверяется модульно.
    function formatStripSummaryLine(cut, group, actualWidth, runLength) {
        var material = (cut && cut.materialName) || (cut && cut.materialId != null && String(cut.materialId) !== '' ? '#' + cut.materialId : '—');
        var width = stripNum(group && group.width);
        var count = Math.max(0, Math.floor(stripNum(group && group.count)));
        var len = cutDisplayLength(cut, runLength);
        var winding = normWinding(cut && cut.winding) || String((cut && cut.winding) == null ? '' : cut.winding).trim();
        var runs = stripNum(cut && cut.plannedRuns);
        var actual = stripNum(actualWidth);
        if (!(actual > 0)) actual = width;
        var rolls = round3((runs > 0 ? runs : 0) * count);
        var line = material + ' ' + round3(width) + ' x ' + (len > 0 ? round3(len) : '—');
        if (winding) line += ' ' + winding;
        // «х» между мм и резками — кириллическая; «x» между резками и полосами — латинская.
        line += ' — ' + round3(actual) + 'мм х ' + (runs > 0 ? round3(runs) : '—') +
                ' x ' + count + ' = ' + rolls + ' шт.';
        return line;
    }

    function supplyCoverageKind(supply) {
        if (!supply || supply.positionId == null || String(supply.positionId) === '') return '';
        if (supply.cutId != null && String(supply.cutId) !== '') return 'cut';
        if (supply.finishedBatchId != null && String(supply.finishedBatchId) !== '') return 'finishedBatch';
        if (supply.finishedBatch && supply.finishedBatch.id != null && String(supply.finishedBatch.id) !== '') return 'finishedBatch';
        return '';
    }

    // Позиции, не обеспеченные ни резкой, ни складской партией ГП.
    function uncoveredPositions(positions, supplies){
        var covered = {};
        (supplies || []).forEach(function(s) {
            var kind = supplyCoverageKind(s);
            if (kind) covered[String(s.positionId)] = true;
        });
        return (positions || []).filter(function(p){ return !covered[String(p.id)]; });
    }

    // FIFO-партия: среди активных партий нужного сырья с остатком > 0 выбрать с наименьшим dateKey.
    // batches — [{id, materialId, dateKey (число), remainder, active}]. null если нет подходящей.
    function pickBatchFIFO(batches, materialId){
        var mat = String(materialId == null ? '' : materialId).trim();
        var avail = (batches || []).filter(function(b){ return batchIsActive(b) && String(b.materialId) === mat && (Number(b.remainder) || 0) > 0; });
        if (!avail.length) return null;
        avail.sort(function(a, b){ return (Number(a.dateKey) || 0) - (Number(b.dateKey) || 0) || (String(a.id) < String(b.id) ? -1 : 1); });
        return String(avail[0].id);
    }

    function pickBatchFIFOForRun(batches, materialId, requiredLinearM, remainingByBatch) {
        var mat = String(materialId == null ? '' : materialId).trim();
        var avail = (batches || []).filter(function(b) {
            if (!batchIsActive(b) || String(b.materialId) !== mat || (Number(b.remainder) || 0) <= 0) return false;
            var id = String(b.id);
            if (remainingByBatch && remainingByBatch.hasOwnProperty(id)) {
                return (Number(remainingByBatch[id]) || 0) > 0;
            }
            return true;
        });
        if (!avail.length) return null;
        avail.sort(function(a, b){ return (Number(a.dateKey) || 0) - (Number(b.dateKey) || 0) || (String(a.id) < String(b.id) ? -1 : 1); });
        var picked = avail[0];
        var pickedId = String(picked.id);
        if (remainingByBatch && remainingByBatch.hasOwnProperty(pickedId)) {
            var free = Number(remainingByBatch[pickedId]) || 0;
            var need = Number(requiredLinearM) || 0;
            if (need > 0) remainingByBatch[pickedId] = Math.max(0, free - need);
        }
        return pickedId;
    }

    // #3120 группа C (Фаза 1a, п.4): у резки задан материал, но нет ни одной подходящей
    // партии сырья с остатком (pickBatchFIFO === null) → резку нельзя обеспечить сырьём.
    // Резки без материала (materialId пуст) не помечаем. genBatches — [{id,materialId,...,remainder}].
    function cutMissingBatch(cut, genBatches){
        var mat = cut && cut.materialId != null ? String(cut.materialId) : '';
        if (mat === '') return false;
        return pickBatchFIFO(genBatches || [], mat) === null;
    }

    // #4452 (ТЗ §15, инвариант CUT_BATCH): «Партия сырья» задания. Отчёт cut_planning её не
    // отдаёт (rowsToPlanning → batchId:''), она приходит отдельным чтением записи (#4155) — и у
    // заданий, которым её никто не проставил, остаётся пусто. Партия нужна как УЧЁТНЫЕ данные:
    // какой физический рулон режет задание (расход сырья, прослеживаемость) и тай-брейк «не
    // перемонтировать рулон» при равной цене порядка. Минут наладки она НЕ стои́т — подпись
    // заправки это вид сырья и намотка (materialSetupSig, #4481).
    //
    // Лечим В ПАМЯТИ (как healContinuationMaterials лечит «Вид сырья») ДО расчёта плана — чтобы
    // план записал в базу разрешённую партию, а не пустоту. Порядок источников
    // — от достоверного к выводимому:
    //   1) цепочка дробления — сегменты режут ОДИН физический рулон, партия у них общая;
    //   2) «Расход сырья» (1079) — партия, которую задание реально списывает;
    //   3) FIFO активной партии этого «Вида сырья» с остатком — тот же выбор, что делает
    //      генерация (pickBatchFIFO), т.е. решение планировщика, а не выдумка.
    // Ничего не нашлось — НЕ подставляем (crm no-silent-fallback): задание уходит в unresolved с
    // причиной, вызывающий орёт в консоль и тостом.
    //
    // cuts мутируются: c.batchId (значение) и c.batchHealedFrom (источник, для трассы).
    // opts: { chainHeadById: {cutId: headId}, consumptionByCut: {cutId:[{batchId}]}, genBatches }.
    // → { healed: [{cutId, batchId, source}], unresolved: [{cutId, materialId, reason}] }
    function healCutBatches(cuts, opts) {
        var o = opts || {};
        var list = cuts || [];
        var byId = {};
        list.forEach(function(c) { if (c && c.id != null) byId[String(c.id)] = c; });
        var headById = o.chainHeadById || {};
        var membersByHead = {};
        Object.keys(headById).forEach(function(id) {
            var h = String(headById[id]);
            (membersByHead[h] = membersByHead[h] || []).push(String(id));
        });
        function stored(c) { return (c && c.batchId != null) ? String(c.batchId).trim() : ''; }
        // Снимок ХРАНИМОГО значения ДО лечения: дальше c.batchId — уже вылеченное, и без снимка
        // запись плана решила бы «не изменилось» и оставила базу пустой (та же ловушка, что у
        // «Вида сырья» в #4001: origMaterialById).
        list.forEach(function(c) { if (c && c.id != null) c.batchIdStored = stored(c); });
        var healed = [], unresolved = [];
        list.forEach(function(c) {
            if (!c || c.id == null || stored(c) !== '') return;
            var id = String(c.id);
            var batch = '', source = '';
            // 1) любой сегмент цепочки дробления (голова первой — она источник истины #4155).
            var head = headById[id] != null ? String(headById[id]) : id;
            var chain = [head].concat(membersByHead[head] || []);
            for (var i = 0; i < chain.length && batch === ''; i++) {
                var sb = stored(byId[chain[i]]);
                if (sb !== '') { batch = sb; source = 'chain'; }
            }
            // 2) «Расход сырья»: что задание списывает — то оно и режет.
            if (batch === '') {
                var cons = (o.consumptionByCut || {})[id] || [];
                for (var j = 0; j < cons.length && batch === ''; j++) {
                    var cb = (cons[j] && cons[j].batchId != null) ? String(cons[j].batchId).trim() : '';
                    if (cb !== '') { batch = cb; source = 'consumption'; }
                }
            }
            // 3) FIFO активной партии своего сырья с остатком — выбор генерации.
            var mat = (c.materialId != null) ? String(c.materialId).trim() : '';
            if (batch === '' && mat !== '') {
                var fifo = pickBatchFIFO(o.genBatches || [], mat);
                if (fifo) { batch = String(fifo); source = 'fifo'; }
            }
            if (batch === '') {
                unresolved.push({ cutId: id, materialId: mat, reason: mat === ''
                    ? 'у задания нет «Вида сырья» — партию выводить не из чего'
                    : 'нет активной «Партии сырья» вида ' + mat + ' с остатком; цепочка дробления и «Расход сырья» пусты' });
                return;
            }
            c.batchId = batch;
            c.batchHealedFrom = source;
            healed.push({ cutId: id, batchId: batch, source: source });
        });
        return { healed: healed, unresolved: unresolved };
    }

    function supplyFootage(supply, footageBySupply){
        var direct = stripNum(supply && supply.footage);
        if (direct > 0) return direct;
        return stripNum(footageBySupply && supply && footageBySupply[String(supply.id)]);
    }

    // #4301: длина прогона (намотки) резки = «Длина, м» обеспечиваемой позиции ЗАКАЗА — величина,
    // ЗАДАННАЯ ЗАКАЗОМ и НЕИЗМЕННАЯ. НЕ выводим её из «Метраж, м» обеспечения (footage): дробление/
    // склейка заданий искажали метраж (на ateh — 600→1200→2400), а cutRunLength возвращал искажение,
    // и оно записывалось ОБРАТНО в «Метраж, м» резки (runLenForCutId → _m_set при разбиении) — длина
    // «пересчитывалась» и удваивалась на каждой пересборке (issue #4301: «нельзя пересчитывать длину
    // НИКОГДА»). Берём МАКС «Длина, м» покрытых позиций (как layoutRunLength при генерации: параллельный
    // слиттинг — все полосы за один прогон, самая длинная позиция задаёт длину прогона). positionLengths —
    // карта { positionId: «Длина, м» } (positionLengthMap(genPositions)). Позиция не резолвится (сток/
    // сирота #4175 вне positions_list) → сохранённая «Длина, м» резки как есть (восстанавливать неоткуда),
    // но НИКОГДА из метража обеспечения. Так длина берётся из заказа и не «плывёт» при дроблении/склейке.
    function cutRunLength(cut, supplies, positionLengths){
        var posLen = positionLengths || {};
        var maxP = 0;
        (supplies || []).forEach(function(s) {
            if (String(s && s.cutId) !== String(cut && cut.id)) return;
            var len = Number(posLen[String(s && s.positionId)]) || 0;
            if (len > maxP) maxP = len;
        });
        if (maxP > 0) return round3(maxP);       // длина позиции заказа — источник истины
        return stripNum(cut && cut.length);      // нет позиции — сохранённая длина резки (не из метража)
    }

    // FIFO-резерв сырья из партий (#3120 группа C). batches — [{id, label, arrivalKey, freeLinearM}]
    // (freeLinearM — СВОБОДНЫЙ погонный остаток партии: Остаток,м − Σ чужих резервов); сортируются
    // внутри по приходу (arrivalKey ↑, тай-брейк меньший id). requiredLinearM — потребность, пог.м;
    // widthM — ширина джамбо, м (для справочного м²). Вход не мутируется.
    // → { allocations:[{batchId,label,linearM,m2}], reservedLinearM, shortfallLinearM, fullyReserved }.
    function reserveFifo(batches, requiredLinearM, widthM){
        var need = Math.max(0, Number(requiredLinearM) || 0);
        var w = Number(widthM) || 0;
        var sorted = (batches || []).slice().sort(function(a, b){
            return (Number(a.arrivalKey) || 0) - (Number(b.arrivalKey) || 0) ||
                   (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0);
        });
        var allocs = [], reserved = 0;
        for (var i = 0; i < sorted.length && need > 1e-9; i++){
            var free = Math.max(0, Number(sorted[i].freeLinearM) || 0);
            if (free <= 0) continue;
            var take = Math.min(free, need);
            allocs.push({ batchId: String(sorted[i].id), label: sorted[i].label || '', linearM: round3(take), m2: round3(take * w) });
            reserved += take; need -= take;
        }
        return {
            allocations: allocs,
            reservedLinearM: round3(reserved),
            shortfallLinearM: round3(Math.max(0, need)),
            fullyReserved: need <= 1e-9
        };
    }

    // Кандидаты-партии для FIFO-резерва вида сырья (Фаза 1b): из genBatches берём партии
    // нужного материала со СВОБОДНЫМ погонным остатком = Остаток,м − (зарезервировано м² по
    // партии / ширина джамбо в м). reservedM2ByBatch — карта чужих резервов «Расход сырья».
    // → [{id,label,arrivalKey,freeLinearM}] для reserveFifo. Вход не мутирует.
    function fifoBatchesForMaterial(genBatches, reservedM2ByBatch, materialId, widthM){
        var mat = String(materialId == null ? '' : materialId);
        var w = Number(widthM) || 0;
        var res = reservedM2ByBatch || {};
        return (genBatches || []).filter(function(b){ return batchIsActive(b) && String(b.materialId) === mat; }).map(function(b){
            var reservedLin = w > 0 ? ((Number(res[String(b.id)]) || 0) / w) : 0;
            var free = (Number(b.remainderLinear) || 0) - reservedLin;
            return { id: String(b.id), label: b.label || '', arrivalKey: Number(b.dateKey) || 0, freeLinearM: free > 0 ? round3(free) : 0 };
        });
    }

    // Материал резки из обеспечиваемых позиций (#3120 Фаза 2): cutId → вид сырья (id) её
    // позиций (все позиции резки — один вид сырья; берём первый непустой). Демэнд-источник
    // материала вместо ссылки «Партия сырья» (1159). genPositions — [{id, materialId}];
    // supplies — [{cutId, positionId}]. → { cutId: materialId }.
    function materialByCut(cuts, supplies, genPositions){
        var posMat = {};
        (genPositions || []).forEach(function(p){ posMat[String(p.id)] = String(p.materialId == null ? '' : p.materialId); });
        var out = {};
        (supplies || []).forEach(function(s){
            if (s == null || s.positionId == null) return;
            var cutId = String(s.cutId), m = posMat[String(s.positionId)] || '';
            if (m && !out[cutId]) out[cutId] = m;
        });
        return out;
    }

    // #3808: восстановить «Вид сырья» переходящих сегментов с ПУСТЫМ материалом. Сегмент-
    // продолжение дробления по дням физически тот же, что и голова цепочки (станок|намотка|
    // набор ножей) — отличается только днём. `continuationSignature` ВКЛЮЧАЕТ materialId,
    // поэтому пустой материал продолжения не давал ему слиться с головой в
    // `mergeContinuationChains` → `materialForCutId` (#3795) не находил голову и не лечил его:
    // переходящее задание оставалось без сырья («—»). Группируем материал-АГНОСТИЧНО
    // (станок|намотка|набор ножей — это `continuationSignature` без materialId) и, если в
    // группе ровно одно непустое сырьё, проставляем его сегментам с пустым. Неоднозначные
    // группы (несколько разных сырьёв) не трогаем — лечим только безопасные случаи. Мутирует
    // `c.materialId`; → массив id вылеченных резок. Чистая (тест).
    function healContinuationMaterials(cuts){
        var groups = {};
        (cuts || []).forEach(function(c){
            var ks = ((c && c.knifeWidths) || []).slice().map(Number).sort(function(a, b){ return a - b; }).join(',');
            var key = [
                (c && c.slitter && c.slitter.id) == null ? '' : String(c.slitter.id),
                normWinding(c && c.winding),
                ks
            ].join('|');
            (groups[key] = groups[key] || []).push(c);
        });
        var healed = [];
        Object.keys(groups).forEach(function(key){
            var arr = groups[key];
            var mats = {};
            arr.forEach(function(c){
                var m = c && c.materialId != null ? String(c.materialId).trim() : '';
                if (m) mats[m] = true;
            });
            var distinct = Object.keys(mats);
            if (distinct.length !== 1) return;   // нет источника / неоднозначно — не трогаем
            var mat = distinct[0];
            arr.forEach(function(c){
                var m = c && c.materialId != null ? String(c.materialId).trim() : '';
                if (m === '') { c.materialId = mat; healed.push(String(c.id)); }
            });
        });
        return healed;
    }

    // #3785: при равной стоимости перехода тай-брейк — число полос (ножей) ПО УБЫВАНИЮ
    // («при прочих равных» больше полос — раньше), затем уже ширина ролика и id.
    function startKey(c){ return [-(Number(c.knifeCount) || 0), Number(c.rollerWidth) || 0, String(c.id)]; }
    function cmpKey(a, b){ for (var i = 0; i < a.length; i++){ if (a[i] < b[i]) return -1; if (a[i] > b[i]) return 1; } return 0; }

    function fatigueComplexityKey(c, machineWidth){
        var width = fatigueJobWidth(c);
        return [
            -estimatedKnifeCount(c, machineWidth),
            width > 0 ? width : Number.MAX_VALUE
        ];
    }

    // #3996: стоимость перехода prev→next для ВЫБОРА ПОРЯДКА (не для тайминга). Физические
    // минуты переналадки (changeoverCost) считают смену ножей плоско — 30 мин в любую сторону
    // (#3600) — и это верно для реальной «Наладка ножей, мин» в задании. Но при УПОРЯДОЧИВАНИИ
    // доставить ножи (полос стало БОЛЬШЕ) дороже, чем снять (ТЗ §8 п.1: KNIVES_INCREASE=50 >
    // KNIVES_CHANGE=30). Добавляем к физической стоимости направленный штраф за РОСТ числа полос
    // = planWeight(INCREASE) — ДОПОЛНИТЕЛЬНАЯ доплата сверх базовой смены ножей, а не замена её цены
    // (веса #3991, ТЗ §14; #4434 п.5). Так убывание полос
    // становится СТРОГО дешевле возрастания, а не только тай-брейком (#3130): жадная цепочка сама
    // ставит наборы по убыванию, и это не сбивается разницей по сырью/партии. Физтайминг
    // (changeoverParts/setupBreakdown) не трогаем — реальные минуты наладки прежние.
    // #4434 п.5: settings — объект «Настройки» (веса ТЗ §14). Раньше здесь стояло planWeight(null, …),
    // то есть направленный штраф ВСЕГДА брался из дефолтов кода (50−30=20), а значение
    // KNIVES_INCREASE_COST_MN из таблицы «Настройка» не применялось НИКОГДА — «система штрафов не
    // работает» ровно в том месте, которое отвечает за порядок ножей по убыванию. Теперь вес читается
    // из настроек. Фолбэк на `weights` не случаен: orderCuts/greedySequence передают сюда planOptions,
    // где веса «Настройки» лежат ПЛОСКО (makePlanningOptions), — там источник и без явного аргумента.
    function sequencingCost(prev, next, weights, settings){
        var base = changeoverCost(prev, next, weights);
        var wsrc = settings || weights;
        // #3871: во время выравнивания загрузки считаем только быстрый memoized changeoverCost —
        // направленный штраф (не memoized: knifeChangeNeeded/stripBandCount на каждую пробу переноса)
        // раздувал O(n³) проход rebalanceSlitterLoad. Для баланса важны дни/минуты, а не направление
        // ножей; финальный порядок всё равно соберёт orderCuts (balanceFastChangeover=false).
        if (!balanceFastChangeover && knifeChangeNeeded(prev, next) && stripBandCount(next) > stripBandCount(prev)) {
            base += planWeight(wsrc, 'KNIVES_INCREASE_COST_MN');
        }
        // #4151: крошечный тай-брейк — смена РУЛОНА (материал/партия) чуть дороже смены намотки, чтобы
        // при равной реальной переналадке резки одного рулона держались вместе (не рвались чужим
        // материалом). Активен только в resequenceWithinDays (флаг), где приёмка не даёт вырасти
        // реальным минутам. round3 сохраняет 3 знака — штраф переживает округление.
        if (sequencingRollTiebreak && isRollRemount(prev, next)) base += ROLL_TIEBREAK_MN;
        return round3(base);
    }
    // Жадная цепочка от заданного старта: далее argmin sequencingCost, tie-break startKey.
    function greedyFromStart(start, rest, weights, settings){
        var pool = (rest || []).slice();
        var result = [start];
        while (pool.length){
            var cur = result[result.length - 1], bestI = 0, bestCost = Infinity, bestKey = null;
            for (var i = 0; i < pool.length; i++){
                var c = sequencingCost(cur, pool[i], weights, settings), k = startKey(pool[i]);
                if (c < bestCost || (c === bestCost && cmpKey(k, bestKey) < 0)){ bestCost = c; bestI = i; bestKey = k; }
            }
            result.push(pool.splice(bestI, 1)[0]);
        }
        return result;
    }
    // Суммарная стоимость упорядочивания цепочки (Σ sequencingCost соседей, #3996: с направленным
    // штрафом за рост числа полос).
    function chainChangeoverCost(seq, weights){
        var total = 0;
        for (var i = 1; i < (seq || []).length; i++) total += sequencingCost(seq[i - 1], seq[i], weights);
        return round3(total);
    }
    // Ряд числа ножей по порядку — критерий «ножи по убыванию» (#3130). Среди равных по
    // стоимости цепочек предпочитаем ту, чей ряд knifeCount лексикографически больше
    // (много ножей раньше). Возвращает <0, если ряд a предпочтительнее ряда b.
    function knifeDescSeq(seq){ return (seq || []).map(function(c){ return Number(c && c.knifeCount) || 0; }); }
    function cmpKnifeDescSeq(a, b){
        var n = Math.max(a.length, b.length);
        for (var i = 0; i < n; i++){ var av = a[i] || 0, bv = b[i] || 0; if (av !== bv) return bv - av; }
        return 0;
    }
    // Лимит полного перебора стартов: при больших очередях остаёмся на одиночном старте
    // (argmin startKey), чтобы не уходить в O(n³). На станко-день очередь маленькая.
    var GREEDY_MULTISTART_LIMIT = 60;
    // Жадная последовательность. Раньше старт жёстко брался argmin startKey (узкий
    // ролик), из-за чего setup-оптимальная цепочка могла идти по ВОЗРАСТАНИЮ ножей
    // (6,16,16) вопреки правилу #3130 «много ножей в начале смены» (ideav/crm#3412).
    // Теперь перебираем все старты, берём минимум суммарной переналадки (#3268), а
    // среди равных по стоимости — цепочку с ножами по убыванию.
    function greedySequence(cuts, weights){
        var pool = (cuts || []).slice();
        if (pool.length <= 1) return pool;
        pool.sort(function(a, b){ return cmpKey(startKey(a), startKey(b)); });
        // #3871: при выравнивании загрузки — цепочка от одного старта (перебор стартов даёт
        // O(n³) и делал «Создать» очень медленным); как и при больших очередях (>limit).
        if (pool.length > GREEDY_MULTISTART_LIMIT || balanceFastChangeover) return greedyFromStart(pool[0], pool.slice(1), weights);
        var best = null, bestCost = Infinity, bestKnife = null;
        for (var s = 0; s < pool.length; s++){
            var seq = greedyFromStart(pool[s], pool.slice(0, s).concat(pool.slice(s + 1)), weights);
            var cost = chainChangeoverCost(seq, weights), knife = knifeDescSeq(seq);
            if (best === null || cost < bestCost || (cost === bestCost && cmpKnifeDescSeq(knife, bestKnife) < 0)){
                best = seq; bestCost = cost; bestKnife = knife;
            }
        }
        return best;
    }
    // #3272: второй вариант очереди учитывает усталость к концу дня. Жадная цепочка
    // по переналадкам остаётся стабильной базой, но внутри неё более сложные резки
    // (много ножей / узкая ширина) ставятся раньше, если weighted score не хуже.
    function fatigueAwareSequence(cuts, options){
        var input = (cuts || []).slice();
        if (input.length <= 1) return input;
        var opts = options || {};
        var times = planningChangeTimes(opts);
        var machineWidth = fatigueOptionNumber(opts, ['machineWidth', 'machineWidthMm', 'Wmax'], FATIGUE_MACHINE_WIDTH_MM);
        var base = greedySequence(input, times);
        var complexFirst = base.map(function(c, i){ return { c: c, i: i, key: fatigueComplexityKey(c, machineWidth) }; })
            .sort(function(a, b){ return cmpKey(a.key, b.key) || (a.i - b.i); })
            .map(function(x){ return x.c; });
        var simpleFirst = complexFirst.slice().reverse();
        return fatigueRouteScore(complexFirst, opts) <= fatigueRouteScore(simpleFirst, opts)
            ? complexFirst : simpleFirst;
    }

    function sequenceForStrategy(cuts, options){
        var opts = options || {};
        if (planningStrategy(opts) === PLANNING_STRATEGY_FATIGUE) return fatigueAwareSequence(cuts, opts);
        // SETUP (#3783/#3785): ПЕРВИЧНО — минимум суммарной переналадки (greedySequence
        // группирует одно сырьё/набор ножей, переход внутри группы дешевле), поэтому сырьё
        // не идёт вперемешку (#3783). ТАЙ-БРЕЙК «при прочих равных» — число полос по убыванию
        // (#3785) — заложен в startKey жадной цепочки. Прежний враппер byKnifeCountDesc
        // (#3568) пересортировывал всю цепочку по knifeCount↓ ГЛОБАЛЬНО, разбивая группы
        // сырья и увеличивая переналадку — убран; «много ножей раньше» остаётся стратегией
        // FATIGUE (сложные раньше) для тех, кому важна усталость, а не минимум переналадок.
        return greedySequence(cuts, planningChangeTimes(opts));
    }

    // Упорядочить резки станка выбранной стратегией (#3272): по умолчанию (SETUP) — минимум
    // суммарной переналадки в реальных минутах (#3268), что группирует сырьё и наборы ножей
    // (#3783); fatigue-вариант ставит сложные резки раньше. Проставить sequence; вход не мутировать.
    //
    // РЕАЛЬНЫЙ порядок очереди станка при генерации строит слой размещения (#4085,
    // 15-slot-placement.js): splitMachineQueue читает slotPlan.orderIdxByCut, а orderCuts там —
    // запасной путь на случай SLOT_PLACEMENT=0. Прочие вызовы orderCuts — оценка стоимости
    // (orderedChangeoverCost, packMachine) и planQueues/planStartTimestamps.
    //
    // Порядок целиком по стратегии: ни «Срок изготовления» (c.dueKey — только цвет строки,
    // dueColorClass), ни фольга на него не влияют. Срок и «фольга в конец дня» (#3717) — локальные
    // штрафы DEADLINE_COST_MN / FOIL_NOTEND_COST_MN слоя размещения.
    function orderCuts(cuts, weights){
        var opts = makePlanningOptions(weights);
        var seq = sequenceForStrategy((cuts || []).slice(), opts);
        return seq.map(function(c, i){
            var copy = {}; for (var k in c){ if (Object.prototype.hasOwnProperty.call(c, k)) copy[k] = c[k]; }
            copy.sequence = i + 1;
            return copy;
        });
    }

    function orderedChangeoverCost(cuts, weights) {
        var seq = orderCuts(cuts || [], weights);
        var times = planningChangeTimes(weights);
        var total = 0;
        for (var i = 1; i < seq.length; i++) total += changeoverCost(seq[i - 1], seq[i], times);
        return round3(total);
    }

    // ─── #4139: внутридневная пересортировка очереди станка ──────────────────────────────────
    // Слой размещения (#4085) вставляет резки по одной по минимуму штрафа вставки и НЕ чинит
    // собранный день. Одна и та же конфигурация попадает в день дважды, разорванная чужим сырьём
    // (Станок 1, 02.07: MW308/8 → MWR113L/8 → MW308/8). День каждой резки уже определён реальной
    // упаковкой, поэтому перестановка ВНУТРИ дня не двигает день и не меняет штрафы срока
    // (§8 п.4/5) — она только склеивает одинаковые конфигурации.

    // Подпись конфигурации: набор ножей (МУЛЬТИМНОЖЕСТВО, как effKnifeWidths) + ширина ролика
    // (её сужение — тоже смена ножей, changeoverParts) + подпись заправки (сырьё/намотка,
    // materialSetupSig — партия в неё не входит, #4481). Резки с одинаковой подписью стоят подряд
    // БЕСПЛАТНО (changeoverParts → []), поэтому в переборе они — один узел.
    function cutConfigSig(c){
        var w = effKnifeWidths(c).slice().sort();
        return w.join(',') + '|' + (Number(c && c.rollerWidth) || 0)
            + '|' + materialSetupSig(c);
    }
    // Σ стоимости цепочки, считая переход от prev (заправка станка / хвост прошлого дня).
    // costFn — sequencingCost (цель порядка, #3996) либо changeoverCost (реальные минуты наладки).
    function runChainCost(seq, prev, times, costFn, settings){
        var total = 0, cur = prev;
        for (var i = 0; i < seq.length; i++){
            if (cur) total += costFn(cur, seq[i], times, settings);   // #4434 п.5: веса «Настройки» — до sequencingCost
            cur = seq[i];
        }
        return round3(total);
    }
    // Держим ТОЧНЫЙ перебор (Held-Karp) в разумных рамках: на реальных планах РАЗНЫХ конфигураций в
    // дне ≤ 13. День шире — точного перебора не делаем, но день БОЛЬШЕ НЕ ОТМЕНЯЕТ пересортировку
    // остальных (#4434 п.5): для него берём жадную цепочку по sequencingCost (она и даёт ножи по
    // убыванию) и оставляем выбор между «как есть» и «жадно» общей ДП по цепочке дней.
    var RESEQ_MAX_NODES = 12;

    // Схлопнуть резки в ГРУППЫ по подписи, сохраняя исходный относительный порядок внутри группы.
    function groupBySig(cuts){
        var groups = [], byId = {};
        cuts.forEach(function(c){
            var sig = cutConfigSig(c);
            if (byId[sig] == null){ byId[sig] = groups.length; groups.push([]); }
            groups[byId[sig]].push(c);
        });
        return groups;
    }

    // Разложить день на группы и ограничения. → { groups, isFoil[], starts[], ends[] } | null.
    //   • фольга — после всей нефольги (#3717);
    //   • резка, переползающая на следующий день (день-сплит), обязана быть последней — иначе
    //     разрыв «настройка в хвосте дня N, резка с N+1» (#3635 п.5) уедет на другую резку.
    // #4434 п.5: maxNodes — потолок числа групп для ТОЧНОГО перебора; null снимает потолок
    // (день пойдёт по жадному кандидату, а не отменит пересортировку всей очереди станка).
    function dayGroups(run, spanningIds, maxNodes){
        var pinned = null, body = run.slice();
        // #4464 (ТЗ §15): в дне ДВА и более 🔒 — их взаимный порядок и соседство неприкосновенны.
        // #4497 (ТЗ §15): и ОДНОГО 🔒 достаточно — перед ней автоматика ничего не ставит, а
        // пересортировка дня именно это и делала бы: перестановка любого задания перед 🔒 сдвигает её
        // на своё время + длительность. Перебор порядка такого дня не ведём вовсе: единственный
        // кандидат — текущий порядок (его собрал упаковщик, уже соблюдая правило). Так проще и
        // честнее, чем учить ДП precedence-ограничениям: день с 🔒 оператор разложил руками.
        var fixedN = 0;
        for (var fi = 0; fi < body.length; fi++){ if (body[fi] && body[fi].fixed) fixedN++; }
        if (fixedN >= 1){
            return { groups: [body], isFoil: [body.some(function(c){ return !!(c && c.isFoil); })],
                     starts: [0], ends: [0], pinnedIdx: -1, monolith: true };
        }
        var lastCut = body[body.length - 1];
        if (spanningIds && spanningIds[String(lastCut.id)]) pinned = lastCut;
        var hasFoil = body.some(function(c){ return !!(c && c.isFoil); });
        if (pinned && hasFoil && !pinned.isFoil) return null;   // фольга не сможет стать последней

        var groups = groupBySig(body);
        var isFoil = groups.map(function(g){ return !!g[0].isFoil; });
        var pinnedIdx = -1;
        if (pinned){
            for (var i = 0; i < groups.length && pinnedIdx < 0; i++){
                if (groups[i].indexOf(pinned) >= 0) pinnedIdx = i;
            }
            // внутри группы подписи одинаковы → переставить закреплённую резку в конец бесплатно
            var g = groups[pinnedIdx];
            g.splice(g.indexOf(pinned), 1); g.push(pinned);
        }
        if (maxNodes != null && groups.length > maxNodes) return null;

        var idx = groups.map(function(_, i){ return i; });
        var plain = idx.filter(function(i){ return !isFoil[i]; });
        var foils = idx.filter(function(i){ return isFoil[i]; });
        var starts = plain.length ? plain : foils;
        var ends = pinnedIdx >= 0 ? [pinnedIdx] : (foils.length ? foils : idx);
        return { groups: groups, isFoil: isFoil, starts: starts, ends: ends, pinnedIdx: pinnedIdx };
    }

    // #4434 п.5: КАНДИДАТНАЯ таблица дня, который шире точного перебора (> RESEQ_MAX_NODES групп).
    // Раньше такой день возвращал null и ОТМЕНЯЛ пересортировку ВСЕЙ очереди станка — из-за одного
    // широкого дня остальные дни оставались как есть, и «ножи по убыванию» не появлялись нигде.
    // Теперь для него считаем два порядка: «как есть» и ЖАДНУЮ цепочку по sequencingCost (именно она
    // и выстраивает число полос по убыванию), а выбор между ними отдаём общей ДП по цепочке дней.
    // Ограничения соблюдены: вся нефольга раньше любой фольги (#3717), закреплённая переползающая
    // резка — последняя (#3635 п.5). → { cost:{s:{e:c}}, path:{s:{e:[gIdx…]}}, rep, starts, ends }.
    function dayCandidateTable(day, times, settings){
        var groups = day.groups, rep = groups.map(function(g){ return g[0]; });
        var pinnedIdx = day.pinnedIdx == null ? -1 : day.pinnedIdx;
        var idx = groups.map(function(_, i){ return i; });
        // Жадную цепочку начинаем с САМОЙ «широкой» группы (максимум полос): направленный штраф
        // (KNIVES_INCREASE > KNIVES_CHANGE) делает дальнейшее убывание дешевле возрастания, и цепочка
        // сама выстраивает ножи по убыванию (#3130/#3996). Старт «как в текущем порядке» этого не даёт:
        // начав с малого числа полос, вырасти всё равно придётся.
        function chainOf(pool){
            if (pool.length < 2) return pool.slice();
            var head = 0;
            for (var hi = 1; hi < pool.length; hi++){
                if (stripBandCount(rep[pool[hi]]) > stripBandCount(rep[pool[head]])) head = hi;
            }
            var rest = pool.slice(0, head).concat(pool.slice(head + 1)), out = [pool[head]];
            while (rest.length){
                var cur = rep[out[out.length - 1]], bestI = 0, bestC = Infinity;
                for (var i = 0; i < rest.length; i++){
                    var c = sequencingCost(cur, rep[rest[i]], times, settings);
                    // При РАВНОЙ цене берём группу с БОЛЬШИМ числом полос — иначе жадность выбирает
                    // первую попавшуюся (все «убывания» стоят одинаково) и ряд ножей скачет.
                    if (c < bestC || (c === bestC && stripBandCount(rep[rest[i]]) > stripBandCount(rep[rest[bestI]]))){ bestC = c; bestI = i; }
                }
                out.push(rest.splice(bestI, 1)[0]);
            }
            return out;
        }
        var free = idx.filter(function(i){ return i !== pinnedIdx; });
        var greedy = chainOf(free.filter(function(i){ return !day.isFoil[i]; }))
            .concat(chainOf(free.filter(function(i){ return day.isFoil[i]; })));
        if (pinnedIdx >= 0) greedy.push(pinnedIdx);
        var orders = [idx.slice()];
        if (greedy.length === idx.length && greedy.join(',') !== idx.join(',')) orders.push(greedy);
        var cost = {}, path = {}, starts = {}, ends = {};
        orders.forEach(function(order){
            var total = 0;
            for (var i = 1; i < order.length; i++) total += sequencingCost(rep[order[i - 1]], rep[order[i]], times, settings);
            var s0 = order[0], e0 = order[order.length - 1];
            if (!cost[s0]) { cost[s0] = {}; path[s0] = {}; }
            if (cost[s0][e0] == null || total < cost[s0][e0]){ cost[s0][e0] = round3(total); path[s0][e0] = order; }
            starts[s0] = 1; ends[e0] = 1;
        });
        return { cost: cost, path: path, rep: rep, repOut: groups.map(function(g){ return g[g.length - 1]; }),
                 starts: Object.keys(starts).map(Number), ends: Object.keys(ends).map(Number) };
    }

    // Точные минимумы гамильтоновых путей по группам дня (Held-Karp по подмножествам) для КАЖДОЙ
    // пары (начало, конец) из допустимых. Ограничение «вся нефольга раньше любой фольги» вшито в
    // переход. Стоимость — sequencingCost между представителями групп (внутри группы переходы
    // бесплатны: подпись одна). → { cost: {s:{e:c}}, path: {s:{e:[gIdx…]}} }.
    function dayPathTable(day, times, settings){
        var groups = day.groups, n = groups.length;
        var rep = groups.map(function(g){ return g[0]; });
        var foilMask = 0, i;
        for (i = 0; i < n; i++){ if (day.isFoil[i]) foilMask |= (1 << i); }
        var full = 1 << n;
        var cost = {}, path = {};
        day.starts.forEach(function(s){
            var dp = new Array(full), par = new Array(full), mask, last, nx;
            for (mask = 0; mask < full; mask++){
                dp[mask] = new Array(n); par[mask] = new Array(n);
                for (i = 0; i < n; i++){ dp[mask][i] = Infinity; par[mask][i] = -1; }
            }
            dp[1 << s][s] = 0;
            for (mask = 0; mask < full; mask++){
                for (last = 0; last < n; last++){
                    var cur = dp[mask][last];
                    if (cur === Infinity || !(mask >> last & 1)) continue;
                    for (nx = 0; nx < n; nx++){
                        if (mask >> nx & 1) continue;
                        // фольга уже началась → дальше только фольга (#3717)
                        if ((mask & foilMask) && !day.isFoil[nx]) continue;
                        var nm = mask | (1 << nx);
                        var c = cur + sequencingCost(rep[last], rep[nx], times, settings);
                        if (c < dp[nm][nx]){ dp[nm][nx] = c; par[nm][nx] = last; }
                    }
                }
            }
            cost[s] = {}; path[s] = {};
            day.ends.forEach(function(e){
                if (dp[full - 1][e] === Infinity) return;
                var order = [], m = full - 1, cur2 = e;
                while (cur2 >= 0){ order.push(cur2); var p = par[m][cur2]; m ^= (1 << cur2); cur2 = p; }
                cost[s][e] = dp[full - 1][e];
                path[s][e] = order.reverse();
            });
        });
        // #4464: repOut — конфигурация, которой группа ЗАКАНЧИВАЕТСЯ (вход в следующий день).
        // Для групп по подписи совпадает с rep (подпись одна), для монолита 🔒 — последняя его резка.
        return { cost: cost, path: path, rep: rep, repOut: groups.map(function(g){ return g[g.length - 1]; }) };
    }

    // Пересортировать очередь станка ПО ДНЯМ. dayByCut — РЕАЛЬНЫЙ день старта каждой резки из
    // упаковки; упаковщик заполняет очередь последовательно, поэтому дни идут непрерывными
    // отрезками. Состав дня и его номер НЕ меняются → штрафы срока (§8 п.4/5) те же.
    // Оптимум СКВОЗНОЙ: подневная жадность не годится — перестановка дня меняет вход в следующий
    // день, и локально лучшие дни дают суммарно худшую очередь. Поэтому DP по цепочке дней:
    // состояние = группа, которой день закончился.
    // Приёмка ДВОЙНАЯ: цель порядка (sequencingCost, #3996) строго лучше И реальные минуты наладки
    // (changeoverCost) не выросли — снятие двух «ростов полос» (−20 каждый) окупает лишнюю смену
    // ножей (+30) по цели, но оператор в цеху заплатит эти 30 минут.
    // prev — заправка станка (#3853). → новый порядок | null (не улучшилось / не наш случай).
    function resequenceWithinDays(ordered, dayByCut, spanningIds, prev, times, settings){
        // #4151: тай-брейк группировки рулона активен ТОЛЬКО здесь — sequencingCost добавляет
        // крошечный штраф за перемонтаж рулона, а двойная приёмка (newReal ≤ oldReal ниже) не даёт
        // разменять его на реальные минуты. greedySequence/orderCuts (флаг выключен) не трогаем.
        var prevTiebreak = sequencingRollTiebreak;
        sequencingRollTiebreak = true;
        try {
            return resequenceWithinDaysCore(ordered, dayByCut, spanningIds, prev, times, settings);
        } finally {
            sequencingRollTiebreak = prevTiebreak;
        }
    }
    function resequenceWithinDaysCore(ordered, dayByCut, spanningIds, prev, times, settings){
        if (!ordered || ordered.length < 2) return null;
        var runs = [], curDay = null, i;
        for (i = 0; i < ordered.length; i++){
            var d = dayByCut[String(ordered[i].id)];
            if (d == null) return null;   // резка без реального дня — не рискуем
            if (!runs.length || d !== curDay){ runs.push([]); curDay = d; }
            runs[runs.length - 1].push(ordered[i]);
        }
        for (i = 1; i < runs.length; i++){   // дни обязаны строго возрастать (иначе не наш случай)
            if (dayByCut[String(runs[i][0].id)] <= dayByCut[String(runs[i - 1][0].id)]) return null;
        }
        var days = [], tables = [];
        for (i = 0; i < runs.length; i++){
            var dg = dayGroups(runs[i], spanningIds, RESEQ_MAX_NODES);
            if (dg){
                days.push(dg); tables.push(dayPathTable(dg, times, settings));
                continue;
            }
            // #4434 п.5: день шире точного перебора — НЕ отменяем пересортировку всей очереди станка
            // (раньше один такой день оставлял без «ножей по убыванию» все остальные): берём для него
            // кандидатов «как есть» / жадная цепочка. Не раскладывается вовсе (фольга не может стать
            // последней при закреплённом хвосте) — только тогда сдаёмся.
            var loose = dayGroups(runs[i], spanningIds, null);
            if (!loose) return null;
            var ct = dayCandidateTable(loose, times, settings);
            loose.starts = ct.starts; loose.ends = ct.ends;
            days.push(loose); tables.push(ct);
        }
        // DP по цепочке дней: state[e] = {cost, s, prevEnd}
        var state = null;
        for (i = 0; i < days.length; i++){
            var tbl = tables[i], day = days[i], next = {};
            day.starts.forEach(function(s){
                if (!tbl.cost[s]) return;
                day.ends.forEach(function(e){
                    var inner = tbl.cost[s][e];
                    if (inner == null) return;
                    if (state === null){
                        var base = prev ? sequencingCost(prev, tbl.rep[s], times, settings) : 0;
                        if (next[e] == null || base + inner < next[e].cost) next[e] = { cost: base + inner, s: s, prevEnd: null };
                    } else {
                        Object.keys(state).forEach(function(pe){
                            var prevTbl = tables[i - 1];   // #4464: выход дня — по ПОСЛЕДНЕЙ резке группы
                            var prevRep = (prevTbl.repOut || prevTbl.rep)[Number(pe)];
                            var c = state[pe].cost + sequencingCost(prevRep, tbl.rep[s], times, settings) + inner;
                            if (next[e] == null || c < next[e].cost) next[e] = { cost: c, s: s, prevEnd: Number(pe) };
                        });
                    }
                });
            });
            if (!Object.keys(next).length) return null;
            state = next;
            days[i]._state = state;
        }
        // обратный проход: собрать выбранные (s,e) по дням
        var endPick = null;
        Object.keys(state).forEach(function(e){ if (endPick === null || state[e].cost < state[endPick].cost) endPick = e; });
        var picks = new Array(days.length), curEnd = Number(endPick);
        for (i = days.length - 1; i >= 0; i--){
            var st = days[i]._state[curEnd];
            picks[i] = { s: st.s, e: curEnd };
            curEnd = st.prevEnd;
        }
        var out = [];
        for (i = 0; i < days.length; i++){
            var order = tables[i].path[picks[i].s][picks[i].e];
            order.forEach(function(gIdx){ days[i].groups[gIdx].forEach(function(c){ out.push(c); }); });
        }
        if (out.length !== ordered.length) return null;
        var newSeq = runChainCost(out, prev, times, sequencingCost, settings);
        var oldSeq = runChainCost(ordered, prev, times, sequencingCost, settings);
        var newReal = runChainCost(out, prev, times, changeoverCost);
        var oldReal = runChainCost(ordered, prev, times, changeoverCost);
        // #4224: «фольга ВСЕГДА в конец дня» (#3717) — ЖЁСТКОЕ правило, не оптимизация. Если СТАРЫЙ
        // порядок его нарушает (напр. §12-релокация по реальным дням впихнула нефольгу ЗА фольгу),
        // применяем переупорядочивание БЕЗ гейта по стоимости: out гарантированно foil-last (DP вшил
        // ограничение foilMask), а лишняя наладка — цена соблюдения правила. Прежняя двойная приёмка
        // (строго дешевле по цели И не дороже по факту, #4151/#3996) остаётся для НЕ нарушающего входа.
        if (violatesFoilEndOfDay(runs)) return out;
        return (newSeq < oldSeq - 1e-9 && newReal <= oldReal + 1e-9) ? out : null;
    }

    // #4224: есть ли в каком-либо дне нефольга ПОСЛЕ фольги (нарушение #3717 «фольга в конец дня»)?
    function violatesFoilEndOfDay(runs){
        for (var r = 0; r < runs.length; r++){
            var seenFoil = false;
            for (var k = 0; k < runs[r].length; k++){
                var c = runs[r][k];
                if (c && c.isFoil) seenFoil = true;
                else if (seenFoil) return true;
            }
        }
        return false;
    }

    // #4184: подпись «блока ножей» — набор ширин ножей + ширина ролика. Внутри такого блока
    // оператор не перенастраивает ножи; отличаться резки могут лишь сырьём/намоткой/партией.
    function knifeBlockSig(cut){ return knifeWidthSig(cut) + '|' + (Number(cut && cut.rollerWidth) || 0); }

    // #4184: склеить одинаковое сырьё/намотку ВНУТРИ каждого блока ножей, НЕ меняя порядок самих
    // блоков (порядок ножей неизменен, ТЗ). #4139 чинит разрыв только ВНУТРИ дня; здесь дубль
    // может лежать через границу дня (напр. первая резка 01.07, группа-дубль 03.07). Кластеризуем
    // резки блока по полной подписи конфигурации (cutConfigSig — внутри блока отличается лишь
    // сырьём/намоткой/партией):
    //   • byLast=false → кластеры в порядке ПЕРВОГО появления (тянет поздний дубль ВВЕРХ, к раннему);
    //   • byLast=true  → в порядке ПОСЛЕДНЕГО появления (толкает ранний дубль ВНИЗ, к позднему).
    // Так вызывающий пробует ОБЕ стороны дубля и принимает лишь безопасную (проверка срока/наладки).
    // Инварианты: фольга держится ПОСЛЕ нефольги в блоке (#3717); блок с зафиксированной (🔒)
    // резкой не трогаем (у неё якорь дня). Порядок внутри кластера сохраняется. → новый порядок
    // очереди станка либо null (склеивать нечего).
    function clusterMaterialWithinKnifeBlocks(ordered, byLast){
        if (!ordered || ordered.length < 3) return null;
        var out = [], changed = false, i = 0;
        while (i < ordered.length){
            var blkSig = knifeBlockSig(ordered[i]);
            var j = i;
            while (j < ordered.length && knifeBlockSig(ordered[j]) === blkSig) j++;
            var block = ordered.slice(i, j);
            i = j;
            var hasFixed = block.some(function(c){ return !!(c && c.fixed); });
            if (block.length < 3 || hasFixed){ out = out.concat(block); continue; }
            // Ключ кластера — подпись конфигурации + фольга (cutConfigSig фольгу не различает, а
            // намотка фольги отдельная и держится в конце дня #3717 — не смешиваем с нефольгой).
            var firstIdx = {}, lastIdx = {}, foilSig = {}, bySig = {}, keys = [];
            block.forEach(function(c, idx){
                var isF = !!(c && c.isFoil);
                var sig = cutConfigSig(c) + (isF ? '|F' : '');
                if (firstIdx[sig] == null){ firstIdx[sig] = idx; keys.push(sig); bySig[sig] = []; foilSig[sig] = isF; }
                lastIdx[sig] = idx;
                bySig[sig].push(c);
            });
            var sigs = keys.slice().sort(function(a, b){
                // фольга — всегда после нефольги (#3717); затем по первому/последнему появлению
                var fa = foilSig[a] ? 1 : 0, fb = foilSig[b] ? 1 : 0;
                if (fa !== fb) return fa - fb;
                return byLast ? (lastIdx[a] - lastIdx[b]) : (firstIdx[a] - firstIdx[b]);
            });
            var newBlock = [];
            sigs.forEach(function(s){ newBlock = newBlock.concat(bySig[s]); });
            for (var k = 0; k < newBlock.length; k++){ if (newBlock[k] !== block[k]){ changed = true; break; } }
            out = out.concat(newBlock);
        }
        return changed ? out : null;
    }

    // #4205: ХИРУРГИЧЕСКАЯ склейка островов ОДНОЙ конфигурации. clusterMaterialWithinKnifeBlocks
    // переставляет ВЕСЬ блок ножей сразу, поэтому приёмка (проверка срока) отвергает его, если хоть
    // одно ЧУЖОЕ задание блока от глобальной перетасовки уезжает за свой срок — и выгодная локальная
    // склейка дубля не случается (жалоба #4205: единичное MWR200 в начале + тройка в конце, слить
    // −15 мин, но byFirst роняет чужой срок, byLast — свой у приколотого сроком единичного).
    // Здесь для КАЖДОЙ конфигурации блока с ≥2 островами формируем кандидатов, где к якорному острову
    // (первому ИЛИ последнему появлению) стягиваются ТОЛЬКО резки этой конфигурации, а остальной
    // порядок блока сохраняется как есть. Минимальное движение → приёмка проходит там, где глобальная
    // перетасовка ломала чужой срок. Фольгу отдельно не бережём — её держит проверка foilNotLastCount
    // в приёмке. Возвращает список порядков очереди станка (каждый = ordered с одной склейкой).
    //
    // #4214: границу блока берём по knifeWidthSig (набор ширин ножей), НЕ по knifeBlockSig
    // (knifeWidthSig+rollerWidth). Джамбо-ширина (rollerWidth) — отдельное измерение сырья, а не ножей:
    // одинаковые ножи «110*8» с РАЗНОЙ шириной джамбо давали разные knifeBlockSig и дробили визуально
    // единый блок ножей на куски. Тогда острова ОДНОГО сырья (напр. единичное MWR200 сроком 01.07 в
    // начале + тройка MWR200 в конце), разделённые заданиями с ДРУГОЙ шириной джамбо, попадали в разные
    // прогоны knifeBlockSig и НЕ рассматривались к склейке (жалоба #4214: «разрыв по сырью — ножи и
    // сырьё идентичны»). По knifeWidthSig они в ОДНОМ блоке. Сужение джамбо — это смена ножей (KNIFE в
    // changeoverCost), поэтому приёмка (переналадка СТРОГО вниз + без новой просрочки + фольга не хуже)
    // сама отвергнет склейку, где перенос через границу джамбо стоит дороже экономии на сырье.
    function materialIslandMergeCandidates(ordered){
        if (!ordered || ordered.length < 3) return [];
        function sigOf(c){ return cutConfigSig(c) + ((c && c.isFoil) ? '|F' : ''); }
        var cands = [], i = 0;
        while (i < ordered.length){
            var blkSig = knifeWidthSig(ordered[i]);
            var j = i; while (j < ordered.length && knifeWidthSig(ordered[j]) === blkSig) j++;
            var start = i, block = ordered.slice(i, j); i = j;
            if (block.length < 3) continue;
            if (block.some(function(c){ return !!(c && c.fixed); })) continue;   // якорь дня (🔒) — не трогаем
            var idxsBySig = {}, order = [];
            block.forEach(function(c, idx){ var s = sigOf(c); if (!idxsBySig[s]){ idxsBySig[s] = []; order.push(s); } idxsBySig[s].push(idx); });
            order.forEach(function(sig){
                var idxs = idxsBySig[sig];
                if (idxs.length < 2) return;                       // одиночная — сливать нечего
                var contiguous = true;
                for (var k = 1; k < idxs.length; k++){ if (idxs[k] !== idxs[k - 1] + 1){ contiguous = false; break; } }
                if (contiguous) return;                            // уже подряд
                var isMoved = {}; idxs.forEach(function(x){ isMoved[x] = 1; });
                var moved = idxs.map(function(x){ return block[x]; });
                var rest = [];
                block.forEach(function(c, idx){ if (!isMoved[idx]) rest.push({ c: c, idx: idx }); });
                // якорь = первый / последний остров: вставляем `moved` среди `rest` на место якоря
                [idxs[0], idxs[idxs.length - 1]].forEach(function(anchor){
                    var insertAt = rest.filter(function(x){ return x.idx < anchor; }).length;
                    var newBlock = rest.slice(0, insertAt).map(function(x){ return x.c; })
                        .concat(moved).concat(rest.slice(insertAt).map(function(x){ return x.c; }));
                    cands.push(ordered.slice(0, start).concat(newBlock).concat(ordered.slice(start + block.length)));
                });
            });
        }
        return cands;
    }

    function bestExistingTransitionCost(group, cut, weights) {
        if (!group || !group.length || !cut) return Infinity;
        var times = planningChangeTimes(weights);
        var best = Infinity;
        group.forEach(function(prev) {
            best = Math.min(best, changeoverCost(prev, cut, times), changeoverCost(cut, prev, times));
        });
        return best === Infinity ? Infinity : round3(best);
    }

    // Выбрать станок для новой резки по приросту минут переналадки (#3268).
    // #3666: ГЛАВНЫЙ критерий — станок, который уже режет ТОТ ЖЕ набор ширин ножей
    // (knifeWidthSig). Одинаковую конфигурацию ножей не разносим по разным станкам: на
    // пустом станке прирост переналадки = 0 (у одиночной резки нет переходов), и прежде он
    // обыгрывал занятый совместимый (delta которого = переналадка), хотя физически пустой
    // станок тоже требует настройки ножей с нуля.
    //
    // #3801: «прицепиться» к станку можно по ножам (тот же набор ширин) ИЛИ по сырью (то же
    // сырьё + намотка — резка идёт без смены сырья). Логика выбора:
    //   • есть куда прицепиться → держим группировку: тот же набор ножей → то же сырьё →
    //     минимум прироста переналадки (delta ↑) → аффинность ↑ → НАИМЕНЕЕ загруженный
    //     совместимый станок (не сваливаем всё на один из нескольких совместимых) → id;
    //   • прицепиться негде (ни по ножам, ни по сырью — везде холодная настройка) → выбираем
    //     НАИМЕНЕЕ ЗАГРУЖЕННЫЙ станок (балансировка), затем delta ↑, аффинность ↑, id.
    // Так одинаковое сырьё/ножи объединяются на одном станке, а несовместимые задания
    // распределяются ровно, а не копятся на одном (неравномерная загрузка станков).
    //
    // #3830: НЕ сваливать резку на станок, чей рабочий день уже ПЕРЕПОЛНЕН, когда есть другой
    // допустимый станок со свободным местом. Раньше группировка по сырью (attach) была выше
    // загрузки → вся фольга (общее сырьё «Фольга …») копилась на одном станке и вылетала за
    // ёмкость дня (≈514 мин при 450), хотя у соседнего станка день был пуст. Признак overflow
    // (рабочие минуты дня станка с этой резкой > ёмкости) стал ПЕРВЫМ критерием: при равных
    // overflow держим прежнюю группировку/балансировку. Активно только когда задана ёмкость
    // (dayCapacityMin, генерация); без неё (тесты/обратная совместимость) overflow всегда 0.
    //   dayCapacityMin — рабочая ёмкость дня станка (мин); опционально.
    // #3876: unavailableSlitterIds (опц.) — { slitterId: true } станков, у которых в день этой
    // резки отпуск; их не выбираем (станок без сырья и ножей). Если после исключения не остаётся
    // ни одного станка (все в отпуске) — откатываемся к полному списку, чтобы не «потерять» резку.
    function chooseSlitterBySetup(cut, slitters, groupsBySlitterId, loadBySlitterId, weights, dayCapacityMin, unavailableSlitterIds, nominalWidthByMaterial) {
        var groups = groupsBySlitterId || {};
        var load = loadBySlitterId || {};
        var cap = Number(dayCapacityMin);
        var capActive = isFinite(cap) && cap > 0;   // #3830: учитывать ёмкость только если задана
        var unavail = unavailableSlitterIds || {};
        // #4006: номинальная ширина сырья резки — для лимита ширины джамбо станка («Код» j<1000).
        var nomWidth = (nominalWidthByMaterial || {})[String(cut && cut.materialId)];
        var allowed = (slitters || []).filter(function(s){
            return !isMaterialBlocked(s.stopMaterialIds, cut && cut.materialId)   // стоп-лист сырья
                && !isSlitterWidthBlocked(s.widthCode, nomWidth);                 // #4006: лимит ширины джамбо
        });
        if (!allowed.length) return null;
        var available = allowed.filter(function(s){ return !unavail[String(s.id)]; });   // #3876: не в отпуске в этот день
        if (available.length) allowed = available;   // все в отпуске → оставляем как было (резку не теряем)
        function cmpNumber(a, b) {
            if (a === b) return 0;
            if (a === Infinity) return 1;
            if (b === Infinity) return -1;
            return a - b;
        }
        function cmpId(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
        // #3830: рабочие минуты резки за день — намотка (+ лидер, если хранится). Переналадка
        // считается отдельно (через прирост orderedChangeoverCost). Нет данных → 0.
        function cutWorkMinutes(c) {
            var cl = Number(c && c.storedCutAndLeaderMin);
            if (isFinite(cl) && cl > 0) return cl;   // #3700: «Резка и Лидер» (намотка + лидер)
            return Number(c && c.duration) || 0;     // намотка («Длительность, минут»)
        }
        var cutSig = knifeWidthSig(cut);
        var cutMat = String(cut && cut.materialId == null ? '' : cut.materialId).trim();
        var cutWind = normWinding(cut && cut.winding);
        var cutWork = cutWorkMinutes(cut);
        var candidates = allowed.map(function(s) {
            var id = String(s.id);
            var group = groups[id] || [];
            var before = orderedChangeoverCost(group, weights);
            var after = orderedChangeoverCost(group.concat([cut]), weights);
            // #3666: 0 — станок уже режет тот же набор ширин ножей (приоритет), иначе 1.
            var sameKnives = (cutSig !== '' && group.some(function(g){ return knifeWidthSig(g) === cutSig; })) ? 0 : 1;
            // #3801: 0 — станок уже режет то же сырьё + намотку (можно прицепиться по сырью), иначе 1.
            var sameMaterial = (cutMat !== '' && group.some(function(g){
                return String(g.materialId == null ? '' : g.materialId).trim() === cutMat && normWinding(g.winding) === cutWind;
            })) ? 0 : 1;
            // #3830: рабочие минуты дня станка с этой резкой = переналадки (after) + намотки всех.
            var dayWork = round3(after + group.reduce(function(s2, g){ return s2 + cutWorkMinutes(g); }, 0) + cutWork);
            return {
                id: id,
                // #3830: 1 — день станка с этой резкой ВЫЛЕЗАЕТ за ёмкость (переполнен), иначе 0.
                overflow: (capActive && dayWork > cap) ? 1 : 0,
                // #3801: 0 — есть к чему прицепиться (ножи ИЛИ сырьё), иначе 1 (холодная настройка).
                attach: (sameKnives === 0 || sameMaterial === 0) ? 0 : 1,
                sameKnives: sameKnives,
                sameMaterial: sameMaterial,
                delta: round3(after - before),
                affinity: bestExistingTransitionCost(group, cut, weights),
                load: Number(load[id]) || 0
            };
        });
        // #3801: есть ли хоть один станок, к которому новая резка цепляется по ножам/сырью.
        var anyAttach = candidates.some(function(c){ return c.attach === 0; });
        candidates.sort(function(a, b) {
            // #3830: станок, где резка ВЛЕЗАЕТ в день, — всегда первым (не переполняем станок,
            // если есть свободный). При равных overflow — прежняя логика группировки/балансировки.
            var byOverflow = cmpNumber(a.overflow, b.overflow);
            if (byOverflow) return byOverflow;
            if (anyAttach) {
                return cmpNumber(a.attach, b.attach)            // #3801: совместимые станки — первыми
                    || cmpNumber(a.sameKnives, b.sameKnives)    // #3666: тот же набор ножей — на тот же станок
                    || cmpNumber(a.sameMaterial, b.sameMaterial)// #3801: то же сырьё — на тот же станок
                    || cmpNumber(a.delta, b.delta)              // #3268: минимум прироста переналадки
                    || cmpNumber(a.affinity, b.affinity)
                    || cmpNumber(a.load, b.load)                // #3801: при равенстве — наименее загруженный
                    || cmpId(a.id, b.id);
            }
            // #3801: прицепиться негде — выбираем наименее загруженный станок (балансировка).
            return cmpNumber(a.load, b.load)
                || cmpNumber(a.delta, b.delta)
                || cmpNumber(a.affinity, b.affinity)
                || cmpId(a.id, b.id);
        });
        return candidates[0].id;
    }

    // #3848: выравнивание загрузки станков ПОСЛЕ жадного назначения (chooseSlitterBySetup) и
    // распределения по срокам. Жадность группирует одно сырьё/набор ножей на ОДИН станок —
    // он может скопить работу на 5 дней, пока соседний простаивает. Здесь итеративно переносим
    // ПОДВИЖНЫЕ задания (новые, plans) с ПЕРЕГРУЖЕННОГО (день ≥2) станка на менее загруженный,
    // минимизируя ЛЕКСИКОГРАФИЧЕСКИ [макс. число дней, пик минут станка, сумма квадратов минут].
    // Существующие резки (opts.fixedByMachine) держат базовую загрузку своих станков, но НЕ двигаются.
    //
    // Свойства, требуемые #3848:
    //  • итерационный — по одному переносу за шаг, лучший улучшающий ход;
    //  • журнал (opts.log) — старт / каждый перенос / стоп с причиной (в консоль — «панель отладки»);
    //  • стоп при ОТСУТСТВИИ ПРОГРЕССА — нет хода, строго улучшающего счёт;
    //  • без цикличных перестановок — Set посещённых КОМБИНАЦИЙ (stateHash): идентичное назначение
    //    не повторяем. Плюс ходы только СТРОГО улучшающие счёт ⇒ счёт монотонно падает (циклы
    //    «переставили-вернули» невозможны и без Set, но Set — явная страховка по требованию #3848).
    //
    // Мутирует plan.slitterId у перенесённых. Чистая (детерминированная) — тест.
    // opts: { weights, dayCapacityMin, fixedByMachine:{slitterId:[cut…]}, log:fn(ev), maxIters }.
    // → { moves:[{cutId,from,to}], iterations, stopReason, loadBefore, loadAfter }.
    function rebalanceSlitterLoad(plans, slitters, opts) {
        opts = opts || {};
        var weights = opts.weights;
        var times = planningChangeTimes(weights);
        var cap = Number(opts.dayCapacityMin);
        var hasCap = isFinite(cap) && cap > 0;
        var log = typeof opts.log === 'function' ? opts.log : function(){};
        var maxIters = isFinite(Number(opts.maxIters)) ? Number(opts.maxIters) : 1000;
        var movablePlans = (plans || []).filter(function(p){ return p && p.slitterId != null && String(p.slitterId) !== ''; });
        var machineList = (slitters || []).map(function(s){ return String(s.id); });
        var fixedBy = opts.fixedByMachine || {};
        if (machineList.length < 2 || !movablePlans.length) {
            return { moves: [], iterations: 0, stopReason: 'nothing-to-balance', loadBefore: {}, loadAfter: {} };
        }
        var stopBlock = {};   // slitterId → stopMaterialIds (станок не варит это сырьё — туда не переносим)
        (slitters || []).forEach(function(s){ stopBlock[String(s.id)] = s.stopMaterialIds; });
        // #4006: slitterId → условие ширины джамбо («Код» станка) + карта номиналов сырья —
        // не переносить широкое сырьё на станок с лимитом (напр. MWR500L 1000 на «j<1000»).
        var widthBlock = {};
        (slitters || []).forEach(function(s){ widthBlock[String(s.id)] = s.widthCode; });
        var nominalWidthByMaterial = opts.nominalWidthByMaterial || {};
        // #3876: не переносить задание на станок, у которого в день этого задания отпуск.
        // opts.slitterDayBlocked(slitterId, plan) → bool (контроллер даёт по downtimesBySlitter +
        // plan.planDate). Не задан → null (поведение прежнее; тесты/обратная совместимость).
        var slitterDayBlocked = typeof opts.slitterDayBlocked === 'function' ? opts.slitterDayBlocked : null;

        // Рабочие минуты задания (намотка + лидер, если хранится; иначе «Длительность»).
        function workMin(m){
            var cl = Number(m && m.storedCutAndLeaderMin);
            if (isFinite(cl) && cl > 0) return cl;
            return Number(m && m.duration) || 0;
        }
        // #3965: загрузка станка = ФАКТИЧЕСКАЯ укладка его заданий по рабочим дням (как
        // splitMachineQueue: порядок orderCuts, настройка КАЖДОЙ резки «с нуля» — ножи+сырьё,
        // ёмкость дня cap, пропуск нерабочих дней станка machineDayOff — выходные #3788 + отпуск
        // #3876). Прежняя оценка poolMinutes считала переналадку по СГРУППИРОВАННОМУ порядку
        // orderCuts (соседние одинаковые конфиги → ~0), а реальный день-сплит порядок НЕ группирует
        // → недооценивала настроечно-тяжёлый станок почти вдвое (Станок 1: реально 2757 мин,
        // оценка ~1214 мин ≈ 3 дня) → балансировщик думал, что станок влезает до отпуска, и даже
        // докидывал на него, а хвост уезжал за отпуск. opts.machineDayOff(id, dayOffset)→bool —
        // день-смещение от базы нерабочий; не задан → без пропусков (тесты/обратная совместимость).
        var machineDayOff = typeof opts.machineDayOff === 'function' ? opts.machineDayOff : null;
        function skipOff(machineId, d){ if (machineDayOff) while (machineDayOff(machineId, d)) d++; return d; }
        // packMachine(id, members) → { endPos: дробная дата окончания (кал. дни от базы), days:
        // целая дата окончания = span, minutes: реальные минуты с настройками }. #3881: если СРАЗУ
        // за работой идёт непрерывный блок нерабочих дней (выходные+отпуск) — станок «занят» до
        // его конца (на него не докидываем, пока он в отпуске); это же «плато» не даёт балансиру
        // выдёргивать доотпускную работу (перенос одного задания не меняет пол → счёт не лучше).
        // Мемоизация по (станок|набор id) — orderCuts/переналадка дороги́е.
        var packMemo = {};
        function packMachine(machineId, members){
            if (!members || !members.length){
                // #3881: пустой станок, у которого отпуск с дня 0, «занят» до конца ведущего
                // отпуска (не считается свободным раньше времени); иначе — свободен.
                if (machineDayOff && machineDayOff(machineId, 0)){ var w = skipOff(machineId, 0); return { endPos: w, days: w, minutes: 0 }; }
                return { endPos: 0, days: 0, minutes: 0 };
            }
            var idsArr = members.map(function(m){ return String(m.id); }); idsArr.sort();
            var sig = machineId + '|' + idsArr.join(',');
            if (packMemo[sig]) return packMemo[sig];
            var seq = orderCuts(members, weights);
            var res;
            // Настройка резки «с нуля»: ножи + заправка сырья (#4296: firstSetupParts/firstSetupCost
            // теперь даёт ОБА компонента на пустом станке — отдельно сырьё не добавляем, двойной счёт).
            // Реальный день-сплит НЕ группирует одинаковые конфиги (сроки #3815 и направления намотки
            // разносят их по очереди), поэтому почти каждая резка ставит ножи и сырьё заново. Оценка
            // через changeoverCost в порядке orderCuts группировала соседние одинаковые конфиги в ~0 и
            // занижала настроечно-тяжёлый станок вдвое (#3965): Станок 1 реально 2757 мин (намотка 625 +
            // настройка ~2130 ≈ 42 мин/резка), оценка ~1214 мин.
            function scratchSetup(c){
                return firstSetupCost(c, times);   // ножи + сырьё (firstSetupParts, #4296)
            }
            // #3968: настройка резки — КАК В РЕАЛЬНОЙ укладке (buildSchedule: setup =
            // changeoverCost(cuts[i-1], c); splitMachineQueue/selectByConfig группирует одинаковые
            // конфиги по непрерывности), а НЕ «с нуля» у каждой резки. Реальный день-сплит ставит
            // соседние одинаковые ножи/сырьё ОДИН раз (переход = 0), поэтому просроченная партия
            // одного сырья (#3815, один срок) укладывается плотно. Оценка «с нуля» у каждой (было
            // #3965) завышала настроечно-СГРУППИРОВАННЫЙ станок почти вдвое (Станок 1 #3968: оценка
            // 1479 при реальных 834) → балансировщик считал его загруженным и не докидывал работу →
            // станок недогружен, а соседние переливали за ёмкость. changeoverCost честно даёт 0 для
            // одинаковых конфигов и полную настройку для разных (разные сырьё/намотка/сроки —
            // сценарий #3965/#3957: настроечно-РАЗНЫЙ станок остаётся тяжёлым, хвост стекает).
            // Первая резка очереди — настройка с нуля (scratchSetup: ножи+сырьё), прочие — переход.
            function setupOf(i){ return i === 0 ? scratchSetup(seq[0]) : changeoverCost(seq[i-1], seq[i], times); }
            if (!hasCap){   // без ёмкости — минуты с настройкой перехода, дата окончания = 1 «день»
                var mm = 0; for (var j = 0; j < seq.length; j++){ mm += workMin(seq[j]) + setupOf(j); }
                res = { endPos: mm > 0 ? 1 : 0, days: mm > 0 ? 1 : 0, minutes: round3(mm) };
                packMemo[sig] = res; return res;
            }
            var day = skipOff(machineId, 0), clock = 0, real = 0;
            for (var i = 0; i < seq.length; i++){
                var need = setupOf(i) + workMin(seq[i]);
                if (clock > 0 && clock + need > cap){                 // не влезает в остаток дня → след. рабочий день
                    day = skipOff(machineId, day + 1); clock = 0;
                }
                clock += need; real += need;
                while (clock > cap){                                  // резка+настройка длиннее дня — дробится по дням (#3280)
                    clock -= cap; day = skipOff(machineId, day + 1);
                }
            }
            var endPos, span;
            if (clock <= 0){ endPos = day; span = day; }
            else {
                var next = day + 1;
                if (machineDayOff && machineDayOff(machineId, next)){ // сразу за работой — непрерывный блок нерабочих дней
                    next = skipOff(machineId, next);
                    endPos = next; span = next;                       // «занят» до начала след. рабочего дня (#3881)
                } else { endPos = day + clock / cap; span = day + 1; }
            }
            res = { endPos: round3(endPos), days: span, minutes: round3(real) };
            packMemo[sig] = res; return res;
        }

        // Назначение подвижных: slitterId → [plan]. Полный набор станка = fixed + movable.
        var byMachine = {};
        machineList.forEach(function(id){ byMachine[id] = []; });
        movablePlans.forEach(function(p){ (byMachine[String(p.slitterId)] = byMachine[String(p.slitterId)] || []).push(p); });
        function membersOf(id){ return (fixedBy[id] || []).concat(byMachine[id] || []); }
        function membersMap(){ var o = {}; machineList.forEach(function(id){ o[id] = membersOf(id); }); return o; }
        function snapshot(){
            var snap = {};
            Object.keys(byMachine).forEach(function(id){
                var p = packMachine(id, membersOf(id));
                snap[id] = { minutes: p.minutes, days: p.days, cuts: (byMachine[id] || []).length };   // #3965: реальная укладка
            });
            return snap;
        }
        // Счёт состояния = [макс. дата окончания (целые дни = ДЕНЬ, срок), разброс сырья по станкам,
        // та же дата ДРОБНО, пик реальных минут, сумма квадратов минут]; меньше — лучше
        // (лексикографически). Дата окончания и минуты — из ФАКТИЧЕСКОЙ укладки packMachine (#3965),
        // а не из заниженной оценки. maxEndPos (#3921) дробит «плато» ceil: дробный хвост за отпуском
        // стекает на свободные станки. Сумма КВАДРАТОВ штрафует перекос: при равном пике она ниже у
        // РОВНОГО распределения — это и выталкивает работу на простаивающий станок.
        // #4077: «избыток сырья на станке» matHetero = Σ по станкам max(0, РАЗНЫХ сигнатур сырья − 1)
        // (materialSig = сырьё+намотка, тот же ключ, что у §13-идеала) — «лишние» сырья сверх первого
        // на каждом станке (= минимум смен сырья внутри станка при идеальной группировке). Штрафуется
        // РАЗНОРОДНОСТЬ ВНУТРИ станка, НЕ «сырьё на нескольких станках»: одно сырьё, размазанное по k
        // станкам, даёт 0 (каждый станок однороден) → выравнивание одинакового сырья по простаивающим
        // станкам (#3848) не страдает; пустой/односырьёвый станок = 0. Растёт только при добавлении
        // ДРУГОГО сырья на уже занятый станок.
        // РАНГ: сразу ПОД maxDays (ЦЕЛЫЕ дни = ДЕНЬ размещения — срок/финиш святы, #4059: не жертвуем
        // днём окончания ради группировки), но НАД maxEndPos/пиком/квадратами. maxEndPos — ДРОБНОЕ
        // уточнение внутри того же дня (#3921), НЕ срок-критично: задание со сроком в дне D ложится в
        // день D хоть при финише 4.2, хоть 4.8. Поэтому «косметический» перенос, кладущий ДРУГОЕ сырьё
        // на уже занятый станок и лишь СГЛАЖИВАЮЩИЙ дробный финиш/пик/квадраты (без сдвига ЦЕЛОГО дня
        // окончания), теперь отвергается. Балансировщик оценивает настройку по orderCuts (группировка
        // БЕЗ срока), а реальное расписание (selectByConfig) упорядочивает по сроку (EDD, #4059) и
        // чередует разные сырья с соседними сроками → лишние смены (issue #4077: Станок 1 — 22 факт.
        // смены сырья на 10 разных); меньше РАЗНЫХ сырьёв на станке ⇒ меньше такого чередования.
        // ЦЕЛЫЙ день окончания доминирует ⇒ перегруз, реально удлиняющий план (сдвиг за срок), всё
        // равно разгружается (инвариант #3848 цел); дробный хвост на СВОБОДНЫЙ станок однороден
        // (matHetero не растёт) → #3921/#3957-стекание за отпуском не страдает.
        function matHeteroOf(members){
            var seen = {}, n = 0;
            (members || []).forEach(function(m){ var s = materialSig(m); if (!seen[s]){ seen[s] = 1; n++; } });
            return n > 1 ? n - 1 : 0;   // «лишние» сырья сверх первого; 0/1 сырьё → 0
        }
        function scoreFrom(memById){
            var maxDays = 0, maxEndPos = 0, peak = 0, sumSq = 0, matHetero = 0;
            Object.keys(memById).forEach(function(id){
                var p = packMachine(id, memById[id]);
                var m = p.minutes;
                sumSq = round3(sumSq + m * m);
                if (m > peak) peak = m;
                if (p.days > maxDays) maxDays = p.days;
                if (p.endPos > maxEndPos) maxEndPos = p.endPos;
                matHetero += matHeteroOf(memById[id]);   // #4077: разнородность сырья ВНУТРИ станка
            });
            return [maxDays, matHetero, round3(maxEndPos), round3(peak), sumSq];
        }
        function lexLess(a, b){
            for (var i = 0; i < a.length; i++){ if (a[i] < b[i]) return true; if (a[i] > b[i]) return false; }
            return false;
        }
        // Хэш комбинации — по ТЕКУЩЕМУ plan.slitterId каждого подвижного задания (а не по
        // byMachine): пробный перенос временно ставит plan.slitterId = to, и хэш обязан это
        // отражать, иначе все кандидаты выглядят «уже посещёнными» (был баг 0 переносов).
        function stateHash(){
            var byId = {};
            machineList.forEach(function(id){ byId[id] = []; });
            movablePlans.forEach(function(p){ (byId[String(p.slitterId)] = byId[String(p.slitterId)] || []).push(String(p.id)); });
            return machineList.map(function(id){
                return id + ':' + (byId[id] || []).slice().sort().join('+');
            }).join('|');
        }

        // #3871: на время прохода считаем переналадку быстро (кэш по паре id + одностартовая
        // цепочка). Сбрасываем флаги в finally, чтобы планировщик дальше считал как обычно.
        var prevFast = balanceFastChangeover, prevMemo = balancePairCostMemo;
        balanceFastChangeover = true; balancePairCostMemo = {};
        try {
        var loadBefore = snapshot();
        var visited = {}; visited[stateHash()] = true;
        var moves = [], iter = 0, stopReason = 'no-progress';
        log({ event: 'start', load: loadBefore, score: scoreFrom(membersMap()) });

        while (iter < maxIters){
            var baseMembers = membersMap();
            var baseScore = scoreFrom(baseMembers);
            var best = null;   // { plan, from, to, score, hash }
            Object.keys(byMachine).forEach(function(from){
                // Переносим ТОЛЬКО со станка, заканчивающего на 2-й день и позже (#3881:
                // дата окончания с учётом отпуска — станок с отпуском кончает позже и потому
                // донор, его задания уезжают на простаивающие станки). Вся работа влезает в один
                // день (и без отпуска) — дробить незачем (лишние настройки). Без заданной ёмкости
                // (тесты/обратная совместимость) день всегда «1» ⇒ переносов нет, поведение прежнее.
                if (packMachine(from, baseMembers[from]).days < 2) return;
                (byMachine[from] || []).forEach(function(plan){
                    machineList.forEach(function(to){
                        if (to === from) return;
                        if (isMaterialBlocked(stopBlock[to], plan.materialId)) return;   // станок не варит это сырьё
                        if (isSlitterWidthBlocked(widthBlock[to], nominalWidthByMaterial[String(plan.materialId)])) return;   // #4006: сырьё шире лимита станка
                        if (slitterDayBlocked && slitterDayBlocked(to, plan)) return;     // #3876: станок в отпуске в день задания
                        // пробный перенос: меняется набор только from и to.
                        var fromMembers = (fixedBy[from] || []).concat((byMachine[from] || []).filter(function(x){ return x !== plan; }));
                        var trial = {}; Object.keys(baseMembers).forEach(function(id){ trial[id] = baseMembers[id]; });
                        trial[from] = fromMembers;
                        trial[to] = membersOf(to).concat([plan]);
                        var sc = scoreFrom(trial);
                        if (!lexLess(sc, best ? best.score : baseScore)) return;   // не лучше базы/текущего лучшего
                        // не повторяем ранее посещённую комбинацию (страховка от циклов).
                        var keep = plan.slitterId; plan.slitterId = to; var h = stateHash(); plan.slitterId = keep;
                        if (visited[h]) return;
                        best = { plan: plan, from: from, to: to, score: sc, hash: h };
                    });
                });
            });
            if (!best){ stopReason = 'no-progress'; break; }
            byMachine[best.from] = (byMachine[best.from] || []).filter(function(x){ return x !== best.plan; });
            best.plan.slitterId = best.to;
            (byMachine[best.to] = byMachine[best.to] || []).push(best.plan);
            visited[best.hash] = true;
            iter++;
            moves.push({ cutId: best.plan.id, from: best.from, to: best.to });
            log({ event: 'move', step: iter, cutId: best.plan.id, from: best.from, to: best.to, score: best.score, load: snapshot() });
        }
        if (iter >= maxIters) stopReason = 'max-iters';
        var loadAfter = snapshot();
        log({ event: 'stop', reason: stopReason, iterations: iter, load: loadAfter });
        return { moves: moves, iterations: iter, stopReason: stopReason, loadBefore: loadBefore, loadAfter: loadAfter };
        } finally {
            balanceFastChangeover = prevFast; balancePairCostMemo = prevMemo;
        }
    }

    // #4001: пере-выбор станка для СУЩЕСТВУЮЩИХ логических резок — та же связка, что при
    // генерации: жадный chooseSlitterBySetup по дням + rebalanceSlitterLoad. Так «Упорядочить»
    // для каждой задачи ищет более подходящий станок (как «Сгенерировать»), НЕ пересоздавая резки.
    // movable — логические резки к переназначению; fixed — 🔒 (держат свой станок базовой
    // загрузкой, не переносятся). Каждый элемент: { id, slitterId (текущий), materialId, winding,
    // knifeWidths, knifeCount, isFoil, width, planDate (unix-сек), plannedRuns, runLength, duration }.
    // ctx: { slitters, weights, dayCapacityMin, nominalWidthByMaterial,
    //        vacationForDay(dayKey, sec)->{sid:true}, slitterDayBlocked(sid, plan)->bool,
    //        machineDayOff(sid, dayOffset)->bool }.
    // → { slitterById: { logicalId: slitterId } } для movable (fixed не трогаем). Вход не мутирует
    // (для баланса берём копии plan-ов).
    function computeSlitterReassignment(movable, fixed, ctx) {
        ctx = ctx || {};
        var slitters = ctx.slitters || [];
        var weights = ctx.weights;
        var cap = Number(ctx.dayCapacityMin) || 0;
        var nomW = ctx.nominalWidthByMaterial;
        var vacationForDay = typeof ctx.vacationForDay === 'function' ? ctx.vacationForDay : function(){ return {}; };
        var slitterById = {};
        if (!movable || !movable.length) return { slitterById: slitterById };

        // Жадное назначение по дням (как generateCuts): setupGroupsByDay + loadBySlitterId.
        var order = movable.slice().sort(function(a, b){
            return (Number(a.planDate) || 0) - (Number(b.planDate) || 0)
                || String(a.id).localeCompare(String(b.id), 'ru');
        });
        var setupGroupsByDay = {}, loadBySlitterId = {};
        order.forEach(function(m){
            var day = cutPlanDayKey({ planDate: m.planDate });
            if (!setupGroupsByDay[day]) setupGroupsByDay[day] = {};
            var sid = chooseSlitterBySetup(m, slitters, setupGroupsByDay[day], loadBySlitterId, weights, cap, vacationForDay(day, m.planDate), nomW);
            if (sid == null) sid = (m.slitterId != null ? String(m.slitterId) : '');   // некуда поставить — оставляем текущий станок
            if (sid !== '') {
                (setupGroupsByDay[day][sid] = setupGroupsByDay[day][sid] || []).push(m);
                loadBySlitterId[sid] = (loadBySlitterId[sid] || 0) + 1;
            }
            slitterById[String(m.id)] = sid;
        });

        // Баланс загрузки (как generateCuts): movable переносим на менее загруженные станки,
        // 🔒 держат базовую загрузку (fixedByMachine). Нужна заданная ёмкость и ≥2 станков.
        if (cap > 0 && slitters.length >= 2) {
            var plans = order.filter(function(m){ return slitterById[String(m.id)]; }).map(function(m){
                return {
                    id: String(m.id), slitterId: slitterById[String(m.id)],
                    materialId: m.materialId, winding: m.winding, batchId: m.batchId,
                    knifeWidths: m.knifeWidths, knifeCount: m.knifeCount, isFoil: m.isFoil,
                    width: m.width, planDate: m.planDate, plannedRuns: m.plannedRuns,
                    runLength: m.runLength, duration: m.duration
                };
            });
            var fixedByMachine = {};
            (fixed || []).forEach(function(f){
                var s = f.slitterId != null ? String(f.slitterId) : '';
                if (s !== '') (fixedByMachine[s] = fixedByMachine[s] || []).push(f);
            });
            rebalanceSlitterLoad(plans, slitters, {
                weights: weights, dayCapacityMin: cap, fixedByMachine: fixedByMachine,
                nominalWidthByMaterial: nomW,
                machineDayOff: ctx.machineDayOff, slitterDayBlocked: ctx.slitterDayBlocked
            });
            plans.forEach(function(p){ slitterById[String(p.id)] = String(p.slitterId); });
        }
        return { slitterById: slitterById };
    }

    // #3602/#3923: перенос задания на другой день. Порядок дня задаёт planStart (planDate).
    // Строим желаемый порядок id внутри целевого дня (перемещаемое — первым/последним, прочие
    // — по их сохранённому planStart) и присваиваем плейсхолдер-planStart (день + i·минут);
    // autoSequenceQueue(preserveOrder) затем переупакует день встык по этому порядку. Перенос
    // имеет наивысший приоритет: фиксация заданий цели НЕ мешает (в отличие от ↑↓).
    //   cutId    — перемещаемое задание;
    //   dayCuts  — задания того же станка на целевом дне (без перемещаемого), любой порядок;
    //   position — 'start' (в начало) | 'end' (в конец) | 'weight' (место выберет упаковщик).
    // Голову дня занимает ТОЛЬКО 'start'. 'weight' и всё неизвестное — хвост: плейсхолдер обязан
    // быть нейтральным, иначе задание обгоняет зафиксированных соседей ещё до раскладки (#4553).
    // → { ordered:[id…] } в желаемом порядке. Вход не мутирует.
    function planMoveSequences(cutId, dayCuts, position) {
        var sorted = (dayCuts || []).slice().sort(function(a, b) {
            var an = Number(a && a.planDate), bn = Number(b && b.planDate);
            if (!isFinite(an) || an <= 0) an = Infinity;
            if (!isFinite(bn) || bn <= 0) bn = Infinity;
            return an - bn
                || ((Number(b && b.knifeCount) || 0) - (Number(a && a.knifeCount) || 0))
                || String((a && a.id) || '').localeCompare(String((b && b.id) || ''), 'ru');
        });
        var ids = sorted.map(function(c) { return String(c.id); })
            .filter(function(id) { return id !== String(cutId); });
        // #4553: ГОЛОВУ дня занимает только ЯВНОЕ «в начало» ('start'). Прежде ветка была
        // «'end' → хвост, ВСЁ ОСТАЛЬНОЕ → голова», и 'weight' («место в дне выбирает упаковщик
        // по весам», #4221) молча получал плейсхолдер головы: planMoveStarts даёт голове
        // `times[0] − 60`, то есть время РАНЬШЕ первого задания дня — до начала смены и перед
        // зафиксированным, хотя перед 🔒 автоматика не ставит ничего (#4497). Отсюда боевой
        // случай #4553: созданное формой задание село на 08:00 поверх уже стоявшего там 🔒.
        // Плейсхолдер «по весу» обязан быть НЕЙТРАЛЬНЫМ — хвост дня: он внутри смены, никого
        // не обгоняет, а настоящее место заданию выберет scorePosition в слое размещения.
        var ordered = position === 'start' ? [String(cutId)].concat(ids) : ids.concat([String(cutId)]);
        return { ordered: ordered };
    }

    // #4477: ПЛЕЙСХОЛДЕР-СТАРТЫ переноса на другой день — по образцу перетаскивания (#4306):
    // существующие времена дня ОСТАЮТСЯ у своих заданий, новое время минтуется ТОЛЬКО для
    // вставляемого. Прежде день перенумеровывался целиком (день+i·минут), и перенос одного
    // задания давал команду на сохранение КАЖДОМУ заданию дня — при том, что порядок соседей
    // не менялся, а точные времена всё равно тут же пересобирал `autoSequenceQueue(preserveOrder)`
    // (issue #4477: «много запросов на простое изменение»).
    //
    // Значения важны только ПОРЯДКОМ и ДНЁМ (место в дне планировщик получает явно —
    // `pinDayPosByCut`, #4464). Поэтому вставляемому хватает времени между соседями:
    // в начало — до первого, в конец — после последнего, в середину — середина промежутка.
    //   ordered  — желаемый порядок id (planMoveSequences), включая перемещаемое;
    //   dayCuts  — задания целевого дня БЕЗ перемещаемого (их planDate — источник времён);
    //   movedId  — перемещаемое задание;
    //   targetTs — начало смены целевого дня (день пуст либо перенумерация — отсюда).
    // → { byCut: { id: ts }, renumbered: bool }. renumbered=true — времена дня непригодны
    // (пусты, совпадают, не по возрастанию) либо минтуемое уехало бы в чужой день: тогда день
    // перенумеровывается целиком, как раньше. Вход не мутирует.
    function planMoveStarts(ordered, dayCuts, movedId, targetTs) {
        var ids = (ordered || []).map(function(id) { return String(id); });
        var moved = String(movedId);
        var base = Math.round(Number(targetTs));
        function renumber() {
            var by = {};
            ids.forEach(function(id, i) { by[id] = base + i * 60; });
            return { byCut: by, renumbered: true };
        }
        if (!ids.length || !isFinite(base)) return renumber();
        var byId = {};
        (dayCuts || []).forEach(function(c) { if (c && c.id != null) byId[String(c.id)] = c; });
        var mi = ids.indexOf(moved);
        if (mi < 0) return renumber();
        var times = [], sound = true;
        ids.forEach(function(id) {
            if (id === moved) return;
            var c = byId[id];
            var t = Math.round(Number(c && c.planDate));
            if (!isFinite(t) || t <= 0) { sound = false; return; }
            if (times.length && t <= times[times.length - 1]) sound = false;   // не по возрастанию/совпали (#3885)
            times.push(t);
        });
        if (!sound || times.length !== ids.length - 1) return renumber();
        if (!times.length) {
            var only = {}; only[moved] = base;
            return { byCut: only, renumbered: false };
        }
        var ts;
        if (mi === 0) ts = times[0] - 60;
        else if (mi === times.length) ts = times[times.length - 1] + 60;
        else ts = Math.floor((times[mi - 1] + times[mi]) / 2);
        // Место для вставки должно РЕАЛЬНО быть: промежуток в секунду ниоткуда порядок не задаст.
        if (!isFinite(ts) || (mi > 0 && ts <= times[mi - 1]) || (mi < times.length && ts >= times[mi])) return renumber();
        // Минтуемое время обязано остаться в ЦЕЛЕВОМ дне (иначе перенос уедет в соседний).
        if (planDateDayKey(ts) !== planDateDayKey(base)) return renumber();
        var out = {};
        out[moved] = ts;
        ids.forEach(function(id) { if (id !== moved) out[id] = Math.round(Number(byId[id].planDate)); });
        return { byCut: out, renumbered: false };
    }

    // #4306: чистый расчёт перестановки задания ВНУТРИ дня перетаскиванием (drag-drop). Порядок дня
    // задаёт planStart; при drag набор сохранённых времён дня ПЕРЕСТАВЛЯЕТСЯ под новый порядок (реальные
    // времена сохраняются, лишь меняют владельца) — как обобщённый ↑↓-своп на произвольную позицию.
    // dragId вынимается и вставляется ПЕРЕД targetId. #4392: зафиксированные (🔒) НЕ «стены» — их можно
    // переставлять и тащить сквозь них (фиксация держит день, а перестановка меняет planStart в пределах
    // того же дня). «Стена» осталась только у начатого (#4381). → { assignments:[{id,planStartTs}],
    // error: null|'notime'|'started' }. assignments — только реально изменившиеся (id → новое время).
    // Вход не мутирует. Пустой/вырожденный (drag==target, не найдено) → пустые assignments без ошибки.
    function planDragReorder(dayCuts, dragId, targetId) {
        var arr = dayCuts || [];
        var ids = arr.map(function(c) { return String(c && c.id); });
        var di = ids.indexOf(String(dragId)), ti = ids.indexOf(String(targetId));
        if (String(dragId) === String(targetId) || di < 0 || ti < 0) return { assignments: [], error: null };
        var times = arr.map(function(c) { return Number(c && c.planDate); });
        if (times.some(function(t) { return !isFinite(t) || t <= 0; })) return { assignments: [], error: 'notime' };
        var sorted = times.slice().sort(function(x, y) { return x - y; });   // позиция дня → время
        var byId = {}; arr.forEach(function(c) { byId[String(c && c.id)] = c; });
        var without = ids.filter(function(id) { return id !== String(dragId); });
        var tIdx = without.indexOf(String(targetId));
        var newOrder = without.slice(0, tIdx).concat([String(dragId)]).concat(without.slice(tIdx));
        for (var i = 0; i < newOrder.length; i++) {
            var fc = byId[newOrder[i]];
            if (!fc || ids[i] === newOrder[i]) continue;
            // #4392: зафиксированное (🔒) задание БОЛЬШЕ НЕ «стена» — его можно переставлять и через
            // него можно тащить. Фиксация держит ДЕНЬ, а не позицию в дне; перестановка лишь
            // переназначает planStart В ПРЕДЕЛАХ ТОГО ЖЕ дня (день/замок сохраняются).
            // #4381: начатое задание — «стена», даже без 🔒: перетаскивание не должно сдвигать то,
            // что уже идёт на станке (ни само начатое, ни через него).
            if (cutIsStarted(fc)) return { assignments: [], error: 'started' };
        }
        var assignments = [];
        newOrder.forEach(function(id, idx) {
            var c = byId[id];
            if (Number(c.planDate) !== sorted[idx]) assignments.push({ id: id, planStartTs: sorted[idx] });
        });
        return { assignments: assignments, error: null };
    }

    function cutPlanDayKey(c) {
        // #3249: planDate приходит unix-штампом (DATETIME) — группируем по календарному дню.
        var key = planDateDayKey(c && c.planDate);
        return key === Infinity ? '' : String(key);
    }

    function nextSequenceForCuts(cuts, slitterId, planDate) {
        var sid = String(slitterId == null ? '' : slitterId);
        if (sid === '') return '';
        var day = cutPlanDayKey({ planDate: planDate || '' });
        var max = 0;
        (cuts || []).forEach(function(c) {
            var csid = c && c.slitter && c.slitter.id;
            if (String(csid == null ? '' : csid) !== sid) return;
            if (cutPlanDayKey(c) !== day) return;
            var n = Number(c.sequence);
            if (isFinite(n) && n > max) max = n;
        });
        return max + 1;
    }

    function comparePlanDayKeys(a, b) {
        if (a === '' && b !== '') return 1;
        if (b === '' && a !== '') return -1;
        if (a < b) return -1;
        if (a > b) return 1;
        return 0;
    }

    // Прогресс длительной генерации резок (#3148): целое значение процента 0..100.
    // total ≤ 0 или нечисловые входы → 0; результат клампится в [0, 100].
    function progressPercent(done, total) {
        var d = Number(done), t = Number(total);
        if (!isFinite(d) || !isFinite(t) || t <= 0) return 0;
        var p = Math.round((d / t) * 100);
        if (p < 0) return 0;
        if (p > 100) return 100;
        return p;
    }

    // #3323/#3354 п.2: клик по ЛЮБОМУ месту карточки резки .atex-pp-cut выбирает её
    // (→ боковая панель «Связанные позиции»). Раньше исключались и кнопки ↑/↓/Полосы —
    // из-за этого клик по ним не обновлял .atex-pp-link (старый дефект п.2). Теперь
    // выбор резки идёт через лёгкий selectCut (без пересборки очереди), поэтому клики по
    // кнопкам тоже могут выбирать резку, не закрывая панель полос. Единственное
    // исключение — клики ВНУТРИ самой панели полос .atex-pp-strip-panel (#3354 п.3): она
    // не должна сворачиваться/менять выбор ни от каких событий, кроме своего крестика
    // .atex-pp-strip-close. Чистая (принимает цель клика с .closest) → проверяется
    // модульным тестом без DOM-движка.
    function cutClickSelectsCut(target) {
        if (!target || typeof target.closest !== 'function') return true;
        return !target.closest('.atex-pp-strip-panel');
    }

    // #3638: разбор deep-link из строки запроса (?cut=..&date=..&slitter=..). Ганта
    // (cut-gantt) шлёт сюда дату/станок/задание, чтобы открыть очередь на нужной
    // резке. Чистая → проверяется тестом. Возвращает {cut,date,slitter} (строки).
    function parseDeepLink(search) {
        var s = String(search == null ? '' : search);
        var qm = s.indexOf('?');
        if (qm >= 0) s = s.slice(qm + 1);
        var out = { cut: '', date: '', slitter: '' };
        s.split('&').forEach(function(pair) {
            if (!pair) return;
            var eq = pair.indexOf('=');
            var key = eq >= 0 ? pair.slice(0, eq) : pair;
            var val = eq >= 0 ? pair.slice(eq + 1) : '';
            try { val = decodeURIComponent(val.replace(/\+/g, ' ')); } catch (e) {}
            if (key === 'cut' || key === 'date' || key === 'slitter') out[key] = val;
        });
        return out;
    }

    // #3713: URL рабочего места «Диаграмма Ганта» относительно текущего пути (последний
    // сегмент → cut-gantt). /ateh/production-planning → /ateh/cut-gantt. Вне браузера — дефолт.
    var DEFAULT_GANTT_URL = '/atex/cut-gantt';
    function ganttBaseFromLocation() {
        if (typeof window === 'undefined' || !window.location || !window.location.pathname) return DEFAULT_GANTT_URL;
        var path = String(window.location.pathname).replace(/\/+$/, '');
        var idx = path.lastIndexOf('/');
        return (idx >= 0 ? path.slice(0, idx) : '') + '/cut-gantt';
    }

    // #3713: ссылка на Гант с диапазоном дат фильтра «Дата плана» (?from=..&to=..). Гант
    // открывается ровно этим диапазоном (см. ganttRangeFromTo в cut-gantt). Пустой «По» →
    // to = from (один день). Чистая → проверяется тестом.
    function ganttRangeLink(fromIso, toIso, baseUrl) {
        var base = baseUrl || DEFAULT_GANTT_URL;
        var from = String(fromIso == null ? '' : fromIso).trim();
        var to = String(toIso == null ? '' : toIso).trim();
        var params = [];
        if (from) params.push('from=' + encodeURIComponent(from));
        if (to) params.push('to=' + encodeURIComponent(to));
        else if (from) params.push('to=' + encodeURIComponent(from));
        return params.length ? base + '?' + params.join('&') : base;
    }

    // #3713: иконка-Гант (горизонтальные полосы) для ссылки у фильтра дат.
    var GANTT_ICON_SVG = '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">' +
        '<rect x="1" y="2.5" width="8" height="2.6" rx="1"></rect>' +
        '<rect x="4" y="6.7" width="9" height="2.6" rx="1"></rect>' +
        '<rect x="2" y="10.9" width="6" height="2.6" rx="1"></rect></svg>';

    // ============================================================================
    // #3989 Фаза 1. Целевой алгоритм планирования (ТЗ docs/atex_planning_tz.md).
    // ЧИСТЫЕ функции: веса штрафов из «Настройки» (ATEH), стоимость размещения слота
    // (вес + «качество») и оценка качества плана (факт vs идеал). Аддитивно: движок
    // раскладки пока прежний — эти функции фундамент новой вставочной раскладки.
    // ============================================================================

    // Веса штрафов и лимиты из «Настройки» (ATEH). Значения по умолчанию — из ТЗ §14.
    var PLAN_WEIGHT_DEFAULTS = {
        // KNIVES_INCREASE_COST_MN — ДОПЛАТА сверх KNIVES_CHANGE_COST_MN, когда полос стало больше
        // (#4434 п.5): доставить ножи = 30 + 50 = 80, снять = 30.
        KNIVES_CHANGE_COST_MN: 30, KNIVES_INCREASE_COST_MN: 50, MATERIAL_CHANGE_COST_MN: 15,
        LEADER_COST_MN: 2, FOIL_NOTEND_COST_MN: 60, DEADLINE_COST_MN: 100, EXACT_DEADLINE_COST_MN: 33,
        CHANGE_SLITTER_COST_MN: 3, CHANGE_DAY_COST_MN: 3, SLOT_SPLIT_COST_MN: 2, MAX_DISTANCE_COST_MN: 25,
        MAX_SLOTS_DISTANCE_HR: 24, MAX_OUTAGE_PLANNABLE_HR: 48, DAY_DURATION_MN: 450, INTERVAL_DURATION_MN: 10,
        ORDER_DIFF_PENALTY_MN: 10   // #4194: смежность заказа — штраф за разрыв заказа чужой вставкой / бонус за соседство своего заказа
        // #4454/#4510: РАЗБИЕНИЕ последовательности отдельного веса не имеет. Вставка между двумя
        // соседями, которым переналадка друг относительно друга не нужна, создаёт ДВЕ переналадки
        // с нуля — и ровно столько же стои́т по честной разнице §8.1 (`scorePosition`, зачёт
        // снятого шва): разрывать нечего, зачитывать нечего.
    };
    // Значение веса/лимита: из настроек, иначе дефолт ТЗ. Нечисловое → дефолт.
    function planWeight(settings, key){
        var v = settings ? settings[key] : undefined;
        var n = Number(v);
        return isFinite(n) ? n : PLAN_WEIGHT_DEFAULTS[key];
    }

    // Полосы резки как упорядоченный список РАЗНЫХ ширин по убыванию (раскрой формируется по
    // убыванию ширины — ТЗ §7). Нужен для «качества» перехода и подсчёта числа полос.
    function orderedStripBands(cut){
        var set = {};
        (effKnifeWidths(cut) || []).forEach(function(w){ var n = Number(w); if (isFinite(n) && n > 0) set[String(n)] = 1; });
        return Object.keys(set).map(Number).sort(function(a, b){ return b - a; });
    }
    // Число полос резки (по knifeCount, иначе по числу ненулевых ширин).
    function stripBandCount(cut){
        var n = Number(cut && cut.knifeCount) || 0;
        if (n > 0) return n;
        return (effKnifeWidths(cut) || []).filter(function(w){ var x = Number(w); return isFinite(x) && x > 0; }).length;
    }

    // «Качество» перехода по ножам (ТЗ §8): отношение общего числа полос нового слота к числу
    // полос, совпавших С НАЧАЛА последовательности (ширины по убыванию). Меньше — лучше; всё
    // совпало → 1. Пример: prev 110×3,60×5,40×10 и next 110×3,60×5,30×13 → 3/2. Нет ножей → 0.
    function stripPrefixQuality(prev, next){
        var b = orderedStripBands(next);
        var total = b.length;
        if (total === 0) return 0;
        var a = orderedStripBands(prev), matched = 0, lim = Math.min(a.length, b.length);
        for (var i = 0; i < lim; i++){ if (a[i] === b[i]) matched++; else break; }
        return round3(total / Math.max(matched, 0.5));   // matched 0 → 2×total (худшее), совпали все → 1
    }

    // Нужна ли смена ножей prev→next (набор ширин изменился ИЛИ ролик сузился) — как changeoverParts.
    function knifeChangeNeeded(prev, next){
        if (!prev || !next) return false;
        return knifeMoves(effKnifeWidths(prev), effKnifeWidths(next)) > 0
            || (Number(prev.rollerWidth) || 0) > (Number(next.rollerWidth) || 0);
    }
    // Нужна ли смена сырья/намотки prev→next — тем же мерилом, что и реальные минуты
    // (materialSetupSig, #4481: партия в подпись не входит).
    function materialChangeNeeded(prev, next){
        return materialSetupChanged(prev, next);
    }

    // Стоимость ОДНОГО направленного перехода prev→next (ТЗ §8): вес (минуты штрафа) + «качество».
    // Пунктовые факторы (ножи/сырьё/лидер) — по паре; ситуативные — по контексту от движка:
    //   ctx.settings          — веса из «Настройки»;
    //   ctx.freeAfterCarry     — переход после «хвоста» прошлого дня → смена бесплатна (ТЗ §8, исключение);
    //   ctx.foilNotEnd         — next-фольга не в конце дня и не перед фольгой (§8 п.2а);
    //   ctx.isMove             — это перемещение, а не первичная вставка (§8 п.2б, для фольги);
    //   ctx.placementDayKey    — день размещения (YYYYMMDD) для сравнения со сроком next.dueKey (§8 п.4/5);
    //   ctx.distanceExceeded   — простой между станками > MAX_SLOTS_DISTANCE_HR (§8 п.6).
    function transitionCost(prev, next, ctx){
        ctx = ctx || {};
        var s = ctx.settings || {};
        var byFactor = {}, weight = 0, quality = 0;
        if (prev && next && !ctx.freeAfterCarry){
            if (knifeChangeNeeded(prev, next)){
                // Смена ножей стоит KNIVES_CHANGE; если полос стало БОЛЬШЕ — СВЕРХ этого начисляется
                // KNIVES_INCREASE (ТЗ §8 п.1). Штраф за рост ДОПОЛНИТЕЛЬНЫЙ, а не замена базовой цены:
                // доставить ножи = снять + доплата (по умолчанию 30 + 50 = 80).
                var inc = stripBandCount(next) > stripBandCount(prev);
                var kw = planWeight(s, 'KNIVES_CHANGE_COST_MN') + (inc ? planWeight(s, 'KNIVES_INCREASE_COST_MN') : 0);
                weight += kw; byFactor.knife = kw;
                var q = stripPrefixQuality(prev, next); quality += q; byFactor.knifeQuality = q;
            }
            if (materialChangeNeeded(prev, next)){
                var mw = planWeight(s, 'MATERIAL_CHANGE_COST_MN'); weight += mw; byFactor.material = mw;
            }
            var leaderChanged = String(prev.leader == null ? '' : prev.leader) !== String(next.leader == null ? '' : next.leader)
                || String(prev.sleeveId == null ? '' : prev.sleeveId) !== String(next.sleeveId == null ? '' : next.sleeveId);
            if (leaderChanged){ var lw = planWeight(s, 'LEADER_COST_MN'); weight += lw; byFactor.leader = lw; }
        }
        // Фольга не в конце дня (§8 п.2а) / фольгу двигают (§8 п.2б).
        if (ctx.foilNotEnd){ var fw = planWeight(s, 'FOIL_NOTEND_COST_MN'); weight += fw; byFactor.foilNotEnd = fw; }
        if (ctx.isMove && next && next.isFoil){ var fmw = planWeight(s, 'FOIL_NOTEND_COST_MN'); weight += fmw; byFactor.foilMove = fmw; }
        // Срок (ТЗ §8 п.4/5): ЛОКАЛЬНЫЙ штраф в точке вставки по дню размещения слота.
        //  • день размещения ПОЗЖЕ срока → DEADLINE_COST_MN (опоздание — недопустимо, вытесняется #4047);
        //  • день размещения РАВЕН сроку → EXACT_DEADLINE_COST_MN (в притык, дороже раннего, дешевле опоздания);
        //  • раньше срока (день < срок) → без штрафа.
        // dueKey/placementDayKey — YYYYMMDD, сравнение дат корректно.
        if (ctx.placementDayKey != null && next && isFinite(next.dueKey)){
            var due = Number(next.dueKey), day = Number(ctx.placementDayKey);
            if (day > due){ var dw = planWeight(s, 'DEADLINE_COST_MN'); weight += dw; byFactor.deadline = dw; }
            else if (day === due){ var ew = planWeight(s, 'EXACT_DEADLINE_COST_MN'); weight += ew; byFactor.exactDeadline = ew; }
        }
        // Большой простой между станками (§8 п.6).
        if (ctx.distanceExceeded){ var xw = planWeight(s, 'MAX_DISTANCE_COST_MN'); weight += xw; byFactor.distance = xw; }
        return { weight: round3(weight), quality: round3(quality), byFactor: byFactor };
    }

    // Стоимость ВСТАВКИ слота между prev и next (ТЗ §8): сумма двух переходов prev→slot и slot→next.
    // ctxPrev/ctxNext — контексты каждого перехода (см. transitionCost). → { weight, quality, before, after }.
    function insertionCost(prev, slot, next, ctxPrev, ctxNext){
        var a = transitionCost(prev, slot, ctxPrev);
        var b = transitionCost(slot, next, ctxNext);
        return { weight: round3(a.weight + b.weight), quality: round3(a.quality + b.quality), before: a, after: b };
    }

    // ---- Оценка качества плана (ТЗ §13 + комментарий #3985) --------------------
    // Набор ширин ножей (конфигурация) и сырьё+намотка резки — для подсчёта РАЗНЫХ конфигураций.
    function knifeConfigSig(cut){ return knifeWidthSig(cut); }
    function materialSig(cut){ return String(cut && cut.materialId == null ? '' : cut.materialId).trim() + '|' + normWinding(cut && cut.winding); }

    // Фактические переналадки за два окна + идеальная нижняя граница + близость к идеалу.
    // slots: [{ id, slitterId, dayKey (YYYYMMDD), planStartMs?, knifeWidths|knifeCount, materialId, winding }].
    // opts: { settings, scopeFromKey, scopeToKey, prevSetupBySlitter:{slitterId:{materialId,winding,knifeWidths}} }.
    // → { window:[С;По], all:[С;конец всех задач], ideal/combinations (весь план),
    //     idealWindow/combinationsWindow (окно [С;По], #4013 — панель), qualityWindow, qualityAll }.
    function planQuality(slots, opts){
        opts = opts || {};
        var s = opts.settings || {};
        var fromK = opts.scopeFromKey != null ? Number(opts.scopeFromKey) : -Infinity;
        var toK = opts.scopeToKey != null ? Number(opts.scopeToKey) : Infinity;
        var prevBy = opts.prevSetupBySlitter || {};
        var kChange = planWeight(s, 'KNIVES_CHANGE_COST_MN');
        var kInc = planWeight(s, 'KNIVES_INCREASE_COST_MN');
        var matW = planWeight(s, 'MATERIAL_CHANGE_COST_MN');

        var byMachine = {};
        (slots || []).forEach(function(c){
            var id = String(c.slitterId == null ? '' : c.slitterId);
            (byMachine[id] = byMachine[id] || []).push(c);
        });
        function startKeyOf(c){ var t = Number(c.planStartMs); return isFinite(t) ? t : (Number(c.dayKey) || 0); }

        // Аккумулятор фактики: считает только переналадки, чей день удовлетворяет inWin(dayKey).
        function actualFor(inWin){
            var knifeCount = 0, knifeMin = 0, matCount = 0, matMin = 0, taskCount = 0;
            Object.keys(byMachine).forEach(function(id){
                var seq = byMachine[id].slice().sort(function(a, b){
                    return (Number(a.dayKey) || 0) - (Number(b.dayKey) || 0) || (startKeyOf(a) - startKeyOf(b));
                });
                var prev = null, carrySetup = prevBy[id] || null;   // заправка станка на входе окна
                for (var i = 0; i < seq.length; i++){
                    var cur = seq[i];
                    var win = inWin(Number(cur.dayKey) || 0);
                    if (win) taskCount++;   // число заданий, попавших в окно (тот же предикат, что у переналадок)
                    if (i === 0 && !carrySetup){
                        // Первое задание, до него ничего — заложить наладку ножей + смену сырья (§13 п.4).
                        if (win){
                            if (stripBandCount(cur) > 0){ knifeCount++; knifeMin += kChange; }
                            matCount++; matMin += matW;
                        }
                    } else {
                        var prevForCur = (i === 0) ? carryOverPrevCut(carrySetup, cur) : prev;
                        if (knifeChangeNeeded(prevForCur, cur) && win){
                            knifeCount++;
                            // рост числа полос — доплата KNIVES_INCREASE СВЕРХ базовой смены ножей
                            knifeMin += kChange + (stripBandCount(cur) > stripBandCount(prevForCur) ? kInc : 0);
                        }
                        if (materialChangeNeeded(prevForCur, cur) && win){ matCount++; matMin += matW; }
                    }
                    prev = cur;
                }
            });
            return { knifeCount: knifeCount, knifeMin: round3(knifeMin), materialCount: matCount, materialMin: round3(matMin),
                     changeoverCount: knifeCount + matCount, changeoverMin: round3(knifeMin + matMin), taskCount: taskCount };
        }

        var window = actualFor(function(dk){ return dk >= fromK && dk <= toK; });   // [С; По]
        var all = actualFor(function(dk){ return dk >= fromK; });                   // [С; конец всех задач]

        // Идеал: каждая РАЗНАЯ конфигурация ножей и каждое РАЗНОЕ сырьё настраиваются по 1 разу (§13 п.2).
        // #4008: заодно считаем уникальные КОМБИНАЦИИ «набор ножей + сырьё + намотка» — сколько
        // всего разных настроек резки встречается в плане (диагностика разнородности плана).
        // #4013: помимо идеала/комбинаций ПО ВСЕМУ плану (весь горизонт — для подсказки и qualityAll)
        // считаем их и ПО ОКНУ [С;По]. Панель «Качество плана» сверяет ФАКТ окна с идеалом ОКНА
        // (qualityWindow). Раньше факт окна сверялся с идеалом всего плана → день-выходной без
        // заданий показывал «идеал 48, избыток −48, комбинаций 63» от задач ДРУГИХ дней. Теперь
        // пустое окно → idealWindow 0, combinationsWindow 0, qualityWindow.excess 0. Отрицательный
        // избыток при НЕпустом окне сохраняется (план лучше идеала за счёт заправки станка, §3989-p3).
        function idealFor(inScope){
            var knifeSet = {}, matSet = {}, comboSet = {};
            (slots || []).forEach(function(c){
                if (!inScope(Number(c.dayKey) || 0)) return;
                var ks = knifeConfigSig(c); if (ks !== '') knifeSet[ks] = 1;
                var ms = materialSig(c);
                matSet[ms] = 1;
                comboSet[ks + '::' + ms] = 1;   // #4008: уникальная комбинация ножи+сырьё+намотка
            });
            var K = Object.keys(knifeSet).length, M = Object.keys(matSet).length;
            // #4029: конфигурация, УЖЕ СТОЯЩАЯ на станке на входе окна (заправка prevSetupBySlitter
            // либо последняя дозадача до окна), в ИДЕАЛЕ наладки не требует — ровно как факт
            // (actualFor) засчитывает её бесплатной первой наладкой. Раньше идеал считал эту наладку
            // «с нуля»: план, где задачи ПРОДОЛЖАЮТ заправку (факт 0 переналадок), сверялся с идеалом
            // «сколько-то часов» → ОТРИЦАТЕЛЬНЫЙ избыток, будто «план лучше идеала». Так быть не может.
            // Кредитуем УНИКАЛЬНЫЕ входные сигнатуры (ножи/сырьё), реально встречающиеся в окне →
            // избыток ≥ 0 = истинный минимум переналадок ПРИ ТЕКУЩЕЙ ЗАПРАВКЕ.
            var preKnife = {}, preMat = {};
            Object.keys(byMachine).forEach(function(mid){
                var mseq = byMachine[mid].slice().sort(function(a, b){
                    return (Number(a.dayKey) || 0) - (Number(b.dayKey) || 0) || (startKeyOf(a) - startKeyOf(b));
                });
                var entry = prevBy[mid] ? carryOverPrevCut(prevBy[mid], mseq[0] || {}) : null;
                for (var i = 0; i < mseq.length; i++){
                    if (inScope(Number(mseq[i].dayKey) || 0)) break;   // первая задача В ОКНЕ — стоп
                    entry = mseq[i];                                    // дозадача до окна → новый вход станка
                }
                if (!entry) return;
                var ek = knifeConfigSig(entry); if (ek !== '' && knifeSet[ek]) preKnife[ek] = 1;
                var em = materialSig(entry); if (matSet[em]) preMat[em] = 1;
            });
            // knifeConfigs/materials остаются СЫРЫМ разнообразием плана (инвариант #4008
            // combos ≤ ножи×сырьё). Кредит заправки уменьшает лишь count/minutes — «сколько наладок
            // РЕАЛЬНО нужно при текущей заправке» (это и есть идеал панели, и база избытка в ratio()).
            var kNeed = K - Object.keys(preKnife).length; if (kNeed < 0) kNeed = 0;
            var mNeed = M - Object.keys(preMat).length; if (mNeed < 0) mNeed = 0;
            return {
                ideal: { knifeConfigs: K, materials: M, count: kNeed + mNeed, minutes: round3(kNeed * kChange + mNeed * matW) },
                combinations: Object.keys(comboSet).length   // #4008
            };
        }
        var idAll = idealFor(function(){ return true; });                        // весь план
        var idWin = idealFor(function(dk){ return dk >= fromK && dk <= toK; });   // окно [С;По] (#4013)
        var ideal = idAll.ideal, combinations = idAll.combinations;

        function ratio(actual, id){
            return {
                count: id.count > 0 ? round3(actual.changeoverCount / id.count) : 0,
                minutes: id.minutes > 0 ? round3(actual.changeoverMin / id.minutes) : 0,
                excessCount: actual.changeoverCount - id.count,
                excessMin: round3(actual.changeoverMin - id.minutes)
            };
        }
        return {
            window: window, all: all,
            ideal: ideal, combinations: combinations,                             // весь план (подсказка, qualityAll)
            idealWindow: idWin.ideal, combinationsWindow: idWin.combinations,      // окно [С;По] (#4013 — панель)
            qualityWindow: ratio(window, idWin.ideal),   // #4013: факт окна vs идеал ОКНА (было — vs весь план)
            qualityAll: ratio(all, ideal)                // факт горизонта vs идеал всего плана
        };
    }

    // #3989 Фаза 3: качество плана из резок контроллера (mapCutRecord) — маппинг в слоты
    // planQuality (ТЗ §13). cuts — this.cuts; opts.{settings,scopeFromKey,scopeToKey,prevSetupBySlitter}.
    function planQualityView(cuts, opts){
        opts = opts || {};
        var slots = (cuts || []).map(function(c){
            return {
                id: c && c.id,
                slitterId: c && c.slitter && c.slitter.id,
                dayKey: planDateDayKey(c && c.planDate),
                planStartMs: Number(c && c.planStart) || 0,
                knifeWidths: c && c.knifeWidths, knifeCount: c && c.knifeCount,
                materialId: c && c.materialId, winding: c && c.winding, dueKey: c && c.dueKey
            };
        });
        return planQuality(slots, {
            settings: opts.settings,
            scopeFromKey: opts.scopeFromKey, scopeToKey: opts.scopeToKey,
            prevSetupBySlitter: opts.prevSetupBySlitter
        });
    }
    // #3989 Фаза 3: короткая подпись избытка «+N» / «0» / «−N» (минус — план лучше идеала).
    function formatQualityDelta(n){
        var v = Number(n) || 0;
        return (v > 0 ? '+' : (v < 0 ? '−' : '')) + Math.abs(v);
    }

    // #3998: пул с ограничением параллелизма. Гоняет thunks (каждый → Promise) не более `limit`
    // одновременно — генерация заданий бьёт независимые серии запросов по резкам (создание
    // резки → её «Партии ГП»/втулки/обеспечения последовательны ВНУТРИ резки, но разные резки
    // независимы), а порядок в базе неважен (сортировка по planStart/первой колонке 1078, #4000).
    // Семантика ошибки как у прежней последовательной цепочки: при первом реджекте новые задачи
    // НЕ запускаются, уже запущенные (до `limit`) дорабатывают, затем пул реджектится ПЕРВОЙ
    // ошибкой. Чистая, синхронно-безопасная (JS однопоточен) — покрыта тестом.
    function runWithConcurrency(thunks, limit) {
        var tasks = Array.isArray(thunks) ? thunks.slice() : [];
        return new Promise(function(resolve, reject) {
            if (!tasks.length) { resolve(); return; }
            var max = Math.max(1, Math.min(Number(limit) || 1, tasks.length));
            var next = 0, active = 0, failed = false, firstError = null, settled = false;
            function settle() {
                if (settled) return;
                settled = true;
                if (firstError) reject(firstError); else resolve();
            }
            function pump() {
                if (settled) return;
                if (active === 0 && (failed || next >= tasks.length)) { settle(); return; }
                while (!failed && active < max && next < tasks.length) {
                    var thunk = tasks[next++];
                    active += 1;
                    Promise.resolve().then(thunk).then(function() {
                        active -= 1; pump();
                    }, function(err) {
                        active -= 1;
                        if (!firstError) firstError = err;
                        failed = true;
                        pump();
                    });
                }
            }
            pump();
        });
    }

    // #4477 (ТЗ §15): ОДНО число потоков массовой записи на весь модуль. Раньше «5» лежало
    // отдельной локальной переменной в каждом месте записи (MAX_PARALLEL_SAVES / _DELETES /
    // _SETUP / _SPLIT), а часть путей вообще писала цепочкой в один поток — правило «в 5 потоков»
    // соблюдал тот, кто про него помнил. Теперь предел один и его видно из любого места.
    var MAX_PARALLEL_WRITES = 5;

    // #4477 (ТЗ §15): ОТСЕВ ЗАПИСЕЙ-ПУСТЫШЕК для «Времени старта» (главное значение t{tableId},
    // пишется только через _m_save — GUIDE issue #775). Команда на сохранение значения, которое
    // уже лежит в базе, — это лишний запрос: оператор видит «много запросов на простое изменение»
    // (issue #4477), а очередь ждёт их завершения. Тайминг («Наладка ножей»/«Сырьё-намотка»/
    // «Резка и Лидер») отсеивается там же, где считается, — computeCutSetupUpdates (#4001/#3778).
    //   items      — [{ cutId, ts, wasTs }]; wasTs можно не задавать — возьмём из storedById;
    //   storedById — карта id → запись очереди (this.cuts), хранимый старт = planDate, иначе number.
    // → [{ cutId, ts, wasTs }] только реально изменившихся, по одной записи на задание (дубль по
    // одному id в параллельном пуле — гонка «кто последний», поэтому оставляем ПЕРВЫЙ).
    // Чистая функция: вход не мутирует, DOM/сети не касается.
    function changedStartWrites(items, storedById) {
        var out = [], seen = {};
        (items || []).forEach(function(it) {
            if (!it || it.cutId == null) return;
            var id = String(it.cutId);
            if (id === '' || seen[id]) return;
            var ts = Math.round(Number(it.ts));
            if (!isFinite(ts) || ts <= 0) return;
            var was = it.wasTs;
            if (was == null && storedById) {
                var c = storedById[id];
                if (c) was = (c.planDate != null && c.planDate !== '') ? c.planDate : c.number;
            }
            var wasNum = planTsSeconds(was);   // хранимое приходит и секундами, и мс, и строкой даты
            if (wasNum != null && wasNum > 0 && wasNum === ts) return;   // не изменилось — команды не даём
            seen[id] = true;
            out.push({ cutId: id, ts: ts, wasTs: (wasNum != null && wasNum > 0) ? wasNum : null });
        });
        return out;
    }

