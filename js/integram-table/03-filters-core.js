        getDefaultFilterType(format) {
            const equalDefaultFormats = ['NUMBER', 'SIGNED', 'DATE', 'DATETIME', 'REF'];
            return equalDefaultFormats.includes(format) ? '=' : '^';
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

