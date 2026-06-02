# D3b генерация резок из необеспеченных позиций — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Кнопка «Сгенерировать резки» создаёт Производственные резки под необеспеченные позиции (подбор типа, ceil по кол-ву, авто-станок со стоп-листом, FIFO-партия) + Обеспечение.

**Architecture:** Чистое ядро генерации (в `planning`) — `generateCutPlan` + хелперы, тестируемое. Плумбинг собирает входы (positions_list +material, cutTypeIndex по C, batches FIFO, supplies из cut_planning, slitters со стоп-листом E). Кнопка исполняет план: создаёт Резку+Обеспечение.

**Tech Stack:** ES5, Integram REST, node-тесты.

**Спека:** `docs/superpowers/specs/2026-06-01-cut-generation-design.md`. Эпик ideav/atex#52, D3b (стек на D3c #3076). Live: Позиция→Вид сырья=1138, Ширина=1141, Кол-во=1137; отчёт positions_list. `isMaterialBlocked` уже в planning (E).

---

## Task 1: Чистые хелперы генерации (TDD)

**Files:** Modify `download/atex/js/production-planning.js`, `experiments/atex-production-planning.test.js`.

- [ ] **Step 1: Падающие тесты** (assertEqual-стиль; см. ниже функции):
  ```javascript
  // unsuppliedPositions
  assertEqual(planning.unsuppliedPositions([{id:'1'},{id:'2'}], [{positionId:'1'}]).map(function(p){return p.id;}), ['2'], 'unsupplied: исключает обеспеченные');
  // matchCutType: сырьё+ширина, выбор по макс qty
  var idx = { T1:{materialId:'M', widths:[{width:60,qty:14}]}, T2:{materialId:'M', widths:[{width:60,qty:8},{width:40,qty:1}]}, T3:{materialId:'X', widths:[{width:60,qty:99}]} };
  assertEqual(planning.matchCutType(idx,'M',60), 'T1', 'matchCutType: сырьё M, ширина 60, макс qty → T1');
  assertEqual(planning.matchCutType(idx,'M',999), null, 'matchCutType: нет ширины → null');
  assertEqual(planning.matchCutType(idx,'Z',60), null, 'matchCutType: нет сырья → null');
  // rollersPerCut / cutsNeeded
  assertEqual(planning.rollersPerCut(idx,'T1',60), 14, 'rollersPerCut: 14');
  assertEqual(planning.cutsNeeded(30,14), 3, 'cutsNeeded: ceil(30/14)=3');
  assertEqual(planning.cutsNeeded(5,0), 0, 'cutsNeeded: perCut 0 → 0');
  assertEqual(planning.cutsNeeded(0,14), 1, 'cutsNeeded: qty 0 → min 1');
  // pickSlitter: стоп-лист E + балансировка
  var sl = [{id:'10',stopMaterialIds:['M']},{id:'20',stopMaterialIds:[]},{id:'30',stopMaterialIds:[]}];
  assertEqual(planning.pickSlitter(sl,'M',{}), '20', 'pickSlitter: 10 запрещает M, баланс → 20 (меньший id)');
  assertEqual(planning.pickSlitter(sl,'M',{'20':2}), '30', 'pickSlitter: 20 загружен → 30');
  assertEqual(planning.pickSlitter([{id:'10',stopMaterialIds:['M']}],'M',{}), null, 'pickSlitter: все запрещают → null');
  // pickBatchFIFO
  var b = [{id:'b1',materialId:'M',dateKey:20260102,remainder:100},{id:'b2',materialId:'M',dateKey:20260101,remainder:50},{id:'b3',materialId:'M',dateKey:20251231,remainder:0}];
  assertEqual(planning.pickBatchFIFO(b,'M'), 'b2', 'pickBatchFIFO: старейшая с остатком (b3 остаток 0)');
  assertEqual(planning.pickBatchFIFO(b,'Z'), null, 'pickBatchFIFO: нет сырья → null');
  ```
  Run → FAIL.

- [ ] **Step 2: Реализовать хелперы** (в IIFE, до `var planning={...}`; `isMaterialBlocked` уже есть):
  ```javascript
  function unsuppliedPositions(positions, supplies){
      var sup = {}; (supplies || []).forEach(function(s){ if (s && s.positionId != null) sup[String(s.positionId)] = true; });
      return (positions || []).filter(function(p){ return !sup[String(p.id)]; });
  }
  function matchCutType(cutTypeIndex, materialId, width){
      var w = Number(width), mat = String(materialId == null ? '' : materialId), best = null, bestQty = -1;
      Object.keys(cutTypeIndex || {}).forEach(function(tid){
          var t = cutTypeIndex[tid];
          if (String(t.materialId) !== mat) return;
          var strip = (t.widths || []).filter(function(s){ return Number(s.width) === w; })[0];
          if (!strip) return;
          var q = Number(strip.qty) || 0;
          if (q > bestQty || (q === bestQty && (best == null || String(tid) < String(best)))) { bestQty = q; best = tid; }
      });
      return best;
  }
  function rollersPerCut(cutTypeIndex, typeId, width){
      var t = (cutTypeIndex || {})[String(typeId)]; if (!t) return 0;
      var w = Number(width), strip = (t.widths || []).filter(function(s){ return Number(s.width) === w; })[0];
      return strip ? (Number(strip.qty) || 0) : 0;
  }
  function cutsNeeded(qty, perCut){ var q = Number(qty) || 0, k = Number(perCut) || 0; return k > 0 ? Math.max(1, Math.ceil(q / k)) : 0; }
  function pickSlitter(slitters, materialId, loadBySlitterId){
      var load = loadBySlitterId || {};
      var allowed = (slitters || []).filter(function(s){ return !isMaterialBlocked(s.stopMaterialIds, materialId); });
      if (!allowed.length) return null;
      allowed.sort(function(a, b){
          var la = Number(load[String(a.id)]) || 0, lb = Number(load[String(b.id)]) || 0;
          return la - lb || (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0);
      });
      return String(allowed[0].id);
  }
  function pickBatchFIFO(batches, materialId){
      var mat = String(materialId == null ? '' : materialId);
      var avail = (batches || []).filter(function(b){ return String(b.materialId) === mat && (Number(b.remainder) || 0) > 0; });
      if (!avail.length) return null;
      avail.sort(function(a, b){ return (Number(a.dateKey) || 0) - (Number(b.dateKey) || 0) || (String(a.id) < String(b.id) ? -1 : 1); });
      return String(avail[0].id);
  }
  ```
  Экспорт в `var planning = {...}`: `unsuppliedPositions, matchCutType, rollersPerCut, cutsNeeded, pickSlitter, pickBatchFIFO`.

- [ ] **Step 3: Run → PASS** + `node -e "require('./download/atex/js/production-planning.js'); console.log('ok')"`.
- [ ] **Step 4: Commit** `git add download/atex/js/production-planning.js && git add -f experiments/atex-production-planning.test.js && git commit -m "feat(#52): planning — хелперы генерации резок (подбор типа, ролики, станок, FIFO)"`

---

## Task 2: `generateCutPlan` (интеграция, TDD)

**Files:** Modify `download/atex/js/production-planning.js`, test.

- [ ] **Step 1: Падающие тесты**
  ```javascript
  var gIdx = { T1:{materialId:'M', widths:[{width:60,qty:14}]} };
  var gIn = {
    positions:[ {id:'p1',materialId:'M',width:60,qty:30}, {id:'p2',materialId:'M',width:999,qty:5}, {id:'p3',materialId:'M',width:60,qty:10} ],
    supplies:[ {positionId:'p3'} ],
    cutTypeIndex:gIdx,
    slitters:[ {id:'10',stopMaterialIds:[]} ],
    batches:[ {id:'b1',materialId:'M',dateKey:20260101,remainder:1000} ]
  };
  var g = planning.generateCutPlan(gIn);
  // p3 обеспечена → пропущена; p1 (qty30, perCut14)→ceil=3 резки; p2 ширина 999 нет типа → skipped
  assertEqual(g.plan.length, 3, 'generateCutPlan: p1 → 3 резки');
  assertEqual(g.plan.every(function(x){ return x.cutTypeId==='T1' && x.slitterId==='10' && x.batchId==='b1' && x.positionId==='p1'; }), true, 'generateCutPlan: поля резок p1');
  assertEqual(g.skipped.map(function(s){return s.positionId;}), ['p2'], 'generateCutPlan: p2 пропущена (нет типа)');
  ```
  Run → FAIL.

- [ ] **Step 2: Реализовать generateCutPlan**
  ```javascript
  function generateCutPlan(input){
      input = input || {};
      var idx = input.cutTypeIndex || {}, slitters = input.slitters || [], batches = input.batches || [];
      var unsup = unsuppliedPositions(input.positions || [], input.supplies || []);
      var load = {}; var seed = input.loadBySlitterId || {};
      Object.keys(seed).forEach(function(k){ load[k] = Number(seed[k]) || 0; });
      var plan = [], skipped = [];
      unsup.forEach(function(p){
          var tid = matchCutType(idx, p.materialId, p.width);
          if (tid == null) { skipped.push({ positionId: String(p.id), reason: 'нет типа' }); return; }
          var n = cutsNeeded(p.qty, rollersPerCut(idx, tid, p.width));
          if (n <= 0) { skipped.push({ positionId: String(p.id), reason: 'нет роликов-в-резке' }); return; }
          for (var i = 0; i < n; i++){
              var sid = pickSlitter(slitters, p.materialId, load);
              var bid = pickBatchFIFO(batches, p.materialId);
              plan.push({ positionId: String(p.id), cutTypeId: String(tid), slitterId: sid, batchId: bid });
              if (sid != null) load[String(sid)] = (load[String(sid)] || 0) + 1;
          }
      });
      return { plan: plan, skipped: skipped };
  }
  ```
  Экспорт `generateCutPlan` в `planning`.

- [ ] **Step 3: Run → PASS** + load check.
- [ ] **Step 4: Commit** `... -m "feat(#52): planning — generateCutPlan (план генерации резок)"`

---

## Task 3: Плумбинг данных

**Files:** Modify `download/atex/js/production-planning.js` (+ live positions_list колонка — контроллер).

- [ ] **Step 1 (live, контроллер):** `positions_list` += `position_material_id` ← реквизит **1138** (Позиция→Вид сырья), `t104=85` (abn_ID). Идемпотентно; проверить запуск отчёта.
- [ ] **Step 2:** `rowsToPositions` (или отдельный сбор) — извлекать `materialId`(position_material_id), `width`(position_width), `qty`(position_qty), `id`. Сформировать `this.genPositions` (массив дескрипторов) при загрузке.
- [ ] **Step 3:** `loadCutTypeIndexForMaterials(materialIds)` — по образцу C: загрузить типы резки этих сырьёв (`object/{Тип резки}` + фильтр по сырью) и их «Полоса» (`object/{Полоса}?F_U={typeId}` → `[{width, qty}]`) → `this.cutTypeIndex = { typeId:{materialId, widths} }`. Лениво по сырьям необеспеченных позиций.
- [ ] **Step 4:** Партии с FIFO — расширить загрузку партий: `materialId`, `dateKey` (дата прихода → число, как в intake), `remainder` → `this.genBatches=[{id,materialId,dateKey,remainder}]`. (Можно отдельным object/{Партия}?JSON_OBJ чтением.)
- [ ] **Step 5:** supplies — уже в `this.supplies` (cut_planning). slitters — `this.slitters` (E). `loadBySlitterId` — счётчик из `this.cuts` по slitter.id.
- [ ] **Step 6:** Прогон ядра-тестов (не задеты) + commit `feat(#52): production-planning — плумбинг генерации (positions_list +material, cutTypeIndex, FIFO-партии)`.

> Документировать колонку `position_material_id` в `docs/integram-reports.md`.

## Task 4: Кнопка «Сгенерировать резки» + создание

**Files:** Modify `download/atex/js/production-planning.js`.

- [ ] **Step 1:** Прочитать `createCut`/`createSupply` (создание Резки и Обеспечения), модалку подтверждения (D3a паттерн), `setBusy`/`notify`/`reload`.
- [ ] **Step 2:** Кнопка «Сгенерировать резки» (рядом с «Запланировать»). Обработчик `runGenerate()`:
  1. Подтверждение (не нативный confirm): «Создать резки под N необеспеченных позиций?» (N = `unsuppliedPositions(this.genPositions, this.supplies).length`).
  2. Собрать вход и `var res = planning.generateCutPlan({positions:this.genPositions, supplies:this.supplies, cutTypeIndex:this.cutTypeIndex, slitters:this.slitters, batches:this.genBatches, loadBySlitterId:<счётчик из this.cuts>});`.
  3. Для каждой записи `res.plan`: `_m_new/{Производственная резка}` (Тип резки=cutTypeId, Слиттер=slitterId, Партия сырья=batchId, Статус='Запланирована') → cutId → `_m_new/{Обеспечение}` `up={positionId}` со ссылкой на резку (как `createSupply`). Последовательно; `setBusy`.
  4. `reload()`; notify «Создано N резок, пропущено M позиций».
  Переиспользовать `createSupply`/createCut-паттерны; reqId по именам.
- [ ] **Step 3:** Ядро-тесты PASS; DOM — чтением. Commit `feat(#52): production-planning — кнопка «Сгенерировать резки» (создание резок+обеспечения)`.

## Task 5: Документация + полный прогон

- [ ] **Step 1:** `docs/atex_workplaces.md` §3.3: кнопка «Сгенерировать резки» — по необеспеченным позициям подбирает тип (C), ceil по кол-ву, авто-станок (стоп-лист E) + FIFO-партия, создаёт Резку+Обеспечение; чистое ядро `generateCutPlan`. Сверить имена.
- [ ] **Step 2:** Полный прогон: `node experiments/atex-production-planning.test.js` + `test-issue-52D-winding.js` + `test-issue-2911-atex-orders.js` + `atex-cut-calc.test.js` — все PASS.
- [ ] **Step 3:** Commit `docs(#52): D3b — генерация резок (кнопка «Сгенерировать»)`.

---

## Деплой
Клиентский `production-planning.js` → atex→ateh через `update.php`. Колонка `position_material_id` — на live (Task 3, агентом).

## Self-review заметки
- Покрытие спеки: хелперы — Task 1; generateCutPlan — Task 2; плумбинг — Task 3; кнопка+создание — Task 4; доки — Task 5.
- Имена ядра: `unsuppliedPositions/matchCutType/rollersPerCut/cutsNeeded/pickSlitter/pickBatchFIFO/generateCutPlan`.
- Чистое ядро (Task 1-2) — node-тестами; плумбинг/DOM — чтением. Вне D3b: комбинирование позиций, точная джамбо-математика.
