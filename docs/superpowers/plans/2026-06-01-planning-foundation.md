# D1 фундамент планирования (Тип намотки + Очередность) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Завести «Тип намотки» (IN/OUT) на Позиции заказа и «Очередность» на Производственной резке; показать их и сортировать очередь по «Очередности» — фундамент для движка D2/D3.

**Architecture:** Поля на live ateh через `_d_*`; колонка `cut_sequence` в отчёт `cut_planning`. В `orders.js` — select «Тип намотки» (паттерн фикс-enum как «Статус»). В `production-planning.js` — чтение `sequence` отчётом и сортировка резок внутри станка по «Очередности». Чистые функции (`normalizeWinding`, сорт в `groupBySlitter`) — тестами.

**Tech Stack:** ES5, Integram REST (`_d_*`, `report/`), кастомные node-тесты `experiments/`.

**Спека:** `docs/superpowers/specs/2026-06-01-planning-foundation-design.md`. Эпик ideav/atex#52, подзадача D1. Live id: Позиция заказа=1076, Производственная резка=1078, отчёт cut_planning=8384. Урок схемных команд — [[feedback_integram_schema_d_commands]].

---

## Task 1: Live-схема + колонка отчёта + metadata-doc

**Files:** Modify `docs/atex_metadata.json` (+ live ateh: фактически делает контроллер по токену, идемпотентно).

- [ ] **Step 1: (live, контроллер) завести поля и колонку отчёта**
  - Позиция заказа (1076): «Тип намотки» — `_d_new t=3 val='Тип намотки'`→col, `_d_req/1076 t={col}` (взять **`id`** ответа!). Строка.
  - Производственная резка (1078): «Очередность» — `_d_new t=13 val='Очередность'`→col, `_d_req/1078 t={col}`→reqId. Число.
  - Отчёт cut_planning (8384): добавить колонку `cut_sequence` ← реквизит «Очередность» (1078): `_m_new/28 up=8384 t28={reqId «Очередность»} t100=cut_sequence`.
  - Проверить: `metadata?JSON` парсится; поля видны; `report/cut_planning?JSON_KV` отдаёт `cut_sequence`.
  - ⚠️ `_d_req` → брать `id` (не `obj`); `_d_alias` НЕ вызывать на id таблицы.

- [ ] **Step 2: metadata-doc**
  В `docs/atex_metadata.json`: Позиция заказа (id 108) += «Тип намотки» (type 3); Производственная резка (id 110) += «Очередность» (type 13). Зеркалить форму обычных реквизитов; новые свободные id; `python3 -c "import json;json.load(open('docs/atex_metadata.json'));print('OK')"`.

- [ ] **Step 3: Commit**
  ```bash
  git add docs/atex_metadata.json
  git commit -m "feat(#52): схема — Позиция заказа += Тип намотки; Производственная резка += Очередность"
  ```

---

## Task 2: orders.js — «Тип намотки» у позиции (TDD)

**Files:** Modify `download/atex/js/orders.js`, `experiments/test-issue-52D-winding.js` (Create).

- [ ] **Step 1: Падающий тест `normalizeWinding`** (vm-sandbox, как `test-issue-2911`/`test-issue-52C`):
  ```javascript
  // загрузка orders.js в vm-sandbox (скопировать harness из test-issue-52C-cuttype-suggest.js)
  assert(typeof T.normalizeWinding === 'function', 'normalizeWinding exposed');
  function eq(a,b,n){ assert.strictEqual(a,b,n); n2++; }
  eq(T.normalizeWinding('IN'),'IN','IN');
  eq(T.normalizeWinding(' out '),'OUT','out→OUT trim/upper');
  eq(T.normalizeWinding('in'),'IN','in→IN');
  eq(T.normalizeWinding(''),'','пусто');
  eq(T.normalizeWinding('xxx'),'','чужое→пусто');
  eq(T.normalizeWinding(null),'','null');
  ```
  Run: `node experiments/test-issue-52D-winding.js` → FAIL.

- [ ] **Step 2: `normalizeWinding` + экспорт**
  В `orders.js` рядом с чистыми хелперами:
  ```javascript
  var WINDING_VALUES = ['IN','OUT'];
  function normalizeWinding(value){
      var s = String(value == null ? '' : value).trim().toUpperCase();
      return (s === 'IN' || s === 'OUT') ? s : '';
  }
  ```
  Добавить `normalizeWinding` (и при необходимости `WINDING_VALUES`) в `window.AtexOrdersTesting`. Run → PASS.

- [ ] **Step 3: Поле «Тип намотки» в форме позиции + сохранение + таблица**
  - В `POSITION_FIELDS` добавить `{ key:'winding', label:'Тип намотки', names:['Тип намотки'] }`.
  - В форме позиции (`renderPositionForm`) добавить `<select>` «Тип намотки» с опциями `['', 'IN','OUT']` (пустая = не задано), по образцу статус-селекта (функция около стр. 550–559) — либо отдельный мелкий select. Значение читать в коллекторе позиции (где читаются `width`/`status`).
  - В `buildCreatePositionRequest` (`put('status', …)`) добавить `put('winding', normalizeWinding(opts.winding))`.
  - В таблице позиций добавить колонку «Тип намотки» (значение `pos.values.winding`).
  - READ соответствующие участки перед правкой; мирроる existing status-паттерн.

- [ ] **Step 4: Тесты + commit**
  `node experiments/test-issue-52D-winding.js` (PASS), `node experiments/test-issue-2911-atex-orders.js` (регрессия PASS).
  ```bash
  git add download/atex/js/orders.js && git add -f experiments/test-issue-52D-winding.js
  git commit -m "feat(#52): orders — поле «Тип намотки» (IN/OUT) у позиции заказа"
  ```

---

## Task 3: production-planning.js — «Очередность»: чтение + сортировка + показ (TDD)

**Files:** Modify `download/atex/js/production-planning.js`, `experiments/atex-production-planning.test.js`.

- [ ] **Step 1: Падающие тесты сортировки по sequence**
  В `experiments/atex-production-planning.test.js` (assertEqual-стиль файла) добавить:
  ```javascript
  // groupBySlitter сортирует резки внутри станка по sequence (возр., пустые в конец)
  var cuts = [
    { id:'1', slitter:{id:'10',label:'Станок 1'}, sequence:2 },
    { id:'2', slitter:{id:'10',label:'Станок 1'}, sequence:1 },
    { id:'3', slitter:{id:'10',label:'Станок 1'}, sequence:null }
  ];
  var g = planning.groupBySlitter(cuts)[0];
  assertEqual(g.cuts.map(function(c){return c.id;}), ['2','1','3'], 'сорт по sequence, пустые в конец');
  // mapCutRecord читает «Очередность» → sequence (число; пусто → null)
  // (добавить кейс по образцу существующего mapCutRecord-теста: запись с «Очередность»)
  ```
  Run → FAIL.

- [ ] **Step 2: sequence в mapCutRecord и rowsToPlanning**
  - В `mapCutRecord` (object/-разбор) добавить в результат `sequence`: читать реквизит «Очередность» (через тот же `val(...)`/`columnIndex` механизм, что для planDate/status), `'' → null`, иначе `Number`.
  - В `rowsToPlanning` (отчёт) в объект резки добавить:
    ```javascript
    sequence: (row.cut_sequence == null || row.cut_sequence === '') ? null : Number(row.cut_sequence),
    ```
  - В `CUT_REQ` добавить `sequence: 'Очередность'` (если mapCutRecord резолвит по имени).

- [ ] **Step 3: сортировка в groupBySlitter**
  В `groupBySlitter`, перед возвратом, отсортировать `cuts` каждой группы по `sequence` (возр., null в конец), стабильно:
  ```javascript
  function seqKey(c){ var s = c && c.sequence; return (s == null || isNaN(Number(s))) ? Infinity : Number(s); }
  // при сборке групп — после наполнения, отсортировать groups[key].cuts:
  Object.keys(groups).forEach(function(k){
      groups[k].cuts = groups[k].cuts.map(function(c,i){return {c:c,i:i};})
          .sort(function(a,b){ return seqKey(a.c)-seqKey(b.c) || a.i-b.i; })
          .map(function(x){return x.c;});
  });
  ```
  (Встроить аккуратно в существующую функцию; группы по-прежнему сортируются по подписи.)

- [ ] **Step 4: показ «Очередности» в очереди**
  В рендере строки резки очереди добавить отображение `c.sequence` (число или «—»). READ участок рендера резки (`atex-pp-cut-…`) перед правкой.

- [ ] **Step 5: Тесты + commit**
  `node experiments/atex-production-planning.test.js` (PASS, новые + существующие), `node -e "require('./download/atex/js/production-planning.js'); console.log('loads ok')"`.
  ```bash
  git add download/atex/js/production-planning.js && git add -f experiments/atex-production-planning.test.js
  git commit -m "feat(#52): production-planning — «Очередность»: чтение, сортировка очереди, показ"
  ```

---

## Task 4: Документация + полный прогон

**Files:** Modify `docs/atex_workplaces.md`.

- [ ] **Step 1: Описание полей** (стиль repo, факты): Позиция заказа «Тип намотки» (IN/OUT) — фундамент планирования; Производственная резка «Очередность» — порядок в очереди станка, очередь сортируется по ней; движок/генерация — D2/D3 (#52). Сверить имена с кодом.

- [ ] **Step 2: Полный прогон**
  ```bash
  node experiments/test-issue-52D-winding.js
  node experiments/atex-production-planning.test.js
  node experiments/test-issue-2911-atex-orders.js
  node experiments/atex-cut-calc.test.js
  ```
  Все PASS.

- [ ] **Step 3: Commit**
  ```bash
  git add docs/atex_workplaces.md
  git commit -m "docs(#52): D1 — Тип намотки и Очередность (фундамент планирования)"
  ```

---

## Деплой (вне автоматизации — Андрей)
Клиентский код (`orders.js`, `production-planning.js`) → atex→ateh через `update.php`. Поля схемы и колонка `cut_sequence` уже на live (Task 1, агентом).

## Self-review заметки
- Покрытие спеки: поля+отчёт — Task 1; «Тип намотки» в orders — Task 2; «Очередность» чтение/сортировка/показ — Task 3; доки — Task 4.
- Имена: `normalizeWinding`/`WINDING_VALUES` (orders); `sequence`/`cut_sequence`/`seqKey` (planning); реквизиты «Тип намотки»/«Очередность».
- Вне D1: движок (D2), генерация+кнопка+правка (D3) — отдельные подзадачи.
- DOM/сеть не тестируются в node; ядро (normalizeWinding, сорт groupBySlitter, mapCutRecord) — node-тестами.
