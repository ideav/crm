    var planning = {
        // Реестр жёстких правил ТЗ §15 и страж записи (05-invariants.js) — наружу для тестов:
        // experiments/atex-pp-invariants.test.js проверяет их таблицей «входы × правила».
        invariants: PP_INVARIANTS,
        checkPlanInvariants: checkPlanInvariants,
        guardPlanOps: guardPlanOps,
        // #4515: страж по произвольному набору правил — этим тест проверяет, что отбрасывание
        // работает для ЛЮБОГО правила с `mode: 'drop'`, а не только для заморозки.
        guardPlanOpsWith: guardPlanOpsWith,
        // #4536: баланс работы задания по операциям плана — по нему страж держит целостность
        // разорванного по дням задания (проверяется тестом `atex-pp-4536-supply-conservation`).
        planWorkBalanceByChain: planWorkBalanceByChain,
        // #4618: свидетель журнала — Σ проходов цепочки ДО и ПОСЛЕ операций. Чистая, поэтому
        // проверяется тестом `atex-pp-4618-journal-balance.test.js` без сети и без базы.
        journalChainBalance: journalChainBalance,
        formatPlanAuditMessage: formatPlanAuditMessage,   // #4475: нарушение стража → фраза оператору
        formatOverfilledDaysMessage: formatOverfilledDaysMessage,   // #4531: переполненный станко-день → фраза оператору
        overfilledDaysFromCuts: overfilledDaysFromCuts,   // #4531: мерка переполнения дня (одна на тост и подсветку)
        overfilledDayPhrase: overfilledDayPhrase,         // #4531: один переполненный день фразой
        cutShortLabel: cutShortLabel,                   // #4531: задание одной строкой (как первая строка карточки)
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
        clonePlanningCut: clonePlanningCut,     // #4402
        projectPlanOnCuts: projectPlanOnCuts,   // #4402: проекция плана «Упорядочить» на очередь (предпросмотр без записи)
        planChangeRows: planChangeRows,         // #4417: что поменялось у каждого задания (модалка «Детали» + пометка карточек)
        slitterTabIndexMap: slitterTabIndexMap, // #4444: станок → порядковый номер закладки
        planChangeStation: planChangeStation,   // #4444: колонка «станок» списка «Деталей» (3 или 3 → 5)
        planChangeSummary: planChangeSummary,   // #4417: короткая подпись изменения («старт · станок · тайминг»)
        setupMismatchRows: setupMismatchRows,       // #4479: что разошлось у каждого задания (бейджи очереди)
        setupMismatchSummary: setupMismatchSummary, // #4479: суть отклонения на бейдже («наладка · старт»)
        setupMismatchTitle: setupMismatchTitle,     // #4479: детали отклонения в подсказке бейджа
        formatPlanStamp: formatPlanStamp,       // #4409/#4417: unix-секунды → «ДД.ММ ЧЧ:ММ»
        planStartDayKey: planStartDayKey,       // #4518: unix-секунды → YYYYMMDD (день старта)
        isPreviewCutId: isPreviewCutId,         // #4402
        groupBySlitter: groupBySlitter,
        mergeStationTabs: mergeStationTabs,
        filterCuts: filterCuts,
        cutSearchHaystack: cutSearchHaystack,
        cutMatchesQuery: cutMatchesQuery,
        isCutVisible: isCutVisible,
        planDateIso: planDateIso,                             // #4398
        searchMatchesOutsideRange: searchMatchesOutsideRange, // #4398: совпадения поиска вне диапазона дат
        expandRangeToInclude: expandRangeToInclude,           // #4398
        dayDeletionTargets: dayDeletionTargets,
        formatPlanDayLabel: formatPlanDayLabel,
        formatPlanDayRangeLabel: formatPlanDayRangeLabel,   // #3622
        cutFulfillmentIds: cutFulfillmentIds,             // #3691
        extractApiError: extractApiError,
        planDateDayKey: planDateDayKey,
        dayKeyToDate: dayKeyToDate,             // #3769
        formatDayKey: formatDayKey,             // #3769
        dueColorClass: dueColorClass,           // #3769
        cutDueKeys: cutDueKeys,                 // #3769
        cutOrderedWidthKeys: cutOrderedWidthKeys, // #4230: ширины полос, идущих в заказ (остальное — склад/отходы)
        supplyHostCutId: supplyHostCutId,        // #4434 п.4: связи продолжения читаются по ГОЛОВЕ цепочки
        toastStackLayout: toastStackLayout,      // #4442: стопка тостов — новое чуть выше старого
        countOverdueCuts: countOverdueCuts,     // #4161: число просроченных заданий (панель качества)
        planTsSeconds: planTsSeconds,           // #4346: «Дата план»/«Закончено» → unix-секунды
        cutIsStarted: cutIsStarted,             // #4381: задание начато («Начато» заполнено) — неприкосновенно
        deviationGroups: deviationGroups,       // #4346: отклонения факта от плана (кнопка «Отклонения N/M»)
        deviationSettlePlan: deviationSettlePlan, // #4346/#4564: «Урегулировать» — переносы + разделения
        rowsToShiftEvents: rowsToShiftEvents,     // #4596: строки slitter_shift_events → события открытия/закрытия смены
        shiftClosedSlitters: shiftClosedSlitters, // #4596: станки, закрывшие смену в дне → { id: штамп закрытия }
        dayIsOverForSlitter: dayIsOverForSlitter, // #4596: день для станка кончился (прошёл или смена закрыта)
        cutDoneRuns: cutDoneRuns,               // #4564: сделано проходов («Кол-во резок факт»); null = не знаем
        settleMoveScope: settleMoveScope,       // #4574: рамки пересборки после «Урегулировать»
        dayOffsetFromBase: dayOffsetFromBase,   // #3652
        dayKeyFromOffset: dayKeyFromOffset,     // #4085: индекс дня → YYYYMMDD (placementDayKey слоя размещения)
        formatPlanDayHeading: formatPlanDayHeading,
        slitterQueueSignature: slitterQueueSignature,   // #4401
        insertDayIso: insertDayIso,   // #4396
        buildFields: buildFields,
        runWithConcurrency: runWithConcurrency,   // #3998: пул сохранений с лимитом потоков
        MAX_PARALLEL_WRITES: MAX_PARALLEL_WRITES, // #4477: единый предел потоков массовой записи (ТЗ §15)
        changedStartWrites: changedStartWrites,   // #4477: отсев записей-пустышек «Времени старта»
        maxNumericCutNumber: maxNumericCutNumber,
        nextCutMainValue: nextCutMainValue,
        splitMachineQueue: splitMachineQueue,
        underfilledLayoutDays: underfilledLayoutDays,   // #4469: недоупакованные станко-дни раскладки (ТЗ §15)
        scheduleStartTimestamp: scheduleStartTimestamp,
        downtimeBlockedRanges: downtimeBlockedRanges,             // #3764
        downtimeConflictCuts: downtimeConflictCuts,               // #4413: задания, стоящие в окне «Отпуска»
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
        mergeableOrderGroups: mergeableOrderGroups,   // #4424: задания одного заказа+конфигурации → объединить по первому
        daySplitBadges: daySplitBadges,
        daySplitWarning: daySplitWarning,   // #4304: плашка «разорвано по дням» (просрочено ИЛИ зафиксировано)
        daySplitChainNote: daySplitChainNote,   // #4617: «проходов 1 из 5 · остальные 4 → 07.08»
        boundaryDaySibling: boundaryDaySibling,   // #3737
        mergeContinuationChains: mergeContinuationChains,
        chainRecordIdsForCut: chainRecordIdsForCut,     // #4292: цепочка дробления (голова + продолжения) для удаления
        splitChainPartsOf: splitChainPartsOf,           // #4488: части задания, разорванного по дням
        dayQueueOf: dayQueueOf,                         // #4488: очередь дня задания (после сшивания частей)
        cutsBeforeWindowToKeep: cutsBeforeWindowToKeep, // #4294: задания прошлых дней (раньше «С») — не пере-планировать
        excludedCutBlockedRanges: excludedCutBlockedRanges, // #4434 п.2: время станка под исключённые из раскладки задания
        prevSetupBeforeWindow: prevSetupBeforeWindow,   // #4300/#4312: заправка станка из его последнего задания раньше «С» (нет дыры после первого задания)
        longVacationDayRanges: longVacationDayRanges,   // #4314: длинные окна «Отпуска» (дни от «С») — сбрасывают наладку
        setupResetByVacation: setupResetByVacation,     // #4314: стоял ли длинный отпуск между двумя днями
        setupResetCutIds: setupResetCutIds,             // #4314: задания, которым наладка считается с нуля (после отпуска)
        planCutOperations: planCutOperations,
        filterChangedUpdates: filterChangedUpdates,     // #4108: отбор изменившихся апдейтов (planStart/проходы/станок)
        planWeight: planWeight,                         // #3989: вес штрафа из «Настройки» (ATEH)
        stripPrefixQuality: stripPrefixQuality,         // #3989: «качество» перехода по ножам
        transitionCost: transitionCost,                 // #3989: стоимость перехода prev→next (вес+качество)
        insertionCost: insertionCost,                   // #3989: стоимость вставки слота между prev и next
        // #4085: слой размещения (модель #3985) — перебор всех точек вставки по мин. штрафу + релокация
        slotFromCut: slotFromCut, vacationSlot: vacationSlot, seedOccupancy: seedOccupancy,
        prefixDayOffset: prefixDayOffset, canInsertAt: canInsertAt, scorePosition: scorePosition,
        positionAllowed: positionAllowed,               // #4556: жёсткие правила §15 точки вставки — один предикат на все проходы
        placeSlot: placeSlot, placeAllSlots: placeAllSlots, relocatePass: relocatePass,
        relocateOverdueReal: relocateOverdueReal,                  // #4118: доп. проход по РЕАЛЬНЫМ дням
        slotOrderByMachine: slotOrderByMachine, computeSlotPlacement: computeSlotPlacement,
        assignmentFromOccupancy: assignmentFromOccupancy,          // #4095: cutId→станок/порядок из занятости
        formatSlotPlacementTrace: formatSlotPlacementTrace,        // #4095: структурный trace размещения → строки лога
        formatPlacementDecisionTitle: formatPlacementDecisionTitle, // #4462: история решения одного задания → подсказка карточки
        placementTitlesByCut: placementTitlesByCut,                 // #4462: разбор → cutId→подсказка (только тронутые планом)
        slotTraceOn: slotTraceOn,                                  // #4095: трассировка слоя размещения включена?
        planQuality: planQuality,                       // #3989: факт vs идеал переналадок (ТЗ §13)
        planQualityView: planQualityView,               // #3989 Фаза 3: качество из cuts контроллера
        chooseOptimizeCandidate: chooseOptimizeCandidate,   // #4047: гарантия «Упорядочить» не увеличивает переналадку
        formatOptimizeTrace: formatOptimizeTrace,           // #4409: структурный trace «Упорядочить» → строки лога
        planChangeTitle: planChangeTitle,                   // #4417: «было → стало» одного задания (подсказка карточки)
        planChangeRest: planChangeRest,                     // #4417: то же без старта — колонка «Деталей»
        optTraceOn: optTraceOn,                             // #4409: трассировка «Упорядочить» включена?
        formatQualityDelta: formatQualityDelta,          // #3989 Фаза 3: подпись избытка
        splitSupplyShares: splitSupplyShares,
        addMainValueField: addMainValueField,
        cutWriteDiagnostics: cutWriteDiagnostics,
        cutCreateRequiredKeys: cutCreateRequiredKeys,   // #3851
        cutGenerationTimingDiagnostics: cutGenerationTimingDiagnostics,
        buildSupplyFieldsForFinishedBatch: buildSupplyFieldsForFinishedBatch,
        buildFinishedBatchFields: buildFinishedBatchFields,
        finishedBatchRolls: finishedBatchRolls,
        batchOrderId: batchOrderId,
        layoutPositionGroups: layoutPositionGroups,
        rowsToPlanning: rowsToPlanning,
        cutPlanningReportDiagnostics: cutPlanningReportDiagnostics,
        supplyRollsReportDiagnostic: supplyRollsReportDiagnostic,   // #4536: отчёт не отдаёт количество обеспечения
        stripsByFinishedBatch: stripsByFinishedBatch,               // #4536: полос за проход по «Партии ГП»
        rowsToPositions: rowsToPositions,
        positionDimensionsLabel: positionDimensionsLabel,
        remainingRollsForPosition: remainingRollsForPosition,
        suppliedRollsForPosition: suppliedRollsForPosition,         // #4536: покрытие позиции (в т.ч. по выпуску)
        producedRollsByPosition: producedRollsByPosition,           // #4536: выпуск позиции = полосы × проходы
        formatLinkedPositionLabel: formatLinkedPositionLabel,
        stripSupplyRolls: stripSupplyRolls,
        cutPositionFit: cutPositionFit,                 // #4426/#4428: годится ли позиция для добавления в задание
        planCutPositionFill: planCutPositionFill,       // #4426/#4428: добор полос задания позициями своих заказов
        newStripCount: newStripCount,                   // #4428: сколько новых полос режем в остаток джамбо
        siblingStripReserveMm: siblingStripReserveMm,   // #4428: ширина, отложенная под другие позиции заказа
        planPassesUpdates: planPassesUpdates,           // #4428: пересчёт партий/обеспечений под новые проходы
        rowsToGenPositions: rowsToGenPositions,
        preferredWidthsKey: preferredWidthsKey,
        groupPositionsByPlanningProfile: groupPositionsByPlanningProfile,
        positionLengthMap: positionLengthMap,
        batchDateKey: batchDateKey,
        formatCutNumber: formatCutNumber,
        rowsToBatches: rowsToBatches,
        DEFAULT_OP_TIMES: DEFAULT_OP_TIMES,
        FATIGUE_MACHINE_WIDTH_MM: FATIGUE_MACHINE_WIDTH_MM,
        FATIGUE_FACTOR: FATIGUE_FACTOR,
        FATIGUE_START_COST_MIN: FATIGUE_START_COST_MIN,
        PLANNING_STRATEGY_SETUP: PLANNING_STRATEGY_SETUP,
        PLANNING_STRATEGY_FATIGUE: PLANNING_STRATEGY_FATIGUE,
        normWinding: normWinding,
        knifeMoves: knifeMoves,
        changeoverParts: changeoverParts,
        changeoverCost: changeoverCost,
        carryOverPrevCut: carryOverPrevCut,       // #3688
        firstSetupParts: firstSetupParts,
        firstSetupCost: firstSetupCost,
        setupBreakdown: setupBreakdown,
        setupActivityMinutes: setupActivityMinutes,   // #3698
        minOverlapTailSetupMinutes: minOverlapTailSetupMinutes,   // #3760
        chooseTailSetupSubset: chooseTailSetupSubset,   // #4144: единое правило хвоста дня (упаковщик + колонки)
        splitTailSetupAtCeiling: splitTailSetupAtCeiling,   // #4111: раскладка наладки хвоста дня по потолку нахлёста
        setupActivityColumns: setupActivityColumns,   // #3698
        formatEmptySetupIds: formatEmptySetupIds,     // #4188: трасса «где именно пусто»
        planningStrategy: planningStrategy,
        planningStrategyLabel: planningStrategyLabel,
        makePlanningOptions: makePlanningOptions,
        estimatedKnifeCount: estimatedKnifeCount,
        fatiguePositionWeight: fatiguePositionWeight,
        fatigueRouteScore: fatigueRouteScore,
        fatigueAwareSequence: fatigueAwareSequence,
        greedySequence: greedySequence,
        orderCuts: orderCuts,
        cutConfigSig: cutConfigSig,                   // #4139
        resequenceWithinDays: resequenceWithinDays,   // #4139
        clusterMaterialWithinKnifeBlocks: clusterMaterialWithinKnifeBlocks,   // #4184
        orderedChangeoverCost: orderedChangeoverCost,
        bestExistingTransitionCost: bestExistingTransitionCost,
        chooseSlitterBySetup: chooseSlitterBySetup,
        rebalanceSlitterLoad: rebalanceSlitterLoad,   // #3848: выравнивание загрузки станков
        computeSlitterReassignment: computeSlitterReassignment,   // #4001: пере-выбор станка для существующих резок
        knifeWidthSig: knifeWidthSig,   // #3666
        planMoveSequences: planMoveSequences,   // #3602/#3923
        planMoveStarts: planMoveStarts,         // #4477: плейсхолдер-старты переноса — только вставляемому
        planDragReorder: planDragReorder,       // #4306: перестановка задания внутри дня перетаскиванием
        supplyCoverageKind: supplyCoverageKind,
        uncoveredPositions: uncoveredPositions,
        nextSequenceForCuts: nextSequenceForCuts,
        pickBatchFIFO: pickBatchFIFO,
        pickBatchFIFOForRun: pickBatchFIFOForRun,
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
        producedBatchesForLayout: producedBatchesForLayout,
        supplyPlanForLayout: supplyPlanForLayout,
        positionSleeveTasksForLayout: positionSleeveTasksForLayout,
        // #4631: каким обязан быть набор «Задач на втулки» позиции — чистое правило,
        // проверяется `experiments/atex-pp-4631-sleeve-dedup.test.js` без сети и базы.
        planSleeveTaskReconcile: planSleeveTaskReconcile,
        pickSleeveBatchId: pickSleeveBatchId,
        sleeveMinutes: sleeveMinutes,
        cutMissingBatch: cutMissingBatch,
        supplyFootage: supplyFootage,
        cutRunLength: cutRunLength,
        reserveFifo: reserveFifo,
        fifoBatchesForMaterial: fifoBatchesForMaterial,
        materialByCut: materialByCut,
        healContinuationMaterials: healContinuationMaterials,   // #3808
        healCutBatches: healCutBatches,   // #4452: «Партия сырья» задания (ТЗ §15, CUT_BATCH)
        windingPointsFromTimes: windingPointsFromTimes,
        foilWindingPointsFromTimes: foilWindingPointsFromTimes,
        foilWindingMinutes: foilWindingMinutes,   // #3742
        realFixedDayLost: realFixedDayLost,       // #4525: сдвиг 🔒 — только из ЗАПИСЫВАЕМОГО плана
        narrowWindingTiersFromTimes: narrowWindingTiersFromTimes,   // #4501: ярусы узкой намотки
        minStripWidthOfCut: minStripWidthOfCut,                     // #4501
        normalizeOperationTimes: normalizeOperationTimes,           // #4501: «Код операции» + колонка «Код»
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
        dayCeilingMin: dayCeilingMin,                   // #4563: ЕДИНСТВЕННЫЙ потолок дня (cutEnd + нахлёст по виду)
        dayCapacityMinutes: dayCapacityMinutes,         // #4563: и ёмкость дня из него же
        resolveOverworkLimits: resolveOverworkLimits,     // #3992: лимиты захлёста (ключи _MN)
        resolveDayDurationMin: resolveDayDurationMin,     // #3989 Фаза 2: DAY_DURATION_MN
        intraDayBreaks: intraDayBreaks,                   // #3989 Фаза 2: обед + два перерыва (ТЗ §5)
        buildSchedule: buildSchedule,
        snapWindowStartsWholeMinutes: snapWindowStartsWholeMinutes,   // #4061: снап planStart к целым минутам (= сумма колонок)
        dayLayoutGaps: dayLayoutGaps,                     // #4408: зазоры дня и чем они объяснены
        dayLayoutIsSound: dayLayoutIsSound,               // #4408: день без дыр и нахлёстов
        repackDayWindowStarts: repackDayWindowStarts,     // #4408: честная пересборка стартов ВНУТРИ дня
        scheduleFromStored: scheduleFromStored,   // #3846: показ из сохранённого плана (без live-пересчёта)
        computeQueueBreakMarkers: computeQueueBreakMarkers,   // #4075: значки обеда/перерывов + сдвиг очереди
        freeSlotFromStoredQueue: freeSlotFromStoredQueue,   // #4416: окно новой резки по СОХРАНЁННОМУ плану
        dayCleanups: dayCleanups,
        formatClock: formatClock,
        formatCutStartTitle: formatCutStartTitle,
        cutStartWindowMin: cutStartWindowMin,
        formatScheduleLine: formatScheduleLine,
        formatSetupScheduleLine: formatSetupScheduleLine,   // #4121: окно карточки настройки (0 проходов)
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
        // #4618: имя диспетчера — в журнал расследования плана. Шаблон отдаёт его в data-user
        // (`{_global_.user}`) с самого начала, читать его до сих пор было некому.
        this.userName = root.getAttribute('data-user') || '';
        this.meta = {
            cut: null,
            supply: null,
            slitter: null,
            materialBatch: null,
            strip: null,
            finishedBatch: null,
            sleeveTask: null,
            settings: null,
            downtime: null,       // #3764: подчинённая «Отпуск» (окна простоя станка)
            calendar: null,       // #3788: «Календарь» (исключения выходных/праздников)
            freeze: null          // #4326: «Заморозка» (замок дня — планирование не трогает эти дни)
        };
        this.downtimesBySlitter = {};  // #3764: карта slitterId → [{ id, start, end, notes }] (start/end — unix-сек)
        this.calendarByDay = {};       // #3788: карта ГГГГММДД → 'Праздничный день'|'Рабочий день' (исключения календаря)
        this.freezeByDay = {};         // #4326: карта ГГГГММДД → { id, notes } (замороженные дни «Заморозка»)
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
        this.positionLengthById = {};   // #4301: { positionId: «Длина, м» } — источник истины длины прогона (cutRunLength)
        this.genBatches = [];      // [{ id, materialId, dateKey, remainder }]
        this.stripAgg = {};        // карта cutId → { knifeCount, knifeWidths } (отчёт cut_strips)
        this.jumboWidthByMaterial = {}; // карта materialId → ширина джамбо «Вид сырья» («Ширина, мм» — геометрия реза)
        this.nominalWidthByMaterial = {}; // #3686: materialId → «Номинальная ширина» (рулон) для условий j= фактической ширины
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
        this._placementByCut = {};  // #4462: история выбора места (варианты/альтернативы/веса) → title карточки
        this.daySettings = {};      // DAY_START_HOUR/DAY_END_HOUR из таблицы «Настройка»
        this._lastCutPlanningDiagnosticKey = '';
        // #4306: ожидающий подтверждения предпросмотр «Пересчитать наладку» — { slitterId, ops,
        // before, after }. Пока не null: очередь показывает статистику до/после + кнопки «Ок» /
        // «Отменить пересчет». Пересчёт НЕ пишет в БД до «Ок» (по «Отменить» БД не тронута).
        this._dragCut = null;       // #4306: состояние drag-перетаскивания задания внутри дня
        // #4402: предпросмотр «Упорядочить» — { ops, reassign, before, after, lateBefore, lateAfter,
        // snapshot, tailSetup, createdIds }. Пока не null: очередь ПОКАЗЫВАЕТ новый план (проекция в
        // памяти, карточки перерисованы), но в БД он НЕ записан — сверху висит липкая панель со
        // статистикой и кнопками «Применить» / «Отменить». Отмена и F5 возвращают прежний план.
        this._pendingPlan = null;
    }

    AtexProductionPlanning.prototype.blankDraft = function() {
        // #4396: insertDate («ГГГГ-ММ-ДД») — день, в который диспетчер вставляет задание. Пусто =
        // как раньше (ближайшее свободное окно, конец очереди станка); указан — ОБЯЗАТЕЛЕН.
        // `active` из черновика убран вместе с галкой «В работе» (25.07.2026): значение не пишем.
        return { positionId: '', qty: '', footage: '', slitterId: '', materialBatchId: '', plannedRuns: '1', planDate: '', insertDate: '', status: CUT_STATUSES[0], notes: '', selectedPositions: [], prospect: null };
    };

    AtexProductionPlanning.prototype.url = function(path) {
        return '/' + encodeURIComponent(this.db) + '/' + path;
    };

    // #4177: ПОДРОБНАЯ ТРАССА КАЖДОГО СЕРВЕРНОГО ИЗМЕНЕНИЯ. Все POST в этом рабочем месте —
    // команды `_m_*` (создание/правка/удаление); чтения идут через getJson и НЕ трассируются.
    // По каждому запросу-изменению печатаем: № по порядку, операцию (NEW/SAVE/SET/DEL), таблицу,
    // up= (родитель), ВСЕ поля payload (кроме _xsrf), текущую операцию (_ppOp) и цепочку вызвавших
    // функций из стека — чтобы источник ЛЮБОЙ записи (в т.ч. резки-сироты «нет связей») читался в
    // консоли без догадок; на ответе — созданный id, на отказе — код и текст ошибки.
    var _ppWriteSeq = 0;

    // #4477/#4480: ЖЁСТКИЙ ПОТОЛОК ОДНОВРЕМЕННЫХ ЗАПИСЕЙ — в ЕДИНСТВЕННОЙ точке, через которую
    // проходят ВСЕ команды `_m_*` (post ниже). `runWithConcurrency` остаётся планировщиком фазы,
    // но правило «не больше MAX_PARALLEL_WRITES одновременно» держит семафор: только так его
    // соблюдают и ВЛОЖЕННЫЕ пулы (фаза creates разбиения — пул сегментов внутри пула цепочек),
    // иначе пятёрка пулов по пять дала бы 25 запросов разом.
    // Слот занимается ПЕРЕД отправкой и освобождается на ответе (успех или отказ). Взаимной
    // блокировки нет: запрос, держащий слот, не ждёт другого запроса — цепочка `post → then → post`
    // освобождает слот до захвата следующего.
    var _ppWriteSlots = 0, _ppWriteWaiting = [];
    function ppAcquireWriteSlot() {
        if (_ppWriteSlots < MAX_PARALLEL_WRITES) { _ppWriteSlots += 1; return Promise.resolve(); }
        return new Promise(function(resolve) { _ppWriteWaiting.push(resolve); });
    }
    function ppReleaseWriteSlot() {
        var next = _ppWriteWaiting.shift();
        if (next) next();            // слот передаём ожидающему напрямую — счётчик не трогаем
        else if (_ppWriteSlots > 0) _ppWriteSlots -= 1;
    }

    function ppWriteKind(path) {
        var m = /_m_(\w+)\/([^?]*)/.exec(String(path == null ? '' : path));
        if (m) return { op: m[1], target: decodeURIComponent(m[2]) };
        return { op: 'post', target: String(path == null ? '' : path).split('?')[0] };
    }
    function ppWriteUp(path) {
        var m = /[?&]up=([^&]*)/.exec(String(path == null ? '' : path));
        return m ? decodeURIComponent(m[1]) : '';
    }
    function ppWriteCallers(limit) {
        try {
            var st = (new Error()).stack;
            if (!st) return [];
            var lines = String(st).split('\n');
            var out = [];
            for (var i = 0; i < lines.length && out.length < (limit || 8); i++) {
                var s = lines[i].replace(/^\s+/, '');
                if (s.indexOf('at ') !== 0 && s.indexOf('@') < 0) continue;   // только кадры стека
                var fn = /at\s+([^\s(]+)/.exec(s) || /^([^@\s]+)@/.exec(s);
                var name = fn ? fn[1] : s.slice(0, 80);
                if (/(^|\.)(post|tracePpWrite|ppWriteCallers)$/.test(name)) continue;   // сами обёртки трассы/post()
                out.push(name);
            }
            return out;
        } catch (e) { return []; }
    }
    function tracePpWrite(path, params, ctx) {
        var kind = ppWriteKind(path);
        var seq = ++_ppWriteSeq;
        var up = ppWriteUp(path);
        var op = (ctx && ctx._ppOp) ? ctx._ppOp : '?';
        var fields = {};
        Object.keys(params || {}).forEach(function(k) {
            if (k === '_xsrf') return;
            if (params[k] !== undefined && params[k] !== null && params[k] !== '') fields[k] = params[k];
        });
        var head = '[pp][WRITE#' + seq + '] ' + String(kind.op).toUpperCase() + ' t' + kind.target + (up ? ' up=' + up : '');
        console.log(head + '  [' + op + ']  ← ' + ppWriteCallers(8).join(' ← '), { path: path, fields: fields });
        return {
            seq: seq,
            ok: function(result) {
                var id = result && (result.obj != null ? result.obj : (result.id != null ? result.id : result.i));
                console.log(head + (id != null ? ' → id=' + id : ' (ok)'));
            },
            fail: function(status, msg) {
                console.error(head + ' ✗ СБОЙ ' + status + ': ' + (msg == null ? '' : msg), { path: path, fields: fields });
            }
        };
    }

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
    // #4477/#4480: отправка идёт ЧЕРЕЗ СЕМАФОР (ppAcquireWriteSlot) — потолок одновременных
    // записей держится здесь, в единственной общей точке, а не в каждом пуле по отдельности.
    // Трасса #4177 печатается ПОСЛЕ захвата слота: её номера обязаны отражать порядок реальной
    // ОТПРАВКИ, иначе по логу не прочитать, сколько запросов шло разом (issue #4480 — лог).
    AtexProductionPlanning.prototype.post = function(path, params) {
        var self = this;
        // #4402: пока висит предпросмотр «Упорядочить», очередь на экране — ПРОЕКЦИЯ в памяти
        // (включая синтетические id продолжений), а в БД прежний план. Любая запись в этот
        // момент пишется «не от того» состояния, поэтому запись закрыта наглухо: сперва
        // «Применить» или «Отменить» (applyPendingPlan снимает флаг ДО записи).
        if (this._pendingPlan) {
            return Promise.reject(new Error('Показан непринятый пересчёт «Упорядочить» — нажмите «Применить» или «Отменить»'));
        }
        var body = new URLSearchParams();
        body.set('_xsrf', (typeof window !== 'undefined' && window.xsrf) || this.root.getAttribute('data-xsrf') || '');
        Object.keys(params || {}).forEach(function(k) {
            if (params[k] !== undefined && params[k] !== null && params[k] !== '') body.set(k, params[k]);
        });
        return ppAcquireWriteSlot().then(function() {
            var _trace = tracePpWrite(path, params, self);   // #4177: подробная трасса записи
            function release(v) { ppReleaseWriteSlot(); return v; }
            function releaseThrow(e) { ppReleaseWriteSlot(); throw e; }
            return fetch(self.url(path), {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: body.toString()
            }).then(function(resp) {
                return resp.text().then(function(text) {
                    var result;
                    try { result = text ? JSON.parse(text) : {}; }
                    catch (e) {
                        if (!resp.ok) { _trace.fail(resp.status, text.slice(0, 200)); throw new Error('Сервер вернул ошибку ' + resp.status + ': ' + text.slice(0, 200)); }
                        _trace.fail('parse', text.slice(0, 200));
                        throw new Error('Сервер вернул не JSON: ' + text.slice(0, 200));
                    }
                    // #3486/#3475: отказ команды `_m_*` приходит телом `[{"error":"…"}]` (массив,
                    // my_die) с HTTP-кодом 4xx/409. Прежняя проверка `result.error` у массива не
                    // срабатывала и не смотрела статус — отказ (напр. 409 «есть ссылки» при удалении)
                    // молча считался успехом, запись оставалась, а тост рапортовал «удалено».
                    if (!resp.ok) { _trace.fail(resp.status, extractApiError(result) || ''); throw new Error(extractApiError(result) || ('Сервер вернул ошибку ' + resp.status)); }
                    _trace.ok(result);
                    return result;
                });
            }, function(err) {
                _trace.fail('network', err && err.message);   // #4177: сетевой отказ fetch
                throw err;
            }).then(release, releaseThrow);
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
            self.meta.freeze = byName(TABLE.freeze);        // #4326: необязательная — «замок дня» включается её наличием
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
            // #4234: НЕ глушим. Пустой/недоступный «Календарь» (нет READ-гранта у роли / ошибка
            // сервера) молча делал все дни рабочими и ронял план в просрочку — причём в разных
            // браузерах по-разному (разные сессии/доступы). Роняем загрузку с внятным сообщением
            // (init → fatal), а не строим расписание на неполном календаре.
            console.error('[pp] 📅 loadCalendar: не удалось прочитать «' + TABLE.calendar + '»:', err && err.message);
            self.calendarByDay = {};
            throw new Error('«' + TABLE.calendar + '»: ' + ((err && err.message) || 'ошибка чтения'));
        });
    };

    // #4326: «Заморозка» — «замок дня». Таблица 633483 (главное значение — DATE ДД.ММ.ГГГГ, unique):
    // одна запись на день. Строим карту ГГГГММДД → { id, notes }. Реквизит «Примечание» (633484) —
    // причина, показывается подсказкой замка. Таблицы нет в метаданных (старое окружение) → пустая
    // карта, фича выключена (замки не рисуются, планирование прежнее). В ОТЛИЧИЕ от loadCalendar
    // ошибку чтения НЕ роняем на init (замок — необязательная фича, а не корректность расписания):
    // недоступная/пустая «Заморозка» просто означает «замороженных дней нет» (как loadDowntimes).
    AtexProductionPlanning.prototype.loadFreeze = function() {
        var self = this;
        this.freezeByDay = {};
        var meta = this.meta.freeze;
        if (!meta) return Promise.resolve();
        var notesIdx = columnIndex(meta, FREEZE_REQ.notes);
        return this.getJson('object/' + meta.id + '/?JSON_OBJ&LIMIT=0,2000').then(function(rows) {
            (rows || []).forEach(function(rec) {
                var r = rec.r || [];
                var key = parseDmyKey(r[0]);
                if (key == null || key === Infinity) return;
                self.freezeByDay[key] = {
                    id: String(rec.i),
                    notes: (notesIdx >= 0 && r[notesIdx] != null) ? String(r[notesIdx]) : ''
                };
            });
            console.log('[pp] 🔒 loadFreeze: замороженных дней:', Object.keys(self.freezeByDay).length);
        }).catch(function(err) {
            console.warn('[pp] 🔒 loadFreeze: не удалось прочитать «' + TABLE.freeze + '»:', err && err.message);
            self.freezeByDay = {};
        });
    };

    // #4596: СОБЫТИЯ СМЕНЫ СТАНКОВ — из того же защищённого отчёта, что читает пульт слиттера
    // (`report/slitter_shift_events`, #3674). Планированию из всего журнала нужен ровно один факт:
    // закрыл ли станок смену в текущем дне (`shiftClosedSlittersToday`) — тогда его недоделанные
    // задания переносит «Урегулировать», не дожидаясь конца суток (issue #4596).
    // БЕРЁМ ТОЛЬКО СЕГОДНЯШНИЙ ДЕНЬ — фильтром отчёта `FR_event_when=>ДД.ММ.ГГГГ` (открытый
    // интервал: без оператора `>` фильтр по DATETIME понимается как точное совпадение и даёт 0
    // строк). Иначе журнал качается целиком, а он растёт на сотню событий в день: у отчёта своего
    // лимита нет и строки приходят СТАРЫМИ ВПЕРЁД, поэтому за лимитом запроса первым пропадёт
    // именно сегодняшний день (#4371 — «нужен ЭКСТРЕМУМ, фильтруй до нужного среза»). Проверено на
    // живой ateh 04.08.2026: `>03.08.2026` → 124 события того дня из 283 в журнале.
    // Отчёт недоступен (ошибка сервера, у роли нет READ на объект «Запрос» — им авторизуется чтение
    // report/, грант на саму таблицу событий не нужен) — фича молчать не должна:
    // ЗАКРЫТИЕ СМЕН ПРОСТО НЕ БУДЕТ ВИДНО, и оператор об этом узнаёт (console.error + тост +
    // строка в форме «Отклонения»), а не гадает, почему сегодняшние задания не переносятся.
    AtexProductionPlanning.prototype.loadShiftEvents = function() {
        var self = this;
        var todayKey = planDateDayKey(controllerNowMs(this));
        var today = formatDayKey(todayKey);   // ДД.ММ.ГГГГ — граница фильтра (сегодня 00:00)
        var base = 'report/slitter_shift_events?JSON_KV&LIMIT=0,' + SHIFT_EVENTS_LIMIT;
        var path = today ? (base + '&FR_event_when=' + encodeURIComponent('>' + today)) : base;
        this.shiftEvents = [];
        this.shiftEventsError = '';
        this._shiftClosedCache = null;
        return this.getJson(path).then(function(rows) {
            self.applyShiftEventRows(rows, 'за сегодня');
            // ФИЛЬТР НЕ ДОЛЖЕН МОЛЧА СЪЕДАТЬ ЖУРНАЛ. Пусто бывает по делу (утром смен ещё не
            // открывали), но пусто бывает и от сломавшегося фильтра — а это уже «никто смену не
            // закрывал» сказанное как факт. Поэтому пустой ответ перепроверяем journalом целиком:
            // сегодняшние события в нём есть → фильтр врёт, ОРЁМ и работаем на полном списке.
            if (self.shiftEvents.length || path === base) return;
            return self.getJson(base).then(function(all) {
                var list = rowsToShiftEvents(all || []).filter(function(ev) {
                    return planDateDayKey(ev.ts) === todayKey;
                });
                if (!list.length) return;   // норма: сегодня смен ещё не открывали
                console.error('[pp] 🕗 loadShiftEvents: фильтр FR_event_when отдал пусто, а за сегодня '
                    + 'в журнале событий ' + list.length + ' — фильтр отчёта сломан');
                self.shiftEventsError = 'фильтр по дате не сработал — журнал прочитан целиком';
                self.notify('Фильтр журнала смен не сработал — события прочитаны целиком', 'warning');
                self.applyShiftEventRows(all, 'целиком');
            });
        }).catch(function(err) {
            var msg = (err && err.message) || 'ошибка чтения';
            console.error('[pp] 🕗 loadShiftEvents: не удалось прочитать «report/slitter_shift_events» — '
                + 'закрытие смен учитываться НЕ БУДЕТ (нужен READ-грант роли на «Запрос»):', msg);
            self.shiftEvents = [];
            self.shiftEventsError = msg;
            self._shiftClosedCache = null;
            self.notify('Не удалось прочитать события смен — закрытые смены в «Отклонениях» учтены не будут', 'warning');
        });
    };

    // #4596: разобрать ответ журнала и рассказать, что в нём приехало. Отдельно от `loadShiftEvents`,
    // потому что зовётся с двух путей (по фильтру и целиком при его отказе).
    AtexProductionPlanning.prototype.applyShiftEventRows = function(rows, how) {
        var raw = (rows || []).length;
        this.shiftEvents = rowsToShiftEvents(rows || []);
        this._shiftClosedCache = null;
        // #4371: ответ РОВНО в лимит — журнал усечён, и свежих событий в нём может не быть вовсе.
        // Усечение обязано быть ВИДНЫМ, иначе «никто смену не закрывал» прозвучит как факт.
        if (raw >= SHIFT_EVENTS_LIMIT) {
            console.error('[pp] 🕗 loadShiftEvents: отчёт отдал ровно лимит строк (' + raw
                + ') — журнал усечён, закрытые смены могли не приехать (#4371)');
            this.shiftEventsError = 'журнал событий пришёл усечённым (' + raw + ' строк = лимит запроса)';
            this.notify('Журнал событий смен пришёл усечённым — закрытые смены могли не попасть '
                + 'в «Отклонения»', 'warning');
        }
        var noSlitter = this.shiftEvents.filter(function(ev) {
            return !ev.slitterId && !ev.slitterLabel;
        }).length;
        console.log('[pp] 🕗 loadShiftEvents (' + how + '): событий открытия/закрытия смены:',
            this.shiftEvents.length, 'из', raw, ', станков с закрытой сегодня сменой:',
            Object.keys(this.shiftClosedSlittersToday()).length,
            noSlitter ? (', событий без станка (пропущены): ' + noSlitter) : '');
    };

    // #4596: станки, закрывшие смену СЕГОДНЯ → { slitterId: unix-штамп закрытия }. Считаем по
    // событиям пульта чистой `shiftClosedSlitters`; станок события задан ссылкой (#4359), у старых
    // событий — меткой в «Примечаниях» (#3522), поэтому передаём карту «подпись станка → id».
    // Кэш на текущий день: карту спрашивают и рендер кнопки «Отклонения», и `dayOpenForWork` в
    // цикле по горизонту календаря — пересчитывать её на каждый день незачем.
    AtexProductionPlanning.prototype.shiftClosedSlittersToday = function() {
        var todayKey = planDateDayKey(controllerNowMs(this));
        var cache = this._shiftClosedCache;
        if (cache && cache.key === todayKey) return cache.map;
        var byLabel = {};
        (this.slitters || []).forEach(function(s) {
            var label = String(s && s.label != null ? s.label : '').trim();
            if (label !== '' && s.id != null) byLabel[label] = String(s.id);
        });
        var map = shiftClosedSlitters(this.shiftEvents || [], todayKey, { slitterIdByLabel: byLabel });
        this._shiftClosedCache = { key: todayKey, map: map };
        return map;
    };

    // #4326: клик по «замку дня». Открыт (frozenInfo == null) → спросить Примечание и заморозить:
    // создать запись в «Заморозке» (главное значение — дата ДД.ММ.ГГГГ, уникальна; «Примечание» —
    // причина). Закрыт (frozenInfo) → подтвердить и разморозить: удалить запись. После — перечитать
    // карту и перерисовать. dayMs — полночь дня в шкале расписания.
    AtexProductionPlanning.prototype.openFreezeDay = function(dayMs, frozenInfo) {
        var self = this;
        var meta = this.meta.freeze;
        if (!meta) { this.notify('Таблица «' + TABLE.freeze + '» недоступна в этой сборке', 'error'); return; }
        var dayKey = planDateDayKey(dayMs);
        var dateStr = formatDayKey(dayKey);   // ДД.ММ.ГГГГ — и для показа, и для главного значения записи

        if (frozenInfo) {
            // Разморозить — удалить запись «Заморозки» этого дня.
            // #4541: спрашиваем МОДАЛКОЙ, как и «Заморозить» ниже. Замок дня стои́т в шапке дня
            // очереди, и полоске подтверждения там встать негде — она уезжала в конец рабочего
            // места, где оператор её не видит («нажимаю — ничего не происходит»).
            var recId = frozenInfo.id;
            if (!recId) { this.notify('Не найден id записи заморозки дня ' + dateStr, 'error'); return; }
            var msg = el('span', { class: 'atex-pp-confirm-msg',
                text: 'Планирование снова сможет менять задания этого дня и ставить в него новые.' });
            this.confirmModal(msg, [
                { label: 'Разморозить', onConfirm: function() {
                    self.setBusy(true);
                    self.post('_m_del/' + encodeURIComponent(recId) + '?JSON', {}).then(function() {
                        return self.loadFreeze().then(function() {
                            self.setBusy(false);
                            self.notify('День ' + dateStr + ' разморожен', 'info');
                            self.render();
                        });
                    }).catch(function(err) {
                        self.setBusy(false);
                        self.notify('Ошибка разморозки дня: ' + (err && err.message || err), 'error');
                    });
                } }
            ], null, { title: 'Разморозить день ' + dateStr + '?' });
            return;
        }

        // Заморозить — модалка с Примечанием.
        var dialog = el('div', { class: 'atex-pp-modal-dialog atex-pp-freeze-dialog' });
        var overlay = el('div', { class: 'atex-pp-modal atex-pp-freeze-modal is-open' }, [dialog]);
        function close() { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }
        overlay.addEventListener('click', function(e) { if (e.target === overlay) close(); });
        var closeX = el('button', { class: 'atex-pp-modal-close', type: 'button', text: '×', title: 'Закрыть' });
        closeX.addEventListener('click', close);
        dialog.appendChild(closeX);

        var content = el('div', { class: 'atex-pp-freeze-content' });
        dialog.appendChild(content);
        content.appendChild(el('h2', { class: 'atex-pp-form-title', text: 'Заморозить день ' + dateStr }));
        content.appendChild(el('p', { class: 'atex-pp-hint',
            text: 'Планирование не будет трогать задания этого дня (для всех станков) и не поставит на него новых.' }));
        var noteInput = el('input', { type: 'text', class: 'atex-pp-input atex-pp-freeze-note',
            placeholder: 'Примечание (причина фиксации)' });
        content.appendChild(el('label', { class: 'atex-pp-move-field' }, [
            el('span', { class: 'atex-pp-move-label', text: 'Примечание' }), noteInput
        ]));

        var actions = el('div', { class: 'atex-pp-supply-actions' });
        var cancel = el('button', { class: 'atex-pp-btn', type: 'button', text: 'Отмена' });
        cancel.addEventListener('click', close);
        var ok = el('button', { class: 'atex-pp-btn atex-pp-btn-primary', type: 'button', text: 'Заморозить' });
        ok.addEventListener('click', function() {
            if (self.busy) return;
            var note = String(noteInput.value || '').trim();
            var reqNotes = reqIdByName(meta, FREEZE_REQ.notes);
            var fields = {};
            if (reqNotes && note) fields['t' + reqNotes] = note;
            fields = addMainValueField(meta, fields, dateStr);   // главное значение — дата дня (уникальна)
            close();
            self.setBusy(true);
            self.post('_m_new/' + meta.id + '?JSON&up=1', fields).then(function(res) {
                var id = res && (res.obj || res.id || res.i);
                if (!id) throw new Error('Сервер не вернул id записи «' + TABLE.freeze + '»');
                return self.loadFreeze().then(function() {
                    self.setBusy(false);
                    self.notify('День ' + dateStr + ' заморожен', 'success');
                    self.render();
                });
            }).catch(function(err) {
                self.setBusy(false);
                self.notify('Ошибка заморозки дня: ' + (err && err.message || err), 'error');
            });
        });
        actions.appendChild(cancel);
        actions.appendChild(ok);
        content.appendChild(actions);
        this.root.appendChild(overlay);
        if (noteInput.focus) noteInput.focus();
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

    // #4326: заморожен ли день (по мс). Фича выключена (нет «Заморозки») → всегда false.
    // Ключ дня — YYYYMMDD той же шкалы, что planDateDayKey/parseDmyKey (сравнимо с freezeByDay).
    // СЕМАНТИКА (решение заказчика 27.07.2026, ТЗ §15): для АВТОМАТИКИ замороженный день закрыт
    // полностью — существующие задания пришпилены, новые не ставятся, в том числе срочные; если
    // из-за этого задание не успевает в срок, оно уезжает дальше и помечается просроченным.
    // Прежняя формулировка «срочные всё равно могут встать» (попытка лечить просрочку из #4338)
    // отменена: она и породила #4347/#4434/#4436. Правило исполняемое — PP_INVARIANTS.FROZEN_DAY
    // в 05-invariants.js; ручное действие оператора им не ограничено.
    AtexProductionPlanning.prototype.dayIsFrozen = function(ms) {
        if (!this.meta || !this.meta.freeze || !this.freezeByDay) return false;   // #4326: стаб-self без meta (юнит-тесты)
        var key = planDateDayKey(ms);
        return !!(key != null && key !== Infinity && this.freezeByDay[key]);
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
    // плана (baseMidnightMs), сырья и ножей нет — его заправку обнуляем (ПУСТОЙ объект, а не
    // отсутствие записи: пустая заправка даёт полную настройку — смена сырья + ножи с нуля через
    // changeoverParts, тогда как отсутствие записи дало бы firstCutSetup, одни ножи).
    // #4371: собственной заправки у карты больше нет — прочие станки получают её из своих заданий
    // прошлых дней (prevSetupBeforeWindow, #4300/#4312), поверх этой карты. Применяется и в плане
    // (splitMachineQueue), и в хранимых колонках (computeCutSetupUpdates) — тайминги совпадают.
    AtexProductionPlanning.prototype.planningPrevSetupBySlitter = function(baseMidnightMs) {
        var self = this, out = {};
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

    // #4314: карта slitterId → ДЛИННЫЕ окна «Отпуска» в днях от «С» (longVacationDayRanges) — для
    // planCutOperations. За таким простоем (> DOWNTIME_KEEP_SETUP_MAX_DAYS дней, #3898) заправка станка
    // не сохраняется: первая резка ПОСЛЕ него считает настройку с нуля — и в плане (splitMachineQueue),
    // и в хранимых колонках (computeCutSetupUpdates), иначе окна разъедутся. В отличие от
    // blockedRangesBySlitter, календарные выходные/праздники сюда НЕ входят: наладку снимает только
    // отпуск станка (выходные её сохраняют — станок стоит заправленным).
    AtexProductionPlanning.prototype.longVacationRangesBySlitter = function(baseMidnightMs) {
        var self = this, out = {};
        Object.keys(this.downtimesBySlitter || {}).forEach(function(key) {
            var ranges = longVacationDayRanges(self.downtimesBySlitter[key], baseMidnightMs);
            if (ranges.length) out[key] = ranges;
        });
        return out;
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
            self.positionLengthById = positionLengthMap(self.genPositions);   // #4301: длина прогона резки берётся из «Длина, м» позиции заказа
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
    // хранению номенклатур. Таблица необязательна: если её нет в метаданных (meta) —
    // индекс пуст (фича выключена, поведение прежнее).
    // #4234: но если meta ЕСТЬ, а чтение упало (нет READ-гранта у роли / ошибка сервера) —
    // НЕ глушим. Пустой «Максимальный запас» молча менял решения «в запас / в заказ» и
    // ронял план в просрочку (в разных браузерах — разные сессии/доступы → разный план).
    // Роняем загрузку с внятным сообщением (init → fatal), а не строим план на неполных данных.
    AtexProductionPlanning.prototype.loadMaxStock = function() {
        var self = this;
        var meta = this.meta.maxStock;
        this.maxStockIndex = planning.buildMaxStockIndex([], meta);
        if (!meta) return Promise.resolve();
        return this.getJson('object/' + meta.id + '/?JSON_OBJ&LIMIT=0,5000').then(function(rows) {
            self.maxStockIndex = planning.buildMaxStockIndex(rows || [], meta);
            console.log('[pp] 📦 loadMaxStock: номенклатур запаса:', self.maxStockIndex.list.length);
        }).catch(function(err) {
            console.error('[pp] 📦 loadMaxStock: не удалось прочитать «Максимальный запас»:', err && err.message);
            self.maxStockIndex = planning.buildMaxStockIndex([], meta);
            throw new Error('«Максимальный запас»: ' + ((err && err.message) || 'ошибка чтения'));
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
        var requiredLin = cutRunLength(cut, this.supplies, this.positionLengthById);
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
            // #4536: полос за проход по «Партии ГП» — мерка выпуска для правила SUPPLY_CONSERVED
            // (сколько штук позиции даёт один проход задания).
            self.stripsByBatch = stripsByFinishedBatch(rows || []);
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
    // #4128: оттуда же — СОБСТВЕННЫЙ «Тип намотки» резки. Колонка отчёта cut_winding идёт
    // цепочкой Обеспечение→Позиция, а обеспечения записи-продолжения привязаны к позиции
    // (up=positionId) БЕЗ ссылки на «Задание в производство» → у звеньев цепочки дробления
    // намотка приходит пустой, хотя на самой резке она задана. Та же подмена источника, что
    // в #3868 для «Вида сырья».
    // #4155: оттуда же — СОБСТВЕННАЯ «Партия сырья» резки (ссылка на «Партию сырья», req 192).
    // Отчёт cut_planning её НЕ отдаёт (rowsToPlanning: batchId:'' — отчётный batch_id это
    // «Партия ГП», не сырьё), поэтому applySplitPlan создавал продолжение дробления с ПУСТОЙ
    // «Партией сырья» (materialBatch = parentCut.batchId = ''). Читаем ссылку прямо с записи.
    // Возвращает { seq: {}, fixed: { cutId: bool }, winding: { cutId: 'IN'|'OUT'|'' },
    //   materialBatch: { cutId: batchId } }.
    AtexProductionPlanning.prototype.loadCutSequences = function() {
        var meta = this.meta.cut;
        var empty = { seq: {}, fixed: {}, winding: {}, materialBatch: {} };
        if (!meta) return Promise.resolve(empty);
        var fixedIdx = columnIndex(meta, CUT_REQ.fixed);    // #3508
        var windIdx = columnIndex(meta, CUT_REQ.winding);   // #4128
        var matBatchIdx = columnIndex(meta, CUT_REQ.materialBatch);   // #4155
        if (fixedIdx < 0 && windIdx < 0 && matBatchIdx < 0) return Promise.resolve(empty);
        return this.getJson('object/' + meta.id + '/?JSON_OBJ&LIMIT=0,5000').then(function(rows) {
            var fixed = {};
            var winding = {};
            var materialBatch = {};
            (rows || []).forEach(function(rec) {
                var r = rec.r || [];
                if (fixedIdx >= 0) fixed[String(rec.i)] = truthyFlag(r[fixedIdx]);    // #3508
                if (windIdx >= 0) winding[String(rec.i)] = normWinding(r[windIdx]);   // #4128
                // #4155: ref-колонка приходит как «id:Подпись» — берём id через parseRef.
                if (matBatchIdx >= 0) { var mb = parseRef(r[matBatchIdx]); materialBatch[String(rec.i)] = mb.id ? String(mb.id) : ''; }
            });
            return { seq: {}, fixed: fixed, winding: winding, materialBatch: materialBatch };
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

    // #4631: ПРИВЕСТИ «Задачи на втулки» ПОЗИЦИЙ К ПЛАНУ. Набор задач позиции обязан повторять
    // её звенья резки (по задаче на звено, «Кол-во» = доле обеспечения), а Σ — равняться
    // заказанному количеству: втулка нужна каждому рулону. Что именно оставить, что снять и чего
    // не хватает, решает ЧИСТОЕ правило `planSleeveTaskReconcile` — здесь только чтение и запись.
    //
    // Зовут это генерация (после создания заданий) и удаление задания. До #4631 набор не сверял
    // никто: задачи создавались при создании задания и не удалялись нигде, поэтому каждая
    // перегенерация клала новый комплект поверх старого (боевая ateh: 574 задачи при 212
    // позициях, 67 086 лишних втулок).
    //
    // Ошибка чтения/записи НЕ валит вызвавшее действие: план уже записан, а втулки — следствие.
    //   positionIds — какие позиции сверить (пусто → ничего не делаем).
    // → Promise<{ dropped, created, skipped }>
    AtexProductionPlanning.prototype.reconcileSleeveTasks = function(positionIds) {
        var self = this;
        var meta = this.meta.sleeveTask;
        var reqIds = this.sleeveTaskReqIds();
        var ids = [];
        (positionIds || []).forEach(function(p) {
            var id = String(p == null ? '' : p).trim();
            if (id && ids.indexOf(id) === -1) ids.push(id);
        });
        if (!meta || !reqIds || !ids.length) return Promise.resolve({ dropped: 0, created: 0, skipped: 0 });
        var qtyIdx = columnIndex(meta, SLEEVE_TASK_REQ.qty);
        var startedIdx = columnIndex(meta, SLEEVE_TASK_REQ.started);
        var finishedIdx = columnIndex(meta, SLEEVE_TASK_REQ.finished);
        var factIdx = columnIndex(meta, SLEEVE_TASK_REQ.fact);
        if (qtyIdx < 0) {
            console.warn('[pp] #4631: у «' + TABLE.sleeveTask + '» не найдена колонка «' + SLEEVE_TASK_REQ.qty + '» — набор не сверяем');
            return Promise.resolve({ dropped: 0, created: 0, skipped: ids.length });
        }
        var stat = { dropped: 0, created: 0, skipped: 0 };
        var tasks = ids.map(function(positionId) {
            return function() {
                return self.getJson('object/' + meta.id + '/?JSON_OBJ&F_U=' + encodeURIComponent(positionId) + '&LIMIT=0,200')
                    .then(function(rows) {
                        var have = (rows || []).map(function(rec) {
                            var r = rec.r || [];
                            var val = function(i) { return i >= 0 ? String(r[i] == null ? '' : r[i]).trim() : ''; };
                            return { id: rec.i, qty: stripNum(r[qtyIdx]), plannedTs: Number(r[0]) || 0,
                                     // «Начато»/«Закончено»/«Кол-во факт» — работа, которую уже делали.
                                     touched: !!(val(startedIdx) || val(finishedIdx) || val(factIdx)) };
                        });
                        // Звенья позиции — её «Обеспечения» с плановым стартом своей резки.
                        var cutTs = {};
                        (self.cuts || []).forEach(function(c) { if (c && c.id != null) cutTs[String(c.id)] = Number(c.planDate) || 0; });
                        var links = (self.supplies || []).filter(function(s) {
                            return s && String(s.positionId) === String(positionId) && s.cutId != null && String(s.cutId) !== '';
                        }).map(function(s) {
                            return { qty: stripNum(s.rolls), plannedTs: cutTs[String(s.cutId)] || 0 };
                        });
                        // Заказанное количество и тип втулки — из уже загруженных позиций
                        // (`genPositions`, rowsToGenPositions). Позиции нет → не знаем спроса и
                        // ничего не трогаем: догадка тут дороже дубля.
                        var pRec = null;
                        (self.genPositions || []).forEach(function(gp) { if (String(gp.id) === String(positionId)) pRec = gp; });
                        var demand = pRec ? stripNum(pRec.qty) : null;
                        if (!(demand > 0)) { stat.skipped++; return null; }
                        var plan = planSleeveTaskReconcile(demand, have, links);
                        if (plan.reason) {
                            console.warn('[pp] #4631: позиция ' + positionId + ' — ' + plan.reason);
                            stat.skipped++;
                            return null;
                        }
                        var chain = Promise.resolve();
                        (plan.drop || []).forEach(function(taskId) {
                            chain = chain.then(function() {
                                return self.post('_m_del/' + encodeURIComponent(taskId) + '?JSON', {}).then(function() {
                                    stat.dropped++;
                                    return planJournal(self, { event: 'SLEEVE_DROP', order: '', cut: null,
                                        details: '#4631: снята лишняя «Задача на втулки» ' + taskId + ' (позиция ' + positionId + ')' });
                                }).catch(function(err) {
                                    var m = String((err && err.message) || err);
                                    if (!/no such record/i.test(m)) throw err;   // уже удалена — не ошибка
                                });
                            });
                        });
                        (plan.create || []).forEach(function(add) {
                            chain = chain.then(function() {
                                var f = self.buildSleeveTaskFields(reqIds,
                                    { qty: add.qty, sleeveId: (pRec && pRec.sleeveId) || '' }, add.plannedTs || '');
                                return self.post('_m_new/' + meta.id + '?JSON&up=' + encodeURIComponent(positionId), f).then(function() {
                                    stat.created++;
                                    return planJournal(self, { event: 'SLEEVE_ADD', order: '', cut: null, after: add.qty,
                                        details: '#4631: создана недостающая «Задача на втулки» на ' + add.qty + ' втулок (позиция ' + positionId + ')' });
                                });
                            });
                        });
                        return chain;
                    });
            };
        });
        return runWithConcurrency(tasks, MAX_PARALLEL_WRITES).then(function() {
            if (stat.dropped || stat.created) {
                console.log('[pp] 🧵 #4631: «Задачи на втулки» приведены к плану — снято ' + stat.dropped +
                    ', создано ' + stat.created + (stat.skipped ? ', пропущено позиций ' + stat.skipped : ''));
            }
            return stat;
        }).catch(function(err) {
            // Втулки — следствие плана: их сверка не вправе уронить уже выполненное действие.
            console.error('[pp] #4631: сверка «Задач на втулки» не удалась:', err && err.message);
            return stat;
        });
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
    // #4501: читаем и колонку «Код» (условие по ширине полосы, `w<=30`) — normalizeOperationTimes
    // приводит такую строку к каноническому ключу WIND_W30_<метры>, чтобы движок знал одну форму.
    AtexProductionPlanning.prototype.loadOperationTimes = function() {
        var self = this;
        var list = this._metaAll || [];
        var meta = tableByName(list, 'Время операции, мин');
        if (!meta) { this.opTimes = {}; this.changeTimes = null; return Promise.resolve(); }
        var codeIdx = columnIndex(meta, 'Код операции');
        var widthCodeIdx = columnIndex(meta, 'Код');   // #4501: условие по ширине полосы
        return this.getJson('object/' + meta.id + '/?JSON_OBJ&LIMIT=0,200').then(function(rows) {
            var raw = normalizeOperationTimes((rows || []).map(function(rec) {
                var r = rec.r || [];
                return {
                    code: codeIdx >= 0 ? r[codeIdx] : '',
                    minutes: r[0],   // r[0] — главное значение = минуты
                    widthCode: widthCodeIdx >= 0 ? r[widthCodeIdx] : ''
                };
            }));
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

    // #4536: отчёт не отдаёт «Кол-во рулонов» обеспечения — план это ПЕРЕЖИВЁТ (доли количества он
    // просто не пересчитывает и хранимое не трогает), но молчать нельзя: пока колонки нет,
    // «Обеспечение» не знает, сколько заказу достаётся с задания. Говорим ОДИН раз за загрузку
    // рабочего места — тост на каждое чтение очереди был бы шумом, а не сообщением.
    AtexProductionPlanning.prototype.reportSupplyRollsDiagnostic = function(rows) {
        var d = supplyRollsReportDiagnostic(rows);
        if (!d) { this._supplyRollsDiagnosticSaid = false; return null; }
        if (typeof console !== 'undefined' && console.warn) {
            console.warn('[pp] ⚠️ #4536 ' + d.message + '. Добавьте колонку в отчёт cut_planning: '
                + '«Обеспечение → ' + d.label + '» с именем supply_rolls.');
        }
        if (!this._supplyRollsDiagnosticSaid) {
            this._supplyRollsDiagnosticSaid = true;
            this.notify('Отчёт cut_planning не отдаёт «' + d.label + '» обеспечения — количество заказа план '
                + 'не пересчитывает (добавьте колонку supply_rolls)', 'warning');
        }
        return d;
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
            var windingByCut = seqResult.winding || {};   // #4128
            var materialBatchByCut = seqResult.materialBatch || {};   // #4155
            self.reportCutPlanningDiagnostics(rows || []);
            self.reportSupplyRollsDiagnostic(rows || []);   // #4536: количество обеспечения — из отчёта или никак
            var p = rowsToPlanning(rows || []);
            var agg = self.stripAgg || {};
            p.cuts.forEach(function(cut) {
                var a = agg[String(cut.id)] || {};
                cut.knifeCount = a.knifeCount || 0;
                cut.knifeWidths = a.knifeWidths || [];
                cut.fixed = !!fixedByCut[String(cut.id)];   // #3508: флаг «Зафиксировано» (#3923: «Очередность» не читаем)
                // #4128: собственный «Тип намотки» резки — источник истины. Колонка отчёта
                // (Обеспечение→Позиция) пуста у setup-сегмента и продолжений цепочки, и эта
                // пустота копировалась в новые продолжения (applySplitPlan) → намотка терялась
                // насовсем. Отчёт остаётся фолбэком для записей без своего реквизита.
                var ownWinding = windingByCut[String(cut.id)];
                if (ownWinding) cut.winding = ownWinding;
                // #4155: собственная «Партия сырья» резки (отчёт cut_planning её не отдаёт →
                // batchId:''). Нужна источником истины для продолжений дробления, чтобы
                // applySplitPlan копировал её в новые сегменты (иначе «Партия сырья» пустая).
                var ownBatch = materialBatchByCut[String(cut.id)];
                if (ownBatch) cut.batchId = ownBatch;
            });
            if (!self.footageBySupply) self.footageBySupply = {};
            p.supplies.forEach(function(supply) {
                var f = supplyFootage(supply, null);
                if (f > 0) self.footageBySupply[String(supply.id)] = f;
            });
            self.cuts = p.cuts;
            self._planDataVersion = (self._planDataVersion || 0) + 1;   // #4401: сброс кэша детектора наладки
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
        this.healCutBatches();   // #4452: «Партия сырья» — после «Вида сырья» (FIFO-источник опирается на него)
    };

    // #4452 (ТЗ §15, CUT_BATCH): восстановить «Партию сырья» заданий В ПАМЯТИ сразу после загрузки
    // очереди. Именно в памяти и именно здесь: changeoverParts сравнивает партии соседей, поэтому
    // пустая партия должна исчезнуть ДО расчёта плана — иначе план оплатит смену сырья, которой
    // нет, и никакая последующая запись в базу этого уже не вернёт. В базу восстановленное уйдёт
    // при ближайшем сохранении плана (страж guardPlanOps проставляет партию в операции,
    // applySplitPlan пишет её так же, как «Вид сырья»/«Тип намотки»).
    AtexProductionPlanning.prototype.healCutBatches = function() {
        var cuts = this.cuts || [];
        if (!cuts.length) return { healed: [], unresolved: [] };
        var headById = {};
        var chains = mergeContinuationChains(cuts).chainByLogical || {};
        Object.keys(chains).forEach(function(head) {
            (chains[head] || [head]).forEach(function(m) { headById[String(m)] = String(head); });
        });
        var r = healCutBatches(cuts, {
            chainHeadById: headById,
            consumptionByCut: this.consumptionByCut || {},
            genBatches: this.genBatches || []
        });
        this._batchHealReport = r;
        this._batchUnresolvedReason = {};
        var reasons = this._batchUnresolvedReason;
        r.unresolved.forEach(function(u) { reasons[String(u.cutId)] = u.reason; });
        if (r.healed.length) {
            var bySource = { chain: 0, consumption: 0, fifo: 0 };
            r.healed.forEach(function(h) { if (bySource[h.source] != null) bySource[h.source]++; });
            console.log('[pp] 🧵 #4452: «Партия сырья» восстановлена у заданий: ' + r.healed.length
                + ' (цепочка дробления ' + bySource.chain + ', «Расход сырья» ' + bySource.consumption
                + ', FIFO активной партии ' + bySource.fifo + ')',
                { healed: r.healed });
        }
        if (r.unresolved.length) {
            // Не молчим (crm no-silent-fallback): партию не из чего вывести — это ошибка данных,
            // и она стои́т ложной переналадки с каждым соседом того же сырья. Здесь — полная трасса
            // «где именно»; тост оператору даёт страж в момент записи плана (там же, где правило
            // действует по ТЗ: Сгенерировать / Упорядочить / Пересчитать наладку / перенос).
            console.error('[pp] ⛔ #4452: задания БЕЗ «Партии сырья» (' + r.unresolved.length + '): '
                + r.unresolved.slice(0, 20).map(function(u) { return u.cutId + ' — ' + u.reason; }).join('; ')
                + (r.unresolved.length > 20 ? '; …ещё ' + (r.unresolved.length - 20) : ''));
        }
        return r;
    };

    // #4452: разрешение «Партии сырья» задания для стража плана (ctx.resolveBatchForCut).
    // Партия уже вылечена в памяти (healCutBatches), поэтому источник различаем по
    // c.batchHealedFrom: 'own' — стои́т в базе (переписывать нечего), остальное — восстановленное,
    // его страж проставит в операции и запись плана сохранит.
    AtexProductionPlanning.prototype.resolveBatchForCut = function(cutId) {
        var key = String(cutId);
        // Индекс по id: страж зовёт резольвер на КАЖДУЮ операцию плана, линейный поиск дал бы O(n²)
        // на очереди в тысячи заданий. Индекс пересобирается при смене данных (_planDataVersion).
        var ver = this._planDataVersion || 0;
        if (!this._batchCutIndex || this._batchCutIndexVer !== ver) {
            var idx = {};
            (this.cuts || []).forEach(function(x) { if (x && x.id != null) idx[String(x.id)] = x; });
            this._batchCutIndex = idx;
            this._batchCutIndexVer = ver;
        }
        var c = this._batchCutIndex[key];
        if (!c) return { batchId: '', source: '', reason: 'задания ' + key + ' нет в загруженной очереди' };
        var b = (c.batchId != null) ? String(c.batchId).trim() : '';
        if (b !== '') return { batchId: b, source: c.batchHealedFrom || 'own' };
        return { batchId: '', source: '', reason: (this._batchUnresolvedReason || {})[key] || 'источник партии не найден' };
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
        // #4501: полосы создаваемой резки — ширины выбранных позиций (уже фактические, #3372):
        // по самой узкой выбирается норма намотки.
        var draftCut = { isFoil: d.isFoil, knifeWidths: selectedPositions.map(function(pid) {
            var p = posById[String(pid)];
            return p ? p.width : 0;
        }) };
        var duration = plannedCutDurationMinutes(runLength, d.plannedRuns, this.opTimes, draftCut); // #3606/#4501
        var timing = cutTimingDetails(runLength, d.plannedRuns, this.opTimes, draftCut);
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
        var remaining = remainingRollsForPosition(position, this.supplies, this.producedRollsByPosition());
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
            // #4501: они же — источник самой узкой полосы для нормы намотки, поэтому считаются
            // ДО тайминга.
            var knifeWidths = [];
            (lay.strips || []).forEach(function(s) {
                var w = Number(s.width) || 0, q = Math.round(Number(s.qty) || 0);
                for (var i = 0; i < q; i++) knifeWidths.push(w);
            });
            var prospectCut = { isFoil: position.isFoil, knifeWidths: knifeWidths };
            return {
                forKey: String(positionId) + '|' + qty,
                positionId: String(position.id), position: position, qty: qty,
                materialId: mat, layout: lay, plannedRuns: plannedRuns, runLength: runLength,
                duration: plannedCutDurationMinutes(runLength, plannedRuns, self.opTimes, prospectCut), // #3606/#4501
                timing: cutTimingDetails(runLength, plannedRuns, self.opTimes, prospectCut),
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

    // Ближайшее свободное окно станка для проспект-резки — ПО СОХРАНЁННОМУ ПЛАНУ (#4416).
    // Окно = хвост очереди станка в том виде, в каком её рисует страница и Гант (#3846:
    // planStart + «Наладка ножей» + «Сырьё/намотка» + «Резка и Лидер»), а НЕ live-пересчёт всей
    // очереди: пересчёт всей очереди от дня 0 в растянутом по дням плане отдавал окно ВНУТРИ уже
    // занятого дня — созданное вручную задание вставало с дырой/нахлёстом, и очередь тут же просила
    // «Пересчитать наладку» (issue #4416).
    // Наладку и намотку самого нового задания по-прежнему считают канонические формулы
    // (buildSchedule на паре «последнее задание станка + проспект»), только теперь они кладутся
    // на сохранённую сетку. Округляем как хранимые колонки: наладка — round, «Резка и Лидер» —
    // ceil(намотка) + лидер (#3635 п.4/#3700), иначе окно снова разъедется с очередью.
    // → { windowStartMin, startMin, finishMin, durationMin, setupMin, day, startTs, planBaseMidnightMs } | null.
    AtexProductionPlanning.prototype.freeSlotForCut = function(slitterId, prospect) {
        var self = this;
        if (!prospect) return null;
        var windPoints = windingPointsFromTimes(this.opTimes || {});
        var dayWindow = this.workingWindow();
        var grp = groupBySlitter(this.cuts).filter(function(g) { return String(g.slitter.id) === String(slitterId); })[0];
        var stationCuts = grp ? grp.cuts : [];
        var runLenByCut = {};
        stationCuts.forEach(function(c) { runLenByCut[String(c.id)] = cutRunLength(c, self.supplies, self.positionLengthById); });
        runLenByCut[String(prospect.id)] = Number(prospect.runLength) || 0;
        // День 0 = дата планирования из фильтра (.atex-pp-input), даже если в прошлом;
        // без даты — сегодня. Как в генерации (#3311), ре-планировании (#3312), очереди (#3316).
        var planBaseMidnightMs = planBaseMidnightFrom(this.filter && this.filter.date, controllerNowMs(this));
        // #4396: свободное окно ОБЯЗАНО пропускать нерабочие дни — выходные/праздники «Календаря»
        // (#3788) и «Отпуск» станка (#3764). Иначе форма показывала окно на выходном и
        // createCutForPosition писала этот planStart: задание вставало в день, про который очередь
        // тут же говорила «Выходной/праздничный день — заданий быть не должно».
        var blocked = this.blockedRangesForSlitter(slitterId, planBaseMidnightMs);
        // Сохранённые окна очереди станка и её ФИЗИЧЕСКИ последнее задание (по концу окна) —
        // от него считается переналадка нового.
        var stored = scheduleFromStored(stationCuts, planBaseMidnightMs);
        var cutById = {};
        stationCuts.forEach(function(c) { cutById[String(c.id)] = c; });
        var items = [], lastCut = null, lastEnd = -Infinity;
        stored.forEach(function(sc) {
            var ws = stripNum(sc.startMin) - stripNum(sc.setupMin);
            var occ = stripNum(sc.setupMin) + stripNum(sc.durationMin);
            items.push({ windowStartMin: ws, occMin: occ });
            if (ws + occ > lastEnd) { lastEnd = ws + occ; lastCut = cutById[String(sc.cutId)] || null; }
        });
        // Наладка/намотка нового задания — теми же формулами, что у расписания: переналадка от
        // последнего задания станка (пустая очередь → настройка ножей с нуля, #3669 п.2).
        var pair = lastCut ? [lastCut, prospect] : [prospect];
        var pairSched = buildSchedule(pair, {
            windPoints: windPoints, times: this.changeTimes, runLengthByCut: runLenByCut,
            shiftStartMin: dayWindow.startMin, shiftEndMin: dayWindow.cutEndMin,
            firstCutSetup: true
        });
        var sc = pairSched.length ? pairSched[pairSched.length - 1] : null;
        if (!sc) return null;
        var setupMin = Math.round(stripNum(sc.setupMin));
        var durationMin = Math.ceil(round3(stripNum(sc.durationMin))) + Math.round(stripNum(sc.leaderMin));
        var windowStartMin = freeSlotFromStoredQueue(items, {
            occMin: setupMin + durationMin,
            dayStartMin: dayWindow.startMin, dayEndMin: dayWindow.cutEndMin,
            lunchStartMin: dayWindow.lunchStartMin, lunchDurationMin: dayWindow.lunchDurationMin,
            blocked: blocked, minStartMin: dayWindow.startMin
        });
        if (windowStartMin == null) return null;
        return {
            windowStartMin: windowStartMin,
            startMin: round3(windowStartMin + setupMin),
            finishMin: round3(windowStartMin + setupMin + durationMin),
            durationMin: durationMin,
            setupMin: setupMin,
            day: Math.floor(windowStartMin / 1440),
            startTs: scheduleStartTimestamp(planBaseMidnightMs, windowStartMin),
            planBaseMidnightMs: planBaseMidnightMs
        };
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
        // #4396: день вставки (можно не указывать; указан — обязателен). Нерабочий день отсекаем ДО
        // создания: moveCutToDay такой перенос отклоняет, и без проверки мы бы создали задание,
        // которое молча осталось стоять не там, где просили — а день обязательный.
        var insertDate = insertDayIso(d.insertDate);
        var insertMidnight = insertDate ? planBaseMidnightFrom(insertDate, controllerNowMs(self)) : null;
        if (insertDate && !self.dayIsWorking(insertMidnight)) {
            self.notify('Выбран выходной/праздничный день — заданий в него быть не должно. Задание не создано', 'error');
            return;
        }
        if (insertDate && self.slitterOnVacationDay(d.slitterId, insertMidnight)) {
            var pvSlit = (self.slitters || []).filter(function(s) { return String(s.id) === String(d.slitterId); })[0];
            self.notify('Станок ' + ((pvSlit && pvSlit.label) || ('#' + d.slitterId)) + ' в отпуске в выбранный день — задание не создано', 'error');
            return;
        }
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
                // «В работе» (activeReqId) больше не пишем — галку с формы убрали, значение не
                // сохраняем вообще: реквизит остаётся дефолтным по схеме.
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
                    var slitterId = String(d.slitterId || '');   // до сброса черновика
                    self.setBusy(false);
                    self.draft = self.blankDraft();
                    self.selectedCutId = String(cutId);
                    self.closeForm();
                    self.notify('Производственное задание #' + cutId + ' создано, позиция обеспечена (' + plan.qty + ' рул.)', 'success');
                    self.render();
                    // #4396: день не указан — оставляем как было (ближайшее свободное окно, конец
                    // очереди станка). УКАЗАН — он ОБЯЗАТЕЛЬНЫЙ: переносим тем же путём, что и ручное
                    // «🗓», с фиксацией (fix=true). Фиксация здесь не «на всякий случай», а механизм:
                    // зафиксированное задание точный упаковщик кладёт на «Дату план» ФИКС-ЯКОРЕМ, без
                    // эвристики ёмкости, и не выкидывает с дня (#4390). Мягкий замок «по весу» (fix=false)
                    // такой гарантии НЕ даёт — задание переливается на следующий день. Позиция ВНУТРИ
                    // дня остаётся «по весу»: обязателен день, а не место в очереди.
                    // moveCutToDay сам перечитает данные, пересоберёт затронутые дни и скажет тостом,
                    // куда задание легло.
                    if (!insertDate) return;
                    var created = (self.cuts || []).filter(function(c) { return String(c.id) === String(cutId); })[0];
                    if (!created) { self.notify('Задание создано, но не найдено в очереди — постановка на выбранный день пропущена', 'warning'); return; }
                    return self.moveCutToDay(created, insertDate, 'weight', true, slitterId, true);
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
        this._ppOp = 'setCutsFixed';   // #4177/#4480
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
        // #4477 (ТЗ §15): записи независимы (каждая — свой _m_set/<cutId>), пишем пулом до
        // MAX_PARALLEL_WRITES потоков — было цепочкой в один поток, и «Зафиксировать» по всей
        // очереди тянулось лесенкой запросов.
        return runWithConcurrency(ids.map(function(id) {
            return function() {
                var fields = {}; fields[fieldKey] = flag;
                var u = setupById[String(id)];   // #3778: дополняем флаг снимком тайминга
                if (u) {
                    var tf = setupTimingFields(setupRes.reqs, u);
                    Object.keys(tf).forEach(function(k) { fields[k] = tf[k]; });
                }
                return self.post('_m_set/' + encodeURIComponent(id) + '?JSON', fields)
                    .then(function() { self.updateProgress(++done); });
            };
        }), MAX_PARALLEL_WRITES).then(function() {
            return self.reload();
        }).then(function() {
            // #4388: неустойчивый дефект — после снятия/постановки фиксации кнопка 🔒
            // (и серый замок карточки) иногда не меняла состояние до F5. Причина: reload
            // читает флаг «Зафиксировано» через loadCutSequences (object/{cut}/?JSON_OBJ),
            // а это чтение сразу после _m_set изредка отдаёт СТАРОЕ значение (реплика/кеш
            // отчёта отстаёт от записи). Все _m_set в chain уже успешно завершились, значит
            // источник истины — записанное нами value: применяем его к затронутым резкам
            // поверх возможно отставшего чтения, чтобы render() нарисовал верную кнопку без
            // перезагрузки страницы.
            var wrote = {};
            ids.forEach(function(id) { wrote[String(id)] = true; });
            (self.cuts || []).forEach(function(c) { if (wrote[String(c.id)]) c.fixed = value; });
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
        if (this._pendingPlan) { this.notify('Пересчёт уже показан — нажмите «Применить» или «Отменить»', 'info'); return; }
        if (!(this.cuts && this.cuts.length)) { this.notify('Нет заданий для упорядочивания', 'info'); return; }
        var host = actionsEl || (this.root && this.root.querySelector('.atex-pp-panel-actions'));
        var oldBar = host && host.querySelector && host.querySelector('.atex-pp-confirm-bar');
        if (oldBar && oldBar.parentNode) oldBar.parentNode.removeChild(oldBar);
        var msg = el('span', { class: 'atex-pp-confirm-msg', text:
            'Пересобрать очередь в оптимальный порядок: группировка по сырью (минимум переналадок), ' +
            'при прочих равных — больше полос раньше. Ручные перестановки заменятся; ' +
            'зафиксированные задания останутся на своих днях (#3792). ' +
            'Результат сперва ПОКАЖЕМ на карточках — в базу он запишется только по «Применить» (#4402).' });
        this.confirmAction(msg, host, [
            { label: 'Упорядочить', inline: true, onConfirm: function() { self.runOptimizeQueue(); } }
        ]);
    };

    // #4064: один день опоздания в объективе «Упорядочить» весит больше любой переналадки — срок
    // (ТЗ §14) старший критерий. Объектив кандидата = дни_опоздания × LATE_DAY_WEIGHT + переналадка(мин),
    // поэтому chooseOptimizeCandidate сперва минимизирует опоздания, затем переналадку (лексикографически).
    var LATE_DAY_WEIGHT = 1e9;
    // #4413: задание, стоящее в окне «Отпуска» своего станка, — не «дорого», а НЕВОЗМОЖНО: станок
    // в это время не работает. Такое нарушение старше срока, поэтому его вес выше LATE_DAY_WEIGHT:
    // план, который снимает нарушение, применяется даже при тех же опозданиях и той же переналадке
    // (issue #4413: «Отпуск» добавили перед «Упорядочить» — задание осталось внутри него).
    var DOWNTIME_CONFLICT_WEIGHT = 1e15;
    // #4469: недоупакованный станко-день (ТЗ §15) — жёсткое правило, а не предпочтение: план, который
    // добивает день до потолка, обязан побеждать план с той же переналадкой (иначе разбитое по дням
    // задание остаётся разбитым навсегда — та же природа, что #4413). Вес ВЫШЕ переналадки (минуты,
    // сотни-тысячи) и НИЖЕ срока: набивка дня тянет проходы НАЗАД, опозданий она не добавляет, а
    // план, который пакует день ценой просрочки, был бы хуже.
    var UNDERFILL_DAY_WEIGHT = 1e6;
    // #4471: кандидат НАРУШАЕТ ЖЁСТКОЕ ПРАВИЛО ТЗ §15 (реестр PP_INVARIANTS: 🔒-монолит #4464, потолок
    // дня #4467) — такой план не применяется, чем бы он ни был хорош: правило на то и жёсткое. Вес
    // ниже «Отпуска» (там станок физически не работает) и выше срока. Считает не объектив, а СТРАЖ
    // записи: `ops.ruleBreaks` из buildSequenceOps — одна проверка на все пути (ТЗ §15).
    var RULE_BREAK_WEIGHT = 1e12;

    // #4475: НАРУШЕНИЕ ПРАВИЛА → ФРАЗА ОПЕРАТОРУ. Реестр (05-invariants.js) отдаёт нарушения
    // СТРУКТУРОЙ (правило, станок, день, минуты, задания) — здесь она превращается в текст на языке
    // экрана: станок называется своей подписью, день — датой, задание — номером. Разговоров про
    // консоль, имён правил и «так быть не должно» тут нет: это сообщение читает оператор, а
    // разработчик читает журнал (console.error в buildSequenceOps, там полный разбор).
    //   violations — [{ rule, cutId, slitterId, dayKey, … }] (ops.ruleAudit);
    //   opts.slitterLabel(id) → подпись станка, opts.dayLabel(ГГГГММДД) → дата, opts.limit — сколько
    //   нарушений называть поимённо (остаток не замалчиваем: «…и ещё N»).
    // → { text, kind } либо null, если называть нечего.
    function formatPlanAuditMessage(violations, opts) {
        var list = (violations || []).filter(function(v) { return v && v.rule; });
        if (!list.length) return null;
        var o = opts || {};
        var slitterLabel = typeof o.slitterLabel === 'function' ? o.slitterLabel : function(id) { return 'станок #' + id; };
        var dayLabel = typeof o.dayLabel === 'function' ? o.dayLabel : function(key) { return String(key); };
        var limit = Number(o.limit) > 0 ? Number(o.limit) : 3;
        function where(v) {
            var parts = [];
            if (v.slitterId != null && String(v.slitterId) !== '') parts.push(slitterLabel(v.slitterId));
            if (v.dayKey) parts.push(dayLabel(v.dayKey));
            return parts.join(', ');
        }
        // Нарушение без структуры (старый вызов, чужой источник) фразу не ломает: называем правило
        // человеческими словами и всё, что о нём известно, — вместо «№undefined».
        function phrase(v) {
            var place = where(v);
            var at = place ? ' (' + place + ')' : '';
            if (v.rule === 'DAY_CAPACITY') {
                return 'день длиннее смены' + at
                    + (v.loadMin > 0 ? ' — ' + v.loadMin + ' мин при потолке ' + v.capMin : '');
            }
            if (v.rule === 'DAY_FILL') {
                return 'смена не набита до потолка' + at
                    + (v.freeMin > 0 ? ' — свободно ' + v.freeMin + ' мин' : '')
                    + (v.donorCutId ? ', а проход задания №' + v.donorCutId + ' стои́т ' + v.needMin + ' мин' : '');
            }
            if (v.rule === 'FIXED_BLOCK') {
                if (v.kind === 'insert' && v.otherCutId) {
                    return 'между зафиксированными (🔒) №' + v.otherCutId + ' и №' + v.cutId + ' встало №'
                        + ((v.betweenIds || []).join(', №') || '?') + at;
                }
                return 'порядок зафиксированных (🔒) заданий изменён'
                    + (v.otherCutId ? ': №' + v.otherCutId + ' ↔ №' + v.cutId
                                    : (v.cutId ? ' (задание №' + v.cutId + ')' : '')) + at;
            }
            if (v.rule === 'FIXED_NO_PUSH') {
                return 'перед зафиксированным (🔒) №' + v.cutId + ' встало №'
                    + ((v.beforeIds || []).join(', №') || '?') + at;
            }
            if (v.rule === 'CUT_BATCH') {
                return 'задание №' + v.cutId + ' без «Партии сырья» (' + (v.reason || 'источник партии не найден') + ')';
            }
            // #4536: недостача обеспечения — на языке заказа, а не позиции: оператор ищет её по
            // номеру заказа и ширине, а «не хватает N шт.» — то, что он скажет производству.
            if (v.rule === 'SUPPLY_CONSERVED') {
                var who = v.orderNo ? ('заказ ' + v.orderNo) : ('позиция ' + v.positionId);
                var dims = (Number(v.width) > 0) ? (' · ' + round3(Number(v.width)) + ' мм') : '';
                return who + dims + ': не хватает ' + v.shortRolls + ' шт. (заказано ' + v.ordered
                    + ', выпуск по плану ' + v.produced + ')';
            }
            return v.msg || v.rule;
        }
        var items = list.map(phrase);
        var shown = items.slice(0, limit);
        var rest = items.length - shown.length;
        // «Партия сырья» — ошибка ДАННЫХ, её чинит оператор; остальное — отклонение раскладки,
        // о котором он должен знать, но чинить его — не его работа.
        var dataOnly = list.every(function(v) { return v.rule === 'CUT_BATCH'; });
        // #4536: недостача обеспечения — не про дни: заказу не хватает проходов, и чинится это
        // заданием, а не перестановкой. Хвост фразы называет то, что делать.
        var supplyOnly = list.every(function(v) { return v.rule === 'SUPPLY_CONSERVED'; });
        var tail = dataOnly
            ? ' Плану не из чего вывести партию — он считает этим заданиям лишнюю смену сырья.'
            : (supplyOnly
                ? ' План записан как есть — заказу не хватает проходов: добавьте их заданию («Полосы» → проходы) или создайте задание.'
                : ' План записан как есть — проверьте эти дни.');
        return { text: 'В плане есть отклонения: ' + shown.join('; ')
                     + (rest > 0 ? '; …и ещё ' + rest : '') + '.' + tail,
                 kind: dataOnly ? 'error' : 'warning',
                 // items — те же фразы отдельно: их берёт отказ «Упорядочить» (там свой хвост
                 // «снимите 🔒 / освободите день», а плана-то как раз и не будет).
                 items: items, shown: shown, rest: rest };
    }

    // #4413: планируемая занятость станка заданием (мин) — «Наладка ножей» + «Сырьё/намотка» +
    // «Резка и Лидер», как её показывает очередь (#3846) и пересобирает #4408. Хранимых колонок нет
    // → «Длительность, минут». runsOverride (проходы кандидата) масштабирует намоточную часть: план
    // мог разорвать задание по дням, и голова занимает станок меньше исходного. → минуты (≥ 0).
    function cutOccupancyMinutes(cut, runsOverride) {
        if (!cut) return 0;
        var setup = Math.round(stripNum(cut.storedKnifeSetupMin)) + Math.round(stripNum(cut.storedMaterialWindingMin));
        var work = Math.round(stripNum(cut.storedCutAndLeaderMin));
        if (!(work > 0)) work = Math.round(stripNum(cut.duration));
        var runsNow = stripNum(cut.plannedRuns);
        var runsNew = (runsOverride == null) ? runsNow : Math.max(0, Number(runsOverride) || 0);
        if (runsNow > 0 && runsNew !== runsNow) work = Math.round(work * (runsNew / runsNow));
        return Math.max(0, setup + work);
    }

    // #4047/#4064/#4413/#4440: выбор кандидата «Упорядочить». before/objC/objB/objA — КОМБИНИРОВАННЫЙ
    // объектив (заданий_в_«Отпуске» × DOWNTIME_CONFLICT_WEIGHT + дни_опоздания × LATE_DAY_WEIGHT +
    // переналадка). Кандидаты РАВНОПРАВНЫ — берём тот, чей объектив МЕНЬШЕ, без деления на
    // «глобальный/локальный» (#4440):
    //   C — перестановка ВНУТРИ дня (дни и станки те же), objC = Infinity, если переставлять нечего;
    //   B — порядок/дни на текущих станках;
    //   A — со сменой станка, objA = Infinity, если переназначения нет.
    // При РАВНОМ объективе выигрывает менее «шумный» кандидат: C (ничего не переезжает) → B (станки
    // на месте) → A. Лучший НЕ строго меньше текущего → 'none' (план не трогаем). Так «Упорядочить»
    // НЕ увеличивает ни опоздания, ни (при равных опозданиях) переналадку, но РАДИ сокращения
    // опозданий переналадку увеличить может (срок важнее, #4064).
    // → { action:'none'|'C'|'B'|'A', obj }.
    function chooseOptimizeCandidate(before, objB, objA, reassignChanged, objC) {
        var ranked = [{ action: 'C', obj: Number(objC == null ? Infinity : objC) },
                      { action: 'B', obj: Number(objB) }];
        if (reassignChanged) ranked.push({ action: 'A', obj: Number(objA) });
        var best = null;
        ranked.forEach(function(c) { if (isFinite(c.obj) && (!best || c.obj < best.obj)) best = c; });
        if (!best || !(best.obj < before)) return { action: 'none', obj: before };
        return { action: best.action, obj: best.obj };
    }

    // #4409: сколько ПЕРЕМЕЩЕНИЙ печатать поимённо. Остаток не замалчиваем — пишем «…и ещё N».
    var OPT_TRACE_MOVES_LIMIT = 60;

    // #4409: структурный trace «Упорядочить» → строки лога [pp-opt]. ЧИСТАЯ (покрыта тестом):
    // на вход — уже готовые числа и ПОДПИСИ времени (форматирование дат — на стороне контроллера,
    // чтобы функция не зависела от таймзоны). Разделы ровно те, что просил заказчик (#4409):
    // СТАРТ → КАНДИДАТЫ → ВЫБОР → ПЕРЕМЕЩЕНИЯ → РЕЗУЛЬТАТ → СТОП.
    //   trace = {
    //     start:   { cutCount, fixedCount, slitterCount, windowLabel, lateBefore, coBefore,
    //                downtimeBefore, underfilledBefore },
    //     candidates: [{ key:'B'|'A', title, skipped?, reassignCount?, late, changeover,
    //                    downtime, downtimeIds, underfilled, underfilledDays }],
    //     choice:  { action:'none'|'B'|'A', title },
    //     moves:   [{ cutId, slitterFrom, slitterTo, whenFrom, whenTo }], movesTotal,
    //     creates: [{ parentCutId, when, runs }], createsTotal,
    //     deletes: [id], deletesTotal,
    //     result:  { before, after },   // computeQualityStats до/после проекции
    //     stop:    { code, text }
    //   }
    // #4622: ШТРАФ КАНДИДАТА ЗА НАРУШЕНИЯ §15 — без унаследованного перебора дней.
    // Правила делятся надвое:
    //   • DAY_CAPACITY — «в дне не хватило места». Это не порок кандидата, а состояние плана:
    //     лишнее обязано ехать в следующий день. Кандидат отвечает лишь за то, что ДОБАВИЛ сверх
    //     уже переполненных станко-дней (capBefore);
    //   • все прочие (🔒-монолит FIXED_BLOCK, FIXED_NO_PUSH, CHAIN_CONTIGUOUS, SUPPLY_CONSERVED…)
    //     — пороки самого кандидата, вето по ним АБСОЛЮТНОЕ и осталось прежним (#4471/#4464).
    //   list — нарушения кандидата, capBefore — переполненных станко-дней в записанном плане.
    // → число, которое идёт в объектив с весом RULE_BREAK_WEIGHT.
    function effectiveRuleBreaks(list, capBefore) {
        var cap = 0, other = 0;
        (list || []).forEach(function(v) {
            if (v && v.rule === 'DAY_CAPACITY') cap++; else other++;
        });
        return other + Math.max(0, cap - (Number(capBefore) || 0));
    }

    function formatOptimizeTrace(trace) {
        var t = trace || {};
        var out = [];
        function num(v) {
            var n = Number(v);
            return isFinite(n) ? String(round3(n)) : '—';
        }
        // Вердикт кандидата против текущего плана — ЛЕКСИКОГРАФИЧЕСКИ (#4413 «Отпуск» старше срока,
        // срок §14 старше упаковки дня #4469, упаковка старше переналадки — см. веса
        // DOWNTIME_CONFLICT_WEIGHT/LATE_DAY_WEIGHT/UNDERFILL_DAY_WEIGHT): сперва задания в окне
        // «Отпуска», затем дни опоздания, затем недоупакованные дни, при равных — минуты переналадки.
        function verdict(late, co, s, downtime, underfilled, underfilledRuleBreaks, byRule) {
            var dLate = round3(Number(late) - Number(s.lateBefore));
            var dCo = round3(Number(co) - Number(s.coBefore));
            var dtNow = Number(downtime), dtWas = Number(s.downtimeBefore);
            if (isFinite(dtNow) && isFinite(dtWas) && dtNow !== dtWas) {
                return (dtNow < dtWas ? 'ЛУЧШЕ' : 'ХУЖЕ') + ': в окне «Отпуска» ' + dtWas + ' → ' + dtNow
                    + ' заданий (станок в это время не работает — старше срока)';
            }
            // #4622: ОТКАЗ — ТОЛЬКО ЗА НОВОЕ НАРУШЕНИЕ, а не за унаследованное. «Упорядочить» —
            // РУЧНОЕ действие, а ручное действие отказа не получает (решение заказчика 02.08 и
            // 05.08.2026): «если ручное действие говорит, что надо что-то подвинуть в будущее —
            // двигаем безусловно». Сравниваем с числом нарушений ХРАНИМОГО плана (s.ruleBreaksBefore).
            // Та же мерка, что в объективе: унаследованный перебор дней отказом не является,
            // остальные жёсткие правила ветируют абсолютно.
            if (effectiveRuleBreaks(byRule, s.capacityBreaksBefore) > 0) {
                return 'ХУЖЕ: кандидат ДОБАВЛЯЕТ нарушение ТЗ §15 — применять нельзя';
            }
            if (dLate < 0) return 'ЛУЧШЕ: опозданий ' + num(dLate) + ' дн';
            if (dLate > 0) return 'ХУЖЕ: опозданий +' + num(dLate) + ' дн (срок старше переналадки)';
            var ufNow = Number(underfilled), ufWas = Number(s.underfilledBefore);
            if (isFinite(ufNow) && isFinite(ufWas) && ufNow !== ufWas) {
                return (ufNow < ufWas ? 'ЛУЧШЕ' : 'ХУЖЕ') + ': недоупакованных дней ' + ufWas + ' → ' + ufNow
                    + ' (день пакуется до потолка смены — старше переналадки)';
            }
            if (dCo < 0) return 'ЛУЧШЕ: опоздания те же, переналадка ' + num(dCo) + ' мин';
            if (dCo > 0) return 'ХУЖЕ: опоздания те же, переналадка +' + num(dCo) + ' мин';
            return 'РАВНО текущему';
        }
        var s = t.start || {};
        out.push('═══ УПОРЯДОЧИТЬ (#4409) ═══');
        if (!t.start) {
            out.push('СТАРТ: показатели текущего плана посчитать не успели (см. СТОП)');
        } else {
            out.push('СТАРТ: заданий ' + (s.cutCount || 0) + ' (зафиксировано ' + (s.fixedCount || 0) + '), станков '
                + (s.slitterCount || 0) + ', окно ' + (s.windowLabel || 'весь горизонт'));
            out.push('  текущий план: опозданий ' + num(s.lateBefore) + ' дн, переналадка ' + num(s.coBefore) + ' мин'
                // #4413: строку про «Отпуск» показываем, только если нарушения есть.
                + (s.downtimeBefore ? ', в окне «Отпуска» станка заданий ' + s.downtimeBefore
                    + ((s.downtimeIds || []).length ? ' (' + s.downtimeIds.join(', ') + ')' : '') : '')
                // #4469: то же для дней, не набитых до потолка смены.
                + (s.underfilledBefore ? ', недоупакованных дней ' + s.underfilledBefore
                    + ((s.underfilledDays || []).length ? ' (' + s.underfilledDays.join(', ') + ')' : '') : '')
                // #4622: нарушения §15 УЖЕ ЗАПИСАННОГО плана — база, с которой сравнивается кандидат.
                // Без неё в логе не видно, за СВОЁ ли нарушение отвергли кандидата или за чужое.
                + (s.capacityBreaksBefore ? ', переполненных станко-дней в текущем плане: ' + s.capacityBreaksBefore : ''));
        }
        (t.candidates || []).forEach(function(c) {
            var head = 'КАНДИДАТ ' + c.key + ' (' + c.title + ')';
            if (c.skipped) { out.push(head + ': не считался — ' + c.skipped); return; }
            // #4471: не только СЧЁТ, но и ВИНОВНЫЕ — иначе «ХУЖЕ: в «Отпуске» 0 → 1» не проверить
            // и не понять, из-за какого задания выброшен весь план.
            out.push(head + (c.reassignCount != null ? ', переназначений станка ' + c.reassignCount : '')
                + ': опозданий ' + num(c.late) + ' дн, переналадка ' + num(c.changeover) + ' мин'
                + (c.ruleBreaks ? ', НАРУШЕНИЙ ТЗ §15: ' + c.ruleBreaks
                    + ((c.ruleBreakMsgs || []).length ? ' (' + c.ruleBreakMsgs.join('; ') + ')' : '') : '')
                + ((c.downtime || s.downtimeBefore) ? ', в «Отпуске» ' + (c.downtime || 0)
                    + ((c.downtimeIds || []).length ? ' (' + c.downtimeIds.join(', ') + ')' : '') : '')
                + ((c.underfilled || s.underfilledBefore) ? ', недоупаковано дней ' + (c.underfilled || 0)
                    + ((c.underfilledDays || []).length ? ' (' + c.underfilledDays.join(', ') + ')' : '') : '')
                + ' → ' + verdict(c.late, c.changeover, s, c.downtime, c.underfilled, c.ruleBreaks, c.ruleBreakList));
        });
        var ch = t.choice || {};
        out.push(ch.action === 'none' || !ch.action
            ? 'ВЫБОР: НЕТ — ни один кандидат не лучше текущего, план НЕ трогаем'
            : ('ВЫБОР: ' + ch.action + ' — ' + (ch.title || '')));
        var total = t.movesTotal != null ? t.movesTotal : (t.moves || []).length;
        if (total > 0) {
            out.push('ПЕРЕМЕЩЕНИЯ: ' + total);
            (t.moves || []).forEach(function(m) {
                var sameSlitter = !m.slitterTo || m.slitterTo === m.slitterFrom;
                out.push('  ' + m.cutId + ': ' + (m.whenFrom || '—') + ' → ' + (m.whenTo || '—')
                    + (sameSlitter ? ' (станок тот же: ' + (m.slitterFrom || '—') + ')'
                                   : ' · станок ' + (m.slitterFrom || '—') + ' → ' + m.slitterTo));
            });
            if (total > (t.moves || []).length) {
                out.push('  …и ещё ' + (total - (t.moves || []).length) + ' — поимённо показаны первые ' + (t.moves || []).length);
            }
        }
        if (t.createsTotal) {
            out.push('НОВЫЕ СЕГМЕНТЫ (появятся по «Применить»): ' + t.createsTotal);
            (t.creates || []).forEach(function(c) {
                out.push('  от ' + c.parentCutId + ': ' + (c.when || '—') + ', проходов ' + (c.runs == null ? '—' : c.runs));
            });
            if (t.createsTotal > (t.creates || []).length) {
                out.push('  …и ещё ' + (t.createsTotal - (t.creates || []).length));
            }
        }
        if (t.deletesTotal) {
            out.push('УДАЛЯЕТСЯ ЗАПИСЕЙ: ' + t.deletesTotal + ((t.deletes || []).length ? ' — ' + t.deletes.join(', ') : '')
                + (t.deletesTotal > (t.deletes || []).length ? ' …и ещё ' + (t.deletesTotal - t.deletes.length) : ''));
        }
        var r = t.result;
        if (r && r.before && r.after) {
            out.push('РЕЗУЛЬТАТ (окно панели «Качество плана»):');
            out.push('  переналадки: ' + r.before.changeoverCount + ' (' + r.before.changeoverMin + ' мин) → '
                + r.after.changeoverCount + ' (' + r.after.changeoverMin + ' мин)');
            out.push('  ножи: ' + r.before.knifeCount + ' (' + r.before.knifeMin + ' мин) → '
                + r.after.knifeCount + ' (' + r.after.knifeMin + ' мин); смены сырья: '
                + r.before.materialCount + ' (' + r.before.materialMin + ' мин) → '
                + r.after.materialCount + ' (' + r.after.materialMin + ' мин)');
            out.push('  просрочено заданий: ' + r.before.overdue + ' → ' + r.after.overdue);
        }
        var st = t.stop || {};
        out.push('СТОП: ' + (st.text || st.code || '—'));
        return out;
    }

    function emitOptimizeTrace(trace) {
        if (!optTraceOn()) return;
        formatOptimizeTrace(trace).forEach(function(line) { optTrace(line); });
    }

    // #4047: суммарная переналадка (мин) набора резок за весь горизонт [С; конец] — ОБЪЕКТИВ
    // «Упорядочить» (planQuality.all.changeoverMin, ВЕСА штрафов: инкремент полос, смена сырья
    // первого задания). Это НЕ показанный оператору факт: панель/тултип «Качество плана» с #4156
    // берут факт из хранимых колонок наладки (storedSetupTotals, = отчёт «Комбинации», плоские ножи),
    // а веса оставлены сравнению кандидатов. Порядок ВНУТРИ дня берём по РЕАЛЬНОМУ planStart (c.number
    // либо override из ops кандидата), а не 0 — иначе перестановка задач внутри дня/станка (главная
    // работа «Упорядочить») в метрике не видна. ops (опц.) — операции плана-кандидата; нет ops →
    // ХРАНИМЫЙ план. #4471: станок берётся из плана (`u.slitterId`), а не из хранимой записи — слой
    // размещения переназначает станок и в кандидате B, и переналадка считалась по ЧУЖИМ очередям.
    // Новые сегменты (creates) в метрику не подаются: та же конфигурация, переналадки не добавляют.
    AtexProductionPlanning.prototype.planChangeoverMin = function(cutsArray, ops) {
        var self = this;
        var slots = this.planLayoutItems(cutsArray, ops).filter(function(it) { return !it.isCreate; }).map(function(it) {
            var c = it.cut;
            var ts = it.ts;
            return {
                id: c.id,
                slitterId: it.slitterId,
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
        // #4371: заправка станков в метрику не подаётся — первое задание каждого станка считается
        // «с нуля» (§13 п.4) одинаково у текущего плана и у кандидатов, поэтому сравнение честное.
        return planQuality(slots, { settings: self.daySettings }).all.changeoverMin;
    };

    // #4413: задания плана, СТОЯЩИЕ в окне «Отпуска» своего станка (или в нерабочем дне) — станок
    // тогда не работает, план невыполним. Считаем на той же оси, что и планировщик
    // (blockedRangesBySlitter, #3764). Старший критерий «Упорядочить», выше срока:
    // DOWNTIME_CONFLICT_WEIGHT. #4471: окно задания — из ПЛАНА, который меряем (planLayoutItems):
    // станок и минуты кандидата от упаковщика, удалённые записи не считаем, новые сегменты считаем.
    // ops (опц.) — операции кандидата; нет ops → ХРАНИМЫЙ план.
    // → массив id заданий-нарушителей (без повторов, в порядке очереди).
    AtexProductionPlanning.prototype.planDowntimeConflicts = function(cutsArray, ops) {
        var base = planBaseMidnightFrom(this.filter && this.filter.date, controllerNowMs(this));
        if (!isFinite(base)) return [];
        // Без метаданных окна простоя не читаются (стаб-self в юнит-тестах, как typeof-гарды выше):
        // простоев не знаем — нарушений не показываем.
        if (!this.meta || typeof this.blockedRangesBySlitter !== 'function') return [];
        var blocked = this.blockedRangesBySlitter(base);
        if (!blocked || !Object.keys(blocked).length) return [];
        var items = this.planLayoutItems(cutsArray, ops).map(function(it) {
            return { id: it.id, slitterId: it.slitterId, windowStartMin: it.windowStartMin, occMin: it.occMin };
        });
        var seen = {}, out = [];
        downtimeConflictCuts(items, blocked).forEach(function(id) {
            var k = String(id);
            if (seen[k]) return;   // #4471: голова и её новый сегмент — одна запись-нарушитель
            seen[k] = true; out.push(id);
        });
        return out;
    };

    // #4469: наладка задания по ХРАНИМЫМ колонкам («Наладка ножей» + «Сырьё-намотка») — та часть
    // занятости, которую разбиение по дням НЕ масштабирует (в отличие от «Резки и Лидера»).
    function cutSetupMinutes(cut) {
        if (!cut) return 0;
        var v = Math.round(stripNum(cut.storedKnifeSetupMin)) + Math.round(stripNum(cut.storedMaterialWindingMin));
        return v > 0 ? v : 0;
    }

    // #4471: план как список ЗАНЯТЫХ ОКОН станка — общая мерка для ВСЕХ членов объектива
    // «Упорядочить» (переналадка, «Отпуск», упаковка дня). Каждый план меряется СВОИМИ данными:
    //   ops == null — ХРАНИМЫЙ план: станок и минуты из записи (колонки наладки описывают именно его);
    //   ops — план КАНДИДАТА: станок (`u.slitterId`) и минуты (`u.occMin`/`u.setupMin`) даёт упаковщик,
    //     удалённые записи выброшены, новые сегменты (`ops.creates`) добавлены как работа.
    // Раньше из ops брали только `planStartTs` и проходы, а станок и занятость — из ХРАНИМОЙ резки.
    // Слой размещения (#4085) переназначает станок и в кандидате B, поэтому задание проверялось против
    // окон «Отпуска» ЧУЖОГО станка (фантомный конфликт), а занятость бралась от прошлой раскладки —
    // объектив врал, и «Упорядочить» выбрасывал план, снимавший две трети просрочки (issue #4471).
    // Хранимых `occMin`/`setupMin` в операции нет (ручные ops в тестах) → фолбэк на колонки записи,
    // масштабированные проходами кандидата.
    //   → [{ id, cut, slitterId, ts, dayOffset, windowStartMin, runs, setupMin, workMin, occMin,
    //        fixed, immovable, frozen, isCreate }]; порядок — очередь cuts, затем creates.
    AtexProductionPlanning.prototype.planLayoutItems = function(cutsArray, ops) {
        var self = this;
        var base = planBaseMidnightFrom(this.filter && this.filter.date, controllerNowMs(this));
        if (!isFinite(base)) return [];
        var freezeOn = !!(this.meta && this.meta.freeze && this.freezeByDay && Object.keys(this.freezeByDay).length);
        function frozenAt(ts) { return freezeOn && typeof self.dayIsFrozen === 'function' && !!self.dayIsFrozen(String(ts)); }
        var upd = {}, del = {}, cutsById = {};
        ((ops && ops.updates) || []).forEach(function(u) { if (u && u.cutId != null) upd[String(u.cutId)] = u; });
        ((ops && ops.deletes) || []).forEach(function(id) { del[String(id)] = true; });
        (cutsArray || []).forEach(function(c) { if (c && c.id != null) cutsById[String(c.id)] = c; });
        var out = [];
        function item(cut, op, ts, runs, isCreate) {
            var storedSetup = cutSetupMinutes(cut);
            var occ = (op && op.occMin != null) ? Math.max(0, Number(op.occMin))
                : cutOccupancyMinutes(cut, (op && op.plannedRuns != null) ? op.plannedRuns : null);
            var setup = (op && op.setupMin != null) ? Math.max(0, Number(op.setupMin))
                : (isCreate ? 0 : storedSetup);   // продолжение наладки не несёт (#3280)
            if (setup > occ) setup = occ;
            return {
                id: String(cut.id), cut: cut,
                slitterId: String(((op && op.slitterId != null) ? op.slitterId
                    : (cut.slitter && cut.slitter.id)) == null ? '' : ((op && op.slitterId != null) ? op.slitterId : cut.slitter.id)),
                ts: ts, dayOffset: dayOffsetFromBase(String(ts), base),
                windowStartMin: Math.round((Number(ts) * 1000 - base) / 60000),
                runs: Math.max(0, Number(runs) || 0),
                setupMin: setup, workMin: Math.max(0, occ - setup), occMin: occ,
                // #4434: 🔒 держит свой день; #4381: начатое задание неприкосновенно, завершённое — не работа плана.
                fixed: !!cut.fixed,
                immovable: cutIsStarted(cut) || String(cut.status || '').trim() === 'Завершён',
                frozen: frozenAt(ts), isCreate: !!isCreate
            };
        }
        (cutsArray || []).forEach(function(c) {
            if (!c || c.id == null || del[String(c.id)]) return;
            var u = upd[String(c.id)];
            var ts = (u && u.planStartTs != null) ? Number(u.planStartTs)
                : (Number(c.number) > 0 ? Number(c.number) : Number(c.planDate));
            if (!(ts > 0)) return;
            var runs = (u && u.plannedRuns != null) ? u.plannedRuns : c.plannedRuns;
            var it = item(c, u, ts, runs, false);
            if (it.dayOffset != null) out.push(it);
        });
        ((ops && ops.creates) || []).forEach(function(cr) {
            if (!cr || cr.planStartTs == null) return;
            var head = cutsById[String(cr.parentCutId)];
            if (!head) return;
            // Занятости упаковщик не дал (ручные ops) — доля головы по проходам (#3280: та же конфигурация).
            var op = cr;
            if (cr.occMin == null) {
                var headRuns = Number(head.plannedRuns) || 0;
                var headWork = Math.max(0, cutOccupancyMinutes(head, null) - cutSetupMinutes(head));
                op = { slitterId: cr.slitterId, plannedRuns: cr.plannedRuns, setupMin: 0,
                       occMin: headRuns > 0 ? Math.round(headWork * ((Number(cr.plannedRuns) || 0) / headRuns)) : headWork };
            }
            var it = item(head, op, Number(cr.planStartTs), cr.plannedRuns, true);
            if (it.dayOffset != null) out.push(it);
        });
        return out;
    };

    // #4469 (ТЗ §15): станко-дни плана, которые остались НЕДОУПАКОВАННЫМИ — в остаток дня (до
    // потолка нахлёста резки) влезает хотя бы один проход первого задания следующего дня, а оно
    // целиком стои́т завтра. Такой план обещает оператору простой в конце смены и лишний день в
    // хвосте плана (issue #4469: 424 мин при потолке 455, назавтра 24 прохода по 2.33).
    //
    // Меряем на той же оси, что планировщик, и ТЕМ ЖЕ планом (#4471, planLayoutItems): станок и
    // минуты кандидата даёт упаковщик, удалённые записи выброшены, новые сегменты добавлены.
    // Потолок дня — ёмкость смены (окно резки минус обед) плюс нахлёст РЕЗКИ, минус «Отпуск»/
    // выходной этого дня (blockedRangesBySlitter — как ёмкость считает сам упаковщик, #3978).
    // Правило и исключения — общие с движком: underfilledLayoutDays (🔒 не донор, замороженный
    // день не трогаем, проход атомарен). → массив ключей «станок|ГГГГММДД».
    AtexProductionPlanning.prototype.planUnderfilledDays = function(cutsArray, ops) {
        var base = planBaseMidnightFrom(this.filter && this.filter.date, controllerNowMs(this));
        if (!isFinite(base)) return [];
        // Стаб-self в юнит-тестах прототипа не несёт (как typeof-гарды ниже) — окно не прочитать.
        if (typeof this.workingWindow !== 'function') return [];
        var w = this.workingWindow();
        var dayStartMin = Number(w.startMin) || 0, cutEndMin = Number(w.cutEndMin) || 0;
        var capacity = dayCapacityMinutes(w, 'cuts');   // #4563: один потолок на всех
        var ceiling = capacity;
        if (!(capacity > 0)) return [];
        // #3978: минуты «Отпуска»/выходного внутри окна дня уменьшают его ёмкость.
        // Без метаданных окна простоя не читаются (стаб-self в юнит-тестах) — считаем день целым.
        var blocked = (this.meta && typeof this.blockedRangesBySlitter === 'function')
            ? (this.blockedRangesBySlitter(base) || {}) : {};
        function lostToBlock(sid, day) {
            var ranges = blocked[String(sid)] || [];
            var ws = day * 1440 + dayStartMin, we = day * 1440 + cutEndMin, sum = 0;
            ranges.forEach(function(r){
                var s = (r && r.start != null) ? r.start : r[0], e = (r && r.end != null) ? r.end : r[1];
                var lo = Math.max(ws, Number(s)), hi = Math.min(we, Number(e));
                if (hi > lo) sum += hi - lo;
            });
            return sum;
        }
        var byMachine = {}, mOrder = [];
        this.planLayoutItems(cutsArray, ops).forEach(function(it){
            var key = String(it.slitterId);
            if (!byMachine[key]) { byMachine[key] = []; mOrder.push(key); }
            byMachine[key].push({
                cutId: it.id, dayOffset: it.dayOffset, windowStartMin: it.windowStartMin,
                runs: it.runs, setupMin: it.setupMin, durationMin: it.workMin,
                // #4434: 🔒 держит свой день — вчерашнему дню проходов не отдаёт; #4381: начатое не трогаем.
                fixedDayLock: it.fixed, immovable: it.immovable, frozen: it.frozen
            });
        });
        var out = [];
        mOrder.forEach(function(sid){
            var items = byMachine[sid];
            var loadByDay = {}, frozenByDay = {};
            items.forEach(function(it){
                loadByDay[it.dayOffset] = (loadByDay[it.dayOffset] || 0) + it.setupMin + it.durationMin;
                if (it.frozen) frozenByDay[it.dayOffset] = true;
            });
            underfilledLayoutDays(items, {
                freeMinFor: function(d){ return ceiling - (loadByDay[d] || 0) - lostToBlock(sid, d); },
                isFrozenDay: function(d){ return !!frozenByDay[d]; }
            }).forEach(function(u){
                out.push(String(sid) + '|' + dayKeyFromOffset(base, u.day));
            });
        });
        return out;
    };

    // #4064: суммарные дни опоздания плана — Σ по резкам max(0, день размещения − срок). День
    // размещения берём из ПЛАНА, который меряем (#4471, planLayoutItems: старт кандидата, иначе
    // хранимый), срок — dueKey (YYYYMMDD). Старший критерий «Упорядочить» (срок —
    // ТЗ §14), выше переналадки: см. LATE_DAY_WEIGHT и chooseOptimizeCandidate.
    AtexProductionPlanning.prototype.planLatenessDays = function(cutsArray, ops) {
        var self = this;
        var total = 0;
        this.planLayoutItems(cutsArray, ops).filter(function(it) { return !it.isCreate; }).forEach(function(it) {
            var c = it.cut;
            var ts = it.ts;
            var pKey = ts > 0 ? planDateDayKey(String(ts)) : planDateDayKey(c.planDate);
            // #4211: срок — по тому же правилу, что панель «просрочено: N» (#4161 countOverdueCuts →
            // cutDueKeys с фолбэком из обеспечения), а НЕ только хранимый c.dueKey. Иначе у продолжения-
            // перелива (#4209: свой dueKey пуст, срок держит обеспечение головы) опоздание=0, и
            // «Упорядочить» рапортует «оптимально» при «просрочено:1» в панели. Фолбэк на c.dueKey —
            // для юнит-стабов без supplies (cutDueKeys без обеспечений → []).
            var dueKeys = cutDueKeys(c, self.supplies, self.genPositions, true);
            var dueKey = (dueKeys && dueKeys.length) ? dueKeys[0] : c.dueKey;
            total += lateDaysOf(pKey, dueKey);
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
        // #4440: кандидат C — перестановка ВНУТРИ дня (дни и станки те же), равноправен с B и A.
        var localC = { updates: [], gainMin: 0 }, objC = Infinity, coC = Infinity;
        // #4413: задания, стоящие в окне «Отпуска» станка, — старший критерий (см. DOWNTIME_CONFLICT_WEIGHT).
        var dtBefore = [], dtB = [], dtA = [];
        // #4469: станко-дни, не набитые до потолка смены (ТЗ §15). Кандидат C переставляет ВНУТРИ дня —
        // состав дней тот же, поэтому его недоупаковка равна текущей.
        var ufBefore = [], ufB = [], ufA = [];
        // #4471: нарушения жёстких правил ТЗ §15 в плане-кандидате (страж записи, ops.ruleBreaks).
        // У ХРАНИМОГО плана их не меряем — операций нет; вето односторонне и намеренно: применять
        // план, ломающий правило, нельзя, даже если текущий не идеален.
        var rbB = [], rbA = [];
        // #4622: нарушения ХРАНИМОГО плана — база, с которой сравнивается кандидат.
        // #4622: сколько станко-дней ЗАПИСАННОГО плана уже за потолком — база для DAY_CAPACITY.
        var capBefore = 0;
        // #4402: решение упаковщика по хвостам ТЕКУЩЕГО плана — buildSequenceOps ниже его перепишет
        // под кандидата; по «Отменить» возвращаем вместе со снимком очереди (иначе колонки наладки
        // считались бы по хвостам непринятого плана).
        var tailBefore = this.plannedTailSetup;
        // #4409: трассировка нажатия — старт/кандидаты/выбор/перемещения/результат/стоп одним блоком
        // в консоли ([pp-opt]). Заполняем по ходу, печатаем на КАЖДОМ выходе (ошибка, «не трогаем»,
        // предпросмотр) — иначе «ничего не происходит» остаётся без объяснения (issue #4409).
        var trace = { start: null, candidates: [], choice: null, moves: [], movesTotal: 0,
            creates: [], createsTotal: 0, deletes: [], deletesTotal: 0, result: null, stop: null };
        // #4413/#4469: объектив лексикографический — сперва задания в окне «Отпуска» (невыполнимо),
        // затем опоздания (срок §14), затем недоупакованные дни (ТЗ §15), затем переналадка.
        function combined(dt, rb, late, uf, co) {
            return dt * DOWNTIME_CONFLICT_WEIGHT + rb * RULE_BREAK_WEIGHT
                + late * LATE_DAY_WEIGHT + uf * UNDERFILL_DAY_WEIGHT + co;
        }
        try {
            coBefore = self.planChangeoverMin(self.cuts, null);
            lateBefore = self.planLatenessDays(self.cuts, null);
            dtBefore = self.planDowntimeConflicts(self.cuts, null);
            ufBefore = self.planUnderfilledDays(self.cuts, null);
            // #4622: ПЕРЕПОЛНЕННЫЕ ДНИ, КОТОРЫЕ УЖЕ ЕСТЬ В ЗАПИСАННОМ ПЛАНЕ. Кандидат не обязан
            // их чинить и не должен за них отвечать: «если ручное действие говорит, что надо
            // что-то подвинуть в будущее — двигаем безусловно» (решение заказчика 02.08 и
            // 05.08.2026). Прежде DAY_CAPACITY кандидата ветировался абсолютно, и план, однажды
            // попавший за потолок, запирался НАВСЕГДА: боевая ateh 05.08.2026 — 9 станко-дней сверх
            // потолка, 1642 дня опозданий, «Упорядочить» не делает ничего, хотя кандидат был лучше
            // по всем меркам и чинил главный перебор (Станок 2, 10.08: 620 → 537 мин).
            // Меряем ХРАНИМЫЙ план той же меркой, что и подсветка дня (#4531 overfilledDaysFromCuts),
            // а не пересборкой — второй арифметики не заводим (#4499).
            capBefore = self.capacityBreaksStored();
            before = combined(dtBefore.length, 0, lateBefore, ufBefore.length, coBefore);
            trace.start = {
                cutCount: (self.cuts || []).length,
                fixedCount: (self.cuts || []).filter(function(c) { return c && c.fixed; }).length,
                slitterCount: (self.slitters || []).length,
                windowLabel: self.optimizeWindowLabel(),
                lateBefore: round3(lateBefore), coBefore: round3(coBefore),
                downtimeBefore: dtBefore.length, downtimeIds: dtBefore.slice(0, 10),
                underfilledBefore: ufBefore.length, underfilledDays: ufBefore.slice(0, 10),
                // #4622: сколько жёстких правил §15 нарушает УЖЕ ЗАПИСАННЫЙ план — по этому числу
                // судится кандидат: отказ только за НОВОЕ нарушение.
                capacityBreaksBefore: capBefore
            };

            // Кандидат B: пересобрать порядок/дни на ТЕКУЩИХ станках (без переназначения).
            builtB = self.buildSequenceOps(self.cuts, PLANNING_STRATEGY_SETUP, false);
            // #4471: кандидат меряется СВОИМ планом целиком (станок и минуты от упаковщика), а не
            // картой стартов поверх хранимых колонок — иначе объектив врёт и хороший план выбрасывается.
            coB = self.planChangeoverMin(self.cuts, builtB.ops);
            lateB = self.planLatenessDays(self.cuts, builtB.ops);
            dtB = self.planDowntimeConflicts(self.cuts, builtB.ops);
            ufB = self.planUnderfilledDays(self.cuts, builtB.ops);
            rbB = (builtB.ops && builtB.ops.ruleBreaks) || [];
            objB = combined(dtB.length, effectiveRuleBreaks(rbB, capBefore), lateB, ufB.length, coB);
            trace.candidates.push({ key: 'B', title: 'порядок/дни на текущих станках',
                late: round3(lateB), changeover: round3(coB), downtime: dtB.length, underfilled: ufB.length,
                downtimeIds: dtB.slice(0, 10), underfilledDays: ufB.slice(0, 10),   // #4471: поимённо
                ruleBreaks: rbB.length, ruleBreakList: rbB,
                ruleBreakMsgs: rbB.slice(0, 5).map(function(v){ return v.rule + ': ' + v.msg; }) });

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
                coA = self.planChangeoverMin(self.cuts, builtA.ops);
                lateA = self.planLatenessDays(self.cuts, builtA.ops);
                // #4413/#4471: конфликты с «Отпуском» — по станку ИЗ ПЛАНА кандидата (ops.slitterId),
                // иначе задание проверяется против простоев не того станка.
                dtA = self.planDowntimeConflicts(self.cuts, builtA.ops);
                ufA = self.planUnderfilledDays(self.cuts, builtA.ops);
                rbA = (builtA.ops && builtA.ops.ruleBreaks) || [];
                objA = combined(dtA.length, effectiveRuleBreaks(rbA, capBefore), lateA, ufA.length, coA);
                trace.candidates.push({ key: 'A', title: 'со сменой станка',
                    reassignCount: Object.keys(plan.slitterByRecordId || {}).length,
                    late: round3(lateA), changeover: round3(coA), downtime: dtA.length, underfilled: ufA.length,
                    downtimeIds: dtA.slice(0, 10), underfilledDays: ufA.slice(0, 10),   // #4471: поимённо
                    ruleBreaks: rbA.length, ruleBreakList: rbA,
                    ruleBreakMsgs: rbA.slice(0, 5).map(function(v){ return v.rule + ': ' + v.msg; }) });
                Object.keys(saved).forEach(function(mid) { var c = cutsById[mid]; if (c) c.slitter = saved[mid]; });   // вернуть станки
            } else {
                trace.candidates.push({ key: 'A', title: 'со сменой станка',
                    skipped: 'переназначения станков нет (computeReassignmentPlan)' });
            }

            // #4440: кандидат C — перестановка ВНУТРИ дня на текущих станках и днях. Считается тем же
            // движком (resequenceWithinDays), но по ТЕКУЩЕМУ плану: состав дня, его номер и станок не
            // меняются, поэтому опоздания и конфликты с «Отпуском» те же — меняется только переналадка.
            // Кандидат равноправен с B и A: берём того, чей объектив меньше (issue #4440 — «какая
            // разница глобальный/локальный, что выгоднее, то и берём»).
            localC = self.intraDayImprovementOps();
            objC = Infinity;
            if (localC.updates.length && localC.gainMin > 0) {
                coC = round3(coBefore - localC.gainMin);
                // #4469: состав дней тот же — недоупаковка у C равна текущей (внутридневная перестановка
                // проходов между днями не двигает).
                objC = combined(dtBefore.length, 0, lateBefore, ufBefore.length, coC);   // C ничего не переносит — форма плана та же
                trace.candidates.push({ key: 'C', title: 'перестановка внутри дней (дни и станки те же)',
                    late: round3(lateBefore), changeover: coC, downtime: dtBefore.length, underfilled: ufBefore.length,
                    downtimeIds: dtBefore.slice(0, 10), underfilledDays: ufBefore.slice(0, 10) });
            } else {
                trace.candidates.push({ key: 'C', title: 'перестановка внутри дней (дни и станки те же)',
                    skipped: 'внутри дней переставлять нечего (порядок уже лучший)' });
            }
        } catch (err) {
            self.setBusy(false);
            console.error('[pp] ⚙️ optimizeQueue: ОШИБКА расчёта', err && err.message, err && err.stack);
            trace.stop = { code: 'error', text: 'ОШИБКА расчёта — ' + (err && err.message ? err.message : err) };
            emitOptimizeTrace(trace);
            self.notify('Ошибка упорядочивания: ' + (err && err.message ? err.message : err), 'error');
            return;
        }

        // Выбор кандидата: сперва меньше заданий в «Отпуске» (#4413 — невыполнимо), затем меньше
        // опозданий (срок §14), затем меньше переналадки; иначе не трогаем. #4440: кандидаты C/B/A
        // равноправны — что выгоднее, то и берём.
        var choice = chooseOptimizeCandidate(before, objB, objA, plan.changed, objC);
        if (choice.action === 'C') {
            self.setBusy(false);
            trace.choice = { action: 'C', title: 'перестановка внутри дней (дни и станки те же)' };
            var localOps = { updates: localC.updates, creates: [], deletes: [] };
            self.fillOptimizeMovesTrace(trace, localOps, null);
            self.startPlanPreview({
                ops: localOps,
                reassign: null,
                tailSetup: tailBefore,
                slitterChange: false,
                coBefore: round3(coBefore), coAfter: coC,
                lateBefore: round3(lateBefore), lateAfter: round3(lateBefore),   // дни не меняются
                downtimeBefore: dtBefore.length, downtimeAfter: dtBefore.length,
                underfilledBefore: ufBefore.length, underfilledAfter: ufBefore.length,   // #4469: состав дней тот же
                trace: trace
            });
            return;
        }
        if (choice.action === 'none') {
            self.setBusy(false);
            trace.choice = { action: 'none' };
            // #4413: задания стоят в окне «Отпуска», и переставить их не вышло — это старше просрочки
            // и молчать об этом нельзя (иначе «ничего не происходит» без объяснения).
            if (dtBefore.length) {
                trace.stop = { code: 'none-downtime', text: 'план НЕ изменён — в окне «Отпуска» станка осталось заданий: '
                    + dtBefore.length + ' (' + dtBefore.slice(0, 10).join(', ') + '); переставить их не удалось' };
                emitOptimizeTrace(trace);
                self.notify('Отпуск станка не обойти: в его окне стоят задания — ' + dtBefore.length
                    + '. Переставить не удалось (нет свободного места). Освободите день или сдвиньте задания вручную (🗓)', 'warning');
                return;
            }
            // #4471: кандидаты были, но каждый нарушал жёсткое правило ТЗ §15 — такой план не
            // применяется. Молчать нельзя: без этого «Упорядочить» выглядит сломанной кнопкой.
            var rbAll = rbB.concat(rbA);
            if (rbAll.length) {
                trace.stop = { code: 'none-rule', text: 'план НЕ изменён — кандидат нарушает жёсткое правило ТЗ §15: '
                    + rbAll.slice(0, 5).map(function(v){ return v.rule + ' (' + v.msg + ')'; }).join('; ') };
                emitOptimizeTrace(trace);
                // #4475: называем, ЧТО именно не так, теми же словами, что и при записи плана.
                var rbMsg = self.planAuditMessage(rbAll);
                self.notify('Пересчёт отклонён — предложенный план нарушал бы правило: '
                    + ((rbMsg && rbMsg.shown.join('; ')) || 'жёсткое правило ТЗ §15')
                    + ((rbMsg && rbMsg.rest > 0) ? '; …и ещё ' + rbMsg.rest : '')
                    + '. Снимите лишние 🔒 или освободите день.', 'warning');
                return;
            }
            // #4469: день не набит до потолка смены, а закрыть дыру ни один кандидат не смог — это
            // нарушение ТЗ §15, и молчать о нём (тем более рапортовать «оптимально») нельзя.
            if (ufBefore.length && !(round3(lateBefore) > 0)) {
                trace.stop = { code: 'none-underfill', text: 'план НЕ изменён — дней, не набитых до потолка смены: '
                    + ufBefore.length + ' (' + ufBefore.slice(0, 10).join(', ') + '); затянуть проходы следующего дня не удалось' };
                emitOptimizeTrace(trace);
                self.notify('День недоупакован: смен, не набитых до потолка, — ' + ufBefore.length
                    + '. Затянуть в них проходы следующего дня не удалось (мешает 🔒 или заморозка дня). Переналадка '
                    + round3(coBefore) + ' мин', 'warning');
                return;
            }
            // #4211: при НАЛИЧИИ просрочки НЕ рапортовать «очередь оптимальна» — переставить в срок не
            // удалось (нет свободного места раньше). «Оптимальна» — только когда опозданий реально нет.
            if (round3(lateBefore) > 0) {
                trace.stop = { code: 'none-overdue', text: 'план НЕ изменён — просрочка не устранена: опозданий '
                    + round3(lateBefore) + ' дн, раньше в срок не размещается (нет свободного места)' };
                emitOptimizeTrace(trace);
                self.notify('Просрочка не устранена: опозданий ' + round3(lateBefore) + ' дн — раньше в срок не размещается (нет свободного места). Переналадка ' + round3(coBefore) + ' мин', 'warning');
            } else {
                trace.stop = { code: 'none-optimal', text: 'план НЕ изменён — очередь уже оптимальна (опозданий 0 дн)' };
                emitOptimizeTrace(trace);
                self.notify('Очередь уже оптимальна (опозданий 0 дн, переналадка ' + round3(coBefore) + ' мин)', 'success');
            }
            return;
        }
        var useA = choice.action === 'A';
        var coBest = useA ? coA : coB, lateBest = useA ? lateA : lateB;
        var dtBest = useA ? dtA : dtB;   // #4413: сколько заданий остаётся в окне «Отпуска»
        var ufBest = useA ? ufA : ufB;   // #4469: сколько дней остаётся недоупакованными
        var built = useA ? builtA : builtB;
        var changedUpdates = filterChangedUpdates(built.ops, built.cutsById);
        // #4475: отклонения выбранного кандидата едут вместе с операциями — о них скажут при ЗАПИСИ
        // («Применить»), а не при расчёте: показанный предпросмотр ещё можно отменить.
        var ops = { updates: changedUpdates, creates: built.ops.creates || [], deletes: built.ops.deletes || [],
            audit: built.ops.ruleAudit || [] };
        trace.choice = { action: choice.action, title: useA ? 'со сменой станка' : 'порядок/дни на текущих станках' };
        self.fillOptimizeMovesTrace(trace, ops, useA ? plan.slitterByRecordId : null);

        // #4402: план НЕ пишем — показываем ПРЕДПРОСМОТР: проекция на очередь в памяти (карточки
        // перерисованы, видно, что куда уехало) + липкая панель со статистикой и кнопками
        // «Применить» / «Отменить». Запись — только по «Применить» (applyPendingPlan).
        self.setBusy(false);
        self.startPlanPreview({
            ops: ops,
            reassign: useA ? { slitterByRecordId: plan.slitterByRecordId, slitterReqId: plan.slitterReqId } : null,
            tailSetup: tailBefore,
            slitterChange: useA,
            coBefore: round3(coBefore), coAfter: round3(coBest),
            lateBefore: round3(lateBefore), lateAfter: round3(lateBest),
            downtimeBefore: dtBefore.length, downtimeAfter: dtBest.length,   // #4413
            underfilledBefore: ufBefore.length, underfilledAfter: ufBest.length,   // #4469
            trace: trace
        });
    };

    // #4409: подпись окна [С;По] фильтра для строки СТАРТ трассы.
    AtexProductionPlanning.prototype.optimizeWindowLabel = function() {
        var f = String((this.filter && this.filter.date) || '').trim();
        var t = String((this.filter && this.filter.dateTo) || '').trim();
        var from = f === '' ? '' : formatDayKey(planDateDayKey(f));
        var to = t === '' ? '' : formatDayKey(planDateDayKey(t));
        if (!from && !to) return 'весь горизонт';
        return (from || '…') + ' – ' + (to || '…');
    };

    // #4409: раздел ПЕРЕМЕЩЕНИЯ трассы — что куда уехало относительно ТЕКУЩЕЙ очереди (self.cuts
    // ещё не подменена проекцией). Поимённо печатаем первые OPT_TRACE_MOVES_LIMIT, остаток
    // не замалчиваем (formatOptimizeTrace допишет «…и ещё N»).
    // #4518: baseCuts — очередь, от которой считаем «было». По умолчанию текущая (`this.cuts`), но
    // предпросмотр перезаписывает её проекцией и передаёт СНИМОК: иначе «было» и «стало» совпали бы.
    AtexProductionPlanning.prototype.fillOptimizeMovesTrace = function(trace, ops, slitterByRecordId, baseCuts) {
        var byId = {};
        (baseCuts || this.cuts || []).forEach(function(c) { if (c) byId[String(c.id)] = c; });
        var slitterName = {};
        (this.slitters || []).forEach(function(s) { slitterName[String(s.id)] = s.label || s.name || ('#' + s.id); });
        function label(sid) {
            var k = String(sid == null ? '' : sid);
            return k === '' ? '—' : (slitterName[k] || ('#' + k));
        }
        var reassign = slitterByRecordId || {};
        var moves = [];
        ((ops && ops.updates) || []).forEach(function(u) {
            var c = byId[String(u.cutId)];
            if (!c) return;
            var fromSid = c.slitter ? c.slitter.id : '';
            var toSid = u.slitterId != null ? u.slitterId : (reassign[String(u.cutId)] != null ? reassign[String(u.cutId)] : fromSid);
            var whenFrom = formatPlanStamp(c.number || c.planDate);
            var whenTo = formatPlanStamp(u.planStartTs);
            // Апдейт-«родитель разбиения» может не двигаться сам (filterChangedUpdates держит его
            // ради долей Обеспечения) — такой в перемещения не пишем, он виден в НОВЫХ СЕГМЕНТАХ.
            if (whenFrom === whenTo && String(fromSid) === String(toSid)) return;
            moves.push({ cutId: String(u.cutId), slitterFrom: label(fromSid), slitterTo: label(toSid),
                whenFrom: whenFrom, whenTo: whenTo });
        });
        trace.movesTotal = moves.length;
        trace.moves = moves.slice(0, OPT_TRACE_MOVES_LIMIT);
        var creates = ((ops && ops.creates) || []).map(function(cr) {
            return { parentCutId: String(cr.parentCutId), when: formatPlanStamp(cr.planStartTs), runs: cr.plannedRuns };
        });
        trace.createsTotal = creates.length;
        trace.creates = creates.slice(0, OPT_TRACE_MOVES_LIMIT);
        var deletes = ((ops && ops.deletes) || []).map(String);
        trace.deletesTotal = deletes.length;
        trace.deletes = deletes.slice(0, OPT_TRACE_MOVES_LIMIT);
        return trace;
    };

    // #4402: сводка качества плана по текущему this.cuts за окно [С;По] — те же числа, что панель
    // «Качество» под очередью: ФАКТ переналадки из ХРАНИМЫХ колонок (#4156, storedSetupTotals),
    // идеал из planQualityView, просрочка из countOverdueCuts. Липкая панель показывает её дважды —
    // до проекции плана («Было») и после («Станет»).
    AtexProductionPlanning.prototype.computeQualityStats = function(scopeFromKey, scopeToKey) {
        // #4371: prevSetupBySlitter сюда не передаём — читаем только idealWindow/combinationsWindow,
        // а они от заправки станков не зависят (ФАКТ идёт из хранимых колонок).
        var pqView = planQualityView(this.cuts, {
            settings: this.daySettings,
            scopeFromKey: scopeFromKey,
            scopeToKey: scopeToKey
        });
        var overdueCount = countOverdueCuts(this.cuts, this.supplies, this.genPositions,
            { scopeFromKey: scopeFromKey, scopeToKey: scopeToKey, forecastDays: this.daysForecast() });
        var setupTot = this.storedSetupTotals(scopeFromKey, scopeToKey);
        var qId = pqView.idealWindow, qW = setupTot.window;
        return {
            hasStored: setupTot.hasStored,
            taskCount: qW.taskCount,
            changeoverCount: qW.changeoverCount, changeoverMin: qW.changeoverMin,
            knifeCount: qW.knifeCount, knifeMin: qW.knifeMin,
            materialCount: qW.materialCount, materialMin: qW.materialMin,
            idealCount: qId.count, idealMin: qId.minutes,
            excessCount: qW.changeoverCount - qId.count,
            excessMin: round3(qW.changeoverMin - qId.minutes),
            combinations: pqView.combinationsWindow,
            overdue: overdueCount
        };
    };

    // #4518: колонки наладки УПАКОВЩИКА для проекции предпросмотра — та же карта, что «Применить»
    // отдаёт в persistCutSetupColumns (#4499), только сегменты дробления записей ещё не имеют и
    // адресуются синтетическим id `preview:N`. projectPlanOnCuts возвращает `createdFrom` —
    // соответствие `createdIds[i]` ↔ `ops.creates[createdFrom[i]]` (создание без головы пропущено,
    // поэтому позиции не совпадают один в один). Чистая.
    // → { byCut: {cutId → {knife, material, cutTime}}, createIndex: {previewId → индекс в creates} }
    function previewPlanCols(ops, projected) {
        var byCut = {}, createIndex = {};
        ((ops && ops.updates) || []).forEach(function(u) {
            if (u && u.planCols) byCut[String(u.cutId)] = u.planCols;
        });
        var creates = (ops && ops.creates) || [];
        var ids = (projected && projected.createdIds) || [];
        var from = (projected && projected.createdFrom) || [];
        ids.forEach(function(pid, i) {
            var cr = creates[from[i]];
            if (!cr) return;
            createIndex[String(pid)] = from[i];
            if (cr.planCols) byCut[String(pid)] = cr.planCols;
        });
        return { byCut: byCut, createIndex: createIndex };
    }

    // #4518: снять колонки упаковщика с заданий тех СТАНКО-ДНЕЙ, порядок в которых поменяла
    // полировка #4446: у соседей другая конфигурация, и числа упаковщика этот день уже не описывают.
    // Мутирует переданную карту (её же читает следующий computeCutSetupUpdates).
    function dropPlanColsForTouchedDays(byCut, cuts, movedUpdates) {
        var touched = {};
        (movedUpdates || []).forEach(function(u) { if (u) touched[String(u.cutId)] = true; });
        var keyOf = function(c) {
            var sid = String((c && c.slitter && c.slitter.id) == null ? '' : c.slitter.id);
            return sid + '|' + planStartDayKey(Number(c && (c.planDate || c.number)));
        };
        var days = {};
        (cuts || []).forEach(function(c) { if (c && touched[String(c.id)]) days[keyOf(c)] = true; });
        (cuts || []).forEach(function(c) { if (c && days[keyOf(c)]) delete byCut[String(c.id)]; });
    }

    // #4402: показать предпросмотр пересчитанного плана. Проецирует ops (+ смену станков) на
    // КОПИЮ очереди, пересчитывает на ней колонки наладки (в памяти, без записи) и запоминает
    // _pendingPlan вместе со СНИМКОМ исходных резок — «Отменить» и F5 возвращают прежний план.
    AtexProductionPlanning.prototype.startPlanPreview = function(payload) {
        var self = this;
        var pend = payload || {};
        var pOps = pend.ops || {};
        // Показывать нечего — план уже такой (после filterChangedUpdates не осталось ни одного
        // изменения и станки не меняются). Молчать нельзя: кнопка нажата, ответ нужен.
        if (!(pOps.updates || []).length && !(pOps.creates || []).length && !(pOps.deletes || []).length && !pend.reassign) {
            if (pend.trace) {
                pend.trace.stop = { code: 'no-ops', text: 'план НЕ изменён — очередь уже в этом порядке (после отбора изменившихся ни одной записи)' };
                emitOptimizeTrace(pend.trace);
            }
            this.notify('Очередь уже в этом порядке — пересчёт ничего не меняет', 'info');
            return false;
        }
        var qFromStr = String((this.filter && this.filter.date) || '').trim();
        var qToStr = String((this.filter && this.filter.dateTo) || '').trim();
        var scopeFromKey = qFromStr === '' ? null : planDateDayKey(qFromStr);
        var scopeToKey = qToStr === '' ? null : planDateDayKey(qToStr);
        var snapshot = this.cuts || [];
        pend.before = this.computeQualityStats(scopeFromKey, scopeToKey);   // ДО — по текущей очереди
        var slitterById = {};
        (this.slitters || []).forEach(function(s) { slitterById[String(s.id)] = s; });
        var projected = projectPlanOnCuts(snapshot, pend.ops, {
            slitterById: slitterById,
            slitterByRecordId: pend.reassign ? pend.reassign.slitterByRecordId : null,
            // #3916: длительность сегмента — по ЕГО проходам (то же правило, что пишет applySplitPlan).
            durationForSegment: function(headCut, runs) {
                var P = Math.max(0, Math.round(Number(runs) || 0));
                if (!(P > 0)) return 0;
                return Math.ceil(plannedCutDurationMinutes(
                    cutRunLength(headCut, self.supplies, self.positionLengthById), P, self.opTimes, headCut));   // #4501: норма по самой узкой полосе
            }
        });
        this.cuts = projected.cuts;
        // #4518: ОДНА АРИФМЕТИКА. Колонки наладки предпросмотра берём У УПАКОВЩИКА (`ops.*.planCols`,
        // #4499) — ровно как их берёт «Применить» (applySplitPlan → persistCutSetupColumns). Считать
        // их здесь заново значит мерить план ВТОРЫМ независимым расчётом: день выходит «несведённым»,
        // #4444 переписывает старты, и оператор получает десяток правок «на 2 минуты», которых в
        // плане упаковщика не было, а трасса «Упорядочить» перестаёт совпадать с «Деталями»
        // (issue #4518: лог «ПЕРЕМЕЩЕНИЯ: 23», в модалке 21, времена на 2–6 минут другие).
        var planCols = previewPlanCols(pend.ops, projected);
        this._previewCreateIndex = planCols.createIndex;
        var setupRes = this.computeCutSetupUpdates(null, { planCols: planCols.byCut });
        // #4446: ГЛОБАЛЬНЫЙ кандидат выигрывает по всему горизонту, но внутри ОТДЕЛЬНОГО дня может
        // оставить заведомо худший порядок — оператор сравнивает свой ручной план с предложенным по
        // одному дню и видит, что предложенный хуже («левый план — предлагаемый — хуже правого — его
        // я делал вручную»). Полируем ВЫБРАННЫЙ кандидат тем же локальным проходом, что и кандидат C
        // (#4440): состав дня, его номер и станок не меняются, меняется только порядок внутри дня,
        // поэтому ни сроки, ни загрузка дней не страдают, а переналадка может только уменьшиться.
        var polished = this.intraDayImprovementOps();
        if (polished.updates.length) {
            this.applyPreviewStarts(polished.updates.map(function(u) {
                return { cutId: String(u.cutId), ts: Number(u.planStartTs) };
            }), pend.ops);
            // #4518: полировка сменила СОСЕДЕЙ в затронутых станко-днях — числа упаковщика этот
            // порядок больше не описывают, и для таких дней колонки считаем заново. Остальные дни
            // продолжают меряться числами упаковщика, иначе вернулась бы вторая арифметика целиком.
            dropPlanColsForTouchedDays(planCols.byCut, this.cuts, polished.updates);
            setupRes = this.computeCutSetupUpdates(null, { planCols: planCols.byCut });
            try {
                console.log('[pp] ⚙️ #4446: порядок ВНУТРИ дней подчищен поверх выбранного кандидата — '
                    + 'заданий ' + polished.updates.length + ', переналадка −' + round3(polished.gainMin) + ' мин');
            } catch (e) {}
        }
        // #4444: ПОКАЗЫВАЕМ РОВНО ТО, ЧТО ЗАПИШЕТСЯ. «Дату план» считает упаковщик, а колонки
        // наладки — computeCutSetupUpdates; расхождение этих двух расчётов рисуется на карточках
        // дырами и наложениями («если одно задание заканчивается в 14:38, я ожидаю увидеть другое,
        // начинающееся в это же время, а времена вообще никакие не совпадают — как проверять?») и
        // уводит последнее задание за конец смены (17:52 при потолке 16:40), хотя сумма минут дня в
        // норме. Записываемый план мы уже сводим встык (#4438, reconcilePlanStarts) — значит и
        // ПОКАЗЫВАТЬ надо сведённый, иначе предпросмотр показывает то, чего никогда не будет.
        // Сводим ПРОЕКЦИЮ и тем же сдвигом правим ops, чтобы «Применить» записал ровно показанное.
        // #4518: сверяем ТЕМИ ЖЕ колонками, что показаны, — иначе сведение меряет одно, а карточки
        // показывают другое, и «сведённым встык» оказывается план, который встык уже стоял.
        var stitched = this.reconcilePreviewStarts(pend.ops, setupRes.updates);
        if (stitched) setupRes = this.computeCutSetupUpdates(null, { planCols: planCols.byCut });   // старты новые — колонки перечитываем от них
        pend.after = this.computeQualityStats(scopeFromKey, scopeToKey);
        pend.snapshot = snapshot;
        pend.createdIds = projected.createdIds;
        pend.deletedIds = projected.deletedIds;
        // #4417: разбор «что у кого поменялось» — для модалки «Детали» и пометки карточек в очереди.
        // Считаем ПОСЛЕ пересчёта колонок наладки: тайминг проекции к этому моменту уже в памяти.
        var changes = planChangeRows(snapshot, projected.cuts, setupRes.updates,
            { slitterById: slitterById,
              // #4444: номер ЗАКЛАДКИ станка — им оператор и оперирует (имя станка ничего не говорит
              // о том, куда переключаться). Считаем по тем же данным, что рисуют вкладки.
              tabIndexById: slitterTabIndexMap(this.slitters, snapshot.concat(projected.cuts)) });
        pend.changes = changes;
        // #4518: ОДНО ЧИСЛО НА ВСЕХ. Панель, лог и трасса брали `projected.changedIds` — счёт ДО
        // полировки (#4446) и сведения (#4444), а «Детали» и «Применить» — то, что осталось ПОСЛЕ.
        // Оператор видел «переставлено 23» рядом со списком из 21 строки.
        pend.movedCount = changes.movedCount;
        projected.cuts.forEach(function(c) {
            var row = changes.byId[String(c.id)];
            if (row && row.kind === 'moved') c.previewChanged = row;   // карточку помечаем «изменено»
        });
        this._pendingPlan = pend;
        console.log('[pp] ⚙️ #4402 предпросмотр «Упорядочить»: переставлено ' + pend.movedCount
            + ', новых сегментов ' + projected.createdIds.length + ', удаляется ' + projected.deletedIds.length
            + ' (в БД НЕ записано)');
        if (pend.trace) {
            // #4518: перемещения в трассе — ИТОГОВЫЕ (после полировки и сведения): «изначальный
            // расчёт» в логе и список в «Деталях» обязаны быть одним и тем же планом. Времена «было»
            // берём из СНИМКА — this.cuts к этому моменту уже проекция.
            this.fillOptimizeMovesTrace(pend.trace, pend.ops,
                pend.reassign ? pend.reassign.slitterByRecordId : null, snapshot);
            pend.trace.result = { before: pend.before, after: pend.after };
            pend.trace.stop = { code: 'preview', text: 'предпросмотр показан — в БД НЕ записано, ждём «Применить» / «Отменить»' };
            emitOptimizeTrace(pend.trace);
        }
        this.render();
        return true;
    };

    // #4402: «Применить» — пишем отложенный план в БД. Пишем ОТ ИСХОДНОГО состояния (возвращаем
    // снимок): applySplitPlan сравнивает/лечит цепочки по self.cuts, а на экране была проекция с
    // синтетическими id. Флаг снимаем ДО записи — иначе её заблокирует защита в post() (#4402).
    AtexProductionPlanning.prototype.applyPendingPlan = function() {
        var self = this;
        var pend = this._pendingPlan;
        if (!pend || this.busy) return Promise.resolve(false);
        this._pendingPlan = null;
        this.cuts = pend.snapshot;
        this.plannedTailSetup = pend.tailSetup || {};
        this.renderPlanPreviewBar();   // панель уходит сразу по нажатию: дальше идёт запись
        optTrace('«ПРИМЕНИТЬ» — пишем показанный план в БД: заданий к обновлению '
            + ((pend.ops && pend.ops.updates || []).length) + ', создаётся ' + ((pend.ops && pend.ops.creates || []).length)
            + ', удаляется ' + ((pend.ops && pend.ops.deletes || []).length));
        this.setBusy(true);
        var ops = pend.ops || { updates: [], creates: [], deletes: [] };
        var hasOps = !!((ops.updates || []).length || (ops.creates || []).length || (ops.deletes || []).length);
        var chain = pend.reassign
            ? this.persistSlitterReassignment(pend.reassign.slitterByRecordId, pend.reassign.slitterReqId)
            : Promise.resolve(true);
        return chain.then(function() {
            if (!hasOps) return self.reload().then(function() { self.render(); });   // станки записаны, порядок/дни — нет
            return self.applySplitPlan(ops);
        }).then(function() {
            self.setBusy(false);
            optTrace('СТОП: план ЗАПИСАН в БД (опоздания ' + pend.lateBefore + ' → ' + pend.lateAfter
                + ' дн, переналадка ' + pend.coBefore + ' → ' + pend.coAfter + ' мин)');
            self.notify('Очередь упорядочена: опоздания ' + pend.lateBefore + ' → ' + pend.lateAfter + ' дн, '
                + 'переналадка ' + pend.coBefore + ' → ' + pend.coAfter + ' мин'
                // #4413: ради чего переставили, если сроки и переналадка не изменились.
                + ((Number(pend.downtimeBefore) || Number(pend.downtimeAfter))
                    ? ', в окне «Отпуска» ' + (Number(pend.downtimeBefore) || 0) + ' → ' + (Number(pend.downtimeAfter) || 0) + ' заданий' : '')
                // #4469: то же для дней, не набитых до потолка смены.
                + ((Number(pend.underfilledBefore) || Number(pend.underfilledAfter))
                    ? ', недоупакованных дней ' + (Number(pend.underfilledBefore) || 0) + ' → ' + (Number(pend.underfilledAfter) || 0) : '')
                + (pend.slitterChange ? ' (со сменой станка)' : ''), 'success');
            return true;
        }).catch(function(err) {
            self.setBusy(false);
            optTrace('СТОП: ОШИБКА записи — ' + (err && err.message ? err.message : err));
            console.error('[pp] ⚙️ optimizeQueue: ОШИБКА применения', err && err.message, err && err.stack);
            self.notify('Ошибка упорядочивания: ' + (err && err.message ? err.message : err), 'error');
            return false;
        });
    };

    // #4402: «Отменить» — возвращаем снимок очереди. В БД ничего не писали, поэтому отмена
    // (как и F5) просто отдаёт прежний план; проекция с синтетическими сегментами выбрасывается.
    AtexProductionPlanning.prototype.cancelPendingPlan = function() {
        if (this.busy) return false;
        var pend = this._pendingPlan;
        if (!pend) return false;
        this._pendingPlan = null;
        this.cuts = pend.snapshot;
        this.plannedTailSetup = pend.tailSetup || {};
        this.render();
        optTrace('СТОП: «ОТМЕНИТЬ» — план остался прежним, в БД ничего не писали');
        this.notify('Пересчёт отменён — план остался прежним', 'info');
        return true;
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
        var dayCapacityMin = dayCapacityMinutes(genWindow, 'cuts');   // #4563: один потолок на всех
        if (!(dayCapacityMin > 0)) return empty;
        var planOptions = makePlanningOptions(PLANNING_STRATEGY_SETUP, self.changeTimes, self.daySettings);   // #4059: веса из «Настройки»
        var planBaseMidnightMs = planBaseMidnightFrom(self.filter && self.filter.date, controllerNowMs(self));

        var merged = mergeContinuationChains(self.cuts || []);
        var chainByLogical = merged.chainByLogical || {};
        var openLogical = (merged.cuts || []).filter(function(c) { return String(c && c.status || '').trim() !== 'Завершён'; });
        function descOf(c) {
            var runLength = cutRunLength(c, self.supplies, self.positionLengthById);
            var runs = Number(c.plannedRuns) || 0;
            return {
                id: String(c.id),
                slitterId: (c.slitter && c.slitter.id != null) ? String(c.slitter.id) : '',
                materialId: c.materialId, winding: c.winding, batchId: c.batchId,
                knifeWidths: c.knifeWidths, knifeCount: c.knifeCount, isFoil: !!c.isFoil,
                width: c.width, planDate: c.planDate, plannedRuns: runs, runLength: runLength,
                duration: plannedCutDurationMinutes(runLength, runs, self.opTimes, c)   // #3606/#4501
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
        // #4477 (ТЗ §15): станок пишем только там, где он ДЕЙСТВИТЕЛЬНО меняется, и пулом до
        // MAX_PARALLEL_WRITES потоков. Было Promise.all — все записи цепочек разом, без предела
        // (сотня одновременных _m_set на большой очереди).
        var writes = ids.filter(function(mid) {
            var cc = cutsById[String(mid)];
            var curSid = (cc && cc.slitter && cc.slitter.id != null) ? String(cc.slitter.id) : '';
            return String(slitterByRecordId[mid]) !== curSid;
        });
        console.log('[pp] ⚙️ Упорядочить: смена станка у ' + writes.length + ' записей из ' + ids.length + ' (#4047/#4477)');
        if (!writes.length) return Promise.resolve(false);
        return runWithConcurrency(writes.map(function(mid) {
            return function() {
                var newSid = slitterByRecordId[mid];
                var fields = {}; fields['t' + slitterReqId] = newSid;
                return self.post('_m_set/' + encodeURIComponent(mid) + '?JSON', fields).then(function() {
                    var cc = cutsById[String(mid)];
                    if (cc) { if (!cc.slitter) cc.slitter = { id: newSid, label: '' }; else cc.slitter.id = newSid; }
                });
            };
        }), MAX_PARALLEL_WRITES).then(function() { return true; });
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
        // #4488: это часть задания, разорванного по дням, — говорим ДО переноса, что поедет ЦЕЛОЕ.
        // Части сшиваются в одну запись перед планированием вставки (ТЗ §15: хвостов не остаётся),
        // поэтому неважно, за какую часть тянут. Прежнее поведение (#4357: перенесённый сегмент
        // становился ОТДЕЛЬНЫМ заданием со своей наладкой) отменено этим правилом.
        var chainParts4488 = splitChainPartsOf(this.cuts || [], cut.id);
        if (chainParts4488.length > 1) {
            var otherRuns4488 = chainParts4488.reduce(function(sum, c) { return sum + (stripNum(c.plannedRuns) || 0); }, 0);
            content.appendChild(el('p', { class: 'atex-pp-hint atex-pp-move-detach-warn',
                text: 'ℹ Задание разорвано по дням на ' + chainParts4488.length + ' части. При переносе они '
                    + 'соберутся в ОДНО задание (' + otherRuns4488 + ' проходов) и поедут вместе; '
                    + 'если целое не влезет в день, планировщик разрежет его заново от нового места.' }));
        }

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

        // #4221: положение в дне: «По весу» (по умолчанию — позиция по наилучшему весу), в начало, в конец.
        var posWeight = el('input', { type: 'radio', name: 'atex-pp-move-pos' });
        posWeight.value = 'weight'; posWeight.checked = true;
        var posStart = el('input', { type: 'radio', name: 'atex-pp-move-pos' });
        posStart.value = 'start';
        var posEnd = el('input', { type: 'radio', name: 'atex-pp-move-pos' });
        posEnd.value = 'end';
        content.appendChild(el('div', { class: 'atex-pp-move-field' }, [
            el('span', { class: 'atex-pp-move-label', text: 'Положение' }),
            el('div', { class: 'atex-pp-move-pos' }, [
                el('label', { class: 'atex-pp-move-radio' }, [posWeight, el('span', { text: ' По весу' })]),
                el('label', { class: 'atex-pp-move-radio' }, [posStart, el('span', { text: ' В начало дня' })]),
                el('label', { class: 'atex-pp-move-radio' }, [posEnd, el('span', { text: ' В конец дня' })])
            ])
        ]));

        // #4221/#4225: «В пределах одного станка» — по умолчанию установлена. Перенос трогает только
        // задействованные станки (целевой и, при смене станка, исходный) и не перекидывает задания
        // между станками при пересборке по срокам.
        var withinCb = el('input', { type: 'checkbox' });
        withinCb.checked = true;
        content.appendChild(el('label', { class: 'atex-pp-move-fix' }, [
            withinCb, el('span', { text: ' В пределах одного станка' })
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
            var position = posEnd.checked ? 'end' : (posStart.checked ? 'start' : 'weight');   // #4221: «По весу» по умолчанию
            var withinSlitter = !!withinCb.checked;   // #4221: перенос только в пределах целевого станка
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
            self.moveCutToDay(cut, dateStr, position, fix, targetSlitterId, withinSlitter);
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
    // #4488: ПЕРЕД планированием вставки задание собирается из частей (ТЗ §15: хвостов не остаётся).
    // Тащат любую часть — едет целое: mergeSplitChain сливает цепочку в перетаскиваемую запись, и
    // дальше идёт обычный перенос уже цельного задания. Сшивать нечего → сразу обычный путь.
    AtexProductionPlanning.prototype.moveCutToDay = function(cut, targetDateStr, position, fix, targetSlitterId, withinSlitter) {
        var self = this;
        if (this.busy) return Promise.resolve(false);
        if (!cut) return Promise.resolve(false);
        if (cutIsStarted(cut)) { this.notify('Начатое задание нельзя перенести', 'info'); return Promise.resolve(false); }
        var moveId = String(cut.id);
        // Вызовы через прототип: метод зовут и на самодельных объектах (`prototype.moveCutToDay.call(self)`
        // в тестах и deep-link), у которых цепочки прототипов нет.
        var moveWhole = AtexProductionPlanning.prototype.moveWholeCutToDay;
        if (splitChainPartsOf(this.cuts || [], moveId).length < 2) {
            return moveWhole.call(this, cut, targetDateStr, position, fix, targetSlitterId, withinSlitter);
        }
        var stitch = (typeof this.mergeSplitChain === 'function')
            ? this.mergeSplitChain(moveId)
            : AtexProductionPlanning.prototype.mergeSplitChain.call(this, moveId);
        return stitch.then(function(stitched) {
            // Сшивание перечитало очередь — берём свежую запись (объект `cut` из прежней загрузки устарел).
            var fresh = (self.cuts || []).filter(function(c) { return c && String(c.id) === moveId; })[0];
            if (!fresh && stitched) {
                self.notify('Задание не найдено после сборки из частей', 'error');
                return false;
            }
            return moveWhole.call(self, fresh || cut, targetDateStr, position, fix, targetSlitterId, withinSlitter);
        });
    };

    AtexProductionPlanning.prototype.moveWholeCutToDay = function(cut, targetDateStr, position, fix, targetSlitterId, withinSlitter) {
        var self = this;
        this._ppOp = 'moveCutToDay';   // #4177/#4480: трасса обязана называть АВТОРА записи
        if (this.busy) return Promise.resolve(false);
        if (!cut) return Promise.resolve(false);
        // #4381: начатое задание не переносим. Кнопка «🗓» у него убрана, но метод зовут и иначе
        // (drag-drop между днями, deep-link) — проверка авторитетная, здесь.
        if (cutIsStarted(cut)) { this.notify('Начатое задание нельзя перенести', 'info'); return Promise.resolve(false); }
        var cutMeta = this.meta.cut;
        if (!cutMeta) { this.notify('Нет метаданных таблицы «' + TABLE.cut + '»', 'error'); return Promise.resolve(false); }
        var fixedReqId = reqIdByName(cutMeta, CUT_REQ.fixed);
        var slitterReqId = reqIdByName(cutMeta, CUT_REQ.slitter);   // #3669 п.1: ссылка «Слиттер»
        var firstPartReqId = reqIdByName(cutMeta, CUT_REQ.firstPart);   // #4357: маркер цепочки дробления
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
        // #4488: отвязки сегмента (#4357) здесь больше нет — цепочку сшивает `moveCutToDay` ДО этого
        // места, и сюда приходит цельное задание. Если запись всё же осталась частью (сшить не смогли
        // — например, часть уже начата), маркер не трогаем: разрывать связь молча нельзя.
        var detachId = null;
        var plan = planMoveSequences(cut.id, dayCuts, position);
        // #3923: желаемый порядок дня → плейсхолдер-planStart. Точные значения не важны — важен
        // ПОРЯДОК; autoSequenceQueue(preserveOrder) ниже переупакует и целевой, и исходный день
        // встык по сохранённому planStart.
        // #4477: соседи по целевому дню порядок не меняют — их времена ОСТАЮТСЯ прежними, новое
        // минтуется только вставляемому заданию (planMoveStarts). Прежняя перенумерация дня
        // целиком давала команду на сохранение каждому заданию дня, и все они тут же
        // переписывались упаковщиком.
        var placeholderByCut = planMoveStarts(plan.ordered, dayCuts, cut.id, targetTs).byCut;

        this.setBusy(true);
        var fixFieldKey = (fix && fixedReqId) ? 't' + fixedReqId : null;
        // 1) Перемещаемое задание: planStart (главное значение) → _m_save; затем фиксация/смена
        //    станка → _m_set (если есть). «Очередность» больше не пишем. Внутри одной записи
        //    порядок обязателен (_m_save → _m_set), с чужими записями — независимо.
        // 2) Прочие задания целевого дня — плейсхолдер-planStart (только изменившиеся).
        // #4477: и то, и другое — через шлюз saveCutStarts (пул до 5 потоков, пустышки отсеяны).
        var starts = [{ cutId: String(cut.id), ts: placeholderByCut[String(cut.id)] || targetTs }];
        dayCuts.forEach(function(c) {
            var ph = placeholderByCut[String(c.id)];
            if (ph != null) starts.push({ cutId: String(c.id), ts: ph, wasTs: c.planDate });
        });
        return postCutStarts(self, starts, {
            onPlan: function(n) { self.showProgress('Перенос задания…', n); },
            onWrite: function(done) { self.updateProgress(done); }
        }).then(function() {
            var fields = {};
            if (fixFieldKey) fields[fixFieldKey] = '1';
            if (slitterChanged) fields['t' + slitterReqId] = sidStr;   // #3669 п.1: смена станка
            if (detachId) fields['t' + firstPartReqId] = String(detachId);   // #4357: сегмент → самостоятельное задание
            if (!Object.keys(fields).length) return;
            return self.post('_m_set/' + encodeURIComponent(cut.id) + '?JSON', fields);
        }).then(function() {
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
            var posLabel = position === 'end' ? ' (в конец дня)'
                : (position === 'start' ? ' (в начало дня)' : ' (по весу)');   // #4221
            // #4357: сегмент отвязан от разорванного задания — называем это оператору. Работа больше
            // не непрерывна (два задания, две наладки), значков ←/→ между ними не будет.
            var detachLabel = detachId ? ' · отвязано от разорванного задания (отдельное задание)' : '';
            // #4390: уведомление даём НЕ здесь (до пересборки), а ПОСЛЕ terminal-autoSequenceQueue —
            // по ФАКТИЧЕСКОМУ дню задания (точная раскладка splitMachineQueue), а не по обещанному
            // целевому. Раньше тост «перенесено на 27» печатался до раскладки и лгал, когда упаковщик
            // клал задание на 28 (день переполнен/заморожен).
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
            // #4221: положение в дне:
            //   • 'start'/'end' — задание ПРИКОЛОТО (pinCutIds → временный 🔒-замок дня): в слое
            //     размещения оно неподвижный сосед на плейсхолдер-позиции (в начало/в конец дня);
            //   • 'weight' — задание НЕ приколачиваем (иначе оно осело бы неподвижным в плейсхолдер),
            //     а «замыкаем» на выбранный день/станок (weightPositionCutIds → dayLockByCut): держит
            //     день+станок, ПОЗИЦИЮ в дне выбирает по наилучшему весу (scorePosition, полный набор
            //     штрафов). День держит сам замок дня в слое размещения (fixed не нужен).
            // withinSlitter (#4225) — пересобираем ТОЛЬКО задействованные переносом станки: целевой и
            // (при смене станка) исходный. Прочие станки не трогаем; задания между станками не кидаем
            // (buildSequenceOps замыкает каждое задание на свой станок при scope >1).
            var moveScope = {};
            // #4488 (ТЗ §15): задание, которое двигал ОПЕРАТОР, встаёт в выбранный день ЦЕЛИКОМ —
            // независимо от положения в дне и от галки «Зафиксировать». Соседи уезжают на следующий
            // день сами (сначала незафиксированные, затем 🔒); само перенесённое рвётся в последнюю
            // очередь — когда вытеснять больше некого.
            moveScope.wholeDayCutIds = [String(cut.id)];
            // «По весу» — МЕСТО В ДНЕ ВЫБИРАЮТ ВЕСА, и с галкой «Зафиксировать» тоже (#4506, решение
            // заказчика 30.07.2026). Замок дня «по весу» (weightPositionCutIds → dayLockByCut) отдаёт
            // задание слою размещения ПОДВИЖНЫМ: §8 перебирает точки вставки внутри выбранного дня и
            // ставит его в место с минимальным штрафом (рядом со своей комбинацией ножей, #4487) —
            // вместо плейсхолдер-позиции «голова дня», из-за которой оператор видел, как зафиксированные
            // соседи съезжают (issue #4506).
            //
            // #4390 при этом цел: ДЕНЬ держит не мягкий замок, а ФИКС-ЯКОРЬ. «Зафиксировано»=1 записано
            // выше, поэтому planCutOperations даёт заданию `effAnchorByCut`, и точный упаковщик кладёт его
            // на «Дату план» (#3792/#3974) даже когда день ЗАМОРОЖЕН (#4326) или переполнен, — эвристика
            // ёмкости слоя размещения тут ничего не решает. Проверено: фикс+замок держат выбранный день и
            // на замороженном дне (тест #4390-A). Без галки — прежний путь: день держит сам замок.
            if (position === 'weight') {
                moveScope.weightPositionCutIds = [String(cut.id)];
            } else {
                moveScope.pinCutIds = [String(cut.id)];
                // #4464: ГДЕ именно в дне — решает оператор, а не планировщик. Раньше обе опции
                // давали ГОЛОВУ дня: приколотое задание забирало правило «🔒 своего дня раньше
                // свободных» (#3792), и «в конец дня» не работало вовсе. Теперь место идёт в
                // раскладку явно (pinDayPosByCut → splitMachineQueue).
                moveScope.pinDayPosByCut = {};
                moveScope.pinDayPosByCut[String(cut.id)] = position;   // 'start' | 'end'
            }
            if (withinSlitter) {
                moveScope.withinSlitterIds = (curSidStr !== '' && curSidStr !== sidStr)
                    ? [sidStr, curSidStr] : [sidStr];   // целевой + исходный (при смене станка)
            }
            return self.autoSequenceQueue(PLANNING_STRATEGY_SETUP, false, moveScope).then(function(res) {
                // #4390: сверяем ФАКТИЧЕСКИЙ день задания после ТОЧНОЙ раскладки. Совпал с целевым →
                // обычный успех. Не совпал (день переполнен/заморожен, упаковщик сдвинул — в т.ч.
                // зафиксированное #4304) → НЕ молчим: сообщаем, что цель не вместила и куда легло.
                var moved = (self.cuts || []).filter(function(c) { return String(c.id) === String(cut.id); })[0];
                var actualKey = moved ? planDateDayKey(moved.planDate) : null;
                if (actualKey != null && actualKey === targetDayKey) {
                    self.notify('Задание перенесено на ' + dateLabel + posLabel + slitLabel + detachLabel, 'success');
                } else {
                    // Полночь фактического дня из «Даты план» (unix-сек/мс) → заголовок дня.
                    var pdNum = moved ? Number(moved.planDate) : NaN;
                    var actualMid = null;
                    if (isFinite(pdNum) && pdNum > 0) {
                        var pdMs = pdNum >= 1e12 ? pdNum : pdNum * 1000;
                        var pdDate = new Date(pdMs);
                        if (!isNaN(pdDate.getTime())) actualMid = new Date(pdDate.getFullYear(), pdDate.getMonth(), pdDate.getDate(), 0, 0, 0, 0).getTime();
                    }
                    var actualLabel = actualMid != null ? formatPlanDayHeading(actualMid, 0) : 'другой день';
                    // #4418: говорим ПРАВДУ о результате. Задание могло разорваться по дням: часть
                    // проходов легла на выбранный день, часть осталась — тогда «не вместил» вводит в
                    // заблуждение (на экране видно и то, и другое). Считаем по ЦЕПОЧКЕ задания.
                    var chainIds = chainRecordIdsForCut(self.cuts || [], cut.id) || [String(cut.id)];
                    var byId4418 = {};
                    (self.cuts || []).forEach(function(c) { byId4418[String(c.id)] = c; });
                    var runsOnTarget = 0, runsElsewhere = 0;
                    chainIds.forEach(function(id) {
                        var c = byId4418[String(id)];
                        if (!c) return;
                        var runs = stripNum(c.plannedRuns);
                        if (planDateDayKey(c.planDate) === targetDayKey) runsOnTarget += runs;
                        else runsElsewhere += runs;
                    });
                    if (runsOnTarget > 0) {
                        self.notify('Задание разорвано по дням: на ' + dateLabel + ' встало проходов — '
                            + round3(runsOnTarget) + ', остальные (' + round3(runsElsewhere) + ') остались на '
                            + actualLabel + slitLabel + detachLabel
                            + '. Целиком день не вместил (переполнен, заморожен или мешает «Отпуск»).', 'warning');
                    } else {
                        self.notify('«' + dateLabel + '» не вместил задание (день переполнен, заморожен или '
                            + 'занят «Отпуском») — оно осталось на ' + actualLabel + slitLabel + detachLabel
                            + '. Зафиксированное задание не удалено.', 'warning');
                    }
                }
                return res;
            });
        }).catch(function(err) {
            self.hideProgress(); self.setBusy(false);
            self.reload().then(function() { self.render(); }).catch(function() {});
            self.notify('Ошибка переноса задания: ' + (err && err.message || err), 'error');
            return false;
        });
    };

    // #4346: отклонения факта от плана по ВСЕЙ загруженной очереди (не по видимому диапазону
    // [С; По]): просроченные задания лежат в прошлом и в рабочий фильтр диспетчера обычно не
    // попадают, а знать о них он должен. this.cuts — весь отчёт cut_planning (loadPlanning),
    // фильтр дат клиентский, так что дополнительного запроса не нужно.
    AtexProductionPlanning.prototype.deviationState = function() {
        var groups = deviationGroups(this.cuts || [], planDateDayKey(controllerNowMs(this)),
            { shiftClosedSlitters: this.shiftClosedSlittersToday() });   // #4596
        var closed = groups.shiftClosed || [];
        return {
            groups: groups,
            // #4596: «не выполнено, а день кончился» — одно число: просроченные и те, чей станок
            // уже закрыл смену. Решение по ним одно, поэтому и счётчик кнопки один; из чего он
            // сложился, говорят подсказка кнопки и отдельные группы формы.
            n: groups.overdue.length + closed.length,
            s: closed.length,                    // #4596: из них со станков с закрытой сменой
            m: groups.early.length,
            k: (groups.earlyRun || []).length,   // #4584: делается раньше плана
            total: groups.overdue.length + closed.length + groups.early.length + (groups.earlyRun || []).length
        };
    };

    // #4346: подпись/видимость кнопки «Отклонения N/M» (зовётся из renderQueue). Отклонений нет —
    // кнопки нет: в норме панель не должна нести красный сигнал.
    AtexProductionPlanning.prototype.updateDeviationsButton = function() {
        if (!this.devBtn) return;
        var st = this.deviationState();
        this.devBtn.style.display = st.total ? '' : 'none';
        this.devBtn.textContent = 'Отклонения ' + st.n + '/' + st.m + (st.k ? ('/' + st.k) : '');
        // #4412: подсказку держим КОРОТКИМИ СТРОКАМИ (перевод строки в title браузер уважает).
        // Одной строкой она была шире полутора сотен символов, а кнопка стоит у ПРАВОГО края
        // панели — всплывающая подсказка уезжала за край окна и читалась обрезанной.
        // #4596: первое число кнопки — «не выполнено, а день кончился»; из чего оно сложилось,
        // говорят две строки подсказки: прошедший плановый день и закрытая сегодня смена станка.
        this.devBtn.title = 'Просрочено — ' + st.groups.overdue.length
            + ': плановый день прошёл, не выполнено.\n'
            + (st.s ? ('Смена закрыта — ' + st.s + ': план на сегодня, станок закончил смену.\n') : '')
            + 'Выполнено досрочно — ' + st.m + ': раньше планового дня.\n'
            + (st.k ? ('Делается раньше плана — ' + st.k
                + ': проходы отмечены раньше планового дня.\n') : '')
            + 'Открыть список и урегулировать.';
    };

    // #4346: ближайший день, в который станку можно поставить работу: рабочий по «Календарю»
    // (#3788), НЕзамороженный (#4326) и без «Отпуска» этого станка (#3876). Отсчёт от сегодня.
    // Арифметика по компонентам даты (как dayKeyFromOffset) — переживает перевод часов.
    // Ничего не нашли за горизонт — отдаём сегодня (лучше показать день, чем потерять задание).
    AtexProductionPlanning.prototype.nearestFreeDayMs = function(slitterId) {
        var now = new Date(controllerNowMs(this));
        var sid = String(slitterId == null ? '' : slitterId);
        for (var i = 0; i < CALENDAR_HORIZON_DAYS; i++) {
            var ms = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i, 0, 0, 0, 0).getTime();
            if (this.dayOpenForWork(sid, ms)) return ms;
        }
        return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).getTime();
    };

    // #4566: МОЖНО ЛИ ставить станку работу в этот день — ОДИН предикат вместо трёх проверок по
    // месту. День закрыт, если он нерабочий по «Календарю» (#3788), ЗАМОРОЖЕН (#4326) или у станка
    // в этот день «Отпуск» (#3876). Им живёт `nearestFreeDayMs` — «куда положить, когда сдвигать
    // НЕ ОТ ЧЕГО» (у станка нет следующего задания). Выбор места ПЕРЕД следующим заданием этим
    // предикатом не ограничен: там очередь сдвигается подряд, и пропуск дня оставил бы разрыв
    // (#4569, решение заказчика 02.08.2026).
    // #4596: сюда же вошло «станок закрыл смену»: работать в этом дне он больше не будет, и класть
    // в него работу нельзя — иначе перенос со дня закрытой смены вернулся бы в тот же день.
    AtexProductionPlanning.prototype.dayOpenForWork = function(slitterId, dayMidnightMs) {
        if (!this.dayIsWorking(dayMidnightMs)) return false;
        if (this.dayIsFrozen(dayMidnightMs)) return false;
        var sid = String(slitterId == null ? '' : slitterId);
        var closed = typeof this.shiftClosedSlittersToday === 'function' ? this.shiftClosedSlittersToday() : {};
        if (dayIsOverForSlitter(planDateDayKey(dayMidnightMs), sid,
                planDateDayKey(controllerNowMs(this)), closed)) return false;   // #4596
        return !(sid !== '' && this.slitterOnVacationDay(sid, dayMidnightMs));
    };

    // #4346: одна группа списка отклонений. Подпись задания — его «номер» (с #3242 это плановые
    // дата-время старта, formatCutNumber), дальше станок, сырьё и состояние факта.
    // #4596: note — строка под заголовком группы (для «Смена закрыта»: какие станки и когда её
    // закрыли). Показываем и у пустой группы: «смена закрыта, всё доделано» — тоже ответ.
    AtexProductionPlanning.prototype.renderDeviationGroup = function(title, list, kind, note) {
        var box = el('div', { class: 'atex-pp-dev-group atex-pp-dev-' + kind });
        box.appendChild(el('h3', { class: 'atex-pp-dev-group-title', text: title + ' — ' + list.length }));
        if (note) box.appendChild(el('p', { class: 'atex-pp-hint', text: note }));
        if (!list.length) {
            box.appendChild(el('p', { class: 'atex-pp-hint', text: 'нет' }));
            return box;
        }
        var listEl = el('ul', { class: 'atex-pp-dev-list' });
        list.forEach(function(c) {
            var parts = [formatCutNumber(c.number) || ('#' + c.id)];
            var label = c.slitter && c.slitter.label;
            if (label) parts.push(label);
            if (c.materialName) parts.push(c.materialName);
            // #4564: у просроченного говорим, ЧТО с ним будет: частично выполненное разделится
            // (видно, сколько проходов сделано), остальное переедет целиком.
            var done = cutDoneRuns(c), planned = Math.floor(Number(c.plannedRuns) || 0);
            var partial = kind !== 'early' && planned > 0 && done != null && done > 0 && done < planned;
            parts.push(kind === 'early-run'
                ? ('сделано ' + (cutDoneRuns(c) || 0) + ' из ' + (Math.floor(Number(c.plannedRuns) || 0) || '?')
                   + ' — отрежем в день выполнения ' + (formatDayKey(planDateDayKey(c.startDate)) || '—'))
                : kind === 'early'
                // #4593: выполненное досрочно НЕ РЕЖЕТСЯ — работа сделана вся, переезжает целиком
                // в день, в котором её сделали (в отличие от частично выполненного рядом).
                ? ('выполнено ' + (formatDayKey(planDateDayKey(c.endDate)) || '—') + ' — перенесём целиком')
                : (partial ? ('сделано ' + done + ' из ' + planned + ' — разделим')
                    : (done != null && planned > 0 && done >= planned ? 'проходы сделаны — закроем'
                        : (cutIsStarted(c)
                            ? (done == null ? 'начато, факт проходов неизвестен — не двигаем' : 'начато, проходов нет')
                            : 'не выполнено'))));
            listEl.appendChild(el('li', {
                class: 'atex-pp-dev-item' + (kind !== 'early' && cutIsStarted(c) ? ' is-started' : ''),
                title: 'id ' + c.id, text: parts.join(' · ')
            }));
        });
        box.appendChild(listEl);
        return box;
    };

    // #4596: «Смена закрыта: Станок 2 · 14:40, Станок 3 · 15:20» — чем подтверждается, что день у
    // этих станков кончился. Ни один станок смену сегодня не закрывал → пустая строка (в форме
    // ничего не появляется).
    AtexProductionPlanning.prototype.shiftClosedNote = function() {
        var self = this;
        var closed = this.shiftClosedSlittersToday();
        var parts = Object.keys(closed).map(function(sid) {
            var slitter = (self.slitters || []).filter(function(s) { return String(s.id) === String(sid); })[0];
            var d = new Date(Number(closed[sid]) * 1000);
            var p2 = function(x) { return (x < 10 ? '0' : '') + x; };
            return (slitter && slitter.label ? slitter.label : ('#' + sid))
                + ' · ' + p2(d.getHours()) + ':' + p2(d.getMinutes());
        });
        return parts.length ? ('Смена закрыта: ' + parts.join(', ')) : '';
    };

    // #4346: форма «Отклонения» — список в две группы + «Урегулировать» / «Закрыть». Диспетчеру,
    // которому нужно иначе, форма не мешает: закрыл — и раскидал вручную (перенос 🗓 / ↑↓).
    AtexProductionPlanning.prototype.openDeviations = function() {
        var self = this;
        var st = this.deviationState();
        if (!st.total) { this.notify('Отклонений нет', 'info'); return; }

        var dialog = el('div', { class: 'atex-pp-modal-dialog atex-pp-dev-dialog' });
        var overlay = el('div', { class: 'atex-pp-modal atex-pp-dev-modal is-open' }, [dialog]);
        function close() { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }
        overlay.addEventListener('click', function(e) { if (e.target === overlay) close(); });
        var closeX = el('button', { class: 'atex-pp-modal-close', type: 'button', text: '×', title: 'Закрыть' });
        closeX.addEventListener('click', close);
        dialog.appendChild(closeX);

        var content = el('div', { class: 'atex-pp-dev-content' });
        dialog.appendChild(content);
        content.appendChild(el('h2', { class: 'atex-pp-form-title', text: 'Отклонения от плана' }));
        content.appendChild(this.renderDeviationGroup('Просрочено', st.groups.overdue, 'overdue'));
        // #4596: план на сегодня, но станок уже закрыл смену — отдельная группа, потому что фраза
        // «плановый день прошёл» про сегодняшний день была бы неправдой. Под заголовком называем
        // станки и время закрытия: оператор должен видеть, на каком основании поедет работа.
        content.appendChild(this.renderDeviationGroup('Смена закрыта, не выполнено',
            st.groups.shiftClosed || [], 'shift-closed', this.shiftClosedNote()));
        content.appendChild(this.renderDeviationGroup('Выполнено досрочно', st.groups.early, 'early'));
        // #4584: третий вид расхождения — проходы уже идут, а плановый день ещё не настал.
        content.appendChild(this.renderDeviationGroup('Делается раньше плана', st.groups.earlyRun || [], 'early-run'));
        content.appendChild(el('p', { class: 'atex-pp-hint', text:
            'Урегулировать: выполненные досрочно уйдут в день фактического выполнения; просроченные '
            + 'встанут перед следующим заданием своего станка (нет следующего — на ближайший рабочий '
            + 'незамороженный день), всё последующее сдвинется. Частично выполненное разделится: '
            + 'сделанные проходы останутся отдельным заданием в конце своего фактического дня, '
            + 'остаток уедет в план. Делающееся раньше плана режется так же, только в обратную '
            + 'сторону: выполненное уйдёт в день выполнения, остаток останется на своём времени, '
            + 'а следующие за ним сдвинутся влево. Порядок заданий сохраняется.' }));
        // #4596: почему сегодняшние задания попали в список (и почему попали не все).
        content.appendChild(el('p', { class: 'atex-pp-hint', text:
            'Сегодняшние задания попадают в список только у станков, закрывших смену: для них день '
            + 'кончился, и недоделанное едет в следующий день. Станки, чьи смены ещё идут, действие '
            + 'не трогает — «Урегулировать» можно нажимать по мере закрытия смен, а в конце дня '
            + 'закрыть всё одним разом.' }));
        // #4596: событий смены нет — молчать об этом нельзя: список сегодняшних заданий пуст не
        // потому, что смены открыты, а потому, что мы про них ничего не знаем.
        if (this.shiftEventsError) {
            content.appendChild(el('p', { class: 'atex-pp-hint atex-pp-dev-warn', text:
                'События смен прочитать не удалось (' + this.shiftEventsError + ') — закрытые смены '
                + 'в этом списке не учтены. Проверьте доступ роли к отчёту slitter_shift_events.' }));
        }

        var actions = el('div', { class: 'atex-pp-supply-actions' });
        var okBtn = el('button', { class: 'atex-pp-btn atex-pp-btn-danger', type: 'button', text: 'Урегулировать' });
        okBtn.addEventListener('click', function() {
            if (self.busy) return;
            // #4564: частично выполненные не «переносятся», а РАЗДЕЛЯЮТСЯ — считаем их отдельно,
            // иначе диспетчер не поймёт, сколько записей появится.
            // #4596: считаем по ОБЕИМ группам переноса — просроченным и со станков с закрытой сменой.
            var isPartial = function(x) {
                var d = cutDoneRuns(x), p = Math.floor(Number(x.plannedRuns) || 0);
                return p > 0 && d != null && d > 0 && d < p;
            };
            var closedList = st.groups.shiftClosed || [];
            var splitN = [].concat(st.groups.overdue, closedList).filter(isPartial).length;
            var closedMoves = closedList.length - closedList.filter(isPartial).length;
            var msg = el('span', { class: 'atex-pp-confirm-msg', text:
                'Урегулировать отклонения? Будет перенесено заданий: не выполненных в свой день — ' + (st.n - splitN)
                + (closedMoves ? ' (из них со станков с закрытой сменой — ' + closedMoves + ')' : '')
                + (splitN ? ', разделено частично выполненных — ' + splitN : '')
                + ', выполненных досрочно — ' + st.m
                + (st.k ? (', делается раньше плана — ' + st.k) : '')
                + '. План после них пересобирается.' });
            self.confirmAction(msg, actions, [
                { label: 'Урегулировать', warning: true, inline: true, onConfirm: function() {
                    close();
                    self.settleDeviations(st.groups);
                } }
            ]);
        });
        var closeBtn = el('button', { class: 'atex-pp-btn', type: 'button', text: 'Закрыть' });
        closeBtn.addEventListener('click', close);
        actions.appendChild(okBtn);
        actions.appendChild(closeBtn);
        content.appendChild(actions);

        this.root.appendChild(overlay);
    };

    // #4346: «Урегулировать» — одной операцией по обеим группам. Пишем только «Дату план»
    // (главное значение резки → _m_save с t{tableId}, как moveCutToDay: _m_set её не задаёт,
    // issue #775), значения даёт чистый deviationSettlePlan. Затем ОДНА пересборка очереди
    // preserveOrder=true — «сдвинуть последующие по общим правилам», не пересобирая порядок
    // (ТЗ: «Порядок заданий остается прежним»). Пере-планирования избегают задания прошлых дней
    // (#4294), поэтому досрочные, уехавшие в свой фактический день, пересборка не тронет.
    AtexProductionPlanning.prototype.settleDeviations = function(groups) {
        var self = this;
        this._ppOp = 'settleDeviations';   // #4177/#4480
        if (this.busy) return Promise.resolve(false);
        var cutMeta = this.meta && this.meta.cut;
        if (!cutMeta || cutMeta.id == null) {
            this.notify('Нет метаданных таблицы «' + TABLE.cut + '»', 'error');
            return Promise.resolve(false);
        }
        var win = this.workingWindow();
        var settle = deviationSettlePlan(this.cuts || [], groups, {
            todayKey: planDateDayKey(controllerNowMs(this)),
            shiftStartMin: Number(win && win.startMin) || 0,
            shiftEndMin: Number(win && win.cutEndMin) || 0,   // #4572: чем закрывать выполненную часть
            // #4596: у станка с закрытой сменой сегодняшний день кончился — ни якорем, ни
            // «ближайшим свободным днём» он больше быть не может.
            shiftClosedSlitters: this.shiftClosedSlittersToday(),
            freeDayMsFor: function(sid) { return self.nearestFreeDayMs(sid); }
        });
        var plan = settle.moves || [];
        var splits = settle.splits || [];
        // #4564: факт проходов не приходит из отчёта — начатые задания остаются на месте, и об
        // этом надо СКАЗАТЬ. Молчаливый ноль здесь означал бы «сделано ничего» и увёз бы со дня
        // работу, которая идёт на станке.
        // #4596: спрашиваем ОБЕ группы переноса — просроченные и те, чей станок закрыл смену.
        var blind = [].concat((groups && groups.overdue) || [], (groups && groups.shiftClosed) || [])
            .filter(function(c) {
                return cutIsStarted(c) && cutDoneRuns(c) == null;
            });
        if (blind.length) {
            console.error('[pp] ⛔ #4564: отчёт cut_planning не отдаёт «Кол-во резок факт» ('
                + CUT_ACTUAL_RUNS_COLUMN + ') — начатые просроченные не разделяются и не двигаются: '
                + blind.map(function(c) { return c.id; }).join(', '));
            this.notify('Не знаю, сколько проходов сделано (нет колонки в отчёте) — начатые задания '
                + 'оставляю на месте: ' + blind.length, 'error');
        }
        var byId = {};
        (this.cuts || []).forEach(function(c) { if (c && c.id != null) byId[String(c.id)] = c; });
        // Пишем только изменившиеся (#3427): повторное «Урегулировать» без новых отклонений — no-op.
        var writes = plan.filter(function(p) {
            var c = byId[String(p.id)];
            return c && planTsSeconds(c.planDate) !== p.planStart;
        });
        if (!writes.length && !splits.length) {
            this.notify('Отклонения уже урегулированы — переносить нечего', 'info');
            return Promise.resolve(false);
        }

        var createdRestIds = [];   // #4569: id остатков, созданных этим действием
        this.setBusy(true);
        this.showProgress('Урегулирование отклонений…', writes.length);
        // #4477: пулом до 5 потоков через шлюз (было — цепочкой в один поток); совпавшее с
        // хранимым отсеяно и выше (writes), и в самом шлюзе.
        return postCutStarts(self, writes.map(function(p) {
            return { cutId: p.id, ts: p.planStart, wasTs: planTsSeconds((byId[String(p.id)] || {}).planDate) };
        }), { onWrite: function(done) { self.updateProgress(done); } }).then(function() {
            // #4564: разделение частично выполненных — ПОСЛЕ переносов и до пересборки очереди.
            return self.splitPartiallyDoneCuts(splits);
        }).then(function(splitRes) {
            createdRestIds = ((splitRes && splitRes.createdIds) || []).map(String);
            return self.reload();
        }).then(function() {
            self.hideProgress(); self.setBusy(false); self.render();
            var byReason = function(r) { return writes.filter(function(p) { return p.reason === r; }).length; };
            var freeDay = byReason('free-day');
            var splitN = splits.filter(function(sp) { return sp.restRuns > 0; }).length;
            // #4596: «просроченных» здесь читается как «не выполненных в свой день» — в этом же
            // числе едут задания станков, закрывших смену сегодня (решение по ним одно).
            self.notify('Урегулировано заданий: ' + (writes.length + splits.length)
                + ' · не выполненных в свой день — ' + (byReason('before-next') + freeDay)
                + (freeDay ? ' (из них на ближайший рабочий день — ' + freeDay + ')' : '')
                + (splitN ? ' · разделено частично выполненных — ' + splitN : '')
                + ' · досрочных — ' + byReason('early'), 'success');
            // #4569: «Урегулировать» — РУЧНОЕ ДЕЙСТВИЕ, и оно ОДНОЗНАЧНО: сдвинуть всё. Отсюда две
            // рамки для пересборки (решение заказчика 02.08.2026).
            //   1. Задания этого действия объявлены ручными (`wholeDayCutIds`) — тем же полем, что и
            //      ручной перенос 🗓. Страж не отбрасывает их операции: ручное сильнее заморозки
            //      (FROZEN_DAY щадит manual, как давно щадит FIXED_CUT_DAY). Иначе команда
            //      выполняется наполовину — «тут сдвинули, а там не смогли», — и задание остаётся с
            //      плейсхолдерным временем (боевое #4569: «⏱ 07:59 – 09:53» внахлёст).
            //   2. Пересборка заперта на СВОИХ станках (`withinSlitterIds`): «Урегулировать» двигает
            //      очередь, а не перекидывает задания между станками и не оптимизирует раскладку.
            //      В scope с несколькими станками каждое задание к тому же замкнуто на свой станок
            //      (machineLockByCut) — миграции нет по построению.
            var settleTouched = settleTouchedDayKeys(plan, splits);
            var settleScope = settleMoveScope(plan, createdRestIds, self.cuts || [], settleTouched);
            return self.autoSequenceQueue(PLANNING_STRATEGY_SETUP, true, settleScope).then(function(res) {
                // #4569: СВЕСТИ СТАРТЫ В ДНЯХ, КУДА МЫ САМИ УНЕСЛИ РАБОТУ. Пересборка может не
                // переписать задание вовсе: страж снимает операции цепочки целиком, если часть их
                // отбросило правило (#4536 после #4436 «замороженные дни не трогаем»). Тогда запись
                // остаётся с тем временем, что стояло до неё, — а у созданного «Урегулировать»
                // остатка это ПЛЕЙСХОЛДЕР порядка («минута назад от следующего задания»), и
                // оператор видел «⏱ 07:59 – 09:53» внахлёст с соседями (issue #4569).
                // Своди́м честные старты по ХРАНИМЫМ минутам (recalcStartUpdates: встык от начала
                // смены, день задания не меняется) — то же, что делает «↻ Пересчитать наладку».
                // Дни называем явно: они лежат ЗА видимым диапазоном [С;По], которым этот пересчёт
                // ограничен, — «Урегулировать» ставит остаток перед следующим заданием станка, а
                // оно может стоять в любом дне.
                return self.reconcilePlanStarts({ dayKeys: settleTouched, manual: true })
                    .then(function() { return res; });
            });
        }).catch(function(err) {
            self.hideProgress(); self.setBusy(false);
            self.reload().then(function() { self.render(); }).catch(function() {});
            self.notify('Ошибка урегулирования отклонений: ' + (err && err.message || err), 'error');
            return false;
        });
    };

    // #4564: РАЗДЕЛИТЬ ЧАСТИЧНО ВЫПОЛНЕННЫЕ задания — вторая половина «Урегулировать».
    // Задание, у которого сделана ЧАСТЬ проходов («Кол-во резок факт» между 1 и планом), после
    // «Урегулировать» превращается в две записи:
    //   • ВЫПОЛНЕННАЯ ЧАСТЬ — это ИСХОДНАЯ запись: при ней «Начато», погонаж, счётчики и события
    //     смены, а они привязаны к её id (пульт показывает «Резка D из D»). Ей остаются сделанные
    //     проходы, она встаёт в конец дня, в котором её фактически делали, и ЗАКРЫВАЕТСЯ
    //     («Закончено» = конец смены того дня) — иначе назавтра она снова отклонение, а делить в
    //     ней уже нечего;
    //   • ОСТАТОК — НОВАЯ запись (план − сделано проходов), чистая: без «Начато» и погонажа. Она
    //     встаёт на место просроченного задания (перед следующим заданием станка), и всё
    //     последующее двигает ОБЩИЙ механизм — пересборка очереди в settleDeviations.
    // Работа при этом сохраняется: сделано + остаток = прежний план, поэтому правило реестра
    // SUPPLY_CONSERVED (ТЗ §15) выполняется по построению, а доли «Партий ГП»/«Обеспечений» делит
    // тот же applySplitPlan, что и разбиение по дням (#3280) — второй арифметики разделения нет.
    // ЦЕПОЧКА ДРОБЛЕНИЯ: выполненная часть из цепочки ВЫХОДИТ (сама себе «ID первой части»), а её
    // место занимает остаток — он либо становится новой головой (тогда прежние продолжения
    // перецепляются на него), либо остаётся продолжением той же головы.
    // → Promise<{ count: разделённых заданий, createdIds: [id созданных остатков] }>
    AtexProductionPlanning.prototype.splitPartiallyDoneCuts = function(splits) {
        var self = this;
        var list = (splits || []).filter(function(sp) { return sp && sp.id != null; });
        if (!list.length) return Promise.resolve({ count: 0, createdIds: [] });
        var cutMeta = this.meta && this.meta.cut;
        if (!cutMeta) return Promise.resolve({ count: 0, createdIds: [] });
        var finishedReqId = reqIdByName(cutMeta, CUT_REQ.finishedAt);
        var firstPartReqId = reqIdByName(cutMeta, CUT_REQ.firstPart);
        var byId = {};
        (this.cuts || []).forEach(function(c) { if (c && c.id != null) byId[String(c.id)] = c; });

        var createdBySplit = {}, headSplits = {}, siblingsBySplit = {};
        var ops = { updates: [], creates: [], deletes: [] };
        list.forEach(function(sp) {
            var cut = byId[String(sp.id)];
            if (!cut) return;
            var storedHead = String(cut.firstPartId == null ? '' : cut.firstPartId).trim();
            var wasHead = storedHead === '' || storedHead === String(sp.id);
            headSplits[String(sp.id)] = wasHead;
            siblingsBySplit[String(sp.id)] = splitChainPartsOf(self.cuts || [], String(sp.id))
                .map(function(c) { return String(c.id); })
                .filter(function(id) { return id !== String(sp.id); });
            ops.updates.push({
                cutId: String(sp.id), planStartTs: sp.donePlanStart,
                plannedRuns: sp.doneRuns, firstPartId: String(sp.id)
            });
            if (sp.restRuns > 0) {
                ops.creates.push({
                    parentCutId: String(sp.id), planStartTs: sp.restPlanStart, plannedRuns: sp.restRuns,
                    firstPartSelf: wasHead, firstPartId: wasHead ? '' : storedHead,
                    splitOf: String(sp.id)
                });
            }
        });
        ops.manual = true;   // #4588: это ручное действие — колонки пишем и в замороженном дне
        // #4618: РАЗДЕЛЕНИЕ ЧАСТИЧНО ВЫПОЛНЕННОГО — в журнал ДО записи. Урезание головы попадает
        // в `ops.updates` безусловно, а рождение остатка — только при `restRuns > 0`; если остаток
        // не родится (снят стражем, умерла запись), в базе останется «план = факту», и по ней уже
        // не сказать, сколько проходов задание несло. Эта строка и есть свидетель.
        journalBegin(self, 'splitPartiallyDoneCuts');
        planJournalRows(self, list.map(function(sp) {
            var cut = byId[String(sp.id)];
            var was = cut && cut.plannedRuns != null ? Number(cut.plannedRuns) : null;
            return { event: 'SETTLE_SPLIT', cut: sp.id, before: was, after: sp.doneRuns,
                     details: 'было проходов ' + (was == null ? '?' : was) + ' → сделано ' + sp.doneRuns +
                              ', остаток ' + sp.restRuns +
                              (sp.restRuns > 0 ? ' (создаём продолжение)' : ' (продолжение НЕ создаётся)') };
        }));
        if (!ops.updates.length) return Promise.resolve({ count: 0, createdIds: [] });
        ops.onCreated = function(cr, newId) {
            if (cr && cr.splitOf) createdBySplit[String(cr.splitOf)] = String(newId);
        };

        return this.applySplitPlan(ops).then(function() {
            var tasks = [];
            list.forEach(function(sp) {
                var id = String(sp.id);
                // Закрыть выполненную часть концом смены её фактического дня.
                if (finishedReqId) {
                    var f = {};
                    // #4572: момент закрытия посчитан чистым правилом (не позже фактического начала
                    // следующего задания станка) — здесь только формат DATETIME.
                    f['t' + finishedReqId] = formatDateTimeStamp(sp.doneCloseTs != null ? sp.doneCloseTs : sp.donePlanStart);
                    tasks.push(function() { return self.post('_m_set/' + id + '?JSON', f); });
                }
                // Прежние продолжения цепочки — на новую голову (остаток).
                var newId = createdBySplit[id];
                if (!newId || !headSplits[id] || !firstPartReqId) return;
                (siblingsBySplit[id] || []).forEach(function(sib) {
                    var sf = {}; sf['t' + firstPartReqId] = newId;
                    tasks.push(function() { return self.post('_m_set/' + sib + '?JSON', sf); });
                });
            });
            // #4569: id созданных остатков нужны вызывающему — он объявит их ручными, чтобы
            // пересборка их точно переложила (страж не отбрасывает операции ручного действия).
            var createdIds = Object.keys(createdBySplit).map(function(k) { return createdBySplit[k]; });
            if (!tasks.length) return { count: list.length, createdIds: createdIds };
            return runWithConcurrency(tasks, MAX_PARALLEL_WRITES)
                .then(function() { return { count: list.length, createdIds: createdIds }; });
        });
    };

    // #4569: рамки пересборки после «Урегулировать» — ручное действие, однозначный сдвиг.
    //   wholeDayCutIds + pinCutIds — всё, что это действие ПЕРЕНЕСЛО и СОЗДАЛО: страж не отбрасывает
    //     операции по ним (ручное сильнее заморозки), поэтому команда выполняется целиком;
    //   withinSlitterIds — станки этих заданий: пересборка не выходит за них и не перекидывает
    //     задания между станками (в scope с >1 станком каждое задание заперто на своём).
    // Чистая: cuts нужны только чтобы узнать станок задания. → moveScope
    function settleMoveScope(moves, createdIds, cuts, dayKeys) {
        var ids = {}, sids = {};
        (moves || []).forEach(function(m) { if (m && m.id != null) ids[String(m.id)] = true; });
        // #4572: ВЫПОЛНЕННЫХ частей здесь нет. Они факт, а не то, что оператор несёт: их день —
        // день, когда работу реально делали, и планировщик их больше не видит вовсе (заполнено
        // «Закончено»). Ручными объявляем только то, что действительно едет.
        (createdIds || []).forEach(function(id) { if (id != null && id !== '') ids[String(id)] = true; });
        (cuts || []).forEach(function(c) {
            if (!c || c.id == null || !ids[String(c.id)]) return;
            var sid = String(c.slitter && c.slitter.id != null ? c.slitter.id : '');
            if (sid !== '') sids[sid] = true;
        });
        var scope = { wholeDayCutIds: Object.keys(ids) };
        // #4574: ЗАКРЕПИТЬ их на выбранном дне — тем же полем, что ручной перенос 🗓 (`pinCutIds`
        // → временный c.fixed → planCutOperations держит день по «Дате план»). Без этого задания
        // команды идут в упаковщик СВОБОДНЫМИ, а свободные он из замороженного дня выбрасывает
        // (#4326-seal): остаток, поставленный «Урегулировать» на 03.08, уезжал на 04.08 (#4574).
        // Заморозка тут ни при чём — день выбрал ОПЕРАТОР, и ручное её игнорирует.
        scope.pinCutIds = scope.wholeDayCutIds.slice();
        // #4577: дни, которых касается действие, для него РАЗМОРОЖЕНЫ — иначе работу в замороженный
        // день положить можно, а вынести лишнее оттуда некому, и день уходит за потолок.
        scope.unfrozenDayKeys = dayKeys || [];
        var sidList = Object.keys(sids);
        if (sidList.length) scope.withinSlitterIds = sidList;
        return scope;
    }

    // #4569: дни (ключи YYYYMMDD), которых коснулось «Урегулировать»: куда переехали просроченные и
    // досрочные, где встала выполненная часть и куда уехал остаток. Именно их старты надо свести
    // после пересборки — фильтр [С;По] их не покрывает. Чистая.
    function settleTouchedDayKeys(moves, splits) {
        var keys = {};
        function add(ts) {
            var k = planDateDayKey(ts);
            if (k != null && isFinite(k)) keys[String(k)] = true;
        }
        (moves || []).forEach(function(m) { if (m) add(m.planStart); });
        (splits || []).forEach(function(sp) {
            if (!sp) return;
            add(sp.donePlanStart);
            if (sp.restPlanStart != null) add(sp.restPlanStart);
        });
        return Object.keys(keys);
    }

    // #4572: unix-секунды → DATETIME 'ГГГГ-ММ-ДД ЧЧ:ММ:СС' для записи «Закончено». Само значение
    // выбирает чистое правило `doneCloseMoment`; здесь только формат.
    function formatDateTimeStamp(tsSec) {
        var d = new Date(Number(tsSec) * 1000);
        function p(n) { return (n < 10 ? '0' : '') + n; }
        return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
            + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
    }

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
        var MAX_PARALLEL_DELETES = MAX_PARALLEL_WRITES;   // #4477: предел один на весь модуль
        // #4631: позиции удаляемых звеньев запоминаем ДО удаления — после него связь потеряна, и
        // сверить набор «Задач на втулки» будет уже не с чем.
        var sleevePositionIds = [];
        (self.supplies || []).forEach(function(sup) {
            if (!sup || sup.cutId == null || cutList.indexOf(String(sup.cutId)) < 0) return;
            var pid = String(sup.positionId == null ? '' : sup.positionId);
            if (pid && sleevePositionIds.indexOf(pid) === -1) sleevePositionIds.push(pid);
        });
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
        // #4292: день-сплит — «задание» = ГОЛОВА + ПРОДОЛЖЕНИЯ (одна логическая резка). Удаляем ВСЮ
        // цепочку и обеспечения ВСЕХ её звеньев, иначе продолжение остаётся без обеспечения/заказа
        // («нет связей», в ОТХОДЫ), а автогенерация его не чистит (проходы>0 — planCutOperations сносит
        // лишь setup-only-мусор). Клик по любой части цепочки сносит её целиком.
        var chainIds = chainRecordIdsForCut(self.cuts || [], cut.id);
        if (!chainIds.length) chainIds = [String(cut.id)];
        var cutsById = {};
        (self.cuts || []).forEach(function(c) { cutsById[String(c.id)] = c; });
        // #3508: зафиксированное (🔒) звено цепочки удалять нельзя — снять фиксацию сначала.
        if (chainIds.some(function(id) { return cutsById[id] && cutsById[id].fixed; })) {
            this.notify('В цепочке дробления есть зафиксированное задание — снимите фиксацию, чтобы удалить', 'error');
            return;
        }
        // #4381: начатое звено (заполнено «Начато») удалять нельзя вообще — в отличие от 🔒 снять
        // тут нечего: работа уже идёт. Кнопка «🗑» у начатого убрана; здесь — авторитетная проверка,
        // в том числе на случай, когда начато ДРУГОЕ звено цепочки дробления.
        if (chainIds.some(function(id) { return cutsById[id] && cutIsStarted(cutsById[id]); })) {
            this.notify('Задание уже начато — удалить нельзя', 'error');
            return;
        }
        var label = cutTaskLabel(cut);
        this.setBusy(true);
        // Обеспечения ВСЕХ звеньев цепочки (у продолжений их обычно нет, но собираем на всякий случай).
        Promise.all(chainIds.map(function(id) { return self.loadCutFulfillments(id); })).then(function(lists) {
            self.setBusy(false);
            var seen = {}, fulfillmentIds = [];
            lists.forEach(function(l) { (l || []).forEach(function(fid) {
                var s = String(fid);
                if (s && s !== 'null' && !seen[s]) { seen[s] = true; fulfillmentIds.push(s); }
            }); });
            var contCount = chainIds.length - 1;
            var msg = el('span', { class: 'atex-pp-confirm-msg', text:
                'Удалить задание «' + label + '»' + (contCount > 0 ? ' вместе с продолжениями (' + contCount + ')' : '') +
                '? Будет удалено обеспечений — ' + fulfillmentIds.length + '. Действие необратимо.' });
            self.confirmAction(msg, cardEl, [
                { label: 'Удалить', warning: true, onConfirm: function() {
                    self.runDeleteCutTask(chainIds, fulfillmentIds, label);
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
    AtexProductionPlanning.prototype.runDeleteCutTask = function(cutIds, fulfillmentIds, label) {
        var self = this;
        if (this.busy) return;
        var ids = (fulfillmentIds || []).map(function(x) { return String(x); })
            .filter(function(id) { return id && id !== 'null'; });
        // #4292: cutIds — ГОЛОВА + ПРОДОЛЖЕНИЯ цепочки дробления; терпим и одиночный id (совместимость).
        var cutList = (Array.isArray(cutIds) ? cutIds : [cutIds]).map(function(x) { return String(x); })
            .filter(function(id) { return id && id !== 'null'; });
        var total = ids.length + cutList.length;   // обеспечения + записи цепочки

        this.setBusy(true);
        this.showProgress('Удаление задания «' + label + '»…', total);
        var done = 0;
        // #4005: обеспечения резки независимы друг от друга — сносим их пулом до
        // MAX_PARALLEL_DELETES потоков (как сохранение #3998/#4004), затем БАРЬЕР и записи резок.
        // Порядок «сперва все обеспечения, потом резки» обязателен (иначе _m_del резки → 409, см.
        // комментарий выше). #4292: записи цепочки сносим ПОСЛЕДОВАТЕЛЬНО в ОБРАТНОМ порядке (хвост →
        // голова): продолжения ссылаются на голову («ID первой части», #3892), удаление головы раньше
        // продолжений может дать 409.
        var MAX_PARALLEL_DELETES = MAX_PARALLEL_WRITES;   // #4477: предел один на весь модуль
        function del(id) {
            return self.post('_m_del/' + encodeURIComponent(id) + '?JSON', {}).then(function() {
                self.updateProgress(++done);
            });
        }
        var supplyTasks = ids.map(function(id) { return function() { return del(id); }; });
        // Фаза 1 — обеспечения (пул), барьер, Фаза 2 — записи цепочки (хвост → голова).
        runWithConcurrency(supplyTasks, MAX_PARALLEL_DELETES).then(function() {
            return cutList.slice().reverse().reduce(function(p, id) {
                return p.then(function() { return del(id); });
            }, Promise.resolve());
        }).then(function() {
            return self.reload();
        }).then(function() {
            // #4631: задание ушло — «Задачи на втулки» его позиций приводим к оставшемуся плану.
            // Раньше их не убирал никто (задача подчинена ПОЗИЦИИ, а не заданию), и они копились.
            // typeof-гард: в юнит-тестах `self` — стаб без прототипа (`atex-production-planning-4005`).
            if (typeof self.reconcileSleeveTasks !== 'function') return null;
            return self.reconcileSleeveTasks(sleevePositionIds);
        }).then(function() {
            self.hideProgress();
            self.setBusy(false);
            if (cutList.indexOf(String(self.selectedCutId)) >= 0) self.selectedCutId = null;
            self.render();
            var contCount = cutList.length - 1;
            self.notify('Задание удалено' + (contCount > 0 ? ' (продолжений — ' + contCount + ')' : '') +
                ': обеспечений — ' + ids.length, 'success');
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
        var producedByPos = this.producedRollsByPosition();   // #4536: выпуск позиций — считаем ОДИН раз на список
        var candidates = (this.genPositions || []).map(function(p) {
            var remaining = remainingRollsForPosition(p, self.supplies, producedByPos);
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

    // #4426: свободные полосы задания — те «Партии ГП», на которые ещё НЕ ссылается ни одно
    // «Обеспечение» (их рулоны идут на склад/в отходы). strips — из loadStripsForCut
    // ({ id, width, qty = полос за проход }); passes — проходов задания. → [{ id, width, rolls }].
    AtexProductionPlanning.prototype.freeStripsOfCut = function(strips, passes) {
        var ordered = {};
        (this.supplies || []).forEach(function(s) {
            var b = s && s.finishedBatchId;
            if (b != null && String(b) !== '') ordered[String(b)] = true;
        });
        var runs = stripNum(passes) > 0 ? stripNum(passes) : 1;
        return (strips || []).filter(function(s) { return s && s.id != null && !ordered[String(s.id)]; })
            .map(function(s) {
                return { id: String(s.id), width: s.width, rolls: round3((stripNum(s.qty) || 0) * runs) };
            });
    };

    // #4426/#4428: «+ позиция» в плашке задания (рядом с «+ полоса») — добавить в СУЩЕСТВУЮЩЕЕ
    // задание ещё одну позицию заказа. Состав задания читаем из БД (свежие «Партии ГП»), годность
    // позиции считает cutPositionFit: сырьё + метраж + намотка задания и либо СВОБОДНАЯ полоса
    // её ширины, либо (#4428) НОВАЯ полоса, если она влезает в остаток джамбо. Непроходные
    // позиции той же номенклатуры показываем с причиной — иначе непонятно, почему нужной
    // позиции нет в списке.
    //   ctx (из панели полос) — { jumbo, strips, passes }; без него джамбо берём из
    //   jumboWidthByMaterial, а состав — только из БД.
    AtexProductionPlanning.prototype.openCutPositionPicker = function(cut, ctx) {
        var self = this;
        if (!cut) { this.notify('Не выбрано задание', 'error'); return; }
        if (!this.meta.supply) { this.notify('Нет метаданных таблицы «Обеспечение»', 'error'); return; }
        if (!this.meta.finishedBatch) { this.notify('Не найдены метаданные таблицы «' + TABLE.finishedBatch + '»', 'error'); return; }

        var dialog = el('div', { class: 'atex-pp-modal-dialog atex-pp-supply-dialog' });
        var overlay = el('div', { class: 'atex-pp-modal atex-pp-supply-modal is-open' }, [dialog]);
        function close() { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }
        overlay.addEventListener('click', function(e) { if (e.target === overlay) close(); });
        var closeX = el('button', { class: 'atex-pp-modal-close', type: 'button', text: '×', title: 'Закрыть' });
        closeX.addEventListener('click', close);
        dialog.appendChild(closeX);
        var content = el('div', { class: 'atex-pp-supply-content' });
        dialog.appendChild(content);
        content.appendChild(el('h2', { class: 'atex-pp-form-title', text: 'Добавить позицию в задание' }));
        content.appendChild(el('p', { class: 'atex-pp-hint', text: 'Читаю состав задания…' }));
        this.root.appendChild(overlay);

        var passes = stripNum((ctx && ctx.passes) || cut.plannedRuns) > 0
            ? stripNum((ctx && ctx.passes) || cut.plannedRuns) : 1;
        var jumbo = stripNum(ctx && ctx.jumbo) > 0 ? stripNum(ctx.jumbo)
            : (Number((this.jumboWidthByMaterial || {})[String(cut.materialId)]) || 0);
        var matLabel = (cut.materialBatch && cut.materialBatch.label) || cut.materialName || cut.materialId || '—';
        var search = '';

        function confirmRow(label, value) {
            return el('div', { class: 'atex-pp-supply-confirm-row' }, [
                el('span', { class: 'atex-pp-supply-confirm-label', text: label }),
                el('span', { class: 'atex-pp-supply-confirm-value', text: String(value) })
            ]);
        }

        // #4428: куда ляжет позиция — на готовую свободную полосу или новой полосой (полосами).
        function fitPlacementLabel(fit) {
            if (!fit) return '—';
            if (fit.mode === 'new') return 'новая полоса ' + round3(fit.width) + ' мм × ' + round3(fit.stripCount);
            return 'полоса ' + round3(stripNum(fit.strip && fit.strip.width)) + ' мм';
        }

        this.loadStripsForCut(cut.id).then(function(strips) {
            if (!overlay.parentNode) return;   // модалку успели закрыть
            var free = self.freeStripsOfCut(strips, passes);
            // #4428: свободная ширина джамбо = джамбо − занято сохранёнными полосами. Ширина
            // джамбо неизвестна (нет вида сырья) → новых полос не предлагаем: резать вслепую
            // нельзя, но и молчать не будем — скажем в подписи.
            var usedMm = planning.stripsUsedWidth(strips || []);
            var jumboFreeMm = jumbo > 0 ? round3(jumbo - usedMm) : 0;
            if (jumboFreeMm < 0) jumboFreeMm = 0;
            var fitOpts = { jumboFreeMm: jumboFreeMm, passes: passes };
            var posLabelById = {};
            (self.positions || []).forEach(function(p) { posLabelById[String(p.id)] = p.label; });
            var linkedPosIds = {};
            (self.supplies || []).forEach(function(s) {
                if (String(s.cutId) === String(cut.id) && s.positionId != null) linkedPosIds[String(s.positionId)] = true;
            });
            // Кандидаты: позиции ТОЙ ЖЕ номенклатуры (сырьё) — прочие в список не попадают
            // вовсе, их только считаем (иначе список — весь портфель заказов).
            var otherNomenclature = 0;
            var candidates = [];
            var producedByPos = self.producedRollsByPosition();   // #4536: выпуск позиций — считаем ОДИН раз на список
            (self.genPositions || []).forEach(function(p) {
                var remaining = remainingRollsForPosition(p, self.supplies, producedByPos);
                var fit = cutPositionFit(p, cut, free, remaining, fitOpts);
                var sameMaterial = String(p.materialId == null ? '' : p.materialId).trim() ===
                    String(cut.materialId == null ? '' : cut.materialId).trim();
                if (!sameMaterial) { otherNomenclature++; return; }
                candidates.push({
                    id: String(p.id), position: p, remaining: remaining, fit: fit,
                    linked: !!linkedPosIds[String(p.id)],
                    label: posLabelById[String(p.id)] ||
                        ('Сырьё#' + (p.materialId || '?') + ' · ' + ((p.orderWidth != null ? p.orderWidth : p.width) || '?') + ' мм')
                });
            });
            candidates.sort(function(a, b) { return a.label < b.label ? -1 : a.label > b.label ? 1 : 0; });

            function matchesSearch(c) {
                if (search === '') return true;
                return (c.label + ' ' + round3(stripNum(c.position.width)) + ' ' + c.id).toLowerCase().indexOf(search) >= 0;
            }

            // Список перерисовывается по мере ввода в поиск — ТОЛЬКО он: поле поиска живёт
            // между перерисовками, иначе на каждом нажатии терялись фокус и каретка (#3429).
            function renderItems(listBox) {
                listBox.innerHTML = '';
                var shown = candidates.filter(matchesSearch);
                var fits = shown.filter(function(c) { return c.fit.ok; });
                var unfits = shown.filter(function(c) { return !c.fit.ok; });

                var list = el('div', { class: 'atex-pp-supply-list' });
                fits.forEach(function(c) {
                    var item = el('button', { class: 'atex-pp-supply-item', type: 'button' }, [
                        el('span', { class: 'atex-pp-supply-item-label',
                            text: c.label + (c.linked ? ' · уже в задании' : '') }),
                        el('span', { class: 'atex-pp-supply-item-meta',
                            text: 'ост. ' + round3(c.remaining) + ' рул. → ' + fitPlacementLabel(c.fit) +
                                ' · ' + round3(c.fit.rolls) + ' рул.' })
                    ]);
                    item.addEventListener('click', function() { renderConfirm(c); });
                    list.appendChild(item);
                });
                if (!fits.length) {
                    list.appendChild(el('div', { class: 'atex-pp-hint',
                        text: shown.length
                            ? 'Подходящих позиций нет: свободной полосы нужной ширины у задания нет, в остаток джамбо новая не влезает либо остаток позиций уже обеспечен.'
                            : 'Под поиск ничего не подошло.' }));
                }
                listBox.appendChild(list);

                if (unfits.length) {
                    listBox.appendChild(el('div', { class: 'atex-pp-supply-reject-title',
                        text: 'Не подходят (' + unfits.length + '):' }));
                    var rejects = el('div', { class: 'atex-pp-supply-rejects' });
                    unfits.forEach(function(c) {
                        rejects.appendChild(el('div', { class: 'atex-pp-supply-reject' }, [
                            el('span', { class: 'atex-pp-supply-item-label', text: c.label }),
                            el('span', { class: 'atex-pp-supply-item-meta', text: c.fit.reason })
                        ]));
                    });
                    listBox.appendChild(rejects);
                }
            }

            function renderList() {
                content.innerHTML = '';
                content.appendChild(el('h2', { class: 'atex-pp-form-title', text: 'Добавить позицию в задание' }));
                content.appendChild(el('p', { class: 'atex-pp-hint',
                    text: 'Задание № ' + (formatCutNumber(cut.number) || cut.id) + ' · ' + matLabel + ' · ' +
                        round3(stripNum(cut.length)) + ' м · ' + (normWinding(cut.winding) || '—') +
                        '. Позиция ложится на свободную полосу задания той же ширины (свободных полос: ' +
                        free.length + ' из ' + (strips || []).length + '), а если такой нет — режется новой полосой ' +
                        'в остаток джамбо (' + (jumbo > 0 ? round3(jumboFreeMm) + ' мм из ' + round3(jumbo) : 'ширина джамбо не задана — новых полос не предлагаем') +
                        '). Связь пишется «Обеспечением».' }));

                if (!candidates.length) {
                    content.appendChild(el('p', { class: 'atex-pp-hint',
                        text: 'Позиций этого сырья в планировании нет' +
                            (otherNomenclature > 0 ? ' (другого сырья: ' + otherNomenclature + ' — их в это задание добавить нельзя).' : '.') }));
                    return;
                }

                var listBox = el('div', { class: 'atex-pp-supply-listbox' });
                var searchInput = el('input', { class: 'atex-pp-input', type: 'search',
                    placeholder: 'Поиск: номер заказа или ширина', value: search });
                searchInput.addEventListener('input', function() {
                    search = String(searchInput.value || '').trim().toLowerCase();
                    renderItems(listBox);
                });
                content.appendChild(searchInput);
                content.appendChild(listBox);
                renderItems(listBox);

                if (otherNomenclature > 0) {
                    content.appendChild(el('p', { class: 'atex-pp-hint',
                        text: 'Позиции другого сырья (' + otherNomenclature + ') не показаны: задание режет ' +
                            matLabel + ' — другое сырьё оно физически не произведёт.' }));
                }
            }

            // #4428: countOverride — сколько НОВЫХ полос режем (диспетчер правит вручную:
            // менеджер считает заказ «чтобы всё влезло ровненько», и наше предложение — лишь
            // отправная точка). Для позиции на готовой полосе поле не показываем: геометрия
            // задания там не меняется.
            function renderConfirm(c, countOverride) {
                content.innerHTML = '';
                content.appendChild(el('h2', { class: 'atex-pp-form-title', text: 'Добавить позицию в задание?' }));
                var isNew = c.fit.mode === 'new';
                var width = isNew ? stripNum(c.fit.width) : stripNum(c.fit.strip.width);
                var maxNew = isNew && width > 0 ? Math.floor(round3(jumboFreeMm) / width) : 0;
                // Заказы задания: заказ выбранной позиции + заказы уже связанных позиций.
                var coveredOrders = {};
                coveredOrders[String(c.position && c.position.orderId)] = true;
                Object.keys(linkedPosIds).forEach(function(pid) {
                    var lp = (self.genPositions || []).filter(function(p) { return String(p.id) === String(pid); })[0];
                    if (lp && lp.orderId != null && String(lp.orderId) !== '') coveredOrders[String(lp.orderId)] = true;
                });
                var others = candidates.filter(function(x) { return String(x.id) !== String(c.id); });
                // #4428: под ОСТАЛЬНЫЕ позиции этого заказа откладываем по полосе каждой —
                // иначе жадный добор первой позиции съедает джамбо, и вторая позиция заказа
                // снова не попадает в задание (ТЗ: заказ идёт в задание целиком).
                var reserveMm = isNew ? siblingStripReserveMm(cut, free, others, coveredOrders,
                    { jumboFreeMm: jumboFreeMm, passes: passes }) : 0;
                var byReserve = isNew && width > 0 ? Math.floor(round3(jumboFreeMm - reserveMm) / width) : 0;
                var count = isNew ? Math.max(1, Math.min(maxNew, stripNum(countOverride) > 0
                    ? Math.round(stripNum(countOverride))
                    : Math.min(round3(c.fit.stripCount), byReserve > 0 ? byReserve : 1))) : 0;
                var produced = isNew ? round3(count * passes) : round3(c.fit.strip.rolls);
                var rolls = isNew ? stripSupplyRolls(produced, c.remaining) : round3(c.fit.rolls);
                var capped = round3(rolls) < round3(produced);
                var confirmBox = el('div', { class: 'atex-pp-supply-confirm' }, [
                    confirmRow('Задание', '№ ' + (formatCutNumber(cut.number) || cut.id) + ' · ' + matLabel),
                    confirmRow('Позиция', c.label)
                ]);
                if (isNew) {
                    // Число новых полос — редактируемое; больше, чем влезает в остаток джамбо, не даём.
                    var countInput = el('input', { class: 'atex-pp-input atex-pp-supply-count', type: 'number',
                        min: '1', step: '1', max: String(maxNew) });
                    countInput.value = String(count);
                    countInput.addEventListener('change', function() {
                        var v = Math.round(stripNum(countInput.value));
                        if (!(v > 0)) v = 1;
                        if (v > maxNew) {
                            v = maxNew;
                            self.notify('В остаток джамбо (' + round3(jumboFreeMm) + ' мм) влезает не больше ' +
                                maxNew + ' полос по ' + round3(width) + ' мм', 'warning');
                        }
                        renderConfirm(c, v);
                    });
                    confirmBox.appendChild(el('div', { class: 'atex-pp-supply-confirm-row' }, [
                        el('span', { class: 'atex-pp-supply-confirm-label', text: 'Новых полос ' + round3(width) + ' мм' }),
                        countInput
                    ]));
                    confirmBox.appendChild(confirmRow('Остаток джамбо',
                        round3(jumboFreeMm) + ' мм → ' + round3(jumboFreeMm - count * width) + ' мм' +
                        (reserveMm > 0 ? ' (под другие позиции заказа отложено ' + round3(reserveMm) + ' мм)' : '')));
                    confirmBox.appendChild(confirmRow('Произведёт', produced + ' рул. (' + count + ' × ' + passes + ' проходов)'));
                } else {
                    confirmBox.appendChild(confirmRow('Полоса задания',
                        round3(width) + ' мм · ' + round3(c.fit.strip.rolls) + ' рул.'));
                }
                confirmBox.appendChild(confirmRow('Необеспеченный остаток', round3(c.remaining) + ' рул.'));
                confirmBox.appendChild(confirmRow('Будет обеспечено',
                    round3(rolls) + ' рул.' + (capped ? ' (ограничено 110% остатка)' : '')));
                content.appendChild(confirmBox);
                content.appendChild(el('p', { class: 'atex-pp-hint',
                    text: isNew
                        ? ('Полоса режется заново: раскрой задания меняется (ножей станет больше), длительность — нет ' +
                           '(её задают проходы). Не хватает рулонов заказу — увеличьте «Проходов» в плашке задания.')
                        : ('Полоса перестанет быть складской: её «Партия ГП» получит спрос и «ID заказа» позиции. ' +
                           'Раскладка задания и его длительность не меняются — полоса уже есть в задании.') }));

                // #4426/#4428: ОСТАЛЬНЫЕ позиции ЗАКАЗОВ задания подтягиваются вместе с выбранной
                // (ТЗ: в задание в первую очередь идёт то, что объединено одним заказом) — на
                // свободные полосы задания, а что не легло — новой полосой в оставшийся джамбо.
                // Позиции своих заказов отмечены заранее, из чужих заказов — предложены со снятой
                // галкой и только на СВОБОДНЫЕ полосы (чужой заказ геометрию задания не меняет).
                var chosenStripId = isNew ? null : String(c.fit.strip.id);
                var rest = free.filter(function(s) { return chosenStripId == null || String(s.id) !== chosenStripId; });
                var candById = {};
                candidates.forEach(function(x) { candById[String(x.id)] = x; });
                var restJumbo = round3(jumboFreeMm - (isNew ? count * width : 0));
                var fill = planCutPositionFill(cut, rest, others, coveredOrders,
                    { jumboFreeMm: restJumbo > 0 ? restJumbo : 0, passes: passes });
                var picked = fill.map(function(f) { return !!f.sameOrder; });
                if (fill.length) {
                    content.appendChild(el('div', { class: 'atex-pp-supply-reject-title',
                        text: 'Заодно обеспечим позиции этого задания (' + fill.length + '):' }));
                    var fillBox = el('div', { class: 'atex-pp-supply-fill' });
                    fill.forEach(function(f, i) {
                        var fc = candById[String(f.positionId)];
                        var box = el('input', { type: 'checkbox' });
                        if (picked[i]) box.checked = true;
                        box.addEventListener('change', function() { picked[i] = !!box.checked; });
                        var row = el('label', { class: 'atex-pp-supply-fill-row' }, [
                            box,
                            el('span', { class: 'atex-pp-supply-item-label',
                                text: (fc && fc.label) || ('позиция #' + f.positionId) }),
                            el('span', { class: 'atex-pp-supply-item-meta',
                                text: (f.mode === 'new'
                                        ? ('новая полоса ' + round3(f.width) + ' мм × ' + round3(f.stripCount))
                                        : ('полоса ' + round3(f.width) + ' мм')) +
                                    ' · ' + round3(f.rolls) + ' рул.' + (f.sameOrder ? '' : ' · другой заказ') })
                        ]);
                        fillBox.appendChild(row);
                    });
                    content.appendChild(fillBox);
                } else if (rest.length) {
                    content.appendChild(el('p', { class: 'atex-pp-hint',
                        text: 'Прочие свободные полосы задания (' + rest.length + ') обеспечить нечем: подходящих позиций нет.' }));
                }

                var actions = el('div', { class: 'atex-pp-supply-actions' });
                var back = el('button', { class: 'atex-pp-btn', type: 'button', text: 'Назад' });
                back.addEventListener('click', renderList);
                var ok = el('button', { class: 'atex-pp-btn atex-pp-btn-primary', type: 'button', text: 'Добавить позицию' });
                ok.addEventListener('click', function() {
                    close();
                    var items = [{
                        strip: isNew ? { id: null, width: round3(width), qty: count } : c.fit.strip,
                        candidate: c, rolls: round3(rolls)
                    }];
                    fill.forEach(function(f, i) {
                        if (!picked[i]) return;
                        var fc = candById[String(f.positionId)];
                        if (!fc) return;
                        var strip = f.mode === 'new'
                            ? { id: null, width: round3(f.width), qty: round3(f.stripCount) }
                            : rest.filter(function(s) { return String(s.id) === String(f.stripId); })[0];
                        if (!strip) return;
                        items.push({ strip: strip, candidate: fc, rolls: round3(f.rolls) });
                    });
                    self.createStripSupplies(items, { cutId: cut.id, passes: passes });
                });
                actions.appendChild(back);
                actions.appendChild(ok);
                content.appendChild(actions);
            }

            renderList();
        }).catch(function(err) {
            console.error('[pp] ❌ #4426 не прочитан состав задания ' + cut.id + ':', err && err.message, err && err.stack);
            if (!overlay.parentNode) return;
            content.innerHTML = '';
            content.appendChild(el('h2', { class: 'atex-pp-form-title', text: 'Добавить позицию в задание' }));
            content.appendChild(el('div', { class: 'atex-pp-empty',
                text: 'Ошибка чтения полос задания: ' + (err && err.message || err) }));
        });
    };

    // #3320: создать запись «Обеспечения», привязав позицию заказа к складской полосе
    // (Партии ГП). После записи перечитывает план и переоткрывает редактор полос, чтобы
    // «Назначение» полосы обновилось (Склад → Заказ).
    AtexProductionPlanning.prototype.createStripSupply = function(strip, candidate, rolls) {
        return this.createStripSupplies([{ strip: strip, candidate: candidate, rolls: rolls }]);
    };

    // #4426: то же для НЕСКОЛЬКИХ пар «полоса → позиция» за раз — добавляемая позиция плюс
    // добор остальных полос задания (planCutPositionFill). Пишем последовательно: каждое
    // «Обеспечение» + пометка его «Партии ГП» заказной; план перечитываем ОДИН раз в конце.
    // items — [{ strip, candidate, rolls }]. #4428: полоса БЕЗ id — новая: сперва создаём
    // «Партию ГП» задания (opts.cutId/opts.passes), потом вешаем на неё обеспечение.
    // Любой невалидный элемент — ошибка ДО записи (пишем всё или ничего не начинаем),
    // сбой в середине — перечитываем план, чтобы экран не врал о том, что успело записаться.
    AtexProductionPlanning.prototype.createStripSupplies = function(items, opts) {
        var self = this;
        if (this.busy) return Promise.resolve();
        var meta = this.meta.supply;
        var fbMeta = this.meta.finishedBatch;
        var o = opts || {};
        if (!meta) { this.notify('Нет метаданных таблицы «Обеспечение»', 'error'); return Promise.resolve(); }
        var list = items || [];
        if (!list.length) { this.notify('Нечего обеспечивать: не выбрана позиция', 'error'); return Promise.resolve(); }
        var needsNewStrip = list.some(function(it) { return it && it.strip && it.strip.id == null; });
        if (needsNewStrip && (!fbMeta || o.cutId == null)) {
            this.notify('Не создать новую полосу: нет метаданных «' + TABLE.finishedBatch + '» или задания', 'error');
            return Promise.resolve();
        }
        for (var i = 0; i < list.length; i++) {
            var it = list[i] || {};
            if (!it.strip) { this.notify('Полоса не выбрана (нет «Партии ГП»)', 'error'); return Promise.resolve(); }
            if (it.strip.id == null && !(stripNum(it.strip.width) > 0 && stripNum(it.strip.qty) > 0)) {
                this.notify('Новая полоса без ширины/количества — не создаём', 'error'); return Promise.resolve();
            }
            if (!it.candidate || !it.candidate.id) { this.notify('Не выбрана позиция заказа', 'error'); return Promise.resolve(); }
            if (!(stripNum(it.rolls) > 0)) { this.notify('Нечего обеспечивать (0 рулонов)', 'error'); return Promise.resolve(); }
        }
        this.setBusy(true);
        var done = [];
        var chain = list.reduce(function(acc, it) {
            return acc.then(function() {
                // #4428: новой полосы в БД ещё нет — создаём «Партию ГП» задания («Кол-во план» =
                // полосы × проходов, как persistStrip/#3431), спрос и «ID заказа» проставит
                // markFinishedBatchOrdered после записи обеспечения.
                if (it.strip.id != null) return null;
                var batchFields = buildFinishedBatchFields(fbMeta, {
                    width: it.strip.width, strips: it.strip.qty,
                    planned: finishedBatchRolls(it.strip.qty, o.passes), active: '1'
                });
                return self.post('_m_new/' + fbMeta.id + '?JSON&up=' + encodeURIComponent(o.cutId), batchFields)
                    .then(function(res) {
                        var bid = res && (res.obj || res.id || res.i);
                        if (!bid) throw new Error('Сервер не вернул id новой «' + TABLE.finishedBatch + '»');
                        it.strip.id = String(bid);
                        it.strip._created = true;
                    });
            }).then(function() {
                var pos = it.candidate.position || {};
                var fields = buildSupplyFieldsForFinishedBatch(meta, {
                    finishedBatchId: it.strip.id,
                    rolls: it.rolls,
                    footage: stripNum(pos.length) > 0 ? pos.length : '',
                    active: '1',
                    status: SUPPLY_STATUSES[0]
                });
                return self.post('_m_new/' + meta.id + '?JSON&up=' + encodeURIComponent(it.candidate.id), fields)
                    .then(function(res) {
                        var id = res && (res.obj || res.id || res.i);
                        if (!id) throw new Error('Сервер не вернул id обеспечения');
                        // #4426: полоса перестала быть складской — «Партия ГП» получает СПРОС и
                        // «ID заказа» (те же поля, что пишет генерация, #3433, и слияние заданий,
                        // #4424). Без этого партия остаётся «в запас»: склад считает её свободной,
                        // хотя она уже в заказе.
                        return self.markFinishedBatchOrdered(it.strip.id, it.rolls, pos.orderId);
                    }).then(function() {
                        done.push(round3(stripNum(it.strip.width)) + ' мм · ' + round3(it.rolls) + ' рул.' +
                            (it.strip._created ? ' (новая)' : ''));
                    });
            });
        }, Promise.resolve());
        return chain.then(function() {
            return self.loadPlanning();
        }).then(function() {
            self.setBusy(false);
            self.notify(list.length === 1
                ? ('Обеспечение создано: позиция привязана к полосе (' + round3(list[0].rolls) + ' рул.)')
                : ('Обеспечено позиций: ' + list.length + ' — полосы ' + done.join('; ')), 'success');
            self.render();
            self.reopenStripsIfOpen();
        }).catch(function(err) {
            console.error('[pp] ❌ #4426 обеспечение прервано (записано ' + done.length + ' из ' + list.length + '):',
                err && err.message, err && err.stack);
            self.setBusy(false);
            var tail = done.length ? (' Записано до сбоя: ' + done.length + ' из ' + list.length + '.') : '';
            self.notify('Ошибка создания обеспечения: ' + (err && err.message || err) + tail, 'error');
            return self.loadPlanning().then(function() { self.render(); self.reopenStripsIfOpen(); }).catch(function() {});
        });
    };

    // #4426: пометить «Партию ГП» заказной: «Кол-во рулонов» (СПРОС) += рулоны обеспечения,
    // «ID заказа» — заказ покрытой позиции (список через запятую, как batchOrderId/#4424).
    // Текущее значение читаем из БД (F_I), чтобы не затереть уже накопленный спрос других
    // обеспечений этой партии. Нет реквизитов в метаданных / отказ записи — НЕ рушим уже
    // созданное обеспечение, но и не молчим: пишем в консоль и предупреждаем тостом.
    AtexProductionPlanning.prototype.markFinishedBatchOrdered = function(batchId, rolls, orderId) {
        var self = this;
        var fbMeta = this.meta.finishedBatch;
        if (!fbMeta || batchId == null || String(batchId) === '') return Promise.resolve(false);
        var rollsReq = reqIdByName(fbMeta, FINISHED_BATCH_REQ.rolls);
        var orderReq = reqIdByName(fbMeta, FINISHED_BATCH_REQ.orderId);
        var rollsIdx = columnIndex(fbMeta, FINISHED_BATCH_REQ.rolls);
        var orderIdx = columnIndex(fbMeta, FINISHED_BATCH_REQ.orderId);
        if (!rollsReq && !orderReq) {
            console.error('[pp] ❌ #4426: в метаданных «' + TABLE.finishedBatch + '» нет «' +
                FINISHED_BATCH_REQ.rolls + '»/«' + FINISHED_BATCH_REQ.orderId + '» — партия останется складской');
            self.notify('Обеспечение создано, но «Партию ГП» не пометить заказной: нет реквизитов «' +
                FINISHED_BATCH_REQ.rolls + '»/«' + FINISHED_BATCH_REQ.orderId + '»', 'warning');
            return Promise.resolve(false);
        }
        var stripsIdx = columnIndex(fbMeta, FINISHED_BATCH_REQ.strips);
        return this.getJson('object/' + fbMeta.id + '/?JSON_OBJ&F_I=' + encodeURIComponent(batchId) + '&LIMIT=0,1')
            .then(function(rows) {
                var r = (rows && rows[0] && rows[0].r) || [];
                var curRolls = (rollsIdx >= 0 && r[rollsIdx] != null) ? stripNum(r[rollsIdx]) : 0;
                var curOrder = (orderIdx >= 0 && r[orderIdx] != null) ? String(r[orderIdx]).trim() : '';
                // #3431: у СТАРЫХ партий «Кол-во полос» пусто, и число полос лежит в «Кол-во
                // рулонов» (редактор полос читает его фолбэком). Такой записи спрос не
                // прибавляем — иначе у полосы «уедет» количество; ставим только «ID заказа».
                var legacyRollsAreStrips = stripsIdx >= 0 &&
                    String(r[stripsIdx] == null ? '' : r[stripsIdx]).trim() === '';
                var f = {};
                if (rollsReq && !legacyRollsAreStrips) f['t' + rollsReq] = String(round3(curRolls + stripNum(rolls)));
                if (legacyRollsAreStrips) {
                    console.warn('[pp] ⚠️ #4426: «Партия ГП» ' + batchId + ' без «' + FINISHED_BATCH_REQ.strips +
                        '» (старая запись) — спрос не трогаем, пишем только «' + FINISHED_BATCH_REQ.orderId + '»');
                }
                var orders = curOrder === '' ? [] : curOrder.split(',').map(function(x) { return x.trim(); }).filter(Boolean);
                var add = String(orderId == null ? '' : orderId).trim();
                if (orderReq && add !== '' && orders.indexOf(add) < 0) orders.push(add);
                if (orderReq && orders.length) f['t' + orderReq] = orders.join(',');
                if (!Object.keys(f).length) return false;
                return self.post('_m_set/' + encodeURIComponent(batchId) + '?JSON', f).then(function() { return true; });
            }).catch(function(err) {
                console.error('[pp] ❌ #4426: «Партия ГП» ' + batchId + ' не помечена заказной:', err && err.message, err && err.stack);
                self.notify('Обеспечение создано, но «Партию ГП» не удалось пометить заказной: ' +
                    (err && err.message || err) + ' — поправьте спрос/«ID заказа» в карточке партии', 'warning');
                return false;
            });
    };

    // #4428: «Партии ГП» задания С ЧИСЛАМИ план/спроса (loadStripsForCut отдаёт только
    // ширину и полосы). → [{ id, width, strips, rolls, planned }] в порядке БД.
    AtexProductionPlanning.prototype.loadBatchesForCut = function(cutId) {
        var fbMeta = this.meta.finishedBatch;
        if (!fbMeta) return Promise.resolve([]);
        var widthIdx = columnIndex(fbMeta, FINISHED_BATCH_REQ.width);
        var stripsIdx = columnIndex(fbMeta, FINISHED_BATCH_REQ.strips);
        var rollsIdx = columnIndex(fbMeta, FINISHED_BATCH_REQ.rolls);
        var plannedIdx = columnIndex(fbMeta, FINISHED_BATCH_REQ.planned);
        return this.getJson('object/' + fbMeta.id + '/?JSON_OBJ&F_U=' + encodeURIComponent(cutId) + '&LIMIT=0,500')
            .then(function(rows) {
                return (rows || []).map(function(rec) {
                    var r = rec.r || [];
                    return {
                        id: String(rec.i),
                        width: widthIdx >= 0 ? stripNum(r[widthIdx]) : 0,
                        strips: stripsIdx >= 0 ? stripNum(r[stripsIdx]) : 0,
                        rolls: rollsIdx >= 0 ? stripNum(r[rollsIdx]) : 0,
                        planned: plannedIdx >= 0 ? stripNum(r[plannedIdx]) : 0
                    };
                });
            });
    };

    // #4428: диспетчер поменял «Проходов» в плашке задания. Проходы — единственный рычаг
    // подгонки резки под заказ (полосы упираются в ширину джамбо), но менять их молча нельзя:
    // они задают длительность задания, план «Партий ГП» и то, сколько рулонов достанется
    // позициям. Поэтому сперва СЧИТАЕМ и ПОКАЗЫВАЕМ, что изменится, и только по «Применить»
    // пишем (applyCutPasses). revert — вернуть поле к прежнему значению (отказ/ошибка).
    AtexProductionPlanning.prototype.changeCutPasses = function(cut, rawValue, revert) {
        var self = this;
        function back() { if (typeof revert === 'function') revert(); }
        if (!cut) { back(); return Promise.resolve(false); }
        if (this.busy) { this.notify('Идёт другая операция — подождите', 'info'); back(); return Promise.resolve(false); }
        var cutMeta = this.meta.cut;
        if (!cutMeta) { this.notify('Нет метаданных таблицы заданий', 'error'); back(); return Promise.resolve(false); }
        var runsReq = reqIdByAnyName(cutMeta, CUT_PLANNED_RUNS_NAMES);
        if (!runsReq) {
            console.error('[pp] ❌ #4428: в метаданных задания нет реквизита «' + CUT_PLANNED_RUNS_NAMES[0] + '»');
            this.notify('Не изменить проходы: в таблице заданий нет реквизита «' + CUT_PLANNED_RUNS_NAMES[0] + '»', 'error');
            back(); return Promise.resolve(false);
        }
        var was = stripNum(cut.plannedRuns);
        var runs = Math.round(stripNum(rawValue));
        if (!(runs > 0)) { this.notify('Проходов должно быть больше нуля', 'error'); back(); return Promise.resolve(false); }
        if (runs > MAX_MANUAL_PASSES) {
            this.notify('Проходов не больше ' + MAX_MANUAL_PASSES + ' — столько джамбо в одно задание не ставят', 'error');
            back(); return Promise.resolve(false);
        }
        if (runs === was) { back(); return Promise.resolve(false); }
        if (cutIsStarted(cut)) { this.notify('Задание начато — число проходов не меняем', 'info'); back(); return Promise.resolve(false); }
        if (cut.fixed) { this.notify('Задание зафиксировано (🔒) — снимите фиксацию, чтобы менять проходы', 'info'); back(); return Promise.resolve(false); }
        // #4588: заморозка дня РУЧНУЮ правку не запрещает — она ограничивает автоматику. Замок 🔒
        // и «начато» проверены выше: это другие правила, они остаются.
        // #3635 п.5/#4209: хвост настройки (0 проходов) резки не несёт — проходы задаёт голова цепочки.
        if (!(was > 0)) {
            this.notify('Это хвост настройки (0 проходов) — проходы задаются в головном сегменте задания', 'info');
            back(); return Promise.resolve(false);
        }

        return this.loadBatchesForCut(cut.id).then(function(batches) {
            var needByPosition = {};
            (self.genPositions || []).forEach(function(p) {
                if (p && p.id != null) needByPosition[String(p.id)] = stripNum(p.qty);
            });
            var plan = planPassesUpdates(cut.id, batches, self.supplies, needByPosition, runs);
            var runLength = cutRunLength(cut, self.supplies, self.positionLengthById);
            var durWas = Math.ceil(plannedCutDurationMinutes(runLength, was, self.opTimes, cut));   // #4501
            var durNow = Math.ceil(plannedCutDurationMinutes(runLength, runs, self.opTimes, cut));
            self.openCutPassesConfirm(cut, was, runs, durWas, durNow, plan, back);
            return true;
        }).catch(function(err) {
            console.error('[pp] ❌ #4428 не прочитаны «Партии ГП» задания ' + cut.id + ':', err && err.message, err && err.stack);
            self.notify('Не прочитать состав задания: ' + (err && err.message || err), 'error');
            back();
            return false;
        });
    };

    // #4428: показать, что даст смена проходов, и записать по подтверждению. Отдельным окном,
    // потому что менять придётся не только задание: план каждой «Партии ГП» и рулоны
    // «Обеспечений» (иначе добавленные проходы уедут на склад, а позиция останется
    // недообеспеченной). Отказ/крестик — поле возвращается к прежнему значению.
    AtexProductionPlanning.prototype.openCutPassesConfirm = function(cut, was, runs, durWas, durNow, plan, revert) {
        var self = this;
        var reverted = false;
        var dialog = el('div', { class: 'atex-pp-modal-dialog atex-pp-supply-dialog' });
        var overlay = el('div', { class: 'atex-pp-modal atex-pp-supply-modal is-open' }, [dialog]);
        function close(cancel) {
            if (cancel && !reverted) { reverted = true; if (typeof revert === 'function') revert(); }
            if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        }
        overlay.addEventListener('click', function(e) { if (e.target === overlay) close(true); });
        var closeX = el('button', { class: 'atex-pp-modal-close', type: 'button', text: '×', title: 'Закрыть' });
        closeX.addEventListener('click', function() { close(true); });
        dialog.appendChild(closeX);
        var content = el('div', { class: 'atex-pp-supply-content' });
        dialog.appendChild(content);
        content.appendChild(el('h2', { class: 'atex-pp-form-title', text: 'Изменить число проходов?' }));

        function row(label, value) {
            return el('div', { class: 'atex-pp-supply-confirm-row' }, [
                el('span', { class: 'atex-pp-supply-confirm-label', text: label }),
                el('span', { class: 'atex-pp-supply-confirm-value', text: String(value) })
            ]);
        }
        var box = el('div', { class: 'atex-pp-supply-confirm' }, [
            row('Задание', '№ ' + (formatCutNumber(cut.number) || cut.id)),
            row('Проходов', was + ' → ' + runs),
            row('Длительность, мин', (durWas > 0 ? durWas : '—') + ' → ' + (durNow > 0 ? durNow : '—'))
        ]);
        (plan.batches || []).forEach(function(b) {
            var txt = 'план ' + round3(b.wasPlanned) + ' → ' + round3(b.planned) + ' рул.';
            if (b.rolls != null && b.rolls !== b.wasRolls) txt += ', спрос ' + round3(b.wasRolls) + ' → ' + round3(b.rolls) + ' рул.';
            box.appendChild(row('Полоса ' + round3(b.width) + ' мм', txt));
        });
        var posLabelById = {};
        (this.positions || []).forEach(function(p) { posLabelById[String(p.id)] = p.label; });
        (plan.supplies || []).forEach(function(s) {
            box.appendChild(row('Обеспечение ' + (posLabelById[String(s.positionId)] || ('позиции #' + s.positionId)),
                round3(s.was) + ' → ' + round3(s.rolls) + ' рул.'));
        });
        content.appendChild(box);
        content.appendChild(el('p', { class: 'atex-pp-hint',
            text: 'Порядок заданий не меняется. Длительность задания изменится, поэтому день станка ' +
                'разъедется — пересоберите его кнопкой «↻ Пересчитать наладку»: она же разобьёт задание ' +
                'по дням, если проходы больше не влезают в смену.' }));
        if ((plan.keptSupplyIds || []).length) {
            content.appendChild(el('p', { class: 'atex-pp-hint',
                text: 'Обеспечений не тронем: ' + plan.keptSupplyIds.length +
                    ' — их позиций нет в планировании или их остаток покрыт другими заданиями.' }));
        }
        if ((plan.legacyBatchIds || []).length) {
            content.appendChild(el('p', { class: 'atex-pp-hint',
                text: 'Старых «Партий ГП» без «' + FINISHED_BATCH_REQ.strips + '»: ' + plan.legacyBatchIds.length +
                    ' — их план не пересчитываем (в «' + FINISHED_BATCH_REQ.rolls + '» у них лежит число полос).' }));
        }

        var actions = el('div', { class: 'atex-pp-supply-actions' });
        var cancel = el('button', { class: 'atex-pp-btn', type: 'button', text: 'Отмена' });
        cancel.addEventListener('click', function() { close(true); });
        var ok = el('button', { class: 'atex-pp-btn atex-pp-btn-primary', type: 'button', text: 'Применить' });
        ok.addEventListener('click', function() {
            reverted = true;   // применяем — возвращать поле не надо
            close(false);
            self.applyCutPasses(cut, runs, plan, durNow);
        });
        actions.appendChild(cancel);
        actions.appendChild(ok);
        content.appendChild(actions);
        this.root.appendChild(overlay);
    };

    // #4428: записать новое число проходов задания: «Кол-во резок план» + пересчитанные
    // «Длительность, минут»/«Тайминг» (как при слиянии заданий, #4424) → «Кол-во план»/спрос
    // «Партий ГП» → рулоны «Обеспечений» → хранимые колонки наладки этого задания
    // (persistCutSetupColumns, чтобы карточка и Гант показывали новое время). Сбой в середине
    // не прячем: перечитываем план, чтобы экран не врал о записанном.
    AtexProductionPlanning.prototype.applyCutPasses = function(cut, runs, plan, durNow) {
        var self = this;
        if (this.busy) return Promise.resolve(false);
        this._ppOp = 'applyCutPasses';   // #4177: контекст трассы записей
        var cutMeta = this.meta.cut, fbMeta = this.meta.finishedBatch, supMeta = this.meta.supply;
        var runsReq = reqIdByAnyName(cutMeta, CUT_PLANNED_RUNS_NAMES);
        var durReq = reqIdByName(cutMeta, CUT_REQ.duration);
        var timingReq = reqIdByName(cutMeta, CUT_REQ.timing);
        var fbPlannedReq = fbMeta ? reqIdByName(fbMeta, FINISHED_BATCH_REQ.planned) : null;
        var fbRollsReq = fbMeta ? reqIdByName(fbMeta, FINISHED_BATCH_REQ.rolls) : null;
        var supRollsReq = supMeta ? reqIdByName(supMeta, SUPPLY_REQ.rolls) : null;
        var runLength = cutRunLength(cut, this.supplies, this.positionLengthById);
        var fields = {};
        fields['t' + runsReq] = String(runs);
        if (durReq) fields['t' + durReq] = durNow > 0 ? String(durNow) : '';
        if (timingReq) fields['t' + timingReq] = cutTimingDetails(runLength, runs, this.opTimes, cut);   // #4501
        var slitterId = (cut.slitter && cut.slitter.id) || '';
        var written = { batches: 0, supplies: 0 };
        this.setBusy(true);
        return this.post('_m_set/' + encodeURIComponent(cut.id) + '?JSON', fields).then(function() {
            return (plan.batches || []).reduce(function(chain, b) {
                return chain.then(function() {
                    var f = {};
                    if (fbPlannedReq) f['t' + fbPlannedReq] = String(round3(b.planned));
                    if (fbRollsReq && b.rolls != null) f['t' + fbRollsReq] = String(round3(b.rolls));
                    if (!Object.keys(f).length) return;
                    return self.post('_m_set/' + encodeURIComponent(b.id) + '?JSON', f)
                        .then(function() { written.batches += 1; });
                });
            }, Promise.resolve());
        }).then(function() {
            if (!supRollsReq && (plan.supplies || []).length) {
                console.error('[pp] ❌ #4428: в метаданных «Обеспечения» нет «' + SUPPLY_REQ.rolls + '» — рулоны не пересчитать');
                self.notify('Проходы записаны, но рулоны «Обеспечений» не обновить: нет реквизита «' +
                    SUPPLY_REQ.rolls + '»', 'warning');
                return;
            }
            return (plan.supplies || []).reduce(function(chain, s) {
                return chain.then(function() {
                    var f = {};
                    f['t' + supRollsReq] = String(round3(s.rolls));
                    return self.post('_m_set/' + encodeURIComponent(s.id) + '?JSON', f)
                        .then(function() { written.supplies += 1; });
                });
            }, Promise.resolve());
        }).then(function() {
            return self.reload();
        }).then(function() {
            // Хранимые «Наладка ножей»/«Сырье/намотка»/«Резка и Лидер» этого задания — от проходов;
            // без них карточка и Гант показывали бы прежнее время (#3862).
            return self.persistCutSetupColumns([String(cut.id)]);
        }).then(function() {
            return self.reload();
        }).then(function() {
            self.setBusy(false);
            self.render();
            self.reopenStripsIfOpen();
            self.notify('Проходов: ' + runs + ' (партий обновлено ' + written.batches +
                ', обеспечений ' + written.supplies + '). Время дня разъехалось — нажмите «↻ Пересчитать наладку»', 'success');
            if (slitterId) self.warnOverfilledDays(slitterId);   // день мог перестать вмещать задание
            return true;
        }).catch(function(err) {
            console.error('[pp] ❌ #4428 смена проходов задания ' + cut.id + ' прервана (партий ' +
                written.batches + ', обеспечений ' + written.supplies + '):', err && err.message, err && err.stack);
            self.setBusy(false);
            self.notify('Ошибка смены проходов: ' + (err && err.message || err) +
                ' Записано до сбоя: партий ' + written.batches + ', обеспечений ' + written.supplies + '.', 'error');
            return self.reload().then(function() { self.render(); self.reopenStripsIfOpen(); }).catch(function() {});
        });
    };

    // #4536: ВЫПУСК ПОЗИЦИЙ ЗАКАЗА по текущему плану — «Кол-во полос» «Партии ГП» × «Кол-во резок
    // план» задания. Этим меряется покрытие позиции везде, где раньше складывали хранимое
    // «Кол-во рулонов» обеспечения: отчёт cut_planning его не отдаёт, и «неизвестно» читалось
    // нулём — позиция выглядела необеспеченной целиком, сколько бы заданий её ни выпускало.
    // → { positionId: штук }.
    AtexProductionPlanning.prototype.producedRollsByPosition = function() {
        var runsByCut = {};
        (this.cuts || []).forEach(function(c) {
            if (c && c.id != null) runsByCut[String(c.id)] = stripNum(c.plannedRuns);
        });
        return producedRollsByPosition(this.supplies || [], this.stripsByBatch || {}, runsByCut);
    };

    AtexProductionPlanning.prototype.reload = function() {
        var self = this;
        this._pendingPlan = null;     // #4402: очередь придёт из БД — проекция «Упорядочить» и её снимок неактуальны
        // Полосы перечитываем перед очередью, чтобы knifeCount/knifeWidths влились в свежие резки.
        return this.loadCutStrips().then(function() { return self.loadPlanning(); })
            .then(function() { return self.loadSleeveBatches(); }) // #3340: обновляем партии втулок (FIFO)
            // #4596: смены закрываются В ТЕЧЕНИЕ дня — событие могло появиться уже после загрузки
            // страницы, поэтому карту закрытых смен обновляем вместе с очередью (⟳ и после записи).
            .then(function() { return self.loadShiftEvents(); })
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

        // #3253: редактируем «Кол-во полос» (за проход); «Рулонов» (полос × проходов) —
        // справочно, read-only. Геометрия (Занято/Остаток/Ножи) считается по полосам.
        var passes = stripNum(cut.plannedRuns) > 0 ? stripNum(cut.plannedRuns) : 1;

        // Заголовок: сырьё + ширина джамбо, проходы, справа — иконка закрытия (#3127).
        var matLabel = (cut.materialBatch && cut.materialBatch.label) || cut.materialName || cut.materialId || '—';
        var closeIcon = el('button', { class: 'atex-pp-strip-close', type: 'button', title: 'Закрыть', text: '×' });
        closeIcon.addEventListener('click', function() {
            self.stripEditCutId = null;
            if (panel.parentNode) panel.parentNode.removeChild(panel);
        });
        // #4428: «Проходов» — редактируемое «Кол-во резок план». Полосы ограничены шириной
        // джамбо, поэтому под заказ резка настраивается ИМЕННО проходами; раньше их можно было
        // задать только при генерации. Начатое задание не трогаем (#4381), зафиксированное
        // глушит lockStripPanel (#3508 п.3).
        var passesInput = el('input', { class: 'atex-pp-input atex-pp-strip-passes', type: 'number',
            min: '1', step: '1', title: 'Проходов (Кол-во резок план): полосы × проходов = рулоны задания' });
        passesInput.value = String(passes);
        if (cutIsStarted(cut)) {
            passesInput.disabled = true;
            passesInput.title = 'Задание начато — число проходов не меняем';
        }
        passesInput.addEventListener('change', function() {
            self.changeCutPasses(cut, passesInput.value, function() { passesInput.value = String(passes); });
        });
        panel.appendChild(el('div', { class: 'atex-pp-strip-header' }, [
            el('span', { class: 'atex-pp-strip-header-text', text: 'Сырьё: ' + matLabel + ', Джамбо: ' + (jumbo || '—') + ' мм' }),
            el('label', { class: 'atex-pp-strip-passes-box' }, [
                el('span', { class: 'atex-pp-strip-passes-label', text: 'Проходов' }),
                passesInput
            ]),
            closeIcon
        ]));

        // Таблица полос.
        var table = el('div', { class: 'atex-pp-strip-table' });
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

        // Кнопки «+ полоса» и «+ позиция» (#4428).
        var addBtn = el('button', { class: 'atex-pp-btn atex-pp-strip-add', type: 'button', text: '+ полоса' });
        addBtn.addEventListener('click', function() {
            strips.push({ id: null, width: '', qty: '' });   // #3242: запись «Партии ГП»
            renderRows();
            recalc();
        });
        // #4428: «+ позиция» переехала сюда с панели «Связанные позиции» (#4426) и теперь умеет
        // ДОБАВЛЯТЬ ПОЛОСУ: позицию, которую удалили из задания или дозаказали позже, кладём на
        // свободную полосу её ширины, а если такой нет — режем новую в остаток джамбо.
        var addPosBtn = el('button', { class: 'atex-pp-btn atex-pp-strip-add-pos', type: 'button',
            text: '+ позиция', title: 'Добавить позицию заказа: на свободную полосу её ширины или новой полосой в остаток джамбо' });
        addPosBtn.addEventListener('click', function() {
            if (self.busy) return;
            self.openCutPositionPicker(cut, { jumbo: jumbo, strips: strips, passes: passes });
        });
        panel.appendChild(el('div', { class: 'atex-pp-strip-add-row' }, [addBtn, addPosBtn]));

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
        this.updateProgress(0, 'Обновление позиций и очереди…');
        Promise.all([this.loadPositions(), this.reload()]).then(function() {
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
        this._ppOp = 'runGenerateCuts';   // #4177: контекст трассы записей (async)
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
        var genDayCapacityMin = dayCapacityMinutes(genWindow, 'cuts');   // #4563: один потолок на всех
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
                duration: 0   // #4501: считаем ниже — норма зависит от полос самого дескриптора
            };
            // #3830/#4501: рабочие минуты резки (намотка) — чтобы выбор станка учитывал ёмкость дня.
            // Норма выбирается по фольге И самой узкой полосе дескриптора, поэтому после его сборки.
            descriptor.duration = plannedCutDurationMinutes(runLength, plannedRuns, self.opTimes, descriptor);
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
                duration: plannedCutDurationMinutes(runLength, plannedRuns, self.opTimes, descriptor), // #3606/#4501
                timing: cutTimingDetails(runLength, plannedRuns, self.opTimes, descriptor),
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
            self.plannedTailSetup = {};   // #4144: решение упаковщика по хвостам дня (см. computeCutSetupUpdates)
            layoutPlans.forEach(function(plan) {
                var s = String(plan.slitterId == null ? '' : plan.slitterId);
                if (s === '') return;
                (bySlitter[s] = bySlitter[s] || []).push(plan);
            });
            Object.keys(bySlitter).forEach(function(s) {
                var plans = bySlitter[s].slice().sort(function(a, b) { return (Number(a.sequence) || 0) - (Number(b.sequence) || 0); });
                var perPassByCut = {}, runsByCut = {};
                plans.forEach(function(p) {
                    perPassByCut[String(p.id)] = windingMinutes(p.runLength, windPointsForCut(p, windPoints)); // #3606/#4501
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
                // #4144: разложение setup-only хвоста дня по колонкам — решение упаковщика (room считан
                // по дробному окну, ДО снапа). Писатель колонок возьмёт его по «станок + плановый старт».
                segs.forEach(function(sg) {
                    if (!sg.setupOnly || sg.setupKnifeMin == null) return;
                    var tailTs = scheduleStartTimestamp(planBaseMidnightMs, sg.windowStartMin);
                    self.plannedTailSetup[tailSetupKey(s, tailTs)] = { knife: Math.round(sg.setupKnifeMin), material: Math.round(sg.setupMaterialMin) };
                });
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
                            timing: cutTimingDetails(p.runLength, sg.runs, self.opTimes, p), // #3606/#4501
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
        var MAX_PARALLEL_SAVES = MAX_PARALLEL_WRITES;   // #4477: предел один на весь модуль
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
                // #4347: НОВУЮ резку НЕ сохраняем на замороженный день. Иначе её главное значение
                // (Дата план = замороженный день) заставит пин #4326 пометить её c.fixed → она
                // закрепится на замороженном дне и seal её НЕ заблокирует (seal блокирует только
                // СВОБОДНЫЕ) → набивка замороженного дня (issue #4347: «удалил всё → генерация →
                // напихало в замороженный день»). Сдвигаем Дату план на первый НЕзамороженный день;
                // финальный autoSequenceQueue разложит от неё по срокам. Реально существовавшие
                // (committed) резки грузятся из БД и сюда, в создание НОВЫХ, не попадают.
                var _fzGuard = 0;
                while (self.dayIsFrozen(cutMainValue) && _fzGuard++ < 400) {
                    cutMainValue = Number(cutMainValue) + 86400;   // +1 сутки (главное значение в секундах)
                }
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
                    var key = stripWidthKey(s.width);
                    // #4179: «ID заказа» партии — по ПОКРЫТИЮ РАСКЛАДКИ (заказы покрытых позиций
                    // этой ширины), а НЕ по доле рулонов сегмента. У setup-only сегмента дробления
                    // (0 проходов) доля рулонов = 0, но его «Партия ГП» всё равно ВЫПУСКАЕТ этот
                    // заказ (та же раскладка) — без «ID заказа» она станет сиротой «нет связей»
                    // (reconcileOrphanOrderSupplies её не чинит: пустой order id, #4175). Заказ
                    // определяет покрытие раскладки, число рулонов — доля сегмента: разделяем.
                    if (s.orderId != null && String(s.orderId) !== '') {
                        (ordersByWidth[key] = ordersByWidth[key] || []).push(s.orderId);
                    }
                    if (!(s.rolls > 0)) return;
                    demandByWidth[key] = round3((demandByWidth[key] || 0) + s.rolls);
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
            // #4631: набор «Задач на втулки» затронутых позиций приводим к плану — по задаче на
            // звено резки. Именно здесь копились дубли: генерация создавала НОВЫЙ комплект, а
            // старый убрать было некому (задача подчинена ПОЗИЦИИ, связи с заданием нет).
            // Сверяем ПОСЛЕ reload: нужны свежие «Обеспечения» — по ним и видны звенья.
            var genPositionIds = [];
            (layouts || []).forEach(function(lay) {
                ((lay && lay.positionsCovered) || []).forEach(function(pid) {
                    var id = String(pid == null ? '' : pid);
                    if (id && genPositionIds.indexOf(id) === -1) genPositionIds.push(id);
                });
            });
            if (typeof self.reconcileSleeveTasks !== 'function') return null;   // стаб-self в юнит-тестах
            return self.reconcileSleeveTasks(genPositionIds);
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

    // #4541: ПОДТВЕРЖДЕНИЕ МОДАЛКОЙ — когда полоску подтверждения показать негде.
    // Полоска (`.atex-pp-confirm-bar`) хороша, пока ей есть куда встать РЯДОМ с действием: под
    // карточкой задания, в панели кнопок. Действию без такого места (замок дня живёт в шапке дня
    // очереди, а не в панели) полоска доставалась в конец рабочего места — оператор её просто не
    // видел и решал, что кнопка не работает (issue #4541, «Разморозить день»). Такие подтверждения
    // показываем модальным окном — тем же, что и «Заморозить день», чтобы пара действий выглядела
    // одинаково. Ctrl+Enter работает сам: `js/form-submit.js` ловит модалку по классу `*modal*`
    // и жмёт кнопку `*-btn-primary` (UI/UX-правила).
    //   message — узел или текст; okLabel/onConfirm — как у confirmAction; opts.title — заголовок.
    // → функция закрытия окна (null, если действий нет).
    AtexProductionPlanning.prototype.confirmModal = function(message, okLabel, onConfirm, opts) {
        var actions = normalizeConfirmActions(okLabel, onConfirm);
        if (!actions.length) return null;
        var o = opts || {};
        var dialog = el('div', { class: 'atex-pp-modal-dialog atex-pp-confirm-dialog' });
        var overlay = el('div', { class: 'atex-pp-modal atex-pp-confirm-modal is-open' }, [dialog]);
        function close() { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }
        overlay.addEventListener('click', function(e) { if (e.target === overlay) close(); });
        var closeX = el('button', { class: 'atex-pp-modal-close', type: 'button', text: '×', title: 'Закрыть' });
        closeX.addEventListener('click', close);
        dialog.appendChild(closeX);
        var content = el('div', { class: 'atex-pp-confirm-content' });
        dialog.appendChild(content);
        if (o.title) content.appendChild(el('h2', { class: 'atex-pp-form-title', text: o.title }));
        content.appendChild((message && message.nodeType) ? message : el('span', { class: 'atex-pp-confirm-msg', text: message }));
        var row = el('div', { class: 'atex-pp-supply-actions' });
        var cancel = el('button', { class: 'atex-pp-btn', type: 'button', text: 'Отмена' });
        cancel.addEventListener('click', close);
        row.appendChild(cancel);
        actions.forEach(function(action) {
            var cls = 'atex-pp-btn' + (action.warning ? ' atex-pp-btn-warning' : (action.primary ? ' atex-pp-btn-primary' : ''));
            var btn = el('button', { class: cls, type: 'button', text: action.label });
            btn.addEventListener('click', function() { close(); action.onConfirm(); });
            row.appendChild(btn);
        });
        content.appendChild(row);
        var host = this.root || (typeof document !== 'undefined' ? document.body : null);
        if (!host) return null;
        host.appendChild(overlay);
        return close;
    };

    // Подтверждение без native confirm: полоска рядом с действием (`actionsEl`), а если места
    // для неё нет — модалка (#4541, `confirmModal`).
    AtexProductionPlanning.prototype.confirmAction = function(message, actionsEl, okLabel, onConfirm) {
        var actions = normalizeConfirmActions(okLabel, onConfirm);
        if (!actions.length) return;
        // #4541: якорь — это МЕСТО РЯДОМ С ДЕЙСТВИЕМ. Весь экран (this.root) якорем не считается:
        // полоска, приклеенная к нему, оказывается ниже всей очереди. Раньше на этот случай стоял
        // вызов `window.mainAppController.showDeleteConfirmModal`, но глобала с таким именем в
        // приложении нет (`js/main-app.js` держит контроллер локальной переменной) — ветка была
        // мёртвой, и подтверждение молча уезжало вниз страницы.
        var host = (actionsEl && actionsEl !== this.root) ? actionsEl : null;
        if (!host) host = (this.root && this.root.querySelector) ? this.root.querySelector('.atex-pp-panel-actions') : null;
        if (!host) { this.confirmModal(message, actions); return; }
        if (host && host.querySelector && host.querySelector('.atex-pp-confirm-bar')) return;
        var bar = el('div', { class: 'atex-pp-confirm-bar' });
        bar.appendChild((message && message.nodeType) ? message : el('span', { class: 'atex-pp-confirm-msg', text: message }));
        var cancelBtn = el('button', { class: 'atex-pp-btn', type: 'button', text: 'Отмена' });
        // #4568: пока висит подтверждение, кнопки, его ВЫЗВАВШИЕ, не показываем. Полоска встаёт
        // в тот же ряд, что и они, и делила с ними ширину: «Урегулировать» и «Закрыть» сжимались
        // в узкие высокие столбцы (скриншот тикета). Заодно уходит второй вопрос — по какой из
        // двух одинаково подписанных кнопок жать. Прячем только ПРЯМЫХ детей-кнопок хоста:
        // вложенные кнопки (карточка задания как хост) к этому подтверждению не относятся.
        var hiddenBtns = [];
        (host.childNodes ? Array.prototype.slice.call(host.childNodes) : []).forEach(function(node) {
            if (!node || node === bar || node.tagName !== 'BUTTON') return;
            hiddenBtns.push({ node: node, display: node.style ? node.style.display : '' });
            if (node.style) node.style.display = 'none';
        });
        function removeBar() {
            if (bar.parentNode) bar.parentNode.removeChild(bar);
            // Вернуть кнопки на место обязаны ОБА выхода — и «Отмена», и подтверждение: форма
            // остаётся открытой (например «Отклонения»), и без них в ней нечего нажать.
            hiddenBtns.forEach(function(h) { if (h.node.style) h.node.style.display = h.display; });
        }
        actions.forEach(function(action) {
            var cls = 'atex-pp-btn' + (action.warning ? ' atex-pp-btn-warning' : (action.primary ? ' atex-pp-btn-primary' : ''));
            var btn = el('button', { class: cls, type: 'button', text: action.label });
            btn.addEventListener('click', function() { removeBar(); action.onConfirm(); });
            bar.appendChild(btn);
        });
        cancelBtn.addEventListener('click', function() { removeBar(); });
        bar.appendChild(cancelBtn);
        // #4541: host здесь всегда есть (иначе выше ушли в модалку). Прежняя ветка «места нет →
        // выполнить действие БЕЗ подтверждения» убрана: молча делать то, о чём спрашивали, нельзя.
        host.appendChild(bar);
    };

    // #3698/#3700: пересчитать и сохранить расчётные минуты каждой резки — «Наладка ножей,
    // мин» (KNIFE), «Сырье/намотка, мин» (MATERIAL_WINDING) и «Резка и Лидер» (намотка + лидер) —
    // чтобы Гант (cut-gantt) и отчёты
    // брали готовые минуты, а не пересчитывали по соседям. Порядок исполнения — по
    // planStart в пределах станка (#3923, как orderCutsInGroup Ганта); первая резка — от текущей
    // заправки станка, нет данных → настройка ножей с нуля. Пишет только
    // изменившиеся (diff против отчётных значений), тихо и БЕЗ reload (свой экран РМ считает
    // наладку на лету). Колонок ещё нет в метаданных → no-op. Ошибки глотает: доп-колонки не
    // должны валить сохранение очереди/плана. Вызывается после сохранений порядка/плана.
    // #3778: тайминг-поля задания (t96067 «Наладка ножей, мин» / t96069 «Сырье/намотка, мин» /
    // t96778 «Резка и Лидер») одним набором реквизитов для _m_set. Отсутствующие reqId не пишем.
    // #4144: ключ хвоста дня в карте решений упаковщика (plannedTailSetup). Записей ещё может не быть
    // (генерация создаёт их после упаковки), поэтому ключ — не id, а «станок + плановый старт»: ровно
    // то, что уйдёт в главное значение резки (planStartTs, сек) и потом вернётся в c.number.
    function tailSetupKey(slitterId, planStartTs) {
        return String(slitterId == null ? '' : slitterId) + '|' + Math.round(Number(planStartTs) || 0);
    }

    function setupTimingFields(reqs, u) {
        var fields = {};
        if (reqs.knifeReq) fields['t' + reqs.knifeReq] = String(u.knife);
        if (reqs.matReq) fields['t' + reqs.matReq] = String(u.material);
        if (reqs.cutTimeReq) fields['t' + reqs.cutTimeReq] = String(u.cutTime);   // #3700
        // #4529: «Длительность, минут» пишется ВМЕСТЕ с «Резкой и Лидером» — это одно и то же
        // число в двух видах (лидер = BETWEEN_CUTS × проходов). Порознь они расходятся: норма
        // намотки меняется (#4501 — узкие полосы), план пишет новую «Резку и Лидер», а старая
        // «Длительность» остаётся — и детектор, который считает «Резку и Лидер» ИЗ НЕЁ, вечно
        // просит пересчёт (issue #4529: «резка и лидер 20 → 14 мин» сразу после «Сгенерировать»).
        if (reqs.durationReq && u.duration != null) fields['t' + reqs.durationReq] = String(u.duration);
        return fields;
    }

    // #4156: «фактические переналадки» панели «Качество плана» = СУММЫ ХРАНИМЫХ активностей наладки
    // задания (колонки «Наладка ножей, мин» / «Сырье/намотка, мин», #3698) — ровно те, что
    // построил computeCutSetupUpdates (setupActivityColumns) и суммирует отчёт «Комбинации по всем
    // позициям». Панель раньше пересчитывала «факт» через planQuality по ВЕСАМ штрафов планировщика:
    // рост числа полос стоил KNIVES_INCREASE_COST_MN=50 вместо плоских 30 (#3600). Отсюда суммы наладки
    // не сходились с отчётом (при совпадении числа заданий). Читаем «факт» из того же источника, что и
    // отчёт → сходится по построению. Веса штрафов остаются объективу «Упорядочить»
    // (planChangeoverMin/planQuality), а не показу оператору.
    // #4296: первой резке ПУСТОГО станка теперь засчитывается заправка сырья (firstSetupParts даёт
    // KNIFE + MATERIAL_WINDING) — сырьё реально ставят на станок с нуля. Хранимая колонка «Сырье/намотка»
    // первой резки > 0 → панель показывает «смены сырья: N» и избыток ≥ 0 (совпадает с идеалом §13, где
    // эта наладка тоже учтена). Раньше firstSetupParts давал только ножи → «смены сырья: 0» и факт<идеал.
    //   fromK/toK — окно дней [С;По] (YYYYMMDD; null → без границы). Окно/предикат — как planQuality:
    //   window = [С;По] (панель), all = [С; конец всех задач] (тултип).
    // → { window, all, hasStored, emptyWindow, emptyAll }. hasStored=false (у базы нет колонок #3698 /
    //   все пусты) — панель НЕ молчит и НЕ подсовывает оценку planQuality под видом факта, а выводит
    //   ОШИБКУ (renderQueue: консоль + тост + красная плашка) — это ошибка конфигурации/данных, ТЗ §14/#4059.
    //   emptyWindow/emptyAll (#4188) — какие ИМЕННО задания пусты (id/день/станок/проходы), для трассы.

    // #4188: компактная строка перечня пустых заданий для трассы «где именно пусто».
    // list — storedSetupTotals().emptyWindow/emptyAll; элемент { id, dayKey, slitter, plannedRuns }.
    // Печатаем «id@день/ст.N/0прох» (0 проходов = setup-only хвост дробления), первые cap штук + «…ещё K».
    function formatEmptySetupIds(list, cap) {
        var lim = cap || 40;
        var arr = list || [];
        var head = arr.slice(0, lim).map(function(e) {
            return String(e.id) + '@' + (e.dayKey || '?') + (e.slitter ? ('/ст.' + e.slitter) : '')
                + (Number(e.plannedRuns) === 0 ? '/0прох' : '');
        }).join(', ');
        var rest = arr.length - lim;
        return head + (rest > 0 ? ', …ещё ' + rest : '');
    }

    AtexProductionPlanning.prototype.storedSetupTotals = function(fromK, toK) {
        var lo = fromK != null ? Number(fromK) : -Infinity;
        var hi = toK != null ? Number(toK) : Infinity;
        var hasStored = false;
        var rows = (this.cuts || []).map(function(c) {
            var kRaw = c && c.storedKnifeSetupMin, mRaw = c && c.storedMaterialWindingMin;
            var kHas = kRaw != null && String(kRaw).trim() !== '';
            var mHas = mRaw != null && String(mRaw).trim() !== '';
            if (kHas || mHas) hasStored = true;
            return {
                // #4188: id/станок/проходы — чтобы трасса могла назвать «ГДЕ ИМЕННО» пусто, а не просто «пусто».
                id: (c && c.id != null) ? String(c.id) : '',
                dayKey: planDateDayKey(c && c.planDate),
                slitter: (c && c.slitter && c.slitter.id != null) ? String(c.slitter.id) : '',
                plannedRuns: stripNum(c && c.plannedRuns),
                knife: stripNum(kRaw), material: stripNum(mRaw),
                // #4188: колонки наладки НЕ ЗАПИСАНЫ (обе пусты) — это НЕ то же, что хранимый «0»
                // (заполненный ноль = «наладки нет»). Пустое = «ещё не посчитано/не сохранено».
                empty: !kHas && !mHas
            };
        });
        function acc(inWin) {
            var kc = 0, km = 0, mc = 0, mm = 0, tc = 0;
            rows.forEach(function(e) {
                if (!inWin(e.dayKey)) return;
                tc++;
                if (e.knife > 0) { kc++; km += e.knife; }
                if (e.material > 0) { mc++; mm += e.material; }
            });
            return { knifeCount: kc, knifeMin: round3(km), materialCount: mc, materialMin: round3(mm),
                     changeoverCount: kc + mc, changeoverMin: round3(km + mm), taskCount: tc };
        }
        // #4188: перечень заданий с ПУСТЫМИ (незаписанными) колонками наладки — «где именно пусто».
        // Каждый — { id, dayKey, slitter, plannedRuns }, чтобы в трассе видеть станок/день/сегмент
        // (0 проходов = setup-only хвост дробления). Порядок = порядок this.cuts.
        function emptyList(inWin) {
            var out = [];
            rows.forEach(function(e) {
                if (inWin(e.dayKey) && e.empty) out.push({ id: e.id, dayKey: e.dayKey, slitter: e.slitter, plannedRuns: e.plannedRuns });
            });
            return out;
        }
        var winPred = function(dk) { return dk >= lo && dk <= hi; };
        var allPred = function(dk) { return dk >= lo; };
        return {
            window: acc(winPred),
            all: acc(allPred),
            hasStored: hasStored,
            emptyWindow: emptyList(winPred),   // #4188: пустые задания в окне [С;По]
            emptyAll: emptyList(allPred)       // #4188: пустые задания за весь горизонт
        };
    };

    // #3778: вычислить тайминг-поля резок В ПОРЯДКЕ ПЛАНА и вернуть { reqs, updates } —
    // updates только для резок, чьи хранимые значения ПУСТЫ или разошлись с расчётом (пустое
    // хранимое всегда «изменилось» → force-write, отсюда наполняются «пустые опять» поля).
    // onlyIds (массив id) ограничивает НАБОР ЗАПИСИ (снимок при «Зафиксировать»), но порядок и
    // переналадка считаются по ВСЕЙ очереди станка — иначе у не-первой резки терялся предшественник.
    // #4401: opts.dryRun — НЕ трогать c.stored* (только вернуть расхождения). Нужен детектору
    // «↻ Пересчитать наладку»: он бежит на каждой отрисовке очереди и не имеет права делать вид,
    // что тайминг уже записан, — иначе кнопка исчезала бы сама, ничего не сохранив.
    AtexProductionPlanning.prototype.computeCutSetupUpdates = function(onlyIds, opts) {
        var manualSetupCall = !!(opts && opts.manual);   // #4582: ручной пересчёт заморозку игнорирует
        var dryRun4401 = !!(opts && opts.dryRun);
        // #4499: КОЛОНКИ БЕРЁМ У УПАКОВЩИКА, если он их посчитал (`ops.*.planCols` → applySplitPlan).
        // Раньше эта функция считала переналадку ЗАНОВО, по своей развёртке очереди — и на разбитых
        // по дням заданиях и наладочных хвостах расходилась с раскладкой до +75 минут на день.
        // Бейдж дня и мерка потолка складываются ИЗ ЭТИХ КОЛОНОК, поэтому расхождение выглядело как
        // «502 мин при 460» на честно упакованном дне. Для заданий, которых план не касался
        // (карта пуста), считаем как раньше.
        var planColsBy = (opts && opts.planCols) || {};
        var meta = this.meta.cut;
        var reqs = { knifeReq: null, matReq: null, cutTimeReq: null, durationReq: null };
        if (!meta) return { reqs: reqs, updates: [] };
        reqs.knifeReq = reqIdByName(meta, CUT_REQ.knifeSetupMin);
        reqs.matReq = reqIdByName(meta, CUT_REQ.materialWindingMin);
        reqs.cutTimeReq = reqIdByName(meta, CUT_REQ.cutAndLeader);   // #3700: «Резка и Лидер»
        reqs.durationReq = reqIdByName(meta, CUT_REQ.duration);      // #4529: пишется вместе с «Резкой и Лидером»
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
        // #4529: НАМОТКА СЕГМЕНТА — ЖИВАЯ НОРМА, а не хранимая «Длительность, минут». «Резка и
        // Лидер» = намотка + BETWEEN_CUTS × проходов, и упаковщик считает её по норме из «Времени
        // операции» (plannedCutDurationMinutes → windPointsForCut). Хранимая «Длительность»
        // переписывается только при СМЕНЕ проходов, поэтому после правки нормы (#4501: полоса
        // ≤ 30 мм наматывается по своей серии) она описывает прежний мир: план пишет «Резку и
        // Лидер» 20, а детектор, считавший её ИЗ «Длительности», требовал 14 — вечная красная
        // «↻ Пересчитать наладку», которая, если её нажать, ломает раскладку дня (issue #4529).
        // Считаем ТЕМ ЖЕ выражением, что и писатель сегментов (splitSegTimingFields) и
        // предпросмотр (durationForSegment): норма и длина прогона — по ГОЛОВЕ цепочки, у
        // продолжения своих полос и своей длины нет.
        //   Нет норм намотки/длины прогона — молча обнулять задание нельзя: держим хранимое
        //   (общая конвенция «нет данных — нет обвинений»). → минуты намотки либо null.
        var cutsByIdSetup = {};
        (this.cuts || []).forEach(function(c) { if (c && c.id != null) cutsByIdSetup[String(c.id)] = c; });
        var opTimesSetup = this.opTimes, suppliesSetup = this.supplies, posLenSetup = this.positionLengthById;
        var hasWindNorms = !!(opTimesSetup && Object.keys(opTimesSetup).some(function(k) { return /^WIND_/.test(k); }));
        function windingMinFor(c, runs) {
            if (!(runs > 0)) return 0;                       // setup-only хвост (#4021) — намотки нет
            if (!hasWindNorms) return null;
            var fp = (c && c.firstPartId != null) ? String(c.firstPartId).trim() : '';
            var head = cutsByIdSetup[fp !== '' ? fp : String(c && c.id)] || c;
            var runLen = cutRunLength(head, suppliesSetup, posLenSetup);
            if (!(runLen > 0)) return null;
            return Math.ceil(plannedCutDurationMinutes(runLen, runs, opTimesSetup, head));   // #4501: норма по самой узкой полосе
        }
        // #3876: тот же источник заправки, что и план (splitMachineQueue): станок в отпуске на
        // день базы → заправка обнулена → первая резка после отпуска считает полную настройку.
        var planBaseMidnightMs = planBaseMidnightFrom(this.filter && this.filter.date, controllerNowMs(this));
        var prevBySlitter = this.planningPrevSetupBySlitter(planBaseMidnightMs);
        var self = this;
        var plannedTail = this.plannedTailSetup || {};   // #4144: решение упаковщика по хвостам последнего плана
        // #4026/#4030/#4111: setup-only хвост дня (#3635 п.5, 0 проходов) — это НАЛАДКА следующей резки,
        // начатая в конце дня N; сама резка (проходы) идёт с дня N+1 (продолжение). Наладка = ножи +
        // смена сырья. В дне N оставляем ТОЛЬКО то, что влезает до потолка нахлёста НАСТРОЙКИ
        // (cutEndMin + MAX_OVERWORK_TUNE) — ровно как это уже планирует splitMachineQueue
        // (splitTailSetupAtCeiling зеркалит minOverlapTailSetupMinutes + гейт availFor 'tune'). Остаток
        // наладки уносим на ПРОДОЛЖЕНИЕ (день N+1, где резка), чтобы бейдж/окно дня N не вылезали за
        // нахлёст. Прежний #4042 при полном дне N+1 ОСТАВЛЯЛ ножи в дне N — но это ломало потолок дня N
        // (issue #4111: хвост 45 мин до 16:46 при потолке 16:20). Приоритет — потолок текущего дня N;
        // переполнение дня N+1 (там реально идёт резка-продолжение) отражаем честно, а не прячем в день N.
        // Нет окна (cutEndMin не число) → держим наладку в дне N как есть (прежнее поведение).
        var win4111 = (typeof self.workingWindow === 'function') ? (self.workingWindow() || {}) : {};
        var cutEndMin4111 = Number(win4111.cutEndMin);
        var overTuneMin4111 = Number(win4111.maxOverworkTuneMin) || 0;
        // #4314: заправка, которой станок ВХОДИТ в окно, описывает день последнего задания раньше «С»
        // (prevSetupBeforeWindow, #4312) — от него правило сброса отсчитывает отпуск для первого задания
        // очереди. Нет таких заданий → заправки нет, отсчёт от дня базы.
        var carryDayBySlitter = prevSetupBeforeWindow(this.cuts || [], planBaseMidnightMs);
        var updates = [];
        groupBySlitter(this.cuts || []).forEach(function(group) {
            var sid = group.slitter && group.slitter.id != null ? String(group.slitter.id) : '';
            var arr = group.cuts;   // уже упорядочены как очередь станка (день → planStart → ножи, #3923)
            var carrySetup = prevBySlitter[sid];
            // #4314: обнуление #3876 (станок в длинном отпуске на день базы — заправки нет) описывает
            // станок НА ДЕНЬ «С». Если первое задание очереди — из ПРОШЛОГО дня, то есть ДО отпуска,
            // состояние «С» ему не предшественник: полную настройку оно получать не должно (её ставит
            // resetIds первому заданию ПОСЛЕ отпуска).
            // #4371: предшественника у него нет вовсе — карта заправок описывает вход в ОКНО, а не в
            // прошлое. Снимаем carrySetup → setupActivityColumns посчитает ему firstCutSetup (одни ножи).
            var firstDayOff = arr.length ? dayOffsetFromBase(arr[0].planDate, planBaseMidnightMs) : null;
            if (firstDayOff != null && firstDayOff < 0) carrySetup = null;
            var carryPrevCut = (carrySetup && arr.length) ? carryOverPrevCut(carrySetup, arr[0]) : null;
            // #4314: за ДЛИННЫМ отпуском станка (> DOWNTIME_KEEP_SETUP_MAX_DAYS) ножи снимают, а сырьё
            // убирают — первое задание ПОСЛЕ него считает настройку С НУЛЯ, а не переналадку от резки
            // ДО отпуска. Тот же расчёт делает упаковщик (splitMachineQueue, longVacationRanges), иначе
            // окно плана и хранимые колонки разошлись бы на эту настройку (#4300/#4312).
            var resetIds = setupResetCutIds(arr,
                longVacationDayRanges((self.downtimesBySlitter || {})[sid], planBaseMidnightMs),
                planBaseMidnightMs,
                (carryDayBySlitter[sid] || {}).dayOffset);
            var cols = setupActivityColumns(arr, times, carryPrevCut, resetIds);
            // #4026: корень цепочки разбиения — «ID первой части» (firstPartId), иначе сам id.
            // Нормализуем ТАК ЖЕ, как группировка цепочек #3892 (String(...).trim()) — иначе пробел/
            // формат из rowValue расходится: голова (fp==id) и продолжение сравнивались бы неравными.
            function chainRoot4026(x) {
                var fp = (x && x.firstPartId != null) ? String(x.firstPartId).trim() : '';
                return fp !== '' ? fp : String(x && x.id != null ? x.id : '').trim();
            }
            // #4030/#4111: наладку setup-only хвоста дня (0 проходов) делим по потолку нахлёста настройки.
            // В дне N остаётся splitTailSetupAtCeiling(...) (то же, что кладёт splitMachineQueue); остаток
            // (ножи и/или смена сырья) уносим на ПРОДОЛЖЕНИЕ — ближайшую последующую резку ТОЙ ЖЕ цепочки
            // (chainRoot по firstPartId) с нулевой переналадкой входа (иначе у неё СВОЯ наладка → двойной
            // счёт). Продолжение бывает НЕ соседним в очереди (между ним и хвостом встают чужие резки,
            // issue #4111) — поэтому сканируем вперёд по chainRoot, а не только arr[i+1].
            var deferKnifeToCont = {};      // id продолжения → перенесённые ножи его хвостов
            var deferMaterialToCont = {};   // id продолжения → перенесённая смена сырья его хвостов
            var tailKeep = {};              // id хвоста → { knife, material } что ОСТАЁТСЯ в дне N
            // #4433: дробление хвоста считаем по ВСЕЙ очереди станка, onlySet здесь не применяем.
            // onlyIds ограничивает НАБОР ЗАПИСИ (см. док функции), а дробление — это расчёт: хвост
            // дня N и его продолжение из дня N+1 делят одну наладку. Отсекать по снимку нельзя ни с
            // одной стороны: хвост вне снимка обязан отдать продолжению остаток (иначе у продолжения
            // «пропадают» вынесенные минуты), а хвост внутри снимка обязан видеть продолжение вне
            // снимка (иначе решает, что уносить некуда, и держит ПОЛНУЮ наладку в дне N).
            arr.forEach(function(c, i) {
                if (stripNum(c.plannedRuns) !== 0) return;            // хвост = 0 проходов (setup-only, #3635 п.5)
                var cc = cols[String(c.id)] || {};
                var fullK = Math.round(cc.knifeMin || 0), fullM = Math.round(cc.materialWindingMin || 0);
                if (fullK + fullM <= 0) return;                       // нет наладки — делить нечего
                // #4144: сколько наладки остаётся в дне N, решил УПАКОВЩИК — он один видит ДРОБНОЕ окно.
                // Хранимый planStart прошёл снап к целым минутам (#4061, накопленный ceil) и лежит ПОЗЖЕ
                // упаковочного, поэтому пересчёт по нему room занижает: на плане из #4144 хвост 16:04
                // (room 6, влезала смена намотки 15) превращался в 16:07 (room 3) → в дне N НИЧЕГО,
                // задание нулевой длительности, а 15 мин всплывали на продолжении и наезжали на соседа.
                //   • есть решение упаковщика (plannedTailSetup, ключ «станок + плановый старт») — берём его;
                //   • плана под рукой нет («Зафиксировать» по хранимым данным), но колонки уже записаны —
                //     держим записанное: последний план и есть источник правды, выдумывать не из чего;
                //   • ни того, ни другого — фолбэк на пересчёт по потолку (splitTailSetupAtCeiling).
                // planBaseMidnightMs — полночь дня 0 (мс), c.number — сек.
                var minsFromBase = (Number(c.number) * 1000 - planBaseMidnightMs) / 60000;
                var tailStartMin = isFinite(minsFromBase) ? (((minsFromBase % 1440) + 1440) % 1440) : NaN;
                var storedK = Math.round(stripNum(c.storedKnifeSetupMin)), storedM = Math.round(stripNum(c.storedMaterialWindingMin));
                var planned = plannedTail[tailSetupKey(sid, stripNum(c.number))];
                var keep, keepSrc;
                if (planned && (planned.knife + planned.material) > 0) {
                    keep = { keepKnife: planned.knife, keepMaterial: planned.material }; keepSrc = 'упаковщик';
                } else if (!planned && (storedK + storedM) > 0) {
                    keep = { keepKnife: storedK, keepMaterial: storedM }; keepSrc = 'хранимое';
                } else {
                    keep = splitTailSetupAtCeiling(tailStartMin, fullK, fullM, cutEndMin4111, overTuneMin4111); keepSrc = 'потолок';
                }
                // Оставить в дне N больше, чем есть в наладке, нельзя (конфигурация могла смениться).
                keep = { keepKnife: Math.min(keep.keepKnife, fullK), keepMaterial: Math.min(keep.keepMaterial, fullM) };
                tailKeep[String(c.id)] = { knife: keep.keepKnife, material: keep.keepMaterial };
                var defK = fullK - keep.keepKnife, defM = fullM - keep.keepMaterial;
                if (defK <= 0 && defM <= 0) return;                   // всё влезло в день N — переносить нечего
                // Продолжение = последующая резка ТОЙ ЖЕ цепочки (chainRoot по firstPartId; голова хвоста
                // и продолжение делят корень = id головы). Продолжение бывает НЕ соседним в очереди —
                // сканируем вперёд по chainRoot (issue #4111), а не только arr[i+1]. Добираем к нему остаток
                // ТОЛЬКО если у него переналадка входа = 0 (иначе у него СВОЯ наладка от нового сырья →
                // двойной счёт). Нет цепочки (firstPartId пуст) → фолбэк #4030: ближайшая резка той же
                // конфигурации (переналадка входа = 0).
                var root = chainRoot4026(c), target = null, sameCfgFallback = null, chainFound = false;
                for (var j = i + 1; j < arr.length; j++) {
                    var d = arr[j];
                    var dc = cols[String(d.id)] || {};
                    var dZero = Math.round(dc.knifeMin || 0) === 0 && Math.round(dc.materialWindingMin || 0) === 0;
                    if (chainRoot4026(d) === root && String(d.id) !== String(c.id)) {
                        chainFound = true;                             // продолжение цепочки нашли — только сюда (или никуда)
                        if (dZero) target = String(d.id);
                        break;
                    }
                    if (sameCfgFallback == null && dZero) sameCfgFallback = String(d.id);   // фолбэк: ближайшая та же конфигурация
                }
                if (target == null && !chainFound) target = sameCfgFallback;   // цепочки нет → фолбэк на ближайшую same-config
                if (target) {
                    if (defK > 0) deferKnifeToCont[target] = (deferKnifeToCont[target] || 0) + defK;
                    if (defM > 0) deferMaterialToCont[target] = (deferMaterialToCont[target] || 0) + defM;
                } else {
                    // Продолжения нет (или у него своя наладка) → остаток унести некуда: вся наладка
                    // остаётся на хвосте дня N. Нахлёст здесь неизбежен, но настройку терять нельзя.
                    tailKeep[String(c.id)] = { knife: fullK, material: fullM };
                }
                if (ppTraceOn()) ppTrace('#4111 хвост ' + c.id + ' старт=' + Math.round(tailStartMin) +
                    ' наладка[нож/сыр]=' + fullK + '/' + fullM + ' → в дне N ' + keep.keepKnife + '/' + keep.keepMaterial +
                    ' (' + keepSrc + '), на продолжение ' + (target || '∅') + ' ' + defK + '/' + defM);
            });
            arr.forEach(function(c, i) {
                var inScope = !(onlySet && !onlySet[String(c.id)]);   // снимок — только выбранные резки
                var want = cols[String(c.id)] || { knifeMin: 0, materialWindingMin: 0 };
                // #3715: пишем ЦЕЛЫЕ минуты (Math.round). Дробные значения (#3708) перестали
                // записываться — поля не приняли нецелое, _m_set падал и обрывал запись всех трёх
                // колонок («Наладка ножей»/«Сырье/намотка»/«Резка и Лидер») для всей очереди.
                // Налезание баров (#3708) убирает обрезка по старту следующего задания в Ганте
                // (cut-gantt.js), а не дробная длительность.
                // #4026/#4030/#4111: продолжение добирает наладку, отложенную его setup-only хвостом.
                // В дне N у хвоста остаётся только влезающее до потолка нахлёста (tailKeep, #4111), а
                // остаток (ножи/смена сырья) добирает продолжение (день N+1, где резка) — иначе окно/бейдж
                // дня N вылезают за нахлёст (issue #4111: 447+45=492, хвост до 16:46 при потолке 16:20).
                var tk = tailKeep[String(c.id)];
                var wantK = tk ? tk.knife : Math.round(want.knifeMin);
                var wantM = tk ? tk.material : Math.round(want.materialWindingMin);
                wantK += (deferKnifeToCont[String(c.id)] || 0);       // продолжение добирает ножи своих хвостов
                wantM += (deferMaterialToCont[String(c.id)] || 0);    // продолжение добирает смену сырья своих хвостов
                var runsC = stripNum(c.plannedRuns);
                if (!inScope) return;
                // #4436: задание стои́т в ЗАМОРОЖЕННОМ дне — его хранимый тайминг НЕ ПЕРЕПИСЫВАЕМ.
                // «Заморозка» значит «ПЛАНИРОВАНИЕ этот день не трогает»: расчёт по очереди станка идёт
                // сквозь такое задание (соседям нужен предшественник), но в набор ЗАПИСИ оно не входит.
                // #4582: у РУЧНОГО вызова (кнопка «↻ Пересчитать наладку») этого ограничения нет —
                // иначе оператор не может починить даже явно кривой замороженный день.
                if (!manualSetupCall && typeof self.dayIsFrozen === 'function' && self.dayIsFrozen(c.planDate)) return;
                // #3700: «Резка и Лидер» = «Длительность, минут» + лидер (BETWEEN_CUTS × число резок
                // цуга, cutLeaderRuns). Зависит только от самой резки.
                // #4021: setup-only сегмент (0 проходов — «только настройка станка», хвост дня #3635 п.5)
                // намотки не несёт, поэтому и лидера у него нет. cutLeaderRuns() возвращает 1 при 0
                // проходов (фолбэк для реальной резки с несохранённым «Кол-во план»), из-за чего «Резка
                // и Лидер» = 0 + BETWEEN_CUTS(2) = 2 — бейдж дня с одной наладкой показывал 47 вместо 45
                // (45 наладки + фантомный лидер). Лидер считаем ТОЛЬКО при реальных проходах.
                var leaderRuns = runsC > 0 ? cutLeaderRuns(c) : 0;
                // #4529: намотка — по ЖИВОЙ норме (windingMinFor), как у упаковщика; норм/длины
                // прогона нет — держим хранимую «Длительность».
                var liveW = windingMinFor(c, runsC);
                var wantWKnown = liveW != null;
                var wantW = wantWKnown ? liveW : Math.round(stripNum(c.duration));
                var wantT = Math.round(wantW + betweenCuts * leaderRuns);
                // #4499: у этого сегмента есть числа УПАКОВЩИКА — они и есть правда. Сумма трёх
                // колонок тогда в точности равна занятости сегмента, а значит бейдж дня равен тому,
                // что напаковано, и потолок меряется по одной арифметике, а не по двум.
                var planCols = planColsBy[String(c.id)];
                if (planCols) {
                    wantK = Math.round(Number(planCols.knife) || 0);
                    wantM = Math.round(Number(planCols.material) || 0);
                    wantT = Math.round(Number(planCols.cutTime) || 0);
                    // #4529: «Длительность» — та же величина без лидера, иначе пара колонок разъедется.
                    wantW = Math.max(0, wantT - Math.round(betweenCuts * leaderRuns));
                    wantWKnown = true;   // числа упаковщика знают намотку сегмента точно
                }
                // Колонку учитываем в diff только если она есть в метаданных (иначе её не пишем
                // и не считаем «изменившейся» — иначе были бы лишние записи на каждом сохранении).
                // Пустое хранимое (cur пуст) → всегда «изменилось» → force-write (#3778).
                function changed(req, cur, val) {
                    return req && (!(cur != null && cur !== '') || Math.round(stripNum(cur)) !== val);
                }
                // #4529: «Длительность, минут» — часть той же записи. Расхождение по ней ОДНО
                // «Резка и Лидер» не всегда показывает (лидер целочислен, а норма могла измениться
                // ровно на лидер), поэтому спрашиваем и её; пустую не выдумываем (durationReq нет
                // в метаданных или живой нормы нет → wantW равен хранимому и diff пуст).
                var durChanged = wantWKnown && changed(reqs.durationReq, c.duration, wantW);
                if (changed(reqs.knifeReq, c.storedKnifeSetupMin, wantK)
                    || changed(reqs.matReq, c.storedMaterialWindingMin, wantM)
                    || changed(reqs.cutTimeReq, c.storedCutAndLeaderMin, wantT)
                    || durChanged) {
                    updates.push({ cutId: c.id, knife: wantK, material: wantM, cutTime: wantT,
                        duration: (reqs.durationReq && wantWKnown) ? wantW : null,
                        wasKnife: c.storedKnifeSetupMin, wasMaterial: c.storedMaterialWindingMin,
                        wasCutTime: c.storedCutAndLeaderMin, wasDuration: c.duration });
                    if (dryRun4401) return;                       // #4401: детектор — состояние не меняем
                    c.storedKnifeSetupMin = String(wantK);        // локально — чтобы не переписывать дважды
                    c.storedMaterialWindingMin = String(wantM);
                    c.storedCutAndLeaderMin = String(wantT);
                    if (reqs.durationReq && wantWKnown) c.duration = String(wantW);
                }
            });
        });
        return { reqs: reqs, updates: updates };
    };

    // #4477 (ТЗ §15): ЕДИНЫЙ ШЛЮЗ ЗАПИСИ «ВРЕМЕНИ СТАРТА». Через него идут ВСЕ пути, которые
    // двигают задания по времени: ручной перенос 🗓 (moveCutToDay), ↑↓ (moveCutInDay),
    // перетаскивание (reorderCutInDay), «↻ Пересчитать наладку» (recalcSetupTiming), сведение
    // стартов после записи плана (reconcilePlanStarts), «Урегулировать отклонения»
    // (settleDeviations). Шлюз держит ДВА правила разом, поэтому их нельзя забыть в очередном
    // обработчике (issue #4477 — правило нарушали ровно те пути, которые писали сами):
    //   • НЕ ИЗМЕНИЛОСЬ — НЕ СОХРАНЯЕМ: команду даём только заданию, у которого хранимый старт
    //     отличается от нового (changedStartWrites; хранимое берём из this.cuts, если вызывающий
    //     не передал wasTs). Ноль изменений — ноль запросов, промис резолвится нулём;
    //   • ПАРАЛЛЕЛЬНО, до MAX_PARALLEL_WRITES потоков: задания независимы (каждое — свой
    //     _m_save/<cutId>), порядок записи в базе неважен (#4000), как сохранение/удаление/
    //     разбиение/тайминг (#3998/#4005/#4014/#4023).
    // Первая колонка (плановое время старта, DATETIME) пишется ТОЛЬКО через _m_save с
    // t{tableId} — _m_set её не задаёт (GUIDE issue #775).
    //   items — [{ cutId, ts, wasTs? }]; opts.onWrite(done, total) — прогресс по факту записи.
    // → Promise<число записанных заданий>. Ошибка реджектит промис ПЕРВОЙ ошибкой — вызывающий
    // сообщает о ней сам (у каждого пути своя формулировка).
    //
    // Шлюз — функция МОДУЛЯ (метод прототипа ниже лишь её зовёт): пути записи обращаются к нему
    // напрямую (postCutStarts(self, …)), поэтому его нельзя «не унаследовать» и обойти.
    function postCutStarts(self, items, opts) {
        var o = opts || {};
        if (!(items && items.length)) return Promise.resolve(0);   // писать нечего — и метаданные ни при чём
        var meta = self.meta || {};
        var mainKey = (meta.cut && meta.cut.id != null) ? 't' + meta.cut.id : null;
        if (!mainKey) {
            if (typeof self.notify === 'function') self.notify('Не найден реквизит даты резки', 'error');
            return Promise.reject(new Error('#4477: нет главного реквизита таблицы «' + TABLE.cut + '» — некуда писать время старта'));
        }
        var storedById = {};
        (self.cuts || []).forEach(function(c) { if (c && c.id != null) storedById[String(c.id)] = c; });
        var writes = changedStartWrites(items, storedById);
        // Прогресс считаем по ТОМУ, ЧТО ПИШЕМ: полоса, размеченная на весь набор, застревала бы
        // на «1 из 7», когда шесть заданий отсеяны как неизменившиеся.
        if (typeof o.onPlan === 'function') o.onPlan(writes.length);
        if (!writes.length) return Promise.resolve(0);
        var done = 0;
        return runWithConcurrency(writes.map(function(w) {
            return function() {
                var fields = {}; fields[mainKey] = String(w.ts);
                return self.post('_m_save/' + encodeURIComponent(w.cutId) + '?JSON', fields).then(function(r) {
                    done += 1;   // счётчик безопасен: JS однопоточен
                    if (typeof o.onWrite === 'function') o.onWrite(done, writes.length);
                    return r;
                });
            };
        }), MAX_PARALLEL_WRITES).then(function() { return writes.length; });
    }

    // Тот же шлюз как метод — для вызова извне (и из тестов): вся логика в postCutStarts.
    AtexProductionPlanning.prototype.saveCutStarts = function(items, opts) {
        return postCutStarts(this, items, opts);
    };

    // #4401: onlyIds — писать тайминг ТОЛЬКО этим заданиям (кнопка «↻ Пересчитать наладку»
    // ограничивает набор своим станком и видимыми днями). null — как раньше, вся очередь.
    // #4499: planCols — колонки, посчитанные УПАКОВЩИКОМ (cutId → {knife, material, cutTime}).
    // Их даёт applySplitPlan из `ops`; для остальных заданий колонки считаются как раньше.
    AtexProductionPlanning.prototype.persistCutSetupColumns = function(onlyIds, planCols, opts) {
        var self = this;
        // #4588: у РУЧНОГО действия колонки наладки пишутся и в замороженном дне — иначе созданная
        // им запись остаётся с ПУСТЫМИ «Наладка ножей»/«Сырьё-намотка», а детектор вечно показывает
        // «— → 0 мин» и кнопку «↻ Пересчитать наладку», которая ничего не меняет (боевое #4588).
        var res = this.computeCutSetupUpdates(onlyIds || null,
            { planCols: planCols || null, manual: !!(opts && opts.manual) });
        var reqs = res.reqs, updates = res.updates;
        if (!updates.length) return Promise.resolve();
        // «Время старта» (planStart) на пути ПЛАНИРОВАНИЯ пишет splitMachineQueue/applySplitPlan —
        // он один решает день и нахлёст настройки (#3805, #3635 п.5). Здесь — только тайминг
        // (Наладка ножей / Сырьё-намотка / Резка и Лидер), planStart не трогаем. Пересборку стартов
        // ВНУТРИ дня по этим колонкам делает recalcSetupTiming (#4408) отдельным шагом.
        // #4023: разные резки независимы (каждая — свой _m_set/<cutId>?JSON), а порядок в базе
        // неважен (#4000). Раньше это был последовательный chain.then — «последний набор запросов»
        // после «Создать»/«Упорядочить» шёл лесенкой в 1 поток (окно висело на 100%). Гоняем пулом
        // до MAX_PARALLEL_SETUP потоков, как сохранение/удаление/разбиение (#3998/#4005/#4014).
        var MAX_PARALLEL_SETUP = MAX_PARALLEL_WRITES;   // #4477: предел один на весь модуль
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
    AtexProductionPlanning.prototype.moveCutInDay = function(sameDayCuts, index, dir, alreadyStitched) {
        var self = this;
        this._ppOp = 'moveCutInDay';   // #4177/#4480
        var arr = sameDayCuts || [];
        var target = index + dir;
        if (index < 0 || index >= arr.length || target < 0 || target >= arr.length) return Promise.resolve(false);
        var a = arr[index], b = arr[target];
        if (!a || !b) return Promise.resolve(false);
        // #4488: перестановка — тоже перемещение: если задание разорвано по дням, между его частями
        // встанет сосед. Сшиваем ДО обмена и повторяем действие уже по свежей очереди дня (ТЗ §15).
        if (!alreadyStitched) {
            var stitchIds = [a, b].filter(function(c) { return splitChainPartsOf(self.cuts || [], c.id).length > 1; })
                .map(function(c) { return String(c.id); });
            if (stitchIds.length) {
                return stitchIds.reduce(function(chain, id) {
                    return chain.then(function() { return self.mergeSplitChain(id); });
                }, Promise.resolve()).then(function() {
                    var fresh = dayQueueOf(self.cuts || [], a);
                    var i = fresh.map(function(c) { return String(c.id); }).indexOf(String(a.id));
                    if (i < 0) { self.render(); return false; }
                    return self.moveCutInDay(fresh, i, dir, true);
                });
            }
        }
        // #4392: порядок в очереди (↑↓) МЕНЯЕМ и для зафиксированных заданий — фиксация держит ДЕНЬ,
        // а не позицию внутри дня. Перестановка = обмен planStart в пределах ТОГО ЖЕ дня (ниже),
        // день сохраняется, замок не нарушается. Прежний запрет (#3508 п.3) снят.
        // #4381: начатое задание неприкосновенно — и само не переставляется, и через него не
        // перепрыгнуть (обмен planStart сдвинул бы начатое). Кнопки ↑↓ у начатого убраны, но
        // сосед мог бы утащить его свопом — закрываем и этот путь.
        if (cutIsStarted(a) || cutIsStarted(b)) { self.notify('Начатое задание нельзя переставить', 'info'); return Promise.resolve(false); }
        var mainKey = (this.meta.cut && this.meta.cut.id != null) ? 't' + this.meta.cut.id : null;
        if (!mainKey) { self.notify('Не найден реквизит даты резки', 'error'); return Promise.resolve(false); }
        var tsA = Number(a.planDate), tsB = Number(b.planDate);
        if (!isFinite(tsA) || tsA <= 0 || !isFinite(tsB) || tsB <= 0 || tsA === tsB) {
            self.notify('Не удаётся переставить: у соседних заданий одно время старта — нажмите «Упорядочить»', 'info');
            return Promise.resolve(false);
        }
        this.setBusy(true);
        // #4477: обмен — две независимые записи, пишем пулом через шлюз (было — одна за другой).
        return postCutStarts(self, [{ cutId: a.id, ts: tsB, wasTs: tsA }, { cutId: b.id, ts: tsA, wasTs: tsB }])
            .then(function() { return self.reload(); })
            .then(function() {
                self.setBusy(false);
                // #4434 п.3: ↑/↓ — обмен местами двух соседних заданий (обмен planStart выше). Наладка
                // соседей после этого неактуальна, и раньше это чинила крупная красная кнопка
                // «↻ Пересчитать наладку» (#4189/#4401 — пересчёт по кнопке). Кнопка после РУЧНОГО
                // перемещения убрана: пересчитываем СРАЗУ и сами (тайминг + время старта встык внутри
                // дня, порядок и дни не трогаем). Кнопка остаётся для расхождений, возникших не сейчас
                // (напр. правка данных задания) — её показывает тот же детектор по факту расхождения.
                var moveSid = (a.slitter && a.slitter.id != null) ? String(a.slitter.id) : '';
                self.render();   // обмен planStart виден сразу, дальше — авто-пересчёт
                // typeof-гард — как у slotPlacementOn: в юнит-тестах метод зовут на стаб-self без прототипа.
                if (typeof self.recalcSetupTiming !== 'function') return true;
                return self.recalcSetupTiming(moveSid, { auto: true }).then(function() { return true; });
            })
            .catch(function(err) {
                self.setBusy(false);
                // Частичный обмен (первый _m_save прошёл, второй нет) → перечитываем состояние.
                self.reload().then(function() { self.render(); }).catch(function() {});
                self.notify('Ошибка перестановки: ' + (err && err.message || err), 'error');
                return false;
            });
    };

    // #4424: ОБЪЕДИНЕНИЕ заданий одного заказа и одной конфигурации В ОДНО — «по первому по порядку».
    // Оператор видит «3 задания одного заказа» там, где работа одна: у каждого своя наладка, они не
    // сливаются и разъезжаются по дням. Голова — ПЕРВОЕ ПО ПОРЯДКУ (минимальная «Дата план»,
    // mergeableOrderGroups); остальные записи в неё вливаются и удаляются.
    // Данные не теряем — это главное:
    //   • «Партия ГП» поглощаемого задания той же ШИРИНЫ вливается в партию головы: «Обеспечения»
    //     переходят на партию головы (реквизит «Партия ГП»), рулоны/план суммируются, «ID заказа»
    //     объединяется; сама партия-донор удаляется;
    //   • #4483: если ПОЗИЦИЮ донорского обеспечения голова уже обеспечивает из той же партии,
    //     перевешивать нельзя — вышла бы ВТОРАЯ связь задания с одним и тем же заказом (боевая ateh,
    //     заказ 4443: 400 м/120 рул + 200 м/60 рул на позиции 646600, панель «Связанные позиции (2)»).
    //     Метраж и рулоны складываются в головное «Обеспечение», донорское удаляется: у пары
    //     (позиция × «Партия ГП») ровно одна запись;
    //   • партия ширины, которой у головы нет, ПЕРЕЕЗЖАЕТ под голову целиком (`_m_move&up=`);
    //   • «Кол-во план» партий головы пересчитывается: полос × новые проходы;
    //   • голова получает сумму проходов и пересчитанные «Длительность, минут» / «Тайминг».
    // Не объединяем: начатые (#4381), задания замороженных дней (#4326), завершённые, складские
    // (без заказа) и уже единую цепочку дробления (общий «ID первой части»).
    // → Promise<число слитых записей>; 0 — сливать нечего (идемпотентно).
    // #4488: opts.groups — ГОТОВЫЕ группы слияния вместо `mergeableOrderGroups` (так сюда приходит
    // сшивание цепочки дробления, `mergeSplitChain`): та же машинерия — партии, обеспечения,
    // сумма проходов, удаление доноров, — но состав группы решает вызывающий.
    // opts.headFields — дополнительные поля в `_m_set` головы (маркер цепочки, замок).
    // opts.label(n) — своя фраза оператору вместо «Объединено заданий одного заказа».
    AtexProductionPlanning.prototype.mergeSameOrderTasks = function(opts) {
        var self = this;
        var forcedGroups = opts && opts.groups;
        this._ppOp = forcedGroups ? 'mergeSplitChain' : 'mergeSameOrderTasks';   // #4177: контекст трассы записей
        var cutMeta = this.meta.cut, fbMeta = this.meta.finishedBatch, supMeta = this.meta.supply;
        if (!cutMeta || !fbMeta || !supMeta) return Promise.resolve(0);
        // Кого объединять нельзя (см. выше).
        var skipIds = {};
        var baseMs4424 = planBaseMidnightFrom(this.filter && this.filter.date, controllerNowMs(this));
        (this.cuts || []).forEach(function(c) {
            if (!c) return;
            if (cutIsStarted(c)) { skipIds[String(c.id)] = 1; return; }                       // #4381
            if (planTsSeconds(c.endDate) != null) { skipIds[String(c.id)] = 1; return; }      // завершённое
            if (typeof self.dayIsFrozen === 'function' && self.dayIsFrozen(c.planDate)) { skipIds[String(c.id)] = 1; return; }   // #4326
            // Прошлые дни (раньше «С») не переписываем — их раскладку планировщик тоже не трогает (#4294).
            var off = dayOffsetFromBase(c.planDate, baseMs4424);
            if (off != null && off < 0) skipIds[String(c.id)] = 1;
        });
        var groups = forcedGroups || mergeableOrderGroups(this.cuts || [], { skipIds: skipIds });
        if (!groups.length) return Promise.resolve(0);
        var cutById = {};
        (this.cuts || []).forEach(function(c) { if (c && c.id != null) cutById[String(c.id)] = c; });
        var supByCut = {};
        (this.supplies || []).forEach(function(s) {
            if (s && s.cutId != null) (supByCut[String(s.cutId)] = supByCut[String(s.cutId)] || []).push(s);
        });
        var runsReqId = reqIdByAnyName(cutMeta, CUT_PLANNED_RUNS_NAMES);
        var durReqId = reqIdByName(cutMeta, CUT_REQ.duration);
        var timingReqId = reqIdByName(cutMeta, CUT_REQ.timing);
        var fbWidthIdx = columnIndex(fbMeta, FINISHED_BATCH_REQ.width);
        var fbStripsIdx = columnIndex(fbMeta, FINISHED_BATCH_REQ.strips);
        var fbRollsIdx = columnIndex(fbMeta, FINISHED_BATCH_REQ.rolls);
        var fbPlannedIdx = columnIndex(fbMeta, FINISHED_BATCH_REQ.planned);
        var fbOrderIdx = columnIndex(fbMeta, FINISHED_BATCH_REQ.orderId);
        var fbRollsReq = reqIdByName(fbMeta, FINISHED_BATCH_REQ.rolls);
        var fbPlannedReq = reqIdByName(fbMeta, FINISHED_BATCH_REQ.planned);
        var fbOrderReq = reqIdByName(fbMeta, FINISHED_BATCH_REQ.orderId);
        var supBatchReq = reqIdByName(supMeta, SUPPLY_REQ.finishedBatch);
        // #4483: чем СКЛАДЫВАТЬ обеспечения, которые сходятся на одной позиции.
        var supFootageReq = reqIdByName(supMeta, SUPPLY_REQ.footage);
        var supRollsReq = reqIdByName(supMeta, SUPPLY_REQ.rolls);
        var supFootageIdx = columnIndex(supMeta, SUPPLY_REQ.footage);
        var supRollsIdx = columnIndex(supMeta, SUPPLY_REQ.rolls);
        if (!runsReqId || !supBatchReq) {
            console.error('[pp] ❌ #4424: объединение заданий невозможно — нет реквизита «' +
                (!runsReqId ? CUT_PLANNED_RUNS_NAMES[0] : SUPPLY_REQ.finishedBatch) + '» в метаданных');
            return Promise.resolve(0);
        }
        function batchesOf(cutId) {
            return self.getJson('object/' + fbMeta.id + '/?JSON_OBJ&F_U=' + encodeURIComponent(cutId) + '&LIMIT=0,500')
                .then(function(rows) {
                    return (rows || []).map(function(rec) {
                        var r = rec.r || [];
                        return { id: String(rec.i),
                            width: fbWidthIdx >= 0 ? stripNum(r[fbWidthIdx]) : 0,
                            strips: fbStripsIdx >= 0 ? stripNum(r[fbStripsIdx]) : 0,
                            rolls: fbRollsIdx >= 0 ? stripNum(r[fbRollsIdx]) : 0,
                            planned: fbPlannedIdx >= 0 ? stripNum(r[fbPlannedIdx]) : 0,
                            orderId: (fbOrderIdx >= 0 && r[fbOrderIdx] != null) ? String(r[fbOrderIdx]).trim() : '' };
                    });
                });
        }
        // #4483: значения «Обеспечений» ОДНОЙ ПОЗИЦИИ из БД (отчёт cut_planning «Кол-во рулонов» не
        // отдаёт) → { supplyId: { footage, rolls } }. Кэш на позицию: доноров у неё бывает несколько,
        // и каждый следующий складывается с УЖЕ увеличенным головным.
        var supplyValuesByPosition = {};
        function supplyValuesOfPosition(positionId) {
            var key = String(positionId == null ? '' : positionId);
            if (key === '') return Promise.resolve({});
            if (supplyValuesByPosition[key]) return Promise.resolve(supplyValuesByPosition[key]);
            return self.getJson('object/' + supMeta.id + '/?JSON_OBJ&F_U=' + encodeURIComponent(key) + '&LIMIT=0,500')
                .then(function(rows) {
                    var out = {};
                    (rows || []).forEach(function(rec) {
                        var r = rec.r || [];
                        out[String(rec.i)] = {
                            footage: supFootageIdx >= 0 ? stripNum(r[supFootageIdx]) : 0,
                            rolls: supRollsIdx >= 0 ? stripNum(r[supRollsIdx]) : 0
                        };
                    });
                    supplyValuesByPosition[key] = out;
                    return out;
                })
                .catch(function(err) {
                    console.warn('[pp] #4483: не прочитать «Обеспечения» позиции ' + key + ': ' + ((err && err.message) || err));
                    supplyValuesByPosition[key] = {};
                    return {};
                });
        }
        // #4483: донорское обеспечение — на «Партию ГП» головы (прежнее поведение).
        function moveSupplyToBatch(supplyId, batchId) {
            var f = {}; f['t' + supBatchReq] = String(batchId);
            return self.post('_m_set/' + encodeURIComponent(supplyId) + '?JSON', f);
        }
        function mergeOrderIds(a, b) {
            var seen = {}, out = [];
            (String(a || '') + ',' + String(b || '')).split(',').forEach(function(x) {
                var v = x.trim();
                if (v === '' || seen[v]) return;
                seen[v] = 1; out.push(v);
            });
            return out.join(',');
        }
        var mergedCount = 0, report = [], foldedSupplies = 0;   // #4483: сколько связей влито вместо задвоения
        var chain = groups.reduce(function(acc, g) {
            return acc.then(function() {
                var head = cutById[g.headId];
                if (!head) return;
                var donors = g.memberIds.slice(1).map(function(id) { return cutById[id]; }).filter(Boolean);
                if (!donors.length) return;
                return batchesOf(g.headId).then(function(headBatches) {
                    var byWidth = {};
                    headBatches.forEach(function(b) { byWidth[stripWidthKey(b.width)] = b; });
                    // #4483: какие позиции голова уже обеспечивает — с ними донорские обеспечения
                    // складываются, а не встают второй записью. Первое обеспечение позиции —
                    // приёмник (у исправных данных оно единственное).
                    var headSupByPosition = {};
                    (supByCut[String(g.headId)] || []).forEach(function(s) {
                        var pid = String(s && s.positionId == null ? '' : s.positionId);
                        if (pid !== '' && !headSupByPosition[pid]) headSupByPosition[pid] = s;
                    });
                    // Каждого донора обрабатываем последовательно: партии → обеспечения → удаление записи.
                    return donors.reduce(function(dChain, donor) {
                        return dChain.then(function() {
                            return batchesOf(donor.id).then(function(donorBatches) {
                                var supplies = supByCut[String(donor.id)] || [];
                                return donorBatches.reduce(function(bChain, db) {
                                    return bChain.then(function() {
                                        var target = byWidth[stripWidthKey(db.width)];
                                        if (!target) {
                                            // Ширины у головы нет — переносим партию под голову как есть.
                                            return self.post('_m_move/' + encodeURIComponent(db.id) + '?JSON&up=' + encodeURIComponent(g.headId), {})
                                                .then(function() { byWidth[stripWidthKey(db.width)] = db; });
                                        }
                                        // Обеспечения донорской партии — на партию головы. #4483: если эту
                                        // ПОЗИЦИЮ голова уже обеспечивает из той же партии, перевешивать нельзя —
                                        // получится ВТОРАЯ связь задания с одним заказом (боевая ateh, заказ 4443:
                                        // 400 м/120 рул + 200 м/60 рул на позиции 646600). Складываем метраж и
                                        // рулоны в головное «Обеспечение», донорское удаляем: у пары
                                        // (позиция × «Партия ГП») ровно одна запись.
                                        var moveSup = supplies.filter(function(s) { return String(s.finishedBatchId) === String(db.id); })
                                            .reduce(function(sChain, s) {
                                                return sChain.then(function() {
                                                    var pid = String(s.positionId == null ? '' : s.positionId);
                                                    var headSup = pid !== '' ? headSupByPosition[pid] : null;
                                                    if (!headSup) {
                                                        // Позиции у головы нет — связь переносим как есть; следующий
                                                        // донор той же позиции сложится уже с ней.
                                                        return moveSupplyToBatch(s.id, target.id).then(function() {
                                                            if (pid !== '') headSupByPosition[pid] = s;
                                                        });
                                                    }
                                                    return supplyValuesOfPosition(pid).then(function(vals) {
                                                        var h = vals[String(headSup.id)], d = vals[String(s.id)];
                                                        if (!h || !d || !(supFootageReq || supRollsReq)) {
                                                            // Значений нет — сложить нечего. Связь с заказом важнее
                                                            // аккуратности записи: перевешиваем и ГОВОРИМ (ТЗ §14).
                                                            console.warn('[pp] #4483: не сложить «Обеспечения» позиции ' + pid +
                                                                ' (нет значений в БД) — донорское ' + s.id + ' перевешиваю на партию ' + target.id);
                                                            return moveSupplyToBatch(s.id, target.id);
                                                        }
                                                        var footage = round3((h.footage || 0) + (d.footage || 0));
                                                        var rolls = round3((h.rolls || 0) + (d.rolls || 0));
                                                        var f = {};
                                                        if (supFootageReq) f['t' + supFootageReq] = footage > 0 ? String(footage) : '';
                                                        if (supRollsReq) f['t' + supRollsReq] = rolls > 0 ? String(rolls) : '';
                                                        return self.post('_m_set/' + encodeURIComponent(headSup.id) + '?JSON', f)
                                                            .then(function() {
                                                                h.footage = footage; h.rolls = rolls;   // следующий донор складывается с этим
                                                                foldedSupplies += 1;
                                                                return self.post('_m_del/' + encodeURIComponent(s.id) + '?JSON', {});
                                                            });
                                                    });
                                                });
                                            }, Promise.resolve());
                                        return moveSup.then(function() {
                                            target.rolls = round3(target.rolls + db.rolls);
                                            target.orderId = mergeOrderIds(target.orderId, db.orderId);
                                            return self.post('_m_del/' + encodeURIComponent(db.id) + '?JSON', {});
                                        });
                                    });
                                }, Promise.resolve());
                            }).then(function() {
                                return self.post('_m_del/' + encodeURIComponent(donor.id) + '?JSON', {});
                            }).then(function() { mergedCount += 1; });
                        });
                    }, Promise.resolve()).then(function() {
                        // Голова: сумма проходов + пересчитанные тайминг-поля и «Кол-во план» партий.
                        var runLength = cutRunLength(head, self.supplies, self.positionLengthById);
                        var fields = {};
                        fields['t' + runsReqId] = String(g.runs);
                        if (durReqId) {
                            var dur = plannedCutDurationMinutes(runLength, g.runs, self.opTimes, head);   // #4501
                            fields['t' + durReqId] = dur > 0 ? String(Math.ceil(dur)) : '';
                        }
                        if (timingReqId) fields['t' + timingReqId] = cutTimingDetails(runLength, g.runs, self.opTimes, head);   // #4501
                        // #4488: поля, которые задаёт вызывающий (маркер цепочки на себя, замок).
                        var extra = (opts && opts.headFields) || null;
                        if (extra) Object.keys(extra).forEach(function(k) { fields[k] = extra[k]; });
                        return self.post('_m_set/' + encodeURIComponent(g.headId) + '?JSON', fields).then(function() {
                            return Object.keys(byWidth).reduce(function(uChain, w) {
                                var b = byWidth[w];
                                return uChain.then(function() {
                                    var f = {};
                                    if (fbPlannedReq) f['t' + fbPlannedReq] = String(round3(b.strips * g.runs));
                                    if (fbRollsReq) f['t' + fbRollsReq] = String(round3(b.rolls));
                                    if (fbOrderReq && b.orderId) f['t' + fbOrderReq] = String(b.orderId);
                                    if (!Object.keys(f).length) return;
                                    return self.post('_m_set/' + encodeURIComponent(b.id) + '?JSON', f);
                                });
                            }, Promise.resolve());
                        });
                    }).then(function() {
                        report.push('заказ ' + g.orderId + ': ' + g.memberIds.length + ' → 1 (задание ' + g.headId + ', проходов ' + g.runs + ')');
                    });
                });
            });
        }, Promise.resolve());
        var label = (opts && typeof opts.label === 'function') ? opts.label : null;
        return chain.then(function() {
            if (!mergedCount) return 0;
            var what = label ? label(mergedCount) : ('Объединено заданий одного заказа: ' + mergedCount + ' (' + report.join('; ') + ')');
            console.log('[pp] 🔗 ' + (forcedGroups ? '#4488 сшито частей задания: ' : '#4424 объединено заданий: ')
                + mergedCount + ' — ' + report.join('; ')
                + (foldedSupplies ? ('; #4483 связей влито в существующие: ' + foldedSupplies) : ''));
            self.notify(what + (foldedSupplies ? (' · связей с позициями влито: ' + foldedSupplies) : ''), 'success');
            return self.reload().then(function() { return mergedCount; });
        }).catch(function(err) {
            console.error('[pp] ❌ ' + (forcedGroups ? '#4488 сшивание задания прервано:' : '#4424 объединение заданий прервано:'),
                err && err.message, err && err.stack);
            self.notify((forcedGroups ? 'Не удалось собрать задание из частей: ' : 'Не удалось объединить задания одного заказа: ')
                + (err && err.message || err), 'error');
            return self.reload().then(function() { return mergedCount; });
        });
    };

    // #4488: СШИТЬ ЗАДАНИЕ ИЗ ЧАСТЕЙ перед тем, как планировать его вставку (ТЗ §15).
    // Задание, разорванное по дням, живёт цепочкой записей (голова + продолжения, общий «ID первой
    // части»). Ручной перенос двигает ОДНУ запись — и хвост остаётся в прежнем дне: оператор тащит
    // задание, а уезжает огрызок (боевая ateh: голова в 1 проход встала на 3-е место, 11 проходов
    // остались назавтра). Планировщик пересобрать цепочку уже не мог — перенос ставит на неё замок.
    // Поэтому ПЕРЕД планированием вставки все части сливаются в ОДНУ запись:
    //   • приёмник — та запись, КОТОРУЮ ТАЩАТ (она и поедет на выбранное место);
    //   • проходы суммируются, «Длительность»/«Тайминг» пересчитываются;
    //   • «Партии ГП» и «Обеспечения» частей сливаются (#4424/#4483), записи-части удаляются;
    //   • «ID первой части» приёмника указывает на него самого — задание снова цельное;
    //   • замок 🔒 с любой из частей переходит на результат (иначе правило не сработало бы там, где
    //     оно и понадобилось: перенос сам ставит замок на перенесённое).
    // Сшивать нечего (задание целое) → 0 и ни одной записи в БД (идемпотентно).
    // → Promise<число влитых частей>.
    AtexProductionPlanning.prototype.mergeSplitChain = function(cutId) {
        var self = this;
        var cutMeta = this.meta && this.meta.cut;
        if (!cutMeta) return Promise.resolve(0);
        var id = String(cutId == null ? '' : cutId);
        if (id === '') return Promise.resolve(0);
        var partRecords = splitChainPartsOf(this.cuts || [], id);
        if (partRecords.length < 2) return Promise.resolve(0);
        var parts = partRecords.map(function(c) { return String(c.id); });
        var cutById = {};
        partRecords.forEach(function(c) { cutById[String(c.id)] = c; });
        // Начатую часть не трогаем (#4381): её проходы уже идут на станке, слить их некуда.
        var started = parts.filter(function(p) { return cutIsStarted(cutById[p]); });
        if (started.length) {
            this.notify('Задание уже начато частями — сшить нельзя (' + started.join(', ') + ')', 'info');
            return Promise.resolve(0);
        }
        var donors = parts.filter(function(p) { return p !== id; });
        var runs = parts.reduce(function(sum, p) { return sum + (stripNum(cutById[p] && cutById[p].plannedRuns) || 0); }, 0);
        var anyFixed = parts.some(function(p) { return !!(cutById[p] && cutById[p].fixed); });
        var head = cutById[id] || {};
        var headFields = {};
        var firstPartReqId = reqIdByName(cutMeta, CUT_REQ.firstPart);
        if (firstPartReqId) headFields['t' + firstPartReqId] = id;   // цепочки больше нет — задание цельное
        var fixedReqId = reqIdByName(cutMeta, CUT_REQ.fixed);
        if (fixedReqId && anyFixed && !head.fixed) headFields['t' + fixedReqId] = '1';
        var mergeFn = (typeof this.mergeSameOrderTasks === 'function')
            ? this.mergeSameOrderTasks.bind(this) : AtexProductionPlanning.prototype.mergeSameOrderTasks.bind(this);
        return mergeFn({
            groups: [{ headId: id, memberIds: [id].concat(donors), runs: runs,
                       orderId: String(head.orderId == null ? '' : head.orderId) }],
            headFields: headFields,
            label: function(n) { return 'Задание собрано из частей: ' + (n + 1) + ' → 1 (проходов ' + runs + ')'; }
        });
    };

    // #4175: ВОССТАНОВЛЕНИЕ пропавшей связи «задание ↔ заказ» после дробления по дням.
    // Симптом (#4163→#4175, «пустой срок / нет связей»): задание ВЫПУСКАЕТ заказ — его «Партия ГП»
    // несёт «ID заказа» и проходы дают ровно спрос позиции, — но НИ ОДНОГО «Обеспечения» на его
    // Партиях ГП нет. Отчёт cut_planning join'ит Резка→Обеспечение→Позиция, поэтому у задания без
    // Обеспечения ПУСТЫ order_id/order_no/cut_winding/срок (они приходят из позиции ЧЕРЕЗ Обеспечение,
    // не из «Партии ГП») — по ним сироту не отличить от склада.
    // КОРЕНЬ: day-split (autoSequenceQueue → applySplitPlan) РЕЮЗит существующие резки цепочки как
    // новые сегменты (reuseId = chain[k], engine); update-путь реюза НЕ создаёт Обеспечений (их
    // создаёт только create-путь продолжений), а свежесгенерированные сегменты с Обеспечением уходят
    // в deletes. Итог: проходы уезжают на реюзнутую резку, Обеспечение — на удалённую. (Журнал ateh
    // заказ 4059: свежие обеспечения 737+220 обнулены/удалены, проходы 43+44 на реюзнутых 497698/497708
    // без единого Обеспечения.)
    // НЕ УДАЛЯЕМ: эта резка — ЕДИНСТВЕННЫЙ выпуск заказа (свежая покрывающая удалена), удаление
    // недокрыло бы заказ. ВОССТАНАВЛИВАЕМ инвариант «выпускает заказ ⇔ привязана»: на позицию заказа
    // (по «ID заказа»+ширине самой «Партии ГП», не по пустому отчётному order_id) создаём Обеспечение
    // → «Партия ГП», рулоны = спрос «Партии ГП». Складская Партия ГП (без «ID заказа») законно без
    // Обеспечения — не трогаем. Идемпотентно: после reload у резки есть Обеспечение → не кандидат.
    // Не молча (ТЗ §14/#4059): console + тост. → Promise<число восстановленных связей>.
    AtexProductionPlanning.prototype.reconcileOrphanOrderSupplies = function() {
        var self = this;
        this._ppOp = 'reconcileOrphanOrderSupplies';   // #4177: контекст трассы записей (async)
        var fbMeta = this.meta.finishedBatch, supMeta = this.meta.supply;
        if (!fbMeta || !supMeta) return Promise.resolve(0);
        var supByCut = {};
        (self.supplies || []).forEach(function(s) { if (s && s.cutId != null) supByCut[String(s.cutId)] = (supByCut[String(s.cutId)] || 0) + 1; });
        // Кандидаты: задания с проходами БЕЗ единого Обеспечения (и складские, и заказные-сироты).
        // Заказ определяет «ID заказа» самой «Партии ГП» (читаем ниже) — отчётный order_id тут пуст.
        var suspects = (self.cuts || []).filter(function(c) {
            return c && stripNum(c.plannedRuns) > 0 && !(supByCut[String(c.id)] > 0);
        });
        if (!suspects.length) return Promise.resolve(0);
        var fbOrderIdx = columnIndex(fbMeta, FINISHED_BATCH_REQ.orderId);
        var fbWidthIdx = columnIndex(fbMeta, FINISHED_BATCH_REQ.width);
        var fbRollsIdx = columnIndex(fbMeta, FINISHED_BATCH_REQ.rolls);
        var fbPlannedIdx = columnIndex(fbMeta, FINISHED_BATCH_REQ.planned);
        var fbStripsIdx = columnIndex(fbMeta, FINISHED_BATCH_REQ.strips);   // #4179: полос за проход — для реального выпуска
        // Позиция заказа по (заказ|ширина) — из positions_list; освежаем, если пусто (напр. «Упорядочить»).
        var ensurePos = (self.genPositions && self.genPositions.length) ? Promise.resolve() : self.loadPositions();
        return ensurePos.then(function() {
            var posByOrderWidth = {};
            (self.genPositions || []).forEach(function(p) {
                if (p && p.orderId) posByOrderWidth[String(p.orderId) + '|' + stripWidthKey(p.width)] = p;
            });
            var restored = [], unmapped = [];
            // «Партии ГП» подозреваемых читаем последовательно (их единицы) — по реальному «ID заказа».
            var scan = suspects.reduce(function(chain, c) {
                return chain.then(function() {
                    return self.getJson('object/' + fbMeta.id + '/?JSON_OBJ&F_U=' + encodeURIComponent(c.id) + '&LIMIT=0,500').then(function(rows) {
                        (rows || []).forEach(function(rec) {
                            var r = rec.r || [];
                            var oid = (fbOrderIdx >= 0 && r[fbOrderIdx] != null) ? String(r[fbOrderIdx]).trim() : '';
                            if (!oid) return;   // складская «Партия ГП» без заказа — законно без Обеспечения
                            var w = (fbWidthIdx >= 0 && r[fbWidthIdx] != null) ? r[fbWidthIdx] : '';
                            var pos = posByOrderWidth[oid + '|' + stripWidthKey(w)];
                            var rolls = (fbRollsIdx >= 0 && stripNum(r[fbRollsIdx]) > 0) ? stripNum(r[fbRollsIdx])
                                      : (fbPlannedIdx >= 0 ? stripNum(r[fbPlannedIdx]) : 0);
                            // #4179: реальный выпуск задания = полос × ПРОХОДОВ задания. У реюзнутого
                            // setup-only сегмента (0 проходов при генерации → runs проставлены позже)
                            // «Кол-во план/рулонов» партии УСТАРЕЛИ (полос×0=полос), поэтому берём МАКСИМУМ
                            // из хранимого и реального выпуска — иначе Обеспечение восстановится заниженным
                            // (5 из 20) и заказ снова «недообеспечен» → повторная генерация (churn).
                            var strips = fbStripsIdx >= 0 ? stripNum(r[fbStripsIdx]) : 0;
                            var produced = round3(strips * stripNum(c.plannedRuns));
                            if (produced > rolls) rolls = produced;
                            if (!pos) { unmapped.push({ cutId: String(c.id), fbId: String(rec.i), orderId: oid, width: String(w) }); return; }
                            restored.push({ cutId: String(c.id), fbId: String(rec.i), positionId: String(pos.id),
                                rolls: rolls, footage: pos.length > 0 ? round3(pos.length) : '' });
                        });
                    });
                });
            }, Promise.resolve());

            return scan.then(function() {
                if (unmapped.length) {
                    console.error('[pp] #4175 не восстановить связь (нет позиции заказа «ID заказа|ширина» в positions_list): '
                        + unmapped.map(function(u) { return 'резка ' + u.cutId + ' Партия ГП ' + u.fbId + ' заказ ' + u.orderId + ' ш' + u.width; }).join('; '));
                    if (self.notify) self.notify('Задания-сироты дробления: не нашёл позицию заказа для восстановления связи (' + unmapped.length + ') — см. консоль', 'error');
                }
                if (!restored.length) return 0;
                console.error('[pp] #4175 восстанавливаю пропавшие Обеспечения заказных заданий-сирот дробления: '
                    + restored.map(function(x) { return 'резка ' + x.cutId + '→позиция ' + x.positionId + ' (' + x.rolls + ' рул, Партия ГП ' + x.fbId + ')'; }).join('; '));
                if (self.notify) self.notify('Восстановлена связь заданий с заказом (Обеспечение по дроблению): ' + restored.length, 'error');
                var chain = Promise.resolve();
                restored.forEach(function(x) {
                    chain = chain.then(function() {
                        var fields = buildSupplyFieldsForFinishedBatch(supMeta, {
                            finishedBatchId: x.fbId, footage: x.footage, rolls: x.rolls,
                            active: '1', status: SUPPLY_STATUSES[0]
                        });
                        return self.post('_m_new/' + supMeta.id + '?JSON&up=' + encodeURIComponent(x.positionId), fields)
                            .catch(function(err) { console.warn('[pp] #4175 не создалось Обеспечение резки ' + x.cutId + ': ' + ((err && err.message) || err)); });
                    });
                });
                return chain.then(function() { return self.reload(); }).then(function() { return restored.length; });
            });
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
        this._ppOp = 'applySplitPlan';   // #4177: контекст трассы записей (async)
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
            return hc ? cutRunLength(hc, self.supplies, self.positionLengthById) : 0;
        }
        // #3795: «Вид сырья» цепочки = сырьё её ГОЛОВЫ (у всех сегментов одно сырьё). Берём
        // у головы, потому что у реюзнутого продолжения, созданного до фикса, поле пустое.
        // #4171: если ГОЛОВА не резолвится (chainHeadById указал на резку не из self.cuts —
        // корень сироты #4163/#4168), берём напрямую у резки cutId — иначе продолжение родится с
        // пустым сырьём и станет сиротой «нет связей».
        function materialForCutId(cutId) {
            var head = chainHeadById[String(cutId)] || String(cutId);
            var hc = cutsById[head] || cutsById[String(cutId)];
            return hc && hc.materialId != null && String(hc.materialId) !== '' ? String(hc.materialId) : '';
        }
        // #4128: «Тип намотки» цепочки = намотке её ГОЛОВЫ — заправка одна на все сегменты.
        // Берём у головы, а не у прямого родителя: у реюзнутого продолжения, созданного до
        // фикса, поле пустое, и пустота расползалась по всей цепочке.
        // #4171 (КОРЕНЬ сироты #4163/#4168): голова цепочки РЕЗОЛВИТСЯ через chainHeadById; если
        // она указала на резку, которой НЕТ в self.cuts (cutsById[head] === undefined — напр. голова
        // удалена/не подгружена/логический id из mergeContinuationChains), то `normWinding(undefined)`
        // = '' → продолжение создаётся с ПУСТОЙ намоткой → рвёт continuationSignature (станок|сырьё|
        // НАМОТКА|ножи) → mergeContinuationChains его не подшивает, delete-путь не трогает → висит
        // «нет связей» (на ateh: заказ 3966, все позиции OUT, но резка-дубль с пустой намоткой и без
        // Обеспечения). ФИКС: не резолвится голова → берём намотку напрямую у резки cutId (у неё она
        // есть). Всё ещё пусто (ни у головы, ни у резки) → предупреждаем: тогда пустая намотка
        // «законная» (позиция без намотки) ЛИБО и резка не подгружена — видно в трейсе.
        function windingForCutId(cutId) {
            var head = chainHeadById[String(cutId)] || String(cutId);
            var hc = cutsById[head];
            var w = normWinding(hc && hc.winding);
            if (w === '') {
                var direct = cutsById[String(cutId)];
                var dw = normWinding(direct && direct.winding);
                if (dw !== '') {
                    console.warn('[pp] #4171 windingForCutId(' + cutId + '): голова "' + head + '" вне self.cuts (' + (hc ? 'намотка пуста' : 'нет в cutsById') + ') — беру намотку у самой резки: ' + dw);
                    return dw;
                }
                if (!direct) console.warn('[pp] #4171 windingForCutId(' + cutId + '): и головы "' + head + '", и резки нет в self.cuts — продолжение может стать сиротой');
            }
            return w;
        }
        // #4155: «Партия сырья» цепочки = партии её ГОЛОВЫ (одно сырьё на все сегменты).
        // Берём у головы, а не у прямого родителя: продолжение, созданное до фикса, хранит
        // пустую «Партию сырья», и пустота расползлась бы по новым сегментам. batchId головы
        // приходит из object/ (loadCutSequences #4155), т.к. отчёт cut_planning его не отдаёт.
        function batchForCutId(cutId) {
            var head = chainHeadById[String(cutId)] || String(cutId);
            var hc = cutsById[head];
            var b = hc && hc.batchId != null ? String(hc.batchId) : '';
            return b !== '' ? b : (cutsById[String(cutId)] && cutsById[String(cutId)].batchId ? String(cutsById[String(cutId)].batchId) : '');
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
            // #3635 п.4: «Длительность, минут» — целой (вверх), как при создании резки.
            // #4501: норма намотки — по голове цепочки (фольга + самая узкая полоса): сегменты
            // дробления режут один и тот же набор полос.
            var winding = P > 0 ? Math.ceil(plannedCutDurationMinutes(runLenForCutId(cutId), P, self.opTimes, head)) : 0;
            if (durReqIdSplit) out['t' + durReqIdSplit] = String(winding);
            if (cutTimeReqIdSplit) out['t' + cutTimeReqIdSplit] = String(P > 0 ? Math.round(winding + betweenCutsSplit * P) : 0);
            return out;
        }
        // buildFields ключ для проходов — по runsReqId (live «Кол-во резок план»).
        var createsByParent = {};
        (ops.creates || []).forEach(function(cr) { (createsByParent[cr.parentCutId] = createsByParent[cr.parentCutId] || []).push(cr); });
        var updateByCut = {};
        (ops.updates || []).forEach(function(u) { updateByCut[u.cutId] = u; });

        // #4158: КОНСЕРВАЦИЯ Обеспечения при СХЛОПЫВАНИИ цепочки. Когда сегментов дробления
        // становится МЕНЬШЕ, лишние продолжения уходят в ops.deletes вместе со своими
        // Обеспечениями. Обеспечение головы правит ТОЛЬКО create-путь (2a), а он при схлопывании
        // не запускается — creates и deletes на голову взаимоисключающи (см. buildSplitDayOps:
        // сегментов ≤ длины цепочки ⇒ только реюз+delete, без creates). Голова оставалась с УЖЕ
        // ужатой прошлым разбиением долей, доля удаляемого продолжения ИСЧЕЗАЛА → Σ рулонов цепочки
        // усыхала ниже спроса позиции заказа: продолжение «не привязано к заказу» / «неполное
        // Обеспечение» (#4158). Возвращаем доли удаляемых продолжений ОБРАТНО в Обеспечение головы.
        // Покрытие позиции считается по positionId (suppliedRollsForPosition суммирует ВСЕ
        // обеспечения позиции, ширина не важна) — поэтому агрегируем по (голова, позиция) и
        // добавляем к головному обеспечению той же позиции. Инвариант: Σ рулонов/метража цепочки
        // до и после разбиения совпадает. Рост (creates) уже консервативен (делит долю головы,
        // реюзнутые продолжения свою долю хранят) — там ничего не меняем.
        var deleteSet = {};
        (ops.deletes || []).forEach(function(id) { deleteSet[String(id)] = true; });
        var absorbByHeadPos = {};   // headId → { positionId → { rolls, footage } } из удаляемых продолжений
        (self.supplies || []).forEach(function(s) {
            if (!s || !deleteSet[String(s.cutId)] || s.positionId == null) return;   // обеспечение удаляемого продолжения
            var head = chainHeadById[String(s.cutId)];
            if (!head || deleteSet[String(head)]) return;   // голова тоже удаляется/сирота — возвращать некуда
            var byPos = absorbByHeadPos[head] || (absorbByHeadPos[head] = {});
            var acc = byPos[String(s.positionId)] || (byPos[String(s.positionId)] = { rolls: 0, footage: 0, rollsKnown: true });
            // #4536: количество удаляемой доли НЕИЗВЕСТНО (отчёт колонку не отдаёт) — складывать
            // нечего, и уж точно нельзя записать сумму нулей поверх хранимого количества головы.
            // Метраж известен всегда, его возвращаем как прежде.
            if (s.rolls == null) acc.rollsKnown = false;
            else acc.rolls = round3(acc.rolls + (Number(s.rolls) || 0));
            acc.footage = round3(acc.footage + (Number(s.footage) || 0));
        });
        var headSupplyRestore = {};   // headId → [{ supplyId, finishedBatchId, rolls, footage }] (новые значения головных обеспечений)
        Object.keys(absorbByHeadPos).forEach(function(head) {
            var byPos = absorbByHeadPos[head];
            var headSupplies = (self.supplies || []).filter(function(s) { return String(s.cutId) === String(head); });
            Object.keys(byPos).forEach(function(pos) {
                var add = byPos[pos];
                if (!(add.rolls > 0) && !(add.footage > 0)) return;
                var target = null;
                for (var i = 0; i < headSupplies.length; i++) {
                    if (String(headSupplies[i].positionId) === pos) { target = headSupplies[i]; break; }
                }
                if (!target) return;   // у головы нет обеспечения этой позиции (не ожидается) — пропускаем
                // #4536: количество возвращаем, только если известны ОБЕ части (доля удаляемого
                // продолжения и хранимое головы). Неизвестно хоть одно → поля в запросе нет:
                // хранимое количество головы остаётся целым, а не превращается в сумму нулей.
                var rollsKnown = add.rollsKnown !== false && target.rolls != null;
                (headSupplyRestore[String(head)] = headSupplyRestore[String(head)] || []).push({
                    supplyId: target.id,
                    finishedBatchId: target.finishedBatchId,
                    rolls: rollsKnown ? round3((Number(target.rolls) || 0) + add.rolls) : null,
                    footage: round3((Number(target.footage) || 0) + add.footage)
                });
            });
        });

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
        var MAX_PARALLEL_SPLIT = MAX_PARALLEL_WRITES;   // #4477: предел один на весь модуль

        // 1) Обновить существующие записи (первый сегмент каждой логической резки).
        // ⚠️ Первая колонка (плановое время старта) пишется ТОЛЬКО через _m_save (GUIDE
        // issue #775: _m_set первую колонку НЕ задаёт). Остальные реквизиты — _m_set.
        // #4499: КОЛОНКИ, ПОСЧИТАННЫЕ УПАКОВЩИКОМ. Их пишет persistCutSetupColumns ниже — вместо
        // повторного расчёта переналадки по развёртке очереди. Для обновляемых записей id известен
        // сразу, для создаваемых продолжений — когда `_m_new` вернёт id (ниже, по месту).
        var planColsByCut = {};
        (ops.updates || []).forEach(function(u) { if (u && u.planCols) planColsByCut[String(u.cutId)] = u.planCols; });
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
                    // #4452 (ТЗ §15, CUT_BATCH): «Партия сырья» — задание обязано её иметь. Значение
                    // разрешил страж (guardPlanOps → resolveBatchForCut: цепочка → «Расход сырья» →
                    // FIFO), фолбэк — партия головы цепочки. Пишем ТОЛЬКО если ХРАНИМОЕ пусто/иное:
                    // сравниваем с batchIdStored (снимок до лечения в памяти), иначе восстановленная
                    // партия навсегда осталась бы только в памяти, а база — пустой.
                    if (cutReqIds.materialBatch) {
                        var ubatch = (u.materialBatchId != null && String(u.materialBatchId) !== '')
                            ? String(u.materialBatchId) : batchForCutId(u.cutId);
                        var batchOld = storedCut
                            ? String((storedCut.batchIdStored != null ? storedCut.batchIdStored : storedCut.batchId) || '').trim() : '';
                        if (ubatch && batchOld !== ubatch) fields['t' + cutReqIds.materialBatch] = ubatch;
                    }
                    // #4128: «Тип намотки» = намотке головы цепочки. Запись становится сегментом
                    // этой резки здесь же — намотка в этот момент известна, пишем её. Только если
                    // хранимое пусто/иное (#4001), иначе лишний _m_set.
                    if (cutReqIds.winding) {
                        var uwind = windingForCutId(u.cutId);
                        var windOld = storedCut ? normWinding(storedCut.winding) : '';
                        if (uwind && windOld !== uwind) fields['t' + cutReqIds.winding] = uwind;
                    }
                    // #4085: слой размещения переназначил станок — пишем «Слиттер» (u.slitterId), только если
                    // отличается от хранимого (в не-слот-режиме u.slitterId нет → ничего не пишем, контракт прежний).
                    if (u.slitterId != null && cutReqIds.slitter) {
                        var curSid = storedCut && storedCut.slitter ? String(storedCut.slitter.id) : '';
                        if (String(u.slitterId) !== curSid) fields['t' + cutReqIds.slitter] = String(u.slitterId);
                    }
                    var setFields = Object.keys(fields).length
                        ? self.post('_m_set/' + u.cutId + '?JSON', fields)
                        : Promise.resolve();
                    // #4158: у ГОЛОВЫ схлопнутой цепочки — вернуть в её Обеспечение долю удаляемых
                    // продолжений (консервация покрытия позиции). headSupplyRestore задан только для
                    // голов с deletes; у реюзнутых продолжений/несхлопнутых цепочек список пуст → no-op.
                    var restores = headSupplyRestore[String(u.cutId)] || [];
                    return restores.reduce(function(chain, rs) {
                        return chain.then(function() {
                            var sf = buildSupplyFieldsForFinishedBatch(supMeta, {
                                finishedBatchId: rs.finishedBatchId,
                                footage: rs.footage > 0 ? rs.footage : '', rolls: rs.rolls,
                                active: '1', status: SUPPLY_STATUSES[0]
                            });
                            return self.post('_m_set/' + rs.supplyId + '?JSON', sf);
                        });
                    }, setFields);
                });
            }).then(splitBump).catch(softSkip); };
        });

        // #4628: ДОЛЯ ОБЕСПЕЧЕНИЯ ИДЁТ ЗА ПРОХОДАМИ И ТАМ, ГДЕ ПРОДОЛЖЕНИЙ НЕ РОЖДАЕТСЯ.
        //
        // Доли сегментов раскладывает `splitSupplyShares` — но зовёт её ТОЛЬКО create-путь (ниже,
        // шаг 2a). Когда упаковщик перераспределяет проходы между УЖЕ существующими звеньями
        // цепочки (creates нет, одни updates), проходы переписываются, а «Кол-во рулонов»
        // обеспечения остаётся от ПРЕЖНЕГО разбиения.
        //
        // Боевое (ateh, 06.08.2026, после «Упорядочить»): 8 звеньев в 4 цепочках. Заказ 4455 —
        // проходы 13/142/45, а доли 195/2055/750 (под 13/137/50, прежнее разбиение); заказ 4567 —
        // проходы 2/3, доли 29/116 (под 1/4). Σ по цепочке при этом верна, поэтому §15
        // (SUPPLY_CONSERVED) молчит и недобора нет — расходится ПОЗВЕННОЕ распределение, а именно
        // его читает разбиение по дням (#4536: доля звена — это его доля работы).
        //
        // Инвариант: доля звена = его проходам. Считаем ТОЙ ЖЕ `splitSupplyShares` и по тем же
        // ключам, что create-путь, — второй арифметики распределения не заводим (#4499).
        // Область: только цепочки, у которых проходы менялись и продолжений не рождается (у
        // остальных доли уже пишет create-путь — иначе одну запись писали бы дважды).
        var shareFixTasks = (function() {
            if (!supMeta) return [];
            var runsAfter = {}, changedChains = {}, chainMembers = {};
            (self.cuts || []).forEach(function(c) {
                if (!c || c.id == null) return;
                var id = String(c.id);
                runsAfter[id] = Number(c.plannedRuns) || 0;
                var ch = chainHeadById[id] || id;
                (chainMembers[ch] = chainMembers[ch] || []).push(id);
            });
            (ops.updates || []).forEach(function(u) {
                var id = String(u.cutId);
                if (u.plannedRuns == null) return;
                var was = runsAfter[id];
                runsAfter[id] = Number(u.plannedRuns) || 0;
                var ch = chainHeadById[id] || id;
                if (Number(was) !== runsAfter[id]) changedChains[ch] = true;
            });
            // Цепочки, где рождаются продолжения, пропускаем — их доли пишет create-путь.
            Object.keys(createsByParent).forEach(function(parentId) {
                delete changedChains[chainHeadById[String(parentId)] || String(parentId)];
            });
            // #4158: цепочки, где звенья СНИМАЮТСЯ, тоже не наши. При схлопывании действует своё
            // правило консервации — долю удаляемого сегмента поглощает голова, а реюзнутое
            // продолжение хранит свою долю; пропорциональная раскладка это правило ломает
            // (поймано `atex-production-planning-4158`). Наш случай — чистое ПЕРЕраспределение
            // проходов между существующими звеньями, без рождения и снятия записей.
            var deleted = {};
            (ops.deletes || []).forEach(function(id) {
                deleted[String(id)] = true;
                delete changedChains[chainHeadById[String(id)] || String(id)];
            });

            var tasks = [];
            Object.keys(changedChains).forEach(function(ch) {
                var seg = (chainMembers[ch] || []).filter(function(id) { return !deleted[id]; });
                if (seg.length < 1) return;
                // Порядок звеньев — по плановому старту ПОСЛЕ операций: доли раскладываются по
                // сегментам в том же порядке, в каком они идут в плане.
                var startAfter = {};
                seg.forEach(function(id) {
                    var c = cutsById[id];
                    startAfter[id] = Number(c && c.planDate) || 0;
                });
                (ops.updates || []).forEach(function(u) {
                    var ts = Number(u.planStartTs);
                    if (isFinite(ts) && ts > 0 && startAfter[String(u.cutId)] != null) startAfter[String(u.cutId)] = ts;
                });
                seg.sort(function(a, b) { return (startAfter[a] - startAfter[b]) || (Number(a) - Number(b)); });
                var segRuns = seg.map(function(id) { return runsAfter[id] || 0; });

                // Обеспечения цепочки группируем по ПОЗИЦИИ: одно задание может покрывать
                // несколько позиций, и доля каждой делится независимо.
                var byPosition = {};
                seg.forEach(function(id) {
                    (self.supplies || []).forEach(function(s) {
                        if (!s || String(s.cutId) !== id) return;
                        var pid = String(s.positionId == null ? '' : s.positionId);
                        (byPosition[pid] = byPosition[pid] || []).push({ seg: id, s: s });
                    });
                });
                Object.keys(byPosition).forEach(function(pid) {
                    var rows = byPosition[pid];
                    var totalRolls = 0, totalFootage = 0, known = false;
                    rows.forEach(function(r) {
                        if (r.s.rolls != null && r.s.rolls !== '') { known = true; totalRolls += Number(r.s.rolls) || 0; }
                        totalFootage += Number(r.s.footage) || 0;
                    });
                    if (!known) return;   // количество неизвестно — не выдумываем (#4536)
                    var shares = splitSupplyShares(totalRolls, totalFootage, segRuns);
                    rows.forEach(function(r) {
                        var i = seg.indexOf(r.seg);
                        var sh = shares[i] || { rolls: 0, footage: 0 };
                        var wasRolls = Number(r.s.rolls) || 0, wasFootage = Number(r.s.footage) || 0;
                        if (Math.round(wasRolls) === Math.round(sh.rolls || 0)
                            && round3(wasFootage) === round3(sh.footage || 0)) return;   // уже верно — не пишем
                        tasks.push(function() {
                            var f = buildSupplyFieldsForFinishedBatch(supMeta, {
                                finishedBatchId: r.s.finishedBatchId,
                                footage: sh.footage > 0 ? sh.footage : '', rolls: sh.rolls,
                                active: '1', status: SUPPLY_STATUSES[0]
                            });
                            return self.post('_m_set/' + r.s.id + '?JSON', f).then(function() {
                                return planJournal(self, {
                                    event: 'SHARE_FIX', cut: r.seg, before: wasRolls, after: sh.rolls,
                                    details: '#4628: доля обеспечения приведена к проходам звена (' +
                                        wasRolls + ' → ' + sh.rolls + ' рулонов при ' + (runsAfter[r.seg] || 0) + ' проходах)'
                                });
                            });
                        });
                    });
                });
            });
            return tasks;
        })();

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
                // #4480: ВНУТРИ родительской цепочки записи тоже независимы — и трасса переноса
                // показала, что именно этот хвост шёл строго по одному (WRITE#25…#30, пик 1),
                // пока три другие фазы держали пятёрку. Зависимость здесь ровно одна: id
                // продолжения возвращает `_m_new`, поэтому дети ждут его. Всё остальное — разные
                // записи, и они идут пулом. Потолок соблюдается семафором в `post` (вложенные
                // пулы суммарно не дают больше MAX_PARALLEL_WRITES).
                //   шаг 1: правка резки A (её Обеспечения + Партии ГП) — один пул;
                //   шаг 2: продолжения B — пул сегментов, внутри сегмента цепочка по новому id.
                // Барьер между шагами оставлен намеренно: доля сегмента 0 у Обеспечения A должна
                // быть записана до того, как появятся Обеспечения сегментов 1..N (иначе между
                // запросами существует момент, когда покрытие позиции задвоено).
                var aFixTasks = [];
                // 2a) уменьшить Обеспечение A до доли сегмента 0.
                shareBySupply.forEach(function(item) {
                    aFixTasks.push(function() {
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
                    aFixTasks.push(function() {
                        var seg0 = (demandByBatchSeg[String(st.id)] || [])[0] || 0;
                        var f = buildFinishedBatchFields(fbMeta, {
                            planned: finishedBatchRolls(st.qty, aRuns),
                            rolls: seg0 > 0 ? seg0 : ''
                        });
                        if (!Object.keys(f).length) return;
                        return self.post('_m_set/' + st.id + '?JSON', f);
                    });
                });
                var cChain = runWithConcurrency(aFixTasks, MAX_PARALLEL_WRITES);
                // 2b) каждое продолжение B (сегменты 1..N) — разные записи, идут параллельно.
                var segTasks = crs.map(function(cr, ci) {
                    var segIdx = ci + 1;
                    return function() {
                        var cutFields = buildFields(cutReqIds, {
                            status: (parentCut && parentCut.status) || CUT_STATUSES[0],
                            slitter: (upd && upd.slitterId != null) ? upd.slitterId : (parentCut && parentCut.slitter && parentCut.slitter.id),   // #4085: голова переназначена слоем размещения → продолжение на тот же станок
                            // #4155: «Партия сырья» головы цепочки (не пустой parentCut.batchId,
                            // который отчёт cut_planning не отдаёт) — иначе продолжение без сырья.
                            // #4452: если у головы её нет, партию разрешил страж (cr.materialBatchId:
                            // «Расход сырья» → FIFO активной партии) — продолжение не рождается пустым.
                            materialBatch: (cr.materialBatchId != null && String(cr.materialBatchId) !== '')
                                ? String(cr.materialBatchId) : batchForCutId(parentId),
                            // #3795: «Вид сырья» цепочки → продолжение. Карточка очереди берёт сырьё
                            // из cut_material (своего реквизита резки), а обеспечения продолжения не
                            // привязаны к нему по «Заданию», поэтому materialByCut его не восстановит.
                            material: parentMaterial,
                            plannedRuns: cr.plannedRuns,
                            // #3923: «Очередность» не пишем — порядок задаёт planStart (главное значение).
                            // #4128: намотка цепочки (у ГОЛОВЫ, не у прямого родителя) — иначе пустая
                            // намотка реюзнутого продолжения расползалась на новые сегменты.
                            winding: windingForCutId(parentId),
                            // #3569: лидер родителя (одна метка из cut_leader) → id справочника.
                            leader: self.resolveLeaderId(parentCut && parentCut.leaders && parentCut.leaders.length === 1 ? parentCut.leaders[0] : ''),
                            // #3781: «Метраж, м» = длина прогона цепочки. Без неё cutRunLength брал
                            // поделённый метраж обеспечения и показывал заниженную длину.
                            length: parentRunLen > 0 ? round3(parentRunLen) : '',
                            // #3892: «ID первой части» = id головы (parentId) — связывает продолжение
                            // с первой частью явно, без эвристики continuationSignature.
                            // #4564: cr.firstPartSelf — запись рождается САМОСТОЯТЕЛЬНЫМ заданием
                            // (сама себе голова). Её id известен только после `_m_new`, поэтому
                            // маркер дописывается ниже; здесь поле не пишем вовсе.
                            firstPart: cr.firstPartSelf ? ''
                                : ((cr.firstPartId != null && cr.firstPartId !== '') ? String(cr.firstPartId) : String(parentId))
                        });
                        // #3916: продолжение дробления — «Длительность»/«Резка и Лидер» по его
                        // проходам (cr.plannedRuns), длина прогона/фольга — головы (parentId).
                        Object.assign(cutFields, splitSegTimingFields(parentId, cr.plannedRuns));
                        cutFields = addMainValueField(cutMeta, cutFields, cr.planStartTs);
                        return self.post('_m_new/' + cutMeta.id + '?JSON&up=1', cutFields).then(function(res) {
                            var bId = res && (res.obj || res.id || res.i);
                            if (!bId) throw new Error('Сервер не вернул id продолжения задания');
                            if (cr && cr.planCols) planColsByCut[String(bId)] = cr.planCols;   // #4499
                            // #4171: трасса КОРНЯ сироты (#4163/#4168) — продолжение с ПУСТОЙ намоткой рвёт
                            // continuationSignature и висит «нет связей». После фикса windingForCutId это НЕ
                            // должно случаться; если случилось — печатаем, ПОЧЕМУ голова не резолвится.
                            if (normWinding(windingForCutId(parentId)) === '') {
                                var trHead = chainHeadById[String(parentId)] || String(parentId);
                                console.warn('[pp] #4171 продолжение ' + bId + ' СОЗДАНО с ПУСТОЙ намоткой (станет сиротой) — parentId=' + parentId
                                    + ' head=' + trHead + ' parentInCuts=' + !!cutsById[String(parentId)]
                                    + ' headInCuts=' + !!cutsById[trHead] + ' проходы=' + cr.plannedRuns);
                            }
                            var stripMap = {};
                            if (typeof ops.onCreated === 'function') ops.onCreated(cr, String(bId));
                            // Главное значение B (плановое время старта) — _m_save с t{tableId}.
                            var bChain = Promise.resolve().then(function() {
                                // #4564: запись, рождённая САМОСТОЯТЕЛЬНЫМ заданием, ссылается «ID
                                // первой части» на саму себя — как голова цепочки (#3892). Пишем
                                // здесь, потому что до `_m_new` этого id не существовало.
                                if (!(cr && cr.firstPartSelf && firstPartReqId)) return;
                                var selfFp = {}; selfFp['t' + firstPartReqId] = String(bId);
                                return self.post('_m_set/' + bId + '?JSON', selfFp);
                            }).then(function() {
                                var ts2 = Number(cr.planStartTs);
                                if (!mainKey || !(isFinite(ts2) && ts2 > 0)) return;
                                var mf = {}; mf[mainKey] = String(ts2);
                                return self.post('_m_save/' + bId + '?JSON', mf);
                            });
                            // #4480: «Партии ГП» продолжения — независимые записи под одним
                            // родителем bId: пулом. Барьер после них обязателен — «Обеспечения»
                            // ниже вешаются на СОЗДАННУЮ партию (stripMap), которой до ответа нет.
                            bChain = bChain.then(function() {
                                return runWithConcurrency((parentStrips || []).map(function(st) {
                                    return function() {
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
                                    };
                                }), MAX_PARALLEL_WRITES);
                            });
                            // #4480: «Обеспечения» продолжения — тоже независимые записи, пулом.
                            bChain = bChain.then(function() {
                                return runWithConcurrency(shareBySupply.map(function(item) {
                                    return function() {
                                        var sh = item.shares[segIdx] || { rolls: 0, footage: 0 };
                                        // #4158: даже при НУЛЕВОЙ доле (floor=0 и метраж→0) создаём
                                        // связующее Обеспечение — иначе задание-продолжение не привязано
                                        // к позиции заказа (второй симптом #4155). Нужна лишь позиция.
                                        if (item.s.positionId == null) return;
                                        var fb = stripMap[String(item.s.finishedBatchId)] || item.s.finishedBatchId;
                                        // #4536: доля количества уходит в запись, ТОЛЬКО если оно
                                        // известно. Раньше здесь стоял `sh.rolls > 0 ? sh.rolls : 0`
                                        // — и при неизвестном количестве (отчёт колонку не отдаёт,
                                        // rolls=null) продолжение рождалось с «Кол-во рулонов» = 0,
                                        // то есть заявляло, что заказу с него не достанется ничего.
                                        var f = buildSupplyFieldsForFinishedBatch(supMeta, {
                                            finishedBatchId: fb,
                                            footage: sh.footage > 0 ? sh.footage : '',
                                            rolls: sh.rolls == null ? null : sh.rolls,
                                            active: '1', status: SUPPLY_STATUSES[0]
                                        });
                                        return self.post('_m_new/' + supMeta.id + '?JSON&up=' + encodeURIComponent(item.s.positionId), f);
                                    };
                                }), MAX_PARALLEL_WRITES);
                            });
                            return bChain;
                        });
                    };
                });
                return cChain.then(function() { return runWithConcurrency(segTasks, MAX_PARALLEL_WRITES); });
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
        
                // #4480: порядок ступеней обязателен (обеспечения → партии ГП → сама резка:
                // удаление родителя раньше детей даёт 409 «есть ссылки»), а ВНУТРИ ступени
                // записи независимы — пулом. Было по одному запросу за раз.
                // 1) удаляем обеспечения (отсутствующие — пропускаем, #3895)
                var inner = runWithConcurrency(supplyIds.map(function(sid) {
                    return function() { return delMissingOk(sid); };
                }), MAX_PARALLEL_WRITES);
                // 2) удаляем партии ГП
                inner = inner.then(function() {
                    return runWithConcurrency(Object.keys(fbIds).map(function(fbId) {
                        return function() { return delMissingOk(fbId); };
                    }), MAX_PARALLEL_WRITES);
                });
                // 3) удаляем саму резку
                inner = inner.then(function() { return delMissingOk(cutId); });
                return inner;
            }).then(splitBump).catch(softSkip); };
        });
        // #4014: три фазы пулом по MAX_PARALLEL_SPLIT, с БАРЬЕРАМИ между ними, затем reload +
        // persistCutSetupColumns, как в прежней цепочке.
        //
        // #4598: ПРОДОЛЖЕНИЯ РОЖДАЮТСЯ РАНЬШЕ, ЧЕМ УРЕЗАЮТСЯ ГОЛОВЫ (creates → updates → deletes).
        // Запись не атомарна: реальная ошибка реджектит пул ПЕРВОЙ ошибкой, и то, что успела
        // применить предыдущая фаза, остаётся в базе. Пока головы урезались ПЕРВЫМИ, сбой на
        // creates оставлял задание с проходами сегмента, а остаток не появлялся НИКОГДА — работа
        // исчезала молча (боевая ateh 04.08.2026: 5 заданий, 581 шт. недобора по §15; у 658253
        // «Кол-во резок план» 1 при 6 в хранимом «Тайминге», обеспечение целое — 210 = 35×6).
        // Порядок фаз и есть лекарство: create-задача сама приводит голову в порядок (её
        // «Обеспечения» и «Партии ГП» — `aFixTasks` выше), поэтому голова остаётся нетронутой,
        // пока её продолжение не создано. Теперь сбой оставляет ЛИШНЮЮ работу — задание целое, а
        // созданное продолжение видно оператору и на Ганте, — а не потерянную: то же
        // предпочтение, что у deviationSettlePlan («лучше оставить задание целым, чем разрезать
        // его и потерять остаток», 00-core-data.js). Данные creates от updates не зависят: голову,
        // её партии, сырьё и намотку create-путь читает из ПАМЯТИ (cutsById/self.supplies) и из
        // БД до правок, а не из результата updates.
        // #4618: НАМЕРЕНИЕ — в журнал ДО записи. Если действие умрёт на полпути (сеть, шлюз,
        // отброшенная операция), по остаткам в базе уже не восстановить, что оно собиралось
        // сделать; эта строка — единственный свидетель. Подробности пишем ПОСЛЕ фаз, чтобы не
        // занимать пул записи плана (#4477/#4480).
        var jSnapshot = (self.cuts || []).map(function(c) {
            return { id: String(c.id), plannedRuns: c.plannedRuns, firstPartId: c.firstPartId };
        });
        journalBegin(self, 'applySplitPlan');
        var jBegin = planJournal(self, {
            event: 'SESSION', before: null, after: null,
            details: 'операций: updates ' + ((ops.updates || []).length) +
                ', creates ' + ((ops.creates || []).length) +
                ', deletes ' + ((ops.deletes || []).length) +
                (ops.manual ? ', ручное действие' : '')
        });
        return jBegin.then(function() {
            return runWithConcurrency(createTasks, MAX_PARALLEL_SPLIT);
        }).then(function() {
            return runWithConcurrency(updateTasks, MAX_PARALLEL_SPLIT);
        }).then(function() {
            return runWithConcurrency(deleteTasks, MAX_PARALLEL_SPLIT);
        }).then(function() {
            // #4628: доли обеспечения — ПОСЛЕ проходов: они считаются по итоговым числам звеньев.
            // Отдельной фазой, а не внутри update-задачи, потому что доля звена зависит от ВСЕЙ
            // цепочки (Σ рулонов позиции делится между сегментами), а update видит одну запись.
            if (!shareFixTasks.length) return null;
            console.log('[pp] 🧮 #4628: доля обеспечения приводится к проходам звена — записей:', shareFixTasks.length);
            return runWithConcurrency(shareFixTasks, MAX_PARALLEL_SPLIT);
        }).then(function() {
            return journalApplyDetails(self, jSnapshot, ops);
        }).then(function() { return self.reload(); }).then(function() {
            return self.reconcileOrphanOrderSupplies();   // #4175: реюз рвёт связь заказа ЭТИМ разбиением — восстанавливаем ПОСЛЕ reload
        }).then(function() {
            return self.persistCutSetupColumns(null, planColsByCut,
                (ops && ops.manual) ? { manual: true } : null);   // #3698 + #4499: колонки — от упаковщика
        }).then(function() {
            return self.reconcilePlanStarts();   // #4438: план и хранимые колонки обязаны сойтись СРАЗУ
        }).then(function() {
            self.hideProgress(); self.setBusy(false); self.render();
            self.reportPlanAudit(ops && ops.audit);          // #4475: план ЗАПИСАН с отклонениями — говорим об этом здесь
            self.reportOverfilledDays(ops && ops.audit);     // #4497: день длиннее смены — по ХРАНИМЫМ минутам
            return true;
        }).catch(function(err) {
            self.hideProgress(); self.setBusy(false);
            self.notify('Ошибка разбиения заданий: ' + err.message, 'error');
            return false;
        });
    };

    // #4475: сказать оператору об отклонениях ЗАПИСАННОГО плана — ОДНИМ сообщением и на языке
    // экрана (станок подписью, день датой, задание номером). Разбор для разработчика уже лежит в
    // журнале (console.error в buildSequenceOps), сюда он не попадает: оператору нечего делать с
    // именем правила. Пусто → молчим (говорить не о чем, а не «всё скрыли»).
    // → массив нарушений, о которых сказали (для тестов и трассы).
    // #4497: ПОТОЛОК ДНЯ ПРОВЕРЯЕМ ПО ТОМУ ЖЕ, ЧТО ВИДИТ ОПЕРАТОР — по ХРАНИМЫМ минутам
    // («Наладка ножей» + «Сырьё/намотка» + «Резка и Лидер», ровно сумма бейджа «(N мин)»), и
    // делаем это в ОБЩЕЙ точке записи плана: через applySplitPlan проходят «Сгенерировать»,
    // «Упорядочить», ручной перенос 🗓, ↑↓ и перетаскивание.
    //
    // ПОЧЕМУ НЕ ХВАТАЛО ТОГО, ЧТО БЫЛО. Правило `DAY_CAPACITY` реестра меряет `ops.dayLoad` —
    // числа САМОГО упаковщика. Они всегда в пределах потолка (проверено перебором раскладок),
    // поэтому нарушение по хранимым колонкам этот шлюз поймать не может в принципе: он спрашивает
    // подсудимого. А `levelDayLoad`/`warnOverfilledDays` звались только с ручных путей ↑↓ и
    // перетаскивания — перенос между днями и обе кнопки заканчивались молча. Отсюда «502 мин» в
    // бейдже без единого слова (боевое, Станок 1, 29.07.2026).
    //
    // Здесь НЕ переставляем: перенесённое задание обязано лежать целиком (#4488), а на путях
    // кнопок раскладку уже сделал упаковщик. Задача — не дать переполнению пройти МОЛЧА.
    //
    // ОДНО СООБЩЕНИЕ (#4475): если про потолок дня уже сказал аудит плана (`DAY_CAPACITY` в
    // `ops.audit` — упаковщик сам увидел перебор), второй тост не шлём: факт тот же, мерки разные.
    // В консоль пишем всегда — разработчику нужна ИМЕННО хранимая сумма, аудит её не меряет.
    //   audited — отклонения плана (`ops.audit`), о которых уже сказал reportPlanAudit.
    // → массив станков, у которых нашлись переполненные дни (для тестов).
    AtexProductionPlanning.prototype.reportOverfilledDays = function(audited) {
        if (typeof this.overfilledDaysOf !== 'function') return [];   // стаб-self в юнит-тестах
        var self = this, hit = [];
        var saidAlready = (audited || []).some(function(v) { return v && v.rule === 'DAY_CAPACITY'; });
        (this.slitters || []).forEach(function(s) {
            var sid = String(s && s.id == null ? '' : s.id);
            if (sid === '') return;
            var days = self.overfilledDaysOf(sid);
            if (!days.length) return;
            hit.push(sid);
            if (typeof console !== 'undefined' && console.error) {
                console.error('[pp] ⛔ #4497 станко-день ДЛИННЕЕ смены по ХРАНИМЫМ минутам',
                    { slitterId: sid, days: overfilledDaysBrief(days) });
            }
            // #4618: переполненный день — в журнал. По нему видно, ради чего упаковщик рвал
            // задания: если день ВСЁ РАВНО выше потолка, дробление цели не достигло (#4617).
            planJournalRows(self, days.slice(0, 12).map(function(d) {
                return { event: 'DAY_OVER', cut: d.cutId, slitter: self.slitterLabel ? self.slitterLabel(sid) : sid,
                         day: d.dayOffset == null ? '' : String(d.dayOffset),
                         before: d.capMin, after: d.endMin,
                         details: 'день выше потолка на ' + d.overMin + ' мин (' + d.endMin +
                                  ' при ' + d.capMin + '), последнее задание ' + d.cutId };
            }));
        });
        // #4531: ОДНО сообщение на все станки. Прежде тост слался в цикле — по станку на каждый, и
        // оператор получал стопку одинаковых на вид предупреждений без единого имени станка.
        if (hit.length && !saidAlready && typeof this.warnOverfilledDays === 'function') this.warnOverfilledDays(hit);
        return hit;
    };

    // Переполненные дни в журнал — без объекта задания (#4531 кладёт его рядом для подписи).
    function overfilledDaysBrief(days) {
        return (days || []).map(function(d) {
            return { dayOffset: d.dayOffset, endMin: d.endMin, overMin: d.overMin,
                     capMin: d.capMin, cutId: d.cutId, seq: d.seq };
        });
    }

    AtexProductionPlanning.prototype.reportPlanAudit = function(violations) {
        var msg = this.planAuditMessage(violations);
        if (!msg || typeof this.notify !== 'function') return msg ? msg.items : [];
        // Вид тоста пишем ЛИТЕРАЛОМ: по ним же проверяется, что у каждого вида есть фон в CSS
        // (#4409, `experiments/atex-4409-optimize-trace.test.js` сканирует notify(..., 'вид')).
        if (msg.kind === 'error') this.notify(msg.text, 'error');
        else this.notify(msg.text, 'warning');
        return msg.items;
    };

    // #4475: нарушения стража → фраза на языке ЭТОГО экрана (подписи станков и дни — из состояния
    // контроллера). Отдаёт и цельный текст (запись плана), и отдельные фразы `items` (отказ
    // «Упорядочить»: там свой хвост — «снимите лишние 🔒 или освободите день»). Пусто → null.
    AtexProductionPlanning.prototype.planAuditMessage = function(violations) {
        var list = (violations || []).filter(function(v) { return v && v.rule; });
        if (!list.length) return null;
        var byId = {};
        (this.slitters || []).forEach(function(s) { byId[String(s.id)] = s.label || ('#' + s.id); });
        return formatPlanAuditMessage(list, {
            slitterLabel: function(id) { return byId[String(id)] || ('станок #' + id); },
            dayLabel: function(key) {
                var dt = dayKeyToDate(key);
                return dt ? formatPlanDayHeading(dt.getTime(), 0) : String(key);
            },
            limit: 3
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
            // #4108: слой размещения (#4085) может переназначить СТАНОК, оставив planStart и проходы
            // прежними — та же позиция дня, но на другом станке (напр. первое задание дня 08:00 на
            // обоих). Такой апдейт нёс ТОЛЬКО смену «Слиттера»; без этой ветки он отсеивался, станок
            // в БД оставался прежним, а очередь другого станка пересобиралась БЕЗ него → два задания
            // в одно время на одном станке (дубль-08:00 на Ганте, issue #4108). u.slitterId есть только
            // в слот-режиме (#4085); сравнение — как в applySplitPlan (пустой станок → '').
            var slitterChanged = (u.slitterId != null)
                && String(u.slitterId) !== (cut.slitter ? String(cut.slitter.id) : '');
            // #4452: страж восстановил «Партию сырья» (ТЗ §15, CUT_BATCH) — апдейт несёт ТОЛЬКО её,
            // planStart и проходы прежние. Без этой ветки он отсеивался бы как «ничего не изменилось»,
            // партия в базе оставалась пустой, и лишняя смена сырья возвращалась при каждом чтении.
            // Сравниваем с ХРАНИМЫМ (batchIdStored, снимок до лечения), а не с c.batchId — тот уже
            // вылечен в памяти и всегда «совпал бы».
            var batchStored = String((cut.batchIdStored != null ? cut.batchIdStored : cut.batchId) || '');
            var batchChanged = (u.materialBatchId != null && String(u.materialBatchId) !== '')
                && String(u.materialBatchId) !== batchStored;
            return tsChanged || runsChanged || slitterChanged || batchChanged;
        });
    }

    // #4085: слой размещения (модель #3985) — ПО УМОЛЧАНИЮ ВКЛЮЧЁН (размещение перебором всех точек
    // вставки по минимальному штрафу; срок/фольга — локальные штрафы). Выключается только явным
    // SLOT_PLACEMENT=0 в «Настройке» — аварийный рубильник на прежний путь без EDD/жёсткой фольги/резерва
    // (дрейф #4050/#4059/#4068 удалён; при OFF порядок — только по переналадке/полосам).
    AtexProductionPlanning.prototype.slotPlacementOn = function() {
        var v = (this.daySettings || {}).SLOT_PLACEMENT;
        return String(v == null ? '' : v).trim() !== '0';
    };

    // #4139: внутридневная пересортировка очереди станка после реальной упаковки — ПО УМОЛЧАНИЮ
    // ВКЛЮЧЕНА. Выключается INTRA_DAY_RESEQUENCE=0 в «Настройке» (аварийный рубильник на порядок
    // слоя размещения как есть). Работает только в слот-режиме и не при preserveOrder.
    AtexProductionPlanning.prototype.intraDayResequenceOn = function() {
        var v = (this.daySettings || {}).INTRA_DAY_RESEQUENCE;
        return String(v == null ? '' : v).trim() !== '0';
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
        // #4195: фолбэк срока из cut_planning (supply.dueKey) в РАЗМЕЩЕНИЕ по дням — ТОЛЬКО на пути
        // ручного переноса 🗓 (moveScope.pinCutIds, #4074). Задание-сирота дробления (#4163/#4175), чья
        // позиция выпала из активного positions_list, держит срок ЛИШЬ в обеспечении; без фолбэка слой
        // размещения его срока не видит → штраф DEADLINE_COST не применяется → перенос+пересборка
        // уводят сироту ЗА срок (issue #4195). Общий путь (генерация, «Упорядочить») фолбэк НЕ включает:
        // включённый глобально (PR#4196) он дал заданиям без активной позиции срок «сегодня» → конкуренция
        // за забитый день 0 → просрочка уже при ПЕРВОМ планировании, которой не было (#4197, откат #4198).
        // #4221: ручной перенос — и приколотый (pinCutIds), и «По весу» (weightPositionCutIds).
        var honorSupplyDue = !!(moveScope && ((moveScope.pinCutIds && moveScope.pinCutIds.length)
            || (moveScope.weightPositionCutIds && moveScope.weightPositionCutIds.length)));
        // #4194: множество «заказов» каждой резки (id заказов обеспечиваемых позиций, supply.orderNo) —
        // для штрафа/бонуса смежности заказа в слое размещения (scorePosition). Задание может нести
        // НЕСКОЛЬКО заказов (джамбо на несколько позиций); пустой orderNo (сирота #4175/склад) — пропуск.
        var orderIdsByCut = {};
        (self.supplies || []).forEach(function(s) {
            if (!s || s.cutId == null) return;
            var oid = String(s.orderNo == null ? '' : s.orderNo).trim();
            if (oid === '') return;
            var cid = String(s.cutId);
            (orderIdsByCut[cid] = orderIdsByCut[cid] || {})[oid] = true;
        });
        cuts.forEach(function(c) {
            perPassByCut[String(c.id)] = windingMinutes(cutRunLength(c, self.supplies, self.positionLengthById), windPointsForCut(c, windPoints)); // #3606/#4501
            var off = dayOffsetFromBase(c.planDate, planBaseMidnightMs);
            if (off != null) dayAnchorByCut[String(c.id)] = off;
            var dueKeys = cutDueKeys(c, self.supplies, self.genPositions, honorSupplyDue);   // #4050 / #4195: фолбэк только при ручном переносе
            if (dueKeys && dueKeys.length) {
                var dueOff = dueDayOffsetFromBase(dueKeys[0], planBaseMidnightMs);
                if (dueOff != null) dueDayByCut[String(c.id)] = dueOff;
                dueKeyByCut[String(c.id)] = dueKeys[0];   // #4085
            }
        });
        // #4221: перенос 🗓 «По весу» — задание держим на ВЫБРАННОМ дне и отдаём ПОЗИЦИЮ в дне слою
        // размещения по наилучшему весу. dayLockByCut[id] = день-смещение (из плейсхолдер-«Даты план»,
        // dayAnchorByCut) → в computeSlotPlacement задание кладётся ПОДВИЖНЫМ с замком дня/станка. День
        // держит сам замок (не effAnchor: приколотым fixed задание НЕ помечаем — иначе осело бы в начало).
        var dayLockByCut = {};
        if (moveScope && moveScope.weightPositionCutIds && moveScope.weightPositionCutIds.length) {
            moveScope.weightPositionCutIds.forEach(function(id) {
                var off = dayAnchorByCut[String(id)];
                if (off != null) dayLockByCut[String(id)] = off;
            });
        }
        // #4488 (ТЗ §15): задание, которое двигал ОПЕРАТОР, встаёт в выбранный день ЦЕЛИКОМ —
        // упаковщик резервирует под него место в этом дне, и соседи уезжают на следующий день сами.
        // День берём из того же плейсхолдер-якоря, что и замок (dayAnchorByCut → смещение от «С»).
        var wholeDayByCut = {};
        if (moveScope && moveScope.wholeDayCutIds && moveScope.wholeDayCutIds.length) {
            moveScope.wholeDayCutIds.forEach(function(id) {
                var off = dayAnchorByCut[String(id)];
                if (off != null) wholeDayByCut[String(id)] = off;
            });
        }
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
        // #3974: вход планировщика = всё НЕОБЕСПЕЧЕННОЕ — ОТКРЫТЫЕ задания, за ЛЮБЫЕ даты. Фильтра
        // по [С; По] на входе больше нет: раньше scope-диапазон заодно отсекал прошлое/готовое,
        // теперь отбираем явно, а [С; По] — окно РАЗМЕЩЕНИЯ (база = «С», splitMachineQueue набивает
        // от неё и переливает за «По»).
        // #4572: ВЫПОЛНЕННОЕ ЗАДАНИЕ — ФАКТ, А НЕ ПЛАН. «Открытое» = нет «Закончено» (и статус не
        // «Завершён»). Одного статуса мало: отчёт `cut_planning` колонку статуса не отдаёт вовсе
        // (в боевой ateh у ВСЕХ заданий приходит ''/'X'), поэтому фильтр по нему не отсеивал
        // ничего — в раскладку шли и 111 давно выполненных заданий. Их день планировщик считал
        // своим решением и переносил: выполненная часть, чей фактический день — суббота 01.08,
        // «не удержала день» как нерабочий (#4434) и уехала на 04.08 — с планом в будущем и фактом
        // в прошлом она тут же стала «выполнено досрочно» (issue #4572). Переставлять то, что уже
        // сделано, нельзя: работа шла в тот день, какой был, включая выходной.
        var planInput = (cuts || []).filter(function(c){
            if (String(c && c.status || '').trim() === 'Завершён') return false;
            return planTsSeconds(c && c.endDate) == null;
        });
        // #4294: задания ПРОШЛЫХ дней (запланированные раньше «С») НЕ пере-планируем — они уже стоят на
        // своих днях. Планировщик кладёт всё от «С» вперёд (#3974) и день держит лишь у 🔒 (fixedDay),
        // поэтому НЕзафиксированное задание прошлого дня иначе затягивалось в «С» (issue #4294). Исключаем
        // из входа ВСЮ цепочку с незафиксированной головой раньше «С» (движок фикс-цепочку держит сам).
        // #3876: станок в длинном отпуске на день базы входит в окно обнулённым. #4300: свежая копия —
        // можно переопределять по станкам (planningPrevSetupBySlitter возвращает новый объект каждый раз).
        var prevSetupBySlitter = self.planningPrevSetupBySlitter(planBaseMidnightMs);
        // #4300/#4312: задания станка ПРОШЛЫХ дней несут его заправку к началу окна — ЕДИНСТВЕННЫЙ её
        // источник (#4371). Без неё первая резка окна зарядила бы переналадку с нуля: окно упаковщика >
        // хранимой наладки → «дыра» после первого задания дня. computeCutSetupUpdates считает ту же
        // резку near-zero переналадкой от вчерашней — так упаковщик с ней сходится.
        // #4312: берём по ВСЕЙ очереди станка (cuts, любой статус/замок), а не по резкам, вырезанным
        // из planInput механизмом #4294: «Завершён» в planInput не доходит, а зафиксированную цепочку
        // не возвращает cutsBeforeWindowToKeep — в обоих случаях дыра возвращалась (issue #4312).
        // #4330: раньше блок стоял под `if (!moveScope)` — ручной перенос 🗓 его ПРОПУСКАЛ, и на move-пути
        // planStart (упаковщик) расходился с колонками наладки (computeCutSetupUpdates считает по всей
        // очереди) → дыры/нахлёсты 15/30/45 мин после переноса. Применяем carry-override + исключение
        // прошлых дней НА ВСЕХ путях, включая перенос: тогда упаковщик и колонки сходятся, как при
        // генерации. Перенесённое (будущий день) не исключается (голова ≥ «С»); scope/приколка переноса
        // (ниже) не затрагиваются. К просрочке непричастно: путь переноса пересобирает ПО СРОКАМ.
        var carryBeforeWindow = prevSetupBeforeWindow(cuts, planBaseMidnightMs);
        Object.keys(carryBeforeWindow).forEach(function(sid){ prevSetupBySlitter[sid] = carryBeforeWindow[sid]; });
        var keepIds = cutsBeforeWindowToKeep(cuts, planBaseMidnightMs);
        if (keepIds.length) {
            var keepSet = {};
            keepIds.forEach(function(id){ keepSet[String(id)] = true; });
            planInput = planInput.filter(function(c){ return !keepSet[String(c && c.id)]; });
        }
        // #4221/#4225: «В пределах одного станка» — пересобираем ТОЛЬКО задействованные переносом станки
        // (исходный + целевой; при переносе в тот же станок — он один). Во вход планировщика берём лишь
        // их задания (прочие станки не трогаются и не заимствуются), а slitterIds ниже сужаем до них же.
        // Чтобы перенос НЕ КИДАЛ задания между станками, каждое задание замыкаем на СВОЙ станок
        // (machineLockByCut → lockSlitter в слое размещения): миграция запрещена, порядок пересобирается
        // на каждом станке отдельно, а исходный станок при смене станка тоже перепаковывается (его дыра
        // от ушедшего задания залечивается).
        var withinSids = (moveScope && moveScope.withinSlitterIds && moveScope.withinSlitterIds.length)
            ? moveScope.withinSlitterIds.map(String) : null;
        var machineLockByCut = {};
        if (withinSids != null) {
            planInput = planInput.filter(function(c){
                return withinSids.indexOf(String(c && c.slitter && c.slitter.id != null ? c.slitter.id : '')) >= 0;
            });
            // Замок станка нужен, лишь когда в scope >1 станка (иначе мигрировать некуда): держим каждое
            // задание на его текущем станке, чтобы пересборка по срокам не перекидывала задания A↔B.
            if (withinSids.length > 1) {
                planInput.forEach(function(c){
                    var m = String(c && c.slitter && c.slitter.id != null ? c.slitter.id : '');
                    if (m !== '') machineLockByCut[String(c.id)] = m;
                });
            }
        }
        // #4074: ручной перенос 🗓 пересобирает план ПО СРОКАМ (deadlineAware, как «Упорядочить»,
        // preserveOrder=false), чтобы задания не уезжали за срок. Прежде перенос завершался
        // preserveOrder-пересборкой (deadlineAware выкл): она паковала всё от «С» вперёд без учёта
        // сроков и толкала задания за их срок («перенос с несоблюдением сроков», issue #4074).
        // Перенесённое задание при этом ЗАКРЕПЛЯЕМ на выбранном пользователем дне: временно помечаем
        // c.fixed (как 🔒 «замок дня») — planCutOperations держит его день (effAnchorByCut от «Даты
        // план»), остальное раскладывает по срокам вокруг. Замок снимаем в finally (c.fixed мутируем на
        // общих объектах self.cuts только на время планирования). Без moveScope — прежнее поведение.
        // #4434 п.1: замок дня АБСОЛЮТЕН — «Упорядочить»/«Сгенерировать»/баланс/рескью не переносят
        // зафиксированное (🔒) задание на другой день НИ ПО КАКОЙ причине. Прежний список
        // rescueUnpinIds (#4424: «рескью просроченного 🔒 снимает замок дня») убран вместе с самим
        // рескью 🔒 — просрочку приколотого задания показываем (панель «просрочено», лог #4200),
        // а решение оставляем оператору.
        var pinnedRestore = [];
        if (moveScope && moveScope.pinCutIds && moveScope.pinCutIds.length) {
            var pinSet = {};
            moveScope.pinCutIds.forEach(function(id){ pinSet[String(id)] = true; });
            planInput.forEach(function(c){
                if (c && !c.fixed && pinSet[String(c.id)]) { c.fixed = true; pinnedRestore.push(c); }   // временный замок перенесённого
            });
        }
        // #4326 (Вариант A) + #4436: задания ЗАМОРОЖЕННЫХ дней ОСТАЮТСЯ во входе планировщика,
        // пришпиленные к своему дню (временный c.fixed → planCutOperations держит день по
        // dayAnchorByCut). Это принципиально: упаковщик обязан ВИДЕТЬ их конфигурацию, иначе первая
        // резка следующего планируемого дня считает переналадку не от того предшественника — и в плане
        // появляется фантомная «дыра в полчаса», которой нет в хранимых колонках (issue #4438,
        // та же природа, что #4300/#4312/#4315/#4371). ЗАПИСЬ по ним отсекается ниже (#4436:
        // ops.updates/creates/deletes фильтруются по замороженным дням), а хранимый тайминг не трогает
        // computeCutSetupUpdates. Итог: планировщик замороженный день СЧИТАЕТ, но НЕ МЕНЯЕТ.
        // Работает на всех путях (генерация/«Упорядочить»/↑↓/удаление/перенос).
        // Пустая «Дата план» → dayIsFrozen=false.
        // #4577: ДНИ, КОТОРЫХ КАСАЕТСЯ ТЕКУЩЕЕ РУЧНОЕ ДЕЙСТВИЕ, для него РАЗМОРОЖЕНЫ. Ровно правило
        // заказчика: «ручная перестановка игнорирует замороженность дня». Заморозка живёт в четырёх
        // механизмах (пиннинг входа, предикат упаковщика, страж записи, выравнивание дня) — и
        // отключать её надо во всех сразу, иначе получается полумера: работу в день положили, а
        // вынести лишнее оттуда некому (боевое #4577: 95 мин остатка + 425 мин 🔒 = 520 при 455).
        // Замок 🔒 при этом НЕ снимается: день выравнивается разрывом последнего задания по потолку
        // (#4467/#4512), а не вытеснением зафиксированного.
        var unfrozenDays = {};
        ((moveScope && moveScope.unfrozenDayKeys) || []).forEach(function(k){
            if (k != null && k !== '') unfrozenDays[String(k)] = true;
        });
        function manualUnfrozen(planDateOrTs) {
            if (!Object.keys(unfrozenDays).length) return false;
            var k = planDateDayKey(planDateOrTs);
            return k != null && k !== Infinity && !!unfrozenDays[String(k)];
        }
        if (self.meta && self.meta.freeze && self.freezeByDay && Object.keys(self.freezeByDay).length) {
            // #4569: задание, которое оператор несёт ПРЯМО СЕЙЧАС, замороженный день не пришпиливает —
            // ручное действие сильнее заморозки (решение заказчика 02.08.2026), и правило обязано
            // действовать в ОБОИХ механизмах. Страж такие операции уже не отбрасывает (FROZEN_DAY);
            // если бы пиннинг остался, команда всё равно выполнялась бы наполовину: операций нет —
            // значит время задания осталось прежним (у только что созданного — плейсхолдерным).
            // Чужие задания замороженного дня пришпилены, как и были.
            planInput.forEach(function(c){
                if (c && !c.fixed && !manualUnfrozen(c.planDate) && self.dayIsFrozen(c.planDate)) {
                    c.fixed = true; pinnedRestore.push(c);
                }
            });
        }
        // #4555: «Пересчитать отсюда и до конца» — ПРОШЛОЕ НЕПРИКОСНОВЕННО. Всё, что стои́т на том
        // же станке РАНЬШЕ выбранного задания (по хранимому planStart: и прежние дни, и соседи
        // левее в его дне), закрепляем тем же приёмом, что замороженные дни и начатые задания —
        // временный c.fixed → planCutOperations держит их день по dayAnchorByCut. Упаковщик их
        // ВИДИТ (иначе первая пересчитываемая резка посчитает переналадку не от того
        // предшественника — #4438), но не двигает. Другие станки закрывает withinSlitterIds.
        if (moveScope && moveScope.keepBeforeCutId != null && String(moveScope.keepBeforeCutId) !== '') {
            var keepAnchor = planInput.filter(function(c) {
                return c && String(c.id) === String(moveScope.keepBeforeCutId);
            })[0];
            var keepTs = keepAnchor ? Number(keepAnchor.planDate) : NaN;
            var keepSid = keepAnchor ? String(keepAnchor.slitter && keepAnchor.slitter.id != null ? keepAnchor.slitter.id : '') : '';
            if (isFinite(keepTs) && keepTs > 0) {
                planInput.forEach(function(c) {
                    if (!c || c.fixed) return;
                    var csid = String(c.slitter && c.slitter.id != null ? c.slitter.id : '');
                    if (csid !== keepSid) return;
                    var ts = Number(c.planDate);
                    if (!isFinite(ts) || ts >= keepTs) return;
                    c.fixed = true; pinnedRestore.push(c);
                });
            }
        }
        // #4381: НАЧАТЫЕ задания (заполнено «Начато») неприкосновенны и для пересборки — иначе
        // «Упорядочить»/перенос/«Урегулировать» уводили бы с их дня то, что уже идёт на станке.
        // Приём тот же, что у замороженных дней: временный c.fixed (снимается в общем finally) →
        // planCutOperations держит их день по dayAnchorByCut. Это ЗАКРЕПЛЕНИЕ (Вариант A #4326),
        // а не жёсткий блок дня — просрочки оно не создаёт (#4338).
        planInput.forEach(function(c){
            if (c && !c.fixed && cutIsStarted(c)) { c.fixed = true; pinnedRestore.push(c); }
        });
        // #4326-seal: предикат «день заморожен» (по смещению от базы плана) для упаковщика
        // splitMachineQueue: НОВЫЕ резки в замороженный день НЕ кладём (существующие уже закреплены
        // выше и остаются на своём дне). Так «заморозка» = «планировщик не запихнёт в день ничего»
        // (в отличие от прежнего Варианта A, где срочные всё равно вставали). Активен только при
        // наличии таблицы «Заморозка» и хотя бы одного дня; иначе null → упаковщик работает как прежде.
        var frozenDayFor = (self.meta && self.meta.freeze && self.freezeByDay && Object.keys(self.freezeByDay).length)
            ? function(dayOffset){
                var ms = planBaseMidnightMs + Number(dayOffset) * 86400000;
                if (manualUnfrozen(Math.floor(ms / 1000))) return false;   // #4577: день ручного действия
                return self.dayIsFrozen(ms);
              }
            : null;
        var fixedDayLost = [];   // #4434 п.1: 🔒, которым не удалось удержать свой день (день нерабочий)
        var fixedDayHeld = [];   // #4512: 🔒, УДЕРЖАННЫЕ в своём дне — их день вправе уйти за потолок
        // #4434 п.2: задание, которое ВИДНО в очереди, но НЕ попало во вход планировщика (цепочка
        // прошлых дней #4294, чужой станок при переносе «в пределах станка»), стои́т своим сегментом
        // внутри окна и физически занимает станок. Без резерва упаковщик набивал тот же день с 08:00
        // поверх него — «2 задания в 1 день в 8 утра». Отдаём занятое время станку как простой.
        // «Завершён» сюда НЕ берём: такие задания очередь не показывает (renderQueue), значит и
        // наложения на экране не бывает, а молча срезать ими ёмкость дня — потеря без видимой причины.
        var inPlanIds = {};
        planInput.forEach(function(c){ if (c && c.id != null) inPlanIds[String(c.id)] = true; });
        var excludedIds = (cuts || []).filter(function(c){
            return c && c.id != null && !inPlanIds[String(c.id)]
                && String(c.status || '').trim() !== 'Завершён';
        }).map(function(c){ return String(c.id); });
        var blockedBySlitter = self.blockedRangesBySlitter(planBaseMidnightMs);   // #3764: окна «Отпуска» по станкам
        var occupiedByExcluded = excludedCutBlockedRanges(cuts, excludedIds, planBaseMidnightMs);
        Object.keys(occupiedByExcluded).forEach(function(sid){
            blockedBySlitter[sid] = mergeBlockedRanges(blockedBySlitter[sid] || [], occupiedByExcluded[sid]);
        });
        var ops;
        var cutsById0 = {};   // #4525: «день сейчас» для проверки, правда ли план двигает 🔒
        (cuts || []).forEach(function(c){ if (c && c.id != null) cutsById0[String(c.id)] = c; });
        try {
        self.plannedTailSetup = {};   // #4144: решение упаковщика по хвостам этого плана (см. computeCutSetupUpdates)
        ops = planCutOperations(planInput, {
            onTailSetup: function(slitterKey, planStartTs, split) { self.plannedTailSetup[tailSetupKey(slitterKey, planStartTs)] = split; },
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
            dayLockByCut: dayLockByCut,   // #4221: перенос «По весу» — замок дня/станка (позиция в дне по весу)
            pinDayPosByCut: (moveScope && moveScope.pinDayPosByCut) || null,   // #4464: перенос «в начало дня» / «в конец дня»
            wholeDayByCut: wholeDayByCut,   // #4488: перенесённое задание ложится в свой день ЦЕЛИКОМ, соседи уступают
            machineLockByCut: machineLockByCut,   // #4225: «В пределах одного станка» — задание не мигрирует между станками
            dueDayByCut: dueDayByCut,   // #4050: срок каждой резки (индекс дня от «С») для §8-штрафа размещения
            // #4434 п.1: 🔒 не удержало свой день (день нерабочий — выходной/праздник/«Отпуск») —
            // единственный оставшийся случай сдвига зафиксированного. Не молчим: собираем и говорим.
            onFixedDayLost: function(cutId, fixedDay, placedDay) {
                fixedDayLost.push({ cutId: String(cutId), fixedDay: fixedDay, placedDay: placedDay });
            },
            // #4512 (решение заказчика 30.07.2026): 🔒 УДЕРЖАНА в своём дне — вытеснять её нельзя,
            // поэтому день вправе уйти за потолок. Вердикт нужен стражу DAY_CAPACITY, чтобы не
            // объявлять такой перебор нарушением (его сообщения видит оператор, #4475).
            onFixedDayHeld: function(cutId, fixedDay) {
                fixedDayHeld.push({ cutId: String(cutId), fixedDay: fixedDay });
            },
            firstCutSetup: true,   // #3669 п.2: первая задача очереди резервирует настройку ножей
            prevSetupBySlitter: prevSetupBySlitter,   // #3876: станок в отпуске обнулён; #4300/#4312: заправка из заданий прошлых дней
            gapFill: true,   // #3739: не оставлять простоев в смене — тянуть будущие резки в хвост, нахлёст разрешён
            blockedRangesBySlitter: blockedBySlitter,   // #3764: окна «Отпуска» + #4434 п.2: время исключённых из раскладки заданий
            // #4314: длинные отпуска — первая резка после них считает настройку с нуля (typeof-гард, как
            // у slotPlacementOn выше: в юнит-тестах buildSequenceOps зовут на стаб-self без прототипа).
            longVacationRangesBySlitter: (self && typeof self.longVacationRangesBySlitter === 'function')
                ? self.longVacationRangesBySlitter(planBaseMidnightMs) : {},
            // #4085: модель #3985 — размещение перебором точек вставки (по умолчанию выкл, настройка SLOT_PLACEMENT)
            slotPlacement: slotOn,
            // #4139: внутридневная пересортировка после упаковки (день фиксирован → сроки не трогаем)
            intraDayResequence: (self && typeof self.intraDayResequenceOn === 'function') ? self.intraDayResequenceOn() : true,
            slitterIds: withinSids != null ? withinSids : (self.slitters || []).map(function(s){ return String(s.id); }),   // #4221/#4225: «В пределах одного станка» — только задействованные станки
            dueKeyByCut: dueKeyByCut,
            orderIdsByCut: orderIdsByCut,   // #4194: заказы заданий для штрафа/бонуса смежности (слой размещения)
            feasibleMachineFor: slotOn ? feasibleMachineFor : null,
            machineDayOffFor: slotOn ? machineDayOffFor : null,
            frozenDayFor: frozenDayFor   // #4326-seal: новые резки в замороженный день не кладём
        });
        } finally {
            pinnedRestore.forEach(function(c){ c.fixed = false; });   // #4074: снять временный замок перенесённого задания
        }
        // #4434 п.1: замок дня не соблюдён — говорим оператору (в консоли уже кричит движок).
        if (fixedDayLost.length && ops) ops.fixedDayLost = fixedDayLost;
        if (fixedDayHeld.length && ops) ops.fixedDayHeld = fixedDayHeld;   // #4512
        // #4525: у записей о снятом замке ДВА потребителя, и вопросы у них разные.
        //   • СТРАЖ (#4512, `isFixedReleasedCut`) спрашивает «законно ли упаковщик отпустил этот
        //     замок» — ему нужен ПОЛНЫЙ список движка, включая пробные раскладки: сузив его, мы
        //     заставили бы шлюз выбросить законную операцию, а это дороже лишнего тоста.
        //   • ОПЕРАТОР спрашивает «что сделал мой план» — а `onFixedDayLost` срабатывает и в
        //     ПРОБНЫХ раскладках (рескью просрочки перебирает станки-кандидаты, #4118/#4203).
        //     Станок в «Отпуске» на всю неделю давал красный тост о сдвиге 🔒, которая на своём дне
        //     и осталась (issue #4525: в логе 218 записей и ни одной по этому заданию).
        // Поэтому список для тоста — ОТДЕЛЬНЫЙ: те записи, у которых план правда меняет день.
        if (fixedDayLost.length && ops) {
            ops.fixedDayLostReal = realFixedDayLost(fixedDayLost, ops,
                function(id){ return planDateDayKey((cutsById0[String(id)] || {}).planDate); },
                function(ts){ return planDateDayKey(String(ts)); });
        }
        // #4436: ЗАПИСЬ в замороженный день отсекаем. Планировщик его СЧИТАЕТ (иначе у первой резки
        // следующего дня неверный предшественник и в плане появляется фантомная «дыра в полчаса»,
        // #4438), но НЕ МЕНЯЕТ: обновления «Даты план», удаления и новые сегменты по заданиям
        // замороженных дней в базу не идут. Признак замороженности берём по ХРАНИМОЙ «Дате план»
        // (где задание стои́т сейчас) и по дню, куда план предлагает его положить, — ни туда, ни
        // оттуда двигать нельзя. Хранимый тайминг тех же заданий не переписывает computeCutSetupUpdates.
        // Проверка идёт через РЕЕСТР (05-invariants.js, PP_INVARIANTS), а не условиями по месту:
        // то же правило обязано действовать на всех путях записи, и оно должно быть одно.
        if (ops) {
            var frozenNow = {}, fixedNow = {}, dayKeyNow = {}, cutsById = {};
            var freezeOn = !!(self.meta && self.meta.freeze && self.freezeByDay && Object.keys(self.freezeByDay).length);
            (cuts || []).forEach(function(c){
                if (!c || c.id == null) return;
                var key = String(c.id);
                if (freezeOn && !manualUnfrozen(c.planDate) && self.dayIsFrozen(c.planDate)) frozenNow[key] = true;
                if (c.fixed) fixedNow[key] = true;
                dayKeyNow[key] = planDateDayKey(c.planDate);
                cutsById[key] = c;   // #4524: корень цепочки дробления для правила CHAIN_SETUP_ONCE
            });
            // #4494: задание, которое ОПЕРАТОР сам перенёс сейчас (🗓). Только ему разрешён разрыв по
            // потолку в замороженном дне: день не может быть длиннее смены, а состав дня при этом не
            // меняется — лишнее уезжает продолжением. Признак — тот же, по которому #4490 резервирует
            // ему место в дне (moveScope.wholeDayCutIds).
            // #4512: «оператор двигает ЭТО задание сейчас» — одно понятие, собранное из ВСЕХ полей,
            // которыми контроллер это выражает. Реальный путь ставит `wholeDayCutIds` всегда (#4488) и
            // дополнительно `pinCutIds` («в начало/в конец дня») либо `weightPositionCutIds` («по
            // весу», #4506). Читать только первое — значит зависеть от того, каким полем позвали:
            // синтетический scope с одним `pinCutIds` уже дал бы стражу «это не ручной перенос» и
            // отброшенную операцию по заданию, которое оператор несёт сам.
            var manualMoveNow = {};
            [(moveScope && moveScope.wholeDayCutIds) || [],
             (moveScope && moveScope.pinCutIds) || [],
             (moveScope && moveScope.weightPositionCutIds) || []].forEach(function(list){
                list.forEach(function(id){ manualMoveNow[String(id)] = true; });
            });
            var guard = guardPlanOps(ops, {
                isFrozenCut: function(id){ return !!frozenNow[String(id)]; },
                isFrozenTs: function(ts){ return freezeOn && !manualUnfrozen(String(ts)) && self.dayIsFrozen(String(ts)); },
                isFixedCut: function(id){ return !!fixedNow[String(id)]; },
                isManualMoveCut: function(id){ return !!manualMoveNow[String(id)]; },
                dayKeyOfCut: function(id){ var k = dayKeyNow[String(id)]; return k == null || k === Infinity ? null : k; },
                dayKeyOfTs: function(ts){ var k = planDateDayKey(String(ts)); return k == null || k === Infinity ? null : k; },
                // #4512: замок снят упаковщиком ЗАКОННО (день физически нерабочий) — единственный
                // случай, когда 🔒 вправе сменить день. Страж НЕ пересчитывает законность: он
                // спрашивает того, кто её установил (`onFixedDayLost` → `ops.fixedDayLost`).
                isFixedReleasedCut: function(id){
                    var lost = (ops && ops.fixedDayLost) || [];
                    for (var i = 0; i < lost.length; i++) if (String(lost[i].cutId) === String(id)) return true;
                    return false;
                },
                // #4512: станко-дни, где 🔒 УДЕРЖАНА (вытеснять нельзя) — их перебор законен.
                // Ключ — как у dayLoadMinutes («станок|ГГГГММДД»): станок берём по самому заданию,
                // упаковщик его не знает.
                fixedHeldDays: function(){
                    var heldRows = (ops && ops.fixedDayHeld) || [];
                    if (!heldRows.length) return [];
                    var sidByCut = {};
                    (cuts || []).forEach(function(c){ if (c && c.id != null) sidByCut[String(c.id)] = String(c.slitterId == null ? '' : c.slitterId); });
                    var out = [];
                    heldRows.forEach(function(h){
                        var sid = sidByCut[String(h.cutId)];
                        if (sid == null) return;
                        var dayKey = planDateDayKey(String(Math.floor((planBaseMidnightMs + Number(h.fixedDay) * 86400000) / 1000)));
                        if (dayKey == null || dayKey === Infinity) return;
                        var key = sid + '|' + dayKey;
                        if (out.indexOf(key) === -1) out.push(key);
                    });
                    return out;
                },
                // #4467: занятость станко-дня из самой раскладки (ops.dayLoad: «станок|смещение дня»)
                // и потолок дня — ёмкость смены (окно резки минус обед) плюс нахлёст настройки. Ровно
                // та арифметика, что стои́т в бейдже «(N мин)» у даты.
                dayLoadMinutes: function(){
                    var raw = (ops && ops.dayLoad) || null;
                    if (!raw) return null;
                    var out = {};
                    Object.keys(raw).forEach(function(k){
                        var parts = String(k).split('|');
                        var dayKey = planDateDayKey(String(Math.floor((planBaseMidnightMs + Number(parts[1]) * 86400000) / 1000)));
                        out[parts[0] + '|' + dayKey] = raw[k];
                    });
                    return out;
                },
                dayCapacityMin: function(){
                    var cap = dayCapacityMinutes(dayWindow, 'cuts');   // #4563: один потолок на всех
                    return cap > 0 ? cap : 0;
                },
                // #4469: недоупакованные станко-дни раскладки (ops.dayFill: остаток дня и цена одного
                // прохода первого задания следующего дня). Считает упаковщик своим гейтом потолка —
                // снаружи ту же мерку не воспроизвести. Смещение дня → ключ ГГГГММДД, как у dayLoad.
                underfilledDays: function(){
                    return ((ops && ops.dayFill) || []).map(function(u){
                        var dayKey = planDateDayKey(String(Math.floor((planBaseMidnightMs + Number(u.day) * 86400000) / 1000)));
                        return { key: String(u.slitterId) + '|' + dayKey, freeMin: u.freeMin,
                                 needMin: u.needMin, donorCutId: u.donorCutId };
                    });
                },
                // #4464: ХРАНИМЫЙ план — по нему правило FIXED_BLOCK видит, какие 🔒 стояли подряд
                // и в каком порядке (операции несут только изменившиеся записи, #3427).
                // #4488: chainId («ID первой части») — по нему правило CHAIN_CONTIGUOUS видит, какие
                // записи суть части одного задания и не разъехались ли они по станку.
                planSnapshot: function(){
                    return (cuts || []).filter(function(c){ return c && c.id != null; }).map(function(c){
                        return { id: String(c.id),
                                 slitterId: String((c.slitter && c.slitter.id) == null ? '' : c.slitter.id),
                                 planStartTs: Number(c.planDate), fixed: !!c.fixed,
                                 chainId: String(c.firstPartId == null ? '' : c.firstPartId).trim() };
                    });
                },
                // #4452: разрешение «Партии сырья» задания — правило CUT_BATCH сперва ЧИНИТ операцию
                // (проставляет партию), а нарушением считает только то, что разрешить не удалось.
                resolveBatchForCut: (self && typeof self.resolveBatchForCut === 'function')
                    ? function(id){ return self.resolveBatchForCut(id); } : null,
                // #4524: минуты ОДНОЙ смены ножей и ОДНОЙ смены сырья — те же, которыми считает
                // упаковщик (this.changeTimes), и корень цепочки дробления задания. По ним правило
                // CHAIN_SETUP_ONCE видит, не посчитали ли наладку разорванного задания дважды.
                knifeSetupMin: function(){
                    var t = self.changeTimes || {};
                    return Number(t.KNIFE != null ? t.KNIFE : DEFAULT_OP_TIMES.KNIFE) || 0;
                },
                materialSetupMin: function(){
                    var t = self.changeTimes || {};
                    return Number(t.MATERIAL_WINDING != null ? t.MATERIAL_WINDING : DEFAULT_OP_TIMES.MATERIAL_WINDING) || 0;
                },
                chainIdOfCut: function(id){
                    var c = cutsById[String(id)];
                    if (!c) return null;
                    var fp = String(c.firstPartId == null ? '' : c.firstPartId).trim();
                    return fp !== '' ? fp : String(c.id);
                },
                // #4536: ХРАНИМЫЕ проходы задания. По ним шлюз держит целостность разорванного по
                // дням задания (операции цепочки живут или отбрасываются ВМЕСТЕ), а правило
                // SUPPLY_CONSERVED считает выпуск записей, которых операции не касаются (#3427:
                // в операции попадает только изменившееся).
                plannedRunsOfCut: function(id){
                    var c = cutsById[String(id)];
                    if (!c || c.plannedRuns == null || String(c.plannedRuns) === '') return null;
                    var n = Number(c.plannedRuns);
                    return isFinite(n) ? n : null;
                },
                // #4536: кто что выпускает. «Обеспечение» связывает задание с позицией заказа, а
                // «Кол-во полос» его «Партии ГП» говорит, сколько штук этой позиции даёт ОДИН
                // проход. Полосы берём из cut_strips (self.stripsByBatch): «Кол-во рулонов»
                // обеспечения отчёт не отдаёт, да и выпуск определяется РАСКРОЕМ, а не хранимой
                // копией количества.
                coverageLinks: function(){
                    var strips = self.stripsByBatch || {};
                    var out = [];
                    (self.supplies || []).forEach(function(s){
                        if (!s || s.positionId == null || s.cutId == null || String(s.cutId) === '') return;
                        var per = Number(strips[String(s.finishedBatchId)]) || 0;
                        if (!(per > 0)) return;
                        out.push({ cutId: String(s.cutId), positionId: String(s.positionId), rollsPerRun: per });
                    });
                    return out;
                },
                // #4536: заказанное количество позиции (positions_list). Номер заказа для фразы
                // оператору — из обеспечения (cut_planning отдаёт order_no): в genPositions лежит
                // только id заказа. Позиции не загружены (напр. «Упорядочить» без генерации) →
                // пусто → правило молчит (нет данных — нет обвинений).
                positionDemand: function(){
                    var orderNoByPos = {};
                    (self.supplies || []).forEach(function(s){
                        if (s && s.positionId != null && s.orderNo) orderNoByPos[String(s.positionId)] = String(s.orderNo);
                    });
                    var out = {};
                    (self.genPositions || []).forEach(function(p){
                        if (!p || p.id == null || String(p.id) === '') return;
                        var qty = Number(p.qty) || 0;
                        if (!(qty > 0)) return;
                        out[String(p.id)] = { qty: qty, width: Number(p.width) || 0,
                                              orderNo: orderNoByPos[String(p.id)] || '' };
                    });
                    return out;
                }
            }, 'auto');
            if (guard.skipped) console.log('[pp] 🔒 #4436: замороженные дни не трогаем — отброшено записей плана:', guard.skipped);
            // #4618: ЧТО ИМЕННО СНЯЛ СТРАЖ — в журнал. Счётчика `skipped` для расследования мало:
            // потеря проходов выглядит как «голова урезана, продолжения нет», и вопрос всегда один
            // — сняли ли `create` продолжения. Состав считаем разницей исходных операций и
            // прошедших, чтобы не менять реестр правил (#4515: страж работает для любого правила).
            journalGuardDrops(self, ops, guard);
            // #4536: страж вернул задание целиком — часть его операций отбросило правило, и остаток
            // сняли, чтобы работа (а с ней и обеспечение заказа) не потерялась.
            if ((guard.restoredChains || []).length) {
                console.log('[pp] 🧷 #4536: операции задания сняты ЦЕЛИКОМ (иначе часть проходов исчезла бы) — цепочки:',
                    guard.restoredChains.join(', '));
            }
            // #4452: страж восстановил «Партию сырья» в операциях — она уйдёт в базу вместе с планом.
            if ((guard.filled || []).length) {
                console.log('[pp] 🧵 #4452: «Партия сырья» проставлена в операции плана: ' + guard.filled.length,
                    { filled: guard.filled.slice(0, 40) });
            }
            // #4475: РАСЧЁТ ПЛАНА ОПЕРАТОРУ НЕ ГОВОРИТ НИЧЕГО. buildSequenceOps зовут и для
            // КАНДИДАТОВ «Упорядочить» (B и A), которые тут же выбрасываются, — тост отсюда сообщал
            // о плане, которого не будет, и словами разработчика («так быть не должно — детали в
            // консоли»). Нарушения уходят в ЖУРНАЛ (полный разбор, ниже) и вызывающему в
            // `ops.ruleAudit`; оператору о них говорит тот, кто ПИШЕТ план (applySplitPlan →
            // reportPlanAudit) или ОТКАЗЫВАЕТ («Упорядочить», #4471). Молчания нет — сменился адресат.
            var noBatch = (guard.violations || []).filter(function(v){ return v.rule === 'CUT_BATCH'; });
            if (noBatch.length) {
                // #4452: партию не удалось разрешить ни одним источником — ошибка ДАННЫХ: такое
                // задание оплачивает ложную смену сырья с каждым соседом.
                console.error('[pp] ⛔ #4452: план пишется с заданиями БЕЗ «Партии сырья»: '
                    + noBatch.map(function(v){ return '#' + v.cutId + ' (' + v.msg + ')'; }).join('; '));
            }
            // #4464: 🔒-монолит разорван — РЕГРЕССИЯ движка (ТЗ §15), а не выбор планировщика:
            // порядок обязан соблюдаться по построению (слой размещения / упаковщик / пересортировка).
            var blockViol = (guard.violations || []).filter(function(v){ return v.rule === 'FIXED_BLOCK'; });
            if (blockViol.length) {
                console.error('[pp] ⛔ #4464: нарушен монолит зафиксированных заданий — '
                    + blockViol.map(function(v){ return '#' + v.cutId + ' (' + v.msg + ')'; }).join('; '));
            }
            // #4497: перед 🔒 что-то встало — регрессия движка (ТЗ §15): порядок обязан соблюдаться по
            // построению (слой размещения не даёт точки перед 🔒, упаковщик берёт 🔒 раньше свободных и
            // не рвёт задание в день, чья голова 🔒).
            var pushViol = (guard.violations || []).filter(function(v){ return v.rule === 'FIXED_NO_PUSH'; });
            if (pushViol.length) {
                console.error('[pp] ⛔ #4497: зафиксированное задание сдвинуто вставкой — '
                    + pushViol.map(function(v){ return v.msg; }).join('; '));
            }
            // #4467: день длиннее смены с нахлёстом — тоже регрессия движка (ТЗ §15): лишнее обязано
            // уезжать на следующий день, а длинное — рваться по потолку.
            var capViol = (guard.violations || []).filter(function(v){ return v.rule === 'DAY_CAPACITY'; });
            if (capViol.length) {
                console.error('[pp] ⛔ #4467: день сверх потолка — ' + capViol.map(function(v){ return v.msg; }).join('; '));
            }
            // #4469: день недоупакован — разбитое по дням задание обязано отдать вчерашнему дню
            // максимум проходов, влезающих под потолок.
            var fillViol = (guard.violations || []).filter(function(v){ return v.rule === 'DAY_FILL'; });
            if (fillViol.length) {
                console.error('[pp] ⛔ #4469: день недоупакован — ' + fillViol.map(function(v){ return v.msg; }).join('; '));
            }
            // Правила-наблюдатели (enforce:false) ничего не отбрасывают — только сообщают, что
            // сработали бы. По этому журналу и решается, включать ли им запрет.
            var watched = (guard.violations || []).filter(function(v){
                return v.rule !== 'FROZEN_DAY' && v.rule !== 'CUT_BATCH' && v.rule !== 'FIXED_BLOCK'
                    && v.rule !== 'DAY_CAPACITY' && v.rule !== 'DAY_FILL' && v.rule !== 'FIXED_NO_PUSH'; });
            if (watched.length) {
                console.log('[pp] ⚠️ инварианты-наблюдатели сработали бы:',
                    watched.map(function(v){ return v.rule + ' #' + v.cutId + ' (' + v.msg + ')'; }).join('; '));
            }
            // #4471: нарушения ФОРМЫ ПЛАНА (ТЗ §15) — отдаём вместе с операциями. «Упорядочить»
            // обязано знать, что кандидат нарушает жёсткое правило: применить такой план нельзя,
            // а молчать о нём — значит снова оставить оператора с «кнопка ничего не делает».
            // CUT_BATCH сюда НЕ входит: это ошибка ДАННЫХ записи (пустая партия), одинаковая у всех
            // кандидатов и у текущего плана, — вето по ней заблокировало бы «Упорядочить» навсегда.
            // FIXED_CUT_DAY тоже нет: у него есть ЗАКОННЫЙ случай (день 🔒 стал нерабочим, #4434 п.1).
            ops.ruleBreaks = (guard.violations || []).filter(function(v){
                // #4497: «перед 🔒 ничего не ставим» — тоже форма плана: кандидат, который сдвигает
                // зафиксированное, не применяется, и причина называется оператору.
                return v.rule === 'FIXED_BLOCK' || v.rule === 'DAY_CAPACITY' || v.rule === 'FIXED_NO_PUSH';
            });
            // #4475: ВСЁ, о чём стоит сказать оператору, если этот план будет ЗАПИСАН. Передаётся в
            // applySplitPlan вместе с операциями (`ops.audit`) — фразу собирает formatPlanAuditMessage.
            // FROZEN_DAY сюда не идёт: нарушающие операции страж уже отбросил (enforce), записи не будет.
            ops.ruleAudit = (guard.violations || []).filter(function(v){ return v.rule !== 'FROZEN_DAY'; });
        }

        var cutsById = {};
        cuts.forEach(function(c) { cutsById[String(c.id)] = c; });
        return { ops: ops, cutsById: cutsById };
    };

    AtexProductionPlanning.prototype.autoSequenceQueue = function(strategy, preserveOrder, moveScope) {
        var self = this;
        this._ppOp = 'autoSequenceQueue';   // #4177: контекст трассы записей (async)
        if (!(self.cuts && self.cuts.length)) return Promise.resolve(false);
        // #4424: ПЕРЕД раскладкой сливаем задания одного заказа и одной конфигурации в ОДНО «по
        // первому по порядку» (mergeSameOrderTasks): иначе одна работа живёт тремя записями, каждая
        // со своей наладкой, и разъезжается по дням. Слияние идёт в БД и перечитывает очередь, дальше
        // планируем уже объединённое. Нечего сливать → 0 и ни одной записи (идемпотентно).
        return self.mergeSameOrderTasks().then(function() {
            return self.autoSequenceQueueAfterMerge(strategy, preserveOrder, moveScope);
        });
    };

    // #4424: раскладка как раньше — вызывается после объединения дублей заказа.
    AtexProductionPlanning.prototype.autoSequenceQueueAfterMerge = function(strategy, preserveOrder, moveScope) {
        var self = this;
        if (!(self.cuts && self.cuts.length)) return Promise.resolve(false);
        var built = self.buildSequenceOps(self.cuts, strategy, preserveOrder, moveScope);   // #4074: moveScope.pinCutIds — закрепить перенесённое задание при пересборке по срокам
        var ops = built.ops;
        // #4200: после ЛЮБОЙ пересборки (генерация/«Упорядочить»/ручной перенос/«Пересчитать наладку»)
        // задания, ОСТАВШИЕСЯ за сроком по календарю (рескью #4118 не смог — честный дефицит ёмкости),
        // ОРЁМ громко (ТЗ §14/#4059, [[crm-no-silent-fallback]]): не молча. Панель «просрочено: N» (#4161)
        // это же показывает визуально; здесь — безусловный след в консоли (slotTrace могут выключить).
        if (ops && ops.overdue && ops.overdue.length) {
            try {
                console.error('[pp] ⛔ #4200 ПОСЛЕ пересборки (' + (preserveOrder ? 'preserveOrder' : 'по срокам')
                    + ') осталось за сроком заданий: ' + ops.overdue.length + ' — '
                    + ops.overdue.map(function(o){ return 'резка ' + o.cutId + ' (кал.день ' + o.realDay + ' > срок(день) ' + o.dueDay + ')'; }).join('; ')
                    + '. Честный дефицит ёмкости: без вытеснения соседей не размещается.');
            } catch (e) {}
        }
        // #4434 п.1: зафиксированное задание не удержало свой день — единственный допустимый случай
        // (день нерабочий: выходной/праздник/«Отпуск» станка). Не молчим: тост + консоль (уже в движке).
        // #4525: берём СПИСОК ДЛЯ ОПЕРАТОРА (`fixedDayLostReal`) — только то, что делает
        // записываемый план. Полный `ops.fixedDayLost` остаётся стражу (#4512).
        var lostToSay = (ops && ops.fixedDayLostReal) || [];
        if (lostToSay.length) {
            // #4475: называем сами задания — «детали в консоли» оператору ничего не даёт.
            self.notify('Зафиксированные (🔒) задания сдвинуты: №'
                + lostToSay.slice(0, 3).map(function(f){ return f.cutId; }).join(', №')
                + (lostToSay.length > 3 ? ' и ещё ' + (lostToSay.length - 3) : '')
                + ' — их день нерабочий (выходной/праздник или «Отпуск» станка), замок дня в такой'
                + ' день удержать нельзя.', 'warning');
        }
        var changedUpdates = filterChangedUpdates(ops, built.cutsById);
        // #4462: ИСТОРИЯ ВЫБОРА МЕСТА для подсказки в очереди — ТОЛЬКО по заданиям, которые план
        // реально тронул (changedUpdates + головы новых сегментов). На нетронутой карточке разбор
        // описывал бы прошлое, а не то, что оператор сейчас видит. Живёт до следующей пересборки:
        // перечитывание очереди (reload) его не сбрасывает, иначе подсказка гасла бы сразу после
        // перестановки — ровно в тот момент, когда её и открывают («почему сюда?»).
        var touched4462 = changedUpdates.map(function(u){ return String(u.cutId); })
            .concat(((ops && ops.creates) || []).map(function(cr){ return String(cr.parentCutId); }));
        self._placementByCut = placementTitlesByCut(ops && ops.placement, touched4462);
        if (!changedUpdates.length && !(ops.creates || []).length && !(ops.deletes || []).length) {
            // #4175: переставлять/дробить нечего (план оптимален), НО заказное задание-сирота (#4163→#4175)
            // не участвует в ops и висит «нет связей». applySplitPlan здесь не зовётся, значит его
            // пост-reload восстановление не сработает. Восстанавливаем связь и тут, иначе «Упорядочить»/
            // «Сгенерировать» на стабильном плане её не чинит. Восстановили → render.
            return self.reconcileOrphanOrderSupplies().then(function(n) {
                if (n > 0) self.render();
                // #4519: переставлять нечего — но день мог остаться ДЛИННЕЕ смены (перенесённое
                // задание приколото целиком, #4488). Потолок старше ответа «план оптимален».
                return self.levelOverfilledAfterWrite(moveScope, n > 0);
            });
        }
        // #4475: audit — отклонения, которые несёт ЗАПИСЫВАЕМЫЙ план; о них скажет applySplitPlan.
        return self.applySplitPlan({ updates: changedUpdates, creates: ops.creates, deletes: ops.deletes,
            audit: ops.ruleAudit || [] }).then(function(applied) {
                return self.levelOverfilledAfterWrite(moveScope, applied);
            });
    };

    // #4519 (ТЗ §15): ПОСЛЕ ЛЮБОЙ ПЕРЕСБОРКИ ДЕНЬ СВЕРХ ПОТОЛКА ВЫРАВНИВАЕТСЯ САМ. Разрыв последнего
    // задания дня по потолку и перенос остатка на следующий день умеет `levelDayLoad` (#4473), но
    // звался он только из «↻ Пересчитать наладку»: после ручного переноса 🗓 день оставался распухшим
    // (боевое — Пн 03.08.2026, 757 мин при потолке 460), и оператору приходилось нажимать
    // «Упорядочить»/«Пересчитать наладку» руками (issue #4519).
    //
    // ПОЧЕМУ ЗДЕСЬ. `autoSequenceQueueAfterMerge` — ОБЩАЯ точка: через неё проходят «Сгенерировать»,
    // «Упорядочить», «Пересчитать наладку», ручной перенос 🗓, ↑↓ и перетаскивание. Оба её выхода
    // (записали план / писать было нечего) обязаны оставить день в пределах смены.
    //
    // ПОЧЕМУ ЭТО ПОМОГАЕТ, ЕСЛИ УПАКОВЩИК УЖЕ ПАКОВАЛ. Перенесённое задание приколото «целиком»
    // (#4488, `wholeDayCutIds`) — упаковщик его не рвёт, и день честно уходит за потолок. Выравнивание
    // зовёт ту же раскладку БЕЗ этого прикола (`levelDayLoad` → withinSlitterIds), поэтому последнее
    // задание дня рвётся по потолку, а остаток уезжает продолжением — ровно то, что оператор получал
    // руками.
    //
    // РЕКУРСИИ НЕТ: выравнивание пишет план тем же путём, поэтому на время его работы стои́т флаг —
    // второй круг не запускается, и «разгрузить нечем» (в дне одни 🔒 по одному проходу, проход
    // неделим) заканчивается честным предупреждением `warnOverfilledDays`, а не циклом.
    // → Promise<результат исходной операции> (значение не подменяем: вызывающие смотрят на него).
    // #4577: у РУЧНОГО действия выравнивание дня обязано видеть переполнение и в замороженных днях,
    // которых это действие коснулось, и уметь их переложить — иначе работу туда положили, а вынести
    // лишнее некому (боевое: 95 мин остатка + 425 мин 🔒 = 520 при потолке 455).
    function manualScopeDays(moveScope) {
        return (moveScope && moveScope.unfrozenDayKeys && moveScope.unfrozenDayKeys.length)
            ? moveScope.unfrozenDayKeys.slice() : null;
    }

    AtexProductionPlanning.prototype.levelOverfilledAfterWrite = function(moveScope, result) {
        var self = this;
        if (this._levelingDays) return Promise.resolve(result);
        if (typeof this.overfilledDaysOf !== 'function' || typeof this.levelDayLoad !== 'function') {
            return Promise.resolve(result);   // стаб-self в юнит-тестах
        }
        var ids = (moveScope && moveScope.withinSlitterIds && moveScope.withinSlitterIds.length)
            ? moveScope.withinSlitterIds.map(String)
            : (this.slitters || []).map(function(s) { return String(s && s.id == null ? '' : s.id); });
        var manualDays = manualScopeDays(moveScope);
        // #4582: дни действия надо не только РАЗМОРОЗИТЬ, но и внести в область видимости: состав дня
        // берётся через recalcScopeCutIds, а он ограничен окном фильтра [С;По]. Оператор жмёт кнопку
        // на одном дне, а работа уезжает в другой — и переполнение там оставалось НЕВИДИМЫМ
        // (боевое #4582: 621 мин при потолке 455, и ни одной строки о выравнивании в логе).
        var levelOpts = manualDays
            ? { manual: true, dayKeys: manualDays, unfrozenDayKeys: manualDays } : null;
        var over = ids.filter(function(sid) { return sid !== '' && self.overfilledDaysOf(sid, levelOpts).length > 0; });
        if (!over.length) return Promise.resolve(result);
        this._levelingDays = true;
        return over.reduce(function(chain, sid) {
            return chain.then(function() { return self.levelDayLoad(sid, levelOpts); });
        }, Promise.resolve()).then(function() {
            self._levelingDays = false;
            return result;
        }).catch(function(err) {
            self._levelingDays = false;
            throw err;
        });
    };

    // #4306: ПЕРЕСТАНОВКА задания ВНУТРИ дня перетаскиванием мышью (drag-drop). Работает как ↑↓:
    // переставляет порядок дня и СРАЗУ пересчитывает наладку (#4434 п.3, без кнопки). Механика —
    // как moveCutInDay, но на произвольную позицию: набор сохранённых planStart дня ПЕРЕСТАВЛЯЕТСЯ под
    // новый порядок (реальные времена сохраняются, лишь меняют владельца), пишутся только изменившиеся.
    // #4392: зафиксированные (🔒) — НЕ «стены»: их можно переставлять и тащить сквозь них (день держит
    // фиксация, перестановка меняет planStart в пределах того же дня). «Стена» осталась у начатого (#4381).
    //   dayCuts — резки дня в порядке показа (по planStart); dragId — перетаскиваемое; targetId — на кого бросили.
    AtexProductionPlanning.prototype.reorderCutInDay = function(dayCuts, dragId, targetId, alreadyStitched) {
        var self = this;
        this._ppOp = 'reorderCutInDay';   // #4177/#4480
        if (this.busy) return Promise.resolve(false);
        // #4488: перетаскивание разорванного задания — сперва сшиваем его части (ТЗ §15), затем
        // переставляем уже целое по свежей очереди дня.
        if (!alreadyStitched && splitChainPartsOf(this.cuts || [], dragId).length > 1) {
            var dragged = (this.cuts || []).filter(function(c) { return c && String(c.id) === String(dragId); })[0];
            return this.mergeSplitChain(dragId).then(function() {
                var fresh = dayQueueOf(self.cuts || [], dragged);
                if (!fresh.length) { self.render(); return false; }
                return self.reorderCutInDay(fresh, dragId, targetId, true);
            });
        }
        var arr = (dayCuts || []).slice();
        var mainKey = (this.meta.cut && this.meta.cut.id != null) ? 't' + this.meta.cut.id : null;
        if (!mainKey) { self.notify('Не найден реквизит даты резки', 'error'); return Promise.resolve(false); }
        var byId = {}; arr.forEach(function(c) { byId[String(c.id)] = c; });
        var plan = planDragReorder(arr, dragId, targetId);   // #4306: чистый расчёт перестановки (тест)
        if (plan.error === 'notime') {
            self.notify('Не удаётся переставить: у заданий дня нет времени старта — нажмите «Упорядочить»', 'info');
            return Promise.resolve(false);
        }
        // #4392: ветка error==='fixed' убрана — planDragReorder больше не считает зафиксированные «стеной».
        if (plan.error === 'started') {   // #4381
            self.notify('Начатое задание нельзя переставить (оно «стена»)', 'info');
            return Promise.resolve(false);
        }
        if (!plan.assignments.length) return Promise.resolve(false);
        this.setBusy(true);
        // #4477: перестановка — независимые записи, пишем пулом через шлюз (было — цепочкой в
        // один поток). Совпавшие с хранимым planDragReorder уже не отдаёт, шлюз проверяет ещё раз.
        return postCutStarts(self, plan.assignments.map(function(w) {
            return { cutId: w.id, ts: w.planStartTs, wasTs: byId[String(w.id)] && byId[String(w.id)].planDate };
        })).then(function() { return self.reload(); }).then(function() {
            self.setBusy(false);
            var dc = byId[String(dragId)];
            var sid = (dc && dc.slitter && dc.slitter.id != null) ? String(dc.slitter.id) : '';
            self.render();
            // #4434 п.3: после ручного перетаскивания наладку пересчитываем СРАЗУ, а не показываем
            // кнопку «↻ Пересчитать наладку» (см. moveCutInDay).
            if (typeof self.recalcSetupTiming !== 'function') return true;   // стаб-self в юнит-тестах
            return self.recalcSetupTiming(sid, { auto: true }).then(function() { return true; });
        }).catch(function(err) {
            self.setBusy(false);
            self.reload().then(function() { self.render(); }).catch(function() {});
            self.notify('Ошибка перестановки: ' + (err && err.message || err), 'error');
            return false;
        });
    };

    // #4444: свести СТАРТЫ ПРОЕКЦИИ предпросмотра встык — тем же расчётом, что «↻ Пересчитать
    // наладку» и сводка после записи (#4438). Работает по this.cuts (это уже проекция плана) и
    // правит ДВЕ вещи разом:
    //   • сами резки проекции — их и рисуют карточки, поэтому конец одного задания совпадает с
    //     началом следующего, а день заканчивается там, где велит сумма минут;
    //   • ops — то, что запишет «Применить»: показанное и записываемое обязаны совпадать.
    // Синтетические сегменты дробления (id `preview:N`) записи не имеют — им правим соответствующую
    // строку ops.creates (порядок в projectPlanOnCuts тот же). Замороженные дни не трогаются
    // (recalcScopeCutIds их отсекает, #4436). → число сведённых заданий.
    // #4444/#4446: применить новые старты И к проекции предпросмотра, И к ops (то, что запишет
    // «Применить»): показанное и записываемое обязаны совпадать. Синтетическому сегменту дробления
    // (id `preview:N`) записи нет — ему правим соответствующую строку ops.creates (projectPlanOnCuts
    // нумерует их по порядку). starts: [{ cutId, ts }]. → число применённых.
    AtexProductionPlanning.prototype.applyPreviewStarts = function(starts, ops) {
        var self = this;
        var byId = {};
        (this.cuts || []).forEach(function(c) { if (c && c.id != null) byId[String(c.id)] = c; });
        var updateByCut = {};
        ((ops && ops.updates) || []).forEach(function(u) { if (u) updateByCut[String(u.cutId)] = u; });
        var creates = (ops && ops.creates) || [];
        var n = 0;
        (starts || []).forEach(function(st) {
            var c = byId[String(st.cutId)];
            if (!c) return;
            c.planDate = String(st.ts);
            c.number = String(st.ts);
            n++;
            if (isPreviewCutId(st.cutId)) {
                // #4518: соответствие `preview:N` ↔ строка ops.creates даёт projectPlanOnCuts
                // (`createdFrom`): создание, у которого головы нет в очереди, сегмента не порождает,
                // и «N-й preview = N-й create» тогда промахивается на одну строку.
                var map = self._previewCreateIndex || {};
                var idx = map[String(st.cutId)];
                if (idx == null) idx = Number(String(st.cutId).slice(String(st.cutId).indexOf(':') + 1)) - 1;
                if (creates[idx]) creates[idx].planStartTs = st.ts;
                return;
            }
            if (updateByCut[String(st.cutId)]) updateByCut[String(st.cutId)].planStartTs = st.ts;
            else if (ops && ops.updates) {
                ops.updates.push({ cutId: String(st.cutId), planStartTs: st.ts, plannedRuns: c.plannedRuns });
            }
        });
        return n;
    };

    // #4518: setupUpdates — колонки, которыми предпросмотр УЖЕ мерит план (у него они от упаковщика,
    // #4499). Без них сведение считало занятость своим расчётом и «правило» встык уже сведённый день.
    AtexProductionPlanning.prototype.reconcilePreviewStarts = function(ops, setupUpdates) {
        var self = this;
        if (!(this.cuts && this.cuts.length)) return 0;
        var starts = [];
        var opts = setupUpdates ? { updates: setupUpdates } : null;
        (this.slitters || []).forEach(function(s) {
            var sid = String(s && s.id == null ? '' : s.id);
            if (sid === '') return;
            self.recalcStartUpdates(sid, opts).forEach(function(u) { starts.push({ cutId: String(u.cutId), ts: u.ts }); });
        });
        var fixed = this.applyPreviewStarts(starts, ops);
        if (fixed) {
            try {
                console.warn('[pp] ⚠️ #4444: план упаковщика разошёлся с хранимой наладкой — предпросмотр '
                    + 'показан СВЕДЁННЫМ встык (столько же запишет «Применить»). Заданий: ' + fixed + '.');
            } catch (e) {}
        }
        return fixed;
    };

    // #4440: ЛОКАЛЬНОЕ улучшение порядка — перестановка ВНУТРИ дня, без смены дня и станка.
    //
    // «Упорядочить» строит два ГЛОБАЛЬНЫХ кандидата (B — порядок/дни на текущих станках, A — со
    // сменой станка) и сравнивает их с текущим планом целиком. Если оба вышли хуже, кнопка не делает
    // НИЧЕГО — и очевидно выгодная перестановка соседей внутри одного дня остаётся невыполненной
    // (issue #4440: «выгодно поменять местами 3 и 4»; на стенде ateh1 станок 1279 28.07 стоял
    // 15→15→8→15→8→18 ножей = четыре смены ножей вместо двух).
    //
    // Кандидат «внутри дня» безопасен по построению: состав дня, его номер и станок не меняются —
    // меняется только ПОРЯДОК внутри дня, поэтому сроки (§8 п.4/5) и загрузка дней те же. Считает его
    // тот же движок, что и при генерации, — `resequenceWithinDays` (#4139/#3996: цель —
    // sencingCost с направленным штрафом за рост числа полос; двойная приёмка не даёт разменять
    // цель на реальные минуты наладки).
    //
    // Возвращает { updates, gainByMachine, gainMin } — updates в том же формате, что кандидаты A/B
    // (перестановка = переназначение уже занятых стартов дня новому порядку; точные минуты потом
    // сведёт reconcilePlanStarts, #4438). Пусто → улучшать нечего.
    AtexProductionPlanning.prototype.intraDayImprovementOps = function() {
        var self = this;
        var empty = { updates: [], gainByMachine: {}, gainMin: 0 };
        if (!(this.cuts && this.cuts.length)) return empty;
        var base = planBaseMidnightFrom(this.filter && this.filter.date, controllerNowMs(this));
        if (!isFinite(base)) return empty;
        var times = this.changeTimes;
        var weights = makePlanningOptions(PLANNING_STRATEGY_SETUP, this.changeTimes, this.daySettings);
        // Звено цепочки дробления, у которого есть продолжение на БОЛЕЕ ПОЗДНЕМ дне, обязано
        // оставаться последним в своём дне (#3635 п.5) — это и есть spanningIds для перебора.
        var chains = (mergeContinuationChains(this.cuts).chainByLogical) || {};
        var dayKeyById = {};
        this.cuts.forEach(function(c){ if (c && c.id != null) dayKeyById[String(c.id)] = planDateDayKey(c.planDate); });
        var spanning = {};
        Object.keys(chains).forEach(function(head){
            var members = (chains[head] || [head]).map(String);
            members.forEach(function(m){
                var mine = dayKeyById[m];
                if (mine == null) return;
                if (members.some(function(o){ var d = dayKeyById[o]; return d != null && d > mine; })) spanning[m] = true;
            });
        });
        var carryBy = prevSetupBeforeWindow(this.cuts, base);
        var updates = [], gainByMachine = {}, gainMin = 0;
        (this.slitters || []).forEach(function(s){
            var sid = String(s && s.id == null ? '' : s.id);
            if (sid === '') return;
            var ordered = (self.cuts || []).filter(function(c){
                if (!c || String(c.slitter && c.slitter.id) !== sid) return false;
                if (String(c.status || '').trim() === 'Завершён') return false;
                var ts = Number(c.planDate);
                if (!isFinite(ts) || ts <= 0) return false;
                if (Math.floor((ts * 1000 - base) / 86400000) < 0) return false;   // прошлые дни не трогаем (#4294)
                if (typeof self.dayIsFrozen === 'function' && self.dayIsFrozen(c.planDate)) return false;   // #4436
                if (cutIsStarted(c)) return false;                                  // #4381: начатое неприкосновенно
                return true;
            }).sort(function(a, b){ return Number(a.planDate) - Number(b.planDate); });
            if (ordered.length < 2) return;
            var dayByCut = {};
            ordered.forEach(function(c){ dayByCut[String(c.id)] = Math.floor((Number(c.planDate) * 1000 - base) / 86400000); });
            // #4459: предшественник первого подвижного задания — ФАКТИЧЕСКИЙ сосед слева на станке.
            // Из входа выброшены замороженные (#4436), начатые (#4381) и завершённые задания, но на
            // станке они СТОЯТ: с их ножами и сырьём станок входит в первый переставляемый день.
            // Заправка `prevSetupBeforeWindow` (строго ДО base) годится лишь когда слева нет вообще
            // ничего; иначе вход в день бесплатен для ЛЮБОГО кандидата, и DP ставит первым что
            // угодно — на боевой так уникальные 18 ножей встали в 08:00 перед блоком из 15.
            var chain = (self.cuts || []).filter(function(c){
                if (!c || String(c.slitter && c.slitter.id) !== sid) return false;
                var cts = Number(c.planDate);
                if (!isFinite(cts) || cts <= 0) return false;
                return Math.floor((cts * 1000 - base) / 86400000) >= 0;
            }).sort(function(a, b){ return Number(a.planDate) - Number(b.planDate); });
            var firstTs = Number(ordered[0].planDate);
            var left = null;
            chain.forEach(function(c){ if (Number(c.planDate) < firstTs) left = c; });
            var entry = left || (carryBy[sid] ? carryOverPrevCut(carryBy[sid], ordered[0]) : null);
            var better = resequenceWithinDays(ordered, dayByCut, spanning, entry, times, weights);
            if (!better || better.length !== ordered.length) return;
            var sameOrder = better.every(function(c, i){ return String(c.id) === String(ordered[i].id); });
            if (sameOrder) return;
            // Перестановка = переназначение УЖЕ занятых стартов дня новому порядку (как drag-drop
            // #4306): день, состав дня и станок сохраняются, времена лишь меняют владельца.
            var slotsByDay = {};
            ordered.forEach(function(c){
                var d = dayByCut[String(c.id)];
                (slotsByDay[d] = slotsByDay[d] || []).push(Number(c.planDate));
            });
            Object.keys(slotsByDay).forEach(function(d){ slotsByDay[d].sort(function(a, b){ return a - b; }); });
            var takenByDay = {}, moves = [];
            better.forEach(function(c){
                var d = dayByCut[String(c.id)];
                var idx = takenByDay[d] = (takenByDay[d] == null ? 0 : takenByDay[d] + 1);
                var ts = slotsByDay[d][idx];
                if (ts == null || Number(c.planDate) === ts) return;
                moves.push({ cutId: String(c.id), planStartTs: ts, plannedRuns: c.plannedRuns });
            });
            if (!moves.length) return;
            // #4459: гейт ПО ФАКТУ — цех платит за ВСЮ очередь станка, вместе с неподвижными
            // соседями. Движок считает подвижные задания подряд и вклинившегося между ними
            // замороженного/начатого не видит, поэтому решение сверяем на пересобранной цепочке:
            // выросли реальные минуты переналадки — перестановку этого станка не берём. Он же
            // делает честным `gainMin` (панель «Качество плана» и текст предпросмотра #4402).
            var chainPrev = carryBy[sid] ? carryOverPrevCut(carryBy[sid], chain[0]) : null;
            var newTs = {};
            moves.forEach(function(u){ newTs[String(u.cutId)] = u.planStartTs; });
            var afterChain = chain.slice().sort(function(a, b){
                return (newTs[String(a.id)] || Number(a.planDate)) - (newTs[String(b.id)] || Number(b.planDate));
            });
            var wasReal = runChainCost(chain, chainPrev, times, changeoverCost);
            var newReal = runChainCost(afterChain, chainPrev, times, changeoverCost);
            if (newReal > wasReal + 1e-9) return;
            moves.forEach(function(u){ updates.push(u); });
            gainByMachine[sid] = round3(wasReal - newReal);
            gainMin += round3(wasReal - newReal);
        });
        return { updates: updates, gainByMachine: gainByMachine, gainMin: round3(gainMin) };
    };

    // #4438: СВЕРКА ПЛАНА С ХРАНИМЫМ — сразу после того, как план записан. «Сгенерировать»/«Упорядочить»
    // пишут «Дату план» (упаковщик) и три колонки тайминга (computeCutSetupUpdates) РАЗНЫМИ расчётами.
    // Обычно они сходятся, но любое расхождение вылезает на экран как ДЫРА (или нахлёст) между
    // карточками — и человек видит красную «↻ Пересчитать наладку» сразу после генерации: «почему
    // после Сгенерировать сразу требуется Пересчитать наладку?» (issue #4438: дыра в полчаса между
    // первым и вторым заданием).
    //
    // Поэтому по итогам записи плана прогоняем ту же сверку, что делает кнопка: пересобираем старты
    // ВСТЫК внутри дня по хранимым колонкам (recalcStartUpdates — день и порядок не меняются, за
    // пределы дня ничего не выносится) и дописываем расхождения. Замороженные дни сюда не попадают
    // (recalcScopeCutIds их отсекает, #4436).
    //
    // Молчать нельзя: расхождение — признак того, что упаковщик и колонки посчитали переналадку
    // по-разному, и это надо чинить в корне. Пишем в консоль ЧТО именно разъехалось (задание, было →
    // стало, сколько минут), чтобы причина была видна в логе, а не только в глазах оператора.
    // → Promise<число исправленных заданий>.
    AtexProductionPlanning.prototype.reconcilePlanStarts = function(opts) {
        var self = this;
        this._ppOp = 'reconcilePlanStarts';   // #4177/#4480
        var mainKey = (this.meta && this.meta.cut && this.meta.cut.id != null) ? 't' + this.meta.cut.id : null;
        if (!mainKey || !(this.cuts && this.cuts.length)) return Promise.resolve(0);
        // #4569: дни сверх видимого диапазона — вызывающий называет те, куда САМ унёс работу.
        var scopeOpts = null;
        if (opts && ((opts.dayKeys && opts.dayKeys.length) || opts.manual)) {
            scopeOpts = { dayKeys: opts.dayKeys || [], manual: !!opts.manual };
        }
        var fixes = [];
        (this.slitters || []).forEach(function(s) {
            var sid = String(s && s.id == null ? '' : s.id);
            if (sid === '') return;
            var ups = self.recalcStartUpdates(sid, scopeOpts);
            ups.forEach(function(u) { fixes.push({ slitterId: sid, up: u }); });
        });
        if (!fixes.length) return Promise.resolve(0);
        function clockOf(tsSec) {
            var d = new Date(Number(tsSec) * 1000);
            return ('0' + d.getDate()).slice(-2) + '.' + ('0' + (d.getMonth() + 1)).slice(-2)
                + ' ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
        }
        try {
            console.warn('[pp] ⚠️ #4438: план разошёлся с хранимой наладкой — свожу встык сразу после записи. '
                + 'Заданий: ' + fixes.length + '. ' + fixes.map(function(f) {
                    return 'резка ' + f.up.cutId + ' ' + clockOf(f.up.wasTs) + '→' + clockOf(f.up.ts)
                        + ' (' + Math.round((Number(f.up.ts) - Number(f.up.wasTs)) / 60) + ' мин)';
                }).join('; '));
        } catch (e) {}
        // #4477: через шлюз saveCutStarts — пул до 5 потоков, совпавшее с хранимым не пишем.
        return postCutStarts(self, fixes.map(function(f) { return f.up; })).then(function() {
            return self.reload();
        }).then(function() { return fixes.length; });
    };

    // #4401: набор заданий, которые кнопка «↻ Пересчитать наладку» вправе трогать — ТОЛЬКО этот
    // станок и ТОЛЬКО видимые дни (диапазон фильтра [С; По]; пустой край не ограничивает).
    // Возвращает массив id (строк). Порядок и переналадка внутри computeCutSetupUpdates считаются
    // по ВСЕЙ очереди станка — иначе у не-первой резки терялся бы предшественник, — но ЗАПИСЬ
    // ограничена этим набором.
    // #4569: `opts.dayKeys` — дни, которые в набор входят ПОМИМО видимого диапазона. Нужны там, где
    // операция сама уносит задание за пределы фильтра: «Урегулировать» ставит остаток перед
    // следующим заданием станка, а оно может стоять в любом дне. Запись плана диапазоном не
    // ограничена (#3974), а сведе́ние честных стартов было — и день, куда уехала работа, оставался
    // с прежними/плейсхолдерными стартами (issue #4569: «⏱ 07:59 – 09:53 — почему 07:59?»).
    AtexProductionPlanning.prototype.recalcScopeCutIds = function(slitterId, opts) {
        var sid = String(slitterId == null ? '' : slitterId);
        var fromStr = String((this.filter && this.filter.date) || '').trim();
        var toStr = String((this.filter && this.filter.dateTo) || '').trim();
        var fromKey = fromStr === '' ? null : planDateDayKey(fromStr);
        var toKey = toStr === '' ? null : planDateDayKey(toStr);
        var self = this;
        // #4569: дни сверх видимого диапазона (см. комментарий выше). Замороженные сюда не
        // попадают — их отсеивает проверка ниже, и это правило старше любого «плюс этот день».
        var extraDays = null;
        ((opts && opts.dayKeys) || []).forEach(function(k) {
            if (k == null || k === '') return;
            (extraDays = extraDays || {})[String(k)] = true;
        });
        // #4574: вызов сделан РУЧНЫМ действием оператора — заморозка его не ограничивает.
        var manualCall = !!(opts && opts.manual);
        // #4555: «Пересчитать отсюда и до конца». fromCutId — НИЖНЯЯ граница: берём выбранное
        // задание и всё, что стои́т на этом станке позже (по хранимому planStart, а он монотонен
        // и внутри дня, и между днями). Прошлое — и более ранние дни, и соседи левее в том же
        // дне — в scope не попадает и не меняется вовсе. toEnd — снять ПРАВУЮ границу [С;По]:
        // «до конца» значит до последнего задания станка, даже если хвост очереди за фильтром.
        var fromTs = null;
        if (opts && opts.fromCutId != null && String(opts.fromCutId) !== '') {
            var anchor = (this.cuts || []).filter(function(c) {
                return c && String(c.id) === String(opts.fromCutId);
            })[0];
            var anchorTs = anchor ? Number(anchor.planDate) : NaN;
            if (!isFinite(anchorTs) || anchorTs <= 0) return [];   // без старта границу не провести
            fromTs = anchorTs;
        }
        var toEnd = !!(opts && opts.toEnd);
        return (this.cuts || []).filter(function(c) {
            if (!c) return false;
            var csid = c.slitter && c.slitter.id;
            if (String(csid == null ? '' : csid) !== sid) return false;
            if (fromTs != null) {
                var ts = Number(c.planDate);
                if (!isFinite(ts) || ts < fromTs) return false;
            }
            // #4436: замороженный день не трогает НИКАКОЙ пересчёт — ни автоматический, ни по кнопке.
            // Кнопка «↻ Пересчитать наладку» тоже переписывает «Дату план» (#4408), а «Заморозка»
            // означает «этот день не меняем». Починить раскладку замороженного дня можно, сняв замок
            // (🔓), пересчитав и заморозив снова — это осознанное действие оператора, а не побочный эффект.
            // #4574: РУЧНОЕ ДЕЙСТВИЕ ЗАМОРОЗКУ ИГНОРИРУЕТ. Пропускаем замороженный день только у
            // АВТОМАТИЧЕСКОГО пересчёта; у оператора его задание иначе осталось бы с плейсхолдерным
            // временем, а переполнение такого дня было бы не видно выравниванию (#4577).
            if (!manualCall && typeof self.dayIsFrozen === 'function' && self.dayIsFrozen(c.planDate)) return false;
            var dayKey = planDateDayKey(c.planDate);
            // #4569: день, названный вызывающим, входит в набор независимо от фильтра.
            if (extraDays && dayKey != null && extraDays[String(dayKey)]) return true;
            if (fromKey != null && (dayKey == null || dayKey < fromKey)) return false;
            if (!toEnd && toKey != null && (dayKey == null || dayKey > toKey)) return false;
            return true;
        }).map(function(c) { return String(c.id); });
    };

    // #4408: ЧЕСТНЫЕ СТАРТЫ заданий станка в видимых днях — что надо переписать в planStart.
    // Хранимый тайминг («Наладка ножей» + «Сырьё/намотка» + «Резка и Лидер») говорит, сколько минут
    // станок занят заданием; хранимый planStart — когда оно начинается. После ручной перестановки
    // (↑↓ #4189, drag #4306) и пересчёта наладки (#4401) второе перестаёт следовать из первого: день
    // едет внахлёст (issue #4408: №1 08:00–11:20, №2 стартует в 08:51) или с дырами.
    // Пересобираем КАЖДЫЙ день заново (repackDayWindowStarts): встык от начала смены, обед — как у
    // упаковщика, «Отпуск» обходим, ДЕНЬ ЗАДАНИЯ НЕ МЕНЯЕТСЯ (за пределы дня не выносим — #4408),
    // порядок заданий не меняется (он и есть вход). Занятость берём по НОВЫМ колонкам (расчёт
    // dryRun поверх хранимого) — иначе старты пересобрались бы под старую наладку.
    // ЦЕЛЫЙ день трогаем, только если его раскладка развалилась (dayLayoutIsSound): свежий план
    // упаковщика мы не «поправляем» — его зазоры (обед/простой) законны.
    // opts.updates — уже посчитанные dryRun-обновления колонок (вызывающий считает их и для своих
    // нужд; передаём, чтобы не гонять расчёт всей очереди станка дважды на каждый рендер).
    // → [{ cutId, ts, wasTs, dayOffset }] (ts — unix-секунды нового planStart). Записи не делает.
    AtexProductionPlanning.prototype.recalcStartUpdates = function(slitterId, opts) {
        if (!this.meta || !this.meta.cut) return [];
        if (!(this.cuts && this.cuts.length)) return [];
        var sid = String(slitterId == null ? '' : slitterId);
        var scopeIds = this.recalcScopeCutIds(sid, opts);
        if (!scopeIds.length) return [];
        var inScope = {};
        scopeIds.forEach(function(id) { inScope[String(id)] = true; });
        // #4555: соседи ЛЕВЕЕ выбранного задания в его же дне в scope не входят (их не меняем), но
        // в раскладку дня попасть обязаны — ЯКОРЯМИ. Иначе repackDayWindowStarts начнёт день с
        // начала смены и утащит выбранное задание на 08:00 поверх нетронутого прошлого.
        var anchorIds = {};
        var fromCutId = (opts && opts.fromCutId != null) ? String(opts.fromCutId) : '';
        if (fromCutId !== '') {
            var anchorCut = (this.cuts || []).filter(function(c) { return c && String(c.id) === fromCutId; })[0];
            var anchorTs = anchorCut ? Number(anchorCut.planDate) : NaN;
            var anchorDayKey = anchorCut ? planDateDayKey(anchorCut.planDate) : null;
            if (isFinite(anchorTs) && anchorTs > 0 && anchorDayKey != null) {
                (this.cuts || []).forEach(function(c) {
                    if (!c || inScope[String(c.id)]) return;
                    var csid = c.slitter && c.slitter.id;
                    if (String(csid == null ? '' : csid) !== sid) return;
                    if (planDateDayKey(c.planDate) !== anchorDayKey) return;   // только ЕГО день
                    var ts = Number(c.planDate);
                    if (!isFinite(ts) || ts >= anchorTs) return;               // только то, что левее
                    anchorIds[String(c.id)] = true;
                    inScope[String(c.id)] = true;
                });
            }
        }
        // Новые колонки тайминга (то, что запишет persistCutSetupColumns) — dryRun, состояние не трогаем.
        var wantById = {};
        var precomputed = opts && opts.updates;
        (precomputed || this.computeCutSetupUpdates(scopeIds, { dryRun: true }).updates || []).forEach(function(u) {
            wantById[String(u.cutId)] = u;
        });
        var base = planBaseMidnightFrom(this.filter && this.filter.date, controllerNowMs(this));
        var win = this.workingWindow() || {};
        var blocked = this.blockedRangesForSlitter(sid, base);   // #3764: «Отпуск» + нерабочие дни
        var group = groupBySlitter(this.cuts || []).filter(function(g) {
            return String(g.slitter && g.slitter.id != null ? g.slitter.id : '') === sid;
        })[0];
        var byDay = {}, dayOrder = [];
        ((group && group.cuts) || []).forEach(function(c) {
            if (!c || !inScope[String(c.id)]) return;
            var tsSec = Number(c.planDate != null && c.planDate !== '' ? c.planDate : c.number);
            if (!isFinite(tsSec) || tsSec <= 0 || !isFinite(base)) return;   // нет planStart — нечего пересобирать
            var ws = Math.round((tsSec * 1000 - base) / 60000);
            var u = wantById[String(c.id)];
            var occ = u ? (Number(u.knife) + Number(u.material) + Number(u.cutTime))
                        : (Math.round(stripNum(c.storedKnifeSetupMin)) + Math.round(stripNum(c.storedMaterialWindingMin))
                           + Math.round(stripNum(c.storedCutAndLeaderMin)));
            var day = Math.floor(ws / 1440);
            if (!byDay[day]) { byDay[day] = []; dayOrder.push(day); }
            byDay[day].push({ cutId: String(c.id), windowStartMin: ws, occMin: occ,
                started: cutIsStarted(c), anchored: !!anchorIds[String(c.id)], wasTs: tsSec });
        });
        var packOpts = {
            dayStartMin: Number(win.startMin) || 0,
            lunchStartMin: win.lunchStartMin, lunchDurationMin: win.lunchDurationMin,
            blocked: blocked
        };
        var out = [];
        dayOrder.forEach(function(day) {
            var items = byDay[day];
            // Нерабочий день / отпуск на весь день: раскладывать негде — оставляем как есть.
            var covered = blocked.some(function(b) { return b[0] <= day * 1440 && b[1] >= (day + 1) * 1440; });
            if (covered) return;
            // #4416: занятость НИ У ОДНОГО задания дня (колонок тайминга нет в таблице) — мерить
            // нечем, день не трогаем и ГОВОРИМ об этом (ТЗ §14/#4059). Прежде (#4408) день
            // пропускался, если нулевая занятость была хоть у одного задания, — а осиротевший
            // setup-сегмент Σ=0 (#3924/#3943) в дне обычное дело, и из-за него «Пересчитать
            // наладку» молча ничего не делала. Такое задание — нулевой длины: встаёт на курсор и
            // соседей не двигает.
            if (!items.some(function(it) { return it.occMin > 0; })) {
                if (typeof console !== 'undefined' && console.warn) {
                    console.warn('[pp] #4416: старты дня не пересобраны — ни у одного задания нет минут занятости',
                        { slitterId: sid, dayOffset: day, cutIds: items.map(function(it) { return it.cutId; }) });
                }
                return;
            }
            if (dayLayoutIsSound(items, packOpts)) return;   // день цел — не трогаем
            var starts = repackDayWindowStarts(items, packOpts);
            items.forEach(function(it) {
                var ws = starts[it.cutId];
                if (ws == null || ws === it.windowStartMin) return;
                out.push({ cutId: it.cutId, ts: scheduleStartTimestamp(base, ws), wasTs: it.wasTs, dayOffset: day });
            });
        });
        return out;
    };

    // #4401: РАСХОЖДЕНИЯ у станка в видимых днях — то, что исправит кнопка «↻ Пересчитать наладку».
    // Человек мог подвигать задания и уйти, не пересчитав наладку: конфигурация соседей (сырьё/ножи)
    // уже другая, а хранимые «Наладка ножей»/«Сырье/намотка»/«Резка и Лидер» остались от прежнего
    // порядка — лишние или недостающие минуты. Считаем dryRun-ом (состояние не трогаем).
    // #4408: сюда же — задания, у которых разошёлся СТАРТ (recalcStartUpdates): после перестановки
    // конфигурация соседей может совпасть (колонки те же), а день всё равно поедет внахлёст.
    // Пусто → пересчитывать нечего, кнопки нет.
    // #4479: отдаёт не только идентификаторы, но и РАЗБОР («было → стало» по каждой колонке и по
    // старту) — из него карточки очереди рисуют бейджи. Счётчик кнопки и бейджи считаются из одного
    // результата, поэтому разойтись не могут: сколько названо, столько и помечено.
    // → { rows, byId, ids } (setupMismatchRows).
    // #4582: дни заданий, которыми занят РУЧНОЙ пересчёт — их заморозка для него снята.
    // Чужие дни в набор не попадают: заморозка защищает всё, чего оператор сейчас не касается.
    function scopeDayKeys(self, scopeIds) {
        var want = {}, out = {};
        (scopeIds || []).forEach(function(id) { want[String(id)] = true; });
        (self.cuts || []).forEach(function(c) {
            if (!c || c.id == null || !want[String(c.id)]) return;
            var k = planDateDayKey(c.planDate);
            if (k != null && k !== Infinity) out[String(k)] = true;
        });
        return Object.keys(out);
    }

    // #4582: детектор и кнопка «↻ Пересчитать наладку» — РУЧНЫЕ пути: заморозка их не ограничивает
    // (правило заказчика «ручная перестановка игнорирует замороженность дня»). Иначе переполненный
    // замороженный день нечем починить: автоматика туда не лезет по правилу, а оператор — не мог
    // (боевое #4582: Станок 3, 03.08 — 621 мин при потолке 455, все задания 🔒, день заморожен).
    AtexProductionPlanning.prototype.recalcMismatchRows = function(slitterId) {
        var none = { rows: [], byId: {}, ids: [] };
        if (!this.meta || !this.meta.cut) return none;
        if (!(this.cuts && this.cuts.length)) return none;
        var sid = String(slitterId == null ? '' : slitterId);
        var scopeIds = this.recalcScopeCutIds(sid, { manual: true });   // #4582: ручной путь
        if (!scopeIds.length) return none;
        // Полный расчёт идёт по ВСЕЙ очереди станка (у не-первой резки иначе нет предшественника) и
        // стоит десятки миллисекунд, а renderQueue зовут на каждый ввод в поиске. Кэшируем по подписи:
        // станок + окно фильтра + версия загруженных данных + slitterQueueSignature (порядок,
        // конфигурация и хранимый тайминг всех заданий станка). Изменилось что-то из этого — считаем заново.
        var key = sid + '|' + String((this.filter && this.filter.date) || '') + '|'
            + String((this.filter && this.filter.dateTo) || '') + '|' + String(this._planDataVersion || 0)
            + '|' + slitterQueueSignature(this.cuts, sid);
        var cache = this._setupMismatchCache;
        if (cache && cache.key === key) return cache.res;
        var res = this.computeCutSetupUpdates(scopeIds, { dryRun: true, manual: true });
        var startOps = this.recalcStartUpdates(sid, { updates: res.updates || [], manual: true });   // #4408: разъехавшиеся старты
        var out = setupMismatchRows(res.updates || [], startOps);
        this._setupMismatchCache = { key: key, res: out };
        return out;
    };

    // #4401: идентификаторы расхождений — счётчик кнопки «↻ Пересчитать наладку».
    AtexProductionPlanning.prototype.recalcMismatchIds = function(slitterId) {
        return this.recalcMismatchRows(slitterId).ids;
    };

    // #4401/#4408: «↻ Пересчитать наладку» — ТАЙМИНГ И ВРЕМЯ СТАРТА, БЕЗ ПЕРЕПЛАНИРОВАНИЯ.
    // Планировщик (buildSequenceOps/applySplitPlan) здесь не участвует вовсе: заданий не создаём и
    // не удаляем, ПОРЯДОК не меняем, ДЕНЬ каждого задания сохраняем, другие станки и дни вне фильтра
    // не трогаем. Пишем:
    //   • три хранимые колонки — «Наладка ножей, мин», «Сырье/намотка, мин», «Резка и Лидер» — тем
    //     же путём, что обычное сохранение тайминга (persistCutSetupColumns → _m_set пулом), по
    //     набору recalcScopeCutIds;
    //   • #4408: planStart тех заданий, у которых он разъехался с этими минутами — день пересобран
    //     ВСТЫК (recalcStartUpdates → repackDayWindowStarts), задание остаётся в СВОЁМ дне даже если
    //     день переполнен (за пределы дня не выносим; переполнение показываем предупреждением).
    // Подтверждения нет намеренно: подтверждать нечего — пересчёт приводит хранимое в соответствие
    // с тем, что и так задано порядком заданий.
    // #4434 п.3: opts.auto — АВТОМАТИЧЕСКИЙ пересчёт сразу после ручного перемещения (↑↓/drag).
    // Отличается только разговорчивостью: «пересчитывать нечего» молчит (после перестановки это
    // норма — соседи совпали по конфигурации), а успешный пересчёт говорит коротко.
    AtexProductionPlanning.prototype.recalcSetupTiming = function(slitterId, opts) {
        var self = this;
        this._ppOp = 'recalcSetupTiming';   // #4177/#4480
        var auto = !!(opts && opts.auto);
        if (this.busy) return Promise.resolve(false);
        // #4402: на экране непринятый план «Упорядочить» (проекция в памяти, синтетические id
        // сегментов) — тайминг по нему считать и писать нельзя. Сперва «Применить» или «Отменить».
        if (this._pendingPlan) {
            this.notify('Сперва примите или отмените показанный пересчёт очереди', 'info');
            return Promise.resolve(false);
        }
        var sid = String(slitterId == null ? '' : slitterId);
        var manualRecalc = !(opts && opts.auto);   // #4582: кнопку жмёт оператор — заморозка её не ограничивает
        var scopeIds = this.recalcScopeCutIds(sid, { manual: manualRecalc });
        if (!scopeIds.length) {
            if (!auto) this.notify('В видимых днях у этого станка нет заданий', 'info');
            return Promise.resolve(false);
        }
        var stale = this.computeCutSetupUpdates(scopeIds, { dryRun: true, manual: manualRecalc }).updates || [];
        var startOps = this.recalcStartUpdates(sid, { updates: stale, manual: manualRecalc });   // #4408: старты — ДО записи колонок
        if (!stale.length && !startOps.length) {
            // #4473: в колонках и стартах пересчитывать нечего — но день мог остаться ДЛИННЕЕ смены
            // (перестановка соседей одинаковой конфигурации расхождений не даёт, а минуты дня растут
            // от смены переналадки). Потолок дня старше ответа «пересчитывать нечего»: выравниваем.
            if (this.overfilledDaysOf(sid, { manual: manualRecalc }).length) {
                this.render();
                // #4582: дни, которые оператор пересчитывает, для этого действия разморожены — иначе
                // переполненный замороженный день выровнять нечем. У АВТОМАТИЧЕСКОГО вызова
                // (opts.auto) заморозка в силе, как и была (#4436).
                return this.levelDayLoad(sid, manualRecalc
                    ? { manual: true, unfrozenDayKeys: scopeDayKeys(this, scopeIds) } : null);
            }
            // #4416: кнопку показывает тот же детектор — если он насчитал расхождения, а писать
            // нечего, это ПРОТИВОРЕЧИЕ, а не «всё хорошо»: кнопка висит, нажатие не даёт эффекта
            // («окно пересчёта ничего не пересчитывает»). Кричим, а не отвечаем «уже актуальна».
            var shown = this.recalcMismatchIds(sid);
            if (shown.length) {
                if (typeof console !== 'undefined' && console.error) {
                    console.error('[pp] ❌ #4416: детектор показал расхождения, а пересчитывать нечего', {
                        slitterId: sid, mismatchIds: shown, scopeCount: scopeIds.length
                    });
                }
                this.notify('Пересчитывать нечего, хотя расхождений насчитано ' + shown.length
                    + ' — это ошибка расчёта, сообщите разработчику (детали в консоли)', 'error');
            } else if (!auto) {
                this.notify('Наладка уже актуальна — пересчитывать нечего', 'info');
            }
            this.render();
            return Promise.resolve(false);
        }
        var mainKey = (this.meta.cut && this.meta.cut.id != null) ? 't' + this.meta.cut.id : null;
        if (!mainKey) startOps = [];   // некуда писать planStart — тайминг пишем всё равно
        this.setBusy(true);
        this.showProgress('Пересчёт наладки…', 1);
        // #4601/#4602: ПИСАТЕЛЬ МЕРЯЕТ ТЕМ ЖЕ, ЧЕМ ДЕТЕКТОР. Расхождения считаются с `manual`
        // (ручной путь заморозку не соблюдает — #4582), а колонки писались БЕЗ него, то есть по
        // правилам автоматики: задания замороженного дня писатель молча пропускал. Кнопка
        // показывала «(заданий: 3)», нажатие проходило без ошибки и без единой записи, счётчик не
        // менялся (боевое ateh 04.08.2026: день заморожен, четыре задания — 658253/658402/658388
        // на Ст.1 и 658161 на Ст.3 — остались с «Длительностью» и «Резкой и Лидером» от прежнего
        // числа проходов). Противоречие «детектор видит, писать нечего» ловит #4416, но здесь оно
        // не срабатывало: `stale` считался ручной меркой и был НЕ пуст — расходились не счёт с
        // записью, а две мерки между собой.
        return this.persistCutSetupColumns(scopeIds, null, manualRecalc ? { manual: true } : null).then(function() {
            // #4408/#4477: planStart — через шлюз saveCutStarts (пул до 5 потоков, совпавшее с
            // хранимым не пишем; recalcStartUpdates и сам отдаёт только разъехавшиеся).
            return postCutStarts(self, startOps);
        }).then(function() {
            return self.reload();
        }).then(function() {
            self.hideProgress(); self.setBusy(false); self.render();
            self.notify(auto
                ? ('Перестановка учтена: пересчитана наладка (' + stale.length + ') и время старта ('
                    + startOps.length + ') — порядок не менялся')
                : ('Пересчитано: наладка — ' + stale.length + ' заданий, время старта — '
                    + startOps.length + ' (порядок не менялся)'), 'success');
            // #4473: день длиннее смены — ВЫРАВНИВАЕМ (разрыв по потолку + продолжение назавтра),
            // а не предупреждаем «перенесите лишнее вручную» (#4408).
            return self.levelDayLoad(sid, manualRecalc
                ? { manual: true, unfrozenDayKeys: scopeDayKeys(self, scopeIds) } : null)
                .then(function() { return true; });
        }).catch(function(err) {
            self.hideProgress(); self.setBusy(false);
            self.reload().then(function() { self.render(); }).catch(function() {});
            self.notify('Ошибка пересчёта наладки: ' + (err && err.message || err), 'error');
            return false;
        });
    };

    // #4555: «ПЕРЕСЧИТАТЬ ОТСЮДА И ДО КОНЦА» — от ВЫБРАННОГО задания вперёд по его станку.
    // Зачем: задание правят вручную (проходы, полосы, перенос), и расчёт перестаёт укладываться в
    // рамки — день уходит за потолок, старты разъезжаются. Пересчитать весь станок кнопкой
    // «↻ Пересчитать наладку» оператор не всегда может: раннее в этом дне и прошлые дни могут быть
    // уже согласованы с производством, а трогать их нельзя.
    // ЧТО ДЕЛАЕМ: наладка + честные старты встык + разрыв по потолку дня с переливом на следующие
    // дни — ровно как recalcSetupTiming, но с НИЖНЕЙ ГРАНИЦЕЙ (fromCutId) и без правой (toEnd).
    // ЧТО НЕ ТРОГАЕМ: другие станки (withinSlitterIds), всё, что раньше выбранного задания на его
    // станке (keepBeforeCutId → временный замок в buildSequenceOps; в дне — якоря в
    // recalcStartUpdates), замороженные дни (#4436, отсекает recalcScopeCutIds).
    // ПОРЯДОК НЕ МЕНЯЕТСЯ (решение заказчика 01.08.2026): кто за кем идёт — как было, меняются
    // только времена и разбиение по дням. Нужна перестановка — это «Упорядочить».
    AtexProductionPlanning.prototype.recalcFromCut = function(cut) {
        var self = this;
        this._ppOp = 'recalcFromCut';   // #4177/#4480: трасса обязана называть автора записи
        if (this.busy) return Promise.resolve(false);
        if (!cut) return Promise.resolve(false);
        // #4402: на экране непринятый план «Упорядочить» — считать и писать по нему нельзя.
        if (this._pendingPlan) {
            this.notify('Сперва примите или отмените показанный пересчёт очереди', 'info');
            return Promise.resolve(false);
        }
        var sid = String(cut.slitter && cut.slitter.id != null ? cut.slitter.id : '');
        if (sid === '') { this.notify('У задания не указан станок — пересчитывать нечего', 'error'); return Promise.resolve(false); }
        if (!(Number(cut.planDate) > 0)) {
            this.notify('У задания нет «Даты план» — от него не отсчитать «отсюда и до конца»', 'error');
            return Promise.resolve(false);
        }
        // #4588: «⏩ Пересчитать отсюда» — кнопка ОПЕРАТОРА, и заморозка её не ограничивает
        // (правило «ручное действие не получает отказа»). Прежде она отказывала прямо здесь.
        var scopeOpts = { fromCutId: String(cut.id), toEnd: true, manual: true };
        var scopeIds = this.recalcScopeCutIds(sid, scopeOpts);
        if (!scopeIds.length) { this.notify('От этого задания вперёд пересчитывать нечего', 'info'); return Promise.resolve(false); }
        var stale = this.computeCutSetupUpdates(scopeIds, { dryRun: true, manual: true }).updates || [];
        var startOps = this.recalcStartUpdates(sid, {
            updates: stale, fromCutId: scopeOpts.fromCutId, toEnd: true
        });
        var mainKey = (this.meta.cut && this.meta.cut.id != null) ? 't' + this.meta.cut.id : null;
        if (!mainKey) startOps = [];   // некуда писать planStart — тайминг пишем всё равно
        var overBefore = this.overfilledDaysOf(sid).length;
        if (!stale.length && !startOps.length && !overBefore) {
            this.notify('От этого задания и до конца всё уже сходится — пересчитывать нечего', 'info');
            this.render();
            return Promise.resolve(false);
        }
        this.setBusy(true);
        this.showProgress('Пересчёт от выбранного задания…', 1);
        // #4601/#4602: та же мерка, что у детектора выше (`manual: true`) — «⏩ Пересчитать отсюда»
        // тоже кнопка ОПЕРАТОРА, и заморозка её не ограничивает (#4588). Без флага писатель молча
        // пропускал задания замороженного дня, а счётчик расхождений их считал.
        return this.persistCutSetupColumns(scopeIds, null, { manual: true }).then(function() {
            return postCutStarts(self, startOps);
        }).then(function() {
            return self.reload();
        }).then(function() {
            self.hideProgress(); self.setBusy(false); self.render();
            self.notify('Пересчитано от выбранного задания и до конца: наладка — ' + stale.length
                + ', время старта — ' + startOps.length + ' (порядок и прошлое не менялись)', 'success');
            // Потолок дня старше «пересчитывать нечего»: лишнее рвём и переливаем на следующий день,
            // но только от выбранного задания вперёд.
            return self.levelDayLoad(sid, { fromCutId: scopeOpts.fromCutId }).then(function() { return true; });
        }).catch(function(err) {
            self.hideProgress(); self.setBusy(false);
            self.reload().then(function() { self.render(); }).catch(function() {});
            self.notify('Ошибка пересчёта от задания: ' + (err && err.message || err), 'error');
            return false;
        });
    };

    // #4408/#4473/#4531: дни, где работа уходит ЗА конец смены, — ЧИСТАЯ мерка над набором заданий
    // ОДНОГО станка. Меряет ХРАНИМЫЙ план (тот, что на экране).
    //
    // #4563 (ТЗ §15): МЕРЯЕМ ТУ ЖЕ ВЕЛИЧИНУ, ЧТО И ВСЕ ОСТАЛЬНЫЕ, — СУММУ МИНУТ ДНЯ против ёмкости
    // `dayCapacityMinutes(win, 'cuts')`. Раньше эта мерка была единственной, кто считал ДРУГОЕ:
    // время ОКОНЧАНИЯ последнего задания против часового потолка. Величину «сумма минут» ей
    // приходилось подменять сохранённым `planStart`, а тот не знает про паузы, которых в нём нет, —
    // и мерку можно было обмануть чем угодно, что стои́т в дне, но в старты не попало: обедом внутри
    // «сквозного» задания (#4559) или цепочкой, начавшейся раньше окна (#4561). Каждый раз это
    // читалось как новый дефект, а причина была одна — мерка не та. Сумма минут таких дыр не имеет:
    // обед уже вычтен из ёмкости, а занятость складывается по ВСЕМ записям дня.
    //
    // ЗАНЯТОСТЬ — ХРАНИМЫЕ КОЛОНКИ («Наладка ножей» + «Сырьё/намотка» + «Резка и Лидер»), ровно та
    // сумма, что стои́т в бейдже «(N мин)» у даты и в страже DAY_CAPACITY (#4467). Запись, которую
    // планировщик не раскладывает, со станка никуда не девается и в сумму входит (#4561).
    //
    // #4531: вместе с днём отдаёт ВИНОВНИКА — задание, которым день кончается (`cutId`), его номер
    // в дне (`seq` — тот же, что на карточке: позиция по возрастанию planStart) и потолок (`capMin`).
    // Фразу собирает печать (overfilledDayPhrase), мерка только меряет. `endMin` — во сколько день
    // кончится, если сложить его встык от начала смены (начало + работа + обед); по построению
    // `endMin − capMin === overMin`, поэтому фраза «до 16:39 при потолке 16:15 (+24 мин)» сходится.
    //
    // ОДНА МЕРКА НА ВСЕХ ПОТРЕБИТЕЛЕЙ. Её зовут предупреждение (`overfilledDaysOf` → тост #4497) и
    // подсветка шапки дня в очереди (#4531). Наборы заданий у них разные (у предупреждения — scope
    // пересчёта, у очереди — то, что нарисовано), поэтому набор передаётся параметром; арифметика
    // при этом одна и разъехаться не может.
    //   cuts — задания одного станка; opts: { baseMidnightMs, dayStartMin, cutEndMin,
    //   lunchDurationMin, maxOverworkCutsMin }.
    // → массив [{ dayOffset, endMin, overMin, capMin, loadMin, cutId, seq, cut }], по возрастанию дня.
    function overfilledDaysFromCuts(cuts, opts) {
        var o = opts || {};
        var base = Number(o.baseMidnightMs);
        var win = { startMin: Number(o.dayStartMin) || 0, cutEndMin: Number(o.cutEndMin),
                    lunchDurationMin: Number(o.lunchDurationMin) || 0,
                    maxOverworkCutsMin: Number(o.maxOverworkCutsMin) || 0,
                    maxOverworkTuneMin: Number(o.maxOverworkTuneMin) || 0 };
        if (!isFinite(win.cutEndMin) || !isFinite(base)) return [];
        var cap = dayCapacityMinutes(win, 'cuts');          // #4563: одна функция потолка на всю систему
        var ceil = dayCeilingMin(win, 'cuts');
        if (!(cap > 0)) return [];
        var byDay = {};
        (cuts || []).forEach(function(c) {
            if (!c) return;
            var tsSec = Number(c.planDate != null && c.planDate !== '' ? c.planDate : c.number);
            if (!isFinite(tsSec) || tsSec <= 0) return;
            var ws = Math.round((tsSec * 1000 - base) / 60000);
            var occ = Math.round(stripNum(c.storedKnifeSetupMin)) + Math.round(stripNum(c.storedMaterialWindingMin))
                    + Math.round(stripNum(c.storedCutAndLeaderMin));
            var day = Math.floor(ws / 1440);
            (byDay[day] = byDay[day] || []).push({ cut: c, ws: ws, occ: occ });
        });
        return Object.keys(byDay).map(Number).sort(function(a, b) { return a - b; })
            .map(function(d) {
                // Порядок в дне — по сохранённому planStart (тем же, чем нумерует карточки очередь).
                var items = byDay[d].map(function(it, i) { it._i = i; return it; })
                    .sort(function(a, b) { return (a.ws - b.ws) || (a._i - b._i); });
                var load = 0;
                items.forEach(function(it) { load += it.occ; });
                var last = items[items.length - 1];
                return { dayOffset: d, loadMin: load,
                         endMin: round3(win.startMin + load + win.lunchDurationMin),
                         overMin: Math.round(load - cap), capMin: ceil,
                         cutId: last.cut.id, seq: items.length, cut: last.cut };
            })
            // #4622: ПОРОГ ПОМЕТКИ — ТОТ ЖЕ, ЧТО У СООБЩЕНИЯ. Здесь стоял допуск `loadMin > cap + 1`:
            // день на 456 мин при потолке 455 в шапке НЕ краснел (456 не больше 456), а тост про тот
            // же день ругался — оператор видел «жалуется, а день чистый» и решал, что пометка сломана
            // (боевая ateh 05.08.2026, Станок 1, Чт 06.08: тост «458 при потолке 455», шапка «(456 мин)»
            // спокойным цветом). Меряем ровно тем числом, которое показываем: перебор ≥ 1 минуты —
            // день переполнен, и пометка обязана гореть.
            .filter(function(r) { return r.overMin >= 1; });
    }

    // #4408/#4473: переполненные дни СТАНКА в видимых днях — набор заданий берём из scope пересчёта
    // (тот же, что переписывает старты), мерку — из общей `overfilledDaysFromCuts`.
    // → массив [{ dayOffset, endMin, overMin, capMin, cutId, seq, cut }].
    // #4622: СКОЛЬКО СТАНКО-ДНЕЙ ЗАПИСАННОГО ПЛАНА УЖЕ ЗА ПОТОЛКОМ. База, с которой сравнивается
    // DAY_CAPACITY кандидата в «Упорядочить»: за унаследованный перебор кандидат не отвечает
    // (ручное действие отказа не получает), за добавленный — отвечает.
    // Мерка — общая `overfilledDaysFromCuts` (#4531), та же, что красит шапку дня и печатает тост,
    // поэтому число здесь и число на экране не могут разойтись (#4499).
    // Стаб-self в юнит-тестах окна не читает — тогда 0, и вето остаётся абсолютным, как было.
    // → число переполненных станко-дней.
    AtexProductionPlanning.prototype.capacityBreaksStored = function() {
        if (typeof this.workingWindow !== 'function') return 0;
        var win = this.workingWindow() || {};
        var base = planBaseMidnightFrom(this.filter && this.filter.date, controllerNowMs(this));
        if (!isFinite(base)) return 0;
        var bySlitter = {};
        (this.cuts || []).forEach(function(c) {
            if (!c || c.id == null) return;
            var sid = String((c.slitter && c.slitter.id) == null ? '' : c.slitter.id);
            (bySlitter[sid] = bySlitter[sid] || []).push(c);
        });
        var n = 0;
        Object.keys(bySlitter).forEach(function(sid) {
            n += overfilledDaysFromCuts(bySlitter[sid], {
                baseMidnightMs: base, cutEndMin: win.cutEndMin, maxOverworkCutsMin: win.maxOverworkCutsMin,
                dayStartMin: win.startMin, lunchStartMin: win.lunchStartMin, lunchDurationMin: win.lunchDurationMin
            }).length;
        });
        return n;
    };

    AtexProductionPlanning.prototype.overfilledDaysOf = function(slitterId, opts) {
        var sid = String(slitterId == null ? '' : slitterId);
        var scopeIds = this.recalcScopeCutIds(sid, (opts && (opts.manual || opts.dayKeys))
            ? { manual: !!(opts && opts.manual), dayKeys: (opts && opts.dayKeys) || [] } : null);
        if (!scopeIds.length) return [];
        var inScope = {};
        scopeIds.forEach(function(id) { inScope[String(id)] = true; });
        var win = this.workingWindow() || {};
        return overfilledDaysFromCuts((this.cuts || []).filter(function(c) { return c && inScope[String(c.id)]; }), {
            baseMidnightMs: planBaseMidnightFrom(this.filter && this.filter.date, controllerNowMs(this)),
            cutEndMin: win.cutEndMin,
            maxOverworkCutsMin: win.maxOverworkCutsMin,
            // #4559: обед — часть смены, а не свободные минуты: «сквозное» задание паузит на него (#3816).
            dayStartMin: win.startMin, lunchStartMin: win.lunchStartMin, lunchDurationMin: win.lunchDurationMin
        });
    };

    // #4531: ПЕРЕПОЛНЕННЫЙ СТАНКО-ДЕНЬ → ФРАЗА ОПЕРАТОРУ. Прежний текст называл дату и минуты
    // перебора — ровно то, что и так стои́т в бейдже «(N мин)» шапки дня, — и уходил ОТДЕЛЬНЫМ
    // сообщением на каждый станок: три станка давали стопку одинаковых на вид предупреждений, ни в
    // одном из которых не сказано, ни какой это станок, ни какое задание не влезло (issue #4531).
    // Собираем ОДНУ фразу на все станко-дни и называем в ней место (станок + день), мерку (конец
    // дня против потолка смены) и виновника (номер задания в дне + сырьё и размеры — как на карточке).
    //   entries — [{ slitterId, dayOffset, endMin, overMin, capMin, seq, cutLabel }];
    //   opts.slitterLabel(id) → подпись станка, opts.dayLabel(dayOffset) → дата дня,
    //   opts.clock(min) → ЧЧ:ММ, opts.limit — сколько станко-дней называть поимённо
    //   (остаток не замалчиваем: «…и ещё N»).
    // → { text, shown, rest } либо null, если называть нечего.
    function formatOverfilledDaysMessage(entries, opts) {
        var list = (entries || []).filter(function(e) { return e; });
        if (!list.length) return null;
        var o = opts || {};
        var slitterLabel = typeof o.slitterLabel === 'function' ? o.slitterLabel : function(id) { return 'станок #' + id; };
        var dayLabel = typeof o.dayLabel === 'function' ? o.dayLabel : function(d) { return 'день ' + d; };
        var clock = typeof o.clock === 'function' ? o.clock : function(m) { return String(Math.round(m)) + ' мин'; };
        var limit = Number(o.limit) > 0 ? Number(o.limit) : 3;
        var items = list.map(function(e) {
            var place = [];
            if (e.slitterId != null && String(e.slitterId) !== '') place.push(slitterLabel(e.slitterId));
            place.push(dayLabel(e.dayOffset));
            return overfilledDayPhrase(e, place.join(', '), clock);
        });
        var shown = items.slice(0, limit);
        var rest = items.length - shown.length;
        return { text: 'Не помещается в смену: ' + shown.join('; ') + (rest > 0 ? '; …и ещё ' + rest : '')
                     + '. Задания оставлены в своих днях — перенесите лишнее вручную (🗓) или «Упорядочить».',
                 shown: shown, rest: rest, items: items };
    }

    // #4531: ОДИН переполненный станко-день фразой: мерка (до какого часа идёт работа против
    // потолка резки) и виновник (номер задания в дне + сырьё/размеры). Одна формулировка на два
    // места — предупреждение (там `place` = «Станок 1, Пт, 31.07.2026») и подсказку бейджа в шапке
    // дня (там место видно и так, `place` пустое).
    //   entry — { endMin, capMin, overMin, seq, cutLabel }; clock(min) → ЧЧ:ММ.
    function overfilledDayPhrase(entry, place, clock) {
        var e = entry || {};
        var fmt = typeof clock === 'function' ? clock : function(m) { return String(Math.round(m)) + ' мин'; };
        var who = e.seq > 0 ? ('№ ' + e.seq + (e.cutLabel ? ' «' + e.cutLabel + '»' : '')) : (e.cutLabel || '');
        return (place ? place + ' — ' : '') + 'до ' + fmt(e.endMin) + ' при потолке ' + fmt(e.capMin)
            + ' (+' + Math.round(e.overMin) + ' мин)'
            + (who ? ', последнее задание ' + who : '');
    }

    // #4531: задание одной строкой — сырьё, намотка и размеры, как в первой строке карточки
    // («MW308 IN — 450 х 12»). По ней задание находится в очереди глазами.
    function cutShortLabel(cut) {
        if (!cut) return '';
        var head = [];
        var mat = cut.materialName || (cut.materialId != null && String(cut.materialId) !== '' ? '#' + cut.materialId : '');
        if (mat) head.push(String(mat));
        var wind = normWinding(cut.winding);
        if (wind) head.push(wind);
        var dims = formatCutDimensions(cut, null);
        return head.join(' ') + (head.length && dims ? ' — ' : '') + dims;
    }

    // #4408: переполнение дня, которое автоматика убрать не смогла (замороженный день #4436,
    // единственный проход длиннее смены), — молчать нельзя (ТЗ §14/#4059): показываем станок, день,
    // минуты перебора и задание, которым день кончается.
    // #4531: принимает ОДИН станок (ручные пути ↑↓ и «↻ Пересчитать наладку») или СПИСОК станков
    // (шлюз записи плана) и в обоих случаях говорит ОДНИМ сообщением.
    // → массив [{ slitterId, dayOffset, endMin, overMin, capMin, cutId, seq }] (он же уходит в тост).
    AtexProductionPlanning.prototype.warnOverfilledDays = function(slitterIds) {
        var self = this;
        var ids = (Array.isArray(slitterIds) ? slitterIds : [slitterIds])
            .map(function(v) { return String(v == null ? '' : v); });
        var days = [];
        ids.forEach(function(sid) {
            (self.overfilledDaysOf(sid) || []).forEach(function(d) {
                var row = {};
                Object.keys(d).forEach(function(k) { if (k !== 'cut') row[k] = d[k]; });
                row.slitterId = sid;
                row.cutLabel = cutShortLabel(d.cut);
                days.push(row);
            });
        });
        if (!days.length) return days;
        var base = planBaseMidnightFrom(this.filter && this.filter.date, controllerNowMs(this));
        var byId = {};
        (this.slitters || []).forEach(function(s) { byId[String(s.id)] = s.label || ('станок #' + s.id); });
        var msg = formatOverfilledDaysMessage(days, {
            slitterLabel: function(id) { return byId[String(id)] || ('станок #' + id); },
            dayLabel: function(dayOffset) { return formatPlanDayHeading(base, dayOffset); },
            clock: formatClock,
            limit: 3
        });
        if (msg) this.notify(msg.text, 'warning');
        if (typeof console !== 'undefined' && console.warn) {
            console.warn('[pp] #4408: день не помещается в смену', { slitterIds: ids, days: days });
        }
        return days;
    };

    // #4473: ВЫРАВНИВАНИЕ ЗАГРУЗКИ ДНЯ ПОСЛЕ РУЧНОГО ПЕРЕМЕЩЕНИЯ. Станко-день не длиннее смены с
    // нахлёстом — жёсткое правило ТЗ §15 (`DAY_CAPACITY`, #4467), и путь ручной перестановки (↑↓
    // #4189, drag #4306, кнопка «↻ Пересчитать наладку» #4401) обязан его соблюсти так же, как
    // «Сгенерировать» и «Упорядочить». Прежде этот путь только пересобирал старты ВНУТРИ дня
    // (#4408) и ПРЕДУПРЕЖДАЛ: день оставался на 484 мин при потолке 460 (issue #4473).
    //
    // ЧТО ДЕЛАЕМ. Отдаём ПОРЯДОК ОПЕРАТОРА упаковщику (`preserveOrder`) по ОДНОМУ станку
    // (`withinSlitterIds`): он рвёт задание в конце дня по потолку (голова остаётся, остаток —
    // продолжением на следующий день, #3280/#4304) и склеивает продолжения обратно, когда место
    // появилось (#4469). Порядок заданий не меняется, замок дня 🔒 и «Заморозка» соблюдаются
    // шлюзом записи (`guardPlanOps`), запись идёт обычным `applySplitPlan`.
    //
    // ПОЧЕМУ ЧЕРЕЗ ДВИЖОК, А НЕ «ОТРЕЗАТЬ ЛИШНЕЕ» ЗДЕСЬ. Остаток дня меряется тем же гейтом, которым
    // паковали (окно, обед, «Отпуск», нахлёст резки/настройки, атомарность прохода) — снаружи эту
    // мерку не воспроизвести (#4469). Контроллер лишь РЕШАЕТ, что день переполнен, и зовёт упаковщик.
    //
    // Слияния заданий одного заказа (#4424, `mergeSameOrderTasks`) здесь НЕ делаем: ручное
    // перемещение не повод перекраивать записи оператора — только физика смены.
    // → Promise<boolean> (true, если план пересобран).
    AtexProductionPlanning.prototype.levelDayLoad = function(slitterId, opts) {
        var self = this;
        var sid = String(slitterId == null ? '' : slitterId);
        var over = this.overfilledDaysOf(sid, opts);
        if (!over.length) return Promise.resolve(false);
        var base = planBaseMidnightFrom(this.filter && this.filter.date, controllerNowMs(this));
        var label = over.map(function(d) {
            return formatPlanDayHeading(base, d.dayOffset) + ' (+' + d.overMin + ' мин)';
        }).join('; ');
        if (typeof console !== 'undefined' && console.log) {
            console.log('[pp] ⚖️ #4473: день длиннее смены — выравниваю упаковщиком (порядок сохраняю)',
                { slitterId: sid, days: over });
        }
        // typeof-гард — как у slotPlacementOn: в юнит-тестах метод зовут на стаб-self без прототипа.
        if (typeof this.autoSequenceQueueAfterMerge !== 'function') return Promise.resolve(false);
        // #4555: выравнивание «отсюда и до конца» — прошлое станка закрепляем (keepBeforeCutId),
        // трогаем только выбранное задание и то, что за ним. Без opts — прежнее поведение.
        var scope = { withinSlitterIds: [sid] };
        if (opts && opts.fromCutId != null && String(opts.fromCutId) !== '') scope.keepBeforeCutId = String(opts.fromCutId);
        // #4577: те же дни, что разморозило вызвавшее ручное действие — иначе переложить переполненный
        // замороженный день нечем. Замок 🔒 при этом цел: день выравнивается РАЗРЫВОМ последнего
        // задания по потолку (#4467/#4512), а не вытеснением зафиксированного.
        if (opts && opts.unfrozenDayKeys && opts.unfrozenDayKeys.length) scope.unfrozenDayKeys = opts.unfrozenDayKeys.slice();
        return this.autoSequenceQueueAfterMerge(PLANNING_STRATEGY_SETUP, true, scope)
            .then(function(changed) {
                var left = self.overfilledDaysOf(sid);
                if (left.length) { self.warnOverfilledDays(sid); return !!changed; }
                self.notify('День выровнен по смене: ' + label
                    + ' — лишнее разбито по потолку и уехало на следующий день, порядок сохранён', 'success');
                return !!changed;
            });
    };

    // #4402: строки статистики «Было / Станет / изменение наладки» для липкой панели «Упорядочить» —
    // тот же состав чисел, что показывала форма после пересчёта переналадки. → [node, node, node]
    function planStatsNodes(before, after) {
        function statLine(label, s, cls) {
            return el('div', { class: 'atex-pp-plan-row' + (cls ? ' ' + cls : '') }, [
                el('span', { class: 'atex-pp-plan-label', text: label }),
                el('span', { text: 'переналадки: ' + s.changeoverCount + ' (' + s.changeoverMin + ' мин)' }),
                el('span', { text: 'ножи: ' + s.knifeCount + ' (' + s.knifeMin + ' мин)', style: 'opacity:.85;' }),
                el('span', { text: 'смены сырья: ' + s.materialCount + ' (' + s.materialMin + ' мин)', style: 'opacity:.85;' }),
                el('span', { text: 'избыток: ' + formatQualityDelta(s.excessCount) + ' (' + formatQualityDelta(s.excessMin) + ' мин)' })
            ]);
        }
        var dCnt = after.changeoverCount - before.changeoverCount;
        var dMin = round3(after.changeoverMin - before.changeoverMin);
        var deltaText = (dCnt === 0 && dMin === 0) ? 'наладка не изменится'
            : ('изменение наладки: ' + formatQualityDelta(dCnt) + ' переналадок (' + formatQualityDelta(dMin) + ' мин)'
               + (dMin < 0 ? ' — лучше' : (dMin > 0 ? ' — хуже' : '')));
        var deltaCls = dMin < 0 ? 'is-better' : (dMin > 0 ? 'is-worse' : '');
        return [
            statLine('Было:', before, 'is-before'),
            statLine('Станет:', after, 'is-after'),
            el('div', { class: 'atex-pp-plan-delta ' + deltaCls, text: deltaText })
        ];
    }

    // #4417: подробное «было → стало» одного задания — подсказка карточки и строка в «Деталях».
    // Чистая (покрыта тестом): на вход — строка planChangeRows.
    function planChangeTitle(row) {
        if (!row) return '';
        var parts = [];
        if (row.kind === 'new') {
            parts.push('Новый сегмент разбиения — появится после «Применить»');
            if (row.parentCutId) parts.push('от задания ' + row.parentCutId);
            parts.push('старт ' + row.whenTo);
            if (row.runs) parts.push('проходов ' + row.runs);
            return parts.join(' · ');
        }
        if (row.kind === 'deleted') return 'Запись удаляется по «Применить» · старт был ' + row.whenFrom;
        if (row.startChanged) parts.push('старт ' + row.whenFrom + ' → ' + row.whenTo);
        // #4444: станок — номером ЗАКЛАДКИ (имя на этом экране ничего не подсказывает).
        if (row.slitterChanged) parts.push('станок ' + planChangeStation(row));
        (row.timing || []).forEach(function(t) {
            parts.push(t.label + ' ' + (t.from == null ? '—' : t.from) + ' → ' + t.to + ' мин');
        });
        return parts.length ? ('Изменится: ' + parts.join(' · ')) : '';
    }

    // #4444: колонка «станок» списка «Деталей» — ПОРЯДКОВЫЙ НОМЕР ЗАКЛАДКИ, а не имя станка:
    // «3 → 5», если станок сменился, и просто «3», если нет. Имя («Станок 2», «MW-1100») оператору
    // на этом экране не помогает — переключается он по вкладкам, поэтому и в разборе плана нужен
    // номер вкладки. Номер неизвестен (станка нет ни в справочнике, ни в очереди) → «—». Чистая.
    function planChangeStation(row) {
        if (!row) return '—';
        var from = row.slitterTabFrom, to = row.slitterTabTo;
        if (row.kind === 'new') return to == null ? '—' : String(to);
        if (row.kind === 'deleted') return from == null ? '—' : String(from);
        if (from == null && to == null) return '—';
        if (from == null || to == null || from === to) return String(from == null ? to : from);
        return from + ' → ' + to;
    }

    // #4417: то же «было → стало», но БЕЗ времени старта — для списка «Деталей», где старт стоит
    // отдельной колонкой (иначе одно и то же читалось бы дважды). #4444: станок тоже вынесен в свою
    // колонку (номером закладки), поэтому и он отсюда убран. Чистая.
    function planChangeRest(row) {
        if (!row) return '';
        if (row.kind === 'new') {
            return 'сегмент разбиения от задания ' + (row.parentCutId || '—')
                + (row.runs ? ' · проходов ' + row.runs : '');
        }
        if (row.kind === 'deleted') return 'запись удаляется по «Применить»';
        var parts = [];
        (row.timing || []).forEach(function(t) {
            parts.push(t.label + ' ' + (t.from == null ? '—' : t.from) + ' → ' + t.to + ' мин');
        });
        if (parts.length) return parts.join(' · ');
        // #4518: минуты наладки те же — тогда называем, что ИМЕННО поменялось. Прежняя подпись
        // говорила «только время старта» заданию, уехавшему на другой день, и «только станок» —
        // тому, у кого сменились и станок, и день: строка спорила с колонкой старта прямо над ней.
        var what = [];
        if (row.slitterChanged) what.push('станок');
        if (row.dayChanged) what.push('день');
        else if (row.startChanged) what.push('время старта');
        if (!what.length) return '';
        return (what.length === 1 ? 'только ' : '') + what.join(' и ');
    }

    // #4417: «Детали» — модалка со ВСЕМИ изменёнными заданиями непринятого плана. Панель даёт
    // только сводку («переставлено N»), а разбор нужен списком: что куда уехало, у чего сменился
    // станок, у чего только тайминг, что появится и что удалится.
    AtexProductionPlanning.prototype.openPlanDetails = function() {
        var self = this;
        var pend = this._pendingPlan;
        if (!pend) { this.notify('Непринятого плана нет — показывать нечего', 'info'); return; }
        var changes = pend.changes || { rows: [], movedCount: 0, createdCount: 0, deletedCount: 0 };

        var dialog = el('div', { class: 'atex-pp-modal-dialog atex-pp-plan-details-dialog' });
        var overlay = el('div', { class: 'atex-pp-modal atex-pp-plan-details-modal is-open' }, [dialog]);
        function close() { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }
        overlay.addEventListener('click', function(e) { if (e.target === overlay) close(); });
        var closeX = el('button', { class: 'atex-pp-modal-close', type: 'button', text: '×', title: 'Закрыть' });
        closeX.addEventListener('click', close);
        dialog.appendChild(closeX);

        var content = el('div', { class: 'atex-pp-plan-details-content' });
        dialog.appendChild(content);
        content.appendChild(el('h2', { class: 'atex-pp-form-title', text: 'Изменения непринятого плана' }));
        content.appendChild(el('p', { class: 'atex-pp-hint', text:
            'Переставлено заданий: ' + changes.movedCount
            + ' · новых сегментов: ' + changes.createdCount
            + ' · удаляется записей: ' + changes.deletedCount
            + '. В базу ничего не записано — план ждёт «Применить» или «Отменить». '
            + 'Те же задания помечены в очереди каймой и бейджем.' }));
        content.appendChild(this.renderPlanDetailsGroup('Переставлено', changes.rows, 'moved'));
        content.appendChild(this.renderPlanDetailsGroup('Новые сегменты (появятся по «Применить»)', changes.rows, 'new'));
        content.appendChild(this.renderPlanDetailsGroup('Удаляются по «Применить»', changes.rows, 'deleted'));

        var actions = el('div', { class: 'atex-pp-supply-actions' });
        var closeBtn = el('button', { class: 'atex-pp-btn', type: 'button', text: 'Закрыть' });
        closeBtn.addEventListener('click', close);
        actions.appendChild(closeBtn);
        content.appendChild(actions);

        this.root.appendChild(overlay);
        this.planDetailsEl = overlay;   // для теста/повторного открытия
    };

    // #4417: одна группа списка «Деталей». Пустая группа не рисуется вовсе — лишний заголовок
    // «Удаляются: 0» только мешает читать.
    AtexProductionPlanning.prototype.renderPlanDetailsGroup = function(title, rows, kind) {
        var self = this;
        var items = (rows || []).filter(function(r) { return r.kind === kind; });
        var box = el('div', { class: 'atex-pp-plan-details-group is-' + kind });
        if (!items.length) return box;
        box.appendChild(el('h3', { class: 'atex-pp-plan-details-title', text: title + ': ' + items.length }));
        var listEl = el('ul', { class: 'atex-pp-plan-details-list' });
        items.forEach(function(r) {
            var idNode = (kind === 'new')
                ? el('span', { class: 'atex-pp-plan-details-id', title: 'Записи в БД ещё нет', text: '—' })
                : el('a', { class: 'atex-pp-plan-details-id',
                    href: '/' + encodeURIComponent(self.db) + '/edit_obj/' + encodeURIComponent(r.cutId),
                    target: '_blank', rel: 'noopener',
                    title: 'Открыть карточку задания (id ' + r.cutId + ')', text: 'id ' + r.cutId });
            listEl.appendChild(el('li', { class: 'atex-pp-plan-details-item is-' + kind }, [
                idNode,
                el('span', { class: 'atex-pp-plan-details-label', text: r.label }),
                // #4444: станок — ПОРЯДКОВЫЙ НОМЕР ЗАКЛАДКИ, всегда (даже если не менялся): без него
                // из списка не понять, на какой вкладке искать задание.
                el('span', { class: 'atex-pp-plan-details-station' + (r.slitterChanged ? ' is-changed' : ''),
                    title: r.slitterChanged
                        ? ('Станок сменился: ' + r.slitterFrom + ' → ' + r.slitterTo + ' (номера закладок)')
                        : ('Станок: ' + (r.kind === 'deleted' ? r.slitterFrom : r.slitterTo) + ' (номер закладки)'),
                    text: 'станок ' + planChangeStation(r) }),
                el('span', { class: 'atex-pp-plan-details-when',
                    text: (kind === 'new') ? ('старт ' + r.whenTo)
                        : (kind === 'deleted') ? ('был ' + r.whenFrom)
                        : (r.startChanged ? (r.whenFrom + ' → ' + r.whenTo) : (r.whenTo + ' — старт тот же')) }),
                el('span', { class: 'atex-pp-plan-details-what', text: planChangeRest(r) })
            ]));
        });
        box.appendChild(listEl);
        return box;
    };

    // #4402: липкая панель непринятого плана «Упорядочить» — во всю ширину рабочего места, поверх
    // очереди. Живёт в собственном узле (this.planBarEl), поэтому переключение станков/дней её не
    // сбрасывает: план видно на карточках всех станков, пока не нажаты «Применить» / «Отменить».
    // Пусто (нет _pendingPlan) → узел очищается и по :empty скрывается.
    AtexProductionPlanning.prototype.renderPlanPreviewBar = function() {
        var self = this;
        var host = this.planBarEl;
        if (!host) return;
        host.innerHTML = '';
        var pend = this._pendingPlan;
        // Пока висит непринятый план, действия над очередью гасим (класс на корне): любая запись
        // шла бы «не от того» состояния — сперва «Применить» или «Отменить».
        if (this.root && this.root.classList) this.root.classList.toggle('is-plan-preview', !!pend);
        if (!pend) return;
        var lateWorse = round3(pend.lateAfter) > round3(pend.lateBefore);
        var lateCls = round3(pend.lateAfter) < round3(pend.lateBefore) ? 'is-better' : (lateWorse ? 'is-worse' : '');
        // #4413: задания в окне «Отпуска» станка — строку показываем, только если они были или
        // остаются: в обычном плане её нет, а тут она объясняет, ради чего переставили.
        var dtBefore4413 = Number(pend.downtimeBefore) || 0, dtAfter4413 = Number(pend.downtimeAfter) || 0;
        var dtNodes = (dtBefore4413 || dtAfter4413) ? [el('div', {
            class: 'atex-pp-plan-delta ' + (dtAfter4413 < dtBefore4413 ? 'is-better' : (dtAfter4413 > dtBefore4413 ? 'is-worse' : '')),
            text: 'в окне «Отпуска» станка: ' + dtBefore4413 + ' → ' + dtAfter4413 + ' заданий'
        })] : [];
        // #4469: дни, не набитые до потолка смены — как и строка «Отпуска», показывается, только
        // если они были или остаются: она объясняет, ради чего пересобрали план при тех же сроках.
        var ufBefore4469 = Number(pend.underfilledBefore) || 0, ufAfter4469 = Number(pend.underfilledAfter) || 0;
        var ufNodes = (ufBefore4469 || ufAfter4469) ? [el('div', {
            class: 'atex-pp-plan-delta ' + (ufAfter4469 < ufBefore4469 ? 'is-better' : (ufAfter4469 > ufBefore4469 ? 'is-worse' : '')),
            text: 'дней не набито до потолка смены: ' + ufBefore4469 + ' → ' + ufAfter4469
        })] : [];
        var panel = el('div', { class: 'atex-pp-plan-bar' }, [
            el('div', { class: 'atex-pp-plan-title', text: '↻ Пересчёт очереди — план показан, но НЕ сохранён' })
        ].concat(planStatsNodes(pend.before, pend.after), dtNodes, ufNodes, [
            el('div', { class: 'atex-pp-plan-delta ' + lateCls,
                text: 'опоздания: ' + pend.lateBefore + ' → ' + pend.lateAfter + ' дн'
                    + (pend.slitterChange ? ' · со сменой станка' : '') }),
            el('div', { class: 'atex-pp-plan-bar-hint',
                text: 'Переставлено заданий: ' + (pend.movedCount || 0)
                    + (pend.createdIds && pend.createdIds.length ? ', новых сегментов: ' + pend.createdIds.length : '')
                    + (pend.deletedIds && pend.deletedIds.length ? ', удаляется записей: ' + pend.deletedIds.length : '')
                    + '. Переключайтесь между станками и днями — карточки уже показывают новый план; '
                    + 'тронутые задания помечены каймой и бейджем, весь список — по кнопке «Детали». '
                    + '«Применить» записывает его в базу, «Отменить» (и обновление страницы) возвращает прежний.' })
        ]));
        var ok = el('button', { class: 'atex-pp-plan-apply', type: 'button', text: 'Применить' });
        ok.addEventListener('click', function() { if (self.busy) return; self.applyPendingPlan(); });
        // #4417: «Детали» — между «Применить» и «Отменить»: список всех изменённых заданий.
        // Ничего не пишет и не решает, поэтому стоит рядом с решением, а не в панели действий.
        var chg4417 = pend.changes || { rows: [] };
        var details = el('button', { class: 'atex-pp-plan-details-btn', type: 'button', text: 'Детали',
            title: 'Показать все изменённые задания (' + (chg4417.rows || []).length + ')' });
        details.addEventListener('click', function() { self.openPlanDetails(); });
        var cancel = el('button', { class: 'atex-pp-plan-cancel', type: 'button', text: 'Отменить' });
        cancel.addEventListener('click', function() { if (self.busy) return; self.cancelPendingPlan(); });
        panel.appendChild(el('div', { class: 'atex-pp-plan-btns' }, [ok, details, cancel]));
        host.appendChild(panel);
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
            this.renderPlanPreviewBar();   // #4402: липкая панель непринятого плана «Упорядочить»
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
        var producedByPos = this.producedRollsByPosition();   // #4536: выпуск позиций — считаем ОДИН раз на список
        var options = unsup.map(function(p) {
            var remaining = remainingRollsForPosition(p, self.supplies, producedByPos);
            var base = posLabelById[String(p.id)] || ('Сырьё#' + (p.materialId || '?') + ' · ' + ((p.orderWidth != null ? p.orderWidth : p.width) || '?') + ' мм');
            return { id: String(p.id), remaining: remaining, width: (p.orderWidth != null ? p.orderWidth : p.width),  // #3372: заказанная ширина
                label: base + ' · ост. ' + round3(remaining) + ' рул.' };
        }).filter(function(o) { return o.remaining > 0; });

        // #4398: позиция, у которой уже есть «Обеспечение» с заданием или складской партией,
        // из списка исчезает — и это выглядело так, будто заказа в планировании нет вовсе.
        // Говорим, сколько согласованных позиций скрыто по этой причине и где искать их задания.
        var approvedCount = (this.genPositions || []).filter(function(p) { return p.approved; }).length;
        var coveredCount = approvedCount - unsup.length;
        if (coveredCount > 0) {
            form.appendChild(el('p', { class: 'atex-pp-hint',
                text: 'Позиции, у которых уже есть задание или складская партия, в списке не показываются (скрыто: ' +
                    coveredCount + '). Их задания ищите поиском по номеру заказа в очереди — если ничего не найдено, ' +
                    'очередь предложит расширить диапазон дат.' }));
        }

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

        // #4396: день вставки задания. Пусто (по умолчанию) — как раньше: задание встаёт в
        // ближайшее свободное окно, то есть в конец очереди станка. УКАЗАН — он ОБЯЗАТЕЛЬНЫЙ:
        // после создания задание переносится на этот день (moveCutToDay), тем же путём, что и
        // ручное «🗓», и ФИКСИРУЕТСЯ — только фикс-якорь гарантирует именно этот день (#4390).
        // Место ВНУТРИ дня по-прежнему выбирается по весу.
        var insertInput = el('input', { class: 'atex-pp-input atex-pp-date-input', type: 'date',
            value: d.insertDate || '', title: 'День, в который встанет задание; указан — обязателен' });
        insertInput.addEventListener('change', function() { d.insertDate = String(insertInput.value || '').trim(); self.renderForm(); });
        form.appendChild(field('День вставки (можно не указывать; указан — обязателен)', insertInput));

        // Галка «В работе» убрана (решение заказчика 25.07.2026): реквизит «В работе» задания
        // это флаг АКТИВНОСТИ ЗАПИСИ, а не статус; рабочее место его нигде не читало (ни
        // mapCutRecord/rowsToPlanning, ни очередь/Гант/генерация), и переключателя на карточке
        // тоже нет — галка была записью в никуда. Значение больше не пишем ВООБЩЕ: у нового
        // задания реквизит остаётся дефолтным по схеме. Менять его — в карточке объекта CRM
        // (edit_obj, ссылка с номера задания в очереди, #4394). Статус очереди — отдельное поле
        // (cut_status отчёта), к этому флагу отношения не имеет.

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

        // #4396: день вставки выбран — вместо «Свободного окна» (оно про конец очереди) говорим,
        // куда задание встанет, и заранее предупреждаем об отпуске станка в этот день
        // (moveCutToDay такой перенос отклоняет — пусть диспетчер увидит это ДО создания).
        var insertMidnightMs = insertDayIso(d.insertDate) ? planBaseMidnightFrom(d.insertDate, controllerNowMs(this)) : null;
        var insertVacation = !!(insertMidnightMs != null && d.slitterId && this.slitterOnVacationDay(d.slitterId, insertMidnightMs));
        // #4396: выходной/праздник «Календаря» (#3788) — в такой день заданий быть не должно
        // (очередь так и пишет). Нет таблицы «Календарь» → dayIsWorking всегда true, поведение прежнее.
        var insertDayOff = !!(insertMidnightMs != null && !this.dayIsWorking(insertMidnightMs));

        var previewBox = el('div', { class: 'atex-pp-cut-preview' });
        if (canCreate) {
            var pl = d.prospect;
            var lines = [
                insertMidnightMs != null
                    ? ('День вставки: ' + formatPlanDayHeading(insertMidnightMs, 0) + ' — задание встанет именно в него (будет зафиксировано)')
                    : ('Свободное окно: ' + formatFreeSlot(chosenSlot)),
                'Проходов: ' + round3(pl.plannedRuns) + ' · полос/проход (ширина ' + round3(pl.posWidth) + ' мм): ' + round3(pl.stripsPerPass),
                'Произведём этой ширины: ' + round3(pl.producedPosRolls) + ' рул. · обеспечим: ' + round3(pl.supplyRolls) + ' · склад: ' + round3(pl.stockRolls),
                // #4553: называем ЗАНЯТОСТЬ ДНЯ, а не одну намотку. Раньше строка печатала
                // pl.duration — намотку БЕЗ лидера и БЕЗ наладки: у боевого случая это «~225 мин»
                // против настоящих 520 (лидер 2 мин × 125 проходов = 250, наладка 45), и диспетчер
                // ставил в 16-минутный день задание, которое туда втрое не влезало. Занятость
                // берём из свободного окна станка — freeSlotForCut считает наладку и «Резку и
                // Лидер» ТЕМИ ЖЕ формулами, что расписание и хранимые колонки (#4499/#4529), так
                // что форма и очередь меряют одним. Окна нет — не выдумываем (ТЗ §14).
                chosenSlot
                    ? ('Займёт в дне: ~' + round3(stripNum(chosenSlot.setupMin) + stripNum(chosenSlot.durationMin))
                        + ' мин (наладка ' + round3(chosenSlot.setupMin)
                        + ' + резка и лидер ' + round3(chosenSlot.durationMin) + ')')
                    : 'Займёт в дне: не рассчитать — станок не отдал свободного окна'
            ];
            if (insertDayOff) lines.push('⚠️ Выходной/праздничный день — заданий быть не должно. Выберите рабочий день.');
            if (insertVacation) lines.push('⚠️ Станок в отпуске в этот день — выберите другой день или станок.');
            if (pl.multiLayout) lines.push('⚠️ Кол-ва хватает на несколько заданий — создаётся первое.');
            lines.forEach(function(txt) { previewBox.appendChild(el('div', { class: 'atex-pp-cut-preview-line', text: txt })); });
        } else {
            previewBox.appendChild(el('div', { class: 'atex-pp-hint',
                text: prospectReady ? 'Выберите станок — покажу состав задания.' : 'Заполните позицию и кол-во рулонов.' }));
        }
        form.appendChild(previewBox);

        var actions = el('div', { class: 'atex-pp-actions' });
        var createBtn = el('button', { class: 'atex-pp-btn atex-pp-btn-primary', type: 'button', text: 'Создать задание' });
        createBtn.disabled = !canCreate || insertVacation || insertDayOff;   // #4396: нерабочий день выбран — создавать нечего
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
        // #4346: «Отклонения N/M» — до любых ранних выходов ниже: счёт идёт по ВСЕЙ очереди,
        // а не по видимому диапазону, поэтому от состава вкладок он не зависит.
        this.updateDeviationsButton();
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

        // #4398: поиск отбирает из ВИДИМОГО диапазона дат, поэтому задание, стоящее раньше «С»
        // (застрявшее в прошлом, не начатое), поиск по номеру заказа не находил и молчал — заказ
        // выглядел потерянным (заказ есть, задания нигде нет). Считаем совпадения по всей
        // загруженной очереди и, если они вне диапазона, показываем плашку с их датами и
        // кнопкой, расширяющей диапазон до них.
        // Считаем по набору, уже отсеянному ОСТАЛЬНЫМИ фильтрами (статус), иначе кнопка
        // обещала бы задание, которое после расширения дат всё равно не покажется.
        var outside = searchMatchesOutsideRange(filterCuts(this.cuts, this.filter), query,
            linkedLabelsByCut, this.filter.date, this.filter.dateTo);
        if (outside.count) {
            var outsideDays = formatPlanDayRangeLabel(outside.fromIso, outside.toIso);
            var outsideBtn = el('button', { class: 'atex-pp-outside-btn', type: 'button',
                text: 'Расширить диапазон', title: 'Показать в очереди даты ' + outsideDays });
            outsideBtn.addEventListener('click', function() {
                var next = expandRangeToInclude(self.filter.date, self.filter.dateTo,
                    outside.fromIso, outside.toIso);
                self.filter.date = next.date;
                self.filter.dateTo = next.dateTo;
                // Найденное задание может стоять на ДРУГОМ станке — переключаем закладку на
                // станок первого совпадения, иначе расширенный диапазон снова покажет пустоту.
                var firstSlitterId = (outside.cuts[0] && outside.cuts[0].slitter && outside.cuts[0].slitter.id != null)
                    ? String(outside.cuts[0].slitter.id) : '';
                if (firstSlitterId !== '') self.activeSlitter = firstSlitterId;
                self.selectedCutId = null;   // #3349: панель «Связанные позиции» — от прежней резки
                self.renderQueue();
                self.renderLink();
            });
            box.appendChild(el('div', { class: 'atex-pp-outside-note' }, [
                el('span', { class: 'atex-pp-outside-text',
                    text: 'Вне диапазона дат по запросу найдено заданий: ' + outside.count +
                        ' (' + outsideDays + ')' }),
                outsideBtn
            ]));
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

        // #4434 п.3: после РУЧНОГО перемещения (↑↓/drag) кнопки не будет — перестановка пересчитывает
        // наладку сама (moveCutInDay/reorderCutInDay → recalcSetupTiming({auto:true})). Кнопка остаётся
        // страховкой для расхождений, возникших НЕ сейчас: правка данных задания, импорт, чужая сессия.
        // #4401: показывается ПО ФАКТУ РАСХОЖДЕНИЯ, а не по флагу
        // «в этой сессии двигали задания» (#4189 _manualMoveDirty). Человек мог подвигать задания и
        // уйти, не пересчитав тайминг: после перезагрузки страницы флаг терялся, а расхождение
        // оставалось — и кнопки не было. Теперь на каждой отрисовке очереди сверяем ХРАНИМЫЙ тайминг
        // этого станка в видимых днях с расчётом по ТЕКУЩЕМУ порядку (recalcMismatchIds, dryRun) и
        // показываем кнопку, только если что-то разошлось. Ничего не разошлось — кнопки нет.
        // #4408: расхождением считается и разъехавшееся ВРЕМЯ СТАРТА (день едет внахлёст/с дырами).
        // #4479: тот же результат даёт бейджи на карточках (mismatchByCut ниже) — счётчик кнопки и
        // пометки на заданиях считаются из ОДНОГО разбора, поэтому не могут разойтись.
        var actDirtyId = (activeGroup && activeGroup.slitter && activeGroup.slitter.id != null) ? String(activeGroup.slitter.id) : '';
        var mismatch = actDirtyId ? self.recalcMismatchRows(actDirtyId) : { rows: [], byId: {}, ids: [] };
        var mismatchIds = mismatch.ids;
        var mismatchByCut = mismatch.byId;
        if (mismatchIds.length) {
            // #4430: вид и ЛИПКОСТЬ кнопки — в CSS (.atex-pp-recalc-setup): она приклеена к верху
            // экрана, иначе в длинной очереди уезжала вверх и расхождение чинить было нечем.
            // Inline-стиля здесь нет намеренно: он перебил бы правило .is-plan-preview, которое
            // снимает липкость под липкой плашкой непринятого плана (#4402).
            var recalcBtn = el('button', {
                class: 'atex-pp-recalc-setup', type: 'button',
                text: '↻ Пересчитать наладку (заданий: ' + mismatchIds.length + ')',
                title: 'Хранимый тайминг разошёлся с текущим порядком заданий: сырьё/ножи у соседей'
                     + ' другие, а наладка осталась прежней. Пересчёт приведёт «Наладку ножей»,'
                     + ' «Сырьё/намотку» и «Резку и Лидер» в соответствие и пересоберёт ВРЕМЯ СТАРТА'
                     + ' встык внутри дня (без дыр и нахлёстов). Порядок заданий и их дни НЕ меняются;'
                     + ' затрагиваются только этот станок и видимые дни.'
            });
            recalcBtn.addEventListener('click', function() {
                if (self.busy) return;
                self.recalcSetupTiming(actDirtyId);   // #4401: только тайминг, без подтверждения
            });
            groupEl.appendChild(recalcBtn);
        }

        // Расписание активного станка: старт/финиш каждой резки от начала смены (08:00).
        // Длительность — намотка прогона (метраж обеспечений → windingMinutes), плюс
        // переналадки между резками (реальные минуты из таблицы «Время операции»);
        // в конце каждого рабочего дня — блок уборки CLEANUP_SHIFT (#3155).
        var windPoints = windingPointsFromTimes(self.opTimes || {});
        var runLenByCut = {};
        activeGroup.cuts.forEach(function(c) {
            runLenByCut[String(c.id)] = cutRunLength(c, self.supplies, self.positionLengthById);
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
        // #3688: текущая заправка активного станка → синтетическая
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
        // #4099: рисуем КАК ЕСТЬ — окно каждой резки по СОХРАНЁННОМУ planStart без анти-нахлёста и
        // без потолка смены. Перекрытия переполненного дня видны как есть (та же раскладка, что и на
        // РМ «Диаграмма Ганта»), а не сжимаются/уносятся в ночь или на следующий день.
        var schedule = scheduleFromStored(activeGroup.cuts, planBaseMidnightMs);
        schedule.forEach(function(sc) { schedById[sc.cutId] = sc; });
        self._timingByCut = {};   // #3240: пересобираем контекст тайминга модалки для активного станка
        function schedDay(sc) { return sc ? Math.floor((Number(sc.startMin) || 0) / 1440) : null; }
        // #3616: задания группируем и нумеруем по РАБОЧЕМУ ДНЮ РАСПИСАНИЯ (schedDay) —
        // тому же, что разделяет дни блоком уборки и датой-заголовком, — а НЕ по хранимой
        // «Дате план». Иначе резки одной хранимой даты, переехавшие расписанием на следующий
        // день (не влезли в текущий), продолжали сквозную нумерацию (№5 на новом дне вместо №1).
        function cutSchedDayKey(c) { var d = schedDay(schedById[String(c.id)]); return d == null ? '\u0000' : String(d); }
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
        var breakMarkersByCut = _brkInfo.markersByCut, breakShiftByCut = _brkInfo.shiftByCut, breakExtendByCut = _brkInfo.extendByCut;
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
        // #4531: какие из этих дней НЕ ПОМЕЩАЮТСЯ В СМЕНУ — ТОЙ ЖЕ меркой, что и предупреждение
        // (`overfilledDaysFromCuts`): конец последнего задания дня против потолка резки. Набор
        // заданий — те, что на экране (activeGroup.cuts), поэтому пометка не может разойтись с
        // бейджем «(N мин)», рядом с которым стои́т. Замороженный день (#4326) тоже помечаем: он
        // виден в очереди, и его перебор оператор должен видеть так же, как любой другой.
        var overByDay = {};
        overfilledDaysFromCuts(activeGroup.cuts, {
            baseMidnightMs: planBaseMidnightMs,
            cutEndMin: dayWindow.cutEndMin,
            maxOverworkCutsMin: dayWindow.maxOverworkCutsMin,
            // #4559: обед «сквозного» задания (#3816) в хранимых стартах не лежит — мерка добавляет его сама.
            dayStartMin: dayWindow.startMin, lunchStartMin: dayWindow.lunchStartMin,
            lunchDurationMin: dayWindow.lunchDurationMin
        }).forEach(function(d) { overByDay[d.dayOffset] = d; });
        // #3914: печать бейджа «(N мин)» по дням активного станка — из чего складывается сумма и
        // какой день превысил бюджет (cutEnd−dayStart−обед+нахлёст). Источник — сохранённые planStart
        // (то, что реально записала последняя генерация), поэтому число совпадает с бейджем на экране.
        if (ppTraceOn()) {
            var _budget = dayCapacityMinutes(dayWindow, 'cuts');   // #4563: один потолок на всех
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
            // #4434 п.4: связи/срок/назначение полос ПРОДОЛЖЕНИЯ день-сплита живут на ГОЛОВЕ цепочки —
            // читаем по ней, иначе карточка пишет «нет связей», теряет срок и красит все полосы «(ОТХОДЫ)».
            var linkHostId = supplyHostCutId(c, self.supplies);
            var linkCut = (linkHostId === String(c.id)) ? c : { id: linkHostId };
            var supplies = self.supplyCount(linkHostId);

            // Карточка-панель (#3120 п.1): div-панель вместо кнопки. Внутри —
            // информация и контролы (↑/↓/Полосы). Клик по всей панели = выбор резки
            // (#3149: раньше реагировала только строка .atex-pp-cut-info). Панель полос
            // (#3120 п.8) openStrips добавляет внутрь этой же карточки (контейнер —
            // cardPanel), а не внизу всей очереди — поэтому она строго одна на карточку.
            // #3120 п.4: подсветка резки, которую нечем обеспечить — нет подходящей
            // партии (Фаза 1a) ЛИБО есть потребность (метраж), но «Расход сырья» её не
            // покрывает (Фаза 1b: не удалось зарезервировать полностью).
            // #4402: сегмент из предпросмотра «Упорядочить» — записи в БД ещё нет, поэтому нет ни
            // «Обеспечения», ни «Расхода сырья»: подсветку «нечем обеспечить» ему не ставим (сырьё
            // и обеспечение придут от головы цепочки при «Применить»).
            var isPreviewNew = !!c.previewNew;
            var unreserved = isPreviewNew ? false : cutMissingBatch(c, self.genBatches);
            if (!unreserved && !isPreviewNew) {
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
            // #4417: задание, которое непринятый план ТРОНУЛ (время старта, станок или тайминг) —
            // заметная кайма, чтобы такие карточки находились при листании станков и дней.
            var previewChange = c.previewChanged || null;
            var cardPanel = el('div', { class: 'atex-pp-cut' + (active ? ' is-active' : '') + (unreserved ? ' is-unreserved' : '') + (c.fixed ? ' is-fixed' : '') + (isSetupTask ? ' is-setup' : '') + (isPreviewNew ? ' is-preview-new' : '') + (previewChange ? ' is-preview-changed' : ''), dataset: { cutId: String(c.id) },
                // #4404 п.2: подсказка карточки = список заказов и позиций, тот же текст, что в
                // панели «Связанные позиции» (cutLinkedTitle → cutLinkedLabels).
                title: self.cutLinkedTitle(c) });

            var materialText = c.materialName || (c.materialId ? ('#' + c.materialId) : '—');
            var sc = schedById[String(c.id)];
            var runLengthForCut = runLenByCut[String(c.id)];
            // #3240: контекст тайминга резки для модалки (setup с предыдущей + нормы + старт).
            // #3688: для первой задачи очереди prev — заправка станка (carryPrevCut, из
            // заправки станка): смена сырья + ножи, если осталось другое. Нет данных → null +
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
                // #3635 п.5: для настройки показываем «⚙ Настройка ножей и сырья · … · N мин»
                // (окно = переналадка, минуты вверх), а не строку расписания резки.
                // #4121: у настройки тоже пишем начало и окончание окна — по одному «· N мин» было
                // непонятно, когда станок занят переналадкой.
                var scheduleText = isSetupTask
                    ? formatSetupScheduleLine(sc, breakShiftByCut[String(c.id)], breakExtendByCut[String(c.id)])
                    : formatScheduleLine(sc, runLengthForCut, windPoints.length > 0, breakShiftByCut[String(c.id)], breakExtendByCut[String(c.id)]);
                if (!isSetupTask && stripNum(sc.durationMin) <= 0 && typeof console !== 'undefined' && console.error) {
                    console.error('[pp] ❌ renderQueue: длительность резки не рассчитана', {
                        cutId: String(c.id),
                        plannedRuns: c.plannedRuns,
                        runLength: runLengthForCut,
                        storedDuration: c.duration,
                        windPoints: windPoints
                    });
                }
                // #4394: в title — id задания (объекта «Задание в производство»), чтобы из
                // очереди можно было сразу найти запись в CRM. Формат «id N» — как в списке
                // отклонений (renderDeviationGroup).
                // #4462: сюда же — ИСТОРИЯ ВЫБОРА МЕСТА последней пересборки (сколько вариантов
                // просмотрено, чем выбранный слот дешевле двух ближайших альтернатив, из каких весов
                // сложилась цена). Только у заданий, которые план тронул: у остальных подсказка
                // описывала бы не их перестановку.
                var placeWhy = (self._placementByCut || {})[String(c.id)];
                timeEl = el('div', {
                    class: 'atex-pp-cut-time',
                    role: 'button',
                    tabindex: '0',
                    title: 'Показать тайминг резки · id ' + c.id + (placeWhy ? ('\n\n' + placeWhy) : ''),
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
            // #4394: номер по порядку — ссылка на форму правки задания (/{db}/edit_obj/{id}),
            // новая вкладка. Формат ссылки — как в отчёте о пропущенных позициях (#3608).
            // draggable=false: перетаскивание карточки живёт на ручке ⠿ (#4306), нативный
            // drag ссылки только мешал бы. Клик всплывает и выбирает резку, как по любому
            // другому месту карточки (#3354 п.2).
            // #4402: у сегмента предпросмотра записи в БД ещё нет — ссылке на edit_obj вести некуда,
            // поэтому номер обычным текстом + пометка, что задание появится по «Применить».
            var infoChildren = [
                isPreviewNew
                    ? el('span', {
                        class: 'atex-pp-cut-seq',
                        title: cutNumTitle + ' · Новый сегмент: запись появится после «Применить»',
                        text: '№ ' + seqText
                    })
                    : el('a', {
                        class: 'atex-pp-cut-seq',
                        href: '/' + encodeURIComponent(self.db) + '/edit_obj/' + encodeURIComponent(c.id),
                        target: '_blank',
                        rel: 'noopener',
                        draggable: 'false',
                        title: cutNumTitle + ' · Открыть карточку задания (id ' + c.id + ')',
                        text: '№ ' + seqText
                    })
            ];
            if (isPreviewNew) {
                infoChildren.push(el('span', { class: 'atex-pp-cut-new-badge',
                    title: 'Новый сегмент разбиения по дням — появится после «Применить»', text: 'новое' }));
            }
            // #4417: чем именно задание отличается от сохранённого плана — коротко на бейдже,
            // подробно (было → стало) в подсказке и в модалке «Детали» липкой панели.
            if (previewChange) {
                infoChildren.push(el('span', { class: 'atex-pp-cut-chg-badge',
                    title: planChangeTitle(previewChange), text: planChangeSummary(previewChange) }));
            }
            // #4479: расхождение, из-за которого над очередью висит «↻ Пересчитать наладку», —
            // на самом задании: бейдж говорит СУТЬ («наладка», «старт»), подсказка — «было → стало».
            // Иначе кнопка называет число, а какие это задания и что с ними не так — не найти.
            var mismatchRow = mismatchByCut[String(c.id)];
            if (mismatchRow) {
                infoChildren.push(el('span', { class: 'atex-pp-cut-mismatch-badge',
                    title: setupMismatchTitle(mismatchRow), text: setupMismatchSummary(mismatchRow) }));
            }
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

            // #3769: «Срок изготовления» обеспечиваемых позиций — в скобках в конце строки полос.
            // Срок один на задание (позиции резки кластеризованы по сроку), поэтому
            // показываем общий набор сроков и красим строку по самому раннему (срочному):
            // раньше «Даты план» → красный, дальше план+DAYS_FORECAST → жёлтый, в окне → как есть.
            // #4051: includeSupplyFallback=true — срок берём и из cut_planning.due_date, когда
            // позиция выпала из активного positions_list (иначе плашка пропадала у таких заданий).
            // Считаем ОДИН раз на карточку: тот же признак просрочки нужен ниже предупреждению
            // о разрыве по дням (см. блок «разорвано по дням»).
            var dueKeys = cutDueKeys(linkCut, self.supplies, self.genPositions, true);   // #4434 п.4: срок — по голове цепочки
            var dueClass = dueKeys.length ? dueColorClass(dueKeys[0], planDateDayKey(c.planDate), self.daysForecast()) : '';

            // #3354 п.1: под первой строкой — сводка полос по ширинам. Контейнер
            // .atex-pp-cut-material содержит по одной строке .atex-pp-strip-row на ширину:
            // «{сырьё} {ширина} x {длина} {намотка} — {факт.ширина}мм х {резок} x {полос} = {мотков} шт.».
            var stripGroups = cutStripGroups(c);
            if (stripGroups.length) {
                // #3686: обратный резолв (факт→номинал) сверяет j= с «Номинальной шириной» рулона
                var jumboWidth = self.nominalWidthByMaterial ? self.nominalWidthByMaterial[String(c.materialId)] : null;
                var dueSuffix = '';
                if (dueKeys.length) {
                    var dueLabels = dueKeys.map(formatDayKey).filter(function(s) { return s; });
                    if (dueLabels.length) dueSuffix = ' (' + (dueLabels.length > 1 ? 'сроки: ' : 'срок: ') + dueLabels.join(', ') + ')';
                }
                // #4230: полоса идёт «в заказ», если её ширина совпадает с шириной обеспечиваемой
                // позиции. Полосы НЕ в заказ (лишний добор джамбо, #3391) видно сразу: строка
                // красная и вместо срока — «Склад» (номенклатура есть в «Максимальном запасе»,
                // table/67113) или «Отходы» (нарезать впрок нельзя). Классификация по ширине —
                // у карточки нет id полос (в отличие от редактора полос по orderedBatchIds).
                var orderedWidthKeys = cutOrderedWidthKeys(linkCut, self.supplies, self.genPositions);   // #4434 п.4: «в заказ» — по голове цепочки
                var matRows = stripGroups.map(function(g) {
                    // #3408: полосы хранят ФАКТИЧЕСКУЮ ширину (#3372: p.width = факт.),
                    // поэтому g.width — это факт.ширина. В сводку выводим сначала номинал
                    // (обратный резолв по справочнику), а после тире — реальные мм.
                    var ctx = { jumbo: jumboWidth, inches: null };
                    var nominal = resolveNominalWidth(g.width, ctx, self.actualWidthIndex);
                    var lineText = formatStripSummaryLine(c, { width: nominal, count: g.count }, g.width, runLengthForCut);
                    var ordered = !!(orderedWidthKeys[stripWidthKey(nominal)] || orderedWidthKeys[stripWidthKey(g.width)]);
                    if (ordered) {
                        return el('div', { class: 'atex-pp-strip-row' + (dueClass ? ' ' + dueClass : ''),
                            text: lineText + dueSuffix });
                    }
                    // #4230: не в заказ — «Склад»/«Отходы» вместо срока, вся строка красная.
                    var purpose = stockStripPurpose(self.maxStockIndex, {
                        material: c.materialId, width: g.width, length: c.length, winding: c.winding
                    });
                    var rowEl = el('div', { class: 'atex-pp-strip-row is-nonorder', text: lineText + ' ' });
                    rowEl.appendChild(el('span', { class: 'atex-pp-strip-nonorder-flag', text: '(' + purpose + ')' }));
                    return rowEl;
                });
                cardPanel.appendChild(el('div', { class: 'atex-pp-cut-material' }, matRows));
            }

            // #3354 п.2/п.3: клик по ЛЮБОМУ месту карточки выбирает резку и обновляет
            // .atex-pp-link, НЕ пересобирая очередь (selectCut вместо render) — поэтому
            // открытая панель полос (.atex-pp-strip-panel) не сворачивается ни при клике
            // по этой карточке, ни при клике по другой (закрытие — только её крестиком
            // .atex-pp-strip-close). cutClickSelectsCut пропускает лишь клики внутри
            // самой панели полос (она и так гасит всплытие).
            // #4404 п.3/п.4: ЛЮБОЕ действие по карточке сначала ВЫБИРАЕТ её задание, иначе панель
            // «Связанные позиции» показывает позиции прошлого выбора — переносишь одно, а видишь
            // связи другого. Слушаем в фазе ПЕРЕХВАТА (capture): кнопки 🔒/🗓/🗑 гасят всплытие
            // (stopPropagation), и обычный bubble-обработчик до карточки не доходил. Capture
            // срабатывает по пути ВНИЗ, до обработчиков самих кнопок, поэтому выбор случается
            // всегда — и для нынешних контролов, и для любых будущих.
            cardPanel.addEventListener('click', function(e) {
                if (!cutClickSelectsCut(e.target)) return;
                self.selectCut(c.id);
            }, true);

            // #4306: drag-drop перестановка ВНУТРИ дня. Карточка — и источник (через ручку ⠿ ниже),
            // и цель (drop). Валидность (тот же день+станок, не через 🔒) проверяет reorderCutInDay;
            // здесь лишь гейтим по дню+станку, чтобы не подсвечивать чужие дни/станки.
            var cardDayKey = String(planDateDayKey(c.planDate));
            var cardSid = String(c.slitter && c.slitter.id != null ? c.slitter.id : '');
            function dragMatchesDay() {
                var d = self._dragCut;
                return !!d && String(d.cutId) !== String(c.id) && String(d.dayKey) === cardDayKey && d.slitterId === cardSid;
            }
            cardPanel.addEventListener('dragover', function(e) {
                if (!dragMatchesDay()) return;
                e.preventDefault();
                if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
                cardPanel.classList.add('is-drop-target');
            });
            cardPanel.addEventListener('dragleave', function() { cardPanel.classList.remove('is-drop-target'); });
            cardPanel.addEventListener('drop', function(e) {
                cardPanel.classList.remove('is-drop-target');
                if (!dragMatchesDay()) return;
                e.preventDefault();
                self.reorderCutInDay(sameDayCuts, self._dragCut.cutId, c.id);
            });

            var controls = el('div', { class: 'atex-pp-cut-controls' });
            // #4381: НАЧАТОЕ задание (заполнено «Начато») неприкосновенно, даже если не
            // зафиксировано: управляющие контролы у него не показываем ВООБЩЕ (⠿, ↑↓, 🔒, 🗓, 🗑) —
            // остаются только «Полосы» (просмотр раскладки). Начатое уже идёт на станке: перенос,
            // перестановка и удаление такого задания рассинхронизируют план с цехом.
            var cutStarted = cutIsStarted(c);
            // #4306: ручка перетаскивания ⠿ (первый контрол).
            // #4392: зафиксированные (🔒) ТЕПЕРЬ тоже перетаскиваются — фиксация держит ДЕНЬ, а не
            // позицию в дне (перестановка — обмен planStart внутри того же дня). Недоступна лишь у
            // начатого задания (#4381: оно уже идёт на станке).
            var dragHandle = el('span', {
                class: 'atex-pp-drag-handle', text: '⠿',
                title: 'Перетащить задание в пределах дня'
            });
            if (!cutStarted) {
                dragHandle.setAttribute('draggable', 'true');
                dragHandle.addEventListener('dragstart', function(e) {
                    self._dragCut = { cutId: String(c.id), dayKey: cardDayKey, slitterId: cardSid };
                    if (e.dataTransfer) {
                        e.dataTransfer.effectAllowed = 'move';
                        try { e.dataTransfer.setData('text/plain', String(c.id)); } catch (_e) {}
                        if (e.dataTransfer.setDragImage) { try { e.dataTransfer.setDragImage(cardPanel, 24, 18); } catch (_e2) {} }   // тащим саму карточку, а не ручку
                    }
                    cardPanel.classList.add('is-dragging');
                });
                dragHandle.addEventListener('dragend', function() {
                    self._dragCut = null;
                    if (self.queueEl) {
                        var ds = self.queueEl.querySelectorAll('.is-dragging, .is-drop-target');
                        for (var di = 0; di < ds.length; di++) { ds[di].classList.remove('is-dragging'); ds[di].classList.remove('is-drop-target'); }
                    }
                });
            }
            if (!cutStarted) controls.appendChild(dragHandle);   // #4381
            var up = el('button', { class: 'atex-pp-move', type: 'button', text: '↑', title: 'Выше' });
            var down = el('button', { class: 'atex-pp-move', type: 'button', text: '↓', title: 'Ниже' });
            // sameDayCuts/dayIdx вычислены выше (для seqText #3508 п.7) — переиспользуем.
            // #4392: ↑↓ доступны и для зафиксированных заданий (фиксация держит ДЕНЬ, не позицию в
            // дне). Блокируем только на границах дня; прежний запрет по c.fixed (#3508 п.3) снят.
            if (dayIdx === 0) up.disabled = true;
            if (dayIdx === sameDayCuts.length - 1) down.disabled = true;
            up.addEventListener('click', function() {
                if (self.busy) return;
                self.moveCutInDay(sameDayCuts, dayIdx, -1);   // #3923: перестановка = обмен planStart + переупаковка
            });
            down.addEventListener('click', function() {
                if (self.busy) return;
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
            // #4555: «⏩» — пересчитать ОТСЮДА И ДО КОНЦА: наладка, старты встык и разрыв по потолку
            // дня от этого задания вперёд по его станку. Прошлое (прежние дни и соседи левее в этом
            // дне) и другие станки не трогаются, порядок не меняется. Между «🗓» и «🗑».
            var recalcFrom = el('button', {
                class: 'atex-pp-cut-recalc-from',
                type: 'button',
                text: '⏩',
                title: 'Пересчитать отсюда и до конца (наладка, старты, разрыв по дням) — прошлое и другие станки не трогаются'
            });
            recalcFrom.addEventListener('click', function(e) {
                if (e && e.stopPropagation) e.stopPropagation();
                if (self.busy) return;
                self.recalcFromCut(c);
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
            // #4381: у начатого задания из всего ряда остаются только «Полосы».
            if (!cutStarted) { controls.appendChild(up); controls.appendChild(down); }
            controls.appendChild(strips);
            if (!cutStarted) controls.appendChild(fix);
            if (!cutStarted) controls.appendChild(move);   // #3602: «🗓» перенос на другой день — между «🔒» и «🗑»
            if (!cutStarted) controls.appendChild(recalcFrom);   // #4555: «⏩» пересчитать отсюда и до конца
            // #3540: кнопки ◀▶ ручного сдвига планового старта убраны — двигать время вручную
            // не требуется. #3562: пин планового старта тоже убран — автогенерация двигает
            // зафиксированное задание по времени в течение дня и меняет его очередность.
            if (!cutStarted) controls.appendChild(del);   // #4381
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
                var dayHeaderMs = planBaseMidnightMs + cardSchedDay * 86400000;
                var dayOff = !self.dayIsWorking(dayHeaderMs);
                // #4531: день НЕ ПОМЕЩАЕТСЯ В СМЕНУ — видно прямо в шапке, а не только в тосте.
                // Бейдж «(N мин)» показывает сумму минут без мерки: помещается она в смену или нет,
                // по ней не понять, и виноватый день приходилось искать глазами.
                var dayOver = overByDay[cardSchedDay];
                var dayDateEl = el('div', {
                    class: 'atex-pp-day-date' + (dayOff ? ' is-dayoff' : '') + (dayOver ? ' is-over' : ''),
                    title: dayOff ? 'Выходной/праздничный день — заданий быть не должно' : ''
                }, [
                    formatPlanDayHeading(planBaseMidnightMs, cardSchedDay),
                    el('span', { class: 'atex-pp-day-mins', text: ' (' + dayMins + ' мин)' })
                ]);
                if (dayOver) {
                    dayDateEl.appendChild(el('span', {
                        class: 'atex-pp-day-over',
                        // Подсказка — та же фраза, что в предупреждении (место здесь и так видно).
                        title: 'День не помещается в смену: '
                            + overfilledDayPhrase({ endMin: dayOver.endMin, capMin: dayOver.capMin,
                                overMin: dayOver.overMin, seq: dayOver.seq, cutLabel: cutShortLabel(dayOver.cut) },
                                '', formatClock)
                            + '. Перенесите лишнее вручную (🗓) или «Упорядочить».',
                        text: '+' + Math.round(dayOver.overMin) + ' мин сверх смены'
                    }));
                }
                // #4326: «замок дня» справа в шапке дня. Есть таблица «Заморозка» → показываем замок:
                // открыт 🔓 (день можно менять) / закрыт 🔒 (день заморожен — планирование его не трогает).
                // title закрытого = Примечание фиксации. Клик — заморозить/разморозить (openFreezeDay).
                if (self.meta.freeze) {
                    var frozenInfo = self.freezeByDay[planDateDayKey(dayHeaderMs)] || null;
                    var lockBtn = el('button', {
                        class: 'atex-pp-day-freeze' + (frozenInfo ? ' is-frozen' : ''),
                        type: 'button',
                        text: frozenInfo ? '🔒' : '🔓',
                        title: frozenInfo
                            ? ('День заморожен' + (frozenInfo.notes ? ': ' + frozenInfo.notes : '') + ' — планирование его не трогает. Нажмите, чтобы разморозить.')
                            : 'Заморозить день — планирование не будет его трогать (для всех станков)'
                    });
                    lockBtn.addEventListener('click', function(e) {
                        if (e && e.stopPropagation) e.stopPropagation();
                        if (self.busy) return;
                        self.openFreezeDay(dayHeaderMs, frozenInfo);
                    });
                    dayDateEl.appendChild(lockBtn);
                }
                groupEl.appendChild(dayDateEl);
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
            // #4304: задание разорвано по дням (не влезло в смену) → красная плашка оператору.
            // Условие и текст — в daySplitWarning (10-planning-engine, покрыто тестом): просрочено
            // ИЛИ зафиксировано, на любом сегменте цепочки (разрыв бывает и на 3+ дня). Просрочка —
            // по «Дате план» ЭТОГО сегмента (dueClass выше): голова в срок красной не станет.
            var splitWarn = daySplitWarning({
                fromPrev: spans.fromPrev, toNext: spans.toNext,
                fixed: c.fixed, overdue: dueClass === 'is-overdue'
            });
            if (splitWarn) {
                cardPanel.appendChild(el('div', { class: 'atex-pp-fixed-split-warn',
                    title: splitWarn.title, text: splitWarn.text }));
            }
            // #4617: карточка куска называет арифметику цепочки — «проходов 1 из 5 · остальные 4 → 07.08».
            // Значка «→» в углу мало: в боевой ateh (Станок 2, 06.08.2026) у четырёх заказов в дне
            // остался ОДИН проход, остальные стояли отдельной записью на 07.08, и очередь читалась
            // как «потерянные резки». Числа берём из САМИХ записей цепочки (splitChainPartsOf), а не
            // из расписания: разрыв виден и когда вторая часть лежит вне выбранного диапазона дат.
            var chainNote = daySplitChainNote(splitChainPartsOf(self.cuts || [], c.id), c.id, function(planDate) {
                return formatPlanDayLabel(planDateIso(planDate));
            });
            if (chainNote) {
                cardPanel.appendChild(el('div', { class: 'atex-pp-cut-chain-note',
                    title: chainNote.title, text: 'ℹ ' + chainNote.text }));
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
                var scopeFromKey = qFromStr === '' ? null : planDateDayKey(qFromStr);
                var scopeToKey = qToStr === '' ? null : planDateDayKey(qToStr);
                // #4371: как в computeQualityStats — панель берёт только idealWindow/combinationsWindow.
                var pqView = planQualityView(self.cuts, {
                    settings: self.daySettings,
                    scopeFromKey: scopeFromKey,
                    scopeToKey: scopeToKey
                });
                // #4161: сколько заданий ПРОСРОЧЕНО (плановый день позже самого раннего «Срока
                // изготовления» позиций — то же правило, что красит строку карточки dueColorClass
                // 'is-overdue'). По тому же окну [С;По], что «всего заданий», чтобы «просрочено» не
                // превышало показанное число заданий.
                var overdueCount = countOverdueCuts(self.cuts, self.supplies, self.genPositions,
                    { scopeFromKey: scopeFromKey, scopeToKey: scopeToKey, forecastDays: self.daysForecast() });
                // #4161: красный пункт «просрочено: N» — показываем ТОЛЬКО когда такие есть (>0).
                var overdueQualitySpan = function() {
                    return el('span', { text: 'просрочено: ' + overdueCount, style: 'color:#c0392b;font-weight:600;' });
                };
                // #4156: ФАКТ (переналадки/ножи/смены сырья) — из ХРАНИМЫХ колонок наладки задания
                // («Наладка ножей, мин» / «Сырье/намотка, мин», #3698), как суммирует отчёт «Комбинации».
                var setupTot = self.storedSetupTotals(scopeFromKey, scopeToKey);
                var qId = pqView.idealWindow;
                var metaCut = self.meta && self.meta.cut;
                var hasSetupCols = !!(metaCut && reqIdByName(metaCut, CUT_REQ.knifeSetupMin)
                                              && reqIdByName(metaCut, CUT_REQ.materialWindingMin));
                if (!setupTot.hasStored) {
                    // #4156: НЕ подсовываем оценку planQuality по весам под видом «факта» (её и чинили —
                    // она расходилась с отчётом). Нет хранимых колонок наладки — это ошибка конфигурации/
                    // данных: ОРЁМ (консоль + тост + красная плашка), а не молча откатываемся (ТЗ §14/#4059).
                    var qErr = hasSetupCols
                        ? ('колонки наладки #3698 («' + CUT_REQ.knifeSetupMin + '» / «' + CUT_REQ.materialWindingMin
                            + '») пусты — суммы наладки нечем показать; пересчитайте план («Сгенерировать» / «Упорядочить»)')
                        : ('в таблице «' + TABLE.cut + '» нет колонок наладки #3698 («' + CUT_REQ.knifeSetupMin
                            + '» / «' + CUT_REQ.materialWindingMin + '») — добавьте их');
                    console.error('[pp] Качество плана: ' + qErr);
                    // #4188: ГДЕ ИМЕННО пусто и ПОЧЕМУ — перечисляем ID заданий с незаписанными колонками
                    // наладки (+станок/день/сегмент) и КОНТЕКСТ операции (self._ppOp). Это отвечает на
                    // «где и почему»: при операции runGenerateCuts колонки ещё НЕ записаны (их пишет
                    // последующий autoSequenceQueue → persistCutSetupColumns), поэтому пусто ОЖИДАЕМО и
                    // уйдёт на пере-рендере после пересборки; если же пусто без последующей пересборки —
                    // колонки реально не сохранены (тогда список ID укажет конкретные задания).
                    if (hasSetupCols) {
                        var emptyCuts4188 = setupTot.emptyWindow || [];
                        console.error('[pp] #4188 пустые колонки наладки: ' + emptyCuts4188.length + ' из '
                            + setupTot.window.taskCount + ' заданий окна; операция=' + (self._ppOp || '?')
                            + '; ID: ' + formatEmptySetupIds(emptyCuts4188),
                            { emptyIds: emptyCuts4188, op: self._ppOp || null });
                    }
                    // Тост один раз на состояние (renderQueue частый) — не спамим, но и не молчим.
                    if (self.notify && self._qualityColsError !== qErr) { self._qualityColsError = qErr; self.notify('Качество плана: ' + qErr, 'error'); }
                    var qErrPanel = el('div', { class: 'atex-pp-quality atex-pp-quality-error',
                        style: 'display:flex;gap:14px;flex-wrap:wrap;align-items:center;margin:6px 0;padding:6px 10px;'
                            + 'border:1px solid #c0392b;border-radius:6px;font-size:13px;' }, [
                        el('span', { text: 'Качество плана', style: 'font-weight:600;' }),
                        el('span', { text: '⚠ ' + qErr, style: 'color:#c0392b;font-weight:600;' }),
                        // Идеал/комбинации не зависят от хранимых колонок (считаются по резкам плана) — показываем.
                        el('span', { text: 'идеал: ' + qId.count + ' (' + qId.minutes + ' мин)', style: 'opacity:.75;' }),
                        el('span', { text: 'уникальных комбинаций: ' + pqView.combinationsWindow, style: 'opacity:.75;' })
                    ]);
                    // #4161: «просрочено: N» красным — не зависит от хранимых колонок наладки.
                    if (overdueCount > 0) qErrPanel.appendChild(overdueQualitySpan());
                    box.appendChild(qErrPanel);
                } else {
                    self._qualityColsError = null;   // ошибка снялась — дать снова шуметь, если вернётся
                    // #4188: ЧАСТИЧНО пусто — часть заданий окна БЕЗ колонок наладки, а часть с ними
                    // (hasStored=true → красной плашки нет). Такие задания молча дают 0 в суммы наладки —
                    // «переналадки/ножи/сырьё» окна ЗАНИЖЕНЫ. Не критично для очереди (плашку не рвём),
                    // но в трассу выводим ГДЕ ИМЕННО (ID+станок+день) под тумблером PP_TRACE, чтобы не
                    // спамить консоль на каждом рендере. Пустое ≠ хранимый «0» (см. storedSetupTotals).
                    var partialEmpty4188 = setupTot.emptyWindow || [];
                    if (partialEmpty4188.length && ppTraceOn()) {
                        ppTraceWarn('#4188 частично пустые колонки наладки: ' + partialEmpty4188.length + ' из '
                            + setupTot.window.taskCount + ' заданий окна (суммы наладки занижены); операция='
                            + (self._ppOp || '?') + '; ID: ' + formatEmptySetupIds(partialEmpty4188));
                    }
                    // #4013: панель — по ОКНУ [С;По] (факт из хранимых колонок, идеал/комбинации ОКНА).
                    var qW = setupTot.window, qAll = setupTot.all;
                    // Избыток = ФАКТ окна − идеал окна (#4156; отрицательный = план лучше идеала, станок
                    // вошёл настроенным — ТЗ §13 п.3).
                    var qEx = { excessCount: qW.changeoverCount - qId.count,
                                excessMin: round3(qW.changeoverMin - qId.minutes) };
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
                        // «Смены сырья» — число ПЕРЕЗАПРАВОК (смена вида сырья, намотки ИЛИ партии сырья;
                        // хранимая колонка «Сырье/намотка, мин»), а не количество номенклатуры сырья.
                        el('span', { text: 'смены сырья: ' + qW.materialCount + ' (' + qW.materialMin + ' мин)', style: 'opacity:.85;' }),
                        el('span', { text: 'идеал: ' + qId.count + ' (' + qId.minutes + ' мин)', style: 'opacity:.75;' }),
                        el('span', { text: 'избыток: ' + formatQualityDelta(qEx.excessCount) + ' (' + formatQualityDelta(qEx.excessMin) + ' мин)' }),
                        // #4008: сколько всего разных настроек резки (набор ножей + сырьё + намотка).
                        // #4013: по ОКНУ (combinationsWindow) — пустое окно даёт 0, а не диверсити всего плана.
                        el('span', { text: 'уникальных комбинаций: ' + pqView.combinationsWindow, style: 'opacity:.75;' })
                    ]);
                    qPanel.title = 'За весь горизонт [С; конец всех задач]: переналадки '
                        + qAll.changeoverCount + ' (' + qAll.changeoverMin + ' мин), из них ножи '
                        + qAll.knifeCount + ' (' + qAll.knifeMin + ' мин), смены сырья '
                        + qAll.materialCount + ' (' + qAll.materialMin + ' мин). '
                        + 'Идеал — каждая конфигурация ножей и каждое сырьё настраиваются по 1 разу. '
                        // #4013: подсказка о всём плане → комбинации всего плана (панель выше — по окну).
                        + 'Уникальных комбинаций во всём плане (набор ножей + сырьё + намотка): ' + pqView.combinations + '.';
                    // #4161: красный «просрочено: N» — только когда есть просроченные задания.
                    if (overdueCount > 0) qPanel.appendChild(overdueQualitySpan());
                    box.appendChild(qPanel);
                }
            } catch (e) { console.warn('[pp] панель качества плана пропущена:', e && e.message); }
        }
        box.appendChild(groupEl);
        console.log('[pp] 📊 renderQueue: отрисовано за ' + (Date.now() - t0) + 'мс. групп:', groups.length, 'резок:', self.cuts.length);
        } finally {
            this._renderingQueue = false;
        }
    };

    // #4404 п.2: подписи связанных позиций задания — РОВНО те строки, что показывает панель
    // «Связанные позиции» (.atex-pp-linked). Один источник на два места: панель и title карточки
    // очереди, иначе они разъезжаются. Пусто → связей нет.
    AtexProductionPlanning.prototype.cutLinkedLabels = function(cut) {
        var self = this;
        if (!cut) return [];
        // #4434 п.4: у продолжения день-сплита своих «Обеспечений» нет — читаем по голове цепочки.
        var linkHostId = supplyHostCutId(cut, this.supplies);
        var linked = (this.supplies || []).filter(function(s) { return String(s.cutId) === linkHostId; });
        if (!linked.length) return [];
        var posById = {};
        (this.positions || []).forEach(function(p) { posById[p.id] = p; });
        // #3892: метраж — по ВСЕЙ резке (длина прогона одинакова у всех сегментов цепочки, #3781),
        // а не из делёного «Метраж, м» сегмента.
        var cutRunLen = cutRunLength(cut, this.supplies, this.positionLengthById);
        return linked.map(function(s) {
            var foot = cutRunLen > 0 ? cutRunLen : supplyFootage(s, self.footageBySupply);
            return formatLinkedPositionLabel(posById[s.positionId], s.positionId, s.rolls, foot,
                s.orderNo, s.positionWidth, s.positionLength);
        });
    };

    // #4404 п.2: тот же список одной строкой — для title карточки очереди.
    AtexProductionPlanning.prototype.cutLinkedTitle = function(cut) {
        var labels = this.cutLinkedLabels(cut);
        if (!labels.length) return 'Связанных позиций нет';
        return 'Связанные позиции (' + labels.length + '):\n' + labels.join('\n');
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

        // Связанные позиции задания: список + отвязка. #4428: «+ позиция» (#4426) отсюда убрана —
        // она живёт в плашке задания рядом с «+ полоса» (openStrips), потому что добавление
        // позиции теперь МЕНЯЕТ СОСТАВ ПОЛОС (новая полоса в остаток джамбо), а не только связи.
        var linked = this.supplies.filter(function(s) { return String(s.cutId) === String(cut.id); });
        var listWrap = el('div', { class: 'atex-pp-linked' });
        listWrap.appendChild(el('div', { class: 'atex-pp-linked-head' }, [
            el('h3', { class: 'atex-pp-linked-title', text: 'Связанные позиции (' + linked.length + ')' }),
            el('span', { class: 'atex-pp-linked-hint', text: 'добавить — «+ позиция» в «Полосах»' })
        ]));
        if (!linked.length) {
            listWrap.appendChild(el('div', { class: 'atex-pp-empty', text: 'Пока нет связей.' }));
        } else {
            // #4404 п.2: подписи — через общий cutLinkedLabels (тот же источник, что title карточки).
            var labels = this.cutLinkedLabels(cut);
            linked.forEach(function(s, i) {
                var label = labels[i];
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
        // #4418: важное сообщение (ошибка/предупреждение) НЕ исчезает само — оператор не успевает
        // его прочитать («не успеваю прочитать красное сообщение — оно исчезает»). Такой тост живёт,
        // пока его не закроют кнопкой «×». Обычные (info/success) по-прежнему уходят сами через 3.5 с,
        // но кнопка закрытия есть у всех — длинный текст можно убрать сразу.
        var sticky = (kind === 'error' || kind === 'warning');
        var toast = el('div', { class: 'atex-pp-toast atex-pp-toast-' + (kind || 'info') + (sticky ? ' is-sticky' : '') });
        toast.appendChild(el('span', { class: 'atex-pp-toast-text', text: message }));
        // #4442: СТОПКА сообщений. Висящие тосты (ошибка/предупреждение живут до «×», #4418) ложились
        // ТОЧНО друг на друга — видно только последнее, а сколько их под ним, не понять. Держим живые
        // тосты списком и раскладываем каскадом: каждое следующее чуть выше предыдущего и поверх него,
        // у нижних видна кромка. Пересчитываем и при добавлении, и при закрытии — иначе в стопке
        // остаются дыры.
        var stack = this._toastStack = this._toastStack || [];
        function restack() {
            var layout = toastStackLayout(stack.length);
            stack.forEach(function(t, i) {
                t.style.bottom = layout[i].bottom + 'px';
                t.style.zIndex = String(layout[i].zIndex);
            });
        }
        var closed = false;
        function dismiss() {
            if (closed) return;
            closed = true;
            var at = stack.indexOf(toast);
            if (at >= 0) stack.splice(at, 1);
            restack();
            toast.classList.remove('is-visible');
            setTimeout(function() { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 300);
        }
        var closeBtn = el('button', { class: 'atex-pp-toast-close', type: 'button', text: '×',
            title: 'Закрыть сообщение' });
        closeBtn.addEventListener('click', function(e) {
            if (e && e.stopPropagation) e.stopPropagation();
            dismiss();
        });
        toast.appendChild(closeBtn);
        (this.toastHost || document.body).appendChild(toast);
        stack.push(toast);
        restack();
        setTimeout(function() { toast.classList.add('is-visible'); }, 10);
        if (!sticky) setTimeout(dismiss, 3500);
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
        // #4402: узел липкой панели непринятого плана «Упорядочить» — ПЕРВЫМ в рабочем месте, во
        // всю его ширину (position: sticky). Пустой узел скрыт (:empty), наполняет renderPlanPreviewBar.
        this.planBarEl = el('div', { class: 'atex-pp-plan-bar-host' });
        this.root.appendChild(this.planBarEl);
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
        // #4346: «Отклонения N/M/K» — красная кнопка-сигнал расхождения факта с планом: N просроченных
        // (плановый день раньше сегодня, «Закончено» пусто), M выполненных досрочно («Закончено»
        // раньше планового дня), K делающихся раньше плана («Начато» раньше планового дня, проходы
        // отмечены, «Закончено» пусто — #4584/#4593). Подпись и видимость проставляет renderQueue: нет
        // отклонений — кнопки нет. Последняя в ряду, чтобы не сдвигать привычные кнопки.
        var devBtn = el('button', { class: 'atex-pp-btn atex-pp-btn-danger atex-pp-dev-btn', type: 'button', text: 'Отклонения' });
        devBtn.style.display = 'none';
        devBtn.addEventListener('click', function() { self.openDeviations(); });
        this.devBtn = devBtn;
        queueActions.appendChild(genSpinner);
        queueActions.appendChild(genBtn);
        queueActions.appendChild(addBtn);
        queueActions.appendChild(orderBtn);
        queueActions.appendChild(fixBtn);
        queueActions.appendChild(delBtn);
        queueActions.appendChild(downtimeBtn);
        queueActions.appendChild(devBtn);   // #4346
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
                        return self.loadDowntimes();   // #3764: окна простоя — после списка станков
                    }).then(function() {
                        // #4596: события смены — после списка станков: у старых событий станок
                        // задан только подписью, и опознать его можно лишь по справочнику.
                        return self.loadShiftEvents();
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
                    self.loadFreeze(),         // #4326: замороженные дни («замок дня») — планирование их не трогает
                    self.loadSupplyFootage(),  // метраж обеспечений (длительность/расписание)
                    self.loadConsumption(),    // расход сырья (FIFO-резерв, Фаза 1b)
                    self.loadSleeveBatches(),  // #3340: партии втулок «в работе» (FIFO) + втулкорез TC-20
                    self.loadActualWidths(),   // #3372: справочник фактической ширины резки (66190)
                    self.loadSleeveInches(),   // #3372: дюймы втулки по записи 8188 (контекст условия)
                    self.loadSleeveWidths(),   // #3812: ширина втулки (мм) по записи (57/110) — втулочные полосы
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
