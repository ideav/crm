# F1 «Чистое ядро раскладки резок» — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Чистый, тестируемый модуль `cut-layout.js` — раскладка ножей («Полосы») для резки: бин-пакинг заказанных ширин в ширину джамбо + добор ходовыми, с объединением позиций в окне «Срок изготовления».

**Architecture:** ES5 UMD-модуль (как `cut-planning.js`/`production-planning.js`): IIFE, экспорт чистого ядра `layout` через `module.exports`/`window.AtexCutLayout`. Всё ядро — чистые функции (вход не мутируют, детерминированы), покрыты node-тестами `experiments/atex-cut-layout.test.js` (свой `assertEqual` через `JSON.stringify`). DOM/сеть — НЕ в F1.

**Tech Stack:** Vanilla ES5, `node` для тестов. Без зависимостей.

**Спека:** `docs/superpowers/specs/2026-06-02-abolish-cuttype-F1-layout-core-design.md`. Эпик [[atex_epic52_planning]], F2 уже на live.

**Переиспользование:** логику добора `bestFill` + `toNumber`/`round3`/`combinationSignature` взять по образцу `download/atex/js/cut-planning.js` (B). Модули самостоятельны → код `bestFill` реплицировать в `cut-layout.js` (не импортировать).

---

## Task 1: Скелет модуля + хелперы + тест-харнес

**Files:** Create `download/atex/js/cut-layout.js`, `experiments/atex-cut-layout.test.js`.

- [ ] **Step 1: Тест-харнес + первые проверки хелперов** (`experiments/atex-cut-layout.test.js`):
```javascript
var layout = require('../download/atex/js/cut-layout.js').layout;
var passed = 0;
function assertEqual(actual, expected, name){
  var ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log((ok?'PASS':'FAIL')+' — '+name);
  if(ok) passed++; else { console.log('  exp:',JSON.stringify(expected)); console.log('  got:',JSON.stringify(actual)); process.exitCode=1; }
}
assertEqual(layout.toNumber('12.5'), 12.5, 'toNumber строки');
assertEqual(layout.toNumber(''), 0, 'toNumber пусто → 0');
assertEqual(layout.round3(1/3), 0.333, 'round3');
// dayDiff: разница в днях между ГГГГММДД-ключами (упрощённо через Date)
assertEqual(layout.dayDiff(20260601, 20260604), 3, 'dayDiff 3 дня');
assertEqual(layout.dayDiff(20260601, 20260601), 0, 'dayDiff 0');
```
- [ ] **Step 2: Запустить — FAIL** (`node experiments/atex-cut-layout.test.js`) — модуль не существует.
- [ ] **Step 3: Реализовать скелет** `download/atex/js/cut-layout.js`:
```javascript
(function(){
  function toNumber(v){ var n = parseFloat(v); return isNaN(n) ? 0 : n; }
  function round3(v){ return Math.round(toNumber(v)*1000)/1000; }
  // dayDiff: |дни| между двумя ключами ГГГГММДД (Infinity → большое число)
  function dayDiff(a, b){
    if(!isFinite(a) || !isFinite(b)) return Infinity;
    function toDate(k){ k=Math.floor(k); var y=Math.floor(k/10000), m=Math.floor(k/100)%100, d=k%100; return Date.UTC(y, m-1, d); }
    return Math.round(Math.abs(toDate(a)-toDate(b))/86400000);
  }
  var layout = { toNumber: toNumber, round3: round3, dayDiff: dayDiff };
  if (typeof module !== 'undefined' && module.exports) module.exports = { layout: layout };
  if (typeof window !== 'undefined') window.AtexCutLayout = { layout: layout };
})();
```
- [ ] **Step 4: Запустить — PASS** + `node -e "require('./download/atex/js/cut-layout.js'); console.log('ok')"`.
- [ ] **Step 5: Commit**
```bash
git add download/atex/js/cut-layout.js && git add -f experiments/atex-cut-layout.test.js
git commit -m "feat(atex): cut-layout — скелет ядра раскладки (toNumber/round3/dayDiff)"
```

---

## Task 2: `dueWindowGroups` (TDD)

**Files:** Modify `download/atex/js/cut-layout.js`, `experiments/atex-cut-layout.test.js`.

- [ ] **Step 1: Падающие тесты:**
```javascript
function p(id,w,q,due){ return {id:id,width:w,qty:q,dueKey:due}; }
// в пределах 3 дней → один кластер (сортировка по dueKey)
var g1 = layout.dueWindowGroups([p('a',110,50,20260604), p('b',70,30,20260601)], 3);
assertEqual(g1.map(function(c){return c.map(function(x){return x.id;});}), [['b','a']], 'окно 3д: один кластер, сортирован по сроку');
// за окном → разные кластеры
var g2 = layout.dueWindowGroups([p('a',110,1,20260601), p('c',50,1,20260610)], 3);
assertEqual(g2.map(function(c){return c.map(function(x){return x.id;});}), [['a'],['c']], 'за окном → два кластера');
// без срока (Infinity) → отдельный последний кластер
var g3 = layout.dueWindowGroups([p('a',110,1,20260601), p('z',40,1,Infinity)], 3);
assertEqual(g3.map(function(c){return c.map(function(x){return x.id;});}), [['a'],['z']], 'без срока → отдельный кластер');
// вход не мутируется
var src=[p('a',110,1,20260601)]; layout.dueWindowGroups(src,3); assertEqual(src.length,1,'вход не мутируется');
```
- [ ] **Step 2: Запустить — FAIL.**
- [ ] **Step 3: Реализовать** `dueWindowGroups(positions, windowDays)` и экспортировать:
  - скопировать вход, разделить на датированные (isFinite(dueKey)) и без срока;
  - датированные отсортировать по `dueKey` (затем по id для детерминизма); жадно: начать кластер с минимальным `dueKey`, добавлять пока `dayDiff(pos.dueKey, cluster[0].dueKey) <= windowDays`; иначе новый кластер;
  - бездатные — добавить отдельным кластером в конец (если есть);
  - `windowDays` по умолчанию 3 (`if (windowDays==null) windowDays=3`).
- [ ] **Step 4: Запустить — PASS.**
- [ ] **Step 5: Commit** `feat(atex): cut-layout — dueWindowGroups (объединение позиций по сроку)`.

---

## Task 3: `bestFill` + `composeLayout` (TDD)

**Files:** Modify `download/atex/js/cut-layout.js`, `experiments/atex-cut-layout.test.js`.

- [ ] **Step 1: Падающие тесты:**
```javascript
function d(w,q,pid){ return {width:w,qty:q,positionId:pid}; }
// bestFill (как в B): добрать остаток ходовыми, мин. отход
var bf = layout.bestFill(100, [{width:60,popularity:10},{width:40,popularity:5}], 0);
assertEqual(bf.leftover, 0, 'bestFill: 60+40 → 0 отход');
// composeLayout: джамбо 910, заказы 110(qty50) и 70(qty30)
var L = layout.composeLayout(910, [d(110,50,'a'), d(70,30,'b')], [{width:50,popularity:8}], 0);
// каждая заказанная ширина ≥1 полоса 'Заказ'
assertEqual(L.strips.filter(function(s){return s.purpose==='Заказ'&&s.width===110;}).length>0
  && L.strips.filter(function(s){return s.purpose==='Заказ'&&s.width===70;}).length>0, true, 'composeLayout: обе заказанные ширины есть');
// used + remainder == jumbo
assertEqual(layout.round3(L.used + L.remainder), 910, 'used+remainder=джамбо');
// 110 дозаполнена по спросу (>1 полосы, спрос 50>30)
assertEqual(L.strips.filter(function(s){return s.width===110&&s.purpose==='Заказ';}).reduce(function(a,s){return a+s.qty;},0) >= 1, true, '110 уложена');
// overflow: ширина шире джамбо → в overflow, не в strips
var L2 = layout.composeLayout(100, [d(120,5,'x'), d(40,5,'y')], [], 0);
assertEqual(L2.overflow.map(function(o){return o.positionId;}), ['x'], 'composeLayout: 120 шире 100 → overflow');
assertEqual(L2.strips.some(function(s){return s.width===40;}), true, '40 уложена');
// вход не мутируется
var dm=[d(110,1,'a')]; layout.composeLayout(910, dm, [], 0); assertEqual(dm.length,1,'вход не мутируется');
```
- [ ] **Step 2: Запустить — FAIL.**
- [ ] **Step 3: Реализовать** `bestFill(rem, preferred, tolerance)` (DFS-добор как в `cut-planning.js`: кандидаты по `popularity`, мин. `leftover`, затем макс. сумма популярности; вернуть `{strips:[{width,qty}], leftover, popSum}`) и `composeLayout(jumboWidth, demands, preferred, tolerance)` по шагам (a)-(e) спеки:
  - (a) агрегировать demands по ширине (Σ qty, собрать positionIds), ширины шире джамбо → overflow;
  - (b) базовая укладка: по 1 полосе на каждую уместившуюся ширину (по убыванию ширины), что не влезло → overflow;
  - (c) дозаполнение: пока остаток ≥ min ширины demand, добавлять полосу ширины с макс. остаточным неудовлетворённым спросом (детерм.: при равенстве бóльшая ширина, потом меньший id), увеличивать qty этой полосы;
  - (d) `bestFill` остатка по preferred → полосы `purpose:'Склад'`;
  - (e) `used = Σ width*qty`, `remainder = round3(jumbo-used)`, `withinTolerance = |remainder|<=|tol|`.
  - Объединять одинаковые ширины в одну полосу (qty суммируется). Экспортировать обе.
- [ ] **Step 4: Запустить — PASS.**
- [ ] **Step 5: Commit** `feat(atex): cut-layout — composeLayout + bestFill (раскладка + добор ходовыми)`.

---

## Task 4: `planLayouts` оркестратор + `combinationSignature` (TDD)

**Files:** Modify `download/atex/js/cut-layout.js`, `experiments/atex-cut-layout.test.js`.

- [ ] **Step 1: Падающие тесты:**
```javascript
// combinationSignature детерминированный ключ
assertEqual(layout.combinationSignature('M',[{width:70,qty:2},{width:110,qty:1}]),
            layout.combinationSignature('M',[{width:110,qty:1},{width:70,qty:2}]), 'signature не зависит от порядка');
// planLayouts: объединяет окно, overflow → доп. раскладка, skipped для слишком широких
var res = layout.planLayouts({
  jumboWidth: 910,
  positions: [ {id:'a',width:110,qty:50,dueKey:20260601}, {id:'b',width:70,qty:30,dueKey:20260603}, {id:'big',width:1000,qty:1,dueKey:20260601} ],
  preferred: [{width:50,popularity:8}],
  options: { windowDays:3, tolerance:0 }
});
assertEqual(res.layouts.length >= 1, true, 'planLayouts: есть раскладка');
assertEqual(res.layouts[0].positionsCovered.indexOf('a')>=0 && res.layouts[0].positionsCovered.indexOf('b')>=0, true, 'a и b в одной раскладке (окно)');
assertEqual(res.skipped.map(function(s){return s.positionId;}), ['big'], 'big (шире джамбо) → skipped');
// чистота
var inp={jumboWidth:910,positions:[{id:'a',width:110,qty:1,dueKey:20260601}],preferred:[],options:{}};
layout.planLayouts(inp); assertEqual(inp.positions.length,1,'planLayouts вход не мутируется');
```
- [ ] **Step 2: Запустить — FAIL.**
- [ ] **Step 3: Реализовать** `combinationSignature(materialId, strips)` (как в B: сортированный `widthxqty`) и `planLayouts(input)`:
  - `groups = dueWindowGroups(positions, options.windowDays)`;
  - для каждого кластера: `composeLayout(jumboWidth, demands, preferred, tolerance)`; пока `overflow` непустой и есть прогресс — повторный `composeLayout` на overflow → доп. раскладка; ширины шире джамбо (overflow, который не уменьшается) → `skipped` с reason `'шире джамбо'`;
  - каждая раскладка: `{ positionsCovered:[уникальные positionId из strips 'Заказ'], strips, used, remainder, withinTolerance, dueKey: минимальный срок кластера }`;
  - возврат `{ layouts, skipped }`. Детерминировано, вход не мутируется. Экспортировать обе.
- [ ] **Step 4: Запустить — PASS.**
- [ ] **Step 5: Commit** `feat(atex): cut-layout — planLayouts + combinationSignature (оркестратор раскладки)`.

---

## Task 5: Полный прогон + документация

**Files:** Modify `docs/atex_workplaces.md` (или `docs/integram-reports.md` — где уместно отметить ядро).

- [ ] **Step 1: Полный прогон** всех тестов:
```bash
node experiments/atex-cut-layout.test.js
node experiments/atex-cut-planning.test.js
node experiments/atex-production-planning.test.js
node experiments/atex-cut-calc.test.js
```
Все PASS.
- [ ] **Step 2:** Кратко задокументировать ядро `cut-layout.js` (функции `dueWindowGroups`/`composeLayout`/`planLayouts`/`bestFill`/`combinationSignature`, их контракт) в `docs/atex_workplaces.md` (раздел про планирование) — для F3.
- [ ] **Step 3: Commit** `docs(atex): F1 — ядро раскладки cut-layout (контракт для F3)`.

---

## Самопроверка плана
- Покрытие спеки: dueWindowGroups=Task2; composeLayout+bestFill=Task3; planLayouts+combinationSignature=Task4; хелперы=Task1; прогон+доки=Task5.
- Чистота/детерминизм/вход-не-мутируется — в тестах каждой функции.
- Вне F1: загрузка данных, Полосы/Резки, кол-во резок под qty, UI — F3 (production-planning, на ядре cut-layout).

## Деплой
`cut-layout.js` → atex→ateh `update.php` вместе с F3. Тесты — `node`.
