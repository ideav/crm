        openGroupingSettings() {
            const overlay = document.createElement('div');
            overlay.className = 'column-settings-overlay';

            const modal = document.createElement('div');
            modal.className = 'column-settings-modal grouping-settings-modal';

            // Get columns that can be grouped (exclude ID columns and style columns)
            const groupableColumns = this.columns.filter(col =>
                !this.idColumns.has(col.id) &&
                !Object.values(this.styleColumns).includes(col.id)
            );

            modal.innerHTML = `
                <h3>Настройка группировки</h3>
                <p style="color: var(--md-text-secondary); font-size: 0.875rem; margin-bottom: 15px;">
                    Выберите поля для группировки. Порядок выбора определяет вложенность групп.
                </p>
                <div class="column-settings-list grouping-columns-list" style="max-height: 300px; overflow-y: auto;">
                    ${ groupableColumns.map((col, idx) => {
                        const isSelected = this.groupingColumns.includes(col.id);
                        const order = isSelected ? this.groupingColumns.indexOf(col.id) + 1 : '';
                        return `
                            <div class="column-settings-item grouping-column-item" data-column-id="${ col.id }">
                                <label>
                                    <input type="checkbox"
                                           data-column-id="${ col.id }"
                                           ${ isSelected ? 'checked' : '' }>
                                    <span class="grouping-order-badge" style="${ isSelected ? '' : 'display: none;' }">${ order }</span>
                                    ${ col.name }
                                </label>
                            </div>
                        `;
                    }).join('') }
                </div>
                <div style="text-align: right; margin-top: 15px;">
                    <button class="btn btn-primary me-2" id="apply-grouping-btn">Применить</button>
                    <button class="btn btn-secondary" id="close-grouping-btn">Закрыть</button>
                </div>
            `;

            document.body.appendChild(overlay);
            document.body.appendChild(modal);

            // Track selection order within the modal
            let selectedOrder = [...this.groupingColumns];

            // Update order badges
            const updateOrderBadges = () => {
                modal.querySelectorAll('.grouping-column-item').forEach(item => {
                    const colId = item.dataset.columnId;
                    const badge = item.querySelector('.grouping-order-badge');
                    const checkbox = item.querySelector('input[type="checkbox"]');
                    const idx = selectedOrder.indexOf(colId);
                    if (idx !== -1) {
                        badge.textContent = idx + 1;
                        badge.style.display = '';
                        checkbox.checked = true;
                    } else {
                        badge.style.display = 'none';
                        checkbox.checked = false;
                    }
                });
            };

            // Handle checkbox changes
            modal.querySelectorAll('input[type="checkbox"]').forEach(cb => {
                cb.addEventListener('change', (e) => {
                    const colId = cb.dataset.columnId;
                    if (cb.checked) {
                        if (!selectedOrder.includes(colId)) {
                            selectedOrder.push(colId);
                        }
                    } else {
                        selectedOrder = selectedOrder.filter(id => id !== colId);
                    }
                    updateOrderBadges();
                });
            });

            // Apply grouping
            modal.querySelector('#apply-grouping-btn').addEventListener('click', () => {
                this.groupingColumns = [...selectedOrder];
                this.groupingEnabled = this.groupingColumns.length > 0;

                // If grouping is enabled, reload data with LIMIT=1000
                if (this.groupingEnabled) {
                    this.data = [];
                    this.loadedRecords = 0;
                    this.hasMore = true;
                    this.totalRows = null;
                    this.loadData(false);
                } else {
                    // Just re-render if grouping is disabled
                    this.render();
                }

                modal.remove();
                overlay.remove();
            });

            // Close modal
            const closeModal = () => {
                modal.remove();
                overlay.remove();
            };

            modal.querySelector('#close-grouping-btn').addEventListener('click', closeModal);
            overlay.addEventListener('click', closeModal);

            // Close on Escape key (issue #595)
            const handleEscape = (e) => {
                if (e.key === 'Escape') {
                    closeModal();
                    document.removeEventListener('keydown', handleEscape);
                }
            };
            document.addEventListener('keydown', handleEscape);
        }

        /**
         * Clear grouping and return to normal table view (issue #502)
         */
        clearGrouping() {
            this.groupingEnabled = false;
            this.groupingColumns = [];
            this.groupedData = [];

            // Reload data with normal pagination
            this.data = [];
            this.loadedRecords = 0;
            this.hasMore = true;
            this.totalRows = null;
            this.loadData(false);
        }

        /**
         * Refresh table data from scratch, clearing existing records (issue #1514).
         * If the server returns empty or null result, the table is cleared.
         */
        refreshData() {
            this.data = [];
            this.loadedRecords = 0;
            this.hasMore = true;
            this.totalRows = null;
            this.loadData(false);
        }

        /**
         * Process data for grouping (issue #502)
         * Sorts data by grouping columns and creates group structure
         * Issue #504: Handle reference values in "id:Value" format for grouping
         */
        processGroupedData() {
            if (!this.groupingEnabled || this.groupingColumns.length === 0) {
                this.groupedData = [];
                return;
            }

            // Get column indices and column objects for grouping columns
            const groupColInfo = this.groupingColumns.map(colId => {
                const colIdx = this.columns.findIndex(c => c.id === colId);
                return { index: colIdx, column: this.columns[colIdx] };
            }).filter(info => info.index !== -1);

            if (groupColInfo.length === 0) {
                this.groupedData = [];
                return;
            }

            // Helper to get display value for grouping (handles reference "id:Value" format)
            const getDisplayValue = (value, column) => {
                return this.parseReferenceDisplayValue(value, column);
            };

            // Issue #529: Compare values considering the base type of the groupable column
            // Dates should be compared as dates, numbers as numbers
            const compareGroupingValues = (valA, valB, column) => {
                // Handle null/undefined/empty
                const aEmpty = valA === null || valA === undefined || valA === '';
                const bEmpty = valB === null || valB === undefined || valB === '';

                if (aEmpty && bEmpty) return 0;
                if (aEmpty) return 1;  // Empty values go to end
                if (bEmpty) return -1;

                // Get the base type of the column
                // Issue #535: Use column.format first (report data has format like 'DATE' directly),
                // fall back to normalizeFormat(column.type) for object data with numeric type IDs
                const validFormats = ['SHORT', 'CHARS', 'DATE', 'NUMBER', 'SIGNED', 'BOOLEAN',
                                      'MEMO', 'DATETIME', 'FILE', 'HTML', 'BUTTON', 'PWD',
                                      'GRANT', 'REPORT_COLUMN', 'PATH'];
                const upperFormat = column.format ? String(column.format).toUpperCase() : '';
                const baseFormat = validFormats.includes(upperFormat) ? upperFormat :
                                  (column.type ? this.normalizeFormat(column.type) : 'SHORT');

                // For reference values (id:label format), extract the label for comparison
                let displayA = getDisplayValue(valA, column);
                let displayB = getDisplayValue(valB, column);

                switch (baseFormat) {
                    case 'NUMBER':
                    case 'SIGNED':
                        const numA = parseFloat(displayA);
                        const numB = parseFloat(displayB);
                        if (!isNaN(numA) && !isNaN(numB)) {
                            return numA - numB;
                        }
                        break;
                    case 'DATE':
                        const dateA = this.parseDDMMYYYY(String(displayA));
                        const dateB = this.parseDDMMYYYY(String(displayB));
                        if (dateA && dateB) {
                            return dateA.getTime() - dateB.getTime();
                        }
                        break;
                    case 'DATETIME':
                        const dtA = this.parseDDMMYYYYHHMMSS(String(displayA));
                        const dtB = this.parseDDMMYYYYHHMMSS(String(displayB));
                        if (dtA && dtB) {
                            return dtA.getTime() - dtB.getTime();
                        }
                        break;
                    case 'BOOLEAN':
                        const boolA = displayA !== null && displayA !== undefined && displayA !== '' && displayA !== 0 && displayA !== '0' && displayA !== false;
                        const boolB = displayB !== null && displayB !== undefined && displayB !== '' && displayB !== 0 && displayB !== '0' && displayB !== false;
                        return (boolA === boolB) ? 0 : (boolA ? -1 : 1);
                }

                // Default: string comparison (case-insensitive)
                return String(displayA).toLowerCase().localeCompare(String(displayB).toLowerCase(), 'ru');
            };

            // Sort data by grouping columns (using display values for reference fields)
            const sortedData = [...this.data].sort((a, b) => {
                for (const info of groupColInfo) {
                    const valA = a[info.index];
                    const valB = b[info.index];

                    // Issue #529: Use type-aware comparison
                    const comparison = compareGroupingValues(valA, valB, info.column);
                    if (comparison !== 0) return comparison;
                }
                return 0;
            });

            // Create grouped structure
            // Each row gets info about which group cells should be displayed (rowspan)
            this.groupedData = [];
            let prevGroupDisplayValues = [];  // Store display values for comparison

            sortedData.forEach((row, rowIndex) => {
                // Issue #504: Get display values for grouping (handles reference "id:Value" format)
                const groupDisplayValues = groupColInfo.map(info => {
                    const rawValue = row[info.index] || '';
                    return getDisplayValue(rawValue, info.column);
                });
                // Also keep raw values for storing in groupCells
                const groupRawValues = groupColInfo.map(info => row[info.index] || '');

                // Determine which group levels changed (compare display values)
                let changedLevel = -1;
                for (let i = 0; i < groupDisplayValues.length; i++) {
                    if (groupDisplayValues[i] !== prevGroupDisplayValues[i]) {
                        changedLevel = i;
                        break;
                    }
                }

                // Create row info
                // Issue #541: Use the sorted position (rowIndex) as originalIndex.
                // After processGroupedData(), this.data is replaced with sortedData,
                // so rowIndex (the position in sortedData) correctly maps to this.data[rowIndex].
                const rowInfo = {
                    originalIndex: rowIndex,
                    data: row,
                    groupCells: []  // Which group cells to render (with rowspan)
                };

                // If this is first row or group value changed, calculate rowspan
                if (rowIndex === 0 || changedLevel !== -1) {
                    // Count how many rows share each group value
                    for (let level = (changedLevel === -1 ? 0 : changedLevel); level < groupColInfo.length; level++) {
                        const info = groupColInfo[level];
                        let rowspan = 1;

                        // Count subsequent rows with same display value at this level
                        for (let j = rowIndex + 1; j < sortedData.length; j++) {
                            // Check if all previous levels match (using display values)
                            let allMatch = true;
                            for (let k = 0; k <= level; k++) {
                                const checkInfo = groupColInfo[k];
                                const checkRawValue = sortedData[j][checkInfo.index] || '';
                                const checkDisplayValue = getDisplayValue(checkRawValue, checkInfo.column);
                                if (checkDisplayValue !== groupDisplayValues[k]) {
                                    allMatch = false;
                                    break;
                                }
                            }
                            if (allMatch) {
                                rowspan++;
                            } else {
                                break;
                            }
                        }

                        rowInfo.groupCells.push({
                            colId: this.groupingColumns[level],
                            colIndex: info.index,
                            value: groupRawValues[level],  // Keep raw value
                            displayValue: groupDisplayValues[level],  // Add parsed display value
                            rowspan: rowspan
                        });
                    }
                }

                this.groupedData.push(rowInfo);
                prevGroupDisplayValues = groupDisplayValues;
            });

            // Replace data with sorted data for rendering
            this.data = sortedData;
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

        /**
         * Check if table has any active filters or grouping enabled (issue #510)
         * Used to determine whether to show the "Share link" button
         * @returns {boolean} True if there are active filters or grouping
         */
        hasActiveFiltersOrGroups() {
            return this.hasActiveFilters() || (this.groupingEnabled && this.groupingColumns.length > 0);
        }

        /**
         * Generate URL with current table configuration (issue #510)
         * Includes filters and grouping settings that can be shared
         * @returns {string} URL with configuration parameters
         */
