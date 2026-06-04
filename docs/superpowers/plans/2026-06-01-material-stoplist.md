# Стоп-лист сырья у станка — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** У станка («Слиттер») задаётся стоп-лист видов сырья; при планировании резка с запрещённым сырьём на этом станке не создаётся.

**Architecture:** Поле-мультиссылка «Стоп-лист сырья» на «Слиттер» → «Вид сырья» (редактируется штатным IntegramTable). В `production-planning.js` (ES5 UMD, ядро в `planning`) — чистые функции разбора мультиссылки и проверки членства + контроль в `createCut`. Слиттеры грузятся со стоп-листом, партии — с видом сырья, чтобы сопоставить материал резки и стоп-лист станка.

**Tech Stack:** ванильный ES5, Integram REST (`object/`, `_m_new`), кастомный test-harness в `experiments/`.

**Спека:** `docs/superpowers/specs/2026-06-01-material-stoplist-design.md`. Эпик ideav/atex#52, подзадача E.

---

## Структура файлов

| Файл | Ответственность | Действие |
|---|---|---|
| `docs/atex_metadata.json` | +реквизит «Стоп-лист сырья» (мультиссылка→100) у «Слиттер» (101) | Modify |
| `download/atex/js/production-planning.js` | ядро (parse+проверка) + загрузка стоп-листа/материала + контроль в createCut | Modify |
| `experiments/atex-production-planning.test.js` | тесты новых чистых функций | Modify |
| `docs/atex_workplaces.md` | описание контроля стоп-листа | Modify |

Реквизиты резолвятся по имени; точные id на live назначит Андрей. На live поле создаёт Андрей (мультиссылка на «Вид сырья»), Фольгу в станки 2/3 заносит данными.

---

## Task 1: Схема — реквизит «Стоп-лист сырья» у «Слиттер»

**Files:** Modify `docs/atex_metadata.json`

- [ ] **Step 1: Добавить реквизит в таблицу 101**

В объекте `"id": "101"` («Слиттер»), в массив `"reqs"` добавить реквизит-мультиссылку на «Вид сырья» (100). СНАЧАЛА прочитать существующий ref-реквизит в файле (напр. у «Производственная резка» реквизит «Слиттер» type=3 ref=101) и СКОПИРОВАТЬ его форму ключей (`num`, `id`, `val`, `type`, `ref`, `ref_id` и т.п.), подставив:
- `val`: `Стоп-лист сырья`
- `type`: `3` (ссылка), `ref`: `100` (справочник «Вид сырья»)
- добавить маркер множественности так же, как он представлен в файле для мультиссылок, если такие есть; если нет — добавить `"multi": "1"` (информационно; на live множественность настраивает Андрей).
- `id`: следующий свободный числовой id в файле; `num`: следующий по порядку в таблице 101; `ref_id`: новый свободный id (как у других ref-реквизитов).

- [ ] **Step 2: Проверить JSON + имя**

```bash
python3 -c "import json; d=json.load(open('docs/atex_metadata.json')); m={t['id']:[r['val'] for r in t.get('reqs',[])] for t in d if isinstance(t,dict)}; print('Стоп-лист сырья' in m['101'])"
```
Expected: `True`. JSON валиден.

- [ ] **Step 3: Commit**
```bash
git add docs/atex_metadata.json
git commit -m "feat(#52): схема — Слиттер += «Стоп-лист сырья» (мультиссылка → Вид сырья)"
```

---

## Task 2: Чистое ядро — разбор мультиссылки + проверка (TDD)

**Files:** Modify `download/atex/js/production-planning.js`, `experiments/atex-production-planning.test.js`

- [ ] **Step 1: Написать падающие тесты**

В `experiments/atex-production-planning.test.js` (harness: `var planning = require('...').planning;` + assertEqual-стиль файла) добавить блок:
```javascript
// ── parseMultiRefIds: разбор значения мультиссылки "id1,id2:знач1,знач2" ──
assertEqual(planning.parseMultiRefIds('1,2:Фольга,Бумага'), ['1','2'], 'parseMultiRefIds: пара id');
assertEqual(planning.parseMultiRefIds('5:Фольга'), ['5'], 'parseMultiRefIds: одиночное');
assertEqual(planning.parseMultiRefIds(''), [], 'parseMultiRefIds: пусто → []');
assertEqual(planning.parseMultiRefIds(null), [], 'parseMultiRefIds: null → []');
assertEqual(planning.parseMultiRefIds(' 1 , 2 :a,b'), ['1','2'], 'parseMultiRefIds: терпимость к пробелам');
assertEqual(planning.parseMultiRefIds('7,8'), ['7','8'], 'parseMultiRefIds: без двоеточия — по запятой');

// ── isMaterialBlocked: материал в стоп-листе станка ──
assertEqual(planning.isMaterialBlocked(['1','2'], '2'), true, 'isMaterialBlocked: в списке');
assertEqual(planning.isMaterialBlocked(['1','2'], 3), false, 'isMaterialBlocked: не в списке (число)');
assertEqual(planning.isMaterialBlocked(['1','2'], 1), true, 'isMaterialBlocked: число совпадает со строкой');
assertEqual(planning.isMaterialBlocked([], '1'), false, 'isMaterialBlocked: пустой список → false');
assertEqual(planning.isMaterialBlocked(['1'], ''), false, 'isMaterialBlocked: пустой материал → false');
```
> Используй фактический `assertEqual` файла (он сравнивает через JSON.stringify — проверь сигнатуру в начале файла и вызывай так же).

- [ ] **Step 2: Запустить → FAIL**

Run: `node experiments/atex-production-planning.test.js` → FAIL (функций нет).

- [ ] **Step 3: Реализовать функции в ядре**

В `production-planning.js`, рядом с другими чистыми хелперами (возле `parseRef`), добавить:
```javascript
    // Разбор значения мультиссылки JSON_OBJ "id1,id2:знач1,знач2" → ['id1','id2'].
    // Без двоеточия — вся строка как список id через запятую. Пусто → [].
    function parseMultiRefIds(raw) {
        var s = String(raw == null ? '' : raw);
        if (s.trim() === '') return [];
        var idsPart = s.indexOf(':') >= 0 ? s.slice(0, s.indexOf(':')) : s;
        return idsPart.split(',')
            .map(function(x) { return x.trim(); })
            .filter(function(x) { return x !== ''; });
    }

    // Материал в стоп-листе станка? Сравнение по строковому id. Пустой список/материал → false.
    function isMaterialBlocked(stopMaterialIds, materialId) {
        var mid = String(materialId == null ? '' : materialId).trim();
        if (mid === '') return false;
        return (stopMaterialIds || []).some(function(id) { return String(id).trim() === mid; });
    }
```
Добавить в объект `var planning = { ... }`: `parseMultiRefIds`, `isMaterialBlocked`.

- [ ] **Step 4: Запустить → PASS**

Run: `node experiments/atex-production-planning.test.js` → все PASS (включая существующие).

- [ ] **Step 5: Commit**
```bash
git add download/atex/js/production-planning.js && git add -f experiments/atex-production-planning.test.js
git commit -m "feat(#52): production-planning — ядро parseMultiRefIds + isMaterialBlocked"
```

---

## Task 3: Загрузка стоп-листа станков и сырья партий

**Files:** Modify `download/atex/js/production-planning.js`

- [ ] **Step 1: Прочитать точки загрузки**

Прочитать `loadRef`, конструктор (`this.slitters`, `this.materialBatches`), и место начальной загрузки (где `loadRef(self.meta.slitter)` и `loadRef(self.meta.materialBatch)` наполняют `this.slitters`/`this.materialBatches`, ~строки 680–695). Подтвердить `columnIndex(meta, reqName)` и `TABLE`/`CUT_REQ` имена.

- [ ] **Step 2: Расширенные загрузчики**

Добавить методы (рядом с `loadRef`):
```javascript
    // Слиттеры со стоп-листом сырья: [{ id, label, stopMaterialIds:[…] }].
    AtexProductionPlanning.prototype.loadSlittersWithStop = function() {
        var meta = this.meta.slitter;
        if (!meta) return Promise.resolve([]);
        var stopIdx = columnIndex(meta, 'Стоп-лист сырья');
        return this.getJson('object/' + meta.id + '/?JSON_OBJ&LIMIT=0,1000').then(function(rows) {
            return (rows || []).map(function(r) {
                var raw = (stopIdx >= 0 && r.r) ? r.r[stopIdx] : '';
                return { id: String(r.i), label: (r.r && r.r[0]) || ('#' + r.i),
                         stopMaterialIds: planning.parseMultiRefIds(raw) };
            });
        });
    };

    // Партии сырья с видом сырья: [{ id, label, materialId }].
    AtexProductionPlanning.prototype.loadBatchesWithMaterial = function() {
        var meta = this.meta.materialBatch;
        if (!meta) return Promise.resolve([]);
        var matIdx = columnIndex(meta, 'Вид сырья');
        return this.getJson('object/' + meta.id + '/?JSON_OBJ&LIMIT=0,1000').then(function(rows) {
            return (rows || []).map(function(r) {
                var matRef = (matIdx >= 0 && r.r) ? parseRef(r.r[matIdx]) : { id: null };
                return { id: String(r.i), label: (r.r && r.r[0]) || ('#' + r.i),
                         materialId: matRef.id ? String(matRef.id) : '' };
            });
        });
    };
```
> `planning.parseMultiRefIds`/`parseRef`/`columnIndex` доступны в модуле. Имя реквизита партии — «Вид сырья» (подтвердить в metadata: «Партия сырья» имеет «Вид сырья»).

- [ ] **Step 3: Заменить загрузку слиттеров/партий на расширенную**

В месте начальной загрузки, где сейчас `self.loadRef(self.meta.slitter).then(... self.slitters = ...)` и аналогично для `materialBatch`, заменить на `self.loadSlittersWithStop()` и `self.loadBatchesWithMaterial()` соответственно, сохранив присваивание `self.slitters = items` / `self.materialBatches = items`. (Объекты теперь несут доп. поля; существующее использование `{id,label}` не ломается.)

- [ ] **Step 4: Прогон тестов + commit**

Run: `node experiments/atex-production-planning.test.js` (PASS — ядро не задето) и `node -e "require('./download/atex/js/production-planning.js'); console.log('loads ok')"` (если модуль грузится в node; production-planning — UMD, DOM под guard).
Commit:
```bash
git add download/atex/js/production-planning.js
git commit -m "feat(#52): production-planning — грузить стоп-лист станков и вид сырья партий"
```

---

## Task 4: Контроль в createCut — блокировать запрещённое сырьё

**Files:** Modify `download/atex/js/production-planning.js`

- [ ] **Step 1: Вставить проверку в createCut**

В `AtexProductionPlanning.prototype.createCut`, ПОСЛЕ существующих проверок (`if (!d.slitterId)…`, `if (!d.cutTypeId)…`) и ДО сборки/POST полей, добавить блокировку:
```javascript
        // Стоп-лист станка: сырьё выбранной партии не должно быть запрещено на станке.
        if (d.materialBatchId) {
            var batch = this.materialBatches.filter(function(b){ return String(b.id) === String(d.materialBatchId); })[0];
            var slit = this.slitters.filter(function(s){ return String(s.id) === String(d.slitterId); })[0];
            var matId = batch && batch.materialId;
            var stop = (slit && slit.stopMaterialIds) || [];
            if (matId && planning.isMaterialBlocked(stop, matId)) {
                this.notify('Сырьё «' + (batch.label || matId) + '» запрещено на станке «' + (slit && slit.label || d.slitterId) + '»', 'error');
                return;
            }
        }
```
> `this.materialBatches`/`this.slitters` теперь несут `materialId`/`stopMaterialIds` (Task 3). `planning` доступен в модуле.

- [ ] **Step 2: Ручная проверка + commit**

DOM/сеть в node не тестируются; ядро-тесты PASS. Прочитать `createCut` после правки — убедиться, что блокировка стоит до POST и не ломает разрешённый путь.
Commit:
```bash
git add download/atex/js/production-planning.js
git commit -m "feat(#52): production-planning — блокировать резку с запрещённым на станке сырьём"
```

---

## Task 5: Документация + полный прогон

**Files:** Modify `docs/atex_workplaces.md`

- [ ] **Step 1: Описание контроля**

В разделе «Планирование производства» `docs/atex_workplaces.md` добавить факт: у «Слиттера» поле «Стоп-лист сырья» (мультиссылка → Вид сырья), при создании резки сырьё партии проверяется против стоп-листа выбранного станка — запрещённое блокируется (`planning.isMaterialBlocked`, `production-planning.js`); стоп-лист редактируется штатным табличным редактором. Стиль repo, факты.

- [ ] **Step 2: Полный прогон тестов atex**
```bash
node experiments/atex-production-planning.test.js
node experiments/atex-cut-calc.test.js
node experiments/test-issue-2911-atex-orders.js
```
Expected: все PASS.

- [ ] **Step 3: Commit**
```bash
git add docs/atex_workplaces.md
git commit -m "docs(#52): production-planning — стоп-лист сырья у станка"
```

---

## Деплой (вне автоматизации — Андрей)
- Клиентский `production-planning.js` → atex→ateh через `update.php`.
- Схема: поле «Стоп-лист сырья» (мультиссылка на «Вид сырья») на «Слиттер» создаёт Андрей на live; Фольгу в стоп-лист станков 2/3 заносит данными.

## Self-review заметки
- Покрытие спеки: поле (схема) — Task 1; ядро parse+проверка — Task 2; загрузка стоп-листа/материала — Task 3; блокировка в createCut — Task 4; доки — Task 5.
- Имена согласованы: `parseMultiRefIds`/`isMaterialBlocked` (ядро `planning`); `loadSlittersWithStop`/`loadBatchesWithMaterial`; поля `stopMaterialIds`/`materialId`; реквизит «Стоп-лист сырья».
- DOM/сеть (Task 3-4) не тестируются в node — проверяются чтением; ядро и регрессия — node-тестами.
- Код устойчив к точной кодировке мультиссылки в metadata: резолв по имени + разбор значения `"id:знач"` из JSON_OBJ.
