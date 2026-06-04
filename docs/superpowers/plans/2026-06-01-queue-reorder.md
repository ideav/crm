# D3c ручная правка очереди (↑/↓) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Кнопки ↑/↓ у резок в очереди станка — диспетчер вручную переставляет; «Очередность» сохраняется.

**Architecture:** Чистая `moveInQueue(orderedCuts, index, dir)` → изменённые `[{cutId, sequence}]` (нормализация 1..N + swap). DOM: ↑/↓ в `renderQueue` (карточка-кнопка не трогается); сохранение «Очередности» переиспользует общий `saveSequences(pairs)` (вынести из D3a `runPlanning`, DRY).

**Tech Stack:** ES5, Integram `_m_set`, node-тесты.

**Спека:** `docs/superpowers/specs/2026-06-01-queue-reorder-design.md`. Эпик ideav/atex#52, D3c (стек на D3a #3075).

---

## Task 1: Чистая `moveInQueue` (TDD)

**Files:** Modify `download/atex/js/production-planning.js`, `experiments/atex-production-planning.test.js`.

- [ ] **Step 1: Падающие тесты** (assertEqual-стиль файла):
  ```javascript
  function qc(id,seq){ return { id:id, sequence:seq }; }
  // вниз: 1↓ меняет местами с 2, нормализует
  var d = planning.moveInQueue([qc('a',1),qc('b',2),qc('c',3)], 0, 1);
  assertEqual(d, [{cutId:'a',sequence:2},{cutId:'b',sequence:1}], 'moveInQueue вниз: swap a/b, только изменённые');
  // вверх симметрично
  var u = planning.moveInQueue([qc('a',1),qc('b',2),qc('c',3)], 2, -1);
  assertEqual(u, [{cutId:'b',sequence:3},{cutId:'c',sequence:2}], 'moveInQueue вверх: swap b/c');
  // граница: вверх у первой / вниз у последней → []
  assertEqual(planning.moveInQueue([qc('a',1),qc('b',2)], 0, -1), [], 'граница вверх → []');
  assertEqual(planning.moveInQueue([qc('a',1),qc('b',2)], 1, 1), [], 'граница вниз → []');
  // null-«Очередности» нормализуются 1..N
  var n = planning.moveInQueue([qc('a',null),qc('b',null),qc('c',null)], 0, 1);
  assertEqual(n, [{cutId:'b',sequence:1},{cutId:'a',sequence:2},{cutId:'c',sequence:3}], 'null → нормализация 1..N (все изменились)');
  // вход не мутируется
  var src=[qc('a',1),qc('b',2)]; planning.moveInQueue(src,0,1); assertEqual(src[0].id,'a','вход не мутируется');
  ```
  Run `node experiments/atex-production-planning.test.js` → FAIL.

- [ ] **Step 2: Реализовать moveInQueue** (рядом с planQueues):
  ```javascript
  // Переставить резку в очереди станка: swap с соседом (dir -1 вверх / +1 вниз) +
  // нормализация «Очередности» 1..N по новому порядку. → изменённые [{cutId, sequence}].
  // На границе → []. Вход не мутирует.
  function moveInQueue(orderedCuts, index, dir){
      var arr = (orderedCuts || []).slice();
      var target = index + dir;
      if (index < 0 || index >= arr.length || target < 0 || target >= arr.length) return [];
      var tmp = arr[index]; arr[index] = arr[target]; arr[target] = tmp;
      var changed = [];
      arr.forEach(function(c, i){ var seq = i + 1; if (Number(c.sequence) !== seq) changed.push({ cutId: c.id, sequence: seq }); });
      return changed;
  }
  ```
  Экспортировать `moveInQueue` в `var planning = {...}`.

- [ ] **Step 3: Run → PASS** + `node -e "require('./download/atex/js/production-planning.js'); console.log('ok')"`.

- [ ] **Step 4: Commit**
  ```bash
  git add download/atex/js/production-planning.js && git add -f experiments/atex-production-planning.test.js
  git commit -m "feat(#52): planning — moveInQueue (перестановка резки в очереди)"
  ```

---

## Task 2: DOM — кнопки ↑/↓ + общий saveSequences (DRY)

**Files:** Modify `download/atex/js/production-planning.js`.

- [ ] **Step 1: Прочитать** `renderQueue` (рендер группы/карточки, ~стр. 940–963), `runPlanning`/`doRun` (сохранение «Очередности» через `_m_set` цепочкой), `reload`/`notify`/`setBusy`/`reqIdByName`/`this.busy`/`this.cuts`.

- [ ] **Step 2: Вынести `saveSequences(pairs)` (DRY)**
  Извлечь из `runPlanning`/`doRun` сохранение списка `[{cutId, sequence}]` в общий метод:
  ```
  AtexProductionPlanning.prototype.saveSequences = function(pairs){
    // pairs: [{cutId, sequence}]; если пусто — notify info, return resolved Promise.
    // resolve reqId «Очередность» (reqIdByName(this.meta.cut, CUT_REQ.sequence)); null → notify error.
    // setBusy(true); последовательная цепочка _m_set/{cutId} {'t'+reqId: String(sequence)};
    // затем reload(); setBusy(false). Возвращает Promise. Ошибки → notify error + setBusy(false).
  }
  ```
  Переписать `doRun` (D3a) так, чтобы оно строило `changed` и вызывало `this.saveSequences(changed)` + свою нотификацию «Запланировано N (изменено M)». (Сохранить поведение D3a; регрессия — существующие тесты ядра не затрагивают DOM, проверить чтением.)

- [ ] **Step 3: Кнопки ↑/↓ в renderQueue**
  В группе станка обернуть карточку в строку `el('div', {class:'atex-pp-cut-row'}, [upBtn, card, downBtn])` (или card + контролы — порядок на усмотрение, но карточку-кнопку не вкладывать в другую кнопку):
  - `upBtn`/`downBtn` — `el('button',{class:'atex-pp-move', type:'button', text:'↑'/'↓'})`; у первой резки `up` `disabled`, у последней `down` `disabled`.
  - Обработчик: `if (self.busy) return; var pairs = planning.moveInQueue(g.cuts, i, dir); if (pairs.length) self.saveSequences(pairs);`
  - `i` — индекс резки в `g.cuts` (порядок отображения = по «Очередности», D1-сортировка в groupBySlitter).
  - Клик по ↑/↓ не должен триггерить выбор карточки (они — отдельные кнопки-сёстры; карточный click остаётся на card).

- [ ] **Step 4: Проверка + commit**
  Ядро-тесты PASS (`node experiments/atex-production-planning.test.js`); DOM — чтением (кнопки, дизейбл на границах, saveSequences вызывается, reload). Прочитать renderQueue/saveSequences/doRun после правок.
  ```bash
  git add download/atex/js/production-planning.js
  git commit -m "feat(#52): production-planning — ручная перестановка очереди ↑/↓ (saveSequences DRY)"
  ```

---

## Task 3: Документация + полный прогон

**Files:** Modify `docs/atex_workplaces.md`.

- [ ] **Step 1:** В §3.3 добавить: ручная правка очереди — кнопки ↑/↓ у резки переставляют её в очереди станка (чистая `moveInQueue` + `saveSequences`), сохраняя «Очередность»; дополняет авто-кнопку «Запланировать». Сверить имена.

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
  git commit -m "docs(#52): D3c — ручная правка очереди (↑/↓)"
  ```

---

## Деплой
Клиентский `production-planning.js` → atex→ateh через `update.php`. Схему/отчёты не трогаем.

## Self-review заметки
- Покрытие спеки: moveInQueue (ядро) — Task 1; ↑/↓ + saveSequences DRY — Task 2; доки — Task 3.
- Имена: `moveInQueue` (ядро), `saveSequences` (контроллер, общий с D3a). Карточка-кнопка не трогается; ↑/↓ — сёстры.
- moveInQueue — чистая, тестируется; DOM/_m_set — чтением. Вне D3c: генерация (D3b).
