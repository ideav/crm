# Диапазон диаметров втулкореза + авто-подбор — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** У втулкореза задаётся диапазон диаметров (min/max) вместо одного значения, а на пульте втулкореза задание автоматически получает подходящий втулкорез по своему диаметру (с возможностью переопределения).

**Architecture:** Чистая логика подбора (`pickCutter`, `formatRange`, `autoAssignCutter`) добавляется в объект `core` рабочего места `sleeve-cutter.js` и покрывается юнит-тестами. Браузерный слой читает min/max втулкорезов и вызывает авто-подбор при изменении диаметра. Схема боевой БД меняется отдельной операцией через API; форму деплоит Андрей.

**Tech Stack:** ванильный ES5-JS (atex workspaces), Integram metadata API, node-тесты без зависимостей (`node experiments/*.test.js`).

Спецификация: `docs/superpowers/specs/2026-06-01-vtulkorez-diameter-range-design.md`.

---

## Файлы

- Modify: `download/atex/js/sleeve-cutter.js` — `core` + браузерный слой пульта.
- Modify: `experiments/atex-sleeve-cutter.test.js` — юнит-тесты новой логики.
- Modify: `docs/atex_metadata.json` — схема таблицы «Втулкорез» (фикстура).
- Modify: `download/atex/css/sleeve-cutter.css` — стиль подсказки `.atex-sc-hint`.
- Операционно (не в репозитории): схема боевой БД через API + редеплой формы.

---

### Task 1: `core.pickCutter` — подбор втулкореза по диапазону

**Files:**
- Test: `experiments/atex-sleeve-cutter.test.js` (в конец, перед строкой вывода итога)
- Modify: `download/atex/js/sleeve-cutter.js` (рядом с `summarize`, и в объект `core`)

- [ ] **Step 1: Написать падающий тест**

В `experiments/atex-sleeve-cutter.test.js` перед финальным `console.log('\n' + passed ...)` добавить:

```js
// ── pickCutter: подбор втулкореза по диапазону ──
var CUTTERS = [
    { id: '1', label: 'Втулкорез 1', diaMin: 20, diaMax: 25 },
    { id: '2', label: 'Втулкорез 2', diaMin: 26, diaMax: 40 },
    { id: '3', label: 'Втулкорез 3', diaMin: 41, diaMax: 76 },
    { id: '4', label: 'Узкий 40',    diaMin: 40, diaMax: 40 }
];
assertEqual(core.pickCutter(20, CUTTERS).id, '1', 'pickCutter: внутри диапазона');
assertEqual(core.pickCutter(25, CUTTERS).id, '1', 'pickCutter: верхняя граница включительно');
assertEqual(core.pickCutter(26, CUTTERS).id, '2', 'pickCutter: нижняя граница включительно');
assertEqual(core.pickCutter(40, CUTTERS).id, '4', 'pickCutter: несколько покрывают → самый узкий');
assertEqual(core.pickCutter(100, CUTTERS), null, 'pickCutter: нет покрытия → null');
assertEqual(core.pickCutter('', CUTTERS), null, 'pickCutter: пустой диаметр → null');
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `node experiments/atex-sleeve-cutter.test.js`
Expected: FAIL — `core.pickCutter is not a function` (TypeError).

- [ ] **Step 3: Реализовать `pickCutter`**

В `download/atex/js/sleeve-cutter.js` после функции `round3` (перед `var core = {`) добавить:

```js
    // Подбор втулкореза по диаметру задания: запись, чей диапазон
    // [diaMin..diaMax] покрывает diameter (границы включительно); при нескольких —
    // с самым узким диапазоном; нет подходящего → null. Пустой диаметр → null.
    function pickCutter(diameter, cutters) {
        var d = toNumber(diameter);
        if (!d || !cutters) return null;
        var best = null, bestWidth = Infinity;
        cutters.forEach(function(c) {
            var min = (c.diaMin === '' || c.diaMin == null) ? -Infinity : toNumber(c.diaMin);
            var max = (c.diaMax === '' || c.diaMax == null) ? Infinity : toNumber(c.diaMax);
            if (d < min || d > max) return;
            var width = max - min;
            if (width < bestWidth) { best = c; bestWidth = width; }
        });
        return best;
    }
```

И в объект `core` (после `summarize: summarize`) добавить `pickCutter: pickCutter,`.

- [ ] **Step 4: Запустить тест — убедиться, что проходит**

Run: `node experiments/atex-sleeve-cutter.test.js`
Expected: новые 6 строк PASS, итог без FAIL.

- [ ] **Step 5: Коммит**

```bash
git add download/atex/js/sleeve-cutter.js experiments/atex-sleeve-cutter.test.js
git commit -m "feat(atex): core.pickCutter — подбор втулкореза по диапазону диаметров"
```

---

### Task 2: `core.formatRange` — подпись диапазона

**Files:**
- Test: `experiments/atex-sleeve-cutter.test.js`
- Modify: `download/atex/js/sleeve-cutter.js`

- [ ] **Step 1: Написать падающий тест**

Добавить в тест-файл:

```js
// ── formatRange: подпись диапазона ──
assertEqual(core.formatRange(20, 25), '20–25 мм', 'formatRange: обе границы');
assertEqual(core.formatRange(20, ''), 'от 20 мм', 'formatRange: только min');
assertEqual(core.formatRange('', 76), 'до 76 мм', 'formatRange: только max');
assertEqual(core.formatRange('', ''), '', 'formatRange: пусто');
```

- [ ] **Step 2: Запустить — упадёт**

Run: `node experiments/atex-sleeve-cutter.test.js`
Expected: FAIL — `core.formatRange is not a function`.

- [ ] **Step 3: Реализовать**

После `pickCutter` добавить:

```js
    // Подпись диапазона диаметров: «20–25 мм», «от 20 мм», «до 76 мм» или ''.
    function formatRange(min, max) {
        var hasMin = !(min === '' || min == null);
        var hasMax = !(max === '' || max == null);
        if (hasMin && hasMax) return toNumber(min) + '–' + toNumber(max) + ' мм';
        if (hasMin) return 'от ' + toNumber(min) + ' мм';
        if (hasMax) return 'до ' + toNumber(max) + ' мм';
        return '';
    }
```

В `core` добавить `formatRange: formatRange,`.

- [ ] **Step 4: Запустить — пройдёт**

Run: `node experiments/atex-sleeve-cutter.test.js`
Expected: 4 новые PASS.

- [ ] **Step 5: Коммит**

```bash
git add download/atex/js/sleeve-cutter.js experiments/atex-sleeve-cutter.test.js
git commit -m "feat(atex): core.formatRange — подпись диапазона диаметров"
```

---

### Task 3: `core.autoAssignCutter` — авто-назначение без перетирания ручного выбора

**Files:**
- Test: `experiments/atex-sleeve-cutter.test.js`
- Modify: `download/atex/js/sleeve-cutter.js`

- [ ] **Step 1: Написать падающий тест**

```js
// ── autoAssignCutter: авто-подбор без перетирания ручного выбора ──
function mkTask(o){ return Object.assign({ diameter:'', cutterId:null, cutterAuto:false }, o); }
assertEqual(core.autoAssignCutter(mkTask({diameter:20}), CUTTERS).cutterId, '1', 'autoAssign: пустое → авто');
assertEqual(core.autoAssignCutter(mkTask({diameter:20}), CUTTERS).cutterAuto, true, 'autoAssign: ставит признак авто');
assertEqual(core.autoAssignCutter(mkTask({diameter:20, cutterId:'3', cutterAuto:false}), CUTTERS).cutterId, '3', 'autoAssign: ручной выбор не трогаем');
assertEqual(core.autoAssignCutter(mkTask({diameter:30, cutterId:'1', cutterAuto:true}), CUTTERS).cutterId, '2', 'autoAssign: прежний авто пере-подбирается');
assertEqual(core.autoAssignCutter(mkTask({diameter:100, cutterId:'1', cutterAuto:true}), CUTTERS).cutterId, null, 'autoAssign: нет подходящего → очищаем');
```

- [ ] **Step 2: Запустить — упадёт**

Run: `node experiments/atex-sleeve-cutter.test.js`
Expected: FAIL — `core.autoAssignCutter is not a function`.

- [ ] **Step 3: Реализовать**

После `formatRange` добавить:

```js
    // Авто-назначение втулкореза заданию по диаметру. Ручной выбор оператора
    // (cutterId задан и не авто) не перетирается. Иначе — pickCutter и признак
    // cutterAuto. Мутирует и возвращает задание.
    function autoAssignCutter(task, cutters) {
        if (!task) return task;
        if (task.cutterId && !task.cutterAuto) return task;
        var picked = pickCutter(task.diameter, cutters);
        task.cutterId = picked ? picked.id : null;
        task.cutterAuto = !!picked;
        return task;
    }
```

В `core` добавить `autoAssignCutter: autoAssignCutter,`.

- [ ] **Step 4: Запустить — пройдёт**

Run: `node experiments/atex-sleeve-cutter.test.js`
Expected: 5 новых PASS, итог `N assertions passed` без FAIL.

- [ ] **Step 5: Коммит**

```bash
git add download/atex/js/sleeve-cutter.js experiments/atex-sleeve-cutter.test.js
git commit -m "feat(atex): core.autoAssignCutter — авто-подбор без перетирания ручного выбора"
```

---

### Task 4: Фикстура схемы — «Втулкорез» min/max

**Files:**
- Modify: `docs/atex_metadata.json`

- [ ] **Step 1: Заменить реквизит «Диаметр, мм» на два**

Найти в `docs/atex_metadata.json` таблицу `"val": "Втулкорез"` (id 102) и заменить её массив `reqs` целиком на:

```json
    "reqs": [
      {
        "num": 1,
        "id": "1013",
        "val": "Диаметр min, мм",
        "orig": "1014",
        "type": "13"
      },
      {
        "num": 2,
        "id": "8201",
        "val": "Диаметр max, мм",
        "orig": "8202",
        "type": "13"
      },
      {
        "num": 3,
        "id": "1015",
        "val": "Статус",
        "orig": "1016",
        "type": "3"
      }
    ]
```

(Проверить, что id `8201`/`8202` не встречаются в файле — `grep -c '"8201"' docs/atex_metadata.json` → 0; иначе взять другие свободные.)

- [ ] **Step 2: Проверить валидность JSON**

Run: `python3 -c "import json; json.load(open('docs/atex_metadata.json')); print('OK')"`
Expected: `OK`

- [ ] **Step 3: Прогнать тесты пульта (фикстура не ломает ядро)**

Run: `node experiments/atex-sleeve-cutter.test.js`
Expected: все PASS.

- [ ] **Step 4: Коммит**

```bash
git add docs/atex_metadata.json
git commit -m "feat(atex): фикстура «Втулкорез» — Диаметр min/max вместо одного"
```

---

### Task 5: Браузерный слой пульта — чтение min/max и авто-подбор

**Files:**
- Modify: `download/atex/js/sleeve-cutter.js`
- Modify: `download/atex/css/sleeve-cutter.css`

- [ ] **Step 1: Карта имён реквизитов втулкореза**

Рядом с `var TASK_REQ = { ... };` (после неё) добавить:

```js
    var CUTTER_REQ = { diaMin: 'Диаметр min, мм', diaMax: 'Диаметр max, мм' };
```

- [ ] **Step 2: `loadCutters` читает min/max**

Заменить метод `loadCutters` целиком на:

```js
    AtexSleeveCutter.prototype.loadCutters = function() {
        var self = this;
        if (!this.meta.cutter) { this.cutters = []; return Promise.resolve(); }
        var meta = this.meta.cutter;
        return this.getJson('object/' + meta.id + '/?JSON_OBJ&LIMIT=0,1000').then(function(rows) {
            var minIdx = colIndex(meta, CUTTER_REQ.diaMin);
            var maxIdx = colIndex(meta, CUTTER_REQ.diaMax);
            self.cutters = (rows || []).map(function(r) {
                var row = r.r || [];
                return {
                    id: String(r.i),
                    label: row[0] || ('#' + r.i),
                    diaMin: minIdx >= 0 ? (row[minIdx] || '') : '',
                    diaMax: maxIdx >= 0 ? (row[maxIdx] || '') : ''
                };
            });
        });
    };
```

- [ ] **Step 3: Подписи опций втулкореза с диапазоном**

Сразу после `loadCutters` добавить метод:

```js
    // Опции выпадающего списка втулкорезов с подписью диапазона.
    AtexSleeveCutter.prototype.cutterOptions = function() {
        return (this.cutters || []).map(function(c) {
            var range = core.formatRange(c.diaMin, c.diaMax);
            return { id: c.id, label: range ? (c.label + ' (' + range + ')') : c.label };
        });
    };
```

- [ ] **Step 4: `blankTask` и `loadTasks` — признак `cutterAuto`**

В `blankTask` заменить return на:

```js
        return { id: null, name: '', planQty: '', cutterId: null, cutterAuto: false, diameter: '', factQty: '', status: STATUSES[0] };
```

В `loadTasks` в возвращаемый объект задания добавить строку после `cutterId: cutterRef.id,`:

```js
                    cutterAuto: false,
```

- [ ] **Step 5: Карточка задания — список с диапазоном, авто-подбор при изменении диаметра, подсказка**

В `renderTaskCard` заменить блок «Втулкорез (ссылка)»:

```js
        // Втулкорез (ссылка).
        var cutterRef = this.refSelect({
            options: this.cutters,
            value: task.cutterId,
            placeholder: '— втулкорез —',
            reqId: reqIdByName(this.meta.task, TASK_REQ.cutter),
            onChange: function(value) { task.cutterId = value || null; }
        });
        grid.appendChild(this.cardField('Втулкорез', cutterRef));
```

на:

```js
        // Втулкорез (ссылка). Подписи с диапазоном; ручной выбор снимает авто-признак.
        var cutterRef = this.refSelect({
            options: this.cutterOptions(),
            value: task.cutterId,
            placeholder: '— втулкорез —',
            reqId: reqIdByName(this.meta.task, TASK_REQ.cutter),
            onChange: function(value) { task.cutterId = value || null; task.cutterAuto = false; }
        });
        var cutterField = this.cardField('Втулкорез', cutterRef);
        if (task.diameter !== '' && task.diameter != null && !core.pickCutter(task.diameter, this.cutters)) {
            cutterField.appendChild(el('span', { class: 'atex-sc-hint', text: 'нет втулкореза под Ø' + core.toNumber(task.diameter) }));
        }
        grid.appendChild(cutterField);
```

И блок «Диаметр» заменить:

```js
        // Диаметр.
        var diam = numInput(task.diameter, '76');
        diam.addEventListener('input', function() { task.diameter = diam.value; });
        grid.appendChild(this.cardField('Диаметр, мм', diam));
```

на:

```js
        // Диаметр. По завершении ввода — авто-подбор втулкореза.
        var diam = numInput(task.diameter, '76');
        diam.addEventListener('input', function() { task.diameter = diam.value; });
        diam.addEventListener('change', function() {
            task.diameter = diam.value;
            core.autoAssignCutter(task, self.cutters);
            self.renderTasks();
        });
        grid.appendChild(this.cardField('Диаметр, мм', diam));
```

- [ ] **Step 6: Стиль подсказки**

В конец `download/atex/css/sleeve-cutter.css` добавить:

```css
/* Подсказка «нет втулкореза под диаметр» в карточке задания. */
#atex-sleeve-cutter .atex-sc-hint {
    display: block;
    margin-top: 4px;
    font-size: 12px;
    color: #b45309;
}
```

- [ ] **Step 7: Проверка синтаксиса JS**

Run: `node -e "require('./download/atex/js/sleeve-cutter.js'); console.log('OK')"`
Expected: `OK` (модуль грузится в Node без ошибок; браузерный слой не выполняется).

- [ ] **Step 8: Прогнать юнит-тесты**

Run: `node experiments/atex-sleeve-cutter.test.js`
Expected: все PASS.

- [ ] **Step 9: Визуальная проверка пульта (фикстура + Playwright)**

Открыть `experiments/atex-sleeve-cutter.fixture.html` в Playwright, выбрать резку, добавить задание, ввести диаметр 20 → убедиться, что втулкорез подставился автоматически и в списке видны диапазоны; ввести 999 → появляется подсказка «нет втулкореза под Ø999». Сделать скриншот. (Если фикстура не отдаёт min/max — это нормально для оффлайн-фикстуры; тогда проверка на dev-стенде после Task 6.)

- [ ] **Step 10: Коммит**

```bash
git add download/atex/js/sleeve-cutter.js download/atex/css/sleeve-cutter.css
git commit -m "feat(atex): пульт втулкореза — авто-подбор по диапазону, подписи диапазонов, подсказка"
```

---

### Task 6: Схема боевой БД + миграция (операционно, при деплое)

**Контекст:** таблица «Втулкорез» live id **1071**, текущий «Диаметр, мм» = req **1094**. Записи и их диаметры: 1287=25, 1290=40, 1293=76, 2257=20, 2260=40, 2263=76. Токен ротируется — взять актуальный у Андрея; xsrf: `GET /ateh/xsrf?JSON=1`.

- [ ] **Step 1: Проверить, не используется ли «Диаметр, мм» (1094) в отчётах/дашбордах**

Просмотреть live-отчёты и `download/atex/js/*.js` на чтение диаметра именно втулкореза (не задания). Греп по коду: `grep -rn "Диаметр, мм" download/atex/js` — все вхождения должны относиться к таблице «Задание на втулки», не к втулкорезу. Если есть отчёт по диаметру втулкореза — req 1094 НЕ удалять (оставить как есть, новый код его не трогает).

- [ ] **Step 2: Создать два числовых термина и добавить как колонки в 1071**

```bash
DB=https://ideav.ru/ateh; TOKEN=<актуальный>
XSRF=$(curl -s -H "X-Authorization: $TOKEN" "$DB/xsrf?JSON=1" | python3 -c "import sys,json;print(json.load(sys.stdin)['_xsrf'])")
# термин «Диаметр min, мм»
MIN=$(curl -s "$DB/_d_new?JSON=1" --data-urlencode "t=13" --data-urlencode "val=Диаметр min, мм" --data-urlencode "token=$TOKEN" --data-urlencode "_xsrf=$XSRF" | python3 -c "import sys,json;print(json.load(sys.stdin)['obj'])")
# термин «Диаметр max, мм»
MAX=$(curl -s "$DB/_d_new?JSON=1" --data-urlencode "t=13" --data-urlencode "val=Диаметр max, мм" --data-urlencode "token=$TOKEN" --data-urlencode "_xsrf=$XSRF" | python3 -c "import sys,json;print(json.load(sys.stdin)['obj'])")
# добавить колонки в таблицу 1071, запомнить req-id
RMIN=$(curl -s "$DB/_d_req/1071?JSON=1" --data-urlencode "t=$MIN" --data-urlencode "token=$TOKEN" --data-urlencode "_xsrf=$XSRF" | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")
RMAX=$(curl -s "$DB/_d_req/1071?JSON=1" --data-urlencode "t=$MAX" --data-urlencode "token=$TOKEN" --data-urlencode "_xsrf=$XSRF" | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")
echo "RMIN=$RMIN RMAX=$RMAX"
```

- [ ] **Step 3: Миграция значений — min=max=текущий диаметр**

```bash
for rec_val in 1287:25 1290:40 1293:76 2257:20 2260:40 2263:76; do
  REC=${rec_val%%:*}; VAL=${rec_val##*:}
  curl -s "$DB/_m_set/$REC?JSON=1" --data-urlencode "t$RMIN=$VAL" --data-urlencode "t$RMAX=$VAL" --data-urlencode "token=$TOKEN" --data-urlencode "_xsrf=$XSRF" >/dev/null
done
# проверка
curl -s -H "X-Authorization: $TOKEN" "$DB/object/1071?JSON_DATA=1&LIMIT=10000" | python3 -m json.tool
```

- [ ] **Step 4: Удалить «Диаметр, мм» (1094), если Step 1 показал, что не используется**

```bash
curl -s "$DB/_d_del_req/1094?JSON=1" --data-urlencode "forced=1" --data-urlencode "token=$TOKEN" --data-urlencode "_xsrf=$XSRF"
```

- [ ] **Step 5: Редеплой формы (Андрей)**

Андрей деплоит `download/atex/*` и шаблоны через `update.php` по `update.conf` (маппинг atex→ateh). После деплоя проверить пульт на dev/боевом: при вводе диаметра подставляется втулкорез, видны диапазоны.

- [ ] **Step 6: Выставить реальные диапазоны (Андрей, в админке)**

Заготовка (по желанию) — диапазоны из ТЗ для трёх типоразмеров:

```bash
# маленький 20–25, средний 26–40, большой 41–76
for rec_min_max in 2257:20:25 1287:20:25 2260:26:40 1290:26:40 2263:41:76 1293:41:76; do
  IFS=: read REC MN MX <<< "$rec_min_max"
  curl -s "$DB/_m_set/$REC?JSON=1" --data-urlencode "t$RMIN=$MN" --data-urlencode "t$RMAX=$MX" --data-urlencode "token=$TOKEN" --data-urlencode "_xsrf=$XSRF" >/dev/null
done
```

---

### Task 7: PR в ideav/crm

- [ ] **Step 1: Запушить ветку и создать PR**

```bash
gh auth switch -u unidel2035 && gh auth setup-git
git push -u unidel-fork atex-vtulkorez-diameter-range
gh pr create -R ideav/crm --head unidel2035:atex-vtulkorez-diameter-range --base main \
  --title "feat(atex): диапазон диаметров втулкореза + авто-подбор задания" \
  --body "Спека и план в docs/superpowers/. Втулкорез: min/max диаметра; пульт авто-подбирает втулкорез по диаметру задания (переопределяемо). Юнит-тесты pickCutter/formatRange/autoAssignCutter зелёные. Схему боевой БД и редеплой формы — отдельно (Task 6)."
gh auth switch -u gaveron18
```

---

## Self-Review

- **Покрытие спеки:** схема (Task 4 фикстура + Task 6 live), pickCutter/диапазон (Task 1), авто-подбор + не-перетирание (Task 3, Task 5), подпись диапазона (Task 2, Task 5 Step 3/5), подсказка «нет втулкореза» (Task 5 Step 5/6), деплой (Task 6), тесты (Tasks 1–3). Все пункты спеки покрыты.
- **Заглушки:** нет — каждый шаг содержит готовый код/команду.
- **Согласованность имён:** `pickCutter`, `formatRange`, `autoAssignCutter`, `cutterOptions`, `CUTTER_REQ`, `cutterAuto`, `diaMin/diaMax` используются одинаково во всех задачах.
