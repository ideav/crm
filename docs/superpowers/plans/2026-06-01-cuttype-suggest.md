# Фильтр «Тип резки» при вводе заказа — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** При вводе позиции заказа список «Тип резки» жёстко фильтруется по выбранному «Вид сырья» и точному совпадению заказанной «Ширина, мм» с шириной полос типа.

**Architecture:** Расширяем РМ «Заказы» (`download/atex/js/orders.js`, ES5 IIFE c `window.AtexOrders`/`window.AtexOrdersTesting`). Чистая логика матча выносится в функцию, экспортируемую через `AtexOrdersTesting`, и тестируется в `experiments/` через vm-sandbox (паттерн `experiments/test-issue-2911-atex-orders.js`). Данные: типы резки грузятся один раз (`object/{Тип резки}`), ширины полос — лениво по сырью с кэшем (подчинённая «Полоса» без `F_U` пуста, см. docs/MCP.md). DOM-слой перерисовывает `<option>` списка «Тип резки» при смене сырья/ширины и сбрасывает несовместимый выбор.

**Tech Stack:** ванильный ES5 JS, Integram REST (`object/…?JSON_OBJ&F_U=`), vm-sandbox node-тесты.

**Спека:** `docs/superpowers/specs/2026-06-01-cuttype-suggest-design.md`. Эпик ideav/atex#52, подзадача C.

---

## Структура файлов

| Файл | Ответственность | Действие |
|---|---|---|
| `download/atex/js/orders.js` | РМ Менеджера: матч-ядро + загрузка типов/полос + фильтр select | Modify |
| `experiments/test-issue-52C-cuttype-suggest.js` | vm-тесты чистого ядра `matchCutTypes` | Create |

Имена реквизитов (резолв по имени): `Тип резки`(104).`Вид сырья`(1025); `Полоса`(105).`Ширина, мм`(1038), подчинена типу резки (F_U=typeId).

---

## Task 1: Чистое ядро `matchCutTypes` + экспорт + тесты

**Files:**
- Modify: `download/atex/js/orders.js`
- Create: `experiments/test-issue-52C-cuttype-suggest.js`

Чистая функция фильтра + терпимое сравнение ширины. Тест через vm-sandbox (как `test-issue-2911-atex-orders.js`).

- [ ] **Step 1: Написать падающий тест**

Создать `experiments/test-issue-52C-cuttype-suggest.js`:
```javascript
/*
 * Тест ядра подбора «Тип резки» при вводе заказа (ideav/atex#52, подзадача C).
 * Чистая функция matchCutTypes(index, materialId, width) — без DOM/сети.
 * Run: node experiments/test-issue-52C-cuttype-suggest.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const scriptPath = path.join(__dirname, '..', 'download', 'atex', 'js', 'orders.js');
const source = fs.readFileSync(scriptPath, 'utf8');
const sandbox = {
    window: {}, document: { readyState: 'loading', addEventListener: function(){}, getElementById: function(){ return null; } },
    console, URLSearchParams, URL, setTimeout, clearTimeout,
    fetch: function(){ throw new Error('fetch should not be called by helper tests'); }
};
sandbox.window.window = sandbox.window;
sandbox.window.document = sandbox.document;
vm.runInNewContext(source, sandbox, { filename: scriptPath });
const T = sandbox.window.AtexOrdersTesting;
assert(T && typeof T.matchCutTypes === 'function', 'matchCutTypes exposed');

// index: { typeId -> { materialId, widths:[..] } }. widths отсутствуют, пока полосы не загружены.
const index = {
    '10': { materialId: '1', widths: [110] },
    '11': { materialId: '1', widths: [60, 40] },   // комбинированный
    '12': { materialId: '2', widths: [110] },
    '13': { materialId: '1' }                       // полосы ещё не загружены
};
let n = 0;
function eq(a, b, name){ assert.deepStrictEqual(a, b, name); n++; }

// пустой материал → все типы
eq(T.matchCutTypes(index, '', '').sort(), ['10','11','12','13'], 'no material → all');
// материал без ширины → типы материала
eq(T.matchCutTypes(index, '1', '').sort(), ['10','11','13'], 'material only');
// материал + точная ширина → совпавшие по полосе
eq(T.matchCutTypes(index, '1', '110'), ['10'], 'material + width 110');
// комбинированный проходит, если одна из полос == ширине
eq(T.matchCutTypes(index, '1', '60'), ['11'], 'combo strip matches');
// ширина не совпадает → пусто
eq(T.matchCutTypes(index, '1', '999'), [], 'no width match');
// тип без загруженных полос при заданной ширине — не проходит
eq(T.matchCutTypes(index, '1', '70'), [], 'unloaded widths excluded when width set');
// терпимость к запятой/пробелам
eq(T.matchCutTypes(index, '1', ' 110 '), ['10'], 'width tolerant parse');

console.log(n + ' assertions passed');
```

- [ ] **Step 2: Запустить → FAIL**

Run: `node experiments/test-issue-52C-cuttype-suggest.js`
Expected: FAIL — `matchCutTypes exposed` assertion (функции ещё нет).

- [ ] **Step 3: Реализовать `matchCutTypes` (+ хелпер ширины)**

В `download/atex/js/orders.js`, рядом с другими чистыми хелперами (например возле `parseRef`), добавить:
```javascript
    // Терпимый разбор ширины: запятая как десятичный разделитель, пробелы прочь.
    // Пусто/мусор → NaN (чтобы «нет ширины» отличалось от 0).
    function parseWidth(value) {
        var s = String(value == null ? '' : value).replace(/\s+/g, '').replace(',', '.');
        if (s === '') return NaN;
        var x = parseFloat(s);
        return isFinite(x) ? x : NaN;
    }

    // Подбор подходящих типов резки.
    // index: { typeId: { materialId, widths:[Number,...] } } — widths может отсутствовать
    //   (полосы типа ещё не загружены).
    // Возвращает массив id: фильтр по сырью, при заданной ширине — точное совпадение
    //   с одной из ширин полос (типы без загруженных полос при заданной ширине отсеиваются).
    function matchCutTypes(index, materialId, width) {
        var ids = Object.keys(index || {});
        var mat = materialId == null ? '' : String(materialId);
        if (mat !== '') {
            ids = ids.filter(function(id) { return String(index[id].materialId) === mat; });
        }
        var w = parseWidth(width);
        if (!isNaN(w)) {
            ids = ids.filter(function(id) {
                var ws = index[id].widths;
                if (!ws) return false;
                return ws.some(function(x) { return Number(x) === w; });
            });
        }
        return ids;
    }
```
Добавить обе функции в объект `window.AtexOrdersTesting = { ... }`:
```javascript
        parseWidth: parseWidth,
        matchCutTypes: matchCutTypes,
```

- [ ] **Step 4: Запустить → PASS**

Run: `node experiments/test-issue-52C-cuttype-suggest.js`
Expected: `7 assertions passed`, exit 0.

- [ ] **Step 5: Регрессия orders + commit**

Run: `node experiments/test-issue-2911-atex-orders.js` (expect PASS — мы только добавили экспорт).
Commit:
```bash
git add download/atex/js/orders.js && git add -f experiments/test-issue-52C-cuttype-suggest.js
git commit -m "feat(#52): orders — ядро matchCutTypes (фильтр типов по сырью и ширине)"
```

---

## Task 2: Загрузка индекса типов резки + ленивые ширины полос

**Files:**
- Modify: `download/atex/js/orders.js`

Цель: построить `state.cutTypeIndex = { typeId: { materialId, widths? } }`. Типы — один запрос на старте; ширины полос — лениво по сырью, с кэшем.

- [ ] **Step 1: Прочитать точки интеграции**

Прочитать в `orders.js`: блок предзагрузки справочников в `init` (там `Promise.all([... loadRefOptions ...])`, ~строки 1150–1162), хелперы `getColumn`, `parseRef`, `colIndex`/аналог чтения JSON_OBJ, и структуру `state`. Подтвердить имена перед правкой.

- [ ] **Step 2: Добавить состояние и загрузку индекса типов**

В инициализацию `state` (там, где заводятся `state.refOptions` и пр.) добавить:
```javascript
        state.cutTypeIndex = {};        // { typeId: { materialId, widths? } }
        state.stripsLoadedMaterials = {}; // { materialId: true } — для каких сырьёв полосы уже грузили
```
Добавить функцию (рядом с `loadRefOptions`):
```javascript
    // Индекс типов резки: { id: { materialId } }. Один запрос; ширины полос грузим лениво.
    function loadCutTypeIndex() {
        var meta = findMetadataByName(state.metadata, 'Тип резки');
        if (!meta) return Promise.resolve();
        var matName = 'Вид сырья';
        var order = [String(meta.id)].concat((meta.reqs || []).map(function(r){ return String(r.id); }));
        var matReq = (meta.reqs || []).filter(function(r){ return String(r.val).trim().toLowerCase() === matName.toLowerCase(); })[0];
        var matIdx = matReq ? order.indexOf(String(matReq.id)) : -1;
        return getJson('object/' + meta.id + '/?JSON_OBJ&LIMIT=0,5000').then(function(rows){
            (rows || []).forEach(function(rec){
                var r = rec.r || [];
                var mat = matIdx >= 0 ? parseRef(r[matIdx]) : { id: null };
                state.cutTypeIndex[String(rec.i)] = { materialId: mat.id ? String(mat.id) : '' };
            });
        });
    }
```
> Использовать тот же способ чтения JSON_OBJ, что и в файле (порядок колонок = [главное, ...reqs]; `getJson` — существующий хелпер чтения; `findMetadataByName`, `parseRef` уже есть и экспортированы в AtexOrdersTesting). Если имена хелперов/способ чтения отличаются — адаптировать к фактическому коду.

Вызвать `loadCutTypeIndex()` в цепочке `init` рядом с предзагрузкой справочников (добавить в существующий `Promise.all([...])` ещё один элемент `loadCutTypeIndex()`).

- [ ] **Step 3: Ленивая загрузка ширин полос по сырью**

Добавить функцию:
```javascript
    // Грузит ширины полос для всех типов указанного сырья (один раз на сырьё).
    // Заполняет index[typeId].widths. Возвращает Promise.
    function ensureStripWidths(materialId) {
        var mat = materialId == null ? '' : String(materialId);
        if (mat === '' || state.stripsLoadedMaterials[mat]) return Promise.resolve();
        var stripMeta = findMetadataByName(state.metadata, 'Полоса');
        if (!stripMeta) return Promise.resolve();
        var sOrder = [String(stripMeta.id)].concat((stripMeta.reqs || []).map(function(r){ return String(r.id); }));
        var wReq = (stripMeta.reqs || []).filter(function(r){ return String(r.val).trim().toLowerCase() === 'ширина, мм'; })[0];
        var wIdx = wReq ? sOrder.indexOf(String(wReq.id)) : -1;
        var typeIds = Object.keys(state.cutTypeIndex).filter(function(id){ return String(state.cutTypeIndex[id].materialId) === mat; });
        return Promise.all(typeIds.map(function(id){
            return getJson('object/' + stripMeta.id + '/?JSON_OBJ&F_U=' + encodeURIComponent(id) + '&LIMIT=0,1000').then(function(rows){
                var widths = (rows || []).map(function(rec){ var r = rec.r || []; return wIdx >= 0 ? parseWidth(r[wIdx]) : NaN; })
                    .filter(function(x){ return !isNaN(x); });
                state.cutTypeIndex[id].widths = widths;
            });
        })).then(function(){ state.stripsLoadedMaterials[mat] = true; });
    }
```

- [ ] **Step 4: Прогон тестов + commit**

Run: `node experiments/test-issue-52C-cuttype-suggest.js` (PASS) и `node experiments/test-issue-2911-atex-orders.js` (PASS — sandbox не вызывает fetch; новые функции не ломают экспорт).
Также `node -e "..."`-проверка загрузки не нужна (orders.js требует window). Достаточно vm-тестов.
Commit:
```bash
git add download/atex/js/orders.js
git commit -m "feat(#52): orders — индекс типов резки и ленивая загрузка ширин полос по сырью"
```

---

## Task 3: DOM — фильтрация select «Тип резки» и сброс несовместимого выбора

**Files:**
- Modify: `download/atex/js/orders.js`

Цель: при рендере формы позиции и при изменении «Вид сырья»/«Ширина, мм» пересобирать `<option>` списка «Тип резки» из `matchCutTypes`, сбрасывая несовместимое значение.

- [ ] **Step 1: Прочитать DOM-код формы позиции**

Прочитать в `orders.js`: `renderPositionForm` (~577), `refSelectHtml`, как читается значение позиции (`collectPosition`/`#atex-pos-cut-…`, ~728), делегирование событий на `state.root` (`input` ~932, list-level `change` ~1073), и есть ли поиск по ссылке (ref-search.js) на этом select. Подтвердить точные id элементов: `atex-pos-raw-<orderId>`, `atex-pos-cut-<orderId>`, `data-field="width"`.

- [ ] **Step 2: Функция перерисовки опций «Тип резки»**

Добавить функцию, которая по форме позиции пересобирает опции select «Тип резки» из индекса:
```javascript
    // Пересобирает <option> списка «Тип резки» формы позиции по текущему сырью/ширине.
    // Сбрасывает выбранное значение, если оно не входит в подходящие. orderId — id заказа.
    function refreshCutTypeOptions(orderId, form) {
        if (!form) return;
        var cutCol = getColumn(state.positionColumns, 'cutType');
        var cutSel = form.querySelector('#atex-pos-cut-' + cssEscape(orderId));
        var rawSel = form.querySelector('#atex-pos-raw-' + cssEscape(orderId));
        var widthInput = form.querySelector('[data-field="width"]');
        if (!cutSel) return;
        var materialId = rawSel ? rawSel.value : '';
        var width = widthInput ? widthInput.value : '';
        var allowed = matchCutTypes(state.cutTypeIndex, materialId, width);
        var allowedSet = {}; allowed.forEach(function(id){ allowedSet[String(id)] = true; });
        // Опции с подписями берём из refOptions выбранного реквизита (id+label).
        var refList = (cutCol && cutCol.reqId && state.refOptions[cutCol.reqId]) || [];
        var prev = cutSel.value;
        var html = '<option value="">Выберите тип резки</option>';
        refList.forEach(function(opt){
            if (allowedSet[String(opt.id)]) {
                html += '<option value="' + escapeHtml(opt.id) + '">' + escapeHtml(opt.label) + '</option>';
            }
        });
        cutSel.innerHTML = html;
        // Сброс несовместимого выбора.
        cutSel.value = allowedSet[String(prev)] ? prev : '';
    }
```
> Если на select «Тип резки» навешен searchable-ref (ref-search.js), перерисовка `innerHTML` должна с ним уживаться — проверить при чтении кода; при необходимости вызвать соответствующий ре-init/refresh хелпер ref-search вместо прямой замены innerHTML. Если select — обычный `<select>` (как в `renderPositionForm`), прямой `innerHTML` корректен.

- [ ] **Step 3: Привязать перерисовку к изменениям сырья и ширины**

В делегированных обработчиках на `state.root` добавить реакцию:
- на `change` элемента с id `atex-pos-raw-<orderId>` (смена сырья): сначала `ensureStripWidths(rawSel.value).then(function(){ refreshCutTypeOptions(orderId, form); })`;
- на `input`/`change` элемента `data-field="width"` в форме позиции: `refreshCutTypeOptions(orderId, form)` (полосы уже загружены при выборе сырья).
Определять `orderId` и `form` из ближайшей `[data-position-form]` (как делает существующий код сбора позиции). Встроить в существующие слушатели (`state.root` `change`/`input`), не плодя новых глобальных слушателей. Прочитать, как сейчас определяется `form`/`orderId` в обработчиках, и повторить тот же способ.

- [ ] **Step 4: Первичная фильтрация при открытии формы позиции**

После того как форма позиции показана и (если у позиции уже выбрано сырьё) — вызвать `ensureStripWidths(currentMaterial).then(function(){ refreshCutTypeOptions(orderId, form); })`, чтобы при открытии список сразу отфильтрован. Найти место, где форма позиции делается видимой/инициализируется, и добавить вызов.

- [ ] **Step 5: Ручная проверка (DOM не тестируется в node)**

Поскольку DOM-слой `orders.js` не покрывается node-тестами (требует браузера), выполнить проверку в фикстуре/браузере:
- открыть форму позиции, выбрать сырьё → список «Тип резки» содержит только типы этого сырья;
- ввести ширину, совпадающую с полосой типа → остаётся только совпавший тип; несовпадающая ширина → список пуст и прежний выбор сброшен;
- сменить сырьё → список перезагружается, несовместимый выбор сброшен.
Зафиксировать, что проверено (фикстура `experiments/atex-orders-harness.html` или ручной прогон на dev). Прогнать `node experiments/test-issue-2911-atex-orders.js` и `node experiments/test-issue-52C-cuttype-suggest.js` — оба PASS (регрессия ядра).

- [ ] **Step 6: Commit**
```bash
git add download/atex/js/orders.js
git commit -m "feat(#52): orders — фильтр select «Тип резки» по сырью/ширине + сброс несовместимого"
```

---

## Task 4: Документация РМ

**Files:**
- Modify: `docs/atex_workplaces.md`

- [ ] **Step 1: Описать поведение фильтра**
В разделе «Заказы»/«Приём заказов» `docs/atex_workplaces.md` кратко и фактически (стиль repo: констатировать, без «раньше было»): «Тип резки» в форме позиции ограничен типами выбранного «Вид сырья» с точным совпадением «Ширина, мм» с шириной полос типа (`Полоса.Ширина, мм`); несовместимый выбор сбрасывается; ширины полос грузятся лениво по сырью.

- [ ] **Step 2: Полный прогон node-тестов orders + commit**
Run:
```bash
node experiments/test-issue-52C-cuttype-suggest.js
node experiments/test-issue-2911-atex-orders.js
node experiments/test-issue-3041-atex-orders-search.js
```
Expected: все PASS.
Commit:
```bash
git add docs/atex_workplaces.md
git commit -m "docs(#52): orders — описание фильтра «Тип резки» по сырью и ширине"
```

---

## Деплой (вне автоматизации — Андрей)
Только клиентский код РМ `download/atex/js/orders.js` → деплой atex→ateh через `update.php`. Схема БД не меняется. Проверить на dev: фильтрация и сброс на форме позиции.

## Self-review заметки
- Покрытие спеки: правило матча (сырьё + точная ширина, частичные поля, многополосный тип) — Task 1; загрузка (типы один раз, полосы лениво по сырью с кэшем, ограничение F_U) — Task 2; жёсткий фильтр select + сброс несовместимого — Task 3; докумен­тация — Task 4.
- Имена согласованы: `matchCutTypes`/`parseWidth` (ядро, экспорт в AtexOrdersTesting); `state.cutTypeIndex`/`state.stripsLoadedMaterials`; `loadCutTypeIndex`/`ensureStripWidths`/`refreshCutTypeOptions`.
- DOM-слой orders.js не тестируется в node (требует браузера) — Task 3 проверяется фикстурой/вручную; ядро и его регрессия — node-тестами. Это явно отмечено, не скрыто.
- Риск интеграции в большой orders.js: каждая DOM-задача начинается с чтения фактического кода и адаптации; при неоднозначности — NEEDS_CONTEXT.
