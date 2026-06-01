# РМ «Расчёт резки» (Диспетчер) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дать Диспетчеру РМ, которое по «Вид сырья + целевая ширина» подбирает раскрой (минимизация отхода ≤20мм, добор ходовыми ширинами) и сохраняет комбинацию как «Тип резки» без дублей.

**Architecture:** Новое рабочее место atex (`cut-planning`), ES5 IIFE по образцу `cut-calc.js` (UMD: `module.exports` + `window.AtexCutPlanning`; чистое ядро в `calc`, DOM-контроллер ниже). Ходовые ширины — серверный отчёт `preferable_widths` (создаётся в live ateh), зовётся по имени `report/preferable_widths?JSON_KV&FR_position_material_id={matId}`. Сохранение типа+полос и дедуп — по паттерну `cut-calc.js`.

**Tech Stack:** ванильный ES5 JS, Integram REST (`object/`, `report/`, `_m_new`/`_m_set`/`_m_save`/`_m_del`), кастомный test-harness в `experiments/`.

**Спека:** `docs/superpowers/specs/2026-06-01-cut-planning-design.md`. Эпик ideav/atex#52, подзадача B.

---

## Структура файлов

| Файл | Ответственность | Действие |
|---|---|---|
| (live ateh) запрос `preferable_widths` | отчёт ходовых ширин по сырью | Create (API) |
| `docs/integram-reports.md` | задокументировать создание `preferable_widths` | Modify |
| `download/atex/js/cut-planning.js` | ядро подбора/сигнатуры + контроллер РМ | Create |
| `experiments/atex-cut-planning.test.js` | тесты чистого ядра | Create |
| `templates/atex/cut-planning.html` | шаблон РМ | Create |
| `download/atex/css/cut-planning.css` | стили РМ | Create |
| `docs/atex_menu.json` | пункт меню «Расчёт резки» (Диспетчер, Администратор) | Modify |
| `docs/atex_workplaces.md` | описание РМ | Modify |

`update.conf` менять НЕ нужно — `download/atex/{js,css}/*` и `templates/atex/*` деплоятся по маске.

Live id (подтверждены инспекцией отчёта 8341): реквизиты «Позиции заказа» — Ширина=**1141**, Вид сырья=**1138**, Кол-во=**1137**. Функции: `t104=85` (abn_ID), `t104=73` (SUM). Сортировка `t109=-1` (убыв.).

---

## Task 1: Создать отчёт `preferable_widths` в live ateh + документация

**Files:**
- Create (live): запрос `preferable_widths` в ateh
- Modify: `docs/integram-reports.md`

Идемпотентно: сперва проверить, нет ли уже `preferable_widths`.

- [ ] **Step 1: Проверить, существует ли отчёт**

```bash
DB=https://ideav.ru/ateh; TOKEN=76f723b8-dde6-44fb-b906-1dafdbd7a421
curl -s -H "X-Authorization: $TOKEN" --cookie "idb_ateh=$TOKEN" "$DB/object/22/?JSON_OBJ&LIMIT=0,2000" \
 | python3 -c "import sys,json; d=json.load(sys.stdin); rows=d if isinstance(d,list) else d.get('rows',[]); [print(r.get('i'),(r.get('r') or [''])[0]) for r in rows if 'preferable_widths'==((r.get('r') or [''])[0])]"
```
Если вывод не пуст — отчёт уже есть, перейти к Step 5 (запуск+документация), пропустив создание.

- [ ] **Step 2: Создать запрос (тип 22) + получить xsrf**

```bash
XSRF=$(curl -s -H "X-Authorization: $TOKEN" --cookie "idb_ateh=$TOKEN" "$DB/xsrf?JSON=1" | python3 -c "import sys,json;print(json.load(sys.stdin)['_xsrf'])")
QID=$(curl -s -H "X-Authorization: $TOKEN" --cookie "idb_ateh=$TOKEN" "$DB/_m_new/22?JSON&up=1" \
  --data-urlencode "t22=preferable_widths" --data-urlencode "token=$TOKEN" --data-urlencode "_xsrf=$XSRF" \
  | python3 -c "import sys,json;print(json.load(sys.stdin).get('id') or json.load(sys.stdin).get('obj'))")
echo "QID=$QID"
```

- [ ] **Step 3: Добавить 4 колонки (тип 28, up=QID)**

```bash
mkcol() { # $1=t28(reqId) $2=t100(name)
  curl -s -H "X-Authorization: $TOKEN" --cookie "idb_ateh=$TOKEN" "$DB/_m_new/28?JSON&up=$QID" \
    --data-urlencode "t28=$1" --data-urlencode "t100=$2" --data-urlencode "token=$TOKEN" --data-urlencode "_xsrf=$XSRF" \
    | python3 -c "import sys,json;print(json.load(sys.stdin).get('id') or json.load(sys.stdin).get('obj'))"
}
C_W=$(mkcol 1141 position_width_mm)        # ширина — ключ группировки, для показа
C_WID=$(mkcol 1141 position_width_id)      # ширина как ID (abn_ID)
C_MAT=$(mkcol 1138 position_material_id)   # вид сырья ID (abn_ID) — внешний фильтр FR_
C_QTY=$(mkcol 1137 position_qty_sum)       # SUM(Кол-во), сортировка по убыванию
echo "$C_W $C_WID $C_MAT $C_QTY"
```

- [ ] **Step 4: Настроить функции/сортировку (`_m_set`)**

```bash
set_t() { curl -s -H "X-Authorization: $TOKEN" --cookie "idb_ateh=$TOKEN" "$DB/_m_set/$1?JSON" \
  --data-urlencode "$2" --data-urlencode "token=$TOKEN" --data-urlencode "_xsrf=$XSRF" >/dev/null; }
set_t "$C_WID" "t104=85"     # abn_ID
set_t "$C_MAT" "t104=85"     # abn_ID
set_t "$C_QTY" "t104=73"     # SUM
set_t "$C_QTY" "t109=-1"     # сортировка по убыванию
```

- [ ] **Step 5: Проверить запуск отчёта**

```bash
curl -s -H "X-Authorization: $TOKEN" --cookie "idb_ateh=$TOKEN" "$DB/report/preferable_widths?JSON_KV" | head -c 600
# С фильтром по сырью (взять реальный position_material_id из вывода выше):
curl -s -H "X-Authorization: $TOKEN" --cookie "idb_ateh=$TOKEN" "$DB/report/preferable_widths?JSON_KV&FR_position_material_id=1253&TO_position_material_id=1253" | head -c 400
```
Expected: массив `[{position_width_mm, position_width_id, position_material_id, position_qty_sum}, …]` по убыванию `position_qty_sum`; фильтр сужает до одного сырья.

- [ ] **Step 6: Задокументировать путь в `docs/integram-reports.md`**

Добавить раздел «`preferable_widths` (ходовые ширины по сырью)»: назначение, таблица колонок (1141 position_width_mm; 1141 position_width_id abn_ID; 1138 position_material_id abn_ID FR_-фильтр; 1137 position_qty_sum SUM, t109=-1), команды создания (как выше), пример запуска с `FR_position_material_id`. Стиль repo (факты, без «раньше было»).

- [ ] **Step 7: Commit (только документация; отчёт — в live)**

```bash
git add docs/integram-reports.md
git commit -m "docs(#52): отчёт preferable_widths (ходовые ширины по сырью) — создание и запуск"
```

---

## Task 2: Чистое ядро подбора + сигнатура (TDD)

**Files:**
- Create: `download/atex/js/cut-planning.js` (скелет UMD + ядро `calc`)
- Create: `experiments/atex-cut-planning.test.js`

- [ ] **Step 1: Написать падающие тесты**

Создать `experiments/atex-cut-planning.test.js`:
```javascript
// Тесты ядра РМ «Расчёт резки» (ideav/atex#52, подзадача B). Без DOM/сети.
// Run: node experiments/atex-cut-planning.test.js
var calc = require('../download/atex/js/cut-planning.js').calc;
var passed = 0;
function eq(actual, expected, name){
  var ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log((ok?'PASS':'FAIL')+' — '+name);
  if (ok) passed++; else { console.log('  exp:',JSON.stringify(expected)); console.log('  got:',JSON.stringify(actual)); process.exitCode=1; }
}

// candidates: [{width, freq}] по убыванию freq.
var cand = [{width:80,freq:902},{width:60,freq:510},{width:40,freq:308},{width:30,freq:319},{width:50,freq:162}];

// Пример ТЗ: вход 880, цель 60 → 14×60 (Заказ) + добор 40 → 1×40 (Склад), остаток 0.
var r1 = calc.suggestCombination(880, 60, cand, 20);
eq(r1.strips, [{width:60,qty:14,purpose:'Заказ'},{width:40,qty:1,purpose:'Склад'}], 'ТЗ: 60x14 + 40x1');
eq(r1.remainder, 0, 'остаток 0');
eq(r1.withinTolerance, true, 'в допуске');

// Цель делит вход нацело → только заказные полосы, без добора.
var r2 = calc.suggestCombination(880, 110, cand, 20);
eq(r2.strips, [{width:110,qty:8,purpose:'Заказ'}], '110x8 ровно');
eq(r2.remainder, 0, 'остаток 0 (ровно)');

// Недостижимый допуск → лучший отход, withinTolerance:false. Вход 100, цель 97, добор нечем (<3).
var r3 = calc.suggestCombination(100, 97, [{width:50,freq:1}], 2);
eq(r3.remainder, 3, 'лучший возможный остаток 3');
eq(r3.withinTolerance, false, 'вне допуска');

// combinationSignature: порядок полос неважен, сырьё учитывается.
var sigA = calc.combinationSignature('1', [{width:60,qty:14},{width:40,qty:1}]);
var sigB = calc.combinationSignature('1', [{width:40,qty:1},{width:60,qty:14}]);
eq(sigA, sigB, 'сигнатура не зависит от порядка полос');
var sigC = calc.combinationSignature('2', [{width:60,qty:14},{width:40,qty:1}]);
eq(sigA === sigC, false, 'другое сырьё → другая сигнатура');

console.log(passed + ' assertions passed');
```

- [ ] **Step 2: Запустить → FAIL**

Run: `node experiments/atex-cut-planning.test.js` → FAIL (модуля/функций нет).

- [ ] **Step 3: Создать скелет `cut-planning.js` с ядром**

Создать `download/atex/js/cut-planning.js`. Скопировать UMD-обёртку и базовые хелперы из `download/atex/js/cut-calc.js` (строки ~21–88: IIFE-обёртка, `toNumber`, `round3`, `usedWidth`, `remainder`), сменив `window.AtexCutCalc`→`window.AtexCutPlanning` и `api.init`. Добавить в ядро `calc` функции:
```javascript
    // Подбор комбинации: набрать целевую ширину, добрать остаток ходовыми (min отход).
    // candidates: [{width, freq}] по убыванию freq. tolerance — допустимый |отход|.
    function suggestCombination(inputWidth, targetWidth, candidates, tolerance) {
        var W = toNumber(inputWidth), t = toNumber(targetWidth), tol = toNumber(tolerance);
        var strips = [];
        var nTarget = (t > 0) ? Math.floor(W / t) : 0;
        if (nTarget > 0) strips.push({ width: t, qty: nTarget, purpose: 'Заказ' });
        var rem = round3(W - nTarget * t);
        // Добор остатка ходовыми: точный поиск по минимуму итогового отхода,
        // тай-брейк — бо́льшая суммарная freq задействованных ширин.
        var fill = bestFill(rem, candidates, tol);
        fill.strips.forEach(function(s){ strips.push({ width: s.width, qty: s.qty, purpose: 'Склад' }); });
        var used = round3(strips.reduce(function(a,s){ return a + s.width*s.qty; }, 0));
        var remainder = round3(W - used);
        return { strips: strips, used: used, remainder: remainder,
                 withinTolerance: Math.abs(remainder) <= Math.abs(tol) };
    }

    // Перебор добора остатка rem ширинами candidates: возвращает {strips, leftover, freqSum}
    // с минимальным leftover (затем макс freqSum). Ограниченный поиск (rem конечен).
    function bestFill(rem, candidates, tol) {
        var cands = (candidates || []).map(function(c){ return { width: toNumber(c.width), freq: toNumber(c.freq) }; })
            .filter(function(c){ return c.width > 0 && c.width <= rem + Math.abs(toNumber(tol)); });
        var best = { strips: [], leftover: round3(rem), freqSum: 0 };
        // DFS по индексам candidates с накоплением; останавливаемся при leftover<=tol.
        (function dfs(i, left, acc, freqSum){
            var leftR = round3(left);
            if (leftR < best.leftover || (leftR === best.leftover && freqSum > best.freqSum)) {
                best = { strips: acc.slice(), leftover: leftR, freqSum: freqSum };
            }
            if (leftR <= Math.abs(toNumber(tol))) return;       // достаточно
            for (var k = i; k < cands.length; k++) {
                var c = cands[k];
                if (c.width > leftR) continue;
                // берём максимум этой ширины, затем рекурсия по остатку с следующими
                var maxQ = Math.floor(leftR / c.width);
                for (var q = maxQ; q >= 1; q--) {
                    acc.push({ width: c.width, qty: q });
                    dfs(k + 1, round3(leftR - c.width * q), acc, freqSum + c.freq * q);
                    acc.pop();
                }
            }
        })(0, rem, [], 0);
        return best;
    }

    // Канонический ключ комбинации: сырьё + отсортированный мультинабор ширина×кол-во.
    function combinationSignature(materialId, strips) {
        var parts = (strips || []).map(function(s){ return round3(toNumber(s.width)) + 'x' + toNumber(s.qty); }).sort();
        return String(materialId == null ? '' : materialId) + '|' + parts.join('+');
    }
```
Добавить в объект `var calc = { ... }`: `suggestCombination`, `bestFill`, `combinationSignature` (плюс перенесённые `toNumber`, `round3`, `usedWidth`, `remainder`).

> Примечание по тесту ТЗ (880/60): floor(880/60)=14, rem=40; bestFill(40, cand, 20): ширина 40 (freq 308) даёт leftover 0 → выбор `40×1`. Ожидаемо.

- [ ] **Step 4: Запустить → PASS**

Run: `node experiments/atex-cut-planning.test.js` → все PASS. Если порядок/тай-брейк не совпал с ожиданиями теста — донастроить `bestFill` (или тест, если ожидание было неточным), добиться зелёного и осмысленного поведения на примерах ТЗ.

- [ ] **Step 5: Commit**

```bash
git add download/atex/js/cut-planning.js && git add -f experiments/atex-cut-planning.test.js
git commit -m "feat(#52): cut-planning — ядро suggestCombination + combinationSignature"
```

---

## Task 3: РМ — каркас, загрузка данных, отчёт ходовых, UI подбора

**Files:**
- Modify: `download/atex/js/cut-planning.js` (DOM-контроллер)
- Create: `templates/atex/cut-planning.html`, `download/atex/css/cut-planning.css`

Строить контроллер по образцу `cut-calc.js` (читать его как референс перед написанием).

- [ ] **Step 1: Шаблон + CSS**

`templates/atex/cut-planning.html` — по образцу `templates/atex/cut-calc.html`, заменив имена на cut-planning (`#atex-cut-planning`, `cut-planning.css`, `cut-planning.js`), заголовок «Расчёт резки», URL `/atex/cut-planning`, оставить подключение `ref-search.js`. `download/atex/css/cut-planning.css` — минимальные стили в неймспейсе `.atex-cp` (можно опереться на `cut-calc.css`).

- [ ] **Step 2: Контроллер — метаданные, материалы, существующие типы**

В `cut-planning.js` (DOM-слой, как в cut-calc): `AtexCutPlanning(root)` с `this.meta = {cutType, strip, material}`, `loadMetadata()`, `loadMaterials()` (id+label+Ширина,мм для ширины входа), `loadCutTypes()` (для дедупа). Переиспользовать паттерны `url/getJson/post/reqIdByName/parseRef` из cut-calc.js (скопировать как есть).

- [ ] **Step 3: Загрузка ходовых ширин по отчёту**

```javascript
    // Ходовые ширины выбранного сырья: отчёт preferable_widths по materialId (abn_ID).
    AtexCutPlanning.prototype.loadPreferredWidths = function(materialId) {
        if (!materialId) return Promise.resolve([]);
        var url = 'report/preferable_widths?JSON_KV&FR_position_material_id=' + encodeURIComponent(materialId) +
                  '&TO_position_material_id=' + encodeURIComponent(materialId);
        return this.getJson(url).then(function(rows){
            return (rows || []).map(function(r){
                return { width: parseFloat(r.position_width_mm), freq: parseFloat(r.position_qty_sum) };
            }).filter(function(c){ return isFinite(c.width) && c.width > 0; });
        });
    };
```
> `materialId` для фильтра — это ID записи «Вид сырья» (abn_ID в отчёте). Берётся из выбранного значения ref-select «Вид сырья».

- [ ] **Step 4: Форма и кнопка «Подобрать»**

Форма: Вид сырья (searchable-ref как в cut-calc), целевая ширина (number), допуск (number, дефолт 20), кнопка «Подобрать». По «Подобрать»: ширина входа = `Вид сырья.Ширина, мм`; `loadPreferredWidths(matId)` → `calc.suggestCombination(inputWidth, targetWidth, candidates, tolerance)` → отрисовать полосы (ширина/кол-во/назначение) в редактируемой таблице + сводку (`calc.usedWidth`/`remainder`, в допуске?). Полосы редактируемы вручную (как в cut-calc); пересчёт сводки на изменение.

- [ ] **Step 5: Ручная проверка (DOM не тестируется в node) + commit**

Прогнать `node experiments/atex-cut-planning.test.js` (ядро — PASS). DOM проверить чтением/фикстурой. Commit:
```bash
git add download/atex/js/cut-planning.js templates/atex/cut-planning.html download/atex/css/cut-planning.css
git commit -m "feat(#52): cut-planning — РМ: форма, отчёт ходовых, подбор и отрисовка полос"
```

---

## Task 4: Сохранение как «Тип резки» + запрет дублей

**Files:**
- Modify: `download/atex/js/cut-planning.js`

- [ ] **Step 1: Дедуп-проверка перед сохранением**

Загрузить существующие «Тип резки» выбранного сырья и их полосы (`object/{Полоса}?F_U={typeId}`), построить множество сигнатур `calc.combinationSignature(materialId, strips)`. Функция `findDuplicateCutType(materialId, strips)` → id/имя дубля или null.

- [ ] **Step 2: Сохранение типа + полос**

«Сохранить как тип резки»: если `findDuplicateCutType` вернул дубль — показать модалку «такая комбинация уже есть: <имя>», НЕ сохранять. Иначе — создать «Тип резки» (`_m_new/{Тип резки}?JSON&up=1&full=1` с Вид сырья, Ширина входа, имя) и полосы (`_m_new/{Полоса}?up={cutId}` ширина/кол-во/назначение) — по паттерну `cut-calc.js` `save`/`syncStrips`. После — обновить `loadCutTypes`.

- [ ] **Step 3: Ручная проверка + commit**

Ядро-тесты PASS. Commit:
```bash
git add download/atex/js/cut-planning.js
git commit -m "feat(#52): cut-planning — сохранение комбинации как тип резки с запретом дублей"
```

---

## Task 5: Меню, документация, полный прогон

**Files:**
- Modify: `docs/atex_menu.json`, `docs/atex_workplaces.md`

- [ ] **Step 1: Пункт меню**

В `docs/atex_menu.json` добавить пункт «Расчёт резки» (`href: cut-planning`, иконка напр. `pi pi-sliders-h`) ролям **Диспетчер** и **Администратор** (рядом с «Калькулятор типов резки»).

- [ ] **Step 2: Описание РМ**

В `docs/atex_workplaces.md` добавить раздел «Расчёт резки» (Диспетчер): вход (сырьё+целевая ширина), подбор (min отход ≤ допуска, добор ходовыми из отчёта `preferable_widths`), сохранение как тип резки с запретом дублей. Факты, стиль repo.

- [ ] **Step 3: Полный прогон тестов atex**

```bash
node experiments/atex-cut-planning.test.js
node experiments/atex-cut-calc.test.js
node experiments/test-issue-2911-atex-orders.js
```
Expected: все PASS (cut-calc — регрессия, не сломан).

- [ ] **Step 4: Commit**

```bash
git add docs/atex_menu.json docs/atex_workplaces.md
git commit -m "docs(#52): cut-planning — пункт меню и описание РМ «Расчёт резки»"
```

---

## Деплой (вне автоматизации — Андрей)
- Клиентский код РМ → atex→ateh через `update.php` (маска уже деплоит js/css/templates).
- Пункт меню «Расчёт резки» применить ролям (как остальные пункты atex_menu).
- Отчёт `preferable_widths` уже создан в live ateh (Task 1).

## Self-review заметки
- Покрытие спеки: отчёт ходовых — Task 1; подбор+сигнатура (ядро) — Task 2; форма+отчёт+подбор — Task 3; сохранение+дедуп — Task 4; меню/доки — Task 5.
- Имена согласованы: `suggestCombination`/`bestFill`/`combinationSignature`/`usedWidth`/`remainder` (ядро); `loadPreferredWidths`/`findDuplicateCutType`/`loadCutTypes` (контроллер); отчёт `preferable_widths`, колонки `position_width_mm`/`position_material_id`/`position_qty_sum`.
- DOM-слой (Task 3-4) не тестируется в node — проверяется чтением/фикстурой; ядро и регрессия — node-тестами (явно отмечено).
- Task 1 — живая мутация ateh, идемпотентна (проверка существования отчёта перед созданием).
