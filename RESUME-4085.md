# RESUME #4085 — полный слот-движок вставки (#3985)

> **Как продолжить:** скажи агенту «**продолжаем #4085**». Он прочитает этот файл и продолжит
> с незакрытой стадии. Если worktree в /tmp пропал — пересоздать:
> `git -C /home/hive/crm worktree add <путь> issue-4085-planning-tz`, затем прочитать этот файл.

## Якоря
- **Issue:** #4085 (база #3985). Репо `/home/hive/crm`, работаем под gh `ideav`.
- **Ветка:** `issue-4085-planning-tz` (от `origin/main`).
- **Worktree:** `/tmp/claude-1000/-home-hive-crm/5798dead-618f-4480-a69d-4213862d0cf1/scratchpad/wt-4085`
- **План (полный):** `/home/hive/.claude/plans/sparkling-greeting-karp.md`
- **Память:** `atex-pp-4085-slot-engine` (в MEMORY.md).
- **PR НА КАЖДУЮ СТАДИЮ (стеком):** интеграция копится в `issue-4085-planning-tz`; на каждую стадию
  режем `issue-4085-s<N>-<slug>` в точке коммита стадии, base = ветка ПРЕДЫДУЩЕЙ стадии (s0 base=main).
  PR: **#4086 (s0)**, **#4087 (s1)**. Дальше s2 base=`issue-4085-s1-scorer`, и т.д.

## Суть
Размещение переписываем на модель #3985: перебор ВСЕХ точек вставки (пары соседних слотов на всех станках) по минимальному штрафу (вес+«качество»); срок/фольга — ЛОКАЛЬНЫЕ штрафы; веса из «Настройки».
Тайминг остаётся в `splitMachineQueue`. Новый модуль `production-planning/15-slot-placement.js`.
Балансировку (`rebalanceSlitterLoad`) УБИРАЕМ (баланс из члена `MAX_DISTANCE`). Дрейф (EDD-терм 10:2458,
жёсткая фольга, резерв #4068) снимаем.

## Стадии (детали — в плане)
- [x] **0 — Характеризация** ✅ `...-4085-characterization.test.js` (8/8): дробление, фольга-последней, EDD, обед, нахлёст, отпуск, продолжение
- [x] **1 — Достроить scorer** ✅ `...-4085-scorer.test.js` (20/20): `EXACT_DEADLINE` (day==due) в `transitionCost`, `dayKeyFromOffset` в 00-core (+экспорт), пример §8.3=3/2. Веса уже плоско в opts (makePlanningOptions). ВСЁ МЁРТВОЕ (нет живого вызова) → поведение не изменилось.
- [x] **2 — Модуль `15-slot-placement.js`** ✅ `...-4085-slot-placement.test.js` (19/19): seedOccupancy, prefixDayOffset (порт packMachine), scorePosition, placeSlot/placeAllSlots (перебор всех точек, §8.4-исключение), canInsertAt (запрет в цепочку), relocatePass (фольга/просрочка). Экспортирован в `planning`. НЕ врезан.
- [x] **3 — Режим `orderAuthoritative` в `splitMachineQueue`** ✅ `...-4085-order-authoritative.test.js` (5/5): ключ selectByConfig → [idx], фольга/EDD не переигрывают порядок; дефолт off (характеризация 8/8, 12 existing green).
- [x] **4 — Врезка в движок (gated)** ✅ `...-4085-slotplacement-wiring.test.js` (5/5): `opts.slotPlacement` в `planCutOperations` → `computeSlotPlacement` (станок+порядок), `orderAuthoritative`, без резерва #4068, `slitterId` в updates. Дефолт OFF. Едина для Reorder+Generate (оба через planCutOperations). Живое поведение НЕ тронуто.
- [~] **6-доки (ТЗ)** ✅ `docs/atex_planning_tz.md` приведён к чистой #3985: §8.1 «ВСЕ пары/глоб.минимум», §8.2 срок=локальный штраф (DEADLINE день>срока / EXACT день=сроку / раньше=0), §11 баланс из MAX_DISTANCE, §12 перенос=CHANGE_SLITTER/DAY, §12.1 фольга=штраф+всплытие (не резерв), §14 DEADLINE/EXACT. (Алгоритм-док — с живым флипом.)
- [x] **5 — ЖИВОЙ ФЛИП в контроллере (за флагом `SLOT_PLACEMENT`, дефолт OFF)** ✅ `...-4085-slot-flag.test.js` (8/8) + весь existing-прогон 100/100 (единственный FAIL 3619 — предсуществует на origin/main, не мой). Врезка:
  - `slotPlacementOn()` (20 перед buildSequenceOps): читает «Настройку» `SLOT_PLACEMENT=1`; дефолт (нет настройки) → false → прежний путь.
  - `buildSequenceOps` (20): `slotPlacement:slotOn` + `slitterIds`, `dueKeyByCut`(YYYYMMDD), `feasibleMachineFor`(стоп-лист+`isSlitterWidthBlocked`), `machineDayOffFor`(`dayIsWorking`/`slitterOnVacationDay`). slotOn защищён `typeof self.slotPlacementOn==='function'` (стаб-self в юнит-тестах, регрессия 4074 → фикс).
  - Персист станка: `applySplitPlan` пишет «Слиттер» из `u.slitterId` (update-loop, только если ≠хранимого) и в create продолжений (`upd.slitterId`); в не-слот-режиме `slitterId`=undefined → ничего не пишется (контракт прежний, доказано existing 100/100).
  - Ретайр rebalance: `runGenerateCuts` `rebalanceGeneratedLoad` — `if slotPlacementOn() return` (баланс из MAX_DISTANCE).
  - ⚠️ **Флаг-ON НЕ верифицирован в этой среде** (report/object таймаутят) — включить `SLOT_PLACEMENT=1` и проверить на ateh (Гант/сроки/переналадки/баланс) ПЕРЕД снятием дрейфа.
  - Доки: ТЗ (§8/11/12/14) уже под #3985; алгоритм-док — врезана заметка «Опт-ин: слой размещения (`SLOT_PLACEMENT`)» в Фазу 3.
- [x] **6-код — ДРЕЙФ СНЯТ + дефолт ON** ✅ (валидация флага на ateh подтверждена пользователем). `slotPlacementOn()` дефолт ON (выкл только `SLOT_PLACEMENT=0`). Удалено: `deadlineCostFor`+EDD-терм из `selectByConfig`, `deadlineAware`/`deadlineW`/`dueDayByCut`-плюминг; `rest.concat(foil)` в `orderCuts` + isFoil в preserveOrder-сорте + isFoil в selectByConfig-ключе; `computeFoilDeadlineReservation`+резерв-врезка (потребление в цикле упаковки оставлено инертным, кормится пустыми картами = проверенный на ateh режим). **Фикс foil-last (#3717):** в `computeSlotPlacement` подвижная нефольга размещается ПЕРВОЙ, фольга — после (штраф FOIL_NOTEND надёжно уводит её в конец дня; жадная вставка «по одному» иначе могла оставить фольгу не последней). Тесты: весь прогон 101/1 (3619 предсуществует на origin/main); дрейф-тесты 4050/4059/4068 переписаны (срок/веса/резерв-снят), фольга-тесты 3717/3999/3923/3974 → слой размещения, 4074 → слот. Доки: ТЗ (§8/11/12/14), алгоритм-док (Фаза 3: слой размещения = дефолт, откат SLOT_PLACEMENT=0), CLAUDE.md (#3717 инвариант = штраф).

**#4085 ЗАКРЫТ:** все 7 стадий (0–6) сделаны. Модель #3985 — живая по умолчанию; дрейф снят.
- ТЗ `docs/atex_planning_tz.md` + алгоритм-док — в PR соответствующих стадий.

## Журнал (что сделано)
- 2026-07-07: планирование завершено, план одобрен. Код НЕ начат. Коммитов кода ещё НЕТ (только этот RESUME).
- 2026-07-07: стадии 0–4 закоммичены и запушены (PR #4086–#4090, стек). Движок размещения #3985 готов и gated.
- 2026-07-07: **стадия 5** — живой флип за флагом `SLOT_PLACEMENT` (дефолт OFF); ТЗ приведён к чистой #3985;
  заметка в алгоритм-док. Тесты: slot-flag 8/8, весь existing 100/100 (3619 предсуществует на main). PR #4091 (стеком на s4).
- 2026-07-07: пользователь подтвердил валидацию `SLOT_PLACEMENT=1` на ateh → **стадия 6**: дефолт ON, дрейф
  (EDD/жёсткая фольга/резерв #4068) снят, foil-last через слой размещения (фикс порядка вставки нефольга→фольга).
  Весь прогон 101/1 (3619 предсуществует). Доки ТЗ/алгоритм/CLAUDE.md синхронизированы. **#4085 закрыт.** PR стадии 6 — стеком на s5.
