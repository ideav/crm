        reload() {
            // Reset data and load from beginning with current filters
            this.data = [];
            this.loadedRecords = 0;
            this.hasMore = true;
            this.totalRows = null;
            this.loadData(false);
        }

        saveColumnState() {
            // Skip saving to cookies if config was loaded from URL (issue #514)
            // User can still copy current config as a shareable URL
            if (this.configFromUrl) {
                return;
            }

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
                compactForAll: this.settings.compactForAll,
                pageSize: this.settings.pageSize,
                truncateLongValues: this.settings.truncateLongValues,
                wrapHeaders: this.settings.wrapHeaders,
                hideMenuButtonLabels: this.settings.hideMenuButtonLabels,
            };
            document.cookie = `${ this.options.cookiePrefix }-settings=${ JSON.stringify(settings) }; path=/; max-age=31536000`;

            // Save global compact setting if "For All" is checked
            if (this.settings.compactForAll) {
                const globalSettings = { compact: this.settings.compact };
                document.cookie = `integram-table-global-settings=${ JSON.stringify(globalSettings) }; path=/; max-age=31536000`;
            }
        }

        loadSettings() {
            const cookies = document.cookie.split(';');
            const settingsCookie = cookies.find(c => c.trim().startsWith(`${ this.options.cookiePrefix }-settings=`));

            if (settingsCookie) {
                try {
                    const settings = JSON.parse(settingsCookie.split('=')[1]);
                    this.settings.compact = settings.compact !== undefined ? settings.compact : false;
                    this.settings.compactForAll = settings.compactForAll !== undefined ? settings.compactForAll : true;
                    this.settings.pageSize = settings.pageSize || 20;
                    this.settings.truncateLongValues = settings.truncateLongValues !== undefined ? settings.truncateLongValues : true;
                    this.settings.wrapHeaders = settings.wrapHeaders !== undefined ? settings.wrapHeaders : false;
                    this.settings.hideMenuButtonLabels = settings.hideMenuButtonLabels !== undefined ? settings.hideMenuButtonLabels : false;

                    // Update options.pageSize to match loaded settings
                    this.options.pageSize = this.settings.pageSize;
                } catch (e) {
                    console.error('Error loading settings:', e);
                }
            } else {
                // No table-specific settings found, try to load global compact setting
                const globalSettingsCookie = cookies.find(c => c.trim().startsWith('integram-table-global-settings='));
                if (globalSettingsCookie) {
                    try {
                        const globalSettings = JSON.parse(globalSettingsCookie.split('=')[1]);
                        if (globalSettings.compact !== undefined) {
                            this.settings.compact = globalSettings.compact;
                        }
                    } catch (e) {
                        console.error('Error loading global settings:', e);
                    }
                }
            }

        }

        /**
         * Apply font size from the global cookie to the document root (issue #1626/#1628).
         * On pages using main.html this is already applied before DOM render;
         * this call is a fallback for pages that don't include main.html.
         */
        applyPageFontSize() {
            // If main.html already set up the global handler, skip to avoid double-apply
            if (typeof window.setPageFontSize === 'function') return;
            // Use same rem values as main.html (issue #1632) — must match SIZE_MAP there
            const sizeMap = { smaller: '.7rem', normal: '.82rem', larger: '.95rem' };
            let size = 'normal';
            try {
                const match = document.cookie.match(/(?:^|; )integram-table-font-settings=([^;]*)/);
                if (match) {
                    const fontSettings = JSON.parse(decodeURIComponent(match[1]));
                    if (fontSettings.pageFontSize) size = fontSettings.pageFontSize;
                }
            } catch (e) { /* ignore */ }
            const value = sizeMap[size] || sizeMap.normal;
            document.documentElement.style.fontSize = value;
        }

        // Modal Edit Form functionality
        async openEditForm(recordId, typeId, rowIndex) {
            if (!typeId) {
                this.showToast('Ошибка: не указан тип записи', 'error');
                return;
            }

            // Issue #708: Validate that typeId is not a base type (2-17)
            // Base types are primitives that don't have editable metadata
            if (this.isBaseType(typeId)) {
                console.error(`openEditForm: typeId ${typeId} is a base type (primitive) and cannot be edited directly`);
                this.showToast('Ошибка: невозможно редактировать базовый тип', 'error');
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
                    recordData = await this.fetchRecordData(recordId, typeId, metadata);
                }

                this.renderEditFormModal(metadata, recordData, isCreate, typeId);
            } catch (error) {
                console.error('Error opening edit form:', error);
                this.showToast(`Ошибка загрузки формы: ${ error.message }`, 'error');
            }
        }

        shouldShowAddButton(column) {
            // Do not show add button for tabular (subordinate table) requisites — they require a parent (up parameter)
            if (column.arr_id) {
                return false;
            }

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

                // Pre-fill reference fields from URL @id filters (issue #553)
                // When URL has FR_{colId}=@{id}, auto-select that id in the create form
                const prefillReqs = this.buildRefIdPrefillFromUrlFilters(metadata);
                // Issue #616: Use F_U from URL as parent when F_U > 1
                const parentForCreate = (this.options.parentId && parseInt(this.options.parentId) > 1) ? this.options.parentId : 1;
                const createRecordData = prefillReqs ? { obj: { val: '', parent: parentForCreate }, reqs: prefillReqs } : null;

                // Render create form with pre-filled values from URL filters
                this.renderEditFormModal(metadata, createRecordData, true, typeId, columnId);

            } catch (error) {
                console.error('Error opening create form from column header:', error);
                this.showToast(`Ошибка: ${ error.message }`, 'error');
            }
        }

        /**
         * Build recordData.reqs pre-fill map from URL @id-based filters (issue #553).
         * For each URL filter with isRefId=true (e.g. FR_4547=@6753), checks if the
         * metadata has a matching requisite (req.id === colId). If so, adds
         * { value: refId } to the reqs map so the create form pre-selects that value.
         *
         * @param {Object} metadata - Table metadata with reqs array
         * @returns {Object|null} reqs map {reqId: {value: refId}} or null if nothing to pre-fill
         */
        buildRefIdPrefillFromUrlFilters(metadata) {
            if (!this.urlFilters || !metadata || !metadata.reqs) return null;

            const reqs = {};
            let hasPrefill = false;

            for (const [colId, urlFilter] of Object.entries(this.urlFilters)) {
                if (!urlFilter.isRefId || !urlFilter.refId) continue;

                // Check if this colId matches a requisite in the metadata
                const matchingReq = metadata.reqs.find(req => String(req.id) === String(colId) && req.ref_id);
                if (matchingReq) {
                    reqs[colId] = { value: String(urlFilter.refId) };
                    hasPrefill = true;

                    if (window.INTEGRAM_DEBUG) {
                        console.log(`[buildRefIdPrefillFromUrlFilters] Pre-filling field ${colId} with refId=${urlFilter.refId}`);
                    }
                }
            }

            return hasPrefill ? reqs : null;
        }

        /**
         * Check if the add button should be shown in grouped cells (issue #543)
         * The button is shown only when data source is object/table format
         * @returns {boolean} - True if the button should be shown
         */
        shouldShowGroupedCellAddButton() {
            // Check if this is object/table format (issue #697)
            const isObjectFormat = (this.rawObjectData && this.rawObjectData.length > 0 && this.objectTableId)
                || this.getDataSourceType() === 'table';

            return isObjectFormat;
        }

        /**
         * Open create record form from a grouped cell with prefilled values (issue #543)
         * Prefills attributes from the current cell and all grouping cells to the left
         *
         * @param {number} rowIndex - Index of the row in groupedData
         * @param {number} groupLevel - Level of the grouping column (0-based, from left to right)
         */
        async openGroupedCellCreateForm(rowIndex, groupLevel) {
            try {
                // Get the row info from groupedData
                const rowInfo = this.groupedData[rowIndex];
                if (!rowInfo) {
                    console.error('openGroupedCellCreateForm: Invalid rowIndex', rowIndex);
                    this.showToast('Ошибка: строка не найдена', 'error');
                    return;
                }

                // Find the table type ID (objectTableId for object format)
                const tableTypeId = this.objectTableId || this.options.tableTypeId;
                if (!tableTypeId) {
                    console.error('openGroupedCellCreateForm: No table type ID found');
                    this.showToast('Ошибка: не найден тип таблицы', 'error');
                    return;
                }

                // Build prefilled values from grouping columns (current and all to the left)
                const fieldValues = {};

                // Iterate through grouping columns from 0 to groupLevel (inclusive)
                for (let level = 0; level <= groupLevel; level++) {
                    const colId = this.groupingColumns[level];
                    const column = this.columns.find(c => c.id === colId);
                    if (!column) continue;

                    // Get the column's data index
                    const dataIndex = this.columns.indexOf(column);
                    if (dataIndex === -1) continue;

                    // Get the raw value from the row data
                    const rawValue = rowInfo.data[dataIndex];
                    if (rawValue === undefined || rawValue === null || rawValue === '') continue;

                    // For reference fields and GRANT/REPORT_COLUMN, extract the ID part from "id:Value" format (issue #925)
                    const isRefField = column.ref_id != null || (column.ref && column.ref !== 0);
                    const colFormat = column.format ? String(column.format).toUpperCase() : '';
                    const isGrantOrRepCol = colFormat === 'GRANT' || colFormat === 'REPORT_COLUMN';
                    let valueToUse = rawValue;

                    if ((isRefField || isGrantOrRepCol) && typeof rawValue === 'string') {
                        const colonIndex = rawValue.indexOf(':');
                        if (colonIndex > 0) {
                            // Use only the ID part for prefilling reference/grant/report_column fields
                            valueToUse = rawValue.substring(0, colonIndex);
                        }
                    }

                    // Use column.paramId or column.id as the field key
                    // In object format, column.paramId contains the metadata field ID
                    const fieldId = column.paramId || colId;
                    fieldValues[`t${ fieldId }`] = valueToUse;
                }

                // Determine parent ID
                // In object format, try to get parent from rawObjectData
                let parentId = 1;
                if (this.rawObjectData && this.rawObjectData[rowInfo.originalIndex]) {
                    const rawItem = this.rawObjectData[rowInfo.originalIndex];
                    if (rawItem.u) {
                        parentId = rawItem.u;
                    }
                }

                // Use the global openCreateRecordForm function
                if (typeof openCreateRecordForm === 'function') {
                    await openCreateRecordForm(tableTypeId, parentId, fieldValues);
                } else {
                    console.error('openGroupedCellCreateForm: openCreateRecordForm is not available');
                    this.showToast('Ошибка: функция создания записи недоступна', 'error');
                }

            } catch (error) {
                console.error('Error opening create form from grouped cell:', error);
                this.showToast(`Ошибка: ${ error.message }`, 'error');
            }
        }

        async fetchMetadata(typeId) {
            // Use globalMetadata if available - it already contains metadata for all tables (issue #779)
            if (this.globalMetadata) {
                const cachedItem = this.globalMetadata.find(item => item.id === typeId || item.id === Number(typeId));
                if (cachedItem) {
                    return cachedItem;
                }
            }

            // If globalMetadata is still loading, wait for it to avoid a redundant /metadata/{id} fetch (issue #789)
            if (this.globalMetadataPromise) {
                await this.globalMetadataPromise;
                if (this.globalMetadata) {
                    const cachedItem = this.globalMetadata.find(item => item.id === typeId || item.id === Number(typeId));
                    if (cachedItem) {
                        return cachedItem;
                    }
                }
            }

            // If metadata is already cached, return it immediately (issue #1455)
            if (this.metadataCache[typeId]) {
                return this.metadataCache[typeId];
            }

            // If a fetch for this typeId is already in progress, await it instead of starting a new one (issue #1455)
            if (this.metadataFetchPromises[typeId]) {
                return this.metadataFetchPromises[typeId];
            }

            const apiBase = this.getApiBase();
            const fetchPromise = (async () => {
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
                    const serverError = this.getServerError(data);
                    if (serverError) {
                        throw new Error(serverError);
                    }

                    this.metadataCache[typeId] = data;
                    return data;
                } catch (e) {
                    if (e.message && e.message.includes('error')) {
                        throw e;
                    }
                    throw new Error(`Invalid JSON response: ${ text }`);
                } finally {
                    delete this.metadataFetchPromises[typeId];
                }
            })();
            this.metadataFetchPromises[typeId] = fetchPromise;
            return fetchPromise;
        }

        async fetchRecordData(recordId, typeId, metadata) {
            const apiBase = this.getApiBase();
            // Issue #857: Use object/{typeId}/?JSON_OBJ&FR_{typeId}=@{recordId} to fetch record data,
            // taking field types from metadata (same as inline table editing)
            const response = await fetch(`${ apiBase }/object/${ typeId }/?JSON_OBJ&FR_${ typeId }=@${ recordId }`);

            if (!response.ok) {
                throw new Error(`Failed to fetch record data: ${ response.statusText }`);
            }

            const text = await response.text();

            let dataArray;
            try {
                dataArray = JSON.parse(text);
            } catch (e) {
                throw new Error(`Invalid JSON response: ${ text }`);
            }

            if (!Array.isArray(dataArray) || dataArray.length === 0) {
                throw new Error(`Record ${ recordId } not found`);
            }

            const item = dataArray[0];
            const rowValues = item.r || [];

            // Convert JSON_OBJ format to {obj, reqs} format expected by renderEditFormModal.
            // Column order: [0] = main value, [1..N] = requisites in metadata.reqs order.
            // Field types are taken from metadata (issue #857).
            const reqs = metadata.reqs || [];
            const recordReqs = {};
            reqs.forEach((req, idx) => {
                const rawValue = rowValues[idx + 1] !== undefined ? rowValues[idx + 1] : '';
                // For GRANT/REPORT_COLUMN requisites, parse "id:value" format (issue #925)
                const reqFormat = this.normalizeFormat(req.type);
                let reqValue = rawValue;
                let reqTerm = undefined;
                if ((reqFormat === 'GRANT' || reqFormat === 'REPORT_COLUMN') && typeof rawValue === 'string') {
                    const colonIdx = rawValue.indexOf(':');
                    if (colonIdx > 0) {
                        reqTerm = rawValue.substring(0, colonIdx);
                        reqValue = rawValue.substring(colonIdx + 1);
                    }
                }
                recordReqs[req.id] = {
                    value: reqValue,
                    base: req.type,
                    order: idx
                };
                if (reqTerm !== undefined) {
                    recordReqs[req.id].term = reqTerm;
                }
                // For subordinate table requisites (arr_id present), the value is the count of
                // subordinate records. Store it as `arr` so the tab label reads it correctly
                // (issue #923).
                if (req.arr_id) {
                    recordReqs[req.id].arr = typeof rawValue === 'number' ? rawValue : (parseInt(rawValue, 10) || 0);
                }
            });

            // Parse main value for GRANT/REPORT_COLUMN types (issue #925)
            const mainFormat = this.normalizeFormat(metadata.type);
            let mainVal = rowValues[0] !== undefined ? rowValues[0] : '';
            let mainTerm = undefined;
            if ((mainFormat === 'GRANT' || mainFormat === 'REPORT_COLUMN') && typeof mainVal === 'string') {
                const colonIdx = mainVal.indexOf(':');
                if (colonIdx > 0) {
                    mainTerm = mainVal.substring(0, colonIdx);
                    mainVal = mainVal.substring(colonIdx + 1);
                }
            }

            const result = {
                obj: {
                    id: item.i,
                    val: mainVal,
                    parent: item.u || 1
                },
                reqs: recordReqs
            };
            if (mainTerm !== undefined) {
                result.obj.term = mainTerm;
            }
            return result;
        }

        async fetchReferenceOptions(requisiteId, recordId = 0, searchQuery = '', extraParams = {}, attrs = '') {
            const apiBase = this.getApiBase();
            // Determine whether to include id parameter: only when attrs contains a query (square bracket expression)
            const hasQuery = /\[.+\]/.test(attrs || '');

            // Check for override URL in integramTableOverrides.ddls
            if (window.integramTableOverrides &&
                window.integramTableOverrides.ddls &&
                window.integramTableOverrides.ddls[requisiteId] !== undefined) {
                const overrideUrlRaw = window.integramTableOverrides.ddls[requisiteId];
                let overrideUrl = overrideUrlRaw.startsWith('http') ? overrideUrlRaw : `${ apiBase }/${ overrideUrlRaw }`;

                // Apply extraParams from fieldHooks to the override URL
                if (extraParams && Object.keys(extraParams).length > 0) {
                    const url = new URL(overrideUrl, window.location.origin);
                    for (const [key, value] of Object.entries(extraParams)) {
                        url.searchParams.set(key, value);
                    }
                    overrideUrl = url.toString();
                }

                const overrideResponse = await fetch(overrideUrl);

                if (!overrideResponse.ok) {
                    throw new Error(`Failed to fetch reference options: ${ overrideResponse.statusText }`);
                }

                const overrideText = await overrideResponse.text();

                try {
                    const overrideData = JSON.parse(overrideText);

                    if (!Array.isArray(overrideData) || overrideData.length === 0) {
                        return [];
                    }

                    // Find the ID field (ends with 'ID') and derive the label field (without 'ID' suffix)
                    const idField = Object.keys(overrideData[0]).find(key => key.endsWith('ID'));
                    if (!idField) {
                        throw new Error('No ID field found in override response');
                    }
                    const labelField = idField.slice(0, -2);

                    // Return array of [id, text] tuples to preserve server order
                    return overrideData.map(item => [String(item[idField]), item[labelField]]);
                } catch (e) {
                    if (e.message && (e.message.includes('error') || e.message.includes('ID field'))) {
                        throw e;
                    }
                    throw new Error(`Invalid JSON response from override URL: ${ overrideText }`);
                }
            }

            const params = new URLSearchParams({
                JSON: '',
                LIMIT: '50'
            });

            // Only add id parameter when attrs indicates a query (square bracket expression) (issue #1571)
            if (hasQuery && recordId && recordId !== 0) {
                params.append('id', recordId);
            }
            if (searchQuery) {
                params.append('q', searchQuery);
            }
            for (const [key, value] of Object.entries(extraParams)) {
                params.set(key, value);
            }

            // Cache by composite key: requisiteId + recordId (when id is used) + searchQuery (issue #1571)
            const cacheKey = `${requisiteId}_${hasQuery && recordId ? recordId : ''}_${searchQuery}`;
            const cachedResult = this.refFetchCache[cacheKey];
            if (cachedResult !== undefined && Object.keys(extraParams).length === 0) {
                return cachedResult;
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
                const serverError = this.getServerError(data);
                if (serverError) {
                    throw new Error(serverError);
                }

                // Parse JSON text to extract key-value pairs in original server order
                // (JavaScript objects with numeric string keys iterate in numeric order, not insertion order)
                const result = this.parseJsonObjectAsArray(text);
                // Cache result for subsequent calls with same requisiteId + recordId + searchQuery (issue #1571)
                if (Object.keys(extraParams).length === 0) {
                    this.refFetchCache[cacheKey] = result;
                }
                return result;
            } catch (e) {
                if (e.message && e.message.includes('error')) {
                    throw e;
                }
                throw new Error(`Invalid JSON response: ${ text }`);
            }
        }

        /**
         * Load reference options for all REF-format filter columns (issue #795, #797).
         * Called after render() when filtersEnabled is true.
         * Options are fetched from _ref_reqs/{colId}?JSON&LIMIT=50 and cached in this.refOptionsCache.
         * After loading, updates the trigger button display text.
         */
        async loadRefFilterOptions() {
            if (!this.container || !this.filtersEnabled) return;
            const refColumns = this.columns.filter(col => (col.format || '') === 'REF');
            for (const col of refColumns) {
                try {
                    // Use cache if available
                    let options = this.refOptionsCache[col.id];
                    if (!options) {
                        options = await this.fetchReferenceOptions(col.id);
                        this.refOptionsCache[col.id] = options;
                    }
                    // Update the trigger button display text
                    this.updateRefFilterTriggerDisplay(col.id);
                } catch (e) {
                    if (window.INTEGRAM_DEBUG) {
                        console.warn(`[loadRefFilterOptions] Failed to load options for column ${col.id}:`, e);
                    }
                }
            }
        }

        /**
         * Update the display text of a reference filter trigger button (issue #797).
         * @param {string} colId - Column ID
         */
