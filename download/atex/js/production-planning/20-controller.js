    var planning = {
        parseDeepLink: parseDeepLink,
        ganttRangeLink: ganttRangeLink,                 // #3713
        ganttBaseFromLocation: ganttBaseFromLocation,   // #3713
        cutClickSelectsCut: cutClickSelectsCut,
        parseRef: parseRef,
        parseMultiRefIds: parseMultiRefIds,
        isMaterialBlocked: isMaterialBlocked,
        aliasOf: aliasOf,
        matchesName: matchesName,
        tableByName: tableByName,
        reqIdByName: reqIdByName,
        columnIndex: columnIndex,
        parseActualWidthCode: parseActualWidthCode,      // #3372
        actualWidthCodeMatches: actualWidthCodeMatches,  // #3372
        isSlitterWidthBlocked: isSlitterWidthBlocked,    // #4006: лимит ширины джамбо станка
        buildActualWidthIndex: buildActualWidthIndex,    // #3372
        resolveCutWidth: resolveCutWidth,                // #3372
        resolveNominalWidth: resolveNominalWidth,        // #3408
        parseSleeveWidthFromName: parseSleeveWidthFromName, // #3812
        isSleeveWidthProducible: isSleeveWidthProducible, // #3812
        sleeveCoreStripPlan: sleeveCoreStripPlan,        // #3812
        appendCoreStrip: appendCoreStrip,                // #3812
        sortStripsByWidthDesc: sortStripsByWidthDesc,    // единый ряд полос по убыванию ширины
        isCoreStripFiller: isCoreStripFiller,            // #3872
        selectCoreStripFillers: selectCoreStripFillers,  // #3872
        coreOnlyStripWidths: coreOnlyStripWidths,        // #3872
        mapCutRecord: mapCutRecord,
        groupBySlitter: groupBySlitter,
        mergeStationTabs: mergeStationTabs,
        filterCuts: filterCuts,
        cutSearchHaystack: cutSearchHaystack,
        cutMatchesQuery: cutMatchesQuery,
        isCutVisible: isCutVisible,
        dayDeletionTargets: dayDeletionTargets,
        formatPlanDayLabel: formatPlanDayLabel,
        formatPlanDayRangeLabel: formatPlanDayRangeLabel,   // #3622
        fulfillmentIdsFromRows: fulfillmentIdsFromRows,   // #3486
        cutFulfillmentIds: cutFulfillmentIds,             // #3691
        extractApiError: extractApiError,
        planDateDayKey: planDateDayKey,
        dayKeyToDate: dayKeyToDate,             // #3769
        formatDayKey: formatDayKey,             // #3769
        dueColorClass: dueColorClass,           // #3769
        cutDueKeys: cutDueKeys,                 // #3769
        dayOffsetFromBase: dayOffsetFromBase,   // #3652
        dayKeyFromOffset: dayKeyFromOffset,     // #4085: индекс дня → YYYYMMDD (placementDayKey слоя размещения)
        formatPlanDayHeading: formatPlanDayHeading,
        buildFields: buildFields,
        runWithConcurrency: runWithConcurrency,   // #3998: пул сохранений с лимитом потоков
        maxNumericCutNumber: maxNumericCutNumber,
        nextCutMainValue: nextCutMainValue,
        splitMachineQueue: splitMachineQueue,
        scheduleStartTimestamp: scheduleStartTimestamp,
        planStartTimestamps: planStartTimestamps,
        downtimeBlockedRanges: downtimeBlockedRanges,             // #3764
        slitterDownOnDay: slitterDownOnDay,                       // #3876
        downtimeSpanDays: downtimeSpanDays,                       // #3898
        vacationSpanDaysOnDay: vacationSpanDaysOnDay,             // #3898
        parseDmyKey: parseDmyKey,                                 // #3788
        dayKeyFromMs: dayKeyFromMs,                               // #3788
        dayTypeWorking: dayTypeWorking,                           // #3788
        dayIsWorking: dayIsWorking,                               // #3788
        calendarBlockedRanges: calendarBlockedRanges,             // #3788
        mergeBlockedRanges: mergeBlockedRanges,                   // #3788
        nextFreeWorkMinute: nextFreeWorkMinute,                   // #3764
        shiftPlacementsPastDowntime: shiftPlacementsPastDowntime, // #3764
        unixToDatetimeLocal: unixToDatetimeLocal,                 // #3764
        datetimeLocalToUnix: datetimeLocalToUnix,                 // #3764
        downtimeRangeNote: downtimeRangeNote,                     // #3787
        formatDowntimeBound: formatDowntimeBound,                 // #3787
        continuationSignature: continuationSignature,
        isDaySplitSibling: isDaySplitSibling,
        daySplitBadges: daySplitBadges,
        boundaryDaySibling: boundaryDaySibling,   // #3737
        mergeContinuationChains: mergeContinuationChains,
        planCutOperations: planCutOperations,
        computeFoilDeadlineReservation: computeFoilDeadlineReservation,   // #4068: резерв хвоста дня под дедлайн-фольгу (ТЗ §12)
        planWeight: planWeight,                         // #3989: вес штрафа из «Настройки» (ATEH)
        stripPrefixQuality: stripPrefixQuality,         // #3989: «качество» перехода по ножам
        transitionCost: transitionCost,                 // #3989: стоимость перехода prev→next (вес+качество)
        insertionCost: insertionCost,                   // #3989: стоимость вставки слота между prev и next
        // #4085: слой размещения (модель #3985) — перебор всех точек вставки по мин. штрафу + релокация
        slotFromCut: slotFromCut, vacationSlot: vacationSlot, seedOccupancy: seedOccupancy,
        prefixDayOffset: prefixDayOffset, canInsertAt: canInsertAt, scorePosition: scorePosition,
        placeSlot: placeSlot, placeAllSlots: placeAllSlots, relocatePass: relocatePass,
        slotOrderByMachine: slotOrderByMachine, computeSlotPlacement: computeSlotPlacement,
        planQuality: planQuality,                       // #3989: факт vs идеал переналадок (ТЗ §13)
        planQualityView: planQualityView,               // #3989 Фаза 3: качество из cuts контроллера
        chooseOptimizeCandidate: chooseOptimizeCandidate,   // #4047: гарантия «Упорядочить» не увеличивает переналадку
        formatQualityDelta: formatQualityDelta,          // #3989 Фаза 3: подпись избытка
        splitSupplyShares: splitSupplyShares,
        addMainValueField: addMainValueField,
        cutWriteDiagnostics: cutWriteDiagnostics,
        cutCreateRequiredKeys: cutCreateRequiredKeys,   // #3851
        cutGenerationTimingDiagnostics: cutGenerationTimingDiagnostics,
        supplyCutRelation: supplyCutRelation,
        buildSupplyFieldsForCut: buildSupplyFieldsForCut,
        buildSupplyFieldsForFinishedBatch: buildSupplyFieldsForFinishedBatch,
        buildFinishedBatchFields: buildFinishedBatchFields,
        finishedBatchRolls: finishedBatchRolls,
        batchOrderId: batchOrderId,
        layoutPositionGroups: layoutPositionGroups,
        rowsToPlanning: rowsToPlanning,
        cutPlanningReportDiagnostics: cutPlanningReportDiagnostics,
        rowsToPositions: rowsToPositions,
        positionDimensionsLabel: positionDimensionsLabel,
        remainingRollsForPosition: remainingRollsForPosition,
        formatLinkedPositionLabel: formatLinkedPositionLabel,
        stripSupplyRolls: stripSupplyRolls,
        rowsToGenPositions: rowsToGenPositions,
        preferredWidthsKey: preferredWidthsKey,
        groupPositionsByPlanningProfile: groupPositionsByPlanningProfile,
        positionLengthMap: positionLengthMap,
        batchDateKey: batchDateKey,
        formatCutNumber: formatCutNumber,
        rowsToBatches: rowsToBatches,
        DEFAULT_OP_TIMES: DEFAULT_OP_TIMES,
        KNIFE_SCALE: KNIFE_SCALE,
        WIDTH_SCALE: WIDTH_SCALE,
        REMAINDER_OK_M: REMAINDER_OK_M,
        FATIGUE_MACHINE_WIDTH_MM: FATIGUE_MACHINE_WIDTH_MM,
        FATIGUE_FACTOR: FATIGUE_FACTOR,
        FATIGUE_START_COST_MIN: FATIGUE_START_COST_MIN,
        PLANNING_STRATEGY_SETUP: PLANNING_STRATEGY_SETUP,
        PLANNING_STRATEGY_FATIGUE: PLANNING_STRATEGY_FATIGUE,
        normWinding: normWinding,
        widthSetDistance: widthSetDistance,
        knifeMoves: knifeMoves,
        awkwardRemainder: awkwardRemainder,
        changeoverParts: changeoverParts,
        changeoverCost: changeoverCost,
        prevSetupFromRows: prevSetupFromRows,     // #3688
        carryOverPrevCut: carryOverPrevCut,       // #3688
        firstSetupParts: firstSetupParts,
        firstSetupCost: firstSetupCost,
        setupBreakdown: setupBreakdown,
        setupActivityMinutes: setupActivityMinutes,   // #3698
        minOverlapTailSetupMinutes: minOverlapTailSetupMinutes,   // #3760
        setupActivityColumns: setupActivityColumns,   // #3698
        planningStrategy: planningStrategy,
        planningStrategyLabel: planningStrategyLabel,
        makePlanningOptions: makePlanningOptions,
        estimatedKnifeCount: estimatedKnifeCount,
        fatiguePositionWeight: fatiguePositionWeight,
        fatigueRouteScore: fatigueRouteScore,
        fatigueAwareSequence: fatigueAwareSequence,
        greedySequence: greedySequence,
        orderCuts: orderCuts,
        orderedChangeoverCost: orderedChangeoverCost,
        bestExistingTransitionCost: bestExistingTransitionCost,
        chooseSlitterBySetup: chooseSlitterBySetup,
        rebalanceSlitterLoad: rebalanceSlitterLoad,   // #3848: выравнивание загрузки станков
        computeSlitterReassignment: computeSlitterReassignment,   // #4001: пере-выбор станка для существующих резок
        knifeWidthSig: knifeWidthSig,   // #3666
        byKnifeCountDesc: byKnifeCountDesc,
        planQueues: planQueues,
        planMoveSequences: planMoveSequences,   // #3602/#3923
        unsuppliedPositions: unsuppliedPositions,
        supplyCoverageKind: supplyCoverageKind,
        uncoveredPositions: uncoveredPositions,
        nextSequenceForCuts: nextSequenceForCuts,
        pickSlitter: pickSlitter,
        pickBatchFIFO: pickBatchFIFO,
        pickBatchFIFOForRun: pickBatchFIFOForRun,
        slitterAffinityKey: slitterAffinityKey,
        batchIsActive: batchIsActive,
        isStockStrip: isStockStrip,
        maxStockKey: maxStockKey,
        parseMaxStockRows: parseMaxStockRows,
        buildMaxStockIndex: buildMaxStockIndex,
        maxStockConfigured: maxStockConfigured,
        maxStockMatches: maxStockMatches,
        maxStockLimit: maxStockLimit,
        isStockableNomenclature: isStockableNomenclature,
        stockStripPurpose: stockStripPurpose,
        filterStockableWidths: filterStockableWidths,
        maxStockFamilyStockable: maxStockFamilyStockable,
        buildStockBalanceIndex: buildStockBalanceIndex,
        currentStock: currentStock,
        stockHeadroom: stockHeadroom,
        capStockToHeadroom: capStockToHeadroom,
        plannedRunsForLayout: plannedRunsForLayout,
        supplyRollsForPosition: supplyRollsForPosition,
        layoutRunLength: layoutRunLength,
        finishedBatchesForLayout: finishedBatchesForLayout,
        producedBatchesForLayout: producedBatchesForLayout,
        supplyPlanForLayout: supplyPlanForLayout,
        positionSleeveTasksForLayout: positionSleeveTasksForLayout,
        pickSleeveBatchId: pickSleeveBatchId,
        sleeveMinutes: sleeveMinutes,
        cutMissingBatch: cutMissingBatch,
        requiredRunLengthM: requiredRunLengthM,
        supplyFootage: supplyFootage,
        cutRunLength: cutRunLength,
        reserveFifo: reserveFifo,
        fifoBatchesForMaterial: fifoBatchesForMaterial,
        materialByCut: materialByCut,
        healContinuationMaterials: healContinuationMaterials,   // #3808
        windingPointsFromTimes: windingPointsFromTimes,
        foilWindingPointsFromTimes: foilWindingPointsFromTimes,
        foilWindingMinutes: foilWindingMinutes,   // #3742
        windPointsForCut: windPointsForCut,
        windingMinutes: windingMinutes,
        relevantWindingNorms: relevantWindingNorms,
        formatWindingNorms: formatWindingNorms,
        plannedCutDurationMinutes: plannedCutDurationMinutes,
        cutTimingDetails: cutTimingDetails,
        cutTimingModalText: cutTimingModalText,
        cutTimingModalTitle: cutTimingModalTitle,
        cutTimingTimelineLines: cutTimingTimelineLines,
        buildCutTimingCtx: buildCutTimingCtx,
        scheduleDurationMinutes: scheduleDurationMinutes,
        setupTaskIdSet: setupTaskIdSet,   // #3635 п.5
        parseClockMinutes: parseClockMinutes,
        resolveWorkingWindow: resolveWorkingWindow,
        resolveOverworkLimits: resolveOverworkLimits,     // #3992: лимиты захлёста (ключи _MN)
        resolveDayDurationMin: resolveDayDurationMin,     // #3989 Фаза 2: DAY_DURATION_MN
        intraDayBreaks: intraDayBreaks,                   // #3989 Фаза 2: обед + два перерыва (ТЗ §5)
        buildSchedule: buildSchedule,
        snapWindowStartsWholeMinutes: snapWindowStartsWholeMinutes,   // #4061: снап planStart к целым минутам (= сумма колонок)
        scheduleFromStored: scheduleFromStored,   // #3846: показ из сохранённого плана (без live-пересчёта)
        lunchBlocksFromSchedule: lunchBlocksFromSchedule,   // #3846: блоки обеда для отображения
        computeQueueBreakMarkers: computeQueueBreakMarkers,   // #4075: значки обеда/перерывов + сдвиг очереди
        freeSlotForQueue: freeSlotForQueue,
        dayCleanups: dayCleanups,
        formatClock: formatClock,
        formatClockHHMM: formatClockHHMM,
        formatCutStartTime: formatCutStartTime,
        formatCutStartTitle: formatCutStartTitle,
        cutStartWindowMin: cutStartWindowMin,
        formatCutWindingLabel: formatCutWindingLabel,
        formatScheduleLine: formatScheduleLine,
        formatFreeSlot: formatFreeSlot,
        DAY_START_MIN: DAY_START_MIN,
        DAY_END_MIN: DAY_END_MIN,
        SHIFT_START_MIN: SHIFT_START_MIN,
        SHIFT_END_MIN: SHIFT_END_MIN,
        aggregateStrips: aggregateStrips,
        stripsUsedWidth: stripsUsedWidth,
        stripsTotalKnives: stripsTotalKnives,
        knifeWidthsForStrips: knifeWidthsForStrips,
        stripsRemainder: stripsRemainder,
        cutRemainderStatus: cutRemainderStatus,
        progressPercent: progressPercent,
        stripsButtonLabel: stripsButtonLabel,
        formatCutRuns: formatCutRuns,
        cutDisplayLength: cutDisplayLength,
        formatCutDimensions: formatCutDimensions,
        cutStripGroups: cutStripGroups,
        formatStripSummaryLine: formatStripSummaryLine,
        resolveTolerance: resolveTolerance
    };

    // ─────────────────────────── Браузерный слой ───────────────────────────
    // Ниже — DOM-контроллер. Требует window/document/fetch; в Node не выполняется.

    function el(tag, attrs, children) {
        var node = document.createElement(tag);
        if (attrs) Object.keys(attrs).forEach(function(k) {
            if (k === 'class') node.className = attrs[k];
            else if (k === 'text') node.textContent = attrs[k];
            else if (k === 'html') node.innerHTML = attrs[k];
            else if (k === 'dataset') Object.keys(attrs[k]).forEach(function(d) { node.dataset[d] = attrs[k][d]; });
            else node.setAttribute(k, attrs[k]);
        });
        (children || []).forEach(function(c) {
            if (c == null) return;
            node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
        });
        return node;
    }

    function AtexProductionPlanning(root) {
        this.root = root;
        this.db = window.db || root.getAttribute('data-db') || '';
        this.meta = {
            cut: null,
            supply: null,
            slitter: null,
            materialBatch: null,
            strip: null,
            finishedBatch: null,
            sleeveTask: null,
            settings: null,
            downtime: null        // #3764: подчинённая «Отпуск» (окна простоя станка)
        };
        this.downtimesBySlitter = {};  // #3764: карта slitterId → [{ id, start, end, notes }] (start/end — unix-сек)
        this.calendarByDay = {};       // #3788: карта ГГГГММДД → 'Праздничный день'|'Рабочий день' (исключения календаря)
        this.sleeveBatches = [];   // #3340: партии втулок «в работе» (отчёт sleeve_batches_active) для FIFO
        this.sleeveCutterId = '';  // #3340: id втулкореза TC-20 (резолв по имени)
        this.slitters = [];        // справочник [{ id, label, stopMaterialIds }]
        this.materialBatches = []; // справочник [{ id, label }]
        this.batchMaterialById = {}; // карта batch_id → вид_сырья_id (для стоп-листа)
        this.positions = [];       // позиции заказа [{ id, label }]
        this.refOptions = {};      // кеш опций searchable reference inputs по reqId
        this.cuts = [];            // очередь резок [mapCutRecord]
        this.supplies = [];        // все записи «Обеспечения» (для подсчёта привязок)
        // Данные для генерации резок:
        this.genPositions = [];    // [{ id, materialId, width, qty, dueKey }] — все позиции
        this.genBatches = [];      // [{ id, materialId, dateKey, remainder }]
        this.stripAgg = {};        // карта cutId → { knifeCount, knifeWidths } (отчёт cut_strips)
        this.jumboWidthByMaterial = {}; // карта materialId → ширина джамбо «Вид сырья» («Ширина, мм» — геометрия реза)
        this.nominalWidthByMaterial = {}; // #3686: materialId → «Номинальная ширина» (рулон) для условий j= фактической ширины
        this.prevSetupBySlitter = {};   // #3688: текущая заправка станков (prev_cut_setup) для первой резки
        this.preferredByMaterial = {};  // кеш ходовых ширин: materialId|windDir|windLength → [{width, popularity}]
        this.maxStockIndex = planning.buildMaxStockIndex([], null);  // #3391: индекс «Максимального запаса» (пуст до загрузки)
        this.stockBalanceIndex = planning.buildStockBalanceIndex([]); // #3445: текущий остаток ГП по номенклатуре (пуст до загрузки)
        this.draft = this.blankDraft();
        // #3599: дата плана диапазоном [date; dateTo] — фильтр отображения очереди; date
        // («С») остаётся базой генерации/планирования. По умолчанию оба = сегодня (один день).
        this.filter = { slitter: '', status: '', date: todayISO(), dateTo: todayISO(), query: '' };  // query — быстрый поиск (#3411)
        this.selectedCutId = null; // выбранная резка для привязки обеспечения
        this.stripEditCutId = null; // резка с открытым инлайн-редактором полос (одна за раз)
        this.lastCutMainValue = 0;  // последний t{Задание в производство}, выданный клиентом
        this.busy = false;
        this.progressEl = null;     // окно прогресса генерации резок (#3148)
        this.progressTotal = 0;
        this.timingModalEl = null;
        this.timingModalTitleEl = null;
        this.timingModalBodyEl = null;
        this._timingByCut = {};     // #3240: контекст тайминга на резку (setup+нормы+старт) для модалки
        this.daySettings = {};      // DAY_START_HOUR/DAY_END_HOUR из таблицы «Настройка»
        this._lastCutPlanningDiagnosticKey = '';
    }

    AtexProductionPlanning.prototype.blankDraft = function() {
        return { positionId: '', qty: '', footage: '', slitterId: '', materialBatchId: '', plannedRuns: '1', planDate: '', status: CUT_STATUSES[0], active: true, notes: '', selectedPositions: [], prospect: null };
    };

    AtexProductionPlanning.prototype.url = function(path) {
        return '/' + encodeURIComponent(this.db) + '/' + path;
    };

    AtexProductionPlanning.prototype.getJson = function(path) {
        return fetch(this.url(path), { credentials: 'same-origin' }).then(function(resp) {
            return resp.text().then(function(text) {
                var data;
                try { data = text ? JSON.parse(text) : null; }
                catch (e) {
                    if (!resp.ok) throw new Error('Сервер вернул ошибку ' + resp.status + ': ' + text.slice(0, 200));
                    throw new Error('Некорректный JSON: ' + text.slice(0, 200));
                }
                // Сервер сигналит отказ кодом 4xx и телом `[{"error":"…"}]` (my_die).
                if (!resp.ok) throw new Error(extractApiError(data) || ('Сервер вернул ошибку ' + resp.status));
                return data;
            });
        });
    };

    AtexProductionPlanning.prototype.loadRefOptions = function(reqId, query, limit) {
        return this.getJson(window.AtexRefSearch.buildRefOptionsPath(reqId, query, limit));
    };

    // POST команды `_m_*`. Токен XSRF подставляется обязательно (раздел 4 гайда).
    AtexProductionPlanning.prototype.post = function(path, params) {
        var body = new URLSearchParams();
        body.set('_xsrf', (typeof window !== 'undefined' && window.xsrf) || this.root.getAttribute('data-xsrf') || '');
        Object.keys(params || {}).forEach(function(k) {
            if (params[k] !== undefined && params[k] !== null && params[k] !== '') body.set(k, params[k]);
        });
        return fetch(this.url(path), {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString()
        }).then(function(resp) {
            return resp.text().then(function(text) {
                var result;
                try { result = text ? JSON.parse(text) : {}; }
                catch (e) {
                    if (!resp.ok) throw new Error('Сервер вернул ошибку ' + resp.status + ': ' + text.slice(0, 200));
                    throw new Error('Сервер вернул не JSON: ' + text.slice(0, 200));
                }
                // #3486/#3475: отказ команды `_m_*` приходит телом `[{"error":"…"}]` (массив,
                // my_die) с HTTP-кодом 4xx/409. Прежняя проверка `result.error` у массива не
                // срабатывала и не смотрела статус — отказ (напр. 409 «есть ссылки» при удалении)
                // молча считался успехом, запись оставалась, а тост рапортовал «удалено».
                if (!resp.ok) throw new Error(extractApiError(result) || ('Сервер вернул ошибку ' + resp.status));
                return result;
            });
        });
    };

    // ── Загрузка метаданных и справочников ──

    AtexProductionPlanning.prototype.loadMetadata = function() {
        var self = this;
        return this.getJson('metadata').then(function(all) {
            var list = Array.isArray(all) ? all : [all];
            self._metaAll = list; // кеш полного списка метаданных (резолв таблиц по имени)
            function byName(name) {
                return tableByName(list, name);
            }
            self.meta.cut = byName(TABLE.cut) || byName('Производственная резка'); // #3504: старое имя запасным
            self.meta.supply = byName(TABLE.supply);
            self.meta.slitter = byName(TABLE.slitter);
            self.meta.materialBatch = byName(TABLE.materialBatch);
            self.meta.strip = byName(TABLE.strip); // подчинённая «Производственной резки» (Task 3)
            self.meta.finishedBatch = byName(TABLE.finishedBatch);
            self.meta.sleeveTask = byName(TABLE.sleeveTask);
            self.meta.settings = byName(TABLE.settings);
            self.meta.maxStock = byName(TABLE.maxStock);   // #3391: необязательная — фича включается её наличием
            self.meta.leader = byName(TABLE.leader);        // #3569: справочник «Лидер» (резолв метки → id)
            self.meta.downtime = byName(TABLE.downtime);    // #3764: необязательная — кнопка/пропуск простоя включаются её наличием
            self.meta.calendar = byName(TABLE.calendar);    // #3788: необязательная — пропуск выходных/праздников включается её наличием
            if (!self.meta.cut) throw new Error('В метаданных не найдена таблица «' + TABLE.cut + '»');
            if (!self.meta.supply) throw new Error('В метаданных не найдена таблица «' + TABLE.supply + '»');
        });
    };

    AtexProductionPlanning.prototype.loadDaySettings = function() {
        var self = this;
        var meta = this.meta.settings;
        if (!meta) {
            // #4059: таблицы «Настройка» (ТЗ §14, table/269, код ATEH) нет — НЕ молчим: ошибка в лог и
            // оператору. Планирование продолжается на значениях по умолчанию, но это надо видеть.
            this.daySettings = {};
            console.error('[pp] ❌ loadDaySettings: таблица «Настройка» (ATEH) не найдена — работаю на значениях по умолчанию (ТЗ §14). Проверьте метаданные базы.');
            if (this.notify) this.notify('Таблица «Настройка» не найдена — планирование на значениях по умолчанию (ТЗ §14)', 'error');
            return Promise.resolve();
        }
        return this.getJson('object/' + meta.id + '/?JSON_OBJ&LIMIT=0,1000').then(function(rows) {
            var dbKey = String(self.db || '').trim().toUpperCase();
            var values = {};
            var score = {};
            (rows || []).forEach(function(rec) {
                var r = rec.r || [];
                var key = String(r[0] == null ? '' : r[0]).replace(/^\uFEFF/, '').trim();
                // #3342: \u043F\u043E\u043C\u0438\u043C\u043E \u0440\u0430\u0431\u043E\u0447\u0435\u0433\u043E \u043E\u043A\u043D\u0430 \u0447\u0438\u0442\u0430\u0435\u043C \u043D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438 \u043E\u0431\u0435\u0434\u0430 LUNCH_START/LUNCH_DURATION.
                // #4059: белый список ключей убран — «Настройка» читается ЦЕЛИКОМ. Кроме рабочего окна
                // и обеда (DAY_START_HOUR/DAY_END_HOUR/LUNCH_*, #3342), нахлёста (MAX_OVERWORK_*_MN,
                // #3847/#3992) и окна срока (DAYS_FORECAST, #3769) сюда попадают веса штрафов
                // (DEADLINE_COST_MN, EXACT_DEADLINE_COST_MN, KNIVES_*, MATERIAL_* и пр.) — они тоже
                // настраиваемы (ТЗ §14) и переопределяют PLAN_WEIGHT_DEFAULTS в planWeight. Тип строки
                // задаёт приоритет ниже (<db> > ATEH > общий). Пустой ключ пропускаем.
                if (key === '') return;
                var type = String(r[1] == null ? '' : r[1]).trim().toUpperCase();
                var val = String(r[2] == null ? '' : r[2]).trim();
                if (val === '') return;
                var rank = 1;
                if (dbKey && type === dbKey) rank = 3;
                else if (type === 'ATEH') rank = 2;
                if (!score[key] || rank >= score[key]) {
                    score[key] = rank;
                    values[key] = val;
                }
            });
            self.daySettings = values;
            // #4059: «что-то непонятно» — значение веса/лимита ЕСТЬ в «Настройке», но НЕ число. Не
            // игнорируем молча: ошибка в лог и оператору (иначе planWeight тихо возьмёт дефолт, и
            // оператор не узнает, что настройка не применилась — как со сроком в issue #4059).
            // ОТСУТСТВИЕ ключа — не ошибка, штатный фолбэк на дефолт (ТЗ §14).
            var badKeys = [];
            Object.keys(PLAN_WEIGHT_DEFAULTS).forEach(function(k){
                if (Object.prototype.hasOwnProperty.call(values, k) && !isFinite(Number(values[k]))) {
                    badKeys.push(k + '=«' + values[k] + '»');
                }
            });
            if (badKeys.length) {
                console.error('[pp] ❌ loadDaySettings: нечисловые значения в «Настройке» — ' + badKeys.join(', ') +
                    '; по этим ключам применён дефолт (ТЗ §14).');
                if (self.notify) self.notify('В «Настройке» нечисловые значения: ' + badKeys.join(', ') + ' — применён дефолт', 'error');
            }
        });
    };

    // #3769: DAYS_FORECAST из «Настройки» — окно срока изготовления (дни) для расцветки
    // строк .atex-pp-strip-row. Нет/некорректно → null (жёлтый отключён, красный работает).
    AtexProductionPlanning.prototype.daysForecast = function() {
        var v = this.daySettings ? this.daySettings.DAYS_FORECAST : null;
        var n = Number(v);
        return (isFinite(n) && n >= 0) ? n : null;
    };

    AtexProductionPlanning.prototype.workingWindow = function() {
        return resolveWorkingWindow(this.daySettings, this.changeTimes && this.changeTimes.CLEANUP_SHIFT);
    };

    // Справочник: главное значение записей таблицы → [{ id, label }].
    AtexProductionPlanning.prototype.loadRef = function(meta, labelReq) {
        if (!meta) return Promise.resolve([]);
        return this.getJson('object/' + meta.id + '/?JSON_OBJ&LIMIT=0,1000').then(function(rows) {
            return (rows || []).map(function(r) {
                var label = (r.r && r.r[0]) || ('#' + r.i);
                if (labelReq) {
                    var idx = columnIndex(meta, labelReq);
                    if (idx >= 0 && r.r && r.r[idx] != null && String(r.r[idx]).trim() !== '') {
                        label = label + ' · ' + String(r.r[idx]);
                    }
                }
                return { id: String(r.i), label: label };
            });
        });
    };

    // Справочник станков (слиттеров) с их стоп-листами сырья.
    // Читает object/ с полем «Стоп-лист сырья» (мультиссылка → Вид сырья);
    // разбирает через parseMultiRefIds → stopMaterialIds: ['id1','id2',...].
    // Заменяет loadRef(meta.slitter) в начальной загрузке.
    AtexProductionPlanning.prototype.loadSlittersWithStop = function() {
        var meta = this.meta.slitter;
        if (!meta) return Promise.resolve([]);
        var stopIdx = columnIndex(meta, 'Стоп-лист сырья');
        var codeIdx = columnIndex(meta, 'Код');   // #4006: лимит ширины джамбо станка (напр. «j<1000»)
        return this.getJson('object/' + meta.id + '/?JSON_OBJ&LIMIT=0,1000').then(function(rows) {
            return (rows || []).map(function(r) {
                var raw = (stopIdx >= 0 && r.r) ? r.r[stopIdx] : '';
                var codeRaw = (codeIdx >= 0 && r.r) ? r.r[codeIdx] : '';
                return {
                    id: String(r.i),
                    label: (r.r && r.r[0]) || ('#' + r.i),
                    stopMaterialIds: parseMultiRefIds(raw),
                    widthCode: parseActualWidthCode(codeRaw)   // #4006: условие ширины из «Код»
                };
            });
        });
    };

    // #3764: окна «Отпуска» (простоя) по станкам. Подчинённая «Отпуск» (up = Слиттер),
    // главное значение записи — НАЧАЛО (DATETIME, unix-сек), «Окончание» — конец, «Примечания» —
    // причина. Читаем по каждому станку отдельно (F_U=slitterId, как полосы по резке). Таблицы
    // нет в метаданных (старое окружение) → пустая карта, фича выключена (кнопка не рисуется,
    // расписание прежнее). Ошибка чтения не валит загрузку — лишь логируется.
    AtexProductionPlanning.prototype.loadDowntimes = function() {
        var self = this;
        this.downtimesBySlitter = {};
        var meta = this.meta.downtime;
        if (!meta || !(this.slitters || []).length) return Promise.resolve();
        var endIdx = columnIndex(meta, DOWNTIME_REQ.end);
        var notesIdx = columnIndex(meta, DOWNTIME_REQ.notes);
        return Promise.all(this.slitters.map(function(s) {
            return self.getJson('object/' + meta.id + '/?JSON_OBJ&F_U=' + encodeURIComponent(s.id) + '&LIMIT=0,500')
                .then(function(rows) {
                    self.downtimesBySlitter[String(s.id)] = (rows || []).map(function(rec) {
                        var r = rec.r || [];
                        return {
                            id: String(rec.i),
                            start: (r[0] == null || r[0] === '') ? null : Number(r[0]),
                            end: (endIdx >= 0 && r[endIdx] != null && r[endIdx] !== '') ? Number(r[endIdx]) : null,
                            notes: (notesIdx >= 0 && r[notesIdx] != null) ? String(r[notesIdx]) : ''
                        };
                    });
                });
        })).then(function() {
            console.log('[pp] 🛠 loadDowntimes: окон простоя по станкам:',
                Object.keys(self.downtimesBySlitter).reduce(function(n, k) { return n + self.downtimesBySlitter[k].length; }, 0));
        }).catch(function(err) {
            console.warn('[pp] 🛠 loadDowntimes: не удалось прочитать «' + TABLE.downtime + '»:', err && err.message);
            self.downtimesBySlitter = {};
        });
    };

    // #3788: «Календарь» — исключения из обычных выходных. Таблица 123162 (тип DATE): главное
    // значение — дата (ДД.ММ.ГГГГ), «Тип дня» (ссылка) = «Праздничный день»/«Рабочий день».
    // Строим карту ГГГГММДД → тип. Таблицы нет в метаданных (старое окружение) → пустая карта,
    // фича выключена (выходные/праздники не пропускаются, разметка дней не рисуется). Ошибка
    // чтения не валит загрузку.
    AtexProductionPlanning.prototype.loadCalendar = function() {
        var self = this;
        this.calendarByDay = {};
        var meta = this.meta.calendar;
        if (!meta) return Promise.resolve();
        var typeIdx = columnIndex(meta, CALENDAR_REQ.dayType);
        return this.getJson('object/' + meta.id + '/?JSON_OBJ&LIMIT=0,2000').then(function(rows) {
            (rows || []).forEach(function(rec) {
                var r = rec.r || [];
                var key = parseDmyKey(r[0]);
                if (key == null) return;
                // «Тип дня» — ссылка «id:Метка»; берём метку (parseRef.label).
                var typeLabel = (typeIdx >= 0 && r[typeIdx] != null) ? parseRef(r[typeIdx]).label : '';
                if (typeLabel) self.calendarByDay[key] = typeLabel;
            });
            console.log('[pp] 📅 loadCalendar: дней-исключений в календаре:', Object.keys(self.calendarByDay).length);
        }).catch(function(err) {
            console.warn('[pp] 📅 loadCalendar: не удалось прочитать «' + TABLE.calendar + '»:', err && err.message);
            self.calendarByDay = {};
        });
    };

    // #3788: нерабочие дни (выходные/праздники) горизонта → блокированные интервалы (минуты от
    // базы). Фича включается наличием таблицы «Календарь»: без неё [] (расписание прежнее, дни
    // не блокируются). baseMidnightMs — база расписания (день фильтра «С»). Глобальны для всех станков.
    AtexProductionPlanning.prototype.calendarBlockedRanges = function(baseMidnightMs) {
        if (!this.meta.calendar) return [];
        return calendarBlockedRanges(this.calendarByDay, baseMidnightMs, CALENDAR_HORIZON_DAYS);
    };

    // #3788: рабочий ли день (по мс). Фича выключена (нет «Календаря») → всегда рабочий, чтобы
    // разметка выходных не появлялась в старом окружении.
    AtexProductionPlanning.prototype.dayIsWorking = function(ms) {
        if (!this.meta.calendar) return true;
        return dayIsWorking(ms, this.calendarByDay);
    };

    // #3764+#3788: блокированные интервалы станка = окна «Отпуска» этого станка ∪ нерабочие дни
    // календаря (глобальные). baseMidnightMs — база расписания (день фильтра «С»).
    AtexProductionPlanning.prototype.blockedRangesForSlitter = function(slitterId, baseMidnightMs) {
        return mergeBlockedRanges(
            downtimeBlockedRanges((this.downtimesBySlitter || {})[String(slitterId)], baseMidnightMs),
            this.calendarBlockedRanges(baseMidnightMs)
        );
    };

    // #3876: на отпуске ли станок slitterId ВЕСЬ рабочий день dayMidnightMs (полночь дня, мс).
    // Календарь (выходные/праздники) сюда НЕ входит — он глобален и не делает станок «недоступным»
    // в смысле этой проверки; речь именно об «Отпуске» конкретного станка (он без сырья и ножей).
    // #3883: частичный отпуск (не на весь рабочий день) станок НЕ блокирует — отдаём рабочее окно
    // [startMin; cutEndMin], slitterDownOnDay требует ПОЛНОГО покрытия (2-часовой отпуск → false).
    AtexProductionPlanning.prototype.slitterOnVacationDay = function(slitterId, dayMidnightMs) {
        var w = this.workingWindow();
        return slitterDownOnDay((this.downtimesBySlitter || {})[String(slitterId)], dayMidnightMs,
            w && w.startMin, w && w.cutEndMin);
    };

    // #3957: нерабочий ли день-смещение для ВЫРАВНИВАНИЯ ЗАГРУЗКИ (rebalanceSlitterLoad,
    // machineDayOff). Станок не работает в день, если это выходной/праздник (#3788 dayIsWorking,
    // общий для ВСЕХ станков) ИЛИ у станка отпуск (#3876 slitterOnVacationDay). Модель span/endPos
    // ОБЯЗАНА пропускать те же дни, что и реальное расписание (calendarBlockedRanges +
    // downtimeBlockedRanges), иначе содержимое, влезающее в рабочие дни ДО выходных перед отпуском,
    // «не доходит» до отпуска — станок с отпуском выглядит заканчивающим рано (Станок 1 «4д» вместо
    // «12д»), и хвост за отпуском не стекает на свободные станки.
    AtexProductionPlanning.prototype.balanceDayOff = function(slitterId, dayMidnightMs) {
        return !this.dayIsWorking(dayMidnightMs) || this.slitterOnVacationDay(slitterId, dayMidnightMs);
    };

    // #3876: id станков, у которых в день dayMidnightMs отпуск → { slitterId: true }. Для
    // исключения таких станков при выборе/балансировке (не ставить задание на станок в отпуске).
    AtexProductionPlanning.prototype.vacationSlitterIdsForDay = function(dayMidnightMs) {
        var self = this, out = {};
        (this.slitters || []).forEach(function(s) {
            if (self.slitterOnVacationDay(s.id, dayMidnightMs)) out[String(s.id)] = true;
        });
        return out;
    };

    // #3876: заправка станков для расчёта настройки. У станка, который НА отпуске в день базы
    // плана (baseMidnightMs), сырья и ножей нет — его заправку обнуляем (пустой объект). Тогда
    // первая резка станка ПОСЛЕ отпуска считает ПОЛНУЮ настройку (смена сырья + ножи с нуля,
    // changeoverParts от пустого станка), а не наследует prev_cut_setup, бывший ДО отпуска.
    // Прочие станки — как есть (#3853/#3862). Применяется и в плане (splitMachineQueue), и в
    // хранимых колонках (computeCutSetupUpdates) — один источник, тайминги совпадают.
    AtexProductionPlanning.prototype.planningPrevSetupBySlitter = function(baseMidnightMs) {
        var self = this, src = this.prevSetupBySlitter || {}, out = {};
        Object.keys(src).forEach(function(k) { out[k] = src[k]; });
        (this.slitters || []).forEach(function(s) {
            var key = String(s.id);
            // #3898: только ДЛИННЫЙ отпуск (> DOWNTIME_KEEP_SETUP_MAX_DAYS дней) обнуляет
            // заправку. После короткого простоя (≤ N дней) станок сохраняет сырьё/ножи —
            // первая резка не пересчитывает настройку с нуля.
            if (self.longVacationOnDay(key, baseMidnightMs)) out[key] = { materialId: '', winding: '', knifeWidths: [] };
        });
        return out;
    };

    // #3898: отпуск, накрывающий день базы плана, ДЛИННЕЕ порога «короткого» простоя?
    // Предусловие — станок реально не работает весь день базы (slitterOnVacationDay, #3883:
    // частичный отпуск не считается). Только длинный отпуск (> DOWNTIME_KEEP_SETUP_MAX_DAYS
    // календарных дней) сбрасывает заправку; ≤ N дней → заправка сохраняется (#3876 смягчён).
    AtexProductionPlanning.prototype.longVacationOnDay = function(slitterId, dayMidnightMs) {
        if (!this.slitterOnVacationDay(slitterId, dayMidnightMs)) return false;
        var span = vacationSpanDaysOnDay((this.downtimesBySlitter || {})[String(slitterId)], dayMidnightMs);
        return span > DOWNTIME_KEEP_SETUP_MAX_DAYS;
    };

    // #3764+#3788: карта slitterId → blockedRanges по ВСЕМ станкам (для planCutOperations).
    // Нерабочие дни календаря добавляем КАЖДОМУ станку (глобальны), поэтому строим по полному
    // справочнику станков, а не только по тем, у кого есть отпуск.
    AtexProductionPlanning.prototype.blockedRangesBySlitter = function(baseMidnightMs) {
        var self = this, out = {};
        var calBlocks = this.calendarBlockedRanges(baseMidnightMs);
        var keys = {};
        (this.slitters || []).forEach(function(s) { keys[String(s.id)] = true; });
        Object.keys(this.downtimesBySlitter || {}).forEach(function(k) { keys[k] = true; });
        Object.keys(keys).forEach(function(key) {
            var ranges = mergeBlockedRanges(
                downtimeBlockedRanges(self.downtimesBySlitter[key], baseMidnightMs), calBlocks);
            if (ranges.length) out[key] = ranges;
        });
        return out;
    };

    // Справочник позиций заказа отчётом positions_list (JSON_KV). Позиция
    // подчинённая — прямое object/-чтение её не отдаёт, отчёт возвращает все.
    // Параллельно строит this.genPositions = [{ id, materialId, width, qty }]
    // для генерации резок: использует те же строки, не нужен доп. запрос.
    AtexProductionPlanning.prototype.loadPositions = function() {
        var self = this;
        console.log('[pp] 📋 loadPositions: запрос positions_list...');
        return this.getJson('report/positions_list?JSON_KV&LIMIT=0,2000').then(function(rows) {
            self.positions = rowsToPositions(rows || []);
            self.genPositions = rowsToGenPositions(rows || []);
            var approvedCnt = self.genPositions.filter(function(p) { return p.approved; }).length;
            console.log('[pp] 📋 loadPositions: загружено позиций для дропдауна:', self.positions.length, ', для генерации:', self.genPositions.length, ', согласованных:', approvedCnt);
        });
    };

    // Справочник партий сырья отчётом material_batches (JSON_KV).
    AtexProductionPlanning.prototype.loadMaterialBatches = function() {
        var self = this;
        return this.getJson('report/material_batches?JSON_KV&LIMIT=0,2000').then(function(rows) {
            self.materialBatches = rowsToBatches(rows || []);
        });
    };

    // #3391: таблица «Максимальный запас» (object/{id}) → индекс целесообразных к
    // хранению номенклатур. Таблица необязательна: если её нет в метаданных —
    // индекс пуст (фича выключена, поведение прежнее). Ошибка чтения не валит
    // загрузку — лишь логируется (планирование работает и без таблицы).
    AtexProductionPlanning.prototype.loadMaxStock = function() {
        var self = this;
        var meta = this.meta.maxStock;
        this.maxStockIndex = planning.buildMaxStockIndex([], meta);
        if (!meta) return Promise.resolve();
        return this.getJson('object/' + meta.id + '/?JSON_OBJ&LIMIT=0,5000').then(function(rows) {
            self.maxStockIndex = planning.buildMaxStockIndex(rows || [], meta);
            console.log('[pp] 📦 loadMaxStock: номенклатур запаса:', self.maxStockIndex.list.length);
        }).catch(function(err) {
            console.warn('[pp] 📦 loadMaxStock: не удалось прочитать «Максимальный запас»:', err && err.message);
            self.maxStockIndex = planning.buildMaxStockIndex([], meta);
        });
    };

    // #3445: текущий остаток ГП по номенклатуре — суммарные рулоны «Партий ГП»,
    // физически лежащих на складе (статус не «Отгружен»). Номенклатуру берём из
    // родительской «Производственной резки» (up): сырьё через batchMaterialById
    // (Партия сырья → Вид сырья), намотка/длина — поля резки; ширина — у партии.
    // Кол-во рулонов: «Кол-во факт» → «Кол-во рулонов» → «Кол-во план» (как в
    // warehouse.js: факт реален, иначе план/спрос). Нужен ПОСЛЕ loadGenBatches
    // (batchMaterialById). Graceful: ошибка чтения → пустой остаток (фича не блокирует).
    AtexProductionPlanning.prototype.loadStockBalance = function() {
        var self = this;
        this.stockBalanceIndex = planning.buildStockBalanceIndex([]);
        var fbMeta = this.meta.finishedBatch;
        var cutMeta = this.meta.cut;
        // Фича выключена без таблицы «Максимальный запас» — остаток не нужен (лишние запросы).
        if (!fbMeta || !cutMeta || !this.meta.maxStock) return Promise.resolve();
        var iWidth = columnIndex(fbMeta, FINISHED_BATCH_REQ.width);
        var iActual = columnIndex(fbMeta, FINISHED_BATCH_REQ.actual);
        var iRolls = columnIndex(fbMeta, FINISHED_BATCH_REQ.rolls);
        var iPlanned = columnIndex(fbMeta, FINISHED_BATCH_REQ.planned);
        var iStatus = columnIndex(fbMeta, CUT_REQ.status);   // «Статус»
        var iCutMat = columnIndex(cutMeta, CUT_REQ.materialBatch);
        var iCutWind = columnIndex(cutMeta, CUT_REQ.winding);
        var iCutLen = columnIndex(cutMeta, CUT_REQ.length);
        return Promise.all([
            this.getJson('object/' + fbMeta.id + '/?JSON_OBJ&LIMIT=0,5000'),
            this.getJson('object/' + cutMeta.id + '/?JSON_OBJ&LIMIT=0,5000')
        ]).then(function(res) {
            var fbRows = res[0] || [];
            var cutRows = res[1] || [];
            var matById = self.batchMaterialById || {};
            // Карта резки → { material, winding, length }.
            var cutById = {};
            cutRows.forEach(function(rec) {
                var r = rec.r || [];
                var matBatch = iCutMat >= 0 ? parseRef(r[iCutMat]) : { id: null };
                var matBatchId = matBatch.id ? String(matBatch.id) : '';
                cutById[String(rec.i)] = {
                    material: matById[matBatchId] || '',
                    winding: iCutWind >= 0 ? r[iCutWind] : '',
                    length: iCutLen >= 0 ? r[iCutLen] : 0
                };
            });
            var batches = fbRows.map(function(rec) {
                var r = rec.r || [];
                var cut = cutById[String(rec.u)] || { material: '', winding: '', length: 0 };
                // Рулоны: факт → рулоны (спрос) → план (см. warehouse.js:286-288).
                var rolls = 0;
                [iActual, iRolls, iPlanned].some(function(idx) {
                    if (idx < 0) return false;
                    var v = stripNum(r[idx]);
                    if (v > 0) { rolls = v; return true; }
                    return false;
                });
                var status = iStatus >= 0 ? String(r[iStatus] == null ? '' : r[iStatus]) : '';
                return {
                    material: cut.material,
                    width: iWidth >= 0 ? r[iWidth] : 0,
                    length: cut.length,
                    winding: cut.winding,
                    rolls: rolls,
                    shipped: /отгру/i.test(status)
                };
            });
            self.stockBalanceIndex = planning.buildStockBalanceIndex(batches);
            console.log('[pp] 📦 loadStockBalance: номенклатур на складе:',
                Object.keys(self.stockBalanceIndex.byKey).length);
        }).catch(function(err) {
            console.warn('[pp] 📦 loadStockBalance: не удалось прочитать остаток ГП:', err && err.message);
            self.stockBalanceIndex = planning.buildStockBalanceIndex([]);
        });
    };

    // #3569: справочник «Лидер» (1132) → карта { метка(lower) → id }. Отчёт
    // positions_list отдаёт лидера позиции меткой («Глобал Принтинг»), а реквизит
    // «Лидер» задания — ссылка: при записи нужен id записи справочника, а не метка
    // (docs/kb/crud.md: ref-поле = id). Таблица необязательна — нет её → карта пуста.
    AtexProductionPlanning.prototype.loadLeaders = function() {
        var self = this;
        this.leaderIdByLabel = {};
        var meta = this.meta.leader;
        if (!meta) return Promise.resolve();
        return this.getJson('object/' + meta.id + '/?JSON_OBJ&LIMIT=0,1000').then(function(rows) {
            var map = {};
            (rows || []).forEach(function(r) {
                var label = ((r.r || [])[0] == null ? '' : String((r.r || [])[0])).trim();
                if (label) map[label.toLowerCase()] = String(r.i);
            });
            self.leaderIdByLabel = map;
            console.log('[pp] 🏷️ loadLeaders: лидеров в справочнике:', Object.keys(map).length);
        }).catch(function(err) {
            console.warn('[pp] 🏷️ loadLeaders: не удалось прочитать «Лидер»:', err && err.message);
            self.leaderIdByLabel = {};
        });
    };

    // #3569: id записи справочника «Лидер» по метке (для записи ссылки в задание).
    // Нет справочника / метки / совпадения → '' (buildFields опустит пустой реквизит).
    AtexProductionPlanning.prototype.resolveLeaderId = function(label) {
        var key = (label == null ? '' : String(label)).trim().toLowerCase();
        if (!key) return '';
        return (this.leaderIdByLabel || {})[key] || '';
    };

    // ── Загрузчики для генерации резок ──

    // Загружает «Партия сырья» через object/ и заполняет this.genBatches.
    // Результат: [{ id, materialId, dateKey (число), remainder }] для pickBatchFIFO.
    // Вид сырья: parseRef(«Вид сырья»).id; Дата прихода → batchDateKey;
    // Остаток, м² → Number (ключевое поле для FIFO-выбора).
    // Заодно строит this.batchMaterialById = { партия → вид сырья } для проверки стоп-листа
    // станка: это подмножество тех же строк, поэтому отдельный запрос к таблице
    // «Партия сырья» (бывш. loadBatchMaterialMap, LIMIT 1000) не нужен — экономим чтение
    // и убираем рассинхрон лимитов (1000 vs 5000).
    AtexProductionPlanning.prototype.loadGenBatches = function() {
        var self = this;
        var meta = this.meta.materialBatch;
        if (!meta) { this.genBatches = []; this.batchMaterialById = {}; return Promise.resolve(); }
        var matIdx = columnIndex(meta, 'Вид сырья');
        // #3242: отдельной «Даты прихода» у «Партии сырья» нет — дата прихода = первая
        // колонка (DATETIME). Фоллбэк на неё, чтобы FIFO-резерв сортировался по приходу.
        var dateIdx = columnIndex(meta, 'Дата прихода');
        var dateFromMain = dateIdx < 0;
        var remIdx = columnIndex(meta, 'Остаток, м²');
        var remLinIdx = columnIndex(meta, 'Остаток, м');   // погонный остаток — для FIFO-резерва (Фаза 1b)
        var activeIdx = columnIndex(meta, 'В работе');     // #3242: «Активно» переименовано в «В работе»
        if (activeIdx < 0) activeIdx = columnIndex(meta, 'Активно');
        if (activeIdx < 0) activeIdx = columnIndex(meta, 'Активная');
        if (activeIdx < 0) activeIdx = columnIndex(meta, 'Действует');
        return this.getJson('object/' + meta.id + '/?JSON_OBJ&LIMIT=0,5000').then(function(rows) {
            var matById = {};
            self.genBatches = (rows || []).map(function(rec) {
                var r = rec.r || [];
                var mat = matIdx >= 0 ? parseRef(r[matIdx]) : { id: null };
                var materialId = mat.id ? String(mat.id) : '';
                matById[String(rec.i)] = materialId;
                return {
                    id: String(rec.i),
                    label: r[0] == null ? '' : String(r[0]),
                    materialId: materialId,
                    dateKey: dateFromMain ? batchDateKey(r[0]) : batchDateKey(r[dateIdx]),
                    remainder: remIdx >= 0 ? (Number(r[remIdx]) || 0) : 0,
                    remainderLinear: remLinIdx >= 0 ? (Number(r[remLinIdx]) || 0) : 0,
                    active: activeIdx >= 0 ? r[activeIdx] : ''
                };
            });
            self.batchMaterialById = matById;
        });
    };

    // Расход сырья (1079, подчинён резке): this.consumptionByCut = {cutId:[{id,batchId,m2}]},
    // this.reservedM2ByBatch = {batchId: Σ Израсходовано, м²}. Источник «зарезервированного»
    // сырья для FIFO-резерва (Фаза 1b) и подсветки. Таблица резолвится по имени из _metaAll.
    AtexProductionPlanning.prototype.loadConsumption = function() {
        var self = this;
        var list = this._metaAll || [];
        var meta = tableByName(list, 'Расход сырья');
        if (!meta) { this.consumptionByCut = {}; this.reservedM2ByBatch = {}; this.consumptionMeta = null; return Promise.resolve(); }
        this.consumptionMeta = meta;
        var batchIdx = columnIndex(meta, 'Партия сырья');
        var m2Idx = columnIndex(meta, 'Израсходовано, м²');
        return this.getJson('object/' + meta.id + '/?JSON_OBJ&LIMIT=0,5000').then(function(rows) {
            var byCut = {}, byBatch = {};
            (rows || []).forEach(function(rec) {
                var r = rec.r || [];
                var cutId = String(rec.u);   // up = резка
                var batch = batchIdx >= 0 ? parseRef(r[batchIdx]) : { id: null };
                var m2 = m2Idx >= 0 ? (Number(r[m2Idx]) || 0) : 0;
                if (!byCut[cutId]) byCut[cutId] = [];
                byCut[cutId].push({ id: String(rec.i), batchId: batch.id ? String(batch.id) : '', m2: m2 });
                if (batch.id) byBatch[String(batch.id)] = (byBatch[String(batch.id)] || 0) + m2;
            });
            self.consumptionByCut = byCut;
            self.reservedM2ByBatch = byBatch;
        });
    };

    // FIFO-резерв сырья резки в «Расход сырья» (Фаза 1b): требуемый прогон (max «Метраж, м»
    // обеспечений) набираем по партиям вида сырья (FIFO по приходу), исключая чужие резервы;
    // прежние записи расхода этой резки удаляем и создаём заново (идемпотентно). Триггер —
    // явное действие (кнопка/планирование). Возвращает Promise.
    AtexProductionPlanning.prototype.reserveCutMaterial = function(cut) {
        var self = this;
        var meta = this.consumptionMeta;
        if (!meta || !cut) return Promise.resolve();
        if (this.busy) return Promise.resolve();
        var materialId = cut.materialId ? String(cut.materialId) : '';
        if (materialId === '') { this.notify('У задания не задано сырьё — резерв невозможен', 'error'); return Promise.resolve(); }
        var widthM = (Number(this.jumboWidthByMaterial[materialId]) || 0) / 1000;
        var requiredLin = cutRunLength(cut, this.supplies, this.footageBySupply);
        // свободный остаток без учёта собственных прежних резервов этой резки (их перезапишем)
        var existing = (this.consumptionByCut && this.consumptionByCut[String(cut.id)]) || [];
        var reservedExcl = {};
        for (var k in this.reservedM2ByBatch) { if (Object.prototype.hasOwnProperty.call(this.reservedM2ByBatch, k)) reservedExcl[k] = this.reservedM2ByBatch[k]; }
        existing.forEach(function(e) { if (e.batchId) reservedExcl[e.batchId] = (reservedExcl[e.batchId] || 0) - e.m2; });
        var batches = fifoBatchesForMaterial(this.genBatches, reservedExcl, materialId, widthM);
        var plan = reserveFifo(batches, requiredLin, widthM);
        var reqBatch = reqIdByName(meta, 'Партия сырья');
        var reqM2 = reqIdByName(meta, 'Израсходовано, м²');
        var rawActiveReq = activeReqId(this.meta.materialBatch);
        var freeByBatch = {};
        batches.forEach(function(b) { freeByBatch[String(b.id)] = Number(b.freeLinearM) || 0; });
        var ops = [];
        existing.forEach(function(e) { ops.push(function() { return self.post('_m_del/' + e.id + '?JSON', {}); }); });
        plan.allocations.forEach(function(a) {
            var fields = {};
            if (reqBatch) fields['t' + reqBatch] = a.batchId;
            if (reqM2) fields['t' + reqM2] = a.m2;
            ops.push(function() { return self.post('_m_new/' + meta.id + '?JSON&up=' + encodeURIComponent(cut.id), fields); });
            if (rawActiveReq && (Number(a.linearM) || 0) >= (freeByBatch[String(a.batchId)] || 0) - 1e-6) {
                ops.push(function() {
                    var activeFields = {};
                    activeFields['t' + rawActiveReq] = '0';
                    return self.post('_m_set/' + encodeURIComponent(a.batchId) + '?JSON', activeFields);
                });
            }
        });
        this.setBusy(true);
        return ops.reduce(function(p, op) { return p.then(op); }, Promise.resolve())
            .then(function() { return self.loadConsumption(); })
            .then(function() { return self.loadGenBatches(); })
            .then(function() {
                self.setBusy(false);
                self.notify(plan.fullyReserved
                    ? ('Зарезервировано сырьё: ' + plan.allocations.length + ' партий(и)')
                    : ('Не хватило сырья: дефицит ' + plan.shortfallLinearM + ' м'),
                    plan.fullyReserved ? 'success' : 'error');
                self.render();
            })
            .catch(function(err) { self.setBusy(false); self.notify('Ошибка резерва: ' + err.message, 'error'); });
    };

    // Полосы всех резок отчётом cut_strips (JSON_KV) → this.stripAgg
    // (карта cutId → {knifeCount, knifeWidths}). knifeCount/knifeWidths влиты в
    // дескриптор каждой резки в loadPlanning (колонка cut_knives отчёта cut_planning
    // удалена в F2 — knifeCount теперь считается клиентом из Полос).
    AtexProductionPlanning.prototype.loadCutStrips = function() {
        var self = this;
        return this.getJson('report/cut_strips?JSON_KV&LIMIT=0,5000').then(function(rows) {
            self.stripAgg = aggregateStrips(rows || []);
        });
    };

    // Метраж обеспечений: this.footageBySupply = { supplyId: «Метраж, м» }. Нужен для
    // длины прогона резки (макс по её обеспечениям) → длительность намотки (расписание).
    // cut_planning может отдавать supply_footage; object/ по «Обеспечение» остаётся
    // полным источником и мержится, потому загрузки идут параллельно.
    AtexProductionPlanning.prototype.loadSupplyFootage = function() {
        var self = this;
        var meta = this.meta.supply;
        if (!meta) { this.footageBySupply = this.footageBySupply || {}; return Promise.resolve(); }
        var footIdx = columnIndex(meta, SUPPLY_REQ.footage);
        return this.getJson('object/' + meta.id + '/?JSON_OBJ&LIMIT=0,5000').then(function(rows) {
            var map = self.footageBySupply || {};
            (rows || []).forEach(function(rec) {
                var r = rec.r || [];
                var key = String(rec.i);
                var value = footIdx >= 0 ? (Number(r[footIdx]) || 0) : 0;
                if (value > 0 || stripNum(map[key]) <= 0) map[key] = value;
            });
            self.footageBySupply = map;
        });
    };

    // #3508: прямая карта флага «Зафиксировано» из object/ «Задание в производство».
    // Нужна как источник истины после _m_set: отчёт cut_planning может отставать/отдать
    // старый alias и вовсе НЕ содержит «Зафиксировано». (#3923: «Очередность» больше не
    // читается — порядок задаёт planStart; форма ответа { seq:{}, fixed } сохранена.)
    // Возвращает { seq: {}, fixed: { cutId: bool } }.
    AtexProductionPlanning.prototype.loadCutSequences = function() {
        var meta = this.meta.cut;
        if (!meta) return Promise.resolve({ seq: {}, fixed: {} });
        var fixedIdx = columnIndex(meta, CUT_REQ.fixed);   // #3508
        if (fixedIdx < 0) return Promise.resolve({ seq: {}, fixed: {} });
        return this.getJson('object/' + meta.id + '/?JSON_OBJ&LIMIT=0,5000').then(function(rows) {
            var fixed = {};
            (rows || []).forEach(function(rec) {
                var r = rec.r || [];
                fixed[String(rec.i)] = truthyFlag(r[fixedIdx]);   // #3508
            });
            return { seq: {}, fixed: fixed };
        });
    };

    // Ширина джамбо по виду сырья: this.jumboWidthByMaterial = { materialId: ширина }.
    // Таблица «Вид сырья» резолвится по имени из закешированного списка метаданных
    // (this._metaAll); ширина — поле «Ширина, мм» (columnIndex по имени). Ключ карты —
    // abn записи (r.i как String) = тот же id, что приходит в position_material_id /
    // cut_material_id. Нужна как jumboWidth для cut-layout.planLayouts (Task 3).
    AtexProductionPlanning.prototype.loadJumboWidths = function() {
        var self = this;
        var list = this._metaAll || [];
        var meta = tableByName(list, 'Вид сырья');
        if (!meta) { this.jumboWidthByMaterial = {}; this.nominalWidthByMaterial = {}; this.toleranceByMaterial = {}; return Promise.resolve(); }
        var widthIdx = columnIndex(meta, 'Ширина, мм');
        // #3686: «Номинальная ширина» — физический размер рулона (напр. 910). Именно с ней
        // сверяются условия j= справочника «Фактическая ширина резки», а НЕ с «Ширина, мм»
        // (полезная ширина реза после кромки, напр. 891) — иначе правило j=910 не срабатывает.
        var nomIdx = columnIndex(meta, 'Номинальная ширина');
        var tolIdx = columnIndex(meta, 'Допуск, мм');   // #3120: допуск по виду сырья (иначе дефолт)
        return this.getJson('object/' + meta.id + '/?JSON_OBJ&LIMIT=0,5000').then(function(rows) {
            var map = {}, nom = {}, tol = {}, names = {};
            (rows || []).forEach(function(rec) {
                var r = rec.r || [];
                var w = widthIdx >= 0 ? (Number(r[widthIdx]) || 0) : 0;
                map[String(rec.i)] = w;
                // #3686: номинал для условий j=; нет колонки/значения → деградируем к «Ширина, мм»
                // (прежнее поведение), чтобы не потерять резолв у видов сырья без номинала.
                var nw = nomIdx >= 0 ? (Number(r[nomIdx]) || 0) : 0;
                nom[String(rec.i)] = nw > 0 ? nw : w;
                // сырое значение допуска (пустое — если не задано): resolveTolerance даст дефолт
                tol[String(rec.i)] = tolIdx >= 0 ? r[tolIdx] : '';
                names[String(rec.i)] = r[0] == null ? '' : String(r[0]);   // имя вида сырья (для подписи)
            });
            self.jumboWidthByMaterial = map;
            self.nominalWidthByMaterial = nom;   // #3686
            self.toleranceByMaterial = tol;
            self.materialNameById = names;
        });
    };

    // #3688/#3862: текущая заправка каждого станка из отчёта prev_cut_setup → this.prevSetupBySlitter
    // = { slitterId: { materialId, winding, knifeWidths, knifeCount } } по ПОСЛЕДНЕЙ задаче станка
    // СТРОГО ДО начала окна планирования. Нужна для переналадки ПЕРВОЙ резки очереди: если перед
    // планируемым днём на станке осталось другое сырьё/намотка/набор ножей (или ничего) — бронируем
    // настройку ножей и смену сырья; нет данных → firstCutSetup (ножи с нуля).
    //
    // #3862 (issue #3737): «предыдущая заправка» берётся из отчёта prev_cut_setup (report 93371)
    // с фильтрами FR_slitter_id={станок} и FR_task_start=<{планБаза} — ОДИН лёгкий запрос на
    // станок. Раньше тянули отчёт ЦЕЛИКОМ (LIMIT 5000, без фильтров) и брали «верхнюю по task_start»
    // на клиенте; но после генерации в отчёте уже лежат задачи ЭТОГО же нового плана (их task_start
    // в будущем), и «верхняя» оказывалась будущей задачей плана → ложная конфигурация → лишняя смена
    // сырья → окно первой резки 51 вместо 36 (расхождение карточки и модалки). Фильтр
    // task_start<планБаза эти задачи отсекает: остаётся только реальная заправка ДО дня.
    AtexProductionPlanning.prototype.loadPrevCutSetup = function() {
        var self = this;
        this.prevSetupBySlitter = {};
        var slitters = this.slitters || [];
        if (!slitters.length) return Promise.resolve();
        // База планирования (полночь дня «С» из фильтра, без него — сегодня), сек.
        var planBaseSec = Math.floor(Number(planBaseMidnightFrom(this.filter && this.filter.date, controllerNowMs(this))) / 1000);
        if (!isFinite(planBaseSec) || planBaseSec <= 0) return Promise.resolve();
        var map = {};
        return Promise.all(slitters.map(function(s) {
            var sid = String(s && s.id == null ? '' : s.id);
            if (sid === '') return Promise.resolve();
            // FR_task_start=%3C{планБаза} = task_start < планБаза (только задачи ДО планируемого дня).
            return self.getJson('report/prev_cut_setup?JSON_KV&FR_slitter_id=' + encodeURIComponent(sid) +
                    '&FR_task_start=%3C' + planBaseSec)
                .then(function(rows) {
                    // prevSetupFromRows берёт верхнюю по task_start = ПОСЛЕДНЮЮ задачу станка до дня.
                    var setup = prevSetupFromRows(rows, sid);
                    if (setup) map[sid] = setup;
                })
                .catch(function() { /* нет отчёта/данных по станку — без заправки (firstCutSetup) */ });
        })).then(function() { self.prevSetupBySlitter = map; });
    };

    // #3372: справочник «Фактическая ширина резки» → this.actualWidthIndex.
    // Таблица/колонки резолвятся по имени из _metaAll (схемоустойчиво при пересборке
    // БД). Главное значение записи (r[0]) — фактическая ширина; «Ширина в заказе» —
    // номинал; «Код» — условие применения. Нет таблицы/доступа → пустой индекс
    // (фича тихо деградирует к номиналу).
    AtexProductionPlanning.prototype.loadActualWidths = function() {
        var self = this;
        this.actualWidthIndex = {};
        var meta = tableByName(this._metaAll || [], 'Фактическая ширина резки');
        if (!meta) return Promise.resolve();
        var orderIdx = columnIndex(meta, 'Ширина в заказе');
        var codeIdx = columnIndex(meta, 'Код');
        return this.getJson('object/' + meta.id + '/?JSON_OBJ&LIMIT=0,5000').then(function(rows) {
            var list = (rows || []).map(function(rec) {
                var r = rec.r || [];
                return {
                    actual: r[0],
                    order: orderIdx >= 0 ? r[orderIdx] : null,
                    code: codeIdx >= 0 ? r[codeIdx] : ''
                };
            });
            self.actualWidthIndex = buildActualWidthIndex(list);
        }).catch(function() { self.actualWidthIndex = {}; });
    };

    // #3372: диаметр втулки в дюймах по id записи «Диаметр втулки» (8188 «Дюймы»)
    // → this.sleeveInchesById = { sleeveId: дюймы }. Контекст для условия 's=…'
    // фактической ширины. Нет колонки/доступа → пустая карта.
    AtexProductionPlanning.prototype.loadSleeveInches = function() {
        var self = this;
        this.sleeveInchesById = {};
        var meta = tableByName(this._metaAll || [], 'Диаметр втулки');
        if (!meta) return Promise.resolve();
        var inchIdx = columnIndex(meta, 'Дюймы');
        if (inchIdx < 0) return Promise.resolve();
        return this.getJson('object/' + meta.id + '/?JSON_OBJ&LIMIT=0,2000').then(function(rows) {
            var map = {};
            (rows || []).forEach(function(rec) {
                var raw = (rec.r || [])[inchIdx];
                if (raw == null || String(raw).trim() === '') return;
                var n = Number(raw);
                if (isFinite(n)) map[String(rec.i)] = n;
            });
            self.sleeveInchesById = map;
        }).catch(function() { self.sleeveInchesById = {}; });
    };

    // #3812: ширина втулки в мм по id записи «Диаметр втулки» → this.sleeveWidthById =
    // { sleeveId: мм }. Источник: реквизит «Ширина втулки, мм» (если заведён), иначе
    // фолбэк — ширина из НАЗВАНИЯ записи («… ширина 110 мм», parseSleeveWidthFromName).
    // Контекст для втулочных полос (57 vs 110). Нет данных → запись без ширины (полосы
    // не добавляются; обратная совместимость).
    AtexProductionPlanning.prototype.loadSleeveWidths = function() {
        var self = this;
        this.sleeveWidthById = {};
        var meta = tableByName(this._metaAll || [], 'Диаметр втулки');
        if (!meta) return Promise.resolve();
        var wIdx = columnIndex(meta, 'Ширина втулки, мм');
        if (wIdx < 0) wIdx = columnIndex(meta, 'Ширина втулки');
        return this.getJson('object/' + meta.id + '/?JSON_OBJ&LIMIT=0,2000').then(function(rows) {
            var map = {};
            (rows || []).forEach(function(rec) {
                var r = rec.r || [];
                var raw = wIdx >= 0 ? r[wIdx] : null;
                var n = (raw != null && String(raw).trim() !== '') ? Number(raw) : NaN;
                if (!isFinite(n) || !(n > 0)) n = parseSleeveWidthFromName(r[0]); // r[0] — название записи
                if (isFinite(n) && n > 0) map[String(rec.i)] = Number(n);
            });
            self.sleeveWidthById = map;
        }).catch(function() { self.sleeveWidthById = {}; });
    };

    // #3372: проставить позициям фактическую ширину резки. Номинал заказа
    // сохраняется в orderWidth (для отображения), а width становится фактической —
    // её используют раскладка, полосы, Партии ГП и обеспечение (вся геометрия
    // раскроя). Идемпотентно: резолв всегда от orderWidth. Вызывается после загрузки
    // позиций, ширин джамбо и справочников 66190/8188.
    AtexProductionPlanning.prototype.annotatePositionsCutWidth = function() {
        var self = this;
        (this.genPositions || []).forEach(function(p) {
            if (p.orderWidth == null) p.orderWidth = p.width;   // номинал из заказа
            var ctx = {
                // #3686: условие j= сверяется с «Номинальной шириной» рулона, не с «Ширина, мм»
                jumbo: self.nominalWidthByMaterial ? self.nominalWidthByMaterial[String(p.materialId)] : null,
                inches: self.sleeveInchesById ? self.sleeveInchesById[String(p.sleeveId)] : null
            };
            p.width = resolveCutWidth(p.orderWidth, ctx, self.actualWidthIndex);
            // #3812: контекст втулки 0.5″ — производимость и план втулочных полос 110 мм.
            // Считаем по НОМИНАЛЬНОЙ ширине заказа (диапазоны 55–57/63–64 заданы в ней).
            p.sleeveInches = ctx.inches == null ? null : Number(ctx.inches);
            p.sleeveWidth = (self.sleeveWidthById && self.sleeveWidthById[String(p.sleeveId)] != null)
                ? Number(self.sleeveWidthById[String(p.sleeveId)]) : null;
            p.producible = isSleeveWidthProducible(p.sleeveInches, p.orderWidth);
            var corePlan = sleeveCoreStripPlan(p.sleeveInches, p.sleeveWidth, [p.orderWidth]);
            p.coreStripCount = corePlan.count;
            p.coreStripWidth = corePlan.count > 0 ? corePlan.stripWidth : 0;
        });
    };

    // #3340: партии втулок «в работе» из отчёта sleeve_batches_active (для FIFO-подбора
    // «Партии сырья» при создании «Задачи на втулки») + резолв id втулкореза TC-20.
    // → this.sleeveBatches = [{ id, diameterId, dateKey, remaining, active }].
    AtexProductionPlanning.prototype.loadSleeveBatches = function() {
        var self = this;
        var batches = this.getJson('report/sleeve_batches_active?JSON_KV&LIMIT=0,5000').then(function(rows) {
            self.sleeveBatches = (rows || []).map(function(row) {
                return {
                    id: row.batch_id == null ? '' : String(row.batch_id),
                    diameterId: row.sleeve_diameter_id == null ? '' : String(row.sleeve_diameter_id).trim(),
                    dateKey: Number(row.batch_date) || 0,
                    remaining: stripNum(row.remaining_m),
                    active: String(row.active == null ? '' : row.active).trim() !== ''
                };
            });
        }).catch(function() { self.sleeveBatches = []; });
        return Promise.all([batches, this.resolveSleeveCutterId()]);
    };

    // #3340: id втулкореза TC-20 — резолв по имени из ref-таблицы реквизита «Втулкорез»
    // задания (схемоустойчиво при пересборке БД). Не найден → '' (поле пропускается).
    AtexProductionPlanning.prototype.resolveSleeveCutterId = function() {
        var self = this;
        self.sleeveCutterId = '';
        var meta = this.meta.sleeveTask;
        if (!meta) return Promise.resolve();
        var cutterReq = reqByName(meta, SLEEVE_TASK_REQ.cutter);
        var refTable = cutterReq && cutterReq.ref;
        if (!refTable) return Promise.resolve();
        return this.getJson('object/' + refTable + '/?JSON_DATA&LIMIT=0,200').then(function(rows) {
            (rows || []).forEach(function(rec) {
                var name = String(((rec.r || [])[0]) == null ? '' : (rec.r || [])[0]).trim();
                if (name === SLEEVE_CUTTER_NAME) self.sleeveCutterId = String(rec.i);
            });
        }).catch(function() {});
    };

    // #3340: поля создаваемой «Задачи на втулки» (1080). Главное значение t1080 =
    // запланированный старт (Unix, как у резки); «Кол-во» = qty; «Втулкорез» = TC-20;
    // «Партия сырья» = FIFO-партия втулок по типу. Отсутствующие реквизиты/значения — пропуск.
    AtexProductionPlanning.prototype.buildSleeveTaskFields = function(reqIds, task, plannedStart) {
        var meta = this.meta.sleeveTask;
        var fields = {};
        if (reqIds.qty && task.qty) fields['t' + reqIds.qty] = task.qty;
        if (reqIds.cutter && this.sleeveCutterId) fields['t' + reqIds.cutter] = this.sleeveCutterId;
        var batchId = pickSleeveBatchId(this.sleeveBatches, task.sleeveId);
        if (reqIds.batch && batchId) fields['t' + reqIds.batch] = batchId;
        return addMainValueField(meta, fields, plannedStart);  // t1080 = запланированный старт
    };

    // #3340: id реквизитов задания на втулки (по именам реальной схемы). Нет таблицы → null.
    AtexProductionPlanning.prototype.sleeveTaskReqIds = function() {
        var meta = this.meta.sleeveTask;
        if (!meta) return null;
        return {
            cutter: reqIdByName(meta, SLEEVE_TASK_REQ.cutter),
            qty: reqIdByName(meta, SLEEVE_TASK_REQ.qty),
            batch: reqIdByName(meta, SLEEVE_TASK_REQ.batch)
        };
    };

    // Времена операций из таблицы «Время операции, мин» (13588) по кодам (колонка
    // «Код операции»; главное значение записи = минуты). this.opTimes = {КОД: мин},
    // this.changeTimes = веса переналадок для changeoverCost. Если таблицы/кодов нет —
    // changeTimes=null (changeoverCost берёт DEFAULT_OP_TIMES).
    AtexProductionPlanning.prototype.loadOperationTimes = function() {
        var self = this;
        var list = this._metaAll || [];
        var meta = tableByName(list, 'Время операции, мин');
        if (!meta) { this.opTimes = {}; this.changeTimes = null; return Promise.resolve(); }
        var codeIdx = columnIndex(meta, 'Код операции');
        return this.getJson('object/' + meta.id + '/?JSON_OBJ&LIMIT=0,200').then(function(rows) {
            var raw = {};
            (rows || []).forEach(function(rec) {
                var r = rec.r || [];
                var code = codeIdx >= 0 ? String(r[codeIdx] == null ? '' : r[codeIdx]).trim() : '';
                if (code) raw[code] = Number(r[0]) || 0;   // r[0] — главное значение = минуты
            });
            self.opTimes = raw;
            self.changeTimes = {
                MATERIAL_WINDING: raw.MATERIAL_WINDING != null ? raw.MATERIAL_WINDING : DEFAULT_OP_TIMES.MATERIAL_WINDING,
                KNIFE: Math.max(Number(raw.KNIFE_220_59) || 0, Number(raw.KNIFE_LE_59) || 0) || DEFAULT_OP_TIMES.KNIFE,
                // #3472: стоимость одного перемещения ножа (код «KNIFE_MOVE»); дефолт 2 мин.
                KNIFE_MOVE: raw.KNIFE_MOVE != null ? raw.KNIFE_MOVE : DEFAULT_OP_TIMES.KNIFE_MOVE,
                BETWEEN_CUTS: raw.BETWEEN_CUTS != null ? raw.BETWEEN_CUTS : DEFAULT_OP_TIMES.BETWEEN_CUTS,
                CLEANUP_SHIFT: raw.CLEANUP_SHIFT != null ? raw.CLEANUP_SHIFT : DEFAULT_OP_TIMES.CLEANUP_SHIFT
            };
            self.defaultToleranceMm = raw.DEFAULT_DEVIATION != null ? raw.DEFAULT_DEVIATION : DEFAULT_TOLERANCE_MM;
        });
    };

    // Допуск остатка для вида сырья: «Допуск, мм» из справочника, иначе DEFAULT_TOLERANCE_MM.
    AtexProductionPlanning.prototype.resolveToleranceMm = function(materialId) {
        var raw = this.toleranceByMaterial ? this.toleranceByMaterial[String(materialId)] : '';
        var def = (this.defaultToleranceMm != null) ? this.defaultToleranceMm : DEFAULT_TOLERANCE_MM;
        return resolveTolerance(raw, def);
    };

    // #3706: статус остатка джамбо резки относительно допуска — для цвета кнопки
    // «Полосы» в очереди. Тонкая обёртка над чистой planning.cutRemainderStatus:
    // джамбо — «Ширина, мм» вида сырья, допуск — resolveToleranceMm.
    AtexProductionPlanning.prototype.cutRemainderStatus = function(cut) {
        var jumbo = (this.jumboWidthByMaterial || {})[String(cut.materialId)];
        return planning.cutRemainderStatus(jumbo, cut.knifeWidths, this.resolveToleranceMm(cut.materialId));
    };

    // Ходовые ширины для сырья отчётом preferable_widths (JSON_KV, фильтр по сырью,
    // направлению и длине намотки).
    // → [{ width:Number(position_width_mm), popularity:Number(position_qty_sum) }];
    // кешируется в this.preferredByMaterial[materialId|windDir|windLength].
    // (Task 3/4 — генерация и панель ходовых). Возвращает Promise с массивом.
    AtexProductionPlanning.prototype.loadPreferredWidths = function(materialId, windDir, windLength) {
        var self = this;
        var mat = String(materialId == null ? '' : materialId).trim();
        var dir = normWinding(windDir);
        var lenKey = windLengthKey(windLength);
        var cacheKey = preferredWidthsKey(mat, dir, lenKey);
        if (mat === '') return Promise.resolve([]);
        if (this.preferredByMaterial[cacheKey]) return Promise.resolve(this.preferredByMaterial[cacheKey]);
        var params = ['JSON_KV', 'FR_position_material_id=' + encodeURIComponent(mat)];
        if (dir) params.push('FR_wind_dir=' + encodeURIComponent(dir));
        if (lenKey) params.push('FR_wind_length=' + encodeURIComponent(lenKey));
        console.log('[pp] 📏 loadPreferredWidths: запрос для сырья id=' + mat + ', намотка=' + dir + ', длина=' + lenKey + '...');
        return this.getJson('report/preferable_widths?' + params.join('&')).then(function(rows) {
            var list = (rows || []).filter(function(row) {
                return preferredWidthMatchesProfile(row, dir, lenKey);
            }).map(function(row) {
                return {
                    width: Number(row.position_width_mm) || 0,
                    popularity: Number(row.position_qty_sum) || 0
                };
            });
            self.preferredByMaterial[cacheKey] = list;
            console.log('[pp] 📏 loadPreferredWidths: для ключа ' + cacheKey + ' получено ширин:', list.length, list.slice(0,5));
            return list;
        });
    };

    AtexProductionPlanning.prototype.reportCutPlanningDiagnostics = function(rows) {
        var diagnostics = cutPlanningReportDiagnostics(rows);
        if (!diagnostics.length) {
            this._lastCutPlanningDiagnosticKey = '';
            return;
        }
        var columns = rows && rows[0] ? Object.keys(rows[0]).sort() : [];
        var key = diagnostics.map(function(d) { return d.key; }).join('|');
        if (typeof console !== 'undefined' && console.error) {
            console.error('[pp] ❌ cut_planning: не хватает данных отчёта — ' + cutWriteDiagnosticSummary(diagnostics), {
                diagnostics: diagnostics,
                columns: columns
            });
        }
        if (key !== this._lastCutPlanningDiagnosticKey) {
            this._lastCutPlanningDiagnosticKey = key;
            this.notify('Ошибка отчёта cut_planning: ' + diagnostics.map(function(d) {
                return d.label;
            }).join(', '), 'error');
        }
    };

    // Очередь резок и их обеспечение одним отчётом cut_planning (JSON_KV).
    // Заполняет this.cuts и this.supplies из плоских строк отчёта; вливает
    // knifeCount/knifeWidths из this.stripAgg (cut_strips) в каждую резку.
    AtexProductionPlanning.prototype.loadPlanning = function() {
        var self = this;
        console.log('[pp] 📅 loadPlanning: запрос cut_planning...');
        return Promise.all([
            this.getJson('report/cut_planning?JSON_KV&LIMIT=0,5000'),
            this.loadCutSequences()
        ]).then(function(results) {
            var rows = results[0];
            var seqResult = results[1] || {};
            var fixedByCut = seqResult.fixed || {};   // #3508
            self.reportCutPlanningDiagnostics(rows || []);
            var p = rowsToPlanning(rows || []);
            var agg = self.stripAgg || {};
            p.cuts.forEach(function(cut) {
                var a = agg[String(cut.id)] || {};
                cut.knifeCount = a.knifeCount || 0;
                cut.knifeWidths = a.knifeWidths || [];
                cut.fixed = !!fixedByCut[String(cut.id)];   // #3508: флаг «Зафиксировано» (#3923: «Очередность» не читаем)
            });
            if (!self.footageBySupply) self.footageBySupply = {};
            p.supplies.forEach(function(supply) {
                var f = supplyFootage(supply, null);
                if (f > 0) self.footageBySupply[String(supply.id)] = f;
            });
            self.cuts = p.cuts;
            self.supplies = p.supplies;
            console.log('[pp] 📅 loadPlanning: загружено резок:', p.cuts.length, ', обеспечений:', p.supplies.length);
        });
    };

    // Применить материал из обеспечиваемых позиций к this.cuts (#3120 Фаза 2): приоритет —
    // демэнд (позиции, materialByCut); если у резки нет таких позиций — остаётся материал из
    // cut_planning (ссылка «Партия сырья» 1159 как fallback, пока она есть). Вызывать после
    // загрузки позиций и очереди.
    AtexProductionPlanning.prototype.resolveCutMaterials = function() {
        var self = this;
        if (!this.cuts) return;
        var byCut = materialByCut(this.cuts, this.supplies, this.genPositions);
        this.cuts.forEach(function(c) {
            var m = byCut[String(c.id)];
            if (m) {
                c.materialId = m;
                c.materialName = (self.materialNameById && self.materialNameById[m]) || c.materialName || '';
            }
        });
        // #3808: переходящие сегменты с пустым «Видом сырья» (обеспечения которых ведут на
        // НЕактивную позицию → materialByCut их не восстановил) лечим по цепочке станок|намотка|
        // ножи (см. healContinuationMaterials). После этого materialId согласован у всей цепочки,
        // поэтому continuationSignature снова объединяет сегменты, и applySplitPlan (#3795) при
        // ближайшем сохранении пропишет «Вид сырья» в БД (т.е. лечение и отображается, и
        // персистится).
        var healed = healContinuationMaterials(this.cuts);
        healed.forEach(function(id) {
            var c = self.cuts.filter(function(x) { return String(x.id) === String(id); })[0];
            if (c && !c.materialName) {
                c.materialName = (self.materialNameById && self.materialNameById[String(c.materialId)]) || c.materialName || '';
            }
        });
    };

    // Число привязок (обеспечений) к конкретной резке.
    AtexProductionPlanning.prototype.supplyCount = function(cutId) {
        return this.supplies.filter(function(s) { return String(s.cutId) === String(cutId); }).length;
    };

    // ── Запись ──

    // Создание производственной резки. Главное значение пишется как `t{tableId}` (#3225).
    AtexProductionPlanning.prototype.createCut = function() {
        var self = this;
        if (this.busy) return;
        var meta = this.meta.cut;
        var d = this.draft;
        console.log('[pp] 🔪 createCut: начало. станок=', d.slitterId, 'план.прогонов=', d.plannedRuns, 'статус=', d.status, 'выбрано позиций:', (d.selectedPositions||[]).length);
        if (!d.slitterId) { this.notify('Выберите станок', 'error'); return; }
        var selectedPositions = d.selectedPositions || [];
        var posById = positionMap(this.genPositions);
        var runLength = layoutRunLength({ positionsCovered: selectedPositions }, posById);

        // Стоп-лист станка: сырьё выбранной партии не должно быть запрещено на станке.
        if (d.materialBatchId) {
            var slit = this.slitters.filter(function(s) { return String(s.id) === String(d.slitterId); })[0];
            var matId = this.batchMaterialById && this.batchMaterialById[String(d.materialBatchId)];
            var stop = (slit && slit.stopMaterialIds) || [];
            if (matId && isMaterialBlocked(stop, matId)) {
                var batch = this.materialBatches.filter(function(b) { return String(b.id) === String(d.materialBatchId); })[0];
                this.notify('Сырьё «' + ((batch && batch.label) || matId) + '» запрещено на станке «' + ((slit && slit.label) || d.slitterId) + '»', 'error');
                return;
            }
            // #4006: лимит ширины джамбо станка («Код» j<1000) — широкое сырьё на такой станок не ставим.
            if (matId && slit && isSlitterWidthBlocked(slit.widthCode, this.nominalWidthByMaterial && this.nominalWidthByMaterial[String(matId)])) {
                var batchW = this.materialBatches.filter(function(b) { return String(b.id) === String(d.materialBatchId); })[0];
                this.notify('Ширина сырья «' + ((batchW && batchW.label) || matId) + '» превышает лимит станка «' + ((slit && slit.label) || d.slitterId) + '»', 'error');
                return;
            }
        }

        var reqIds = {
            slitter: reqIdByName(meta, CUT_REQ.slitter),
            materialBatch: reqIdByName(meta, CUT_REQ.materialBatch),
            plannedRuns: reqIdByAnyName(meta, CUT_PLANNED_RUNS_NAMES),   // #3242: «Кол-во резок план»
            duration: reqIdByName(meta, CUT_REQ.duration),
            timing: reqIdByName(meta, CUT_REQ.timing),
            length: reqIdByName(meta, CUT_REQ.length),
            planDate: reqIdByName(meta, CUT_REQ.planDate),
            status: reqIdByName(meta, CUT_REQ.status),
            notes: reqIdByName(meta, CUT_REQ.notes)
        };
        var duration = plannedCutDurationMinutes(runLength, d.plannedRuns, this.opTimes, d.isFoil); // #3606
        var timing = cutTimingDetails(runLength, d.plannedRuns, this.opTimes, d.isFoil);
        var cutMainState = { last: this.lastCutMainValue };
        var cutMainValue = nextCutMainValue(this.cuts, controllerNowMs(this), cutMainState);
        this.lastCutMainValue = cutMainState.last;
        var fields = buildFields(reqIds, {
            slitter: d.slitterId,
            materialBatch: d.materialBatchId,
            plannedRuns: d.plannedRuns,
            duration: duration > 0 ? Math.ceil(duration) : '',   // #3635 п.4: «Длительность, минут» сохраняем целой (вверх)
            timing: timing,
            length: runLength > 0 ? runLength : '',
            planDate: d.planDate,
            status: d.status,
            notes: d.notes
            // #3923: «Очередность» не пишем — порядок задаёт planStart (главное значение)
        });
        fields = addMainValueField(meta, fields, cutMainValue);
        var requiredWriteKeys = ['plannedRuns'];
        if (selectedPositions.length) {
            requiredWriteKeys = requiredWriteKeys.concat(['duration', 'timing', 'length']);
        }
        var payloadDiagnostics = traceCutCreatePayload('createCut', meta, reqIds, fields, this, requiredWriteKeys);
        if (payloadDiagnostics.length) {
            this.notify('Не могу создать производственное задание: ' + cutWriteDiagnosticSummary(payloadDiagnostics), 'error');
            return;
        }

        function finishCreatedCut(id) {
            if (!id) throw new Error('Сервер не вернул id нового задания');
            // #3242: «Обеспечение» теперь ссылается на «Партию ГП», которой в ручном
            // создании резки ещё нет (состав добавляется отдельно). Поэтому здесь
            // обеспечения НЕ создаём — иначе вышли бы «сироты» без ссылки. Привязка
            // позиций к резке идёт через генерацию/планирование (создаёт Партии ГП).
            // Ручная привязка к позициям — отдельная доработка (#3242 PR3).
            console.log('[pp] 🔪 createCut: резка #' + id + ' создана (без обеспечений; выбрано позиций: ' + selectedPositions.length + ')');
            return self.reload().then(function() {
                return self.persistCutSetupColumns();   // #3698: активности переналадки новой резки
            }).then(function() {
                self.setBusy(false);
                self.draft = self.blankDraft();
                self.selectedCutId = String(id);
                self.closeForm();
                self.notify('Производственное задание #' + id + ' создано' +
                    (selectedPositions.length ? ' (привязка позиций — через планирование)' : ''), 'success');
                self.render();
            });
        }

        this.setBusy(true);
        // up=1 — корневой объект; `t{tableId}` выше задаёт главное значение записи.
        this.post('_m_new/' + meta.id + '?JSON&up=1', fields).then(function(res) {
            return finishCreatedCut(res && (res.obj || res.id || res.i));
        }).catch(function(err) {
            self.setBusy(false);
            self.notify('Ошибка создания производственного задания: ' + err.message, 'error');
        });
    };

    // ── Резка под одну позицию заказа (форма «Новая производственная резка») ──
    // Строит план резки под выбранную позицию и ручное кол-во рулонов (≤ необеспеченного):
    // раскладка через cut-layout (как при планировании), Партии ГП по ширинам, обеспечение
    // на qty (излишек той же ширины → склад), ближайшее свободное окно станка.
    // → Promise<plan | { error }>. plan.forKey = positionId|qty|slitterId (для проверки актуальности).
    AtexProductionPlanning.prototype.buildCutProspect = function(positionId, qtyRaw) {
        var self = this;
        var layoutCore = (typeof window !== 'undefined' && window.AtexCutLayout && window.AtexCutLayout.layout) || null;
        if (!layoutCore) return Promise.resolve({ error: 'Модуль раскладки (cut-layout) не загружен' });
        var posById = positionMap(this.genPositions);
        var position = posById[String(positionId)];
        if (!position) return Promise.resolve({ error: 'Выберите позицию заказа' });
        var remaining = remainingRollsForPosition(position, this.supplies);
        var qty = Math.floor(Number(qtyRaw) || 0);
        if (!(qty > 0)) return Promise.resolve({ error: 'Укажите количество рулонов больше 0' });
        if (qty > remaining) return Promise.resolve({ error: 'Количество больше необеспеченного остатка (' + remaining + ' рул.)' });
        // #3812: втулка 0.5″ — риббон у́же 55 мм не производим.
        if (position.producible === false) return Promise.resolve({ error: 'Втулка 0.5″: риббон шириной < 55 мм не производится' });
        var mat = String(position.materialId == null ? '' : position.materialId);
        var jw = this.jumboWidthByMaterial[mat];
        if (!jw) return Promise.resolve({ error: 'Не задана ширина джамбо для сырья позиции' });
        // #3812: резерв ширины джамбо под втулочные полосы 110 мм (см. annotatePositionsCutWidth).
        var coreCount = position.coreStripCount || 0;
        var coreWidth = position.coreStripWidth || 0;
        var coreReserve = coreCount > 0 && coreWidth > 0 ? round3(coreCount * coreWidth) : 0;
        var effJumbo = round3(jw - coreReserve);
        if (coreReserve > 0 && !(effJumbo >= (Number(position.width) || 0))) {
            return Promise.resolve({ error: 'Втулка ' + coreWidth + ' мм: не хватает ширины джамбо под втулочные полосы' });
        }
        var profile = groupPositionsByPlanningProfile([position])[0] ||
            { key: '', windDir: position.windDir, windLength: position.windLength };
        // #3954: ходовые (preferable_widths) нужны только для добора остатка джамбо на
        // склад — а он возможен лишь по семействам из «Максимального запаса». Иначе отчёт
        // (медленный) не запрашиваем, раскладка идёт без добора (preferred=[]).
        var prefPromise = planning.maxStockFamilyStockable(this.maxStockIndex,
                { material: mat, length: profile.windLength, winding: profile.windDir })
            ? this.loadPreferredWidths(mat, profile.windDir, profile.windLength)
            : Promise.resolve([]);
        return prefPromise.then(function(preferred) {
            var res = layoutCore.planLayouts({
                jumboWidth: effJumbo,
                positions: [{ id: position.id, width: position.width, qty: qty, dueKey: position.dueKey }],
                preferred: preferred || self.preferredByMaterial[profile.key] || [],
                options: { windowDays: WINDOW_DAYS, tolerance: self.resolveToleranceMm(mat) }
            });
            var layouts = (res && res.layouts) || [];
            if (!layouts.length) return { error: 'Не удалось построить раскладку для позиции' };
            var lay = layouts[0];
            lay.mat = mat; lay.windDir = profile.windDir; lay.windLength = profile.windLength;
            if (coreReserve > 0) appendCoreStrip(lay, coreWidth, coreCount); // #3812: втулочные полосы в раскрой
            // posForCalc — единственная позиция с УРЕЗАННЫМ до qty кол-вом (для проходов/обеспечения).
            var posForCalc = [{ id: position.id, width: position.width, qty: qty, length: position.length,
                sleeveId: position.sleeveId, sleeveReady: position.sleeveReady, dueKey: position.dueKey }];
            var runLength = layoutRunLength(lay, posForCalc);
            var plannedRuns = plannedRunsForLayout(lay, posForCalc);
            var batches = producedBatchesForLayout(lay, runLength);
            var posWidthKey = stripWidthKey(position.width);
            var posBatch = batches.filter(function(b) { return stripWidthKey(b.width) === posWidthKey; })[0] || null;
            var stripsPerPass = posBatch ? (Number(posBatch.strips) || 0) : 0;
            var producedPosRolls = round3(stripsPerPass * plannedRuns);
            var sleeveTasks = positionSleeveTasksForLayout(lay, posForCalc, plannedRuns);
            // Ножи проспекта (для оценки переналадки в расписании) — ширины полос ×их количество.
            var knifeWidths = [];
            (lay.strips || []).forEach(function(s) {
                var w = Number(s.width) || 0, q = Math.round(Number(s.qty) || 0);
                for (var i = 0; i < q; i++) knifeWidths.push(w);
            });
            return {
                forKey: String(positionId) + '|' + qty,
                positionId: String(position.id), position: position, qty: qty,
                materialId: mat, layout: lay, plannedRuns: plannedRuns, runLength: runLength,
                duration: plannedCutDurationMinutes(runLength, plannedRuns, self.opTimes, position.isFoil), // #3606
                timing: cutTimingDetails(runLength, plannedRuns, self.opTimes, position.isFoil),
                batches: batches, posWidth: position.width, stripsPerPass: stripsPerPass,
                producedPosRolls: producedPosRolls, supplyRolls: qty,
                stockRolls: round3(Math.max(0, producedPosRolls - qty)),
                sleeveTasks: sleeveTasks, multiLayout: layouts.length > 1,
                // scheduleCut — объект-резка для расчёта свободного окна на любом станке.
                scheduleCut: { id: '__new__', plannedRuns: plannedRuns, materialId: mat,
                    winding: profile.windDir, knifeWidths: knifeWidths, runLength: runLength }
            };
        });
    };

    // Ближайшее свободное окно станка для проспект-резки (повтор расписания очереди).
    // → { windowStartMin, startMin, finishMin, durationMin, setupMin, day, startTs, planBaseMidnightMs } | null.
    AtexProductionPlanning.prototype.freeSlotForCut = function(slitterId, prospect) {
        var self = this;
        var windPoints = windingPointsFromTimes(this.opTimes || {});
        var dayWindow = this.workingWindow();
        var grp = groupBySlitter(this.cuts).filter(function(g) { return String(g.slitter.id) === String(slitterId); })[0];
        var stationCuts = grp ? grp.cuts : [];
        var runLenByCut = {};
        stationCuts.forEach(function(c) { runLenByCut[String(c.id)] = cutRunLength(c, self.supplies, self.footageBySupply); });
        var slot = freeSlotForQueue(stationCuts, prospect, {
            windPoints: windPoints, times: this.changeTimes, runLengthByCut: runLenByCut,
            shiftStartMin: dayWindow.startMin, shiftEndMin: dayWindow.cutEndMin,
            lunchStartMin: dayWindow.lunchStartMin, lunchDurationMin: dayWindow.lunchDurationMin,
            firstCutSetup: true   // #3669 п.2: очередь учитывает настройку ножей первой задачи
        });
        if (!slot) return null;
        // День 0 = дата планирования из фильтра (.atex-pp-input), даже если в прошлом;
        // без даты — сегодня. Как в генерации (#3311), ре-планировании (#3312), очереди (#3316).
        var planBaseMidnightMs = planBaseMidnightFrom(this.filter && this.filter.date, controllerNowMs(this));
        slot.startTs = scheduleStartTimestamp(planBaseMidnightMs, slot.windowStartMin);
        slot.planBaseMidnightMs = planBaseMidnightMs;
        return slot;
    };

    // Гарантирует актуальный draft.prospect под текущие позицию+кол-во (асинхронно),
    // затем перерисовывает форму. Идемпотентна: не пересчитывает, если результат для тех
    // же параметров уже есть (в т.ч. ошибка) или расчёт уже идёт (_computingProspect).
    AtexProductionPlanning.prototype.refreshCutProspect = function() {
        var self = this, d = this.draft;
        var key = String(d.positionId) + '|' + (Math.floor(Number(d.qty) || 0));
        if (this._computingProspect === key) return;
        if (d.prospect && d.prospect.forKey === key) return;
        this._computingProspect = key;
        this.buildCutProspect(d.positionId, d.qty).then(function(pr) {
            self._computingProspect = null;
            if (pr && !pr.forKey) pr.forKey = key;   // пометить и ошибочный результат (не зациклить)
            d.prospect = pr;
            self.renderForm();
        }).catch(function(err) {
            self._computingProspect = null;
            d.prospect = { error: err.message, forKey: key };
            self.renderForm();
        });
    };

    // «Создать резку»: по выбранным позиции/кол-ву/станку создаёт резку → Партии ГП →
    // втулки → обеспечение (на qty рулонов; излишек той же ширины и прочие полосы — склад).
    // Время старта = свободное окно выбранного станка. Раскладку при необходимости пересчитывает.
    AtexProductionPlanning.prototype.createCutForPosition = function() {
        var self = this, d = this.draft;
        if (this.busy) return;
        if (!d.slitterId) { this.notify('Выберите станок', 'error'); return; }
        var cutMeta = this.meta.cut, fbMeta = this.meta.finishedBatch, supplyMeta = this.meta.supply;
        if (!cutMeta || !fbMeta || !supplyMeta) { this.notify('Нет метаданных таблиц задания/Партии ГП/Обеспечения', 'error'); return; }
        var key = String(d.positionId) + '|' + (Math.floor(Number(d.qty) || 0));
        var ensure = (d.prospect && !d.prospect.error && d.prospect.forKey === key)
            ? Promise.resolve(d.prospect)
            : this.buildCutProspect(d.positionId, d.qty);
        this.setBusy(true);
        ensure.then(function(plan) {
            if (!plan || plan.error) { self.setBusy(false); self.notify((plan && plan.error) || 'Не удалось рассчитать раскладку', 'error'); return null; }
            if (!plan.forKey) plan.forKey = key;
            d.prospect = plan;
            var slit = self.slitters.filter(function(s) { return String(s.id) === String(d.slitterId); })[0];
            if (slit && isMaterialBlocked(slit.stopMaterialIds || [], plan.materialId)) {
                self.setBusy(false); self.notify('Сырьё позиции запрещено на выбранном станке', 'error'); return null;
            }
            // #4006: лимит ширины джамбо станка («Код» j<1000) — широкое сырьё на такой станок не ставим.
            if (slit && isSlitterWidthBlocked(slit.widthCode, self.nominalWidthByMaterial && self.nominalWidthByMaterial[String(plan.materialId)])) {
                self.setBusy(false); self.notify('Ширина сырья позиции превышает лимит выбранного станка', 'error'); return null;
            }
            var slot = self.freeSlotForCut(d.slitterId, plan.scheduleCut);
            var planDayTs = slot && slot.startTs > 0 ? String(slot.startTs) : '';
            // #3569: лидер берём из покрываемой позиции (метку резолвим в id справочника).
            var leaderPos = (self.genPositions || []).filter(function(p) { return String(p.id) === String(d.positionId); })[0];
            var cutReqIds = {
                slitter: reqIdByName(cutMeta, CUT_REQ.slitter),
                plannedRuns: reqIdByAnyName(cutMeta, CUT_PLANNED_RUNS_NAMES),
                duration: reqIdByName(cutMeta, CUT_REQ.duration),
                timing: reqIdByName(cutMeta, CUT_REQ.timing),
                length: reqIdByName(cutMeta, CUT_REQ.length),
                winding: reqIdByName(cutMeta, CUT_REQ.winding),
                leader: reqIdByName(cutMeta, CUT_REQ.leader),   // #3569: ссылка «Лидер» (82519)
                material: reqIdByName(cutMeta, CUT_REQ.material), // #3688: ссылка «Вид сырья» (95358)
                active: activeReqId(cutMeta),
                notes: reqIdByName(cutMeta, CUT_REQ.notes)
            };
            var cutMainState = { last: self.lastCutMainValue };
            var cutMainValue = (slot && slot.startTs > 0) ? slot.startTs : nextCutMainValue(self.cuts, controllerNowMs(self), cutMainState);
            self.lastCutMainValue = cutMainState.last;
            var fields = buildFields(cutReqIds, {
                slitter: d.slitterId,
                plannedRuns: plan.plannedRuns,
                duration: plan.duration > 0 ? Math.ceil(plan.duration) : '',   // #3635 п.4: «Длительность, минут» — целой (вверх)
                timing: plan.timing,
                length: plan.runLength > 0 ? plan.runLength : '',
                winding: normWinding(plan.layout && plan.layout.windDir),
                leader: self.resolveLeaderId(leaderPos && leaderPos.leader), // #3569: лидер позиции → id
                material: plan.materialId,   // #3688: «Вид сырья» проспект-резки
                active: (d.active === false) ? '0' : '1',
                notes: d.notes
                // #3923: «Очередность» не пишем — порядок задаёт planStart (главное значение)
            });
            fields = addMainValueField(cutMeta, fields, cutMainValue);

            var sleeveMeta = self.meta.sleeveTask;
            var sleeveReqIds = self.sleeveTaskReqIds();

            return self.post('_m_new/' + cutMeta.id + '?JSON&up=1', fields).then(function(res) {
                var cutId = res && (res.obj || res.id || res.i);
                if (!cutId) throw new Error('Сервер не вернул id нового задания');
                var widthToBatchId = {};
                var chain = Promise.resolve();
                // 1) Партии ГП по ширинам (состав резки).
                plan.batches.forEach(function(b) {
                    chain = chain.then(function() {
                        // #3431/#3433: «Кол-во полос» = полос за проход (b.strips); «Кол-во
                        // план» = полосы × проходов; «Кол-во рулонов» = спрос: для ширины
                        // позиции — её рулоны (plan.qty) под этот заказ, прочие ширины (добор
                        // ходовыми) — в запас (спрос/заказ пусто).
                        var isPosWidth = stripWidthKey(b.width) === stripWidthKey(plan.posWidth);
                        var f = buildFinishedBatchFields(fbMeta, { width: b.width, strips: b.strips,
                            planned: finishedBatchRolls(b.strips, plan.plannedRuns),
                            rolls: isPosWidth && plan.qty > 0 ? plan.qty : '',
                            orderId: isPosWidth ? (plan.position && plan.position.orderId) || '' : '',
                            footage: b.length > 0 ? b.length : '', active: '1' });
                        return self.post('_m_new/' + fbMeta.id + '?JSON&up=' + encodeURIComponent(cutId), f).then(function(r) {
                            var bid = r && (r.obj || r.id || r.i);
                            if (bid) widthToBatchId[stripWidthKey(b.width)] = String(bid);
                        });
                    });
                });
                // 2) Задания на втулки (#3340: если таблица есть). Запланированный старт
                //    задания = плановое время старта резки (cutMainValue).
                if (sleeveMeta && sleeveReqIds) {
                    plan.sleeveTasks.forEach(function(task) {
                        chain = chain.then(function() {
                            var f = self.buildSleeveTaskFields(sleeveReqIds, task, cutMainValue);
                            return self.post('_m_new/' + sleeveMeta.id + '?JSON&up=' + encodeURIComponent(task.positionId), f);
                        });
                    });
                }
                // 3) Обеспечение позиции на qty рулонов (ссылается на Партию ГП ширины позиции).
                chain = chain.then(function() {
                    var batchId = widthToBatchId[stripWidthKey(plan.posWidth)];
                    if (!batchId) throw new Error('Не создана «Партия ГП» ширины позиции — обеспечение пропущено');
                    var f = buildSupplyFieldsForFinishedBatch(supplyMeta, {
                        finishedBatchId: batchId, rolls: plan.qty,
                        footage: plan.position.length > 0 ? plan.position.length : '',
                        active: '1', status: SUPPLY_STATUSES[0]
                    });
                    return self.post('_m_new/' + supplyMeta.id + '?JSON&up=' + encodeURIComponent(plan.positionId), f);
                });
                return chain.then(function() { return cutId; });
            }).then(function(cutId) {
                return self.reload().then(function() {
                    return self.persistCutSetupColumns();   // #3698: активности переналадки новой резки
                }).then(function() {
                    self.setBusy(false);
                    self.draft = self.blankDraft();
                    self.selectedCutId = String(cutId);
                    self.closeForm();
                    self.notify('Производственное задание #' + cutId + ' создано, позиция обеспечена (' + plan.qty + ' рул.)', 'success');
                    self.render();
                });
            });
        }).catch(function(err) {
            self.setBusy(false);
            self.notify('Ошибка создания производственного задания: ' + err.message, 'error');
        });
    };

    // Привязка самостоятельной резки к позиции заказа через «Обеспечение».
    AtexProductionPlanning.prototype.createSupply = function(opts) {
        var self = this;
        if (this.busy) return;
        var meta = this.meta.supply;
        if (!opts.positionId) { this.notify('Выберите позицию заказа', 'error'); return; }
        if (!opts.cutId) { this.notify('Не выбрано производственное задание', 'error'); return; }

        // #3242: «Обеспечение» теперь ссылается на «Партию ГП», а не на резку. Ручная
        // привязка «позиция → резка» без выбора конкретной Партии ГП создала бы
        // «сироту» без ссылки — поэтому временно заблокирована до доработки UI (#3242 PR3).
        if (!opts.finishedBatchId) {
            this.notify('Ручная привязка к производственному заданию временно недоступна: обеспечение теперь ссылается на «Партию ГП». Используйте планирование.', 'error');
            return;
        }
        var fields = buildSupplyFieldsForFinishedBatch(meta, {
            footage: opts.footage,
            finishedBatchId: opts.finishedBatchId,
            rolls: opts.rolls,
            active: opts.active === undefined ? '1' : (truthyFlag(opts.active) ? '1' : '0'),
            status: opts.status || SUPPLY_STATUSES[0]
        });

        this.setBusy(true);
        this.post('_m_new/' + meta.id + '?JSON&up=' + encodeURIComponent(opts.positionId), fields).then(function(res) {
            var id = res && (res.obj || res.id || res.i);
            if (!id) throw new Error('Сервер не вернул id обеспечения');
            return self.loadPlanning().then(function() {
                self.setBusy(false);
                self.notify('Обеспечение создано: позиция связана с производственным заданием', 'success');
                self.render();
            });
        }).catch(function(err) {
            self.setBusy(false);
            self.notify('Ошибка привязки: ' + err.message, 'error');
        });
    };

    // Удалить связь резки с позицией (#3116 п.4): удаляем запись «Обеспечения»
    // по клику «×» (без подтверждения — решение по задаче) и перечитываем очередь.
    AtexProductionPlanning.prototype.deleteSupply = function(supplyId) {
        var self = this;
        if (this.busy || !supplyId) return;
        this.setBusy(true);
        this.post('_m_del/' + encodeURIComponent(supplyId) + '?JSON', {}).then(function() {
            return self.loadPlanning().then(function() {
                self.setBusy(false);
                self.notify('Связь с позицией удалена', 'info');
                self.render();
                // #3318 п.2: если открыт редактор полос — переоткрыть, чтобы «Назначение»
                // полосы обновилось (Заказ→Склад) и удаление снова стало доступным.
                self.reopenStripsIfOpen();
            });
        }).catch(function(err) {
            self.setBusy(false);
            self.notify('Ошибка удаления связи: ' + err.message, 'error');
        });
    };

    // #3508 п.2/п.4: проставить/снять флаг «Зафиксировано» у набора заданий. Пишем булев
    // реквизит (t{id}='1'/'0') командой _m_set, затем перечитываем очередь — серая кайма/
    // блокировки (п.3/п.5) обновятся по источнику истины. #3562: плановый старт при фиксации
    // больше не «захватывается» — автогенерация вольна двигать задание по времени и очереди.
    AtexProductionPlanning.prototype.setCutsFixed = function(cutIds, value, opts) {
        var self = this;
        var o = opts || {};
        if (this.busy) return Promise.resolve(false);
        var ids = (cutIds || []).map(function(x) { return String(x); })
            .filter(function(id) { return id && id !== 'null'; });
        if (!ids.length) {
            if (!o.silent) self.notify(o.emptyMessage || 'Нет заданий для фиксации', 'info');
            return Promise.resolve(false);
        }
        var fixedReqId = reqIdByName(this.meta.cut, CUT_REQ.fixed);
        if (!fixedReqId) {
            self.notify('Реквизит «' + CUT_REQ.fixed + '» не найден в метаданных', 'error');
            return Promise.resolve(false);
        }
        var fieldKey = 't' + fixedReqId;
        var flag = value ? '1' : '0';
        // #3778: при ФИКСАЦИИ снимаем тайминг (Наладка ножей / Сырье-намотка / Резка и Лидер) в
        // запись тем же _m_set, что и флаг. Раньше «Зафиксировать» писала ТОЛЬКО флаг, и у
        // вручную созданных/зафиксированных заданий три поля оставались пустыми — гант пересчитывал
        // их на лету. Считаем те же значения и в том же порядке, что план на экране
        // (computeCutSetupUpdates), но пишем только для фиксируемых id. При снятии фиксации не трогаем.
        var setupRes = value ? self.computeCutSetupUpdates(ids) : { reqs: {}, updates: [] };
        var setupById = {};
        setupRes.updates.forEach(function(u) { setupById[String(u.cutId)] = u; });
        this.setBusy(true);
        this.showProgress((value ? 'Фиксация' : 'Снятие фиксации') + ' заданий…', ids.length);
        var done = 0;
        var chain = Promise.resolve();
        ids.forEach(function(id) {
            chain = chain.then(function() {
                var fields = {}; fields[fieldKey] = flag;
                var u = setupById[String(id)];   // #3778: дополняем флаг снимком тайминга
                if (u) {
                    var tf = setupTimingFields(setupRes.reqs, u);
                    Object.keys(tf).forEach(function(k) { fields[k] = tf[k]; });
                }
                return self.post('_m_set/' + encodeURIComponent(id) + '?JSON', fields)
                    .then(function() { self.updateProgress(++done); });
            });
        });
        return chain.then(function() {
            return self.reload();
        }).then(function() {
            self.hideProgress(); self.setBusy(false); self.render();
            if (!o.silent) {
                self.notify(o.successMessage ||
                    ((value ? 'Зафиксировано заданий: ' : 'Снята фиксация заданий: ') + ids.length), 'success');
            }
            return true;
        }).catch(function(err) {
            self.hideProgress(); self.setBusy(false);
            self.reload().then(function() { self.render(); }).catch(function() {});
            self.notify('Ошибка фиксации заданий: ' + (err && err.message || err), 'error');
            return false;
        });
    };

    // #3508 п.2: «Зафиксировать» — проставить флаг всем заданиям выбранного дня (все
    // станки). День берём из фильтра «Дата плана». Уже зафиксированные не трогаем.
    AtexProductionPlanning.prototype.fixDayTasks = function() {
        var self = this;
        if (this.busy) return;
        var fromStr = String(this.filter && this.filter.date || '').trim();
        if (fromStr === '') {
            this.notify('Выберите «Дату плана», чтобы зафиксировать задания дня', 'error');
            return;
        }
        var toStr = String(this.filter && this.filter.dateTo || '').trim();
        if (toStr === '') toStr = fromStr;
        // #3622: фиксируем задания всего ВИДИМОГО диапазона [С; По], а не одного дня (как и
        // удаление). Незавершённые/датированные — тот же набор, что в очереди (isCutVisible).
        var dayCuts = (this.cuts || []).filter(function(c) {
            return c && String(c.planDate || '').trim() !== '' && isCutVisible(c, fromStr, toStr);
        });
        var toFix = dayCuts.filter(function(c) { return !c.fixed; });
        var dateLabel = formatPlanDayRangeLabel(fromStr, toStr);
        if (!dayCuts.length) { this.notify('Нет заданий за ' + dateLabel + ' для фиксации', 'info'); return; }
        if (!toFix.length) { this.notify('Все задания за ' + dateLabel + ' уже зафиксированы', 'info'); return; }
        self.setCutsFixed(toFix.map(function(c) { return c.id; }), true, {
            successMessage: 'Зафиксированы задания за ' + dateLabel + ': ' + toFix.length
        });
    };

    // #3783/#3785: «Упорядочить» — пересобрать очередь видимого диапазона в оптимальный
    // порядок. Тот же autoSequenceQueue, но preserveOrder=false → реально пересобирает
    // (минимум переналадок группирует сырьё/набор ножей; при прочих равных больше полос
    // раньше). Перезаписывает ручные перестановки оператора (#3449), поэтому с подтверждением.
    // #3792: зафиксированные задания остаются на своих днях (не переносятся/не разбиваются) —
    // тот же замок на день, что и при генерации.
    AtexProductionPlanning.prototype.optimizeQueue = function(actionsEl) {
        var self = this;
        if (this.busy) return;
        if (!(this.cuts && this.cuts.length)) { this.notify('Нет заданий для упорядочивания', 'info'); return; }
        var host = actionsEl || (this.root && this.root.querySelector('.atex-pp-panel-actions'));
        var oldBar = host && host.querySelector && host.querySelector('.atex-pp-confirm-bar');
        if (oldBar && oldBar.parentNode) oldBar.parentNode.removeChild(oldBar);
        var msg = el('span', { class: 'atex-pp-confirm-msg', text:
            'Пересобрать очередь в оптимальный порядок: группировка по сырью (минимум переналадок), ' +
            'при прочих равных — больше полос раньше. Ручные перестановки заменятся; ' +
            'зафиксированные задания останутся на своих днях (#3792).' });
        this.confirmAction(msg, host, [
            { label: 'Упорядочить', inline: true, onConfirm: function() { self.runOptimizeQueue(); } }
        ]);
    };

    // #4047: карта cutId → новое planStart (сек) из ops.updates — для оценки переналадки
    // плана-кандидата. creates (новые сегменты разбиения) несут ту же конфигурацию, переналадки
    // не добавляют → в оценке не нужны (запись без апдейта берёт хранимый planStart).
    function planStartMapFromOps(ops) {
        var m = {};
        ((ops && ops.updates) || []).forEach(function(u) {
            var ts = Number(u.planStartTs);
            if (isFinite(ts) && ts > 0) m[String(u.cutId)] = ts;
        });
        return m;
    }

    // #4064: один день опоздания в объективе «Упорядочить» весит больше любой переналадки — срок
    // (ТЗ §14) старший критерий. Объектив кандидата = дни_опоздания × LATE_DAY_WEIGHT + переналадка(мин),
    // поэтому chooseOptimizeCandidate сперва минимизирует опоздания, затем переналадку (лексикографически).
    var LATE_DAY_WEIGHT = 1e9;

    // #4047/#4064: выбор кандидата «Упорядочить». before/objB/objA — КОМБИНИРОВАННЫЙ объектив
    // (дни_опоздания × LATE_DAY_WEIGHT + переналадка), objA = Infinity если переназначения нет.
    // Применяем ЛУЧШИЙ (строго меньший объектив = меньше опозданий, при равных — меньше переналадки);
    // при равенстве кандидатов берём B (без смены станка). Лучший НЕ строго меньше текущего → 'none'
    // (план не трогаем). Так «Упорядочить» НЕ увеличивает ни опоздания, ни (при равных опозданиях)
    // переналадку, но РАДИ сокращения опозданий переналадку увеличить может (срок важнее, #4064).
    // → { action:'none'|'B'|'A', obj }.
    function chooseOptimizeCandidate(before, objB, objA, reassignChanged) {
        var useA = !!reassignChanged && objA < objB;
        var bestObj = useA ? objA : objB;
        if (!(bestObj < before)) return { action: 'none', obj: before };
        return { action: useA ? 'A' : 'B', obj: bestObj };
    }

    // #4047: суммарная переналадка (мин) набора резок за весь горизонт [С; конец] — та же метрика,
    // что тултип «Качество плана» (planQuality.all.changeoverMin). Порядок ВНУТРИ дня берём по
    // РЕАЛЬНОМУ planStart (c.number либо override из ops кандидата), а не 0 — иначе перестановка
    // задач внутри дня/станка (главная работа «Упорядочить») в метрике не видна. planStartByCutId
    // (опц.) — {cutId: planStartTs сек}; нет записи → хранимый planStart резки.
    AtexProductionPlanning.prototype.planChangeoverMin = function(cutsArray, planStartByCutId) {
        var self = this;
        var ov = planStartByCutId || null;
        var slots = (cutsArray || []).map(function(c) {
            var o = ov ? ov[String(c.id)] : null;
            var ts = (o != null) ? Number(o)
                : (Number(c.number) > 0 ? Number(c.number) : (Number(c.planDate) > 0 ? Number(c.planDate) : 0));
            return {
                id: c.id,
                slitterId: c.slitter && c.slitter.id,
                dayKey: ts > 0 ? planDateDayKey(String(ts)) : planDateDayKey(c.planDate),
                planStartMs: ts,
                knifeWidths: c.knifeWidths, knifeCount: c.knifeCount,
                materialId: c.materialId, winding: c.winding, dueKey: c.dueKey
            };
        });
        // #4047: считаем по ВСЕМУ открытому горизонту (scope не задаём), а не по окну [С;По]:
        // «Упорядочить» переставляет ВСЕ открытые задания (окно — лишь размещение, #3974), поэтому
        // текущий и кандидатный планы сравниваем на ОДНОМ наборе. day-scope дал бы асимметрию —
        // просроченное задание до «С» в текущем плане выпадало бы из счёта, а кандидат ставит его
        // ≥ «С» → ложный рост переналадки и напрасный отказ применить хороший план.
        return planQuality(slots, {
            settings: self.daySettings,
            prevSetupBySlitter: self.prevSetupBySlitter
        }).all.changeoverMin;
    };

    // #4064: суммарные дни опоздания плана — Σ по резкам max(0, день размещения − срок). День
    // размещения берём как в planChangeoverMin (override planStart из ops кандидата, иначе хранимый
    // planStart/planDate резки), срок — dueKey (YYYYMMDD). Старший критерий «Упорядочить» (срок —
    // ТЗ §14), выше переналадки: см. LATE_DAY_WEIGHT и chooseOptimizeCandidate.
    AtexProductionPlanning.prototype.planLatenessDays = function(cutsArray, planStartByCutId) {
        var ov = planStartByCutId || null;
        var total = 0;
        (cutsArray || []).forEach(function(c) {
            var o = ov ? ov[String(c.id)] : null;
            var ts = (o != null) ? Number(o)
                : (Number(c.number) > 0 ? Number(c.number) : (Number(c.planDate) > 0 ? Number(c.planDate) : 0));
            var pKey = ts > 0 ? planDateDayKey(String(ts)) : planDateDayKey(c.planDate);
            total += lateDaysOf(pKey, c.dueKey);
        });
        return round3(total);
    };

    // #4047: «Упорядочить» ГАРАНТИРОВАННО не увеличивает суммарную переналадку. Считаем два
    // плана-кандидата В ПАМЯТИ (без записи в БД) и меряем их суммарную переналадку
    // (planChangeoverMin) против текущего плана; применяем ЛУЧШИЙ и ТОЛЬКО если он СТРОГО меньше:
    //   B — пересборка порядка/дней на ТЕКУЩИХ станках (минимум переналадки на станок);
    //   A — переназначение станков (computeSlitterReassignment, как «Сгенерировать») + пересборка.
    // При равенстве кандидатов берём B (без смены станка). Улучшения нет (min ≥ текущего) → план
    // НЕ трогаем («уже оптимальна»): смена станка rebalance-ом, добавлявшая переналадку, отсекается.
    // Пишем только изменившиеся значения (applySplitPlan / _m_set лишь сменившимся цепочкам).
    AtexProductionPlanning.prototype.runOptimizeQueue = function() {
        var self = this;
        if (this.busy) return;
        this.setBusy(true);
        // #4064: объектив кандидата — дни_опоздания × LATE_DAY_WEIGHT + переналадка(мин). Срок (ТЗ §14)
        // старший критерий: сперва минимизируем опоздания, затем переналадку. coX/lateX храним отдельно
        // для уведомления. combined() собирает объектив для chooseOptimizeCandidate.
        var before, builtB, objB, plan, objA, builtA;
        var coBefore, lateBefore, coB, lateB, coA = Infinity, lateA = Infinity;
        function combined(late, co) { return late * LATE_DAY_WEIGHT + co; }
        try {
            coBefore = self.planChangeoverMin(self.cuts, null);
            lateBefore = self.planLatenessDays(self.cuts, null);
            before = combined(lateBefore, coBefore);

            // Кандидат B: пересобрать порядок/дни на ТЕКУЩИХ станках (без переназначения).
            builtB = self.buildSequenceOps(self.cuts, PLANNING_STRATEGY_SETUP, false);
            var mapB = planStartMapFromOps(builtB.ops);
            coB = self.planChangeoverMin(self.cuts, mapB);
            lateB = self.planLatenessDays(self.cuts, mapB);
            objB = combined(lateB, coB);

            // Кандидат A: переназначить станки. Считаем В ПАМЯТИ — временно подменяем станок на
            // self.cuts (buildSequenceOps/planCutOperations синхронны), меряем, ВОЗВРАЩАЕМ обратно.
            plan = self.computeReassignmentPlan();
            objA = Infinity;
            builtA = null;
            if (plan.changed) {
                var cutsById = {}; (self.cuts || []).forEach(function(c) { cutsById[String(c.id)] = c; });
                var saved = {};
                Object.keys(plan.slitterByRecordId).forEach(function(mid) {
                    var c = cutsById[mid]; if (!c) return;
                    saved[mid] = c.slitter ? { id: c.slitter.id, label: c.slitter.label } : null;
                    if (!c.slitter) c.slitter = { id: plan.slitterByRecordId[mid], label: '' };
                    else c.slitter.id = plan.slitterByRecordId[mid];
                });
                builtA = self.buildSequenceOps(self.cuts, PLANNING_STRATEGY_SETUP, false);
                var mapA = planStartMapFromOps(builtA.ops);
                coA = self.planChangeoverMin(self.cuts, mapA);
                lateA = self.planLatenessDays(self.cuts, mapA);
                objA = combined(lateA, coA);
                Object.keys(saved).forEach(function(mid) { var c = cutsById[mid]; if (c) c.slitter = saved[mid]; });   // вернуть станки
            }
        } catch (err) {
            self.setBusy(false);
            console.error('[pp] ⚙️ optimizeQueue: ОШИБКА расчёта', err && err.message, err && err.stack);
            self.notify('Ошибка упорядочивания: ' + (err && err.message ? err.message : err), 'error');
            return;
        }

        // Выбор кандидата: сперва меньше опозданий (срок §14), затем меньше переналадки; иначе не трогаем.
        var choice = chooseOptimizeCandidate(before, objB, objA, plan.changed);
        if (choice.action === 'none') {
            self.setBusy(false);
            self.notify('Очередь уже оптимальна (опозданий ' + round3(lateBefore) + ' дн, переналадка ' + round3(coBefore) + ' мин)', 'success');
            return;
        }
        var useA = choice.action === 'A';
        var coBest = useA ? coA : coB, lateBest = useA ? lateA : lateB;

        var applyPromise;
        if (useA) {
            applyPromise = self.persistSlitterReassignment(plan.slitterByRecordId, plan.slitterReqId).then(function() {
                var changed = filterChangedUpdates(builtA.ops, builtA.cutsById);
                if (!changed.length && !(builtA.ops.creates || []).length && !(builtA.ops.deletes || []).length) {
                    return self.reload().then(function() { self.render(); });   // станки записаны, порядок/дни — нет
                }
                return self.applySplitPlan({ updates: changed, creates: builtA.ops.creates, deletes: builtA.ops.deletes });
            });
        } else {
            var changedB = filterChangedUpdates(builtB.ops, builtB.cutsById);
            applyPromise = (!changedB.length && !(builtB.ops.creates || []).length && !(builtB.ops.deletes || []).length)
                ? Promise.resolve(false)
                : self.applySplitPlan({ updates: changedB, creates: builtB.ops.creates, deletes: builtB.ops.deletes });
        }

        applyPromise.then(function() {
            self.setBusy(false);
            self.notify('Очередь упорядочена: опоздания ' + round3(lateBefore) + ' → ' + round3(lateBest) + ' дн, '
                + 'переналадка ' + round3(coBefore) + ' → ' + round3(coBest) + ' мин'
                + (useA ? ' (со сменой станка)' : ''), 'success');
        }).catch(function(err) {
            self.setBusy(false);
            console.error('[pp] ⚙️ optimizeQueue: ОШИБКА применения', err && err.message, err && err.stack);
            self.notify('Ошибка упорядочивания: ' + (err && err.message ? err.message : err), 'error');
        });
    };

    // #4001/#4047: РАССЧИТАТЬ пере-выбор станка для СУЩЕСТВУЮЩИХ логических резок (как «Сгенерировать»,
    // без пересоздания): chooseSlitterBySetup + rebalanceSlitterLoad (computeSlitterReassignment).
    // ЧИСТАЯ — БЕЗ записи в БД и без мутации self.cuts (#4047: runOptimizeQueue сперва оценивает план).
    // 🔒 держат свой станок (базовая загрузка, не переносятся). → { changed, slitterByRecordId,
    // slitterReqId }: slitterByRecordId — id КАЖДОЙ записи цепочки (голова+продолжения), сменившей
    // станок, → новый станок (всем записям цепочки, иначе рвётся continuationSignature). Нет
    // станков/ёмкости/движимых → changed:false.
    AtexProductionPlanning.prototype.computeReassignmentPlan = function() {
        var self = this;
        var cutMeta = this.meta.cut;
        var slitterReqId = cutMeta ? reqIdByName(cutMeta, CUT_REQ.slitter) : null;
        var empty = { changed: false, slitterByRecordId: {}, slitterReqId: slitterReqId };
        if (!slitterReqId || !(self.slitters && self.slitters.length >= 2) || !(self.cuts && self.cuts.length)) return empty;
        var genWindow = self.workingWindow();
        var dayCapacityMin = Math.max(0, (Number(genWindow.cutEndMin) || 0) - (Number(genWindow.startMin) || 0) - (Number(genWindow.lunchDurationMin) || 0));
        if (!(dayCapacityMin > 0)) return empty;
        var planOptions = makePlanningOptions(PLANNING_STRATEGY_SETUP, self.changeTimes, self.daySettings);   // #4059: веса из «Настройки»
        var planBaseMidnightMs = planBaseMidnightFrom(self.filter && self.filter.date, controllerNowMs(self));

        var merged = mergeContinuationChains(self.cuts || []);
        var chainByLogical = merged.chainByLogical || {};
        var openLogical = (merged.cuts || []).filter(function(c) { return String(c && c.status || '').trim() !== 'Завершён'; });
        function descOf(c) {
            var runLength = cutRunLength(c, self.supplies, self.footageBySupply);
            var runs = Number(c.plannedRuns) || 0;
            return {
                id: String(c.id),
                slitterId: (c.slitter && c.slitter.id != null) ? String(c.slitter.id) : '',
                materialId: c.materialId, winding: c.winding, batchId: c.batchId,
                knifeWidths: c.knifeWidths, knifeCount: c.knifeCount, isFoil: !!c.isFoil,
                width: c.width, planDate: c.planDate, plannedRuns: runs, runLength: runLength,
                duration: plannedCutDurationMinutes(runLength, runs, self.opTimes, !!c.isFoil)
            };
        }
        var movable = openLogical.filter(function(c) { return !c.fixed; }).map(descOf);
        var fixed = openLogical.filter(function(c) { return !!c.fixed; }).map(descOf);
        if (!movable.length) return empty;

        var vacByDay = {};
        function vacationForDay(dayKey, sec) {
            if (!(dayKey in vacByDay)) { var d = new Date(Number(sec) * 1000); d.setHours(0, 0, 0, 0); vacByDay[dayKey] = self.vacationSlitterIdsForDay(d.getTime()); }
            return vacByDay[dayKey];
        }
        var dayOffMemo = {};
        function machineDayOff(sid, off) { var k = sid + ':' + off; if (k in dayOffMemo) return dayOffMemo[k]; var v = self.balanceDayOff(sid, planBaseMidnightMs + off * 86400000); dayOffMemo[k] = v; return v; }
        function slitterDayBlocked(sid, plan) { var sec = Number(plan && plan.planDate); if (!isFinite(sec) || sec <= 0) return false; var d = new Date(sec * 1000); d.setHours(0, 0, 0, 0); return self.slitterOnVacationDay(sid, d.getTime()); }

        var res = computeSlitterReassignment(movable, fixed, {
            slitters: self.slitters, weights: planOptions, dayCapacityMin: dayCapacityMin,
            nominalWidthByMaterial: self.nominalWidthByMaterial,
            vacationForDay: vacationForDay, slitterDayBlocked: slitterDayBlocked, machineDayOff: machineDayOff
        });
        var slitterById = res.slitterById || {};

        var slitterByRecordId = {}; var changed = false;
        movable.forEach(function(m) {
            var head = String(m.id);
            var newSid = String(slitterById[head] || '');
            if (newSid === '' || newSid === String(m.slitterId || '')) return;   // станок не изменился
            (chainByLogical[head] || [head]).forEach(function(mid) { slitterByRecordId[String(mid)] = newSid; changed = true; });
        });
        return { changed: changed, slitterByRecordId: slitterByRecordId, slitterReqId: slitterReqId };
    };

    // #4047: применить рассчитанное переназначение станков — _m_set КАЖДОЙ записи цепочки
    // (голова+продолжения) + мутируем self.cuts, чтобы applySplitPlan/рендер видели новый станок.
    // → Promise<bool changed>. Пусто — resolve(false).
    AtexProductionPlanning.prototype.persistSlitterReassignment = function(slitterByRecordId, slitterReqId) {
        var self = this;
        if (!slitterReqId) return Promise.resolve(false);
        var ids = Object.keys(slitterByRecordId || {});
        if (!ids.length) return Promise.resolve(false);
        var cutsById = {}; (self.cuts || []).forEach(function(c) { cutsById[String(c.id)] = c; });
        var writes = ids.map(function(mid) {
            var newSid = slitterByRecordId[mid];
            var fields = {}; fields['t' + slitterReqId] = newSid;
            return self.post('_m_set/' + encodeURIComponent(mid) + '?JSON', fields).then(function() {
                var cc = cutsById[String(mid)];
                if (cc) { if (!cc.slitter) cc.slitter = { id: newSid, label: '' }; else cc.slitter.id = newSid; }
            });
        });
        console.log('[pp] ⚙️ Упорядочить: смена станка у ' + writes.length + ' записей (#4047)');
        return Promise.all(writes).then(function() { return true; });
    };

    // #3508 п.4: иконка «🔒» в карточке — переключить фиксацию одного задания
    // (зафиксировано ↔ снято), чтобы можно было и поставить, и снять флаг.
    AtexProductionPlanning.prototype.toggleCutFixed = function(cut) {
        if (!cut) return;
        var o = { successMessage: (cut.fixed ? 'Снята фиксация задания' : 'Задание зафиксировано') };
        this.setCutsFixed([cut.id], !cut.fixed, o);
    };

    // #3602: кнопка «🗓» (между «🔒» и «🗑») — модалка переноса задания на другой день.
    // #3631: день выбирается ПРОИЗВОЛЬНО (input type=date), а не из ограниченного списка
    // дней расписания. По умолчанию подставляем текущий день задания (иначе дату фильтра /
    // сегодня). Ещё спрашиваем положение «в начало/в конец дня» и галку «Зафиксировать»
    // (по умолчанию установлена).
    AtexProductionPlanning.prototype.openMoveCut = function(cut) {
        var self = this;
        if (!cut) return;
        if (!this.meta.cut) { this.notify('Нет метаданных таблицы «' + TABLE.cut + '»', 'error'); return; }

        // Значение по умолчанию — текущий день задания (по хранимой «Дате план»).
        var pd = String(cut.planDate == null ? '' : cut.planDate).trim();
        var defISO = '';
        if (/^\d{9,13}$/.test(pd)) { var n = Number(pd); defISO = isoDateFromMs(n >= 1e12 ? n : n * 1000); }
        else if (/^\d{4}-\d{2}-\d{2}/.test(pd)) { defISO = pd.slice(0, 10); }
        if (!defISO) defISO = String(this.filter && this.filter.date || '').trim() || todayISO();

        var dialog = el('div', { class: 'atex-pp-modal-dialog atex-pp-move-dialog' });
        var overlay = el('div', { class: 'atex-pp-modal atex-pp-move-modal is-open' }, [dialog]);
        function close() { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }
        overlay.addEventListener('click', function(e) { if (e.target === overlay) close(); });
        var closeX = el('button', { class: 'atex-pp-modal-close', type: 'button', text: '×', title: 'Закрыть' });
        closeX.addEventListener('click', close);
        dialog.appendChild(closeX);

        var content = el('div', { class: 'atex-pp-move-content' });
        dialog.appendChild(content);
        content.appendChild(el('h2', { class: 'atex-pp-form-title', text: 'Перенести задание на другой день' }));
        content.appendChild(el('p', { class: 'atex-pp-hint',
            text: 'Задание № ' + (formatCutNumber(cut.number) || cut.id) + ' · ' +
                (cut.materialName || (cut.materialId ? '#' + cut.materialId : '—')) }));

        // #3631: произвольный день — обычный календарный input type=date (без ограничений).
        var dayInput = el('input', { type: 'date', class: 'atex-pp-input atex-pp-move-day', value: defISO });
        content.appendChild(el('label', { class: 'atex-pp-move-field' }, [
            el('span', { class: 'atex-pp-move-label', text: 'День' }), dayInput
        ]));

        // #3669 п.1: опционально — другой станок (по умолчанию текущий). Список из справочника;
        // если справочник пуст, селектор не показываем (станок не меняем).
        var curSid = String(cut.slitter && cut.slitter.id != null ? cut.slitter.id : '');
        var slitSelect = null;
        if ((this.slitters || []).length) {
            slitSelect = el('select', { class: 'atex-pp-input atex-pp-move-slitter', title: 'Станок' });
            this.slitters.forEach(function(s) {
                var opt = el('option', { value: String(s.id), text: s.label || ('#' + s.id) });
                if (String(s.id) === curSid) opt.setAttribute('selected', 'selected');
                slitSelect.appendChild(opt);
            });
            slitSelect.value = curSid;
            content.appendChild(el('label', { class: 'atex-pp-move-field' }, [
                el('span', { class: 'atex-pp-move-label', text: 'Станок' }), slitSelect
            ]));
        }

        // Положение в дне: в начало / в конец.
        var posStart = el('input', { type: 'radio', name: 'atex-pp-move-pos' });
        posStart.value = 'start'; posStart.checked = true;
        var posEnd = el('input', { type: 'radio', name: 'atex-pp-move-pos' });
        posEnd.value = 'end';
        content.appendChild(el('div', { class: 'atex-pp-move-field' }, [
            el('span', { class: 'atex-pp-move-label', text: 'Положение' }),
            el('div', { class: 'atex-pp-move-pos' }, [
                el('label', { class: 'atex-pp-move-radio' }, [posStart, el('span', { text: ' В начало дня' })]),
                el('label', { class: 'atex-pp-move-radio' }, [posEnd, el('span', { text: ' В конец дня' })])
            ])
        ]));

        // Зафиксировать — по умолчанию установлена.
        var fixCb = el('input', { type: 'checkbox' });
        fixCb.checked = true;
        content.appendChild(el('label', { class: 'atex-pp-move-fix' }, [
            fixCb, el('span', { text: ' Зафиксировать задание' })
        ]));

        var actions = el('div', { class: 'atex-pp-supply-actions' });
        var cancel = el('button', { class: 'atex-pp-btn', type: 'button', text: 'Отмена' });
        cancel.addEventListener('click', close);
        var ok = el('button', { class: 'atex-pp-btn atex-pp-btn-primary', type: 'button', text: 'Перенести' });
        ok.addEventListener('click', function() {
            if (self.busy) return;
            var dateStr = String(dayInput.value || '').trim();
            if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) { self.notify('Выберите день для переноса', 'error'); return; }
            var position = posEnd.checked ? 'end' : 'start';
            var fix = !!fixCb.checked;
            var targetSlitterId = slitSelect ? String(slitSelect.value || '') : '';   // #3669 п.1
            // #3876: целевой станок в отпуске в выбранный день — не переносим (станок без сырья
            // и ножей). Сообщаем, диалог не закрываем — пользователь меняет день/станок.
            var targetSid = targetSlitterId !== '' ? targetSlitterId
                : String(cut.slitter && cut.slitter.id != null ? cut.slitter.id : '');
            var targetMid = planBaseMidnightFrom(dateStr, controllerNowMs(self));
            if (targetSid !== '' && self.slitterOnVacationDay(targetSid, targetMid)) {
                var sl = (self.slitters || []).filter(function(s) { return String(s.id) === targetSid; })[0];
                self.notify('Станок ' + ((sl && sl.label) || ('#' + targetSid)) + ' в отпуске в этот день — перенос невозможен', 'error');
                return;
            }
            close();
            self.moveCutToDay(cut, dateStr, position, fix, targetSlitterId);
        });
        actions.appendChild(cancel);
        actions.appendChild(ok);
        content.appendChild(actions);

        this.root.appendChild(overlay);
    };

    // #3602/#3631/#3923: применить перенос на ПРОИЗВОЛЬНЫЙ день targetDateStr («ГГГГ-ММ-ДД»).
    // Перемещаемому и прочим заданиям целевого дня пишем planStart (главное значение — DATETIME-
    // колонка → _m_save с t{tableId}, как в applySplitPlan; _m_set её НЕ задаёт, issue #775):
    // плейсхолдер-время в желаемом порядке (в начало/конец дня); порядок дня задаёт planStart,
    // отдельной «Очередности» нет. Фиксация (если отмечена) пишется _m_set.
    // Если цель вне фильтра [С; По] — расширяем диапазон (в нужную сторону), чтобы
    // перенесённое задание не исчезло из очереди. Перенос двигает и зафиксированные.
    AtexProductionPlanning.prototype.moveCutToDay = function(cut, targetDateStr, position, fix, targetSlitterId) {
        var self = this;
        if (this.busy) return Promise.resolve(false);
        if (!cut) return Promise.resolve(false);
        var cutMeta = this.meta.cut;
        if (!cutMeta) { this.notify('Нет метаданных таблицы «' + TABLE.cut + '»', 'error'); return Promise.resolve(false); }
        var fixedReqId = reqIdByName(cutMeta, CUT_REQ.fixed);
        var slitterReqId = reqIdByName(cutMeta, CUT_REQ.slitter);   // #3669 п.1: ссылка «Слиттер»
        var mainKey = cutMeta.id != null ? 't' + cutMeta.id : null;
        if (!mainKey) {
            this.notify('Не найден реквизит даты резки', 'error');
            return Promise.resolve(false);
        }
        var dateStr = String(targetDateStr || '').trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) { this.notify('Выберите день для переноса', 'error'); return Promise.resolve(false); }

        var win = this.workingWindow();
        var shiftStartMin = Number(win && win.startMin) || 0;
        var targetMidnightMs = planBaseMidnightFrom(dateStr, controllerNowMs(this));   // полночь целевого дня
        var targetTs = Math.floor(targetMidnightMs / 1000) + shiftStartMin * 60;       // 08:00 целевого дня
        var targetDayKey = planDateDayKey(targetTs);
        var dateLabel = formatPlanDayHeading(targetMidnightMs, 0);

        // #3669 п.1: целевой станок — выбранный в диалоге (по умолчанию текущий). Порядок дня
        // задаёт planStart; смену станка пишем ссылкой «Слиттер» на самом задании (старый станок
        // пересобирать не нужно — пропуск в его дне безвреден, лечится следующей генерацией).
        var curSidStr = String(cut.slitter && cut.slitter.id != null ? cut.slitter.id : '');
        var targetSidStr = String(targetSlitterId == null ? '' : targetSlitterId).trim();
        var sidStr = targetSidStr !== '' ? targetSidStr : curSidStr;
        var slitterChanged = !!slitterReqId && sidStr !== '' && sidStr !== curSidStr;
        // #3876: не переносить задание на станок, у которого в целевой день отпуск (станок без
        // сырья и ножей). Авторитетная проверка (диалог уже проверяет — но метод вызываем и иначе).
        if (sidStr !== '' && this.slitterOnVacationDay(sidStr, targetMidnightMs)) {
            var slv = (this.slitters || []).filter(function(s) { return String(s.id) === sidStr; })[0];
            this.notify('Станок ' + ((slv && slv.label) || ('#' + sidStr)) + ' в отпуске на ' + dateLabel + ' — перенос невозможен', 'error');
            return Promise.resolve(false);
        }
        // Задания станка-получателя на целевом дне (по хранимой «Дате план»), без перемещаемого.
        var dayCuts = (this.cuts || []).filter(function(c) {
            if (!c || String(c.id) === String(cut.id)) return false;
            var csid = c.slitter && c.slitter.id;
            if (String(csid == null ? '' : csid) !== sidStr) return false;
            return planDateDayKey(c.planDate) === targetDayKey;
        });
        var plan = planMoveSequences(cut.id, dayCuts, position);
        // #3923: желаемый порядок дня → плейсхолдер-planStart (целевой день 08:00 + i·минут).
        // Точные значения не важны — важен ПОРЯДОК; autoSequenceQueue(preserveOrder) ниже
        // переупакует и целевой, и исходный день встык по сохранённому planStart.
        var placeholderByCut = {};
        plan.ordered.forEach(function(id, i) { placeholderByCut[String(id)] = targetTs + i * 60; });

        this.setBusy(true);
        this.showProgress('Перенос задания…', 1 + dayCuts.length);
        var done = 0;
        var fixFieldKey = (fix && fixedReqId) ? 't' + fixedReqId : null;
        var chain = Promise.resolve();
        // 1) Перемещаемое задание: planStart (главное значение) → _m_save; затем фиксация/смена
        //    станка → _m_set (если есть). «Очередность» больше не пишем.
        chain = chain.then(function() {
            var mainFields = {}; mainFields[mainKey] = String(placeholderByCut[String(cut.id)] || targetTs);
            return self.post('_m_save/' + encodeURIComponent(cut.id) + '?JSON', mainFields);
        }).then(function() {
            var fields = {};
            if (fixFieldKey) fields[fixFieldKey] = '1';
            if (slitterChanged) fields['t' + slitterReqId] = sidStr;   // #3669 п.1: смена станка
            if (!Object.keys(fields).length) return;
            return self.post('_m_set/' + encodeURIComponent(cut.id) + '?JSON', fields);
        }).then(function() { self.updateProgress(++done); });
        // 2) Прочие задания целевого дня — плейсхолдер-planStart (только изменившиеся).
        dayCuts.forEach(function(c) {
            var ph = placeholderByCut[String(c.id)];
            chain = chain.then(function() {
                if (ph == null || Number(c.planDate) === Number(ph)) { self.updateProgress(++done); return; }
                var mainFields = {}; mainFields[mainKey] = String(ph);
                return self.post('_m_save/' + encodeURIComponent(c.id) + '?JSON', mainFields)
                    .then(function() { self.updateProgress(++done); });
            });
        });

        return chain.then(function() {
            return self.reload();
        }).then(function() {
            // Цель вне фильтра [С; По] → расширяем диапазон в нужную сторону, чтобы
            // перенесённое задание осталось видимым в очереди (пустой край не ограничивает).
            // Делаем ДО пересчёта (autoSequenceQueue ниже): и день-источник, и целевой день
            // должны попасть в scope перепланирования [С; По].
            var fromStr = String(self.filter && self.filter.date || '').trim();
            var toStr = String(self.filter && self.filter.dateTo || '').trim();
            if (fromStr !== '' && planDateDayKey(fromStr) > targetDayKey) self.filter.date = dateStr;
            if (toStr !== '' && planDateDayKey(toStr) < targetDayKey) self.filter.dateTo = dateStr;
            self.hideProgress(); self.setBusy(false); self.render();
            // #3669 п.1: если станок сменился — называем его в сообщении.
            var slitLabel = '';
            if (slitterChanged) {
                var ts = (self.slitters || []).filter(function(s) { return String(s.id) === sidStr; })[0];
                slitLabel = ' · станок ' + ((ts && ts.label) || ('#' + sidStr));
            }
            self.notify('Задание перенесено на ' + dateLabel +
                (position === 'end' ? ' (в конец дня)' : ' (в начало дня)') + slitLabel, 'success');
            // #3840: перенос менял «Дату план» только переносимого задания и целевого дня — день-
            // ИСТОЧНИК оставался с прежним сохранённым planStart, и на месте вынутой резки висел простой
            // (РМ «Диаграмма Ганта» рисует сохранённый planStart). Терминальный autoSequenceQueue
            // пересобирает время старта затронутых дней; persistCutSetupColumns + reload/render делает
            // сам (отдельный persistCutSetupColumns выше убран).
            // #4074: пересобираем ПО СРОКАМ (preserveOrder=false, deadlineAware — как «Упорядочить»),
            // чтобы перенос не отправлял задания за срок («несоблюдение сроков»). Раньше терминал был
            // preserveOrder=true (deadlineAware выкл): паковал всё от «С» без учёта сроков → появлялись
            // просроченные задания. Перенесённое задание ЗАКРЕПЛЯЕМ на выбранном дне (pinCutIds —
            // временный замок дня в buildSequenceOps), остальной план раскладывается по срокам вокруг
            // (перестановка допустима — важно не нарушить сроки, #4074). Фольга остаётся в конце дня
            // (#3717), фиксации (#3792) не нарушаются; пишутся только изменившиеся записи (#3427).
            return self.autoSequenceQueue(PLANNING_STRATEGY_SETUP, false, { pinCutIds: [String(cut.id)] });
        }).catch(function(err) {
            self.hideProgress(); self.setBusy(false);
            self.reload().then(function() { self.render(); }).catch(function() {});
            self.notify('Ошибка переноса задания: ' + (err && err.message || err), 'error');
            return false;
        });
    };

    // #3475: «Удалить» — снести все задания выбранного дня. Показывает подтверждение
    // (сколько резок/обеспечений будет удалено), затем зовёт runDeleteDayTasks. День —
    // «Дата плана» из фильтра (this.filter.date); без даты удалять нечего (неоднозначно).
    AtexProductionPlanning.prototype.deleteDayTasks = function(actionsEl) {
        var self = this;
        if (this.busy) return;
        var dateStr = String(this.filter && this.filter.date || '').trim();
        if (dateStr === '') {
            this.notify('Выберите «Дату плана», чтобы удалить задания дня', 'error');
            return;
        }
        var targets = dayDeletionTargets(this.cuts, this.supplies, this.filter.date, this.filter.dateTo);
        var dateLabel = formatPlanDayRangeLabel(this.filter.date, this.filter.dateTo);
        if (!targets.cuts.length) {
            this.notify('Нет заданий за ' + dateLabel + ' для удаления', 'info');
            return;
        }
        // Снять прежнюю плашку подтверждения (генерации/удаления), если висит.
        var host = actionsEl || (this.root && this.root.querySelector('.atex-pp-panel-actions'));
        var oldBar = host && host.querySelector && host.querySelector('.atex-pp-confirm-bar');
        if (oldBar && oldBar.parentNode) oldBar.parentNode.removeChild(oldBar);

        var msg = el('span', { class: 'atex-pp-confirm-msg', text:
            'Удалить все задания за ' + dateLabel + '? Будет удалено: заданий — ' + targets.cuts.length +
            ', обеспечений — ' + targets.supplies.length + '. Действие необратимо.' });
        this.confirmAction(msg, host, [
            { label: 'Удалить', warning: true, inline: true, onConfirm: function() {
                self.runDeleteDayTasks(targets.cuts, targets.supplies, dateLabel);
            } }
        ]);
    };

    // #3475: последовательное удаление заданий дня. Порядок принципиален: сперва все
    // «Обеспечение» (они ссылаются на «Партии ГП» — подчинённые резки; пока ссылки живы,
    // _m_del резки вернёт 409, см. DeleteTreeRefsCount в index.php), затем сами резки —
    // backend каскадом (BatchDelete) сносит подчинённые Партии ГП/Полосы/Расход сырья.
    AtexProductionPlanning.prototype.runDeleteDayTasks = function(cuts, supplies, dateLabel) {
        var self = this;
        if (this.busy) return;
        var supplyIds = (supplies || []).map(function(s) { return String(s.id); })
            .filter(function(id) { return id && id !== 'null'; });
        var cutIds = (cuts || []).map(function(c) { return String(c.id); })
            .filter(function(id) { return id && id !== 'null'; });
        var total = supplyIds.length + cutIds.length;
        if (!total) { this.notify('Нечего удалять', 'info'); return; }

        this.setBusy(true);
        this.showProgress('Удаление заданий за ' + dateLabel + '…', total);
        var done = 0;
        // #4005: удаление, как и сохранение (#3998/#4004), гоняем пулом до MAX_PARALLEL_DELETES
        // потоков. Порядок «сперва ВСЕ обеспечения, потом резки» (иначе _m_del резки → 409, см.
        // комментарий выше) держим БАРЬЕРОМ между фазами: сначала параллельно сносим все
        // «Обеспечение» (независимы друг от друга — листовые записи), дожидаемся ВСЕХ, затем
        // параллельно сносим резки (backend каскадит подчинённые Партии ГП/Полосы/Расход,
        // поддеревья разных резок не пересекаются). Порядок _m_del в базе неважен.
        var MAX_PARALLEL_DELETES = 5;
        function del(id) {
            return self.post('_m_del/' + encodeURIComponent(id) + '?JSON', {}).then(function() {
                self.updateProgress(++done);
            });
        }
        function delTasks(ids) {
            return ids.map(function(id) { return function() { return del(id); }; });
        }
        // Фаза 1 — обеспечения (пул), барьер, Фаза 2 — резки (пул). Барьер снимает ссылки
        // Обеспечений на Партии ГП до удаления резок → 409 исключён.
        runWithConcurrency(delTasks(supplyIds), MAX_PARALLEL_DELETES).then(function() {
            return runWithConcurrency(delTasks(cutIds), MAX_PARALLEL_DELETES);
        }).then(function() {
            return self.reload();
        }).then(function() {
            self.hideProgress();
            self.setBusy(false);
            self.selectedCutId = null;   // панель «Связанные позиции» больше не на удалённую резку
            self.render();
            self.notify('Удалены задания за ' + dateLabel + ': резок — ' + cutIds.length +
                ', обеспечений — ' + supplyIds.length, 'success');
        }).catch(function(err) {
            self.hideProgress();
            self.setBusy(false);
            // Часть записей могла удалиться — перечитываем очередь, чтобы UI не врал.
            self.reload().then(function() { self.render(); }).catch(function() {});
            self.notify('Ошибка удаления заданий дня: ' + (err && err.message || err), 'error');
        });
    };

    // #3486: подпись резки для подтверждения/тоста удаления. Берём сырьё и плановую
    // дату (если есть), иначе — id. Без обращения к сети.
    function cutTaskLabel(cut) {
        if (!cut) return '';
        var name = String(cut.materialName || '').trim();
        var day = formatPlanDayLabel(String(cut.planDate || '').trim());
        if (name && day) return name + ' · ' + day;
        return name || day || ('#' + cut.id);
    }

    // #3691: id всех «Обеспечений» резки — из УЖЕ ЗАГРУЖЕННЫХ this.supplies (cut_planning),
    // НЕ из отчёта 81463 (cut→fulfillment). Они ссылаются на «Партии ГП» резки; пока ссылки
    // живы, _m_del резки вернёт 409 (DeleteTreeRefsCount в index.php), поэтому удалять их нужно
    // ДО самой резки. Отчёт 81463 оказался ненадёжным (зависел от совпадения дат резки/Партии
    // ГП/Обеспечения и возвращал пусто) → резка падала на 409. Promise — для совместимости с
    // вызовом deleteCutTask (асинхронный контракт сохраняем).
    AtexProductionPlanning.prototype.loadCutFulfillments = function(cutId) {
        return Promise.resolve(cutFulfillmentIds(this.supplies || [], cutId));
    };

    // #3486: кнопка «🗑» в карточке резки. Сначала собираем id «Обеспечений» резки
    // (#3691: из this.supplies), показываем подтверждение с их числом, по согласию — удаляем.
    AtexProductionPlanning.prototype.deleteCutTask = function(cut, cardEl) {
        var self = this;
        if (this.busy || !cut) return;
        var cutId = String(cut.id);
        var label = cutTaskLabel(cut);
        this.setBusy(true);
        this.loadCutFulfillments(cutId).then(function(fulfillmentIds) {
            self.setBusy(false);
            var msg = el('span', { class: 'atex-pp-confirm-msg', text:
                'Удалить задание «' + label + '»? Будет удалено обеспечений — ' +
                fulfillmentIds.length + '. Действие необратимо.' });
            self.confirmAction(msg, cardEl, [
                { label: 'Удалить', warning: true, onConfirm: function() {
                    self.runDeleteCutTask(cutId, fulfillmentIds, label);
                } }
            ]);
        }).catch(function(err) {
            self.setBusy(false);
            self.notify('Не удалось получить обеспечения резки: ' + (err && err.message || err), 'error');
        });
    };

    // #3486: удаление одной резки. Порядок как у заданий дня (#3475): сперва все
    // «Обеспечение» (снимаем ссылки на «Партии ГП»), затем сама «Производственная
    // резка» — backend каскадом (BatchDelete) сносит подчинённые Партии ГП/Полосы/Расход.
    AtexProductionPlanning.prototype.runDeleteCutTask = function(cutId, fulfillmentIds, label) {
        var self = this;
        if (this.busy) return;
        var ids = (fulfillmentIds || []).map(function(x) { return String(x); })
            .filter(function(id) { return id && id !== 'null'; });
        var total = ids.length + 1;   // обеспечения + сама резка

        this.setBusy(true);
        this.showProgress('Удаление задания «' + label + '»…', total);
        var done = 0;
        // #4005: обеспечения резки независимы друг от друга — сносим их пулом до
        // MAX_PARALLEL_DELETES потоков (как сохранение #3998/#4004), затем БАРЬЕР и сама
        // резка. Порядок «сперва все обеспечения, потом резка» обязателен (иначе _m_del
        // резки → 409, см. комментарий выше). Порядок _m_del в базе неважен.
        var MAX_PARALLEL_DELETES = 5;
        function del(id) {
            return self.post('_m_del/' + encodeURIComponent(id) + '?JSON', {}).then(function() {
                self.updateProgress(++done);
            });
        }
        var supplyTasks = ids.map(function(id) { return function() { return del(id); }; });
        // Фаза 1 — обеспечения (пул), барьер, Фаза 2 — сама резка.
        runWithConcurrency(supplyTasks, MAX_PARALLEL_DELETES).then(function() {
            return del(cutId);
        }).then(function() {
            return self.reload();
        }).then(function() {
            self.hideProgress();
            self.setBusy(false);
            if (String(self.selectedCutId) === String(cutId)) self.selectedCutId = null;
            self.render();
            self.notify('Задание удалено: обеспечений — ' + ids.length, 'success');
            // #3840: удаление резки из середины дня оставляло простой на её месте — прочие резки
            // дня сохраняли прежний planStart (РМ «Диаграмма Ганта» рисует сохранённый planStart).
            // Пересобираем время старта дня, СОХРАНЯЯ порядок (preserveOrder, #3619): gapFill
            // пакует встык, дыра схлопывается. autoSequenceQueue сам пишет изменившееся
            // (planStart/«Очередность») + persistCutSetupColumns + reload/render. Терминальный
            // шаг — как после генерации (runGenerateCuts) и переноса (moveCutToDay).
            return self.autoSequenceQueue(PLANNING_STRATEGY_SETUP, true);
        }).catch(function(err) {
            self.hideProgress();
            self.setBusy(false);
            // Часть записей могла удалиться — перечитываем очередь, чтобы UI не врал.
            self.reload().then(function() { self.render(); }).catch(function() {});
            self.notify('Ошибка удаления задания: ' + (err && err.message || err), 'error');
        });
    };

    // #3318: после изменения связей переоткрыть панель полос (если была открыта) для
    // той же резки — render() пересобирает очередь и панель теряется; открываем заново
    // с обновлёнными данными (orderedBatchIds → «Назначение» полосы и доступность удаления).
    AtexProductionPlanning.prototype.reopenStripsIfOpen = function() {
        var editId = this.stripEditCutId;
        if (editId == null) return;
        var cut = (this.cuts || []).filter(function(c) { return String(c.id) === String(editId); })[0];
        var cardPanel = this.queueEl && this.queueEl.querySelector('.atex-pp-cut[data-cut-id="' + editId + '"]');
        this.stripEditCutId = null;   // сбросить, чтобы openStrips открыл, а не закрыл (toggle)
        if (cut && cardPanel) this.openStrips(cut, cardPanel);
    };

    // #3320: модалка «Обеспечить полосу». Перечисляет все необеспеченные позиции заказа
    // (в т.ч. частично обеспеченные — остаток > 0) для привязки к складской полосе через
    // «Обеспечение». Кол-во рулонов = рулоны полосы (Кол-во полос × проходов), но не больше
    // 110% от необеспеченного остатка позиции. Перед созданием — небольшое подтверждение.
    AtexProductionPlanning.prototype.openStripSupplyPicker = function(cut, strip, passes) {
        var self = this;
        if (!this.meta.supply) { this.notify('Нет метаданных таблицы «Обеспечение»', 'error'); return; }
        if (strip.id == null) { this.notify('Сначала сохраните полосу (нужна «Партия ГП»)', 'error'); return; }

        var stripRolls = round3((stripNum(strip.qty) || 0) * (stripNum(passes) > 0 ? stripNum(passes) : 1));
        var stripWidth = String(strip.width || '').trim() || '—';

        var posLabelById = {};
        (this.positions || []).forEach(function(p) { posLabelById[String(p.id)] = p.label; });
        var candidates = (this.genPositions || []).map(function(p) {
            var remaining = remainingRollsForPosition(p, self.supplies);
            return {
                id: String(p.id), position: p, remaining: remaining,
                rolls: stripSupplyRolls(stripRolls, remaining),
                label: posLabelById[String(p.id)] || ('Сырьё#' + (p.materialId || '?') + ' · ' + ((p.orderWidth != null ? p.orderWidth : p.width) || '?') + ' мм')
            };
        }).filter(function(c) { return c.remaining > 0 && c.rolls > 0; });
        candidates.sort(function(a, b) { return a.label < b.label ? -1 : a.label > b.label ? 1 : 0; });

        var dialog = el('div', { class: 'atex-pp-modal-dialog atex-pp-supply-dialog' });
        var overlay = el('div', { class: 'atex-pp-modal atex-pp-supply-modal is-open' }, [dialog]);
        function close() { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }
        overlay.addEventListener('click', function(e) { if (e.target === overlay) close(); });
        var closeX = el('button', { class: 'atex-pp-modal-close', type: 'button', text: '×', title: 'Закрыть' });
        closeX.addEventListener('click', close);
        dialog.appendChild(closeX);
        var content = el('div', { class: 'atex-pp-supply-content' });
        dialog.appendChild(content);

        function confirmRow(label, value) {
            return el('div', { class: 'atex-pp-supply-confirm-row' }, [
                el('span', { class: 'atex-pp-supply-confirm-label', text: label }),
                el('span', { class: 'atex-pp-supply-confirm-value', text: String(value) })
            ]);
        }

        function renderList() {
            content.innerHTML = '';
            content.appendChild(el('h2', { class: 'atex-pp-form-title', text: 'Обеспечить полосу' }));
            content.appendChild(el('p', { class: 'atex-pp-hint',
                text: 'Полоса ' + stripWidth + ' мм · ' + round3(stripRolls) + ' рул. Выберите необеспеченную позицию заказа для привязки через «Обеспечение».' }));
            if (!candidates.length) {
                content.appendChild(el('p', { class: 'atex-pp-hint', text: 'Нет необеспеченных позиций заказа.' }));
                return;
            }
            var list = el('div', { class: 'atex-pp-supply-list' });
            candidates.forEach(function(c) {
                var item = el('button', { class: 'atex-pp-supply-item', type: 'button' }, [
                    el('span', { class: 'atex-pp-supply-item-label', text: c.label }),
                    el('span', { class: 'atex-pp-supply-item-meta',
                        text: 'ост. ' + round3(c.remaining) + ' рул. → ' + round3(c.rolls) + ' рул.' })
                ]);
                item.addEventListener('click', function() { renderConfirm(c); });
                list.appendChild(item);
            });
            content.appendChild(list);
        }

        function renderConfirm(c) {
            content.innerHTML = '';
            content.appendChild(el('h2', { class: 'atex-pp-form-title', text: 'Создать обеспечение?' }));
            var capped = round3(c.rolls) < round3(stripRolls);
            content.appendChild(el('div', { class: 'atex-pp-supply-confirm' }, [
                confirmRow('Позиция', c.label),
                confirmRow('Полоса', stripWidth + ' мм'),
                confirmRow('Рулонов полосы', round3(stripRolls)),
                confirmRow('Необеспеченный остаток', round3(c.remaining) + ' рул.'),
                confirmRow('Будет создано', round3(c.rolls) + ' рул.' + (capped ? ' (ограничено 110% остатка)' : ''))
            ]));
            var actions = el('div', { class: 'atex-pp-supply-actions' });
            var back = el('button', { class: 'atex-pp-btn', type: 'button', text: 'Назад' });
            back.addEventListener('click', renderList);
            var ok = el('button', { class: 'atex-pp-btn atex-pp-btn-primary', type: 'button', text: 'Создать обеспечение' });
            ok.addEventListener('click', function() {
                close();
                self.createStripSupply(strip, c, round3(c.rolls));
            });
            actions.appendChild(back);
            actions.appendChild(ok);
            content.appendChild(actions);
        }

        this.root.appendChild(overlay);
        renderList();
    };

    // #3320: создать запись «Обеспечения», привязав позицию заказа к складской полосе
    // (Партии ГП). После записи перечитывает план и переоткрывает редактор полос, чтобы
    // «Назначение» полосы обновилось (Склад → Заказ).
    AtexProductionPlanning.prototype.createStripSupply = function(strip, candidate, rolls) {
        var self = this;
        if (this.busy) return Promise.resolve();
        var meta = this.meta.supply;
        if (!meta) { this.notify('Нет метаданных таблицы «Обеспечение»', 'error'); return Promise.resolve(); }
        if (!strip || strip.id == null) { this.notify('Полоса не сохранена (нет «Партии ГП»)', 'error'); return Promise.resolve(); }
        if (!candidate || !candidate.id) { this.notify('Не выбрана позиция заказа', 'error'); return Promise.resolve(); }
        if (!(stripNum(rolls) > 0)) { this.notify('Нечего обеспечивать (0 рулонов)', 'error'); return Promise.resolve(); }
        var pos = candidate.position || {};
        var fields = buildSupplyFieldsForFinishedBatch(meta, {
            finishedBatchId: strip.id,
            rolls: rolls,
            footage: stripNum(pos.length) > 0 ? pos.length : '',
            active: '1',
            status: SUPPLY_STATUSES[0]
        });
        this.setBusy(true);
        return this.post('_m_new/' + meta.id + '?JSON&up=' + encodeURIComponent(candidate.id), fields).then(function(res) {
            var id = res && (res.obj || res.id || res.i);
            if (!id) throw new Error('Сервер не вернул id обеспечения');
            return self.loadPlanning();
        }).then(function() {
            self.setBusy(false);
            self.notify('Обеспечение создано: позиция привязана к полосе (' + round3(rolls) + ' рул.)', 'success');
            self.render();
            self.reopenStripsIfOpen();
        }).catch(function(err) {
            self.setBusy(false);
            self.notify('Ошибка создания обеспечения: ' + err.message, 'error');
        });
    };

    AtexProductionPlanning.prototype.reload = function() {
        var self = this;
        // Полосы перечитываем перед очередью, чтобы knifeCount/knifeWidths влились в свежие резки.
        return this.loadCutStrips().then(function() { return self.loadPlanning(); })
            .then(function() { return self.loadSleeveBatches(); }) // #3340: обновляем партии втулок (FIFO)
            .then(function() { self.resolveCutMaterials(); });
    };

    // ── Встроенный редактор Полос резки (база cut-calc renderStrips/computeSummary/syncStrips) ──

    var STRIP_PURPOSES = ['Заказ', 'Склад', 'Отходы'];

    // Загрузка состава резки из «Партии ГП» (#3242; подчинённые: F_U = cutId).
    // Колонки JSON_OBJ резолвятся по имени. → [{id, width, qty=полос за проход}].
    // #3431: число полос берём из «Кол-во полос»; для старых записей (колонка пустая) —
    // фолбэк на «Кол-во рулонов» (раньше там хранилось число полос за проход).
    AtexProductionPlanning.prototype.loadStripsForCut = function(cutId) {
        var sm = this.meta.finishedBatch;
        var widthIdx = columnIndex(sm, FINISHED_BATCH_REQ.width);
        var stripsIdx = columnIndex(sm, FINISHED_BATCH_REQ.strips);
        var rollsIdx = columnIndex(sm, FINISHED_BATCH_REQ.rolls);
        var orderIdx = columnIndex(sm, FINISHED_BATCH_REQ.orderId);
        return this.getJson('object/' + sm.id + '/?JSON_OBJ&F_U=' + encodeURIComponent(cutId) + '&LIMIT=0,500').then(function(rows) {
            // Единый ряд полос по убыванию ширины (порядок записей БД не гарантирован).
            return sortStripsByWidthDesc((rows || []).map(function(rec) {
                var r = rec.r || [];
                var stripsVal = (stripsIdx >= 0 && r[stripsIdx] != null) ? String(r[stripsIdx]) : '';
                var rollsVal = (rollsIdx >= 0 && r[rollsIdx] != null) ? String(r[rollsIdx]) : '';
                return {
                    id: String(rec.i),
                    width: (widthIdx >= 0 && r[widthIdx] != null) ? String(r[widthIdx]) : '',
                    qty: String(stripsVal).trim() !== '' ? stripsVal : rollsVal,
                    // #3433: «ID заказа» — копируется в записи-продолжения при дроблении по дням.
                    orderId: (orderIdx >= 0 && r[orderIdx] != null) ? String(r[orderIdx]) : ''
                };
            }));
        });
    };

    // Открыть инлайн-панель редактора полос для резки. container — очередь (this.queueEl).
    // Одна панель за раз: повторный клик по той же резке закрывает; по другой — переключает.
    AtexProductionPlanning.prototype.openStrips = function(cut, container) {
        var self = this;
        if (!this.meta.finishedBatch) { this.notify('Не найдены метаданные таблицы «' + TABLE.finishedBatch + '»', 'error'); return; }

        // Удалить существующую панель (если открыта).
        var existing = container.querySelector('.atex-pp-strip-panel');
        var wasSame = existing && String(existing.getAttribute('data-cut-id')) === String(cut.id);
        if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
        if (wasSame) { this.stripEditCutId = null; return; } // повторный клик — закрыть
        this.stripEditCutId = String(cut.id);

        var panel = el('div', { class: 'atex-pp-strip-panel', dataset: { cutId: String(cut.id) } });
        // #3326: любой клик внутри панели полос не должен её сворачивать — закрытие
        // только по .atex-pp-strip-close. Карточка резки (.atex-pp-cut) на клик делает
        // render() и пересобирает очередь, теряя панель; её обработчик пропускает клики,
        // чьё e.target.closest('.atex-pp-strip-panel') == panel. Но внутренние контролы
        // (удалить полосу, ходовая ширина, …) в своём обработчике вызывают renderRows()/
        // renderPreferred() и отцепляют нажатый узел — closest на нём даёт null, и клик
        // всё равно сворачивал панель (#3318 чинил так лишь кнопку удаления). Панель —
        // предок всех контролов в пути всплытия, поэтому stopPropagation здесь надёжно
        // гасит клик до карточки независимо от того, отцепился ли e.target.
        panel.addEventListener('click', function(e) {
            e.stopPropagation();
            // #3406 п.2: клик по панели полос выбирает её резку и обновляет
            // «Связанные позиции» справа (renderLink), не пересобирая очередь —
            // правки полос/обеспечения сразу отражаются без перезагрузки.
            self.selectCut(cut.id);
        });
        panel.appendChild(el('div', { class: 'atex-pp-strip-loading', text: 'Загрузка полос…' }));
        container.appendChild(panel);

        this.loadStripsForCut(cut.id).then(function(loaded) {
            // Если за время загрузки панель закрыли/переключили — ничего не рисуем.
            if (String(self.stripEditCutId) !== String(cut.id) || !panel.parentNode) return;
            // Глубокая копия исходного состава для диффа при сохранении (#3242: Партия ГП).
            var original = loaded.map(function(s) { return { id: s.id, width: s.width, qty: s.qty }; });
            var strips = loaded.map(function(s) { return { id: s.id, width: s.width, qty: s.qty }; });
            self.renderStripPanel(panel, cut, strips, original);
            if (cut.fixed) self.lockStripPanel(panel);   // #3508 п.3: зафиксированное — только просмотр
        }).catch(function(err) {
            if (panel.parentNode) {
                panel.innerHTML = '';
                panel.appendChild(el('div', { class: 'atex-pp-empty', text: 'Ошибка загрузки полос: ' + err.message }));
            }
        });
    };

    // #3508 п.3: панель полос зафиксированного задания — только просмотр. Глушим все
    // инпуты/кнопки, кроме крестика закрытия, и показываем пометку. Изменения состава
    // невозможны (как и удаление/перепланирование/смена очередности зафиксированного).
    AtexProductionPlanning.prototype.lockStripPanel = function(panel) {
        if (!panel) return;
        panel.classList.add('is-readonly');
        var nodes = panel.querySelectorAll('input, select, textarea, button');
        Array.prototype.forEach.call(nodes, function(n) {
            if (n.classList && n.classList.contains('atex-pp-strip-close')) return;
            n.disabled = true;
        });
        var note = el('div', { class: 'atex-pp-strip-locked-note', text: '🔒 Задание зафиксировано — изменение полос недоступно' });
        var header = panel.querySelector('.atex-pp-strip-header');
        if (header && header.parentNode) header.parentNode.insertBefore(note, header.nextSibling);
        else panel.appendChild(note);
    };

    // Рендер содержимого панели редактора полос (таблица + сводка + ходовые + кнопки).
    AtexProductionPlanning.prototype.renderStripPanel = function(panel, cut, strips, original) {
        var self = this;
        var jumbo = Number(this.jumboWidthByMaterial[String(cut.materialId)]) || 0;
        var prefWidths = [];   // загруженные ходовые ширины (#3128, фильтруются по остатку)
        panel.innerHTML = '';

        // Заголовок: сырьё + ширина джамбо, справа — иконка закрытия (#3127).
        var matLabel = (cut.materialBatch && cut.materialBatch.label) || cut.materialName || cut.materialId || '—';
        var closeIcon = el('button', { class: 'atex-pp-strip-close', type: 'button', title: 'Закрыть', text: '×' });
        closeIcon.addEventListener('click', function() {
            self.stripEditCutId = null;
            if (panel.parentNode) panel.parentNode.removeChild(panel);
        });
        panel.appendChild(el('div', { class: 'atex-pp-strip-header' }, [
            el('span', { class: 'atex-pp-strip-header-text', text: 'Сырьё: ' + matLabel + ', Джамбо: ' + (jumbo || '—') + ' мм' }),
            closeIcon
        ]));

        // Таблица полос.
        var table = el('div', { class: 'atex-pp-strip-table' });
        // #3253: редактируем «Кол-во полос» (за проход); «Рулонов» (полос × проходов) —
        // справочно, read-only. Геометрия (Занято/Остаток/Ножи) считается по полосам.
        var passes = stripNum(cut.plannedRuns) > 0 ? stripNum(cut.plannedRuns) : 1;
        // #3280: «Назначение» полосы — Заказ (на эту Партию ГП есть ссылка из Обеспечения)
        // или Склад (ссылки нет). Набор id Партий ГП, на которые ссылается Обеспечение.
        var orderedBatchIds = {};
        (self.supplies || []).forEach(function(s) {
            var b = s && s.finishedBatchId;
            if (b != null && String(b) !== '') orderedBatchIds[String(b)] = true;
        });
        table.appendChild(el('div', { class: 'atex-pp-strip-row atex-pp-strip-head' }, [
            el('span', { text: 'Ширина, мм' }),
            el('span', { text: 'Кол-во полос' }),
            el('span', { text: 'Рулонов (×' + passes + ')' }),
            el('span', { text: 'Назначение' }),
            el('span', { text: '' })
        ]));
        var body = el('div', { class: 'atex-pp-strip-body' });
        table.appendChild(body);
        panel.appendChild(table);

        var summaryEl = el('div', { class: 'atex-pp-strip-summary' });
        panel.appendChild(summaryEl);

        function recalc() {
            var used = planning.stripsUsedWidth(strips);
            var knives = planning.stripsTotalKnives(strips);
            // Живо обновить количество полос на кнопке «Полосы» этой карточки и в
            // дескрипторе резки, чтобы метка совпадала с редактором без перезагрузки (#3147).
            cut.knifeCount = knives;
            var card = panel.parentNode;
            var stripsBtn = card && card.querySelector('.atex-pp-strips');
            if (stripsBtn) stripsBtn.textContent = stripsButtonLabel(knives);
            summaryEl.innerHTML = '';
            // «Итого ножей» = число полос + 1 (крайний нож): N полос режутся N+1 ножом.
            // knives здесь — число полос (Σ qty), оно же метка кнопки «Полосы (N)».
            summaryEl.appendChild(metric('Итого ножей', knives > 0 ? knives + 1 : 0));
            summaryEl.appendChild(metric('Занято, мм', used));
            // Ширина джамбо неизвестна (нет вида сырья / ширины) → остаток посчитать
            // нельзя. Не показываем ложный отрицательный «вне допуска» (#3116 п.5),
            // а нейтрально сигналим, что джамбо не задан.
            if (!(jumbo > 0)) {
                summaryEl.appendChild(metric('Остаток, мм', '—'));
                summaryEl.appendChild(el('span', { class: 'atex-pp-strip-badge', text: 'ширина джамбо не задана' }));
                // #3706: джамбо не задан — снять подсветку «вне допуска» с кнопки.
                if (stripsBtn) { stripsBtn.classList.remove('is-warn'); stripsBtn.title = 'Полосы резки (количество полос)'; }
            } else {
                var rem = planning.stripsRemainder(jumbo, strips);
                var tol = self.resolveToleranceMm(cut.materialId);   // допуск вида сырья или дефолт 20
                var within = Math.abs(rem) <= Math.abs(tol);
                var remNode = metric('Остаток, мм', rem);
                if (within) remNode.classList.add('is-ok'); else remNode.classList.add('is-warn');
                summaryEl.appendChild(remNode);
                var badge = el('span', { class: 'atex-pp-strip-badge ' + (within ? 'is-ok' : 'is-warn'), text: within ? 'в допуске' : 'вне допуска' });
                summaryEl.appendChild(badge);
                // #3706: живо перекрасить кнопку «Полосы» этой карточки под текущий остаток.
                if (stripsBtn) {
                    if (within) { stripsBtn.classList.remove('is-warn'); stripsBtn.title = 'Полосы резки (количество полос)'; }
                    else { stripsBtn.classList.add('is-warn'); stripsBtn.title = 'Полосы резки — отход вне допуска'; }
                }
            }
            renderPreferred();   // #3128 — перефильтровать ходовые по текущему остатку
        }

        function metric(label, value) {
            return el('div', { class: 'atex-pp-strip-metric' }, [
                el('span', { class: 'atex-pp-strip-metric-label', text: label }),
                el('span', { class: 'atex-pp-strip-metric-value', text: String(value) })
            ]);
        }

        function renderRows() {
            body.innerHTML = '';
            strips.forEach(function(s, idx) {
                var row = el('div', { class: 'atex-pp-strip-row' });

                var w = el('input', { class: 'atex-pp-input', type: 'number', min: '0', step: 'any', placeholder: '0' });
                w.value = s.width;
                w.addEventListener('input', function() { s.width = w.value; recalc(); });
                w.addEventListener('change', function() { self.persistStrip(cut.id, s); });  // авто-сейв (#3127)
                row.appendChild(w);

                // #3253: read-only «Рулонов» = полос × проходов (справочно).
                var rollsCell = el('span', { class: 'atex-pp-strip-rolls', text: String(round3((stripNum(s.qty) || 0) * passes)) });

                var q = el('input', { class: 'atex-pp-input', type: 'number', min: '0', step: '1', placeholder: '0' });
                q.value = s.qty;
                var lastGoodQty = s.qty;   // #3445: откат при превышении «Максимального запаса»
                q.addEventListener('input', function() {
                    s.qty = q.value;
                    rollsCell.textContent = String(round3((stripNum(s.qty) || 0) * passes));
                    recalc();
                });
                q.addEventListener('change', function() {
                    // #3445: не дать ручным вводом превысить «Максимальный запас» (остаток + впрок).
                    var bad = self.stockLimitExceededForCut(cut, strips, passes, orderedBatchIds);
                    if (bad) {
                        s.qty = lastGoodQty; q.value = lastGoodQty;
                        rollsCell.textContent = String(round3((stripNum(s.qty) || 0) * passes));
                        recalc();
                        self.notify('Превышен «Максимальный запас» по ' + bad.width + ' мм: на складе ' + bad.current +
                            ' + впрок ' + bad.adding + ' = ' + bad.projected + ' > лимит ' + bad.limit + ' рул. Не сохранено.', 'error');
                        return;
                    }
                    lastGoodQty = s.qty;
                    self.persistStrip(cut.id, s);   // авто-сейв (#3127)
                });
                row.appendChild(q);

                row.appendChild(rollsCell);   // #3253: вычисляемое поле «Рулонов», read-only

                // #3280: «Назначение» — Заказ (на эту Партию ГП есть ссылка из Обеспечения) / Склад.
                // #3391: необеспеченная полоса идёт на «Склад», только если её номенклатуру
                // целесообразно хранить (есть в «Максимальном запасе»); иначе — «Отходы».
                var isOrdered = (s.id != null && orderedBatchIds[String(s.id)]);
                var purpose = isOrdered ? 'Заказ' : planning.stockStripPurpose(self.maxStockIndex, {
                    material: cut.materialId,
                    width: s.width,
                    length: cut.length,
                    winding: cut.winding
                });
                var purposeMod = isOrdered ? 'order' : (purpose === 'Отходы' ? 'waste' : 'stock');
                var purposeCell = el('div', { class: 'atex-pp-strip-purpose-cell' }, [
                    el('span', {
                        class: 'atex-pp-strip-purpose atex-pp-strip-purpose--' + purposeMod,
                        text: purpose
                    })
                ]);
                // #3320: правее «Склад» — значок «обеспечить»: привязать необеспеченную
                // позицию заказа к этой (уже сохранённой) полосе через «Обеспечение».
                if (!isOrdered && s.id != null) {
                    var supplyIcon = el('button', {
                        class: 'atex-pp-strip-supply',
                        type: 'button',
                        title: 'Обеспечить позицию заказа этой полосой',
                        text: '🔗'
                    });
                    supplyIcon.addEventListener('click', function(e) {
                        e.stopPropagation();
                        if (self.busy) return;
                        self.openStripSupplyPicker(cut, s, passes);
                    });
                    purposeCell.appendChild(supplyIcon);
                }
                row.appendChild(purposeCell);

                var del = el('button', {
                    class: 'atex-pp-btn atex-pp-strip-del' + (isOrdered ? ' is-disabled' : ''),
                    type: 'button',
                    title: isOrdered
                        ? 'Полоса зарезервирована в заказ. Чтобы удалить, отвяжите позиции на форме «Связанные позиции» справа — тогда полоса станет складской и её можно будет удалить.'
                        : 'Удалить полосу',
                    text: '×'
                });
                del.addEventListener('click', function(e) {
                    // #3318 п.1: не всплывать к обработчику карточки — иначе renderRows()
                    // отцепляет кнопку, closest('.atex-pp-strip-panel') возвращает null и
                    // self.render() закрывает панель полос.
                    e.stopPropagation();
                    // #3318 п.2: полосу «в заказ» (есть связи-обеспечения) удалить нельзя —
                    // кнопка неактивна; удаление — через отвязку позиций справа.
                    if (self.busy || isOrdered) return;
                    var removed = strips.splice(idx, 1)[0];
                    renderRows();
                    recalc();
                    // Уже сохранённую полосу (есть id) удаляем на сервере сразу (#3124):
                    // раньше _m_del уходил только по «Сохранить полосы», поэтому при
                    // обновлении страницы удалённые полосы возвращались. Убираем и из
                    // original, чтобы последующее «Сохранить» не пыталось удалить повторно.
                    if (removed && removed.id) {
                        for (var i = 0; i < original.length; i++) {
                            if (String(original[i].id) === String(removed.id)) { original.splice(i, 1); break; }
                        }
                        self.post('_m_del/' + encodeURIComponent(removed.id) + '?JSON', {}).then(function() {
                            self.notify('Полоса удалена', 'info');
                        }).catch(function(err) {
                            self.notify('Ошибка удаления полосы: ' + err.message, 'error');
                        });
                    }
                });
                row.appendChild(del);

                body.appendChild(row);
            });
        }

        // Кнопка «+ полоса».
        var addBtn = el('button', { class: 'atex-pp-btn atex-pp-strip-add', type: 'button', text: '+ полоса' });
        addBtn.addEventListener('click', function() {
            strips.push({ id: null, width: '', qty: '' });   // #3242: запись «Партии ГП»
            renderRows();
            recalc();
        });
        panel.appendChild(addBtn);

        // Панель ходовых ширин (#3128: 3 ряда со скроллом — в CSS; скрываем те,
        // что шире текущего остатка джамбо).
        var matKey = String(cut.materialId == null ? '' : cut.materialId);
        var prefKey = preferredWidthsKey(matKey, cut && cut.winding, cut && cut.length);
        // #3954: ходовые (preferable_widths) есть смысл грузить только для семейств,
        // целесообразных к хранению («Максимальный запас»); для прочих любой добор
        // отсеется в пустоту — отчёт (медленный) не запрашиваем.
        var prefFamilyStockable = planning.maxStockFamilyStockable(self.maxStockIndex,
            { material: cut.materialId, length: cut.length, winding: cut.winding });
        var prefWrap = el('div', { class: 'atex-pp-strip-pref' });
        prefWrap.appendChild(el('div', { class: 'atex-pp-strip-pref-title', text: 'Ходовые ширины' }));
        var prefList = el('div', { class: 'atex-pp-strip-pref-list' });
        prefWrap.appendChild(prefList);
        panel.appendChild(prefWrap);
        var prefLoading = (matKey !== '' && prefFamilyStockable);

        // Перерисовать ходовые с фильтром по текущему остатку (ширина ≤ остаток
        // джамбо, если он задан). Вызывается из recalc при каждом изменении полос.
        function renderPreferred() {
            prefList.innerHTML = '';
            if (prefLoading) { prefList.appendChild(el('div', { class: 'atex-pp-strip-loading', text: 'Загрузка ходовых…' })); return; }
            // #3954: семейство не в «Максимальном запасе» — добор не предлагаем (отчёт не грузили).
            if (!prefFamilyStockable) {
                prefList.appendChild(el('div', { class: 'atex-pp-empty', text: 'Нет ходовых, целесообразных к хранению (не в «Максимальном запасе»).' }));
                return;
            }
            if (!prefWidths.length) { prefList.appendChild(el('div', { class: 'atex-pp-empty', text: 'Нет данных по ходовым ширинам.' })); return; }
            // #3391: добор предлагаем только из номенклатур, целесообразных к хранению
            // (есть в «Максимальном запасе»); прочие ширины ушли бы в отход, впрок не режем.
            var stockable = planning.filterStockableWidths(self.maxStockIndex, prefWidths, {
                material: cut.materialId, winding: cut.winding, length: cut.length
            });
            if (!stockable.length) {
                prefList.appendChild(el('div', { class: 'atex-pp-empty', text: 'Нет ходовых, целесообразных к хранению (не в «Максимальном запасе»).' }));
                return;
            }
            var rem = (jumbo > 0) ? (jumbo - planning.stripsUsedWidth(strips)) : null;
            var list = stockable.filter(function(p) { return rem == null || (Number(p.width) || 0) <= rem; });
            if (!list.length) { prefList.appendChild(el('div', { class: 'atex-pp-empty', text: 'Нет ходовых, помещающихся в остаток.' })); return; }
            list.forEach(function(p) {
                var b = el('button', { class: 'atex-pp-btn atex-pp-strip-pref-item', type: 'button',
                    text: p.width + ' мм · Популярность ' + p.popularity });
                b.addEventListener('click', function() {
                    var ns = { id: null, width: String(p.width), qty: '1' };   // #3242: «Партия ГП»
                    // #3445: не добирать ходовую, если она выведет склад за «Максимальный запас».
                    var bad = self.stockLimitExceededForCut(cut, strips.concat([ns]), passes, orderedBatchIds);
                    if (bad) {
                        self.notify('Нельзя добрать ' + p.width + ' мм: «Максимальный запас» будет превышен (на складе ' +
                            bad.current + ' + впрок ' + bad.adding + ' = ' + bad.projected + ' > лимит ' + bad.limit + ' рул.).', 'error');
                        return;
                    }
                    strips.push(ns);
                    sortStripsByWidthDesc(strips);   // добор встаёт по своей ширине (единый ряд по убыванию)
                    renderRows();
                    recalc();
                    self.persistStrip(cut.id, ns);   // авто-сейв (#3127)
                });
                prefList.appendChild(b);
            });
        }

        if (matKey !== '' && this.preferredByMaterial[prefKey]) {
            prefWidths = this.preferredByMaterial[prefKey]; prefLoading = false;
        } else if (matKey !== '' && prefFamilyStockable) {
            this.loadPreferredWidths(matKey, cut && cut.winding, cut && cut.length).then(function(list) {
                prefWidths = list || []; prefLoading = false;
                if (String(self.stripEditCutId) === String(cut.id) && panel.parentNode) renderPreferred();
            }).catch(function() {
                prefWidths = []; prefLoading = false;
                if (panel.parentNode) renderPreferred();
            });
        } else {
            prefLoading = false;   // #3954: семейство вне «Максимального запаса» → отчёт не грузим
        }

        // Кнопка «Сохранить полосы» убрана (#3127): сохраняем по мере редактирования
        // (persistStrip на change полей + при вставке ходовой; удаление шлёт _m_del).
        // Закрытие — иконкой × в шапке панели.

        renderRows();
        recalc();
    };

    // #3431: число резок (повторов) резки по id — для «Кол-во рулонов» = полосы × проходов.
    AtexProductionPlanning.prototype.cutPlannedRunsById = function(cutId) {
        var c = (this.cuts || []).filter(function(x) { return String(x.id) === String(cutId); })[0];
        return c ? stripNum(c.plannedRuns) : 0;
    };

    // #3445: лимит запаса при ручном редактировании состава. Суммирует планируемые НА
    // СКЛАД рулоны этой резки по каждой номенклатуре (полосы не «Заказ» × проходов) и
    // сравнивает с лимитом «Максимального запаса» за вычетом текущего остатка склада.
    // null — всё в пределах; иначе { width, limit, current, adding, projected }.
    // Балансовый снимок грузится при старте РМ и не учитывает несохранённые правки этой
    // сессии — для свежесгенерированной резки это даёт корректную абсолютную проверку.
    AtexProductionPlanning.prototype.stockLimitExceededForCut = function(cut, strips, passes, orderedBatchIds) {
        var self = this;
        var runs = stripNum(passes);
        if (!(runs > 0) || !cut) return null;
        var addByKey = {}, nomByKey = {}, widthByKey = {};
        (strips || []).forEach(function(s) {
            if (s && s.id != null && orderedBatchIds && orderedBatchIds[String(s.id)]) return; // заказное покрытие — не запас
            var w = stripNum(s && s.width), qty = stripNum(s && s.qty);
            if (!(w > 0) || !(qty > 0)) return;
            var nom = { material: cut.materialId, width: w, length: cut.length, winding: cut.winding };
            if (planning.stockHeadroom(self.maxStockIndex, self.stockBalanceIndex, nom) == null) return; // нет количественного лимита
            var key = planning.maxStockKey(nom);
            addByKey[key] = round3((addByKey[key] || 0) + qty * runs);
            nomByKey[key] = nom; widthByKey[key] = w;
        });
        var bad = null;
        Object.keys(addByKey).forEach(function(key) {
            if (bad) return;
            var nom = nomByKey[key];
            var limit = planning.maxStockLimit(self.maxStockIndex, nom);
            if (limit == null) return;
            var current = planning.currentStock(self.stockBalanceIndex, nom);
            var projected = round3(current + addByKey[key]);
            if (projected > limit) bad = { width: widthByKey[key], limit: limit, current: current, adding: round3(addByKey[key]), projected: projected };
        });
        return bad;
    };

    // Авто-сейв одной полосы по мере редактирования (#3127). Есть id → _m_set;
    // нет id, но есть данные → _m_new (up=cutId), сохраняем выданный id в strip.id
    // (флаг _creating защищает от двойного создания при близких change-событиях).
    // Пустую новую полосу не создаём. Ошибки — тостом.
    AtexProductionPlanning.prototype.persistStrip = function(cutId, strip) {
        var self = this;
        var sm = this.meta.finishedBatch;   // #3242: состав резки = «Партия ГП»
        if (!sm || !strip) return Promise.resolve();
        // #3431/#3433: «Кол-во полос» = введённое число полос; «Кол-во план» = полосы ×
        // проходов резки. «Кол-во рулонов» (спрос) и «ID заказа» проставляются при
        // привязке «Обеспечения», поэтому здесь не пишутся (ручное редактирование состава).
        var fields = buildFinishedBatchFields(sm, { width: strip.width, strips: strip.qty,
            planned: finishedBatchRolls(strip.qty, this.cutPlannedRunsById(cutId)), active: '1' });
        if (strip.id) {
            return self.post('_m_set/' + strip.id + '?JSON', fields).catch(function(err) {
                self.notify('Ошибка сохранения полосы: ' + err.message, 'error');
            });
        }
        var hasData = String(strip.width).trim() !== '' || String(strip.qty).trim() !== '';
        if (!hasData || strip._creating) return Promise.resolve();
        strip._creating = true;
        return self.post('_m_new/' + sm.id + '?JSON&up=' + encodeURIComponent(cutId), fields).then(function(res) {
            var id = res && (res.obj || res.id || res.i);
            if (id) strip.id = String(id);
            strip._creating = false;
        }).catch(function(err) {
            strip._creating = false;
            self.notify('Ошибка сохранения полосы: ' + err.message, 'error');
        });
    };

    // Сохранить состав резки — дифф original↔strips (#3242: «Партия ГП»):
    //   нет id → _m_new (up=cutId); изменены width/qty → _m_set; удалённые id → _m_del.
    // Поля резолвятся по имени (FINISHED_BATCH_REQ). Возвращает Promise; setBusy/reload/notify.
    AtexProductionPlanning.prototype.saveStrips = function(cutId, strips, original) {
        var self = this;
        var sm = this.meta.finishedBatch;
        var runs = this.cutPlannedRunsById(cutId);   // #3431/#3433: «Кол-во план» = полосы × проходов

        // Карта исходных записей по id для сравнения.
        var origById = {};
        (original || []).forEach(function(s) { if (s.id) origById[String(s.id)] = s; });
        var keepIds = {};

        var ops = [];
        (strips || []).forEach(function(s) {
            var hasData = String(s.width).trim() !== '' || String(s.qty).trim() !== '';
            // #3431/#3433: «Кол-во полос» = введённое число полос; «Кол-во план» = полосы ×
            // проходов. «Кол-во рулонов» (спрос)/«ID заказа» — при привязке «Обеспечения».
            var fields = buildFinishedBatchFields(sm, { width: s.width, strips: s.qty,
                planned: finishedBatchRolls(s.qty, runs), active: '1' });
            if (s.id) {
                keepIds[String(s.id)] = true;
                var o = origById[String(s.id)];
                var changed = !o ||
                    String(o.width).trim() !== String(s.width).trim() ||
                    String(o.qty).trim() !== String(s.qty).trim();
                if (changed) {
                    ops.push(function() { return self.post('_m_set/' + s.id + '?JSON', fields); });
                }
            } else if (hasData) {
                ops.push(function() {
                    return self.post('_m_new/' + sm.id + '?JSON&up=' + encodeURIComponent(cutId), fields);
                });
            }
        });
        // Удалённые: исходные id, которых нет среди текущих полос.
        Object.keys(origById).forEach(function(id) {
            if (!keepIds[id]) ops.push(function() { return self.post('_m_del/' + id + '?JSON', {}); });
        });

        this.setBusy(true);
        var chain = ops.reduce(function(p, op) { return p.then(op); }, Promise.resolve());
        return chain.then(function() {
            self.stripEditCutId = null;
            return self.reload();
        }).then(function() {
            self.setBusy(false);
            self.render();
            self.notify('Полосы сохранены', 'success');
        }).catch(function(err) {
            self.setBusy(false);
            self.notify('Ошибка сохранения полос: ' + err.message, 'error');
        });
    };

    // Генерация резок под необеспеченные позиции через чистое ядро cut-layout
    // (window.AtexCutLayout.layout.planLayouts). Для каждого сырья строит раскладки
    // (Полосы Заказ/Склад), затем последовательно создаёт: Резку → её Полосы →
    // Обеспечения (по одному на покрытую позицию). Все реквизиты резолвятся по имени.
    AtexProductionPlanning.prototype.generateCuts = function(actionsEl) {
        var self = this;
        if (this.busy) return;
        console.log('[pp] ⚙️ generateCuts: начало генерации резок...');

        var layoutCore = (typeof window !== 'undefined' && window.AtexCutLayout && window.AtexCutLayout.layout) || null;
        if (!layoutCore || typeof layoutCore.planLayouts !== 'function') {
            console.error('[pp] ⚙️ generateCuts: модуль cut-layout не загружен');
            this.notify('Модуль раскладки cut-layout не загружен', 'error');
            return;
        }
        if (!this.meta.cut || !this.meta.supply || !this.meta.finishedBatch) {
            console.error('[pp] ⚙️ generateCuts: не найдены метаданные', {cut:!!this.meta.cut, supply:!!this.meta.supply, finishedBatch:!!this.meta.finishedBatch});
            this.notify('Не найдены метаданные таблиц (Задание/Обеспечение/Партия ГП)', 'error');
            return;
        }

        // #3444: перед планированием перезапросить позиции (report/positions_list) и
        // обеспечение/резки — в соседней вкладке могли загрузить новые заказы или сменить
        // дату, и по кэшу мы бы перепланировали старые позиции вместо генерации новых
        // резок. Прежнее подтверждение убираем и показываем заново на свежих данных.
        if (this._genRefreshing) return;
        var refreshHost = actionsEl || (this.root && this.root.querySelector('.atex-pp-panel-actions'));
        var oldBar = refreshHost && refreshHost.querySelector && refreshHost.querySelector('.atex-pp-confirm-bar');
        if (oldBar && oldBar.parentNode) oldBar.parentNode.removeChild(oldBar);
        this._genRefreshing = true;
        this.setGenBusy(true);
        // #3865: сразу показываем окно прогресса (этап подготовки неопределённый — без счётчика,
        // полоса «бежит»), чтобы по клику «Сгенерировать» было видно, что идёт работа, а не тишина
        // до подтверждения. Дальше планирование/генерация обновляют текст и счётчик.
        this.showProgress('Подготовка генерации…', 0);
        this.updateProgress(0, 'Обновление позиций, очереди и заправки станков…');
        // #3862: заправку станков (prev_cut_setup) тоже обновляем — она привязана к ДАТЕ окна
        // планирования (task_start<планБаза), а дату могли сменить после загрузки страницы; иначе
        // первая резка считалась бы от заправки на старую дату.
        Promise.all([this.loadPositions(), this.reload(), this.loadPrevCutSetup()]).then(function() {
            self._genRefreshing = false;
            self.setGenBusy(false);
            self.updateProgress(0, 'Планирование раскладок…');   // #3865
            // #3457: loadPositions() пересоздал genPositions с НОМИНАЛЬНОЙ шириной заказа —
            // заново проставляем фактическую ширину резки (#3372: справочник 66190), иначе
            // планирование/раскладка/Партии ГП пойдут по номиналу (60мм вместо 59мм).
            // Справочники (actualWidthIndex/jumboWidthByMaterial/nominalWidthByMaterial/sleeveInchesById) живут с start().
            self.annotatePositionsCutWidth();
            self.render();
            self.planAndConfirmCuts(actionsEl);
        }).catch(function(err) {
            self._genRefreshing = false;
            self.setGenBusy(false);
            self.hideProgress();   // #3865
            console.error('[pp] ⚙️ generateCuts: не удалось обновить данные перед планированием', err);
            self.notify('Не удалось обновить данные перед планированием: ' + (err && err.message || err), 'error');
        });
    };

    // #3444: планирование + подтверждение (вызывается после перезапроса позиций/обеспечения).
    AtexProductionPlanning.prototype.planAndConfirmCuts = function(actionsEl) {
        var self = this;
        var layoutCore = (typeof window !== 'undefined' && window.AtexCutLayout && window.AtexCutLayout.layout) || null;
        if (!layoutCore || typeof layoutCore.planLayouts !== 'function') { this.hideProgress(); return; }   // #3865

        // #(no-srok-when-on-time): срок учитываем (дробим позиции по окну) только если
        // есть просроченные относительно даты планирования. Если все позиции укладываются
        // в свой срок (dueKey ≥ planDateKey), окно не нужно — объединяем в один кластер.
        var planBaseMs = planBaseMidnightFrom(this.filter && this.filter.date, controllerNowMs(this));
        var pbmD = new Date(planBaseMs);
        var planDateKey = pbmD.getFullYear() * 10000 + (pbmD.getMonth() + 1) * 100 + pbmD.getDate();

        // Необеспеченные позиции, сгруппированные по совместимому профилю:
        // сырьё + направление намотки + длина намотки.
        // Только согласованные (order_approval_date или item_approval_date).
        var unsup = uncoveredPositions(this.genPositions, this.supplies).filter(function(p) { return p.approved; });
        // #3812: позиции на втулке 0.5″ у́же 55 мм не производятся — исключаем из планирования.
        var notProducible = [];
        unsup = unsup.filter(function(p) {
            if (p.producible === false) { notProducible.push(p); return false; }
            return true;
        });
        console.log('[pp] ⚙️ generateCuts: всего позиций:', this.genPositions.length, ', необеспеченных согласованных:', unsup.length);
        if (!unsup.length) {
            // #3792: вброс новых заданий пересобирает очередь по правилам (preserveOrder=false:
            // минимум переналадок — группировка сырья; при прочих равных — больше полос раньше).
            // Ручной порядок оператора переживает генерацию ТОЛЬКО через флаг «Зафиксировано» —
            // он держит задание на своём дне (не переносит/не разбивает), внутри дня переставлять
            // можно. Идемпотентно (#3427): если ничего не меняется — ничего не пишем.
            console.log('[pp] ⚙️ generateCuts: незапланированных позиций нет — пересобираю очередь по правилам');
            var npNote = notProducible.length ? ' Пропущено ' + notProducible.length + ' поз. (втулка 0.5″, ширина < 55 мм).' : '';
            this.hideProgress();   // #3865: дальше autoSequenceQueue покажет свой прогресс «Сохранение плана резок…»
            this.autoSequenceQueue(PLANNING_STRATEGY_SETUP, false).then(function(changed) {
                self.notify((changed ? 'Очередь пересобрана по правилам (зафиксированные задания — на своих днях)'
                                     : 'Нет незапланированных позиций; очередь уже оптимальна') + npNote, 'info');
            });
            return;
        }
        var profiles = groupPositionsByPlanningProfile(unsup);
        console.log('[pp] ⚙️ generateCuts: сгруппировано по сырью/намотке/метражу:', profiles.length,
            'профилей:', profiles.map(function(g) { return g.key; }));

        // Догрузить ходовые ширины для профиля, у которого их ещё нет в кеше.
        // #3954: отчёт preferable_widths дёргаем только для семейств, целесообразных к
        // хранению («Максимальный запас»). Для прочих добор всё равно отфильтруется в
        // пустоту (filterStockableWidths ниже), а отчёт медленный — экономим ожидание.
        var preloads = [];
        profiles.forEach(function(group) {
            if (group.materialId !== '' && !self.preferredByMaterial[group.key] &&
                planning.maxStockFamilyStockable(self.maxStockIndex,
                    { material: group.materialId, length: group.windLength, winding: group.windDir })) {
                preloads.push(self.loadPreferredWidths(group.materialId, group.windDir, group.windLength));
            }
        });

        // На время запросов preferable_widths (preloads) деактивируем кнопку и
        // показываем крутилку (#3332), иначе клик «глохнет» без видимой реакции.
        self.setGenBusy(true);
        if (preloads.length) self.updateProgress(0, 'Загрузка ходовых ширин…');   // #3865
        Promise.all(preloads).then(function() {
            // Запросы завершены — крутилку убираем; далее идёт синхронная раскладка
            // и (при наличии) модалка подтверждения / runGenerateCuts со своим busy.
            self.setGenBusy(false);
            self.updateProgress(0, 'Планирование раскладок…');   // #3865
            // Построить раскладки по каждому профилю; собрать пропуски.
            var allLayouts = [];   // [{...layout, mat}]
            var skipped = [];      // [{positionId, reason}]
            // #3812: непроизводимые (втулка 0.5″, ширина < 55 мм) — в пропуски.
            notProducible.forEach(function(p) { skipped.push({ positionId: p.id, reason: 'втулка 0.5″: ширина < 55 мм не производится' }); });

            // #3872: дополнительные втулки 110 мм могут быть уже заказаны. Профили-носители
            // втулочных полос обрабатываем ПЕРВЫМИ: на каждую их раскладку «забираем» подходящие
            // позиции заказа 110 мм (тот же заказ, то же сырьё/намотка/длина) как реальные полосы
            // (coreFillerClaims), а уже потом планируем остальные профили — забранные 110-мм позиции
            // в свою отдельную резку не уходят. Не нашлось — добиваем синтетикой (#3812).
            var posById = positionMap(self.genPositions);
            var coreFillerClaims = {};   // positionId → true (позиция съедена носителем как полоса 110)
            var orderedProfiles = profiles.filter(function(g) { return g.coreStripCount > 0; })
                .concat(profiles.filter(function(g) { return !(g.coreStripCount > 0); }));

            orderedProfiles.forEach(function(group) {
                var mat = group.materialId;
                // #3872: позиции, уже забранные носителем как втулочные полосы, в этом профиле не планируем.
                var groupPositions = group.positions.filter(function(p) { return !coreFillerClaims[String(p.id)]; });
                if (!groupPositions.length) return;
                var jw = self.jumboWidthByMaterial[mat];
                if (!jw) {
                    groupPositions.forEach(function(p) { skipped.push({ positionId: p.id, reason: 'нет ширины джамбо' }); });
                    return;
                }
                layoutPositionGroups(groupPositions).forEach(function(positionGroup) {
                    // Нет просроченных позиций (всё в рамках срока) → окно срока не нужно,
                    // объединяем все позиции сырья (windowDays=Infinity); иначе дробим по WINDOW_DAYS.
                    var hasOverdue = positionGroup.some(function(p) {
                        return isFinite(p.dueKey) && p.dueKey < planDateKey;
                    });
                    // #3391: добор джамбо ходовыми — только из номенклатур, целесообразных
                    // к хранению (есть в «Максимальном запасе»); прочее уходит в отход, не впрок.
                    var stockablePreferred = planning.filterStockableWidths(
                        self.maxStockIndex, self.preferredByMaterial[group.key] || [],
                        { material: mat, winding: group.windDir, length: group.windLength });
                    // #3812: втулка 0.5″ шир. 110 мм — резервируем ширину джамбо под втулочные
                    // полосы 110 мм ДО укладки продукта (occupied width), полосы дописываем
                    // в каждый раскрой ниже. Профиль разбит по count, поэтому ширина едина.
                    var coreCount = group.coreStripCount || 0;
                    var coreWidth = group.coreStripWidth || 0;
                    var coreReserve = coreCount > 0 && coreWidth > 0 ? round3(coreCount * coreWidth) : 0;
                    var effJumbo = round3(jw - coreReserve);
                    if (coreReserve > 0) {
                        var maxProd = positionGroup.reduce(function(m, p) { var w = Number(p.width) || 0; return w > m ? w : m; }, 0);
                        if (!(effJumbo >= maxProd)) {
                            positionGroup.forEach(function(p) { skipped.push({ positionId: p.id, reason: 'втулка ' + coreWidth + ' мм: не хватает ширины джамбо под втулочные полосы' }); });
                            return;
                        }
                    }
                    var res = layoutCore.planLayouts({
                        jumboWidth: effJumbo,
                        positions: positionGroup.map(function(p) {
                            // #3423: запасные комбинации (есть в «Максимальном запасе») можно
                            // перепроизводить в запас; незапасные — резать ровно под заказ.
                            // #3684/#3706: orderId — для seed «1 заказ = 1 резка» (позиции
                            // одного заказа собираются в одну резку; одинаковая ширина РАЗНЫХ
                            // заказов не склеивается принудительно).
                            return { id: p.id, orderId: p.orderId, width: p.width, qty: p.qty, dueKey: p.dueKey,
                                stockable: planning.isStockableNomenclature(self.maxStockIndex, {
                                    material: mat, width: p.width,
                                    length: group.windLength, winding: group.windDir }) };
                        }),
                        preferred: stockablePreferred,
                        options: { windowDays: hasOverdue ? WINDOW_DAYS : Infinity, tolerance: self.resolveToleranceMm(mat) }
                    });
                    (res.layouts || []).forEach(function(lay) {
                        lay.mat = mat;
                        lay.windDir = group.windDir;
                        lay.windLength = group.windLength;
                        lay.leader = group.leader;   // #3569: лидер профиля — копируется в задание
                        lay.isFoil = !!group.isFoil; // #3599: фольга — раскладку в конец смены
                        if (coreReserve > 0) {
                            // #3872: привязать втулочные полосы к уже заказанным 110-мм позициям
                            // того же заказа (что покрывает раскладка). Найденные позиции — реальные
                            // полосы (обеспечение на произведённое); не нашлось — синтетика (#3812).
                            var coveredOrders = {};
                            (lay.positionsCovered || []).forEach(function(pid) {
                                var cp = posById[String(pid)];
                                if (cp && cp.orderId != null && String(cp.orderId) !== '') coveredOrders[String(cp.orderId)] = true;
                            });
                            var fillerIds = selectCoreStripFillers(unsup, group, coveredOrders, coreFillerClaims);
                            appendCoreStrip(lay, coreWidth, coreCount, fillerIds); // #3812/#3872
                        }
                        allLayouts.push(lay);
                    });
                    (res.skipped || []).forEach(function(s) { skipped.push(s); });
                });
            });

            console.log('[pp] ⚙️ generateCuts: раскладок построено:', allLayouts.length, ', пропущено:', skipped.length);
            if (skipped.length > 0) console.log('[pp] ⚙️ generateCuts: первые пропуски:', JSON.stringify(skipped.slice(0, 5)));

            if (!allLayouts.length) {
                console.log('[pp] ⚙️ generateCuts: нет раскладок, выход');
                self.hideProgress();   // #3865
                self.notify('Нет необеспеченных позиций для генерации (пропущено ' + skipped.length + ')', 'info');
                return;
            }

            // #3445: capping по «Максимальному запасу» — на склад по каждой номенклатуре
            // нельзя нарезать больше лимита (с учётом текущего остатка). Урезаем добор и
            // перепроизводство впрок; заказное покрытие не трогаем. Лишнее не нарезается.
            var capPosById = positionMap(self.genPositions);
            var capResult = capStockToHeadroom(allLayouts, {
                runsForLayout: function(lay) { return plannedRunsForLayout(lay, capPosById); },
                demandRollsForWidth: function(lay, w) {
                    var sum = 0;
                    (lay.positionsCovered || []).forEach(function(pid) {
                        var p = capPosById[String(pid)];
                        if (!p) return;
                        if (round3(Number(p.width) || 0) !== round3(Number(w) || 0)) return;
                        sum += Number(p.qty) || 0;
                    });
                    return sum;
                },
                headroomForNom: function(nom) { return stockHeadroom(self.maxStockIndex, self.stockBalanceIndex, nom); }
            });
            if (capResult.trimmed.length) {
                var cappedRolls = capResult.trimmed.reduce(function(a, t) { return a + (Number(t.droppedRolls) || 0); }, 0);
                console.log('[pp] ⚙️ generateCuts: #3445 capping — урезано впрок (рулонов):', round3(cappedRolls),
                    'позиций раскладки:', capResult.trimmed.length, capResult.trimmed.slice(0, 5));
            }

            var timingDiagnostics = cutGenerationTimingDiagnostics(allLayouts, self.genPositions, self.opTimes);
            if (timingDiagnostics.length) {
                console.error('[pp] ❌ generateCuts: ошибка подготовки полей резки — ' + cutWriteDiagnosticSummary(timingDiagnostics), {
                    diagnostics: timingDiagnostics,
                    layouts: allLayouts.slice(0, 5)
                });
                self.hideProgress();   // #3865
                self.notify('Ошибка подготовки заданий: ' + cutWriteDiagnosticSummary(timingDiagnostics.slice(0, 3)) +
                    (timingDiagnostics.length > 3 ? '; …' : ''), 'error');
                return;
            }

            // #3470: вопрос «Создать производственные задания?» — в конце, после «Пропущено N».
            var msg = el('span', { class: 'atex-pp-confirm-msg' });
            msg.appendChild(document.createTextNode(
                'Не обеспечено заданиями и складом позиций: ' + unsup.length + '. '));
            if (skipped.length) {
                var skipLink = el('a', { class: 'atex-pp-skipped-link', href: '#',
                    text: 'Пропущено ' + skipped.length,
                    title: 'Открыть список пропущенных позиций в новой вкладке' });
                skipLink.addEventListener('click', function(ev) {
                    ev.preventDefault();
                    self.openSkippedReport(skipped);
                });
                msg.appendChild(skipLink);
                msg.appendChild(document.createTextNode('. '));
            } else {
                msg.appendChild(document.createTextNode('Пропущено 0. '));
            }
            // #3445: отчёт об урезании впрок по «Максимальному запасу» (если было).
            if (capResult.trimmed.length) {
                var cappedTotal = capResult.trimmed.reduce(function(a, t) { return a + (Number(t.droppedRolls) || 0); }, 0);
                msg.appendChild(document.createTextNode(
                    'Урезано впрок по «Максимальному запасу»: ' + round3(cappedTotal) + ' рул. '));
            }
            // #3470: текст «Создать производственные задания?» (без счётчика, термин «задания»).
            msg.appendChild(document.createTextNode('Создать производственные задания?'));

            // Единая кнопка генерации. Очередь строим по минимуму переналадки (#3268)
            // с ножами по убыванию (#3130) — стратегия SETUP. Прежняя «сложные раньше»
            // (FATIGUE) по route-score давала ножи по ВОЗРАСТАНИЮ (6,16,16), вопреки
            // #3130 (ideav/crm#3421). inline:true — именованная inline-кнопка, без модалки.
            // #3865: прячем прогресс подготовки — показываем чистое подтверждение; на «Создать»
            // прогресс вернётся (runGenerateCuts).
            self.hideProgress();
            self.confirmAction(msg, actionsEl, [
                { label: 'Создать', primary: true, inline: true, onConfirm: function() {
                    self.runGenerateCuts(allLayouts, skipped, PLANNING_STRATEGY_SETUP);
                } }
            ]);
        }).catch(function(err) {
            self.setGenBusy(false);
            self.hideProgress();   // #3865
            self.notify('Ошибка подготовки генерации: ' + err.message, 'error');
        });
    };

    // Последовательное создание записей по подготовленным раскладкам (#3242):
    // Резка → Партии ГП (состав, по ширинам) → задания на втулки → Обеспечения
    // (ссылаются на «Партию ГП» нужной ширины). Излишек рулонов сверх обеспечений —
    // склад (та же Партия ГП без своего обеспечения). Зависимые _m_new не параллелятся.
    AtexProductionPlanning.prototype.runGenerateCuts = function(layouts, skipped, strategy) {
        var self = this;
        // #3865/#3902: окно прогресса показываем сразу по «Создать» И уступаем кадр браузеру,
        // чтобы индикатор успел ОТРИСОВАТЬСЯ перед тяжёлой синхронной подготовкой (раскладка по
        // дням + выравнивание загрузки станков по ВСЕМ резкам выполняются синхронно, до первых
        // запросов). Один showProgress кадр не рисует: сразу за ним главный поток занимает
        // подготовка, браузер не перерисовывается, и по «Создать» UI «висит» ~минуту без
        // индикатора (#3902). setTimeout(0) отдаёт кадр на отрисовку, затем входим повторно и
        // выполняем подготовку. Ниже окно сменится счётчиком «N из M».
        if (!this._genPrepYielded) {
            this.showProgress('Генерация заданий…', 0);
            this.updateProgress(0, 'Подготовка и выравнивание загрузки станков…');
            return new Promise(function(resolve) { setTimeout(resolve, 0); }).then(function() {
                self._genPrepYielded = true;
                return Promise.resolve(self.runGenerateCuts(layouts, skipped, strategy)).then(
                    function(r) { self._genPrepYielded = false; return r; },
                    function(e) { self._genPrepYielded = false; throw e; });
            });
        }
        var cutMeta = this.meta.cut;
        var finishedBatchMeta = this.meta.finishedBatch;   // #3242: состав резки = «Партия ГП»
        var supplyMeta = this.meta.supply;
        var planOptions = makePlanningOptions(strategy, this.changeTimes, this.daySettings);   // #4059: веса из «Настройки»

        var cutReqIds = {
            slitter: reqIdByName(cutMeta, CUT_REQ.slitter),
            materialBatch: reqIdByName(cutMeta, CUT_REQ.materialBatch),
            plannedRuns: reqIdByAnyName(cutMeta, CUT_PLANNED_RUNS_NAMES),
            duration: reqIdByName(cutMeta, CUT_REQ.duration),
            timing: reqIdByName(cutMeta, CUT_REQ.timing),
            length: reqIdByName(cutMeta, CUT_REQ.length),
            winding: reqIdByName(cutMeta, CUT_REQ.winding),
            leader: reqIdByName(cutMeta, CUT_REQ.leader),   // #3569: ссылка «Лидер» (82519)
            material: reqIdByName(cutMeta, CUT_REQ.material), // #3688: ссылка «Вид сырья» (95358)
            status: reqIdByName(cutMeta, CUT_REQ.status)
        };
        var sleeveMeta = this.meta.sleeveTask;
        var sleeveReqIds = this.sleeveTaskReqIds();
        // #3155: «Метраж, м» обеспечения = «Длина, м» покрываемой позиции (длина прогона).
        // Без него footageBySupply=0 → windingMinutes=0 → все резки «0 мин» в расписании.
        var posLength = positionLengthMap(this.genPositions);
        var posById = positionMap(this.genPositions);

        // Сид баланса станков из текущих резок (счётчик по slitterId).
        var loadBySlitterId = {};
        (this.cuts || []).forEach(function(c) {
            var sid = c && c.slitter && c.slitter.id;
            if (sid != null) loadBySlitterId[String(sid)] = (loadBySlitterId[String(sid)] || 0) + 1;
        });
        var setupGroupsByDay = {};
        (this.cuts || []).forEach(function(c) {
            var sid = c && c.slitter && c.slitter.id;
            if (sid == null) return;
            var day = cutPlanDayKey(c);
            if (!setupGroupsByDay[day]) setupGroupsByDay[day] = {};
            var key = String(sid);
            if (!setupGroupsByDay[day][key]) setupGroupsByDay[day][key] = [];
            setupGroupsByDay[day][key].push(c);
        });
        var sequenceCuts = (this.cuts || []).slice();
        var cutMainState = { last: this.lastCutMainValue };
        var batchRemainingById = {};
        (this.genBatches || []).forEach(function(b) {
            var id = b && b.id != null ? String(b.id) : '';
            var lin = Number(b && b.remainderLinear);
            if (id !== '' && isFinite(lin) && lin > 0) batchRemainingById[id] = lin;
        });

        var nStrips = 0;
        var nPositions = 0;
        var nSleeveTasks = 0;
        var nSleeves = 0;
        var nCuts = layouts.length;
        var doneCuts = 0;
        var timingDiagnostics = cutGenerationTimingDiagnostics(layouts, this.genPositions, this.opTimes);
        if (timingDiagnostics.length) {
            console.error('[pp] ❌ runGenerateCuts: ошибка подготовки полей резки — ' + cutWriteDiagnosticSummary(timingDiagnostics), {
                diagnostics: timingDiagnostics
            });
            this.notify('Ошибка подготовки заданий: ' + cutWriteDiagnosticSummary(timingDiagnostics.slice(0, 3)) +
                (timingDiagnostics.length > 3 ? '; …' : ''), 'error');
            return Promise.resolve();
        }

        var layoutPlans = [];
        // #3830: рабочая ёмкость дня станка (мин) — чтобы не сваливать резку на переполненный
        // станок, когда есть свободный. Окно резки минус обед (как в splitMachineQueue).
        var genWindow = self.workingWindow();
        var genDayCapacityMin = Math.max(0, (Number(genWindow.cutEndMin) || 0) - (Number(genWindow.startMin) || 0)
            - (Number(genWindow.lunchDurationMin) || 0));
        // #3876: станки в отпуске на день резки не выбираем (мемо по дню — vacations единичны).
        var genVacationByDay = {};
        function vacationSetForDay(dayKey, planDateSec) {
            if (!(dayKey in genVacationByDay)) {
                var d = new Date(Number(planDateSec) * 1000); d.setHours(0, 0, 0, 0);
                genVacationByDay[dayKey] = self.vacationSlitterIdsForDay(d.getTime());
            }
            return genVacationByDay[dayKey];
        }
        layouts.forEach(function(lay, layIdx) {
            var plannedRuns = plannedRunsForLayout(lay, posById);
            var runLength = layoutRunLength(lay, posById);
            var batchId = pickBatchFIFOForRun(self.genBatches, lay.mat, runLength, batchRemainingById);
            // #3453: нет партии сырья (нет активной «Партии сырья» этого вида с остатком) —
            // не создаём резку с пустой «Партией сырья», а помечаем позиции пропущенными.
            // pickBatchFIFOForRun при отсутствии партии возвращает null без списания остатка.
            if (!batchId) {
                console.warn('[pp] 🔧 runGenerateCuts: раскладка без партии сырья (сырьё ' + lay.mat + ') — пропущена');
                (lay.positionsCovered || []).forEach(function(pid) {
                    skipped.push({ positionId: pid, reason: 'нет партии сырья' });
                });
                return;
            }
            var cutMainValue = nextCutMainValue(sequenceCuts, controllerNowMs(self), cutMainState);
            var day = cutPlanDayKey({ planDate: cutMainValue });
            if (!setupGroupsByDay[day]) setupGroupsByDay[day] = {};
            var descriptor = {
                id: 'generated-' + layIdx,
                materialId: lay.mat,
                winding: lay.windDir,
                batchId: batchId,
                jumboRemainingM: 0,
                knifeCount: stripsTotalKnives(lay && lay.strips),
                knifeWidths: knifeWidthsForStrips(lay && lay.strips),
                isFoil: !!(lay && lay.isFoil),
                width: stripsUsedWidth(lay && lay.strips),
                rollerWidth: 0,
                planDate: cutMainValue,
                // #3830: рабочие минуты резки (намотка) — чтобы выбор станка учитывал ёмкость дня.
                duration: plannedCutDurationMinutes(runLength, plannedRuns, self.opTimes, !!(lay && lay.isFoil))
            };
            var slitterId = chooseSlitterBySetup(descriptor, self.slitters, setupGroupsByDay[day], loadBySlitterId, planOptions, genDayCapacityMin, vacationSetForDay(day, cutMainValue), self.nominalWidthByMaterial);   // #4006: лимит ширины джамбо станка
            if (slitterId != null) {
                slitterId = String(slitterId);
                if (!setupGroupsByDay[day][slitterId]) setupGroupsByDay[day][slitterId] = [];
                setupGroupsByDay[day][slitterId].push(descriptor);
                loadBySlitterId[slitterId] = (loadBySlitterId[slitterId] || 0) + 1;
            }
            // #3974: выравниванию загрузки НЕ нужен «Срок изготовления» раскладки (dueKey, #3970):
            // packMachine → orderCuts группирует конфиги по стратегии (сырьё/ножи), БЕЗ разбиения
            // по срокам (EDD отменён), ровно как реальное расписание (splitMachineQueue от «С»).
            // Оценка настройки и так совпадает с раскладкой — отдельный dueKey на layoutPlans снят.
            layoutPlans.push({
                id: descriptor.id,
                materialId: descriptor.materialId,
                winding: descriptor.winding,
                batchId: descriptor.batchId,
                jumboRemainingM: descriptor.jumboRemainingM,
                knifeCount: descriptor.knifeCount,
                knifeWidths: descriptor.knifeWidths,
                isFoil: descriptor.isFoil,
                width: descriptor.width,
                rollerWidth: descriptor.rollerWidth,
                planDate: descriptor.planDate,
                plannedRuns: plannedRuns,
                runLength: runLength,
                duration: plannedCutDurationMinutes(runLength, plannedRuns, self.opTimes, descriptor.isFoil), // #3606
                timing: cutTimingDetails(runLength, plannedRuns, self.opTimes, descriptor.isFoil),
                slitterId: slitterId,
                cutMainValue: cutMainValue,
                sequence: '',
                index: layIdx
            });
        });
        if (layoutPlans.length) self.lastCutMainValue = cutMainState.last;
        nCuts = layoutPlans.length;   // #3453: раскладки без партии сырья отброшены — считаем по факту

        // #3848: ВЫРАВНИВАНИЕ ЗАГРУЗКИ СТАНКОВ — в памяти, по массиву layoutPlans (никаких
        // запросов в базу, #3857). Жадное chooseSlitterBySetup группирует одно сырьё/ножи на
        // ОДИН станок → он копит работу на 5 дней, пока соседний простаивает. Итеративно
        // переносим задания с перегруженного станка на менее загруженный (минимизируя макс.
        // число дней), пока есть прогресс; цикличные перестановки исключены (Set посещённых
        // комбинаций). Существующие резки держат базовую загрузку своих станков (fixedByMachine).
        // Журнал шагов — в консоль («панель отладки»). Меняем только plan.slitterId; всё
        // последующее (очередь, дробление по дням, запись) идёт по обновлённому назначению.
        (function rebalanceGeneratedLoad(){
            if (typeof self.slotPlacementOn === 'function' && self.slotPlacementOn()) return;   // #4085: в слот-режиме баланс возникает из штрафа MAX_DISTANCE — отдельная балансировка ретайрится
            if (!(genDayCapacityMin > 0) || !self.slitters || self.slitters.length < 2) return;
            var fixedByMachine = {};
            (self.cuts || []).forEach(function(c){
                var sid = c && c.slitter && c.slitter.id;
                if (sid != null) (fixedByMachine[String(sid)] = fixedByMachine[String(sid)] || []).push(c);
            });
            var labelById = {};
            (self.slitters || []).forEach(function(s){ labelById[String(s.id)] = (s.label || ('#' + s.id)); });
            function fmt(load){
                return Object.keys(load || {}).map(function(id){
                    var l = load[id]; return (labelById[id] || id) + ':' + l.days + 'д/' + Math.round(l.minutes) + 'м';
                }).join('  ');
            }
            // #3881/#3957: «загруженность» = дата окончания с учётом нерабочих дней станка.
            // machineDayOff(id, dayOffset) — нерабочий ли день-смещение от базы плана: выходной/
            // праздник (#3788, для всех станков) ИЛИ отпуск станка (#3876). Оба нужны: без выходных
            // содержимое, влезающее в дни до выходных перед отпуском, «не доходит» до отпуска —
            // станок с отпуском выглядит заканчивающим рано, хвост за отпуском не стекает (#3957).
            // Мемоизируем по дню.
            var rebBaseMidnightMs = planBaseMidnightFrom(self.filter && self.filter.date, controllerNowMs(self));
            var machineDayOffMemo = {};
            function machineDayOff(machineId, dayOffset){
                var k = machineId + ':' + dayOffset;
                if (k in machineDayOffMemo) return machineDayOffMemo[k];
                var v = self.balanceDayOff(machineId, rebBaseMidnightMs + dayOffset * 86400000);
                machineDayOffMemo[k] = v;
                return v;
            }
            // #3957 ДИАГНОСТИКА: что видит модель загрузки по дням (0..20 от базы плана) для
            // КАЖДОГО станка — рабочий(.) / выходной-праздник(W, #3788) / отпуск(V, #3876) / оба(B).
            // Плюс machineDayOff(=off?) и spanDays текущей загрузки. Если у станка с отпуском в
            // строке нет V — отпуск НЕ подхватывается (id/окно/покрытие #3883), и хвост не стекает.
            try {
                var DAY_MS_DBG = 86400000;
                (self.slitters || []).forEach(function(s){
                    var id = String(s.id), row = '', off = '';
                    for (var d = 0; d <= 20; d++){
                        var ms = rebBaseMidnightMs + d * DAY_MS_DBG;
                        var wk = !self.dayIsWorking(ms), vc = self.slitterOnVacationDay(id, ms);
                        row += vc && wk ? 'B' : vc ? 'V' : wk ? 'W' : '.';
                        off += machineDayOff(id, d) ? 'x' : '.';   // что реально вернёт модель загрузки
                    }
                    // Если row содержит W/V, а off в тех же позициях '.', значит machineDayOff НЕ
                    // подхватывает выходной/отпуск (устаревшая сборка call-site / balanceDayOff).
                    console.log('[pp] ⚖ dayoff ' + (labelById[id] || id) + ' [0..20]: сырьё=' + row +
                        ' модель=' + off + '  (W=выходной V=отпуск B=оба; x=день занят в балансе)');
                });
            } catch (e) { console.warn('[pp] ⚖ dayoff diag error', e); }
            var res = rebalanceSlitterLoad(layoutPlans, self.slitters, {
                weights: planOptions, dayCapacityMin: genDayCapacityMin, fixedByMachine: fixedByMachine,
                nominalWidthByMaterial: self.nominalWidthByMaterial,   // #4006: лимит ширины джамбо станка при переносе
                machineDayOff: machineDayOff,   // #3881/#3965: дата окончания из реальной укладки по дням
                // #3876: не переносить задание на станок, у которого в день задания (plan.planDate) отпуск.
                slitterDayBlocked: function(slitterId, plan){
                    var sec = Number(plan && plan.planDate);
                    if (!isFinite(sec) || sec <= 0) return false;
                    var d = new Date(sec * 1000); d.setHours(0, 0, 0, 0);
                    return self.slitterOnVacationDay(slitterId, d.getTime());
                },
                log: function(ev){
                    if (ev.event === 'start') console.log('[pp] ⚖ выравнивание загрузки — старт:', fmt(ev.load));
                    else if (ev.event === 'move') console.log('[pp] ⚖ #' + ev.step + ' ' + ev.cutId + ' ' + (labelById[ev.from] || ev.from) + '→' + (labelById[ev.to] || ev.to) + '  | ' + fmt(ev.load));
                    else if (ev.event === 'stop') console.log('[pp] ⚖ стоп (' + ev.reason + '), переносов ' + ev.iterations + ':', fmt(ev.load));
                }
            });
            if (res.moves.length) {
                var dB = Math.max.apply(null, Object.keys(res.loadBefore).map(function(k){ return res.loadBefore[k].days; }));
                var dA = Math.max.apply(null, Object.keys(res.loadAfter).map(function(k){ return res.loadAfter[k].days; }));
                console.log('[pp] ⚖ выравнивание: ' + res.moves.length + ' переносов; макс. дней станка ' + dB + '→' + dA);
            }
        })();

        // Create requests stay in layout order, but queue numbers for same-day
        // generated cuts follow the operator-selected planner (#3272).
        var sequenceGroups = {};
        var sequenceGroupOrder = [];
        layoutPlans.forEach(function(plan) {
            var slitterId = String(plan.slitterId == null ? '' : plan.slitterId);
            if (slitterId === '') return;
            var day = cutPlanDayKey({ planDate: plan.cutMainValue });
            var key = slitterId + '\u0000' + day;
            if (!sequenceGroups[key]) {
                sequenceGroups[key] = { slitterId: slitterId, planDate: plan.cutMainValue, plans: [] };
                sequenceGroupOrder.push(key);
            }
            sequenceGroups[key].plans.push(plan);
        });
        sequenceGroupOrder.forEach(function(key) {
            var group = sequenceGroups[key];
            var byIndex = {};
            group.plans.forEach(function(plan) { byIndex[String(plan.index)] = plan; });
            orderCuts(group.plans, planOptions).forEach(function(orderedPlan) {
                var plan = byIndex[String(orderedPlan.index)];
                if (!plan) return;
                plan.sequence = nextSequenceForCuts(sequenceCuts, group.slitterId, group.planDate);
                sequenceCuts.push({
                    id: plan.id,
                    number: plan.cutMainValue,
                    slitter: { id: group.slitterId, label: '' },
                    planDate: plan.cutMainValue,
                    sequence: plan.sequence,
                    materialId: plan.materialId,
                    winding: plan.winding,
                    batchId: plan.batchId,
                    jumboRemainingM: plan.jumboRemainingM,
                    knifeCount: plan.knifeCount,
                    knifeWidths: plan.knifeWidths,
                    isFoil: plan.isFoil,
                    width: plan.width,
                    rollerWidth: plan.rollerWidth
                });
            });
        });

        // #3280: дробление резок по дням НА УРОВНЕ ПРОХОДОВ + плановое время старта в
        // t1078. По каждому станку в порядке очерёдности раскладываем проходы по дням
        // (splitMachineQueue): резка, не влезающая до конца дня, режется — что успеваем
        // сегодня (запись-сегмент), остаток продолжается с 08:00 след. дня (ещё запись).
        // Каждый сегмент = отдельная запись «Производственной резки»: t1078 = начало окна,
        // «Кол-во план» = проходы сегмента; Полосы копируются (тот же раскрой за проход),
        // Обеспечение делится по проходам (splitSupplyShares). → segmentsByLayout[layIdx].
        var segmentsByLayout = {};
        (function() {
            var windPoints = windingPointsFromTimes(self.opTimes || {});
            var dayWindow = self.workingWindow();
            // #(gen-from-date): план строим от даты, выбранной в фильтре
            // (.atex-pp-input), даже если она в прошлом; без даты — от сегодня.
            var planBaseMidnightMs = planBaseMidnightFrom(self.filter && self.filter.date, controllerNowMs(self));
            var bySlitter = {};
            layoutPlans.forEach(function(plan) {
                var s = String(plan.slitterId == null ? '' : plan.slitterId);
                if (s === '') return;
                (bySlitter[s] = bySlitter[s] || []).push(plan);
            });
            Object.keys(bySlitter).forEach(function(s) {
                var plans = bySlitter[s].slice().sort(function(a, b) { return (Number(a.sequence) || 0) - (Number(b.sequence) || 0); });
                var perPassByCut = {}, runsByCut = {};
                plans.forEach(function(p) {
                    perPassByCut[String(p.id)] = windingMinutes(p.runLength, windPointsForCut(p.isFoil, windPoints)); // #3606
                    runsByCut[String(p.id)] = p.plannedRuns;
                });
                var segs = splitMachineQueue(plans, {
                    dayStartMin: dayWindow.startMin, dayEndMin: dayWindow.cutEndMin,
                    dayEndHourMin: dayWindow.endMin,   // #3847: DAY_END_HOUR для лимита нахлёста
                    maxOverworkCutsMin: dayWindow.maxOverworkCutsMin,   // #3847: макс. нахлёст резки
                    maxOverworkTuneMin: dayWindow.maxOverworkTuneMin,   // #3847: макс. нахлёст настройки
                    times: self.changeTimes, perPassByCut: perPassByCut, runsByCut: runsByCut,
                    lunchStartMin: dayWindow.lunchStartMin, lunchDurationMin: dayWindow.lunchDurationMin,
                    firstCutSetup: true,   // #3669 п.2: первая задача очереди — настройка ножей
                    blockedRanges: self.blockedRangesForSlitter(s, planBaseMidnightMs)   // #3764: окна «Отпуска» станка
                });
                snapSplitSegmentWindows(segs);   // #4061: старт следующей резки = старт текущей + сумма её колонок
                var byPlanId = {};
                segs.forEach(function(sg) { (byPlanId[String(sg.cutId)] = byPlanId[String(sg.cutId)] || []).push(sg); });
                plans.forEach(function(p) {
                    var ps = byPlanId[String(p.id)];
                    if (!ps || !ps.length) ps = [{ runs: p.plannedRuns, windowStartMin: dayWindow.startMin }];
                    var segRunsAll = ps.map(function(x) { return x.runs; });
                    var perPass = perPassByCut[String(p.id)] || 0;
                    segmentsByLayout[p.index] = ps.map(function(sg, si) {
                        var ts = scheduleStartTimestamp(planBaseMidnightMs, sg.windowStartMin);
                        var unit = {
                            plannedRuns: sg.runs,
                            cutMainValue: ts > 0 ? ts : p.cutMainValue,
                            runLength: p.runLength,
                            duration: round3(perPass * sg.runs),
                            timing: cutTimingDetails(p.runLength, sg.runs, self.opTimes, p.isFoil), // #3606
                            batchId: p.batchId,
                            slitterId: p.slitterId,
                            fullPlannedRuns: p.plannedRuns,
                            segIndex: si,
                            segRunsAll: segRunsAll
                        };
                        return unit;
                    });
                });
            });
            // #3923: порядок сегментов внутри (станок, день) задаёт planStart (cutMainValue) —
            // отдельная «Очередность» 1..N больше не проставляется и не пишется в базу.
        })();

        this.setBusy(true);
        this.setGenBusy(true);
        // Окно прогресса (#3148): создание заданий идёт сериями запросов; #3998 — до 5 резок
        // сохраняются ПАРАЛЛЕЛЬНО (внутри резки запросы зависимы и остаются последовательными).
        // #3280: записей-сегментов может быть больше, чем раскладок (резки длиннее дня дробятся).
        var nRecords = 0;
        Object.keys(segmentsByLayout).forEach(function(k) { nRecords += segmentsByLayout[k].length; });
        if (!nRecords) nRecords = nCuts;
        console.log('[pp] 🔧 runGenerateCuts: начало создания ' + nRecords + ' записей (' + nCuts + ' раскладок)...');
        this.showProgress('Генерация заданий…', nRecords);
        // #3998: каждая резка-сегмент — независимая задача (создание резки → её «Партий ГП»/
        // втулок/обеспечений); собираем задачи и гоняем пулом не более MAX_PARALLEL_SAVES
        // одновременно. Порядок в базе неважен — сортировка по planStart (первая колонка 1078).
        var MAX_PARALLEL_SAVES = 5;
        var saveTasks = [];
        layouts.forEach(function(lay, layIdx) {
          var units = segmentsByLayout[layIdx] || [];
          units.forEach(function(unit) {
            saveTasks.push(function() {
                self.updateProgress(doneCuts, 'Создание заданий: ' + doneCuts + ' из ' + nRecords + ' (до ' + MAX_PARALLEL_SAVES + ' параллельно)…');
                var plannedRuns = unit.plannedRuns;
                var runLength = unit.runLength;
                var duration = unit.duration;
                var timing = unit.timing;
                var batchId = unit.batchId;
                var slitterId = unit.slitterId;
                var cutMainValue = unit.cutMainValue;
                var cutFields = buildFields(cutReqIds, {
                    status: CUT_STATUSES[0],
                    slitter: slitterId,
                    materialBatch: batchId,
                    plannedRuns: plannedRuns,
                    duration: duration > 0 ? Math.ceil(duration) : '',   // #3635 п.4: «Длительность, минут» сохраняем целой (вверх)
                    timing: timing,
                    length: runLength > 0 ? runLength : '',
                    winding: normWinding(lay && lay.windDir),
                    leader: self.resolveLeaderId(lay && lay.leader), // #3569: лидер позиции → id справочника
                    material: lay && lay.mat   // #3688: «Вид сырья» резки = сырьё раскладки
                    // #3923: «Очередность» не пишем — порядок задаёт planStart (главное значение)
                });
                cutFields = addMainValueField(cutMeta, cutFields, cutMainValue);
                var payloadDiagnostics = traceCutCreatePayload('runGenerateCuts', cutMeta, cutReqIds, cutFields, self, cutCreateRequiredKeys(plannedRuns));
                if (payloadDiagnostics.length) {
                    throw new Error('Неполный payload задания ' + (layIdx + 1) + ': ' + cutWriteDiagnosticSummary(payloadDiagnostics));
                }

                // #3242: состав резки — «Партия ГП» по каждой ширине. Запоминаем id по
                // ширине, чтобы обеспечения сослались на нужную партию.
                var widthToBatchId = {};
                // #3280/#3433: доля обеспечений ЭТОГО сегмента-дня по позициям (рулоны +
                // метраж). Считаем один раз и переиспользуем для спроса/заказа «Партии ГП»
                // (createFinishedBatches) и для самих обеспечений (createSupplies).
                var segSupplies = [];
                supplyPlanForLayout(lay, posById, unit.fullPlannedRuns, posLength).forEach(function(plan) {
                    var share = splitSupplyShares(plan.rolls, plan.footage, unit.segRunsAll)[unit.segIndex] || { rolls: 0, footage: 0 };
                    var pos = posById[String(plan.positionId)] || {};
                    segSupplies.push({ positionId: plan.positionId, width: plan.width,
                        rolls: share.rolls, footage: share.footage, orderId: pos.orderId || '' });
                });
                // Спрос (Σ рулонов сегмента) и заказы по ширине «Партии ГП».
                var demandByWidth = {};
                var ordersByWidth = {};
                segSupplies.forEach(function(s) {
                    if (!(s.rolls > 0)) return;
                    var key = stripWidthKey(s.width);
                    demandByWidth[key] = round3((demandByWidth[key] || 0) + s.rolls);
                    (ordersByWidth[key] = ordersByWidth[key] || []).push(s.orderId);
                });
                function createFinishedBatches(cutId) {
                    var batchChain = Promise.resolve();
                    producedBatchesForLayout(lay, runLength).forEach(function(batch) {
                        batchChain = batchChain.then(function() {
                            // #3431/#3433/#3435: «Кол-во полос» = полос за проход (batch.strips);
                            // «Кол-во план» = полосы × проходов сегмента; «Кол-во рулонов» =
                            // спрос обеспечений этой ширины; «ID заказа» = заказы покрытых
                            // позиций (несколько → через запятую; спроса нет → пусто = запас).
                            var key = stripWidthKey(batch.width);
                            var demand = demandByWidth[key];
                            var fields = buildFinishedBatchFields(finishedBatchMeta, {
                                width: batch.width,
                                strips: batch.strips,
                                planned: finishedBatchRolls(batch.strips, plannedRuns),
                                rolls: demand > 0 ? demand : '',
                                orderId: batchOrderId(ordersByWidth[key]),
                                footage: batch.length > 0 ? batch.length : '',
                                active: '1'
                            });
                            return self.post('_m_new/' + finishedBatchMeta.id + '?JSON&up=' + encodeURIComponent(cutId), fields)
                                .then(function(res) {
                                    var bid = res && (res.obj || res.id || res.i);
                                    if (bid) widthToBatchId[stripWidthKey(batch.width)] = String(bid);
                                    nStrips += 1;
                                });
                        });
                    });
                    return batchChain;
                }

                function createSleeveTasks() {
                    if (!sleeveMeta || !sleeveReqIds) return Promise.resolve();
                    var taskChain = Promise.resolve();
                    // #3340: запланированный старт задания = плановое время старта резки.
                    positionSleeveTasksForLayout(lay, posById, plannedRuns).forEach(function(task) {
                        taskChain = taskChain.then(function() {
                            var fields = self.buildSleeveTaskFields(sleeveReqIds, task, cutMainValue);
                            return self.post('_m_new/' + sleeveMeta.id + '?JSON&up=' + encodeURIComponent(task.positionId), fields)
                                .then(function() {
                                    nSleeveTasks += 1;
                                    nSleeves += Number(task.qty) || 0;
                                });
                        });
                    });
                    return taskChain;
                }

                // #3242: обеспечение ссылается на «Партию ГП» нужной ширины (не на резку).
                // Излишек рулонов сверх обеспечений остаётся складом той же Партией ГП.
                function createSupplies() {
                    var supChain = Promise.resolve();
                    // #3280/#3433: доли сегмента уже посчитаны (segSupplies). Каждое
                    // обеспечение ссылается на «Партию ГП» своей ширины.
                    segSupplies.forEach(function(s) {
                        if (!(s.rolls > 0) && !(s.footage > 0)) return;
                        supChain = supChain.then(function() {
                            var batchId = widthToBatchId[stripWidthKey(s.width)];
                            if (!batchId) {
                                console.error('[pp] ⚙️ runGenerateCuts: нет «Партии ГП» ширины ' + s.width +
                                    ' для позиции ' + s.positionId + ' — обеспечение не создаём (не сирота)');
                                return;
                            }
                            var fields = buildSupplyFieldsForFinishedBatch(supplyMeta, {
                                finishedBatchId: batchId,
                                footage: s.footage > 0 ? s.footage : '',
                                rolls: s.rolls,
                                active: '1',
                                status: SUPPLY_STATUSES[0]
                            });
                            return self.post('_m_new/' + supplyMeta.id + '?JSON&up=' + encodeURIComponent(s.positionId), fields)
                                .then(function() { nPositions += 1; });
                        });
                    });
                    return supChain;
                }

                // 1) корневая резка, 2) Партии ГП (состав), 3) втулки, 4) обеспечения→Партия ГП.
                return self.post('_m_new/' + cutMeta.id + '?JSON&up=1', cutFields).then(function(res) {
                    var cutId = res && (res.obj || res.id || res.i);
                    if (!cutId) throw new Error('Сервер не вернул id нового задания');
                    return createFinishedBatches(cutId)
                        .then(function() { return createSleeveTasks(); })
                        .then(function() { return createSupplies(); });
                }).then(function() {
                    // Резка со всеми полосами и обеспечениями готова → +1 к прогрессу.
                    doneCuts += 1;
                    self.updateProgress(doneCuts, 'Создание заданий: ' + doneCuts + ' из ' + nRecords + '…');
                });
            });
          });   // #3280: конец units.forEach (сегменты резки по дням)
        });

        var genStartTime = Date.now();
        // #3998: пул сохранений — до MAX_PARALLEL_SAVES резок параллельно (внутри резки — последовательно).
        return runWithConcurrency(saveTasks, MAX_PARALLEL_SAVES).then(function() {
            var elapsed = ((Date.now() - genStartTime) / 1000).toFixed(1);
            console.log('[pp] 🔧 runGenerateCuts: все записи созданы за ' + elapsed + 'с. загружаем свежие данные...');
            self.updateProgress(nRecords, 'Обновление очереди…');
            return self.reload();
        }).then(function() {
            var elapsed = ((Date.now() - genStartTime) / 1000).toFixed(1);
            console.log('[pp] 🔧 runGenerateCuts: данные загружены за ' + elapsed + 'с. рендерим...');
            self.hideProgress();
            self.setBusy(false);
            self.setGenBusy(false);
            var renderStart = Date.now();
            self.render();
            var renderMs = Date.now() - renderStart;
            console.log('[pp] 🔧 runGenerateCuts: render занял ' + renderMs + 'мс');
            var totalElapsed = ((Date.now() - genStartTime) / 1000).toFixed(1);
            var reasons = self.groupSkipReasons(skipped);
            var sleeveMin = sleeveMinutes(nSleeves, self.opTimes || {});
            console.log('[pp] 🔧 runGenerateCuts: ГОТОВО за ' + totalElapsed + 'с. резок:', layouts.length, 'полос:', nStrips, 'втулок:', nSleeveTasks, 'пропущено:', skipped.length);
            self.notify('Создано ' + nRecords + ' производственных заданий (' + planningStrategyLabel(planOptions.strategy) + '), заданий на втулки ' + nSleeveTasks +
                (sleeveMin > 0 ? ' (' + sleeveMin + ' мин)' : '') +
                ', пропущено ' + skipped.length + ' позиций' + (reasons ? ' (' + reasons + ')' : ''), 'success');
            // #3792: после создания заданий пересобираем очередь по правилам (preserveOrder=false):
            // минимум переналадок (группировка сырья), при прочих равных — больше полос раньше.
            // Под каждый день — своё «Задание в производство» + «Партия ГП» + «Обеспечение»,
            // рекурсивно. Зафиксированные задания остаются на своих днях (не переносятся, не
            // разбиваются), внутри дня переставляются. Идемпотентно (#3427) — повторный прогон без
            // изменений ничего не пишет. applySplitPlan сам делает reload+render.
            return self.autoSequenceQueue(PLANNING_STRATEGY_SETUP, false);
        }).catch(function(err) {
            self.hideProgress();
            self.setBusy(false);
            self.setGenBusy(false);
            console.error('[pp] 🔧 runGenerateCuts: ОШИБКА', err.message, err.stack);
            self.notify('Ошибка генерации заданий: ' + err.message, 'error');
        });
    };

    // Сгруппировать причины пропуска → «причина ×N, …» (для итогового уведомления).
    AtexProductionPlanning.prototype.groupSkipReasons = function(skipped) {
        var counts = {};
        var order = [];
        (skipped || []).forEach(function(s) {
            var r = (s && s.reason) || 'без причины';
            if (!counts[r]) { counts[r] = 0; order.push(r); }
            counts[r] += 1;
        });
        return order.map(function(r) { return r + ' ×' + counts[r]; }).join(', ');
    };

    // Открывает в новой вкладке отчёт по пропущенным позициям (для которых генератор
    // не смог построить раскладку). Данные считаются на клиенте при генерации.
    AtexProductionPlanning.prototype.openSkippedReport = function(skipped) {
        var posById = positionMap(this.genPositions);
        var matNames = this.materialNameById || {};   // #3608: карта materialId → название сырья
        var rows = (skipped || []).map(function(s) {
            var p = posById[String(s.positionId)] || {};
            var matId = p.materialId == null ? '' : String(p.materialId);
            return {
                id: s.positionId == null ? '' : s.positionId,
                material: matNames[matId] || (matId !== '' ? '#' + matId : ''),  // #3608: название сырья
                width: (p.orderWidth != null ? p.orderWidth : p.width) || '',  // #3372: заказанная ширина (не фактическая)
                qty: p.qty || '',
                length: p.length || '',
                reason: (s && s.reason) || 'без причины'
            };
        });
        function esc(v) {
            return String(v == null ? '' : v).replace(/[&<>"]/g, function(c) {
                return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
            });
        }
        var base = '/' + encodeURIComponent(this.db) + '/edit_obj/';   // #3608: ссылка на форму правки (edit_obj), а не object/
        var trs = rows.map(function(r, i) {
            return '<tr><td>' + (i + 1) + '</td>' +
                '<td><a href="' + base + esc(r.id) + '" target="_blank" rel="noopener">' + esc(r.id) + '</a></td>' +
                '<td>' + esc(r.material) + '</td>' +
                '<td>' + esc(r.width) + '</td>' +
                '<td>' + esc(r.qty) + '</td>' +
                '<td>' + esc(r.length) + '</td>' +
                '<td>' + esc(r.reason) + '</td></tr>';
        }).join('');
        var html = '<!doctype html><html lang="ru"><head><meta charset="utf-8">' +
            '<title>Пропущенные позиции (' + rows.length + ')</title>' +
            '<style>body{font:14px/1.45 system-ui,Arial,sans-serif;margin:24px;color:#1a1a1a}' +
            'h1{font-size:18px;margin:0 0 4px}p{color:#666;margin:0 0 16px;max-width:760px}' +
            'table{border-collapse:collapse;width:100%;max-width:900px}' +
            'th,td{border:1px solid #ddd;padding:6px 10px;text-align:left}' +
            'th{background:#f4f6fa}tr:nth-child(even) td{background:#fafbfc}' +
            'a{color:#1283da}</style></head><body>' +
            '<h1>Пропущенные позиции — ' + rows.length + '</h1>' +
            '<p>Согласованные позиции заказов, для которых генератор не смог построить раскладку и не создал производственные задания. ' +
            'Проверьте параметры (ширина джамбо, сырьё) и повторите генерацию.</p>' +
            '<table><thead><tr><th>№</th><th>ID позиции</th><th>Сырьё</th><th>Ширина</th><th>Кол-во</th><th>Длина, м</th><th>Причина пропуска</th></tr></thead>' +
            '<tbody>' + (trs || '<tr><td colspan="7">Нет пропущенных позиций</td></tr>') + '</tbody></table></body></html>';
        var w = window.open('', '_blank');
        if (!w) { this.notify('Браузер заблокировал новую вкладку. Разрешите всплывающие окна для этого сайта.', 'error'); return; }
        w.document.open();
        w.document.write(html);
        w.document.close();
    };

    function normalizeConfirmActions(okLabel, onConfirm) {
        if (Array.isArray(okLabel)) {
            return okLabel.map(function(action, i) {
                var a = action || {};
                return {
                    label: a.label || a.text || 'Да',
                    // #3475: warning-кнопка (жёлтая) не должна одновременно быть primary.
                    warning: a.warning === true,
                    primary: a.warning !== true && (a.primary === true || i === 0),
                    inline: a.inline === true,
                    onConfirm: a.onConfirm || a.action || a.handler
                };
            }).filter(function(action) { return typeof action.onConfirm === 'function'; });
        }
        return [{ label: okLabel || 'Да', primary: true, onConfirm: onConfirm }];
    }

    // Подтверждение без native confirm. Single-action flow может использовать
    // mainAppController.showDeleteConfirmModal; multi-action выбор рендерится inline.
    AtexProductionPlanning.prototype.confirmAction = function(message, actionsEl, okLabel, onConfirm) {
        var actions = normalizeConfirmActions(okLabel, onConfirm);
        if (!actions.length) return;
        if (actions.length === 1 && !actions[0].inline && typeof window !== 'undefined' && window.mainAppController &&
            typeof window.mainAppController.showDeleteConfirmModal === 'function') {
            window.mainAppController.showDeleteConfirmModal(message).then(function(ok) {
                if (ok) actions[0].onConfirm();
            });
            return;
        }
        var host = actionsEl || (this.root && this.root.querySelector('.atex-pp-panel-actions')) || this.root;
        if (host && host.querySelector && host.querySelector('.atex-pp-confirm-bar')) return;
        var bar = el('div', { class: 'atex-pp-confirm-bar' });
        bar.appendChild((message && message.nodeType) ? message : el('span', { class: 'atex-pp-confirm-msg', text: message }));
        var cancelBtn = el('button', { class: 'atex-pp-btn', type: 'button', text: 'Отмена' });
        function removeBar() { if (bar.parentNode) bar.parentNode.removeChild(bar); }
        actions.forEach(function(action) {
            var cls = 'atex-pp-btn' + (action.warning ? ' atex-pp-btn-warning' : (action.primary ? ' atex-pp-btn-primary' : ''));
            var btn = el('button', { class: cls, type: 'button', text: action.label });
            btn.addEventListener('click', function() { removeBar(); action.onConfirm(); });
            bar.appendChild(btn);
        });
        cancelBtn.addEventListener('click', function() { removeBar(); });
        bar.appendChild(cancelBtn);
        if (host) {
            host.appendChild(bar);
        } else {
            actions[0].onConfirm();
        }
    };

    // #3698/#3700: пересчитать и сохранить расчётные минуты каждой резки — «Наладка ножей,
    // мин» (KNIFE), «Сырье/намотка, мин» (MATERIAL_WINDING) и «Резка и Лидер» (намотка + лидер) —
    // чтобы Гант (cut-gantt) и отчёты
    // брали готовые минуты, а не пересчитывали по соседям. Порядок исполнения — по
    // planStart в пределах станка (#3923, как orderCutsInGroup Ганта); первая резка — от текущей
    // заправки станка (prev_cut_setup), нет данных → настройка ножей с нуля. Пишет только
    // изменившиеся (diff против отчётных значений), тихо и БЕЗ reload (свой экран РМ считает
    // наладку на лету). Колонок ещё нет в метаданных → no-op. Ошибки глотает: доп-колонки не
    // должны валить сохранение очереди/плана. Вызывается после сохранений порядка/плана.
    // #3778: тайминг-поля задания (t96067 «Наладка ножей, мин» / t96069 «Сырье/намотка, мин» /
    // t96778 «Резка и Лидер») одним набором реквизитов для _m_set. Отсутствующие reqId не пишем.
    function setupTimingFields(reqs, u) {
        var fields = {};
        if (reqs.knifeReq) fields['t' + reqs.knifeReq] = String(u.knife);
        if (reqs.matReq) fields['t' + reqs.matReq] = String(u.material);
        if (reqs.cutTimeReq) fields['t' + reqs.cutTimeReq] = String(u.cutTime);   // #3700
        return fields;
    }

    // #3778: вычислить тайминг-поля резок В ПОРЯДКЕ ПЛАНА и вернуть { reqs, updates } —
    // updates только для резок, чьи хранимые значения ПУСТЫ или разошлись с расчётом (пустое
    // хранимое всегда «изменилось» → force-write, отсюда наполняются «пустые опять» поля).
    // onlyIds (массив id) ограничивает НАБОР ЗАПИСИ (снимок при «Зафиксировать»), но порядок и
    // переналадка считаются по ВСЕЙ очереди станка — иначе у не-первой резки терялся предшественник.
    AtexProductionPlanning.prototype.computeCutSetupUpdates = function(onlyIds) {
        var meta = this.meta.cut;
        var reqs = { knifeReq: null, matReq: null, cutTimeReq: null };
        if (!meta) return { reqs: reqs, updates: [] };
        reqs.knifeReq = reqIdByName(meta, CUT_REQ.knifeSetupMin);
        reqs.matReq = reqIdByName(meta, CUT_REQ.materialWindingMin);
        reqs.cutTimeReq = reqIdByName(meta, CUT_REQ.cutAndLeader);   // #3700: «Резка и Лидер»
        if (!reqs.knifeReq && !reqs.matReq && !reqs.cutTimeReq) return { reqs: reqs, updates: [] };   // колонок ещё нет в таблице
        var onlySet = null;
        if (onlyIds) { onlySet = {}; (onlyIds || []).forEach(function(id) { onlySet[String(id)] = true; }); }
        // #3702: считаем теми же временами и в ТОМ ЖЕ порядке, что и план на экране, иначе
        // у задания заполнялась «Сырье/намотка», которой в плане нет.
        //  • this.changeTimes — структурированные веса переналадок (MATERIAL_WINDING / KNIFE /
        //    BETWEEN_CUTS). this.opTimes — это raw {КОД: мин} без этих ключей, поэтому
        //    setupBreakdown молча брал DEFAULT-веса (расхождение с планом).
        //  • Порядок — groupBySlitter (день плана → planStart → ножи), как очередь станка в
        //    renderQueue (#3923). Иначе у НЕ-первой резки дня предшественником становилась бы
        //    резка другого дня — отсюда была бы ложная «смена сырья».
        var times = this.changeTimes || DEFAULT_OP_TIMES;
        var betweenCuts = Number(times.BETWEEN_CUTS != null ? times.BETWEEN_CUTS : DEFAULT_OP_TIMES.BETWEEN_CUTS) || 0;
        // #3876: тот же источник заправки, что и план (splitMachineQueue): станок в отпуске на
        // день базы → заправка обнулена → первая резка после отпуска считает полную настройку.
        var planBaseMidnightMs = planBaseMidnightFrom(this.filter && this.filter.date, controllerNowMs(this));
        var prevBySlitter = this.planningPrevSetupBySlitter(planBaseMidnightMs);
        var self = this;
        // #4026/#4030/#4042: setup-only хвост дня (#3635 п.5, 0 проходов) — это настройка следующей
        // резки, начатая в конце дня N, а сама резка (проходы) идёт с дня N+1 (продолжение). Настройка
        // = ножи + смена сырья. Смена сырья ОСТАЁТСЯ в дне N (быстрый нахлёст в конце смены), а ножи по
        // умолчанию уносим на продолжение (день N+1, где они нужны прямо перед резкой) — чтобы бейдж
        // дня N не нёс лишние 30 мин. #4042: но перенос УСЛОВНЫЙ — только если день продолжения вмещает
        // ножи в бюджет+нахлёст. Если день N+1 уже полон (напр. 457), +30 ножей раздули бы его за
        // потолок (487) — тогда ножи ОСТАЮТСЯ в дне N (его добиваем максимально, нахлёст допустим). В
        // сценариях #4030/#4039 день продолжения почти пуст → ножи по-прежнему уходят туда.
        // Бюджет дня (== бейдж, #3914): (cutEnd−start)−обед+нахлёст настройки. Нет окна → перенос
        // безусловный (прежнее поведение, деградация без поломки).
        var win4042 = (typeof self.workingWindow === 'function') ? (self.workingWindow() || {}) : {};
        var budget4042 = (Number(win4042.cutEndMin) - Number(win4042.startMin))
            - (Number(win4042.lunchDurationMin) || 0) + (Number(win4042.maxOverworkTuneMin) || 0);
        var hasBudget4042 = isFinite(budget4042) && budget4042 > 0;
        var updates = [];
        groupBySlitter(this.cuts || []).forEach(function(group) {
            var sid = group.slitter && group.slitter.id != null ? String(group.slitter.id) : '';
            var arr = group.cuts;   // уже упорядочены как очередь станка (день → planStart → ножи, #3923)
            var carrySetup = prevBySlitter[sid];
            var carryPrevCut = (carrySetup && arr.length) ? carryOverPrevCut(carrySetup, arr[0]) : null;
            var cols = setupActivityColumns(arr, times, carryPrevCut);
            // #4042: полные минуты каждого дня (настройка+резка, ДО выноса ножей) — чтобы проверить,
            // вместит ли день продолжения отложенные ножи. fullCutMin = ножи + сырьё (cols) + резка/
            // лидер (как во втором проходе ниже). Ключ дня — cutPlanDayKey (как группировка очереди).
            function fullCutMin4042(x) {
                var cc = cols[String(x.id)] || {};
                var lr = stripNum(x.plannedRuns) > 0 ? cutLeaderRuns(x) : 0;
                return Math.round(cc.knifeMin || 0) + Math.round(cc.materialWindingMin || 0)
                    + Math.round(stripNum(x.duration) + betweenCuts * lr);
            }
            var dayFull4042 = {};
            arr.forEach(function(x) {
                if (onlySet && !onlySet[String(x.id)]) return;
                var dk = cutPlanDayKey(x);
                dayFull4042[dk] = (dayFull4042[dk] || 0) + fullCutMin4042(x);
            });
            var deferredToDay4042 = {};   // #4042: ножей уже отложено на день (аккумулятор нескольких хвостов)
            // #4026: корень цепочки разбиения — «ID первой части» (firstPartId), иначе сам id.
            // Нормализуем ТАК ЖЕ, как группировка цепочек #3892 (String(...).trim()) — иначе пробел/
            // формат из rowValue расходится: голова (fp==id) и продолжение сравнивались бы неравными.
            function chainRoot4026(x) {
                var fp = (x && x.firstPartId != null) ? String(x.firstPartId).trim() : '';
                return fp !== '' ? fp : String(x && x.id != null ? x.id : '').trim();
            }
            // #4030: ножи setup-only хвоста дня (0 проходов) уносим на его ПРОДОЛЖЕНИЕ — ближайшую
            // ПОСЛЕДУЮЩУЮ резку той же цепочки (firstPartId). Продолжение бывает НЕ соседним в очереди,
            // поэтому ищем сканом вперёд по chainRoot (а не только arr[i+1]) и НЕ требуем нулевой
            // переналадки входа: сегменты дня-сплита одной конфигурации → она и так 0, а прежняя
            // эвристика «arr[i+1] + changeover=0» на реальном плане не срабатывала (продолжение
            // оказывалось не строго соседним → хвост оставался с полными 45 → день 492).
            var deferKnifeToCont = {};   // id продолжения → перенесённые ножи его хвостов
            var zeroKnifeTail = {};      // id хвоста → ножи перенесены (в дне N остаётся только смена сырья)
            arr.forEach(function(c, i) {
                if (onlySet && !onlySet[String(c.id)]) return;        // только резки снимка (scope)
                var wkTail = Math.round((cols[String(c.id)] || {}).knifeMin || 0);
                if (wkTail <= 0) return;                              // нет ножей — переносить нечего
                var runsTail = stripNum(c.plannedRuns);
                if (ppTraceOn()) ppTrace('#4030 кандидат-хвост id=' + c.id + ' проходы=' + runsTail
                    + ' ножи=' + wkTail + ' корень=' + chainRoot4026(c)
                    + ' fp=' + (c.firstPartId != null && c.firstPartId !== '' ? c.firstPartId : '∅'));
                if (runsTail !== 0) return;                           // хвост = 0 проходов (setup-only, #3635 п.5)
                // Продолжение = БЛИЖАЙШАЯ последующая резка в снимке. Она обязана быть той же цепочки:
                // если между хвостом и его продолжением встала чужая резка, та несёт СВОЮ переналадку
                // от нового сырья — добавлять к ней ножи хвоста нельзя (двойной счёт), поэтому стоп.
                var contId = null, nearest = null, nearCols = null, keptFullDay4042 = false;
                for (var j = i + 1; j < arr.length; j++) {
                    var d = arr[j];
                    if (onlySet && !onlySet[String(d.id)]) continue;  // вне снимка — прозрачно пропускаем
                    nearest = d;
                    nearCols = cols[String(d.id)] || {};
                    // Продолжение = ближайшая резка ТОЙ ЖЕ конфигурации: её переналадка входа = 0
                    // (та же смена сырья/ножи, что у хвоста → менять нечего, ножи хвоста и есть её
                    // заправка). Признак НЕ зависит от firstPartId: в отчёте cut_planning на ateh НЕТ
                    // колонки cut_first_part → firstPartId всегда пуст (fp=∅), chainRoot по нему не
                    // сходится — из-за этого #4033 не срабатывал. chainRoot оставляем доп. признаком
                    // для баз с колонкой. Чужая резка следом даёт changeover > 0 → sameCfg=false → не
                    // выносим (у неё своя заправка от нового сырья, иначе двойной счёт).
                    var sameCfg = Math.round(nearCols.knifeMin || 0) === 0 && Math.round(nearCols.materialWindingMin || 0) === 0;
                    if (sameCfg || chainRoot4026(d) === chainRoot4026(c)) {
                        // #4042: вмещает ли день продолжения ножи хвоста (бюджет+нахлёст)? Нет →
                        // ножи ОСТАЮТСЯ в дне N (его добиваем максимально, нахлёст допустим), а не
                        // раздувают уже полный день N+1. dayFull4042 — минуты дня ДО выноса, поэтому
                        // у продолжения-той-же-конфигурации ножи там ещё не учтены; +wkTail = что стало бы.
                        var contDay4042 = cutPlanDayKey(d);
                        var contLoad4042 = (dayFull4042[contDay4042] || 0) + (deferredToDay4042[contDay4042] || 0);
                        if (!hasBudget4042 || contLoad4042 + wkTail <= budget4042 + 1e-6) {
                            contId = String(d.id);
                            deferKnifeToCont[contId] = (deferKnifeToCont[contId] || 0) + wkTail;
                            deferredToDay4042[contDay4042] = (deferredToDay4042[contDay4042] || 0) + wkTail;
                            zeroKnifeTail[String(c.id)] = true;
                        } else {
                            keptFullDay4042 = true;   // продолжение есть, но его день полон → ножи в дне N
                        }
                    }
                    break;                                            // только ближайшая (в снимке) резка
                }
                if (ppTraceOn()) ppTrace(contId
                    ? '#4030 хвост ' + c.id + ': ножи ' + wkTail + ' → продолжение ' + contId + ' (в дне N только сырьё)'
                    : keptFullDay4042
                        ? '#4042 хвост ' + c.id + ': ножи ' + wkTail + ' ОСТАЮТСЯ в дне N — день продолжения '
                            + (nearest ? nearest.id : '∅') + ' полон (нет места под нахлёст, день N добиваем)'
                        : '#4030 хвост ' + c.id + ' (0 проходов, ножи ' + wkTail + '): продолжение НЕ распознано — '
                            + 'ближайшая=' + (nearest ? nearest.id : '∅')
                            + ' переналадка[нож/сыр]=' + (nearCols ? Math.round(nearCols.knifeMin || 0) : '∅') + '/' + (nearCols ? Math.round(nearCols.materialWindingMin || 0) : '∅')
                            + ' корень=' + (nearest ? chainRoot4026(nearest) : '∅') + ' vs ' + chainRoot4026(c)
                            + ' → ножи остаются, день раздут');
            });
            arr.forEach(function(c, i) {
                var inScope = !(onlySet && !onlySet[String(c.id)]);   // снимок — только выбранные резки
                var want = cols[String(c.id)] || { knifeMin: 0, materialWindingMin: 0 };
                // #3715: пишем ЦЕЛЫЕ минуты (Math.round). Дробные значения (#3708) перестали
                // записываться — поля не приняли нецелое, _m_set падал и обрывал запись всех трёх
                // колонок («Наладка ножей»/«Сырье/намотка»/«Резка и Лидер») для всей очереди.
                // Налезание баров (#3708) убирает обрезка по старту следующего задания в Ганте
                // (cut-gantt.js), а не дробная длительность.
                // #4026: продолжение добирает настройку, отложенную его setup-only хвостом (см. ниже).
                // #4026/#4030: ножи setup-only хвоста дня уносим на его продолжение (см. предпроход
                // deferKnifeToCont/zeroKnifeTail выше). В дне N у хвоста остаётся только смена сырья, а
                // ножи (30/50) добирает продолжение (день N+1, где резка) — иначе бейдж дня N раздут (447+45=492).
                var wantK = Math.round(want.knifeMin), wantM = Math.round(want.materialWindingMin);
                if (zeroKnifeTail[String(c.id)]) wantK = 0;            // ножи хвоста перенесены на продолжение
                wantK += (deferKnifeToCont[String(c.id)] || 0);       // продолжение добирает ножи своих хвостов
                var runsC = stripNum(c.plannedRuns);
                if (!inScope) return;
                // #3700: «Резка и Лидер» = «Длительность, минут» + лидер (BETWEEN_CUTS × число резок
                // цуга, cutLeaderRuns). Зависит только от самой резки.
                // #4021: setup-only сегмент (0 проходов — «только настройка станка», хвост дня #3635 п.5)
                // намотки не несёт, поэтому и лидера у него нет. cutLeaderRuns() возвращает 1 при 0
                // проходов (фолбэк для реальной резки с несохранённым «Кол-во план»), из-за чего «Резка
                // и Лидер» = 0 + BETWEEN_CUTS(2) = 2 — бейдж дня с одной наладкой показывал 47 вместо 45
                // (45 наладки + фантомный лидер). Лидер считаем ТОЛЬКО при реальных проходах.
                var leaderRuns = runsC > 0 ? cutLeaderRuns(c) : 0;
                var wantT = Math.round(stripNum(c.duration) + betweenCuts * leaderRuns);
                // Колонку учитываем в diff только если она есть в метаданных (иначе её не пишем
                // и не считаем «изменившейся» — иначе были бы лишние записи на каждом сохранении).
                // Пустое хранимое (cur пуст) → всегда «изменилось» → force-write (#3778).
                function changed(req, cur, val) {
                    return req && (!(cur != null && cur !== '') || Math.round(stripNum(cur)) !== val);
                }
                if (changed(reqs.knifeReq, c.storedKnifeSetupMin, wantK)
                    || changed(reqs.matReq, c.storedMaterialWindingMin, wantM)
                    || changed(reqs.cutTimeReq, c.storedCutAndLeaderMin, wantT)) {
                    updates.push({ cutId: c.id, knife: wantK, material: wantM, cutTime: wantT });
                    c.storedKnifeSetupMin = String(wantK);        // локально — чтобы не переписывать дважды
                    c.storedMaterialWindingMin = String(wantM);
                    c.storedCutAndLeaderMin = String(wantT);
                }
            });
        });
        return { reqs: reqs, updates: updates };
    };

    AtexProductionPlanning.prototype.persistCutSetupColumns = function() {
        var self = this;
        var res = this.computeCutSetupUpdates(null);
        var reqs = res.reqs, updates = res.updates;
        if (!updates.length) return Promise.resolve();
        // «Время старта» (planStart) пишет splitMachineQueue/applySplitPlan — единственный
        // источник правды по дню/нахлёсту настройки (#3805, #3635 п.5). Здесь — только тайминг
        // (Наладка ножей / Сырьё-намотка / Резка и Лидер), planStart не трогаем.
        // #4023: разные резки независимы (каждая — свой _m_set/<cutId>?JSON), а порядок в базе
        // неважен (#4000). Раньше это был последовательный chain.then — «последний набор запросов»
        // после «Создать»/«Упорядочить» шёл лесенкой в 1 поток (окно висело на 100%). Гоняем пулом
        // до MAX_PARALLEL_SETUP потоков, как сохранение/удаление/разбиение (#3998/#4005/#4014).
        var MAX_PARALLEL_SETUP = 5;
        var tasks = updates.map(function(u) {
            return function() {
                var fields = setupTimingFields(reqs, u);
                if (!Object.keys(fields).length) return;
                return self.post('_m_set/' + u.cutId + '?JSON', fields);
            };
        });
        // #3778: ошибки записи тайминга больше НЕ глотаем молча — раньше тихий catch скрывал,
        // почему «Наладка ножей»/«Сырье/намотка»/«Резка и Лидер» оставались пустыми. Сохранение
        // самой очереди (старт/очередность) идёт отдельной цепочкой — его не валим. Пул реджектится
        // ПЕРВОЙ ошибкой (как прежняя цепочка) → единый notify.
        return runWithConcurrency(tasks, MAX_PARALLEL_SETUP).catch(function(err) {
            self.notify('Не удалось сохранить тайминг заданий (Наладка ножей / Сырье-намотка / '
                + 'Резка и Лидер): ' + (err && err.message || err), 'error');
        });
    };

    // #3923: ручная перестановка ↑↓ внутри дня. Порядок задаёт planStart, поэтому «выше/ниже»
    // = ОБМЕН сохранённого planStart (главное значение t1078) двух соседних резок дня, после
    // чего autoSequenceQueue(preserveOrder) переупаковывает день встык по новому порядку (окна
    // резок разной длины — пересчёт чинит нахлёст/зазор). Зафиксированные — «стены» (не двигаем
    // и не перепрыгиваем). Совпадающий planStart соседей — след неполной пересборки (#3885):
    // обмен ничего не даст, подсказываем «Упорядочить».
    //   sameDayCuts — резки дня в порядке показа (по planStart);
    //   index, dir  — позиция и направление (-1 вверх / +1 вниз).
    AtexProductionPlanning.prototype.moveCutInDay = function(sameDayCuts, index, dir) {
        var self = this;
        var arr = sameDayCuts || [];
        var target = index + dir;
        if (index < 0 || index >= arr.length || target < 0 || target >= arr.length) return Promise.resolve(false);
        var a = arr[index], b = arr[target];
        if (!a || !b) return Promise.resolve(false);
        if (a.fixed || b.fixed) { self.notify('Зафиксированное задание нельзя переставить', 'info'); return Promise.resolve(false); }
        var mainKey = (this.meta.cut && this.meta.cut.id != null) ? 't' + this.meta.cut.id : null;
        if (!mainKey) { self.notify('Не найден реквизит даты резки', 'error'); return Promise.resolve(false); }
        var tsA = Number(a.planDate), tsB = Number(b.planDate);
        if (!isFinite(tsA) || tsA <= 0 || !isFinite(tsB) || tsB <= 0 || tsA === tsB) {
            self.notify('Не удаётся переставить: у соседних заданий одно время старта — нажмите «Упорядочить»', 'info');
            return Promise.resolve(false);
        }
        this.setBusy(true);
        var fA = {}; fA[mainKey] = String(tsB);
        var fB = {}; fB[mainKey] = String(tsA);
        return self.post('_m_save/' + encodeURIComponent(a.id) + '?JSON', fA)
            .then(function() { return self.post('_m_save/' + encodeURIComponent(b.id) + '?JSON', fB); })
            .then(function() { return self.reload(); })
            .then(function() {
                self.setBusy(false);
                self.render();   // обмен planStart виден сразу (даже если пересборка ниже без изменений)
                // Переупаковка дня встык по новому порядку planStart (как перенос/удаление, #3840);
                // autoSequenceQueue сам делает persistCutSetupColumns + reload/render при изменениях.
                return self.autoSequenceQueue(PLANNING_STRATEGY_SETUP, true);
            })
            .catch(function(err) {
                self.setBusy(false);
                // Частичный обмен (первый _m_save прошёл, второй нет) → перечитываем состояние.
                self.reload().then(function() { self.render(); }).catch(function() {});
                self.notify('Ошибка перестановки: ' + (err && err.message || err), 'error');
                return false;
            });
    };

    // #3280: применить план разбиения резок по дням (planCutOperations):
    //   updates → _m_save t1078 (planStart) + _m_set плановых проходов сегодня (#3923: без «Очередности»);
    //   creates → _m_new запись-продолжение B (на след. день) + копия Полос (тот же
    //     per-pass раскрой) + Обеспечение долей сегмента (splitSupplyShares, пропорц. проходам);
    //   deletes → _m_del записей-продолжений прежних цепочек (mergeContinuationChains).
    // Обеспечение «сегодня» (A) уменьшается до своей доли. Последовательно (не грузим сервер).
    AtexProductionPlanning.prototype.applySplitPlan = function(ops) {
        var self = this;
        var cutMeta = this.meta.cut, fbMeta = this.meta.finishedBatch, supMeta = this.meta.supply;
        if (!cutMeta) { self.notify('Не найдены метаданные «' + TABLE.cut + '»', 'error'); return Promise.resolve(false); }
        var runsReqId = reqIdByAnyName(cutMeta, CUT_PLANNED_RUNS_NAMES);   // live: «Кол-во резок план»
        var mainKey = cutMeta.id != null ? 't' + cutMeta.id : null;
        // #4001: снимок ХРАНИМОГО «Вид сырья» ДО healContinuationMaterials — иначе лечение в
        // памяти (ниже) затрёт пустой материал в M7, и changed-сравнение решит «не изменилось» →
        // запись в БД останется пустой. Сравниваем umat с этим снимком (реальным значением БД).
        var origMaterialById = {};
        (self.cuts || []).forEach(function(c) { origMaterialById[String(c.id)] = String(c && c.materialId == null ? '' : c.materialId).trim(); });
        // #3808: перед резолвом цепочек ЛЕЧИМ «Вид сырья» переходящих сегментов с пустым
        // материалом (станок|намотка|ножи → единственное непустое сырьё группы). Иначе пустой
        // материал продолжения рвёт continuationSignature → mergeContinuationChains не находит
        // голову → materialForCutId возвращает пусто → продолжение дня N+1 уходит без сырья.
        healContinuationMaterials(self.cuts || []);
        var cutsById = {}; (self.cuts || []).forEach(function(c) { cutsById[String(c.id)] = c; });
        var lengthReqId = reqIdByName(cutMeta, CUT_REQ.length);   // #3781: «Метраж, м» (длина прогона)
        var cutReqIds = {
            slitter: reqIdByName(cutMeta, CUT_REQ.slitter),
            materialBatch: reqIdByName(cutMeta, CUT_REQ.materialBatch),
            plannedRuns: runsReqId,
            status: reqIdByName(cutMeta, CUT_REQ.status),
            winding: reqIdByName(cutMeta, CUT_REQ.winding),
            leader: reqIdByName(cutMeta, CUT_REQ.leader),   // #3569: лидер копируется в запись-продолжение
            length: lengthReqId,   // #3781: «Метраж, м» — длина прогона (одинакова у всех сегментов цепочки)
            material: reqIdByName(cutMeta, CUT_REQ.material),   // #3795: «Вид сырья» — копируется в продолжение, иначе очередь следующего дня без сырья
            firstPart: reqIdByName(cutMeta, CUT_REQ.firstPart)   // #3892: «ID первой части» (голова цепочки) — на голову и все продолжения
        };
        var firstPartReqId = cutReqIds.firstPart;
        // #3781: длина прогона по id любой записи цепочки = длина прогона её ГОЛОВЫ. Записи-
        // продолжения дробления по дням раньше не получали «Метраж, м», и cutRunLength
        // откатывался к ПОДЕЛЁННОМУ метражу обеспечения (splitSupplyShares делит footage
        // пропорционально проходам) → в очереди мелькала заниженная длина (281.25 вместо 450).
        // Длина прогона одинакова у всех сегментов — берём её у головы и пишем во все сегменты.
        var chainHeadById = {};
        var splitChains = mergeContinuationChains(self.cuts || []).chainByLogical || {};
        Object.keys(splitChains).forEach(function(head) {
            (splitChains[head] || [head]).forEach(function(m) { chainHeadById[String(m)] = String(head); });
        });
        function runLenForCutId(cutId) {
            var head = chainHeadById[String(cutId)] || String(cutId);
            var hc = cutsById[head];
            return hc ? cutRunLength(hc, self.supplies, self.footageBySupply) : 0;
        }
        // #3795: «Вид сырья» цепочки = сырьё её ГОЛОВЫ (у всех сегментов одно сырьё). Берём
        // у головы, потому что у реюзнутого продолжения, созданного до фикса, поле пустое.
        function materialForCutId(cutId) {
            var head = chainHeadById[String(cutId)] || String(cutId);
            var hc = cutsById[head];
            return hc && hc.materialId != null && String(hc.materialId) !== '' ? String(hc.materialId) : '';
        }
        // #3916: тайминг записи-СЕГМЕНТА считаем по ЕЁ проходам (plannedRuns), а не по целой
        // резке. Разбивка по дням уменьшала «Кол-во резок план» сегмента, но «Длительность,
        // минут» и «Резка и Лидер» оставались от полной резки (голова 30 из 82 проходов хранила
        // намотку всех 82 → бейдж дня 452→520, а карточка тянулась до 17:16). Пишем обе колонки
        // по проходам сегмента (0 проходов = setup-сегмент #3635 п.5 → 0). Намотка сегмента —
        // тем же plannedCutDurationMinutes, что и splitMachineQueue (perPass × проходы), лидер —
        // BETWEEN_CUTS × проходов (как cutLeaderRuns в computeCutSetupUpdates) — так «Резка и
        // Лидер» совпадает с длительностью сегмента расписания, и бейдж = раскладке генерации.
        var durReqIdSplit = reqIdByName(cutMeta, CUT_REQ.duration);
        var cutTimeReqIdSplit = reqIdByName(cutMeta, CUT_REQ.cutAndLeader);
        var betweenCutsSplit = Number((self.changeTimes && self.changeTimes.BETWEEN_CUTS != null)
            ? self.changeTimes.BETWEEN_CUTS : DEFAULT_OP_TIMES.BETWEEN_CUTS) || 0;
        function splitSegTimingFields(cutId, plannedRuns) {
            var out = {};
            var P = Math.max(0, Math.round(Number(plannedRuns) || 0));
            var head = cutsById[chainHeadById[String(cutId)] || String(cutId)];
            var isFoil = !!(head && head.isFoil);
            // #3635 п.4: «Длительность, минут» — целой (вверх), как при создании резки.
            var winding = P > 0 ? Math.ceil(plannedCutDurationMinutes(runLenForCutId(cutId), P, self.opTimes, isFoil)) : 0;
            if (durReqIdSplit) out['t' + durReqIdSplit] = String(winding);
            if (cutTimeReqIdSplit) out['t' + cutTimeReqIdSplit] = String(P > 0 ? Math.round(winding + betweenCutsSplit * P) : 0);
            return out;
        }
        // buildFields ключ для проходов — по runsReqId (live «Кол-во резок план»).
        var createsByParent = {};
        (ops.creates || []).forEach(function(cr) { (createsByParent[cr.parentCutId] = createsByParent[cr.parentCutId] || []).push(cr); });
        var updateByCut = {};
        (ops.updates || []).forEach(function(u) { updateByCut[u.cutId] = u; });

        // #3635 п.3: сохранение плана резок (день-заполнение) пишет десятки записей —
        // показываем форму ожидания с прогрессом, а не «зависшую» заблокированную страницу.
        var splitTotal = (ops.updates || []).length + Object.keys(createsByParent).length + (ops.deletes || []).length;
        var splitDone = 0;
        function splitBump() { self.updateProgress(++splitDone); }
        // #3895: операции плана-разбиения НЕ должны валить всю пересборку из-за ОДНОЙ отсутствующей
        // записи. Если запись (резка/обеспечение/Партия ГП) уже удалена (сервер: «No such record»),
        // править/удалять нечего — пропускаем эту операцию и продолжаем, иначе единичная устаревшая
        // ссылка обрывала applySplitPlan на середине → план применялся ЧАСТИЧНО, planStart-ы
        // оставались с коллизиями (#3885), а «Упорядочить» падал «Ошибка разбиения заданий».
        // Реальные (другие) ошибки по-прежнему пробрасываем.
        function softSkip(err) {
            var m = (err && err.message != null) ? String(err.message) : String(err);
            if (/no such record/i.test(m)) {
                if (typeof console !== 'undefined' && console.warn) console.warn('[pp] #3895: пропуск операции — запись не найдена (' + m + ')');
                splitBump();   // учли как обработанную (запись отсутствует — делать нечего)
                return;
            }
            throw err;
        }
        // #3895: _m_del уже отсутствующей записи — не ошибка (её и хотели удалить). Глотаем
        // «No such record» НА КАЖДОЙ операции удаления, чтобы цепочка удаления (обеспечения →
        // Партии ГП → сама резка) дошла до конца и не оставила запись-фантом в очереди/Ганте.
        function delMissingOk(id) {
            return self.post('_m_del/' + encodeURIComponent(id) + '?JSON', {}).catch(function(err) {
                var m = (err && err.message != null) ? String(err.message) : String(err);
                if (/no such record/i.test(m)) { if (typeof console !== 'undefined' && console.warn) console.warn('[pp] #3895: уже удалено: ' + id); return; }
                throw err;
            });
        }
        this.setBusy(true);
        if (splitTotal > 0) this.showProgress('Сохранение плана резок…', splitTotal);
        // #4014: раньше update/create/delete применялись ОДНОЙ последовательной цепочкой (chain.then)
        // — сотни зависимых запросов в один поток, «Сохранение плана резок…» тянулось МИНУТАМИ
        // (сеть-лесенка, #4014). Распараллеливаем пулом runWithConcurrency(…, MAX_PARALLEL_SPLIT),
        // как генерацию (#3998/#4004) и удаление (#4005/#4009). Три фазы держим БАРЬЕРАМИ
        // (updates → creates → deletes) — как было в цепочке; ВНУТРИ фазы задачи независимы (разные
        // резки / родительские цепочки / удаляемые записи), внутренние запросы задачи остаются
        // последовательными (первая колонка _m_save→_m_set; дети продолжения по up=<bId>; удаление
        // обеспечения→Партии ГП→резка). Per-задача softSkip (#3895) глотает «No such record» — не
        // роняет пул; реальная ошибка реджектит пул ПЕРВОЙ ошибкой (обрыв как у прежней цепочки →
        // терминальный catch). Счётчик splitDone (++) безопасен — JS однопоточен.
        var MAX_PARALLEL_SPLIT = 5;

        // 1) Обновить существующие записи (первый сегмент каждой логической резки).
        // ⚠️ Первая колонка (плановое время старта) пишется ТОЛЬКО через _m_save (GUIDE
        // issue #775: _m_set первую колонку НЕ задаёт). Остальные реквизиты — _m_set.
        var updateTasks = (ops.updates || []).map(function(u) {
            return function() { return Promise.resolve().then(function() {
                var storedCut = cutsById[String(u.cutId)];   // #4001: хранимые значения — для записи ТОЛЬКО изменившихся полей
                var ts = Number(u.planStartTs);
                // #4001: planStart (_m_save, главное значение = planStart #3242) — ТОЛЬКО если изменился.
                // Раньше writeMain шёл при каждом апдейте (даже когда менялись только проходы) → лишние
                // _m_save. DATETIME первая колонка пишется ТОЛЬКО _m_save с t{tableId} (issue #775).
                var tsChanged = !!mainKey && isFinite(ts) && ts > 0 && (!storedCut || ts !== Number(storedCut.number));
                var saveMain = tsChanged
                    ? self.post('_m_save/' + u.cutId + '?JSON', (function() { var mf = {}; mf[mainKey] = String(ts); return mf; })())
                    : Promise.resolve();
                return saveMain.then(function() {
                    var fields = {};
                    // #3923/#4001: «Очередность» не пишем — порядок задаёт planStart. «Кол-во резок
                    // план» — только если изменилось (иначе churn всех записей при упорядочивании).
                    var runsChanged = (u.plannedRuns != null && !!runsReqId && (!storedCut || Number(u.plannedRuns) !== Number(storedCut.plannedRuns)));
                    if (runsChanged) fields['t' + runsReqId] = String(u.plannedRuns);
                    // #3916/#3635 п.5 + #4001: тайминг сегмента («Длительность, минут» + «Резка и Лидер»)
                    // по ЕГО проходам — пишем при СМЕНЕ проходов (при неизменных проходах тайминг тот же).
                    if (runsChanged) Object.assign(fields, splitSegTimingFields(u.cutId, u.plannedRuns));
                    // #3781 + #4001: «Метраж, м» = длине прогона головы цепочки — лечим ТОЛЬКО если
                    // хранимое пусто/расходится (реюзнутое продолжение до фикса), а не переписываем совпадающее.
                    if (lengthReqId) {
                        var ulen = runLenForCutId(u.cutId);
                        var lenOld = storedCut ? String(storedCut.length == null ? '' : storedCut.length).trim() : '';
                        if (ulen > 0 && (lenOld === '' || round3(Number(lenOld)) !== round3(ulen))) fields['t' + lengthReqId] = String(round3(ulen));
                    }
                    // #3795 + #4001: «Вид сырья» = сырью головы — лечим ТОЛЬКО если хранимое пусто/иное.
                    var matReqId = reqIdByName(cutMeta, CUT_REQ.material);
                    if (matReqId) {
                        var umat = materialForCutId(u.cutId);
                        var matOld = origMaterialById[String(u.cutId)] || '';   // #4001: ХРАНИМОЕ (до heal в памяти)
                        if (umat && matOld !== umat) fields['t' + matReqId] = umat;
                    }
                    // #3892 + #4001: «ID первой части» = голова цепочки — проставляем ТОЛЬКО если пусто/иное.
                    if (firstPartReqId) {
                        var uHead = (u.firstPartId != null && u.firstPartId !== '')
                            ? String(u.firstPartId) : (chainHeadById[String(u.cutId)] || String(u.cutId));
                        var fpOld = storedCut ? String(storedCut.firstPartId == null ? '' : storedCut.firstPartId).trim() : '';
                        if (uHead && fpOld !== uHead) fields['t' + firstPartReqId] = uHead;
                    }
                    // #4085: слой размещения переназначил станок — пишем «Слиттер» (u.slitterId), только если
                    // отличается от хранимого (в не-слот-режиме u.slitterId нет → ничего не пишем, контракт прежний).
                    if (u.slitterId != null && cutReqIds.slitter) {
                        var curSid = storedCut && storedCut.slitter ? String(storedCut.slitter.id) : '';
                        if (String(u.slitterId) !== curSid) fields['t' + cutReqIds.slitter] = String(u.slitterId);
                    }
                    if (!Object.keys(fields).length) return;
                    return self.post('_m_set/' + u.cutId + '?JSON', fields);
                });
            }).then(splitBump).catch(softSkip); };
        });

        // 2) Создать записи-продолжения с копией Полос и долей Обеспечения. Каждая родительская
        // цепочка (parentId) — независимая задача; ВНУТРИ (loadStrips → уменьшить A → Партии ГП →
        // сегменты B с детьми/обеспечениями) запросы связаны и остаются последовательными.
        var createTasks = Object.keys(createsByParent).map(function(parentId) {
            var parentCut = cutsById[parentId];
            var crs = createsByParent[parentId];
            var upd = updateByCut[parentId];
            var parentRunLen = runLenForCutId(parentId);   // #3781: длина прогона цепочки (для «Метраж, м» продолжений)
            var parentMaterial = materialForCutId(parentId);   // #3795: «Вид сырья» цепочки (для продолжений)
            var aRuns = upd ? (Number(upd.plannedRuns) || 0) : 0;
            var segRuns = [aRuns].concat(crs.map(function(c) { return Number(c.plannedRuns) || 0; }));
            return function() { return self.loadStripsForCut(parentId).then(function(parentStrips) {
                var parentSupplies = (self.supplies || []).filter(function(s) { return String(s.cutId) === String(parentId); });
                var shareBySupply = parentSupplies.map(function(s) { return { s: s, shares: splitSupplyShares(s.rolls, s.footage, segRuns) }; });
                // #3433: спрос на «Партию ГП» по сегментам (Σ долей обеспечений этой партии).
                // Ключ = id записи «Партии ГП» (= id полосы parentStrips, = supply.finishedBatchId).
                var demandByBatchSeg = {};
                shareBySupply.forEach(function(item) {
                    var bId = String(item.s.finishedBatchId);
                    var arr = demandByBatchSeg[bId] || (demandByBatchSeg[bId] = []);
                    (item.shares || []).forEach(function(sh, i) { arr[i] = round3((arr[i] || 0) + ((sh && sh.rolls) || 0)); });
                });
                var cChain = Promise.resolve();
                // 2a) уменьшить Обеспечение A до доли сегмента 0.
                shareBySupply.forEach(function(item) {
                    cChain = cChain.then(function() {
                        var sh = item.shares[0] || { rolls: 0, footage: 0 };
                        var f = buildSupplyFieldsForFinishedBatch(supMeta, {
                            finishedBatchId: item.s.finishedBatchId,
                            footage: sh.footage > 0 ? sh.footage : '', rolls: sh.rolls,
                            active: '1', status: SUPPLY_STATUSES[0]
                        });
                        return self.post('_m_set/' + item.s.id + '?JSON', f);
                    });
                });
                // 2a-bis) #3433: «Партии ГП» резки A пересчитать под сегмент 0 — «Кол-во
                // план» = полосы × проходов A (aRuns), «Кол-во рулонов» = спрос сегмента 0.
                (parentStrips || []).forEach(function(st) {
                    cChain = cChain.then(function() {
                        var seg0 = (demandByBatchSeg[String(st.id)] || [])[0] || 0;
                        var f = buildFinishedBatchFields(fbMeta, {
                            planned: finishedBatchRolls(st.qty, aRuns),
                            rolls: seg0 > 0 ? seg0 : ''
                        });
                        if (!Object.keys(f).length) return;
                        return self.post('_m_set/' + st.id + '?JSON', f);
                    });
                });
                // 2b) каждое продолжение B (сегменты 1..N).
                crs.forEach(function(cr, ci) {
                    var segIdx = ci + 1;
                    cChain = cChain.then(function() {
                        var cutFields = buildFields(cutReqIds, {
                            status: (parentCut && parentCut.status) || CUT_STATUSES[0],
                            slitter: (upd && upd.slitterId != null) ? upd.slitterId : (parentCut && parentCut.slitter && parentCut.slitter.id),   // #4085: голова переназначена слоем размещения → продолжение на тот же станок
                            materialBatch: parentCut && parentCut.batchId,
                            // #3795: «Вид сырья» цепочки → продолжение. Карточка очереди берёт сырьё
                            // из cut_material (своего реквизита резки), а обеспечения продолжения не
                            // привязаны к нему по «Заданию», поэтому materialByCut его не восстановит.
                            material: parentMaterial,
                            plannedRuns: cr.plannedRuns,
                            // #3923: «Очередность» не пишем — порядок задаёт planStart (главное значение).
                            winding: normWinding(parentCut && parentCut.winding),
                            // #3569: лидер родителя (одна метка из cut_leader) → id справочника.
                            leader: self.resolveLeaderId(parentCut && parentCut.leaders && parentCut.leaders.length === 1 ? parentCut.leaders[0] : ''),
                            // #3781: «Метраж, м» = длина прогона цепочки. Без неё cutRunLength брал
                            // поделённый метраж обеспечения и показывал заниженную длину.
                            length: parentRunLen > 0 ? round3(parentRunLen) : '',
                            // #3892: «ID первой части» = id головы (parentId) — связывает продолжение
                            // с первой частью явно, без эвристики continuationSignature.
                            firstPart: (cr.firstPartId != null && cr.firstPartId !== '') ? String(cr.firstPartId) : String(parentId)
                        });
                        // #3916: продолжение дробления — «Длительность»/«Резка и Лидер» по его
                        // проходам (cr.plannedRuns), длина прогона/фольга — головы (parentId).
                        Object.assign(cutFields, splitSegTimingFields(parentId, cr.plannedRuns));
                        cutFields = addMainValueField(cutMeta, cutFields, cr.planStartTs);
                        return self.post('_m_new/' + cutMeta.id + '?JSON&up=1', cutFields).then(function(res) {
                            var bId = res && (res.obj || res.id || res.i);
                            if (!bId) throw new Error('Сервер не вернул id продолжения задания');
                            var stripMap = {};
                            // Главное значение B (плановое время старта) — _m_save с t{tableId}.
                            var bChain = Promise.resolve().then(function() {
                                var ts2 = Number(cr.planStartTs);
                                if (!mainKey || !(isFinite(ts2) && ts2 > 0)) return;
                                var mf = {}; mf[mainKey] = String(ts2);
                                return self.post('_m_save/' + bId + '?JSON', mf);
                            });
                            (parentStrips || []).forEach(function(st) {
                                bChain = bChain.then(function() {
                                    // #3431/#3433: st.qty — полос за проход; «Кол-во план»
                                    // продолжения = полосы × проходов сегмента (cr.plannedRuns);
                                    // «Кол-во рулонов» = спрос этого сегмента; «ID заказа»
                                    // копируется из родительской полосы.
                                    var segDemand = (demandByBatchSeg[String(st.id)] || [])[segIdx] || 0;
                                    var f = buildFinishedBatchFields(fbMeta, { width: st.width, strips: st.qty,
                                        planned: finishedBatchRolls(st.qty, cr.plannedRuns),
                                        rolls: segDemand > 0 ? segDemand : '',
                                        orderId: st.orderId || '', active: '1' });
                                    return self.post('_m_new/' + fbMeta.id + '?JSON&up=' + encodeURIComponent(bId), f).then(function(r2) {
                                        var nid = r2 && (r2.obj || r2.id || r2.i);
                                        if (nid) stripMap[String(st.id)] = String(nid);
                                    });
                                });
                            });
                            shareBySupply.forEach(function(item) {
                                bChain = bChain.then(function() {
                                    var sh = item.shares[segIdx] || { rolls: 0, footage: 0 };
                                    if (!(sh.rolls > 0) && !(sh.footage > 0)) return;
                                    if (item.s.positionId == null) return;
                                    var fb = stripMap[String(item.s.finishedBatchId)] || item.s.finishedBatchId;
                                    var f = buildSupplyFieldsForFinishedBatch(supMeta, {
                                        finishedBatchId: fb,
                                        footage: sh.footage > 0 ? sh.footage : '', rolls: sh.rolls,
                                        active: '1', status: SUPPLY_STATUSES[0]
                                    });
                                    return self.post('_m_new/' + supMeta.id + '?JSON&up=' + encodeURIComponent(item.s.positionId), f);
                                });
                            });
                            return bChain;
                        });
                    });
                });
                return cChain;
            }).then(splitBump).catch(softSkip); };
        });

        // 3) Удалить записи-продолжения прежних цепочек (их Полосы/дети каскадятся). Каждая
        // удаляемая резка — независимая задача; ВНУТРИ порядок обеспечения → Партии ГП → резка.
        var deleteTasks = (ops.deletes || []).map(function(cutId) {
            return function() { return Promise.resolve().then(function() {
                var supplies = self.supplies || [];
        
                // Партии ГП, подчинённые удаляемой резке
                var fbIds = {};
                supplies.forEach(function(s) {
                    if (s && String(s.cutId) === String(cutId) && s.finishedBatchId) {
                        fbIds[String(s.finishedBatchId)] = true;
                    }
                });
        
                // Обеспечения, привязанные к этим партиям ГП (могут не иметь cutId)
                var supplyIds = [];
                supplies.forEach(function(s) {
                    if (s && s.id && s.finishedBatchId && fbIds[String(s.finishedBatchId)]) {
                        supplyIds.push(String(s.id));
                    }
                });
        
                // 1) удаляем обеспечения (отсутствующие — пропускаем, #3895)
                var inner = Promise.resolve();
                supplyIds.forEach(function(sid) {
                    inner = inner.then(function() { return delMissingOk(sid); });
                });
                // 2) удаляем партии ГП
                Object.keys(fbIds).forEach(function(fbId) {
                    inner = inner.then(function() { return delMissingOk(fbId); });
                });
                // 3) удаляем саму резку
                inner = inner.then(function() { return delMissingOk(cutId); });
                return inner;
            }).then(splitBump).catch(softSkip); };
        });
        // #4014: три фазы пулом по MAX_PARALLEL_SPLIT, с БАРЬЕРАМИ между ними (updates → creates →
        // deletes), затем reload + persistCutSetupColumns, как в прежней цепочке.
        return runWithConcurrency(updateTasks, MAX_PARALLEL_SPLIT).then(function() {
            return runWithConcurrency(createTasks, MAX_PARALLEL_SPLIT);
        }).then(function() {
            return runWithConcurrency(deleteTasks, MAX_PARALLEL_SPLIT);
        }).then(function() { return self.reload(); }).then(function() {
            return self.persistCutSetupColumns();   // #3698: активности переналадки по итогам план-разбиения
        }).then(function() {
            self.hideProgress(); self.setBusy(false); self.render(); return true;
        }).catch(function(err) {
            self.hideProgress(); self.setBusy(false);
            self.notify('Ошибка разбиения заданий: ' + err.message, 'error');
            return false;
        });
    };

    // Авто-перестройка «Очередности» загруженных резок (#3421). «Сгенерировать резки»
    // само планирует очередь — отдельной кнопки нет. Пересобирает порядок каждого
    // станко-дня (planCutOperations → orderCuts по реальным минутам переналадки #3268,
    // ножи по убыванию #3130), разбивает по дням (#3280) и сохраняет изменившуюся
    // «Очередность»/время старта/проходы через applySplitPlan. Тихая (без подтверждения
    // и без уведомления — их даёт вызывающая генерация). Ручную перестановку (↑↓)
    // оператор делает ПОСЛЕ генерации. Ничего не изменилось → Promise<false> без записи.
    // → Promise<boolean> (true, если что-то применилось).
    // #3619: preserveOrder=true — НЕ пересобирать очередь по стратегии, а только расщепить
    // задания, переходящие границу рабочего дня, на по-дневные сегменты, СОХРАНЯЯ текущий
    // порядок очереди. Без флага (legacy #3421) — полная пересборка «Очередности» по SETUP/FATIGUE.
    // #3923/#4001: отобрать из ops.updates только РЕАЛЬНО изменившееся — время старта (planStart)
    // или проходы; родители разбиений нужны всегда (доли Обеспечения). cutsById — по ХРАНИМЫМ
    // резкам (tsOld = cut.number). «Очередность» не хранится: переупорядочивание = смена planStart.
    function filterChangedUpdates(ops, cutsById) {
        var createParents = {};
        ((ops && ops.creates) || []).forEach(function(cr) { createParents[String(cr.parentCutId)] = true; });
        return ((ops && ops.updates) || []).filter(function(u) {
            if (createParents[String(u.cutId)]) return true;
            var cut = cutsById[String(u.cutId)];
            if (!cut) return false;
            var tsNew = Number(u.planStartTs);
            var tsOld = Number(cut.number);   // #3242: главное значение = плановая дата старта (t1078)
            var tsChanged = isFinite(tsNew) && tsNew > 0 && tsNew !== tsOld;
            var runsChanged = Number(cut.plannedRuns) !== Number(u.plannedRuns);
            return tsChanged || runsChanged;
        });
    }

    // #4085: слой размещения (модель #3985) включён? Настройка SLOT_PLACEMENT=1 (по умолчанию ВЫКЛ —
    // прежний путь chooseSlitterBySetup/rebalance/orderCuts). Флаг позволяет включить и проверить
    // размещение перебором точек вставки на боевой базе без правки кода.
    AtexProductionPlanning.prototype.slotPlacementOn = function() {
        var v = (this.daySettings || {}).SLOT_PLACEMENT;
        return String(v == null ? '' : v).trim() === '1';
    };

    // #4047: ЧИСТЫЙ расчёт операций раскладки (planCutOperations) для ПРОИЗВОЛЬНОГО набора резок,
    // БЕЗ записи в БД. Нужен, чтобы «Упорядочить» оценило план-кандидат (переналадку) в памяти до
    // применения. cutsArray по умолчанию self.cuts; читает слиттер/поля из переданных объектов
    // (можно временно подменить станок для оценки переназначения). → { ops, cutsById }.
    AtexProductionPlanning.prototype.buildSequenceOps = function(cutsArray, strategy, preserveOrder, moveScope) {
        var self = this;
        var cuts = cutsArray || self.cuts || [];
        var planOptions = makePlanningOptions(strategy || PLANNING_STRATEGY_SETUP, self.changeTimes, self.daySettings);   // #4059: веса из «Настройки»

        // #3280: план разбиения по дням + плановое время старта (t1078). База — дата
        // из фильтра (.atex-pp-input), без неё — сегодня.
        var dayWindow = self.workingWindow();
        var planBaseMidnightMs = planBaseMidnightFrom(self.filter && self.filter.date, controllerNowMs(self));
        var windPoints = windingPointsFromTimes(self.opTimes || {});
        var perPassByCut = {};
        // #3974: якорь дня по «Дате план» нужен ТОЛЬКО зафиксированным (🔒) резкам — planCutOperations
        // держит их день, остальное набивает от «С». Смещение считаем для всех (planCutOperations
        // отберёт фикс.); может быть отрицательным (день раньше базы=«С»). Пустая «Дата план» — без якоря.
        var dayAnchorByCut = {};
        // #4050: срок каждой резки (самый ранний из «Сроков изготовления» обеспечиваемых позиций,
        // cutDueKeys) как индекс дня от базы «С» — для §8-штрафа в splitMachineQueue (selectByConfig).
        var dueDayByCut = {};
        var dueKeyByCut = {};   // #4085: срок как YYYYMMDD (для локального штрафа в scorePosition слоя размещения)
        cuts.forEach(function(c) {
            perPassByCut[String(c.id)] = windingMinutes(cutRunLength(c, self.supplies, self.footageBySupply), windPointsForCut(c.isFoil, windPoints)); // #3606
            var off = dayOffsetFromBase(c.planDate, planBaseMidnightMs);
            if (off != null) dayAnchorByCut[String(c.id)] = off;
            var dueKeys = cutDueKeys(c, self.supplies, self.genPositions);   // #4050
            if (dueKeys && dueKeys.length) {
                var dueOff = dueDayOffsetFromBase(dueKeys[0], planBaseMidnightMs);
                if (dueOff != null) dueDayByCut[String(c.id)] = dueOff;
                dueKeyByCut[String(c.id)] = dueKeys[0];   // #4085
            }
        });
        // #4085: слой размещения (модель #3985) — включается настройкой SLOT_PLACEMENT=1 (по умолчанию
        // ВЫКЛ → прежний путь orderCuts + текущий станок). Даёт planCutOperations допустимость станка
        // (стоп-лист сырья + лимит ширины джамбо) и нерабочие дни станка (выходные/праздники + отпуск).
        var slotOn = (self && typeof self.slotPlacementOn === 'function') ? self.slotPlacementOn() : false;   // #4085: защита для стаб-self в юнит-тестах
        var slittersById = {}; (self.slitters || []).forEach(function(s){ slittersById[String(s.id)] = s; });
        function feasibleMachineFor(sid, slot){
            var s = slittersById[String(sid)]; if (!s) return false;
            var mat = String(slot && slot.materialId == null ? '' : slot.materialId);
            if ((s.stopMaterialIds || []).map(String).indexOf(mat) >= 0) return false;   // стоп-лист сырья
            var nomW = self.nominalWidthByMaterial && self.nominalWidthByMaterial[mat];
            if (isSlitterWidthBlocked(s.widthCode, nomW)) return false;                   // #4006: лимит ширины джамбо
            return true;
        }
        function machineDayOffFor(sid){
            return function(dayOffset){
                var ms = planBaseMidnightMs + Number(dayOffset) * 86400000;
                return !self.dayIsWorking(ms) || self.slitterOnVacationDay(sid, ms);   // выходной/праздник или отпуск станка
            };
        }
        // #3974: вход планировщика = всё НЕОБЕСПЕЧЕННОЕ — открытые задания (статус ≠ «Завершён»),
        // за ЛЮБЫЕ даты. Фильтра по [С; По] на входе больше нет: раньше scope-диапазон заодно
        // отсекал прошлое/готовое, теперь отбираем явно по статусу, а [С; По] — окно РАЗМЕЩЕНИЯ
        // (база = «С», splitMachineQueue набивает от неё и переливает за «По»). Обеспеченные
        // («Завершён») и не показанные в очереди — не трогаем (остаются как есть).
        var planInput = (cuts || []).filter(function(c){ return String(c && c.status || '').trim() !== 'Завершён'; });
        // #4074: ручной перенос 🗓 пересобирает план ПО СРОКАМ (deadlineAware, как «Упорядочить»,
        // preserveOrder=false), чтобы задания не уезжали за срок. Прежде перенос завершался
        // preserveOrder-пересборкой (deadlineAware выкл): она паковала всё от «С» вперёд без учёта
        // сроков и толкала задания за их срок («перенос с несоблюдением сроков», issue #4074).
        // Перенесённое задание при этом ЗАКРЕПЛЯЕМ на выбранном пользователем дне: временно помечаем
        // c.fixed (как 🔒 «замок дня») — planCutOperations держит его день (effAnchorByCut от «Даты
        // план»), остальное раскладывает по срокам вокруг. Замок снимаем в finally (c.fixed мутируем на
        // общих объектах self.cuts только на время планирования). Без moveScope — прежнее поведение.
        var pinnedRestore = [];
        if (moveScope && moveScope.pinCutIds && moveScope.pinCutIds.length) {
            var pinSet = {};
            moveScope.pinCutIds.forEach(function(id){ pinSet[String(id)] = true; });
            planInput.forEach(function(c){
                if (c && !c.fixed && pinSet[String(c.id)]) { c.fixed = true; pinnedRestore.push(c); }   // временный замок перенесённого
            });
        }
        var ops;
        try {
        ops = planCutOperations(planInput, {
            weights: planOptions,
            times: self.changeTimes,
            dayStartMin: dayWindow.startMin,
            dayEndMin: dayWindow.cutEndMin,
            dayEndHourMin: dayWindow.endMin,   // #3847: DAY_END_HOUR (реальный конец смены) для лимита нахлёста
            maxOverworkCutsMin: dayWindow.maxOverworkCutsMin,   // #3847: макс. нахлёст резки за DAY_END_HOUR
            maxOverworkTuneMin: dayWindow.maxOverworkTuneMin,   // #3847: макс. нахлёст настройки за DAY_END_HOUR
            perPassByCut: perPassByCut,
            planBaseMidnightMs: planBaseMidnightMs,
            lunchStartMin: dayWindow.lunchStartMin,
            lunchDurationMin: dayWindow.lunchDurationMin,
            preserveOrder: preserveOrder,   // #3619: только заполнить дни, не пересобирая порядок
            dayAnchorByCut: dayAnchorByCut,   // #3974: день держит только 🔒 (planCutOperations отбирает фикс.); свободные — от «С»
            dueDayByCut: dueDayByCut,   // #4050: срок каждой резки (индекс дня от «С») для §8-штрафа размещения
            firstCutSetup: true,   // #3669 п.2: первая задача очереди резервирует настройку ножей
            prevSetupBySlitter: self.planningPrevSetupBySlitter(planBaseMidnightMs),   // #3853/#3876: заправка станков; станок в отпуске обнулён → первая резка после отпуска считает настройку с нуля
            gapFill: true,   // #3739: не оставлять простоев в смене — тянуть будущие резки в хвост, нахлёст разрешён
            blockedRangesBySlitter: self.blockedRangesBySlitter(planBaseMidnightMs),   // #3764: окна «Отпуска» по станкам
            // #4085: модель #3985 — размещение перебором точек вставки (по умолчанию выкл, настройка SLOT_PLACEMENT)
            slotPlacement: slotOn,
            slitterIds: (self.slitters || []).map(function(s){ return String(s.id); }),
            dueKeyByCut: dueKeyByCut,
            feasibleMachineFor: slotOn ? feasibleMachineFor : null,
            machineDayOffFor: slotOn ? machineDayOffFor : null
        });
        } finally {
            pinnedRestore.forEach(function(c){ c.fixed = false; });   // #4074: снять временный замок перенесённого задания
        }

        var cutsById = {};
        cuts.forEach(function(c) { cutsById[String(c.id)] = c; });
        return { ops: ops, cutsById: cutsById };
    };

    AtexProductionPlanning.prototype.autoSequenceQueue = function(strategy, preserveOrder, moveScope) {
        var self = this;
        if (!(self.cuts && self.cuts.length)) return Promise.resolve(false);
        var built = self.buildSequenceOps(self.cuts, strategy, preserveOrder, moveScope);   // #4074: moveScope.pinCutIds — закрепить перенесённое задание при пересборке по срокам
        var ops = built.ops;
        var changedUpdates = filterChangedUpdates(ops, built.cutsById);
        if (!changedUpdates.length && !(ops.creates || []).length && !(ops.deletes || []).length) {
            return Promise.resolve(false);
        }
        return self.applySplitPlan({ updates: changedUpdates, creates: ops.creates, deletes: ops.deletes });
    };

    // ── Рендеринг ──

    AtexProductionPlanning.prototype.render = function() {
        // Защита от лавины рендеров (#3202): не более 10 вызовов за 1 секунду.
        var now = Date.now();
        if (!this._renderWindow || now - this._renderWindow.start > 1000) {
            this._renderWindow = { start: now, count: 0 };
        }
        this._renderWindow.count += 1;
        if (this._renderWindow.count > 10) {
            console.error('[pp] ⛔ render: лавина рендеров! ' + this._renderWindow.count + ' вызовов за ' + (now - this._renderWindow.start) + 'мс. Останавливаю.');
            return;
        }
        if (this._rendering) { console.warn('[pp] ⚠️ render: уже выполняется, пропускаю рекурсивный вызов'); return; }
        this._rendering = true;
        try {
            this.renderForm();
            this.renderQueue();
            this.renderLink();
        } finally {
            this._rendering = false;
        }
    };

    // #3354 п.2/п.3: лёгкий выбор резки без пересборки очереди. Полный render()
    // заново строит renderQueue → удаляет уже открытую панель полос (.atex-pp-strip-panel),
    // из-за чего раньше любой клик по карточке её сворачивал. Здесь только: запомнить
    // выбранную резку, переключить подсветку is-active по карточкам через DOM и обновить
    // боковую панель «Связанные позиции» (renderLink). Панель полос остаётся нетронутой —
    // её закрывает лишь собственный крестик .atex-pp-strip-close.
    AtexProductionPlanning.prototype.selectCut = function(cutId) {
        this.selectedCutId = cutId;
        if (this.queueEl) {
            var cards = this.queueEl.querySelectorAll('.atex-pp-cut');
            for (var i = 0; i < cards.length; i++) {
                var card = cards[i];
                var same = card.dataset && String(card.dataset.cutId) === String(cutId);
                card.classList.toggle('is-active', !!same);
            }
        }
        this.renderLink();
    };

    // #3638: применить deep-link из cut-gantt: выставить день (фильтр дат), активный
    // станок и сфокусировать задание (подсветка + прокрутка к карточке). Вызывается
    // после первичного рендера. Параметры — { cut, date, slitter } (строки, любой пуст).
    AtexProductionPlanning.prototype.applyDeepLink = function(params) {
        var p = params || {};
        if (!p.cut && !p.date && !p.slitter) return;
        if (p.date) { this.filter.date = p.date; this.filter.dateTo = p.date; }
        if (p.slitter) this.activeSlitter = String(p.slitter);
        this.renderQueue();   // пересобрать вкладки/очередь под новый день/станок
        if (p.cut) {
            this.selectCut(p.cut);
            var card = this.queueEl && this.queueEl.querySelector('.atex-pp-cut[data-cut-id="' + String(p.cut).replace(/"/g, '\\"') + '"]');
            if (card) {
                card.classList.add('is-deeplink');
                if (typeof card.scrollIntoView === 'function') card.scrollIntoView({ block: 'center' });
            }
        }
        this.renderLink();
    };

    // Открыть модалку формы новой резки (#3116 п.1). Содержимое уже отрисовано
    // renderForm; здесь только показываем оверлей.
    AtexProductionPlanning.prototype.openForm = function() {
        this.renderForm();
        if (this.modalEl) this.modalEl.classList.add('is-open');
    };

    AtexProductionPlanning.prototype.closeForm = function() {
        if (this.modalEl) this.modalEl.classList.remove('is-open');
    };

    AtexProductionPlanning.prototype.openCutTiming = function(cut) {
        if (this.timingModalTitleEl) {
            this.timingModalTitleEl.textContent = cutTimingModalTitle(cut);
        }
        if (this.timingModalBodyEl) {
            var body = this.timingModalBodyEl;
            while (body.firstChild) body.removeChild(body.firstChild);
            // #3240: тайминг окна с разбивкой setup и жирным «Итого резка». Контекст
            // (старт/setup/нормы) собран в renderQueue; нет контекста → сохранённый текст.
            var ctx = this._timingByCut && this._timingByCut[String(cut && cut.id)];
            if (ctx) {
                cutTimingTimelineLines(ctx).forEach(function(ln, i) {
                    if (i > 0) body.appendChild(document.createTextNode('\n'));
                    if (ln.bold) body.appendChild(el('strong', { text: ln.text }));
                    else body.appendChild(document.createTextNode(ln.text));
                });
            } else {
                body.textContent = cutTimingModalText(cut);
            }
        }
        if (this.timingModalEl) this.timingModalEl.classList.add('is-open');
    };

    AtexProductionPlanning.prototype.closeCutTiming = function() {
        if (this.timingModalEl) this.timingModalEl.classList.remove('is-open');
    };

    // ── #3764: «Отпуск» (окна простоя станка) ──────────────────────────────────

    // Прочитать строки «Отпуска» одного станка (F_U=slitterId) → [{ id, start, end, notes }].
    AtexProductionPlanning.prototype.fetchDowntimeRows = function(slitterId) {
        var meta = this.meta.downtime;
        if (!meta) return Promise.resolve([]);
        var endIdx = columnIndex(meta, DOWNTIME_REQ.end);
        var notesIdx = columnIndex(meta, DOWNTIME_REQ.notes);
        return this.getJson('object/' + meta.id + '/?JSON_OBJ&F_U=' + encodeURIComponent(slitterId) + '&LIMIT=0,500')
            .then(function(rows) {
                return (rows || []).map(function(rec) {
                    var r = rec.r || [];
                    return {
                        id: String(rec.i),
                        start: (r[0] == null || r[0] === '') ? null : Number(r[0]),
                        end: (endIdx >= 0 && r[endIdx] != null && r[endIdx] !== '') ? Number(r[endIdx]) : null,
                        notes: (notesIdx >= 0 && r[notesIdx] != null) ? String(r[notesIdx]) : ''
                    };
                });
            });
    };

    // Перечитать окна простоя станка с сервера в кеш (откат UI после ошибки записи).
    AtexProductionPlanning.prototype.reloadDowntimesForSlitter = function(slitterId) {
        var self = this;
        return this.fetchDowntimeRows(slitterId).then(function(rows) {
            self.downtimesBySlitter[String(slitterId)] = rows;
            return rows;
        });
    };

    // #3764/#3844: построить модалку «Отпуск» (заголовок, тело-таблица, «×», «ОК»).
    // «×» и «ОК» (справа) закрывают окно; поля «Отпуска» сохраняются по change, поэтому
    // отдельного «Сохранить» нет. Та же механика оверлея, что у формы/тайминга (×/оверлей/Esc).
    AtexProductionPlanning.prototype.buildDowntimeModal = function() {
        var self = this;
        var dtTitle = el('h2', { class: 'atex-pp-form-title atex-pp-dt-title', text: 'Отпуск станка' });
        var dtBody = el('div', { class: 'atex-pp-dt-body' });
        var dtDialog = el('div', { class: 'atex-pp-modal-dialog atex-pp-dt-dialog' });
        var dtClose = el('button', { class: 'atex-pp-modal-close', type: 'button', text: '×', title: 'Закрыть' });
        dtClose.addEventListener('click', function() { self.closeDowntime(); });
        // #3844: «ОК» (справа) — закрывает окно (поля сохраняются по change, отдельного «Сохранить» нет).
        var dtOk = el('button', { class: 'atex-pp-btn atex-pp-btn-primary atex-pp-dt-ok', type: 'button', text: 'ОК', title: 'Закрыть' });
        dtOk.addEventListener('click', function() { self.closeDowntime(); });
        dtDialog.appendChild(dtClose);
        dtDialog.appendChild(dtTitle);
        dtDialog.appendChild(dtBody);
        dtDialog.appendChild(el('div', { class: 'atex-pp-supply-actions' }, [dtOk]));
        this.downtimeModalTitleEl = dtTitle;
        this.downtimeModalBodyEl = dtBody;
        this.downtimeModalEl = el('div', { class: 'atex-pp-modal atex-pp-dt-modal' }, [dtDialog]);
        this.downtimeModalEl.addEventListener('click', function(e) { if (e.target === self.downtimeModalEl) self.closeDowntime(); });
        this.root.appendChild(this.downtimeModalEl);
        return this.downtimeModalEl;
    };

    AtexProductionPlanning.prototype.openDowntime = function() {
        if (!this.meta.downtime) { this.notify('В метаданных нет таблицы «' + TABLE.downtime + '»', 'error'); return; }
        var act = this.downtimeActiveSlitter;
        if (!act || !act.id) { this.notify('Выберите станок (вкладку) для редактирования отпусков', 'error'); return; }
        if (this.downtimeModalTitleEl) this.downtimeModalTitleEl.textContent = 'Отпуск станка «' + (act.label || act.id) + '»';
        this.renderDowntimeTable();
        if (this.downtimeModalEl) this.downtimeModalEl.classList.add('is-open');
    };

    AtexProductionPlanning.prototype.closeDowntime = function() {
        if (this.downtimeModalEl) this.downtimeModalEl.classList.remove('is-open');
        // Очередь могла измениться (автоплан пропускает простой) — перерисуем расписание.
        try { this.renderQueue(); } catch (e) { /* очередь перерисуется при следующем render */ }
    };

    // Редактируемая таблица окон простоя активного станка: «Начало», «Окончание»,
    // «Примечания», удаление строки и кнопка «+ Отпуск». Поля сохраняются по change
    // (как полосы резки): начало — _m_save (главное значение DATETIME), реквизиты — _m_set.
    AtexProductionPlanning.prototype.renderDowntimeTable = function() {
        var self = this;
        var body = this.downtimeModalBodyEl;
        if (!body) return;
        while (body.firstChild) body.removeChild(body.firstChild);
        var act = this.downtimeActiveSlitter;
        if (!act || !act.id) return;
        var slitterId = act.id;
        var rows = this.downtimesBySlitter[slitterId] || (this.downtimesBySlitter[slitterId] = []);
        rows.sort(function(a, b) { return (Number(a.start) || 0) - (Number(b.start) || 0); });

        var table = el('div', { class: 'atex-pp-dt-table' });
        table.appendChild(el('div', { class: 'atex-pp-dt-row atex-pp-dt-head' }, [
            el('span', { text: 'Начало' }),
            el('span', { text: 'Окончание' }),
            el('span', { text: 'Примечания' }),
            el('span', { text: '' })
        ]));
        var tbody = el('div', { class: 'atex-pp-dt-tbody' });
        table.appendChild(tbody);

        function renderRows() {
            while (tbody.firstChild) tbody.removeChild(tbody.firstChild);
            if (!rows.length) {
                tbody.appendChild(el('div', { class: 'atex-pp-dt-empty', text: 'Окон простоя нет. Добавьте отпуск кнопкой ниже.' }));
            }
            rows.forEach(function(row) {
                var rowEl = el('div', { class: 'atex-pp-dt-row' });
                var startInput = el('input', { class: 'atex-pp-input', type: 'datetime-local', step: '60' });
                startInput.value = unixToDatetimeLocal(row.start);
                startInput.addEventListener('change', function() {
                    row.start = datetimeLocalToUnix(startInput.value);
                    self.persistDowntimeRow(slitterId, row);
                });
                var endInput = el('input', { class: 'atex-pp-input', type: 'datetime-local', step: '60' });
                endInput.value = unixToDatetimeLocal(row.end);
                endInput.addEventListener('change', function() {
                    row.end = datetimeLocalToUnix(endInput.value);
                    self.persistDowntimeRow(slitterId, row);
                });
                var notesInput = el('input', { class: 'atex-pp-input', type: 'text', placeholder: 'причина (ТО и т.п.)' });
                notesInput.value = row.notes || '';
                notesInput.addEventListener('change', function() {
                    row.notes = notesInput.value;
                    self.persistDowntimeRow(slitterId, row);
                });
                var del = el('button', { class: 'atex-pp-btn atex-pp-dt-del', type: 'button', text: '×', title: 'Удалить отпуск' });
                del.addEventListener('click', function() {
                    self.deleteDowntimeRow(slitterId, row).then(function() {
                        var i = rows.indexOf(row);
                        if (i >= 0) rows.splice(i, 1);
                        renderRows();
                    }).catch(function() { /* отказ сервера — строку оставляем (deleteDowntimeRow уже уведомил) */ });
                });
                rowEl.appendChild(startInput);
                rowEl.appendChild(endInput);
                rowEl.appendChild(notesInput);
                rowEl.appendChild(del);
                tbody.appendChild(rowEl);
            });
        }
        renderRows();

        var addBtn = el('button', { class: 'atex-pp-btn atex-pp-dt-add', type: 'button', text: '+ Отпуск' });
        addBtn.addEventListener('click', function() {
            rows.push({ id: null, start: null, end: null, notes: '' });
            renderRows();
        });

        body.appendChild(table);
        body.appendChild(addBtn);
    };

    // Сохранить строку отпуска. Создаёт (нет id) или обновляет. Главное значение (начало,
    // DATETIME) пишется ТОЛЬКО через _m_save с t{tableId} (как плановый старт резки, #3280:
    // _m_set→403, _m_save{val} не пишет datetime); «Окончание»/«Примечания» — _m_set.
    // Записи одной строки СЕРИАЛИЗУЕМ цепочкой row._save: иначе быстрая правка нескольких
    // полей НОВОЙ строки (id ещё не пришёл) шлёт несколько _m_new и плодит дубли. Следующая
    // правка ждёт завершения предыдущей (id уже проставлен) и идёт как обновление.
    AtexProductionPlanning.prototype.persistDowntimeRow = function(slitterId, row) {
        var self = this;
        var meta = this.meta.downtime;
        if (!meta || !row) return Promise.resolve();
        var run = function() {
            // Без начала запись бессмысленна — создавать/обновлять нечего (ждём ввода).
            if (row.start == null) return Promise.resolve();
            if (row.end != null && row.end <= row.start) {
                self.notify('«Окончание» отпуска должно быть позже начала', 'error');
                return Promise.resolve();
            }
            var endReqId = reqIdByName(meta, DOWNTIME_REQ.end);
            var notesReqId = reqIdByName(meta, DOWNTIME_REQ.notes);
            var reqFields = buildFields(
                { end: endReqId, notes: notesReqId },
                { end: row.end != null ? String(row.end) : '', notes: row.notes }
            );
            var onErr = function(err) {
                self.notify('Не удалось сохранить отпуск: ' + (err && err.message || err), 'error');
                // Откат к серверному состоянию, чтобы UI не расходился с базой.
                self.reloadDowntimesForSlitter(slitterId).then(function() { self.renderDowntimeTable(); });
            };
            if (row.id) {
                var mainFields = {}; mainFields['t' + meta.id] = String(row.start);
                return self.post('_m_save/' + row.id + '?JSON', mainFields).then(function() {
                    if (Object.keys(reqFields).length) return self.post('_m_set/' + row.id + '?JSON', reqFields);
                }).catch(onErr);
            }
            var createFields = addMainValueField(meta, reqFields, String(row.start));
            return self.post('_m_new/' + meta.id + '?JSON&up=' + encodeURIComponent(slitterId), createFields).then(function(res) {
                var id = res && (res.obj || res.id || res.i);
                if (id) row.id = String(id);
                else throw new Error('сервер не вернул id записи');
            }).catch(onErr);
        };
        var prev = (row._save && typeof row._save.then === 'function') ? row._save : Promise.resolve();
        row._save = prev.then(run, run);
        return row._save;
    };

    // Удалить строку отпуска. Не сохранённая (id=null) — просто из UI; иначе _m_del.
    AtexProductionPlanning.prototype.deleteDowntimeRow = function(slitterId, row) {
        var self = this;
        if (!row || !row.id) return Promise.resolve();
        return this.post('_m_del/' + encodeURIComponent(row.id) + '?JSON', {}).catch(function(err) {
            self.notify('Не удалось удалить отпуск: ' + (err && err.message || err), 'error');
            throw err;   // не убираем строку из UI, раз сервер отказал
        });
    };

    function field(label, control) {
        return el('div', { class: 'atex-pp-field' }, [
            el('label', { class: 'atex-pp-label', text: label }),
            control
        ]);
    }

    AtexProductionPlanning.prototype.selectRef = function(items, value, placeholder, onChange, reqId, opts) {
        var self = this;
        var helper = (typeof window !== 'undefined' && window.AtexRefSearch) || null;
        opts = opts || {};
        if (helper && typeof helper.createSelect === 'function') {
            return helper.createSelect({
                classPrefix: 'atex-pp',
                inputClass: 'atex-pp-input',
                options: items || [],
                value: value,
                placeholder: placeholder || '— не выбрано —',
                reqId: reqId,
                cacheKey: opts.cacheKey,
                cache: this.refOptions,
                clearOnInput: opts.clearOnInput,
                loadOptions: reqId ? function(reqId, query, limit) { return self.loadRefOptions(reqId, query, limit); } : null,
                onChange: onChange
            });
        }

        var refSelect = el('select', { class: 'atex-pp-input' });
        refSelect.appendChild(el('option', { value: '', text: placeholder || '— не выбрано —' }));
        (items || []).forEach(function(it) {
            var o = el('option', { value: it.id, text: it.label });
            if (String(value) === String(it.id)) o.selected = true;
            refSelect.appendChild(o);
        });
        refSelect.addEventListener('change', function() { onChange(refSelect.value); });
        return refSelect;
    };

    AtexProductionPlanning.prototype.selectText = function(values, value, onChange) {
        var textSelect = el('select', { class: 'atex-pp-input' });
        values.forEach(function(v) {
            var o = el('option', { value: v, text: v });
            if (String(value) === String(v)) o.selected = true;
            textSelect.appendChild(o);
        });
        if (value && values.indexOf(value) === -1) {
            var extra = el('option', { value: value, text: value });
            extra.selected = true;
            textSelect.appendChild(extra);
        }
        textSelect.addEventListener('change', function() { onChange(textSelect.value); });
        return textSelect;
    };

    AtexProductionPlanning.prototype.renderForm = function() {
        var self = this;
        if (this._renderingForm) { console.warn('[pp] ⚠️ renderForm: уже выполняется, пропускаю рекурсивный вызов'); return; }
        this._renderingForm = true;
        try {
        var d = this.draft;
        var form = this.formEl;
        form.innerHTML = '';
        form.appendChild(el('h2', { class: 'atex-pp-form-title', text: 'Новое производственное задание' }));
        form.appendChild(el('p', { class: 'atex-pp-hint', text: 'Задание под одну позицию заказа: выберите позицию и кол-во рулонов (≤ необеспеченного), затем станок — в списке станков показано ближайшее свободное окно.' }));

        // Только согласованные, ещё не обеспеченные позиции с ненулевым остатком.
        var posLabelById = {};
        (this.positions || []).forEach(function(p) { posLabelById[String(p.id)] = p.label; });
        var unsup = uncoveredPositions(this.genPositions, this.supplies).filter(function(p) { return p.approved; });
        var options = unsup.map(function(p) {
            var remaining = remainingRollsForPosition(p, self.supplies);
            var base = posLabelById[String(p.id)] || ('Сырьё#' + (p.materialId || '?') + ' · ' + ((p.orderWidth != null ? p.orderWidth : p.width) || '?') + ' мм');
            return { id: String(p.id), remaining: remaining, width: (p.orderWidth != null ? p.orderWidth : p.width),  // #3372: заказанная ширина
                label: base + ' · ост. ' + round3(remaining) + ' рул.' };
        }).filter(function(o) { return o.remaining > 0; });

        if (!options.length) {
            form.appendChild(el('p', { class: 'atex-pp-hint', text: 'Нет согласованных необеспеченных позиций.' }));
            this._renderingForm = false;
            return;
        }

        // Заказанное количество — позиция заказа (один выбор).
        var posSelect = el('select', { class: 'atex-pp-input' });
        posSelect.appendChild(el('option', { value: '', text: '— выберите позицию —' }));
        options.forEach(function(o) {
            var op = el('option', { value: o.id, text: o.label });
            if (String(d.positionId) === o.id) op.selected = true;
            posSelect.appendChild(op);
        });
        posSelect.addEventListener('change', function() {
            d.positionId = posSelect.value;
            d.prospect = null;
            var sel = options.filter(function(o) { return o.id === d.positionId; })[0];
            d.qty = sel ? String(sel.remaining) : '';
            self.renderForm();
        });
        form.appendChild(field('Заказанное количество', posSelect));

        var selOpt = options.filter(function(o) { return o.id === String(d.positionId); })[0];
        var maxQty = selOpt ? selOpt.remaining : 0;

        // Кол-во рулонов (≤ необеспеченного остатка). Изменение пересчитывает свободные окна.
        var qtyInput = el('input', { class: 'atex-pp-input', type: 'number', min: '1', step: '1' });
        if (selOpt) qtyInput.max = String(maxQty);
        qtyInput.value = d.qty || '';
        qtyInput.disabled = !selOpt;
        qtyInput.addEventListener('input', function() { d.qty = qtyInput.value; });
        qtyInput.addEventListener('change', function() { d.qty = qtyInput.value; self.renderForm(); });
        form.appendChild(field('Кол-во рулонов' + (selOpt ? ' (≤ ' + round3(maxQty) + ')' : ''), qtyInput));

        // Раскладка (станок-независимая) считается автоматически по позиции+кол-ву.
        var qtyNum = Math.floor(Number(d.qty) || 0);
        var canPlan = !!selOpt && qtyNum > 0 && qtyNum <= maxQty;
        var key = String(d.positionId) + '|' + qtyNum;
        var prospectReady = !!(d.prospect && d.prospect.forKey === key && !d.prospect.error);
        var prospectErr = (d.prospect && d.prospect.forKey === key && d.prospect.error) ? d.prospect.error : '';
        if (canPlan && !prospectReady && !prospectErr) this.refreshCutProspect();

        // Станок — в каждой опции ближайшее свободное окно (нужна готовая раскладка).
        if (!canPlan) {
            form.appendChild(field('Станок', el('div', { class: 'atex-pp-hint', text: 'Сначала выберите позицию и кол-во рулонов.' })));
        } else if (prospectErr) {
            form.appendChild(field('Станок', el('div', { class: 'atex-pp-hint', text: prospectErr })));
        } else if (!prospectReady) {
            form.appendChild(field('Станок', el('div', { class: 'atex-pp-hint', text: 'Расчёт раскладки…' })));
        } else {
            var pr = d.prospect;
            var slitterSelect = el('select', { class: 'atex-pp-input' });
            slitterSelect.appendChild(el('option', { value: '', text: '— выберите станок —' }));
            var nomW = self.nominalWidthByMaterial && self.nominalWidthByMaterial[String(pr.materialId)];
            this.slitters.forEach(function(s) {
                // #4006: станок недоступен по стоп-листу сырья ИЛИ по лимиту ширины джамбо («Код» j<1000).
                var widthBlocked = isSlitterWidthBlocked(s.widthCode, nomW);
                var blocked = isMaterialBlocked(s.stopMaterialIds || [], pr.materialId) || widthBlocked;
                var label = blocked ? (s.label + (widthBlocked ? ' — ширина превышает лимит' : ' — сырьё запрещено'))
                    : (s.label + ' — Свободное окно: ' + formatFreeSlot(self.freeSlotForCut(s.id, pr.scheduleCut)));
                var op = el('option', { value: String(s.id), text: label });
                if (blocked) op.disabled = true;
                if (String(d.slitterId) === String(s.id)) op.selected = true;
                slitterSelect.appendChild(op);
            });
            slitterSelect.addEventListener('change', function() { d.slitterId = slitterSelect.value; self.renderForm(); });
            form.appendChild(field('Станок', slitterSelect));
        }

        // У «Производственной резки» нет колонки «Статус» — есть флаг «В работе» (по умолчанию вкл).
        var activeInput = el('input', { type: 'checkbox' });
        activeInput.checked = d.active !== false;
        activeInput.addEventListener('change', function() { d.active = activeInput.checked; });
        form.appendChild(el('label', { class: 'atex-pp-checkbox-field' }, [
            activeInput,
            el('span', { text: 'В работе' })
        ]));

        var notes = el('textarea', { class: 'atex-pp-input atex-pp-textarea', rows: '2' });
        notes.value = d.notes || '';
        notes.addEventListener('input', function() { d.notes = notes.value; });
        form.appendChild(field('Примечания', notes));

        // Превью состава для выбранного станка + свободное окно.
        var chosenSlit = d.slitterId ? this.slitters.filter(function(s) { return String(s.id) === String(d.slitterId); })[0] : null;
        var chosenBlocked = !!(chosenSlit && prospectReady && (
            isMaterialBlocked(chosenSlit.stopMaterialIds || [], d.prospect.materialId) ||
            isSlitterWidthBlocked(chosenSlit.widthCode, this.nominalWidthByMaterial && this.nominalWidthByMaterial[String(d.prospect.materialId)])   // #4006: лимит ширины джамбо
        ));
        var chosenSlot = (prospectReady && d.slitterId && !chosenBlocked) ? this.freeSlotForCut(d.slitterId, d.prospect.scheduleCut) : null;
        var canCreate = prospectReady && !!d.slitterId && !chosenBlocked;

        var previewBox = el('div', { class: 'atex-pp-cut-preview' });
        if (canCreate) {
            var pl = d.prospect;
            var lines = [
                'Свободное окно: ' + formatFreeSlot(chosenSlot),
                'Проходов: ' + round3(pl.plannedRuns) + ' · полос/проход (ширина ' + round3(pl.posWidth) + ' мм): ' + round3(pl.stripsPerPass),
                'Произведём этой ширины: ' + round3(pl.producedPosRolls) + ' рул. · обеспечим: ' + round3(pl.supplyRolls) + ' · склад: ' + round3(pl.stockRolls),
                'Длительность резки: ~' + round3(pl.duration) + ' мин'
            ];
            if (pl.multiLayout) lines.push('⚠️ Кол-ва хватает на несколько заданий — создаётся первое.');
            lines.forEach(function(txt) { previewBox.appendChild(el('div', { class: 'atex-pp-cut-preview-line', text: txt })); });
        } else {
            previewBox.appendChild(el('div', { class: 'atex-pp-hint',
                text: prospectReady ? 'Выберите станок — покажу состав задания.' : 'Заполните позицию и кол-во рулонов.' }));
        }
        form.appendChild(previewBox);

        var actions = el('div', { class: 'atex-pp-actions' });
        var createBtn = el('button', { class: 'atex-pp-btn atex-pp-btn-primary', type: 'button', text: 'Создать задание' });
        createBtn.disabled = !canCreate;
        createBtn.addEventListener('click', function() { self.createCutForPosition(); });
        actions.appendChild(createBtn);
        form.appendChild(actions);
        } finally {
            this._renderingForm = false;
        }
    };

    AtexProductionPlanning.prototype.renderQueue = function() {
        var self = this;
        if (this._renderingQueue) { console.warn('[pp] ⚠️ renderQueue: уже выполняется, пропускаю рекурсивный вызов'); return; }
        this._renderingQueue = true;
        try {
        var t0 = Date.now();
        var box = this.queueEl;
        // #3429: фокус и каретку поля поиска запоминаем ДО очистки DOM. box.innerHTML=''
        // удаляет сфокусированный input → браузер шлёт blur, который сбрасывал флаг
        // this._searchFocused раньше, чем мы успевали проверить его при восстановлении →
        // фокус терялся при каждом нажатии. Считываем состояние в локальные переменные
        // (источник истины — был ли input активным элементом), поэтому blur уже не мешает.
        var prevSearch = box.querySelector('.atex-pp-search');
        var searchHadFocus = !!(prevSearch && (this._searchFocused ||
            (typeof document !== 'undefined' && document.activeElement === prevSearch)));
        var searchCaret = null;
        if (prevSearch) { try { searchCaret = prevSearch.selectionStart; } catch (e) {} }
        box.innerHTML = '';

        // Панель фильтров. Фильтр по станку заменён закладками (#3116 п.2).
        var filters = el('div', { class: 'atex-pp-filters' });
        var statusFilter = this.selectText([''].concat(CUT_STATUSES), this.filter.status, function(v) { self.filter.status = v; self.renderQueue(); });
        // первый пункт статуса — «все»
        statusFilter.options[0].textContent = 'Все статусы';
        // #3599 п.2: дата плана ДИАПАЗОНОМ «С — По» (два поля, между ними дефис). Диапазон
        // фильтрует отображение очереди; «С» (filter.date) остаётся базой генерации/планирования.
        var dateFrom = el('input', { class: 'atex-pp-input atex-pp-date-input', type: 'date', value: this.filter.date || '', title: 'С (дата плана, от)' });
        var dateTo = el('input', { class: 'atex-pp-input atex-pp-date-input', type: 'date', value: this.filter.dateTo || '', title: 'По (дата плана, до)' });
        function applyDateRange() {
            self.selectedCutId = null;   // #3349: очищать панель «Связанные позиции»
            self.renderQueue();
            self.renderLink();
        }
        dateFrom.addEventListener('change', function() { self.filter.date = dateFrom.value; applyDateRange(); });
        dateTo.addEventListener('change', function() {
            self.filter.dateTo = dateTo.value;
            // При смене «По»: если «С» оказалась ПОЗЖЕ «По» — подтягиваем «С» к «По» (не
            // оставляем перевёрнутый диапазон). renderQueue перерисует поле «С» новым значением.
            var to = String(self.filter.dateTo || '').trim();
            var from = String(self.filter.date || '').trim();
            if (to !== '' && from !== '' && planDateDayKey(from) > planDateDayKey(to)) {
                self.filter.date = self.filter.dateTo;
            }
            applyDateRange();
        });
        // #3508 п.1 / #3599: стрелки ‹/› двигают ВЕСЬ диапазон на ±1 день (ширина окна сохраняется).
        function shiftFilterDate(delta) {
            self.filter.date = shiftPlanDate(self.filter.date || todayISO(), delta);
            self.filter.dateTo = shiftPlanDate(self.filter.dateTo || self.filter.date || todayISO(), delta);
            applyDateRange();
        }
        var datePrev = el('button', { class: 'atex-pp-date-nav', type: 'button', text: '‹', title: 'Сдвинуть диапазон на день назад' });
        var dateNext = el('button', { class: 'atex-pp-date-nav', type: 'button', text: '›', title: 'Сдвинуть диапазон на день вперёд' });
        datePrev.addEventListener('click', function() { if (!self.busy) shiftFilterDate(-1); });
        dateNext.addEventListener('click', function() { if (!self.busy) shiftFilterDate(1); });
        // #3713: иконка-ссылка «Диаграмма Ганта» рядом с выбором дат — открывает Гант на этом же
        // диапазоне (?from=..&to=..). href пересобирается при каждом renderQueue из текущего фильтра.
        var ganttLink = el('a', {
            class: 'atex-pp-gantt-link',
            href: ganttRangeLink(this.filter.date, this.filter.dateTo, ganttBaseFromLocation()),
            title: 'Открыть диаграмму Ганта на этом диапазоне дат',
            'aria-label': 'Диаграмма Ганта',
            html: GANTT_ICON_SVG
        });
        var dateNav = el('div', { class: 'atex-pp-date-field' }, [datePrev, dateFrom, el('span', { class: 'atex-pp-date-sep', text: '–' }), dateTo, dateNext, ganttLink]);
        // #3411: быстрый поиск между «Дата плана» и «Статус». Фильтрует карточки очереди
        // и пересчитывает счётчики на закладках станков (видно, в каком станке сколько
        // совпавших позиций). Поиск идёт по сырью/намотке/статусу и подписям связанных
        // позиций. Ввод не пересобирает всю страницу — только очередь; фокус и каретку
        // в поле восстанавливаем после перерисовки (см. ниже), чтобы печатать без сбоев.
        var searchInput = el('input', {
            class: 'atex-pp-input atex-pp-search',
            type: 'search',
            placeholder: 'Поиск по позициям…',
            value: this.filter.query || ''
        });
        searchInput.addEventListener('input', function() {
            self.filter.query = searchInput.value;
            self._searchFocused = true;
            self.renderQueue();
        });
        searchInput.addEventListener('focus', function() { self._searchFocused = true; });
        searchInput.addEventListener('blur', function() { self._searchFocused = false; });
        filters.appendChild(field('Дата плана', dateNav));
        filters.appendChild(field('Поиск', searchInput));
        filters.appendChild(field('Статус', statusFilter));
        box.appendChild(filters);

        // #3429: восстанавливаем фокус/каретку по состоянию, снятому ДО очистки DOM —
        // надёжно, даже если blur от innerHTML='' успел сбросить this._searchFocused.
        if (searchHadFocus) {
            searchInput.focus();
            var caret = (searchCaret == null) ? searchInput.value.length : searchCaret;
            try { searchInput.setSelectionRange(caret, caret); } catch (e) {}
        }

        // #3411: связанные позиции по резкам — для поиска (haystack) и счётчиков.
        var query = String(this.filter.query == null ? '' : this.filter.query).trim();
        var hasQuery = query !== '';
        var posLabelById = {};
        (this.positions || []).forEach(function(p) { posLabelById[String(p.id)] = p.label; });
        var linkedLabelsByCut = {};
        (this.supplies || []).forEach(function(s) {
            var cid = String(s.cutId);
            if (!linkedLabelsByCut[cid]) linkedLabelsByCut[cid] = [];
            // #3624: позиция вне активного positions_list — в haystack кладём «<заказ>/<позиция>»
            // из cut_planning.order_no, чтобы поиск по номеру заказа находил такие резки.
            linkedLabelsByCut[cid].push(posLabelById[String(s.positionId)] ||
                (s.orderNo ? (s.orderNo + '/' + s.positionId) : ('позиция #' + s.positionId)));
        });
        function cutMatchesSearch(c) {
            return cutMatchesQuery(c, query, linkedLabelsByCut[String(c.id)]);
        }
        function groupMatchCount(g) {
            if (!hasQuery) return g.cuts.length;
            return g.cuts.filter(cutMatchesSearch).length;
        }

        // Базовая видимость очереди: не «Завершён», дата плана = выбранной/пустая.
        var visible = (this.cuts || []).filter(function(c) { return isCutVisible(c, self.filter.date, self.filter.dateTo); });
        var filtered = filterCuts(visible, this.filter);
        var groups = groupBySlitter(filtered);

        // #3535: вкладку показываем для КАЖДОГО станка справочника — даже если в
        // этот день у него нет резок (счётчик 0, пустой список). Иначе вкладки
        // «съезжают», и человек принимает первую вкладку за первый станок, хотя
        // станка без резок в ней нет. Порядок вкладок = порядок справочника
        // станков (this.slitters); группы с резками без станка / с удалённым из
        // справочника станком дописываем в конце в порядке groupBySlitter,
        // чтобы не потерять задания. (Раньше вкладки всех станков показывались
        // только при полностью пустой очереди — #3168.)
        var tabGroups = mergeStationTabs(this.slitters, groups);

        if (!tabGroups.length) {
            // #3788: отображаемая дата — выходной/праздник → красным «Выходной день» перед подсказкой.
            if (!this.dayIsWorking(planBaseMidnightFrom(this.filter && this.filter.date, controllerNowMs(this)))) {
                box.appendChild(el('div', { class: 'atex-pp-dayoff-note', text: 'Выходной день' }));
            }
            box.appendChild(el('div', { class: 'atex-pp-empty', text: 'Заданий в очереди нет' }));
            return;
        }

        // Закладки по станкам (#3116 п.2): один таб на станок, контент — резки
        // только активного станка. Активный таб в this.activeSlitter (ключ как в
        // groupBySlitter); если выбранного среди вкладок нет — берём первую.
        function groupKey(g) { return g.slitter.id == null ? '\u0000none' : String(g.slitter.id); }
        var keys = tabGroups.map(groupKey);
        if (keys.indexOf(self.activeSlitter) === -1) self.activeSlitter = keys[0];

        var tabs = el('div', { class: 'atex-pp-tabs' });
        tabGroups.forEach(function(g) {
            var key = groupKey(g);
            // #3411: при активном поиске счётчик показывает число совпавших позиций станка.
            var count = groupMatchCount(g);
            var tab = el('button', { class: 'atex-pp-tab' + (key === self.activeSlitter ? ' is-active' : '') + (hasQuery && count === 0 ? ' is-empty-match' : ''), type: 'button' }, [
                el('span', { class: 'atex-pp-tab-label', text: g.slitter.label }),
                el('span', { class: 'atex-pp-tab-count', text: String(count) })
            ]);
            // #3411: переключение станка очищает панель «Связанные позиции».
            tab.addEventListener('click', function() { self.activeSlitter = key; self.selectedCutId = null; self.renderQueue(); self.renderLink(); });
            tabs.appendChild(tab);
        });
        box.appendChild(tabs);

        var activeGroup = tabGroups.filter(function(g) { return groupKey(g) === self.activeSlitter; })[0] || tabGroups[0];
        // #3764: подпись/доступность кнопки «Отпуск {станок}» — по активному станку. Группа
        // «Без слиттера» (id=null) станка не имеет → кнопку гасим (некуда писать простой).
        if (this.downtimeBtn) {
            // Кнопка видна только если таблица «Отпуск» есть в метаданных (фича включена).
            this.downtimeBtn.style.display = this.meta.downtime ? '' : 'none';
            var actSlitter = activeGroup && activeGroup.slitter;
            var actId = actSlitter && actSlitter.id != null ? String(actSlitter.id) : '';
            this.downtimeBtn.textContent = 'Отпуск' + (actId && actSlitter.label ? ' ' + actSlitter.label : '');
            this.downtimeBtn.disabled = !actId;
            this.downtimeActiveSlitter = actId ? { id: actId, label: actSlitter.label } : null;
        }
        var groupEl = el('div', { class: 'atex-pp-queue-group' });

        // Расписание активного станка: старт/финиш каждой резки от начала смены (08:00).
        // Длительность — намотка прогона (метраж обеспечений → windingMinutes), плюс
        // переналадки между резками (реальные минуты из таблицы «Время операции»);
        // в конце каждого рабочего дня — блок уборки CLEANUP_SHIFT (#3155).
        var windPoints = windingPointsFromTimes(self.opTimes || {});
        var runLenByCut = {};
        activeGroup.cuts.forEach(function(c) {
            runLenByCut[String(c.id)] = cutRunLength(c, self.supplies, self.footageBySupply);
        });
        var schedById = {};
        var dayWindow = self.workingWindow();
        // Полночь дня планирования (день 0 расписания) — для title даты+времени старта.
        // День 0 = дата фильтра (.atex-pp-input), на которую отфильтрована очередь, а не
        // «сегодня»; иначе title показывал текущую дату вместо плановой (напр. 10.06 вместо 01.06).
        var planBaseMidnightMs = planBaseMidnightFrom(self.filter && self.filter.date, controllerNowMs(self));
        // #3635 п.5: сегменты НАСТРОЙКИ (0 проходов + продолжение с проходами в цепочке) —
        // намотки нет, длительность в расписании 0, чтобы настройка встала в конце дня N, а
        // намотка — на день N+1. Карточка таких заданий показывает «Настройка ножей и сырья».
        var setupTaskIds = setupTaskIdSet(activeGroup.cuts);
        // #3688: текущая заправка активного станка (из prev_cut_setup) → синтетическая
        // «предыдущая резка» для МОДАЛКИ тайминга первой резки очереди (#3240): смена сырья +
        // ножи, если осталось другое. Нет данных → null + firstCutSetup (настройка ножей с нуля).
        var carrySlitterId = String(activeGroup.slitter && activeGroup.slitter.id);
        // #3876: станок в отпуске на день базы → заправка обнулена (как в плане/хранимых колонках):
        // первая резка после отпуска в модалке тоже показывает полную настройку (ножи + сырьё).
        var carrySetup = self.planningPrevSetupBySlitter(planBaseMidnightMs)[carrySlitterId];
        var carryPrevCut = (carrySetup && activeGroup.cuts.length)
            ? carryOverPrevCut(carrySetup, activeGroup.cuts[0]) : null;
        // #3846: НЕ пересчитываем расписание live (buildSchedule убран) — показываем СОХРАНЁННЫЙ
        // план (scheduleFromStored), тот же, что рисует РМ «Диаграмма Ганта» → времена и минуты
        // ВСЕГДА совпадают. Обед (#3342) уже учтён генерацией в сохранённых planStart; здесь он —
        // отдельный видимый блок (lunchByDay), чтобы зазор не выглядел необъяснённой «дырой».
        var schedule = scheduleFromStored(activeGroup.cuts, planBaseMidnightMs);
        schedule.forEach(function(sc) { schedById[sc.cutId] = sc; });
        self._timingByCut = {};   // #3240: пересобираем контекст тайминга модалки для активного станка
        function schedDay(sc) { return sc ? Math.floor((Number(sc.startMin) || 0) / 1440) : null; }
        // #3616: задания группируем и нумеруем по РАБОЧЕМУ ДНЮ РАСПИСАНИЯ (schedDay) —
        // тому же, что разделяет дни блоком уборки и датой-заголовком, — а НЕ по хранимой
        // «Дате план». Иначе резки одной хранимой даты, переехавшие расписанием на следующий
        // день (не влезли в текущий), продолжали сквозную нумерацию (№5 на новом дне вместо №1).
        function cutSchedDayKey(c) { var d = schedDay(schedById[String(c.id)]); return d == null ? ' ' : String(d); }
        var dayCutsBySched = {};
        activeGroup.cuts.forEach(function(c) {
            var key = cutSchedDayKey(c);
            if (!dayCutsBySched[key]) dayCutsBySched[key] = [];
            dayCutsBySched[key].push(c);
        });
        // #4075: несущие карточки обеда/перерывов (серый значок) + сдвиг последующих окон дня
        // на длительность перерывов (аналог накладок Ганта). Обед подписан значком на несущей
        // карточке вместо прежней плашки .atex-pp-lunch; перерывы 10:00/15:00 сдвигают времена.
        var _brkInfo = computeQueueBreakMarkers(dayCutsBySched, schedById, intraDayBreaks(self.daySettings));
        var breakMarkersByCut = _brkInfo.markersByCut, breakShiftByCut = _brkInfo.shiftByCut;
        // Уборка в конце рабочего дня (#3155): блок после последней резки каждого дня.
        var cleanupByDay = {};
        dayCleanups(schedule, { cleanupMin: dayWindow.cleanupMin, shiftEndMin: dayWindow.endMin })   // #3599: уборка ПОСЛЕ DAY_END_HOUR
            .forEach(function(cl) { cleanupByDay[cl.day] = cl; });
        // #3743: суммарные рабочие минуты станка за каждый рабочий день — переналадка +
        // намотка + лидер по каждому заданию дня (всё, чем станок занят). Считаем по полному
        // расписанию (не по фильтру поиска), выводим в скобках после даты-заголовка. Уборка
        // (#3155) имеет собственную строку с минутами и в сумму заданий не входит.
        var dayMinutesBySched = {};
        var dayBreakdownBySched = {};   // #3914: разбивка бейджа «(N мин)» по заданиям
        schedule.forEach(function(sc) {
            var d = schedDay(sc);
            if (d == null) return;
            var m = (Number(sc.setupMin) || 0) + (Number(sc.durationMin) || 0) + (Number(sc.leaderMin) || 0);
            dayMinutesBySched[d] = (dayMinutesBySched[d] || 0) + m;
            (dayBreakdownBySched[d] = dayBreakdownBySched[d] || []).push(sc);
        });
        // #3914: печать бейджа «(N мин)» по дням активного станка — из чего складывается сумма и
        // какой день превысил бюджет (cutEnd−dayStart−обед+нахлёст). Источник — сохранённые planStart
        // (то, что реально записала последняя генерация), поэтому число совпадает с бейджем на экране.
        if (ppTraceOn()) {
            var _budget = (Number(dayWindow.cutEndMin) - Number(dayWindow.startMin))
                - (Number(dayWindow.lunchDurationMin) || 0) + (Number(dayWindow.maxOverworkTuneMin) || 0);
            ppTrace('БЕЙДЖ «(N мин)» станка «' + (activeGroup && activeGroup.slitter && activeGroup.slitter.name) + '» (бюджет ≈ ' + Math.round(_budget) + '):');
            Object.keys(dayMinutesBySched).map(Number).sort(function(a, b) { return a - b; }).forEach(function(d) {
                var total = Math.round(dayMinutesBySched[d]);
                var over = total > _budget + 1e-6;
                (over ? ppTraceWarn : ppTrace)('  день ' + d + ' («' + formatPlanDayHeading(planBaseMidnightMs, d) + '»): ' + total + ' мин' +
                    (over ? ' — ПРЕВЫШЕНИЕ на ' + Math.round(total - _budget) : '') + ', заданий ' + (dayBreakdownBySched[d] || []).length);
                (dayBreakdownBySched[d] || []).forEach(function(sc) {
                    var w = (Number(sc.setupMin) || 0) + (Number(sc.durationMin) || 0) + (Number(sc.leaderMin) || 0);
                    ppTrace('      резка ' + sc.cutId + ': окно ' + ppClock((Number(sc.startMin) || 0) - (Number(sc.setupMin) || 0)) +
                        '..' + ppClock(sc.finishMin) + ' = ' + Math.round(w) + ' мин (настр ' + Math.round(Number(sc.setupMin) || 0) + ' + намотка ' + Math.round(Number(sc.durationMin) || 0) + ')');
                });
            });
        }
        var lastDayDateRendered = null;   // #3616: дата-заголовок дня вставляется один раз на рабочий день

        activeGroup.cuts.forEach(function(c, idx) {
            // #3411: при поиске показываем только совпавшие карточки. Расписание/индексы
            // (idx, sameDayCuts) считаются по полной очереди станка, поэтому номера и
            // перестановки ↑/↓ остаются корректными — прячем лишь несовпавшие карточки.
            if (hasQuery && !cutMatchesSearch(c)) return;
            var active = String(self.selectedCutId) === String(c.id);
            var supplies = self.supplyCount(c.id);

            // Карточка-панель (#3120 п.1): div-панель вместо кнопки. Внутри —
            // информация и контролы (↑/↓/Полосы). Клик по всей панели = выбор резки
            // (#3149: раньше реагировала только строка .atex-pp-cut-info). Панель полос
            // (#3120 п.8) openStrips добавляет внутрь этой же карточки (контейнер —
            // cardPanel), а не внизу всей очереди — поэтому она строго одна на карточку.
            // #3120 п.4: подсветка резки, которую нечем обеспечить — нет подходящей
            // партии (Фаза 1a) ЛИБО есть потребность (метраж), но «Расход сырья» её не
            // покрывает (Фаза 1b: не удалось зарезервировать полностью).
            var unreserved = cutMissingBatch(c, self.genBatches);
            if (!unreserved) {
                var needLin = Number(runLenByCut[String(c.id)]) || 0;
                if (needLin > 0) {
                    var cons = (self.consumptionByCut && self.consumptionByCut[String(c.id)]) || [];
                    var resM2 = 0; cons.forEach(function(e) { resM2 += Number(e.m2) || 0; });
                    var wM = (Number(self.jumboWidthByMaterial[String(c.materialId)]) || 0) / 1000;
                    var resLin = wM > 0 ? resM2 / wM : 0;
                    if (resLin + 1e-6 < needLin) unreserved = true;
                }
            }
            // #3635 п.5: сегмент НАСТРОЙКИ (хвост дня N перед намоткой дня N+1) — карточка
            // без проходов, показывает «Настройка ножей и сырья», а не ошибку длительности.
            var isSetupTask = !!setupTaskIds[String(c.id)];
            // #3508 п.5: зафиксированное задание — класс is-fixed (серая кайма, видно, что менять нельзя).
            var cardPanel = el('div', { class: 'atex-pp-cut' + (active ? ' is-active' : '') + (unreserved ? ' is-unreserved' : '') + (c.fixed ? ' is-fixed' : '') + (isSetupTask ? ' is-setup' : ''), dataset: { cutId: String(c.id) } });

            var materialText = c.materialName || (c.materialId ? ('#' + c.materialId) : '—');
            var sc = schedById[String(c.id)];
            var runLengthForCut = runLenByCut[String(c.id)];
            // #3240: контекст тайминга резки для модалки (setup с предыдущей + нормы + старт).
            // #3688: для первой задачи очереди prev — заправка станка (carryPrevCut, из
            // prev_cut_setup): смена сырья + ножи, если осталось другое. Нет данных → null +
            // firstCutSetup (настройка ножей с нуля, #3669). Лидер показывается в конце резки.
            self._timingByCut[String(c.id)] = buildCutTimingCtx(
                c, idx > 0 ? activeGroup.cuts[idx - 1] : carryPrevCut, sc,
                runLengthForCut, windPoints, self.changeTimes, { firstCutSetup: true }
            );
            var cutNumberTitle = 'Задание № ' + (formatCutNumber(c.number) || c.id);
            // #3280: title — плановая дата+время старта до минут (sc есть); иначе номер резки.
            var cutNumTitle = formatCutStartTitle(sc, planBaseMidnightMs) || cutNumberTitle;

            // #3354 п.1: строка времени резки (старт–финиш окна от начала смены) теперь
            // живёт в первой строке карточки — между «номером по порядку» и сырьём, а не
            // отдельным рядом ниже. Клик открывает тайминг и (всплытием) выбирает резку.
            var timeEl = null;
            if (sc) {
                // #3635 п.5: для настройки показываем «⚙ Настройка ножей и сырья · N мин»
                // (окно = переналадка, минуты вверх), а не строку расписания резки.
                var scheduleText = isSetupTask
                    ? ('⚙ Настройка ножей и сырья · ' + Math.ceil(stripNum(sc.setupMin)) + ' мин')
                    : formatScheduleLine(sc, runLengthForCut, windPoints.length > 0, breakShiftByCut[String(c.id)]);
                if (!isSetupTask && stripNum(sc.durationMin) <= 0 && typeof console !== 'undefined' && console.error) {
                    console.error('[pp] ❌ renderQueue: длительность резки не рассчитана', {
                        cutId: String(c.id),
                        plannedRuns: c.plannedRuns,
                        runLength: runLengthForCut,
                        storedDuration: c.duration,
                        windPoints: windPoints
                    });
                }
                timeEl = el('div', {
                    class: 'atex-pp-cut-time',
                    role: 'button',
                    tabindex: '0',
                    title: 'Показать тайминг резки',
                    text: scheduleText
                });
                timeEl.addEventListener('click', function() {
                    self.openCutTiming(c);
                });
                timeEl.addEventListener('keydown', function(e) {
                    if (e.key !== 'Enter' && e.key !== ' ' && e.keyCode !== 13 && e.keyCode !== 32) return;
                    if (e.preventDefault) e.preventDefault();
                    e.stopPropagation();
                    self.openCutTiming(c);
                });
            }

            // #3354 п.1: первая строка карточки —
            // {номер по порядку} {время} {название сырья} {тип намотки} — {длина} х {резок};
            // справа прижата сводка связей (.atex-pp-cut-supplies).
            // #3508 п.7 / #3616: «Очередность» в карточке = позиция задания в очереди станка
            // за РАБОЧИЙ ДЕНЬ РАСПИСАНИЯ (1..N по dayCutsBySched), а НЕ хранимое значение
            // «Очередности» (могли задвоиться) и не сквозной номер по хранимой дате. Нумерация
            // всегда начинается с 1 на каждый видимый день (тот же день, что у уборки/даты).
            var sameDayCuts = dayCutsBySched[cutSchedDayKey(c)] || activeGroup.cuts;
            var dayIdx = sameDayCuts.indexOf(c);
            var seqText = String((dayIdx >= 0 ? dayIdx : idx) + 1);
            var windingText = normWinding(c.winding) || String(c.winding == null ? '' : c.winding).trim() || '—';
            var infoChildren = [
                el('span', { class: 'atex-pp-cut-seq', title: cutNumTitle, text: '№ ' + seqText })
            ];
            if (timeEl) infoChildren.push(timeEl);
            infoChildren.push(el('span', { class: 'atex-pp-cut-name', title: materialText, text: materialText }));
            infoChildren.push(el('span', { class: 'atex-pp-cut-winding', text: windingText }));
            // #3406 п.3: дефис — отдельный элемент между намоткой и размерами, чтобы
            // он стоял по центру (равный flex-gap слева и справа): «MR194 IN — 600 х 7».
            infoChildren.push(el('span', { class: 'atex-pp-cut-dash', text: '—' }));
            // #3635 п.5: у настройки проходов нет — вместо «длина х 0 резок» показываем
            // число настраиваемых ножей (сама намотка с этими размерами идёт на след. дне).
            infoChildren.push(el('span', { class: 'atex-pp-cut-runs',
                text: isSetupTask ? ('ножей: ' + (Number(c.knifeCount) || 0)) : formatCutDimensions(c, runLengthForCut) }));
            // #3472: лидер резки — после размеров (перед связями, которые прижаты вправо).
            // Один лидер — обычная плашка; несколько (легаси-смешение до ограничения по
            // лидеру) — выделяем предупреждением.
            var cutLeaders = (c.leaders || []).filter(function(s) { return s; });
            if (cutLeaders.length) {
                var mixed = cutLeaders.length > 1;
                infoChildren.push(el('span', {
                    class: 'atex-pp-cut-leader' + (mixed ? ' atex-pp-cut-leader-mixed' : ''),
                    title: (mixed ? 'В резке смешаны разные лидеры: ' : 'Лидер: ') + cutLeaders.join(', '),
                    text: 'лидер: ' + cutLeaders.join(', ')
                }));
            }
            // #3738: втулка резки — сразу после лидера. Источник — cut_sleeve (имя
            // «Диаметр втулки» обеспеченной позиции). Одна втулка — обычная плашка;
            // несколько (легаси-смешение до разбивки по втулке) — предупреждение, как у лидера.
            var cutSleeves = (c.sleeves || []).filter(function(s) { return s; });
            if (cutSleeves.length) {
                var sleeveMixed = cutSleeves.length > 1;
                infoChildren.push(el('span', {
                    class: 'atex-pp-cut-sleeve' + (sleeveMixed ? ' atex-pp-cut-sleeve-mixed' : ''),
                    title: (sleeveMixed ? 'В резке смешаны разные втулки: ' : 'Втулка: ') + cutSleeves.join(', '),
                    text: 'втулка: ' + cutSleeves.join(', ')
                }));
            }
            infoChildren.push(el('span', { class: 'atex-pp-cut-supplies', text: supplies ? ('связей: ' + supplies) : 'нет связей' }));
            cardPanel.appendChild(el('div', { class: 'atex-pp-cut-info' }, infoChildren));

            // #3354 п.1: под первой строкой — сводка полос по ширинам. Контейнер
            // .atex-pp-cut-material содержит по одной строке .atex-pp-strip-row на ширину:
            // «{сырьё} {ширина} x {длина} {намотка} — {факт.ширина}мм х {резок} x {полос} = {мотков} шт.».
            var stripGroups = cutStripGroups(c);
            if (stripGroups.length) {
                // #3686: обратный резолв (факт→номинал) сверяет j= с «Номинальной шириной» рулона
                var jumboWidth = self.nominalWidthByMaterial ? self.nominalWidthByMaterial[String(c.materialId)] : null;
                // #3769: «Срок изготовления» обеспечиваемых позиций — в скобках в конце строки.
                // Срок один на задание (позиции резки кластеризованы по сроку), поэтому
                // показываем общий набор сроков и красим строку по самому раннему (срочному):
                // раньше «Даты план» → красный, дальше план+DAYS_FORECAST → жёлтый, в окне → как есть.
                // #4051: includeSupplyFallback=true — срок берём и из cut_planning.due_date, когда
                // позиция выпала из активного positions_list (иначе плашка пропадала у таких заданий).
                var dueKeys = cutDueKeys(c, self.supplies, self.genPositions, true);
                var dueClass = dueKeys.length ? dueColorClass(dueKeys[0], planDateDayKey(c.planDate), self.daysForecast()) : '';
                var dueSuffix = '';
                if (dueKeys.length) {
                    var dueLabels = dueKeys.map(formatDayKey).filter(function(s) { return s; });
                    if (dueLabels.length) dueSuffix = ' (' + (dueLabels.length > 1 ? 'сроки: ' : 'срок: ') + dueLabels.join(', ') + ')';
                }
                var matRows = stripGroups.map(function(g) {
                    // #3408: полосы хранят ФАКТИЧЕСКУЮ ширину (#3372: p.width = факт.),
                    // поэтому g.width — это факт.ширина. В сводку выводим сначала номинал
                    // (обратный резолв по справочнику), а после тире — реальные мм.
                    var ctx = { jumbo: jumboWidth, inches: null };
                    var nominal = resolveNominalWidth(g.width, ctx, self.actualWidthIndex);
                    return el('div', { class: 'atex-pp-strip-row' + (dueClass ? ' ' + dueClass : ''),
                        text: formatStripSummaryLine(c, { width: nominal, count: g.count }, g.width, runLengthForCut) + dueSuffix });
                });
                cardPanel.appendChild(el('div', { class: 'atex-pp-cut-material' }, matRows));
            }

            // #3354 п.2/п.3: клик по ЛЮБОМУ месту карточки выбирает резку и обновляет
            // .atex-pp-link, НЕ пересобирая очередь (selectCut вместо render) — поэтому
            // открытая панель полос (.atex-pp-strip-panel) не сворачивается ни при клике
            // по этой карточке, ни при клике по другой (закрытие — только её крестиком
            // .atex-pp-strip-close). cutClickSelectsCut пропускает лишь клики внутри
            // самой панели полос (она и так гасит всплытие).
            cardPanel.addEventListener('click', function(e) {
                if (!cutClickSelectsCut(e.target)) return;
                self.selectCut(c.id);
            });

            var controls = el('div', { class: 'atex-pp-cut-controls' });
            var up = el('button', { class: 'atex-pp-move', type: 'button', text: '↑', title: 'Выше' });
            var down = el('button', { class: 'atex-pp-move', type: 'button', text: '↓', title: 'Ниже' });
            // sameDayCuts/dayIdx вычислены выше (для seqText #3508 п.7) — переиспользуем.
            // #3508 п.3: зафиксированное задание нельзя двигать по очереди (↑↓ заблокированы).
            if (dayIdx === 0 || c.fixed) up.disabled = true;
            if (dayIdx === sameDayCuts.length - 1 || c.fixed) down.disabled = true;
            up.addEventListener('click', function() {
                if (self.busy || c.fixed) return;
                self.moveCutInDay(sameDayCuts, dayIdx, -1);   // #3923: перестановка = обмен planStart + переупаковка
            });
            down.addEventListener('click', function() {
                if (self.busy || c.fixed) return;
                self.moveCutInDay(sameDayCuts, dayIdx, 1);
            });
            // #3706: остаток резки вне допуска → кнопка «Полосы» светло-красная,
            // чтобы отход вне допуска был виден прямо в очереди, без открытия панели.
            var stripsWarn = self.cutRemainderStatus(c) === 'warn';
            var strips = el('button', {
                class: 'atex-pp-strips' + (stripsWarn ? ' is-warn' : ''),
                type: 'button',
                text: stripsButtonLabel(c.knifeCount),
                title: stripsWarn ? 'Полосы резки — отход вне допуска' : 'Полосы резки (количество полос)'
            });
            strips.addEventListener('click', function() {
                if (self.busy) return;
                self.openStrips(c, cardPanel);   // #3508 п.3: для зафиксированных панель полос открывается только на просмотр
            });
            // #3508 п.4: «🔒» — переключить фиксацию ОДНОГО задания (зафиксировать ↔ снять).
            // Левее «🗑». is-active — когда задание уже зафиксировано (визуальный замок).
            var fix = el('button', {
                class: 'atex-pp-cut-fix' + (c.fixed ? ' is-active' : ''),
                type: 'button',
                text: '🔒',
                title: c.fixed ? 'Снять фиксацию задания' : 'Зафиксировать задание'
            });
            fix.addEventListener('click', function(e) {
                if (e && e.stopPropagation) e.stopPropagation();
                if (self.busy) return;
                self.toggleCutFixed(c);
            });
            // #3602: «🗓» — перенести задание на другой день (между «🔒» и «🗑»). Открывает
            // модалку (день + в начало/конец + «Зафиксировать»). Перенос имеет наивысший
            // приоритет — доступен и для зафиксированного задания. stopPropagation, чтобы
            // клик по кнопке не выбирал карточку.
            var move = el('button', {
                class: 'atex-pp-cut-move',
                type: 'button',
                text: '🗓',
                title: 'Перенести задание на другой день'
            });
            move.addEventListener('click', function(e) {
                if (e && e.stopPropagation) e.stopPropagation();
                if (self.busy) return;
                self.openMoveCut(c);
            });
            // #3486: «🗑» — удалить задание (резку) с её «Обеспечениями». stopPropagation,
            // чтобы клик по кнопке не выбирал резку (см. #3149: клики по контролам не
            // выбирают карточку). Подтверждение и удаление — в deleteCutTask.
            // #3508 п.3: зафиксированное задание удалить нельзя — кнопка заблокирована.
            var del = el('button', {
                class: 'atex-pp-cut-del' + (c.fixed ? ' is-disabled' : ''),
                type: 'button',
                text: '🗑',
                title: c.fixed ? 'Зафиксированное задание удалить нельзя (снимите фиксацию)' : 'Удалить задание'
            });
            if (c.fixed) del.disabled = true;
            del.addEventListener('click', function(e) {
                if (e && e.stopPropagation) e.stopPropagation();
                if (self.busy || c.fixed) return;
                self.deleteCutTask(c, cardPanel);
            });
            controls.appendChild(up);
            controls.appendChild(down);
            controls.appendChild(strips);
            controls.appendChild(fix);
            controls.appendChild(move);   // #3602: «🗓» перенос на другой день — между «🔒» и «🗑»
            // #3540: кнопки ◀▶ ручного сдвига планового старта убраны — двигать время вручную
            // не требуется. #3562: пин планового старта тоже убран — автогенерация двигает
            // зафиксированное задание по времени в течение дня и меняет его очередность.
            controls.appendChild(del);
            cardPanel.appendChild(controls);

            // #3616: дата рабочего дня — заголовком перед первой (видимой) карточкой каждого
            // дня расписания. Для дней 2+ он встаёт сразу ПОСЛЕ блока уборки предыдущего дня
            // («дату после записи об уборке»); для первого дня — в начале очереди. Дата =
            // база планирования (день фильтра) + смещение дня расписания.
            var cardSchedDay = sc ? schedDay(sc) : null;
            if (cardSchedDay != null && cardSchedDay !== lastDayDateRendered) {
                // #3743: после даты — суммарные минуты заданий станка за этот день: «(456 мин)».
                var dayMins = Math.round(Number(dayMinutesBySched[cardSchedDay]) || 0);
                // #3788: день расписания пришёлся на выходной/праздник, но задания на него есть
                // (вручную или вытеснены) — помечаем дату красным фоном.
                var dayOff = !self.dayIsWorking(planBaseMidnightMs + cardSchedDay * 86400000);
                groupEl.appendChild(el('div', {
                    class: 'atex-pp-day-date' + (dayOff ? ' is-dayoff' : ''),
                    title: dayOff ? 'Выходной/праздничный день — заданий быть не должно' : ''
                }, [
                    formatPlanDayHeading(planBaseMidnightMs, cardSchedDay),
                    el('span', { class: 'atex-pp-day-mins', text: ' (' + dayMins + ' мин)' })
                ]));
                lastDayDateRendered = cardSchedDay;
            }

            // #4075: прежняя плашка «🍽 Обед …» (.atex-pp-lunch) убрана — обед/перерывы теперь
            // показываются серым значком в углу несущей карточки (см. блок значков ниже).

            groupEl.appendChild(cardPanel);

            // Уборка в конце КАЖДОГО рабочего дня (#3155, #3280) — служит разделителем дня.
            // Резки, не влезшие в день, buildSchedule переносит на день+1 → они рендерятся
            // ПОСЛЕ блока уборки текущего дня, т.е. визуально в следующем дне, а не в этом.
            var myDay = sc ? schedDay(sc) : null;
            var nextCut = activeGroup.cuts[idx + 1];
            var nextSc = nextCut ? schedById[String(nextCut.id)] : null;
            var nextDay = nextSc ? schedDay(nextSc) : null;
            // #3613: задание, не влезшее в рабочий день, нормально дробить по дням. На
            // первой и последней карточке такой цепочки — значок справа внизу: «←» начало
            // в предыдущем дне, «→» продолжение в следующем. Смежные сегменты опознаём по
            // идентичной конфигурации резки и единому номеру заказа (isDaySplitSibling),
            // взятые у соседей очереди через границу рабочего дня (по schedDay расписания —
            // тому же, что разделяет дни блоком уборки).
            var prevCut = activeGroup.cuts[idx - 1];
            var prevSc = prevCut ? schedById[String(prevCut.id)] : null;
            var prevDay = prevSc ? schedDay(prevSc) : null;
            // #3737: первая (нет prev) / последняя (нет next) карточка диапазона — подменяем
            // отсутствующего соседа через границу дня смежным сегментом из дня ВНЕ фильтра,
            // чтобы значок ←/→ рисовался и при выбранном одном дне. Синтетический день соседа
            // (myDay∓1) гарантирует переход через границу (prevDay/nextDay !== myDay).
            if (!prevCut && myDay != null) {
                var bPrev = boundaryDaySibling(self.cuts, c, -1);
                if (bPrev) { prevCut = bPrev; prevDay = myDay - 1; }
            }
            if (!nextCut && myDay != null) {
                var bNext = boundaryDaySibling(self.cuts, c, 1);
                if (bNext) { nextCut = bNext; nextDay = myDay + 1; }
            }
            var spans = daySplitBadges(prevCut, prevDay, c, myDay, nextCut, nextDay);
            // #3889: сегмент НАСТРОЙКИ (0 проходов) ВСЕГДА продолжается в следующем дне — его
            // создаёт только splitMachineQueue как разрыв «настройка в хвосте дня N → намотка с
            // дня N+1». Поэтому значок «→» форсируем по setupOnly, не полагаясь на совпадение
            // continuationSignature с соседом (у настройки сырьё/намотка могут быть пустыми —
            // тогда сигнатура не совпала бы и значок пропал, хотя продолжение есть).
            if (isSetupTask) spans.toNext = true;
            // #3889: пробрасываем признаки дробления в контекст тайминга — модалка поясняет,
            // что резка продолжится (toNext) или продолжает вчерашнюю (fromPrev).
            var timingCtx = self._timingByCut[String(c.id)];
            if (timingCtx) {
                timingCtx.continuesNextDay = !!spans.toNext;
                timingCtx.continuesFromPrevDay = !!spans.fromPrev;
            }
            var spanBadges = [];
            // #4075: серый ЗНАЧОК обеда/перерыва — ЛЕВЕЕ значков смежности дня (←/→), в том же
            // углу справа внизу карточки. РАЗНЫЕ глифы, чтобы отличать без наведения: обед —
            // столовые приборы 🍴, перерыв — пауза ⏸. ︎ (текстовое представление) красит
            // глиф серым (монохром), а не цветным эмодзи. Вид и время — в data-tip: свой тултип
            // (.atex-pp-cut-break:hover::after), т.к. нативный title у значка в углу с
            // pointer-events:none капризен и не всплывал у заказчика. aria-label — для доступности.
            (breakMarkersByCut[String(c.id)] || []).forEach(function(bm) {
                var breakTip = bm.label + ' ' + formatClock(bm.startMin) + '-' + formatClock(bm.endMin);
                spanBadges.push(el('span', {
                    class: 'atex-pp-cut-break' + (bm.kind === 'lunch' ? ' is-lunch' : ''),
                    'aria-label': breakTip,
                    dataset: { tip: breakTip },
                    text: bm.kind === 'lunch' ? '🍴︎' : '⏸︎'
                }));
            });
            if (spans.fromPrev) spanBadges.push(el('span', {
                class: 'atex-pp-cut-span atex-pp-cut-span-prev',
                title: 'Начало задания — в предыдущем рабочем дне' + (c.orderId ? ' (заказ ' + c.orderId + ')' : ''),
                text: '←'
            }));
            if (spans.toNext) spanBadges.push(el('span', {
                class: 'atex-pp-cut-span atex-pp-cut-span-next',
                title: (isSetupTask
                    ? 'Только настройка станка — намотка продолжится в следующем рабочем дне'
                    : 'Задание продолжается в следующем рабочем дне') + (c.orderId ? ' (заказ ' + c.orderId + ')' : ''),
                text: '→'
            }));
            if (spanBadges.length) {
                cardPanel.appendChild(el('div', { class: 'atex-pp-cut-spans' }, spanBadges));
            }
            var lastOfDay = sc && (idx === activeGroup.cuts.length - 1 || (nextDay != null && nextDay !== myDay));
            if (lastOfDay) {
                var cl = cleanupByDay[myDay];
                if (cl) {
                    groupEl.appendChild(el('div', { class: 'atex-pp-cleanup',
                        text: '🧹 Уборка после смены · ' + formatClock(cl.startMin) + ' – ' + formatClock(cl.finishMin) +
                              ' · ' + cl.durationMin + ' мин' }));
                }
            }
        });
        // #3411: активный станок без совпадений по поиску — подсказка вместо пустоты
        // (счётчики на закладках подскажут, где совпадения есть).
        if (hasQuery && !groupEl.childNodes.length) {
            groupEl.appendChild(el('div', { class: 'atex-pp-empty', text: 'В этом станке нет позиций по запросу «' + query + '».' }));
        } else if (!groupEl.childNodes.length) {
            // #3788: отображаемая дата — выходной/праздник → красным «Выходной день» ПЕРЕД
            // «Заданий в очереди нет» (планирование такие дни пропускает).
            if (!self.dayIsWorking(planBaseMidnightMs)) {
                groupEl.appendChild(el('div', { class: 'atex-pp-dayoff-note', text: 'Выходной день' }));
            }
            // #3535: активный станок без резок в этот день — явная подсказка вместо пустоты.
            // #3787: если у станка есть отпуск(а), пересекающие отображаемую дату — дописываем
            // его детали: «Заданий в очереди нет, отпуск с … по …» (несколько — через запятую).
            var dtNote = downtimeRangeNote(
                (self.downtimesBySlitter || {})[String(activeGroup.slitter && activeGroup.slitter.id)],
                self.filter && self.filter.date, self.filter && self.filter.dateTo);
            groupEl.appendChild(el('div', { class: 'atex-pp-empty',
                text: 'Заданий в очереди нет' + (dtNote ? ', ' + dtNote : '') }));
        }
        // #3989 Фаза 3: панель качества плана — факт vs идеал переналадок за окно [С;По] (ТЗ §13).
        // Факт/идеал/комбинации/избыток панели — за окно [С;По] (#4013: идеал и комбинации тоже
        // по окну, иначе пустой день-выходной показывал «идеал 48 / избыток −48 / комбинаций 63»
        // от задач других дней). Всплывающая подсказка — за весь горизонт. Считается по всем
        // станкам. Не критична для очереди: ошибку глушим.
        if ((self.cuts || []).length) {
            try {
                var qFromStr = String((self.filter && self.filter.date) || '').trim();
                var qToStr = String((self.filter && self.filter.dateTo) || '').trim();
                var pqView = planQualityView(self.cuts, {
                    settings: self.daySettings,
                    scopeFromKey: qFromStr === '' ? null : planDateDayKey(qFromStr),
                    scopeToKey: qToStr === '' ? null : planDateDayKey(qToStr),
                    prevSetupBySlitter: self.prevSetupBySlitter
                });
                // #4013: панель — по ОКНУ [С;По] (факт, идеал ОКНА, комбинации ОКНА, избыток окна).
                var qW = pqView.window, qId = pqView.idealWindow, qEx = pqView.qualityWindow;
                var qPanel = el('div', { class: 'atex-pp-quality',
                    style: 'display:flex;gap:14px;flex-wrap:wrap;align-items:center;margin:6px 0;padding:6px 10px;'
                        + 'border:1px solid rgba(128,128,128,.3);border-radius:6px;font-size:13px;' }, [
                    el('span', { text: 'Качество плана', style: 'font-weight:600;' }),
                    // Число заданий ЗА ВЫБРАННЫЙ ПЕРИОД [С;По] (тот же оконный предикат, что у
                    // переналадок/сырья), а не весь план — иначе не совпадало с оконными метриками.
                    el('span', { text: 'всего заданий: ' + qW.taskCount, style: 'opacity:.75;' }),
                    el('span', { text: 'переналадки: ' + qW.changeoverCount + ' (' + qW.changeoverMin + ' мин)' }),
                    // #4008: раздельно наладка ножей и смена сырья (составляют переналадки выше).
                    el('span', { text: 'ножи: ' + qW.knifeCount + ' (' + qW.knifeMin + ' мин)', style: 'opacity:.85;' }),
                    // «Смены сырья» — число ПЕРЕЗАПРАВОК (materialChangeNeeded: смена вида сырья,
                    // намотки ИЛИ партии сырья), а не количество номенклатуры сырья. Метка была
                    // «сырьё» и читалась как «сколько сырья».
                    el('span', { text: 'смены сырья: ' + qW.materialCount + ' (' + qW.materialMin + ' мин)', style: 'opacity:.85;' }),
                    el('span', { text: 'идеал: ' + qId.count + ' (' + qId.minutes + ' мин)', style: 'opacity:.75;' }),
                    el('span', { text: 'избыток: ' + formatQualityDelta(qEx.excessCount) + ' (' + formatQualityDelta(qEx.excessMin) + ' мин)' }),
                    // #4008: сколько всего разных настроек резки (набор ножей + сырьё + намотка).
                    // #4013: по ОКНУ (combinationsWindow) — пустое окно даёт 0, а не диверсити всего плана.
                    el('span', { text: 'уникальных комбинаций: ' + pqView.combinationsWindow, style: 'opacity:.75;' })
                ]);
                qPanel.title = 'За весь горизонт [С; конец всех задач]: переналадки '
                    + pqView.all.changeoverCount + ' (' + pqView.all.changeoverMin + ' мин), из них ножи '
                    + pqView.all.knifeCount + ' (' + pqView.all.knifeMin + ' мин), смены сырья '
                    + pqView.all.materialCount + ' (' + pqView.all.materialMin + ' мин). '
                    + 'Идеал — каждая конфигурация ножей и каждое сырьё настраиваются по 1 разу. '
                    // #4013: подсказка о всём плане → комбинации всего плана (панель выше — по окну).
                    + 'Уникальных комбинаций во всём плане (набор ножей + сырьё + намотка): ' + pqView.combinations + '.';
                box.appendChild(qPanel);
            } catch (e) { console.warn('[pp] панель качества плана пропущена:', e && e.message); }
        }
        box.appendChild(groupEl);
        console.log('[pp] 📊 renderQueue: отрисовано за ' + (Date.now() - t0) + 'мс. групп:', groups.length, 'резок:', self.cuts.length);
        } finally {
            this._renderingQueue = false;
        }
    };

    AtexProductionPlanning.prototype.renderLink = function() {
        var self = this;
        var box = this.linkEl;
        box.innerHTML = '';
        var cut = this.cuts.filter(function(c) { return String(c.id) === String(this.selectedCutId); }, this)[0];

        if (!cut) {
            box.appendChild(el('div', { class: 'atex-pp-empty', text: 'Выберите задание в очереди, чтобы увидеть связанные позиции.' }));
            return;
        }

        // Связанные позиции резки (только список; добавление/резерв — вне этой панели).
        var linked = this.supplies.filter(function(s) { return String(s.cutId) === String(cut.id); });
        var listWrap = el('div', { class: 'atex-pp-linked' });
        listWrap.appendChild(el('h3', { class: 'atex-pp-linked-title', text: 'Связанные позиции (' + linked.length + ')' }));
        if (!linked.length) {
            listWrap.appendChild(el('div', { class: 'atex-pp-empty', text: 'Пока нет связей.' }));
        } else {
            var posById = {};
            this.positions.forEach(function(p) { posById[p.id] = p; });
            // #3892: метраж берём по ВСЕЙ резке (длина прогона = «Метраж, м», одинакова у всех
            // сегментов цепочки, #3781), а НЕ из «Метраж, м» обеспечения этого сегмента. У
            // переходящей (дроблёной) резки обеспечение делится по дням (splitSupplyShares), и
            // raw-метраж сегмента — бессмысленная дробь (напр. 348.496 вместо 450). cutRunLength
            // стартует с cut.length (head) и игнорирует делёные доли → реальная длина прогона.
            var cutRunLen = cutRunLength(cut, self.supplies, self.footageBySupply);
            linked.forEach(function(s) {
                // #3406 п.1: подпись + «Количество» позиции заказа + рулоны/метраж.
                var foot = cutRunLen > 0 ? cutRunLen : supplyFootage(s, self.footageBySupply);
                var label = formatLinkedPositionLabel(posById[s.positionId], s.positionId, s.rolls, foot, s.orderNo, s.positionWidth, s.positionLength);
                var children = [el('span', { class: 'atex-pp-linked-label', text: label })];
                var del = el('button', { class: 'atex-pp-linked-del', type: 'button', text: '×', title: 'Убрать из задания' });
                del.addEventListener('click', function() { self.deleteSupply(s.id); });
                children.push(del);
                listWrap.appendChild(el('div', { class: 'atex-pp-linked-item' }, children));
            });
        }
        box.appendChild(listWrap);
    };

    // ── Служебное ──

    AtexProductionPlanning.prototype.setBusy = function(on) {
        this.busy = on;
        if (this.root) this.root.classList.toggle('is-busy', !!on);
    };

    // Деактивирует кнопку «Сгенерировать резки» и показывает крутилку слева от неё
    // на время запросов preferable_widths (generateCuts, #3332) и самой генерации
    // (runGenerateCuts). По завершении/ошибке — возвращает кнопку и прячет крутилку.
    AtexProductionPlanning.prototype.setGenBusy = function(on) {
        if (this.genBtn) this.genBtn.disabled = !!on;
        if (this.genSpinner) this.genSpinner.style.display = on ? '' : 'none';
    };

    // Уведомления без alert/confirm/prompt (раздел 8 гайда): встроенный тост,
    // либо общий MainAppController, если он доступен в main.html.
    AtexProductionPlanning.prototype.notify = function(message, kind) {
        if (kind === 'error' && typeof window !== 'undefined' && window.mainAppController &&
            typeof window.mainAppController.showErrorModal === 'function') {
            window.mainAppController.showErrorModal(message);
            return;
        }
        var toast = el('div', { class: 'atex-pp-toast atex-pp-toast-' + (kind || 'info'), text: message });
        (this.toastHost || document.body).appendChild(toast);
        setTimeout(function() { toast.classList.add('is-visible'); }, 10);
        setTimeout(function() {
            toast.classList.remove('is-visible');
            setTimeout(function() { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 300);
        }, 3500);
    };

    // Окно прогресса длительной генерации резок (#3148). Модальный оверлей с
    // заголовком, полосой прогресса и счётчиком «N из M». Крепится к document.body,
    // чтобы не тускнеть под .atex-pp.is-busy (opacity .65) и быть поверх всего.
    // Без кнопок: операция неотменяема, окно — только индикатор хода.
    AtexProductionPlanning.prototype.showProgress = function(title, total) {
        this.hideProgress();
        this.progressTotal = Number(total) || 0;
        // #3865: total ≤ 0 → этап подготовки без счётчика, полоса «бежит» (is-indeterminate),
        // под ней показываем текст «что происходит» (updateProgress detail).
        var bar = el('div', { class: 'atex-pp-progress-bar' + (this.progressTotal > 0 ? '' : ' is-indeterminate') });
        var fill = el('div', { class: 'atex-pp-progress-fill' });
        bar.appendChild(fill);
        var counter = el('div', { class: 'atex-pp-progress-count', text: '' });
        var dialog = el('div', { class: 'atex-pp-progress-dialog' }, [
            el('div', { class: 'atex-pp-progress-title', text: title || 'Генерация заданий…' }),
            bar,
            counter
        ]);
        var overlay = el('div', { class: 'atex-pp-progress is-open' }, [dialog]);
        (document.body || this.root).appendChild(overlay);
        this.progressEl = overlay;
        this.progressFill = fill;
        this.progressCounter = counter;
        this.updateProgress(0);
    };

    // Обновить полосу/счётчик. done — сколько готово; detail — строка под полосой
    // (если не задана — «done из total»). Без открытого окна — ничего не делает.
    AtexProductionPlanning.prototype.updateProgress = function(done, detail) {
        if (!this.progressEl) return;
        var total = this.progressTotal || 0;
        var pct = planning.progressPercent(done, total);
        if (this.progressFill) this.progressFill.style.width = pct + '%';
        if (this.progressCounter) {
            this.progressCounter.textContent = detail != null
                ? detail
                : (total > 0 ? ((Number(done) || 0) + ' из ' + total + ' (' + pct + '%)') : '');
        }
    };

    AtexProductionPlanning.prototype.hideProgress = function() {
        if (this.progressEl && this.progressEl.parentNode) {
            this.progressEl.parentNode.removeChild(this.progressEl);
        }
        this.progressEl = null;
        this.progressFill = null;
        this.progressCounter = null;
        this.progressTotal = 0;
    };

    AtexProductionPlanning.prototype.fatal = function(message) {
        this.root.innerHTML = '';
        this.root.appendChild(el('div', { class: 'atex-pp-fatal', text: message }));
    };

    AtexProductionPlanning.prototype.start = function() {
        var self = this;
        this.root.innerHTML = '';
        var layout = el('div', { class: 'atex-pp-layout' });

        // Форма новой резки живёт в модалке (#3116 п.1), открывается кнопкой «+».
        this.formEl = el('section', { class: 'atex-pp-form', 'data-submit-scope': '' });

        // #3475: панель действий — под заголовком (.atex-pp-panel-head column в CSS).
        // Порядок: «Сгенерировать» (основная) → «Добавить вручную» (второстепенная) →
        // «Удалить» (warning, последняя). Названия укорочены, акценты переставлены.
        var queueActions = el('div', { class: 'atex-pp-panel-actions' });
        var genSpinner = el('span', { class: 'atex-pp-spinner atex-pp-gen-spinner', title: 'Идёт генерация заданий…' });
        genSpinner.style.display = 'none';
        // #3475: «Сгенерировать» — основная кнопка (atex-pp-btn-primary).
        var genBtn = el('button', { class: 'atex-pp-btn atex-pp-btn-primary atex-pp-gen-btn', type: 'button', text: 'Сгенерировать' });
        genBtn.addEventListener('click', function() { self.generateCuts(queueActions); });
        this.genBtn = genBtn;
        this.genSpinner = genSpinner;
        // «Сгенерировать резки» только создаёт резки для незапланированных позиций и
        // дописывает их в конец очереди (#3449); уже запланированные резки не трогает.
        // Перестановку очереди оператор делает вручную (↑↓).
        // #3475: «Добавить вручную» — второстепенная кнопка (без -primary).
        var addBtn = el('button', { class: 'atex-pp-btn atex-pp-add', type: 'button', text: 'Добавить вручную' });
        addBtn.addEventListener('click', function() { self.openForm(); });
        // #3783/#3785: «Упорядочить» — пересобрать очередь видимого диапазона в оптимальный
        // порядок (минимум переналадок: группировка сырья; при прочих равных больше полос
        // раньше). Перезаписывает ручной порядок (#3449) — поэтому через подтверждение.
        var orderBtn = el('button', { class: 'atex-pp-btn atex-pp-order-queue', type: 'button', text: 'Упорядочить',
            title: 'Пересобрать очередь: группировка по сырью, минимум переналадок (при прочих равных больше полос раньше)' });
        orderBtn.addEventListener('click', function() { self.optimizeQueue(queueActions); });
        // #3508 п.2: «Зафиксировать» — проставить флаг всем заданиям выбранного дня
        // (все станки). Между «Добавить вручную» и «Удалить».
        var fixBtn = el('button', { class: 'atex-pp-btn atex-pp-fix-day', type: 'button', text: 'Зафиксировать', title: 'Зафиксировать все задания этого дня' });
        fixBtn.addEventListener('click', function() { self.fixDayTasks(); });
        // #3475: «Удалить» (warning, жёлтая) — удаляет все задания выбранного дня:
        // сначала «Обеспечение» (снимаем ссылки на «Партии ГП»), затем «Производственную
        // резку» (BatchDelete каскадом снимет подчинённые Партии ГП/Полосы/Расход).
        var delBtn = el('button', { class: 'atex-pp-btn atex-pp-btn-warning atex-pp-del-day', type: 'button', text: 'Удалить' });
        delBtn.addEventListener('click', function() { self.deleteDayTasks(queueActions); });
        // #3764: «Отпуск {станок}» — правее «Удалить». Открывает редактор окон простоя активного
        // станка. Подпись/доступность/видимость проставляются в renderQueue (по активному станку
        // и наличию таблицы «Отпуск» в метаданных). До загрузки метаданных кнопка скрыта.
        var downtimeBtn = el('button', { class: 'atex-pp-btn atex-pp-dt-btn', type: 'button', text: 'Отпуск', title: 'Окна простоя станка (ТО и т.п.) — автогенерация их пропускает' });
        downtimeBtn.style.display = 'none';
        downtimeBtn.addEventListener('click', function() { self.openDowntime(); });
        this.downtimeBtn = downtimeBtn;
        queueActions.appendChild(genSpinner);
        queueActions.appendChild(genBtn);
        queueActions.appendChild(addBtn);
        queueActions.appendChild(orderBtn);
        queueActions.appendChild(fixBtn);
        queueActions.appendChild(delBtn);
        queueActions.appendChild(downtimeBtn);
        var queueHead = el('div', { class: 'atex-pp-panel-head' }, [
            el('h2', { class: 'atex-pp-form-title', text: 'Очередь заданий по станкам' }),
            queueActions
        ]);
        var queueWrap = el('section', { class: 'atex-pp-panel atex-pp-queue-panel' }, [queueHead]);
        this.queueEl = el('div', { class: 'atex-pp-queue' });
        queueWrap.appendChild(this.queueEl);
        this.linkEl = el('section', { class: 'atex-pp-panel atex-pp-link' });
        layout.appendChild(queueWrap);
        layout.appendChild(this.linkEl);
        this.root.appendChild(layout);

        // Модалка формы: оверлей + диалог с крестиком; закрытие по ×/оверлею/Esc.
        var dialog = el('div', { class: 'atex-pp-modal-dialog' });
        var closeX = el('button', { class: 'atex-pp-modal-close', type: 'button', text: '×', title: 'Закрыть' });
        closeX.addEventListener('click', function() { self.closeForm(); });
        dialog.appendChild(closeX);
        dialog.appendChild(this.formEl);
        this.modalEl = el('div', { class: 'atex-pp-modal' }, [dialog]);
        this.modalEl.addEventListener('click', function(e) { if (e.target === self.modalEl) self.closeForm(); });
        this.root.appendChild(this.modalEl);

        var timingTitle = el('h2', { class: 'atex-pp-form-title', text: 'Тайминг резки' });
        var timingBody = el('pre', { class: 'atex-pp-timing-body', text: '' });
        var timingDialog = el('div', { class: 'atex-pp-modal-dialog atex-pp-timing-dialog' });
        var timingClose = el('button', { class: 'atex-pp-modal-close', type: 'button', text: '×', title: 'Закрыть' });
        timingClose.addEventListener('click', function() { self.closeCutTiming(); });
        timingDialog.appendChild(timingClose);
        timingDialog.appendChild(timingTitle);
        timingDialog.appendChild(timingBody);
        this.timingModalTitleEl = timingTitle;
        this.timingModalBodyEl = timingBody;
        this.timingModalEl = el('div', { class: 'atex-pp-modal atex-pp-timing-modal' }, [timingDialog]);
        this.timingModalEl.addEventListener('click', function(e) { if (e.target === self.timingModalEl) self.closeCutTiming(); });
        this.root.appendChild(this.timingModalEl);

        // #3764/#3844: модалка «Отпуск» (окна простоя станка) — заголовок, редактируемая
        // таблица, кнопка «+ Отпуск» и «ОК»/«×» для закрытия. Скаффолд — buildDowntimeModal.
        this.buildDowntimeModal();

        if (typeof document !== 'undefined') {
            document.addEventListener('keydown', function(e) {
                if (e.key !== 'Escape' && e.keyCode !== 27) return;
                if (self.downtimeModalEl && self.downtimeModalEl.classList.contains('is-open')) {
                    self.closeDowntime();
                    return;
                }
                if (self.timingModalEl && self.timingModalEl.classList.contains('is-open')) {
                    self.closeCutTiming();
                    return;
                }
                if (self.modalEl && self.modalEl.classList.contains('is-open')) self.closeForm();
            });
        }
        this.toastHost = this.root;

        this.queueEl.appendChild(el('div', { class: 'atex-pp-loading', text: 'Загрузка…' }));

        return this.loadMetadata()
            .then(function() {
                return Promise.all([
                    self.loadSlittersWithStop().then(function(items) {
                        self.slitters = items;
                        // #3764: окна простоя после станков. #3862: заправку станков (prev_cut_setup)
                        // грузим ПОСЛЕ списка станков — по каждому свой фильтрованный запрос.
                        return Promise.all([self.loadDowntimes(), self.loadPrevCutSetup()]);
                    }),
                    self.loadMaterialBatches(),
                    self.loadMaxStock(),   // #3391: целесообразные к хранению номенклатуры (склад vs отход)
                    self.loadLeaders(),    // #3569: справочник «Лидер» — резолв метки лидера позиции в id для задания
                    self.loadPositions(),  // заполняет genPositions (с dueKey) тоже
                    // #3445: loadStockBalance после loadGenBatches — нужен batchMaterialById (сырьё резки).
                    self.loadGenBatches().then(function() { return self.loadStockBalance(); }),
                    self.loadJumboWidths(),// ширина джамбо по сырью (для cut-layout)
                    self.loadOperationTimes(), // времена переналадок (веса очереди)
                    self.loadDaySettings(),    // DAY_START_HOUR/DAY_END_HOUR для рабочего окна
                    self.loadCalendar(),       // #3788: праздничные/рабочие дни (пропуск выходных при планировании)
                    self.loadSupplyFootage(),  // метраж обеспечений (длительность/расписание)
                    self.loadConsumption(),    // расход сырья (FIFO-резерв, Фаза 1b)
                    self.loadSleeveBatches(),  // #3340: партии втулок «в работе» (FIFO) + втулкорез TC-20
                    self.loadActualWidths(),   // #3372: справочник фактической ширины резки (66190)
                    self.loadSleeveInches(),   // #3372: дюймы втулки по записи 8188 (контекст условия)
                    self.loadSleeveWidths(),   // #3812: ширина втулки (мм) по записи (57/110) — втулочные полосы
                    // #3862: loadPrevCutSetup перенесён в цепочку после loadSlittersWithStop (нужен список станков).
                    // Полосы перед очередью: knifeCount/knifeWidths вливаются в резки в loadPlanning.
                    self.loadCutStrips().then(function() { return self.loadPlanning(); })
                ]);
            })
            // #3372: фактическая ширина резки — после загрузки позиций/ширин джамбо/справочников.
            .then(function() { self.annotatePositionsCutWidth(); self.resolveCutMaterials(); self.render(); })
            .catch(function(err) { self.fatal('Ошибка инициализации: ' + err.message); });
    };

    function init() {
        if (typeof document === 'undefined') return;
        var root = document.getElementById('atex-production-planning');
        if (!root || root.dataset.initialized === '1') return;
        root.dataset.initialized = '1';
        console.log('[pp] 🟢 init: запуск production-planning, db=', (root.getAttribute('data-db') || '?'));
        var controller = new AtexProductionPlanning(root);
        root._atexProductionPlanning = controller;
        // #3638: deep-link из cut-gantt (?cut=..&date=..&slitter=..) — после загрузки
        // данных открыть очередь на нужном дне/станке и подсветить задание.
        var deepLink = (typeof window !== 'undefined' && window.location)
            ? parseDeepLink(window.location.search) : null;
        var started = controller.start();
        if (deepLink && (deepLink.cut || deepLink.date || deepLink.slitter) && started && typeof started.then === 'function') {
            started.then(function() { controller.applyDeepLink(deepLink); });
        }
    }

    return { planning: planning, Controller: AtexProductionPlanning, init: init };
});

 
 
// @version 2026-07-07-break-marker-4075
