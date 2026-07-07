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
Размещение переписываем на модель #3985: перебор ВСЕХ точек вставки (пары соседних слотов на всех
станках) по минимальному штрафу (вес+«качество»); срок/фольга — ЛОКАЛЬНЫЕ штрафы; веса из «Настройки».
Тайминг остаётся в `splitMachineQueue`. Новый модуль `production-planning/15-slot-placement.js`.
Балансировку (`rebalanceSlitterLoad`) УБИРАЕМ (баланс из члена `MAX_DISTANCE`). Дрейф (EDD-терм 10:2458,
жёсткая фольга, резерв #4068) снимаем.

## Стадии (детали — в плане)
- [x] **0 — Характеризация** ✅ `...-4085-characterization.test.js` (8/8): дробление, фольга-последней, EDD, обед, нахлёст, отпуск, продолжение
- [x] **1 — Достроить scorer** ✅ `...-4085-scorer.test.js` (20/20): `EXACT_DEADLINE` (day==due) в `transitionCost`, `dayKeyFromOffset` в 00-core (+экспорт), пример §8.3=3/2. Веса уже плоско в opts (makePlanningOptions). ВСЁ МЁРТВОЕ (нет живого вызова) → поведение не изменилось.
- [x] **2 — Модуль `15-slot-placement.js`** ✅ `...-4085-slot-placement.test.js` (19/19): seedOccupancy, prefixDayOffset (порт packMachine), scorePosition, placeSlot/placeAllSlots (перебор всех точек, §8.4-исключение), canInsertAt (запрет в цепочку), relocatePass (фольга/просрочка). Экспортирован в `planning`. НЕ врезан.
- [x] **3 — Режим `orderAuthoritative` в `splitMachineQueue`** ✅ `...-4085-order-authoritative.test.js` (5/5): ключ selectByConfig → [idx], фольга/EDD не переигрывают порядок; дефолт off (характеризация 8/8, 12 existing green).
- [ ] **4 — Врезать Reorder/move** (`planMachineSegs` 10:3219, за opts-флагом) ← ТЕКУЩАЯ
- [ ] 5 — Врезать Generate (`runGenerateCuts` 20:3609) + ретайр `rebalanceSlitterLoad`
- [ ] 6 — Снять дрейф (EDD-терм / фольга / резерв #4068)
- ТЗ `docs/atex_planning_tz.md` + алгоритм-док — в PR соответствующих стадий.

## Журнал (что сделано)
- 2026-07-07: планирование завершено, план одобрен. Код НЕ начат. Коммитов кода ещё НЕТ (только этот RESUME).
