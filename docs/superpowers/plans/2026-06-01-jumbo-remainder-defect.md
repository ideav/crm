# Остаток метража Jumbo Roll + брак в метрах с фото — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Вести физический остаток рулона Jumbo Roll в метрах (авто из погонажа) и дать оператору ввод брака в метрах с фото.

**Architecture:** Расширяем два существующих рабочих места atex — «Приёмка сырья» (`intake.js`) и «Пульт слиттера» (`slitter.js`). Чистая логика (числовые расчёты) выносится в экспортируемые объекты `calc`/`core` и покрывается модульными тестами в `experiments/` (запуск `node experiments/atex-*.test.js`), как уже принято в проекте. DOM-слой меняется точечно и проверяется фикстурой/вручную. Поля резолвятся по именам из live-метаданных (`reqIdByName`), числовые id не хардкодятся.

**Tech Stack:** ванильный ES5-совместимый JS (паттерн рабочих мест atex), Integram REST (`_m_new`/`_m_set`, multipart для FILE по образцу платформы #1310), кастомный test-harness в `experiments/`.

**Спецификация:** `docs/superpowers/specs/2026-06-01-jumbo-remainder-defect-design.md`

---

## Структура файлов

| Файл | Ответственность | Действие |
|---|---|---|
| `docs/atex_metadata.json` | Справочник схемы atex (документация, синхрон с live) | Modify: +2 реквизита в т.106, +2 в т.110 |
| `download/atex/js/intake.js` | РМ «Приёмка сырья»: длина джамбо + остаток,м | Modify |
| `download/atex/js/slitter.js` | РМ «Пульт слиттера»: списание остатка,м; брак,м; фото | Modify |
| `experiments/atex-intake.test.js` | Тесты ядра приёмки | Modify (+ тесты длины) |
| `experiments/atex-slitter.test.js` | Тесты ядра слиттера | Modify (+ defectM2, delta) |
| `docs/atex_workplaces.md` | Описание РМ (критерии приёмки) | Modify (фиксация новых полей) |

**Имена новых реквизитов (точно — для создания в live БД и в `docs/atex_metadata.json`):**
- Таблица `Партия сырья` (106): `Длина, м` (число), `Остаток, м` (число)
- Таблица `Производственная резка` (110): `Брак, м` (число), `Фото брака` (FILE, type 10)

---

## Task 1: Схема — новые реквизиты в метаданных

**Files:**
- Modify: `docs/atex_metadata.json`

Метаданные в репозитории — документация схемы (рабочие места читают live-метаданные по именам). Добавляем новые реквизиты, чтобы doc был синхронен с тем, что Андрей заведёт в live, и чтобы имена совпадали с теми, что использует код.

- [ ] **Step 1: Добавить реквизиты «Длина, м» и «Остаток, м» в таблицу 106**

В объекте с `"id": "106"` (`"val": "Партия сырья"`), в массив `"reqs"` добавить два элемента после существующего «Остаток, м²» (id 1050). Использовать новые незанятые id (проверить максимальный id в файле и взять следующие свободные; в примере — `1052`, `1054`):

```json
      {
        "num": 5,
        "id": "1052",
        "val": "Длина, м",
        "orig": "106",
        "type": "14"
      },
      {
        "num": 6,
        "id": "1054",
        "val": "Остаток, м",
        "orig": "106",
        "type": "14"
      }
```

- [ ] **Step 2: Добавить реквизиты «Брак, м» и «Фото брака» в таблицу 110**

В объекте `"id": "110"` (`"val": "Производственная резка"`), в `"reqs"` добавить после «Брак, м²» (id 1106). Тип FILE = `"10"`:

```json
      {
        "num": 13,
        "id": "1116",
        "val": "Брак, м",
        "orig": "110",
        "type": "14"
      },
      {
        "num": 14,
        "id": "1118",
        "val": "Фото брака",
        "orig": "110",
        "type": "10"
      }
```

> `num` — порядковый: подставить следующий после последнего существующего в таблице. id — следующие свободные в файле.

- [ ] **Step 3: Проверить, что JSON валиден**

Run: `python3 -c "import json; json.load(open('docs/atex_metadata.json')); print('OK')"`
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add docs/atex_metadata.json
git commit -m "feat(#52): схема — Партия сырья +Длина/Остаток,м; Резка +Брак,м/Фото брака"
```

---

## Task 2: intake.js — длина джамбо при приёмке + остаток,м

**Files:**
- Modify: `download/atex/js/intake.js`
- Test: `experiments/atex-intake.test.js`

Цель: при оприходовании партии (= одного джамбо) задаётся «Длина, м» с дефолтом из `Вид сырья.Длина рулона, м`; «Остаток, м» инициализируется значением длины.

- [ ] **Step 1: Написать падающий тест дефолта длины из вида сырья**

В `experiments/atex-intake.test.js`, после блока тестов `initialRemainder`, добавить:

```javascript
// ── materialDefaultLength: длина джамбо по умолчанию из вида сырья ──
var materials = [
    { id: '1', label: 'MR194', rollLength: '4000' },
    { id: '2', label: 'MWR110L', rollLength: '' }
];
assertEqual(calc.materialDefaultLength(materials, '1'), 4000, 'default length from material roll length');
assertEqual(calc.materialDefaultLength(materials, '2'), 0, 'empty roll length → 0');
assertEqual(calc.materialDefaultLength(materials, '999'), 0, 'unknown material → 0');
assertEqual(calc.materialDefaultLength(materials, null), 0, 'null material → 0');
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `node experiments/atex-intake.test.js`
Expected: FAIL — `calc.materialDefaultLength is not a function` (или строка FAIL по новым кейсам).

- [ ] **Step 3: Реализовать `materialDefaultLength` в ядре `calc`**

В `download/atex/js/intake.js` добавить функцию рядом с `initialRemainder` (после неё) и экспортировать в объекте `calc`:

```javascript
    // Длина джамбо по умолчанию: «Длина рулона, м» выбранного вида сырья.
    // materials: [{ id, label, rollLength }]. Нет данных → 0.
    function materialDefaultLength(materials, materialId) {
        if (materialId == null) return 0;
        var m = (materials || []).filter(function(x) {
            return String(x.id) === String(materialId);
        })[0];
        return m ? round3(toNumber(m.rollLength)) : 0;
    }
```

В объект `var calc = { ... }` добавить строку:

```javascript
        materialDefaultLength: materialDefaultLength,
```

- [ ] **Step 4: Запустить тест — убедиться, что проходит**

Run: `node experiments/atex-intake.test.js`
Expected: PASS (все строки PASS, exit code 0).

- [ ] **Step 5: Расширить `BATCH_REQ` и загрузку видов сырья длиной рулона**

В `intake.js` в `var BATCH_REQ = {...}` добавить ключи:

```javascript
        lengthM: 'Длина, м',
        remainderM: 'Остаток, м'
```

В `AtexIntake.prototype.loadMaterials` заменить тело `map`, чтобы тащить «Длина рулона, м». Метаданные вида сырья уже в `this.meta.material`. Текущий код:

```javascript
            self.materials = (rows || []).map(function(r) {
                return { id: String(r.i), label: (r.r && r.r[0]) || ('#' + r.i) };
            });
```

заменить на:

```javascript
            var lenIdx = self.colIndex(self.meta.material, 'Длина рулона, м');
            self.materials = (rows || []).map(function(r) {
                var row = r.r || [];
                return {
                    id: String(r.i),
                    label: row[0] || ('#' + r.i),
                    rollLength: lenIdx >= 0 ? (row[lenIdx] || '') : ''
                };
            });
```

- [ ] **Step 6: Подгружать «Длина, м»/«Остаток, м» при чтении партий**

В `AtexIntake.prototype.loadBatches`, рядом с `var iRem = this.colIndex(meta, BATCH_REQ.remainder);` добавить:

```javascript
        var iLen = this.colIndex(meta, BATCH_REQ.lengthM);
        var iRemM = this.colIndex(meta, BATCH_REQ.remainderM);
```

и в объект, который возвращает `map` (где есть `remainder: ...`), добавить поля:

```javascript
                    lengthM: iLen >= 0 ? (r[iLen] || '') : '',
                    remainderM: iRemM >= 0 ? (r[iRemM] || '') : ''
```

(в `loadBatches` строка читает `var r = rec.r || [];` — индексы применять к `r`).

- [ ] **Step 7: Добавить поля формы «Длина, м» и «Остаток, м»**

В `AtexIntake.prototype.renderForm` (где строится форма), сразу после блока «Получено, м²» и до «Остаток, м²», вставить поля длины/остатка-в-метрах. При смене вида сырья дефолт длины подставляется из материала. Вставить:

```javascript
        // Длина, м — метраж джамбо. Дефолт из «Длина рулона, м» вида сырья.
        var lenInput = el('input', { class: 'atex-in-input', type: 'number', min: '0', step: 'any', placeholder: '0' });
        lenInput.value = c.lengthM == null ? '' : c.lengthM;
        lenInput.addEventListener('input', function() {
            c.lengthM = lenInput.value;
            if (!self.remainderMTouched) {
                c.remainderM = lenInput.value;
                if (self.remainderMInput) self.remainderMInput.value = lenInput.value;
            }
        });
        this.lengthInput = lenInput;
        form.appendChild(field('Длина, м', lenInput, 'Метраж рулона Jumbo Roll'));

        // Остаток, м — по умолчанию = длине; правка фиксирует ручной режим.
        var remMInput = el('input', { class: 'atex-in-input', type: 'number', min: '0', step: 'any', placeholder: '0' });
        remMInput.value = c.remainderM == null ? '' : c.remainderM;
        remMInput.addEventListener('input', function() {
            c.remainderM = remMInput.value;
            self.remainderMTouched = true;
        });
        this.remainderMInput = remMInput;
        form.appendChild(field('Остаток, м', remMInput, 'Инициализируется значением «Длина, м»'));
```

В обработчик `materialRef` `onChange` (поле «Вид сырья») добавить подстановку дефолта длины при выборе сырья. Текущий `onChange`:

```javascript
            onChange: function(value) { c.materialId = value || null; }
```

заменить на:

```javascript
            onChange: function(value) {
                c.materialId = value || null;
                if (!self.remainderMTouched && (c.lengthM === '' || c.lengthM == null)) {
                    var def = calc.materialDefaultLength(self.materials, c.materialId);
                    if (def > 0) {
                        c.lengthM = String(def);
                        c.remainderM = String(def);
                        if (self.lengthInput) self.lengthInput.value = c.lengthM;
                        if (self.remainderMInput) self.remainderMInput.value = c.remainderM;
                    }
                }
            }
```

- [ ] **Step 8: Сбрасывать флаг ручной правки остатка-в-метрах для новой партии**

В `AtexIntake.prototype.newBatch` (где создаётся `this.current` и сбрасывается `this.remainderTouched`) добавить:

```javascript
        this.remainderMTouched = false;
```

И в конструкторе `AtexIntake`, рядом с `this.remainderTouched = false;`, добавить `this.remainderMTouched = false;`.

- [ ] **Step 9: Писать «Длина, м» и «Остаток, м» при сохранении**

В `AtexIntake.prototype.save`, после строки про `BATCH_REQ.remainder`, добавить запись новых полей. После:

```javascript
        fields['t' + reqIdByName(meta, BATCH_REQ.remainder)] = remainder;
```

вставить:

```javascript
        var lengthM = round3(toNumber(c.lengthM));
        var remainderM = (c.remainderM === '' || c.remainderM == null)
            ? lengthM
            : round3(toNumber(c.remainderM));
        var lenReqId = reqIdByName(meta, BATCH_REQ.lengthM);
        var remMReqId = reqIdByName(meta, BATCH_REQ.remainderM);
        if (lenReqId) fields['t' + lenReqId] = lengthM;
        if (remMReqId) fields['t' + remMReqId] = remainderM;
```

(`reqIdByName` для отсутствующего реквизита вернёт null — поле просто не пишется, что безопасно, если на live реквизит ещё не создан.)

- [ ] **Step 10: Прогнать тесты ядра приёмки**

Run: `node experiments/atex-intake.test.js`
Expected: PASS, exit code 0.

- [ ] **Step 11: Commit**

```bash
git add download/atex/js/intake.js experiments/atex-intake.test.js
git commit -m "feat(#52): приёмка — Длина,м (дефолт из вида сырья) и Остаток,м"
```

---

## Task 3: slitter.js — списание остатка,м по погонажу (дельта)

**Files:**
- Modify: `download/atex/js/slitter.js`
- Test: `experiments/atex-slitter.test.js`

Цель: при сохранении показаний резки остаток партии в метрах уменьшается на дельту погонажа (как уже делается для м² при списании расхода). Партия берётся из ссылки `Производственная резка.Партия сырья`.

- [ ] **Step 1: Написать падающий тест дельты остатка,м**

В `experiments/atex-slitter.test.js` (харнесс там тот же — смотри начало файла; объект называется `core`) добавить блок:

```javascript
// ── остаток,м по дельте погонажа (используем applyConsumption/restoreConsumption) ──
// Списание: погонаж вырос с 0 до 300 → остаток 4000 уменьшается на 300.
assertEqual(core.applyConsumption(4000, 300 - 0), 3700, 'остаток,м: первое списание погонажа');
// Правка вниз: погонаж был 300, стал 250 → вернуть 50.
assertEqual(core.restoreConsumption(3700, 300 - 250), 3750, 'остаток,м: правка погонажа вниз возвращает');
// Не уходит ниже нуля.
assertEqual(core.applyConsumption(100, 300), 0, 'остаток,м: не ниже нуля');
```

- [ ] **Step 2: Запустить тест — убедиться, что проходит или падает осознанно**

Run: `node experiments/atex-slitter.test.js`
Expected: PASS (функции `applyConsumption`/`restoreConsumption` уже есть в `core`; тест фиксирует, что именно ими ведём остаток,м). Если файла теста нет — создать по образцу `atex-intake.test.js` с `var core = require('../download/atex/js/slitter.js').core;`.

- [ ] **Step 3: Расширить `BATCH_REQ`/`CUT_REQ` и захват id партии резки**

В `slitter.js` в `var BATCH_REQ = {...}` добавить:

```javascript
        remainderM: 'Остаток, м'
```

В `AtexSlitter.prototype.loadBatches`, рядом с `var remIdx = colIndex(meta, BATCH_REQ.remainder);` добавить:

```javascript
        var remMIdx = colIndex(meta, BATCH_REQ.remainderM);
```

и в возвращаемый объект (где `remainder: ...`) добавить:

```javascript
                    remainderM: remMIdx >= 0 ? core.toNumber(row[remMIdx]) : 0
```

В `AtexSlitter.prototype.loadCut`, строку:

```javascript
                batch: parseRef(val(CUT_REQ.batch)).label,
```

заменить на (захватываем id партии и сохранённый погонаж для дельты):

```javascript
                batch: parseRef(val(CUT_REQ.batch)).label,
                batchId: parseRef(val(CUT_REQ.batch)).id,
                savedMeterage: core.toNumber(val(CUT_REQ.meterage)),
```

- [ ] **Step 4: Списывать остаток,м при сохранении показаний**

В `AtexSlitter.prototype.saveReadings` заменить тело так, чтобы после `_m_set` резки скорректировать остаток,м партии на дельту погонажа. Текущая реализация:

```javascript
    AtexSlitter.prototype.saveReadings = function() {
        var self = this;
        var cut = this.currentCut;
        if (this.busy || !cut) return;
        this.setBusy(true);
        this.post('_m_set/' + cut.id + '?JSON', this.cutFields(cut)).then(function() {
            self.setBusy(false);
            self.notify('Показания сохранены', 'success');
        }).catch(function(err) {
            self.setBusy(false);
            self.notify('Ошибка сохранения: ' + err.message, 'error');
        });
    };
```

заменить на:

```javascript
    AtexSlitter.prototype.saveReadings = function() {
        var self = this;
        var cut = this.currentCut;
        if (this.busy || !cut) return;
        this.setBusy(true);
        var meterageNow = core.toNumber(cut.meterage);
        var meterageWas = core.toNumber(cut.savedMeterage);
        var delta = meterageNow - meterageWas; // сколько ещё списать с остатка,м
        var batch = cut.batchId ? self.findBatch(cut.batchId) : null;
        var batchMeta = this.meta.batch;

        this.post('_m_set/' + cut.id + '?JSON', this.cutFields(cut)).then(function() {
            // Списываем дельту погонажа с остатка,м партии резки.
            if (!batch || !batchMeta || delta === 0) return null;
            var remReq = reqIdByName(batchMeta, BATCH_REQ.remainderM);
            if (!remReq) return null;
            var newRem = delta > 0
                ? core.applyConsumption(batch.remainderM, delta)
                : core.restoreConsumption(batch.remainderM, -delta);
            var bf = {};
            bf['t' + remReq] = newRem;
            return self.post('_m_set/' + batch.id + '?JSON', bf).then(function() {
                batch.remainderM = newRem;
            });
        }).then(function() {
            cut.savedMeterage = meterageNow;
            return self.loadBatches();
        }).then(function() {
            self.setBusy(false);
            self.notify('Показания сохранены; остаток партии (м) обновлён', 'success');
        }).catch(function(err) {
            self.setBusy(false);
            self.notify('Ошибка сохранения: ' + err.message, 'error');
        });
    };
```

- [ ] **Step 5: Прогнать тесты ядра слиттера**

Run: `node experiments/atex-slitter.test.js`
Expected: PASS, exit code 0.

- [ ] **Step 6: Commit**

```bash
git add download/atex/js/slitter.js experiments/atex-slitter.test.js
git commit -m "feat(#52): слиттер — списание Остаток,м по дельте погонажа"
```

---

## Task 4: slitter.js — брак в метрах, «Брак, м²» авто

**Files:**
- Modify: `download/atex/js/slitter.js`
- Test: `experiments/atex-slitter.test.js`

Цель: оператор вводит «Брак, м»; «Брак, м²» = `Брак, м × ширина сырья (м)` пишется автоматически в существующий реквизит (req 1106). Ширина сырья — из `Вид сырья.Ширина, мм` через `Тип резки → Вид сырья` выбранной резки.

- [ ] **Step 1: Написать падающий тест `defectM2`**

В `experiments/atex-slitter.test.js` добавить:

```javascript
// ── defectM2: брак,м² = брак,м × ширина_мм/1000 ──
assertEqual(core.defectM2(10, 910), 9.1, 'defectM2: 10 м при 910 мм = 9.1 м²');
assertEqual(core.defectM2('5,5', 880), 4.84, 'defectM2: запятая-десятичная, 880 мм');
assertEqual(core.defectM2(0, 910), 0, 'defectM2: ноль метров → 0');
assertEqual(core.defectM2(10, 0), 0, 'defectM2: нет ширины → 0');
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `node experiments/atex-slitter.test.js`
Expected: FAIL — `core.defectM2 is not a function`.

- [ ] **Step 3: Реализовать `defectM2` в `core`**

В `slitter.js` рядом с `restoreConsumption` добавить функцию и экспорт в объекте `core`:

```javascript
    // Брак в м²: метры брака × ширина сырья (мм → м). Любой нуль → 0.
    function defectM2(defectMeters, widthMm) {
        var m = toNumber(defectMeters);
        var w = toNumber(widthMm);
        if (m <= 0 || w <= 0) return 0;
        return round3(m * (w / 1000));
    }
```

В объект `var core = { ... }` добавить:

```javascript
        defectM2: defectM2,
```

- [ ] **Step 4: Запустить тест — убедиться, что проходит**

Run: `node experiments/atex-slitter.test.js`
Expected: PASS.

- [ ] **Step 5: Завести meta «Вид сырья»/«Тип резки» и загрузить ширину сырья резки**

Сначала сделать таблицы доступными вне `loadMetadata` (там `byName` локальна — наружу не видна).

В `var TABLE = {...}` (в `slitter.js`) добавить:

```javascript
        material: 'Вид сырья',
        cutType: 'Тип резки'
```

В `AtexSlitter.prototype.loadMetadata`, рядом с `self.meta.batch = byName(TABLE.batch);`, добавить:

```javascript
            self.meta.material = byName(TABLE.material);
            self.meta.cutType = byName(TABLE.cutType);
```

В конструкторе `AtexSlitter`, рядом с `this.batches = [];`, добавить:

```javascript
        this.materialWidths = {}; // { materialId: widthMm }
```

Добавить метод (рядом с `loadBatches`), используя `this.meta.material`:

```javascript
    // Карта ширин видов сырья: { id: Ширина,мм }. Для пересчёта брака,м → м².
    AtexSlitter.prototype.loadMaterialWidths = function() {
        var self = this;
        var meta = this.meta.material;
        if (!meta) { this.materialWidths = {}; return Promise.resolve(); }
        var wIdx = colIndex(meta, 'Ширина, мм');
        return this.getJson('object/' + meta.id + '/?JSON_OBJ&LIMIT=0,1000').then(function(rows) {
            var map = {};
            (rows || []).forEach(function(r) {
                var row = r.r || [];
                map[String(r.i)] = wIdx >= 0 ? core.toNumber(row[wIdx]) : 0;
            });
            self.materialWidths = map;
        });
    };
```

Вызвать загрузку при инициализации: в цепочке начальной загрузки, где после `loadMetadata()` вызывается `loadBatches()`, добавить `.then(function(){ return self.loadMaterialWidths(); })`.

В `AtexSlitter.prototype.loadCut` в объект `self.currentCut` добавить id типа резки (для резолва ширины):

```javascript
                cutTypeId: parseRef(val(CUT_REQ.cutType)).id,
```

Добавить метод, используя `this.meta.cutType`:

```javascript
    // Ширина сырья текущей резки: Тип резки → Вид сырья → Ширина,мм.
    AtexSlitter.prototype.resolveCutWidth = function() {
        var self = this;
        var cut = this.currentCut;
        var typeMeta = this.meta.cutType;
        if (!cut || !cut.cutTypeId || !typeMeta) { if (cut) cut.materialWidthMm = 0; return Promise.resolve(); }
        var matIdx = colIndex(typeMeta, 'Вид сырья');
        return this.getJson('object/' + typeMeta.id + '/?JSON_OBJ&F_I=' + encodeURIComponent(cut.cutTypeId) + '&LIMIT=0,1').then(function(rows) {
            var rec = (rows || [])[0];
            var matId = rec && matIdx >= 0 ? parseRef((rec.r || [])[matIdx]).id : null;
            cut.materialWidthMm = matId ? (self.materialWidths[String(matId)] || 0) : 0;
        });
    };
```

В месте, где после `loadCut(cutId)` грузятся расходы (`loadConsumptions`), добавить в цепочку `.then(function(){ return self.resolveCutWidth(); })`.

- [ ] **Step 6: Поле «Брак, м» в форме + авто-пересчёт «Брак, м²»**

В `slitter.js` в `var CUT_REQ = {...}` добавить:

```javascript
        defectM: 'Брак, м',
```

В форме показаний (где сейчас рендерится «Брак, м²», строка `grid.appendChild(field('Брак, м²', defect));`) заменить ввод м² на ввод метров с подсказкой пересчёта. Текущий блок:

```javascript
        var defect = numInput(cut.defect, '0');
        defect.addEventListener('input', function() { cut.defect = defect.value; });
        grid.appendChild(field('Брак, м²', defect));
```

заменить на:

```javascript
        var defectM = numInput(cut.defectM, '0');
        var defectHint = el('div', { class: 'atex-sl-hint', text: '' });
        function refreshDefectM2() {
            var m2 = core.defectM2(cut.defectM, cut.materialWidthMm);
            cut.defect = m2 ? String(m2) : '';
            defectHint.textContent = (core.toNumber(cut.defectM) > 0 && cut.materialWidthMm > 0)
                ? ('= ' + m2 + ' м² (ширина ' + cut.materialWidthMm + ' мм)')
                : (cut.materialWidthMm > 0 ? '' : 'ширина сырья не определена — м² не посчитать');
        }
        defectM.addEventListener('input', function() { cut.defectM = defectM.value; refreshDefectM2(); });
        refreshDefectM2();
        grid.appendChild(field('Брак, м', defectM));
        grid.appendChild(defectHint);
```

- [ ] **Step 7: Писать «Брак, м» и пересчитанный «Брак, м²» при сохранении**

В `AtexSlitter.prototype.cutFields` заменить строку `set(CUT_REQ.defect, num(cut.defect));` на:

```javascript
        set(CUT_REQ.defectM, num(cut.defectM));
        set(CUT_REQ.defect, core.defectM2(cut.defectM, cut.materialWidthMm));
```

И в `loadCut` в объект `self.currentCut` добавить чтение метров:

```javascript
                defectM: val(CUT_REQ.defectM),
```

- [ ] **Step 8: Прогнать тесты ядра слиттера**

Run: `node experiments/atex-slitter.test.js`
Expected: PASS, exit code 0.

- [ ] **Step 9: Commit**

```bash
git add download/atex/js/slitter.js experiments/atex-slitter.test.js
git commit -m "feat(#52): слиттер — брак в метрах, Брак,м² авто = метры × ширина"
```

---

## Task 5: slitter.js — фото брака (multipart)

**Files:**
- Modify: `download/atex/js/slitter.js`
- Test: `experiments/atex-slitter.test.js`

Цель: к резке можно приложить фото брака (реквизит FILE). На планшете кнопка открывает камеру (`capture="environment"`). Загрузка — multipart-запросом с ключом `t<reqId Фото брака>` и `_xsrf` (паттерн платформы #1310).

- [ ] **Step 1: Написать падающий тест ключа файлового реквизита**

В `experiments/atex-slitter.test.js` добавить (чистый хелпер построения ключа поля):

```javascript
// ── photoFieldKey: ключ multipart-поля для реквизита FILE ──
assertEqual(core.photoFieldKey('1118'), 't1118', 'photoFieldKey: t + reqId');
assertEqual(core.photoFieldKey(null), '', 'photoFieldKey: нет reqId → пусто');
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `node experiments/atex-slitter.test.js`
Expected: FAIL — `core.photoFieldKey is not a function`.

- [ ] **Step 3: Реализовать `photoFieldKey` в `core`**

В `slitter.js` рядом с `defectM2` добавить и экспортировать:

```javascript
    // Ключ multipart-поля для файлового реквизита: 't' + reqId (или '' если нет).
    function photoFieldKey(reqId) {
        return reqId ? ('t' + reqId) : '';
    }
```

В объект `core` добавить `photoFieldKey: photoFieldKey,`.

- [ ] **Step 4: Запустить тест — убедиться, что проходит**

Run: `node experiments/atex-slitter.test.js`
Expected: PASS.

- [ ] **Step 5: Добавить multipart-метод `postFile`**

В `slitter.js` после `AtexSlitter.prototype.post` добавить:

```javascript
    // Multipart-POST для файловых реквизитов (паттерн платформы, issue #1310):
    // тело FormData с _xsrf и t{reqId}=<File>. Возвращает разобранный JSON.
    AtexSlitter.prototype.postFile = function(path, reqKey, file, extra) {
        var fd = new FormData();
        fd.append('_xsrf', (typeof window !== 'undefined' && window.xsrf) || this.root.getAttribute('data-xsrf') || '');
        if (reqKey && file) fd.append(reqKey, file);
        Object.keys(extra || {}).forEach(function(k) {
            if (extra[k] !== undefined && extra[k] !== null && extra[k] !== '') fd.append(k, extra[k]);
        });
        return fetch(this.url(path), { method: 'POST', credentials: 'same-origin', body: fd })
            .then(function(resp) {
                return resp.text().then(function(text) {
                    var result;
                    try { result = JSON.parse(text); } catch (e) { throw new Error('Сервер вернул не JSON: ' + text.slice(0, 200)); }
                    if (result && (result.error || result.err)) throw new Error(result.error || result.err);
                    return result;
                });
            });
    };
```

> Не задаём `Content-Type` вручную — браузер сам выставит `multipart/form-data; boundary=…`.

- [ ] **Step 6: Добавить `CUT_REQ.defectPhoto` и UI загрузки фото**

В `var CUT_REQ = {...}` добавить:

```javascript
        defectPhoto: 'Фото брака',
```

В форме показаний, после поля «Брак, м» (после `grid.appendChild(defectHint);`), добавить кнопку выбора фото и загрузку:

```javascript
        // Фото брака: выбор файла (камера на планшете) → multipart в реквизит FILE.
        var photoInput = el('input', { type: 'file', accept: 'image/*', capture: 'environment', style: 'display:none' });
        var photoBtn = el('button', { class: 'atex-sl-btn atex-sl-btn-secondary', type: 'button', text: 'Фото брака' });
        var photoStatus = el('span', { class: 'atex-sl-hint', text: cut.defectPhoto ? 'фото загружено' : '' });
        photoBtn.addEventListener('click', function() { photoInput.click(); });
        photoInput.addEventListener('change', function() {
            var file = photoInput.files && photoInput.files[0];
            if (file) self.uploadDefectPhoto(file, photoStatus);
        });
        grid.appendChild(field('Фото брака', el('div', { class: 'atex-sl-photo' }, [photoBtn, photoStatus, photoInput])));
```

- [ ] **Step 7: Реализовать `uploadDefectPhoto`**

В `slitter.js` добавить метод:

```javascript
    AtexSlitter.prototype.uploadDefectPhoto = function(file, statusEl) {
        var self = this;
        var cut = this.currentCut;
        if (this.busy || !cut) return;
        var reqId = reqIdByName(this.meta.cut, CUT_REQ.defectPhoto);
        var key = core.photoFieldKey(reqId);
        if (!key) { this.notify('Реквизит «Фото брака» не найден', 'error'); return; }
        this.setBusy(true);
        if (statusEl) statusEl.textContent = 'загрузка…';
        this.postFile('_m_set/' + cut.id + '?JSON', key, file).then(function() {
            self.setBusy(false);
            cut.defectPhoto = file.name;
            if (statusEl) statusEl.textContent = 'фото загружено';
            self.notify('Фото брака загружено', 'success');
        }).catch(function(err) {
            self.setBusy(false);
            if (statusEl) statusEl.textContent = 'ошибка';
            self.notify('Ошибка загрузки фото: ' + err.message, 'error');
        });
    };
```

В `loadCut` в `self.currentCut` добавить чтение признака фото:

```javascript
                defectPhoto: val(CUT_REQ.defectPhoto),
```

- [ ] **Step 8: Прогнать тесты ядра слиттера**

Run: `node experiments/atex-slitter.test.js`
Expected: PASS, exit code 0.

- [ ] **Step 9: Commit**

```bash
git add download/atex/js/slitter.js experiments/atex-slitter.test.js
git commit -m "feat(#52): слиттер — загрузка фото брака (multipart, FILE-реквизит)"
```

---

## Task 6: Документация РМ + полный прогон тестов

**Files:**
- Modify: `docs/atex_workplaces.md`

- [ ] **Step 1: Зафиксировать новые поля и критерии в описании РМ**

В `docs/atex_workplaces.md` в разделах «Приёмка сырья» и «Пульт слиттера» добавить:
- Приёмка: поля «Длина, м» (дефолт из `Вид сырья.Длина рулона, м`), «Остаток, м» (= «Длина, м»).
- Слиттер: списание «Остаток, м» партии по дельте погонажа; «Брак, м» (ввод) + «Брак, м²» (авто = метры × ширина сырья); «Фото брака» (multipart).

- [ ] **Step 2: Полный прогон тестов рабочих мест atex**

Run:
```bash
node experiments/atex-intake.test.js
node experiments/atex-slitter.test.js
node experiments/atex-cut-calc.test.js
```
Expected: все PASS, exit code 0 (cut-calc — регрессия, не должен сломаться).

- [ ] **Step 3: Commit**

```bash
git add docs/atex_workplaces.md
git commit -m "docs(#52): описание РМ — остаток,м и брак,м/фото в приёмке и слиттере"
```

---

## Деплой (вне автоматизации — делает Андрей)

1. Завести в live БД (`ateh`) новые реквизиты с **точными именами**: `Партия сырья` → «Длина, м», «Остаток, м»; `Производственная резка` → «Брак, м» (число), «Фото брака» (тип «файл»).
2. Задеплоить код рабочих мест atex→ateh через `update.php` (по `update.conf`).
3. Обновить форму на live, иначе форма рассинхронится с БД.
4. Проверить на планшете: приёмка проставляет длину/остаток; пульт списывает остаток,м по погонажу; брак в метрах считает м²; фото грузится и открывается ссылкой.

> Пока реквизиты на live не созданы, код безопасен: `reqIdByName` вернёт null и новые поля просто не пишутся (старое поведение сохраняется).

## Self-review заметки

- Покрытие спеки: остаток,м авто из погонажа — Task 3; длина при приёмке — Task 2; брак,м + м² авто — Task 4; фото — Task 5; схема — Task 1; деплой — раздел выше. Все требования спеки покрыты.
- Имена методов/полей согласованы между задачами: `materialDefaultLength`, `defectM2`, `photoFieldKey` (ядро); `remainderM`, `lengthM`, `defectM`, `defectPhoto` (ключи REQ); `materialWidthMm`, `batchId`, `savedMeterage` (поля currentCut).
- Деградация при отсутствии реквизита на live — через `reqIdByName(...) → null`.
