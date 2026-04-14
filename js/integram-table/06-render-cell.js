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
            // Issue #1794: "link to any record" type — orig === "1" with no ref_id and no ref
            const isAnyRecordLink = column.orig === '1' && column.ref_id == null && !column.ref;
            const isArrayField = column.attrs && column.attrs.includes(':MULTI:');
            const dataTypeAttrs = ` data-type="${format}"${isRefField ? ' data-ref="1"' : ''}${isAnyRecordLink ? ' data-any-ref="1"' : ''}${isArrayField ? ' data-array="1"' : ''}`;

            // In object format, reference fields and GRANT/REPORT_COLUMN fields return values as "id:Value"
            // For multi-select fields, value is "id1,id2,...:val1,val2,..." (issue #863)
            // Parse to extract the id(s) and display only the Value part (issue #925)
            // Issue #1794: also parse "id:Value" for "any record" link type
            let multiRawValue = null;  // Original raw value for multi-select editor (issue #863)
            const isGrantOrReportColumn = format === 'GRANT' || format === 'REPORT_COLUMN';
            if ((isRefField || isAnyRecordLink || isGrantOrReportColumn) && value && typeof value === 'string') {
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
                    let btnHref, btnTarget, btnOnclick;
                    if (btnValue.match(/^https?:\/\//i)) {
                        btnHref = btnValue;
                        btnTarget = recordId !== null ? String(recordId) : '_blank';
                    } else if (btnValue.match(/^\w[\w.]*\s*\([\s\S]*\)\s*;?\s*$/)) {
                        // Value is a JS function call (e.g. newApi('POST','...','','reloadAllIntegramTables'))
                        btnOnclick = btnValue.replace(/;?\s*$/, '') + '; event.stopPropagation();';
                    } else if (btnValue) {
                        btnHref = `/${dbName}/${btnValue.replace(/^\//, '')}`;
                        btnTarget = '_blank';
                    }
                    if (btnOnclick) {
                        displayValue = `<button class="btn btn-sm btn-primary" onclick="${ btnOnclick.replace(/"/g, '&quot;') }"><i class="pi pi-play"></i></button>`;
                    } else if (btnHref) {
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
                    // Issue #1794: For "any record" link type, also wrap in lazy-resolved hyperlink
                    let displayContent = escapedValue;
                    if (isRefField && refValueId && !isArrayField) {
                        const refTypeId = column.orig || column.ref_id || typeId;
                        if (refTypeId) {
                            const pathParts = window.location.pathname.split('/');
                            const dbName = pathParts.length >= 2 ? pathParts[1] : '';
                            const refUrl = `/${ dbName }/table/${ refTypeId }?F_I=${ refValueId }`;
                            displayContent = `<a href="${ refUrl }" class="ref-value-link" onclick="event.stopPropagation();">${ escapedValue }</a>`;
                        }
                    } else if (isAnyRecordLink && refValueId) {
                        displayContent = `<a href="#" class="any-record-link" data-record-id="${ refValueId }" onmouseover="window.${ instanceName }.resolveAnyRecordLink(this, '${ refValueId }');" onclick="window.${ instanceName }.navigateAnyRecordLink(event, this, '${ refValueId }'); return false;">${ escapedValue }</a>`;
                    }
                    const editIcon = `<span class="edit-icon" onclick="window.${ instanceName }.openEditForm('${ recordId }', '${ typeId }', ${ rowIndex }); event.stopPropagation();" title="Редактировать"><i class="pi pi-pencil" style="font-size: 0.875rem;"></i></span>`;
                    escapedValue = `<div class="cell-content-wrapper"><span title="${ recordId }">${ displayContent }</span>${ editIcon }</div>`;
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
                    escapedValue = `<div class="cell-content-wrapper"><span title="${ refValueId }"><a href="${ refUrl }" class="ref-value-link" onclick="event.stopPropagation();">${ escapedValue }</a></span></div>`;
                }
            }

            // Issue #1794: For "link to any record" type (orig === "1"), render as a lazy-resolved link.
            // The target table type is unknown at render time; it is fetched via get_record/{id} on hover.
            if (isAnyRecordLink && refValueId && !escapedValue.includes('cell-content-wrapper')) {
                const instanceName = this.options.instanceName;
                escapedValue = `<div class="cell-content-wrapper"><span title="${ refValueId }"><a href="#" class="any-record-link" data-record-id="${ refValueId }" onmouseover="window.${ instanceName }.resolveAnyRecordLink(this, '${ refValueId }');" onclick="window.${ instanceName }.navigateAnyRecordLink(event, this, '${ refValueId }'); return false;">${ escapedValue }</a></span></div>`;
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
         * Smart header grouping (issue #1540, #1565)
         * Find the longest common whole-word prefix of two column name strings.
         * Words are separated by dots (".").
         */
        _smartHeaderLCP(a, b) {
            const wa = a.split('.');
            const wb = b.split('.');
            let n = 0;
            for (let i = 0; i < Math.min(wa.length, wb.length); i++) {
                if (wa[i] === wb[i]) n = i + 1;
                else break;
            }
            return wa.slice(0, n).join('.');
        }

        /**
         * Build smart header grouping tree from an ordered list of columns.
         *
         * Column names use dots (".") as word separators for grouping (issue #1565).
         *
         * A group [start..end) with prefix P is valid only if:
         *   - ≥2 consecutive columns all start with P+"." (non-empty suffix)
         *   - The column before start (if any) does NOT start with P+"."
         *   - The column after end (if any) does NOT start with P+"."
         *   - The group is NOT universal (does not span ALL columns at this level)
         *
         * Finds the SHORTEST non-universal prefix first (top-down approach so that
         * broader groupings like "foo.bar" contain narrower ones like "foo.bar.baz").
         *
         * Returns array of nodes:
         *   { type:'leaf', col, suffix }
         *   { type:'group', prefix, span, children }
         */
        buildSmartHeaderTree(columns) {
            if (columns.length === 0) return [];
            if (columns.length === 1) {
                return [{ type: 'leaf', col: columns[0], suffix: columns[0].name }];
            }

            // Compute pair-prefix for each adjacent pair
            const pairPrefixes = [];
            for (let i = 0; i < columns.length - 1; i++) {
                const prefix = this._smartHeaderLCP(columns[i].name, columns[i + 1].name);
                const len = prefix.split('.').filter(Boolean).length;
                pairPrefixes.push({ i, prefix, len });
            }

            // Sort ascending by length to find the SHORTEST non-universal prefix
            const sorted = [...pairPrefixes].sort((a, b) => a.len - b.len || a.i - b.i);

            let targetLen = -1;
            for (const pair of sorted) {
                if (pair.len === 0) continue;
                const prefix = pair.prefix;
                // Find the full extent of this prefix among consecutive columns
                let start = pair.i;
                while (start > 0 && columns[start - 1].name !== prefix &&
                       columns[start - 1].name.startsWith(prefix + '.')) start--;
                let end = pair.i + 1;
                while (end < columns.length && columns[end].name !== prefix &&
                       columns[end].name.startsWith(prefix + '.')) end++;
                // Skip if universal (spans ALL columns at this level)
                if (start === 0 && end === columns.length) continue;
                targetLen = pair.len;
                break;
            }

            if (targetLen === -1) {
                // No valid non-universal group — all leaves
                return columns.map(col => ({ type: 'leaf', col, suffix: col.name }));
            }

            // Build result: form all groups at targetLen, leaves elsewhere
            const result = [];
            let i = 0;
            while (i < columns.length) {
                let grouped = false;
                if (i + 1 < columns.length) {
                    const pairPrefix = this._smartHeaderLCP(columns[i].name, columns[i + 1].name);
                    const pairLen = pairPrefix.split('.').filter(Boolean).length;
                    if (pairLen >= targetLen) {
                        const prefix = columns[i].name.split('.').slice(0, targetLen).join('.');
                        if (columns[i].name.startsWith(prefix + '.') && columns[i].name !== prefix) {
                            const leftOk = i === 0 || !columns[i - 1].name.startsWith(prefix + '.');
                            if (leftOk) {
                                let end = i + 1;
                                while (end < columns.length && columns[end].name !== prefix &&
                                       columns[end].name.startsWith(prefix + '.')) end++;
                                const rightOk = end >= columns.length || !columns[end].name.startsWith(prefix + '.');
                                if (rightOk && end - i >= 2) {
                                    const groupCols = columns.slice(i, end);
                                    const suffixCols = groupCols.map(col => ({
                                        ...col, name: col.name.slice(prefix.length + 1)
                                    }));
                                    result.push({
                                        type: 'group',
                                        prefix,
                                        span: end - i,
                                        children: this.buildSmartHeaderTree(suffixCols)
                                    });
                                    i = end;
                                    grouped = true;
                                }
                            }
                        }
                    }
                }
                if (!grouped) {
                    result.push({ type: 'leaf', col: columns[i], suffix: columns[i].name });
                    i++;
                }
            }
            return result;
        }

        /**
         * Compute the depth (number of header rows) of a smart header tree.
         */
        smartHeaderTreeDepth(nodes) {
            return nodes.reduce((max, n) =>
                Math.max(max, n.type === 'group' ? 1 + this.smartHeaderTreeDepth(n.children) : 1), 0);
        }

        /**
         * Render the smart header tree into an array of row HTML strings.
         * Returns an array of length totalDepth, each element is the inner HTML
         * of one <tr> (excluding the tr tags themselves).
         *
         * Each leaf <th> has data-column-id, draggable, width style, sort indicator,
         * add button, and resize handle — the full decoration needed for interaction.
         *
         * Group <th> cells show only the shared prefix text (truncated via CSS).
         */
        renderSmartHeaderRows(nodes, totalDepth, depth, instanceName, groupingColumnSet) {
            // rows[i] = array of <th> HTML strings for header row i
            const rows = Array.from({ length: totalDepth }, () => []);

            const visit = (nodes, depth) => {
                for (const node of nodes) {
                    if (node.type === 'leaf') {
                        const col = node.col;
                        const rowspan = totalDepth - depth;
                        const width = this.columnWidths[col.id];
                        const widthStyle = width ? ` style="width: ${ width }px; min-width: ${ width }px;"` : '';
                        const addButtonHtml = this.shouldShowAddButton(col) ?
                            `<button class="column-add-btn" onclick="window.${ instanceName }.openColumnCreateForm('${ col.id }')" title="Создать запись"><i class="pi pi-plus"></i></button>` : '';
                        let sortIndicator = '';
                        if (this.sortColumn === col.id) {
                            sortIndicator = this.sortDirection === 'asc'
                                ? '<i class="pi pi-sort-amount-up-alt" style="font-size:0.75em;"></i> '
                                : '<i class="pi pi-sort-amount-down" style="font-size:0.75em;"></i> ';
                        }
                        // Display name with dots replaced by spaces (issue #1565)
                        const displayName = col.name.replace(/\./g, ' ');
                        // In left-grouping mode, add grouping styles to grouping column headers (issue #1624)
                        const isGroupingCol = groupingColumnSet && groupingColumnSet.has(col.id);
                        const groupingClass = isGroupingCol ? ' group-header' : '';
                        const groupingOrder = isGroupingCol ? this.groupingColumns.indexOf(col.id) + 1 : '';
                        const groupingBadge = isGroupingCol ? `<span class="grouping-header-badge">${ groupingOrder }</span>` : '';
                        const refTypeId = col.ref_id;
                        const refIconHtml = refTypeId ? (() => {
                            const dbName = window.db || window.location.pathname.split('/')[1];
                            return `<a class="column-ref-link" href="/${dbName}/table/${refTypeId}" target="_blank" title="Открыть справочник в новой вкладке" onclick="event.stopPropagation()"><i class="pi pi-external-link"></i></a>`;
                        })() : '';
                        rows[depth].push(`
                            <th data-column-id="${ col.id }" draggable="true"${ widthStyle }${ rowspan > 1 ? ` rowspan="${ rowspan }"` : '' } class="${ groupingClass }">
                                <span class="column-header-content" data-column-id="${ col.id }" title="${ col.id }" style="${ this.settings.wrapHeaders ? 'white-space: normal;' : '' }">${ groupingBadge }${ sortIndicator }${ displayName }</span>
                                ${ refIconHtml }
                                ${ addButtonHtml }
                                <div class="column-resize-handle" data-column-id="${ col.id }"></div>
                            </th>
                        `);
                    } else {
                        // Display prefix with dots replaced by spaces (issue #1565)
                        const displayPrefix = node.prefix.replace(/\./g, ' ');
                        rows[depth].push(`
                            <th class="smart-header-group" colspan="${ node.span }" style="${ this.settings.wrapHeaders ? 'white-space: normal;' : '' }">${ displayPrefix }</th>
                        `);
                        visit(node.children, depth + 1);
                    }
                }
            };

            visit(nodes, depth || 0);
            return rows;
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

                const refTypeId = col.ref_id;
                const refIconHtml = refTypeId ? (() => {
                    const dbName = window.db || window.location.pathname.split('/')[1];
                    return `<a class="column-ref-link" href="/${dbName}/table/${refTypeId}" target="_blank" title="Открыть справочник в новой вкладке" onclick="event.stopPropagation()"><i class="pi pi-external-link"></i></a>`;
                })() : '';

                return `
                    <th data-column-id="${ col.id }" draggable="true"${ widthStyle } class="${ groupingClass }">
                        <span class="column-header-content" data-column-id="${ col.id }" title="${ col.id }" style="${ this.settings.wrapHeaders ? 'white-space: normal;' : '' }">${ groupingBadge }${ sortIndicator }${ col.name }</span>
                        ${ refIconHtml }
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

            // Show add row button only for object-source tables with write access (issue #807, #1508)
            const isObjectSource = this.objectTableId || this.getDataSourceType() === 'table';
            const canWrite = isObjectSource && this.isTableWritable();
            const addRowBtnHtml = canWrite
                ? `<button class="add-row-btn" onclick="window.${ instanceName }.addNewRow()" title="Добавить строку в таблицу"><i class="pi pi-plus"></i></button>`
                : '';
            // Show paste-data icon button next to add-row button for writable tables (issue #1606)
            const pasteDataBtnHtml = canWrite
                ? `<button class="paste-data-btn" onclick="window.${ instanceName }.openPasteDataDialog()" title="Вставить данные из буфера"><i class="pi pi-clipboard"></i></button>`
                : '';

            return `
                <div class="scroll-counter">
                    ${ addRowBtnHtml }${ pasteDataBtnHtml }
                    Показано ${ this.loadedRecords } из ${ totalDisplay }
                </div>
            `;
        }

        /**
         * Open a dialog to paste data from clipboard and insert into the table (issue #1606).
         * Splits the pasted text by lines, then splits each line by TAB, ";" or ","
         * and calls _m_new for each line using visible column IDs as field keys.
         */
        openPasteDataDialog() {
            const instanceName = this.options.instanceName;
            const modalDepth = (window._integramModalDepth || 0) + 1;
            window._integramModalDepth = modalDepth;
            const baseZIndex = 1000 + (modalDepth * 10);
            const cascadeOffset = (modalDepth - 1) * 20;

            const overlay = document.createElement('div');
            overlay.className = 'edit-form-overlay';
            overlay.style.zIndex = baseZIndex;

            const modal = document.createElement('div');
            modal.className = 'edit-form-modal';
            modal.style.zIndex = baseZIndex + 1;
            modal.style.transform = `translate(calc(-50% + ${cascadeOffset}px), calc(-50% + ${cascadeOffset}px))`;
            modal._overlayElement = overlay;

            modal.innerHTML = `
                <div class="edit-form-header">
                    <span class="edit-form-title" style="font-weight:500;">Вставить данные из буфера</span>
                    <button class="edit-form-close" data-close-modal-ref="true"><i class="pi pi-times"></i></button>
                </div>
                <div class="edit-form-body">
                    <textarea id="paste-data-textarea" rows="10" style="width:100%;box-sizing:border-box;resize:vertical;font-family:inherit;"
                        placeholder="Вставьте данные, и я постараюсь распознать и вставить их в таблицу"></textarea>
                    <div style="margin-top:6px;color:#888;font-size:0.9em;">Текст, разделённый символами табуляции, «;» или «,»</div>
                    <div id="paste-data-progress" style="margin-top:8px;display:none;"></div>
                </div>
                <div class="edit-form-footer">
                    <label style="display:flex;align-items:center;gap:6px;cursor:pointer;user-select:none;">
                        <input type="checkbox" id="paste-data-create-refs" title="Если значения не будут найдены в справочнике, то я создам их на лету">
                        <span>Создавать справочные значения</span>
                    </label>
                    <div class="edit-form-footer-buttons">
                        <button type="button" class="btn btn-preview" id="paste-data-preview-btn">Просмотр</button>
                        <button type="button" class="btn btn-primary" id="paste-data-insert-btn">Вставить</button>
                        <button type="button" class="btn btn-secondary" id="paste-data-cancel-btn">Отменить</button>
                    </div>
                </div>
            `;

            document.body.appendChild(overlay);
            document.body.appendChild(modal);

            const closeModal = () => {
                modal.remove();
                overlay.remove();
                window._integramModalDepth = Math.max(0, (window._integramModalDepth || 1) - 1);
            };

            modal.querySelector('.edit-form-close').addEventListener('click', closeModal);
            modal.querySelector('#paste-data-cancel-btn').addEventListener('click', closeModal);
            overlay.addEventListener('click', closeModal);

            modal.querySelector('#paste-data-insert-btn').addEventListener('click', () => {
                window[instanceName].insertPastedData(modal, closeModal);
            });

            modal.querySelector('#paste-data-preview-btn').addEventListener('click', () => {
                window[instanceName].previewPastedData(modal, closeModal);
            });

            // Focus textarea
            setTimeout(() => modal.querySelector('#paste-data-textarea').focus(), 50);
        }

        /**
         * Show a preview table of the data parsed from the paste-data textarea (issue #1684).
         * Opens a new modal with an editable table showing the rows to be inserted.
         * The preview has "Загрузить" (Load) and "Отменить" (Cancel) buttons.
         */
        previewPastedData(pasteModal, closePasteModal) {
            const textarea = pasteModal.querySelector('#paste-data-textarea');
            const text = textarea.value;

            if (!text || !text.trim()) {
                this.showToast('Поле ввода пустое', 'error');
                return;
            }

            // Split into lines, skip empty lines
            const lines = text.split(/\r?\n/).filter(line => line.trim() !== '');
            if (lines.length === 0) {
                this.showToast('Нет данных для просмотра', 'error');
                return;
            }

            // Detect delimiter (same logic as insertPastedData)
            const countChar = (str, ch) => {
                let count = 0;
                for (let i = 0; i < str.length; i++) {
                    if (str[i] === ch && (i === 0 || str[i - 1] !== '\\')) {
                        count++;
                    }
                }
                return count;
            };
            const isConsistentDelimiter = (delim) => {
                const counts = lines.map(l => countChar(l, delim));
                return counts[0] > 0 && counts.every(c => c === counts[0]);
            };
            let delimiter = '\t';
            if (isConsistentDelimiter('\t')) {
                delimiter = '\t';
            } else if (isConsistentDelimiter(';')) {
                delimiter = ';';
            } else if (isConsistentDelimiter(',')) {
                delimiter = ',';
            }

            // Parse rows
            const parsedRows = lines.map(line => line.split(delimiter));

            // Get ordered visible non-id columns for header
            const columnMap = {};
            this.columns.forEach(col => { columnMap[col.id] = col; });
            const orderedColIds = (this.columnOrder || this.columns.map(c => c.id))
                .filter(id => columnMap[id] && !this.idColumns.has(id));
            const colHeaders = orderedColIds.map(id => (columnMap[id] && columnMap[id].name) || id);

            // Build the preview modal
            const instanceName = this.options.instanceName;
            const modalDepth = (window._integramModalDepth || 0) + 1;
            window._integramModalDepth = modalDepth;
            const baseZIndex = 1000 + (modalDepth * 10);
            const cascadeOffset = (modalDepth - 1) * 20;

            const previewOverlay = document.createElement('div');
            previewOverlay.className = 'edit-form-overlay';
            previewOverlay.style.zIndex = baseZIndex;

            const previewModal = document.createElement('div');
            previewModal.className = 'edit-form-modal paste-data-preview-modal';
            previewModal.style.zIndex = baseZIndex + 1;
            previewModal.style.transform = `translate(calc(-50% + ${cascadeOffset}px), calc(-50% + ${cascadeOffset}px))`;
            previewModal._overlayElement = previewOverlay;

            // Build table HTML with editable cells
            const theadCols = colHeaders.map(h => `<th>${h}</th>`).join('');
            const tbodyRows = parsedRows.map((row, rowIdx) => {
                const cells = orderedColIds.map((colId, colIdx) => {
                    const val = row[colIdx] !== undefined ? row[colIdx] : '';
                    return `<td><input class="paste-preview-cell" data-row="${rowIdx}" data-col="${colIdx}" value="${val.replace(/"/g, '&quot;')}"></td>`;
                });
                return `<tr>${cells.join('')}</tr>`;
            }).join('');

            previewModal.innerHTML = `
                <div class="edit-form-header">
                    <span class="edit-form-title" style="font-weight:500;">Просмотр данных для вставки (${parsedRows.length} строк)</span>
                    <button class="edit-form-close" data-close-preview-ref="true"><i class="pi pi-times"></i></button>
                </div>
                <div class="edit-form-body paste-data-preview-body">
                    <div class="paste-data-preview-table-wrap">
                        <table class="paste-data-preview-table">
                            <thead><tr>${theadCols}</tr></thead>
                            <tbody>${tbodyRows}</tbody>
                        </table>
                    </div>
                </div>
                <div class="edit-form-footer">
                    <div style="color:#888;font-size:0.85em;">Вы можете отредактировать ячейки перед загрузкой</div>
                    <div class="edit-form-footer-buttons">
                        <button type="button" class="btn btn-primary" id="paste-preview-load-btn">Загрузить</button>
                        <button type="button" class="btn btn-secondary" id="paste-preview-cancel-btn">Отменить</button>
                    </div>
                </div>
            `;

            document.body.appendChild(previewOverlay);
            document.body.appendChild(previewModal);

            const closePreview = () => {
                previewModal.remove();
                previewOverlay.remove();
                window._integramModalDepth = Math.max(0, (window._integramModalDepth || 1) - 1);
            };

            previewModal.querySelector('.edit-form-close').addEventListener('click', closePreview);
            previewModal.querySelector('#paste-preview-cancel-btn').addEventListener('click', closePreview);
            previewOverlay.addEventListener('click', closePreview);

            // Keyboard navigation within preview cells (issue #1784)
            previewModal.addEventListener('keydown', (e) => {
                const cell = e.target;
                if (!cell.classList.contains('paste-preview-cell')) return;

                const row = parseInt(cell.dataset.row, 10);
                const col = parseInt(cell.dataset.col, 10);
                const numCols = orderedColIds.length;
                const numRows = parsedRows.length;

                let targetRow = row;
                let targetCol = col;

                if (e.key === 'Tab') {
                    e.preventDefault();
                    if (e.shiftKey) {
                        // Move to previous cell
                        if (col > 0) {
                            targetCol = col - 1;
                        } else if (row > 0) {
                            targetRow = row - 1;
                            targetCol = numCols - 1;
                        } else {
                            return; // Already at first cell
                        }
                    } else {
                        // Move to next cell
                        if (col < numCols - 1) {
                            targetCol = col + 1;
                        } else if (row < numRows - 1) {
                            targetRow = row + 1;
                            targetCol = 0;
                        } else {
                            return; // Already at last cell
                        }
                    }
                } else if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    if (row < numRows - 1) {
                        targetRow = row + 1;
                    } else {
                        return; // Already at last row
                    }
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    if (row > 0) {
                        targetRow = row - 1;
                    } else {
                        return; // Already at first row
                    }
                } else {
                    return;
                }

                const target = previewModal.querySelector(
                    `.paste-preview-cell[data-row="${targetRow}"][data-col="${targetCol}"]`
                );
                if (target) {
                    target.focus();
                    target.select();
                }
            });

            previewModal.querySelector('#paste-preview-load-btn').addEventListener('click', () => {
                // Collect edited cell values back into rows
                const cells = previewModal.querySelectorAll('.paste-preview-cell');
                const editedRows = parsedRows.map(row => [...row]);
                cells.forEach(cell => {
                    const rowIdx = parseInt(cell.dataset.row, 10);
                    const colIdx = parseInt(cell.dataset.col, 10);
                    editedRows[rowIdx][colIdx] = cell.value;
                });

                // Rebuild text from edited rows using original delimiter and update textarea
                const newText = editedRows.map(row => row.join(delimiter)).join('\n');
                textarea.value = newText;

                closePreview();
                // Trigger insert using the updated textarea content
                window[instanceName].insertPastedData(pasteModal, closePasteModal);
            });
        }

        /**
         * Parse and insert pasted data into the table (issue #1606).
         * Each line becomes one record; fields within a line are split by the detected
         * delimiter (TAB, ";" or ","). A delimiter is only used if it appears the same
         * number of times in every non-empty line, preventing false splits when text
         * contains commas or semicolons as part of values (issue #1612).
         * Uses visible columns (in order) as field mapping.
         * Stops on first insert error.
         */
        async insertPastedData(modal, closeModal) {
            const textarea = modal.querySelector('#paste-data-textarea');
            const progressEl = modal.querySelector('#paste-data-progress');
            const insertBtn = modal.querySelector('#paste-data-insert-btn');
            const createRefsCheckbox = modal.querySelector('#paste-data-create-refs');
            const createRefValues = createRefsCheckbox ? createRefsCheckbox.checked : false;
            const text = textarea.value;

            if (!text || !text.trim()) {
                this.showToast('Поле ввода пустое', 'error');
                return;
            }

            // Split into lines, skip empty lines
            const lines = text.split(/\r?\n/).filter(line => line.trim() !== '');
            if (lines.length === 0) {
                this.showToast('Нет данных для вставки', 'error');
                return;
            }

            // Determine delimiter: a candidate is valid only if it appears the same
            // number of times (> 0) in every non-empty line (issue #1612).
            // Escaped occurrences (preceded by \) are not counted (issue #1614).
            const countChar = (str, ch) => {
                let count = 0;
                for (let i = 0; i < str.length; i++) {
                    if (str[i] === ch && (i === 0 || str[i - 1] !== '\\')) {
                        count++;
                    }
                }
                return count;
            };
            const isConsistentDelimiter = (delim) => {
                const counts = lines.map(l => countChar(l, delim));
                return counts[0] > 0 && counts.every(c => c === counts[0]);
            };
            let delimiter = '\t'; // fallback: TAB (issue #1614)
            if (isConsistentDelimiter('\t')) {
                delimiter = '\t';
            } else if (isConsistentDelimiter(';')) {
                delimiter = ';';
            } else if (isConsistentDelimiter(',')) {
                delimiter = ',';
            }

            // Get the ordered list of visible, non-id, editable columns
            const columnMap = {};
            this.columns.forEach(col => { columnMap[col.id] = col; });
            const orderedColIds = (this.columnOrder || this.columns.map(c => c.id))
                .filter(id => columnMap[id] && !this.idColumns.has(id));

            const typeId = this.options.tableTypeId || this.objectTableId;
            if (!typeId) {
                this.showToast('Ошибка: не найден тип таблицы', 'error');
                return;
            }

            const apiBase = this.getApiBase();
            const parentIdForNew = (this.options.parentId && parseInt(this.options.parentId) > 1) ? this.options.parentId : 1;
            const url = `${apiBase}/_m_new/${typeId}?JSON&up=${parentIdForNew}`;

            insertBtn.disabled = true;
            progressEl.style.display = 'block';

            // Pre-fetch reference options (LIMIT=500) for all REF columns (issue #1648)
            const refOptionsCache = {};
            const refColIds = orderedColIds.filter(id => columnMap[id] && (columnMap[id].format || '') === 'REF');
            for (const colId of refColIds) {
                try {
                    const refParams = new URLSearchParams({ JSON: '', LIMIT: '500' });
                    const refUrl = `${apiBase}/_ref_reqs/${colId}?${refParams}`;
                    const refResponse = await fetch(refUrl);
                    if (refResponse.ok) {
                        const refText = await refResponse.text();
                        try {
                            refOptionsCache[colId] = this.parseJsonObjectAsArray(refText);
                        } catch (e) {
                            refOptionsCache[colId] = [];
                        }
                    } else {
                        refOptionsCache[colId] = [];
                    }
                } catch (e) {
                    refOptionsCache[colId] = [];
                }
            }

            /**
             * Resolve a text value to its ID for a REF column (issue #1648).
             * First searches the pre-fetched list of up to 500 options.
             * If not found and the list has 500 items (server may have more),
             * performs a targeted search using q={value} to find the exact record.
             * If still not found and createRefValues is true, creates the reference
             * value via POST _m_new/{refTypeId}?JSON&up=1 (issue #1658).
             */
            const resolveRefId = async (colId, textValue) => {
                const options = refOptionsCache[colId] || [];
                const lowerValue = textValue.toLowerCase();
                const found = options.find(([, label]) => String(label).toLowerCase() === lowerValue);
                if (found) {
                    return found[0];
                }
                // If the cached list is full (500 items), there may be more on the server
                if (options.length >= 500) {
                    try {
                        const searchParams = new URLSearchParams({ JSON: '', LIMIT: '1', q: textValue });
                        const searchUrl = `${apiBase}/_ref_reqs/${colId}?${searchParams}`;
                        const searchResponse = await fetch(searchUrl);
                        if (searchResponse.ok) {
                            const searchText = await searchResponse.text();
                            const searchResult = this.parseJsonObjectAsArray(searchText);
                            if (searchResult.length > 0) {
                                return searchResult[0][0];
                            }
                        }
                    } catch (e) {
                        // Fall through: return original text if search fails
                    }
                }
                // If checkbox is checked and value not found, create it as a new reference record (issue #1658)
                if (createRefValues) {
                    const col = columnMap[colId];
                    const refTypeId = col && (col.ref || col.orig || col.ref_id);
                    if (refTypeId) {
                        try {
                            const createParams = new URLSearchParams();
                            if (typeof xsrf !== 'undefined') {
                                createParams.append('_xsrf', xsrf);
                            }
                            createParams.append(`t${refTypeId}`, textValue);
                            const createUrl = `${apiBase}/_m_new/${refTypeId}?JSON&up=1`;
                            const createResponse = await fetch(createUrl, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                                body: createParams.toString()
                            });
                            if (createResponse.ok) {
                                const createText = await createResponse.text();
                                let createResult;
                                try {
                                    createResult = JSON.parse(createText);
                                } catch (e) {
                                    createResult = null;
                                }
                                if (createResult && createResult.obj) {
                                    const newId = createResult.obj;
                                    // Cache the new value so it is reused if it appears again
                                    if (!refOptionsCache[colId]) {
                                        refOptionsCache[colId] = [];
                                    }
                                    refOptionsCache[colId].push([newId, textValue]);
                                    return newId;
                                }
                            }
                        } catch (e) {
                            // Fall through: return null if creation fails
                        }
                    }
                }
                return null;
            };

            let successCount = 0;
            const total = lines.length;

            for (let i = 0; i < lines.length; i++) {
                progressEl.textContent = `Вставлено ${successCount} из ${total}`;

                // Split using the pre-determined consistent delimiter
                let parts;
                parts = lines[i].split(delimiter);

                const params = new URLSearchParams();
                if (typeof xsrf !== 'undefined') {
                    params.append('_xsrf', xsrf);
                }

                // Map each part to the corresponding column id (t{colId} = value)
                // For REF columns, resolve text values to IDs (issue #1648)
                for (let idx = 0; idx < parts.length; idx++) {
                    if (idx < orderedColIds.length) {
                        const trimmed = parts[idx].trim();
                        if (trimmed !== '') {
                            const colId = orderedColIds[idx];
                            const col = columnMap[colId];
                            if (col && (col.format || '') === 'REF') {
                                const resolvedId = await resolveRefId(colId, trimmed);
                                if (resolvedId !== null) {
                                    params.append(`t${colId}`, resolvedId);
                                } else if (/^\d+$/.test(trimmed)) {
                                    // ID could not be resolved; send as-is only if numeric (IDs are always numeric)
                                    params.append(`t${colId}`, trimmed);
                                }
                            } else {
                                params.append(`t${colId}`, trimmed);
                            }
                        }
                    }
                }

                try {
                    const response = await fetch(url, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
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

                    const serverError = this.getServerError(result);
                    if (serverError) {
                        throw new Error(serverError);
                    }

                    successCount++;
                } catch (err) {
                    progressEl.textContent = `Вставлено ${successCount} из ${total}. Ошибка на строке ${i + 1}: ${err.message}`;
                    insertBtn.disabled = false;
                    this.showToast(`Ошибка вставки строки ${i + 1}: ${err.message}`, 'error');
                    return;
                }
            }

            progressEl.textContent = `Вставлено ${successCount} из ${total}`;
            this.showToast(`Вставлено записей: ${successCount}`, 'success');

            closeModal();
            // Refresh the table after insertion
            this.loadData();
        }

        /**
         * Add a new empty row at the bottom of the table (issue #807)
         * The row starts in edit mode with only the first column editable.
         * After the first column is saved, all other cells become editable.
         */
