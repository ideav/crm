# Design: Разбивка integram-table.js на модули

**Дата:** 2026-04-11
**Статус:** Approved

## Цель

Разбить монолитный `js/integram-table.js` (15 701 строка, 759 KB) на мелкие модули для улучшения качества работы Claude Code с issues. Файл слишком большой для надёжного чтения и редактирования в одном контексте.

## Архитектура

### Принцип конкатенации

`IntegramTable` — единственный класс в первых 13 464 строках. Модули содержат **только тела методов** (без обёртки `class`). Build-скрипт склеивает файлы по алфавитному порядку имён.

### Структура файлов

```
js/
  integram-table/              ← исходники (редактируются разработчиками)
    00-class-open.js           → class IntegramTable {
    01-core.js                 → constructor, init, mapTypeIdToFormat, isBaseType, renderTitleHtml, renderCheckboxToggleHtml
    02-render-table.js         → render, renderGroupedRows, renderGroupedHeaders, renderGroupedFilterRow, renderScrollCounter
    03-render-cell.js          → renderCell, renderFilterCell, isObjectFormat, isJsonDataArrayFormat
    04-date-utils.js           → parseUnixTimestamp, parseDDMMYYYY, parseDDMMYYYYHHMMSS, parseYYYYMMDD, formatDateDisplay, formatDateTimeDisplay
    05-inline-edit.js          → addNewRow, startNewRowEdit, startNewRowFirstColumnEdit, highlightNewRowRequiredCells, clearNewRowRequiredHighlights, extractCellValue, determineParentRecordId, highlightRequiredCells, clearRequiredCellHighlights, renderInlineEditor, renderReferenceOptions, filterReferenceOptions, renderCreateFormForReference, updateCellDisplay, cancelInlineEdit, cancelNewRow
    06-event-listeners.js      → attachEventListeners
    07-navigation.js           → getEditableCells, findNextEditableCell, findPreviousEditableCell, findCellAbove, findCellBelow, navigateToCell
    08-scroll-layout.js        → attachScrollListener, checkAndLoadMore, attachStickyScrollbar, attachScrollCounterPositioning, attachColumnResizeHandlers
    09-filters.js              → getDefaultFilterType, applyFilter, processColumnVisibility, showFilterTypeMenu, hasActiveFilters, hasActiveFiltersOrGroups, clearAllFilters, clearAllUrlFilters, removeUrlFilter, hasUrlFilters, getHiddenColumnFilters, renderHiddenFilterBadges, toggleFilters
    10-sort.js                 → toggleSort
    11-url-filters.js          → getConfigUrl, copyConfigUrl, fallbackCopyToClipboard, showCopyNotification, loadConfigFromUrl, parseUrlFiltersFromParams, resolveRefIdUrlFilters, parseFilterValue
    12-ref-filter.js           → updateRefFilterTriggerDisplay, openRefFilterDropdown, filterRefDropdownOptions, handleRefFilterSelection, closeRefFilterDropdown, parseJsonObjectAsArray, getMetadataName
    13-grouping.js             → openGroupingSettings, clearGrouping, processGroupedData, renderGroupedFilterRow (если дублируется — убрать из 02)
    14-column-settings.js      → quickAddColumn, openColumnSettings, showColumnEditForm, closeColumnSettings, showAddColumnForm, getColTypeIcon
    15-table-settings.js       → openTableSettings, closeTableSettings, resetSettings, showFullValue
    16-state.js                → reload, saveColumnState, loadColumnState, saveSettings, loadSettings, shouldShowAddButton, buildRefIdPrefillFromUrlFilters, shouldShowGroupedCellAddButton
    17-data-source.js          → getApiBase, getDataSourceType, getPageUrlParams, handleFilterOverride, appendPageUrlParams, parseAttrs, getFormatById, normalizeFormat
    18-form-edit.js            → renderEditFormModal, renderAttributesForm, attachTabHandlers, renderSubordinateTable, handleSubordinateSort, sortSubordinateRows, compareSubordinateValues, filterSubordinateRows, highlightSearchTerm, formatSubordinateCellValue
    19-form-create.js          → renderSubordinateCreateForm, renderFormReferenceOptions, renderCreateFormForFormReference
    20-form-attachments.js     → attachDatePickerHandlers, attachFormFileUploadHandlers, attachFileUploadHandlers
    21-form-field-settings.js  → openFormFieldSettings, saveFormFieldVisibility, loadFormFieldVisibility, saveFormFieldOrder, loadFormFieldOrder, applyFormFieldSettings, showDeleteConfirmModal, saveFormShowDelete, loadFormShowDelete
    22-utils.js                → roundToNearest5Minutes, formatDateForInput, formatDateForHtml5, convertHtml5DateToDisplay, escapeHtml, linkifyText, parseReferenceDisplayValue, showToast, copyRecordIdToClipboard, showWarningModal, showWarningsModal, sanitizeWarningHtml
    23-bulk-export.js          → toggleCheckboxMode, showBulkDeleteConfirm, toggleExportMenu, prepareExportDataFromRows, prepareExportData
    24-class-close.js          → }   ← закрывает class IntegramTable
    25-global-functions.js     → openCreateRecordForm(), openEditRecordForm(), DOMContentLoaded init
    26-create-form-helper.js   → class IntegramCreateFormHelper { ... }

  integram-table.js            ← генерируется build.sh, коммитится как раньше
```

### Build-скрипт

```bash
#!/bin/bash
# build.sh (в корне проекта)
set -e
cat js/integram-table/*.js > js/integram-table.js
echo "Built js/integram-table.js ($(wc -l < js/integram-table.js) lines)"
```

Запускается вручную перед коммитом: `bash build.sh`

## Ориентировочные размеры модулей

| Файл | Строк |
|------|-------|
| 05-inline-edit.js | ~1 800 |
| 18-form-edit.js | ~1 300 |
| 26-create-form-helper.js | ~2 200 |
| 06-event-listeners.js | ~350 |
| 09-filters.js | ~700 |
| 14-column-settings.js | ~700 |
| 21-form-field-settings.js | ~650 |
| 11-url-filters.js | ~500 |
| 19-form-create.js | ~500 |
| 23-bulk-export.js | ~400 |
| остальные | 100–350 |

`26-create-form-helper.js` (~2 200 строк) — уже отдельный самостоятельный класс, не дробится.

## Что НЕ меняется

- `js/integram-table.js` коммитится и подключается в html как прежде
- Никаких изменений в `crm/info.html`, `crm/kanban.html`, `templates/cards.html`
- Никаких npm-зависимостей

## Процесс разработки

1. Редактировать файлы в `js/integram-table/`
2. Запустить `bash build.sh`
3. Проверить результат в браузере
4. Коммитить и `js/integram-table/` и `js/integram-table.js`
