# Эпик «Упразднение Типа резки». Подпроект F3: production-planning на ядре cut-layout

**Дата:** 2026-06-02
**Эпик:** [[atex_epic52_planning]]. F2 (схема — Тип резки дропнут, Полоса под Резкой, Срок изготовления, отчёты) и F1 (ядро `cut-layout.js`) готовы.
**Где:** `download/atex/js/production-planning.js` (Диспетчер). Чистое ядро раскладки берём из `cut-layout.js` (F1). Тесты ядра — F1; здесь DOM/сеть проверяем чтением + node-тестами на новые чистые хелперы.

## Цель
Перевести РМ «Планирование производства» с упразднённых фиксированных «Типов резки» на
**динамические полосы под Резкой**: генерация резок из необеспеченных позиций считает
раскладку через `layout.planLayouts` и создаёт Резка+Полоса+Обеспечение; встроенный
редактор полос (на базе cut-calc) правит Полосы конкретной резки с панелью ходовых.

## Убрать (Тип резки упразднён)
Из `production-planning.js`: чистые `matchCutType`/`rollersPerCut`/`generateCutPlan` (+их экспорт и тесты); загрузчики `loadCutTypeIndexAll`/`ensureCutTypeStrips`/`loadCutTypeIndexForMaterials`/`loadCutTypes`; состояние `meta.cutType`/`cutTypeIndex`/`cutTypes`/`cutTypeIndexLoaded`/`cutTypeStripsLoaded`; `TABLE.cutType`/`CUT_REQ.cutType`; в `createCut`/`blankDraft`/`renderForm` — поле и валидация «Тип резки»; в карточке очереди — лейбл `cutType`; вызов загрузки индекса в `start()`. В `rowsToPlanning` поле `cutType` убрать (отчёт `cut_type` уже удалён в F2).

## Сохранить
Чистое ядро очереди `changeoverCost`/`orderCuts`/`planQueues`/`moveInQueue`/`widthSetDistance`/`PLANNING_WEIGHTS`; `isCutVisible` (фильтр очереди); `unsuppliedPositions`/`pickSlitter`/`pickBatchFIFO`; `createCut` (без cutType)/`createSupply`; `saveSequences`/`runPlanning`; рендеры (с правками).

## Добавить / изменить

### 1. Загрузка данных генерации
- `genPositions` (из `positions_list`) — добавить **`dueKey`** из «Срок изготовления» позиции (новая колонка отчёта `position_due_date` → `batchDateKey`/числовой ГГГГММДД; пусто→Infinity). Поля: `{id, materialId, width, qty, dueKey}`.
- `jumboWidthByMaterial` — ширина джамбо = «Вид сырья → Ширина, мм» (1069). Загрузить карту `{materialId: jumboWidth}` (object/1069 или отчёт).
- `preferredByMaterial` — ходовые из `preferable_widths?FR_position_material_id={id}`: `[{width, popularity}]` (popularity = `position_qty_sum`). Лениво по сырью необеспеченных позиций.

### 2. Генерация резок (замена `generateCuts`)
Кнопка «Сгенерировать резки». По подтверждению (модалка):
- Сгруппировать необеспеченные позиции по `materialId`. Для каждого сырья:
  `layout.planLayouts({ jumboWidth: jumboWidthByMaterial[mat], positions: <позиции сырья>, preferred: preferredByMaterial[mat], options:{windowDays:3, tolerance} })`.
  Дефолты вынести в константы модуля: `WINDOW_DAYS=3`, `LAYOUT_TOLERANCE=0` (мм; меняется в коде, как PLANNING_WEIGHTS).
- Для каждой `layout` из результата создать (последовательно, `setBusy`):
  1. **Производственная резка** `_m_new` (Статус «Запланирована»; Слиттер = `pickSlitter` не из стоп-листа + балансировка; Партия сырья = `pickBatchFIFO` старейшая с остатком этого сырья) → cutId.
  2. **Полоса** под резкой: на каждую `strip` `_m_new/{Полоса}?up={cutId}` (Ширина, мм=strip.width; Количество=strip.qty; Назначение=strip.purpose).
  3. **Обеспечение**: на каждый `positionId` из `layout.positionsCovered` — `_m_new/{Обеспечение}?up={positionId}` со ссылкой на cutId (как `createSupply`).
- `reload()` + нотификация «Создано N резок (полос M), пропущено K позиций» (`res.skipped`: «шире джамбо»/«нет ширины джамбо»/«нет сырья»).

### 3. knifeCount/knifeWidths для очереди (D2) — из Полос
`cut_knives` удалён из отчёта (F2). Восстановить для `changeoverCost`/`orderCuts` **клиентом из Полос**:
- Новый лёгкий отчёт **`cut_strips`** (Резка→Полоса: `cut_id` (abn), `strip_width`, `strip_qty`) — создать на live (F3-схема, аддитивно). Грузить вместе с очередью; агрегировать по `cut_id`: `knifeCount = Σ strip_qty`, `knifeWidths = [width×qty…]`. Влить в дескриптор резки (в `rowsToPlanning`/после), чтобы `changeoverCost` работал как в D2.
- Если `cut_strips` создать нельзя/пусто — `knifeCount=0` (как сейчас, деградация очереди), не блокер.

### 4. Встроенный редактор полос (на базе cut-calc)
- Точка входа: кнопка **«Полосы»** на карточке резки в очереди → инлайн-панель (как `renderLink`).
- Панель: таблица полос (Ширина/Количество/Назначение, add/remove строк) + сводка (`computeSummary`: итого ножей, занято, остаток, в допуске) — переиспользовать `renderStrips`/`recalc`/`computeSummary` из cut-calc (вынести в общий хелпер/модуль или продублировать ES5). **Ширина входа (джамбо) и сырьё — авто из Партии сырья резки → Вид сырья (read-only, показываем).** Панель ходовых: для сырья резки — `preferable_widths` (ширина × Популярность=`position_qty_sum`), клик добавляет полосу.
- Сохранение: **сохраняем Полосы** под резкой — `syncStrips` (новые `_m_new/{Полоса}?up={cutId}`, изменённые `_m_set`, удалённые `_m_del`). Тип резки НЕ сохраняем (его нет). После — `reload()`.

## Чистые хелперы (node-тест в production-planning.test.js)
- `aggregateStrips(rows)` — строки `cut_strips` → `{cutId: {knifeCount, knifeWidths:[…]}}`. Чистая, тест.
- Маппинг `genPositions` с `dueKey`; интеграция `planLayouts` — проверяется чтением + ядро F1 уже покрыто.

## Критерии приёмки
- Нет ссылок на «Тип резки» в production-planning.js; модуль грузится в node; ядро очереди и `isCutVisible` тесты зелёные; удалённые D3b-тесты убраны.
- `generateCuts` строит вход `planLayouts` по сырью, создаёт Резка+Полоса+Обеспечение; пропуски — в нотификации.
- Редактор полос открывается на резке, считает сводку, грузит ходовые сырья, сохраняет Полосы (sync), `reload`.
- `aggregateStrips` покрыт node-тестом; очередь использует knifeCount из Полос (если `cut_strips` есть).
- Полный atex-сьют зелёный.

## Схема на live (F3, аддитивно)
- Отчёт **`cut_strips`** (Резка→Полоса): `cut_id`(abn t104=85), `strip_width`(Полоса Ширина,мм), `strip_qty`(Полоса Количество). Плюс **`position_due_date`** в `positions_list` (Позиция «Срок изготовления» 8627). Создать мной, проверить прогоном. Бэкап — [[feedback_integram_backup_before_irreversible]] (правлю только отчёты — обратимо, но придерживаемся правила).

## Деплой
`production-planning.js` (+ возможный общий strip-editor хелпер) → atex→ateh `update.php` (Андрей). Отчёты `cut_strips`/`position_due_date` — на live мной.

## Вне F3
- F4: зачистка orders.js (фича C уже убрана #3089) — показать «Срок изготовления» на форме заказа неприметно; cut-calc.js ретайр/вынос ядра; cut-map.js — полосы из Резки; доки. Точная оптимизация раскладки/комбинирование сверх жадности — позже.
