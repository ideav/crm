# F3 «production-planning на ядре cut-layout» — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) или superpowers:executing-plans, task-by-task. Steps use checkbox (`- [ ]`).

**Goal:** Перевести `download/atex/js/production-planning.js` с упразднённого «Тип резки» на динамические Полосы под Резкой: генерация через `cut-layout.planLayouts` (Резка+Полоса+Обеспечение), встроенный редактор полос (база cut-calc) + ходовые, knifeCount из Полос.

**Architecture:** ES5 UMD-контроллер `AtexProductionPlanning` + чистое ядро `planning`. Раскладку даёт `window.AtexCutLayout.layout` (F1, модуль `cut-layout.js`). Чистые хелперы покрыты node-тестами (`experiments/atex-production-planning.test.js`); DOM/сеть — проверка чтением (+ фикстуры). Метаданные/реквизиты резолвятся по ИМЕНИ (никаких хардкод-id в коде).

**Tech Stack:** Vanilla ES5, Integram `_m_*`/`report/`, node-тесты.

**Спека:** `docs/superpowers/specs/2026-06-02-abolish-cuttype-F3-production-planning-design.md`. Карта правок (точные строки removal/keep): см. вывод Explore в истории; перед удалением — `grep -n` для подтверждения.

**Готово на live (F3-схема, мной):** колонка `position_due_date` в `positions_list` (8409); отчёт **`cut_strips`** (8656): `cut_id`(abn Резки), `strip_width`(Полоса «Ширина, мм»), `strip_qty`(Полоса «Количество»). Полоса — подчинённая «Производственной резки» (1078), поля «Ширина, мм»/«Количество»/«Назначение». «Срок изготовления» на Позиции — req по имени.

**Загрузка cut-layout.js:** `index`/шаблон atex должен подключать `cut-layout.js` рядом с `production-planning.js`. Если шаблон `templates/atex/production-planning.html` или сборка перечисляет скрипты — добавить `cut-layout.js` ДО `production-planning.js`. Проверить и при необходимости вписать (Task 1 Step 0).

---

## Task 1: Убрать «Тип резки» из production-planning.js

**Files:** Modify `download/atex/js/production-planning.js`, `experiments/atex-production-planning.test.js`, (возможно) `templates/atex/production-planning.html`.

- [ ] **Step 0:** Подключить `cut-layout.js` в шаблоне/сборке РМ (если скрипты перечисляются явно) — ДО `production-planning.js`. `grep -rn "production-planning.js" templates/ download/ *.html 2>/dev/null`.
- [ ] **Step 1: Убрать чистые D3b-функции** из объекта `planning`: `matchCutType`, `rollersPerCut`, `cutsNeeded`, `generateCutPlan` и их экспорт. (Оставить `unsuppliedPositions`, `pickSlitter`, `pickBatchFIFO`, `changeoverCost`, `orderCuts`, `planQueues`, `moveInQueue`, `widthSetDistance`, `isCutVisible`, `rowsToPlanning`, `buildFields`, `batchDateKey`, и т.д.)
- [ ] **Step 2: Убрать загрузчики и состояние индекса типов:** `loadCutTypeIndexAll`, `ensureCutTypeStrips`, `loadCutTypeIndexForMaterials`, `loadCutTypes`; поля `this.meta.cutType`, `this.cutTypes`, `this.cutTypeIndex`, `this.cutTypeIndexLoaded`, `this.cutTypeStripsLoaded`; `TABLE.cutType`, `CUT_REQ.cutType`. В `loadMetadata` убрать резолв `meta.cutType` и его проверку. В `start()` убрать вызов `loadCutTypeIndexForMaterials`.
- [ ] **Step 3: Убрать «Тип резки» из формы/карточки:** `blankDraft` — поле `cutTypeId`; `createCut` — валидацию «выберите тип» и `cutType` в `reqIds`/`buildFields`; `renderForm` — `cutType` selectRef; `renderQueue` карточка — span `atex-pp-cut-type`; `rowsToPlanning` — поле `cutType` в дескрипторе (и в тесте формы `mapCutRecord`/`rowsToPlanning` обновить ожидания).
- [ ] **Step 4: Убрать D3b-тесты** в `experiments/atex-production-planning.test.js`: блоки `matchCutType`/`rollersPerCut`/`cutsNeeded`/`generateCutPlan` (и связанные фикстуры `gIdx`/`gIn`). Тесты `rowsToGenPositions`/`batchDateKey`/`unsuppliedPositions`/`pickSlitter`/`pickBatchFIFO`/очередь/`isCutVisible` — оставить (поправить ожидания где был `cutType`).
- [ ] **Step 5: Проверка** — `node experiments/atex-production-planning.test.js` PASS (без удалённых); `node -e "require('./download/atex/js/production-planning.js'); console.log('ok')"`. `grep -n "Тип резки\|cutType\|cutTypeIndex" download/atex/js/production-planning.js` → пусто (кроме, возможно, комментариев — убрать).
- [ ] **Step 6: Commit** `refactor(atex): production-planning — убрать «Тип резки» (упразднён), D3b-генерацию и индекс типов`.

---

## Task 2: Загрузка данных генерации + knifeCount из Полос (TDD на чистом)

**Files:** Modify `download/atex/js/production-planning.js`, `experiments/atex-production-planning.test.js`.

- [ ] **Step 1: Падающий тест `aggregateStrips`:**
```javascript
// строки отчёта cut_strips (JSON_KV) → { cutId: {knifeCount, knifeWidths:[...]} }
var agg = planning.aggregateStrips([
  { cut_id:'10', strip_width:'110', strip_qty:'2' },
  { cut_id:'10', strip_width:'70',  strip_qty:'1' },
  { cut_id:'20', strip_width:'50',  strip_qty:'3' }
]);
assertEqual(agg['10'].knifeCount, 3, 'aggregateStrips: cut10 ножей 2+1=3');
assertEqual(agg['10'].knifeWidths.slice().sort(function(a,b){return a-b;}), [70,110], 'aggregateStrips: cut10 ширины ножей (по полосе)');
assertEqual(agg['20'].knifeCount, 3, 'aggregateStrips: cut20 ножей 3');
assertEqual(agg['10'].knifeWidths.length, 3, 'aggregateStrips: knifeWidths развёрнут по qty (110,110,70)');
```
  (Решение: `knifeWidths` — массив ширин, развёрнутый по qty: полоса 110×2 → [110,110]; нужно для `widthSetDistance`.)
- [ ] **Step 2: Запустить — FAIL.**
- [ ] **Step 3: Реализовать `aggregateStrips(rows)`** (чистая, экспорт в `planning`): группировать по `cut_id`; `knifeCount += Number(strip_qty)`; `knifeWidths` — push `Number(strip_width)` ×`strip_qty` раз. Вернуть карту. Вход не мутирует.
- [ ] **Step 4: Запустить — PASS.**
- [ ] **Step 5: Загрузчики (DOM/сеть)** — реализовать в контроллере:
  - `loadCutStrips()` → `report/cut_strips?JSON_KV&LIMIT=0,5000` → `this.stripAgg = planning.aggregateStrips(rows)`; в `loadPlanning`/после сборки `this.cuts` влить `knifeCount`/`knifeWidths` в дескриптор каждой резки из `this.stripAgg[cutId]` (если нет — 0/[]).
  - `genPositions` (из `positions_list`) — добавить `dueKey` = `batchDateKey(row.position_due_date)` (поле уже в отчёте).
  - `loadJumboWidths()` → карта `{materialId: jumboWidth}` из «Вид сырья» (object/{Вид сырья}/?JSON_OBJ, поле «Ширина, мм»); резолв таблицы/поля по имени.
  - `loadPreferredWidths(materialId)` → `report/preferable_widths?JSON_KV&FR_position_material_id={materialId}` → `[{width:Number(position_width_mm), popularity:Number(position_qty_sum)}]`; кешировать по сырью.
  - Вписать `loadCutStrips`/`loadJumboWidths` в `start()` цепочку (рядом с loadPlanning/loadGenBatches).
- [ ] **Step 6: Проверка** — node-тесты PASS; модуль грузится; прочитать загрузчики (резолв по имени, нет хардкодов).
- [ ] **Step 7: Commit** `feat(atex): production-planning — aggregateStrips (knifeCount из Полос) + загрузка dueKey/джамбо/ходовых`.

---

## Task 3: Генерация резок через cut-layout (замена generateCuts)

**Files:** Modify `download/atex/js/production-planning.js`.

- [ ] **Step 1: Прочитать** текущий `generateCuts`, `createCut`, `createSupply`, `pickSlitter`/`pickBatchFIFO`, `setBusy`/`notify`/`reload`, инлайн-подтверждение (`runPlanning` модалка).
- [ ] **Step 2: Константы** модуля: `WINDOW_DAYS = 3`, `LAYOUT_TOLERANCE = 0`.
- [ ] **Step 3: Переписать `generateCuts(actionsEl)`:**
  - Необеспеченные позиции = `planning.unsuppliedPositions(this.genPositions, this.supplies)`; сгруппировать по `materialId`.
  - Для каждого сырья `mat`: `jw = this.jumboWidthByMaterial[mat]` (нет → все позиции сырья в `skipped` «нет ширины джамбо»); `pref = this.preferredByMaterial[mat] || []` (догрузить `loadPreferredWidths(mat)` при отсутствии); `res = window.AtexCutLayout.layout.planLayouts({ jumboWidth: jw, positions: <позиции mat {id,width,qty,dueKey}>, preferred: pref, options:{ windowDays:WINDOW_DAYS, tolerance:LAYOUT_TOLERANCE } })`.
  - Подтверждение (модалка как в runPlanning): «Создать резки под N необеспеченных позиций (раскладок M)?».
  - Последовательная цепочка (`setBusy(true)`): на каждую `layout`:
    1. `_m_new/{meta.cut.id}?JSON&up=1&full=1` с полями (по имени): Статус=`CUT_STATUSES[0]` («Запланирована»), Слиттер=`planning.pickSlitter(this.slitters, mat, loadBySlitterId)` (вести счётчик загрузки), Партия сырья=`planning.pickBatchFIFO(this.genBatches, mat)`; распарсить cutId (`res.obj||res.id||res.i`).
    2. на каждую `strip` из `layout.strips`: `_m_new/{meta.strip.id}?JSON&up={cutId}` с Ширина,мм=strip.width, Количество=strip.qty, Назначение=strip.purpose. (`meta.strip` = метаданные «Полоса»; резолв по имени — добавить в `loadMetadata`.)
    3. на каждый `positionId` из `layout.positionsCovered`: `_m_new/{meta.supply.id}?JSON&up={positionId}` со ссылкой на cutId (как `createSupply`).
  - Ошибка → notify error + `setBusy(false)` + стоп. Успех → `reload()` + notify «Создано N резок, полос P, пропущено K (причины)».
- [ ] **Step 4: `loadMetadata`** — добавить резолв `this.meta.strip = byName('Полоса')` (подчинённая Резки).
- [ ] **Step 5: Проверка** — node-тесты PASS (ядро не трогали); модуль грузится; перечитать `generateCuts` (последовательность, setBusy, reload, резолв по имени, null-guard слиттера/партии).
- [ ] **Step 6: Commit** `feat(atex): production-planning — генерация резок через cut-layout (Резка+Полоса+Обеспечение)`.

---

## Task 4: Встроенный редактор полос (база cut-calc) + ходовые

**Files:** Modify `download/atex/js/production-planning.js` (+ возможно `download/atex/css/production-planning.css`).

- [ ] **Step 1: Прочитать** в `cut-calc.js`: `renderStrips` (таблица полос add/remove), `recalc`/`computeSummary`, `syncStrips` (сохранение _m_new/_m_set/_m_del Полос), панель ходовых; и в production-planning `renderQueue` карточку + `renderLink` (инлайн-панель — образец).
- [ ] **Step 2: Чистая сводка** — переиспользовать `computeSummary`/`usedWidth`/`totalKnives`/`remainder`: продублировать ES5-хелперы в production-planning (модули самостоятельны) ИЛИ держать в `cut-layout.js`/общем модуле; добавить node-тест если новые чистые функции.
- [ ] **Step 3: Кнопка «Полосы»** на карточке резки в `renderQueue` (рядом, не вкладывая в карточку-кнопку) → `self.openStrips(cut, actionsEl)`.
- [ ] **Step 4: `openStrips(cut)`** — инлайн-панель:
  - Загрузить полосы резки: `object/{meta.strip.id}/?JSON_OBJ&F_U={cutId}` → строки {Ширина,Количество,Назначение} (резолв колонок по имени).
  - Сырьё/ширина джамбо — авто: из `cut.materialId`/`cut.batchId` → `this.jumboWidthByMaterial[cut.materialId]`; показать read-only «Сырьё: …, Джамбо: … мм».
  - Таблица полос (add/remove, Ширина/Количество/Назначение-select) + сводка (итого ножей, занято, остаток vs джамбо, бейдж «в допуске»).
  - Панель **ходовых**: `this.preferredByMaterial[cut.materialId]` (догрузить) — список «ширина × Популярность(qty_sum)», клик добавляет полосу `purpose:'Склад'`.
  - Кнопка «Сохранить полосы» → `saveStrips(cutId, strips, original)`: новые `_m_new/{Полоса}?up={cutId}`, изменённые `_m_set`, удалённые `_m_del`; затем `reload()`. setBusy/notify.
- [ ] **Step 5: Проверка** — node-тесты PASS; модуль грузится; перечитать `openStrips`/`saveStrips` (резолв по имени, sync корректен, нет нативного confirm).
- [ ] **Step 6: Commit** `feat(atex): production-planning — встроенный редактор Полос резки + панель ходовых`.

---

## Task 5: Документация + полный прогон

**Files:** Modify `docs/atex_workplaces.md`, `docs/integram-reports.md`.

- [ ] **Step 1:** `integram-reports.md` — описать отчёт `cut_strips` (cut_id/strip_width/strip_qty) и колонку `position_due_date`; отметить, что `cut_knives` считается клиентом (`aggregateStrips`). `atex_workplaces.md` §3.3 — обновить: генерация резок на cut-layout (Полосы), редактор полос, knifeCount из Полос; убрать упоминания выбора «Тип резки».
- [ ] **Step 2: Полный прогон:**
```bash
node experiments/atex-production-planning.test.js
node experiments/atex-cut-layout.test.js
node experiments/atex-cut-planning.test.js
node experiments/atex-cut-calc.test.js
```
Все PASS.
- [ ] **Step 3: Commit** `docs(atex): F3 — production-planning на cut-layout (генерация Полос, редактор, отчёт cut_strips)`.

---

## Самопроверка плана
- Покрытие спеки: убрать Тип резки=Task1; данные+knifeCount(aggregateStrips)=Task2; генерация=Task3; редактор полос=Task4; доки+прогон=Task5. Схема live (cut_strips/position_due_date) — уже сделана.
- Чистые функции (aggregateStrips, сводка) — TDD; DOM/сеть — чтением.
- Резолв по имени, без хардкод-id; нативный confirm не использовать; setBusy/reload/notify; вход чистых функций не мутируется.

## Деплой
`production-planning.js` (+ css) → atex→ateh `update.php` (Андрей). Отчёты `cut_strips`/`position_due_date` — на live (мной, готово). cut-layout.js подключить в шаблоне РМ.
