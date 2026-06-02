# D3a кнопка «Запланировать» — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Подключить движок D2 (`orderCuts`) к реальным резкам: расширить отчёт сигналами, собрать дескрипторы, кнопка «Запланировать» раскладывает очередь по станкам и сохраняет «Очередность».

**Architecture:** Отчёт `cut_planning` дополняется колонками-сигналами (live). `rowsToPlanning` строит дескриптор движка. Чистая `planQueues(cuts, weights?)` (группировка по станку + `orderCuts` + нумерация) — тестируема. Кнопка «Запланировать» → planQueues → `_m_set` «Очередность» → reload.

**Tech Stack:** ES5, Integram REST (`report/`, `_m_new/28`, `_m_set`), node-тесты.

**Спека:** `docs/superpowers/specs/2026-06-01-planning-run-design.md`. Эпик ideav/atex#52, D3a (стек на D2 #3074). Live req-id (подтверждены): Партия→Вид сырья=1117, Партия→Остаток,м=8456, Тип резки→Итого ножей=1107, Позиция→Тип намотки=8463, Позиция→Ширина=1141, Резка→Партия=1159, Резка→Очередность=8465. Отчёт cut_planning=8384.

---

## Task 1: Расширить отчёт cut_planning (live) + документация

**Files:** Modify `docs/integram-reports.md` (live делает контроллер по токену, идемпотентно).

- [ ] **Step 1: (live) добавить 7 колонок в cut_planning (8384)**
  `_m_new/28 up=8384 t28={reqId} t100={имя}`; для id-колонок затем `_m_set/{colId} t104=85` (abn_ID):
  | t100 | t28 (reqId) | abn_ID? |
  |---|---|---|
  | cut_material_id | 1117 | да (t104=85) |
  | cut_material | 1117 | нет |
  | cut_batch_id | 1159 | да |
  | cut_jumbo_remaining | 8456 | нет |
  | cut_knives | 1107 | нет |
  | cut_winding | 8463 | нет |
  | cut_roller_width | 1141 | нет |
  Идемпотентно: сперва прочитать `object/28?F_U=8384&JSON_OBJ` — пропустить уже существующие имена.
  Проверить: `report/cut_planning?JSON_KV&LIMIT=0,1` отдаёт новые ключи; `metadata?JSON` валиден.

- [ ] **Step 2: документация**
  В `docs/integram-reports.md` (раздел про cut_planning или новый): перечислить новые колонки + источники + назначение (сигналы движка D2). Факты, стиль repo.

- [ ] **Step 3: Commit**
  ```bash
  git add docs/integram-reports.md
  git commit -m "docs(#52): cut_planning += сигналы движка (материал/намотка/ножи/остаток/ширина)"
  ```

---

## Task 2: rowsToPlanning дескриптор + planQueues (TDD)

**Files:** Modify `download/atex/js/production-planning.js`, `experiments/atex-production-planning.test.js`.

- [ ] **Step 1: Падающие тесты**
  Добавить (assertEqual-стиль файла):
  ```javascript
  // rowsToPlanning строит дескриптор движка из колонок отчёта
  var rpd = planning.rowsToPlanning([{
    cut_id:'9', cut_no:'1', cut_slitter_id:'10', cut_slitter:'Станок 1',
    cut_material_id:'1241', cut_material:'Фольга 38', cut_batch_id:'700',
    cut_jumbo_remaining:'350', cut_knives:'14', cut_winding:'out', cut_roller_width:'60',
    cut_sequence:'', supply_id:''
  }]);
  var c = rpd.cuts[0];
  assertEqual(c.materialId, '1241', 'descriptor materialId');
  assertEqual(c.batchId, '700', 'descriptor batchId');
  assertEqual(c.jumboRemainingM, 350, 'descriptor jumboRemainingM number');
  assertEqual(c.knifeCount, 14, 'descriptor knifeCount number');
  assertEqual(c.winding, 'OUT', 'descriptor winding normalized');
  assertEqual(c.rollerWidth, 60, 'descriptor rollerWidth number');
  assertEqual(c.isFoil, true, 'descriptor isFoil по имени «Фольга 38»');
  assertEqual(c.knifeWidths, [], 'descriptor knifeWidths пусто (v1)');
  // planQueues: по станкам orderCuts, sequence 1..N на станок, «без станка» исключён
  var pcuts = [
    { id:'1', slitter:{id:'10',label:'С1'}, materialId:'A', winding:'IN', batchId:'b1', jumboRemainingM:0, knifeCount:4, knifeWidths:[], isFoil:false, rollerWidth:60 },
    { id:'2', slitter:{id:'10',label:'С1'}, materialId:'A', winding:'IN', batchId:'b1', jumboRemainingM:0, knifeCount:4, knifeWidths:[], isFoil:false, rollerWidth:40 },
    { id:'3', slitter:{id:null,label:''}, materialId:'A', winding:'IN', batchId:'b1', jumboRemainingM:0, knifeCount:4, knifeWidths:[], isFoil:false, rollerWidth:50 }
  ];
  var pq = planning.planQueues(pcuts);
  assertEqual(pq.length, 2, 'planQueues: «без станка» исключён');
  assertEqual(pq.filter(function(x){return x.slitterId==='10';}).map(function(x){return x.sequence;}).sort(), [1,2], 'planQueues: sequence 1..N на станок');
  ```
  Run → FAIL.

- [ ] **Step 2: Дескриптор в rowsToPlanning**
  В `rowsToPlanning`, в объект резки (где `id/number/slitter/...`), добавить:
  ```javascript
  materialId: str(row.cut_material_id),
  materialName: str(row.cut_material),
  batchId: str(row.cut_batch_id),
  jumboRemainingM: (row.cut_jumbo_remaining == null || row.cut_jumbo_remaining === '') ? 0 : Number(row.cut_jumbo_remaining),
  knifeCount: (row.cut_knives == null || row.cut_knives === '') ? 0 : Number(row.cut_knives),
  knifeWidths: [],
  winding: normWinding(row.cut_winding),
  rollerWidth: (row.cut_roller_width == null || row.cut_roller_width === '') ? 0 : Number(row.cut_roller_width),
  isFoil: /фольг/i.test(str(row.cut_material)),
  ```
  (`normWinding` — из ядра planning, D2; `str` — уже есть в rowsToPlanning.)

- [ ] **Step 3: planQueues в ядре planning**
  Рядом с `orderCuts`:
  ```javascript
  // Разложить очередь по станкам: группировка по слиттеру (без станка — пропуск),
  // orderCuts на каждый, нумерация 1..N. → [{cutId, slitterId, sequence}].
  function planQueues(cuts, weights){
      var bySlitter = {}, order = [];
      (cuts || []).forEach(function(c){
          var s = c && c.slitter && c.slitter.id;
          if (s == null) return;
          var key = String(s);
          if (!bySlitter[key]) { bySlitter[key] = []; order.push(key); }
          bySlitter[key].push(c);
      });
      var out = [];
      order.forEach(function(key){
          orderCuts(bySlitter[key], weights).forEach(function(c, i){
              out.push({ cutId: c.id, slitterId: key, sequence: i + 1 });
          });
      });
      return out;
  }
  ```
  Экспортировать `planQueues` в `var planning = {...}`.

- [ ] **Step 4: Run → PASS** + `node -e "require('./download/atex/js/production-planning.js'); console.log('ok')"`.

- [ ] **Step 5: Commit**
  ```bash
  git add download/atex/js/production-planning.js && git add -f experiments/atex-production-planning.test.js
  git commit -m "feat(#52): planning — дескриптор резки из отчёта + planQueues (по станкам)"
  ```

---

## Task 3: Кнопка «Запланировать» (DOM)

**Files:** Modify `download/atex/js/production-planning.js`.

- [ ] **Step 1: Прочитать панель управления + reload + _m_set + модалки**
  READ: где рендерится кнопка «Создать резку» (~стр. 782), `reload()`, как делается `_m_set` (createCut/правки), `notify`, `setBusy`, и есть ли модалка подтверждения (правило: не `confirm()`, а модалка — см. WORKSPACE_DEVELOPMENT_GUIDE). Подтвердить, что у резки есть reqId «Очередность» (резолв по имени, 8465 на live).

- [ ] **Step 2: Добавить кнопку + обработчик**
  - Рядом с «Создать резку» добавить кнопку **«Запланировать»** (`atex-pp-btn`).
  - Обработчик `runPlanning()`:
    1. модалка подтверждения «Перезаписать очередь автопланированием?» (как принято в РМ; не `confirm`).
    2. `var plan = planning.planQueues(this.cuts);` (this.cuts — текущие резки с дескрипторами из rowsToPlanning).
    3. Для каждого `{cutId, sequence}` из плана — если текущая «Очередность» резки != sequence, `_m_set/{cutId}` поле «Очередность»=sequence (reqId по имени). Собрать промисы (последовательно/Promise.all с разумным лимитом), `setBusy(true)`.
    4. По завершении: `reload()` + `notify('Запланировано ' + plan.length + ' резок', 'success')`.
    5. Ошибки — `notify(..., 'error')`, `setBusy(false)`.
  - Мини-сводку (сколько станков/резок) можно в нотификацию.

- [ ] **Step 3: Проверка + commit**
  Ядро-тесты PASS (`node experiments/atex-production-planning.test.js`); DOM проверить чтением. Прочитать `runPlanning` после правки — кнопка зовёт planQueues, сохраняет только изменённые, reload.
  ```bash
  git add download/atex/js/production-planning.js
  git commit -m "feat(#52): production-planning — кнопка «Запланировать» (orderCuts по станкам + сохранение Очередности)"
  ```

---

## Task 4: Документация + полный прогон

**Files:** Modify `docs/atex_workplaces.md`.

- [ ] **Step 1:** В §3.3 добавить: кнопка «Запланировать» (роль Диспетчер) — раскладывает очередь по станкам движком `orderCuts` (через `planQueues`) и сохраняет «Очередность»; сигналы движка из отчёта `cut_planning` (материал/намотка/остаток/ножи/ширина/Фольга); веса в `PLANNING_WEIGHTS`. Генерация резок и ручная правка — D3b/D3c. Сверить имена.

- [ ] **Step 2: Полный прогон**
  ```bash
  node experiments/atex-production-planning.test.js
  node experiments/test-issue-52D-winding.js
  node experiments/test-issue-2911-atex-orders.js
  node experiments/atex-cut-calc.test.js
  ```
  Все PASS.

- [ ] **Step 3: Commit**
  ```bash
  git add docs/atex_workplaces.md
  git commit -m "docs(#52): D3a — кнопка «Запланировать» (движок на реальных данных)"
  ```

---

## Деплой
Клиентский `production-planning.js` → atex→ateh через `update.php`. Колонки отчёта cut_planning — на live (Task 1, агентом).

## Self-review заметки
- Покрытие спеки: отчёт-сигналы — Task 1; дескриптор+planQueues — Task 2; кнопка — Task 3; доки — Task 4.
- Имена: `planQueues` (ядро); поля дескриптора (materialId/winding/batchId/jumboRemainingM/knifeCount/rollerWidth/isFoil); колонки отчёта `cut_*`.
- planQueues — чистая, тестируется; кнопка/_m_set — DOM, чтением. Вне D3a: генерация (D3b), reorder (D3c).
