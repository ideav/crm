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
    var KNIFE_SCALE = 8;     // нормировка ножевой компоненты (переставленных ножей до «максимума»)
    var WIDTH_SCALE = 100;   // нормировка ширины (мм «сужения» до «максимума»)
    var REMAINDER_OK_M = 600;
    var FATIGUE_MACHINE_WIDTH_MM = 1600;  // базовая ширина вала для оценки числа ножей (#3270/#3272)
    var FATIGUE_FACTOR = 2.0;             // alpha: штраф последней позиции = 1 + alpha
    var FATIGUE_START_COST_MIN = 45;      // условная стоимость старта маршрута, мин
    var PLANNING_STRATEGY_SETUP = 'setup';
    var PLANNING_STRATEGY_FATIGUE = 'fatigue';

    function normWinding(v){ var s = String(v == null ? '' : v).trim().toUpperCase(); return (s === 'IN' || s === 'OUT') ? s : ''; }

    // Симметрическая разность мультимножеств ширин (сколько ножей переставить). Терпимо к числам/строкам.
    function widthSetDistance(a, b){
        function tally(arr){ var m = {}; (arr || []).forEach(function(x){ var k = String(Number(x)); m[k] = (m[k] || 0) + 1; }); return m; }
        var ma = tally(a), mb = tally(b), keys = {}, d = 0;
        Object.keys(ma).forEach(function(k){ keys[k] = 1; });
        Object.keys(mb).forEach(function(k){ keys[k] = 1; });
        Object.keys(keys).forEach(function(k){ d += Math.abs((ma[k] || 0) - (mb[k] || 0)); });
        return d;
    }

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

    // Неудобный остаток джамбо: 0 < m < REMAINDER_OK_M (не дорезан до ≈0 и не оставлен крупным).
    function awkwardRemainder(m){ var x = Number(m); return !isNaN(x) && x > 1e-6 && x < REMAINDER_OK_M; }

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

    function changeoverParts(prev, next, times){
        var t = times || DEFAULT_OP_TIMES;
        var matWind = Number(t.MATERIAL_WINDING != null ? t.MATERIAL_WINDING : DEFAULT_OP_TIMES.MATERIAL_WINDING) || 0;
        var knifeTime = Number(t.KNIFE != null ? t.KNIFE : DEFAULT_OP_TIMES.KNIFE) || 0; // #3600: фикс. время любой смены ножей (по умолч. 30 мин), независимо от числа ножей
        var parts = [];
        if (!prev || !next) return parts;
        var matWindChange = String(prev.materialId) !== String(next.materialId)
            || normWinding(prev.winding) !== normWinding(next.winding)
            || String(prev.batchId) !== String(next.batchId);
        // #3600: любая смена набора ножей ИЛИ сужение ролика → ФИКСИРОВАННО KNIFE (30 мин)
        // «на всё вместе», независимо от числа переставленных ножей (раньше #3472: стоимость =
        // KNIFE_MOVE × число перестановок). Смена сырья/намотки считается отдельно (ниже).
        // Бинарно: изменился набор ножей (knifeMoves>0) ИЛИ сузился ролик → одна переналадка ножей.
        // #3688: порядок операций — СНАЧАЛА настройка ножей, ПОТОМ смена сырья (так на станке).
        var moves = knifeMoves(effKnifeWidths(prev), effKnifeWidths(next));
        var knifeChanged = moves > 0 || (Number(prev.rollerWidth) || 0) > (Number(next.rollerWidth) || 0);
        if (knifeChanged && knifeTime > 0) parts.push({ code: 'KNIFE', label: 'смена ножей / сужение ролика', minutes: round3(knifeTime) });
        if (matWindChange && matWind > 0) parts.push({ code: 'MATERIAL_WINDING', label: 'смена сырья / намотки / партии', minutes: round3(matWind) });
        return parts;
    }

    // #3688: текущая заправка станка из отчёта prev_cut_setup → { materialId, winding,
    // knifeWidths, knifeCount } по верхней (последней по task_start) задаче станка. rows —
    // строки отчёта (фильтруем по slitterId, если задан). Сравниваем материал/намотку/набор
    // ножей (НЕ партию). Нет строк → null. Вход не мутируется.
    function prevSetupFromRows(rows, slitterId) {
        var sid = String(slitterId == null ? '' : slitterId);
        var byTask = {};
        (rows || []).forEach(function(r) {
            if (sid !== '' && String(r.slitter_id) !== sid) return;
            var tid = String(r.task_id == null ? '' : r.task_id);
            if (tid === '') return;
            var ts = Number(r.task_start) || 0;
            if (!byTask[tid]) byTask[tid] = { start: ts, widths: [], material: '', winding: '' };
            var rec = byTask[tid];
            if (ts > rec.start) rec.start = ts;
            var w = Number(r.width) || 0;
            if (w > 0) rec.widths.push(w);
            if (rec.material === '' && r.material_id != null && String(r.material_id) !== '') rec.material = String(r.material_id);
            if (rec.winding === '' && r.wind_dir) rec.winding = normWinding(r.wind_dir);
        });
        var top = null;
        Object.keys(byTask).forEach(function(tid) {
            if (top === null || byTask[tid].start > byTask[top].start) top = tid;
        });
        if (top === null) return null;
        var rec = byTask[top];
        return { materialId: rec.material, winding: rec.winding, knifeWidths: rec.widths.slice(), knifeCount: rec.widths.length };
    }

    // #3688: синтетическая «предыдущая резка» для расчёта переналадки ПЕРВОЙ резки очереди
    // станка от его текущей заправки (prevSetup, из prev_cut_setup). Партию нейтрализуем
    // (= как у next) — сравниваем лишь материал/намотку/ножи, как задаёт отчёт. Нет данных
    // (null) → пустой станок: материал/намотка/ножи отличны → полный сетап (смена сырья +
    // настройка ножей с нуля). nextCut нужен только для нейтрализации партии.
    function carryOverPrevCut(prevSetup, nextCut) {
        if (!nextCut) return null;
        var batchId = (nextCut.batchId == null ? '' : nextCut.batchId);
        if (!prevSetup) {
            return { materialId: ' none', winding: ' none', batchId: batchId,
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

    // #3669 п.2: первая задача дня требует НАСТРОЙКИ НОЖЕЙ (их ставят с нуля). Для первой
    // задачи каждого дня, кроме первого, настройка уже считается переналадкой с последней
    // задачей предыдущего дня (changeoverParts) — «той же конфигурацией → 0». А у самой
    // первой задачи загруженной очереди предыдущего дня нет (история не подгружена), поэтому
    // настройку планируем консервативно (лучше учесть время, чем потерять). Включается флагом
    // firstCutSetup (см. buildSchedule/splitMachineQueue/setupBreakdown); возвращает компонент
    // KNIFE как у changeoverParts. [] — если у резки нет ножей или время KNIFE = 0.
    function firstSetupParts(next, times){
        var t = times || DEFAULT_OP_TIMES;
        var knifeTime = Number(t.KNIFE != null ? t.KNIFE : DEFAULT_OP_TIMES.KNIFE) || 0;
        if (!next || !(knifeTime > 0)) return [];
        var hasKnives = (Number(next.knifeCount) || 0) > 0 || ((next.knifeWidths || []).length > 0);
        return hasKnives ? [{ code: 'KNIFE', label: 'настройка ножей', minutes: round3(knifeTime) }] : [];
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

    // #4111: как разложить наладку setup-only ХВОСТА дня (0 проходов, #3635 п.5) между текущим днём N
    // и продолжением (день N+1), чтобы хвост НЕ вылезал за потолок нахлёста НАСТРОЙКИ
    // (cutEndMin + MAX_OVERWORK_TUNE). Считает ХРАНИМЫЕ колонки УЖЕ СУЩЕСТВУЮЩЕГО хвоста-задания
    // (computeCutSetupUpdates, #4030/#4042) — что оператор увидит в карточке дня N. Роднит с
    // splitMachineQueue (minOverlapTailSetupMinutes + гейт availFor 'tune'), но работает с ДВУМЯ
    // именованными компонентами (ножи/сырьё) — чтобы поделить их по колонкам «Наладка ножей»/
    // «Сырье/намотка». ОТЛИЧИЕ от генерации плана (splitMachineQueue #3939): та решает, СОЗДАВАТЬ ли
    // хвост вообще (нет — вся резка одной карточкой на завтра); здесь хвост УЖЕ ЕСТЬ, поэтому пустым
    // (все нули) его не оставляем — держим максимум влезающей наладки (#4116). В дне N оставляем
    // МИНИМАЛЬНОЕ подмножество,
    // добивающее день до cutEndMin, — но только если оно кончается ≤ потолка нахлёста. Если ни одно
    // подмножество не добивает день без выхода за потолок — оставляем в дне N НАИБОЛЬШЕЕ подмножество,
    // которое ещё влезает под потолок (максимум наладки в дне N, минимум на продолжение), и лишь когда
    // даже минимальный компонент вылезает за потолок — в дне N НИЧЕГО, вся наладка на продолжение.
    //   tailStartMin — минута старта хвоста (planStart, от полуночи дня); knifeMin/materialMin —
    //   компоненты наладки; cutEndMin/overTuneMin — окно (мин от полуночи / нахлёст настройки).
    // → { keepKnife, keepMaterial } — что ОСТАЁТСЯ в дне N (остальное уносится на продолжение).
    // Нет окна (cutEndMin/tailStartMin не число) → держим всё в дне N (прежнее поведение, без окна).
    // #4116: раньше при room 31–34 (напр. cutEnd 16:13, хвост 15:40) minOverlap требовал ВСЮ наладку 45
    // (ни ножи 30, ни сырьё 15 по отдельности не добивали день), а 45 вылезала за потолок → в дне N
    // клали НИЧЕГО, хотя ножи 30 кончались 16:10 ДО cutEnd (0 нахлёста). Симптом: пустое задание, вся
    // наладка (в т.ч. настройка ножей, которая влезала) уезжала на следующий день.
    function splitTailSetupAtCeiling(tailStartMin, knifeMin, materialMin, cutEndMin, overTuneMin) {
        var k = Math.max(0, Math.round(Number(knifeMin) || 0));
        var m = Math.max(0, Math.round(Number(materialMin) || 0));
        if (k + m <= 0) return { keepKnife: 0, keepMaterial: 0 };
        var start = Number(tailStartMin), cutEnd = Number(cutEndMin);
        if (!isFinite(start) || !isFinite(cutEnd)) return { keepKnife: k, keepMaterial: m };
        var room = cutEnd - start;                                   // до конца окна резки (цель заполнения)
        var ceilingRoom = room + (Number(overTuneMin) || 0);         // до потолка нахлёста настройки
        // Подмножества {ножи?, сырьё?} по возрастанию суммы (как перебор minOverlapTailSetupMinutes).
        var subsets = [
            { s: m,     keepKnife: 0, keepMaterial: m },
            { s: k,     keepKnife: k, keepMaterial: 0 },
            { s: k + m, keepKnife: k, keepMaterial: m }
        ].filter(function(x){ return x.s > 0; }).sort(function(a, b){ return a.s - b.s; });
        // Кандидаты — только подмножества, кончающиеся ≤ потолка нахлёста настройки (иначе выход за потолок).
        var underCeiling = subsets.filter(function(x){ return x.s <= ceilingRoom; });
        if (!underCeiling.length) return { keepKnife: 0, keepMaterial: 0 };   // даже минимум за потолок → всё на продолжение
        // Минимальное подмножество, добивающее день до cutEndMin (minOverlap, минимальный нахлёст);
        // #4116: нет такого (ни одно не добивает под потолком) → НАИБОЛЬШЕЕ влезающее (максимум в дне N).
        var chosen = null;
        for (var i = 0; i < underCeiling.length; i++) { if (underCeiling[i].s >= room) { chosen = underCeiling[i]; break; } }
        if (!chosen) chosen = underCeiling[underCeiling.length - 1];   // subsets по возрастанию → последний = наибольший под потолком
        return { keepKnife: chosen.keepKnife, keepMaterial: chosen.keepMaterial };
    }

    // #3698: активности переналадки на каждую резку упорядоченной очереди ОДНОГО станка
    // (порядок исполнения — по planStart, как в Ганте orderCutsInGroup, #3923). Первая резка —
    // от текущей заправки станка (carryPrevCut из prev_cut_setup, строится вызывающим через
    // carryOverPrevCut); нет заправки (carryPrevCut=null) → настройка ножей с нуля
    // (firstCutSetup). Зеркалит ветку setup в buildSchedule. → { cutId: { knifeMin, materialWindingMin } }.
    // Чистая (тест).
    function setupActivityColumns(orderedCuts, times, carryPrevCut){
        var out = {};
        (orderedCuts || []).forEach(function(c, i){
            var prev = i > 0 ? orderedCuts[i - 1] : (carryPrevCut || null);
            var opts = (i === 0 && !carryPrevCut) ? { firstCutSetup: true } : null;
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
    function parseActualWidthCode(code) {
        var c = String(code == null ? '' : code).trim().toLowerCase().replace(/\s+/g, '');
        if (!c) return { key: '', op: '', val: 0 };           // безусловно
        var m = c.match(/^([js])(>=|<=|=|>|<)(\d+(?:\.\d+)?)$/);
        if (!m) return { key: '?', op: '', val: 0 };          // нераспознан → не применяем
        return { key: m[1], op: m[2], val: Number(m[3]) };
    }

    // ctx: { jumbo, inches } (любое поле может быть null/undefined). key 'j' →
    // сверяем с jumbo (ширина джамбо), 's' → с inches (дюймы втулки).
    // '' → всегда true; '?' → всегда false (жёсткий фильтр).
    function actualWidthCodeMatches(parsed, ctx) {
        if (!parsed || parsed.key === '') return true;
        if (parsed.key === '?') return false;
        var v = parsed.key === 'j' ? (ctx && ctx.jumbo) : (ctx && ctx.inches);
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

    function finishedBatchesForLayout(layout, cutId, runLength, plannedRuns) {
        var runs = Number(plannedRuns) || plannedRunsForLayout(layout, {});
        var len = Number(runLength) || 0;
        var out = [];
        (layout && layout.strips || []).forEach(function(s) {
            if (!isStockStrip(s)) return;
            var width = Number(s.width) || 0;
            var rolls = round3((Number(s.qty) || 0) * runs);
            if (width <= 0 || rolls <= 0) return;
            out.push({ cutId: String(cutId), width: width, rolls: rolls, length: len });
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
        return pts;
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

    // #3606: точки намотки для конкретной резки — фольговые при cut.isFoil (если серия
    // WIND_FOIL_ задана), иначе обычные. windPoints.foil прикреплён в windingPointsFromTimes.
    function windPointsForCut(isFoil, windPoints){
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
        if (p.length < 2) return round3(p[p.length-1].min);
        var a = p[p.length-2], b = p[p.length-1];
        var slope = (b.min - a.min) / (b.m - a.m);
        return round3(b.min + slope * (x - b.m));
    }

    function plannedCutDurationMinutes(runMeters, plannedRuns, opTimes, isFoil) {
        var runs = Number(plannedRuns) || 0;
        if (runs <= 0) return 0;
        var pts = windPointsForCut(isFoil, windingPointsFromTimes(opTimes || {})); // #3606: фольга — своя норма
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
            .map(function(n){ return (n.foil ? 'WIND_FOIL_' : 'WIND_') + formatTimingNumber(n.m) + '=' + formatTimingNumber(n.min) + ' мин'; });
        if (!items.length) return '';
        if (items.length === 1) return 'Норма намотки: ' + items[0];
        return 'Нормы намотки: ' + items.join('; ') + ' (интерполяция)';
    }

    function formatTimingNumber(value) {
        return String(round3(Number(value) || 0));
    }

    function cutTimingDetails(runMeters, plannedRuns, opTimes, isFoil) {
        var length = stripNum(runMeters);
        var runs = stripNum(plannedRuns);
        if (!(length > 0) || !(runs > 0)) return '';
        var points = windPointsForCut(isFoil, windingPointsFromTimes(opTimes || {})); // #3606: фольга — своя норма
        if (!points.length) return '';
        var oneRun = windingMinutes(length, points);
        if (!(oneRun > 0)) return '';
        // #4006: лидер между резками (BETWEEN_CUTS) заправляется ПОСЛЕ каждого прохода —
        // включаем его в тайминг прохода, чтобы «Итого резка» отражало полное время окна
        // (намотка + лидер), а не только намотку. Норма намотки остаётся отдельной строкой.
        var t = opTimes || {};
        var leaderUnit = Number(t.BETWEEN_CUTS != null ? t.BETWEEN_CUTS : DEFAULT_OP_TIMES.BETWEEN_CUTS) || 0;
        var perPassFull = round3(oneRun + leaderUnit);
        var total = round3(perPassFull * runs);
        if (!(total > 0)) return '';
        return [
            'Метраж прохода: ' + formatTimingNumber(length) + ' м',
            'Плановых проходов: ' + formatTimingNumber(runs),
            formatWindingNorms(relevantWindingNorms(length, points)),
            'Намотка и лидер: ' + formatTimingNumber(perPassFull) + ' мин',
            'Итого резка: ' + formatTimingNumber(perPassFull) + ' * ' + formatTimingNumber(runs) + ' = ' + formatTimingNumber(total) + ' мин'
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
        // #4006: лидер (BETWEEN_CUTS) заправляется после каждого прохода — показываем полное время
        // прохода «Намотка и лидер» и включаем лидер в «Итого резка» (а не отдельной строкой ниже).
        // Норма намотки — отдельной строкой выше. Лидер на проход = leaderMin/runs (leaderMin = база×runs).
        var leaderMin = round3(Number(ctx.leaderMin) || 0);
        var perPassFull = round3(oneRun + (runs > 0 ? leaderMin / runs : 0));
        var totalFull = round3(perPassFull * runs);   // #4006: «X * N = Y» самосогласовано (Y от округлённого X)
        if (!setupOnly) {
            var normLine = formatWindingNorms(ctx.norms);
            if (normLine) lines.push({ text: normLine });
            lines.push({ text: 'Намотка и лидер: ' + formatTimingNumber(perPassFull) + ' мин' });
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
        lines.push({
            text: cutPrefix + 'Итого резка: ' + formatTimingNumber(perPassFull) + ' * ' + formatTimingNumber(runs) + ' = ' + formatTimingNumber(totalFull) + ' мин',
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
        var pts = windPointsForCut(cut && cut.isFoil, windPoints); // #3606: фольга — своя норма намотки
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
        var oneRun = windingMinutes(runMeters, windPointsForCut(cut && cut.isFoil, windPoints)); // #3606: фольга — своя норма
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
    function nextFreeWorkMinute(from, len, blocked, dayStart, dayEnd, fitEnd, movedInit, skipCeiling) {
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
            if (within >= dayEnd) { m = (day + 1) * 1440 + dayStart; moved = true; continue; }
            // #3907: сегмент должен влезть в рабочее окно дня ЦЕЛИКОМ. Конец за fitEnd, а сам
            // сегмент в день влезает (L ≤ dayCap) → на начало следующего дня. Только для сдвинутого
            // простоем сегмента (#3934). Сегмент длиннее целого окна разбить нельзя — кладём как есть.
            // #4021: setup-only хвост дня (skipCeiling) — намеренный нахлёст #3635 п.5, потолком НЕ
            // выталкиваем (иначе встык-курсор, нудживший хвост на 1 мин, делал movedInit=true и хвост
            // уезжал за конец смены — а перед выходными за все выходные, оседая ОДИНОКОЙ наладкой на
            // понедельник и вытесняя #3951 весь дневной объём на вторник: день «недогружен, только наладка»).
            // Блоки простоя (ниже) хвост по-прежнему обходит; выталкивание касается лишь проходов (#3907).
            if (moved && !skipCeiling && hasFit && (within + L > endLimit) && (L <= dayCap)) { m = (day + 1) * 1440 + dayStart; continue; }
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
            var placed = nextFreeWorkMinute(ws, len, blocked, dayStart, dayEnd, fitEnd, cursorMoved, skipCeiling);
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
            // prev_cut_setup: тот же материал/намотка/ножи → 0); нет данных → настройка ножей
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
            items.push({
                cutId: String(c.id),
                windowStartMin: round3((tsSec * 1000 - base) / 60000),   // окно = начало настройки
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
            out.push({
                cutId: it.cutId,
                startMin: startMin,
                finishMin: finishMin,
                setupMin: it.setupMin,
                durationMin: it.durationMin,
                // Лидер уже включён в durationMin (storedCutAndLeaderMin = намотка + лидер, #3700) —
                // отдельной величины в сохранённом нет. null (а не 0): окно/минуты считают его 0
                // (не двойной счёт), а модалка тайминга (buildCutTimingCtx) оценивает лидер для
                // СВОЕЙ разбивки, не трогая расписание очереди/Ганта.
                leaderMin: null
            });
        });
        return out;
    }

    // #3846: блоки «Обед» для отображения — выводим обед как видимый разрыв между резками
    // одного рабочего дня (раньше cut-gantt/очередь его не рисовали → выглядел как пустая
    // «дыра в планировании»). Обед уже сидит в сохранённых planStart: между концом окна одной
    // резки и началом окна следующей в ТОМ ЖЕ дне образуется зазор ≈ длительности обеда вокруг
    // LUNCH_START. Берём такой зазор как обед. schedule — из scheduleFromStored/buildSchedule
    // (отсортируем сами). opts: { lunchStartMin, lunchDurationMin, shiftStartMin }. Пустой обед
    // (lunchDurationMin ≤ 0) → []. → [{ day, startMin, finishMin, durationMin }] (минуты от
    // полуночи дня 0), по одному на день, где обед реально вставлен.
    function lunchBlocksFromSchedule(schedule, opts) {
        opts = opts || {};
        var lunchDur = Number(opts.lunchDurationMin) || 0;
        if (!(lunchDur > 0)) return [];
        var lunchStart = Number(opts.lunchStartMin);   // #3909: 12:20 (мин от полуночи); NaN → привязка к зазору
        var hasFixed = isFinite(lunchStart);
        var segs = (schedule || []).slice().filter(function(s) {
            return s && isFinite(Number(s.startMin));
        }).sort(function(a, b) { return a.startMin - b.startMin; });
        var byDay = {};
        var prevCutByDay = {};   // #3909: cutId задания, после которого идёт зазор (несущее обед)
        var lunchByDay = {};
        segs.forEach(function(s) {
            var winStart = Number(s.startMin) - (Number(s.setupMin) || 0);   // начало окна (настройки)
            var winEnd = Number(s.finishMin) + (Number(s.leaderMin) || 0);
            var day = Math.floor(winStart / 1440);
            var prevEnd = byDay[day];
            // Зазор внутри дня после предыдущей резки = обед (учтён только раз на день).
            if (prevEnd != null && !lunchByDay[day]) {
                var gap = winStart - prevEnd;
                // Зазор сопоставим с обедом (терпимо к округлению; «через обед» режется по
                // длительности): берём, если он не меньше почти полного обеда. finishMin (= НАЧАЛО
                // послеобеденной резки) остаётся КЛЮЧОМ привязки строки обеда к карточке.
                if (gap >= lunchDur - 1) {
                    // #3909: при известном LUNCH_START ПОКАЗЫВАЕМ обед в 12:20 (внутри несущего его
                    // задания prevCutByDay), а не в зазоре после него; carrierCutId — это задание.
                    // LUNCH_START неизвестен → показываем в зазоре (dispStart = startMin), как было.
                    var dispStart = hasFixed ? round3(day * 1440 + lunchStart) : round3(winStart - lunchDur);
                    lunchByDay[day] = {
                        day: day,
                        startMin: round3(winStart - lunchDur), finishMin: round3(winStart),   // ключ привязки (зазор)
                        dispStartMin: dispStart, dispFinishMin: round3(dispStart + lunchDur),  // #3909: показываемое время
                        carrierCutId: hasFixed && prevCutByDay[day] != null ? String(prevCutByDay[day]) : null,
                        durationMin: lunchDur
                    };
                }
            }
            if (byDay[day] == null || winEnd > byDay[day]) byDay[day] = winEnd;
            prevCutByDay[day] = s.cutId;   // #3909: для зазора следующего задания дня
        });
        return Object.keys(lunchByDay).map(function(d) { return lunchByDay[d]; });
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
                if (B.kind === 'break') {
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
            var fitEnd = overworkOn ? (dayEnd + maxOverworkCuts) : dayEnd;
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
                overhangTail: function(s) { return !!s.setupOnly; }   // #4021: setup-only хвост дня — намеренный нахлёст (#3635 п.5), не выталкивать потолком
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
            return (sum < capacity) ? sum : 0;   // полный блок окна — не наш случай (см. выше)
        }
        // До вставки обеда доступную ёмкость дня уменьшаем на длительность обеда (резерв):
        // если обед не получится поставить паузой между резками, день закончится раньше.
        // #3978: и на простой внутри окна (dayLostToBlock).
        function effCapacity(d) { return ((lunch && !lunchDone[d]) ? (capacity - lunch.durationMin) : capacity) - dayLostToBlock(d); }
        // #3847: доступные минуты от текущего clock до потолка нахлёста для дня d. kind='cuts' —
        // потолок DAY_END_HOUR+maxOverworkCuts (для проходов), 'tune' — DAY_END_HOUR+maxOverworkTune
        // (для настройки). Минус резерв обеда (как effCapacity). Фича выключена → обычная ёмкость до
        // cutEndMin (effCapacity−clock), поведение не меняется. clock/lunchDone — из замыкания.
        function availFor(d, kind) {
            var base = effCapacity(d) - clock;
            if (!overworkOn || !hasWindow) return base;
            var lunchRes = (lunch && !lunchDone[d]) ? lunch.durationMin : 0;
            var margin = (kind === 'tune') ? maxOverworkTune : maxOverworkCuts;
            // #3909/#3910: нахлёст добавляем к cutEndMin (dayEnd = DAY_END_HOUR−TOTAL_INTERVALS),
            // а НЕ к DAY_END_HOUR. Последнее задание дня обязано кончиться ≤ cutEndMin+margin
            // (резка → +MAX_OVERWORK_CUTS, настройка → +MAX_OVERWORK_TUNE). Раньше базой был
            // dayEndHour (16:30), и день паковался до 16:35+, копя 475–494 раб. мин (#3910 «494
            // мин во 2 июле»). Теперь потолок 16:15 (резка) / 16:20 (настройка) — буфер уборки
            // (TOTAL_INTERVALS) поглощает нахлёст, а не растёт за конец смены.
            // #3978: минус простой внутри окна дня (dayLostToBlock) — как в effCapacity.
            return (dayEnd - dayStart) + margin - lunchRes - dayLostToBlock(d) - clock;
        }
        // #3974: якорь дня несёт ТОЛЬКО «Зафиксировано» (🔒) — фикс-резка держит свой день
        // (fixedDay ниже). Свободные задания якоря не имеют (dayAnchorByCut #3658 отменён): день
        // раскладки начинаем с «С» (day 0) и плотно набиваем вперёд. Фикс-резку с днём РАНЬШЕ «С»
        // (fixedDay < 0) не размещаем — цикл идёт только вперёд от 0, и она остаётся как есть.
        var anchorByCut = opts.dayAnchorByCut || {};
        var segments = [];
        var day = 0, clock = 0;   // clock — минут занято в текущем дне (от dayStart)
        var prevPhysical = null;                     // предыдущая ФИЗИЧЕСКАЯ резка (для переналадки)
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
        // (carryPrevSetup из prev_cut_setup) — ровно как окно резки в setupActivityColumns
        // (persistence). Раньше генерация planStart брала здесь «ножи с нуля» (firstCutSetup),
        // а окно — переналадку от заправки → на первой карточке дня возникал разрыв/перекрытие.
        // carryOverPrevCut нейтрализует партию ИМЕННО первой резки c (как arr[0] в persistence),
        // поэтому батч не считается ложной сменой даже при gapFill-перестановке.
        function setupPartsFor(prev, c) {
            if (prev) return changeoverParts(prev, c, times);
            if (opts.carryPrevCut) return changeoverParts(opts.carryPrevCut, c, times);   // #3688
            if (opts.carryPrevSetup) return changeoverParts(carryOverPrevCut(opts.carryPrevSetup, c), c, times);   // #3853
            if (opts.firstCutSetup) return firstSetupParts(c, times);                     // #3669
            return [];
        }
        function setupCostFor(prev, c) {
            return setupPartsFor(prev, c).reduce(function(s, p){ return s + (Number(p.minutes) || 0); }, 0);
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
                    isCont: false, pendingSetup: 0
                };
                poolOrder.push(id);
            });
            function pending() {
                return poolOrder.filter(function(id){ return state[id].remaining > 0 || (state[id].perPass <= 0 && !state[id].placedEmpty); });
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
                // #4068: резервная фольга дня уже поставлена (в rem её нет), но резерв дня был — день
                // закрыт для нефольги (она не встаёт ПОСЛЕ фольги), переходим на следующий день.
                if (reserveForDay(day) > 0 && clock > 0 && !rem.some(function(id){ return state[id].resFoilDay === day; })) {
                    day += 1; clock = 0; continue;
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
                var freeDue = rem.filter(function(id){ return state[id].fixedDay == null && !isReservedFoil(id) && (state[id].anchor == null || state[id].anchor <= day); });
                var freeAny = rem.filter(function(id){ return state[id].fixedDay == null && !isReservedFoil(id); });
                var resFoilToday = rem.filter(function(id){ return state[id].resFoilDay === day && state[id].fixedDay == null; });
                var pick;
                if (inProgress.length) pick = selectByConfig(inProgress);
                else if (fixedToday.length) pick = selectByConfig(fixedToday);
                else {
                    // #3974: набиваем день от «С» — selectByConfig ставит нефольгу раньше фольги
                    // (isFoil-last key), поэтому фольга уходит в конец дня (#3717) сама.
                    // #4068: сперва обычная резка, влезающая в ёмкость дня МИНУС резерв под дедлайн-фольгу;
                    // когда нефольга в этот бюджет больше не влезает — ставим резервную фольгу этого дня
                    // в зарезервированный хвост (она вытесняет поздне-срочную нефольгу за срок, ТЗ §12).
                    var cand = freeDue.length ? selectByConfig(freeDue) : (freeAny.length ? selectByConfig(freeAny) : null);
                    if (cand != null && pickFitsReduced(cand)) pick = cand;
                    else if (resFoilToday.length) pick = selectByConfig(resFoilToday);
                    else if (cand != null) pick = cand;   // резерва под сегодня нет — обычное переполнение (day++ ниже)
                    else {
                        // Остались только будущие зафиксированные/резервные — прыгаем к ближайшему их дню
                        // (свободных в пуле нет, нахлёст-простой заполнять некем).
                        var nextDay = null;
                        rem.forEach(function(id){
                            [state[id].fixedDay, state[id].resFoilDay].forEach(function(d){
                                if (d != null && d > day && (nextDay == null || d < nextDay)) nextDay = d;
                            });
                        });
                        if (nextDay == null) break;
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
                // #3792: фиксированная резка — один сегмент на своём дне, без разбивки; нахлёст за
                // конец смены допустим (как обычный gapFill-нахлёст). Настройка — переналадка с
                // предыдущей физической резкой. День не двигаем: переполнение само вытолкнет
                // следующие свободные на завтра (avail < 0 → ветка-страж ниже).
                if (st.fixedDay != null) {
                    insertLunchBefore();
                    var setupF = setupCostFor(prevPhysical, c);
                    var perPassF = st.perPass + leader;
                    var wsF = day * 1440 + dayStart + clock;
                    var durF = (st.remaining > 0 && st.perPass > 0 && hasWindow) ? st.remaining * perPassF : 0;
                    segments.push({ cutId: pick, dayOffset: day, runs: st.remaining,
                        windowStartMin: round3(wsF), startMin: round3(wsF + setupF), setupMin: round3(setupF),
                        durationMin: round3(durF), isContinuation: false, parentCutId: null });
                    clock += setupF + durF;
                    // #3914: ФИКС-резка кладётся ЦЕЛИКОМ, без дробления и без лимита ёмкости — если
                    // её конец за потолком дня, это осознанный «замок на день» (#3792), а не баг
                    // упаковки. Ключевой кандидат в причину «520»: считаем конец окна.
                    if (round3(wsF + setupF + durF) - day * 1440 > dayEnd + (maxOverworkCuts || 0) + 1e-6) {
                        ppTraceWarn('ФИКС-резка ' + pick + ' выходит за потолок дня: конец ' +
                            ppClock(wsF + setupF + durF) + ' > ' + ppClock(day * 1440 + dayEnd + (maxOverworkCuts || 0)) +
                            ' (настр ' + Math.round(setupF) + ' + намотка ' + Math.round(durF) + ' мин; занято дня стало ' + Math.round(clock) + ')');
                    } else {
                        ppTrace('  ФИКС-резка ' + pick + ' целиком: настр ' + Math.round(setupF) + ' + намотка ' + Math.round(durF) + ' → занято ' + Math.round(clock));
                    }
                    prevPhysical = c; st.remaining = 0; st.placedEmpty = true;
                    continue;
                }
                // #3792: предыдущая фикс-резка могла переполнить день (нахлёст) — свободные тогда
                // начинают со следующего дня, без хвостовой настройки на уже переполненном дне.
                if (clock > 0 && (effCapacity(day) - clock) < 0) { day += 1; clock = 0; continue; }
                insertLunchBefore();
                // Резка без проходов/окна — один сегментик (как базовая ветка).
                if (!(st.remaining > 0) || !(st.perPass > 0) || !hasWindow) {
                    var s0 = leader + setupCostFor(prevPhysical, c);
                    var w0 = day * 1440 + dayStart + clock;
                    segments.push({ cutId: pick, dayOffset: day, runs: st.remaining,
                        windowStartMin: round3(w0), startMin: round3(w0 + s0), setupMin: round3(s0),
                        durationMin: 0, isContinuation: false, parentCutId: null });
                    clock += s0;
                    prevPhysical = c; st.remaining = 0; st.placedEmpty = true;
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
                var availCutsG = availFor(day, 'cuts') - reserveNF;
                var availTuneG = availFor(day, 'tune') - reserveNF;
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
                if (fittingG > 0) {
                    var passesNowG = Math.min(st.remaining, fittingG);
                    var wsG = day * 1440 + dayStart + clock, durG = passesNowG * perPassEffG;
                    segments.push({ cutId: pick, dayOffset: day, runs: passesNowG,
                        windowStartMin: round3(wsG), startMin: round3(wsG + setupG), setupMin: round3(setupG),
                        durationMin: round3(durG), isContinuation: st.isCont, parentCutId: st.isCont ? pick : null });
                    st.remaining -= passesNowG; st.isCont = true; st.pendingSetup = 0; prevPhysical = c;
                    if (st.remaining > 0) { day += 1; clock = 0; ppTrace('  положено ' + passesNowG + ' проходов (' + Math.round(setupG + durG) + ' мин), остаток ' + st.remaining + ' → день ' + day); }     // остаток проходов — на следующий день
                    else { clock += setupG + durG; ppTrace('  положено ' + passesNowG + ' проходов (' + Math.round(setupG + durG) + ' мин) целиком, занято дня ' + Math.round(clock) + ' (конец ' + ppClock(dayStart + clock) + ')'); }
                } else if (clock > 0) {
                    // #3760/#3805/#3821: в хвост дня не влезает ни один проход. ЕСТЬ настройка — кладём в
                    // хвост ПОДМНОЖЕСТВО её компонентов (ножи/сырьё), дотягивающее до конца рабочего окна
                    // (cutEndMin) с МИНИМАЛЬНЫМ нахлёстом (minOverlapTailSetupMinutes по остатку
                    // effCapacity−clock). Остаток настройки (pendingSetup) + проходы — на следующий день.
                    // НЕТ настройки (та же конфигурация, #3821: setupG=0) — ничего в хвост (иначе пустой
                    // сегмент), резка целиком на следующий день.
                    // #3955/#3847: «ставим то, что оператор УСПЕЕТ сделать, с ДОПУСТИМЫМ нахлёстом». Хвост
                    // настройки кладём, ТОЛЬКО если выбранное подмножество кончается ≤ потолка нахлёста
                    // НАСТРОЙКИ (availFor 'tune' = cutEndMin+MAX_OVERWORK_TUNE). Не влезает в этот потолок
                    // даже минимальный компонент (напр. атомарные ножи 30 при остатке 5 → нахлёст 25 > 10)
                    // → в хвост НЕ кладём, вся резка на следующий день ОДНОЙ карточкой. Так день добит «под
                    // завязку» до допустимого нахлёста (#3955), но не раздут за него (#3939: раньше цель
                    // была availTune без гварда → безграничный нахлёст, бейдж 542).
                    var roomG = round3(effCapacity(day) - reserveNF - clock);   // до конца окна резки (цель заполнения); #4068: минус резерв под фольгу
                    var tailAvailG = availFor(day, 'tune') - reserveNF;         // до потолка нахлёста настройки (#3847); #4068: минус резерв
                    var setupPartsG = st.isCont ? [{ minutes: setupG }] : setupPartsFor(prevPhysical, c);
                    var tailSetupG = (setupG > 0) ? minOverlapTailSetupMinutes(setupPartsG, roomG, setupG) : 0;
                    if (tailSetupG > 0 && tailAvailG >= tailSetupG) {
                        var wsS = day * 1440 + dayStart + clock;
                        segments.push({ cutId: pick, dayOffset: day, runs: 0,
                            windowStartMin: round3(wsS), startMin: round3(wsS + tailSetupG), setupMin: round3(tailSetupG),
                            durationMin: 0, isContinuation: false, parentCutId: null, setupOnly: true });
                        clock += tailSetupG; prevPhysical = c;
                        st.isCont = true; st.pendingSetup = round3(setupG - tailSetupG);
                        ppTrace('  проход не влез — в хвост дня положена настройка ' + Math.round(tailSetupG) +
                            ' мин (нахлёст ≤ ' + Math.round(maxOverworkTune != null ? maxOverworkTune : 0) + '), остаток настройки ' +
                            Math.round(st.pendingSetup) + ' + проходы → день ' + (day + 1));
                    } else {
                        ppTrace('  проход не влез, настройка (' + Math.round(setupG) + ') не влезает в хвост дня в пределах нахлёста (' +
                            Math.round(tailAvailG) + ') → резка целиком на день ' + (day + 1));
                    }
                    day += 1; clock = 0;
                } else {
                    // Вырожденно: даже ПУСТОЙ день не вмещает настройку + один проход (настройка или
                    // одиночный проход длиннее целого окна). Разбить одиночный проход нельзя — кладём
                    // настройку + 1 проход с нахлёстом, остальное на следующий день (#3821: единственный
                    // случай, где нахлёстный проход сохраняется, иначе резка не разместилась бы никогда).
                    var wsO = day * 1440 + dayStart + clock, durO = 1 * perPassEffG;
                    segments.push({ cutId: pick, dayOffset: day, runs: 1,
                        windowStartMin: round3(wsO), startMin: round3(wsO + setupG), setupMin: round3(setupG),
                        durationMin: round3(durO), isContinuation: st.isCont, parentCutId: st.isCont ? pick : null });
                    st.remaining -= 1; st.isCont = true; st.pendingSetup = 0; prevPhysical = c;
                    ppTraceWarn('вырожденно: настройка+1 проход (' + Math.round(setupG + perPassEffG) + ' мин) длиннее целого дня — кладём 1 проход с нахлёстом, остаток ' + st.remaining + ' → день ' + (day + 1));
                    day += 1; clock = 0;
                }
            }
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
            insertLunchBefore();  // #3342: обед перед началом этой резки
            // Резка без проходов/длительности — один сегментик без раскладки по проходам.
            if (!(runs > 0) || !(perPass > 0) || !hasWindow) {
                var setup0 = leader + setupCostFor(prevPhysical, c);   // #3688/#3853: первая резка — от заправки станка (carryPrevSetup)
                var ws0 = day * 1440 + dayStart + clock;
                segments.push({ cutId: String(cid), dayOffset: day, runs: runs, windowStartMin: round3(ws0),
                    startMin: round3(ws0 + setup0), setupMin: round3(setup0),
                    durationMin: round3((runs > 0 && perPass > 0) ? runs * perPass : 0),
                    isContinuation: false, parentCutId: null });
                clock += setup0 + ((runs > 0 && perPass > 0) ? runs * perPass : 0);
                prevPhysical = c;
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
                var maxPasses = Math.floor((availFor(day, 'cuts') - setup) / perPassEff);
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
                        // #3847: в хвост кладём подмножество настройки, заполняющее ОСТАТОК ДО ПОТОЛКА
                        // нахлёста настройки (availFor 'tune'), с минимальным нахлёстом. Остаток — завтра.
                        var tailAvail = availFor(day, 'tune');
                        var setupParts = setupPartsFor(prevPhysical, c);
                        var tailSetup = minOverlapTailSetupMinutes(setupParts, tailAvail, setup);
                        // кладём хвост, только если выбранное подмножество реально помещается в потолок
                        // нахлёста настройки (#3847); иначе — вся резка на чистый следующий день.
                        // pendingSetup = setup − tailSetup: 0, если влезла вся настройка; >0 — остаток на завтра.
                        if (tailSetup > 0 && tailAvail >= tailSetup) {
                            var wsSet = day * 1440 + dayStart + clock;
                            segments.push({ cutId: String(cid), dayOffset: day, runs: 0,
                                windowStartMin: round3(wsSet), startMin: round3(wsSet + tailSetup),
                                setupMin: round3(tailSetup), durationMin: 0,
                                isContinuation: false, parentCutId: null, setupOnly: true });
                            clock += tailSetup;
                            prevPhysical = c;
                            isCont = true;                          // проходы дня N+1 — продолжение
                            pendingSetup = round3(setup - tailSetup);   // остаток настройки → на продолжение
                            day += 1; clock = 0; continue;
                        }
                    }
                    if (clock > 0) { day += 1; clock = 0; continue; }   // переносим на чистый след. день
                    maxPasses = 1;   // целый день не вмещает даже setup+1 проход — кладём 1 (переполнение)
                }
                var passesNow = Math.min(remaining, maxPasses);
                var windowStart = day * 1440 + dayStart + clock;
                var segDur = passesNow * perPassEff;
                segments.push({ cutId: String(cid), dayOffset: day, runs: passesNow,
                    windowStartMin: round3(windowStart), startMin: round3(windowStart + setup),
                    setupMin: round3(setup), durationMin: round3(segDur),
                    isContinuation: isCont, parentCutId: isCont ? String(cid) : null });
                clock += setup + segDur;
                remaining -= passesNow;
                prevPhysical = c;
                isCont = true;   // дальнейшие сегменты этой резки — продолжения (ножи остаются)
                pendingSetup = 0;   // #3635 п.5: остаток настройки применён к этому сегменту — больше не добавляем
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

    // #3280: плановое время старта каждой резки как Unix-штамп (для записи в t1078 —
    // главное значение «Производственной резки»). Группируем по станку, упорядочиваем
    // очередь (orderCuts), строим расписание (buildSchedule) и берём начало окна
    // (startMin − setupMin) — то же время, что в .atex-pp-cut-num / .atex-pp-cut-time.
    //   opts: { weights, windPoints, times, dayStartMin, dayEndMin, runLengthByCut,
    //           planBaseMidnightMs }. → { cutId: штамп(сек) }. Вход не мутирует.
    function planStartTimestamps(cuts, opts){
        opts = opts || {};
        var base = Number(opts.planBaseMidnightMs);
        var byMachine = {};
        var order = [];
        (cuts || []).forEach(function(c){
            var sid = c && c.slitter && c.slitter.id;
            if (sid == null) return;
            var key = String(sid);
            if (!byMachine[key]) { byMachine[key] = []; order.push(key); }
            byMachine[key].push(c);
        });
        var out = {};
        order.forEach(function(key){
            var ordered = orderCuts(byMachine[key], opts.weights);
            var sched = buildSchedule(ordered, {
                windPoints: opts.windPoints || [],
                times: opts.times || DEFAULT_OP_TIMES,
                runLengthByCut: opts.runLengthByCut || {},
                shiftStartMin: opts.dayStartMin,
                shiftEndMin: opts.dayEndMin,
                lunchStartMin: opts.lunchStartMin,
                lunchDurationMin: opts.lunchDurationMin,
                firstCutSetup: opts.firstCutSetup,   // #3669 п.2: настройка ножей первой задачи (от вызывающего)
                blockedRanges: (opts.blockedRangesBySlitter || {})[key]   // #3764: окна «Отпуска» этого станка
            });
            // #4061: старт окна = целое (снап), чтобы planStart следующей резки = planStart текущей
            // + сумма её колонок (наладка+сырьё+резка/лидер) — без дрейфа на округлениях (см. helper).
            var snapped = snapWindowStartsWholeMinutes(sched.map(function(sc){
                return { ws: stripNum(sc.startMin) - stripNum(sc.setupMin), setup: stripNum(sc.setupMin),
                         cutLeader: stripNum(sc.durationMin) + stripNum(sc.leaderMin) };
            }));
            sched.forEach(function(sc, i){
                out[String(sc.cutId)] = scheduleStartTimestamp(base, snapped[i]);
            });
        });
        return out;
    }

    // Ближайшее свободное окно станка для НОВОЙ резки. Повторяет расписание очереди
    // (buildSchedule по порядку), добавляя проспект-резку в КОНЕЦ очереди станка, и
    // возвращает окно последнего сегмента — то же время, что покажет очередь после
    // создания (резка станет последней в своём дне). Вход не мутирует.
    //   stationCuts — резки станка в порядке очереди (как из groupBySlitter);
    //   prospect — { id, plannedRuns, materialId, winding, knifeWidths, runLength };
    //   opts — { windPoints, times, runLengthByCut:{cutId:м}, shiftStartMin, shiftEndMin }.
    // → { windowStartMin, startMin, finishMin, durationMin, setupMin, day } | null.
    function freeSlotForQueue(stationCuts, prospect, opts){
        opts = opts || {};
        if (!prospect) return null;
        var runLen = {};
        var src = opts.runLengthByCut || {};
        Object.keys(src).forEach(function(k){ runLen[k] = src[k]; });
        runLen[String(prospect.id)] = Number(prospect.runLength) || Number(runLen[String(prospect.id)]) || 0;
        var queue = (stationCuts || []).concat([prospect]);
        var sched = buildSchedule(queue, {
            windPoints: opts.windPoints || [],
            times: opts.times,
            runLengthByCut: runLen,
            shiftStartMin: opts.shiftStartMin,
            shiftEndMin: opts.shiftEndMin,
            lunchStartMin: opts.lunchStartMin,
            lunchDurationMin: opts.lunchDurationMin,
            firstCutSetup: opts.firstCutSetup   // #3669 п.2: настройка ножей первой задачи (от вызывающего)
        });
        var sc = sched.length ? sched[sched.length - 1] : null;
        if (!sc) return null;
        // #4061: окно последнего сегмента — на целой минуте (снап), как при генерации planStart, чтобы
        // превью старта новой резки совпало с сохранённой сеткой (старт = сумма колонок предыдущих).
        var snapped = snapWindowStartsWholeMinutes(sched.map(function(s){
            return { ws: stripNum(s.startMin) - stripNum(s.setupMin), setup: stripNum(s.setupMin),
                     cutLeader: stripNum(s.durationMin) + stripNum(s.leaderMin) };
        }));
        var setup = stripNum(sc.setupMin);
        var windowStartMin = snapped[snapped.length - 1];
        var startMin = round3(windowStartMin + setup);
        var delta = startMin - stripNum(sc.startMin);   // сдвиг снапа — окно/финиш двигаем на него же
        return {
            windowStartMin: round3(windowStartMin),
            startMin: startMin,
            finishMin: round3(stripNum(sc.finishMin) + delta),   // сохраняем lunchGap/лидер, сдвинутые снапом
            durationMin: round3(stripNum(sc.durationMin)),
            setupMin: round3(setup),
            day: Math.floor(windowStartMin / 1440)
        };
    }

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

    // #3613: две соседние карточки очереди — один и тот же логический «задание»,
    // физически разрезанный по рабочим дням (задание не влезло в день — нормально
    // дробить). Объединяющий признак: идентичная конфигурация резки (станок|сырьё|
    // намотка|ножи — continuationSignature) и единый номер заказа (orderId). По нему
    // renderQueue рисует значок смежности «←»/«→» на первой/последней карточке дня.
    function isDaySplitSibling(a, b){
        if (!a || !b) return false;
        if (continuationSignature(a) !== continuationSignature(b)) return false;
        return String((a && a.orderId) || '') === String((b && b.orderId) || '');
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
    // Эвристика (без маркера): одинаковая сигнатура continuationSignature + смежные
    // календарные дни (разница 1) → одна цепочка; выживает самая ранняя запись (её id),
    // её «Кол-во план» = сумма проходов цепочки; остальные записи — в deletes.
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
        // Легаси-эвристика (#3280): одинаковая continuationSignature + смежные календарные дни.
        // #3892: ДОПОЛНИТЕЛЬНО требуем СОВПАДЕНИЯ ЗАКАЗА (orderId) — как isDaySplitSibling (#3613).
        // Без этого две РАЗНЫЕ резки одной конфигурации (один станок|сырьё|намотка|ножи) в соседние
        // дни склеивались в одну «цепочку», её голова уезжала на более ранний день, и при scope по
        // фильтру (#3660, ключ = дата ГОЛОВЫ) перепланирование пропускало всю цепочку — «Упорядочить»
        // не трогал застрявшую переполненную резку (issue #3892: №7 на 03.07 не выталкивался, зазоры
        // не схлопывались). Пустой orderId у любой из записей (легаси/#3808) — считаем совместимым,
        // чтобы не осиротить настоящие продолжения с незаполненным заказом.
        function sameOrder(a, b){
            var oa = String((a && a.orderId) == null ? '' : a.orderId).trim();
            var ob = String((b && b.orderId) == null ? '' : b.orderId).trim();
            return oa === '' || ob === '' || oa === ob;
        }
        var groups = {}, order = [];
        legacyCuts.forEach(function(c){
            var s = continuationSignature(c);
            if (!groups[s]) { groups[s] = []; order.push(s); }
            groups[s].push(c);
        });
        order.forEach(function(s){
            var arr = sortByDay(groups[s]);
            var i = 0;
            while (i < arr.length) {
                var chain = [arr[i]];
                var j = i + 1;
                while (j < arr.length) {
                    var prevDay = planDayNumber(arr[j - 1]);
                    var curDay = planDayNumber(arr[j]);
                    if (prevDay == null || curDay == null || (curDay - prevDay) !== 1) break;
                    if (!sameOrder(chain[0], arr[j])) break;   // #3892: другой заказ — не продолжение
                    chain.push(arr[j]);
                    j++;
                }
                emitChain(chain);
                i = j;
            }
        });
        return { cuts: logical, deletes: deletes, chainByLogical: chainByLogical };
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
            var winMin = (Number(opts.dayEndMin) || 0) - (Number(opts.dayStartMin) || 0) - (Number(opts.lunchDurationMin) || 0);
            slotRefineCtx = {
                settings: opts.weights, times: opts.times, capacityMin: winMin > 0 ? winMin : Infinity,
                baseMidnightMs: Number(opts.planBaseMidnightMs), perPassByCut: perPass,
                machineDayOffFor: opts.machineDayOffFor, feasibleMachine: opts.feasibleMachineFor,
                distanceExceededFor: opts.distanceExceededFor, dueDayByCut: opts.dueDayByCut
            };
            slotPlan = computeSlotPlacement(merged.cuts, slotExtend(slotRefineCtx, {
                dueKeyByCut: opts.dueKeyByCut, slitterIds: opts.slitterIds, vacationSlots: opts.vacationSlots,
                dayByCut: opts.dayByCut, relocate: false,   // #4095/§12: релокация — ниже, по РЕАЛЬНЫМ дням упаковщика
                trace: slotTraceOn()
            }));
        }
        // Разложить резки станка в порядке очереди (preserveOrder — по «Дате план»/planStart
        // #3635/#3923; slotPlan — порядок слоя размещения #4085; иначе — orderCuts) и раскроить по дням.
        function planMachineSegs(cutsOfMachine, key){
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
            var ordered = opts.preserveOrder
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
                : (slotPlan   // #4085: порядок слоя размещения (индекс в очереди станка)
                    ? cutsOfMachine.slice().sort(function(a, b){
                          return (slotPlan.orderIdxByCut[String(a && a.id)] || 0) - (slotPlan.orderIdxByCut[String(b && b.id)] || 0); })
                    : orderCuts(cutsOfMachine, opts.weights));
            return packOrderedMachine(ordered, key);
        }
        // #4118: упаковка УЖЕ упорядоченной очереди станка splitMachineQueue (без пере-сортировки).
        // Выделено из planMachineSegs, чтобы доп. проход по РЕАЛЬНЫМ дням (relocateOverdueReal) мог
        // паковать пробные порядки на любом станке теми же параметрами (обед/отпуск/нахлёст/заправка).
        function packOrderedMachine(ordered, key){
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
                dayAnchorByCut: effAnchorByCut,   // #3974: якорь дня ТОЛЬКО за 🔒 (фикс держит свой день); свободные — от «С»
                weights: opts.weights,            // #4050: веса §8 (DEADLINE/EXACT_DEADLINE_COST_MN)
                firstCutSetup: opts.firstCutSetup,   // #3669 п.2: настройка ножей первой задачи (от вызывающего)
                carryPrevSetup: (opts.prevSetupBySlitter || {})[key],   // #3853: реальная заправка станка для первой резки (как окно в setupActivityColumns)
                gapFill: opts.gapFill,   // #3739: заполнять хвосты смены будущими резками, нахлёст разрешён
                blockedRanges: (opts.blockedRangesBySlitter || {})[key],   // #3764: окна «Отпуска» этого станка
                orderAuthoritative: !!slotPlan   // #4085: порядок задан слоем размещения — не переигрывать
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
        // cutId → РЕАЛЬНЫЙ день старта (мин dayOffset его сегментов) из реальной упаковки.
        function realDaysFrom(segsBy){
            var d = {};
            Object.keys(segsBy).forEach(function(key){
                (segsBy[key] || []).forEach(function(s){
                    var off = Number(s.dayOffset); if (!isFinite(off)) return;
                    var id = String(s.cutId);
                    if (d[id] == null || off < d[id]) d[id] = off;
                });
            });
            return d;
        }
        // #4118: cutId → объект резки (для доп. прохода: пакуем пробные порядки по РЕАЛЬНЫМ дням).
        var cutById = {};
        merged.cuts.forEach(function(c){ if (c && c.id != null) cutById[String(c.id)] = c; });
        // #4118: реальный день СТАРТА каждого задания при заданном порядке очереди станка (реальная
        // упаковка splitMachineQueue с параметрами станка). realDayFn(orderIds, machineId) → {id: day}.
        function realPackFn(orderIds, machineId){
            var objs = (orderIds || []).map(function(id){ return cutById[String(id)]; }).filter(Boolean);
            var segs = packOrderedMachine(objs, String(machineId));
            var d = {};
            (segs || []).forEach(function(s){
                var off = Number(s.dayOffset); if (!isFinite(off)) return;
                var id = String(s.cutId);
                if (d[id] == null || off < d[id]) d[id] = off;
            });
            return d;
        }
        var packed = packAll();
        // #4095 / ТЗ §12: срок держат РЕАЛЬНЫЕ дни splitMachineQueue, а НЕ ёмкость-оценка размещения.
        // Пакуем → у кого реальный день ≥ срока (shouldRelocate), релокация тянет раньше, ПОКА ЕСТЬ
        // ёмкость → пере-пакуем. Монотонно (relocatePass двигает лишь строго дешевле) + cap раундов.
        // Только при активном слое размещения и заданных сроках; иначе прежнее поведение не тронуто.
        var refineRounds = 0, refineMoves = 0;
        if (slotPlan && slotPlan.occupancy && opts.dueDayByCut && slotRefineCtx) {
            var maxRounds = Number(opts.slotRefineRounds) || 4;
            for (var rr = 0; rr < maxRounds; rr++) {
                var rel = relocatePass(slotPlan.occupancy, realDaysFrom(packed.segsByMachine), slotRefineCtx);
                if (!rel.moves.length) break;
                refineRounds++; refineMoves += rel.moves.length;
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
        var overduePass = { moves: 0 };
        if (slotPlan && slotPlan.occupancy && opts.dueDayByCut && slotRefineCtx) {
            var rel2 = relocateOverdueReal(slotPlan.occupancy, opts.dueDayByCut, realPackFn,
                slotExtend(slotRefineCtx, { feasibleMachine: opts.feasibleMachineFor }));
            overduePass.moves = rel2.moves.length;
            if (rel2.moves.length) {
                var asg2 = assignmentFromOccupancy(slotPlan.occupancy);
                slotPlan.slitterByCut = asg2.slitterByCut; slotPlan.orderIdxByCut = asg2.orderIdxByCut;
                packed = packAll();
            }
        }
        var byMachine = packed.byMachine, mOrder = packed.mOrder, segsByMachine = packed.segsByMachine;
        // #4095: дополнить trace РЕАЛЬНЫМИ днями (арбитр §12) и напечатать (slotTrace ВКЛ по умолчанию).
        if (slotPlan && slotPlan.trace) {
            var finalReal = realDaysFrom(segsByMachine), overdueLeft = 0;
            (slotPlan.trace.tasks || []).forEach(function(t){
                var rd = finalReal[String(t.id)];
                if (rd == null) return;
                t.realDay = rd;
                var due = opts.dueDayByCut ? opts.dueDayByCut[String(t.id)] : null;
                if (due != null) { t.dueDayOffset = Number(due); t.overdueReal = rd > Number(due); if (t.overdueReal) overdueLeft++; }
            });
            slotPlan.trace.refine = { rounds: refineRounds, moves: refineMoves, overdueLeft: overdueLeft, overdueMoves: overduePass.moves };
            formatSlotPlacementTrace(slotPlan.trace).forEach(function(line){ slotTrace(line); });
        }
        var updates = [], creates = [], deletes = [];
        // headId → число использованных записей цепочки (голова + переиспользованные продолжения).
        var usedByHead = {};
        mOrder.forEach(function(key){
            var segs = segsByMachine[key];
            // #4061: снап окон к целым минутам — старт следующего сегмента = старт текущего + сумма
            // его колонок (без дрейфа Ганта/очереди). Упаковку/дни/проходы это не трогает.
            snapSplitSegmentWindows(segs);
            // headId → индекс продолжения в цепочке (0=голова, 1,2,… — продолжения по дням).
            var contIndexByHead = {};
            segs.forEach(function(seg, idx){
                var ts = scheduleStartTimestamp(base, seg.windowStartMin);
                if (!seg.isContinuation) {
                    var head0 = String(seg.cutId);
                    contIndexByHead[head0] = 0;
                    usedByHead[head0] = 1;   // голова цепочки всегда занята первым сегментом
                    updates.push({ cutId: head0, sequence: idx + 1, planStartTs: ts, plannedRuns: seg.runs, slitterId: slotPlan ? key : undefined });
                } else {
                    var head = String(seg.parentCutId);
                    var k = (contIndexByHead[head] = (contIndexByHead[head] || 0) + 1);
                    var chain = chainByLogical[head] || [head];
                    var reuseId = chain[k];   // chain[0]=голова, chain[1..]=записи-продолжения
                    if (reuseId != null) {
                        usedByHead[head] = k + 1;
                        updates.push({ cutId: String(reuseId), sequence: idx + 1, planStartTs: ts, plannedRuns: seg.runs, slitterId: slotPlan ? key : undefined });
                    } else {
                        creates.push({ parentCutId: head, sequence: idx + 1, planStartTs: ts, plannedRuns: seg.runs, slitterId: slotPlan ? key : undefined });
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
        return { updates: updates, creates: creates, deletes: deletes };
    }

    // #3280: разделить рулоны/метраж одной строки Обеспечения между сегментами резки
    // ПРОПОРЦИОНАЛЬНО проходам. Рулоны — целые, сумма долей = исходным рулонам
    // (остаток по наибольшей дробной части). Метраж — дробно, последняя доля = остаток.
    //   rolls, footage — исходные; runs — массив проходов по сегментам (сегмент 0 = «сегодня»).
    // → [{ rolls, footage }] длиной runs.length. runs пуст/сумма 0 → всё в сегмент 0.
    function splitSupplyShares(rolls, footage, runs){
        var r = (runs || []).map(function(x){ return Number(x) || 0; });
        var n = r.length;
        var R = Math.round(Number(rolls) || 0);
        var F = Number(footage) || 0;
        if (n === 0) return [];
        var total = r.reduce(function(s, x){ return s + x; }, 0);
        var out = [];
        if (!(total > 0)) {
            for (var z = 0; z < n; z++) out.push({ rolls: z === 0 ? R : 0, footage: z === 0 ? round3(F) : 0 });
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

    function formatClockHHMM(min){
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
    function formatCutStartTime(sc) {
        return sc ? formatClock(cutStartWindowMin(sc)) : '—';
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

    function formatCutWindingLabel(cut) {
        var raw = cut && cut.winding;
        var winding = normWinding(raw) || String(raw == null ? '' : raw).trim() || '—';
        return 'Намотка: ' + winding;
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

    function formatCutRuns(plannedRuns, runLength) {
        var runs = stripNum(plannedRuns);
        var text = 'Проходов: ' + (runs > 0 ? String(round3(runs)) : '—');
        var length = stripNum(runLength);
        if (length > 0) text += ' * ' + round3(length) + 'м';
        return text;
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

    // Позиции, не имеющие ни одной записи обеспечения. supplies — [{positionId}].
    function unsuppliedPositions(positions, supplies){
        var sup = {}; (supplies || []).forEach(function(s){ if (s && s.positionId != null) sup[String(s.positionId)] = true; });
        return (positions || []).filter(function(p){ return !sup[String(p.id)]; });
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

    // Выбрать станок: исключить запрещённые (стоп-лист), среди допустимых —
    // с наименьшей загрузкой (loadBySlitterId: {id→count}), тайбрейк — меньший id.
    // Возвращает String(id) или null если все запрещены.
    function pickSlitter(slitters, materialId, loadBySlitterId, nominalWidth){
        var load = loadBySlitterId || {};
        var allowed = (slitters || []).filter(function(s){
            return !isMaterialBlocked(s.stopMaterialIds, materialId)
                && !isSlitterWidthBlocked(s.widthCode, nominalWidth);   // #4006: лимит ширины джамбо станка
        });
        if (!allowed.length) return null;
        allowed.sort(function(a, b){
            var la = Number(load[String(a.id)]) || 0, lb = Number(load[String(b.id)]) || 0;
            return la - lb || (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0);
        });
        return String(allowed[0].id);
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

    function slitterAffinityKey(materialId, windDir, windLength, batchId) {
        return String(materialId == null ? '' : materialId).trim() + '|' +
            normWinding(windDir) + '|' + windLengthKey(windLength) + '|' +
            String(batchId == null ? '' : batchId);
    }

    // #3120 группа C (Фаза 1a, п.4): у резки задан материал, но нет ни одной подходящей
    // партии сырья с остатком (pickBatchFIFO === null) → резку нельзя обеспечить сырьём.
    // Резки без материала (materialId пуст) не помечаем. genBatches — [{id,materialId,...,remainder}].
    function cutMissingBatch(cut, genBatches){
        var mat = cut && cut.materialId != null ? String(cut.materialId) : '';
        if (mat === '') return false;
        return pickBatchFIFO(genBatches || [], mat) === null;
    }

    // Потребность резки в погонных метрах (#3120 группа C): длина прогона джамбо =
    // самая длинная обеспечиваемая позиция (параллельный слиттинг — все полосы режутся
    // за один прогон). supplyFootages — массив «Метраж, м» обеспечений резки.
    function requiredRunLengthM(supplyFootages){
        return (supplyFootages || []).reduce(function(m, f){ var n = stripNum(f); return n > m ? n : m; }, 0);
    }

    function supplyFootage(supply, footageBySupply){
        var direct = stripNum(supply && supply.footage);
        if (direct > 0) return direct;
        return stripNum(footageBySupply && supply && footageBySupply[String(supply.id)]);
    }

    function cutRunLength(cut, supplies, footageBySupply){
        var maxF = stripNum(cut && cut.length);
        (supplies || []).forEach(function(s) {
            if (String(s.cutId) !== String(cut && cut.id)) return;
            var f = supplyFootage(s, footageBySupply);
            if (f > maxF) maxF = f;
        });
        return maxF;
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
    // = planWeight(INCREASE) − planWeight(CHANGE) (веса #3991, ТЗ §14). Так убывание полос
    // становится СТРОГО дешевле возрастания, а не только тай-брейком (#3130): жадная цепочка сама
    // ставит наборы по убыванию, и это не сбивается разницей по сырью/партии. Физтайминг
    // (changeoverParts/setupBreakdown) не трогаем — реальные минуты наладки прежние.
    function sequencingCost(prev, next, weights){
        var base = changeoverCost(prev, next, weights);
        // #3871: во время выравнивания загрузки считаем только быстрый memoized changeoverCost —
        // направленный штраф (не memoized: knifeChangeNeeded/stripBandCount на каждую пробу переноса)
        // раздувал O(n³) проход rebalanceSlitterLoad. Для баланса важны дни/минуты, а не направление
        // ножей; финальный порядок всё равно соберёт orderCuts (balanceFastChangeover=false).
        if (!balanceFastChangeover && knifeChangeNeeded(prev, next) && stripBandCount(next) > stripBandCount(prev)) {
            base += planWeight(null, 'KNIVES_INCREASE_COST_MN') - planWeight(null, 'KNIVES_CHANGE_COST_MN');
        }
        return round3(base);
    }
    // Жадная цепочка от заданного старта: далее argmin sequencingCost, tie-break startKey.
    function greedyFromStart(start, rest, weights){
        var pool = (rest || []).slice();
        var result = [start];
        while (pool.length){
            var cur = result[result.length - 1], bestI = 0, bestCost = Infinity, bestKey = null;
            for (var i = 0; i < pool.length; i++){
                var c = sequencingCost(cur, pool[i], weights), k = startKey(pool[i]);
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
    // Внутри последовательности станка число ножей должно убывать к концу дня
    // (ideav/crm#3130): в начале смены ножей много, к вечеру меньше — переналаживать
    // тяжелее. Стабильная сортировка по knifeCount ↓; равные — в порядке жадной
    // последовательности (минимизация переналадок остаётся вторичным критерием).
    function byKnifeCountDesc(seq){
        return (seq || []).map(function(c, i){ return { c: c, i: i }; })
            .sort(function(a, b){ return ((Number(b.c.knifeCount) || 0) - (Number(a.c.knifeCount) || 0)) || (a.i - b.i); })
            .map(function(x){ return x.c; });
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

    // Упорядочить резки станка: не-Фольга, затем Фольга; внутри каждой группы —
    // выбранный оператором вариант (#3272). По умолчанию — реальные минуты
    // переналадки (#3268); fatigue-вариант ставит сложные резки раньше.
    // Проставить sequence; вход не мутировать.
    // #3815: EDD — задания с более ранним «Сроком изготовления» (c.dueKey, YYYYMMDD) идут
    // раньше, чтобы по-дневная раскладка ставила их на более ранние дни. Резки группируются по
    // сроку (по возрастанию), ВНУТРИ каждого срока — выбранная стратегия (минимум переналадок,
    // #3783). Резки без срока (dueKey не число → Infinity) собираются в последнюю группу. Если
    // ни у одной резки срока нет — одна группа = прежнее поведение (полная обратная совместимость).
    function orderCuts(cuts, weights){
        var opts = makePlanningOptions(weights);
        // #4085 (модель #3985): жёсткое «фольга — отдельной группой в конец дня» (#3717) СНЯТО.
        // Порядок целиком по стратегии (SETUP: группировка сырья/ножей — минимум переналадок). Фольга
        // в конце дня обеспечивается штрафом FOIL_NOTEND_COST_MN в слое размещения, а не сортировкой.
        // Срок изготовления (EDD) в упорядочивании НЕ участвует (только цвет строки, dueColorClass).
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
            var matWindTime = Number((times && times.MATERIAL_WINDING != null) ? times.MATERIAL_WINDING : DEFAULT_OP_TIMES.MATERIAL_WINDING) || 0;
            // Настройка резки «с нуля»: ножи (#3669 firstSetupParts) + смена сырья, если у резки
            // есть материал. Реальный день-сплит НЕ группирует одинаковые конфиги (сроки #3815 и
            // направления намотки разносят их по очереди), поэтому почти каждая резка ставит ножи
            // и сырьё заново. Оценка через changeoverCost в порядке orderCuts группировала соседние
            // одинаковые конфиги в ~0 и занижала настроечно-тяжёлый станок вдвое (#3965): Станок 1
            // реально 2757 мин (намотка 625 + настройка ~2130 ≈ 42 мин/резка), оценка ~1214 мин.
            function scratchSetup(c){
                var s = firstSetupCost(c, times);   // ножи (KNIFE), если есть
                if (c && c.materialId != null && String(c.materialId).trim() !== '') s += matWindTime;   // + смена сырья
                return s;
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
    //   position — 'start' (в начало) | 'end' (в конец).
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
        var ordered = position === 'end' ? ids.concat([String(cutId)]) : [String(cutId)].concat(ids);
        return { ordered: ordered };
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

    // Сгруппировать резки по станкам и дням, упорядочить каждую группу через orderCuts,
    // пронумеровать 1..N внутри каждого станка/дня. Резки без станка (slitter.id == null) пропускаются.
    // Возвращает плоский массив [{cutId, slitterId, sequence}].
    function planQueues(cuts, weights) {
        var groups = {};
        var slitterOrder = [];
        (cuts || []).forEach(function(c) {
            var sid = c && c.slitter && c.slitter.id;
            if (sid == null) return; // пропускаем «без станка»
            var key = String(sid);
            if (!groups[key]) { groups[key] = { days: {}, dayOrder: [] }; slitterOrder.push(key); }
            var day = cutPlanDayKey(c);
            if (!groups[key].days[day]) { groups[key].days[day] = []; groups[key].dayOrder.push(day); }
            groups[key].days[day].push(c);
        });
        var result = [];
        slitterOrder.forEach(function(sid) {
            groups[sid].dayOrder.slice().sort(comparePlanDayKeys).forEach(function(day) {
                var ordered = orderCuts(groups[sid].days[day], weights);
                ordered.forEach(function(c) {
                    result.push({ cutId: c.id, slitterId: sid, sequence: c.sequence });
                });
            });
        });
        return result;
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
        KNIVES_CHANGE_COST_MN: 30, KNIVES_INCREASE_COST_MN: 50, MATERIAL_CHANGE_COST_MN: 15,
        LEADER_COST_MN: 2, FOIL_NOTEND_COST_MN: 60, DEADLINE_COST_MN: 100, EXACT_DEADLINE_COST_MN: 33,
        CHANGE_SLITTER_COST_MN: 3, CHANGE_DAY_COST_MN: 3, SLOT_SPLIT_COST_MN: 2, MAX_DISTANCE_COST_MN: 25,
        MAX_SLOTS_DISTANCE_HR: 24, MAX_OUTAGE_PLANNABLE_HR: 48, DAY_DURATION_MN: 450, INTERVAL_DURATION_MN: 10
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
    // Нужна ли смена сырья/намотки/партии prev→next — как changeoverParts.
    function materialChangeNeeded(prev, next){
        if (!prev || !next) return false;
        // batchId нормализуем null/undefined → '' (carryOverPrevCut так же нейтрализует партию),
        // иначе первая резка с незаданной партией ложно считалась бы сменой сырья.
        var pb = prev.batchId == null ? '' : String(prev.batchId);
        var nb = next.batchId == null ? '' : String(next.batchId);
        return String(prev.materialId) !== String(next.materialId)
            || normWinding(prev.winding) !== normWinding(next.winding)
            || pb !== nb;
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
                // полос стало больше → дороже (KNIVES_INCREASE), иначе KNIVES_CHANGE (ТЗ §8 п.1).
                var inc = stripBandCount(next) > stripBandCount(prev);
                var kw = planWeight(s, inc ? 'KNIVES_INCREASE_COST_MN' : 'KNIVES_CHANGE_COST_MN');
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
                            knifeMin += (stripBandCount(cur) > stripBandCount(prevForCur) ? kInc : kChange);
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

