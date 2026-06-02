# Доработка РМ «Приём и ведение заказов» (orders) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Перевести РМ `orders` на чтение отчётом `orders_list`, сделать позиции inline-редактируемыми (с подбором «Тип резки»), добавить фильтр дат + быстрый поиск + сортировку.

**Architecture:** Гибрид — даты/статус серверным фильтром отчёта `report/orders_list?JSON_KV` (перезапрос), поиск/сортировка клиентские по загруженным заказам. Запись позиций — прямые `_m_set`/`_m_del`. Новые чистые функции (`rowsToOrders`/`searchOrders`/`sortOrders`) экспортируются в `window.AtexOrdersTesting` и покрыты юнит-тестами.

**Tech Stack:** Vanilla JS (IIFE `(function(window, document){…})`), Integram report/object API, node + `vm.runInNewContext` для юнит-тестов (без DOM/сети), деплой через `update.php`.

**Спецификация:** `docs/superpowers/specs/2026-06-02-orders-workplace-enhancements-design.md`

---

## Структура файлов

- **Создать (на бою, не в репозитории):** отчёт `orders_list` (queryId присвоит сервер) — таблица 22 + колонки таблицы 28.
- **Изменить:** `download/atex/js/orders.js` — добавить `rowsToOrders`/`searchOrders`/`sortOrders`, перевести `loadOrders` на отчёт, добавить тулбар-обвязку (даты/поиск), сортировку заголовков, inline-правку позиций.
- **Изменить:** `templates/atex/orders.html` — тулбар в одну строку (статус + С + По + поиск).
- **Изменить:** `download/atex/css/orders.css` — стили тулбара/inline-правки/индикатора сортировки.
- **Создать:** `experiments/test-issue-orders-enh.js` — юнит-тесты `rowsToOrders`/`searchOrders`/`sortOrders` (харнесс как в `test-issue-3041-atex-orders-search.js`).

Соглашение тестов: загрузка orders.js через `vm.runInNewContext` с моками `window/document`, проверка через `sandbox.window.AtexOrdersTesting`.

---

## Task 0: Отчёт `orders_list` на боевой ateh

**Files:** только боевая БД (API). Изменений в репозитории нет.

- [ ] **Step 1: Получить токен и xsrf**

Run:
```bash
TOKEN=76f723b8-dde6-44fb-b906-1dafdbd7a421   # уточнить актуальный у Андрея, ротируется
XSRF=$(curl -s --compressed -H "X-Authorization: $TOKEN" -b "idb_ateh=$TOKEN" "https://ideav.ru/ateh/xsrf?JSON=1" | python3 -c "import sys,json;print(json.load(sys.stdin)['_xsrf'])")
echo "$XSRF"
```
Expected: непустой 22-символьный xsrf.

- [ ] **Step 2: Создать отчёт + колонки**

Колонки источников (по metadata 1075/1076): order abn_ID(t104=85), order_no=1075, Клиент=1125, Пользователь=1126, Дата создания=1128, Дата согласования=1130, Статус=1131; position abn_ID(t104=85), Кол-во/Вид сырья/Тип резки/Ширина/Длина/Диаметр втулки/Тип намотки/Статус — реквизиты 1076 (резолвить id по metadata/1076).

Run (по образцу `material_batches`; reqId позиций подставить из `curl .../metadata/1076?JSON=1`):
```bash
J(){ curl -s --compressed -H "X-Authorization: $TOKEN" -b "idb_ateh=$TOKEN" "$@"; }
QID=$(J -X POST "https://ideav.ru/ateh/_m_new/22?JSON&up=1" --data-urlencode "_xsrf=$XSRF" --data-urlencode "token=$TOKEN" --data-urlencode "t22=orders_list" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('obj') or d.get('id'))")
echo "QID=$QID"
addcol(){ local b="--data-urlencode _xsrf=$XSRF --data-urlencode token=$TOKEN --data-urlencode t28=$1 --data-urlencode t100=$2"; [ -n "$3" ] && b="$b --data-urlencode t104=$3"; J -X POST "https://ideav.ru/ateh/_m_new/28?JSON&up=$QID" $b >/dev/null; echo "  + $2"; }
addcol 1075 order_id 85
addcol 1075 order_no
addcol 1125 order_client
addcol 1126 order_manager
addcol 1128 order_created
addcol 1130 order_approved
addcol 1131 order_status
addcol 1076 position_id 85
# реквизиты позиции — резолвим id по имени из metadata/1076 (id зависят от сборки):
declare -A P
while IFS=$'\t' read -r id name; do P["$name"]="$id"; done < <(J "https://ideav.ru/ateh/metadata/1076?JSON=1" | python3 -c "import sys,json;[print(r['id']+chr(9)+r['val']) for r in json.load(sys.stdin)['reqs']]")
addcol "${P[Кол-во]:-${P[Количество]}}"      position_qty
addcol "${P[Вид сырья]}"                       position_raw
addcol "${P[Тип резки]}"                        position_cut_type
addcol "${P[Ширина, мм]:-${P[Ширина]}}"        position_width
addcol "${P[Длина, м]:-${P[Длина]}}"           position_length
addcol "${P[Диаметр втулки]}"                  position_sleeve
addcol "${P[Тип намотки]}"                      position_winding
addcol "${P[Статус]}"                           position_status
```
(Известные ориентиры из отчёта `positions_list`: Тип резки=1140, Ширина=1141, Кол-во=1137 — но полагаемся на резолв по имени выше.)
Expected: `QID` непустой, каждая колонка добавлена без ошибки.

- [ ] **Step 3: Провалидировать JOIN и фильтры на бою**

Run:
```bash
J "https://ideav.ru/ateh/report/orders_list?JSON_KV&LIMIT=0,50" | python3 -m json.tool --no-ensure-ascii | head -40
# фильтр дат:
J "https://ideav.ru/ateh/report/orders_list?JSON_KV&FR_order_created=2026-05-01&TO_order_created=2026-06-30&LIMIT=0,50" | python3 -c "import sys,json;print('строк:',len(json.load(sys.stdin)))"
```
Expected: ряды с заполненными `order_*` и (где есть позиции) `position_*`; заказы без позиций — с пустыми `position_id`. Фильтр дат сужает выборку. Если exact-фильтр по статусу нужен иначе — зафиксировать рабочий вариант (`FR_order_status=`/`F_…`) здесь же.

- [ ] **Step 4: Записать queryId в spec**

Дописать в spec реальный `orders_list` queryId и проверенный синтаксис фильтра статуса. Commit:
```bash
git add docs/superpowers/specs/2026-06-02-orders-workplace-enhancements-design.md
git commit -m "docs(atex): orders_list queryId и синтаксис фильтров (бой)"
```

---

## Task 1: Чистая `rowsToOrders` (плоский отчёт → заказы+позиции)

**Files:**
- Modify: `download/atex/js/orders.js` (новая функция + экспорт в `AtexOrdersTesting`)
- Test: `experiments/test-issue-orders-enh.js`

- [ ] **Step 1: Написать падающий тест**

Создать `experiments/test-issue-orders-enh.js`:
```js
/* Юнит-тесты доработок РМ orders: rowsToOrders / searchOrders / sortOrders. */
const fs = require('fs'); const path = require('path'); const vm = require('vm'); const assert = require('assert');
const source = fs.readFileSync(path.join(__dirname, '..', 'download', 'atex', 'js', 'orders.js'), 'utf8');
const sandbox = { window: {}, document: { readyState: 'loading', addEventListener(){}, getElementById(){ return null; } },
    console, URLSearchParams, URL, setTimeout, clearTimeout, fetch(){ throw new Error('no fetch'); } };
sandbox.window.window = sandbox.window; sandbox.window.document = sandbox.document;
vm.runInNewContext(source, sandbox, { filename: 'orders.js' });
const H = sandbox.window.AtexOrdersTesting;
let passed = 0;
function eq(a, e, name){ const ok = JSON.stringify(a) === JSON.stringify(e); console.log((ok?'PASS':'FAIL')+' — '+name); if(ok){passed++;}else{console.log('  exp:',JSON.stringify(e));console.log('  got:',JSON.stringify(a));process.exitCode=1;} }

// rowsToOrders: дедуп заказов по order_id; позиции из рядов с непустым position_id;
// заказ без позиций (пустой position_id) остаётся с positions: [].
const rows = [
  { order_id:'10', order_no:'1', order_client:'ООО Ромашка', order_manager:'Иванов', order_created:'01.06.2026', order_approved:'', order_status:'Новый',
    position_id:'100', position_qty:'5', position_raw:'MWR118', position_cut_type:'25мм×35 / MWR118', position_width:'25', position_length:'910', position_sleeve:'25', position_winding:'IN', position_status:'Новая' },
  { order_id:'10', order_no:'1', order_client:'ООО Ромашка', order_manager:'Иванов', order_created:'01.06.2026', order_approved:'', order_status:'Новый',
    position_id:'101', position_qty:'3', position_raw:'MW308', position_cut_type:'110мм×8 / MW308', position_width:'110', position_length:'910', position_sleeve:'40', position_winding:'OUT', position_status:'В работе' },
  { order_id:'20', order_no:'2', order_client:'ИП Петров', order_manager:'Сидоров', order_created:'02.06.2026', order_approved:'02.06.2026', order_status:'Согласован',
    position_id:'', position_qty:'', position_raw:'', position_cut_type:'', position_width:'', position_length:'', position_sleeve:'', position_winding:'', position_status:'' }
];
const out = H.rowsToOrders(rows);
eq(out.length, 2, 'rowsToOrders: 2 заказа (дедуп по order_id)');
eq(out[0].id, '10', 'rowsToOrders: id заказа');
eq(out[0].values.client, 'ООО Ромашка', 'rowsToOrders: значения заказа');
eq(out[0].positions.length, 2, 'rowsToOrders: 2 позиции у заказа 10');
eq(out[0].positions[0].id, '100', 'rowsToOrders: id позиции');
eq(out[0].positions[1].values.cutType, '110мм×8 / MW308', 'rowsToOrders: значения позиции');
eq(out[1].positions.length, 0, 'rowsToOrders: заказ без позиций → пустой список');

console.log('\n' + passed + ' assertions passed');
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `node experiments/test-issue-orders-enh.js`
Expected: FAIL — `H.rowsToOrders is not a function`.

- [ ] **Step 3: Реализовать `rowsToOrders`**

В `orders.js` рядом с другими чистыми хелперами (после `matchCutTypes`, ~строка 145) добавить:
```js
// Плоские строки отчёта orders_list (JSON_KV) → [{ id, values, positions:[{id,values}] }].
// Заказы dedup по order_id; позиции из строк с непустым position_id; пустые поля LEFT JOIN ('').
function rowsToOrders(rows) {
    var byId = {}, order = [];
    function s(v) { return v == null ? '' : String(v); }
    (rows || []).forEach(function(r) {
        var oid = s(r.order_id);
        if (oid && !byId[oid]) {
            byId[oid] = { id: oid, values: {
                no: s(r.order_no), client: s(r.order_client), manager: s(r.order_manager),
                created: s(r.order_created), approved: s(r.order_approved), status: s(r.order_status)
            }, positions: [] };
            order.push(oid);
        }
        var pid = s(r.position_id);
        if (oid && pid) {
            byId[oid].positions.push({ id: pid, values: {
                qty: s(r.position_qty), raw: s(r.position_raw), cutType: s(r.position_cut_type),
                width: s(r.position_width), length: s(r.position_length), sleeve: s(r.position_sleeve),
                winding: s(r.position_winding), status: s(r.position_status)
            } });
        }
    });
    return order.map(function(id) { return byId[id]; });
}
```
И добавить `rowsToOrders: rowsToOrders,` в блок `window.AtexOrdersTesting`.

- [ ] **Step 4: Запустить тест — убедиться, что проходит**

Run: `node experiments/test-issue-orders-enh.js`
Expected: PASS (7 ассертов rowsToOrders).

- [ ] **Step 5: Commit**

```bash
git add download/atex/js/orders.js experiments/test-issue-orders-enh.js
git commit -m "feat(atex): rowsToOrders — разбор отчёта orders_list в заказы+позиции"
```

---

## Task 2: Чистая `searchOrders` (клиентский поиск по всему)

**Files:**
- Modify: `download/atex/js/orders.js`
- Test: `experiments/test-issue-orders-enh.js`

- [ ] **Step 1: Дописать падающий тест** (в конец файла, перед строкой итога)

```js
// searchOrders: заказ виден, если запрос совпал с любым полем заказа ИЛИ любой позиции
// (регистронезависимо, по нормализованному тексту). Пустой запрос → весь список.
const list = H.rowsToOrders(rows);
eq(H.searchOrders(list, '').length, 2, 'searchOrders: пустой запрос → все');
eq(H.searchOrders(list, 'ромашка').map(function(o){return o.id;}), ['10'], 'searchOrders: по клиенту (регистр)');
eq(H.searchOrders(list, 'петров').map(function(o){return o.id;}), ['20'], 'searchOrders: по другому клиенту');
eq(H.searchOrders(list, 'mw308').map(function(o){return o.id;}), ['10'], 'searchOrders: по полю позиции (тип резки)');
eq(H.searchOrders(list, 'нетакого').length, 0, 'searchOrders: нет совпадений → пусто');
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `node experiments/test-issue-orders-enh.js`
Expected: FAIL — `H.searchOrders is not a function`.

- [ ] **Step 3: Реализовать `searchOrders`** (использует существующий `normalizeSearchText`)

```js
// Клиентский поиск по всем полям заказа и его позиций.
function searchOrders(list, query) {
    var q = normalizeSearchText(query);
    if (!q) return (list || []).slice();
    return (list || []).filter(function(o) {
        var hay = [o.id].concat(Object.keys(o.values).map(function(k){ return o.values[k]; }));
        (o.positions || []).forEach(function(p) {
            hay.push(p.id);
            Object.keys(p.values).forEach(function(k){ hay.push(p.values[k]); });
        });
        return normalizeSearchText(hay.join(' ')).indexOf(q) !== -1;
    });
}
```
Добавить `searchOrders: searchOrders,` в `AtexOrdersTesting`.

- [ ] **Step 4: Запустить — убедиться, что проходит**

Run: `node experiments/test-issue-orders-enh.js`
Expected: PASS (+5 ассертов).

- [ ] **Step 5: Commit**

```bash
git add download/atex/js/orders.js experiments/test-issue-orders-enh.js
git commit -m "feat(atex): searchOrders — клиентский поиск по заказам и позициям"
```

---

## Task 3: Чистая `sortOrders` (сортировка заказов по колонке)

**Files:**
- Modify: `download/atex/js/orders.js`
- Test: `experiments/test-issue-orders-enh.js`

- [ ] **Step 1: Дописать падающий тест**

```js
// sortOrders: сортировка заказов по ключу значения; dir 'asc'|'desc'.
// Числа — численно, даты DD.MM.YYYY — хронологически, прочее — текст (localeCompare ru).
const sl = H.rowsToOrders(rows);
eq(H.sortOrders(sl, 'client', 'asc').map(function(o){return o.id;}), ['20','10'], 'sortOrders: по клиенту asc (ИП<ООО)');
eq(H.sortOrders(sl, 'client', 'desc').map(function(o){return o.id;}), ['10','20'], 'sortOrders: по клиенту desc');
eq(H.sortOrders(sl, 'created', 'asc').map(function(o){return o.id;}), ['10','20'], 'sortOrders: по дате создания asc');
eq(H.sortOrders(sl, 'created', 'desc').map(function(o){return o.id;}), ['20','10'], 'sortOrders: по дате desc');
// не мутирует исходный список:
H.sortOrders(sl, 'client', 'desc'); eq(sl.map(function(o){return o.id;}), ['10','20'], 'sortOrders: не мутирует вход');
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `node experiments/test-issue-orders-enh.js`
Expected: FAIL — `H.sortOrders is not a function`.

- [ ] **Step 3: Реализовать `sortOrders`**

```js
// Парс даты DD.MM.YYYY → сортируемое число (YYYYMMDD); иначе NaN.
function sortKeyDate(v) {
    var m = String(v == null ? '' : v).match(/^(\d{2})\.(\d{2})\.(\d{4})/);
    return m ? Number(m[3] + m[2] + m[1]) : NaN;
}
// Сортировка заказов по o.values[key] (id — по o.id). Возвращает новый массив.
function sortOrders(list, key, dir) {
    var sign = dir === 'desc' ? -1 : 1;
    var get = function(o) { return key === 'id' ? o.id : (o.values ? o.values[key] : ''); };
    return (list || []).slice().sort(function(a, b) {
        var va = get(a), vb = get(b);
        var da = sortKeyDate(va), db = sortKeyDate(vb);
        if (!isNaN(da) && !isNaN(db)) return sign * (da - db);
        var na = parseFloat(va), nb = parseFloat(vb);
        if (!isNaN(na) && !isNaN(nb) && String(va).trim() !== '' && String(vb).trim() !== '') return sign * (na - nb);
        return sign * String(va).localeCompare(String(vb), 'ru');
    });
}
```
Добавить `sortOrders: sortOrders,` в `AtexOrdersTesting`.

- [ ] **Step 4: Запустить — убедиться, что проходит**

Run: `node experiments/test-issue-orders-enh.js`
Expected: PASS (+5 ассертов; всего 17).

- [ ] **Step 5: Commit**

```bash
git add download/atex/js/orders.js experiments/test-issue-orders-enh.js
git commit -m "feat(atex): sortOrders — сортировка заказов по колонке (числа/даты/текст)"
```

---

## Task 4: `loadOrders` через отчёт `orders_list` + серверные фильтры

**Files:**
- Modify: `download/atex/js/orders.js:798-809` (`loadOrders`) и `state` (добавить `filterFrom`/`filterTo`/`searchQuery`/`sortKey`/`sortDir`)

- [ ] **Step 1: Добавить поля состояния**

В объект `state` (рядом с `statusFilter`, ~строка 70) добавить:
```js
        filterFrom: '',      // дата С (YYYY-MM-DD); инициализируется вчерашней при init
        filterTo: '',        // дата По (YYYY-MM-DD)
        searchQuery: '',     // быстрый поиск (клиент)
        sortKey: 'id',       // колонка сортировки заказа
        sortDir: 'desc',     // направление
```

- [ ] **Step 2: Переписать `loadOrders` на отчёт**

Заменить тело `loadOrders` (строки 798-809):
```js
    function loadOrders() {
        var params = ['JSON_KV', 'LIMIT=0,5000'];
        if (state.filterFrom) params.push('FR_order_created=' + encodeURIComponent(state.filterFrom));
        if (state.filterTo) params.push('TO_order_created=' + encodeURIComponent(state.filterTo));
        if (trimValue(state.statusFilter)) params.push('FR_order_status=' + encodeURIComponent(trimValue(state.statusFilter))); // exact-синтаксис подтверждён в Task 0
        var url = '/' + encodeURIComponent(state.db) + '/report/orders_list?' + params.join('&');
        return fetchJson(url).then(function(rows) {
            state.orders = rowsToOrders(rows || []);
            renderOrders();
        });
    }
```
Примечание: позиции теперь приходят в отчёте — ленивую загрузку позиций (по разворачиванию) убрать; `renderPositions(order)` должен брать `order.positions` напрямую. Колонку «Позиций» (posCount) в строке заказа считать как `order.positions.length` (раньше — ROLLUP-реквизит).

- [ ] **Step 3: Прогнать юнит-тесты ядра**

Run: `node experiments/test-issue-orders-enh.js` && `node experiments/test-issue-3041-atex-orders-search.js`
Expected: PASS (ядро не задето; loadOrders — сетевой, проверяется в браузере на финале).

- [ ] **Step 4: Commit**

```bash
git add download/atex/js/orders.js
git commit -m "feat(atex): loadOrders через report/orders_list + серверные фильтры дат/статуса"
```

---

## Task 5: Тулбар в одну строку — даты С/По + быстрый поиск

**Files:**
- Modify: `templates/atex/orders.html:8-19` (toolbar)
- Modify: `download/atex/css/orders.css` (раскладка toolbar в строку)
- Modify: `download/atex/js/orders.js` (инициализация дефолта «С=вчера», обработчики)

- [ ] **Step 1: Разметка тулбара**

В `orders.html` внутри `.atex-orders-toolbar` после фильтра статуса добавить:
```html
        <label class="atex-orders-filter-wrap"><span>С:</span>
            <input id="atex-orders-from" type="date" class="atex-orders-input" aria-label="Дата создания с"></label>
        <label class="atex-orders-filter-wrap"><span>По:</span>
            <input id="atex-orders-to" type="date" class="atex-orders-input" aria-label="Дата создания по"></label>
        <label class="atex-orders-filter-wrap atex-orders-search-wrap">
            <i class="pi pi-search"></i>
            <input id="atex-orders-search" type="search" class="atex-orders-input" placeholder="Поиск…" aria-label="Быстрый поиск"></label>
```

- [ ] **Step 2: CSS — toolbar в одну строку с переносом**

В `orders.css` добавить/уточнить:
```css
.atex-orders-toolbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.atex-orders-search-wrap { flex: 1 1 220px; }
.atex-orders-search-wrap input { width: 100%; }
```

- [ ] **Step 3: Инициализация «С=вчера» и обработчики**

В `init` (где навешиваются обработчики тулбара) добавить:
```js
        var fromEl = document.getElementById('atex-orders-from');
        var toEl = document.getElementById('atex-orders-to');
        var searchEl = document.getElementById('atex-orders-search');
        if (fromEl) {
            var y = new Date(); y.setDate(y.getDate() - 1);
            state.filterFrom = y.toISOString().slice(0, 10);  // YYYY-MM-DD
            fromEl.value = state.filterFrom;
            fromEl.addEventListener('change', function(){ state.filterFrom = fromEl.value; loadOrders(); });
        }
        if (toEl) toEl.addEventListener('change', function(){ state.filterTo = toEl.value; loadOrders(); });
        if (searchEl) {
            var t = null;
            searchEl.addEventListener('input', function(){
                if (t) clearTimeout(t);
                t = setTimeout(function(){ state.searchQuery = searchEl.value; renderOrders(); }, 200);
            });
        }
```
Статус-фильтр перевести на серверный: его обработчик теперь вызывает `loadOrders()` (раньше — клиентский ререндер).

- [ ] **Step 4: Браузерная проверка раскладки**

Открыть `/ateh/orders` (со стороны Андрея — egress hive виснет на крупных ответах, см. spec): тулбар в одну строку, «С» = вчера, изменение дат/статуса перезапрашивает, ввод в поиск фильтрует мгновенно.

- [ ] **Step 5: Commit**

```bash
git add templates/atex/orders.html download/atex/css/orders.css download/atex/js/orders.js
git commit -m "feat(atex): тулбар orders в одну строку — даты С(вчера)/По + быстрый поиск"
```

---

## Task 6: Сортировка по колонкам заказа + применение поиска/сортировки в рендере

**Files:**
- Modify: `download/atex/js/orders.js` (`renderOrders` — применять search+sort; заголовки кликабельны)
- Modify: `download/atex/css/orders.css` (индикатор сортировки)

- [ ] **Step 1: Применять search+sort в `renderOrders`**

В начале `renderOrders` (после получения контейнера) заменить источник строк на отфильтрованный/отсортированный:
```js
        var rows = sortOrders(searchOrders(state.orders, state.searchQuery), state.sortKey, state.sortDir);
        // далее рендер по `rows` вместо state.orders
```

- [ ] **Step 2: Кликабельные заголовки**

В разметке `<thead>` заказа каждому сортируемому `<th>` добавить `data-sort="<key>"` (ключи: `id`,`client`,`manager`,`created`,`approved`,`status`) и класс-индикатор `is-sorted-asc/desc` при `state.sortKey===key`. После рендера навесить делегированный обработчик (один раз):
```js
        container.querySelectorAll('th[data-sort]').forEach(function(th){
            th.style.cursor = 'pointer';
            th.addEventListener('click', function(){
                var key = th.getAttribute('data-sort');
                if (state.sortKey === key) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
                else { state.sortKey = key; state.sortDir = 'asc'; }
                renderOrders();
            });
        });
```

- [ ] **Step 3: CSS-индикатор**

```css
th[data-sort].is-sorted-asc::after { content: ' ▲'; }
th[data-sort].is-sorted-desc::after { content: ' ▼'; }
```

- [ ] **Step 4: Браузерная проверка** — клик по заголовку сортирует, повторный клик меняет направление; поиск и сортировка работают вместе.

- [ ] **Step 5: Commit**

```bash
git add download/atex/js/orders.js download/atex/css/orders.css
git commit -m "feat(atex): сортировка заказов по колонкам + поиск в рендере orders"
```

---

## Task 7: Inline-правка позиций (+ подбор «Тип резки», удаление)

**Files:**
- Modify: `download/atex/js/orders.js` (`renderPositions` — кнопки ✎/🗑; режим правки; сохранение/удаление)

- [ ] **Step 1: Кнопки в строке позиции**

В `renderPositions` (строка позиции ~631) добавить в строку ячейку действий:
```js
                    '<td class="atex-orders-pos-actions">' +
                      '<button type="button" class="atex-orders-icon" data-edit-pos="' + escapeHtml(pos.id) + '" title="Править">✎</button>' +
                      '<button type="button" class="atex-orders-icon" data-del-pos="' + escapeHtml(pos.id) + '" title="Удалить">🗑</button>' +
                    '</td>' +
```

- [ ] **Step 2: Режим правки — поля в ячейках**

По клику `[data-edit-pos]` перерисовать строку позиции в режиме правки: Кол-во/Ширина/Длина — `<input>`; Вид сырья/Тип резки/Диаметр втулки — `searchableRefSelectHtml(...)` (существующий рендер ref-селекта); Статус/Тип намотки — select/инпут; кнопки «Сохранить»(`data-save-pos`)/«Отмена». **Тип резки** оборачиваем с `data-atex-cuttype-allowed` и при изменении Вида сырья/Ширины пересчитываем через существующую логику (тот же путь, что в форме добавления — функция, вызывающая `matchCutTypes(state.cutTypeIndex, materialId, width)`; см. строки 677-695). При нужде вызвать `ensureStripWidths(materialId)` перед подбором.

- [ ] **Step 3: Сохранение правки (`_m_set`)**

По `[data-save-pos]` собрать значения полей, сформировать `t{reqId}` по `state.positionColumns` (как в `buildCreatePositionRequest`, только для существующего id), отправить `POST _m_set/{positionId}` с `_xsrf`, затем `loadOrders()`:
```js
        // url: '/' + db + '/_m_set/' + positionId  (тело: t{reqId}=значение… + _xsrf)
        postForm(setUrl, body).then(function(){ return loadOrders(); })
            .then(function(){ setMessage('Позиция сохранена', 'success'); })
            .catch(function(e){ setMessage('Ошибка сохранения: ' + (e.message||e), 'error'); });
```

- [ ] **Step 4: Удаление позиции (`_m_del`)**

По `[data-del-pos]` (с подтверждением через существующий механизм сообщений, не `confirm()`):
```js
        // url: '/' + db + '/_m_del/' + positionId  (тело: _xsrf)
        postForm(delUrl, body).then(function(){ return loadOrders(); })
            .then(function(){ setMessage('Позиция удалена', 'success'); })
            .catch(function(e){ setMessage('Ошибка удаления: ' + (e.message||e), 'error'); });
```

- [ ] **Step 5: Прогнать юнит-тесты ядра**

Run: `node experiments/test-issue-orders-enh.js && node experiments/test-issue-3041-atex-orders-search.js && node experiments/test-issue-2911-atex-orders.js`
Expected: PASS.

- [ ] **Step 6: Браузерная проверка (со стороны Андрея)** — правка позиции сохраняется; в режиме правки «Тип резки» показывает только подходящие по виду+ширине; удаление работает; список перезагружается.

- [ ] **Step 7: Commit**

```bash
git add download/atex/js/orders.js
git commit -m "feat(atex): inline-правка позиций заказа (+ подбор Тип резки, удаление)"
```

---

## Task 8: Финал — PR, деплой, проверка

- [ ] **Step 1: Полный прогон юнит-тестов orders**

Run: `for t in experiments/test-issue-orders-enh.js experiments/test-issue-3041-atex-orders-search.js experiments/test-issue-2911-atex-orders.js; do node "$t" || break; done`
Expected: все PASS.

- [ ] **Step 2: Push в форк + PR в ideav/crm**

```bash
gh auth switch -u unidel2035 && gh auth setup-git
git push -u unidel-fork orders-enhancements-eadc1d83
gh pr create -R ideav/crm --base main --head unidel2035:orders-enhancements-eadc1d83 --title "feat(atex): orders — правка позиций, фильтры/поиск/сортировка, отчёт orders_list" --body "См. docs/superpowers/specs/2026-06-02-orders-workplace-enhancements-design.md"
gh auth switch -u gaveron18
```

- [ ] **Step 3: После мержа — деплой**

`gh pr merge {N} -R ideav/crm --squash` (под unidel2035) → `curl -s "https://ideav.ru/update.php?config=update.conf"` → проверить live-файл `curl --compressed https://ideav.ru/download/ateh/js/orders.js | grep rowsToOrders`.

- [ ] **Step 4: Браузер-проверка со стороны Андрея** — РМ `/ateh/orders`: фильтр дат (С=вчера), поиск, сортировка, inline-правка позиций с подбором типа резки, удаление. (Playwright/curl с hive не годятся на крупных ответах — см. spec.)

---

## Заметки по реализации

- **Запись остаётся `_m_*`** (отчёты только читают). После любой записи — `loadOrders()` (перезапрос отчёта).
- **Egress hive виснет на крупных ответах ideav.ru** (>~20КБ wire) — фильтр дат (С=вчера) держит выборку небольшой; браузер-проверки крупных страниц делать со стороны Андрея, не через curl/Playwright с hive.
- **Грант:** отчёт `orders_list` не требует грант на объект 22; роль Менеджер имеет доступ к таблицам 1075/1076 и справочникам — подтвердить при создании (Task 0).
- **Переиспользование:** `matchCutTypes`, `searchableRefSelectHtml`, `filterRefOptions`, `ensureStripWidths`, `normalizeSearchText`, `postForm`, `fetchJson` уже есть в `orders.js`.
