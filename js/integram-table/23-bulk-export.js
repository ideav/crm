        toggleCheckboxMode() {
            this.checkboxMode = !this.checkboxMode;
            if (!this.checkboxMode) {
                this.selectedRows.clear();
            }
            this.render();
        }

        /**
         * Show bulk delete confirmation
         */
        showBulkDeleteConfirm(event) {
            if (event) {
                event.stopPropagation();
            }

            const count = this.selectedRows.size;
            if (count === 0) return;

            // Create confirmation popup next to the delete button
            const btn = event.target.closest('.integram-bulk-delete-btn');
            if (!btn) return;

            // Remove existing confirmation popup
            const existing = this.container.querySelector('.bulk-delete-confirm');
            if (existing) {
                existing.remove();
                btn.style.display = '';
                return;
            }

            // Hide delete button while confirmation is shown
            btn.style.display = 'none';

            const confirmHtml = `
                <div class="bulk-delete-confirm">
                    <span>Удалить ${ count } записей?</span>
                    <button class="btn btn-sm btn-danger bulk-delete-confirm-btn">Подтвердить удаление</button>
                    <button class="btn btn-sm btn-outline-secondary bulk-delete-cancel-btn">Отменить</button>
                </div>
            `;

            btn.insertAdjacentHTML('afterend', confirmHtml);

            const confirmPopup = this.container.querySelector('.bulk-delete-confirm');
            confirmPopup.querySelector('.bulk-delete-confirm-btn').addEventListener('click', () => {
                this.bulkDelete();
            });
            confirmPopup.querySelector('.bulk-delete-cancel-btn').addEventListener('click', () => {
                confirmPopup.remove();
                btn.style.display = '';
            });
        }

        /**
         * Bulk delete selected rows
         */
        async bulkDelete() {
            const selectedIndices = Array.from(this.selectedRows).sort((a, b) => a - b);
            if (selectedIndices.length === 0) return;

            // Collect record info for deletion
            const records = [];
            for (const rowIndex of selectedIndices) {
                const rawItem = this.rawObjectData[rowIndex];
                if (rawItem && rawItem.i) {
                    const firstColValue = (rawItem.r && rawItem.r[0]) || '';
                    records.push({ id: rawItem.i, value: firstColValue });
                }
            }

            if (records.length === 0) {
                this.showToast('Не удалось определить ID записей для удаления', 'error');
                return;
            }

            // Show progress overlay
            const apiBase = this.getApiBase();
            const total = records.length;
            let completed = 0;
            const errors = [];

            // Create progress modal
            const progressId = `bulk-delete-progress-${ Date.now() }`;
            const progressHtml = `
                <div class="integram-modal-overlay" id="${ progressId }">
                    <div class="integram-modal" style="max-width: 500px;">
                        <div class="integram-modal-header">
                            <h3>Удаление записей</h3>
                        </div>
                        <div class="integram-modal-body">
                            <div class="bulk-delete-progress-bar-container">
                                <div class="bulk-delete-progress-bar" style="width: 0%"></div>
                            </div>
                            <div class="bulk-delete-progress-text">Удалено: 0 / ${ total }</div>
                            <div class="bulk-delete-errors" style="display: none;"></div>
                        </div>
                    </div>
                </div>
            `;
            document.body.insertAdjacentHTML('beforeend', progressHtml);

            const progressOverlay = document.getElementById(progressId);
            const progressBar = progressOverlay.querySelector('.bulk-delete-progress-bar');
            const progressText = progressOverlay.querySelector('.bulk-delete-progress-text');
            const errorsDiv = progressOverlay.querySelector('.bulk-delete-errors');

            const updateProgress = () => {
                const pct = Math.round((completed / total) * 100);
                progressBar.style.width = `${ pct }%`;
                progressText.textContent = `Удалено: ${ completed } / ${ total }`;
            };

            // Run all delete requests in parallel
            const deletePromises = records.map(async (record) => {
                try {
                    const params = new URLSearchParams();
                    if (typeof xsrf !== 'undefined') {
                        params.append('_xsrf', xsrf);
                    }

                    const response = await fetch(`${ apiBase }/_m_del/${ record.id }?JSON`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                        body: params.toString()
                    });

                    const text = await response.text();
                    try {
                        JSON.parse(text);
                    } catch (parseErr) {
                        // Invalid JSON response - report as warning but don't stop
                        errors.push(`#${ record.id } : ${ record.value } : ${ text }`);
                    }
                } catch (err) {
                    errors.push(`#${ record.id } : ${ record.value } : ${ err.message }`);
                } finally {
                    completed++;
                    updateProgress();
                }
            });

            await Promise.all(deletePromises);

            // Show errors if any
            if (errors.length > 0) {
                errorsDiv.style.display = 'block';
                errorsDiv.innerHTML = `<div class="alert alert-warning" style="max-height: 200px; overflow-y: auto; font-size: 0.75rem; margin-top: 10px;">
                    <strong>Предупреждения:</strong><br>
                    ${ errors.map(e => this.escapeHtml(e)).join('<br>') }
                </div>`;
            }

            // Update progress text
            progressText.textContent = `Удаление завершено: ${ completed } / ${ total }`;

            // Auto-close progress after 1.5s if no errors, else add close button
            if (errors.length === 0) {
                setTimeout(() => {
                    progressOverlay.remove();
                }, 1500);
            } else {
                const closeBtn = document.createElement('button');
                closeBtn.className = 'btn btn-sm btn-primary';
                closeBtn.style.marginTop = '10px';
                closeBtn.textContent = 'Закрыть';
                closeBtn.addEventListener('click', () => progressOverlay.remove());
                progressOverlay.querySelector('.integram-modal-body').appendChild(closeBtn);
            }

            // Clear selection and reload data
            this.selectedRows.clear();
            this.data = [];
            this.rawObjectData = [];
            this.loadedRecords = 0;
            this.hasMore = true;
            this.totalRows = null;
            await this.loadData(false);
        }

        /**
         * Toggle export menu visibility.
         * Issue #1652: the menu is appended to document.body with position:fixed so it
         * escapes the overflow:hidden / overflow-y:hidden clipping of ancestor containers
         * (.integram-table-header, .integram-table-controls).  The same technique is used
         * by _attachFixedDropdown (issue #1384).
         * @param {Event} event - Click event
         */
        toggleExportMenu(event) {
            if (event) {
                event.stopPropagation();
            }

            const menuId = `${ this.options.instanceName }-export-menu`;
            const menu = document.getElementById(menuId);

            if (!menu) return;

            const isVisible = menu.style.display !== 'none';

            // Hide all export menus first
            document.querySelectorAll('.integram-export-menu').forEach(m => {
                m.style.display = 'none';
            });

            if (!isVisible) {
                // Issue #1652: move menu to document.body so it is not clipped by
                // overflow:hidden on .integram-table-header / .integram-table-controls.
                if (menu.parentNode !== document.body) {
                    document.body.appendChild(menu);
                }

                // Position the menu below the button using fixed coordinates.
                const btn = event && event.currentTarget
                    ? event.currentTarget
                    : document.querySelector(`#${ menuId }`)?.previousElementSibling;
                if (btn) {
                    const rect = btn.getBoundingClientRect();
                    menu.style.position = 'fixed';
                    menu.style.top = `${ rect.bottom + 4 }px`;
                    menu.style.left = `${ rect.left }px`;
                    menu.style.right = 'auto';
                }

                menu.style.display = 'block';

                // Close menu when clicking outside
                setTimeout(() => {
                    const closeHandler = (e) => {
                        if (!menu.contains(e.target) && !e.target.closest('.integram-table-export-container')) {
                            menu.style.display = 'none';
                            document.removeEventListener('click', closeHandler);
                        }
                    };
                    document.addEventListener('click', closeHandler);
                }, 0);
            }
        }

        /**
         * Export table data to specified format
         * Loads ALL data matching current filters before export
         * @param {string} format - Export format: 'csv', 'xlsx', or 'xls'
         */
        async exportTable(format) {
            // Hide export menu
            const menuId = `${ this.options.instanceName }-export-menu`;
            const menu = document.getElementById(menuId);
            if (menu) {
                menu.style.display = 'none';
            }

            try {
                // Get visible columns in current order
                const orderedColumns = this.columnOrder
                    .map(id => this.columns.find(c => c.id === id))
                    .filter(c => c && this.visibleColumns.includes(c.id));

                if (orderedColumns.length === 0) {
                    this.showToast('Нет видимых колонок для экспорта', 'error');
                    return;
                }

                // Show loading message
                this.showToast('Загрузка всех данных для экспорта...', 'info');

                // Load all data matching current filters
                const allData = await this.loadAllDataForExport();

                if (allData.length === 0) {
                    this.showToast('Нет данных для экспорта', 'error');
                    return;
                }

                // Show progress message
                this.showToast(`Экспорт ${ allData.length } записей...`, 'info');

                // Prepare data for export
                const exportData = this.prepareExportDataFromRows(allData, orderedColumns);

                // Export based on format
                switch (format.toLowerCase()) {
                    case 'csv':
                        this.exportToCSV(exportData, orderedColumns);
                        break;
                    case 'xlsx':
                    case 'xls':
                        await this.exportToExcel(exportData, orderedColumns, format);
                        break;
                    default:
                        this.showToast(`Неподдерживаемый формат: ${ format }`, 'error');
                }
            } catch (error) {
                console.error('Export error:', error);
                this.showToast(`Ошибка экспорта: ${ error.message }`, 'error');
            }
        }

        /**
         * Load all data matching current filters for export
         * Requests all data in a single request with LIMIT=1000000
         * @returns {Promise<Array>} Array of all data rows
         */
        async loadAllDataForExport() {
            try {
                let json;
                const maxLimit = 1000000; // Request up to 1 million records in single request

                if (this.getDataSourceType() === 'table' || (this.objectTableId && !this.options.tableTypeId)) {
                    // Load data from table format (issue #697)
                    // Use objectTableId if tableTypeId is not explicitly set (auto-detected JSON_OBJ format)
                    const savedTableTypeId = this.options.tableTypeId;
                    if (!this.options.tableTypeId && this.objectTableId) {
                        this.options.tableTypeId = this.objectTableId;
                    }
                    json = await this.loadDataFromTableForExport(0, maxLimit);
                    this.options.tableTypeId = savedTableTypeId;
                } else {
                    // Load data from report format
                    json = await this.loadDataFromReportForExport(0, maxLimit);
                }

                return json.rows || [];

            } catch (error) {
                console.error('Error loading export data:', error);
                throw error;
            }
        }

        /**
         * Load data from report format for export
         * @param {number} offset - Starting offset
         * @param {number} limit - Number of records to fetch
         * @returns {Promise<Object>} JSON response with rows
         */
        async loadDataFromReportForExport(offset, limit) {
            const params = new URLSearchParams();

            // Add LIMIT for pagination
            const isMetadataUrl = /\/metadata\/\d+/.test(this.options.apiUrl);
            if (!isMetadataUrl) {
                params.set('LIMIT', `${ offset },${ limit }`);
            }

            // Apply current filters
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

            // Add ORDER parameter for sorting
            if (this.sortColumn !== null && this.sortDirection !== null) {
                const orderValue = this.sortDirection === 'desc' ? `-${this.sortColumn}` : this.sortColumn;
                params.set('ORDER', orderValue);
            }

            // Forward GET parameters from page URL (issue #476)
            this.appendPageUrlParams(params);

            // Strip existing LIMIT from apiUrl to avoid conflict with export LIMIT
            let baseUrl = this.options.apiUrl;
            if (baseUrl.includes('?')) {
                const [path, queryString] = baseUrl.split('?');
                const existingParams = new URLSearchParams(queryString);
                existingParams.delete('LIMIT');
                const remaining = existingParams.toString();
                baseUrl = remaining ? `${ path }?${ remaining }` : path;
            }

            const separator = baseUrl.includes('?') ? '&' : '?';
            const response = await fetch(`${ baseUrl }${ separator }${ params }`);
            const json = await response.json();

            // Check if this is object format
            if (this.isObjectFormat(json)) {
                return await this.parseObjectFormat(json, false);
            }

            // Check if response is JSON_OBJ array format
            if (this.isJsonDataArrayFormat(json)) {
                return await this.parseJsonDataArray(json, false);
            }

            // Transform column-based data to row-based data
            const columnData = json.data || [];
            let rows = [];

            if (columnData.length > 0 && Array.isArray(columnData[0])) {
                const numRows = columnData[0].length;
                for (let rowIndex = 0; rowIndex < numRows; rowIndex++) {
                    const row = [];
                    for (let colIndex = 0; colIndex < columnData.length; colIndex++) {
                        row.push(columnData[colIndex][rowIndex]);
                    }
                    rows.push(row);
                }
            } else {
                rows = columnData;
            }

            return { rows, columns: json.columns || [] };
        }

        /**
         * Load data from table format for export
         * @param {number} offset - Starting offset
         * @param {number} limit - Number of records to fetch
         * @returns {Promise<Object>} JSON response with rows
         */
        async loadDataFromTableForExport(offset, limit) {
            const params = new URLSearchParams();
            params.set('JSON_OBJ', '1');
            params.set('LIMIT', `${ offset },${ limit }`);

            if (this.options.parentId) {
                params.set('F_U', this.options.parentId);
            }

            // Apply current filters
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

            // Add ORDER parameter for sorting
            if (this.sortColumn !== null && this.sortDirection !== null) {
                const orderValue = this.sortDirection === 'desc' ? `-${this.sortColumn}` : this.sortColumn;
                params.set('ORDER', orderValue);
            }

            // Forward GET parameters from page URL (issue #476)
            this.appendPageUrlParams(params);

            const apiBase = this.getApiBase();
            const url = `${ apiBase }/object/${ this.options.tableTypeId }/?${ params }`;

            const response = await fetch(url);
            const json = await response.json();

            // Parse JSON_OBJ format
            if (this.isJsonDataArrayFormat(json)) {
                return await this.parseJsonDataArray(json, false);
            }

            return { rows: [], columns: [] };
        }

        /**
         * Prepare export data from raw rows
         * @param {Array} rows - Array of data rows
         * @param {Array} columns - Array of column definitions
         * @returns {Array} Array of export data
         */
        prepareExportDataFromRows(rows, columns) {
            return rows.map(row => {
                const exportRow = [];
                columns.forEach(col => {
                    const cellValue = row[this.columns.indexOf(col)];
                    const format = col.format || 'SHORT';
                    let value = cellValue || '';

                    // Issue #378, #925: For reference fields and GRANT/REPORT_COLUMN, remove "id:" prefix from "id:Value" format
                    const isRefField = col.ref_id != null || (col.ref && col.ref !== 0);
                    const upperFormat = String(format).toUpperCase();
                    const isGrantOrReportColumn = upperFormat === 'GRANT' || upperFormat === 'REPORT_COLUMN';
                    if ((isRefField || isGrantOrReportColumn) && value && typeof value === 'string') {
                        const colonIndex = value.indexOf(':');
                        if (colonIndex > 0) {
                            value = value.substring(colonIndex + 1);
                        }
                    }

                    // Convert special formats to plain text
                    switch (format) {
                        case 'BOOLEAN':
                            value = cellValue ? 'Да' : 'Нет';
                            break;
                        case 'PWD':
                            // Only mask with asterisks if there's a value
                            value = (cellValue !== null && cellValue !== undefined && cellValue !== '') ? '******' : '';
                            break;
                        case 'HTML':
                        case 'BUTTON':
                            // Strip HTML tags for export
                            const tmp = document.createElement('div');
                            tmp.innerHTML = String(value);
                            value = tmp.textContent || tmp.innerText || '';
                            break;
                        default:
                            value = String(value);
                    }

                    exportRow.push(value);
                });
                return exportRow;
            });
        }

        /**
         * Prepare data for export (convert to plain text values)
         * @param {Array} columns - Array of column definitions
         * @returns {Array} Array of data rows
         */
        prepareExportData(columns) {
            return this.data.map(row => {
                const exportRow = [];
                columns.forEach(col => {
                    const cellValue = row[this.columns.indexOf(col)];
                    const format = col.format || 'SHORT';
                    let value = cellValue || '';

                    // Issue #378, #925: For reference fields and GRANT/REPORT_COLUMN, remove "id:" prefix from "id:Value" format
                    const isRefField = col.ref_id != null || (col.ref && col.ref !== 0);
                    const upperFmt = String(format).toUpperCase();
                    const isGrantOrReportColumn = upperFmt === 'GRANT' || upperFmt === 'REPORT_COLUMN';
                    if ((isRefField || isGrantOrReportColumn) && value && typeof value === 'string') {
                        const colonIndex = value.indexOf(':');
                        if (colonIndex > 0) {
                            value = value.substring(colonIndex + 1);
                        }
                    }

                    // Convert special formats to plain text
                    switch (format) {
                        case 'BOOLEAN':
                            value = cellValue ? 'Да' : 'Нет';
                            break;
                        case 'PWD':
                            // Only mask with asterisks if there's a value
                            value = (cellValue !== null && cellValue !== undefined && cellValue !== '') ? '******' : '';
                            break;
                        case 'HTML':
                        case 'BUTTON':
                            // Strip HTML tags for export
                            const tmp = document.createElement('div');
                            tmp.innerHTML = String(value);
                            value = tmp.textContent || tmp.innerText || '';
                            break;
                        default:
                            value = String(value);
                    }

                    exportRow.push(value);
                });
                return exportRow;
            });
        }

        /**
         * Export data to CSV format
         * @param {Array} data - Array of data rows
         * @param {Array} columns - Array of column definitions
         */
        exportToCSV(data, columns) {
            // Prepare CSV content
            const headers = columns.map(col => col.name);
            const csvRows = [headers];

            // Add data rows
            data.forEach(row => {
                const csvRow = row.map(cell => {
                    // Escape quotes and wrap in quotes if contains comma, newline, or quote
                    const cellStr = String(cell);
                    if (cellStr.includes(',') || cellStr.includes('\n') || cellStr.includes('"')) {
                        return '"' + cellStr.replace(/"/g, '""') + '"';
                    }
                    return cellStr;
                });
                csvRows.push(csvRow);
            });

            // Join rows with newlines
            const csvContent = csvRows.map(row => row.join(',')).join('\n');

            // Add BOM for proper UTF-8 encoding in Excel
            const BOM = '\uFEFF';
            const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });

            // Download file
            const filename = `${ this.options.title || 'table' }_${ new Date().toISOString().slice(0, 10) }.csv`;
            this.downloadBlob(blob, filename);

            this.showToast('CSV файл успешно экспортирован', 'success');
        }

        /**
         * Export data to Excel format (XLSX or XLS)
         * Uses SheetJS library loaded from CDN
         * @param {Array} data - Array of data rows
         * @param {Array} columns - Array of column definitions
         * @param {string} format - 'xlsx' or 'xls'
         */
        async exportToExcel(data, columns, format) {
            // Load SheetJS library if not already loaded
            if (typeof XLSX === 'undefined') {
                this.showToast('Загрузка библиотеки экспорта...', 'info');

                try {
                    await this.loadScript('/js/xlsx.full.min.js');
                } catch (error) {
                    this.showToast('Ошибка загрузки библиотеки экспорта', 'error');
                    return;
                }
            }

            // Prepare worksheet data
            const headers = columns.map(col => col.name);
            const wsData = [headers, ...data];

            // Create workbook and worksheet
            const wb = XLSX.utils.book_new();
            const ws = XLSX.utils.aoa_to_sheet(wsData);

            // Auto-size columns
            const colWidths = headers.map((header, idx) => {
                const maxLength = Math.max(
                    header.length,
                    ...data.map(row => String(row[idx] || '').length)
                );
                return { wch: Math.min(maxLength + 2, 50) };
            });
            ws['!cols'] = colWidths;

            // Add worksheet to workbook
            XLSX.utils.book_append_sheet(wb, ws, 'Data');

            // Determine file extension and type
            const ext = format.toLowerCase();
            const bookType = ext === 'xls' ? 'xls' : 'xlsx';

            // Generate file
            const filename = `${ this.options.title || 'table' }_${ new Date().toISOString().slice(0, 10) }.${ ext }`;
            XLSX.writeFile(wb, filename, { bookType });

            this.showToast(`${ ext.toUpperCase() } файл успешно экспортирован`, 'success');
        }

        /**
         * Load external script dynamically
         * @param {string} url - Script URL
         * @returns {Promise} Promise that resolves when script is loaded
         */
        loadScript(url) {
            return new Promise((resolve, reject) => {
                // Check if script is already loaded or loading
                const existing = document.querySelector(`script[src="${ url }"]`);
                if (existing) {
                    if (typeof XLSX !== 'undefined') {
                        resolve();
                    } else {
                        existing.addEventListener('load', resolve);
                        existing.addEventListener('error', reject);
                    }
                    return;
                }

                const script = document.createElement('script');
                script.src = url;
                script.async = true;
                script.addEventListener('load', resolve);
                script.addEventListener('error', () => reject(new Error(`Failed to load script: ${ url }`)));
                document.head.appendChild(script);
            });
        }

        /**
         * Download blob as file
         * @param {Blob} blob - Blob to download
         * @param {string} filename - Filename
         */
        downloadBlob(blob, filename) {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }
    }
