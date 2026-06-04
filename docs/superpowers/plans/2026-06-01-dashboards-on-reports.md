# Dashboards на отчётах — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Перевести рабочее место «Дашборды» на 2 отчёта (`order_pipeline`, `material_stock`) вместо ~10 запросов (6 выгрузок + 4 count), агрегации считать на клиенте.

**Architecture:** Чистая функция `agg.rowsToEntities(pipelineRows)` разворачивает плоские строки отчёта в массивы сущностей (dedup по `*_id`) под ключи существующих агрегаторов; `collect()` фетчит 2 отчёта и кормит ими неизменные `ordersByStatus/slitterLoad/gpOutput/materialStock/productionFlow`. Метаданные/`object/`-чтения/счётчики убираются.

**Tech Stack:** ванильный ES5-JS (atex), Integram report API, node-тесты без зависимостей.

Спека: `docs/superpowers/specs/2026-06-01-dashboards-on-reports-design.md`.

---

## Файлы
- Modify: `download/atex/js/dashboards.js` — `agg` (+`rowsToEntities`), `collect()`, `start()`; удаление мёртвого кода.
- Modify: `experiments/atex-dashboards.test.js` — тесты `rowsToEntities`.
- Modify: `docs/integram-reports.md`, `docs/integram-app-workflow.md` — правило «минимум запросов».
- Операционно (боевая ateh, API): расширить отчёт `order_pipeline` (8303), создать `material_stock`.

---

### Task 1: Отчёты в боевой ateh (операционно, при деплое)

**`order_pipeline` (queryId 8303)** — добавить 9 колонок (`_m_new/28 up=8303`; для id-колонки затем `_m_set t104=85`):

| t100 | t28 | abn_ID? |
|---|---|---|
| position_status | 1146 | нет |
| position_length_m | 1143 | нет |
| cut_slitter | 1156 | нет |
| cut_footage_m | 1168 | нет |
| gp_status | 1192 | нет |
| gp_rolls | 1188 | нет |
| gp_footage_m | 1189 | нет |
| gp_address | 1191 | нет |
| gp_cut_id | 1185 | да (t104=85) |

**`material_stock` (новый)** — `_m_new/22 up=1 t22=material_stock`, колонки: `material`(t28=1117), `material_received_m2`(1121), `material_remainder_m2`(1123).

- [ ] **Step 1: Расширить order_pipeline**

```bash
DB=https://ideav.ru/ateh; TOKEN=<актуальный>
XSRF=$(curl -s -H "X-Authorization: $TOKEN" "$DB/xsrf?JSON=1" | jq -r ._xsrf)
add(){ curl -s "$DB/_m_new/28?JSON&up=8303" --data-urlencode "t28=$1" --data-urlencode "t100=$2" --data-urlencode "token=$TOKEN" --data-urlencode "_xsrf=$XSRF"; }
add 1146 position_status; add 1143 position_length_m
add 1156 cut_slitter;    add 1168 cut_footage_m
add 1192 gp_status;      add 1188 gp_rolls; add 1189 gp_footage_m; add 1191 gp_address
GPCUT=$(add 1185 gp_cut_id | python3 -c "import sys,json;d=json.load(sys.stdin);d=d[0] if isinstance(d,list) else d;print(d.get('id') or d.get('obj'))")
curl -s "$DB/_m_set/$GPCUT?JSON" --data-urlencode "t104=85" --data-urlencode "token=$TOKEN" --data-urlencode "_xsrf=$XSRF"
```

- [ ] **Step 2: Создать material_stock**

```bash
QID=$(curl -s "$DB/_m_new/22?JSON&up=1" --data-urlencode "t22=material_stock" --data-urlencode "token=$TOKEN" --data-urlencode "_xsrf=$XSRF" | python3 -c "import sys,json;d=json.load(sys.stdin);d=d[0] if isinstance(d,list) else d;print(d.get('id'))")
for tf in "1117|material" "1121|material_received_m2" "1123|material_remainder_m2"; do
  curl -s "$DB/_m_new/28?JSON&up=$QID" --data-urlencode "t28=${tf%%|*}" --data-urlencode "t100=${tf##*|}" --data-urlencode "token=$TOKEN" --data-urlencode "_xsrf=$XSRF" >/dev/null
done
```

- [ ] **Step 3: Проверить оба отчёта**

```bash
curl -s --compressed -H "X-Authorization: $TOKEN" "$DB/report/order_pipeline?JSON_KV" | python3 -c "import sys,json;d=json.load(sys.stdin);print('order_pipeline колонок:',len(d[0]) if d else 0)"
curl -s --compressed -H "X-Authorization: $TOKEN" "$DB/report/material_stock?JSON_KV" | python3 -c "import sys,json;d=json.load(sys.stdin);print('material_stock строк:',len(d))"
```
Expected: order_pipeline ≥ 24 колонок; material_stock — строки Партии сырья.

---

### Task 2: `agg.rowsToEntities` — строки отчёта → массивы сущностей (TDD)

**Files:** `experiments/atex-dashboards.test.js` (тест), `download/atex/js/dashboards.js` (реализация + экспорт в `agg`).

- [ ] **Step 1: Написать падающий тест**

В `experiments/atex-dashboards.test.js` перед итоговым выводом добавить:

```js
// ── rowsToEntities: строки отчёта order_pipeline → сущности ──
var PR = [
  { order_id:'10', order_no:'A-1', order_status:'Новый',
    position_id:'', provision_id:'', cut_id:'', gp_id:'' },
  { order_id:'11', order_no:'A-2', order_status:'Выполнен',
    position_id:'21', position_status:'Отгружена', position_cut_type:'TT', position_width_mm:'57', position_length_m:'10',
    provision_id:'31', provision_used_m:'1200', provision_status:'Выполнено',
    cut_id:'41', cut_no:'4', cut_slitter:'Станок 1', cut_status:'Завершён', cut_footage_m:'1300',
    gp_id:'51', gp_status:'Отгружен', gp_rolls:'10', gp_footage_m:'1200', gp_address:'A-3', gp_cut_id:'41' }
];
var ent = dashboards.rowsToEntities(PR);
assertEqual(ent.orders.length, 2, 'rowsToEntities: 2 заказа (dedup)');
assertEqual(ent.orders[0], { id:'10', number:'A-1', status:'Новый' }, 'rowsToEntities: заказ');
assertEqual(ent.cuts.length, 1, 'rowsToEntities: пустые стадии не создают резок');
assertEqual(ent.cuts[0], { id:'41', number:'4', slitter:'Станок 1', status:'Завершён', footage:'1300' }, 'rowsToEntities: резка');
assertEqual(ent.positions[0].orderId, '11', 'rowsToEntities: позиция знает заказ');
assertEqual(ent.provisions[0], { id:'31', positionId:'21', cutId:'41', gpId:'51', footage:'1200', status:'Выполнено' }, 'rowsToEntities: обеспечение');
assertEqual(ent.gpBatches[0], { id:'51', cutId:'41', status:'Отгружен', rolls:'10', footage:'1200', address:'A-3' }, 'rowsToEntities: ГП');
```

- [ ] **Step 2: Запустить — упадёт**

Run: `node experiments/atex-dashboards.test.js`
Expected: FAIL — `dashboards.rowsToEntities is not a function`.

- [ ] **Step 3: Реализовать**

В `dashboards.js` рядом с `productionFlow` (перед `var agg = {`) добавить:

```js
    // Плоские строки отчёта order_pipeline → массивы сущностей (dedup по *_id),
    // под ключи существующих агрегаторов и productionFlow. Пустые поздние стадии
    // (LEFT JOIN) не создают фантомных записей.
    function rowsToEntities(rows) {
        var orders = {}, positions = {}, provisions = {}, cuts = {}, gp = {};
        function vals(o) { return Object.keys(o).map(function(k) { return o[k]; }); }
        (rows || []).forEach(function(r) {
            if (r.order_id && !orders[r.order_id]) {
                orders[r.order_id] = { id: r.order_id, number: r.order_no || ('#' + r.order_id), status: r.order_status };
            }
            if (r.position_id && !positions[r.position_id]) {
                positions[r.position_id] = { id: r.position_id, orderId: r.order_id || '', cutType: r.position_cut_type, width: r.position_width_mm, length: r.position_length_m, status: r.position_status };
            }
            if (r.provision_id && !provisions[r.provision_id]) {
                provisions[r.provision_id] = { id: r.provision_id, positionId: r.position_id || '', cutId: r.cut_id || '', gpId: r.gp_id || '', footage: r.provision_used_m, status: r.provision_status };
            }
            if (r.cut_id && !cuts[r.cut_id]) {
                cuts[r.cut_id] = { id: r.cut_id, number: r.cut_no || ('#' + r.cut_id), slitter: r.cut_slitter, status: r.cut_status, footage: r.cut_footage_m };
            }
            if (r.gp_id && !gp[r.gp_id]) {
                gp[r.gp_id] = { id: r.gp_id, cutId: r.gp_cut_id || '', status: r.gp_status, rolls: r.gp_rolls, footage: r.gp_footage_m, address: r.gp_address };
            }
        });
        return { orders: vals(orders), positions: vals(positions), provisions: vals(provisions), cuts: vals(cuts), gpBatches: vals(gp) };
    }
```

В объект `agg` добавить `rowsToEntities: rowsToEntities,`.

- [ ] **Step 4: Запустить — пройдёт**

Run: `node experiments/atex-dashboards.test.js`
Expected: новые 7 PASS; прежние тесты агрегации остаются PASS.

- [ ] **Step 5: Коммит**

```bash
git add download/atex/js/dashboards.js experiments/atex-dashboards.test.js
git commit -m "feat(atex): dashboards.agg.rowsToEntities — строки отчёта в сущности"
```

---

### Task 3: `collect()` на 2 отчётах + чистка мёртвого кода

**Files:** `download/atex/js/dashboards.js`.

- [ ] **Step 1: Заменить метод `collect`**

Заменить весь метод `AtexDashboards.prototype.collect = function() { … };` на:

```js
    // Сбор сводок из двух отчётов (минимум запросов; агрегации — на клиенте).
    AtexDashboards.prototype.collect = function() {
        return Promise.all([
            this.getJson('report/order_pipeline?JSON_KV'),
            this.getJson('report/material_stock?JSON_KV')
        ]).then(function(res) {
            var e = rowsToEntities(res[0] || []);
            var rawBatches = (res[1] || []).map(function(r) {
                return { material: r.material, received: r.material_received_m2, remainder: r.material_remainder_m2 };
            });
            return {
                counts: { order: e.orders.length, cut: e.cuts.length, gp: e.gpBatches.length, rawBatch: rawBatches.length },
                orders: ordersByStatus(e.orders),
                slitters: slitterLoad(e.cuts),
                gp: gpOutput(e.gpBatches),
                materials: materialStock(rawBatches),
                flow: productionFlow({ orders: e.orders, positions: e.positions, provisions: e.provisions, cuts: e.cuts, gpBatches: e.gpBatches })
            };
        });
    };
```

- [ ] **Step 2: В `start()` убрать вызов `loadMetadata`**

Найти в `start()` цепочку вида `return this.loadMetadata().then(function() { return self.collect(); })` (или `.then(self.collect)`) и заменить на прямой `return this.collect().then(...)` — без `loadMetadata`. (Открыть `start()`, заменить только звено `loadMetadata().then(... collect ...)` на `collect()`, сохранив последующий `.then(render)/.catch(fatal)`.)

- [ ] **Step 3: Удалить мёртвый код**

Удалить ставшие неиспользуемыми (проверить `grep`, что больше нигде не вызываются): методы `count`, `loadAll`, `loadMetadata`, функцию `columnReader`, объекты `TABLE`, `ORDER_REQ`, `POSITION_REQ`, `PROVISION_REQ`, `CUT_REQ`, `GP_REQ`, `RAW_REQ`, и (если только collect их использовал) `refId`, `refLabel`, `reqIdByName`, поле `this.meta`. Перед удалением каждого — `grep -n "<имя>" download/atex/js/dashboards.js` → не должно остаться ссылок, кроме определения.

- [ ] **Step 4: Проверить загрузку модуля и тесты**

Run: `node -e "require('./download/atex/js/dashboards.js'); console.log('OK')"` → `OK`
Run: `node experiments/atex-dashboards.test.js` → все PASS (агрегаторы не тронуты).

- [ ] **Step 5: Коммит**

```bash
git add download/atex/js/dashboards.js
git commit -m "feat(atex): dashboards — данные из отчётов order_pipeline+material_stock, минус 8 запросов"
```

---

### Task 4: Правило «минимум серверных запросов» в документацию

**Files:** `docs/integram-reports.md`, `docs/integram-app-workflow.md`.

- [ ] **Step 1: Добавить правило в `docs/integram-reports.md`**

В раздел про выгоду отчётов добавить абзац:

```markdown
## Правило: минимизируй серверные запросы

Тяни данные минимумом отчётов (`report/`), а агрегации и счётчики считай на
клиенте. Фронт-вычисления дёшевы и никого не нагружают; разовая трудоёмкость
кода окупается годами сниженной нагрузки на сервер. Пример: dashboards заменил
~10 запросов (6 выгрузок + 4 count) на 2 отчёта (`order_pipeline`,
`material_stock`), агрегации — на клиенте из строк (dedup по `*_id`).
```

- [ ] **Step 2: Добавить ту же мысль в `docs/integram-app-workflow.md`** (раздел про отчёты, 1–2 предложения с тем же правилом).

- [ ] **Step 3: Коммит**

```bash
git add docs/integram-reports.md docs/integram-app-workflow.md
git commit -m "docs(atex): правило — минимум серверных запросов, агрегации на клиенте"
```

---

### Task 5: PR + проверка на бою

- [ ] **Step 1: PR** — `gh auth switch -u unidel2035 && gh auth setup-git`; push ветки в `unidel-fork`; `gh pr create -R ideav/crm --head unidel2035:atex-dashboards-on-reports --base main` с описанием (2 отчёта вместо 10 запросов); `gh auth switch -u gaveron18`.
- [ ] **Step 2: После деплоя формы (Андрей)** — Playwright на `/ateh/dashboards` с cookie `idb_ateh`: убедиться, что виджеты (поток, заказы по статусам, слиттеры, ГП, остатки сырья) рисуются и сетевых запросов к данным — два `report/`.

---

## Self-Review
- **Покрытие спеки:** отчёты A/B (Task 1), rowsToEntities (Task 2), collect на отчётах + чистка (Task 3), правило в доку (Task 4), деплой/PR/проверка (Task 5). Все пункты спеки покрыты.
- **Заглушек нет:** код rowsToEntities и collect приведён целиком; ключи сущностей (`id/number/status/slitter/footage/rolls/address/cutType/width/length/orderId/positionId/cutId/gpId`) совпадают с тем, что ждут существующие агрегаторы и `productionFlow` (см. spec и dashboards.js:476-571).
- **Согласованность имён:** колонки отчёта (`order_id`,`cut_slitter`,`gp_rolls`,…) одинаковы в Task 1 (создание) и Task 2 (чтение в rowsToEntities).
