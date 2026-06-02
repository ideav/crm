# F4 «Зачистка эпика упразднения Типа резки» — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development / executing-plans, task-by-task. Steps use `- [ ]`.

**Goal:** Завершить эпик: «Срок изготовления» на форме заказа (orders.js), починить cut-map (Полоса из Резки), ретайр cut-calc (управлял дропнутым «Тип резки»), доки, PR ветки `epic-abolish-cuttype`.

**Architecture:** ES5 atex workplaces. Резолв реквизитов/таблиц по ИМЕНИ. Чистые ядра (cut-map layout) и тесты не ломать. Спека: `docs/superpowers/specs/2026-06-02-abolish-cuttype-F4-cleanup-design.md`. Карта правок (file:line) — вывод Explore в истории; перед правкой `grep -n` подтверждать.

---

## Task 1: orders.js — «Срок изготовления» + зачистка cutType

**Files:** Modify `download/atex/js/orders.js`, `experiments/test-issue-2911-atex-orders.js`.

- [ ] **Step 1:** READ orders.js: ORDER_FIELDS / POSITION_FIELDS, рендер шапки/строк заказов и позиций, `buildCreateOrderRequest`/`buildSetPositionRequest`, и КАК уже сделана «Дата согласования» (#3090, на заказе и позиции) — ВСЁ зеркалить по ней.
- [ ] **Step 2:** Добавить «Срок изготовления»:
  - ORDER_FIELDS: `{ key:'dueDate', label:'Срок изготовления', names:['Срок изготовления'] }` (date). POSITION_FIELDS: то же (read-only, как approved).
  - Шапка заказов + ячейка строки (рядом с «Дата создания»/«Дата согл.»); форма создания заказа — `<input type=date>` неприметно; `buildCreateOrderRequest` — `put('dueDate', opts.dueDate)`.
  - Шапка позиций + display-ячейка (read-only) в строке и черновике. НЕ в EDITABLE_POSITION_CELLS.
  - Резолв по имени; колонка опциональна (нет в метаданных → пропустить, без падения).
- [ ] **Step 3:** Убрать мёртвый `cutType`: из POSITION_FIELDS, `position_cut_type*` в rowsToOrders, loadRefOptions/ветки для cutCol (фича C снята #3089, колонка снята F2 — это no-op). НЕ трогать рабочую логику.
- [ ] **Step 4:** Поправить `experiments/test-issue-2911-atex-orders.js` под изменения (если ассертит cutType/поля — обновить); добавить лёгкую проверку маппинга dueDate если есть чистый хелпер.
- [ ] **Step 5:** Verify — `node experiments/test-issue-2911-atex-orders.js` PASS; `node -e "require('./download/atex/js/orders.js')"` (если грузится в node) или синтаксис-проверка; `grep -n "Тип резки\|cutType\|matchCutType\|cut_types_index" download/atex/js/orders.js` → пусто.
- [ ] **Step 6:** Commit `feat(atex): orders — «Срок изготовления» на форме заказа + зачистка остатков «Тип резки»`.

---

## Task 2: cut-map.js — Полоса из Резки

**Files:** Modify `download/atex/js/cut-map.js`.

- [ ] **Step 1:** READ cut-map.js: `TABLE`/`CUT_REQ`/`loadMetadata`, `loadCut`/`loadCutType`/`loadStrips`, `computeLayout` (нужна inputWidth=джамбо).
- [ ] **Step 2:** Убрать «Тип резки»: `TABLE.cutType`, `CUT_REQ.cutType`, `meta.cutType` и проверку метаданных «Тип резки» (иначе init падает — таблицы нет).
- [ ] **Step 3:** `loadCut` → грузить Полосы напрямую `object/{meta.strip.id}/?JSON_OBJ&F_U={cutId}&LIMIT=0,1000` (резолв «Полоса» по имени); удалить `loadCutType`; `loadStrips(cutId)`.
- [ ] **Step 4:** Ширина входа (джамбо) для `computeLayout` — из Партии сырья резки → Вид сырья «Ширина, мм» (загрузить как в F3: партия резки → materialId → object/{Вид сырья} «Ширина, мм»); если не достать — fallback `inputWidth = Σ ширин полос` (визуализация без остатка). Резолв по имени.
- [ ] **Step 5:** Verify — `node experiments/atex-cut-map.test.js` PASS (ядро layout не трогали); `node -e "require('./download/atex/js/cut-map.js'); console.log('ok')"`; `grep -n "Тип резки\|cutType" download/atex/js/cut-map.js` → пусто.
- [ ] **Step 6:** Commit `fix(atex): cut-map — полосы из Резки напрямую (Тип резки упразднён), джамбо из сырья`.

---

## Task 3: Ретайр cut-calc

**Files:** Delete `download/atex/js/cut-calc.js`, `download/atex/css/cut-calc.css`, `templates/atex/cut-calc.html`, `experiments/atex-cut-calc.test.js`; modify `docs/atex_menu.json`.

- [ ] **Step 1:** `grep -rn "cut-calc\|AtexCutCalc" download/ templates/ docs/ experiments/ 2>/dev/null` — подтвердить, что никто (кроме самого cut-calc + меню + теста) не ссылается.
- [ ] **Step 2:** Удалить 4 файла (`git rm`). Убрать пункт «Калькулятор типов резки» (href=cut-calc) из `docs/atex_menu.json` (роли Admin/Диспетчер).
- [ ] **Step 3:** Verify — `grep -rn "cut-calc" download/ templates/ docs/atex_menu.json` → пусто (кроме истории/доков, которые правит Task 4); полный atex-сьют (оставшиеся) PASS.
- [ ] **Step 4:** Commit `chore(atex): ретайр «Калькулятор типов резки» (cut-calc) — Тип резки упразднён, редактор полос в production-planning`.
- [ ] **Step 5 (live, мной — вне субагента):** удалить запись меню «Калькулятор типов резки» (Menu 151) на боевой, чтобы пункт исчез.

---

## Task 4: Документация + полный прогон

**Files:** Modify `docs/atex_workplaces.md`.

- [ ] **Step 1:** atex_workplaces.md: §2 РМ-таблица — убрать «Тип резки» как сущность где не к месту, пометить «Калькулятор типов резки» (#2912) упразднённым (эпик); §3.1 orders — «Срок изготовления»; §3.7 cut-map — полосы из Резки; §3.2 (cut-calc) — отметить ретайр.
- [ ] **Step 2:** Полный прогон: `node experiments/atex-cut-layout.test.js`, `atex-production-planning.test.js`, `atex-cut-planning.test.js`, `atex-cut-map.test.js`, `test-issue-2911-atex-orders.js` — все PASS (atex-cut-calc удалён).
- [ ] **Step 3:** Commit `docs(atex): F4 — зачистка эпика (orders Срок изготовления, cut-map из Резки, cut-calc ретайр)`.

---

## Task 5: PR (выполняю я, не субагент)
- Push `epic-abolish-cuttype` в форк `unidel2035`; `gh pr create -R ideav/crm` base main; тело — весь эпик F1–F4 + что на live сделано + что деплоить через update.php.

## Самопроверка плана
- Покрытие спеки: orders=Task1; cut-map=Task2; cut-calc ретайр=Task3; доки+прогон=Task4; PR=Task5. Live-удаление меню — Task3 Step5 (мной).
- Резолв по имени; чистые ядра/тесты cut-map/cut-layout не трогаем; orders-тест поправить.

## Деплой
update.php (Андрей): orders.js, cut-map.js, production-planning.js(+css), cut-layout.js; удаление cut-calc.*. Live (мной): пункт меню cut-calc.
