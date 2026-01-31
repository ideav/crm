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
            this.loadData();
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

            Object.keys(this.filters).forEach(colId => {
                const filter = this.filters[colId];
                if (filter.value) {
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

            Object.keys(this.filters).forEach(colId => {
                const filter = this.filters[colId];
                if (filter.value) {
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
            });
        }

        render() {
            const orderedColumns = this.columnOrder
                .map(id => this.columns.find(c => c.id === id))
                .filter(c => c && this.visibleColumns.includes(c.id));

            const instanceName = this.options.instanceName;

            let html = `
                <div class="integram-table-wrapper">
                    <div class="integram-table-header">
                        ${ this.options.title ? `<div class="integram-table-title">${ this.options.title }</div>` : '' }
                        <div class="integram-table-controls">
                            <button class="btn btn-sm btn-outline-secondary" onclick="window.${ instanceName }.toggleFilters()">
                                ${ this.filtersEnabled ? '✓' : '' } Фильтры
                            </button>
                            <div class="integram-table-settings" onclick="window.${ instanceName }.openColumnSettings()">
                                ⚙️ Настройки
                            </div>
                        </div>
                    </div>
                    <div class="integram-table-container">
                        <table class="integram-table">
                        <thead>
                            <tr>
                                ${ orderedColumns.map(col => `
                                    <th data-column-id="${ col.id }" draggable="true">
                                        ${ col.name }
                                    </th>
                                `).join('') }
                            </tr>
                            ${ this.filtersEnabled ? `
                            <tr class="filter-row">
                                ${ orderedColumns.map(col => this.renderFilterCell(col)).join('') }
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
            `;

            this.container.innerHTML = html;
            this.attachEventListeners();
            this.attachScrollListener();
        }

        renderFilterCell(column) {
            const format = column.format || 'SHORT';
            const currentFilter = this.filters[column.id] || { type: '^', value: '' };

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
                               placeholder="Фильтр...">
                    </div>
                </td>
            `;
        }

        renderCell(column, value, rowIndex, colIndex) {
            const format = column.format || 'SHORT';
            let cellClass = '';
            let displayValue = value || '';
            let customStyle = '';

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
                        displayValue = new Date(value).toLocaleDateString('ru-RU');
                    }
                    break;
                case 'DATETIME':
                    cellClass = 'datetime-cell';
                    if (value) {
                        displayValue = new Date(value).toLocaleString('ru-RU');
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

            const escapedValue = String(displayValue).replace(/&/g, '&amp;')
                                                      .replace(/</g, '&lt;')
                                                      .replace(/>/g, '&gt;')
                                                      .replace(/"/g, '&quot;')
                                                      .replace(/'/g, '&#039;');

            return `<td class="${ cellClass }" data-row="${ rowIndex }" data-col="${ colIndex }"${ customStyle }>${ escapedValue }</td>`;
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

            if (this.options.onCellClick) {
                this.container.querySelectorAll('td').forEach(td => {
                    td.addEventListener('click', () => {
                        const row = parseInt(td.dataset.row);
                        const col = parseInt(td.dataset.col);
                        this.options.onCellClick(row, col, this.data[row][col]);
                    });
                });
            }
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

                    if (this.filters[columnId].value) {
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

        toggleFilters() {
            this.filtersEnabled = !this.filtersEnabled;
            this.render();
        }

        saveColumnState() {
            const state = {
                order: this.columnOrder,
                visible: this.visibleColumns
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
                } catch (e) {
                    console.error('Error loading column state:', e);
                }
            }
        }
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
