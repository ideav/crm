        getDefaultFilterType(format) {
            const equalDefaultFormats = ['NUMBER', 'SIGNED', 'DATE', 'DATETIME', 'REF'];
            return equalDefaultFormats.includes(format) ? '=' : '^';
        }

        /**
         * Is this the first (main value) column of the table?
         * The first built column carries the record's own identity (id === metadata.id),
         * so it can be filtered by record ID like a reference column (issue #3542).
         */
        isFirstColumn(column) {
            return !!(column && Array.isArray(this.columns) && this.columns.length > 0 &&
                column.id === this.columns[0].id);
        }

        /**
         * Filter operators available for a column.
         * Base set comes from the column format; the first column of ANY type additionally
         * gets ID-based search (@ / !@), the same way reference columns do (issue #3542).
         * REF already includes @ / !@, so it is not augmented.
         */
        getColumnFilterTypes(column) {
            const format = column.format || 'SHORT';
            const baseTypes = this.filterTypes[format] || this.filterTypes['SHORT'];
            if (this.isFirstColumn(column) && format !== 'REF') {
                return baseTypes.concat([
                    { symbol: '@', name: 'по ID: включая', format: 'FR_{ T }=@{ X }' },
                    { symbol: '!@', name: 'по ID: исключая', format: 'FR_{ T }=!@{ X }' }
                ]);
            }
            return baseTypes;
        }

        /**
         * The kind of input renderFilterCell draws for a (format, type) pair.
         * Single source of truth shared by renderFilterCell and the re-render-on-
         * type-switch decision so the two cannot drift (issues #1008, #3542, #3777).
         * REF columns are handled separately (text input vs dropdown).
         * @returns {'date-picker'|'range'|'text'}
         */
        filterInputKind(format, type) {
            const datePickerTypes = ['=', '≥', '≤', '>', '<'];
            if ((format === 'DATE' || format === 'DATETIME') && datePickerTypes.includes(type)) {
                return 'date-picker';
            }
            if (type === '...') return 'range';
            return 'text';
        }

        applyFilter(params, column, filter) {
            const type = filter.type || '^';
            const value = filter.value;
            const colId = column.id;

            const format = column.format || 'SHORT';
            const filterGroup = this.getColumnFilterTypes(column);
            const filterDef = filterGroup.find(f => f.symbol === type);

            if (!filterDef) return;

            if (type === '@' || type === '!@') {
                // ID-based filter: user enters one or more IDs (digits, comma-separated) (issue #1819).
                // Available on reference columns and on the first column of any type (issue #3542).
                // Multiple IDs use the IN(...) form — the bare @(id,id) form is NOT understood by
                // the backend (verified on live: returns nothing for both REF and first columns) (issue #3542).
                const ids = value.split(',').map(v => v.trim()).filter(v => /^\d+$/.test(v));
                if (ids.length === 0) return;
                const formatted = ids.length === 1
                    ? `${type}${ids[0]}`
                    : `${type}IN(${ids.join(',')})`;
                params.append(`FR_${ colId }`, formatted);
            } else if (type === '...') {
                // Range: two separate values from/to (issue #3542). Either side may be empty
                // for an open-ended range — append only the bounds that were filled in.
                const values = value.split(',');
                const from = (values[0] || '').trim();
                const to = (values[1] || '').trim();
                if (from) params.append(`FR_${ colId }`, from);
                if (to) params.append(`TO_${ colId }`, to);
            } else if (type === '%' || type === '!%') {
                params.append(`FR_${ colId }`, type === '%' ? '%' : '!%');
            } else {
                let paramValue = filterDef.format.replace('{ T }', colId).replace('{ X }', value);
                // Remove FR_{colId} prefix (which may be followed by = or other operators like >, <, etc.)
                const prefix = 'FR_' + colId;
                if (paramValue.startsWith(prefix)) {
                    paramValue = paramValue.substring(prefix.length);
                    // Also remove leading = if present (for formats like FR_{T}={X})
                    if (paramValue.startsWith('=')) {
                        paramValue = paramValue.substring(1);
                    }
                }
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

