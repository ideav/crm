        render() {
            // Guard against missing container
            if (!this.container) {
                console.error('Cannot render: container element not found');
                return;
            }

            // Preserve focus state before re-rendering
            const focusedElement = document.activeElement;
            let focusState = null;

            if (focusedElement && focusedElement.classList.contains('filter-input-with-icon')) {
                focusState = {
                    columnId: focusedElement.dataset.columnId,
                    selectionStart: focusedElement.selectionStart,
                    selectionEnd: focusedElement.selectionEnd
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
                            <div class="integram-table-settings integram-table-settings-refresh" onclick="window.${ instanceName }.refreshData()" title="Обновить">
                                <i class="pi pi-refresh"></i>
                            </div>
                            ${ this.groupingEnabled ? `
                            <div class="integram-table-settings" onclick="window.${ instanceName }.clearGrouping()" title="Очистить группировку">
                                <i class="pi pi-undo"></i>
                                ${ !this.settings.hideMenuButtonLabels ? '<span class="btn-label">очистить</span>' : '' }
                            </div>
                            ` : '' }
                            <div class="integram-table-settings${ this.groupingEnabled ? ' active' : '' }" onclick="window.${ instanceName }.openGroupingSettings()" title="Группы">
                                <i class="pi pi-objects-column"></i>
                                ${ !this.settings.hideMenuButtonLabels ? '<span class="btn-label">группы</span>' : '' }
                            </div>
                            ${ this.hasActiveFilters() ? `
                            <div class="integram-table-settings" onclick="window.${ instanceName }.clearAllFilters()" title="Очистить фильтры">
                                <i class="pi pi-filter-slash"></i>
                                ${ !this.settings.hideMenuButtonLabels ? '<span class="btn-label">очистить</span>' : '' }
                            </div>
                            ` : '' }
                            <div class="integram-table-settings${ this.filtersEnabled ? ' active' : '' }" onclick="window.${ instanceName }.toggleFilters()" title="Фильтры">
                                <i class="pi pi-filter"></i>
                                ${ !this.settings.hideMenuButtonLabels ? '<span class="btn-label">фильтры</span>' : '' }
                            </div>
                            ${ this.isExportAllowed() ? `
                            <div class="integram-table-export-container">
                                <div class="integram-table-settings" onclick="window.${ instanceName }.toggleExportMenu(event)" title="Экспорт">
                                    <i class="pi pi-download"></i>
                                    ${ !this.settings.hideMenuButtonLabels ? '<span class="btn-label">экспорт</span>' : '' }
                                </div>
                                <div class="integram-export-menu" id="${ instanceName }-export-menu" style="display: none;">
                                    <div class="export-menu-item" onclick="window.${ instanceName }.exportTable('xlsx')">
                                        <span class="export-icon"><i class="pi pi-file-excel"></i></span> XLSX (Excel)
                                    </div>
                                    <div class="export-menu-item" onclick="window.${ instanceName }.exportTable('xls')">
                                        <span class="export-icon"><i class="pi pi-file-excel"></i></span> XLS (Excel 97-2003)
                                    </div>
                                    <div class="export-menu-item" onclick="window.${ instanceName }.exportTable('csv')">
                                        <span class="export-icon"><i class="pi pi-file"></i></span> CSV
                                    </div>
                                    <div class="export-menu-item" onclick="window.${ instanceName }.copyToBuffer()">
                                        <span class="export-icon"><i class="pi pi-copy"></i></span> В буфер
                                    </div>
                                </div>
                            </div>
                            ` : '' }
                            ${ this.checkboxMode && this.selectedRows.size > 0 && this.isTableWritable() ? `
                            <button class="btn btn-sm btn-danger integram-bulk-delete-btn" id="${ instanceName }-bulk-delete-btn" onclick="window.${ instanceName }.showBulkDeleteConfirm(event)">
                                Удалить (${ this.selectedRows.size })
                            </button>
                            ` : '' }
                            <div class="integram-table-settings" onclick="window.${ instanceName }.copyConfigUrl()" title="Скопировать ссылку с текущими фильтрами и группами">
                                <i class="pi pi-copy"></i>
                                ${ !this.settings.hideMenuButtonLabels ? '<span class="btn-label">ссылка</span>' : '' }
                            </div>
                            <div class="integram-table-settings" onclick="window.${ instanceName }.openTableSettings()" title="Настройка таблицы">
                                <i class="pi pi-cog"></i>
                                ${ !this.settings.hideMenuButtonLabels ? '<span class="btn-label">вид</span>' : '' }
                            </div>
                            <div class="integram-table-settings" onclick="window.${ instanceName }.openColumnSettings()" title="Настройка колонок">
                                <i class="pi pi-th-large"></i>
                                ${ !this.settings.hideMenuButtonLabels ? '<span class="btn-label">колонки</span>' : '' }
                            </div>
                        </div>
                    </div>
                    ${ this.renderHiddenFilterBadges() }
                    <div class="integram-table-container">
                        <table class="integram-table${ this.settings.compact ? ' compact' : '' }">
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
                                        ? `<th class="checkbox-column-header" rowspan="${ smartDepth }"><input type="checkbox" class="row-select-all" title="Выбрать все" ${ this.data.length > 0 && this.selectedRows.size === this.data.length ? 'checked' : '' }></th>`
                                        : '';
                                    const addColHtml = this.isStructureWritable()
                                        ? `<th class="add-column-header-cell" rowspan="${ smartDepth }" style="width: 36px; min-width: 36px;" title="Добавить колонку" onclick="window.${ instanceName }.quickAddColumn()"><i class="pi pi-plus"></i></th>`
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
                                        const addButtonHtml = this.shouldShowAddButton(col) ?
                                            `<button class="column-add-btn" onclick="window.${ instanceName }.openColumnCreateForm('${ col.id }')" title="Создать запись"><i class="pi pi-plus"></i></button>` : '';
                                        let sortIndicator = '';
                                        if (this.sortColumn === col.id) {
                                            sortIndicator = this.sortDirection === 'asc' ? '<i class="pi pi-sort-amount-up-alt" style="font-size:0.75em;"></i> ' : '<i class="pi pi-sort-amount-down" style="font-size:0.75em;"></i> ';
                                        }
                                        const refTypeId = col.ref;
                                        const refIconHtml = refTypeId ? (() => {
                                            const dbName = window.db || window.location.pathname.split('/')[1];
                                            return `<a class="column-ref-link" href="/${dbName}/table/${refTypeId}" target="_blank" title="Открыть справочник в новой вкладке" onclick="event.stopPropagation()"><i class="pi pi-external-link"></i></a>`;
                                        })() : '';
                                        return `
                                            <th data-column-id="${ col.id }" draggable="true"${ widthStyle }>
                                                <span class="column-header-content" data-column-id="${ col.id }" title="${ col.id }" style="${ this.settings.wrapHeaders ? 'white-space: normal;' : '' }">${ sortIndicator }${ col.name }</span>
                                                ${ refIconHtml }
                                                ${ addButtonHtml }
                                                <div class="column-resize-handle" data-column-id="${ col.id }"></div>
                                            </th>
                                        `;
                                    }).join('');

                                return `
                                    <tr>
                                        ${ this.checkboxMode ? `<th class="checkbox-column-header"><input type="checkbox" class="row-select-all" title="Выбрать все" ${ this.data.length > 0 && this.selectedRows.size === this.data.length ? 'checked' : '' }></th>` : '' }
                                        ${ singleRowCells }
                                        ${ this.settings.showReferences && (this.objectTableId || this.options.tableTypeId) ? `<th class="references-column-header" title="Таблицы, где эта таблица используется как справочник">Связи</th>` : '' }
                                        ${ this.isStructureWritable() ? `<th class="add-column-header-cell" style="width: 36px; min-width: 36px;" title="Добавить колонку" onclick="window.${ instanceName }.quickAddColumn()"><i class="pi pi-plus"></i></th>` : '' }
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
                                this.data.map((row, rowIndex) => `
                                    <tr class="${ this.selectedRows.has(rowIndex) ? 'row-selected' : '' }">
                                        ${ this.checkboxMode ? `<td class="checkbox-column-cell"><input type="checkbox" class="row-select-checkbox" data-row-index="${ rowIndex }" ${ this.selectedRows.has(rowIndex) ? 'checked' : '' }></td>` : '' }
                                        ${ orderedColumns.map((col, colIndex) => {
                                            const cellValue = row[this.columns.indexOf(col)];
                                            return this.renderCell(col, cellValue, rowIndex, colIndex);
                                        }).join('') }
                                        ${ this.settings.showReferences && (this.objectTableId || this.options.tableTypeId) ? this.renderReferencesCell(rowIndex) : '' }
                                    </tr>
                                `).join('')
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

            // Restore focus state after re-rendering
            if (focusState) {
                const newInput = this.container.querySelector(`.filter-input-with-icon[data-column-id="${focusState.columnId}"]`);
                if (newInput) {
                    newInput.focus();
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
                                <span class="filter-icon-inside" data-column-id="${ column.id }">
                                    ${ currentFilter.type }
                                </span>
                                <input type="text"
                                       class="filter-input-with-icon filter-ref-text-input"
                                       data-column-id="${ column.id }"
                                       value="${ displayValue }"
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
                            <span class="filter-icon-inside" data-column-id="${ column.id }">
                                ${ currentFilter.type }
                            </span>
                            <button type="button"
                                    class="filter-ref-trigger"
                                    data-column-id="${ column.id }"
                                    data-selected-ids="${ Array.from(selectedIds).join(',') }"
                                    title="${ escapedDisplayText || 'Выбрать значение...' }">
                                <span class="filter-ref-trigger-text${ escapedDisplayText ? '' : ' filter-ref-trigger-text--placeholder' }">${ escapedDisplayText || 'Выбрать...' }</span>
                                <span class="filter-ref-trigger-arrow">▼</span>
                            </button>
                        </div>
                    </td>
                `;
            }

            // For DATE/DATETIME formats with value-based filter types, render a date/datetime picker (issue #1008)
            // Filter types that need a date picker: =, ≥, ≤, >, < (not %, !%, or ...)
            const dateFormats = ['DATE', 'DATETIME'];
            const datePickerFilterTypes = new Set(['=', '≥', '≤', '>', '<']);
            if (dateFormats.includes(format) && datePickerFilterTypes.has(currentFilter.type)) {
                const isDateTime = format === 'DATETIME';
                const inputType = isDateTime ? 'datetime-local' : 'date';
                // Convert stored display value (DD.MM.YYYY or DD.MM.YYYY HH:MM:SS) to HTML5 format
                const html5Value = displayValue ? this.formatDateForHtml5(displayValue, isDateTime) : '';
                return `
                    <td>
                        <div class="filter-cell-wrapper">
                            <span class="filter-icon-inside" data-column-id="${ column.id }">
                                ${ currentFilter.type }
                            </span>
                            <input type="${ inputType }"
                                   class="filter-input-with-icon filter-date-picker"
                                   data-column-id="${ column.id }"
                                   data-is-datetime="${ isDateTime ? '1' : '0' }"
                                   value="${ html5Value }">
                        </div>
                    </td>
                `;
            }

            return `
                <td>
                    <div class="filter-cell-wrapper">
                        <span class="filter-icon-inside" data-column-id="${ column.id }">
                            ${ currentFilter.type }
                        </span>
                        <input type="text"
                               class="filter-input-with-icon"
                               data-column-id="${ column.id }"
                               value="${ displayValue }"
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
