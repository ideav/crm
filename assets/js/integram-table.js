/**
 * IntegramTable Component
 * Standalone JS module for displaying Integram API data tables with infinite scroll
 *
 * Features:
 * - Automatic column hiding for ID and Style suffix columns
 * - Infinite scroll instead of pagination
 * - Dynamic filtering with 13+ filter operators
 * - Drag & drop column reordering
 * - Column visibility settings
 * - Cookie-based state persistence
 * - Custom cell styling via style columns
 * - Clickable "?" to fetch total record count
 */

class IntegramTable {
        constructor(containerId, options = {}) {
            this.container = document.getElementById(containerId);
            this.options = {
                apiUrl: options.apiUrl || '',
                pageSize: options.pageSize || 20,
                cookiePrefix: options.cookiePrefix || 'integram-table',
                title: options.title || '',
                instanceName: options.instanceName || 'table',
                onCellClick: options.onCellClick || null,
                onDataLoad: options.onDataLoad || null
            };

            this.columns = [];
            this.data = [];
            this.loadedRecords = 0;  // Changed from currentPage to loadedRecords
            this.totalRows = null;  // null means unknown, user can click to fetch
            this.hasMore = true;  // Whether there are more records to load
            this.isLoading = false;  // Prevent multiple simultaneous loads
            this.filters = {};
            this.columnOrder = [];
            this.visibleColumns = [];
            this.filtersEnabled = false;
            this.styleColumns = {};  // Map of column IDs to their style column values
            this.idColumns = new Set();  // Set of hidden ID column IDs
            this.columnWidths = {};  // Map of column IDs to their widths in pixels
            this.metadataCache = {};  // Cache for metadata by type ID
            this.editableColumns = new Map();  // Map of column IDs to their corresponding ID column IDs
            this.globalMetadata = null;  // Global metadata for determining parent relationships
            this.currentEditingCell = null;  // Track currently editing cell

            // Table settings
            this.settings = {
                compact: false,  // false = spacious (default), true = compact
                pageSize: this.options.pageSize,  // Current page size
                truncateLongValues: true  // true = truncate to 127 chars (default)
            };

            this.filterTypes = {
                'CHARS': [
                    { symbol: '^', name: 'начинается с...', format: 'FR_{ T }={ X }%' },
                    { symbol: '=', name: 'равно', format: 'FR_{ T }={ X }' },
                    { symbol: '≠', name: 'не равно', format: 'FR_{ T }=!{ X }' },
                    { symbol: '~', name: 'содержит', format: 'FR_{ T }=%{ X }%' },
                    { symbol: '!', name: 'не содержит', format: 'FR_{ T }=!%{ X }%' },
                    { symbol: '!^', name: 'не начинается', format: 'FR_{ T }=!%{ X }' },
                    { symbol: '%', name: 'не пустое', format: 'FR_{ T }=%' },
                    { symbol: '!%', name: 'пустое', format: 'FR_{ T }=!%' },
                    { symbol: '(,)', name: 'в списке', format: 'FR_{ T }=IN({ X })' },
                    { symbol: '$', name: 'заканчивается', format: 'FR_{ T }=%{ X }' }
                ],
                'NUMBER': [
                    { symbol: '^', name: 'начинается с...', format: 'FR_{ T }={ X }%' },
                    { symbol: '=', name: 'равно', format: 'FR_{ T }={ X }' },
                    { symbol: '≠', name: 'не равно', format: 'FR_{ T }=!{ X }' },
                    { symbol: '≥', name: 'не меньше', format: 'FR_{ T }=>={ X }' },
                    { symbol: '≤', name: 'не больше', format: 'FR_{ T }=<={ X }' },
                    { symbol: '>', name: 'больше', format: 'FR_{ T }>{ X }' },
                    { symbol: '<', name: 'меньше', format: 'FR_{ T }<{ X }' },
                    { symbol: '...', name: 'в диапазоне', format: 'FR_{ T }={ X1 }&TO_{ T }={ X2 }' },
                    { symbol: '%', name: 'не пустое', format: 'FR_{ T }=%' },
                    { symbol: '!%', name: 'пустое', format: 'FR_{ T }=!%' }
                ],
                'DATE': [
                    { symbol: '=', name: 'равно', format: 'FR_{ T }={ X }' },
                    { symbol: '≥', name: 'не меньше', format: 'FR_{ T }=>={ X }' },
                    { symbol: '≤', name: 'не больше', format: 'FR_{ T }=<={ X }' },
                    { symbol: '>', name: 'больше', format: 'FR_{ T }>{ X }' },
                    { symbol: '<', name: 'меньше', format: 'FR_{ T }<{ X }' },
                    { symbol: '...', name: 'в диапазоне', format: 'FR_{ T }={ X1 }&TO_{ T }={ X2 }' },
                    { symbol: '%', name: 'не пустое', format: 'FR_{ T }=%' },
                    { symbol: '!%', name: 'пустое', format: 'FR_{ T }=!%' }
                ]
            };

            this.filterTypes['SHORT'] = this.filterTypes['CHARS'];
            this.filterTypes['MEMO'] = this.filterTypes['CHARS'];
            this.filterTypes['DATETIME'] = this.filterTypes['DATE'];
            this.filterTypes['SIGNED'] = this.filterTypes['NUMBER'];

            this.init();
        }

        init() {
            this.loadColumnState();
            this.loadSettings();
            this.loadGlobalMetadata();  // Load metadata once at initialization
            this.loadData();
        }

        async loadGlobalMetadata() {
            try {
                const apiBase = this.getApiBase();
                const response = await fetch(`${ apiBase }/metadata`);
                if (!response.ok) {
                    console.error('Failed to fetch global metadata');
                    return;
                }
                const metadata = await response.json();
                this.globalMetadata = metadata;
                // Re-render if data is already loaded, so column-add-btn visibility
                // can be recalculated based on the metadata ids
                if (this.columns.length > 0) {
                    this.render();
                }
            } catch (error) {
                console.error('Error loading global metadata:', error);
            }
        }

        async loadData(append = false) {
            if (this.isLoading || (!append && !this.hasMore && this.loadedRecords > 0)) {
                return;
            }

            this.isLoading = true;

            // Request pageSize + 1 to detect if there are more records
            const requestSize = this.options.pageSize + 1;
            const offset = append ? this.loadedRecords : 0;

            const params = new URLSearchParams({
                LIMIT: `${ offset },${ requestSize }`
            });

            const filters = this.filters || {};
            Object.keys(filters).forEach(colId => {
                const filter = filters[colId];
                if (filter.value || filter.type === '%' || filter.type === '!%') {
                    const column = this.columns.find(c => c.id === colId);
                    if (column) {
                        this.applyFilter(params, column, filter);
                    }
                }
            });

            try {
                const separator = this.options.apiUrl.includes('?') ? '&' : '?';
                const response = await fetch(`${ this.options.apiUrl }${ separator }${ params }`);
                const json = await response.json();

                this.columns = json.columns || [];

                // Transform column-based data to row-based data
                const columnData = json.data || [];
                let newRows = [];

                if (columnData.length > 0 && Array.isArray(columnData[0])) {
                    const numRows = columnData[0].length;
                    for (let rowIndex = 0; rowIndex < numRows; rowIndex++) {
                        const row = [];
                        for (let colIndex = 0; colIndex < columnData.length; colIndex++) {
                            row.push(columnData[colIndex][rowIndex]);
                        }
                        newRows.push(row);
                    }
                } else {
                    newRows = columnData;
                }

                // Check if there are more records (we requested pageSize + 1)
                this.hasMore = newRows.length > this.options.pageSize;

                // Keep only pageSize records
                if (this.hasMore) {
                    newRows = newRows.slice(0, this.options.pageSize);
                }

                // Append or replace data
                if (append) {
                    this.data = this.data.concat(newRows);
                } else {
                    this.data = newRows;
                    this.loadedRecords = 0;
                }

                this.loadedRecords += newRows.length;

                // Auto-set total count if we've reached the end
                if (!this.hasMore && this.totalRows === null) {
                    this.totalRows = this.loadedRecords;
                }

                // Process columns to hide ID and Style suffixes
                this.processColumnVisibility();

                if (this.columnOrder.length === 0) {
                    this.columnOrder = this.columns.map(c => c.id);
                }
                if (this.visibleColumns.length === 0) {
                    this.visibleColumns = this.columns.filter(c => !this.idColumns.has(c.id)).map(c => c.id);
                } else {
                    // Filter out style columns from visibleColumns if loaded from cookie
                    this.visibleColumns = this.visibleColumns.filter(id => !this.idColumns.has(id));
                }

                if (this.options.onDataLoad) {
                    this.options.onDataLoad(json);
                }

                this.render();
            } catch (error) {
                console.error('Error loading data:', error);
                if (!append) {
                    this.container.innerHTML = `<div class="alert alert-danger">Ошибка загрузки данных: ${ error.message }</div>`;
                }
            } finally {
                this.isLoading = false;
                // Check if table fits on screen and needs more data
                this.checkAndLoadMore();
            }
        }

        async fetchTotalCount() {
            const params = new URLSearchParams({
                RECORD_COUNT: '1'
            });

            const filters = this.filters || {};
            Object.keys(filters).forEach(colId => {
                const filter = filters[colId];
                if (filter.value || filter.type === '%' || filter.type === '!%') {
                    const column = this.columns.find(c => c.id === colId);
                    if (column) {
                        this.applyFilter(params, column, filter);
                    }
                }
            });

            try {
                const separator = this.options.apiUrl.includes('?') ? '&' : '?';
                const response = await fetch(`${ this.options.apiUrl }${ separator }${ params }`);
                const result = await response.json();
                this.totalRows = parseInt(result.count, 10);
                this.render();  // Re-render to update the counter
            } catch (error) {
                console.error('Error fetching total count:', error);
            }
        }

        applyFilter(params, column, filter) {
            const type = filter.type || '^';
            const value = filter.value;
            const colId = column.id;

            const format = column.format || 'SHORT';
            const filterGroup = this.filterTypes[format] || this.filterTypes['SHORT'];
            const filterDef = filterGroup.find(f => f.symbol === type);

            if (!filterDef) return;

            if (type === '...') {
                const values = value.split(',').map(v => v.trim());
                if (values.length >= 2) {
                    params.append(`FR_${ colId }`, values[0]);
                    params.append(`TO_${ colId }`, values[1]);
                }
            } else if (type === '%' || type === '!%') {
                params.append(`FR_${ colId }`, type === '%' ? '%' : '!%');
            } else {
                let paramValue = filterDef.format.replace('{ T }', colId).replace('{ X }', value);
                paramValue = paramValue.replace('FR_' + colId + '=', '');
                params.append(`FR_${ colId }`, paramValue);
            }
        }

        processColumnVisibility() {
            this.idColumns.clear();
            this.styleColumns = {};
            this.editableColumns.clear();

            // Build a map of column names to column objects
            const columnsByName = {};
            this.columns.forEach(col => {
                columnsByName[col.name] = col;
            });

            // Process each column
            this.columns.forEach(col => {
                const name = col.name;

                // Check for ID suffix
                if (name.endsWith('ID')) {
                    const baseName = name.slice(0, -2);
                    if (columnsByName[baseName]) {
                        this.idColumns.add(col.id);
                    }
                }

                // Check for Стиль/style suffix (case-insensitive)
                const lowerName = name.toLowerCase();
                if (lowerName.endsWith('стиль') || lowerName.endsWith('style')) {
                    let baseName;
                    if (lowerName.endsWith('стиль')) {
                        baseName = name.slice(0, -5);  // Remove "стиль"
                    } else {
                        baseName = name.slice(0, -5);  // Remove "style"
                    }

                    // Find base column (case-insensitive match)
                    const baseCol = this.columns.find(c =>
                        c.name.toLowerCase() === baseName.toLowerCase()
                    );

                    if (baseCol) {
                        this.styleColumns[baseCol.id] = col.id;
                        this.idColumns.add(col.id);  // Hide style columns too
                    }
                }

                // NEW: Mark ALL columns with granted=1 as editable
                if (col.granted === 1) {
                    // Look for corresponding ID column
                    const idColumnName = name + 'ID';
                    const idColumn = this.columns.find(c => c.name === idColumnName);

                    if (idColumn) {
                        // Store ID column reference for this editable column
                        this.editableColumns.set(col.id, idColumn.id);
                    } else {
                        // No ID column found, but still mark as editable with null reference
                        // The parent ID will be determined dynamically using the logic from the issue
                        this.editableColumns.set(col.id, null);
                    }
                }
            });
        }

        render() {
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
                        ${ this.options.title ? `<div class="integram-table-title">${ this.options.title }</div>` : '' }
                        <div class="integram-table-controls">
                            ${ this.hasActiveFilters() ? `
                            <button class="btn btn-sm btn-outline-secondary mr-1" onclick="window.${ instanceName }.clearAllFilters()" title="Очистить фильтры">
                                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style="vertical-align: middle;">
                                    <circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.5" fill="none"/>
                                    <path d="M5 5L11 11M11 5L5 11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                                </svg>
                            </button>
                            ` : '' }
                            <button class="btn btn-sm btn-outline-secondary mr-2" onclick="window.${ instanceName }.toggleFilters()">
                                ${ this.filtersEnabled ? '✓' : '' } Фильтры
                            </button>
                            <div class="integram-table-settings" onclick="window.${ instanceName }.openTableSettings()" title="Настройка">
                                ⚙️
                            </div>
                            <div class="integram-table-settings" onclick="window.${ instanceName }.openColumnSettings()">
                                <span font="size:+1" style="font-size: 146%;">▥</span> Колонки
                            </div>
                        </div>
                    </div>
                    <div class="integram-table-container">
                        <table class="integram-table${ this.settings.compact ? ' compact' : '' }">
                        <thead>
                            <tr>
                                ${ orderedColumns.map(col => {
                                    const width = this.columnWidths[col.id];
                                    const widthStyle = width ? ` style="width: ${ width }px; min-width: ${ width }px;"` : '';
                                    const addButtonHtml = this.shouldShowAddButton(col) ?
                                        `<button class="column-add-btn" onclick="window.${ instanceName }.openColumnCreateForm('${ col.id }')" title="Создать запись">+</button>` : '';
                                    return `
                                    <th data-column-id="${ col.id }" draggable="true"${ widthStyle }>
                                        <span class="column-header-content">${ col.name }</span>
                                        ${ addButtonHtml }
                                        <div class="column-resize-handle" data-column-id="${ col.id }"></div>
                                    </th>
                                `;
                                }).join('') }
                            </tr>
                            ${ this.filtersEnabled ? `
                            <tr class="filter-row">
                                ${ orderedColumns.map((col, idx) => this.renderFilterCell(col, idx)).join('') }
                            </tr>
                            ` : '' }
                        </thead>
                        <tbody>
                            ${ this.data.map((row, rowIndex) => `
                                <tr>
                                    ${ orderedColumns.map((col, colIndex) => {
                                        const cellValue = row[this.columns.indexOf(col)];
                                        return this.renderCell(col, cellValue, rowIndex, colIndex);
                                    }).join('') }
                                </tr>
                            `).join('') }
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
            this.attachEventListeners();
            this.attachScrollListener();
            this.attachStickyScrollbar();
            this.attachColumnResizeHandlers();

            // Restore focus state after re-rendering
            if (focusState) {
                const newInput = this.container.querySelector(`.filter-input-with-icon[data-column-id="${focusState.columnId}"]`);
                if (newInput) {
                    newInput.focus();
                    // Restore cursor position
                    if (focusState.selectionStart !== null && focusState.selectionEnd !== null) {
                        newInput.setSelectionRange(focusState.selectionStart, focusState.selectionEnd);
                    }
                }
            }
        }

        renderFilterCell(column, columnIndex = 0) {
            const format = column.format || 'SHORT';
            const currentFilter = this.filters[column.id] || { type: '^', value: '' };
            const placeholder = columnIndex === 0 ? 'Фильтр...' : '';

            return `
                <td>
                    <div class="filter-cell-wrapper">
                        <span class="filter-icon-inside" data-column-id="${ column.id }">
                            ${ currentFilter.type }
                        </span>
                        <input type="text"
                               class="filter-input-with-icon"
                               data-column-id="${ column.id }"
                               value="${ currentFilter.value }"
                               placeholder="${ placeholder }">
                    </div>
                </td>
            `;
        }

        // Helper method to parse DD.MM.YYYY date format from API
        parseDDMMYYYY(dateStr) {
            if (!dateStr || typeof dateStr !== 'string') return null;
            const parts = dateStr.trim().split('.');
            if (parts.length !== 3) return null;
            const day = parseInt(parts[0], 10);
            const month = parseInt(parts[1], 10);
            const year = parseInt(parts[2], 10);
            if (isNaN(day) || isNaN(month) || isNaN(year)) return null;
            // Month is 0-indexed in JavaScript Date
            return new Date(year, month - 1, day);
        }

        // Helper method to parse DD.MM.YYYY HH:MM:SS datetime format from API
        parseDDMMYYYYHHMMSS(datetimeStr) {
            if (!datetimeStr || typeof datetimeStr !== 'string') return null;
            const parts = datetimeStr.trim().split(' ');
            if (parts.length !== 2) return this.parseDDMMYYYY(datetimeStr); // Fallback to date-only

            const dateParts = parts[0].split('.');
            const timeParts = parts[1].split(':');

            if (dateParts.length !== 3 || timeParts.length !== 3) return null;

            const day = parseInt(dateParts[0], 10);
            const month = parseInt(dateParts[1], 10);
            const year = parseInt(dateParts[2], 10);
            const hour = parseInt(timeParts[0], 10);
            const minute = parseInt(timeParts[1], 10);
            const second = parseInt(timeParts[2], 10);

            if (isNaN(day) || isNaN(month) || isNaN(year) ||
                isNaN(hour) || isNaN(minute) || isNaN(second)) return null;

            // Month is 0-indexed in JavaScript Date
            return new Date(year, month - 1, day, hour, minute, second);
        }

        // Format Date object for display as DD.MM.YYYY
        formatDateDisplay(dateObj) {
            if (!dateObj || isNaN(dateObj.getTime())) return '';
            const day = String(dateObj.getDate()).padStart(2, '0');
            const month = String(dateObj.getMonth() + 1).padStart(2, '0');
            const year = dateObj.getFullYear();
            return `${ day }.${ month }.${ year }`;
        }

        // Format Date object for display as DD.MM.YYYY hh:mm:ss
        formatDateTimeDisplay(dateObj) {
            if (!dateObj || isNaN(dateObj.getTime())) return '';
            const day = String(dateObj.getDate()).padStart(2, '0');
            const month = String(dateObj.getMonth() + 1).padStart(2, '0');
            const year = dateObj.getFullYear();
            const hours = String(dateObj.getHours()).padStart(2, '0');
            const minutes = String(dateObj.getMinutes()).padStart(2, '0');
            const seconds = String(dateObj.getSeconds()).padStart(2, '0');
            return `${ day }.${ month }.${ year } ${ hours }:${ minutes }:${ seconds }`;
        }

        renderCell(column, value, rowIndex, colIndex) {
            const format = column.format || 'SHORT';
            let cellClass = '';
            let displayValue = value || '';
            let customStyle = '';
            let isEditable = this.editableColumns.has(column.id);

            // Check if this column has a style column
            if (this.styleColumns[column.id]) {
                const styleColId = this.styleColumns[column.id];
                const styleColIndex = this.columns.findIndex(c => c.id === styleColId);
                if (styleColIndex !== -1 && this.data[rowIndex]) {
                    const styleValue = this.data[rowIndex][styleColIndex];
                    if (styleValue) {
                        customStyle = ` style="${ styleValue }"`;
                    }
                }
            }

            // Add editable class if this cell has an ID column
            if (isEditable) {
                cellClass += ' editable-cell';
            }

            switch (format) {
                case 'NUMBER':
                case 'SIGNED':
                    cellClass = 'number-cell';
                    break;
                case 'BOOLEAN':
                    cellClass = 'boolean-cell';
                    displayValue = value ? 'Да' : 'Нет';
                    break;
                case 'DATE':
                    cellClass = 'date-cell';
                    if (value) {
                        const dateObj = this.parseDDMMYYYY(value);
                        if (dateObj && !isNaN(dateObj.getTime())) {
                            displayValue = this.formatDateDisplay(dateObj);
                        } else {
                            // Fallback: show original value if parsing fails
                            displayValue = value;
                        }
                    }
                    break;
                case 'DATETIME':
                    cellClass = 'datetime-cell';
                    if (value) {
                        const datetimeObj = this.parseDDMMYYYYHHMMSS(value);
                        if (datetimeObj && !isNaN(datetimeObj.getTime())) {
                            displayValue = this.formatDateTimeDisplay(datetimeObj);
                        } else {
                            // Fallback: show original value if parsing fails
                            displayValue = value;
                        }
                    }
                    break;
                case 'MEMO':
                    cellClass = 'memo-cell';
                    break;
                case 'PWD':
                    cellClass = 'pwd-cell';
                    displayValue = '******';
                    break;
                case 'HTML':
                    return `<td class="${ cellClass }" data-row="${ rowIndex }" data-col="${ colIndex }"${ customStyle }>${ displayValue }</td>`;
                case 'BUTTON':
                    displayValue = `<button class="btn btn-sm btn-primary">${ value || 'Действие' }</button>`;
                    return `<td class="${ cellClass }" data-row="${ rowIndex }" data-col="${ colIndex }"${ customStyle }>${ displayValue }</td>`;
            }

            let escapedValue = String(displayValue).replace(/&/g, '&amp;')
                                                      .replace(/</g, '&lt;')
                                                      .replace(/>/g, '&gt;')
                                                      .replace(/"/g, '&quot;')
                                                      .replace(/'/g, '&#039;');

            // Store full value for editing before truncation
            let fullValueForEditing = escapedValue;

            // Truncate long values if setting is enabled
            if (this.settings.truncateLongValues && escapedValue.length > 127) {
                const truncated = escapedValue.substring(0, 127);
                // Properly escape all JavaScript special characters for use in onclick string literal
                const fullValueEscaped = escapedValue
                    .replace(/\\/g, '\\\\')   // Escape backslashes first
                    .replace(/\n/g, '\\n')    // Escape newlines
                    .replace(/\r/g, '\\r')    // Escape carriage returns
                    .replace(/'/g, '\\\'');   // Escape single quotes
                const instanceName = this.options.instanceName;
                escapedValue = `${ truncated }<a href="#" class="show-full-value" onclick="window.${ instanceName }.showFullValue(event, '${ fullValueEscaped }'); return false;">...</a>`;
            }

            // Add edit icon for editable cells (only when recordId exists - no create new)
            if (isEditable) {
                const idColId = this.editableColumns.get(column.id);
                let recordId = '';

                // If we have an ID column reference, get the record ID from it
                if (idColId !== null) {
                    const idColIndex = this.columns.findIndex(c => c.id === idColId);
                    recordId = idColIndex !== -1 && this.data[rowIndex] ? this.data[rowIndex][idColIndex] : '';
                } else {
                    // No ID column - need to determine parent ID using the logic from the issue
                    // A) If first column: look for column with type={column.type} and name ending in ID
                    // B) If requisite: look for column with type={parent object id} and name ending in ID
                    recordId = this.determineParentRecordId(column, rowIndex);
                }

                // Use column.orig for reference fields (dictionary values), fallback to column.type
                const typeId = column.orig || column.type || '';
                const instanceName = this.options.instanceName;
                // Only show edit icon if recordId exists (disable creating new records)
                if (recordId && recordId !== '' && recordId !== '0') {
                    const editIcon = `<span class="edit-icon" onclick="window.${ instanceName }.openEditForm('${ recordId }', '${ typeId }', ${ rowIndex }); event.stopPropagation();" title="Редактировать"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M0 11.0833V14H2.91667L11.5442 5.3725L8.6275 2.45583L0 11.0833ZM13.8083 3.10833L10.8917 0.191667C10.6583 -0.0416667 10.2917 -0.0416667 10.0583 0.191667L7.90833 2.34167L10.825 5.25833L12.975 3.10833C13.2083 2.875 13.2083 2.50833 12.975 2.275L13.8083 3.10833Z" fill="currentColor"/></svg></span>`;
                    escapedValue = `<div class="cell-content-wrapper">${ escapedValue }${ editIcon }</div>`;
                }
            }

            // Add inline editing data attributes for editable cells (only when not already showing edit icon)
            let editableAttrs = '';
            if (isEditable && !customStyle.includes('edit-icon')) {
                const idColId = this.editableColumns.get(column.id);
                let recordId = '';

                // If we have an ID column reference, get the record ID from it
                if (idColId !== null) {
                    const idColIndex = this.columns.findIndex(c => c.id === idColId);
                    recordId = idColIndex !== -1 && this.data[rowIndex] ? this.data[rowIndex][idColIndex] : '';
                } else {
                    // No ID column - need to determine parent ID using the logic from the issue
                    recordId = this.determineParentRecordId(column, rowIndex);
                }

                // For reference fields, we allow editing even with empty values as long as we can determine parent record
                // For non-reference fields, we still require a valid recordId
                const isRefField = column.ref === 1;
                const canEdit = isRefField ? true : (recordId && recordId !== '' && recordId !== '0');

                if (canEdit) {
                    // Add ref attribute if this is a reference field
                    const refAttr = isRefField ? ` data-col-ref="1"` : '';
                    // Store full value for editing (escape for HTML attribute)
                    const fullValueAttr = fullValueForEditing ? ` data-full-value="${ fullValueForEditing.replace(/"/g, '&quot;') }"` : '';
                    // Use 'dynamic' as placeholder for recordId if it's empty (will be determined at edit time)
                    const recordIdAttr = recordId && recordId !== '' && recordId !== '0' ? recordId : 'dynamic';
                    editableAttrs = ` data-editable="true" data-record-id="${ recordIdAttr }" data-col-id="${ column.id }" data-col-type="${ column.type }" data-col-format="${ format }" data-row-index="${ rowIndex }"${ refAttr }${ fullValueAttr }`;
                    cellClass += ' inline-editable';
                }
            }

            return `<td class="${ cellClass }" data-row="${ rowIndex }" data-col="${ colIndex }"${ customStyle }${ editableAttrs }>${ escapedValue }</td>`;
        }

        renderScrollCounter() {
            const instanceName = this.options.instanceName;
            const totalDisplay = this.totalRows === null
                ? `<span class="total-count-unknown" onclick="window.${ instanceName }.fetchTotalCount()" title="Нажмите, чтобы узнать общее количество">?</span>`
                : this.totalRows;

            return `
                <div class="scroll-counter">
                    Показано ${ this.loadedRecords } из ${ totalDisplay }
                </div>
            `;
        }

        attachEventListeners() {
            const headers = this.container.querySelectorAll('th[draggable]');
            headers.forEach(th => {
                th.addEventListener('dragstart', (e) => {
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', th.dataset.columnId);
                    th.classList.add('dragging');
                });

                th.addEventListener('dragend', (e) => {
                    th.classList.remove('dragging');
                    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
                });

                th.addEventListener('dragover', (e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    th.classList.add('drag-over');
                });

                th.addEventListener('dragleave', (e) => {
                    th.classList.remove('drag-over');
                });

                th.addEventListener('drop', (e) => {
                    e.preventDefault();
                    const draggedId = e.dataTransfer.getData('text/plain');
                    const targetId = th.dataset.columnId;

                    if (draggedId !== targetId) {
                        this.reorderColumns(draggedId, targetId);
                    }

                    th.classList.remove('drag-over');
                });
            });

            const filterIcons = this.container.querySelectorAll('.filter-icon-inside');
            filterIcons.forEach(icon => {
                icon.addEventListener('click', (e) => {
                    this.showFilterTypeMenu(e.target, icon.dataset.columnId);
                });
            });

            const filterInputs = this.container.querySelectorAll('.filter-input-with-icon');
            filterInputs.forEach(input => {
                // Use 'input' event to apply filter on text change
                input.addEventListener('input', (e) => {
                    const colId = input.dataset.columnId;
                    if (!this.filters[colId]) {
                        this.filters[colId] = { type: '^', value: '' };
                    }
                    this.filters[colId].value = input.value;

                    // Debounce the API call to avoid too many requests
                    clearTimeout(this.filterTimeout);
                    this.filterTimeout = setTimeout(() => {
                        // Reset data and load from beginning
                        this.data = [];
                        this.loadedRecords = 0;
                        this.hasMore = true;
                        this.totalRows = null;  // Reset total, user can click to fetch again
                        this.loadData(false);
                    }, 500);  // Wait 500ms after user stops typing
                });
            });

            // Use event delegation for cell clicks - attaches to container once, handles all cells
            // This ensures listeners work even when cells are updated/recreated
            this.container.addEventListener('click', (e) => {
                const td = e.target.closest('td');
                if (!td) return;

                // Handle onCellClick callback for all cells
                if (this.options.onCellClick) {
                    const row = parseInt(td.dataset.row);
                    const col = parseInt(td.dataset.col);
                    if (!isNaN(row) && !isNaN(col) && this.data[row]) {
                        this.options.onCellClick(row, col, this.data[row][col]);
                    }
                }

                // Handle inline editing for editable cells
                if (td.dataset.editable === 'true') {
                    const colId = td.dataset.colId;
                    const column = this.columns.find(c => c.id === colId);

                    // Don't trigger if clicking on edit icon or already editing
                    if (e.target.closest('.edit-icon') || this.currentEditingCell) {
                        return;
                    }
                    this.startInlineEdit(td);
                } else {
                    // TRACE: Log clicks on NON-editable cells to explain why they're not editable
                    const row = parseInt(td.dataset.row);
                    const col = parseInt(td.dataset.col);
                    if (isNaN(row) || isNaN(col)) return;

                    const column = this.columns[col];
                    if (!column) return;

                    // Check if this column is in editableColumns
                    const isInEditableColumns = this.editableColumns.has(column.id);
                }
            });
        }

        async startInlineEdit(cell) {
            // Check if we can edit this cell (need to determine parent ID)
            let recordId = cell.dataset.recordId;
            const colId = cell.dataset.colId;
            const colType = cell.dataset.colType;
            const format = cell.dataset.colFormat;
            const isRef = cell.dataset.colRef === '1';
            const rowIndex = parseInt(cell.dataset.rowIndex);

            if (!colId || !colType) {
                return;
            }

            // Determine parent record using the logic from the issue
            const parentInfo = await this.determineParentRecord(colId, colType, recordId, rowIndex);

            if (!parentInfo) {
                this.showToast('Не удалось определить родительскую запись', 'error');
                return;
            }

            // If recordId was 'dynamic', now we should have the actual parent record ID
            if (recordId === 'dynamic' && parentInfo.parentRecordId) {
                recordId = parentInfo.parentRecordId;
            }

            if (!recordId || recordId === '' || recordId === '0') {
                this.showToast('Не удалось определить ID записи для редактирования', 'error');
                return;
            }

            // Get current value from the cell
            const currentValue = this.extractCellValue(cell);

            // Store reference to current editing cell
            this.currentEditingCell = {
                cell,
                recordId,
                colId,
                colType,
                format,
                isRef,
                parentInfo,
                originalValue: currentValue
            };

            // Create inline editor based on format or reference type
            if (isRef) {
                this.renderReferenceEditor(cell, currentValue);
            } else {
                this.renderInlineEditor(cell, currentValue, format);
            }
        }

        extractCellValue(cell) {
            // If full value is stored in data attribute, use it (for truncated fields)
            if (cell.dataset.fullValue) {
                return cell.dataset.fullValue;
            }

            // Extract the actual value from the cell (removing HTML, truncation indicators, etc.)
            const cellContent = cell.textContent || '';
            // Remove "..." link if present (from truncation)
            return cellContent.replace(/\.\.\.$/g, '').trim();
        }

        determineParentRecordId(column, rowIndex) {
            // Helper method to determine parent record ID for a cell at render time
            // Implements the logic from the issue for finding parent record ID

            if (!this.globalMetadata) {
                return '';
            }

            const colType = column.type;

            // A) Check if this is a first column (type is in top-level metadata)
            const metaItem = this.globalMetadata.find(item => item.id === colType);
            if (metaItem) {
                // Look for column with type=colType and name ending in ID
                const idColumnName = column.name + 'ID';
                const idColumn = this.columns.find(c => c.name === idColumnName && c.type === colType);

                if (idColumn) {
                    const idColIndex = this.columns.findIndex(c => c.id === idColumn.id);
                    const parentRecordId = idColIndex !== -1 && this.data[rowIndex] ? this.data[rowIndex][idColIndex] : '';
                    return parentRecordId;
                }
            }

            // B) Check if this is a requisite (type is in reqs of some metadata item)
            for (const item of this.globalMetadata) {
                if (item.reqs) {
                    const req = item.reqs.find(r => r.id === colType);
                    if (req) {
                        // Look for column with type=item.id and name ending in ID
                        const parentIdColumn = this.columns.find(c => c.type === item.id && c.name.endsWith('ID'));

                        if (parentIdColumn) {
                            const idColIndex = this.columns.findIndex(c => c.id === parentIdColumn.id);
                            const parentRecordId = idColIndex !== -1 && this.data[rowIndex] ? this.data[rowIndex][idColIndex] : '';
                            return parentRecordId;
                        }
                    }
                }
            }

            return '';
        }

        async determineParentRecord(colId, colType, recordId, rowIndex) {
            // Find the column object
            const column = this.columns.find(c => c.id === colId);
            if (!column) {
                return null;
            }

            // Use global metadata to determine parent record
            if (!this.globalMetadata) {
                return null;
            }

            // NEW LOGIC FROM ISSUE:
            // A) If this is the first column of the table, the parent record ID will be in
            //    the report column with type={type of this cell} and name ending in ID
            // B) If this is a requisite, the parent record ID will be in the report column
            //    with type={id of the object whose reqs contained this cell's type}, and name ending in ID

            // Check if colType is among the top-level metadata IDs (first column case - A)
            const metaItem = this.globalMetadata.find(item => item.id === colType);
            if (metaItem) {
                // This is a first column - look for column with type=colType and name ending in ID
                const idColumnName = column.name + 'ID';

                const idColumn = this.columns.find(c => c.name === idColumnName && c.type === colType);
                if (!idColumn) {
                    return null;
                }

                // Get the parent record ID from this ID column by extracting from row data
                let parentRecordId = '';
                if (rowIndex !== undefined && rowIndex !== null) {
                    const idColIndex = this.columns.findIndex(c => c.id === idColumn.id);
                    if (idColIndex !== -1 && this.data[rowIndex]) {
                        parentRecordId = this.data[rowIndex][idColIndex] || '';
                    }
                }

                return {
                    isFirstColumn: true,
                    parentType: colType,
                    parentColumnId: idColumn.id,
                    parentRecordId: parentRecordId
                };
            }

            // Check if colType is in any reqs (requisite case - B)
            for (const item of this.globalMetadata) {
                if (item.reqs) {
                    const req = item.reqs.find(r => r.id === colType);
                    if (req) {
                        // This is a requisite - look for column with type=item.id and name ending in ID

                        const parentIdColumn = this.columns.find(c => c.type === item.id && c.name.endsWith('ID'));
                        if (!parentIdColumn) {
                            return null;
                        }

                        // Get the parent record ID from this ID column by extracting from row data
                        let parentRecordId = '';
                        if (rowIndex !== undefined && rowIndex !== null) {
                            const parentIdColIndex = this.columns.findIndex(c => c.id === parentIdColumn.id);
                            if (parentIdColIndex !== -1 && this.data[rowIndex]) {
                                parentRecordId = this.data[rowIndex][parentIdColIndex] || '';
                            }
                        }

                        return {
                            isFirstColumn: false,
                            parentType: item.id,
                            parentColumnId: parentIdColumn.id,
                            parentRecordId: parentRecordId
                        };
                    }
                }
            }

            return null;
        }

        renderInlineEditor(cell, currentValue, format) {
            // Save original content for cancel
            const originalContent = cell.innerHTML;

            let editorHtml = '';
            const escapedValue = this.escapeHtml(currentValue);

            switch (format) {
                case 'NUMBER':
                case 'SIGNED':
                    editorHtml = `<input type="number" class="inline-editor inline-editor-number" value="${ escapedValue }" ${ format === 'SIGNED' ? 'step="0.01"' : '' }>`;
                    break;
                case 'BOOLEAN':
                    const isChecked = currentValue === 'Да' || currentValue === '1' || currentValue === 'true';
                    editorHtml = `<input type="checkbox" class="inline-editor inline-editor-checkbox" ${ isChecked ? 'checked' : '' }>`;
                    break;
                case 'DATE':
                    const dateValue = this.formatDateForHtml5(currentValue, false);
                    editorHtml = `<input type="date" class="inline-editor inline-editor-date" value="${ dateValue }">`;
                    break;
                case 'DATETIME':
                    const datetimeValue = this.formatDateForHtml5(currentValue, true);
                    editorHtml = `<input type="datetime-local" class="inline-editor inline-editor-datetime" value="${ datetimeValue }" step="300">`;
                    break;
                case 'MEMO':
                    editorHtml = `<textarea class="inline-editor inline-editor-memo" rows="3">${ escapedValue }</textarea>`;
                    break;
                default:
                    // SHORT, CHARS, etc. - text input
                    editorHtml = `<input type="text" class="inline-editor inline-editor-text" value="${ escapedValue }">`;
            }

            cell.innerHTML = editorHtml;
            const editor = cell.querySelector('.inline-editor');

            // Focus the editor
            editor.focus();
            if (editor.select) {
                editor.select();
            }

            // Attach event handlers
            const saveEdit = async () => {
                let newValue = '';
                if (format === 'BOOLEAN') {
                    newValue = editor.checked ? '1' : '0';
                } else if (format === 'DATE') {
                    newValue = this.convertHtml5DateToDisplay(editor.value, false);
                } else if (format === 'DATETIME') {
                    newValue = this.convertHtml5DateToDisplay(editor.value, true);
                } else {
                    newValue = editor.value;
                }

                // Only save if value changed
                if (newValue !== this.currentEditingCell.originalValue) {
                    await this.saveInlineEdit(newValue);
                } else {
                    this.cancelInlineEdit(originalContent);
                }
            };

            const cancelEdit = () => {
                this.cancelInlineEdit(originalContent);
            };

            // Enter to save (except for textarea)
            if (format !== 'MEMO') {
                editor.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        saveEdit();
                    } else if (e.key === 'Escape') {
                        e.preventDefault();
                        cancelEdit();
                    }
                });
            } else {
                // For textarea: Ctrl+Enter to save, Escape to cancel
                editor.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' && e.ctrlKey) {
                        e.preventDefault();
                        saveEdit();
                    } else if (e.key === 'Escape') {
                        e.preventDefault();
                        cancelEdit();
                    }
                });
            }

            // Click outside to save (with small delay to avoid immediate trigger)
            setTimeout(() => {
                const outsideClickHandler = (e) => {
                    if (!cell.contains(e.target)) {
                        document.removeEventListener('click', outsideClickHandler);
                        saveEdit();
                    }
                };
                document.addEventListener('click', outsideClickHandler);

                // Store handler reference to clean up if canceled
                this.currentEditingCell.outsideClickHandler = outsideClickHandler;
            }, 100);
        }

        async renderReferenceEditor(cell, currentValue) {
            // Save original content for cancel
            const originalContent = cell.innerHTML;

            const { colId, colType, parentInfo } = this.currentEditingCell;

            // Show loading indicator
            cell.innerHTML = '<div class="inline-editor-loading">Загрузка...</div>';

            try {
                // Fetch reference options
                const options = await this.fetchReferenceOptions(colType, parentInfo.parentRecordId);

                // Find the column object to check for granted and orig
                const column = this.columns.find(c => c.id === colId);
                const hasGranted = column && column.granted === 1;
                const origType = column && column.orig ? column.orig : null;

                // Always show clear button. If granted=1 and orig exists, also show add button (initially hidden)
                // The "+" button will be shown only when search input has non-zero length
                // The "×" button will be hidden when search input has text (and add button is shown)
                const showAddButton = hasGranted && origType !== null;
                let buttonHtml = `<button class="inline-editor-reference-clear" title="Очистить значение" aria-label="Очистить значение">×</button>`;
                if (showAddButton) {
                    buttonHtml += `<button class="inline-editor-reference-add" style="display: none;" title="Создать запись" aria-label="Создать запись">+</button>`;
                }

                // Create dropdown with search
                const editorHtml = `
                    <div class="inline-editor-reference">
                        <div class="inline-editor-reference-header">
                            <input type="text"
                                   class="inline-editor-reference-search"
                                   placeholder="Поиск..."
                                   autocomplete="off">
                            ${buttonHtml}
                        </div>
                        <div class="inline-editor-reference-dropdown">
                            ${this.renderReferenceOptions(options, currentValue)}
                        </div>
                    </div>
                `;

                cell.innerHTML = editorHtml;

                const searchInput = cell.querySelector('.inline-editor-reference-search');
                const dropdown = cell.querySelector('.inline-editor-reference-dropdown');
                const clearButton = cell.querySelector('.inline-editor-reference-clear');
                const addButton = cell.querySelector('.inline-editor-reference-add');

                // Store original options for filtering
                this.currentEditingCell.referenceOptions = options;
                // Track if all options have been fetched (50+ means we only got first 50)
                this.currentEditingCell.allOptionsFetched = Object.keys(options).length < 50;

                // Focus the search input
                searchInput.focus();

                // Handle search input
                let searchTimeout;
                searchInput.addEventListener('input', async (e) => {
                    const searchText = e.target.value.trim();

                    // Toggle buttons based on search input length (issue #217)
                    // When search has text: show add button (if available), hide clear button
                    // When search is empty: hide add button, show clear button
                    if (searchText.length > 0) {
                        if (addButton) {
                            addButton.style.display = '';
                        }
                        if (clearButton) {
                            clearButton.style.display = 'none';
                        }
                    } else {
                        if (addButton) {
                            addButton.style.display = 'none';
                        }
                        if (clearButton) {
                            clearButton.style.display = '';
                        }
                    }

                    clearTimeout(searchTimeout);
                    searchTimeout = setTimeout(async () => {
                        if (searchText === '') {
                            // Show original options
                            dropdown.innerHTML = this.renderReferenceOptions(this.currentEditingCell.referenceOptions, currentValue);
                        } else {
                            // Filter locally first
                            const filtered = this.filterReferenceOptions(this.currentEditingCell.referenceOptions, searchText, currentValue);
                            dropdown.innerHTML = this.renderReferenceOptions(filtered, currentValue);

                            // If we have exactly 50 options (not all fetched), re-query from server
                            if (!this.currentEditingCell.allOptionsFetched) {
                                try {
                                    const serverOptions = await this.fetchReferenceOptions(colType, parentInfo.parentRecordId, searchText);
                                    this.currentEditingCell.referenceOptions = serverOptions;
                                    dropdown.innerHTML = this.renderReferenceOptions(serverOptions, currentValue);
                                } catch (error) {
                                    console.error('Error re-querying reference options:', error);
                                }
                            }
                        }
                    }, 300);
                });

                // Handle option selection
                dropdown.addEventListener('click', async (e) => {
                    const option = e.target.closest('.inline-editor-reference-option');
                    if (option) {
                        const selectedId = option.dataset.id;
                        const selectedText = option.dataset.text;
                        await this.saveReferenceEdit(selectedId, selectedText);
                    }
                });

                // Handle clear button click
                if (clearButton) {
                    clearButton.addEventListener('click', async (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        await this.saveReferenceEdit('', '');
                    });
                }

                // Handle add button click (create new record)
                if (addButton && origType) {
                    addButton.addEventListener('click', async (e) => {
                        e.preventDefault();
                        e.stopPropagation();

                        // Get the search input value as the initial value for new record
                        const inputValue = searchInput.value.trim();

                        // Open create form for the type specified in orig
                        await this.openCreateFormForReference(origType, inputValue, parentInfo.parentRecordId);
                    });
                }

                // Handle keyboard navigation
                searchInput.addEventListener('keydown', (e) => {
                    if (e.key === 'Escape') {
                        e.preventDefault();
                        this.cancelInlineEdit(originalContent);
                    } else if (e.key === 'Enter') {
                        e.preventDefault();
                        // Select first option
                        const firstOption = dropdown.querySelector('.inline-editor-reference-option');
                        if (firstOption) {
                            const selectedId = firstOption.dataset.id;
                            const selectedText = firstOption.dataset.text;
                            this.saveReferenceEdit(selectedId, selectedText);
                        }
                    } else if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        const firstOption = dropdown.querySelector('.inline-editor-reference-option');
                        if (firstOption) {
                            firstOption.focus();
                        }
                    }
                });

                // Handle keyboard navigation in dropdown
                dropdown.addEventListener('keydown', (e) => {
                    const currentOption = document.activeElement;
                    if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        const nextOption = currentOption.nextElementSibling;
                        if (nextOption) {
                            nextOption.focus();
                        }
                    } else if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        const prevOption = currentOption.previousElementSibling;
                        if (prevOption) {
                            prevOption.focus();
                        } else {
                            searchInput.focus();
                        }
                    } else if (e.key === 'Enter') {
                        e.preventDefault();
                        currentOption.click();
                    } else if (e.key === 'Escape') {
                        e.preventDefault();
                        this.cancelInlineEdit(originalContent);
                    }
                });

                // Click outside to cancel (with small delay to avoid immediate trigger)
                setTimeout(() => {
                    const outsideClickHandler = (e) => {
                        // Don't cancel if clicking inside reference creation modal
                        const refModal = e.target.closest('[data-is-reference-create="true"]');
                        const refOverlay = e.target.closest('.edit-form-overlay');
                        if (refModal || refOverlay) {
                            return;
                        }
                        if (!cell.contains(e.target)) {
                            document.removeEventListener('click', outsideClickHandler);
                            this.cancelInlineEdit(originalContent);
                        }
                    };
                    document.addEventListener('click', outsideClickHandler);
                    this.currentEditingCell.outsideClickHandler = outsideClickHandler;
                }, 100);

            } catch (error) {
                console.error('Error rendering reference editor:', error);
                this.showToast(`Ошибка загрузки справочника: ${error.message}`, 'error');
                this.cancelInlineEdit(originalContent);
            }
        }

        renderReferenceOptions(options, currentValue) {
            // Filter out current value from options
            const filteredOptions = Object.entries(options).filter(([id, text]) => text !== currentValue);

            if (filteredOptions.length === 0) {
                return '<div class="inline-editor-reference-empty">Нет доступных значений</div>';
            }

            return filteredOptions.map(([id, text]) => {
                const escapedText = this.escapeHtml(text);
                return `<div class="inline-editor-reference-option" data-id="${id}" data-text="${escapedText}" tabindex="0">${escapedText}</div>`;
            }).join('');
        }

        filterReferenceOptions(options, searchText, currentValue) {
            const lowerSearch = searchText.toLowerCase();
            const filtered = {};

            for (const [id, text] of Object.entries(options)) {
                if (text !== currentValue && text.toLowerCase().includes(lowerSearch)) {
                    filtered[id] = text;
                }
            }

            return filtered;
        }

        async saveReferenceEdit(selectedId, selectedText) {
            if (!this.currentEditingCell) {
                return;
            }

            const { cell, colType, parentInfo } = this.currentEditingCell;

            try {
                const apiBase = this.getApiBase();
                const params = new URLSearchParams();

                // Add XSRF token
                if (typeof xsrf !== 'undefined') {
                    params.append('_xsrf', xsrf);
                }

                params.append(`t${colType}`, selectedId);

                const url = `${apiBase}/_m_set/${parentInfo.parentRecordId}?JSON`;


                const response = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded'
                    },
                    body: params.toString()
                });

                const result = await response.json();

                if (result.error) {
                    throw new Error(result.error);
                }

                // Update the cell display with the selected text
                this.updateCellDisplay(cell, selectedText, this.currentEditingCell.format);

                this.showToast('Изменения сохранены', 'success');

            } catch (error) {
                console.error('Error saving reference edit:', error);
                this.showToast(`Ошибка сохранения: ${error.message}`, 'error');
                // Restore original content on error
                this.cancelInlineEdit(cell.dataset.originalContent);
            } finally {
                // Clean up
                if (this.currentEditingCell && this.currentEditingCell.outsideClickHandler) {
                    document.removeEventListener('click', this.currentEditingCell.outsideClickHandler);
                }
                this.currentEditingCell = null;
            }
        }

        async openCreateFormForReference(typeId, initialValue, parentRecordId) {
            // This method opens a create form for a new record when clicked from reference editor "+" button
            // After creation, it will set the newly created record ID and value in the reference field

            try {
                // Fetch metadata for the type
                if (!this.metadataCache[typeId]) {
                    this.metadataCache[typeId] = await this.fetchMetadata(typeId);
                }

                const metadata = this.metadataCache[typeId];

                // Render the create form modal with special handling for reference creation
                this.renderCreateFormForReference(metadata, typeId, initialValue, parentRecordId);

            } catch (error) {
                console.error('Error opening create form for reference:', error);
                this.showToast(`Ошибка открытия формы: ${error.message}`, 'error');
            }
        }

        renderCreateFormForReference(metadata, typeId, initialValue, parentRecordId) {
            // Track modal depth for z-index stacking
            if (!window._integramModalDepth) {
                window._integramModalDepth = 0;
            }
            window._integramModalDepth++;
            const modalDepth = window._integramModalDepth;
            const baseZIndex = 1000 + (modalDepth * 10);

            const overlay = document.createElement('div');
            overlay.className = 'edit-form-overlay';
            overlay.style.zIndex = baseZIndex;
            overlay.dataset.modalDepth = modalDepth;

            const modal = document.createElement('div');
            modal.className = 'edit-form-modal';
            modal.style.zIndex = baseZIndex + 1;
            modal.dataset.modalDepth = modalDepth;
            modal.dataset.overlayRef = 'true';
            modal.dataset.isReferenceCreate = 'true'; // Mark this as a special reference creation modal

            // Add cascade offset for nested modals (6px per level)
            const cascadeOffset = (modalDepth - 1) * 6;
            modal.style.transform = `translate(calc(-50% + ${cascadeOffset}px), calc(-50% + ${cascadeOffset}px))`;

            // Store reference to overlay on modal for proper cleanup
            modal._overlayElement = overlay;

            const typeName = this.getMetadataName(metadata);
            const title = `Создание: ${typeName}`;

            // Build attributes form HTML (similar to renderAttributesForm but simplified for create mode)
            const reqs = metadata.reqs || [];
            const regularFields = reqs.filter(req => !req.arr_id);

            let attributesHtml = `
                <div class="form-group">
                    <label for="field-main-ref-create">${typeName} <span class="required">*</span></label>
                    <input type="text" class="form-control" id="field-main-ref-create" name="main" value="${this.escapeHtml(initialValue)}" required>
                </div>
            `;

            // Add all fields of this type
            regularFields.forEach(req => {
                const attrs = this.parseAttrs(req.attrs);
                const fieldName = attrs.alias || req.val;
                const isRequired = attrs.required;

                attributesHtml += `<div class="form-group">`;
                attributesHtml += `<label for="field-ref-${req.id}">${fieldName}${isRequired ? ' <span class="required">*</span>' : ''}</label>`;

                // Check if this is a reference field
                if (req.ref_id) {
                    // Render as reference dropdown (same as in edit form)
                    attributesHtml += `
                        <div class="form-reference-editor" data-ref-id="${req.id}" data-required="${isRequired}" data-ref-type-id="${req.orig || req.ref_id}">
                            <div class="inline-editor-reference form-ref-editor-box">
                                <div class="inline-editor-reference-header">
                                    <input type="text"
                                           class="inline-editor-reference-search form-ref-search"
                                           id="field-ref-${req.id}-search"
                                           placeholder="Поиск..."
                                           autocomplete="off">
                                    <button class="inline-editor-reference-clear form-ref-clear" title="Очистить значение" aria-label="Очистить значение" type="button">×</button>
                                    <button class="inline-editor-reference-add form-ref-add" style="display: none;" title="Создать запись" aria-label="Создать запись" type="button">+</button>
                                </div>
                                <div class="inline-editor-reference-dropdown form-ref-dropdown" id="field-ref-${req.id}-dropdown">
                                    <div class="inline-editor-reference-empty">Загрузка...</div>
                                </div>
                            </div>
                            <input type="hidden"
                                   class="form-ref-value"
                                   id="field-ref-${req.id}"
                                   name="t${req.id}"
                                   value=""
                                   data-ref-id="${req.id}">
                        </div>
                    `;
                } else {
                    // Render as simple text input
                    attributesHtml += `<input type="text" class="form-control" id="field-ref-${req.id}" name="t${req.id}"${isRequired ? ' required' : ''}>`;
                }

                attributesHtml += `</div>`;
            });

            let formHtml = `
                <div class="edit-form-header">
                    <h5>${title}</h5>
                    <button class="edit-form-close" data-close-modal-ref="true">×</button>
                </div>
                <div class="edit-form-body">
                    <form id="edit-form-ref-create" class="edit-form">
                        ${attributesHtml}
                    </form>
                </div>
                <div class="edit-form-footer">
                    <div class="edit-form-footer-buttons">
                        <button type="button" class="btn btn-primary" id="save-record-ref-btn">Сохранить</button>
                        <button type="button" class="btn btn-secondary" data-close-modal-ref="true">Отмена</button>
                    </div>
                </div>
            `;

            modal.innerHTML = formHtml;
            document.body.appendChild(overlay);
            document.body.appendChild(modal);

            // Load reference options for dropdown fields
            this.loadReferenceOptions(regularFields, parentRecordId, modal);

            // Attach save handler
            const saveBtn = modal.querySelector('#save-record-ref-btn');
            saveBtn.addEventListener('click', async () => {
                await this.saveRecordForReference(modal, typeId, parentRecordId);
            });

            // Close modal helper function
            const closeModal = () => {
                modal.remove();
                overlay.remove();
                window._integramModalDepth = Math.max(0, (window._integramModalDepth || 1) - 1);
            };

            // Attach close handlers to buttons with data-close-modal-ref attribute
            modal.querySelectorAll('[data-close-modal-ref="true"]').forEach(btn => {
                btn.addEventListener('click', closeModal);
            });

            overlay.addEventListener('click', closeModal);
        }

        async saveRecordForReference(modal, typeId, parentRecordId) {
            const form = modal.querySelector('#edit-form-ref-create');

            if (!form.checkValidity()) {
                form.reportValidity();
                return;
            }

            const formData = new FormData(form);
            const params = new URLSearchParams();

            // Add XSRF token
            if (typeof xsrf !== 'undefined') {
                params.append('_xsrf', xsrf);
            }

            // Get main value before iterating form fields
            const mainValue = formData.get('main');

            // Add all form fields (skip 'main' since it's handled separately as t{typeId})
            // Skip empty parameters so server can fill defaults
            for (const [key, value] of formData.entries()) {
                if (key === 'main') continue;
                if (value !== '' && value !== null && value !== undefined) {
                    params.append(key, value);
                }
            }

            // Add main value as t{typeId} parameter
            if (mainValue !== '' && mainValue !== null && mainValue !== undefined) {
                params.append(`t${ typeId }`, mainValue);
            }

            const apiBase = this.getApiBase();
            const url = `${apiBase}/_m_new/${typeId}?JSON&up=1`; // ${parentRecordId || 1}

            try {
                const response = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded'
                    },
                    body: params.toString()
                });

                const text = await response.text();

                let result;
                try {
                    result = JSON.parse(text);
                } catch (e) {
                    // If not JSON, check if it's an error message
                    if (text.includes('error') || !response.ok) {
                        throw new Error(text);
                    }
                    // Otherwise treat as success
                    result = { success: true };
                }

                if (result.error) {
                    throw new Error(result.error);
                }

                // Extract created record ID and value from response
                // According to the issue: "её id приходит в ключе obj JSON в ответ на запрос _m_new"
                const createdId = result.obj || result.id || result.i;
                // Use the value from the response (result.val) if available, otherwise use the input value
                const createdValue = result.val || mainValue;


                // Close the create form modal
                modal.remove();
                if (modal._overlayElement) {
                    modal._overlayElement.remove();
                }
                window._integramModalDepth = Math.max(0, (window._integramModalDepth || 1) - 1);

                // Show success message
                this.showToast('Запись успешно создана', 'success');


                // Now set the created record in the reference field that's still open
                if (this.currentEditingCell && createdId) {
                    await this.saveReferenceEdit(createdId, createdValue);
                } else {
                    // Fallback: just close the inline editor
                    if (this.currentEditingCell) {
                        this.cancelInlineEdit(this.currentEditingCell.cell.innerHTML);
                    }
                }

            } catch (error) {
                console.error('Error saving record for reference:', error);
                this.showToast(`Ошибка сохранения: ${error.message}`, 'error');
            }
        }

        async saveInlineEdit(newValue) {
            if (!this.currentEditingCell) {
                return;
            }

            const { cell, recordId, colId, colType, parentInfo } = this.currentEditingCell;

            try {
                // Determine API endpoint and parameters
                const apiBase = this.getApiBase();
                const params = new URLSearchParams();

                // Add XSRF token
                if (typeof xsrf !== 'undefined') {
                    params.append('_xsrf', xsrf);
                }

                // Use parent record ID from parentInfo (already determined in startInlineEdit)

                const parentRecordId = parentInfo.parentRecordId;

                if (!parentRecordId) {
                    throw new Error('Не удалось определить ID родительской записи');
                }


                let url;
                if (parentInfo.isFirstColumn) {
                    // Use _m_save for first column
                    url = `${ apiBase }/_m_save/${ parentRecordId }?JSON`;
                    params.append(`t${ colType }`, newValue);
                } else {
                    // Use _m_set for requisites
                    url = `${ apiBase }/_m_set/${ parentRecordId }?JSON`;
                    params.append(`t${ colType }`, newValue);
                }

                const response = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded'
                    },
                    body: params.toString()
                });

                const result = await response.json();

                if (result.error) {
                    throw new Error(result.error);
                }

                // Update the cell display with the new value
                this.updateCellDisplay(cell, newValue, this.currentEditingCell.format);

                this.showToast('Изменения сохранены', 'success');

            } catch (error) {
                console.error('Error saving inline edit:', error);
                this.showToast(`Ошибка сохранения: ${ error.message }`, 'error');
                // Restore original content on error
                this.cancelInlineEdit(cell.dataset.originalContent);
            } finally {
                // Clean up
                if (this.currentEditingCell && this.currentEditingCell.outsideClickHandler) {
                    document.removeEventListener('click', this.currentEditingCell.outsideClickHandler);
                }
                this.currentEditingCell = null;
            }
        }

        updateCellDisplay(cell, newValue, format) {
            // Update the display value in the cell after successful save
            let displayValue = newValue;

            switch (format) {
                case 'BOOLEAN':
                    displayValue = (newValue === '1' || newValue === 'true') ? 'Да' : 'Нет';
                    break;
                case 'DATE':
                    if (newValue) {
                        const dateObj = this.parseDDMMYYYY(newValue);
                        if (dateObj && !isNaN(dateObj.getTime())) {
                            displayValue = this.formatDateDisplay(dateObj);
                        }
                    }
                    break;
                case 'DATETIME':
                    if (newValue) {
                        const datetimeObj = this.parseDDMMYYYYHHMMSS(newValue);
                        if (datetimeObj && !isNaN(datetimeObj.getTime())) {
                            displayValue = this.formatDateTimeDisplay(datetimeObj);
                        }
                    }
                    break;
            }

            // Escape HTML and update
            let escapedValue = String(displayValue).replace(/&/g, '&amp;')
                                                    .replace(/</g, '&lt;')
                                                    .replace(/>/g, '&gt;')
                                                    .replace(/"/g, '&quot;')
                                                    .replace(/'/g, '&#039;');

            // Store full value before truncation
            let fullValueForEditing = escapedValue;

            // Apply truncation if enabled
            if (this.settings.truncateLongValues && escapedValue.length > 127) {
                const truncated = escapedValue.substring(0, 127);
                const fullValueEscaped = escapedValue
                    .replace(/\\/g, '\\\\')
                    .replace(/\n/g, '\\n')
                    .replace(/\r/g, '\\r')
                    .replace(/'/g, '\\\'');
                const instanceName = this.options.instanceName;
                escapedValue = `${ truncated }<a href="#" class="show-full-value" onclick="window.${ instanceName }.showFullValue(event, '${ fullValueEscaped }'); return false;">...</a>`;
            }

            // Update data attribute with full value for editing
            if (fullValueForEditing) {
                cell.setAttribute('data-full-value', fullValueForEditing);
            }

            // Restore edit icon if present
            const hasEditIcon = cell.querySelector('.edit-icon');
            if (hasEditIcon) {
                const editIconHtml = hasEditIcon.outerHTML;
                cell.innerHTML = `<div class="cell-content-wrapper">${ escapedValue }${ editIconHtml }</div>`;
            } else {
                cell.innerHTML = escapedValue;
            }

            // Update the data array as well
            const rowIndex = parseInt(cell.dataset.row);
            const colIndex = parseInt(cell.dataset.col);
            if (this.data[rowIndex]) {
                this.data[rowIndex][colIndex] = newValue;
            }
        }

        cancelInlineEdit(originalContent) {
            if (!this.currentEditingCell) {
                return;
            }

            const { cell } = this.currentEditingCell;

            // Restore original content
            if (originalContent) {
                cell.innerHTML = originalContent;
            } else {
                // Fallback: re-render the cell
                const rowIndex = parseInt(cell.dataset.row);
                const colIndex = parseInt(cell.dataset.col);
                const colId = cell.dataset.colId;

                // Find column by ID (handles column reordering correctly)
                const column = this.columns.find(c => c.id === colId);
                if (!column) {
                    console.error('Column not found:', colId);
                    return;
                }

                // Get the actual data array index for this column
                const dataIndex = this.columns.indexOf(column);
                const value = this.data[rowIndex] ? this.data[rowIndex][dataIndex] : '';
                cell.outerHTML = this.renderCell(column, value, rowIndex, colIndex);
            }

            // Clean up event handlers
            if (this.currentEditingCell.outsideClickHandler) {
                document.removeEventListener('click', this.currentEditingCell.outsideClickHandler);
            }

            this.currentEditingCell = null;
        }

        attachScrollListener() {
            const tableWrapper = this.container.querySelector('.integram-table-wrapper');
            if (!tableWrapper) return;

            // Remove existing scroll listener if any
            if (this.scrollListener) {
                window.removeEventListener('scroll', this.scrollListener);
            }

            this.scrollListener = () => {
                if (this.isLoading || !this.hasMore) return;

                const rect = tableWrapper.getBoundingClientRect();
                const scrollThreshold = 200;  // Load more when 200px from bottom

                // Check if user scrolled near the bottom of the table
                if (rect.bottom - window.innerHeight < scrollThreshold) {
                    this.loadData(true);  // Append mode
                }
            };

            window.addEventListener('scroll', this.scrollListener);
        }

        checkAndLoadMore() {
            // Check if table fits entirely on screen and there are more records
            setTimeout(() => {
                const tableWrapper = this.container.querySelector('.integram-table-wrapper');
                if (!tableWrapper || this.isLoading || !this.hasMore) return;

                const rect = tableWrapper.getBoundingClientRect();
                // If table bottom is above viewport bottom (table fits on screen), load more
                if (rect.bottom < window.innerHeight - 50) {
                    this.loadData(true);  // Append mode
                }
            }, 100);  // Small delay to ensure DOM is updated
        }

        attachStickyScrollbar() {
            const tableContainer = this.container.querySelector('.integram-table-container');
            const stickyScrollbar = document.getElementById(`${this.container.id}-sticky-scrollbar`);
            const stickyContent = stickyScrollbar?.querySelector('.integram-table-sticky-scrollbar-content');

            if (!tableContainer || !stickyScrollbar || !stickyContent) return;

            // Set sticky scrollbar content width to match table width
            const updateStickyWidth = () => {
                const table = tableContainer.querySelector('.integram-table');
                if (table) {
                    stickyContent.style.width = table.scrollWidth + 'px';
                }
            };

            // Sync scroll positions
            const syncFromTable = () => {
                if (!this.isSyncingScroll) {
                    this.isSyncingScroll = true;
                    stickyScrollbar.scrollLeft = tableContainer.scrollLeft;
                    this.isSyncingScroll = false;
                }
            };

            const syncFromSticky = () => {
                if (!this.isSyncingScroll) {
                    this.isSyncingScroll = true;
                    tableContainer.scrollLeft = stickyScrollbar.scrollLeft;
                    this.isSyncingScroll = false;
                }
            };

            // Show/hide sticky scrollbar based on table container visibility
            const checkStickyVisibility = () => {
                const rect = tableContainer.getBoundingClientRect();
                const tableBottom = rect.bottom;
                const viewportHeight = window.innerHeight;

                // Show sticky scrollbar if table scrollbar is below viewport
                if (tableBottom > viewportHeight && tableContainer.scrollWidth > tableContainer.clientWidth) {
                    stickyScrollbar.style.display = 'block';
                } else {
                    stickyScrollbar.style.display = 'none';
                }
            };

            // Remove existing listeners if any
            if (this.tableScrollListener) {
                tableContainer.removeEventListener('scroll', this.tableScrollListener);
            }
            if (this.stickyScrollListener) {
                stickyScrollbar.removeEventListener('scroll', this.stickyScrollListener);
            }
            if (this.stickyVisibilityListener) {
                window.removeEventListener('scroll', this.stickyVisibilityListener);
                window.removeEventListener('resize', this.stickyVisibilityListener);
            }

            // Attach listeners
            this.tableScrollListener = syncFromTable;
            this.stickyScrollListener = syncFromSticky;
            this.stickyVisibilityListener = () => {
                checkStickyVisibility();
                updateStickyWidth();
            };

            tableContainer.addEventListener('scroll', this.tableScrollListener);
            stickyScrollbar.addEventListener('scroll', this.stickyScrollListener);
            window.addEventListener('scroll', this.stickyVisibilityListener);
            window.addEventListener('resize', this.stickyVisibilityListener);

            // Initial setup
            updateStickyWidth();
            checkStickyVisibility();
        }

        attachColumnResizeHandlers() {
            const resizeHandles = this.container.querySelectorAll('.column-resize-handle');

            resizeHandles.forEach(handle => {
                handle.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    e.stopPropagation();

                    const columnId = handle.dataset.columnId;
                    const th = handle.parentElement;
                    const startX = e.pageX;
                    const startWidth = th.offsetWidth;

                    const onMouseMove = (e) => {
                        const diff = e.pageX - startX;
                        const newWidth = Math.max(50, startWidth + diff);  // Min width 50px

                        th.style.width = newWidth + 'px';
                        th.style.minWidth = newWidth + 'px';
                        this.columnWidths[columnId] = newWidth;
                    };

                    const onMouseUp = () => {
                        document.removeEventListener('mousemove', onMouseMove);
                        document.removeEventListener('mouseup', onMouseUp);
                        this.saveColumnState();
                    };

                    document.addEventListener('mousemove', onMouseMove);
                    document.addEventListener('mouseup', onMouseUp);
                });
            });
        }

        showFilterTypeMenu(target, columnId) {
            const column = this.columns.find(c => c.id === columnId);
            const format = column.format || 'SHORT';
            const filterGroup = this.filterTypes[format] || this.filterTypes['SHORT'];

            document.querySelectorAll('.filter-type-menu').forEach(m => m.remove());

            const menu = document.createElement('div');
            menu.className = 'filter-type-menu';
            menu.innerHTML = filterGroup.map(f => `
                <div class="filter-type-option" data-symbol="${ f.symbol }">
                    <span class="symbol">${ f.symbol }</span>
                    <span>${ f.name }</span>
                </div>
            `).join('');

            const rect = target.getBoundingClientRect();
            menu.style.position = 'absolute';
            menu.style.top = rect.bottom + 'px';
            menu.style.left = rect.left + 'px';

            document.body.appendChild(menu);

            menu.querySelectorAll('.filter-type-option').forEach(opt => {
                opt.addEventListener('click', () => {
                    const symbol = opt.dataset.symbol;
                    if (!this.filters[columnId]) {
                        this.filters[columnId] = { type: '^', value: '' };
                    }
                    this.filters[columnId].type = symbol;
                    target.textContent = symbol;
                    menu.remove();

                    // For Empty (%) and Not Empty (!%) filters, clear input and apply immediately
                    if (symbol === '%' || symbol === '!%') {
                        this.filters[columnId].value = '';

                        // Clear the input field
                        const filterInput = this.container.querySelector(`.filter-input-with-icon[data-column-id="${columnId}"]`);
                        if (filterInput) {
                            filterInput.value = '';
                        }

                        // Reset data and load from beginning
                        this.data = [];
                        this.loadedRecords = 0;
                        this.hasMore = true;
                        this.totalRows = null;
                        this.loadData(false);
                    } else if (this.filters[columnId].value) {
                        // For other filter types, only reload if there's a value
                        // Reset data and load from beginning
                        this.data = [];
                        this.loadedRecords = 0;
                        this.hasMore = true;
                        this.totalRows = null;
                        this.loadData(false);
                    }
                });
            });

            setTimeout(() => {
                document.addEventListener('click', function closeMenu(e) {
                    if (!menu.contains(e.target) && e.target !== target) {
                        menu.remove();
                        document.removeEventListener('click', closeMenu);
                    }
                });
            }, 0);
        }

        reorderColumns(draggedId, targetId) {
            const draggedIndex = this.columnOrder.indexOf(draggedId);
            const targetIndex = this.columnOrder.indexOf(targetId);

            if (draggedIndex === -1 || targetIndex === -1) return;

            this.columnOrder.splice(draggedIndex, 1);
            this.columnOrder.splice(targetIndex, 0, draggedId);

            this.saveColumnState();
            this.render();
        }

        openColumnSettings() {
            const overlay = document.createElement('div');
            overlay.className = 'column-settings-overlay';

            const modal = document.createElement('div');
            modal.className = 'column-settings-modal';
            const instanceName = this.options.instanceName;

            modal.innerHTML = `
                <h5>Настройки колонок</h5>
                <div class="column-settings-list">
                    ${ this.columns.map(col => `
                        <div class="column-settings-item">
                            <label>
                                <input type="checkbox"
                                       data-column-id="${ col.id }"
                                       ${ this.visibleColumns.includes(col.id) ? 'checked' : '' }>
                                ${ col.name }
                            </label>
                        </div>
                    `).join('') }
                </div>
                <div style="text-align: right; margin-top: 15px;">
                    <button class="btn btn-secondary" onclick="window.${ instanceName }.closeColumnSettings()">Закрыть</button>
                </div>
            `;

            document.body.appendChild(overlay);
            document.body.appendChild(modal);

            modal.querySelectorAll('input[type="checkbox"]').forEach(cb => {
                cb.addEventListener('change', (e) => {
                    const colId = cb.dataset.columnId;
                    if (cb.checked) {
                        if (!this.visibleColumns.includes(colId)) {
                            this.visibleColumns.push(colId);
                        }
                    } else {
                        this.visibleColumns = this.visibleColumns.filter(id => id !== colId);
                    }
                    this.saveColumnState();
                    this.render();
                });
            });

            overlay.addEventListener('click', () => this.closeColumnSettings());
        }

        closeColumnSettings() {
            document.querySelectorAll('.column-settings-overlay, .column-settings-modal').forEach(el => el.remove());
        }

        openTableSettings() {
            const overlay = document.createElement('div');
            overlay.className = 'column-settings-overlay';

            const modal = document.createElement('div');
            modal.className = 'column-settings-modal';
            const instanceName = this.options.instanceName;

            modal.innerHTML = `
                <h5>Настройка таблицы</h5>
                <div class="column-settings-list">
                    <div class="table-settings-item">
                        <button class="btn btn-sm btn-danger" id="reset-settings-btn">Сбросить настройки</button>
                    </div>

                    <div class="table-settings-item">
                        <label>Отступы:</label>
                        <div>
                            <label>
                                <input type="radio" name="padding-mode" value="spacious" ${ !this.settings.compact ? 'checked' : '' }>
                                Просторно
                            </label>
                            <label style="margin-left: 15px;">
                                <input type="radio" name="padding-mode" value="compact" ${ this.settings.compact ? 'checked' : '' }>
                                Компактно
                            </label>
                        </div>
                    </div>

                    <div class="table-settings-item">
                        <label for="page-size-select">Размер страницы:</label>
                        <select id="page-size-select" class="form-control form-control-sm" style="display: inline-block; width: auto;">
                            <option value="10" ${ this.settings.pageSize === 10 ? 'selected' : '' }>10</option>
                            <option value="20" ${ this.settings.pageSize === 20 ? 'selected' : '' }>20</option>
                            <option value="30" ${ this.settings.pageSize === 30 ? 'selected' : '' }>30</option>
                            <option value="50" ${ this.settings.pageSize === 50 ? 'selected' : '' }>50</option>
                            <option value="100" ${ this.settings.pageSize === 100 ? 'selected' : '' }>100</option>
                            <option value="custom">Свой вариант</option>
                        </select>
                        <input type="number" id="custom-page-size" class="form-control form-control-sm" style="display: none; width: 80px; margin-left: 10px;" placeholder="Число">
                    </div>

                    <div class="table-settings-item">
                        <label>Сокращать длинные значения:</label>
                        <div>
                            <label>
                                <input type="radio" name="truncate-mode" value="yes" ${ this.settings.truncateLongValues ? 'checked' : '' }>
                                Да
                            </label>
                            <label style="margin-left: 15px;">
                                <input type="radio" name="truncate-mode" value="no" ${ !this.settings.truncateLongValues ? 'checked' : '' }>
                                Нет
                            </label>
                        </div>
                    </div>
                </div>
                <div style="text-align: right; margin-top: 15px;">
                    <button class="btn btn-secondary" id="close-settings-btn">Закрыть</button>
                </div>
            `;

            document.body.appendChild(overlay);
            document.body.appendChild(modal);

            // Handle reset settings button
            const resetBtn = modal.querySelector('#reset-settings-btn');
            resetBtn.addEventListener('click', () => {
                this.resetSettings();
            });

            // Handle close settings button
            const closeBtn = modal.querySelector('#close-settings-btn');
            closeBtn.addEventListener('click', () => {
                this.closeTableSettings();
            });

            // Handle padding mode change
            modal.querySelectorAll('input[name="padding-mode"]').forEach(radio => {
                radio.addEventListener('change', (e) => {
                    this.settings.compact = e.target.value === 'compact';
                    this.saveSettings();
                    this.render();
                });
            });

            // Handle page size change
            const pageSizeSelect = modal.querySelector('#page-size-select');
            const customPageSizeInput = modal.querySelector('#custom-page-size');

            pageSizeSelect.addEventListener('change', (e) => {
                if (e.target.value === 'custom') {
                    customPageSizeInput.style.display = 'inline-block';
                } else {
                    customPageSizeInput.style.display = 'none';
                    this.settings.pageSize = parseInt(e.target.value);
                    this.options.pageSize = this.settings.pageSize;
                    this.saveSettings();
                    // Reload data with new page size
                    this.data = [];
                    this.loadedRecords = 0;
                    this.hasMore = true;
                    this.totalRows = null;
                    this.loadData(false);
                }
            });

            customPageSizeInput.addEventListener('change', (e) => {
                const customSize = parseInt(e.target.value);
                if (customSize && customSize > 0) {
                    this.settings.pageSize = customSize;
                    this.options.pageSize = customSize;
                    this.saveSettings();
                    // Reload data with new page size
                    this.data = [];
                    this.loadedRecords = 0;
                    this.hasMore = true;
                    this.totalRows = null;
                    this.loadData(false);
                }
            });

            // Handle truncate mode change
            modal.querySelectorAll('input[name="truncate-mode"]').forEach(radio => {
                radio.addEventListener('change', (e) => {
                    this.settings.truncateLongValues = e.target.value === 'yes';
                    this.saveSettings();
                    this.render();
                });
            });

            overlay.addEventListener('click', () => this.closeTableSettings());
        }

        closeTableSettings() {
            document.querySelectorAll('.column-settings-overlay, .column-settings-modal').forEach(el => el.remove());
        }

        resetSettings() {
            // Delete settings cookie
            document.cookie = `${ this.options.cookiePrefix }-settings=; path=/; max-age=0`;

            // Delete state cookie (column order, visibility, widths)
            document.cookie = `${ this.options.cookiePrefix }-state=; path=/; max-age=0`;

            // Reset to defaults
            this.settings = {
                compact: false,
                pageSize: 20,
                truncateLongValues: true
            };
            this.options.pageSize = 20;

            // Reset column state
            this.columnOrder = [];
            this.visibleColumns = [];
            this.columnWidths = {};

            // Close modal and reload
            this.closeTableSettings();
            this.data = [];
            this.loadedRecords = 0;
            this.hasMore = true;
            this.totalRows = null;
            this.loadData(false);
            this.render();
        }

        showFullValue(event, fullValue) {
            event.preventDefault();
            const overlay = document.createElement('div');
            overlay.className = 'column-settings-overlay';

            const modal = document.createElement('div');
            modal.className = 'column-settings-modal';

            modal.innerHTML = `
                <h5>Полное значение</h5>
                <div style="max-height: 400px; overflow-y: auto; margin: 15px 0; padding: 10px; background: #f8f9fa; border-radius: 4px;">
                    <pre style="white-space: pre-wrap; word-wrap: break-word; margin: 0;">${ fullValue }</pre>
                </div>
                <div style="text-align: right;">
                    <button class="btn btn-secondary" onclick="this.closest('.column-settings-modal').remove(); document.querySelector('.column-settings-overlay').remove();">Закрыть</button>
                </div>
            `;

            document.body.appendChild(overlay);
            document.body.appendChild(modal);

            overlay.addEventListener('click', () => {
                modal.remove();
                overlay.remove();
            });
        }

        toggleFilters() {
            this.filtersEnabled = !this.filtersEnabled;
            this.render();
        }

        hasActiveFilters() {
            return Object.values(this.filters).some(filter => {
                if (!filter) return false;
                // For Empty (%) and Not Empty (!%) filters, they are active even with empty value
                if (filter.type === '%' || filter.type === '!%') return true;
                // For other filters, check if value is not empty
                return filter.value && filter.value.trim() !== '';
            });
        }

        clearAllFilters() {
            // Clear all filters
            this.filters = {};

            // Reset data and load from beginning
            this.data = [];
            this.loadedRecords = 0;
            this.hasMore = true;
            this.totalRows = null;
            this.loadData(false);

            // Re-render to update UI (clear filter inputs)
            this.render();
        }

        /**
         * Reload table data with current filter parameters
         * This method resets the table state and reloads from the beginning
         * while preserving current filters, column settings, and other state
         */
        reload() {
            // Reset data and load from beginning with current filters
            this.data = [];
            this.loadedRecords = 0;
            this.hasMore = true;
            this.totalRows = null;
            this.loadData(false);
        }

        saveColumnState() {
            const state = {
                order: this.columnOrder,
                visible: this.visibleColumns,
                widths: this.columnWidths
            };
            document.cookie = `${ this.options.cookiePrefix }-state=${ JSON.stringify(state) }; path=/; max-age=31536000`;
        }

        loadColumnState() {
            const cookies = document.cookie.split(';');
            const stateCookie = cookies.find(c => c.trim().startsWith(`${ this.options.cookiePrefix }-state=`));

            if (stateCookie) {
                try {
                    const state = JSON.parse(stateCookie.split('=')[1]);
                    this.columnOrder = state.order || [];
                    this.visibleColumns = state.visible || [];
                    this.columnWidths = state.widths || {};
                } catch (e) {
                    console.error('Error loading column state:', e);
                }
            }
        }

        saveSettings() {
            const settings = {
                compact: this.settings.compact,
                pageSize: this.settings.pageSize,
                truncateLongValues: this.settings.truncateLongValues
            };
            document.cookie = `${ this.options.cookiePrefix }-settings=${ JSON.stringify(settings) }; path=/; max-age=31536000`;
        }

        loadSettings() {
            const cookies = document.cookie.split(';');
            const settingsCookie = cookies.find(c => c.trim().startsWith(`${ this.options.cookiePrefix }-settings=`));

            if (settingsCookie) {
                try {
                    const settings = JSON.parse(settingsCookie.split('=')[1]);
                    this.settings.compact = settings.compact !== undefined ? settings.compact : false;
                    this.settings.pageSize = settings.pageSize || 20;
                    this.settings.truncateLongValues = settings.truncateLongValues !== undefined ? settings.truncateLongValues : true;

                    // Update options.pageSize to match loaded settings
                    this.options.pageSize = this.settings.pageSize;
                } catch (e) {
                    console.error('Error loading settings:', e);
                }
            }
        }

        // Modal Edit Form functionality
        async openEditForm(recordId, typeId, rowIndex) {
            if (!typeId) {
                this.showToast('Ошибка: не указан тип записи', 'error');
                return;
            }

            const isCreate = !recordId || recordId === '';

            try {
                // Fetch metadata if not cached
                if (!this.metadataCache[typeId]) {
                    this.metadataCache[typeId] = await this.fetchMetadata(typeId);
                }

                const metadata = this.metadataCache[typeId];

                let recordData = null;
                if (!isCreate) {
                    recordData = await this.fetchRecordData(recordId);
                }

                this.renderEditFormModal(metadata, recordData, isCreate, typeId);
            } catch (error) {
                console.error('Error opening edit form:', error);
                this.showToast(`Ошибка загрузки формы: ${ error.message }`, 'error');
            }
        }

        shouldShowAddButton(column) {
            // Check if column has granted: 1
            if (column.granted !== 1) {
                return false;
            }

            // Check if column has orig or type (metadata type identifier)
            const typeId = column.orig || column.type;
            if (!typeId || typeId <= 0) {
                return false;
            }

            // Check if typeId is found among the ids in global metadata response
            if (!this.globalMetadata) {
                return false;
            }

            // Check top-level metadata ids only (not reqs)
            return this.globalMetadata.some(item => item.id === typeId);
        }

        async openColumnCreateForm(columnId) {
            try {
                const column = this.columns.find(col => col.id === columnId);
                if (!column) {
                    this.showToast('Ошибка: колонка не найдена', 'error');
                    return;
                }

                // Determine typeId from column metadata
                // Priority: 1) column.orig, 2) column.type
                const typeId = column.orig || column.type;

                if (!typeId) {
                    this.showToast('Ошибка: не найден тип записи', 'error');
                    return;
                }

                // Fetch metadata and open create form
                if (!this.metadataCache[typeId]) {
                    this.metadataCache[typeId] = await this.fetchMetadata(typeId);
                }

                const metadata = this.metadataCache[typeId];

                // Render create form (recordData = null for create mode)
                this.renderEditFormModal(metadata, null, true, typeId, columnId);

            } catch (error) {
                console.error('Error opening create form from column header:', error);
                this.showToast(`Ошибка: ${ error.message }`, 'error');
            }
        }

        async fetchMetadata(typeId) {
            const apiBase = this.getApiBase();
            const response = await fetch(`${ apiBase }/metadata/${ typeId }`);

            if (!response.ok) {
                throw new Error(`Failed to fetch metadata: ${ response.statusText }`);
            }

            const text = await response.text();

            try {
                let data = JSON.parse(text);

                // Handle case where API returns an array instead of an object
                if (Array.isArray(data)) {
                    data = data[0] || {};
                }

                // Check for error in response
                if (data.error) {
                    throw new Error(data.error);
                }

                return data;
            } catch (e) {
                if (e.message && e.message.includes('error')) {
                    throw e;
                }
                throw new Error(`Invalid JSON response: ${ text }`);
            }
        }

        async fetchRecordData(recordId) {
            const apiBase = this.getApiBase();
            const response = await fetch(`${ apiBase }/edit_obj/${ recordId }?JSON`);

            if (!response.ok) {
                throw new Error(`Failed to fetch record data: ${ response.statusText }`);
            }

            const text = await response.text();

            try {
                const data = JSON.parse(text);

                // Check for error in response
                if (data.error) {
                    throw new Error(data.error);
                }

                return data;
            } catch (e) {
                if (e.message && e.message.includes('error')) {
                    throw e;
                }
                throw new Error(`Invalid JSON response: ${ text }`);
            }
        }

        async fetchReferenceOptions(requisiteId, recordId = 0, searchQuery = '') {
            const apiBase = this.getApiBase();
            const params = new URLSearchParams({
                JSON: '',
                LIMIT: '50'
            });

            if (recordId && recordId !== 0) {
                params.append('id', recordId);
            }
            if (searchQuery) {
                params.append('q', searchQuery);
            }

            const url = `${ apiBase }/_ref_reqs/${ requisiteId }?${ params }`;
            const response = await fetch(url);

            if (!response.ok) {
                throw new Error(`Failed to fetch reference options: ${ response.statusText }`);
            }

            const text = await response.text();

            try {
                const data = JSON.parse(text);

                // Check for error in response
                if (data.error) {
                    throw new Error(data.error);
                }

                return data;
            } catch (e) {
                if (e.message && e.message.includes('error')) {
                    throw e;
                }
                throw new Error(`Invalid JSON response: ${ text }`);
            }
        }

        getMetadataName(metadata) {
            return metadata.val || metadata.name || metadata.title || `Тип #${ metadata.id || '?' }`;
        }

        getApiBase() {
            // Extract base URL from apiUrl by removing query parameters and path after /report/ or /type/
            const url = this.options.apiUrl;
            if (!url) {
                // Fallback: construct API base from current page URL using the database path segment
                const pathParts = window.location.pathname.split('/');
                if (pathParts.length >= 2 && pathParts[1]) {
                    return 'https://' + window.location.hostname + '/' + pathParts[1];
                }
                return '';
            }
            const match = url.match(/^(.*?\/(report|type)\/\d+)/);
            if (match) {
                return match[1].replace(/\/(report|type)\/\d+$/, '');
            }
            // Fallback: remove everything after ? or last /
            return url.split('?')[0].replace(/\/[^\/]*$/, '');
        }

        parseAttrs(attrs) {
            const result = {
                required: false,
                multi: false,
                alias: null
            };

            if (!attrs) return result;

            result.required = attrs.includes(':!NULL:');
            result.multi = attrs.includes(':MULTI:');

            const aliasMatch = attrs.match(/:ALIAS=(.*?):/);
            if (aliasMatch) {
                result.alias = aliasMatch[1];
            }

            return result;
        }

        getFormatById(typeId) {
            // Map type IDs to format names based on TABLE_COMPONENT_README.md
            const formatMap = {
                '3': 'SHORT',
                '8': 'CHARS',
                '9': 'DATE',
                '13': 'NUMBER',
                '14': 'SIGNED',
                '11': 'BOOLEAN',
                '12': 'MEMO',
                '4': 'DATETIME',
                '10': 'FILE',
                '2': 'HTML',
                '7': 'BUTTON',
                '6': 'PWD',
                '5': 'GRANT',
                '16': 'REPORT_COLUMN',
                '17': 'PATH'
            };
            return formatMap[String(typeId)] || 'SHORT';
        }

        normalizeFormat(baseTypeId) {
            // If baseTypeId is already a symbolic format name (like "MEMO", "BOOLEAN"),
            // use it directly without conversion
            const validFormats = ['SHORT', 'CHARS', 'DATE', 'NUMBER', 'SIGNED', 'BOOLEAN',
                                  'MEMO', 'DATETIME', 'FILE', 'HTML', 'BUTTON', 'PWD',
                                  'GRANT', 'REPORT_COLUMN', 'PATH'];

            const upperTypeId = String(baseTypeId).toUpperCase();

            if (validFormats.includes(upperTypeId)) {
                // Already a symbolic format name - return as is
                return upperTypeId;
            }

            // Otherwise, it's a numeric ID - convert it
            return this.getFormatById(baseTypeId);
        }

        renderEditFormModal(metadata, recordData, isCreate, typeId, columnId = null) {
            // Track modal depth for z-index stacking
            if (!window._integramModalDepth) {
                window._integramModalDepth = 0;
            }
            window._integramModalDepth++;
            const modalDepth = window._integramModalDepth;
            const baseZIndex = 1000 + (modalDepth * 10);

            const overlay = document.createElement('div');
            overlay.className = 'edit-form-overlay';
            overlay.style.zIndex = baseZIndex;
            overlay.dataset.modalDepth = modalDepth;

            const modal = document.createElement('div');
            modal.className = 'edit-form-modal';
            modal.style.zIndex = baseZIndex + 1;
            modal.dataset.modalDepth = modalDepth;
            modal.dataset.overlayRef = 'true';

            // Add cascade offset for nested modals (6px per level)
            const cascadeOffset = (modalDepth - 1) * 6;
            modal.style.transform = `translate(calc(-50% + ${cascadeOffset}px), calc(-50% + ${cascadeOffset}px))`;

            // Store reference to overlay on modal for proper cleanup
            modal._overlayElement = overlay;

            const typeName = this.getMetadataName(metadata);
            const title = isCreate ? `Создание: ${ typeName }` : `Редактирование: ${ typeName }`;
            const instanceName = this.options.instanceName;
            const recordId = recordData && recordData.obj ? recordData.obj.id : null;

            // Separate regular fields from subordinate tables
            const reqs = metadata.reqs || [];
            const recordReqs = recordData && recordData.reqs ? recordData.reqs : {};

            // Sort by order if available
            const sortedReqs = reqs.sort((a, b) => {
                const orderA = recordReqs[a.id] ? recordReqs[a.id].order || 0 : 0;
                const orderB = recordReqs[b.id] ? recordReqs[b.id].order || 0 : 0;
                return orderA - orderB;
            });

            const regularFields = sortedReqs.filter(req => !req.arr_id);
            const subordinateTables = sortedReqs.filter(req => req.arr_id);

            // Build tabs HTML
            let tabsHtml = '';
            let hasSubordinateTables = subordinateTables.length > 0 && !isCreate && recordId;

            if (hasSubordinateTables) {
                tabsHtml = `<div class="edit-form-tabs">`;
                tabsHtml += `<div class="edit-form-tab active" data-tab="attributes">Атрибуты</div>`;

                subordinateTables.forEach(req => {
                    const attrs = this.parseAttrs(req.attrs);
                    const fieldName = attrs.alias || req.val;
                    const arrCount = recordReqs[req.id] ? recordReqs[req.id].arr || 0 : 0;
                    tabsHtml += `<div class="edit-form-tab" data-tab="sub-${ req.id }" data-arr-id="${ req.arr_id }" data-req-id="${ req.id }">${ fieldName } (${ arrCount })</div>`;
                });

                tabsHtml += `</div>`;
            }

            // Build attributes form HTML
            let attributesHtml = this.renderAttributesForm(metadata, recordData, regularFields, recordReqs, isCreate, typeId);

            let formHtml = `
                <div class="edit-form-header">
                    <h5>${ title }</h5>
                    <button class="edit-form-close" data-close-modal="true">×</button>
                </div>
                ${ tabsHtml }
                <div class="edit-form-body">
                    <div class="edit-form-tab-content active" data-tab-content="attributes">
                        <form id="edit-form" class="edit-form">
                            ${ attributesHtml }
                        </form>
                    </div>
            `;

            // Add placeholder for subordinate table contents
            if (hasSubordinateTables) {
                subordinateTables.forEach(req => {
                    formHtml += `
                        <div class="edit-form-tab-content" data-tab-content="sub-${ req.id }">
                            <div class="subordinate-table-loading">Загрузка...</div>
                        </div>
                    `;
                });
            }

            formHtml += `
                </div>
                <div class="edit-form-footer">
                    <button type="button" class="btn btn-icon form-settings-btn" id="form-settings-btn" title="Настройка видимости полей">
                        ⚙️
                    </button>
                    <div class="edit-form-footer-buttons">
                        <button type="button" class="btn btn-primary" id="save-record-btn">Сохранить</button>
                        <button type="button" class="btn btn-secondary" data-close-modal="true">Отмена</button>
                    </div>
                </div>
            `;

            modal.innerHTML = formHtml;
            document.body.appendChild(overlay);
            document.body.appendChild(modal);

            // Store modal context for subordinate tables
            this.currentEditModal = {
                modal,
                recordId,
                typeId,
                metadata,
                recordData,
                subordinateTables,
                recordReqs
            };

            // Attach tab switching handlers
            if (hasSubordinateTables) {
                this.attachTabHandlers(modal);
            }

            // Load reference options for dropdowns (scoped to this modal)
            this.loadReferenceOptions(metadata.reqs, recordId || 0, modal);

            // Attach date/datetime picker handlers
            this.attachDatePickerHandlers(modal);

            // Attach form field settings handler
            const formSettingsBtn = modal.querySelector('#form-settings-btn');
            formSettingsBtn.addEventListener('click', () => {
                this.openFormFieldSettings(typeId, metadata);
            });

            // Apply saved field visibility settings
            this.applyFormFieldSettings(modal, typeId);

            // Attach save handler
            const saveBtn = modal.querySelector('#save-record-btn');
            const parentId = recordData && recordData.obj ? recordData.obj.parent : 1;

            saveBtn.addEventListener('click', () => {
                this.saveRecord(modal, isCreate, recordId, typeId, parentId, columnId);
            });

            // Close modal helper function
            const closeModal = () => {
                modal.remove();
                overlay.remove();
                window._integramModalDepth = Math.max(0, (window._integramModalDepth || 1) - 1);
                if (modalDepth === 1) {
                    this.currentEditModal = null;
                }
            };

            // Attach close handlers to buttons with data-close-modal attribute
            modal.querySelectorAll('[data-close-modal="true"]').forEach(btn => {
                btn.addEventListener('click', closeModal);
            });

            overlay.addEventListener('click', closeModal);
        }

        renderAttributesForm(metadata, recordData, regularFields, recordReqs, isCreate = false, typeId = null) {
            let html = '';

            // Get current date/datetime for default values in create mode
            // Only applied to the first column (where req.id equals typeId)
            let currentDateHtml5 = '';
            let currentDateTimeHtml5 = '';
            let currentDateDisplay = '';
            let currentDateTimeDisplay = '';

            if (isCreate) {
                const now = new Date();
                currentDateHtml5 = now.toISOString().split('T')[0]; // YYYY-MM-DD
                const minutes = Math.round(now.getMinutes() / 5) * 5; // Round to 5 minutes
                now.setMinutes(minutes);
                currentDateTimeHtml5 = now.toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM
                currentDateDisplay = now.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '.'); // DD.MM.YYYY
                currentDateTimeDisplay = currentDateDisplay + ' ' + now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }); // DD.MM.YYYY HH:MM
            }

            // Main value field
            const typeName = this.getMetadataName(metadata);
            const mainValue = recordData && recordData.obj ? recordData.obj.val : '';
            html += `
                <div class="form-group">
                    <label for="field-main">${ typeName } <span class="required">*</span></label>
                    <input type="text" class="form-control" id="field-main" name="main" value="${ this.escapeHtml(mainValue) }" required>
                </div>
            `;

            regularFields.forEach(req => {
                const attrs = this.parseAttrs(req.attrs);
                const fieldName = attrs.alias || req.val;
                const reqValue = recordReqs[req.id] ? recordReqs[req.id].value : '';
                const baseTypeId = recordReqs[req.id] ? recordReqs[req.id].base : req.type;
                const baseFormat = this.normalizeFormat(baseTypeId);
                const isRequired = attrs.required;

                html += `<div class="form-group">`;
                html += `<label for="field-${ req.id }">${ fieldName }${ isRequired ? ' <span class="required">*</span>' : '' }</label>`;

                // Reference field (searchable dropdown with clear/add buttons - same as inline table editor)
                if (req.ref_id) {
                    const currentValue = reqValue || '';
                    html += `
                        <div class="form-reference-editor" data-ref-id="${ req.id }" data-required="${ isRequired }" data-ref-type-id="${ req.orig || req.ref_id }">
                            <div class="inline-editor-reference form-ref-editor-box">
                                <div class="inline-editor-reference-header">
                                    <input type="text"
                                           class="inline-editor-reference-search form-ref-search"
                                           id="field-${ req.id }-search"
                                           placeholder="Поиск..."
                                           autocomplete="off">
                                    <button class="inline-editor-reference-clear form-ref-clear" title="Очистить значение" aria-label="Очистить значение" type="button">×</button>
                                    <button class="inline-editor-reference-add form-ref-add" style="display: none;" title="Создать запись" aria-label="Создать запись" type="button">+</button>
                                </div>
                                <div class="inline-editor-reference-dropdown form-ref-dropdown" id="field-${ req.id }-dropdown">
                                    <div class="inline-editor-reference-empty">Загрузка...</div>
                                </div>
                            </div>
                            <input type="hidden"
                                   class="form-ref-value"
                                   id="field-${ req.id }"
                                   name="t${ req.id }"
                                   value="${ this.escapeHtml(currentValue) }"
                                   data-ref-id="${ req.id }">
                        </div>
                    `;
                }
                // Boolean field
                else if (baseFormat === 'BOOLEAN') {
                    const isChecked = reqValue ? 'checked' : '';
                    const prevValue = reqValue || '';
                    html += `<input type="checkbox" id="field-${ req.id }" name="t${ req.id }" value="1" ${ isChecked }>`;
                    html += `<input type="hidden" name="b${ req.id }" value="${ this.escapeHtml(prevValue) }">`;
                }
                // Date field with HTML5 date picker
                else if (baseFormat === 'DATE') {
                    // Only apply default value for the first column (where req.id equals typeId)
                    const isFirstColumn = typeId && String(req.id) === String(typeId);
                    const dateValueHtml5 = reqValue ? this.formatDateForHtml5(reqValue, false) : (isCreate && isFirstColumn ? currentDateHtml5 : '');
                    const dateValueDisplay = reqValue ? this.formatDateForInput(reqValue, false) : (isCreate && isFirstColumn ? currentDateDisplay : '');
                    html += `<input type="date" class="form-control date-picker" id="field-${ req.id }-picker" value="${ this.escapeHtml(dateValueHtml5) }" ${ isRequired ? 'required' : '' } data-target="field-${ req.id }">`;
                    html += `<input type="hidden" id="field-${ req.id }" name="t${ req.id }" value="${ this.escapeHtml(dateValueDisplay) }">`;
                }
                // DateTime field with HTML5 datetime-local picker (with time rounded to 5 minutes)
                else if (baseFormat === 'DATETIME') {
                    // Only apply default value for the first column (where req.id equals typeId)
                    const isFirstColumn = typeId && String(req.id) === String(typeId);
                    const dateTimeValueHtml5 = reqValue ? this.formatDateForHtml5(reqValue, true) : (isCreate && isFirstColumn ? currentDateTimeHtml5 : '');
                    const dateTimeValueDisplay = reqValue ? this.formatDateForInput(reqValue, true) : (isCreate && isFirstColumn ? currentDateTimeDisplay : '');
                    html += `<input type="datetime-local" class="form-control datetime-picker" id="field-${ req.id }-picker" value="${ this.escapeHtml(dateTimeValueHtml5) }" ${ isRequired ? 'required' : '' } data-target="field-${ req.id }" step="300">`;
                    html += `<input type="hidden" id="field-${ req.id }" name="t${ req.id }" value="${ this.escapeHtml(dateTimeValueDisplay) }">`;
                }
                // MEMO field (multi-line text, 4 rows)
                else if (baseFormat === 'MEMO') {
                    html += `<textarea class="form-control memo-field" id="field-${ req.id }" name="t${ req.id }" rows="4" ${ isRequired ? 'required' : '' }>${ this.escapeHtml(reqValue) }</textarea>`;
                }
                // Regular text field
                else {
                    html += `<input type="text" class="form-control" id="field-${ req.id }" name="t${ req.id }" value="${ this.escapeHtml(reqValue) }" ${ isRequired ? 'required' : '' }>`;
                }

                html += `</div>`;
            });

            return html;
        }

        attachTabHandlers(modal) {
            const tabs = modal.querySelectorAll('.edit-form-tab');
            const instanceName = this.options.instanceName;

            tabs.forEach(tab => {
                tab.addEventListener('click', async () => {
                    const tabId = tab.dataset.tab;

                    // Update active tab
                    tabs.forEach(t => t.classList.remove('active'));
                    tab.classList.add('active');

                    // Update active content
                    const contents = modal.querySelectorAll('.edit-form-tab-content');
                    contents.forEach(c => c.classList.remove('active'));

                    const targetContent = modal.querySelector(`[data-tab-content="${ tabId }"]`);
                    if (targetContent) {
                        targetContent.classList.add('active');
                    }

                    // Load subordinate table if needed
                    if (tabId.startsWith('sub-') && tab.dataset.arrId) {
                        const arrId = tab.dataset.arrId;
                        const reqId = tab.dataset.reqId;
                        const parentRecordId = this.currentEditModal.recordId;

                        // Check if already loaded
                        if (!targetContent.dataset.loaded) {
                            await this.loadSubordinateTable(targetContent, arrId, parentRecordId, reqId);
                            targetContent.dataset.loaded = 'true';
                        }
                    }

                    // Show/hide footer buttons based on tab
                    const footer = modal.querySelector('.edit-form-footer');
                    if (tabId === 'attributes') {
                        footer.style.display = 'flex';
                        // Collapse modal back to normal size
                        modal.classList.remove('expanded');
                    } else {
                        footer.style.display = 'none';
                        // Expand modal to fit subordinate table
                        modal.classList.add('expanded');
                    }
                });
            });
        }

        async loadSubordinateTable(container, arrId, parentRecordId, reqId) {
            container.innerHTML = '<div class="subordinate-table-loading">Загрузка...</div>';

            try {
                // Fetch metadata for subordinate table
                const metadata = await this.fetchMetadata(arrId);

                // Fetch data for subordinate table
                const apiBase = this.getApiBase();
                const dataUrl = `${ apiBase }/object/${ arrId }/?JSON_DATA&F_U=${ parentRecordId }`;
                const dataResponse = await fetch(dataUrl);
                const data = await dataResponse.json();

                // Render the subordinate table
                this.renderSubordinateTable(container, metadata, data, arrId, parentRecordId);

            } catch (error) {
                console.error('Error loading subordinate table:', error);
                container.innerHTML = `<div class="subordinate-table-error">Ошибка загрузки: ${ error.message }</div>`;
            }
        }

        renderSubordinateTable(container, metadata, data, arrId, parentRecordId) {
            const instanceName = this.options.instanceName;
            const rows = Array.isArray(data) ? data : [];

            let html = `
                <div class="subordinate-table-toolbar">
                    <button type="button" class="btn btn-sm btn-primary subordinate-add-btn" data-arr-id="${ arrId }" data-parent-id="${ parentRecordId }">
                        + Добавить
                    </button>
                </div>
            `;

            if (rows.length === 0) {
                html += `<div class="subordinate-table-empty">Нет записей</div>`;
            } else {
                const reqs = metadata.reqs || [];

                html += `<div class="subordinate-table-wrapper"><table class="subordinate-table"><thead><tr>`;

                // Header: main value column + requisite columns
                html += `<th>${ this.getMetadataName(metadata) }</th>`;
                reqs.forEach(req => {
                    const attrs = this.parseAttrs(req.attrs);
                    const fieldName = attrs.alias || req.val;
                    html += `<th>${ fieldName }</th>`;
                });

                html += `</tr></thead><tbody>`;

                // Data rows
                rows.forEach(row => {
                    const rowId = row.i;
                    const values = row.r || [];

                    html += `<tr data-row-id="${ rowId }">`;

                    // First column (main value) - clickable to edit
                    const mainValue = values[0] || '';
                    // Pass metadata type information for proper formatting
                    const mainFieldInfo = { type: metadata.type };
                    const displayMainValue = this.formatSubordinateCellValue(mainValue, mainFieldInfo);
                    html += `<td class="subordinate-cell-clickable" data-row-id="${ rowId }" data-type-id="${ arrId }">${ displayMainValue }</td>`;

                    // Other columns
                    reqs.forEach((req, idx) => {
                        // values[0] is main value, requisites start from index 1
                        const cellValue = values[idx + 1] !== undefined ? values[idx + 1] : '';

                        // Check if this requisite has subordinate tables (arr_id)
                        if (req.arr_id) {
                            // Show just the count in parentheses
                            const count = typeof cellValue === 'number' ? cellValue : (cellValue || 0);
                            html += `<td class="subordinate-nested-count">(${ count })</td>`;
                        } else {
                            const displayValue = this.formatSubordinateCellValue(cellValue, req);
                            html += `<td>${ displayValue }</td>`;
                        }
                    });

                    html += `</tr>`;
                });

                html += `</tbody></table></div>`;
            }

            container.innerHTML = html;

            // Attach click handlers for editing rows
            const clickableCells = container.querySelectorAll('.subordinate-cell-clickable');
            clickableCells.forEach(cell => {
                cell.addEventListener('click', () => {
                    const rowId = cell.dataset.rowId;
                    const typeId = cell.dataset.typeId;
                    this.openEditForm(rowId, typeId, 0);
                });
            });

            // Attach add button handler
            const addBtn = container.querySelector('.subordinate-add-btn');
            if (addBtn) {
                addBtn.addEventListener('click', () => {
                    this.createSubordinateRecord(arrId, parentRecordId);
                });
            }
        }

        formatSubordinateCellValue(value, req) {
            if (value === null || value === undefined || value === '') {
                return '';
            }

            // Handle reference values (format: "id:label")
            if (typeof value === 'string' && value.includes(':')) {
                const parts = value.split(':');
                if (parts.length >= 2 && !isNaN(parseInt(parts[0]))) {
                    // It's a reference value, show the label
                    return this.escapeHtml(parts.slice(1).join(':'));
                }
            }

            // Format based on type if req is provided
            if (req) {
                const baseFormat = this.normalizeFormat(req.type);

                switch (baseFormat) {
                    case 'BOOLEAN':
                        return value ? 'Да' : 'Нет';
                    case 'DATE':
                        if (value) {
                            const dateObj = this.parseDDMMYYYY(value);
                            if (dateObj && !isNaN(dateObj.getTime())) {
                                return this.formatDateDisplay(dateObj);
                            }
                        }
                        break;
                    case 'DATETIME':
                        if (value) {
                            const datetimeObj = this.parseDDMMYYYYHHMMSS(value);
                            if (datetimeObj && !isNaN(datetimeObj.getTime())) {
                                return this.formatDateTimeDisplay(datetimeObj);
                            }
                        }
                        break;
                }
            }

            return this.escapeHtml(String(value));
        }

        async createSubordinateRecord(arrId, parentRecordId) {
            try {
                // Fetch metadata for the subordinate table type
                if (!this.metadataCache[arrId]) {
                    this.metadataCache[arrId] = await this.fetchMetadata(arrId);
                }

                const metadata = this.metadataCache[arrId];

                // Open create form with parent ID
                this.renderSubordinateCreateForm(metadata, arrId, parentRecordId);

            } catch (error) {
                console.error('Error creating subordinate record:', error);
                this.showToast(`Ошибка: ${ error.message }`, 'error');
            }
        }

        renderSubordinateCreateForm(metadata, arrId, parentRecordId) {
            // Track modal depth for z-index stacking
            if (!window._integramModalDepth) {
                window._integramModalDepth = 0;
            }
            window._integramModalDepth++;
            const modalDepth = window._integramModalDepth;
            const baseZIndex = 1000 + (modalDepth * 10);

            // Create a new form modal for subordinate record
            const overlay = document.createElement('div');
            overlay.className = 'edit-form-overlay subordinate-form-overlay';
            overlay.style.zIndex = baseZIndex;
            overlay.dataset.modalDepth = modalDepth;

            const modal = document.createElement('div');
            modal.className = 'edit-form-modal subordinate-form-modal';
            modal.style.zIndex = baseZIndex + 1;
            modal.dataset.modalDepth = modalDepth;

            // Add cascade offset for nested modals (6px per level)
            const cascadeOffset = (modalDepth - 1) * 6;
            modal.style.transform = `translate(calc(-50% + ${cascadeOffset}px), calc(-50% + ${cascadeOffset}px))`;

            const typeName = this.getMetadataName(metadata);
            const title = `Создание: ${ typeName }`;

            // Build form for regular fields only (no nested subordinate tables in create mode)
            const reqs = metadata.reqs || [];
            const regularFields = reqs.filter(req => !req.arr_id);

            // Determine the type of the main (first column) field
            const mainFieldType = this.normalizeFormat(metadata.type);

            // Get current date/datetime for default values
            const now = new Date();
            const currentDateHtml5 = now.toISOString().split('T')[0]; // YYYY-MM-DD
            const minutes = Math.round(now.getMinutes() / 5) * 5; // Round to 5 minutes
            now.setMinutes(minutes);
            const currentDateTimeHtml5 = now.toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM
            const currentDateDisplay = now.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '.'); // DD.MM.YYYY
            const currentDateTimeDisplay = currentDateDisplay + ' ' + now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }); // DD.MM.YYYY HH:MM

            // Build main field HTML based on its type
            let mainFieldHtml = '';
            if (mainFieldType === 'BOOLEAN') {
                mainFieldHtml = `<input type="checkbox" id="sub-field-main" name="main" value="1">`;
            } else if (mainFieldType === 'DATE') {
                mainFieldHtml = `<input type="date" class="form-control date-picker" id="sub-field-main-picker" required data-target="sub-field-main" value="${ currentDateHtml5 }">`;
                mainFieldHtml += `<input type="hidden" id="sub-field-main" name="main" value="${ currentDateDisplay }">`;
            } else if (mainFieldType === 'DATETIME') {
                mainFieldHtml = `<input type="datetime-local" class="form-control datetime-picker" id="sub-field-main-picker" required data-target="sub-field-main" step="300" value="${ currentDateTimeHtml5 }">`;
                mainFieldHtml += `<input type="hidden" id="sub-field-main" name="main" value="${ currentDateTimeDisplay }">`;
            } else if (mainFieldType === 'NUMBER' || mainFieldType === 'SIGNED') {
                mainFieldHtml = `<input type="number" class="form-control" id="sub-field-main" name="main" value="" required ${ mainFieldType === 'SIGNED' ? 'step="0.01"' : '' }>`;
            } else if (mainFieldType === 'MEMO') {
                mainFieldHtml = `<textarea class="form-control memo-field" id="sub-field-main" name="main" rows="4" required></textarea>`;
            } else {
                // Default: text input (SHORT, CHARS, etc.)
                mainFieldHtml = `<input type="text" class="form-control" id="sub-field-main" name="main" value="" required>`;
            }

            let formHtml = `
                <div class="edit-form-header">
                    <h5>${ title }</h5>
                    <button class="edit-form-close subordinate-close-btn">×</button>
                </div>
                <div class="edit-form-body">
                    <form id="subordinate-edit-form" class="edit-form">
                        <div class="form-group">
                            <label for="sub-field-main">${ typeName } <span class="required">*</span></label>
                            ${ mainFieldHtml }
                        </div>
            `;

            regularFields.forEach(req => {
                const attrs = this.parseAttrs(req.attrs);
                const fieldName = attrs.alias || req.val;
                const baseFormat = this.normalizeFormat(req.type);
                const isRequired = attrs.required;

                formHtml += `<div class="form-group">`;
                formHtml += `<label for="sub-field-${ req.id }">${ fieldName }${ isRequired ? ' <span class="required">*</span>' : '' }</label>`;

                // Reference field (searchable dropdown with clear/add buttons - same as inline table editor)
                if (req.ref_id) {
                    formHtml += `
                        <div class="form-reference-editor" data-ref-id="${ req.id }" data-required="${ isRequired }" data-ref-type-id="${ req.orig || req.ref_id }">
                            <div class="inline-editor-reference form-ref-editor-box">
                                <div class="inline-editor-reference-header">
                                    <input type="text"
                                           class="inline-editor-reference-search form-ref-search"
                                           id="sub-field-${ req.id }-search"
                                           placeholder="Поиск..."
                                           autocomplete="off">
                                    <button class="inline-editor-reference-clear form-ref-clear" title="Очистить значение" aria-label="Очистить значение" type="button">×</button>
                                    <button class="inline-editor-reference-add form-ref-add" style="display: none;" title="Создать запись" aria-label="Создать запись" type="button">+</button>
                                </div>
                                <div class="inline-editor-reference-dropdown form-ref-dropdown" id="sub-field-${ req.id }-dropdown">
                                    <div class="inline-editor-reference-empty">Загрузка...</div>
                                </div>
                            </div>
                            <input type="hidden"
                                   class="form-ref-value"
                                   id="sub-field-${ req.id }"
                                   name="t${ req.id }"
                                   value=""
                                   data-ref-id="${ req.id }">
                        </div>
                    `;
                }
                else if (baseFormat === 'BOOLEAN') {
                    formHtml += `<input type="checkbox" id="sub-field-${ req.id }" name="t${ req.id }" value="1">`;
                }
                else if (baseFormat === 'DATE') {
                    // Only apply default value for the first column (where req.id equals arrId)
                    const isFirstColumn = String(req.id) === String(arrId);
                    const dateValue = isFirstColumn ? currentDateHtml5 : '';
                    const dateDisplay = isFirstColumn ? currentDateDisplay : '';
                    formHtml += `<input type="date" class="form-control date-picker" id="sub-field-${ req.id }-picker" ${ isRequired ? 'required' : '' } data-target="sub-field-${ req.id }" value="${ dateValue }">`;
                    formHtml += `<input type="hidden" id="sub-field-${ req.id }" name="t${ req.id }" value="${ dateDisplay }">`;
                }
                else if (baseFormat === 'DATETIME') {
                    // Only apply default value for the first column (where req.id equals arrId)
                    const isFirstColumn = String(req.id) === String(arrId);
                    const dateTimeValue = isFirstColumn ? currentDateTimeHtml5 : '';
                    const dateTimeDisplay = isFirstColumn ? currentDateTimeDisplay : '';
                    formHtml += `<input type="datetime-local" class="form-control datetime-picker" id="sub-field-${ req.id }-picker" ${ isRequired ? 'required' : '' } data-target="sub-field-${ req.id }" step="300" value="${ dateTimeValue }">`;
                    formHtml += `<input type="hidden" id="sub-field-${ req.id }" name="t${ req.id }" value="${ dateTimeDisplay }">`;
                }
                else if (baseFormat === 'MEMO') {
                    formHtml += `<textarea class="form-control memo-field" id="sub-field-${ req.id }" name="t${ req.id }" rows="4" ${ isRequired ? 'required' : '' }></textarea>`;
                }
                else {
                    formHtml += `<input type="text" class="form-control" id="sub-field-${ req.id }" name="t${ req.id }" value="" ${ isRequired ? 'required' : '' }>`;
                }

                formHtml += `</div>`;
            });

            formHtml += `
                    </form>
                </div>
                <div class="edit-form-footer">
                    <div class="edit-form-footer-buttons">
                        <button type="button" class="btn btn-primary" id="subordinate-save-btn">Создать</button>
                        <button type="button" class="btn btn-secondary subordinate-cancel-btn">Отмена</button>
                    </div>
                </div>
            `;

            modal.innerHTML = formHtml;
            document.body.appendChild(overlay);
            document.body.appendChild(modal);

            // Load reference options (scoped to this modal)
            this.loadReferenceOptions(regularFields, 0, modal);

            // Attach date picker handlers
            this.attachDatePickerHandlers(modal);

            // Close handlers
            const closeModal = () => {
                modal.remove();
                overlay.remove();
                window._integramModalDepth = Math.max(0, (window._integramModalDepth || 1) - 1);
            };

            modal.querySelector('.subordinate-close-btn').addEventListener('click', closeModal);
            modal.querySelector('.subordinate-cancel-btn').addEventListener('click', closeModal);
            overlay.addEventListener('click', closeModal);

            // Save handler
            modal.querySelector('#subordinate-save-btn').addEventListener('click', async () => {
                const form = modal.querySelector('#subordinate-edit-form');

                if (!form.checkValidity()) {
                    form.reportValidity();
                    return;
                }

                const formData = new FormData(form);
                const params = new URLSearchParams();

                if (typeof xsrf !== 'undefined') {
                    params.append('_xsrf', xsrf);
                }

                // Skip empty parameters when creating so server can fill defaults
                for (const [key, value] of formData.entries()) {
                    if (value !== '' && value !== null && value !== undefined) {
                        params.append(key, value);
                    }
                }

                const mainValue = formData.get('main');
                if (mainValue !== '' && mainValue !== null && mainValue !== undefined) {
                    params.append('t0', mainValue);
                }

                const apiBase = this.getApiBase();
                const url = `${ apiBase }/_m_new/${ arrId }?JSON&up=${ parentRecordId }`;

                try {
                    const response = await fetch(url, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                        body: params.toString()
                    });

                    const result = await response.json();

                    if (result.error) {
                        throw new Error(result.error);
                    }

                    closeModal();
                    this.showToast('Запись создана', 'success');

                    // Reload the subordinate table
                    if (this.currentEditModal) {
                        const tabContent = this.currentEditModal.modal.querySelector(`[data-tab-content="sub-${ this.currentEditModal.subordinateTables.find(t => t.arr_id === arrId)?.id }"]`);
                        if (tabContent) {
                            tabContent.dataset.loaded = '';
                            await this.loadSubordinateTable(tabContent, arrId, parentRecordId);
                            tabContent.dataset.loaded = 'true';

                            // Update tab count
                            const tab = this.currentEditModal.modal.querySelector(`[data-arr-id="${ arrId }"]`);
                            if (tab) {
                                const currentText = tab.textContent;
                                const match = currentText.match(/^(.+)\s*\((\d+)\)$/);
                                if (match) {
                                    const newCount = parseInt(match[2]) + 1;
                                    tab.textContent = `${ match[1] } (${ newCount })`;
                                }
                            }
                        }
                    }

                } catch (error) {
                    console.error('Error creating subordinate record:', error);
                    this.showToast(`Ошибка: ${ error.message }`, 'error');
                }
            });
        }

        attachDatePickerHandlers(modal) {
            // Handle date pickers
            const datePickers = modal.querySelectorAll('.date-picker');
            datePickers.forEach(picker => {
                picker.addEventListener('change', (e) => {
                    const targetId = picker.dataset.target;
                    const hiddenInput = modal.querySelector(`#${ targetId }`);
                    if (hiddenInput) {
                        const displayValue = this.convertHtml5DateToDisplay(picker.value, false);
                        hiddenInput.value = displayValue;
                    }
                });
            });

            // Handle datetime pickers
            const datetimePickers = modal.querySelectorAll('.datetime-picker');
            datetimePickers.forEach(picker => {
                picker.addEventListener('change', (e) => {
                    const targetId = picker.dataset.target;
                    const hiddenInput = modal.querySelector(`#${ targetId }`);
                    if (hiddenInput) {
                        const displayValue = this.convertHtml5DateToDisplay(picker.value, true);
                        hiddenInput.value = displayValue;
                    }
                });
            });
        }

        async loadReferenceOptions(reqs, recordId, modalElement) {
            // Load reference options for the new form-reference-editor elements
            // Scope query to the specific modal to avoid affecting other open modals
            const container = modalElement || document;
            const formRefEditors = container.querySelectorAll('.form-reference-editor');

            for (const wrapper of formRefEditors) {
                const refReqId = wrapper.dataset.refId;
                const refTypeId = wrapper.dataset.refTypeId;
                const searchInput = wrapper.querySelector('.form-ref-search');
                const dropdown = wrapper.querySelector('.form-ref-dropdown');
                const hiddenInput = wrapper.querySelector('.form-ref-value');
                const clearButton = wrapper.querySelector('.form-ref-clear');
                const addButton = wrapper.querySelector('.form-ref-add');

                if (!searchInput || !dropdown || !hiddenInput) continue;

                try {
                    const options = await this.fetchReferenceOptions(refReqId, recordId);

                    // Store options data on the wrapper
                    wrapper._referenceOptions = options;
                    wrapper._allOptionsFetched = Object.keys(options).length < 50;

                    // Render options (hidden by default, shown on focus)
                    this.renderFormReferenceOptions(dropdown, options, hiddenInput, searchInput);
                    dropdown.style.display = 'none';

                    // Set current value if exists
                    if (hiddenInput.value) {
                        const currentLabel = options[hiddenInput.value];
                        if (currentLabel) {
                            searchInput.value = currentLabel;
                        }
                    }

                    // Handle search input
                    let searchTimeout;
                    searchInput.addEventListener('input', async (e) => {
                        const searchText = e.target.value.trim();

                        // Toggle buttons based on search input length (like inline editor)
                        if (searchText.length > 0) {
                            if (addButton) addButton.style.display = '';
                            if (clearButton) clearButton.style.display = 'none';
                        } else {
                            if (addButton) addButton.style.display = 'none';
                            if (clearButton) clearButton.style.display = '';
                        }

                        clearTimeout(searchTimeout);
                        searchTimeout = setTimeout(async () => {
                            if (searchText === '') {
                                this.renderFormReferenceOptions(dropdown, wrapper._referenceOptions, hiddenInput, searchInput);
                            } else {
                                // Filter locally first
                                const filtered = {};
                                for (const [id, text] of Object.entries(wrapper._referenceOptions)) {
                                    if (text.toLowerCase().includes(searchText.toLowerCase())) {
                                        filtered[id] = text;
                                    }
                                }
                                this.renderFormReferenceOptions(dropdown, filtered, hiddenInput, searchInput);

                                // If not all fetched, re-query from server
                                if (!wrapper._allOptionsFetched) {
                                    try {
                                        const serverOptions = await this.fetchReferenceOptions(refReqId, recordId, searchText);
                                        wrapper._referenceOptions = serverOptions;
                                        this.renderFormReferenceOptions(dropdown, serverOptions, hiddenInput, searchInput);
                                    } catch (error) {
                                        console.error('Error re-querying reference options:', error);
                                    }
                                }
                            }
                            dropdown.style.display = 'block';
                        }, 300);
                    });

                    // Show dropdown on focus
                    searchInput.addEventListener('focus', () => {
                        dropdown.style.display = 'block';
                    });

                    // Handle keyboard navigation
                    searchInput.addEventListener('keydown', (e) => {
                        if (e.key === 'ArrowDown') {
                            e.preventDefault();
                            const firstOption = dropdown.querySelector('.inline-editor-reference-option');
                            if (firstOption) firstOption.focus();
                        } else if (e.key === 'Enter') {
                            e.preventDefault();
                            const firstOption = dropdown.querySelector('.inline-editor-reference-option');
                            if (firstOption) firstOption.click();
                        }
                    });

                    // Handle keyboard navigation in dropdown
                    dropdown.addEventListener('keydown', (e) => {
                        const currentOption = document.activeElement;
                        if (e.key === 'ArrowDown') {
                            e.preventDefault();
                            const nextOption = currentOption.nextElementSibling;
                            if (nextOption && nextOption.classList.contains('inline-editor-reference-option')) nextOption.focus();
                        } else if (e.key === 'ArrowUp') {
                            e.preventDefault();
                            const prevOption = currentOption.previousElementSibling;
                            if (prevOption && prevOption.classList.contains('inline-editor-reference-option')) {
                                prevOption.focus();
                            } else {
                                searchInput.focus();
                            }
                        } else if (e.key === 'Enter') {
                            e.preventDefault();
                            currentOption.click();
                        }
                    });

                    // Handle option selection via click delegation
                    dropdown.addEventListener('click', (e) => {
                        const option = e.target.closest('.inline-editor-reference-option');
                        if (option) {
                            hiddenInput.value = option.dataset.id;
                            searchInput.value = option.dataset.text;
                            dropdown.style.display = 'none';
                        }
                    });

                    // Handle clear button
                    if (clearButton) {
                        clearButton.addEventListener('click', (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            hiddenInput.value = '';
                            searchInput.value = '';
                            this.renderFormReferenceOptions(dropdown, wrapper._referenceOptions, hiddenInput, searchInput);
                            dropdown.style.display = 'block';
                        });
                    }

                    // Handle add button (create new record)
                    if (addButton && refTypeId) {
                        addButton.addEventListener('click', async (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            const inputValue = searchInput.value.trim();
                            await this.openCreateFormForFormReference(refTypeId, inputValue, recordId, hiddenInput, searchInput, wrapper, dropdown);
                        });
                    }

                    // Hide dropdown when clicking outside the reference editor wrapper
                    document.addEventListener('click', (e) => {
                        if (!wrapper.contains(e.target)) {
                            dropdown.style.display = 'none';
                        }
                    });

                } catch (error) {
                    console.error('Error loading reference options:', error);
                    dropdown.innerHTML = '<div class="inline-editor-reference-empty">Ошибка загрузки</div>';
                }
            }
        }

        renderFormReferenceOptions(dropdown, options, hiddenInput, searchInput) {
            dropdown.innerHTML = '';

            const entries = Object.entries(options);

            if (entries.length === 0) {
                dropdown.innerHTML = '<div class="inline-editor-reference-empty">Нет доступных значений</div>';
                return;
            }

            entries.forEach(([id, text]) => {
                const escapedText = this.escapeHtml(text);
                const optionDiv = document.createElement('div');
                optionDiv.className = 'inline-editor-reference-option';
                optionDiv.textContent = text;
                optionDiv.dataset.id = id;
                optionDiv.dataset.text = text;
                optionDiv.tabIndex = 0;

                // Highlight if selected
                if (hiddenInput.value === id) {
                    optionDiv.style.backgroundColor = 'var(--md-selected)';
                    optionDiv.style.color = 'var(--md-primary)';
                    optionDiv.style.fontWeight = '500';
                }

                dropdown.appendChild(optionDiv);
            });
        }

        async openCreateFormForFormReference(typeId, initialValue, parentRecordId, hiddenInput, searchInput, wrapper, dropdown) {
            // Open a create form for new record from form reference field
            // After creation, set the newly created record ID and value in the reference field
            try {
                if (!this.metadataCache[typeId]) {
                    this.metadataCache[typeId] = await this.fetchMetadata(typeId);
                }

                const metadata = this.metadataCache[typeId];
                this.renderCreateFormForFormReference(metadata, typeId, initialValue, parentRecordId, hiddenInput, searchInput, wrapper, dropdown);

            } catch (error) {
                console.error('Error opening create form for form reference:', error);
                this.showToast(`Ошибка открытия формы: ${error.message}`, 'error');
            }
        }

        renderCreateFormForFormReference(metadata, typeId, initialValue, parentRecordId, hiddenInput, searchInput, wrapper, dropdown) {
            // Track modal depth for z-index stacking
            if (!window._integramModalDepth) {
                window._integramModalDepth = 0;
            }
            window._integramModalDepth++;
            const modalDepth = window._integramModalDepth;
            const baseZIndex = 1000 + (modalDepth * 10);

            const overlay = document.createElement('div');
            overlay.className = 'edit-form-overlay';
            overlay.style.zIndex = baseZIndex;
            overlay.dataset.modalDepth = modalDepth;

            const modal = document.createElement('div');
            modal.className = 'edit-form-modal';
            modal.style.zIndex = baseZIndex + 1;
            modal.dataset.modalDepth = modalDepth;
            modal.dataset.overlayRef = 'true';

            // Add cascade offset for nested modals (6px per level)
            const cascadeOffset = (modalDepth - 1) * 6;
            modal.style.transform = `translate(calc(-50% + ${cascadeOffset}px), calc(-50% + ${cascadeOffset}px))`;

            modal._overlayElement = overlay;

            const typeName = this.getMetadataName(metadata);
            const title = `Создание: ${typeName}`;

            const reqs = metadata.reqs || [];
            const regularFields = reqs.filter(req => !req.arr_id);

            let attributesHtml = `
                <div class="form-group">
                    <label for="field-main-form-ref-create">${typeName} <span class="required">*</span></label>
                    <input type="text" class="form-control" id="field-main-form-ref-create" name="main" value="${this.escapeHtml(initialValue)}" required>
                </div>
            `;

            regularFields.forEach(req => {
                const attrs = this.parseAttrs(req.attrs);
                const fieldName = attrs.alias || req.val;
                const isRequired = attrs.required;

                attributesHtml += `<div class="form-group">`;
                attributesHtml += `<label for="field-form-ref-${req.id}">${fieldName}${isRequired ? ' <span class="required">*</span>' : ''}</label>`;

                // Check if this is a reference field
                if (req.ref_id) {
                    // Render as reference dropdown (same as in edit form)
                    attributesHtml += `
                        <div class="form-reference-editor" data-ref-id="${req.id}" data-required="${isRequired}" data-ref-type-id="${req.orig || req.ref_id}">
                            <div class="inline-editor-reference form-ref-editor-box">
                                <div class="inline-editor-reference-header">
                                    <input type="text"
                                           class="inline-editor-reference-search form-ref-search"
                                           id="field-form-ref-${req.id}-search"
                                           placeholder="Поиск..."
                                           autocomplete="off">
                                    <button class="inline-editor-reference-clear form-ref-clear" title="Очистить значение" aria-label="Очистить значение" type="button">×</button>
                                    <button class="inline-editor-reference-add form-ref-add" style="display: none;" title="Создать запись" aria-label="Создать запись" type="button">+</button>
                                </div>
                                <div class="inline-editor-reference-dropdown form-ref-dropdown" id="field-form-ref-${req.id}-dropdown">
                                    <div class="inline-editor-reference-empty">Загрузка...</div>
                                </div>
                            </div>
                            <input type="hidden"
                                   class="form-ref-value"
                                   id="field-form-ref-${req.id}"
                                   name="t${req.id}"
                                   value=""
                                   data-ref-id="${req.id}">
                        </div>
                    `;
                } else {
                    // Render as simple text input
                    attributesHtml += `<input type="text" class="form-control" id="field-form-ref-${req.id}" name="t${req.id}"${isRequired ? ' required' : ''}>`;
                }

                attributesHtml += `</div>`;
            });

            let formHtml = `
                <div class="edit-form-header">
                    <h5>${title}</h5>
                    <button class="edit-form-close" data-close-form-ref-modal="true">×</button>
                </div>
                <div class="edit-form-body">
                    <form id="edit-form-form-ref-create" class="edit-form">
                        ${attributesHtml}
                    </form>
                </div>
                <div class="edit-form-footer">
                    <div class="edit-form-footer-buttons">
                        <button type="button" class="btn btn-primary" id="save-form-ref-btn">Сохранить</button>
                        <button type="button" class="btn btn-secondary" data-close-form-ref-modal="true">Отмена</button>
                    </div>
                </div>
            `;

            modal.innerHTML = formHtml;
            document.body.appendChild(overlay);
            document.body.appendChild(modal);

            // Load reference options for dropdown fields
            this.loadReferenceOptions(regularFields, parentRecordId, modal);

            // Attach save handler
            const saveBtn = modal.querySelector('#save-form-ref-btn');
            saveBtn.addEventListener('click', async () => {
                await this.saveRecordForFormReference(modal, overlay, typeId, parentRecordId, hiddenInput, searchInput, wrapper, dropdown);
            });

            // Close modal helper
            const closeModal = () => {
                modal.remove();
                overlay.remove();
                window._integramModalDepth = Math.max(0, (window._integramModalDepth || 1) - 1);
            };

            modal.querySelectorAll('[data-close-form-ref-modal="true"]').forEach(btn => {
                btn.addEventListener('click', closeModal);
            });

            overlay.addEventListener('click', closeModal);
        }

        async saveRecordForFormReference(modal, overlay, typeId, parentRecordId, hiddenInput, searchInput, wrapper, dropdown) {
            const form = modal.querySelector('#edit-form-form-ref-create');

            if (!form.checkValidity()) {
                form.reportValidity();
                return;
            }

            const formData = new FormData(form);
            const params = new URLSearchParams();

            if (typeof xsrf !== 'undefined') {
                params.append('_xsrf', xsrf);
            }

            const mainValue = formData.get('main');

            for (const [key, value] of formData.entries()) {
                if (key === 'main') continue;
                if (value !== '' && value !== null && value !== undefined) {
                    params.append(key, value);
                }
            }

            if (mainValue !== '' && mainValue !== null && mainValue !== undefined) {
                params.append(`t${ typeId }`, mainValue);
            }

            const apiBase = this.getApiBase();
            const url = `${apiBase}/_m_new/${typeId}?JSON&up=1`;

            try {
                const response = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded'
                    },
                    body: params.toString()
                });

                const text = await response.text();

                let result;
                try {
                    result = JSON.parse(text);
                } catch (e) {
                    if (text.includes('error') || !response.ok) {
                        throw new Error(text);
                    }
                    result = { success: true };
                }

                if (result.error) {
                    throw new Error(result.error);
                }

                const createdId = result.obj || result.id || result.i;
                const createdValue = result.val || mainValue;


                // Close the create form modal
                modal.remove();
                overlay.remove();
                window._integramModalDepth = Math.max(0, (window._integramModalDepth || 1) - 1);

                this.showToast('Запись успешно создана', 'success');

                // Set the created record in the form reference field
                if (createdId) {
                    hiddenInput.value = createdId;
                    searchInput.value = createdValue;
                    dropdown.style.display = 'none';

                    // Re-fetch options to include the new record
                    try {
                        const refReqId = wrapper.dataset.refId;
                        const newOptions = await this.fetchReferenceOptions(refReqId, parentRecordId);
                        wrapper._referenceOptions = newOptions;
                    } catch (err) {
                        console.error('Error re-fetching reference options:', err);
                    }
                }

            } catch (error) {
                console.error('Error saving record for form reference:', error);
                this.showToast(`Ошибка сохранения: ${error.message}`, 'error');
            }
        }

        // Form field visibility settings
        openFormFieldSettings(typeId, metadata) {
            const overlay = document.createElement('div');
            overlay.className = 'form-field-settings-overlay';

            const modal = document.createElement('div');
            modal.className = 'form-field-settings-modal';

            const visibleFields = this.loadFormFieldVisibility(typeId);

            let modalHtml = `
                <div class="form-field-settings-header">
                    <h5>Настройка видимости полей</h5>
                    <button class="form-field-settings-close">&times;</button>
                </div>
                <div class="form-field-settings-body">
                    <p class="form-field-settings-info">Выберите поля, которые должны отображаться в форме редактирования:</p>
                    <div class="form-field-settings-list">
            `;

            // Add checkbox for each requisite
            const reqs = metadata.reqs || [];
            reqs.forEach(req => {
                const attrs = this.parseAttrs(req.attrs);
                const fieldName = attrs.alias || req.val;
                const fieldId = req.id;
                const isChecked = visibleFields[fieldId] !== false; // Default to visible

                modalHtml += `
                    <div class="form-field-settings-item">
                        <label>
                            <input type="checkbox"
                                   class="form-field-visibility-checkbox"
                                   data-field-id="${ fieldId }"
                                   ${ isChecked ? 'checked' : '' }>
                            <span>${ fieldName }</span>
                        </label>
                    </div>
                `;
            });

            modalHtml += `
                    </div>
                </div>
                <div class="form-field-settings-footer">
                    <button type="button" class="btn btn-primary form-field-settings-save">Сохранить</button>
                    <button type="button" class="btn btn-secondary form-field-settings-cancel">Отмена</button>
                </div>
            `;

            modal.innerHTML = modalHtml;
            document.body.appendChild(overlay);
            document.body.appendChild(modal);

            // Attach handlers
            const closeBtn = modal.querySelector('.form-field-settings-close');
            const cancelBtn = modal.querySelector('.form-field-settings-cancel');
            const saveBtn = modal.querySelector('.form-field-settings-save');

            const closeModal = () => {
                modal.remove();
                overlay.remove();
            };

            closeBtn.addEventListener('click', closeModal);
            cancelBtn.addEventListener('click', closeModal);
            overlay.addEventListener('click', closeModal);

            saveBtn.addEventListener('click', () => {
                const checkboxes = modal.querySelectorAll('.form-field-visibility-checkbox');
                const visibility = {};

                checkboxes.forEach(checkbox => {
                    const fieldId = checkbox.dataset.fieldId;
                    visibility[fieldId] = checkbox.checked;
                });

                this.saveFormFieldVisibility(typeId, visibility);
                closeModal();

                // Reload the edit form if it's open
                const editFormModal = document.querySelector('.edit-form-modal');
                if (editFormModal) {
                    this.applyFormFieldSettings(editFormModal, typeId);
                }
            });
        }

        saveFormFieldVisibility(typeId, visibility) {
            const cookieName = `${ this.options.cookiePrefix }-form-fields-${ typeId }`;
            document.cookie = `${ cookieName }=${ JSON.stringify(visibility) }; path=/; max-age=31536000`;
        }

        loadFormFieldVisibility(typeId) {
            const cookieName = `${ this.options.cookiePrefix }-form-fields-${ typeId }`;
            const cookies = document.cookie.split(';');
            const fieldsCookie = cookies.find(c => c.trim().startsWith(`${ cookieName }=`));

            if (fieldsCookie) {
                try {
                    const visibility = JSON.parse(fieldsCookie.split('=')[1]);
                    return visibility;
                } catch (error) {
                    console.error('Error parsing form field visibility settings:', error);
                    return {};
                }
            }

            return {}; // Default: all fields visible
        }

        applyFormFieldSettings(modal, typeId) {
            const visibility = this.loadFormFieldVisibility(typeId);

            Object.entries(visibility).forEach(([fieldId, isVisible]) => {
                if (!isVisible) {
                    const formGroup = modal.querySelector(`#field-${ fieldId }`)?.closest('.form-group');
                    if (formGroup) {
                        formGroup.style.display = 'none';
                    }
                }
            });
        }

        async saveRecord(modal, isCreate, recordId, typeId, parentId, columnId = null) {
            const form = modal.querySelector('#edit-form');

            if (!form.checkValidity()) {
                form.reportValidity();
                return;
            }

            const formData = new FormData(form);
            const params = new URLSearchParams();

            // Add XSRF token (global variable xsrf is initialized on the page)
            if (typeof xsrf !== 'undefined') {
                params.append('_xsrf', xsrf);
            }

            // Get main value before iterating form fields
            const mainValue = formData.get('main');

            // Add all form fields (skip 'main' since it's handled separately as t{typeId})
            // When creating, skip empty parameters so server can fill defaults
            // When editing, include all parameters to allow clearing fields
            for (const [key, value] of formData.entries()) {
                if (key === 'main') continue;
                if (isCreate) {
                    if (value !== '' && value !== null && value !== undefined) {
                        params.append(key, value);
                    }
                } else {
                    params.append(key, value);
                }
            }

            const apiBase = this.getApiBase();
            let url;

            if (isCreate) {
                url = `${ apiBase }/_m_new/${ typeId }?JSON&up=${ parentId || 1 }`;
                if (mainValue !== '' && mainValue !== null && mainValue !== undefined) {
                    params.append(`t${ typeId }`, mainValue);
                }
            } else {
                url = `${ apiBase }/_m_save/${ recordId }?JSON`;
                params.append(`t${ typeId }`, mainValue);
            }

            try {
                const response = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded'
                    },
                    body: params.toString()
                });

                const text = await response.text();

                let result;
                try {
                    result = JSON.parse(text);
                } catch (e) {
                    // If not JSON, check if it's an error message
                    if (text.includes('error') || !response.ok) {
                        throw new Error(text);
                    }
                    // Otherwise treat as success
                    result = { success: true };
                }

                if (result.error) {
                    throw new Error(result.error);
                }

                // Close modal
                modal.remove();
                if (modal._overlayElement) {
                    modal._overlayElement.remove();
                }

                // Show success message
                this.showToast('Запись успешно сохранена', 'success');

                // Handle special refresh for column header create
                if (isCreate && columnId) {
                    // Extract created record ID from response
                    const createdId = result.id || result.i;

                    if (createdId) {
                        await this.refreshWithNewRecord(columnId, createdId);
                    } else {
                        // Fallback to full reload if no ID returned
                        this.data = [];
                        this.loadedRecords = 0;
                        this.hasMore = true;
                        this.totalRows = null;
                        await this.loadData(false);
                    }
                } else {
                    // Normal reload for edit or regular create
                    this.data = [];
                    this.loadedRecords = 0;
                    this.hasMore = true;
                    this.totalRows = null;
                    await this.loadData(false);
                }

            } catch (error) {
                console.error('Error saving record:', error);
                this.showToast(`Ошибка сохранения: ${ error.message }`, 'error');
            }
        }

        async refreshWithNewRecord(columnId, createdRecordId) {
            try {
                // Fetch the new record using filter
                const params = new URLSearchParams({
                    LIMIT: '0,1',
                    [`FR_${ columnId }`]: createdRecordId
                });

                const separator = this.options.apiUrl.includes('?') ? '&' : '?';
                const response = await fetch(`${ this.options.apiUrl }${ separator }${ params }`);
                const json = await response.json();

                // Transform column-based data to row-based data
                const columnData = json.data || [];
                let newRow = null;

                if (columnData.length > 0 && Array.isArray(columnData[0]) && columnData[0].length > 0) {
                    // Extract the first (and only) row
                    const row = [];
                    for (let colIndex = 0; colIndex < columnData.length; colIndex++) {
                        row.push(columnData[colIndex][0]);
                    }
                    newRow = row;
                }

                if (newRow) {
                    // Add the new record to the beginning of the data
                    this.data.unshift(newRow);
                    this.loadedRecords++;

                    // Update total count if known
                    if (this.totalRows !== null) {
                        this.totalRows++;
                    }

                    // Re-render the table
                    this.render();
                } else {
                    // Fallback: full reload if we couldn't fetch the new record
                    this.data = [];
                    this.loadedRecords = 0;
                    this.hasMore = true;
                    this.totalRows = null;
                    await this.loadData(false);
                }
            } catch (error) {
                console.error('Error fetching new record:', error);
                // Fallback to full reload on error
                this.data = [];
                this.loadedRecords = 0;
                this.hasMore = true;
                this.totalRows = null;
                await this.loadData(false);
            }
        }

        roundToNearest5Minutes(date) {
            // Round date to nearest 5 minutes
            const minutes = date.getMinutes();
            const roundedMinutes = Math.round(minutes / 5) * 5;
            date.setMinutes(roundedMinutes);
            date.setSeconds(0);
            date.setMilliseconds(0);
            return date;
        }

        formatDateForInput(value, includeTime = false) {
            // Convert date from various formats to DD.MM.YYYY or DD.MM.YYYY HH:MM:SS
            if (!value) return '';

            let date;
            // Try to parse DD.MM.YYYY or DD.MM.YYYY HH:MM:SS format first
            if (includeTime) {
                date = this.parseDDMMYYYYHHMMSS(value);
            } else {
                date = this.parseDDMMYYYY(value);
            }

            // If parsing failed, try standard Date constructor
            if (!date || isNaN(date.getTime())) {
                date = new Date(value);
                if (isNaN(date.getTime())) return value;  // Return as-is if not a valid date
            }

            const day = String(date.getDate()).padStart(2, '0');
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const year = date.getFullYear();

            if (includeTime) {
                const hours = String(date.getHours()).padStart(2, '0');
                const minutes = String(date.getMinutes()).padStart(2, '0');
                const seconds = String(date.getSeconds()).padStart(2, '0');
                return `${ day }.${ month }.${ year } ${ hours }:${ minutes }:${ seconds }`;
            }

            return `${ day }.${ month }.${ year }`;
        }

        formatDateForHtml5(value, includeTime = false) {
            // Convert date to HTML5 format: YYYY-MM-DD or YYYY-MM-DDTHH:MM
            if (!value) return '';

            let date;
            // Try to parse DD.MM.YYYY or DD.MM.YYYY HH:MM:SS format first
            if (includeTime) {
                date = this.parseDDMMYYYYHHMMSS(value);
            } else {
                date = this.parseDDMMYYYY(value);
            }

            // If parsing failed, try standard Date constructor
            if (!date || isNaN(date.getTime())) {
                date = new Date(value);
                if (isNaN(date.getTime())) return '';
            }

            // Round to 5 minutes if time is included
            if (includeTime) {
                date = this.roundToNearest5Minutes(date);
            }

            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');

            if (includeTime) {
                const hours = String(date.getHours()).padStart(2, '0');
                const minutes = String(date.getMinutes()).padStart(2, '0');
                return `${ year }-${ month }-${ day }T${ hours }:${ minutes }`;
            }

            return `${ year }-${ month }-${ day }`;
        }

        convertHtml5DateToDisplay(html5Value, includeTime = false) {
            // Convert HTML5 date format to display format
            if (!html5Value) return '';

            if (includeTime) {
                // YYYY-MM-DDTHH:MM(:SS) -> DD.MM.YYYY HH:MM:SS
                const [datePart, timePart] = html5Value.split('T');
                const [year, month, day] = datePart.split('-');
                // Ensure we have seconds (add :00 if not present)
                const timeParts = timePart.split(':');
                const hours = timeParts[0] || '00';
                const minutes = timeParts[1] || '00';
                const seconds = timeParts[2] || '00';
                return `${ day }.${ month }.${ year } ${ hours }:${ minutes }:${ seconds }`;
            } else {
                // YYYY-MM-DD -> DD.MM.YYYY
                const [year, month, day] = html5Value.split('-');
                return `${ day }.${ month }.${ year }`;
            }
        }

        escapeHtml(text) {
            if (text === null || text === undefined) return '';
            return String(text).replace(/&/g, '&amp;')
                              .replace(/</g, '&lt;')
                              .replace(/>/g, '&gt;')
                              .replace(/"/g, '&quot;')
                              .replace(/'/g, '&#039;');
        }

        showToast(message, type = 'info') {
            // Remove existing toasts
            const existingToasts = document.querySelectorAll('.integram-toast');
            existingToasts.forEach(toast => toast.remove());

            const toast = document.createElement('div');
            toast.className = `integram-toast integram-toast-${ type }`;
            toast.textContent = message;

            document.body.appendChild(toast);

            // Auto-remove after 5 seconds
            setTimeout(() => {
                toast.classList.add('fade-out');
                setTimeout(() => toast.remove(), 300);
            }, 5000);

            // Click to dismiss
            toast.addEventListener('click', () => {
                toast.classList.add('fade-out');
                setTimeout(() => toast.remove(), 300);
            });
        }
    }

// Global registry for all IntegramTable instances
if (typeof window !== 'undefined') {
    window._integramTableInstances = window._integramTableInstances || [];
}

/**
 * Global function to reload all IntegramTable instances
 * Reloads all table components with their current filter parameters
 * This function is globally accessible and can be called from anywhere on the page
 *
 * @example
 * // Reload all tables on the page
 * reloadAllIntegramTables();
 */
function reloadAllIntegramTables() {
    if (typeof window !== 'undefined' && window._integramTableInstances) {
        window._integramTableInstances.forEach(instance => {
            if (instance && typeof instance.reload === 'function') {
                instance.reload();
            }
        });
    }
}

// Make the function globally accessible
if (typeof window !== 'undefined') {
    window.reloadAllIntegramTables = reloadAllIntegramTables;
}

// Auto-initialize tables from data attributes
function autoInitTables() {
    const tables = document.querySelectorAll('[data-integram-table]');
    tables.forEach(element => {
        const options = {
            apiUrl: element.dataset.apiUrl || '',
            pageSize: parseInt(element.dataset.pageSize) || 20,
            cookiePrefix: element.dataset.cookiePrefix || 'integram-table',
            title: element.dataset.title || '',
            instanceName: element.dataset.instanceName || element.id
        };

        // Create instance and store in window if instanceName is provided
        const instance = new IntegramTable(element.id, options);
        if (options.instanceName) {
            window[options.instanceName] = instance;
        }

        // Register instance in global registry
        if (typeof window !== 'undefined' && window._integramTableInstances) {
            window._integramTableInstances.push(instance);
        }
    });
}

// Auto-initialize on DOM ready
if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', autoInitTables);
    } else {
        autoInitTables();
    }
}

// Export for use in modules or directly in browser
if (typeof module !== 'undefined' && module.exports) {
    module.exports = IntegramTable;
}
