# integram-table.js Modular Split — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Разбить монолитный `js/integram-table.js` (15 701 строка) на 26 модулей в папке `js/integram-table/`, добавить `build.sh` для сборки, защитить сгенерированный файл от прямого редактирования.

**Architecture:** Файлы в `js/integram-table/` содержат фрагменты класса `IntegramTable` (метод-группы без обёртки `class`) и склеиваются по алфавитному порядку скриптом `build.sh`. Результирующий `js/integram-table.js` идентичен оригиналу (кроме первой строки с авто-генерированным предупреждением). HTML-файлы не меняются.

**Tech Stack:** Python 3 (одноразовый split-скрипт), bash (build.sh), plain JS (без сборщиков)

---

## Файловая структура после выполнения плана

```
js/integram-table/
  00-class-open.js           L1–16     (JSDoc header + class IntegramTable{)
  01-core.js                 L17–734   (constructor, init, renderTitle…)
  02-format-helpers.js       L735–1076 (isObjectFormat, isJsonDataArrayFormat)
  03-filters-core.js         L1077–1177 (getDefaultFilterType, applyFilter, processColumnVisibility)
  04-render-table.js         L1178–1497 (render, renderFilterCell)
  05-date-utils.js           L1498–1624 (parseUnixTimestamp, parseDDMMYYYY…)
  06-render-cell.js          L1625–2280 (renderCell, renderGroupedRows…)
  07-inline-edit.js          L2281–4841 (addNewRow, renderInlineEditor…)
  08-navigation.js           L4842–4969 (getEditableCells, findNextEditableCell…)
  09-scroll-layout.js        L4970–5176 (attachScrollListener, attachStickyScrollbar…)
  10-filter-ui.js            L5177–5351 (showFilterTypeMenu, reorderColumns)
  11-column-settings.js      L5352–6569 (getColTypeIcon, openColumnSettings…)
  12-table-settings.js       L6570–6818 (openTableSettings, resetSettings…)
  13-grouping.js             L6819–7130 (openGroupingSettings, processGroupedData)
  14-url-config.js           L7131–7805 (hasActiveFilters, getConfigUrl, loadConfigFromUrl…)
  15-sort.js                 L7806–7838 (toggleSort)
  16-state.js                L7839–8426 (reload, saveColumnState, loadSettings…)
  17-ref-filter.js           L8427–8727 (openRefFilterDropdown, handleRefFilterSelection…)
  18-data-source.js          L8728–8902 (getApiBase, getPageUrlParams, normalizeFormat)
  19-form-edit.js            L8903–10042 (renderEditFormModal, renderAttributesForm…)
  20-form-create.js          L10043–11405 (renderSubordinateCreateForm, renderFormReferenceOptions…)
  21-form-field-settings.js  L11406–12162 (openFormFieldSettings, applyFormFieldSettings…)
  22-utils.js                L12163–12627 (escapeHtml, showToast, sanitizeWarningHtml…)
  23-bulk-export.js          L12628–13299 (toggleCheckboxMode, exportToCSV, downloadBlob + class close })
  24-global-functions.js     L13300–13464 (global registry + reloadAllIntegramTables + глобальные хелперы)
  25-create-form-helper.js   L13465–15701 (class IntegramCreateFormHelper + autoInitTables + module.exports)

tools/split-integram-table.py    ← одноразовый split-скрипт (оставить в репо для истории)
build.sh                         ← сборка: cat js/integram-table/*.js → js/integram-table.js
js/integram-table.js             ← генерируется, коммитится
CLAUDE.md                        ← добавить предупреждение о сгенерированном файле
```

---

## Task 1: Создать и запустить split-скрипт

**Files:**
- Create: `tools/split-integram-table.py`

- [ ] **Step 1: Создать `tools/split-integram-table.py`**

```python
#!/usr/bin/env python3
"""One-time script: split js/integram-table.js into modules in js/integram-table/."""

import os

SRC = 'js/integram-table.js'
OUT_DIR = 'js/integram-table'

# (name, start_line, end_line) — 1-indexed, inclusive
MODULES = [
    ('00-class-open',          1,     16),
    ('01-core',                17,    734),
    ('02-format-helpers',      735,   1076),
    ('03-filters-core',        1077,  1177),
    ('04-render-table',        1178,  1497),
    ('05-date-utils',          1498,  1624),
    ('06-render-cell',         1625,  2280),
    ('07-inline-edit',         2281,  4841),
    ('08-navigation',          4842,  4969),
    ('09-scroll-layout',       4970,  5176),
    ('10-filter-ui',           5177,  5351),
    ('11-column-settings',     5352,  6569),
    ('12-table-settings',      6570,  6818),
    ('13-grouping',            6819,  7130),
    ('14-url-config',          7131,  7805),
    ('15-sort',                7806,  7838),
    ('16-state',               7839,  8426),
    ('17-ref-filter',          8427,  8727),
    ('18-data-source',         8728,  8902),
    ('19-form-edit',           8903,  10042),
    ('20-form-create',         10043, 11405),
    ('21-form-field-settings', 11406, 12162),
    ('22-utils',               12163, 12627),
    ('23-bulk-export',         12628, 13299),
    ('24-global-functions',    13300, 13464),
    ('25-create-form-helper',  13465, 15701),
]

def main():
    with open(SRC, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    total = len(lines)
    print(f'Source: {SRC} — {total} lines')

    os.makedirs(OUT_DIR, exist_ok=True)

    covered = 0
    for name, start, end in MODULES:
        path = os.path.join(OUT_DIR, f'{name}.js')
        chunk = lines[start - 1:end]   # convert 1-indexed to 0-indexed
        with open(path, 'w', encoding='utf-8') as f:
            f.writelines(chunk)
        covered += len(chunk)
        print(f'  {path}: {len(chunk)} lines  (L{start}–L{end})')

    print(f'\nTotal lines written: {covered}')
    if covered != total:
        print(f'ERROR: {total - covered} lines not covered! Check MODULES config.')
        raise SystemExit(1)
    else:
        print('OK: all lines covered')

if __name__ == '__main__':
    main()
```

- [ ] **Step 2: Запустить скрипт из корня проекта**

```bash
python3 tools/split-integram-table.py
```

Ожидаемый вывод:
```
Source: js/integram-table.js — 15701 lines
  js/integram-table/00-class-open.js: 16 lines  (L1–L16)
  js/integram-table/01-core.js: 718 lines  (L17–L734)
  ...
  js/integram-table/25-create-form-helper.js: 2237 lines  (L13465–L15701)

Total lines written: 15701
OK: all lines covered
```

- [ ] **Step 3: Проверить что создано 26 файлов**

```bash
ls js/integram-table/ | wc -l
```

Ожидаемый вывод: `26`

- [ ] **Step 4: Коммит split-скрипта и модулей**

```bash
git add tools/split-integram-table.py js/integram-table/
git commit -m "refactor: split integram-table.js into 26 source modules"
```

---

## Task 2: Создать build.sh и верифицировать сборку

**Files:**
- Create: `build.sh`
- Modify: `js/integram-table.js` (добавляется header-строка)

- [ ] **Step 1: Создать `build.sh`**

```bash
#!/bin/bash
# Собирает js/integram-table.js из модулей в js/integram-table/
# Запускать из корня проекта: bash build.sh
set -e
echo "// AUTO-GENERATED — DO NOT EDIT. Edit files in js/integram-table/ and run: bash build.sh" > js/integram-table.js
cat js/integram-table/*.js >> js/integram-table.js
echo "Built js/integram-table.js ($(wc -l < js/integram-table.js) lines)"
```

Создать файл:
```bash
cat > build.sh << 'EOF'
#!/bin/bash
# Собирает js/integram-table.js из модулей в js/integram-table/
# Запускать из корня проекта: bash build.sh
set -e
echo "// AUTO-GENERATED — DO NOT EDIT. Edit files in js/integram-table/ and run: bash build.sh" > js/integram-table.js
cat js/integram-table/*.js >> js/integram-table.js
echo "Built js/integram-table.js ($(wc -l < js/integram-table.js) lines)"
EOF
chmod +x build.sh
```

- [ ] **Step 2: Запустить build.sh**

```bash
bash build.sh
```

Ожидаемый вывод:
```
Built js/integram-table.js (15702 lines)
```

(15702 = 15701 оригинальных + 1 строка AUTO-GENERATED)

- [ ] **Step 3: Верифицировать идентичность с оригиналом**

Сравнить сгенерированный файл (без первой строки) с оригинальным содержимым модулей:

```bash
# Содержимое модулей без header должно совпадать с оригиналом
diff <(tail -n +2 js/integram-table.js) <(cat js/integram-table/*.js)
```

Ожидаемый вывод: **пустой** (diff не выводит ничего — файлы идентичны)

Если diff показывает различия — вернуться к Task 1 и проверить диапазоны строк в `tools/split-integram-table.py`.

- [ ] **Step 4: Проверить синтаксис JS (если установлен node)**

```bash
node --check js/integram-table.js && echo "Syntax OK"
```

Ожидаемый вывод: `Syntax OK`

Если node не установлен — пропустить этот шаг.

- [ ] **Step 5: Коммит build.sh и обновлённого integram-table.js**

```bash
git add build.sh js/integram-table.js
git commit -m "build: add build.sh and regenerate integram-table.js with auto-generated header"
```

---

## Task 3: Обновить CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Добавить секцию в начало CLAUDE.md**

Открыть `CLAUDE.md` и добавить в самое начало файла (до первой строки):

```markdown
## integram-table.js — ВАЖНО

`js/integram-table.js` генерируется автоматически. **НИКОГДА не редактировать напрямую.**

- Исходники: `js/integram-table/*.js` (26 модулей)
- Сборка: `bash build.sh` из корня проекта
- После редактирования модуля — запустить build.sh и закоммитить оба: модуль + `js/integram-table.js`

---

```

- [ ] **Step 2: Коммит CLAUDE.md**

```bash
git add CLAUDE.md
git commit -m "docs: add build instructions to CLAUDE.md to prevent direct edits of integram-table.js"
```

---

## Быстрая проверка результата

После выполнения всех задач убедиться:

```bash
# 26 модулей в папке
ls js/integram-table/ | wc -l   # → 26

# build работает
bash build.sh                    # → Built js/integram-table.js (15702 lines)

# первая строка — предупреждение
head -1 js/integram-table.js    # → // AUTO-GENERATED...

# diff чистый
diff <(tail -n +2 js/integram-table.js) <(cat js/integram-table/*.js)  # → (пусто)
```
