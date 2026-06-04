# D2 движок упорядочивания очереди резок — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Чистый движок `orderCuts(cuts, weights?)` — упорядочивает резки станка жадно по `changeoverCost` с настраиваемыми весами `PLANNING_WEIGHTS` (10..100).

**Architecture:** Чистые функции в ядре `planning` (`download/atex/js/production-planning.js`), без DOM/сети/схемы. TDD в `experiments/atex-production-planning.test.js`. D3 наполнит реальными данными и подключит к UI.

**Tech Stack:** ES5, кастомный assertEqual-harness `experiments/`.

**Спека:** `docs/superpowers/specs/2026-06-01-planning-engine-design.md`. Эпик ideav/atex#52, подзадача D2 (стек на D1 #3072). Ядро экспортируется в `var planning = {...}` (тест: `require(...).planning`).

---

## Task 1: Веса + хелперы + `changeoverCost` (TDD)

**Files:** Modify `download/atex/js/production-planning.js`, `experiments/atex-production-planning.test.js`.

- [ ] **Step 1: Падающие тесты**
  В `experiments/atex-production-planning.test.js` добавить (assertEqual-стиль файла):
  ```javascript
  // widthSetDistance — симметрическая разность мультимножеств ширин
  assertEqual(planning.widthSetDistance([60,60,40],[60,40,40]), 2, 'widthSetDistance: одна 60 и одна 40 расходятся');
  assertEqual(planning.widthSetDistance([],[]), 0, 'widthSetDistance: пустые → 0');
  assertEqual(planning.widthSetDistance(['60'],[60]), 0, 'widthSetDistance: строка==число');
  // awkwardRemainder — неудобный остаток джамбо (0<m<600)
  assertEqual(planning.awkwardRemainder(0), false, 'awkward: 0 → false');
  assertEqual(planning.awkwardRemainder(100), true, 'awkward: 100 → true');
  assertEqual(planning.awkwardRemainder(600), false, 'awkward: 600 → false');
  assertEqual(planning.awkwardRemainder(1200), false, 'awkward: 1200 → false');
  assertEqual(planning.awkwardRemainder(-5), false, 'awkward: отриц → false');
  // PLANNING_WEIGHTS экспортирован, значения 10..100
  assertEqual(planning.PLANNING_WEIGHTS.material, 100, 'вес material=100');
  // changeoverCost при дефолтах: одиночная смена сырья=100 > намотки=70 > макс ножей=25; одинаковые=0
  var base = { materialId:'1', winding:'IN', batchId:'b1', jumboRemainingM:0, knifeCount:4, knifeWidths:[60,60,60,60], rollerWidth:60 };
  function clone(o,patch){ var c={}; for(var k in o) c[k]=o[k]; for(var k in (patch||{})) c[k]=patch[k]; return c; }
  assertEqual(planning.changeoverCost(base, clone(base), null), 0, 'cost: идентичные → 0');
  assertEqual(planning.changeoverCost(base, clone(base,{materialId:'2'}), null), 100, 'cost: смена сырья = 100');
  assertEqual(planning.changeoverCost(base, clone(base,{winding:'OUT'}), null), 70, 'cost: смена намотки = 70');
  // макс смена ножей (полностью разная конфигурация) = вес knife (25), т.к. нормировка min(1,…)
  assertEqual(planning.changeoverCost(base, clone(base,{knifeCount:20, knifeWidths:[20,20,20]}), null) >= 25 - 1e-9
              && planning.changeoverCost(base, clone(base,{knifeCount:20, knifeWidths:[20,20,20]}), null) <= 25 + 1e-9, true, 'cost: макс ножи ≈ 25');
  ```
  Run: `node experiments/atex-production-planning.test.js` → FAIL.

- [ ] **Step 2: Реализовать константы + хелперы + changeoverCost**
  В `production-planning.js` (в IIFE, рядом с чистыми хелперами; до `var planning = {...}`):
  ```javascript
  // Приоритет планирования: правь эти числа (10..100), чтобы изменить важность.
  // Больше — тем дороже соответствующая переналадка. Сырьё>намотка>партия>остаток>ножи>ширина.
  var PLANNING_WEIGHTS = { material: 100, winding: 70, batch: 50, remainder: 40, knife: 25, width: 10 };
  var KNIFE_SCALE = 8;     // нормировка ножевой компоненты (переставленных ножей до «максимума»)
  var WIDTH_SCALE = 100;   // нормировка ширины (мм «сужения» до «максимума»)
  var REMAINDER_OK_M = 600;

  function normWinding(v){ var s = String(v == null ? '' : v).trim().toUpperCase(); return (s === 'IN' || s === 'OUT') ? s : ''; }

  // Симметрическая разность мультимножеств ширин (сколько ножей переставить). Терпимо к числам/строкам.
  function widthSetDistance(a, b){
      function tally(arr){ var m = {}; (arr || []).forEach(function(x){ var k = String(Number(x)); m[k] = (m[k] || 0) + 1; }); return m; }
      var ma = tally(a), mb = tally(b), keys = {}, d = 0;
      Object.keys(ma).forEach(function(k){ keys[k] = 1; });
      Object.keys(mb).forEach(function(k){ keys[k] = 1; });
      Object.keys(keys).forEach(function(k){ d += Math.abs((ma[k] || 0) - (mb[k] || 0)); });
      return d;
  }

  // Неудобный остаток джамбо: 0 < m < REMAINDER_OK_M (не дорезан до ≈0 и не оставлен крупным).
  function awkwardRemainder(m){ var x = Number(m); return !isNaN(x) && x > 1e-6 && x < REMAINDER_OK_M; }

  // Стоимость перехода prev→next: взвешенная сумма нормированных компонент. weights по умолчанию PLANNING_WEIGHTS.
  function changeoverCost(prev, next, weights){
      var w = weights || PLANNING_WEIGHTS;
      var cost = 0;
      cost += (w.material || 0) * (String(prev.materialId) !== String(next.materialId) ? 1 : 0);
      cost += (w.winding || 0) * (normWinding(prev.winding) !== normWinding(next.winding) ? 1 : 0);
      var batchChange = String(prev.batchId) !== String(next.batchId);
      cost += (w.batch || 0) * (batchChange ? 1 : 0);
      cost += (w.remainder || 0) * ((batchChange && awkwardRemainder(prev.jumboRemainingM)) ? 1 : 0);
      var knifeDist = Math.abs((Number(prev.knifeCount) || 0) - (Number(next.knifeCount) || 0))
                    + widthSetDistance(prev.knifeWidths, next.knifeWidths);
      cost += (w.knife || 0) * Math.min(1, knifeDist / KNIFE_SCALE);
      var drop = Math.max(0, (Number(prev.rollerWidth) || 0) - (Number(next.rollerWidth) || 0));
      cost += (w.width || 0) * Math.min(1, drop / WIDTH_SCALE);
      return cost;
  }
  ```
  В `var planning = { ... }` добавить: `PLANNING_WEIGHTS`, `KNIFE_SCALE`, `WIDTH_SCALE`, `normWinding`, `widthSetDistance`, `awkwardRemainder`, `changeoverCost`.

- [ ] **Step 3: Run → PASS** (`node experiments/atex-production-planning.test.js`), `node -e "require('./download/atex/js/production-planning.js'); console.log('ok')"`.

- [ ] **Step 4: Commit**
  ```bash
  git add download/atex/js/production-planning.js && git add -f experiments/atex-production-planning.test.js
  git commit -m "feat(#52): planning-engine — веса PLANNING_WEIGHTS + changeoverCost (ядро D2)"
  ```

---

## Task 2: `orderCuts` (жадный) + группировка/Фольга/настройка (TDD)

**Files:** Modify `download/atex/js/production-planning.js`, `experiments/atex-production-planning.test.js`.

- [ ] **Step 1: Падающие тесты**
  Добавить:
  ```javascript
  function cut(id,o){ return { id:id, materialId:o.m, winding:o.w||'IN', batchId:o.b||('B'+id), jumboRemainingM:o.r==null?0:o.r, knifeCount:o.k||4, knifeWidths:o.kw||[60], isFoil:!!o.foil, rollerWidth:o.rw||60 }; }
  // группировка по сырью (дефолтные веса): материалы не чередуются
  var inMat = [ cut('1',{m:'A'}), cut('2',{m:'B'}), cut('3',{m:'A'}), cut('4',{m:'B'}) ];
  var outMat = planning.orderCuts(inMat).map(function(c){return c.materialId;});
  // число границ смены сырья = (различных − 1) = 1
  var bnd = 0; for (var i=1;i<outMat.length;i++) if (outMat[i]!==outMat[i-1]) bnd++;
  assertEqual(bnd, 1, 'orderCuts: сырьё сгруппировано (1 граница)');
  // Фольга строго в конце
  var inFoil = [ cut('1',{m:'A',foil:true}), cut('2',{m:'A'}), cut('3',{m:'A'}) ];
  var outFoil = planning.orderCuts(inFoil).map(function(c){return c.id;});
  assertEqual(outFoil[outFoil.length-1], '1', 'orderCuts: Фольга в конце');
  // настраиваемость: winding>material → группировка сперва по намотке
  var mix = [ cut('1',{m:'A',w:'IN'}), cut('2',{m:'B',w:'OUT'}), cut('3',{m:'A',w:'OUT'}), cut('4',{m:'B',w:'IN'}) ];
  var byWind = planning.orderCuts(mix, { material:50, winding:100, batch:50, remainder:40, knife:25, width:10 }).map(function(c){return c.winding;});
  var wb=0; for (var j=1;j<byWind.length;j++) if (byWind[j]!==byWind[j-1]) wb++;
  assertEqual(wb, 1, 'orderCuts: с winding>material группировка по намотке (1 граница)');
  // sequence 1..N и вход не мутируется
  var src = [ cut('1',{m:'A'}), cut('2',{m:'A'}) ];
  var res = planning.orderCuts(src);
  assertEqual(res.map(function(c){return c.sequence;}), [1,2], 'sequence 1..N');
  assertEqual(src[0].sequence, undefined, 'вход не мутируется');
  ```
  Run → FAIL.

- [ ] **Step 2: Реализовать orderCuts (+ внутренние greedySequence/ключ старта)**
  Рядом с changeoverCost:
  ```javascript
  function startKey(c){ return [Number(c.rollerWidth) || 0, -(Number(c.knifeCount) || 0), String(c.id)]; }
  function cmpKey(a, b){ for (var i = 0; i < a.length; i++){ if (a[i] < b[i]) return -1; if (a[i] > b[i]) return 1; } return 0; }
  // Жадная последовательность: старт — argmin startKey (узкая/много-ножевая); далее argmin changeoverCost, tie-break startKey.
  function greedySequence(cuts, weights){
      var pool = (cuts || []).slice();
      if (!pool.length) return [];
      pool.sort(function(a, b){ return cmpKey(startKey(a), startKey(b)); });
      var result = [pool.shift()];
      while (pool.length){
          var cur = result[result.length - 1], bestI = 0, bestCost = Infinity, bestKey = null;
          for (var i = 0; i < pool.length; i++){
              var c = changeoverCost(cur, pool[i], weights), k = startKey(pool[i]);
              if (c < bestCost || (c === bestCost && cmpKey(k, bestKey) < 0)){ bestCost = c; bestI = i; bestKey = k; }
          }
          result.push(pool.splice(bestI, 1)[0]);
      }
      return result;
  }
  // Упорядочить резки станка: не-Фольга жадно, затем Фольга жадно; проставить sequence; вход не мутировать.
  function orderCuts(cuts, weights){
      var rest = [], foil = [];
      (cuts || []).forEach(function(c){ (c && c.isFoil ? foil : rest).push(c); });
      var seq = greedySequence(rest, weights).concat(greedySequence(foil, weights));
      return seq.map(function(c, i){
          var copy = {}; for (var k in c){ if (Object.prototype.hasOwnProperty.call(c, k)) copy[k] = c[k]; }
          copy.sequence = i + 1;
          return copy;
      });
  }
  ```
  В `var planning = {...}` добавить `orderCuts` (и при желании `greedySequence` для отладки).

- [ ] **Step 3: Run → PASS** (новые + существующие), `node -e "require('./download/atex/js/production-planning.js'); console.log('ok')"`.

- [ ] **Step 4: Commit**
  ```bash
  git add download/atex/js/production-planning.js && git add -f experiments/atex-production-planning.test.js
  git commit -m "feat(#52): planning-engine — orderCuts (жадное упорядочивание, Фольга в конец, настройка весов)"
  ```

---

## Task 3: Документация + полный прогон

**Files:** Modify `docs/atex_workplaces.md` (или `docs/integram-app-workflow.md` — где описаны РМ; выбрать существующий раздел про планирование).

- [ ] **Step 1: Кратко задокументировать движок** (факты, стиль repo): ядро `planning` содержит чистый движок `orderCuts(cuts, weights?)` (жадный по `changeoverCost`), приоритет — настраиваемый `PLANNING_WEIGHTS` (10..100: сырьё>намотка>партия>остаток>ножи>ширина); Фольга — в конец; «узкие→широкие»; вход-дескриптор резки описан в спеке. Подключение к данным/UI — D3. Сверить имена с кодом.

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
  git commit -m "docs(#52): D2 — движок упорядочивания (orderCuts, настраиваемые веса)"
  ```

---

## Деплой
D2 — только чистое ядро + тесты, на live ничего не меняет. Код активируется при подключении в D3 (деплой atex→ateh через `update.php`).

## Self-review заметки
- Покрытие спеки: веса/хелперы/changeoverCost — Task 1; orderCuts (жадный, Фольга, настройка) — Task 2; доки — Task 3.
- Имена: `PLANNING_WEIGHTS`/`KNIFE_SCALE`/`WIDTH_SCALE`/`normWinding`/`widthSetDistance`/`awkwardRemainder`/`changeoverCost`/`orderCuts` — экспорт в `planning`.
- Чистые функции, вход не мутируется, детерминизм; всё node-тестами. DOM/данные/UI — вне D2 (D3).
