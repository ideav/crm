        addNewRow() {
            // Prevent adding multiple new rows at once
            if (this.pendingNewRow) {
                this.showToast('Завершите редактирование текущей новой строки', 'info');
                return;
            }

            const tableTypeId = this.objectTableId || this.options.tableTypeId;
            if (!tableTypeId) {
                this.showToast('Ошибка: не найден тип таблицы', 'error');
                return;
            }

            // Create empty row data with placeholder values
            const emptyRow = this.columns.map(() => '');
            const newRowIndex = this.data.length;

            // Add empty row to data arrays
            this.data.push(emptyRow);
            this.loadedRecords++;

            // Add placeholder to rawObjectData for the new row
            // Mark as pending (no 'i' field yet since record not created)
            this.rawObjectData.push({
                i: null,  // Will be set after _m_new response
                u: this.options.parentId || 1,
                o: newRowIndex,
                r: emptyRow,
                _isNewRow: true  // Mark this as a pending new row
            });

            // Track the pending new row
            this.pendingNewRow = {
                rowIndex: newRowIndex,
                tableTypeId: tableTypeId
            };

            // Re-render the table
            this.render();

            // After render, find the new row and start editing the first column
            setTimeout(() => {
                this.startNewRowEdit(newRowIndex);
            }, 50);
        }

        /**
         * Start editing the first column of a new row (issue #807)
         * @param {number} rowIndex - Index of the new row
         */
        startNewRowEdit(rowIndex) {
            const tbody = this.container.querySelector('tbody');
            if (!tbody) return;

            const rows = tbody.querySelectorAll('tr');
            const newRow = rows[rowIndex];
            if (!newRow) return;

            // Find the first editable column cell (should match objectTableId)
            const firstColumnId = String(this.objectTableId || this.options.tableTypeId);
            const firstCell = newRow.querySelector(`td[data-col-id="${firstColumnId}"]`);

            if (firstCell) {
                // Start inline editing on the first cell
                this.startNewRowFirstColumnEdit(firstCell, rowIndex);
            } else {
                // Fallback: try the first TD with data-col attribute
                const firstTd = newRow.querySelector('td[data-col]');
                if (firstTd) {
                    this.startNewRowFirstColumnEdit(firstTd, rowIndex);
                }
            }
        }

        /**
         * Start editing the first column of a new row with special handling (issue #807)
         * Only the first column is editable until it's saved.
         * @param {HTMLElement} cell - The first column cell
         * @param {number} rowIndex - Index of the new row
         */
        startNewRowFirstColumnEdit(cell, rowIndex) {
            const colId = cell.dataset.colId;
            const column = this.columns.find(c => c.id === colId);
            if (!column) return;

            const format = column.format || this.mapTypeIdToFormat(column.type);

            // Store editing context
            this.currentEditingCell = {
                cell,
                recordId: null,  // No record ID yet
                colId,
                colType: column.paramId || column.id,
                format,
                isRef: false,
                isNewRow: true,
                rowIndex,
                parentInfo: {
                    isObjectFormat: true,
                    isFirstColumn: true,
                    parentType: this.objectTableId || this.options.tableTypeId,
                    parentRecordId: null
                },
                originalValue: ''
            };

            // Highlight required fields in the row (issue #807)
            this.highlightNewRowRequiredCells(cell);

            // Create inline editor
            this.renderInlineEditor(cell, '', format);
        }

        /**
         * Highlight required cells in a new row (issue #807)
         * Shows red border on cells that have :!NULL: in attrs
         * @param {HTMLElement} cell - The cell being edited
         */
        highlightNewRowRequiredCells(cell) {
            const row = cell.closest('tr');
            if (!row) return;

            // Mark the row as a new row for CSS targeting
            row.classList.add('new-row-editing');

            // Build ordered columns list (same logic as in render())
            const orderedColumns = this.columnOrder
                .map(id => this.columns.find(c => c.id === id))
                .filter(c => c && this.visibleColumns.includes(c.id));

            // Iterate all cells in the row and highlight those with required attrs
            const cells = row.querySelectorAll('td[data-col]');
            cells.forEach(td => {
                const colIndex = parseInt(td.dataset.col);
                if (isNaN(colIndex)) return;
                const column = orderedColumns[colIndex];
                if (column && column.attrs && column.attrs.includes(':!NULL:')) {
                    td.classList.add('required-field-new-row');
                }
            });
        }

        /**
         * Clear new row required field highlighting (issue #807)
         * @param {HTMLElement} cell - The cell that was being edited
         */
        clearNewRowRequiredHighlights(cell) {
            const row = cell.closest('tr');
            if (!row) return;
            row.classList.remove('new-row-editing');
            row.querySelectorAll('td.required-field-new-row').forEach(td => {
                td.classList.remove('required-field-new-row');
            });
        }

        attachEventListeners() {
            // Determine the first visible column ID — it cannot be moved (issue #951)
            const firstVisibleColumnId = this.columnOrder.find(id => this.visibleColumns.includes(id));

            const headers = this.container.querySelectorAll('th[draggable]');
            headers.forEach(th => {
                const columnId = th.dataset.columnId;

                // The first column is not draggable and cannot be a drop target (issue #951)
                if (columnId === firstVisibleColumnId) {
                    th.removeAttribute('draggable');
                    return;
                }

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

                    // Prevent dropping onto the first column or dropping a column onto itself (issue #951, #966)
                    if (draggedId !== targetId && draggedId !== firstVisibleColumnId && targetId !== firstVisibleColumnId) {
                        this.reorderColumns(draggedId, targetId);
                    }

                    th.classList.remove('drag-over');
                });
            });

            // Add click handlers for column header sorting
            const headerContents = this.container.querySelectorAll('.column-header-content');
            headerContents.forEach(span => {
                span.addEventListener('click', (e) => {
                    // Only trigger sort if clicking directly on the span, not its children
                    if (e.target === span) {
                        const columnId = span.dataset.columnId;
                        if (columnId) {
                            this.toggleSort(columnId);
                        }
                    }
                });
                // Make header content look clickable
                span.style.cursor = 'pointer';
            });

            // Add click handler for parent record link to open modal edit form (issue #575)
            const parentRecordLink = this.container.querySelector('.integram-parent-record-link');
            if (parentRecordLink) {
                parentRecordLink.addEventListener('click', (e) => {
                    e.preventDefault();
                    const parentRecordId = parentRecordLink.dataset.parentRecordId;
                    const parentTypeId = parentRecordLink.dataset.parentTypeId;
                    if (parentRecordId && parentTypeId) {
                        this.openEditForm(parentRecordId, parentTypeId, 0);
                    }
                });
            }

            const filterIcons = this.container.querySelectorAll('.filter-icon-inside');
            filterIcons.forEach(icon => {
                icon.addEventListener('click', (e) => {
                    this.showFilterTypeMenu(e.target, icon.dataset.columnId);
                });
            });

            const filterInputs = this.container.querySelectorAll('.filter-input-with-icon');
            filterInputs.forEach(input => {
                // Skip date pickers — they are handled separately via 'change' event (issue #1008)
                if (input.classList.contains('filter-date-picker')) return;
                // Use 'input' event to apply filter on text change
                input.addEventListener('input', (e) => {
                    const colId = input.dataset.columnId;
                    if (!this.filters[colId]) {
                        const col = this.columns.find(c => c.id === colId);
                        const fmt = col ? (col.format || 'SHORT') : 'SHORT';
                        this.filters[colId] = { type: this.getDefaultFilterType(fmt), value: '' };
                    }
                    this.filters[colId].value = input.value;
                    // Clear displayValue: user is now entering their own filter, not the resolved label (issue #551)
                    delete this.filters[colId].displayValue;

                    // Check if this filter overrides URL GET parameters (issue #500)
                    this.handleFilterOverride(colId, input.value);

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

            // Add change listeners for date/datetime filter pickers (issue #1008)
            const filterDatePickers = this.container.querySelectorAll('.filter-date-picker');
            filterDatePickers.forEach(picker => {
                picker.addEventListener('change', (e) => {
                    const colId = picker.dataset.columnId;
                    const isDateTime = picker.dataset.isDatetime === '1';
                    if (!this.filters[colId]) {
                        const col = this.columns.find(c => c.id === colId);
                        const fmt = col ? (col.format || 'SHORT') : 'SHORT';
                        this.filters[colId] = { type: this.getDefaultFilterType(fmt), value: '' };
                    }
                    // Convert HTML5 date format to display format (DD.MM.YYYY or DD.MM.YYYY HH:MM:SS)
                    const displayValue = picker.value ? this.convertHtml5DateToDisplay(picker.value, isDateTime) : '';
                    this.filters[colId].value = displayValue;
                    delete this.filters[colId].displayValue;

                    this.handleFilterOverride(colId, displayValue);

                    clearTimeout(this.filterTimeout);
                    this.filterTimeout = setTimeout(() => {
                        this.data = [];
                        this.loadedRecords = 0;
                        this.hasMore = true;
                        this.totalRows = null;
                        this.loadData(false);
                    }, 500);
                });
            });

            // Add click listeners for reference field filter dropdown triggers (issue #795, #797)
            const refFilterTriggers = this.container.querySelectorAll('.filter-ref-trigger');
            refFilterTriggers.forEach(trigger => {
                trigger.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const colId = trigger.dataset.columnId;
                    this.openRefFilterDropdown(colId, trigger);
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

                    if (window.INTEGRAM_DEBUG) {
                        console.log(`[TRACE] Cell click - EDITABLE cell clicked:`, {
                            colId: td.dataset.colId,
                            colName: column ? column.name : 'unknown',
                            recordId: td.dataset.recordId,
                            rowIndex: td.dataset.rowIndex,
                            isRefField: td.dataset.colRef === '1'
                        });
                    }

                    // Don't trigger if clicking on edit icon or already editing
                    if (e.target.closest('.edit-icon') || this.currentEditingCell) {
                        if (window.INTEGRAM_DEBUG) {
                            console.log(`  - Skipping edit (clicking on edit icon or already editing)`);
                        }
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

                    if (window.INTEGRAM_DEBUG) {
                        const isInObjectFormat = this.rawObjectData.length > 0 && this.objectTableId;
                        console.log(`[TRACE] Cell click - NON-editable cell clicked:`, {
                            colId: column.id,
                            colName: column.name,
                            colGranted: column.granted,
                            isInEditableColumns: isInEditableColumns,
                            isInObjectFormat: isInObjectFormat,
                            hasClassEditableCell: td.classList.contains('editable-cell'),
                            dataEditableAttr: td.dataset.editable,
                            rowIndex: row
                        });
                        console.log(`  ✗ Cell not editable because data-editable="${td.dataset.editable}" (not "true")`);
                        if (isInEditableColumns && td.classList.contains('editable-cell')) {
                            console.log(`  ⚠️ WARNING: Cell has editable-cell class and column is in editableColumns, but data-editable is not "true"!`);
                            console.log(`  This indicates the recordId was not found during rendering.`);
                        }
                    }
                }
            });

            // Checkbox selection handlers
            if (this.checkboxMode) {
                const selectAll = this.container.querySelector('.row-select-all');
                if (selectAll) {
                    selectAll.addEventListener('change', (e) => {
                        if (e.target.checked) {
                            for (let i = 0; i < this.data.length; i++) {
                                this.selectedRows.add(i);
                            }
                        } else {
                            this.selectedRows.clear();
                        }
                        this.render();
                    });
                }

                const rowCheckboxes = this.container.querySelectorAll('.row-select-checkbox');
                rowCheckboxes.forEach(cb => {
                    cb.addEventListener('change', (e) => {
                        const rowIndex = parseInt(e.target.dataset.rowIndex);
                        if (e.target.checked) {
                            this.selectedRows.add(rowIndex);
                        } else {
                            this.selectedRows.delete(rowIndex);
                        }
                        this.render();
                    });
                });
            }
        }

        async startInlineEdit(cell) {
            // Check if we can edit this cell (need to determine parent ID)
            let recordId = cell.dataset.recordId;
            const colId = cell.dataset.colId;
            const colType = cell.dataset.colType;
            const format = cell.dataset.colFormat;
            const isRef = cell.dataset.colRef === '1';
            const isMulti = cell.dataset.array === '1'; // Issue #853: detect multi-select reference fields
            const rowIndex = parseInt(cell.dataset.rowIndex);

            if (!colId || !colType) {
                return;
            }

            // Issue #809: If this is the first column of a pending new row, delegate to startNewRowFirstColumnEdit
            if (recordId === 'new' && this.pendingNewRow && this.pendingNewRow.rowIndex === rowIndex) {
                this.startNewRowFirstColumnEdit(cell, rowIndex);
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
                isMulti, // Issue #853: multi-select reference flag
                parentInfo,
                originalValue: currentValue
            };

            // Highlight required fields in the row when data source is a table (issue #779)
            if (this.getDataSourceType() === 'table') {
                this.highlightRequiredCells(cell);
            }

            // Create inline editor based on format or reference type
            if (isRef && isMulti) {
                // Issue #853: multi-select reference fields need a tags-based editor
                this.renderMultiReferenceEditor(cell, currentValue);
            } else if (isRef) {
                this.renderReferenceEditor(cell, currentValue);
            } else {
                this.renderInlineEditor(cell, currentValue, format);
            }
        }

        /**
         * Highlight cells with required fields (:!NULL: in attrs) in the same row (issue #779)
         * Only highlights cells that are currently empty (issue #785)
         * Called when entering edit mode for a table data source
         * @param {HTMLElement} cell - The cell being edited
         */
        highlightRequiredCells(cell) {
            const row = cell.closest('tr');
            if (!row) return;

            // Build ordered columns list (same logic as in render())
            const orderedColumns = this.columnOrder
                .map(id => this.columns.find(c => c.id === id))
                .filter(c => c && this.visibleColumns.includes(c.id));

            // Iterate all cells in the row and highlight those with required attrs that are currently empty
            const cells = row.querySelectorAll('td[data-col]');
            cells.forEach(td => {
                const colIndex = parseInt(td.dataset.col);
                if (isNaN(colIndex)) return;
                const column = orderedColumns[colIndex];
                if (column && column.attrs && column.attrs.includes(':!NULL:')) {
                    // Only highlight if the cell is currently empty (issue #785)
                    const currentValue = this.extractCellValue(td);
                    if (!currentValue) {
                        td.classList.add('required-field-editing');
                    }
                }
            });
        }

        /**
         * Remove required field highlighting from all cells in the row (issue #779)
         * Called when exiting edit mode
         * @param {HTMLElement} cell - The cell that was being edited
         */
        clearRequiredCellHighlights(cell) {
            const row = cell.closest('tr');
            if (!row) return;
            row.querySelectorAll('td.required-field-editing').forEach(td => {
                td.classList.remove('required-field-editing');
            });
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
                console.warn('[determineParentRecord] Column not found for colId:', colId);
                return null;
            }

            // OBJECT FORMAT: For object format data, parent record ID is in rawObjectData
            const isInObjectFormat = this.rawObjectData && this.rawObjectData.length > 0 && this.objectTableId;
            if (isInObjectFormat && rowIndex !== undefined && rowIndex !== null) {
                const rawItem = this.rawObjectData[rowIndex];
                if (rawItem) {
                    // In object format:
                    // - 'i' is the record ID (this record)
                    // - 'u' is the parent ID (parent of this record)
                    // When editing, we use 'i' as the recordId for the API call
                    const parentRecordId = rawItem.i ? String(rawItem.i) : '';

                    // Determine if this is the first column
                    // Both table data source and object format now use metadata.id as column.id (issue #793)
                    // colType === objectTableId identifies the first column (colType = paramId = metadata.id)
                    const isFirstColumn = colType === String(this.objectTableId);

                    if (window.INTEGRAM_DEBUG) {
                        console.log('[determineParentRecord] Object format detected:');
                        console.log('  - rowIndex:', rowIndex);
                        console.log('  - colId:', colId);
                        console.log('  - colType:', colType);
                        console.log('  - objectTableId:', this.objectTableId);
                        console.log('  - isFirstColumn:', isFirstColumn);
                        console.log('  - rawItem.i (record ID):', rawItem.i);
                        console.log('  - rawItem.u (parent of this record):', rawItem.u);
                        console.log('  - Using rawItem.i as parentRecordId:', parentRecordId);
                    }

                    if (parentRecordId) {
                        return {
                            isObjectFormat: true,
                            isFirstColumn: isFirstColumn,
                            parentType: this.objectTableId,
                            parentRecordId: parentRecordId
                        };
                    }
                }
                console.warn('[determineParentRecord] Object format but no valid rawItem at rowIndex:', rowIndex);
            }

            // Use global metadata to determine parent record
            if (!this.globalMetadata) {
                console.warn('[determineParentRecord] No globalMetadata available');
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
                    console.warn('[determineParentRecord] ID column not found for first column case:', idColumnName);
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

                if (window.INTEGRAM_DEBUG) {
                    console.log('[determineParentRecord] First column case (A):');
                    console.log('  - idColumnName:', idColumnName);
                    console.log('  - parentRecordId:', parentRecordId);
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
                            console.warn('[determineParentRecord] Parent ID column not found for requisite case, item.id:', item.id);
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

                        if (window.INTEGRAM_DEBUG) {
                            console.log('[determineParentRecord] Requisite case (B):');
                            console.log('  - item.id:', item.id);
                            console.log('  - parentRecordId:', parentRecordId);
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

            console.warn('[determineParentRecord] No parent record determination logic matched');
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
                    // Any non-empty value = checked
                    const isChecked = currentValue !== null && currentValue !== undefined && currentValue !== '' && currentValue !== '0' && currentValue !== 'false';
                    editorHtml = `<input type="checkbox" class="inline-editor inline-editor-checkbox" ${ isChecked ? 'checked' : '' }>`;
                    break;
                case 'DATE':
                    const dateValue = this.formatDateForHtml5(currentValue, false);
                    editorHtml = `<input type="date" class="inline-editor inline-editor-date" value="${ dateValue }">`;
                    break;
                case 'DATETIME':
                    const datetimeValue = this.formatDateForHtml5(currentValue, true);
                    editorHtml = `<input type="datetime-local" class="inline-editor inline-editor-datetime" value="${ datetimeValue }">`;
                    break;
                case 'MEMO':
                    editorHtml = `<textarea class="inline-editor inline-editor-memo" rows="3">${ escapedValue }</textarea>`;
                    break;
                case 'FILE':
                    editorHtml = `
                        <div class="inline-editor inline-editor-file">
                            <input type="file" class="file-input" id="inline-file-input" style="display: none;">
                            <div class="file-dropzone">
                                <span class="file-dropzone-text">Перетащите файл сюда или нажмите для выбора</span>
                                <button type="button" class="file-select-btn">Выбрать файл</button>
                            </div>
                            <div class="file-preview" style="display: none;">
                                <span class="file-name"></span>
                                <button type="button" class="file-remove-btn" title="Удалить файл"><i class="pi pi-times"></i></button>
                            </div>
                        </div>
                    `;
                    break;
                case 'GRANT':
                    // GRANT field - dropdown with options from GET /grants API (issue #601)
                    editorHtml = `
                        <select class="inline-editor inline-editor-select inline-editor-grant" data-grant-type="grant">
                            <option value="">Загрузка...</option>
                        </select>
                    `;
                    break;
                case 'REPORT_COLUMN':
                    // REPORT_COLUMN field - dropdown with options from GET /rep_cols API (issue #601)
                    editorHtml = `
                        <select class="inline-editor inline-editor-select inline-editor-grant" data-grant-type="rep_col">
                            <option value="">Загрузка...</option>
                        </select>
                    `;
                    break;
                default:
                    // SHORT, CHARS, etc. - text input
                    editorHtml = `<input type="text" class="inline-editor inline-editor-text" value="${ escapedValue }" autocomplete="off" readonly onfocus="this.removeAttribute('readonly')" onmousedown="this.removeAttribute('readonly')">`;
            }

            cell.innerHTML = editorHtml;
            const editor = cell.querySelector('.inline-editor');

            // Special handling for FILE type
            if (format === 'FILE') {
                this.attachFileUploadHandlers(editor, currentValue);
            }

            // Special handling for GRANT and REPORT_COLUMN types (issue #601)
            if (format === 'GRANT' || format === 'REPORT_COLUMN') {
                this.loadInlineGrantOptions(editor, currentValue, format);
            }

            // Focus the editor
            if (format !== 'FILE' && format !== 'GRANT' && format !== 'REPORT_COLUMN') {
                editor.focus();
                if (editor.select) {
                    editor.select();
                }
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
                } else if (format === 'FILE') {
                    // For FILE type, the value is stored in data attribute by file upload handler
                    newValue = editor.dataset.fileValue || '';
                } else if (format === 'GRANT' || format === 'REPORT_COLUMN') {
                    // For GRANT/REPORT_COLUMN: save the ID to API, display the text in cell (issue #601)
                    newValue = editor.value;
                    // Store display text for updateCellDisplay
                    const selectedOption = editor.options[editor.selectedIndex];
                    this.currentEditingCell.displayText = selectedOption ? selectedOption.textContent : '';
                } else {
                    newValue = editor.value;
                }

                // Issue #787: Prevent saving empty value for first column
                if (this.currentEditingCell.parentInfo && this.currentEditingCell.parentInfo.isFirstColumn && newValue === '') {
                    this.showToast('Значение первой колонки не может быть пустым', 'error');
                    return;
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

            // Enter to save (except for textarea and file upload)
            // Tab/Shift+Tab to navigate between cells, Up/Down arrows to navigate vertically (issue #518)
            // For select elements (GRANT/REPORT_COLUMN), allow ArrowUp/ArrowDown for option navigation (issue #601)
            if (format !== 'MEMO' && format !== 'FILE') {
                editor.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        saveEdit();
                    } else if (e.key === 'Escape') {
                        e.preventDefault();
                        cancelEdit();
                    } else if (e.key === 'Tab') {
                        // Tab / Shift+Tab: navigate to next/previous editable cell (issue #518)
                        e.preventDefault();
                        const direction = e.shiftKey ? 'prev' : 'next';
                        this.saveAndNavigate(direction, saveEdit, cancelEdit);
                    } else if (e.key === 'ArrowUp' && format !== 'GRANT' && format !== 'REPORT_COLUMN') {
                        // Arrow Up: navigate to cell above (issue #518)
                        // Skip for GRANT/REPORT_COLUMN selects - let them use arrows for option navigation (issue #601)
                        e.preventDefault();
                        this.saveAndNavigate('up', saveEdit, cancelEdit);
                    } else if (e.key === 'ArrowDown' && format !== 'GRANT' && format !== 'REPORT_COLUMN') {
                        // Arrow Down: navigate to cell below (issue #518)
                        // Skip for GRANT/REPORT_COLUMN selects - let them use arrows for option navigation (issue #601)
                        e.preventDefault();
                        this.saveAndNavigate('down', saveEdit, cancelEdit);
                    }
                });
            } else if (format === 'MEMO') {
                // For textarea: Ctrl+Enter to save, Escape to cancel
                // Tab/Shift+Tab to navigate, Up/Down without Ctrl do nothing (allow cursor movement)
                editor.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' && e.ctrlKey) {
                        e.preventDefault();
                        saveEdit();
                    } else if (e.key === 'Escape') {
                        e.preventDefault();
                        cancelEdit();
                    } else if (e.key === 'Tab') {
                        // Tab / Shift+Tab: navigate to next/previous editable cell (issue #518)
                        e.preventDefault();
                        const direction = e.shiftKey ? 'prev' : 'next';
                        this.saveAndNavigate(direction, saveEdit, cancelEdit);
                    }
                    // Note: ArrowUp/Down allowed for cursor movement in textarea
                });
            } else if (format === 'FILE') {
                // For file upload: Escape to cancel only, Tab to navigate
                editor.addEventListener('keydown', (e) => {
                    if (e.key === 'Escape') {
                        e.preventDefault();
                        cancelEdit();
                    } else if (e.key === 'Tab') {
                        // Tab / Shift+Tab: navigate to next/previous editable cell (issue #518)
                        e.preventDefault();
                        const direction = e.shiftKey ? 'prev' : 'next';
                        this.saveAndNavigate(direction, saveEdit, cancelEdit);
                    }
                });
            }

            // Click outside to save (with small delay to avoid immediate trigger)
            // Capture currentEditingCell reference before setTimeout to detect if it
            // changed (e.g. arrow key navigation completed) before the 100ms fires (issue #525)
            const editingCellRef = this.currentEditingCell;
            setTimeout(() => {
                const outsideClickHandler = async (e) => {
                    if (!cell.contains(e.target)) {
                        document.removeEventListener('click', outsideClickHandler);

                        // Check if click is on another editable cell - preserve focus (issue #518)
                        const clickedCell = e.target.closest('td[data-editable="true"]');
                        if (clickedCell && clickedCell !== cell) {
                            // Remember the clicked cell to edit after save completes
                            this.pendingCellClick = clickedCell;
                        }

                        // Issue #913: capture editing state before save attempt.
                        // If saveEdit() fails validation (e.g. first column empty) the editor stays
                        // open, so we must re-register this handler so the user can still save by
                        // clicking outside after correcting the value.
                        const editingCellBeforeSave = this.currentEditingCell;
                        await saveEdit();
                        // If currentEditingCell is unchanged after saveEdit(), it means the edit was
                        // not completed (validation rejected the value) — re-register the handler.
                        if (this.currentEditingCell === editingCellBeforeSave && this.currentEditingCell !== null) {
                            // Clear any pending cell navigation since we didn't actually save
                            this.pendingCellClick = null;
                            document.addEventListener('click', outsideClickHandler);
                            this.currentEditingCell.outsideClickHandler = outsideClickHandler;
                        }
                    }
                };
                document.addEventListener('click', outsideClickHandler);

                // Store handler reference to clean up if canceled.
                // Guard against null: currentEditingCell may have been cleared by a fast
                // save triggered by arrow-key navigation before this 100ms timeout fires (issue #525).
                if (this.currentEditingCell === editingCellRef && this.currentEditingCell !== null) {
                    this.currentEditingCell.outsideClickHandler = outsideClickHandler;
                } else {
                    // Edit was already finished; remove the listener immediately so it doesn't linger
                    document.removeEventListener('click', outsideClickHandler);
                }
            }, 100);
        }

        /**
         * Issue #1384: Move a reference dropdown out of the table's overflow-clipping context
         * by appending it to document.body and positioning it with fixed coordinates.
         * Stores the detached element on currentEditingCell.fixedDropdown for cleanup.
         */
        _attachFixedDropdown(dropdown, header) {
            const rect = header.getBoundingClientRect();
            dropdown.style.position = 'fixed';
            dropdown.style.top = `${rect.bottom}px`;
            dropdown.style.left = `${rect.left}px`;
            dropdown.style.width = `${rect.width}px`;
            dropdown.style.right = 'auto';
            document.body.appendChild(dropdown);
            if (this.currentEditingCell) {
                this.currentEditingCell.fixedDropdown = dropdown;
            }
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
                let buttonHtml = `<button class="inline-editor-reference-clear" title="Очистить значение" aria-label="Очистить значение"><i class="pi pi-times"></i></button>`;
                if (showAddButton) {
                    buttonHtml += `<button class="inline-editor-reference-add" style="display: none;" title="Создать запись" aria-label="Создать запись"><i class="pi pi-plus"></i></button>`;
                }

                // Create dropdown with search
                const editorHtml = `
                    <div class="inline-editor-reference">
                        <div class="inline-editor-reference-header">
                            <input type="text"
                                   class="inline-editor-reference-search"
                                   placeholder="Поиск..."
                                   autocomplete="off" readonly onfocus="this.removeAttribute('readonly')" onmousedown="this.removeAttribute('readonly')">
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

                // Issue #1384: Move dropdown to body so it is not clipped by the table's overflow.
                // Position it fixed below the header using the header's bounding rect.
                const header = cell.querySelector('.inline-editor-reference-header');
                if (header) {
                    this._attachFixedDropdown(dropdown, header);
                }

                // Store original options for filtering (array of [id, text] tuples)
                this.currentEditingCell.referenceOptions = options;
                // Track if all options have been fetched (50+ means we only got first 50)
                this.currentEditingCell.allOptionsFetched = options.length < 50;

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
                // Closure to capture cancelEdit and saveEdit functions for Tab navigation (issue #518)
                const cancelEdit = () => {
                    this.cancelInlineEdit(originalContent);
                };
                const saveEditRef = async () => {
                    // Select first option if available, otherwise just cancel
                    const firstOption = dropdown.querySelector('.inline-editor-reference-option');
                    if (firstOption) {
                        const selectedId = firstOption.dataset.id;
                        const selectedText = firstOption.dataset.text;
                        await this.saveReferenceEdit(selectedId, selectedText);
                    } else {
                        cancelEdit();
                    }
                };

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
                    } else if (e.key === 'Tab') {
                        // Tab / Shift+Tab: navigate to next/previous editable cell (issue #518)
                        // Fix for issue #523: Don't select first option on Tab, just cancel and navigate
                        e.preventDefault();
                        const direction = e.shiftKey ? 'prev' : 'next';
                        this.saveAndNavigate(direction, cancelEdit, cancelEdit);
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
                    } else if (e.key === 'Tab') {
                        // Tab / Shift+Tab: navigate to next/previous editable cell (issue #518)
                        // Fix for issue #523: Don't select first option on Tab, just cancel and navigate
                        e.preventDefault();
                        const direction = e.shiftKey ? 'prev' : 'next';
                        this.saveAndNavigate(direction, cancelEdit, cancelEdit);
                    }
                });

                // Click outside to cancel (with small delay to avoid immediate trigger)
                // Capture currentEditingCell reference before setTimeout to detect if it
                // changed (e.g. arrow key navigation completed) before the 100ms fires (issue #525)
                const editingCellRef = this.currentEditingCell;
                setTimeout(() => {
                    const outsideClickHandler = (e) => {
                        // Don't cancel if clicking inside reference creation modal
                        const refModal = e.target.closest('[data-is-reference-create="true"]');
                        const refOverlay = e.target.closest('.edit-form-overlay');
                        if (refModal || refOverlay) {
                            return;
                        }
                        // Issue #1384: dropdown is detached from cell (appended to body), so check it separately
                        const fixedDropdown = this.currentEditingCell && this.currentEditingCell.fixedDropdown;
                        if (fixedDropdown && fixedDropdown.contains(e.target)) {
                            return;
                        }
                        if (!cell.contains(e.target)) {
                            document.removeEventListener('click', outsideClickHandler);

                            // Check if click is on another editable cell - preserve focus (issue #518)
                            const clickedCell = e.target.closest('td[data-editable="true"]');
                            if (clickedCell && clickedCell !== cell) {
                                // Remember the clicked cell to edit after cancel completes
                                this.pendingCellClick = clickedCell;
                            }

                            this.cancelInlineEdit(originalContent);
                        }
                    };
                    document.addEventListener('click', outsideClickHandler);

                    // Guard against null: currentEditingCell may have been cleared by a fast
                    // save triggered by arrow-key navigation before this 100ms timeout fires (issue #525).
                    if (this.currentEditingCell === editingCellRef && this.currentEditingCell !== null) {
                        this.currentEditingCell.outsideClickHandler = outsideClickHandler;
                    } else {
                        // Edit was already finished; remove the listener immediately so it doesn't linger
                        document.removeEventListener('click', outsideClickHandler);
                    }
                }, 100);

            } catch (error) {
                console.error('Error rendering reference editor:', error);
                this.showToast(`Ошибка загрузки справочника: ${error.message}`, 'error');
                this.cancelInlineEdit(originalContent);
            }
        }

        /**
         * Issue #853: Render multi-select reference editor for cells with :MULTI: in attrs.
         * Shows currently selected values as removable tags and a search input to add more.
         */
        async renderMultiReferenceEditor(cell, currentValue) {
            const originalContent = cell.innerHTML;
            const { colId, colType, parentInfo } = this.currentEditingCell;

            // Check if add button should be shown (same condition as single reference, issue #875)
            const column = this.columns.find(c => c.id === colId);
            const hasGranted = column && column.granted === 1;
            const origType = column && column.orig ? column.orig : null;
            const showAddButton = hasGranted && origType !== null;

            // Store origType on currentEditingCell for use in add button handler
            this.currentEditingCell.origType = origType;
            // Flag this as multi-reference so saveRecordForReference adds to selection instead of replacing
            this.currentEditingCell.isMultiReference = true;

            cell.innerHTML = '<div class="inline-editor-loading">Загрузка...</div>';

            try {
                const options = await this.fetchReferenceOptions(colType, parentInfo.parentRecordId);
                this.currentEditingCell.referenceOptions = options;
                this.currentEditingCell.allOptionsFetched = options.length < 50;

                // Issue #863: For multi-select fields, raw value is "id1,id2,...:val1,val2,..."
                // Prefer resolving selected items by ID directly from raw value attribute,
                // falling back to text-based lookup for backward compatibility.
                const rawValue = cell.dataset.rawValue || '';
                const selectedItems = [];
                const rawColonIndex = rawValue.indexOf(':');
                if (rawValue && rawColonIndex > 0) {
                    // Parse IDs from the left side of ':'
                    const ids = rawValue.substring(0, rawColonIndex).split(',').map(v => v.trim()).filter(v => v.length > 0);
                    for (const id of ids) {
                        const match = options.find(([optId]) => String(optId) === id);
                        if (match) {
                            selectedItems.push({ id: match[0], text: match[1] });
                        } else {
                            // ID not found in options – keep with empty text
                            selectedItems.push({ id, text: id });
                        }
                    }
                } else {
                    // Fallback: parse display names from currentValue and match against options by text
                    const currentTexts = currentValue
                        ? currentValue.split(',').map(v => v.trim()).filter(v => v.length > 0)
                        : [];
                    for (const text of currentTexts) {
                        const match = options.find(([id, t]) => t === text);
                        if (match) {
                            selectedItems.push({ id: match[0], text: match[1] });
                        } else if (text) {
                            // Unknown text – keep it with empty id so user can see it
                            selectedItems.push({ id: '', text });
                        }
                    }
                }
                this.currentEditingCell.selectedItems = selectedItems;

                const renderEditor = this.currentEditingCell.renderEditor = () => {
                    const selected = this.currentEditingCell.selectedItems;
                    const selectedIds = new Set(selected.map(s => s.id).filter(id => id));

                    const tagsHtml = selected.map(({ id, text }) => `
                        <span class="multi-ref-tag" data-id="${this.escapeHtml(id)}" data-text="${this.escapeHtml(text)}">
                            ${this.escapeHtml(text)}
                            <button class="multi-ref-tag-remove" type="button" title="Удалить" aria-label="Удалить ${this.escapeHtml(text)}"><i class="pi pi-times"></i></button>
                        </span>
                    `).join('');

                    const availableOptions = (this.currentEditingCell.referenceOptions || [])
                        .filter(([id]) => !selectedIds.has(id));
                    const optionsHtml = availableOptions.length > 0
                        ? availableOptions.map(([id, text]) => {
                            const escapedText = this.escapeHtml(text);
                            return `<div class="inline-editor-reference-option" data-id="${id}" data-text="${escapedText}" tabindex="0">${escapedText}</div>`;
                        }).join('')
                        : '<div class="inline-editor-reference-empty">Нет доступных значений</div>';

                    const addButtonHtml = showAddButton
                        ? `<button class="inline-editor-reference-add" style="display: none;" title="Создать запись" aria-label="Создать запись" type="button"><i class="pi pi-plus"></i></button>`
                        : '';

                    cell.innerHTML = `
                        <div class="inline-editor-reference inline-editor-multi-reference">
                            <div class="multi-ref-tags-container">${tagsHtml || '<span class="multi-ref-tags-placeholder">Нет выбранных значений</span>'}</div>
                            <div class="inline-editor-reference-header">
                                <input type="text"
                                       class="inline-editor-reference-search"
                                       placeholder="Добавить..."
                                       autocomplete="off" readonly onfocus="this.removeAttribute('readonly')" onmousedown="this.removeAttribute('readonly')">
                                ${addButtonHtml}
                            </div>
                            <div class="inline-editor-reference-dropdown" style="display:none;">
                                ${optionsHtml}
                            </div>
                        </div>
                    `;

                    const searchInput = cell.querySelector('.inline-editor-reference-search');
                    const dropdown = cell.querySelector('.inline-editor-reference-dropdown');
                    const tagsContainer = cell.querySelector('.multi-ref-tags-container');
                    const addButton = cell.querySelector('.inline-editor-reference-add');

                    // Issue #1384: Move dropdown to body so it is not clipped by the table's overflow.
                    // Remove any previously detached dropdown from body before attaching the new one.
                    if (this.currentEditingCell && this.currentEditingCell.fixedDropdown && this.currentEditingCell.fixedDropdown.parentNode) {
                        this.currentEditingCell.fixedDropdown.parentNode.removeChild(this.currentEditingCell.fixedDropdown);
                    }
                    const multiRefHeader = cell.querySelector('.inline-editor-reference-header');
                    if (multiRefHeader) {
                        this._attachFixedDropdown(dropdown, multiRefHeader);
                    }

                    // Handle add button click: open create form (issue #875)
                    if (addButton && origType) {
                        addButton.addEventListener('click', async (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            const inputValue = searchInput.value.trim();
                            await this.openCreateFormForReference(origType, inputValue, parentInfo.parentRecordId);
                        });
                    }

                    // Show dropdown immediately (issue #891: focus event fires before listener is attached on re-render)
                    dropdown.style.display = '';

                    // Hide dropdown on blur (when user clicks outside search input and dropdown)
                    searchInput.addEventListener('blur', (e) => {
                        // Only hide if focus is not moving to an option inside the dropdown
                        if (!dropdown.contains(e.relatedTarget)) {
                            dropdown.style.display = 'none';
                        }
                    });

                    // Filter dropdown on input
                    let searchTimeout;
                    searchInput.addEventListener('input', async (e) => {
                        const searchText = e.target.value.trim();

                        // Toggle add button visibility based on search input (issue #875)
                        if (addButton) {
                            addButton.style.display = searchText.length > 0 ? '' : 'none';
                        }

                        clearTimeout(searchTimeout);
                        searchTimeout = setTimeout(async () => {
                            const currentSelected = new Set(this.currentEditingCell.selectedItems.map(s => s.id));
                            let filtered = (this.currentEditingCell.referenceOptions || [])
                                .filter(([id, text]) => !currentSelected.has(id) && text.toLowerCase().includes(searchText.toLowerCase()));

                            if (!this.currentEditingCell.allOptionsFetched && searchText) {
                                try {
                                    const serverOptions = await this.fetchReferenceOptions(colType, parentInfo.parentRecordId, searchText);
                                    const serverFiltered = serverOptions.filter(([id]) => !currentSelected.has(id));
                                    dropdown.innerHTML = serverFiltered.length > 0
                                        ? serverFiltered.map(([id, text]) => {
                                            const et = this.escapeHtml(text);
                                            return `<div class="inline-editor-reference-option" data-id="${id}" data-text="${et}" tabindex="0">${et}</div>`;
                                        }).join('')
                                        : '<div class="inline-editor-reference-empty">Нет доступных значений</div>';
                                } catch (err) {
                                    console.error('Error re-querying options:', err);
                                }
                            } else {
                                dropdown.innerHTML = filtered.length > 0
                                    ? filtered.map(([id, text]) => {
                                        const et = this.escapeHtml(text);
                                        return `<div class="inline-editor-reference-option" data-id="${id}" data-text="${et}" tabindex="0">${et}</div>`;
                                    }).join('')
                                    : '<div class="inline-editor-reference-empty">Нет доступных значений</div>';
                            }
                            dropdown.style.display = '';
                        }, 300);
                    });

                    // Handle option selection from dropdown
                    dropdown.addEventListener('click', async (e) => {
                        const option = e.target.closest('.inline-editor-reference-option');
                        if (!option) return;
                        const id = option.dataset.id;
                        const text = option.dataset.text;
                        if (!this.currentEditingCell.selectedItems.find(s => s.id === id)) {
                            this.currentEditingCell.selectedItems.push({ id, text });
                            await this.saveMultiReferenceEdit();
                        }
                        searchInput.value = '';
                        renderEditor();
                        cell.querySelector('.inline-editor-reference-search')?.focus();
                    });

                    // Handle tag click: remove button removes tag, clicking tag itself opens edit form (issue #871)
                    tagsContainer.addEventListener('click', async (e) => {
                        const removeBtn = e.target.closest('.multi-ref-tag-remove');
                        if (removeBtn) {
                            const tag = removeBtn.closest('.multi-ref-tag');
                            if (!tag) return;
                            const id = tag.dataset.id;
                            const text = tag.dataset.text;
                            this.currentEditingCell.selectedItems = this.currentEditingCell.selectedItems.filter(s => !(s.id === id && s.text === text));
                            await this.saveMultiReferenceEdit();
                            renderEditor();
                            cell.querySelector('.inline-editor-reference-search')?.focus();
                            return;
                        }
                        const tag = e.target.closest('.multi-ref-tag');
                        if (!tag) return;
                        const id = tag.dataset.id;
                        if (!id) return;
                        // Issue #873: use the referenced table's orig/ref ID, not the requisite field ID (colType)
                        const col = this.columns.find(c => c.id === this.currentEditingCell.colId);
                        const refTypeId = (col && (col.orig || col.ref)) || this.currentEditingCell.colType;
                        if (refTypeId) {
                            this.openEditForm(id, refTypeId, 0);
                        }
                    });

                    // Keyboard navigation in search input
                    searchInput.addEventListener('keydown', (e) => {
                        if (e.key === 'Escape') {
                            e.preventDefault();
                            this.cancelInlineEdit(originalContent);
                        } else if (e.key === 'ArrowDown') {
                            e.preventDefault();
                            const firstOption = dropdown.querySelector('.inline-editor-reference-option');
                            if (firstOption) firstOption.focus();
                        } else if (e.key === 'Enter') {
                            e.preventDefault();
                            const firstOption = dropdown.querySelector('.inline-editor-reference-option');
                            if (firstOption) firstOption.click();
                        }
                    });

                    searchInput.focus();
                };

                renderEditor();

                // Click outside to close
                const editingCellRef = this.currentEditingCell;
                setTimeout(() => {
                    const outsideClickHandler = (e) => {
                        // Issue #1384: dropdown is detached from cell (appended to body), so check it separately
                        const fixedDropdown = this.currentEditingCell && this.currentEditingCell.fixedDropdown;
                        if (fixedDropdown && fixedDropdown.contains(e.target)) {
                            return;
                        }
                        if (!cell.contains(e.target)) {
                            document.removeEventListener('click', outsideClickHandler);
                            // Issue #879: Use saved content if any saves occurred, otherwise restore original
                            const contentToRestore = (this.currentEditingCell && this.currentEditingCell.savedContent !== undefined)
                                ? this.currentEditingCell.savedContent
                                : originalContent;
                            this.cancelInlineEdit(contentToRestore);
                        }
                    };
                    document.addEventListener('click', outsideClickHandler);
                    if (this.currentEditingCell === editingCellRef && this.currentEditingCell !== null) {
                        this.currentEditingCell.outsideClickHandler = outsideClickHandler;
                    } else {
                        document.removeEventListener('click', outsideClickHandler);
                    }
                }, 100);

            } catch (error) {
                console.error('Error rendering multi-reference editor:', error);
                this.showToast(`Ошибка загрузки справочника: ${error.message}`, 'error');
                this.cancelInlineEdit(originalContent);
            }
        }

        /**
         * Issue #853: Save the current state of a multi-select reference field.
         * Sends all selected IDs as a comma-separated list to _m_set.
         */
        async saveMultiReferenceEdit() {
            if (!this.currentEditingCell) return;

            const { cell, colType, parentInfo, selectedItems } = this.currentEditingCell;
            const ids = (selectedItems || []).map(s => s.id).filter(id => id);

            try {
                const apiBase = this.getApiBase();
                const params = new URLSearchParams();
                if (typeof xsrf !== 'undefined') {
                    params.append('_xsrf', xsrf);
                }
                // Send comma-separated IDs (or empty string to clear)
                params.append(`t${colType}`, ids.join(','));

                const url = parentInfo.isFirstColumn
                    ? `${apiBase}/_m_save/${parentInfo.parentRecordId}?JSON`
                    : `${apiBase}/_m_set/${parentInfo.parentRecordId}?JSON`;

                const response = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: params.toString()
                });

                const responseText = await response.text();
                let result;
                try {
                    result = JSON.parse(responseText);
                } catch (jsonError) {
                    throw new Error(`Невалидный JSON ответ: ${responseText}`);
                }

                if (result.error) {
                    throw new Error(result.error);
                }

                // Update cell display with comma-separated text of selected items
                const displayText = (selectedItems || []).map(s => s.text).join(', ');
                this.updateCellDisplay(cell, displayText, this.currentEditingCell.format);

                // Issue #879: Update data-raw-value so re-opening editor uses correct selections
                const rawValue = ids.join(',') + ':' + (selectedItems || []).map(s => s.text).join(',');
                cell.dataset.rawValue = rawValue;

                // Issue #879: Track saved cell content so closing the editor shows saved state
                this.currentEditingCell.savedContent = cell.innerHTML;

            } catch (error) {
                console.error('Error saving multi-reference edit:', error);
                this.showToast(`Ошибка сохранения: ${error.message}`, 'error');
            }
        }

        renderReferenceOptions(options, currentValue) {
            // options is an array of [id, text] tuples
            // Filter out current value from options
            const filteredOptions = options.filter(([id, text]) => text !== currentValue);

            if (filteredOptions.length === 0) {
                return '<div class="inline-editor-reference-empty">Нет доступных значений</div>';
            }

            return filteredOptions.map(([id, text]) => {
                const escapedText = this.escapeHtml(text);
                return `<div class="inline-editor-reference-option" data-id="${id}" data-text="${escapedText}" tabindex="0">${escapedText}</div>`;
            }).join('');
        }

        filterReferenceOptions(options, searchText, currentValue) {
            // options is an array of [id, text] tuples
            const lowerSearch = searchText.toLowerCase();
            return options.filter(([id, text]) =>
                text !== currentValue && text.toLowerCase().includes(lowerSearch)
            );
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

                // Use _m_save for first column (issue #775), _m_set for requisites
                const url = parentInfo.isFirstColumn
                    ? `${apiBase}/_m_save/${parentInfo.parentRecordId}?JSON`
                    : `${apiBase}/_m_set/${parentInfo.parentRecordId}?JSON`;


                const response = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded'
                    },
                    body: params.toString()
                });

                let result;
                const responseText = await response.text();

                try {
                    result = JSON.parse(responseText);
                } catch (jsonError) {
                    // Invalid JSON response
                    throw new Error(`Невалидный JSON ответ: ${responseText}`);
                }

                // Check if response has error key anywhere in the JSON
                if (result.error) {
                    throw new Error(result.error);
                }

                // Issue #921: Update data-ref-value-id so the edit icon uses the correct
                // reference record ID (not the parent row's record ID) when the cell was
                // previously empty and gets its first value via a reference selection
                cell.dataset.refValueId = selectedId;

                // Update the cell display with the selected text
                this.updateCellDisplay(cell, selectedText, this.currentEditingCell.format);

                this.showToast('Изменения сохранены', 'success');

            } catch (error) {
                console.error('Error saving reference edit:', error);
                this.showToast(`Ошибка сохранения: ${error.message}`, 'error');
                // Restore original content on error (cancelInlineEdit also clears required highlights)
                this.cancelInlineEdit(cell.dataset.originalContent);
            } finally {
                // Clean up
                if (this.currentEditingCell) {
                    // Remove required field highlighting (issue #779)
                    this.clearRequiredCellHighlights(this.currentEditingCell.cell);
                    if (this.currentEditingCell.outsideClickHandler) {
                        document.removeEventListener('click', this.currentEditingCell.outsideClickHandler);
                    }
                    // Issue #1384: Remove fixed dropdown overlay from body if present
                    if (this.currentEditingCell.fixedDropdown && this.currentEditingCell.fixedDropdown.parentNode) {
                        this.currentEditingCell.fixedDropdown.parentNode.removeChild(this.currentEditingCell.fixedDropdown);
                    }
                    this.currentEditingCell = null;
                }

                // Navigate to pending cell if set (issue #518)
                if (this.pendingCellClick) {
                    const targetCell = this.pendingCellClick;
                    this.pendingCellClick = null;
                    this.navigateToCell(targetCell);
                }
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

            // Get current date/datetime for default values
            const now = new Date();
            const currentDateHtml5 = now.toISOString().split('T')[0]; // YYYY-MM-DD
            const minutes = Math.round(now.getMinutes() / 5) * 5; // Round to 5 minutes
            now.setMinutes(minutes);
            const currentDateTimeHtml5 = now.toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM
            const currentDateDisplay = now.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '.'); // DD.MM.YYYY
            const currentDateTimeDisplay = currentDateDisplay + ' ' + now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }); // DD.MM.YYYY HH:MM

            // Determine main field type
            const mainFieldType = this.normalizeFormat(metadata.type);

            // Build main field HTML based on its type
            let mainFieldHtml = '';
            if (mainFieldType === 'BOOLEAN') {
                const isChecked = initialValue ? 'checked' : '';
                mainFieldHtml = `<input type="checkbox" id="field-main-ref-create" name="main" value="1" ${ isChecked }>`;
            } else if (mainFieldType === 'DATE') {
                const dateValueHtml5 = initialValue ? this.formatDateForHtml5(initialValue, false) : currentDateHtml5;
                const dateValueDisplay = initialValue ? this.formatDateForInput(initialValue, false) : currentDateDisplay;
                mainFieldHtml = `<input type="date" class="form-control date-picker" id="field-main-ref-create-picker" required data-target="field-main-ref-create" value="${ this.escapeHtml(dateValueHtml5) }">`;
                mainFieldHtml += `<input type="hidden" id="field-main-ref-create" name="main" value="${ this.escapeHtml(dateValueDisplay) }">`;
            } else if (mainFieldType === 'DATETIME') {
                const dateTimeValueHtml5 = initialValue ? this.formatDateForHtml5(initialValue, true) : currentDateTimeHtml5;
                const dateTimeValueDisplay = initialValue ? this.formatDateForInput(initialValue, true) : currentDateTimeDisplay;
                mainFieldHtml = `<input type="datetime-local" class="form-control datetime-picker" id="field-main-ref-create-picker" required data-target="field-main-ref-create" value="${ this.escapeHtml(dateTimeValueHtml5) }">`;
                mainFieldHtml += `<input type="hidden" id="field-main-ref-create" name="main" value="${ this.escapeHtml(dateTimeValueDisplay) }">`;
            } else if (mainFieldType === 'NUMBER') {
                mainFieldHtml = `<input type="number" class="form-control" id="field-main-ref-create" name="main" value="${ this.escapeHtml(initialValue) }" required>`;
            } else if (mainFieldType === 'SIGNED') {
                mainFieldHtml = `<input type="number" class="form-control" id="field-main-ref-create" name="main" value="${ this.escapeHtml(initialValue) }" required step="0.01">`;
            } else if (mainFieldType === 'MEMO') {
                mainFieldHtml = `<textarea class="form-control memo-field" id="field-main-ref-create" name="main" rows="4" required>${ this.escapeHtml(initialValue) }</textarea>`;
            } else {
                // Default: text input (SHORT, CHARS, etc.)
                mainFieldHtml = `<input type="text" class="form-control" id="field-main-ref-create" name="main" value="${this.escapeHtml(initialValue)}" required>`;
            }

            // For DATE/DATETIME, the visible/interactive element is the picker input (id="field-main-ref-create-picker"),
            // not the hidden input (id="field-main-ref-create"), so the label must point to the picker (issue #889)
            const mainLabelTarget = (mainFieldType === 'DATE' || mainFieldType === 'DATETIME') ? 'field-main-ref-create-picker' : 'field-main-ref-create';
            let attributesHtml = `
                <div class="form-group">
                    <label for="${mainLabelTarget}">${typeName} <span class="required">*</span></label>
                    ${ mainFieldHtml }
                </div>
            `;

            // Add all fields of this type
            regularFields.forEach(req => {
                const attrs = this.parseAttrs(req.attrs);
                const fieldName = attrs.alias || req.val;
                const isRequired = attrs.required;

                attributesHtml += `<div class="form-group">`;
                // For reference fields, the visible/interactive element is the search input (id="field-ref-${req.id}-search"),
                // not the hidden input (id="field-ref-${req.id}"), so the label must point to the search input (issue #889)
                const labelTarget = req.ref_id ? `field-ref-${req.id}-search` : `field-ref-${req.id}`;
                attributesHtml += `<label for="${labelTarget}">${fieldName}${isRequired ? ' <span class="required">*</span>' : ''}</label>`;

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
                                           autocomplete="off" readonly onfocus="this.removeAttribute('readonly')" onmousedown="this.removeAttribute('readonly')">
                                    <button class="inline-editor-reference-clear form-ref-clear" title="Очистить значение" aria-label="Очистить значение" type="button"><i class="pi pi-times"></i></button>
                                    <button class="inline-editor-reference-add form-ref-add" style="display: none;" title="Создать запись" aria-label="Создать запись" type="button"><i class="pi pi-plus"></i></button>
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
                    <h3>${title}</h3>
                    <button class="edit-form-close" data-close-modal-ref="true"><i class="pi pi-times"></i></button>
                </div>
                <div class="edit-form-body">
                    <form id="edit-form-ref-create" class="edit-form" onsubmit="return false;" autocomplete="off">
                        ${attributesHtml}
                    </form>
                </div>
                <div class="edit-form-footer">
                    <div class="edit-form-footer-buttons">
                        <button type="button" class="btn btn-primary" id="save-record-ref-btn">Сохранить</button>
                        <button type="button" class="btn btn-secondary" data-close-modal-ref="true">Отменить</button>
                    </div>
                </div>
            `;

            modal.innerHTML = formHtml;
            document.body.appendChild(overlay);
            document.body.appendChild(modal);

            // Load reference options for dropdown fields
            this.loadReferenceOptions(regularFields, parentRecordId, modal);

            // Load GRANT and REPORT_COLUMN dropdown options (issue #577)
            this.loadGrantAndReportColumnOptions(modal);

            // Attach date/datetime picker handlers
            this.attachDatePickerHandlers(modal);

            // Attach save handler
            const saveBtn = modal.querySelector('#save-record-ref-btn');
            saveBtn.addEventListener('click', async () => {
                saveBtn.disabled = true;
                try {
                    await this.saveRecordForReference(modal, typeId, parentRecordId);
                } finally {
                    saveBtn.disabled = false;
                }
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

            // Close on Escape key (issue #595)
            const handleEscape = (e) => {
                if (e.key === 'Escape') {
                    // Only close if this modal is the topmost one
                    const currentDepth = parseInt(modal.dataset.modalDepth) || 0;
                    const maxDepth = window._integramModalDepth || 0;
                    if (currentDepth === maxDepth) {
                        closeModal();
                        document.removeEventListener('keydown', handleEscape);
                    }
                }
            };
            document.addEventListener('keydown', handleEscape);

            // Enter in input/textarea triggers Save (issue #1422)
            modal.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) {
                    if (!saveBtn.disabled) {
                        e.preventDefault();
                        saveBtn.click();
                    }
                }
            });

            // Focus the first visible, non-hidden input/textarea/select in the form (issue #1420)
            const firstField = modal.querySelector('input:not([type="hidden"]):not([type="checkbox"]):not([readonly]), textarea, select');
            if (firstField) {
                firstField.focus();
            }
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
            // Issue #616: Use F_U from URL as parent (up) when F_U > 1
            const parentIdForNew = (this.options.parentId && parseInt(this.options.parentId) > 1) ? this.options.parentId : 1;
            const url = `${apiBase}/_m_new/${typeId}?JSON&up=${parentIdForNew}`;

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
                    if (this.currentEditingCell.isMultiReference) {
                        // Issue #875: For multi-reference, add the new item to selected items
                        if (!this.currentEditingCell.selectedItems.find(s => s.id === String(createdId))) {
                            this.currentEditingCell.selectedItems.push({ id: String(createdId), text: createdValue });
                        }
                        await this.saveMultiReferenceEdit();
                        // Re-render the editor to show the newly added tag
                        if (this.currentEditingCell.renderEditor) {
                            this.currentEditingCell.renderEditor();
                            this.currentEditingCell.cell.querySelector('.inline-editor-reference-search')?.focus();
                        }
                    } else {
                        await this.saveReferenceEdit(createdId, createdValue);
                    }
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

            const { cell, recordId, colId, colType, parentInfo, isNewRow, rowIndex } = this.currentEditingCell;

            // Handle new row first column save separately (issue #807)
            if (isNewRow && parentInfo && parentInfo.isFirstColumn) {
                await this.saveNewRowFirstColumn(newValue);
                return;
            }

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
                } else {
                    // Use _m_set for requisites
                    url = `${ apiBase }/_m_set/${ parentRecordId }?JSON`;
                }

                // For FILE type with a pending file, send directly as multipart (issue #1310)
                const format = this.currentEditingCell.format;
                const editorEl = cell.querySelector('.inline-editor');
                let response;
                if (format === 'FILE' && editorEl && editorEl._fileToUpload) {
                    const formData = new FormData();
                    if (typeof xsrf !== 'undefined') {
                        formData.append('_xsrf', xsrf);
                    }
                    formData.append(`t${ colType }`, editorEl._fileToUpload);
                    response = await fetch(url, {
                        method: 'POST',
                        body: formData
                    });
                } else {
                    params.append(`t${ colType }`, newValue);
                    response = await fetch(url, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/x-www-form-urlencoded'
                        },
                        body: params.toString()
                    });
                }

                let result;
                const responseText = await response.text();

                try {
                    result = JSON.parse(responseText);
                } catch (jsonError) {
                    // Invalid JSON response
                    throw new Error(`Невалидный JSON ответ: ${responseText}`);
                }

                // Check if response has error key anywhere in the JSON
                if (result.error) {
                    throw new Error(result.error);
                }

                // Check for warnings (plural) - show modal but continue with save (issue #610)
                // These are informational warnings that don't block the save
                if (result.warnings) {
                    this.showWarningsModal(result.warnings);
                }

                // For FILE type: get saved path from server response (issue #1310)
                if (format === 'FILE' && editorEl && editorEl._fileToUpload) {
                    newValue = result.path || result.file || result.filename || editorEl._fileToUpload.name;
                    editorEl._fileToUpload = null;
                }

                // Update the cell display with the new value
                // For GRANT/REPORT_COLUMN, use the display text instead of the ID (issue #601)
                const displayValue = (this.currentEditingCell.format === 'GRANT' || this.currentEditingCell.format === 'REPORT_COLUMN')
                    ? (this.currentEditingCell.displayText || newValue)
                    : newValue;
                this.updateCellDisplay(cell, displayValue, this.currentEditingCell.format);

                this.showToast('Изменения сохранены', 'success');

            } catch (error) {
                console.error('Error saving inline edit:', error);
                this.showToast(`Ошибка сохранения: ${ error.message }`, 'error');
                // Restore original content on error (cancelInlineEdit also clears required highlights)
                this.cancelInlineEdit(cell.dataset.originalContent);
            } finally {
                // Clean up
                if (this.currentEditingCell) {
                    // Remove required field highlighting (issue #779)
                    this.clearRequiredCellHighlights(this.currentEditingCell.cell);
                    if (this.currentEditingCell.outsideClickHandler) {
                        document.removeEventListener('click', this.currentEditingCell.outsideClickHandler);
                    }
                    this.currentEditingCell = null;
                }

                // Navigate to pending cell if set (issue #518)
                if (this.pendingCellClick) {
                    const targetCell = this.pendingCellClick;
                    this.pendingCellClick = null;
                    this.navigateToCell(targetCell);
                }
            }
        }

        /**
         * Save the first column value of a new row (issue #807)
         * Creates a new record with _m_new/{tableTypeId}?JSON, passing only the first column value
         * After successful creation, fetches the full row data with edit_obj
         * @param {string} newValue - Value for the first column
         */
        async saveNewRowFirstColumn(newValue) {
            if (!this.currentEditingCell || !this.pendingNewRow) {
                return;
            }

            const { cell, rowIndex } = this.currentEditingCell;
            const { tableTypeId } = this.pendingNewRow;

            // Validate: first column value cannot be empty
            if (!newValue || newValue.trim() === '') {
                this.showToast('Значение первой колонки не может быть пустым', 'error');
                return;
            }

            try {
                const apiBase = this.getApiBase();
                const params = new URLSearchParams();

                // Add XSRF token
                if (typeof xsrf !== 'undefined') {
                    params.append('_xsrf', xsrf);
                }

                // Add only the first column value (t{tableTypeId} = value)
                params.append(`t${tableTypeId}`, newValue);

                // Use F_U from URL as parent (up) when F_U > 1 (issue #616)
                const parentIdForNew = (this.options.parentId && parseInt(this.options.parentId) > 1) ? this.options.parentId : 1;
                const url = `${apiBase}/_m_new/${tableTypeId}?JSON&up=${parentIdForNew}`;

                const response = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded'
                    },
                    body: params.toString()
                });

                const responseText = await response.text();

                let result;
                try {
                    result = JSON.parse(responseText);
                } catch (e) {
                    if (responseText.includes('error') || !response.ok) {
                        throw new Error(responseText);
                    }
                    result = { success: true };
                }

                if (result.error) {
                    throw new Error(result.error);
                }

                // Extract created record ID from response
                // According to the issue: "её id приходит в ключе obj JSON"
                const createdId = result.obj || result.id || result.i;

                if (!createdId) {
                    throw new Error('Не удалось получить ID созданной записи');
                }

                // Update the rawObjectData with the real record ID
                if (this.rawObjectData[rowIndex]) {
                    this.rawObjectData[rowIndex].i = createdId;
                    this.rawObjectData[rowIndex]._isNewRow = false;  // No longer pending
                    this.rawObjectData[rowIndex]._isPartialRow = true;  // Partially created
                }

                // Update the first column display value
                this.updateCellDisplay(cell, newValue, this.currentEditingCell.format);

                // Clear the editing state for the first column
                this.clearNewRowRequiredHighlights(cell);

                // Clean up current editing cell
                if (this.currentEditingCell.outsideClickHandler) {
                    document.removeEventListener('click', this.currentEditingCell.outsideClickHandler);
                }
                this.currentEditingCell = null;

                this.showToast('Запись создана', 'success');

                // Now fetch the full row data to get server-formatted/default values (issue #811)
                await this.fetchNewRowData(createdId, rowIndex);

                // Clear pending new row state
                this.pendingNewRow = null;

            } catch (error) {
                console.error('Error saving new row first column:', error);
                this.showToast(`Ошибка создания записи: ${error.message}`, 'error');
            }
        }

        /**
         * Fetch the full row data after creating a new record (issue #811)
         * Uses object/{tableTypeId}/?JSON_OBJ&t{tableTypeId}=@{recordId} to get all field values
         * including defaults and server-formatted values (e.g. numbers, dates).
         * Then updates the row and makes all cells editable.
         * @param {string|number} recordId - ID of the newly created record
         * @param {number} rowIndex - Index of the row in the data array
         */
        async fetchNewRowData(recordId, rowIndex) {
            try {
                const apiBase = this.getApiBase();
                const tableTypeId = this.objectTableId || this.options.tableTypeId;

                if (!tableTypeId) {
                    console.warn('fetchNewRowData: tableTypeId not available, skipping row refresh');
                    return;
                }

                // Fetch the record using the JSON_OBJ format with record ID filter (issue #811)
                // t{tableTypeId}=@{recordId} filters by the specific record ID
                const fetchUrl = `${apiBase}/object/${tableTypeId}/?JSON_OBJ&FR_${tableTypeId}=@${recordId}`;
                const response = await fetch(fetchUrl);

                if (!response.ok) {
                    console.error('Failed to fetch new row data:', response.status);
                    return;
                }

                const data = await response.json();

                // Response is JSON_OBJ array format: [{i, u, o, r}, ...]
                if (!Array.isArray(data) || data.length === 0) {
                    console.warn('fetchNewRowData: empty or invalid response from JSON_OBJ endpoint');
                    return;
                }

                const item = data[0];
                const newRowData = item.r || [];

                // Update the data array with the server-formatted row data
                this.data[rowIndex] = newRowData;

                // Update rawObjectData
                if (this.rawObjectData[rowIndex]) {
                    this.rawObjectData[rowIndex].r = newRowData;
                    this.rawObjectData[rowIndex]._isPartialRow = false;  // Now fully loaded
                }

                // Re-render the table to show the updated row with all cells editable
                this.render();

            } catch (error) {
                console.error('Error fetching new row data:', error);
                // Don't show error toast - the row was created successfully, just couldn't fetch defaults
            }
        }

        updateCellDisplay(cell, newValue, format) {
            // Update the display value in the cell after successful save
            let displayValue = newValue;

            let escapedValue;
            let fullValueForEditing;

            switch (format) {
                case 'BOOLEAN':
                    // Display as checkbox icon: any non-empty value = YES, empty = NO
                    const boolValue = newValue !== null && newValue !== undefined && newValue !== '' && newValue !== '0' && newValue !== false;
                    // For BOOLEAN, use HTML icon directly (no escaping) and store '1' or '0' for editing
                    escapedValue = boolValue ? '<span class="boolean-check"><i class="pi pi-check"></i></span>' : '<span class="boolean-uncheck"><i class="pi pi-times"></i></span>';
                    fullValueForEditing = boolValue ? '1' : '0';
                    break;
                case 'DATE':
                    if (newValue) {
                        const dateObj = this.parseDDMMYYYY(newValue);
                        if (dateObj && !isNaN(dateObj.getTime())) {
                            displayValue = this.formatDateDisplay(dateObj);
                        }
                    }
                    // Escape HTML for display
                    escapedValue = String(displayValue).replace(/&/g, '&amp;')
                                                        .replace(/</g, '&lt;')
                                                        .replace(/>/g, '&gt;')
                                                        .replace(/"/g, '&quot;')
                                                        .replace(/'/g, '&#039;');
                    // Fix for issue #684: Store RAW value for editing, not escaped
                    fullValueForEditing = String(displayValue);
                    break;
                case 'DATETIME':
                    if (newValue) {
                        const datetimeObj = this.parseDDMMYYYYHHMMSS(newValue);
                        if (datetimeObj && !isNaN(datetimeObj.getTime())) {
                            displayValue = this.formatDateTimeDisplay(datetimeObj);
                        }
                    }
                    // Escape HTML for display
                    escapedValue = String(displayValue).replace(/&/g, '&amp;')
                                                        .replace(/</g, '&lt;')
                                                        .replace(/>/g, '&gt;')
                                                        .replace(/"/g, '&quot;')
                                                        .replace(/'/g, '&#039;');
                    // Fix for issue #684: Store RAW value for editing, not escaped
                    fullValueForEditing = String(displayValue);
                    break;
                case 'GRANT':
                case 'REPORT_COLUMN':
                    // For GRANT/REPORT_COLUMN: newValue is the display text (issue #601)
                    // Store the selected ID in data-full-value for next edit (from currentEditingCell)
                    escapedValue = String(newValue).replace(/&/g, '&amp;')
                                                    .replace(/</g, '&lt;')
                                                    .replace(/>/g, '&gt;')
                                                    .replace(/"/g, '&quot;')
                                                    .replace(/'/g, '&#039;');
                    // Use the saved ID from currentEditingCell for future editing
                    // The saveInlineEdit method stores displayText, and the actual newValue (ID) is what was sent to API
                    // We need to get the ID that was saved - it's available via data-col-value or will be set separately
                    // Fix for issue #684: Store RAW value for editing, not escaped
                    fullValueForEditing = String(newValue); // This will be overridden later if we have the ID
                    break;
                default:
                    // Escape HTML for display
                    escapedValue = String(displayValue).replace(/&/g, '&amp;')
                                                        .replace(/</g, '&lt;')
                                                        .replace(/>/g, '&gt;')
                                                        .replace(/"/g, '&quot;')
                                                        .replace(/'/g, '&#039;');
                    // Fix for issue #684: Store RAW value for editing, not escaped
                    fullValueForEditing = String(displayValue);
                    break;
            }

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
            // Fix for issue #527: When clearing a cell (empty string), we must remove
            // the data-full-value attribute. Otherwise the old value persists and
            // appears when the cell is edited again. Empty string is falsy in JS,
            // so we use typeof check instead of truthiness.
            if (typeof fullValueForEditing === 'string') {
                if (fullValueForEditing === '') {
                    cell.removeAttribute('data-full-value');
                } else {
                    cell.setAttribute('data-full-value', fullValueForEditing);
                }
            }

            // Issue #1404: For reference fields, wrap the value in a hyperlink inside cell-content-wrapper
            const cellIsRef = cell.dataset.ref === '1';
            const cellRefValueId = cell.dataset.refValueId;
            const cellEditTypeId = cell.dataset.editTypeId;
            if (cellIsRef && cellRefValueId && cellEditTypeId && !cell.dataset.array) {
                const pathParts = window.location.pathname.split('/');
                const dbName = pathParts.length >= 2 ? pathParts[1] : '';
                const refUrl = `/${ dbName }/table/${ cellEditTypeId }?F_I=${ cellRefValueId }`;
                escapedValue = `<a href="${ refUrl }" class="ref-value-link" onclick="event.stopPropagation();">${ escapedValue }</a>`;
            }

            // Restore edit icon if present, or add it if the cell just got its first value (issue #915)
            const hasEditIcon = cell.querySelector('.edit-icon');
            if (hasEditIcon) {
                const editIconHtml = hasEditIcon.outerHTML;
                cell.innerHTML = `<div class="cell-content-wrapper">${ escapedValue }${ editIconHtml }</div>`;
            } else {
                // Issue #915: If the cell was empty (no edit icon) and now has a value,
                // add the edit icon using the stored data-edit-type-id attribute
                const editTypeId = cell.dataset.editTypeId;
                // Issue #921: For reference fields, use data-ref-value-id as the record ID
                // (the reference's own ID, e.g. role ID 520), not data-record-id (the parent
                // row's ID, e.g. user ID 557). data-ref-value-id is updated by saveReferenceEdit.
                const editRecordId = cell.dataset.refValueId || cell.dataset.recordId;
                const editRowIndex = cell.dataset.rowIndex;
                const hasNewValue = newValue !== null && newValue !== undefined && newValue !== '';
                if (hasNewValue && editTypeId && editRecordId && editRecordId !== '' && editRecordId !== '0' && editRecordId !== 'dynamic') {
                    const instanceName = this.options.instanceName;
                    const editIcon = `<span class="edit-icon" onclick="window.${ instanceName }.openEditForm('${ editRecordId }', '${ editTypeId }', ${ editRowIndex }); event.stopPropagation();" title="Редактировать"><i class="pi pi-pencil" style="font-size: 14px;"></i></span>`;
                    cell.innerHTML = `<div class="cell-content-wrapper">${ escapedValue }${ editIcon }</div>`;
                } else {
                    cell.innerHTML = escapedValue;
                }
            }

            // Update the data array as well
            const rowIndex = parseInt(cell.dataset.row);
            const colId = cell.dataset.colId;
            const column = this.columns.find(c => c.id === colId);
            const dataIndex = column ? this.columns.indexOf(column) : parseInt(cell.dataset.col);
            if (this.data[rowIndex]) {
                this.data[rowIndex][dataIndex] = newValue;
            }
        }

        cancelInlineEdit(originalContent) {
            if (!this.currentEditingCell) {
                return;
            }

            const { cell, isNewRow, rowIndex } = this.currentEditingCell;

            // Issue #807: If cancelling edit on a new row, remove the entire row
            if (isNewRow && this.pendingNewRow) {
                this.cancelNewRow(rowIndex);
                return;
            }

            // Remove required field highlighting (issue #779)
            this.clearRequiredCellHighlights(cell);

            // Restore original content
            // Note: Use typeof check instead of truthiness check because originalContent
            // can be an empty string '' when the cell was originally empty (issue #520).
            // Empty string is falsy in JavaScript, but we still want to restore it.
            if (typeof originalContent === 'string') {
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

            // Issue #1384: Remove fixed dropdown overlay from body if present
            if (this.currentEditingCell.fixedDropdown && this.currentEditingCell.fixedDropdown.parentNode) {
                this.currentEditingCell.fixedDropdown.parentNode.removeChild(this.currentEditingCell.fixedDropdown);
            }

            this.currentEditingCell = null;

            // Navigate to pending cell if set (issue #518)
            if (this.pendingCellClick) {
                const targetCell = this.pendingCellClick;
                this.pendingCellClick = null;
                this.navigateToCell(targetCell);
            }
        }

        /**
         * Cancel a new row that was being created (issue #807)
         * Removes the row from data arrays and re-renders the table
         * @param {number} rowIndex - Index of the new row to cancel
         */
        cancelNewRow(rowIndex) {
            // Remove the row from data arrays
            if (rowIndex !== undefined && rowIndex !== null) {
                this.data.splice(rowIndex, 1);
                this.rawObjectData.splice(rowIndex, 1);
                this.loadedRecords--;
            }

            // Clear the pending new row state
            this.pendingNewRow = null;

            // Clean up current editing cell
            if (this.currentEditingCell) {
                if (this.currentEditingCell.outsideClickHandler) {
                    document.removeEventListener('click', this.currentEditingCell.outsideClickHandler);
                }
                // Issue #1384: Remove fixed dropdown overlay from body if present
                if (this.currentEditingCell.fixedDropdown && this.currentEditingCell.fixedDropdown.parentNode) {
                    this.currentEditingCell.fixedDropdown.parentNode.removeChild(this.currentEditingCell.fixedDropdown);
                }
                this.currentEditingCell = null;
            }

            // Re-render the table
            this.render();

            this.showToast('Создание записи отменено', 'info');
        }

        /**
         * Find all editable cells in the table (issue #518)
         * Returns array of TD elements with data-editable="true"
         */
