        render() {
            if (this._destroyed) return;

            // Guard against missing container
            if (!this.container) {
                console.error('Cannot render: container element not found');
                return;
            }

            // Preserve focus state before re-rendering
            const focusedElement = document.activeElement;
            let focusState = null;

            // #4373: the REF dropdown trigger is a filter control too — a re-render (say, the
            // reload that follows picking an operator) must not drop the caret it just received.
            const isRefTrigger = focusedElement && focusedElement.classList.contains('filter-ref-trigger');
            if (focusedElement && (focusedElement.classList.contains('filter-input-with-icon') || isRefTrigger)) {
                focusState = {
                    columnId: focusedElement.dataset.columnId,
                    // Range cells have two inputs sharing a columnId — remember which one (issue #3542)
                    rangePart: focusedElement.dataset.rangePart || null,
                    refTrigger: isRefTrigger,
                    selectionStart: isRefTrigger ? null : focusedElement.selectionStart,
                    selectionEnd: isRefTrigger ? null : focusedElement.selectionEnd
                };
            }

            const orderedColumns = this.columnOrder
                .map(id => this.columns.find(c => c.id === id))
                .filter(c => c && this.visibleColumns.includes(c.id));

            const instanceName = this.options.instanceName;

            let html = `
                <div class="integram-table-wrapper">
                    <div class="integram-table-header">
                        ${ this.renderTitleHtml() }
                        <div class="integram-table-controls">
                            <div class="integram-table-ajax-spinner${ (this.pendingRequests || 0) > 0 ? ' active' : '' }" title="Ожидание ответа от сервера">
                                <i class="pi pi-spin pi-spinner"></i>
                                <span class="integram-table-ajax-spinner-counter">${ (this.pendingRequests || 0) > 1 ? `(${ this.pendingRequests })` : '' }</span>
                            </div>
                            <button type="button" class="integram-table-settings integram-table-settings-refresh" onclick="window.${ instanceName }.refreshData()" title="Обновить" aria-label="Обновить">
                                <i class="pi pi-refresh"></i>
                            </button>
                            ${ this.groupingEnabled ? `
                            <button type="button" class="integram-table-settings" onclick="window.${ instanceName }.clearGrouping()" title="Очистить группировку" aria-label="Очистить группировку">
                                <i class="pi pi-undo"></i>
                                ${ !this.settings.hideMenuButtonLabels ? '<span class="btn-label">очистить</span>' : '' }
                            </button>
                            ` : '' }
                            <button type="button" class="integram-table-settings${ this.groupingEnabled ? ' active' : '' }" onclick="window.${ instanceName }.openGroupingSettings()" title="Группы" aria-label="Настроить группировку" aria-pressed="${ this.groupingEnabled ? 'true' : 'false' }">
                                <i class="pi pi-objects-column"></i>
                                ${ !this.settings.hideMenuButtonLabels ? '<span class="btn-label">группы</span>' : '' }
                            </button>
                            ${ this.hasActiveFilters() ? `
                            <button type="button" class="integram-table-settings" onclick="window.${ instanceName }.clearAllFilters()" title="Очистить фильтры" aria-label="Очистить фильтры">
                                <i class="pi pi-filter-slash"></i>
                                ${ !this.settings.hideMenuButtonLabels ? '<span class="btn-label">очистить</span>' : '' }
                            </button>
                            ` : '' }
                            <button type="button" class="integram-table-settings${ this.filtersEnabled ? ' active' : '' }" onclick="window.${ instanceName }.toggleFilters()" title="Фильтры" aria-label="Показать фильтры" aria-pressed="${ this.filtersEnabled ? 'true' : 'false' }">
                                <i class="pi pi-filter"></i>
                                ${ !this.settings.hideMenuButtonLabels ? '<span class="btn-label">фильтры</span>' : '' }
                            </button>
                            ${ this.isExportAllowed() ? `
                            <div class="integram-table-export-container">
                                <button type="button" class="integram-table-settings" onclick="window.${ instanceName }.toggleExportMenu(event)" title="Экспорт" aria-label="Экспортировать данные" aria-haspopup="menu" aria-expanded="false" aria-controls="${ instanceName }-export-menu">
                                    <i class="pi pi-download"></i>
                                    ${ !this.settings.hideMenuButtonLabels ? '<span class="btn-label">экспорт</span>' : '' }
                                </button>
                                <div class="integram-export-menu" id="${ instanceName }-export-menu" role="menu" aria-label="Варианты экспорта" style="display: none;">
                                    <button type="button" class="export-menu-item" role="menuitem" onclick="window.${ instanceName }.exportTable('xlsx')">
                                        <span class="export-icon"><i class="pi pi-file-excel"></i></span> XLSX (Excel)
                                    </button>
                                    <button type="button" class="export-menu-item" role="menuitem" onclick="window.${ instanceName }.exportTable('xls')">
                                        <span class="export-icon"><i class="pi pi-file-excel"></i></span> XLS (Excel 97-2003)
                                    </button>
                                    <button type="button" class="export-menu-item" role="menuitem" onclick="window.${ instanceName }.exportTable('csv')">
                                        <span class="export-icon"><i class="pi pi-file"></i></span> CSV
                                    </button>
                                    <button type="button" class="export-menu-item" role="menuitem" onclick="window.${ instanceName }.copyToBuffer()">
                                        <span class="export-icon"><i class="pi pi-copy"></i></span> В буфер
                                    </button>
                                </div>
                            </div>
                            ` : '' }
                            ${ this.checkboxMode && this.selectedRows.size > 0 && this.isTableWritable() ? `
                            <button type="button" class="btn btn-sm btn-danger integram-bulk-delete-btn" id="${ instanceName }-bulk-delete-btn" onclick="window.${ instanceName }.showBulkDeleteConfirm(event)">
                                Удалить (${ this.selectedRows.size })
                            </button>
                            ` : '' }
                            ${ this.isTableDeletable() && this.isTableWritable() ? `
                            <button type="button" class="integram-table-settings integram-table-settings-filter-delete" onclick="window.${ instanceName }.showFilterDeleteConfirm(event)" title="Удалить записи, удовлетворяющие заданному фильтру" aria-label="Удалить записи, удовлетворяющие заданному фильтру">
                                <i class="pi pi-trash"></i>
                                ${ !this.settings.hideMenuButtonLabels ? '<span class="btn-label">Удалить</span>' : '' }
                            </button>
                            ` : '' }
                            <button type="button" class="integram-table-settings" onclick="window.${ instanceName }.copyConfigUrl()" title="Скопировать ссылку с текущими фильтрами и группами" aria-label="Скопировать ссылку с текущими фильтрами и группами">
                                <i class="pi pi-copy"></i>
                                ${ !this.settings.hideMenuButtonLabels ? '<span class="btn-label">ссылка</span>' : '' }
                            </button>
                            <button type="button" class="integram-table-settings" onclick="window.${ instanceName }.openTableSettings()" title="Настройка таблицы" aria-label="Настройка таблицы">
                                <i class="pi pi-cog"></i>
                                ${ !this.settings.hideMenuButtonLabels ? '<span class="btn-label">вид</span>' : '' }
                            </button>
                            <button type="button" class="integram-table-settings" onclick="window.${ instanceName }.openColumnSettings()" title="Настройка колонок" aria-label="Настройка колонок">
                                <i class="pi pi-th-large"></i>
                                ${ !this.settings.hideMenuButtonLabels ? '<span class="btn-label">колонки</span>' : '' }
                            </button>
                        </div>
                    </div>
                    ${ this.renderHiddenFilterBadges() }
                    <div class="integram-table-container">
                        <table class="integram-table${ this.settings.compact ? ' compact' : '' }" aria-label="${ this.escapeHtml(this.options.title || 'Данные') }">
                        <thead>
                            ${ (() => {
                                // Smart header grouping (issue #1540, #1624)
                                // Works in both normal mode and left-grouping mode.
                                // In left-grouping mode, grouping columns are placed first (same reordering as renderGroupedHeaders).
                                const isLeftGrouping = this.groupingEnabled && this.groupingColumns.length > 0;
                                const groupingColumnSet = isLeftGrouping ? new Set(this.groupingColumns) : null;

                                // In left-grouping mode, reorder columns: grouping cols first, then non-grouping
                                const headerColumns = isLeftGrouping
                                    ? [
                                        ...this.groupingColumns
                                            .map(colId => this.columns.find(c => c.id === colId))
                                            .filter(col => col && this.visibleColumns.includes(col.id)),
                                        ...orderedColumns.filter(col => !groupingColumnSet.has(col.id))
                                      ]
                                    : orderedColumns;

                                const smartTree = this.buildSmartHeaderTree(headerColumns);
                                const smartDepth = this.smartHeaderTreeDepth(smartTree);
                                const hasSmartGroups = smartDepth > 1;

                                if (hasSmartGroups) {
                                    // Multi-row smart header
                                    const rowsOfCells = this.renderSmartHeaderRows(smartTree, smartDepth, 0, instanceName, groupingColumnSet);
                                    const checkboxHtml = this.checkboxMode
                                        ? `<th class="checkbox-column-header" rowspan="${ smartDepth }"><input type="checkbox" class="row-select-all" title="Выбрать все" ${ this.areAllSelectableRowsSelected() ? 'checked' : '' }></th>`
                                        : '';
                                    const addColHtml = this.isStructureWritable()
                                        ? `<th class="add-column-header-cell" rowspan="${ smartDepth }" style="width: 36px; min-width: 36px;"><button type="button" class="add-column-header-button" title="Добавить колонку" aria-label="Добавить колонку" onclick="window.${ instanceName }.quickAddColumn()"><i class="pi pi-plus" aria-hidden="true"></i></button></th>`
                                        : '';
                                    return rowsOfCells.map((cells, rowIdx) => `
                                        <tr>
                                            ${ rowIdx === 0 ? checkboxHtml : '' }
                                            ${ cells.join('') }
                                            ${ rowIdx === 0 ? addColHtml : '' }
                                        </tr>
                                    `).join('') + (this.filtersEnabled ? `
                                    <tr class="filter-row">
                                        ${ this.checkboxMode ? '<td class="checkbox-column-filter"></td>' : '' }
                                        ${ isLeftGrouping
                                            ? this.renderGroupedFilterRow(orderedColumns)
                                            : headerColumns.map((col, idx) => this.renderFilterCell(col, idx)).join('') }
                                        <td class="add-column-filter-cell"></td>
                                    </tr>
                                    ` : '');
                                }

                                // Single-row header (original logic)
                                const singleRowCells = isLeftGrouping
                                    ? this.renderGroupedHeaders(orderedColumns, instanceName)
                                    : headerColumns.map(col => {
                                        const width = this.columnWidths[col.id];
                                        const widthStyle = width ? ` style="width: ${ width }px; min-width: ${ width }px;"` : '';
                                        const actionColumnId = this.normalizeNumericId(col.id);
                                        const addButtonHtml = this.shouldShowAddButton(col) && actionColumnId ?
                                            `<button class="column-add-btn" onclick="window.${ instanceName }.openColumnCreateForm('${ actionColumnId }')" title="Создать запись"><i class="pi pi-plus"></i></button>` : '';
                                        let sortIndicator = '';
                                        if (this.sortColumn === col.id) {
                                            sortIndicator = this.sortDirection === 'asc' ? '<i class="pi pi-sort-amount-up-alt" style="font-size:0.75em;"></i> ' : '<i class="pi pi-sort-amount-down" style="font-size:0.75em;"></i> ';
                                        }
                                        const refTypeId = this.normalizeNumericId(col.ref);
                                        const refIconHtml = refTypeId ? (() => {
                                            const dbName = window.db || window.location.pathname.split('/')[1];
                                            return `<a class="column-ref-link" href="/${dbName}/table/${refTypeId}" target="_blank" rel="noopener noreferrer" title="Открыть справочник в новой вкладке" onclick="event.stopPropagation()"><i class="pi pi-external-link"></i></a>`;
                                        })() : '';
                                        return `
                                            <th data-column-id="${ this.escapeHtml(col.id) }" title="${ this.escapeHtml(col.id) }"${ widthStyle }>
                                                <button type="button" class="column-drag-handle" draggable="true" data-column-id="${ this.escapeHtml(col.id) }" title="Перетащите для изменения порядка" aria-label="Переместить столбец ${ this.escapeHtml(col.name) }. Используйте стрелки влево и вправо"><i class="pi pi-bars" aria-hidden="true"></i></button>
                                                <button type="button" class="column-header-content" data-column-id="${ this.escapeHtml(col.id) }" title="${ this.escapeHtml(col.id) }" style="${ this.settings.wrapHeaders ? 'white-space: normal;' : '' }" aria-label="Сортировать по столбцу ${ this.escapeHtml(col.name) }">${ sortIndicator }${ this.escapeHtml(col.name) }</button>
                                                ${ refIconHtml }
                                                ${ addButtonHtml }
                                                <div class="column-resize-handle" data-column-id="${ this.escapeHtml(col.id) }"></div>
                                            </th>
                                        `;
                                    }).join('');

                                return `
                                    <tr>
                                        ${ this.checkboxMode ? `<th class="checkbox-column-header"><input type="checkbox" class="row-select-all" title="Выбрать все" ${ this.areAllSelectableRowsSelected() ? 'checked' : '' }></th>` : '' }
                                        ${ singleRowCells }
                                        ${ this.settings.showReferences && (this.objectTableId || this.options.tableTypeId) ? `<th class="references-column-header" title="Таблицы, где эта таблица используется как справочник">Связи</th>` : '' }
                                        ${ this.isStructureWritable() ? `<th class="add-column-header-cell" style="width: 36px; min-width: 36px;"><button type="button" class="add-column-header-button" title="Добавить колонку" aria-label="Добавить колонку" onclick="window.${ instanceName }.quickAddColumn()"><i class="pi pi-plus" aria-hidden="true"></i></button></th>` : '' }
                                    </tr>
                                    ${ this.filtersEnabled ? `
                                    <tr class="filter-row">
                                        ${ this.checkboxMode ? '<td class="checkbox-column-filter"></td>' : '' }
                                        ${ isLeftGrouping ?
                                            this.renderGroupedFilterRow(orderedColumns) :
                                            headerColumns.map((col, idx) => this.renderFilterCell(col, idx)).join('')
                                        }
                                        ${ this.settings.showReferences && (this.objectTableId || this.options.tableTypeId) ? '<td class="references-column-filter"></td>' : '' }
                                        <td class="add-column-filter-cell"></td>
                                    </tr>
                                    ` : '' }
                                `;
                            })() }
                        </thead>
                        <tbody>
                            ${ this.groupingEnabled && this.groupedData.length > 0 ?
                                this.renderGroupedRows(orderedColumns, instanceName) :
                                this.data.length > 0 ? this.data.map((row, rowIndex) => `
                                    <tr class="${ this.isRowSelected(rowIndex) ? 'row-selected' : '' }">
                                        ${ this.checkboxMode ? `<td class="checkbox-column-cell"><input type="checkbox" class="row-select-checkbox" data-row-index="${ rowIndex }" ${ this.isRowSelected(rowIndex) ? 'checked' : '' }></td>` : '' }
                                        ${ orderedColumns.map((col, colIndex) => {
                                            const cellValue = row[this.columns.indexOf(col)];
                                            return this.renderCell(col, cellValue, rowIndex, colIndex);
                                        }).join('') }
                                        ${ this.settings.showReferences && (this.objectTableId || this.options.tableTypeId) ? this.renderReferencesCell(rowIndex) : '' }
                                    </tr>
                                `).join('') : `
                                    <tr class="integram-table-empty-row">
                                        <td colspan="${ Math.max(1, orderedColumns.length + (this.checkboxMode ? 1 : 0) + (this.settings.showReferences && (this.objectTableId || this.options.tableTypeId) ? 1 : 0) + (this.isStructureWritable() ? 1 : 0)) }">
                                            <div class="integram-table-empty-state" role="status">
                                                <i class="pi ${ (this.pendingRequests || 0) > 0 ? 'pi-spin pi-spinner' : 'pi-inbox' }" aria-hidden="true"></i>
                                                <span>${ (this.pendingRequests || 0) > 0 ? 'Загружаем данные…' : 'Записей пока нет' }</span>
                                                <small>${ (this.pendingRequests || 0) > 0 ? 'Это займёт несколько секунд' : (this.hasActiveFilters() ? 'Попробуйте изменить или очистить фильтры' : 'Новые записи появятся здесь') }</small>
                                            </div>
                                        </td>
                                    </tr>
                                `
                            }
                        </tbody>
                        </table>
                    </div>
                    ${ this.renderScrollCounter() }
                </div>
                <div class="integram-table-sticky-scrollbar" id="${ this.container.id }-sticky-scrollbar">
                    <div class="integram-table-sticky-scrollbar-content"></div>
                </div>
            `;

            this.container.innerHTML = html;

            // Update document.title and .navbar-workspace with table title (issue #1223)
            if (this.options.title && !window._integramModalDepth) {
                const navbarWorkspace = document.querySelector('.navbar-workspace');
                const truncatedTitle = this.options.title.length > 32 ? this.options.title.slice(0, 32) + '...' : this.options.title;
                if (navbarWorkspace) navbarWorkspace.textContent = truncatedTitle;
                document.title = truncatedTitle;
            }

            this.attachEventListeners();
            this.attachScrollListener();
            this.attachPlusKeyShortcut();
            this.attachStickyScrollbar();
            this.attachColumnResizeHandlers();
            this.attachScrollCounterPositioning();
            this.updateFilterRowStickyTop();
            this.updateContainerHeight();
            this.attachContainerHeightObserver();

            // Load reference field filter options asynchronously for REF-format columns (issue #795)
            if (this.filtersEnabled) {
                this.loadRefFilterOptions();
            }

            // Restore focus state after re-rendering.
            // preventScroll: true keeps the browser from auto-scrolling the filter input
            // into view, which would otherwise reset the table's horizontal scroll
            // position when a filter input lives outside the visible scroll viewport
            // (issue #2744).
            if (focusState) {
                let selector = `.filter-input-with-icon[data-column-id="${focusState.columnId}"]`;
                if (focusState.rangePart) {
                    selector = `.filter-range-input[data-column-id="${focusState.columnId}"][data-range-part="${focusState.rangePart}"]`;
                } else if (focusState.refTrigger) {
                    selector = `.filter-ref-trigger[data-column-id="${focusState.columnId}"]`;
                }
                const newInput = this.container.querySelector(selector);
                if (newInput) {
                    newInput.focus({ preventScroll: true });
                    // Restore cursor position (only for text inputs, not date pickers)
                    if (focusState.selectionStart !== null && focusState.selectionEnd !== null &&
                        newInput.type === 'text') {
                        newInput.setSelectionRange(focusState.selectionStart, focusState.selectionEnd);
                    }
                }
            }
        }

        renderFilterCell(column, columnIndex = 0) {
            const format = column.format || 'SHORT';
            const currentFilter = this.filters[column.id] || { type: this.getDefaultFilterType(format), value: '' };
            const placeholder = columnIndex === 0 ? 'Фильтр...' : '';
            // Use displayValue (resolved text label) when available, otherwise use raw value (issue #551)
            const displayValue = currentFilter.displayValue !== undefined ? currentFilter.displayValue : currentFilter.value;

            // For REF format columns (reference/lookup fields), render either:
            // - A text input for text-based filter types (~, ^, !) (issue #799)
            // - A dropdown trigger button for dropdown-based filter types (=, (,)) (issue #795, #797)
            if (format === 'REF') {
                // Check if current filter type is text-based (issue #799)
                const isTextBasedFilter = this.refTextFilterTypes.has(currentFilter.type);

                if (isTextBasedFilter) {
                    // Render text input for text-based filters (issue #799)
                    return `
                        <td>
                            <div class="filter-cell-wrapper">
                                <button type="button" class="filter-icon-inside" data-column-id="${ this.escapeHtml(column.id) }" title="Изменить условие фильтра" aria-label="Условие фильтра: ${ currentFilter.type }. Изменить">
                                    ${ currentFilter.type }
                                </button>
                                <input type="text"
                                       class="filter-input-with-icon filter-ref-text-input"
                                       data-column-id="${ this.escapeHtml(column.id) }"
                                       value="${ this.escapeHtml(displayValue) }"
                                       placeholder="${ placeholder }"
                                       autocomplete="off">
                            </div>
                        </td>
                    `;
                }

                // Parse currently selected IDs from filter value for dropdown mode
                // Single: '@145' → selectedIds = {'145'}
                // Multi:  '@IN(145,146)' → selectedIds = {'145', '146'}
                const selectedIds = new Set();
                if (currentFilter.value && currentFilter.type !== '%' && currentFilter.type !== '!%') {
                    const rawVal = currentFilter.value;
                    const inMatch = rawVal.match(/^@IN\((.+)\)$/);
                    if (inMatch) {
                        // Multiple IDs: @IN(id1,id2,...)
                        inMatch[1].split(',').forEach(id => {
                            const trimmed = id.trim();
                            if (trimmed) selectedIds.add(trimmed);
                        });
                    } else if (rawVal.startsWith('@')) {
                        // Single ID: @id
                        const id = rawVal.substring(1);
                        if (id) selectedIds.add(id);
                    }
                }
                // Build display text from cached options or show count
                const cachedOptions = this.refOptionsCache[column.id] || [];
                let displayText = '';
                if (selectedIds.size > 0) {
                    const selectedTexts = cachedOptions
                        .filter(([id]) => selectedIds.has(String(id)))
                        .map(([, text]) => text);
                    if (selectedTexts.length > 0) {
                        displayText = selectedTexts.length > 2
                            ? `${selectedTexts.length} выбрано`
                            : selectedTexts.join(', ');
                    } else {
                        // IDs are selected but not found in cache yet
                        displayText = `${selectedIds.size} выбрано`;
                    }
                }
                const escapedDisplayText = displayText.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                return `
                    <td>
                        <div class="filter-cell-wrapper">
                            <button type="button" class="filter-icon-inside" data-column-id="${ this.escapeHtml(column.id) }" title="Изменить условие фильтра" aria-label="Условие фильтра: ${ currentFilter.type }. Изменить">
                                    ${ currentFilter.type }
                                </button>
                            <button type="button"
                                    class="filter-ref-trigger"
                                    data-column-id="${ this.escapeHtml(column.id) }"
                                    data-selected-ids="${ this.escapeHtml(Array.from(selectedIds).join(',')) }"
                                    title="${ escapedDisplayText || 'Выбрать значение...' }">
                                <span class="filter-ref-trigger-text${ escapedDisplayText ? '' : ' filter-ref-trigger-text--placeholder' }">${ escapedDisplayText || 'Выбрать...' }</span>
                                <span class="filter-ref-trigger-arrow">▼</span>
                            </button>
                        </div>
                    </td>
                `;
            }

            // For DATE/DATETIME formats with value-based filter types, render a date/datetime picker (issue #1008)
            // Filter types that need a date picker: =, ≥, ≤, >, < (not %, !%, or ...) — see filterInputKind.
            const dateFormats = ['DATE', 'DATETIME'];
            if (this.filterInputKind(format, currentFilter.type) === 'date-picker') {
                const isDateTime = format === 'DATETIME';
                const inputType = isDateTime ? 'datetime-local' : 'date';
                // Convert stored display value (DD.MM.YYYY or DD.MM.YYYY HH:MM:SS) to HTML5 format
                const html5Value = displayValue ? this.formatDateForHtml5(displayValue, isDateTime) : '';
                return `
                    <td>
                        <div class="filter-cell-wrapper">
                            <button type="button" class="filter-icon-inside" data-column-id="${ this.escapeHtml(column.id) }" title="Изменить условие фильтра" aria-label="Условие фильтра: ${ currentFilter.type }. Изменить">
                                    ${ currentFilter.type }
                                </button>
                            <input type="${ inputType }"
                                   class="filter-input-with-icon filter-date-picker"
                                   data-column-id="${ this.escapeHtml(column.id) }"
                                   data-is-datetime="${ isDateTime ? '1' : '0' }"
                                   value="${ html5Value }">
                        </div>
                    </td>
                `;
            }

            // Range filter ('...'): two separate from/to fields instead of one comma-separated
            // input — the comma syntax was unclear (issue #3542). Stored value stays "from,to".
            if (this.filterInputKind(format, currentFilter.type) === 'range') {
                const isDate = dateFormats.includes(format);
                const isDateTime = format === 'DATETIME';
                let inputType = 'text';
                if (isDate) inputType = isDateTime ? 'datetime-local' : 'date';
                else if (format === 'NUMBER' || format === 'SIGNED') inputType = 'number';

                const parts = (currentFilter.value || '').split(',');
                const rawFrom = (parts[0] || '').trim();
                const rawTo = (parts[1] || '').trim();
                const fromVal = isDate ? (rawFrom ? this.formatDateForHtml5(rawFrom, isDateTime) : '') : rawFrom;
                const toVal = isDate ? (rawTo ? this.formatDateForHtml5(rawTo, isDateTime) : '') : rawTo;
                const dtAttr = isDate ? ` data-is-datetime="${ isDateTime ? '1' : '0' }"` : '';
                const escAttr = v => String(v).replace(/"/g, '&quot;');

                return `
                    <td>
                        <div class="filter-cell-wrapper filter-range-wrapper">
                            <button type="button" class="filter-icon-inside" data-column-id="${ this.escapeHtml(column.id) }" title="Изменить условие фильтра" aria-label="Условие фильтра: ${ currentFilter.type }. Изменить">
                                    ${ currentFilter.type }
                                </button>
                            <input type="${ inputType }"
                                   class="filter-input-with-icon filter-range-input"
                                   data-column-id="${ this.escapeHtml(column.id) }"
                                   data-range-part="from"${ dtAttr }
                                   value="${ escAttr(fromVal) }"
                                   placeholder="от"
                                   autocomplete="off">
                            <span class="filter-range-sep">—</span>
                            <input type="${ inputType }"
                                   class="filter-input-with-icon filter-range-input"
                                   data-column-id="${ this.escapeHtml(column.id) }"
                                   data-range-part="to"${ dtAttr }
                                   value="${ escAttr(toVal) }"
                                   placeholder="до"
                                   autocomplete="off">
                        </div>
                    </td>
                `;
            }

            return `
                <td>
                    <div class="filter-cell-wrapper">
                        <button type="button" class="filter-icon-inside" data-column-id="${ this.escapeHtml(column.id) }" title="Изменить условие фильтра" aria-label="Условие фильтра: ${ currentFilter.type }. Изменить">
                                    ${ currentFilter.type }
                                </button>
                        <input type="text"
                               class="filter-input-with-icon"
                               data-column-id="${ this.escapeHtml(column.id) }"
                               value="${ this.escapeHtml(displayValue) }"
                               placeholder="${ placeholder }"
                               autocomplete="off">
                    </div>
                </td>
            `;
        }

        // Helper method to parse Unix or JS timestamp (seconds or milliseconds) from a string
        // Returns a Date object if value looks like a numeric timestamp, otherwise null.
        // Supports: integer seconds (e.g. "1773313083"), float seconds (e.g. "1773313083.4489"),
        // and milliseconds (e.g. "1773313083000").
