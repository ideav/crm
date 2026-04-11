        renderCell(column, value, rowIndex, colIndex) {
            // Determine display format:
            // 1. For report data sources, column.format may already be a symbolic format like 'BOOLEAN'
            // 2. For object/table data sources, use normalizeFormat(column.type) to convert type ID
            // 3. Fall back to 'SHORT'
            const validFormats = ['SHORT', 'CHARS', 'DATE', 'NUMBER', 'SIGNED', 'BOOLEAN',
                                  'MEMO', 'DATETIME', 'FILE', 'HTML', 'BUTTON', 'PWD',
                                  'GRANT', 'REPORT_COLUMN', 'PATH'];
            const upperFormat = column.format ? String(column.format).toUpperCase() : '';
            const format = validFormats.includes(upperFormat) ? upperFormat :
                          (column.type ? this.normalizeFormat(column.type) : 'SHORT');
            let cellClass = '';
            let displayValue = value || '';
            let customStyle = '';
            let isEditable = this.editableColumns.has(column.id);
            let refValueId = null;  // Parsed reference ID from "id:Value" format

            // Determine data-type attributes for issue #375
            // data-type: base type in symbolic form (SHORT, NUMBER, DATE, DATETIME, BOOL, etc.)
            // data-ref: "1" for reference/lookup fields
            // data-array: "1" for multiselect/array fields
            const isRefField = column.ref_id != null || (column.ref && column.ref !== 0);
            const isArrayField = column.attrs && column.attrs.includes(':MULTI:');
            const dataTypeAttrs = ` data-type="${format}"${isRefField ? ' data-ref="1"' : ''}${isArrayField ? ' data-array="1"' : ''}`;

            // In object format, reference fields and GRANT/REPORT_COLUMN fields return values as "id:Value"
            // For multi-select fields, value is "id1,id2,...:val1,val2,..." (issue #863)
            // Parse to extract the id(s) and display only the Value part (issue #925)
            let multiRawValue = null;  // Original raw value for multi-select editor (issue #863)
            const isGrantOrReportColumn = format === 'GRANT' || format === 'REPORT_COLUMN';
            if ((isRefField || isGrantOrReportColumn) && value && typeof value === 'string') {
                const colonIndex = value.indexOf(':');
                if (colonIndex > 0) {
                    refValueId = value.substring(0, colonIndex);
                    displayValue = value.substring(colonIndex + 1);
                    // For multi-select fields, store raw value so editor can resolve IDs directly
                    if (isArrayField) {
                        multiRawValue = value;
                    }
                }
            }

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

            // Handle table requisites (subordinate tables) - display as link with table icon
            if (column.arr_id) {
                cellClass = 'subordinate-link-cell';
                const count = value !== null && value !== undefined && value !== '' ? value : 0;
                const instanceName = this.options.instanceName;
                // Get the record ID from rawObjectData for this row
                let recordId = null;
                if (this.rawObjectData && this.rawObjectData[rowIndex]) {
                    recordId = this.rawObjectData[rowIndex].i;
                }
                if (recordId) {
                    // Build URL for "Open in new window" link (issue #729, #733)
                    const pathParts = window.location.pathname.split('/');
                    const dbName = pathParts.length >= 2 ? pathParts[1] : '';
                    const subordinateTableUrl = `/${dbName}/table/${column.arr_id}?F_U=${recordId}`;
                    // Issue #733: Split into two links - table icon opens new window, count opens modal
                    displayValue = `<a href="${subordinateTableUrl}" class="subordinate-table-icon-link" target="${column.arr_id}" title="Открыть в новом окне" onclick="event.stopPropagation();"><i class="pi pi-table"></i></a><a href="#" class="subordinate-count-link" onclick="window.${ instanceName }.openSubordinateTableFromCell(event, ${ column.arr_id }, ${ recordId }); return false;" title="Посмотреть подчиненную таблицу">(${ count })</a>`;
                } else {
                    displayValue = `<span class="table-icon"><i class="pi pi-table"></i></span><span class="subordinate-count">(${ count })</span>`;
                }
                return `<td class="${ cellClass }" data-row="${ rowIndex }" data-col="${ colIndex }" data-source-type="${ this.getDataSourceType() }" data-arr-id="${ column.arr_id }"${ dataTypeAttrs }${ customStyle }>${ displayValue }</td>`;
            }

            switch (format) {
                case 'NUMBER':
                case 'SIGNED':
                    cellClass += ' number-cell';
                    break;
                case 'BOOLEAN':
                    cellClass += ' boolean-cell';
                    // Display as checkbox icon: any non-empty value = YES, empty = NO
                    // Don't return early - let code continue to editable logic
                    break;
                case 'DATE':
                    cellClass += ' date-cell';
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
                    cellClass += ' datetime-cell';
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
                    cellClass += ' memo-cell';
                    break;
                case 'PWD':
                    cellClass += ' pwd-cell';
                    // Only mask with asterisks if there's a value, show empty if empty
                    displayValue = (value !== null && value !== undefined && value !== '') ? '******' : '';
                    break;
                case 'FILE':
                    cellClass += ' file-cell';
                    if (value && value !== '') {
                        // Check if value is already an HTML anchor tag (from object/ endpoint)
                        if (typeof value === 'string' && value.trim().startsWith('<a')) {
                            // Value is already HTML link - add file-link class and render as-is
                            displayValue = value.replace('<a', '<a class="file-link"');
                            return `<td class="${ cellClass }" data-row="${ rowIndex }" data-col="${ colIndex }" data-source-type="${ this.getDataSourceType() }"${ dataTypeAttrs }${ customStyle }>${ displayValue }</td>`;
                        }
                        // Display as a download link if value is a path
                        const apiBase = this.getApiBase();
                        const fileName = value.split('/').pop() || value;
                        displayValue = `<a href="${ apiBase }/file/${ value }" target="_blank" class="file-link" title="Скачать файл">${ this.escapeHtml(fileName) }</a>`;
                        return `<td class="${ cellClass }" data-row="${ rowIndex }" data-col="${ colIndex }" data-source-type="${ this.getDataSourceType() }"${ dataTypeAttrs }${ customStyle }>${ displayValue }</td>`;
                    }
                    break;
                case 'HTML':
                    return `<td class="${ cellClass }" data-row="${ rowIndex }" data-col="${ colIndex }" data-source-type="${ this.getDataSourceType() }"${ dataTypeAttrs }${ customStyle }>${ displayValue }</td>`;
                case 'BUTTON': {
                    const pathParts = window.location.pathname.split('/');
                    const dbName = pathParts.length >= 2 ? pathParts[1] : '';
                    let recordId = null;
                    if (this.rawObjectData && this.rawObjectData[rowIndex]) {
                        recordId = this.rawObjectData[rowIndex].i;
                    }
                    const btnValue = value !== null && value !== undefined ? String(value) : '';
                    let btnHref, btnTarget;
                    if (btnValue.match(/^https?:\/\//i)) {
                        btnHref = btnValue;
                        btnTarget = recordId !== null ? String(recordId) : '_blank';
                    } else if (btnValue) {
                        btnHref = `/${dbName}/${btnValue.replace(/^\//, '')}`;
                        btnTarget = '_blank';
                    }
                    if (btnHref) {
                        displayValue = `<a href="${ btnHref }" target="${ btnTarget }" onclick="event.stopPropagation();"><button class="btn btn-sm btn-primary"><i class="pi pi-play"></i></button></a>`;
                    } else {
                        displayValue = `<button class="btn btn-sm btn-primary"><i class="pi pi-play"></i></button>`;
                    }
                    return `<td class="${ cellClass }" data-row="${ rowIndex }" data-col="${ colIndex }" data-source-type="${ this.getDataSourceType() }"${ dataTypeAttrs }${ customStyle } style="text-align: center;">${ displayValue }</td>`;
                }
            }

            let escapedValue;
            let fullValueForEditing;

            // BOOLEAN cells use HTML icons, so skip HTML escaping for them
            if (format === 'BOOLEAN') {
                const boolValue = value !== null && value !== undefined && value !== '' && value !== 0 && value !== '0' && value !== false;
                escapedValue = boolValue ? '<span class="boolean-check"><i class="pi pi-check"></i></span>' : '<span class="boolean-uncheck"><i class="pi pi-times"></i></span>';
                // Store the original value for editing (1 or 0, or the actual value)
                fullValueForEditing = boolValue ? '1' : '0';
            } else {
                escapedValue = String(displayValue).replace(/&/g, '&amp;')
                                                          .replace(/</g, '&lt;')
                                                          .replace(/>/g, '&gt;')
                                                          .replace(/"/g, '&quot;')
                                                          .replace(/'/g, '&#039;');
                // Store full value for editing before truncation
                // Fix for issue #684: Store RAW value, not escaped value
                // Browser's setAttribute() handles encoding automatically, and dataset.fullValue decodes it
                // Storing escaped value causes double-encoding when read back
                // For GRANT/REPORT_COLUMN fields, store the parsed ID so inline editor can pre-select correctly (issue #925)
                fullValueForEditing = (isGrantOrReportColumn && refValueId) ? refValueId : String(displayValue);
                // Issue #947: Convert URLs in text cells to clickable hyperlinks
                if (format === 'SHORT' || format === 'CHARS' || format === 'MEMO') {
                    // Issue #1077: Truncation must happen BEFORE linkification to avoid cutting HTML tags.
                    // Check length on plain escaped text; if too long, truncate the plain text first,
                    // then linkify both the truncated display portion and the full value for the modal.
                    if (this.settings.truncateLongValues && escapedValue.length > 127) {
                        const truncatedEscaped = escapedValue.substring(0, 127);
                        const fullLinkified = this.linkifyText(escapedValue);
                        const fullValueEscaped = fullLinkified
                            .replace(/\\/g, '\\\\')
                            .replace(/\n/g, '\\n')
                            .replace(/\r/g, '\\r')
                            .replace(/'/g, '\\\'');
                        const instanceName = this.options.instanceName;
                        escapedValue = `${ this.linkifyText(truncatedEscaped) }<a href="#" class="show-full-value" onclick="window.${ instanceName }.showFullValue(event, '${ fullValueEscaped }'); return false;">...</a>`;
                    } else {
                        escapedValue = this.linkifyText(escapedValue);
                    }
                }
            }

            // Truncate long values if setting is enabled (for non-linkified formats)
            if (this.settings.truncateLongValues && escapedValue.length > 127 && format !== 'SHORT' && format !== 'CHARS' && format !== 'MEMO') {
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

            // Track typeId computed in the edit icon block for use in editableAttrs
            // (needed so updateCellDisplay can add edit icon when an empty cell gets its first value)
            let editIconTypeId = '';

            // Add edit icon for editable cells (only when recordId exists - no create new)
            if (isEditable) {
                const idColId = this.editableColumns.get(column.id);
                let recordId = '';
                let typeId = '';

                // Check if this is in object format (has rawObjectData)
                // In object format, ALL columns use the record ID from rawObjectData
                const isInObjectFormat = this.rawObjectData.length > 0 && this.objectTableId;

                // TRACE: Log edit-icon decision process
                if (window.INTEGRAM_DEBUG) {
                    console.log(`[TRACE] Edit-icon decision for column ${column.id} (${column.name}), row ${rowIndex}:`);
                    console.log(`  - isEditable: ${isEditable}`);
                    console.log(`  - isInObjectFormat: ${isInObjectFormat}`);
                    console.log(`  - rawObjectData.length: ${this.rawObjectData.length}`);
                    console.log(`  - objectTableId: ${this.objectTableId}`);
                    console.log(`  - column.paramId: ${column.paramId}`);
                    console.log(`  - column.ref_id: ${column.ref_id}`);
                    console.log(`  - idColId: ${idColId}`);
                }

                if (isInObjectFormat) {
                    // For reference fields with parsed "id:Value", use the reference id
                    if (refValueId && column.ref_id != null) {
                        recordId = refValueId;
                        typeId = column.ref || column.orig || column.type || '';
                        if (window.INTEGRAM_DEBUG) {
                            console.log(`  - Using reference field: recordId=${recordId}, typeId=${typeId}`);
                        }
                    } else {
                        // For ALL columns in object format, use 'i' from rawObjectData
                        const rawItem = this.rawObjectData[rowIndex];
                        recordId = rawItem && rawItem.i ? String(rawItem.i) : '';
                        // For first column, use objectTableId; for requisites, use their orig or type
                        typeId = column.id === String(this.objectTableId) ? this.objectTableId : (column.orig || column.type || '');
                        if (window.INTEGRAM_DEBUG) {
                            console.log(`  - Using object format: recordId=${recordId}, typeId=${typeId}`);
                        }
                    }
                } else if (idColId !== null) {
                    // If we have an ID column reference, get the record ID from it
                    const idColIndex = this.columns.findIndex(c => c.id === idColId);
                    recordId = idColIndex !== -1 && this.data[rowIndex] ? this.data[rowIndex][idColIndex] : '';
                    typeId = column.orig || column.type || '';
                    if (window.INTEGRAM_DEBUG) {
                        console.log(`  - Using ID column reference: recordId=${recordId}, typeId=${typeId}`);
                    }
                } else {
                    // No ID column - need to determine parent ID using the logic from the issue
                    // A) If first column: look for column with type={column.type} and name ending in ID
                    // B) If requisite: look for column with type={parent object id} and name ending in ID
                    recordId = this.determineParentRecordId(column, rowIndex);
                    typeId = column.orig || column.type || '';
                    if (window.INTEGRAM_DEBUG) {
                        console.log(`  - Using determineParentRecordId: recordId=${recordId}, typeId=${typeId}`);
                    }
                }

                // Issue #708: If typeId is a base type (2-17), fall back to objectTableId or tableTypeId
                // Base types are primitives (string, number, date, etc.) that don't have editable metadata
                if (typeId && this.isBaseType(typeId)) {
                    const fallbackTypeId = this.objectTableId || this.options.tableTypeId || '';
                    if (window.INTEGRAM_DEBUG) {
                        console.log(`  - typeId ${typeId} is a base type, falling back to ${fallbackTypeId}`);
                    }
                    typeId = fallbackTypeId;
                }

                const instanceName = this.options.instanceName;
                // Only show edit icon if recordId exists (disable creating new records)
                // In object format: show edit icon ONLY for first column or reference fields
                // Don't show edit icon in empty cells - no point editing nothing
                const hasValue = value !== null && value !== undefined && value !== '';
                let shouldShowEditIcon = hasValue && recordId && recordId !== '' && recordId !== '0';

                // For table data source (data-source-type="table"), show edit icon when
                // data-col-type (paramId) matches window.id (objectTableId)
                const isTableDataSource = this.getDataSourceType() === 'table';
                const colTypeMatchesTableId = String(column.paramId) === String(this.objectTableId);

                if (window.INTEGRAM_DEBUG) {
                    console.log(`  - hasValue: ${hasValue} (value: ${JSON.stringify(value)})`);
                    console.log(`  - recordId: ${recordId}`);
                    console.log(`  - Initial shouldShowEditIcon: ${shouldShowEditIcon}`);
                    console.log(`  - isTableDataSource: ${isTableDataSource} (dataSourceType: ${this.getDataSourceType()})`);
                }

                // In report data source (NOT table), hide edit icon when no corresponding ID column exists
                if (shouldShowEditIcon && !isTableDataSource && this.getDataSourceType() === 'report' && idColId === null) {
                    shouldShowEditIcon = false;
                    if (window.INTEGRAM_DEBUG) {
                        console.log(`  - Report data source with no ID column -> shouldShowEditIcon: false`);
                    }
                }

                // Issue #854: Hide edit icon for multi-select reference fields (:MULTI: in attrs)
                if (shouldShowEditIcon && isArrayField) {
                    shouldShowEditIcon = false;
                    if (window.INTEGRAM_DEBUG) {
                        console.log(`  - Multi-select reference field (:MULTI: in attrs) -> shouldShowEditIcon: false`);
                    }
                }

                if (window.INTEGRAM_DEBUG) {
                    console.log(`  - colTypeMatchesTableId: ${colTypeMatchesTableId} (paramId: ${column.paramId}, objectTableId: ${this.objectTableId})`);
                }

                if (shouldShowEditIcon && isTableDataSource && colTypeMatchesTableId) {
                    // Table data source with matching col type - always show edit icon
                    // No further restrictions needed
                    if (window.INTEGRAM_DEBUG) {
                        console.log(`  - Table data source with matching col type -> keeping shouldShowEditIcon: true`);
                    }
                } else if (shouldShowEditIcon && isInObjectFormat) {
                    // For object format data, restrict edit icon to first column or reference fields
                    const isFirstColumn = column.id === String(this.objectTableId);
                    const isReferenceField = column.ref_id != null;
                    const prevValue = shouldShowEditIcon;
                    shouldShowEditIcon = isFirstColumn || isReferenceField;
                    if (window.INTEGRAM_DEBUG) {
                        console.log(`  - Object format restrictions: isFirstColumn=${isFirstColumn} (column.id=${column.id}), isReferenceField=${isReferenceField}`);
                        console.log(`  - shouldShowEditIcon: ${prevValue} -> ${shouldShowEditIcon}`);
                    }
                }

                if (window.INTEGRAM_DEBUG) {
                    console.log(`  - Final shouldShowEditIcon: ${shouldShowEditIcon}`);
                }

                // Store typeId so updateCellDisplay can add the edit icon
                // when an empty cell gets its first value (issue #915)
                if (recordId && recordId !== '' && recordId !== '0' && typeId) {
                    editIconTypeId = typeId;
                }

                if (shouldShowEditIcon) {
                    // Issue #1404: For reference fields with a known record ID, wrap value in hyperlink
                    let displayContent = escapedValue;
                    if (isRefField && refValueId && !isArrayField) {
                        const refTypeId = column.orig || column.ref_id || typeId;
                        if (refTypeId) {
                            const pathParts = window.location.pathname.split('/');
                            const dbName = pathParts.length >= 2 ? pathParts[1] : '';
                            const refUrl = `/${ dbName }/table/${ refTypeId }?F_I=${ refValueId }`;
                            displayContent = `<a href="${ refUrl }" class="ref-value-link" onclick="event.stopPropagation();">${ escapedValue }</a>`;
                        }
                    }
                    const editIcon = `<span class="edit-icon" onclick="window.${ instanceName }.openEditForm('${ recordId }', '${ typeId }', ${ rowIndex }); event.stopPropagation();" title="Редактировать"><i class="pi pi-pencil" style="font-size: 14px;"></i></span>`;
                    escapedValue = `<div class="cell-content-wrapper">${ displayContent }${ editIcon }</div>`;
                }
            }

            // Issue #1404: For reference fields without edit icon, still wrap value in a hyperlink
            // inside a cell-content-wrapper when the referenced record ID is available
            if (isRefField && refValueId && !isArrayField && !escapedValue.includes('cell-content-wrapper')) {
                const refTypeId = column.orig || column.ref_id;
                if (refTypeId) {
                    const pathParts = window.location.pathname.split('/');
                    const dbName = pathParts.length >= 2 ? pathParts[1] : '';
                    const refUrl = `/${ dbName }/table/${ refTypeId }?F_I=${ refValueId }`;
                    escapedValue = `<div class="cell-content-wrapper"><a href="${ refUrl }" class="ref-value-link" onclick="event.stopPropagation();">${ escapedValue }</a></div>`;
                }
            }

            // Add inline editing data attributes for editable cells (only when not already showing edit icon)
            let editableAttrs = '';
            if (isEditable && !customStyle.includes('edit-icon')) {
                const idColId = this.editableColumns.get(column.id);
                let recordId = '';

                // TRACE: Log the decision-making process for inline editing
                const isInObjectFormat = this.rawObjectData.length > 0 && this.objectTableId;
                if (window.INTEGRAM_DEBUG) {
                    console.log(`[TRACE] renderCell - Inline editing check for column ${column.id} (${column.name}), row ${rowIndex}:`);
                    console.log(`  - isEditable: ${isEditable}`);
                    console.log(`  - isInObjectFormat: ${isInObjectFormat}`);
                    console.log(`  - objectTableId: ${this.objectTableId}`);
                    console.log(`  - idColId (ID column reference): ${idColId}`);
                }

                // Check if this is in object format - ALL columns should use rawObjectData
                if (isInObjectFormat) {
                    // For ALL columns in object format, use 'i' from rawObjectData
                    const rawItem = this.rawObjectData[rowIndex];
                    recordId = rawItem && rawItem.i ? String(rawItem.i) : '';

                    // Issue #807: For new rows that are pending (_isNewRow=true),
                    // only the first column should be editable
                    if (rawItem && rawItem._isNewRow) {
                        const isFirstColumn = column.id === String(this.objectTableId || this.options.tableTypeId);
                        if (!isFirstColumn) {
                            // Non-first columns of new row are not editable until row is saved
                            if (window.INTEGRAM_DEBUG) {
                                console.log(`  - New row: non-first column ${column.id} not editable until row is saved`);
                            }
                            return `<td class="${ cellClass } new-row-cell-disabled" data-row="${ rowIndex }" data-col="${ colIndex }" data-source-type="${ this.getDataSourceType() }"${ dataTypeAttrs }${ customStyle }>${ escapedValue }</td>`;
                        }
                        // Issue #809: First column of new row has no record ID yet - use 'new' placeholder
                        // so canEdit evaluates to true and cell gets data-editable="true" attribute
                        recordId = 'new';
                    }

                    if (window.INTEGRAM_DEBUG) {
                        console.log(`  - Object format detected - using rawObjectData[${rowIndex}].i = ${recordId}`);
                    }
                } else if (idColId !== null) {
                    // If we have an ID column reference, get the record ID from it
                    const idColIndex = this.columns.findIndex(c => c.id === idColId);
                    recordId = idColIndex !== -1 && this.data[rowIndex] ? this.data[rowIndex][idColIndex] : '';
                    if (window.INTEGRAM_DEBUG) {
                        console.log(`  - Using ID column reference: recordId = ${recordId}`);
                    }
                } else {
                    // No ID column - need to determine parent ID using the logic from the issue
                    recordId = this.determineParentRecordId(column, rowIndex);
                    if (window.INTEGRAM_DEBUG) {
                        console.log(`  - Using determineParentRecordId: recordId = ${recordId}`);
                    }
                }

                // For reference fields, we allow editing even with empty values as long as we can determine parent record
                // For non-reference fields, we still require a valid recordId
                // In object format, check for ref_id existence; in report format, check ref === 1
                const isRefField = column.ref_id != null || column.ref === 1;
                const canEdit = isRefField ? true : (recordId && recordId !== '' && recordId !== '0');

                if (window.INTEGRAM_DEBUG) {
                    console.log(`  - isRefField: ${isRefField}`);
                    console.log(`  - canEdit: ${canEdit} (recordId=${recordId})`);
                }

                if (canEdit) {
                    // Add ref attribute if this is a reference field
                    const refAttr = isRefField ? ` data-col-ref="1"` : '';
                    // Store parsed reference value ID from "id:Value" format
                    const refValueIdAttr = refValueId ? ` data-ref-value-id="${ refValueId }"` : '';
                    // Store full value for editing (escape for HTML attribute)
                    const fullValueAttr = fullValueForEditing ? ` data-full-value="${ fullValueForEditing.replace(/"/g, '&quot;') }"` : '';
                    // Issue #863: For multi-select fields, store raw "ids:values" string so editor can resolve IDs directly
                    const rawValueAttr = multiRawValue ? ` data-raw-value="${ multiRawValue.replace(/"/g, '&quot;') }"` : '';
                    // Use 'dynamic' as placeholder for recordId if it's empty (will be determined at edit time)
                    const recordIdAttr = recordId && recordId !== '' && recordId !== '0' ? recordId : 'dynamic';
                    // Use paramId for object format (metadata ID), otherwise fall back to type (data type)
                    const colTypeForParam = column.paramId || column.type;
                    // Issue #915: Store typeId for edit icon so updateCellDisplay can add it
                    // when an empty cell gets its first value filled in
                    const editTypeIdAttr = editIconTypeId ? ` data-edit-type-id="${ editIconTypeId }"` : '';
                    editableAttrs = ` data-editable="true" data-record-id="${ recordIdAttr }" data-col-id="${ column.id }" data-col-type="${ colTypeForParam }" data-col-format="${ format }" data-row-index="${ rowIndex }"${ refAttr }${ refValueIdAttr }${ fullValueAttr }${ rawValueAttr }${ editTypeIdAttr }`;
                    cellClass += ' inline-editable';
                    if (window.INTEGRAM_DEBUG) {
                        console.log(`  ✓ Cell will be editable with recordId=${recordIdAttr}`);
                    }
                } else {
                    if (window.INTEGRAM_DEBUG) {
                        console.log(`  ✗ Cell will NOT be editable - canEdit=${canEdit}, recordId=${recordId}`);
                    }
                }
            }

            return `<td class="${ cellClass }" data-row="${ rowIndex }" data-col="${ colIndex }" data-source-type="${ this.getDataSourceType() }"${ dataTypeAttrs }${ customStyle }${ editableAttrs }>${ escapedValue }</td>`;
        }

        /**
         * Render grouped table rows (issue #502)
         * Creates rows with merged group cells on the left side
         *
         * Issue #531: Group cells use a blue left border (via CSS .group-cell class)
         * to visually distinguish grouping columns from regular data columns
         * (which have gray borders). This helps users understand the table structure.
         */
        renderGroupedRows(orderedColumns, instanceName) {
            if (!this.groupedData || this.groupedData.length === 0) {
                return '';
            }

            // Get the set of grouping column IDs for quick lookup
            const groupingColumnSet = new Set(this.groupingColumns);

            // Determine columns that are NOT grouping columns (shown on the right)
            const nonGroupingColumns = orderedColumns.filter(col => !groupingColumnSet.has(col.id));

            // Build rows HTML
            let rowsHtml = '';

            this.groupedData.forEach((rowInfo, rowIndex) => {
                const row = rowInfo.data;
                const selectedClass = this.selectedRows.has(rowInfo.originalIndex) ? 'row-selected' : '';

                rowsHtml += `<tr class="${ selectedClass }">`;

                // Add checkbox column if enabled
                if (this.checkboxMode) {
                    rowsHtml += `<td class="checkbox-column-cell"><input type="checkbox" class="row-select-checkbox" data-row-index="${ rowInfo.originalIndex }" ${ this.selectedRows.has(rowInfo.originalIndex) ? 'checked' : '' }></td>`;
                }

                // Render group cells (with rowspan if this row starts a new group)
                if (rowInfo.groupCells.length > 0) {
                    // This row has group cells to render (starts new groups)
                    rowInfo.groupCells.forEach((groupCell, groupCellIndex) => {
                        const column = this.columns.find(c => c.id === groupCell.colId);
                        // Issue #504: Use displayValue (parsed from "id:Value") if available, otherwise parse raw value
                        const cellValue = groupCell.displayValue !== undefined
                            ? groupCell.displayValue
                            : this.parseReferenceDisplayValue(groupCell.value, column);
                        const rowspan = groupCell.rowspan > 1 ? ` rowspan="${ groupCell.rowspan }"` : '';

                        // Issue #543: Add create button for grouped cells when data source is object/table
                        // Get the level of this grouped cell (0-based index in groupingColumns)
                        const groupLevel = this.groupingColumns.indexOf(groupCell.colId);
                        const showAddButton = this.shouldShowGroupedCellAddButton();
                        const addButtonHtml = showAddButton
                            ? `<button class="group-cell-add-btn" onclick="window.${ instanceName }.openGroupedCellCreateForm(${ rowIndex }, ${ groupLevel })" title="Создать запись"><i class="pi pi-plus"></i></button>`
                            : '';

                        // Render the group cell with special styling
                        rowsHtml += `<td class="group-cell"${ rowspan } data-group-column="${ groupCell.colId }">`;
                        rowsHtml += `<span class="group-cell-content">${ this.escapeHtml(String(cellValue || '')) }</span>`;
                        rowsHtml += addButtonHtml;
                        rowsHtml += `</td>`;
                    });
                }
                // If no groupCells, it means this row is part of an existing group
                // and the cells are already rendered with rowspan in a previous row

                // Render non-grouping columns (all other data columns)
                nonGroupingColumns.forEach((col, colIndex) => {
                    const dataIndex = this.columns.indexOf(col);
                    const cellValue = row[dataIndex];
                    rowsHtml += this.renderCell(col, cellValue, rowInfo.originalIndex, colIndex);
                });

                rowsHtml += `</tr>`;
            });

            return rowsHtml;
        }

        /**
         * Render table headers in grouped mode (issue #502)
         * Shows grouping columns first, then non-grouping columns
         */
        renderGroupedHeaders(orderedColumns, instanceName) {
            const groupingColumnSet = new Set(this.groupingColumns);

            // Get grouping columns in their specified order
            const groupingCols = this.groupingColumns
                .map(colId => this.columns.find(c => c.id === colId))
                .filter(col => col && this.visibleColumns.includes(col.id));

            // Get non-grouping columns
            const nonGroupingCols = orderedColumns.filter(col => !groupingColumnSet.has(col.id));

            // Combine: grouping columns first, then non-grouping
            const allCols = [...groupingCols, ...nonGroupingCols];

            return allCols.map(col => {
                const width = this.columnWidths[col.id];
                const widthStyle = width ? ` style="width: ${ width }px; min-width: ${ width }px;"` : '';
                const addButtonHtml = this.shouldShowAddButton(col) ?
                    `<button class="column-add-btn" onclick="window.${ instanceName }.openColumnCreateForm('${ col.id }')" title="Создать запись"><i class="pi pi-plus"></i></button>` : '';

                // Add sort indicator if this column is sorted
                let sortIndicator = '';
                if (this.sortColumn === col.id) {
                    sortIndicator = this.sortDirection === 'asc' ? '<i class="pi pi-sort-amount-up-alt" style="font-size:0.75em;"></i> ' : '<i class="pi pi-sort-amount-down" style="font-size:0.75em;"></i> ';
                }

                // Add grouping indicator
                const isGroupingCol = groupingColumnSet.has(col.id);
                const groupingClass = isGroupingCol ? ' group-header' : '';
                const groupingOrder = isGroupingCol ? this.groupingColumns.indexOf(col.id) + 1 : '';
                const groupingBadge = isGroupingCol ? `<span class="grouping-header-badge">${ groupingOrder }</span>` : '';

                return `
                    <th data-column-id="${ col.id }" draggable="true"${ widthStyle } class="${ groupingClass }">
                        <span class="column-header-content" data-column-id="${ col.id }">${ groupingBadge }${ sortIndicator }${ col.name }</span>
                        ${ addButtonHtml }
                        <div class="column-resize-handle" data-column-id="${ col.id }"></div>
                    </th>
                `;
            }).join('');
        }

        /**
         * Render filter row in grouped mode (issue #502)
         * Shows grouping column filters first, then non-grouping column filters
         */
        renderGroupedFilterRow(orderedColumns) {
            const groupingColumnSet = new Set(this.groupingColumns);

            // Get grouping columns in their specified order
            const groupingCols = this.groupingColumns
                .map(colId => this.columns.find(c => c.id === colId))
                .filter(col => col && this.visibleColumns.includes(col.id));

            // Get non-grouping columns
            const nonGroupingCols = orderedColumns.filter(col => !groupingColumnSet.has(col.id));

            // Combine: grouping columns first, then non-grouping
            const allCols = [...groupingCols, ...nonGroupingCols];

            return allCols.map((col, idx) => this.renderFilterCell(col, idx)).join('');
        }

        renderScrollCounter() {
            const instanceName = this.options.instanceName;
            const totalDisplay = this.totalRows === null
                ? `<span class="total-count-unknown" onclick="window.${ instanceName }.fetchTotalCount()" title="Нажмите, чтобы узнать общее количество">?</span>`
                : this.totalRows;

            // Show add row button only for object-source tables (issue #807)
            const isObjectSource = this.objectTableId || this.getDataSourceType() === 'table';
            const addRowBtnHtml = isObjectSource
                ? `<button class="add-row-btn" onclick="window.${ instanceName }.addNewRow()" title="Добавить строку в таблицу"><i class="pi pi-plus"></i></button>`
                : '';

            return `
                <div class="scroll-counter">
                    ${ addRowBtnHtml }
                    Показано ${ this.loadedRecords } из ${ totalDisplay }
                </div>
            `;
        }

        /**
         * Add a new empty row at the bottom of the table (issue #807)
         * The row starts in edit mode with only the first column editable.
         * After the first column is saved, all other cells become editable.
         */
