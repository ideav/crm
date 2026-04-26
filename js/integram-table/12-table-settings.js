        openTableSettings() {
            const overlay = document.createElement('div');
            overlay.className = 'column-settings-overlay';

            const modal = document.createElement('div');
            modal.className = 'column-settings-modal';
            const instanceName = this.options.instanceName;

            modal.innerHTML = `
                <h3>Настройка представления</h3>
                <div class="column-settings-list">
                    ${ this.getDataSourceType() === 'table' && (this.objectTableId || this.options.tableTypeId) ? (() => { const tableId = this.objectTableId || this.options.tableTypeId; const parentId = this.options.parentId && parseInt(this.options.parentId) > 1 ? this.options.parentId : null; const parentSuffix = parentId ? `?F_U=${parentId}` : ''; return `<div class="table-settings-item"><a href="/${window.db}/cards/${tableId}${parentSuffix}">В виде карточек</a></div><div class="table-settings-item"><a href="/${window.db}/object/${tableId}${parentSuffix}">Перейти в старый интерфейс</a></div>`; })() : '' }

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
                            <label style="margin-left: 15px;" title="Настройка действует на все таблицы, для которых компактность не указана">
                                <input type="checkbox" id="compact-for-all" ${ this.settings.compactForAll ? 'checked' : '' }>
                                Для всех
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
                        <input type="number" id="custom-page-size" class="form-control form-control-sm" style="display: none; width: 80px; margin-left: 10px;" placeholder="Число" autocomplete="off">
                    </div>

                    <div class="table-settings-item">
                        <label>
                            <input type="checkbox" id="truncate-long-values" ${ this.settings.truncateLongValues ? 'checked' : '' }>
                            Сокращать длинные значения
                        </label>
                    </div>

                    <div class="table-settings-item">
                        <label>
                            <input type="checkbox" id="wrap-headers" ${ this.settings.wrapHeaders ? 'checked' : '' }>
                            Переносить заголовки
                        </label>
                    </div>

                    <div class="table-settings-item">
                        <label>
                            <input type="checkbox" id="hide-menu-button-labels" ${ this.settings.hideMenuButtonLabels ? 'checked' : '' }>
                            Скрыть подписи к кнопкам меню
                        </label>
                    </div>

                    <div class="table-settings-item">
                        <label title="Показать все таблицы, где эта таблица используется как справочник">
                            <input type="checkbox" id="show-references" ${ this.settings.showReferences ? 'checked' : '' }>
                            Показывать связи
                        </label>
                    </div>
                </div>
                <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 15px;">
                    <button class="btn btn-sm btn-danger" id="reset-settings-btn">Сбросить настройки</button>
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

            // Handle "For All" checkbox change
            const compactForAllCheckbox = modal.querySelector('#compact-for-all');
            compactForAllCheckbox.addEventListener('change', (e) => {
                this.settings.compactForAll = e.target.checked;
                this.saveSettings();
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

            // Handle truncate long values change
            const truncateLongValuesCheckbox = modal.querySelector('#truncate-long-values');
            truncateLongValuesCheckbox.addEventListener('change', (e) => {
                this.settings.truncateLongValues = e.target.checked;
                this.saveSettings();
                this.render();
            });

            // Handle wrap headers change
            const wrapHeadersCheckbox = modal.querySelector('#wrap-headers');
            wrapHeadersCheckbox.addEventListener('change', (e) => {
                this.settings.wrapHeaders = e.target.checked;
                this.saveSettings();
                this.render();
            });

            // Handle hide menu button labels change
            const hideMenuButtonLabelsCheckbox = modal.querySelector('#hide-menu-button-labels');
            hideMenuButtonLabelsCheckbox.addEventListener('change', (e) => {
                this.settings.hideMenuButtonLabels = e.target.checked;
                this.saveSettings();
                this.render();
            });

            // Handle show references change
            const showReferencesCheckbox = modal.querySelector('#show-references');
            showReferencesCheckbox.addEventListener('change', (e) => {
                this.settings.showReferences = e.target.checked;
                this.saveSettings();
                this.render();
            });

            overlay.addEventListener('click', () => this.closeTableSettings());

            // Close on Escape key (issue #595)
            const handleEscape = (e) => {
                if (e.key === 'Escape') {
                    this.closeTableSettings();
                    document.removeEventListener('keydown', handleEscape);
                }
            };
            document.addEventListener('keydown', handleEscape);
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
                compactForAll: true,
                pageSize: 20,
                truncateLongValues: true,
                wrapHeaders: false,
                hideMenuButtonLabels: false,
                showReferences: false,
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

        /**
         * Get back-references: list of all tables in globalMetadata that reference this table (issue #1732).
         * Scans all tables in globalMetadata for requisites (reqs) where ref == current table's objectTableId.
         * Returns array of { tableId, tableName, fieldId, fieldName } objects.
         */
        getBackReferences() {
            const currentTableId = String(this.objectTableId || this.options.tableTypeId || '');
            if (!currentTableId || !this.globalMetadata || !Array.isArray(this.globalMetadata)) {
                return [];
            }

            const refs = [];
            for (const table of this.globalMetadata) {
                if (!table.reqs || !Array.isArray(table.reqs)) continue;
                for (const req of table.reqs) {
                    if (String(req.ref) === currentTableId) {
                        refs.push({
                            tableId: String(table.id),
                            tableName: table.val || String(table.id),
                            fieldId: String(req.id),
                            fieldName: req.alias || req.val || String(req.id),
                        });
                    }
                }
            }
            return refs;
        }

        /**
         * Render the references cell for a given row (issue #1732).
         * Shows links for all tables that reference the current table as a lookup.
         * Link format: {TableName}.{FieldName} → table/{foreignTableId}?FR_{fieldId}=@{currentRowId}
         */
        renderReferencesCell(rowIndex) {
            const backRefs = this.getBackReferences();
            if (backRefs.length === 0) {
                return `<td class="references-column-cell"></td>`;
            }

            let recordId = null;
            if (this.rawObjectData && this.rawObjectData[rowIndex]) {
                recordId = this.rawObjectData[rowIndex].i;
            }

            if (!recordId) {
                return `<td class="references-column-cell"></td>`;
            }

            const pathParts = window.location.pathname.split('/');
            const dbName = pathParts.length >= 2 ? pathParts[1] : '';

            const links = backRefs.map(ref => {
                const href = `/${dbName}/table/${ref.tableId}?FR_${ref.fieldId}=@${recordId}`;
                const label = `${ref.tableName}.${ref.fieldName}`;
                return `<a href="${href}" class="reference-link" style="color: #9ca3af;" title="${label}">${label}</a>`;
            }).join(', ');

            return `<td class="references-column-cell">${links}</td>`;
        }

        showFullValue(event, fullValue) {
            event.preventDefault();
            const overlay = document.createElement('div');
            overlay.className = 'column-settings-overlay';

            const modal = document.createElement('div');
            modal.className = 'column-settings-modal';

            modal.innerHTML = `
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0;">
                    <h3 style="margin: 0;">Полное значение</h3>
                    <button class="full-value-copy-btn" title="Копировать в буфер"><i class="pi pi-copy"></i></button>
                </div>
                <div class="full-value-content" style="max-height: 400px; overflow-y: auto; margin: 15px 0; padding: 10px; background: #f8f9fa; border-radius: 4px; cursor: pointer;" title="Нажмите, чтобы скопировать">
                    <pre style="white-space: pre-wrap; word-wrap: break-word; margin: 0;">${ fullValue }</pre>
                </div>
                <div style="text-align: right;">
                    <button class="btn btn-secondary" onclick="this.closest('.column-settings-modal').remove(); document.querySelector('.column-settings-overlay').remove();">Закрыть</button>
                </div>
            `;

            // Extract plain text for clipboard (strip HTML tags from linkified content) - issue #1465
            const plainText = modal.querySelector('pre').textContent;

            // Copy to clipboard helper - issue #1465
            const copyToClipboard = (btn) => {
                navigator.clipboard.writeText(plainText).then(() => {
                    const originalHTML = btn.innerHTML;
                    btn.innerHTML = '<i class="pi pi-check"></i>';
                    setTimeout(() => {
                        btn.innerHTML = originalHTML;
                    }, 2000);
                }).catch(err => {
                    console.error('[integram-table] Copy failed:', err);
                });
            };

            // Copy on clicking the copy button (top right) - issue #1465
            const copyBtn = modal.querySelector('.full-value-copy-btn');
            copyBtn.addEventListener('click', () => copyToClipboard(copyBtn));

            // Copy on clicking the value content area - issue #1465
            const contentArea = modal.querySelector('.full-value-content');
            contentArea.addEventListener('click', () => copyToClipboard(copyBtn));

            document.body.appendChild(overlay);
            document.body.appendChild(modal);

            overlay.addEventListener('click', () => {
                modal.remove();
                overlay.remove();
            });

            // Close on Escape key (issue #595)
            const handleEscape = (e) => {
                if (e.key === 'Escape') {
                    modal.remove();
                    overlay.remove();
                    document.removeEventListener('keydown', handleEscape);
                }
            };
            document.addEventListener('keydown', handleEscape);
        }

        toggleFilters() {
            this.filtersEnabled = !this.filtersEnabled;
            this.render();
        }

        /**
         * Open grouping settings modal (issue #502)
         * Allows user to select columns to group by and their order
         */
